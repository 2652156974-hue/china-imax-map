import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FULL_FILE = path.join(ROOT, 'data/audit/geocode-mainland-full.json');
const QUALITY_FILE = path.join(ROOT, 'data/audit/geocode-mainland-quality.json');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const CACHE_FILE = path.join(ROOT, 'data/geocode/provider-cache/amap.json');
const MATCHER_LOCK_FILE = path.join(ROOT, 'data/audit/geocode-blind-50-matcher-lock.json');
const BLIND_50_FILE = path.join(ROOT, 'data/audit/geocode-blind-50.json');
const FREEZE_FILE = path.join(ROOT, 'data/audit/geocode-mainland-freeze.json');
const HIGH_SAMPLE_FILE = path.join(ROOT, 'data/audit/geocode-high-audit-150.json');
const RISK_FILE = path.join(ROOT, 'data/audit/geocode-risk-review.json');
const UNRESOLVED_FILE = path.join(ROOT, 'data/audit/geocode-unresolved-priority.json');

const SEED = 'china-imax-map-mainland-high-audit-150-v1';
const SAMPLE_TARGETS = Object.freeze({
  ordinaryCommercial: 60,
  duplicateHighCollisionChain: 30,
  formerNameHistoryComplex: 20,
  closedHistorical: 10,
  countyLevelCity: 10,
  specialFormatVenueAuditorium: 10,
  deterministicRandomFill: 10
});

