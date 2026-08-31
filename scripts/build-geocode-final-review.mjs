import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const MAINLAND_AUDIT_FILE = path.join(ROOT, 'data/audit/geocode-mainland-full.json');
const MAINLAND_OUTPUT = path.join(ROOT, 'data/audit/geocode-mainland-final-review.json');
const REGIONAL_OUTPUT = path.join(ROOT, 'data/audit/geocode-regional-review.json');

const derived = readJson(DERIVED_FILE);
const full = readJson(MAINLAND_AUDIT_FILE);
const byRow = new Map((derived.records ?? []).map((record) => [Number(record.sourceRow), record]));

const mainlandRecords = full.records.filter((record) => {
  const selected = record.selected;
  const accepted = selected && (decisionBucket(record) === 'automaticHigh' || decisionBucket(record) === 'reviewedOverrideHigh');
  return !accepted;
}).map((record) => ({
  sourceRow: Number(record.sourceRow),
  sourceName: record.sourceName,
  province: record.province,
  city: record.city,
  status: byRow.get(Number(record.sourceRow))?.status ?? record.status,
  projection: record.projection,
  baselineDecision: decisionBucket(record),
  selectedCandidate: compactCandidate(record.selected),
  topCandidate: compactCandidate(record.topCandidate),
  reason: decisionBucket(record) === 'automaticMedium'
    ? 'automaticMedium held until row-level review'
    : record.selected
      ? 'selected candidate did not meet safe automatic-high precedence'
      : 'unresolved; no automatic location selected'
}));

const allRecords = derived.records ?? [];
const mainlandRecordsInDerived = allRecords.filter((record) => record.region === '中国大陆');
const regionalRecords = allRecords.filter((record) => ['香港', '澳门', '台湾'].includes(record.region)).map((record) => ({
  sourceRow: Number(record.sourceRow),
  sourceName: record.name,
  region: record.region,
  province: record.province,
  city: record.city,
  status: record.status,
  projection: {
    system: record.projection?.system ?? 'unknown',
    dome: Boolean(record.projection?.dome),
    audioChannels: record.projection?.audioChannels ?? null
  },
  decision: 'unresolved-no-regional-provider-result',
  reason: 'No new regional provider request was made in this run; do not infer a coordinate.'
}));
const regionalCounts = countBy(allRecords.filter((record) => ['香港', '澳门', '台湾'].includes(record.region)), (record) => record.region);
const automaticHighCount = full.records.filter((record) => decisionBucket(record) === 'automaticHigh').length;
const reviewedOverrideHighCount = full.records.filter((record) => decisionBucket(record) === 'reviewedOverrideHigh').length;

writeJson(MAINLAND_OUTPUT, {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: 'blocked-pending-row-level-human-review',
  scope: 'mainland',
  totalMainland: mainlandRecordsInDerived.length,
  safeBaseline: {
    automaticHigh: automaticHighCount,
    reviewedOverrideHigh: reviewedOverrideHighCount,
    coordinatesAvailableInInternalOnly: automaticHighCount + reviewedOverrideHighCount,
    remainingNullWithoutHumanRiskReview: mainlandRecords.length
  },
  externalClaimNotReproduced: {
    projectedLocated: 754,
    projectedNull: 127,
    reason: 'The row-level geocode-risk-human-review-219.json artifact is absent; no aggregate claim was applied.'
  },
  requestPolicy: {
    networkRequests: 0,
    newAmapRequests: 0,
    cacheHits: 0,
    maxNewAmapRequests: 600,
    cacheFirst: true,
    noNewUnresolvedQueriesAttempted: true
  },
  coordinatesAppliedToDerived: 0,
  records: mainlandRecords
});

writeJson(REGIONAL_OUTPUT, {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: 'isolated-no-new-requests',
  scope: 'hong-kong-macau-taiwan',
  counts: { total: regionalRecords.length, hongKong: regionalCounts['香港'] ?? 0, macau: regionalCounts['澳门'] ?? 0, taiwan: regionalCounts['台湾'] ?? 0 },
  requestPolicy: {
    networkRequests: 0,
    newAmapRequests: 0,
    consumesMainlandAmapBudget: false,
    cacheFirst: true
  },
  records: regionalRecords
});

console.log(JSON.stringify({ ok: true, mainlandRemaining: mainlandRecords.length, regionalRemaining: regionalRecords.length, networkRequests: 0, newAmapRequests: 0 }, null, 2));

function decisionBucket(record) {
  if (!record.selected) return 'unresolved';
  const high = record.selected.automaticDecision === 'accepted-high';
  const medium = ['review-required-medium', 'review-required-ambiguous'].includes(record.selected.automaticDecision);
  if (record.overrideUsed) return high ? 'reviewedOverrideHigh' : medium ? 'reviewedOverrideMedium' : 'unresolved';
  return high ? 'automaticHigh' : medium ? 'automaticMedium' : 'unresolved';
}

function compactCandidate(candidate) {
  if (!candidate) return null;
  return {
    poiId: candidate.poiId ?? null,
    name: candidate.name ?? '',
    address: candidate.address ?? '',
    typecode: candidate.typecode ?? '',
    positionType: candidate.positionType ?? null,
    locationGranularity: candidate.locationGranularity ?? null,
    score: candidate.score ?? null,
    decision: candidate.automaticDecision ?? null,
    locationConfidence: candidate.locationConfidence ?? 'unknown',
    identityConfidence: candidate.identityConfidence ?? 'unknown',
    provider: candidate.provider ?? null,
    map: candidate.map ?? null,
    hardRejects: candidate.hardRejects ?? []
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function countBy(records, keyFn) {
  const counts = {};
  for (const record of records) {
    const key = String(keyFn(record) ?? 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
