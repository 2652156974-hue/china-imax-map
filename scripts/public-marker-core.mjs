// @ts-nocheck
// Pure marker validation/selection shared by the local Node server and Worker.

export const MARKER_PATH = '/api/public/markers';
export const SERVICE_PREFIX = '/_AMapService';
export const PUBLIC_RECORD_COUNT = 901;
export const FIRST_SOURCE_ROW = 2;
export const LAST_SOURCE_ROW = FIRST_SOURCE_ROW + PUBLIC_RECORD_COUNT - 1;

export function hasAcceptedMarker(record) {
  return record?.provider === 'amap' && record?.providerCrs === 'GCJ-02' &&
    Number.isFinite(Number(record.providerLat)) && Number.isFinite(Number(record.providerLng)) &&
    Number(record.providerLat) >= -90 && Number(record.providerLat) <= 90 &&
    Number(record.providerLng) >= -180 && Number(record.providerLng) <= 180;
}

export function validateMarkerLayer(layer) {
  if (layer?.mode !== 'public-amap-reviewed-layer' || layer?.policy?.localOnly !== true) {
    throw new Error('Marker layer must be an explicit local-only public AMap reviewed layer.');
  }
  if (!Array.isArray(layer.records) || layer.records.length !== PUBLIC_RECORD_COUNT) {
    throw new Error(`Marker layer must contain ${PUBLIC_RECORD_COUNT} source rows.`);
  }
  const serialized = JSON.stringify(layer);
  if (/rawCandidates|rankedCandidates|securityJsCode|AMAP_JS_SECURITY_CODE/i.test(serialized)) {
    throw new Error('Marker layer contains forbidden raw candidate or credential text.');
  }

  const rows = new Set();
  for (const record of layer.records) {
    if (!Number.isInteger(record?.sourceRow) || record.sourceRow < FIRST_SOURCE_ROW || record.sourceRow > LAST_SOURCE_ROW || rows.has(record.sourceRow)) {
      throw new Error('Marker layer sourceRow must be a unique integer from 2 through 902.');
    }
    rows.add(record.sourceRow);
    if (hasAcceptedMarker(record) && (record.provider !== 'amap' || record.providerCrs !== 'GCJ-02')) {
      throw new Error(`Marker layer sourceRow ${record.sourceRow} has invalid provider CRS.`);
    }
  }
  return layer;
}

export function validateRuntimeMarkerLayer(layer) {
  if (!layer || !['public-amap-marker-layer', 'public-amap-marker-response'].includes(layer.mode)) {
    throw new Error('Runtime marker object has an invalid mode.');
  }
  if (layer.coordinateSystem !== 'GCJ-02' || layer.sourceRowKey !== true || !Array.isArray(layer.records) || layer.records.length !== PUBLIC_RECORD_COUNT) {
    throw new Error(`Runtime marker object must contain ${PUBLIC_RECORD_COUNT} GCJ-02 records.`);
  }
  const serialized = JSON.stringify(layer);
  if (/rawCandidates|rankedCandidates|securityJsCode|AMAP_JS_SECURITY_CODE|provider-cache/i.test(serialized)) {
    throw new Error('Runtime marker object contains forbidden private or credential text.');
  }
  const rows = new Set();
  for (const record of layer.records) {
    if (!Number.isInteger(record?.sourceRow) || record.sourceRow < FIRST_SOURCE_ROW || record.sourceRow > LAST_SOURCE_ROW || rows.has(record.sourceRow) || !hasAcceptedMarker(record)) {
      throw new Error('Runtime marker object contains an invalid or duplicate marker.');
    }
    rows.add(record.sourceRow);
  }
  return layer;
}

export function minimalMarker(record) {
  return {
    sourceRow: record.sourceRow,
    id: record.id ?? null,
    provider: 'amap',
    providerPoiId: record.providerPoiId ?? null,
    providerLat: Number(record.providerLat),
    providerLng: Number(record.providerLng),
    providerCrs: 'GCJ-02',
    positionType: record.positionType ?? null,
    locationGranularity: record.locationGranularity ?? null,
    locationConfidence: record.locationConfidence ?? null,
    identityConfidence: record.identityConfidence ?? null,
    decisionOrigin: record.decisionOrigin ?? null,
    reviewVerdict: record.reviewVerdict ?? null
  };
}

export function buildMinimalMarkerLayer(layer) {
  validateMarkerLayer(layer);
  const records = layer.records.filter(hasAcceptedMarker).sort((a, b) => a.sourceRow - b.sourceRow).map(minimalMarker);
  if (records.length !== PUBLIC_RECORD_COUNT) {
    throw new Error(`Production deploy requires ${PUBLIC_RECORD_COUNT} accepted markers; received ${records.length}.`);
  }
  return {
    schemaVersion: 1,
    mode: 'public-amap-marker-layer',
    coordinateSystem: 'GCJ-02',
    sourceRowKey: true,
    records
  };
}

export function selectMarkers(layerOrConfig, requestedRows) {
  if (!Array.isArray(requestedRows)) throw new Error('sourceRows must be an array.');
  const records = layerOrConfig?.markerMap instanceof Map ? layerOrConfig.markerMap : new Map((layerOrConfig?.records ?? []).map((record) => [record.sourceRow, record]));
  const rows = [...new Set(requestedRows.map(Number))];
  if (rows.some((row) => !Number.isInteger(row) || row < FIRST_SOURCE_ROW || row > LAST_SOURCE_ROW)) {
    throw new Error('sourceRows must contain integers from 2 through 902.');
  }
  return rows.map((sourceRow) => records.get(sourceRow)).filter(hasAcceptedMarker).map(minimalMarker);
}

export function createMarkerResponse(layer, requestedRows) {
  validateRuntimeMarkerLayer(layer);
  return {
    schemaVersion: 1,
    mode: 'public-amap-marker-response',
    coordinateSystem: 'GCJ-02',
    sourceRowKey: true,
    records: selectMarkers(layer, requestedRows)
  };
}

/** @param {{amapJsKey?: string, amapJsSdkUrl?: string}} [options] */
export function runtimeConfigScript({ amapJsKey, amapJsSdkUrl = '' } = {}) {
  const publicConfig = {
    amapJsKey: String(amapJsKey || ''),
    serviceHost: SERVICE_PREFIX,
    coordinateSystem: 'GCJ-02',
    mode: 'public-amap-runtime',
    markerEndpoint: MARKER_PATH
  };
  if (amapJsSdkUrl) publicConfig.sdkUrl = amapJsSdkUrl;
  return `window.__PUBLIC_AMAP_CONFIG__ = Object.freeze(${JSON.stringify(publicConfig)});\n`;
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
