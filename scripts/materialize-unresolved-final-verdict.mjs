import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseCandidate } from './geocode/scoring.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE_FILE = path.join(ROOT, 'data/local/private-reviewed-geocodes.json');
const RECONCILIATION_FILE = path.join(ROOT, 'data/audit/unresolved-reconciliation.json');
const CACHE_FILE = path.join(ROOT, 'data/geocode/provider-cache/amap.json');

const FINAL_VERDICTS = new Set(['accepted-exact', 'accepted-location-only', 'unresolved']);
const FIXED_NOT_WORTH_REASONS = new Set([
  'closed-or-removed-poi',
  'wrong-city',
  'auditorium-identity-ambiguous'
]);
const REVIEWED_AT = new Date().toISOString();

const privateLayer = readJson(PRIVATE_FILE);
const reconciliation = readJson(RECONCILIATION_FILE);
const cache = readJson(CACHE_FILE);

if (!Array.isArray(privateLayer.records) || privateLayer.records.length !== 901) {
  throw new Error('Expected the current 901-record private reviewed layer.');
}
if (!Array.isArray(reconciliation.records) || reconciliation.records.length !== 242) {
  throw new Error('Expected the current 242-record unresolved reconciliation.');
}
if (!Array.isArray(cache.requests)) throw new Error('Expected the AMap provider cache request list.');

const currentUnresolved = privateLayer.records.filter((record) => record.reviewState === 'unresolved');
if (currentUnresolved.length !== 242) throw new Error(`Expected 242 unresolved records, got ${currentUnresolved.length}.`);

const reconciliationByRow = new Map(reconciliation.records.map((record) => [Number(record.sourceRow), record]));
const fixedNotWorth = new Set(
  reconciliation.records
    .filter((record) => FIXED_NOT_WORTH_REASONS.has(record.unresolvedReason))
    .map((record) => Number(record.sourceRow))
);
if (fixedNotWorth.size !== 11) {
  throw new Error(`The fixed not-worth policy must contain exactly 11 rows, got ${fixedNotWorth.size}.`);
}
const eligibleRows = currentUnresolved
  .filter((record) => !fixedNotWorth.has(Number(record.sourceRow)))
  .map((record) => Number(record.sourceRow));
if (eligibleRows.length !== 231) throw new Error(`Expected 231 eligible rows, got ${eligibleRows.length}.`);

const candidatesByRow = buildCandidatesByRow(cache.requests);
const verdicts = [];
for (const record of currentUnresolved) {
  const sourceRow = Number(record.sourceRow);
  const reconciliationRecord = reconciliationByRow.get(sourceRow);
  if (!reconciliationRecord) throw new Error(`Missing reconciliation record for sourceRow ${sourceRow}.`);

  const fixed = fixedNotWorth.has(sourceRow);
  const candidates = candidatesByRow.get(sourceRow) ?? [];
  const choice = fixed ? { selected: null, ranked: [], ambiguity: { trueAmbiguity: false } } : chooseCandidate(record, candidates);
  const finalVerdict = fixed ? 'unresolved' : decideFinalVerdict(choice);
  if (!FINAL_VERDICTS.has(finalVerdict)) throw new Error(`Invalid final verdict at sourceRow ${sourceRow}.`);

  verdicts.push({
    sourceRow,
    id: record.id,
    name: record.name,
    fixedNotWorth: fixed,
    unresolvedReason: reconciliationRecord.unresolvedReason,
    candidateCount: candidates.length,
    choice,
    finalVerdict
  });
}

const accepted = verdicts.filter((item) => item.finalVerdict !== 'unresolved');
const acceptedExact = accepted.filter((item) => item.finalVerdict === 'accepted-exact');
const acceptedLocationOnly = accepted.filter((item) => item.finalVerdict === 'accepted-location-only');
if (accepted.some((item) => !item.choice.selected)) throw new Error('Accepted verdict without a selected candidate.');
if (accepted.some((item) => item.choice.ambiguity?.trueAmbiguity)) throw new Error('Ambiguous candidate was accepted.');
if (accepted.some((item) => item.fixedNotWorth)) throw new Error('A fixed not-worth row was accepted.');

const finalRecords = privateLayer.records.map((record) => {
  const item = verdicts.find((candidate) => candidate.sourceRow === Number(record.sourceRow));
  if (!item) return record;
  const base = {
    ...record,
    finalVerdict: item.finalVerdict,
    finalUnresolvedReason: item.finalVerdict === 'unresolved' ? item.unresolvedReason : null
  };
  if (item.finalVerdict === 'unresolved') return materializeUnresolved(base, item);
  return materializeAccepted(base, item);
});

