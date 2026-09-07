// @ts-check
import {
  MARKER_PATH,
  SERVICE_PREFIX,
  createMarkerResponse,
  runtimeConfigScript,
  validateRuntimeMarkerLayer
} from '../scripts/public-marker-core.mjs';

const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_MARKER_VALUE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MARKER_KEY = 'public-amap-markers';
const CSP = "default-src 'self' data: blob: https://*.amap.com https://*.autonavi.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.amap.com https://*.autonavi.com; style-src 'self' 'unsafe-inline' https://*.amap.com https://*.autonavi.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.amap.com https://*.autonavi.com; font-src 'self' data: https://*.amap.com https://*.autonavi.com; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests";

export default { fetch: handleRequest };

/** @param {Request} request @param {WorkerEnv} env */
export async function handleRequest(request, env) {
  const url = new URL(request.url);
  try {
    if (url.pathname === '/runtime-config.js') return runtimeConfig(request, env);
    if (url.pathname === MARKER_PATH) return await markerResponse(request, env);
    if (url.pathname === SERVICE_PREFIX || url.pathname.startsWith(`${SERVICE_PREFIX}/`)) return await amapProxy(request, env, url);
    if (!['GET', 'HEAD'].includes(request.method)) return jsonError(405, 'method_not_allowed', 'Method Not Allowed', { Allow: 'GET, HEAD' });
    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response);
  } catch (error) {
    if (error instanceof PublicHttpError) return jsonError(error.status, error.code, error.message);
    return jsonError(500, 'worker_error', 'The public service could not complete this request.');
  }
}

/** @param {Request} request @param {WorkerEnv} env */
function runtimeConfig(request, env) {
  if (!['GET', 'HEAD'].includes(request.method)) return jsonError(405, 'method_not_allowed', 'Method Not Allowed', { Allow: 'GET, HEAD' });
  const key = String(env.AMAP_JS_API_KEY || '').trim();
  if (!key) return jsonError(503, 'runtime_unavailable', 'The map runtime is not configured.');
  const body = runtimeConfigScript({ amapJsKey: key });
  return withSecurityHeaders(new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }
  }));
}

/** @param {Request} request @param {WorkerEnv} env */
async function markerResponse(request, env) {
  if (request.method !== 'POST') return jsonError(405, 'method_not_allowed', 'Marker service requires POST.', { Allow: 'POST' });
  const payload = await readJsonBody(request);
  if (!Array.isArray(payload?.sourceRows) || payload.sourceRows.length > 901) {
    return jsonError(400, 'invalid_request', 'sourceRows array is required and may contain at most 901 entries.');
  }

  let layer;
  try {
    layer = await loadRuntimeMarkerLayer(env);
  } catch {
    return jsonError(503, 'runtime_unavailable', 'Runtime marker data is unavailable.');
  }
  try {
    return jsonResponse(200, createMarkerResponse(layer, payload.sourceRows));
  } catch {
    return jsonError(400, 'invalid_request', 'sourceRows must contain integers from 2 through 902.');
  }
}

/** @param {WorkerEnv} env */
async function loadRuntimeMarkerLayer(env) {
  const key = String(env.MARKER_OBJECT_KEY || DEFAULT_MARKER_KEY).trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(key) || key.startsWith('/') || key.includes('..')) throw new Error('Invalid marker key.');
  if (!env.RUNTIME_KV || typeof env.RUNTIME_KV.get !== 'function') throw new Error('KV marker binding is missing.');
  const body = await env.RUNTIME_KV.get(key);
  if (!body) throw new Error('KV marker value is missing.');
  if (new TextEncoder().encode(body).byteLength > MAX_MARKER_VALUE_BYTES) throw new Error('KV marker value is too large.');
  return validateRuntimeMarkerLayer(JSON.parse(body));
}

/** @param {Request} request @param {WorkerEnv} env @param {URL} url */
async function amapProxy(request, env, url) {
  if (!['GET', 'HEAD'].includes(request.method)) return jsonError(405, 'method_not_allowed', 'Method Not Allowed', { Allow: 'GET, HEAD' });
  const securityCode = String(env.AMAP_JS_SECURITY_CODE || '').trim();
  if (!securityCode) return jsonError(503, 'runtime_unavailable', 'The map proxy is not configured.');
  let target;
  try {
    target = buildAmapProxyTarget(url, securityCode);
  } catch {
    return jsonError(400, 'invalid_request', 'The requested map provider path is not allowed.');
  }
  let upstream;
  try {
    upstream = await fetch(target, {
      method: 'GET',
      headers: { Accept: request.headers.get('Accept') || '*/*', 'User-Agent': 'china-imax-map-public-amap-proxy/1.0' },
      redirect: 'manual'
    });
  } catch {
    return jsonError(502, 'upstream_unavailable', 'The map provider is temporarily unavailable.');
  }
  const headers = new Headers();
  const callbackResponse = url.searchParams.has('callback') || /\/v3\/log\/init$/.test(url.pathname);
  headers.set('Content-Type', callbackResponse ? 'text/javascript; charset=utf-8' : (upstream.headers.get('content-type') || 'application/octet-stream'));
  headers.set('Cache-Control', 'no-store');
  return withSecurityHeaders(new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  }));
}

/** @param {URL} requestUrl @param {string} securityCode */
export function buildAmapProxyTarget(requestUrl, securityCode) {
  const suffix = requestUrl.pathname.slice(SERVICE_PREFIX.length) || '/';
  if (!suffix.startsWith('/') || suffix.startsWith('//')) throw new Error('Invalid provider path.');
  const isStyleRequest = suffix.startsWith('/v4/map/styles');
  if (!isStyleRequest && !suffix.startsWith('/v3/')) throw new Error('Provider path is outside the approved API surface.');
  const base = isStyleRequest ? 'https://webapi.amap.com' : 'https://restapi.amap.com';
  const target = new URL(suffix, base);
  for (const [key, value] of requestUrl.searchParams) {
    if (key.toLowerCase() !== 'jscode') target.searchParams.append(key, value);
  }
  target.searchParams.set('jscode', securityCode);
  return target;
}

/** @param {Request} request */
async function readJsonBody(request) {
  const advertised = Number(request.headers.get('content-length') || 0);
  if (advertised > MAX_REQUEST_BODY_BYTES) throw new PublicHttpError(413, 'request_too_large', 'Request body is too large.');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_REQUEST_BODY_BYTES) throw new PublicHttpError(413, 'request_too_large', 'Request body is too large.');
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PublicHttpError(400, 'invalid_json', 'Invalid JSON body.');
  }
}

/** @param {number} status @param {unknown} value @param {Record<string, string>} [extraHeaders] */
function jsonResponse(status, value, extraHeaders = {}) {
  return withSecurityHeaders(new Response(`${JSON.stringify(value)}\n`, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }
  }));
}

/** @param {number} status @param {string} code @param {string} message @param {Record<string, string>} [extraHeaders] */
function jsonError(status, code, message, extraHeaders = {}) {
  return jsonResponse(status, { error: { code, message } }, extraHeaders);
}

/** @param {Response} response */
function withSecurityHeaders(response) {
  const output = new Response(response.body, response);
  output.headers.set('X-Content-Type-Options', 'nosniff');
  output.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  output.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  output.headers.set('Content-Security-Policy', CSP);
  return output;
}

class PublicHttpError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
