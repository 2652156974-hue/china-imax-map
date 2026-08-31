import { amapCoordinate } from './crs.mjs';
import { adminCompatibility } from './admin-divisions.mjs';

const TRADITIONAL_TO_SIMPLIFIED = new Map([
  ['臺', '台'], ['灣', '湾'], ['廣', '广'], ['場', '场'], ['聲', '声'], ['戲', '戏'],
  ['國', '国'], ['麗', '丽'], ['門', '门'], ['會', '会'], ['廳', '厅'], ['燈', '灯'],
  ['龍', '龙'], ['樂', '乐'], ['萬', '万'], ['華', '华'], ['銀', '银'], ['電', '电'],
  ['館', '馆'], ['學', '学'], ['術', '术'], ['濟', '济'], ['發', '发'], ['開', '开'], ['業', '业'], ['閉', '闭']
]);

const GENERIC_TERMS = [
  'imax', 'laser', 'commercial', 'xenon', 'dome', 'gt', 'xt', 'sr', '3d', '4k', '12声道', '影厅', '影院',
  '影城', '电影院', '电影城', '戏院', '国际影城', '店', '旗舰店', '激光', '氙灯', '双激光', '光美',
  '电影', 'cinema', 'cinemas', 'theatre', 'theater', '巨幕'
];
const DEVICE_TERMS = /imax|laser|commercial|xenon|dome|\bgt\b|\bxt\b|\bsr\b|3d|4k|激光|氙灯|氙燈|声道|聲道|巨幕/gi;
const BRAND_TERMS = [
  '幸福蓝海', '万达影城', '万达', '金逸影城', '金逸', 'cgv', '百丽宫', '寰映', '英皇电影城', '英皇',
  '美亚', '飞扬', '中影紫荆', '中影', '博纳', '卢米埃', '保利', '嘉禾', '百老汇', 'ume', '华谊', '越界',
  '橙天嘉禾', '橙天', '大地', '横店', '万象影城', '儒意', '浙影时代', '新远国际', '星美'
];
const INSTITUTION_TERMS = ['博物馆', '科技馆', '科学技术馆', '科学馆', '天文馆', '科技中心'];
const CINEMA_TYPE_CODES = new Set(['080601']);
const MALL_TYPE_CODES = new Set(['060100', '060101', '060102']);
const VENUE_TYPE_CODES = new Set(['140100', '140600', '140800']);
const NON_TARGET_NAME = /私人影院|自助影院|影吧|游戏机|摇杆|飞行影院|裸眼\s*9d|4d影院|好运椰|咖啡|餐厅|蛋包饭|造型|美容|美发|健身|酒店|便利店|金店|服装|棋牌|停车场|药房|同仁堂|manner/i;
const DOME_FORMAT = /dome|球幕|穹顶/i;
const FOUR_D_FORMAT = /(?:^|[^a-z0-9])4d(?:[^a-z0-9]|$)|4d影院|4d影厅/i;
const XD_FORMAT = /(?:^|[^a-z0-9])xd(?:[^a-z0-9]|$)|xd影院|xd影厅/i;
const GT_FORMAT = /(?:^|[^a-z0-9])gt(?:[^a-z0-9]|$)|imaxgt|gt巨幕/i;
const GIANT_SCREEN_FORMAT = /巨幕/i;
const AUDITORIUM_TERM = /影厅|影廳|放映厅|放映廳|球幕影院|穹顶影院|穹頂影院|dome/i;

export function normalizeText(value) {
  let text = String(value ?? '').normalize('NFKC').toLowerCase();
  for (const [from, to] of TRADITIONAL_TO_SIMPLIFIED) text = text.split(from.toLowerCase()).join(to.toLowerCase());
  return text.replace(/[\s\u00a0\u3000]+/g, '').replace(/[（）]/g, (character) => character === '（' ? '(' : ')');
}

export function canonicalCity(value) {
  return normalizeText(value).replace(/特别行政区|自治州|自治区|市$/g, '');
}

