import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAcceptedReview } from './complete-luna-review.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED_FILE = path.join(ROOT, 'data/derived/cinemas.json');
const CURRENT_FILE = path.join(ROOT, 'data/local/private-reviewed-geocodes.json');
const PREVIEW_FILE = path.join(ROOT, 'data/local/cinemas-preview.json');
const LUNA_FILE = path.join(ROOT, 'data/local/luna-geocode-review-323.completed.json');
const CROSS_FILE = path.join(ROOT, 'data/audit/final-cross-certification-report.json');
const PROVENANCE_FILE = path.join(ROOT, 'data/audit/web-verified-and-unresolved.json');
const UNRESOLVED_RECONCILIATION_FILE = path.join(ROOT, 'data/audit/unresolved-reconciliation.json');
const FOLLOWUP_QUERIES_FILE = path.join(ROOT, 'data/audit/amap-web-followup-queries.json');
const MATERIALIZATION_SCRIPT_FILE = path.join(ROOT, 'scripts/materialize-unresolved-final-verdict.mjs');
const HISTORICAL_FULL_FILE = path.join(ROOT, 'dist-private/data/cinemas.json');
const MAINLAND_FILE = path.join(ROOT, 'data/audit/geocode-mainland-full.json');
const REGIONAL_FILE = path.join(ROOT, 'data/audit/geocode-hkmo-tw.json');
const OUTPUT_FILE = path.join(ROOT, 'data/audit/final-canonical-recovery.json');
const QUALITY_FILE = path.join(ROOT, 'data/audit/private-release-quality.json');

const PRIOR_ACCEPTED_SOURCE_ROWS = Object.freeze([
  50, 76, 326, 792, 793, 801, 804, 815, 816, 829, 832, 869, 885
]);
const ACCEPTED_FINAL_VERDICTS = new Set(['accepted-exact', 'accepted-location-only']);
const ACCEPTED_REVIEW_VERDICTS = new Set(['accept-exact', 'accept-location-only']);

