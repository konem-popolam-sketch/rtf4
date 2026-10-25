const fs=require("fs");
const patch=fs.readFileSync("C:\\Users\\Igor\\.dsh\\profiles\\desktop\\cordis.patch.yml","utf8").replace(/^\uFEFF/,"").split(/\r?\n/);
const start=patch.findIndex(l=>l.trim()==="- id: agent-teams");
let end=patch.findIndex((l,i)=>i>start&&/^- id: /.test(l));
const blk=patch.slice(start,end===-1?patch.length:end);
console.log("start line",start+1,"end line",end+1,"len",blk.length);
const gen=fs.readFileSync("tools/gen-profiles.yml","utf8").split(/\r?\n/);
console.log("gen len",gen.length);
// count profiles and members in both
const count=(arr)=>{const p=[...arr.join("\n").matchAll(/^      (dsgs-[a-z-]+):/gm)].map(m=>m[1]); const mem=[...arr.join("\n").matchAll(/^          - name: /gm)].length; return {p,mem};};
console.log("patch",JSON.stringify(count(blk)));
console.log("gen  ",JSON.stringify(count(gen)));
console.log("--- patch line 1..40 ---");
blk.slice(0,40).forEach((l,i)=>console.log(i+1+": "+l.slice(0,120)));
