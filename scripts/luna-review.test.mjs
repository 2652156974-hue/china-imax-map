import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const review = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/local/luna-geocode-review-323.json'), 'utf8'));
const derived = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/derived/cinemas.json'), 'utf8'));
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/raw/arvin-imax.json'), 'utf8'));

test('Luna review package contains a dynamic unique row set with immutable screen and seat context', () => {
  assert.ok(review.records.length > 0);
  const byRow = new Map(derived.records.map((record) => [record.sourceRow, record]));
  const rows = new Set();
  for (const item of review.records) {
    assert.equal(Number.isInteger(item.sourceRow), true);
    assert.equal(rows.has(item.sourceRow), false);
    rows.add(item.sourceRow);
    const source = byRow.get(item.sourceRow);
    assert.ok(source, `missing derived sourceRow ${item.sourceRow}`);
    assert.equal(item.id, source.id);
    assert.deepEqual(item.screen, source.screen);
    assert.equal(item.seats, source.seats);
    assert.equal(item.seatsRaw, source.seatsRaw);
    const reviewKeys = Object.keys(item.review).filter((key) => key !== 'administrativeBinding').sort();
    assert.deepEqual(reviewKeys, [
      'acceptedPoiId', 'evidenceUrls', 'identityConfidence', 'locationConfidence',
      'locationGranularity', 'notes', 'positionType', 'reviewedAt', 'reviewedCandidate',
      'reviewer', 'verdict', 'explicitVerdict', 'reviewSource', 'validationErrors'
    ].sort());
    if (Object.prototype.hasOwnProperty.call(item.review, 'administrativeBinding')) {
      assert.ok(item.review.administrativeBinding === null || typeof item.review.administrativeBinding === 'object');
    }
  }
  assert.equal(rows.size, review.records.length);
  assert.equal(JSON.stringify(review).includes('rawCandidates'), false);
});

test('Luna review screen and seat fields remain source-row traceable', () => {
  const rawByRow = new Map(raw.rows.filter((row) => row.rowType === 'data').map((row) => [row.rowIndex, row]));
  for (const item of review.records) {
    const source = rawByRow.get(item.sourceRow);
    assert.ok(source, `missing raw sourceRow ${item.sourceRow}`);
    assert.equal(item.sourceName, String(source.cells[0].displayValue ?? ''));
    assert.equal(item.screen.rawWidth, String(source.cells[3].displayValue ?? ''));
    assert.equal(item.screen.rawHeight, String(source.cells[4].displayValue ?? ''));
    assert.equal(item.screen.rawArea, String(source.cells[5].displayValue ?? ''));
    assert.equal(item.seatsRaw, String(source.cells[6].displayValue ?? ''));
  }
});
