import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coordinateCount,
  createDataAdapter,
  hasPublicationSafeCoordinates,
  hasUsableCoordinate,
  isLocalPreviewDataset,
  isPublicationSafeDataset
} from './map-data-adapter.mjs';

const response = (data, ok = true, status = 200) => ({ ok, status, async json() { return data; } });

const publicBase = {
  schemaVersion: 1,
  dataset: 'arvin-imax-public-cinemas',
  mode: 'public-amap-runtime',
  mapProvider: 'AMap JS API 2.0',
  coordinateSystem: 'GCJ-02',
  runtimeMarkerCount: 1,
  policy: {
    amapCoordinatesIncluded: false,
    runtimeAmapCoordinatesIncluded: true,
    amapRawCandidatesIncluded: false,
    providerCacheIncluded: false,
    rawTencentSnapshotIncluded: false
  },
  records: [{ location: { lat: null, lng: null } }]
};

const localBase = {
  schemaVersion: 1,
  dataset: 'arvin-imax-local-preview-cinemas',
  mode: 'local-preview',
  publicationGate: 'BLOCKED_LOCAL_ONLY',
  policy: { localOnly: true, amapCoordinatesIncluded: true, amapRawCandidatesIncluded: false, providerCacheIncluded: false },
  records: [{ location: { providerLat: 31.2, providerLng: 121.4, providerCrs: 'GCJ-02' } }]
};

test('public AMap runtime fact layer is safe and has runtime marker coverage', async () => {
  assert.equal(isPublicationSafeDataset(publicBase), true);
  assert.equal(hasPublicationSafeCoordinates(publicBase), true);
  assert.equal(coordinateCount(publicBase), 0);
  const calls = [];
  const adapter = createDataAdapter({ fetchImpl: async (url) => { calls.push(url); return response(publicBase); } });
  const result = await adapter.load();
  assert.equal(result.mode, 'public-amap-runtime');
  assert.deepEqual(calls, ['./data/public/cinemas.json']);
});

test('public adapter refuses static provider coordinates or raw candidates', () => {
  assert.equal(isPublicationSafeDataset({ ...publicBase, records: [{ location: { providerLat: 31.2 } }] }), false);
  assert.equal(isPublicationSafeDataset({ ...publicBase, rawCandidates: [] }), false);
});

test('local preview remains an explicit local-only diagnostic path', async () => {
  assert.equal(isLocalPreviewDataset(localBase), true);
  const calls = [];
  const adapter = createDataAdapter({ localPreview: true, fetchImpl: async (url) => { calls.push(url); return response(url.includes('/local/') ? localBase : { ...publicBase, mode: 'not-public' }); } });
  const result = await adapter.load();
  assert.equal(result.mode, 'local-preview');
  assert.equal(coordinateCount(result.data), 1);
  assert.deepEqual(calls, ['./data/public/cinemas.json', './data/local/cinemas-preview.json']);
});

test('coordinate helper only accepts bounded coordinates', () => {
  assert.equal(hasUsableCoordinate({ location: { providerLat: 31.2, providerLng: 121.4, providerCrs: 'GCJ-02' } }), true);
  assert.equal(hasUsableCoordinate({ location: { lat: 31.2, lng: 121.4 } }), true);
  assert.equal(hasUsableCoordinate({ location: { providerLat: 200, providerLng: 121.4, providerCrs: 'GCJ-02' } }), false);
});
