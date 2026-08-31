import assert from 'node:assert/strict';
import fs from 'node:fs';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildPrivateAmapRelease,
  hasProviderCoordinate,
  toPrivateAmapRecord
} from './build-private-amap-release.mjs';
import {
  buildAmapProxyTarget,
  createPrivateAmapServer,
  loadServerConfig,
  runtimeConfigScript
} from './private-amap-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('private release uses audited GCJ-02 provider coordinates and never WGS84 display coordinates', (t) => {
  const testRoot = createTestRoot();
  t.after(() => removeTestRoot(testRoot));
  const inputFile = path.join(testRoot, 'preview.json');
  const outputRoot = path.join(testRoot, 'dist-private');
  fs.writeFileSync(inputFile, JSON.stringify(fixtureDataset()), 'utf8');

  const result = buildPrivateAmapRelease({
    inputFile,
    outputRoot,
    generatedAt: '2026-08-21T00:00:00.000Z'
  });
  const output = JSON.parse(fs.readFileSync(path.join(outputRoot, 'data/cinemas.json'), 'utf8'));

  assert.equal(result.records, 901);
  assert.equal(result.located, 1);
  assert.equal(result.unresolved, 900);
  assert.equal(output.coordinateSystem, 'GCJ-02');
  assert.equal(output.policy.privateOnly, true);
  assert.equal(output.policy.gitCommitAllowed, false);
  assert.equal(output.records[0].location.providerLat, 39.9042);
  assert.equal(output.records[0].location.providerLng, 116.4074);
  assert.equal(output.records[0].location.mapCrs, 'GCJ-02');
  assert.equal(output.records[0].location.lat, undefined);
  assert.equal(output.records[0].location.lng, undefined);
  assert.equal(output.records[0].administrative.provinceName, '北京市');
  assert.equal(output.records[0].administrative.prefectureName, null);
  assert.equal(output.records[0].administrative.countyName, null);
  assert.equal(output.records[0].administrative.prefectureLevel, 'municipality');
  assert.equal(Object.hasOwn(output.records[0].administrative, 'rawCandidates'), false);
  assert.equal(Object.hasOwn(output.records[0].administrative, 'address'), false);
  assert.equal(Object.hasOwn(output.records[0].administrative, 'cache'), false);
  assert.equal(output.records[1].location.providerLat, null);
  assert.equal(output.records[1].location.providerCrs, null);
  assert.ok(fs.existsSync(path.join(outputRoot, 'index.html')));
  assert.ok(fs.existsSync(path.join(outputRoot, 'app.mjs')));
  assert.ok(fs.existsSync(path.join(outputRoot, 'styles.css')));
  assert.ok(fs.existsSync(path.join(outputRoot, 'nearby.mjs')));
  assert.ok(fs.existsSync(path.join(outputRoot, 'admin-clusters.mjs')));
  const lifecycleModule = path.join(outputRoot, 'cinema-lifecycle.mjs');
  assert.ok(fs.existsSync(lifecycleModule));
  assert.match(fs.readFileSync(lifecycleModule, 'utf8'), /export function cinemaLifecycle\(/);
});

test('coordinate adapter rejects non-GCJ-02 and malformed provider coordinates', () => {
  const valid = toPrivateAmapRecord(fixtureRecord(2, {
    providerLat: 31.2304,
    providerLng: 121.4737,
    providerCrs: 'GCJ-02'
  }));
  const wrongCrs = toPrivateAmapRecord(fixtureRecord(3, {
    providerLat: 31.2304,
    providerLng: 121.4737,
    providerCrs: 'WGS84'
  }));
  const invalid = toPrivateAmapRecord(fixtureRecord(4, {
    providerLat: 200,
    providerLng: 121.4737,
    providerCrs: 'GCJ-02'
  }));

  assert.equal(hasProviderCoordinate(valid), true);
  assert.equal(hasProviderCoordinate(wrongCrs), false);
  assert.equal(hasProviderCoordinate(invalid), false);
  assert.equal(wrongCrs.location.providerLat, null);
  assert.equal(invalid.location.providerLat, null);
});

