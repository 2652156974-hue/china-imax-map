import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProjectManifest } from './build-project-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'data', 'audit', 'project-integrity.json');

const requiredFiles = [
  'README.md',
  'PROJECT_STATUS.md',
  'package.json',
  'index.html',
  'docs/README.md',
  'docs/PROJECT_STRUCTURE.md',
  'data/README.md',
  'scripts/README.md',
  'data/raw/arvin-imax.json',
  'data/derived/cinemas.json',
  'data/derived/cinemas.schema.json',
  'data/derived/review-needed.json',
  'data/derived/screen-seat-columns.csv',
  'data/public/cinemas.json',
  'app.mjs',
  'focus-navigation.mjs',
  'styles.css',
  'focus-navigation.css',
  'private-amap/index.html',
  'scripts/derive-cinemas.mjs',
  'scripts/validate-derived.mjs',
  'scripts/build-public-dataset.mjs',
  'scripts/build-public-amap-layer.mjs',
  'scripts/build-public-release.mjs',
  'scripts/focus-navigation.test.mjs',
  'scripts/public-amap-server.mjs',
  'scripts/start-public-map.ps1',
  'scripts/stop-public-map.ps1',
  'scripts/validate-public.mjs',
  'scripts/build-private-amap-release.mjs',
  'scripts/build-luna-geocode-review.mjs'
];

const checks = [];
const addCheck = (id, status, message, details = undefined) => {
  checks.push({ id, status, message, ...(details === undefined ? {} : { details }) });
};

const missingFiles = requiredFiles.filter(relativePath => !fs.existsSync(resolve(relativePath)));
addCheck(
  'required-project-files',
  missingFiles.length ? 'fail' : 'pass',
  missingFiles.length ? `${missingFiles.length} required project files are missing.` : 'All required project files are present.',
  { required: requiredFiles.length, missing: missingFiles }
);

const datasets = {
  derived: inspectDataset('data/derived/cinemas.json'),
  public: inspectDataset('data/public/cinemas.json'),
  localPreview: fs.existsSync(resolve('data/local/cinemas-preview.json'))
    ? {
      ...inspectDataset('data/local/cinemas-preview.json'),
      role: 'legacy-accepted-high-baseline-diagnostic',
      currentReleaseLayer: false
    }
    : null
};

addCheck(
  'dataset-record-counts',
  datasets.derived.records === 901 && datasets.public.records === 901 ? 'pass' : 'fail',
  `Derived/public records: ${datasets.derived.records}/${datasets.public.records}.`,
  datasets
);
addCheck(
  'formal-coordinate-boundary',
  datasets.derived.coordinates === 0 && datasets.public.coordinates === 0 ? 'pass' : 'fail',
  datasets.derived.coordinates === 0 && datasets.public.coordinates === 0
    ? 'Formal derived and public static datasets contain no coordinates; public runtime markers are served separately.'
    : 'Coordinates were found in a formal dataset and require review.',
  { derivedCoordinates: datasets.derived.coordinates, publicCoordinates: datasets.public.coordinates }
);
if (datasets.localPreview) {
  addCheck(
    'local-preview-coordinate-layer',
    datasets.localPreview.records === 901 ? 'pass' : 'fail',
    `Legacy ignored preview contains ${datasets.localPreview.coordinates} positioned records and ${datasets.localPreview.nullCoordinates} unresolved records; it is not the current reviewed release layer.`,
    datasets.localPreview
  );
} else {
  addCheck('local-preview-coordinate-layer', 'warn', 'Ignored local preview is absent; this does not affect the public project.');
}

