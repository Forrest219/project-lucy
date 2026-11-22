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
    return seconds >= 1800 and 0 < cycle_seconds <= 300 and seconds / cycle_seconds >= 12


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

def recount(events,seconds,cycle_seconds,summary_counts=None,gateway=False):
    issues=[];periods={**PERIODS,'mutation':cycle_seconds};groups={};seen={};starts=[]
    if gateway:
        periods['gateway-readyz'] = 1
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
    if not starts:
        return {'issues':['no planned arrivals'], 'naturalDeadlineMonotonic':None,
                'lanes':{},'queries':[],'failures':[]}
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
                if lane.startswith('probe:') or lane in ('http','gateway-readyz'):
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

def load_json(path):
    return json.loads(path.read_text())


def json_lines(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def gateway_receipts(run, events, candidate, issues):
    gateway = json_lines(run/'gateway.jsonl')
    by_id = {entry['id']: entry for entry in gateway}
    if len(by_id) != len(gateway) or None in by_id:
        issues.append('duplicate or missing gateway receipt identity')
    routes = {'gateway-readyz': ('GET', '/api/readyz'), 'http': ('GET', '/api/project'), 'mcp': ('POST', '/mcp')}
    used = set()
    counts = collections.Counter()
    for event in events:
        lane = event.get('lane')
        if event.get('kind') != 'request-terminal' or lane not in routes:
            continue
        receipt = event.get('receipt') or {}
        hop_id = receipt.get('gatewayHopId')
        if not receipt and not event.get('ok'):
            # Connection/read failures have no client receipt and are already
            # retained as failed terminal records by the independent recount.
            continue
        row = by_id.get(hop_id, {})
        if (not hop_id or hop_id in used or (row.get('method'),row.get('path')) != routes[lane]
                or row.get('status') != receipt.get('httpStatus')
                or row.get('outcome') not in ('forwarded', 'upstream-error')
                or (event.get('ok') and row.get('outcome') != 'forwarded')):
            issues.append(event['requestId']+' gateway receipt not attributable')
        else:
            counts[lane+':'+row['outcome']] += 1
        used.add(hop_id)
    preflight = load_json(candidate/'gateway-preflight.json')
    for name, path in [('gatewayReady', '/api/readyz'), ('gatewayHttp', '/api/project')]:
        response = preflight[name]
        hop = by_id.get(response.get('gatewayHopId'), {})
        if (hop.get('path') != path or hop.get('status') != 200 or hop.get('outcome') != 'forwarded'
                or response.get('httpStatus') != 200):
            issues.append(name+' gateway baseline missing')
    return dict(counts)


def verify_manifest(run):
    manifest = load_json(run/'evidence-sha256.json')
    files = [path for path in run.rglob('*')
             if path.name not in ('verdict.json','evidence-sha256.json')]
    if any(path.is_symlink() for path in files):
        raise ValueError('evidence bundle contains symbolic links')
    present = {path.relative_to(run).as_posix():path for path in files if path.is_file()}
    if manifest.keys() != present.keys():
        raise ValueError('evidence bundle differs from its file inventory')
    for name, path in present.items():
        if manifest[name] != digest(path):
            raise ValueError('evidence hash mismatch: '+name)


def verify_frozen_profile(frozen, summary, issues):
    profile_path = pathlib.Path(__file__).with_name('core-availability-profiles.json')
    profiles = load_json(profile_path)
    profile = frozen['profile']
    parameters = frozen['parameters']
    if (frozen.get('schemaVersion') != 1 or frozen.get('thresholds') != profiles['version']
            or frozen['tools'].get(profile_path.name) != digest(profile_path)):
        issues.append('use the standard profile file from the frozen checkout')
    expected = {key.replace('-','_'):value for key,value in profiles[profile].items()}
    expected.update(mode=profile, gateway=True, contract_policy='p1-69', io_control=True,
                    audit_evidence_copy=True, profile_seconds=0, stop_after=None,
                    keep_resources=False, cycle_seed_rows=3000, mcp_concurrency=12,
                    contract_recovery_seconds=300)
    for key, value in expected.items():
        if parameters.get(key) != value:
            issues.append('parameter differs from the standard profile: '+key)
    if summary.get('parameters') != parameters:
        issues.append('producer arguments differ from frozen profile')
    for key, path in [('runnerSha256','core-availability-1883-soak.py'),
                      ('baseSha256','readyz-diagnostic-repro.py'),('helperSha256','verify-begin-zero-binding.py')]:
        if summary.get(key) != frozen['tools'].get(path):
            issues.append('runner tool hash differs from freeze: '+path)


def assess_baseline(candidate, frozen, issues):
    failures = []
    if frozen['images'] != load_json(candidate/'run-identity.json'):
        issues.append('runtime Git or Docker identity differs from preflight')
    scale = load_json(candidate/'scale-initial.json')
    if not all(scale.get(key,0) >= 1883 for key in ['physical','enabled','manifest']):
        failures.append('initial scale below 1883 tables')
    preflight = load_json(candidate/'gateway-preflight.json')
    if not project_payload_ok(preflight['gatewayHttp']) or not project_payload_ok(preflight['directHttp']):
        failures.append('authenticated project baseline payload differs')
    if any(preflight[key].get('httpStatus') != 200 for key in ['directReady','gatewayReady']):
        failures.append('readyz preflight failed')
    if not query_oracle(load_json(candidate/'soak-initial-query.json'))[0]:
        failures.append('initial actual MCP query failed')
    for name in ['mcp-initial','mcp-after-io','mcp-final']:
        check = load_json(candidate/(name+'.json'))
        if (check.get('oracle') != 'count=4,sum=100'
                or any(check.get(key) != 200 for key in ['initialize','toolsList','query','httpProject'])):
            failures.append(name+' user path failed')
    return failures


def assess_mutations(candidate, events, count):
    failures = []
    scale = load_json(candidate/'scale-final.json')
    if not all(scale.get(key,0) >= 1883 for key in ['physical','enabled','manifest']):
        failures.append('final scale below 1883 tables')
    cycles = [event for event in events if event.get('kind') == 'mutation-end']
    if sorted(event['iteration'] for event in cycles) != list(range(count)):
        failures.append('mutation receipt missing or duplicated')
    reload_receipts = collections.defaultdict(list)
    writes = collections.defaultdict(list)
    for event in events:
        if event.get('kind') == 'reload-end':
            reload_receipts[event['iteration']].append(event)
        if event.get('kind') == 'mutation-step':
            writes[event['iteration']].append(event)
    expected_writes = [('validate',['valid']),('upload',['uploaded']),
                       ('enabled-tables',['written','policyRuntimeAck','runtimeAck'])]
    for event in cycles:
        index = event['iteration']
        scale = event.get('scale', {})
        rows = reload_receipts[index]
        if not all(scale.get(key,0) >= 1883 for key in ['physical','enabled','manifest']):
            failures.append('table scale dropped at cycle '+str(index))
        cycle_writes = writes[index]
        if len(cycle_writes) != len(expected_writes) or any(
            row.get('path','').rsplit('/',1)[-1] != name or row.get('status') != 200
            or not all(row['receipt']['body'].get('data',{}).get(key) is True for key in keys)
            for row,(name,keys) in zip(cycle_writes,expected_writes)
        ):
            failures.append('validation, upload or save receipt missing at cycle '+str(index))
        if (len(rows) != 1 or rows[0].get('status') != 200
                or not rows[0].get('pidBefore','').isdigit() or not rows[0].get('pidAfter','').isdigit()
                or rows[0]['pidBefore'] == rows[0]['pidAfter']
                or rows[0]['receipt']['body'].get('data',{}).get('reloadStatus') != 'succeeded'
                or not query_oracle(load_json(candidate/('cycle-%d-recovery-query.json'%index)))[0]):
            failures.append('reload or post-reload oracle missing at cycle '+str(index))
    return failures


def assess_io(candidate):
    facts = load_json(candidate/'io-control-terminal-facts.json')
    recovery = load_json(candidate/'io-control-recovery.json')
    if (not facts['blockedWitnesses'] or not set(facts['blockedWitnesses']).issubset(facts['actualTerminated'])
            or facts['maxDiagnosticInflight'] != 1 or facts['oldFifoReleasedBeforeFresh'] or not facts['sameServerPid']
            or recovery.get('recovered') is not True
            or not query_oracle(load_json(candidate/'after-io-query.json'))[0]
            or not project_payload_ok(load_json(candidate/'after-io-project.json'))):
        return ['actual diagnostic termination and same-PID user recovery not shown']
    return []


def assess_audit_tickets(run, events):
    failures = []
    seen = set()
    for event in events:
        if event.get('kind') != 'request-terminal' or event.get('lane') != 'audit-progress':
            continue
        request_id = event['requestId']
        remote = event.get('remoteExec',{})
        ticket = remote.get('ticket','')
        if not re.fullmatch(r'[a-f0-9]{16}',ticket) or ticket in seen or remote.get('logicalRequestId') != request_id:
            failures.append(request_id+' does not bind a unique exec ticket')
            continue
        seen.add(ticket)
        binding_path = run/'candidate/exec-bindings'/(ticket+'.json')
        if not binding_path.is_file() or load_json(binding_path).get('logicalRequestId') != request_id:
            failures.append(request_id+' host binding is missing')
            continue
        remote_path = run/'observations/exec-tickets'/(ticket+'.json')
        if event.get('ok'):
            value = load_json(remote_path) if remote_path.is_file() else {}
            if (not value.get('complete') or value.get('returnCode') != 0
                    or value.get('logicalRequestId') != request_id
                    or not (value.get('groupTermination') or {}).get('groupAbsent')):
                failures.append(request_id+' successful collection lacks remote terminal proof')
    return failures


def assess_cleanup(candidate, summary):
    cleanup = load_json(candidate/'cleanup.json')
    if (not cleanup.get('complete') or len(cleanup.get('resourcesAbsent',{})) != 4
            or not all(cleanup['resourcesAbsent'].values()) or not cleanup.get('privateRemoved')
            or cleanup.get('errors') or summary.get('workersAfterCleanup') != 0):
        return ['isolated resource cleanup not attested']
    return []


def record_case(result, number, check):
    try:
        failures = check()
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error) as error:
        result['issues'].append('STD-%02d evidence: %s'%(number,error))
        result['cases']['UAT-CAV-STD-%02d'%number] = {'verdict':'BLOCKED','findings':[str(error)]}
        return
    result['criteriaFailures'].extend('STD-%02d: %s'%(number,issue) for issue in failures)
    result['cases']['UAT-CAV-STD-%02d'%number] = {'verdict':'FAIL' if failures else 'PASS','findings':failures}


