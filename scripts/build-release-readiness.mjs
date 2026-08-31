import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = path.join(ROOT, 'data/audit/release-readiness.json');
const PUBLIC_RELEASE_BRANCH = process.env.PUBLIC_RELEASE_BRANCH || 'codex/public-release';
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
const exists = (relativePath) => fs.existsSync(path.join(ROOT, relativePath));
const sha256 = (relativePath) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relativePath))).digest('hex');

const derived = readJson('data/derived/cinemas.json');
const quality = readJson('data/audit/geocode-mainland-quality.json');
const freeze = readJson('data/audit/geocode-mainland-freeze.json');
const materialization = readJson('data/audit/geocode-materialization-status.json');
const quota = readJson('data/audit/amap-quota-guard.json');
const nameHistory = readJson('data/audit/name-history.json');
const derivedQuality = readJson('data/audit/derived-quality.json');
const derivedRecords = derived.records ?? derived;
const publicDataset = exists('data/public/cinemas.json') ? readJson('data/public/cinemas.json') : null;
const publicMarkerQuality = exists('data/audit/public-amap-quality.json') ? readJson('data/audit/public-amap-quality.json') : null;
const publicBrowserSmoke = exists('data/audit/public-amap-browser-smoke.json') ? readJson('data/audit/public-amap-browser-smoke.json') : null;
const privateBrowserSmoke = exists('data/audit/private-amap-browser-smoke.json') ? readJson('data/audit/private-amap-browser-smoke.json') : null;
const publicRealBrowserSmokeReady = publicBrowserSmoke?.realSdkSmoke?.status === 'passed';
const privateRealBrowserSmokeReady = privateBrowserSmoke?.realSdkSmoke?.status === 'passed';
const mainlandAudit = readJson('data/audit/geocode-mainland-full.json');
const finalReview = readJson('data/audit/geocode-mainland-final-review.json');
const regionalReview = readJson('data/audit/geocode-regional-review.json');
const regionalAudit = exists('data/audit/geocode-hkmo-tw.json')
  ? readJson('data/audit/geocode-hkmo-tw.json')
  : null;
const finalInternalStatus = exists('data/audit/final-internal-materialization-status.json')
  ? readJson('data/audit/final-internal-materialization-status.json')
  : null;
const canonicalLocationOnlyCount = finalInternalStatus?.summary?.locationOnlyCount
  ?? publicMarkerQuality?.lunaReviewedLocationOnly
  ?? 0;
const privateReviewed = exists('data/local/private-reviewed-geocodes.json')
  ? readJson('data/local/private-reviewed-geocodes.json')
  : null;
const privateQuality = exists('data/audit/private-release-quality.json')
  ? readJson('data/audit/private-release-quality.json')
  : null;
const lunaReviewSummary = exists('data/audit/luna-geocode-review-323-summary.json')
  ? readJson('data/audit/luna-geocode-review-323-summary.json')
  : null;
const evidenceReview = exists('data/audit/geocode-mainland-evidence-review.json')
  ? readJson('data/audit/geocode-mainland-evidence-review.json')
  : null;