const CHAIN_PATTERN = /万达|cgv|金逸|幸福蓝海|博纳|百丽宫|寰映|英皇|中影|保利|卢米埃|横店|大地|橙天|嘉禾|ume|星美|华谊兄弟|儒意|浙影时代/i;
const VENUE_PATTERN = /科技馆|科学技术馆|科学馆|博物馆|天文馆|科技中心|球幕|dome/i;
const EXPLICIT_HISTORY_PATTERN = /(^|[\n（(\s—–-])\s*原\s*[^平]|曾用名|更名|改名|换名|停业|停止放映|正式关闭|结束运营|正式结业|收购|重开|复业|升级|换幕|暂停营业|已拆除|已撤场/i;

const fullAudit = readJson(FULL_FILE);
const qualityAudit = readJson(QUALITY_FILE);
const derivedDocument = readJson(DERIVED_FILE);
const cacheDocument = readJson(CACHE_FILE);
const derivedRecords = Array.isArray(derivedDocument) ? derivedDocument : derivedDocument.records;
const fullRecords = fullAudit.records;
const derivedByRow = new Map(derivedRecords.map((record) => [Number(record.sourceRow), record]));
const providerCandidateById = indexProviderCandidates(cacheDocument);

if (!Array.isArray(fullRecords) || fullRecords.length !== 881) throw new Error('Expected 881 mainland full-audit records');
if (!Array.isArray(derivedRecords) || derivedRecords.length !== 901) throw new Error('Expected 901 derived records');

const regression = runRegressionTests();
const hashes = buildHashes();
const highPopulation = fullRecords.filter(isAutomaticHighWithoutOverride);
if (highPopulation.length !== 574) throw new Error(`Expected 574 eligible automaticHigh records, received ${highPopulation.length}`);

const sampleSelection = selectHighSample(highPopulation);
const blind50 = readJson(BLIND_50_FILE);
const highSampleAudit = buildHighSampleAudit(sampleSelection, blind50, hashes);
const riskAudit = buildRiskAudit(hashes);
const unresolvedAudit = buildUnresolvedPriorityAudit(hashes);
const freezeAudit = buildFreezeAudit(hashes, regression, riskAudit, unresolvedAudit);

writeJson(FREEZE_FILE, freezeAudit);
writeJson(HIGH_SAMPLE_FILE, highSampleAudit);
writeJson(RISK_FILE, riskAudit);
writeJson(UNRESOLVED_FILE, unresolvedAudit);

console.log(JSON.stringify({
  ok: true,
  networkRequests: 0,
  regression,
  freeze: relative(FREEZE_FILE),
  highSample: {
    file: relative(HIGH_SAMPLE_FILE),
    count: highSampleAudit.records.length,
    target: 150,
    allAutomaticHigh: highSampleAudit.records.every((record) => record.decision === 'automaticHigh'),
    allOverrideFalse: highSampleAudit.records.every((record) => record.overrideUsed === false),
    strata: highSampleAudit.selection.actualCounts,
    overlapWithBlind50: highSampleAudit.selection.overlapWithBlind50.count
  },
  riskReview: { file: relative(RISK_FILE), count: riskAudit.records.length },
  unresolvedPriority: { file: relative(UNRESOLVED_FILE), count: unresolvedAudit.records.length }
}, null, 2));

function buildHashes() {
  const matcherLock = readJson(MATCHER_LOCK_FILE);
  const matcher = matcherLock.matcherSha256;
  if (!matcher) throw new Error('Blind matcher lock does not contain matcherSha256');
  return {
    algorithm: 'SHA-256',
    matcherSha256: matcher,
    matcherLockFile: relative(MATCHER_LOCK_FILE),
    matcherLockSchemaVersion: matcherLock.schemaVersion ?? null,
    querySha256: hashFile(path.join(ROOT, 'scripts/geocode/query.mjs')),
    crsSha256: hashFile(path.join(ROOT, 'scripts/geocode/crs.mjs')),
    adminMappingSha256: hashFile(path.join(ROOT, 'data/geocode/mainland-admin-hierarchy.json')),
    fullAuditSha256: hashFile(FULL_FILE),
    providerCacheSha256: hashFile(CACHE_FILE)
  };
}

function buildFreezeAudit(hashes, regressionResult, riskAudit, unresolvedAudit) {
  const coordinateState = derivedRecords.reduce((state, record) => {
    const lat = record.location?.lat;
    const lng = record.location?.lng;
    if (lat === null && lng === null) state.bothNull += 1;
    else if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) state.populated += 1;
    else state.invalid += 1;
    return state;
  }, { bothNull: 0, populated: 0, invalid: 0 });
  const summary = qualityAudit.summary;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'frozen-baseline-for-human-quality-acceptance',
    scope: 'mainland',
    totalMainland: 881,
    hashes,
    currentRegressionResult: regressionResult,
    baselineSummary: {
      automaticHigh: summary.automaticHigh,
      automaticMedium: summary.automaticMedium,
      reviewedOverrideHigh: summary.reviewedOverrideHigh,
      unresolved: summary.unresolved
    },
    derivedCoordinateState: coordinateState,
    humanAuditArtifacts: {
      highSample150: relative(HIGH_SAMPLE_FILE),
      riskReview: relative(RISK_FILE),
      unresolvedPriority: relative(UNRESOLVED_FILE),
      riskReviewUniqueSourceRows: riskAudit.records.length,
      unresolvedPriorityRecords: unresolvedAudit.records.length
    },
    networkPolicy: {
      networkRequests: 0,
      apiCallsAllowed: false,
      matcherChangesAllowed: false,
      scoringChangesAllowed: false,
      queryChangesAllowed: false,
      crsChangesAllowed: false,
      newOverridesAllowed: false,
      applyCoordinatesAllowed: false
    }
  };
}

