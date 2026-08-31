import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as amap from './geocode/providers/amap.mjs';
import { adminHierarchyAudit, isCountyLevelTarget } from './geocode/admin-divisions.mjs';
import { matcherFingerprint } from './geocode/blind-selection.mjs';
import { cacheKey, findCachedRequest, loadProviderCache, upsertCachedRequest, writeProviderCache } from './geocode/cache.mjs';
import { applyReviewedOverride, reviewedOverrideFor } from './geocode/overrides.mjs';
import { chooseCandidate, normalizeText } from './geocode/scoring.mjs';
import { buildQueries } from './geocode/query.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const CACHE_FILE = path.join(ROOT, 'data/geocode/provider-cache/amap.json');
const OVERRIDE_FILE = path.join(ROOT, 'data/geocode/reviewed-overrides.json');
const AUDIT_FILE = path.join(ROOT, 'data/audit/geocode-mainland-full.json');
const QUALITY_FILE = path.join(ROOT, 'data/audit/geocode-mainland-quality.json');
const REQUIRED_COUNTY_CITIES = ['太仓', '昆山', '张家港', '常熟', '江阴', '宜兴', '余姚', '慈溪', '义乌', '桐乡', '海宁', '乐清', '温岭', '晋江', '石狮', '福清'];

const args = process.argv.slice(2);
const scope = args.find((item) => item.startsWith('--scope='))?.slice('--scope='.length) ?? '';
const dryRun = args.includes('--dry-run');
const cacheOnly = args.includes('--cache-only');
const retryFailed = args.includes('--retry-failed');
if (args.includes('--apply')) throw new Error('--apply remains disabled; this runner never writes derived coordinates');
if (scope !== 'mainland' || !dryRun) throw new Error('This runner requires --scope=mainland --dry-run');
if (args.some((item) => item.startsWith('--limit='))) throw new Error('Partial limits are not supported by the mainland audit runner');

const minIntervalMs = Math.max(500, Number(process.env.AMAP_MIN_INTERVAL_MS || 800));
const configuredRequestBudget = Number(process.env.AMAP_MAX_NEW_REQUESTS || 600);
const maxNewRequests = Number.isFinite(configuredRequestBudget) && configuredRequestBudget >= 0
  ? Math.min(600, Math.floor(configuredRequestBudget))
  : 600;
const dataset = readJson(DERIVED_FILE);
const records = (Array.isArray(dataset) ? dataset : dataset.records).filter((record) => record.region === '中国大陆');
if (records.length !== 881) throw new Error(`Expected 881 mainland records, received ${records.length}`);
const overrides = readJson(OVERRIDE_FILE);
const cache = loadProviderCache(CACHE_FILE, 'amap');
const cacheEntriesAtStart = cache.requests.length;
const matcher = matcherFingerprint(ROOT);
const startedAt = new Date().toISOString();
const publicRecords = [];
const rejectionReasons = {};
let networkRequests = 0;
let cacheHits = 0;
let providerErrors = 0;
let consecutiveProviderErrors = 0;
let lastRequestAt = 0;

