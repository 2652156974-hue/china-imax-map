import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { createPublicAmapServer, loadPublicServerConfig, selectMarkers, runtimeConfigScript } from './public-amap-server.mjs';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'china-imax-map-server-test-'));
const testLayerFile = path.join(testDir, 'reviewed-layer.json');
const testDist = path.join(testDir, 'dist-public');
fs.mkdirSync(testDist);
fs.copyFileSync(path.join(process.cwd(), 'index.html'), path.join(testDist, 'index.html'));
fs.writeFileSync(testLayerFile, JSON.stringify(createTestLayer()), 'utf8');
after(() => fs.rmSync(testDir, { recursive: true, force: true }));

test('public marker service returns only requested minimal AMap GCJ-02 records', async (t) => {
  const config = loadPublicServerConfig({
    PUBLIC_AMAP_HOST: '127.0.0.1',
    PUBLIC_AMAP_PORT: '0',
    AMAP_JS_API_KEY: 'browser-key-for-test',
    AMAP_JS_SECURITY_CODE: 'server-security-code-for-test',
    PUBLIC_AMAP_REVIEWED_FILE: testLayerFile,
    PUBLIC_AMAP_DIST: testDist
  });
  assert.equal(selectMarkers(config, []).length, 0);
  const locatedRow = config.markerLayer.records.find((record) => record.provider === 'amap');
  assert.ok(locatedRow);
  const selected = selectMarkers(config, [locatedRow.sourceRow]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].sourceRow, locatedRow.sourceRow);
  assert.equal(selected[0].id, locatedRow.id);
  assert.equal(selected[0].providerCrs, 'GCJ-02');
  assert.equal(Object.hasOwn(selected[0], 'rawCandidates'), false);
  assert.equal(Object.hasOwn(selected[0], 'address'), false);

  const server = createPublicAmapServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const root = await fetch(`${origin}/`);
  assert.equal(root.status, 200);
  assert.match(await root.text(), /AMap JS API 2\.0/);

  const runtime = await fetch(`${origin}/runtime-config.js`);
  const runtimeText = await runtime.text();
  assert.equal(runtime.status, 200);
  assert.match(runtimeText, /browser-key-for-test/);
  assert.doesNotMatch(runtimeText, /server-security-code-for-test/);

  const markerResponse = await fetch(`${origin}/api/public/markers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceRows: [locatedRow.sourceRow] })
  });
  const markerBody = await markerResponse.json();
  assert.equal(markerResponse.status, 200);
  assert.equal(markerBody.records.length, 1);
  assert.equal(markerBody.records[0].sourceRow, locatedRow.sourceRow);
  assert.equal(markerBody.records[0].providerCrs, 'GCJ-02');

  const getMarkers = await fetch(`${origin}/api/public/markers`);
  assert.equal(getMarkers.status, 405);
});

test('public server runtime config never exposes the security code', () => {
  const script = runtimeConfigScript({ amapJsKey: 'browser-key', amapSecurityCode: 'secret-code' });
  assert.match(script, /browser-key/);
  assert.match(script, /_AMapService/);
  assert.doesNotMatch(script, /secret-code/);
});

test('local Node runtime accepts an explicit host and platform-style port', () => {
  const config = loadPublicServerConfig({
    PUBLIC_AMAP_HOST: '0.0.0.0',
    PORT: '10000',
    AMAP_JS_API_KEY: 'browser-key-for-test',
    AMAP_JS_SECURITY_CODE: 'server-security-code-for-test',
    PUBLIC_AMAP_REVIEWED_FILE: testLayerFile,
    PUBLIC_AMAP_DIST: testDist
  });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 10000);
});

function createTestLayer() {
  return {
    mode: 'public-amap-reviewed-layer',
    coordinateSystem: 'GCJ-02',
    policy: { localOnly: true },
    records: Array.from({ length: 901 }, (_, index) => ({
      sourceRow: index + 2,
      id: `test-${index + 2}`,
      provider: 'amap',
      providerPoiId: `poi-${index + 2}`,
      providerLat: 20 + (index % 30) / 100,
      providerLng: 110 + (index % 50) / 100,
      providerCrs: 'GCJ-02',
      positionType: 'cinema-poi',
      locationGranularity: 'cinema',
      locationConfidence: 'high',
      identityConfidence: 'high',
      decisionOrigin: 'test-fixture',
      reviewVerdict: 'accept-exact'
    }))
  };
}
