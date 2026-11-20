#!/usr/bin/env python3
"""Real 1883-table Docker soak. Own resources only; no customer access/product patch.

Synthetic historical audit rows are fixture input, never claimed as real RPC receipts.
Runtime observations use existing HTTP metrics and /proc. Optional short CPU sampling
is a separately named post-window diagnostic, never part of the performance baseline.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, importlib.util, json, math, os
import pathlib, secrets, subprocess, threading, time, datetime, signal, re

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
        self.rpc_lock=threading.Lock()
        self.mcp_timeout=180
        self.mutation_timeout=180
        self.operation_deadline=threading.local()
        self.cutoff=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=30)).isoformat()
        for i in range(1,12):
            value=secrets.token_urlsafe(28);self.tokens['agent%02d'%i]=value;fx.SECRETS.append(value)

    def request(self,base_url,route,method='GET',body=None,headers=None,timeout=None,admin=True):
        if timeout is None:
            timeout=self.mcp_timeout if base_url==self.mcp and route=='/mcp' else self.mutation_timeout
        deadline=getattr(self.operation_deadline,'value',None)
        if deadline is not None:
            remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError('operation total deadline before next request')
            timeout=min(timeout,remaining)
        return fx.Rig.request(self,base_url,route,method,body,headers,timeout,admin)

    def call(self,name,tool=None,args=None,method='tools/call',who='a',session=None,save=True):
        with self.rpc_lock:
            self.rpc_id+=1
            rpc_id=self.rpc_id
        body={'jsonrpc':'2.0','id':rpc_id,'method':method}
        if method=='tools/call':body['params']={'name':tool,'arguments':args or {}}
        elif method=='initialize':body['params']={'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'core1883-uat','version':'2'}}
        result=self.request(self.mcp,'/mcp','POST',body,{'Authorization':'Bearer '+self.tokens[who],'Accept':'application/json, text/event-stream','x-lucy-session-id':session or name},admin=False)
        result['rpcId']=rpc_id
        if save:self.save(name,result)
        return result

    def exec(self,*args,data=None,timeout=60):
        deadline=getattr(self.operation_deadline,'value',None)
        if deadline is not None:
            timeout=min(timeout,deadline-time.monotonic())
            if timeout<=0:raise TimeoutError('operation total deadline before exec')
        ticket=secrets.token_hex(8)
        return run_owned_process(['docker','exec','-i',self.app,'python3','-c',EXEC_GUARD,json.dumps([str(x) for x in args]),str(timeout),ticket],data,timeout+4)

    def close(self,deadline=None):
        # A bounded cleanup owns all remote descendants through their container.
        # Never interpret a Docker daemon/permission failure as resource absence.
        deadline=time.monotonic()+60 if deadline is None else deadline
        errors=[]
        def command(args):
            remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError('cleanup total deadline')
            return subprocess.run(args,capture_output=True,text=True,timeout=min(12,remaining))
        for args in [['docker','rm','-fv',self.app],['docker','rm','-fv',self.db],
                     ['docker','network','rm',self.network],['docker','volume','rm',self.data_volume]]:
            try:
                value=command(args)
                if value.returncode and not any(x in value.stderr.lower() for x in ['no such container','no such object','not found','no such network','no such volume']):
                    errors.append(fx.scrub(value.stderr[-1000:]))
            except Exception as error:errors.append(fx.scrub(str(error)))
        fx.shutil.rmtree(self.private,ignore_errors=True)
        absent={}
        for kind,name in [('container',self.app),('container',self.db),('network',self.network),('volume',self.data_volume)]:
            try:
                result=command(['docker',kind,'inspect',name])
                absent[name]=result.returncode!=0 and any(x in result.stderr.lower() for x in ['no such','not found'])
            except Exception as error:
                absent[name]=False;errors.append(fx.scrub(str(error)))
        proof={'at':fx.now(),'resourcesAbsent':absent,'privateRemoved':not self.private.exists(),'errors':errors}
        proof['complete']=all(absent.values()) and proof['privateRemoved'] and not errors
        self.save('cleanup',proof)
        fx.require(proof['complete'],'isolated cleanup incomplete: '+json.dumps(proof))

    def diagnostic_inventory(self,known=(),timeout=5):
        return json.loads(self.exec('python3','-c',DIAGNOSTIC_INVENTORY,json.dumps(list(known)),timeout=timeout))

    def signal_fixture(self,name,timeout=5):
        fx.require(name in ['restore-path','release'],'unknown fixture signal')
        return run_owned_process(['docker','exec','--user','0',self.app,'touch','/tmp/uat-readyz-fifo/'+name],timeout=timeout)

    def audit_verify(self,seconds=90):
        return json.loads(self.exec('python3','-c',AUDIT_VERIFY,'/data/lucy/.ktx-ui/audit.sqlite',self.cutoff,'1000',str(seconds),timeout=seconds+2))

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
        if full:return self.audit_verify()
        return json.loads(self.exec('node','-e',r'''
const D=require('/app/webui/node_modules/better-sqlite3');const d=new D('/data/lucy/.ktx-ui/audit.sqlite',{readonly:true});d.pragma('busy_timeout=1000');
const newest=d.prepare('SELECT COALESCE(MAX(id),0) maxId FROM access_log').get();
const states=d.prepare('SELECT status,COUNT(*) n FROM inferred_rebuild_state GROUP BY status').all();
console.log(JSON.stringify({at:new Date().toISOString(),newest,states,fullClosureVerified:false}));d.close();
''',timeout=8))

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


# Shared verbatim between the host runner and the container watchdog. The old
# termination grace was at most two seconds (TERM1 + KILL1); keep that budget.
OWNED_GROUP_PROGRAM = r'''
OWNED_PROCESS_CLEANUP_SECONDS = 2.0

def owned_process_group_state(pgid, deadline=None):
    try:
        os.killpg(pgid, 0)
        return {'exists':True, 'live':None}
    except ProcessLookupError:
        return {'exists':False, 'live':False}
    except PermissionError:
        # Darwin returns EPERM for a group containing only zombies. EPERM is
        # never absence by itself: verify OS membership, including zombies.
        rows=[]
        if pathlib.Path('/proc/self/stat').exists():
            for entry in pathlib.Path('/proc').iterdir():
                if not entry.name.isdigit():continue
                try:fields=(entry/'stat').read_text().rsplit(')',1)[1].split()
                except FileNotFoundError:continue
                if int(fields[2])==pgid:rows.append(fields[0])
        else:
            remaining=1 if deadline is None else deadline-time.monotonic()
            if remaining<=0:raise TimeoutError('owned group metadata deadline')
            scan=subprocess.run(['/bin/ps','-axo','pid=,pgid=,stat='],capture_output=True,text=True,timeout=min(1,remaining))
            if scan.returncode:raise RuntimeError('owned group metadata unavailable')
            for line in scan.stdout.splitlines():
                fields=line.split()
                if len(fields)!=3 or not fields[0].isdigit() or not fields[1].isdigit():
                    raise RuntimeError('owned group metadata malformed')
                if int(fields[1])==pgid:rows.append(fields[2])
        if not rows:return {'exists':False,'live':False}
        if all(state.startswith('Z') for state in rows):return {'exists':True,'live':False}
        raise

def owned_process_group_exists(pgid, deadline=None):
    return owned_process_group_state(pgid, deadline)['exists']

def terminate_owned_group(process, deadline=None):
    started = time.monotonic()
    deadline = min(deadline if deadline is not None else float('inf'), started + OWNED_PROCESS_CLEANUP_SECONDS)
    proof = {'pgid':process.pid, 'cleanupGraceSeconds':OWNED_PROCESS_CLEANUP_SECONDS,
             'termSent':False, 'killSent':False, 'groupAbsent':False, 'parentReaped':False}
    if owned_process_group_state(process.pid,deadline)['live'] is not False:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            proof['termSent'] = True
        except ProcessLookupError:
            pass
        # Do not let parent/pipe completion suppress escalation. In particular,
        # leave the direct child unreaped during the TERM grace, reserving its
        # session/PGID while we signal only this start_new_session-owned group.
        term_deadline = min(deadline, started + 1.0)
        while time.monotonic() < term_deadline and owned_process_group_state(process.pid,deadline)['live'] is not False:
            time.sleep(min(.01, max(0, term_deadline-time.monotonic())))
        if owned_process_group_state(process.pid,deadline)['live'] is not False:
            try:
                os.killpg(process.pid, signal.SIGKILL)
                proof['killSent'] = True
            except ProcessLookupError:
                pass
    remaining = deadline-time.monotonic()
    if remaining <= 0:
        raise TimeoutError('owned group cleanup deadline before parent reap')
    stdout, stderr = process.communicate(timeout=remaining)
    proof['parentReaped'] = process.returncode is not None
    # Reap completion does not prove group absence. Detached stdout/stderr and
    # a dead leader must not hide a still-running descendant (or an unreaped
    # group). Never signal a group again after this final absence observation.
    while time.monotonic() < deadline and owned_process_group_state(process.pid,deadline)['exists']:
        time.sleep(min(.01, max(0, deadline-time.monotonic())))
    proof['groupAbsent'] = not owned_process_group_state(process.pid,deadline)['exists']
    proof['cleanupSeconds'] = time.monotonic()-started
    return stdout, stderr, proof
'''
exec(OWNED_GROUP_PROGRAM, globals())


def run_owned_process(command, data=None, timeout=60):
    """Own the local PGID; execution deadline plus separate bounded 2s cleanup grace."""
    process = subprocess.Popen([str(x) for x in command], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, start_new_session=True)
    try:
        stdout, stderr = process.communicate(data, timeout=timeout)
    except BaseException as error:
        try:
            _, _, proof = terminate_owned_group(process)
            if not proof['parentReaped'] or not proof['groupAbsent']:
                raise RuntimeError('owned process group termination unverified: '+json.dumps(proof))
        except BaseException as cleanup_error:
            raise RuntimeError('owned command '+type(error).__name__+'; cleanup incomplete within separate 2s grace: '+str(cleanup_error)) from error
        if isinstance(error, subprocess.TimeoutExpired):
            raise TimeoutError('owned process deadline; actual owned group absent after bounded 2s cleanup grace') from error
        raise
    cleanup_deadline = time.monotonic()+OWNED_PROCESS_CLEANUP_SECONDS
    if owned_process_group_exists(process.pid,cleanup_deadline):
        _, _, proof = terminate_owned_group(process,cleanup_deadline)
        raise RuntimeError('owned parent exited with descendants; cleanup proof: '+json.dumps(proof))
    if process.returncode:
        raise RuntimeError('owned command failed: ' + fx.scrub(stderr[-1500:]))
    return stdout.strip()


# This wrapper runs INSIDE the task container. A docker client timeout alone does
# not terminate docker-exec work. Group absence is independent of pipe completion.
EXEC_GUARD = r'''
import json,os,pathlib,signal,subprocess,sys,time
''' + OWNED_GROUP_PROGRAM + r'''
args=json.loads(sys.argv[1]);seconds=float(sys.argv[2]);ticket=sys.argv[3]
folder=pathlib.Path('/tmp/lucy-core1883/exec-tickets');folder.mkdir(parents=True,exist_ok=True)
p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
record={'pid':p.pid,'startedAt':time.time(),'args0':args[0],'complete':False,'cleanupGraceSeconds':OWNED_PROCESS_CLEANUP_SECONDS}
path=folder/(ticket+'.json');path.write_text(json.dumps(record));cleanup_started=False;cleanup_deadline=None
try:
 try:out,err=p.communicate(sys.stdin.buffer.read(),timeout=seconds)
 except subprocess.TimeoutExpired:
  record['timedOut']=True;cleanup_started=True;cleanup_deadline=time.monotonic()+OWNED_PROCESS_CLEANUP_SECONDS
  out,err,proof=terminate_owned_group(p,cleanup_deadline)
  record.update(complete=bool(proof['parentReaped'] and proof['groupAbsent']),groupTermination=proof,returnCode=p.returncode,finishedAt=time.time());path.write_text(json.dumps(record))
  sys.stderr.write('remote owned process deadline; group termination '+json.dumps(proof)+'\n');sys.exit(124 if record['complete'] else 125)
 cleanup_deadline=time.monotonic()+OWNED_PROCESS_CLEANUP_SECONDS
 if owned_process_group_exists(p.pid,cleanup_deadline):
  cleanup_started=True;out,err,proof=terminate_owned_group(p,cleanup_deadline)
  record.update(orphanedDescendants=True,complete=bool(proof['parentReaped'] and proof['groupAbsent']),groupTermination=proof,returnCode=p.returncode,finishedAt=time.time());path.write_text(json.dumps(record))
  sys.stderr.write('remote owned parent exited with descendants; '+json.dumps(proof)+'\n');sys.exit(125)
 record.update(complete=True,groupTermination={'groupAbsent':True,'parentReaped':True,'cleanupGraceSeconds':OWNED_PROCESS_CLEANUP_SECONDS,'cleanupSeconds':0},returnCode=p.returncode,finishedAt=time.time());path.write_text(json.dumps(record))
 sys.stdout.buffer.write(out);sys.stderr.buffer.write(err);sys.exit(p.returncode)
except BaseException as error:
 if isinstance(error,SystemExit):raise
 record['error']=type(error).__name__+': '+str(error)
 if not cleanup_started:
  cleanup_started=True
  try:
   if cleanup_deadline is None:cleanup_deadline=time.monotonic()+OWNED_PROCESS_CLEANUP_SECONDS
   _,_,proof=terminate_owned_group(p,cleanup_deadline);record['groupTermination']=proof;record['complete']=bool(proof['parentReaped'] and proof['groupAbsent'])
  except BaseException as cleanup_error:record['cleanupError']=type(cleanup_error).__name__+': '+str(cleanup_error)
 record.update(returnCode=p.returncode,finishedAt=time.time());path.write_text(json.dumps(record));sys.stderr.write(json.dumps(record)+'\n');sys.exit(125)
'''

DIAGNOSTIC_INVENTORY = r'''
import pathlib,json,sys
known=json.loads(sys.argv[1]);workers=[];servers=[];gone=[]
def identity(p):return p.name+':'+(p/'stat').read_text().rsplit(')',1)[1].split()[19]
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  args=(p/'cmdline').read_bytes().split(b'\0')
  if any(x==b'server/index.ts' or x.endswith(b'/server/index.ts') for x in args):servers.append(p.name)
  if not any(x.endswith(b'/diagnostic-collector-worker.ts') for x in args):continue
  threads=[{'tid':t.name,'wchan':(t/'wchan').read_text().strip()} for t in (p/'task').iterdir()]
  workers.append({'pid':p.name,'identity':identity(p),'threads':threads,'blockedFifo':any('pipe' in t['wchan'] or 'partner' in t['wchan'] for t in threads)})
 except (OSError,ProcessLookupError):pass
for key in known:
 p=pathlib.Path('/proc')/key.split(':')[0]
 try:
  if identity(p)!=key:gone.append(key)
 except OSError:gone.append(key)
print(json.dumps({'workers':workers,'gone':gone,'serverPids':servers}))
'''

# Read-only verifier mirrors migratedFacts, adding bounded keyset pages, turn
# ownership, duplicates and orphan checks. One read transaction fixes the view;
# SQLite progress-handler and remote watchdog both enforce the collection bound.
AUDIT_VERIFY = r'''
import datetime,json,sqlite3,sys,time
path,cutoff,page_size,seconds=sys.argv[1],sys.argv[2],int(sys.argv[3]),float(sys.argv[4])
start=time.monotonic();deadline=start+seconds
c=sqlite3.connect('file:'+path+'?mode=ro',uri=True,timeout=2)
c.row_factory=sqlite3.Row;c.set_progress_handler(lambda: int(time.monotonic()>=deadline),10000)
r={'cutoff':cutoff,'pageSize':page_size,'complete':False,'eligible':0,'linked':0,'uniqueLinked':0,'missingTurns':0,'wrongUsers':0,'duplicates':0,'missingLinks':0,'orphanRawLinks':0,'orphanTurnLinks':0,'pendingUsers':0,'users':0,'pages':0}
try:
 c.execute('BEGIN')
 r['maxId']=c.execute('SELECT COALESCE(MAX(id),0) FROM access_log').fetchone()[0]
 r['raw']=c.execute('SELECT COUNT(*) FROM access_log').fetchone()[0]
 history=c.execute("SELECT COUNT(*),COUNT(DISTINCT user_id) FROM access_log WHERE client='uat-core1883-history'").fetchone()
 r['historyRows'],r['historyUsers']=history
 users={};last=0
 while True:
  rows=c.execute('SELECT id,user_id,ts FROM access_log WHERE id>? AND id<=? ORDER BY id LIMIT ?',(last,r['maxId'],page_size)).fetchall()
  if not rows:break
  r['pages']+=1;last=rows[-1]['id']
  for a in rows:
   if a['ts']<cutoff:continue
   r['eligible']+=1;users[a['user_id']]=a['id']
   links=c.execute('SELECT l.inferred_turn_id,t.user_id FROM inferred_turn_access_logs l LEFT JOIN inferred_turns t ON t.inferred_turn_id=l.inferred_turn_id WHERE l.access_log_id=?',(a['id'],)).fetchall()
   r['linked']+=len(links);r['uniqueLinked']+=bool(links);r['missingLinks']+=not links;r['duplicates']+=max(0,len(links)-1)
   r['missingTurns']+=sum(l['user_id'] is None for l in links)
   r['wrongUsers']+=sum(l['user_id'] is not None and l['user_id']!=a['user_id'] for l in links)
  if time.monotonic()>=deadline:raise TimeoutError('audit collection deadline')
 last=0
 while True:
  rows=c.execute('SELECT l.rowid AS rid,a.id,t.inferred_turn_id FROM inferred_turn_access_logs l LEFT JOIN access_log a ON a.id=l.access_log_id LEFT JOIN inferred_turns t ON t.inferred_turn_id=l.inferred_turn_id WHERE l.rowid>? ORDER BY l.rowid LIMIT ?',(last,page_size)).fetchall()
  if not rows:break
  last=rows[-1]['rid'];r['orphanRawLinks']+=sum(a['id'] is None for a in rows);r['orphanTurnLinks']+=sum(a['inferred_turn_id'] is None for a in rows)
  if time.monotonic()>=deadline:raise TimeoutError('audit collection deadline')
 r['users']=len(users)
 r['userWatermarks']=[]
 for user,newest in sorted(users.items()):
  state=c.execute('SELECT status,watermark FROM inferred_rebuild_state WHERE user_id=?',(user,)).fetchone()
  good=bool(state and state['status']=='complete' and str(state['watermark']).isdigit() and int(state['watermark'])>=newest)
  r['pendingUsers']+=not good;r['userWatermarks'].append({'user':user,'newest':newest,'state':dict(state) if state else None,'valid':good})
 r['complete']=r['eligible']>0 and r['linked']==r['uniqueLinked']==r['eligible'] and not any(r[k] for k in ['missingTurns','wrongUsers','duplicates','missingLinks','orphanRawLinks','orphanTurnLinks','pendingUsers'])
except Exception as e:r['error']=str(e);r['timedOut']=time.monotonic()>=deadline
finally:c.close();r['elapsedSeconds']=round(time.monotonic()-start,3)
print(json.dumps(r))
'''


AUDIT_BACKUP = r'''
import datetime,gzip,hashlib,json,os,pathlib,sqlite3,sys,time
source,target,cutoff,seconds=sys.argv[1],sys.argv[2],sys.argv[3],float(sys.argv[4])
start=time.monotonic();deadline=start+seconds
p=pathlib.Path(target);p.parent.mkdir(parents=True,exist_ok=True)
def check(*args):
 if time.monotonic()>=deadline:raise TimeoutError('audit backup/compression deadline')
original=sqlite3.connect('file:'+source+'?mode=ro',uri=True,timeout=min(2,seconds))
backup=sqlite3.connect(target);os.chmod(target,0o600)
try:
 original.backup(backup,pages=256,progress=check,sleep=.01)
 check();maximum=backup.execute('SELECT COALESCE(MAX(id),0) FROM access_log').fetchone()[0]
finally:original.close();backup.close()
sqlite_hash=hashlib.sha256();size=0
with p.open('rb') as source_stream,gzip.open(target+'.gz','wb',compresslevel=1) as compressed:
 while True:
  check();chunk=source_stream.read(1024*1024)
  if not chunk:break
  sqlite_hash.update(chunk);size+=len(chunk);compressed.write(chunk)
os.chmod(target+'.gz',0o600)
gzip_hash=hashlib.sha256()
with open(target+'.gz','rb') as compressed:
 while True:
  check();chunk=compressed.read(1024*1024)
  if not chunk:break
  gzip_hash.update(chunk)
r={'source':'task-owned synthetic audit.sqlite; SQLite backup API','cutoff':cutoff,'maxId':maximum,'sqliteSha256':sqlite_hash.hexdigest(),'gzipSha256':gzip_hash.hexdigest(),'sqliteBytes':size,'gzipBytes':pathlib.Path(target+'.gz').stat().st_size,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':time.monotonic()-start,'deadlineSeconds':seconds}
check();pathlib.Path(target+'.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
'''


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--mode', choices=['formal', 'calibration'], default='formal')
    parser.add_argument('--contract-policy',choices=['strict','p1-69'],default='strict',help='Explicit approved P1-69 SC03 owner/recovery/audit mapping; all raw failures remain')
    parser.add_argument('--contract-recovery-seconds',type=float,default=180)
    parser.add_argument('--contract-recovery-concurrency',type=int,default=2)
    parser.add_argument('--seconds', type=float, default=1800)
    parser.add_argument('--cycle-seconds', type=float, default=150)
    parser.add_argument('--mcp-concurrency', type=int, default=12)
    parser.add_argument('--mcp-timeout', type=float, default=180,
                        help='Declared existing RPC client budget; not a new product SLO')
    parser.add_argument('--mutation-timeout', type=float, default=180)
    parser.add_argument('--drain-seconds', type=float, default=190)
    parser.add_argument('--collect-seconds', type=float, default=90)
    parser.add_argument('--audit-settle-seconds', type=float, default=300)
    parser.add_argument('--overall-seconds', type=float,
                        help='Running deadline: fixture, natural window, drain and collection; cleanup has separate bounded grace')
    parser.add_argument('--cleanup-seconds', type=float, default=90,help='Independent cleanup grace after run deadline/normal completion')
    parser.add_argument('--audit-evidence-copy',action='store_true',help='Copy only the task synthetic audit DB using SQLite backup API, gzip and double hashes')
    parser.add_argument('--io-control', action='store_true', help='Separate post-window real FIFO control')
    parser.add_argument('--io-seconds', type=float, default=120)
    parser.add_argument('--recovery-seconds', type=float, default=30)
    parser.add_argument('--profile-seconds', type=float, default=0,
                        help='Optional named diagnostic window AFTER natural performance window, max 30s')
    parser.add_argument('--seed-rows', type=int, default=200000,
                        help='Formal >=200000; smaller values only for explicit calibration')
    parser.add_argument('--cycle-seed-rows', type=int, default=3000)
    parser.add_argument('--stop-after', type=float,
                        help='Explicit stop-path calibration; can never qualify a formal run')
    parser.add_argument('--keep-resources', action='store_true',
                        help='Retain task resources for diagnosis; never a completed cleanup claim')
    args = parser.parse_args(argv)
    numeric = ['seconds', 'cycle_seconds', 'mcp_concurrency', 'mcp_timeout',
               'mutation_timeout', 'drain_seconds', 'collect_seconds',
               'audit_settle_seconds', 'io_seconds', 'recovery_seconds', 'cleanup_seconds','contract_recovery_seconds','contract_recovery_concurrency']
    for name in numeric:
        if not math.isfinite(getattr(args, name)) or getattr(args, name) <= 0:
            parser.error(name + ' must be finite and positive')
    if args.contract_policy=='p1-69' and not args.audit_evidence_copy:
        parser.error('p1-69 requires --audit-evidence-copy for independent same-view audit proof')
    if args.contract_recovery_concurrency>12:parser.error('contract recovery concurrency must be <=12')
    if not 0 <= args.profile_seconds <= 30:
        parser.error('profile-seconds must be 0..30 and is a separate diagnostic window')
    if args.seed_rows < 1 or args.cycle_seed_rows < 0:
        parser.error('invalid audit fixture row count')
    if args.mode == 'formal' and (args.seconds < 1800 or args.cycle_seconds > 300 or
                                  args.seconds / args.cycle_seconds < 12 or args.seed_rows < 200000):
        parser.error('formal qualification requires >=1800s, >=12 cycles, cycle<=300s, >=200000 seed rows')
    if args.stop_after is not None and (args.stop_after <= 0 or args.mode != 'calibration'):
        parser.error('stop-after is positive and calibration-only')
    if args.overall_seconds is None:
        args.overall_seconds = 1200 + args.seconds + args.drain_seconds + args.audit_settle_seconds + 3*args.collect_seconds + args.io_seconds + args.recovery_seconds + args.profile_seconds + (args.contract_recovery_seconds if args.contract_policy=='p1-69' else 0)
    if not math.isfinite(args.overall_seconds) or args.overall_seconds <= args.seconds:
        parser.error('overall-seconds must exceed natural window')
    return args


def qualification_status(mode, passed):
    if not passed:
        return 'FAIL'
    return 'CALIBRATION PASS' if mode == 'calibration' else 'PASS WITH GAP'


def request_failures(events):
    # No regex, successful-reload window or text match can erase user failures.
    return [e for e in events if e.get('kind') == 'request-terminal' and not e.get('ok')]


def query_fingerprint(arguments):
    canonical=json.dumps(arguments,sort_keys=True,separators=(',',':'))
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def timestamp_ms(value):
    # Docker --timestamps is RFC3339Nano (up to nine fraction digits); stock
    # macOS Python 3.9 fromisoformat only accepts three/six. Validate the full
    # prefix first, then truncate only sub-microsecond display precision.
    match=re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})',value)
    if match is None:raise ValueError('owner/log timestamp must be strict RFC3339Nano with timezone')
    whole,fraction,zone=match.groups()
    if zone!='Z' and (int(zone[1:3])>23 or int(zone[4:6])>59):
        raise ValueError('RFC3339 timezone offset must have hours<=23 and minutes<=59')
    normalized=whole+'.'+(fraction or '').ljust(6,'0')[:6]+('+00:00' if zone=='Z' else zone)
    parsed=datetime.datetime.fromisoformat(normalized)
    # Owner acquiredAt/releasedAt are JavaScript millisecond timestamps. Keep
    # their comparison with rejectedAt/deadlineAt exact, without epoch floats.
    delta=parsed.astimezone(datetime.timezone.utc)-datetime.datetime(1970,1,1,tzinfo=datetime.timezone.utc)
    return delta.days*86_400_000+delta.seconds*1000+delta.microseconds//1000


def parse_reload_owner_logs(text):
    owners=[];decoder=json.JSONDecoder();marker='[lucy-reload] '
    for line in text.splitlines():
        index=line.find(marker)
        if index<0:continue
        try:
            prefix=line[:index].strip()
            if prefix:timestamp_ms(prefix)
            tail=line[index+len(marker):]
            owner,end=decoder.raw_decode(tail)
            if tail[end:].strip() or not isinstance(owner,dict):continue
            if owner.get('event') in ['acquire','release']:owners.append(owner)
        except (ValueError,TypeError):continue
    return owners


def owned_reload_rejection(failure,events):
    """Owner binding uses the server's synchronous rejectedAt, never client windows."""
    try:
        if failure.get('lane')!='mcp' or failure.get('status')!=503:return None
        receipt=failure['receipt']
        if receipt['httpStatus']!=503:return None
        error=receipt['body']['error']
        if error.get('code')!='EXECUTION_RUNTIME_RELOADING':return None
        owner_id=error['requestId'];deadline=error['deadlineAt'];rejected=error['rejectedAt']
        if not isinstance(owner_id,str) or not owner_id:return None
        if type(deadline) not in [int,float] or type(rejected) not in [int,float]:return None
        if not math.isfinite(deadline) or not math.isfinite(rejected):return None
        owners=[e['owner'] for e in events if e.get('kind')=='reload-owner' and e.get('owner',{}).get('requestId')==owner_id]
        acquired=[o for o in owners if o.get('event')=='acquire'];released=[o for o in owners if o.get('event')=='release']
        if len(acquired)!=1 or len(released)!=1:return None
        acquire,release=acquired[0],released[0]
        if acquire['deadlineAt']!=deadline or release['deadlineAt']!=deadline:return None
        start,end=timestamp_ms(acquire['acquiredAt']),timestamp_ms(release['releasedAt'])
        if not start<=rejected<=end<=deadline:return None
        return {'requestId':owner_id,'deadlineAt':deadline,'rejectedAt':rejected,'acquiredAt':acquire['acquiredAt'],'releasedAt':release['releasedAt']}
    except (KeyError,TypeError,ValueError,OverflowError):return None


