const fs=require("fs");
const yaml=fs.readFileSync("C:\\Users\\Igor\\.dsh\\.credentials.yaml","utf8");
const m=yaml.match(/POLZA_AI_API_KEY:\s*(\S+)/);
if(!m){console.log("no key");process.exit(0)}
const key=m[1].replace(/^["']|["']$/g,"");
(async()=>{
  const r=await fetch("https://polza.ai/api/v1/models",{headers:{authorization:"Bearer "+key}});
  const t=await r.text();
  console.log("status",r.status);
  try{ const j=JSON.parse(t); const arr=j.data||j.models||j; console.log("count",Array.isArray(arr)?arr.length:"?"); console.log(JSON.stringify(Array.isArray(arr)?arr.slice(0,40).map(x=>x.id||x.name):arr).slice(0,1500)); }catch(e){ console.log(t.slice(0,400)) }
})();