for (let index = 0; index < records.length; index += 1) {
  const record = records[index];
  const queries = buildQueries(record);
  const candidateItems = [];
  const queryVariants = [];

  for (const query of queries) {
    let entry = findCachedRequest(cache, 'amap', query.query, record.city);
    let cacheStatus;
    if (entry && (entry.ok || !retryFailed)) {
      cacheHits += 1;
      cacheStatus = 'hit';
    } else {
      if (networkRequests >= maxNewRequests) {
        writeAudits('stopped-after-amap-request-budget');
        throw new Error(`Stopped before a new AMap request: run budget ${maxNewRequests} has been reached`);
      }
      if (cacheOnly) throw new Error(`Cache-only mainland run refused a network request for sourceRow=${record.sourceRow}, query=${query.query}`);
      const availability = amap.availability();
      if (!availability.available) throw new Error('AMAP_API_KEY is not available in this process environment');
      const waitMs = Math.max(0, minIntervalMs - (Date.now() - lastRequestAt));
      if (waitMs) await sleep(waitMs);
      const response = await amap.searchPlace({ query: query.query, city: record.city, offset: 25, page: 1, extensions: 'all' });
      lastRequestAt = Date.now();
      networkRequests += 1;
      if (!response.ok) {
        providerErrors += 1;
        consecutiveProviderErrors += 1;
      } else {
        consecutiveProviderErrors = 0;
      }
      entry = {
        cacheKey: cacheKey('amap', query.query, record.city),
        provider: 'amap',
        query: query.query,
        city: record.city,
        requestTimestamp: response.fetchedAt ?? new Date().toISOString(),
        sourceRows: [record.sourceRow],
        ok: Boolean(response.ok),
        rawCandidates: response.candidates ?? [],
        rawMeta: response.rawMeta ?? null,
        error: response.ok ? null : { code: response.errorCode, message: response.errorMessage }
      };
      upsertCachedRequest(cache, entry);
      writeProviderCache(CACHE_FILE, cache);
      cacheStatus = 'miss-requested';
      if (consecutiveProviderErrors >= 3) {
        writeAudits('stopped-after-consecutive-provider-errors');
        throw new Error('Stopped after three consecutive AMap provider errors; cache and partial public audit were preserved');
      }
    }
    entry.sourceRows = [...new Set([...(entry.sourceRows ?? []), record.sourceRow])];
    upsertCachedRequest(cache, entry);
    if (entry.ok) {
      for (const candidate of entry.rawCandidates ?? []) candidateItems.push({ candidate, queryKind: query.kind });
    }
    queryVariants.push({
      kind: query.kind,
      query: query.query,
      cache: cacheStatus,
      ok: Boolean(entry.ok),
      candidateCount: (entry.rawCandidates ?? []).length,
      errorCode: entry.error?.code ?? null
    });
  }

  writeProviderCache(CACHE_FILE, cache);
  const deduped = dedupeCandidates(candidateItems);
  const automaticResult = chooseCandidate(record, deduped.map((item) => item.candidate));
  const override = reviewedOverrideFor(overrides, record.sourceRow);
  const finalResult = applyReviewedOverride(record, automaticResult, override);
  const rejected = automaticResult.ranked.filter((candidate) => candidate.hardRejects.length > 0);
  for (const reason of rejected.flatMap((candidate) => candidate.hardRejects)) rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  const selected = finalResult.selected ? compactCandidate(finalResult.selected) : null;
  const topCandidate = selected || !automaticResult.ranked[0] ? null : compactCandidate(automaticResult.ranked[0]);

  publicRecords.push({
    sourceRow: record.sourceRow,
    sourceName: record.name,
    city: record.city,
    province: record.province,
    status: record.status,
    projection: {
      raw: record.projection?.raw ?? '',
      system: record.projection?.system ?? '',
      technology: record.projection?.technology ?? '',
      dome: Boolean(record.projection?.dome),
      audioChannels: record.projection?.audioChannels ?? null
    },
    sourceCategory: sourceCategory(record),
    countyLevelCity: isCountyLevelTarget(record.city),
    queryVariants,
    selected,
    topCandidate,
    hardRejectSummary: {
      candidateCount: automaticResult.ranked.length,
      rejectedCandidateCount: rejected.length,
      reasons: countReasons(rejected.flatMap((candidate) => candidate.hardRejects))
    },
    ambiguity: automaticResult.ambiguity,
    overrideUsed: Boolean(finalResult.override?.applied),
    reviewedOverride: compactOverride(finalResult.override)
  });

  if ((index + 1) % 10 === 0 || index + 1 === records.length) {
    writeAudits(index + 1 === records.length ? 'complete-dry-run-awaiting-review' : 'running');
    console.error(`[mainland ${index + 1}/881] network=${networkRequests} cacheHits=${cacheHits} errors=${providerErrors} high=${summarize(publicRecords).automaticHigh}`);
  }
}

const finalSummary = summarize(publicRecords);
console.log(JSON.stringify({
  ok: true,
  status: 'complete-dry-run-awaiting-review',
  totalMainland: 881,
  ...finalSummary,
  provider: { networkRequests, cacheHits, providerErrors, maxNewRequests, cacheEntriesAtStart, cacheEntriesAtEnd: cache.requests.length },
  coordinatesWritten: 0,
  fullRunEnabled: true,
  applyEnabled: false,
  audit: relative(AUDIT_FILE),
  quality: relative(QUALITY_FILE)
}, null, 2));

