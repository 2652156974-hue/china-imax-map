import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { completeLunaReview, isAcceptedReview, normalizeReview } from './complete-luna-review.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_FILE = path.join(ROOT, 'data/local/luna-geocode-review-323.json');
const COMPLETED_FILE = path.join(ROOT, 'data/local/luna-geocode-review-323.completed.json');
const SUMMARY_FILE = path.join(ROOT, 'data/audit/luna-geocode-review-323-summary.json');
const PRIVATE_FILE = path.join(ROOT, 'data/local/private-reviewed-geocodes.json');
const QUALITY_FILE = path.join(ROOT, 'data/audit/private-release-quality.json');
const CACHE_FILE = path.join(ROOT, 'data/geocode/provider-cache/amap.json');
const AUDIT_FILE = path.join(ROOT, 'data/audit/luna-pending-consolidated-42.json');

export const CONSOLIDATED_ROWS = [
  50, 146, 160, 164, 205, 262, 291, 326, 478, 486, 544,
  714, 729, 746, 747, 757, 773, 785, 789, 792, 793, 798,
  801, 803, 804, 810, 814, 815, 816, 823, 828, 829, 832,
  839, 857, 863, 869, 876, 880, 885, 888, 897
];

export const EXISTING_EXPLICIT_ROWS = [
  50, 146, 160, 164, 205, 262, 291, 326, 478, 486, 544,
  792, 793, 801, 803, 804, 815, 816, 829, 832, 869, 885
];

export const NEW_ROWS = [714, 729, 746, 747, 757, 773, 785, 789, 798, 810, 814, 823, 828, 839, 857, 863, 876, 880, 888, 897];

export const ROW798_ALTERNATE = {
  poiId: 'B0FFFA4Y89',
  name: '无锡万象城',
  address: '金石路88号(大剧院地铁站3号口步行60米)',
  pname: '江苏省',
  cityname: '无锡市',
  adname: '滨湖区',
  typecode: '060101',
  positionType: 'mall-fallback',
  locationGranularity: 'mall',
  score: 0.78,
  adminMatch: {
    compatible: true,
    targetProvince: '江苏',
    targetPrefecture: '无锡',
    targetCounty: null,
    providerProvince: '江苏',
    providerPrefecture: '无锡',
    providerCounty: '滨湖',
    mappingSource: 'prefecture-rule'
  },
  formatCompatibility: { compatible: true, exactFormatMatch: false, conflicts: [] },
  providerCoordinate: { crs: 'GCJ-02', lat: 31.513827, lng: 120.282559 }
};

