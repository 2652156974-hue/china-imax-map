import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPrivateReviewedLayer } from './build-private-reviewed-layer.mjs';
import { buildPublicAmapLayer } from './build-public-amap-layer.mjs';
import { isAcceptedReview, normalizeReview } from './complete-luna-review.mjs';

const ROOT = process.cwd();

test('strict Luna review validation refuses empty or malformed acceptance', () => {
  const empty = normalizeReview({ verdict: null, reviewedCandidate: null, evidenceUrls: [] });
  assert.equal(empty.verdict, 'needs-more-evidence');
  assert.equal(empty.reviewSource, 'unreviewed-default');
  assert.equal(empty.reviewer, null);
  assert.equal(isAcceptedReview(empty), false);

  const malformed = normalizeReview({
    verdict: 'accept-exact',
    reviewedCandidate: { provider: 'amap', poiId: 'bad', providerCrs: 'GCJ-02', providerLat: 31, providerLng: 121 },
    positionType: 'cinema-poi',
    locationGranularity: 'cinema',
    locationConfidence: 'high',
    identityConfidence: 'high',
    evidenceUrls: ['https://amap.com/only-provider-evidence'],
    reviewer: 'fixture',
    reviewedAt: '2026-08-21T00:00:00.000Z'
  });
  assert.equal(malformed.verdict, 'needs-more-evidence');
  assert.equal(malformed.reviewSource, 'invalid-accept-downgraded');
  assert.equal(malformed.reviewedCandidate.providerLat, null);
  assert.equal(isAcceptedReview(malformed), false);
});

