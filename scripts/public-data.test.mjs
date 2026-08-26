import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const publicData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/public/cinemas.json'), 'utf8'));
const derived = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/derived/cinemas.json'), 'utf8'));
const quality = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/public-amap-quality.json'), 'utf8'));
const readiness = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/public-release-readiness.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audit/public-release-manifest.json'), 'utf8'));

test('public release facts are complete and independent of excluded private canonical data', () => {
  assert.equal(publicData.records.length, 901);
  assert.equal(publicData.mode, 'public-amap-runtime');
  assert.equal(publicData.mapProvider, 'AMap JS API 2.0');
  assert.equal(publicData.coordinateSystem, 'GCJ-02');
  assert.equal(publicData.coordinatesPublished, 0);
  assert.equal(publicData.runtimeMarkerCount, 901);
  assert.equal(publicData.markerService.path, '/api/public/markers');
  assert.equal(publicData.source.tabId, 'BB08J2');

  const manifestStaticEntry = manifest.files.find((file) => file.path === 'data/public/cinemas.json');
  assert.ok(manifestStaticEntry, 'public manifest must include the static fact layer');
  assert.equal(manifestStaticEntry.sha256, hashFile(path.join(ROOT, 'data/public/cinemas.json')));
  assert.equal(manifest.counts.total, publicData.records.length);
  assert.equal(manifest.counts.markerCount, quality.markerCount);
  assert.equal(manifest.invariants.staticCoordinates, publicData.coordinatesPublished);

  const serialized = JSON.stringify(publicData);
  assert.doesNotMatch(serialized, /rawCandidates|providerLat|providerLng/);
  assert.equal(publicData.records.every((record) => record.location.lat === null && record.location.lng === null), true);
  assert.equal(publicData.records.every((record) =>
    typeof record.screen.rawWidth === 'string' && typeof record.screen.rawHeight === 'string' &&
    typeof record.screen.rawArea === 'string' && typeof record.seatsRaw === 'string'), true);

  const derivedByRow = new Map(derived.records.map((record) => [record.sourceRow, record]));
  let rawFieldMatches = 0;
  for (const record of publicData.records) {
    const source = derivedByRow.get(record.sourceRow);
    assert.ok(source, `missing derived sourceRow ${record.sourceRow}`);
    for (const field of ['rawWidth', 'rawHeight', 'rawArea']) {
      assert.equal(record.screen[field], source.screen[field]);
      rawFieldMatches += 1;
    }
    assert.equal(record.seatsRaw, source.seatsRaw);
    rawFieldMatches += 1;
  }
  assert.equal(rawFieldMatches, 3604);

  assert.equal(quality.total, 901);
  assert.equal(quality.accepted, 901);
  assert.equal(quality.markerCount, 901);
  assert.equal(quality.unlocated, 0);
  assert.equal(quality.releaseInvariant.markerCountEqualsAccepted, true);
  assert.equal(readiness.releaseCandidate, true);
  assert.equal(readiness.publicationReady, true);
  assert.equal(readiness.staticFactLayer.staticCoordinates, 0);
  assert.equal(readiness.staticFactLayer.rawFieldMatches, 3604);

  const historical = publicData.records.find((record) => record.sourceRow === 825);
  assert.match(historical.name, /原有商业综合体拆除/);
  assert.equal(historical.location.lat, null);
  assert.equal(historical.location.lng, null);
});

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
