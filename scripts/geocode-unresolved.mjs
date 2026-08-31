import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cacheKey,
  findCachedRequest,
  loadProviderCache,
  upsertCachedRequest,
  writeProviderCache
} from './geocode/cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECONCILIATION_FILE = path.join(ROOT, 'data/audit/unresolved-reconciliation.json');
const CACHE_FILE = path.join(ROOT, 'data/geocode/provider-cache/amap.json');
const ENDPOINT = 'https://restapi.amap.com/v3/place/text';
const FORBIDDEN_REASONS = new Set([
  'closed-or-removed-poi',
  'wrong-city',
  'auditorium-identity-ambiguous',
  'provider-no-result'
]);

const args = new Set(process.argv.slice(2));
if (args.has('--full') || args.has('--apply')) {
  throw new Error('This runner is unresolved-only and never supports --full or --apply.');
}
const cacheOnly = args.has('--cache-only');
const planOnly = args.has('--plan-only');
const minIntervalMs = Math.max(500, Number(process.env.AMAP_UNRESOLVED_MIN_INTERVAL_MS || 800));
const configuredBudget = Number(process.env.AMAP_UNRESOLVED_MAX_NEW_REQUESTS || 600);
const maxNewRequests = Number.isFinite(configuredBudget) && configuredBudget >= 0
  ? Math.min(600, Math.floor(configuredBudget))
  : 600;

const reconciliation = readJson(RECONCILIATION_FILE);
const records = reconciliation.records ?? [];
if (reconciliation.scope?.total !== 901 || records.length !== 242) {
  throw new Error('Unresolved runner requires the current 901-record / 242-record reconciliation.');
}
if (records.some((record) => record.reviewState !== 'unresolved')) {
  throw new Error('Unresolved runner received a record outside reviewState=unresolved.');
}

const eligibleRecords = records.filter((record) => record.queryWorthiness === 'worth-query');
const policyViolations = eligibleRecords.filter((record) => FORBIDDEN_REASONS.has(record.unresolvedReason));
if (policyViolations.length) {
  throw new Error(`Query policy violation: ${policyViolations.length} forbidden unresolved records are marked worth-query.`);
}

const cache = loadProviderCache(CACHE_FILE, 'amap');
const tasksByKey = new Map();
let cacheHits = 0;
let cacheSourceRowsAttached = 0;
for (const record of eligibleRecords) {
  for (const variant of record.queryVariants ?? []) {
    const query = String(variant.query ?? '').trim();
    const city = String(record.city ?? '').trim();
    if (!query || !city) continue;
    const cached = findCachedRequest(cache, 'amap', query, city);
    if (cached) {
      cacheHits += 1;
      const sourceRows = new Set((cached.sourceRows ?? []).map(Number));
      if (!sourceRows.has(Number(record.sourceRow))) {
        cached.sourceRows = [...sourceRows, Number(record.sourceRow)].sort((a, b) => a - b);
        upsertCachedRequest(cache, cached);
        cacheSourceRowsAttached += 1;
      }
      continue;
    }
    const key = cacheKey('amap', query, city);
    const task = tasksByKey.get(key) ?? { query, city, sourceRows: [], kinds: [] };
    if (!task.sourceRows.includes(Number(record.sourceRow))) task.sourceRows.push(Number(record.sourceRow));
    if (!task.kinds.includes(variant.kind)) task.kinds.push(variant.kind);
    tasksByKey.set(key, task);
  }
}

const tasks = [...tasksByKey.values()].sort((a, b) => `${a.city}|${a.query}`.localeCompare(`${b.city}|${b.query}`));
if (planOnly) {
  console.log(JSON.stringify(summary({ eligibleRecords, tasks, cacheHits, cacheSourceRowsAttached, networkRequests: 0, providerErrors: 0, status: 'plan-only' }), null, 2));
  process.exit(0);
}
if (cacheOnly) {
  if (cacheSourceRowsAttached) writeProviderCache(CACHE_FILE, cache);
  console.log(JSON.stringify(summary({ eligibleRecords, tasks, cacheHits, cacheSourceRowsAttached, networkRequests: 0, providerErrors: 0, status: 'cache-only' }), null, 2));
  process.exit(0);
}
if (!tasks.length) {
  if (cacheSourceRowsAttached) writeProviderCache(CACHE_FILE, cache);
  console.log(JSON.stringify(summary({ eligibleRecords, tasks, cacheHits, cacheSourceRowsAttached, networkRequests: 0, providerErrors: 0, status: 'no-new-query-needed' }), null, 2));
  process.exit(0);
}