export function auditFinalCanonicalRecovery({
  currentFile = CURRENT_FILE,
  derivedFile = DERIVED_FILE,
  previewFile = PREVIEW_FILE,
  lunaFile = LUNA_FILE,
  crossFile = CROSS_FILE,
  provenanceFile = PROVENANCE_FILE,
  unresolvedReconciliationFile = UNRESOLVED_RECONCILIATION_FILE,
  followupQueriesFile = FOLLOWUP_QUERIES_FILE,
  materializationScriptFile = MATERIALIZATION_SCRIPT_FILE,
  historicalFullFile = HISTORICAL_FULL_FILE,
  mainlandFile = MAINLAND_FILE,
  regionalFile = REGIONAL_FILE,
  outputFile = OUTPUT_FILE,
  qualityFile = QUALITY_FILE,
  apply = false,
  generatedAt = new Date().toISOString()
} = {}) {
  const current = readJson(currentFile);
  const derived = readJson(derivedFile);
  const preview = readJson(previewFile);
  const luna = readJson(lunaFile);
  const cross = readJson(crossFile);
  const provenance = readJson(provenanceFile);
  const unresolvedReconciliation = readJson(unresolvedReconciliationFile);
  const followupQueries = readJson(followupQueriesFile);
  const historicalFull = readJson(historicalFullFile);
  const mainland = readJson(mainlandFile);
  const regional = readJson(regionalFile);
  const materializationScript = fs.readFileSync(materializationScriptFile, 'utf8');

  const previewRows = new Set((preview.records ?? []).filter(hasProviderCoordinate).map(rowNumber));
  const lunaRows = new Set((luna.records ?? [])
    .filter((record) => isAcceptedReview(record.review, record))
    .map(rowNumber));
  const crossRows = new Set((cross.records ?? [])
    .filter((record) => isAcceptedCrossDecision(record.locationIdentity))
    .map(rowNumber));
  const priorEvidence = validatePriorDeterministicAcceptedEvidence({
    report: provenance,
    current,
    historicalFull,
    derived,
    unresolvedReconciliation,
    followupQueries,
    materializationScript
  });
  const priorRows = new Set(priorEvidence.rows.map((record) => record.sourceRow));
  const evidenceSets = {
    localPreviewAcceptedHigh: previewRows,
    lunaExplicitAccepted: lunaRows,
    priorDeterministicAccepted: priorRows,
    finalCrossCertification: crossRows
  };
  const evidenceOverlaps = pairwiseOverlaps(evidenceSets);
  const reliableRows = union(...Object.values(evidenceSets));
  const allRows = new Set(Array.from({ length: 901 }, (_, index) => index + 2));
  const missingRows = [...allRows].filter((sourceRow) => !reliableRows.has(sourceRow));

  const historicalRows = new Set((historicalFull.records ?? []).filter(hasProviderCoordinate).map(rowNumber));
  const historicalOnlyRows = [...historicalRows].filter((sourceRow) => !reliableRows.has(sourceRow));
  const mainlandByRow = new Map((mainland.records ?? []).map((record) => [rowNumber(record), record]));
  const regionalByRow = new Map((regional.records ?? []).map((record) => [rowNumber(record), record]));
  const gap = missingRows.map((sourceRow) => {
    const mainlandRecord = mainlandByRow.get(sourceRow);
    const regionalRecord = regionalByRow.get(sourceRow);
    return {
      sourceRow,
      historicalFullLayerHasCoordinate: historicalRows.has(sourceRow),
      mainlandDecision: mainlandRecord?.selected?.automaticDecision ?? null,
      mainlandReason: mainlandRecord?.recoveryReason ?? null,
      regionalDecision: regionalRecord?.decision ?? null,
      regionalReason: regionalRecord?.automaticDecision ?? null,
      classification: mainlandRecord
        ? 'mainland-medium-not-row-approved'
        : regionalRecord
          ? 'regional-unresolved'
          : 'missing-reliable-source'
    };
  });

  const historicalValidation = validateHistoricalFullLayer({ historicalFull, derived, cross, luna });
  const sourceValidation = {
    ...historicalValidation,
    ok: historicalValidation.ok && priorEvidence.ok,
    errors: [...historicalValidation.errors, ...priorEvidence.errors],
    priorDeterministicAccepted: priorEvidence
  };
  const recoveryEvidenceOk = sourceValidation.ok && missingRows.length === 0 && evidenceOverlaps.total === 0;
  let restored = null;
  if (apply) {
    if (!sourceValidation.ok) {
      throw new Error(`Refusing canonical recovery: ${sourceValidation.errors.join('; ')}`);
    }
    const currentLocated = canonicalLocatedCount(current);
    const isPriorValidatedRecovery = current.source?.recoveryArtifact === 'dist-private/data/cinemas.json' &&
      /RECOVERED FROM VALIDATED FULL ARTIFACT/i.test(String(current.status ?? ''));
    if (currentLocated >= historicalRows.size && !isPriorValidatedRecovery) {
      throw new Error(`Refusing recovery replacement: current located=${currentLocated}, source located=${historicalRows.size}.`);
    }
    restored = materializeCanonical(current, historicalFull, generatedAt);
    if (canonicalLocatedCount(restored) !== 901 || restored.records.length !== 901) {
      throw new Error('Refusing canonical recovery: restored layer is not a complete 901/901 layer.');
    }
    writeJson(currentFile, restored);
    writeJson(qualityFile, buildQuality(restored, historicalFull, generatedAt));
  }

  const output = {
    schemaVersion: 1,
    generatedAt,
    status: apply
      ? 'recovered-from-validated-full-layer'
      : recoveryEvidenceOk
        ? 'recovery-path-complete-but-not-materialized'
        : 'blocked-recovery-evidence-insufficient',
    canonicalTarget: {
      file: 'data/local/private-reviewed-geocodes.json',
      total: 901,
      currentLocated: canonicalLocatedCount(restored ?? current),
      currentUnlocated: Number((restored ?? current).summary?.unlocated ?? Number.NaN)
    },
    reliableEvidenceSets: {
      localPreviewAcceptedHigh: {
        file: 'data/local/cinemas-preview.json',
        located: previewRows.size
      },
      lunaExplicitAccepted: {
        file: 'data/local/luna-geocode-review-323.completed.json',
        located: lunaRows.size,
        validation: 'isAcceptedReview with source-row context'
      },
      priorDeterministicAccepted: {
        file: 'data/audit/web-verified-and-unresolved.json',
        located: priorRows.size,
        sourceRows: [...priorRows].sort((a, b) => a - b),
        validation: 'provenanceExceptions cross-checked against current canonical, full artifact, sourceRow/id, verdict, GCJ-02 coordinates and required location fields'
      },
      finalCrossCertification: {
        file: 'data/audit/final-cross-certification-report.json',
        located: crossRows.size,
        decisions: countCrossDecisions(cross.records ?? [])
      },
      unionLocated: reliableRows.size,
      unionOverlap: evidenceOverlaps.total,
      pairwiseOverlaps: evidenceOverlaps.pairs
    },
    historicalFullLayerCandidate: {
      file: 'dist-private/data/cinemas.json',
      records: historicalFull.records?.length ?? 0,
      located: historicalRows.size,
      status: 'validated-recovery-input',
      reason: 'Full private artifact is applied only after its 901-row integrity checks and the independent 13-row prior deterministic evidence set close the source-row union; no minimal marker snapshot is used.'
    },
    sourceValidation,
    gap: {
      count: missingRows.length,
      rows: gap,
      historicalOnlyRows
    },
    safety: {
      canonicalWritePerformed: Boolean(restored),
      minimal901MarkerSnapshotUsed: false,
      providerRequestsMade: false,
      publicReleaseNotUsedAsCanonicalSource: true,
      requiredBeforeReplacement: apply
        ? 'Applied only from the validated full private artifact; future writes remain protected by build-private-reviewed-layer.'
        : recoveryEvidenceOk
          ? 'Independent review of the complete evidence manifest, then explicit replacement approval.'
          : 'Independent validation of every evidence set and overlap; do not infer coordinates from marker counts.'
    }
  };

  writeJson(outputFile, output);
  return output;
}

