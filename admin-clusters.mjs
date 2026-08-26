/**
 * Administrative display helpers for the IMAX map.
 *
 * This module deliberately does not fetch administrative data, change a
 * cinema coordinate, or perform spatial clustering.  It turns records that
 * already carry administrative bindings into display items.  When the active
 * layer needs a county binding that a record does not have, that record stays
 * an individual cinema instead of creating a competing parent-level bubble.
 * Its county is never inferred from a coordinate, address, or a nearby point.
 */

const DIRECT_COUNTY_PARENTS = new Set(['北京', '上海', '天津', '重庆', '香港', '澳门']);
const DIRECT_COUNTY_LEVELS = new Set([
  'municipality',
  'municipal',
  'municipality-level',
  'direct-admin',
  'direct-administration',
  'special-administrative-region',
  '直辖市',
  '特别行政区'
]);

const SIZE_CLASS_PIXELS = Object.freeze({
  small: 34,
  medium: 42,
  'medium-large': 50,
  large: 58
});

/**
 * Return the single dominant display strategy for a map zoom.
 *
 * The 9-11 interval is intentionally split: at 9-10 the renderer can still
 * animate/transition out of county aggregation, while 10-11 favors individual
 * cinemas before the >=11 same-site-only rule takes over.
 */
export function zoomDisplayMode(zoom) {
  const value = Number(zoom);
  const normalized = Number.isFinite(value) ? value : 4;
  if (normalized <= 5) return 'province';
  if (normalized <= 7) return 'prefecture';
  if (normalized < 9) return 'county';
  if (normalized <= 10) return 'spread';
  if (normalized < 11) return 'cinema-spread';
  return 'cinema';
}

/**
 * Format an administrative name without inventing a level.
 *
 * Prefecture labels intentionally do not receive a `市` suffix because the
 * map's source vocabulary is already short-form (苏州, 无锡, 上海).  County
 * level cities do receive the formal `市` suffix when it is absent.
 */
export function administrativeDisplayName(name, level) {
  const text = cleanText(name);
  if (!text) return '';

  const normalizedLevel = normalizeLevel(level);
  if (normalizedLevel === 'province') return stripProvinceSuffix(text);
  if (normalizedLevel === 'prefecture') return stripOrdinaryCitySuffix(text);
  if (isCountyLevel(normalizedLevel) && hasFormalCountySuffix(text)) return text;
  if (normalizedLevel === 'county-city') return appendSuffix(text, '市');
  if (normalizedLevel === 'county-district' || normalizedLevel === 'district') {
    if (text.endsWith('新区') || text.endsWith('开发区') || text.endsWith('高新区')) return text;
    return appendSuffix(text, '区');
  }
  if (normalizedLevel === 'county') return appendSuffix(text, '县');
  return text;
}

function isCountyLevel(level) {
  return level === 'county-city' || level === 'county-district' || level === 'district' || level === 'county';
}

function hasFormalCountySuffix(name) {
  return /(?:特别行政区|自治县|自治旗|林区|特区|市|区|县|旗|乡|镇)$/.test(name);
}

/**
 * Use only four weak visual size hints.  The count itself remains the primary
 * encoding, so a 60-count circle is not allowed to become an area chart.
 */
export function countSizeClass(count) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 9) return 'small';
  if (value <= 29) return 'medium';
  if (value <= 59) return 'medium-large';
  return 'large';
}

/**
 * Build one display item per administrative unit at aggregate zooms, and
 * cinema/same-site items while the map is opening up.
 *
 * The returned value is an Array.  Non-enumerable `mode`, `zoom`, and `items`
 * properties are attached as convenience metadata for callers that want the
 * selected strategy without changing the array contract.
 */
export function buildAdministrativeDisplay(cinemas, zoom = 4) {
  const records = Array.isArray(cinemas) ? cinemas : [];
  const mode = zoomDisplayMode(zoom);
  let items;

  if (mode === 'province' || mode === 'prefecture' || mode === 'county') {
    items = buildAdministrativeGroups(records, mode);
  } else if (mode === 'cinema') {
    items = buildCinemaItems(records, mode, true);
  } else if (mode === 'spread') {
    items = buildProgressiveItems(records, mode, 2);
  } else {
    items = buildProgressiveItems(records, mode, 5);
  }

  for (const item of items) item.mode = mode;
  Object.defineProperties(items, {
    mode: { value: mode, enumerable: false },
    zoom: { value: Number.isFinite(Number(zoom)) ? Number(zoom) : 4, enumerable: false },
    items: { value: items, enumerable: false }
  });
  return items;
}

