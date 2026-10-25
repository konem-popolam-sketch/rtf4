const fs=require("fs"),path=require("path");
const roots=["C:\\Users\\Igor\\.dsh\\profiles\\web","C:\\Users\\Igor\\.dsh\\profiles\\desktop\\.plugin-manager"];
const needles=[Buffer.from("Агенты и зоны","utf8"),Buffer.from("агенты и зоны","utf8"),Buffer.from("Зоны","utf8")];
function walk(d){ let out=[]; let ents; try{ents=fs.readdirSync(d,{withFileTypes:true})}catch(e){return out}
 for(const e of ents){ const p=path.join(d,e.name);
  if(e.isDirectory()){ if(e.name===".git")continue; out=out.concat(walk(p)); }
  else if(/\.(js|mjs|cjs|json|yml|yaml|html|css|md|ts)$/.test(e.name)) out.push(p); }
 return out; }
for(const r of roots){ if(!fs.existsSync(r)){console.log("skip",r);continue}
 const files=walk(r); console.log(r,"files:",files.length);
 let n=0;
 for(const f of files){ let b; try{b=fs.readFileSync(f)}catch(e){continue}
  for(const nd of needles){ if(b.indexOf(nd)!==-1){ console.log("HIT",f,nd.toString("utf8")); n++; break } } }
 console.log(" hits",n); }