function selectHighSample(population) {
  const selected = [];
  const used = new Set();
  const actualCounts = {};
  const availableCounts = {};
  const shortfalls = {};
  const select = (stratum, predicate) => {
    const target = SAMPLE_TARGETS[stratum];
    const candidates = shuffled(population.filter((record) => !used.has(Number(record.sourceRow)) && predicate(record)), SEED, stratum);
    availableCounts[stratum] = candidates.length;
    const selectedCount = Math.min(candidates.length, target);
    if (selectedCount < target) shortfalls[stratum] = target - selectedCount;
    for (const record of candidates.slice(0, selectedCount)) {
      const sourceRow = Number(record.sourceRow);
      used.add(sourceRow);
      selected.push({ stratum, record });
      actualCounts[stratum] = (actualCounts[stratum] ?? 0) + 1;
    }
  };

  select('ordinaryCommercial', isOrdinaryCommercial);
  select('duplicateHighCollisionChain', isDuplicateHighCollisionChain);
  select('formerNameHistoryComplex', isFormerNameHistoryComplex);
  select('closedHistorical', isClosedHistorical);
  select('countyLevelCity', (record) => Boolean(record.countyLevelCity));
  select('specialFormatVenueAuditorium', isSpecialFormatVenueAuditorium);
  const specialShortfall = shortfalls.specialFormatVenueAuditorium ?? 0;
  const fillTarget = SAMPLE_TARGETS.deterministicRandomFill + specialShortfall;
  const fillCandidates = shuffled(population.filter((record) => !used.has(Number(record.sourceRow))), SEED, 'deterministicRandomFill');
  availableCounts.deterministicRandomFill = fillCandidates.length;
  if (fillCandidates.length < fillTarget) throw new Error(`High-audit deterministic fill has ${fillCandidates.length}; ${fillTarget} required`);
  for (const record of fillCandidates.slice(0, fillTarget)) {
    const sourceRow = Number(record.sourceRow);
    used.add(sourceRow);
    selected.push({ stratum: 'deterministicRandomFill', record });
    actualCounts.deterministicRandomFill = (actualCounts.deterministicRandomFill ?? 0) + 1;
  }

  if (selected.length !== 150 || new Set(selected.map((item) => Number(item.record.sourceRow))).size !== 150) {
    throw new Error('High audit sample must contain exactly 150 unique source rows');
  }
  return { selected, actualCounts, availableCounts, shortfalls, reallocatedToDeterministicFill: specialShortfall };
}

function buildHighSampleAudit(selection, blind50, hashes) {
  const blindRows = new Set((blind50.selection?.sourceRows ?? blind50.sourceRows ?? blind50.records?.map((record) => record.sourceRow) ?? []).map(Number));
  const sourceRows = selection.selected.map((item) => Number(item.record.sourceRow));
  const overlap = sourceRows.filter((sourceRow) => blindRows.has(sourceRow));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'awaiting-external-human-verification',
    mode: 'mainland-automatic-high-blind-audit-150',
    population: {
      totalMainland: 881,
      eligibleAutomaticHigh: 574,
      eligibility: 'selected.automaticDecision=accepted-high AND overrideUsed=false',
      overridesIncluded: false,
      matcherSha256: hashes.matcherSha256
    },
    selection: {
      seed: SEED,
      targetCounts: SAMPLE_TARGETS,
      availableCounts: selection.availableCounts,
      actualCounts: selection.actualCounts,
      shortfalls: selection.shortfalls,
      reallocatedToDeterministicFill: selection.reallocatedToDeterministicFill,
      sourceRows,
      overlapWithBlind50: { count: overlap.length, sourceRows: overlap }
    },
    records: selection.selected.map(({ stratum, record }) => ({
      stratum,
      ...sourceSummary(record),
      decision: decisionBucket(record),
      overrideUsed: false,
      selected: enrichCandidate(record.selected),
      providerCoordinate: record.selected?.provider ? {
        crs: record.selected.provider.providerCrs,
        lat: record.selected.provider.providerLat,
        lng: record.selected.provider.providerLng
      } : null,
      mapCoordinate: record.selected?.map ? {
        crs: record.selected.map.mapCrs,
        lat: record.selected.map.lat,
        lng: record.selected.map.lng
      } : null,
      queryVariantsSummary: summarizeQueries(record.queryVariants),
      formatCompatibilitySummary: record.selected?.formatCompatibility ?? null
    }))
  };
}

