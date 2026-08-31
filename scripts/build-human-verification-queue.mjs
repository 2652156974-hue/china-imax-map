import fs from 'node:fs';
import path from 'node:path';
import {
  AMAP_CACHE_FILE,
  HUMAN_QUEUE_FILE,
  ROOT,
  clean,
  compactAmapCandidate,
  countBy,
  entityHints,
  linkedAmapEvidence,
  loadScopedUnresolved,
  relative,
  readJson,
  writeJson
} from './geocode/amap-human-utils.mjs';

const source = loadScopedUnresolved();
const amapCache = readJson(AMAP_CACHE_FILE);
const publicWebEvidence = loadPublicWebEvidence();
const queue = source.unresolved.map((record) => buildQueueRecord(record, linkedAmapEvidence(record, amapCache), publicWebEvidence.byId.get(record.id) ?? null));
queue.sort((left, right) => right.expectedInformationGain.score - left.expectedInformationGain.score || left.sourceRow - right.sourceRow);
queue.forEach((record, index) => { record.queueRank = index + 1; });

const audit = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: publicWebEvidence.byId.size ? 'ready-for-human-verification-after-public-web-pass' : 'ready-for-human-web-verification',
  scope: {
    total: 901,
    startingLocated: 672,
    startingUnresolved: 229,
    currentLocated: source.located.length,
    currentUnresolved: source.unresolved.length,
    pendingReview: 0,
    canonicalSource: 'data/local/private-reviewed-geocodes.json',
    amapCache: 'data/geocode/provider-cache/amap.json',
    publicWebEvidencePass: publicWebEvidence.file ? relative(publicWebEvidence.file) : null,
    baiduPolicy: 'optional-historical-evidence-only; no new requests in this workflow'
  },
  acceptancePolicy: {
    acceptedExact: 'AMap plus one independent authoritative or otherwise strong source proves the same cinema identity, city and branch/mall; brand-only or proximity-only is insufficient.',
    acceptedLocationOnly: 'AMap plus independent evidence proves the same mall/venue location but not a reliable cinema POI; granularity must remain mall or venue.',
    acceptedHistoricalLocation: 'For closed/removed records, at least two independent sources prove the historical location; current POI existence is not required.',
    unresolved: 'Retain when identity, branch, mall/venue, historical relationship or location cannot be safely proven.'
  },
  priorityPolicy: {
    P1: 'AMap has a highly specific, likely unique cinema candidate and only independent second evidence is missing.',
    P2: 'Two or more concrete AMap branch candidates require a mall, district or address check.',
    P3: 'Mall-only, venue-only or auditorium/location split can be resolved at mall/venue level.',
    P4: 'Former-name or rename evidence is the main missing link.',
    P5: 'Closed or removed historical location needs historical web evidence.',
    P6: 'Weak or genuinely long-tail information; no safe automatic shortcut.'
  },
  summary: {
    records: queue.length,
    amapLinkedRows: queue.filter((record) => record.amapEvidence.linkedQueryCount > 0).length,
    amapRowsWithCandidates: queue.filter((record) => record.bestAmapCandidates.length > 0).length,
    amapRowsWithStrictCandidate: queue.filter((record) => record.bestAmapCandidates.some((candidate) => candidate.strictEntityMatch)).length,
    amapRowsWithRefinementEvidence: queue.filter((record) => record.amapEvidence.refinedQueryCount > 0).length,
    priorityCounts: countBy(queue.map((record) => record.priority)),
    originalReasonCounts: countBy(queue.map((record) => record.originalUnresolvedReason)),
    humanStatusCounts: countBy(queue.map((record) => record.humanVerification.status))
  },
  humanVerificationBatches: buildHumanVerificationBatches(queue, publicWebEvidence),
  records: queue
};

writeJson(HUMAN_QUEUE_FILE, audit);
console.log(JSON.stringify({
  ok: true,
  queue: 'data/audit/human-verification-queue.json',
  summary: audit.summary,
  humanVerificationBatches: audit.humanVerificationBatches,
  top: queue.slice(0, 15).map((record) => ({ queueRank: record.queueRank, priority: record.priority, sourceRow: record.sourceRow, name: record.currentName, expectedInformationGain: record.expectedInformationGain, bestAmap: record.bestAmapCandidates[0]?.name ?? null, recommendedSearchQueries: record.recommendedSearchQueries }))
}, null, 2));

