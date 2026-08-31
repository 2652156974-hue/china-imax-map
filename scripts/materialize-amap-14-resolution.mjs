import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gcj02ToWgs84 } from './geocode/crs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESOLUTION_INPUT = 'C:/Users/wuhan/Downloads/audit-unresolved-14-resolved.csv';
const CANONICAL_FILE = path.join(ROOT, 'data/local/private-reviewed-geocodes.json');
const AUDIT_OUTPUT = path.join(ROOT, 'data/audit/audit-unresolved-14-resolved-gcj02.csv');
const REPORT_OUTPUT = path.join(ROOT, 'data/audit/amap-14-resolution-materialization.json');
const EXPECTED_ROWS = 14;
const NATIVE_AMAP_ROWS = new Set([192, 790]);
const DECISION_MAP = {
  'same entity': {
    reviewVerdict: 'accept-exact',
    finalVerdict: 'accepted-exact'
  },
  'same mall/venue only': {
    reviewVerdict: 'accept-location-only',
    finalVerdict: 'accepted-location-only'
  },
  acceptedHistoricalLocation: {
    reviewVerdict: 'accept-historical-location',
    finalVerdict: 'accepted-historical-location'
  }
};

const resolutionRows = parseCsv(fs.readFileSync(RESOLUTION_INPUT, 'utf8'));
const canonical = readJson(CANONICAL_FILE);

if (!Array.isArray(canonical.records) || canonical.records.length !== 901) {
  throw new Error('Expected exactly 901 records in the private reviewed canonical layer.');
}
if (resolutionRows.length !== EXPECTED_ROWS) {
  throw new Error(`Expected exactly ${EXPECTED_ROWS} resolution rows.`);
}

const resolutionByKey = new Map();
for (const row of resolutionRows) {
  const key = recordKey(row.id, row.sourceRow);
  if (resolutionByKey.has(key)) throw new Error(`Duplicate resolution key: ${key}`);
  resolutionByKey.set(key, row);
}

const canonicalByKey = new Map(canonical.records.map((record) => [recordKey(record.id, record.sourceRow), record]));
const missingCanonical = resolutionRows.filter((row) => !canonicalByKey.has(recordKey(row.id, row.sourceRow)));
if (missingCanonical.length) {
  throw new Error(`Resolution rows missing from canonical: ${missingCanonical.map((row) => `${row.id}|${row.sourceRow}`).join(', ')}`);
}

const beforeRecords = canonical.records;
const beforeByKey = new Map(beforeRecords.map((record) => [recordKey(record.id, record.sourceRow), record]));
const rows = [];
const changedRecords = [];

const records = beforeRecords.map((record) => {
  const resolution = resolutionByKey.get(recordKey(record.id, record.sourceRow));
  if (!resolution) return record;

  const materialized = materializeRecord(record, resolution);
  changedRecords.push(materialized.audit);
  rows.push(materialized.record);
  return materialized.record;
});

if (changedRecords.length !== EXPECTED_ROWS) {
  throw new Error(`Materialized ${changedRecords.length} records instead of ${EXPECTED_ROWS}.`);
}

const rawMismatches = [];
const unexpectedNonTargetChanges = [];
for (const record of records) {
  const key = recordKey(record.id, record.sourceRow);
  const before = beforeByKey.get(key);
  if (!before) {
    rawMismatches.push({ key, field: 'record', reason: 'missing-before-record' });
    continue;
  }
  if (!resolutionByKey.has(key) && JSON.stringify(before) !== JSON.stringify(record)) {
    unexpectedNonTargetChanges.push(key);
  }
  if (resolutionByKey.has(key) && !sameRawFields(before, record)) {
    rawMismatches.push({ key, field: 'raw-source-fields', reason: 'changed' });
  }
}
if (rawMismatches.length || unexpectedNonTargetChanges.length) {
  throw new Error(JSON.stringify({ rawMismatches, unexpectedNonTargetChanges }, null, 2));
}

const providerCrsBefore = countBy(beforeRecords.map((record) => record.location?.providerCrs ?? null));
const providerCrsAfter = countBy(records.map((record) => record.location?.providerCrs ?? null));
const forwardRoundTripErrors = changedRecords.map((row) => ({
  id: row.id,
  sourceRow: row.sourceRow,
  latError: row.forwardCheckLatError,
  lngError: row.forwardCheckLngError
}));
const maxForwardLatError = Math.max(...forwardRoundTripErrors.map((row) => row.latError), 0);
const maxForwardLngError = Math.max(...forwardRoundTripErrors.map((row) => row.lngError), 0);

if (providerCrsAfter['GCJ-02'] !== 901 || maxForwardLatError > 1e-6 || maxForwardLngError > 1e-6) {
  throw new Error(JSON.stringify({ providerCrsAfter, maxForwardLatError, maxForwardLngError }, null, 2));
}

