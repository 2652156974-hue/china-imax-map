import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_FILE = path.join(ROOT, 'data/raw/arvin-imax.json');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const PUBLIC_FILE = path.join(ROOT, 'data/public/cinemas.json');
const LOCAL_FILE = path.join(ROOT, 'data/local/cinemas-preview.json');
const PRIVATE_FILE = path.join(ROOT, 'dist-private/data/cinemas.json');
const CSV_FILE = path.join(ROOT, 'data/derived/screen-seat-columns.csv');
const QUOTA_FILE = path.join(ROOT, 'data/audit/amap-quota-guard.json');
const OUTPUT_FILE = path.join(ROOT, 'data/audit/luna-dual-release-baseline.json');

const raw = readJson(RAW_FILE);
const rawRows = (raw.rows ?? []).filter((row) => row.rowType === 'data');
const derived = readJson(DERIVED_FILE);
const publicData = readJson(PUBLIC_FILE);
const localData = readJsonIfPresent(LOCAL_FILE);
const privateData = readJsonIfPresent(PRIVATE_FILE);
const quota = readJsonIfPresent(QUOTA_FILE);

const expectedRows = rawRows.map((row) => ({
  sourceRow: Number(row.rowIndex),
  name: displayValue(row, 0),
  rawWidth: displayValue(row, 3),
  rawHeight: displayValue(row, 4),
  rawArea: displayValue(row, 5),
  seatsRaw: displayValue(row, 6),
}));
const expectedCsv = buildCsv(expectedRows);
const csvText = fs.existsSync(CSV_FILE) ? fs.readFileSync(CSV_FILE, 'utf8') : null;
const csvRows = csvText === null ? [] : parseCsv(csvText);
const csvDataRows = csvRows[0]?.length === 5 && csvRows[0].join(',') === ['影城名称', '银幕宽度（米)', '银幕高度（米)', '银幕面积（平方米)', '座位数（个)'].join(',')
  ? csvRows.slice(1) : [];
const csvFieldMatch = csvDataRows.length === expectedRows.length && expectedRows.every((expected, index) => {
  const actual = csvDataRows[index];
  return actual?.length === 5 && actual[0] === expected.name && actual[1] === expected.rawWidth &&
    actual[2] === expected.rawHeight && actual[3] === expected.rawArea && actual[4] === expected.seatsRaw;
});

const layerChecks = {
  derived: compareLayer(derived.records, expectedRows),
  public: compareLayer(publicData.records, expectedRows),
  private: compareLayer(privateData?.records, expectedRows),
};
const publicBoundary = inspectPublicBoundary(publicData);
const privateBoundary = inspectPrivateBoundary(privateData);
const git = gitState();

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: 'baseline-captured-before-luna-dual-release-materialization',
  git,
  counts: {
    rawDataRows: rawRows.length,
    derivedRecords: countRecords(derived),
    publicRecords: countRecords(publicData),
    localPreviewRecords: countRecords(localData),
    privateRecords: countRecords(privateData),
    publicCoordinates: coordinateCount(publicData),
    localPreviewCoordinates: coordinateCount(localData),
    privateProviderCoordinates: providerCoordinateCount(privateData),
  },
  screenSeatAcceptance: {
    csvDataRows: csvDataRows.length,
    csvSha256: hashIfPresent(CSV_FILE),
    expectedCsvSha256: sha256Text(expectedCsv),
    csvFrozenHashMatches: csvText !== null && sha256Text(csvText) === sha256Text(expectedCsv),
    csvFieldsMatch4505: csvFieldMatch,
    expectedDisplayValues: expectedRows.length * 5,
    derivedRawFieldsMatched: layerChecks.derived.rawFieldsMatched,
    publicRawFieldsMatched: layerChecks.public.rawFieldsMatched,
    privateRawFieldsMatched: layerChecks.private.rawFieldsMatched,
    rawFieldsPerLayer: expectedRows.length * 4,
    rawFieldComparisonsAcrossLayers: [layerChecks.derived, layerChecks.public, layerChecks.private]
      .filter((layer) => layer.present).reduce((sum, layer) => sum + layer.compared, 0),
  },
  layerChecks,
  hashes: Object.fromEntries([
    ['data/raw/arvin-imax.json', RAW_FILE],
    ['data/derived/cinemas.json', DERIVED_FILE],
    ['data/public/cinemas.json', PUBLIC_FILE],
    ['data/local/cinemas-preview.json', LOCAL_FILE],
    ['dist-private/data/cinemas.json', PRIVATE_FILE],
    ['data/derived/screen-seat-columns.csv', CSV_FILE],
  ].map(([relative, file]) => [relative, hashIfPresent(file)])),
  quota: quota?.runBudget ?? null,
  publicBoundary,
  privateBoundary,
  networkRequestCounters: {
    amap: quota?.runBudget?.networkRequests ?? null,
    newAmapRequests: quota?.runBudget?.newAmapRequests ?? null,
    cacheHits: quota?.runBudget?.cacheHits ?? null,
    providerErrors: quota?.runBudget?.providerErrors ?? null,
  },
};

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ok: output.counts.rawDataRows === 901 && output.screenSeatAcceptance.csvFieldsMatch4505 &&
    output.screenSeatAcceptance.csvFrozenHashMatches,
  output: relative(OUTPUT_FILE),
  counts: output.counts,
  csv: output.screenSeatAcceptance,
  layers: output.layerChecks,
}, null, 2));

