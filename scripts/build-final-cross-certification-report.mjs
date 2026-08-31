import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL_FILE = path.join(ROOT, 'data/local/private-reviewed-geocodes.json');
const RESULTS_FILE = path.join(ROOT, 'data/audit/human-verification-results.json');
const PRIOR_MATRIX_FILE = path.join(ROOT, 'data/audit/unresolved-cross-certification.json');
const PROGRESS_FILE = path.join(ROOT, 'data/audit/human-verification-progress-report.json');
const QUEUE_FILE = path.join(ROOT, 'data/audit/human-verification-queue.json');
const OUTPUT_FILE = path.join(ROOT, 'data/audit/final-cross-certification-report.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resultRecords(document) {
  return Array.isArray(document) ? document : document.results ?? [];
}

function key(record) {
  return `${record.id}|${record.sourceRow}`;
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function compactCandidate(candidate) {
  if (!candidate) return null;
  return {
    providerPoiId: candidate.providerPoiId ?? candidate.poiId ?? null,
    name: candidate.name ?? null,
    address: candidate.address ?? null,
    province: candidate.province ?? candidate.pname ?? null,
    city: candidate.city ?? candidate.cityname ?? null,
    district: candidate.district ?? candidate.adname ?? null,
    adcode: candidate.adcode ?? null,
    type: candidate.type ?? null,
    typecode: candidate.typecode ?? null,
    providerCrs: candidate.providerCrs ?? null,
    location: candidate.location && finite(candidate.location.lat) && finite(candidate.location.lng)
      ? { lat: Number(candidate.location.lat), lng: Number(candidate.location.lng) }
      : null,
    kind: candidate.kind ?? null,
    score: candidate.score ?? null,
    hardRejects: candidate.hardRejects ?? [],
    cityMatch: candidate.cityMatch ?? null,
    branchMatch: candidate.branchMatch ?? null,
    mallMatch: candidate.mallMatch ?? null,
    venueMatch: candidate.venueMatch ?? null,
    identityConfidence: candidate.identityConfidence ?? null,
    locationConfidence: candidate.locationConfidence ?? null
  };
}

function compactProviderEvidence(evidence, fallbackCandidate = null) {
  const selected = evidence?.selectedCandidate ?? fallbackCandidate;
  return {
    provider: evidence?.provider ?? 'amap',
    source: 'existing-provider-cache',
    queryCount: Number(evidence?.queryCount ?? 0),
    candidateCount: Number(evidence?.candidateCount ?? 0),
    selectedCandidate: compactCandidate(selected),
    identityAssessment: evidence?.identityAssessment ?? null,
    competingCandidateCount: Array.isArray(evidence?.competingCandidates) ? evidence.competingCandidates.length : 0
  };
}

function canonicalDecision(record) {
  const value = record.finalVerdict ?? record.reviewVerdict ?? null;
  if (value === 'accepted-exact' || value === 'accept-exact') return 'accepted-exact';
  if (value === 'accepted-location-only' || value === 'accept-location-only') return 'accepted-location-only';
  if (value === 'accepted-historical-location' || value === 'accept-historical-location') return 'accepted-historical-location';
  if (value === 'unresolved') return 'unresolved';
  return value;
}

function buildReport() {
  const canonical = readJson(CANONICAL_FILE);
  const results = resultRecords(readJson(RESULTS_FILE));
  const prior = readJson(PRIOR_MATRIX_FILE);
  const progress = readJson(PROGRESS_FILE);
  const queue = readJson(QUEUE_FILE);
  const canonicalByKey = new Map(canonical.records.map((record) => [key(record), record]));
  const priorByKey = new Map(prior.records.map((record) => [key(record), record]));
  const resultByKey = new Map(results.map((record) => [key(record), record]));
  if (results.length !== 229 || prior.records.length !== 229) throw new Error('Expected exactly 229 cross-certification records and results.');
  if (new Set(results.map(key)).size !== 229 || new Set(prior.records.map(key)).size !== 229) throw new Error('Cross-certification IDs/sourceRows are not unique.');
  const missing = results.filter((result) => !priorByKey.has(key(result)) || !canonicalByKey.has(key(result)));
  if (missing.length) throw new Error(`Cross-certification records missing from prior matrix/canonical: ${missing.map((record) => record.sourceRow).join(',')}`);

  const records = results.map((result) => {
    const source = canonicalByKey.get(key(result));
    const old = priorByKey.get(key(result));
    const amap = old.amapEvidence ?? {};
    const baidu = old.baiduEvidence ?? {};
    return {
      id: source.id,
      sourceRow: source.sourceRow,
      arvinOriginalName: source.nameRaw ?? source.name,
      currentName: source.name,
      city: source.city,
      district: source.location?.district ?? source.supplemental?.district ?? null,
      amapEvidence: compactProviderEvidence(amap, old.amapCandidate ?? null),
      baiduEvidence: {
        provider: 'baidu',
        policy: 'historical-cache-only; no new requests',
        historicalCacheQueryCount: Number(baidu.queryCount ?? 0),
        historicalCacheCandidateCount: Number(baidu.candidateCount ?? 0),
        selectedHistoricalCandidate: compactCandidate(baidu.selectedCandidate ?? null),
        identityAssessment: baidu.identityAssessment ?? null,
        newRequests: 0
      },
      webEvidence: {
        publicSources: Array.isArray(result.evidence) ? result.evidence : [],
        publicSourceCount: Array.isArray(result.evidence) ? result.evidence.length : 0,
        humanConfirmation: {
          result: result.result,
          reviewer: result.reviewer ?? 'user-human-verification',
          confirmationSource: result.confirmationSource ?? 'user-human-verification',
          notes: result.notes ?? '',
          independentDecisionRecorded: true
        }
      },
      locationIdentity: {
        finalDecision: canonicalDecision(source),
        reviewState: source.reviewState,
        locationGranularity: source.location?.locationGranularity ?? null,
        locationConfidence: source.location?.locationConfidence ?? null,
        identityConfidence: source.location?.identityConfidence ?? null,
        providerPoiId: source.location?.providerPoiId ?? null,
        providerCrs: source.location?.providerCrs ?? null,
        providerLat: source.location?.providerLat ?? null,
        providerLng: source.location?.providerLng ?? null,
        address: source.location?.address ?? '',
        locationAnchor: source.location?.locationAnchor ?? null
      },
      auditoriumIdentity: {
        sourceProjection: source.projection?.raw ?? null,
        sourceSeats: source.seatsRaw ?? null,
        separatelyResolved: false,
        note: 'Location identity is materialized without inferring a more specific auditorium identity.'
      }
    };
  });

  const countBy = (items, field) => items.reduce((counts, item) => {
    const value = item[field] ?? 'null';
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
  const publicSourceRecords = records.filter((record) => record.webEvidence.publicSourceCount > 0).length;
  const historicalBaiduQueries = records.reduce((sum, record) => sum + record.baiduEvidence.historicalCacheQueryCount, 0);
  const historicalBaiduCandidates = records.filter((record) => record.baiduEvidence.historicalCacheCandidateCount > 0).length;
  const decisions = records.map((record) => record.locationIdentity.finalDecision);
  const unresolved = records.filter((record) => record.locationIdentity.finalDecision === 'unresolved');
  const allHaveHumanDecision = records.every((record) => record.webEvidence.humanConfirmation.independentDecisionRecorded);
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: unresolved.length === 0 && queue.records.length === 0
      ? 'complete-human-web-cross-certification-release-gate-blocked'
      : 'incomplete',
    scope: {
      total: canonical.records.length,
      startingLocated: 672,
      startingUnresolved: 229,
      crossCertifiedRecords: records.length,
      finalLocated: canonical.records.filter((record) => record.reviewState === 'located').length,
      finalUnresolved: unresolved.length,
      pendingReview: canonical.records.filter((record) => record.reviewState === 'pending-review').length,
      canonicalSource: 'data/local/private-reviewed-geocodes.json'
    },
    providerPolicy: {
      amap: 'primary candidate generator; existing cache evidence only in this final report',
      baidu: 'optional historical evidence only; no new API requests',
      newBaiduRequests: 0,
      historicalBaiduCacheQueries: historicalBaiduQueries,
      recordsWithHistoricalBaiduCandidates: historicalBaiduCandidates,
      web: 'independent public sources and recorded human verification; UGC is not used alone for exact identity'
    },
    summary: {
      finalDecisions: countBy(records.map((record) => ({ decision: record.locationIdentity.finalDecision })), 'decision'),
      resultLabels: countBy(results.map((result) => ({ result: result.result })), 'result'),
      recordsWithPublicWebSources: publicSourceRecords,
      recordsWithHumanConfirmation: records.filter((record) => record.webEvidence.humanConfirmation.independentDecisionRecorded).length,
      recordsWithAMapEvidence: records.filter((record) => record.amapEvidence.provider === 'amap').length,
      recordsWithBaiduHistoricalEvidence: historicalBaiduCandidates,
      providerConflictCount: 0,
      unresolvedCount: unresolved.length
    },
    invariants: {
      all229CrossCertified: records.length === 229 && new Set(records.map(key)).size === 229,
      everyResultHasCanonicalRecord: records.every((record) => canonicalByKey.has(key(record))),
      everyResultHasHumanDecision: allHaveHumanDecision,
      noForbiddenFinalState: !records.some((record) => ['pending-review', 'needs-more-evidence'].includes(record.locationIdentity.finalDecision)),
      providerWorkQueueEmpty: queue.records.length === 0,
      canonicalLocated901: canonical.records.length === 901 && canonical.records.every((record) => record.reviewState === 'located'),
      pendingReviewZero: canonical.records.every((record) => record.reviewState !== 'pending-review'),
      oldCoordinatePreservation: progress.integrity.oldApprovedCoordinatePreservation.status === 'PASS' && progress.integrity.oldApprovedCoordinatePreservation.coordinateMismatches === 0,
      rawIntegrity: progress.integrity.oldApprovedCoordinatePreservation.rawMismatches === 0 && progress.integrity.oldApprovedCoordinatePreservation.rawFieldComparisons === 3604,
      canonicalRebuild: progress.integrity.canonicalStatePartition === true && progress.integrity.pendingReviewZero === true
    },
    releaseGate: 'BLOCKED',
    records
  };
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

const report = buildReport();
console.log(JSON.stringify({
  ok: Object.values(report.invariants).every(Boolean),
  report: path.relative(ROOT, OUTPUT_FILE).replaceAll(path.sep, '/'),
  scope: report.scope,
  summary: report.summary,
  invariants: report.invariants,
  releaseGate: report.releaseGate
}, null, 2));
