#!/usr/bin/env python3
"""Independent fixed-fixture evidence verifier. No producer imports or credentials."""
import argparse,collections,datetime,decimal,gzip,hashlib,json,os,pathlib,re,sqlite3,tempfile,time,sys
IMAGE='sha256:ae0eb26a73d9331f45e4276f9839c442f9c8ada0ff2701366c7c2b099b8f7a4f'
SOURCE='uat_begin_zero_orders';CONN='uat-mysql'
CASES={'normal':'r6-revision7/normal','deadline':'r6-revision7/deadline','revoke':'r6-revision8/revoke','failure':'r6-revision10/failure','term':'r6-revision11/term'}
LOG_SQL="SELECT JSON_OBJECT('eventTime',CAST(event_time AS CHAR),'threadId',thread_id,'commandType',command_type,'sql',CONVERT(argument USING utf8mb4)) FROM mysql.general_log ORDER BY event_time,thread_id"
def need(ok,message):
 if not ok:raise AssertionError(message)
def read(p):return json.loads(p.read_text())
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for part in iter(lambda:f.read(1048576),b''):h.update(part)
 return h.hexdigest()
def stamp(s):return datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000
def payload(r):
 result=r.get('body',{}).get('result',{})
 if isinstance(result.get('structuredContent'),dict):return result['structuredContent']
 texts=[x['text'] for x in result.get('content',[]) if x.get('type')=='text']
 return json.loads(texts[0]) if len(texts)==1 else {}
def good(r):
 body=r.get('body',{});result=body.get('result',{})
 return r.get('httpStatus')==200 and isinstance(result,dict) and bool(result) and not result.get('isError') and not body.get('error')
def sqltext(s):return s.strip().removesuffix(';').strip() if hasattr(str,'removesuffix') and isinstance(s,str) else s.strip().rstrip(';').strip() if isinstance(s,str) else None
def original_rpcs(run,case):
 es=[json.loads(x) for x in (run/'events.jsonl').read_text().splitlines() if x.strip()]
 starts=[x for x in es if x['kind']=='original-rpc-dispatched'];ends=[x for x in es if x['kind']=='original-rpc-terminal']
 need(len(starts)==(3 if case=='normal' else 2),'unexpected original request denominator')
 need(len({x['rpcId'] for x in starts})==len(starts)==len(ends),'missing/duplicate/transport original request terminal')
 result=[]
 for s in starts:
  matched=[x for x in ends if x['rpcId']==s['rpcId']];need(len(matched)==1,'nonunique original receipt');t=matched[0];r=t['receipt']
  need(t['tool']==s['tool'] and t['session']==s['session'] and t['who']==s['identity'],'original identity/session/tool changed')
  need(r['rpcId']==s['rpcId'] and r['body'].get('id') in [None,s['rpcId']],'original RPC mismatch')
  op=r.get('correlationHeaders',{}).get('x-lucy-operation-id');need(isinstance(op,str) and op.startswith('mcp_'),'missing actual HTTP server operation')
  ok=good(r);expected_ok=case=='normal' or s is not starts[0]
  need(ok==expected_ok,'canonical original success/failure denominator changed')
  d=payload(r)
  if ok and s['tool']=='lucy_query':
   need(d.get('headers')==['order_count','amount_sum'] and len(d.get('rows',[]))==1 and len(d['rows'][0])==2,'query schema mismatch')
   expected=[2,30] if s['identity']=='b' else [4,100]
   need([decimal.Decimal(str(x)) for x in d['rows'][0]]==[decimal.Decimal(x) for x in expected],'count/sum oracle incorrect')
   need(d.get('connectionId')==CONN and isinstance(d.get('sql'),str),'query connection/compiled SQL absent')
  elif ok and s['tool']=='lucy_read_source':
   need(d.get('sourceName')==SOURCE and 'table: uat.'+SOURCE in d.get('yaml','') and 'count(distinct order_id)' in d['yaml'] and 'sum(amount)' in d['yaml'],'source metadata oracle incorrect')
  elif ok and s['tool']=='lucy_explain_query':
   need(d.get('allowed') is True and d.get('executionMode')=='plan_only' and d.get('executed') is False and d.get('aggregateResults') is None and d.get('requestedSources')==[{'connectionId':CONN,'sourceName':SOURCE,'physicalTable':'uat.'+SOURCE}],'explain oracle incorrect')
  elif not ok:
   if case in ['deadline','failure']:need(r['httpStatus']==200 and r['body']['result'].get('isError') is True and d.get('code')=='semantic_recovery_required','noncanonical semantic rejection')
   elif case=='revoke':need(r['httpStatus']==403 and r['body'].get('error',{}).get('code')==-32003 and r['body']['error'].get('message')=='Access denied: authorization_revoked','noncanonical revocation')
   elif case=='term':need(r['httpStatus']==503 and r['body'].get('ok') is False and r['body'].get('error',{}).get('code')=='SERVICE_DRAINING','noncanonical TERM')
  result.append({'rpcId':s['rpcId'],'user':'uat_zb_'+s['identity'],'who':s['identity'],'session':s['session'],'tool':s['tool'],'success':ok,'op':op,'receipt':r,'compiledSql':d.get('sql') if ok and s['tool']=='lucy_query' else None,'dispatchAt':s['at'],'terminalAt':t['at']})
 return result

