import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMINISTRATIVE_FIELDS } from './admin-cluster-bindings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIST = path.join(ROOT, 'dist-public');
const DEFAULT_LAYER = path.join(ROOT, 'data/local/public-amap-reviewed-geocodes.json');
const SERVICE_PREFIX = '/_AMapService';
const MARKER_PATH = '/api/public/markers';

export function loadPublicServerConfig(env = process.env) {
  const host = String(env.PUBLIC_AMAP_HOST || '127.0.0.1').trim();
  const port = parsePort(env.PUBLIC_AMAP_PORT || '4173');
  const amapJsKey = String(env.AMAP_JS_API_KEY || '').trim();
  const amapSecurityCode = String(env.AMAP_JS_SECURITY_CODE || '').trim();
  const amapJsSdkUrl = String(env.AMAP_JS_SDK_URL || '').trim();
  const distRoot = path.resolve(env.PUBLIC_AMAP_DIST || DEFAULT_DIST);
  const reviewedLayerFile = path.resolve(env.PUBLIC_AMAP_REVIEWED_FILE || DEFAULT_LAYER);

  if (!amapJsKey) throw new Error('AMAP_JS_API_KEY is required for the public Web端(JS API) application.');
  if (!amapSecurityCode) throw new Error('AMAP_JS_SECURITY_CODE is required for the server-side AMap security proxy.');
  if (!fs.existsSync(distRoot) || !fs.statSync(distRoot).isDirectory()) {
    throw new Error(`Public release directory is missing: ${distRoot}`);
  }
  if (!fs.existsSync(reviewedLayerFile) || !fs.statSync(reviewedLayerFile).isFile()) {
    throw new Error(`Public reviewed marker layer is missing: ${reviewedLayerFile}`);
  }
  if (amapJsSdkUrl && amapJsSdkUrl !== '/__smoke/amap-js-sdk.mock.js') {
    throw new Error('AMAP_JS_SDK_URL is restricted to the local mock endpoint.');
  }
  const layer = readJson(reviewedLayerFile);
  validateMarkerLayer(layer);

  return Object.freeze({
    host,
    port,
    amapJsKey,
    amapSecurityCode,
    amapJsSdkUrl,
    distRoot,
    reviewedLayerFile,
    markerLayer: layer,
    markerMap: new Map(layer.records.map((record) => [record.sourceRow, record]))
  });
}

export function createPublicAmapServer(config) {
  return http.createServer(async (request, response) => {
    try {
      setSecurityHeaders(response);
      if (!['GET', 'HEAD', 'POST'].includes(request.method || 'GET')) {
        sendText(response, 405, 'Method Not Allowed');
        return;
      }

      const requestUrl = new URL(request.url || '/', 'http://public-amap.local');
      if (requestUrl.pathname === '/runtime-config.js') {
        if (request.method === 'POST') return sendText(response, 405, 'Method Not Allowed');
        sendRuntimeConfig(response, config, request.method === 'HEAD');
        return;
      }
      if (requestUrl.pathname === '/__smoke/amap-js-sdk.mock.js' && config.amapJsSdkUrl === requestUrl.pathname) {
        sendMockAmapSdk(response, request.method === 'HEAD');
        return;
      }
      if (requestUrl.pathname === MARKER_PATH) {
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          sendText(response, 405, 'Marker service requires POST.');
          return;
        }
        await serveMarkers(request, response, config);
        return;
      }
      if (requestUrl.pathname === SERVICE_PREFIX || requestUrl.pathname.startsWith(`${SERVICE_PREFIX}/`)) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          sendText(response, 405, 'Method Not Allowed');
          return;
        }
        await proxyAmapService(requestUrl, response, config, request.method === 'HEAD');
        return;
      }
      if (request.method === 'POST') {
        sendText(response, 405, 'Method Not Allowed');
        return;
      }
      serveStatic(requestUrl.pathname, response, config, request.method === 'HEAD');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendText(response, 502, `Public AMap server error: ${message}`);
    }
  });
}

