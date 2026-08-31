import fs from 'node:fs';
const file='data/local/luna-geocode-review-323.json'; const d=JSON.parse(fs.readFileSync(file,'utf8')); const rows=new Set([576,592,683,689,756,766,769,774,792,793]);
for(const r of d.records) if(rows.has(Number(r.sourceRow))) r.review.validationErrors=[];
const tmp=`${file}.tmp-${process.pid}`;fs.writeFileSync(tmp,`${JSON.stringify(d,null,2)}\n`);fs.renameSync(tmp,file);
