import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CANONICAL_FILE,
  HUMAN_QUEUE_FILE,
  ROOT,
  readJson,
  relative,
  writeJson
} from './geocode/amap-human-utils.mjs';

const BASELINE_FILE = path.join(ROOT, 'data/derived/cinemas-final-internal.json');
const RESULTS_FILE = path.join(ROOT, 'data/audit/human-verification-results.json');
const WEB_EVIDENCE_FILE = path.join(ROOT, 'data/audit/public-web-evidence-pass.json');
const OUTPUT_FILE = path.join(ROOT, 'data/audit/human-verification-progress-report.json');

function finite(value) {
  return Number.isFinite(Number(value));
}

function countBy(values) {
  return Object.fromEntries([...values.reduce((map, value) => map.set(value ?? 'null', (map.get(value ?? 'null') ?? 0) + 1), new Map())].sort());
}

function key(record) {
  return `${record.id}|${record.sourceRow}`;
}

function compareBaseline(baseline, canonical) {
  const current = new Map(canonical.records.map((record) => [key(record), record]));
  const approved = baseline.records.filter((record) => record.reviewState === 'located');
  const coordinateMismatches = [];
  const rawMismatches = [];
  for (const before of baseline.records) {
    const after = current.get(key(before));
    if (!after) {
      rawMismatches.push({ key: key(before), reason: 'missing-current-record' });
      continue;
    }
    if (before.reviewState === 'located') {
      const expectedCoordinates = {
        lat: before.geocode?.mapLat,
        lng: before.geocode?.mapLng,
        providerPoiId: before.geocode?.poiId
      };
      const actualCoordinates = {
        lat: after.location?.lat,
        lng: after.location?.lng,
        providerPoiId: after.location?.providerPoiId
      };
      for (const field of Object.keys(expectedCoordinates)) {
        if (String(expectedCoordinates[field] ?? '') !== String(actualCoordinates[field] ?? '')) {
          coordinateMismatches.push({ key: key(before), field, before: expectedCoordinates[field] ?? null, after: actualCoordinates[field] ?? null });
        }
      }
    }
    for (const field of ['rawWidth', 'rawHeight', 'rawArea']) {
      if (String(before.screen?.[field] ?? '') !== String(after.screen?.[field] ?? '')) {
        rawMismatches.push({ key: key(before), field: `screen.${field}` });
      }
    }
    if (String(before.seatsRaw ?? '') !== String(after.seatsRaw ?? '')) rawMismatches.push({ key: key(before), field: 'seatsRaw' });
  }
  return {
    baselineApprovedCoordinates: approved.length,
    coordinateMismatches: coordinateMismatches.length,
    rawFieldComparisons: baseline.records.length * 4,
    rawMismatches: rawMismatches.length,
    status: coordinateMismatches.length === 0 && rawMismatches.length === 0 ? 'PASS' : 'FAIL'
  };
}

function queueCompleteness(records) {
  const missing = [];
  for (const record of records) {
    const required = [
      ['id', record.id],
      ['sourceRow', record.sourceRow],
      ['arvinOriginalName', record.arvinOriginalName],
      ['currentName', record.currentName],
      ['city', record.city],
      ['bestAmapCandidates', Array.isArray(record.bestAmapCandidates) ? record.bestAmapCandidates : null],
      ['candidateAddresses', Array.isArray(record.candidateAddresses) ? record.candidateAddresses : null],
      ['currentConflict', Array.isArray(record.currentConflict) ? record.currentConflict : null],
      ['whyAutomaticAcceptanceFailed', record.whyAutomaticAcceptanceFailed],
      ['recommendedSearchQueries', Array.isArray(record.recommendedSearchQueries) && record.recommendedSearchQueries.length >= 2 ? record.recommendedSearchQueries : null],
      ['expectedInformationGain', record.expectedInformationGain]
    ];
    for (const [field, value] of required) {
      if (value === null || value === undefined || value === '') missing.push({ sourceRow: record.sourceRow, field });
    }
  }
  return { records: records.length, missingFields: missing.length, status: missing.length === 0 ? 'PASS' : 'FAIL' };
}

export function buildReport({ now = new Date().toISOString() } = {}) {
  const canonical = readJson(CANONICAL_FILE);
  const queue = readJson(HUMAN_QUEUE_FILE);
  const baseline = readJson(BASELINE_FILE);
  const results = readJson(RESULTS_FILE);
  const webEvidence = readJson(WEB_EVIDENCE_FILE);
  const unresolved = canonical.records.filter((record) => record.reviewState === 'unresolved');
  const unresolvedWithCoordinates = unresolved.filter((record) => finite(record.location?.lat) && finite(record.location?.lng));
  const batches = (queue.humanVerificationBatches?.batches ?? []).map((batch) => ({
    batchId: batch.batchId,
    priority: batch.priority,
    status: batch.status,
    count: batch.count,
    sourceRows: batch.sourceRows,
    ids: batch.ids
  }));
  const humanVerificationComplete = canonical.summary.unresolved === 0 && canonical.summary.pendingReview === 0;
  const report = {
    generatedAt: now,
    status: humanVerificationComplete
      ? 'human-verification-complete-release-gate-blocked'
      : 'in-progress-human-verification-not-materialized',
    scope: {
      total: canonical.records.length,
      startingLocated: 672,
      startingUnresolved: 229,
      currentLocated: canonical.summary.located,
      currentUnresolved: canonical.summary.unresolved,
      pendingReview: canonical.summary.pendingReview
    },
    canonical: {
      file: relative(CANONICAL_FILE),
      finalVerdicts: canonical.summary.finalVerdicts,
      unresolvedReasons: canonical.summary.finalUnresolvedReasons,
      unresolvedWithCoordinates: unresolvedWithCoordinates.length
    },
    evidence: {
      publicWebRecords: webEvidence.summary.recordsWithPublicWebEvidence ?? 0,
      publicWebStillRequiringLabel: webEvidence.summary.recordsStillRequiringHumanLabel ?? 0,
      publicWebMaterializedBeforeThisReport: webEvidence.summary.recordsMaterialized ?? 0,
      newBaiduRequests: webEvidence.summary.newBaiduRequests ?? 0,
      baiduPolicy: 'disabled-by-user; historical cache only'
    },
    humanVerification: {
      resultsFile: relative(RESULTS_FILE),
      resultRecords: results.length,
      queueFile: relative(HUMAN_QUEUE_FILE),
      queueRecords: queue.records.length,
      priorityCounts: queue.summary.priorityCounts,
      nextBatch: queue.humanVerificationBatches?.nextBatch ?? null,
      batches
    },
    integrity: {
      oldApprovedCoordinatePreservation: compareBaseline(baseline, canonical),
      queueCompleteness: queueCompleteness(queue.records),
      canonicalStatePartition: canonical.summary.statePartition,
      pendingReviewZero: canonical.summary.pendingReview === 0
    },
    releaseGate: 'BLOCKED'
  };
  writeJson(OUTPUT_FILE, report);
  return report;
}

export async function run() {
  const report = buildReport();
  console.log(JSON.stringify({
    ok: report.integrity.oldApprovedCoordinatePreservation.status === 'PASS' && report.integrity.queueCompleteness.status === 'PASS',
    report: relative(OUTPUT_FILE),
    scope: report.scope,
    nextBatch: report.humanVerification.nextBatch,
    integrity: report.integrity,
    releaseGate: report.releaseGate
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await run();
