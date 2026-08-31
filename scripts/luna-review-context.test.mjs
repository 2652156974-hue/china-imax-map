import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isAcceptedReview, normalizeReview } from './complete-luna-review.mjs';

const ROOT = process.cwd();
const reviewPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/local/luna-geocode-review-323.json'), 'utf8'));
const rawSource = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/raw/arvin-imax.json'), 'utf8'));
const byRow = new Map(reviewPackage.records.map((record) => [record.sourceRow, record]));

test('accepted review is bound to the sourceRow cache candidate and source context', () => {
  const record = byRow.get(12);
  const normalized = normalizeReview(makeAcceptedReview(record), { recordContext: record });
  assert.equal(normalized.verdict, 'accept-exact');
  assert.equal(normalized.acceptedPoiId, record.candidate.poiId);
  assert.equal(isAcceptedReview(normalized, record), true);
});

test('current batch accepted reviews remain bound after strict normalization', () => {
  for (const sourceRow of [166, 171, 179, 181, 229, 269]) {
    const record = byRow.get(sourceRow);
    assert.ok(record, `missing current batch sourceRow ${sourceRow}`);
    const normalized = normalizeReview(record.review, { recordContext: record });
    assert.equal(normalized.verdict, record.review.verdict, `verdict ${sourceRow}`);
    assert.equal(normalized.acceptedPoiId, record.candidate.poiId, `poi ${sourceRow}`);
    assert.equal(isAcceptedReview(normalized, record), true, `context ${sourceRow}`);
  }
});

test('batch-005 correction accepts a cinema-level review for the whole cinema POI', () => {
  const record = byRow.get(513);
  assert.ok(record, 'missing sourceRow 513');
  const normalized = normalizeReview(record.review, { recordContext: record });
  assert.equal(normalized.verdict, 'accept-exact');
  assert.equal(normalized.locationGranularity, 'cinema');
  assert.equal(isAcceptedReview(normalized, record), true);
});

test('batch-005 correction accepts only the sourceRow-bound alternate cache candidate', () => {
  const record = byRow.get(540);
  assert.ok(record, 'missing sourceRow 540');
  const normalized = normalizeReview(record.review, { recordContext: record });
  assert.equal(normalized.verdict, 'accept-exact');
  assert.equal(normalized.acceptedPoiId, 'B0FFLEP1FM');
  assert.equal(isAcceptedReview(normalized, record), true);

  const wrong = structuredClone(record);
  wrong.review = {
    ...wrong.review,
    acceptedPoiId: 'B0FFJ84IND',
    reviewedCandidate: {
      ...wrong.review.reviewedCandidate,
      poiId: 'B0FFJ84IND',
      name: '杭州新天地寰耀影城',
      address: '新北街103号华盛达时代中心c座',
      providerLat: 30.326124,
      providerLng: 120.181548
    }
  };
  const downgraded = normalizeReview(wrong.review, { recordContext: wrong });
  assert.equal(downgraded.verdict, 'needs-more-evidence');
  assert.equal(downgraded.reviewSource, 'invalid-accept-downgraded');
  assert.match(downgraded.validationErrors.join('; '), /bound|candidate/i);
});

test('batch-008 accepted reviews remain bound to their sourceRow cache candidates', () => {
  const expected = new Map([
    [836, ['B0FFFN88CP', 'accept-exact', 'cinema']],
    [837, ['B0FFJN0QEV', 'accept-exact', 'cinema']],
    [852, ['B0GK1O2RE6', 'accept-exact', 'cinema']],
    [864, ['B00150C4B6', 'accept-location-only', 'venue']],
    [868, ['B0FFGYQKHI', 'accept-exact', 'cinema']],
    [872, ['B0019097N2', 'accept-location-only', 'venue']]
  ]);
  for (const [sourceRow, [poiId, verdict, granularity]] of expected) {
    const record = byRow.get(sourceRow);
    assert.ok(record, `missing batch-008 sourceRow ${sourceRow}`);
    const normalized = normalizeReview(record.review, { recordContext: record });
    assert.equal(normalized.verdict, verdict, `verdict ${sourceRow}`);
    assert.equal(normalized.acceptedPoiId, poiId, `poi ${sourceRow}`);
    assert.equal(normalized.locationGranularity, granularity, `granularity ${sourceRow}`);
    assert.equal(isAcceptedReview(normalized, record), true, `context ${sourceRow}`);
  }
});

