import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const RAW_PATH = path.join(ROOT, 'data', 'raw', 'arvin-imax.json');
const DERIVED_PATH = path.join(ROOT, 'data', 'derived', 'cinemas.json');
const REVIEW_PATH = path.join(ROOT, 'data', 'derived', 'review-needed.json');
const DECISIONS_PATH = path.join(ROOT, 'data', 'audit', 'screen-seat-web-review-decisions.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'audit', 'screen-seat-web-review.json');

const CONFLICT_CODES = [
  'screen-multivalue',
  'screen-abnormal-text',
  'screen-area-mismatch',
  'seats-multivalue',
  'seats-invalid',
];
const MISSING_CODES = ['screen-missing', 'seats-missing'];
const REVIEW_CLASSES = [
  'resolved-current',
  'resolved-historical-transition',
  'partially-resolved',
  'unresolved-conflict',
  'no-reliable-evidence',
];

const raw = readJson(RAW_PATH);
const derived = readJson(DERIVED_PATH);
const reviewDataset = readJson(REVIEW_PATH);
const decisions = fs.existsSync(DECISIONS_PATH) ? readJson(DECISIONS_PATH) : { records: [] };
const previousAudit = fs.existsSync(OUTPUT_PATH) ? readJson(OUTPUT_PATH) : null;

const rawRows = new Map((raw.rows ?? []).filter((row) => row.rowType === 'data').map((row) => [row.rowIndex, row]));
const derivedById = new Map((derived.records ?? []).map((record) => [record.id, record]));
const reviewsById = new Map((reviewDataset.records ?? []).map((record) => [record.id, record]));
const decisionsById = new Map((decisions.records ?? []).map((record) => [record.id, record]));
const previousCandidatesById = new Map((previousAudit?.records ?? []).map((entry) => [entry.id, entry]));

const issueTypeCounts = Object.fromEntries([...CONFLICT_CODES, ...MISSING_CODES].map((code) => [code, 0]));
const currentConflictById = new Map();
const currentPureMissingRecords = [];

for (const review of reviewDataset.records ?? []) {
  for (const code of review.reasonCodes ?? []) {
    if (code in issueTypeCounts) issueTypeCounts[code] += 1;
  }

  const record = derivedById.get(review.id);
  if (!record) throw new Error(`Review record ${review.id} is missing from derived records`);
  const rawRow = rawRows.get(record.sourceRow);
  if (!rawRow) throw new Error(`Raw row ${record.sourceRow} is missing for ${record.id}`);
  const conflictCodes = (review.reasonCodes ?? []).filter((code) => CONFLICT_CODES.includes(code));
  const missingCodes = (review.reasonCodes ?? []).filter((code) => MISSING_CODES.includes(code));

  if (conflictCodes.length) {
    currentConflictById.set(record.id, { record, review, rawRow, issueTypes: conflictCodes });
  } else if (missingCodes.length) {
    currentPureMissingRecords.push({
      id: record.id,
      sourceRow: record.sourceRow,
      raw: rawFields(record, rawRow),
      issueTypes: missingCodes,
    });
  }
}

const candidateIds = new Set([
  ...currentConflictById.keys(),
  ...previousCandidatesById.keys(),
  ...decisionsById.keys(),
]);
const candidateRecords = [...candidateIds]
  .map((id) => {
    const current = currentConflictById.get(id);
    const previous = previousCandidatesById.get(id);
    const record = current?.record || derivedById.get(id);
    if (!record) throw new Error(`Candidate ${id} is missing from derived records`);
    const rawRow = current?.rawRow || rawRows.get(record.sourceRow);
    if (!rawRow) throw new Error(`Raw row ${record.sourceRow} is missing for ${id}`);
    const issueTypes = previous?.issueTypes || current?.issueTypes || [];
    if (!issueTypes.length) throw new Error(`Candidate ${id} has no baseline conflict issue type`);
    const candidate = buildCandidate(record, current?.review || reviewsById.get(id) || { reasonCodes: [], details: [] }, rawRow, issueTypes);
    return previous ? preserveBaselineCandidate(candidate, previous) : candidate;
  })
  .sort((a, b) => a.sourceRow - b.sourceRow);

const pureMissingRecords = previousAudit?.exclusions?.pureMissingRecords?.length
  ? previousAudit.exclusions.pureMissingRecords
  : currentPureMissingRecords;
const baselineIssueTypeCounts = previousAudit?.baseline?.issueTypeCounts || issueTypeCounts;

const allSourceRecords = derived.records ?? [];
const allFourRawBlank = allSourceRecords.filter((record) => {
  const row = rawRows.get(record.sourceRow);
  if (!row) return false;
  const fields = rawFields(record, row);
  return ['width', 'height', 'area', 'seats'].every((field) => isBlank(fields[field]));
}).length;

const decisionSummary = summarizeDecisions(candidateRecords, decisionsById);
const audit = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  dataset: 'arvin-imax-screen-seat-web-review',
  auditState: decisionSummary.pendingCount ? 'candidate-list-and-partial-review' : 'completed-with-unresolved-allowed',
  scope: {
    sourceRaw: 'data/raw/arvin-imax.json',
    sourceDerived: 'data/derived/cinemas.json',
    sourceReview: 'data/derived/review-needed.json',
    candidateReasonCodes: CONFLICT_CODES,
    excludedReasonCodes: MISSING_CODES,
    excludedFieldsAndDimensions: [
      'screen-missing',
      'seats-missing',
      'blank',
      'NBSP/whitespace-only',
      'identity',
      'location/geocode',
      'status',
      'projection',
      'audioChannels',
    ],
    materializationRule: 'Only a documented current or historical configuration with explicit identity, auditorium meaning, time relation, and qualifying evidence may change screen.width/height/area or seats.',
  },
  baseline: {
    sourceRecords: allSourceRecords.length,
    sourceDataRows: (raw.rows ?? []).filter((row) => row.rowType === 'data').length,
    candidateCount: candidateRecords.length,
    issueTypeCounts: baselineIssueTypeCounts,
    candidateIssueCombinationCounts: countBy(candidateRecords, (candidate) => candidate.issueTypes.join('+')),
    excludedPureMissingCount: pureMissingRecords.length,
    excludedAllFourScreenSeatFieldsBlankCount: previousAudit?.baseline?.excludedAllFourScreenSeatFieldsBlankCount ?? allFourRawBlank,
    excludedMissingIssueCounts: previousAudit?.baseline?.excludedMissingIssueCounts || Object.fromEntries(MISSING_CODES.map((code) => [code, baselineIssueTypeCounts[code]])),
  },
  method: {
    candidateListGeneratedBeforeWebSearch: true,
    rawDisplayTextPreserved: true,
    configurationGroupRule: 'Line-aligned width/height/area/seats values are exposed as candidate configurations only when the source has matching multi-line positions; no configuration is selected by position or size.',
    areaRule: 'width × height is recorded only as a mathematical consistency check; it never materializes area by itself.',
    evidenceTiers: {
      'Tier 1': ['IMAX official', 'cinema/operator official', 'mall/venue official', 'official opening or renovation material', 'construction/design/acceptance material', 'equipment/project case with exact auditorium identity'],
      'Tier 2': ['authoritative media', 'industry media', 'mainstream local news', 'commercial real-estate reporting'],
      'Tier 3': ['ticketing/POI pages', 'cinema directories', 'seat-layout photos'],
      'Tier 4': ['forums', 'personal blogs', 'ordinary social posts'],
    },
    stopGate: 'If current configuration cannot be established without guessing, keep the record unresolved and do not lower the evidence threshold.',
  },
  calibrationCase: buildCalibrationCase(candidateRecords),
  reviewSummary: {
    webCheckedCount: decisionSummary.webCheckedCount,
    classificationCounts: decisionSummary.classificationCounts,
    pendingCandidateCount: decisionSummary.pendingCount,
    materializedCandidateCount: candidateRecords.filter((candidate) => decisionsById.get(candidate.id)?.materialize === true).length,
    fieldMaterializationCounts: decisionSummary.fieldMaterializationCounts,
    nonScreenSeatFieldChanges: decisionSummary.nonScreenSeatFieldChanges,
    beforePendingConflictCount: candidateRecords.length,
    afterPendingConflictCount: decisionSummary.afterPendingConflictCount,
    remainingPendingConflictCount: decisionSummary.afterPendingConflictCount,
  },
  records: candidateRecords.map((candidate) => {
    const decision = decisionsById.get(candidate.id);
    return decision ? { ...candidate, webReview: normalizeDecision(decision) } : { ...candidate, webReview: { state: 'pending', classification: null, queries: [], sources: [], decisionNote: '', materialize: false, fields: {} } };
  }),
  exclusions: {
    pureMissingRecords: pureMissingRecords.map((record) => ({ ...record })),
    note: 'These records were not web-checked because their screen/seat source fields contain no conflicting or anomalous data. The full raw source remains unchanged.',
  },
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ok: true,
  output: path.relative(ROOT, OUTPUT_PATH).replaceAll(path.sep, '/'),
  sourceRecords: audit.baseline.sourceRecords,
  candidateCount: audit.baseline.candidateCount,
  issueTypeCounts: audit.baseline.issueTypeCounts,
  excludedPureMissingCount: audit.baseline.excludedPureMissingCount,
  webCheckedCount: audit.reviewSummary.webCheckedCount,
  classificationCounts: audit.reviewSummary.classificationCounts,
  pendingCandidateCount: audit.reviewSummary.pendingCandidateCount,
}, null, 2));

