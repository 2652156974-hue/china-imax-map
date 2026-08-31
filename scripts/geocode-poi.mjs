import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProviderCache } from './geocode/cache.mjs';
import { chooseCandidate, classifyPoi, normalizeText } from './geocode/scoring.mjs';
import { buildQueries } from './geocode/query.mjs';
import { applyReviewedOverride, reviewedOverrideFor } from './geocode/overrides.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const CACHE_FILE = path.join(ROOT, 'data/geocode/provider-cache/amap.json');
const OVERRIDE_FILE = path.join(ROOT, 'data/geocode/reviewed-overrides.json');
const BEFORE_FILE = path.join(ROOT, 'data/audit/geocode-test-20-before-matcher-fix.json');
const TEST_AUDIT_FILE = path.join(ROOT, 'data/audit/geocode-test-20.json');
const QUALITY_AUDIT_FILE = path.join(ROOT, 'data/audit/geocode-quality.json');
const DIFF_FILE = path.join(ROOT, 'data/audit/geocode-matcher-diff.json');

const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback) => {
  const prefix = `${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};
const requestedLimit = Number(valueArg('--limit', '20')) || 20;
if (args.has('--full') || requestedLimit > 20) throw new Error('Full-run mode remains intentionally disabled; at most 20 cached test records may be scored');
if (args.has('--apply')) throw new Error('Apply mode remains intentionally disabled; derived coordinates cannot be written in this phase');
if (!args.has('--cache-only')) throw new Error('Matcher repair audit requires --cache-only; network requests are disabled');
if (valueArg('--provider', 'amap') !== 'amap') throw new Error('This audit only re-scores the existing AMap cache');

const dataset = readJson(DERIVED_FILE);
const records = Array.isArray(dataset) ? dataset : dataset.records;
if (!Array.isArray(records) || records.length !== 901) throw new Error(`Expected 901 derived records, received ${records?.length ?? 'invalid'}`);
const mainland = records.filter((record) => record.region === '中国大陆');
const selectedRecords = selectTestRecords(mainland, Math.max(1, Math.min(20, requestedLimit)));
const cache = loadProviderCache(CACHE_FILE, 'amap');
const overrides = readJson(OVERRIDE_FILE);
const before = readJson(BEFORE_FILE);
const beforeByRow = new Map(before.records.map((record) => [record.sourceRow, record]));
const usedCacheKeys = new Set();
const auditedRecords = [];

for (const record of selectedRecords) {
  const plannedQueries = buildQueries(record);
  const linkedRequests = cache.requests.filter((entry) => (entry.sourceRows ?? []).some((row) => Number(row) === Number(record.sourceRow)));
  const candidates = [];
  const queryAudits = [];
  for (const request of linkedRequests) {
    usedCacheKeys.add(request.cacheKey ?? `${request.provider}|${request.city}|${request.query}`);
    queryAudits.push({
      query: request.query,
      city: request.city,
      cache: 'hit-linked-by-sourceRow',
      ok: Boolean(request.ok),
      candidateCount: (request.rawCandidates ?? request.candidates ?? []).length,
      isCurrentPlannedQuery: plannedQueries.some((query) => normalizeText(query.query) === normalizeText(request.query))
    });
    if (!request.ok) continue;
    for (const candidate of request.rawCandidates ?? request.candidates ?? []) candidates.push({ candidate, query: request.query });
  }
  const deduped = dedupeCandidates(candidates);
  const genericResult = chooseCandidate(record, deduped.map((item) => item.candidate));
  const override = reviewedOverrideFor(overrides, record.sourceRow);
  const result = applyReviewedOverride(record, genericResult, override);
  const ranked = result.ranked.map((candidate) => ({
    ...candidate,
    queryKinds: deduped.find((item) => sameCandidate(item.candidate, candidate))?.queries ?? []
  }));
  const selected = result.selected ? {
    ...result.selected,
    queryKinds: deduped.find((item) => sameCandidate(item.candidate, result.selected))?.queries ?? []
  } : null;
  auditedRecords.push({
    sourceRow: record.sourceRow,
    id: record.id,
    name: record.name,
    city: record.city,
    status: record.status,
    projectionSystem: record.projection?.system ?? null,
    plannedQueries,
    cachedQueriesUsed: queryAudits,
    candidateCount: ranked.length,
    rejectedCandidateCount: ranked.filter((candidate) => candidate.hardRejects.length > 0).length,
    rejectedReasons: countReasons(ranked.flatMap((candidate) => candidate.hardRejects)),
    ambiguity: result.ambiguity,
    reviewedOverride: result.override,
    rankedCandidates: ranked,
    selectedCandidate: selected
  });
}

const summary = summarize(auditedRecords, cache, usedCacheKeys);
const regression = buildRegressionAudit(auditedRecords, selectedRecords);
const generatedAt = new Date().toISOString();
const audit = {
  schemaVersion: 2,
  generatedAt,
  mode: 'cache-only-matcher-repair-audit',
  provider: 'amap',
  source: { derivedFile: 'data/derived/cinemas.json', totalRecords: 901, mainlandRecords: 881 },
  selection: { actualRecords: selectedRecords.length, sourceRows: selectedRecords.map((record) => record.sourceRow) },
  requestPolicy: {
    cacheOnly: true,
    environmentKeyRead: false,
    currentRunNetworkRequests: 0,
    cacheEntries: cache.requests.length,
    cacheEntriesUsed: usedCacheKeys.size,
    fullRunEnabled: false,
    applyEnabled: false
  },
  coordinatePolicy: {
    provider: 'AMap',
    providerCrs: 'GCJ-02',
    mapCrs: 'WGS84',
    providerCoordinatesPreserved: true,
    conversion: 'GCJ-02 to WGS84 before future apply'
  },
  summary,
  regression,
  records: auditedRecords.map(compactPublicRecord)
};

const diffs = auditedRecords.map((record) => {
  const prior = beforeByRow.get(record.sourceRow) ?? {};
  return {
    sourceRow: record.sourceRow,
    name: record.name,
    before: { decision: prior.decision ?? 'unknown', score: prior.score ?? null, poiId: prior.poiId ?? null, poiName: prior.poiName ?? null },
    after: {
      decision: record.selectedCandidate?.decision ?? 'unresolved',
      score: record.selectedCandidate?.score ?? null,
      poiId: record.selectedCandidate?.poiId ?? null,
      poiName: record.selectedCandidate?.name ?? null,
      positionType: record.selectedCandidate?.positionType ?? null,
      locationGranularity: record.selectedCandidate?.locationGranularity ?? null,
      locationConfidence: record.selectedCandidate?.locationConfidence ?? 'unknown',
      identityConfidence: record.selectedCandidate?.identityConfidence ?? 'unknown',
      confidence: record.selectedCandidate?.confidence ?? 'unknown',
      overrideApplied: Boolean(record.reviewedOverride?.applied)
    }
  };
});
const matcherDiff = {
  schemaVersion: 1,
  generatedAt,
  mode: 'existing-cache-only',
  networkRequests: 0,
  before: before.summary,
  after: {
    automaticHigh: summary.automaticHigh,
    automaticMedium: summary.automaticMedium,
    reviewedOverrideHigh: summary.reviewedOverrideHigh,
    reviewedOverrideMedium: summary.reviewedOverrideMedium,
    unresolved: summary.unresolved
  },
  records: diffs,
  formerlyUnresolved: diffs.filter((record) => [309, 51, 155, 538, 843].includes(record.sourceRow)),
  regression
};

writeJson(TEST_AUDIT_FILE, audit);
writeJson(DIFF_FILE, matcherDiff);
writeJson(QUALITY_AUDIT_FILE, {
  schemaVersion: 2,
  generatedAt,
  status: 'cache-only-test-not-full-run',
  total: 901,
  evaluated: auditedRecords.length,
  provider: 'AMap',
  byDecision: {
    automaticHigh: summary.automaticHigh,
    automaticMedium: summary.automaticMedium,
    reviewedOverrideHigh: summary.reviewedOverrideHigh,
    reviewedOverrideMedium: summary.reviewedOverrideMedium,
    unresolvedWithinTest: summary.unresolved,
    outsideTestUnresolved: 901 - auditedRecords.length
  },
  automaticAccepted: summary.automaticHigh + summary.automaticMedium,
  reviewedOverrideAccepted: summary.reviewedOverrideHigh + summary.reviewedOverrideMedium,
  unresolved: summary.unresolved + (901 - auditedRecords.length),
  currentRunNetworkRequests: 0,
  coordinatesAppliedToDerived: 0,
  regression
});

console.log(JSON.stringify({
  ok: true,
  mode: audit.mode,
  testedRecords: auditedRecords.length,
  cacheEntriesAvailable: cache.requests.length,
  cacheEntriesUsed: usedCacheKeys.size,
  requestsMade: 0,
  before: before.summary,
  after: matcherDiff.after,
  regression,
  coordinatesWritten: 0,
  audit: relative(TEST_AUDIT_FILE),
  diff: relative(DIFF_FILE)
}, null, 2));

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

function sameCandidate(left, right) {
  if (left?.id && right?.poiId) return left.id === right.poiId;
  return normalizeText(left?.name) === normalizeText(right?.name) && String(left?.location ?? '') === `${right?.providerLng ?? ''},${right?.providerLat ?? ''}`;
}

function dedupeCandidates(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.candidate.id ?? `${normalizeText(item.candidate.name)}|${item.candidate.location ?? ''}`;
    if (!map.has(key)) map.set(key, { candidate: item.candidate, queries: [item.query] });
    else if (!map.get(key).queries.includes(item.query)) map.get(key).queries.push(item.query);
  }
  return [...map.values()];
}

function countReasons(reasons) {
  const result = {};
  for (const reason of reasons) result[reason] = (result[reason] ?? 0) + 1;
  return result;
}

function summarize(rows, cacheState, usedCacheKeysState) {
  const isOverride = (row) => Boolean(row.reviewedOverride?.applied);
  const automaticHigh = rows.filter((row) => !isOverride(row) && row.selectedCandidate?.decision === 'accepted-high').length;
  const automaticMedium = rows.filter((row) => !isOverride(row) && ['review-required-medium', 'review-required-ambiguous'].includes(row.selectedCandidate?.decision)).length;
  const reviewedOverrideHigh = rows.filter((row) => isOverride(row) && row.selectedCandidate?.decision === 'accepted-high').length;
  const reviewedOverrideMedium = rows.filter((row) => isOverride(row) && ['review-required-medium', 'review-required-ambiguous'].includes(row.selectedCandidate?.decision)).length;
  return {
    evaluated: rows.length,
    automaticHigh,
    automaticMedium,
    reviewedOverrideHigh,
    reviewedOverrideMedium,
    unresolved: rows.length - automaticHigh - automaticMedium - reviewedOverrideHigh - reviewedOverrideMedium,
    candidateCount: rows.reduce((sum, row) => sum + row.candidateCount, 0),
    rejectedCandidateCount: rows.reduce((sum, row) => sum + row.rejectedCandidateCount, 0),
    rejectedReasons: countReasons(rows.flatMap((row) => row.rankedCandidates.flatMap((candidate) => candidate.hardRejects))),
    cacheEntriesAvailable: cacheState.requests.length,
    cacheEntriesUsed: usedCacheKeysState.size,
    networkRequests: 0
  };
}

function compactPublicRecord(record) {
  const selected = record.selectedCandidate;
  const top = record.rankedCandidates[0] ?? null;
  return {
    sourceRow: record.sourceRow,
    id: record.id,
    name: record.name,
    city: record.city,
    status: record.status,
    projectionSystem: record.projectionSystem,
    plannedQueries: record.plannedQueries,
    cachedQueriesUsed: record.cachedQueriesUsed,
    candidateCount: record.candidateCount,
    rejectedCandidateCount: record.rejectedCandidateCount,
    rejectedReasons: record.rejectedReasons,
    ambiguity: record.ambiguity,
    overrideUsed: Boolean(record.reviewedOverride?.applied),
    reviewedOverride: record.reviewedOverride,
    selectedCandidate: selected ? compactCandidate(selected) : null,
    topCandidate: selected || !top ? null : compactCandidate(top)
  };
}

function compactCandidate(candidate) {
  return {
    poiId: candidate.poiId,
    name: candidate.name,
    address: candidate.address,
    typecode: candidate.typecode,
    positionType: candidate.positionType,
    locationGranularity: candidate.locationGranularity,
    score: candidate.score,
    decision: candidate.decision,
    confidence: candidate.confidence,
    locationConfidence: candidate.locationConfidence,
    identityConfidence: candidate.identityConfidence,
    adminMatch: candidate.adminMatch,
    formatCompatibility: {
      compatible: candidate.formatCompatibility?.compatible ?? true,
      exactFormatMatch: candidate.formatCompatibility?.exactFormatMatch ?? false,
      conflicts: candidate.formatCompatibility?.conflicts ?? []
    },
    geocodeSource: candidate.geocodeSource,
    provider: { providerCrs: candidate.providerCrs, providerLat: candidate.providerLat, providerLng: candidate.providerLng },
    map: { mapCrs: candidate.mapCrs, lat: candidate.lat, lng: candidate.lng }
  };
}

function buildRegressionAudit(rows, sourceRecords) {
  const allCandidates = rows.flatMap((row) => row.rankedCandidates.map((candidate) => ({ sourceRow: row.sourceRow, ...candidate })));
  const selectedCandidates = rows.map((row) => row.selectedCandidate).filter(Boolean);
  const strictMallCodes = new Set(['060100', '060101', '060102']);
  const invalidMallFallbacks = allCandidates.filter((candidate) => candidate.positionType === 'mall-fallback' && !(String(candidate.typecode).match(/\d{6}/g) ?? []).some((code) => strictMallCodes.has(code)));
  const nonCinemaPromoted = allCandidates.filter((candidate) => candidate.poiKind === 'cinema' && !(String(candidate.typecode).match(/\d{6}/g) ?? []).includes('080601'));
  const jiuyuan = rows.find((row) => row.sourceRow === 610);
  const badJiuyuanQueries = (jiuyuan?.plannedQueries ?? []).filter((query) => /万达影城（九\s+包头/.test(query.query));
  const longgang = rows.find((row) => row.sourceRow === 228);
  const rejectedNearTop = (longgang?.rankedCandidates ?? []).filter((candidate) => candidate.hardRejects.length > 0 && /9d|飞行影院|游戏机/.test(normalizeText(candidate.name)));
  const focus = Object.fromEntries([309, 51, 155, 538, 843].map((sourceRow) => {
    const row = rows.find((item) => item.sourceRow === sourceRow);
    return [sourceRow, row?.selectedCandidate ? { decision: row.selectedCandidate.decision, poiId: row.selectedCandidate.poiId, poiName: row.selectedCandidate.name, positionType: row.selectedCandidate.positionType } : { decision: 'unresolved', poiId: null, poiName: null, positionType: null }];
  }));
  return {
    currentRunNetworkRequests: 0,
    invalidMallFallbackCount: invalidMallFallbacks.length,
    invalidMallFallbacks: invalidMallFallbacks.map((item) => ({ sourceRow: item.sourceRow, poiId: item.poiId, name: item.name, typecode: item.typecode })),
    nonCinemaTypePromotedToCinemaCount: nonCinemaPromoted.length,
    jiuyuanMalformedHistoryQueryCount: badJiuyuanQueries.length,
    jiuyuanQueries: (jiuyuan?.plannedQueries ?? []).map((query) => query.query),
    longgangDecision: longgang?.selectedCandidate?.decision ?? 'unresolved',
    longgangHardRejectedDistractors: rejectedNearTop.map((candidate) => ({ poiId: candidate.poiId, name: candidate.name, reasons: candidate.hardRejects })),
    longgangTrueAmbiguity: Boolean(longgang?.ambiguity?.trueAmbiguity),
    focusRows: focus,
    crsFieldsCompleteForSelected: selectedCandidates.every((candidate) => candidate.providerCrs === 'GCJ-02' && candidate.mapCrs === 'WGS84' && Number.isFinite(candidate.providerLat) && Number.isFinite(candidate.providerLng) && Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng)),
    convertedCoordinatesWithinRange: selectedCandidates.every((candidate) => candidate.lat >= -90 && candidate.lat <= 90 && candidate.lng >= -180 && candidate.lng <= 180),
    providerCoordinatesPreservedSeparately: selectedCandidates.every((candidate) => candidate.providerLat !== candidate.lat || candidate.providerLng !== candidate.lng),
    selectedCoordinateCount: selectedCandidates.length,
    sourceRecordCount: sourceRecords.length
  };
}

function recordText(record) {
  return normalizeText([record.name, record.nameRaw, ...(record.formerNames ?? [])].join(' '));
}

function takeFirst(pool, predicate, count, used, selections) {
  const matches = pool.filter((record) => !used.has(record.id) && predicate(record));
  for (const record of matches.slice(0, count)) {
    used.add(record.id);
    selections.push(record);
  }
}

function selectTestRecords(pool, limit) {
  const used = new Set();
  const selections = [];
  takeFirst(pool, (record) => record.city === '北京' && /中国电影博物馆|环球城市大道|石景山/.test(recordText(record)), 3, used, selections);
  takeFirst(pool, (record) => record.city === '上海' && /五角场|iapm|百丽宫|荟聚/.test(recordText(record)), 3, used, selections);
  takeFirst(pool, (record) => ['广州', '深圳'].includes(record.city) && /云门|乐峰|平安金融中心|龙岗万达/.test(recordText(record)), 4, used, selections);
  takeFirst(pool, (record) => record.city === '西安' && /荟聚|寰映/.test(recordText(record)), 1, used, selections);
  takeFirst(pool, (record) => record.city === '成都' && /环球中心|ifs|金融城|国际金融中心/.test(recordText(record)), 2, used, selections);
  takeFirst(pool, (record) => record.projection?.system === 'GT Laser', 1, used, selections);
  takeFirst(pool, (record) => record.projection?.dome === true, 1, used, selections);
  takeFirst(pool, (record) => record.status === 'closed', 1, used, selections);
  const remaining = pool.filter((record) => !used.has(record.id)).sort((left, right) => stableNumber(left.sourceRow) - stableNumber(right.sourceRow));
  for (const record of remaining) {
    if (selections.length >= limit) break;
    used.add(record.id);
    selections.push(record);
  }
  return selections.slice(0, limit);
}

function stableNumber(value) {
  return (Number(value) * 2654435761) % 2147483647;
}
