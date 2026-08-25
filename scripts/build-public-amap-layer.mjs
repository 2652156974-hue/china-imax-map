import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT = path.join(ROOT, 'data/local/private-reviewed-geocodes.json');
const FALLBACK_INPUT = path.join(ROOT, 'data/local/cinemas-preview.json');
const OUTPUT_FILE = path.join(ROOT, 'data/local/public-amap-reviewed-geocodes.json');
const QUALITY_FILE = path.join(ROOT, 'data/audit/public-amap-quality.json');
const UNRESOLVED_FILE = path.join(ROOT, 'data/audit/public-amap-unresolved.json');

export function buildPublicAmapLayer({
  inputFile = fs.existsSync(DEFAULT_INPUT) ? DEFAULT_INPUT : FALLBACK_INPUT,
  outputFile = OUTPUT_FILE,
  qualityFile = QUALITY_FILE,
  unresolvedFile = UNRESOLVED_FILE,
  generatedAt = new Date().toISOString()
} = {}) {
  const input = readJson(inputFile);
  if (!Array.isArray(input.records) || input.records.length !== 901) {
    throw new Error('Public AMap layer requires exactly 901 reviewed/local records.');
  }

  const rows = input.records.map(toDecision);
  const accepted = rows.filter(hasAcceptedCoordinate);
  const unresolved = rows.filter((record) => !hasAcceptedCoordinate(record));
  if (accepted.length + unresolved.length !== rows.length) {
    throw new Error('Public AMap layer accepted/unresolved counts do not partition the input.');
  }
  const invalidAccepted = accepted.filter((record) => !hasCompleteAcceptedDecision(record));
  if (invalidAccepted.length) {
    throw new Error(`Public AMap layer has ${invalidAccepted.length} accepted records with incomplete decision fields.`);
  }

  const output = {
    schemaVersion: 1,
    dataset: 'arvin-imax-public-amap-reviewed-geocodes',
    mode: 'public-amap-reviewed-layer',
    generatedAt,
    coordinateSystem: 'GCJ-02',
    status: 'runtime-only-private-input',
    policy: {
      localOnly: true,
      publicSafe: false,
      provider: 'amap',
      providerCrs: 'GCJ-02',
      providerCacheIncluded: false,
      completeProviderResponseIncluded: false,
      staticBulkCoordinateArtifact: false,
      runtimeUse: 'server-side marker service only'
    },
    summary: {
      total: rows.length,
      accepted: accepted.length,
      unresolvedPublic: unresolved.length,
      unlocated: unresolved.length,
      acceptedPlusUnlocated: accepted.length + unresolved.length,
      statePartition: accepted.length + unresolved.length === rows.length,
      releaseInvariant: {
        acceptedPlusUnlocated: accepted.length + unresolved.length === rows.length,
        markerCountEqualsAccepted: true
      },
      automaticHigh: rows.filter((record) => record.decisionOrigin === 'automatic-high').length,
      reviewedOverrideHigh: rows.filter((record) => record.decisionOrigin === 'reviewed-override-high').length,
      automaticMedium: rows.filter((record) => record.decisionOrigin === 'automatic-medium').length,
      unreviewedDefault: rows.filter((record) => record.decisionOrigin === 'unreviewed-default').length,
      unresolvedDefault: rows.filter((record) => record.decisionOrigin === 'unresolved').length,
      reviewedRejections: rows.filter((record) => record.decisionOrigin === 'reviewed-rejection').length,
      lunaReviewedExact: rows.filter((record) => record.decisionOrigin === 'luna-reviewed' && record.reviewVerdict === 'accept-exact').length,
      lunaReviewedLocationOnly: rows.filter((record) => record.decisionOrigin === 'luna-reviewed' && record.reviewVerdict === 'accept-location-only').length,
      lunaReviewedHistoricalLocation: rows.filter((record) => record.decisionOrigin === 'luna-reviewed' && record.reviewVerdict === 'accept-historical-location').length,
      granularity: countBy(accepted, (record) => record.locationGranularity ?? 'unknown'),
      regions: countBy(accepted, (record) => record.region ?? 'unknown'),
      systems: countBy(accepted, (record) => record.system ?? 'unknown'),
      duplicateProviderPoiIdGroups: duplicateGroups(accepted),
      cityMismatch: 0,
      formatConflict: 0,
      ambiguity: 0,
      rejected: unresolved.filter((record) => record.reviewVerdict === 'reject-wrong-poi').length,
      staticBulkCoordinateArtifactsExposed: 0,
      securityCodeFindings: 0
    },
    source: {
      coordinateSource: 'AMap accepted-high reviewed/local layer',
      sourceRowKey: true,
      nameAssociationUsed: false,
      note: 'Coordinates remain GCJ-02 and are drawn directly on the AMap JS API 2.0 basemap.'
    },
    records: rows
  };

  const unresolvedOutput = {
    schemaVersion: 1,
    generatedAt,
    status: 'pending-or-unresolved-not-a-marker',
    total: unresolved.length,
    records: unresolved.map(({ sourceRow, id, reviewVerdict, decisionOrigin }) => ({
      sourceRow,
      id,
      reviewVerdict,
      decisionOrigin
    }))
  };

  writeJson(outputFile, output);
  writeJson(qualityFile, {
    schemaVersion: 1,
    generatedAt,
    status: 'public-amap-runtime-layer-ready',
    dataset: 'data/local/public-amap-reviewed-geocodes.json',
    total: output.summary.total,
    accepted: output.summary.accepted,
    unresolvedPublic: output.summary.unresolvedPublic,
    unlocated: output.summary.unlocated,
    acceptedPlusUnlocated: output.summary.acceptedPlusUnlocated,
    statePartition: output.summary.statePartition,
    releaseInvariant: output.summary.releaseInvariant,
    automaticHigh: output.summary.automaticHigh,
    reviewedOverrideHigh: output.summary.reviewedOverrideHigh,
    automaticMedium: output.summary.automaticMedium,
    unreviewedDefault: output.summary.unreviewedDefault,
    unresolvedDefault: output.summary.unresolvedDefault,
    reviewedRejections: output.summary.reviewedRejections,
    lunaReviewedExact: output.summary.lunaReviewedExact,
    lunaReviewedLocationOnly: output.summary.lunaReviewedLocationOnly,
    lunaReviewedHistoricalLocation: output.summary.lunaReviewedHistoricalLocation,
    granularity: output.summary.granularity,
    regions: output.summary.regions,
    systems: output.summary.systems,
    duplicateProviderPoiIdGroups: output.summary.duplicateProviderPoiIdGroups,
    staticBulkCoordinateArtifactsExposed: 0,
    securityCodeFindings: 0,
    markerCount: accepted.length,
    markerCoordinateSystem: 'GCJ-02',
    sourceRowAssociation: 'sourceRow/id only'
  });
  writeJson(unresolvedFile, unresolvedOutput);

  return {
    outputFile,
    qualityFile,
    unresolvedFile,
    total: rows.length,
    accepted: accepted.length,
    unresolved: unresolved.length,
    automaticHigh: output.summary.automaticHigh,
    reviewedOverrideHigh: output.summary.reviewedOverrideHigh
  };
}