function buildCandidate(record, review, rawRow, issueTypes) {
  const rawValues = rawFields(record, rawRow);
  const lineGroups = buildLineGroups(rawValues);
  const areaChecks = lineGroups.map((group) => {
    const width = toNumber(group.width);
    const height = toNumber(group.height);
    const area = toNumber(group.area);
    if (![width, height, area].every(Number.isFinite)) return { calculatedArea: null, relativeDifference: null, internallyConsistent: null };
    const calculatedArea = width * height;
    const relativeDifference = Math.abs(calculatedArea - area) / Math.max(Math.abs(area), 0.0001);
    return { calculatedArea, relativeDifference, internallyConsistent: relativeDifference <= 0.05 };
  });
  return {
    id: record.id,
    sourceRow: record.sourceRow,
    sheetRow: record.sheetRow,
    name: record.name,
    city: record.city,
    projectionRaw: record.projection?.raw ?? '',
    raw: rawValues,
    currentParsed: {
      width: record.screen?.width ?? null,
      height: record.screen?.height ?? null,
      area: record.screen?.area ?? null,
      seats: record.seats ?? null,
      screenSelectionConfidence: record.screen?.selectionConfidence ?? 'unknown',
    },
    issueTypes,
    allCurrentReasonCodes: reviewsById.get(record.id)?.reasonCodes ?? [],
    currentDetails: reviewsById.get(record.id)?.details ?? [],
    currentHistorySummary: record.historySummary ?? '',
    rawStatusOrHistory: rawValues.status,
    rawRemarkOrHistory: rawValues.remark,
    configurationGroup: {
      multiFieldGroup: lineGroups.length > 1 && lineGroups.filter((group) => group.hasAnyValue).length >= 2,
      lineGroups,
      areaConsistencyChecks: areaChecks,
    },
  };
}

