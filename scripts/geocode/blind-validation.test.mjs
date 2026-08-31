import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { BLIND_SEED, PREVIOUS_SOURCE_ROWS, STRATUM_TARGETS, blindSelectionSummary, matcherFingerprint, selectBlind50 } from './blind-selection.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/derived/cinemas.json'), 'utf8'));
const selection = selectBlind50(dataset.records);
const summary = blindSelectionSummary(selection);
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-blind-50-matcher-lock.json'), 'utf8'));

test('blind sample is deterministic, unique, and excludes the previous 20', () => {
  assert.equal(selection.length, 50);
  assert.equal(new Set(summary.sourceRows).size, 50);
  assert.deepEqual(selectBlind50(dataset.records).map((item) => item.record.sourceRow), summary.sourceRows);
  assert.equal(summary.sourceRows.some((row) => PREVIOUS_SOURCE_ROWS.includes(row)), false);
});

test('blind sample meets every requested stratum exactly', () => {
  assert.deepEqual(summary.actualCounts, { ...STRATUM_TARGETS });
});

test('blind matcher and source rows match the frozen lock', () => {
  assert.equal(lock.seed, BLIND_SEED);
  assert.equal(lock.matcherSha256, matcherFingerprint(ROOT).value);
  assert.deepEqual(lock.sourceRows, summary.sourceRows);
});

test('blind sample has no reviewed override rows', () => {
  const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/geocode/reviewed-overrides.json'), 'utf8'));
  const overrideRows = new Set(overrides.records.map((item) => item.sourceRow));
  assert.equal(summary.sourceRows.some((row) => overrideRows.has(row)), false);
});

