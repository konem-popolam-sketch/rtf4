const fs=require("fs");
const yaml=fs.readFileSync("C:\\Users\\Igor\\.dsh\\.credentials.yaml","utf8");
const key=yaml.match(/POLZA_AI_API_KEY:\s*(\S+)/)[1].replace(/^["']|["']$/g,"");
async function probe(model){
  const t0=Date.now();
  const r=await fetch("https://polza.ai/api/v1/chat/completions",{method:"POST",headers:{authorization:"Bearer "+key,"content-type":"application/json"},
    body:JSON.stringify({model,messages:[{role:"user",content:"Reply with the single word: ok"}],max_tokens:8})});
  const t=await r.text();
  console.log(model,"->",r.status,(Date.now()-t0)+"ms",t.slice(0,220).replace(/\n/g," "));
}
(async()=>{ for(const m of ["anthropic/claude-haiku-5.5","anthropic/claude-sonnet-5.5"]) await probe(m); })();
