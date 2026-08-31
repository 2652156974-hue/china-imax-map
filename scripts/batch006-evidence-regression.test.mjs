import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('batch-006 script evidence exactly matches the reviewed JSON', async () => {
  const file = 'data/local/luna-geocode-review-323.json';
  const before = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const review = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { urls } = await import('./prepare-luna-batch-006.mjs?regression=1');
  for (const row of [683, 689, 756, 766, 774]) {
    const expected = review.records.find((record) => Number(record.sourceRow) === row).review.evidenceUrls;
    assert.deepEqual(urls[row], expected, `row ${row}`);
    for (const value of urls[row]) {
      assert.doesNotMatch(value, /%(?![0-9A-Fa-f]{2})/);
      assert.doesNotThrow(() => new URL(value));
    }
  }
  assert.doesNotMatch(JSON.stringify(urls[766]), /西安|北辰东路700号/);
  const after = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(after, before, 'import must not rewrite canonical review JSON');
});

test('batch-006 prepare guard executes only on direct Windows path', async () => {
  const fixture = path.join(os.tmpdir(), `batch006-fixture-${process.pid}.json`);
  const initial = { records: [{ sourceRow: 766, review: { evidenceUrls: ['old'] } }] };
  fs.writeFileSync(fixture, JSON.stringify(initial));
  const result = spawnSync(process.execPath, [path.resolve('scripts/prepare-luna-batch-006.mjs')], {
    cwd: process.cwd(), env: { ...process.env, LUNA_BATCH006_REVIEW_FILE: fixture }, encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const updated = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  assert.notDeepEqual(updated.records[0].review.evidenceUrls, ['old']);
  fs.unlinkSync(fixture);
});
