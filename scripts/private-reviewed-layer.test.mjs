import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildPrivateReviewedLayer } from './build-private-reviewed-layer.mjs';

const ROOT = process.cwd();

test('private reviewed builder refuses to overwrite a complete canonical layer with a downgrade', (t) => {
  const testRoot = fs.mkdtempSync(path.join(ROOT, 'tmp', 'private-reviewed-layer-test-'));
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

  const previewFile = path.join(testRoot, 'preview.json');
  const reviewFile = path.join(testRoot, 'review.json');
  const mainlandAuditFile = path.join(testRoot, 'mainland.json');
  const regionalAuditFile = path.join(testRoot, 'regional.json');
  const outputFile = path.join(testRoot, 'private-reviewed-geocodes.json');
  const qualityFile = path.join(testRoot, 'quality.json');

  write(previewFile, { records: Array.from({ length: 901 }, (_, index) => baseRecord(index + 2, false)) });
  write(reviewFile, { records: [] });
  write(mainlandAuditFile, { records: [] });
  write(regionalAuditFile, { records: [] });

  const finalCanonical = {
    schemaVersion: 2,
    summary: {
      total: 901,
      accepted: 901,
      located: 901,
      pendingReview: 0,
      unresolved: 0,
      unlocated: 0
    },
    records: Array.from({ length: 901 }, (_, index) => baseRecord(index + 2, true))
  };
  write(outputFile, finalCanonical);
  const before = fs.readFileSync(outputFile, 'utf8');

  assert.throws(() => buildPrivateReviewedLayer({
    previewFile,
    reviewFile,
    mainlandAuditFile,
    regionalAuditFile,
    outputFile,
    qualityFile
  }), /Refusing canonical downgrade/);
  assert.equal(fs.readFileSync(outputFile, 'utf8'), before);
  assert.equal(fs.existsSync(qualityFile), false);
});

test('private reviewed builder treats a complete canonical layer as immutable by default', (t) => {
  const testRoot = fs.mkdtempSync(path.join(ROOT, 'tmp', 'private-reviewed-layer-test-'));
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

  const files = {
    previewFile: path.join(testRoot, 'preview.json'),
    reviewFile: path.join(testRoot, 'review.json'),
    mainlandAuditFile: path.join(testRoot, 'mainland.json'),
    regionalAuditFile: path.join(testRoot, 'regional.json'),
    outputFile: path.join(testRoot, 'private-reviewed-geocodes.json'),
    qualityFile: path.join(testRoot, 'quality.json')
  };
  write(files.previewFile, { records: Array.from({ length: 901 }, (_, index) => baseRecord(index + 2, true)) });
  write(files.reviewFile, { records: [] });
  write(files.mainlandAuditFile, { records: [] });
  write(files.regionalAuditFile, { records: [] });
  write(files.outputFile, {
    schemaVersion: 2,
    summary: { total: 901, accepted: 901, located: 901, pendingReview: 0, unresolved: 0, unlocated: 0 },
    records: Array.from({ length: 901 }, (_, index) => baseRecord(index + 2, true))
  });

  assert.throws(() => buildPrivateReviewedLayer(files), /Refusing to overwrite final canonical/);
  assert.equal(fs.existsSync(files.qualityFile), false);
});

function baseRecord(sourceRow, located) {
  return {
    id: `fixture-${sourceRow}`,
    sourceRow,
    name: `Fixture ${sourceRow}`,
    region: '中国大陆',
    province: '北京市',
    city: '北京',
    projection: { system: 'Xenon' },
    screen: { rawWidth: '', rawHeight: '', rawArea: '' },
    seatsRaw: '',
    ...(located ? { reviewState: 'located' } : {}),
    location: located ? {
      providerCrs: 'GCJ-02',
      providerLat: 39 + sourceRow / 10000,
      providerLng: 116 + sourceRow / 10000,
      positionType: 'cinema-poi',
      locationGranularity: 'cinema',
      locationConfidence: 'high',
      identityConfidence: 'high',
      providerPoiId: `poi-${sourceRow}`
    } : {}
  };
}

function write(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
