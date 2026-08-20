import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const derived = readJson('data/derived/cinemas.json');
const review = readJson('data/derived/review-needed.json');
const schema = readJson('data/derived/cinemas.schema.json');
const raw = readJson('data/raw/arvin-imax.json');

const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isNullableNumber = (value) => value === null || isFiniteNumber(value);
const sourceRows = raw.rows.filter((row) => row.rowType === 'data');
const rawByRow = new Map(sourceRows.map((row) => [row.rowIndex, row]));

check(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', 'schema file is not draft 2020-12');
check(derived.schemaVersion === 1, 'derived schemaVersion must be 1');
check(derived.dataset === 'arvin-imax-derived-cinemas', 'derived dataset name mismatch');
check(derived.source?.tabId === 'BB08J2' && derived.source?.tab === 'IMAX中国', 'derived source tab mismatch');
check(Array.isArray(derived.records), 'derived.records must be an array');
check(derived.records.length === 901, `expected 901 derived records, got ${derived.records.length}`);
check(sourceRows.length === 901, `expected 901 raw data rows, got ${sourceRows.length}`);
check(Array.isArray(review.records), 'review.records must be an array');

const ids = new Set();
const rows = new Set();
const requiredRecordFields = ['id', 'sourceRow', 'name', 'formerNames', 'region', 'province', 'city', 'projection', 'screen', 'seats', 'seatsRaw', 'status', 'historySummary', 'location', 'source'];
const validSystems = new Set(['GT Laser', 'Commercial Laser', 'Laser XT', 'Xenon', 'unknown']);
const validStatuses = new Set(['open', 'closed', 'temporarily_closed', 'unknown']);
const validConfidence = new Set(['high', 'medium', 'low', 'unknown']);

for (const record of derived.records) {
  for (const field of requiredRecordFields) check(Object.hasOwn(record, field), `${record.id || '<unknown>'} missing ${field}`);
  check(typeof record.id === 'string' && record.id.length > 0, 'record id must be non-empty string');
  check(!ids.has(record.id), `duplicate id ${record.id}`); ids.add(record.id);
  check(Number.isInteger(record.sourceRow) && record.sourceRow >= 2 && record.sourceRow <= 902, `${record.id} invalid sourceRow`);
  check(!rows.has(record.sourceRow), `duplicate sourceRow ${record.sourceRow}`); rows.add(record.sourceRow);
  check(record.formerNames.every((name) => typeof name === 'string'), `${record.id} formerNames type error`);
  check(validSystems.has(record.projection?.system), `${record.id} invalid projection system`);
  check(validStatuses.has(record.status), `${record.id} invalid status`);
  check(validConfidence.has(record.screen?.selectionConfidence), `${record.id} invalid screen confidence`);
  check(validConfidence.has(record.location?.geocodeConfidence), `${record.id} invalid geocode confidence`);
  for (const field of ['width', 'height', 'area']) check(isNullableNumber(record.screen?.[field]), `${record.id} invalid screen.${field}`);
  check(record.seats === null || (Number.isInteger(record.seats) && record.seats >= 0), `${record.id} invalid seats`);
  check(isNullableNumber(record.location?.lat) && isNullableNumber(record.location?.lng), `${record.id} invalid coordinate type`);
  const hasLat = record.location?.lat !== null;
  const hasLng = record.location?.lng !== null;
  check(hasLat === hasLng, `${record.id} has only one coordinate`);
  if (hasLat && hasLng) {
    check(record.location.lat >= -90 && record.location.lat <= 90, `${record.id} latitude out of range`);
    check(record.location.lng >= -180 && record.location.lng <= 180, `${record.id} longitude out of range`);
  }
  check(typeof record.screen?.rawWidth === 'string' && typeof record.screen?.rawHeight === 'string' && typeof record.screen?.rawArea === 'string', `${record.id} raw screen fields must be strings`);
  const rawRow = rawByRow.get(record.sourceRow);
  check(Boolean(rawRow), `${record.id} has no matching raw row`);
  if (rawRow) {
    check(record.nameRaw === String(rawRow.cells[0].displayValue ?? ''), `${record.id} nameRaw differs from raw displayValue`);
    check(record.projection.raw === String(rawRow.cells[1].displayValue ?? ''), `${record.id} projection.raw differs from raw displayValue`);
    check(record.screen.rawWidth === String(rawRow.cells[3].displayValue ?? ''), `${record.id} rawWidth differs from raw displayValue`);
    check(record.screen.rawHeight === String(rawRow.cells[4].displayValue ?? ''), `${record.id} rawHeight differs from raw displayValue`);
    check(record.screen.rawArea === String(rawRow.cells[5].displayValue ?? ''), `${record.id} rawArea differs from raw displayValue`);
    check(record.seatsRaw === String(rawRow.cells[6].displayValue ?? ''), `${record.id} seatsRaw differs from raw displayValue`);
  }
}

for (let expected = 2; expected <= 902; expected += 1) check(rows.has(expected), `missing derived sourceRow ${expected}`);
const reviewIds = new Set();
for (const item of review.records) {
  check(!reviewIds.has(item.id), `duplicate review id ${item.id}`); reviewIds.add(item.id);
  check(ids.has(item.id), `review item ${item.id} is not a derived record`);
  check(Array.isArray(item.reasonCodes) && item.reasonCodes.length > 0, `review item ${item.id} has no reasonCodes`);
}
for (const record of derived.records) {
  const unlocated = record.location.lat === null || record.location.lng === null;
  const inReview = reviewIds.has(record.id);
  check(!unlocated || inReview, `${record.id} unlocated but absent from review-needed`);
}

const serialized = JSON.stringify(derived);
check(!serialized.includes('NaN') && !serialized.includes('Infinity'), 'derived JSON contains NaN/Infinity text');

const result = {
  ok: errors.length === 0,
  schemaFileLoaded: true,
  recordCount: derived.records.length,
  reviewCount: review.records.length,
  uniqueIds: ids.size,
  continuousSourceRows: [...rows].sort((a, b) => a - b).every((row, index) => row === index + 2),
  coordinateCounts: {
    bothNull: derived.records.filter((record) => record.location.lat === null && record.location.lng === null).length,
    reliableOrCached: derived.records.filter((record) => record.location.lat !== null && record.location.lng !== null).length,
    invalid: errors.filter((error) => /coordinate|latitude|longitude/.test(error)).length,
  },
  rawDisplayFieldPreservation: errors.filter((error) => /differs from raw displayValue/.test(error)).length === 0,
  errors,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
