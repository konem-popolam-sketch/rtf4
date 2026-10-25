const fs=require("fs");
const token=fs.readFileSync("tools/.gh-token.txt","utf8").trim();
async function api(path, opts={}){
  const r=await fetch("https://api.github.com"+path,{...opts,headers:{authorization:"Bearer "+token,"user-agent":"rtf4-agent",accept:"application/vnd.github+json",...(opts.headers||{})}});
  const t=await r.text();
  return {status:r.status, body:t};
}
(async()=>{
  const me=await api("/user");
  console.log("USER", me.status, me.body.slice(0,300));
  const repos=await api("/user/repos?per_page=100&sort=updated");
  try{ const j=JSON.parse(repos.body); console.log("REPOS", repos.status, j.map(r=>r.full_name+":"+r.private).join(", ").slice(0,600)); }catch(e){ console.log("repos raw", repos.status, repos.body.slice(0,200)); }
})();
