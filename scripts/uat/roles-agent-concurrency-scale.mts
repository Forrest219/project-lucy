/** RACS module UAT: real HTTP/SQLite, open arrivals, no automatic write replay. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { parse as parseYaml } from "../../webui/node_modules/yaml/dist/index.js";

const args = process.argv.slice(2);
const option = (key: string, fallback: string) => args[args.indexOf(`--${key}`) + 1] && args.includes(`--${key}`)
  ? args[args.indexOf(`--${key}`) + 1]! : fallback;
const selector = option("selector", "probe");
const web = process.env.RACS_WEB ?? "http://127.0.0.1:55276";
if (!['127.0.0.1', 'localhost'].includes(new URL(web).hostname)) throw new Error("local isolated UAT only");
const container = process.env.RACS_CONTAINER ?? "";
if (container && !container.startsWith("lucy-racs-")) throw new Error("task container required");
const secret = process.env.RACS_SECRET_DIR;
if (!secret?.startsWith("/private/tmp/")) throw new Error("private fixture credentials required");
const out = path.resolve(option("out", "inbox/p1-58-59-finalization-20261120/api-probe.json"));
if (!out.includes("p1-58-59-finalization-20261120")) throw new Error("task-owned output required");
await mkdir(path.dirname(out), { recursive: true });
const credential = JSON.parse(await readFile(path.join(secret, "login.json"), "utf8"));
const records: Array<Record<string, unknown>> = [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(id: string, condition: unknown, detail: unknown = {}) {
  records.push({ id, verdict: condition ? "PASS" : "FAIL", detail });
  if (!condition) throw new Error(`assertion failed: ${id}: ${JSON.stringify(detail).slice(0, 300)}`);
}
async function api(route: string, cookie = "", method = "GET", body?: unknown) {
  const started = performance.now();
  const response = await fetch(web + route, { method, signal: AbortSignal.timeout(10000),
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = await response.json();
  return { status: response.status, data: json.data, error: json.error, ms: performance.now() - started,
    timing: response.headers.get("server-timing"), headers: response.headers };
}
async function login(adminId = credential.adminId) {
  let response:any;
  for(let attempt=0;attempt<5;attempt++){
    response=await api("/api/auth/login", "", "POST", { adminId, password: credential.password });
    if(response.status!==429)break;
    const waitMs=Math.min(60000,Math.max(1000,Number(response.headers.get('retry-after')??60)*1000));
    records.push({id:'R0-login-rate-limit-preparation',adminId,waitMs});await sleep(waitMs);
  }
  assert("R0-login", response.status === 200, { adminId, status: response.status });
  return response.headers.getSetCookie().map((cookie:string) => cookie.split(";")[0]).join("; ");
}
function sql(query: string, binds: unknown[] = []) {
  const program = `import Database from '/app/webui/node_modules/better-sqlite3/lib/index.js';
    const db=new Database('/data/lucy/.ktx-ui/audit.sqlite',{readonly:true});
    console.log(JSON.stringify(db.prepare(${JSON.stringify(query)}).all(...${JSON.stringify(binds)})));db.close();`;
  return JSON.parse(execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module"], { input: program, maxBuffer: 32 * 1024 * 1024 }).toString());
}
async function oracle(cookie: string) {
  const scale=Number(option('scale','1'));
  const fixture=path.resolve(`inbox/p1-58-59-finalization-20261120/fixture-${scale===1?'b':`d${scale}`}/project`);
  const expectedConfig=parseYaml(await readFile(path.join(fixture,'webui/config/access.yaml'),'utf8'));
  const protocolNames = new Set(["initialize","notifications/initialized","tools/list","ping","resources/list","resources/templates/list","prompts/list","notifications/cancelled","server/discover"]);
  function classify(row:any){
    const protocol=protocolNames.has(row.tool)||String(row.tool).startsWith('server/');
    let args:any={};try{args=JSON.parse(row.args_summary??'{}')}catch{}
    const probe=!protocol&&row.eval_mark===1&&Object.entries(args??{}).some(([key,value])=>/connection|source|table|database|schema/i.test(key)&&typeof value==='string'&&/probe-|rds-test|demo-mysql/i.test(value));
    return{protocol,probe};
  }
  const history=sql('SELECT user_id,tool,eval_mark,args_summary,MAX(ts) latest FROM access_log GROUP BY user_id,tool,eval_mark,args_summary');
  const latestByUser=new Map<string,any>();
  for(const row of history){const c=classify(row),value=latestByUser.get(row.user_id)??{};if(!value.lastSeen||row.latest>value.lastSeen)value.lastSeen=row.latest;if(!c.protocol&&!c.probe&&(!value.lastBusinessSeen||row.latest>value.lastBusinessSeen))value.lastBusinessSeen=row.latest;latestByUser.set(row.user_id,value);}
  const latestTokens=sql(`WITH newest AS (SELECT user_id,token_hash_prefix,MAX(ts) ts FROM access_log WHERE token_hash_prefix IS NOT NULL GROUP BY user_id,token_hash_prefix)
    SELECT a.user_id,a.token_hash_prefix,a.ts,a.tool,a.outcome,a.client_ip FROM newest n JOIN access_log a ON a.id=(SELECT MAX(id) FROM access_log WHERE user_id=n.user_id AND token_hash_prefix=n.token_hash_prefix AND ts=n.ts)`);
  const tokenByKey=new Map(latestTokens.map((row:any)=>[row.user_id+'|'+row.token_hash_prefix,row]));
  const roleResponse=await api('/api/admin/roles',cookie);
  const badRoles=roleResponse.data?.roles?.filter((role:any)=>role.id.startsWith('racs_r')).filter((role:any)=>{
    const configured=expectedConfig.roles[role.id];return role.invalid||role.sourceCount!==configured.allow.tableSelectors[0].names.length||JSON.stringify([...role.sourceNames].sort())!==JSON.stringify(configured.allow.tableSelectors[0].names.flatMap((name:string)=>["racs."+name,name]).sort());
  });
  assert('01-literal-role-permission-oracle',roleResponse.status===200&&badRoles?.length===0,{checked:20*scale,failures:badRoles?.map((role:any)=>role.id)});

  for (const range of ["7d", "14d", "30d"]) {
    const response = await api(`/api/admin/agents?range=${range}`, cookie);
    assert(`01-${range}-HTTP`, response.status === 200, { status: response.status });
    const { windowStart, windowEnd } = response.data.summary;
    const buckets = sql(`SELECT user_id,tool,eval_mark,args_summary,outcome,token_hash_prefix,tables,COUNT(*) n
      FROM access_log WHERE ts>=? AND ts<? GROUP BY user_id,tool,eval_mark,args_summary,outcome,token_hash_prefix,tables`, [windowStart, windowEnd]);
    const expected = new Map<string, any>();
    const empty=()=>({calls:0,business:0,protocol:0,usage:0,probes:0,denied:0,tokens:new Set<string>(),tables:new Map<string,number>()});

    for (const row of buckets) {
      const counts = expected.get(row.user_id) ?? empty();
      const {protocol,probe}=classify(row);
      if(!protocol&&row.tables){try{for(const table of JSON.parse(row.tables))counts.tables.set(table,(counts.tables.get(table)??0)+row.n)}catch{}}
      counts.calls += row.n;
      if (protocol) counts.protocol += row.n;
      else { counts.business += row.n; if (probe) counts.probes += row.n; else { counts.usage += row.n; if(row.outcome==='denied') counts.denied+=row.n; } }
      if (row.token_hash_prefix !== null) counts.tokens.add(row.token_hash_prefix);
      expected.set(row.user_id,counts);
    }
    const failures: unknown[] = [];
    const ipRows=sql('SELECT user_id,token_hash_prefix,COUNT(DISTINCT client_ip) n FROM access_log WHERE ts>=? AND client_ip IS NOT NULL GROUP BY user_id,token_hash_prefix',[new Date(Date.parse(windowEnd)-7*86400000).toISOString()]);
    const ips=new Map(ipRows.map((row:any)=>[row.user_id+'|'+row.token_hash_prefix,row.n]));
    const globalPrefixes=new Set(buckets.map((row:any)=>row.token_hash_prefix).filter((value:any)=>value!==null));
    if(response.data.summary.activeTokenCountLast7d!==globalPrefixes.size)failures.push({key:'global-active-credentials'});
    if(response.data.summary.usedCredentialState!=='partial'||response.data.summary.usedCredentialCountLast7d!==null)failures.push({key:'global-collision-honesty'});

    if(response.data.agents.length!==100*scale||new Set(response.data.agents.map((agent:any)=>agent.id)).size!==100*scale)failures.push({key:"complete-Agent-membership"});
    for (const agent of response.data.agents) {
      const configured=expectedConfig.users.find((user:any)=>user.id===agent.id);
      const c = expected.get(agent.id) ?? empty();
      const wanted = { callsLast7d:c.calls,businessCallsLast7d:c.business,protocolCallsLast7d:c.protocol,
        usageCallsLast7d:c.usage,evalProbeCallsLast7d:c.probes,deniedLast7d:c.denied,activeTokensLast7d:c.tokens.size,usedCredentialsLast7d:c.tokens.size,
        configuredTokens:3,availableTokens:configured?.enabled===false?0:agent.id==='racs_a2'?2:3 };
      for (const [key,value] of Object.entries(wanted)) if(agent.stats[key]!==value) failures.push({id:agent.id,key,wanted:value,actual:agent.stats[key]});
      const latest=latestByUser.get(agent.id)??{};
      for(const key of['lastSeen','lastBusinessSeen'])if(agent.stats[key]!==latest[key])failures.push({id:agent.id,key});
      const top=[...c.tables].sort((a:any,b:any)=>b[1]-a[1]).slice(0,3).map(([table,calls]:any)=>({table,calls}));
      if(JSON.stringify(agent.stats.topTables)!==JSON.stringify(top))failures.push({id:agent.id,key:'topTables'});
      if(!configured||agent.tokens.length!==3)failures.push({id:agent.id,key:'configured-credential-membership'});
      for(const token of agent.tokens){const source=configured?.tokens.find((item:any)=>item.label===token.label);if(!source||source.hash!==token.hash){failures.push({id:agent.id,key:'credential-identity'});continue;}
        const key=agent.id+'|'+source.hash.slice(0,19),latestToken:any=tokenByKey.get(key);
        if(token.last_used!==latestToken?.ts||token.last_tool!==latestToken?.tool||token.last_outcome!==latestToken?.outcome||(token.last_ip??null)!==(latestToken?.client_ip??null)||(token.distinct_ips_7d??0)!==(ips.get(key)??0))failures.push({id:agent.id,key:'latest-credential-and-IP',label:token.label});
      }
      const expectedSources=configured?.roles.flatMap((id:string)=>expectedConfig.roles[id].allow.tableSelectors.flatMap((selector:any)=>selector.names.map((name:string)=>'racs.'+name))).sort();
      if(agent.enabled!==(configured?.enabled!==false))failures.push({id:agent.id,key:'enabled-state'});
      if(configured?.enabled===false){if((agent.effectivePermissions?.sources?.length??0)!==0)failures.push({id:agent.id,key:'disabled-Agent-fail-closed'});}
      else if(JSON.stringify(agent.effectivePermissions?.sources.map((source:any)=>source.table).sort())!==JSON.stringify(expectedSources))failures.push({id:agent.id,key:'literal-Agent-permissions'});

    }
    assert(`01-${range}-independent-oracle`, failures.length === 0, { checkedAgents:response.data.agents.length,failures:failures.slice(0,10),windowStart,windowEnd });
  }
}
async function preview(kind: "role"|"agent", id: string, patch: unknown, cookie: string) {
  const route=`/api/admin/${kind}s/${id}`;
  const detail=await api(route,cookie);
  assert("F59-baseline",detail.status===200,{kind,id,status:detail.status});
  const response=await api(route,cookie,"PATCH",{dryRun:true,baseObjectVersion:detail.data.baseObjectVersion,patch});
  assert("F59-preview",response.status===200&&response.data.previewToken,{kind,id,status:response.status,error:response.error});
  return {dryRun:false,baseObjectVersion:response.data.baseObjectVersion,previewToken:response.data.previewToken,operationId:randomUUID(),patch};
}
async function save(kind: "role"|"agent", id: string, body: unknown, cookie: string) { return api(`/api/admin/${kind}s/${id}`,cookie,"PATCH",body); }
async function confirm(kind:"role"|"agent",id:string,patch:unknown,cookie:string) {
  const body=await preview(kind,id,patch,cookie);
  const response=await save(kind,id,body,cookie);
  assert("F59-confirmed",response.status===200,{kind,id,status:response.status,error:response.error});
  const status=await api(`/api/admin/access-write-status/${body.operationId}`,cookie);
  assert("F59-bound-receipt",status.data?.outcome==='committed'&&status.data.committedObjectVersion!==body.baseObjectVersion,
    {operationId:body.operationId,outcome:status.data?.outcome});
  return { body, response, status };
}
async function f59(cookie:string) {
  const same=await login();
  const other=await login('racs_operator');
  const pairs=Number(option("pairs",selector==='F59'?'100':'1'));
  for (const [identity,second] of [['same-account',same],['different-account',other]]) {
    for(const category of ['role-role','agent-agent','role-agent']) {
      const kinds=category.split('-') as ['role'|'agent','role'|'agent'];
      const ids=kinds.map((kind,i)=>kind==='role'?`racs_r${i+2}`:`racs_a${i+3}`);
      for(let i=0;i<pairs;i++) {
        const stamp=`${identity}-${category}-${i}`;
        const patches=kinds.map((kind,j)=>kind==='role'?{description:`${stamp}-${j}`}:{note:`${stamp}-${j}`});
        const bodies=await Promise.all(kinds.map((kind,j)=>preview(kind,ids[j]!,patches[j],j?second:cookie)));
        const results=await Promise.all(kinds.map((kind,j)=>save(kind,ids[j]!,bodies[j],j?second:cookie)));
        for(let j=0;j<2;j++) {
          if(results[j]!.status===503) { // a separate, explicit user recovery step
            assert('09-BUSY-feedback-budget',results[j]!.ms<=1000,{identity,category,pair:i,ms:results[j]!.ms});
            records.push({id:'09-explicit-BUSY-recovery',identity,category,pair:i,ms:results[j]!.ms});
            await sleep(1000); await confirm(kinds[j]!,ids[j]!,patches[j],j?second:cookie);
          } else assert('09-no-false-object-conflict',results[j]!.status===200,{identity,category,pair:i,status:results[j]!.status,error:results[j]!.error});
        }
        for(let j=0;j<2;j++) {
          const fresh=await api(`/api/admin/${kinds[j]}s/${ids[j]}`,cookie);
          const object=kinds[j]==='role'?fresh.data.role:fresh.data.agent;
          const field=kinds[j]==='role'?'description':'note';
          assert('09-both-values-retained',object[field]===`${stamp}-${j}`,{identity,category,pair:i,target:ids[j]});
        }
      }
      console.log(JSON.stringify({selector:'F59',identity,category,pairs,completed:true}));
    }
    for(const kind of ['role','agent'] as const) for(let i=0;i<pairs;i++) {
      const id=kind==='role'?'racs_r4':'racs_a5';
      const current=await api(`/api/admin/${kind}s/${id}`,cookie);
      const leftPatch=kind==='role' ? {allow:{...current.data.role.allow,tools:["lucy_catalog","lucy_query","lucy_begin_question"]},description:`left-${identity}-${i}`}
        : {roles:["racs_r6"],note:`left-${identity}-${i}`};
      const rightPatch=kind==='role' ? {allow:{...current.data.role.allow,tools:["lucy_catalog","lucy_query","lucy_freshness"]},description:`right-${identity}-${i}`}
        : {roles:["racs_r7"],note:`right-${identity}-${i}`};
      const left=await preview(kind,id,leftPatch,cookie);
      const right=await preview(kind,id,rightPatch,second);
      const winner=await save(kind,id,left,cookie);
      const conflict=await save(kind,id,right,second);
      assert('10-same-object-conflict',winner.status===200&&conflict.status===409,{identity,kind,pair:i,status:[winner.status,conflict.status],conflictMs:conflict.ms});
      assert('10-conflict-feedback-budget',conflict.ms<=1000,{identity,kind,ms:conflict.ms});
      await confirm(kind,id,right.patch,second);
      if((i+1)%10===0) console.log(JSON.stringify({selector:"F59",identity,kind,sameTarget:true,completed:i+1,pairs}));
    }
  }
}
async function f58(cookie:string) {
  if(container && !args.includes('--skip-oracle')) await oracle(cookie);
  const mode=option('identity','same');
  const cookies=[cookie];
  for(let i=1;i<5;i++) cookies.push(await login(mode==='same'?credential.adminId:`racs_operator${i===1?'':i}`));
  const phases=selector==='F58'?[['warm',120],['ramp',60],['steady',600],['recover',120]] as const:[['probe',30]] as const;
  const rounds=selector==='F58'?3:1;
  const samples: Array<{route:string;round:number;phase:string;status:number;ms:number;ok:boolean;timing:string|null}> = [];
  for(let round=0;round<rounds;round++) for(const [phase,seconds] of phases) {
    const started=performance.now();const pending:Promise<void>[]=[];
    const count=phase==='ramp'||phase==='recover'?Math.round(seconds*1.25):seconds*2;
    for(let i=0;i<count;i++) {
      await sleep(Math.max(0,started+(phase==='ramp'?seconds*(Math.sqrt(.25+3*i/seconds)-.5)/1.5*1000:phase==='recover'?seconds*(2-Math.sqrt(4-3*i/seconds))/1.5*1000:i*500)-performance.now()));
      const bucket=i%8;const range=['7d','7d','14d','30d'][Math.floor(i/8)%4];
      const route=bucket<4?'/api/admin/roles':bucket<6?`/api/admin/agents?range=${range}`:bucket===6?'/api/admin/agents?view=roster':`/api/admin/agents/statistics?range=${range}`;
      const actualRoute=args.includes("--baseline") && route.startsWith("/api/admin/agents") ? `/api/admin/agents?range=${range}` : route;
      pending.push(api(actualRoute,cookies[i%cookies.length]).then(r=>{samples.push({route,round,phase,status:r.status,ms:r.ms,ok:r.status===200&&Boolean(r.data?.roles||r.data?.agents),timing:r.timing});}).catch(()=>{samples.push({route,round,phase,status:0,ms:10000,ok:false,timing:null});}));
    }
    await Promise.all(pending);
    await writeFile(out+'.samples.json',JSON.stringify(samples));
    console.log(JSON.stringify({selector,mode,round,phase,completed:samples.length,failed:samples.filter(s=>!s.ok).length}));
    assert('03-valid-arrivals',samples.filter(s=>s.round===round&&s.phase===phase).length===count,{round,phase,count});
  }
  const scale=Number(option('scale','1'));
  for(let round=0;round<rounds;round++) for(const route of new Set(samples.map(s=>s.route))) {
    const values=samples.filter(s=>s.round===round&&s.route===route&&(selector!=='F58'||s.phase==='steady'));
    assert('03-valid-reads',values.every(s=>s.ok),{route,failures:values.filter(s=>!s.ok).slice(0,10)});
    const sorted=values.map(s=>s.ms).sort((a,b)=>a-b);const p95=sorted[Math.ceil(sorted.length*.95)-1];
    const budget=route.includes('view=roster')||route==='/api/admin/roles'?{1:200,2:300,5:500}[scale]:{1:200,2:500,5:1000}[scale];
    assert('03-absolute-p95',p95!==undefined&&budget!==undefined&&p95<=budget,{route,round,n:values.length,p95,budget,scale});
  }
}
let failure:unknown;
try {
  let ready:any;const prepStart=performance.now();let readyAttempts=0;
  while(performance.now()-prepStart<180000){readyAttempts++;try{ready=await api('/api/readyz');if(ready.status===200)break;}catch{}await sleep(1000);}
  assert('R0-ready',ready?.status===200,{status:ready?.status,waitMs:performance.now()-prepStart,readyAttempts});
  const health=await api('/api/health');assert('R0-health',health.status===200,{gitSha:health.data?.gitSha,gitDirty:health.data?.gitDirty});
  const cookie=await login();
  if(selector==='F59') await f59(cookie);
  else if(selector==='F58'||selector==='read-probe') await f58(cookie);
  else { await oracle(cookie);await f59(cookie); }
} catch(error) {failure=String(error);console.error(failure);}
await writeFile(out,JSON.stringify({selector,at:new Date().toISOString(),web,container,verdict:failure?'FAIL':'PASS',failure,records},null,2));
if(failure) process.exitCode=1;
