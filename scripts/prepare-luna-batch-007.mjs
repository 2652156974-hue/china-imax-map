import fs from 'node:fs';

const file = 'data/local/luna-geocode-review-323.json';
const evidence = {
  797: ['https://mjt.dushiquan.net/suzhou/station_3595/zb/7.html','https://www.aeonmall.com/ch/business/shoplist.html'],
  801: ['https://www.maigoo.com/news/665297.html','https://m.wandacinemas.com/memberrights'],
  803: ['https://www.cityhui.com/shop/20583.html','https://www.amap.com/place/B0H2RM2N5B'],
  804: ['https://m.dongfangfuli.com/cinema/detail/1476?city=177','https://creditcard.ecitic.com/h5/youhui/9yuan/jy.html'],
  807: ['https://www.cq.gov.cn/zwgk/zfxxgkzt/sydwndbg_1/2022/202406/t20240605_13268868.html','https://www.cqkjg.cn/'],
  813: ['https://kjj.gz.gov.cn/kpzl/kpjd/content/post_2666697.html','https://gdsc.cn/'],
  815: ['https://m.dongfangfuli.com/cinema/detail/3520?city=3','https://www.szns.gov.cn/attachment/1/1297/1297961/9489600.pdf'],
  816: ['https://www.bonafilm.cn/cinema_del/1024268512616083456.html','https://www.amap.com/place/B0FFLIR8NW'],
  822: ['https://map.baidu.com/mobile/webapp/search/search/qt%3Ds%26wd%3D%E4%BD%9B%E5%B1%B1%E5%B8%82%E5%8D%97%E6%B5%B7%E5%8C%BA%E7%8B%AE%E5%B1%B1%E9%95%87%E7%BD%97%E6%9D%91%E6%B2%BF%E6%B1%9F%E5%8C%97%E8%B7%AF1%E5%8F%B7%E5%AF%8C%E5%BC%98%E5%B9%BF%E5%9C%BA%E4%B8%80%E5%B1%82054%E5%8F%B7%E9%93%BA/','https://locatecinemas.com/cinemas/china/foshan/'],
  829: ['https://www.maoyan.com/cinema/15184','https://www.sohu.com/a/898718869_121123674']
};
const accepted = {
  797: ['B0FFJDSN4X','耳东影城(苏州新区永旺梦乐城店)','高新区城际路19号永旺梦乐城3层358','cinema-poi','cinema','high','high',120.532078,31.369787],
  807: ['B00178TXGC','重庆科技馆','文星门街7号','venue-poi','venue','high','medium',106.577789,29.570973],
  813: ['B00141KFJH','广东科学中心','科普路168号','venue-poi','venue','high','medium',113.362465,23.039403],
  822: ['B0FFHLHXIU','佛山中视国际影城(巨幕)(狮山店)','罗村沿江北路1号富弘广场4层F001号','cinema-poi','cinema','high','high',113.045484,23.059810]
};
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const record of data.records) {
  const row = Number(record.sourceRow); if (!evidence[row]) continue;
  const c = accepted[row];
  record.review = c ? {
    verdict: c[3] === 'venue-poi' ? 'accept-location-only' : 'accept-exact', acceptedPoiId:c[0],
    reviewedCandidate:{provider:'amap',poiId:c[0],name:c[1],address:c[2],providerCrs:'GCJ-02',providerLat:c[8],providerLng:c[7]},
    positionType:c[3],locationGranularity:c[4],locationConfidence:c[5],identityConfidence:c[6],evidenceUrls:evidence[row],
    reviewer:'Codex batch-007 cache-only review',reviewedAt:'2026-08-24T00:00:00.000Z',notes:'Cache-bound candidate matches source city/name/project; independent public evidence confirms identity/address. No new AMap request.',explicitVerdict:true,reviewSource:'explicit-row-review',validationErrors:[]
  } : {
    verdict:'needs-more-evidence',acceptedPoiId:null,reviewedCandidate:{provider:null,poiId:null,name:null,address:null,providerCrs:null,providerLat:null,providerLng:null},positionType:null,locationGranularity:null,locationConfidence:null,identityConfidence:null,evidenceUrls:evidence[row],reviewer:'Codex batch-007 cache-only review',reviewedAt:'2026-08-24T00:00:00.000Z',notes:'Independent evidence is insufficient to safely bind an exact sourceRow candidate from the existing cache; do not materialize.',explicitVerdict:true,reviewSource:'explicit-row-review',validationErrors:[]
  };
}
const tmp = `${file}.tmp-${process.pid}`; fs.writeFileSync(tmp, `${JSON.stringify(data,null,2)}\n`); fs.renameSync(tmp,file);
