import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DERIVED_PATH = path.join(ROOT, 'data', 'derived', 'cinemas.json');
const CACHE_PATH = path.join(ROOT, 'data', 'derived', 'geocode-cache.json');
const LIMIT = Number(process.env.GEOCODE_LIMIT || 30);
const RETRY_FAILED = process.env.GEOCODE_RETRY_FAILED === '1';
const USER_AGENT = 'china-imax-map/0.3 (https://github.com/2652156974-hue/china-imax-map)';
const REFERER = 'https://github.com/2652156974-hue/china-imax-map';
const WAIT_MS = 1200;

const cache = fs.existsSync(CACHE_PATH)
  ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
  : { schemaVersion: 1, provider: 'OpenStreetMap Nominatim', retrievedAt: null, results: {}, failures: [] };
cache.results ||= {};
cache.failures ||= [];

const derived = JSON.parse(fs.readFileSync(DERIVED_PATH, 'utf8'));
const records = derived.records;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function queryFor(record) {
  if (record.region === '香港') return `${record.name}, Hong Kong`;
  if (record.region === '澳门') return `${record.name}, Macau`;
  if (record.region === '台湾') return `${record.name}, ${record.city}, Taiwan`;
  return `${record.name}, ${record.city}, ${record.province}, China`;
}

function normalizedHaystack(result) {
  return JSON.stringify({
    display_name: result.display_name || '',
    name: result.name || '',
    address: result.address || {},
  }).toLowerCase();
}

function meaningfulTokens(record) {
  const generic = /IMAX|imax|影城|影院|戏院|戲院|电影城|電影城|国际影城|國際影城|万达影城|萬達影城|CGV|SFC|MCL|UA|金逸|幸福蓝海|幸福藍海|博纳|博納|保利|星美|上影|威秀|英皇|电影院|電影院/g;
  const name = record.name.replace(generic, ' ');
  const chinese = [...name.matchAll(/[\u3400-\u9fff]{2,}/g)].map((match) => match[0]);
  const latin = [...name.matchAll(/[A-Za-z][A-Za-z0-9+&' -]{2,}/g)].map((match) => match[0].trim());
  return [...new Set([...chinese, ...latin])]
    .filter((token) => token.length >= 2 && token !== record.city && token !== record.province)
    .sort((a, b) => b.length - a.length);
}

function cityTokens(record) {
  const tokens = [record.city, record.province, record.region];
  if (record.region === '香港') tokens.push('Hong Kong', '香港');
  if (record.region === '澳门') tokens.push('Macau', 'Macao', '澳门', '澳門');
  if (record.region === '台湾') tokens.push('Taiwan', '台湾', '臺灣');
  return tokens.filter(Boolean).map((token) => String(token).toLowerCase());
}

function validateResult(record, result) {
  const allowedTypes = new Set(['cinema', 'theatre', 'arts_centre']);
  const haystack = normalizedHaystack(result);
  const typeAccepted = allowedTypes.has(result.type);
  const matchedCity = cityTokens(record).find((token) => haystack.includes(token));
  const matchedNameToken = meaningfulTokens(record).find((token) => haystack.includes(token.toLowerCase()));
  const lat = Number(result.lat);
  const lon = Number(result.lon);
  const coordinateValid = Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  if (!typeAccepted || !matchedCity || !matchedNameToken || !coordinateValid) return null;
  return {
    id: record.id,
    sourceRow: record.sourceRow,
    name: record.name,
    city: record.city,
    lat,
    lng: lon,
    address: String(result.display_name || ''),
    confidence: 'medium',
    source: 'OpenStreetMap Nominatim',
    query: queryFor(record),
    matchedCityToken: matchedCity,
    matchedNameToken,
    resultType: result.type,
    resultClass: result.class || '',
    retrievedAt: new Date().toISOString(),
  };
}

function addFailure(record, reason, extra = {}) {
  cache.failures = cache.failures.filter((failure) => failure.id !== record.id);
  cache.failures.push({
    id: record.id,
    sourceRow: record.sourceRow,
    name: record.name,
    city: record.city,
    query: queryFor(record),
    reason,
    ...extra,
    retrievedAt: new Date().toISOString(),
  });
}

function saveCache() {
  cache.retrievedAt = new Date().toISOString();
  fs.writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function selectTargets() {
  const selected = [];
  const add = (record) => {
    if (record && !selected.some((item) => item.id === record.id)) selected.push(record);
  };
  const first = (predicate) => records.find(predicate);
  add(first((record) => record.city === '上海'));
  add(first((record) => record.city === '北京'));
  add(first((record) => record.city === '广州' || record.city === '深圳'));
  add(first((record) => record.city === '西安'));
  add(first((record) => record.city === '成都'));
  records.filter((record) => record.region === '香港').slice(0, 3).forEach(add);
  add(first((record) => record.region === '澳门'));
  records.filter((record) => record.region === '台湾').slice(0, 5).forEach(add);
  add(first((record) => record.projection.system === 'GT Laser'));
  add(first((record) => record.projection.system === 'Laser XT'));
  add(first((record) => record.projection.system === 'Xenon'));
  add(first((record) => record.projection.dome));
  add(first((record) => record.status === 'closed'));

  for (const record of records) {
    if (selected.length >= LIMIT) break;
    add(record);
  }
  return selected.slice(0, LIMIT);
}

async function main() {
  const targets = selectTargets();
  console.log(`Geocoding ${targets.length} deliberately selected records at >= 1 request/sec; cached results and prior failures are skipped unless GEOCODE_RETRY_FAILED=1.`);
  for (const [index, record] of targets.entries()) {
    if (cache.results[record.id]) {
      console.log(`[${index + 1}/${targets.length}] cached ${record.sourceRow} ${record.name}`);
      continue;
    }
    if (!RETRY_FAILED && cache.failures.some((failure) => failure.id === record.id)) {
      console.log(`[${index + 1}/${targets.length}] prior failure retained ${record.sourceRow} ${record.name}`);
      continue;
    }
    if (index > 0) await sleep(WAIT_MS);
    const query = queryFor(record);
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '5');
    url.searchParams.set('accept-language', 'zh-CN,en');
    url.searchParams.set('q', query);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Referer: REFERER, Accept: 'application/json' },
      });
      if (!response.ok) {
        addFailure(record, `HTTP ${response.status}`);
        console.log(`[${index + 1}/${targets.length}] ${record.sourceRow} HTTP ${response.status}`);
        saveCache();
        continue;
      }
      const results = await response.json();
      const accepted = results.map((result) => validateResult(record, result)).find(Boolean);
      if (accepted) {
        cache.results[record.id] = accepted;
        cache.failures = cache.failures.filter((failure) => failure.id !== record.id);
        console.log(`[${index + 1}/${targets.length}] accepted ${record.sourceRow} ${record.name} -> ${accepted.lat},${accepted.lng}`);
      } else {
        addFailure(record, 'no-result-passed-name-city-type-match', { candidateCount: results.length });
        console.log(`[${index + 1}/${targets.length}] no accepted match ${record.sourceRow} ${record.name}`);
      }
    } catch (error) {
      addFailure(record, `request-error: ${error.message}`);
      console.log(`[${index + 1}/${targets.length}] error ${record.sourceRow}: ${error.message}`);
    }
    saveCache();
  }
  saveCache();
  console.log(JSON.stringify({
    targets: targets.length,
    accepted: Object.keys(cache.results).length,
    failures: cache.failures.length,
    acceptedSourceRows: Object.values(cache.results).map((entry) => entry.sourceRow).filter(Boolean),
  }, null, 2));
}

main();
