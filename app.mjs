import {
  buildNearbyCandidateSet,
  canonicalFieldPresentation,
  formatDistanceKm,
  geolocationFailureMessage,
  readAmapGeolocationResult,
  screenMeasureLabel,
  sortNearbyCandidates
} from './nearby.mjs';
import {
  buildAdministrativeDisplay,
  projectStableCollisionPoint,
  resolveAdminCollisions
} from './admin-clusters.mjs';
import {
  cinemaLifecycle,
  lifecycleBadge,
  lifecycleCounts,
  relatedLifecycleRecords
} from './cinema-lifecycle.mjs';
import {
  applyFocusScope,
  effectiveDisplayZoom,
  focusScopeFromItem,
  focusTargetZoom,
  navigationTargetZoom
} from './focus-navigation.mjs';
import { displayRenderSignature } from './render-signature.mjs';

const config = window.__PUBLIC_AMAP_CONFIG__ ?? {};
const mapError = document.querySelector('#mapError');
const dataBanner = document.querySelector('#dataBanner');
const statusElement = document.querySelector('#status');
const recordList = document.querySelector('#recordList');
const searchInput = document.querySelector('#search');
const detailPanel = document.querySelector('#detailPanel');
const detailContent = document.querySelector('#detailContent');
const nearbyButton = document.querySelector('#nearbyButton');
const exitNearbyButton = document.querySelector('#exitNearbyButton');
const nearbyStatus = document.querySelector('#nearbyStatus');
const nearbyToolbar = document.querySelector('#nearbyToolbar');
const nearbyScope = document.querySelector('#nearbyScope');
const nearbySortFilters = document.querySelector('#nearbySortFilters');
const expandNearbyButton = document.querySelector('#expandNearbyButton');
const currentLifecycleCount = document.querySelector('#currentLifecycleCount');
const historyLifecycleCount = document.querySelector('#historyLifecycleCount');

let focusNavigation = null;
let focusBackButton = null;
let focusBreadcrumbs = null;
let focusScopeNote = null;

const diagnostics = window.__imaxMapDiagnostics = {
  renderer: 'AMap JS API 2.0',
  provider: 'AMap',
  mapCrs: 'GCJ-02',
  dataMode: 'public-amap-runtime',
  totalRecords: 0,
  locatedRecords: 0,
  visibleMarkers: 0,
  displayMode: 'province',
  renderedItems: 0,
  adminAggregateCount: 0,
  markerRequests: 0,
  geolocationRequests: 0,
  nearbyCandidateCount: 0,
  currentRecords: 0,
  historicalRecords: 0,
  focusDepth: 0,
  focusScope: '全国',
  focusRecordCount: 0,
  navigationEvents: [],
  renderEvents: [],
  errors: []
};

const state = {
  cinemas: [],
  visible: [],
  system: 'ALL',
  region: 'ALL',
  lifecycle: 'current',
  status: 'ALL',
  audio12: false,
  dome: false,
  query: '',
  map: null,
  displayMarkers: [],
  displayItems: [],
  displaySignature: null,
  infoWindow: null,
  AMap: null,
  focus: {
    path: []
  },
  nearby: {
    active: false,
    position: null,
    city: '',
    rangeKm: null,
    sort: 'distance',
    candidates: [],
    scopeLabel: '',
    nextRangeKm: null,
    userMarker: null,
    geolocation: null
  }
};

const markerColors = Object.freeze({
  'GT Laser': '#b42318',
  'Commercial Laser': '#7f56d9',
  'Laser XT': '#1570ef',
  Xenon: '#475467',
  Dome: '#c4320a',
  unknown: '#98a2b3'
});

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  diagnostics.errors.push(message);
  setMapError(message);
  dataBanner.textContent = `公开地图未启动：${message}`;
  statusElement.textContent = '加载失败';
});

async function main() {
  if (!config.amapJsKey || !config.serviceHost || config.mode !== 'public-amap-runtime') {
    throw new Error('公开高德运行配置缺失。请通过服务端提供 Web端(JS API) Key 和安全代理。');
  }
  if (config.coordinateSystem !== 'GCJ-02' || config.markerEndpoint !== '/api/public/markers') {
    throw new Error('公开运行配置的坐标系或 marker 服务不符合 GCJ-02 运行时边界。');
  }

  const [AMap, dataset] = await Promise.all([loadAmap(), loadDataset()]);
  state.AMap = AMap;
  validateDataset(dataset);
  const markers = await loadMarkers(dataset.records);
  state.cinemas = mergeMarkers(dataset.records, markers);
  diagnostics.totalRecords = state.cinemas.length;
  diagnostics.locatedRecords = state.cinemas.filter(hasCoordinate).length;
  const counts = lifecycleCounts(state.cinemas);
  diagnostics.currentRecords = counts.current;
  diagnostics.historicalRecords = counts.history;
  renderLifecycleCounts(counts);

  createMap();
  initFocusNavigation();
  bindFilters();
  bindNearby();
  bindDetailClose();
  bindRecordVariantNavigation();
  applyFilters();
  bindTheme();
  dataBanner.textContent = `现有 ${counts.current} · 历史 ${counts.history} · 已定位 ${diagnostics.locatedRecords} / ${state.cinemas.length}`;
}

async function loadAmap() {
  const serviceHost = new URL(config.serviceHost, window.location.origin).toString().replace(/\/$/, '');
  if (new URL(serviceHost).pathname !== '/_AMapService') {
    throw new Error('高德安全代理必须使用站点一级路径 /_AMapService。');
  }
  window._AMapSecurityConfig = { serviceHost };
  const scriptUrl = new URL(config.sdkUrl || 'https://webapi.amap.com/maps', window.location.origin);
  scriptUrl.searchParams.set('v', '2.0');
  scriptUrl.searchParams.set('key', config.amapJsKey);
  scriptUrl.searchParams.set('plugin', 'AMap.ToolBar,AMap.Scale,AMap.Geolocation');
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptUrl.toString();
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('高德 JS API 加载失败，请检查 Web端 Key、域名白名单和安全代理。'));
    document.head.append(script);
  });
  if (!window.AMap?.Map || !window.AMap?.Marker || !window.AMap?.Geolocation) {
    throw new Error('高德 JS API 已响应，但地图、Marker 或定位组件不可用。');
  }
  return window.AMap;
}

