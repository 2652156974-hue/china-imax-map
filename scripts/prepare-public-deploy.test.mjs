import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = process.cwd();
const PUBLIC_DATASET = path.join(ROOT, 'data/public/cinemas.json');

test('deploy preparation validates the runtime secret layer without rewriting public facts', () => {
  const before = hashFile(PUBLIC_DATASET);
  const result = spawnSync(process.execPath, ['scripts/prepare-public-deploy.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env
  });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.records, 901);
  assert.equal(summary.staticCoordinates, 0);
  assert.equal(summary.runtimeMarkers, 901);
  assert.equal(summary.markerSource, 'runtime-secret-file');
  assert.equal(hashFile(PUBLIC_DATASET), before);
});

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
