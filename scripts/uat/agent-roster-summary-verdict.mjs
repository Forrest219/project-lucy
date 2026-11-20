/** Completeness and fixed v0.2 budgets. Failure never disappears from a successful-only p95. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';import {resolve,join} from 'node:path';
import {p95,validateWidth} from './agent-roster-summary-oracle.mjs';
const root=resolve('inbox/p166-implementation-20261120'),results=join(root,'results'),failures=[],profiles=[];
const read=path=>existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
const fail=(scope,message)=>failures.push({scope,message});
for(const profile of ['BAL-1','SKEW-1','BAL-2','SKEW-2','BAL-5','SKEW-5']){
 const k=Number(profile.split('-')[1]),limits={primary:{1:1000,2:1500,5:2000}[k],stats:{1:2000,2:3000,5:5000}[k],detail:{1:2000,2:3000,5:5000}[k],summary:{1:200,2:300,5:500}[k],cold:{1:1000,2:2000,5:3000}[k]},stages={};
 for(const [candidate,round] of [['a',1],['b',1],['a',2]]){
  const scope=`${profile}-${candidate}-round${round}`,api=read(join(results,scope,'api.json')),browser=read(join(results,scope,'browser.json'));
  if(!api||!browser){fail(scope,'missing API or headed browser evidence');continue;}
  stages[`${candidate}${round}`]={api,browser};
  for(const error of api.failures)fail(scope,'API: '+error);
  for(const error of browser.failures)fail(scope,'browser: '+JSON.stringify(error));
  if(browser.probeRevision!==2||!browser.headed)fail(scope,'fresh-response foreground probe revision 2 required');
  if(browser.consoleErrors.length)fail(scope,'browser console errors');
  for(const kind of ['roster','full','statistics','detail',...(candidate==='b'?['summary']:[])]){
   const samples=api.samples.filter(s=>s.kind===kind);if(samples.length!==30||samples.some(s=>s.error||s.status!==200))fail(scope,`${kind}: 30/30 successful samples required`);
  }
  if(round===1){const cold=api.samples.filter(s=>s.kind==='cold-snapshot');if(cold.length!==5)fail(scope,'five independent cold snapshots required');if(candidate==='b'&&cold.some(s=>s.error||s.status!==200||s.ms>limits.cold))fail(scope,'cold snapshot absolute budget or success rate failed');}
  for(const kind of ['cold-navigation','no-cache-spa','hot-spa','refresh','drawer','editor']){
   const samples=browser.samples.filter(s=>s.kind===kind),expected=kind==='cold-navigation'?5:20;
   if(samples.length!==expected||samples.some(s=>s.error))fail(scope,`${kind}: ${expected}/${expected} successful foreground samples required`);
   if(candidate==='b'){
    if(samples.some(s=>s.error)||p95(samples.map(s=>s.primaryReadyMs))>(['drawer','editor'].includes(kind)?limits.detail:limits.primary))fail(scope,kind+' primary absolute budget failed');
    if(!['drawer','editor'].includes(kind)&&(samples.some(s=>!Number.isFinite(s.statsReadyMs))||p95(samples.map(s=>s.statsReadyMs))>limits.stats))fail(scope,kind+' statistics absolute budget failed');
   }
  }
  if(candidate==='b'&&(api.p95.summary>limits.summary||api.oracle.summaryBodyBytes>256*1024*k||api.oracle.bodyRatio>.2||api.diagnostics.hot?.counters?.fullParses!==0))fail(scope,'summary absolute bytes/latency/full-parse budget failed');
 }
 const b=stages.b1;
 if(b)for(const direction of ['a1','a2']){
  const a=stages[direction];if(!a)continue;
  const ar=read(join(results,`${profile}-a-round${direction.slice(1)}`,'per-agent-scale.json')),br=read(join(results,`${profile}-b-round1`,'per-agent-scale.json'));
  if(JSON.stringify(ar?.map(r=>[r.id,r.identityDigest,r.semanticDigest]))!==JSON.stringify(br?.map(r=>[r.id,r.identityDigest,r.semanticDigest])))fail(profile,'old full permission semantics changed across A/B');
  for(const [kind,budget] of Object.entries(b.browser.p95??{})){
   const baseline=a.browser.p95?.[kind];
   for(const metric of ['primaryReadyMs','statsReadyMs']){
    const expected=kind==='cold-navigation'?5:20,validBaseline=!(a.browser.failures??[]).some(e=>e.kind==='network')&&a.browser.consoleErrors.length===0&&a.browser.samples.filter(s=>s.kind===kind&&!s.error&&Number.isFinite(s[metric])).length===expected;
    if(!validBaseline){if(metric==='primaryReadyMs'||!['drawer','editor'].includes(kind))fail(profile,`${direction}/${kind}/${metric}: no valid baseline; relative benefit N/A`);continue;}
    if(Number.isFinite(budget[metric])&&budget[metric]>baseline[metric]*1.2&&budget[metric]-baseline[metric]>50)fail(profile,`${direction}/${kind}/${metric}: relative regression exceeds 20% and 50ms`);
   }
  }
  if(a.api.samples.filter(s=>s.kind==='roster').every(s=>!s.error&&s.status===200)&&b.api.p95.summary>a.api.p95.roster*1.2&&b.api.p95.summary-a.api.p95.roster>50)fail(profile,direction+' summary relative regression');
 }
 profiles.push({profile,stages:Object.fromEntries(Object.entries(stages).map(([name,s])=>[name,{apiP95:s.api.p95,browserP95:s.browser.p95,oracle:s.api.oracle,apiFailures:s.api.failures.length,browserFailures:s.browser.failures.length}]))});
}
const widths=[];
for(const name of ['BAL','SKEW']){
 const low=read(join(results,name+'-1-L-b','api.json')),high=read(join(results,name+'-1-b-round1','api.json'));
 if(!low||!high){fail(name,'missing WIDTH L/H evidence');continue;}
 const errors=validateWidth(low.oracle,high.oracle);for(const e of errors)fail(name,e);for(const e of low.failures)fail(name,'WIDTH API '+e);widths.push({profile:name,low:low.oracle,high:high.oracle,errors});
}
for(const candidate of ['legacy','roster','old-ui']){const evidence=read(join(results,'compatibility-'+candidate,'compatibility.json'));if(!evidence)fail(candidate,'missing actual build compatibility');else for(const name of evidence.failures)fail(candidate,name);}
const functional=read(join(results,'functional-final','functional.json'));
if(!functional)fail('functional','missing real fault/write/MCP evidence');else{for(const name of functional.failures)fail('functional',name);if(functional.cases.length<11)fail('functional','incomplete functional cases');}
const verdict={specVersion:'0.2',status:failures.length?'FAIL':'PASS',generatedAt:new Date().toISOString(),budgetsUnchanged:true,profiles,widths,failures};
writeFileSync(join(root,'verdict.json'),JSON.stringify(verdict,null,2));console.log(JSON.stringify({status:verdict.status,failures:failures.length,profileStages:profiles.map(p=>[p.profile,Object.keys(p.stages)])}));
