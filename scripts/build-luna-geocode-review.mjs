import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'data', 'local', 'luna-geocode-review-323.json');
const COMPLETED_REVIEW = path.join(ROOT, 'data', 'local', 'luna-geocode-review-323.completed.json');

const mainland = readJson('data/audit/geocode-mainland-full.json');
const regional = readJson('data/audit/geocode-hkmo-tw.json');
const unresolvedPriority = readJson('data/audit/geocode-unresolved-priority.json');
const riskReview = readJson('data/audit/geocode-risk-review.json');
const derived = readJson('data/derived/cinemas.json');
const completedReview = fs.existsSync(COMPLETED_REVIEW)
  ? JSON.parse(fs.readFileSync(COMPLETED_REVIEW, 'utf8'))
  : { records: [] };

const derivedByRow = new Map(derived.records.map(record => [record.sourceRow, record]));
const completedByRow = new Map((completedReview.records ?? []).map(record => [record.sourceRow, record]));
const unresolvedByRow = new Map(unresolvedPriority.records.map(record => [record.sourceRow, record]));
const riskByRow = new Map(riskReview.records.map(record => [record.sourceRow, record]));

const mainlandMedium = mainland.records.filter(record =>
  ['review-required-medium', 'review-required-ambiguous'].includes(record.selected?.automaticDecision)
);
const mainlandUnresolved = mainland.records.filter(record =>
  !record.selected || !['accepted-high', 'review-required-medium', 'review-required-ambiguous'].includes(record.selected.automaticDecision)
);

const records = [
  ...mainlandMedium
    .sort((a, b) => Number(b.selected?.score ?? 0) - Number(a.selected?.score ?? 0) || a.sourceRow - b.sourceRow)
    .map(record => buildRecord(record, 'mainland-medium')),
  ...mainlandUnresolved
    .sort(compareMainlandUnresolved)
    .map(record => buildRecord(record, 'mainland-unresolved')),
  ...regional.records
    .sort(compareRegional)
    .map(record => buildRecord(record, 'regional-unresolved'))
].map((record, index) => ({ reviewOrder: index + 1, ...record }));

const sourceRows = records.map(record => record.sourceRow);
if (new Set(sourceRows).size !== sourceRows.length) throw new Error('Duplicate sourceRow in Luna review package.');

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  purpose: `Luna 人工核验：未进入正式地图坐标层的 ${records.length} 条影院记录`,
  scope: {
    included: [
      `${mainlandMedium.length} 条 mainland automaticMedium（含 true ambiguity）`,
      `${mainlandUnresolved.length} 条 mainland unresolved`,
      `${regional.records.length} 条香港/澳门/台湾 unresolved`
    ],
    excluded: [
      '当前 accepted-high 坐标',
      '完整 AMap provider cache 与候选原始响应',
      'geocode-high-audit-150 独立高置信抽样任务'
    ]
  },
  summary: {
    total: records.length,
    mainlandMedium: mainlandMedium.length,
    mainlandUnresolved: mainlandUnresolved.length,
    regionalUnresolved: regional.records.length,
    trueUnresolved: mainlandUnresolved.length + regional.records.length,
    pendingCandidateReview: mainlandMedium.length,
    byRegion: countBy(records, record => record.region),
    byReviewGroup: countBy(records, record => record.reviewGroup),
    byProjectionSystem: countBy(records, record => record.projection?.system ?? 'unknown'),
    byStatus: countBy(records, record => record.status ?? 'unknown')
  },
  reviewInstructions: {
    editBoundary: '只填写每条记录的 review 对象；不得改写 source、candidate、queryVariants、reasonTags 等审计证据。',
    requiredChecks: [
      '候选 POI 的省、市、区县与源影院行政区兼容',
      '影院品牌与商场/项目/门店名称匹配，不能只匹配品牌',
      'POI 类型确实为电影院；场馆或商场 fallback 必须明确标注粒度',
      'GT、Dome、4D、XD 等影厅格式不能互相冒充',
      '坐标实际落在影院、场馆或商场，不得使用城市中心或同品牌其他门店',
      '关闭影院可以采用历史场馆/商场位置，但必须提供可核查依据'
    ],
    verdicts: {
      'accept-exact': '候选为同一家影院或明确的对应 IMAX 影厅',
      'accept-location-only': '只确认场馆/商场位置，不能确认精确影院身份',
      'reject-wrong-poi': '候选属于其他门店、其他影厅或非目标业务',
      ambiguous: '两个或多个候选均合理，无法唯一判断',
      'not-found': '未找到可核验的位置',
      'needs-more-evidence': '现有证据不足，需要追加独立来源'
    },
    acceptanceRequirements: {
      'accept-exact': {
        locationConfidence: 'high|medium',
        identityConfidence: 'high',
        locationGranularity: 'auditorium|cinema',
        evidenceUrlsMinimum: 1
      },
      'accept-location-only': {
        locationConfidence: 'high|medium',
        identityConfidence: 'medium|low',
        locationGranularity: 'venue|mall',
        evidenceUrlsMinimum: 1
      }
    },
    prohibited: [
      '不得按第一候选直接通过',
      '不得使用城市中心坐标',
      '不得只凭影院品牌通过',
      '不得把球幕、4D、XD sibling auditorium 当成普通 IMAX/GT',
      '不得在 review 之外改写自动审计数据'
    ],
    expectedReturnFilename: 'luna-geocode-review-323.completed.json'
  },
  records
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: true,
  output: path.relative(ROOT, OUTPUT).replaceAll('\\', '/'),
  total: records.length,
  mainlandMedium: mainlandMedium.length,
  mainlandUnresolved: mainlandUnresolved.length,
  regionalUnresolved: regional.records.length,
  uniqueSourceRows: new Set(sourceRows).size
}, null, 2));