def contract_failure_verdict(failure, events, policy='strict'):
    rejected={'expected':False,'policy':policy,'reason':'owner/recovery/readonly-audit proof incomplete'}
    if policy!='p1-69':return {**rejected,'reason':'strict default; no approved mapping enabled'}
    owner=owned_reload_rejection(failure,events)
    if owner is None:return rejected
    try:
        original=failure['requestId']
        recovery=[e for e in events if e.get('kind')=='contract-recovery' and e.get('originalRequestId')==original]
        proofs=[e for e in events if e.get('kind')=='contract-audit-proof' and e.get('originalRequestId')==original]
        if len(recovery)!=1 or len(proofs)!=1:return rejected
        recovery,proof=recovery[0],proofs[0]
        expected_arguments={'connectionId':fx.CONN,'measures':[fx.SOURCE+'.order_count',fx.SOURCE+'.amount_sum']}
        expected_fingerprint=query_fingerprint(expected_arguments)
        if failure.get('queryArguments')!=expected_arguments or recovery.get('queryArguments')!=expected_arguments:return rejected
        if failure.get('problemFingerprint')!=expected_fingerprint or recovery.get('problemFingerprint')!=expected_fingerprint:return rejected
        for field in ['identity','userId','session','tokenHashPrefix']:
            if not failure.get(field) or failure[field]!=recovery.get(field):return rejected
        if recovery.get('ownerRequestId')!=owner['requestId'] or not recovery.get('ok'):return rejected
        if timestamp_ms(recovery['startedAt'])<timestamp_ms(owner['releasedAt']):return rejected
        if not recovery['startedMonotonic']<=recovery['finishedMonotonic']<=recovery['deadlineMonotonic']:return rejected
        if not fx.successful(recovery['initializeReceipt']) or not fx.successful(recovery['toolsReceipt']):return rejected
        verify_query_response(recovery['receipt'])
        for field in ['userId','session','tokenHashPrefix','scopeKey']:
            if not recovery.get(field) or proof.get(field)!=recovery[field]:return rejected
        if not proof.get('backupVerified') or not proof.get('valid') or not proof.get('rpcMatchesRecovery'):return rejected
        if any(proof.get(k)!=1 for k in ['calls','attempts','queryRows','successfulQueryRows','validLinks']):return rejected
        if any(proof.get(k)!=0 for k in ['wrongUsers','missingTurns']):return rejected
        return {'expected':True,'policy':policy,'sc':'SC-03','ownerRequestId':owner['requestId'],
                'originalRequestId':original,'recoveryRpcId':recovery['receipt'].get('rpcId'),
                'reason':'exact owner closure + same-identity same-question explicit recovery + consistent readonly audit proof'}
    except (KeyError,TypeError,ValueError,AssertionError):return rejected


