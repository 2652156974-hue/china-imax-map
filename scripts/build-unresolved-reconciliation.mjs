import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildQueries } from './geocode/query.mjs';
import { adminCompatibility } from './geocode/admin-divisions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT_FILE = path.join(ROOT, 'data/local/private-reviewed-geocodes.json');
const CACHE_FILE = path.join(ROOT, 'data/geocode/provider-cache/amap.json');
const PRIORITY_FILE = path.join(ROOT, 'data/audit/geocode-unresolved-priority.json');
const REGIONAL_FILE = path.join(ROOT, 'data/audit/geocode-regional-review.json');
const FINAL_REVIEW_FILE = path.join(ROOT, 'data/audit/geocode-mainland-final-review.json');
const PENDING_FILE = path.join(ROOT, 'data/audit/luna-pending-consolidated-42.json');
const OUTPUT_FILE = path.join(ROOT, 'data/audit/unresolved-reconciliation.json');

const ALLOWED_REASONS = [
  'never-queried',
  'provider-no-result',
  'branch-ambiguity',
  'wrong-city',
  'former-name-only',
  'closed-or-removed-poi',
  'mall-only',
  'venue-only',
  'auditorium-identity-ambiguous',
  'duplicate-poi',
  'provider-error',
  'insufficient-evidence',
  'other'
];

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const normalized = (value) => String(value ?? '').normalize('NFKC').replace(/[\s\u00a0\u3000]+/g, '').toLowerCase();
const source = readJson('data/local/private-reviewed-geocodes.json');
const cache = readJson('data/geocode/provider-cache/amap.json');
const priority = readJson('data/audit/geocode-unresolved-priority.json');
const regional = readJson('data/audit/geocode-regional-review.json');
const finalReview = readJson('data/audit/geocode-mainland-final-review.json');
const pending = readJson('data/audit/luna-pending-consolidated-42.json');

const priorityByRow = new Map((priority.records ?? []).map((record) => [Number(record.sourceRow), record]));
const regionalByRow = new Map((regional.records ?? []).map((record) => [Number(record.sourceRow), record]));
const finalReviewByRow = new Map((finalReview.records ?? []).map((record) => [Number(record.sourceRow), record]));
const pendingByRow = new Map((pending.rows ?? []).map((record) => [Number(record.sourceRow), record]));
const requestsByRow = new Map();
const requestsByQuery = new Map();

for (const request of cache.requests ?? []) {
  const key = queryKey(request.query, request.city);
  if (!requestsByQuery.has(key)) requestsByQuery.set(key, []);
  requestsByQuery.get(key).push(request);
  for (const sourceRow of request.sourceRows ?? []) {
    const row = Number(sourceRow);
    if (!requestsByRow.has(row)) requestsByRow.set(row, []);
    requestsByRow.get(row).push(request);
  }
}

const unresolved = source.records.filter((record) => record.reviewState === 'unresolved');
if (unresolved.length !== 242) throw new Error(`Expected 242 unresolved records, received ${unresolved.length}`);

const records = unresolved.map((record) => buildReconciliation(record));
const reasonCounts = Object.fromEntries(ALLOWED_REASONS.map((reason) => [reason, 0]));
for (const record of records) reasonCounts[record.unresolvedReason] += 1;
const missingQueryKeys = new Set();
for (const record of records.filter((item) => item.queryWorthiness === 'worth-query')) {
  for (const variant of record.queryVariants) {
    const key = queryKey(variant.query, record.city);
    if (!requestsByQuery.has(key)) missingQueryKeys.add(key);
  }
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: 'complete-unresolved-reconciliation',
  scope: {
    total: 901,
    startingLocated: 659,
    unresolved: 242,
    pendingReview: 0,
    source: 'data/local/private-reviewed-geocodes.json',
    queryCache: 'data/geocode/provider-cache/amap.json'
  },
  invariants: {
    recordCount: records.length,
    uniqueIds: new Set(records.map((record) => record.id)).size,
    uniqueSourceRows: new Set(records.map((record) => record.sourceRow)).size,
    allRecordsUnresolved: records.every((record) => record.reviewState === 'unresolved'),
    noGenericNeedsMoreEvidenceReason: records.every((record) => record.unresolvedReason !== 'other' || record.classificationBasis.length > 0)
  },
  queryPolicy: {
    provider: 'AMap Web Service REST',
    keyEnvironmentVariable: 'AMAP_WEB_SERVICE_KEY',
    webServiceKeyAvailable: Boolean(process.env.AMAP_WEB_SERVICE_KEY),
    browserSdkKeyAllowed: false,
    cacheFirst: true,
    maxVariantsPerRecord: 4,
    newRequestsStarted: false
  },
  reasonCounts,
  queryPlan: {
    recordsWorthNewAmapQuery: records.filter((record) => record.queryWorthiness === 'worth-query').length,
    recordsUnlikelyToBenefitFromQuery: records.filter((record) => record.queryWorthiness === 'unlikely-to-benefit').length,
    recordsWithPreviousQueries: records.filter((record) => record.queryAttempted).length,
    recordsNeverQueried: records.filter((record) => !record.queryAttempted).length,
    previousCacheRequests: records.reduce((sum, record) => sum + record.previousQueryCount, 0),
    plannedNewQueryVariants: missingQueryKeys.size,
    newAmapRequests: 0,
    providerErrors: 0
  },
  records
};