test('runtime config exposes only the browser key and keeps the AMap security code server-side', () => {
  const script = runtimeConfigScript({
    amapJsKey: 'browser-key-for-test',
    amapSecurityCode: 'server-security-code-for-test'
  });
  assert.match(script, /browser-key-for-test/);
  assert.match(script, /_AMapService/);
  assert.doesNotMatch(script, /server-security-code-for-test/);
});

test('AMap proxy target is restricted to official hosts and injects jscode server-side', () => {
  const restTarget = buildAmapProxyTarget(
    new URL('http://localhost/_AMapService/v3/config/district?subdistrict=1'),
    'server-code'
  );
  const styleTarget = buildAmapProxyTarget(
    new URL('http://localhost/_AMapService/v4/map/styles?styleId=normal'),
    'server-code'
  );

  assert.equal(restTarget.origin, 'https://restapi.amap.com');
  assert.equal(restTarget.searchParams.get('jscode'), 'server-code');
  assert.equal(styleTarget.origin, 'https://webapi.amap.com');
  assert.equal(styleTarget.searchParams.get('jscode'), 'server-code');
});

test('private server fails closed for remote bind without authentication', (t) => {
  const testRoot = createTestRoot();
  t.after(() => removeTestRoot(testRoot));
  const outputRoot = path.join(testRoot, 'dist-private');
  fs.mkdirSync(outputRoot);

  assert.throws(() => loadServerConfig({
    PRIVATE_AMAP_HOST: '0.0.0.0',
    PRIVATE_AMAP_DIST: outputRoot,
    AMAP_JS_API_KEY: 'browser-key',
    AMAP_JS_SECURITY_CODE: 'security-code'
  }), /requires HTTP authentication/);
});

test('private server serves protected runtime data without making provider requests', async (t) => {
  const testRoot = createTestRoot();
  t.after(() => removeTestRoot(testRoot));
  const outputRoot = path.join(testRoot, 'dist-private');
  fs.mkdirSync(outputRoot);
  fs.writeFileSync(path.join(outputRoot, 'index.html'), '<!doctype html><title>private</title>', 'utf8');

  const config = loadServerConfig({
    PRIVATE_AMAP_HOST: '127.0.0.1',
    PRIVATE_AMAP_PORT: '0',
    PRIVATE_AMAP_DIST: outputRoot,
    PRIVATE_MAP_USERNAME: 'owner',
    PRIVATE_MAP_PASSWORD: 'password',
    AMAP_JS_API_KEY: 'browser-key',
    AMAP_JS_SECURITY_CODE: 'security-code'
  });
  const server = createPrivateAmapServer(config);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const denied = await requestUrl(`${origin}/runtime-config.js`);
  assert.equal(denied.status, 401);

  const authorization = `Basic ${Buffer.from('owner:password').toString('base64')}`;
  const allowed = await requestUrl(`${origin}/runtime-config.js`, { Authorization: authorization });
  const body = await allowed.text();
  assert.equal(allowed.status, 200);
  assert.match(body, /browser-key/);
  assert.doesNotMatch(body, /security-code/);
  assert.equal(allowed.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.match(allowed.headers.get('cache-control'), /no-store/);
  assert.match(allowed.headers.get('content-security-policy'), /worker-src 'self' blob:/);
  assert.match(allowed.headers.get('content-security-policy'), /upgrade-insecure-requests/);
});

function requestUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: response.statusCode,
          headers: new Headers(response.headers),
          text: async () => body
        });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

