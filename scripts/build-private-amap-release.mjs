import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ADMIN_HIERARCHY_FILE,
  DEFAULT_AMAP_CACHE_FILE,
  bindAdministrativeRecord,
  createAdministrativeBindingContext
} from './admin-cluster-bindings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEWED_INPUT = path.join(ROOT, 'data/local/private-reviewed-geocodes.json');
const DEFAULT_INPUT = fs.existsSync(REVIEWED_INPUT) ? REVIEWED_INPUT : path.join(ROOT, 'data/local/cinemas-preview.json');
const DEFAULT_OUTPUT = path.join(ROOT, 'dist-private');
const PRIVATE_APP_ROOT = path.join(ROOT, 'private-amap');
let lazyDefaultAdministrativeContext;

export function buildPrivateAmapRelease({
  inputFile = DEFAULT_INPUT,
  outputRoot = DEFAULT_OUTPUT,
  appRoot = PRIVATE_APP_ROOT,
  cacheFile = DEFAULT_AMAP_CACHE_FILE,
  hierarchyFile = DEFAULT_ADMIN_HIERARCHY_FILE,
  administrativeContext,
  generatedAt = new Date().toISOString()
} = {}) {
  const resolvedInput = path.resolve(inputFile);
  const resolvedOutput = path.resolve(outputRoot);
  const resolvedAppRoot = path.resolve(appRoot);

  assertInputFile(resolvedInput);
  assertSafeOutput(resolvedOutput);
  assertPrivateApp(resolvedAppRoot);

  const input = readJson(resolvedInput);
  if (
    !['local-preview', 'private-reviewed'].includes(input.mode) ||
    input.policy?.localOnly !== true ||
    input.policy?.amapCoordinatesIncluded !== true ||
    input.policy?.providerCacheIncluded !== false
  ) {
    throw new Error('Private AMap release requires the explicit local-only preview dataset.');
  }
  if (!Array.isArray(input.records) || input.records.length !== 901) {
    throw new Error('Private AMap release expected exactly 901 IMAX中国 records.');
  }

  const context = administrativeContext ?? createAdministrativeBindingContext({ cacheFile, hierarchyFile });
  const records = input.records.map((record) => toPrivateAmapRecord(record, { administrativeContext: context }));
  const located = records.filter(hasProviderCoordinate).length;
  const pendingReview = records.filter((record) => record.reviewState === 'pending-review').length;
  const unresolved = records.filter((record) => record.reviewState === 'unresolved').length;

  const output = {
    schemaVersion: 1,
    dataset: 'arvin-imax-private-amap-cinemas',
    mode: 'private-amap-release',
    generatedAt,
    coordinateSystem: 'GCJ-02',
    summary: {
      total: records.length,
      located,
      pendingReview,
      reviewStateCounts: countBy(records.map((record) => record.reviewState ?? (hasProviderCoordinate(record) ? 'located' : 'unresolved'))),
      unresolved,
      reviewVerdicts: countBy(records.map((record) => record.reviewVerdict ?? 'not-reviewed'))
    },
    policy: {
      privateOnly: true,
      publicSafe: false,
      gitCommitAllowed: false,
      providerCacheIncluded: false,
      rawCandidatesIncluded: false,
      apiKeyIncluded: false,
      note: 'PRIVATE AMAP VIEW. Deployment-only bundle; do not publish as a coordinate dataset.'
    },
    source: {
      maintainer: '@ArvinTingcn',
      document: '全球IMAX及特效影厅分布20260820',
      tab: 'IMAX中国',
      tabId: 'BB08J2',
      url: 'https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP?tab=BB08J2'
    },
    records
  };

  fs.rmSync(resolvedOutput, { recursive: true, force: true });
  fs.mkdirSync(path.join(resolvedOutput, 'data'), { recursive: true });
  for (const filename of ['index.html', 'app.mjs', 'styles.css']) {
    fs.copyFileSync(path.join(resolvedAppRoot, filename), path.join(resolvedOutput, filename));
  }
  for (const filename of ['nearby.mjs', 'screen-presentation.mjs', 'admin-clusters.mjs', 'cinema-lifecycle.mjs']) {
    fs.copyFileSync(path.join(ROOT, filename), path.join(resolvedOutput, filename));
  }
  fs.writeFileSync(
    path.join(resolvedOutput, 'data/cinemas.json'),
    `${JSON.stringify(output, null, 2)}\n`,
    'utf8'
  );

  return {
    outputRoot: resolvedOutput,
    records: records.length,
    located,
    pendingReview,
    unresolved,
    coordinateSystem: output.coordinateSystem
  };
}

