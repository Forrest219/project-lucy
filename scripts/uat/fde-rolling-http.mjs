/** P1-57 FIX-05: full entrypoint, default maintainer/read-time modes, real clock and authenticated HTTP. */
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const BASE='http://127.0.0.1:55457',ORIGINAL='lucy-uat-p157',READ='lucy-uat-p157-readtime';
const OUT=path.resolve('inbox/uat-p157-20261119/rolling-http');fs.mkdirSync(OUT,{recursive:true});
const docker=a=>execFileSync('docker',a,{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const info=JSON.parse(docker(['inspect',ORIGINAL]))[0];
const loginPath=fs.readFileSync('inbox/uat-p157-20261119/private-login-path.txt','utf8').trim();
const credentials=JSON.parse(fs.readFileSync(path.join(path.dirname(loginPath),'login.json'),'utf8'));
let name=ORIGINAL,cookie='';const users=[],results=[];let replacement=false;
async function api(route,body){const r=await fetch(BASE+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});const json=await r.json();return{status:r.status,json,headers:r.headers};}
async function ready(){for(let i=0;i<150;i++){try{const r=await api('/api/readyz');if(r.status===200){if(r.json.data.gitSha!=='ff8e9c0523e0263629898cc618109152a85848bb'||r.json.data.gitDirty!==false)throw Error('wrong candidate');return}}catch(e){if(e.message==='wrong candidate')throw e}await pause(1000)}throw Error('not ready')}
async function login(){const r=await api('/api/auth/login',credentials);cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');if(r.status!==200||!cookie)throw Error('login failed')}
function sql(body,readonly=false){const code=`const D=require('/app/webui/node_modules/better-sqlite3');const d=new D('/data/lucy/.ktx-ui/audit.sqlite',{readonly:${readonly}});${body};d.close();`;return JSON.parse(docker(['exec',name,'node','-e',code]).trim().split('\n').pop())}
function state(user){return sql(`const user=${JSON.stringify(user)};console.log(JSON.stringify({raw:d.prepare('SELECT id,ts FROM access_log WHERE user_id=? ORDER BY id').all(user),turns:d.prepare('SELECT * FROM inferred_turns WHERE user_id=?').all(user),links:d.prepare('SELECT l.* FROM inferred_turn_access_logs l JOIN access_log a ON a.id=l.access_log_id WHERE a.user_id=? ORDER BY a.id').all(user),state:d.prepare('SELECT * FROM inferred_rebuild_state WHERE user_id=?').get(user)}))`,true)}
async function settled(user,id){for(let i=0;i<40;i++){const s=state(user);if(s.state?.status==='complete'&&Number(s.state.watermark)>=id)return s;await pause(500)}throw Error('maintainer did not settle')}
function clean(user){sql(`const user=${JSON.stringify(user)};d.transaction(()=>{d.prepare('DELETE FROM inferred_turn_access_logs WHERE access_log_id IN (SELECT id FROM access_log WHERE user_id=?)').run(user);d.prepare('DELETE FROM inferred_turns WHERE user_id=?').run(user);d.prepare('DELETE FROM inferred_rebuild_state WHERE user_id=?').run(user);d.prepare('DELETE FROM access_log WHERE user_id=?').run(user)})();console.log('{}')`)}
async function phase(mode){
 const user='uat-p157-rolling-'+mode+'-'+Date.now();users.push({user,container:name});
 const t0=Date.now(),firstTs=t0-30*86400000+30000,secondTs=t0-30*86400000+90000;
 const ids=sql(`const user=${JSON.stringify(user)};const ins=d.prepare('INSERT INTO access_log(ts,user_id,tool,tables,lucy_session_id,outcome,duration_ms,request_id) VALUES (?,?,?,?,?,?,1,?)');const ids=d.transaction(()=>[${firstTs},${secondTs}].map((t,i)=>Number(ins.run(new Date(t).toISOString(),user,'lucy_query',JSON.stringify(['t1']),'boundary','success',user+'-'+i).lastInsertRowid)))();console.log(JSON.stringify(ids))`);
 const route='/api/admin/audit/turns?hours=2160&source=all&user='+encodeURIComponent(user);
 let trigger;if(mode==='readtime'){trigger=await api(route);if(trigger.status!==200)throw Error('initial read-time HTTP failed')}
 const before=await settled(user,ids[1]);if(before.turns.length!==1||before.turns[0].call_count!==2)throw Error('initial two-call inquiry not formed');
 await pause(35000);
 const third=sql(`const id=Number(d.prepare('INSERT INTO access_log(ts,user_id,tool,tables,lucy_session_id,outcome,duration_ms,request_id) VALUES (?,?,?,?,?,?,1,?)').run(new Date().toISOString(),${JSON.stringify(user)},'lucy_query',JSON.stringify(['t1']),'fresh','success',${JSON.stringify(user+'-fresh')}).lastInsertRowid);console.log(JSON.stringify(id))`);
 if(mode==='readtime'){trigger=await api(route);if(trigger.status!==200)throw Error('read-time HTTP failed')}
 const after=await settled(user,third),links=after.links.filter(r=>r.access_log_id===ids[1]),old=before.turns[0];
 const detail=await api('/api/admin/audit/turns/'+old.inferred_turn_id+'?hours=2160');
 const calls=await api('/api/admin/audit?user='+encodeURIComponent(user)+'&since='+encodeURIComponent(new Date(t0-31*86400000).toISOString())+'&includeAuthFailures=0');
 const shown=calls.json?.data?.entries?.find(r=>r.id===ids[1]);
 const retained=after.turns.find(r=>r.inferred_turn_id===old.inferred_turn_id);
 const pass=after.raw.length===3&&links.length===1&&links[0].inferred_turn_id===old.inferred_turn_id&&retained?.inquiry_no===old.inquiry_no&&detail.status===200&&detail.json.data.inquiryNo===old.inquiry_no&&detail.json.data.accessLogs.some(r=>r.id===ids[1])&&calls.status===200&&shown?.inquiryNo===old.inquiry_no&&shown?.inferredTurnId===old.inferred_turn_id&&Date.now()-30*86400000>firstTs&&Date.now()-30*86400000<secondTs;
 const result={mode,pass,user,elapsedMs:Date.now()-t0,realWaitMs:35000,lookbackHours:720,noClockChange:true,ids:[...ids,third],before:{turnId:old.inferred_turn_id,inquiryNo:old.inquiry_no,calls:old.call_count},after:{raw:after.raw.length,linksForSecond:links.length,turnId:retained?.inferred_turn_id,inquiryNo:retained?.inquiry_no,state:after.state},detailStatus:detail.status,callsStatus:calls.status,shown,triggerStatus:trigger?.status};
 results.push(result);fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({mode,pass,elapsedMs:result.elapsedMs,detailStatus:detail.status,callsStatus:calls.status}));
 if(!pass)throw Error('full-system rolling assertions failed');clean(user);
}
try{
 await ready();await login();await phase('maintainer');
 docker(['stop','-t','30',ORIGINAL]);
 const secret=info.Mounts.find(m=>m.Destination==='/run/secrets/webui_bootstrap_token').Source.replace(/^\/host_mnt/,'');
 const volume=info.Mounts.find(m=>m.Destination==='/data/lucy').Name;
 const env=info.Config.Env.filter(v=>!v.startsWith('LUCY_TURN_REBUILD_ON_READ=')).concat('LUCY_TURN_REBUILD_ON_READ=1','LUCY_REBUILD_TRACE=1');
 docker(['run','-d','--name',READ,'--network','compose_default','-p','55457:5174','-p','58057:7879','-v',volume+':/data/lucy','-v',secret+':/run/secrets/webui_bootstrap_token:ro',...env.flatMap(v=>['-e',v]),'project-lucy:p157-ff8e9c05']);replacement=true;name=READ;cookie='';
 await ready();await login();await phase('readtime');
}finally{
 for(const item of users)if(item.container===name)try{clean(item.user)}catch{}
 if(replacement){try{fs.writeFileSync(path.join(OUT,'readtime-container.log'),docker(['logs',READ]))}catch{}docker(['stop','-t','30',READ]);docker(['rm',READ]);}
 try{docker(['start',ORIGINAL])}catch{}name=ORIGINAL;cookie='';await ready();
}
process.exitCode=results.length===2&&results.every(r=>r.pass)?0:1;
