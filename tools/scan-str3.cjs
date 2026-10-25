const fs=require("fs"),path=require("path");
const roots=["C:\\Users\\Igor\\.dsh\\profiles\\desktop\\node_modules"];
const needles=[Buffer.from("Агенты и зоны","utf8"),Buffer.from("агенты и зоны","utf8")];
function walk(d,depth){ let out=[]; let ents; try{ents=fs.readdirSync(d,{withFileTypes:true})}catch(e){return out}
 for(const e of ents){ const p=path.join(d,e.name);
  if(e.isDirectory()){ if(depth>0) out=out.concat(walk(p,depth-1)); }
  else if(/\.(js|mjs|cjs|json|yml|yaml|html|css)$/.test(e.name)) out.push(p); }
 return out; }
for(const r of roots){ const files=walk(r,6); console.log("files",files.length);
 for(const f of files){ let b; try{b=fs.readFileSync(f)}catch(e){continue}
  if(needles.some(n=>b.indexOf(n)!==-1)) console.log("HIT",f); } }
console.log("done");