function preserveBaselineCandidate(candidate, previous) {
  return {
    ...candidate,
    currentParsed: previous.currentParsed ?? candidate.currentParsed,
    issueTypes: previous.issueTypes ?? candidate.issueTypes,
    allCurrentReasonCodes: previous.allCurrentReasonCodes ?? candidate.allCurrentReasonCodes,
    currentDetails: previous.currentDetails ?? candidate.currentDetails,
    currentHistorySummary: previous.currentHistorySummary ?? candidate.currentHistorySummary,
    rawStatusOrHistory: previous.rawStatusOrHistory ?? candidate.rawStatusOrHistory,
    rawRemarkOrHistory: previous.rawRemarkOrHistory ?? candidate.rawRemarkOrHistory,
    configurationGroup: previous.configurationGroup ?? candidate.configurationGroup,
  };
}

function rawFields(record, rawRow) {
  const cell = (index) => String(rawRow.cells?.[index]?.displayValue ?? '');
  return {
    width: record.screen?.rawWidth ?? cell(3),
    height: record.screen?.rawHeight ?? cell(4),
    area: record.screen?.rawArea ?? cell(5),
    seats: record.seatsRaw ?? cell(6),
    status: cell(2),
    remark: cell(7),
  };
}

function buildLineGroups(rawValues) {
  const fields = ['width', 'height', 'area', 'seats'];
  const lines = Object.fromEntries(fields.map((field) => [field, splitLines(rawValues[field])]));
  const maxLines = Math.max(...Object.values(lines).map((values) => values.length), 0);
  if (maxLines <= 1) return [{ index: 0, width: lines.width[0] ?? '', height: lines.height[0] ?? '', area: lines.area[0] ?? '', seats: lines.seats[0] ?? '', hasAnyValue: fields.some((field) => !isBlank(lines[field][0] ?? '')) }];
  return Array.from({ length: maxLines }, (_, index) => ({
    index,
    width: lines.width[index] ?? '',
    height: lines.height[index] ?? '',
    area: lines.area[index] ?? '',
    seats: lines.seats[index] ?? '',
    hasAnyValue: fields.some((field) => !isBlank(lines[field][index] ?? '')),
  }));
}

