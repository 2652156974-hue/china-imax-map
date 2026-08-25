import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const ROOT = process.cwd();
const publicFile = path.join(ROOT, 'data/public/cinemas.json');
const derivedFile = path.join(ROOT, 'data/derived/cinemas.json');
const layerFile = path.resolve(process.env.PUBLIC_AMAP_REVIEWED_FILE || path.join(ROOT, 'data/local/public-amap-reviewed-geocodes.json'));
const qualityFile = path.join(ROOT, 'data/audit/public-amap-quality.json');
const readinessFile = path.join(ROOT, 'data/audit/public-release-readiness.json');
const manifestFile = path.join(ROOT, 'data/audit/public-release-manifest.json');
const document = readJson(publicFile);
const derived = readJson(derivedFile);
const layer = fs.existsSync(layerFile) ? readJson(layerFile) : null;
const quality = readJson(qualityFile);
const readiness = readJson(readinessFile);
const manifest = readJson(manifestFile);
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const records = document.records;
const derivedByRow = new Map((derived.records ?? []).map((record) => [record.sourceRow, record]));

check(document.schemaVersion === 1, 'schemaVersion must be 1');
check(document.dataset === 'arvin-imax-public-cinemas', 'public dataset name mismatch');
check(document.mode === 'public-amap-runtime', 'public dataset must declare public-amap-runtime mode');
check(document.status === 'publication-candidate', 'public dataset must be a publication candidate');
check(document.mapProvider === 'AMap JS API 2.0', 'public map provider must be AMap JS API 2.0');
check(document.coordinateSystem === 'GCJ-02', 'public coordinate system must be GCJ-02');
check(document.coordinatesPublished === 0, 'static public dataset must contain zero coordinates');
check(document.markerService?.method === 'POST' && document.markerService?.path === '/api/public/markers', 'public marker service contract missing');
check(Array.isArray(records) && records.length === 901, 'public dataset must contain 901 records');
check(document.source?.tabId === 'BB08J2' && document.source?.tab === 'IMAX中国', 'source tab mismatch');
check(document.policy?.amapCoordinatesIncluded === false, 'static public dataset must not include AMap coordinates');
check(document.policy?.runtimeAmapCoordinatesIncluded === true, 'runtime AMap coordinate policy missing');
check(document.policy?.amapRawCandidatesIncluded !== true, 'raw AMap candidates must be excluded');
check(document.policy?.providerCacheIncluded === false, 'provider cache must be excluded');
check(document.policy?.rawTencentSnapshotIncluded === false, 'raw Tencent snapshot must be excluded');
check(document.policy?.staticBulkCoordinateArtifacts === 0, 'static bulk coordinate artifact count must be zero');

const ids = new Set();
const rows = new Set();
let rawFieldMatches = 0;
for (const record of records ?? []) {
  const derivedRecord = derivedByRow.get(record.sourceRow);
  check(typeof record.id === 'string' && record.id.length > 0, 'record id missing');
  check(!ids.has(record.id), `duplicate id ${record.id}`); ids.add(record.id);
  check(Number.isInteger(record.sourceRow) && !rows.has(record.sourceRow), `duplicate/invalid sourceRow ${record.sourceRow}`); rows.add(record.sourceRow);
  check(derivedRecord?.id === record.id, `public id mismatch at sourceRow ${record.sourceRow}`);
  check(!Object.hasOwn(record, 'nameRaw'), `${record.id} exposes nameRaw`);
  check(typeof record.screen?.rawWidth === 'string' && typeof record.screen?.rawHeight === 'string' && typeof record.screen?.rawArea === 'string', `${record.id} raw screen fields missing`);
  check(typeof record.seatsRaw === 'string', `${record.id} seatsRaw missing`);
  if (derivedRecord) {
    for (const field of ['rawWidth', 'rawHeight', 'rawArea']) {
      check(record.screen[field] === derivedRecord.screen?.[field], `${record.id} screen.${field} differs from derived`);
      if (record.screen[field] === derivedRecord.screen?.[field]) rawFieldMatches += 1;
    }
    check(record.seatsRaw === derivedRecord.seatsRaw, `${record.id} seatsRaw differs from derived`);
    if (record.seatsRaw === derivedRecord.seatsRaw) rawFieldMatches += 1;
  }
  const location = record.location ?? {};
  check(location.lat === null && location.lng === null, `${record.id} leaks coordinates in static public data`);
  check(!Object.hasOwn(location, 'providerLat') && !Object.hasOwn(location, 'providerLng') && !Object.hasOwn(location, 'providerCrs'), `${record.id} exposes provider coordinates`);
  check(!JSON.stringify(record).match(/rawCandidates|rankedCandidates|provider-cache|securityJsCode|AMAP_JS_SECURITY_CODE/i), `${record.id} exposes forbidden public text`);
}
for (let sourceRow = 2; sourceRow <= 902; sourceRow += 1) check(rows.has(sourceRow), `missing sourceRow ${sourceRow}`);
check(rawFieldMatches === 3604, `public raw field comparison expected 3604 matches, got ${rawFieldMatches}`);

