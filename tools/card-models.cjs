const fs=require("fs");
const CARD_DIR="C:\\Users\\Igor\\.dsh\\dsgs\\.dsh\\agents";
const files=fs.readdirSync(CARD_DIR).filter(f=>f.endsWith(".md")&&f!=="README.md");
const map={};
for(const f of files){ const s=fs.readFileSync(CARD_DIR+"\\"+f,"utf8");
  const name=(s.match(/^name:\s*(.+)$/m)||[])[1];
  const model=(s.match(/^model:\s*(.+)$/m)||[])[1];
  if(name) map[name.trim()]={model:(model||"inherit").trim()};
}
const counts={};
for(const [k,v] of Object.entries(map)) counts[v.model]=(counts[v.model]||0)+1;
console.log("cards",Object.keys(map).length,JSON.stringify(counts));
fs.writeFileSync("tools/card-models.json",JSON.stringify(map,null,1),"utf8");
console.log("sample",JSON.stringify(Object.entries(map).slice(0,3)));