export const EVIDENCE_URLS = {
  714: [
    'https://www.wandaplazas.com/2015/company_0706/1191.html',
    'https://www.ruyifilm.com/gywm/yclb/xndq/scs/0deeb9fc965d11e982dc005056835733.html'
  ],
  729: [
    'https://www.wanda.cn/2018/2018_1220/39695.html',
    'https://www.wanda.cn/mobile/magazine/mobile/104/2896_info.html?icon=4&id=2896',
    'https://www.sohu.com/a/872339272_122063683'
  ],
  746: [
    'https://www.wanda.cn/2017/2017latest_0710/36232.html',
    'https://www.sohu.com/a/152320884_721596',
    'https://cinema.gaoliang.me/cinema/%E4%B9%9D%E6%B1%9F%E4%B8%87%E8%BE%BE%E5%BD%B1%E5%9F%8E%EF%BC%88%E4%B8%87%E8%BE%BE%E5%B9%BF%E5%9C%BA%E5%BA%97%EF%BC%89_IMAX'
  ],
  747: [
    'https://www.hengdianfilm.com/index_9.aspx',
    'https://www.peoplepower.net.cn/2019/06/29/533/',
    'https://jx.cnr.cn/2011jxfw/xwtt/20200918/t20200918_525266467.shtml'
  ],
  757: [
    'https://www.maigoo.com/citiao/1049114.html',
    'https://www.sohu.com/a/254836677_398083',
    'https://jt.guizhou.gov.cn/xwzx1/hydt/202502/t20250225_86949926.html',
    'https://cinema.gaoliang.me/cinema/%E8%B4%B5%E9%98%B3%E8%B6%8A%E7%95%8C%E5%BD%B1%E5%9F%8E%EF%BC%88%E6%9C%AA%E6%9D%A5%E6%96%B9%E8%88%9F%E5%BA%97%EF%BC%89_IMAX'
  ],
  773: [
    'https://www.maigoo.com/citiao/1073185.html',
    'https://www.wanda.cn/2019/2019latest_0327/40026.html',
    'https://www.sohu.com/a/709240158_121106875'
  ],
  785: [
    'https://www.wanda.cn/2018/2018latest_0130/37785.html',
    'https://www.wlmq.gov.cn/wlmqs/c119313/202506/c00d6cbb753643978d8c7a0fcc61ee94/files/%E4%B9%8C%E9%B2%81%E6%9C%A8%E9%BD%90%E5%B8%822025%E5%B9%B4%E7%AC%AC%E4%B8%80%E5%AD%A3%E5%BA%A6%E6%B6%88%E9%98%B2%E5%AE%89%E5%85%A8%E9%87%8D%E7%82%B9%E5%8D%95%E4%BD%8D%E5%90%8D%E5%86%8C.pdf'
  ],
  789: [
    'https://www.wanda.cn/mobile/magazine/pc/123/3430_info.html',
    'https://www.wanda.cn/mobile/2021/company_0830/22804.html',
    'https://www.xzxw.com/shxf/2021/08/27/content_4841361.html'
  ],
  798: [
    'https://www.nsi.edu.cn/_upload/article/files/1c/f7/f00d849c49c5b462e1e7a058a428/bb2a0eac-3198-4301-baad-59576caac662.pdf',
    'https://nvtongzhisheng.org/corp/20141217/125752.shtml'
  ],
  810: [
    'https://sy.bendibao.com/cyfw/2014824/fw40584_2.shtm',
    'https://static.sse.com.cn/stock/disclosure/announcement/c/201906/000021_20190603_24BG.pdf'
  ],
  814: [
    'https://mhcentreville.com/shenzhenmhmall/zh-cn/shops/index/1',
    'https://jt.dushiquan.net/shenzhen/station_3874/zb/7.html',
    'https://ent.sina.com.cn/m/c/2016-02-02/doc-ifxnzanh0590130.shtml'
  ],
  823: [
    'https://www.polyfilm.cn/productinfo/1914853.html?templateId=1133605',
    'https://maps.apple.com/place?auid=1118368622951487&lsp=57879'
  ],
  828: [
    'https://www.peoplepower.net.cn/2019/06/29/533/',
    'https://m.wuhan.com/xinwen/135811.html'
  ],
  839: [
    'https://www.mitsuifudosan.co.jp/cn/corporate/news/2015/1222/download/20151222.pdf',
    'https://www.sohu.com/a/48091865_335444',
    'https://nb.focus.cn/zixun/915d267d02d0eb96.html'
  ],
  857: [
    'https://jt.dushiquan.net/xian/station_1389/zb/7.html',
    'https://m.dongfangfuli.com/cinema/list?city=219&region_id=1841'
  ],
  863: [
    'https://www.sstm.org.cn/index',
    'https://tw.trip.com/travel-guide/attraction/shanghai/city-79710379/'
  ],
  876: [
    'https://www.polyfilm.cn/productinfo/1897954.html'
  ],
  880: [
    'https://www.hnzose.com/kuxiuhuwaishow/?id=2755',
    'https://www.hnzose.com/yuanxianshow/?id=1534',
    'https://www.visitsanya.com/zh/%E6%8E%A2%E7%B4%A2%E4%B8%89%E4%BA%9A/%E6%97%B6%E5%B0%9A%E8%B4%AD/%E7%83%AD%E9%97%A8%E8%B4%AD%E7%89%A9%E5%9C%B0%E6%A0%87/%E7%BB%BC%E5%90%88%E8%B4%AD%E7%89%A9%E4%B8%AD%E5%BF%83/1%E5%8F%B7%E6%B8%AF%E6%B9%BE%E5%9F%8E%EF%BC%88%E5%A4%A7%E8%8F%A0%E8%90%9D%E5%95%86%E5%9C%BA%EF%BC%89'
  ],
  888: [
    'https://locatecinemas.com/cinemas/china/taiyuan/',
    'https://www.xiaoyuzhoufm.com/episode/660b73c12d9eae5d0a8331ae'
  ],
  897: [
    'https://static.sse.com.cn/stock/disclosure/announcement/c/201906/000021_20190603_24BG.pdf',
    'https://www.sohu.com/a/193405293_99921446',
    'https://czt.fujian.gov.cn/zwgk/czzj/202509/P020250905412926999950.pdf'
  ]
};

