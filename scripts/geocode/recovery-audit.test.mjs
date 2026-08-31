import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(process.cwd());
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));

test('reconstructed mainland audit is partial-fidelity and transparently labeled', () => {
  const audit = readJson('data/audit/geocode-mainland-full.json');
  const quality = readJson('data/audit/geocode-mainland-quality.json');
  assert.equal(audit.status, 'reconstructed-partial-fidelity');
  assert.deepEqual(audit.progress, { completed: 881, totalMainland: 881 });
  assert.equal(audit.records.length, 881);
  assert.deepEqual(audit.summary, {
    evaluated: 881,
    automaticHigh: 574,
    automaticMedium: 109,
    reviewedOverrideHigh: 4,
    reviewedOverrideMedium: 0,
    unresolved: 194,
    coverage: 0.779796
  });
  assert.equal(audit.restoration.status, 'reconstructed-partial-fidelity');
  assert.equal(audit.restoration.exactOriginalCopyFound, false);
  assert.equal(audit.restoration.byteForByteRestored, false);
  assert.equal(audit.restoration.providerRunnerExecuted, false);
  assert.equal(audit.restoration.providerRescored, false);
  assert.equal(audit.restoration.recoveryNetworkRequests, 0);
  assert.equal(JSON.stringify(audit).includes('rawCandidates'), false);
  assert.equal(JSON.stringify(audit).includes('rankedCandidates'), false);
  assert.equal(quality.status, 'reconstructed-partial-fidelity');
  assert.equal(quality.totalMainland, 881);
  assert.equal(quality.evaluated, 881);
  assert.equal(quality.restoration.byteForByteRestored, false);
  assert.equal(audit.requestPolicy.cacheEntriesAtStart, 140);
  assert.equal(audit.requestPolicy.cacheEntriesAtEnd, 1848);
  assert.equal(audit.requestPolicy.recovery.networkRequests, 0);
  assert.equal(audit.restoration.fieldFidelity.queryVariants.status, 'unavailable');
  assert.equal(audit.records.every((record) => record.queryVariants === null), true);
  assert.equal(audit.records.every((record) => record.fieldAvailability), true);
});

test('cache-only incident report preserves the stop boundary and uncertainty', () => {
  const incident = readJson('data/audit/incidents/geocode-mainland-cache-only-incident.json');
  const audit = readJson('data/audit/geocode-mainland-full.json');
  assert.equal(incident.status, 'isolated-cache-only-partial-run');
  assert.match(incident.command, /--scope=mainland --dry-run --cache-only/);
  assert.equal(incident.recordsTraversed, 40);
  assert.equal(incident.cacheHits, 82);
  assert.equal(incident.networkRequests, 0);
  assert.equal(incident.newRequests, 0);
  assert.equal(incident.providerErrors, 0);
  assert.equal(incident.providerCache.entriesAtStart, 1848);
  assert.equal(incident.providerCache.entriesAtEnd, 1848);
  assert.equal(incident.providerCache.preRunSnapshotAvailable, false);
  assert.equal(incident.providerCache.sourceRowsMutationProvable, false);
  assert.equal(incident.activeAuditRecovery.status, 'reconstructed-partial-fidelity');
  assert.equal(incident.activeAuditRecovery.records, audit.records.length);
});

test('recovery provenance is immutable, key sources are separated, and legacy recovery fails closed', () => {
  const audit = readJson('data/audit/geocode-mainland-full.json');
  const manifest = readJson('data/audit/geocode-mainland-recovery-manifest.json');
  const evidence = readJson('data/audit/geocode-mainland-historical-aggregate-evidence.json');
  assert.equal(audit.requestPolicy.historical.keySource, 'process.env.AMAP_API_KEY');
  assert.equal(audit.requestPolicy.recovery.keySource, 'not-used');
  assert.equal(manifest.historicalAggregateEvidence, 'data/audit/geocode-mainland-historical-aggregate-evidence.json');
  assert.equal(manifest.historicalAggregateEvidenceSha256.length, 64);
  assert.deepEqual(evidence.aggregates, manifest.historicalAggregates);
  assert.equal(evidence.sourceThread, '01a01e20-6df6-7cc1-9718-acf1f6b4becf');
  assert.equal(evidence.sourceTurn, '01a01e5e-8c5e-7143-ab82-507db74de840');
  assert.equal(evidence.recordedAt, '2026-08-20T09:41:48.420Z');
  assert.equal(evidence.verifiedByThread, '01a02276-b56d-7da1-87a2-c9628cf073e6');
  assert.equal(audit.requestPolicy.cacheEntriesAtStart, evidence.aggregates.cacheEntriesAtStart);
  assert.equal(audit.requestPolicy.cacheEntriesAtEnd, evidence.aggregates.cacheEntriesAtEnd);
  assert.equal(qualitySourceSegment('commercialCinema'), evidence.aggregates.sourceSegments.commercial);
  assert.equal(qualitySourceSegment('institutionalVenue'), evidence.aggregates.sourceSegments.institutional);
  assert.equal(audit.records.every((record) => !record.selected || (record.selected.formatCompatibility === null && record.selected.adminMatch === null)), true);
  assert.equal(audit.records.every((record) => !record.topCandidate || (record.topCandidate.formatCompatibility === null && record.topCandidate.adminMatch === null)), true);
});

function qualitySourceSegment(name) {
  return readJson('data/audit/geocode-mainland-quality.json').sourceSegments[name].records;
}
