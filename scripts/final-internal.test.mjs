import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = process.cwd();
const outputFile = path.join(ROOT, 'data/derived/cinemas-final-internal.json');
const reviewedFile = path.join(ROOT, 'data/local/private-reviewed-geocodes.json');

test('final internal builder consumes the current private reviewed layer and keeps dynamic state', () => {
  assert.equal(fs.existsSync(reviewedFile), true);
  const currentReviewed = JSON.parse(fs.readFileSync(reviewedFile, 'utf8'));
  const approvedBefore = new Map((currentReviewed.records ?? [])
    .filter((record) => record.reviewState === 'located')
    .map((record) => [Number(record.sourceRow), [record.location?.providerCrs, record.location?.providerLat, record.location?.providerLng]]));
  const result = spawnSync(process.execPath, ['scripts/build-final-internal.mjs'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const document = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  assert.equal(document.status, 'complete-internal-only');
  assert.equal(document.records.length, 901);
  assert.equal(document.inputs.canonicalReviewedGeocodeFactSource, 'data/local/private-reviewed-geocodes.json');
  assert.equal(document.summary.located + document.summary.unlocated, 901);
  assert.equal(document.summary.located, currentReviewed.summary.accepted);
  assert.equal(document.summary.unlocated, currentReviewed.summary.unlocated);
  assert.equal(document.summary.located + document.summary.unlocated, 901);
  assert.equal(document.records.filter((record) => record.region === '中国大陆').length, 881);
  assert.equal(document.records.filter((record) => record.region === '香港').length, 7);
  assert.equal(document.records.filter((record) => record.region === '澳门').length, 1);
  assert.equal(document.records.filter((record) => record.region === '台湾').length, 12);
  for (const record of document.records.filter((item) => item.reviewState === 'located')) {
    assert.deepEqual(
      [record.location?.providerCrs, record.location?.providerLat, record.location?.providerLng],
      approvedBefore.get(Number(record.sourceRow)),
      `approved coordinate changed at sourceRow ${record.sourceRow}`
    );
  }
});
