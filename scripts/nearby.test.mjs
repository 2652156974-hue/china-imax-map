import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNearbyCandidateSet,
  formatDistanceKm,
  geolocationFailureMessage,
  haversineKm,
  readAmapGeolocationResult,
  reliableScreenField,
  reliableScreenMeasure,
  screenMeasureLabel,
  sortNearbyCandidates
} from '../nearby.mjs';

function cinema(id, city, lat, lng, overrides = {}) {
  return {
    id,
    name: `${city}${id}`,
    city,
    location: { providerLat: lat, providerLng: lng, providerCrs: 'GCJ-02' },
    projection: { system: 'Commercial Laser', dome: false, audioChannels: null },
    screen: { width: null, height: null, area: null, rawWidth: '', rawHeight: '', rawArea: '', selectionConfidence: 'unknown' },
    ...overrides
  };
}

const userChengdu = { position: { lat: 30.67, lng: 104.06 }, city: '成都市' };

test('known city with enough cinemas never admits distant high-spec cities', () => {
  const records = [
    cinema('cd-1', '成都', 30.67, 104.06),
    cinema('cd-2', '成都', 30.70, 104.08),
    cinema('cd-3', '成都', 30.65, 104.10),
    cinema('gy-gt', '贵阳', 26.65, 106.63, { projection: { system: 'GT Laser', dome: false, audioChannels: 12 } }),
    cinema('xa-gt', '西安', 34.34, 108.94, { projection: { system: 'GT Laser', dome: false, audioChannels: 12 } }),
    cinema('cq-gt', '重庆', 29.56, 106.55, { projection: { system: 'GT Laser', dome: false, audioChannels: 12 } })
  ];
  const result = buildNearbyCandidateSet(records, userChengdu);
  assert.deepEqual(result.records.map((record) => record.id), ['cd-1', 'cd-2', 'cd-3']);
  assert.equal(result.scopeLabel, '成都 · 3 家 IMAX');
  assert.equal(result.nextRangeKm, 80);
});

test('city with fewer than three cinemas supplements only other cities within 80 km', () => {
  const records = [
    cinema('xm-1', '厦门', 24.48, 118.08),
    cinema('qz-1', '泉州', 24.87, 118.67),
    cinema('fz-1', '福州', 26.07, 119.30)
  ];
  const result = buildNearbyCandidateSet(records, { position: { lat: 24.48, lng: 118.08 }, city: '厦门市' });
  assert.deepEqual(result.records.map((record) => record.id), ['xm-1', 'qz-1']);
  assert.equal(result.hasNeighbor, true);
  assert.equal(result.scopeLabel, '厦门及 80 km 内 · 2 家 IMAX');
  assert.equal(result.records.every((record) => record.distanceKm <= 80), true);
});

test('missing city falls back from 50 km to 80 km and never past 120 km', () => {
  const records = [
    cinema('near-1', '甲', 31.10, 121),
    cinema('near-2', '乙', 31.20, 121),
    cinema('mid-1', '丙', 31.60, 121),
    cinema('far-1', '丁', 32.00, 121)
  ];
  const result = buildNearbyCandidateSet(records, { position: { lat: 31, lng: 121 } });
  assert.equal(result.cityKnown, false);
  assert.equal(result.radiusKm, 80);
  assert.deepEqual(result.records.map((record) => record.id), ['near-1', 'near-2', 'mid-1']);
  assert.equal(result.nextRangeKm, 120);
  const expanded = buildNearbyCandidateSet(records, { position: { lat: 31, lng: 121 } }, { rangeKm: 120 });
  assert.equal(expanded.records.some((record) => record.id === 'far-1'), true);
  assert.equal(expanded.records.every((record) => record.distanceKm <= 120), true);
});

test('distance sorting is ascending and uses bounded GCJ-02 coordinates', () => {
  const records = [
    cinema('far', '成都', 30.80, 104.06),
    cinema('near', '成都', 30.68, 104.06),
    cinema('mid', '成都', 30.72, 104.06)
  ].map((record) => ({ ...record, distanceKm: haversineKm({ lat: 30.67, lng: 104.06 }, record) }));
  const sorted = sortNearbyCandidates(records, 'distance');
  assert.deepEqual(sorted.map((record) => record.id), ['near', 'mid', 'far']);
  assert.equal(formatDistanceKm(sorted[0].distanceKm).endsWith('km'), true);
});

