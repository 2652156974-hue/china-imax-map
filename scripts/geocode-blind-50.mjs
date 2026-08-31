import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as amap from './geocode/providers/amap.mjs';
import { cacheKey, findCachedRequest, loadProviderCache, upsertCachedRequest, writeProviderCache } from './geocode/cache.mjs';
import { chooseCandidate, normalizeText } from './geocode/scoring.mjs';
import { buildQueries } from './geocode/query.mjs';
import { BLIND_SEED, blindSelectionSummary, matcherFingerprint, selectBlind50 } from './geocode/blind-selection.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const CACHE_FILE = path.join(ROOT, 'data/geocode/provider-cache/amap.json');
const OVERRIDE_FILE = path.join(ROOT, 'data/geocode/reviewed-overrides.json');
const AUDIT_FILE = path.join(ROOT, 'data/audit/geocode-blind-50.json');
const LOCK_FILE = path.join(ROOT, 'data/audit/geocode-blind-50-matcher-lock.json');
const FORMAT_BASELINE_FILE = path.join(ROOT, 'data/audit/geocode-blind-50-before-format-compatibility.json');
const ADMIN_BASELINE_FILE = path.join(ROOT, 'data/audit/geocode-blind-50-before-admin-hierarchy.json');
const ADMIN_DIFF_FILE = path.join(ROOT, 'data/audit/geocode-blind-50-admin-diff.json');

const args = new Set(process.argv.slice(2));
if (args.has('--full')) throw new Error('--full remains disabled; this runner is permanently limited to the frozen blind-50 sample');
if (args.has('--apply')) throw new Error('--apply remains disabled; this runner never writes derived coordinates');
const selectionOnly = args.has('--selection-only');
const retryFailed = args.has('--retry-failed');
const cacheOnly = args.has('--cache-only');
const minIntervalMs = Math.max(500, Number(process.env.AMAP_MIN_INTERVAL_MS || 800));

const dataset = readJson(DERIVED_FILE);
const records = Array.isArray(dataset) ? dataset : dataset.records;
if (!Array.isArray(records) || records.length !== 901) throw new Error(`Expected 901 derived records, received ${records?.length ?? 'invalid'}`);
const selection = selectBlind50(records, BLIND_SEED);
const selectionAudit = blindSelectionSummary(selection);
const fingerprint = matcherFingerprint(ROOT);
const matcherLock = readJson(LOCK_FILE);
if (matcherLock.seed !== BLIND_SEED) throw new Error('Blind matcher lock seed differs from the selection seed');
if (matcherLock.matcherSha256 !== fingerprint.value) throw new Error('Matcher changed after blind sample freeze; refusing to query or rescore');
if (JSON.stringify(matcherLock.sourceRows) !== JSON.stringify(selectionAudit.sourceRows)) throw new Error('Blind sample changed after freeze; refusing to query');
const overrides = readJson(OVERRIDE_FILE);
const selectedRows = new Set(selection.map((item) => Number(item.record.sourceRow)));
const overlappingOverrides = (overrides.records ?? []).filter((item) => selectedRows.has(Number(item.sourceRow)));
if (overlappingOverrides.length) throw new Error(`Blind sample overlaps reviewed overrides: ${overlappingOverrides.map((item) => item.sourceRow).join(',')}`);
const formatBaselineAudit = readJson(FORMAT_BASELINE_FILE);
const priorAudit = fs.existsSync(ADMIN_BASELINE_FILE) ? readJson(ADMIN_BASELINE_FILE) : readJson(AUDIT_FILE);
if (!fs.existsSync(ADMIN_BASELINE_FILE) && priorAudit.records?.length === 50) writeJson(ADMIN_BASELINE_FILE, priorAudit);

