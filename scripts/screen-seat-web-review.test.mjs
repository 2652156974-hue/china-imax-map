import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));

const raw = readJson('data/raw/arvin-imax.json');
const derived = readJson('data/derived/cinemas.json');
const audit = readJson('data/audit/screen-seat-web-review.json');
const decisions = readJson('data/audit/screen-seat-web-review-decisions.json');

const rawRows = new Map((raw.rows ?? []).filter((row) => row.rowType === 'data').map((row) => [row.rowIndex, row]));
const decisionsById = new Map((decisions.records ?? []).map((decision) => [decision.id, decision]));
const derivedById = new Map((derived.records ?? []).map((record) => [record.id, record]));

assert.equal(rawRows.size, 901);
assert.equal(derived.records.length, 901);
assert.equal(audit.baseline.candidateCount, 312);
assert.equal(audit.baseline.excludedPureMissingCount, 163);
assert.deepEqual(audit.baseline.issueTypeCounts, {
  'screen-multivalue': 298,
  'screen-abnormal-text': 4,
  'screen-area-mismatch': 2,
  'seats-multivalue': 38,
  'seats-invalid': 0,
  'screen-missing': 163,
  'seats-missing': 8,
});
assert.equal(audit.reviewSummary.webCheckedCount, 312);
assert.deepEqual(audit.reviewSummary.classificationCounts, {
  'resolved-current': 1,
  'resolved-historical-transition': 0,
  'partially-resolved': 1,
  'unresolved-conflict': 31,
  'no-reliable-evidence': 279,
});
assert.equal(audit.reviewSummary.pendingCandidateCount, 0);
assert.equal(audit.reviewSummary.materializedCandidateCount, 2);
assert.equal(audit.reviewSummary.beforePendingConflictCount, 312);
assert.equal(audit.reviewSummary.afterPendingConflictCount, 311);
assert.equal(audit.reviewSummary.remainingPendingConflictCount, 311);
assert.equal(audit.reviewSummary.nonScreenSeatFieldChanges, 0);
assert.equal(audit.calibrationCase.found, true);
assert.equal(audit.calibrationCase.id, 'imax-cn-0265');

const materializedDecisions = [...decisionsById.values()].filter((decision) => decision.materialize === true);
assert.equal(materializedDecisions.length, 2);
assert.deepEqual(materializedDecisions.map((decision) => decision.id).sort(), ['imax-cn-0019', 'imax-cn-0048']);

for (const decision of decisions.records ?? []) {
  assert.deepEqual(decision.nonScreenSeatFieldChanges ?? [], [], `${decision.id} has an out-of-scope field change`);
  for (const field of decision.materializedFields ?? []) {
    assert.ok(['width', 'height', 'area', 'seats'].includes(field), `${decision.id} materializes an invalid field`);
  }
}

for (const record of derived.records) {
  const row = rawRows.get(record.sourceRow);
  assert.ok(row, `${record.id} has no raw source row`);
  assert.equal(record.screen.rawWidth, cell(row, 3), `${record.id} raw width changed`);
  assert.equal(record.screen.rawHeight, cell(row, 4), `${record.id} raw height changed`);
  assert.equal(record.screen.rawArea, cell(row, 5), `${record.id} raw area changed`);
  assert.equal(record.seatsRaw, cell(row, 6), `${record.id} raw seats changed`);

  const decision = decisionsById.get(record.id);
  const materializedFields = new Set(decision?.materialize === true ? decision.materializedFields ?? [] : []);
  const expectedWidth = materializedFields.has('width') ? decision.fields.width : parseSingleNumeric(cell(row, 3));
  const expectedHeight = materializedFields.has('height') ? decision.fields.height : parseSingleNumeric(cell(row, 4));
  const expectedArea = materializedFields.has('area') ? decision.fields.area : parseSingleNumeric(cell(row, 5));
  const expectedSeats = materializedFields.has('seats') ? decision.fields.seats : parseSeats(cell(row, 6));
  assert.equal(record.screen.width, expectedWidth, `${record.id} width was changed outside the decision`);
  assert.equal(record.screen.height, expectedHeight, `${record.id} height was changed outside the decision`);
  assert.equal(record.screen.area, expectedArea, `${record.id} area was changed outside the decision`);
  assert.equal(record.seats, expectedSeats, `${record.id} seats was changed outside the decision`);
}

const huanying = derivedById.get('imax-cn-0019');
assert.deepEqual({ width: huanying.screen.width, height: huanying.screen.height, area: huanying.screen.area, seats: huanying.seats }, { width: 25.88, height: 13.46, area: 348.345, seats: 329 });
assert.deepEqual(huanying.screenSeatReview.materializedFields, ['width', 'height', 'area']);

const zhengda = derivedById.get('imax-cn-0048');
assert.deepEqual({ width: zhengda.screen.width, height: zhengda.screen.height, area: zhengda.screen.area, seats: zhengda.seats }, { width: 24.38, height: 13.6, area: null, seats: 426 });
assert.deepEqual(zhengda.screenSeatReview.materializedFields, ['width', 'height', 'seats']);

const calibration = derivedById.get('imax-cn-0265');
assert.deepEqual({ width: calibration.screen.width, height: calibration.screen.height, area: calibration.screen.area, seats: calibration.seats }, { width: null, height: null, area: null, seats: null });
assert.equal(calibration.screen.rawWidth, '22.900\n21.987');
assert.equal(calibration.screen.rawHeight, '11.950\n11.486');
assert.equal(calibration.screen.rawArea, '273.6550\n252.5430');
assert.equal(calibration.seatsRaw, '412\n444');
assert.equal(calibration.screenSeatReview, undefined);

console.log(JSON.stringify({ ok: true, records: derived.records.length, candidates: audit.baseline.candidateCount, materializedRecords: materializedDecisions.length }, null, 2));

function cell(row, index) {
  return String(row.cells?.[index]?.displayValue ?? '');
}

function parseSingleNumeric(value) {
  const normalized = String(value ?? '').replace(/\u00a0/g, ' ').replace(/^\s+|\s+$/g, '');
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) return null;
  const line = lines[0].replace(/(?:米|m|平方米|个)\s*$/i, '').trim();
  return /^\d+(?:\.\d+)?$/.test(line) ? Number(line) : null;
}

function parseSeats(value) {
  const normalized = String(value ?? '').replace(/\u00a0/g, ' ').trim();
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}
