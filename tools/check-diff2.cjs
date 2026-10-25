const fs=require("fs");
const YAML=require("C:/Users/Igor/.dsh/profiles/desktop/node_modules/yaml");
const oldDoc=YAML.parse(fs.readFileSync("C:\\Users\\Igor\\.dsh\\profiles\\desktop\\cordis.patch.yml","utf8").replace(/^\uFEFF/,""));
const newDoc=YAML.parse(fs.readFileSync("tools/patch-new.yml","utf8"));
const o=oldDoc.find(d=>d.id==="agent-teams"), n=newDoc.find(d=>d.id==="agent-teams");
const oj=JSON.stringify(o.config.profiles), nj=JSON.stringify(n.config.profiles).replace(/"model":"[^"]+",/g,"");
console.log("profiles identical except model:", oj===nj);
// проверяем, что все прочие записи не тронуты
const oldOther=JSON.stringify(oldDoc.filter(d=>d.id!=="agent-teams"));
const newOther=JSON.stringify(newDoc.filter(d=>d.id!=="agent-teams"));
console.log("other entries identical:", oldOther===newOther);
// перечень model по профилям
for(const [k,pr] of Object.entries(n.config.profiles)){
  const ms=pr.members.filter(m=>m.model).map(m=>m.name.replace(/-.*/,""));
  if(ms.length) console.log(k, pr.members.length+" участников, моделей: "+ms.length);
}