function buildRecord(record, reviewGroup) {
  const source = derivedByRow.get(record.sourceRow);
  const preservedReviewRecord = completedByRow.get(record.sourceRow);
  if (!source) throw new Error(`Missing derived sourceRow ${record.sourceRow}.`);
  const risk = riskByRow.get(record.sourceRow);
  const unresolved = unresolvedByRow.get(record.sourceRow);
  const rawCandidate = record.selected ?? record.topCandidate ?? risk?.selected ?? risk?.topCandidate ?? unresolved?.topCandidate ?? null;
  const automaticDecision = record.selected?.automaticDecision ?? record.automaticDecision ?? rawCandidate?.automaticDecision ?? 'unresolved';
  const reasonTags = unique([
    ...(risk?.reasonTags ?? []),
    ...(unresolved?.reasonTags ?? []),
    ...(reviewGroup === 'mainland-medium' ? ['medium'] : ['unresolved']),
    ...(record.ambiguity?.trueAmbiguity ? ['true-ambiguity'] : [])
  ]);

  return {
    id: source.id,
    sourceRow: record.sourceRow,
    sourceName: source.nameRaw ?? record.sourceName ?? source.name ?? '',
    screen: {
      width: source.screen?.width ?? null,
      height: source.screen?.height ?? null,
      area: source.screen?.area ?? null,
      rawWidth: source.screen?.rawWidth ?? '',
      rawHeight: source.screen?.rawHeight ?? '',
      rawArea: source.screen?.rawArea ?? '',
      selectionConfidence: source.screen?.selectionConfidence ?? 'unknown'
    },
    seats: source.seats ?? null,
    seatsRaw: source.seatsRaw ?? '',
    formerNames: source.formerNames ?? [],
    region: source.region,
    province: record.province ?? source.province,
    city: record.city ?? source.city,
    status: record.status ?? source.status,
    projection: {
      raw: record.projection?.raw ?? source.projection?.raw ?? '',
      system: record.projection?.system ?? source.projection?.system ?? 'unknown',
      dome: Boolean(record.projection?.dome ?? source.projection?.dome),
      audioChannels: record.projection?.audioChannels ?? source.projection?.audioChannels ?? null
    },
    sourceCategory: record.sourceCategory ?? unresolved?.sourceCategory ?? null,
    countyLevelCity: Boolean(record.countyLevelCity ?? false),
    reviewGroup,
    priority: unresolved?.priority ?? (reviewGroup === 'mainland-medium' ? 0 : 99),
    priorityCategory: unresolved?.priorityCategory ?? (reviewGroup === 'mainland-medium' ? 'medium-candidate' : 'regional-unresolved'),
    automaticDecision,
    reasonTags,
    queryVariants: normalizeQueries(record.queryVariants ?? risk?.queryVariantsSummary ?? unresolved?.queryVariantsSummary ?? []),
    candidate: preservedReviewRecord?.candidate
      ? structuredClone(preservedReviewRecord.candidate)
      : normalizeCandidate(rawCandidate),
    hardRejectSummary: record.hardRejectSummary ?? risk?.hardRejectSummary ?? unresolved?.hardRejectSummary ?? emptyHardRejectSummary(),
    ambiguity: record.ambiguity ?? risk?.ambiguity ?? unresolved?.ambiguity ?? emptyAmbiguity(),
    overrideUsed: Boolean(record.overrideUsed),
    review: preservedReviewRecord?.review ? structuredClone(preservedReviewRecord.review) : {
      verdict: null,
      explicitVerdict: false,
      reviewSource: 'unreviewed-default',
      acceptedPoiId: null,
      reviewedCandidate: {
        provider: null,
        poiId: null,
        name: null,
        address: null,
        providerCrs: null,
        providerLat: null,
        providerLng: null
      },
      positionType: null,
      locationGranularity: null,
      locationConfidence: null,
      identityConfidence: null,
      evidenceUrls: [],
      reviewer: null,
      reviewedAt: null,
      notes: '',
      validationErrors: [],
      administrativeBinding: null
    },
    ...(preservedReviewRecord?.reviewContext ? { reviewContext: structuredClone(preservedReviewRecord.reviewContext) } : {})
  };
}