function buildCalibrationCase(candidates) {
  const candidate = candidates.find((item) => item.name === '清远DY影城（顺盈时代广场IMAX店）');
  if (!candidate) return { found: false };
  return {
    found: true,
    id: candidate.id,
    sourceRow: candidate.sourceRow,
    raw: candidate.raw,
    configurationA: candidate.configurationGroup.lineGroups[0] ?? null,
    configurationB: candidate.configurationGroup.lineGroups[1] ?? null,
    mathematicalChecks: candidate.configurationGroup.areaConsistencyChecks.slice(0, 2),
    requiredDecision: 'Do not select A or B without evidence of exact auditorium identity and current/historical timing; if both existed but current timing is unresolved, classify unresolved-conflict.',
  };
}

function summarizeDecisions(candidates, byId) {
  const classificationCounts = Object.fromEntries(REVIEW_CLASSES.map((value) => [value, 0]));
  let webCheckedCount = 0;
  let pendingCount = 0;
  let nonScreenSeatFieldChanges = 0;
  const fieldMaterializationCounts = { width: 0, height: 0, area: 0, seats: 0 };
  for (const candidate of candidates) {
    const decision = byId.get(candidate.id);
    const classification = decision?.classification;
    if (!decision || !classification) {
      pendingCount += 1;
      continue;
    }
    webCheckedCount += 1;
    if (!(classification in classificationCounts)) throw new Error(`Invalid review classification for ${candidate.id}: ${classification}`);
    classificationCounts[classification] += 1;
    for (const field of Object.keys(fieldMaterializationCounts)) {
      if (decision.materialize === true && (decision.materializedFields ?? []).includes(field)) fieldMaterializationCounts[field] += 1;
    }
    if (Array.isArray(decision.nonScreenSeatFieldChanges) && decision.nonScreenSeatFieldChanges.length) nonScreenSeatFieldChanges += decision.nonScreenSeatFieldChanges.length;
  }
  const materialized = Object.values(fieldMaterializationCounts).reduce((sum, count) => sum + count, 0);
  return {
    webCheckedCount,
    pendingCount,
    classificationCounts,
    fieldMaterializationCounts: { ...fieldMaterializationCounts, total: materialized },
    nonScreenSeatFieldChanges,
    afterPendingConflictCount: candidates.filter((candidate) => {
      const decision = byId.get(candidate.id);
      if (!decision || !decision.classification || decision.materialize !== true) return true;
      const materializedFields = new Set(decision.materializedFields ?? []);
      const needsScreen = candidate.issueTypes.some((code) => code.startsWith('screen-'));
      const needsSeats = candidate.issueTypes.some((code) => code.startsWith('seats-'));
      if (needsScreen && !['width', 'height', 'area'].every((field) => materializedFields.has(field))) return true;
      if (needsSeats && !materializedFields.has('seats')) return true;
      return false;
    }).length,
  };
}

function normalizeDecision(decision) {
  return {
    state: 'reviewed',
    classification: decision.classification ?? null,
    checkedAt: decision.checkedAt ?? null,
    reviewer: decision.reviewer ?? 'codex-web-review',
    queries: Array.isArray(decision.queries) ? decision.queries : [],
    sources: Array.isArray(decision.sources) ? decision.sources : [],
    searchEvidenceSummary: sanitizeSearchEvidenceSummary(decision.searchEvidenceSummary),
    decisionNote: decision.decisionNote ?? '',
    applicableDateOrPeriod: decision.applicableDateOrPeriod ?? null,
    confidence: decision.confidence ?? 'unknown',
    materialize: decision.materialize === true,
    fields: decision.fields ?? {},
    materializedFields: Array.isArray(decision.materializedFields) ? decision.materializedFields : [],
    historicalConfigurations: Array.isArray(decision.historicalConfigurations) ? decision.historicalConfigurations : [],
    nonScreenSeatFieldChanges: Array.isArray(decision.nonScreenSeatFieldChanges) ? decision.nonScreenSeatFieldChanges : [],
  };
}

function sanitizeSearchEvidenceSummary(value) {
  return String(value ?? '')
    .replace(/\s*cite[^]*/g, '')
    .replace(/\s*\[wordlim:\s*\d+\]/gi, '')
    .replace(/\s*Published:[^;]+;\s*Crawled:[^;]+;\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLines(value) {
  const normalized = String(value ?? '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  return lines.length ? lines : [''];
}

function isBlank(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim() === '';
}

function toNumber(value) {
  const normalized = String(value ?? '').trim().replace(/(?:米|m|平方米|个)\s*$/i, '').trim();
  return /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

function countBy(values, getter) {
  return values.reduce((counts, value) => {
    const key = getter(value);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
