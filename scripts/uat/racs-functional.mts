/** Real isolated module transactions and local OS/SQLite faults; no server mocks. */
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
const web=process.env.RACS_WEB!;const container=process.env.RACS_CONTAINER!;const secret=process.env.RACS_SECRET_DIR!;
if(!web?.startsWith('http://127.0.0.1:')||!container?.startsWith('lucy-racs-')||!secret?.startsWith('/private/tmp/'))throw Error('isolated task only');
const out=process.argv[2]!;if(!out?.includes('p1-58-59-finalization-20261120'))throw Error('task output only');
const credential=JSON.parse(await readFile(secret+'/login.json','utf8'));const records:any[]=[];
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function check(id:string,yes:unknown,detail:any={}){records.push({id,verdict:yes?'PASS':'FAIL',detail});if(!yes)throw Error(id+': '+JSON.stringify(detail).slice(0,400));}
async function req(route:string,cookie:string,method='GET',body?:any){const t=performance.now();const r=await fetch(web+route,{method,signal:AbortSignal.timeout(10000),headers:{cookie,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();return{status:r.status,...j,ms:performance.now()-t,headers:r.headers};}
async function login(id='racs_owner'){const r=await req('/api/auth/login','','POST',{adminId:id,password:credential.password});check('login',r.status===200,{id,status:r.status});return r.headers.getSetCookie().map((s:string)=>s.split(';')[0]).join('; ');}
function node(code:string,root=false){return execFileSync('docker',['exec',...(root?['-u','0']:[]),'-i',container,'node','--input-type=module'],{input:code,maxBuffer:16*1024*1024}).toString();}
function yaml(rel:string,code:string){node(`import fs from 'node:fs';import{parse,stringify}from'/app/webui/node_modules/yaml/dist/index.js';const p='/data/lucy/'+${JSON.stringify(rel)};const c=parse(fs.readFileSync(p,'utf8'));${code};fs.writeFileSync(p+'.racs',stringify(c));fs.renameSync(p+'.racs',p);`);}
function audit(code:string){return JSON.parse(node(`import Database from'/app/webui/node_modules/better-sqlite3/lib/index.js';const db=new Database('/data/lucy/.ktx-ui/audit.sqlite');${code};db.close();`));}
const access='webui/config/access.yaml';
async function prep(kind:string,id:string,patch:any,cookie:string){const p='/api/admin/'+kind+'s/'+id;const d=await req(p,cookie);check('read-baseline',d.status===200,{kind,id,status:d.status});const r=await req(p,cookie,'PATCH',{dryRun:true,baseObjectVersion:d.data.baseObjectVersion,patch});check('real-preview',r.status===200&&r.data.previewToken,{kind,id,status:r.status,error:r.error});return{dryRun:false,baseObjectVersion:r.data.baseObjectVersion,previewToken:r.data.previewToken,operationId:randomUUID(),patch};}
async function save(kind:string,id:string,body:any,cookie:string){return req('/api/admin/'+kind+'s/'+id,cookie,'PATCH',body);}
async function confirm(kind:string,id:string,patch:any,cookie:string){const p=await prep(kind,id,patch,cookie);const r=await save(kind,id,p,cookie);check('explicit-recovery-commit',r.status===200&&r.data.written===true,{kind,id,status:r.status,error:r.error});return{p,r};}
async function mutateCreate(kind:string,value:any,cookie:string,route='/api/admin/'+kind+'s'){const r=await req(route,cookie,'POST',{dryRun:true,...value});check('create-preview',r.status===200&&r.data.previewToken,{kind,status:r.status,error:r.error});const body={dryRun:false,...value,baseObjectVersion:r.data.baseObjectVersion,previewToken:r.data.previewToken,operationId:randomUUID()};return{body,response:await req(route,cookie,'POST',body)};}
async function deletion(kind:string,id:string,cookie:string,previewOnly=false){const route='/api/admin/'+kind+'s/'+id;const d=await req(route,cookie);const r=await req(route,cookie,'DELETE',{dryRun:true,baseObjectVersion:d.data.baseObjectVersion});check('delete-preview',r.status===200&&r.data.previewToken,{kind,id,status:r.status,error:r.error});const b={dryRun:false,baseObjectVersion:r.data.baseObjectVersion,previewToken:r.data.previewToken,operationId:randomUUID()};return{body:b,response:previewOnly?r:await req(route,cookie,'DELETE',b)};}
let failure:any;
try{
 const owner=await login(),other=await login('racs_operator'),outsider=await login('racs_operator2');
 // DEP-01: unknown fields are part of the target baseline; a fresh legal edit still completes.
 let p=await prep('agent','racs_a3',{note:'DEP01 mine'},owner);
 yaml(access,`c.users.find(u=>u.id==='racs_a3').racs_unknown={ordered:[${JSON.stringify(randomUUID())},'second']}`);
 let r=await save('agent','racs_a3',p,owner);check('DEP-01-unknown-target-conflict',r.status===409,{status:r.status,code:r.error?.code});
 await confirm('agent','racs_a3',{note:'DEP01 recovered'},owner);
 // DEP-02: assigned permissions change to another same-size concrete source set.
 p=await prep('agent','racs_a3',{note:'DEP02 mine'},owner);
 const rd=await req('/api/admin/roles/racs_r3',owner);const allow=structuredClone(rd.data.role.allow);const sel=allow.tableSelectors[0];const conn=sel.connection;const source=sel.names[0];const stride=Number(process.env.RACS_SCALE||1)*8;const nextSource='racs_table_'+(Number(source.replace('racs_table_',''))+stride);const outsideSource='racs_table_'+(Number(source.replace('racs_table_',''))+stride*2);allow.tableSelectors[0].names=[nextSource];
 await confirm('role','racs_r3',{allow},owner);
 r=await save('agent','racs_a3',p,owner);check('DEP-02-same-cardinality-different-set',r.status===409&&r.error?.code==='PREVIEW_INPUT_CHANGED',{status:r.status,code:r.error?.code});
 await confirm('agent','racs_a3',{note:'DEP02 recovered'},owner);
 // DEP-03 inside actual matching source map vs an outside entry in the same manifest.
 p=await prep('agent','racs_a3',{note:'DEP03 mine'},owner);
 yaml('config/semantic-layer/'+conn+'/_schema/racs.yaml',`c.tables[${JSON.stringify(nextSource)}].table='racs.'+${JSON.stringify(nextSource)}+'_changed'`);
 r=await save('agent','racs_a3',p,owner);check('DEP-03-closure-inside',r.status===409,{status:r.status,code:r.error?.code});
 yaml('config/semantic-layer/'+conn+'/_schema/racs.yaml',`c.tables[${JSON.stringify(nextSource)}].table='racs.'+${JSON.stringify(nextSource)}`);
 await confirm('agent','racs_a3',{note:'DEP03 restored'},owner);
 p=await prep('agent','racs_a3',{note:'DEP03 outside accepted'},owner);
 yaml('config/semantic-layer/'+conn+'/_schema/racs.yaml',`c.tables[${JSON.stringify(outsideSource)}].table='racs.'+${JSON.stringify(outsideSource)}+'_changed'`);
 r=await save('agent','racs_a3',p,owner);check('DEP-03-closure-outside-no-conflict',r.status===200,{status:r.status,code:r.error?.code});
 yaml('config/semantic-layer/'+conn+'/_schema/racs.yaml',`c.tables[${JSON.stringify(outsideSource)}].table='racs.'+${JSON.stringify(outsideSource)}`);
 // DEP-04 unrelated description and DEP-06 raw audit counts don't poison effect bindings.
 p=await prep('agent','racs_a3',{note:'DEP04 unrelated retained'},owner);
 await confirm('role','racs_r4',{description:'unrelated DEP04'},other);
 r=await save('agent','racs_a3',p,owner);check('DEP-04-unrelated-description',r.status===200,{status:r.status,code:r.error?.code});
 p=await prep('agent','racs_a3',{note:'DEP06 counter unchanged tier'},owner);
 audit(`db.prepare("INSERT INTO access_log(ts,user_id,tool,outcome,duration_ms,request_id,policy_version) VALUES (?,'racs_a3','lucy_query','ok',1,'dep06','racs')").run(new Date().toISOString());console.log('{}')`);
 r=await save('agent','racs_a3',p,owner);check('DEP-06-counter-only',r.status===200,{status:r.status,code:r.error?.code});
 // DEP-09 statistics do not change object versions; force read sees the new audit row.
 const before=await req('/api/admin/agents/racs_a3',owner);await req('/api/admin/agents/statistics?range=7d&refresh=true',owner);const after=await req('/api/admin/agents/racs_a3',owner);
 check('DEP-09-display-time-not-object',before.data.baseObjectVersion===after.data.baseObjectVersion);
 // DEP-08 an account disabled after preview cannot publish; another authorized identity can.
 p=await prep('agent','racs_a3',{note:'disabled must not save'},other);
 yaml('webui/config/admins.yaml',`c.admins.find(a=>a.id==='racs_operator').enabled=false`);
 r=await save('agent','racs_a3',p,other);check('DEP-08-disabled-actor',r.status===401||r.status===403,{status:r.status,code:r.error?.code});
 await confirm('agent','racs_a4',{note:'unaffected actor works'},owner);
 yaml('webui/config/admins.yaml',`c.admins.find(a=>a.id==='racs_operator').enabled=true`);
 const restored=await login('racs_operator');await confirm('agent','racs_a3',{note:'DEP08 restored actor'},restored);
 // DEP-10 proven sets reorder equally; unknown ordered values change the object version.
 const original=await req('/api/admin/roles/racs_r3',owner);p=await prep('role','racs_r3',{description:'set reordered still saves'},owner);
 yaml(access,`c.roles.racs_r3.allow.tools.reverse()`);
 r=await save('role','racs_r3',p,owner);check('DEP-10-set-order-equal',r.status===200,{status:r.status,code:r.error?.code});
 p=await prep('agent','racs_a3',{note:'unknown reorder must conflict'},owner);yaml(access,`c.users.find(u=>u.id==='racs_a3').racs_unknown.ordered.reverse()`);
 r=await save('agent','racs_a3',p,owner);check('DEP-10-unknown-array-order-conflict',r.status===409,{status:r.status});await confirm('agent','racs_a3',{note:'DEP10 recovered'},owner);
 // DEP-11 absent target becomes present, then deleted/recreated ABA.
 const suffix=randomUUID().slice(0,6),aid='racs_new_'+suffix,rid='racs_new_role_'+suffix;
 const a={agent:{id:aid,name:'RACS new',roles:['racs_r3']}};
 const ap=await req('/api/admin/agents',owner,'POST',{dryRun:true,...a});
 let created=await mutateCreate('agent',a,owner);check('DEP-11-first-create',created.response.status===200,{status:created.response.status,error:created.response.error});
 r=await req('/api/admin/agents',owner,'POST',{dryRun:false,...a,baseObjectVersion:ap.data.baseObjectVersion,previewToken:ap.data.previewToken,operationId:randomUUID()});check('DEP-11-absence-became-present',r.status===409,{status:r.status,code:r.error?.code});
 const stale=await prep('agent',aid,{note:'old lifetime'},owner);let deleted=await deletion('agent',aid,owner);check('delete-committed',deleted.response.status===200,{status:deleted.response.status,error:deleted.response.error});
 created=await mutateCreate('agent',a,owner);check('recreate-committed',created.response.status===200,{status:created.response.status,error:created.response.error});
 r=await save('agent',aid,stale,owner);check('SC02-no-ABA-resurrection',r.status===409,{status:r.status,code:r.error?.code});
 // DEP-05 delete checks fresh references, retired IDs cannot be reused or copied.
 const role=(await req('/api/admin/roles/racs_r3',owner)).data.role;
 const roleBody={roleId:rid,role:{description:'unreferenced',permission_model_version:2,allow:role.allow}};
 const rc=await mutateCreate('role',roleBody,owner);check('role-create',rc.response.status===200,{status:rc.response.status,error:rc.response.error});
 const dp=await deletion('role',rid,owner,true);await confirm('agent',aid,{roles:[rid]},owner);
 r=await req('/api/admin/roles/'+rid,owner,'DELETE',dp.body);check('DEP-05-new-reference-prevents-delete',r.status===409,{status:r.status,code:r.error?.code});
 await confirm('agent',aid,{roles:['racs_r3']},owner);deleted=await deletion('role',rid,owner);check('DEP-05-unreferenced-delete-completes',deleted.response.status===200,{status:deleted.response.status,error:deleted.response.error});
 r=await req('/api/admin/roles',owner,'POST',{dryRun:true,...roleBody});check('DEP-05-retired-create-rejected',r.status===409,{status:r.status,code:r.error?.code});
 r=await req('/api/admin/roles/racs_r3/copy',owner,'POST',{dryRun:true,newRoleId:rid});check('SC02-copy-cannot-bypass-retirement',r.status===409,{status:r.status,code:r.error?.code});
 // Copy preview binds source even when the caller supplies an unchanged explicit destination body.
 const copyId=rid+'_copy',copyBody={newRoleId:copyId,description:'copy candidate'};
 const cp=await req('/api/admin/roles/racs_r3/copy',owner,'POST',{dryRun:true,...copyBody});check('copy-preview',cp.status===200,{status:cp.status,error:cp.error});
 await confirm('role','racs_r3',{description:'copy source changed'},owner);
 r=await req('/api/admin/roles/racs_r3/copy',owner,'POST',{dryRun:false,...copyBody,baseObjectVersion:cp.data.baseObjectVersion,previewToken:cp.data.previewToken,operationId:randomUUID()});check('DEP-11-copy-source-changed',r.status===409,{status:r.status,code:r.error?.code});
 const copied=await mutateCreate('role',copyBody,owner,'/api/admin/roles/racs_r3/copy');check('copy-explicit-recovery',copied.response.status===200,{status:copied.response.status,error:copied.response.error});
 // Durable receipt identity and immutable historical version, not current-value inference.
 const committed=await confirm('agent',aid,{note:'receipt original'},other==='unused'?other:restored);
 const status=await req('/api/admin/access-write-status/'+committed.p.operationId,restored);check('SC12-receipt-version',status.data.outcome==='committed'&&status.data.committedObjectVersion===committed.r.data.after?.baseObjectVersion||status.data.outcome==='committed'&&Boolean(status.data.committedObjectVersion),{outcome:status.data.outcome});
 await confirm('agent',aid,{note:'subsequent value'},owner);
 const historical=await req('/api/admin/access-write-status/'+committed.p.operationId,restored);check('SC08-historical-receipt-stable',historical.data.committedObjectVersion===status.data.committedObjectVersion);
 r=await req('/api/admin/access-write-status/'+committed.p.operationId,outsider);check('SC12-other-account-status-denied',r.status===403||r.status===404,{status:r.status});
 r=await save('agent',aid,committed.p,restored);check('SC09-exact-operation-replay-no-write',r.status===200,{status:r.status,error:r.error});
 r=await save('agent',aid,{...committed.p,patch:{note:'different body'}},restored);check('SC09-operation-different-body-rejected',r.status===409,{status:r.status,code:r.error?.code});
 r=await save('agent',aid,committed.p,owner);check('SC09-operation-different-account-rejected',r.status===403||r.status===409,{status:r.status,code:r.error?.code});
 // Real held filesystem publisher window, not an HTTP mock or a queued write.
 p=await prep('agent',aid,{note:'busy recovery'},owner);
 node(`import fs from'node:fs';fs.writeFileSync('/data/lucy/.ktx-ui/semantic-publish.lock',JSON.stringify({kind:'agent_save',operationId:'racs-local-held-window',pid:1,acquiredAt:new Date().toISOString()}))`);
 r=await save('agent',aid,p,owner);check('SC06-busy-immediate-json',r.status===503&&r.error?.code==='PUBLISH_COORDINATOR_BUSY'&&r.ms<2000,{status:r.status,code:r.error?.code,ms:r.ms});
 node(`import fs from'node:fs';fs.unlinkSync('/data/lucy/.ktx-ui/semantic-publish.lock')`);await confirm('agent',aid,{note:'busy recovery'},owner);
 // Audit terminal failure in real SQLite. Rollback terminal remains writable.
 p=await prep('agent',aid,{note:'audit terminal must fail'},owner);
 audit(`db.exec("CREATE TRIGGER racs_fail_committed BEFORE UPDATE OF write_status ON config_change_log WHEN NEW.write_status='committed' BEGIN SELECT RAISE(FAIL,'racs real terminal fault'); END");console.log('{}')`);
 try{r=await save('agent',aid,p,owner);check('14C-audit-terminal-honest-failure',r.status>=400&&r.data?.written!==true,{status:r.status,error:r.error?.code,state:r.data?.status});}
 finally{audit(`db.exec('DROP TRIGGER IF EXISTS racs_fail_committed');console.log('{}')`);}
 const rolled=await req('/api/admin/access-write-status/'+p.operationId,owner);check('14C-audit-failure-terminal-known',rolled.data.outcome==='not_committed',{outcome:rolled.data.outcome});
 await confirm('agent',aid,{note:'audit restored legal save'},owner);
 // Legacy file version still rejects a whole-file stale baseline.
 const legacy=await req('/api/admin/agents/'+aid,owner);await confirm('agent','racs_a4',{note:'legacy unrelated change'},owner);
 r=await req('/api/admin/agents/'+aid,owner,'PATCH',{dryRun:false,version:legacy.data.version,patch:{note:'legacy stale'}});check('SC10-legacy-file-version-conflict',r.status===409,{status:r.status,code:r.error?.code});
 await deletion('agent',aid,owner);await deletion('role',copyId,owner);
}catch(e){failure=String(e)}
await writeFile(out,JSON.stringify({at:new Date().toISOString(),web,container,verdict:failure?'FAIL':'PASS',failure,records},null,2));console.log(JSON.stringify({out,verdict:failure?'FAIL':'PASS',failure,checks:records.length}));if(failure)process.exitCode=1;
