import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const file = path.join(process.cwd(), 'data/audit/geocode-mainland-evidence-review.json');

test('mainland evidence review is advisory-only and contains no applied coordinates', () => {
  const audit = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(audit.status, 'evidence-collected-not-materialized');
  assert.equal(audit.decisionPolicy.doesNotApplyCoordinates, true);
  assert.equal(audit.summary.coordinatesApplied, 0);
  assert.equal(audit.records.length, 5);
  for (const record of audit.records) {
    assert.ok(Number.isInteger(record.sourceRow));
    assert.equal(record.coordinateAction.startsWith('keep-null'), true);
    assert.ok(record.evidence.length > 0);
    for (const evidence of record.evidence) assert.match(evidence.url, /^https:\/\//);
    assert.equal(Object.hasOwn(record, 'lat'), false);
    assert.equal(Object.hasOwn(record, 'lng'), false);
    assert.equal(Object.hasOwn(record, 'providerCoordinate'), false);
  }
});