test('provider cache is ignored and is not tracked by Git', () => {
  const ignored = spawnSync('git', ['check-ignore', 'data/geocode/provider-cache/amap.json'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ignored.status, 0);
  const tracked = spawnSync('git', ['ls-files', 'data/geocode/provider-cache'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(tracked.status, 0);
  assert.equal(tracked.stdout.trim(), '');
});

test('public blind audit contains no raw candidate response list', () => {
  const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-blind-50.json'), 'utf8'));
  const serialized = JSON.stringify(audit);
  assert.equal(audit.status, 'awaiting-independent-human-validation');
  assert.equal(audit.records.length, 50);
  assert.equal(audit.records.flatMap((record) => record.queryVariants).length, 98);
  assert.equal(serialized.includes('rawCandidates'), false);
  assert.equal(serialized.includes('rankedCandidates'), false);
  assert.equal(audit.records.every((record) => record.overrideUsed !== true), true);
  assert.deepEqual(audit.summary, {
    evaluated: 50,
    automaticHigh: 19,
    automaticMedium: 12,
    reviewedOverrideHigh: 0,
    reviewedOverrideMedium: 0,
    unresolved: 19,
    coverage: 0.62,
    automaticHighRate: 0.38
  });
  assert.equal(audit.precision.value, null);
  assert.equal(audit.requestPolicy.networkRequests, 0);
  assert.equal(audit.requestPolicy.cacheHits, 98);
  assert.equal(audit.requestPolicy.cacheOnly, true);
  assert.equal(audit.requestPolicy.providerErrors, 0);
  const accepted = audit.records.map((record) => record.selected).filter(Boolean);
  assert.equal(accepted.length, 31);
  assert.equal(accepted.every((candidate) => candidate.provider.providerCrs === 'GCJ-02' && candidate.map.mapCrs === 'WGS84'), true);
  assert.equal(accepted.every((candidate) => Number.isFinite(candidate.provider.providerLat) && Number.isFinite(candidate.provider.providerLng) && Number.isFinite(candidate.map.lat) && Number.isFinite(candidate.map.lng)), true);
  assert.equal(accepted.every((candidate) => ['auditorium', 'cinema', 'venue', 'mall'].includes(candidate.locationGranularity)), true);
  assert.equal(accepted.every((candidate) => ['high', 'medium', 'low', 'unknown'].includes(candidate.locationConfidence)), true);
  assert.equal(accepted.every((candidate) => ['high', 'medium', 'low', 'unknown'].includes(candidate.identityConfidence)), true);
});

test('format compatibility rescore removes the row 464 sibling-auditorium false positive', () => {
  const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-blind-50.json'), 'utf8'));
  const diff = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-blind-50-format-diff.json'), 'utf8'));
  const row = audit.records.find((record) => record.sourceRow === 464);
  assert.equal(row.selected.poiId, 'B0FFH1LFNB');
  assert.equal(row.selected.name, '山东省科技馆');
  assert.equal(row.selected.automaticDecision, 'review-required-medium');
  assert.equal(row.selected.positionType, 'venue-poi');
  assert.equal(row.selected.locationGranularity, 'venue');
  assert.equal(row.selected.locationConfidence, 'high');
  assert.equal(row.selected.identityConfidence, 'medium');
  assert.equal(row.formatConflictSummary.candidates.some((candidate) => candidate.poiId === 'B0J6N7NXBQ' && candidate.conflicts.includes('non-dome-vs-dome-auditorium') && candidate.hardRejected), true);
  assert.equal(audit.formatCompatibilityAudit.priorHighFormatConflictCount, 1);
  assert.equal(audit.formatCompatibilityAudit.currentHighFormatConflictCount, 0);
  assert.equal(diff.networkRequests, 0);
  assert.equal(diff.row464.after.poiId, 'B0FFH1LFNB');
});

test('all prior high format conflicts are cleared and venue-only matches are not exact auditorium high', () => {
  const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-blind-50.json'), 'utf8'));
  const priorHighRows = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-blind-50-before-format-compatibility.json'), 'utf8'))
    .records.filter((record) => record.selected?.automaticDecision === 'accepted-high')
    .map((record) => record.sourceRow));
  const currentHigh = audit.records.filter((record) => record.selected?.automaticDecision === 'accepted-high');
  assert.equal(currentHigh.some((record) => record.selected.formatCompatibility.compatible === false), false);
  assert.equal(currentHigh.some((record) => record.selected.locationGranularity === 'venue'), false);
  assert.deepEqual(audit.formatCompatibilityAudit.priorHighFormatConflicts.map((item) => item.sourceRow), [464]);
  assert.equal(priorHighRows.size, 21);
});

test('county-level city hierarchy clears false city mismatches without changing score thresholds', () => {
  const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-blind-50.json'), 'utf8'));
  const diff = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-blind-50-admin-diff.json'), 'utf8'));
  const yueqing = audit.records.find((record) => record.sourceRow === 577);
  const yuyao = audit.records.find((record) => record.sourceRow === 555);

  assert.equal(yueqing.topCandidate.adminMatch.compatible, true);
  assert.equal(yueqing.topCandidate.adminMatch.targetLevel, 'county-level-city');
  assert.equal(yueqing.hardRejectSummary.reasons['city-mismatch'] ?? 0, 0);
  assert.equal(yueqing.topCandidate.score, 0.756522);
  assert.equal(yueqing.selected, null);

  assert.equal(yuyao.selected.adminMatch.compatible, true);
  assert.equal(yuyao.selected.adminMatch.targetPrefecture, '宁波');
  assert.equal(yuyao.selected.adminMatch.targetCounty, '余姚');
  assert.equal(yuyao.selected.automaticDecision, 'accepted-high');
  assert.deepEqual(diff.before, {
    evaluated: 50,
    automaticHigh: 18,
    automaticMedium: 12,
    reviewedOverrideHigh: 0,
    reviewedOverrideMedium: 0,
    unresolved: 20,
    coverage: 0.6,
    automaticHighRate: 0.36
  });
  assert.equal(diff.networkRequests, 0);
  assert.equal(diff.focusRows['577'].after, null);
  assert.equal(diff.focusRows['577'].afterTopCandidate.adminMatch.compatible, true);
  assert.equal(diff.focusRows['555'].after.automaticDecision, 'accepted-high');
});

test('previous 20 decisions and automatic/override split have not regressed', () => {
  const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-test-20-matcher-baseline.json'), 'utf8'));
  const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/geocode-test-20.json'), 'utf8'));
  for (const [key, value] of Object.entries(expected.summary)) assert.equal(current.summary[key], value, key);
  const actualByRow = new Map(current.records.map((record) => [record.sourceRow, record]));
  for (const item of expected.records) {
    const actual = actualByRow.get(item.sourceRow);
    assert.ok(actual, `missing sourceRow ${item.sourceRow}`);
    assert.equal(actual.selectedCandidate?.decision ?? 'unresolved', item.decision, `decision ${item.sourceRow}`);
    assert.equal(actual.selectedCandidate?.poiId ?? null, item.poiId, `poi ${item.sourceRow}`);
    assert.equal(actual.overrideUsed, item.overrideUsed, `override ${item.sourceRow}`);
  }
});

test('blind runner keeps --full and --apply disabled', () => {
  for (const flag of ['--full', '--apply']) {
    const result = spawnSync(process.execPath, ['scripts/geocode-blind-50.mjs', flag], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(result.status, 0, flag);
    assert.match(result.stderr, /disabled/i, flag);
  }
});
