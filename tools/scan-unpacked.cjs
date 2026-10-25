const fs=require("fs"),path=require("path");
const roots=["C:\\Users\\Igor\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar.unpacked"];
const needle="Агенты и зоны";
function walk(d,depth,acc){ let e; try{e=fs.readdirSync(d,{withFileTypes:true})}catch(x){return acc}
 for(const f of e){ const p=path.join(d,f.name); if(f.isDirectory()){if(depth>0)walk(p,depth-1,acc)} else acc.push(p) } return acc }
let n=0;
for(const r of roots){ const files=walk(r,8,[]); console.log("files",files.length);
 for(const f of files){ let b; try{ if(fs.statSync(f).size>8e6) continue; b=fs.readFileSync(f) }catch(x){continue}
  if(b.indexOf(Buffer.from(needle,"utf8"))!==-1){ console.log("HIT",f); n++ } } }
console.log("hits",n);