def run_contract_recoveries(rig,failures,events,emit,seconds,concurrency):
    candidates=[(f,owned_reload_rejection(f,events)) for f in failures]
    candidates=[(f,o) for f,o in candidates if o is not None]
    deadline=time.monotonic()+seconds
    queue=list(candidates);queue_lock=threading.Lock();threads=[]
    def worker():
        while time.monotonic()<deadline:
            with queue_lock:
                if not queue:return
                failure,owner=queue.pop(0)
            identity=failure['identity'];session=failure['session'];token_prefix=failure['tokenHashPrefix']
            user_id=failure['userId'];scope='bq:'+user_id+'|'+token_prefix+':'+session
            fields={'kind':'contract-recovery','originalRequestId':failure['requestId'],'originalRpcId':failure['rpcId'],'ownerRequestId':owner['requestId'],
                    'identity':identity,'userId':user_id,'session':session,'tokenHashPrefix':token_prefix,'scopeKey':scope,
                    'problemFingerprint':failure['problemFingerprint'],'queryArguments':failure['queryArguments'],
                    'startedAt':fx.now(),'startedMonotonic':time.monotonic(),'deadlineMonotonic':deadline,'ok':False}
            rig.operation_deadline.value=deadline
            try:
                name='explicit-recovery-'+failure['requestId']
                fields['initializeReceipt']=rig.call(name+'-init',method='initialize',who=identity,session=session)
                fx.require(fx.successful(fields['initializeReceipt']),'recovery initialize failed')
                fields['toolsReceipt']=rig.call(name+'-tools',method='tools/list',who=identity,session=session)
                fx.require(fx.successful(fields['toolsReceipt']),'recovery tools/list failed')
                fields['receipt']=rig.call(name+'-query','lucy_query',failure['queryArguments'],who=identity,session=session)
                fields['oracle']=verify_query_response(fields['receipt'])
                fields['ok']=time.monotonic()<=deadline
                if not fields['ok']:fields['error']='explicit recovery completed after absolute deadline'
            except Exception as error:fields['error']=fx.scrub(str(error))
            fields['finishedMonotonic']=time.monotonic();emit(fields)
    for _ in range(min(concurrency,len(candidates))):
        thread=threading.Thread(target=worker,daemon=True);threads.append(thread);thread.start()
    for thread in threads:thread.join(max(0,deadline-time.monotonic()))
    for failure,owner in queue:
        emit({'kind':'contract-recovery-missed','originalRequestId':failure['requestId'],'originalRpcId':failure['rpcId'],'ownerRequestId':owner['requestId'],'reason':'independent recovery deadline'})
    return {'candidates':len(candidates),'workersAlive':sum(t.is_alive() for t in threads),'deadlineMonotonic':deadline,'finishedMonotonic':time.monotonic()}