/**
 * Apply a bounded screen-space offset to avoid visual collisions.
 *
 * `project` may be a `(lnglat, item) => {x, y}` function, an AMap-like map
 * object exposing `lngLatToContainer`/`lngLatToPixel`, or an object with a
 * `project` method.  Only the returned visual offset changes.  `lnglat`,
 * `position`, `center`, `adminKey`, and all administrative identity fields are
 * copied unchanged.
 */
export function resolveAdminCollisions(items, project, options = {}) {
  if (!Array.isArray(items)) return [];

  const maxOffset = clampNonNegative(options.maxOffsetPx ?? options.maxOffset ?? 32, 32);
  const step = Math.max(1, clampNonNegative(options.stepPx ?? options.step ?? 8, 8));
  const gap = clampNonNegative(options.paddingPx ?? options.gapPx ?? 4, 4);
  const candidates = buildOffsetCandidates(maxOffset, step);
  const placed = [];
  const output = new Array(items.length);
  const work = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const countDelta = Number(right.item?.count ?? 0) - Number(left.item?.count ?? 0);
      return countDelta || left.index - right.index;
    });

  for (const { item, index } of work) {
    const base = readItemPosition(item);
    const projected = base ? projectPoint(project, base, item) : null;
    const radius = markerRadius(item);

    if (!projected || !candidates.length) {
      output[index] = withCollisionOffset(item, { x: 0, y: 0 }, {
        collisionFree: true,
        compactRecommended: false
      });
      continue;
    }

    let chosen = candidates[0];
    let chosenScore = Number.POSITIVE_INFINITY;
    let chosenValid = false;

    for (const candidate of candidates) {
      const point = { x: projected.x + candidate.x, y: projected.y + candidate.y };
      const score = collisionScore(point, radius, placed, gap);
      const valid = score === 0;
      if (valid && !chosenValid) {
        chosen = candidate;
        chosenScore = score;
        chosenValid = true;
        break;
      }
      if (!chosenValid && (score < chosenScore || (score === chosenScore && offsetMagnitude(candidate) < offsetMagnitude(chosen)))) {
        chosen = candidate;
        chosenScore = score;
      }
    }

    const point = { x: projected.x + chosen.x, y: projected.y + chosen.y };
    placed.push({ point, radius });
    output[index] = withCollisionOffset(item, chosen, {
      collisionFree: chosenValid,
      compactRecommended: !chosenValid
    });
  }

  return output;
}

function buildAdministrativeGroups(records, mode) {
  const groups = new Map();
  const unboundRecords = [];

  records.forEach((record, index) => {
    const point = readRecordPosition(record);
    if (!point) return;

    if (shouldRenderUnboundAsCinema(record, mode)) {
      unboundRecords.push(record);
      return;
    }

    const descriptor = administrativeDescriptor(record, mode);
    let group = groups.get(descriptor.key);
    if (!group) {
      group = {
        descriptor,
        members: [],
        points: [],
        labelPoint: descriptor.labelPoint,
        visualCenter: descriptor.visualCenter
      };
      groups.set(descriptor.key, group);
    }
    group.members.push(record);
    group.points.push(point);
    if (!group.labelPoint && descriptor.labelPoint) group.labelPoint = descriptor.labelPoint;
    if (!group.visualCenter && descriptor.visualCenter) group.visualCenter = descriptor.visualCenter;
    if (group.firstIndex === undefined) group.firstIndex = index;
  });

  return [
    ...[...groups.values()].map((group) => administrativeItem(group, mode)),
    ...buildCinemaItems(unboundRecords, mode, false)
  ];
}

function shouldRenderUnboundAsCinema(record, mode) {
  if (mode === 'province') return false;
  const hierarchy = readAdministrative(record);
  if (hierarchy.countyName) return false;
  if (mode === 'county') return true;
  return mode === 'prefecture' && isDirectCountyParent(hierarchy);
}