function buildRiskAudit(hashes) {
  const duplicateGroups = duplicateSelectedPoiGroups(fullRecords);
  const duplicateByRow = new Map();
  for (const group of duplicateGroups) {
    for (const item of group.records) duplicateByRow.set(Number(item.sourceRow), group);
  }

  const byRow = new Map();
  for (const record of fullRecords) {
    const reasonTags = riskReasonTags(record, duplicateByRow.get(Number(record.sourceRow)));
    if (!reasonTags.length) continue;
    const row = Number(record.sourceRow);
    byRow.set(row, {
      sourceRow: row,
      sourceName: record.sourceName,
      city: record.city,
      province: record.province,
      status: record.status,
      projection: record.projection,
      formerNames: derivedByRow.get(row)?.formerNames ?? [],
      sourceCategory: record.sourceCategory,
      countyLevelCity: Boolean(record.countyLevelCity),
      decision: decisionBucket(record),
      reasonTags,
      selected: enrichCandidate(record.selected),
      topCandidate: enrichCandidate(record.topCandidate),
      queryVariantsSummary: summarizeQueries(record.queryVariants),
      hardRejectSummary: record.hardRejectSummary,
      ambiguity: record.ambiguity,
      overrideUsed: Boolean(record.overrideUsed),
      reviewedOverride: record.reviewedOverride ?? null,
      duplicateSelectedPoiGroup: duplicateByRow.get(row) ?? null
    });
  }
  const records = [...byRow.values()].sort((left, right) => left.sourceRow - right.sourceRow);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'awaiting-external-human-verification',
    mode: 'mainland-risk-review',
    totalMainland: 881,
    matcherSha256: hashes.matcherSha256,
    networkRequests: 0,
    sourceRules: [
      'all automaticMedium',
      'all trueAmbiguity',
      'all mall-fallback',
      'all venue-poi',
      'all auditorium granularity',
      'all GT Laser',
      'all Dome',
      'all closed or temporarily_closed',
      'all duplicate selected POI groups',
      'unresolved with top candidate score >= 0.70'
    ],
    duplicateSelectedPoiGroups: duplicateGroups,
    summary: {
      uniqueSourceRows: records.length,
      reasonTagCounts: countTags(records),
      highlightedDuplicateRows: [[380, 825], [785, 786]]
    },
    records
  };
}

function buildUnresolvedPriorityAudit(hashes) {
  const unresolved = fullRecords.filter((record) => !record.selected && decisionBucket(record) === 'unresolved');
  const records = unresolved.map((record) => {
    const priority = unresolvedPriority(record);
    const row = Number(record.sourceRow);
    return {
      priority: priority.rank,
      priorityCategory: priority.category,
      sourceRow: row,
      sourceName: record.sourceName,
      city: record.city,
      province: record.province,
      status: record.status,
      projection: record.projection,
      formerNames: derivedByRow.get(row)?.formerNames ?? [],
      sourceCategory: record.sourceCategory,
      reasonTags: priority.reasonTags,
      topCandidate: enrichCandidate(record.topCandidate),
      topCandidateScore: record.topCandidate?.score ?? null,
      queryVariantsSummary: summarizeQueries(record.queryVariants),
      hardRejectSummary: record.hardRejectSummary,
      ambiguity: record.ambiguity,
      overrideUsed: Boolean(record.overrideUsed)
    };
  }).sort((left, right) => left.priority - right.priority || (right.topCandidateScore ?? -1) - (left.topCandidateScore ?? -1) || left.sourceRow - right.sourceRow);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'todo-no-resolution-attempted',
    mode: 'mainland-unresolved-priority',
    totalMainland: 881,
    unresolved: unresolved.length,
    matcherSha256: hashes.matcherSha256,
    networkRequests: 0,
    overridesAdded: 0,
    priorityRules: [
      '1: GT Laser',
      '2: Dome',
      '3: closed or historical with identifiable venue',
      '4: unresolved top candidate score >= 0.70',
      '5: ordinary unresolved'
    ],
    priorityCounts: countValues(records.map((record) => String(record.priority))),
    records
  };
}

function isAutomaticHighWithoutOverride(record) {
  return Boolean(record.selected)
    && record.selected.automaticDecision === 'accepted-high'
    && record.overrideUsed === false;
}

function isOrdinaryCommercial(record) {
  return record.sourceCategory === 'commercial-cinema'
    && !['closed', 'temporarily_closed'].includes(record.status)
    && !isDuplicateHighCollisionChain(record)
    && !isFormerNameHistoryComplex(record)
    && !record.countyLevelCity
    && !isSpecialFormatVenueAuditorium(record);
}

