import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const OUTPUT_FILE = path.join(ROOT, 'data/public/cinemas.json');
const MARKER_QUALITY_FILE = path.join(ROOT, 'data/audit/public-amap-quality.json');

export function buildPublicDataset({
  derivedFile = DERIVED_FILE,
  outputFile = OUTPUT_FILE,
  runtimeMarkerCount = readRuntimeMarkerCount(),
  generatedAt = new Date().toISOString()
} = {}) {
  const derived = readJson(derivedFile);
  if (!Array.isArray(derived.records) || derived.records.length !== 901) {
    throw new Error('Public builder expected exactly 901 derived records.');
  }
  if (!Number.isInteger(runtimeMarkerCount) || runtimeMarkerCount < 0 || runtimeMarkerCount > derived.records.length) {
    throw new Error('Public builder requires a dynamic runtime marker count between zero and total records.');
  }

  const records = derived.records.map(publicRecord);
  const output = {
    schemaVersion: 1,
    dataset: 'arvin-imax-public-cinemas',
    mode: 'public-amap-runtime',
    generatedAt,
    status: 'publication-candidate',
    mapProvider: 'AMap JS API 2.0',
    coordinateSystem: 'GCJ-02',
    coordinatesPublished: 0,
    runtimeMarkerCount,
    markerService: {
      method: 'POST',
      path: '/api/public/markers',
      requestKey: 'sourceRow',
      responseCoordinateSystem: 'GCJ-02',
      responsePolicy: 'minimal accepted markers only; no bulk static coordinate artifact'
    },
    source: {
      maintainer: '@ArvinTingcn',
      document: '全球IMAX及特效影厅分布20260820',
      url: 'https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP?tab=BB08J2',
      tabId: 'BB08J2',
      tab: 'IMAX中国',
      attribution: '数据来源：@ArvinTingcn《全球IMAX及特效影厅分布》',
      mapAttribution: '地图由高德地图 JS API 2.0 提供'
    },
    policy: {
      localOnly: false,
      amapCoordinatesIncluded: false,
      runtimeAmapCoordinatesIncluded: true,
      amapProviderMetadataIncluded: false,
      providerCacheIncluded: false,
      rawTencentSnapshotIncluded: false,
      staticBulkCoordinateArtifacts: 0,
      publicCoordinatePolicy: 'Static facts contain no coordinates; the server-side marker service returns only accepted AMap GCJ-02 fields needed by the live AMap application.',
      note: 'Do not add provider cache, complete coordinate CSV/GeoJSON, or security credentials to the public release.'
    },
    records
  };

  writeJson(outputFile, output);
  return {
    outputFile,
    records: records.length,
    staticCoordinates: 0,
    runtimeMarkerCount: output.runtimeMarkerCount,
    status: output.status
  };
}

function readRuntimeMarkerCount() {
  if (!fs.existsSync(MARKER_QUALITY_FILE)) {
    throw new Error('Missing public AMap quality input; build the dynamic marker layer first.');
  }
  const quality = readJson(MARKER_QUALITY_FILE);
  return Number(quality.markerCount);
}

function publicRecord(record) {
  const review = record.screenSeatReview;
  const materializedFields = Array.isArray(review?.materializedFields)
    ? [...new Set(review.materializedFields.filter((field) => ['width', 'height', 'area', 'seats'].includes(field)))]
    : [];
  return {
    id: record.id,
    sourceRow: record.sourceRow,
    name: record.name,
    formerNames: Array.isArray(record.formerNames) ? record.formerNames : [],
    region: record.region,
    province: record.province,
    city: record.city,
    mallOrVenue: record.location?.address ?? '',
    projection: {
      raw: record.projection?.raw ?? '',
      technology: record.projection?.technology ?? 'unknown',
      system: record.projection?.system ?? 'unknown',
      geometry: record.projection?.geometry ?? null,
      is3D: record.projection?.is3D ?? null,
      audioChannels: record.projection?.audioChannels ?? null,
      dome: Boolean(record.projection?.dome),
      film1570: record.projection?.film1570 ?? null,
      plannedSystem: record.projection?.plannedSystem ?? null
    },
    screen: {
      width: numberOrNull(record.screen?.width),
      height: numberOrNull(record.screen?.height),
      area: numberOrNull(record.screen?.area),
      rawWidth: String(record.screen?.rawWidth ?? ''),
      rawHeight: String(record.screen?.rawHeight ?? ''),
      rawArea: String(record.screen?.rawArea ?? ''),
      selectionConfidence: record.screen?.selectionConfidence ?? 'unknown'
    },
    seats: numberOrNull(record.seats),
    seatsRaw: String(record.seatsRaw ?? ''),
    ...(materializedFields.length ? {
      screenSeatReview: {
        confidence: ['high', 'medium', 'low', 'unknown'].includes(review?.confidence) ? review.confidence : 'unknown',
        materializedFields
      }
    } : {}),
    status: record.status ?? 'unknown',
    historySummary: record.historySummary ?? '',
    location: {
      lat: null,
      lng: null,
      address: '',
      locationGranularity: null,
      locationConfidence: 'unknown',
      identityConfidence: 'unknown',
      mapCrs: null,
      provider: ''
    },
    source: {
      maintainer: '@ArvinTingcn',
      document: '全球IMAX及特效影厅分布20260820',
      url: 'https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP?tab=BB08J2',
      tab: 'IMAX中国'
    }
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildPublicDataset();
  console.log(JSON.stringify({
    ok: true,
    output: path.relative(ROOT, result.outputFile).replaceAll(path.sep, '/'),
    records: result.records,
    staticCoordinates: result.staticCoordinates,
    runtimeMarkerCount: result.runtimeMarkerCount,
    status: result.status
  }, null, 2));
}
