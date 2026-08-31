import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_AMAP_CACHE_FILE = path.join(ROOT, 'data/geocode/provider-cache/amap.json');
export const DEFAULT_ADMIN_HIERARCHY_FILE = path.join(ROOT, 'data/geocode/mainland-admin-hierarchy.json');

export const ADMINISTRATIVE_FIELDS = Object.freeze([
  'provinceName',
  'provinceCode',
  'prefectureName',
  'prefectureCode',
  'prefectureLevel',
  'countyName',
  'countyCode',
  'countyLevel',
  'source'
]);

const DIRECT_COUNTY_PARENTS = new Set(['北京', '上海', '天津', '重庆', '香港', '澳门']);
const TRADITIONAL_TO_SIMPLIFIED = new Map([
  ['臺', '台'], ['灣', '湾'], ['廣', '广'], ['場', '场'], ['聲', '声'], ['戲', '戏'],
  ['國', '国'], ['麗', '丽'], ['門', '门'], ['會', '会'], ['廳', '厅'], ['燈', '灯'],
  ['龍', '龙'], ['樂', '乐'], ['萬', '万'], ['華', '华'], ['銀', '银'], ['電', '电'],
  ['館', '馆'], ['學', '学'], ['術', '术'], ['濟', '济'], ['發', '发'], ['開', '开'],
  ['業', '业'], ['閉', '闭']
]);

/*
 * This module deliberately keeps the provider cache behind a narrow index.
 * The selected administrative object is made only from scalar admin fields;
 * no provider candidate, address, or cache document is returned to callers.
 */
export function createAdministrativeBindingContext({
  cacheFile = DEFAULT_AMAP_CACHE_FILE,
  hierarchyFile = DEFAULT_ADMIN_HIERARCHY_FILE,
  cacheDocument,
  hierarchyDocument
} = {}) {
  const hierarchy = hierarchyDocument !== undefined
    ? (hierarchyDocument && typeof hierarchyDocument === 'object' ? hierarchyDocument : {})
    : readJsonIfExists(hierarchyFile) ?? {};
  const cache = cacheDocument !== undefined
    ? (cacheDocument && typeof cacheDocument === 'object' ? cacheDocument : null)
    : readJsonIfExists(cacheFile);

  return Object.freeze({
    hierarchy: buildHierarchyIndex(hierarchy),
    candidateIndex: buildCandidateIndex(cache),
    cacheAvailable: Boolean(cache && typeof cache === 'object')
  });
}

