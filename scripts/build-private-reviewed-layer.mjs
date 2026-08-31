import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAcceptedReview } from './complete-luna-review.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_FILE = path.join(ROOT, 'data/local/cinemas-preview.json');
const REVIEW_FILE = path.join(ROOT, 'data/local/luna-geocode-review-323.completed.json');
const MAINLAND_AUDIT_FILE = path.join(ROOT, 'data/audit/geocode-mainland-full.json');
const REGIONAL_AUDIT_FILE = path.join(ROOT, 'data/audit/geocode-hkmo-tw.json');
const OUTPUT_FILE = path.join(ROOT, 'data/local/private-reviewed-geocodes.json');
const QUALITY_FILE = path.join(ROOT, 'data/audit/private-release-quality.json');

export function buildPrivateReviewedLayer({
  previewFile = PREVIEW_FILE,
  reviewFile = REVIEW_FILE,
  mainlandAuditFile = MAINLAND_AUDIT_FILE,
  regionalAuditFile = REGIONAL_AUDIT_FILE,
  outputFile = OUTPUT_FILE,
  qualityFile = QUALITY_FILE,
  generatedAt = new Date().toISOString(),
  allowFinalCanonicalReplacement = false
} = {}) {
  const preview = readJson(previewFile);
  const luna = readJson(reviewFile);
  const mainlandAudit = readJson(mainlandAuditFile);
  const regionalAudit = readJson(regionalAuditFile);
  const total = preview.records?.length ?? 0;
  if (!Array.isArray(preview.records) || total === 0) throw new Error('Private reviewed layer requires a non-empty local preview dataset.');
  if (!Array.isArray(luna.records)) throw new Error('Private reviewed layer requires a Luna review package.');
  if (luna.records.some((record) => Number(record.sourceRow) !== record.sourceRow || !record.id)) {
    throw new Error('Luna review records require sourceRow and id.');
  }

  const lunaByRow = new Map(luna.records.map((record) => [record.sourceRow, record]));
  const mainlandByRow = new Map((mainlandAudit.records ?? []).map((record) => [record.sourceRow, record]));
  const regionalByRow = new Map((regionalAudit.records ?? []).map((record) => [record.sourceRow, record]));

  const records = preview.records.map((record) => {
    const localLocated = hasProviderCoordinate(record);
    const lunaRecord = lunaByRow.get(record.sourceRow);
    if (lunaRecord && lunaRecord.id !== record.id) {
      throw new Error(`Luna sourceRow/id mismatch at sourceRow ${record.sourceRow}.`);
    }
    const lunaReview = lunaRecord?.review ?? null;
    const lunaAccepted = isAcceptedReview(lunaReview, lunaRecord);
    const explicitReview = lunaReview?.explicitVerdict === true;
    const reviewedRejection = record.reviewedRejection?.status === 'rejected-cached-poi'
      ? record.reviewedRejection
      : null;
    const sourceAudit = mainlandByRow.get(record.sourceRow) ?? regionalByRow.get(record.sourceRow);
    const automaticMedium = ['review-required-medium', 'review-required-ambiguous'].includes(sourceAudit?.selected?.automaticDecision);
    const reviewState = lunaAccepted
      ? 'located'
      : reviewedRejection || explicitReview
        ? 'unresolved'
        : localLocated
          ? 'located'
        : automaticMedium
          ? 'pending-review'
          : 'unresolved';
    const reviewVerdict = lunaAccepted
      ? lunaReview.verdict
      : reviewedRejection
        ? 'reject-wrong-poi'
        : explicitReview
          ? lunaReview.verdict
          : localLocated
            ? 'accepted-high-existing'
            : automaticMedium
              ? sourceAudit.selected.automaticDecision
              : 'needs-more-evidence';
    const decisionOrigin = explicitReview
      ? 'luna-reviewed'
      : reviewedRejection
        ? 'reviewed-rejection'
        : localLocated
          ? (record.location?.previewEvidenceClass === 'existing-reviewed-override' ? 'existing-reviewed-override' : 'automatic-high')
        : automaticMedium
          ? 'automatic-medium'
          : lunaReview?.reviewSource === 'unreviewed-default'
            ? 'unreviewed-default'
            : 'unresolved';
    const location = lunaAccepted
      ? materializeLunaLocation(lunaReview)
      : reviewedRejection || explicitReview
        ? emptyLocation()
        : localLocated
          ? record.location
        : emptyLocation();
    const evidenceUrls = lunaReview?.evidenceUrls ?? reviewedRejection?.evidenceUrls ?? [];
    const reviewNotes = reviewedRejection?.reason ?? lunaReview?.notes ?? '';
    return {
      ...record,
      location,
      reviewVerdict,
      reviewState,
      decisionOrigin,
      review: lunaReview,
      supplemental: {
        normalizedAddress: location.address ?? record.location?.address ?? '',
        mallOrVenue: null,
        district: null,
        officialUrl: null,
        ticketingOperatorUrl: null,
        evidenceUrls,
        lastVerifiedAt: lunaAccepted ? lunaReview.reviewedAt : null,
        reviewNotes: lunaAccepted
          ? lunaReview.notes ?? ''
          : reviewedRejection
            ? reviewNotes
            : localLocated
            ? 'Existing accepted-high local AMap evidence retained; no public release implication.'
            : lunaReview?.notes ?? '',
        currentIdentityAssessment: localLocated || lunaAccepted ? reviewVerdict : reviewVerdict
      }
    };
  });

  const located = records.filter(hasProviderCoordinate).length;
  const pendingReview = records.filter((record) => record.reviewState === 'pending-review').length;
  const unresolved = records.filter((record) => record.reviewState === 'unresolved').length;
  const unlocated = pendingReview + unresolved;
  const accepted = located;
  const markerCount = located;
  if (located + pendingReview + unresolved !== total) {
    throw new Error(`Private reviewed layer state counts do not partition total ${total}.`);
  }
  if (records.some((record) => record.reviewState !== 'located' && hasProviderCoordinate(record))) {
    throw new Error('Unresolved/private pending record contains a coordinate.');
  }
  const lunaAccepted = records.filter((record) => record.decisionOrigin === 'luna-reviewed' && hasProviderCoordinate(record));
  const output = {
    schemaVersion: 2,
    dataset: 'arvin-imax-private-reviewed-geocodes',
    mode: 'private-reviewed',
    generatedAt,
    coordinateSystem: 'GCJ-02',
    status: 'PRIVATE LOCAL ONLY · REVIEWED LAYER',
    policy: {
      privateOnly: true,
      localOnly: true,
      publicSafe: false,
      amapCoordinatesIncluded: true,
      providerCacheIncluded: false,
      rawCandidatesIncluded: false,
      apiKeyIncluded: false,
      note: 'AMap GCJ-02 coordinates remain private/local and are not a public provenance source.'
    },
    summary: {
      total,
      accepted,
      markerCount,
      located,
      pendingReview,
      unresolved,
      unlocated,
      acceptedPlusUnlocated: located + unlocated,
      reviewedRejections: records.filter((record) => record.decisionOrigin === 'reviewed-rejection').length,
      statePartition: located + pendingReview + unresolved === total,
      releaseInvariant: {
        acceptedPlusUnlocated: located + unlocated === total,
        markerCountEqualsAccepted: markerCount === accepted
      },
      states: countBy(records, (record) => record.reviewState),
      reviewVerdicts: countBy(records, (record) => record.reviewVerdict),
      lunaReviewedExact: lunaAccepted.filter((record) => record.reviewVerdict === 'accept-exact').length,
      lunaReviewedLocationOnly: lunaAccepted.filter((record) => record.reviewVerdict === 'accept-location-only').length
    },
    source: preview.source,
    records
  };
  assertCanonicalWriteAllowed({
    outputFile,
    existing: readExistingCanonical(outputFile),
    candidate: output,
    allowFinalCanonicalReplacement
  });
  writeJson(outputFile, output);

  const quality = {
    schemaVersion: 2,
    generatedAt,
    status: 'private-reviewed-layer-ready-for-local-bundle',
    total,
    accepted,
    markerCount,
    located,
    pendingReview,
    unresolved,
    unlocated,
    acceptedPlusUnlocated: located + unlocated,
    statePartition: located + pendingReview + unresolved === total,
    releaseInvariant: {
      acceptedPlusUnlocated: located + unlocated === total,
      markerCountEqualsAccepted: markerCount === accepted
    },
    states: output.summary.states,
    automaticHigh: records.filter((record) => record.decisionOrigin === 'automatic-high').length,
    reviewedOverrideHigh: records.filter((record) => record.decisionOrigin === 'existing-reviewed-override').length,
    automaticMedium: records.filter((record) => record.decisionOrigin === 'automatic-medium').length,
    unreviewedDefault: records.filter((record) => record.decisionOrigin === 'unreviewed-default').length,
    unresolvedDefault: records.filter((record) => record.decisionOrigin === 'unresolved').length,
    reviewedRejections: records.filter((record) => record.decisionOrigin === 'reviewed-rejection').length,
    lunaReviewedExact: output.summary.lunaReviewedExact,
    lunaReviewedLocationOnly: output.summary.lunaReviewedLocationOnly,
    verdicts: output.summary.reviewVerdicts,
    screenSeatFieldsAttached: records.filter(hasScreenSeatFields).length,
    rawCandidateText: JSON.stringify(output.records).includes('rawCandidates') || JSON.stringify(output.records).includes('rankedCandidates'),
    apiKeyText: /AMAP_(API_KEY|JS_API_KEY|JS_SECURITY_CODE)|securityJsCode/i.test(JSON.stringify(output)),
    markerCoordinateBoundary: { providerCrs: 'GCJ-02', providerCoordinates: located },
    sourceRowAssociation: 'sourceRow/id only'
  };
  writeJson(qualityFile, quality);
  return {
    outputFile,
    qualityFile,
    total,
    located,
    pendingReview,
    unresolved,
    unlocated,
    reviewedRejections: output.summary.reviewedRejections,
    lunaReviewedExact: output.summary.lunaReviewedExact,
    lunaReviewedLocationOnly: output.summary.lunaReviewedLocationOnly,
    quality
  };
}

