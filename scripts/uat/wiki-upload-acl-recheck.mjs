#!/usr/bin/env node
/** P1-65 real Docker + visible foreground Chrome + strict per-write MCP + scoped cleanup. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { assertWikiRead, assertWikiSearch } from './wiki-mcp-assertions.mjs';
const require = createRequire(resolve('webui/package.json'));
const { chromium } = require('playwright');
const ROOT = process.cwd();
const BASE = process.env.LUCY_WEBUI || 'http://127.0.0.1:55176';
const PROXY = process.env.LUCY_PROXY || 'http://127.0.0.1:57881';
assert.ok(['127.0.0.1','localhost'].includes(new URL(BASE).hostname), 'demo loopback only');
assert.ok(['127.0.0.1','localhost'].includes(new URL(PROXY).hostname), 'demo loopback only');
const CONTAINER = 'compose-lucy-1';
const RUN = process.env.UAT_WUA_RUN_ID || `wua-recheck-${Date.now()}`;
assert.match(RUN, /^wua-recheck-[a-zA-Z0-9-]+$/);
const OUT = resolve(process.env.UAT_WUA_OUT || 'docs/qa/uat/suites/wiki-upload-acl-adoption/runs/2026-11-20-codex-closure-recheck-artifacts');
mkdirSync(OUT,{recursive:true});
const B=['demo_readonly','lucy_admin'],W=[...B,'lucy_ops_reader'],C=['demo_readonly','lucy_ops_reader'];
const roles=['demo_readonly','lucy_admin','lucy_ops_reader'];
const results=[], apiTimes=[], mcpChecks=[], createdAgents=[], createdTokens=[], pages=new Set();
let cookie='', browser, page, sequence=0, initialized=false;
const tokens=new Map();
const evidence={caseFilter:process.env.UAT_WUA_CASE_FILTER||null,runId:RUN,startedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),results,apiTimes,mcpChecks};
function hash(text){return createHash('sha256').update(text).digest('hex');}
function safeError(error){return String(error?.message||error).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,700);}
function persist(){writeFileSync(`${OUT}/results.json`,JSON.stringify(evidence,null,2)+'\n');}
function image(){return JSON.parse(execFileSync('docker',['inspect',CONTAINER,'--format','{"image":"{{.Image}}","startedAt":"{{.State.StartedAt}}"}'],{encoding:'utf8'}));}
function apiResult(response){assert.ok(response.status>=200&&response.status<300&&response.json?.ok===true,`API ${response.status}: ${response.json?.error?.code||'invalid success envelope'}`);return response.json.data;}
async function api(method,path,body){
 const start=performance.now();
 const response=await fetch(BASE+path,{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const jar=new Map(cookie.split('; ').filter(Boolean).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));
 for(const entry of response.headers.getSetCookie()){const pair=entry.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
 cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
 let json;try{json=await response.json();}catch{json={};}
 if(!path.includes('/auth/login')&&!path.includes('/tokens'))apiTimes.push({method,path,ms:Math.round((performance.now()-start)*100)/100,status:response.status});
 return {status:response.status,json};
}
function key(id){const k=`global/uat-${RUN}-${++sequence}-${id.toLowerCase().replace(/[^a-z0-9-]/g,'-')}.md`;pages.add(k);return k;}
function markdown(acl,marker){const line=acl==='missing'?'':`allowed_roles: ${acl==='corrupt'?'42':JSON.stringify(acl==='empty'?[]:acl==='all'?['*']:acl)}\n`;return `---\nsummary: ${RUN}\n${line}---\n# ${marker}\n\n${marker}\n`;}
async function get(k){return apiResult(await api('GET',`/api/wiki/${encodeURIComponent(k)}`));}

async function assertAbsent(k){
 const listed=apiResult(await api('GET','/api/wiki'));
 assert.equal(listed.pages.some(p=>p.key===k),false,'refused create must not be listed');
 const exists=execFileSync('docker',['exec',CONTAINER,'node','-e',"const fs=require('fs'); console.log(fs.existsSync('/data/lucy/config/wiki/'+process.argv[1])?'present':'absent')",k],{encoding:'utf8'}).trim();
 assert.equal(exists,'absent','refused create must not create a file');
}

async function snapshot(k){const p=await get(k);return{version:p.file_version,hash:hash(p.rawMarkdown),acl:p.acl,raw:p.rawMarkdown};}
async function preview(k,md,mode,access){return apiResult(await api('POST','/api/wiki/upload/preview',{key:k,markdown:md,mode,sourceFileName:k.split('/').at(-1),...(access?{access}:{})}));}
async function commit(k,md,p,access,confirms={}){return api('POST','/api/wiki/upload/commit',{key:k,markdown:md,mode:p.mode,sourceFileName:k.split('/').at(-1),expected_version:p.currentFileVersion??undefined,preview_digest:p.access.preview_digest,...(access?{access}:{}),...confirms});}
function confirms(acl){return acl==='all'?{confirmed_all:true}:['missing','empty'].includes(acl)?{confirmed_empty:true}:{};}
async function setup(k,acl,marker){
 const md=markdown(acl,marker),a=acl==='corrupt'?{mode:'set',allowed_roles:B}:{mode:'use_uploaded'};
 const p=await preview(k,md,'create',a);apiResult(await commit(k,md,p,a,confirms(acl)));
 if(acl==='corrupt'){
  assert.match(k,/^global\/uat-wua-recheck-/);
  execFileSync('docker',['exec','-i',CONTAINER,'node','-e',"const fs=require('fs'); const p='/data/lucy/config/wiki/'+process.argv[1]; fs.writeFileSync(p,fs.readFileSync(0));",k],{input:md});
 }
 return get(k);
}
async function write(k,acl,access,marker,flags=confirms(acl)){
 const md=markdown(acl,marker),p=await preview(k,md,'replace',access);apiResult(await commit(k,md,p,access,flags));
 const after=await get(k);assert.ok(after.rawMarkdown.includes(marker));return after;
}
function parseMcp(text){if(text.trim().startsWith('{'))return JSON.parse(text);const rows=text.split('\n').filter(x=>x.startsWith('data:')).map(x=>JSON.parse(x.slice(5).trim()));assert.ok(rows.length);return rows.at(-1);}
async function mcp(token,name,args){
 const headers={authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'};
 const init=await fetch(PROXY+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'wua-closure-recheck',version:'1.0'}}})});
 assert.equal(init.status,200,'MCP initialize transport');const sid=init.headers.get('mcp-session-id');await init.text();assert.ok(sid,'MCP session required');headers['mcp-session-id']=sid;
 try{
  const notification=await fetch(PROXY+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});await notification.text();
  const r=await fetch(PROXY+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name,arguments:args}})});
  return{status:r.status,json:parseMcp(await r.text())};
 }finally{const r=await fetch(PROXY+'/mcp',{method:'DELETE',headers}).catch(()=>null);if(r)await r.text();}
}
async function checkpoint(k,marker,acl,label){
 for(const role of roles){
  const allowed=acl==='all'||(Array.isArray(acl)&&acl.includes(role));
  const search=await mcp(tokens.get(role),'wiki_search',{query:marker});
  const searched=assertWikiSearch(search,k,allowed);
  const read=await mcp(tokens.get(role),'wiki_read',{key:k});
  const readCheck=assertWikiRead(read,k,marker,allowed);
  mcpChecks.push({label,key:k,role,search:searched,read:readCheck});persist();
 }
}
async function test(id,fn){if(process.env.UAT_WUA_CASE_FILTER&&!['R0-isolated-identities','CLEANUP-suite-fixtures-and-tokens'].includes(id)&&!new RegExp(process.env.UAT_WUA_CASE_FILTER).test(id))return;const start=performance.now();try{const detail=await fn();results.push({id,ok:true,ms:Math.round(performance.now()-start),detail});console.log(`PASS ${id}`);}catch(error){results.push({id,ok:false,ms:Math.round(performance.now()-start),error:safeError(error)});console.log(`FAIL ${id}: ${safeError(error)}`);if(page)await page.screenshot({path:`${OUT}/${id.replace(/[^a-z0-9-]/gi,'-')}-failure.png`}).catch(()=>{});}persist();}
async function foreground(){await page.bringToFront();await page.waitForFunction(()=>document.visibilityState==='visible'&&document.hasFocus(),{},{timeout:10000});return page.evaluate(()=>({visibilityState:document.visibilityState,hasFocus:document.hasFocus(),width:innerWidth,height:innerHeight}));}
async function navigate(k){await foreground();const t=performance.now();await page.goto(`${BASE}/wiki?key=${encodeURIComponent(k)}`,{waitUntil:'domcontentloaded'});await page.getByTestId('wiki-upload-replace-button').waitFor();const visible=await foreground();return{primaryReadyMs:Math.round((performance.now()-t)*100)/100,...visible};}
async function attach(md,name='upload.md'){await page.getByTestId('wiki-upload-replace-button').click();await page.locator('input[type="file"]').first().setInputFiles({name,mimeType:'text/markdown',buffer:Buffer.from(md)});await page.getByTestId('wiki-upload-access-current').waitFor();await page.getByTestId('wiki-upload-preflight-loading').waitFor({state:'hidden'});}
async function waitReady(){await page.getByTestId('wiki-upload-preflight-loading').waitFor({state:'hidden'});await page.waitForFunction(()=>{const b=document.querySelector('[data-testid="wiki-upload-confirm"]');return b&&!b.disabled;});}
async function setRoles(target,fieldId='wiki-upload-access-editor-field'){
 const field=page.getByTestId(fieldId);await field.waitFor();
 await field.locator('label.pl-acl-option').filter({hasText:'指定角色'}).locator('input[type="radio"]').check();
 for(const role of roles){const label=field.locator('label.pl-acl-role').filter({hasText:new RegExp(`^\\s*${role}\\s*$`)});const box=label.locator('input[type="checkbox"]');await box.waitFor();if(target.includes(role))await box.check();else await box.uncheck();}
}
async function riskBox(acl){return acl==='all'?page.locator('[data-testid*="all-confirm"] input[type="checkbox"]').first():page.getByTestId('wiki-upload-access-editor-empty-confirm').locator('input[type="checkbox"]');}
async function confirmRisk(acl){if(['missing','empty','all'].includes(acl)){const box=await riskBox(acl);await box.waitFor();await box.check();}}
async function uiCommit(k,acl,marker,label){await waitReady();await foreground();const response=page.waitForResponse(r=>r.url().endsWith('/api/wiki/upload/commit')&&r.request().method()==='POST');await page.getByTestId('wiki-upload-confirm').click();const r=await response;assert.equal(r.status(),200);assert.equal((await r.json()).ok,true);await page.getByTestId('wiki-upload-preflight').waitFor({state:'hidden'});const a=await get(k);assert.ok(a.rawMarkdown.includes(marker));await checkpoint(k,marker,acl,label);return{version:a.file_version,hash:hash(a.rawMarkdown)};}
async function screenshot(id){await foreground();await page.screenshot({path:`${OUT}/${id}.png`});}
async function manageUi(k,target,marker,label){
 const timing=await navigate(k);await page.getByRole('button',{name:'管理访问权限',exact:true}).first().click();await page.getByTestId('wiki-access-drawer').waitFor();await setRoles(target,'wiki-access-drawer-editor-field');const b=page.getByTestId('wiki-access-save');await b.waitFor();await page.waitForFunction(()=>!document.querySelector('[data-testid="wiki-access-save"]').disabled);const rp=page.waitForResponse(r=>r.url().includes('/access')&&r.request().method()==='PUT');await b.click();assert.equal((await rp).status(),200);await screenshot(label);await page.getByTestId('wiki-access-drawer-close').click();const p=await get(k);assert.deepEqual([...p.acl.roles].sort(),[...target].sort());await checkpoint(k,marker,target,label);return timing;
}
async function cleanup(){
 const detail={pages:[],tokens:[],agents:[],remainingPages:[],remainingTokens:[],remainingAgents:[],errors:[]};
 const orphanPath=resolve('inbox/wiki-wua-recheck/orphan-agents.json');
 let prior=[];try{prior=JSON.parse(readFileSync(orphanPath,'utf8'));}catch{}
 const cleanupAgents=[...new Set([...createdAgents,...prior])];
 // Delete only this suite's explicit namespace, including historical leftovers.
 const listing=apiResult(await api('GET','/api/wiki'));const targets=listing.pages.filter(x=>/^global\/uat-wua(?:-|\.)/.test(x.key));
 for(const p of targets){try{const current=await get(p.key);apiResult(await api('DELETE',`/api/wiki/${encodeURIComponent(p.key)}?expected_version=${encodeURIComponent(current.file_version)}`));detail.pages.push(p.key);}catch(e){detail.errors.push({key:p.key,error:safeError(e)});}}
 const tokenList=apiResult(await api('GET','/api/admin/tokens'));
 for(const t of tokenList.tokens||[]){if(!/^uat-wua(?:-|\.)/.test(t.label||''))continue;const agent=t.agent?.id||t.userId||t.agentId||t.user_id;try{assert.ok(agent,'token owner required');apiResult(await api('DELETE',`/api/admin/agents/${encodeURIComponent(agent)}/tokens/${encodeURIComponent(t.label)}`));detail.tokens.push({agent,label:t.label});}catch(e){detail.errors.push({label:t.label,error:safeError(e)});}}
 const liveAgentData=apiResult(await api('GET','/api/admin/agents'));const liveAgentRows=Array.isArray(liveAgentData)?liveAgentData:liveAgentData.agents||liveAgentData.users||[];
 for(const id of cleanupAgents.filter(id=>liveAgentRows.some(a=>a.id===id))){try{apiResult(await api('DELETE',`/api/admin/agents/${encodeURIComponent(id)}`));detail.agents.push(id);}catch(e){detail.errors.push({agent:id,error:safeError(e)});}}
 detail.remainingPages=apiResult(await api('GET','/api/wiki')).pages.filter(x=>/^global\/uat-wua(?:-|\.)/.test(x.key)).map(x=>x.key);
 detail.remainingTokens=(apiResult(await api('GET','/api/admin/tokens')).tokens||[]).filter(x=>/^uat-wua(?:-|\.)/.test(x.label||'')).map(x=>({label:x.label}));
 const a=apiResult(await api('GET','/api/admin/agents'));const agents=Array.isArray(a)?a:a.agents||a.users||[];detail.remainingAgents=agents.filter(x=>cleanupAgents.includes(x.id)).map(x=>x.id);
 detail.containerFiles=JSON.parse(execFileSync('docker',['exec',CONTAINER,'node','-e',"const fs=require('fs'); console.log(JSON.stringify(fs.readdirSync('/data/lucy/config/wiki/global').filter(x=>/^uat-wua(?:-|\\.)/.test(x))))"],{encoding:'utf8'}));
 evidence.cleanup=detail;persist();assert.equal(detail.errors.length,0,'cleanup errors');assert.equal(detail.remainingPages.length+detail.remainingTokens.length+detail.remainingAgents.length+detail.containerFiles.length,0,'suite fixture residuals');return{deletedPages:detail.pages.length,deletedTokens:detail.tokens.length,deletedAgents:detail.agents.length,residuals:0};
}
async function main(){
 const creds=process.env.LUCY_ADMIN_ID?{adminId:process.env.LUCY_ADMIN_ID,password:process.env.LUCY_ADMIN_PASSWORD}:(()=>{const a=readFileSync(resolve('../config_for_agents/lucy-docker-demo-webui.txt'),'utf8').trim().split(/\r?\n/);return{adminId:a[1],password:a[2]};})();
 apiResult(await api('POST','/api/auth/login',creds));initialized=true;
 evidence.candidateStart=image();const health=apiResult(await api('GET','/api/health'));evidence.health={lucyVersion:health.lucyVersion,gitSha:health.gitSha,gitDirty:health.gitDirty};
 if(process.env.UAT_WUA_MODE==='cleanup'){evidence.scope='cleanup-only';return;}
 for(let i=0;i<roles.length;i++){
  const id=`wuar_${Date.now().toString(36)}_${i}`;apiResult(await api('POST','/api/admin/agents',{dryRun:false,agent:{id,name:`Wiki UAT ${i}`,roles:[roles[i]],note:RUN}}));createdAgents.push(id);
  const label=`uat-${RUN}-${i}`;const t=apiResult(await api('POST',`/api/admin/agents/${id}/tokens`,{label,expires_at:new Date(Date.now()+3600000).toISOString(),device_name:'wiki-closure-recheck'}));tokens.set(roles[i],t.token);createdTokens.push({id,label});
 }
 await test('R0-isolated-identities',async()=>({candidate:evidence.candidateStart,roles,agents:createdAgents}));
 // API success paths and independent safety controls; every write has an immediate strict MCP checkpoint.
 for(const [id,current,uploaded,access,final] of [
  ['01-preserve',B,W,{mode:'preserve_current'},B],['02-widen',B,W,{mode:'use_uploaded'},W],['02-narrow',W,B,{mode:'use_uploaded'},B],['08-set',B,W,{mode:'set',allowed_roles:C},C]
 ])await test(id,async()=>{const k=key(id),marker=`${RUN}-${id}`;await setup(k,current,`${marker}-base`);await write(k,uploaded,access,marker);await checkpoint(k,marker,final,id);return{key:k};});
 await test('03-stale-digest-zero-write',async()=>{const k=key('03');await setup(k,B,'base');const md=markdown(W,`${RUN}-03`),before=await snapshot(k),p=await preview(k,md,'replace',{mode:'preserve_current'});const r=await commit(k,md,p,{mode:'use_uploaded'});assert.equal(r.json?.error?.code,'wiki_upload_preview_stale');assert.deepEqual(await snapshot(k),before);return{key:k,code:r.json.error.code,beforeHash:before.hash};});
 await test('04-missing-access-zero-write',async()=>{const k=key('04');await setup(k,B,'base');const md=markdown(W,`${RUN}-04`),before=await snapshot(k),p=await preview(k,md,'replace',{mode:'use_uploaded'});const r=await commit(k,md,p,null);assert.equal(r.json?.error?.code,'wiki_upload_access_required');assert.deepEqual(await snapshot(k),before);return{key:k,code:r.json.error.code};});
 for(const acl of [W,'missing','empty','all'])await test(`09-create-${Array.isArray(acl)?'roles':acl}`,async()=>{const k=key('09'),marker=`${RUN}-09-${sequence}`,md=markdown(acl,marker),p=await preview(k,md,'create',null),a=p.access.suggested_selection;
  if(['missing','empty','all'].includes(acl)){const r=await commit(k,md,p,a);assert.equal(r.json?.error?.code,'wiki_upload_access_required');await assertAbsent(k);}
  apiResult(await commit(k,md,p,a,confirms(acl)));await checkpoint(k,marker,acl,'09-create');return{key:k};});
 await test('09-create-set',async()=>{const k=key('09-set'),marker=`${RUN}-09-set`,md=markdown(W,marker),a={mode:'set',allowed_roles:C},p=await preview(k,md,'create',a);apiResult(await commit(k,md,p,a));await checkpoint(k,marker,C,'09-set');return{key:k};});
 // K1-K5: each branch has a separate key, strict rejection snapshots and immediate MCP reads.
 for(const [id,current,uploaded,mode,final]of[
  ['K1-preserve',B,'corrupt','preserve_current',B],['K2-set',B,'corrupt','set',C],['K4-preserve','corrupt',W,'preserve_current','corrupt'],['K4-adopt','corrupt',W,'use_uploaded',W],['K5-preserve','corrupt','corrupt','preserve_current','corrupt'],['K5-set','corrupt','corrupt','set',C]
 ])await test(`10-${id}`,async()=>{const k=key(id),marker=`${RUN}-${id}`;await setup(k,current,'base');if(uploaded==='corrupt'){const before=await snapshot(k),p=await preview(k,markdown(uploaded,marker),'replace',{mode:'use_uploaded'}),r=await commit(k,markdown(uploaded,marker),p,{mode:'use_uploaded'});assert.equal(r.json?.error?.code,'CONTEXT_ACL_INVALID');assert.deepEqual(await snapshot(k),before);}
  await write(k,uploaded,mode==='set'?{mode,allowed_roles:C}:{mode},marker);await checkpoint(k,marker,final,id);return{key:k};});
 await test('10-K3-create-corrupt',async()=>{const k=key('K3'),marker=`${RUN}-K3`,md=markdown('corrupt',marker),a={mode:'use_uploaded'},p=await preview(k,md,'create',a);assert.equal((await commit(k,md,p,a)).json?.error?.code,'CONTEXT_ACL_INVALID');await assertAbsent(k);const set={mode:'set',allowed_roles:C};apiResult(await commit(k,md,await preview(k,md,'create',set),set));await checkpoint(k,marker,C,'K3');return{key:k};});
 browser=await chromium.launch({channel:'chrome',headless:false,args:['--start-maximized']});const context=await browser.newContext({viewport:{width:1920,height:1080}});page=await context.newPage();page.setDefaultTimeout(15000);
 // Cookie is transferred in memory; never written to disk, screenshot or trace.
 await context.addCookies(cookie.split('; ').map(x=>{const i=x.indexOf('=');return{name:x.slice(0,i),value:x.slice(i+1),url:BASE};}));await page.goto(BASE+'/wiki');await foreground();evidence.browser={channel:'chrome',headless:false,viewport:{width:1920,height:1080},foregroundRequired:true};
 await test('07-E2-real-preview-loading',async()=>{
  const k=key('E2'),marker=`${RUN}-E2`;await setup(k,B,'base');const timing=await navigate(k);
  let release;const gate=new Promise(r=>release=r);const errors=[];
  const route=async r=>{try{const response=await r.fetch();await gate;await r.fulfill({response});}catch(e){errors.push(safeError(e));}};
  await page.route('**/api/wiki/upload/preview',route);
  try{
   await page.getByTestId('wiki-upload-replace-button').click();await page.locator('input[type="file"]').first().setInputFiles({name:'E2.md',mimeType:'text/markdown',buffer:Buffer.from(markdown(W,marker))});
   await page.getByTestId('wiki-upload-preflight-loading').waitFor();assert.equal(await page.getByTestId('wiki-upload-confirm').isDisabled(),true);await screenshot('E2-preview-loading');
   release();await page.getByTestId('wiki-upload-access-choice-required').waitFor();assert.deepEqual(errors,[]);await page.unroute('**/api/wiki/upload/preview',route);
   await page.getByTestId('wiki-upload-access-adopt').click();return{key:k,timing,...await uiCommit(k,W,marker,'E2-recovered')};
  }finally{release?.();await page.waitForTimeout(100);await page.unroute('**/api/wiki/upload/preview',route);}
 });
 const matrix=[['M1',B,W],['M2',W,B],['M3','all',B],['M4',B,'empty'],['M5',B,'missing'],['M6','missing','empty'],['M7','empty','missing'],['M8',B,C],['M9',B,'all']];
 for(const[id,current,uploaded]of matrix)await test(`07-${id}-adopt`,async()=>{const k=key(id),marker=`${RUN}-${id}`;await setup(k,current,'base');const timing=await navigate(k);let commits=0;const listener=r=>{if(r.url().endsWith('/api/wiki/upload/commit'))commits++;};page.on('request',listener);await attach(markdown(uploaded,marker));assert.equal(await page.getByTestId('wiki-upload-confirm').isDisabled(),true);await page.getByText('待选择（尚未确定）',{exact:true}).waitFor();assert.equal(commits,0);await screenshot(id+'-pending');page.off('request',listener);await page.getByTestId('wiki-upload-access-adopt').click();await confirmRisk(uploaded);const after=await uiCommit(k,uploaded,marker,id);return{key:k,timing,beforeCommitRequests:commits,...after};});
 for(const action of['preserve','set'])await test(`07-M1-${action}`,async()=>{const k=key(action),marker=`${RUN}-${action}`;await setup(k,B,'base');const timing=await navigate(k);await attach(markdown(W,marker));if(action==='preserve')await page.getByTestId('wiki-upload-access-preserve').click();else await setRoles(C);await screenshot('M1-'+action);return{key:k,timing,...await uiCommit(k,action==='preserve'?B:C,marker,action)};});
 for(const acl of [B,'all','empty','missing'])await test(`11-same-${Array.isArray(acl)?'roles':acl}`,async()=>{const k=key('same'),marker=`${RUN}-same-${sequence}`;await setup(k,acl,'base');const timing=await navigate(k);const uploaded=Array.isArray(acl)?[...B].reverse().concat(B[0]):acl;await attach(markdown(uploaded,marker));assert.equal(await page.getByText('待选择（尚未确定）',{exact:true}).count(),0);await confirmRisk(acl);return{key:k,timing,...await uiCommit(k,acl,marker,'same')};});
 for(const acl of['empty','missing','corrupt'])await test(`05-12-T4-${acl}-manage-ui`,async()=>{const k=key('manage-'+acl),marker=`${RUN}-manage-${acl}`;await setup(k,acl,marker);await checkpoint(k,marker,acl,'manage-before');const before=await snapshot(k);const timing=await manageUi(k,C,marker,'manage-'+acl);const after=await snapshot(k);assert.notEqual(after.version,before.version);return{key:k,timing,before:before.hash,after:after.hash};});
 await test('05-manage-B-to-W-ui',async()=>{const k=key('05'),marker=`${RUN}-manage-widen`;await setup(k,B,marker);await checkpoint(k,marker,B,'05-before');return{key:k,timing:await manageUi(k,W,marker,'05-manage')};});
 // UI corrupt branch availability; K API cases above cannot prove these buttons are reachable.
 for(const action of['preserve','set'])await test(`10-corrupt-ui-${action}`,async()=>{const k=key('corrupt-ui'),marker=`${RUN}-corrupt-ui-${action}`;await setup(k,B,'base');const timing=await navigate(k);await attach(markdown('corrupt',marker));assert.equal(await page.getByTestId('wiki-upload-access-adopt').count(),0);if(action==='preserve')await page.getByTestId('wiki-upload-access-preserve').click();else {await page.getByTestId('wiki-upload-access-ignore-corrupt').click();await setRoles(C);}return{key:k,timing,...await uiCommit(k,action==='preserve'?B:C,marker,'corrupt-ui-'+action)};});
 for(const acl of['missing','empty','all'])await test(`12-T1-API-${acl}`,async()=>{
  const k=key('T1-api-'+acl),marker=`${RUN}-T1-api-${acl}`;await setup(k,B,'base');
  const before=await snapshot(k),md=markdown(acl,marker),selection={mode:'use_uploaded'},p=await preview(k,md,'replace',selection);
  const bad=await commit(k,md,p,selection);assert.equal(bad.json?.error?.code,'wiki_upload_access_required');assert.deepEqual(await snapshot(k),before);
  apiResult(await commit(k,md,p,selection,confirms(acl)));await checkpoint(k,marker,acl,'T1-api-'+acl);
  return{key:k,deniedStatus:bad.status,deniedCode:bad.json.error.code,zeroWriteHash:before.hash};
 });
 for(const acl of['missing','empty','all'])await test(`12-T1-reset-${acl}`,async()=>{const k=key('T1-'+acl),marker=`${RUN}-T1-${acl}`;await setup(k,B,'base');const timing=await navigate(k);await attach(markdown(acl,marker));await page.getByTestId('wiki-upload-access-adopt').click();const box=await riskBox(acl);await box.waitFor();assert.equal(await box.isChecked(),false);assert.equal(await page.getByTestId('wiki-upload-confirm').isDisabled(),true);await box.check();await waitReady();await page.getByTestId('wiki-upload-access-preserve').click();await page.getByTestId('wiki-upload-access-adopt').click();const again=await riskBox(acl);await again.waitFor();assert.equal(await again.isChecked(),false);assert.equal(await page.getByTestId('wiki-upload-confirm').isDisabled(),true);await screenshot('T1-'+acl+'-reset');await again.check();return{key:k,timing,...await uiCommit(k,acl,marker,'T1-reset')};});
 await test('12-T2-real-response-reordering',async()=>{
  const k=key('T2'),marker=`${RUN}-T2`;await setup(k,B,'base');const timing=await navigate(k);await attach(markdown(W,marker));
  let signalHeld,release;const held=new Promise(r=>signalHeld=r),gate=new Promise(r=>release=r);let n=0,oldDelivered=false;const routeErrors=[];
  const route=async r=>{try{if(++n===1){const response=await r.fetch();signalHeld();await gate;await r.fulfill({response});oldDelivered=true;}else await r.continue();}catch(e){routeErrors.push(safeError(e));signalHeld();}};
  await page.route('**/api/wiki/upload/preview',route);
  try{
   // Fire two real DOM controls in one browser task, before the loading panel replaces them.
   await page.evaluate(()=>{
    const keep=document.querySelector('[data-testid="wiki-upload-access-preserve"]');
    const adopt=document.querySelector('[data-testid="wiki-upload-access-adopt"]');
    keep.click();adopt.click();
   });
   await Promise.race([held,new Promise((_,reject)=>setTimeout(()=>reject(new Error('first real preview not intercepted')),10000))]);
   await waitReady();assert.ok(n>=2,'two overlapping preview requests required');
   await setRoles(C);await waitReady();release();
   await page.waitForTimeout(500);assert.equal(oldDelivered,true,'the held real response must be delivered after the final selection');
   assert.deepEqual(routeErrors,[],'no hidden interception errors');await screenshot('T2-last-selection');
   const after=await uiCommit(k,C,marker,'T2-last');assert.deepEqual([...(await get(k)).acl.roles].sort(),[...C].sort());
   return{key:k,timing,previewRequests:n,oldDelivered,...after};
  }finally{release?.();await page.waitForTimeout(200);await page.unroute('**/api/wiki/upload/preview',route);}
 });
 await test('12-T3-version-conflict-ui-recovery',async()=>{const k=key('T3-conflict'),marker=`${RUN}-T3-conflict`;await setup(k,B,'base');const timing=await navigate(k);await attach(markdown(W,marker));await page.getByTestId('wiki-upload-access-adopt').click();await waitReady();const before=await get(k);const p=apiResult(await api('POST',`/api/wiki/${encodeURIComponent(k)}/access/preview`,{allowed_roles:C,expected_version:before.file_version}));apiResult(await api('PUT',`/api/wiki/${encodeURIComponent(k)}/access`,{allowed_roles:C,expected_version:before.file_version,preview_digest:p.preview_digest}));const mid=await snapshot(k);const rp=page.waitForResponse(r=>r.url().endsWith('/api/wiki/upload/commit'));await page.getByTestId('wiki-upload-confirm').click();const response=await rp;assert.equal(response.status(),409);assert.deepEqual(await snapshot(k),mid);await waitReady();await screenshot('T3-conflict-repreview');return{key:k,timing,conflictStatus:409,...await uiCommit(k,W,marker,'T3-recovered')};});
 await test('12-T3-network-failure-cancel-reopen',async()=>{const k=key('T3-network'),marker=`${RUN}-T3-network`;await setup(k,B,'base');const timing=await navigate(k);await attach(markdown(W,marker));const before=await snapshot(k);const abort=async r=>r.abort('failed');await page.route('**/api/wiki/upload/preview',abort);try{await page.getByTestId('wiki-upload-access-adopt').click();await page.getByTestId('wiki-upload-preflight-error').waitFor();assert.equal(await page.getByTestId('wiki-upload-confirm').isDisabled(),true);assert.deepEqual(await snapshot(k),before);await screenshot('T3-network-error');}finally{await page.unroute('**/api/wiki/upload/preview',abort);}await page.getByTestId('wiki-upload-preflight').getByRole('button',{name:'取消',exact:true}).click();await attach(markdown(W,marker));await page.getByTestId('wiki-upload-access-adopt').click();return{key:k,timing,...await uiCommit(k,W,marker,'T3-network-recovered')};});
 evidence.candidateEnd=image();assert.deepEqual(evidence.candidateEnd,evidence.candidateStart,'runtime candidate changed during the run');
}
let fatal;
try{await main();}catch(error){fatal=safeError(error);evidence.fatal=fatal;console.log('FATAL '+fatal);}finally{
 if(page)await page.unrouteAll({behavior:'ignoreErrors'}).catch(()=>{});
 if(initialized)await test('CLEANUP-suite-fixtures-and-tokens',cleanup);
 if(browser)await browser.close();
 evidence.finishedAt=new Date().toISOString();evidence.verdict=fatal||results.some(x=>!x.ok)?'FAIL':'PASS';evidence.summary={passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,mcpCheckpoints:mcpChecks.length};persist();console.log(JSON.stringify({verdict:evidence.verdict,...evidence.summary}));process.exitCode=evidence.verdict==='PASS'?0:1;
}