def assess_requests(result, events, summary, seconds):
    lanes = result['lanes']
    probes = [lanes[name]['latencyAllTerminal'] for name in
              ['probe:/api/livez','probe:/api/readyz','gateway-readyz']]
    performance = [probes[0]['p99Ms'],probes[0]['maxMs'],probes[1]['p99Ms'],probes[2]['p99Ms']]
    result['performanceBudget'] = dict(zip(['livezP99Ms','livezMaxMs','readyzP99Ms','gatewayReadyzP99Ms'],performance))
    failures = []
    if any(value is None or value > limit for value,limit in zip(performance,[400,1000,1500,1500])):
        failures.append('probe performance budget failed')
    stops = [row for row in events if row.get('kind') == 'natural-stop-arrivals']
    if len(stops) != 1 or stops[0]['elapsedSeconds'] < seconds or summary['naturalObservedSeconds'] != seconds:
        failures.append('natural observation window did not reach its declared end')
    user_lanes = [lane for name,lane in lanes.items() if name not in ('audit-progress','mutation')]
    if any(lane['missed'] or lane['inflight'] for lane in user_lanes):
        failures.append('planned user requests missed or left in flight')
    if any(row['lane'] not in ('audit-progress','mutation') for row in result['unexpectedFailures']):
        failures.append('unexpected failure in a user or probe lane')
    return failures