function isDuplicateHighCollisionChain(record) {
  return CHAIN_PATTERN.test(record.sourceName ?? '')
    && !['closed', 'temporarily_closed'].includes(record.status)
    && !isFormerNameHistoryComplex(record)
    && !isSpecialFormatVenueAuditorium(record);
}

function isFormerNameHistoryComplex(record) {
  const derived = derivedByRow.get(Number(record.sourceRow));
  return (derived?.formerNames ?? []).length > 0
    || EXPLICIT_HISTORY_PATTERN.test(`${record.sourceName ?? ''} ${derived?.nameRaw ?? ''}`)
    || Boolean(derived?.historySummary && derived.historySummary !== '未发现可安全判定营业状态的明确信号');
}

function isClosedHistorical(record) {
  return ['closed', 'temporarily_closed'].includes(record.status)
    || isFormerNameHistoryComplex(record);
}

function isSpecialFormatVenueAuditorium(record) {
  return record.projection?.system === 'GT Laser'
    || record.projection?.dome === true
    || record.sourceCategory === 'institutional-venue'
    || record.selected?.positionType === 'venue-poi'
    || record.selected?.locationGranularity === 'auditorium'
    || VENUE_PATTERN.test(record.sourceName ?? '');
}

function unresolvedPriority(record) {
  const reasonTags = [];
  if (record.projection?.system === 'GT Laser') {
    reasonTags.push('gt-laser');
    return { rank: 1, category: 'gt-laser', reasonTags };
  }
  if (record.projection?.dome === true) {
    reasonTags.push('dome');
    return { rank: 2, category: 'dome', reasonTags };
  }
  const closedHistoricalVenue = ['closed', 'temporarily_closed'].includes(record.status)
    || isFormerNameHistoryComplex(record) && (record.sourceCategory === 'institutional-venue' || Boolean(record.topCandidate));
  if (closedHistoricalVenue) {
    reasonTags.push('closed-historical-venue');
    return { rank: 3, category: 'closed-historical-venue', reasonTags };
  }
  if ((record.topCandidate?.score ?? 0) >= 0.70) {
    reasonTags.push('high-score-unresolved');
    return { rank: 4, category: 'high-score-unresolved', reasonTags };
  }
  reasonTags.push('ordinary-unresolved');
  return { rank: 5, category: 'ordinary-unresolved', reasonTags };
}

function sourceSummary(record) {
  const row = Number(record.sourceRow);
  const derived = derivedByRow.get(row);
  return {
    sourceRow: row,
    sourceName: record.sourceName,
    city: record.city,
    province: record.province,
    status: record.status,
    projection: record.projection,
    formerNames: derived?.formerNames ?? []
  };
}

function enrichCandidate(candidate) {
  if (!candidate) return null;
  const provider = providerCandidateById.get(candidate.poiId) ?? null;
  return {
    poiId: candidate.poiId,
    name: candidate.name,
    address: candidate.address,
    pname: provider?.pname ?? candidate.adminMatch?.providerProvince ?? null,
    cityname: provider?.cityname ?? candidate.adminMatch?.providerPrefecture ?? null,
    adname: provider?.adname ?? candidate.adminMatch?.providerCounty ?? null,
    typecode: candidate.typecode,
    positionType: candidate.positionType,
    locationGranularity: candidate.locationGranularity,
    score: candidate.score,
    automaticDecision: candidate.automaticDecision,
    confidence: candidate.confidence,
    locationConfidence: candidate.locationConfidence,
    identityConfidence: candidate.identityConfidence,
    providerCoordinate: candidate.provider ? {
      crs: candidate.provider.providerCrs,
      lat: candidate.provider.providerLat,
      lng: candidate.provider.providerLng
    } : null,
    mapCoordinate: candidate.map ? {
      crs: candidate.map.mapCrs,
      lat: candidate.map.lat,
      lng: candidate.map.lng
    } : null,
    formatCompatibility: candidate.formatCompatibility ?? null,
    geocodeSource: candidate.geocodeSource ?? null
  };
}

function summarizeQueries(queries) {
  return (queries ?? []).map((query) => ({
    kind: query.kind,
    query: query.query,
    cache: query.cache,
    ok: query.ok,
    candidateCount: query.candidateCount,
    errorCode: query.errorCode ?? null
  }));
}

