const fs=require("fs"),path=require("path");
const flat="зон";
function walk(d,depth,acc){ let ents; try{ents=fs.readdirSync(d,{withFileTypes:true})}catch(e){return acc}
 for(const e of ents){ const p=path.join(d,e.name);
  if(e.isDirectory()){ if(depth>0 && e.name!==".git" && e.name!=="node_modules") walk(p,depth-1,acc); }
  else if(/\.(js|mjs|cjs|json|yml|yaml|html|css|md|ts|tsx|txt|ps1)$/.test(e.name)) acc.push(p); }
 return acc; }
const files=walk("C:\\Users\\Igor\\.dsh",12,[]);
console.log("files",files.length);
let n=0;
for(const f of files){ let b; try{b=fs.readFileSync(f)}catch(e){continue}
 for(const enc of ["utf8","utf16le"]){ let s; try{s=b.toString(enc)}catch(e){continue}
  const i=s.indexOf("Зоны"); const j=s.indexOf("зон");
  if(i!==-1||(j!==-1&&s.slice(j,j+20).match(/зон[аыуе]? /))){ console.log("HIT",enc,f,JSON.stringify(s.slice(Math.max(0,j-60),j+60))); n++; break } } }
console.log("hits",n);