function buildCinemaItems(records, mode, mergeSameSite) {
  const groups = new Map();

  records.forEach((record, index) => {
    const point = readRecordPosition(record);
    if (!point) return;

    const siteKey = mergeSameSite ? sameSiteKey(record, point) : `cinema:${recordIdentity(record, index)}`;
    let group = groups.get(siteKey);
    if (!group) {
      group = { members: [], points: [], siteKey, firstIndex: index };
      groups.set(siteKey, group);
    }
    group.members.push(record);
    group.points.push(point);
  });

  return [...groups.values()].map((group) => cinemaItem(group, mode, mergeSameSite));
}

function buildProgressiveItems(records, mode, expansionThreshold) {
  const countyGroups = buildAdministrativeGroups(records, 'county');
  const output = [];

  for (const group of countyGroups) {
    if (group.count > expansionThreshold) {
      group.mode = mode;
      output.push(group);
      continue;
    }
    output.push(...buildCinemaItems(group.records, mode, false));
  }

  return output;
}

function administrativeItem(group, mode) {
  const { descriptor, members, points, labelPoint, visualCenter } = group;
  const center = labelPoint ?? visualCenter ?? medoid(points);
  const count = members.length;
  const level = descriptor.level;
  const item = {
    kind: 'administrative',
    type: 'administrative',
    level,
    adminLevel: level,
    key: descriptor.key,
    adminKey: descriptor.key,
    name: administrativeDisplayName(descriptor.name, descriptor.nameLevel),
    label: administrativeDisplayName(descriptor.name, descriptor.nameLevel),
    count,
    records: members,
    cinemas: members,
    lnglat: center,
    position: center,
    center: { lng: center[0], lat: center[1] },
    centerSource: labelPoint ? 'label-point' : visualCenter ? 'visual-center' : 'medoid',
    sizeClass: countSizeClass(count),
    markerSizeClass: countSizeClass(count),
    fallback: descriptor.fallback,
    fallbackLevel: descriptor.fallbackLevel ?? null,
    parentKey: descriptor.parentKey ?? null,
    source: descriptor.source,
    administrative: descriptor.administrative,
    mode
  };
  return item;
}

function cinemaItem(group, mode, merged) {
  const { members, points, siteKey } = group;
  const center = points[0];
  const first = members[0] ?? {};
  const count = members.length;
  const identity = merged ? siteKey : `cinema:${recordIdentity(first, 0)}`;
  const name = cleanText(first.name) || 'IMAX 影院';
  return {
    kind: merged && count > 1 ? 'same-site' : 'cinema',
    type: merged && count > 1 ? 'same-site' : 'cinema',
    level: 'cinema',
    adminLevel: 'cinema',
    key: identity,
    adminKey: identity,
    name,
    label: name,
    count,
    records: members,
    cinemas: members,
    lnglat: center,
    position: center,
    center: { lng: center[0], lat: center[1] },
    centerSource: merged && count > 1 ? 'same-site' : 'cinema',
    sizeClass: countSizeClass(count),
    markerSizeClass: countSizeClass(count),
    fallback: false,
    fallbackLevel: null,
    parentKey: null,
    siteKey,
    mode
  };
}