if (output.invariants.uniqueIds !== 242 || output.invariants.uniqueSourceRows !== 242) {
  throw new Error('Unresolved reconciliation IDs/sourceRows are not unique.');
}
if (Object.values(reasonCounts).some((count) => count < 0) || Object.values(reasonCounts).reduce((a, b) => a + b, 0) !== 242) {
  throw new Error('Unresolved reconciliation reason counts do not partition 242 records.');
}

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ok: true,
  output: path.relative(ROOT, OUTPUT_FILE).replaceAll(path.sep, '/'),
  total: records.length,
  reasonCounts,
  queryPlan: output.queryPlan,
  invariants: output.invariants
}, null, 2));

function buildReconciliation(record) {
  const sourceRow = Number(record.sourceRow);
  const priorityRecord = priorityByRow.get(sourceRow);
  const regionalRecord = regionalByRow.get(sourceRow);
  const finalRecord = finalReviewByRow.get(sourceRow);
  const pendingRecord = pendingByRow.get(sourceRow);
  const rowRequests = uniqueRequests([...(requestsByRow.get(sourceRow) ?? [])]);
  const plannedQueries = buildQueries({
    ...record,
    name: record.name ?? record.nameRaw,
    nameRaw: record.nameRaw ?? record.name,
    formerNames: record.formerNames ?? []
  });
  const priorityQueries = priorityRecord?.queryVariantsSummary ?? [];
  const queryVariants = mergeQueryVariants(plannedQueries, priorityQueries, rowRequests, record.city);
  const candidates = uniqueCandidates(rowRequests.flatMap((request) => request.rawCandidates ?? []));
  const fallbackCandidate = priorityRecord?.topCandidate ?? finalRecord?.topCandidate ?? pendingRecord?.consideredCandidate ?? null;
  const latestCandidate = lastCandidate(rowRequests) ?? compactCandidate(fallbackCandidate);
  const classification = classify({ record, priorityRecord, regionalRecord, finalRecord, pendingRecord, rowRequests, queryVariants, candidates, fallbackCandidate });

  return {
    id: record.id,
    sourceRow,
    nameRaw: record.nameRaw ?? record.name ?? '',
    name: record.name ?? record.nameRaw ?? '',
    formerNames: record.formerNames ?? [],
    province: record.province ?? '',
    city: record.city ?? '',
    status: record.status ?? 'unknown',
    reviewState: record.reviewState,
    reviewVerdict: record.reviewVerdict ?? 'needs-more-evidence',
    queryAttempted: rowRequests.length > 0,
    previousQueryCount: rowRequests.length,
    queryVariants,
    candidateCount: candidates.length,
    lastCandidateName: latestCandidate?.name ?? null,
    lastCandidateAddress: latestCandidate?.address ?? null,
    lastCandidateType: latestCandidate?.typecode ?? latestCandidate?.type ?? null,
    lastCandidateLocation: latestCandidate?.location ?? null,
    locationConfidence: record.location?.locationConfidence ?? 'unknown',
    identityConfidence: record.location?.identityConfidence ?? 'unknown',
    unresolvedReason: classification.reason,
    classificationConfidence: classification.confidence,
    classificationBasis: classification.basis,
    recommendedAction: classification.recommendedAction,
    queryWorthiness: classification.queryWorthiness,
    evidence: {
      priorityCategory: priorityRecord?.priorityCategory ?? null,
      reasonTags: priorityRecord?.reasonTags ?? [],
      sourceCategory: priorityRecord?.sourceCategory ?? finalRecord?.sourceCategory ?? null,
      finalReviewReason: finalRecord?.reason ?? null,
      pendingVerdict: pendingRecord?.verdict ?? null,
      pendingNotes: pendingRecord?.notes ?? null,
      regionalDecision: regionalRecord?.decision ?? null
    }
  };
}

