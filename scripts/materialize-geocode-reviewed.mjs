import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const MAINLAND_AUDIT_FILE = path.join(ROOT, 'data/audit/geocode-mainland-full.json');
const OVERRIDE_FILE = path.join(ROOT, 'data/geocode/reviewed-overrides.json');
const RISK_FILE = path.join(ROOT, 'data/audit/geocode-risk-review.json');
const HUMAN_REVIEW_FILE = path.join(ROOT, 'data/audit/geocode-risk-human-review-219.json');
const STATUS_FILE = path.join(ROOT, 'data/audit/geocode-materialization-status.json');
const OUTPUT_FILE = path.join(ROOT, 'data/derived/geocode-reviewed.json');

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check-only');

const derivedDocument = readJson(DERIVED_FILE);
const derivedRecords = Array.isArray(derivedDocument) ? derivedDocument : derivedDocument.records;
const mainlandAudit = readJson(MAINLAND_AUDIT_FILE);
const overrides = readJson(OVERRIDE_FILE);
const riskAudit = readJson(RISK_FILE);

if (!Array.isArray(derivedRecords) || derivedRecords.length !== 901) throw new Error('Expected 901 derived records');
if (!Array.isArray(mainlandAudit.records) || mainlandAudit.records.length !== 881) throw new Error('Expected 881 mainland geocode audit records');
if (!Array.isArray(riskAudit.records) || riskAudit.records.length !== 219) throw new Error('Expected the deduplicated 219-row risk review set');

const riskRows = new Set(riskAudit.records.map((record) => Number(record.sourceRow)));
const mainlandByRow = new Map(mainlandAudit.records.map((record) => [Number(record.sourceRow), record]));
const derivedByRow = new Map(derivedRecords.map((record) => [Number(record.sourceRow), record]));
const overrideByRow = new Map((overrides.records ?? []).map((record) => [Number(record.sourceRow), record]));
const humanReviewAvailable = fs.existsSync(HUMAN_REVIEW_FILE);
const humanReview = humanReviewAvailable ? readJson(HUMAN_REVIEW_FILE) : null;

const status = buildStatus();
writeJson(STATUS_FILE, status);

if (checkOnly) {
  console.log(JSON.stringify(status, null, 2));
  process.exit(humanReviewAvailable ? 0 : 2);
}
if (!humanReviewAvailable) {
  throw new Error(`Missing row-level human review artifact: ${relative(HUMAN_REVIEW_FILE)}. Refusing to materialize reviewed decisions from aggregate claims.`);
}

const reviewRows = validateHumanReview(humanReview);
const records = derivedRecords.map((base) => materializeRecord(base, reviewRows.get(Number(base.sourceRow))));
const summary = summarize(records);
writeJson(OUTPUT_FILE, {
  schemaVersion: 1,
  dataset: 'arvin-imax-geocode-reviewed-internal',
  generatedAt: new Date().toISOString(),
  status: 'complete-with-row-level-human-review',
  source: derivedDocument.source,
  inputs: {
    derived: relative(DERIVED_FILE),
    mainlandAudit: relative(MAINLAND_AUDIT_FILE),
    existingOverrides: relative(OVERRIDE_FILE),
    riskReview: relative(RISK_FILE),
    humanReview: relative(HUMAN_REVIEW_FILE),
    humanReviewSha256: hashFile(HUMAN_REVIEW_FILE)
  },
  precedence: [
    'reviewed replacement',
    'reviewed exact',
    'reviewed location-only',
    'existing reviewed override',
    'automaticHigh',
    'null/unresolved'
  ],
  summary,
  records
});
console.log(JSON.stringify({ ok: true, output: relative(OUTPUT_FILE), summary }, null, 2));

