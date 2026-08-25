const STATUS_LABELS = Object.freeze({
  open: '营业',
  closed: '已关闭',
  temporarily_closed: '暂时停业',
  unknown: '待核',
  pending: '待核'
});

const GRANULARITY_LABELS = Object.freeze({
  auditorium: '影厅级',
  cinema: '影院级',
  venue: '场馆级',
  mall: '商场级',
  unknown: '待核'
});

const CONFIDENCE_LABELS = Object.freeze({
  high: '高',
  medium: '中',
  low: '低',
  unknown: '待核',
  pending: '待核'
});

const POSITION_LABELS = Object.freeze({
  'auditorium-poi': '影厅 POI',
  'cinema-poi': '影院 POI',
  'venue-poi': '场馆 POI',
  'mall-fallback': '商场回退'
});

/**
 * Format the four location-related detail rows as one display-only value.
 * The source object is never mutated and empty fragments are omitted.
 * @param {{status?: unknown, location?: Record<string, unknown>}|null} cinema
 * @param {{hasCoordinate?: boolean}} [options]
 */
export function formatLocationInfo(cinema = {}, { hasCoordinate = false } = {}) {
  const location = cinema?.location && typeof cinema.location === 'object' ? cinema.location : {};
  const parts = [
    labelFromMap(cinema?.status, STATUS_LABELS),
    labelFromMap(location.locationGranularity, GRANULARITY_LABELS),
    formatConfidencePair(location),
    formatCoordinateSource(location, hasCoordinate)
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '暂无';
}

/** @param {Record<string, unknown>|null} location @param {boolean} hasCoordinate */
export function formatCoordinateSource(location = {}, hasCoordinate = false) {
  const provider = normalizeProvider(location?.provider);
  const crs = normalizeCrs(location?.providerCrs);
  const position = normalizePositionType(location?.positionType);
  if (!hasCoordinate) return provider || crs || position ? '未定位' : '';
  if (provider === '高德' && position && crs) return `高德${position}（${crs}）`;
  if (provider === '高德' && position) return `高德${position}`;
  if (position && crs) return `${position}（${crs}）`;
  return [provider, crs, position].filter(Boolean).join(' · ');
}

function formatConfidencePair(location) {
  const values = [
    labelFromMap(location?.locationConfidence, CONFIDENCE_LABELS),
    labelFromMap(location?.identityConfidence, CONFIDENCE_LABELS)
  ].filter(Boolean);
  return values.length ? `位置/身份 ${values.join('/')}` : '';
}

function labelFromMap(value, labels) {
  const text = cleanValue(value);
  if (!text) return '';
  return labels[text.toLowerCase()] ?? text;
}

function normalizeProvider(value) {
  const text = cleanValue(value);
  if (!text) return '';
  return /^(amap|高德(?:地图)?)$/i.test(text) ? '高德' : text;
}

function normalizeCrs(value) {
  const text = cleanValue(value);
  if (!text) return '';
  if (/^gcj[\s-]?02$/i.test(text)) return 'GCJ-02';
  if (/^bd[\s-]?09$/i.test(text)) return 'BD-09';
  return text;
}

function normalizePositionType(value) {
  const text = cleanValue(value);
  if (!text) return '';
  const key = text.toLowerCase().replace(/[\s_]+/g, '-');
  if (POSITION_LABELS[key]) return POSITION_LABELS[key];
  if (/影院\s*poi|cinema[-\s]?poi/i.test(text)) return '影院 POI';
  if (/影厅\s*poi|auditorium[-\s]?poi/i.test(text)) return '影厅 POI';
  if (/场馆\s*poi|venue[-\s]?poi/i.test(text)) return '场馆 POI';
  if (/商场|mall[-\s]?fallback/i.test(text)) return '商场回退';
  return text;
}

function cleanValue(value) {
  const text = String(value ?? '').trim();
  return text === 'undefined' || text === 'null' ? '' : text;
}
