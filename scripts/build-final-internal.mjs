import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const REVIEWED_FILE = path.join(ROOT, 'data/local/private-reviewed-geocodes.json');
const REGIONAL_FILE = path.join(ROOT, 'data/audit/geocode-hkmo-tw.json');
const RAW_FILE = path.join(ROOT, 'data/raw/arvin-imax.json');
const OUTPUT_FILE = path.join(ROOT, 'data/derived/cinemas-final-internal.json');
const STATUS_FILE = path.join(ROOT, 'data/audit/final-internal-materialization-status.json');

if (!fs.existsSync(REVIEWED_FILE)) {
  writeStatus({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'blocked-missing-private-reviewed-layer',
    requiredInputs: [relative(REVIEWED_FILE), relative(REGIONAL_FILE)],
    output: relative(OUTPUT_FILE),
    reason: 'Run build:private-reviewed after the strict row-level Luna review has been completed.'
  });
  throw new Error(`Missing private reviewed layer: ${relative(REVIEWED_FILE)}`);
}
if (!fs.existsSync(REGIONAL_FILE)) throw new Error(`Missing regional audit: ${relative(REGIONAL_FILE)}`);

const derived = readJson(DERIVED_FILE);
const reviewed = readJson(REVIEWED_FILE);
const regionalAudit = readJson(REGIONAL_FILE);
const raw = readJson(RAW_FILE);
const baseRecords = derived.records ?? derived;
const reviewedRecords = reviewed.records ?? [];
const regionalRecords = regionalAudit.records ?? [];

if (baseRecords.length !== 901) throw new Error('Expected 901 derived records');
if (reviewedRecords.length !== 901) throw new Error('Expected 901 reviewed records');
if (regionalRecords.length !== 20) throw new Error('Expected 20 regional audit records');

const rawByRow = new Map((raw.rows ?? [])
  .filter((row) => row.rowType === 'data')
  .map((row) => [Number(row.rowIndex), row]));
const reviewedByRow = new Map(reviewedRecords.map((record) => [Number(record.sourceRow), record]));
const baseByRow = new Map(baseRecords.map((record) => [Number(record.sourceRow), record]));

const records = reviewedRecords.map((reviewedRecord) => {
  const sourceRow = Number(reviewedRecord.sourceRow);
  const base = baseByRow.get(sourceRow);
  if (!base) throw new Error(`Missing derived record for sourceRow ${sourceRow}`);
  const location = reviewedRecord.location ?? emptyLocation();
  const geocode = toInternalGeocode(reviewedRecord);
  const rawRow = rawByRow.get(sourceRow);
  return {
    ...reviewedRecord,
    sourceName: reviewedRecord.name ?? base.name,
    historyRaw: String(rawRow?.cells?.[2]?.displayValue ?? ''),
    location,
    geocode,
    finalInternalProvenance: {
      sourceRow,
      reviewedLayer: relative(REVIEWED_FILE),
      regionalAudit: relative(REGIONAL_FILE),
      decisionOrigin: reviewedRecord.decisionOrigin ?? 'unresolved',
      reviewState: reviewedRecord.reviewState ?? 'unresolved'
    }
  };
});

const summary = summarize(records);
const output = {
  schemaVersion: 1,
  dataset: 'arvin-imax-final-internal',
  generatedAt: new Date().toISOString(),
  status: 'complete-internal-only',
  source: derived.source,
  inputs: {
    derived: relative(DERIVED_FILE),
    privateReviewedLayer: relative(REVIEWED_FILE),
    canonicalReviewedGeocodeFactSource: relative(REVIEWED_FILE),
    regionalAudit: relative(REGIONAL_FILE),
    rawHistorySource: relative(RAW_FILE),
    hashes: {
      derived: hashFile(DERIVED_FILE),
      privateReviewedLayer: hashFile(REVIEWED_FILE),
      regionalAudit: hashFile(REGIONAL_FILE),
      rawHistorySource: hashFile(RAW_FILE)
    }
  },
  publicationWarning: 'Internal dataset only. The public website uses a separate minimal AMap JS API 2.0 runtime marker layer.',
  summary,
  records
};

writeJson(OUTPUT_FILE, output);
writeStatus({
  schemaVersion: 1,
  generatedAt: output.generatedAt,
  status: 'complete-internal-only',
  output: relative(OUTPUT_FILE),
  recordCount: records.length,
  summary,
  accepted: summary.located,
  markerCount: summary.located,
  unlocated: summary.unlocated,
  acceptedPlusUnlocated: summary.located + summary.unlocated,
  releaseInvariant: {
    acceptedPlusUnlocated: summary.located + summary.unlocated === records.length,
    markerCountEqualsAccepted: true
  },
  privateReviewedLayer: relative(REVIEWED_FILE),
  canonicalReviewedGeocodeFactSource: relative(REVIEWED_FILE),
  canonicalSourcePolicy: 'Approved coordinates, review state, verdict and confidence are read from the private reviewed layer; provider cache, public layer, Luna package and derived output are not coordinate fact sources.',
  publicPublicationGate: 'AMAP_JS_API_2_RUNTIME'
});
console.log(JSON.stringify({ ok: true, output: relative(OUTPUT_FILE), summary }, null, 2));

