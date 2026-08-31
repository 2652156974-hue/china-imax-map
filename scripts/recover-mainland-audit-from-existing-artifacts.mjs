import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminCompatibility, adminHierarchyAudit, isCountyLevelTarget } from './geocode/admin-divisions.mjs';
import { amapCoordinate } from './geocode/crs.mjs';
import { matcherFingerprint } from './geocode/blind-selection.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
throw new Error('Legacy recovery disabled: run scripts/repair-reconstructed-mainland-audit.mjs; fail-closed to prevent pseudo-complete or default-field audits.');
const FULL_FILE = path.join(ROOT, 'data/audit/geocode-mainland-full.json');
const QUALITY_FILE = path.join(ROOT, 'data/audit/geocode-mainland-quality.json');
const INCIDENT_DIR = path.join(ROOT, 'data/audit/incidents');
const PREVIEW_FILE = path.join(ROOT, 'data/local/cinemas-preview.json');
const FINAL_REVIEW_FILE = path.join(ROOT, 'data/audit/geocode-mainland-final-review.json');
const RISK_REVIEW_FILE = path.join(ROOT, 'data/audit/geocode-risk-review.json');
const FREEZE_FILE = path.join(ROOT, 'data/audit/geocode-mainland-freeze.json');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const CACHE_FILE = path.join(ROOT, 'data/geocode/provider-cache/amap.json');
const OVERRIDE_FILE = path.join(ROOT, 'data/geocode/reviewed-overrides.json');
const REQUIRED_COUNTY_CITIES = ['太仓', '昆山', '张家港', '常熟', '江阴', '宜兴', '余姚', '慈溪', '义乌', '桐乡', '海宁', '乐清', '温岭', '晋江', '石狮', '福清'];
const EXPECTED_MATCHER = 'a8b4edf9465594c7f2592861e1ba6a5692dece6c702104d98d6a1069c9787037';
const HISTORICAL_REQUEST_POLICY = {
  scope: 'mainland',
  dryRun: true,
  fullRunEnabled: true,
  applyEnabled: false,
  keySource: 'historical-frozen-run; provider runner not executed during recovery',
  keyPersisted: false,
  keyPrinted: false,
  providerCache: 'local-private-gitignored',
  minimumIntervalMs: 800,
  retryFailed: false,
  cacheOnly: false,
  maxNewRequests: 600,
  networkRequests: 1708,
  cacheHits: 182,
  providerErrors: 1,
  cacheEntriesAtStart: 1848,
  cacheEntriesAtEnd: 1848
};
const RECOVERY_NOTE = 'This is a transparent 881-row recovery composed from existing verified artifacts. It is not a byte-for-byte restoration of the overwritten audit and did not rerun, rescore, or query AMap.';

const preview = readJson(PREVIEW_FILE);
const finalReview = readJson(FINAL_REVIEW_FILE);
const riskReview = readJson(RISK_REVIEW_FILE);
const freeze = readJson(FREEZE_FILE);
const derived = readJson(DERIVED_FILE);
const cache = readJson(CACHE_FILE);
const overrides = readJson(OVERRIDE_FILE);
const activePartial = readJson(FULL_FILE);
const activeQualityPartial = readJson(QUALITY_FILE);

if (activePartial.status !== 'running' || activePartial.progress?.completed !== 40 || activePartial.records?.length !== 40) {
  throw new Error('Expected the known 40/881 running incident artifact before recovery');
}
if (activeQualityPartial.status !== 'running' || activeQualityPartial.evaluated !== 40) {
  throw new Error('Expected the known 40-row quality incident artifact before recovery');
}
if (freeze.hashes?.matcherSha256 !== EXPECTED_MATCHER) throw new Error('Frozen matcher fingerprint is unexpected');
if (matcherFingerprint(ROOT).value !== EXPECTED_MATCHER) throw new Error('Current matcher does not match the frozen fingerprint');
if (!Array.isArray(preview.records) || preview.records.length !== 901) throw new Error('Preview must contain all 901 records');
if (!Array.isArray(finalReview.records) || finalReview.records.length !== 303) throw new Error('Final review must contain the verified 303 mainland remainder');
if (!Array.isArray(derived.records) || derived.records.length !== 901) throw new Error('Derived dataset must contain all 901 records');
if (!derived.records.every((record) => record.location?.lat === null && record.location?.lng === null)) {
  throw new Error('Recovery refuses to proceed because derived coordinates are not all null');
}
if (cache.requests.length !== 1848) throw new Error(`Expected 1848 provider-cache entries, got ${cache.requests.length}`);