const generatedAt = new Date().toISOString();
const output = {
  ...canonical,
  generatedAt,
  records,
  summary: {
    ...canonical.summary,
    total: records.length,
    markerCount: records.filter(hasGcj02ProviderCoordinate).length,
    located: records.filter((record) => record.reviewState === 'located').length,
    pendingReview: records.filter((record) => record.reviewState === 'pending-review').length,
    unresolved: records.filter((record) => record.reviewState === 'unresolved').length,
    unlocated: records.filter((record) => record.reviewState !== 'located').length,
    acceptedPlusUnlocated: records.length,
    states: countBy(records.map((record) => record.reviewState ?? 'unresolved')),
    reviewVerdicts: countBy(records.map((record) => record.reviewVerdict ?? 'not-reviewed')),
    finalVerdicts: countBy(records.map((record) => record.finalVerdict ?? 'located')),
    finalUnresolvedReasons: countBy(records.map((record) => record.finalUnresolvedReason ?? null), { omitNull: true }),
    coordinateMaterialization: {
      targetProviderCrs: 'GCJ-02',
      mapRuntime: 'AMap JS API 2.0',
      recordsMaterialized: changedRecords.length,
      nativeAmapRows: [...NATIVE_AMAP_ROWS].sort((a, b) => a - b),
      providerCrsBefore,
      providerCrsAfter,
      maxForwardLatError,
      maxForwardLngError
    }
  }
};