function materializeLunaLocation(review) {
  const candidate = review.reviewedCandidate;
  const lat = Number(candidate.providerLat);
  const lng = Number(candidate.providerLng);
  return {
    lat,
    lng,
    address: candidate.address ?? '',
    geocodeConfidence: review.locationConfidence,
    geocodeSource: 'amap:luna-reviewed',
    providerLat: lat,
    providerLng: lng,
    providerCrs: 'GCJ-02',
    mapCrs: 'GCJ-02',
    positionType: review.positionType,
    locationGranularity: review.locationGranularity,
    locationConfidence: review.locationConfidence,
    identityConfidence: review.identityConfidence,
    providerPoiId: candidate.poiId,
    previewEvidenceClass: null,
    decisionOrigin: 'luna-reviewed'
  };
}

function emptyLocation() {
  return {
    lat: null,
    lng: null,
    address: '',
    geocodeConfidence: 'unknown',
    geocodeSource: '',
    providerLat: null,
    providerLng: null,
    providerCrs: null,
    mapCrs: null,
    positionType: null,
    locationGranularity: null,
    locationConfidence: 'unknown',
    identityConfidence: 'unknown',
    providerPoiId: null,
    previewEvidenceClass: null,
    decisionOrigin: null
  };
}

function hasProviderCoordinate(record) {
  return record?.location?.providerCrs === 'GCJ-02' &&
    validLatitude(record.location.providerLat) &&
    validLongitude(record.location.providerLng);
}

