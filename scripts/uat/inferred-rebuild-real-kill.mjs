/** Real SIGKILL UAT: synthetic isolated volume; no artificial in_progress fallback. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);const opt=k=>{const i=args.indexOf('--'+k);return i<0?undefined:args[i+1]};
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const image=opt('image')??'project-lucy:demo',name='lucy-uat-p157-irr-kill',volume='lucy-uat-p157-irr-kill-data';
const out=opt('out')??path.join(ROOT,'inbox/uat-inferred-rebuild-real-kill');mkdirSync(out,{recursive:true});
const docker=a=>execFileSync('docker',a,{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const user='000-uat-p157-kill',n=20000;
const seed=`const D=require('/app/webui/node_modules/better-sqlite3');const d=new D('/data/lucy/.ktx-ui/audit.sqlite');
const user=${JSON.stringify(user)},n=${n};
const ins=d.prepare("INSERT INTO access_log(ts,user_id,tool,tables,lucy_session_id,args_summary,outcome,duration_ms,request_id) VALUES (?,?,?,?,?,?,?,1,?)");
const base=Date.now()-7200000;d.transaction(()=>{for(let i=0;i<n;i++)ins.run(new Date(base+i).toISOString(),user,'lucy_query',JSON.stringify(['t1']),'p157-session-'+i,JSON.stringify({uatPad:'x'.repeat(1000)}),'success','p157-real-kill-'+i)})();
console.log(JSON.stringify({rows:n,user}));d.close();`;
const stateCode=`const D=require('/app/webui/node_modules/better-sqlite3');const d=new D('/data/lucy/.ktx-ui/audit.sqlite',{readonly:true});
const user=${JSON.stringify(user)};console.log(JSON.stringify({state:d.prepare('SELECT * FROM inferred_rebuild_state WHERE user_id=?').get(user),raw:d.prepare('SELECT COUNT(*) n FROM access_log WHERE user_id=?').get(user).n,turns:d.prepare('SELECT COUNT(*) n FROM inferred_turns WHERE user_id=?').get(user).n,links:d.prepare('SELECT COUNT(*) n FROM inferred_turn_access_logs l JOIN access_log a ON a.id=l.access_log_id WHERE a.user_id=?').get(user).n,missingTurns:d.prepare('SELECT COUNT(*) n FROM inferred_turn_access_logs l JOIN access_log a ON a.id=l.access_log_id LEFT JOIN inferred_turns t ON t.inferred_turn_id=l.inferred_turn_id WHERE a.user_id=? AND t.inferred_turn_id IS NULL').get(user).n,duplicates:d.prepare('SELECT COUNT(*) n FROM (SELECT l.access_log_id FROM inferred_turn_access_logs l JOIN access_log a ON a.id=l.access_log_id WHERE a.user_id=? GROUP BY l.access_log_id HAVING COUNT(*)<>1)').get(user).n}));d.close();`;
const state=()=>JSON.parse(docker(['exec',name,'node','-e',stateCode]).trim().split('\n').pop());
const rm=()=>{try{docker(['rm','-f',name])}catch{}};
rm();try{docker(['volume','rm',volume])}catch{}docker(['volume','create',volume]);
docker(['run','--rm','-v','lucy-uat-irr-data:/from:ro','-v',volume+':/to','alpine:latest','sh','-c','cp -a /from/. /to/']);
docker(['run','--rm','--entrypoint','node','-v',volume+':/data/lucy',image,'-e',seed]);
const secret=path.join(os.tmpdir(),'lucy-uat-irr-secrets/bootstrap-token');
const env={KTX_PROJECT_ROOT:'/data/lucy',LUCY_CONTENT_ROOT:'/data/lucy/config',LUCY_TEMPLATE_ROOT:'/app/examples/docker-demo/project-template',LUCY_WEBUI_HOST:'0.0.0.0',LUCY_WEBUI_PORT:'5174',LUCY_PROXY_HOST:'0.0.0.0',LUCY_PROXY_PORT:'7879',LUCY_PROXY_UPSTREAM_HOST:'127.0.0.1',LUCY_PROXY_UPSTREAM_PORT:'7878',LUCY_PUBLIC_MCP_URL:'http://127.0.0.1:58059/mcp',LUCY_DEPLOYMENT_MODE:'customer',LUCY_WEBUI_TEST_PROFILE:'1',LUCY_WEBUI_COOKIE_SECURE:'0',LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE:'/run/secrets/webui_bootstrap_token',LUCY_REBUILD_TRACE:'1'};
docker(['run','-d','--name',name,...Object.entries(env).flatMap(([k,v])=>['-e',k+'='+v]),'-p','55459:5174','-p','58059:7879','-v',volume+':/data/lucy','-v',secret+':/run/secrets/webui_bootstrap_token:ro',image]);
const result={image,user,rows:n,killed:false,artificialInProgress:false};
try{
 const deadline=Date.now()+180000;let before;
 while(Date.now()<deadline){try{before=state();if(before.state?.status==='in_progress'&&before.links>0&&before.links<n)break;}catch{}await pause(100)}
 if(!(before?.state?.status==='in_progress'&&before.links>0&&before.links<n))throw Error('could not observe a real partial write; no forced residual allowed');
 result.before=before;docker(['kill','--signal','KILL',name]);result.killed=true;
 const processState=JSON.parse(docker(['inspect',name]))[0].State;result.processExit={exitCode:processState.ExitCode,oomKilled:processState.OOMKilled};
 result.persisted=JSON.parse(docker(['run','--rm','--entrypoint','node','-v',volume+':/data/lucy',image,'-e',stateCode]).trim().split('\n').pop());
 docker(['start',name]);const recoverDeadline=Date.now()+300000;let after;
 while(Date.now()<recoverDeadline){try{after=state();if(after.state?.status==='complete')break;}catch{}await pause(1000)}
 result.after=after;
 const readyDeadline=Date.now()+60000;let readyStatus=0;
 while(Date.now()<readyDeadline){try{readyStatus=(await fetch('http://127.0.0.1:55459/api/readyz',{signal:AbortSignal.timeout(3000)})).status;if(readyStatus===200)break}catch{}await pause(1000)}
 result.readyStatus=readyStatus;result.pass=readyStatus===200&&result.processExit.exitCode===137&&!result.processExit.oomKilled&&result.persisted.state?.status==='in_progress'&&after?.state?.status==='complete'&&after.raw===n&&after.turns===n&&after.links===n&&after.missingTurns===0&&after.duplicates===0;
}catch(e){result.pass=false;result.error=e.message}finally{try{writeFileSync(out+'/container.log',docker(['logs',name]))}catch{}writeFileSync(out+'/summary.json',JSON.stringify(result,null,2));rm();}
console.log(JSON.stringify(result));process.exitCode=result.pass?0:1;
