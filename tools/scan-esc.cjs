const fs=require("fs"),path=require("path");
const needle="\\u0437\\u043e\\u043d\\u044b"; // зоны escaped
const needle2="\\u0417\\u043e\\u043d\\u044b";
const flat="Зоны";
const roots=["C:\\Users\\Igor\\.dsh","C:\\Users\\Igor\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar"];
function walk(d,depth,acc){ let ents; try{ents=fs.readdirSync(d,{withFileTypes:true})}catch(e){return acc}
 for(const e of ents){ const p=path.join(d,e.name);
  if(e.isDirectory()){ if(depth>0 && e.name!==".git") walk(p,depth-1,acc); }
  else if(/\.(js|mjs|cjs|json|yml|yaml|html|css|md|ts|tsx|txt)$/.test(e.name)) acc.push(p); }
 return acc; }
for(const r of roots){ let files;
 if(r.endsWith(".asar")) files=[r]; else files=walk(r,12,[]);
 console.log("scan",r,files.length);
 for(const f of files){ let b; try{b=fs.readFileSync(f)}catch(e){continue}
  const s=b.toString("utf8");
  if(s.includes(needle)||s.includes(needle2)||s.includes(flat)) console.log("HIT",f); } }
console.log("done");
