import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const publicData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/public/cinemas.json'), 'utf8'));
const layer = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/local/public-amap-reviewed-geocodes.json'), 'utf8'));
const privateLayer = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/local/private-reviewed-geocodes.json'), 'utf8'));
const completedReview = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/local/luna-geocode-review-323.completed.json'), 'utf8'));
const humanVerificationResultsDocument = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/human-verification-results.json'), 'utf8'));
const humanVerificationResults = Array.isArray(humanVerificationResultsDocument)
  ? humanVerificationResultsDocument
  : humanVerificationResultsDocument.results;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.mjs'), 'utf8');
const navigationCoordinator = fs.readFileSync(path.join(ROOT, 'navigation-coordinator.mjs'), 'utf8');

test('public dataset is a 901-row AMap runtime fact layer', () => {
  assert.equal(publicData.records.length, 901);
  assert.equal(publicData.mode, 'public-amap-runtime');
  assert.equal(publicData.mapProvider, 'AMap JS API 2.0');
  assert.equal(publicData.coordinateSystem, 'GCJ-02');
  assert.equal(publicData.coordinatesPublished, 0);
  assert.equal(publicData.runtimeMarkerCount, layer.summary.accepted);
  assert.equal(publicData.markerService.path, '/api/public/markers');
  assert.equal(publicData.source.tabId, 'BB08J2');
  assert.equal(Object.hasOwn(publicData.policy, 'amapRawCandidatesIncluded'), false);
  assert.equal(publicData.policy.providerCacheIncluded, false);
  assert.equal(publicData.policy.rawTencentSnapshotIncluded, false);
});

test('public static data has no coordinates and preserves all 3604 raw fields', () => {
  const serialized = JSON.stringify(publicData);
  assert.equal(serialized.includes('rawCandidates'), false);
  assert.equal(serialized.includes('providerLat'), false);
  assert.equal(serialized.includes('providerLng'), false);
  assert.equal(publicData.records.every((record) => record.location.lat === null && record.location.lng === null), true);
  assert.equal(publicData.records.every((record) =>
    typeof record.screen.rawWidth === 'string' && typeof record.screen.rawHeight === 'string' &&
    typeof record.screen.rawArea === 'string' && typeof record.seatsRaw === 'string'), true);
  const derived = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/derived/cinemas.json'), 'utf8'));
  const derivedByRow = new Map(derived.records.map((record) => [record.sourceRow, record]));
  let matches = 0;
  for (const record of publicData.records) {
    const source = derivedByRow.get(record.sourceRow);
    for (const field of ['rawWidth', 'rawHeight', 'rawArea']) {
      assert.equal(record.screen[field], source.screen[field]);
      matches += 1;
    }
    assert.equal(record.seatsRaw, source.seatsRaw);
    matches += 1;
  }
  assert.equal(matches, 3604);
});

test('public facts retain only minimal screen-seat materialization provenance', () => {
  const reviewed = publicData.records.filter((record) => record.screenSeatReview);
  assert.equal(reviewed.length, 2);
  assert.equal(reviewed.every((record) =>
    Object.keys(record.screenSeatReview).sort().join('|') === 'confidence|materializedFields' &&
    record.screenSeatReview.confidence === 'high' &&
    record.screenSeatReview.materializedFields.length > 0), true);
  assert.equal(JSON.stringify(reviewed).includes('decisionNote'), false);
  assert.equal(JSON.stringify(reviewed).includes('sourceUrls'), false);
});

