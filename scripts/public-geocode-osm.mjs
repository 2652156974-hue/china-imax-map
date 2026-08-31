import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const CACHE_DIR = path.join(ROOT, 'data/geocode/provider-cache');
const REVIEWED_FILE = path.join(ROOT, 'data/reviewed/public-geocodes.json');
const QUALITY_FILE = path.join(ROOT, 'data/audit/public-geocode-quality.json');
const UNRESOLVED_FILE = path.join(ROOT, 'data/audit/public-geocode-unresolved.json');
const NETWORK = process.argv.includes('--network');
const PRIORITY_ONLY = process.argv.includes('--priority-only');
const USER_AGENT = 'china-imax-map-public-geocode/0.1 (local audit; contact via repository)';

const BBOXES = [
  { slug: 'mainland-east-north', bbox: [35, 105, 54, 135] },
  { slug: 'mainland-east-south', bbox: [18, 105, 35, 135] },
  { slug: 'mainland-west-north', bbox: [35, 73, 54, 105] },
  { slug: 'mainland-west-south', bbox: [18, 73, 35, 105] },
  { slug: 'hong-kong-macau', bbox: [22, 113, 23, 115] },
  { slug: 'taiwan', bbox: [21.5, 119.5, 25.5, 122.2] },
];
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const derived = readJson(DERIVED_FILE);
if (!Array.isArray(derived.records) || derived.records.length !== 901) throw new Error('Public OSM pipeline expects 901 derived records.');

const fetchSummary = [];
const providerElements = [];
for (const bbox of BBOXES) {
  const result = await loadBbox(bbox);
  fetchSummary.push(result.summary);
  providerElements.push(...result.elements);
}

const candidates = dedupeCandidates(providerElements);
const candidateIndex = new Map(candidates.map((candidate) => [candidate.providerId, candidate]));
const priorityNominatim = await loadPriorityNominatim(derived.records);
const decisions = [];
const usedProviderIds = new Map();

for (const record of derived.records.map(prepareTarget)) {
  const matches = candidates
    .map((candidate) => scoreCandidate(record, candidate))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.providerId.localeCompare(b.candidate.providerId));
  const decision = priorityNominatim.byRow.get(record.sourceRow) ?? decide(record, matches, usedProviderIds);
  if (decision.providerId) usedProviderIds.set(decision.providerId, record.sourceRow);
  decisions.push({
    id: record.id,
    sourceRow: record.sourceRow,
    ...decision,
  });
}

const reviewed = {
  schemaVersion: 1,
  dataset: 'arvin-imax-public-reviewed-geocodes',
  generatedAt: new Date().toISOString(),
  status: 'independent-osm-review-with-unresolved-records',
  source: {
    derived: 'data/derived/cinemas.json',
    provider: 'OpenStreetMap data via Overpass API',
    providerDocs: 'https://www.openstreetmap.org/copyright',
    overpassEndpoint: ENDPOINTS[0],
    priorityNominatim: 'https://nominatim.openstreetmap.org/',
    mapCrs: 'WGS84',
    attribution: '© OpenStreetMap contributors'
  },
  policy: {
    mapCrs: 'WGS84',
    providerDataStoredInPublicLayer: false,
    rawProviderResponsesStoredInPublicLayer: false,
    publicAttributionRequired: true,
    acceptance: 'Exact cinema name/project plus compatible city evidence and unique candidate; venue matches remain location-only.'
  },
  records: decisions,
};

const quality = buildQuality(decisions, candidates, fetchSummary, candidateIndex, priorityNominatim.summary);
const unresolved = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: 'compact-public-unresolved-summary',
  records: decisions.filter((record) => !record.lat || !record.lng).map((record) => ({
    id: record.id,
    sourceRow: record.sourceRow,
    verdict: record.verdict,
    reasonTags: record.reasonTags,
    candidateCount: record.candidateCount,
    topScore: record.topScore,
  }))
};

