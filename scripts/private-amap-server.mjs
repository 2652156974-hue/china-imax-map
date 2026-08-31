import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIST = path.join(ROOT, 'dist-private');
const SERVICE_PREFIX = '/_AMapService';

export function loadServerConfig(env = process.env) {
  const host = String(env.PRIVATE_AMAP_HOST || '127.0.0.1').trim();
  const port = parsePort(env.PRIVATE_AMAP_PORT || '8766');
  const amapJsKey = String(env.AMAP_JS_API_KEY || '').trim();
  const amapSecurityCode = String(env.AMAP_JS_SECURITY_CODE || '').trim();
  const amapJsSdkUrl = String(env.AMAP_JS_SDK_URL || '').trim();
  const username = String(env.PRIVATE_MAP_USERNAME || '');
  const password = String(env.PRIVATE_MAP_PASSWORD || '');
  const distRoot = path.resolve(env.PRIVATE_AMAP_DIST || DEFAULT_DIST);

  if (!amapJsKey) throw new Error('AMAP_JS_API_KEY is required (Web端 JS API Key, not Web服务 Key).');
  if (!amapSecurityCode) throw new Error('AMAP_JS_SECURITY_CODE is required for the server-side AMap security proxy.');
  if ((username && !password) || (!username && password)) {
    throw new Error('PRIVATE_MAP_USERNAME and PRIVATE_MAP_PASSWORD must be configured together.');
  }
  if (amapJsSdkUrl && amapJsSdkUrl !== '/__smoke/amap-js-sdk.mock.js') {
    throw new Error('AMAP_JS_SDK_URL is restricted to the local mock endpoint.');
  }
  if (!isLoopback(host) && (!username || !password)) {
    throw new Error('A non-loopback private deployment requires HTTP authentication credentials.');
  }
  if (!fs.existsSync(distRoot) || !fs.statSync(distRoot).isDirectory()) {
    throw new Error(`Private release directory is missing: ${distRoot}`);
  }

  return Object.freeze({
    host,
    port,
    amapJsKey,
    amapSecurityCode,
    amapJsSdkUrl,
    username,
    password,
    distRoot,
    authEnabled: Boolean(username && password)
  });
}

export function createPrivateAmapServer(config) {
  return http.createServer(async (request, response) => {
    try {
      setSecurityHeaders(response);
      if (!authorize(request, response, config)) return;
      if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
        sendText(response, 405, 'Method Not Allowed');
        return;
      }

      const requestUrl = new URL(request.url || '/', 'http://private-amap.local');
      if (requestUrl.pathname === '/runtime-config.js') {
        sendRuntimeConfig(response, config, request.method === 'HEAD');
        return;
      }
      if (requestUrl.pathname === '/__smoke/amap-js-sdk.mock.js' && config.amapJsSdkUrl === requestUrl.pathname) {
        sendMockAmapSdk(response, request.method === 'HEAD');
        return;
      }
      if (requestUrl.pathname === SERVICE_PREFIX || requestUrl.pathname.startsWith(`${SERVICE_PREFIX}/`)) {
        await proxyAmapService(requestUrl, response, config, request.method === 'HEAD');
        return;
      }
      serveStatic(requestUrl.pathname, response, config, request.method === 'HEAD');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendText(response, 502, `Private AMap server error: ${message}`);
    }
  });
}

export function runtimeConfigScript(config) {
  const publicConfig = {
    amapJsKey: config.amapJsKey,
    serviceHost: SERVICE_PREFIX,
    coordinateSystem: 'GCJ-02',
    privateOnly: true
  };
  if (config.amapJsSdkUrl) publicConfig.sdkUrl = config.amapJsSdkUrl;
  return `window.__PRIVATE_AMAP_CONFIG__ = Object.freeze(${JSON.stringify(publicConfig)});\n`;
}

function sendMockAmapSdk(response, headOnly) {
  const filePath = path.join(ROOT, 'scripts', 'fixtures', 'amap-js-sdk.mock.js');
  const body = fs.readFileSync(filePath);
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('Content-Length', body.length);
  response.end(headOnly ? undefined : body);
}

export function buildAmapProxyTarget(requestUrl, securityCode) {
  const suffix = requestUrl.pathname.slice(SERVICE_PREFIX.length) || '/';
  const base = suffix.startsWith('/v4/map/styles')
    ? 'https://webapi.amap.com'
    : 'https://restapi.amap.com';
  const target = new URL(suffix, base);
  for (const [key, value] of requestUrl.searchParams) target.searchParams.append(key, value);
  target.searchParams.set('jscode', securityCode);
  return target;
}

function authorize(request, response, config) {
  if (!config.authEnabled) return true;
  const supplied = request.headers.authorization || '';
  const expected = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  if (!constantTimeEqual(supplied, expected)) {
    response.statusCode = 401;
    response.setHeader('WWW-Authenticate', 'Basic realm="Private IMAX map", charset="UTF-8"');
    response.end('Authentication required');
    return false;
  }
  return true;
}

function sendRuntimeConfig(response, config, headOnly) {
  const body = runtimeConfigScript(config);
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(headOnly ? undefined : body);
}

async function proxyAmapService(requestUrl, response, config, headOnly) {
  const target = buildAmapProxyTarget(requestUrl, config.amapSecurityCode);
  const upstream = await fetch(target, {
    method: 'GET',
    headers: {
      Accept: '*/*',
      'User-Agent': 'china-imax-map-private-amap-proxy/1.0'
    },
    redirect: 'follow'
  });
  const body = Buffer.from(await upstream.arrayBuffer());
  response.statusCode = upstream.status;
  const callbackResponse = requestUrl.searchParams.has('callback') || /\/v3\/log\/init$/.test(requestUrl.pathname);
  response.setHeader(
    'Content-Type',
    callbackResponse
      ? 'text/javascript; charset=utf-8'
      : (upstream.headers.get('content-type') || 'application/octet-stream')
  );
  response.setHeader('Cache-Control', 'no-store, private');
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
  response.setHeader('Cache-Control', target.endsWith('.json') ? 'no-store, private' : 'no-cache, private');
  response.setHeader('Content-Length', body.length);
  response.end(headOnly ? undefined : body);
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
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

function sendText(response, statusCode, text) {
  if (response.headersSent && response.writableEnded) return;
  const body = `${text}\n`;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(body);
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid PRIVATE_AMAP_PORT: ${value}`);
  return port;
}

function isLoopback(host) {
  return ['127.0.0.1', '::1', 'localhost'].includes(host.toLowerCase());
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.mjs':
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    default: return 'application/octet-stream';
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadServerConfig();
  const server = createPrivateAmapServer(config);
  server.listen(config.port, config.host, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;
    console.log(JSON.stringify({
      ok: true,
      url: `http://${config.host}:${port}/`,
      dist: path.relative(ROOT, config.distRoot).replaceAll(path.sep, '/'),
      authEnabled: config.authEnabled,
      amapJsKeyPresent: true,
      securityProxyEnabled: true,
      securityCodeExposedToBrowser: false,
      coordinateSystem: 'GCJ-02'
    }, null, 2));
  });
}