function administrativeDescriptor(record, mode) {
  const hierarchy = readAdministrative(record);
  const provinceName = hierarchy.provinceName || '地区待核';
  // Names are the stable primary identity.  Codes are retained in the
  // administrative metadata, and are used only when a name is unavailable;
  // otherwise a coded row and an uncoded fallback row must share one node.
  const provincePart = administrativeIdentityPart(hierarchy.provinceName, hierarchy.provinceCode);
  const provinceKey = `province:${provincePart}`;

  if (mode === 'province') {
    return {
      key: provinceKey,
      parentKey: null,
      level: 'province',
      nameLevel: 'province',
      name: provinceName,
      labelPoint: hierarchy.provinceLabelPoint,
      visualCenter: hierarchy.provinceVisualCenter,
      source: hierarchy.source,
      administrative: hierarchy,
      fallback: !hierarchy.provinceName,
      fallbackLevel: !hierarchy.provinceName ? 'unknown' : null
    };
  }

  const prefectureName = hierarchy.prefectureName || hierarchy.provinceName || '地区待核';
  const prefecturePart = administrativeIdentityPart(
    hierarchy.prefectureName || hierarchy.provinceName,
    hierarchy.prefectureCode
  );
  const prefectureKey = `prefecture:${provincePart}:${prefecturePart}`;
  const directCounty = Boolean(hierarchy.countyName) && isDirectCountyParent(hierarchy);

  if (mode === 'prefecture' && !directCounty) {
    return {
      key: prefectureKey,
      parentKey: provinceKey,
      level: 'prefecture',
      nameLevel: 'prefecture',
      name: prefectureName,
      labelPoint: hierarchy.prefectureLabelPoint,
      visualCenter: hierarchy.prefectureVisualCenter,
      source: hierarchy.source,
      administrative: hierarchy,
      fallback: !hierarchy.prefectureName,
      fallbackLevel: !hierarchy.prefectureName ? 'province' : null
    };
  }

  if (mode === 'prefecture' && directCounty) {
    return countyDescriptor(hierarchy, prefectureKey, true);
  }

  if (hierarchy.countyName) {
    return countyDescriptor(hierarchy, prefectureKey, false);
  }

  // Defensive fallback. buildAdministrativeGroups normally keeps such a row
  // as an individual cinema so a parent city bubble cannot compete with the
  // active county layer.
  return {
    key: `${prefectureKey}:county-fallback`,
    parentKey: prefectureKey,
    level: 'county',
    nameLevel: 'prefecture',
    name: prefectureName,
    labelPoint: hierarchy.prefectureLabelPoint,
    visualCenter: hierarchy.prefectureVisualCenter,
    source: hierarchy.source,
    administrative: hierarchy,
    fallback: true,
    fallbackLevel: 'prefecture'
  };
}

function countyDescriptor(hierarchy, prefectureKey, direct) {
  const countyName = hierarchy.countyName || hierarchy.prefectureName || '地区待核';
  const countyPart = administrativeIdentityPart(
    hierarchy.countyName || hierarchy.prefectureName,
    hierarchy.countyCode
  );
  const countyKey = `county:${prefectureKey}:${countyPart}`;
  return {
    key: countyKey,
    parentKey: prefectureKey,
    level: 'county',
    nameLevel: hierarchy.countyLevel || 'county',
    name: countyName,
    labelPoint: hierarchy.countyLabelPoint,
    visualCenter: hierarchy.countyVisualCenter,
    source: hierarchy.source,
    administrative: hierarchy,
    fallback: false,
    fallbackLevel: null,
    directFrom: direct ? hierarchy.prefectureLevel || 'municipality' : null
  };
}

function readAdministrative(record) {
  const source = isObject(record?.administrative) ? record.administrative : {};
  const provinceName = cleanText(source.provinceName) || cleanText(record?.province);
  const prefectureName = cleanText(source.prefectureName) || cleanText(record?.city);
  const countyName = cleanText(source.countyName);
  return {
    provinceName,
    provinceCode: cleanText(source.provinceCode),
    prefectureName,
    prefectureCode: cleanText(source.prefectureCode),
    prefectureLevel: cleanText(source.prefectureLevel),
    countyName,
    countyCode: cleanText(source.countyCode),
    countyLevel: cleanText(source.countyLevel),
    provinceLabelPoint: readPoint(source.provinceLabelPoint),
    provinceVisualCenter: readPoint(source.provinceVisualCenter),
    prefectureLabelPoint: readPoint(source.prefectureLabelPoint),
    prefectureVisualCenter: readPoint(source.prefectureVisualCenter),
    countyLabelPoint: readPoint(source.countyLabelPoint),
    countyVisualCenter: readPoint(source.countyVisualCenter),
    source: source.source ?? null
  };
}

function isDirectCountyParent(hierarchy) {
  const parent = canonicalName(hierarchy.prefectureName || hierarchy.provinceName);
  const level = canonicalLevel(hierarchy.prefectureLevel);
  return DIRECT_COUNTY_PARENTS.has(parent) || DIRECT_COUNTY_LEVELS.has(level);
}

