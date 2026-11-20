/** Real, headed desktop Chrome; no success payload mocks. Credentials stay private. */
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../webui/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const root=resolve(new URL('../..',import.meta.url).pathname),out=join(root,'inbox/p166-implementation-20261120');
const [fixture='BAL-1',candidate='b']=process.argv.slice(2),port=candidate==='a'?59165:candidate==='b'?59166:59168;
const base=`http://127.0.0.1:${port}`,manifest=JSON.parse(readFileSync(join(out,fixture,'fixture-manifest.json')));
const folder=join(out,'results',`${fixture}-${candidate}`);mkdirSync(folder,{recursive:true});
const login=JSON.parse(readFileSync('/private/tmp/lucy-p166-private-20261120/login.json'));
const api=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(login)});assert.equal(api.status,200);
const cookies=api.headers.getSetCookie().map(c=>{const [name,...value]=c.split(';')[0].split('=');return {name,value:value.join('='),url:base};});
const browser=await chromium.launch({headless:false,channel:'chrome'});
const report={probeRevision:2,fixture,candidate,startedAt:new Date().toISOString(),browser:browser.version(),headed:true,viewport:{width:1920,height:1080},samples:[],requests:[],failures:[],consoleErrors:[]};
const save=()=>writeFileSync(join(folder,'browser.json'),JSON.stringify(report,null,2));
let context,page,currentSample=null;const pendingErrorBodies=[];
async function setup(){context=await browser.newContext({viewport:report.viewport});await context.addCookies(cookies);
 await context.addInitScript(()=>{window.__arsLongTasks=[];window.__arsFocus=[];
  if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{window.__arsLongTasks.push(...list.getEntries().map(e=>({startTime:e.startTime,duration:e.duration})));}).observe({type:'longtask',buffered:true});
  for(const name of ['blur','focus','visibilitychange'])addEventListener(name,()=>window.__arsFocus.push({name,at:performance.now(),visible:document.visibilityState,focused:document.hasFocus()}));
 });
 page=await context.newPage();page.on('pageerror',e=>report.consoleErrors.push(String(e)));page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/')){const entry={at:new Date().toISOString(),sample:currentSample,path:u.pathname+u.search,status:r.status(),method:r.request().method()};report.requests.push(entry);if(r.status()>=400)pendingErrorBodies.push(r.json().then(body=>{entry.error=body.error;}).catch(()=>{}));}});await page.bringToFront();}