test('batch-008 unresolved rows remain null and unaccepted', () => {
  for (const sourceRow of [832, 869, 885]) {
    const record = byRow.get(sourceRow);
    assert.ok(record, `missing batch-008 sourceRow ${sourceRow}`);
    const normalized = normalizeReview(record.review, { recordContext: record });
    assert.equal(normalized.verdict, 'needs-more-evidence', `verdict ${sourceRow}`);
    assert.equal(normalized.acceptedPoiId, null, `poi ${sourceRow}`);
    assert.equal(isAcceptedReview(normalized, record), false, `context ${sourceRow}`);
  }
});

test('batch-009 source-history fingerprints choose the older same-city branch', () => {
  const expected = new Map([
    [569, {
      poiId: 'B0FFG3EJP0',
      wrongPoiId: 'B0FFIE39NK',
      openingSignal: '2015年6月12日',
      rawWidth: '20.410 ',
      rawHeight: '11.144 ',
      seatsRaw: '373',
      requiresAdministrativeBinding: true
    }],
    [649, {
      poiId: 'B02520N9TY',
      wrongPoiId: 'B0I1ASB4XI',
      openingSignal: '2012年12月15日',
      rawWidth: '21.510\n21.710',
      rawHeight: '11.306\n11.332',
      seatsRaw: '348',
      requiresAdministrativeBinding: true
    }],
    [657, {
      poiId: 'B0FFHMID7A',
      wrongPoiId: 'B0J3BDXISR',
      openingSignal: '2012年11月28日',
      rawWidth: '21.710\n21.980\n20.323',
      rawHeight: '11.332\n11.446\n11.327',
      seatsRaw: '347',
      requiresAdministrativeBinding: false
    }]
  ]);

  for (const [sourceRow, fingerprint] of expected) {
    const record = byRow.get(sourceRow);
    const rawRecord = rawSource.rows[String(sourceRow)] ?? rawSource.rows[sourceRow];
    assert.ok(record, `missing batch-009 sourceRow ${sourceRow}`);
    assert.ok(rawRecord, `missing raw sourceRow ${sourceRow}`);
    const display = (column) => String(rawRecord.cells?.[column]?.displayValue ?? '');

    assert.match(display(2), new RegExp(fingerprint.openingSignal));
    assert.equal(display(3), fingerprint.rawWidth, `raw width ${sourceRow}`);
    assert.equal(display(4), fingerprint.rawHeight, `raw height ${sourceRow}`);
    assert.equal(display(6), fingerprint.seatsRaw, `raw seats ${sourceRow}`);

    const normalized = normalizeReview(record.review, { recordContext: record });
    assert.equal(normalized.verdict, 'accept-exact', `verdict ${sourceRow}`);
    assert.equal(normalized.acceptedPoiId, fingerprint.poiId, `POI ${sourceRow}`);
    assert.equal(normalized.positionType, 'cinema-poi', `position type ${sourceRow}`);
    assert.equal(normalized.locationGranularity, 'cinema', `granularity ${sourceRow}`);
    assert.equal(normalized.locationConfidence, 'high', `location confidence ${sourceRow}`);
    assert.equal(normalized.identityConfidence, 'high', `identity confidence ${sourceRow}`);
    assert.equal(isAcceptedReview(normalized, record), true, `context ${sourceRow}`);
    assert.deepEqual(
      record.reviewContext?.alternateCandidates?.map((candidate) => candidate.poiId),
      [fingerprint.poiId],
      `alternate binding ${sourceRow}`
    );
    assert.deepEqual(record.reviewContext?.disallowedPoiIds, [fingerprint.wrongPoiId], `wrong branch ${sourceRow}`);
    assert.equal(Boolean(normalized.administrativeBinding), fingerprint.requiresAdministrativeBinding, `admin binding ${sourceRow}`);

    const wrong = normalizeReview(makeAcceptedReview(record), { recordContext: record });
    assert.equal(wrong.verdict, 'needs-more-evidence', `wrong branch verdict ${sourceRow}`);
    assert.equal(wrong.reviewSource, 'invalid-accept-downgraded', `wrong branch source ${sourceRow}`);
    assert.match(wrong.validationErrors.join('; '), /explicitly disallowed/i, `wrong branch guard ${sourceRow}`);
  }
});

