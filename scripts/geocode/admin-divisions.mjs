import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HIERARCHY_FILE = fileURLToPath(new URL('../../data/geocode/mainland-admin-hierarchy.json', import.meta.url));
const hierarchy = JSON.parse(fs.readFileSync(HIERARCHY_FILE, 'utf8'));

const TRADITIONAL_TO_SIMPLIFIED = new Map([
  ['臺', '台'], ['灣', '湾'], ['廣', '广'], ['場', '场'], ['聲', '声'], ['戲', '戏'],
  ['國', '国'], ['麗', '丽'], ['門', '门'], ['會', '会'], ['廳', '厅'], ['燈', '灯'],
  ['龍', '龙'], ['樂', '乐'], ['萬', '万'], ['華', '华'], ['銀', '银'], ['電', '电'],
  ['館', '馆'], ['學', '学'], ['術', '术'], ['濟', '济'], ['發', '发'], ['開', '开'], ['業', '业'], ['閉', '闭']
]);

const countyByName = new Map(hierarchy.countyLevelDivisions.map((item) => [canonicalDivision(item.name), item]));
const municipalities = new Set(hierarchy.municipalities.map(canonicalDivision));

function baseNormalize(value) {
  let text = String(value ?? '').normalize('NFKC').toLowerCase();
  for (const [from, to] of TRADITIONAL_TO_SIMPLIFIED) text = text.split(from.toLowerCase()).join(to.toLowerCase());
  return text.replace(/[\s\u00a0\u3000]+/g, '');
}

export function canonicalProvince(value) {
  const normalized = baseNormalize(value);
  const autonomous = new Map([
    ['内蒙古自治区', '内蒙古'],
    ['广西壮族自治区', '广西'],
    ['西藏自治区', '西藏'],
    ['宁夏回族自治区', '宁夏'],
    ['新疆维吾尔自治区', '新疆']
  ]);
  if (autonomous.has(normalized)) return autonomous.get(normalized);
  return normalized.replace(/特别行政区|省|市$/g, '');
}

export function canonicalDivision(value) {
  return baseNormalize(value).replace(/特别行政区|自治州|地区|盟|市|县|区$/g, '');
}

function exactAliasMatch(value, aliases) {
  const target = baseNormalize(value);
  return aliases.some((alias) => baseNormalize(alias) === target || canonicalDivision(alias) === canonicalDivision(value));
}

export function countyDivisionFor(city) {
  return countyByName.get(canonicalDivision(city)) ?? null;
}

export function isCountyLevelTarget(city) {
  return countyByName.has(canonicalDivision(city));
}

export function adminCompatibility(record, candidate) {
  const targetCity = canonicalDivision(record.city);
  const targetProvince = canonicalProvince(record.province);
  const providerProvince = canonicalProvince(candidate.pname);
  const providerPrefecture = canonicalDivision(candidate.cityname);
  const providerCounty = canonicalDivision(candidate.adname);
  const mapping = countyByName.get(targetCity) ?? null;
  const provinceMatch = Boolean(targetProvince && providerProvince && targetProvince === providerProvince);
  const candidateText = [candidate.pname, candidate.cityname, candidate.adname, candidate.address, candidate.name].map(baseNormalize);

  if (municipalities.has(targetCity)) {
    const municipalityMatch = [candidate.pname, candidate.cityname].some((value) => canonicalDivision(value) === targetCity);
    return {
      provinceMatch: municipalityMatch,
      prefectureMatch: municipalityMatch,
      countyMatch: null,
      targetLevel: 'municipality',
      compatible: municipalityMatch,
      targetProvince: targetCity,
      targetPrefecture: targetCity,
      targetCounty: null,
      providerProvince,
      providerPrefecture,
      providerCounty,
      mappingSource: 'municipality-rule'
    };
  }

  if (mapping) {
    const prefectureAliases = mapping.prefectureAliases ?? [mapping.prefecture];
    const prefectureMatch = exactAliasMatch(candidate.cityname, prefectureAliases);
    const countyMatch = providerCounty === targetCity;
    const mappingProvinceMatch = canonicalProvince(mapping.province) === targetProvince;
    return {
      provinceMatch,
      prefectureMatch,
      countyMatch,
      targetLevel: mapping.level,
      compatible: provinceMatch && mappingProvinceMatch && prefectureMatch && countyMatch,
      targetProvince,
      targetPrefecture: canonicalDivision(mapping.prefecture),
      targetCounty: targetCity,
      providerProvince,
      providerPrefecture,
      providerCounty,
      mappingSource: 'data/geocode/mainland-admin-hierarchy.json'
    };
  }

  const aliases = hierarchy.prefectureAliases?.[record.city] ?? [record.city];
  const textFallback = !candidate.cityname && candidateText.some((value) => aliases.some((alias) => value.includes(baseNormalize(alias))));
  const prefectureMatch = exactAliasMatch(candidate.cityname, aliases) || textFallback;
  return {
    provinceMatch,
    prefectureMatch,
    countyMatch: null,
    targetLevel: 'prefecture',
    compatible: provinceMatch && prefectureMatch,
    targetProvince,
    targetPrefecture: targetCity,
    targetCounty: null,
    providerProvince,
    providerPrefecture,
    providerCounty,
    mappingSource: hierarchy.prefectureAliases?.[record.city] ? 'prefecture-alias' : 'prefecture-rule'
  };
}

export function adminHierarchyAudit() {
  return {
    schemaVersion: hierarchy.schemaVersion,
    verifiedAt: hierarchy.verifiedAt,
    mappingFile: 'data/geocode/mainland-admin-hierarchy.json',
    countyLevelDivisionCount: hierarchy.countyLevelDivisions.length,
    municipalities: [...hierarchy.municipalities],
    provenance: hierarchy.provenance
  };
}
