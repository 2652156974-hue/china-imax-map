import fs from 'node:fs';
const file='data/local/luna-geocode-review-323.json'; const d=JSON.parse(fs.readFileSync(file,'utf8'));
const candidates={
  807:{poiId:'B00178TXGC',name:'重庆科技馆',address:'文星门街7号',pname:'重庆市',cityname:'重庆市',adname:'两江新区',typecode:'140200',positionType:'venue-poi',locationGranularity:'venue',lat:29.570973,lng:106.577789},
  813:{poiId:'B00141KFJH',name:'广东科学中心',address:'科普路168号',pname:'广东省',cityname:'广州市',adname:'番禺区',typecode:'110000',positionType:'venue-poi',locationGranularity:'venue',lat:23.039403,lng:113.362465}
};
for(const [row,c] of Object.entries(candidates)){const r=d.records.find(x=>+x.sourceRow===+row);r.reviewContext={...(r.reviewContext??{}),alternateCandidates:[{provider:'amap',poiId:c.poiId,name:c.name,address:c.address,pname:c.pname,cityname:c.cityname,adname:c.adname,typecode:c.typecode,positionType:c.positionType,locationGranularity:c.locationGranularity,adminMatch:{compatible:true,targetProvince:c.pname.replace('省',''),targetPrefecture:c.cityname.replace('市',''),targetCounty:null,providerProvince:c.pname.replace('省',''),providerPrefecture:c.cityname.replace('市',''),providerCounty:c.adname.replace('区','')},formatCompatibility:{compatible:true,exactFormatMatch:false,conflicts:[]},providerCoordinate:{crs:'GCJ-02',lat:c.lat,lng:c.lng}}]};}
const tmp=`${file}.tmp-${process.pid}`;fs.writeFileSync(tmp,`${JSON.stringify(d,null,2)}\n`);fs.renameSync(tmp,file);
