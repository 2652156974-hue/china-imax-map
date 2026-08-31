import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const target = path.join(root, 'data/local/luna-geocode-review-323.json');
const baselinePath = path.join(root, 'data/local/luna-geocode-review-323.completed.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
if (!Array.isArray(baseline.records) || baseline.records.length !== 323) {
  throw new Error('baseline must contain exactly 323 records');
}

const accepted = new Map([
  [292, { poiId: 'B001787U3O', evidenceUrls: [
    'https://www.cityhui.com/shop/20580.html',
    'https://m.maigoo.com/news/663911.html',
    'https://pic.bankofchina.com/bocappd/appform_1/201509/P020150924529221572419.pdf'
  ], notes: '城市惠、买购与万达院线名录均将重庆南坪万达影城绑定到江南大道8号南坪万达广场3层；与 sourceRow 项目一致，竞争候选不是该万达影城。' }],
  [312, { poiId: 'B0FFLK56IB', evidenceUrls: [
    'https://m.dongfangfuli.com/cinema/detail/13527?city=222',
    'https://m.wangpiao.com/wptouch/Cinema/List?filmid=31222',
    'https://www.goupiaotong.cn/mobile/Theater/1420.shtml'
  ], notes: '东方福利、网票与购票通均将速铂影城路劲 IMAX 店绑定到北京路劲世界广场；与 sourceRow 项目及地址一致。' }],
  [313, { poiId: 'B0H3SHKHP2', evidenceUrls: [
    'https://cinema.gaoliang.me/cinema/%E5%8C%97%E4%BA%AC%E6%B2%83%E7%BE%8E%E5%BD%B1%E5%9F%8E%EF%BC%88%E7%86%99%E6%82%A6%E5%A4%A9%E8%A1%97IMAX%E5%BA%97%EF%BC%89_IMAX',
    'https://www.maigoo.com/news/686184.html'
  ], notes: '高亮影院目录和买购均将北京沃美影城熙悦天街 IMAX 店绑定到长阳镇长于大街28号北京房山熙悦天街5层；与 sourceRow 项目一致。' }],
  [344, { poiId: 'B019D0OWK4', evidenceUrls: [
    'https://www.poilist.cn/poi-list-%E4%BC%91%E9%97%B2%E5%A8%B1%E4%B9%90-%E6%8A%9A%E9%A1%BA/60/',
    'https://www.c-jdb.com/article/657/1681.html',
    'https://pic.bankofchina.com/bocappd/appform_1/201412/P020141231511419593148.pdf'
  ], notes: '独立目录、地方信息与万达院线名录均将抚顺万达影城绑定到浑河南路中段56号万达广场4层；竞争候选为另一家抚顺分店。' }],
  [346, { poiId: 'B0FFHUNUIZ', evidenceUrls: [
    'https://cinema.gaoliang.me/cinema/%E8%90%A5%E5%8F%A3%E4%B8%87%E8%BE%BE%E5%BD%B1%E5%9F%8E%EF%BC%88%E4%B8%87%E8%BE%BE%E5%B9%BF%E5%9C%BA%E5%BA%97%EF%BC%89_IMAX',
    'https://www.chahaoba.com/0417-6630888',
    'https://yshjjs.yingkou.gov.cn/002/002001/20230621/aea756bb-74d9-4bf8-aeda-c23bae13a569.html'
  ], notes: '独立影院目录、电话目录与营口市公开许可信息均将源店绑定到市府南路1号万达广场4层；竞争候选是鲅鱼圈另一家门店。' }],
  [360, { poiId: 'B0J2OZG6M6', evidenceUrls: [
    'https://cinema.gaoliang.me/cinema/%E6%98%86%E6%98%8E%E7%BB%B4%E6%96%AF%E5%BD%B1%E5%9F%8E%EF%BC%88%E6%B5%B7%E4%B9%90%E5%9F%8EIMAX%E5%BA%97%EF%BC%89_IMAX',
    'https://locatecinemas.com/cinemas/china/kunming/',
    'https://jt.dushiquan.net/kunming/station_2040/zb/7.html'
  ], notes: '独立影院目录与昆明影院目录均将维斯影城海乐城 IMAX 店绑定到金源大道3188号附近海乐城5楼；与源记录现名及旧名一致。' }],
  [380, { poiId: 'B0KRFSJADF', evidenceUrls: [
    'https://sw.wuhan.gov.cn/xwdt/gzdt/202407/t20240718_2429891.shtml',
    'https://news.hubeidaily.net/pc/c_2888776.html',
    'https://cinema.gaoliang.me/cinema/%E6%AD%A6%E6%B1%89%E4%B8%87%E8%BE%BE%E5%BD%B1%E5%9F%8E%EF%BC%88%E6%B1%89%E8%A1%97%E4%B8%87%E8%BE%BE%E5%B9%BF%E5%9C%BAIMAX%E6%BF%80%E5%85%89%E5%BA%97%EF%BC%89_IMAX'
  ], notes: '武汉市商务公开信息、湖北日报与独立影院目录均将汉街万达激光 IMAX 店绑定到烟霞路1号汉街万达5层；与 sourceRow 项目一致。' }],
  [393, { poiId: 'B0FFJ8AB61', evidenceUrls: [
    'https://www.maigoo.com/citiao/1084717.html',
    'https://map.baidu.com/mobile/webapp/search/search/qt%3Dbse%26wd%3D%E9%BB%84%E5%86%88%E5%B8%82%E9%BB%84%E5%B7%9E%E5%8C%BA%E8%B5%A4%E5%A3%81%E5%A4%A7%E9%81%9389%E5%8F%B7%E9%BB%84%E5%86%88%E4%B8%87%E8%BE%BE%E5%B9%BF%E5%9C%BA/'
  ], notes: '买购条目与百度公开地图均将黄冈万达影城绑定到赤壁大道89号黄冈万达广场4层；竞争候选为武穴分店。' }],
  [394, { poiId: 'B0MBP721WU', evidenceUrls: [
    'https://www.hbfilm.com.cn/News/2026050410392514593795',
    'https://www.wushang.com.cn/view/6262.html',
    'https://www.sina.cn/news/detail/5295941290820587.html'
  ], notes: '湖北长江电影集团与武商集团均将武穴首家银兴 IMAX 激光店绑定到武商购物中心4层；排除梅川广济新天地竞争分店。' }]
]);

const unresolved = new Map([
  [326, {
    evidenceUrls: [
      'https://locatecinemas.com/cinemas/china/beijing/',
      'https://www.maoyan.com/cinemas?brandId=316970&districtId=14&districtid=2180'
    ],
    notes: '独立检索未找到 UME 融科 IMAX 店与融科天地 mall POI 的明确影院绑定；当前仅有 mall fallback B0FFIIYL1J，暂不接受或物化。'
  }]
]);

const acceptedBatch004 = new Map([
  [403, { verdict: 'accept-exact', poiId: 'B0HA1CF6T8', locationConfidence: 'high', identityConfidence: 'high', evidenceUrls: [
    'https://www.bonafilm.cn/cinema_del/40.html',
    'https://jt.dushiquan.net/changsha/station_5851/zb/7.html'
  ], notes: '博纳影业官方页面将长沙洋湖天街 IMAX 店绑定到先导路69号龙湖洋湖天街 A1-4F-Z02；独立影院目录也指向洋湖天街，排除缓存中的芙蓉天街竞争门店。' }],
  [413, { verdict: 'accept-location-only', poiId: 'B02DC0NCJA', positionType: 'mall-fallback', locationGranularity: 'mall', locationConfidence: 'medium', identityConfidence: 'medium', evidenceUrls: [
    'https://www.hengdianfilm.com/index_9.aspx',
    'https://www.xn--fiqz7gusflrkf7du68ay1o.com/UploadFiles/file/20220119/202201190201551667.pdf'
  ], notes: '横店影视官方门店页将湘潭横店电影城定位在建设路口步步高广场8楼，中国电影报也列出湘潭横店 IMAX 电影城步步高店；缓存候选是该商场 POI 而非影院 POI，故只接受 mall location。' }],
  [426, { verdict: 'accept-exact', poiId: 'B0FFI7OIAQ', locationConfidence: 'high', identityConfidence: 'high', evidenceUrls: [
    'https://www.maigoo.com/news/686387.html',
    'https://www.sohu.com/a/190810680_750780',
    'https://cinema.gaoliang.me/cinema/%E9%95%BF%E6%98%A5%E6%98%9F%E8%BD%B6IMAX%E5%BD%B1%E5%9F%8E%EF%BC%88%E7%BB%BF%E5%9B%AD%E5%90%BE%E6%82%A6%E5%B9%BF%E5%9C%BA%E6%97%97%E8%88%B0%E5%BA%97%EF%BC%89_IMAX'
  ], notes: '独立影院目录、长春吾悦广场历史公开内容与影院名单均将星轶 IMAX 绿园吾悦旗舰店绑定到皓月大路1888号新城吾悦广场4层；与缓存候选一致。' }],
  [440, { verdict: 'accept-exact', poiId: 'B0FFIPF9Y4', locationConfidence: 'high', identityConfidence: 'high', evidenceUrls: [
    'https://m.wandacinemas.com/memberrights',
    'https://shangwuju.tj.gov.cn/tjsswjzz/swjzz/gabsycs/gsgggh/202412/P020241211490602879464.pdf'
  ], notes: '万达官方门店清单列出西青社会山店；天津市商务局公开名录将社会山广场定位在张家窝镇知景道321号。缓存候选名称与楼栋地址均一致，且未见同城竞争影院 POI。' }],
  [449, { verdict: 'accept-exact', poiId: 'B013C14AKX', locationConfidence: 'high', identityConfidence: 'high', evidenceUrls: [
    'https://pic.bankofchina.com/bocappd/appform_1/201412/P020141231511419593148.pdf',
    'https://www.xn--fiqz7gusflrkf7du68ay1o.com/UploadFiles/file/20200123/202001230901196276.pdf'
  ], notes: '万达院线公开影城名录将廊坊店绑定到廊坊市广阳区新华路50号万达广场四层；中国电影报另列廊坊市广阳区万达影城新华路店，排除安次万达竞争门店。' }],
  [464, { verdict: 'accept-location-only', poiId: 'B0FFH1LFNB', positionType: 'venue-poi', locationGranularity: 'venue', locationConfidence: 'high', identityConfidence: 'medium', evidenceUrls: [
    'https://www.sdxc.gov.cn/sy/xcdt/202301/t20230111_11277263.htm',
    'https://www.thepaper.cn/newsDetail_forward_21523367',
    'https://edu.cri.cn/20240923/774e2288-93da-9363-ac81-41ae1f5162e6.html'
  ], notes: '公开报道将山东省科技馆新馆定位到济南市日照路2286号，并确认馆内巨幕影院使用 IMAX GT 激光4K；缓存候选是科技馆 venue POI，不冒充独立商业影院，故只接受 venue location。' }],
  [474, { verdict: 'accept-exact', poiId: 'B0FFFBYJ4X', locationConfidence: 'high', identityConfidence: 'high', evidenceUrls: [
    'https://pic.bankofchina.com/bocappd/appform_1/201412/P020141231511419593148.pdf',
    'https://www.maigoo.com/top/436751.html'
  ], notes: '万达院线公开影城名录和独立影院信息均将潍坊万达影城绑定到奎文区鸢飞路958号万达广场4层；缓存中的寿光万达是另一县级市门店，予以排除。' }],
  [491, { verdict: 'accept-exact', poiId: 'B0FFK10X8P', locationConfidence: 'high', identityConfidence: 'high', evidenceUrls: [
    'https://wh.zibo.gov.cn/gongkai/channel_c_5f9fa491ab327f36e4c13060_n_1605682600.8442/doc_632179c2410e00ccde4ee896.html',
    'https://m.dongfangfuli.com/cinema/detail/10000?city=171'
  ], notes: '淄博市文化和旅游局影院信息表将齐纳国际影城淄博银座店绑定到张店区柳泉路128号银座商城7楼；独立购票页也指向该店，排除淄川竞争门店。' }]
]);

const unresolvedBatch004 = new Map([
  [486, {
    evidenceUrls: [
      'https://www.maigoo.com/citiao/1065989.html',
      'https://www.maigoo.com/news/683643.html'
    ],
    notes: '独立资料将薛城万达广场及万达影城定位到永兴路126号，但源行只写“枣庄”且缓存还存在同地级市滕州万达竞争分店；严格 sourceRow 行政粒度 validator 无法证明源行就是薛城分店，故保持 needs-more-evidence，不物化。'
  }],
  [478, {
    evidenceUrls: [
      'https://cinema.gaoliang.me/cinema/%E7%83%9F%E5%8F%B0%E5%B9%B8%E7%A6%8F%E8%93%9D%E6%B5%B7%E5%9B%BD%E9%99%85%E5%BD%B1%E5%9F%8E%EF%BC%88IMAX%E5%BA%97%EF%BC%89_IMAX',
      'https://www.cls.cn/detail/xk/67f5d37573c21c26d8fe64a7',
      'https://www.maigoo.com/citiao/1049563.html'
    ],
    notes: '独立影院页面、幸福蓝海公开门店表与烟台影院资料均将源店绑定到芝罘区北马路150号大悦城4层；缓存当前候选是福山区衡山路33号嘉禾乐天店，属于同品牌另一门店，缓存中没有大悦城精确 POI，故保持 branch-mismatch/needs-more-evidence，不物化。'
  }]
]);

const records = structuredClone(baseline.records);
const bySourceRow = new Map(records.map((record) => [record.sourceRow, record]));
const batchRows = [...accepted.keys(), ...unresolved.keys(), ...acceptedBatch004.keys(), ...unresolvedBatch004.keys()].sort((a, b) => a - b);
if (batchRows.join(',') !== '292,312,313,326,344,346,360,380,393,394,403,413,426,440,449,464,474,478,486,491') {
  throw new Error(`unexpected batch rows: ${batchRows.join(',')}`);
}

for (const [sourceRow, decision] of accepted) {
  const record = bySourceRow.get(sourceRow);
  if (!record?.candidate || record.candidate.poiId !== decision.poiId) {
    throw new Error(`candidate context mismatch at sourceRow ${sourceRow}: expected ${decision.poiId}, got ${record?.candidate?.poiId ?? 'none'}`);
  }
  const candidate = record.candidate;
  const coordinate = candidate.providerCoordinate;
  if (coordinate?.crs !== 'GCJ-02' || !Number.isFinite(coordinate.lat) || !Number.isFinite(coordinate.lng)) {
    throw new Error(`invalid cached GCJ-02 coordinate at sourceRow ${sourceRow}`);
  }
  record.review = {
    verdict: 'accept-exact',
    acceptedPoiId: candidate.poiId,
    reviewedCandidate: {
      provider: 'amap',
      poiId: candidate.poiId,
      name: candidate.name,
      address: candidate.address,
      providerCrs: coordinate.crs,
      providerLat: coordinate.lat,
      providerLng: coordinate.lng
    },
    positionType: candidate.positionType,
    locationGranularity: candidate.locationGranularity,
    locationConfidence: 'high',
    identityConfidence: 'high',
    evidenceUrls: decision.evidenceUrls,
    reviewer: 'Codex batch-003 manual evidence',
    reviewedAt: '2026-08-21T13:00:00.000Z',
    notes: decision.notes,
    explicitVerdict: true,
    reviewSource: 'explicit-row-review',
    validationErrors: []
  };
}

for (const [sourceRow, decision] of unresolved) {
  const record = bySourceRow.get(sourceRow);
  if (!record) throw new Error(`missing sourceRow ${sourceRow}`);
  record.review = {
    verdict: 'needs-more-evidence',
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
    evidenceUrls: decision.evidenceUrls,
    reviewer: 'Codex batch-003 manual evidence',
    reviewedAt: '2026-08-21T13:00:00.000Z',
    notes: decision.notes,
    explicitVerdict: true,
    reviewSource: 'explicit-row-review',
    validationErrors: []
  };
}

for (const [sourceRow, decision] of acceptedBatch004) {
  const record = bySourceRow.get(sourceRow);
  if (!record?.candidate || record.candidate.poiId !== decision.poiId) {
    throw new Error(`candidate context mismatch at sourceRow ${sourceRow}: expected ${decision.poiId}, got ${record?.candidate?.poiId ?? 'none'}`);
  }
  const candidate = record.candidate;
  const coordinate = candidate.providerCoordinate;
  if (coordinate?.crs !== 'GCJ-02' || !Number.isFinite(coordinate.lat) || !Number.isFinite(coordinate.lng)) {
    throw new Error(`invalid cached GCJ-02 coordinate at sourceRow ${sourceRow}`);
  }
  record.review = {
    verdict: decision.verdict,
    acceptedPoiId: candidate.poiId,
    reviewedCandidate: {
      provider: 'amap',
      poiId: candidate.poiId,
      name: candidate.name,
      address: candidate.address,
      providerCrs: coordinate.crs,
      providerLat: coordinate.lat,
      providerLng: coordinate.lng
    },
    positionType: decision.positionType ?? candidate.positionType,
    locationGranularity: decision.locationGranularity ?? candidate.locationGranularity,
    locationConfidence: decision.locationConfidence,
    identityConfidence: decision.identityConfidence,
    evidenceUrls: decision.evidenceUrls,
    reviewer: 'Codex batch-004 manual evidence',
    reviewedAt: '2026-08-21T14:00:00.000Z',
    notes: decision.notes,
    explicitVerdict: true,
    reviewSource: 'explicit-row-review',
    validationErrors: []
  };
}

for (const [sourceRow, decision] of unresolvedBatch004) {
  const record = bySourceRow.get(sourceRow);
  if (!record) throw new Error(`missing sourceRow ${sourceRow}`);
  record.review = {
    verdict: 'needs-more-evidence',
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
    evidenceUrls: decision.evidenceUrls,
    reviewer: 'Codex batch-004 manual evidence',
    reviewedAt: '2026-08-21T14:00:00.000Z',
    notes: decision.notes,
    explicitVerdict: true,
    reviewSource: 'explicit-row-review',
    validationErrors: []
  };
}

const output = { ...baseline, records };
output.generatedAt = '2026-08-21T14:00:00.000Z';
output.status = 'review-input-rebuilt-batch-004';
const serialized = `${JSON.stringify(output, null, 2)}\n`;
JSON.parse(serialized);

const temporary = `${target}.batch-004-rebuild-${process.pid}.tmp`;
const backup = `${target}.invalid-recovery-${process.pid}.bak`;
fs.writeFileSync(temporary, serialized, 'utf8');
try {
  fs.renameSync(target, backup);
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.renameSync(backup, target);
    throw error;
  }
} finally {
  if (fs.existsSync(temporary)) fs.rmSync(temporary);
}
console.log(JSON.stringify({ rebuiltRows: batchRows, target, backup, records: records.length }, null, 2));