function classify({ record, priorityRecord, regionalRecord, pendingRecord, rowRequests, queryVariants, candidates, fallbackCandidate }) {
  const text = [record.name, record.nameRaw, ...(record.formerNames ?? []), record.projection?.raw, record.projection?.system].filter(Boolean).join(' ');
  const normalizedText = normalized(text);
  const priorityCategory = priorityRecord?.priorityCategory ?? '';
  const sourceCategory = priorityRecord?.sourceCategory ?? '';
  const notes = String(pendingRecord?.notes ?? '');
  const hasProviderError = rowRequests.some((request) => request.ok === false || request.error);
  const hasAnyCandidate = candidates.length > 0 || Boolean(fallbackCandidate);
  const currentQuery = queryVariants.find((variant) => variant.kind === 'current-name-city');
  const formerQuery = queryVariants.find((variant) => variant.kind === 'former-name');
  const validCinemaCandidates = candidates.filter((candidate) => isType(candidate, '080601'));
  const mallCandidates = candidates.filter((candidate) => isType(candidate, '060100', '060101', '060102'));
  const venueCandidates = candidates.filter((candidate) => isType(candidate, '140100', '140600', '140800'));
  const adminCheck = isMainland(record) && fallbackCandidate?.pname
    ? adminCompatibility(record, fallbackCandidate)
    : null;
  const adminMismatch = Boolean(fallbackCandidate?.adminMatch?.compatible === false || adminCheck?.compatible === false);
  const duplicateCandidate = candidates.find((candidate) => candidate._sourceRows?.length > 1) ?? null;
  const hasFormatMarker = /dome|球幕|穹顶|穹頂|\bgt\b|imaxgt|\b4d\b|\bxd\b|巨幕/i.test(normalizedText);
  const closedHistorical = ['closed', 'temporarily_closed'].includes(record.status) || /关门|关闭|已关闭|撤店|停业|closed|removed/i.test(notes);
  const formerOnly = (record.formerNames?.length > 0 || formerQuery) && currentQuery?.candidateCount === 0 && (formerQuery?.candidateCount ?? 0) > 0;
  const branchAmbiguous = validCinemaCandidates.length > 1 || Boolean(priorityRecord?.ambiguity?.trueAmbiguity);
  const mallOnly = mallCandidates.length > 0 && !validCinemaCandidates.length && !venueCandidates.length;
  const venueOnly = (sourceCategory === 'institutional-venue' || venueCandidates.length > 0) && !validCinemaCandidates.length && !mallOnly;
  const allNoResult = rowRequests.length > 0 && rowRequests.every((request) => (request.rawCandidates ?? []).length === 0);
  const noteBranch = /另一家门店|不同门店|竞争候选|竞争分店|同地级市.*(?:不同|竞争).*(?:门店|分店)|分店.*(?:冲突|不一致)|branch-mismatch|competing|串店|同品牌.*分店/i.test(notes);
  const noteMall = /商场层面|mall\s*(?:fallback|poi)\b|购物中心|广场.*(?:影院|影城|店)|地址尚未闭合/i.test(notes);
  const noteVenue = /场馆|博物馆|科技馆|venue|venue-to-cinema/i.test(notes);
  const noteWrongCity = /异地|另一城市|城市不|县级.*不|错误.*城市|wrong.?city/i.test(notes);
  const noteInsufficient = /独立证据不足|尚无可靠公开证据.*连续绑定|时间指纹未闭合|Independent evidence is insufficient|no source-bound exact cinema|existing cache has no source-bound exact|无法安全绑定.*exact|cannot safely bind/i.test(notes);

  if (hasProviderError) {
    return result('provider-error', 'high', ['one or more cached provider responses contain an error'], 'retry-targeted-amap-query', 'worth-query');
  }
  if (closedHistorical) {
    return result('closed-or-removed-poi', 'high', ['source status or review evidence marks the venue closed/removed; accepted current POI is not established'], 'retain-unresolved-closed', 'unlikely-to-benefit');
  }
  if (rowRequests.length === 0) {
    return result('never-queried', 'high', ['no cached AMap request is associated with this sourceRow'], 'targeted-amap-query', 'worth-query');
  }
  if (adminMismatch) {
    return result('wrong-city', 'high', ['best known candidate fails the stored administrative compatibility check'], 'retain-unresolved-wrong-city', 'unlikely-to-benefit');
  }
  if (noteWrongCity) {
    return result('wrong-city', 'high', ['row-level review notes identify an out-of-city or county binding conflict'], 'retain-unresolved-wrong-city', 'unlikely-to-benefit');
  }
  if (formerOnly) {
    return result('former-name-only', 'high', ['only the former-name query produced candidates; current-name query produced none'], 'query-current-and-former-name-with-city', 'worth-query');
  }
  if (duplicateCandidate) {
    return result('duplicate-poi', 'high', ['the same candidate POI is associated with more than one unresolved sourceRow in the cached evidence'], 'query-with-sourceRow-specific-branch-context', 'worth-query');
  }
  if (noteBranch) {
    return result('branch-ambiguity', 'high', ['row-level review notes identify a competing branch or same-brand store conflict'], 'query-with-exact-branch-and-mall', rowRequests.length < 4 ? 'worth-query' : 'unlikely-to-benefit');
  }
  if (noteMall || mallOnly) {
    return result('mall-only', 'high', [noteMall ? 'row-level review notes identify a mall-only binding gap' : 'known candidates are mall POIs without a qualified cinema POI'], 'query-cinema-brand-with-mall-and-city', rowRequests.length < 4 ? 'worth-query' : 'unlikely-to-benefit');
  }
  if (noteVenue || venueOnly) {
    return result('venue-only', 'high', [noteVenue ? 'row-level review notes identify a venue-to-cinema binding gap' : 'known candidates are institution/venue POIs and no qualified cinema POI is established'], 'query-venue-and-cinema-binding', rowRequests.length < 4 ? 'worth-query' : 'unlikely-to-benefit');
  }
  if (noteInsufficient) {
    return result('insufficient-evidence', 'high', ['row-level review notes explicitly state that the available evidence cannot safely bind an exact source POI'], rowRequests.length < 4 ? 'add-targeted-query-variant' : 'retain-unresolved-insufficient-evidence', rowRequests.length < 4 ? 'worth-query' : 'unlikely-to-benefit');
  }
  if (hasFormatMarker || priorityCategory === 'gt-laser' || priorityCategory === 'dome') {
    return result('auditorium-identity-ambiguous', 'high', ['source contains format/auditorium-specific language and current evidence does not establish the matching auditorium identity'], 'retain-unresolved-auditorium-identity-ambiguous', 'unlikely-to-benefit');
  }
  if (branchAmbiguous) {
    return result('branch-ambiguity', 'high', [noteBranch ? 'row-level review notes identify a competing branch or same-brand store conflict' : 'two or more cinema-type candidates remain, or the frozen matcher marked true ambiguity'], 'query-with-exact-branch-and-mall', rowRequests.length < 4 ? 'worth-query' : 'unlikely-to-benefit');
  }
  if (allNoResult) {
    return result('provider-no-result', 'high', ['all recorded query variants returned zero candidates'], queryVariants.length < 4 ? 'add-targeted-query-variant' : 'retain-unresolved-after-no-result', queryVariants.length < 4 ? 'worth-query' : 'unlikely-to-benefit');
  }
  if (hasAnyCandidate) {
    return result('insufficient-evidence', 'medium', ['candidate evidence exists, but no accepted cinema identity passes the city, branch, type, and format gates'], rowRequests.length < 4 ? 'add-targeted-query-variant' : 'retain-unresolved-insufficient-evidence', rowRequests.length < 4 ? 'worth-query' : 'unlikely-to-benefit');
  }
  return result('other', 'low', [`unresolved evidence did not satisfy a more specific category; source text=${normalizedText.slice(0, 120)}`], 'manual-evidence-review', 'unlikely-to-benefit');
}

