const fs=require("fs");
const p="C:\\Users\\Igor\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar";
const buf=fs.readFileSync(p);
const pats=["Агенты и зоны","агенты и зоны","Agents and zones","агент","зон."];
for(const s of pats){
  const b=Buffer.from(s,"utf8");
  let i=0,c=0;
  while((i=buf.indexOf(b,i))!==-1 && c<3){
    const ctx=buf.slice(Math.max(0,i-120),i+120).toString("utf8").replace(/[^\x20-\x7E\u0400-\u04FF]/g,".");
    console.log("PAT",JSON.stringify(s),"@"+i,":",ctx);
    i+=b.length;c++;
  }
  if(c===0)console.log("PAT",JSON.stringify(s),": not found");
}
