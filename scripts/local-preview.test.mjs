import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalPreviewDocument } from './local-preview.mjs';

const derived = {
  records: Array.from({ length: 901 }, (_, index) => ({
    id: `cinema-${index + 2}`,
    sourceRow: index + 2,
    name: `影院${index + 2}`,
    location: { lat: null, lng: null, geocodeConfidence: 'unknown', geocodeSource: '' },
  })),
};

const mainlandAudit = {
  records: [
    {
      sourceRow: 2,
      overrideUsed: false,
      selected: {
        poiId: 'poi-2',
        address: '测试地址',
        positionType: 'cinema-poi',
        locationGranularity: 'cinema',
        automaticDecision: 'accepted-high',
        locationConfidence: 'high',
        identityConfidence: 'high',
        confidence: 'high',
        geocodeSource: 'amap:poi-search',
        provider: { providerCrs: 'GCJ-02', providerLat: 31.2, providerLng: 121.4 },
        map: { mapCrs: 'WGS84', lat: 31.19, lng: 121.39 },
      },
    },
    {
      sourceRow: 3,
      overrideUsed: false,
      selected: {
        automaticDecision: 'review-required-medium',
        provider: { providerCrs: 'GCJ-02', providerLat: 31.2, providerLng: 121.4 },
        map: { mapCrs: 'WGS84', lat: 31.19, lng: 121.39 },
      },
    },
  ],
};

test('local preview materializes only accepted-high selected evidence', () => {
  const document = buildLocalPreviewDocument({ derived, mainlandAudit, generatedAt: '2026-08-21T00:00:00.000Z' });
  assert.equal(document.mode, 'local-preview');
  assert.equal(document.status, 'LOCAL PREVIEW · NOT FOR PUBLICATION');
  assert.equal(document.records.length, 901);
  assert.equal(document.coordinatesPublished, 1);
  assert.deepEqual(document.records[0].location, {
    lat: 31.19,
    lng: 121.39,
    providerLat: 31.2,
    providerLng: 121.4,
    providerCrs: 'GCJ-02',
    mapCrs: 'WGS84',
    address: '测试地址',
    positionType: 'cinema-poi',
    locationGranularity: 'cinema',
    locationConfidence: 'high',
    identityConfidence: 'high',
    geocodeConfidence: 'high',
    geocodeSource: 'amap:poi-search',
    providerPoiId: 'poi-2',
    previewEvidenceClass: 'automatic-high',
  });
  assert.equal(document.records[1].location.lat, null);
  assert.equal(document.policy.localOnly, true);
  assert.equal(document.policy.amapRawCandidatesIncluded, false);
  assert.equal(JSON.stringify(document).includes('rawCandidates'), false);
});