fs.writeFileSync(CANONICAL_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
writeCsv(AUDIT_OUTPUT, [
  ...Object.keys(resolutionRows[0] ?? {}),
  'materializedTargetCrs',
  'runtimeProviderCrs',
  'runtimeProviderLat',
  'runtimeProviderLng',
  'runtimeMapCrs',
  'runtimeDisplayLat',
  'runtimeDisplayLng',
  'normalizationMethod',
  'forwardCheckLatError',
  'forwardCheckLngError',
  'releaseAction'
], changedRecords);

const report = {
  schemaVersion: 1,
  generatedAt,
  status: 'materialized-amap-gcj02',
  target: {
    renderer: 'AMap JS API 2.0',
    provider: 'AMap',
    providerCrs: 'GCJ-02',
    markerCrs: 'GCJ-02',
    mapDisplayCrsInCanonical: 'WGS84'
  },
  inputs: {
    resolution: RESOLUTION_INPUT,
    canonical: relative(CANONICAL_FILE)
  },
  counts: {
    resolutionRows: resolutionRows.length,
    materializedRows: changedRecords.length,
    nativeAmapRows: changedRecords.filter((row) => row.sourceCrs === 'GCJ-02').length,
    normalizedNonAmapRows: changedRecords.filter((row) => row.sourceCrs !== 'GCJ-02').length,
    rawFieldComparisons: records.length,
    rawFieldMismatches: rawMismatches.length,
    unexpectedNonTargetChanges: unexpectedNonTargetChanges.length,
    providerCrsBefore,
    providerCrsAfter
  },
  invariants: {
    allResolutionRowsMatchedCanonical: missingCanonical.length === 0,
    all14Materialized: changedRecords.length === EXPECTED_ROWS,
    allMarkersGcj02: records.every(hasGcj02ProviderCoordinate),
    nativeAmapCoordinatesPreserved: changedRecords.filter((row) => row.sourceCrs === 'GCJ-02').every((row) => row.providerLat === row.sourceLat && row.providerLng === row.sourceLng),
    nonAmapCoordinatesNormalized: changedRecords.filter((row) => row.sourceCrs !== 'GCJ-02').every((row) => row.runtimeProviderCrs === 'GCJ-02'),
    rawSourceFieldsPreserved: rawMismatches.length === 0,
    onlyAuthorizedRecordsChanged: unexpectedNonTargetChanges.length === 0,
    forwardRoundTripWithinTolerance: maxForwardLatError <= 1e-6 && maxForwardLngError <= 1e-6,
    allFinalDecisionsClosed: records.every((record) => record.reviewState === 'located' && record.finalUnresolvedReason == null)
  },
  normalization: {
    nativeAmap: 'Keep source AMap provider coordinates as GCJ-02; derive only canonical WGS84 display fields with existing gcj02ToWgs84 normalization.',
    nonAmap: 'Iteratively invert the existing gcj02ToWgs84 normalization, then verify by a forward conversion to WGS84 within 1e-6 degrees.',
    evidencePolicy: 'Preserve source/evidence CRS fields in historicalLocation and human-verification evidence; runtime marker fields use normalized GCJ-02.'
  },
  records: changedRecords.map((row) => ({
    id: row.id,
    sourceRow: row.sourceRow,
    name: row.name,
    sourceCrs: row.sourceCrs,
    providerCrs: row.runtimeProviderCrs,
    providerLat: row.runtimeProviderLat,
    providerLng: row.runtimeProviderLng,
    displayLat: row.runtimeDisplayLat,
    displayLng: row.runtimeDisplayLng,
    normalizationMethod: row.normalizationMethod,
    decision: row.resolvedGeocodeDecision
  }))
};
writeJson(REPORT_OUTPUT, report);

console.log(JSON.stringify({
  ok: Object.values(report.invariants).every(Boolean),
  canonical: relative(CANONICAL_FILE),
  audit: relative(AUDIT_OUTPUT),
  report: relative(REPORT_OUTPUT),
  counts: report.counts,
  invariants: report.invariants
}, null, 2));

function materializeRecord(record, resolution) {
  const sourceCrs = String(resolution.sourceCrs ?? '').trim().toUpperCase();
  const decision = DECISION_MAP[resolution.resolvedGeocodeDecision];
  if (!decision) throw new Error(`Unsupported resolvedGeocodeDecision for sourceRow ${record.sourceRow}: ${resolution.resolvedGeocodeDecision}`);
  if (!['WGS84', 'GCJ-02'].includes(sourceCrs)) throw new Error(`Unsupported source CRS for sourceRow ${record.sourceRow}: ${sourceCrs}`);
  if (NATIVE_AMAP_ROWS.has(Number(record.sourceRow)) !== (sourceCrs === 'GCJ-02')) {
    throw new Error(`Native AMap/source CRS mismatch for sourceRow ${record.sourceRow}.`);
  }
  if (record.reviewVerdict && record.reviewVerdict !== decision.reviewVerdict) {
    throw new Error(`Review verdict mismatch for sourceRow ${record.sourceRow}.`);
  }

  const sourceCoordinate = sourceCrs === 'GCJ-02'
    ? readCoordinate(resolution.lat, resolution.lng, record.sourceRow, 'native AMap source')
    : readCoordinate(resolution.resolvedLat, resolution.resolvedLng, record.sourceRow, 'WGS84 source');
  if (sourceCrs === 'WGS84' && !close(Number(record.location?.lat), sourceCoordinate.lat, 1e-7)) {
    throw new Error(`Canonical WGS84 latitude does not match resolution input for sourceRow ${record.sourceRow}.`);
  }
  if (sourceCrs === 'WGS84' && !close(Number(record.location?.lng), sourceCoordinate.lng, 1e-7)) {
    throw new Error(`Canonical WGS84 longitude does not match resolution input for sourceRow ${record.sourceRow}.`);
  }
  if (sourceCrs === 'GCJ-02' && !close(Number(record.location?.lat), sourceCoordinate.lat, 1e-7)) {
    throw new Error(`Canonical native AMap latitude does not match resolution input for sourceRow ${record.sourceRow}.`);
  }
  if (sourceCrs === 'GCJ-02' && !close(Number(record.location?.lng), sourceCoordinate.lng, 1e-7)) {
    throw new Error(`Canonical native AMap longitude does not match resolution input for sourceRow ${record.sourceRow}.`);
  }

  const provider = sourceCrs === 'GCJ-02'
    ? sourceCoordinate
    : wgs84ToGcj02(sourceCoordinate.lat, sourceCoordinate.lng);
  const display = sourceCrs === 'GCJ-02'
    ? gcj02ToWgs84(provider.lat, provider.lng)
    : sourceCoordinate;
  if (!display) throw new Error(`Unable to derive WGS84 display coordinate for sourceRow ${record.sourceRow}.`);

  const forward = gcj02ToWgs84(provider.lat, provider.lng);
  if (!forward) throw new Error(`Unable to verify GCJ-02 provider coordinate for sourceRow ${record.sourceRow}.`);
  const forwardCheckLatError = Math.abs(forward.lat - display.lat);
  const forwardCheckLngError = Math.abs(forward.lng - display.lng);
  const normalizationMethod = sourceCrs === 'GCJ-02'
    ? 'native-amap-gcj02; gcj02ToWgs84-display-normalization'
    : 'wgs84-to-gcj02-inverse-of-existing-normalization';
  const coordinateNormalization = {
    sourceCrs,
    sourceLat: sourceCoordinate.lat,
    sourceLng: sourceCoordinate.lng,
    targetCrs: 'GCJ-02',
    providerLat: provider.lat,
    providerLng: provider.lng,
    mapCrs: 'WGS84',
    displayLat: display.lat,
    displayLng: display.lng,
    method: normalizationMethod,
    forwardCheckLatError,
    forwardCheckLngError
  };

  const location = {
    ...(record.location ?? {}),
    lat: display.lat,
    lng: display.lng,
    providerLat: provider.lat,
    providerLng: provider.lng,
    providerCrs: 'GCJ-02',
    mapCrs: 'WGS84',
    coordinateNormalization
  };
  const review = record.review
    ? {
      ...record.review,
      verdict: decision.reviewVerdict,
      explicitVerdict: true,
      reviewedCandidate: normalizeReviewedCandidate(record.review.reviewedCandidate, provider, sourceCrs),
      coordinateNormalization
    }
    : record.review;
  const supplemental = record.supplemental
    ? { ...record.supplemental, coordinateNormalization }
    : record.supplemental;
  const updated = {
    ...record,
    location,
    review,
    supplemental,
    reviewVerdict: decision.reviewVerdict,
    reviewState: 'located',
    finalVerdict: decision.finalVerdict,
    finalUnresolvedReason: null
  };

  return {
    record: updated,
    audit: {
      ...resolution,
      materializedTargetCrs: 'GCJ-02',
      runtimeProviderCrs: 'GCJ-02',
      runtimeProviderLat: provider.lat,
      runtimeProviderLng: provider.lng,
      runtimeMapCrs: 'WGS84',
      runtimeDisplayLat: display.lat,
      runtimeDisplayLng: display.lng,
      normalizationMethod,
      forwardCheckLatError,
      forwardCheckLngError,
      releaseAction: 'accepted-as-amap-gcj02-runtime-marker'
    }
  };
}

function normalizeReviewedCandidate(candidate, provider, sourceCrs) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
  return {
    ...candidate,
    providerCrs: 'GCJ-02',
    providerLat: provider.lat,
    providerLng: provider.lng,
    coordinateNormalization: {
      sourceCrs,
      targetCrs: 'GCJ-02',
      sourceLat: numberOrNull(candidate.providerLat),
      sourceLng: numberOrNull(candidate.providerLng),
      providerLat: provider.lat,
      providerLng: provider.lng
    }
  };
}