test('private frontend uses administrative display layers and contains no alternate basemap runtime', () => {
  const app = fs.readFileSync(path.join(ROOT, 'private-amap/app.mjs'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'private-amap/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'private-amap/styles.css'), 'utf8');

  assert.match(app, /buildAdministrativeDisplay/);
  assert.match(app, /resolveAdminCollisions/);
  assert.match(app, /zoomend/);
  assert.doesNotMatch(app, /AMap\.MarkerCluster|averageCenter/);
  assert.match(app, /providerCrs === 'GCJ-02'/);
  assert.match(app, /new URL\(config\.serviceHost, window\.location\.origin\)/);
  assert.match(app, /pathname !== '\/_AMapService'/);
  assert.match(app, /amap:\/\/styles\/whitesmoke/);
  assert.match(html, /runtime-config\.js/);
  assert.doesNotMatch(`${app}\n${html}`, /maplibre|openstreetmap|openfreemap/i);
  assert.doesNotMatch(css, /\.amap-logo\s*\{/);
});

test('administrative renderer owns marker lifecycle and limits collision adjustment to aggregates', () => {
  const app = fs.readFileSync(path.join(ROOT, 'private-amap/app.mjs'), 'utf8');

  assert.match(app, /displayMarkers/);
  assert.match(app, /clearDisplayMarkers/);
  assert.match(app, /marker\?\.setMap\?\.\(null\)/);
  assert.match(app, /item\.kind === 'administrative' \|\| item\.kind === 'same-site'/);
  assert.doesNotMatch(app, /context\.data|AMap\.MarkerCluster/);
});

test('Windows secret setup stores only environment variables and contains no embedded credential', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts/setup-private-amap-secrets.ps1'), 'utf8');
  assert.match(script, /SetEnvironmentVariable\('AMAP_JS_API_KEY'/);
  assert.match(script, /SetEnvironmentVariable\('AMAP_JS_SECURITY_CODE'/);
  assert.match(script, /Read-Host.+-AsSecureString/);
  assert.doesNotMatch(script, /\b[a-f0-9]{32}\b/i);
  assert.doesNotMatch(script, /Set-Content|Out-File|Add-Content/);
});

function fixtureDataset() {
  const records = Array.from({ length: 901 }, (_, index) => fixtureRecord(index + 2, {}));
  records[0] = fixtureRecord(2, {
    providerLat: 39.9042,
    providerLng: 116.4074,
    providerCrs: 'GCJ-02',
    lat: 39.8981,
    lng: 116.4012,
    mapCrs: 'WGS84',
    geocodeSource: 'amap:poi',
    geocodeConfidence: 'high',
    locationConfidence: 'high',
    identityConfidence: 'high',
    positionType: 'cinema-poi',
    locationGranularity: 'cinema'
  });
  records[1] = fixtureRecord(3, {
    providerLat: 31.2304,
    providerLng: 121.4737,
    providerCrs: 'WGS84',
    lat: 31.2304,
    lng: 121.4737,
    mapCrs: 'WGS84'
  });
  return {
    mode: 'local-preview',
    policy: {
      localOnly: true,
      amapCoordinatesIncluded: true,
      providerCacheIncluded: false
    },
    records
  };
}

function fixtureRecord(sourceRow, location) {
  return {
    id: `cinema-${sourceRow}`,
    sourceRow,
    name: `测试影院 ${sourceRow}`,
    formerNames: [],
    region: '中国大陆',
    province: '北京市',
    city: '北京',
    projection: {
      raw: 'IMAX Laser GT 3D 12声道',
      technology: 'Laser',
      system: 'GT Laser',
      is3D: true,
      audioChannels: 12,
      dome: false,
      film1570: null
    },
    screen: {
      width: null,
      height: null,
      area: null,
      rawWidth: '',
      rawHeight: '',
      rawArea: '',
      selectionConfidence: 'unknown'
    },
    seats: null,
    status: 'unknown',
    historySummary: '',
    location: {
      lat: null,
      lng: null,
      address: '',
      geocodeConfidence: 'unknown',
      geocodeSource: '',
      ...location
    }
  };
}

function createTestRoot() {
  const tmpRoot = path.join(ROOT, 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  return fs.mkdtempSync(path.join(tmpRoot, 'private-amap-test-'));
}

function removeTestRoot(testRoot) {
  const safePrefix = `${path.join(ROOT, 'tmp')}${path.sep}`;
  if (!testRoot.startsWith(safePrefix) || !path.basename(testRoot).startsWith('private-amap-test-')) {
    throw new Error(`Refusing to remove unsafe test directory: ${testRoot}`);
  }
  fs.rmSync(testRoot, { recursive: true, force: true });
}