function buildStatus() {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: humanReviewAvailable ? 'row-level-human-review-file-present' : 'blocked-missing-row-level-human-review-file',
    expectedHumanReviewFile: relative(HUMAN_REVIEW_FILE),
    humanReviewFilePresent: humanReviewAvailable,
    aggregateClaimsAreNotMaterialized: true,
    inputs: {
      derivedRecords: derivedRecords.length,
      mainlandAuditRecords: mainlandAudit.records.length,
      riskReviewRecords: riskAudit.records.length,
      existingOverrideRecords: (overrides.records ?? []).length,
      derivedSha256: hashFile(DERIVED_FILE),
      mainlandAuditSha256: hashFile(MAINLAND_AUDIT_FILE),
      riskReviewSha256: hashFile(RISK_FILE)
    },
    expectedExternalSummary: {
      highSample: '150/150',
      riskReview: '219 rows; aggregate claim not used without row-level file',
      projectedMainlandLocated: '754/881; not reproduced locally'
    },
    safeBaselineMaterialization: {
      automaticHigh: mainlandAudit.records.filter((record) => decisionBucket(record) === 'automaticHigh').length,
      reviewedOverrideHigh: mainlandAudit.records.filter((record) => decisionBucket(record) === 'reviewedOverrideHigh').length,
      automaticMediumHeld: mainlandAudit.records.filter((record) => decisionBucket(record) === 'automaticMedium').length,
      unresolvedHeld: mainlandAudit.records.filter((record) => decisionBucket(record) === 'unresolved').length,
      coordinatesAppliedToExistingDerived: 0
    }
  };
}

function validateHumanReview(document) {
  if (!Array.isArray(document?.records)) throw new Error('Human review artifact must contain records[]');
  const byRow = new Map();
  for (const item of document.records) {
    const sourceRow = Number(item.sourceRow);
    if (!Number.isInteger(sourceRow) || !riskRows.has(sourceRow)) throw new Error(`Human review sourceRow ${item.sourceRow} is not in the 219-row risk set`);
    if (byRow.has(sourceRow)) throw new Error(`Duplicate human review sourceRow ${sourceRow}`);
    const decision = normalizeHumanDecision(item);
    if (!decision) throw new Error(`Unsupported or missing human decision for sourceRow ${sourceRow}`);
    if (decision !== 'reject' && !candidateFromReview(item)) {
      throw new Error(`Human review sourceRow ${sourceRow} has no selected/replacement candidate`);
    }
    byRow.set(sourceRow, { item, decision, candidate: candidateFromReview(item) });
  }
  if (byRow.size !== riskRows.size) throw new Error(`Human review has ${byRow.size} rows; expected all ${riskRows.size} risk rows`);
  return byRow;
}

function materializeRecord(base, reviewed) {
  const sourceRow = Number(base.sourceRow);
  const audit = mainlandByRow.get(sourceRow);
  const existingOverride = overrideByRow.get(sourceRow);
  let decision = 'unresolved';
  let origin = 'unresolved';
  let candidate = null;
  let review = null;

  if (reviewed) {
    review = reviewMetadata(reviewed.item, reviewed.decision);
    if (reviewed.decision !== 'reject') {
      candidate = reviewed.candidate;
      decision = reviewed.decision === 'exact' ? 'reviewedExact' : 'reviewedLocationOnly';
      origin = 'humanReview';
    }
  } else if (audit?.selected && decisionBucket(audit) === 'reviewedOverrideHigh') {
    candidate = audit.selected;
    decision = 'reviewedOverrideHigh';
    origin = 'existingOverride';
    review = audit.reviewedOverride ?? existingOverride ?? null;
  } else if (audit?.selected && decisionBucket(audit) === 'automaticHigh') {
    candidate = audit.selected;
    decision = 'automaticHigh';
    origin = 'automaticMatcher';
  }

  const location = candidate ? locationFromCandidate(candidate, decision) : emptyLocation();
  return {
    ...base,
    location,
    geocode: {
      decision,
      decisionOrigin: origin,
      automaticDecision: candidate?.automaticDecision ?? null,
      poiId: candidate?.poiId ?? null,
      poiName: candidate?.name ?? null,
      poiAddress: candidate?.address ?? null,
      provider: candidate?.provider?.provider ?? candidate?.providerName ?? 'amap',
      providerCrs: candidate?.provider?.providerCrs ?? candidate?.providerCrs ?? null,
      providerLat: numberOrNull(candidate?.provider?.providerLat ?? candidate?.providerLat),
      providerLng: numberOrNull(candidate?.provider?.providerLng ?? candidate?.providerLng),
      mapCrs: candidate?.map?.mapCrs ?? candidate?.mapCrs ?? null,
      mapLat: numberOrNull(candidate?.map?.lat ?? candidate?.lat),
      mapLng: numberOrNull(candidate?.map?.lng ?? candidate?.lng),
      positionType: candidate?.positionType ?? null,
      locationGranularity: candidate?.locationGranularity ?? null,
      locationConfidence: location.locationConfidence,
      identityConfidence: location.identityConfidence,
      geocodeSource: location.geocodeSource,
      review
    },
    reviewState: reviewed ? (reviewed.decision === 'reject' ? 'reviewed-rejected' : 'reviewed-approved') : 'not-reviewed'
  };
}