export const DECISIONS = {
  714: { verdict: 'accept-exact', poiId: 'B0FFG4Y0LT', positionType: 'cinema-poi', locationGranularity: 'cinema', locationConfidence: 'high', identityConfidence: 'high' },
  729: { verdict: 'needs-more-evidence' },
  746: { verdict: 'accept-exact', poiId: 'B0FFHO46HI', positionType: 'cinema-poi', locationGranularity: 'cinema', locationConfidence: 'high', identityConfidence: 'high', administrativeBinding: { status: 'confirmed-by-independent-evidence', sourceRow: 746, sourceCity: '九江', candidateCity: '九江', candidateAdministrativeUnit: '濂溪', evidenceUrls: ['https://www.wanda.cn/2017/2017latest_0710/36232.html'] } },
  747: { verdict: 'accept-exact', poiId: 'B0FFGUA5XD', positionType: 'cinema-poi', locationGranularity: 'cinema', locationConfidence: 'high', identityConfidence: 'high' },
  757: { verdict: 'accept-exact', poiId: 'B0FFI0DG5O', positionType: 'cinema-poi', locationGranularity: 'cinema', locationConfidence: 'high', identityConfidence: 'high' },
  773: { verdict: 'accept-exact', poiId: 'B0FFKPHEB7', positionType: 'cinema-poi', locationGranularity: 'cinema', locationConfidence: 'high', identityConfidence: 'high', administrativeBinding: { status: 'confirmed-by-independent-evidence', sourceRow: 773, sourceCity: '玉林', candidateCity: '玉林', candidateAdministrativeUnit: '玉州', evidenceUrls: ['https://www.maigoo.com/citiao/1073185.html'] } },
  785: { verdict: 'needs-more-evidence' },
  789: { verdict: 'needs-more-evidence' },
  798: { verdict: 'accept-location-only', poiId: 'B0FFFA4Y89', positionType: 'mall-fallback', locationGranularity: 'mall', locationConfidence: 'high', identityConfidence: 'medium' },
  810: { verdict: 'accept-location-only', poiId: 'B0L1ZSM7A1', positionType: 'mall-fallback', locationGranularity: 'mall', locationConfidence: 'high', identityConfidence: 'medium' },
  814: { verdict: 'accept-location-only', poiId: 'B0FFFDNINF', positionType: 'mall-fallback', locationGranularity: 'mall', locationConfidence: 'high', identityConfidence: 'medium' },
  823: { verdict: 'accept-location-only', poiId: 'B0G0ARWNS6', positionType: 'mall-fallback', locationGranularity: 'mall', locationConfidence: 'high', identityConfidence: 'medium' },
  828: { verdict: 'needs-more-evidence' },
  839: { verdict: 'accept-location-only', poiId: 'B023E0XY1I', positionType: 'mall-fallback', locationGranularity: 'mall', locationConfidence: 'high', identityConfidence: 'medium' },
  857: { verdict: 'accept-exact', poiId: 'B0FFGWXZBB', positionType: 'cinema-poi', locationGranularity: 'cinema', locationConfidence: 'high', identityConfidence: 'high' },
  863: { verdict: 'accept-location-only', poiId: 'B00150C4B6', positionType: 'venue-poi', locationGranularity: 'venue', locationConfidence: 'high', identityConfidence: 'medium' },
  876: { verdict: 'accept-location-only', poiId: 'B0HR6U8297', positionType: 'mall-fallback', locationGranularity: 'mall', locationConfidence: 'high', identityConfidence: 'medium' },
  880: { verdict: 'accept-exact', poiId: 'B0FFFEC29K', positionType: 'cinema-poi', locationGranularity: 'cinema', locationConfidence: 'high', identityConfidence: 'high' },
  888: { verdict: 'accept-exact', poiId: 'B0HU1AAO65', positionType: 'cinema-poi', locationGranularity: 'cinema', locationConfidence: 'high', identityConfidence: 'high' },
  897: { verdict: 'reject-wrong-poi', rejectedPoiId: 'B0H1D7OSZ5' }
};