def verify_contract_audit_copy(root,metadata,recoveries,seconds):
    import gzip,sqlite3
    if not recoveries:return []
    deadline=time.monotonic()+seconds;output=root/'audit-evidence-readonly.sqlite'
    digest=hashlib.sha256();proofs=[]
    try:
        with gzip.open(root/metadata['path'],'rb') as compressed,output.open('wb') as target:
            while True:
                fx.require(time.monotonic()<deadline,'contract readonly audit extraction deadline')
                chunk=compressed.read(1024*1024)
                if not chunk:break
                digest.update(chunk);target.write(chunk)
        os.chmod(output,0o600)
        fx.require(digest.hexdigest()==metadata['sqliteSha256'],'consistent audit sqlite hash mismatch')
        # This is a completed, SHA-256 verified SQLite backup snapshot, never the live DB.
        closed_snapshot_uri=output.resolve().as_uri()+'?mode=ro&immutable=1'
        db=sqlite3.connect(closed_snapshot_uri,uri=True,timeout=min(2,max(.001,deadline-time.monotonic())))
        db.row_factory=sqlite3.Row;db.set_progress_handler(lambda:int(time.monotonic()>=deadline),1000)
        try:
            for recovery in recoveries:
                fx.require(time.monotonic()<deadline,'contract readonly audit query deadline')
                proof={'kind':'contract-audit-proof','originalRequestId':recovery['originalRequestId'],'backupVerified':True,
                       **{k:recovery[k] for k in ['scopeKey','userId','session','tokenHashPrefix']},'valid':False,
                       'auditSnapshotMaxId':metadata['maxId'],'auditSnapshotCapturedAt':metadata['capturedAt']}
                budget=db.execute('SELECT calls,attempts FROM question_budget_state WHERE scope_key=?',(recovery['scopeKey'],)).fetchone()
                proof['calls']=budget['calls'] if budget else None;proof['attempts']=budget['attempts'] if budget else None
                rows=db.execute("SELECT id,outcome,generated_sql,query_operation,request_id,rpc_request_id FROM access_log WHERE lucy_session_id=? AND user_id=? AND IFNULL(token_hash_prefix,'')=? AND tool='lucy_query' ORDER BY id",(recovery['session'],recovery['userId'],recovery['tokenHashPrefix'])).fetchall()
                proof['queryRows']=len(rows);proof['queryAuditIds']=[r['id'] for r in rows]
                proof['queryRpcIds']=[str(r['request_id']) for r in rows]
                proof['recoveryRpcId']=recovery.get('receipt',{}).get('rpcId');proof['originalRpcId']=recovery.get('originalRpcId')
                proof['rpcMatchesRecovery']=(len(rows)==1 and proof['recoveryRpcId'] is not None and str(rows[0]['request_id'])==str(proof['recoveryRpcId']) and str(rows[0]['request_id'])!=str(proof['originalRpcId']))
                proof['successfulQueryRows']=sum(r['outcome']=='ok' and bool(r['generated_sql'] or r['query_operation']) for r in rows)
                proof.update(validLinks=0,wrongUsers=0,missingTurns=0)
                for row in rows:
                    links=db.execute('SELECT t.inferred_turn_id,t.user_id FROM inferred_turn_access_logs l LEFT JOIN inferred_turns t ON t.inferred_turn_id=l.inferred_turn_id WHERE l.access_log_id=?',(row['id'],)).fetchall()
                    proof['validLinks']+=sum(l['inferred_turn_id'] is not None and l['user_id']==recovery['userId'] for l in links)
                    proof['wrongUsers']+=sum(l['inferred_turn_id'] is not None and l['user_id']!=recovery['userId'] for l in links)
                    proof['missingTurns']+=sum(l['inferred_turn_id'] is None for l in links)
                proof['valid']=(all(proof[k]==1 for k in ['calls','attempts','queryRows','successfulQueryRows','validLinks']) and not proof['wrongUsers'] and not proof['missingTurns'] and proof['rpcMatchesRecovery'])
                proofs.append(proof)
        finally:db.close()
        return proofs
    finally:
        if output.exists():output.unlink()