function normalizeCandidate(candidate) {
  if (!candidate) return null;
  const providerCoordinate = candidate.providerCoordinate ?? (candidate.provider ? {
    crs: candidate.provider.providerCrs,
    lat: candidate.provider.providerLat,
    lng: candidate.provider.providerLng
  } : null);
  const mapCoordinate = candidate.mapCoordinate ?? (candidate.map ? {
    crs: candidate.map.mapCrs,
    lat: candidate.map.lat,
    lng: candidate.map.lng
  } : null);
  return {
    poiId: candidate.poiId ?? null,
    name: candidate.name ?? null,
    address: candidate.address ?? null,
    pname: candidate.pname ?? candidate.adminMatch?.providerProvince ?? null,
    cityname: candidate.cityname ?? candidate.adminMatch?.providerPrefecture ?? null,
    adname: candidate.adname ?? candidate.adminMatch?.providerCounty ?? null,
    typecode: candidate.typecode ?? null,
    positionType: candidate.positionType ?? null,
    locationGranularity: candidate.locationGranularity ?? null,
    score: candidate.score ?? null,
    automaticDecision: candidate.automaticDecision ?? null,
    locationConfidence: candidate.locationConfidence ?? candidate.confidence ?? null,
    identityConfidence: candidate.identityConfidence ?? candidate.confidence ?? null,
    geocodeSource: candidate.geocodeSource ?? null,
    adminMatch: candidate.adminMatch ?? null,
    formatCompatibility: candidate.formatCompatibility ?? null,
    providerCoordinate,
    mapCoordinate
  };
}

function normalizeQueries(queries) {
  return queries.map(query => ({
    kind: query.kind ?? null,
    query: query.query ?? null,
    ok: query.ok ?? null,
    candidateCount: query.candidateCount ?? null,
    errorCode: query.errorCode ?? null
  }));
}

function compareMainlandUnresolved(a, b) {
  const aPriority = unresolvedByRow.get(a.sourceRow)?.priority ?? 99;
  const bPriority = unresolvedByRow.get(b.sourceRow)?.priority ?? 99;
  const aScore = Number(a.topCandidate?.score ?? 0);
  const bScore = Number(b.topCandidate?.score ?? 0);
  return aPriority - bPriority || bScore - aScore || a.sourceRow - b.sourceRow;
}

function compareRegional(a, b) {
  const order = { 香港: 1, 澳门: 2, 台湾: 3 };
  return (order[a.region] ?? 99) - (order[b.region] ?? 99) || a.sourceRow - b.sourceRow;
}

function countBy(records, keyFn) {
  const counts = {};
  for (const record of records) {
    const key = String(keyFn(record) ?? 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, 'zh-CN')));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function emptyHardRejectSummary() {
  return { candidateCount: 0, rejectedCandidateCount: 0, reasons: {} };
}

function emptyAmbiguity() {
  return { evaluatedCandidates: 0, ignoredHardRejected: 0, trueAmbiguity: false };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}