export const NOTES = {
  714: '独立万达广场开业记录与儒意影院目录均指向内江万达广场店；源日期与项目一致。仅使用 sourceRow=714 的缓存影院 POI B0FFG4Y0LT，accept-exact；不请求 AMap。',
  729: '独立证据确认宜宾万达广场及万达影城 IMAX，但公开地址写作航天路南段7号，当前 sourceRow 缓存候选地址为航天路南段5号；地址尚未闭合，保持 needs-more-evidence，不物化。',
  746: '万达官方开业信息、九江本地报道及独立影院规格页共同指向九江濂溪万达影城；仅使用 sourceRow=746 的缓存影院 POI B0FFHO46HI，accept-exact；不请求 AMap。',
  747: '横店影视官方门店目录给出九江横店电影城及京九路9号联盛快乐城4楼；人民能量名录与央广网独立报道再次绑定该影院/地址。仅使用 sourceRow=747 的缓存影院 POI B0FFGUA5XD，accept-exact；不请求 AMap。',
  757: '猫头鹰/本地公开资料、贵州交通公开报道及影院资料均指向贵阳未来方舟越界影城，名称、项目与历史指纹吻合；已撤销的广州候选不得恢复。仅使用 sourceRow=757 缓存 POI B0FFI0DG5O，accept-exact；不请求 AMap。',
  773: '玉林万达项目资料确认金玉路338号、万达影城及玉州万达项目；仅使用 sourceRow=773 的缓存影院 POI B0FFKPHEB7，accept-exact；不请求 AMap。',
  785: '独立资料确认德汇万达及其影城位于奇台路688号，但德汇万达公开开业信息为2018年，而源记录日期为2016-08-12；时间指纹未闭合，保持 needs-more-evidence，不物化。',
  789: '独立资料显示拉萨城关万达影城对应2020年开业，而柳梧万达广场及其影院为2021年开业；当前缓存候选是柳梧店，与源记录2020-08-10存在分店/时间冲突，保持 needs-more-evidence，不物化。',
  798: '独立影院清单明确列出2014—2022年橙天嘉禾影城IMAX万象城店及原无锡万象城金石路88号；2026年新开的金石路188号西区 B0LDYU2L4Z 是另一项目。现显式使用 sourceRow=798 缓存 alternate B0FFFA4Y89，并禁止 B0LDYU2L4Z；仅 accept-location-only，不声称影院级精确 POI。',
  810: '本地宝与证券披露材料均将 CGV金融中心店绑定到沈阳市沈河区哈尔滨路168号金融中心购物广场；缓存候选是同址商场 POI B0L1ZSM7A1，因此仅 accept-location-only，不声称影院级精确 POI。',
  814: '观澜湖官方商场页、深圳本地地址目录及开业报道共同绑定橙天嘉禾与观澜湖 MH MALL；缓存只有商场 POI B0FFFDNINF，因此仅 accept-location-only，不声称影院级精确 POI。',
  823: '保利电影官方页面与独立地图页共同绑定 CGV星星影城佛山星耀101及新城裕和路141号；缓存只有项目 POI B0G0ARWNS6，因此仅 accept-location-only。',
  828: '独立门店目录与武汉公开闭店信息均指向马鹦路117号江腾广场，但当前缓存 POI 名称为江腾广场，而源记录为江腾店，严格名称/项目绑定仍未闭合；保持 needs-more-evidence，不物化。',
  839: '三井官方项目资料、宁波本地公开资料共同绑定星美国际影城与杉井奥特莱斯；缓存只有商场 POI B023E0XY1I，因此仅 accept-location-only。',
  857: '独立影院地址目录与运营方影院目录均明确太平洋影城西安大明宫店位于太华南路141号家豪大厦3层；仅使用 sourceRow=857 缓存 POI B0FFGWXZBB，accept-exact。',
  863: '上海科技馆官方地址与独立公开资料均绑定世纪大道2000号科技馆及馆内 IMAX；当前是 venue POI，不把场馆内部影厅误写成影院级 POI，accept-location-only。',
  876: '保利电影官方页面明确 CGV星星影城中山兴中店位于兴中广场 B2 4F；缓存只有兴中广场项目 POI B0HR6U8297，因此仅 accept-location-only。',
  880: '运营方页面明确三亚中视国际影城巨幕/港湾城店及榆亚路136号港湾城4层，官方旅游资料也绑定港湾城；“巨幕”是整家影城名称，不是独立影厅 POI，保守降为 cinema 后 accept-exact。',
  888: '独立影院目录与节目资料均指向坞城南路162号华景天地9层时代影城；源记录含“原太原泰禾影城”，名称/地址连续，accept-exact。',
  897: '独立材料指向泉州丰泽东海泰禾/保利万和历史门店，而当前缓存候选 B0H1D7OSZ5 是晋江店，属于同地级市不同分店；reject-wrong-poi，不猜正确 POI，不物化。'
};

const REVIEWER = 'Codex consolidated pending review (cache-only)';
const REVIEWED_AT = '2026-08-24T00:00:00.000Z';
const PROVIDER_HOST_RE = /(?:^|\.)\b(?:amap|autonavi|gaode)\.com$/iu;