def ledger_counts(events):
    lanes = {}
    for e in events:
        if not e.get('kind', '').startswith('request-'):
            continue
        lane = lanes.setdefault(e['lane'], {k: 0 for k in ['planned', 'dispatched', 'missed', 'terminal', 'inflight', 'censored', 'succeeded', 'failed', 'naturalSucceeded', 'censoredSucceeded']})
        key = {'request-planned': 'planned', 'request-dispatched': 'dispatched',
               'request-missed': 'missed', 'request-terminal': 'terminal'}.get(e['kind'])
        if key:
            lane[key] += 1
        if e['kind'] == 'request-terminal':
            lane['censored'] += bool(e.get('censoredNatural'))
            lane['succeeded' if e.get('ok') else 'failed'] += 1
            if e.get('ok'):
                lane['censoredSucceeded' if e.get('censoredNatural') else 'naturalSucceeded'] += 1
    for lane in lanes.values():
        lane['inflight'] = lane['dispatched'] - lane['terminal']
        lane['conserved'] = lane['planned'] == lane['dispatched'] + lane['missed'] and lane['dispatched'] == lane['terminal'] + lane['inflight']
    return lanes


class ArrivalLedger:
    """Open-loop schedule. Slow work causes explicit missed arrivals, never backfill."""
    def __init__(self, emit, stop):
        self.emit, self.stop = emit, stop
        self.lanes, self.schedulers, self.workers = [], [], []
        self.lock = threading.Lock()
        self.end = None

    def add(self, lane, period, capacity, action):
        self.lanes.append((lane, period, threading.BoundedSemaphore(capacity), action))

    def start(self, started, seconds):
        self.end = started + seconds
        for lane, period, slots, action in self.lanes:
            t = threading.Thread(target=self._schedule, args=(lane, period, slots, action, started, seconds), daemon=True)
            self.schedulers.append(t)
            t.start()

    def _schedule(self, lane, period, slots, action, started, seconds):
        for index in range(math.ceil(seconds / period)):
            planned = started + index * period
            identity = lane + '-' + str(index)
            common = {'lane': lane, 'iteration': index, 'requestId': identity,
                      'plannedMonotonic': planned, 'offsetSeconds': index*period}
            self.emit({'kind': 'request-planned', **common})
            if self.stop.wait(max(0, planned-time.monotonic())) or time.monotonic() >= self.end:
                self.emit({'kind': 'request-missed', 'reason': 'stopped_or_window_ended', **common})
                continue
            if time.monotonic()-planned >= period:
                self.emit({'kind': 'request-missed', 'reason': 'scheduler_late', **common})
                continue
            if not slots.acquire(blocking=False):
                self.emit({'kind': 'request-missed', 'reason': 'capacity', **common})
                continue
            dispatched = time.monotonic()
            self.emit({'kind': 'request-dispatched', 'dispatchedMonotonic': dispatched, **common})
            def work(n=index, sem=slots, fn=action, fields=common, begin=dispatched):
                try:
                    value = fn(n) or {}
                    if not isinstance(value, dict):
                        value = {'value': value, 'ok': True}
                    self.emit({'kind': 'request-terminal', **fields, **value,
                               'dispatchedMonotonic': begin, 'finishedMonotonic': time.monotonic(),
                               'ms': (time.monotonic()-begin)*1000,
                               'censoredNatural': time.monotonic() >= self.end})
                except Exception as error:
                    self.emit({'kind': 'request-terminal', **fields, 'ok': False, 'status': 0,
                               'error': fx.scrub(str(error)), 'errorType': type(error).__name__,
                               'dispatchedMonotonic': begin, 'finishedMonotonic': time.monotonic(),
                               'ms': (time.monotonic()-begin)*1000,
                               'censoredNatural': time.monotonic() >= self.end})
                finally:
                    sem.release()
            thread = threading.Thread(target=work, daemon=True)
            with self.lock:
                self.workers.append(thread)
            thread.start()

    def finish(self, seconds):
        deadline = time.monotonic() + seconds
        for thread in self.schedulers:
            thread.join(max(0, deadline-time.monotonic()))
        with self.lock:
            threads = list(self.workers)
        for thread in threads:
            thread.join(max(0, deadline-time.monotonic()))
        return sum(t.is_alive() for t in self.schedulers+threads)


def response_reason(response):
    """Extract product fields, never numeric JSON-RPC transport codes/messages."""
    body = response.get('body', {})
    error = body.get('error') if isinstance(body,dict) else None
    if isinstance(error,dict):
        data=error.get('data')
        reason=data.get('reason') if isinstance(data,dict) else None
        if isinstance(reason,str) and reason.strip():return reason
        code=error.get('code')
        if isinstance(code,str) and code.strip() and not code.lstrip('-').isdigit():return code
    inner=fx.inner(response)
    reason=inner.get('reason') if isinstance(inner,dict) else None
    return reason if isinstance(reason,str) and reason.strip() else None


def verify_query_response(response):
    fx.require(fx.successful(response), 'query rejected: ' + str(response_reason(response)))
    data = fx.inner(response)
    verified = fx.verify_query_aggregate(data, {'order_count':4, 'amount_sum':100})
    return {'count': 4, 'sum': 100, 'actualRow': verified['actualRow']}


def recover_diagnostic(rig, known_workers, blocked_workers, deadline,
                       now=time.monotonic, pause=time.sleep):
    observations=[];terminated=set();max_inflight=0;recovered=False
    while now()<deadline:
        health=rig.health(timeout=min(4,deadline-now()))
        row={'at':fx.now(),'health':health,'finishedMonotonic':now()}
        if now()>=deadline:
            observations.append(row)
            break
        inventory=rig.diagnostic_inventory(known_workers,timeout=min(5,deadline-now()))
        terminated.update(inventory['gone']);max_inflight=max(max_inflight,len(inventory['workers']))
        row.update(inventory=inventory,finishedMonotonic=now());observations.append(row)
        recovered=(now()<=deadline and health['body'].get('diagnostics',{}).get('freshness')=='fresh' and blocked_workers.issubset(terminated))
        if recovered:break
        pause(min(.5,max(0,deadline-now())))
    return {'recovered':recovered,'observations':observations,'terminated':sorted(terminated),
            'maxInflight':max_inflight,'deadlineMonotonic':deadline,'finishedMonotonic':now()}