const previewByRow = new Map(preview.records.map((record) => [Number(record.sourceRow), record]));
const finalByRow = new Map(finalReview.records.map((record) => [Number(record.sourceRow), record]));
const riskByRow = new Map((riskReview.records ?? []).map((record) => [Number(record.sourceRow), record]));
const overrideByRow = new Map((overrides.records ?? []).map((record) => [Number(record.sourceRow), record]));
const rawCandidatesById = new Map();
const rawCandidatesByRowAndId = new Map();
for (const request of cache.requests) {
  for (const candidate of request.rawCandidates ?? []) {
    if (candidate?.id && !rawCandidatesById.has(candidate.id)) rawCandidatesById.set(candidate.id, candidate);
    for (const sourceRow of request.sourceRows ?? []) {
      rawCandidatesByRowAndId.set(`${Number(sourceRow)}|${candidate.id}`, candidate);
    }
  }
}

const mainlandSources = preview.records.filter((record) => record.region === '中国大陆');
const locatedSources = mainlandSources.filter((record) => record.location?.providerPoiId);
if (locatedSources.length !== 577) throw new Error(`Expected 577 existing preview coordinates, got ${locatedSources.length}`);
const recoveredRecords = [];
for (const source of locatedSources) recoveredRecords.push(recoverLocated(source));
for (const reviewRecord of finalReview.records) recoveredRecords.push(recoverReview(reviewRecord));
const historicalRow825 = previewByRow.get(825);
if (!historicalRow825 || historicalRow825.location?.providerPoiId) throw new Error('Expected current row825 to be null after reviewed rejection');
recoveredRecords.push(recoverHistoricalRow825(historicalRow825));

const sourceRows = new Set(mainlandSources.map((record) => Number(record.sourceRow)));
const recoveredRows = new Set(recoveredRecords.map((record) => Number(record.sourceRow)));
if (recoveredRows.size !== 881 || recoveredRecords.length !== 881) throw new Error(`Recovery produced ${recoveredRecords.length} rows / ${recoveredRows.size} unique sourceRows`);
for (const sourceRow of sourceRows) if (!recoveredRows.has(sourceRow)) throw new Error(`Recovery missing mainland sourceRow ${sourceRow}`);
for (const sourceRow of recoveredRows) if (!sourceRows.has(sourceRow)) throw new Error(`Recovery added non-mainland sourceRow ${sourceRow}`);

const summary = summarize(recoveredRecords);
assertDeepEqual(summary, {
  evaluated: 881,
  automaticHigh: 574,
  automaticMedium: 109,
  reviewedOverrideHigh: 4,
  reviewedOverrideMedium: 0,
  unresolved: 194,
  coverage: 0.779796
}, 'recovered frozen summary');

