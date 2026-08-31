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