const tracked = new Set(runGit(['ls-files']).split(/\r?\n/).filter(Boolean).map(toPosix));
const privateBoundaryPaths = [
  'data/geocode/provider-cache/amap.json',
  'data/geocode/provider-cache/tencent.json',
  'data/geocode/provider-cache/nominatim.json',
  'data/local/cinemas-preview.json',
  'data/local/luna-geocode-review-323.json',
  'data/local/public-amap-reviewed-geocodes.json',
  'dist-public/data/cinemas.json',
  'dist-private/data/cinemas.json'
];
const existingPrivateFiles = privateBoundaryPaths.filter(relativePath => fs.existsSync(resolve(relativePath)));
const privateBoundaryFailures = existingPrivateFiles.filter(relativePath => tracked.has(relativePath) || !isIgnored(relativePath));
addCheck(
  'private-artifact-git-boundary',
  privateBoundaryFailures.length ? 'fail' : 'pass',
  privateBoundaryFailures.length
    ? 'One or more private artifacts are tracked or not ignored.'
    : 'Existing provider caches, local review files, and private release data are ignored and untracked.',
  { checked: existingPrivateFiles, failures: privateBoundaryFailures }
);

const rawTracked = tracked.has('data/raw/arvin-imax.json');
addCheck(
  'raw-snapshot-release-gate',
  rawTracked ? 'warn' : 'pass',
  rawTracked
    ? 'The audited raw snapshot is tracked on this draft branch; do not merge this branch directly into public main.'
    : 'The audited raw snapshot is not tracked.',
  { path: 'data/raw/arvin-imax.json', tracked: rawTracked, localFilePreserved: fs.existsSync(resolve('data/raw/arvin-imax.json')) }
);

const sourceSecretFindings = scanSourceForCredentialLikeValues();
const environmentSecretFindings = scanForCurrentEnvironmentSecrets();
addCheck(
  'credential-leak-scan',
  sourceSecretFindings.length || environmentSecretFindings.length ? 'fail' : 'pass',
  sourceSecretFindings.length || environmentSecretFindings.length
    ? 'Potential credential material was found in project files.'
    : 'No 32-character credential-like literal or current environment credential was found in project files.',
  {
    credentialLikeFindings: sourceSecretFindings,
    currentEnvironmentSecretMatches: environmentSecretFindings,
    valuesIncludedInReport: false
  }
);

const mainland = readJson('data/audit/geocode-mainland-quality.json').summary;
const regional = readJson('data/audit/geocode-hkmo-tw.json').summary;
const privateReviewed = fs.existsSync(resolve('data/local/private-reviewed-geocodes.json'))
  ? readJson('data/local/private-reviewed-geocodes.json')
  : null;
const privateQuality = fs.existsSync(resolve('data/audit/private-release-quality.json'))
  ? readJson('data/audit/private-release-quality.json')
  : null;
const currentAutomaticHigh = privateQuality?.automaticHigh ?? mainland.automaticHigh;
const currentReviewedOverrideHigh = privateQuality?.reviewedOverrideHigh ?? mainland.reviewedOverrideHigh;
const currentAutomaticMedium = privateQuality?.automaticMedium ?? mainland.automaticMedium;
const currentReviewedRejections = privateQuality?.reviewedRejections ?? privateReviewed?.summary?.reviewedRejections ?? 0;
const currentPendingOrUnresolved = privateReviewed?.summary
  ? privateReviewed.summary.pendingReview + privateReviewed.summary.unresolved
  : currentAutomaticMedium + mainland.unresolved + regional.unresolved + currentReviewedRejections;
const currentLocated = privateQuality?.located ?? privateReviewed?.summary?.located ?? datasets.localPreview?.coordinates ?? currentAutomaticHigh + currentReviewedOverrideHigh;
const currentUnlocated = privateQuality?.unlocated ?? currentPendingOrUnresolved;
const publicQuality = fs.existsSync(resolve('data/audit/public-amap-quality.json'))
  ? readJson('data/audit/public-amap-quality.json')
  : null;