async function loadDataset() {
  const response = await fetch('./data/cinemas.json', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`公开事实数据加载失败（HTTP ${response.status}）。`);
  return response.json();
}

async function loadMarkers(records) {
  diagnostics.markerRequests += 1;
  const response = await fetch(config.markerEndpoint, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceRows: records.map((record) => record.sourceRow) })
  });
  if (!response.ok) throw new Error(`公开 marker 服务加载失败（HTTP ${response.status}）。`);
  const document = await response.json();
  if (document?.mode !== 'public-amap-marker-response' || document.coordinateSystem !== 'GCJ-02' || !Array.isArray(document.records)) {
    throw new Error('公开 marker 响应格式或坐标系不符合要求。');
  }
  return document.records;
}

function validateDataset(dataset) {
  if (dataset?.mode !== 'public-amap-runtime' || dataset?.mapProvider !== 'AMap JS API 2.0') {
    throw new Error('拒绝加载非公开 AMap 运行时事实层。');
  }
  if (dataset.coordinateSystem !== 'GCJ-02' || dataset.policy?.amapCoordinatesIncluded !== false) {
    throw new Error('公开事实层必须不含静态坐标，并使用 GCJ-02 运行时 marker。');
  }
  if (!Array.isArray(dataset.records) || dataset.records.length !== 901) throw new Error('公开事实层必须保留完整 901 条记录。');
  for (const record of dataset.records) {
    if (record.location?.lat !== null || record.location?.lng !== null) throw new Error(`静态数据 ${record.id} 含坐标，已拒绝加载。`);
    if (typeof record.screen?.rawWidth !== 'string' || typeof record.screen?.rawHeight !== 'string' || typeof record.screen?.rawArea !== 'string' || typeof record.seatsRaw !== 'string') {
      throw new Error(`静态数据 ${record.id} 缺少银幕/座位原文。`);
    }
  }
}

function mergeMarkers(records, markers) {
  const metadataByRow = new Map(records.map((record) => [record.sourceRow, record]));
  const markerByRow = new Map();
  for (const marker of markers) {
    const metadata = metadataByRow.get(marker.sourceRow);
    if (!metadata || metadata.id !== marker.id) throw new Error(`marker sourceRow/id 关联失败：${marker.sourceRow}`);
    if (marker.provider !== 'amap' || marker.providerCrs !== 'GCJ-02' || !validCoordinate(marker.providerLat, marker.providerLng)) {
      throw new Error(`marker ${marker.id} 不是有效 AMap GCJ-02 坐标。`);
    }
    if (markerByRow.has(marker.sourceRow)) throw new Error(`marker sourceRow 重复：${marker.sourceRow}`);
    markerByRow.set(marker.sourceRow, marker);
  }
  return records.map((record) => {
    const marker = markerByRow.get(record.sourceRow);
    return marker ? {
      ...record,
      administrative: normalizeAdministrativeBinding(marker.administrative ?? record.administrative ?? null),
      location: {
        ...record.location,
        provider: 'amap',
        providerPoiId: marker.providerPoiId,
        providerLat: Number(marker.providerLat),
        providerLng: Number(marker.providerLng),
        providerCrs: 'GCJ-02',
        mapCrs: 'GCJ-02',
        positionType: marker.positionType,
        locationGranularity: marker.locationGranularity,
        locationConfidence: marker.locationConfidence,
        identityConfidence: marker.identityConfidence,
        decisionOrigin: marker.decisionOrigin,
        reviewVerdict: marker.reviewVerdict
      }
    } : record;
  });
}

function normalizeAdministrativeBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const point = (candidate) => {
    if (!Array.isArray(candidate) || candidate.length < 2) return null;
    const lng = Number(candidate[0]);
    const lat = Number(candidate[1]);
    return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90
      ? [lng, lat]
      : null;
  };
  const text = (candidate) => typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
  return {
    provinceName: text(value.provinceName),
    provinceCode: text(value.provinceCode),
    prefectureName: text(value.prefectureName),
    prefectureCode: text(value.prefectureCode),
    prefectureLevel: text(value.prefectureLevel),
    countyName: text(value.countyName),
    countyCode: text(value.countyCode),
    countyLevel: text(value.countyLevel),
    provinceLabelPoint: point(value.provinceLabelPoint),
    prefectureLabelPoint: point(value.prefectureLabelPoint),
    countyLabelPoint: point(value.countyLabelPoint),
    source: text(value.source)
  };
}

function createMap() {
  const AMap = state.AMap;
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  state.map = new AMap.Map('map', {
    center: [104.1954, 35.8617],
    zoom: 4,
    viewMode: '3D',
    pitch: 0,
    resizeEnable: true,
    showIndoorMap: false,
    mapStyle: dark ? 'amap://styles/dark' : 'amap://styles/whitesmoke'
  });
  state.map.on?.('zoomend', () => renderAdministrativeDisplay());
  state.map.addControl(new AMap.ToolBar({ position: { right: '16px', bottom: '96px' } }));
  state.map.addControl(new AMap.Scale());
  state.infoWindow = new AMap.InfoWindow({ isCustom: true, closeWhenClickMap: true, offset: new AMap.Pixel(0, -12) });
}

