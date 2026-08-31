const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export function hasUsableCoordinate(record) {
  const location = record?.location ?? {};
  const lat = location.providerCrs === 'GCJ-02' ? location.providerLat : location.lat;
  const lng = location.providerCrs === 'GCJ-02' ? location.providerLng : location.lng;
  return finite(lat) && finite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function coordinateCount(document) {
  return (document?.records ?? []).filter(hasUsableCoordinate).length;
}

function containsRawCandidateData(document) {
  const serialized = JSON.stringify(document ?? '');
  return serialized.includes('rawCandidates') || serialized.includes('rankedCandidates');
}

function containsProviderCoordinates(document) {
  return (document?.records ?? []).some((record) =>
    Object.hasOwn(record?.location ?? {}, 'providerLat') || Object.hasOwn(record?.location ?? {}, 'providerLng'));
}

export function isPublicationSafeDataset(document) {
  if (!document || !Array.isArray(document.records)) return false;
  if (document.mode !== 'public-amap-runtime') return false;
  if (document.mapProvider !== 'AMap JS API 2.0' || document.coordinateSystem !== 'GCJ-02') return false;
  if (document.policy?.amapCoordinatesIncluded !== false) return false;
  if (document.policy?.runtimeAmapCoordinatesIncluded !== true) return false;
  if (document.policy?.amapRawCandidatesIncluded === true) return false;
  if (document.policy?.providerCacheIncluded !== false) return false;
  if (document.policy?.rawTencentSnapshotIncluded !== false) return false;
  if (containsRawCandidateData(document) || containsProviderCoordinates(document)) return false;
  return (document.records ?? []).every((record) => record.location?.lat === null && record.location?.lng === null);
}

export function hasPublicationSafeCoordinates(document) {
  return isPublicationSafeDataset(document) && Number(document.runtimeMarkerCount) > 0;
}

export function isLocalPreviewDataset(document) {
  return Boolean(document &&
    document.mode === 'local-preview' &&
    document.policy?.localOnly === true &&
    document.policy?.amapCoordinatesIncluded === true &&
    document.publicationGate === 'BLOCKED_LOCAL_ONLY' &&
    Array.isArray(document.records) &&
    !containsRawCandidateData(document));
}

export function createDataAdapter({
  publicUrl = './data/public/cinemas.json',
  localUrl = './data/local/cinemas-preview.json',
  localPreview = false,
  fetchImpl = globalThis.fetch,
  onRequest = () => {},
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');

  const fetchJson = async (url) => {
    onRequest(url);
    const response = await fetchImpl(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`);
    return response.json();
  };

  return {
    async load() {
      let publicData = null;
      let publicError = null;
      try { publicData = await fetchJson(publicUrl); } catch (error) { publicError = error; }
      if (publicData && isPublicationSafeDataset(publicData)) {
        return { data: publicData, mode: 'public-amap-runtime', sourceUrl: publicUrl };
      }
      if (localPreview) {
        const localData = await fetchJson(localUrl);
        if (!isLocalPreviewDataset(localData)) throw new Error('LOCAL PREVIEW 数据未声明为 local-only，已拒绝加载');
        return { data: localData, mode: 'local-preview', sourceUrl: localUrl };
      }
      if (publicError) throw publicError;
      throw new Error('公开 AMap 事实层未通过校验，已拒绝加载');
    }
  };
}
