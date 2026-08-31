import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('benchmark builder validates real captures and derives call/churn totals', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imax-navigation-benchmark-'));
  const output = path.join(outputDir, 'benchmark.json');
  try {
    const result = spawnSync(process.execPath, [
      'scripts/build-navigation-render-benchmark.mjs',
      '--before', 'data/audit/navigation-render-captures/before.chromium.json',
      '--after', 'data/audit/navigation-render-captures/after.chromium.json',
      '--output', output
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const benchmark = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(benchmark.validation.sameBrowserSession, true);
    assert.equal(benchmark.after.scenarios[0].renderCalls, 2);
    assert.equal(benchmark.after.scenarios[0].markerMutatingRenderCalls, 1);
    assert.deepEqual(benchmark.after.scenarios[0].renderEvents.map((event) => event.skipped), [false, true]);
    assert.match(benchmark.after.captureDigest, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('benchmark validator rejects a declared target zoom that the final event misses', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imax-navigation-benchmark-target-'));
  const before = path.join(outputDir, 'before.json');
  const after = path.join(outputDir, 'after.json');
  const output = path.join(outputDir, 'benchmark.json');
  try {
    const capture = JSON.parse(fs.readFileSync('data/audit/navigation-render-captures/after.chromium.json', 'utf8'));
    capture.scenarios[0].zoom.target = 4;
    fs.writeFileSync(before, fs.readFileSync('data/audit/navigation-render-captures/before.chromium.json'));
    fs.writeFileSync(after, JSON.stringify(capture));
    const result = spawnSync(process.execPath, ['scripts/build-navigation-render-benchmark.mjs', '--before', before, '--after', after, '--output', output], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /target zoom/i);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('benchmark validator recursively rejects sensitive nested capture fields', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imax-navigation-benchmark-sensitive-'));
  const before = path.join(outputDir, 'before.json');
  const after = path.join(outputDir, 'after.json');
  const output = path.join(outputDir, 'benchmark.json');
  try {
    const capture = JSON.parse(fs.readFileSync('data/audit/navigation-render-captures/after.chromium.json', 'utf8'));
    capture.scenarios[0].runtimeState = { nested: { providerLat: 31.2 } };
    fs.writeFileSync(before, fs.readFileSync('data/audit/navigation-render-captures/before.chromium.json'));
    fs.writeFileSync(after, JSON.stringify(capture));
    const result = spawnSync(process.execPath, ['scripts/build-navigation-render-benchmark.mjs', '--before', before, '--after', after, '--output', output], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Forbidden fields/i);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