test('an unreviewed default needs-more-evidence remains unreviewed when normalized again', () => {
  const record = reviewPackage.records.find((candidate) => candidate.review?.reviewSource === 'unreviewed-default');
  assert.ok(record, 'expected at least one unreviewed default record');
  const normalized = normalizeReview(record.review, { recordContext: record });
  assert.equal(normalized.verdict, 'needs-more-evidence');
  assert.equal(normalized.explicitVerdict, false);
  assert.equal(normalized.reviewSource, 'unreviewed-default');
  assert.equal(normalized.acceptedPoiId, null);
});

test('serial-shift regression: Shanghai Science Museum cannot receive Nanjing candidate', () => {
  assertSerialShiftDowngrades(863, 872, 'B0019097N2');
});

test('serial-shift regression: Nanjing Science Museum cannot receive Taiyuan candidate', () => {
  assertSerialShiftDowngrades(872, 888, 'B0HU1AAO65');
});

test('serial-shift regression: Taiyuan cinema cannot receive Shanghai Science Museum candidate', () => {
  assertSerialShiftDowngrades(888, 864, 'B0M6AHZE91');
});

test('serial-shift regression: Guiyang Future Ark source cannot receive Guangzhou Huachenghui candidate', () => {
  assertSerialShiftDowngrades(757, 181, 'B00141OIRI');
});

test('same-prefecture duplicate regression: Suqian source cannot receive unbound Siyang branch', () => {
  const target = byRow.get(160);
  const normalized = normalizeReview(makeAcceptedReview(target), { recordContext: target });
  assert.equal(normalized.verdict, 'needs-more-evidence');
  assert.equal(normalized.reviewSource, 'invalid-accept-downgraded');
  assert.match(normalized.validationErrors.join('; '), /county-level candidate|same-prefecture duplicate/i);
  assert.equal(isAcceptedReview(normalized, target), false);
});

test('independent administrative binding can clear a false county-duplicate alarm without weakening the default guard', () => {
  for (const sourceRow of [519, 564]) {
    const record = byRow.get(sourceRow);
    assert.ok(record, `missing sourceRow ${sourceRow}`);
    const normalized = normalizeReview(record.review, { recordContext: record });
    assert.equal(normalized.verdict, 'accept-exact', `verdict ${sourceRow}`);
    assert.equal(normalized.administrativeBinding?.sourceRow, sourceRow, `binding sourceRow ${sourceRow}`);
    assert.equal(isAcceptedReview(normalized, record), true, `context ${sourceRow}`);

    const withoutBinding = structuredClone(record);
    delete withoutBinding.review.administrativeBinding;
    const downgraded = normalizeReview(withoutBinding.review, { recordContext: withoutBinding });
    assert.equal(downgraded.verdict, 'needs-more-evidence', `default guard ${sourceRow}`);
    assert.equal(downgraded.reviewSource, 'invalid-accept-downgraded', `default guard source ${sourceRow}`);
    assert.match(downgraded.validationErrors.join('; '), /county-level candidate|same-prefecture duplicate/i);
  }
});