function sourceText(record) {
  return [record.name, record.nameRaw, ...(record.formerNames ?? [])].filter(Boolean).join(' ');
}

function sourceIsInstitution(record) {
  const text = normalizeText(sourceText(record));
  return INSTITUTION_TERMS.some((term) => text.includes(normalizeText(term)));
}

function sourceProjectionText(record) {
  return normalizeText([record.projection?.raw, record.projection?.system, record.projection?.technology].filter(Boolean).join(' '));
}

function candidateText(candidate) {
  return [candidate.name, candidate.address, candidate.type, candidate.pname, candidate.cityname, candidate.adname].filter(Boolean).join(' ');
}

function typeCodes(candidate) {
  return String(candidate.typecode ?? '').match(/\d{6}/g) ?? [];
}

export function classifyPoi(record, candidate) {
  const codes = typeCodes(candidate);
  if (codes.some((code) => CINEMA_TYPE_CODES.has(code))) return 'cinema';
  if (codes.some((code) => MALL_TYPE_CODES.has(code))) return 'mall';
  if (sourceIsInstitution(record) && codes.some((code) => VENUE_TYPE_CODES.has(code))) return 'venue';
  return 'other';
}

function removeTerms(value, terms) {
  let result = normalizeText(value);
  for (const term of terms) result = result.split(normalizeText(term)).join('');
  return result;
}

