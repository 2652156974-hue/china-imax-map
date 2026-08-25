import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicAmapServer, loadPublicServerConfig, selectMarkers, runtimeConfigScript } from './public-amap-server.mjs';

test('public marker service returns only requested minimal AMap GCJ-02 records', async (t) => {
  const config = loadPublicServerConfig({
    PUBLIC_AMAP_HOST: '127.0.0.1',
    PUBLIC_AMAP_PORT: '0',
    AMAP_JS_API_KEY: 'browser-key-for-test',
    AMAP_JS_SECURITY_CODE: 'server-security-code-for-test'
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