export function toPrivateAmapRecord(record, { administrativeContext } = {}) {
  const sourceLocation = record.location ?? {};
  const providerCoordinateValid =
    sourceLocation.providerCrs === 'GCJ-02' &&
    validLatitude(sourceLocation.providerLat) &&
    validLongitude(sourceLocation.providerLng);

  return {
    id: record.id,
    sourceRow: record.sourceRow,
    name: record.name,
    formerNames: Array.isArray(record.formerNames) ? record.formerNames : [],
    region: record.region,
    province: record.province,
    city: record.city,
    administrative: bindAdministrativeRecord(
    record,
      administrativeContext ?? getDefaultAdministrativeContext()
    ),
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
      rawWidth: record.screen?.rawWidth ?? '',
      rawHeight: record.screen?.rawHeight ?? '',
      rawArea: record.screen?.rawArea ?? '',
      selectionConfidence: record.screen?.selectionConfidence ?? 'unknown'
    },
    seats: numberOrNull(record.seats),
    seatsRaw: record.seatsRaw ?? '',
    reviewVerdict: record.reviewVerdict ?? null,
    reviewState: record.reviewState ?? (providerCoordinateValid ? 'located' : 'unresolved'),
    decisionOrigin: record.decisionOrigin ?? null,
    supplemental: record.supplemental ?? null,
    status: record.status ?? 'unknown',
    historySummary: record.historySummary ?? '',
    location: {
      providerLat: providerCoordinateValid ? Number(sourceLocation.providerLat) : null,
      providerLng: providerCoordinateValid ? Number(sourceLocation.providerLng) : null,
      providerCrs: providerCoordinateValid ? 'GCJ-02' : null,
      mapCrs: 'GCJ-02',
      address: providerCoordinateValid ? String(sourceLocation.address ?? '') : '',
      geocodeSource: providerCoordinateValid ? String(sourceLocation.geocodeSource ?? '') : '',
      geocodeConfidence: providerCoordinateValid ? sourceLocation.geocodeConfidence ?? 'unknown' : 'unknown',
      locationConfidence: providerCoordinateValid ? sourceLocation.locationConfidence ?? sourceLocation.geocodeConfidence ?? 'unknown' : 'unknown',
      identityConfidence: providerCoordinateValid ? sourceLocation.identityConfidence ?? 'unknown' : 'unknown',
      positionType: providerCoordinateValid ? sourceLocation.positionType ?? null : null,
      locationGranularity: providerCoordinateValid ? sourceLocation.locationGranularity ?? null : null,
      providerPoiId: providerCoordinateValid ? sourceLocation.providerPoiId ?? null : null,
      evidenceClass: providerCoordinateValid ? sourceLocation.previewEvidenceClass ?? null : null,
      reviewVerdict: record.reviewVerdict ?? null,
      decisionOrigin: record.decisionOrigin ?? null,
      evidenceUrls: Array.isArray(record.supplemental?.evidenceUrls) ? record.supplemental.evidenceUrls : []
    },
    source: {
      maintainer: '@ArvinTingcn',
      document: '全球IMAX及特效影厅分布20260820',
      tab: 'IMAX中国',
      url: 'https://docs.qq.com/sheet/DQ3FEUUZJdklNSWJP?tab=BB08J2'
    }
  };
}

function getDefaultAdministrativeContext() {
  lazyDefaultAdministrativeContext ??= createAdministrativeBindingContext();
  return lazyDefaultAdministrativeContext;
}

export function hasProviderCoordinate(record) {
  return record?.location?.providerCrs === 'GCJ-02' &&
    validLatitude(record.location.providerLat) &&
    validLongitude(record.location.providerLng);
}

function validLatitude(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) && number >= -90 && number <= 90;
}

function validLongitude(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) && number >= -180 && number <= 180;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
}

function assertInputFile(inputFile) {
  if (!fs.existsSync(inputFile) || !fs.statSync(inputFile).isFile()) {
    throw new Error(`Missing local-only preview dataset: ${relative(inputFile)}`);
  }
}

function assertPrivateApp(appRoot) {
  for (const filename of ['index.html', 'app.mjs', 'styles.css']) {
    const target = path.join(appRoot, filename);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`Missing private AMap app asset: ${relative(target)}`);
    }
  }
}

function assertSafeOutput(outputRoot) {
  const rootPrefix = `${ROOT}${path.sep}`;
  if (!outputRoot.startsWith(rootPrefix) || path.basename(outputRoot) !== 'dist-private') {
    throw new Error(`Refusing to replace unsafe output directory: ${outputRoot}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}

function parseCliArguments(argv) {
  const options = {};
  for (const argument of argv) {
    if (argument.startsWith('--input=')) options.inputFile = path.resolve(ROOT, argument.slice(8));
    if (argument.startsWith('--output=')) options.outputRoot = path.resolve(ROOT, argument.slice(9));
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildPrivateAmapRelease(parseCliArguments(process.argv.slice(2)));
  console.log(JSON.stringify({
    ok: true,
    output: relative(result.outputRoot),
    records: result.records,
    located: result.located,
    unresolved: result.unresolved,
    coordinateSystem: result.coordinateSystem,
    apiKeyWritten: false
  }, null, 2));
}