export function prepareLunaPendingConsolidatedReview({
  reviewFile = REVIEW_FILE,
  completedFile = COMPLETED_FILE,
  summaryFile = SUMMARY_FILE,
  auditFile = AUDIT_FILE,
  reviewedAt = REVIEWED_AT
} = {}) {
  const cacheShaBefore = sha256(CACHE_FILE);
  const reviewPackage = readJson(reviewFile);
  const privateLayer = readJson(PRIVATE_FILE);
  const quality = readJson(QUALITY_FILE);
  assertFormalLayer(quality, privateLayer);

  if (!Array.isArray(reviewPackage.records) || reviewPackage.records.length !== 323) {
    throw new Error('Expected the canonical 323-row Luna review package.');
  }
  const byRow = new Map(reviewPackage.records.map((record) => [Number(record.sourceRow), record]));
  assertExactRows(byRow, CONSOLIDATED_ROWS, 'consolidated pending review');
  assertExistingExplicitReviews(byRow);

  for (const row of NEW_ROWS) {
    const record = byRow.get(row);
    if (record.review?.explicitVerdict === true || record.reviewSource === 'explicit-row-review') {
      throw new Error(`sourceRow ${row} is already explicit; refusing to overwrite a prior review.`);
    }
    if (!['review-required-medium', 'review-required-ambiguous'].includes(record.automaticDecision)) {
      throw new Error(`sourceRow ${row} is not an automatic-medium pending record.`);
    }
    applyReviewContext(record, row);
    const decisionCandidate = getDecisionCandidate(record, DECISIONS[row]);
    assertSourceRowBoundCacheCandidate(row, decisionCandidate);
    assertIndependentUrls(EVIDENCE_URLS[row], row);
    const nextReview = buildReview(record, DECISIONS[row], row, reviewedAt);
    const normalized = normalizeReview(nextReview, { recordContext: record });
    assertDecision(row, record, normalized, DECISIONS[row]);
    record.review = nextReview;
  }

  const explicitCount = reviewPackage.records.filter((record) => record.review?.explicitVerdict === true).length;
  if (explicitCount !== 109) throw new Error(`Expected 109 explicit reviews after consolidation, got ${explicitCount}.`);
  reviewPackage.status = 'review-input-consolidated-pending-42';
  reviewPackage.generatedAt = new Date().toISOString();
  reviewPackage.reviewValidation = {
    schemaVersion: 2,
    reviewComplete: false,
    evidenceBounded: true,
    recordsWithExplicitVerdict: explicitCount,
    recordsAutoFilledNeedsMoreEvidence: reviewPackage.records.length - explicitCount,
    recordsDowngradedFromInvalidAccept: 0,
    consolidatedPendingRows: CONSOLIDATED_ROWS.length,
    consolidatedNewRows: NEW_ROWS.length,
    materializationAuthorized: false
  };

  const cacheShaBeforeWrite = sha256(CACHE_FILE);
  if (cacheShaBeforeWrite !== cacheShaBefore) throw new Error('Provider cache changed before review write.');
  atomicWriteJson(reviewFile, reviewPackage);

  const strictResult = completeLunaReview({
    inputFile: reviewFile,
    outputFile: completedFile,
    summaryFile,
    reviewedAt
  });
  if (strictResult.recordsWithExplicitVerdict !== 109 || strictResult.accepted !== 82 || strictResult.recordsDowngradedFromInvalidAccept !== 0) {
    throw new Error(`Unexpected strict result after consolidation: ${JSON.stringify(strictResult)}`);
  }

  const completed = readJson(completedFile);
  const summary = readJson(summaryFile);
  const audit = buildConsolidatedAudit(reviewPackage, completed, summary, quality, privateLayer, cacheShaBefore);
  atomicWriteJson(auditFile, audit);

  const cacheShaAfter = sha256(CACHE_FILE);
  if (cacheShaAfter !== cacheShaBefore) throw new Error('Provider cache changed during cache-only consolidated review.');
  audit.cacheSha256After = cacheShaAfter;
  audit.network = { newAmapRequests: 0, networkRequests: 0, providerRunnerStarted: false };
  atomicWriteJson(auditFile, audit);
  return {
    reviewFile,
    completedFile,
    summaryFile,
    auditFile,
    cacheSha256: cacheShaAfter,
    strictResult,
    counts: audit.counts,
    formalLayerBefore: audit.formalLayerBefore,
    formalLayerAfter: audit.formalLayerAfter
  };
}

