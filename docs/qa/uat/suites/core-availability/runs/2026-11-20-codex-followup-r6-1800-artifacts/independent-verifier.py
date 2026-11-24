#!/usr/bin/env python3
"""Independent CA-09 recount. Reads runner records and a hashed SQLite backup; never runs Docker."""
import argparse, collections, datetime, gzip, hashlib, json, math, pathlib, re, sqlite3, tempfile, time
from decimal import Decimal

PERIODS={'probe:/api/livez':1,'probe:/api/readyz':1,'probe:/api/health':1,'http':1,'mcp':5,'audit-progress':5}
KINDS={'request-planned':'planned','request-dispatched':'dispatched','request-missed':'missed','request-terminal':'terminal'}

def digest(path):
    h=hashlib.sha256()
    with pathlib.Path(path).open('rb') as f:
        for part in iter(lambda:f.read(1024*1024),b''):h.update(part)
    return h.hexdigest()

def formal_window_valid(seconds,cycle_seconds):
    # User amended the upcoming combination to30min/12cycles; historical hour runs remain intact.
    return seconds>=1800 and cycle_seconds>0 and math.ceil(seconds/cycle_seconds)>=12


def percentile(values,p):
    return sorted(values)[max(0,math.ceil(len(values)*p)-1)] if values else None

def reason(response):
    body=response.get('body',{})
    if not isinstance(body,dict):return None
    error=body.get('error')
    if isinstance(error,dict):
        data=error.get('data');return data.get('reason',error.get('code')) if isinstance(data,dict) else error.get('code')
    result=body.get('result',{})
    if isinstance(result,dict):
        data=result.get('data')
        if isinstance(data,dict) and data.get('reason'):return data['reason']
        for item in result.get('content',[]):
            if item.get('type')=='text':
                try:value=json.loads(item['text'])
                except (ValueError,KeyError):continue
                if isinstance(value,dict):
                    machine=value.get('reason') or value.get('code')
                    if isinstance(machine,str) and machine:return machine
    return None

def query_oracle(response):
    body=response.get('body',{})
    if not isinstance(body,dict):return False,None
    result=body.get('result',{})
    if not isinstance(result,dict):return False,None
    if response.get('httpStatus')!=200 or body.get('error') or result.get('isError'):return False,None
    data=None
    for item in result.get('content',[]):
        if item.get('type')=='text':
            try:data=json.loads(item['text']);break
            except (ValueError,KeyError):pass
    if data is None:data=result.get('structuredContent',result)
    rows=(data.get('rows') or data.get('data')) if isinstance(data,dict) else None
    headers=data.get('headers') if isinstance(data,dict) else None
    if isinstance(rows,dict):headers=rows.get('headers',headers);rows=rows.get('rows')
    if not isinstance(rows,list) or len(rows)!=1:return False,rows
    row=rows[0];names={'order_count','amount_sum'}
    if headers is not None and (not isinstance(headers,list) or len(headers)!=2 or any(not isinstance(x,str) for x in headers) or set(headers)!=names):return False,row
    if isinstance(row,dict):
        if set(row)!=names:return False,row
        bound=row
    else:
        if not isinstance(row,list) or len(row)!=2 or headers is None:return False,row
        bound=dict(zip(headers,row))
    try:count=float(bound['order_count']);total=float(bound['amount_sum'])
    except (ValueError,TypeError):return False,row
    return count==4. and total==100.,row

def project_payload_ok(response):
    body=response.get('body',{})
    if response.get('httpStatus')!=200 or not isinstance(body,dict) or body.get('ok') is not True:return False
    data=body.get('data')
    if not isinstance(data,dict) or data.get('root')!='/data/lucy':return False
    connections=data.get('connections')
    if not isinstance(connections,list) or not connections:return False
    ids=[]
    for connection in connections:
        if not isinstance(connection,dict) or not isinstance(connection.get('id'),str) or not connection['id'].strip():return False
        ids.append(connection['id'])
    return len(ids)==len(set(ids)) and 'uat-mysql' in ids


