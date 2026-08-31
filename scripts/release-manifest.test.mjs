import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = process.cwd();
const PUBLIC_FILE = path.join(ROOT, 'data/audit/public-release-manifest.json');
const PRIVATE_FILE = path.join(ROOT, 'data/local/private-release-manifest.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

function currentQuality() {
  return readJson('data/audit/private-release-quality.json');
}

test('public release manifest excludes private/raw inputs and preserves runtime invariants', () => {
  const manifest = readJson('data/audit/public-release-manifest.json');
  const quality = currentQuality();
  const paths = manifest.files.map((file) => file.path);
  assert.equal(manifest.manifestType, 'public-release');
  assert.equal(manifest.counts.total, 901);
  assert.equal(manifest.counts.acceptedPlusUnlocated, quality.acceptedPlusUnlocated);
  assert.equal(manifest.counts.markerCount, quality.markerCount);
  assert.equal(manifest.invariants.staticCoordinates, 0);
  assert.equal(manifest.security.rawSnapshotIncluded, false);
  assert.equal(manifest.security.providerCacheIncluded, false);
  assert.equal(manifest.security.rawCandidatesIncluded, false);
  assert.ok(paths.includes('data/public/cinemas.json'));
  assert.ok(paths.includes('scripts/public-amap-server.mjs'));
  assert.ok(paths.every((file) => !/(^|\/)(data\/raw|data\/local|data\/geocode\/provider-cache|dist-private)(\/|$)/i.test(file)));
  assert.doesNotMatch(JSON.stringify(manifest), /AMAP_JS_SECURITY_CODE\s*[:=]\s*[^"'\s]+/i);
  assert.doesNotMatch(JSON.stringify(manifest), /\b[a-f0-9]{32}\b/i);
});

test('private local manifest is explicit, ignored, and contains no credential value', () => {
  const manifest = readJson('data/local/private-release-manifest.json');
  const quality = currentQuality();
  const serialized = JSON.stringify(manifest);
  const ignored = spawnSync('git', ['check-ignore', '-q', '--', 'data/local/private-release-manifest.json'], { cwd: ROOT });
  assert.equal(ignored.status, 0);
  assert.equal(manifest.manifestType, 'private-local-release');
  assert.equal(manifest.counts.acceptedPlusUnlocated, quality.acceptedPlusUnlocated);
  assert.equal(manifest.counts.markerCount, quality.markerCount);
  assert.equal(manifest.invariants.threeStatePartition, true);
  assert.ok(manifest.privateOnlyInputs.includes('data/geocode/provider-cache/*.json'));
  assert.equal(manifest.environment.valuesIncluded, false);
  assert.match(serialized, /AMAP_JS_API_KEY/);
  assert.match(serialized, /AMAP_JS_SECURITY_CODE/);
  assert.doesNotMatch(serialized, /\b[a-f0-9]{32}\b/i);
  assert.doesNotMatch(serialized, /rawCandidates\s*[:=]\s*\[/i);
});
