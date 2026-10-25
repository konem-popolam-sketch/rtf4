const fs=require("fs");
const p="C:\\Users\\Igor\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar";
const buf=fs.readFileSync(p);
const pats=["Участники","Состав команды","Задачи","Команда","Зоны взаимодействия","агенты"];
for(const s of pats){ const b=Buffer.from(s,"utf8"); let i=0,c=0;
 while((i=buf.indexOf(b,i))!==-1&&c<3){ const ctx=buf.slice(Math.max(0,i-80),i+80).toString("utf8").replace(/[^\x20-\x7E\u0400-\u04FF]/g,"."); console.log("==",s,":",ctx); i+=b.length;c++; }
 if(c===0)console.log("==",s,": none"); }