function initFocusNavigation() {
  const filterDetails = document.querySelector('.filter-details');
  if (!filterDetails) return;

  focusNavigation = document.createElement('nav');
  focusNavigation.className = 'focus-navigation';
  focusNavigation.id = 'focusNavigation';
  focusNavigation.hidden = true;
  focusNavigation.setAttribute('aria-label', '行政区逐层导航');
  focusNavigation.innerHTML = `
    <button class="focus-back" id="focusBack" type="button">← 返回</button>
    <div class="focus-breadcrumbs" id="focusBreadcrumbs"></div>
    <div class="focus-scope-note" id="focusScopeNote"></div>
  `;
  filterDetails.before(focusNavigation);
  focusBackButton = focusNavigation.querySelector('#focusBack');
  focusBreadcrumbs = focusNavigation.querySelector('#focusBreadcrumbs');
  focusScopeNote = focusNavigation.querySelector('#focusScopeNote');

  focusBackButton.addEventListener('click', () => navigateFocusToDepth(Math.max(0, state.focus.path.length - 1)));
  focusBreadcrumbs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-focus-depth]');
    if (!button || button.disabled) return;
    navigateFocusToDepth(Number(button.dataset.focusDepth));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !state.focus.path.length || state.nearby.active) return;
    navigateFocusToDepth(state.focus.path.length - 1);
  });
  renderFocusNavigation();
}

function currentFocus() {
  return state.focus.path[state.focus.path.length - 1] ?? null;
}

function recordNavigationDiagnostic(fromDepth, toDepth) {
  appendBoundedDiagnostic(diagnostics.navigationEvents, { fromDepth, toDepth });
}

function appendBoundedDiagnostic(list, value, limit = 200) {
  list.push(value);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function readMapView() {
  const center = state.map?.getCenter?.();
  const lng = Number(center?.getLng?.() ?? center?.lng);
  const lat = Number(center?.getLat?.() ?? center?.lat);
  const view = {
    zoom: Number(state.map?.getZoom?.()) || 4,
    center: Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : [104.1954, 35.8617]
  };
  const pitch = Number(state.map?.getPitch?.());
  const rotation = Number(state.map?.getRotation?.());
  if (Number.isFinite(pitch)) view.pitch = pitch;
  if (Number.isFinite(rotation)) view.rotation = rotation;
  return view;
}

function restoreMapView(view) {
  if (!view || !Array.isArray(view.center)) return;
  const map = state.map;
  map?.setZoomAndCenter?.(Number(view.zoom) || 4, view.center, false, 420);
  if (Number.isFinite(Number(view.pitch))) map?.setPitch?.(Number(view.pitch));
  if (Number.isFinite(Number(view.rotation))) map?.setRotation?.(Number(view.rotation));
}

function readFocusReturnState() {
  return {
    returnView: readMapView(),
    returnScrollTop: Number(recordList?.scrollTop) || 0
  };
}

function restoreFocusReturnState(entry) {
  if (!entry) return;
  restoreMapView(entry.returnView);
  if (Number.isFinite(Number(entry.returnScrollTop))) recordList.scrollTop = Number(entry.returnScrollTop);
}

function enterAdministrativeFocus(item) {
  if (state.nearby.active || !item || item.kind !== 'administrative') return;
  const scope = focusScopeFromItem(item);
  if (!scope.provinceName && !scope.prefectureName && !scope.countyName) return;

  const existing = currentFocus();
  const key = item.adminKey ?? item.key ?? `${scope.level}:${scope.provinceName || ''}:${scope.prefectureName || ''}:${scope.countyName || ''}`;
  if (existing?.key === key) return;

  recordNavigationDiagnostic(state.focus.path.length, state.focus.path.length + 1);

  state.focus.path.push({
    ...scope,
    key,
    name: item.name || scope.countyName || scope.prefectureName || scope.provinceName || '地区',
    ...readFocusReturnState()
  });
  state.infoWindow?.close();
  detailPanel.hidden = true;
  diagnostics.focusDepth = state.focus.path.length;
  diagnostics.focusScope = currentFocus()?.name || '全国';
  renderFocusNavigation();
  applyFilters({ targetZoom: navigationTargetZoom(currentFocus()) });
  recordList.scrollTop = 0;
  if (Array.isArray(item.lnglat)) {
    state.map.setZoomAndCenter(focusTargetZoom(scope.level), item.lnglat, false, 420);
  }
}

function navigateFocusToDepth(depth) {
  const targetDepth = Math.max(0, Math.min(Number(depth) || 0, state.focus.path.length));
  if (targetDepth === state.focus.path.length) return;
  recordNavigationDiagnostic(state.focus.path.length, targetDepth);
  const restoreEntry = state.focus.path[targetDepth] ?? null;
  state.focus.path = state.focus.path.slice(0, targetDepth);
  state.infoWindow?.close();
  detailPanel.hidden = true;
  diagnostics.focusDepth = state.focus.path.length;
  diagnostics.focusScope = currentFocus()?.name || '全国';
  renderFocusNavigation();
  applyFilters({ targetZoom: navigationTargetZoom(currentFocus()) });
  if (restoreEntry) restoreFocusReturnState(restoreEntry);
  else if (targetDepth === 0) state.map.setZoomAndCenter(4, [104.1954, 35.8617], false, 420);
}

function resetFocusNavigation({ restore = false } = {}) {
  if (!state.focus.path.length) return;
  const restoreView = state.focus.path[0]?.returnView ?? null;
  state.focus.path = [];
  diagnostics.focusDepth = 0;
  diagnostics.focusScope = '全国';
  diagnostics.focusRecordCount = 0;
  renderFocusNavigation();
  if (restore && restoreView) restoreMapView(restoreView);
}

function renderFocusNavigation(scopeCount = null) {
  if (!focusNavigation || !focusBreadcrumbs) return;
  const path = state.focus.path;
  focusNavigation.hidden = path.length === 0;
  if (!path.length) {
    focusBreadcrumbs.replaceChildren();
    if (focusScopeNote) focusScopeNote.textContent = '';
    return;
  }

  const fragments = [];
  const addCrumb = (label, depth, current) => {
    if (fragments.length) {
      const separator = document.createElement('span');
      separator.className = 'focus-separator';
      separator.textContent = '/';
      fragments.push(separator);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `focus-crumb${current ? ' current' : ''}`;
    button.dataset.focusDepth = String(depth);
    button.textContent = label;
    button.disabled = current;
    if (current) button.setAttribute('aria-current', 'page');
    fragments.push(button);
  };

  addCrumb('全国', 0, false);
  path.forEach((entry, index) => addCrumb(entry.name, index + 1, index === path.length - 1));
  focusBreadcrumbs.replaceChildren(...fragments);
  if (focusScopeNote) {
    const count = scopeCount === null || scopeCount === undefined ? NaN : Number(scopeCount);
    focusScopeNote.textContent = Number.isFinite(count) ? `${count} 家` : '焦点模式';
  }
}

function bindFilters() {
  document.querySelector('#lifecycleFilters').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-lifecycle]');
    if (!button) return;
    state.lifecycle = button.dataset.lifecycle === 'history' ? 'history' : 'current';
    state.status = 'ALL';
    activateSingle('#statusFilters button[data-status]', document.querySelector('#statusFilters button[data-status="ALL"]'));
    activateLifecycleButton(button);
    state.infoWindow?.close();
    detailPanel.hidden = true;
    applyFilters();
  });
  document.querySelector('#systemFilters').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.dome === 'true') {
      button.classList.toggle('active');
      state.dome = !state.dome;
    } else {
      state.system = button.dataset.system ?? 'ALL';
      activateSingle('#systemFilters button[data-system]', button);
    }
    applyFilters();
  });
  document.querySelector('#regionFilters').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-region]');
    if (!button) return;
    state.region = button.dataset.region;
    activateSingle('#regionFilters button[data-region]', button);
    applyFilters();
  });
  document.querySelector('#statusFilters').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.audio === '12') {
      state.audio12 = !state.audio12;
      button.classList.toggle('active', state.audio12);
    } else {
      state.status = button.dataset.status ?? 'ALL';
      activateSingle('#statusFilters button[data-status]', button);
    }
    applyFilters();
  });
  searchInput.addEventListener('input', () => {
    state.query = normalizeSearch(searchInput.value);
    applyFilters();
  });
}