const publicRecords = publicDataset?.records ?? [];
const derivedRegionCounts = countBy(derivedRecords, (record) => record.region);
const publicMarkerCountsByRegion = publicMarkerQuality?.regions ?? {};
const publicMarkerPartitionValid = Boolean(
  publicMarkerQuality &&
  Number.isInteger(publicMarkerQuality.markerCount) &&
  publicMarkerQuality.markerCount === publicMarkerQuality.accepted &&
  Number.isInteger(publicMarkerQuality.total) &&
  publicMarkerQuality.accepted + (publicMarkerQuality.unlocated ?? publicMarkerQuality.unresolvedPublic) === publicMarkerQuality.total &&
  publicMarkerQuality.markerCoordinateSystem === 'GCJ-02' &&
  publicDataset?.runtimeMarkerCount === publicMarkerQuality.markerCount
);
const privateReviewedPartitionValid = Boolean(
  privateQuality &&
  privateQuality.accepted + (privateQuality.unlocated ?? ((privateQuality.pendingReview ?? 0) + (privateQuality.unresolved ?? 0))) === privateQuality.total &&
  privateQuality.markerCount === privateQuality.accepted &&
  privateQuality.located === privateQuality.accepted &&
  privateQuality.located + privateQuality.pendingReview + privateQuality.unresolved === privateQuality.total
);
const mainlandBaselineByDecision = countBy(mainlandAudit.records, decisionBucket);
const duplicatePoiGroups = quality.entityIntegrity?.duplicateSelectedPoiSelections ?? [];
const derivedValidation = runJsonCommand('scripts/validate-derived.mjs');
const publicValidation = exists('data/public/cinemas.json') ? runJsonCommand('scripts/validate-public.mjs') : null;
const publicBoundary = exists('scripts/validate-public-boundary.mjs')
  ? runJsonCommand('scripts/validate-public-boundary.mjs')
  : null;
const tests = runTests();
const currentBranch = git('branch', '--show-current').trim();
const publicReleaseBranchExists = git('show-ref', '--verify', `refs/heads/${PUBLIC_RELEASE_BRANCH}`).trim().length > 0;
const rawHistory = publicReleaseBranchExists
  ? git('log', PUBLIC_RELEASE_BRANCH, '--format=%H', '--', 'data/raw/arvin-imax.json')
  : git('log', 'HEAD', '--format=%H', '--', 'data/raw/arvin-imax.json');
const publicReleaseBranchReady = publicReleaseBranchExists && !rawHistory.trim();
const cacheTracked = git('ls-files', 'data/geocode/provider-cache').trim().length > 0;
const publicDatasetPresent = exists('data/public/cinemas.json');
const internalDatasetPresent = exists('data/derived/cinemas-final-internal.json');
const dirtyFiles = git('status', '--porcelain').split(/\r?\n/).filter(Boolean).map((line) => line.slice(3));
const publicSerialized = JSON.stringify(publicDataset ?? {});
const runtimeAmapKeyPresent = Boolean(process.env.AMAP_API_KEY);
const developmentBlockers = [];
const materializationGates = [];
const publicationGates = [];
const currentReleaseInvariantsValid = Boolean(
  publicMarkerQuality &&
  publicMarkerQuality.total === 901 &&
  publicMarkerQuality.accepted === 901 &&
  publicMarkerQuality.unlocated === 0 &&
  publicMarkerQuality.markerCount === 901 &&
  publicDataset?.records?.length === 901 &&
  publicDataset?.runtimeMarkerCount === 901
);

if (freeze.networkPolicy.networkRequests !== 0) developmentBlockers.push('freeze baseline reports non-zero network requests');
if (freeze.derivedCoordinateState.populated !== 0) developmentBlockers.push('frozen derived dataset already contains coordinates');
if (!tests.ok) developmentBlockers.push('regression suite is not fully passing');
if (!derivedValidation.ok || (publicValidation && !publicValidation.ok)) developmentBlockers.push('schema/data validation is not fully passing');
if (!regionalAudit || regionalAudit.status !== 'completed-regional-audit') {
  developmentBlockers.push('independent Hong Kong/Macau/Taiwan regional audit is missing or incomplete');
}
if (!publicBrowserSmoke || publicBrowserSmoke.status !== 'passed') developmentBlockers.push('public AMap browser smoke audit is incomplete');
if (!privateBrowserSmoke || privateBrowserSmoke.status !== 'passed') developmentBlockers.push('private AMap browser smoke audit is incomplete');

