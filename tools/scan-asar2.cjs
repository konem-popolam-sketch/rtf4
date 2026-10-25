const fs=require("fs");
const p="C:\\Users\\Igor\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar";
const buf=fs.readFileSync(p);
for(const s of ["Зоны","зоны","Зона","Зон","Teams","агент","Агент"]){
  const b=Buffer.from(s,"utf8"); let i=0,c=0;
  while((i=buf.indexOf(b,i))!==-1&&c<4){ const ctx=buf.slice(Math.max(0,i-100),i+100).toString("utf8").replace(/[^\x20-\x7E\u0400-\u04FF]/g,"."); console.log("==",JSON.stringify(s),"@"+i,":",ctx); i+=b.length;c++; }
  if(c===0)console.log("==",JSON.stringify(s),": none");
}