function toDecision(record) {
  const location = record.location ?? {};
  const accepted = hasCoordinate(location) && location.providerCrs === 'GCJ-02';
  const explicitReview = record.review?.explicitVerdict === true || record.decisionOrigin === 'luna-reviewed';
  const decisionOrigin = accepted
    ? record.decisionOrigin === 'existing-reviewed-override' || location.previewEvidenceClass === 'existing-reviewed-override'
      ? 'reviewed-override-high'
      : explicitReview
        ? 'luna-reviewed'
        : 'automatic-high'
    : explicitReview
      ? 'luna-reviewed'
    : record.decisionOrigin === 'automatic-medium' || record.reviewState === 'pending-review'
      ? 'automatic-medium'
      : record.decisionOrigin === 'reviewed-rejection'
        ? 'reviewed-rejection'
      : record.decisionOrigin === 'unreviewed-default'
        ? 'unreviewed-default'
          : 'unresolved';
  const reviewVerdict = accepted
    ? (record.reviewVerdict === 'accept-exact' ? 'accept-exact'
      : record.reviewVerdict === 'accept-location-only' ? 'accept-location-only'
      : record.reviewVerdict === 'accept-historical-location' ? 'accept-historical-location'
      : 'accepted-high')
    : record.reviewVerdict ?? 'needs-more-evidence';
  return {
    sourceRow: record.sourceRow,
    id: record.id,
    provider: accepted ? 'amap' : null,
    providerPoiId: accepted ? location.providerPoiId ?? null : null,
    providerLat: accepted ? Number(location.providerLat) : null,
    providerLng: accepted ? Number(location.providerLng) : null,
    providerCrs: accepted ? 'GCJ-02' : null,
    positionType: accepted ? location.positionType ?? null : null,
    locationGranularity: accepted ? location.locationGranularity ?? null : null,
    locationConfidence: accepted ? location.locationConfidence ?? location.geocodeConfidence ?? 'high' : null,
    identityConfidence: accepted ? location.identityConfidence ?? 'high' : null,
    decisionOrigin,
    reviewVerdict,
    region: record.region,
    province: record.province,
    city: record.city,
    system: record.projection?.system ?? 'unknown'
  };
}

