const fs=require("fs"),path=require("path");
const roots=["C:\\Users\\Igor\\.dsh\\dsh-market","C:\\Users\\Igor\\.dsh\\tongflow","C:\\Users\\Igor\\.dsh\\amadeus","C:\\Users\\Igor\\.dsh\\channel-pack","C:\\Users\\Igor\\.dsh\\our-free-model","C:\\Users\\Igor\\.dsh\\dsh-im-connect","C:\\Users\\Igor\\.dsh\\llm-deepseek","C:\\Users\\Igor\\.dsh\\skills","C:\\Users\\Igor\\.dsh\\openai-gateway"];
const needles=[Buffer.from("Агенты и зоны","utf8"),Buffer.from("агенты и зоны","utf8")];
function walk(d,depth){ let out=[]; let ents; try{ents=fs.readdirSync(d,{withFileTypes:true})}catch(e){return out}
 for(const e of ents){ if(e.name==="node_modules"||e.name===".git")continue; const p=path.join(d,e.name);
  if(e.isDirectory()){ if(depth>0) out=out.concat(walk(p,depth-1)); } else if(/\.(js|mjs|cjs|ts|tsx|jsx|json|yml|yaml|html|css|md)$/.test(e.name)) out.push(p); }
 return out; }
for(const r of roots){ if(!fs.existsSync(r)){console.log("skip",r);continue}
 for(const f of walk(r,4)){ let b; try{b=fs.readFileSync(f)}catch(e){continue}
  for(const n of needles){ const i=b.indexOf(n); if(i!==-1){ console.log("HIT",f); break } } } }
console.log("done");
