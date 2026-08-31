import { focusScopeFromItem } from './focus-navigation.mjs';
import { cinemaLifecycle } from './cinema-lifecycle.mjs';

/**
 * Compact, production-shared marker input. It contains only values consumed
 * by marker HTML, offset placement, and the click action.
 */
export function markerRenderDescriptor(item = {}, lifecycle = 'current') {
  const records = item.records ?? item.cinemas ?? [];
  const first = records[0] ?? {};
  const kind = item.kind ?? item.type ?? 'administrative';
  const isCinema = kind === 'cinema';
  const isSameSite = kind === 'same-site';
  const scope = kind === 'administrative' ? focusScopeFromItem(item) : null;
  return {
    key: item.adminKey ?? item.key ?? item.siteKey ?? null,
    kind,
    level: item.level,
    fallback: Boolean(item.fallback),
    sizeClass: item.sizeClass,
    count: item.count,
    name: item.name,
    lnglat: item.lnglat,
    offsetX: Number(item.offsetX) || 0,
    offsetY: Number(item.offsetY) || 0,
    members: records.map((record) => ({
      id: record?.id ?? null,
      sourceRow: record?.sourceRow ?? null,
      name: record?.name ?? null
    })),
    html: {
      colorKey: isCinema ? markerColorKey(first) : null,
      locationOnly: isCinema ? locationBucket(first) === 'location-only' : false,
      historical: isCinema ? cinemaLifecycle(first) === 'history' : lifecycle === 'history',
      level: item.level || 'county',
      compact: isSameSite,
      count: Number.isFinite(Number(item.count)) ? String(item.count) : '0'
    },
    click: isSameSite || isCinema
      ? { type: isSameSite ? 'same-site' : 'cinema', recordId: first.id ?? null }
      : {
          type: 'administrative-focus',
          focus: scope ? {
            ...scope,
            key: item.adminKey ?? item.key ?? null,
            name: item.name || scope.countyName || scope.prefectureName || scope.provinceName || '地区',
            lnglat: item.lnglat
          } : null
        }
  };
}

export function markerClickTarget(item, lifecycle = 'current') {
  return markerRenderDescriptor(item, lifecycle).click;
}

function markerColorKey(cinema) {
  return cinema?.projection?.dome ? 'Dome' : cinema?.projection?.system ?? 'unknown';
}

function locationBucket(cinema) {
  const location = cinema?.location ?? {};
  const lat = Number(location.providerLat);
  const lng = Number(location.providerLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'unresolved';
  return location.identityConfidence === 'high' && !['venue', 'mall'].includes(location.locationGranularity)
    ? 'exact'
    : 'location-only';
}
