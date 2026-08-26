const MAX_DISTANCE_KM = 120;
const CITY_EXPANSION_KM = 80;
const CITY_FALLBACK_KM = 50;
const MIN_CITY_CANDIDATES = 3;

const PROJECTION_RANK = Object.freeze({
  'GT Laser': 5,
  'Commercial Laser': 4,
  'Laser XT': 3,
  Xenon: 2,
  unknown: 0
});

export const NEARBY_LIMIT_KM = MAX_DISTANCE_KM;
export const NEARBY_CITY_EXPANSION_KM = CITY_EXPANSION_KM;
export const NEARBY_CITY_FALLBACK_KM = CITY_FALLBACK_KM;

export function coordinateFromGcj02(value) {
  const source = value?.location ?? value ?? {};
  const lat = Number(source.providerLat ?? source.lat);
  const lng = Number(source.providerLng ?? source.lng);
  const crs = source.providerCrs ?? source.mapCrs;
  if (source.providerLat !== undefined || source.providerLng !== undefined) {
    if (crs !== 'GCJ-02') return null;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function haversineKm(from, to) {
  const first = coordinateFromGcj02(from);
  const second = coordinateFromGcj02(to);
  if (!first || !second) return null;
  const earthRadiusKm = 6371.0088;
  const latDelta = toRadians(second.lat - first.lat);
  const lngDelta = toRadians(second.lng - first.lng);
  const a = Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(first.lat)) * Math.cos(toRadians(second.lat)) * Math.sin(lngDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function normalizeCity(value) {
  const text = Array.isArray(value) ? value.find(Boolean) : value;
  if (text === null || text === undefined) return '';
  return String(text)
    .normalize('NFKC')
    .replace(/[\s·•,，。()（）\-_/]+/g, '')
    .replace(/市$/u, '')
    .toLowerCase();
}

export function displayCity(value) {
  const text = Array.isArray(value) ? value.find(Boolean) : value;
  if (text === null || text === undefined) return '';
  return String(text).normalize('NFKC').trim().replace(/市$/u, '');
}

export function reliableScreenField(screen = {}, field) {
  const rawField = `raw${field[0].toUpperCase()}${field.slice(1)}`;
  const raw = String(screen?.[rawField] ?? '').replace(/\u00a0/g, ' ');
  const trimmed = raw.trim();
  const value = Number(screen?.[field]);
  const confidence = screen?.selectionConfidence;
  const confidenceAllowsSelection = confidence === undefined || confidence === null || confidence === 'high';
  const positive = Number.isFinite(value) && value > 0;
  const singleNumeric = /^[-+]?\d+(?:\.\d+)?$/.test(trimmed);
  if (!trimmed || !confidenceAllowsSelection || !singleNumeric || !positive) return null;
  return { value, raw: null, rawText: raw };
}

export function reliableScreenMeasure(record) {
  const screen = record?.screen ?? record ?? {};
  const area = reliableScreenField(screen, 'area');
  if (area) return { kind: 'area', value: area.value };
  const width = reliableScreenField(screen, 'width');
  if (width) return { kind: 'width', value: width.value };
  return null;
}

export function screenMeasureLabel(record) {
  const measure = reliableScreenMeasure(record);
  if (!measure) return '暂无数据';
  return `${formatNumber(measure.value, measure.kind === 'area' ? 2 : 1)} ${measure.kind === 'area' ? 'm²' : 'm'}`;
}

export function formatNumber(value, maximumFractionDigits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '待核';
  const epsilon = number === 0 ? 0 : Math.sign(number) * 1e-9;
  return String(Number((number + epsilon).toFixed(maximumFractionDigits)));
}

export function formatDistanceKm(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '暂无数据';
  const digits = number < 10 ? 1 : 0;
  return `${formatNumber(number, digits)} km`;
}

export function buildNearbyCandidateSet(records, user, { rangeKm = null } = {}) {
  const userPoint = coordinateFromGcj02(user?.position ?? user);
  if (!userPoint) {
    return {
      records: [],
      city: '',
      cityKnown: false,
      cityCount: 0,
      radiusKm: null,
      scopeLabel: '附近 IMAX',
      nextRangeKm: null,
      reason: 'invalid-position'
    };
  }

  const city = displayCity(user?.city);
  const cityKey = normalizeCity(city);
  const measured = (records ?? []).map((record) => {
    const point = coordinateFromGcj02(record);
    const distanceKm = point ? haversineKm(userPoint, point) : null;
    return point && Number.isFinite(distanceKm) && distanceKm <= MAX_DISTANCE_KM
      ? { ...record, distanceKm }
      : null;
  }).filter(Boolean);
  const sameCity = cityKey
    ? measured.filter((record) => normalizeCity(record.city) === cityKey)
    : [];

  let radiusKm;
  let cityOnly = false;
  if (cityKey) {
    cityOnly = rangeKm === null && sameCity.length >= MIN_CITY_CANDIDATES;
    radiusKm = cityOnly ? null : clampRange(rangeKm ?? CITY_EXPANSION_KM);
  } else {
    const requestedRadius = rangeKm === null ? null : clampRange(rangeKm);
    if (requestedRadius !== null) {
      radiusKm = requestedRadius;
    } else {
      const withinFallback = measured.filter((record) => record.distanceKm <= CITY_FALLBACK_KM);
      radiusKm = withinFallback.length >= MIN_CITY_CANDIDATES ? CITY_FALLBACK_KM : CITY_EXPANSION_KM;
    }
  }

  const selected = cityOnly
    ? sameCity
    : cityKey
      ? [...sameCity, ...measured.filter((record) => normalizeCity(record.city) !== cityKey && record.distanceKm <= radiusKm)]
      : measured.filter((record) => record.distanceKm <= radiusKm);
  const deduplicated = [...new Map(selected.map((record) => [record.id ?? record.sourceRow, record])).values()]
    .sort((left, right) => left.distanceKm - right.distanceKm || stableRecordKey(left).localeCompare(stableRecordKey(right), 'zh-CN'));

  const nextRangeKm = cityKey
    ? cityOnly ? CITY_EXPANSION_KM : radiusKm < MAX_DISTANCE_KM ? MAX_DISTANCE_KM : null
    : radiusKm < CITY_EXPANSION_KM ? CITY_EXPANSION_KM : radiusKm < MAX_DISTANCE_KM ? MAX_DISTANCE_KM : null;
  const hasNeighbor = cityKey && deduplicated.some((record) => normalizeCity(record.city) !== cityKey);
  const scopeLabel = cityKey
    ? cityOnly
      ? `${city} · ${deduplicated.length} 家 IMAX`
      : `${city}及 ${radiusKm} km 内 · ${deduplicated.length} 家 IMAX`
    : `当前位置 ${radiusKm} km 内 · ${deduplicated.length} 家 IMAX`;

  return {
    records: deduplicated,
    city,
    cityKnown: Boolean(cityKey),
    cityCount: sameCity.length,
    radiusKm,
    scopeLabel,
    nextRangeKm,
    hasNeighbor: Boolean(hasNeighbor),
    reason: 'ok'
  };
}

export function sortNearbyCandidates(records, sort = 'distance') {
  const source = [...(records ?? [])];
  return source.sort((left, right) => {
    if (sort === 'screen') {
      const screenOrder = compareScreen(left, right);
      if (screenOrder) return screenOrder;
    } else if (sort === 'spec') {
      const specOrder = compareSpecification(left, right);
      if (specOrder) return specOrder;
    }
    const distanceOrder = compareNullableNumber(left.distanceKm, right.distanceKm, false);
    return distanceOrder || stableRecordKey(left).localeCompare(stableRecordKey(right), 'zh-CN');
  });
}

export function projectionTier(record) {
  const system = record?.projection?.system ?? 'unknown';
  return PROJECTION_RANK[system] ?? 0;
}

export function readAmapGeolocationResult(status, result) {
  if (status !== 'complete') return { ok: false, reason: geolocationFailureReason(status, result) };
  const point = coordinateFromGcj02(result?.position);
  if (!point) return { ok: false, reason: 'invalid-position' };
  const accuracy = Number(result?.accuracy);
  return {
    ok: true,
    position: point,
    city: displayCity(result?.addressComponent?.city ?? result?.city),
    accuracy: Number.isFinite(accuracy) ? accuracy : null
  };
}

export function geolocationFailureMessage(status, result) {
  const reason = geolocationFailureReason(status, result);
  if (reason === 'permission-denied') return '未能获取当前位置，可继续搜索城市或影院。';
  if (reason === 'timeout') return '定位超时，可继续搜索城市或影院。';
  if (reason === 'unsupported') return '当前浏览器不支持定位，可继续搜索城市或影院。';
  return '未能获取当前位置，可继续搜索城市或影院。';
}

function compareScreen(left, right) {
  const first = reliableScreenMeasure(left);
  const second = reliableScreenMeasure(right);
  const kindOrder = { area: 2, width: 1 };
  const kindDifference = (kindOrder[second?.kind] ?? 0) - (kindOrder[first?.kind] ?? 0);
  if (kindDifference) return kindDifference;
  const valueDifference = compareNullableNumber(first?.value, second?.value, true);
  return valueDifference;
}

function compareSpecification(left, right) {
  const leftDome = left?.projection?.dome === true;
  const rightDome = right?.projection?.dome === true;
  if (leftDome !== rightDome) return leftDome ? 1 : -1;
  const tierDifference = projectionTier(right) - projectionTier(left);
  if (tierDifference) return tierDifference;
  const screenDifference = compareScreen(left, right);
  if (screenDifference) return screenDifference;
  const leftAudio = audioRank(left);
  const rightAudio = audioRank(right);
  return rightAudio - leftAudio;
}

function audioRank(record) {
  const value = Number(record?.projection?.audioChannels);
  return Number.isFinite(value) && value > 0 ? value : -1;
}

function compareNullableNumber(left, right, descending) {
  const first = Number(left);
  const second = Number(right);
  const firstValid = Number.isFinite(first);
  const secondValid = Number.isFinite(second);
  if (!firstValid || !secondValid) return firstValid === secondValid ? 0 : firstValid ? -1 : 1;
  if (first === second) return 0;
  return descending ? second - first : first - second;
}

function geolocationFailureReason(status, result) {
  const info = String(result?.info ?? result?.message ?? '').toLowerCase();
  if (status === 'timeout' || info.includes('timeout')) return 'timeout';
  if (status === 'unsupported' || info.includes('not_supported') || info.includes('unsupported')) return 'unsupported';
  if (status === 'error' || info.includes('denied') || info.includes('permission')) return 'permission-denied';
  return 'error';
}

function clampRange(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return CITY_EXPANSION_KM;
  return Math.min(MAX_DISTANCE_KM, Math.max(CITY_FALLBACK_KM, number));
}

function stableRecordKey(record) {
  return String(record?.id ?? record?.sourceRow ?? record?.name ?? '');
}

function toRadians(value) {
  return value * Math.PI / 180;
}