export function finalizeLunaPendingConsolidatedReview({
  reviewFile = REVIEW_FILE,
  completedFile = COMPLETED_FILE,
  summaryFile = SUMMARY_FILE,
  privateFile = PRIVATE_FILE,
  qualityFile = QUALITY_FILE,
  auditFile = AUDIT_FILE,
  cacheFile = CACHE_FILE,
  finalizedAt = new Date().toISOString()
} = {}) {
  const reviewPackage = readJson(reviewFile);
  const completed = readJson(completedFile);
  const summary = readJson(summaryFile);
  const privateLayer = readJson(privateFile);
  const quality = readJson(qualityFile);
  const previousAudit = readJson(auditFile);
  const reviewByRow = new Map(reviewPackage.records.map((record) => [Number(record.sourceRow), record]));
  const completedByRow = new Map(completed.records.map((record) => [Number(record.sourceRow), record]));
  assertExactRows(reviewByRow, CONSOLIDATED_ROWS, 'consolidated pending review');
  assertExactRows(completedByRow, CONSOLIDATED_ROWS, 'completed consolidated review');

  const acceptedRows = [];
  const unresolvedRows = [];
  for (const sourceRow of CONSOLIDATED_ROWS) {
    const inputRecord = reviewByRow.get(sourceRow);
    const completedRecord = completedByRow.get(sourceRow);
    if (inputRecord.review?.explicitVerdict !== true) {
      throw new Error(`sourceRow ${sourceRow} is not explicitly finalized.`);
    }
    const normalized = normalizeReview(completedRecord.review, { recordContext: completedRecord });
    if (normalized.reviewSource === 'invalid-accept-downgraded') {
      throw new Error(`sourceRow ${sourceRow} contains an invalid accepted review.`);
    }
    if (isAcceptedReview(normalized, completedRecord)) acceptedRows.push(sourceRow);
    else unresolvedRows.push(sourceRow);
  }

  const after = formalSnapshot(quality, privateLayer);
  if (after.total !== 901 || after.pendingReview !== 0 || after.accepted + after.unlocated !== 901) {
    throw new Error(`Final private layer invariant failed: ${JSON.stringify(after)}`);
  }
  if (acceptedRows.length !== after.accepted - Number(previousAudit.formalLayerBefore?.accepted ?? after.accepted)) {
    throw new Error(`Accepted delta does not match consolidated materialization: ${acceptedRows.length} vs ${after.accepted - Number(previousAudit.formalLayerBefore?.accepted ?? after.accepted)}.`);
  }
  if (unresolvedRows.length !== after.unresolved - Number(previousAudit.formalLayerBefore?.unresolved ?? after.unresolved)) {
    throw new Error(`Unresolved delta does not match consolidated finalization: ${unresolvedRows.length} vs ${after.unresolved - Number(previousAudit.formalLayerBefore?.unresolved ?? after.unresolved)}.`);
  }

  const cacheSha = sha256(cacheFile);
  const audit = buildConsolidatedAudit(reviewPackage, completed, summary, quality, privateLayer, cacheSha);
  audit.generatedAt = finalizedAt;
  audit.status = 'materialized-pending-review-zero';
  audit.materializationAuthorized = true;
  audit.formalLayerBefore = previousAudit.formalLayerBefore;
  audit.formalLayerAfter = after;
  audit.materialization = {
    status: 'applied',
    finalizedAt,
    consolidatedRows: CONSOLIDATED_ROWS.length,
    acceptedRows: acceptedRows.length,
    unresolvedRows: unresolvedRows.length,
    pendingRowsResolved: CONSOLIDATED_ROWS.length,
    newAmapRequests: 0,
    networkRequests: 0,
    providerCacheSha256: cacheSha,
    providerCacheChanged: false,
    derivedCoordinatesApplied: acceptedRows.length,
    targetLayer: 'data/local/private-reviewed-geocodes.json'
  };
  audit.network = { newAmapRequests: 0, networkRequests: 0, providerRunnerStarted: false };
  atomicWriteJson(auditFile, audit);

  reviewPackage.status = 'review-input-consolidated-materialized';
  reviewPackage.generatedAt = finalizedAt;
  reviewPackage.reviewValidation = {
    ...(reviewPackage.reviewValidation ?? {}),
    materializationAuthorized: true,
    materializationStatus: 'applied',
    materializedAt: finalizedAt,
    pendingRowsResolved: CONSOLIDATED_ROWS.length
  };
  atomicWriteJson(reviewFile, reviewPackage);

  return {
    auditFile,
    reviewFile,
    status: audit.status,
    total: after.total,
    located: after.located,
    pendingReview: after.pendingReview,
    unresolved: after.unresolved,
    acceptedRows: acceptedRows.length,
    unresolvedRows: unresolvedRows.length,
    newAmapRequests: 0,
    cacheSha256: cacheSha
  };
}

function buildReview(record, decision, row, reviewedAt) {
  const common = {
    evidenceUrls: EVIDENCE_URLS[row],
    reviewer: REVIEWER,
    reviewedAt,
    notes: NOTES[row],
    explicitVerdict: true,
    reviewSource: 'explicit-row-review',
    validationErrors: []
  };
  if (decision.verdict === 'needs-more-evidence' || decision.verdict === 'reject-wrong-poi') {
    return {
      ...common,
      verdict: decision.verdict,
      acceptedPoiId: null,
      reviewedCandidate: emptyReviewedCandidate(),
      positionType: null,
      locationGranularity: null,
      locationConfidence: null,
      identityConfidence: null
    };
  }
  const candidate = getDecisionCandidate(record, decision);
  if (!candidate || candidate.poiId !== decision.poiId) {
    throw new Error(`Decision POI mismatch at sourceRow ${row}.`);
  }
  return {
    ...common,
    verdict: decision.verdict,
    acceptedPoiId: candidate.poiId,
    reviewedCandidate: {
      provider: 'amap',
      poiId: candidate.poiId,
      name: candidate.name,
      address: candidate.address,
      providerCrs: candidate.providerCoordinate.crs,
      providerLat: candidate.providerCoordinate.lat,
      providerLng: candidate.providerCoordinate.lng
    },
    positionType: decision.positionType,
    locationGranularity: decision.locationGranularity,
    locationConfidence: decision.locationConfidence,
    identityConfidence: decision.identityConfidence,
    administrativeBinding: decision.administrativeBinding ?? null
  };
}