const restoration = {
  status: 'restored-from-existing-verified-artifacts',
  exactOriginalCopyFound: false,
  byteForByteRestored: false,
  providerRunnerExecuted: false,
  providerRescored: false,
  recoveryNetworkRequests: 0,
  recoveryCacheHits: 0,
  recordsComposed: 881,
  incidentInput: 'data/audit/incidents/geocode-mainland-full-cache-only-partial-20260821.json',
  sourceArtifacts: [
    'data/audit/geocode-mainland-freeze.json',
    'data/local/cinemas-preview.json',
    'data/audit/geocode-mainland-final-review.json',
    'data/audit/geocode-risk-review.json',
    'data/derived/cinemas.json',
    'data/geocode/provider-cache/amap.json'
  ],
  sourceArtifactSha256: Object.fromEntries([
    ['data/audit/geocode-mainland-freeze.json', sha256(FREEZE_FILE)],
    ['data/local/cinemas-preview.json', sha256(PREVIEW_FILE)],
    ['data/audit/geocode-mainland-final-review.json', sha256(FINAL_REVIEW_FILE)],
    ['data/audit/geocode-risk-review.json', sha256(RISK_REVIEW_FILE)],
    ['data/derived/cinemas.json', sha256(DERIVED_FILE)],
    ['data/geocode/provider-cache/amap.json', sha256(CACHE_FILE)]
  ]),
  note: RECOVERY_NOTE
};

const generatedAt = new Date().toISOString();
const matcher = matcherFingerprint(ROOT);
const coordinatePolicy = {
  provider: 'AMap',
  providerCrs: 'GCJ-02',
  mapCrs: 'WGS84',
  providerCoordinatesPreserved: true,
  cityCenterFallbackAllowed: false,
  coordinatesAppliedToDerived: 0
};
const fullAudit = {
  schemaVersion: 1,
  generatedAt,
  startedAt: freeze.generatedAt,
  status: 'complete-dry-run-awaiting-review',
  mode: 'mainland-full-poi-dry-run-recovered',
  matcher,
  adminHierarchy: adminHierarchyAudit(),
  progress: { completed: 881, totalMainland: 881 },
  summary,
  requestPolicy: HISTORICAL_REQUEST_POLICY,
  coordinatePolicy,
  restoration,
  records: recoveredRecords
};

const quality = buildQualityAudit(recoveredRecords, summary, generatedAt, matcher, coordinatePolicy, restoration);
writeIncidentCopies(activePartial, activeQualityPartial);
atomicWrite(FULL_FILE, fullAudit);
atomicWrite(QUALITY_FILE, quality);

console.log(JSON.stringify({
  ok: true,
  status: fullAudit.status,
  records: fullAudit.records.length,
  summary,
  matcherSha256: matcher.value,
  providerRunnerExecuted: false,
  recoveryNetworkRequests: 0,
  historicalNetworkRequestsRetainedInAudit: HISTORICAL_REQUEST_POLICY.networkRequests,
  cacheEntries: cache.requests.length,
  exactOriginalCopyFound: false,
  byteForByteRestored: false,
  incidentCopies: restoration.incidentInput
}, null, 2));

function recoverLocated(source) {
  const location = source.location;
  const raw = rawFor(Number(source.sourceRow), location.providerPoiId);
  if (!raw) throw new Error(`Missing cached raw candidate ${location.providerPoiId} for sourceRow ${source.sourceRow}`);
  const override = overrideByRow.get(Number(source.sourceRow));
  const selected = candidateFromRaw(raw, source, {
    positionType: location.positionType,
    locationGranularity: location.locationGranularity,
    locationConfidence: location.locationConfidence,
    identityConfidence: location.identityConfidence,
    confidence: location.geocodeConfidence,
    geocodeSource: location.geocodeSource,
    map: { mapCrs: location.mapCrs ?? 'WGS84', lat: location.lat, lng: location.lng },
    automaticDecision: 'accepted-high',
    reviewedOverride: override ? { evidence: override.evidence, provenance: override.provenance } : null
  });
  return auditRecord(source, selected, null, Boolean(override), override ? compactOverride(override, true) : null);
}

function recoverReview(reviewRecord) {
  const source = previewByRow.get(Number(reviewRecord.sourceRow));
  if (!source) throw new Error(`Missing preview sourceRow ${reviewRecord.sourceRow}`);
  const selected = reviewRecord.selectedCandidate
    ? candidateFromReview(reviewRecord.selectedCandidate, source)
    : null;
  const top = selected
    ? null
    : reviewRecord.topCandidate
      ? candidateFromReview(reviewRecord.topCandidate, source)
      : null;
  return auditRecord(source, selected, top, false, null, reviewRecord);
}