writeJson(REVIEWED_FILE, reviewed);
writeJson(QUALITY_FILE, quality);
writeJson(UNRESOLVED_FILE, unresolved);
console.log(JSON.stringify({
  ok: true,
  reviewed: relative(REVIEWED_FILE),
  quality: relative(QUALITY_FILE),
  unresolved: relative(UNRESOLVED_FILE),
  summary: quality.summary,
  fetches: quality.fetches,
}, null, 2));

async function loadBbox(bbox) {
  const cacheFile = path.join(CACHE_DIR, `osm-overpass-${bbox.slug}.json`);
  if (fs.existsSync(cacheFile)) {
    const cached = readJson(cacheFile);
    return {
      elements: Array.isArray(cached.elements) ? cached.elements : [],
      summary: { slug: bbox.slug, status: 'cache-hit', elements: cached.elements?.length ?? 0, requests: 0, errors: [] }
    };
  }
  if (!NETWORK || PRIORITY_ONLY) {
    return { elements: [], summary: { slug: bbox.slug, status: 'network-disabled', elements: 0, requests: 0, errors: ['run with --network to populate the cache'] } };
  }

  const query = buildQuery(bbox.bbox);
  const errors = [];
  for (const endpoint of ENDPOINTS) {
    const url = `${endpoint}?data=${encodeURIComponent(query)}`;
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(130000) });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
      const data = JSON.parse(text);
      const cache = {
        schemaVersion: 1,
        provider: 'osm-overpass',
        fetchedAt: new Date().toISOString(),
        sourceUrl: url,
        query,
        osmTimestamp: data.osm3s?.timestamp_osm_base ?? null,
        elements: data.elements ?? []
      };
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, `${JSON.stringify(cache)}\n`, 'utf8');
      return {
        elements: cache.elements,
        summary: { slug: bbox.slug, status: 'network-fetched', elements: cache.elements.length, requests: 1, errors }
      };
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }
  return { elements: [], summary: { slug: bbox.slug, status: 'failed', elements: 0, requests: ENDPOINTS.length, errors } };
}

async function loadPriorityNominatim(records) {
  const selected = [];
  const seen = new Set();
  for (const record of records.filter((item) => item.projection?.system === 'GT Laser').slice(0, 8)) addPriority(record);
  for (const record of records.filter((item) => item.projection?.dome === true).slice(0, 8)) addPriority(record);
  for (const record of records.filter((item) => item.projection?.audioChannels === 12).slice(0, 12)) addPriority(record);

  const byRow = new Map();
  const summary = { selectedRecords: selected.length, networkRequests: 0, cacheHits: 0, errors: [], accepted: 0, unresolved: 0 };
  for (const record of selected) {
    const result = await loadNominatimRecord(record);
    if (result.summary.status === 'cache-hit') summary.cacheHits += 1;
    if (result.summary.status === 'network-fetched') summary.networkRequests += 1;
    if (result.summary.error) summary.errors.push(result.summary.error);
    if (result.decision) { byRow.set(record.sourceRow, result.decision); summary.accepted += 1; }
    else summary.unresolved += 1;
  }
  return { byRow, summary };

  function addPriority(record) {
    if (!seen.has(record.sourceRow)) { seen.add(record.sourceRow); selected.push(record); }
  }
}