if (selectionOnly) {
  writeJson(AUDIT_FILE, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'selection-frozen-no-requests',
    mode: 'blind-validation-50',
    matcherFrozen: fingerprint,
    selection: selectionAudit,
    summary: emptySummary(),
    requestPolicy: policy({ networkRequests: 0, cacheHits: 0, providerErrors: 0 }),
    records: selection.map(({ stratum, record }) => ({ sourceRow: record.sourceRow, sourceName: record.name, city: record.city, stratum }))
  });
  console.log(JSON.stringify({ ok: true, status: 'selection-frozen-no-requests', seed: BLIND_SEED, sourceRows: selectionAudit.sourceRows, audit: relative(AUDIT_FILE) }, null, 2));
  process.exit(0);
}

if (!cacheOnly) {
  const availability = amap.availability();
  if (!availability.available) throw new Error('AMAP_API_KEY is not available in this process environment; use --cache-only to rescore the frozen cache without network access');
}

const cache = loadProviderCache(CACHE_FILE, 'amap');
const startedAt = new Date().toISOString();
const publicRecords = [];
const formatConflictFindings = [];
let networkRequests = 0;
let cacheHits = 0;
let providerErrors = 0;
let lastRequestAt = 0;

for (let index = 0; index < selection.length; index += 1) {
  const { stratum, record } = selection[index];
  const queries = buildQueries(record);
  const candidateItems = [];
  const queryVariants = [];
  for (const query of queries) {
    let entry = findCachedRequest(cache, 'amap', query.query, record.city);
    let cacheStatus;
    if (entry && (entry.ok || !retryFailed)) {
      cacheHits += 1;
      cacheStatus = 'hit';
    } else if (cacheOnly) {
      throw new Error(`Cache-only rescore refused a network request for sourceRow=${record.sourceRow}, query=${query.query}`);
    } else {
      const waitMs = Math.max(0, minIntervalMs - (Date.now() - lastRequestAt));
      if (waitMs) await sleep(waitMs);
      const response = await amap.searchPlace({ query: query.query, city: record.city, offset: 25, page: 1, extensions: 'all' });
      lastRequestAt = Date.now();
      networkRequests += 1;
      if (!response.ok) providerErrors += 1;
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
  const result = chooseCandidate(record, deduped.map((item) => item.candidate));
  const selected = result.selected ? compactCandidate(result.selected) : null;
  const topCandidate = result.ranked[0] ? compactCandidate(result.ranked[0]) : null;
  const rejected = result.ranked.filter((candidate) => candidate.hardRejects.length > 0);
  const formatConflicts = result.ranked
    .filter((candidate) => candidate.formatCompatibility?.conflicts?.length)
    .map((candidate) => ({
      poiId: candidate.poiId,
      name: candidate.name,
      locationGranularity: candidate.locationGranularity,
      conflicts: candidate.formatCompatibility.conflicts,
      hardRejected: candidate.hardRejects.includes('auditorium-format-conflict')
    }));
  if (formatConflicts.length) formatConflictFindings.push({ sourceRow: record.sourceRow, sourceName: record.name, conflicts: formatConflicts });
  publicRecords.push({
    sourceRow: record.sourceRow,
    sourceName: record.name,
    city: record.city,
    stratum,
    queryVariants,
    selected,
    topCandidate: selected ? null : topCandidate,
    hardRejectSummary: {
      candidateCount: result.ranked.length,
      rejectedCandidateCount: rejected.length,
      reasons: countReasons(rejected.flatMap((candidate) => candidate.hardRejects))
    },
    formatConflictSummary: {
      count: formatConflicts.length,
      candidates: formatConflicts
    },
    ambiguity: result.ambiguity,
    overrideUsed: false
  });
  const partialSummary = summarize(publicRecords);
  writeAudit('running', partialSummary);
  console.error(`[blind-50 ${index + 1}/50] sourceRow=${record.sourceRow} decision=${automaticDecision(selected)} network=${networkRequests} cacheHits=${cacheHits}`);
}

const finalSummary = summarize(publicRecords);
writeAudit('awaiting-independent-human-validation', finalSummary);
const adminDiff = writeAdminDiff(finalSummary);
console.log(JSON.stringify({
  ok: true,
  status: 'awaiting-independent-human-validation',
  seed: BLIND_SEED,
  matcherSha256: fingerprint.value,
  automaticHigh: finalSummary.automaticHigh,
  automaticMedium: finalSummary.automaticMedium,
  reviewedOverrideHigh: 0,
  reviewedOverrideMedium: 0,
  unresolved: finalSummary.unresolved,
  coverage: finalSummary.coverage,
  automaticHighRate: finalSummary.automaticHighRate,
  precision: null,
  networkRequests,
  cacheHits,
  providerErrors,
  formatConflictCandidateCount: adminDiff.formatAudit.candidateConflictCount,
  priorHighFormatConflictCount: adminDiff.formatAudit.priorHighFormatConflictCount,
  currentHighFormatConflictCount: adminDiff.formatAudit.currentHighFormatConflictCount,
  decisionChanges: adminDiff.decisionChanges,
  coordinatesWritten: 0,
  audit: relative(AUDIT_FILE),
  diff: relative(ADMIN_DIFF_FILE)
}, null, 2));

function writeAudit(status, summary) {
  writeJson(AUDIT_FILE, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    status,
    mode: 'blind-validation-50',
    matcherFrozen: fingerprint,
    selection: selectionAudit,
    summary,
    requestPolicy: policy({ networkRequests, cacheHits, providerErrors }),
    coordinatePolicy: {
      provider: 'AMap',
      providerCrs: 'GCJ-02',
      mapCrs: 'WGS84',
      providerCoordinatesPreserved: true,
      cityCenterFallbackAllowed: false,
      coordinatesAppliedToDerived: 0
    },
    precision: { value: null, status: 'not-calculated-before-independent-human-validation' },
    formatCompatibilityAudit: buildFormatAudit(),
    records: publicRecords
  });
}

function policy(counts) {
  return {
    maximumRecords: 50,
    fullRunEnabled: false,
    applyEnabled: false,
    keySource: cacheOnly ? 'not-used-cache-only' : 'process.env.AMAP_API_KEY',
    keyPersisted: false,
    keyPrinted: false,
    providerCache: 'local-private-gitignored',
    minimumIntervalMs: minIntervalMs,
    retryFailed,
    cacheOnly,
    ...counts
  };
}

function emptySummary() {
  return { evaluated: 0, automaticHigh: 0, automaticMedium: 0, reviewedOverrideHigh: 0, reviewedOverrideMedium: 0, unresolved: 50, coverage: 0, automaticHighRate: 0 };
}

function summarize(rows) {
  const automaticHigh = rows.filter((row) => row.selected?.automaticDecision === 'accepted-high').length;
  const automaticMedium = rows.filter((row) => ['review-required-medium', 'review-required-ambiguous'].includes(row.selected?.automaticDecision)).length;
  const unresolved = 50 - automaticHigh - automaticMedium;
  return {
    evaluated: rows.length,
    automaticHigh,
    automaticMedium,
    reviewedOverrideHigh: 0,
    reviewedOverrideMedium: 0,
    unresolved,
    coverage: Number(((automaticHigh + automaticMedium) / 50).toFixed(4)),
    automaticHighRate: Number((automaticHigh / 50).toFixed(4))
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
    automaticDecision: candidate.decision,
    locationConfidence: candidate.locationConfidence,
    identityConfidence: candidate.identityConfidence,
    adminMatch: candidate.adminMatch,
    formatCompatibility: {
      compatible: candidate.formatCompatibility.compatible,
      exactFormatMatch: candidate.formatCompatibility.exactFormatMatch,
      conflicts: candidate.formatCompatibility.conflicts,
      source: candidate.formatCompatibility.source,
      candidate: candidate.formatCompatibility.candidate
    },
    provider: {
      providerCrs: candidate.providerCrs,
      providerLat: candidate.providerLat,
      providerLng: candidate.providerLng
    },
    map: {
      mapCrs: candidate.mapCrs,
      lat: candidate.lat,
      lng: candidate.lng
    }
  };
}

function buildFormatAudit() {
  const candidateConflicts = formatConflictFindings.flatMap((record) => record.conflicts.map((candidate) => ({ sourceRow: record.sourceRow, sourceName: record.sourceName, ...candidate })));
  const priorHighRows = new Set((formatBaselineAudit.records ?? [])
    .filter((record) => record.selected?.automaticDecision === 'accepted-high')
    .map((record) => Number(record.sourceRow)));
  const priorByRow = new Map((formatBaselineAudit.records ?? []).map((record) => [Number(record.sourceRow), record]));
  const priorHighConflicts = candidateConflicts.filter((candidate) => {
    const prior = priorByRow.get(Number(candidate.sourceRow));
    return priorHighRows.has(Number(candidate.sourceRow)) && prior?.selected?.poiId === candidate.poiId;
  });
  const currentHighConflicts = publicRecords
    .filter((record) => record.selected?.automaticDecision === 'accepted-high' && record.selected?.formatCompatibility?.compatible === false)
    .map((record) => ({ sourceRow: record.sourceRow, poiId: record.selected.poiId, name: record.selected.name, conflicts: record.selected.formatCompatibility.conflicts }));
  return {
    candidateConflictCount: candidateConflicts.length,
    affectedSourceRows: [...new Set(candidateConflicts.map((item) => item.sourceRow))],
    conflicts: candidateConflicts,
    priorHighFormatConflictCount: priorHighConflicts.length,
    priorHighFormatConflicts: priorHighConflicts,
    currentHighFormatConflictCount: currentHighConflicts.length,
    currentHighFormatConflicts: currentHighConflicts
  };
}

function writeAdminDiff(afterSummary) {
  const priorByRow = new Map((priorAudit.records ?? []).map((record) => [Number(record.sourceRow), record]));
  const decisionChanges = publicRecords.map((record) => {
    const before = priorByRow.get(Number(record.sourceRow));
    const beforeDecision = before?.selected?.automaticDecision ?? 'unresolved';
    const afterDecision = record.selected?.automaticDecision ?? 'unresolved';
    const beforePoiId = before?.selected?.poiId ?? null;
    const afterPoiId = record.selected?.poiId ?? null;
    if (beforeDecision === afterDecision && beforePoiId === afterPoiId) return null;
    return {
      sourceRow: record.sourceRow,
      sourceName: record.sourceName,
      before: {
        decision: beforeDecision,
        poiId: beforePoiId,
        name: before?.selected?.name ?? null,
        positionType: before?.selected?.positionType ?? null
      },
      after: {
        decision: afterDecision,
        poiId: afterPoiId,
        name: record.selected?.name ?? null,
        positionType: record.selected?.positionType ?? null,
        locationGranularity: record.selected?.locationGranularity ?? null,
        locationConfidence: record.selected?.locationConfidence ?? 'unknown',
        identityConfidence: record.selected?.identityConfidence ?? 'unknown'
      }
    };
  }).filter(Boolean);
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'blind-50-existing-cache-only-admin-hierarchy-rescore',
    networkRequests: 0,
    matcher: fingerprint,
    before: priorAudit.summary,
    after: afterSummary,
    focusRows: Object.fromEntries([577, 555].map((sourceRow) => {
      const current = publicRecords.find((record) => record.sourceRow === sourceRow);
      return [sourceRow, {
        before: priorByRow.get(sourceRow)?.selected ?? null,
        after: current?.selected ?? null,
        afterTopCandidate: current?.topCandidate ?? null,
        hardRejectSummary: current?.hardRejectSummary ?? null
      }];
    })),
    decisionChanges,
    formatAudit: buildFormatAudit()
  };
  writeJson(ADMIN_DIFF_FILE, output);
  return output;
}

function automaticDecision(selected) {
  return selected?.automaticDecision ?? 'unresolved';
}

function sameCandidate(left, right) {
  if (left?.id && right?.id) return left.id === right.id;
  return normalizeText(left?.name) === normalizeText(right?.name) && String(left?.location ?? '') === String(right?.location ?? '');
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

function countReasons(reasons) {
  const counts = {};
  for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
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