function readRecordPosition(record) {
  const location = isObject(record?.location) ? record.location : {};
  const candidates = [
    record?.lnglat,
    record?.position,
    record?.coordinates,
    location.lnglat,
    [location.providerLng, location.providerLat],
    [record?.providerLng, record?.providerLat],
    [record?.lng, record?.lat]
  ];
  for (const candidate of candidates) {
    const point = readPoint(candidate);
    if (point) return point;
  }
  return null;
}

function readItemPosition(item) {
  return readPoint(item?.lnglat) || readPoint(item?.position) || readPoint(item?.center);
}

function readPoint(value) {
  if (Array.isArray(value) && value.length >= 2) return normalizePoint(value[0], value[1]);
  if (!value || typeof value !== 'object') return null;
  if (typeof value.getLng === 'function' && typeof value.getLat === 'function') return normalizePoint(value.getLng(), value.getLat());
  if (value.lng !== undefined || value.lon !== undefined || value.longitude !== undefined) {
    return normalizePoint(value.lng ?? value.lon ?? value.longitude, value.lat ?? value.latitude);
  }
  if (value.x !== undefined || value.lnglat !== undefined) {
    return readPoint(value.lnglat) || normalizePoint(value.x, value.y);
  }
  return null;
}

function normalizePoint(lng, lat) {
  const numericLng = Number(lng);
  const numericLat = Number(lat);
  if (!Number.isFinite(numericLng) || !Number.isFinite(numericLat)) return null;
  if (numericLng < -180 || numericLng > 180 || numericLat < -90 || numericLat > 90) return null;
  return [numericLng, numericLat];
}