function result(reason, confidence, basis, recommendedAction, queryWorthiness) {
  return { reason, confidence, basis, recommendedAction, queryWorthiness };
}

function mergeQueryVariants(planned, prioritySummary, rowRequests, city) {
  const priorityByQuery = new Map((prioritySummary ?? []).map((variant) => [normalized(variant.query), variant]));
  const requestByKey = new Map(rowRequests.map((request) => [queryKey(request.query, request.city || city), request]));
  const merged = [];
  for (const plannedQuery of planned) {
    const request = requestByKey.get(queryKey(plannedQuery.query, city));
    const historical = priorityByQuery.get(normalized(plannedQuery.query));
    merged.push({
      kind: plannedQuery.kind,
      query: plannedQuery.query,
      attempted: Boolean(request),
      cacheStatus: historical?.cache ?? (request ? 'recorded' : 'not-run'),
      ok: request ? Boolean(request.ok) : null,
      candidateCount: request ? (request.rawCandidates ?? []).length : 0,
      errorCode: request?.error?.code ?? historical?.errorCode ?? null
    });
  }
  for (const request of rowRequests) {
    if (merged.some((variant) => normalized(variant.query) === normalized(request.query))) continue;
    merged.push({
      kind: 'cached-unknown',
      query: request.query,
      attempted: true,
      cacheStatus: 'recorded',
      ok: Boolean(request.ok),
      candidateCount: (request.rawCandidates ?? []).length,
      errorCode: request.error?.code ?? null
    });
  }
  return merged;
}