test('screen sorting prefers reliable area, then reliable width, and never selects a raw multi-value maximum', () => {
  const area = cinema('area', '成都', 30.67, 104.06, {
    screen: { area: 220, width: 20, rawArea: '220.0000', rawWidth: '20.000', selectionConfidence: 'high' }
  });
  const width = cinema('width', '成都', 30.67, 104.06, {
    screen: { area: null, width: 40, rawArea: '\u00a0', rawWidth: '40.000', selectionConfidence: 'high' }
  });
  const multi = cinema('multi', '成都', 30.67, 104.06, {
    screen: { area: null, width: null, rawArea: '100\n500', rawWidth: '20\n30', selectionConfidence: 'unknown' }
  });
  const sorted = sortNearbyCandidates([multi, width, area], 'screen');
  assert.deepEqual(sorted.map((record) => record.id), ['area', 'width', 'multi']);
  assert.equal(reliableScreenMeasure(multi), null);
});

test('spec sorting uses projection tier, screen size, then audio, with Dome kept independent', () => {
  const base = { screen: { area: 200, width: 20, rawArea: '200', rawWidth: '20', selectionConfidence: 'high' } };
  const records = [
    cinema('dome', '成都', 30.67, 104.06, { projection: { system: 'GT Laser', dome: true, audioChannels: 12 }, screen: { area: 9999, width: 90, rawArea: '9999', rawWidth: '90', selectionConfidence: 'high' } }),
    cinema('unknown', '成都', 30.67, 104.06, { projection: { system: 'unknown', dome: false, audioChannels: null }, ...base }),
    cinema('xenon', '成都', 30.67, 104.06, { projection: { system: 'Xenon', dome: false, audioChannels: null }, ...base }),
    cinema('xt', '成都', 30.67, 104.06, { projection: { system: 'Laser XT', dome: false, audioChannels: null }, ...base }),
    cinema('commercial', '成都', 30.67, 104.06, { projection: { system: 'Commercial Laser', dome: false, audioChannels: 12 }, ...base }),
    cinema('gt', '成都', 30.67, 104.06, { projection: { system: 'GT Laser', dome: false, audioChannels: null }, ...base }),
    cinema('commercial-unknown-audio', '成都', 30.67, 104.06, { projection: { system: 'Commercial Laser', dome: false, audioChannels: null }, ...base })
  ];
  const sorted = sortNearbyCandidates(records, 'spec');
  assert.deepEqual(sorted.slice(0, 5).map((record) => record.id), ['gt', 'commercial', 'commercial-unknown-audio', 'xt', 'xenon']);
  assert.ok(sorted.findIndex((record) => record.id === 'commercial') < sorted.findIndex((record) => record.id === 'dome'));
  assert.equal(sorted.at(-1).id, 'dome');
});

test('display helpers distinguish normal, blank, NBSP, multi-value, and abnormal fields', () => {
  const normal = { area: 226.765, rawArea: '226.7650', width: 20.9, rawWidth: '20.900', selectionConfidence: 'high' };
  assert.equal(reliableScreenField(normal, 'width').value, 20.9);
  assert.equal(screenMeasureLabel({ screen: normal }), '226.77 m²');
  assert.equal(reliableScreenField({ area: null, rawArea: '', selectionConfidence: 'high' }, 'area'), null);
  assert.equal(reliableScreenField({ area: null, rawArea: '\u00a0', selectionConfidence: 'high' }, 'area'), null);
  assert.equal(reliableScreenField({ area: null, rawArea: '12\n15', selectionConfidence: 'unknown' }, 'area'), null);
  assert.equal(reliableScreenField({ area: 12, rawArea: '12（自测）', selectionConfidence: 'high' }, 'area'), null);
});

test('AMap geolocation success, permission rejection, timeout, and missing city are handled without coordinate conversion', () => {
  const success = readAmapGeolocationResult('complete', {
    position: { lat: 30.67, lng: 104.06 },
    addressComponent: { city: '成都市' },
    accuracy: 30
  });
  assert.equal(success.ok, true);
  assert.deepEqual(success.position, { lat: 30.67, lng: 104.06 });
  assert.equal(success.city, '成都');
  assert.match(geolocationFailureMessage('error', { info: 'PERMISSION_DENIED' }), /可继续搜索/);
  assert.match(geolocationFailureMessage('timeout', {}), /超时/);
  const noCity = readAmapGeolocationResult('complete', { position: { lat: 30.67, lng: 104.06 } });
  assert.equal(noCity.ok, true);
  assert.equal(noCity.city, '');
});