test('public reviewed layer exposes only minimal dynamic AMap GCJ-02 decisions', () => {
  assert.equal(layer.records.length, publicData.records.length);
  assert.equal(layer.summary.total, layer.records.length);
  assert.equal(layer.summary.accepted + layer.summary.unresolvedPublic, layer.records.length);
  assert.equal(layer.policy.localOnly, true);
  assert.equal(layer.policy.providerCacheIncluded, false);
  assert.equal(Object.hasOwn(layer.policy, 'rawCandidatesIncluded'), false);
  assert.equal(JSON.stringify(layer).includes('rawCandidates'), false);
  const administrativeFields = [
    'provinceName', 'provinceCode', 'prefectureName', 'prefectureCode',
    'prefectureLevel', 'countyName', 'countyCode', 'countyLevel', 'source'
  ];
  assert.equal(layer.records.every((record) =>
    record.administrative &&
    Object.keys(record.administrative).sort().join('|') === administrativeFields.slice().sort().join('|') &&
    !Object.hasOwn(record.administrative, 'rawCandidates') &&
    !Object.hasOwn(record.administrative, 'address') &&
    !Object.hasOwn(record.administrative, 'cache')), true);
  const accepted = layer.records.filter((record) => record.provider === 'amap' && record.providerCrs === 'GCJ-02');
  assert.equal(accepted.length, layer.summary.accepted);
  assert.equal(accepted.every((record) =>
    Number.isFinite(record.providerLat) && Number.isFinite(record.providerLng) &&
    record.providerLat >= -90 && record.providerLat <= 90 &&
    record.providerLng >= -180 && record.providerLng <= 180 &&
    (record.positionType !== 'cinema-poi' || record.providerPoiId) &&
    record.locationGranularity && record.locationConfidence && record.identityConfidence), true);
  const preview = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/local/cinemas-preview.json'), 'utf8'));
  const previewAccepted = preview.records.filter((record) => record.location?.providerCrs === 'GCJ-02').length;
  assert.ok(layer.summary.accepted >= previewAccepted, 'dynamic layer regressed below the existing accepted baseline');
});

test('review provenance distinguishes explicit Luna or human-web review from automatic and unreviewed defaults', () => {
  const explicitRows = new Set(completedReview.records
    .filter((record) => record.review?.explicitVerdict === true)
    .map((record) => record.sourceRow)
    .concat(humanVerificationResults.map((record) => record.sourceRow)));
  const explicit = privateLayer.records.filter((record) => record.review?.explicitVerdict === true);
  const materializedExplicitRows = new Set(explicit.map((record) => record.sourceRow));
  assert.equal([...materializedExplicitRows].every((sourceRow) => explicitRows.has(sourceRow)), true);
  assert.equal(explicit.every((record) => ['luna-reviewed', 'human-web-verification'].includes(record.decisionOrigin)), true);
  assert.equal(privateLayer.records.filter((record) => record.decisionOrigin === 'luna-reviewed')
    .every((record) => record.review?.explicitVerdict === true), true);

  const automaticMedium = privateLayer.records.filter((record) => record.decisionOrigin === 'automatic-medium');
  assert.equal(automaticMedium.length, layer.summary.automaticMedium);
  assert.equal(automaticMedium.every((record) => record.reviewState === 'pending-review' && record.review?.explicitVerdict !== true), true);

  const unreviewedDefault = privateLayer.records.filter((record) => record.decisionOrigin === 'unreviewed-default');
  const reviewedRejections = privateLayer.records.filter((record) => record.reviewedRejection?.verdict === 'reject-wrong-poi');
  const unresolvedReviewedRejections = reviewedRejections.filter((record) => record.reviewState === 'unresolved');
  const explicitUnresolved = privateLayer.records.filter((record) =>
    record.decisionOrigin === 'luna-reviewed' && record.reviewState === 'unresolved'
  );
  assert.equal(reviewedRejections.length, privateLayer.summary.reviewedRejections);
  assert.equal(
    unreviewedDefault.length + unresolvedReviewedRejections.length + explicitUnresolved.length,
    privateLayer.summary.unresolved
  );
  assert.equal(unreviewedDefault.every((record) => record.review?.reviewSource === 'unreviewed-default'), true);
  assert.equal(explicitUnresolved.every((record) => record.review?.explicitVerdict === true), true);

  const publicExplicit = layer.records.filter((record) => record.decisionOrigin === 'luna-reviewed');
  assert.equal(publicExplicit.every((record) => explicitRows.has(record.sourceRow)), true);
  assert.ok(publicExplicit.length > 0);
  assert.equal(publicExplicit.every((record) => record.reviewVerdict !== 'accepted-high'), true);
  const publicUnreviewedDefault = layer.records.filter((record) => record.decisionOrigin === 'unreviewed-default');
  assert.equal(layer.summary.unreviewedDefault, publicUnreviewedDefault.length);
  assert.equal(layer.summary.unresolvedDefault, 0);
});