test('same-county duplicate regression: Haimen source can use only the cache-bound Longxin branch', () => {
  const source = structuredClone(byRow.get(146));
  const alternate = {
    poiId: 'B0FFJN3EQU',
    name: '幸福蓝海国际影城(龙信广场购物中心店)',
    address: '长江南路99号龙信广场4层',
    pname: '江苏',
    cityname: '南通',
    adname: '海门',
    positionType: 'cinema-poi',
    locationGranularity: 'cinema',
    adminMatch: { compatible: true, targetProvince: '江苏', targetPrefecture: '南通', targetCounty: '海门', providerProvince: '江苏', providerPrefecture: '南通', providerCounty: '海门' },
    formatCompatibility: { compatible: true, exactFormatMatch: false, conflicts: [] },
    providerCoordinate: { crs: 'GCJ-02', lat: 31.880089, lng: 121.184414 }
  };
  source.reviewContext = { alternateCandidates: [alternate], disallowedPoiIds: [source.candidate.poiId] };
  const accepted = normalizeReview({
    verdict: 'accept-exact',
    acceptedPoiId: alternate.poiId,
    reviewedCandidate: { provider: 'amap', poiId: alternate.poiId, name: alternate.name, address: alternate.address, providerCrs: 'GCJ-02', providerLat: alternate.providerCoordinate.lat, providerLng: alternate.providerCoordinate.lng },
    positionType: alternate.positionType,
    locationGranularity: alternate.locationGranularity,
    locationConfidence: 'high',
    identityConfidence: 'high',
    evidenceUrls: ['https://example.org/longxin-independent-evidence'],
    reviewer: 'context-regression-fixture',
    reviewedAt: '2026-08-21T00:00:00.000Z'
  }, { recordContext: source });
  assert.equal(accepted.verdict, 'accept-exact');
  assert.equal(accepted.acceptedPoiId, alternate.poiId);
  assert.equal(isAcceptedReview(accepted, source), true);

  const topRejected = normalizeReview(makeAcceptedReview(source), { recordContext: source });
  assert.equal(topRejected.verdict, 'needs-more-evidence');
  assert.equal(topRejected.reviewSource, 'invalid-accept-downgraded');
  assert.match(topRejected.validationErrors.join('; '), /explicitly disallowed|bound/i);
});

function assertSerialShiftDowngrades(targetRow, candidateRow, expectedPoiId) {
  const target = byRow.get(targetRow);
  const wrongSource = byRow.get(candidateRow);
  assert.ok(target, `missing target sourceRow ${targetRow}`);
  assert.ok(wrongSource, `missing candidate sourceRow ${candidateRow}`);
  assert.equal(wrongSource.candidate.poiId, expectedPoiId);
  const normalized = normalizeReview(makeAcceptedReview(wrongSource), { recordContext: target });
  assert.equal(normalized.verdict, 'needs-more-evidence');
  assert.equal(normalized.reviewSource, 'invalid-accept-downgraded');
  assert.equal(normalized.acceptedPoiId, null);
  assert.equal(isAcceptedReview(normalized, target), false);
  assert.match(normalized.validationErrors.join('; '), /sourceRow|province|city|bound/i);
}

function makeAcceptedReview(record) {
  const candidate = record.candidate;
  const exact = candidate.positionType === 'cinema-poi' &&
    ['auditorium', 'cinema'].includes(candidate.locationGranularity);
  return {
    verdict: exact ? 'accept-exact' : 'accept-location-only',
    acceptedPoiId: candidate.poiId,
    reviewedCandidate: {
      provider: 'amap',
      poiId: candidate.poiId,
      name: candidate.name,
      address: candidate.address,
      providerCrs: candidate.providerCoordinate.crs,
      providerLat: candidate.providerCoordinate.lat,
      providerLng: candidate.providerCoordinate.lng
    },
    positionType: candidate.positionType,
    locationGranularity: candidate.locationGranularity,
    locationConfidence: 'high',
    identityConfidence: exact ? 'high' : 'medium',
    evidenceUrls: ['https://example.org/independent-context-regression-evidence'],
    reviewer: 'context-regression-fixture',
    reviewedAt: '2026-08-21T00:00:00.000Z',
    notes: 'Context-bound validator regression fixture.'
  };
}
