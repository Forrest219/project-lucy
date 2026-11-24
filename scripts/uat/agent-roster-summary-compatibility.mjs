/** Actual old/new builds, real HTTP and headed Chrome; never substitutes successful bodies. */
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../webui/package.json',import.meta.url)),{chromium,expect}=require('@playwright/test');
const candidate=process.argv[2];assert(['legacy','roster','old-ui'].includes(candidate));
const port={legacy:59168,roster:59167,'old-ui':59167}[candidate],base=`http://127.0.0.1:${port}`;
const out=resolve('inbox/p166-implementation-20261120'),folder=join(out,'results','compatibility-'+candidate);mkdirSync(folder,{recursive:true});
const report={candidate,startedAt:new Date().toISOString(),headed:true,viewport:{width:1920,height:1080},requests:[],cases:[],failures:[]};
let cookie;const save=()=>writeFileSync(join(folder,'compatibility.json'),JSON.stringify(report,null,2));
async function get(path){const t=performance.now(),r=await fetch(base+path,{headers:{cookie},signal:AbortSignal.timeout(10000)});const json=await r.json();return {status:r.status,json,ms:performance.now()-t};}
const auth=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:readFileSync('/private/tmp/lucy-p166-private-20261120/login.json','utf8')});assert.equal(auth.status,200);cookie=auth.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
const browser=await chromium.launch({headless:false,channel:'chrome'}),context=await browser.newContext({viewport:report.viewport});report.browser=browser.version();
await context.addCookies(cookie.split('; ').map(c=>{const [name,...value]=c.split('=');return {name,value:value.join('='),url:base};}));const page=await context.newPage();let phase;
page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))report.requests.push({phase,path:u.pathname+u.search,status:r.status(),method:r.request().method()});});
async function run(name,fn){phase=name;await page.bringToFront();try{await fn();const state=await page.evaluate(()=>({visible:document.visibilityState,focused:document.hasFocus()}));assert.equal(state.visible,'visible');assert(state.focused);report.cases.push({name,status:'PASS',...state});await page.screenshot({path:join(folder,name+'.png')});}catch(e){report.cases.push({name,status:'FAIL',error:String(e)});report.failures.push(name);await page.screenshot({path:join(folder,name+'-failure.png')}).catch(()=>{});}save();}
try{
 await run('01-original-complete-contract',async()=>{
  for(const range of ['7d','14d','30d']){
   const full=await get('/api/admin/agents?range='+range);assert.equal(full.status,200);const rows=full.json.data.agents;assert.equal(rows.length,71);assert(rows.every(a=>a.tokens.length===3&&a.effectivePermissions.capabilities.length>0));assert.equal(full.json.data.summary.range,range);
   const detail=await get('/api/admin/agents/ars_00_a16?range='+range);assert.equal(detail.status,200);const a=rows.find(a=>a.id==='ars_00_a16');for(const key of ['id','name','roles','tokens','constraints','effectivePermissions'])assert.deepEqual(detail.json.data.agent[key],a[key],key);
   const p=await get('/api/admin/agents/ars_00_a16/effective-permissions');assert.equal(p.status,200);assert.deepEqual(p.json.data,a.effectivePermissions);
   report.cases.push({name:'full-and-single-'+range,status:'PASS',agents:rows.length,capabilities:rows.reduce((n,a)=>n+a.effectivePermissions.capabilities.length,0),window:full.json.data.summary});
  }
 });
 await run('02-real-build-navigation-and-current-window',async()=>{
  await page.goto(base+'/admin/agents');await expect(page.getByTestId('agent-row-ars_00_a16')).toBeVisible({timeout:15000});
  for(const range of ['7d','30d']){
   const response=page.waitForResponse(r=>new URL(r.url()).pathname===(candidate==='old-ui'?'/api/admin/agents/statistics':'/api/admin/agents')&&new URL(r.url()).searchParams.get('range')===range,{timeout:15000});await page.getByTestId('agent-stats-range-'+range).click();assert.equal((await response).status(),200);
   await expect(page.getByTestId('agent-statistics-as-of')).toBeVisible({timeout:15000});await expect(page.getByTestId('metric-business-calls-value')).toHaveText(range==='7d'?'90000':'180000',{timeout:15000});
  }
  const refresh=page.waitForResponse(r=>new URL(r.url()).pathname===(candidate==='old-ui'?'/api/admin/agents/statistics':'/api/admin/agents')&&new URL(r.url()).searchParams.get('range')==='30d',{timeout:15000});await page.getByRole('button',{name:'刷新',exact:true}).click();assert.equal((await refresh).status(),200);await expect(page.getByTestId('metric-business-calls-value')).toHaveText('180000');
  if(candidate==='legacy')assert.equal(report.requests.filter(r=>r.phase===phase&&r.path.startsWith('/api/admin/agents/statistics')).length,0,'legacy full must never probe statistics');
  if(candidate==='old-ui')assert(report.requests.some(r=>r.phase===phase&&r.path.includes('view=roster')&&!r.path.includes('projection')),'actual original frontend uses original roster');
 });
 await run('03-drawer-only-selected-id',async()=>{
  await page.getByPlaceholder('搜索显示名或用户 ID').fill('ars_00_a16');const before=report.requests.length;await page.getByTestId('agent-name-link-ars_00_a16').click();await expect(page.getByTestId('object-detail-agent-body')).toContainText('ARS 00 Agent 16',{timeout:15000});await expect(page.getByTestId('object-detail-agent-body')).toContainText('近 7 天');
  if(candidate!=='old-ui'){const reads=report.requests.slice(before).filter(r=>r.method==='GET'&&r.path.startsWith('/api/admin/agents'));assert.deepEqual(reads.map(r=>r.path),['/api/admin/agents/ars_00_a16?range=7d']);}
  await page.getByTestId('object-detail-close').click();await expect(page.getByPlaceholder('搜索显示名或用户 ID')).toHaveValue('ars_00_a16');
 });
 await run('04-unmigrated-consumers-still-read-complete-agents',async()=>{
  for(const [path,kind] of [['/admin/tokens/new','token'],['/admin/mcp-playground','playground'],['/admin/audit?tab=calls','audit']]){
   const response=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/admin/agents'&&!new URL(r.url()).searchParams.has('view'),{timeout:15000});
   await page.goto(base+path);const r=await response;assert.equal(r.status(),200);const body=await r.json();assert.equal(body.data.agents.length,71);assert(body.data.agents.every(a=>Array.isArray(a.tokens)&&Array.isArray(a.effectivePermissions?.capabilities)));
   if(kind==='token'){await expect(page.getByLabel('选择所属 Agent',{exact:true})).toBeVisible();await page.getByLabel('选择所属 Agent',{exact:true}).selectOption('ars_00_a16');await expect(page.getByLabel('Token 标签',{exact:true})).toBeVisible();}
   if(kind==='playground'){await expect(page.getByTestId('mcp-playground-agent')).toBeVisible();await page.getByTestId('mcp-playground-agent').selectOption('ars_00_a16');await expect(page.getByTestId('mcp-playground-role')).toBeVisible({timeout:15000});}
   if(kind==='audit')await expect(page.getByLabel('按 Agent 名称或 ID 筛选',{exact:true})).toBeVisible();
   report.cases.push({name:'unmigrated-'+kind,status:'PASS',agents:body.data.agents.length,complete:true});await page.screenshot({path:join(folder,'consumer-'+kind+'.png')});
  }
 });
 await run('05-empty-real-backend',async()=>{
  const name='lucy-p166-'+candidate;
  const script="const fs=require('node:fs'),YAML=require('/app/webui/node_modules/yaml');const p='/data/lucy/webui/config/access.yaml';const c=YAML.parse(fs.readFileSync(p,'utf8'));c.users=[];fs.writeFileSync(p,YAML.stringify(c));console.log(JSON.stringify({fixtureUsers:c.users.length}));";
  report.emptyFixture=JSON.parse(execFileSync('docker',['exec',name,'node','-e',script],{encoding:'utf8'}));
  execFileSync('docker',['exec',name,'curl','-s','--unix-socket','/tmp/p166-control.sock','http://localhost/cold']);
  const r=await get('/api/admin/agents?view=roster&projection=summary&range=30d');assert.equal(r.status,200);assert.deepEqual(r.json.data.agents,[]);
  await page.goto(base+'/admin/agents');await expect(page.getByText('还没有任何',{exact:false})).toBeVisible({timeout:15000});await expect(page.getByRole('button',{name:'新建第一个 Agent',exact:true})).toBeVisible();
 });
}finally{save();await browser.close();}
console.log(JSON.stringify({candidate,cases:report.cases,failures:report.failures}));
