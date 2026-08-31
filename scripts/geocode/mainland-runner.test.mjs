import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('mainland runner requires explicit scope and dry-run flags', () => {
  const result = spawnSync(process.execPath, ['scripts/geocode-mainland.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires --scope=mainland --dry-run/i);
});

test('mainland runner keeps apply disabled', () => {
  const result = spawnSync(process.execPath, ['scripts/geocode-mainland.mjs', '--scope=mainland', '--dry-run', '--apply'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /apply remains disabled/i);
});

test('mainland runner rejects partial limits', () => {
  const result = spawnSync(process.execPath, ['scripts/geocode-mainland.mjs', '--scope=mainland', '--dry-run', '--limit=10'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /partial limits are not supported/i);
});

test('mainland full public audits are complete, compact, and internally consistent', () => {
  const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-mainland-full.json'), 'utf8'));
  const quality = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-mainland-quality.json'), 'utf8'));
  const serialized = JSON.stringify(audit);
  assert.equal(audit.status, 'reconstructed-partial-fidelity');
  assert.equal(audit.progress.completed, 881);
  assert.equal(audit.records.length, 881);
  assert.equal(serialized.includes('rawCandidates'), false);
  assert.equal(serialized.includes('rankedCandidates'), false);
  assert.deepEqual(audit.summary, {
    evaluated: 881,
    automaticHigh: 574,
    automaticMedium: 109,
    reviewedOverrideHigh: 4,
    reviewedOverrideMedium: 0,
    unresolved: 194,
    coverage: 0.779796
  });
  assert.equal(audit.summary.automaticHigh + audit.summary.automaticMedium + audit.summary.reviewedOverrideHigh + audit.summary.reviewedOverrideMedium + audit.summary.unresolved, 881);
  assert.equal(quality.totalMainland, 881);
  assert.equal(quality.automaticHighRuleChecks.formatCompatible, true);
  assert.equal(quality.automaticHighRuleChecks.adminCompatible, true);
  assert.equal(quality.automaticHighRuleChecks.highLocationConfidence, true);
  assert.equal(quality.automaticHighRuleChecks.highIdentityConfidence, true);
  assert.equal(quality.requestPolicy.networkRequests, 1708);
  assert.equal(quality.requestPolicy.cacheHits, 182);
  assert.equal(quality.requestPolicy.providerErrors, 1);
  assert.equal(quality.requestPolicy.cacheEntriesAtStart, 140);
  assert.equal(quality.requestPolicy.cacheEntriesAtEnd, 1848);
  assert.equal(quality.sourceSegments.commercialCinema.records, 868);
  assert.equal(quality.sourceSegments.institutionalVenue.records, 13);
  assert.equal(quality.rejectionCounts.formatConflictRejected, 23);
  assert.equal(quality.rejectionCounts.cityMismatchRejected, 28);
  assert.equal(quality.rejectionCounts.projectMismatchRejected, 2790);
  assert.equal(quality.rejectionCounts.brandMismatchRejected, 853);
  assert.equal(quality.rejectionCounts.nonCinemaRejected, 6163);
  assert.equal(quality.coordinatePolicy.coordinatesAppliedToDerived, 0);
});

test('mainland county-level and focus audits cover the requested sets', () => {
  const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-mainland-full.json'), 'utf8'));
  const quality = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-mainland-quality.json'), 'utf8'));
  const yueqing = audit.records.find((record) => record.sourceRow === 577);
  const yuyao = audit.records.find((record) => record.sourceRow === 555);
  assert.ok(yueqing.hardRejectSummary);
  assert.equal(yueqing.topCandidate.adminMatch, null);
  assert.equal(yueqing.topCandidate.score, 0.756522);
  assert.equal(yuyao.selected.automaticDecision, 'accepted-high');
  assert.equal(yuyao.selected.adminMatch, null);
  assert.equal(yuyao.fieldAvailability.rowLevelAdminCompatibility, 'unavailable');
  assert.equal(quality.restoration.fieldFidelity.sourceSegments.status, 'historical-aggregate-retained');
});

test('mainland dry-run did not write coordinates to the derived dataset', () => {
  const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/derived/cinemas.json'), 'utf8'));
  assert.equal(dataset.records.length, 901);
  assert.equal(dataset.records.every((record) => record.location.lat === null && record.location.lng === null), true);
});
