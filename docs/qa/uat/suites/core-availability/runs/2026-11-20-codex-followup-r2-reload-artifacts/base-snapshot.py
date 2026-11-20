#!/usr/bin/env python3
"""Real Docker/FIFO/HTTP/MCP experiment; no product source patch or customer access.

Uses the existing isolated MySQL fixture helper, pinned by hash in the run record.
FIFO is an OS I/O fault, not a mock collector. Only owns lucy-readyz-* resources.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, importlib.util, json, os
import pathlib, secrets, subprocess, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
HELPER = ROOT / 'scripts/uat/verify-begin-zero-binding.py'
HELPER_SOURCE = HELPER.read_bytes()
HELPER_HASH = hashlib.sha256(HELPER_SOURCE).hexdigest()
spec = importlib.util.spec_from_file_location('readyz_fixture', HELPER)
fx = importlib.util.module_from_spec(spec)
exec(compile(HELPER_SOURCE, str(HELPER), 'exec'), fx.__dict__)

FIFO_PROGRAM = r'''
import os,time,json,pathlib
d=pathlib.Path('/tmp/uat-readyz-fifo');d.mkdir(exist_ok=True)
p=pathlib.Path('/data/lucy/.ktx-ui/ktx-reload.state.json')
b=p.with_name(p.name+'.uat-readyz-backup')
if p.exists(): os.replace(p,b)
else: b.write_text('{"activation":"unknown","reload":{"state":"idle"},"verification":{"state":"unverified"}}')
os.mkfifo(p,0o600);os.chown(p,10001,10001)
fd=os.open(p,os.O_RDWR|os.O_NONBLOCK)
(d/'ready').write_text(json.dumps({'pid':os.getpid(),'path':str(p),'inode':p.stat().st_ino,'kind':'FIFO','time':time.time()}))
restored=False
while not (d/'release').exists():
 if (d/'restore-path').exists() and not restored:
  p.unlink();os.replace(b,p);os.chown(p,10001,10001);restored=True
  (d/'restored').write_text('regular file restored; old FIFO handle still held')
 time.sleep(.1)
if not restored:
 p.unlink();os.replace(b,p);os.chown(p,10001,10001)
os.write(fd,b'{"activation":"unknown","reload":{"state":"idle"},"verification":{"state":"unverified"}}')
os.close(fd)
(d/'released').write_text('old FIFO released; existing readFile calls may settle')
'''

SAMPLE_PROGRAM = r'''
(async()=>{
 const samples=[];const end=performance.now()+Number(process.argv[1])*1000;
 while(performance.now()<end){
  const tick=performance.now();
  const pair=await Promise.all(['/api/livez','/api/readyz'].map(async path=>{
   const start=performance.now();try{
    const r=await fetch('http://127.0.0.1:5174'+path,{signal:AbortSignal.timeout(3000)});
    const body=await r.json();return {at:new Date().toISOString(),path,status:r.status,ms:performance.now()-start,diagnostics:body.diagnostics};
   }catch(e){return {at:new Date().toISOString(),path,status:0,ms:performance.now()-start,error:e.message}}
  }));samples.push(...pair);
  await new Promise(r=>setTimeout(r,Math.max(0,1000-(performance.now()-tick))));
 } console.log(JSON.stringify(samples));
})().catch(e=>{console.error(e);process.exitCode=1});
'''

OBSERVER_PROGRAM = r'''
import pathlib,json,time
d=pathlib.Path('/tmp/uat-readyz-observer');d.mkdir(exist_ok=True)
with (d/'samples.jsonl').open('w') as f:
 while not (d/'stop').exists():
  rows=[]
  for p in pathlib.Path('/proc').iterdir():
   if not p.name.isdigit():continue
   try:
    cmd=(p/'cmdline').read_bytes()
    if b'diagnostic-collector-worker.ts' not in cmd or not cmd.startswith(b'/'):continue
    threads=[{'tid':t.name,'wchan':(t/'wchan').read_text().strip()} for t in (p/'task').iterdir()]
    rows.append({'pid':p.name,'threads':threads})
   except OSError:pass
  f.write(json.dumps({'mono':time.monotonic(),'workers':rows})+'\n');f.flush();time.sleep(.25)
'''

class Rig(fx.Rig):
    def __init__(self, image, out, label):
        super().__init__(image, out, label)
        self.tag='lucy-readyz-'+label+'-'+secrets.token_hex(3)
        self.app,self.db,self.network=self.tag+'-app',self.tag+'-db',self.tag
        self.data_volume=self.tag+'-data'

    def request(self,base,route,method='GET',body=None,headers=None,timeout=15,admin=True):
        # Respect the explicitly declared caller budget. A hidden 15s cap made
        # reload/collection callers report a budget they never actually used.
        return super().request(base,route,method,body,headers,timeout,admin)

    def exec(self, *args, data=None, timeout=60):
        return fx.run(['docker','exec','-i',self.app,*args],data,timeout=timeout)

    def health(self, timeout=4):
        return self.request(self.web,'/api/health',timeout=timeout,admin=False)

    def sample(self, seconds):
        raw=self.exec('node','-e',SAMPLE_PROGRAM,str(seconds),timeout=seconds+20)
        return json.loads(raw)

    def inject(self):
        fx.run(['docker','exec','-d','--user','0',self.app,'python3','-c',FIFO_PROGRAM])
        for _ in range(40):
            r=fx.run(['docker','exec',self.app,'cat','/tmp/uat-readyz-fifo/ready'],check=False)
            if r:
                self.save('fifo-proof',json.loads(r));return
            time.sleep(.1)
        raise RuntimeError('real FIFO injection did not become ready')

    def signal_fixture(self,name):
        fx.run(['docker','exec','--user','0',self.app,'touch','/tmp/uat-readyz-fifo/'+name])

    def processes(self):
        code=r'''
import pathlib,json,os,stat
rows=[]
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit(): continue
 try:
  if (p/'comm').read_text().strip()!='node':continue
  threads=[]
  for t in (p/'task').iterdir():
   w=(t/'wchan').read_text().strip()
   if 'pipe' in w or 'partner' in w:threads.append({'tid':t.name,'wchan':w})
  if threads:rows.append({'pid':p.name,'blockedThreads':threads})
 except (OSError,PermissionError):pass
target=pathlib.Path('/data/lucy/.ktx-ui/ktx-reload.state.json')
s=target.stat();print(json.dumps({'time':time.time() if False else __import__('time').time(),'file':{'kind':'fifo' if stat.S_ISFIFO(s.st_mode) else 'regular','inode':s.st_ino},'processes':rows}))
'''
        return json.loads(self.exec('python3','-c',code))

    def mcp_check(self,name):
        session='readyz-'+name
        init=self.call(name+'-init',method='initialize',session=session)
        tools=self.call(name+'-tools',method='tools/list',session=session)
        fx.require(fx.successful(init) and fx.successful(tools),'MCP protocol failed')
        result=self.query(name+'-query',session=session)
        http=self.api(name+'-project','/api/project',method='GET')
        return {'initialize':init['httpStatus'],'toolsList':tools['httpStatus'],'query':result['httpStatus'],'oracle':'count=4,sum=100','httpProject':http['httpStatus']}

    def logs(self,name,timeout=30):
        r=subprocess.run(['docker','logs','--timestamps',self.app],capture_output=True,text=True,timeout=timeout)
        self.save(name,fx.scrub(r.stdout+r.stderr))

def stats(samples):
    out={}
    for path in ['/api/livez','/api/readyz']:
        group=[x for x in samples if x['path']==path];ms=sorted(x['ms'] for x in group)
        out[path]={'count':len(group),'non200':sum(x['status']!=200 for x in group),
                   'p99Ms':ms[max(0,__import__('math').ceil(.99*len(ms))-1)] if ms else None,
                   'maxMs':max(ms) if ms else None}
    return out

def verify_repair(args):
    """Focused F61 real-stop/recovery regression; F63 uses --assess-only."""
    root=pathlib.Path(args.out);root.mkdir(parents=True,exist_ok=True)
    rig=Rig(args.candidate_image,root/'candidate','repair')
    result={'startedAt':fx.now(),'helperSha256':HELPER_HASH,'scope':'F61 real process termination/recovery; not full F61/F63'}
    try:
        print('Starting real repaired diagnostic fixture',flush=True);rig.start()
        for _ in range(40):
            initial=rig.health()
            if initial['body'].get('diagnostics',{}).get('freshness')=='fresh':break
            time.sleep(.5)
        fx.require(initial['body']['diagnostics']['freshness']=='fresh','initial diagnostics not fresh')
        rig.save('initial-fresh',initial);rig.save('mcp-before',rig.mcp_check('repair-before'))
        fx.run(['docker','exec','-d',rig.app,'python3','-c',OBSERVER_PROGRAM])
        rig.inject()
        proof=None
        for _ in range(80):
            proof=rig.processes()
            if proof['processes']:break
            time.sleep(.25)
        rig.save('actual-blocked-reader',proof)
        fx.require(bool(proof['processes']),'OS blocked-reader witness absent')
        print('Sampling 120-second real diagnostic fault',flush=True)
        samples=rig.sample(args.seconds);rig.save('blocked-window-samples',samples)
        measurements=stats(samples);result['probeBudget']=measurements
        fx.require(args.seconds>=120 and all(x['count']>=120 and x['non200']==0 and x['p99Ms']<=100 and x['maxMs']<=500 for x in measurements.values()),'probe budget failed')
        stale=rig.health();rig.save('stale-after-timeouts',stale)
        fx.require(stale['body']['diagnostics']['freshness']=='stale','persistent fault not stale')
        fx.require(stale['body']['diagnostics']['observedAt']==initial['body']['diagnostics']['observedAt'],'timeout advanced observedAt')
        rig.save('mcp-during',rig.mcp_check('repair-during'))
        print('Restoring path WITHOUT releasing old FIFO; requiring autonomous recovery',flush=True)
        rig.signal_fixture('restore-path');start=time.monotonic();observations=[]
        for _ in range(35):
            h=rig.health();observations.append(h)
            if h['body']['diagnostics']['freshness']=='fresh':break
            time.sleep(.5)
        rig.save('path-only-recovery',observations)
        fx.require(observations[-1]['body']['diagnostics']['freshness']=='fresh','path restoration did not recover without releasing old FIFO')
        fx.require(observations[-1]['body']['diagnostics']['observedAt']!=initial['body']['diagnostics']['observedAt'],'recovery did not publish new observation')
        result['autonomousRecovery']={'fresh':True,'elapsedS':round(time.monotonic()-start,3),'oldFifoReleased':False}
        rig.save('mcp-after',rig.mcp_check('repair-after'))
        # Prove a second timeout/recovery on the SAME process/volume.
        rig.signal_fixture('release');time.sleep(.3)
        fx.run(['docker','exec','--user','0',rig.app,'rm','-rf','/tmp/uat-readyz-fifo'])
        before=rig.health();rig.inject()
        for _ in range(45):
            h=rig.health()
            if h['body']['diagnostics']['freshness']=='stale':break
            time.sleep(.5)
        rig.save('second-timeout',h);fx.require(h['body']['diagnostics']['freshness']=='stale','second timeout not stale')
        rig.signal_fixture('restore-path');again=[]
        for _ in range(35):
            again.append(rig.health())
            if again[-1]['body']['diagnostics']['freshness']=='fresh':break
            time.sleep(.5)
        rig.save('second-recovery',again);fx.require(again[-1]['body']['diagnostics']['freshness']=='fresh','second timeout failed to recover')
        result['secondRecovery']={'fresh':True,'oldFifoReleased':False}
        fx.run(['docker','exec',rig.app,'touch','/tmp/uat-readyz-observer/stop']);time.sleep(.4)
        timeline=[json.loads(x) for x in rig.exec('cat','/tmp/uat-readyz-observer/samples.jsonl').splitlines()]
        rig.save('worker-observations',timeline)
        seen={}
        for tick in timeline:
            for worker in tick['workers']:
                entry=seen.setdefault(worker['pid'],{'first':tick['mono'],'last':tick['mono'],'blocked':False})
                entry['last']=tick['mono'];entry['blocked']|=any('pipe_read' in x['wchan'] or 'wait_for_partner' in x['wchan'] for x in worker['threads'])
        result['workerBound']={'maxConcurrent':max(len(t['workers']) for t in timeline),'observedWorkers':len(seen),
            'maxObservedLifetimeS':max(v['last']-v['first'] for v in seen.values()),'actuallyBlockedWorkers':sum(v['blocked'] for v in seen.values()),'samplingIntervalS':.25}
        fx.require(result['workerBound']['maxConcurrent']<=1 and result['workerBound']['maxObservedLifetimeS']<=5.75 and result['workerBound']['actuallyBlockedWorkers']>=2,'real worker termination/single-flight bound failed')
        rig.logs('container-log')
    except Exception as e:
        result['error']=fx.scrub(str(e));print('ERROR: '+result['error'],flush=True)
        try:rig.logs('failure-container-log')
        except Exception:pass
    finally:
        try:rig.signal_fixture('release')
        except Exception:pass
        try:rig.close()
        except Exception as e:result['cleanupError']=fx.scrub(str(e))
        result['verdict']='FAIL' if 'error' in result or 'cleanupError' in result else 'PASS WITH GAP'
        result['finishedAt']=fx.now()
        (root/'summary.json').write_text(fx.scrub(json.dumps(result,ensure_ascii=False,indent=2))+'\n')
    print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)
    return 1 if result['verdict']=='FAIL' else 0

def assess(args):
    """Scoped real-entry checks for batches 2/3; deliberately not full F62/F63."""
    root=pathlib.Path(args.out);root.mkdir(parents=True,exist_ok=True)
    rig=Rig(args.candidate_image,root/'candidate','assessment')
    result={'startedAt':fx.now(),'helperSha256':HELPER_HASH,
            'diagnosticFaultInjected':not args.no_fault,
            'scope':'scoped export and real 10-second MySQL operation plus TERM; not whole-suite PASS'}
    try:
        print('Starting scoped batch-2/3 fixture',flush=True);rig.start()
        rig.save('mcp-before',rig.mcp_check('assessment-before'))
        if not args.no_fault:
            rig.inject()
            for _ in range(24):
                health=rig.health()
                if health['body'].get('diagnostics',{}).get('freshness')=='stale':break
                time.sleep(1)
            rig.save('stuck-diagnostics',health);rig.save('blocked-io-proof',rig.processes())
        else:
            rig.save('unfaulted-diagnostics',rig.health())
        print('Calling real audit export (diagnostic fault='+str(not args.no_fault)+')',flush=True)
        exports=[]
        def export(_):
            r=rig.request(rig.web,'/api/admin/audit/turns/export?hours=24',timeout=10)
            return {'status':r['httpStatus'],'elapsedMs':r['elapsedMs'],'payloadSha256':fx.sha(json.dumps(r['body'],sort_keys=True)),
                    **({'rejection':r['body']} if r['httpStatus']!=200 else {})}
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            exports=list(pool.map(export,range(12)))
        rig.save('real-export-requests',exports)
        after=rig.health();rig.save('diagnostics-after-exports',after)
        result['batch2']={'statuses':{str(code):sum(x['status']==code for x in exports) for code in sorted(set(x['status'] for x in exports))},
            'maxMs':max(x['elapsedMs'] for x in exports),'diagnosticsStillStale':after['body'].get('diagnostics',{}).get('freshness')=='stale',
            'meaning':'actual audit_export adapter executed; does not cancel/recover diagnostic file I/O; no global-capacity conformance claim'}

        # Preserve the same physical source name, permission model and 4/100 oracle;
        # make MySQL actually evaluate SLEEP once when amount is aggregated.
        rig.sql('RENAME TABLE uat.'+fx.SOURCE+' TO uat.uat_orders_base; CREATE VIEW uat.'+fx.SOURCE+
                ' AS SELECT order_id,tenant,amount+IF(order_id=1,SLEEP(10),0) AS amount FROM uat.uat_orders_base;')
        print('Waiting for actual MySQL User sleep, then sending TERM',flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            pending=pool.submit(lambda:rig.query('actual-slow-query',session='actual-slow-query'))
            sleeping=False
            for _ in range(40):
                count=rig.sql("SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE STATE='User sleep';")
                if count.strip()!='0':sleeping=True;break
                time.sleep(.25)
            rig.save('mysql-inflight-witness',{'time':fx.now(),'userSleepObserved':sleeping,'count':count})
            fx.require(sleeping,'real MySQL in-flight operation not observed; drain proof invalid')
            start=time.monotonic();fx.run(['docker','kill','--signal','TERM',rig.app])
            ack=''
            for _ in range(20):
                ack=fx.run(['docker','exec',rig.app,'cat','/data/lucy/.ktx-ui/lucy-process-drain.ack'],check=False)
                if 'phase=DRAINING' in ack:break
                if pending.done():break
                time.sleep(.1)
            probes={}
            if 'phase=DRAINING' in ack:
                for route in ['/api/livez','/api/readyz','/api/health']:
                    try:probes[route]=rig.request(rig.web,route,timeout=2,admin=False)
                    except Exception as e:probes[route]={'error':fx.scrub(str(e))}
                try:probes['newMcp']=rig.call('new-rpc-while-draining',method='tools/list',session='drain-reject')
                except Exception as e:probes['newMcp']={'error':fx.scrub(str(e))}
            rig.save('confirmed-drain-probes',{'ack':ack,'probes':probes})
            try:
                response=pending.result(timeout=25)
                query={'success':True,'status':response['httpStatus'],'elapsedMs':response['elapsedMs'],'oracle':'count=4,sum=100'}
            except Exception as e:query={'success':False,'error':fx.scrub(str(e))}
            states=[]
            for _ in range(45):
                state=json.loads(fx.run(['docker','inspect',rig.app,'--format','{{json .State}}']))
                states.append({'elapsedS':round(time.monotonic()-start,3),'running':state['Running'],'exitCode':state['ExitCode'],'oomKilled':state['OOMKilled']})
                if not state['Running']:break
                time.sleep(1)
        rig.save('slow-query-drain-states',states);rig.logs('slow-query-drain-log')
        result['batch3']={'actualMysqlSleepObserved':sleeping,'query':query,'exited':not states[-1]['running'],
            'exitElapsedS':states[-1]['elapsedS'],'exitCode':states[-1]['exitCode'],'diagnosticFaultPresentDuringTerm':not args.no_fault,
            'drainAckObserved':'phase=DRAINING' in ack,'probeStatuses':{k:v.get('httpStatus',0) for k,v in probes.items()},
            'meaning':'single real in-flight query/TERM case; not 100-race or all recovery conformance'}
        result['drainChecks']={
            'queryCompleted':query['success'],
            'exitWithin40s':not states[-1]['running'] and states[-1]['elapsedS']<=40,
            'confirmedProbeSemantics':result['batch3']['probeStatuses']=={'/api/livez':200,'/api/readyz':503,'/api/health':200,'newMcp':503}
        }
        fx.require(not states[-1]['running'],'container did not exit within observation budget')
        # Restart the SAME container and data volume after removing only our
        # synthetic fault. No product patch, permission change or reseeding.
        rig.sql('DROP VIEW uat.'+fx.SOURCE+'; RENAME TABLE uat.uat_orders_base TO uat.'+fx.SOURCE+';')
        if not args.no_fault:
            restore="import pathlib,os; p=pathlib.Path('/data/lucy/.ktx-ui/ktx-reload.state.json'); b=p.with_name(p.name+'.uat-readyz-backup'); p.unlink(); os.replace(b,p); os.chown(p,10001,10001)"
            fx.run(['docker','run','--rm','--user','0','--entrypoint','python3','-v',rig.data_volume+':/data/lucy',rig.image,'-c',restore])
        fx.run(['docker','start',rig.app]);rig.save('same-volume-restart-health',rig.ready())
        rig.save('same-volume-restart-mcp',rig.mcp_check('restart'))
        result['sameVolumeRestart']={'httpAndPureMcp':True,'oracle':'count=4,sum=100','noReseed':True}
    except Exception as e:
        result['error']=fx.scrub(str(e));print('ERROR: '+result['error'],flush=True)
        try:rig.logs('failure-container-log')
        except Exception:pass
    finally:
        try:rig.signal_fixture('release')
        except Exception:pass
        try:rig.close()
        except Exception as e:result['cleanupError']=fx.scrub(str(e))
        result['verdict']='FAIL' if 'error' in result or not result.get('drainChecks') or not all(result['drainChecks'].values()) else 'PASS WITH GAP'
        result['finishedAt']=fx.now()
        (root/'summary.json').write_text(fx.scrub(json.dumps(result,ensure_ascii=False,indent=2))+'\n')
    print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)
    return 1 if result['verdict']=='FAIL' else 0

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--baseline-image',required=True)
    parser.add_argument('--candidate-image',required=True);parser.add_argument('--out',required=True)
    parser.add_argument('--seconds',type=int,default=120);parser.add_argument('--assess-only',action='store_true')
    parser.add_argument('--verify-repair',action='store_true')
    parser.add_argument('--no-fault',action='store_true',help='assessment control: real query/TERM without diagnostic FIFO');args=parser.parse_args()
    if args.no_fault and not args.assess_only:parser.error('--no-fault requires --assess-only')
    if args.verify_repair and args.assess_only:parser.error('choose --verify-repair or --assess-only')
    if args.verify_repair:return verify_repair(args)
    if args.assess_only:return assess(args)
    root=pathlib.Path(args.out);root.mkdir(parents=True,exist_ok=True)
    rigs=[];summary={'startedAt':fx.now(),'method':'real OS FIFO at diagnostic reload-state file; source-derived lab images; not customer root-cause proof',
        'helperSha256':HELPER_HASH,'results':{}}
    def checkpoint():
        (root/'summary.json').write_text(fx.scrub(json.dumps(summary,ensure_ascii=False,indent=2))+'\n')
    try:
        baseline=Rig(args.baseline_image,root/'baseline','baseline');rigs.append(baseline)
        print('Starting baseline real fixture',flush=True);baseline.start()
        baseline.save('ready-before-fault',baseline.request(baseline.web,'/api/readyz',admin=False))
        baseline.inject()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            pending=pool.submit(lambda: baseline.request(baseline.web,'/api/readyz',timeout=4,admin=False))
            time.sleep(2);proof=baseline.processes();baseline.save('blocked-io-proof',proof)
            live=baseline.request(baseline.web,'/api/livez',timeout=3,admin=False)
            try: ready=pending.result();blocked=False
            except Exception as e:ready={'error':str(e)};blocked=True
        baseline.save('fault-requests',{'readyz':ready,'livez':live})
        fx.require(blocked and live['httpStatus']==200,'baseline target shape not reproduced')
        summary['results']['baseline']={'readyzBlocked':blocked,'livez':live['httpStatus'],'blockedIoWitness':proof}
        baseline.signal_fixture('release');time.sleep(2)
        baseline.save('ready-after-release',baseline.request(baseline.web,'/api/readyz',timeout=5,admin=False))
        baseline.logs('container-log');baseline.close();rigs.remove(baseline);checkpoint()

        candidate=Rig(args.candidate_image,root/'candidate','candidate');rigs.append(candidate)
        print('Starting candidate real fixture',flush=True);candidate.start()
        for _ in range(40):
            initial=candidate.health()
            if initial['body'].get('diagnostics',{}).get('freshness')=='fresh':break
            time.sleep(1)
        else:raise RuntimeError('candidate diagnostics never fresh before fault')
        candidate.save('fresh-before-fault',initial)
        candidate.save('mcp-before',candidate.mcp_check('before'))
        candidate.inject()
        print('Sampling candidate blocked-I/O window',flush=True)
        samples=candidate.sample(args.seconds);candidate.save('blocked-window-samples',samples)
        candidate.save('blocked-io-proof',candidate.processes())
        stale=candidate.health();candidate.save('stale-after-deadline',stale)
        candidate.save('mcp-during',candidate.mcp_check('during'))
        summary['results']['candidateIsolation']={'stats':stats(samples),'diagnostics':stale['body'].get('diagnostics'),
            'sameObservedAt':stale['body'].get('diagnostics',{}).get('observedAt')==initial['body']['diagnostics']['observedAt']}
        checkpoint()

        print('Restoring regular path while original real read remains blocked',flush=True)
        candidate.signal_fixture('restore-path');time.sleep(1)
        candidate.save('path-restored-io-proof',candidate.processes())
        recovery=[]
        for _ in range(35):
            recovery.append(candidate.health());time.sleep(1)
        candidate.save('path-restored-still-blocked',recovery)
        summary['results']['pathOnlyRecovery']={'freshCount':sum(x['body'].get('diagnostics',{}).get('freshness')=='fresh' for x in recovery),
            'lastDiagnostics':recovery[-1]['body'].get('diagnostics'),'observationSeconds':35,
            'meaning':'path restored, but previously accepted FIFO read remains outstanding'}
        checkpoint()

        print('Releasing original FIFO read and checking next real collection',flush=True)
        candidate.signal_fixture('release');settled=[]
        for _ in range(35):
            state=candidate.health();settled.append(state)
            if state['body'].get('diagnostics',{}).get('freshness')=='fresh':break
            time.sleep(1)
        candidate.save('released-real-io-recovery',settled)
        fresh=settled[-1]['body'].get('diagnostics',{}).get('freshness')=='fresh'
        candidate.save('mcp-after',candidate.mcp_check('after'))
        summary['results']['realIoReleaseRecovery']={'fresh':fresh,'observations':len(settled),'diagnostics':settled[-1]['body'].get('diagnostics')}
        fx.require(fresh,'diagnostics failed to recover after real operation settled')
        candidate.logs('container-log-before-drain')
        print('Sending actual TERM for scoped batch-3 smoke',flush=True)
        start=time.monotonic();fx.run(['docker','kill','--signal','TERM',candidate.app]);states=[]
        for _ in range(48):
            state=json.loads(fx.run(['docker','inspect',candidate.app,'--format','{{json .State}}']))
            states.append({'elapsedS':round(time.monotonic()-start,3),'running':state['Running'],'exitCode':state['ExitCode']})
            if not state['Running']:break
            time.sleep(1)
        candidate.save('normal-term-states',states);candidate.logs('normal-term-log')
        summary['results']['normalDrainSmoke']={'exited':not states[-1]['running'],'elapsedS':states[-1]['elapsedS'],'exitCode':states[-1]['exitCode']}
        candidate.close();rigs.remove(candidate)
    except Exception as e:
        summary['error']=fx.scrub(str(e));print('ERROR: '+summary['error'],flush=True)
        for rig in rigs:
            try:rig.logs('failure-container-log')
            except Exception:pass
    finally:
        for rig in list(rigs):
            try:
                rig.signal_fixture('release');time.sleep(.2)
            except Exception:pass
            try:rig.close()
            except Exception as e:summary.setdefault('cleanupErrors',[]).append(fx.scrub(str(e)))
        summary['finishedAt']=fx.now();checkpoint()
    print(fx.scrub(json.dumps(summary,ensure_ascii=False,indent=2)),flush=True)
    return 1 if 'error' in summary else 0

if __name__=='__main__':raise SystemExit(main())
