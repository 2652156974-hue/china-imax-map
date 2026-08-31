import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGenericOnlyQuery, normalizeText, sourceBrand, sourceProjectTokens } from './scoring.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CANONICAL_FILE = path.join(ROOT, 'data/local/private-reviewed-geocodes.json');
export const AMAP_CACHE_FILE = path.join(ROOT, 'data/geocode/provider-cache/amap.json');
export const HUMAN_QUEUE_FILE = path.join(ROOT, 'data/audit/human-verification-queue.json');

const DEVICE = /imax|laser|commercial|xenon|dome|gt|xt|sr|3d|4k|激光|氙灯|氙燈|声道|聲道|巨幕/gi;
const CINEMA_WORDS = /影院|影城|电影院|电影城|戏院|cinema|cinemas|theatre|theater/i;
const MALL_WORDS = /商场|商業|广场|廣場|mall|购物中心|購物中心|天地|百货|百貨/i;
const VENUE_WORDS = /博物馆|博物館|科技馆|科技館|科学技术馆|科學技術館|天文馆|天文館|科技中心|科學中心/i;
const NON_TARGET = /私人影院|自助影院|影吧|游戏机|游戏厅|摇杆|飞行影院|裸眼\s*9d|4d影院|好运椰|咖啡|餐厅|餐饮|蛋包饭|烤鸭|造型|美容|美发|健身|酒店|便利店|金店|服装|服饰|棋牌|停车场|药房|同仁堂|manner|ktv|大头贴|奥特乐|耐克|栖花里|shake\s*shack/i;

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}