const located = finalRecords.filter(hasProviderCoordinate).length;
const pendingReview = finalRecords.filter((record) => record.reviewState === 'pending-review').length;
const unresolved = finalRecords.filter((record) => record.reviewState === 'unresolved').length;
if (pendingReview !== 0) throw new Error(`pending must remain 0, got ${pendingReview}.`);
if (located !== 659 + accepted.length) throw new Error(`Located count mismatch: ${located}.`);
if (located + unresolved !== 901) throw new Error('located + unresolved must equal 901.');
if (finalRecords.some((record) => record.reviewState !== 'located' && hasProviderCoordinate(record))) {
  throw new Error('Unresolved record contains a materialized coordinate.');
}
if (finalRecords.filter((record) => record.finalVerdict && !FINAL_VERDICTS.has(record.finalVerdict)).length) {
  throw new Error('A final verdict outside the allowed domain was materialized.');
}

const finalVerdictCounts = countBy(verdicts, (item) => item.finalVerdict);
const finalUnresolvedReasons = countBy(
  verdicts.filter((item) => item.finalVerdict === 'unresolved'),
  (item) => item.unresolvedReason ?? 'other'
);
const acceptedByKind = countBy(accepted, (item) => item.choice.selected.poiKind);
const summary = {
  total: 901,
  preflightUnresolved: 242,
  eligibleReviewed: 231,
  fixedNotWorthQuerying: fixedNotWorth.size,
  acceptedFromEligible: accepted.length,
  acceptedExact: acceptedExact.length,
  acceptedLocationOnly: acceptedLocationOnly.length,
  finalUnresolved: unresolved,
  locatedBefore: 659,
  locatedAfter: located,
  locatedIncrement: located - 659,
  pendingReview,
  finalVerdictCounts,
  finalUnresolvedReasons,
  acceptedByKind,
  acceptedSourceRows: accepted.map((item) => ({
    sourceRow: item.sourceRow,
    finalVerdict: item.finalVerdict,
    poiId: item.choice.selected.poiId,
    poiName: item.choice.selected.name,
    positionType: item.choice.selected.positionType,
    locationGranularity: item.choice.selected.locationGranularity,
    score: item.choice.selected.score,
    ambiguity: item.choice.ambiguity?.trueAmbiguity ?? false
  })),
  invariants: {
    finalVerdictDomain: [...new Set(verdicts.map((item) => item.finalVerdict))].every((value) => FINAL_VERDICTS.has(value)),
    fixedNotWorthRemainUnresolved: verdicts.filter((item) => item.fixedNotWorth).every((item) => item.finalVerdict === 'unresolved'),
    locatedPlusUnresolved: located + unresolved === 901,
    pendingIsZero: pendingReview === 0,
    acceptedHaveCoordinates: accepted.every((item) => hasProviderCoordinate(finalRecords.find((record) => Number(record.sourceRow) === item.sourceRow))),
    acceptedCandidatesAreUnambiguous: accepted.every((item) => item.choice.ambiguity?.trueAmbiguity !== true)
  }
};

const output = {
  ...privateLayer,
  generatedAt: REVIEWED_AT,
  summary: {
    ...privateLayer.summary,
    accepted: located,
    markerCount: located,
    located,
    pendingReview,
    unresolved,
    unlocated: pendingReview + unresolved,
    acceptedPlusUnlocated: located + pendingReview + unresolved,
    statePartition: located + pendingReview + unresolved === 901,
    reviewVerdicts: countBy(finalRecords, (record) => record.reviewVerdict ?? 'not-reviewed'),
    finalVerdicts: countBy(finalRecords.filter((record) => record.finalVerdict), (record) => record.finalVerdict),
    finalUnresolvedReasons,
    finalMaterialization: summary
  },
  records: finalRecords
};

fs.writeFileSync(PRIVATE_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, output: relative(PRIVATE_FILE), summary }, null, 2));

function decideFinalVerdict(choice) {
  const selected = choice.selected;
  if (!selected || choice.ambiguity?.trueAmbiguity) return 'unresolved';
  if (
    selected.poiKind === 'cinema' &&
    selected.typecode.split('|').includes('080601') &&
    selected.hardRejects.length === 0 &&
    selected.adminMatch?.compatible === true &&
    selected.formatCompatibility?.compatible === true &&
    selected.locationConfidence === 'high' &&
    selected.identityConfidence === 'high' &&
    selected.score >= 0.9 &&
    selected.deterministicIdentityHigh === true
  ) return 'accepted-exact';
  if (
    ['mall', 'venue'].includes(selected.poiKind) &&
    selected.hardRejects.length === 0 &&
    selected.adminMatch?.compatible === true &&
    selected.formatCompatibility?.compatible === true &&
    ['high', 'medium'].includes(selected.locationConfidence) &&
    ['medium', 'low'].includes(selected.identityConfidence) &&
    Number.isFinite(Number(selected.providerLat)) &&
    Number.isFinite(Number(selected.providerLng)) &&
    selected.score >= 0.78
  ) return 'accepted-location-only';
  return 'unresolved';
}