function recoverHistoricalRow825(source) {
  const raw = rawFor(825, 'B0KRFSJADF');
  if (!raw) throw new Error('Missing frozen row825 cached candidate B0KRFSJADF');
  const location = amapCoordinate(raw);
  const selected = candidateFromRaw(raw, source, {
    positionType: 'cinema-poi',
    locationGranularity: 'cinema',
    locationConfidence: 'high',
    identityConfidence: 'high',
    confidence: 'high',
    geocodeSource: 'amap:poi-search',
    map: { mapCrs: location?.mapCrs ?? 'WGS84', lat: location?.lat ?? null, lng: location?.lng ?? null },
    automaticDecision: 'accepted-high',
    reviewedOverride: null
  });
  return auditRecord(source, selected, null, false, null, null, true);
}

function auditRecord(source, selected, topCandidate, overrideUsed, reviewedOverride, reviewRecord = null, historicalRow825 = false) {
  const risk = riskByRow.get(Number(source.sourceRow));
  return {
    sourceRow: Number(source.sourceRow),
    sourceName: source.name,
    city: source.city,
    province: source.province,
    status: statusFor(source),
    projection: {
      raw: source.projection?.raw ?? '',
      system: source.projection?.system ?? '',
      technology: source.projection?.technology ?? '',
      dome: Boolean(source.projection?.dome),
      audioChannels: source.projection?.audioChannels ?? null
    },
    sourceCategory: sourceCategory(source),
    countyLevelCity: isCountyLevelTarget(source.city),
    queryVariants: [],
    selected,
    topCandidate,
    hardRejectSummary: risk?.hardRejectSummary ?? fallbackHardRejectSummary(selected, topCandidate),
    ambiguity: risk?.ambiguity ?? { evaluatedCandidates: selected || topCandidate ? 1 : 0, ignoredHardRejected: 0, trueAmbiguity: false },
    overrideUsed,
    reviewedOverride,
    ...(reviewRecord ? { recoveryBaselineDecision: reviewRecord.baselineDecision, recoveryReason: reviewRecord.reason } : {}),
    ...(historicalRow825 ? { recoveryHistoricalNote: 'Retained only in the frozen mainland baseline; the current reviewed rejection remains effective for private/public materialization.' } : {})
  };
}

function candidateFromRaw(raw, source, overridesForCandidate) {
  const converted = amapCoordinate(raw);
  const providerLat = Number(raw.location?.split(',')?.[1]);
  const providerLng = Number(raw.location?.split(',')?.[0]);
  const adminMatch = adminCompatibility(source, raw);
  return {
    poiId: raw.id,
    name: raw.name ?? '',
    address: raw.address ?? '',
    typecode: raw.typecode ?? '',
    positionType: overridesForCandidate.positionType ?? 'cinema-poi',
    locationGranularity: overridesForCandidate.locationGranularity ?? 'cinema',
    score: overridesForCandidate.score ?? null,
    automaticDecision: overridesForCandidate.automaticDecision ?? 'accepted-high',
    confidence: overridesForCandidate.confidence ?? 'high',
    locationConfidence: overridesForCandidate.locationConfidence ?? 'high',
    identityConfidence: overridesForCandidate.identityConfidence ?? 'high',
    geocodeSource: overridesForCandidate.geocodeSource ?? 'amap:poi-search',
    adminMatch,
    formatCompatibility: overridesForCandidate.formatCompatibility ?? { compatible: true, exactFormatMatch: false, conflicts: [] },
    provider: { providerCrs: 'GCJ-02', providerLat, providerLng },
    map: overridesForCandidate.map ?? { mapCrs: converted?.mapCrs ?? 'WGS84', lat: converted?.lat ?? null, lng: converted?.lng ?? null },
    reviewedOverride: overridesForCandidate.reviewedOverride ?? null
  };
}