function buildHumanVerificationBatches(records, publicWebEvidence) {
  const priorityOrder = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
  const completedByPriority = loadCompletedHumanCounts(publicWebEvidence);
  const batches = [];
  for (const priority of priorityOrder) {
    const priorityRecords = records.filter((record) => record.priority === priority);
    if (!priorityRecords.length) continue;
    const chunks = splitPriorityRecords(priority, priorityRecords);
    const completedCount = completedByPriority[priority] ?? 0;
    const historicalTotal = completedCount + priorityRecords.length;
    const historicalChunks = splitPriorityRecords(priority, Array.from({ length: historicalTotal }, (_, index) => index));
    let completedBatchOffset = 0;
    let remainingCompleted = completedCount;
    for (const historicalChunk of historicalChunks) {
      if (remainingCompleted < historicalChunk.length) break;
      completedBatchOffset += 1;
      remainingCompleted -= historicalChunk.length;
    }
    chunks.forEach((chunk, index) => {
      const batchIndex = completedBatchOffset + index + 1;
      batches.push({
        batchId: `${priority}-${String(batchIndex).padStart(2, '0')}`,
        priority,
        batchIndex,
        batchCountForPriority: completedBatchOffset + chunks.length,
        status: 'ready-for-human-verification',
        count: chunk.length,
        sourceRows: chunk.map((record) => record.sourceRow),
        ids: chunk.map((record) => record.id)
      });
    });
  }
  return {
    policy: {
      default: 'submit-the-current-priority-as-one-human-verification-batch',
      splitOnlyWhenContextIsLong: true,
      splitThresholdRecords: 40,
      targetSplitBatchRecords: 25,
      splitBatchRange: '20-30 when the priority group is large enough',
      p4AndP5: 'submit-the-entire-priority-group',
      p6: 'follow the same context-aware split rule as other long priority groups',
      humanResultWriteback: 'apply one received human-results file in one materialization pass'
    },
    priorityOrder,
    batches,
    nextBatch: batches[0] ?? null
  };
}

function loadCompletedHumanCounts(publicWebEvidence) {
  const counts = {};
  const priorityById = new Map([...publicWebEvidence.byId.values()].map((record) => [record.id, record.priority]));
  const resultsFile = path.join(ROOT, 'data/audit/human-verification-results.json');
  if (!fs.existsSync(resultsFile)) return counts;
  const results = readJson(resultsFile);
  for (const result of Array.isArray(results) ? results : []) {
    const priority = priorityById.get(result.id);
    if (priority) counts[priority] = (counts[priority] ?? 0) + 1;
  }
  return counts;
}

