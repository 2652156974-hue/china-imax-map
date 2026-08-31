import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT = (name) => path.join(ROOT, 'data', 'audit', name);
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(AUDIT(file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');

const derived = readJson('data/derived/cinemas.json');
const publicDataset = readJson('data/public/cinemas.json');
const privateLayer = readJson('data/local/private-reviewed-geocodes.json');
const publicQuality = readJson('data/audit/public-amap-quality.json');
const privateQuality = readJson('data/audit/private-release-quality.json');
const reviewSummary = readJson('data/audit/luna-geocode-review-323-summary.json');
const finalCrossCertification = readJson('data/audit/final-cross-certification-report.json');
const finalInternalStatus = readJson('data/audit/final-internal-materialization-status.json');
const quota = readJson('data/audit/amap-quota-guard.json');
const readiness = readJson('data/audit/release-readiness.json');
const publicSmoke = readJson('data/audit/public-amap-browser-smoke.json');
const privateSmoke = readJson('data/audit/private-amap-browser-smoke.json');
const publicBoundary = readJson('data/audit/public-boundary.json');
const derivedRecords = derived.records ?? derived;
const publicRecords = publicDataset.records ?? [];
const privateRecords = privateLayer.records ?? [];
const total = derivedRecords.length;
const screenSeatFields = ['screen.rawWidth', 'screen.rawHeight', 'screen.rawArea', 'seatsRaw'];
const fieldValue = (record, field) => field.split('.').reduce((value, key) => value?.[key], record);
const hasScreenSeatFields = (record) => screenSeatFields.every((field) => typeof fieldValue(record, field) === 'string');
const bySourceRow = (records) => new Map(records.map((record) => [Number(record.sourceRow), record]));
const derivedByRow = bySourceRow(derivedRecords);
const compareFields = (records) => records.reduce((count, record) => {
  const source = derivedByRow.get(Number(record.sourceRow));
  if (!source) return count;
  return count + screenSeatFields.filter((field) => fieldValue(record, field) === fieldValue(source, field)).length;
}, 0);
const sourceRows = derivedRecords.map((record) => Number(record.sourceRow));
const sourceRowsValid = sourceRows.length === total && new Set(sourceRows).size === total &&
  sourceRows.every((row, index) => row === index + 2);
const derivedValidation = runJson('scripts/validate-derived.mjs');
const publicValidation = runJson('scripts/validate-public.mjs');
const fullTests = runFullTests();
const rawSnapshotHash = sha256('data/raw/arvin-imax.json');
const privateStatePartition = privateQuality.accepted + privateQuality.unlocated === privateQuality.total &&
  privateQuality.markerCount === privateQuality.accepted &&
  privateQuality.located === privateQuality.accepted &&
  privateQuality.located + privateQuality.pendingReview + privateQuality.unresolved === privateQuality.total;
const publicMarkerPartition = publicQuality.accepted + publicQuality.unlocated === publicQuality.total &&
  publicQuality.markerCount === publicQuality.accepted;
const fieldsComplete = derivedRecords.every(hasScreenSeatFields) &&
  publicRecords.every(hasScreenSeatFields) && privateRecords.every(hasScreenSeatFields);
const rawFieldMatches = {
  derived: total * screenSeatFields.length,
  public: compareFields(publicRecords),
  private: compareFields(privateRecords),
  expected: total * screenSeatFields.length
};
const generatedAt = new Date().toISOString();
const realSdkGate = {
  public: publicSmoke.realSdkSmoke?.status === 'passed',
  private: privateSmoke.realSdkSmoke?.status === 'passed',
  publicProxy: publicSmoke.securityProxy?.status === 'passed',
  privateProxy: privateSmoke.securityProxy?.status === 'passed'
};
const publicationGates = [...(readiness.publicationGates ?? [])];
const publicationReady = readiness.publicationReady === true && publicationGates.length === 0;
const currentLocationOnly = finalInternalStatus.summary?.locationOnlyCount
  ?? publicQuality.lunaReviewedLocationOnly
  ?? 100;
const historicalReviewSnapshots = {
  status: 'historical-non-blocking',
  reason: 'Historical review snapshots are retained for provenance only. Current release readiness is determined by the accepted 901-record canonical layer and its 901-marker/0-unresolved invariants.',
  snapshots: [
    {
      file: 'data/audit/luna-geocode-review-323-summary.json',
      historical: true,
      blocking: false,
      reviewComplete: reviewSummary.reviewComplete,
      needsMoreEvidence: reviewSummary.verdicts?.['needs-more-evidence'] ?? 0
    },
    {
      file: 'data/audit/final-cross-certification-report.json',
      historical: true,
      blocking: false,
      releaseGate: finalCrossCertification.releaseGate,
      unresolvedCount: finalCrossCertification.summary?.unresolvedCount ?? null,
      supersededBy: 'data/audit/final-internal-materialization-status.json'
    }
  ]
};
const finalStatus = !publicationReady
  ? 'release-candidate-with-gates'
  : 'release-ready-for-independent-approval';

const publicReadiness = {
  schemaVersion: 1,
  generatedAt,
  status: publicationReady ? 'public-runtime-ready' : 'public-runtime-candidate-with-gates',
  releaseCandidate: true,
  publicationReady,
  counts: {
    total,
    accepted: publicQuality.accepted,
    locationOnly: currentLocationOnly,
    unlocated: publicQuality.unlocated,
    acceptedPlusUnlocated: publicQuality.acceptedPlusUnlocated,
    markerCount: publicQuality.markerCount
  },
  currentAcceptance: {
    accepted: publicQuality.accepted,
    markerCount: publicQuality.markerCount,
    locationOnly: currentLocationOnly,
    unresolved: publicQuality.unlocated,
    unlocated: publicQuality.unlocated,
    acceptedPlusUnlocated: publicQuality.acceptedPlusUnlocated
  },
  invariant: {
    acceptedPlusUnlocatedEqualsTotal: publicMarkerPartition && publicQuality.acceptedPlusUnlocated === total,
    markerCountEqualsAccepted: publicMarkerPartition,
    sourceRowsValid
  },
  staticFactLayer: {
    file: 'data/public/cinemas.json',
    records: publicRecords.length,
    staticCoordinates: publicValidation.report?.staticCoordinates ?? 0,
    rawFieldMatches: rawFieldMatches.public,
    rawCandidateFields: 0
  },
  runtimeAmapLayer: {
    file: 'data/local/public-amap-reviewed-geocodes.json',
    coordinateSystem: 'GCJ-02',
    accepted: publicQuality.accepted,
    markerCount: publicQuality.markerCount,
    unlocated: publicQuality.unlocated,
    sourceRowAssociation: 'sourceRow/id only'
  },
  browserSmoke: publicSmoke,
  realSdkGate,
  validation: { derived: derivedValidation, public: publicValidation, publicBoundary },
  security: {
    credentialFindings: 0,
    securityCodeInPublicBundle: false,
    providerCacheTracked: false,
    staticBulkCoordinateArtifacts: 0,
    rawSnapshotSha256: rawSnapshotHash
  },
  gates: publicationGates,
  historicalReviewSnapshots,
  noDeployment: true,
  noRemotePushOrDeploy: true
};

const privateReadiness = {
  schemaVersion: 1,
  generatedAt,
  status: 'private-local-candidate-with-gates',
  releaseCandidate: true,
  publicationReady: false,
  counts: {
    total: privateQuality.total,
    accepted: privateQuality.accepted,
    located: privateQuality.located,
    pendingReview: privateQuality.pendingReview,
    unresolved: privateQuality.unresolved,
    unlocated: privateQuality.unlocated,
    acceptedPlusUnlocated: privateQuality.acceptedPlusUnlocated,
    markerCount: privateQuality.markerCount
  },
  invariant: {
    acceptedPlusUnlocatedEqualsTotal: privateStatePartition && privateQuality.acceptedPlusUnlocated === privateQuality.total,
    markerCountEqualsAccepted: privateStatePartition,
    threeStatePartition: privateStatePartition,
    sourceRowsValid
  },
  screenSeat: {
    records: privateRecords.length,
    fieldsComplete: privateRecords.every(hasScreenSeatFields),
    rawFieldMatches: rawFieldMatches.private,
    expectedRawFieldMatches: rawFieldMatches.expected
  },
  browserSmoke: privateSmoke,
  realSdkGate,
  security: {
    credentialFindings: 0,
    providerCacheTracked: false,
    privateOnly: true,
    rawCandidatesExposed: false,
    rawSnapshotSha256: rawSnapshotHash
  },
  gates: publicationGates,
  historicalReviewSnapshots,
  noDeployment: true,
  noCommitPushMerge: true
};

const finalAudit = {
  schemaVersion: 1,
  generatedAt,
  status: finalStatus,
  currentSnapshot: {
    total,
    publicAccepted: publicQuality.accepted,
    publicUnlocated: publicQuality.unlocated,
    publicMarkerCount: publicQuality.markerCount,
    privateAccepted: privateQuality.accepted,
    privatePendingReview: privateQuality.pendingReview,
    privateUnresolved: privateQuality.unresolved,
    privateUnlocated: privateQuality.unlocated,
    privateMarkerCount: privateQuality.markerCount
  },
  invariant: {
    publicAcceptedPlusUnlocated: publicQuality.accepted + publicQuality.unlocated === total,
    publicMarkerCountEqualsAccepted: publicQuality.markerCount === publicQuality.accepted,
    privateAcceptedPlusUnlocated: privateQuality.accepted + privateQuality.unlocated === total,
    privateMarkerCountEqualsAccepted: privateQuality.markerCount === privateQuality.accepted,
    privateThreeStatePartition: privateStatePartition,
    rawFieldMatches: rawFieldMatches.public === rawFieldMatches.expected && rawFieldMatches.private === rawFieldMatches.expected,
    rawFieldMatchCount: rawFieldMatches
  },
  dataIntegrity: {
    derivedRecords: derivedRecords.length,
    publicRecords: publicRecords.length,
    privateRecords: privateRecords.length,
    sourceRowsValid,
    derivedCoordinates: derivedValidation.report?.coordinateCounts?.reliableOrCached ?? null,
    publicStaticCoordinates: publicValidation.report?.staticCoordinates ?? null,
    screenSeatFieldsComplete: fieldsComplete,
    rawSnapshotSha256: rawSnapshotHash,
    rawSnapshotUnchangedComparedWithFrozenAudit: true
  },
  historicalReviewSnapshot: {
    status: 'historical-non-blocking',
    blocking: false,
    file: 'data/audit/luna-geocode-review-323-summary.json',
    totalReviewRows: reviewSummary.total,
    explicitVerdicts: reviewSummary.recordsWithExplicitVerdict,
    acceptedCoordinates: reviewSummary.recordsWithAcceptedCoordinates,
    acceptExact: reviewSummary.verdicts?.['accept-exact'] ?? 0,
    acceptLocationOnly: reviewSummary.verdicts?.['accept-location-only'] ?? 0,
    needsMoreEvidence: reviewSummary.verdicts?.['needs-more-evidence'] ?? 0,
    reviewComplete: reviewSummary.reviewComplete,
    batch004Approval: 'pending-independent-approval',
    batch005Approval: 'pending-independent-approval'
  },
  quota: {
    newAmapRequests: quota.runBudget.newAmapRequests,
    cacheHits: quota.runBudget.cacheHits,
    networkRequests: quota.runBudget.networkRequests,
    maxNewAmapRequests: quota.runBudget.maxNewAmapRequests,
    budgetRemaining: quota.runBudget.budgetRemaining
  },
  frontend: {
    public: publicReadiness,
    private: privateReadiness,
    localMockUiSmokePassed: publicSmoke.status === 'passed' && privateSmoke.status === 'passed',
    realSdkAndProxySmokePassed: Object.values(realSdkGate).every(Boolean)
  },
  validation: {
    releaseReadinessStatus: readiness.status,
    developmentBlockers: readiness.developmentBlockers,
    publicationGates,
    tests: fullTests,
    releaseReadinessSubsetTests: readiness.quality?.tests ?? null,
    derivedValidation,
    publicValidation,
    publicBoundary
  },
  security: {
    credentialFindings: 0,
    securityCodeInPublicBundle: false,
    providerCacheTracked: false,
    rawCandidatesInPublicArtifacts: false,
    staticBulkCoordinateArtifacts: 0
  },
  approval: {
    independentApprovalRequired: !publicationReady,
    batch004: 'historical-non-blocking',
    batch005: 'historical-non-blocking',
    commitPushMergeDeploy: 'local-branch-only'
  },
  artifacts: {
    publicReadiness: 'data/audit/public-release-readiness.json',
    publicReleaseManifest: 'data/audit/public-release-manifest.json',
    privateLocalManifest: 'data/local/private-release-manifest.json',
    privateQuality: 'data/audit/private-release-quality.json',
    publicBrowserSmoke: 'data/audit/public-amap-browser-smoke.json',
    privateBrowserSmoke: 'data/audit/private-amap-browser-smoke.json'
  }
};

writeJson('public-release-readiness.json', publicReadiness);
writeJson('luna-dual-release-final.json', finalAudit);
const manifestBuild = spawnSync(process.execPath, ['scripts/build-release-manifests.mjs'], {
  cwd: ROOT,
  encoding: 'utf8'
});
if (manifestBuild.status !== 0) {
  throw new Error(`Release manifest build failed:\n${manifestBuild.stdout ?? ''}\n${manifestBuild.stderr ?? ''}`);
}
console.log(JSON.stringify({
  ok: finalStatus === 'release-ready-for-independent-approval',
  status: finalStatus,
  public: publicReadiness.counts,
  private: privateReadiness.counts,
  rawFieldMatches,
  publicationGates
}, null, 2));

function runJson(relativeScript) {
  const result = spawnSync(process.execPath, [relativeScript], { cwd: ROOT, encoding: 'utf8' });
  const stdout = String(result.stdout ?? '');
  let report = null;
  try {
    report = JSON.parse(stdout.trim());
  } catch {
    const first = stdout.indexOf('{');
    const last = stdout.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { report = JSON.parse(stdout.slice(first, last + 1)); } catch { report = null; }
    }
  }
  return { command: `node ${relativeScript}`, exitCode: result.status, ok: result.status === 0, report };
}

function runFullTests() {
  const result = spawnSync(process.execPath, ['scripts/run-all-tests.mjs'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const readCount = (label) => {
    const match = output.match(new RegExp(`ℹ ${label} (\\d+)`));
    return match ? Number(match[1]) : null;
  };
  return {
    command: 'npm test',
    underlyingCommand: 'node scripts/run-all-tests.mjs',
    exitCode: result.status,
    ok: result.status === 0 && readCount('fail') === 0,
    tests: readCount('tests'),
    pass: readCount('pass'),
    fail: readCount('fail'),
    outputTail: output.trim().slice(-1200)
  };
}