export function bindAdministrativeRecord(record, contextOrOptions = {}) {
  const context = normalizeContext(contextOrOptions);
  const hierarchy = context.hierarchy;
  const provinceName = textOrNull(record?.province);
  const cityName = textOrNull(record?.city);
  const targetProvince = canonicalProvince(provinceName);
  const targetDivision = canonicalDivision(cityName);
  const municipality = isDirectCountyParent(targetProvince, targetDivision, hierarchy);
  const mapping = findCountyMapping(targetProvince, targetDivision, hierarchy);

  const fallback = {
    provinceName,
    provinceCode: null,
    prefectureName: mapping
      ? textOrNull(mapping.prefecture)
      : municipality
        ? null
        : cityName,
    prefectureCode: null,
    prefectureLevel: mapping?.level === 'province-administered-county-level-city'
      ? 'direct-admin'
      : municipality
        ? (targetProvince === '香港' || targetProvince === '澳门' ? 'special-administrative-region' : 'municipality')
        : 'prefecture',
    countyName: mapping ? formalCountyName(mapping.name, mapping.level) : null,
    countyCode: null,
    countyLevel: mapping ? countyLevelFor(mapping, mapping.name) : null,
    source: mapping ? 'hierarchy-map' : 'record-fallback'
  };

  const candidate = selectCompatibleCandidate(record, context);
  if (!candidate) return freezeAdministrative(fallback);

  const providerProvince = textOrNull(candidate.pname);
  const providerPrefecture = textOrNull(candidate.cityname);
  const providerCounty = textOrNull(candidate.adname);
  const adcode = validAdminCode(candidate.adcode);
  const provinceCode = validAdminCode(candidate.pcode) ?? deriveProvinceCode(adcode);
  const candidateDivision = canonicalDivision(providerPrefecture);
  const candidateCounty = canonicalDivision(providerCounty);
  const candidateMatchesTargetCounty = Boolean(providerCounty && candidateCounty === targetDivision);
  const isMappedCounty = Boolean(mapping && candidateMatchesTargetCounty);
  const isMunicipalCounty = municipality && providerCounty && !sameDivision(providerCounty, providerPrefecture);
  const shouldExposeCounty = Boolean(
    providerCounty &&
    (isMappedCounty || isMunicipalCounty || (!mapping && !municipality && candidateCounty && candidateCounty !== targetDivision))
  );

  const administrative = {
    provinceName: provinceName ?? providerProvince,
    provinceCode,
    prefectureName: municipality || mapping?.level === 'province-administered-county-level-city'
      ? null
      : mapping?.prefecture ?? (cityName ?? providerPrefecture),
    prefectureCode: municipality || mapping?.level === 'province-administered-county-level-city'
      ? null
      : derivePrefectureCode(adcode),
    prefectureLevel: municipality
      ? (targetProvince === '香港' || targetProvince === '澳门' ? 'special-administrative-region' : 'municipality')
      : mapping?.level === 'province-administered-county-level-city'
        ? 'direct-admin'
        : 'prefecture',
    countyName: shouldExposeCounty ? providerCounty : null,
    countyCode: shouldExposeCounty ? adcode : null,
    countyLevel: shouldExposeCounty
      ? countyLevelFor(mapping, providerCounty)
      : null,
    source: 'amap-admin'
  };

  /*
   * Do not let a provider candidate replace the canonical province/city
   * vocabulary. It only supplies codes and a lower-level name after exact
   * sourceRow/providerPoiId matching plus compatibility validation.
   */
  if (!administrative.provinceName) administrative.provinceName = providerProvince;
  if (!administrative.prefectureName && !municipality && mapping?.level !== 'province-administered-county-level-city') {
    administrative.prefectureName = cityName ?? providerPrefecture;
  }
  return freezeAdministrative(administrative);
}

export function buildAdministrativeBindings(records, options = {}) {
  const context = normalizeContext(options);
  return (Array.isArray(records) ? records : []).map((record) => ({
    sourceRow: record?.sourceRow ?? null,
    id: record?.id ?? null,
    administrative: bindAdministrativeRecord(record, context)
  }));
}

export const administrativeForRecord = bindAdministrativeRecord;

function normalizeContext(contextOrOptions) {
  if (contextOrOptions?.candidateIndex && contextOrOptions?.hierarchy) return contextOrOptions;
  if (contextOrOptions?.context?.candidateIndex && contextOrOptions?.context?.hierarchy) {
    return contextOrOptions.context;
  }
  return createAdministrativeBindingContext(contextOrOptions ?? {});
}

function selectCompatibleCandidate(record, context) {
  const sourceRow = normalizeSourceRow(record?.sourceRow);
  const providerPoiId = textOrNull(record?.location?.providerPoiId ?? record?.providerPoiId);
  if (sourceRow === null || !providerPoiId) return null;

  const candidates = context.candidateIndex.get(candidateKey(sourceRow, providerPoiId)) ?? [];
  for (const candidate of candidates) {
    if (!candidatePointMatches(record, candidate)) continue;
    if (!candidateCompatible(record, candidate, context.hierarchy)) continue;
    return candidate;
  }
  return null;
}