function splitPriorityRecords(priority, records) {
  if (priority === 'P4' || priority === 'P5' || records.length <= 40) return [records];
  const chunkCount = Math.ceil(records.length / 30);
  const baseSize = Math.floor(records.length / chunkCount);
  const remainder = records.length % chunkCount;
  const chunks = [];
  let offset = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    const size = baseSize + (index < remainder ? 1 : 0);
    chunks.push(records.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

function buildQueueRecord(record, evidence, publicWebEvidence) {
  const selection = evidence.selection;
  const candidates = selection.topThree.map(compactAmapCandidate);
  const best = selection.best;
  const priority = priorityFor(record, selection);
  const expectedInformationGain = informationGainFor(record, evidence, selection, priority);
  return {
    queueRank: null,
    priority,
    sourceRow: record.sourceRow,
    id: record.id,
    arvinOriginalName: record.nameRaw ?? record.name,
    currentName: record.name,
    formerNames: record.formerNames ?? [],
    region: record.region ?? null,
    province: record.province ?? null,
    city: record.city ?? null,
    district: record.district ?? null,
    status: record.status ?? null,
    originalUnresolvedReason: record.finalUnresolvedReason ?? null,
    bestAmapCandidates: candidates,
    amapEvidence: {
      linkedQueryCount: evidence.linked.length,
      successfulQueryCount: evidence.linked.filter((request) => request.ok).length,
      failedQueryCount: evidence.linked.filter((request) => request.ok === false).length,
      refinedQueryCount: evidence.linked.filter((request) => request.scope === 'unresolved-amap-refinement').length,
      queries: evidence.linked.map((request) => ({
        query: request.query ?? null,
        city: request.city ?? null,
        scope: request.scope ?? 'historical-amap-cache',
        ok: Boolean(request.ok),
        candidateCount: (request.rawCandidates ?? request.candidates ?? []).length
      }))
    },
    candidateAddresses: candidates.map((candidate) => ({
      providerPoiId: candidate.providerPoiId,
      name: candidate.name,
      address: candidate.address,
      mallOrVenue: candidate.mallOrVenue,
      poiType: candidate.poiType,
      kind: candidate.kind,
      district: candidate.district
    })),
    currentConflict: buildConflict(record, evidence, selection),
    whyAutomaticAcceptanceFailed: buildAutomaticFailure(record, evidence, selection),
    recommendedSearchQueries: recommendedSearchQueries(record, selection),
    expectedInformationGain,
    recommendedEvidenceTier: recommendedTier(record, priority),
    publicWebEvidence,
    humanVerification: {
      status: 'unverified',
      result: null,
      evidence: [],
      notes: '等待人工或公开网页独立证据；不得仅凭 AMap 单一候选接受。'
    }
  };
}

function loadPublicWebEvidence() {
  const file = path.join(ROOT, 'data/audit/public-web-evidence-pass.json');
  if (!fs.existsSync(file)) return { file: null, byId: new Map() };
  const audit = readJson(file);
  const byId = new Map((audit.records ?? []).map((record) => [record.id, record]));
  return { file, byId };
}

function priorityFor(record, selection) {
  const reason = record.finalUnresolvedReason;
  if (reason === 'closed-or-removed-poi' || /closed|temporarily_closed/i.test(String(record.status ?? ''))) return 'P5';
  if (record.formerNames?.length || reason === 'former-name-only') return 'P4';
  if (reason === 'mall-only' || reason === 'venue-only' || reason === 'auditorium-identity-ambiguous') return 'P3';
  const candidates = selection.topThree;
  const best = selection.best;
  if (best?.strictEntityMatch && best.kind === 'cinema' && !selection.ambiguity && (reason === 'branch-ambiguity' || reason === 'insufficient-evidence')) return 'P1';
  if (best && best.kind === 'cinema' && best.hardRejects.length === 0 && candidates.length >= 2 && (reason === 'branch-ambiguity' || reason === 'insufficient-evidence')) return 'P2';
  if (best?.kind === 'mall' || best?.kind === 'venue') return 'P3';
  return 'P6';
}

function informationGainFor(record, evidence, selection, priority) {
  const best = selection.best;
  let score = { P1: 92, P2: 78, P3: 66, P4: 56, P5: 48, P6: 24 }[priority];
  const reasons = [];
  if (best) {
    if (best.strictEntityMatch) { score += 4; reasons.push('AMap candidate passes its provider-neutral identity screen'); }
    if (best.kind === 'cinema') { score += 3; reasons.push('best candidate is a cinema POI'); }
    if (best.branchMatch || best.formerNameMatch) reasons.push('branch or former-name token is present in the candidate');
    if (selection.ambiguity) reasons.push('a small concrete candidate set can be separated by mall/address evidence');
    if (best.kind === 'mall' || best.kind === 'venue') reasons.push('official mall/venue directory can resolve the location granularity');
    if (best.hardRejects.length) { score -= Math.min(18, best.hardRejects.length * 6); reasons.push(`AMap still has hard conflict: ${best.hardRejects.join(', ')}`); }
  } else {
    score -= 10;
    reasons.push('no usable AMap candidate is currently linked');
  }
  if (evidence.linked.some((request) => request.scope === 'unresolved-amap-refinement' && request.ok)) reasons.push('recent scoped AMap refinement produced evidence');
  if (record.finalUnresolvedReason === 'wrong-city') { score -= 8; reasons.push('stored evidence already indicates a city conflict'); }
  if (record.finalUnresolvedReason === 'provider-no-result') { score -= 5; reasons.push('provider no-result needs broad official or venue search'); }
  return { score: Math.max(0, Math.min(100, Number(score.toFixed(2)))), rationale: reasons };
}

function buildConflict(record, evidence, selection) {
  const conflicts = [];
  const best = selection.best;
  if (!best) conflicts.push('现有及本轮 AMap refinement 没有可用候选。');
  if (selection.ambiguity) conflicts.push(`AMap 存在多个近分候选：${selection.topThree.map((candidate) => candidate.name).filter(Boolean).join(' / ')}。`);
  if (best?.hardRejects?.length) conflicts.push(`最佳 AMap 候选存在冲突：${best.hardRejects.join('、')}。`);
  if (best && best.kind !== 'cinema') conflicts.push(`最佳 AMap POI 类型为 ${best.kind}，不是可直接接受的影院 POI。`);
  const { brand, hints } = entityHints(record);
  if (brand && best && !best.brandMatch) conflicts.push(`来源品牌“${brand}”未被最佳候选明确证明。`);
  if (hints.length && best && !best.branchMatch && !best.formerNameMatch) conflicts.push(`来源分店/商场提示“${hints[0]}”未被最佳候选明确证明。`);
  if (record.status && /closed|temporarily_closed/i.test(String(record.status))) conflicts.push('当前记录有闭店/移除信号，需要历史位置证据。');
  if (record.review?.notes && !/未提供逐条 review/.test(record.review.notes)) conflicts.push(clean(record.review.notes));
  if (record.supplemental?.reviewNotes && !/Existing accepted-high/.test(record.supplemental.reviewNotes)) conflicts.push(clean(record.supplemental.reviewNotes));
  if (evidence.linked.some((request) => request.ok === false)) conflicts.push('部分 AMap query 返回 provider error，不能把失败当作无结果事实。');
  return [...new Set(conflicts)].slice(0, 8);
}

function buildAutomaticFailure(record, evidence, selection) {
  const best = selection.best;
  if (!best) return 'AMap 没有 source-bound 候选，单一 provider 无法建立 location identity。';
  if (selection.ambiguity) return '多个具体候选接近，当前 AMap 只完成召回，未完成分店实体消歧。';
  if (best.kind === 'mall' || best.kind === 'venue') return '目前只能证明商场/场馆位置，不能把商场或场馆自动当成影院门口精确 POI。';
  if (best.hardRejects.length) return `最佳候选仍有硬冲突（${best.hardRejects.join('、')}），不能自动接受。`;
  if (best.strictEntityMatch) return 'AMap 候选高度匹配，但仍缺独立第二证据；不得单 provider exact。';
  return 'AMap 仅提供弱或部分匹配，品牌一致/距离接近不足以证明同一家。';
}

function recommendedSearchQueries(record, selection) {
  const queries = [];
  const add = (query) => {
    query = clean(query);
    if (!query || queries.some((item) => item === query)) return;
    queries.push(query);
  };
  const city = clean(record.city);
  add(`"${clean(record.name)}" ${city} 地址 商场`);
  for (const formerName of record.formerNames ?? []) add(`"${clean(formerName)}" "${clean(record.name)}" ${city} 更名`);
  const best = selection.best;
  if (best) {
    add(`"${clean(best.name)}" "${clean(best.address)}" 官方`);
    if (best.district) add(`"${clean(best.name)}" ${clean(best.district)} 影城 开业`);
  }
  const { brand, hints } = entityHints(record);
  if (brand && hints.length) add(`"${brand}" "${hints[0]}" ${city} 商场 影院`);
  if (record.status && /closed|temporarily_closed/i.test(String(record.status))) add(`"${clean(record.name)}" ${city} 关闭 闭店 原址`);
  if (queries.length < 2) add(`${clean(record.name)} ${city} 电影票 房态`);
  return queries.slice(0, 3);
}

function recommendedTier(record, priority) {
  if (priority === 'P1' || priority === 'P2') return ['Tier 1:品牌官网/官方公众号', 'Tier 1:商场官网/楼层目录', 'Tier 2:大型票务或正规媒体'];
  if (priority === 'P3') return ['Tier 1:商场或场馆官网', 'Tier 2:政府/场馆资料', 'Tier 2:大型票务平台'];
  if (priority === 'P4' || priority === 'P5') return ['Tier 1:品牌官方历史资料', 'Tier 2:正规媒体开闭店报道', 'Tier 2:政府/场馆资料'];
  return ['Tier 1:品牌或商场官方资料', 'Tier 2:正规媒体/大型票务平台', 'Tier 3:其他可核验网页'];
}