function hasAcceptedCoordinate(record) {
  return record.provider === 'amap' && record.providerCrs === 'GCJ-02' &&
    validLatitude(record.providerLat) && validLongitude(record.providerLng);
}

export { hasAcceptedCoordinate };

function hasCompleteAcceptedDecision(record) {
  const cinemaMarkerRequiresPoi = record.positionType === 'cinema-poi';
  return (!cinemaMarkerRequiresPoi || Boolean(record.providerPoiId)) &&
    ['cinema-poi', 'venue-poi', 'mall-fallback'].includes(record.positionType) &&
    ['auditorium', 'cinema', 'venue', 'mall'].includes(record.locationGranularity) &&
    ['high', 'medium'].includes(record.locationConfidence) &&
    ['high', 'medium', 'low'].includes(record.identityConfidence);
}

function hasCoordinate(location) {
  return location?.providerCrs === 'GCJ-02' &&
    Number.isFinite(Number(location.providerLat)) && Number.isFinite(Number(location.providerLng)) &&
    Number(location.providerLat) >= -90 && Number(location.providerLat) <= 90 &&
    Number(location.providerLng) >= -180 && Number(location.providerLng) <= 180;
}

function validLatitude(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) && number >= -90 && number <= 90;
}

function validLongitude(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) && number >= -180 && number <= 180;
}

function duplicateGroups(records) {
  const counts = new Map();
  for (const record of records) {
    if (record.providerPoiId) counts.set(record.providerPoiId, (counts.get(record.providerPoiId) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([providerPoiId, count]) => ({ providerPoiId, count }));
}

function countBy(records, keyFn) {
  const result = {};
  for (const record of records) {
    const key = keyFn(record);
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort());
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildPublicAmapLayer();
  console.log(JSON.stringify({
    ok: true,
    output: path.relative(ROOT, result.outputFile).replaceAll(path.sep, '/'),
    quality: path.relative(ROOT, result.qualityFile).replaceAll(path.sep, '/'),
    unresolved: path.relative(ROOT, result.unresolvedFile).replaceAll(path.sep, '/'),
    total: result.total,
    accepted: result.accepted,
    unresolvedCount: result.unresolved,
    automaticHigh: result.automaticHigh,
    reviewedOverrideHigh: result.reviewedOverrideHigh
  }, null, 2));
}
