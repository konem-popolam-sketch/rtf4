const fs=require("fs");
const yaml=fs.readFileSync("C:\\Users\\Igor\\.dsh\\.credentials.yaml","utf8");
const key=yaml.match(/POLZA_AI_API_KEY:\s*(\S+)/)[1].replace(/^["']|["']$/g,"");
(async()=>{
  for(const m of ["anthropic/claude-opus-5.5"]){
    const r=await fetch("https://polza.ai/api/v1/chat/completions",{method:"POST",headers:{authorization:"Bearer "+key,"content-type":"application/json"},
      body:JSON.stringify({model:m,messages:[{role:"user",content:"Say: ok"}],max_tokens:8})});
    console.log(m,r.status,(await r.text()).slice(0,160));
  }
})();
