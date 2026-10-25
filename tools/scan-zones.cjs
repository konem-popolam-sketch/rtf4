const fs=require("fs"),path=require("path");
const roots=["C:\\Users\\Igor\\Desktop","C:\\Users\\Igor\\OneDrive\\Desktop","C:\\Users\\Igor\\Documents","C:\\Users\\Igor\\Downloads"];
const exts=/\.(html|js|mjs|cjs|json|yml|yaml|md|css|vue|jsx|tsx|ts|txt)$/;
function walk(d,depth,acc){ let ents; try{ents=fs.readdirSync(d,{withFileTypes:true})}catch(e){return acc}
  for(const e of ents){ if(e.name==="node_modules"||e.name===".git") continue; const p=path.join(d,e.name);
    if(e.isDirectory()){ if(depth>0) walk(p,depth-1,acc); } else if(exts.test(e.name)) acc.push(p); }
  return acc; }
let hits=0;
for(const r of roots){ const files=walk(r,4,[]);
  for(const f of files){ let b; try{ if(fs.statSync(f).size>3e6) continue; b=fs.readFileSync(f)}catch(e){continue}
    const s=b.toString("utf8");
    if(s.includes("Агенты и зоны")||s.includes("Зоны и агенты")){ console.log("HIT",f); if(++hits>15) process.exit(0);} } }
console.log("done hits="+hits);