function validLatitude(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) && number >= -90 && number <= 90;
}

function validLongitude(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) && number >= -180 && number <= 180;
}

function hasScreenSeatFields(record) {
  return typeof record.screen?.rawWidth === 'string' && typeof record.screen?.rawHeight === 'string' &&
    typeof record.screen?.rawArea === 'string' && typeof record.seatsRaw === 'string';
}

function countBy(records, keyFn) {
  const output = {};
  for (const record of records) {
    const value = String(keyFn(record) ?? 'unknown');
    output[value] = (output[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(output).sort());
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readExistingCanonical(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return readJson(filePath);
  } catch (error) {
    throw new Error(`Refusing to overwrite unreadable canonical output ${relative(filePath)}: ${error.message}`);
  }
}

function assertCanonicalWriteAllowed({ outputFile, existing, candidate, allowFinalCanonicalReplacement }) {
  if (!existing) return;
  const existingLocated = canonicalLocatedCount(existing);
  const candidateLocated = canonicalLocatedCount(candidate);
  if (Number.isFinite(existingLocated) && Number.isFinite(candidateLocated) && candidateLocated < existingLocated) {
    throw new Error(
      `Refusing canonical downgrade at ${relative(outputFile)}: existing located=${existingLocated}, candidate located=${candidateLocated}. ` +
      'Use a validated recovery source and explicit replacement approval.'
    );
  }
  if (isFinalCanonical(existing) && !allowFinalCanonicalReplacement) {
    throw new Error(
      `Refusing to overwrite final canonical ${relative(outputFile)}. ` +
      'A complete 901/901 canonical layer is immutable by default; pass allowFinalCanonicalReplacement only after independent validation.'
    );
  }
}

function canonicalLocatedCount(document) {
  const summaryValue = document?.summary?.located ?? document?.summary?.accepted;
  if (Number.isFinite(Number(summaryValue))) return Number(summaryValue);
  if (!Array.isArray(document?.records)) return Number.NaN;
  return document.records.filter(hasProviderCoordinate).length;
}

function isFinalCanonical(document) {
  const summary = document?.summary ?? {};
  return Array.isArray(document?.records) &&
    document.records.length === 901 &&
    Number(summary.total) === 901 &&
    Number(summary.accepted) === 901 &&
    Number(summary.located) === 901 &&
    Number(summary.pendingReview) === 0 &&
    Number(summary.unresolved) === 0 &&
    Number(summary.unlocated) === 0 &&
    document.records.every((record) => record.reviewState === 'located' && hasProviderCoordinate(record));
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildPrivateReviewedLayer();
  console.log(JSON.stringify({
    ok: true,
    output: relative(result.outputFile),
    quality: relative(result.qualityFile),
    total: result.total,
    located: result.located,
    pendingReview: result.pendingReview,
    unresolved: result.unresolved,
    reviewedRejections: result.reviewedRejections,
    lunaReviewedExact: result.lunaReviewedExact,
    lunaReviewedLocationOnly: result.lunaReviewedLocationOnly
  }, null, 2));
}