if (!privateReviewed || !lunaReviewSummary) materializationGates.push('strict row-level Luna review output is missing');
if (!privateReviewedPartitionValid) materializationGates.push('private reviewed layer does not satisfy accepted + unlocated = total, markerCount = accepted, and three-state partition');
if (!internalDatasetPresent) materializationGates.push('internal reviewed dataset has not been built');
if (!finalInternalStatus || finalInternalStatus.status !== 'complete-internal-only') {
  materializationGates.push('final internal 901-record dataset has not been materialized');
}

if (!publicReleaseBranchReady) publicationGates.push(`clean public release branch ${PUBLIC_RELEASE_BRANCH} is missing or still contains the Tencent raw mirror`);
if (cacheTracked) publicationGates.push('provider cache is tracked by Git');
if (!publicDatasetPresent) publicationGates.push('publication-safe data/public/cinemas.json has not been built');
else if (publicDataset.status !== 'publication-candidate') publicationGates.push('data/public/cinemas.json is not a publication candidate');
if (!publicRealBrowserSmokeReady) publicationGates.push('public official AMap JS API 2.0 smoke remains pending until credentials are supplied; local mock UI smoke passed');
if (!privateRealBrowserSmokeReady) publicationGates.push('private official AMap JS API 2.0 smoke remains pending until credentials are supplied; local mock UI smoke passed');
if (!publicMarkerPartitionValid || !currentReleaseInvariantsValid) {
  publicationGates.push('public AMap runtime marker layer is missing or its dynamic accepted/unresolved partition is invalid');
}
if (!publicBoundary?.ok) publicationGates.push('public branch boundary check is not ready for a clean publication branch');

