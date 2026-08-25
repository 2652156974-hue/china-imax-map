import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'data/audit/public-release-manifest.json');
const publicFiles = [
  '.env.example',
  '.gitignore',
  'README.md',
  'PROJECT_STATUS.md',
  'index.html',
  'app.mjs',
  'styles.css',
  '_headers',
  'wrangler.jsonc',
  'tsconfig.json',
  'package.json',
  'package-lock.json',
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
  'scripts/build-public-manifest.mjs',
  'scripts/build-public-release.mjs',
  'scripts/build-cloudflare-public.mjs',
  'scripts/prepare-public-deploy.mjs',
  'scripts/public-marker-core.mjs',
  'scripts/public-amap-server.mjs',
  'scripts/public-amap-server.test.mjs',
  'scripts/public-boundary.test.mjs',
  'scripts/public-data.test.mjs',
  'scripts/cloudflare-worker.test.mjs',
  'scripts/validate-public.mjs',
  'scripts/validate-public-boundary.mjs',
  'scripts/start-public-map.ps1',
  'scripts/stop-public-map.ps1',
  'worker/index.mjs',
  'worker/types.d.ts',
  'scripts/map-data-adapter.mjs',
  'scripts/map-data-adapter.test.mjs',
  'scripts/map-frontend.test.mjs',
  'scripts/fixtures/amap-js-sdk.mock.js',
  'dist-public/index.html',
  'dist-public/app.mjs',
  'dist-public/styles.css',
  'dist-public/_headers',
  'dist-public/data/cinemas.json'
];

const quality = readJson('data/audit/public-amap-quality.json');
const readiness = readJson('data/audit/public-release-readiness.json');
const boundary = readJson('data/audit/public-boundary.json');
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  manifestType: 'public-release',
  status: readiness.status,
  publicationReady: readiness.publicationReady === true,
  scope: 'Public source, static facts, runtime marker service, public-safe audits, tests and documentation.',
  files: publicFiles.map(fileEntry),
  counts: {
    total: quality.total,
    accepted: quality.accepted,
    locationOnly: readiness.currentAcceptance?.locationOnly ?? null,
    unlocated: quality.unlocated,
    acceptedPlusUnlocated: quality.acceptedPlusUnlocated,
    markerCount: quality.markerCount,
    screenSeatRawFieldMatches: readiness.staticFactLayer?.rawFieldMatches ?? null
  },
  invariants: {
    acceptedPlusUnlocatedEqualsTotal: quality.accepted + quality.unlocated === quality.total,
    markerCountEqualsAccepted: quality.markerCount === quality.accepted,
    staticCoordinates: boundary.publicDataset?.staticCoordinates ?? null,
    sourceRowAssociation: 'sourceRow/id only'
  },
  security: {
    rawSnapshotIncluded: false,
    providerCacheIncluded: false,
    rawCandidatesIncluded: false,
    securityCodeInPublicBundle: boundary.security?.securityCodeInPublicBundle === true,
    staticBulkCoordinateArtifacts: boundary.security?.staticBulkCoordinateArtifacts ?? null,
    publicBoundaryStatus: boundary.status
  },
  exclusions: ['raw source snapshots', 'provider cache', 'local marker source', 'bulk coordinate export', 'runtime credentials'],
  noRemotePushOrDeploy: true
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, output: 'data/audit/public-release-manifest.json', files: publicFiles.length, publicationReady: manifest.publicationReady }, null, 2));

function fileEntry(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) throw new Error(`Missing public manifest input: ${relativePath}`);
  const buffer = fs.readFileSync(fullPath);
  return { path: relativePath, bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}
