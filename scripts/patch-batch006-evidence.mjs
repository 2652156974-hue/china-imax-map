import fs from 'node:fs';
const file='data/local/luna-geocode-review-323.json';
const d=JSON.parse(fs.readFileSync(file,'utf8'));
const urls={
  683:['https://cinema.gaoliang.me/cinema/%E6%88%90%E9%83%BD%E5%BD%B1%E7%AB%8B%E6%96%B9%E5%BD%B1%E5%9F%8E%EF%BC%88%E5%9F%8E%E5%8D%97%E4%BC%98%E5%93%81%E9%81%93%E5%B9%BF%E5%9C%BA%E5%BA%97%EF%BC%89_IMAX','https://www.sohu.com/a/937962682_498271','https://cd.bendibao.com/wangdian/dian/5868395.shtm'],
  689:['https://www.maigoo.com/news/664673.html','https://m.cd.bendibao.com/xiuxian/117867.shtm'],
  756:['https://cinema.gaoliang.me/cinema/%E8%B4%B5%E9%98%B3%E5%8D%9A%E6%82%A6%E6%B1%87%E5%BD%B1%E5%9F%8E%EF%BC%88%E5%A3%B9%E5%8F%B7%E5%BA%97%EF%BC%89_IMAX','https://www.bonafilm.cn/cinema_del/21.html'],
  766:['https://map.baidu.com/mobile/webapp/search/search/qt%3Ds%26wd%3D%E5%B9%BF%E8%A5%BF%E6%A1%82%E6%9E%97%E5%B8%82%E5%8F%A0%E5%BD%A9%E5%8C%BA%E6%BB%A8%E5%8C%97%E8%B7%AF169%E5%8F%B7%E5%8F%A0%E5%BD%A9%E4%B8%87%E8%BE%BE%E5%B9%BF%E5%9C%BA3%E6%A5%BC3067B%E5%8F%B7%E9%93%BA/','https://gongshang.mingluji.com/guangxi/navigator/%E5%8D%97%E5%AE%81%E4%B8%87%E8%BE%BE%E5%9B%BD%E9%99%85%E7%94%B5%E5%BD%B1%E5%9F%8E%E6%9C%89%E9%99%90%E5%85%AC%E5%8F%B8%E6%A1%82%E6%9E%97%E5%8F%A0%E5%BD%A9%E4%B8%87%E8%BE%BE%E5%B9%BF%E5%9C%BA%E5%BA%97'],
  774:['https://www.zgdypw.cn/sc/scxx/202106/22/t20210622_7320857.shtml','https://m.zp365.com/yl/Newhouse/Info/6490']
};
for(const r of d.records){const u=urls[Number(r.sourceRow)];if(u){r.review.evidenceUrls=u;r.review.notes='Cache-bound candidate unchanged; corrected independent public evidence attachment confirms the source cinema identity, city and project. No new AMap request.';r.review.validationErrors=[];}}
const tmp=`${file}.tmp-${process.pid}`;fs.writeFileSync(tmp,`${JSON.stringify(d,null,2)}\n`);fs.renameSync(tmp,file);