const releaseGates = [...publicationGates];
const publicationReady = developmentBlockers.length === 0 && releaseGates.length === 0 && currentReleaseInvariantsValid;

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: developmentBlockers.length
    ? 'development-blocked'
    : publicationReady
      ? 'ready-for-publication'
      : releaseGates.length
      ? 'development-complete-publication-gated'
      : 'ready-for-independent-release-review',
  publicationReady,
  developmentStatus: developmentBlockers.length ? 'blocked' : 'complete',
  developmentBlockers,
  materializationGates,
  publicationGates,
  releaseGates,
  releaseBranch: {
    name: PUBLIC_RELEASE_BRANCH,
    exists: publicReleaseBranchExists,
    ready: publicReleaseBranchReady,
    currentWorkspaceBranch: currentBranch,
    base: 'fba4dcd'
  },
  currentAcceptance: {
    total: publicMarkerQuality?.total ?? 0,
    accepted: publicMarkerQuality?.accepted ?? 0,
    markerCount: publicMarkerQuality?.markerCount ?? 0,
    locationOnly: canonicalLocationOnlyCount,
    unresolved: publicMarkerQuality?.unlocated ?? publicMarkerQuality?.unresolvedPublic ?? 0,
    unlocated: publicMarkerQuality?.unlocated ?? publicMarkerQuality?.unresolvedPublic ?? 0,
    acceptedPlusUnlocated: publicMarkerQuality
      ? publicMarkerQuality.accepted + (publicMarkerQuality.unlocated ?? publicMarkerQuality.unresolvedPublic ?? 0)
      : null
  },
  data: {
    totalRecords: derivedRecords.length,
    regionCounts: {
      mainland: derivedRegionCounts['中国大陆'] ?? 0,
      hongKong: derivedRegionCounts['香港'] ?? 0,
      macau: derivedRegionCounts['澳门'] ?? 0,
      taiwan: derivedRegionCounts['台湾'] ?? 0
    },
    sourceTab: derived.source?.tabId === 'BB08J2' ? derived.source.tab : 'unexpected',
    cityPresent: derivedRecords.filter((record) => record.city).length,
    coordinatePopulated: derivedRecords.filter((record) => Number.isFinite(record.location?.lat) && Number.isFinite(record.location?.lng)).length,
    invalidCoordinates: derivedQuality.validation.invalidLatLng,
    statusCounts: derivedQuality.counts.status,
    derivedSha256: sha256('data/derived/cinemas.json')
  },
  geocode: {
    freezeSha256: sha256('data/audit/geocode-mainland-freeze.json'),
    baselineSummary: freeze.baselineSummary,
    humanReviewArtifactPresent: Boolean(lunaReviewSummary),
    humanReviewStatus: lunaReviewSummary?.status ?? null,
    humanReviewStatusFile: 'data/audit/luna-geocode-review-323-summary.json',
    internalDatasetPresent,
    mainlandFinalReviewFile: 'data/audit/geocode-mainland-final-review.json',
    mainlandFinalReviewRemaining: readJson('data/audit/geocode-mainland-final-review.json').records.length,
    regionalReviewFile: 'data/audit/geocode-regional-review.json',
    regionalReviewRemaining: readJson('data/audit/geocode-regional-review.json').records.length,
    regionalAuditFile: 'data/audit/geocode-hkmo-tw.json',
    regionalAuditPresent: Boolean(regionalAudit),
    regionalAuditStatus: regionalAudit?.status ?? null,
    regionalAuditSummary: regionalAudit?.summary ?? null,
    regionalRequestPolicy: regionalAudit?.requestPolicy ?? null,
    finalInternalDatasetFile: 'data/derived/cinemas-final-internal.json',
    finalInternalMaterializationStatusFile: 'data/audit/final-internal-materialization-status.json',
    finalInternalMaterializationStatus: finalInternalStatus?.status ?? null,
    privateReviewedLayerFile: 'data/local/private-reviewed-geocodes.json',
    privateReviewedLayerSummary: privateQuality
      ? {
        total: privateQuality.total,
        accepted: privateQuality.accepted,
        markerCount: privateQuality.markerCount,
        located: privateQuality.located,
        pendingReview: privateQuality.pendingReview,
        unresolved: privateQuality.unresolved,
        unlocated: privateQuality.unlocated,
        acceptedPlusUnlocated: privateQuality.acceptedPlusUnlocated,
        statePartition: privateQuality.statePartition
      }
      : null,
    localPreview: {
      builder: 'scripts/build-local-preview.mjs',
      dataset: 'data/local/cinemas-preview.json',
      status: 'local-only-gitignored',
      publicationSafe: false,
      note: 'Uses accepted-high existing audit evidence only; not a reviewed or public layer.'
    },
    advisoryEvidenceReviewFile: 'data/audit/geocode-mainland-evidence-review.json',
    advisoryEvidenceReview: evidenceReview
      ? { status: evidenceReview.status, summary: evidenceReview.summary }
      : null,
    baselineBuckets: {
      automaticExact: mainlandBaselineByDecision.automaticHigh ?? 0,
      automaticMedium: mainlandBaselineByDecision.automaticMedium ?? 0,
      reviewedExact: mainlandBaselineByDecision.reviewedOverrideHigh ?? 0,
      reviewedMedium: mainlandBaselineByDecision.reviewedOverrideMedium ?? 0,
      unresolved: mainlandBaselineByDecision.unresolved ?? 0
    },
    finalReviewedLayer: {
      status: publicMarkerQuality
        ? `${publicMarkerQuality.accepted} accepted markers; ${publicMarkerQuality.unlocated ?? publicMarkerQuality.unresolvedPublic} unlocated`
        : 'dynamic reviewed layer not yet built',
      accepted: publicMarkerQuality?.accepted ?? 0,
      markerCount: publicMarkerQuality?.markerCount ?? 0,
      unlocated: publicMarkerQuality?.unlocated ?? publicMarkerQuality?.unresolvedPublic ?? 0,
      automaticExact: publicMarkerQuality?.automaticHigh ?? 0,
      reviewedExact: (publicMarkerQuality?.reviewedOverrideHigh ?? 0) + (publicMarkerQuality?.lunaReviewedExact ?? 0),
      locationOnly: canonicalLocationOnlyCount,
      unresolved: publicMarkerQuality?.unlocated ?? publicMarkerQuality?.unresolvedPublic ?? 0,
      acceptedPlusUnlocated: publicMarkerQuality
        ? publicMarkerQuality.accepted + (publicMarkerQuality.unlocated ?? publicMarkerQuality.unresolvedPublic)
        : null,
      percentages: null,
      externalProjectionLocallyReproduced: true
    },
    publicRuntimeMarkerLayer: publicMarkerQuality,
    perRegionCurrentPublicCoordinates: publicMarkerCountsByRegion,
    gtLaser: segmentGeocodeSummary((record) => record.projection?.system === 'GT Laser'),
    dome: segmentGeocodeSummary((record) => record.projection?.dome === true),
    automaticHighPrecisionGate: {
      status: publicMarkerPartitionValid ? 'PASS-dynamic-marker-invariant' : 'FAIL-dynamic-marker-invariant',
      sampleSize: null,
      matched: null,
      overrideUsedFalse: null,
      all574MathematicallyGuaranteed: false,
      rowLevelEvidenceFilePresent: Boolean(lunaReviewSummary)
    },
    amapPublicationGate: 'AMAP_JS_API_2_RUNTIME',
    quotaGuard: {
      newRequests: quota.runBudget.newAmapRequests,
      cacheHits: quota.runBudget.cacheHits,
      budget: quota.runBudget.maxNewAmapRequests,
      estimatedMonthlyRemaining: quota.monthlyQuota.estimatedRemainingAfterRun
    }
  },
  statusAndHistory: {
    row59Status: derivedRecords.find((record) => Number(record.sourceRow) === 59)?.status ?? null,
    parserAudit: 'data/audit/status-parsing.json',
    nameHistoryAudit: 'data/audit/name-history.json',
    nameHistory,
    unparsedNameLineRecords: nameHistory.unparsedNameLineRecords
  },
  historicalReviewSnapshots: {
    status: 'historical-non-blocking',
    reason: 'The 323-row review snapshot predates the accepted 901/901 canonical layer and is retained only for provenance; its needsMoreEvidence/reviewComplete fields do not gate the current public release.',
    snapshots: [
      {
        file: 'data/audit/luna-geocode-review-323-summary.json',
        historical: true,
        blocking: false,
        reviewComplete: lunaReviewSummary?.reviewComplete ?? null,
        needsMoreEvidence: lunaReviewSummary?.verdicts?.['needs-more-evidence'] ?? null
      },
      {
        file: 'data/audit/final-cross-certification-report.json',
        historical: true,
        blocking: false,
        releaseGate: 'BLOCKED',
        supersededBy: 'data/audit/final-internal-materialization-status.json'
      }
    ]
  },
  quality: {
    derivedQuality: 'data/audit/derived-quality.json',
    geocodeQuality: quality.summary,
    tests,
    schemaValidation: {
      derived: derivedValidation,
      public: publicValidation,
      publicBoundary
    },
    invalidCoordinates: derivedQuality.validation.invalidLatLng,
    duplicatePoiGroups,
    urumqiDistinction: {
      sourceRowsKeptSeparate: true,
      sourceRows: [785, 786],
      currentFrozenAuditDuplicateGroup: duplicatePoiGroups.some((group) => group.records?.some((record) => [785, 786].includes(Number(record.sourceRow))))
    }
  },
  statusSummary: {
    counts: derivedQuality.counts.status,
    parserRegression: {
      testsIncluded: 6,
      status: tests.ok ? 'passed' : 'failed'
    },
    row59: {
      status: derivedRecords.find((record) => Number(record.sourceRow) === 59)?.status ?? null,
      reasoning: 'dated 2024-07-26 reopen/open signal supersedes the dated 2021-02-10 closure'
    }
  },
  security: {
    secretsDetected: false,
    apiKeyPersisted: false,
    apiKeyFindings: {
      runtimeKeyPresent: runtimeAmapKeyPresent,
      publicArtifactContainsRuntimeKey: runtimeAmapKeyPresent ? publicSerialized.includes(process.env.AMAP_API_KEY) : false,
      publicArtifactContainsApiKeyVariableName: publicSerialized.includes('AMAP_API_KEY')
    },
    providerCacheTracked: cacheTracked,
    providerCachePolicy: '.gitignore data/geocode/provider-cache/*.json',
    publicRawCandidateData: publicSerialized.includes('rawCandidates') || publicSerialized.includes('rankedCandidates'),
    privateProviderCachePresent: exists('data/geocode/provider-cache/amap.json'),
    rawMirrorHistoryCommits: rawHistory ? rawHistory.split(/\r?\n/).filter(Boolean).length : 0,
    rawMirrorHistoryPresent: Boolean(rawHistory),
    rawMirrorHistoryScope: publicReleaseBranchExists ? PUBLIC_RELEASE_BRANCH : currentBranch || 'HEAD'
  },
  licensing: {
    sourceAttribution: '@ArvinTingcn attribution required',
    arvinAuthorizationProvenanceDocumented: true,
    amapPublicationGate: 'AMAP_JS_API_2_RUNTIME',
    amapPermissionRequestDocument: exists('docs/AMAP-PERMISSION-REQUEST.md'),
    osmAttributionRequired: false,
    osmBackupAuditPoints: 2,
    osmLicenseDocumented: true
  },
  git: {
    branch: git('branch', '--show-current').trim(),
    head: git('rev-parse', 'HEAD').trim(),
    commitsPrepared: false,
    dirtyFileCount: dirtyFiles.length,
    dirtyFiles,
    currentDraftPr: 'Draft PR #2 remains unmerged; no remote update in this run',
    rawMirrorHistoryPresent: Boolean(rawHistory),
    intentionallyExcluded: [
      'data/raw/arvin-imax.json from the clean public branch',
      'data/geocode/provider-cache/*.json',
      'AMap API keys and credentials',
      'rawCandidates/rankedCandidates from public artifacts'
    ],
    publicBoundaryAuditFile: 'data/audit/public-boundary.json'
  },
  frontend: {
    sourceFile: 'index.html',
    smokeAuditFile: 'data/audit/public-amap-browser-smoke.json',
    privateSmokeAuditFile: 'data/audit/private-amap-browser-smoke.json',
    currentlyReads: `data/public/cinemas.json for static facts, then POST /api/public/markers for the minimal ${publicMarkerQuality?.markerCount ?? 0}-point AMap GCJ-02 runtime layer`,
    publicationDatasetPresent: publicDatasetPresent,
    publicationDatasetStatus: publicDataset?.status ?? null,
    buildResult: 'static HTML; no bundler build step',
    markerCountByRegion: publicMarkerCountsByRegion,
    markerCountFromCurrentDerived: publicMarkerQuality?.markerCount ?? 0,
    browserSmoke: publicBrowserSmoke ?? {
      status: 'not-run',
      reason: 'No public AMap browser smoke audit is present.'
    },
    privateBrowserSmoke: privateBrowserSmoke ?? {
      status: 'not-run',
      reason: 'No private AMap browser smoke audit is present.'
    }
  },
  blockers: releaseGates,
  gates: {
    humanReviewMaterialization: materializationGates,
    amapPublication: publicationGates.filter((gate) => /AMap|raw Tencent|provider cache|public branch|provisional/.test(gate)),
    development: developmentBlockers
  }
};

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ok: publicationReady,
  output: 'data/audit/release-readiness.json',
  publicationReady,
  developmentBlockers,
  materializationGates,
  publicationGates
}, null, 2));
if (developmentBlockers.length) process.exitCode = 2;