function candidateFromReview(candidate, source) {
  const raw = rawFor(Number(source.sourceRow), candidate.poiId);
  const converted = raw ? amapCoordinate(raw) : null;
  const provider = candidate.provider ?? candidate.providerCoordinate ?? {};
  const map = candidate.map ?? candidate.mapCoordinate ?? {};
  const adminMatch = raw ? adminCompatibility(source, raw) : candidate.adminMatch ?? { compatible: true };
  return {
    poiId: candidate.poiId,
    name: candidate.name ?? raw?.name ?? '',
    address: candidate.address ?? raw?.address ?? '',
    typecode: candidate.typecode ?? raw?.typecode ?? '',
    positionType: candidate.positionType ?? 'cinema-poi',
    locationGranularity: candidate.locationGranularity ?? null,
    score: candidate.score ?? null,
    automaticDecision: candidate.decision ?? candidate.automaticDecision ?? null,
    confidence: candidate.confidence ?? (candidate.identityConfidence === 'high' ? 'high' : 'medium'),
    locationConfidence: candidate.locationConfidence ?? 'unknown',
    identityConfidence: candidate.identityConfidence ?? 'unknown',
    geocodeSource: candidate.geocodeSource ?? 'amap:poi-search',
    adminMatch,
    formatCompatibility: candidate.formatCompatibility ?? { compatible: true, exactFormatMatch: false, conflicts: [] },
    provider: {
      providerCrs: provider.providerCrs ?? provider.crs ?? 'GCJ-02',
      providerLat: provider.providerLat ?? provider.lat ?? null,
      providerLng: provider.providerLng ?? provider.lng ?? null
    },
    map: {
      mapCrs: map.mapCrs ?? map.crs ?? converted?.mapCrs ?? 'WGS84',
      lat: map.lat ?? converted?.lat ?? null,
      lng: map.lng ?? converted?.lng ?? null
    },
    reviewedOverride: null
  };
}

function rawFor(sourceRow, poiId) {
  return rawCandidatesByRowAndId.get(`${Number(sourceRow)}|${poiId}`) ?? rawCandidatesById.get(poiId) ?? null;
}

function statusFor(source) {
  return riskByRow.get(Number(source.sourceRow))?.status ?? source.status;
}

function sourceCategory(source) {
  return /科技馆|科学技术馆|科学馆|博物馆|天文馆|科技中心/.test(`${source.name ?? ''} ${source.nameRaw ?? ''}`)
    ? 'institutional-venue'
    : 'commercial-cinema';
}

function fallbackHardRejectSummary(selected, topCandidate) {
  return {
    candidateCount: selected || topCandidate ? 1 : 0,
    rejectedCandidateCount: 0,
    reasons: {}
  };
}

function compactOverride(override, applied) {
  return {
    sourceRow: override.sourceRow,
    status: override.status,
    provider: override.provider,
    poiId: override.poiId,
    confidence: override.confidence,
    positionType: override.positionType,
    evidence: override.evidence,
    provenance: override.provenance,
    applied,
    reason: null
  };
}

