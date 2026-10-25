const fs=require("fs");
const patch=fs.readFileSync("C:\\Users\\Igor\\.dsh\\profiles\\desktop\\cordis.patch.yml","utf8").replace(/^\uFEFF/,"").split(/\r?\n/);
// locate block: from line starting "- id: agent-teams" to next line starting "- id:"
const start=patch.findIndex(l=>l.trim()==="- id: agent-teams");
let end=patch.findIndex((l,i)=>i>start&&/^- id: /.test(l));
if(end<0) end=patch.length;
const blk=patch.slice(start,end);
const gen=fs.readFileSync("tools/gen-profiles.yml","utf8").split(/\r?\n/);
const gs=gen.findIndex(l=>l.trim()==="- id: agent-teams");
const gblk=gen.slice(gs).filter(l=>l.trim()!=="");
const norm=a=>a.map(l=>l.trim()).filter(Boolean);
const A=norm(blk), B=norm(gblk);
console.log("patch lines",A.length,"gen lines",B.length);
let diffs=0;
const n=Math.max(A.length,B.length);
for(let i=0;i<n;i++){ if(A[i]!==B[i]){ diffs++; if(diffs<=12){ console.log("L"+i); console.log("  patch: "+(A[i]||"<none>").slice(0,150)); console.log("  gen  : "+(B[i]||"<none>").slice(0,150)); } } }
console.log("total diffs",diffs);