def failure_class(machine_reason,status):
    text=str(machine_reason or '')
    if text=='EXECUTION_RUNTIME_RELOADING':return 'reload-contract-rejection'
    if text in ['WORKLOAD_CAPACITY_BUSY','workload_capacity_busy'] or status==429:return 'capacity-rejection'
    if text in ['question_budget_unavailable','audit_unavailable']:return 'storage-rejection'
    if text=='semantic_recovery_required':return 'semantic-recovery-failure'
    return 'unexpected-or-unclassified'

def recount(events,seconds,cycle_seconds,summary_counts=None):
    issues=[];periods={**PERIODS,'mutation':cycle_seconds};groups={};seen={};starts=[]
    for event in events:
        kind=event.get('kind')
        if kind not in KINDS:continue
        lane=event.get('lane');rid=event.get('requestId')
        if not isinstance(rid,str):issues.append('request record lacks requestId');continue
        key=(rid,kind)
        if key in seen:issues.append('duplicate record '+str(key))
        seen[key]=event;groups.setdefault(lane,{}).setdefault(rid,{})[KINDS[kind]]=event
        if kind=='request-planned' and lane in periods:
            starts.append(event['plannedMonotonic']-event['iteration']*periods[lane])
    if not starts:return {'issues':['no planned arrivals'],'lanes':{},'queries':[],'failures':[]}
    start=min(starts);end=start+seconds
    if max(starts)-min(starts)>.00001:issues.append('planned arrivals do not share one frozen origin')
    lanes={};queries=[];failures=[];http_payload_checks=[]
    for lane,period in periods.items():
        requests=groups.get(lane,{});expected=math.ceil(seconds/period)
        count={k:0 for k in ['planned','dispatched','missed','terminal','inflight','naturalSucceeded','censoredSucceeded','failed','censored']}
        timings=[];natural_timings=[];indices=[]
        for rid,parts in requests.items():
            for name in ['planned','dispatched','missed','terminal']:count[name]+=name in parts
            planned=parts.get('planned')
            if not planned:issues.append(rid+' lacks plan');continue
            index=planned['iteration'];indices.append(index)
            if rid!=lane+'-'+str(index):issues.append(rid+' request identity/index mismatch')
            if abs(planned['plannedMonotonic']-(start+index*period))>.00001:issues.append(rid+' plan time drift')
            if not 0<=index<expected:issues.append(rid+' planned outside frozen schedule')
            if ('dispatched' in parts)==('missed' in parts):issues.append(rid+' must be dispatched xor missed')
            terminal=parts.get('terminal');dispatched=parts.get('dispatched')
            if dispatched and dispatched['dispatchedMonotonic']<planned['plannedMonotonic']:issues.append(rid+' dispatched before planned arrival')
            if dispatched and dispatched['dispatchedMonotonic']>=end:issues.append(rid+' dispatched after frozen window')
            if terminal and not dispatched:issues.append(rid+' terminal without actual dispatch')
            if terminal:
                finish=terminal['finishedMonotonic'];censored=finish>=end
                if bool(terminal.get('censoredNatural'))!=censored:issues.append(rid+' incorrect natural censor flag')
                if dispatched and finish<dispatched['dispatchedMonotonic']:issues.append(rid+' negative duration')
                elapsed=(finish-terminal['dispatchedMonotonic'])*1000
                if abs(elapsed-terminal['ms'])>1:issues.append(rid+' duration fields inconsistent')
                timings.append(terminal['ms']);count['censored']+=censored
                ok=bool(terminal.get('ok'))
                receipt=terminal.get('receipt') or {};status=receipt.get('httpStatus',terminal.get('status'))
                if lane=='mcp':
                    identity=['a']+['agent%02d'%x for x in range(1,12)];who=terminal.get('identity')
                    if who!=identity[index%12]:issues.append(rid+' wrong/missing scheduled identity')
                    oracle,row=query_oracle(receipt)
                    if ok and not oracle:issues.append(rid+' claimed successful query has bad oracle')
                    queries.append({'requestId':rid,'identity':who,'status':status,'declaredOk':ok,'oracleCorrect':oracle,'actualRow':row,'censored':censored,'ms':terminal['ms']})
                if lane=='http':
                    payload_valid=project_payload_ok(receipt);http_payload_checks.append({'requestId':rid,'payloadCorrect':payload_valid,'censored':censored})
                    if ok and not payload_valid:issues.append(rid+' invalid project HTTP payload')
                if lane.startswith('probe:') or lane=='http':
                    if ok and (status!=200 or terminal.get('apiMs',terminal['ms'])>3000):issues.append(rid+' accepted bad/late HTTP')
                if ok:
                    count['censoredSucceeded' if censored else 'naturalSucceeded']+=1
                    if not censored:natural_timings.append(terminal['ms'])
                else:
                    count['failed']+=1;machine=reason(receipt)
                    failures.append({'requestId':rid,'lane':lane,'status':status,'machineReason':machine,'class':'diagnostic-collection-error' if lane=='audit-progress' else failure_class(machine,status),'ms':terminal['ms'],'censored':censored})
        count['inflight']=count['dispatched']-count['terminal'];count['settledSucceeded']=count['naturalSucceeded']+count['censoredSucceeded']
        count['conserved']=count['planned']==count['dispatched']+count['missed'] and count['dispatched']==count['terminal']+count['inflight']
        if count['planned']!=expected or sorted(indices)!=list(range(expected)):issues.append(lane+' missing/duplicate planned arrivals')
        if not count['conserved']:issues.append(lane+' violates count conservation')
        count['latencyAllTerminal']={**{'p%dMs'%int(p*100):percentile(timings,p) for p in [.5,.95,.99]},'maxMs':max(timings) if timings else None}
        count['latencyNaturalSuccess']={**{'p%dMs'%int(p*100):percentile(natural_timings,p) for p in [.5,.95,.99]},'maxMs':max(natural_timings) if natural_timings else None}
        lanes[lane]=count
        if summary_counts is not None:
            claimed=summary_counts.get(lane,{})
            for key in ['planned','dispatched','missed','terminal','inflight','censored','failed','naturalSucceeded','censoredSucceeded','settledSucceeded']:
                if key in claimed and claimed[key]!=count[key]:issues.append(lane+' summary '+key+' mismatch')
            if 'succeeded' in claimed and claimed['succeeded'] not in [count['naturalSucceeded'],count['settledSucceeded']]:issues.append(lane+' summary succeeded mismatch')
    for kind in ['controlled-stop']:
        if any(e.get('kind')==kind for e in events):issues.append('run was explicitly stopped; cannot qualify full window')
    return {'issues':issues,'naturalStartMonotonic':start,'naturalDeadlineMonotonic':end,'lanes':lanes,'queries':queries,'httpPayloadChecks':http_payload_checks,'failures':failures,'failureClasses':dict(collections.Counter(x['class'] for x in failures))}

