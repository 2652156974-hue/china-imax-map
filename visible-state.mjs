import { cinemaLifecycle } from './cinema-lifecycle.mjs';
import { applyFocusScope } from './focus-navigation.mjs';
import { sortNearbyCandidates } from './nearby.mjs';

/**
 * The single production/test derivation boundary for every record-backed view.
 * It is deliberately pure: callers can stage a target focus, derive from the
 * full cinema set, and atomically commit the returned arrays with that focus.
 */
export function deriveVisibleState({
  cinemas = [],
  focus = null,
  lifecycle = 'current',
  filters = {},
  nearby = {}
} = {}) {
  const sourceRecords = nearby.active ? [...(nearby.candidates ?? [])] : [...(cinemas ?? [])];
  const scopedRecords = nearby.active ? sourceRecords : applyFocusScope(sourceRecords, focus);
  const activeLifecycle = lifecycle === 'history' ? 'history' : 'current';
  const scopedLifecycleRecords = scopedRecords.filter((cinema) => cinemaLifecycle(cinema) === activeLifecycle);
  const query = normalizeSearch(filters.query);
  let visibleRecords = scopedLifecycleRecords.filter((cinema) => {
    const projection = cinema.projection ?? {};
    const matchesSystem = (filters.system ?? 'ALL') === 'ALL' || (projection.system ?? 'unknown') === filters.system;
    const matchesDome = !filters.dome || projection.dome === true;
    const matchesRegion = (filters.region ?? 'ALL') === 'ALL' || cinema.region === filters.region;
    const matchesStatus = (filters.status ?? 'ALL') === 'ALL' || (cinema.status ?? 'unknown') === filters.status;
    const matchesAudio = !filters.audio12 || Number(projection.audioChannels) === 12;
    const matchesSearch = !query || searchableCinemaText(cinema).includes(query);
    return matchesSystem && matchesDome && matchesRegion && matchesStatus && matchesAudio && matchesSearch;
  });
  if (nearby.active) visibleRecords = sortNearbyCandidates(visibleRecords, nearby.sort);
  const locatedRecords = visibleRecords.filter(hasCoordinate);
  return { scopedLifecycleRecords, visibleRecords, locatedRecords };
}

export function hasCoordinate(cinema) {
  const location = cinema?.location ?? {};
  return location.provider === 'amap' && location.providerCrs === 'GCJ-02' &&
    validCoordinate(location.providerLat, location.providerLng);
}

export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s·•,，。()（）\-_/]+/g, '');
}

function searchableCinemaText(cinema) {
  return normalizeSearch([
    cinema.name, ...(cinema.formerNames ?? []), cinema.city, cinema.province, cinema.region,
    cinema.administrative?.prefectureName, cinema.administrative?.countyName,
    cinema.mallOrVenue, cinema.location?.address, cinema.projection?.raw
  ].filter(Boolean).join(' '));
}

export function validCoordinate(lat, lng) {
  const numericLat = Number(lat);
  const numericLng = Number(lng);
  return Number.isFinite(numericLat) && Number.isFinite(numericLng) &&
    numericLat >= -90 && numericLat <= 90 && numericLng >= -180 && numericLng <= 180;
}