export function runtimeConfigScript(config) {
  const publicConfig = {
    amapJsKey: config.amapJsKey,
    serviceHost: SERVICE_PREFIX,
    coordinateSystem: 'GCJ-02',
    mode: 'public-amap-runtime',
    markerEndpoint: MARKER_PATH
  };
  if (config.amapJsSdkUrl) publicConfig.sdkUrl = config.amapJsSdkUrl;
  return `window.__PUBLIC_AMAP_CONFIG__ = Object.freeze(${JSON.stringify(publicConfig)});\n`;
}

function sendMockAmapSdk(response, headOnly) {
  const filePath = path.join(ROOT, 'scripts', 'fixtures', 'amap-js-sdk.mock.js');
  const body = fs.readFileSync(filePath);
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', body.length);
  response.end(headOnly ? undefined : body);
}

export function selectMarkers(layerOrConfig, requestedRows) {
  const markerMap = layerOrConfig.markerMap instanceof Map
    ? layerOrConfig.markerMap
    : new Map((layerOrConfig.records ?? []).map((record) => [record.sourceRow, record]));
  const rows = [...new Set(requestedRows.map(Number))];
  if (rows.some((row) => !Number.isInteger(row) || row < 2 || row > 902)) {
    throw new Error('sourceRows must contain integers from 2 through 902.');
  }
  return rows.map((sourceRow) => markerMap.get(sourceRow)).filter(Boolean).filter(hasAcceptedMarker).map(minimalMarker);
}

function validateMarkerLayer(layer) {
  if (layer?.mode !== 'public-amap-reviewed-layer' || layer?.policy?.localOnly !== true) {
    throw new Error('Marker layer must be an explicit local-only public AMap reviewed layer.');
  }
  if (!Array.isArray(layer.records) || layer.records.length !== 901) {
    throw new Error('Marker layer must contain 901 source rows.');
  }
  if (JSON.stringify(layer).match(/rawCandidates|rankedCandidates|securityJsCode|AMAP_JS_SECURITY_CODE/i)) {
    throw new Error('Marker layer contains forbidden raw candidate or credential text.');
  }
  const rows = new Set();
  for (const record of layer.records) {
    if (!Number.isInteger(record.sourceRow) || rows.has(record.sourceRow)) throw new Error('Marker layer sourceRow is not unique.');
    rows.add(record.sourceRow);
    if (hasAcceptedMarker(record) && (record.provider !== 'amap' || record.providerCrs !== 'GCJ-02')) {
      throw new Error(`Marker layer sourceRow ${record.sourceRow} has invalid provider CRS.`);
    }
  }
}

