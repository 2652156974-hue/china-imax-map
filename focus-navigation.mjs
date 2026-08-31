/**
 * Pure helpers for hierarchical administrative focus navigation.
 *
 * The page owns map and DOM state. This module only reads explicit hierarchy
 * fields (falling back to the public province/city columns) and filters the
 * current record set; it never infers an administration from coordinates.
 */

export function focusScopeFromItem(item) {
  const first = firstRecord(item);
  const administrative = isObject(item?.administrative)
    ? item.administrative
    : isObject(first.administrative) ? first.administrative : {};
  const level = normalizeFocusLevel(item?.level ?? item?.adminLevel);
  const provinceName = focusText(administrative.provinceName) || focusText(first.province) || (level === 'province' ? focusText(item?.name) : '') || null;
  const prefectureName = focusText(administrative.prefectureName) || focusText(first.city) || (level === 'prefecture' ? focusText(item?.name) : '') || null;
  const countyName = focusText(administrative.countyName) || (level === 'county' ? focusText(item?.name) : '') || null;

  if (level === 'province') {
    return { level, provinceName, prefectureName: null, countyName: null };
  }
  if (level === 'prefecture') {
    return { level, provinceName, prefectureName, countyName: null };
  }
  return { level: 'county', provinceName, prefectureName, countyName };
}

export function matchesFocusScope(record, scope) {
  if (!scope) return true;
  const administrative = isObject(record?.administrative) ? record.administrative : {};
  const provinceName = focusText(administrative.provinceName) || focusText(record?.province) || null;
  const prefectureName = focusText(administrative.prefectureName) || focusText(record?.city) || null;
  const countyName = focusText(administrative.countyName) || null;
  if (scope.provinceName && !sameFocusName(provinceName, scope.provinceName)) return false;
  if (scope.prefectureName && !sameFocusName(prefectureName, scope.prefectureName)) return false;
  if (scope.countyName && !sameFocusName(countyName, scope.countyName)) return false;
  return true;
}

export function applyFocusScope(records, focus) {
  if (!Array.isArray(records) || !focus) return records;
  return records.filter((record) => matchesFocusScope(record, focus));
}

export function focusTargetZoom(level) {
  if (level === 'province') return 6.25;
  if (level === 'prefecture') return 8.25;
  return 11.2;
}

export function effectiveDisplayZoom(zoom, focus) {
  const numeric = Number(zoom) || 4;
  if (!focus) return numeric;
  if (focus.level === 'province') return Math.max(numeric, 6.01);
  if (focus.level === 'prefecture') return Math.max(numeric, 8.01);
  return Math.max(numeric, 11.01);
}

function firstRecord(item) {
  return Array.isArray(item?.records) && item.records[0]
    ? item.records[0]
    : Array.isArray(item?.cinemas) && item.cinemas[0] ? item.cinemas[0] : {};
}

function normalizeFocusLevel(value) {
  if (value === null || value === undefined || value === '') return 'prefecture';
  return value === 'province' ? 'province' : value === 'prefecture' ? 'prefecture' : 'county';
}

function sameFocusName(left, right) {
  return focusText(left) === focusText(right);
}

function focusText(value) {
  if (value === null || value === undefined) return '';
  return String(value).normalize('NFKC').replace(/[\s\u00a0\u3000]+/gu, '').trim();
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