function wgs84ToGcj02(lat, lng) {
  let guess = { lat, lng };
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const projected = gcj02ToWgs84(guess.lat, guess.lng);
    if (!projected) throw new Error('Existing GCJ-02/WGS84 normalization returned no coordinate.');
    const deltaLat = lat - projected.lat;
    const deltaLng = lng - projected.lng;
    guess = { lat: guess.lat + deltaLat, lng: guess.lng + deltaLng };
    if (Math.abs(deltaLat) <= 1e-9 && Math.abs(deltaLng) <= 1e-9) break;
  }
  return { lat: round7(guess.lat), lng: round7(guess.lng) };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === '') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length) {
    row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  const [headers, ...data] = rows;
  if (!headers?.length) throw new Error('Resolution CSV has no header row.');
  headers[0] = headers[0].replace(/^\ufeff/, '');
  return data.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function writeCsv(file, headers, records) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const record of records) lines.push(headers.map((header) => csvEscape(record[header])).join(','));
  fs.writeFileSync(file, `\ufeff${lines.join('\n')}\n`, 'utf8');
}

function csvEscape(value) {
  return `"${String(value ?? '').replaceAll('"', '""').replaceAll('\r', ' ').replaceAll('\n', ' ')}"`;
}

function sameRawFields(before, after) {
  const fields = [
    'id', 'sourceRow', 'sheetRow', 'name', 'nameRaw', 'formerNames', 'unparsedNameLines',
    'region', 'province', 'city', 'projection', 'screen', 'seats', 'seatsRaw', 'status',
    'historySummary', 'source'
  ];
  return fields.every((field) => JSON.stringify(before[field]) === JSON.stringify(after[field]));
}

function hasGcj02ProviderCoordinate(record) {
  return record?.location?.providerCrs === 'GCJ-02' &&
    finiteCoordinate(record.location.providerLat, -90, 90) &&
    finiteCoordinate(record.location.providerLng, -180, 180);
}

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

function readCoordinate(lat, lng, sourceRow, label) {
  const coordinate = { lat: Number(lat), lng: Number(lng) };
  if (!finiteCoordinate(coordinate.lat, -90, 90) || !finiteCoordinate(coordinate.lng, -180, 180)) {
    throw new Error(`Invalid ${label} coordinate for sourceRow ${sourceRow}.`);
  }
  return coordinate;
}

function recordKey(id, sourceRow) {
  return `${String(id)}|${Number(sourceRow)}`;
}

function close(left, right, tolerance) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round7(value) {
  return Number(Number(value).toFixed(7));
}

function countBy(values, options = {}) {
  const counts = {};
  for (const value of values) {
    if (options.omitNull && (value === null || value === undefined || value === '')) continue;
    const key = value === null || value === undefined || value === '' ? 'null' : String(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort());
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}