function candidateCompatible(record, candidate, hierarchy) {
  const targetProvince = canonicalProvince(record?.province);
  const providerProvince = canonicalProvince(candidate?.pname);
  if (targetProvince && providerProvince && targetProvince !== providerProvince) return false;

  const targetDivision = canonicalDivision(record?.city);
  const providerPrefecture = canonicalDivision(candidate?.cityname);
  const providerCounty = canonicalDivision(candidate?.adname);
  if (!targetDivision || !providerPrefecture) return false;

  if (isDirectCountyParent(targetProvince, targetDivision, hierarchy)) {
    return providerPrefecture === targetDivision || providerProvince === targetDivision;
  }

  const mapping = findCountyMapping(targetProvince, targetDivision, hierarchy);
  if (mapping) {
    const parentNames = new Set([
      canonicalDivision(mapping.prefecture),
      ...(Array.isArray(mapping.prefectureAliases) ? mapping.prefectureAliases.map(canonicalDivision) : [])
    ].filter(Boolean));
    return parentNames.has(providerPrefecture) && providerCounty === targetDivision;
  }

  const aliases = hierarchy.prefectureAliases.get(targetDivision) ?? new Set([targetDivision]);
  return aliases.has(providerPrefecture);
}

function candidatePointMatches(record, candidate) {
  const recordPoint = readPoint(record?.location ?? record);
  const candidatePoint = readPoint(candidate);
  if (!recordPoint || !candidatePoint) return true;
  return recordPoint.lat === candidatePoint.lat && recordPoint.lng === candidatePoint.lng;
}

function readPoint(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = numberOrNull(value.providerLat ?? value.lat);
  const lng = numberOrNull(value.providerLng ?? value.lng);
  if (lat !== null && lng !== null) return { lat, lng };
  const location = value.location;
  if (typeof location === 'string') {
    const [lngText, latText] = location.split(',').map((part) => part.trim());
    const parsedLng = numberOrNull(lngText);
    const parsedLat = numberOrNull(latText);
    if (parsedLat !== null && parsedLng !== null) return { lat: parsedLat, lng: parsedLng };
  }
  if (Array.isArray(location) && location.length >= 2) {
    const parsedLng = numberOrNull(location[0]);
    const parsedLat = numberOrNull(location[1]);
    if (parsedLat !== null && parsedLng !== null) return { lat: parsedLat, lng: parsedLng };
  }
  if (location && typeof location === 'object') {
    const parsedLat = numberOrNull(location.lat);
    const parsedLng = numberOrNull(location.lng);
    if (parsedLat !== null && parsedLng !== null) return { lat: parsedLat, lng: parsedLng };
  }
  return null;
}

function buildCandidateIndex(cache) {
  const index = new Map();
  if (!cache || typeof cache !== 'object' || !Array.isArray(cache.requests)) return index;
  for (const request of cache.requests) {
    const sourceRows = Array.isArray(request?.sourceRows)
      ? request.sourceRows.map(normalizeSourceRow).filter((row) => row !== null)
      : [];
    if (!sourceRows.length || !Array.isArray(request?.rawCandidates)) continue;
    for (const candidate of request.rawCandidates) {
      const providerPoiId = textOrNull(candidate?.id);
      if (!providerPoiId) continue;
      for (const sourceRow of sourceRows) {
        const key = candidateKey(sourceRow, providerPoiId);
        const existing = index.get(key) ?? [];
        existing.push(candidate);
        index.set(key, existing);
      }
    }
  }
  return index;
}

function buildHierarchyIndex(hierarchy) {
  const municipalities = new Set(
    (Array.isArray(hierarchy?.municipalities) ? hierarchy.municipalities : []).map(canonicalDivision).filter(Boolean)
  );
  const prefectureAliases = new Map();
  for (const [name, aliases] of Object.entries(hierarchy?.prefectureAliases ?? {})) {
    const values = new Set([canonicalDivision(name), ...(Array.isArray(aliases) ? aliases.map(canonicalDivision) : [])].filter(Boolean));
    prefectureAliases.set(canonicalDivision(name), values);
  }
  const countyMappings = new Map();
  for (const item of Array.isArray(hierarchy?.countyLevelDivisions) ? hierarchy.countyLevelDivisions : []) {
    const key = hierarchyKey(item?.province, item?.name);
    if (key) countyMappings.set(key, item);
  }
  return Object.freeze({ municipalities, prefectureAliases, countyMappings });
}

function findCountyMapping(province, division, hierarchy) {
  return hierarchy.countyMappings.get(hierarchyKey(province, division)) ?? null;
}

