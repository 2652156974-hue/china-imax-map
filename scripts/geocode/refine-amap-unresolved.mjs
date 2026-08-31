import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  AMAP_CACHE_FILE,
  buildRefinedAmapQueries,
  clean,
  loadScopedUnresolved,
  readJson,
  relative,
  writeJson
} from './amap-human-utils.mjs';
import { cacheKey, findCachedRequest, loadProviderCache, upsertCachedRequest, writeProviderCache } from './cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENDPOINT = 'https://restapi.amap.com/v3/place/text';
const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback = null) => {
  const prefix = `${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

export async function run() {
  if (args.has('--full') || args.has('--apply')) throw new Error('AMap refinement is unresolved-only and never supports --full or --apply.');
  const { unresolved, located } = loadScopedUnresolved();
  const cache = loadProviderCache(AMAP_CACHE_FILE, 'amap');
  const taskMap = new Map();
  for (const record of unresolved) {
    for (const variant of buildRefinedAmapQueries(record)) {
      const key = cacheKey('amap', variant.query, variant.city);
      const task = taskMap.get(key) ?? { ...variant, sourceRows: [], kinds: [] };
      if (!task.sourceRows.includes(Number(record.sourceRow))) task.sourceRows.push(Number(record.sourceRow));
      if (!task.kinds.includes(variant.kind)) task.kinds.push(variant.kind);
      taskMap.set(key, task);
    }
  }
  const tasks = [...taskMap.values()].sort((a, b) => `${a.city}|${a.query}`.localeCompare(`${b.city}|${b.query}`, 'zh-CN'));
  const missing = [];
  let cacheHits = 0;
  let sourceRowsAttached = 0;
  for (const task of tasks) {
    const cached = findCachedRequest(cache, 'amap', task.query, task.city);
    if (cached) {
      cacheHits += 1;
      const sourceRows = new Set((cached.sourceRows ?? []).map(Number));
      const before = sourceRows.size;
      for (const sourceRow of task.sourceRows) sourceRows.add(Number(sourceRow));
      if (sourceRows.size !== before) {
        cached.sourceRows = [...sourceRows].sort((a, b) => a - b);
        upsertCachedRequest(cache, cached);
        sourceRowsAttached += sourceRows.size - before;
      }
    } else missing.push(task);
  }
  const plan = {
    scope: { total: 901, startingLocated: 672, startingUnresolved: 229, currentLocated: located.length, currentUnresolved: unresolved.length, pendingReview: 0 },
    records: unresolved.length,
    refinedQueryTasks: tasks.length,
    cacheHits,
    newNetworkTasks: missing.length,
    sourceRowsAttached,
    cache: relative(AMAP_CACHE_FILE)
  };
  if (args.has('--plan-only')) {
    console.log(JSON.stringify({ ok: true, stage: 'amap-refinement-plan-only', ...plan }, null, 2));
    return;
  }
  if (args.has('--cache-only')) {
    if (sourceRowsAttached) writeProviderCache(AMAP_CACHE_FILE, cache);
    console.log(JSON.stringify({ ok: true, stage: 'amap-refinement-cache-only', ...plan, networkRequests: 0, providerErrors: 0 }, null, 2));
    return;
  }
  const key = String(process.env.AMAP_WEB_SERVICE_KEY ?? '').trim();
  if (!key) {
    console.error('BLOCKED: AMAP_WEB_SERVICE_KEY missing');
    process.exitCode = 2;
    return;
  }
  const budget = Math.min(600, Math.max(0, Math.floor(Number(process.env.AMAP_REFINEMENT_MAX_NEW_REQUESTS || 600))));
  if (missing.length > budget) throw new Error(`Refusing ${missing.length} new scoped AMap requests; AMAP_REFINEMENT_MAX_NEW_REQUESTS=${budget}.`);
  const minIntervalMs = Math.max(300, Number(process.env.AMAP_REFINEMENT_MIN_INTERVAL_MS || 700));
  let lastRequestAt = 0;
  let networkRequests = 0;
  let providerErrors = 0;
  let consecutiveErrors = 0;
  for (const task of missing) {
    const waitMs = Math.max(0, minIntervalMs - (Date.now() - lastRequestAt));
    if (waitMs) await sleep(waitMs);
    const response = await searchPlace(task, key);
    lastRequestAt = Date.now();
    networkRequests += 1;
    if (!response.ok) {
      providerErrors += 1;
      consecutiveErrors += 1;
    } else consecutiveErrors = 0;
    upsertCachedRequest(cache, {
      provider: 'amap',
      requestType: 'search',
      scope: 'unresolved-amap-refinement',
      query: task.query,
      city: task.city,
      district: task.district ?? null,
      sourceRows: task.sourceRows,
      kinds: task.kinds,
      requestTimestamp: response.fetchedAt ?? new Date().toISOString(),
      ok: Boolean(response.ok),
      rawCandidates: response.candidates ?? [],
      rawMeta: response.rawMeta ?? null,
      error: response.ok ? null : { code: response.errorCode, message: response.errorMessage }
    });
    writeProviderCache(AMAP_CACHE_FILE, cache);
    if (consecutiveErrors >= 3) throw new Error('Stopped after three consecutive AMap refinement errors; partial private cache preserved.');
  }
  console.log(JSON.stringify({ ok: providerErrors === 0, stage: 'amap-refinement-complete', ...plan, networkRequests, providerErrors, cache: relative(AMAP_CACHE_FILE) }, null, 2));
}

async function searchPlace(task, key) {
  const params = new URLSearchParams({ key, keywords: task.query, city: task.city, citylimit: 'true', offset: '25', page: '1', extensions: 'all', output: 'JSON' });
  if (task.types) params.set('types', task.types);
  try {
    const response = await fetch(`${ENDPOINT}?${params.toString()}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const body = await response.json();
    if (!response.ok || String(body?.status) !== '1') return { ok: false, errorCode: `status-${body?.infocode ?? response.status}`, errorMessage: 'AMap refinement returned a non-success status', rawMeta: { status: body?.status ?? null, info: body?.info ?? null, infocode: body?.infocode ?? null }, candidates: [] };
    return { ok: true, fetchedAt: new Date().toISOString(), candidates: Array.isArray(body?.pois) ? body.pois : [], rawMeta: { status: body.status, info: body.info ?? null, count: body.count ?? null, infocode: body.infocode ?? null } };
  } catch {
    return { ok: false, errorCode: 'network-error', errorMessage: 'AMap refinement request failed', candidates: [] };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await run();