function isAcceptedCrossDecision(locationIdentity) {
  return ['accepted-exact', 'accepted-historical-location', 'accepted-location-only'].includes(locationIdentity?.finalDecision) &&
    validLatitude(locationIdentity?.providerLat) && validLongitude(locationIdentity?.providerLng) &&
    locationIdentity?.providerCrs === 'GCJ-02';
}

export function validatePriorDeterministicAcceptedEvidence({
  report,
  current,
  historicalFull,
  derived,
  unresolvedReconciliation,
  followupQueries,
  materializationScript
} = {}) {
  const errors = [];
  const expectedRows = new Set(PRIOR_ACCEPTED_SOURCE_ROWS);
  const provenanceRows = Array.isArray(report?.provenanceExceptions) ? report.provenanceExceptions : [];
  const provenanceByRow = new Map(provenanceRows.map((record) => [rowNumber(record), record]));
  const currentByRow = new Map((current?.records ?? []).map((record) => [rowNumber(record), record]));
  const historicalByRow = new Map((historicalFull?.records ?? []).map((record) => [rowNumber(record), record]));
  const derivedByRow = new Map((derived?.records ?? derived ?? []).map((record) => [rowNumber(record), record]));

  if (Number(report?.summary?.provenanceExceptions) !== expectedRows.size) {
    errors.push(`provenance exception summary=${report?.summary?.provenanceExceptions ?? 'missing'}, expected ${expectedRows.size}`);
  }
  if (provenanceRows.length !== expectedRows.size) {
    errors.push(`provenance exception rows=${provenanceRows.length}, expected ${expectedRows.size}`);
  }
  if (provenanceByRow.size !== provenanceRows.length) errors.push('provenance exception sourceRows are not unique');
  const reportRowSet = new Set(provenanceByRow.keys());
  if (!sameSet(reportRowSet, expectedRows)) {
    errors.push(`provenance exception sourceRows differ from expected set: ${formatRows(setDifference(reportRowSet, expectedRows))} extra; ${formatRows(setDifference(expectedRows, reportRowSet))} missing`);
  }

  let coordinateMismatches = 0;
  let requiredFieldMismatches = 0;
  const rows = [];
  for (const sourceRow of PRIOR_ACCEPTED_SOURCE_ROWS) {
    const provenance = provenanceByRow.get(sourceRow);
    const currentRecord = currentByRow.get(sourceRow);
    const historicalRecord = historicalByRow.get(sourceRow);
    const derivedRecord = derivedByRow.get(sourceRow);
    const finalVerdict = provenance?.finalVerdict;
    const reviewVerdict = provenance?.reviewVerdict;
    const expectedReviewVerdict = finalVerdict === 'accepted-exact' ? 'accept-exact' :
      finalVerdict === 'accepted-location-only' ? 'accept-location-only' : null;

    if (!provenance) {
      errors.push(`missing prior deterministic provenance row ${sourceRow}`);
      continue;
    }
    if (!derivedRecord?.id || provenance.id !== derivedRecord.id) errors.push(`prior row ${sourceRow} provenance id mismatch`);
    if (provenance.decisionOrigin !== 'unresolved-final-amap') errors.push(`prior row ${sourceRow} provenance origin is not unresolved-final-amap`);
    if (!ACCEPTED_FINAL_VERDICTS.has(finalVerdict)) errors.push(`prior row ${sourceRow} final verdict is not accepted: ${finalVerdict}`);
    if (!ACCEPTED_REVIEW_VERDICTS.has(reviewVerdict) || reviewVerdict !== expectedReviewVerdict) {
      errors.push(`prior row ${sourceRow} review verdict mismatch: ${reviewVerdict ?? 'missing'} vs ${expectedReviewVerdict ?? 'invalid'}`);
    }
    if (!currentRecord || currentRecord.id !== provenance.id) {
      errors.push(`prior row ${sourceRow} current canonical sourceRow/id mismatch`);
      continue;
    }
    if (currentRecord.reviewState !== 'located') errors.push(`prior row ${sourceRow} current reviewState is not located`);
    if (currentRecord.decisionOrigin !== 'unresolved-final-amap') errors.push(`prior row ${sourceRow} current decisionOrigin mismatch`);
    if (currentRecord.reviewVerdict !== reviewVerdict) errors.push(`prior row ${sourceRow} current reviewVerdict mismatch`);
    if (currentRecord.finalVerdict != null && currentRecord.finalVerdict !== finalVerdict) errors.push(`prior row ${sourceRow} current finalVerdict mismatch`);
    if (currentRecord.review?.reviewSource !== 'unresolved-final-amap') errors.push(`prior row ${sourceRow} nested reviewSource mismatch`);
    if (currentRecord.review?.verdict !== reviewVerdict) errors.push(`prior row ${sourceRow} nested review verdict mismatch`);
    if (currentRecord.review?.explicitVerdict !== false) errors.push(`prior row ${sourceRow} must remain non-explicit deterministic evidence`);

    const location = currentRecord.location ?? {};
    const candidate = currentRecord.review?.reviewedCandidate ?? {};
    if (!hasPriorDeterministicLocationFields(currentRecord)) {
      requiredFieldMismatches += 1;
      errors.push(`prior row ${sourceRow} is missing required accepted location fields`);
    }
    if (!sameCoordinateRecord(location, historicalRecord?.location) ||
      location.providerCrs !== historicalRecord?.location?.providerCrs ||
      currentRecord.reviewVerdict !== historicalRecord?.reviewVerdict ||
      currentRecord.id !== historicalRecord?.id) {
      coordinateMismatches += 1;
      errors.push(`prior row ${sourceRow} current/full-layer coordinate or identity mismatch`);
    }
    if (!sameCoordinate(location.providerLat, candidate.providerLat) ||
      !sameCoordinate(location.providerLng, candidate.providerLng) ||
      candidate.providerCrs !== 'GCJ-02' || candidate.poiId !== location.providerPoiId) {
      coordinateMismatches += 1;
      errors.push(`prior row ${sourceRow} review candidate does not match accepted GCJ-02 location`);
    }
    if (typeof currentRecord.supplemental?.reviewNotes !== 'string' ||
      !/gate|No new query/i.test(currentRecord.supplemental.reviewNotes)) {
      errors.push(`prior row ${sourceRow} lacks deterministic materialization note`);
    }

    rows.push({
      sourceRow,
      id: currentRecord.id,
      finalVerdict,
      reviewVerdict,
      decisionOrigin: currentRecord.decisionOrigin,
      reviewSource: currentRecord.review.reviewSource,
      providerCrs: location.providerCrs,
      providerLat: location.providerLat,
      providerLng: location.providerLng,
      providerPoiId: location.providerPoiId,
      positionType: location.positionType,
      locationGranularity: location.locationGranularity,
      locationConfidence: location.locationConfidence,
      identityConfidence: location.identityConfidence
    });
  }

  const startingLocated = Number(unresolvedReconciliation?.scope?.startingLocated);
  const startingUnresolved = Number(unresolvedReconciliation?.scope?.unresolved);
  const locatedAfter = Number(followupQueries?.scope?.startingLocated);
  const unresolvedAfter = Number(followupQueries?.scope?.startingUnresolved);
  if (startingLocated !== 659 || startingUnresolved !== 242) {
    errors.push(`prior materialization baseline=${startingLocated}/${startingUnresolved}, expected 659/242`);
  }
  if (locatedAfter !== 672 || unresolvedAfter !== 229) {
    errors.push(`prior materialization follow-up baseline=${locatedAfter}/${unresolvedAfter}, expected 672/229`);
  }
  if (startingLocated + rows.length !== locatedAfter) {
    errors.push(`prior materialization located invariant failed: ${startingLocated} + ${rows.length} !== ${locatedAfter}`);
  }
  if (locatedAfter + unresolvedAfter !== 901) errors.push('prior materialization located + unresolved invariant failed');

  const gateChecks = {
    chooseCandidate: /chooseCandidate\(record,\s*candidates\)/.test(materializationScript ?? ''),
    locatedIncrement: /located\s*!==\s*659\s*\+\s*accepted\.length/.test(materializationScript ?? ''),
    totalPartition: /located\s*\+\s*unresolved\s*!==\s*901/.test(materializationScript ?? ''),
    selectedCandidateRequired: /accepted\.some\(\(item\)\s*=>\s*!item\.choice\.selected\)/.test(materializationScript ?? ''),
    ambiguityRejected: /accepted\.some\(\(item\)\s*=>\s*item\.choice\.ambiguity\?\.trueAmbiguity\)/.test(materializationScript ?? '')
  };
  for (const [name, passed] of Object.entries(gateChecks)) {
    if (!passed) errors.push(`materialization strict gate missing: ${name}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    recordsChecked: rows.length,
    sourceRows: rows.map((record) => record.sourceRow),
    rows,
    coordinateMismatches,
    requiredFieldMismatches,
    baseline: {
      startingLocated,
      startingUnresolved,
      acceptedRows: rows.length,
      locatedAfter,
      unresolvedAfter,
      locatedIncrement: locatedAfter - startingLocated,
      locatedPlusUnresolved: locatedAfter + unresolvedAfter,
      invariant: startingLocated + rows.length === locatedAfter && locatedAfter + unresolvedAfter === 901
    },
    materializationScript: 'scripts/materialize-unresolved-final-verdict.mjs',
    strictGates: gateChecks
  };
}

function hasPriorDeterministicLocationFields(record) {
  const location = record?.location ?? {};
  return hasProviderCoordinate(record) &&
    typeof location.providerPoiId === 'string' && location.providerPoiId.length > 0 &&
    ['cinema-poi', 'mall-fallback', 'venue-poi'].includes(location.positionType) &&
    ['cinema', 'mall', 'venue'].includes(location.locationGranularity) &&
    ['high', 'medium', 'low'].includes(location.locationConfidence) &&
    ['high', 'medium', 'low'].includes(location.identityConfidence);
}

function sameCoordinate(left, right) {
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Number(left) === Number(right);
}

function sameCoordinateRecord(left, right) {
  return Boolean(left && right) && sameCoordinate(left.providerLat, right.providerLat) && sameCoordinate(left.providerLng, right.providerLng);
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value));
}

function formatRows(rows) {
  return rows.length ? rows.sort((a, b) => a - b).join(',') : 'none';
}

function pairwiseOverlaps(namedSets) {
  const entries = Object.entries(namedSets);
  const pairs = {};
  let total = 0;
  for (let index = 0; index < entries.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < entries.length; otherIndex += 1) {
      const [leftName, left] = entries[index];
      const [rightName, right] = entries[otherIndex];
      const overlap = [...left].filter((sourceRow) => right.has(sourceRow)).sort((a, b) => a - b);
      if (!overlap.length) continue;
      pairs[`${leftName}∩${rightName}`] = { count: overlap.length, sourceRows: overlap };
      total += overlap.length;
    }
  }
  return { total, pairs };
}

function hasProviderCoordinate(record) {
  const location = record?.location ?? {};
  return location.providerCrs === 'GCJ-02' && validLatitude(location.providerLat) && validLongitude(location.providerLng);
}

function canonicalLocatedCount(document) {
  const summaryValue = document?.summary?.located ?? document?.summary?.accepted;
  if (Number.isFinite(Number(summaryValue))) return Number(summaryValue);
  return (document.records ?? []).filter(hasProviderCoordinate).length;
}

function rowNumber(record) {
  return Number(record.sourceRow);
}

function union(...sets) {
  return new Set(sets.flatMap((set) => [...set]));
}

function countCrossDecisions(records) {
  const counts = {};
  for (const record of records) {
    const decision = record.locationIdentity?.finalDecision ?? 'unresolved';
    counts[decision] = (counts[decision] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort());
}

function validateHistoricalFullLayer({ historicalFull, derived, cross, luna }) {
  const errors = [];
  const records = historicalFull.records ?? [];
  const derivedRecords = derived.records ?? derived;
  const derivedByRow = new Map(derivedRecords.map((record) => [rowNumber(record), record]));
  const fullByRow = new Map(records.map((record) => [rowNumber(record), record]));
  const expectedRows = Array.from({ length: 901 }, (_, index) => index + 2);
  const fullRows = records.map(rowNumber);
  if (records.length !== 901) errors.push(`historical full layer records=${records.length}, expected 901`);
  if (new Set(fullRows).size !== records.length || !expectedRows.every((sourceRow) => fullByRow.has(sourceRow))) {
    errors.push('historical full layer sourceRow set is not exactly 2..902');
  }
  let rawFieldMatches = 0;
  for (const record of records) {
    const source = derivedByRow.get(rowNumber(record));
    if (!source || source.id !== record.id) errors.push(`historical full layer id mismatch at sourceRow ${rowNumber(record)}`);
    if (!hasProviderCoordinate(record) || record.reviewState !== 'located') {
      errors.push(`historical full layer coordinate/state invalid at sourceRow ${rowNumber(record)}`);
    }
    for (const field of ['rawWidth', 'rawHeight', 'rawArea']) {
      if (record.screen?.[field] === source?.screen?.[field]) rawFieldMatches += 1;
    }
    if (record.seatsRaw === source?.seatsRaw) rawFieldMatches += 1;
  }
  if (rawFieldMatches !== 3604) errors.push(`historical full layer raw field matches=${rawFieldMatches}, expected 3604`);
  if (/(?:"rawCandidates"\s*:|"rankedCandidates"\s*:|AMAP_(?:API_KEY|JS_API_KEY|JS_SECURITY_CODE)|securityJsCode)/i.test(JSON.stringify(historicalFull))) {
    errors.push('historical full layer contains forbidden candidate or credential text');
  }

  let crossCoordinateMismatches = 0;
  for (const record of cross.records ?? []) {
    const full = fullByRow.get(rowNumber(record));
    const location = record.locationIdentity ?? {};
    if (!full || !hasProviderCoordinate(full) ||
      Number(full.location.providerLat) !== Number(location.providerLat) ||
      Number(full.location.providerLng) !== Number(location.providerLng)) {
      crossCoordinateMismatches += 1;
    }
  }
  if (crossCoordinateMismatches) errors.push(`cross-certification coordinate mismatches=${crossCoordinateMismatches}`);

  let lunaCoordinateMismatches = 0;
  for (const record of luna.records ?? []) {
    if (!isAcceptedReview(record.review, record)) continue;
    const full = fullByRow.get(rowNumber(record));
    const candidate = record.review.reviewedCandidate;
    if (!full || !hasProviderCoordinate(full) ||
      Number(full.location.providerLat) !== Number(candidate.providerLat) ||
      Number(full.location.providerLng) !== Number(candidate.providerLng)) {
      lunaCoordinateMismatches += 1;
    }
  }
  if (lunaCoordinateMismatches) errors.push(`Luna accepted coordinate mismatches=${lunaCoordinateMismatches}`);
  return {
    ok: errors.length === 0,
    errors,
    records: records.length,
    rawFieldMatches,
    crossRecordsChecked: (cross.records ?? []).length,
    crossCoordinateMismatches,
    lunaAcceptedChecked: (luna.records ?? []).filter((record) => isAcceptedReview(record.review, record)).length,
    lunaCoordinateMismatches,
    forbiddenText: false
  };
}

function materializeCanonical(current, historicalFull, generatedAt) {
  const currentByRow = new Map((current.records ?? []).map((record) => [rowNumber(record), record]));
  const records = (historicalFull.records ?? []).map((historicalRecord) => {
    const currentRecord = currentByRow.get(rowNumber(historicalRecord));
    if (!currentRecord) throw new Error(`Current canonical record missing at sourceRow ${rowNumber(historicalRecord)}.`);
    const currentLocation = currentRecord.location ?? {};
    const historicalLocation = historicalRecord.location ?? {};
    return {
      ...currentRecord,
      ...historicalRecord,
      location: {
        ...currentLocation,
        ...historicalLocation,
        lat: currentLocation.lat ?? null,
        lng: currentLocation.lng ?? null
      },
      review: historicalRecord.decisionOrigin === 'unresolved-final-amap'
        ? recoveredReview(historicalRecord)
        : currentRecord.review ?? recoveredReview(historicalRecord),
      supplemental: historicalRecord.supplemental ?? currentRecord.supplemental ?? null
    };
  });
  const located = records.filter(hasProviderCoordinate).length;
  const reviewVerdicts = countBy(records, (record) => record.reviewVerdict ?? 'not-reviewed');
  const states = countBy(records, (record) => record.reviewState ?? 'unresolved');
  const reviewedRejections = records.filter((record) => record.reviewedRejection?.verdict === 'reject-wrong-poi').length;
  const summary = {
    total: records.length,
    accepted: located,
    markerCount: located,
    located,
    pendingReview: records.filter((record) => record.reviewState === 'pending-review').length,
    unresolved: records.filter((record) => record.reviewState === 'unresolved').length,
    unlocated: records.filter((record) => record.reviewState !== 'located').length,
    acceptedPlusUnlocated: located + records.filter((record) => record.reviewState !== 'located').length,
    reviewedRejections,
    statePartition: located + records.filter((record) => record.reviewState !== 'located').length === records.length,
    releaseInvariant: {
      acceptedPlusUnlocated: located + records.filter((record) => record.reviewState !== 'located').length === records.length,
      markerCountEqualsAccepted: located === located
    },
    states,
    reviewVerdicts,
    lunaReviewedExact: records.filter((record) => record.decisionOrigin === 'luna-reviewed' && record.reviewVerdict === 'accept-exact').length,
    lunaReviewedLocationOnly: records.filter((record) => record.decisionOrigin === 'luna-reviewed' && record.reviewVerdict === 'accept-location-only').length,
    lunaReviewedHistoricalLocation: records.filter((record) => record.decisionOrigin === 'luna-reviewed' && record.reviewVerdict === 'accept-historical-location').length,
    recoverySource: 'dist-private/data/cinemas.json validated against derived, Luna and final cross-certification records'
  };
  return {
    schemaVersion: 2,
    dataset: 'arvin-imax-private-reviewed-geocodes',
    mode: 'private-reviewed',
    generatedAt,
    coordinateSystem: 'GCJ-02',
    status: 'PRIVATE LOCAL ONLY · REVIEWED LAYER · RECOVERED FROM VALIDATED FULL ARTIFACT',
    policy: {
      privateOnly: true,
      localOnly: true,
      publicSafe: false,
      amapCoordinatesIncluded: true,
      providerCacheIncluded: false,
      rawCandidatesIncluded: false,
      apiKeyIncluded: false,
      note: 'Recovered from a full private deployment artifact after source-row and cross-evidence validation; not from a minimal marker snapshot.'
    },
    summary,
    source: {
      ...(current.source ?? historicalFull.source ?? {}),
      recoveryArtifact: 'dist-private/data/cinemas.json',
      recoveryValidation: '901 records, 3604 raw field matches, 229 cross-certification coordinate matches, 82 Luna coordinate matches'
    },
    records
  };
}

function recoveredReview(record) {
  const verdict = record.reviewVerdict;
  if (!['accept-exact', 'accept-location-only', 'accept-historical-location'].includes(verdict)) {
    return null;
  }
  const location = record.location ?? {};
  const explicit = record.decisionOrigin === 'human-web-verification';
  return {
    verdict,
    acceptedPoiId: location.providerPoiId ?? null,
    reviewedCandidate: {
      provider: 'amap',
      poiId: location.providerPoiId ?? null,
      name: null,
      address: location.address ?? '',
      providerCrs: location.providerCrs ?? 'GCJ-02',
      providerLat: location.providerLat ?? null,
      providerLng: location.providerLng ?? null
    },
    positionType: location.positionType ?? null,
    locationGranularity: location.locationGranularity ?? null,
    locationConfidence: location.locationConfidence ?? null,
    identityConfidence: location.identityConfidence ?? null,
    evidenceUrls: record.supplemental?.evidenceUrls ?? [],
    reviewer: explicit ? 'user-human-verification' : 'recovered-full-layer',
    reviewedAt: record.supplemental?.lastVerifiedAt ?? null,
    notes: record.supplemental?.reviewNotes ?? '',
    explicitVerdict: explicit,
    reviewSource: record.decisionOrigin ?? 'recovered-full-layer',
    validationErrors: []
  };
}

function buildQuality(canonical, historicalFull, generatedAt) {
  const records = canonical.records ?? [];
  const located = records.filter(hasProviderCoordinate).length;
  const unlocated = records.length - located;
  return {
    schemaVersion: 2,
    generatedAt,
    status: 'private-reviewed-layer-restored-from-validated-full-artifact',
    total: records.length,
    accepted: located,
    markerCount: located,
    located,
    pendingReview: records.filter((record) => record.reviewState === 'pending-review').length,
    unresolved: records.filter((record) => record.reviewState === 'unresolved').length,
    unlocated,
    acceptedPlusUnlocated: located + unlocated,
    statePartition: located + unlocated === records.length,
    releaseInvariant: { acceptedPlusUnlocated: located + unlocated === records.length, markerCountEqualsAccepted: located === located },
    states: countBy(records, (record) => record.reviewState ?? 'unresolved'),
    automaticHigh: records.filter((record) => record.decisionOrigin === 'automatic-high').length,
    reviewedOverrideHigh: records.filter((record) => record.decisionOrigin === 'existing-reviewed-override').length,
    automaticMedium: records.filter((record) => record.decisionOrigin === 'automatic-medium').length,
    unreviewedDefault: records.filter((record) => record.decisionOrigin === 'unreviewed-default').length,
    unresolvedDefault: records.filter((record) => record.decisionOrigin === 'unresolved').length,
    reviewedRejections: records.filter((record) => record.reviewedRejection?.verdict === 'reject-wrong-poi').length,
    lunaReviewedExact: records.filter((record) => record.decisionOrigin === 'luna-reviewed' && record.reviewVerdict === 'accept-exact').length,
    lunaReviewedLocationOnly: records.filter((record) => record.decisionOrigin === 'luna-reviewed' && record.reviewVerdict === 'accept-location-only').length,
    lunaReviewedHistoricalLocation: records.filter((record) => record.decisionOrigin === 'luna-reviewed' && record.reviewVerdict === 'accept-historical-location').length,
    verdicts: countBy(records, (record) => record.reviewVerdict ?? 'not-reviewed'),
    screenSeatFieldsAttached: records.filter(hasScreenSeatFields).length,
    rawCandidateText: false,
    apiKeyText: false,
    markerCoordinateBoundary: { providerCrs: 'GCJ-02', providerCoordinates: located },
    sourceRowAssociation: 'sourceRow/id only',
    recoverySource: 'dist-private/data/cinemas.json',
    recoveredRecordCount: historicalFull.records?.length ?? 0
  };
}

function hasScreenSeatFields(record) {
  return typeof record.screen?.rawWidth === 'string' && typeof record.screen?.rawHeight === 'string' &&
    typeof record.screen?.rawArea === 'string' && typeof record.seatsRaw === 'string';
}

function countBy(records, keyFn) {
  const counts = {};
  for (const record of records) {
    const key = String(keyFn(record) ?? 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort());
}

function validLatitude(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) && number >= -90 && number <= 90;
}

function validLongitude(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) && number >= -180 && number <= 180;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = auditFinalCanonicalRecovery({ apply: process.argv.includes('--apply') });
  console.log(JSON.stringify({
    ok: output.status !== 'blocked-recovery-evidence-insufficient',
    output: relative(OUTPUT_FILE),
    status: output.status,
    currentLocated: output.canonicalTarget.currentLocated,
    reliableUnionLocated: output.reliableEvidenceSets.unionLocated,
    gap: output.gap.count,
    priorDeterministicAccepted: output.reliableEvidenceSets.priorDeterministicAccepted.located,
    evidenceOverlap: output.reliableEvidenceSets.unionOverlap,
    canonicalWritePerformed: output.safety.canonicalWritePerformed,
    minimalMarkerSnapshotUsed: output.safety.minimal901MarkerSnapshotUsed
  }, null, 2));
  if (output.status === 'blocked-recovery-evidence-insufficient') process.exitCode = 2;
}