function toInternalGeocode(record) {
  const location = record.location ?? {};
  const hasCoordinate = Number.isFinite(Number(location.providerLat)) && Number.isFinite(Number(location.providerLng)) && location.providerCrs === 'GCJ-02';
  return {
    decision: hasCoordinate ? (record.reviewVerdict === 'accept-exact' ? 'acceptedExact' : record.reviewVerdict === 'accept-location-only' ? 'acceptedLocationOnly' : 'located') : 'unresolved',
    decisionOrigin: record.decisionOrigin ?? 'unresolved',
    poiId: location.providerPoiId ?? null,
    poiName: null,
    poiAddress: location.address ?? null,
    provider: hasCoordinate ? 'amap' : null,
    providerCrs: location.providerCrs ?? null,
    providerLat: numberOrNull(location.providerLat),
    providerLng: numberOrNull(location.providerLng),
    mapCrs: location.mapCrs ?? null,
    mapLat: numberOrNull(location.lat),
    mapLng: numberOrNull(location.lng),
    positionType: location.positionType ?? null,
    locationGranularity: location.locationGranularity ?? null,
    locationConfidence: location.locationConfidence ?? 'unknown',
    identityConfidence: location.identityConfidence ?? 'unknown',
    geocodeSource: location.geocodeSource ?? null,
    review: record.review ?? null
  };
}

function regionalLocation(auditRecord) {
  const selected = auditRecord.selected;
  if (!selected?.map) return emptyLocation();
  const mapLat = numberOrNull(selected.map.lat);
  const mapLng = numberOrNull(selected.map.lng);
  const providerLat = numberOrNull(selected.provider?.providerLat);
  const providerLng = numberOrNull(selected.provider?.providerLng);
  const confidence = selected.locationConfidence ?? 'unknown';
  return {
    lat: mapLat,
    lng: mapLng,
    providerLat,
    providerLng,
    providerCrs: selected.provider?.providerCrs ?? 'WGS84',
    mapCrs: selected.map.mapCrs ?? 'WGS84',
    positionType: selected.positionType ?? null,
    locationGranularity: selected.locationGranularity ?? null,
    locationConfidence: confidence,
    identityConfidence: selected.identityConfidence ?? 'unknown',
    address: String(selected.address ?? ''),
    geocodeConfidence: confidence,
    geocodeSource: String(selected.geocodeSource ?? 'nominatim:search')
  };
}

function regionalGeocode(auditRecord) {
  const selected = auditRecord.selected;
  return {
    decision: auditRecord.decision === 'accepted-high' ? 'regionalExact'
      : selected ? 'regionalLocationOnly' : 'unresolved',
    decisionOrigin: selected ? 'regionalProvider' : 'unresolved',
    automaticDecision: auditRecord.automaticDecision ?? auditRecord.decision ?? null,
    poiId: selected?.poiId ?? null,
    poiName: selected?.name ?? null,
    poiAddress: selected?.address ?? null,
    provider: 'nominatim',
    providerCrs: selected?.provider?.providerCrs ?? null,
    providerLat: numberOrNull(selected?.provider?.providerLat),
    providerLng: numberOrNull(selected?.provider?.providerLng),
    mapCrs: selected?.map?.mapCrs ?? null,
    mapLat: numberOrNull(selected?.map?.lat),
    mapLng: numberOrNull(selected?.map?.lng),
    positionType: selected?.positionType ?? null,
    locationGranularity: selected?.locationGranularity ?? null,
    locationConfidence: selected?.locationConfidence ?? 'unknown',
    identityConfidence: selected?.identityConfidence ?? 'unknown',
    geocodeSource: selected?.geocodeSource ?? null,
    review: null
  };
}

function emptyLocation() {
  return {
    lat: null,
    lng: null,
    providerLat: null,
    providerLng: null,
    providerCrs: null,
    mapCrs: null,
    positionType: null,
    locationGranularity: null,
    locationConfidence: 'unknown',
    identityConfidence: 'unknown',
    address: '',
    geocodeConfidence: 'unknown',
    geocodeSource: ''
  };
}

function summarize(items) {
  const regionCounts = {};
  const decisionCounts = {};
  const granularityCounts = {};
  for (const item of items) {
    regionCounts[item.region] = (regionCounts[item.region] ?? 0) + 1;
    const decision = item.geocode?.decision ?? 'unresolved';
    decisionCounts[decision] = (decisionCounts[decision] ?? 0) + 1;
    const granularity = item.location?.locationGranularity ?? 'unresolved';
    granularityCounts[granularity] = (granularityCounts[granularity] ?? 0) + 1;
  }
  const located = items.filter((item) => item.reviewState === 'located' || (
    item.location?.providerCrs === 'GCJ-02' &&
    Number.isFinite(Number(item.location?.providerLat)) &&
    Number.isFinite(Number(item.location?.providerLng))
  )).length;
  const pendingReview = items.filter((item) => item.reviewState === 'pending-review').length;
  const unresolved = items.filter((item) => item.reviewState === 'unresolved').length;
  const unlocated = pendingReview + unresolved;
  return {
    total: items.length,
    located,
    pendingReview,
    unresolved,
    unlocated,
    acceptedPlusUnlocated: located + unlocated,
    statePartition: located + pendingReview + unresolved === items.length,
    regionCounts,
    decisionCounts,
    granularityCounts,
    coordinateCount: items.filter(hasProviderCoordinate).length,
    identityExactCount: items.filter((item) => item.location?.identityConfidence === 'high').length,
    locationOnlyCount: items.filter((item) => item.location?.identityConfidence !== 'high' && hasProviderCoordinate(item)).length
  };
}

function hasProviderCoordinate(item) {
  return item.location?.providerCrs === 'GCJ-02' &&
    Number.isFinite(Number(item.location?.providerLat)) &&
    Number.isFinite(Number(item.location?.providerLng));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeStatus(value) {
  writeJson(STATUS_FILE, value);
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}
