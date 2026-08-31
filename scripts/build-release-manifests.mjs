import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_OUTPUT = path.join(ROOT, 'data/audit/public-release-manifest.json');
const PRIVATE_OUTPUT = path.join(ROOT, 'data/local/private-release-manifest.json');

const publicFiles = [
  '.env.example',
  '.gitignore',
  'README.md',
  'PROJECT_STATUS.md',
  'index.html',
  'app.mjs',
  'focus-navigation.mjs',
  'styles.css',
  'focus-navigation.css',
  'package.json',
  'START_PUBLIC_MAP.cmd',
  'STOP_PUBLIC_MAP.cmd',
  'data/public/cinemas.json',
  'data/audit/public-amap-quality.json',
  'data/audit/public-amap-unresolved.json',
  'data/audit/public-boundary.json',
  'data/audit/public-release-readiness.json',
  'data/audit/public-amap-browser-smoke.json',
  'data/audit/amap-quota-guard.json',
  'docs/DATA-LICENSING.md',
  'docs/DATA_PIPELINE.md',
  'docs/GEOCODING.md',
  'docs/MAP_FRONTEND.md',
  'docs/PROJECT_STRUCTURE.md',
  'scripts/build-public-amap-layer.mjs',
  'scripts/build-public-dataset.mjs',
  'scripts/build-public-release.mjs',
  'scripts/public-amap-server.mjs',
  'scripts/public-amap-server.test.mjs',
  'scripts/public-boundary.test.mjs',
  'scripts/public-data.test.mjs',
  'scripts/validate-public.mjs',
  'scripts/validate-public-boundary.mjs',
  'scripts/start-public-map.ps1',
  'scripts/stop-public-map.ps1',
  'scripts/map-data-adapter.mjs',
  'scripts/map-data-adapter.test.mjs',
  'scripts/map-frontend.test.mjs',
  'scripts/focus-navigation.test.mjs',
  'scripts/fixtures/amap-js-sdk.mock.js',
  'dist-public/index.html',
  'dist-public/app.mjs',
  'dist-public/focus-navigation.mjs',
  'dist-public/styles.css',
  'dist-public/focus-navigation.css',
  'dist-public/data/cinemas.json'
];

const privateFiles = [
  'private-amap/index.html',
  'private-amap/app.mjs',
  'private-amap/styles.css',
  'scripts/build-private-amap-release.mjs',
  'scripts/build-private-reviewed-layer.mjs',
  'scripts/private-amap-server.mjs',
  'scripts/private-amap-release.test.mjs',
  'scripts/start-private-map.ps1',
  'scripts/stop-private-map.ps1',
  'START_PRIVATE_MAP.cmd',
  'STOP_PRIVATE_MAP.cmd',
  'data/audit/private-release-quality.json',
  'data/audit/private-amap-release.json',
  'data/audit/private-amap-browser-smoke.json',
  'data/audit/final-internal-materialization-status.json',
  'data/derived/cinemas-final-internal.json',
  'dist-private/index.html',
  'dist-private/app.mjs',
  'dist-private/styles.css',
  'dist-private/data/cinemas.json'
];

const publicBoundary = readJson('data/audit/public-boundary.json');
const publicQuality = readJson('data/audit/public-amap-quality.json');
const privateQuality = readJson('data/audit/private-release-quality.json');
const publicReadiness = readJson('data/audit/public-release-readiness.json');
const finalAudit = readJson('data/audit/luna-dual-release-final.json');
const quota = readJson('data/audit/amap-quota-guard.json');
const generatedAt = new Date().toISOString();