export function clean(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function canonicalCity(value) {
  return normalizeText(value).replace(/特别行政区|特別行政區|自治区|自治區|自治州|市|地区|地區$/g, '');
}

function canonicalProvince(value) {
  return normalizeText(value).replace(/省|市|自治区|自治區|特别行政区|特別行政區$/g, '');
}

function normalizedEntity(value) {
  return normalizeText(value).replace(/[()（）·•.,，。:：;；\-—–_/\\'"“”‘’\s]/g, '');
}

function stripGeneric(value) {
  return normalizedEntity(value)
    .replace(DEVICE, '')
    .replace(/影厅|影廳|影院|影城|电影院|电影城|戏院|cinema|cinemas|theatre|theater|店|mall|商场|商場|购物中心|購物中心|广场|廣場/gi, '')
    .replace(/[^a-z0-9\u3400-\u9fff]/gi, '');
}

function diceSimilarity(left, right) {
  const a = normalizedEntity(left);
  const b = normalizedEntity(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(1, 0.72 + Math.min(a.length, b.length) / Math.max(a.length, b.length) * 0.28);
  const grams = (value) => new Set(value.length < 2 ? [value] : [...Array(value.length - 1)].map((_, index) => value.slice(index, index + 2)));
  const leftGrams = grams(a);
  const rightGrams = grams(b);
  const intersection = [...leftGrams].filter((gram) => rightGrams.has(gram)).length;
  return (2 * intersection) / (leftGrams.size + rightGrams.size);
}

function unique(values) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(clean(value));
  }
  return output;
}

function parentheticalParts(value) {
  return [...String(value ?? '').matchAll(/[（(]([^）)]*)[）)]/g)].map((match) => clean(match[1]));
}

function cleanHint(value) {
  return clean(value)
    .replace(DEVICE, ' ')
    .replace(/(?:旗舰)?店$/i, '')
    .replace(/影城|影院|电影院|电影城|戏院|影厅|影廳/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function entityHints(record) {
  const brand = sourceBrand(record) || '';
  const rawHints = [
    ...sourceProjectTokens(record),
    ...parentheticalParts(record.name),
    ...(record.supplemental?.mallOrVenue ? [record.supplemental.mallOrVenue] : [])
  ];
  const hints = rawHints.map(cleanHint).filter((value) => value && !isGenericOnlyQuery(value) && normalizedEntity(value).length >= 2);
  const nameWithoutAdmin = clean(record.name)
    .replace(new RegExp(canonicalCity(record.city), 'ig'), ' ')
    .replace(new RegExp(canonicalProvince(record.province), 'ig'), ' ');
  const tail = cleanHint(nameWithoutAdmin.replace(new RegExp(brand || '(?!)', 'ig'), ' '));
  if (!hints.length && tail && !isGenericOnlyQuery(tail) && normalizedEntity(tail).length >= 2) hints.push(tail);
  return { brand, hints: unique(hints).slice(0, 5) };
}

export function buildRefinedAmapQueries(record) {
  const city = clean(record.city);
  const district = clean(record.district);
  const { brand, hints } = entityHints(record);
  const queries = [];
  const add = (kind, query, specificity = 'specific') => {
    query = clean(query);
    if (!query || isGenericOnlyQuery(query)) return;
    if (queries.some((item) => normalizeText(item.query) === normalizeText(query))) return;
    const venue = VENUE_WORDS.test(`${record.name} ${record.nameRaw ?? ''}`);
    queries.push({
      kind,
      query,
      city,
      district,
      specificity,
      types: venue ? null : '080601',
      citylimit: true
    });
  };

  if (brand && hints.length) add('brand-branch-or-mall-city', `${brand} ${hints[0]} ${city}`);
  if (brand && hints.length && district) add('brand-branch-mall-district', `${brand} ${hints[0]} ${district}`);
  for (const formerName of record.formerNames ?? []) {
    add('former-name-city', `${formerName} ${city}`);
    if (hints.length) add('former-name-mall', `${formerName} ${hints[0]} ${city}`);
  }
  if (VENUE_WORDS.test(`${record.name} ${record.nameRaw ?? ''}`)) {
    add('venue-name-city', `${record.name} ${city}`);
    if (brand) add('venue-cinema-brand', `${record.name} ${brand} ${city}`);
  }
  if (hints.length && brand) add('mall-venue-brand-district', `${hints[0]} ${brand} ${district || city}`);
  add('full-name-city', `${record.name} ${city}`, 'auxiliary-specific');
  return queries.slice(0, 6);
}

function parseLocation(value) {
  if (value && typeof value === 'object') {
    const lat = Number(value.lat ?? value.y);
    const lng = Number(value.lng ?? value.lon ?? value.x);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  const [lng, lat] = String(value ?? '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function normalizeAmapCandidate(candidate, query = null) {
  return {
    provider: 'amap',
    providerPoiId: candidate?.id ?? null,
    name: clean(candidate?.name),
    address: clean(candidate?.address),
    province: clean(candidate?.pname),
    city: clean(candidate?.cityname),
    district: clean(candidate?.adname),
    adcode: candidate?.adcode ?? null,
    type: clean(candidate?.type),
    typecode: clean(candidate?.typecode),
    tag: clean(candidate?.tag),
    parentPoi: candidate?.parent ?? null,
    location: parseLocation(candidate?.location),
    providerCrs: 'GCJ-02',
    query,
    rawCandidate: candidate
  };
}

function kindFor(record, candidate) {
  const typecode = String(candidate.typecode ?? '');
  const nameText = [candidate.name, candidate.tag, candidate.type].filter(Boolean).join(' ');
  if (/080601/.test(typecode) || (!typecode && CINEMA_WORDS.test(candidate.name))) return 'cinema';
  if (VENUE_WORDS.test(`${record.name} ${record.nameRaw ?? ''}`) && (/^14/.test(typecode) || VENUE_WORDS.test(nameText))) return 'venue';
  if (/^06/.test(typecode) || (!typecode && MALL_WORDS.test(nameText))) return 'mall';
  return 'other';
}

function sourceIsVenue(record) {
  return VENUE_WORDS.test(`${record.name} ${record.nameRaw ?? ''} ${(record.formerNames ?? []).join(' ')}`);
}

function cityMatch(record, candidate) {
  const target = canonicalCity(record.city);
  if (!target) return false;
  const explicit = [candidate.city, candidate.province, candidate.district].filter(Boolean).map(canonicalCity);
  return explicit.some((value) => value === target || value.includes(target) || target.includes(value)) || canonicalCity(candidate.address).includes(target);
}

function provinceMatch(record, candidate) {
  const target = canonicalProvince(record.province);
  return [candidate.province, candidate.city, candidate.address].filter(Boolean).map(canonicalProvince).some((value) => value.includes(target) || target.includes(value));
}

export function assessAmapCandidate(record, candidate) {
  const { brand, hints } = entityHints(record);
  const text = [candidate.name, candidate.address, candidate.city, candidate.district, candidate.tag, candidate.type].filter(Boolean).join(' ');
  const normalizedText = normalizeText(text);
  const candidateIdentity = stripGeneric(candidate.name);
  const sourceIdentity = stripGeneric(record.name);
  const kind = kindFor(record, candidate);
  const sameCity = cityMatch(record, candidate);
  const sameProvince = provinceMatch(record, candidate);
  const brandMatch = Boolean(brand && normalizedText.includes(normalizeText(brand)));
  const hintMatches = hints.filter((hint) => {
    const token = normalizedEntity(hint);
    return token.length >= 2 && (normalizedText.includes(token) || diceSimilarity(token, candidateIdentity) >= 0.84);
  });
  const formerNameMatch = (record.formerNames ?? []).some((name) => diceSimilarity(stripGeneric(name), candidateIdentity) >= 0.82 || candidateIdentity.includes(stripGeneric(name)));
  const nameSimilarity = Math.max(diceSimilarity(sourceIdentity, candidateIdentity), ...((record.formerNames ?? []).map((name) => diceSimilarity(stripGeneric(name), candidateIdentity))), 0);
  const validLocation = Boolean(candidate.location && Number.isFinite(candidate.location.lat) && Number.isFinite(candidate.location.lng));
  const hardRejects = [];
  if (!sameCity && (candidate.city || candidate.province || candidate.address)) hardRejects.push('city-mismatch');
  if (!validLocation) hardRejects.push('invalid-location');
  if (kind === 'other') hardRejects.push('non-target-poi');
  if (NON_TARGET.test(candidate.name)) hardRejects.push('non-target-name');
  if (hints.length && kind === 'cinema' && !hintMatches.length && !formerNameMatch && nameSimilarity < 0.9) hardRejects.push('branch-or-mall-not-proven');
  if (brand && kind === 'cinema' && !brandMatch && nameSimilarity < 0.9 && !formerNameMatch) hardRejects.push('brand-not-proven');
  const score = Number((
    0.25 * (sameCity ? 1 : 0) +
    0.08 * (sameProvince ? 1 : 0) +
    0.18 * (brandMatch ? 1 : 0) +
    0.24 * (hintMatches.length ? 1 : 0) +
    0.15 * nameSimilarity +
    0.10 * (kind === 'cinema' ? 1 : kind === 'venue' ? 0.95 : kind === 'mall' ? 0.75 : 0) +
    0.10 * (formerNameMatch ? 1 : 0)
  ).toFixed(6));
  const branchProven = hints.length === 0 || hintMatches.length > 0 || formerNameMatch;
  const strictEntityMatch = hardRejects.length === 0 && sameCity && validLocation && (
    kind === 'cinema' ? Boolean(branchProven && (brandMatch || formerNameMatch || nameSimilarity >= 0.9))
      : Boolean(hintMatches.length || nameSimilarity >= 0.86 || (sourceIsVenue(record) && kind === 'venue'))
  );
  return {
    ...candidate,
    kind,
    cityMatch: sameCity,
    provinceMatch: sameProvince,
    brandMatch,
    branchMatch: hintMatches.length > 0,
    hintMatches,
    mallMatch: hintMatches.length > 0 && (MALL_WORDS.test(hints.join(' ')) || MALL_WORDS.test(candidate.name)),
    venueMatch: sourceIsVenue(record) && (kind === 'venue' || VENUE_WORDS.test(candidate.name)),
    formerNameMatch,
    nameSimilarity: Number(nameSimilarity.toFixed(6)),
    validLocation,
    hardRejects,
    score,
    strictEntityMatch,
    identityConfidence: strictEntityMatch ? 'high' : hardRejects.length === 0 && sameCity && (brandMatch || hintMatches.length || nameSimilarity >= 0.78) ? 'medium' : 'unknown',
    locationConfidence: validLocation && sameCity && !hardRejects.some((reason) => reason === 'city-mismatch' || reason === 'invalid-location') ? (strictEntityMatch ? 'high' : 'medium') : 'unknown'
  };
}

export function selectAmapCandidates(record, candidates) {
  const deduped = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.providerPoiId ?? ''}|${normalizeText(candidate.name)}|${candidate.location?.lng ?? ''},${candidate.location?.lat ?? ''}`;
    const prior = deduped.get(key);
    if (!prior || (candidate.query && !prior.query)) deduped.set(key, candidate);
  }
  const ranked = [...deduped.values()].map((candidate) => assessAmapCandidate(record, candidate)).sort((a, b) => b.score - a.score || Number(b.strictEntityMatch) - Number(a.strictEntityMatch) || String(a.name).localeCompare(String(b.name), 'zh-CN'));
  const eligible = ranked.filter((candidate) => candidate.hardRejects.length === 0);
  const best = eligible[0] ?? ranked[0] ?? null;
  const topThree = best
    ? [best, ...ranked.filter((candidate) => candidate.providerPoiId !== best.providerPoiId)].slice(0, 3)
    : ranked.slice(0, 3);
  return {
    ranked,
    eligible,
    best,
    topThree,
    ambiguity: eligible.filter((candidate) => eligible[0] && candidate.providerPoiId !== eligible[0].providerPoiId && eligible[0].score - candidate.score < 0.08).length > 0
  };
}

export function compactAmapCandidate(candidate) {
  if (!candidate) return null;
  return {
    providerPoiId: candidate.providerPoiId ?? null,
    name: candidate.name ?? null,
    address: candidate.address ?? null,
    mallOrVenue: candidate.parentPoi?.name ?? candidate.hintMatches?.[0] ?? (MALL_WORDS.test(`${candidate.name ?? ''} ${candidate.address ?? ''}`) ? candidate.name : null),
    province: candidate.province ?? null,
    city: candidate.city ?? null,
    district: candidate.district ?? null,
    adcode: candidate.adcode ?? null,
    poiType: candidate.type ?? null,
    typecode: candidate.typecode ?? null,
    kind: candidate.kind ?? null,
    location: candidate.location ?? null,
    providerCrs: 'GCJ-02',
    score: candidate.score ?? null,
    cityMatch: candidate.cityMatch ?? null,
    brandMatch: candidate.brandMatch ?? null,
    branchMatch: candidate.branchMatch ?? null,
    hintMatches: candidate.hintMatches ?? [],
    formerNameMatch: candidate.formerNameMatch ?? null,
    nameSimilarity: candidate.nameSimilarity ?? null,
    strictEntityMatch: candidate.strictEntityMatch ?? false,
    identityConfidence: candidate.identityConfidence ?? null,
    locationConfidence: candidate.locationConfidence ?? null,
    hardRejects: candidate.hardRejects ?? [],
    sourceQuery: candidate.query ?? null
  };
}

export function hasCoordinate(record) {
  const lat = record?.location?.lat;
  const lng = record?.location?.lng;
  return lat !== null && lat !== undefined && lat !== '' && lng !== null && lng !== undefined && lng !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

export function loadScopedUnresolved() {
  const source = readJson(CANONICAL_FILE);
  const records = Array.isArray(source.records) ? source.records : [];
  const unresolved = records.filter((record) => record.reviewState === 'unresolved');
  const located = records.filter(hasCoordinate);
  const pending = records.filter((record) => record.reviewState === 'pending-review');
  if (records.length !== 901 || pending.length !== 0 || located.length < 672 || unresolved.length > 229 || located.length + unresolved.length !== 901) throw new Error(`Expected scoped canonical total=901, pending=0, located>=672, unresolved<=229; received ${records.length}/${located.length}/${unresolved.length}/${pending.length}.`);
  return { source, records, unresolved, located, pending, baseline: { total: 901, located: 672, unresolved: 229, pending: 0 } };
}

export function linkedAmapEvidence(record, cache) {
  const linked = (cache.requests ?? []).filter((request) => (request.sourceRows ?? []).some((sourceRow) => Number(sourceRow) === Number(record.sourceRow)));
  const candidates = linked.flatMap((request) => (request.rawCandidates ?? request.candidates ?? []).map((candidate) => normalizeAmapCandidate(candidate, request.query)));
  return { linked, candidates, selection: selectAmapCandidates(record, candidates) };
}

export function countBy(values) {
  return Object.fromEntries([...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map())].sort());
}