function buildConsolidatedAudit(input, completed, strictSummary, quality, privateLayer, cacheSha) {
  const inputByRow = new Map(input.records.map((record) => [Number(record.sourceRow), record]));
  const completedByRow = new Map(completed.records.map((record) => [Number(record.sourceRow), record]));
  const rows = CONSOLIDATED_ROWS.map((sourceRow) => {
    const original = inputByRow.get(sourceRow);
    const record = completedByRow.get(sourceRow);
    const review = record.review;
    const considered = original.candidate ? {
      poiId: original.candidate.poiId ?? null,
      name: original.candidate.name ?? null,
      address: original.candidate.address ?? null,
      typecode: original.candidate.typecode ?? null,
      providerCoordinate: original.candidate.providerCoordinate ?? null,
      sourceRowBoundCache: cacheCandidateIsBound(sourceRow, original.candidate)
    } : null;
    const accepted = isAcceptedReview(review, record);
    return {
      sourceRow,
      id: record.id,
      sourceName: record.sourceName,
      region: record.region,
      province: record.province,
      city: record.city,
      verdict: review.verdict,
      explicitVerdict: review.explicitVerdict,
      reviewSource: review.reviewSource,
      acceptedPoiId: accepted ? review.acceptedPoiId : null,
      acceptedCandidate: accepted ? {
        provider: review.reviewedCandidate.provider,
        poiId: review.reviewedCandidate.poiId,
        providerCrs: review.reviewedCandidate.providerCrs,
        providerLat: review.reviewedCandidate.providerLat,
        providerLng: review.reviewedCandidate.providerLng,
        positionType: review.positionType,
        locationGranularity: review.locationGranularity,
        locationConfidence: review.locationConfidence,
        identityConfidence: review.identityConfidence
      } : null,
      consideredCandidate: considered,
      selectedCandidatePoiId: original.candidate?.poiId ?? null,
      evidenceUrls: review.evidenceUrls ?? [],
      independentEvidenceUrlCount: (review.evidenceUrls ?? []).filter(isIndependentEvidenceUrl).length,
      notes: review.notes ?? '',
      validationErrors: review.validationErrors ?? []
    };
  });
  const verdictCounts = countBy(rows, (row) => row.verdict);
  const formalBefore = formalSnapshot(quality, privateLayer);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'review-only-awaiting-approval',
    materializationAuthorized: false,
    scope: {
      totalPendingReviewRows: CONSOLIDATED_ROWS.length,
      sourceRowsSorted: CONSOLIDATED_ROWS,
      existingExplicitRows: EXISTING_EXPLICIT_ROWS,
      newlyReviewedRows: NEW_ROWS
    },
    formalLayerBefore: formalBefore,
    formalLayerAfter: formalBefore,
    counts: {
      total: rows.length,
      acceptExact: verdictCounts['accept-exact'] ?? 0,
      acceptLocationOnly: verdictCounts['accept-location-only'] ?? 0,
      needsMoreEvidence: verdictCounts['needs-more-evidence'] ?? 0,
      rejectWrongPoi: verdictCounts['reject-wrong-poi'] ?? 0,
      verdicts: verdictCounts
    },
    strictValidation: {
      total: completed.records.length,
      explicitVerdicts: completed.reviewValidation.recordsWithExplicitVerdict,
      acceptedCoordinates: strictSummary.recordsWithAcceptedCoordinates,
      autoFilledNeedsMoreEvidence: completed.reviewValidation.recordsAutoFilledNeedsMoreEvidence,
      downgradedFromInvalidAccept: completed.reviewValidation.recordsDowngradedFromInvalidAccept
    },
    evidencePolicy: 'Independent non-provider HTTP(S) evidence is required for each accepted review; cache candidate is sourceRow-bound and remains internal.',
    cacheSha256Before: cacheSha,
    cacheSha256After: cacheSha,
    network: { newAmapRequests: 0, networkRequests: 0, providerRunnerStarted: false },
    rows
  };
}

function assertFormalLayer(quality, privateLayer) {
  const snapshot = formalSnapshot(quality, privateLayer);
  const expected = { total: 901, accepted: 644, markerCount: 644, located: 644, pendingReview: 42, unresolved: 215, unlocated: 257 };
  for (const [key, value] of Object.entries(expected)) {
    if (snapshot[key] !== value) throw new Error(`Formal layer changed before consolidated review: ${key}=${snapshot[key]}, expected ${value}.`);
  }
  if (snapshot.accepted + snapshot.unlocated !== 901) throw new Error('Formal accepted + unlocated invariant failed before review.');
}

function formalSnapshot(quality, privateLayer) {
  const q = quality ?? {};
  const s = privateLayer?.summary ?? {};
  return {
    total: Number(s.total ?? q.total),
    accepted: Number(s.accepted ?? q.accepted),
    markerCount: Number(s.markerCount ?? q.markerCount),
    located: Number(s.located ?? q.located),
    pendingReview: Number(s.pendingReview ?? q.pendingReview),
    unresolved: Number(s.unresolved ?? q.unresolved),
    unlocated: Number(s.unlocated ?? q.unlocated),
    screenSeatFieldsAttached: Number(q.screenSeatFieldsAttached ?? 0)
  };
}