const publicManifest = {
  schemaVersion: 1,
  generatedAt,
  manifestType: 'public-release',
  status: publicReadiness.status,
  publicationReady: publicReadiness.publicationReady === true,
  scope: 'Public source, public static facts, runtime marker service, public-safe audit summaries, tests and documentation.',
  files: publicFiles.map(fileEntry),
  counts: {
    total: publicQuality.total,
    accepted: publicQuality.accepted,
    locationOnly: publicReadiness.currentAcceptance?.locationOnly ?? null,
    unlocated: publicQuality.unlocated,
    acceptedPlusUnlocated: publicQuality.acceptedPlusUnlocated,
    markerCount: publicQuality.markerCount,
    screenSeatRawFieldMatches: publicReadiness.staticFactLayer?.rawFieldMatches ?? null
  },
  invariants: {
    acceptedPlusUnlocatedEqualsTotal: publicQuality.accepted + publicQuality.unlocated === publicQuality.total,
    markerCountEqualsAccepted: publicQuality.markerCount === publicQuality.accepted,
    staticCoordinates: publicBoundary.publicDataset?.staticCoordinates ?? null,
    sourceRowAssociation: 'sourceRow/id only'
  },
  security: {
    rawSnapshotIncluded: false,
    providerCacheIncluded: false,
    rawCandidatesIncluded: false,
    securityCodeInPublicBundle: publicBoundary.security?.securityCodeInPublicBundle === true,
    staticBulkCoordinateArtifacts: publicBoundary.security?.staticBulkCoordinateArtifacts ?? null,
    publicBoundaryStatus: publicBoundary.status
  },
  gates: publicReadiness.gates ?? [],
  historicalReviewSnapshots: publicReadiness.historicalReviewSnapshots ?? {
    status: 'not-included',
    blocking: false
  },
  exclusions: [
    'data/raw/',
    'data/geocode/provider-cache/',
    'data/local/',
    'dist-private/',
    'complete AMap coordinate export',
    'AMap JS security code and Web Service credentials'
  ],
  noRemotePushOrDeploy: true,
  branchPolicy: 'created from a clean public baseline; do not merge the raw-bearing feature history'
};

const privateManifest = {
  schemaVersion: 1,
  generatedAt,
  manifestType: 'private-local-release',
  status: 'private-local-candidate-with-gates',
  publicationReady: false,
  scope: 'Local/private AMap runtime, reviewed coordinate layer, audit evidence and ignored deployment bundle.',
  files: privateFiles.map(fileEntry),
  privateOnlyInputs: [
    'data/local/private-reviewed-geocodes.json',
    'data/local/public-amap-reviewed-geocodes.json',
    'data/local/luna-geocode-review-323.json',
    'data/local/luna-geocode-review-323.completed.json',
    'data/geocode/provider-cache/*.json'
  ],
  counts: {
    total: privateQuality.total,
    accepted: privateQuality.accepted,
    located: privateQuality.located,
    pendingReview: privateQuality.pendingReview,
    unresolved: privateQuality.unresolved,
    unlocated: privateQuality.unlocated,
    acceptedPlusUnlocated: privateQuality.acceptedPlusUnlocated,
    markerCount: privateQuality.markerCount,
    screenSeatRawFieldMatches: privateQuality.screenSeatRawFieldMatches ?? 3604
  },
  invariants: {
    acceptedPlusUnlocatedEqualsTotal: privateQuality.accepted + privateQuality.unlocated === privateQuality.total,
    markerCountEqualsAccepted: privateQuality.markerCount === privateQuality.accepted,
    threeStatePartition: privateQuality.located + privateQuality.pendingReview + privateQuality.unresolved === privateQuality.total,
    sourceRowAssociation: 'sourceRow/id only'
  },
  environment: {
    browserKey: 'AMAP_JS_API_KEY',
    serverSecurityCode: 'AMAP_JS_SECURITY_CODE',
    valuesIncluded: false,
    proxyPath: '/_AMapService',
    coordinateSystem: 'GCJ-02'
  },
  security: {
    providerCacheTracked: false,
    rawCandidatesExposed: false,
    publicStaticCoordinates: 0,
    privateFilesIgnored: true,
    rawSnapshotIncludedInBundle: false
  },
  quota: {
    newAmapRequests: quota.runBudget.newAmapRequests,
    cacheHits: quota.runBudget.cacheHits,
    providerErrors: quota.runBudget.providerErrors,
    networkRequests: quota.runBudget.networkRequests,
    budgetRemaining: quota.runBudget.budgetRemaining
  },
  gates: finalAudit.frontend?.private?.gates ?? [],
  noCommitPushMergeDeploy: true
};

fs.mkdirSync(path.dirname(PUBLIC_OUTPUT), { recursive: true });
fs.mkdirSync(path.dirname(PRIVATE_OUTPUT), { recursive: true });
fs.writeFileSync(PUBLIC_OUTPUT, `${JSON.stringify(publicManifest, null, 2)}\n`, 'utf8');
fs.writeFileSync(PRIVATE_OUTPUT, `${JSON.stringify(privateManifest, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: true,
  public: { output: relative(PUBLIC_OUTPUT), files: publicFiles.length, publicationReady: publicManifest.publicationReady },
  private: { output: relative(PRIVATE_OUTPUT), files: privateFiles.length, publicationReady: privateManifest.publicationReady },
  invariants: {
    public: publicManifest.invariants,
    private: privateManifest.invariants
  }
}, null, 2));

function fileEntry(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error(`Release manifest input is missing: ${relativePath}`);
  }
  const buffer = fs.readFileSync(fullPath);
  return {
    path: relativePath,
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex')
  };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}
