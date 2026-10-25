const fs=require("fs");
const P="C:\\Users\\Igor\\.dsh\\profiles\\desktop\\cordis.patch.yml";
const cards=JSON.parse(fs.readFileSync("tools/card-models.json","utf8"));
const MAP={sonnet:"anthropic/claude-sonnet-5.5",opus:"anthropic/claude-opus-5.5"};
const lines=fs.readFileSync(P,"utf8").replace(/^\uFEFF/,"").split(/\r?\n/);
const start=lines.findIndex(l=>l.trim()==="- id: agent-teams");
let end=lines.findIndex((l,i)=>i>start&&/^- id: /.test(l)); if(end<0) end=lines.length;
const before=lines.slice(0,start), block=lines.slice(start,end), after=lines.slice(end);
const out=[]; let added=0, seen=0;
for(let i=0;i<block.length;i++){
  const m=block[i].match(/^(\s+)- name:\s*(\S+)\s*$/);
  if(!m){ out.push(block[i]); continue; }
  seen++;
  out.push(block[i]);
  // копируем поля члена до следующего члена
  let j=i+1;
  while(j<block.length && !/^\s+- name:/.test(block[j])){ out.push(block[j]); j++; }
  const model=MAP[(cards[m[2]]||{}).model];
  if(model){
    const tp=out.findIndex((l,k)=>k>=out.length-(j-i)&&/^\s+tool_policy:/.test(l));
    if(tp>=0){ const ind=out[tp].match(/^(\s+)/)[1]; out.splice(tp+1,0, ind+"model: "+model); added++; }
  }
  i=j-1;
}
fs.writeFileSync("tools/patch-new.yml", before.concat(out, after).join("\n"), "utf8");
console.log("members",seen,"added",added);
