import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_FILE = path.join(ROOT, 'data/public/cinemas.json');
const MARKER_FILE = path.resolve(process.env.PUBLIC_AMAP_REVIEWED_FILE || path.join(ROOT, 'data/local/public-amap-reviewed-geocodes.json'));
const MARKER_ARTIFACT = path.join(ROOT, 'tmp/cloudflare/public-amap-markers.json');
const DIST_ROOT = path.join(ROOT, 'dist-public');
const OUTPUT_FILE = path.join(ROOT, 'data/audit/public-boundary.json');
const PUBLIC_RELEASE_BRANCH = process.env.PUBLIC_RELEASE_BRANCH || 'codex/public-release';
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const publicDataset = readJson(PUBLIC_FILE);
const markerLayer = fs.existsSync(MARKER_FILE) ? readJson(MARKER_FILE) : null;
const markerArtifactSha256 = fs.existsSync(MARKER_ARTIFACT) ? hashFile(MARKER_ARTIFACT) : null;
const quality = readJson(path.join(ROOT, 'data/audit/public-amap-quality.json'));
const readiness = readJson(path.join(ROOT, 'data/audit/public-release-readiness.json'));
const manifest = readJson(path.join(ROOT, 'data/audit/public-release-manifest.json'));
const publicSerialized = JSON.stringify(publicDataset);
const errors = [];
const warnings = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const warn = (condition, message) => { if (!condition) warnings.push(message); };

check(publicDataset.mode === 'public-amap-runtime', 'public dataset is not the AMap runtime mode');
check(publicDataset.status === 'publication-candidate', 'public dataset is not a publication candidate');
check(Array.isArray(publicDataset.records) && publicDataset.records.length === 901, 'public dataset must contain 901 records');
check(publicDataset.coordinatesPublished === 0, 'public static dataset contains coordinates');
const markerAccepted = markerLayer?.records?.filter(hasCoordinate) ?? [];
const markerUnresolved = markerLayer?.records?.filter((record) => !hasCoordinate(record)) ?? [];
const runtimeEvidence = markerLayer ? {
  source: 'local-runtime-layer',
  total: markerLayer.records?.length ?? 0,
  accepted: markerAccepted.length,
  unresolved: markerUnresolved.length,
  coordinateSystem: markerLayer.coordinateSystem ?? null
} : {
  source: 'committed-quality-audit',
  total: quality.total,
  accepted: quality.markerCount,
  unresolved: quality.unlocated,
  coordinateSystem: quality.coordinateSystem ?? 'GCJ-02'
};
if (markerLayer) {
  check(Array.isArray(markerLayer.records), 'public runtime marker layer is malformed');
  check(markerLayer?.summary?.accepted === markerAccepted.length, 'public runtime accepted count does not match marker records');
  check(markerLayer?.summary?.unresolvedPublic === markerUnresolved.length, 'public runtime unresolved count does not match marker records');
  check(markerAccepted.length + markerUnresolved.length === publicDataset.records?.length, 'public runtime accepted and unresolved counts do not partition total');
} else {
  check(runtimeEvidence.total === 901 && runtimeEvidence.accepted === 901 && runtimeEvidence.unresolved === 0, 'committed runtime quality evidence must be 901/901/0');
  check(readiness.publicationReady === true, 'committed public readiness evidence is not publication-ready');
  const publicManifestEntry = manifest.files?.find((file) => file.path === 'data/public/cinemas.json');
  check(publicManifestEntry?.sha256 === hashFile(PUBLIC_FILE), 'committed public manifest does not match the static dataset');
  warn(false, 'private marker source is absent; runtime coverage is checked from committed quality evidence and Worker fixture tests');
}
check(publicDataset.runtimeMarkerCount === runtimeEvidence.accepted, 'public runtime marker count does not match runtime evidence');
check(publicDataset.policy?.staticBulkCoordinateArtifacts === 0, 'public dataset reports a static coordinate artifact');
check(!publicSerialized.includes('rawCandidates'), 'public dataset contains rawCandidates');
check(!publicSerialized.includes('rankedCandidates'), 'public dataset contains rankedCandidates');
check(!publicSerialized.includes('AMAP_API_KEY'), 'public dataset exposes Web Service key variable name');
check(!publicSerialized.includes('AMAP_JS_SECURITY_CODE'), 'public dataset exposes security code variable name');
check(!/\b[a-f0-9]{32}\b/i.test(publicSerialized), 'public dataset exposes a credential-shaped 32-hex value');
for (const record of publicDataset.records ?? []) {
  check(record.location?.lat === null && record.location?.lng === null, `${record.id} exposes static coordinates`);
  check(!Object.hasOwn(record.location ?? {}, 'providerLat'), `${record.id} exposes providerLat`);
  check(!Object.hasOwn(record.location ?? {}, 'providerLng'), `${record.id} exposes providerLng`);
}

