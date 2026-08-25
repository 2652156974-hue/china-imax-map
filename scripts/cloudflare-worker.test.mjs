import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAmapProxyTarget, createWorker } from '../worker/index.mjs';

function runtimeLayer() {
  return {
    schemaVersion: 1,
    mode: 'public-amap-marker-layer',
    coordinateSystem: 'GCJ-02',
    sourceRowKey: true,
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

function envFor() {
  return {
    AMAP_JS_API_KEY: 'browser-key-for-worker-test',
    AMAP_JS_SECURITY_CODE: 'worker-secret-for-test',
    ASSETS: {
      async fetch() {
        return new Response('<!doctype html><title>fixture</title>', { headers: { 'content-type': 'text/html' } });
      }
    }
  };
}

test('Worker serves static fallback, runtime config, and a minimal 901-row marker layer', async () => {
  const env = envFor();
  const worker = createWorker(runtimeLayer());
  const root = await worker.fetch(new Request('https://china-imax-map.example/'), env);
  assert.equal(root.status, 200);
  assert.equal(root.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await root.text(), /fixture/);

  const config = await worker.fetch(new Request('https://china-imax-map.example/runtime-config.js'), env);
  const configText = await config.text();
  assert.equal(config.status, 200);
  assert.match(configText, /browser-key-for-worker-test/);
  assert.doesNotMatch(configText, /worker-secret-for-test/);

  const marker = await worker.fetch(new Request('https://china-imax-map.example/api/public/markers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceRows: [2, 902, 2] })
  }), env);
  const markerBody = await marker.json();
  assert.equal(marker.status, 200);
  assert.equal(markerBody.records.length, 2);
  assert.deepEqual(markerBody.records.map((record) => record.sourceRow), [2, 902]);
  assert.equal(Object.hasOwn(markerBody.records[0], 'rawCandidates'), false);
  assert.equal(Object.hasOwn(markerBody.records[0], 'address'), false);
});

test('Worker bounds marker request bodies and returns structured errors', async () => {
  const oversized = JSON.stringify({ sourceRows: [], padding: 'x'.repeat(70 * 1024) });
  const worker = createWorker(runtimeLayer());
  const env = envFor();
  const response = await worker.fetch(new Request('https://china-imax-map.example/api/public/markers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: oversized
  }), env);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: { code: 'request_too_large', message: 'Request body is too large.' } });

  const missing = await createWorker(null).fetch(new Request('https://china-imax-map.example/api/public/markers', {
    method: 'POST', body: JSON.stringify({ sourceRows: [2] })
  }), env);
  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { error: { code: 'runtime_unavailable', message: 'Runtime marker data is unavailable.' } });
});

test('AMap proxy target is restricted to the two approved hosts and overwrites client jscode', async () => {
  const target = buildAmapProxyTarget(new URL('https://china-imax-map.example/_AMapService/v3/place/text?keywords=imax&jscode=client'), 'worker-secret-for-test');
  assert.equal(target.origin, 'https://restapi.amap.com');
  assert.equal(target.searchParams.get('jscode'), 'worker-secret-for-test');
  assert.equal(target.searchParams.get('keywords'), 'imax');

  const originalFetch = globalThis.fetch;
  let requested;
  globalThis.fetch = async (input) => {
    requested = String(input);
    return new Response('{"status":"1"}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await createWorker(runtimeLayer()).fetch(new Request('https://china-imax-map.example/_AMapService/v3/place/text?keywords=imax'), envFor());
    assert.equal(response.status, 200);
    assert.match(requested, /^https:\/\/restapi\.amap\.com\//);
    assert.match(requested, /jscode=worker-secret-for-test/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