function locationFromCandidate(candidate, decision) {
  const providerLat = numberOrNull(candidate?.provider?.providerLat ?? candidate?.providerLat);
  const providerLng = numberOrNull(candidate?.provider?.providerLng ?? candidate?.providerLng);
  const mapLat = numberOrNull(candidate?.map?.lat ?? candidate?.lat);
  const mapLng = numberOrNull(candidate?.map?.lng ?? candidate?.lng);
  const locationConfidence = decision === 'reviewedLocationOnly'
    ? (candidate.locationConfidence === 'high' ? 'high' : 'medium')
    : candidate.locationConfidence ?? candidate.confidence ?? 'unknown';
  const identityConfidence = decision === 'reviewedLocationOnly'
    ? 'medium'
    : candidate.identityConfidence ?? candidate.confidence ?? 'unknown';
  return {
    lat: mapLat,
    lng: mapLng,
    providerLat,
    providerLng,
    providerCrs: candidate?.provider?.providerCrs ?? candidate?.providerCrs ?? null,
    mapCrs: candidate?.map?.mapCrs ?? candidate?.mapCrs ?? null,
    positionType: candidate.positionType ?? null,
    locationGranularity: candidate.locationGranularity ?? null,
    locationConfidence,
    identityConfidence,
    address: String(candidate.address ?? ''),
    geocodeConfidence: locationConfidence,
    geocodeSource: String(candidate.geocodeSource ?? sourceForPosition(candidate.positionType))
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

function candidateFromReview(item) {
  return item.selected ?? item.replacement?.selected ?? item.replacement ?? item.approvedCandidate ?? item.candidate ?? null;
}

function normalizeHumanDecision(item) {
  const value = String(item.decision ?? item.reviewDecision ?? item.result ?? item.disposition ?? '').toLowerCase().replace(/[ _]/g, '-');
  if (/reject|deny|wrong|不通过|拒绝/.test(value)) return 'reject';
  if (/location-only|locationonly|approve-location|仅位置|位置-only/.test(value)) return 'location-only';
  if (/exact|approve|accept|通过|精确/.test(value)) return 'exact';
  return null;
}

function reviewMetadata(item, decision) {
  return {
    decision,
    reviewer: item.reviewer ?? item.reviewedBy ?? null,
    reviewedAt: item.reviewedAt ?? item.reviewed_at ?? null,
    evidence: item.evidence ?? item.notes ?? item.reason ?? null,
    provenance: item.provenance ?? item.source ?? null,
    replacementProvided: Boolean(candidateFromReview(item))
  };
}

function decisionBucket(record) {
  if (!record.selected) return 'unresolved';
  const high = record.selected.automaticDecision === 'accepted-high';
  const medium = ['review-required-medium', 'review-required-ambiguous'].includes(record.selected.automaticDecision);
  if (record.overrideUsed) return high ? 'reviewedOverrideHigh' : medium ? 'reviewedOverrideMedium' : 'unresolved';
  return high ? 'automaticHigh' : medium ? 'automaticMedium' : 'unresolved';
}

function sourceForPosition(positionType) {
  if (positionType === 'mall-fallback') return 'amap:mall-fallback';
  if (positionType === 'venue-poi') return 'amap:venue-poi';
  if (positionType === 'cinema-poi') return 'amap:poi-search';
  return '';
}

function summarize(records) {
  const counts = {};
  for (const record of records) counts[record.geocode.decision] = (counts[record.geocode.decision] ?? 0) + 1;
  return {
    total: records.length,
    automaticHigh: counts.automaticHigh ?? 0,
    reviewedOverrideHigh: counts.reviewedOverrideHigh ?? 0,
    reviewedExact: counts.reviewedExact ?? 0,
    reviewedLocationOnly: counts.reviewedLocationOnly ?? 0,
    unresolved: counts.unresolved ?? 0,
    mapCoordinateCount: records.filter((record) => Number.isFinite(record.location.lat) && Number.isFinite(record.location.lng)).length,
    identityExactCount: records.filter((record) => ['automaticHigh', 'reviewedOverrideHigh', 'reviewedExact'].includes(record.geocode.decision) && record.location.identityConfidence === 'high').length
  };
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

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}
