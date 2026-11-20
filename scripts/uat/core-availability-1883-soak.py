#!/usr/bin/env python3
"""Real 1883-table Docker soak. Own resources only; no customer access/product patch.

Synthetic historical audit rows are fixture input, never claimed as real RPC receipts.
Runtime observations use existing HTTP metrics, /proc and passive native CPU profiling.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, importlib.util, json, math, os
import pathlib, secrets, subprocess, threading, time, datetime, signal

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = ROOT / 'scripts/uat/readyz-diagnostic-repro.py'
source = BASE.read_bytes()
spec = importlib.util.spec_from_file_location('core1883_base', BASE)
base = importlib.util.module_from_spec(spec)
exec(compile(source, str(BASE), 'exec'), base.__dict__)
fx = base.fx
TABLES = [fx.SOURCE] + ['uat_t%04d' % i for i in range(1, 1884)]
BASE_ENABLED = TABLES[:-1] # Always >=1883; spare toggles the actual config digest.
TARGET = TABLES[-2]

PROBES = r'''
const fs=require('node:fs');const {performance}=require('node:perf_hooks');
const dir='/tmp/lucy-core1883';fs.mkdirSync(dir,{recursive:true});
const out=fs.createWriteStream(dir+'/probes.jsonl');let tick=0,pending=0;
const end=performance.now()+Number(process.argv[1])*1000;
const timer=setInterval(()=>{
 if(performance.now()>=end||fs.existsSync(dir+'/stop')){clearInterval(timer);const wait=setInterval(()=>{if(!pending){clearInterval(wait);out.end(()=>fs.writeFileSync(dir+'/probes-done','yes'));}},100);return;}
 const planned=++tick;
 for(const path of ['/api/livez','/api/readyz','/api/health']){
  pending++;const t=performance.now(),at=new Date().toISOString();
  fetch('http://127.0.0.1:5174'+path,{signal:AbortSignal.timeout(3000)})
  .then(async r=>{const b=await r.json();return {status:r.status,diagnostics:b.diagnostics,eventLoop:b.data?.eventLoop,dependencyStatus:b.data?.status,reason:b.reason};})
  .catch(e=>({status:0,error:e.message}))
  .then(r=>out.write(JSON.stringify({tick:planned,at,path,ms:performance.now()-t,...r})+'\n'))
  .finally(()=>pending--);
 }
},1000);
'''

PROC = r'''
import pathlib,json,time,os,sys
d=pathlib.Path('/tmp/lucy-core1883');d.mkdir(exist_ok=True);pid=sys.argv[1]
with (d/'proc.jsonl').open('w') as f:
 while not (d/'stop').exists():
  try:
   p=pathlib.Path('/proc')/pid;s=(p/'task'/pid/'stat').read_text().rsplit(')',1)[1].split()
   row={'at':time.time(),'mono':time.monotonic(),'pid':pid,'state':s[0],'cpuTicks':int(s[11])+int(s[12]),'hz':os.sysconf('SC_CLK_TCK'),'mainWchan':(p/'task'/pid/'wchan').read_text().strip(),'workers':[]}
   for q in pathlib.Path('/proc').iterdir():
    if not q.name.isdigit():continue
    try:
     cmd=(q/'cmdline').read_bytes().split(b'\0')
     if not any(x.endswith(b'/diagnostic-collector-worker.ts') for x in cmd):continue
     row['workers'].append({'pid':q.name,'threads':[{'tid':t.name,'wchan':(t/'wchan').read_text().strip()} for t in (q/'task').iterdir()]})
    except OSError:pass
   for name in ['memory.current','memory.events','cpu.stat']:
    v=pathlib.Path('/sys/fs/cgroup')/name
    if v.exists():row[name]=v.read_text().strip()
  except OSError as e:row={'at':time.time(),'error':str(e)}
  f.write(json.dumps(row)+'\n');f.flush();time.sleep(.25)
'''

PROFILE = r'''
const fs=require('node:fs/promises');const fss=require('node:fs');
(async()=>{
 const dir='/tmp/lucy-core1883';await fs.mkdir(dir,{recursive:true});
 const targets=await (await fetch('http://127.0.0.1:9229/json/list')).json();
 const ws=new WebSocket(targets[0].webSocketDebuggerUrl);let id=0;const waiting=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=waiting.get(m.id);waiting.delete(m.id);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}};
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;waiting.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}));});
 await call('Profiler.enable');await call('Profiler.setSamplingInterval',{interval:10000});
 let n=0;await fs.writeFile(dir+'/profile-ready',new Date().toISOString());
 while(!fss.existsSync(dir+'/stop')){
  const at=new Date().toISOString();await call('Profiler.start');
  for(let i=0;i<60&&!fss.existsSync(dir+'/stop');i++)await new Promise(r=>setTimeout(r,1000));
  const result=await call('Profiler.stop');
  await fs.writeFile(dir+'/cpu-'+String(n++).padStart(3,'0')+'.cpuprofile',JSON.stringify({at,finishedAt:new Date().toISOString(),...result.profile}));
 }
 await call('Profiler.disable');ws.close();await fs.writeFile(dir+'/profile-done','yes');
})().catch(async e=>{await fs.writeFile('/tmp/lucy-core1883/profile-error',String(e));process.exitCode=1});
'''

SEED_AUDIT = r'''
const D=require('/app/webui/node_modules/better-sqlite3');const d=new D('/data/lucy/.ktx-ui/audit.sqlite');d.pragma('busy_timeout=15000');
const count=Number(process.argv[1]),batch=process.argv[2],now=Date.now();
const text='synthetic_1883_history_fixture '.repeat(48);
const insert=d.prepare(`INSERT INTO access_log(ts,user_id,token_label,client,tool,tables,args_summary,generated_sql,query_preview,outcome,duration_ms,request_id,trace_id,lucy_session_id) VALUES (?,?, 'synthetic','uat-core1883-history','lucy_query',?,?,?,?,'ok',50,?,?,?)`);
const start=d.prepare('SELECT COALESCE(MAX(id),0) n FROM access_log').get().n;
for(let offset=0;offset<count;offset+=1000)d.transaction(()=>{for(let i=offset;i<Math.min(count,offset+1000);i++){
 const user='uat-core1883-history-'+String(i%67).padStart(3,'0'),key='core1883-'+batch+'-'+i;
 insert.run(new Date(now-3600000+i).toISOString(),user,JSON.stringify(['uat_begin_zero_orders']),JSON.stringify({fixture:true,payload:text}),text,text,key,key,key);
}})();
console.log(JSON.stringify({fixtureOnly:true,batch,inserted:count,users:67,firstId:start+1,lastId:d.prepare('SELECT MAX(id) n FROM access_log').get().n}));d.close();
'''

class Rig(base.Rig):
    def __init__(self,image,out):
        super().__init__(image,out,'soak1883')
        self.tag='lucy-core1883-'+secrets.token_hex(3)
        self.app,self.db,self.network=self.tag+'-app',self.tag+'-db',self.tag
        self.data_volume=self.tag+'-data'
        self.extra_tables_created=False
        for i in range(1,12):
            value=secrets.token_urlsafe(28);self.tokens['agent%02d'%i]=value;fx.SECRETS.append(value)

    def request(self,*args,**kwargs):
        return fx.Rig.request(self,*args,**kwargs)

    def seed(self):
        boot,env=super().seed()
        config=json.loads((self.project/'ktx.yaml').read_text())
        config['connections'][fx.CONN]['enabled_tables']=[fx.SCHEMA+'.'+t for t in BASE_ENABLED]
        # Match normal deployed block YAML; the line-oriented save route does
        # not accept a JSON document even though read-only parsers accept it.
        yaml_text=fx.run(['node','-e',"const fs=require('fs'),Y=require('./webui/node_modules/yaml');process.stdout.write(Y.stringify(JSON.parse(fs.readFileSync(0,'utf8'))));"],json.dumps(config))
        (self.project/'ktx.yaml').write_text(yaml_text+'\n')
        manifest={'tables':{t:{'table':fx.SCHEMA+'.'+t,'columns':[{'name':'order_id','type':'number','pk':True},{'name':'tenant','type':'string'},{'name':'amount','type':'number'}]} for t in TABLES}}
        (self.project/('config/semantic-layer/'+fx.CONN+'/_schema/uat.yaml')).write_text(json.dumps(manifest))
        for t in TABLES[1:-2]:
            overlay={'name':t,'grain':['order_id'],'measures':[{'name':'order_count','expr':'count(distinct order_id)'},{'name':'amount_sum','expr':'sum(amount)'}]}
            (self.project/('config/semantic-layer/'+fx.CONN+'/'+t+'.yaml')).write_text(json.dumps(overlay))
        self.access['roles']['a']['allow']['tableSelectors']=[{'connection':fx.CONN,'schema':fx.SCHEMA,'names':[fx.SCHEMA+'.'+t for t in TABLES],'row_access':'all'}]
        self.access['users']=[u for u in self.access['users'] if not u['id'].startswith('uat_zb_agent')]
        for key,token in self.tokens.items():
            if not key.startswith('agent'):continue
            self.access['users'].append({'id':'uat_zb_'+key,'name':key,'enabled':True,'role':'a','tokens':[{'hash':'sha256:'+fx.sha(token),'created':'2026-11-20','label':'isolated-soak'}]})
        (self.project/'webui/config/access.yaml').write_text(json.dumps(self.access))
        return boot,env

    def sql(self,sql):
        result=super().sql(sql)
        if sql.startswith('CREATE DATABASE uat;') and not self.extra_tables_created:
            self.extra_tables_created=True
            print('Creating 1883 additional REAL MySQL tables',flush=True)
            commands='\n'.join('CREATE TABLE uat.'+t+' LIKE uat.'+fx.SOURCE+'; INSERT INTO uat.'+t+' SELECT * FROM uat.'+fx.SOURCE+';' for t in TABLES[1:])
            super().sql(commands)
        return result

    def audit_facts(self,full=False):
        return json.loads(self.exec('node','-e',r'''
const D=require('/app/webui/node_modules/better-sqlite3');const d=new D('/data/lucy/.ktx-ui/audit.sqlite',{readonly:true});d.pragma('busy_timeout=5000');
const full=process.argv[1]==='full';
const raw=full?d.prepare("SELECT COUNT(*) n,COUNT(DISTINCT user_id) users,MIN(id) minId,MAX(id) maxId FROM access_log WHERE client='uat-core1883-history'").get():null;
const states=d.prepare('SELECT status,COUNT(*) n FROM inferred_rebuild_state GROUP BY status').all();
const linked=full?d.prepare("SELECT COUNT(*) n,COUNT(DISTINCT l.access_log_id) uniqueN FROM inferred_turn_access_logs l JOIN access_log a ON a.id=l.access_log_id WHERE a.client='uat-core1883-history'").get():d.prepare('SELECT COUNT(*) n,COUNT(DISTINCT access_log_id) uniqueN FROM inferred_turn_access_logs').get();
console.log(JSON.stringify({at:new Date().toISOString(),raw,states,linked}));d.close();
''','full' if full else 'fast'))

    def scale_facts(self):
        physical=int(self.sql("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='uat' AND TABLE_TYPE='BASE TABLE';"))
        config=json.loads(self.exec('node','-e',r'''
const fs=require('node:fs'),Y=require('/app/webui/node_modules/yaml'),C=require('node:crypto');
const c=fs.readFileSync('/data/lucy/ktx.yaml'),m=fs.readFileSync('/data/lucy/config/semantic-layer/uat-mysql/_schema/uat.yaml');
console.log(JSON.stringify({enabled:Y.parse(c.toString()).connections['uat-mysql'].enabled_tables.length,manifest:Object.keys(Y.parse(m.toString()).tables).length,configSha256:C.createHash('sha256').update(c).digest('hex'),manifestSha256:C.createHash('sha256').update(m).digest('hex')}));
'''))
        return {'physical':physical,**config}

def percentile(rows,p):
    values=sorted(r['ms'] for r in rows)
    return values[max(0,math.ceil(len(values)*p)-1)] if values else None

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--image',required=True);parser.add_argument('--out',required=True)
    parser.add_argument('--seconds',type=int,default=7200);parser.add_argument('--cycle-seconds',type=int,default=300)
    args=parser.parse_args();fx.require(args.seconds>=7200,'formal soak requires >=7200 seconds')
    root=pathlib.Path(args.out);root.mkdir(parents=True,exist_ok=True)
    def interrupted(_signum,_frame):raise InterruptedError('test explicitly interrupted; retain failed qualification evidence')
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    rig=Rig(args.image,root/'candidate');stop=threading.Event();results=[];lock=threading.Lock();threads=[]
    summary={'startedAt':fx.now(),'runnerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'baseHelperSha256':base.HELPER_HASH,'secondsRequired':args.seconds,'status':'RUNNING'}
    def event(kind,**data):
        item={'at':fx.now(),'kind':kind,**data}
        with lock:
            results.append(item)
            with (root/'events.jsonl').open('a') as f:f.write(fx.scrub(json.dumps(item,ensure_ascii=False))+'\n')
        return item
    def tick_worker(kind,period,action):
        start=time.monotonic();n=0
        while not stop.is_set() and time.monotonic()-start<args.seconds:
            t=start+n*period
            if stop.wait(max(0,t-time.monotonic())):break
            call_started=time.monotonic()
            try:action(n)
            except Exception as e:event(kind,error=fx.scrub(str(e)),iteration=n,ms=(time.monotonic()-call_started)*1000)
            n+=1
    try:
        print('Starting isolated real 1883-table fixture',flush=True);rig.start()
        scale=rig.scale_facts();rig.save('scale-initial',scale)
        fx.require(all(scale[k]>=1883 for k in ['physical','enabled','manifest']),'scale not met')
        rig.save('mcp-initial',rig.mcp_check('soak-initial'))
        # Attach only the native inspector profiler; do not monkeypatch runtime functions.
        pid=rig.exec('python3','-c',r'''
import pathlib
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  args=(p/'cmdline').read_bytes().split(b'\0')
  if (p/'comm').read_text().strip()=='node' and any(x==b'server/index.ts' or x.endswith(b'/server/index.ts') for x in args):print(p.name);break
 except OSError:pass
''').strip();fx.require(pid.isdigit(),'actual server PID missing')
        rig.exec('node','-e',"process.kill(Number(process.argv[1]),'SIGUSR1')",pid)
        time.sleep(.5)
        fx.run(['docker','exec','-d',rig.app,'node','-e',PROFILE])
        profile_ready=False
        for _ in range(30):
            observed=fx.run(['docker','exec',rig.app,'sh','-c','test -f /tmp/lucy-core1883/profile-ready && echo ready'],check=False)
            if observed=='ready':profile_ready=True;break
            time.sleep(.5)
        fx.require(profile_ready,'native profiler failed to attach; keep diagnostic data separate')
        fx.run(['docker','exec','-d',rig.app,'python3','-c',PROC,pid])
        fx.run(['docker','exec','-d',rig.app,'node','-e',PROBES,str(args.seconds+120)])
        print('Seeding 200000 padded synthetic historical audit rows / 67 users',flush=True)
        seeded=json.loads(rig.exec('node','-e',SEED_AUDIT,'200000','initial',timeout=240));rig.save('audit-seed-initial',seeded)
        initial_audit=rig.audit_facts(full=True);rig.save('audit-initial-facts',initial_audit)
        fx.require(initial_audit['raw']['n']>=200000 and initial_audit['raw']['users']==67,'audit scale not met')
        manifest=json.loads((rig.project/('config/semantic-layer/'+fx.CONN+'/_schema/uat.yaml')).read_text())
        started=time.monotonic();summary['soakStartedAt']=fx.now();summary['mainPid']=pid
        (root/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')

        def http(n):
            r=rig.request(rig.web,'/api/project',timeout=3)
            event('http',iteration=n,status=r['httpStatus'],ms=r['elapsedMs'])
        identities=['a']+['agent%02d'%i for i in range(1,12)]
        def mcp(n):
            r=rig.query('soak-query-%d'%n,who=identities[n%12],session='independent-question-%d'%n,save=False)
            event('mcp',iteration=n,status=r['httpStatus'],ms=r['elapsedMs'],oracle='4/100')
        def audit(n):
            facts=rig.audit_facts();event('audit-progress',**facts)
        def mutate(n):
            begin=event('mutation-start',iteration=n)
            # Leave no broken overlay/reference: only this raw manifest source is renamed.
            new_name=TARGET if n%2 else 'uat_renamed1882'
            old_name='uat_renamed1882' if TARGET not in manifest['tables'] else TARGET
            if new_name!=old_name:manifest['tables'][new_name]=manifest['tables'].pop(old_name)
            if n>0:
                seeded=json.loads(rig.exec('node','-e',SEED_AUDIT,'3000','cycle-%d'%n,timeout=60));event('audit-seed',**seeded)
            payload={'connectionId':fx.CONN,'schema':fx.SCHEMA,'assetKind':'schema_manifest','filename':'uat.yaml','content':json.dumps(manifest),'confirmOverwrite':True}
            enabled=TABLES if n%2==0 else BASE_ENABLED
            for verb,path,body in [('POST','/api/catalog/assets/validate',payload),('POST','/api/catalog/assets/upload',payload),('PUT','/api/connections/'+fx.CONN+'/enabled-tables',{'enabledTables':[fx.SCHEMA+'.'+t for t in enabled],'dryRun':False})]:
                r=rig.request(rig.web,path,verb,body,timeout=180);rig.save('cycle-%d-%s'%(n,path.rsplit('/',1)[-1]),r)
                event('mutation-step',iteration=n,path=path,status=r['httpStatus'],ms=r['elapsedMs'],ok=r['body'].get('ok'),dataSummary={k:r['body'].get('data',{}).get(k) for k in ['valid','uploaded','written','policyRuntimeAck','runtimeAck']},error=r['body'].get('error'))
                fx.require(r['httpStatus']==200 and r['body'].get('ok') is True,'mutation failed '+path)
                data=r['body'].get('data',{})
                if path.endswith('/validate'):fx.require(data.get('valid') is True,'manifest validation rejected')
                if path.endswith('/upload'):fx.require(data.get('uploaded') is True,'manifest upload not committed')
                if path.endswith('/enabled-tables'):fx.require(all(data.get(k) is True for k in ['written','policyRuntimeAck','runtimeAck']),'enabled tables runtime acknowledgment incomplete')
            pid_before=rig.exec('cat','/data/lucy/.ktx-ui/ktx.pid').strip()
            reload_start=event('reload-start',iteration=n)
            r=rig.request(rig.web,'/api/admin/mcp-runtime/reload','POST',{'connectionId':fx.CONN,'reason':'isolated 1883-table soak cycle'},timeout=90)
            rig.save('cycle-%d-reload'%n,r);data=r['body'].get('data',{})
            pid_after=rig.exec('cat','/data/lucy/.ktx-ui/ktx.pid').strip()
            event('reload-end',iteration=n,status=r['httpStatus'],ms=r['elapsedMs'],reloadStatus=data.get('reloadStatus'),configVerification=data.get('configVerification'),pidBefore=pid_before,pidAfter=pid_after)
            fx.require(r['httpStatus']==200 and data.get('reloadStatus')=='succeeded','real execution reload failed')
            fx.require(pid_before!=pid_after,'reload did not restart actual KTX process')
            # A real read proves the new short name is served, not just written.
            read=rig.call('cycle-%d-renamed-read'%n,'lucy_read_source',{'connectionId':fx.CONN,'sourceName':new_name},session='rename-check-%d'%n)
            fx.require(fx.successful(read),'renamed source not readable')
            rig.save('cycle-%d-mcp-recovery'%n,rig.mcp_check('cycle-%d-recovery'%n))
            event('mutation-end',iteration=n,shortName=new_name,scale=rig.scale_facts())

        for kind,period,fn in [('http',1,http),('mcp',5,mcp),('audit-progress',5,audit),('mutation',args.cycle_seconds,mutate)]:
            t=threading.Thread(target=tick_worker,args=(kind,period,fn),daemon=True);threads.append(t);t.start()
        last_minute=-1
        while time.monotonic()-started<args.seconds:
            elapsed=time.monotonic()-started;minute=int(elapsed//60)
            if minute!=last_minute:
                last_minute=minute
                with lock:snap=list(results)
                progress={'elapsedSeconds':round(elapsed,1),'minutesRequired':args.seconds/60,'http':sum(x['kind']=='http' for x in snap),'mcp':sum(x['kind']=='mcp' for x in snap),'completedMutations':sum(x['kind']=='mutation-end' for x in snap),'errors':sum('error' in x and bool(x['error']) for x in snap)}
                (root/'progress.json').write_text(json.dumps(progress,indent=2)+'\n');print(json.dumps(progress),flush=True)
            time.sleep(1)
        stop.set()
        for t in threads:t.join(timeout=200)
        summary['soakElapsedSeconds']=round(time.monotonic()-started,3);summary['soakFinishedAt']=fx.now()
        # Separate I/O control after natural workload. No writes/reloads during it.
        print('Natural soak complete; applying separate real diagnostic FIFO control',flush=True)
        event('io-control-start');rig.inject();time.sleep(60)
        rig.save('io-control-proof',rig.processes());rig.signal_fixture('restore-path');time.sleep(15)
        rig.save('io-control-recovery',rig.health());rig.signal_fixture('release');event('io-control-end')
        rig.save('mcp-final',rig.mcp_check('soak-final'));rig.save('scale-final',rig.scale_facts());rig.save('audit-final-facts',rig.audit_facts(full=True))
        rig.exec('touch','/tmp/lucy-core1883/stop');time.sleep(3)
        fx.run(['docker','cp',rig.app+':/tmp/lucy-core1883',str(root/'observations')],timeout=120)
        rig.logs('final-container-log')
        probes=[json.loads(x) for x in (root/'observations/probes.jsonl').read_text().splitlines()]
        def epoch(value):return datetime.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
        natural=[x for x in probes if epoch(summary['soakStartedAt'])<=epoch(x['at'])<=epoch(summary['soakFinishedAt'])]
        summary['probeSummary']={}
        for path in ['/api/livez','/api/readyz','/api/health']:
            rows=[x for x in natural if x['path']==path];summary['probeSummary'][path]={'count':len(rows),'non200':sum(x['status']!=200 for x in rows),'p99Ms':percentile(rows,.99),'maxMs':max(x['ms'] for x in rows)}
        summary['completedMutations']=sum(x['kind']=='mutation-end' for x in results)
        summary['eventErrors']=[x for x in results if x.get('error')]
        reloads={}
        for x in results:
            if x['kind']=='reload-start':reloads[x['iteration']]={'start':epoch(x['at'])}
            if x['kind']=='reload-end':reloads.setdefault(x['iteration'],{}).update(end=epoch(x['at']),success=x['reloadStatus']=='succeeded')
        expected=[];unexpected=[]
        for x in summary['eventErrors']:
            t=epoch(x['at']);request_start=t-x.get('ms',0)/1000;reason=str(x['error']).lower()
            transient=any(k in reason for k in ['upstream','unavailable','execution_config_stale','remote end closed','timed out','connection refused','connection reset','mcp session']) and 'question_budget_' not in reason
            in_reload=any(v.get('success') and request_start<=v['end']+10 and t>=v['start'] for v in reloads.values())
            (expected if x['kind']=='mcp' and transient and in_reload else unexpected).append(x)
        summary['expectedReloadErrors']=expected;summary['unexpectedErrors']=unexpected
        loops=[x.get('eventLoop',{}).get('maxMs',0) for x in natural if x['path']=='/api/health'];summary['maxEventLoopDelayMs']=max(loops,default=0)
        summary['budgetPassed']=summary['probeSummary']['/api/livez']['p99Ms']<=400 and summary['probeSummary']['/api/livez']['maxMs']<=1000 and summary['probeSummary']['/api/readyz']['p99Ms']<=1500
        summary['status']='PASS WITH GAP' if summary['soakElapsedSeconds']>=args.seconds and summary['completedMutations']>=args.seconds//args.cycle_seconds and all(x['non200']==0 for x in summary['probeSummary'].values()) and not unexpected and summary['budgetPassed'] else 'FAIL'
    except Exception as e:
        summary['status']='FAIL';summary['error']=fx.scrub(str(e));print('ERROR: '+summary['error'],flush=True)
        try:rig.logs('failure-container-log')
        except Exception:pass
        try:
            if not (root/'observations').exists():fx.run(['docker','cp',rig.app+':/tmp/lucy-core1883',str(root/'observations')],check=False)
        except Exception:pass
    finally:
        stop.set()
        for t in threads:t.join(timeout=10)
        try:rig.close()
        except Exception as e:summary['cleanupError']=fx.scrub(str(e));summary['status']='FAIL'
        summary['finishedAt']=fx.now();(root/'summary.json').write_text(fx.scrub(json.dumps(summary,indent=2))+'\n')
    print(json.dumps(summary,indent=2),flush=True)
    return 1 if summary['status']=='FAIL' else 0

if __name__=='__main__':raise SystemExit(main())