test('historical Han Street canonical result stays separate from the unreleased public layer', () => {
  const preview = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/local/cinemas-preview.json'), 'utf8'));
  const preview380 = preview.records.find((record) => record.sourceRow === 380);
  const preview825 = preview.records.find((record) => record.sourceRow === 825);
  assert.equal(preview380.location.providerPoiId ?? null, null);
  assert.equal(preview380.reviewedRejection, null);
  assert.equal(preview825.location.providerPoiId ?? null, null);
  assert.equal(preview825.location.providerCrs ?? null, null);
  assert.equal(preview825.reviewedRejection.poiId, 'B0KRFSJADF');
  assert.equal(preview825.reviewedRejection.verdict, 'reject-wrong-poi');

  const private380 = privateLayer.records.find((record) => record.sourceRow === 380);
  const private825 = privateLayer.records.find((record) => record.sourceRow === 825);
  assert.equal(private380.location.providerPoiId, 'B0KRFSJADF');
  assert.equal(private380.decisionOrigin, 'luna-reviewed');
  assert.equal(private825.location.providerPoiId, 'B0K6JUS8K3');
  assert.equal(private825.reviewState, 'located');
  assert.equal(private825.reviewVerdict, 'accept-historical-location');
  assert.equal(private825.decisionOrigin, 'human-web-verification');
  assert.equal(privateLayer.summary.reviewedRejections, 1);

  const public380 = layer.records.find((record) => record.sourceRow === 380);
  const public825 = layer.records.find((record) => record.sourceRow === 825);
  assert.equal(public380.providerPoiId, 'B0KRFSJADF');
  assert.equal(public825.providerPoiId, 'B0K6JUS8K3');
  assert.equal(public825.reviewVerdict, 'accept-historical-location');
  assert.equal(public825.decisionOrigin, 'luna-reviewed');
  assert.equal(public825.locationGranularity, 'venue');
  assert.equal(layer.summary.reviewedRejections, 0);
  assert.equal(completedReview.records.some((record) => record.sourceRow === 825), false);
});

test('public frontend loads AMap online and keeps no-coordinate detail reachable', () => {
  assert.match(html, /runtime-config\.js/);
  assert.match(html, /app\.mjs/);
  assert.doesNotMatch(`${html}\n${app}`, /locationFilters|data-location|位置核验/);
  assert.match(html, /id="nearbyButton"/);
  assert.match(html, /data-nearby-sort="spec"/);
  assert.match(html, /id="detailPanel"/);
  assert.match(app, /https:\/\/webapi\.amap\.com\/maps/);
  assert.match(app, /buildAdministrativeDisplay/);
  assert.match(app, /resolveAdminCollisions/);
  assert.match(navigationCoordinator, /zoomend/);
  assert.doesNotMatch(app, /AMap\.MarkerCluster|averageCenter/);
  assert.match(app, /AMap\.Geolocation/);
  assert.match(app, /method: 'POST'/);
  assert.match(app, /sourceRows/);
  assert.match(app, /showDetail\(cinema\)/);
  assert.match(app, /未定位/);
  assert.doesNotMatch(`${html}\n${app}`, /maplibre|openfreemap|tile\.openstreetmap\.org/i);
});
