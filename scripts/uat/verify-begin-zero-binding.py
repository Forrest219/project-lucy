#!/usr/bin/env python3
"""Isolated real Docker/MySQL/MCP verification for P1-60 (no production credentials)."""
from __future__ import annotations
import argparse, concurrent.futures, datetime, hashlib, http.cookiejar, json, math, os
import pathlib, random, re, secrets, shutil, sqlite3, subprocess, tempfile, time, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONN, SOURCE, SCHEMA = 'uat-mysql', 'uat_begin_zero_orders', 'uat'
TOOLS = ['lucy_catalog','lucy_query','lucy_read_source','lucy_explain_query','lucy_begin_question','lucy_continue_question','connection_list']
CODE = ['webui/server/proxy/'+f for f in ['mcp-proxy.ts','caliber-binding-registry.ts','caliber-binding-session.ts','caliber-binding.ts']]
SECRETS = []

def scrub(s):
    for secret in SECRETS: s = s.replace(secret,'[REDACTED]')
    return s

def run(cmd, data=None, check=True, timeout=240):
    r = subprocess.run([str(x) for x in cmd],input=data,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    if check and r.returncode: raise RuntimeError('command failed '+str(cmd[:3])+': '+scrub(r.stderr[-1500:]))
    return r.stdout.strip()

def sha(s): return hashlib.sha256(s.encode()).hexdigest()
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def require(condition,message):
    if not condition: raise AssertionError(message)

def inner(r):
    v=r['body'].get('result',r['body'])
    for c in v.get('content',[]):
        if c.get('type')=='text':
            try: return json.loads(c['text'])
            except (ValueError,TypeError): return c['text']
    return v

def successful(r):
    value=inner(r)
    return r['httpStatus']==200 and not r['body'].get('error') and not r['body'].get('result',{}).get('isError',False) and not (isinstance(value,dict) and value.get('reason') in ['question_budget_exhausted','question_budget_unavailable'])

class Rig:
    def __init__(self,image,out,label,variant='I0'):
        self.image,self.out,self.label=image,pathlib.Path(out),label
        self.variant=variant
        self.out.mkdir(parents=True,exist_ok=True)
        self.tag='lucy-zb-'+label+'-'+secrets.token_hex(3)
        self.app,self.db,self.network=self.tag+'-app',self.tag+'-db',self.tag
        self.private=pathlib.Path(tempfile.mkdtemp(prefix=self.tag+'-'));os.chmod(self.private,0o700)
        self.project=self.private/'project';self.project.mkdir()
        self.boot,self.password,self.dbpass,self.rootpass=[secrets.token_urlsafe(28) for _ in range(4)]
        self.tokens={name:secrets.token_urlsafe(28) for name in ['a','b','c','expired','revoked','disabled','denied']}
        SECRETS.extend([self.boot,self.password,self.dbpass,self.rootpass,*self.tokens.values()])
        self.jar=http.cookiejar.CookieJar();self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.rpc_id=0;self.web=self.mcp='';self.events=[];self.created=[]
    def save(self,name,obj):
        text=obj if isinstance(obj,str) else json.dumps(obj,ensure_ascii=False,indent=2)
        (self.out/(name+'.json')).write_text(scrub(text)+'\n')
    def request(self,base,route,method='GET',body=None,headers=None,timeout=180,admin=True):
        req=urllib.request.Request(base+route,data=None if body is None else json.dumps(body).encode(),method=method,headers={'Origin':base,**({'Content-Type':'application/json'} if body is not None else {}),**(headers or {})})
        started=time.monotonic()
        try: res=(self.opener if admin else urllib.request.build_opener()).open(req,timeout=timeout)
        except urllib.error.HTTPError as e: res=e
        raw=res.read().decode()
        try: value=json.loads(raw)
        except ValueError:
            frames=[json.loads(x[6:]) for x in raw.splitlines() if x.startswith('data: ') and x[6:].strip()]
            value=next((x for x in reversed(frames) if 'result' in x or 'error' in x),{'raw':raw[:2000]})
        return {'httpStatus':res.status,'elapsedMs':round((time.monotonic()-started)*1000,3),'body':value}
    def api(self,name,route,body=None,method='POST',must=True):
        r=self.request(self.web,route,method,body);self.save(name,r)
        if must: require(r['httpStatus']<400 and r['body'].get('ok') is not False,name+' failed: '+scrub(json.dumps(r,ensure_ascii=False)[:2000]))
        return r
    def call(self,name,tool=None,args=None,method='tools/call',who='a',session=None,save=True):
        self.rpc_id+=1;body={'jsonrpc':'2.0','id':self.rpc_id,'method':method}
        if method=='tools/call':body['params']={'name':tool,'arguments':args or {}}
        elif method=='initialize':body['params']={'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'zb-uat','version':'1'}}
        r=self.request(self.mcp,'/mcp','POST',body,{'Authorization':'Bearer '+self.tokens[who],'Accept':'application/json, text/event-stream','x-lucy-session-id':session or name},admin=False)
        self.events.append({'name':name,'tool':tool or method,'who':who,'session':session or name,'ok':successful(r),'elapsedMs':r['elapsedMs'],'rpcId':self.rpc_id})
        if save:self.save(name,r)
        return r
    def query(self,name,who='a',session=None,bound=False,save=True):
        measures=[SOURCE+'.order_count'] if bound else [SOURCE+'.order_count',SOURCE+'.amount_sum']
        r=self.call(name,'lucy_query',{'connectionId':CONN,'measures':measures},who=who,session=session,save=save)
        require(successful(r),name+' query failed: '+json.dumps(r,ensure_ascii=False)[:1500])
        data=inner(r)
        # Column names may be rewritten by KTX; compare the actual single aggregate row.
        rows=data.get('rows') or data.get('data') if isinstance(data,dict) else None
        if isinstance(rows,dict):rows=rows.get('rows')
        require(isinstance(rows,list) and len(rows)==1,name+' unexpected data '+repr(data)[:1200])
        row=rows[0];values=list(row.values()) if isinstance(row,dict) else row
        values=[float(x) for x in values if isinstance(x,(int,float)) or isinstance(x,str) and re.fullmatch(r'-?\d+(\.\d+)?',x)]
        expected=[2,30] if who=='b' else [4,100]
        if bound:expected=expected[:1]
        require(sorted(values)==sorted(expected),name+' oracle mismatch '+repr(row)+' expected '+repr(expected))
        return r
    def hidden(self,name,who='a',session=None,force=True):
        init=self.call(name+'-init',method='initialize',who=who,session=session)
        tools=self.call(name+'-tools',method='tools/list',who=who,session=session)
        require(successful(init) and successful(tools),name+' protocol failed')
        names=[t['name'] for t in tools['body']['result']['tools']]
        require('lucy_begin_question' not in names,name+' begin exposed')
        require('lucy_begin_question' not in init['body']['result'].get('instructions',''),name+' begin guidance exposed')
        require('lucy_continue_question' in names,name+' continue hidden')
        if force:
            for suffix,args in [('valid',{'intentSummary':'测试订单'}),('missing',{}),('invalid',{'intentSummary':'测试订单','caliberBindingId':'not-existing'})]:
                r=self.call(name+'-forced-'+suffix,'lucy_begin_question',args,who=who,session=session)
                require(r['body'].get('result',{}).get('isError') is True and r['body']['result'].get('data',{}).get('reason')=='begin_not_available',name+' D2 failed '+json.dumps(r,ensure_ascii=False)[:1000])
        return self.query(name+'-query',who,session)
    def write(self,relative,content):
        require(not relative.startswith('/') and '..' not in pathlib.Path(relative).parts,'unsafe fixture path')
        run(['docker','exec','-i','--user','10001',self.app,'sh','-c','mkdir -p "$(dirname "$1")"; cat > "$1"','sh','/data/lucy/'+relative],content)
    def remove(self,relative):
        require('..' not in pathlib.Path(relative).parts,'unsafe fixture path')
        run(['docker','exec','--user','10001',self.app,'rm','-rf','/data/lucy/'+relative])
    def sql(self,sql):
        return run(['docker','exec','-i',self.db,'sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B'],sql)
    def audit(self,sql):
        # Read-only production audit schema; arguments are SQL controlled by this runner only.
        script='import sqlite3,json,sys; c=sqlite3.connect("file:/data/lucy/.ktx-ui/audit.sqlite?mode=ro",uri=True);c.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in c.execute(sys.stdin.read())]))'
        return json.loads(run(['docker','exec','-i',self.app,'python3','-c',script],sql))
    def ready(self):
        for _ in range(120):
            try:
                r=self.request(self.web,'/api/health',timeout=2)
                if r['httpStatus']==200 and r['body'].get('data',{}).get('ktxRuntime',{}).get('ready'):return r
            except Exception:pass
            time.sleep(1)
        raise RuntimeError('readiness timeout')
    def seed(self):
        for name in ['webui/config','config/semantic-layer/'+CONN+'/_schema','config/wiki','config/skills','config/evals']:(self.project/name).mkdir(parents=True,exist_ok=True)
        config={'connections':{CONN:{'driver':'mysql','host':self.db,'port':3306,'database':SCHEMA,'username':'lucy','password':self.dbpass,'schemas':[SCHEMA],'enabled_tables':[SCHEMA+'.'+SOURCE]}},'storage':{'state':'sqlite','search':'sqlite-fts5','git':{'author':'uat <uat@localhost>'}}}
        (self.project/'ktx.yaml').write_text(json.dumps(config))
        manifest={'tables':{SOURCE:{'table':SCHEMA+'.'+SOURCE,'columns':[{'name':'order_id','type':'number','pk':True},{'name':'tenant','type':'string'},{'name':'amount','type':'number'}]}}}
        overlay={'name':SOURCE,'grain':['order_id'],'measures':[{'name':'order_count','expr':'count(distinct order_id)'},{'name':'amount_sum','expr':'sum(amount)'}]}
        (self.project/('config/semantic-layer/'+CONN+'/_schema/uat.yaml')).write_text(json.dumps(manifest))
        (self.project/('config/semantic-layer/'+CONN+'/'+SOURCE+'.yaml')).write_text(json.dumps(overlay))
        roles={}
        for name in ['a','b','c']:
            selector={'connection':CONN,'schema':SCHEMA,'names':[SOURCE],'row_access':'scoped' if name=='b' else 'all'}
            if name=='b':selector['row_policy']={'predicates':[{'field':'tenant','op':'eq','value':'NORTH'}]}
            roles[name]={'permission_model_version':2,'allow':{'connections':[CONN],'tableSelectors':[selector],'tools':[x for x in TOOLS if not(name=='c' and x=='lucy_begin_question')]}}
        users=[]
        for name,token in self.tokens.items():
            t={'hash':'sha256:'+sha(token),'label':'isolated-'+name,'created':'2026-11-20'}
            if name=='expired':t['expires_at']='2020-01-01T00:00:00Z'
            users.append({'id':'uat_zb_'+name,'name':'ZB '+name,'enabled':name!='disabled','role':name if name in roles else 'a','tokens':[t]})
        self.access={'roles':roles,'users':users,'defaults':{'deny_tools':['sl_query','sl_read_source','sql_execution']}}
        (self.project/'webui/config/access.yaml').write_text(json.dumps(self.access))
        boot=self.private/'bootstrap-token';boot.write_text(self.boot);os.chmod(boot,0o600)
        env=self.private/'db.env';env.write_text('MYSQL_ROOT_PASSWORD='+self.rootpass+'\n');os.chmod(env,0o600)
        bindings=self.project/'config/caliber-bindings'
        if self.variant in ['I1','I2']:bindings.mkdir(parents=True,exist_ok=True)
        if self.variant=='I2':(bindings/'.caliber-binding').mkdir()
        if self.variant=='I4':
            bindings.mkdir(parents=True,exist_ok=True);(bindings/'draft.yaml').write_text('status: draft\ntriggers: invalid-unpublished-field\n')
        if self.variant in ['L1','U0']:
            bindings.mkdir(parents=True,exist_ok=True);(bindings/'bound.yaml').write_text(json.dumps(self.binding()))
        return boot,env
    def start(self):
        boot,env=self.seed();run(['docker','network','create',self.network]);self.created.append('network')
        run(['docker','run','-d','--name',self.db,'--network',self.network,'--env-file',env,'mysql:8.4']);self.created.append('db')
        for _ in range(90):
            if run(['docker','exec',self.db,'sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping -uroot --silent'],check=False)=='mysqld is alive':break
            time.sleep(1)
        else:raise RuntimeError('mysql readiness timeout')
        self.sql("CREATE DATABASE uat; CREATE TABLE uat."+SOURCE+"(order_id INT PRIMARY KEY,tenant VARCHAR(20),amount INT); INSERT INTO uat."+SOURCE+" VALUES(1,'NORTH',10),(2,'NORTH',20),(3,'SOUTH',30),(4,'SOUTH',40); CREATE USER 'lucy'@'%' IDENTIFIED BY '"+self.dbpass+"'; GRANT SELECT,SHOW VIEW ON uat.* TO 'lucy'@'%';")
        oracle=self.sql('SELECT COUNT(DISTINCT order_id),SUM(amount) FROM uat.'+SOURCE+'; SELECT COUNT(DISTINCT order_id),SUM(amount) FROM uat.'+SOURCE+" WHERE tenant='NORTH';")
        self.save('oracle',{'sqlResult':oracle});require(oracle.splitlines()==['4\t100','2\t30'],'independent oracle failed')
        run(['docker','run','--rm','--user','0','--entrypoint','/bin/sh','-v',str(self.project)+':/data/lucy','-v',str(boot)+':/bootstrap-token',self.image,'-c','chown -R 10001:10001 /data/lucy; chown 10001:10001 /bootstrap-token'])
        if self.variant in ['I3','L0','L1','U0']:self.legacy(boot)
        cmd=['docker','run','-d' ,'--name',self.app,'--network',self.network,'--cpus','2','--memory','2g','-p','127.0.0.1::5174','-p','127.0.0.1::7879','-v',str(self.project)+':/data/lucy','-v',str(boot)+':/run/secrets/bootstrap-token:ro']
        for v in ['KTX_PROJECT_ROOT=/data/lucy','LUCY_CONTENT_ROOT=/data/lucy/config','LUCY_DISABLE_TEMPLATE_SYNC=1','LUCY_DEPLOYMENT_MODE=customer','LUCY_WEBUI_TEST_PROFILE=1','LUCY_WEBUI_COOKIE_SECURE=0','LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE=/run/secrets/bootstrap-token','LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=true','LUCY_QUESTION_BUDGET=on','POSTHOG_DISABLED=1']:cmd+=['-e',v]
        run(cmd+[self.image]);self.created.append('app')
        self.web='http://'+run(['docker','port',self.app,'5174/tcp']);self.mcp='http://'+run(['docker','port',self.app,'7879/tcp'])
        health=self.ready();self.save('health',health)
        r=self.request(self.web,'/api/auth/bootstrap','POST',{'adminId':'uat_owner','displayName':'UAT Owner','password':self.password},{'x-lucy-bootstrap-token':self.boot});require(r['httpStatus']==200,'bootstrap failed')
        self.save('bootstrap',{'httpStatus':r['httpStatus'],'cookieIssued':bool(list(self.jar))})
        self.save('artifact',{'image':run(['docker','image','inspect',self.image,'--format','{{.Id}} {{.Os}}/{{.Architecture}}']),'container':run(['docker','inspect',self.app,'--format','{{.Id}}']),'code':run(['docker','exec',self.app,'sha256sum',*['/app/'+p for p in CODE]]),'resources':{'cpus':2,'memory':'2g'},'webUrl':self.web,'mcpUrl':self.mcp+'/mcp','fixtureFingerprints':{str(p.relative_to(self.project)):hashlib.sha256(p.read_bytes()).hexdigest() for p in self.project.rglob('*') if p.is_file() and p.suffix in ['.yaml']},'startedAt':now()})
    def binding(self,status='published'):
        return {'bindingId':'uat_zero','title':'UAT count only','status':status,'triggers':['固定订单数'],'connectionId':CONN,'source':SOURCE,'caliber':{'measures':[SOURCE+'.order_count'],'dimensions':[],'segments':[],'filterFields':[],'requireMeasures':[SOURCE+'.order_count']}}
    def legacy(self,boot):
        baseline=os.environ.get('ZB_BASELINE_IMAGE','sha256:c1cd67a0df3dffd33b7c9d0c3914ca4a759bb5a6e4e8af3f9fe6b8c66323a218')
        ident='uat_zb_a|'+('sha256:'+sha(self.tokens['a']))[:19]
        code="""(async()=>{const r=await import('/app/webui/server/proxy/caliber-binding-registry.ts');const s=await import('/app/webui/server/proxy/caliber-binding-session.ts');const c=await r.loadCaliberBindingCandidate();if(!c.ok)throw Error(JSON.stringify(c));const committed=await r.commitCaliberBindingRegistry(c,{releaseId:'legacy-fixture',attemptId:'legacy-fixture'});if(!committed.ok)throw Error(JSON.stringify(committed));"""
        if self.variant in ['L0','L1','U0']:
            if self.variant=='L0':fields={'turnId':'legacy-optional','registryGeneration':1,'bindingId':None,'boundKey':None,'caliberSnapshot':None}
            else:fields={'turnId':'legacy-strong','registryGeneration':1,'bindingId':'uat_zero','boundKey':{'connectionId':CONN,'schema':SCHEMA,'sourceName':SOURCE,'physicalTable':SCHEMA+'.'+SOURCE},'caliberSnapshot':self.binding()['caliber']}
            if self.variant in ['L1','U0']:
                code+='await s.commitBindingSession(s.bindingScopeKey('+json.dumps(ident)+',"legacy"),'+json.dumps(fields)+');'
                if self.variant=='U0':fields={**fields,'boundKey':None,'caliberSnapshot':None}
            code+='await s.beginBindingSessionPreparation(s.bindingScopeKey('+json.dumps(ident)+',"legacy"),'+json.dumps(fields)+');'
        code+='console.log(JSON.stringify({legacyFixture:true,fileCount:c.registry.fileCount,phase:"committed",variant:'+json.dumps(self.variant)+'}));})()'
        result=run(['docker','run','--rm','--network',self.network,'-v',str(self.project)+':/data/lucy','-e','KTX_PROJECT_ROOT=/data/lucy','-e','LUCY_CONTENT_ROOT=/data/lucy/config','--entrypoint','/app/webui/node_modules/.bin/tsx',baseline,'-e',code])
        self.save('legacy-fixture-provenance',{'baselineImage':baseline,'variant':self.variant,'result':result,'method':'baseline production APIs offline before candidate starts; no fabricated commit bytes'})
    def activate_authoring(self,name,must_ack=True):
        # The serving ACL is a committed snapshot; editing author files alone is not activation.
        detail=self.api(name+'-detail','/api/admin/agents/uat_zb_denied',method='GET')['body']['data']
        body={'version':detail['version'],'dryRun':True,'patch':{'note':'isolated UAT control '+name}}
        self.api(name+'-preview','/api/admin/agents/uat_zb_denied',body,method='PATCH')
        body['dryRun']=False
        result=self.api(name+'-commit','/api/admin/agents/uat_zb_denied',body,method='PATCH',must=must_ack)
        data=result['body'].get('data',{});require(not must_ack or data.get('policyRuntimeAck') is True or data.get('runtimeAck') is True,name+' serving activation not acknowledged')
        return result
    def reindex(self,name):
        pending=self.api(name+'-pending','/api/diff',method='GET')['body']['data']
        r=self.api(name,'/api/semantic-assets/reindex',{'pendingDigest':pending['pendingDigest']})
        return r
    def publish(self,name):
        # A real ordinary HTTP release of the same healthy manifest plus a harmless comment.
        manifest=run(['docker','exec',self.app,'cat','/data/lucy/config/semantic-layer/'+CONN+'/_schema/uat.yaml'])
        payload={'files':[{'filename':'uat.yaml','content':manifest+'\n# '+name+'\n'}],'defaultConnectionId':CONN,'defaultSchema':SCHEMA}
        v=self.api(name+'-validate','/api/semantic-assets/validate',payload)['body']['data']
        require(v.get('valid') is True,name+' validation failed '+json.dumps(v)[:1000])
        body={'validationId':v['validationId'],'confirmOverwrite':True,'idempotencyKey':'zb-'+name}
        plan=v.get('batch',{}).get('planDigest') or v.get('planDigest')
        if plan:body['planDigest']=plan
        if v.get('batch',{}).get('overwriteTargets') is not None:body['overwriteTargets']=v['batch']['overwriteTargets']
        r=self.api(name+'-publish','/api/semantic-assets/publish',body)
        release=r['body']['data']['release']['id']
        # Observe the in-progress tool surface without claiming an existing DRAIN rejection is success.
        tools=self.call(name+'-during-tools',method='tools/list')
        require('lucy_begin_question' not in [t['name'] for t in tools['body'].get('result',{}).get('tools',[])],name+' during exposure')
        forced=self.call(name+'-during-forced','lucy_begin_question',{})
        require(forced['body'].get('result',{}).get('data',{}).get('reason')=='begin_not_available',name+' during D2 failed')
        during=self.call(name+'-during-query','lucy_query',{'connectionId':CONN,'measures':[SOURCE+'.order_count',SOURCE+'.amount_sum']})
        require('caliber_binding_unresolved' not in json.dumps(during),name+' added binding gate while publishing')
        for _ in range(120):
            status=self.api(name+'-status','/api/semantic-assets/releases/'+release+'/status',method='GET')['body']['data']
            record=status.get('release',status)
            if record.get('status')=='published':return r
            if record.get('status') in ['blocked','promote_failed','reindex_failed','aborted']:raise RuntimeError(name+' release failed '+json.dumps(record)[:1500])
            time.sleep(.25)
        raise RuntimeError(name+' release timeout')
    def snapshot(self,session):
        key='bq:uat_zb_a|'+('sha256:'+sha(self.tokens['a']))[:19]+':'+session
        rows=self.audit("SELECT * FROM question_budget_state WHERE scope_key="+repr(key))
        return rows[0] if rows else None
    def binding_state(self):
        code='import pathlib,hashlib,json;root=pathlib.Path("/data/lucy");ds=[root/".ktx-ui/caliber-binding",root/"config/caliber-bindings/.caliber-binding"];print(json.dumps({str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for d in ds if d.exists() for p in d.rglob("*") if p.is_file()}))'
        return json.loads(run(['docker','exec',self.app,'python3','-c',code]))
    def exec_sqlite(self,sql):
        code='import sqlite3,sys;c=sqlite3.connect("/data/lucy/.ktx-ui/audit.sqlite");c.executescript(sys.stdin.read());c.commit()'
        run(['docker','exec','-i',self.app,'python3','-c',code],sql)
    def restart(self):
        before=run(['docker','inspect',self.app,'--format','{{.State.StartedAt}}'])
        run(['docker','restart','-t','45',self.app]);self.ready()
        after=run(['docker','inspect',self.app,'--format','{{.State.StartedAt}}'])
        self.save('restart-evidence',{'before':before,'after':after,'at':now()});require(before!=after,'not a real process restart')
    def rollback_failed_legacy_begin(self):
        # Existing D11 rollback over a genuine previous committed snapshot, with the app stopped.
        ident='uat_zb_a|'+('sha256:'+sha(self.tokens['a']))[:19]
        run(['docker','stop','-t','45',self.app])
        code='(async()=>{const s=await import("/app/webui/server/proxy/caliber-binding-session.ts");await s.restorePriorBindingSession(s.bindingScopeKey('+json.dumps(ident)+',"legacy"));console.log("restored-previous-committed");})()'
        result=run(['docker','run','--rm','-v',str(self.project)+':/data/lucy','-e','KTX_PROJECT_ROOT=/data/lucy','--entrypoint','/app/webui/node_modules/.bin/tsx',self.image,'-e',code])
        run(['docker','start',self.app]);self.ready()
        self.save('legacy-rollback',{'method':'existing D11 restorePriorBindingSession; stopped app, previous bound snapshot preserved','result':result,'at':now()})
    def close(self):
        self.save('events',self.events)
        for name in [self.app,self.db]:run(['docker','rm','-f',name],check=False)
        run(['docker','network','rm',self.network],check=False)
        shutil.rmtree(self.private,ignore_errors=True)
        remaining=run(['docker','ps','-a','--filter','name='+self.tag,'--format','{{.Names}}'])
        networks=run(['docker','network','ls','--filter','name=^'+self.network+'$','--format','{{.Name}}'])
        clean={'at':now(),'privateRemoved':not self.private.exists(),'containersRemoved':not remaining,'networkRemoved':not networks}
        self.save('cleanup',clean);require(all(clean[k] for k in ['privateRemoved','containersRemoved','networkRemoved']),'isolated cleanup incomplete')


def main():
    p=argparse.ArgumentParser();p.add_argument('--image',required=True);p.add_argument('--out',required=True);p.add_argument('--smoke',action='store_true');p.add_argument('--baseline-image');p.add_argument('--skip-agent',action='store_true');p.add_argument('--qualify-late',action='store_true');args=p.parse_args()
    out=pathlib.Path(args.out);out.mkdir(parents=True,exist_ok=True)
    expected=['UAT-ZB-R0']+['UAT-ZB-%02d'%i for i in range(1,13)]
    summary={'startedAt':now(),'image':args.image,'cases':{cid:{'status':'NOT RUN'} for cid in expected},'status':'RUNNING'}
    rigs=[]
    def save_summary():(out/'summary.json').write_text(scrub(json.dumps(summary,ensure_ascii=False,indent=2))+'\n')
    def mark(cid,detail=None):
        summary['cases'][cid]={'status':'PASS',**(detail or {})};save_summary();print(cid+' PASS',flush=True)
    def fresh(label,variant='I0',image=None):
        r=Rig(image or args.image,out/label,label,variant);rigs.append(r);r.start();return r
    try:
        rig=fresh('candidate');mark('UAT-ZB-R0',{'detail':'real isolated Docker/MySQL; independent SQL oracle'})
        rig.hidden('r01-a',session='r01-a');rig.hidden('r01-c',who='c',session='r01-c',force=False);mark('UAT-ZB-01')
        rig.query('r02-pre',session='r02');before=rig.snapshot('r02');binding_before=rig.binding_state();turns=rig.audit("SELECT COUNT(*) AS n FROM conversation_turns WHERE question_source='reported_tool'")
        rig.hidden('r02',session='r02');after=rig.snapshot('r02')
        require(before['round']==after['round'] and before['window_id']==after['window_id'] and after['calls']==before['calls']+1,'D2 changed budget window/calls')
        require(turns==rig.audit("SELECT COUNT(*) AS n FROM conversation_turns WHERE question_source='reported_tool'"),'D2 wrote a turn')
        binding_after=rig.binding_state();require(binding_before==binding_after,'D2 wrote binding/registry files')
        rig.save('r02-budget-proof',{'before':before,'after':after,'bindingBefore':binding_before,'bindingAfter':binding_after});mark('UAT-ZB-02')
        if args.smoke:summary['status']='SMOKE_PASS'
        else:
            if not args.qualify_late:
                # M01: each representation has an independently initialized data directory.
                for variant in ['I0','I1','I2','I3']:
                    current=rig if variant=='I0' else fresh(variant.lower(),variant)
                    for stage in ['initial','first','second']:
                        if stage!='initial':current.publish(variant+'-'+stage)
                        for session in [variant+'-old',variant+'-'+stage+'-new']:
                            current.hidden(variant+'-'+stage+'-'+session,session=session)
                    if current is not rig:current.close();rigs.remove(current)
                mark('UAT-ZB-03',{'variants':['I0','I1','I2','I3'],'stages':3,'sessionsPerStage':2})
                draft=fresh('draft','I4')
                for status in ['invalid-business-fields','valid-draft']:
                    if status=='valid-draft':draft.write('config/caliber-bindings/draft.yaml',json.dumps(draft.binding('draft')))
                    draft.hidden('r04-'+status);draft.publish('r04-'+status);draft.hidden('r04-'+status+'-after')
                draft.close();rigs.remove(draft);mark('UAT-ZB-04')
                # Fixed real 60-call limit, no budget bypass or threshold changes.
                session='r05-budget';rig.query('r05-first',session=session);before=rig.snapshot(session)
                for i in range(3):rig.call('r05-forced-'+str(i),'lucy_begin_question',{},session=session)
                rig.call('r05-reconnect',method='initialize',session=session)
                after=rig.snapshot(session);require(before['calls']==after['calls'] and before['round']==after['round'] and before['window_id']==after['window_id'],'forced/reconnect reset budget')
                for i in range(59):rig.query('r05-fill-'+str(i),session=session,save=False)
                stopped=rig.call('r05-stopped','lucy_query',{'connectionId':CONN,'measures':[SOURCE+'.order_count']},session=session)
                stop=inner(stopped);require(stop.get('reason')=='question_budget_exhausted' and stop.get('continuable') is True,'budget/continue not reachable '+repr(stop))
                cont=rig.call('r05-continue','lucy_continue_question',{'token':stop['continueToken']},session=session);require(successful(cont),'continue failed')
                rig.query('r05-after-continue',session=session);require(rig.snapshot(session)['continuations']==1,'continuation credit incorrect');mark('UAT-ZB-05')
            rig.hidden('r06-north',who='b',session='r06-b')
            unauthorized=rig.call('r06-c-forced','lucy_begin_question',{},who='c');require(not successful(unauthorized),'ungranted begin allowed');rig.query('r06-c-query',who='c')
            rig.api('r06-revoke','/api/admin/agents/uat_zb_revoked/tokens/isolated-revoked',method='DELETE')
            for who in ['expired','revoked','disabled']:
                for tool in ['lucy_begin_question','lucy_query']:
                    r=rig.call('r06-'+who+'-'+tool,tool,{'connectionId':CONN,'measures':[SOURCE+'.order_count']},who=who);require(not successful(r),who+' unexpectedly allowed')
            # Global deny is an isolated authoring control, not a product ACL change.
            rig.access['defaults']['deny_tools']+=['lucy_begin_question','lucy_query'];rig.write('webui/config/access.yaml',json.dumps(rig.access));rig.activate_authoring('r06-deny-activate')
            for tool in ['lucy_begin_question','lucy_query']:
                r=rig.call('r06-denied-'+tool,tool,{'connectionId':CONN,'measures':[SOURCE+'.order_count']},who='denied');require(not successful(r) and 'tool_forbidden_global' in json.dumps(r),'global deny not enforced before D2')
            rig.access['defaults']['deny_tools']=[x for x in rig.access['defaults']['deny_tools'] if x not in ['lucy_begin_question','lucy_query']]
            # Keep revoked token absent when restoring the isolated authoring control.
            rig.access['users']=[u for u in rig.access['users'] if u['id']!='uat_zb_revoked']
            for u in rig.access['users']:
                if u['id']=='uat_zb_disabled':u['enabled']=True
            rig.write('webui/config/access.yaml',json.dumps(rig.access));rig.activate_authoring('r06-deny-restore');rig.query('r06-deny-recovered',who='denied');rig.query('r06-disabled-recovered',who='disabled')
            rig.query('r06-g3-before',session='g3');g3_before=rig.snapshot('g3')
            rig.exec_sqlite("CREATE TRIGGER uat_budget_insert BEFORE INSERT ON question_budget_state BEGIN SELECT RAISE(FAIL,'uat budget storage unavailable'); END; CREATE TRIGGER uat_budget_update BEFORE UPDATE ON question_budget_state BEGIN SELECT RAISE(FAIL,'uat budget storage unavailable'); END;")
            failed=rig.call('r06-g3-failed','lucy_query',{'connectionId':CONN,'measures':[SOURCE+'.order_count']},session='g3');require('question_budget_unavailable' in json.dumps(failed),'budget store fault swallowed')
            forced=rig.call('r06-g3-forced','lucy_begin_question',{},session='g3');require(forced['body'].get('result',{}).get('data',{}).get('reason')=='begin_not_available','G3 changed D2')
            rig.exec_sqlite('DROP TRIGGER uat_budget_insert; DROP TRIGGER uat_budget_update;');rig.query('r06-g3-recovered',session='g3')
            g3_after=rig.snapshot('g3');require(g3_after['calls']==g3_before['calls']+1 and g3_after['round']==g3_before['round'] and g3_after['window_id']==g3_before['window_id'],'budget recovery reset old state')
            rig.save('r06-g3-state',{'before':g3_before,'after':g3_after});mark('UAT-ZB-06')
            # Formal active/revocation control uses authoring YAML + actual HTTP reindex.
            rig.write('config/caliber-bindings/bound.yaml',json.dumps(rig.binding()));rig.reindex('r07-enable')
            begun=rig.call('r07-begin','lucy_begin_question',{'intentSummary':'固定订单数','caliberBindingId':'uat_zero'},session='r07-old');require(successful(begun),'active begin failed '+json.dumps(begun)[:1200])
            rig.query('r07-allow',session='r07-old',bound=True)
            denied=rig.call('r07-deviation','lucy_query',{'connectionId':CONN,'measures':[SOURCE+'.amount_sum']},session='r07-old');require('caliber_binding_violation' in json.dumps(denied),'bound deviation allowed')
            rig.write('config/caliber-bindings/bound.yaml',json.dumps(rig.binding('draft')));rig.reindex('r07-revoke')
            rig.hidden('r07-new',session='r07-new');rig.query('r07-old-allow',session='r07-old',bound=True)
            denied=rig.call('r07-old-deviation','lucy_query',{'connectionId':CONN,'measures':[SOURCE+'.amount_sum']},session='r07-old');require('caliber_binding_violation' in json.dumps(denied),'old bound snapshot lost');mark('UAT-ZB-07')
            # Actual persisted audit and independently reconciled synthetic requests.
            for i in range(5):rig.query('r08-'+str(i),session='r08-'+str(i))
            rig.call('r08-forced','lucy_begin_question',{},session='r08-forced');rig.query('r08-after-forced',session='r08-forced');time.sleep(.4)
            rows=rig.audit("SELECT request_id,trace_id,user_id,tool,outcome,error_detail,lucy_session_id,COALESCE(effective_attribution_mode,turn_attribution_mode,'unassigned') AS attribution_mode,effective_turn_id,lucy_turn_id FROM access_log WHERE lucy_session_id LIKE 'r08-%' ORDER BY id")
            queries=[r for r in rows if r['tool']=='lucy_query'];begin=[r for r in rows if r['tool']=='lucy_begin_question']
            require(len(queries)==6 and all(r['outcome']=='ok' for r in queries),'audit query denominator wrong')
            require(len(begin)==1 and begin[0]['error_detail']=='begin_not_available' and begin[0]['trace_id'],'audit denied trace missing')
            turns=rig.audit("SELECT COUNT(*) AS n FROM conversation_turns WHERE question_source='reported_tool'");require(turns[0]['n']==1,'hidden begin reported a turn (only the real active R07 turn is expected)')
            attribution={mode:sum(row['attribution_mode']==mode for row in queries) for mode in ['explicit','session_bound','identity_inferred','unassigned']}
            require(sum(attribution.values())==6,'unknown attribution mode omitted from denominator')
            require(attribution['explicit']==0,'hidden questions falsely reported as explicit')
            rig.save('r08-reconciliation',{'queries':queries,'attributionCounts':attribution,'forcedBegin':begin,'explicitReportedFromHidden':0,'actualQueries':6,'successes':6,'operatorTask':'located D2 by session/request/trace and verified subsequent query outcome; version in artifact','managementTask':'six queries/six successes; hidden original question reports zero; active R07 report excluded'})
            mark('UAT-ZB-08')
            for tool,a in [('lucy_read_source',{'connectionId':CONN,'sourceName':SOURCE}),('lucy_explain_query',{'connectionId':CONN,'measures':[SOURCE+'.order_count']})]:
                require(successful(rig.call('r09-'+tool,tool,a)),'other tool regression '+tool)
            # Unknown content must never be certified empty.
            rig.write('config/caliber-bindings/unreadable.yaml','status: [broken')
            forced=rig.call('r09-unknown-forced','lucy_begin_question',{'intentSummary':'固定订单数'});require('caliber_binding_unresolved' in json.dumps(forced),'unknown incorrectly D2')
            rig.remove('config/caliber-bindings/unreadable.yaml');rig.hidden('r09-recovered')
            bad_source=rig.call('r09-ungranted-read','lucy_read_source',{'connectionId':CONN,'sourceName':'invisible_source'})
            require(not successful(bad_source),'read_source exposed ungranted source')
            # A source-map fault on unrelated authoring metadata must not drive inactive begin.
            collision={'tables':{'unused_collision':{'table':'unused_one.t'}}}
            rig.write('config/semantic-layer/'+CONN+'/_schema/unused_one.yaml',json.dumps(collision))
            collision['tables']['unused_collision']['table']='unused_two.t'
            rig.write('config/semantic-layer/'+CONN+'/_schema/unused_two.yaml',json.dumps(collision))
            # Prove the authoring source map really fails; serving ACL remains its last committed healthy snapshot.
            compiler=run(['docker','exec',rig.app,'/app/webui/node_modules/.bin/tsx','-e',"(async()=>{const a=await import('/app/webui/server/proxy/acl.ts');try{await a.loadSourceMapSnapshot({fresh:true});console.log(JSON.stringify({error:await a.currentSourceMapCompileError()}));}catch(e){console.log(JSON.stringify({error:String(e)}));}})()"])
            rig.save('r09-real-compiler-failure',compiler)
            require('duplicate_source_name' in compiler,'source-map fault not actually reproduced')
            forced=rig.call('r09-source-map-forced','lucy_begin_question',{},session='r09-source-map')
            require(forced['body'].get('result',{}).get('data',{}).get('reason')=='begin_not_available','source-map compilation changed local inactive D2')
            baseline_failure=rig.call('r09-source-map-query','lucy_query',{'connectionId':CONN,'measures':[SOURCE+'.order_count']},session='r09-source-map')
            rig.save('r09-source-map-separation',{'begin':forced,'queryBaseline':baseline_failure,'compiler':compiler,'servingPolicy':'last committed healthy ACL; authoring compiler failure proven in separate production process'})
            # Existing source-map ACL denial has priority over D2. Activate the fault and prove both tools deny.
            rig.activate_authoring('r09-fault-activate',must_ack=False)
            for tool in ['lucy_begin_question','lucy_query']:
                denied=rig.call('r09-serving-fault-'+tool,tool,{'connectionId':CONN,'measures':[SOURCE+'.order_count']},session='r09-serving-fault')
                require(not successful(denied) and 'source_map_compile_failed' in json.dumps(denied),'existing ACL compile denial bypassed '+tool)
            rig.remove('config/semantic-layer/'+CONN+'/_schema/unused_one.yaml');rig.remove('config/semantic-layer/'+CONN+'/_schema/unused_two.yaml');rig.activate_authoring('r09-fault-restore');rig.hidden('r09-source-map-recovered')
            mark('UAT-ZB-09')
            if not args.baseline_image:raise RuntimeError('baseline image required for full performance UAT')
            baseline=fresh('baseline',image=args.baseline_image)
            perf_candidate=fresh('performance-candidate')
            perf={'frozenAt':now(),'absoluteToleranceMs':250,'relativeTolerance':.5,'seed':60120,'warmups':10,'samplesPerRound':100,'rounds':[],'scope':'protocol N catalog/read_source/query, independently fresh I0 rigs in both groups (no fault injection history); real Agent separately in R12'}
            rig.save('r10-pre-sampling-contract',perf)
            rng=random.Random(60120)
            def sample(current,name):
                start=time.monotonic();session=name
                require(successful(current.call(name+'-catalog','lucy_catalog',{},session=session,save=False)),'perf catalog failed')
                source=current.call(name+'-source','lucy_read_source',{'connectionId':CONN,'sourceName':SOURCE},session=session,save=False)
                if not successful(source):current.save(name+'-failed-source',source)
                require(successful(source),'perf source failed: '+json.dumps(source,ensure_ascii=False)[:1200])
                current.query(name+'-query',session=session,save=False)
                return round((time.monotonic()-start)*1000,3)
            for round_id in range(3):
                for current in [baseline,perf_candidate]:
                    for i in range(10):sample(current,'r10-warm-'+str(round_id)+'-'+str(i))
                samples={'baseline':[],'candidate':[]}
                perf['currentRound']={'round':round_id+1,'samples':samples}
                for i in range(100):
                    pair=[('baseline',baseline),('candidate',perf_candidate)];rng.shuffle(pair)
                    for label,current in pair:
                        samples[label].append(sample(current,'r10-'+str(round_id)+'-'+str(i)))
                        rig.save('r10-partial-samples',perf)
                base95=sorted(samples['baseline'])[94];cand95=sorted(samples['candidate'])[94]
                perf['rounds'].append({'round':round_id+1,'baselineP95Ms':base95,'candidateP95Ms':cand95,'samples':samples})
                rig.save('r10-performance',perf)
                require(cand95<=base95+250 and cand95<=base95*1.5,'N p95 regression against frozen tolerance')
            baseline.close();rigs.remove(baseline);perf_candidate.close();rigs.remove(perf_candidate);mark('UAT-ZB-10',{'rounds':[{k:v for k,v in r.items() if k!='samples'} for r in perf['rounds']]})
            # Real stop/start for all compatibility representations, not a smoke repair.
            for variant in ['I0','I1','I2','I3','I4','L0','L1','U0']:
                current=fresh('restart-'+variant.lower(),variant)
                current.restart()
                if variant not in ['L1','U0']:current.hidden('r11-'+variant,session='legacy' if variant=='L0' else 'r11-'+variant)
                else:
                    active_session='r11-'+variant+'-fresh-active'
                    exposed=current.call(active_session+'-tools',method='tools/list',session=active_session)
                    require('lucy_begin_question' in [tool['name'] for tool in exposed['body'].get('result',{}).get('tools',[])],'healthy active scope failed to recover')
                    begun=current.call(active_session+'-begin','lucy_begin_question',{'intentSummary':'固定订单数','caliberBindingId':'uat_zero'},session=active_session)
                    require(successful(begun),'active begin failed after restart')
                    current.query(active_session+'-query',session=active_session,bound=True)
                    deviation=current.call(active_session+'-deviation','lucy_query',{'connectionId':CONN,'measures':[SOURCE+'.amount_sum']},session=active_session)
                    require('caliber_binding_violation' in json.dumps(deviation),'active bound deviation allowed after restart')
                    r=current.call('r11-'+variant+'-denied','lucy_query',{'connectionId':CONN,'measures':[SOURCE+'.order_count']},session='legacy');require('caliber_binding_unresolved' in json.dumps(r),'strong unknown released')
                    unknown_tools=current.call('r11-'+variant+'-tools',method='tools/list',session='legacy');require('lucy_begin_question' not in [t['name'] for t in unknown_tools['body'].get('result',{}).get('tools',[])],'uncertain strong scope advertised begin')
                    forced=current.call('r11-'+variant+'-forced','lucy_begin_question',{},session='legacy');require('caliber_binding_unresolved' in json.dumps(forced),'unknown scope incorrectly entered D2 or active')
                    current.rollback_failed_legacy_begin();current.query('r11-'+variant+'-recovered',session='legacy',bound=True)
                    deviated=current.call('r11-'+variant+'-recovered-deviation','lucy_query',{'connectionId':CONN,'measures':[SOURCE+'.amount_sum']},session='legacy');require('caliber_binding_violation' in json.dumps(deviated),'recovery discarded bound restrictions')
                current.close();rigs.remove(current)
            rig.restart();rig.hidden('r11-t0-new',session='r11-new');rig.query('r11-t0-old',session='r07-old',bound=True)
            r=rig.call('r11-t0-deviation','lucy_query',{'connectionId':CONN,'measures':[SOURCE+'.amount_sum']},session='r07-old');require('caliber_binding_violation' in json.dumps(r),'T0 old snapshot lost after restart');mark('UAT-ZB-11')
            if args.skip_agent:raise RuntimeError('RC1 deliberately not executed; full PASS forbidden')
            cli=pathlib.Path('/opt/homebrew/Caskroom/codex/0.165.0/bin/codex')
            require(cli.is_file() and hashlib.sha256(cli.read_bytes()).hexdigest()=='a45099154d7fb4a5ed8a56f40966a95deb938e508bab23e6985035c709e9a85a','RC1 pinned client unavailable')
            client_dir=rig.private/'client';client_dir.mkdir()
            config=pathlib.Path.home()/'.codex/config.toml';names=[]
            if config.is_file():names=re.findall(r'^\[mcp_servers\.([^].]+)\]',config.read_text(),re.M)
            cmd=[str(cli),'exec','--json','--skip-git-repo-check','-C',str(client_dir),'-s','read-only']
            for name in names:cmd+=['-c','mcp_servers.'+name+'.enabled=false']
            cmd+=['-c','mcp_servers.zb_uat.url='+json.dumps(rig.mcp+'/mcp'),'-c','mcp_servers.zb_uat.bearer_token_env_var="ZB_UAT_TOKEN"','--output-last-message',str(client_dir/'answer.txt'),'仅使用 zb_uat MCP 查询测试订单数和总金额。先确认可见 source，必须真实查数；不要使用 shell、文件或其他服务。遵守可见工具，不尝试隐藏工具；若收到 begin_not_available，直接继续查询。最终仅输出 JSON：{"order_count":实际值,"amount_sum":实际值}。']
            env=dict(os.environ);env['ZB_UAT_TOKEN']=rig.tokens['a']
            last_audit=rig.audit('SELECT COALESCE(MAX(id),0) AS id FROM access_log')[0]['id']
            actual=subprocess.run(cmd,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
            rig.save('r12-client-trace',actual.stdout);rig.save('r12-client-stderr',actual.stderr)
            require(actual.returncode==0,'RC1 execution failed '+scrub(actual.stderr[-1000:]))
            answer=(client_dir/'answer.txt').read_text();rig.save('r12-final-answer',answer)
            parsed=json.loads(answer.strip().removeprefix('```json').removesuffix('```').strip());require(float(parsed['order_count'])==4 and float(parsed['amount_sum'])==100,'RC1 final fact mismatch')
            events=[json.loads(line) for line in actual.stdout.splitlines() if line.startswith('{')]
            calls=[event.get('item',{}) for event in events if event.get('type')=='item.completed' and event.get('item',{}).get('type')=='mcp_tool_call']
            actual_queries=[item for item in calls if item.get('server')=='zb_uat' and item.get('tool')=='lucy_query' and not item.get('error')]
            require(actual_queries,'RC1 lacks a completed real MCP query event')
            require(not any(event.get('item',{}).get('type')=='command_execution' for event in events),'RC1 used shell instead of pure MCP')
            persisted=rig.audit('SELECT id,tool,outcome,response_row_count,trace_id,lucy_session_id FROM access_log WHERE id>'+str(last_audit)+" AND user_id='uat_zb_a' ORDER BY id")
            require(any(row['tool']=='lucy_query' and row['outcome']=='ok' and row['response_row_count']==1 for row in persisted),'RC1 query has no matching persisted actual result')
            begin_calls=[row for row in persisted if row['tool']=='lucy_begin_question']
            require(len(begin_calls)<=1,'RC1 retried the hidden begin repeatedly')
            rig.save('r12-persisted-proof',{'events':calls,'audit':persisted,'clientVersion':run([str(cli),'--version'])})
            mark('UAT-ZB-12',{'client':'Codex CLI 0.165.0','actualAnswer':parsed,'hiddenBeginCallObserved':bool(begin_calls)})
            require(args.qualify_late or all(summary['cases'][cid]['status']=='PASS' for cid in expected),'incomplete required matrix')
            summary['status']='QUALIFICATION_PARTIAL' if args.qualify_late else 'PASS'
    except Exception as e:
        summary['status']='FAIL';summary['error']=scrub(str(e));print(scrub(str(e)),flush=True)
        pending=[cid for cid in expected if not (args.qualify_late and cid in ['UAT-ZB-03','UAT-ZB-04','UAT-ZB-05'])]
        first=next((cid for cid in pending if summary['cases'][cid]['status']=='NOT RUN'),None)
        if first:summary['cases'][first]={'status':'FAIL','reason':scrub(str(e))}
        for failed_rig in rigs:
            if 'app' in failed_rig.created:
                failed_rig.save('failure-container-log',run(['docker','logs','--tail','120',failed_rig.app],check=False))
                try:failed_rig.save('failure-budget-state',failed_rig.audit('SELECT * FROM question_budget_state ORDER BY updated_at DESC LIMIT 10'))
                except Exception as capture_error:failed_rig.save('failure-budget-capture',str(capture_error))
    finally:
        for current in reversed(rigs):
            try:current.close()
            except Exception as e:summary.setdefault('cleanupErrors',[]).append(scrub(str(e)))
        if summary.get('cleanupErrors'):summary['status']='FAIL'
        summary['finishedAt']=now();save_summary()
    print(json.dumps({'status':summary['status'],'cases':summary['cases'],'out':str(out)},ensure_ascii=False),flush=True)
    return 0 if summary['status'] in ['PASS','SMOKE_PASS','QUALIFICATION_PARTIAL'] else 1

if __name__=='__main__':raise SystemExit(main())