function bindNearby() {
  nearbyButton.addEventListener('click', requestNearbyLocation);
  exitNearbyButton.addEventListener('click', exitNearbyMode);
  nearbySortFilters.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-nearby-sort]');
    if (!button || !state.nearby.active) return;
    state.nearby.sort = button.dataset.nearbySort;
    activateSingle('#nearbySortFilters button[data-nearby-sort]', button);
    applyFilters();
  });
  expandNearbyButton.addEventListener('click', () => {
    if (!state.nearby.active || state.nearby.nextRangeKm === null) return;
    state.nearby.rangeKm = state.nearby.nextRangeKm;
    refreshNearbyCandidates();
  });
}

function requestNearbyLocation() {
  if (state.nearby.active || state.nearby.geolocation) return;
  if (!state.AMap?.Geolocation) {
    setNearbyFailure('当前浏览器不支持定位，可继续搜索城市或影院。');
    return;
  }

  nearbyButton.disabled = true;
  nearbyButton.textContent = '正在定位…';
  nearbyStatus.hidden = false;
  nearbyStatus.textContent = '正在获取当前位置…';
  diagnostics.geolocationRequests += 1;

  try {
    const geolocation = new state.AMap.Geolocation({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
      convert: true,
      showButton: false,
      showCircle: false,
      showMarker: false,
      panToLocation: false,
      zoomToAccuracy: false
    });
    state.nearby.geolocation = geolocation;
    geolocation.getCurrentPosition((status, result) => {
      state.nearby.geolocation = null;
      const resolved = readAmapGeolocationResult(status, result);
      if (!resolved.ok) {
        setNearbyFailure(geolocationFailureMessage(status, result));
        return;
      }
      enterNearbyMode(resolved);
    });
  } catch (error) {
    state.nearby.geolocation = null;
    setNearbyFailure(error instanceof Error ? error.message : '未能获取当前位置，可继续搜索城市或影院。');
  }
}

function enterNearbyMode(resolved) {
  resetFocusNavigation();
  state.nearby.active = true;
  state.nearby.position = resolved.position;
  state.nearby.city = resolved.city;
  state.nearby.rangeKm = null;
  state.nearby.sort = 'distance';
  placeUserMarker(resolved.position);
  state.map.setZoomAndCenter(11, [resolved.position.lng, resolved.position.lat], false, 520);
  nearbyButton.hidden = true;
  nearbyButton.disabled = false;
  nearbyButton.textContent = '我的位置';
  exitNearbyButton.hidden = false;
  nearbyStatus.hidden = false;
  nearbyStatus.textContent = resolved.city ? `已定位到${resolved.city}，附近结果仅用于本次浏览。` : '已获取当前位置，按距离范围查找附近 IMAX。';
  activateSingle('#nearbySortFilters button[data-nearby-sort]', document.querySelector('#nearbySortFilters button[data-nearby-sort="distance"]'));
  refreshNearbyCandidates();
}

function refreshNearbyCandidates() {
  const result = buildNearbyCandidateSet(state.cinemas, {
    position: state.nearby.position,
    city: state.nearby.city
  }, { rangeKm: state.nearby.rangeKm });
  state.nearby.candidates = result.records;
  state.nearby.scopeLabel = result.scopeLabel;
  state.nearby.nextRangeKm = result.nextRangeKm;
  diagnostics.nearbyCandidateCount = result.records.length;
  nearbyToolbar.hidden = !state.nearby.active;
  nearbyScope.textContent = state.nearby.scopeLabel;
  expandNearbyButton.hidden = result.nextRangeKm === null;
  expandNearbyButton.textContent = result.nextRangeKm === null ? '扩大范围' : `扩大到 ${result.nextRangeKm} km`;
  applyFilters();
}

function setNearbyFailure(message) {
  nearbyButton.disabled = false;
  nearbyButton.hidden = false;
  nearbyButton.textContent = '我的位置';
  nearbyStatus.hidden = false;
  nearbyStatus.textContent = message;
  nearbyToolbar.hidden = true;
  exitNearbyButton.hidden = true;
}