function isDirectCountyParent(province, division, hierarchy) {
  return DIRECT_COUNTY_PARENTS.has(province) || hierarchy.municipalities.has(division);
}

function countyLevelFor(mapping, countyName) {
  if (mapping?.level === 'county-level-city' || mapping?.level === 'province-administered-county-level-city') return 'county-city';
  if (mapping?.level === 'county-level-district') return 'county-district';
  if (mapping?.level === 'county') return 'county';
  const normalized = canonicalDivision(countyName);
  if (String(countyName).endsWith('市') || normalized.endsWith('市')) return 'county-city';
  if (String(countyName).endsWith('新区') || String(countyName).endsWith('开发区') || String(countyName).endsWith('高新区')) return 'district';
  if (String(countyName).endsWith('区') || normalized.endsWith('区')) return 'district';
  if (String(countyName).endsWith('县')) return 'county';
  return 'district';
}

function formalCountyName(name, level) {
  const text = textOrNull(name);
  if (!text) return null;
  if (level === 'county-level-city' || level === 'province-administered-county-level-city') {
    return text.endsWith('市') ? text : text + '市';
  }
  if (level === 'county-level-district') {
    return text.endsWith('区') || text.endsWith('新区') || text.endsWith('开发区') || text.endsWith('高新区')
      ? text
      : text + '区';
  }
  if (level === 'county') return text.endsWith('县') ? text : text + '县';
  return text;
}

function hierarchyKey(province, division) {
  const provinceKey = canonicalProvince(province);
  const divisionKey = canonicalDivision(division);
  return provinceKey && divisionKey ? provinceKey + '|' + divisionKey : null;
}

function candidateKey(sourceRow, providerPoiId) {
  return String(sourceRow) + '::' + String(providerPoiId);
}

function normalizeSourceRow(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function validAdminCode(value) {
  const text = textOrNull(value);
  return text && /^\d{6}$/.test(text) ? text : null;
}

function deriveProvinceCode(adcode) {
  return adcode ? adcode.slice(0, 2) + '0000' : null;
}

function derivePrefectureCode(adcode) {
  return adcode ? adcode.slice(0, 4) + '00' : null;
}

function sameDivision(left, right) {
  const leftValue = canonicalDivision(left);
  const rightValue = canonicalDivision(right);
  return Boolean(leftValue && rightValue && leftValue === rightValue);
}

function canonicalProvince(value) {
  const normalized = baseNormalize(value);
  if (!normalized) return '';
  const autonomous = new Map([
    ['内蒙古自治区', '内蒙古'],
    ['广西壮族自治区', '广西'],
    ['西藏自治区', '西藏'],
    ['宁夏回族自治区', '宁夏'],
    ['新疆维吾尔自治区', '新疆']
  ]);
  if (autonomous.has(normalized)) return autonomous.get(normalized);
  return normalized
    .replace(/(?:壮族|回族|维吾尔族|蒙古族|藏族)自治区$/g, '')
    .replace(/自治区$/g, '')
    .replace(/特别行政区$/g, '')
    .replace(/省$/g, '')
    .replace(/市$/g, '');
}

function canonicalDivision(value) {
  const normalized = baseNormalize(value);
  if (!normalized) return '';
  return normalized
    .replace(/(?:朝鲜族|蒙古族|回族|藏族|彝族|傣族|白族|哈尼族|壮族|苗族|布依族|土家族|维吾尔族|柯尔克孜族)自治州$/g, '')
    .replace(/自治州|地区|盟|特别行政区$/g, '')
    .replace(/市|县|区$/g, '');
}

function baseNormalize(value) {
  let text = String(value ?? '').normalize('NFKC').toLowerCase();
  for (const [from, to] of TRADITIONAL_TO_SIMPLIFIED) text = text.split(from.toLowerCase()).join(to.toLowerCase());
  return text.replace(/[\s\u00a0\u3000]+/g, '');
}

function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function freezeAdministrative(value) {
  const result = {};
  for (const field of ADMINISTRATIVE_FIELDS) result[field] = value?.[field] ?? null;
  return Object.freeze(result);
}

function readJsonIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}