function stripPunctuation(value) {
  return normalizeText(value).replace(/[()（）·•.,，。:：;；\-—–_/\\'"“”‘’]/g, '');
}

function citylessName(value, record) {
  let text = stripPunctuation(value);
  for (const place of [record.city, record.province, '中国大陆', '香港', '澳门', '台湾']) {
    const normalized = normalizeText(place);
    if (normalized && text.startsWith(normalized)) text = text.slice(normalized.length);
  }
  return text;
}

function identityName(value, record) {
  return removeTerms(citylessName(value, record).replace(DEVICE_TERMS, ''), GENERIC_TERMS).replace(/[^a-z0-9\u3400-\u9fff]/g, '');
}

function diceSimilarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(1, 0.72 + Math.min(a.length, b.length) / Math.max(a.length, b.length) * 0.28);
  const grams = (value) => new Set(value.length < 2 ? [value] : [...Array(value.length - 1)].map((_, index) => value.slice(index, index + 2)));
  const leftGrams = grams(a);
  const rightGrams = grams(b);
  const intersection = [...leftGrams].filter((gram) => rightGrams.has(gram)).length;
  return (2 * intersection) / (leftGrams.size + rightGrams.size);
}

function brandFor(record) {
  const currentNameHead = normalizeText(String(record.name ?? '').split(/[（(]/)[0]);
  const primary = BRAND_TERMS.find((brand) => currentNameHead.includes(normalizeText(brand)));
  if (primary) return primary;
  const text = normalizeText(sourceText(record));
  return BRAND_TERMS.find((brand) => text.includes(normalizeText(brand)) && !projectTokens(record).some((project) => project.includes(normalizeText(brand)))) ?? '';
}

function cleanProject(value) {
  let text = String(value ?? '').replace(DEVICE_TERMS, ' ').replace(/\b(?:imax|gt|xt|sr|dome|laser)\b/gi, ' ');
  text = text.replace(/(?:旗舰)?店$/i, '').replace(/影城|影院|电影院|电影城/gi, ' ').replace(/\s+/g, ' ').trim();
  return stripPunctuation(text);
}

function projectTokens(record) {
  const text = String(record.name ?? '');
  const values = [...text.matchAll(/[（(]([^）)]*)[）)]/g)].map((match) => match[1]);
  const separator = text.match(/[·•]\s*(.+)$/);
  if (separator) values.push(separator[1]);
  const tokens = [];
  for (const value of values) {
    const cleaned = cleanProject(value);
    if (!cleaned || cleaned.length < 2 || /^(?:imax|激光|氙灯|声道|3d)+$/i.test(cleaned)) continue;
    if (!tokens.includes(cleaned)) tokens.push(cleaned);
  }
  return tokens;
}

function cityEvidence(record, candidate) {
  const adminMatch = adminCompatibility(record, candidate);
  const target = canonicalCity(record.city);
  return {
    exact: adminMatch.compatible,
    address: Boolean(target && normalizeText(candidate.address).includes(target)),
    clearlyDifferent: !adminMatch.compatible,
    adminMatch
  };
}

function projectionMatch(record, candidate) {
  const source = sourceProjectionText(record);
  const target = normalizeText(`${candidate.name ?? ''} ${candidate.type ?? ''}`);
  const hints = [];
  if (/gt/.test(source) && /gt/.test(target)) hints.push('gt');
  if (/dome|球幕/.test(source) && /dome|球幕/.test(target)) hints.push('dome');
  if (/imax/.test(source) && /imax/.test(target)) hints.push('imax');
  if (/xt/.test(source) && /xt/.test(target)) hints.push('xt');
  return hints;
}

function testFormat(pattern, value) {
  return pattern.test(String(value ?? '').normalize('NFKC').toLowerCase());
}

export function sourceAuditoriumFormat(record) {
  const text = [record.projection?.raw, record.projection?.system, record.projection?.technology, record.projection?.geometry]
    .filter(Boolean)
    .join(' ');
  const normalized = normalizeText(text);
  const dome = record.projection?.dome === true || testFormat(DOME_FORMAT, text);
  const gt = testFormat(GT_FORMAT, text) || normalizeText(record.projection?.geometry) === 'gt' || normalizeText(record.projection?.system).includes('gtlaser');
  const fourD = testFormat(FOUR_D_FORMAT, text);
  const xd = testFormat(XD_FORMAT, text);
  return {
    imax: normalized.includes('imax') || gt || dome,
    gt,
    dome,
    fourD,
    xd,
    explicitlyNonDome: record.projection?.dome === false && (normalized.includes('imax') || gt)
  };
}

export function candidateAuditoriumFormat(candidate) {
  const name = String(candidate.name ?? '');
  const normalized = normalizeText(name);
  const dome = testFormat(DOME_FORMAT, name);
  const gt = testFormat(GT_FORMAT, name);
  const giantScreen = testFormat(GIANT_SCREEN_FORMAT, name);
  const fourD = testFormat(FOUR_D_FORMAT, name);
  const xd = testFormat(XD_FORMAT, name);
  const imax = normalized.includes('imax');
  const explicitAuditorium = testFormat(AUDITORIUM_TERM, name) || dome || gt || giantScreen || fourD || xd;
  return {
    imax,
    gt,
    dome,
    giantScreen,
    fourD,
    xd,
    ordinaryImax: imax && !gt && !dome && !fourD && !xd,
    explicitAuditorium
  };
}

export function auditoriumFormatCompatibility(record, candidate) {
  const source = sourceAuditoriumFormat(record);
  const target = candidateAuditoriumFormat(candidate);
  const conflicts = [];

  if (source.imax && !source.fourD && !source.xd && (target.fourD || target.xd)) {
    conflicts.push('imax-vs-4d-xd-sibling');
  }
  if (source.dome && target.explicitAuditorium && !target.dome && (target.gt || target.giantScreen || target.ordinaryImax)) {
    conflicts.push('dome-vs-non-dome-auditorium');
  }
  if (!source.dome && source.explicitlyNonDome && target.dome) {
    conflicts.push('non-dome-vs-dome-auditorium');
  }
  if (source.gt && !source.dome && target.explicitAuditorium && target.ordinaryImax && !target.gt && !target.giantScreen) {
    conflicts.push('gt-vs-ordinary-imax-auditorium');
  }

  const exactFormatMatch = (source.dome && target.dome)
    || (source.gt && target.gt && !target.dome)
    || (!source.dome && !source.gt && source.imax && target.ordinaryImax);
  return { source, candidate: target, compatible: conflicts.length === 0, exactFormatMatch, conflicts };
}

function component(weight, value, applicable, reason) {
  return { weight, value: Number(value.toFixed(6)), applicable: Boolean(applicable), reason };
}

function normalizedScore(components) {
  const applicable = Object.values(components).filter((item) => item.applicable);
  const denominator = applicable.reduce((sum, item) => sum + item.weight, 0);
  if (!denominator) return 0;
  return Number((applicable.reduce((sum, item) => sum + item.weight * item.value, 0) / denominator).toFixed(6));
}

function geocodeSource(positionType) {
  if (positionType === 'mall-fallback') return 'amap:mall-fallback';
  if (positionType === 'venue-poi') return 'amap:venue-poi';
  return positionType === 'cinema-poi' ? 'amap:poi-search' : '';
}

function granularityFor(kind, format) {
  if (kind === 'mall') return 'mall';
  if (format.candidate.explicitAuditorium) return 'auditorium';
  if (kind === 'venue') return 'venue';
  if (kind === 'cinema') return 'cinema';
  return null;
}

function distanceMeters(left, right) {
  if (!left || !right) return Infinity;
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(right.providerLat - left.providerLat);
  const dLng = radians(right.providerLng - left.providerLng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(left.providerLat)) * Math.cos(radians(right.providerLat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function scoreCandidate(record, candidate) {
  const city = cityEvidence(record, candidate);
  const kind = classifyPoi(record, candidate);
  const institution = sourceIsInstitution(record);
  const brand = brandFor(record);
  const candidateNorm = normalizeText(candidateText(candidate));
  const candidateNameNorm = normalizeText(candidate.name);
  const brandMatch = brand ? candidateNameNorm.includes(normalizeText(brand)) : false;
  const projects = projectTokens(record);
  const matchedProjects = projects.filter((project) => candidateNorm.includes(project));
  const projectScore = projects.length ? Math.max(...projects.map((project) => {
    const candidateProjectText = cleanProject(`${candidate.name ?? ''} ${candidate.address ?? ''}`);
    return candidateProjectText.includes(project) ? 1 : diceSimilarity(project, candidateProjectText);
  })) : 0;
  const currentIdentity = identityName(record.name, record);
  const candidateIdentity = identityName(candidate.name, record);
  const nameScore = diceSimilarity(currentIdentity, candidateIdentity);
  const formerMatches = (record.formerNames ?? []).filter((name) => diceSimilarity(identityName(name, record), candidateIdentity) >= 0.82);
  const districtApplicable = Boolean(record.district);
  const districtMatch = districtApplicable && normalizeText(candidate.adname) === normalizeText(record.district);
  const typeScore = kind === 'cinema' ? 1 : kind === 'venue' ? 0.95 : kind === 'mall' ? 0.8 : 0;
  const projectionHints = projectionMatch(record, candidate);
  const formatCompatibility = auditoriumFormatCompatibility(record, candidate);
  const locationGranularity = granularityFor(kind, formatCompatibility);
  const structurallyStrongName = nameScore >= 0.9 || (brandMatch && projects.length > 0 && projectScore >= 0.9);
  const components = {
    cityExact: component(0.24, city.exact ? 1 : 0, true, 'required'),
    district: component(0.08, districtMatch ? 1 : 0, districtApplicable, districtApplicable ? 'source-district-present' : 'not-applicable'),
    brand: component(0.16, brandMatch ? 1 : 0, Boolean(brand), brand ? 'source-brand-present' : 'not-applicable'),
    project: component(0.20, projectScore, projects.length > 0, projects.length ? 'source-project-present' : 'not-applicable'),
    currentName: component(0.28, nameScore, true, 'required'),
    formerName: component(0.08, 1, formerMatches.length > 0, formerMatches.length ? 'positive-evidence' : 'not-applicable'),
    poiType: component(0.12, typeScore, true, 'required'),
    addressCity: component(0.06, 1, city.address, city.address ? 'positive-evidence' : 'not-applicable'),
    projection: component(0.05, 1, projectionHints.length > 0, projectionHints.length ? 'positive-evidence' : 'not-applicable')
  };
  let score = normalizedScore(components);
  const providerCoordinate = amapCoordinate(candidate);
  const hardRejects = [];
  if (city.clearlyDifferent || !city.exact) hardRejects.push('city-mismatch');
  if (!providerCoordinate) hardRejects.push('invalid-location');
  if (kind === 'other') hardRejects.push('non-cinema-poi');
  if (kind === 'mall' && !(projects.length && matchedProjects.length && city.exact)) hardRejects.push('mall-fallback-not-qualified');
  if (kind === 'venue' && !(institution && nameScore >= 0.88)) hardRejects.push('venue-not-qualified');
  if (kind === 'cinema' && NON_TARGET_NAME.test(candidateNameNorm)) hardRejects.push('non-target-business-name');
  if (!formatCompatibility.compatible) hardRejects.push('auditorium-format-conflict');
  if (kind === 'cinema' && brand && !brandMatch && nameScore < 0.9 && !formerMatches.length) hardRejects.push('brand-mismatch');
  if (kind === 'cinema' && projects.length && projectScore < 0.72 && nameScore < 0.92 && !formerMatches.length) hardRejects.push('project-mismatch');
  const positionType = kind === 'cinema' ? 'cinema-poi' : kind === 'venue' ? 'venue-poi' : kind === 'mall' ? 'mall-fallback' : null;
  const qualifiedMallFallback = positionType === 'mall-fallback' && hardRejects.length === 0 && city.exact && matchedProjects.length > 0;
  if (positionType === 'mall-fallback') score = Math.min(Math.max(score, qualifiedMallFallback ? 0.78 : 0), 0.89);
  const locationBlockingRejects = hardRejects.filter((reason) => reason !== 'auditorium-format-conflict' && reason !== 'non-target-business-name');
  const deterministicLocationHigh = locationBlockingRejects.length === 0 && city.exact && (
    (kind === 'cinema' && (institution || !brand || brandMatch) && (!projects.length || projectScore >= 0.9) && structurallyStrongName) ||
    (kind === 'venue' && institution && nameScore >= 0.9)
  );
  const auditoriumIdentityExact = locationGranularity !== 'auditorium'
    || (!formatCompatibility.source.dome && !formatCompatibility.source.gt)
    || formatCompatibility.exactFormatMatch;
  const deterministicIdentityHigh = hardRejects.length === 0
    && kind === 'cinema'
    && auditoriumIdentityExact
    && structurallyStrongName
    && (institution || !brand || brandMatch)
    && (!projects.length || projectScore >= 0.9);
  if (deterministicLocationHigh || deterministicIdentityHigh) score = Math.max(score, 0.92);
  score = Number(score.toFixed(6));
  const locationConfidence = !providerCoordinate || !city.exact || locationBlockingRejects.length
    ? 'unknown'
    : deterministicLocationHigh || (kind === 'cinema' && score >= 0.9) || (kind === 'venue' && institution && nameScore >= 0.9)
      ? 'high'
      : score >= 0.78
        ? 'medium'
        : 'unknown';
  const identityConfidence = formatCompatibility.conflicts.length
    ? 'low'
    : hardRejects.length
      ? 'unknown'
      : locationGranularity === 'venue' || locationGranularity === 'mall'
        ? 'medium'
        : deterministicIdentityHigh || (score >= 0.9 && auditoriumIdentityExact)
          ? 'high'
          : score >= 0.78
            ? 'medium'
            : 'unknown';
  const decision = hardRejects.length
    ? 'rejected'
    : locationConfidence === 'high' && identityConfidence === 'high' && (deterministicIdentityHigh || score >= 0.9)
      ? 'accepted-high'
      : score >= 0.78 && locationConfidence !== 'unknown' && identityConfidence !== 'unknown'
        ? 'review-required-medium'
        : 'unresolved';
  return {
    poiId: candidate.id ?? null,
    name: candidate.name ?? '',
    address: candidate.address ?? '',
    type: candidate.type ?? '',
    typecode: candidate.typecode ?? '',
    pname: candidate.pname ?? '',
    cityname: candidate.cityname ?? '',
    adname: candidate.adname ?? '',
    providerLat: providerCoordinate?.providerLat ?? null,
    providerLng: providerCoordinate?.providerLng ?? null,
    providerCrs: providerCoordinate?.providerCrs ?? 'GCJ-02',
    lat: providerCoordinate?.lat ?? null,
    lng: providerCoordinate?.lng ?? null,
    mapCrs: providerCoordinate?.mapCrs ?? 'WGS84',
    location: providerCoordinate ? { lat: providerCoordinate.lat, lng: providerCoordinate.lng } : null,
    poiKind: kind,
    positionType,
    locationGranularity,
    geocodeSource: geocodeSource(positionType),
    confidence: decision === 'accepted-high' ? 'high' : decision === 'review-required-medium' ? 'medium' : 'unknown',
    locationConfidence,
    identityConfidence,
    score,
    deterministicHigh: deterministicIdentityHigh,
    deterministicLocationHigh,
    deterministicIdentityHigh,
    components,
    matchedProjectTokens: matchedProjects,
    projectTokens: projects,
    nameScore: Number(nameScore.toFixed(6)),
    structurallyStrongName,
    brand,
    brandMatch,
    formerMatches,
    projectionHints,
    formatCompatibility,
    adminMatch: city.adminMatch,
    hardRejects: [...new Set(hardRejects)],
    decision
  };
}

export function rankCandidates(record, candidates) {
  return candidates.map((candidate) => scoreCandidate(record, candidate)).sort((left, right) => {
    if (left.hardRejects.length !== right.hardRejects.length) return left.hardRejects.length - right.hardRejects.length;
    return right.score - left.score;
  });
}

function samePhysicalPlace(left, right) {
  if (left.poiId && right.poiId && left.poiId === right.poiId) return true;
  return distanceMeters(left, right) <= 25 && diceSimilarity(left.name, right.name) >= 0.55;
}

export function chooseCandidate(record, candidates) {
  const ranked = rankCandidates(record, candidates);
  const eligible = ranked.filter((candidate) => candidate.hardRejects.length === 0 && candidate.score >= 0.78);
  const top = eligible[0] ?? null;
  if (!top) return { selected: null, ranked, ambiguity: { evaluatedCandidates: eligible.length, ignoredHardRejected: ranked.length - eligible.length, trueAmbiguity: false } };
  const competing = eligible.slice(1).find((candidate) => top.score - candidate.score < 0.05 && !samePhysicalPlace(top, candidate));
  if (competing) {
    return {
      selected: { ...top, decision: 'review-required-ambiguous', confidence: 'medium', identityConfidence: 'medium', ambiguity: `competing-poi:${competing.poiId ?? competing.name}` },
      ranked,
      ambiguity: { evaluatedCandidates: eligible.length, ignoredHardRejected: ranked.length - eligible.length, trueAmbiguity: true, competingPoiId: competing.poiId }
    };
  }
  return { selected: top, ranked, ambiguity: { evaluatedCandidates: eligible.length, ignoredHardRejected: ranked.length - eligible.length, trueAmbiguity: false } };
}

export function isGenericOnlyQuery(query) {
  return removeTerms(query, GENERIC_TERMS).replace(/[^a-z0-9\u3400-\u9fff]/g, '').length < 2;
}

export function sourceProjectTokens(record) {
  return projectTokens(record);
}

export function sourceBrand(record) {
  return brandFor(record);
}