def verify_audit(database,cutoff,expected_max_id=None,seconds=90):
    start=time.monotonic();deadline=start+seconds;c=sqlite3.connect(pathlib.Path(database).resolve().as_uri()+'?mode=ro&immutable=1',uri=True)
    c.row_factory=sqlite3.Row;c.set_progress_handler(lambda:int(time.monotonic()>=deadline),10000)
    result={'cutoff':cutoff,'complete':False,'eligible':0,'linked':0,'uniqueLinked':0,'missingLinks':0,'duplicates':0,'wrongUsers':0,'missingTurns':0,'orphanRawLinks':0,'orphanTurnLinks':0,'pendingUsers':0,'users':0,'pages':0}
    try:
        maximum=c.execute('SELECT COALESCE(MAX(id),0) FROM access_log').fetchone()[0];result['maxId']=maximum
        if expected_max_id is not None and maximum!=expected_max_id:raise ValueError('snapshot maxId differs from manifest')
        history=c.execute("SELECT COUNT(*),COUNT(DISTINCT user_id) FROM access_log WHERE client='uat-core1883-history'").fetchone();result['historyRows'],result['historyUsers']=history
        cursor=0;users={}
        while cursor<maximum:
            page=c.execute('SELECT id FROM access_log WHERE id>? AND id<=? ORDER BY id LIMIT 1000',(cursor,maximum)).fetchall()
            if not page:break
            last=page[-1]['id'];result['pages']+=1
            rows=c.execute('''SELECT a.id,a.user_id,COUNT(l.access_log_id) links,
                SUM(CASE WHEN l.access_log_id IS NOT NULL AND t.inferred_turn_id IS NULL THEN 1 ELSE 0 END) missing_turns,
                SUM(CASE WHEN t.inferred_turn_id IS NOT NULL AND t.user_id<>a.user_id THEN 1 ELSE 0 END) wrong_users
                FROM access_log a LEFT JOIN inferred_turn_access_logs l ON l.access_log_id=a.id
                LEFT JOIN inferred_turns t ON t.inferred_turn_id=l.inferred_turn_id
                WHERE a.id>? AND a.id<=? AND a.ts>=? GROUP BY a.id,a.user_id''',(cursor,last,cutoff)).fetchall()
            for row in rows:
                result['eligible']+=1;result['linked']+=row['links'];result['uniqueLinked']+=row['links']>0;result['missingLinks']+=row['links']==0;result['duplicates']+=max(0,row['links']-1)
                result['missingTurns']+=row['missing_turns'];result['wrongUsers']+=row['wrong_users'];users[row['user_id']]=row['id']
            cursor=last
            if time.monotonic()>=deadline:raise TimeoutError('independent audit deadline')
        # Full association scan includes orphan rows that cannot appear in the raw-driven join.
        orphan=c.execute('''SELECT SUM(a.id IS NULL) missing_raw,SUM(t.inferred_turn_id IS NULL) missing_turn
            FROM inferred_turn_access_logs l LEFT JOIN access_log a ON a.id=l.access_log_id
            LEFT JOIN inferred_turns t ON t.inferred_turn_id=l.inferred_turn_id''').fetchone()
        result['orphanRawLinks']=orphan['missing_raw'] or 0;result['orphanTurnLinks']=orphan['missing_turn'] or 0
        result['users']=len(users);result['userWatermarks']=[]
        for user,newest in sorted(users.items()):
            state=c.execute('SELECT status,watermark FROM inferred_rebuild_state WHERE user_id=?',(user,)).fetchone();watermark=str(state['watermark']) if state else ''
            valid=bool(state and state['status']=='complete' and watermark.isascii() and watermark.isdigit() and int(watermark)>=newest)
            result['pendingUsers']+=not valid;result['userWatermarks'].append({'user':user,'newest':newest,'status':state['status'] if state else None,'watermark':watermark,'valid':valid})
        result['complete']=result['eligible']>0 and result['linked']==result['uniqueLinked']==result['eligible'] and not any(result[x] for x in ['missingLinks','duplicates','wrongUsers','missingTurns','orphanRawLinks','orphanTurnLinks','pendingUsers'])
    except Exception as e:result['error']=str(e)
    finally:c.close();result['elapsedSeconds']=time.monotonic()-start
    return result

