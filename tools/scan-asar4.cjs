const fs=require("fs");
const p="C:\\Users\\Igor\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar";
const b=fs.readFileSync(p);
console.log("size",b.length);
const targets=["Агенты и зоны","Агенты","Зоны"];
for(const t of targets){
  const u8=Buffer.from(t,"utf8"); const u16=Buffer.from(t,"utf16le");
  console.log(t,"utf8 idx",b.indexOf(u8),"utf16 idx",b.indexOf(u16));
}
