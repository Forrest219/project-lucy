from pathlib import Path
import json,hashlib
b=Path('inbox/20261120-combined-final');out=b/'p160-v5-complete';candidate=json.loads((b/'final-candidate.json').read_text());digest=candidate['image'];summary=json.loads((out/'summary.json').read_text());short=json.loads(Path('inbox/source-shortname-conflict/evidence/20261120T050638/summary.json').read_text());source=json.loads((b/'v5-source-check.json').read_text())
assert summary['status']=='PASS' and len(summary['cases'])==13 and all(v['status']=='PASS' for v in summary['cases'].values())
assert not summary.get('cleanupErrors')
assert short['cases']['UAT-SNC-R0']['image'].startswith(digest+' ')
assert short['status']=='PASS' and short['cleanedUp'] and len(short['cases'])==13 and all(v['status']=='PASS' for v in short['cases'].values())
assert source['status']=='PASS' and source['image']==digest and source['filesMatched']==38
assert summary['runnerSha256']==hashlib.sha256((b/'runner-pinned.py').read_bytes()).hexdigest()
artifacts=[]
for p in out.rglob('artifact.json'):
 d=json.loads(p.read_text());image=d['image'].split()[0]
 if p.parent.name=='baseline':
  assert image=='sha256:d4ee128c273873b06c0e8fcee296638e030882f08a3d05a745a4fa39be981af8'
  auditLine=next(line for line in d['code'].splitlines() if line.endswith('/proxy/audit.ts'))
  assert auditLine.split()[0]==source['files']['webui/server/proxy/audit.ts']
 else:
  assert image==digest,(str(p),image)
  for line in d['code'].splitlines():
   actual,path=line.split();relative=path.removeprefix('/app/');assert source['files'][relative]==actual,relative
 if image==digest:artifacts.append(str(p.relative_to(out)))
perf=json.loads((out/'candidate/r10-performance.json').read_text());assert perf['status']=='PASS' and perf['successes']=={'baseline':300,'candidate':300} and not perf['failures'] and not perf['warmupFailures'] and len(perf['rounds'])==3
assert all(len(r['samples'][g])==100 for r in perf['rounds'] for g in ['baseline','candidate'])
assert all(r['candidateP95Ms']<=r['baselineP95Ms']+250 and r['candidateP95Ms']<=r['baselineP95Ms']*1.5 for r in perf['rounds'])
cleanups=[]
for p in out.rglob('cleanup.json'):
 d=json.loads(p.read_text());assert all(d[k] for k in ['volumeRemoved','privateRemoved','containersRemoved','networkRemoved']),str(p);cleanups.append(str(p.relative_to(out)))
result={'status':'PASS','image':digest,'buildRevision':candidate['buildRevision'],'P160Cases':13,'P164Cases':13,'sameCandidateArtifactsChecked':artifacts,'cleanupRecordsChecked':cleanups,'sourceInputsMatched':38,'runnerSha256':summary['runnerSha256'],'performanceProblemsPerGroup':300,'performanceFailures':0,'performanceRounds':[{k:v for k,v in r.items() if k!='samples'} for r in perf['rounds']]}
(b/'final-evidence-qualification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))

bs=json.loads(Path('inbox/source-shortname-conflict/evidence/20261120T050638/browser/summary.json').read_text())
assert bs['status']=='PASS' and bs['headed'] and bs['viewport']=={'width':1440,'height':1000} and not bs['consoleErrors']
measured=[x for x in bs['measurements'] if x['kind'] in ['navigation','save-feedback']]
assert len(measured)==12 and all(x['visibility']=='visible' and x['hasFocus'] for x in measured)
assert len(set(x['label'] for x in measured))==6
assert all(x['runtimeAck']==('unconfirmed' not in x['label']) for x in measured if x['kind']=='save-feedback')
print('browser evidence: six real foreground pairs qualified')

trace=(out/'candidate/r12-client-trace.json').read_text();items=[]
for line in trace.splitlines():
 if line.startswith('{'):
  event=json.loads(line)
  if event.get('type')=='item.completed':items.append(event.get('item',{}))
assert all(x.get('server')=='zb_uat' for x in items if x.get('type')=='mcp_tool_call')
assert not any(x.get('type') in ['command_execution','web_search'] for x in items)
result['controlArtifactsChecked']=['baseline/artifact.json']
result['browserForegroundPairsQualified']=6
result['rc1Tools']=[x['tool'] for x in items if x.get('type')=='mcp_tool_call']
(b/'final-evidence-qualification.json').write_text(json.dumps(result,indent=2)+'\n')