def epoch_ms(value):
    # Python3.9 rejects RFC3339Nano fractions, while some versions silently
    # normalize invalid timezone minutes. Parse grammar/calendar/offset ourselves.
    if not isinstance(value,str):raise ValueError('RFC3339 timestamp must be text')
    match=re.fullmatch(r'([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})',value)
    if not match:raise ValueError('invalid strict RFC3339Nano timestamp')
    whole,fraction,zone=match.groups();base=datetime.datetime.strptime(whole,'%Y-%m-%dT%H:%M:%S')
    if zone=='Z':offset=datetime.timedelta()
    else:
        hours,minutes=int(zone[1:3]),int(zone[4:6])
        if hours>23 or minutes>59:raise ValueError('invalid RFC3339 timezone offset')
        offset=datetime.timedelta(minutes=(hours*60+minutes)*(1 if zone[0]=='+' else -1))
    epoch_seconds=int(base.replace(tzinfo=datetime.timezone(offset)).timestamp())
    nanos=int((fraction or '').ljust(9,'0') or '0');exact=Decimal(epoch_seconds)*1000+Decimal(nanos)/1000000
    return int(exact) if exact==exact.to_integral_value() else exact

PROBLEM={'connectionId':'uat-mysql','measures':['uat_begin_zero_orders.order_count','uat_begin_zero_orders.amount_sum']}
PROBLEM_FINGERPRINT=hashlib.sha256(json.dumps(PROBLEM,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def owner_windows(log_text):
    owners={};errors=[]
    for line in log_text.splitlines():
        marker=line.find('[lucy-reload]')
        if marker<0:continue
        prefix=line[:marker].strip()
        if prefix:
            try:epoch_ms(prefix)
            except (ValueError,TypeError):continue
        try:row,_=json.JSONDecoder().raw_decode(line[marker+len('[lucy-reload]'):].strip())
        except ValueError:continue
        if not isinstance(row,dict) or row.get('event') not in ['acquire','release'] or not row.get('requestId'):continue
        bucket=owners.setdefault(row['requestId'],{})
        if row['event'] in bucket:errors.append('duplicate owner '+row['event']+': '+row['requestId'])
        bucket[row['event']]=row
    return owners,errors

def verify_contract_rejections(run,events,database,natural_end,enabled=False):
    log=pathlib.Path(run)/'candidate/final-container-log.json'
    owners,owner_errors=owner_windows(log.read_text() if log.exists() else '')
    recovered=collections.defaultdict(list);dispatched={}
    for event in events:
        if event.get('kind')=='contract-recovery':recovered[event.get('originalRequestId')].append(event)
        if event.get('kind')=='request-dispatched':dispatched[event.get('requestId')]=event
    c=sqlite3.connect(pathlib.Path(database).resolve().as_uri()+'?mode=ro&immutable=1',uri=True);c.row_factory=sqlite3.Row;verdicts=[]
    try:
        for failed in events:
            if failed.get('kind')!='request-terminal' or failed.get('lane')!='mcp' or failed.get('ok'):continue
            rid=failed['requestId'];response=failed.get('receipt',{});machine=reason(response);error=response.get('body',{}).get('error') or {};data=error.get('data') if isinstance(error.get('data'),dict) else error
            proof={'requestId':rid,'machineReason':machine,'expected':False,'checks':{},'reasons':[]}
            def check(name,value):
                proof['checks'][name]=bool(value)
                if not value:proof['reasons'].append(name)
                return bool(value)
            check('explicitlyEnabledApprovedMapping',enabled)
            check('exactStructured503ReloadCode',response.get('httpStatus')==503 and machine=='EXECUTION_RUNTIME_RELOADING')
            owner=data.get('requestId');deadline=data.get('deadlineAt');rejected=data.get('rejectedAt');window=owners.get(owner,{})
            acquire=window.get('acquire');release=window.get('release');proof['ownerRequestId']=owner
            if check('uniqueActualOwnerClosure',bool(acquire and release and not any(owner in x for x in owner_errors) if owner else False)):
                try:
                    acquired=epoch_ms(acquire['acquiredAt']);released=epoch_ms(release['releasedAt']);issued=epoch_ms(dispatched[rid]['at']);finished=epoch_ms(failed['at'])
                    check('sameOwnerDeadline',deadline==acquire['deadlineAt']==release['deadlineAt'])
                    check('ownerClosedWithin60Seconds',acquired<=released<=deadline and 0<deadline-acquired<=60000)
                    check('failureInsideRealOwnerWindow',isinstance(rejected,(int,float)) and acquired<=rejected<=released<=deadline)
                    proof['clientObserved']={'dispatchedAt':dispatched[rid]['at'],'terminalAt':failed['at'],'rejectedAt':rejected,'clientTerminalAfterRelease':finished>released}
                    proof['ownerWindow']={'acquiredAt':acquire['acquiredAt'],'releasedAt':release['releasedAt'],'deadlineAt':deadline}
                except (KeyError,TypeError,ValueError):check('wellFormedOwnerTiming',False)
            restore=recovered.get(rid,[])
            if check('oneExplicitRecoveryAttempt',len(restore)==1):
                recovery=restore[0];who=failed.get('identity');session='independent-question-'+str(failed['iteration']);user='uat_zb_'+str(who)
                check('sameOwnerRecovery',recovery.get('ownerRequestId')==owner)
                check('sameIdentityAndSession',recovery.get('identity')==who and recovery.get('userId')==user and recovery.get('session')==session)
                check('sameOriginalProblem',failed.get('problemFingerprint')==recovery.get('problemFingerprint')==PROBLEM_FINGERPRINT)
                begin=recovery.get('startedMonotonic');finish=recovery.get('finishedMonotonic')
                check('recoveryOutsideNaturalThroughput',isinstance(begin,(int,float)) and isinstance(finish,(int,float)) and begin>=natural_end and finish>=begin and begin>=failed['finishedMonotonic'])
                oracle,row=query_oracle(recovery.get('receipt',{}));check('actualRecoveryOracle4And100',recovery.get('ok') is True and oracle);proof['recoveryRow']=row
                token=recovery.get('tokenHashPrefix');scope=recovery.get('scopeKey');expected_scope='bq:'+user+'|'+str(token)+':'+session
                check('scopeIdentityBound',isinstance(token,str) and token.startswith('sha256:') and len(token)==19 and scope==expected_scope)
                budget=c.execute('SELECT calls,attempts,current_concurrency FROM question_budget_state WHERE scope_key=?',(scope,)).fetchone()
                check('exactlyOneBudgetCallAndAttempt',bool(budget and budget['calls']==1 and budget['attempts']==1 and budget['current_concurrency']==0))
                rows=c.execute("SELECT id,request_id,outcome,generated_sql,query_operation FROM access_log WHERE user_id=? AND lucy_session_id=? AND token_hash_prefix=? AND tool='lucy_query'",(user,session,token)).fetchall()
                check('onlyOneActualQueryRow',len(rows)==1 and rows[0]['outcome']=='ok' and bool(rows[0]['generated_sql'] or rows[0]['query_operation']))
                if len(rows)==1:
                    actual=rows[0];original_rpc=failed.get('rpcId',response.get('rpcId'));recovery_rpc=recovery.get('receipt',{}).get('rpcId')
                    check('originalRefusalNeverExecuted',original_rpc is not None and str(actual['request_id'])!=str(original_rpc))
                    check('recoveryExecutionReceiptMatches',recovery_rpc is not None and str(actual['request_id'])==str(recovery_rpc))
                    associations=c.execute('SELECT t.user_id FROM inferred_turn_access_logs l LEFT JOIN inferred_turns t ON t.inferred_turn_id=l.inferred_turn_id WHERE l.access_log_id=?',(actual['id'],)).fetchall()
                    check('queryUniqueEffectiveAssociation',len(associations)==1 and associations[0]['user_id']==user)
                    proof['auditQuery']={'id':actual['id'],'requestId':actual['request_id'],'scopeKey':scope,'budget':dict(budget) if budget else None}
            proof['expected']=all(proof['checks'].values());verdicts.append(proof)
    finally:c.close()
    return {'ownerLogErrors':owner_errors,'ownersObserved':len(owners),'verdicts':verdicts,'expectedCount':sum(x['expected'] for x in verdicts),'unresolvedCount':sum(not x['expected'] for x in verdicts)}


def verify_backup(run,cutoff=None,contract_context=None):
    manifest_path=pathlib.Path(run)/'audit-evidence.json';archive=pathlib.Path(run)/'audit-evidence.sqlite.gz';manifest=json.loads(manifest_path.read_text())
    issues=[]
    if digest(archive)!=manifest['gzipSha256']:issues.append('audit gzip hash mismatch')
    if archive.stat().st_size!=manifest['gzipBytes']:issues.append('audit gzip length mismatch')
    if cutoff is not None and cutoff!=manifest['cutoff']:issues.append('audit cutoff differs from independently supplied cutoff')
    if issues:raise ValueError('; '.join(issues))
    with tempfile.TemporaryDirectory(prefix='lucy-ca09-') as tmp:
        snapshot=pathlib.Path(tmp)/'snapshot.sqlite'
        with gzip.open(archive,'rb') as source,snapshot.open('wb') as target:
            size=0
            for part in iter(lambda:source.read(1024*1024),b''):
                size+=len(part)
                if size>manifest['sqliteBytes']:raise ValueError('audit gzip expands beyond manifest byte bound')
                target.write(part)
        if snapshot.stat().st_size!=manifest['sqliteBytes']:issues.append('audit sqlite length mismatch')
        if digest(snapshot)!=manifest['sqliteSha256']:issues.append('audit sqlite hash mismatch')
        if issues:raise ValueError('; '.join(issues))
        audit=verify_audit(snapshot,cutoff or manifest['cutoff'],manifest['maxId'])
        contracts=verify_contract_rejections(run,contract_context['events'],snapshot,contract_context['naturalEnd'],contract_context['enabled']) if contract_context is not None else None
    if not audit['complete']:issues.append('independent audit closure incomplete')
    return {'manifest':manifest,'issues':issues,'recomputed':audit,'contractRejections':contracts,'temporarySnapshotRemoved':not snapshot.exists()}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--run',required=True);p.add_argument('--out',required=True);p.add_argument('--seconds',type=float,default=3600);p.add_argument('--cycle-seconds',type=float,default=300);p.add_argument('--seed-rows',type=int,default=200000);p.add_argument('--cycle-seed-rows',type=int,default=3000);p.add_argument('--expected-image-id',required=True);p.add_argument('--tool-freeze',required=True);p.add_argument('--cutoff');p.add_argument('--calibration',action='store_true');p.add_argument('--allow-reload-contract',action='store_true',help='Explicit reviewed P1-69 mapping, still requires owner/recovery/audit proof');p.add_argument('--candidate-manifest');a=p.parse_args()
    run=pathlib.Path(a.run);output=pathlib.Path(a.out);output.parent.mkdir(parents=True,exist_ok=True);summary=json.loads((run/'summary.json').read_text());events=[json.loads(x) for x in (run/'events.jsonl').read_text().splitlines()]
    result=recount(events,a.seconds,a.cycle_seconds,summary.get('counts'));issues=result['issues']
    artifact=json.loads((run/'candidate/artifact.json').read_text());observed_image=artifact['image'].split()[0]
    if observed_image!=a.expected_image_id:issues.append('candidate image differs from independently frozen identity')
    candidate=None
    if a.candidate_manifest:
        candidate=json.loads(pathlib.Path(a.candidate_manifest).read_text())
        if candidate['imageId']!=observed_image:issues.append('candidate manifest image mismatch')
        for key,value in candidate.get('parameters',{}).items():
            if key in summary.get('parameters',{}) and summary['parameters'][key]!=value:issues.append('candidate parameter '+key+' mismatch')
    freeze=json.loads(pathlib.Path(a.tool_freeze).read_text());hashes=freeze.get('files',freeze)
    for key,path,snapshot_name in [('runnerSha256','scripts/uat/core-availability-1883-soak.py','runner-snapshot.py'),('baseSha256','scripts/uat/readyz-diagnostic-repro.py','base-snapshot.py'),('helperSha256','scripts/uat/verify-begin-zero-binding.py','helper-snapshot.py')]:
        frozen_key=snapshot_name if snapshot_name in hashes else path if path in hashes else None
        if frozen_key is None:issues.append('required frozen source identity missing: '+path);continue
        if summary.get(key)!=hashes[frozen_key]:issues.append('frozen '+path+' hash mismatch')
        if candidate and path in candidate.get('toolHashes',{}) and candidate['toolHashes'][path]!=hashes[frozen_key]:issues.append('tool differs from candidate freeze: '+path)
        snapshot=run/snapshot_name
        if snapshot.exists() and digest(snapshot)!=hashes[frozen_key]:issues.append('actual '+snapshot_name+' hash mismatch')
    for key,value in [('seconds',a.seconds),('cycle_seconds',a.cycle_seconds),('seed_rows',a.seed_rows),('cycle_seed_rows',a.cycle_seed_rows)]:
        if summary.get('parameters',{}).get(key)!=value:issues.append('runner parameter '+key+' differs from reviewer contract')
    if not a.calibration and not formal_window_valid(a.seconds,a.cycle_seconds):issues.append('approved formal contract requires at least1800s and12 cycles; explicit reviewer parameters remain authoritative')
    expected_cycles=math.ceil(a.seconds/a.cycle_seconds);result['completedNaturalCycles']=result['lanes']['mutation']['naturalSucceeded']
    if result['completedNaturalCycles']!=expected_cycles:issues.append('incomplete natural mutation cycles')
    try:result['auditEvidence']=verify_backup(run,a.cutoff,{'events':events,'naturalEnd':result['naturalDeadlineMonotonic'],'enabled':a.allow_reload_contract});issues.extend(result['auditEvidence']['issues'])
    except Exception as e:issues.append('independent audit backup validation failed: '+str(e))
    if result.get('auditEvidence'):
        audit=result['auditEvidence']['recomputed'];expected_history=a.seed_rows+max(0,expected_cycles-1)*a.cycle_seed_rows
        if audit.get('historyRows')!=expected_history:issues.append('audit historical fixture row denominator differs')
        if audit.get('historyUsers')!=min(67,expected_history):issues.append('audit historical fixture users differ')
    result['candidateImageId']=observed_image;result['evidenceHashes']={'eventsSha256':digest(run/'events.jsonl'),'artifactSha256':digest(run/'candidate/artifact.json'),'summarySha256':digest(run/'summary.json'),'toolFreezeSha256':digest(a.tool_freeze),'independentVerifierSha256':digest(__file__)}
    if 'eventErrors' in summary:
        raw_failed={e['requestId'] for e in events if e.get('kind')=='request-terminal' and not e.get('ok')}
        claimed_failed={e.get('requestId') for e in summary['eventErrors']}
        if raw_failed!=claimed_failed:issues.append('summary omitted or invented terminal failures')
    live=result['lanes']['probe:/api/livez']['latencyAllTerminal'];ready=result['lanes']['probe:/api/readyz']['latencyAllTerminal']
    result['performanceBudget']={'livezP99Ms':live['p99Ms'],'livezMaxMs':live['maxMs'],'readyzP99Ms':ready['p99Ms'],'passed':bool(live['p99Ms'] is not None and live['p99Ms']<=400 and live['maxMs']<=1000 and ready['p99Ms'] is not None and ready['p99Ms']<=1500)}
    result['integrityVerdict']='INVALID' if issues else 'VALID'
    contract_result=result.get('auditEvidence',{}).get('contractRejections') or {};expected_ids={x['requestId'] for x in contract_result.get('verdicts',[]) if x['expected']}
    result['unexpectedFailures']=[x for x in result['failures'] if x['requestId'] not in expected_ids]
    result['expectedFailures']=[x for x in result['failures'] if x['requestId'] in expected_ids]
    result['strictAcceptanceVerdict']='FAIL' if issues or not result['performanceBudget']['passed'] or result['unexpectedFailures'] or not all(x['payloadCorrect'] for x in result.get('httpPayloadChecks',[])) or any(x['missed'] or x['inflight'] for x in result['lanes'].values()) else 'CALIBRATION EVIDENCE VALID' if a.calibration else 'REQUIRES SC/RESOURCE REVIEW'
    result['limits']=['Failure classification does not auto-exempt reload/capacity rejections; approved owner-bound SC mapping needs separate review','No customer/full F61/F62/F63/R-CAV conclusion;1800s evidence never claims an hour run','Source identity validated against supplied freezes and actual artifact; module SC and clean resource proof remain separate review']
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'integrity':result['integrityVerdict'],'strictAcceptance':result['strictAcceptanceVerdict'],'issues':issues,'ordinaryQueries':len(result['queries']),'failures':len(result['failures']),'cycles':result['completedNaturalCycles']},ensure_ascii=False,indent=2))
    return int(result['integrityVerdict']!='VALID' or bool(result['unexpectedFailures']) or not result['performanceBudget']['passed'] or not all(x['payloadCorrect'] for x in result.get('httpPayloadChecks',[])))
if __name__=='__main__':raise SystemExit(main())