function medoid(points) {
  if (!points.length) return [0, 0];
  if (points.length === 1) return [...points[0]];

  let best = points[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of points) {
    let score = 0;
    for (const point of points) score += planarDistanceSquared(candidate, point);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return [...best];
}

function planarDistanceSquared(a, b) {
  const scale = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180) || 1;
  const dx = (a[0] - b[0]) * scale;
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function sameSiteKey(record, point) {
  const location = isObject(record?.location) ? record.location : {};
  const explicit = cleanText(record?.siteKey) || cleanText(record?.administrative?.siteKey);
  if (explicit) return `site:${explicit}`;
  const poi = cleanText(location.providerPoiId) || cleanText(record?.providerPoiId);
  if (poi) return `poi:${poi}`;
  // Exact same coordinate is the only fallback permitted at the highest zoom.
  return `point:${point[0].toFixed(7)},${point[1].toFixed(7)}`;
}

function recordIdentity(record, index) {
  return cleanText(record?.id) || cleanText(record?.sourceRow) || String(index);
}

function withCollisionOffset(item, offset, status) {
  const safeOffset = { x: Number(offset.x) || 0, y: Number(offset.y) || 0 };
  const collisionFree = typeof status === 'boolean' ? status : Boolean(status?.collisionFree);
  const compactRecommended = typeof status === 'boolean' ? !collisionFree : Boolean(status?.compactRecommended);
  return {
    ...item,
    offset: safeOffset,
    collisionOffset: safeOffset,
    visualOffset: safeOffset,
    offsetX: safeOffset.x,
    offsetY: safeOffset.y,
    collisionResolved: collisionFree,
    collisionFree,
    compactRecommended
  };
}

function buildOffsetCandidates(maxOffset, step) {
  const output = [{ x: 0, y: 0 }];
  const seen = new Set(['0,0']);
  for (let radius = step; radius <= maxOffset + 1e-6; radius += step) {
    for (let angle = 0; angle < 360; angle += 45) {
      const radians = (angle * Math.PI) / 180;
      const x = Math.round(Math.cos(radians) * radius * 100) / 100;
      const y = Math.round(Math.sin(radians) * radius * 100) / 100;
      if (Math.hypot(x, y) > maxOffset + 1e-6) continue;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({ x, y });
    }
  }
  return output;
}

function collisionScore(point, radius, placed, gap) {
  let score = 0;
  for (const other of placed) {
    const required = radius + other.radius + gap;
    const distance = Math.hypot(point.x - other.point.x, point.y - other.point.y);
    if (distance < required) score += required - distance;
  }
  return score;
}

function projectPoint(project, point, item) {
  try {
    let projected;
    if (typeof project === 'function') {
      projected = project(point, item);
      if (!readScreenPoint(projected)) projected = project(item, point);
    } else if (project && typeof project.lngLatToContainer === 'function') {
      projected = project.lngLatToContainer(point);
    } else if (project && typeof project.lngLatToPixel === 'function') {
      projected = project.lngLatToPixel(point);
    } else if (project && typeof project.project === 'function') {
      projected = project.project(point, item);
    } else {
      projected = item?.screenPoint ?? item?.pixel ?? null;
    }
    return readScreenPoint(projected);
  } catch {
    return null;
  }
}

function readScreenPoint(value) {
  if (Array.isArray(value) && value.length >= 2) {
    return finiteScreenPoint(value[0], value[1]);
  }
  if (!value || typeof value !== 'object') return null;
  const x = typeof value.getX === 'function' ? value.getX() : value.x;
  const y = typeof value.getY === 'function' ? value.getY() : value.y;
  return finiteScreenPoint(x, y);
}

function finiteScreenPoint(x, y) {
  const numericX = Number(x);
  const numericY = Number(y);
  return Number.isFinite(numericX) && Number.isFinite(numericY) ? { x: numericX, y: numericY } : null;
}

function markerRadius(item) {
  const radius = Number(item?.radiusPx ?? item?.markerRadius);
  if (Number.isFinite(radius) && radius >= 0) return radius;
  const size = Number(item?.sizePx);
  if (Number.isFinite(size) && size >= 0) return size / 2;
  return (SIZE_CLASS_PIXELS[item?.sizeClass] ?? SIZE_CLASS_PIXELS.small) / 2;
}

function normalizeLevel(level) {
  const value = canonicalLevel(level);
  if (value === 'county-level-city' || value === 'county-city' || value === 'city') return 'county-city';
  if (value === 'county-level-district' || value === 'county-district') return 'county-district';
  if (value === 'district') return 'district';
  if (value === 'county') return 'county';
  return value;
}

function canonicalLevel(value) {
  return cleanText(value).toLowerCase().replace(/[\s_]+/g, '-');
}

function canonicalName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/特别行政区$/u, '')
    .replace(/(?:壮族|回族|维吾尔|蒙古族|藏族)?自治区$/u, '')
    .replace(/(?:开发|高新|新)区$/u, '')
    .replace(/自治州$/u, '')
    .replace(/自治县$/u, '')
    .replace(/地区$/u, '')
    .replace(/盟$/u, '')
    .replace(/省$/u, '')
    .replace(/市$/u, '')
    .replace(/县$/u, '')
    .replace(/区$/u, '');
}

function keyPart(value) {
  return canonicalName(value).replace(/[^\p{L}\p{N}]+/gu, '') || 'unknown';
}

function administrativeIdentityPart(name, code) {
  const namePart = keyPart(name);
  if (namePart !== 'unknown') return `name:${namePart}`;
  const codePart = keyPart(code);
  return codePart === 'unknown' ? 'unknown' : `code:${codePart}`;
}

function appendSuffix(text, suffix) {
  return text.endsWith(suffix) ? text : `${text}${suffix}`;
}

function stripProvinceSuffix(text) {
  return text
    .replace(/特别行政区$/u, '')
    .replace(/(?:壮族|回族|维吾尔|蒙古族|藏族)?自治区$/u, '')
    .replace(/省$/u, '')
    .replace(/市$/u, '');
}

function stripOrdinaryCitySuffix(text) {
  // Keep自治州、地区、盟 and other formal prefecture names intact.  Only an
  // ordinary prefecture-level 市 suffix is shortened for map labels.
  return text.endsWith('市') ? text.slice(0, -1) : text;
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).normalize('NFKC').replace(/[\s\u00a0\u3000]+/g, '').trim();
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function clampNonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function offsetMagnitude(offset) {
  return Math.hypot(offset.x, offset.y);
}

export const ADMIN_CLUSTER_SIZE_PIXELS = SIZE_CLASS_PIXELS;