function compareLayer(records, expected) {
  if (!Array.isArray(records)) return { present: false, records: 0, rawFieldsMatched: false, compared: 0, mismatches: ['missing records'] };
  const byRow = new Map(records.map((record) => [Number(record.sourceRow), record]));
  const mismatches = [];
  let compared = 0;
  for (const expectedRow of expected) {
    const record = byRow.get(expectedRow.sourceRow);
    if (!record) {
      mismatches.push(`missing sourceRow ${expectedRow.sourceRow}`);
      continue;
    }
    const actual = {
      rawWidth: record.screen?.rawWidth ?? '',
      rawHeight: record.screen?.rawHeight ?? '',
      rawArea: record.screen?.rawArea ?? '',
      seatsRaw: record.seatsRaw ?? '',
    };
    for (const field of ['rawWidth', 'rawHeight', 'rawArea', 'seatsRaw']) {
      if (actual[field] !== expectedRow[field]) mismatches.push(`${expectedRow.sourceRow}.${field}`);
      compared += 1;
    }
  }
  return {
    present: true,
    records: records.length,
    rawFieldsMatched: records.length === expected.length && compared === expected.length * 4 &&
      mismatches.filter((item) => /\.(rawWidth|rawHeight|rawArea|seatsRaw)$/.test(item)).length === 0,
    compared,
    mismatches: mismatches.slice(0, 20),
    mismatchCount: mismatches.length,
  };
}

function inspectPublicBoundary(document) {
  const serialized = JSON.stringify(document ?? '');
  const records = document?.records ?? [];
  return {
    publicationGate: document?.publicationGate ?? null,
    coordinates: coordinateCount(document),
    providerCoordinates: records.filter((record) => Object.hasOwn(record?.location ?? {}, 'providerLat') || Object.hasOwn(record?.location ?? {}, 'providerLng')).length,
    amapProvenance: records.filter((record) => String(record?.location?.geocodeSource ?? '').toLowerCase().includes('amap')).length,
    rawCandidateText: serialized.includes('rawCandidates') || serialized.includes('rankedCandidates'),
    credentialLikeText: /AMAP_(API_KEY|JS_API_KEY|JS_SECURITY_CODE)|securityJsCode/i.test(serialized),
    rawNameField: records.filter((record) => Object.hasOwn(record, 'nameRaw')).length,
  };
}

function inspectPrivateBoundary(document) {
  const records = document?.records ?? [];
  return {
    present: Boolean(document),
    coordinateSystem: document?.coordinateSystem ?? null,
    providerCoordinates: providerCoordinateCount(document),
    invalidProviderCoordinates: records.filter((record) => {
      const location = record.location ?? {};
      const hasEither = location.providerLat !== null || location.providerLng !== null;
      return hasEither && (location.providerCrs !== 'GCJ-02' || !finite(location.providerLat) || !finite(location.providerLng));
    }).length,
    rawCandidateText: JSON.stringify(document ?? '').includes('rawCandidates'),
  };
}

function coordinateCount(document) {
  return (document?.records ?? []).filter((record) => finite(record?.location?.lat) && finite(record?.location?.lng)).length;
}

function providerCoordinateCount(document) {
  return (document?.records ?? []).filter((record) => record?.location?.providerCrs === 'GCJ-02' &&
    finite(record?.location?.providerLat) && finite(record?.location?.providerLng)).length;
}

function countRecords(document) {
  return Array.isArray(document?.records) ? document.records.length : 0;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function displayValue(row, index) {
  return String(row.cells?.[index]?.displayValue ?? '');
}

function buildCsv(rows) {
  const header = ['影城名称', '银幕宽度（米)', '银幕高度（米)', '银幕面积（平方米)', '座位数（个)'];
  return [header, ...rows.map((row) => [row.name, row.rawWidth, row.rawHeight, row.rawArea, row.seatsRaw])]
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
    .join('\r\n') + '\r\n';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\r' && text[index + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; index += 1; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonIfPresent(file) {
  return fs.existsSync(file) ? readJson(file) : null;
}

function hashIfPresent(file) {
  return fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256Text(value) {
  return sha256(Buffer.from(value, 'utf8'));
}

function gitState() {
  const run = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  return {
    branch: run(['branch', '--show-current']),
    head: run(['rev-parse', 'HEAD']),
    statusShort: run(['status', '--short']),
    dirty: run(['status', '--porcelain']) !== '',
  };
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}