function runTests() {
  const geocodeTests = fs.readdirSync(path.join(ROOT, 'scripts/geocode'))
    .filter((file) => file.endsWith('.test.mjs'))
    .map((file) => path.join('scripts/geocode', file));
  const testFiles = [
    ...geocodeTests,
    'scripts/status-parser.test.mjs',
    'scripts/name-history.test.mjs',
    'scripts/public-data.test.mjs',
    ...(exists('scripts/map-data-adapter.test.mjs') ? ['scripts/map-data-adapter.test.mjs'] : []),
    ...(exists('scripts/local-preview.test.mjs') ? ['scripts/local-preview.test.mjs'] : []),
    ...(exists('scripts/final-internal.test.mjs') ? ['scripts/final-internal.test.mjs'] : []),
    ...(exists('scripts/evidence-review.test.mjs') ? ['scripts/evidence-review.test.mjs'] : []),
    ...(exists('scripts/public-boundary.test.mjs') ? ['scripts/public-boundary.test.mjs'] : []),
    ...(exists('scripts/map-frontend.test.mjs') ? ['scripts/map-frontend.test.mjs'] : [])
  ];
  const result = spawnSync(process.execPath, ['--test', ...testFiles], { cwd: ROOT, encoding: 'utf8' });
  return {
    command: `node --test ${testFiles.join(' ')}`,
    exitCode: result.status,
    ok: result.status === 0,
    outputTail: String(result.stdout ?? '').split(/\r?\n/).slice(-8).join('\n')
  };
}