const webServiceKey = String(process.env.AMAP_WEB_SERVICE_KEY ?? '').trim();
if (!webServiceKey) {
  console.log(JSON.stringify(summary({
    eligibleRecords,
    tasks,
    cacheHits,
    cacheSourceRowsAttached,
    networkRequests: 0,
    providerErrors: 0,
    status: 'blocked-missing-AMAP_WEB_SERVICE_KEY',
    keyEnvironmentVariable: 'AMAP_WEB_SERVICE_KEY'
  }), null, 2));
  process.exitCode = 2;
  process.exit();
}

if (tasks.length > maxNewRequests) {
  throw new Error(`Refusing ${tasks.length} new AMap requests; AMAP_UNRESOLVED_MAX_NEW_REQUESTS=${maxNewRequests}.`);
}

let networkRequests = 0;
let providerErrors = 0;
let consecutiveErrors = 0;
let lastRequestAt = 0;
for (const task of tasks) {
  const waitMs = Math.max(0, minIntervalMs - (Date.now() - lastRequestAt));
  if (waitMs) await sleep(waitMs);
  const response = await searchPlace({ query: task.query, city: task.city, key: webServiceKey });
  lastRequestAt = Date.now();
  networkRequests += 1;
  if (!response.ok) {
    providerErrors += 1;
    consecutiveErrors += 1;
  } else {
    consecutiveErrors = 0;
  }
  upsertCachedRequest(cache, {
    cacheKey: cacheKey('amap', task.query, task.city),
    provider: 'amap',
    query: task.query,
    city: task.city,
    requestTimestamp: response.fetchedAt ?? new Date().toISOString(),
    sourceRows: task.sourceRows,
    ok: Boolean(response.ok),
    rawCandidates: response.candidates ?? [],
    rawMeta: response.rawMeta ?? null,
    error: response.ok ? null : { code: response.errorCode, message: response.errorMessage }
  });
  writeProviderCache(CACHE_FILE, cache);
  if (consecutiveErrors >= 3) {
    throw new Error('Stopped after three consecutive AMap provider errors; cached partial results were preserved.');
  }
}

console.log(JSON.stringify(summary({
  eligibleRecords,
  tasks,
  cacheHits,
  cacheSourceRowsAttached,
  networkRequests,
  providerErrors,
  status: 'complete'
}), null, 2));

async function searchPlace({ query, city, key }) {
  const params = new URLSearchParams({
    key,
    keywords: query,
    city,
    citylimit: 'true',
    offset: '25',
    page: '1',
    extensions: 'all',
    output: 'JSON'
  });
  try {
    const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json' }
    });
    const body = await response.json();
    if (!response.ok) {
      return { ok: false, errorCode: `http-${response.status}`, errorMessage: `AMap HTTP status ${response.status}` };
    }
    if (String(body?.status) !== '1') {
      return {
        ok: false,
        errorCode: 'api-error',
        errorMessage: typeof body?.info === 'string' ? body.info : 'AMap returned a non-success status',
        rawMeta: { status: body?.status ?? null, info: body?.info ?? null, infocode: body?.infocode ?? null }
      };
    }
    return {
      ok: true,
      fetchedAt: new Date().toISOString(),
      candidates: Array.isArray(body?.pois) ? body.pois : [],
      rawMeta: { status: body?.status ?? null, info: body?.info ?? null, count: body?.count ?? null, infocode: body?.infocode ?? null }
    };
  } catch (error) {
    return { ok: false, errorCode: 'network-error', errorMessage: error instanceof Error ? error.message : String(error) };
  }
}

function summary({ eligibleRecords, tasks, cacheHits, cacheSourceRowsAttached, networkRequests, providerErrors, status, keyEnvironmentVariable = null }) {
  return {
    ok: status === 'complete' || status === 'cache-only' || status === 'plan-only' || status === 'no-new-query-needed',
    status,
    scope: { total: 901, unresolved: 242, eligibleRecords: eligibleRecords.length },
    cache: { hits: cacheHits, sourceRowsAttached: cacheSourceRowsAttached, missingUniqueQueries: tasks.length },
    network: { requests: networkRequests, providerErrors, maxNewRequests },
    ...(keyEnvironmentVariable ? { keyEnvironmentVariable } : {})
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
