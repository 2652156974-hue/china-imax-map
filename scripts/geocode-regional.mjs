import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { availability, searchPlace } from './geocode/providers/nominatim.mjs';
import { loadProviderCache, findCachedRequest, upsertCachedRequest, writeProviderCache } from './geocode/cache.mjs';
import { chooseRegionalCandidate, compactRegionalAuditResult } from './geocode/regional-matcher.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const CACHE_FILE = path.join(ROOT, 'data/geocode/provider-cache/nominatim.json');
const AUDIT_FILE = path.join(ROOT, 'data/audit/geocode-hkmo-tw.json');
const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback) => {
  const prefix = name + '=';
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

if (valueArg('--scope', '') !== 'regional') {
  throw new Error('Regional audit requires --scope=regional');
}
if (valueArg('--provider', '') !== 'nominatim') {
  throw new Error('Regional audit requires --provider=nominatim');
}
if (args.has('--full') || args.has('--apply')) {
  throw new Error('Regional audit never writes coordinates to data/derived and has no --full/--apply mode');
}

const networkEnabled = args.has('--network');
const maxNewRequests = Math.min(20, Math.max(0, Number(valueArg('--max-new', '20')) || 20));
const dataset = readJson(DERIVED_FILE);
const allRecords = Array.isArray(dataset) ? dataset : dataset.records;
const regionalRecords = allRecords.filter((record) => ['香港', '澳门', '台湾'].includes(record.region));
if (regionalRecords.length !== 20) throw new Error('Expected exactly 20 Hong Kong/Macau/Taiwan records');
const providerInfo = availability({ scope: 'regional' });
const cache = loadProviderCache(CACHE_FILE, 'nominatim');
const generatedAt = new Date().toISOString();
const audited = [];
let newRequests = 0;
let cacheHits = 0;
let errors = 0;
let lastRequestAt = 0;

for (let index = 0; index < regionalRecords.length; index += 1) {
  const record = regionalRecords[index];
  const query = buildQuery(record);
  const cached = findCachedRequest(cache, 'nominatim', query, record.city);
  let response;
  let cacheState;
  if (cached) {
    cacheHits += 1;
    cacheState = 'hit';
    response = cached;
  } else if (networkEnabled && newRequests < maxNewRequests) {
    const elapsed = Date.now() - lastRequestAt;
    if (lastRequestAt && elapsed < 1100) await sleep(1100 - elapsed);
    newRequests += 1;
    response = await searchPlace({ query, city: record.city });
    lastRequestAt = Date.now();
    cacheState = 'miss-requested';
    upsertCachedRequest(cache, {
      provider: 'nominatim',
      query,
      city: record.city,
      sourceRows: [record.sourceRow],
      requestedAt: new Date().toISOString(),
      ok: Boolean(response.ok),
      statusCode: response.statusCode ?? null,
      errorCode: response.errorCode ?? null,
      errorMessage: response.errorMessage ?? null,
      providerCrs: 'WGS84',
      rawCandidates: response.rawCandidates ?? []
    });
    writeProviderCache(CACHE_FILE, cache);
  } else {
    cacheState = networkEnabled ? 'budget-exhausted' : 'cache-miss-network-disabled';
    response = { ok: false, rawCandidates: [], errorCode: cacheState };
  }
  if (!response.ok) errors += 1;
  const result = chooseRegionalCandidate(record, response.rawCandidates ?? []);
  const compact = compactRegionalAuditResult(result);
  audited.push({
    sourceRow: record.sourceRow,
    sourceName: record.name,
    region: record.region,
    province: record.province,
    city: record.city,
    status: record.status,
    projection: {
      raw: record.projection?.raw ?? '',
      system: record.projection?.system ?? null,
      dome: record.projection?.dome ?? null,
      audioChannels: record.projection?.audioChannels ?? null
    },
    queryVariants: [{
      kind: 'current-name-city',
      query,
      cache: cacheState,
      ok: Boolean(response.ok),
      candidateCount: (response.rawCandidates ?? []).length,
      errorCode: response.errorCode ?? null
    }],
    decision: result.decision,
    automaticDecision: result.decision,
    overrideUsed: false,
    ...compact,
    provenance: {
      provider: 'Nominatim',
      geocodeSource: 'nominatim:search',
      providerCrs: 'WGS84',
      mapCrs: 'WGS84',
      attribution: '© OpenStreetMap contributors',
      license: 'ODbL',
      retrievedAt: cached?.requestedAt ?? generatedAt
    }
  });
}

writeProviderCache(CACHE_FILE, cache);
const summary = summarize(audited);
const audit = {
  schemaVersion: 1,
  generatedAt,
  status: 'completed-regional-audit',
  scope: 'hong-kong-macau-taiwan',
  provider: providerInfo,
  requestPolicy: {
    cacheFirst: true,
    networkEnabled,
    networkRequests: newRequests,
    cacheHits,
    errors,
    maxNewRequests,
    consumesMainlandAmapBudget: false,
    amapRequests: 0,
    coordinatesAppliedToDerived: 0
  },
  coordinatePolicy: {
    providerCrs: 'WGS84',
    mapCrs: 'WGS84',
    conversion: 'none; Nominatim coordinates are already WGS84',
    cityCenterFallback: false
  },
  attribution: {
    provider: '© OpenStreetMap contributors',
    license: 'ODbL',
    sourceDataset: '@ArvinTingcn authorized source remains separately attributed'
  },
  summary,
  records: audited
};
writeJson(AUDIT_FILE, audit);
console.log(JSON.stringify({
  ok: true,
  audit: relative(AUDIT_FILE),
  total: audited.length,
  newRequests,
  cacheHits,
  errors,
  summary
}, null, 2));

function buildQuery(record) {
  return String(record.name ?? '').split(/\r?\n/)[0].replace(/\s+/g, ' ').trim() + ' ' + record.city;
}

function summarize(records) {
  const byRegion = {};
  const byDecision = {};
  const byProvider = { nominatim: records.length };
  for (const record of records) {
    byRegion[record.region] ??= { total: 0, exact: 0, locationOnly: 0, unresolved: 0 };
    byRegion[record.region].total += 1;
    byDecision[record.decision] = (byDecision[record.decision] ?? 0) + 1;
    if (record.decision === 'accepted-high') byRegion[record.region].exact += 1;
    else if (record.selected) byRegion[record.region].locationOnly += 1;
    else byRegion[record.region].unresolved += 1;
  }
  return {
    total: records.length,
    exact: byDecision['accepted-high'] ?? 0,
    locationOnly: byDecision['review-required-medium'] ?? 0,
    unresolved: byDecision.unresolved ?? 0,
    byDecision,
    byRegion,
    byProvider
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
