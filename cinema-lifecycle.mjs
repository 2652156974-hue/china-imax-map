const HISTORICAL_VERDICTS = new Set([
  'accept-historical-location',
  'accepted-historical-location'
]);

const HISTORICAL_NAME_PATTERN = /(?:原有.{0,16}拆除|原商业体.{0,8}拆除|原址已?拆|已拆除|拆除重建|永久关闭|结束运营|已撤幕|撤幕|结业)/i;

const GENERIC_NAME_PARTS = /(?:imax|commercial\s*laser|laser\s*xt|gt\s*laser|双机激光|单机激光|激光|氙灯|数字|胶片|12声道(?:音响系统)?|影厅)/gi;
const HISTORICAL_NAME_PARTS = /(?:原有商业综合体拆除|原商业综合体拆除|原有.{0,10}拆除|原址已?拆|已拆除|拆除重建|拆除|永久关闭|结束运营|已关闭|关闭|已撤幕|撤幕|停业|结业|旧址|原址)/gi;

export function cinemaLifecycle(record) {
  if (!record || typeof record !== 'object') return 'current';
  const verdict = String(
    record.reviewVerdict ??
    record.location?.reviewVerdict ??
    record.review?.verdict ??
    ''
  ).toLowerCase();
  const name = String(record.name ?? '');
  const status = String(record.status ?? '').toLowerCase();

  if (HISTORICAL_VERDICTS.has(verdict)) return 'history';
  if (status === 'closed') return 'history';
  if (record.supplemental?.historicalLocation) return 'history';
  if (HISTORICAL_NAME_PATTERN.test(name)) return 'history';
  return 'current';
}

export function lifecycleCounts(records) {
  const counts = { current: 0, history: 0 };
  for (const record of Array.isArray(records) ? records : []) {
    counts[cinemaLifecycle(record)] += 1;
  }
  return counts;
}

export function lifecycleBadge(record) {
  if (cinemaLifecycle(record) === 'current') {
    return record?.status === 'temporarily_closed' ? '暂时停业' : '现有 IMAX';
  }
  return HISTORICAL_NAME_PATTERN.test(String(record?.name ?? '')) ? '历史 · 已拆/停用' : '历史 IMAX';
}

export function simplifyLifecycleName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(GENERIC_NAME_PARTS, '')
    .replace(HISTORICAL_NAME_PARTS, '')
    .replace(/(?:店铺|门店|店)$/g, '')
    .replace(/[\s·•,，。:：;；、()（）[\]【】《》<>“”'"—_\-/]/g, '');
}

export function relatedLifecycleRecords(record, records, options = {}) {
  if (!record) return [];
  const source = Array.isArray(records) ? records : [];
  const sourceLifecycle = cinemaLifecycle(record);
  const maxDistanceKm = finiteOr(options.maxDistanceKm, 0.8);
  const matches = [];

  for (const candidate of source) {
    if (!candidate || candidate === record || sameRecord(candidate, record)) continue;
    if (cinemaLifecycle(candidate) === sourceLifecycle) continue;
    const score = lifecycleRelationshipScore(record, candidate, { maxDistanceKm });
    if (score > 0) matches.push({ record: candidate, score });
  }

  matches.sort((left, right) => right.score - left.score || sourceRow(left.record) - sourceRow(right.record));
  return sortLifecycleRecords([record, ...matches.map((match) => match.record)]);
}

export function lifecycleRelationshipScore(left, right, options = {}) {
  if (!left || !right || cinemaLifecycle(left) === cinemaLifecycle(right)) return 0;
  if (!sameAdministrativeArea(left, right)) return 0;

  const similarity = bestNameSimilarity(left, right);
  const distance = recordDistanceKm(left, right);
  const maxDistanceKm = finiteOr(options.maxDistanceKm, 0.8);

  if (distance !== null && distance > maxDistanceKm) return 0;
  if (similarity >= 0.96) return 120 - (distance ?? 0) * 10;
  if (similarity >= 0.72 && (distance === null || distance <= 0.8)) return 90 + similarity * 10 - (distance ?? 0) * 8;
  if (similarity >= 0.56 && distance !== null && distance <= 0.18) return 70 + similarity * 10 - distance * 10;
  return 0;
}

export function sortLifecycleRecords(records) {
  return [...new Map((Array.isArray(records) ? records : []).map((record) => [recordIdentity(record), record])).values()]
    .sort((left, right) => {
      const lifecycleDelta = lifecycleRank(left) - lifecycleRank(right);
      if (lifecycleDelta) return lifecycleDelta;
      const statusDelta = statusRank(left?.status) - statusRank(right?.status);
      if (statusDelta) return statusDelta;
      return sourceRow(left) - sourceRow(right);
    });
}

function bestNameSimilarity(left, right) {
  let best = 0;
  for (const leftName of recordNames(left)) {
    for (const rightName of recordNames(right)) {
      const a = simplifyLifecycleName(leftName);
      const b = simplifyLifecycleName(rightName);
      if (a.length < 5 || b.length < 5) continue;
      if (a === b) return 1;
      if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 7) {
        best = Math.max(best, Math.min(a.length, b.length) / Math.max(a.length, b.length));
      }
      best = Math.max(best, bigramDice(a, b));
    }
  }
  return best;
}

function recordNames(record) {
  return [
    record?.name,
    ...(Array.isArray(record?.formerNames) ? record.formerNames : []),
    record?.supplemental?.mallOrVenue,
    record?.supplemental?.historicalLocation?.name,
    record?.supplemental?.historicalLocation?.mallOrVenue,
    record?.mallOrVenue
  ].filter(Boolean);
}

function bigramDice(left, right) {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const leftPairs = pairCounts(left);
  const rightPairs = pairCounts(right);
  let overlap = 0;
  for (const [pair, count] of leftPairs) overlap += Math.min(count, rightPairs.get(pair) ?? 0);
  return (2 * overlap) / ((left.length - 1) + (right.length - 1));
}

function pairCounts(value) {
  const counts = new Map();
  for (let index = 0; index < value.length - 1; index += 1) {
    const pair = value.slice(index, index + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

function sameAdministrativeArea(left, right) {
  const leftCity = normalizeArea(left?.city || left?.administrative?.prefectureName || left?.province || left?.region);
  const rightCity = normalizeArea(right?.city || right?.administrative?.prefectureName || right?.province || right?.region);
  return Boolean(leftCity && rightCity && leftCity === rightCity);
}

function normalizeArea(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\s市省特别行政区]/g, '');
}

function recordDistanceKm(left, right) {
  const a = recordPoint(left);
  const b = recordPoint(right);
  if (!a || !b) return null;
  const toRadians = (value) => value * Math.PI / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

function recordPoint(record) {
  const lat = Number(record?.location?.providerLat ?? record?.location?.lat);
  const lng = Number(record?.location?.providerLng ?? record?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function sameRecord(left, right) {
  return recordIdentity(left) === recordIdentity(right);
}

function recordIdentity(record) {
  return String(record?.id ?? `row:${sourceRow(record)}`);
}

function sourceRow(record) {
  const value = Number(record?.sourceRow);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function lifecycleRank(record) {
  return cinemaLifecycle(record) === 'current' ? 0 : 1;
}

function statusRank(status) {
  return status === 'open' ? 0 : status === 'unknown' ? 1 : status === 'temporarily_closed' ? 2 : 3;
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