async function serveMarkers(request, response, config) {
  const body = await readBody(request, 256 * 1024);
  let payload;
  try {
    payload = JSON.parse(body || '{}');
  } catch {
    sendJson(response, 400, { error: 'Invalid JSON body.' });
    return;
  }
  if (!Array.isArray(payload.sourceRows) || payload.sourceRows.length > 901) {
    sendJson(response, 400, { error: 'sourceRows array is required and may contain at most 901 entries.' });
    return;
  }
  let records;
  try {
    records = selectMarkers(config, payload.sourceRows);
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  sendJson(response, 200, {
    schemaVersion: 1,
    mode: 'public-amap-marker-response',
    coordinateSystem: 'GCJ-02',
    sourceRowKey: true,
    records
  });
}

function minimalMarker(record) {
  return {
    sourceRow: record.sourceRow,
    id: record.id,
    provider: 'amap',
    providerPoiId: record.providerPoiId ?? null,
    providerLat: record.providerLat,
    providerLng: record.providerLng,
    providerCrs: 'GCJ-02',
    positionType: record.positionType ?? null,
    locationGranularity: record.locationGranularity ?? null,
    locationConfidence: record.locationConfidence ?? null,
    identityConfidence: record.identityConfidence ?? null,
    decisionOrigin: record.decisionOrigin,
    reviewVerdict: record.reviewVerdict,
    administrative: minimalAdministrative(record.administrative)
  };
}

function minimalAdministrative(value) {
  const administrative = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(ADMINISTRATIVE_FIELDS.map((field) => [field, administrative[field] ?? null]));
}

function hasAcceptedMarker(record) {
  return record?.provider === 'amap' && record?.providerCrs === 'GCJ-02' &&
    Number.isFinite(Number(record.providerLat)) && Number.isFinite(Number(record.providerLng)) &&
    Number(record.providerLat) >= -90 && Number(record.providerLat) <= 90 &&
    Number(record.providerLng) >= -180 && Number(record.providerLng) <= 180;
}

async function proxyAmapService(requestUrl, response, config, headOnly) {
  const target = buildAmapProxyTarget(requestUrl, config.amapSecurityCode);
  const upstream = await fetch(target, {
    method: 'GET',
    headers: {
      Accept: '*/*',
      'User-Agent': 'china-imax-map-public-amap-proxy/1.0'
    },
    redirect: 'follow'
  });
  const body = Buffer.from(await upstream.arrayBuffer());
  response.statusCode = upstream.status;
  const callbackResponse = requestUrl.searchParams.has('callback') || /\/v3\/log\/init$/.test(requestUrl.pathname);
  response.setHeader(
    'Content-Type',
    callbackResponse ? 'text/javascript; charset=utf-8' : (upstream.headers.get('content-type') || 'application/octet-stream')
  );
  response.setHeader('Cache-Control', 'no-store');
  response.end(headOnly ? undefined : body);
}

function buildAmapProxyTarget(requestUrl, securityCode) {
  const suffix = requestUrl.pathname.slice(SERVICE_PREFIX.length) || '/';
  const base = suffix.startsWith('/v4/map/styles')
    ? 'https://webapi.amap.com'
    : 'https://restapi.amap.com';
  const target = new URL(suffix, base);
  for (const [key, value] of requestUrl.searchParams) target.searchParams.append(key, value);
  target.searchParams.set('jscode', securityCode);
  return target;
}

function sendRuntimeConfig(response, config, headOnly) {
  const body = runtimeConfigScript(config);
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(headOnly ? undefined : body);
}

function serveStatic(requestPath, response, config, headOnly) {
  const decoded = decodeURIComponent(requestPath);
  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const target = path.resolve(config.distRoot, relativePath);
  const allowedPrefix = `${config.distRoot}${path.sep}`;
  if (!target.startsWith(allowedPrefix) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    sendText(response, 404, 'Not Found');
    return;
  }
  const body = fs.readFileSync(target);
  response.statusCode = 200;
  response.setHeader('Content-Type', contentType(target));
  response.setHeader('Cache-Control', target.endsWith('.json') ? 'no-store' : 'no-cache');
  response.setHeader('Content-Length', body.length);
  response.end(headOnly ? undefined : body);
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self' data: blob: https://*.amap.com https://*.autonavi.com; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.amap.com https://*.autonavi.com; " +
    "style-src 'self' 'unsafe-inline' https://*.amap.com https://*.autonavi.com; " +
    "img-src 'self' data: blob: https:; connect-src 'self' https://*.amap.com https://*.autonavi.com; " +
    "font-src 'self' data: https://*.amap.com https://*.autonavi.com; worker-src 'self' blob:; " +
    "object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests"
  );
}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request body too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(body);
}

function sendText(response, statusCode, text) {
  const body = `${text}\n`;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(body);
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid PUBLIC_AMAP_PORT: ${value}`);
  return port;
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.mjs':
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadPublicServerConfig();
  const server = createPublicAmapServer(config);
  server.listen(config.port, config.host, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;
    console.log(JSON.stringify({
      ok: true,
      url: `http://${config.host}:${port}/`,
      dist: path.relative(ROOT, config.distRoot).replaceAll(path.sep, '/'),
      markerEndpoint: MARKER_PATH,
      markerCount: config.markerLayer.records.filter(hasAcceptedMarker).length,
      amapJsKeyPresent: true,
      securityProxyEnabled: true,
      securityCodeExposedToBrowser: false,
      coordinateSystem: 'GCJ-02'
    }, null, 2));
  });
}
