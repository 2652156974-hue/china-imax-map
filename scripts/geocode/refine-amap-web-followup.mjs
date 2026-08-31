import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  AMAP_CACHE_FILE,
  CANONICAL_FILE,
  ROOT,
  loadScopedUnresolved,
  readJson,
  relative,
  writeJson
} from './amap-human-utils.mjs';
import { cacheKey, findCachedRequest, loadProviderCache, upsertCachedRequest, writeProviderCache } from './cache.mjs';

const ENDPOINT = 'https://restapi.amap.com/v3/place/text';
const QUERY_FILE = path.join(ROOT, 'data/audit/amap-web-followup-queries.json');
const args = new Set(process.argv.slice(2));

export async function run() {
  if (args.has('--full') || args.has('--apply')) throw new Error('AMap web follow-up is unresolved-only and never supports --full or --apply.');
  const { unresolved, located } = loadScopedUnresolved();
  const allowedRows = new Set(unresolved.map((record) => Number(record.sourceRow)));
  const plan = readJson(QUERY_FILE);
  const tasks = (plan.queries ?? []).map((task) => ({ ...task, sourceRows: [Number(task.sourceRow)] }))
    .filter((task) => allowedRows.has(task.sourceRow));
  if (tasks.length !== (plan.queries ?? []).length) throw new Error('Follow-up query manifest contains a non-unresolved sourceRow.');
  const cache = loadProviderCache(AMAP_CACHE_FILE, 'amap');
  const missing = tasks.filter((task) => !findCachedRequest(cache, 'amap', task.query, task.city));
  const planOutput = { scope: { total: 901, startingLocated: 672, startingUnresolved: 229, currentLocated: located.length, currentUnresolved: unresolved.length, pendingReview: 0 }, records: unresolved.length, tasks: tasks.length, cacheHits: tasks.length - missing.length, newNetworkTasks: missing.length, cache: relative(AMAP_CACHE_FILE) };
  if (args.has('--plan-only')) {
    console.log(JSON.stringify({ ok: true, stage: 'amap-web-followup-plan-only', ...planOutput }, null, 2));
    return;
  }
  if (args.has('--cache-only')) {
    console.log(JSON.stringify({ ok: true, stage: 'amap-web-followup-cache-only', ...planOutput, networkRequests: 0, providerErrors: 0 }, null, 2));
    return;
  }
  const key = String(process.env.AMAP_WEB_SERVICE_KEY ?? '').trim();
  if (!key) {
    console.error('BLOCKED: AMAP_WEB_SERVICE_KEY missing');
    process.exitCode = 2;
    return;
  }
  const maxNew = Math.min(20, Math.max(0, Math.floor(Number(process.env.AMAP_WEB_FOLLOWUP_MAX_NEW_REQUESTS || 20))));
  if (missing.length > maxNew) throw new Error(`Refusing ${missing.length} follow-up requests; AMAP_WEB_FOLLOWUP_MAX_NEW_REQUESTS=${maxNew}.`);
  const interval = Math.max(300, Number(process.env.AMAP_WEB_FOLLOWUP_MIN_INTERVAL_MS || 700));
  let last = 0;
  let networkRequests = 0;
  let providerErrors = 0;
  for (const task of missing) {
    const wait = Math.max(0, interval - (Date.now() - last));
    if (wait) await sleep(wait);
    const result = await search(task, key);
    last = Date.now();
    networkRequests += 1;
    if (!result.ok) providerErrors += 1;
    upsertCachedRequest(cache, {
      provider: 'amap',
      requestType: 'search',
      scope: 'unresolved-amap-web-followup',
      query: task.query,
      city: task.city,
      sourceRows: task.sourceRows,
      requestTimestamp: result.fetchedAt ?? new Date().toISOString(),
      ok: Boolean(result.ok),
      rawCandidates: result.candidates ?? [],
      rawMeta: result.rawMeta ?? null,
      error: result.ok ? null : { code: result.errorCode, message: result.errorMessage }
    });
    writeProviderCache(AMAP_CACHE_FILE, cache);
  }
  console.log(JSON.stringify({ ok: providerErrors === 0, stage: 'amap-web-followup-complete', ...planOutput, networkRequests, providerErrors }, null, 2));
}

async function search(task, key) {
  const params = new URLSearchParams({ key, keywords: task.query, city: task.city, citylimit: 'true', offset: '25', page: '1', extensions: 'all', output: 'JSON' });
  try {
    const response = await fetch(`${ENDPOINT}?${params.toString()}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const body = await response.json();
    if (!response.ok || String(body?.status) !== '1') return { ok: false, errorCode: `status-${body?.infocode ?? response.status}`, errorMessage: 'AMap follow-up returned a non-success status', candidates: [], rawMeta: { status: body?.status ?? null, info: body?.info ?? null, infocode: body?.infocode ?? null } };
    return { ok: true, fetchedAt: new Date().toISOString(), candidates: Array.isArray(body?.pois) ? body.pois : [], rawMeta: { status: body.status, info: body.info ?? null, count: body.count ?? null, infocode: body.infocode ?? null } };
  } catch {
    return { ok: false, errorCode: 'network-error', errorMessage: 'AMap follow-up request failed', candidates: [] };
  }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await run();