def probe_statistics(values):
    # Every request dispatched inside the natural window contributes, even when
    # its terminal receipt arrives later. Censoring is disclosure, not exclusion.
    natural = [e for e in values if not e['censoredNatural']]
    return {'count': len(values), 'naturalTerminalCount': len(natural),
            'censoredNaturalCount': len(values)-len(natural),
            'non200': sum(e.get('status') != 200 for e in values),
            'p99Ms': percentile(values, .99),
            'maxMs': max((e['ms'] for e in values), default=None)}


def main(argv=None):
    args = parse_args(argv)
    root = pathlib.Path(args.out).resolve()
    root.mkdir(parents=True, exist_ok=True)
    fx.require(not (root/'summary.json').exists(), 'output already contains a run; choose a fresh directory')
    stop = threading.Event()
    records, write_lock = [], threading.Lock()
    def emit(item):
        item = {'at': fx.now(), **item}
        with write_lock:
            records.append(item)
            with (root/'events.jsonl').open('a') as stream:
                stream.write(fx.scrub(json.dumps(item, ensure_ascii=False))+'\n')
        return item
    def event(kind, **fields):
        return emit({'kind': kind, **fields})
    def interrupted(signum, _frame):
        stop.set()
        raise InterruptedError('explicit signal/deadline '+str(signum)+'; keep failed/censored evidence')
    previous = {sig: signal.signal(sig, interrupted) for sig in [signal.SIGTERM, signal.SIGINT, signal.SIGALRM]}
    running_started=time.monotonic()
    running_deadline=running_started+args.overall_seconds
    signal.setitimer(signal.ITIMER_REAL, args.overall_seconds)
    rig = Rig(args.image, root/'candidate')
    rig.mcp_timeout, rig.mutation_timeout = args.mcp_timeout, args.mutation_timeout
    scheduler = ArrivalLedger(emit, stop)
    started = None
    summary = {'startedAt': fx.now(), 'status': 'RUNNING', 'mode': args.mode,
               'runnerSha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
               'baseSha256': hashlib.sha256(BASE.read_bytes()).hexdigest(),
               'helperSha256': base.HELPER_HASH, 'parameters': vars(args),
               'scope': 'FUP engineering combination only; not full F61/F62/F63/R-CAV or customer release',
               'windows': [], 'cpuProfilerInNaturalWindow': False,
               'deadlinePolicy':'running deadline plus independent bounded cleanup grace',
               'runningDeadlineMonotonic':running_deadline,'cleanupGraceSeconds':args.cleanup_seconds}
    def save_summary():
        (root/'summary.json').write_text(fx.scrub(json.dumps(summary, indent=2, ensure_ascii=False))+'\n')
    try:
        save_summary()
        print('Starting isolated real 1883-table fixture', flush=True)
        rig.start()
        initial_scale = rig.scale_facts()
        rig.save('scale-initial', initial_scale)
        fx.require(all(initial_scale[k] >= 1883 for k in ['physical', 'enabled', 'manifest']), 'scale not met')
        rig.save('mcp-initial', rig.mcp_check('soak-initial'))
        print('Seeding %d synthetic historical rows / 67 users (not RPC)' % args.seed_rows, flush=True)
        seeded = json.loads(rig.exec('node', '-e', SEED_AUDIT, str(args.seed_rows), 'initial', timeout=240))
        rig.save('audit-seed-initial', seeded)
        pid = rig.exec('python3', '-c', r'''
import pathlib
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  args=(p/'cmdline').read_bytes().split(b'\0')
  if (p/'comm').read_text().strip()=='node' and any(x==b'server/index.ts' or x.endswith(b'/server/index.ts') for x in args):print(p.name);break
 except OSError:pass
''').strip()
        fx.require(pid.isdigit(), 'actual server PID missing')
        # /proc observer is a distinct task-owned process and stops via marker.
        fx.run(['docker', 'exec', '-d', rig.app, 'python3', '-c', PROC, pid], timeout=15)
        manifest = json.loads((rig.project/('config/semantic-layer/'+fx.CONN+'/_schema/uat.yaml')).read_text())
        identities = ['a']+['agent%02d' % i for i in range(1, 12)]
        def probe(path):
            response = rig.request(rig.web, path, timeout=3, admin=False)
            data = response['body']
            return {'status': response['httpStatus'], 'ok': response['httpStatus'] == 200 and response['elapsedMs'] <= 3000,
                    'path': path, 'apiMs': response['elapsedMs'], 'diagnostics': data.get('diagnostics'),
                    'eventLoop': data.get('data', {}).get('eventLoop'), 'receipt': response}
        def http(n):
            response = rig.request(rig.web, '/api/project', timeout=3)
            return {'status': response['httpStatus'], 'ok': response['httpStatus'] == 200 and response['body'].get('ok') is not False and response['elapsedMs'] <= 3000,
                    'apiMs': response['elapsedMs'], 'receipt': response}
        def mcp(n):
            who=identities[n%12];session='independent-question-%d'%n
            arguments={'connectionId':fx.CONN,'measures':[fx.SOURCE+'.order_count',fx.SOURCE+'.amount_sum']}
            response=rig.call('soak-query-%d'%n,'lucy_query',arguments,who=who,session=session)
            value={'status':response['httpStatus'],'identity':who,'userId':'uat_zb_'+who,'session':session,
                   'tokenHashPrefix':('sha256:'+fx.sha(rig.tokens[who]))[:19],
                   'queryArguments':arguments,'problemFingerprint':query_fingerprint(arguments),'rpcId':response['rpcId'],
                   'machineReason':response_reason(response),'receipt':response,'apiMs':response['elapsedMs']}
            try:value.update(ok=True,oracle=verify_query_response(response))
            except Exception as error:value.update(ok=False,error=fx.scrub(str(error)))
            return value
        def audit(n):
            return {'ok': True, 'facts': rig.audit_facts()}
        def mutate(n):
            rig.operation_deadline.value=time.monotonic()+args.cycle_seconds
            event('mutation-start', iteration=n)
            new_name = TARGET if n % 2 else 'uat_renamed1882'
            old_name = 'uat_renamed1882' if TARGET not in manifest['tables'] else TARGET
            if new_name != old_name:
                manifest['tables'][new_name] = manifest['tables'].pop(old_name)
            if n > 0 and args.cycle_seed_rows:
                cycle_seed = json.loads(rig.exec('node', '-e', SEED_AUDIT, str(args.cycle_seed_rows), 'cycle-%d' % n, timeout=60))
                event('audit-seed', iteration=n, **cycle_seed)
            payload = {'connectionId': fx.CONN, 'schema': fx.SCHEMA, 'assetKind': 'schema_manifest',
                       'filename': 'uat.yaml', 'content': json.dumps(manifest), 'confirmOverwrite': True}
            enabled = TABLES if n % 2 == 0 else BASE_ENABLED
            operations = [('POST', '/api/catalog/assets/validate', payload),
                          ('POST', '/api/catalog/assets/upload', payload),
                          ('PUT', '/api/connections/'+fx.CONN+'/enabled-tables',
                           {'enabledTables': [fx.SCHEMA+'.'+t for t in enabled], 'dryRun': False})]
            for verb, path, body in operations:
                response = rig.request(rig.web, path, verb, body, timeout=args.mutation_timeout)
                rig.save('cycle-%d-%s' % (n, path.rsplit('/', 1)[-1]), response)
                event('mutation-step', iteration=n, path=path, status=response['httpStatus'],
                      ms=response['elapsedMs'], receipt=response)
                fx.require(response['httpStatus'] == 200 and response['body'].get('ok') is True, 'mutation failed '+path)
                data = response['body'].get('data', {})
                if path.endswith('/validate'):
                    fx.require(data.get('valid') is True, 'manifest validation rejected')
                if path.endswith('/upload'):
                    fx.require(data.get('uploaded') is True, 'manifest upload not committed')
                if path.endswith('/enabled-tables'):
                    fx.require(all(data.get(k) is True for k in ['written', 'policyRuntimeAck', 'runtimeAck']), 'enabled tables acknowledgment incomplete')
            before = rig.exec('cat', '/data/lucy/.ktx-ui/ktx.pid').strip()
            event('reload-start', iteration=n)
            response = rig.request(rig.web, '/api/admin/mcp-runtime/reload', 'POST',
                                   {'connectionId': fx.CONN, 'reason': 'isolated 1883-table soak cycle'}, timeout=args.mutation_timeout)
            rig.save('cycle-%d-reload' % n, response)
            after = rig.exec('cat', '/data/lucy/.ktx-ui/ktx.pid').strip()
            event('reload-end', iteration=n, status=response['httpStatus'], receipt=response, pidBefore=before, pidAfter=after)
            fx.require(response['httpStatus'] == 200 and response['body'].get('data', {}).get('reloadStatus') == 'succeeded', 'real execution reload failed')
            fx.require(before != after, 'reload did not restart actual KTX')
            read = rig.call('cycle-%d-renamed-read' % n, 'lucy_read_source',
                            {'connectionId': fx.CONN, 'sourceName': new_name}, session='rename-check-%d' % n)
            fx.require(fx.successful(read), 'renamed source not readable: '+str(response_reason(read)))
            recovery = rig.mcp_check('cycle-%d-recovery' % n)
            rig.save('cycle-%d-mcp-recovery' % n, recovery)
            scale = rig.scale_facts()
            fx.require(all(scale[k] >= 1883 for k in ['physical', 'enabled', 'manifest']), 'cycle scale dropped')
            fx.require(time.monotonic()<rig.operation_deadline.value, 'mutation total cycle deadline exceeded')
            event('mutation-end', iteration=n, shortName=new_name, scale=scale, oracle=recovery['oracle'])
            return {'ok': True, 'status': 200, 'shortName': new_name, 'scale': scale}
        for path in ['/api/livez', '/api/readyz', '/api/health']:
            scheduler.add('probe:'+path, 1, 4, lambda n, p=path: probe(p))
        scheduler.add('http', 1, 4, http)
        scheduler.add('mcp', 5, args.mcp_concurrency, mcp)
        scheduler.add('audit-progress', 5, 1, audit)
        scheduler.add('mutation', args.cycle_seconds, 1, mutate)
        started, natural_epoch = time.monotonic(), time.time()
        natural_end = started + args.seconds
        summary.update(soakStartedAt=datetime.datetime.fromtimestamp(natural_epoch, datetime.timezone.utc).isoformat(),
                       naturalPlannedFinishedAt=datetime.datetime.fromtimestamp(natural_epoch+args.seconds, datetime.timezone.utc).isoformat(),
                       naturalStartedMonotonic=started, naturalDeadlineMonotonic=natural_end, mainPid=pid)
        summary['windows'].append({'name': 'natural', 'start': summary['soakStartedAt'], 'plannedEnd': summary['naturalPlannedFinishedAt'], 'cpuProfiler': False})
        save_summary()
        scheduler.start(started, args.seconds)
        minute = -1
        while time.monotonic() < natural_end:
            elapsed = time.monotonic()-started
            if args.stop_after is not None and elapsed >= args.stop_after:
                event('controlled-stop', elapsedSeconds=elapsed)
                summary['controlledStop'] = True
                break
            if int(elapsed//60) != minute:
                minute = int(elapsed//60)
                with write_lock:
                    snapshot = list(records)
                progress = {'elapsedSeconds': round(elapsed, 3), 'counts': ledger_counts(snapshot)}
                (root/'progress.json').write_text(json.dumps(progress, indent=2)+'\n')
                print(json.dumps(progress), flush=True)
            stop.wait(min(.25, max(0, natural_end-time.monotonic())))
        summary['naturalObservedSeconds'] = min(args.seconds, time.monotonic()-started)
        summary['soakFinishedAt'] = datetime.datetime.fromtimestamp(natural_epoch+summary['naturalObservedSeconds'],datetime.timezone.utc).isoformat()
        summary['windows'][0]['end'] = summary['soakFinishedAt']
        scheduler.end=min(scheduler.end,time.monotonic())
        stop.set()
        event('natural-stop-arrivals', elapsedSeconds=time.monotonic()-started)
        alive = scheduler.finish(args.drain_seconds)
        summary['workersAfterDrain'] = alive
        summary['drainFinishedAt'] = fx.now()
        event('drain-ended', alive=alive)
        fx.require(alive == 0, 'actual request workers exceeded declared drain; preserve in-flight evidence and terminate owned resources')
        if args.contract_policy=='p1-69':
            recovery_window={'name':'explicit-contract-recovery','start':fx.now(),'naturalPerformanceWindow':False}
            summary['windows'].append(recovery_window)
            rig.logs('contract-owner-log',timeout=min(30,args.collect_seconds))
            for owner in parse_reload_owner_logs((rig.out/'contract-owner-log.json').read_text()):
                event('reload-owner',owner=owner)
            with write_lock:before_recovery=list(records)
            recovery=run_contract_recoveries(rig,request_failures(before_recovery),before_recovery,emit,
                                             args.contract_recovery_seconds,args.contract_recovery_concurrency)
            summary['contractRecovery']=recovery
            recovery_window['end']=fx.now()
            fx.require(recovery['workersAlive']==0,'explicit contract recovery actual workers exceeded deadline')
        if args.io_control:
            control = {'name': 'diagnostic-fifo-control', 'start': fx.now(), 'naturalPerformanceWindow': False}
            summary['windows'].append(control)
            rig.inject()
            observed = []
            known_workers, blocked_workers, terminated_workers = set(), set(), set()
            max_diagnostic_inflight=0
            until = time.monotonic()+args.io_seconds
            while time.monotonic() < until:
                inventory=rig.diagnostic_inventory(known_workers)
                known_workers.update(w['identity'] for w in inventory['workers'])
                blocked_workers.update(w['identity'] for w in inventory['workers'] if w['blockedFifo'])
                terminated_workers.update(inventory['gone'])
                max_diagnostic_inflight=max(max_diagnostic_inflight,len(inventory['workers']))
                observed.append({'at': fx.now(), 'inventory': inventory, 'health': rig.health()})
                time.sleep(min(1, max(0, until-time.monotonic())))
            rig.save('io-control-observations', observed)
            recovery_deadline=time.monotonic()+args.recovery_seconds
            rig.signal_fixture('restore-path',timeout=min(5,max(.001,recovery_deadline-time.monotonic())))
            recovery=recover_diagnostic(rig,known_workers,blocked_workers,recovery_deadline)
            recovered=recovery['observations']
            terminated_workers.update(recovery['terminated'])
            max_diagnostic_inflight=max(max_diagnostic_inflight,recovery['maxInflight'])
            rig.save('io-control-recovery', recovery)
            fx.require(recovery['recovered'],'same-process diagnostic recovery did not complete within shared absolute deadline')
            facts={'observedWorkers':sorted(known_workers),'blockedWitnesses':sorted(blocked_workers),'actualTerminated':sorted(terminated_workers),'maxDiagnosticInflight':max_diagnostic_inflight,'sameServerPid':pid in recovered[-1]['inventory']['serverPids'],'oldFifoReleasedBeforeFresh':False}
            rig.save('io-control-terminal-facts',facts)
            fx.require(bool(blocked_workers),'real FIFO blocked-worker witness absent')
            fx.require(blocked_workers.issubset(terminated_workers),'blocked diagnostic process identity still alive after recovery deadline')
            fx.require(max_diagnostic_inflight<=1,'diagnostic single-flight violated')
            fx.require(facts['sameServerPid'],'server process changed during automatic recovery')
            summary['ioControlFacts']=facts
            rig.save('mcp-after-io', rig.mcp_check('after-io'))
            # Release the old FIFO handle only AFTER observing fresh: this is not
            # manual unblocking passed off as automatic recovery.
            rig.signal_fixture('release')
            control['end'] = fx.now()
            summary['ioControlPassed'] = True
        else:
            summary['ioControlPassed'] = False
        if args.profile_seconds:
            diagnostic = {'name': 'short-cpu-diagnostic', 'start': fx.now(), 'seconds': args.profile_seconds, 'naturalPerformanceWindow': False}
            summary['windows'].append(diagnostic)
            rig.exec('node', '-e', "process.kill(Number(process.argv[1]),'SIGUSR1')", pid)
            diagnostic_program = PROFILE.replace('while(!fss.existsSync(dir+\'/stop\')){', 'while(n<1){').replace('i<60&&', 'i<'+str(math.ceil(args.profile_seconds))+'&&')
            rig.exec('node', '-e', diagnostic_program, timeout=args.profile_seconds+15)
            diagnostic['end'] = fx.now()
        rig.save('mcp-final', rig.mcp_check('soak-final'))
        rig.save('scale-final', rig.scale_facts())
        # Stop observer before expensive closed-view verifier; this phase is not
        # natural business latency. Verification never rewrites product state.
        rig.exec('touch', '/tmp/lucy-core1883/stop', timeout=5)
        audit_deadline = time.monotonic()+args.audit_settle_seconds
        audit = None
        attempts = 0
        while time.monotonic() < audit_deadline:
            attempts += 1
            audit = rig.audit_verify(min(args.collect_seconds, max(.1, audit_deadline-time.monotonic())))
            rig.save('audit-closure-%03d' % attempts, audit)
            if audit.get('complete') or audit.get('error'):
                break
            time.sleep(min(2, max(0, audit_deadline-time.monotonic())))
        summary['auditClosure'] = audit
        summary['expectedHistoryRows'] = args.seed_rows + sum(e.get('inserted',0) for e in records if e['kind']=='audit-seed')
        summary['auditFixtureScalePassed'] = bool(audit and audit.get('historyRows')==summary['expectedHistoryRows'] and audit.get('historyUsers')==min(67,summary['expectedHistoryRows']))
        if args.audit_evidence_copy:
            copy_deadline=time.monotonic()+args.collect_seconds
            try:
                remaining=max(.001,copy_deadline-time.monotonic())
                evidence=json.loads(rig.exec('python3','-c',AUDIT_BACKUP,'/data/lucy/.ktx-ui/audit.sqlite','/tmp/lucy-audit-evidence/audit-evidence.sqlite',rig.cutoff,str(remaining),timeout=remaining))
                remaining=copy_deadline-time.monotonic()
                fx.require(remaining>0,'audit evidence shared collection deadline before copy')
                run_owned_process(['docker','cp',rig.app+':/tmp/lucy-audit-evidence/audit-evidence.sqlite.gz',str(root/'audit-evidence.sqlite.gz')],timeout=remaining)
                digest=hashlib.sha256()
                with (root/'audit-evidence.sqlite.gz').open('rb') as stream:
                    while True:
                        fx.require(time.monotonic()<copy_deadline,'audit evidence shared collection deadline during verification')
                        chunk=stream.read(1024*1024)
                        if not chunk:break
                        digest.update(chunk)
                fx.require(digest.hexdigest()==evidence['gzipSha256'],'transferred audit evidence hash mismatch')
                fx.require(time.monotonic()<=copy_deadline,'audit evidence shared collection deadline after copy')
                evidence.update(path='audit-evidence.sqlite.gz',copied=True,collectionElapsedSeconds=args.collect_seconds-(copy_deadline-time.monotonic()),collectionDeadlineSeconds=args.collect_seconds)
                (root/'audit-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
                summary['auditEvidence']=evidence
            except Exception as evidence_error:
                summary['auditEvidence']={'copied':False,'error':fx.scrub(str(evidence_error)),'gap':True}
        else:
            summary['auditEvidence']={'copied':False,'requested':False,'gap':True}
        if args.contract_policy=='p1-69' and summary.get('auditEvidence',{}).get('copied'):
            with write_lock:recoveries=[e for e in records if e.get('kind')=='contract-recovery']
            try:
                for proof in verify_contract_audit_copy(root,summary['auditEvidence'],recoveries,args.collect_seconds):emit(proof)
            except Exception as proof_error:
                summary['contractAuditError']=fx.scrub(str(proof_error))
        fx.run(['docker', 'cp', rig.app+':/tmp/lucy-core1883', str(root/'observations')], timeout=args.collect_seconds)
        rig.logs('final-container-log')
        with write_lock:
            snapshot = list(records)
        counts = ledger_counts(snapshot)
        summary['counts'] = counts
        terminals = [e for e in snapshot if e['kind'] == 'request-terminal']
        summary['probeSummary'] = {}
        for path in ['/api/livez', '/api/readyz', '/api/health']:
            values = [e for e in terminals if e['lane'] == 'probe:'+path]
            summary['probeSummary'][path] = probe_statistics(values)
        summary['latency'] = {}
        for lane in ['http', 'mcp']:
            for label, values in [('all-terminal', [e for e in terminals if e['lane'] == lane]),
                                  ('natural-success', [e for e in terminals if e['lane'] == lane and e.get('ok') and not e['censoredNatural']])]:
                summary['latency'][lane+':'+label] = {**{'p%dMs' % int(p*100): percentile(values, p) for p in [.5, .95, .99]},
                                                    'maxMs': max((e['ms'] for e in values), default=None), 'count': len(values)}
        summary['eventErrors'] = request_failures(snapshot)
        summary['failurePolicy'] = 'All failures retained. No text/window-based exemptions. Contract verdicts use the separately reviewed owner-bound policy seam.'
        summary['contractFailureVerdicts'] = [{'requestId':e.get('requestId'),'lane':e['lane'],**contract_failure_verdict(e,snapshot,args.contract_policy)} for e in summary['eventErrors']]
        summary['contractExpectedFailures']=[e for e in summary['eventErrors'] if contract_failure_verdict(e,snapshot,args.contract_policy)['expected']]
        summary['unexpectedErrors']=[e for e in summary['eventErrors'] if not contract_failure_verdict(e,snapshot,args.contract_policy)['expected']]
        summary['userVisibleFailureCount']=len(summary['eventErrors'])
        summary['completedMutations'] = sum(e['lane'] == 'mutation' and e.get('ok') and not e['censoredNatural'] for e in terminals)
        live, ready = summary['probeSummary']['/api/livez'], summary['probeSummary']['/api/readyz']
        summary['budgetPassed'] = (live['p99Ms'] is not None and live['p99Ms'] <= 400 and
                                   live['maxMs'] <= 1000 and ready['p99Ms'] is not None and ready['p99Ms'] <= 1500)
        enough = summary['completedMutations'] == math.ceil(args.seconds/args.cycle_seconds)
        main_lanes = ['http', 'mcp', 'mutation']+['probe:'+p for p in ['/api/livez', '/api/readyz', '/api/health']]
        accounted = all(counts[k]['conserved'] and counts[k]['missed'] == 0 and counts[k]['inflight'] == 0 for k in main_lanes)
        main_failures = [e for e in summary['eventErrors'] if e['lane'] in main_lanes and not contract_failure_verdict(e,snapshot,args.contract_policy)['expected']]
        passed = (not summary.get('controlledStop') and enough and accounted and not main_failures and
                  summary['budgetPassed'] and summary['auditFixtureScalePassed'] and bool(audit and audit.get('complete')) and
                  (not args.io_control or summary.get('ioControlPassed')) and
                  (not args.audit_evidence_copy or summary.get('auditEvidence',{}).get('copied')))
        summary['status'] = qualification_status(args.mode, passed)
        summary['uncovered'] = ['full F61 matrix', 'F62 three-category saturation', 'full F63 lifecycle', 'original high-tier R-CAV', 'customer root cause']
        if not args.io_control:
            summary['uncovered'].append('1883-table diagnostic FIFO recovery FUP-06')
    except BaseException as error:
        summary.update(status='FAIL', error=fx.scrub(str(error)), errorType=type(error).__name__)
        print('ERROR: '+summary['error'], flush=True)
        stop.set()
        if scheduler.end is not None:scheduler.end=min(scheduler.end,time.monotonic())
        if started is not None:
            summary['naturalObservedSeconds'] = min(args.seconds, time.monotonic()-started)
            summary['soakFinishedAt'] = datetime.datetime.fromtimestamp(natural_epoch+summary['naturalObservedSeconds'],datetime.timezone.utc).isoformat()
            summary['windows'][0]['end'] = summary['soakFinishedAt']
        # Keep collection bounded even when termination arrived during setup.
        try:
            remaining=running_deadline-time.monotonic()
            if remaining>0:rig.logs('failure-container-log',timeout=min(30,remaining))
            else:summary['failureLogError']='running deadline expired; proceed directly to bounded cleanup'
        except Exception as collect_error:
            summary['failureLogError'] = fx.scrub(str(collect_error))
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        running_finished=time.monotonic()
        summary['runningElapsedSeconds']=running_finished-running_started
        summary['runningDeadlineExceeded']=running_finished>running_deadline
        if summary['runningDeadlineExceeded']:summary['status']='FAIL'
        cleanup_started=time.monotonic();cleanup_deadline=cleanup_started+args.cleanup_seconds
        summary['cleanupStartedAt']=fx.now()
        stop.set()
        summary['workersAtCleanup']=scheduler.finish(min(5,max(0,cleanup_deadline-time.monotonic())))
        if args.keep_resources:
            summary['cleanup']={'complete':False,'reason':'explicit keep-resources','app':rig.app,'db':rig.db,'network':rig.network,'volume':rig.data_volume}
            summary['status']='FAIL'
        else:
            try:
                rig.close(deadline=cleanup_deadline)
                summary['cleanup']=json.loads((rig.out/'cleanup.json').read_text())
            except Exception as cleanup_error:
                summary.update(cleanupError=fx.scrub(str(cleanup_error)),status='FAIL')
        summary['workersAfterCleanup']=scheduler.finish(min(5,max(0,cleanup_deadline-time.monotonic())))
        with write_lock:
            summary['counts']=ledger_counts(list(records))
        summary['cleanupElapsedSeconds']=time.monotonic()-cleanup_started
        summary['cleanupDeadlineExceeded']=time.monotonic()>cleanup_deadline
        if summary['workersAfterCleanup'] or summary['cleanupDeadlineExceeded']:summary['status']='FAIL'
        summary['finishedAt']=fx.now()
        summary['totalElapsedSeconds']=time.monotonic()-running_started
        counts_valid=bool(summary['counts']) and all(v['conserved'] and v['inflight']==0 for v in summary['counts'].values())
        tool_pass=counts_valid and not summary['workersAfterCleanup'] and bool(summary.get('cleanup',{}).get('complete')) and not summary['cleanupDeadlineExceeded'] and not summary['runningDeadlineExceeded']
        summary['toolQualification']={'status':'PASS' if tool_pass else 'FAIL','scope':'counter/termination/cleanup qualification only; product failures retained','countsConserved':counts_valid,'controlledStop':bool(summary.get('controlledStop')),'productStatus':summary['status']}
        save_summary()
        for sig,handler in previous.items():signal.signal(sig,handler)
    # Print compact metadata; full per-request evidence remains in the output.
    print(json.dumps({k: summary.get(k) for k in ['status', 'mode', 'completedMutations', 'counts', 'budgetPassed', 'cleanup', 'error']}, indent=2), flush=True)
    return 0 if summary['status'] in ['PASS WITH GAP', 'CALIBRATION PASS'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
