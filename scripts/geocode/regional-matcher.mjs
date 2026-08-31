import { normalizeText } from './scoring.mjs';

const GENERIC_TERMS = [
  'imax', 'laser', 'commercial', 'xenon', 'dome', 'gt', 'xt', 'sr', '3d',
  '4k', '12声道', '影厅', '影廳', '影院', '影城', '戲院', '戏院',
  '电影院', '電影院', '电影城', '電影城', '国际影城', '國際影城',
  'cinema', 'cinemas', 'theatre', 'theater', '店', '旗舰店', '旗艦店',
  '激光', '氙灯', '氙燈', '双激光', '雙激光', '巨幕'
];

const CITY_ALIASES = new Map([
  ['香港', ['香港', 'hong kong', 'hongkong']],
  ['澳门', ['澳门', '澳門', 'macau', 'macao']],
  ['台北', ['台北', '臺北', 'taipei']],
  ['台中', ['台中', '臺中', 'taichung']],
  ['新竹', ['新竹', 'hsinchu']],
  ['台南', ['台南', '臺南', 'tainan']],
  ['桃园', ['桃园', '桃園', 'taoyuan']],
  ['花莲', ['花莲', '花蓮', 'hualien']],
  ['嘉义', ['嘉义', '嘉義', 'chiayi']],
  ['高雄', ['高雄', 'kaohsiung']],
  ['新北', ['新北', 'new taipei', 'newtaipei']],
  ['基隆', ['基隆', 'keelung']]
]);

const CINEMA_TYPES = new Set(['cinema']);
const VENUE_TYPES = new Set([
  'museum', 'theatre', 'arts_centre', 'attraction', 'airport',
  'public_building', 'stadium', 'science', 'planetarium'
]);
const MALL_TYPES = new Set(['mall', 'commercial']);
const INSTITUTION_PATTERN = /博物馆|博物館|科技馆|科技館|太空馆|太空館|机场|機場|museum|space museum|airport/i;

export function regionalCityAliases(city) {
  const normalized = normalizeText(city);
  return CITY_ALIASES.get(normalized) ?? [city];
}