const runtimePartitionValid = Boolean(
  publicQuality &&
  publicQuality.total === datasets.derived.records &&
  publicQuality.accepted + publicQuality.unlocated === publicQuality.total &&
  publicQuality.markerCount === publicQuality.accepted
);
const privatePartitionValid = Boolean(
  privateQuality &&
  privateQuality.total === datasets.derived.records &&
  privateQuality.accepted + privateQuality.unlocated === privateQuality.total &&
  privateQuality.markerCount === privateQuality.accepted &&
  privateQuality.located === privateQuality.accepted &&
  privateQuality.located + privateQuality.pendingReview + privateQuality.unresolved === privateQuality.total
);
addCheck(
  'private-reviewed-state-partition',
  privatePartitionValid ? 'pass' : 'fail',
  privatePartitionValid
    ? `Private reviewed states partition ${privateQuality.total} records: accepted/located ${privateQuality.accepted}, pending-review ${privateQuality.pendingReview}, unresolved ${privateQuality.unresolved}, unlocated ${privateQuality.unlocated}; accepted + unlocated = total and markerCount = accepted.`
    : 'Private reviewed layer does not satisfy accepted + unlocated = total, markerCount = accepted, and the dynamic three-state partition.',
  privateQuality
    ? { total: privateQuality.total, accepted: privateQuality.accepted, markerCount: privateQuality.markerCount, located: privateQuality.located, pendingReview: privateQuality.pendingReview, unresolved: privateQuality.unresolved, unlocated: privateQuality.unlocated, acceptedPlusUnlocated: privateQuality.acceptedPlusUnlocated }
    : null
);
addCheck(
  'public-runtime-marker-partition',
  runtimePartitionValid ? 'pass' : 'fail',
  runtimePartitionValid
    ? `Public runtime markers satisfy accepted ${publicQuality.accepted} + unlocated ${publicQuality.unlocated} = ${publicQuality.total}; markerCount equals accepted.`
    : 'Public runtime marker layer does not satisfy accepted + unlocated = total and markerCount = accepted.',
  publicQuality
    ? { total: publicQuality.total, accepted: publicQuality.accepted, unlocated: publicQuality.unlocated, markerCount: publicQuality.markerCount }
    : null
);
const reviewState = {
  automaticHigh: currentAutomaticHigh,
  reviewedOverrideHigh: currentReviewedOverrideHigh,
  reviewedRejections: currentReviewedRejections,
  localAccepted: currentLocated,
  automaticMedium: currentAutomaticMedium,
  mainlandUnresolved: mainland.unresolved,
  regionalUnresolved: regional.unresolved,
  totalPendingReviewOrUnresolved: currentUnlocated,
  unlocated: currentUnlocated,
  acceptedPlusUnlocated: currentLocated + currentUnlocated,
  markerCount: publicQuality?.markerCount ?? null
};
addCheck(
  'coordinate-review-state',
  'warn',
  `${reviewState.localAccepted} records are locally positioned; ${reviewState.totalPendingReviewOrUnresolved} still require review or remain unresolved.`,
  reviewState
);