validateRuntimeLayer(layer, derivedByRow, check);
const runtimeEvidence = layer ? {
  accepted: (layer.records ?? []).filter(hasCoordinate).length,
  unresolved: (layer.records ?? []).filter((record) => !hasCoordinate(record)).length,
  total: layer.records?.length ?? 0,
  source: 'local-runtime-layer'
} : {
  accepted: quality.markerCount,
  unresolved: quality.unlocated,
  total: quality.total,
  source: 'committed-quality-audit'
};
check(document.runtimeMarkerCount === runtimeEvidence.accepted, 'public runtime marker count does not match runtime evidence');
if (!layer) {
  check(runtimeEvidence.total === 901 && runtimeEvidence.accepted === 901 && runtimeEvidence.unresolved === 0, 'committed runtime quality evidence must be 901/901/0');
  check(readiness.publicationReady === true, 'committed public readiness evidence is not publication-ready');
  const publicManifestEntry = manifest.files?.find((file) => file.path === 'data/public/cinemas.json');
  check(publicManifestEntry?.sha256 === hashFile(publicFile), 'committed public manifest does not match the static dataset');
}

const serialized = JSON.stringify(document);
check(!serialized.includes('AMAP_API_KEY'), 'public dataset contains Web Service key variable name');
check(!serialized.includes('AMAP_JS_SECURITY_CODE'), 'public dataset contains security code variable name');
if (process.env.AMAP_JS_API_KEY) check(!serialized.includes(process.env.AMAP_JS_API_KEY), 'public dataset contains the runtime Web JS key');
check(!serialized.includes('NaN') && !serialized.includes('Infinity'), 'public dataset contains invalid numeric text');

const result = {
  ok: errors.length === 0,
  status: document.status,
  mode: document.mode,
  records: records?.length ?? 0,
  staticCoordinates: document.coordinatesPublished,
  runtimeMarkerCount: document.runtimeMarkerCount,
  runtimeLayerAccepted: runtimeEvidence.accepted,
  runtimeEvidenceSource: runtimeEvidence.source,
  uniqueIds: ids.size,
  continuousSourceRows: [...rows].sort((a, b) => a - b).every((row, index) => row === index + 2),
  rawFieldMatches,
  errors
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;

function validateRuntimeLayer(runtimeLayer, derivedByRowMap, addError) {
  if (!runtimeLayer) {
    return;
  }
  addError(runtimeLayer.mode === 'public-amap-reviewed-layer', 'public AMap layer mode mismatch');
  addError(runtimeLayer.coordinateSystem === 'GCJ-02', 'public AMap layer coordinate system mismatch');
  addError(runtimeLayer.policy?.localOnly === true, 'public AMap layer must remain local-only');
  addError(runtimeLayer.policy?.providerCacheIncluded === false, 'public AMap layer contains provider cache');
  addError(!Object.hasOwn(runtimeLayer.policy ?? {}, 'rawCandidatesIncluded'), 'public AMap layer raw-candidate field must be absent');
  addError(Array.isArray(runtimeLayer.records) && runtimeLayer.records.length === 901, 'public AMap layer must contain 901 rows');
  const accepted = (runtimeLayer.records ?? []).filter(hasCoordinate);
  const unresolved = (runtimeLayer.records ?? []).filter((record) => !hasCoordinate(record));
  addError(runtimeLayer.summary?.total === runtimeLayer.records?.length, 'public AMap layer summary total mismatch');
  addError(runtimeLayer.summary?.accepted === accepted.length, 'public AMap layer accepted count mismatch');
  addError(runtimeLayer.summary?.unresolvedPublic === unresolved.length, 'public AMap layer unresolved count mismatch');
  addError(accepted.length + unresolved.length === runtimeLayer.records?.length, 'public AMap layer accepted/unresolved counts do not partition total');
  addError(document.runtimeMarkerCount === accepted.length, 'public runtime marker count must equal accepted marker count');
  const layerRows = new Set();
  for (const record of runtimeLayer.records ?? []) {
    addError(Number.isInteger(record.sourceRow) && !layerRows.has(record.sourceRow), `duplicate layer sourceRow ${record.sourceRow}`);
    layerRows.add(record.sourceRow);
    addError(derivedByRowMap.get(record.sourceRow)?.id === record.id, `layer id mismatch at sourceRow ${record.sourceRow}`);
    if (hasCoordinate(record)) {
      addError(record.provider === 'amap' && record.providerCrs === 'GCJ-02', `layer sourceRow ${record.sourceRow} is not AMap GCJ-02`);
      addError(record.positionType !== 'cinema-poi' || Boolean(record.providerPoiId), `layer sourceRow ${record.sourceRow} is a cinema marker missing providerPoiId`);
      addError(['auditorium', 'cinema', 'venue', 'mall'].includes(record.locationGranularity), `layer sourceRow ${record.sourceRow} has invalid locationGranularity`);
      addError(['high', 'medium'].includes(record.locationConfidence), `layer sourceRow ${record.sourceRow} has invalid locationConfidence`);
      addError(['high', 'medium', 'low'].includes(record.identityConfidence), `layer sourceRow ${record.sourceRow} has invalid identityConfidence`);
      addError(!Object.hasOwn(record, 'rawCandidates') && !Object.hasOwn(record, 'rankedCandidates'), `layer sourceRow ${record.sourceRow} exposes candidate data`);
    } else {
      addError(record.provider === null && record.providerLat === null && record.providerLng === null && record.providerCrs === null, `unresolved layer sourceRow ${record.sourceRow} contains coordinate fields`);
    }
  }
}

function hasCoordinate(record) {
  return record?.provider === 'amap' && record?.providerCrs === 'GCJ-02' &&
    Number.isFinite(Number(record.providerLat)) && Number.isFinite(Number(record.providerLng)) &&
    Number(record.providerLat) >= -90 && Number(record.providerLat) <= 90 &&
    Number(record.providerLng) >= -180 && Number(record.providerLng) <= 180;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