async function loadNominatimRecord(record) {
  const cacheFile = path.join(CACHE_DIR, `nominatim-public-priority-${record.sourceRow}.json`);
  let payload;
  let status = 'cache-hit';
  if (fs.existsSync(cacheFile)) {
    payload = readJson(cacheFile);
  } else if (NETWORK) {
    const query = `${record.city ?? ''} ${record.name}`.trim();
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`;
    try {
      const text = fetchViaPowerShell(url);
      payload = { schemaVersion: 1, provider: 'nominatim', fetchedAt: new Date().toISOString(), sourceUrl: url, query, results: JSON.parse(text) };
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, `${JSON.stringify(payload)}\n`, 'utf8');
      status = 'network-fetched';
      await sleep(1100);
    } catch (error) {
      return { decision: null, summary: { status: 'failed', error: `sourceRow ${record.sourceRow}: ${error.message}` } };
    }
  } else {
    return { decision: null, summary: { status: 'network-disabled' } };
  }

  const results = Array.isArray(payload.results) ? payload.results : [];
  const target = prepareTarget(record);
  const matches = results.map((result) => scoreNominatimResult(target, result)).filter(Boolean).sort((a, b) => b.score - a.score);
  const top = matches[0];
  if (!top || top.score < 82 || (matches[1] && top.score - matches[1].score < 12)) {
    return { decision: null, summary: { status } };
  }
  const result = top.result;
  const osmType = result.osm_type;
  const providerId = osmType && result.osm_id ? `osm:${osmType}/${result.osm_id}` : null;
  if (!providerId || !Number.isFinite(Number(result.lat)) || !Number.isFinite(Number(result.lon))) {
    return { decision: null, summary: { status } };
  }
  const sourceUrl = `https://www.openstreetmap.org/${osmType}/${result.osm_id}`;
  const evidenceUrl = payload.sourceUrl;
  const venueOnly = top.venueOnly;
  return {
    decision: {
      verdict: venueOnly ? 'accept-location-only' : 'accept-exact',
      provider: 'osm',
      providerId,
      sourceUrl,
      datasetRelease: 'nominatim-osm:' + (result.osm_id ?? 'unknown'),
      retrievedAt: payload.fetchedAt ?? new Date().toISOString(),
      lat: Number(result.lat),
      lng: Number(result.lon),
      mapCrs: 'WGS84',
      positionType: venueOnly ? 'venue-poi' : 'cinema-poi',
      locationGranularity: venueOnly ? 'venue' : 'cinema',
      locationConfidence: venueOnly ? 'medium' : 'high',
      identityConfidence: venueOnly ? 'medium' : 'high',
      decisionOrigin: 'public-source-independent-review',
      evidenceUrls: [sourceUrl, evidenceUrl],
      attribution: result.licence ?? '© OpenStreetMap contributors',
      candidateCount: matches.length,
      topScore: top.score,
      reasonTags: ['priority-public-source', 'nominatim-name-match', 'city-compatible', ...(venueOnly ? ['venue-only'] : [])]
    },
    summary: { status }
  };
}

function fetchViaPowerShell(url) {
  const command = "$ProgressPreference='SilentlyContinue'; $r=Invoke-WebRequest -Uri $env:TASK_NOMINATIM_URL -Headers @{'User-Agent'='china-imax-map-public-geocode/0.1 (local audit)';'Accept-Language'='zh-CN,zh;q=0.9,en;q=0.5'} -TimeoutSec 45; $r.Content";
  const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', command], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, TASK_NOMINATIM_URL: url },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `PowerShell exited with ${result.status}`);
  return result.stdout.trim();
}

function scoreNominatimResult(record, result) {
  const nameText = normalize([result.name, result.display_name, result.namedetails?.name].filter(Boolean).join(' '));
  const cityText = normalize([
    result.address?.city, result.address?.town, result.address?.municipality,
    result.address?.county, result.address?.state, result.display_name
  ].filter(Boolean).join(' '));
  const identity = coreName(nameText, '', '');
  const shared = longestCommonSubstring(record._targetCore, identity);
  const exact = record._targetCore.length >= 4 && (identity.includes(record._targetCore) || record._targetCore.includes(identity));
  const city = record._targetCity && cityText.includes(record._targetCity);
  const isCinema = result.type === 'cinema' || result.class === 'amenity' || result.category === 'amenity';
  const isVenueTarget = record.projection?.dome === true || /科技|科學|博物|太空|天文|少年宫|少年宮/.test(record.name);
  const isVenue = result.type === 'museum' || result.class === 'tourism' || result.category === 'tourism';
  const venueOnly = !isCinema && isVenueTarget && isVenue;
  if (!city || (!isCinema && !venueOnly) || (!exact && shared < 6)) return null;
  return { result, venueOnly, score: (exact ? 75 : 0) + Math.min(20, shared * 2) + (city ? 20 : 0) + ((isCinema || venueOnly) ? 10 : 0) };
}

function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function buildQuery([south, west, north, east]) {
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:120];(nwr[amenity=cinema][name](${bbox});nwr[tourism=museum][name~"科技|科學|太空|天文|博物|IMAX"](${bbox});nwr[amenity=arts_centre][name~"科技|科學|太空|天文|博物|IMAX"](${bbox}););out center tags;`;
}

function dedupeCandidates(elements) {
  const byId = new Map();
  for (const element of elements) {
    if (!element?.type || element.id === undefined) continue;
    const tags = element.tags ?? {};
    const position = element.type === 'node' ? element : element.center;
    if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lon)) continue;
    if (!tags.name && !tags['name:zh']) continue;
    const providerId = `osm:${element.type}/${element.id}`;
    const category = tags.amenity === 'cinema' ? 'cinema' : tags.tourism === 'museum' || tags.amenity === 'arts_centre' ? 'venue' : 'other';
    if (category === 'other') continue;
    const searchText = normalize([
      tags.name, tags['name:zh'], tags.alt_name, tags['alt_name:zh'], tags.operator, tags.brand,
      tags['addr:place'], tags['addr:street'], tags['addr:full']
    ].filter(Boolean).join(' '));
    byId.set(providerId, {
      providerId,
      osmType: element.type,
      osmId: element.id,
      lat: Number(position.lat),
      lng: Number(position.lon),
      category,
      tags,
      searchText,
      core: coreName(searchText, '', ''),
      adminText: normalize([
        tags['addr:city'], tags['addr:province'], tags['addr:district'], tags['is_in:city'],
        tags['is_in:state'], tags['addr:full']
      ].filter(Boolean).join(' ')),
      sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      datasetRelease: 'osm3s:' + (element._osmTimestamp ?? 'current-overpass-release')
    });
  }
  return [...byId.values()];
}

function scoreCandidate(record, candidate) {
  const targetCity = record._targetCity;
  const targetProvince = record._targetProvince;
  const adminText = candidate.adminText;
  const cityCompatible = targetCity && adminText && (adminText.includes(targetCity) || targetCity.includes(adminText));
  const provinceCompatible = !targetProvince || !adminText || adminText.includes(targetProvince);
  const targetCore = record._targetCore;
  const candidateText = candidate.searchText;
  const candidateCore = candidate.core;
  const exactCore = targetCore.length >= 4 && (candidateCore.includes(targetCore) || targetCore.includes(candidateCore));
  const shared = longestCommonSubstring(targetCore, candidateCore);
  const sharedProject = record._targetParts.some((part) => part.length >= 4 && candidateText.includes(part));
  let score = 0;
  if (exactCore) score += 72;
  if (shared >= 6) score += Math.min(22, shared * 2);
  else if (shared >= 4) score += 8;
  if (sharedProject) score += 18;
  if (cityCompatible) score += 20;
  if (provinceCompatible) score += 5;
  if (candidate.category === 'cinema') score += 8;
  if (record.projection?.dome && candidate.category === 'cinema') score -= 10;
  return {
    candidate,
    score,
    cityCompatible: Boolean(cityCompatible),
    provinceCompatible: Boolean(provinceCompatible),
    exactCore,
    shared,
    sharedProject,
  };
}

function prepareTarget(record) {
  return {
    ...record,
    _targetCity: normalize(record.city),
    _targetProvince: normalize(record.province),
    _targetCore: coreName(record.name, record.city, record.province),
    _targetParts: parentheticalParts(record.name),
  };
}

function decide(record, matches, usedProviderIds) {
  const eligible = matches.filter((match) => match.cityCompatible && match.provinceCompatible && match.score >= 88);
  const top = eligible[0];
  const second = eligible[1];
  const reasons = [];
  if (!top) {
    if (matches.length) reasons.push('city-or-identity-incompatible');
    else reasons.push('no-osm-candidate');
    return unresolvedDecision('needs-more-evidence', matches, reasons);
  }
  if (usedProviderIds.has(top.candidate.providerId)) {
    return unresolvedDecision('ambiguous', matches, ['same-provider-feature-matched-by-another-row']);
  }
  if (second && top.score - second.score < 12) {
    return unresolvedDecision('ambiguous', matches, ['multiple-compatible-candidates']);
  }
  if (!top.exactCore && !top.sharedProject) {
    return unresolvedDecision('needs-more-evidence', matches, ['identity-not-specific-enough']);
  }
  const venueOnly = top.candidate.category === 'venue';
  const candidate = top.candidate;
  return {
    verdict: venueOnly ? 'accept-location-only' : 'accept-exact',
    provider: 'osm',
    providerId: candidate.providerId,
    sourceUrl: candidate.sourceUrl,
    datasetRelease: candidate.datasetRelease,
    retrievedAt: new Date().toISOString(),
    lat: candidate.lat,
    lng: candidate.lng,
    mapCrs: 'WGS84',
    positionType: venueOnly ? 'venue-poi' : 'cinema-poi',
    locationGranularity: venueOnly ? 'venue' : 'cinema',
    locationConfidence: venueOnly ? 'medium' : 'high',
    identityConfidence: venueOnly ? 'medium' : 'high',
    decisionOrigin: 'public-source-independent-review',
    evidenceUrls: [candidate.sourceUrl],
    attribution: '© OpenStreetMap contributors',
    candidateCount: matches.length,
    topScore: top.score,
    reasonTags: [venueOnly ? 'venue-only' : 'exact-cinema-name-project', 'city-compatible', 'unique-compatible-candidate']
  };
}

function unresolvedDecision(verdict, matches, reasonTags) {
  return {
    verdict,
    provider: null,
    providerId: null,
    sourceUrl: null,
    datasetRelease: null,
    retrievedAt: null,
    lat: null,
    lng: null,
    mapCrs: null,
    positionType: null,
    locationGranularity: null,
    locationConfidence: null,
    identityConfidence: null,
    decisionOrigin: 'public-source-independent-review',
    evidenceUrls: [],
    attribution: '© OpenStreetMap contributors',
    candidateCount: matches.length,
    topScore: matches[0]?.score ?? 0,
    reasonTags
  };
}

function buildQuality(decisions, candidates, fetches, candidateIndex, priorityNominatim) {
  const accepted = decisions.filter((record) => Number.isFinite(record.lat) && Number.isFinite(record.lng));
  const countBy = (values) => Object.fromEntries([...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map())].sort());
  const derivedByRow = new Map(derived.records.map((record) => [record.sourceRow, record]));
  const coverageByRegion = {};
  for (const decision of accepted) {
    const source = derivedByRow.get(decision.sourceRow);
    const region = source?.region ?? 'unknown';
    coverageByRegion[region] = (coverageByRegion[region] ?? 0) + 1;
  }
  const special = (predicate) => ({ total: derived.records.filter(predicate).length, accepted: accepted.filter((item) => predicate(derivedByRow.get(item.sourceRow))).length });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: accepted.length > 0 ? 'public-coordinate-candidates-available' : 'no-public-coordinate-candidates',
    providerPolicyCheckedAt: '2026-08-21',
    providerPolicy: {
      provider: 'OpenStreetMap via Overpass API',
      dataLicense: 'ODbL',
      attribution: '© OpenStreetMap contributors',
      sourceUrl: 'https://www.openstreetmap.org/copyright',
      overpassPolicyReference: 'https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_API_by_Example',
      nominatimPolicyReference: 'https://operations.osmfoundation.org/policies/nominatim/',
      note: 'This run used Overpass bulk OSM data, not public Nominatim bulk geocoding.'
    },
    fetches: {
      networkRequests: fetches.reduce((sum, item) => sum + item.requests, 0),
      cacheHits: fetches.filter((item) => item.status === 'cache-hit').length,
      errors: fetches.flatMap((item) => item.errors),
      bboxes: fetches,
      priorityNominatim,
      uniqueOsmFeatures: candidates.length
    },
    summary: {
      total: decisions.length,
      publicHigh: decisions.filter((record) => record.verdict === 'accept-exact').length,
      publicMediumReviewed: decisions.filter((record) => record.verdict === 'accept-location-only').length,
      unresolvedPublic: decisions.filter((record) => !Number.isFinite(record.lat) || !Number.isFinite(record.lng)).length,
      coverage: decisions.length ? Number((accepted.length / decisions.length).toFixed(6)) : 0,
      locationGranularity: countBy(accepted.map((record) => record.locationGranularity)),
      providers: countBy(accepted.map((record) => record.provider)),
      regionsWithCoordinates: coverageByRegion,
      duplicateProviderIds: accepted.length - new Set(accepted.map((record) => record.providerId)).size,
      verdicts: countBy(decisions.map((record) => record.verdict)),
      reasons: countBy(decisions.flatMap((record) => record.reasonTags)),
      gtLaser: special((record) => record?.projection?.system === 'GT Laser'),
      dome: special((record) => record?.projection?.dome === true),
      audio12: special((record) => record?.projection?.audioChannels === 12),
    },
    recordsWithoutRawProviderResponse: true,
    candidateIndexCheck: [...candidateIndex.keys()].length === candidates.length,
  };
}

function coreName(value, city, province) {
  let normalized = normalize(value);
  for (const token of [normalize(province), normalize(city), `${normalize(city)}市`].filter(Boolean)) {
    if (normalized.startsWith(token)) normalized = normalized.slice(token.length);
  }
  normalized = normalized
    .replace(/(imак|imax|4k|3d|激光|双激光|氙灯|xenon|commerciallaser|gtlaser|laser)/g, '')
    .replace(/(店|旗舰|影厅)$/g, '')
    .replace(/科学技术馆/g, '科技馆')
    .replace(/科學技術館/g, '科技馆')
    .replace(/科學館/g, '科技馆')
    .replace(/科技館/g, '科技馆')
    .replace(/太空館/g, '太空馆')
    .replace(/少年宮/g, '少年宫');
  return normalized;
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[臺台]/g, '台').replace(/[灣湾]/g, '湾').replace(/[館馆]/g, '馆')
    .replace(/[戲戏]/g, '戏').replace(/[院院]/g, '院').replace(/[廣广]/g, '广')
    .replace(/[場场]/g, '场').replace(/[樂乐]/g, '乐').replace(/[萬万]/g, '万')
    .replace(/[國国]/g, '国').replace(/[會会]/g, '会').replace(/[樓楼]/g, '楼')
    .replace(/[門门]/g, '门').replace(/[龍龙]/g, '龙').replace(/[華华]/g, '华')
    .replace(/[麗丽]/g, '丽').replace(/[科學]/g, '科学').replace(/[術术]/g, '术')
    .replace(/[\s·•,，。()（）【】\[\]{}<>《》_\-—–/\\:：'"`]+/g, '');
}

function parentheticalParts(value) {
  return String(value ?? '').split(/[（）()]/).filter((part) => normalize(part).length >= 4).map(normalize);
}

function longestCommonSubstring(a, b) {
  const maxLength = Math.min(8, a.length);
  for (let length = maxLength; length >= 4; length -= 1) {
    for (let index = 0; index + length <= a.length; index += 1) {
      if (b.includes(a.slice(index, index + length))) return length;
    }
  }
  return 0;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function relative(file) { return path.relative(ROOT, file).replaceAll(path.sep, '/'); }
