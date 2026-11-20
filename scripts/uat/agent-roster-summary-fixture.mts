/** P1-66 deterministic real compiler fixture. Writes only its own isolated root. */
import { mkdir, writeFile, readFile, chmod, copyFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { stringify } from "../../webui/node_modules/yaml/dist/index.js";
import {compiledGrantProjectionFingerprint,compiledNormalizedGraph} from './agent-roster-summary-oracle.mjs';
const out=path.resolve(process.argv[2]??"");
const profile=process.argv[3]??"BAL";
const copies=Number(process.argv[4]??1);
const width=process.argv[5]??"H";
if(!out.includes("/inbox/p166-implementation-20261120/")||!["BAL","SKEW"].includes(profile)||![1,2,5].includes(copies)||!["H","L"].includes(width)) throw Error("isolated P1-66 fixture path/profile/copies required");
const privateDir=process.env.P166_PRIVATE_DIR;
if(!privateDir?.startsWith("/private/tmp/")) throw Error("private P166_PRIVATE_DIR required");
await mkdir(privateDir,{recursive:true,mode:0o700});await chmod(privateDir,0o700);
const project=path.join(out,"project"),content=path.join(project,"config");
await mkdir(path.join(project,"webui/config"),{recursive:true});await mkdir(path.join(project,".ktx-ui"),{recursive:true});
const sha=(x:string)=>createHash("sha256").update(x).digest("hex");
const allTools=["lucy_query","lucy_read_source","lucy_explain_query","lucy_freshness","entity_details","sl_validate"];
const connections:Record<string,unknown>={},roles:Record<string,unknown>={},users:any[]=[];
const allSources:Array<{connection:string;schema:string;source:string;physical:string;enabled:boolean}>=[];
const t0=Number(process.env.P166_T0??Date.now());
const day=86400000;
let bearer:string;try{bearer=await readFile(path.join(privateDir,"mcp-token"),"utf8");}catch{bearer=randomBytes(32).toString("hex");await writeFile(path.join(privateDir,"mcp-token"),bearer,{mode:0o600});}
for(let k=0;k<copies;k++) {
 const group=String(k).padStart(2,"0"),schema=`ars_${group}`;
 const sources=Array.from({length:724},(_,i)=>({connection:`ars_${group}_c${i%9}`,schema,source:`ars_${group}_source_${String(i).padStart(3,"0")}`,physical:`${schema}.fact_${String(i).padStart(3,"0")}`,enabled:i<720}));
 allSources.push(...sources);
 for(let c=0;c<9;c++) {
  const id=`ars_${group}_c${c}`;const subset=sources.filter(s=>s.connection===id);
  connections[id]={driver:"mysql",engine:"mysql",host:"p166-db",port:3306,username:"ars_readonly",password:"ars_readonly",database:schema,schemas:[schema],readonly:true,enabled_tables:subset.filter(s=>s.enabled).map(s=>s.physical)};
  const manifest={tables:Object.fromEntries(subset.map(s=>[s.source,{table:s.physical,columns:[{name:"id",type:"number",nullable:false},{name:"region",type:"string",nullable:false},{name:"department",type:"string",nullable:false}]}]))};
  const dir=path.join(content,"semantic-layer",id,"_schema");await mkdir(dir,{recursive:true});await writeFile(path.join(dir,`${schema}.yaml`),stringify(manifest));
 }
 for(let r=0;r<47;r++) {
  let n=r===0?(profile==="BAL"?350:650):(r>=2&&r<=16?36:profile==="BAL"?30:24);
  // Leave room for the fixed permission envelope: a 1/2 graph need not halve total bytes.
  if(width==="L") n=Math.max(1,Math.floor(n/3));
  const selected=sources.slice(0,n);
  const selectors=Array.from({length:9},(_,c)=>({connection:`ars_${group}_c${c}`,schema,names:selected.filter(s=>s.connection===`ars_${group}_c${c}`).map(s=>s.source),
    row_access:r===1||r>=17?"scoped":"all",...(r===1||r>=17?{row_policy:{predicates:[{field:"region",op:"eq",value:r===1?"East":"West"}]}}:{})})).filter(s=>s.names.length);
  roles[`ars_${group}_r${String(r).padStart(2,"0")}`]={description:`ARS ${profile} role ${r}`,permission_model_version:2,allow:{tools:[...allTools],connections:Array.from({length:9},(_,c)=>`ars_${group}_c${c}`),tableSelectors:selectors}};
 }
 for(let a=0;a<71;a++) {
  const indices=a===0?[0]:a<=15?[a+1]:[1,17+(a-16)%30];
  const id=`ars_${group}_a${String(a).padStart(2,"0")}`;
  users.push({id,name:`ARS ${group} Agent ${String(a).padStart(2,"0")}`,note:`${profile} semantic workload`,enabled:true,
    roles:indices.map(r=>`ars_${group}_r${String(r).padStart(2,"0")}`),
    tokens:Array.from({length:3},(_,j)=>({hash:`sha256:${k===0&&a===16&&j===0?sha(bearer):sha(`${id}:${j}`)}`,label:`ars-${j}`,created:new Date(t0-90*day).toISOString(),expires_at:new Date(t0+90*day).toISOString()})),
    ...(a>=16&&a<24?{constraints:{sources:[{connection:sources[0]!.connection,schema,names:[sources[0]!.source],predicates:[{field:"department",op:"eq",value:"Finance"}]}]}}:{})});
 }
}
await writeFile(path.join(project,"ktx.yaml"),stringify({project:{name:"ars-isolated",root:"."},connections}));
await writeFile(path.join(project,"webui/config/access.yaml"),stringify({roles,users,defaults:{deny_tools:["sql_execution"]}}));
let login:{adminId:string;password:string};try{login=JSON.parse(await readFile(path.join(privateDir,"login.json"),"utf8"));}catch{login={adminId:"ars_owner",password:randomBytes(24).toString("hex")};await writeFile(path.join(privateDir,"login.json"),JSON.stringify(login),{mode:0o600});}
const {hashPassword}=await import("../../webui/server/auth/password.js");
await writeFile(path.join(project,"webui/config/admins.yaml"),stringify({admins:[{id:login.adminId,account_uid:"ars-isolated-owner",display_name:"ARS Owner",role:"owner",enabled:true,password_hash:await hashPassword(login.password),created_at:new Date(t0).toISOString()}]}));
process.env.KTX_PROJECT_ROOT=project;process.env.LUCY_CONTENT_ROOT=content;process.env.LUCY_AUDIT_DB=path.join(project,".ktx-ui/audit.sqlite");
const {buildAdminPermissionContext,resolveEffectivePermissionsBatchForAdmin}=await import("../../webui/server/proxy/acl.js");
const {parseAccessConfigText}=await import("../../webui/server/proxy/identity.js");
const config=parseAccessConfigText(await readFile(path.join(project,"webui/config/access.yaml"),"utf8"));
const context=await buildAdminPermissionContext(config);const compiled=await resolveEffectivePermissionsBatchForAdmin(users.map(u=>u.id),context);
const perAgent=users.map(u=>{const r=compiled.get(u.id);if(!r?.ok) throw Error(`${u.id}: ${r&&!r.ok?r.reason:"missing"}`);const p=r.permissions;
 // Same public permission projection as the existing API, measured again from actual Docker HTTP before performance.
 return {id:u.id,roles:u.roles,identityDigest:createHash("sha256").update(JSON.stringify({id:u.id,roles:u.roles,constraints:u.constraints})).digest("hex"),capabilities:p.capabilities.length,sources:p.sources.length,connections:p.connections.length,tools:p.tools.length,
  normalizedFingerprint:compiledNormalizedGraph(u,p),grantProjectionFingerprint:compiledGrantProjectionFingerprint(p)};});
if(process.env.P166_AUDIT_FROM && path.resolve(process.env.P166_AUDIT_FROM)!==out) await copyFile(path.join(process.env.P166_AUDIT_FROM,"project/.ktx-ui/audit.sqlite"),process.env.LUCY_AUDIT_DB);
const {getAuditDb,resetAuditDbForTests}=await import("../../webui/server/admin/audit.js");const db=await getAuditDb();
const total=1000000*copies,current=200000*copies;
const add=db.prepare(`INSERT INTO access_log(ts,user_id,token_hash_prefix,tool,outcome,duration_ms,request_id,policy_version,eval_mark,tables,args_summary)
 VALUES(?,?,?,?,?,1,?,'ars-seed',0,?,?)`);
if(!process.env.P166_AUDIT_FROM) for(let first=0;first<total;first+=10000) db.transaction(()=>{for(let n=first;n<Math.min(first+10000,total);n++){
 const u=users[n%users.length]!,token=u.tokens[n%3]!,offset=n<current?(n%4<2?2:n%4===2?10:20):40;
 const protocol=n%10===0;
 add.run(new Date(t0-offset*day).toISOString(),u.id,token.hash.slice(0,19),protocol?"server/probe":"lucy_query",n%19===0?"denied":"ok",`ars-${n}`,protocol?null:JSON.stringify([`${u.id.slice(0,6)}.fact_000`]),"{}");
}})();
if(db.prepare("SELECT count(*) AS n FROM access_log").get().n!==total) throw Error("audit oracle row count mismatch");
resetAuditDbForTests();
for(let i=71;i<perAgent.length;i++)if(perAgent[i].normalizedFingerprint!==perAgent[i%71].normalizedFingerprint)throw Error("replica AST mismatch");
const manifest={fingerprintVersion:2,profile,copies,width,t0:new Date(t0).toISOString(),agents:users.length,formalRoles:Object.keys(roles).length,connections:Object.keys(connections).length,
 manifestSources:allSources.length,enabledSources:allSources.filter(s=>s.enabled).length,capabilities:perAgent.reduce((n,a)=>n+a.capabilities,0),auditRows:total,windowRows:current,
 calibration:"Six data-plane tools require at least 334 sources for a 2000-capability subject; actual 724/720 per replica exceed the approved source lower bounds.",
 configDigest:sha(await readFile(path.join(project,"webui/config/access.yaml"),"utf8")),perAgent};
await writeFile(path.join(out,"fixture-manifest.json"),JSON.stringify(manifest,null,2));
const sql=[`CREATE USER IF NOT EXISTS 'ars_readonly'@'%' IDENTIFIED BY 'ars_readonly';`];
for(let k=0;k<copies;k++){const schema=`ars_${String(k).padStart(2,"0")}`;sql.push(`CREATE DATABASE IF NOT EXISTS ${schema};`,`CREATE TABLE IF NOT EXISTS ${schema}.fixture_rows(id INT,region VARCHAR(20),department VARCHAR(20));`,`TRUNCATE ${schema}.fixture_rows;`,`INSERT INTO ${schema}.fixture_rows VALUES(1,'East','Finance'),(2,'West','Finance'),(3,'East','Sales');`,`GRANT SELECT ON ${schema}.* TO 'ars_readonly'@'%';`);
 for(let i=0;i<724;i++)sql.push(`CREATE OR REPLACE VIEW ${schema}.fact_${String(i).padStart(3,"0")} AS SELECT * FROM ${schema}.fixture_rows;`);
}
await writeFile(path.join(out,"mysql-fixture.sql"),sql.join("\n"));
console.log(JSON.stringify({...manifest,perAgent:`${perAgent.length} records saved; no credentials printed`}));
