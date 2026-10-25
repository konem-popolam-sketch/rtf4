const fs=require("fs");
const YAML=require("C:/Users/Igor/.dsh/profiles/desktop/node_modules/yaml");
const p="C:\\Users\\Igor\\.dsh\\profiles\\desktop\\cordis.patch.yml";
const doc=YAML.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const at=doc.find(d=>d.id==="agent-teams");
console.log("entries",doc.length,"agent-teams found",!!at);
console.log("maxMembers",at.config.maxMembers,"memberMaxDepth",at.config.memberMaxDepth);
const profs=Object.keys(at.config.profiles);
console.log("profiles",profs.length,profs.join(","));
for(const k of profs){
  const pr=at.config.profiles[k];
  const bad=pr.members.filter(m=>!m.name||!m.role||!m.tool_policy);
  console.log(k,"members",pr.members.length,"bad",bad.length,"planning",pr.taskPlanning);
}
console.log("YAML OK");