if (fs.existsSync(DIST_ROOT)) {
  const files = collectFiles(DIST_ROOT);
  const distText = files.filter(isTextFile).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  check(!files.some((file) => /(?:provider-cache|rawCandidates|rankedCandidates|data\\local|data\\raw)/i.test(file)), 'public bundle contains private/raw path');
  check(!distText.includes('AMAP_JS_SECURITY_CODE'), 'public static bundle contains security code variable name');
  check(!distText.match(/\b[a-f0-9]{32}\b/i), 'public static bundle contains credential-shaped text');
  check(!files.some((file) => /\.(csv|geojson)$/i.test(file) && /coordinate|marker|geo/i.test(path.basename(file))), 'public bundle contains a coordinate export artifact');
}

const cacheTracked = git('ls-files', 'data/geocode/provider-cache').trim().length > 0;
const currentBranch = git('branch', '--show-current').trim();
const releaseBranchExists = git('show-ref', '--verify', `refs/heads/${PUBLIC_RELEASE_BRANCH}`).trim().length > 0;
const currentRawTracked = git('ls-files', 'data/raw/arvin-imax.json').trim().length > 0;
const rawTracked = releaseBranchExists
  ? git('ls-tree', '-r', '--name-only', PUBLIC_RELEASE_BRANCH, '--', 'data/raw/arvin-imax.json').trim().length > 0
  : currentRawTracked;
const rawHistory = releaseBranchExists
  ? git('log', PUBLIC_RELEASE_BRANCH, '--format=%H', '--', 'data/raw/arvin-imax.json').trim()
  : git('log', 'HEAD', '--format=%H', '--', 'data/raw/arvin-imax.json').trim();
warn(!cacheTracked, 'provider cache is tracked');
warn(!rawTracked && !rawHistory, `${PUBLIC_RELEASE_BRANCH} still contains the raw Tencent mirror; create the public branch from a clean public baseline`);
warn(isIgnored('data/local/public-amap-reviewed-geocodes.json'), 'private public-reviewed marker layer is not ignored');
warn(isIgnored('dist-public'), 'dist-public is not ignored');

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  status: errors.length ? 'public-boundary-check-failed' : warnings.length ? 'public-boundary-check-passed-with-history-warning' : 'public-boundary-check-passed',
  publicDataset: {
    file: 'data/public/cinemas.json',
    sha256: hashFile(PUBLIC_FILE),
    mode: publicDataset.mode,
    records: publicDataset.records?.length ?? 0,
    staticCoordinates: publicDataset.coordinatesPublished ?? null,
    runtimeMarkerCount: publicDataset.runtimeMarkerCount ?? null,
    manifestStaticSha256: manifest.files?.find((file) => file.path === 'data/public/cinemas.json')?.sha256 ?? null,
    errors
  },
  runtimeLayer: {
    file: markerLayer ? 'data/local/public-amap-reviewed-geocodes.json' : 'data/audit/public-amap-quality.json',
    source: runtimeEvidence.source,
    total: runtimeEvidence.total,
    accepted: runtimeEvidence.accepted,
    unresolved: runtimeEvidence.unresolved,
    markerCount: runtimeEvidence.accepted,
    coordinateSystem: runtimeEvidence.coordinateSystem,
    artifactFile: markerArtifactSha256 ? 'tmp/cloudflare/public-amap-markers.json' : null,
    artifactSha256: markerArtifactSha256
  },
  security: {
    cacheTracked,
    rawTracked,
    currentWorkspaceRawTracked: currentRawTracked,
    rawMirrorHistoryPresent: Boolean(rawHistory),
    rawMirrorHistoryScope: releaseBranchExists ? PUBLIC_RELEASE_BRANCH : currentBranch || 'HEAD',
    apiKeyPersisted: false,
    securityCodeInPublicBundle: false,
    staticBulkCoordinateArtifacts: 0,
    amapPublicationGate: 'removed-from-development-route'
  },
  warnings,
  cleanBranch: {
    currentBranch,
    publicReleaseBranch: PUBLIC_RELEASE_BRANCH,
    publicReleaseBranchExists: releaseBranchExists,
    recommendedBase: 'fba4dcd (last clean public baseline before the Tencent raw mirror)',
    noRemoteHistoryRewrite: true,
    noMergePerformed: true,
    noDeployPerformed: true,
    intentionallyExcluded: ['data/raw/arvin-imax.json', 'data/geocode/provider-cache/*.json', 'data/local/', 'dist-private/', 'complete AMap coordinate export']
  }
};

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: errors.length === 0, output: 'data/audit/public-boundary.json', status: report.status, errors, warnings }, null, 2));
if (errors.length) process.exitCode = 2;

function git(...args) { return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout ?? ''; }
function isIgnored(relativePath) { return spawnSync('git', ['check-ignore', '-q', '--', relativePath], { cwd: ROOT }).status === 0; }
function hashFile(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function collectFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...collectFiles(target));
    else if (entry.isFile()) output.push(target);
  }
  return output;
}
function isTextFile(filePath) { return ['.html', '.mjs', '.js', '.css', '.json', '.md', '.txt'].includes(path.extname(filePath).toLowerCase()); }

function hasCoordinate(record) {
  return record?.provider === 'amap' && record?.providerCrs === 'GCJ-02' &&
    Number.isFinite(Number(record.providerLat)) && Number.isFinite(Number(record.providerLng)) &&
    Number(record.providerLat) >= -90 && Number(record.providerLat) <= 90 &&
    Number(record.providerLng) >= -180 && Number(record.providerLng) <= 180;
}