function riskReasonTags(record, duplicateGroup) {
  const tags = [];
  if (decisionBucket(record) === 'automaticMedium' || decisionBucket(record) === 'reviewedOverrideMedium') tags.push('medium');
  if (record.ambiguity?.trueAmbiguity) tags.push('ambiguity');
  if (record.selected?.positionType === 'mall-fallback') tags.push('mall-fallback');
  if (record.selected?.positionType === 'venue-poi') tags.push('venue-poi');
  if (record.selected?.locationGranularity === 'auditorium') tags.push('auditorium');
  if (record.projection?.system === 'GT Laser') tags.push('gt-laser');
  if (record.projection?.dome === true) tags.push('dome');
  if (['closed', 'temporarily_closed'].includes(record.status)) tags.push(record.status);
  if (duplicateGroup) tags.push('duplicate-selected-poi');
  if (!record.selected && (record.topCandidate?.score ?? 0) >= 0.70) tags.push('unresolved-high-score');
  return tags;
}

function duplicateSelectedPoiGroups(records) {
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
      sourceRows: items.map((record) => Number(record.sourceRow)),
      records: items.map((record) => ({
        sourceRow: Number(record.sourceRow),
        sourceName: record.sourceName,
        city: record.city,
        decision: decisionBucket(record),
        selectedName: record.selected.name
      }))
    }));
}

function countTags(records) {
  const counts = {};
  for (const record of records) for (const tag of record.reasonTags) counts[tag] = (counts[tag] ?? 0) + 1;
  return counts;
}

function decisionBucket(record) {
  if (!record.selected) return 'unresolved';
  const high = record.selected.automaticDecision === 'accepted-high';
  const medium = ['review-required-medium', 'review-required-ambiguous'].includes(record.selected.automaticDecision);
  if (record.overrideUsed) return high ? 'reviewedOverrideHigh' : medium ? 'reviewedOverrideMedium' : 'unresolved';
  return high ? 'automaticHigh' : medium ? 'automaticMedium' : 'unresolved';
}

function indexProviderCandidates(cache) {
  const result = new Map();
  for (const request of cache.requests ?? []) {
    for (const candidate of request.rawCandidates ?? []) {
      if (candidate.id && !result.has(candidate.id)) result.set(candidate.id, candidate);
    }
  }
  return result;
}

function shuffled(records, seed, label) {
  const result = [...records].sort((left, right) => Number(left.sourceRow) - Number(right.sourceRow));
  const random = mulberry32(seedNumber(`${seed}:${label}`));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function seedNumber(seed) {
  return crypto.createHash('sha256').update(seed).digest().readUInt32LE(0);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function runRegressionTests() {
  const testFiles = fs.readdirSync(path.join(ROOT, 'scripts/geocode'))
    .filter((file) => file.endsWith('.test.mjs'))
    .sort()
    .map((file) => path.join('scripts/geocode', file));
  const env = { ...process.env };
  delete env.AMAP_API_KEY;
  delete env.TENCENT_MAP_KEY;
  const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: ROOT,
    env,
    encoding: 'utf8'
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const readCount = (label) => Number(output.match(new RegExp(`(?:ℹ\\s*)?${label}\\s+(\\d+)`))?.[1] ?? 0);
  const regression = {
    command: `node --test ${testFiles.join(' ')}`,
    testFiles,
    exitCode: result.status ?? 1,
    tests: readCount('tests'),
    passed: readCount('pass'),
    failed: readCount('fail'),
    cancelled: readCount('cancelled'),
    skipped: readCount('skipped'),
    todo: readCount('todo'),
    networkRequests: 0
  };
  regression.status = regression.exitCode === 0 && regression.failed === 0 ? 'passed' : 'failed';
  if (regression.status !== 'passed') throw new Error(`Regression tests did not pass: ${JSON.stringify(regression)}`);
  return regression;
}

function hashFile(filePath) {
  return {
    path: relative(filePath),
    exists: fs.existsSync(filePath),
    value: fs.existsSync(filePath) ? crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') : null
  };
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

function countValues(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
