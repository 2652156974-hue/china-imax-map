import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fullFile = path.join(ROOT, 'data/audit/geocode-mainland-full.json');
const qualityFile = path.join(ROOT, 'data/audit/geocode-mainland-quality.json');
const manifestFile = path.join(ROOT, 'data/audit/geocode-mainland-recovery-manifest.json');
const evidenceFile = path.join(ROOT, 'data/audit/geocode-mainland-historical-aggregate-evidence.json');
const originalSha = '7e49f019b40b1b85387f95ee308c95ae9ddbf7ec3da5191523debfec5b83bd71';
const evidence = read(evidenceFile);
const evidenceDigest = shaObject(evidence.aggregates);
if (evidence.originalFullAuditSha256 !== originalSha || evidence.evidenceDigest !== evidenceDigest) throw new Error('Historical aggregate evidence digest/SHA mismatch');
const full = read(fullFile);
const quality = read(qualityFile);
if (full.records?.length !== 881 || quality.evaluated !== 881) throw new Error('Expected 881-row reconstructed audit');

const riskRows = new Set((read(path.join(ROOT, 'data/audit/geocode-risk-review.json')).records ?? []).map(r => Number(r.sourceRow)));
for (const record of full.records) {
  record.queryVariants = null;
  record.hardRejectSummary = riskRows.has(Number(record.sourceRow)) ? record.hardRejectSummary : null;
  record.ambiguity = riskRows.has(Number(record.sourceRow)) ? record.ambiguity : null;
  record.fieldAvailability = {
    queryVariants: 'unavailable',
    hardRejectSummary: riskRows.has(Number(record.sourceRow)) ? 'verified-risk-review' : 'unavailable',
    ambiguity: riskRows.has(Number(record.sourceRow)) ? 'verified-risk-review' : 'unavailable',
    rowLevelFormatCompatibility: 'unavailable',
    rowLevelAdminCompatibility: 'unavailable'
  };
  if (record.selected) {
    record.selected.formatCompatibility = null;
    record.selected.adminMatch = null;
  }
  if (record.topCandidate) {
    record.topCandidate.formatCompatibility = null;
    record.topCandidate.adminMatch = null;
  }
}

const historicalRequest = {
  scope: 'mainland', dryRun: true, fullRunEnabled: true, applyEnabled: false,
  keySource: 'process.env.AMAP_API_KEY',
  keyPersisted: false, keyPrinted: false, providerCache: 'local-private-gitignored',
  minimumIntervalMs: 800, retryFailed: false, cacheOnly: false,
  networkRequests: 1708, cacheHits: 182, providerErrors: 1,
  cacheEntriesAtStart: evidence.aggregates.cacheEntriesAtStart, cacheEntriesAtEnd: evidence.aggregates.cacheEntriesAtEnd
};
const recoveryRequest = {
  keySource: 'not-used',
  providerRunnerExecuted: false, providerRescored: false, networkRequests: 0,
  cacheHits: 0, providerErrors: 0, cacheEntriesAtStart: null, cacheEntriesAtEnd: evidence.aggregates.cacheEntriesAtEnd,
  sourceRowsTraversed: 0, sourceRowsMutationProvable: false
};
const requestPolicy = { ...historicalRequest, historical: historicalRequest, recovery: recoveryRequest };
const fieldFidelity = {
  sourceRow: { status: 'verified', records: 881 },
  sourceIdentity: { status: 'verified-from-existing-artifacts', records: 881 },
  selectedCandidate: { status: 'partial', unavailableFields: ['score', 'rowLevelFormatCompatibility', 'rowLevelAdminCompatibility'] },
  queryVariants: { status: 'unavailable', records: 881 },
  hardRejectSummary: { status: 'partial', verifiedRiskRows: riskRows.size, unavailableRows: 881 - riskRows.size },
  ambiguity: { status: 'partial', verifiedRiskRows: riskRows.size, unavailableRows: 881 - riskRows.size },
  sourceSegments: { status: 'historical-aggregate-retained', records: evidence.aggregates.sourceSegments.commercial, institutional: evidence.aggregates.sourceSegments.institutional, otherBreakdowns: 'unavailable' },
  rejectionCounts: { status: 'historical-aggregate-retained' },
  requestPolicy: { status: 'historical-and-recovery-separated' }
};
const restoration = {
  status: 'reconstructed-partial-fidelity', mode: 'mainland-full-poi-dry-run-reconstructed-partial-fidelity',
  exactOriginalCopyFound: false, byteForByteRestored: false, providerRunnerExecuted: false,
  providerRescored: false, recoveryNetworkRequests: 0, recordsComposed: 881,
  originalFrozenFullAuditSha256: originalSha, historicalAggregateEvidence: 'data/audit/geocode-mainland-historical-aggregate-evidence.json', fieldFidelity,
  note: 'Recovered from existing artifacts; unavailable row-level facts are null and are not inferred.'
};
full.status = 'reconstructed-partial-fidelity';
full.mode = 'mainland-full-poi-dry-run-reconstructed-partial-fidelity';
full.requestPolicy = requestPolicy;
full.restoration = restoration;
quality.status = 'reconstructed-partial-fidelity';
quality.mode = 'mainland-full-poi-quality-reconstructed-partial-fidelity';
quality.requestPolicy = requestPolicy;
quality.restoration = restoration;
quality.sourceSegments = {
  commercialCinema: { records: evidence.aggregates.sourceSegments.commercial, evaluated: evidence.aggregates.sourceSegments.commercial, fidelity: 'historical-saved-aggregate; subcounts unavailable' },
  institutionalVenue: { records: evidence.aggregates.sourceSegments.institutional, evaluated: evidence.aggregates.sourceSegments.institutional, fidelity: 'historical-saved-aggregate; subcounts unavailable' }
};
quality.rejectionCounts = {
  formatConflictRejected: evidence.aggregates.rejectionCounts.format, cityMismatchRejected: evidence.aggregates.rejectionCounts.city, projectMismatchRejected: evidence.aggregates.rejectionCounts.project,
  brandMismatchRejected: evidence.aggregates.rejectionCounts.brand, nonCinemaRejected: evidence.aggregates.rejectionCounts.nonCinema,
  fidelity: 'historical-saved-aggregate', allCandidateRejectReasons: null
};
atomic(fullFile, full); atomic(qualityFile, quality);
const manifest = {
  status: 'reconstructed-partial-fidelity', frozenOriginalFullAuditSha256: originalSha,
  reconstructedFullAuditSha256: sha(fullFile), reconstructedQualitySha256: sha(qualityFile),
  historicalAggregateEvidence: 'data/audit/geocode-mainland-historical-aggregate-evidence.json', historicalAggregateEvidenceSha256: sha(evidenceFile),
  historicalAggregates: evidence.aggregates,
  fieldFidelity, recovery: recoveryRequest, generatedAt: new Date().toISOString()
};
atomic(manifestFile, manifest);
console.log(JSON.stringify({ ok: true, status: full.status, records: full.records.length,
  networkRequests: 0, providerRunnerExecuted: false, fullSha256: manifest.reconstructedFullAuditSha256 }, null, 2));

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function shaObject(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function atomic(file, value) { const tmp = `${file}.tmp-${process.pid}`; fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(tmp, file); }
