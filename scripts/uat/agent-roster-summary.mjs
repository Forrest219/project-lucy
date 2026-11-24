/** P1-66 isolated Docker/API runner. Headed browser companion supplies UI evidence. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {agentScale,validateScale} from './agent-roster-summary-oracle.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),out=join(root,'inbox/p166-implementation-20261120');
const privateDir='/private/tmp/lucy-p166-private-20261120';
const [mode,fixture='BAL-1',candidate='b']=process.argv.slice(2);
assert(/^(BAL|SKEW)-(1|2|5)(-L|-FUNCTIONAL)?$/.test(fixture));assert(['a','b','legacy','roster','old-ui'].includes(candidate));
const name=`lucy-p166-${candidate}`,port=candidate==='a'?59165:candidate==='b'?59166:(candidate==='old-ui'||candidate==='roster')?59167:59168;
const base=`http://127.0.0.1:${port}`,image=candidate==='a'?'project-lucy:p166-baseline-20261120':candidate==='b'?'project-lucy:p166-candidate-20261120':candidate==='roster'?'project-lucy:p166-legacy-roster-20261120':candidate==='old-ui'?'project-lucy:p166-old-ui-20261120':'project-lucy:p166-legacy-20261120';
const dest=join(out,'instances',name),project=join(dest,'project');
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:100*1024*1024,...options});
const resources=()=>{const [current,peak,...rows]=docker(['exec',name,'cat','/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory.peak','/sys/fs/cgroup/memory.events','/sys/fs/cgroup/cpu.stat']).trim().split('\n');return {memoryCurrentBytes:Number(current),memoryPeakBytes:Number(peak),kernelCounters:Object.fromEntries(rows.map(row=>{const [key,value]=row.trim().split(/\s+/);return [key,Number(value)];}))};};
const save=(path,data)=>writeFileSync(path,JSON.stringify(data,null,2));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function control(path){return JSON.parse(docker(['exec',name,'curl','-s','--max-time','10','--unix-socket','/tmp/p166-control.sock','http://localhost'+path]));}
async function waitSnapshotIdle(){
 const started=Date.now();let last;
 while(Date.now()-started<1800000){last=control('/snapshot');if(last.snapshots?.inflightBuilds===0&&last.snapshots?.verified)return {waitMs:Date.now()-started,last};await sleep(1000);}
 throw Error('permission snapshot did not settle after a timed-out client; no next cold invalidation or warm sample allowed');
}
async function login(){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:readFileSync(join(privateDir,'login.json'),'utf8')});assert.equal(r.status,200,await r.text());return r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');}
async function get(path,cookie){const t=performance.now();const response=await fetch(base+path,{headers:{cookie,'accept-encoding':'identity'},signal:AbortSignal.timeout(10000)});const ttfbMs=performance.now()-t;const body=await response.text(),ms=performance.now()-t;let json;try{json=JSON.parse(body);}catch{};return {status:response.status,ms,ttfbMs,downloadMs:ms-ttfbMs,serverTiming:response.headers.get('server-timing'),bytes:Buffer.byteLength(body),json};}
if(mode==='database'){
 const database=process.env.P166_DB_NAME??'p166-db';assert(['p166-db','p166-functional-db'].includes(database));
 if(!existsSync(join(privateDir,'mysql-root')))writeFileSync(join(privateDir,'mysql-root'),randomBytes(24).toString('hex'),{mode:0o600});
 if(spawnSync('docker',['network','inspect','lucy-p166-20261120'],{stdio:'ignore'}).status!==0)docker(['network','create','lucy-p166-20261120']);
 if(spawnSync('docker',['inspect',database],{stdio:'ignore'}).status!==0)docker(['run','-d','--name',database,'--network','lucy-p166-20261120','--cpus','1','--memory','512m','--label','lucy.uat=p166-20261120','--mount',`type=bind,source=${privateDir}/mysql-root,target=/run/secrets/mysql-root,readonly`,'-e','MYSQL_ROOT_PASSWORD_FILE=/run/secrets/mysql-root','mysql:8.4']);
 for(let i=0;i<90;i++){if(spawnSync('docker',['exec',database,'sh','-c','MYSQL_PWD="$(cat /run/secrets/mysql-root)" mysql -uroot -N -B -e "SELECT 1"'],{stdio:'ignore'}).status===0)break;await sleep(1000);}
 const sql=readFileSync(database==='p166-db'?join(out,'mysql-fixture.sql'):join(out,'BAL-1-FUNCTIONAL/mysql-fixture.sql'),'utf8');
 docker(['exec','-i',database,'sh','-c','MYSQL_PWD="$(cat /run/secrets/mysql-root)" mysql -uroot'],{input:sql});
 console.log('Isolated MySQL fixture initialized');
}else if(mode==='start'){
 while(candidate==='b'&&existsSync(join(out,'candidate-rebuild-pending')))await sleep(1000);
 if(spawnSync('docker',['inspect',name],{stdio:'ignore'}).status===0)docker(['rm','-f',name]);
 // Clone only task-owned instance data, never shared demo/109.
 if(existsSync(project))execFileSync('rm',['-rf',project]);mkdirSync(dest,{recursive:true});
 execFileSync('cp',['-cR',join(out,fixture,'project'),project]);execFileSync('chmod',['-R','a+rwX',project]);
 const volume=`lucy-p166-data-${candidate}`;
 if(spawnSync('docker',['volume','inspect',volume],{stdio:'ignore'}).status===0)docker(['volume','rm',volume]);
 docker(['volume','create','--label','lucy.uat=p166-20261120',volume]);
 docker(['run','--rm','--user','0','--entrypoint','sh','--mount',`type=bind,source=${project},target=/fixture,readonly`,'--mount',`type=volume,source=${volume},target=/data/lucy`,image,'-c','cp -a /fixture/. /data/lucy/ && chown -R 10001:10001 /data/lucy']);
 const args=['run','-d','--name',name,'--network','lucy-p166-20261120','--cpus','2','--memory','4g','--label','lucy.uat=p166-20261120','-p',`127.0.0.1:${port}:5174`,'-p',`127.0.0.1:${port+10}:7879`,
 '--mount',`type=volume,source=${volume},target=/data/lucy`,'--mount',`type=bind,source=${out}/uat-entrypoint.sh,target=/app/scripts/runtime/docker-entrypoint.sh,readonly`,'--mount',`type=bind,source=${root}/scripts/uat/agent-roster-summary-server.mts,target=/app/scripts/uat/agent-roster-summary-server.mts,readonly`,
 '-e','KTX_PROJECT_ROOT=/data/lucy','-e','LUCY_CONTENT_ROOT=/data/lucy/config','-e','LUCY_ADMINS_CONFIG_PATH=/data/lucy/webui/config/admins.yaml','-e','LUCY_AUDIT_DB=/data/lucy/.ktx-ui/audit.sqlite','-e','LUCY_WEBUI_AUTH=on','-e','LUCY_TEMPLATE_ROOT=/nonexistent','-e','LUCY_DISABLE_TEMPLATE_SYNC=1','-e','LUCY_AUTO_REINDEX=0',image];
 const id=docker(args).trim();let health;
 for(let i=0;i<1800;i++){if(i%10===0&&docker(['inspect',name,'--format','{{.State.Running}}']).trim()!=='true')throw Error('isolated application exited during startup: '+name);try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(3000)});if(r.ok && spawnSync('docker',['exec',name,'test','-S','/tmp/p166-control.sock'],{stdio:'ignore'}).status===0){health=await r.json();break;}}catch{}await sleep(1000);}
 assert(health,`startup failed; inspect ${name}`);save(join(dest,'instance.json'),{name,id,image,port,base,fixture,health,cgroup:resources(),resources:JSON.parse(docker(['inspect',name]))[0].HostConfig});console.log(JSON.stringify({name,fixture,base,health:health.data?.status}));
}else if(mode==='api'){
 assert.equal(JSON.parse(readFileSync(join(dest,'instance.json'))).fixture,fixture,'actual container fixture must match requested profile');
 const manifest=JSON.parse(readFileSync(join(out,fixture,'fixture-manifest.json'))),cookie=await login();
 const folder=join(out,'results',`${fixture}-${candidate}`);mkdirSync(folder,{recursive:true});
 const report={fixture,candidate,startedAt:new Date().toISOString(),failures:[],samples:[],oracle:{},diagnostics:{startup:control('/snapshot'),resourcesStartup:resources()},instance:JSON.parse(readFileSync(join(dest,'instance.json')))};
 const check=(value,message)=>{if(!value)report.failures.push(message);};
 const roster=await get('/api/admin/agents?view=roster',cookie);check(roster.status===200,'roster HTTP');const rows=roster.json?.data?.agents??[];
 const perAgent=rows.map(agentScale);
 report.failures.push(...validateScale(manifest,perAgent));
 save(join(folder,'per-agent-scale.json'),perAgent);
 const total=perAgent.reduce((n,a)=>n+a.capabilities,0),bytes=perAgent.reduce((n,a)=>n+a.permissionBytes,0),scale=manifest.copies;
 report.oracle={identityDigest:digest(rows.map(a=>({id:a.id,name:a.name,enabled:a.enabled,roles:a.roles,tokens:a.tokens,constraints:a.constraints}))),agents:rows.length,capabilities:total,permissionCompactBytes:bytes,rosterBodyBytes:roster.bytes,max:Math.max(...perAgent.map(a=>a.capabilities)),configDigest:manifest.configDigest};
 const statisticsOracle=await get('/api/admin/agents/statistics?range=30d',cookie);const window=statisticsOracle.json?.data?.summary;
 report.oracle.audit=JSON.parse(docker(['exec','-i','-e',`P166_WINDOW_START=${window?.windowStart??''}`,'-e',`P166_WINDOW_END=${window?.windowEnd??''}`,name,'node','--input-type=module'],{input:readFileSync(join(root,'scripts/uat/agent-roster-summary-audit-oracle.mjs'),'utf8')}));
 check(report.oracle.audit.shape.rows===manifest.auditRows,'audit history floor / exact seed count');
 check(report.oracle.audit.sourceAssociationErrors===0&&report.oracle.audit.credentialAssociationErrors===0,'real source and credential audit associations');
 check(report.oracle.audit.window?.rows===manifest.windowRows&&report.oracle.audit.window?.businessRows===180000*scale,'independent actual statistics window and raw id ceiling');check(statisticsOracle.json?.data?.summary?.usageCallsLast7d===report.oracle.audit.window?.businessRows,'statistics equals independent raw business oracle');
 check(rows.length===71*scale,'Agent count');check(perAgent.every(a=>a.capabilities>0),'all Agents compile');check(total===manifest.capabilities,'compiler manifest capabilities');
 if(manifest.width==='H'){check(total>=13815*scale,'capability floor');check(bytes>=4740771*scale,'permission byte floor');}
 const widest=perAgent.toSorted((a,b)=>b.capabilities-a.capabilities)[0]?.id;report.oracle.widest=widest;
 const summary=await get('/api/admin/agents?view=roster&projection=summary&range=30d',cookie);
 if(candidate==='b'){
  check(summary.json?.data?.meta?.projectionVersion===1,'native projection');report.oracle.summaryBodyBytes=summary.bytes;report.oracle.bodyRatio=summary.bytes/roster.bytes;
  check(summary.bytes<=256*1024*scale,'summary bytes');check(summary.bytes/roster.bytes<=.2,'summary ratio');
  for(const a of summary.json?.data?.agents??[]){const p=perAgent.find(x=>x.id===a.id);check(['tokens','effectivePermissions','allow','constraints','stats'].every(k=>!Object.hasOwn(a,k)),`summary whitelist ${a.id}`);for(const [key,field] of [['capabilityCount','capabilities'],['sourceCount','sources'],['connectionCount','connections'],['toolCount','tools']])check(a.permissionSummary[key]===p?.[field],`independent count ${a.id}.${key}`);}
  const stats=statisticsOracle;check(stats.status===200,'stats HTTP');check(stats.json?.data?.meta?.snapshotVersion===summary.json?.data?.meta?.snapshotVersion,'summary/stats version join');check(roster.json?.data?.meta?.snapshotVersion===summary.json?.data?.meta?.snapshotVersion,'old roster version join');
  docker(['exec',name,'curl','-s','--unix-socket','/tmp/p166-control.sock','http://localhost/reset']);
  await get('/api/admin/agents?view=roster&projection=summary&range=30d',cookie);await get('/api/admin/agents/statistics?range=30d',cookie);
  report.diagnostics.hot=JSON.parse(docker(['exec',name,'curl','-s','--unix-socket','/tmp/p166-control.sock','http://localhost/snapshot']));
  check(report.diagnostics.hot.counters?.fullParses===0,'hot summary + statistics full parse=0');
 }
 const groups={roster:'/api/admin/agents?view=roster',full:'/api/admin/agents',statistics:'/api/admin/agents/statistics?range=30d',detail:`/api/admin/agents/${widest}?range=7d`,...(candidate==='b'?{summary:'/api/admin/agents?view=roster&projection=summary&range=30d'}:{})};
 if(!process.env.P166_ORACLE_ONLY)for(const [kind,url] of Object.entries(groups))for(let n=0;n<30;n++){
  try{const r=await get(url,cookie);report.samples.push({kind,n,at:new Date().toISOString(),status:r.status,ms:r.ms,ttfbMs:r.ttfbMs,downloadMs:r.downloadMs,serverTiming:r.serverTiming,bytes:r.bytes});check(r.status===200&&r.json?.ok===true,`${kind}[${n}] successful JSON envelope (${r.status})`);if(kind==='full')check(Array.isArray(r.json?.data?.agents)&&r.json.data.agents.length===71*scale,`full[${n}] complete Agent array`);if(kind==='roster'||kind==='summary')check(r.json?.data?.agents?.length===71*scale,`${kind}[${n}] Agent count`);if(kind==='detail')check(r.json?.data?.agent?.id===widest&&Array.isArray(r.json.data.agent.tokens)&&Array.isArray(r.json.data.agent.effectivePermissions?.capabilities),`detail[${n}] complete single Agent`);}catch(e){report.samples.push({kind,n,error:String(e)});report.failures.push(`${kind}[${n}] ${e}`);}save(join(folder,'api.json'),report);
 }
 if(!process.env.P166_ORACLE_ONLY&&!process.env.P166_SKIP_COLD)for(let n=0;n<5;n++){
  await waitSnapshotIdle();control('/cold');
  try{const r=await get(candidate==='b'?groups.summary:groups.roster,cookie);report.samples.push({kind:'cold-snapshot',n,status:r.status,ms:r.ms,bytes:r.bytes});check(r.status===200,`cold snapshot[${n}] status`);if(candidate==='b')check(r.ms<=(scale===1?1000:scale===2?2000:3000),`cold snapshot[${n}] budget`);}catch(e){report.failures.push(`cold snapshot[${n}] ${e}`);report.samples.push({kind:'cold-snapshot',n,error:String(e)});}
  report.samples.at(-1).recovery=await waitSnapshotIdle();save(join(folder,'api.json'),report);
 }
 report.p95=Object.fromEntries(Object.keys(groups).map(kind=>{const values=report.samples.filter(x=>x.kind===kind&&x.ms!==undefined).map(x=>x.ms).sort((a,b)=>a-b);return [kind,values[Math.ceil(values.length*.95)-1]??null];}));
 if(candidate==='b'&&!process.env.P166_ORACLE_ONLY)check(report.p95.summary<=(scale===1?200:scale===2?300:500),'warm summary p95');
 report.diagnostics.resourcesEnd=resources();save(join(folder,'api.json'),report);console.log(JSON.stringify({fixture,candidate,oracle:report.oracle,p95:report.p95,failures:report.failures}));
}else throw Error('mode must be database/start/api');