function writeAudits(status) {
  const summary = summarize(publicRecords);
  const completed = publicRecords.length;
  const requestPolicy = {
    scope: 'mainland',
    dryRun: true,
    fullRunEnabled: true,
    applyEnabled: false,
    keySource: networkRequests ? 'process.env.AMAP_API_KEY' : 'not-used-cache-only',
    keyPersisted: false,
    keyPrinted: false,
    providerCache: 'local-private-gitignored',
    minimumIntervalMs: minIntervalMs,
    retryFailed,
    cacheOnly,
    maxNewRequests,
    networkRequests,
    cacheHits,
    providerErrors,
    cacheEntriesAtStart,
    cacheEntriesAtEnd: cache.requests.length
  };
  const coordinatePolicy = {
    provider: 'AMap',
    providerCrs: 'GCJ-02',
    mapCrs: 'WGS84',
    providerCoordinatesPreserved: true,
    cityCenterFallbackAllowed: false,
    coordinatesAppliedToDerived: 0
  };
  writeJson(AUDIT_FILE, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    status,
    mode: 'mainland-full-poi-dry-run',
    matcher,
    adminHierarchy: adminHierarchyAudit(),
    progress: { completed, totalMainland: 881 },
    summary,
    requestPolicy,
    coordinatePolicy,
    records: publicRecords
  });
  writeJson(QUALITY_FILE, buildQualityAudit(status, summary, requestPolicy, coordinatePolicy));
}

function buildQualityAudit(status, summary, requestPolicy, coordinatePolicy) {
  const segmentDefinitions = {
    commercialCinema: (record) => record.sourceCategory === 'commercial-cinema',
    institutionalVenue: (record) => record.sourceCategory === 'institutional-venue',
    closed: (record) => record.status === 'closed',
    gtLaser: (record) => record.projection.system === 'GT Laser',
    dome: (record) => record.projection.dome === true,
    countyLevelCity: (record) => record.countyLevelCity
  };
  const segments = Object.fromEntries(Object.entries(segmentDefinitions).map(([name, predicate]) => [name, segmentSummary(publicRecords.filter(predicate))]));
  const countyRecords = publicRecords.filter((record) => record.countyLevelCity);
  const countyCities = [...new Set([...REQUIRED_COUNTY_CITIES, ...countyRecords.map((record) => record.city)])];
  const countyByCity = Object.fromEntries(countyCities.map((city) => [city, segmentSummary(countyRecords.filter((record) => record.city === city))]));
  const selectedRecords = publicRecords.filter((record) => record.selected);
  const duplicatePoiSelections = duplicateSelectedPoiSelections(selectedRecords);
  const positionTypes = countValues(selectedRecords.map((record) => record.selected.positionType ?? 'unknown'));
  const granularities = countValues(selectedRecords.map((record) => record.selected.locationGranularity ?? 'unknown'));
  const medium = publicRecords.filter((record) => decisionBucket(record).endsWith('Medium'));
  const unresolved = publicRecords.filter((record) => decisionBucket(record) === 'unresolved');
  const manualReviewSet = {
    medium: medium.map(compactReviewRecord),
    unresolvedWithCandidateScoreAtLeast070: unresolved.filter((record) => (record.topCandidate?.score ?? 0) >= 0.7).map(compactReviewRecord),
    venueOrMall: selectedRecords.filter((record) => ['venue-poi', 'mall-fallback'].includes(record.selected.positionType)).map(compactReviewRecord),
    trueAmbiguity: publicRecords.filter((record) => record.ambiguity?.trueAmbiguity).map(compactReviewRecord)
  };
  const automaticHigh = publicRecords.filter((record) => decisionBucket(record) === 'automaticHigh');
  const reviewedOverrideHigh = publicRecords.filter((record) => decisionBucket(record) === 'reviewedOverrideHigh');
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    status,
    mode: 'mainland-full-poi-quality-audit',
    totalMainland: 881,
    evaluated: publicRecords.length,
    matcher,
    adminHierarchy: adminHierarchyAudit(),
    summary,
    sourceSegments: segments,
    selectedPositionTypes: positionTypes,
    selectedGranularities: granularities,
    rejectionCounts: {
      formatConflictRejected: rejectionReasons['auditorium-format-conflict'] ?? 0,
      cityMismatchRejected: rejectionReasons['city-mismatch'] ?? 0,
      projectMismatchRejected: rejectionReasons['project-mismatch'] ?? 0,
      brandMismatchRejected: rejectionReasons['brand-mismatch'] ?? 0,
      nonCinemaRejected: rejectionReasons['non-cinema-poi'] ?? 0,
      trueAmbiguity: publicRecords.filter((record) => record.ambiguity?.trueAmbiguity).length,
      allCandidateRejectReasons: { ...rejectionReasons }
    },
    entityIntegrity: {
      selectedRecords: selectedRecords.length,
      uniqueSelectedPoiIds: new Set(selectedRecords.map((record) => record.selected.poiId).filter(Boolean)).size,
      duplicateSelectedPoiIdCount: duplicatePoiSelections.length,
      duplicateSelectedPoiRows: duplicatePoiSelections.reduce((sum, item) => sum + item.records.length, 0),
      duplicateSelectedPoiSelections
    },
    countyLevelCities: {
      requiredCities: REQUIRED_COUNTY_CITIES,
      overall: segmentSummary(countyRecords),
      byCity: countyByCity
    },
    focusSets: {
      gtLaser: publicRecords.filter((record) => record.projection.system === 'GT Laser').map(compactReviewRecord),
      dome: publicRecords.filter((record) => record.projection.dome === true).map(compactReviewRecord),
      closed: publicRecords.filter((record) => record.status === 'closed').map(compactReviewRecord)
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
    manualReviewSet,
    requestPolicy,
    coordinatePolicy
  };
}