function compact(value) {
  return normalizeText(value).replace(/[()[\]{}·•.,，。:：;；\-—–_/\\'"“”‘’\s]/g, '');
}

function candidateAddressText(candidate) {
  const address = candidate.address && typeof candidate.address === 'object'
    ? Object.values(candidate.address).join(' ')
    : String(candidate.address ?? '');
  return [
    candidate.name,
    candidate.display_name,
    candidate.type,
    candidate.class,
    address
  ].filter(Boolean).join(' ');
}

function sourceText(record) {
  return [
    record.name,
    record.nameRaw,
    ...(record.formerNames ?? [])
  ].filter(Boolean).join(' ');
}

function sourceIsInstitution(record) {
  return INSTITUTION_PATTERN.test(sourceText(record));
}

function stripGeneric(value, record) {
  let text = compact(value);
  for (const term of GENERIC_TERMS) text = text.split(compact(term)).join('');
  for (const place of [record.city, record.province, record.region]) {
    const placeText = compact(place);
    if (placeText) text = text.split(placeText).join('');
  }
  return text;
}

function bigrams(value) {
  if (value.length < 2) return new Set(value ? [value] : []);
  return new Set([...Array(value.length - 1)].map((_, index) => value.slice(index, index + 2)));
}

function diceSimilarity(left, right) {
  const a = stripGeneric(left, { city: '', province: '', region: '' });
  const b = stripGeneric(right, { city: '', province: '', region: '' });
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.82 + 0.18 * Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const leftGrams = bigrams(a);
  const rightGrams = bigrams(b);
  const intersection = [...leftGrams].filter((gram) => rightGrams.has(gram)).length;
  return leftGrams.size + rightGrams.size
    ? (2 * intersection) / (leftGrams.size + rightGrams.size)
    : 0;
}

function projectTokens(record) {
  return [...String(record.name ?? '').matchAll(/[（(]([^）)]*)[）)]/g)]
    .map((match) => compact(match[1]))
    .filter((token) => token.length >= 2)
    .filter((token) => !GENERIC_TERMS.some((term) => token === compact(term)));
}

function cityMatch(record, candidate) {
  const text = compact(candidateAddressText(candidate));
  return regionalCityAliases(record.city).some((alias) => text.includes(compact(alias)));
}

function classifyCandidate(record, candidate) {
  const type = normalizeText(candidate.type);
  const category = normalizeText(candidate.class);
  const text = candidateAddressText(candidate);
  if (CINEMA_TYPES.has(type) || type.includes('cinema')) return 'cinema';
  if (sourceIsInstitution(record) && VENUE_TYPES.has(type)) return 'venue';
  if (MALL_TYPES.has(type) && /mall|shopping|广场|廣場|商场|商場/i.test(text)) return 'mall';
  if (sourceIsInstitution(record) && category === 'tourism' && /museum|馆|館/i.test(text)) return 'venue';
  return 'other';
}

function projectMatch(record, candidate) {
  const text = compact(candidateAddressText(candidate));
  const tokens = projectTokens(record);
  return tokens.length > 0 && tokens.some((token) => text.includes(token)) ? 1 : 0;
}

function candidateNameSimilarity(record, candidate) {
  const source = stripGeneric(sourceText(record), record);
  const target = stripGeneric(candidate.name || candidate.display_name || '', record);
  const fullTarget = compact(candidateAddressText(candidate));
  if (!source || !target) return 0;
  if (fullTarget.includes(source) || source.includes(target)) return 1;
  return diceSimilarity(source, target);
}

function candidateCoordinates(candidate) {
  const lat = Number(candidate.lat);
  const lng = Number(candidate.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    ? { lat, lng }
    : null;
}

function candidateId(candidate) {
  if (candidate.osm_type && candidate.osm_id !== undefined) {
    return 'nominatim:' + candidate.osm_type + ':' + candidate.osm_id;
  }
  return null;
}

export function scoreRegionalCandidate(record, candidate) {
  const kind = classifyCandidate(record, candidate);
  const coordinates = candidateCoordinates(candidate);
  const hasCity = cityMatch(record, candidate);
  const nameSimilarity = candidateNameSimilarity(record, candidate);
  const project = projectMatch(record, candidate);
  const hardRejects = [];

  if (!hasCity) hardRejects.push('city-mismatch');
  if (kind === 'other') hardRejects.push('non-target-poi-type');
  if (!coordinates) hardRejects.push('invalid-coordinate');
  if (nameSimilarity < (kind === 'venue' ? 0.22 : 0.35)) hardRejects.push('name-mismatch');

  const typeScore = kind === 'cinema' ? 1 : kind === 'venue' ? 0.7 : kind === 'mall' ? 0.55 : 0;
  const score = Number((
    0.30 * (hasCity ? 1 : 0) +
    0.25 * typeScore +
    0.35 * nameSimilarity +
    0.10 * project
  ).toFixed(6));

  return {
    poiId: candidateId(candidate),
    name: candidate.name || candidate.display_name || '',
    address: candidate.display_name || '',
    type: candidate.type || '',
    class: candidate.class || '',
    osmType: candidate.osm_type || null,
    osmId: candidate.osm_id ?? null,
    kind,
    score,
    cityMatch: hasCity,
    nameSimilarity: Number(nameSimilarity.toFixed(6)),
    projectMatch: project === 1,
    hardRejects,
    provider: coordinates
      ? { providerCrs: 'WGS84', providerLat: coordinates.lat, providerLng: coordinates.lng }
      : null,
    _raw: candidate
  };
}

function publicCandidate(candidate, decision = null) {
  const { _raw, ...safeCandidate } = candidate;
  return {
    ...safeCandidate,
    decision,
    positionType: candidate.kind === 'cinema' ? 'cinema-poi'
      : candidate.kind === 'venue' ? 'venue-poi'
      : candidate.kind === 'mall' ? 'mall-fallback' : null,
    locationGranularity: candidate.kind === 'cinema' ? 'cinema'
      : candidate.kind === 'venue' ? 'venue'
      : candidate.kind === 'mall' ? 'mall' : null,
    locationConfidence: decision === 'accepted-high' ? 'high' : 'medium',
    identityConfidence: decision === 'accepted-high' && candidate.kind === 'cinema'
      ? 'high' : 'medium',
    geocodeSource: 'nominatim:search',
    map: candidate.provider
      ? { mapCrs: 'WGS84', lat: candidate.provider.providerLat, lng: candidate.provider.providerLng }
      : null
  };
}

export function chooseRegionalCandidate(record, rawCandidates) {
  const deduped = new Map();
  for (const candidate of rawCandidates ?? []) {
    const scored = scoreRegionalCandidate(record, candidate);
    const key = scored.poiId || (compact(scored.name) + '|' +
      (scored.provider?.providerLng ?? '') + ',' + (scored.provider?.providerLat ?? ''));
    if (!deduped.has(key) || deduped.get(key).score < scored.score) deduped.set(key, scored);
  }
  const ranked = [...deduped.values()].sort((left, right) => right.score - left.score);
  const accepted = ranked.filter((candidate) => candidate.hardRejects.length === 0);
  const top = accepted[0] ?? ranked[0] ?? null;
  const second = accepted[1] ?? null;
  const trueAmbiguity = Boolean(top && second && Math.abs(top.score - second.score) < 0.08);
  let decision = 'unresolved';
  if (top && top.hardRejects.length === 0 && !trueAmbiguity) {
    if (top.kind === 'cinema' && top.score >= 0.86 && top.nameSimilarity >= 0.78) {
      decision = 'accepted-high';
    } else if (top.score >= 0.58) {
      decision = 'review-required-medium';
    }
  } else if (top && top.hardRejects.length === 0 && trueAmbiguity && top.score >= 0.58) {
    decision = 'review-required-medium';
  }
  const selected = decision === 'unresolved' ? null : publicCandidate(top, decision);
  return {
    decision,
    selected,
    topCandidate: top ? publicCandidate(top, top === accepted[0] ? decision : 'rejected') : null,
    rankedCandidates: ranked.map((candidate) => publicCandidate(candidate,
      candidate === top ? decision : candidate.hardRejects.length ? 'rejected' : null)),
    trueAmbiguity,
    evaluatedCandidates: accepted.length,
    ignoredHardRejected: ranked.length - accepted.length,
    hardRejectReasons: countReasons(ranked.flatMap((candidate) => candidate.hardRejects))
  };
}

function countReasons(reasons) {
  const counts = {};
  for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}

export function compactRegionalAuditResult(result) {
  return {
    selected: result.selected,
    topCandidate: result.topCandidate,
    ambiguity: {
      evaluatedCandidates: result.evaluatedCandidates,
      ignoredHardRejected: result.ignoredHardRejected,
      trueAmbiguity: result.trueAmbiguity
    },
    hardRejectSummary: {
      candidateCount: result.rankedCandidates.length,
      rejectedCandidateCount: result.rankedCandidates.filter((candidate) => candidate.decision === 'rejected').length,
      reasons: result.hardRejectReasons
    }
  };
}