test('qualified Luna fixture changes marker count by one and restoration removes it', () => {
  const source = loadSourceFiles();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'china-imax-map-materialization-'));
  try {
    const paths = copyInputs(source, tempRoot);
    const baselinePrivateFile = path.join(tempRoot, 'private-baseline.json');
    const baselineQualityFile = path.join(tempRoot, 'private-baseline-quality.json');
    const baselinePublicFile = path.join(tempRoot, 'public-baseline.json');
    const baselinePublicQualityFile = path.join(tempRoot, 'public-baseline-quality.json');
    const baselineUnresolvedFile = path.join(tempRoot, 'public-baseline-unresolved.json');

    const baselinePrivate = buildPrivateReviewedLayer({
      ...paths,
      outputFile: baselinePrivateFile,
      qualityFile: baselineQualityFile
    });
    const baselinePublic = buildPublicAmapLayer({
      inputFile: baselinePrivateFile,
      outputFile: baselinePublicFile,
      qualityFile: baselinePublicQualityFile,
      unresolvedFile: baselineUnresolvedFile
    });
    const baselinePrivateDocument = readJson(baselinePrivateFile);
    const baselinePrivateByRow = new Map(baselinePrivateDocument.records.map((record) => [record.sourceRow, record]));
    const total = baselinePrivateDocument.records.length;
    const baselineLocated = baselinePrivate.located;
    assert.equal(baselinePrivate.located, baselineLocated);
    assert.equal(baselinePrivate.located + baselinePrivate.pendingReview + baselinePrivate.unresolved, total);
    assert.equal(baselinePublic.accepted, baselineLocated);
    assert.equal(baselinePublic.accepted + baselinePublic.unresolved, total);

    const fixtureSource = source.luna.records.find((record) =>
      !hasPreviewCoordinate(baselinePrivateByRow.get(record.sourceRow)) &&
      record.candidate?.providerCoordinate &&
      Number.isFinite(Number(record.candidate.providerCoordinate.lat)) &&
      Number.isFinite(Number(record.candidate.providerCoordinate.lng)));
    assert.ok(fixtureSource, 'fixture source row must be unresolved in the baseline');
    const fixtureCandidate = fixtureSource.candidate;
    const fixtureVerdict = fixtureCandidate.positionType === 'cinema-poi' &&
      ['auditorium', 'cinema'].includes(fixtureCandidate.locationGranularity)
      ? 'accept-exact'
      : 'accept-location-only';
    const fixtureReview = normalizeReview({
      verdict: fixtureVerdict,
      acceptedPoiId: fixtureCandidate.poiId,
      reviewedCandidate: {
        provider: 'amap',
        poiId: fixtureCandidate.poiId,
        name: fixtureCandidate.name,
        address: fixtureCandidate.address,
        providerCrs: 'GCJ-02',
        providerLat: fixtureCandidate.providerCoordinate.lat,
        providerLng: fixtureCandidate.providerCoordinate.lng
      },
      positionType: fixtureCandidate.positionType,
      locationGranularity: fixtureCandidate.locationGranularity,
      locationConfidence: 'high',
      identityConfidence: fixtureVerdict === 'accept-exact' ? 'high' : 'medium',
      evidenceUrls: ['https://example.org/independent-fixture-evidence'],
      reviewer: 'fixture-reviewer',
      reviewedAt: '2026-08-21T00:00:00.000Z',
      notes: 'Isolated fixture only.'
    }, { recordContext: fixtureSource });
    assert.equal(isAcceptedReview(fixtureReview, fixtureSource), true);
    const fixtureRecord = source.luna.records.find((record) => record.sourceRow === fixtureSource.sourceRow);
    fixtureRecord.review = fixtureReview;
    writeJson(paths.reviewFile, { ...source.lunaDocument, records: source.luna.records });

    const fixturePrivateFile = path.join(tempRoot, 'private-fixture.json');
    const fixturePublicFile = path.join(tempRoot, 'public-fixture.json');
    const fixtureQualityFile = path.join(tempRoot, 'public-fixture-quality.json');
    const fixtureUnresolvedFile = path.join(tempRoot, 'public-fixture-unresolved.json');
    const fixturePrivate = buildPrivateReviewedLayer({
      ...paths,
      outputFile: fixturePrivateFile,
      qualityFile: path.join(tempRoot, 'private-fixture-quality.json')
    });
    const fixturePublic = buildPublicAmapLayer({
      inputFile: fixturePrivateFile,
      outputFile: fixturePublicFile,
      qualityFile: fixtureQualityFile,
      unresolvedFile: fixtureUnresolvedFile
    });
    assert.equal(fixturePrivate.located, baselineLocated + 1);
    assert.equal(fixturePrivate.pendingReview + fixturePrivate.unresolved, baselinePrivate.pendingReview + baselinePrivate.unresolved - 1);
    assert.equal(fixturePublic.accepted, baselineLocated + 1);
    assert.equal(fixturePublic.unresolved, total - fixturePublic.accepted);
    const materialized = readJson(fixturePrivateFile).records.find((record) => record.sourceRow === fixtureSource.sourceRow);
    assert.equal(materialized.reviewVerdict, fixtureVerdict);
    assert.equal(materialized.decisionOrigin, 'luna-reviewed');
    assert.equal(materialized.location.providerPoiId, fixtureCandidate.poiId);
    assert.equal(materialized.location.providerCrs, 'GCJ-02');
    assert.equal(materialized.location.providerLat, fixtureCandidate.providerCoordinate.lat);
    assert.equal(materialized.location.providerLng, fixtureCandidate.providerCoordinate.lng);
    assert.equal(materialized.location.locationGranularity, fixtureCandidate.locationGranularity);
    assert.equal(materialized.location.locationConfidence, 'high');
    assert.equal(materialized.location.identityConfidence, 'high');

    writeJson(paths.reviewFile, source.lunaDocument);
    const restoredPrivateFile = path.join(tempRoot, 'private-restored.json');
    const restoredPublicFile = path.join(tempRoot, 'public-restored.json');
    const restoredPublicQualityFile = path.join(tempRoot, 'public-restored-quality.json');
    const restoredUnresolvedFile = path.join(tempRoot, 'public-restored-unresolved.json');
    const restoredPrivate = buildPrivateReviewedLayer({
      ...paths,
      outputFile: restoredPrivateFile,
      qualityFile: path.join(tempRoot, 'private-restored-quality.json')
    });
    const restoredPublic = buildPublicAmapLayer({
      inputFile: restoredPrivateFile,
      outputFile: restoredPublicFile,
      qualityFile: restoredPublicQualityFile,
      unresolvedFile: restoredUnresolvedFile
    });
    assert.equal(restoredPrivate.located, baselineLocated);
    assert.equal(restoredPublic.accepted, baselineLocated);
    assert.equal(restoredPublic.unresolved, total - baselineLocated);
    const restoredRecord = readJson(restoredPrivateFile).records.find((record) => record.sourceRow === fixtureSource.sourceRow);
    assert.equal(restoredRecord.location.providerCrs, null);
    assert.equal(restoredRecord.location.providerPoiId, null);
    assert.notEqual(restoredRecord.reviewState, 'located');
    assert.notEqual(restoredRecord.reviewVerdict, 'accept-exact');
    assert.notEqual(restoredRecord.reviewVerdict, 'accept-location-only');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function loadSourceFiles() {
  const previewDocument = readJson(path.join(ROOT, 'data/local/cinemas-preview.json'));
  const lunaDocument = readJson(path.join(ROOT, 'data/local/luna-geocode-review-323.completed.json'));
  return {
    preview: previewDocument,
    previewByRow: new Map(previewDocument.records.map((record) => [record.sourceRow, record])),
    luna: structuredClone(lunaDocument),
    lunaDocument,
    mainlandAuditFile: path.join(ROOT, 'data/audit/geocode-mainland-full.json'),
    regionalAuditFile: path.join(ROOT, 'data/audit/geocode-hkmo-tw.json')
  };
}

function copyInputs(source, tempRoot) {
  const previewFile = path.join(tempRoot, 'preview.json');
  const reviewFile = path.join(tempRoot, 'review.json');
  fs.copyFileSync(path.join(ROOT, 'data/local/cinemas-preview.json'), previewFile);
  writeJson(reviewFile, source.lunaDocument);
  return {
    previewFile,
    reviewFile,
    mainlandAuditFile: source.mainlandAuditFile,
    regionalAuditFile: source.regionalAuditFile
  };
}

function hasPreviewCoordinate(record) {
  return record?.location?.providerCrs === 'GCJ-02' &&
    Number.isFinite(Number(record.location.providerLat)) && Number.isFinite(Number(record.location.providerLng));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
