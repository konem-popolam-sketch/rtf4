const fs=require("fs");
const YAML=require("C:/Users/Igor/.dsh/profiles/desktop/node_modules/yaml");
const doc=YAML.parse(fs.readFileSync("tools/patch-new.yml","utf8"));
const at=doc.find(d=>d.id==="agent-teams");
console.log("maxMembers",at.config.maxMembers);
let n=0,withModel=0,byModel={};
for(const [k,pr] of Object.entries(at.config.profiles)){
  for(const m of pr.members){ n++; if(m.model){withModel++; byModel[m.model]=(byModel[m.model]||0)+1;} }
}
console.log("members",n,"withModel",withModel,JSON.stringify(byModel));
console.log("YAML OK entries",doc.length);