def evaluate(run):
    result = {'integrityVerdict':'INVALID','strictAcceptanceVerdict':'BLOCKED',
              'producerVerdict':None,'issues':[],'criteriaFailures':[],'unexpectedFailures':[],
              'cases':{'UAT-CAV-STD-%02d'%number:{'verdict':'NOT RUN','findings':[]} for number in range(1,6)}}
    issues = result['issues']
    error_path = run/'preflight-error.json'
    if error_path.is_file():
        issues.extend(load_json(error_path)['issues'])
        return result
    try:
        verify_manifest(run)
        frozen = load_json(run/'freeze.json')
        parameters = frozen['parameters']
        summary = load_json(run/'summary.json')
        candidate = run/'candidate'
        result['producerVerdict'] = summary['status']
        if digest(__file__) != frozen['tools'].get(pathlib.Path(__file__).name):
            raise ValueError('use the verifier from the frozen test checkout')
        for name, expected in frozen['tools'].items():
            if name != pathlib.Path(name).name or digest(run/'tools/scripts/uat'/name) != expected:
                raise ValueError('frozen tool snapshot hash mismatch: '+name)
        verify_frozen_profile(frozen,summary,issues)
        if not (run/'events.jsonl').is_file():
            # If Docker progressed as far as a valid image and fixture, a raw
            # initial refusal is a failed user step, even before timed sampling.
            identity_path = candidate/'run-identity.json'
            identity_matches = identity_path.is_file() and load_json(identity_path) == frozen['images']
            failure = summary.get('error') or 'natural observation window never started'
            if identity_matches and failure in ('MCP protocol failed','gateway or direct fixture preflight failed'):
                result['strictAcceptanceVerdict'] = 'FAIL'
                result['cases']['UAT-CAV-STD-01'] = {'verdict':'FAIL','findings':[failure]}
            issues.append(failure)
            return result
        events = json_lines(run/'events.jsonl')
        if not any(event.get('kind') == 'request-planned' for event in events):
            raise ValueError('no scheduled arrivals; inspect runner and fixture preflight')
        result['strictAcceptanceVerdict'] = 'FAIL'
        seconds, cycle = parameters['seconds'], parameters['cycle_seconds']
        recalculated = recount(events,seconds,cycle,summary.get('counts'),gateway=True)
        issues.extend(recalculated.pop('issues'))
        result.update(recalculated)
        result['gatewayForwarding'] = gateway_receipts(run,events,candidate,issues)
        cycles = math.ceil(seconds/cycle)
        result['mutationHttpFailures'] = [
            {'iteration':event['iteration'],'path':event['path'],'status':event['status'],
             'error':event.get('receipt',{}).get('body',{}).get('error')}
            for event in events if event.get('kind') == 'mutation-step' and event['status'] != 200
        ]
        if frozen['profile'] == 'formal' and not formal_window_valid(seconds,cycle):
            issues.append('formal profile lacks the minimum window or cycle count')
        audit_error = None
        try:
            result['auditEvidence'] = verify_backup(run,contract_context={'events':events,
                'naturalEnd':result['naturalDeadlineMonotonic'],'enabled':True})
        except (OSError,ValueError,KeyError,TypeError,sqlite3.Error) as error:
            audit_error = 'independent audit backup validation failed: '+str(error)
        contract = result.get('auditEvidence',{}).get('contractRejections') or {}
        expected_ids = {row['requestId'] for row in contract.get('verdicts',[]) if row['expected']}
        result['expectedFailures'] = [row for row in result['failures'] if row['requestId'] in expected_ids]
        result['unexpectedFailures'] = [row for row in result['failures'] if row['requestId'] not in expected_ids]
        result['unexpectedFailuresByClass'] = dict(collections.Counter(row['class'] for row in result['unexpectedFailures']))

        def assess_cycle_case():
            failures = assess_mutations(candidate,events,cycles)
            lane = result['lanes']['mutation']
            if lane['naturalSucceeded'] != cycles:
                failures.append('scheduled mutation count differs')
            return failures

        def assess_audit_case():
            lane = result['lanes']['audit-progress']
            failures = assess_audit_tickets(run,events)+assess_cleanup(candidate,summary)
            if lane['missed'] or lane['inflight'] or lane['failed']:
                failures.append('online audit collection missed, failed or in flight')
            if audit_error:
                failures.append(audit_error)
            else:
                failures.extend(result['auditEvidence']['issues'])
                audit = result['auditEvidence']['recomputed']
                if audit['historyRows'] != parameters['seed_rows']+(cycles-1)*parameters['cycle_seed_rows'] or audit['historyUsers'] != 67:
                    failures.append('audit fixture denominator differs')
            return failures

        record_case(result,1,lambda:assess_baseline(candidate,frozen,issues))
        record_case(result,2,lambda:assess_requests(result,events,summary,seconds))
        record_case(result,3,assess_cycle_case)
        record_case(result,4,lambda:assess_io(candidate))
        record_case(result,5,assess_audit_case)
        if summary['status'] not in ('CALIBRATION PASS','PASS WITH GAP','PASS') or load_json(run/'runner-exit.json')['exitCode'] != 0:
            result['criteriaFailures'].append('runner did not complete its checks')
        if not issues:
            result['integrityVerdict'] = 'VALID'
            if not (result['criteriaFailures'] or result['unexpectedFailures']):
                result['strictAcceptanceVerdict'] = 'CALIBRATION PASS' if frozen['profile'] == 'calibration' else 'PASS'
    except (OSError,ValueError,KeyError,TypeError,sqlite3.Error) as error:
        issues.append(str(error))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',type=pathlib.Path,required=True)
    parser.add_argument('--out',type=pathlib.Path,required=True)
    args = parser.parse_args()
    result = evaluate(args.run)
    args.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    keys = ['integrityVerdict','strictAcceptanceVerdict','issues','criteriaFailures','cases']
    print(json.dumps({key:result[key] for key in keys},ensure_ascii=False,indent=2))
    return {'PASS':0,'CALIBRATION PASS':0,'FAIL':1,'BLOCKED':2}[result['strictAcceptanceVerdict']]


if __name__ == '__main__':
    raise SystemExit(main())
