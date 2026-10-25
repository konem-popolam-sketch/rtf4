const fs=require("fs");
const B="C:\\Users\\Igor\\OneDrive\\Desktop\\claude god\\docs\\studio-board\\";
const roster=JSON.parse(fs.readFileSync(B+"roster.json","utf8").replace(/^\uFEFF/,""));
const st=JSON.parse(fs.readFileSync(B+"state.json","utf8").replace(/^\uFEFF/,""));
const style=st._style||roster.defaultStyle;
console.log("defaultStyle",roster.defaultStyle,"active",style);
console.log("agents",Object.keys(roster.agents).length);
const rows=Object.entries(roster.agents).map(([id,a])=>{
  const f=a.faces?.[style]||{};
  return {id,name:f.name||"?",fn:a.function||""};
});
console.log(JSON.stringify(rows,null,0).slice(0,3000));