function assertExistingExplicitReviews(byRow) {
  for (const row of EXISTING_EXPLICIT_ROWS) {
    const record = byRow.get(row);
    if (!record || record.review?.explicitVerdict !== true || record.review?.verdict !== 'needs-more-evidence') {
      throw new Error(`Existing conservative review at sourceRow ${row} is not intact.`);
    }
  }
}

function assertExactRows(byRow, rows, label) {
  for (const row of rows) if (!byRow.has(row)) throw new Error(`Missing ${label} sourceRow ${row}.`);
}

function assertDecision(row, record, normalized, decision) {
  if (normalized.verdict !== decision.verdict) throw new Error(`Strict verdict mismatch at sourceRow ${row}: ${normalized.verdict}.`);
  if (decision.verdict.startsWith('accept')) {
    if (!isAcceptedReview(normalized, record)) {
      throw new Error(`Strict context rejected accepted decision at sourceRow ${row}: ${(normalized.validationErrors ?? []).join('; ')}`);
    }
    if (normalized.acceptedPoiId !== decision.poiId) throw new Error(`Strict POI mismatch at sourceRow ${row}.`);
  } else if (normalized.acceptedPoiId !== null) {
    throw new Error(`Non-accepted row ${row} contains an accepted POI.`);
  }
}

function assertIndependentUrls(urls, row) {
  if (!Array.isArray(urls) || urls.length === 0) throw new Error(`Missing independent evidence at sourceRow ${row}.`);
  for (const url of urls) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Non-HTTP evidence URL at sourceRow ${row}.`);
    if (PROVIDER_HOST_RE.test(parsed.hostname)) throw new Error(`Provider self-evidence at sourceRow ${row}.`);
    if (/%(?![0-9a-f]{2})/iu.test(url)) throw new Error(`Malformed percent escape at sourceRow ${row}.`);
  }
}

function assertSourceRowBoundCacheCandidate(sourceRow, candidate) {
  if (!candidate || !cacheCandidateIsBound(sourceRow, candidate)) {
    throw new Error(`Candidate ${candidate?.poiId ?? 'null'} is not sourceRow-bound in provider cache at ${sourceRow}.`);
  }
}

function applyReviewContext(record, sourceRow) {
  if (sourceRow !== 798) return;
  const existing = record.reviewContext && typeof record.reviewContext === 'object' ? record.reviewContext : {};
  const alternateCandidates = Array.isArray(existing.alternateCandidates) ? existing.alternateCandidates.filter((candidate) => candidate?.poiId !== ROW798_ALTERNATE.poiId) : [];
  record.reviewContext = {
    ...existing,
    alternateCandidates: [...alternateCandidates, ROW798_ALTERNATE],
    disallowedPoiIds: [...new Set([...(Array.isArray(existing.disallowedPoiIds) ? existing.disallowedPoiIds : []), 'B0LDYU2L4Z'])]
  };
}

function getDecisionCandidate(record, decision) {
  if (!decision?.poiId) return record.candidate;
  if (record.candidate?.poiId === decision.poiId) return record.candidate;
  const alternate = record.reviewContext?.alternateCandidates?.find((candidate) => candidate?.poiId === decision.poiId);
  if (alternate) return alternate;
  throw new Error(`No sourceRow-bound decision candidate ${decision.poiId} is available.`);
}

function cacheCandidateIsBound(sourceRow, candidate) {
  if (!candidate?.poiId) return false;
  const cache = readJson(CACHE_FILE);
  return (cache.requests ?? []).some((request) =>
    Array.isArray(request.sourceRows) && request.sourceRows.some((value) => Number(value) === Number(sourceRow)) &&
    Array.isArray(request.rawCandidates) && request.rawCandidates.some((cached) => {
      const [lng, lat] = String(cached.location ?? '').split(',').map(Number);
      return cached.id === candidate.poiId && cached.name === candidate.name && cached.address === candidate.address &&
        cached.typecode === candidate.typecode && lat === Number(candidate.providerCoordinate?.lat) && lng === Number(candidate.providerCoordinate?.lng);
    })
  );
}

function emptyReviewedCandidate() {
  return { provider: null, poiId: null, name: null, address: null, providerCrs: null, providerLat: null, providerLng: null };
}

function isIndependentEvidenceUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !PROVIDER_HOST_RE.test(parsed.hostname);
  } catch {
    return false;
  }
}

function countBy(rows, valueFn) {
  const output = {};
  for (const row of rows) {
    const value = String(valueFn(row) ?? 'unknown');
    output[value] = (output[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(output).sort());
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = process.argv.includes('--finalize')
    ? finalizeLunaPendingConsolidatedReview()
    : prepareLunaPendingConsolidatedReview();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}