function exitNearbyMode() {
  state.nearby.userMarker?.setMap?.(null);
  state.nearby.userMarker = null;
  state.nearby.active = false;
  state.nearby.position = null;
  state.nearby.city = '';
  state.nearby.rangeKm = null;
  state.nearby.sort = 'distance';
  state.nearby.candidates = [];
  state.nearby.scopeLabel = '';
  state.nearby.nextRangeKm = null;
  state.nearby.geolocation = null;
  state.infoWindow?.close();
  nearbyButton.hidden = false;
  nearbyButton.disabled = false;
  nearbyButton.textContent = '我的位置';
  exitNearbyButton.hidden = true;
  nearbyToolbar.hidden = true;
  nearbyStatus.hidden = true;
  state.map.setZoomAndCenter(4, [104.1954, 35.8617], false, 520);
  applyFilters();
}

function placeUserMarker(position) {
  state.nearby.userMarker?.setMap?.(null);
  state.nearby.userMarker = new state.AMap.Marker({
    map: state.map,
    position: [position.lng, position.lat],
    content: '<div class="user-location-marker" title="我的位置"></div>',
    offset: new state.AMap.Pixel(-8, -8),
    zIndex: 200
  });
}

function bindDetailClose() {
  document.querySelector('#detailClose').addEventListener('click', () => { detailPanel.hidden = true; });
}

function bindRecordVariantNavigation() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-related-record-id]');
    if (!button) return;
    const cinema = state.cinemas.find((record) => record.id === button.dataset.relatedRecordId);
    if (!cinema) return;
    event.preventDefault();
    event.stopPropagation();
    focusCinema(cinema);
  });
}

function activateSingle(selector, selected) {
  for (const button of document.querySelectorAll(selector)) button.classList.toggle('active', button === selected);
}