async function foreground(){await page.bringToFront();const state=await page.evaluate(()=>({visible:document.visibilityState,focused:document.hasFocus()}));assert.equal(state.visible,'visible');assert.equal(state.focused,true);return state;}
async function clock(){return page.evaluate(()=>performance.now());}
async function paint(){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function ready(){const first=page.getByTestId('agent-row-ars_00_a00');await expect(first).toBeVisible({timeout:15000});await expect(first).toContainText('ARS 00 Agent 00');await expect(first).toContainText('ars_00_r00');await expect(first).toContainText('可用 3');await expect(page.locator('[data-testid^="agent-row-"]')).toHaveCount(manifest.agents,{timeout:15000});await paint();}
async function statsReady(){await expect(page.getByTestId('agent-statistics-as-of')).toBeVisible({timeout:15000});await expect(page.getByTestId('metric-business-calls-value')).toHaveText(String(180000*manifest.copies),{timeout:15000});await paint();}
async function diagnostics(start){return page.evaluate(start=>({
 longTasks:window.__arsLongTasks.filter(e=>e.startTime>=start),focusEvents:window.__arsFocus.filter(e=>e.at>=start),domNodes:document.getElementsByTagName('*').length,
 resources:performance.getEntriesByType('resource').filter(e=>e.startTime>=start&&e.name.includes('/api/admin/agents')).map(e=>({path:new URL(e.name).pathname+new URL(e.name).search,startTime:e.startTime,ttfbMs:e.responseStart-e.startTime,durationMs:e.duration,transferSize:e.transferSize,decodedBodySize:e.decodedBodySize}))
 }),start);}
function rosterResponse(r){const u=new URL(r.url());return r.request().method()==='GET'&&u.pathname==='/api/admin/agents'&&u.searchParams.get('view')==='roster';}
function freshStatistics(){
 const promise=page.waitForResponse(r=>{const u=new URL(r.url());return r.request().method()==='GET'&&u.pathname==='/api/admin/agents/statistics'&&u.searchParams.get('range')==='30d';},{timeout:15000})
  .then(async r=>{await r.finished();assert.equal(r.status(),200,'this round statistics HTTP');return r;});
 // Avoid an unhandled rejection if the primary read itself fails first.
 promise.catch(()=>{});return promise;
}
async function measured(kind,n,trigger,check=ready){
 currentSample={kind,n};const state=await foreground(),withStatistics=['no-cache-spa','hot-spa','refresh'].includes(kind),fresh=withStatistics?freshStatistics():undefined,start=await clock();try{await trigger();await check();const primary=await clock()-start;await foreground();let stats;
 if(withStatistics){await fresh;await statsReady();stats=await clock()-start;}
 const diagnostic=await diagnostics(start);assert(!diagnostic.focusEvents.some(e=>e.name==='blur'||e.visible!=='visible'),'foreground changed during sample');
 report.samples.push({kind,n,primaryReadyMs:primary,statsReadyMs:stats,...state,...diagnostic});
 }catch(e){report.failures.push({kind,n,error:String(e)});report.samples.push({kind,n,error:String(e),...state});await page.screenshot({path:join(folder,`failure-${kind}-${n}.png`)}).catch(()=>{});}save();
}
try{
 await setup();
 if(process.env.P166_BROWSER_INSPECT){await page.goto(base+'/admin/agents');await ready();console.log((await page.locator('body').innerText()).slice(0,6500));await page.screenshot({path:join(folder,'inspect.png')});}
 else {
  for(let n=0;n<5;n++){
   if(n)await setup();currentSample={kind:"cold-navigation",n};await foreground();const fresh=freshStatistics();try{await page.goto(base+'/admin/agents',{waitUntil:'commit'});await ready();const primary=await clock();await fresh;await statsReady();report.samples.push({kind:'cold-navigation',n,primaryReadyMs:primary,statsReadyMs:await clock(),...await foreground(),...await diagnostics(0)});}catch(e){report.failures.push({kind:'cold-navigation',n,error:String(e)});}save();await context.close();
  }
  for(let n=0;n<20;n++){
   await setup();await page.goto(base+'/admin/version');await expect(page.getByRole('link',{name:'Agent',exact:true})).toBeVisible({timeout:15000});
   await measured('no-cache-spa',n,async()=>{const fresh=page.waitForResponse(rosterResponse);await page.getByRole('link',{name:'Agent',exact:true}).click();await (await fresh).finished();});await context.close();
  }
  await setup();await page.goto(base+'/admin/agents');await ready();await statsReady();
  for(let n=0;n<20;n++){
   await page.getByRole('link',{name:'版本信息',exact:true}).click();
   await measured('hot-spa',n,async()=>{const fresh=page.waitForResponse(rosterResponse);await page.getByRole('link',{name:'Agent',exact:true}).click();await (await fresh).finished();});
  }
  for(let n=0;n<20;n++){await expect(page.getByRole('button',{name:'刷新',exact:true})).toBeEnabled({timeout:15000});await measured('refresh',n,async()=>{const fresh=page.waitForResponse(rosterResponse);await page.getByRole('button',{name:'刷新',exact:true}).click();await (await fresh).finished();});}
  const widest='ars_00_a00';
  for(let n=0;n<20;n++){
   await measured('drawer',n,async()=>{const fresh=page.waitForResponse(r=>{const u=new URL(r.url());return candidate==='a'?u.pathname==='/api/admin/agents'&&!u.searchParams.has('view'):u.pathname===`/api/admin/agents/${widest}`&&u.searchParams.get('range')==='7d';});await page.getByTestId(`agent-name-link-${widest}`).click();const r=await fresh;await r.finished();assert.equal(r.status(),200);},async()=>{await expect(page.getByTestId('object-detail-agent-body')).toBeVisible({timeout:15000});});
   await page.getByTestId('object-detail-close').click();await expect(page.getByTestId('object-detail-drawer')).toHaveCount(0);
  }
  for(let n=0;n<20;n++){
   await measured('editor',n,async()=>{
    const fresh=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname===`/api/admin/agents/${widest}`,{timeout:15000});
    await page.getByTestId(`agent-row-${widest}`).getByRole('link',{name:'编辑',exact:true}).click();const response=await fresh;await response.finished();assert.equal(response.status(),200);
    await page.getByRole('tab',{name:'权限预览',exact:true}).click();
   },async()=>{await expect(page.getByTestId('permissions-tree')).toBeVisible({timeout:15000});await expect(page.getByTestId('permissions-tree')).toContainText('ars_00',{timeout:15000});await expect(page.getByTestId('authorization-summary-loading')).toHaveCount(0,{timeout:15000});await expect(page.getByTestId('authorization-summary-error')).toHaveCount(0);await paint();});
   const fresh=freshStatistics();await page.getByRole('link',{name:'Agent',exact:true}).click();await ready();await fresh;await statsReady();
  }
  await page.screenshot({path:join(folder,'roster.png'),fullPage:false});
  const failed=report.requests.filter(r=>r.status>=400);if(failed.length)report.failures.push({kind:'network',errors:failed});
  if(candidate==='b'){
   const fullReads=report.requests.filter(r=>r.method==='GET'&&r.path.split('?')[0]==='/api/admin/agents'&&!r.path.includes('projection=summary'));
   if(fullReads.length)report.failures.push({kind:'unexpected-full-list',requests:fullReads});
   for(const sample of report.samples.filter(s=>s.kind==='drawer'&&!s.error)){
    const detail=sample.resources.filter(r=>r.path.startsWith('/api/admin/agents/'));
    if(detail.length!==1||detail[0].path!==`/api/admin/agents/${widest}?range=7d`)report.failures.push({kind:'drawer-request-boundary',n:sample.n,requests:detail});
   }
  }
  report.p95=Object.fromEntries([...new Set(report.samples.map(x=>x.kind))].map(kind=>{const values=report.samples.filter(x=>x.kind===kind&&!x.error).map(x=>x.primaryReadyMs).sort((a,b)=>a-b);const stats=report.samples.filter(x=>x.kind===kind&&x.statsReadyMs!==undefined).map(x=>x.statsReadyMs).sort((a,b)=>a-b);return[kind,{n:values.length,primaryReadyMs:values[Math.ceil(values.length*.95)-1]??null,statsReadyMs:stats[Math.ceil(stats.length*.95)-1]??null}];}));
  if(candidate==='b')for(const [kind,value] of Object.entries(report.p95)){const k=manifest.copies,limit=kind==='drawer'||kind==='editor'?(k===1?2000:k===2?3000:5000):(k===1?1000:k===2?1500:2000);if(value.primaryReadyMs>limit)report.failures.push({kind,error:`p95 ${value.primaryReadyMs} > ${limit}`});if(value.statsReadyMs>(k===1?2000:k===2?3000:5000))report.failures.push({kind,error:'statsReady p95 budget'});}
 }
} catch(e){report.failures.push({error:String(e)});if(page)await page.screenshot({path:join(folder,'runner-failure.png')}).catch(()=>{});}
finally{await Promise.allSettled(pendingErrorBodies);save();await browser.close();try{const [current,peak,...rows]=execFileSync('docker',['exec',`lucy-p166-${candidate}`,'cat','/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory.peak','/sys/fs/cgroup/memory.events','/sys/fs/cgroup/cpu.stat'],{encoding:'utf8'}).trim().split('\n');report.cgroup={memoryCurrentBytes:Number(current),memoryPeakBytes:Number(peak),kernelCounters:Object.fromEntries(rows.map(row=>{const [key,value]=row.trim().split(/\s+/);return [key,Number(value)];}))};}catch(e){report.failures.push({kind:'resource-capture',error:String(e)});}save();}
console.log(JSON.stringify({fixture,candidate,p95:report.p95,failures:report.failures,consoleErrors:report.consoleErrors}));