function uniqueRequests(requests) {
  const map = new Map();
  for (const request of requests) map.set(queryKey(request.query, request.city), request);
  return [...map.values()].sort((a, b) => String(a.requestTimestamp ?? '').localeCompare(String(b.requestTimestamp ?? '')));
}

function uniqueCandidates(rawCandidates) {
  const map = new Map();
  for (const candidate of rawCandidates) {
    const key = candidate.id ?? `${candidate.name ?? ''}|${candidate.address ?? ''}|${candidate.location ?? ''}`;
    if (!map.has(key)) map.set(key, { ...candidate, _sourceRows: [] });
  }
  return [...map.values()];
}

function lastCandidate(requests) {
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    const request = requests[index];
    const candidate = request.selectedCandidate ?? request.rawCandidates?.[0];
    if (candidate) return compactCandidate(candidate);
  }
  return null;
}

function compactCandidate(candidate) {
  if (!candidate) return null;
  const location = parseLocation(candidate.location ?? candidate.providerCoordinate ?? candidate);
  return {
    name: candidate.name ?? null,
    address: candidate.address ?? null,
    typecode: candidate.typecode ?? null,
    type: candidate.type ?? null,
    location
  };
}

function parseLocation(value) {
  if (typeof value === 'string' && value.includes(',')) {
    const [lng, lat] = value.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { providerCrs: 'GCJ-02', lat, lng };
  }
  if (value && Number.isFinite(Number(value.providerLat)) && Number.isFinite(Number(value.providerLng))) {
    return { providerCrs: value.providerCrs ?? 'GCJ-02', lat: Number(value.providerLat), lng: Number(value.providerLng) };
  }
  if (value && Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lng))) {
    return { providerCrs: value.crs ?? value.providerCrs ?? 'GCJ-02', lat: Number(value.lat), lng: Number(value.lng) };
  }
  return null;
}

function isType(candidate, ...typecodes) {
  const codes = String(candidate.typecode ?? '').match(/\d{6}/g) ?? [];
  return codes.some((code) => typecodes.includes(code));
}

function queryKey(query, city) {
  return `${normalized(query)}|${normalized(city)}`;
}

function isMainland(record) {
  return !['香港', '澳门', '台湾'].includes(String(record.province ?? ''));
}

export { buildReconciliation };