function activateLifecycleButton(selected) {
  for (const button of document.querySelectorAll('#lifecycleFilters button[data-lifecycle]')) {
    const active = button === selected;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function renderLifecycleCounts(counts = lifecycleCounts(state.cinemas)) {
  currentLifecycleCount.textContent = String(counts.current);
  historyLifecycleCount.textContent = String(counts.history);
}

function applyFilters({ targetZoom = null } = {}) {
  const sourceRecords = state.nearby.active ? state.nearby.candidates : state.cinemas;
  const scopedRecords = state.nearby.active ? sourceRecords : applyFocusScope(sourceRecords, currentFocus());
  const scopedLifecycleRecords = scopedRecords.filter((cinema) => cinemaLifecycle(cinema) === state.lifecycle);
  state.visible = scopedLifecycleRecords.filter((cinema) => {
    const projection = cinema.projection ?? {};
    const matchesSystem = state.system === 'ALL' || (projection.system ?? 'unknown') === state.system;
    const matchesDome = !state.dome || projection.dome === true;
    const matchesRegion = state.region === 'ALL' || cinema.region === state.region;
    const matchesStatus = state.status === 'ALL' || (cinema.status ?? 'unknown') === state.status;
    const matchesAudio = !state.audio12 || Number(projection.audioChannels) === 12;
    const matchesSearch = !state.query || searchText(cinema).includes(state.query);
    return matchesSystem && matchesDome && matchesRegion && matchesStatus && matchesAudio && matchesSearch;
  });
  if (state.nearby.active) state.visible = sortNearbyCandidates(state.visible, state.nearby.sort);
  const located = state.visible.filter(hasCoordinate);
  renderAdministrativeDisplay(located, targetZoom ?? state.map?.getZoom?.() ?? 4);
  renderRecordList(state.visible);
  diagnostics.visibleMarkers = located.length;
  document.body.dataset.lifecycle = state.lifecycle;
  const lifecycleLabel = state.lifecycle === 'history' ? '历史' : '现有';
  diagnostics.focusRecordCount = currentFocus() ? scopedLifecycleRecords.length : 0;
  renderFocusNavigation(scopedLifecycleRecords.length);
  if (state.nearby.active) {
    statusElement.textContent = `${lifecycleLabel} · 附近 ${state.visible.length} · ${nearbySortLabel(state.nearby.sort)} · 地图点 ${located.length}`;
  } else if (currentFocus()) {
    statusElement.textContent = `${currentFocus().name} · ${lifecycleLabel} ${state.visible.length} / ${scopedLifecycleRecords.length} · 地图点 ${located.length}`;
  } else {
    const lifecycleTotal = state.lifecycle === 'history' ? diagnostics.historicalRecords : diagnostics.currentRecords;
    statusElement.textContent = `${lifecycleLabel} ${state.visible.length} / ${lifecycleTotal} · 地图点 ${located.length}`;
  }
}

function renderAdministrativeDisplay(records = state.visible.filter(hasCoordinate), zoom = state.map?.getZoom?.() ?? 4) {
  const renderStarted = performance.now();
  const requestedZoom = Number(zoom) || 4;
  const effectiveZoom = effectiveDisplayZoom(requestedZoom, currentFocus());
  const buildStarted = performance.now();
  const items = buildAdministrativeDisplay(records, effectiveZoom);
  const buildAdministrativeDisplayMs = performance.now() - buildStarted;
  const displayMode = items.mode ?? 'province';
  const project = (lnglat) => projectStableCollisionPoint(lnglat, displayMode);
  const collisionItems = items.filter((item) => item.kind === 'administrative' || item.kind === 'same-site');
  const collisionStarted = performance.now();
  const resolvedCollisionItems = resolveAdminCollisions(collisionItems, project, { maxOffsetPx: 32, stepPx: 8, paddingPx: 4 });
  const collisionResolveMs = performance.now() - collisionStarted;
  const collisionByKey = new Map(resolvedCollisionItems.map((item) => [displayItemKey(item), item]));
  const resolvedItems = items.map((item) => (
    item.kind === 'administrative' || item.kind === 'same-site'
      ? collisionByKey.get(displayItemKey(item)) ?? withZeroDisplayOffset(item)
      : withZeroDisplayOffset(item)
  ));
  const signature = displayRenderSignature({ lifecycle: state.lifecycle, mode: displayMode, items: resolvedItems });
  const skipped = signature === state.displaySignature;
  state.displayItems = resolvedItems;
  diagnostics.displayMode = displayMode;
  diagnostics.renderedItems = resolvedItems.length;
  diagnostics.adminAggregateCount = resolvedItems.filter((item) => item.kind === 'administrative').length;

  let markerClearMs = 0;
  let markerCreateMs = 0;
  let removedCount = 0;
  let createdCount = 0;
  if (!skipped) {
    const markerClearStarted = performance.now();
    removedCount = clearDisplayMarkers();
    markerClearMs = performance.now() - markerClearStarted;
    const markerCreateStarted = performance.now();
    for (const item of resolvedItems) {
      const marker = createDisplayMarker(item);
      if (marker) {
        state.displayMarkers.push(marker);
        createdCount += 1;
      }
    }
    markerCreateMs = performance.now() - markerCreateStarted;
    state.displaySignature = signature;
  }
  appendBoundedDiagnostic(diagnostics.renderEvents, {
    requestedZoom,
    effectiveZoom,
    displayMode,
    inputRecordCount: records.length,
    outputItemCount: resolvedItems.length,
    buildAdministrativeDisplayMs,
    collisionResolveMs,
    markerClearMs,
    markerCreateMs,
    totalRenderMs: performance.now() - renderStarted,
    marker: { removedCount, createdCount },
    skipped
  });
}

function displayItemKey(item) {
  return item.adminKey ?? item.key ?? item.siteKey ?? item.records?.[0]?.id ?? item.name ?? `${item.lnglat?.[0]}:${item.lnglat?.[1]}`;
}

function withZeroDisplayOffset(item) {
  return { ...item, offsetX: 0, offsetY: 0 };
}

function clearDisplayMarkers() {
  const removedCount = state.displayMarkers.length;
  for (const marker of state.displayMarkers) marker?.setMap?.(null);
  state.displayMarkers = [];
  return removedCount;
}

function createDisplayMarker(item) {
  const AMap = state.AMap;
  const firstCinema = item.records?.[0] ?? item.cinemas?.[0] ?? null;
  if (!AMap?.Marker || !Array.isArray(item.lnglat) || item.lnglat.length < 2) return null;
  const isCinema = item.kind === 'cinema';
  const isSameSite = item.kind === 'same-site';
  const size = isCinema ? 16 : displayItemSize(item);
  const marker = new AMap.Marker({
    map: state.map,
    position: item.lnglat,
    content: displayItemHtml(item),
    offset: new AMap.Pixel(-size / 2, -size / 2),
    zIndex: isCinema ? 70 : 80
  });
  const offsetX = Number(item.offsetX) || 0;
  const offsetY = Number(item.offsetY) || 0;
  marker.setOffset(new AMap.Pixel(-size / 2 + offsetX, -size / 2 + offsetY));
  marker.off?.('click');
  marker.on?.('click', () => {
    if (isSameSite) {
      state.map.setZoomAndCenter(17, item.lnglat, false, 420);
      if (firstCinema) openCinema(firstCinema);
      return;
    }
    if (isCinema) {
      if (firstCinema) openCinema(firstCinema);
      return;
    }
    enterAdministrativeFocus(item);
  });
  return marker;
}

function displayItemHtml(item) {
  const isCinema = item.kind === 'cinema';
  const isSameSite = item.kind === 'same-site';
  const firstCinema = item.records?.[0] ?? item.cinemas?.[0] ?? null;
  if (isCinema) {
    const color = firstCinema ? (markerColors[markerColorKey(firstCinema)] ?? markerColors.unknown) : markerColors.unknown;
    const locationOnly = firstCinema ? locationBucket(firstCinema) === 'location-only' : true;
    const historical = firstCinema ? cinemaLifecycle(firstCinema) === 'history' : state.lifecycle === 'history';
    const title = escapeHtml(firstCinema?.name || item.name || 'IMAX 影院');
    return `<div class="imax-marker${locationOnly ? ' location-only' : ''}${historical ? ' is-history' : ''}" style="--marker-color:${color}" title="${title}" aria-label="${title}"><span></span></div>`;
  }

  const levelClass = isSameSite ? 'admin-cluster--overlap' : `admin-cluster--${item.level || 'county'}`;
  const fallbackClass = !isSameSite && item.fallback ? ' admin-cluster--fallback' : '';
  // Administrative names are identity, not optional decoration.  A crowded
  // layout may keep its bounded offset, but only a same-site cinema stack is
  // allowed to collapse to the count-only treatment.
  const compactClass = isSameSite ? ' admin-cluster--compact' : '';
  const historyClass = state.lifecycle === 'history' ? ' admin-cluster--history' : '';
  const sizeClass = `count-size--${displaySizeClass(item.sizeClass)}`;
  const name = escapeHtml(item.name || '地区待核');
  const count = Number.isFinite(Number(item.count)) ? String(item.count) : '0';
  const title = escapeHtml(isSameSite
    ? `同址 ${count} 家 IMAX · ${item.name || 'IMAX 影院'}`
    : `${item.name || '地区待核'} · ${count} 家 IMAX`);
  return `<div class="admin-cluster ${levelClass}${fallbackClass}${compactClass}${historyClass} ${sizeClass}" title="${title}" aria-label="${title}" role="button">` +
    `<span class="admin-cluster__name">${name}</span><span class="admin-cluster__count">${count}</span></div>`;
}

function displaySizeClass(value) {
  return value === 'small' ? 's' : value === 'medium' ? 'm' : value === 'medium-large' ? 'l' : 'xl';
}

function displayItemSize(item) {
  const values = { small: 34, medium: 40, 'medium-large': 47, large: 54 };
  const size = values[item.sizeClass] ?? values.small;
  const compact = item.kind === 'same-site';
  return compact ? Math.max(28, size - 6) : size;
}

function renderRecordList(records) {
  const limit = 80;
  recordList.replaceChildren();
  for (const cinema of records.slice(0, limit)) {
    const button = document.createElement('button');
    button.className = 'record-item';
    button.dataset.recordId = cinema.id;
    if (state.nearby.active) {
      const audio = Number(cinema.projection?.audioChannels);
      const audioLabel = Number.isFinite(audio) && audio > 0 ? `${formatNumber(audio, 0)}声道` : '声道暂无数据';
      button.innerHTML = `<div class="record-name"><span>${escapeHtml(cinema.name || '待核影院')}</span>${recordLifecyclePill(cinema)}</div>` +
        `<div class="record-meta">${escapeHtml(cinema.city || cinema.region || '地区待核')} · 距你 ${escapeHtml(formatDistanceKm(cinema.distanceKm))}</div>` +
        `<div class="record-spec">${escapeHtml(systemLabel(cinema))} · ${escapeHtml(screenMeasureLabel(cinema))} · ${escapeHtml(audioLabel)}</div>`;
    } else {
      const locatedLabel = hasCoordinate(cinema) ? '已定位' : '未定位';
      button.innerHTML = `<div class="record-name"><span>${escapeHtml(cinema.name || '待核影院')}</span><span class="record-badges">${recordLifecyclePill(cinema)}<span class="status-pill">${locatedLabel}</span></span></div>` +
        `<div class="record-meta">${escapeHtml(cinema.city || cinema.region || '地区待核')} · ${escapeHtml(systemLabel(cinema))} · ${escapeHtml(locationBucketLabel(cinema))}</div>`;
    }
    button.addEventListener('click', () => focusCinema(cinema));
    recordList.append(button);
  }
  if (records.length > limit) {
    const more = document.createElement('div');
    more.className = 'record-more';
    more.textContent = `另有 ${records.length - limit} 条，请继续缩小筛选或搜索。`;
    recordList.append(more);
  }
}

function recordLifecyclePill(cinema) {
  const lifecycle = cinemaLifecycle(cinema);
  return `<span class="lifecycle-pill lifecycle-pill--${lifecycle}">${escapeHtml(lifecycle === 'history' ? '历史' : '现有')}</span>`;
}

function focusCinema(cinema) {
  if (!hasCoordinate(cinema)) {
    state.infoWindow?.close();
    showDetail(cinema);
    return;
  }
  const position = [Number(cinema.location.providerLng), Number(cinema.location.providerLat)];
  // Open the popup only after the map is already at the target. On the real
  // AMap SDK, animating a long-distance jump while opening an InfoWindow can
  // leave the popup thousands of pixels outside the viewport.
  state.map.setZoomAndCenter(15, position, true);
  openCinema(cinema);
}

function openCinema(cinema) {
  showDetail(cinema, true);
  const position = [Number(cinema.location.providerLng), Number(cinema.location.providerLat)];
  state.infoWindow.setContent(popupHtml(cinema));
  state.infoWindow.open(state.map, position);
  queueMicrotask(() => document.querySelector('.popup-close')?.addEventListener('click', () => state.infoWindow.close(), { once: true }));
}

function showDetail(cinema, fromMap = false) {
  if (fromMap) {
    detailPanel.hidden = true;
    return;
  }
  detailContent.innerHTML = detailHtml(cinema, false);
  detailPanel.hidden = false;
}

function popupHtml(cinema) { return detailHtml(cinema, true); }

function detailHtml(cinema, popup) {
  const projection = cinema.projection ?? {};
  const location = cinema.location ?? {};
  const width = screenField(cinema, 'width', 'rawWidth', 'm');
  const height = screenField(cinema, 'height', 'rawHeight', 'm');
  const area = screenField(cinema, 'area', 'rawArea', 'm²');
  const seats = seatField(cinema);
  const dataNotes = renderDataNotes([
    ['宽度', width.raw],
    ['高度', height.raw],
    ['面积', area.raw],
    ['座位', seats.raw]
  ]);
  const locationText = hasCoordinate(cinema)
    ? `高德地图 · ${escapeHtml(location.providerCrs)} · ${escapeHtml(positionTypeLabel(location.positionType))}`
    : '未定位（保留在列表和详情中，不使用城市中心点）';
  const locationNote = locationBucket(cinema) === 'location-only'
    ? '<div class="raw-note">位置说明：场馆/商场坐标，非影院入口或影厅的精确定位。</div>'
    : '';
  const formerNames = cinema.formerNames?.length ? `<div class="raw-note">曾用名：${escapeHtml(cinema.formerNames.join('；'))}</div>` : '';
  const lifecycle = cinemaLifecycle(cinema);
  const lifecycleNavigation = renderLifecycleNavigation(cinema);
  const historyNote = lifecycle === 'history'
    ? '<div class="history-note">这是一条历史 IMAX 记录，不代表当前位置仍在使用这套旧影厅。</div>'
    : '';
  const close = popup ? '<button class="detail-close popup-close" aria-label="关闭">×</button>' : '';
  const distanceRow = state.nearby.active && Number.isFinite(Number(cinema.distanceKm))
    ? `<b>距离</b><span>${escapeHtml(formatDistanceKm(cinema.distanceKm))}（直线）</span>`
    : '';
  return `<article class="imax-info">${close}` +
    lifecycleNavigation +
    `<div class="detail-heading"><span class="lifecycle-pill lifecycle-pill--${lifecycle}">${escapeHtml(lifecycleBadge(cinema))}</span></div>` +
    `<div class="detail-title popup-title">${escapeHtml(cinema.name || '待核影院')}</div>` +
    `<div class="detail-subtitle">${escapeHtml(cinema.city || cinema.region || '地区待核')} · ${escapeHtml(locationBucketLabel(cinema))}</div>` +
    `<div class="popup-grid">` +
    `<b>投影</b><span>${escapeHtml(systemLabel(cinema))}</span>` +
    distanceRow +
    `<b>声道</b><span>${projection.audioChannels ? `${Number(projection.audioChannels)}声道` : '待核'}</span>` +
    `<b>宽度</b><span>${width.html}</span>` +
    `<b>高度</b><span>${height.html}</span>` +
    `<b>面积</b><span>${area.html}</span>` +
    `<b>座位</b><span>${seats.html}</span>` +
    `<b>状态</b><span>${statusLabel(cinema.status)}</span>` +
    `<b>定位</b><span>${escapeHtml(granularityLabel(location.locationGranularity))} · 位置${escapeHtml(confidenceLabel(location.locationConfidence))} / 身份${escapeHtml(confidenceLabel(location.identityConfidence))}<small class="field-secondary">${locationText}</small></span>` +
    `</div>${historyNote}${dataNotes}${formerNames}${locationNote}` +
    `<div class="raw-note">数据来源：<a href="${escapeHtml(cinema.source?.url || 'https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP?tab=BB08J2')}" target="_blank" rel="noopener">@ArvinTingcn《全球 IMAX 及特效影厅分布》</a></div>` +
    `</article>`;
}

function renderLifecycleNavigation(cinema) {
  const records = relatedLifecycleRecords(cinema, state.cinemas);
  if (records.length < 2) return '';
  const historyTotal = records.filter((record) => cinemaLifecycle(record) === 'history').length;
  let historyIndex = 0;
  const buttons = records.map((record) => {
    const lifecycle = cinemaLifecycle(record);
    if (lifecycle === 'history') historyIndex += 1;
    const label = lifecycle === 'current' ? '现在' : historyTotal > 1 ? `前身 ${historyIndex}` : '前身';
    const active = record.id === cinema.id;
    return `<button class="${active ? 'active' : ''}" data-related-record-id="${escapeHtml(record.id)}" type="button" aria-pressed="${active}">` +
      `<span>${label}</span><small>${escapeHtml(systemLabel(record))}</small></button>`;
  }).join('');
  return `<div class="history-switch"><div class="history-switch__label">同址沿革</div><div class="history-switch__options">${buttons}</div></div>`;
}

function screenField(record = {}, field, rawField, unit) {
  return canonicalFieldPresentation(record, field, unit);
}

function seatField(record = {}) {
  return canonicalFieldPresentation(record, 'seats');
}

function renderDataNotes(fields) {
  const notes = fields.filter(([, raw]) => raw);
  if (!notes.length) return '';
  return `<details class="data-notes"><summary>数据说明</summary><div class="data-notes-body">${notes.map(([label, raw]) =>
    `<div class="data-note"><b>${escapeHtml(label)}原文</b><span class="raw-value">${escapeHtml(raw)}</span></div>`
  ).join('')}</div></details>`;
}

function bindTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', (event) => state.map?.setMapStyle(event.matches ? 'amap://styles/dark' : 'amap://styles/whitesmoke'));
}

function hasCoordinate(cinema) {
  const location = cinema?.location ?? {};
  return location.provider === 'amap' && location.providerCrs === 'GCJ-02' && validCoordinate(location.providerLat, location.providerLng);
}

function validCoordinate(lat, lng) {
  const numericLat = Number(lat);
  const numericLng = Number(lng);
  return Number.isFinite(numericLat) && Number.isFinite(numericLng) && numericLat >= -90 && numericLat <= 90 && numericLng >= -180 && numericLng <= 180;
}

function locationBucket(cinema) {
  if (!hasCoordinate(cinema)) return 'unresolved';
  const location = cinema.location ?? {};
  return location.identityConfidence === 'high' && !['venue', 'mall'].includes(location.locationGranularity) ? 'exact' : 'location-only';
}

function locationBucketLabel(cinema) {
  const bucket = locationBucket(cinema);
  return bucket === 'exact' ? '精确身份' : bucket === 'location-only' ? '场所级定位' : '未定位';
}

function markerColorKey(cinema) { return cinema.projection?.dome ? 'Dome' : cinema.projection?.system ?? 'unknown'; }
function systemLabel(cinema) {
  const projection = cinema.projection ?? {};
  const parts = [];
  if (projection.system && projection.system !== 'unknown') parts.push(projection.system);
  if (projection.geometry) parts.push(projection.geometry);
  if (projection.dome) parts.push('Dome');
  if (projection.plannedSystem) parts.push(`计划：${projection.plannedSystem}`);
  return parts.length ? parts.join(' · ') : '待核';
}
function searchText(cinema) {
  return normalizeSearch([
    cinema.name, ...(cinema.formerNames ?? []), cinema.city, cinema.province, cinema.region,
    cinema.administrative?.prefectureName, cinema.administrative?.countyName,
    cinema.mallOrVenue, cinema.location?.address, cinema.projection?.raw
  ].filter(Boolean).join(' '));
}
function normalizeSearch(value) { return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s·•,，。()（）\-_/]+/g, ''); }
function confidenceWeight(value) { return value === 'high' ? 3 : value === 'medium' ? 2 : 1; }
function statusLabel(value) { return value === 'open' ? '营业' : value === 'closed' ? '已关闭' : value === 'temporarily_closed' ? '暂时停业' : '待核'; }
function confidenceLabel(value) { return value === 'high' ? '高' : value === 'medium' ? '中' : value === 'low' ? '低' : '待核'; }
function granularityLabel(value) { return value === 'auditorium' ? '影厅' : value === 'cinema' ? '影院' : value === 'venue' ? '场馆' : value === 'mall' ? '商场' : '待核'; }
function positionTypeLabel(value) { return value === 'auditorium-poi' ? '影厅 POI' : value === 'cinema-poi' ? '影院 POI' : value === 'venue-poi' ? '场馆 POI' : value === 'mall-fallback' ? '商场回退' : '待核'; }
function nearbySortLabel(value) { return value === 'screen' ? '银幕大小' : value === 'spec' ? '综合规格' : '距离'; }
function formatNumber(value, maximumFractionDigits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '待核';
  const epsilon = number === 0 ? 0 : Math.sign(number) * 1e-9;
  return String(Number((number + epsilon).toFixed(maximumFractionDigits)));
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function setMapError(message) { mapError.textContent = message; mapError.hidden = !message; }