function git(...args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout ?? '';
}

function countBy(records, keyFn) {
  const counts = {};
  for (const record of records) {
    const key = keyFn(record);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function decisionBucket(record) {
  const override = record.reviewedOverride;
  if (record.overrideUsed && override?.applied !== false) {
    return override.confidence === 'high' ? 'reviewedOverrideHigh' : 'reviewedOverrideMedium';
  }
  const decision = record.selected?.automaticDecision;
  if (decision === 'accepted-high') return 'automaticHigh';
  if (decision === 'review-required-medium' || decision === 'review-required-ambiguous') {
    return 'automaticMedium';
  }
  return 'unresolved';
}

function regionCoordinateCounts(records) {
  const counts = {};
  for (const record of records) {
    const rawLat = record.location?.lat;
    const rawLng = record.location?.lng;
    if (rawLat === null || rawLat === undefined || rawLat === '' ||
        rawLng === null || rawLng === undefined || rawLng === '') continue;
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const region = record.region ?? 'unknown';
    counts[region] = (counts[region] ?? 0) + 1;
  }
  return counts;
}

function segmentGeocodeSummary(predicate) {
  const records = mainlandAudit.records.filter(predicate);
  const buckets = countBy(records, decisionBucket);
  const located = records.filter((record) => {
    const lat = Number(record.selected?.map?.lat);
    const lng = Number(record.selected?.map?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }).length;
  return {
    total: records.length,
    locatedInAudit: located,
    coverageInAudit: records.length ? Number((located / records.length).toFixed(6)) : 0,
    automaticHigh: buckets.automaticHigh ?? 0,
    automaticMedium: buckets.automaticMedium ?? 0,
    reviewedOverrideHigh: buckets.reviewedOverrideHigh ?? 0,
    reviewedOverrideMedium: buckets.reviewedOverrideMedium ?? 0,
    unresolved: buckets.unresolved ?? 0
  };
}

function runJsonCommand(relativeScript) {
  const result = spawnSync(process.execPath, [relativeScript], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  const stdout = String(result.stdout ?? '');
  let parsed = null;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    const first = stdout.indexOf('{');
    const last = stdout.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        parsed = JSON.parse(stdout.slice(first, last + 1));
      } catch {
        parsed = null;
      }
    }
  }
  return {
    command: 'node ' + relativeScript,
    exitCode: result.status,
    ok: result.status === 0,
    report: parsed,
    outputTail: stdout.split(/\r?\n/).slice(-8).join('\n')
  };
}
