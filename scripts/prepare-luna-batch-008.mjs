import fs from 'node:fs';

const file = 'data/local/luna-geocode-review-323.json';
const evidence = {
  832: ['https://www.maigoo.com/news/665297.html','https://www.amap.com/place/B02DB0UDSS'],
  836: ['https://www.cityhui.com/shop/21715.html','https://www.maigoo.com/citiao/987466.html'],
  837: ['https://maps.apple.com/place?_provider=57879&place-id=H2710I3F926888BD8B7','https://m.dongfangfuli.com/cinema/detail/2819?city=178'],
  852: ['https://www.sriff.cn/wap_en/news_info.php?infoid=3113','https://tsjy.ygu.edu.cn/info/1054/3329.htm','https://www.imax.com/theatre/fuzhou-strait-culture-art-center-jinyi-imax','https://hxdsb.fjdaily.com/pc/con/202504/01/content_440977.html'],
  864: ['https://www.sstm.org.cn/index','https://group.sstm.org.cn/know/about/article/3'],
  868: ['https://www.hsmz.com/introduce/show-9.html','https://h5.imanm.com/moviev3/cinamermoviedetails/19705/214089'],
  869: ['https://www.wandacinemas.com/','https://www.amap.com/place/B0FFHLHYLT'],
  872: ['https://www.njstm.org.cn/','https://www.njstm.org.cn/html/zxdt/tzgg/4835.html'],
  885: ['https://www.amap.com/place/B0FFH0CZGQ','https://www.maoyan.com/']
};
const accepted = {
  836: ['B0FFFN88CP','德纳国际影城(杭州萧山银隆百货店)','银隆百货B座5楼','cinema-poi','cinema','high','high',120.268521,30.170715],
  837: ['B0FFJN0QEV','金逸影视中心(IMAX店)','东新路655号西联广场DP-LIVE中心F4层','cinema-poi','cinema','high','high',120.172466,30.316346],
  852: ['B0GK1O2RE6','海艺影城IMAX(福州海峡文化艺术中心店)','城门镇海峡文化艺术中心2号门海艺影城','cinema-poi','cinema','high','high',119.419520,25.995359],
  864: ['B00150C4B6','上海科技馆','世纪大道2000号','venue-poi','venue','high','medium',121.541358,31.218114],
  868: ['B0FFGYQKHI','AMG海上明珠影城(上海大宁音乐广场IMAX店)','万荣路777号大宁音乐广场A栋','cinema-poi','cinema','high','high',121.444139,31.280342],
  872: ['B0019097N2','南京科技馆','紫荆花路9号','venue-poi','venue','high','medium',118.783786,31.986056]
};
const contextAlternates = {
  864: {
    provider:'amap', poiId:'B00150C4B6', name:'上海科技馆', address:'世纪大道2000号',
    pname:'上海市', cityname:'上海市', adname:'浦东新区', typecode:'140600',
    positionType:'venue-poi', locationGranularity:'venue',
    adminMatch:{compatible:true,targetProvince:'上海',targetPrefecture:'上海',targetCounty:null,providerProvince:'上海',providerPrefecture:'上海',providerCounty:'浦东'},
    formatCompatibility:{compatible:true,exactFormatMatch:false,conflicts:[]},
    providerCoordinate:{crs:'GCJ-02',lat:31.218114,lng:121.541358}
  }
};
const reviewNotes = {
  852: 'Cache-bound candidate matches the source city/project. Current 海艺影城IMAX identity is independently supported by SRiff and YGU evidence for the 海峡文化艺术中心影视中心; the older JinYi closure material is retained only as historical tenant/name-transition context. No new AMap request.'
};
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const record of data.records) {
  const row = Number(record.sourceRow); if (!evidence[row]) continue;
  const c = accepted[row];
  record.review = c ? { verdict:c[3] === 'venue-poi' ? 'accept-location-only' : 'accept-exact',acceptedPoiId:c[0],reviewedCandidate:{provider:'amap',poiId:c[0],name:c[1],address:c[2],providerCrs:'GCJ-02',providerLat:c[8],providerLng:c[7]},positionType:c[3],locationGranularity:c[4],locationConfidence:c[5],identityConfidence:c[6],evidenceUrls:evidence[row],reviewer:'Codex batch-008 cache-only review',reviewedAt:'2026-08-24T00:00:00.000Z',notes:reviewNotes[row] ?? 'Cache-bound candidate matches source city/name/project; independent public evidence confirms identity/address. No new AMap request.',explicitVerdict:true,reviewSource:'explicit-row-review',validationErrors:[]} : {verdict:'needs-more-evidence',acceptedPoiId:null,reviewedCandidate:{provider:null,poiId:null,name:null,address:null,providerCrs:null,providerLat:null,providerLng:null},positionType:null,locationGranularity:null,locationConfidence:null,identityConfidence:null,evidenceUrls:evidence[row],reviewer:'Codex batch-008 cache-only review',reviewedAt:'2026-08-24T00:00:00.000Z',notes:'Existing cache has no source-bound exact cinema candidate sufficient for safe acceptance; do not materialize.',explicitVerdict:true,reviewSource:'explicit-row-review',validationErrors:[]};
  if (contextAlternates[row]) record.reviewContext = { ...(record.reviewContext ?? {}), alternateCandidates:[contextAlternates[row]] };
}
const tmp = `${file}.tmp-${process.pid}`; fs.writeFileSync(tmp, `${JSON.stringify(data,null,2)}\n`); fs.renameSync(tmp,file);