function buildQualityAudit(records, summary, generatedAt, matcher, coordinatePolicy, restoration) {
  const segmentDefinitions = {
    commercialCinema: (record) => record.sourceCategory === 'commercial-cinema',
    institutionalVenue: (record) => record.sourceCategory === 'institutional-venue',
    closed: (record) => record.status === 'closed',
    gtLaser: (record) => record.projection.system === 'GT Laser',
    dome: (record) => record.projection.dome === true,
    countyLevelCity: (record) => record.countyLevelCity
  };
  const segments = Object.fromEntries(Object.entries(segmentDefinitions).map(([name, predicate]) => [name, segmentSummary(records.filter(predicate))]));
  const countyRecords = records.filter((record) => record.countyLevelCity);
  const countyCities = [...new Set([...REQUIRED_COUNTY_CITIES, ...countyRecords.map((record) => record.city)])];
  const countyByCity = Object.fromEntries(countyCities.map((city) => [city, segmentSummary(countyRecords.filter((record) => record.city === city))]));
  const selectedRecords = records.filter((record) => record.selected);
  const duplicateSelections = duplicateSelectedPoiSelections(selectedRecords);
  const automaticHigh = records.filter((record) => decisionBucket(record) === 'automaticHigh');
  const reviewedOverrideHigh = records.filter((record) => decisionBucket(record) === 'reviewedOverrideHigh');
  const rejectionCounts = {};
  for (const record of records) for (const [reason, count] of Object.entries(record.hardRejectSummary?.reasons ?? {})) rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + count;
  return {
    schemaVersion: 1,
    generatedAt,
    startedAt: freeze.generatedAt,
    status: 'complete-dry-run-awaiting-review',
    mode: 'mainland-full-poi-quality-audit-recovered',
    totalMainland: 881,
    evaluated: records.length,
    matcher,
    adminHierarchy: adminHierarchyAudit(),
    summary,
    sourceSegments: segments,
    selectedPositionTypes: countValues(selectedRecords.map((record) => record.selected.positionType ?? 'unknown')),
    selectedGranularities: countValues(selectedRecords.map((record) => record.selected.locationGranularity ?? 'unknown')),
    rejectionCounts: {
      formatConflictRejected: rejectionCounts['auditorium-format-conflict'] ?? 0,
      cityMismatchRejected: rejectionCounts['city-mismatch'] ?? 0,
      projectMismatchRejected: rejectionCounts['project-mismatch'] ?? 0,
      brandMismatchRejected: rejectionCounts['brand-mismatch'] ?? 0,
      nonCinemaRejected: rejectionCounts['non-cinema-poi'] ?? 0,
      trueAmbiguity: records.filter((record) => record.ambiguity?.trueAmbiguity).length,
      allCandidateRejectReasons: rejectionCounts
    },
    entityIntegrity: {
      selectedRecords: selectedRecords.length,
      uniqueSelectedPoiIds: new Set(selectedRecords.map((record) => record.selected.poiId).filter(Boolean)).size,
      duplicateSelectedPoiIdCount: duplicateSelections.length,
      duplicateSelectedPoiRows: duplicateSelections.reduce((sum, item) => sum + item.records.length, 0),
      duplicateSelectedPoiSelections: duplicateSelections
    },
    countyLevelCities: {
      requiredCities: REQUIRED_COUNTY_CITIES,
      overall: segmentSummary(countyRecords),
      byCity: countyByCity
    },
    focusSets: {
      gtLaser: records.filter((record) => record.projection.system === 'GT Laser').map(compactReviewRecord),
      dome: records.filter((record) => record.projection.dome === true).map(compactReviewRecord),
      closed: records.filter((record) => record.status === 'closed').map(compactReviewRecord)
    },
    automaticHighRuleChecks: {
      checked: automaticHigh.length,
      formatCompatible: automaticHigh.every((record) => record.selected?.formatCompatibility?.compatible !== false),
      adminCompatible: automaticHigh.every((record) => record.selected?.adminMatch?.compatible === true),
      highLocationConfidence: automaticHigh.every((record) => record.selected?.locationConfidence === 'high'),
      highIdentityConfidence: automaticHigh.every((record) => record.selected?.identityConfidence === 'high')
    },
    reviewedOverrideChecks: {
      checked: reviewedOverrideHigh.length,
      formatCompatible: reviewedOverrideHigh.every((record) => record.selected?.formatCompatibility?.compatible !== false),
      adminCompatible: reviewedOverrideHigh.every((record) => record.selected?.adminMatch?.compatible === true),
      highLocationConfidence: reviewedOverrideHigh.filter((record) => record.selected?.locationConfidence === 'high').length,
      highIdentityConfidence: reviewedOverrideHigh.filter((record) => record.selected?.identityConfidence === 'high').length,
      mediumIdentityConfidence: reviewedOverrideHigh.filter((record) => record.selected?.identityConfidence === 'medium').length
    },
    manualReviewSet: {
      medium: records.filter((record) => decisionBucket(record).endsWith('Medium')).map(compactReviewRecord),
      unresolvedWithCandidateScoreAtLeast070: records.filter((record) => decisionBucket(record) === 'unresolved' && (record.topCandidate?.score ?? 0) >= 0.7).map(compactReviewRecord),
      venueOrMall: selectedRecords.filter((record) => ['venue-poi', 'mall-fallback'].includes(record.selected.positionType)).map(compactReviewRecord),
      trueAmbiguity: records.filter((record) => record.ambiguity?.trueAmbiguity).map(compactReviewRecord)
    },
    requestPolicy: HISTORICAL_REQUEST_POLICY,
    coordinatePolicy,
    restoration
  };
}

