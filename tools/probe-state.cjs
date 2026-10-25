const http=require("http");
http.get("http://127.0.0.1:63625/plugins/dsgs-agent-roster/state",res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>{console.log("status",res.statusCode);console.log(d.slice(0,900));});}).on("error",e=>console.log("ERR",e.message));