def owners(run,rpcs,case):
 events=[]
 for line in (run/'final-container-log.txt').read_text().splitlines():
  if '[lucy-semantic-write]' in line:
   prefix,raw=line.split(' [lucy-semantic-write] ',1);need(bool(re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{1,9}Z',prefix)),'bad original log prefix');events.append(json.loads(raw))
 output=[]
 for r in (rpcs if case=='normal' else rpcs[:1]):
  begin=[x for x in events if x['event']=='read_wait_begin' and x.get('ingressOperationId')==r['op']];end=[x for x in events if x['event']=='read_wait_end' and x.get('ingressOperationId')==r['op']]
  need(len(begin)==len(end)==1,'missing/duplicate exact original wait');b,e=begin[0],end[0]
  for field in ['rpcId','owners','ingressMonoMs','fixedInitialWaitDeadlineMonoMs','waitDeadlineMonoMs']:need(b[field]==e[field],'owner/RPC/deadline changed')
  need(b['rpcId']==r['rpcId'] and b['fixedInitialWaitDeadlineMonoMs']==b['ingressMonoMs']+20000 and b['waitDeadlineMonoMs']<=b['fixedInitialWaitDeadlineMonoMs'],'trusted original ingress20 binding invalid')
  need(b['ingressMonoMs']<=b['monoMs']<=e['monoMs'],'reversed reader time')
  for owner in b['owners']:
   relevant=[x for x in events if all(x.get(k)==v for k,v in owner.items())]
   reg=[x for x in relevant if x['event']=='registered'];stage=[x for x in relevant if x['event'] in ['files_saved','failed']]
   need(len(reg)==len(stage)==1 and reg[0]['monoMs']<=b['monoMs'],'owner registration/real stage incomplete')
   if case=='normal':need(stage[0]['event']=='files_saved' and stage[0]['monoMs']<=e['monoMs']<e['waitDeadlineMonoMs'] and e['endOutcome']=='owner_settled','normal stage false/late')
   elif case=='deadline':need(e['endOutcome']=='timeout' and e['monoMs']>=e['waitDeadlineMonoMs'] and stage[0]['event']=='failed' and stage[0]['monoMs']>e['monoMs'],'deadline retired writer early')
   else:need(stage[0]['event']=='failed' and e['endOutcome'] in ({'revoke':['cancelled','authorization_revoked'],'failure':['blocked'],'term':['term']}[case]),'negative stage/terminal mismatch')
  output.append({'rpcId':r['rpcId'],'begin':b,'end':e})
 return output

def wire_matches(wire,compiled):
 w,c=sqltext(wire),sqltext(compiled)
 return ';' not in w and ';' not in c and (w==c or w=='select * from ('+c+') as ktx_query_result limit 100')
def classify_raw(rows,compiled):
 business=[];ignored=[]
 for row in rows:
  kind=row.get('commandType');sql=row.get('sql')
  if kind in ['Connect','Quit','Init DB','Ping','Close stmt','Reset stmt','Prepare']:ignored.append({'kind':kind});continue
  need(kind in ['Query','Execute'] and isinstance(sql,str),'unsupported actual MySQL log command')
  if sql in [LOG_SQL,'select @@version_comment limit 1','SET SESSION max_execution_time = 30000','TRUNCATE TABLE mysql.general_log']:
   ignored.append({'kind':kind,'knownMetadata':sql});continue
  matches=[x for x in compiled if wire_matches(sql,x)]
  need(len(matches)==1,'unsupported/wrong business SQL (never counted as SQL0): '+sql[:120]);business.append(row)
 return {'business':business,'ignored':ignored}
def raw_sql(run,rpcs,case):
 compiled=[r['compiledSql'] for r in rpcs if r['compiledSql']]
 output=[]
 if case=='normal':
  for r in rpcs:
   before=read(run/'candidate'/('normal-lease-before-'+r['tool']+'.json'));after=read(run/'candidate'/('normal-lease-after-'+r['tool']+'.json'))
   key=lambda x:json.dumps(x,sort_keys=True);left=collections.Counter(map(key,before));right=collections.Counter(map(key,after));need(not left-right,'raw log lost original rows')
   delta=[json.loads(k) for k,n in (right-left).items() for _ in range(n)];found=classify_raw(delta,compiled)
   need(len(found['business'])==(1 if r['tool']=='lucy_query' else 0),'normal independent SQL1/0/0 mismatch');output.append({'tool':r['tool'],'rpcId':r['rpcId'],**found})
 else:
  found=classify_raw(read(run/'candidate/all-business-sql.json'),compiled);need(len(found['business'])==1,'negative original SQL0 + explicit recovery SQL1 not proven');output.append(found)
 return output

def full_audit(c):
 rows=c.execute('SELECT id,user_id,ts FROM access_log ORDER BY id').fetchall();need(rows,'empty task audit')
 result={'allRows':len(rows),'maxId':rows[-1]['id'],'firstId':rows[0]['id'],'eligibleNonemptyUserRows':0,'missing':0,'duplicates':0,'wrongUser':0,'watermarks':[]}
 for a in rows:
  if not a['user_id'] or not a['user_id'].strip():continue
  result['eligibleNonemptyUserRows']+=1
  links=c.execute('SELECT t.user_id,l.inferred_turn_id FROM inferred_turn_access_logs l LEFT JOIN inferred_turns t ON t.inferred_turn_id=l.inferred_turn_id WHERE l.access_log_id=?',(a['id'],)).fetchall()
  result['missing']+=not links;result['duplicates']+=max(0,len(links)-1);result['wrongUser']+=sum(x['user_id']!=a['user_id'] for x in links)
 result['orphanRaw']=c.execute('SELECT COUNT(*) FROM inferred_turn_access_logs l LEFT JOIN access_log a ON a.id=l.access_log_id WHERE a.id IS NULL').fetchone()[0]
 result['orphanTurn']=c.execute('SELECT COUNT(*) FROM inferred_turn_access_logs l LEFT JOIN inferred_turns t ON t.inferred_turn_id=l.inferred_turn_id WHERE t.inferred_turn_id IS NULL').fetchone()[0]
 for a in c.execute("SELECT user_id,MAX(id) newest FROM access_log WHERE user_id IS NOT NULL AND TRIM(user_id)<>'' GROUP BY user_id"):
  state=c.execute('SELECT status,watermark FROM inferred_rebuild_state WHERE user_id=?',(a['user_id'],)).fetchone();watermark=str(state['watermark']) if state else ''
  valid=bool(state and state['status']=='complete' and watermark.isascii() and watermark.isdigit() and int(watermark)>=a['newest'])
  result['watermarks'].append({'user':a['user_id'],'newest':a['newest'],'status':state['status'] if state else None,'watermark':watermark,'valid':valid})
 need(not any(result[k] for k in ['missing','duplicates','wrongUser','orphanRaw','orphanTurn']) and all(x['valid'] for x in result['watermarks']),'full DB audit/links/watermark incomplete')
 return result

def budgets(c,rpcs,initial):
 groups=collections.defaultdict(list)
 for r in rpcs:groups[(r['user'],r['session'],r['tool'])].append(r)
 result=[]
 for (user,session,tool),calls in groups.items():
  rows=c.execute('SELECT * FROM access_log WHERE user_id=? AND lucy_session_id=? AND tool=?',(user,session,tool)).fetchall()
  need(len(rows)==len(calls) and sorted(str(x['request_id']) for x in rows)==sorted(str(r['rpcId']) for r in calls),'nonunique/missing original RPC audit rows')
  prefixes={x['token_hash_prefix'] for x in rows};need(len(prefixes)==1,'identity prefix changed across original RPCs');prefix=next(iter(prefixes));need(bool(re.fullmatch(r'sha256:[a-f0-9]{12}',prefix or '')),'invalid stable audit prefix')
  scope='bq:'+user+'|'+prefix+':'+session;states=c.execute('SELECT * FROM question_budget_state WHERE scope_key=?',(scope,)).fetchall();need(len(states)==1,'missing/duplicate real budget scope');state=dict(states[0])
  need(state['calls']==state['attempts']==len(calls) and state['current_concurrency']==0,'original ticket double consumed/reset/inflight')
  need(state['round']==state['window_id']==0 and state['origin_started_at']==state['started_at'],'budget generation reset')
  need(stamp(calls[0]['dispatchAt'])<=state['started_at']<=stamp(calls[0]['terminalAt']),'budget started beyond original first request interval')
  initial_used=initial if initial and initial.get('scope_key')==scope else None
  if initial_used:
   need(all(initial_used[k]==state[k] for k in ['round','window_id','started_at','origin_started_at']),'original at-wait generation changed across explicit retry')
   need(initial_used['calls']==initial_used['attempts']==1 and initial_used['current_concurrency']==1,'initial direct at-wait snapshot not original one ticket')
  proof=[]
  for row in rows:
   r=next(x for x in calls if str(x['rpcId'])==str(row['request_id']));need((row['outcome']=='ok')==r['success'],'response and actual audit outcome disagree')
   if r['compiledSql']:need(sqltext(row['generated_sql'])==sqltext(r['compiledSql']) and row['query_operation']=='select','actual query audit execution mismatch')
   else:
    need(not row['generated_sql'] and row['query_operation']!='select','denied/metadata/explain executed SQL')
    if r['tool'] in ['lucy_read_source','lucy_explain_query']:need(row['query_operation'] is None,'metadata/explain execution operation must be null')
   links=c.execute('SELECT l.inferred_turn_id,t.user_id FROM inferred_turn_access_logs l LEFT JOIN inferred_turns t ON t.inferred_turn_id=l.inferred_turn_id WHERE l.access_log_id=?',(row['id'],)).fetchall();need(len(links)==1 and links[0]['user_id']==user,'RPC not exactly effectively linked to same user')
   proof.append({'auditId':row['id'],'rpcId':row['request_id'],'outcome':row['outcome'],'generatedSql':row['generated_sql'],'queryOperation':row['query_operation'],'turnId':links[0]['inferred_turn_id'],'operationId':r['op']})
  result.append({'scopeKey':scope,'identityEvidence':'raw dispatch staticwho + HTTP operation/RPC + actual audit user/session/tool + unique stable audit prefix; no raw Token read','state':state,'directAtWaitSnapshotUsed':bool(initial_used),'rpcs':proof})
 return result

def verify(run,case,seconds):
 start=time.monotonic();rpcs=original_rpcs(run,case);inv=read(run/'actual-invocation.json');need(inv.get('exitCode')==0 and IMAGE in inv['argv'],'not successful same actual AE0 invocation')
 result={'case':case,'run':str(run),'actualExitCode':inv['exitCode'],'requestDenominator':len(rpcs),'originalSuccesses':sum(r['success'] for r in rpcs),'originalFailures':sum(not r['success'] for r in rpcs),'ownerClosures':owners(run,rpcs,case),'rawMysql':raw_sql(run,rpcs,case)}
 m=read(run/'audit-evidence.json');archive=run/'audit-evidence.sqlite.gz'
 need(m.get('source')=='SQLite backup API from task-owned live DB; closed copy','not identified task closed backup')
 need(archive.stat().st_size==m['gzipBytes'] and sha(archive)==m['gzipSha256'],'compressed audit size/hash mismatch')
 temporary=None
 try:
  with tempfile.TemporaryDirectory(prefix='lucy-p170-independent-') as folder:
   temporary=pathlib.Path(folder);db=temporary/'verified-closed.sqlite';h=hashlib.sha256();total=0
   with gzip.open(archive,'rb') as src,db.open('xb') as dst:
    os.chmod(db,0o600)
    for block in iter(lambda:src.read(1048576),b''):
     total+=len(block);need(total<=m['sqliteBytes'] and time.monotonic()-start<seconds,'decode size/deadline overflow');h.update(block);dst.write(block)
   need(total==m['sqliteBytes'] and h.hexdigest()==m['sqliteSha256'],'decoded SQLite size/hash mismatch')
   result['backupVerification']={'gzipBytes':m['gzipBytes'],'gzipSha256':m['gzipSha256'],'sqliteBytes':total,'sqliteSha256':h.hexdigest(),'mode':'verified closed backup only; ro&immutable=1'}
   c=sqlite3.connect(db.resolve().as_uri()+'?mode=ro&immutable=1',uri=True);c.row_factory=sqlite3.Row;c.set_progress_handler(lambda:int(time.monotonic()-start>=seconds),1000)
   try:
    result['fullDatabase']=full_audit(c)
    # Only the original direct numeric observation; never consume producer
    # independentBudgetAudit, closure checks, status, or classifier verdicts.
    initial=read(run/'summary.json').get('originalBudgetAtWait')
    result['budgetsAndRpcAudit']=budgets(c,rpcs,initial)
   finally:c.close()
   need(sorted(x.name for x in temporary.iterdir())==['verified-closed.sqlite'],'unexpected readonly sidecar mutation')
 finally:
  result['decodedTemporaryDeleted']=temporary is not None and not temporary.exists()
  failure=sys.exc_info()[1]
  if failure is not None:failure.independent_partial=result
 need(result['decodedTemporaryDeleted'],'decoded temporary not removed');result['status']='INDEPENDENT SCOPED VALID';result['elapsedSeconds']=time.monotonic()-start;return result

def main():
 p=argparse.ArgumentParser();p.add_argument('--base',required=True);p.add_argument('--out',required=True);p.add_argument('--seconds-per-case',type=float,default=30);a=p.parse_args();out=pathlib.Path(a.out);need(not out.exists(),'fresh output required');out.mkdir(parents=True)
 result={'sourceSha256':sha(pathlib.Path(__file__)),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cases':[],'scope':'five selected actual P170 branches; no complete publishing audit/mode/successor-owner matrix, no UAT/release, no reinterpretation of old formal strictFAIL; credential evidence excludes raw Tokens'}
 for case,relative in CASES.items():
  try:item=verify(pathlib.Path(a.base)/relative,case,a.seconds_per_case)
  except Exception as error:item={'case':case,'status':'INDEPENDENT FAIL/UNRESOLVED','errorType':type(error).__name__,'error':str(error),'partial':getattr(error,'independent_partial',None)}
  result['cases'].append(item);(out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 result['status']='INDEPENDENT SCOPED VALID' if all(x['status']=='INDEPENDENT SCOPED VALID' for x in result['cases']) else 'INDEPENDENT FAIL/UNRESOLVED';result['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':result['status'],'cases':[{k:x.get(k) for k in ['case','status','error']} for x in result['cases']]},ensure_ascii=False));return 0 if result['status']=='INDEPENDENT SCOPED VALID' else 1
if __name__=='__main__':raise SystemExit(main())