function materializeAccepted(record, item) {
  const selected = item.choice.selected;
  const legacyVerdict = item.finalVerdict === 'accepted-exact' ? 'accept-exact' : 'accept-location-only';
  const location = {
    lat: selected.lat,
    lng: selected.lng,
    address: selected.address,
    geocodeConfidence: selected.locationConfidence,
    geocodeSource: selected.geocodeSource,
    providerLat: selected.providerLat,
    providerLng: selected.providerLng,
    providerCrs: selected.providerCrs,
    mapCrs: selected.mapCrs,
    positionType: selected.positionType,
    locationGranularity: selected.locationGranularity,
    locationConfidence: selected.locationConfidence,
    identityConfidence: selected.identityConfidence,
    providerPoiId: selected.poiId,
    previewEvidenceClass: null,
    decisionOrigin: 'unresolved-final-amap'
  };
  const review = {
    verdict: legacyVerdict,
    acceptedPoiId: selected.poiId,
    reviewedCandidate: {
      provider: 'amap',
      poiId: selected.poiId,
      name: selected.name,
      address: selected.address,
      providerCrs: selected.providerCrs,
      providerLat: selected.providerLat,
      providerLng: selected.providerLng
    },
    positionType: selected.positionType,
    locationGranularity: selected.locationGranularity,
    locationConfidence: selected.locationConfidence,
    identityConfidence: selected.identityConfidence,
    evidenceUrls: record.review?.evidenceUrls ?? [],
    administrativeBinding: selected.adminMatch ?? null,
    reviewer: 'unresolved-final-cache-review',
    reviewedAt: REVIEWED_AT,
    notes: item.finalVerdict === 'accepted-exact'
      ? 'Updated full AMap cache; one unambiguous cinema POI passed city, format, identity and coordinate gates. No new query beyond the approved 25 variants.'
      : 'Updated full AMap cache; only the correct-city mall/venue location passed the location-only gate. This does not assert cinema-level branch identity. No new query beyond the approved 25 variants.',
    explicitVerdict: false,
    reviewSource: 'unresolved-final-amap',
    validationErrors: []
  };
  return {
    ...record,
    location,
    reviewVerdict: legacyVerdict,
    reviewState: 'located',
    decisionOrigin: 'unresolved-final-amap',
    review,
    supplemental: {
      ...(record.supplemental ?? {}),
      normalizedAddress: selected.address,
      evidenceUrls: record.review?.evidenceUrls ?? record.supplemental?.evidenceUrls ?? [],
      lastVerifiedAt: REVIEWED_AT,
      reviewNotes: review.notes,
      currentIdentityAssessment: item.finalVerdict
    }
  };
}

function materializeUnresolved(record, item) {
  const fixedNote = item.fixedNotWorth ? ' Fixed not-worth-querying policy preserved; no further query is permitted.' : '';
  return {
    ...record,
    location: emptyLocation(),
    reviewVerdict: 'unresolved',
    reviewState: 'unresolved',
    decisionOrigin: item.fixedNotWorth ? 'not-worth-querying' : 'unresolved-final-amap',
    supplemental: {
      ...(record.supplemental ?? {}),
      normalizedAddress: '',
      lastVerifiedAt: null,
      reviewNotes: `Final full-cache verdict unresolved; reason=${item.unresolvedReason ?? 'other'}.${fixedNote}`,
      currentIdentityAssessment: 'unresolved'
    }
  };
}

function buildCandidatesByRow(requests) {
  const byRow = new Map();
  for (const request of requests) {
    for (const sourceRow of request.sourceRows ?? []) {
      const key = Number(sourceRow);
      const list = byRow.get(key) ?? [];
      list.push(...(request.rawCandidates ?? []));
      byRow.set(key, list);
    }
  }
  for (const [sourceRow, candidates] of byRow) {
    byRow.set(sourceRow, [...new Map(candidates.filter((candidate) => candidate?.id).map((candidate) => [candidate.id, candidate])).values()]);
  }
  return byRow;
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
    Number.isFinite(Number(record.location.providerLat)) &&
    Number.isFinite(Number(record.location.providerLng));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = String(keyFn(item) ?? 'other');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}