const branch = runGit(['branch', '--show-current']).trim();
const head = runGit(['rev-parse', '--short', 'HEAD']).trim();
const counts = countBy(checks, check => check.status);
const integrity = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  project: 'china-imax-map',
  git: { branch, head },
  status: counts.fail ? 'failed' : counts.warn ? 'ok-with-release-gates' : 'ok',
  summary: { checks: checks.length, ...counts },
  datasets,
  coordinateReviewState: reviewState,
  releaseGates: [
    'Keep data/raw/arvin-imax.json out of the eventual public main history.',
    'Keep provider caches, rawCandidates and bulk coordinate files outside public artifacts; public markers are runtime-only AMap responses.',
    'Rotate AMAP_JS_SECURITY_CODE before production deployment if the value was previously exposed.'
  ],
  checks
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(integrity, null, 2)}\n`, 'utf8');
const manifestResult = buildProjectManifest({ generatedAt: integrity.generatedAt });

console.log(JSON.stringify({
  ok: integrity.status !== 'failed',
  status: integrity.status,
  output: toPosix(path.relative(ROOT, OUTPUT)),
  manifest: toPosix(path.relative(ROOT, manifestResult.output)),
  summary: integrity.summary,
  datasets,
  coordinateReviewState: reviewState
}, null, 2));

if (integrity.status === 'failed') process.exitCode = 1;

function inspectDataset(relativePath) {
  const document = readJson(relativePath);
  const records = Array.isArray(document) ? document : document.records;
  if (!Array.isArray(records)) throw new Error(`${relativePath} does not contain a records array.`);
  const coordinates = records.filter(record => validCoordinate(record.location)).length;
  return {
    path: relativePath,
    records: records.length,
    coordinates,
    nullCoordinates: records.length - coordinates
  };
}

function validCoordinate(location) {
  return Number.isFinite(location?.lat)
    && Number.isFinite(location?.lng)
    && location.lat >= -90 && location.lat <= 90
    && location.lng >= -180 && location.lng <= 180;
}

function scanSourceForCredentialLikeValues() {
  const sourceRoots = ['scripts', 'private-amap', 'docs'];
  const sourceFiles = [
    ...sourceRoots.flatMap(relativePath => collectTextFiles(resolve(relativePath))),
    ...['README.md', 'PROJECT_STATUS.md', 'index.html', 'package.json', '.env.example']
      .map(resolve)
      .filter(filePath => fs.existsSync(filePath))
  ];
  const matcher = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/gi;
  const findings = [];
  for (const filePath of new Set(sourceFiles)) {
    // Public evidence URLs may use a 32-hex content identifier in the path
    // (for example, a Ruyi article slug). Mask only URL path tokens so a real
    // standalone literal or a query-string credential is still detected.
    const text = maskUrlPathContentIds(fs.readFileSync(filePath, 'utf8'));
    const matches = text.match(matcher) || [];
    if (matches.length) findings.push({ path: toPosix(path.relative(ROOT, filePath)), matches: matches.length });
  }
  return findings;
}

function maskUrlPathContentIds(text) {
  return text.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
    const queryOrFragment = url.search(/[?#]/);
    const pathPart = queryOrFragment >= 0 ? url.slice(0, queryOrFragment) : url;
    const suffix = queryOrFragment >= 0 ? url.slice(queryOrFragment) : '';
    const maskedPath = pathPart.replace(/(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/gi, 'x'.repeat(32));
    return `${maskedPath}${suffix}`;
  });
}

function scanForCurrentEnvironmentSecrets() {
  const secrets = ['AMAP_API_KEY', 'AMAP_JS_API_KEY', 'AMAP_JS_SECURITY_CODE']
    .map(name => ({ name, value: currentCredentialValue(name) }))
    .filter(item => item.value.length >= 16);
  if (!secrets.length) return [];

  const findings = [];
  for (const filePath of collectTextFiles(ROOT, { includePrivate: true })) {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const secret of secrets) {
      if (text.includes(secret.value)) {
        findings.push({ path: toPosix(path.relative(ROOT, filePath)), environmentVariable: secret.name });
      }
    }
  }
  return findings;
}

function currentCredentialValue(name) {
  const processValue = String(process.env[name] || '').trim();
  if (processValue) return processValue;
  if (process.platform !== 'win32') return '';
  try {
    return execFileSync(
      'pwsh',
      ['-NoLogo', '-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${name}', 'User')`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
  } catch {
    return '';
  }
}

function collectTextFiles(directory, { includePrivate = false } = {}) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const excluded = new Set(['.git', '.playwright-cli', 'tmp', 'node_modules']);
  if (!includePrivate) {
    excluded.add('dist-private');
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTextFiles(fullPath, { includePrivate }));
      continue;
    }
    if (!entry.isFile() || !isTextFile(fullPath) || entry.name === 'project-integrity.json' || entry.name === 'project-manifest.json') continue;
    files.push(fullPath);
  }
  return files;
}

function isTextFile(filePath) {
  return ['.css', '.cmd', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.txt', ''].includes(path.extname(filePath).toLowerCase());
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(resolve(relativePath), 'utf8'));
}

function isIgnored(relativePath) {
  return spawnSync('git', ['check-ignore', '-q', '--', relativePath], { cwd: ROOT }).status === 0;
}

function runGit(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function resolve(relativePath) {
  return path.join(ROOT, relativePath);
}

function countBy(items, keyFn) {
  const result = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function toPosix(value) {
  return value.replaceAll('\\', '/');
}