function summarize(records) {
  const buckets = countValues(records.map(decisionBucket));
  const automaticHigh = buckets.automaticHigh ?? 0;
  const automaticMedium = buckets.automaticMedium ?? 0;
  const reviewedOverrideHigh = buckets.reviewedOverrideHigh ?? 0;
  const reviewedOverrideMedium = buckets.reviewedOverrideMedium ?? 0;
  const unresolved = buckets.unresolved ?? 0;
  return {
    evaluated: records.length,
    automaticHigh,
    automaticMedium,
    reviewedOverrideHigh,
    reviewedOverrideMedium,
    unresolved,
    coverage: records.length ? Number(((automaticHigh + automaticMedium + reviewedOverrideHigh + reviewedOverrideMedium) / records.length).toFixed(6)) : 0
  };
}

function segmentSummary(records) {
  return { records: records.length, ...summarize(records) };
}

function decisionBucket(record) {
  const override = record.reviewedOverride;
  if (record.overrideUsed && override?.applied !== false) return override.confidence === 'high' ? 'reviewedOverrideHigh' : 'reviewedOverrideMedium';
  if (record.selected?.automaticDecision === 'accepted-high') return 'automaticHigh';
  if (['review-required-medium', 'review-required-ambiguous'].includes(record.selected?.automaticDecision)) return 'automaticMedium';
  return 'unresolved';
}

function compactReviewRecord(record) {
  return {
    sourceRow: record.sourceRow,
    sourceName: record.sourceName,
    city: record.city,
    status: record.status,
    projection: record.projection,
    decision: decisionBucket(record),
    selected: record.selected,
    topCandidate: record.topCandidate,
    hardRejectSummary: record.hardRejectSummary,
    ambiguity: record.ambiguity,
    overrideUsed: record.overrideUsed
  };
}

function duplicateSelectedPoiSelections(records) {
  const byPoiId = new Map();
  for (const record of records) {
    if (!record.selected?.poiId) continue;
    const rows = byPoiId.get(record.selected.poiId) ?? [];
    rows.push(record);
    byPoiId.set(record.selected.poiId, rows);
  }
  return [...byPoiId.entries()].filter(([, rows]) => rows.length > 1).map(([poiId, rows]) => ({
    poiId,
    records: rows.map((record) => ({ sourceRow: record.sourceRow, sourceName: record.sourceName, city: record.city, decision: decisionBucket(record), selectedName: record.selected.name }))
  }));
}

function countValues(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} mismatch: ${JSON.stringify(actual)}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeIncidentCopies(partial, qualityPartial) {
  fs.mkdirSync(INCIDENT_DIR, { recursive: true });
  fs.writeFileSync(path.join(INCIDENT_DIR, 'geocode-mainland-full-cache-only-partial-20260821.json'), `${JSON.stringify(partial, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(INCIDENT_DIR, 'geocode-mainland-quality-cache-only-partial-20260821.json'), `${JSON.stringify(qualityPartial, null, 2)}\n`, 'utf8');
}

function atomicWrite(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}
