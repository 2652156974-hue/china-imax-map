import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAmapProxyTarget, handleRequest } from '../worker/index.mjs';

function runtimeLayer() {
  return {
    schemaVersion: 1,
    mode: 'public-amap-marker-layer',
    coordinateSystem: 'GCJ-02',
    sourceRowKey: true,
    records: Array.from({ length: 901 }, (_, index) => {
      const sourceRow = index + 2;
      return {
        sourceRow,
        id: `imax-cn-${String(sourceRow).padStart(4, '0')}`,
        provider: 'amap',
        providerPoiId: `B${String(sourceRow).padStart(9, '0')}`,
        providerLat: 20 + (index % 20) / 10,
        providerLng: 100 + (index % 30) / 10,
        providerCrs: 'GCJ-02',
        positionType: 'cinema-poi',
        locationGranularity: 'cinema',
        locationConfidence: 'high',
        identityConfidence: 'high',
        decisionOrigin: 'automatic-high',
        reviewVerdict: 'accepted-high',
        administrative: {
          provinceName: '测试省',
          provinceCode: '990000',
          prefectureName: '测试市',
          prefectureCode: '990100',
          prefectureLevel: 'prefecture',
          countyName: '测试区',
          countyCode: '990101',
          countyLevel: 'district',
          source: 'test'
        }
      };
    })
  };
}

function envFor(layer = runtimeLayer()) {
  return {
    AMAP_JS_API_KEY: 'browser-key-for-worker-test',
    AMAP_JS_SECURITY_CODE: 'worker-secret-for-test',
    MARKER_OBJECT_KEY: 'public-amap-markers',
    RUNTIME_KV: {
      async get(key) {
        assert.equal(key, 'public-amap-markers');
        return JSON.stringify(layer);
      }
    },
    ASSETS: {
      async fetch() {
        return new Response('<!doctype html><title>fixture</title>', {
          headers: { 'content-type': 'text/html' }
        });
      }
    }
  };
}

test('Worker serves static fallback, runtime config, and the requested minimal marker layer', async () => {
  const env = envFor();
  const root = await handleRequest(new Request('https://china-imax-map.example/'), env);
  assert.equal(root.status, 200);
  assert.equal(root.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(root.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=(self)');
  assert.match(await root.text(), /fixture/);

  const config = await handleRequest(new Request('https://china-imax-map.example/runtime-config.js'), env);
  const configText = await config.text();
  assert.equal(config.status, 200);
  assert.match(configText, /browser-key-for-worker-test/);
  assert.doesNotMatch(configText, /worker-secret-for-test/);

  const marker = await handleRequest(new Request('https://china-imax-map.example/api/public/markers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceRows: [2, 902, 2] })
  }), env);
  const markerBody = await marker.json();
  assert.equal(marker.status, 200);
  assert.equal(markerBody.records.length, 2);
  assert.equal(markerBody.records[0].sourceRow, 2);
  assert.equal(markerBody.records[1].sourceRow, 902);
  assert.equal(markerBody.records[0].providerCrs, 'GCJ-02');
  assert.equal(markerBody.records[0].administrative.countyName, '测试区');
  assert.equal(Object.hasOwn(markerBody.records[0].administrative, 'rawCandidates'), false);
  assert.equal(Object.hasOwn(markerBody.records[0], 'address'), false);

  const getMarkers = await handleRequest(new Request('https://china-imax-map.example/api/public/markers'), env);
  assert.equal(getMarkers.status, 405);
});

test('Worker returns structured failures for unavailable or oversized marker requests', async () => {
  const unavailable = await handleRequest(new Request('https://china-imax-map.example/api/public/markers', {
    method: 'POST',
    body: JSON.stringify({ sourceRows: [2] })
  }), envFor(null));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: { code: 'runtime_unavailable', message: 'Runtime marker data is unavailable.' } });

  const oversized = await handleRequest(new Request('https://china-imax-map.example/api/public/markers', {
    method: 'POST',
    body: JSON.stringify({ sourceRows: [], padding: 'x'.repeat(70 * 1024) })
  }), envFor());
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: { code: 'request_too_large', message: 'Request body is too large.' } });
});

test('AMap proxy only targets approved hosts and replaces a caller-supplied jscode', () => {
  const restTarget = buildAmapProxyTarget(new URL('https://china-imax-map.example/_AMapService/v3/place/text?keywords=imax&jscode=attacker'), 'server-secret');
  assert.equal(restTarget.origin, 'https://restapi.amap.com');
  assert.equal(restTarget.searchParams.get('jscode'), 'server-secret');
  assert.equal(restTarget.searchParams.get('keywords'), 'imax');

  const styleTarget = buildAmapProxyTarget(new URL('https://china-imax-map.example/_AMapService/v4/map/styles/whitesmoke?x=1'), 'server-secret');
  assert.equal(styleTarget.origin, 'https://webapi.amap.com');
  assert.equal(styleTarget.searchParams.get('jscode'), 'server-secret');

  assert.throws(() => buildAmapProxyTarget(new URL('https://china-imax-map.example/_AMapService//evil'), 'server-secret'));
  assert.throws(() => buildAmapProxyTarget(new URL('https://china-imax-map.example/_AMapService/v2/anything'), 'server-secret'));
});
