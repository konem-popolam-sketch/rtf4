const fs=require("fs");
const yaml=fs.readFileSync("C:\\Users\\Igor\\.dsh\\.credentials.yaml","utf8");
const key=yaml.match(/POLZA_AI_API_KEY:\s*(\S+)/)[1].replace(/^["']|["']$/g,"");
(async()=>{
  const r=await fetch("https://polza.ai/api/v1/models",{headers:{authorization:"Bearer "+key}});
  const j=await r.json();
  const arr=j.data||j.models||j;
  const want=["anthropic/claude-sonnet-5.5","anthropic/claude-opus-5.5","deepseek/deepseek-v4.1-flash-1017"];
  for(const w of want){
    const m=arr.find(x=>(x.id||x.name)===w);
    console.log(w, m? JSON.stringify({ctx:m.context_length||m.contextWindow||m.context_window,max:m.max_tokens||m.maxTokens||m.max_output_tokens,name:m.name}) : "NOT FOUND");
  }
})();