function summarize(rows) {
  const buckets = countValues(rows.map(decisionBucket));
  const automaticHigh = buckets.automaticHigh ?? 0;
  const automaticMedium = buckets.automaticMedium ?? 0;
  const reviewedOverrideHigh = buckets.reviewedOverrideHigh ?? 0;
  const reviewedOverrideMedium = buckets.reviewedOverrideMedium ?? 0;
  const unresolved = buckets.unresolved ?? 0;
  return {
    evaluated: rows.length,
    automaticHigh,
    automaticMedium,
    reviewedOverrideHigh,
    reviewedOverrideMedium,
    unresolved,
    coverage: rows.length ? Number(((automaticHigh + automaticMedium + reviewedOverrideHigh + reviewedOverrideMedium) / rows.length).toFixed(6)) : 0
  };
}

function segmentSummary(rows) {
  const summary = summarize(rows);
  return { records: rows.length, ...summary };
}

function decisionBucket(record) {
  if (!record.selected) return 'unresolved';
  const high = record.selected.automaticDecision === 'accepted-high';
  const medium = ['review-required-medium', 'review-required-ambiguous'].includes(record.selected.automaticDecision);
  if (record.overrideUsed) return high ? 'reviewedOverrideHigh' : medium ? 'reviewedOverrideMedium' : 'unresolved';
  return high ? 'automaticHigh' : medium ? 'automaticMedium' : 'unresolved';
}

function sourceCategory(record) {
  return /科技馆|科学技术馆|科学馆|博物馆|天文馆|科技中心/.test(normalizeText([record.name, record.nameRaw].join(' ')))
    ? 'institutional-venue'
    : 'commercial-cinema';
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
    automaticDecision: candidate.decision,
    confidence: candidate.confidence,
    locationConfidence: candidate.locationConfidence,
    identityConfidence: candidate.identityConfidence,
    geocodeSource: candidate.geocodeSource,
    adminMatch: candidate.adminMatch,
    formatCompatibility: {
      compatible: candidate.formatCompatibility?.compatible ?? true,
      exactFormatMatch: candidate.formatCompatibility?.exactFormatMatch ?? false,
      conflicts: candidate.formatCompatibility?.conflicts ?? []
    },
    provider: { providerCrs: candidate.providerCrs, providerLat: candidate.providerLat, providerLng: candidate.providerLng },
    map: { mapCrs: candidate.mapCrs, lat: candidate.lat, lng: candidate.lng },
    reviewedOverride: candidate.reviewedOverride ?? null
  };
}

function compactOverride(override) {
  if (!override) return null;
  return {
    sourceRow: override.sourceRow,
    status: override.status,
    provider: override.provider,
    poiId: override.poiId,
    confidence: override.confidence,
    positionType: override.positionType,
    evidence: override.evidence,
    provenance: override.provenance,
    applied: Boolean(override.applied),
    reason: override.reason ?? null
  };
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
    const items = byPoiId.get(record.selected.poiId) ?? [];
    items.push(record);
    byPoiId.set(record.selected.poiId, items);
  }
  return [...byPoiId.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([poiId, items]) => ({
      poiId,
      records: items.map((record) => ({
        sourceRow: record.sourceRow,
        sourceName: record.sourceName,
        city: record.city,
        decision: decisionBucket(record),
        selectedName: record.selected.name
      }))
    }));
}

function countValues(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function countReasons(reasons) {
  return countValues(reasons);
}

function dedupeCandidates(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.candidate.id ?? `${normalizeText(item.candidate.name)}|${item.candidate.location ?? ''}`;
    if (!map.has(key)) map.set(key, { candidate: item.candidate, queryKinds: [item.queryKind] });
    else if (!map.get(key).queryKinds.includes(item.queryKind)) map.get(key).queryKinds.push(item.queryKind);
  }
  return [...map.values()];
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
