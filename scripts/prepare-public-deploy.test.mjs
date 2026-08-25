import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { after } from 'node:test';

const ROOT = process.cwd();
const PUBLIC_DATASET = path.join(ROOT, 'data/public/cinemas.json');
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'china-imax-map-prepare-test-'));
const fixtureFile = path.join(fixtureDir, 'reviewed-layer.json');
const markerArtifact = path.join(fixtureDir, 'output/public-amap-markers.json');
const markerHash = path.join(fixtureDir, 'output/public-amap-markers.sha256');
fs.writeFileSync(fixtureFile, JSON.stringify(createTestLayer()), 'utf8');
after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

test('deploy preparation validates the runtime secret layer without rewriting public facts', () => {
  const before = hashFile(PUBLIC_DATASET);
  const result = spawnSync(process.execPath, ['scripts/prepare-public-deploy.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PUBLIC_AMAP_REVIEWED_FILE: fixtureFile, PUBLIC_AMAP_MARKER_OUTPUT_DIR: path.dirname(markerArtifact) }
  });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.records, 901);
  assert.equal(summary.staticCoordinates, 0);
  assert.equal(summary.runtimeMarkers, 901);
  assert.equal(summary.markerSource, 'runtime-secret-file');
  assert.equal(summary.markerArtifact, path.relative(ROOT, markerArtifact).replaceAll(path.sep, '/'));
  assert.match(summary.markerSha256, /^[a-f0-9]{64}$/);
  assert.equal(hashFile(markerArtifact), summary.markerSha256);
  assert.match(fs.readFileSync(markerArtifact, 'utf8'), /"mode":"public-amap-marker-layer"/);
  assert.doesNotMatch(fs.readFileSync(markerArtifact, 'utf8'), /AMAP_JS_SECURITY_CODE|rawCandidates|rankedCandidates/);
  assert.match(fs.readFileSync(markerHash, 'utf8'), new RegExp(`${summary.markerSha256}  public-amap-markers\\.json`));
  const repeat = spawnSync(process.execPath, ['scripts/prepare-public-deploy.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PUBLIC_AMAP_REVIEWED_FILE: fixtureFile, PUBLIC_AMAP_MARKER_OUTPUT_DIR: path.dirname(markerArtifact) }
  });
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(JSON.parse(repeat.stdout).markerSha256, summary.markerSha256);
  assert.equal(hashFile(PUBLIC_DATASET), before);
});

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createTestLayer() {
  return {
    mode: 'public-amap-reviewed-layer',
    coordinateSystem: 'GCJ-02',
    policy: { localOnly: true },
    records: Array.from({ length: 901 }, (_, index) => ({
      sourceRow: index + 2,
      id: `test-${index + 2}`,
      provider: 'amap',
      providerPoiId: `poi-${index + 2}`,
      providerLat: 20 + (index % 30) / 100,
      providerLng: 110 + (index % 50) / 100,
      providerCrs: 'GCJ-02',
      positionType: 'cinema-poi',
      locationGranularity: 'cinema',
      locationConfidence: 'high',
      identityConfidence: 'high',
      decisionOrigin: 'test-fixture',
      reviewVerdict: 'accept-exact'
    }))
  };
}
