#!/usr/bin/env python3
"""Tool failure regressions; these do not qualify a Docker soak."""
import importlib.util
import pathlib
import os
import signal
import secrets
import sys
import tempfile
import json
import sqlite3
import subprocess
import contextlib
import copy
import io
import threading
import time
import unittest
from unittest import mock

TARGET=pathlib.Path(__file__).with_name('core-availability-1883-soak.py')
spec=importlib.util.spec_from_file_location('soak_tool',TARGET)
soak=importlib.util.module_from_spec(spec)
spec.loader.exec_module(soak)

class ToolRegressions(unittest.TestCase):
    def test_formal_hour_is_valid_and_profiler_is_off(self):
        args=soak.parse_args(['--image','sha256:test','--out','unused','--seconds','3600','--cycle-seconds','300'])
        self.assertEqual(args.mode,'formal')
        self.assertFalse(args.profile_seconds)
        self.assertEqual(args.seconds//args.cycle_seconds,12)

    def test_formal_default_is_user_approved_half_hour_with_twelve_cycles(self):
        args=soak.parse_args(['--image','test','--out','unused'])
        self.assertEqual(args.seconds,1800)
        self.assertEqual(args.cycle_seconds,150)
        self.assertEqual([n*args.cycle_seconds for n in range(12)],list(range(0,1800,150)))
        self.assertEqual(args.seed_rows,200000)
        self.assertEqual(args.cycle_seed_rows,3000)
        self.assertFalse(args.profile_seconds)

    def test_formal_half_hour_explicit_cycle_is_supported(self):
        args=soak.parse_args(['--image','test','--out','unused','--seconds','1800','--cycle-seconds','150'])
        self.assertEqual(args.seconds//args.cycle_seconds,12)

    def test_formal_under_half_hour_is_rejected(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            soak.parse_args(['--image','test','--out','unused','--seconds','1799','--cycle-seconds','150'])

    def test_formal_half_hour_with_only_six_cycles_is_rejected(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            soak.parse_args(['--image','test','--out','unused','--seconds','1800','--cycle-seconds','300'])

    def test_short_window_needs_calibration_mode(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            soak.parse_args(['--image','test','--out','unused','--seconds','10'])
        args=soak.parse_args(['--image','test','--out','unused','--mode','calibration','--seconds','10','--cycle-seconds','5'])
        self.assertEqual(args.mode,'calibration')
        self.assertEqual(soak.qualification_status('calibration',True),'CALIBRATION PASS')
        self.assertNotEqual(soak.qualification_status('calibration',True),'PASS')

    def test_fixed_arrivals_do_not_become_closed_loop(self):
        events=[]
        stop=threading.Event()
        scheduler=soak.ArrivalLedger(events.append,stop)
        start=time.monotonic()
        scheduler.add('query',.025,1,lambda n: (time.sleep(.08) or {'ok':True,'status':200}))
        scheduler.start(start,.15)
        time.sleep(.17)
        stop.set()
        scheduler.finish(.4)
        counts=soak.ledger_counts(events)['query']
        self.assertEqual(counts['planned'],6)
        self.assertGreater(counts['missed'],0)
        self.assertLess(counts['dispatched'],6)
        self.assertEqual(counts['planned'],counts['dispatched']+counts['missed'])
        self.assertEqual(counts['dispatched'],counts['terminal']+counts['inflight'])

    def test_late_terminal_keeps_natural_window_censor(self):
        events=[]
        stop=threading.Event()
        scheduler=soak.ArrivalLedger(events.append,stop)
        scheduler.add('query',1,1,lambda n: (time.sleep(.09) or {'ok':True,'status':200}))
        scheduler.start(time.monotonic(),.04)
        time.sleep(.05)
        stop.set()
        scheduler.finish(.3)
        terminal=[e for e in events if e['kind']=='request-terminal'][0]
        self.assertTrue(terminal['censoredNatural'])
        self.assertEqual(soak.ledger_counts(events)['query']['censored'],1)

    def test_reload_text_never_suppresses_failure(self):
        events=[{'kind':'request-terminal','lane':'mcp','ok':False,'status':503,'error':'upstream unavailable during reload','censoredNatural':False}]
        self.assertEqual(len(soak.request_failures(events)),1)

    def test_late_probe_is_still_part_of_budget(self):
        values=[{'status':200,'ms':10,'censoredNatural':False},
                {'status':200,'ms':2000,'censoredNatural':True}]
        result=soak.probe_statistics(values)
        self.assertEqual(result['p99Ms'],2000)
        self.assertEqual(result['maxMs'],2000)
        self.assertEqual(result['censoredNaturalCount'],1)

    def test_explicit_request_timeout_is_not_silently_capped(self):
        rig=object.__new__(soak.base.Rig)
        with mock.patch.object(soak.fx.Rig,'request',return_value={'ok':True}) as request:
            rig.request('http://test','/reload',timeout=90)
        self.assertEqual(request.call_args.args[5],90)

    def test_contract_seam_defaults_strict(self):
        result=soak.contract_failure_verdict({'machineReason':'EXECUTION_RUNTIME_RELOADING'},[])
        self.assertFalse(result['expected'])

    def test_rpc_product_reason_precedes_transport_code(self):
        response={'httpStatus':503,'body':{'error':{'code':-32003,'data':{'reason':'upstream_unavailable'}}}}
        self.assertEqual(soak.response_reason(response),'upstream_unavailable')

    def test_http_product_code_is_retained(self):
        response={'httpStatus':503,'body':{'error':{'code':'EXECUTION_RUNTIME_RELOADING'}}}
        self.assertEqual(soak.response_reason(response),'EXECUTION_RUNTIME_RELOADING')

    def test_transport_code_and_message_are_not_product_reasons(self):
        for code in [-32003,'-32003']:
            response={'httpStatus':503,'body':{'error':{'code':code,'message':'EXECUTION_RUNTIME_RELOADING'}}}
            self.assertIsNone(soak.response_reason(response))

    def test_tool_result_reason_is_retained(self):
        response={'httpStatus':200,'body':{'result':{'isError':True,'content':[{'type':'text','text':'{"reason":"question_budget_unavailable"}'}]}}}
        self.assertEqual(soak.response_reason(response),'question_budget_unavailable')

    def test_late_success_is_not_natural_success(self):
        events=[{'kind':'request-dispatched','lane':'mcp'},
                {'kind':'request-terminal','lane':'mcp','ok':True,'censoredNatural':True}]
        counts=soak.ledger_counts(events)['mcp']
        self.assertEqual(counts['succeeded'],1)
        self.assertEqual(counts['naturalSucceeded'],0)
        self.assertEqual(counts['censoredSucceeded'],1)

    def test_fresh_after_absolute_recovery_deadline_does_not_pass(self):
        class Clock:
            value=0
            def now(self):return self.value
        clock=Clock()
        class Rig:
            def health(self,timeout):
                clock.value+=.08
                return {'body':{'diagnostics':{'freshness':'fresh'}}}
            def diagnostic_inventory(self,known,timeout):
                self.timeout=timeout
                clock.value+=.04
                return {'workers':[],'gone':['p:1'],'serverPids':['3']}
        rig=Rig()
        result=soak.recover_diagnostic(rig,{'p:1'},{'p:1'},.1,now=clock.now,pause=lambda seconds:None)
        self.assertFalse(result['recovered'])
        self.assertLessEqual(rig.timeout,.021)
        self.assertGreater(result['finishedMonotonic'],result['deadlineMonotonic'])

    def test_overall_and_cleanup_budgets_are_distinct(self):
        args=soak.parse_args(['--image','test','--out','unused'])
        self.assertEqual(args.cleanup_seconds,90)

    def test_timeout_reaps_actual_child_process(self):
        started=time.monotonic()
        with self.assertRaises(TimeoutError):
            soak.run_owned_process([sys.executable,'-c','import time; time.sleep(20)'],timeout=.1)
        self.assertLess(time.monotonic()-started,3)

class OwnedGroupTerminationRegressions(unittest.TestCase):
    FORK = r"""
import os,signal,sys,time,pathlib,json
path=pathlib.Path(sys.argv[1]);child=os.fork()
if child==0:
 signal.signal(signal.SIGTERM,signal.SIG_IGN)
 fd=os.open(os.devnull,os.O_RDWR)
 os.dup2(fd,0);os.dup2(fd,1);os.dup2(fd,2);os.close(fd)
 path.write_text(json.dumps({'pid':os.getpid(),'pgid':os.getpgrp()}))
 while True:time.sleep(1)
while not path.exists():time.sleep(.001)
while True:time.sleep(1)
"""
    def alive(self,identity):
        try:return os.getpgid(identity['pid'])==identity['pgid']
        except ProcessLookupError:return False

    @contextlib.contextmanager
    def descendant(self):
        with tempfile.TemporaryDirectory(prefix='lucy-owned-group-test-') as folder:
            path=pathlib.Path(folder)/'identity.json'
            try:yield path
            finally:
                # Test-owned independent cleanup: a red test must not leak its counterexample.
                if path.exists():
                    identity=json.loads(path.read_text())
                    if self.alive(identity):
                        try:os.killpg(identity['pgid'],signal.SIGKILL)
                        except ProcessLookupError:pass
                    until=time.monotonic()+2
                    while self.alive(identity) and time.monotonic()<until:time.sleep(.01)
                    if self.alive(identity):raise AssertionError('test-owned descendant cleanup incomplete')

    def test_local_deadline_kills_redirected_term_ignoring_grandchild(self):
        with self.descendant() as path:
            with self.assertRaises(TimeoutError):
                soak.run_owned_process([sys.executable,'-c',self.FORK,str(path)],timeout=.3)
            identity=json.loads(path.read_text())
            self.assertFalse(self.alive(identity),'parent/pipe completion left the actual owned descendant alive')

    def test_remote_guard_never_reports_complete_with_redirected_survivor(self):
        ticket='uat-owned-group-test-'+secrets.token_hex(8)
        ticket_path=pathlib.Path('/tmp/lucy-core1883/exec-tickets')/(ticket+'.json')
        try:
            with self.descendant() as path:
                result=subprocess.run([sys.executable,'-c',soak.EXEC_GUARD,
                    json.dumps([sys.executable,'-c',self.FORK,str(path)]),'.3',ticket],
                    input='',capture_output=True,text=True,timeout=5)
                self.assertEqual(result.returncode,124)
                record=json.loads(ticket_path.read_text());identity=json.loads(path.read_text())
                self.assertFalse(self.alive(identity),'remote guard recorded complete while owned child survived')
                self.assertTrue(record['complete'])
        finally:ticket_path.unlink(missing_ok=True)

    def test_normal_parent_exit_cannot_hide_owned_background_descendant(self):
        normal=self.FORK.rsplit('\nwhile True:time.sleep(1)',1)[0]+'\n'
        with self.descendant() as path:
            with self.assertRaisesRegex(RuntimeError,'owned parent exited with descendants'):
                soak.run_owned_process([sys.executable,'-c',normal,str(path)],timeout=1)
            self.assertFalse(self.alive(json.loads(path.read_text())))

    def test_unverified_group_never_becomes_a_reaped_timeout_claim(self):
        process=mock.Mock();process.communicate.side_effect=subprocess.TimeoutExpired('owned',.1)
        with mock.patch.object(soak.subprocess,'Popen',return_value=process),mock.patch.object(soak,'terminate_owned_group',return_value=('', '', {'parentReaped':True,'groupAbsent':False})):
            with self.assertRaisesRegex(RuntimeError,'cleanup incomplete'):
                soak.run_owned_process(['fixture'],timeout=.1)

    def test_group_cleanup_does_not_signal_an_unrelated_owned_session(self):
        unrelated=subprocess.Popen([sys.executable,'-c','import time;time.sleep(20)'],start_new_session=True)
        try:
            with self.descendant() as path:
                with self.assertRaises(TimeoutError):
                    soak.run_owned_process([sys.executable,'-c',self.FORK,str(path)],timeout=.3)
                self.assertIsNone(unrelated.poll())
        finally:
            os.killpg(unrelated.pid,signal.SIGKILL);unrelated.wait(timeout=1)

    def test_remote_failed_absence_proof_stays_incomplete(self):
        ticket='uat-owned-group-negative-'+secrets.token_hex(8)
        ticket_path=pathlib.Path('/tmp/lucy-core1883/exec-tickets')/(ticket+'.json')
        seam="""
real_terminate=terminate_owned_group
def terminate_owned_group(process, deadline=None):
 out,err,proof=real_terminate(process,deadline)
 proof['groupAbsent']=False
 return out,err,proof
"""
        program=soak.EXEC_GUARD.replace('args=json.loads(sys.argv[1]);',seam+'\nargs=json.loads(sys.argv[1]);',1)
        try:
            with self.descendant() as path:
                result=subprocess.run([sys.executable,'-c',program,json.dumps([sys.executable,'-c',self.FORK,str(path)]),'.3',ticket],input='',capture_output=True,text=True,timeout=5)
                self.assertEqual(result.returncode,125)
                record=json.loads(ticket_path.read_text())
                self.assertFalse(record['complete']);self.assertFalse(record['groupTermination']['groupAbsent'])
                self.assertFalse(self.alive(json.loads(path.read_text())))
        finally:ticket_path.unlink(missing_ok=True)

class ContractClassificationRegressions(unittest.TestCase):
    def facts(self):
        args={'connectionId':soak.fx.CONN,'measures':[soak.fx.SOURCE+'.order_count',soak.fx.SOURCE+'.amount_sum']}
        fingerprint=soak.query_fingerprint(args)
        failure={'kind':'request-terminal','lane':'mcp','requestId':'mcp-1','status':503,'ok':False,'identity':'a','userId':'uat_zb_a','session':'independent-question-1','tokenHashPrefix':'sha256:abc','queryArguments':args,'problemFingerprint':fingerprint,'rpcId':1,
                 'receipt':{'httpStatus':503,'body':{'error':{'code':'EXECUTION_RUNTIME_RELOADING','requestId':'owner-1','deadlineAt':2000,'rejectedAt':1400}}}}
        owners=[{'kind':'reload-owner','owner':{'event':'acquire','requestId':'owner-1','deadlineAt':2000,'acquiredAt':'1970-01-01T00:00:01+00:00'}},
                {'kind':'reload-owner','owner':{'event':'release','requestId':'owner-1','deadlineAt':2000,'acquiredAt':'1970-01-01T00:00:01+00:00','releasedAt':'1970-01-01T00:00:01.500+00:00'}}]
        receipt={'httpStatus':200,'rpcId':4,'body':{'jsonrpc':'2.0','id':4,'result':{'content':[{'type':'text','text':'{"rows":[{"order_count":4,"amount_sum":100}]}'}]}}}
        recovery={'kind':'contract-recovery','originalRequestId':'mcp-1','ownerRequestId':'owner-1','identity':'a','userId':'uat_zb_a','session':'independent-question-1','tokenHashPrefix':'sha256:abc','scopeKey':'bq:uat_zb_a|sha256:abc:independent-question-1','problemFingerprint':fingerprint,'queryArguments':args,'startedAt':'1970-01-01T00:00:01.600+00:00','startedMonotonic':10,'finishedMonotonic':11,'deadlineMonotonic':12,'ok':True,'receipt':receipt,'initializeReceipt':{'httpStatus':200,'body':{}},'toolsReceipt':{'httpStatus':200,'body':{}}}
        proof={'kind':'contract-audit-proof','originalRequestId':'mcp-1','scopeKey':recovery['scopeKey'],'userId':'uat_zb_a','session':'independent-question-1','tokenHashPrefix':'sha256:abc','backupVerified':True,'rpcMatchesRecovery':True,'calls':1,'attempts':1,'queryRows':1,'successfulQueryRows':1,'validLinks':1,'wrongUsers':0,'missingTurns':0,'valid':True}
        return failure,owners+[recovery,proof]

    def test_strict_default_never_waives_reload_rejection(self):
        failure,events=self.facts()
        self.assertFalse(soak.contract_failure_verdict(failure,events)['expected'])

    def test_owner_bound_recovery_and_readonly_audit_proof_can_match_sc03(self):
        failure,events=self.facts()
        verdict=soak.contract_failure_verdict(failure,events,'p1-69')
        self.assertTrue(verdict['expected'])
        self.assertEqual(verdict['sc'],'SC-03')
        self.assertEqual(len(soak.request_failures([failure])),1)

    def test_unknown_upstream_code_is_never_waived(self):
        failure,events=self.facts()
        failure['receipt']['body']['error']['code']='upstream_unavailable'
        self.assertFalse(soak.contract_failure_verdict(failure,events,'p1-69')['expected'])

    def test_server_reject_timestamp_and_real_terminal_are_mandatory(self):
        for change in ['timestamp','late-release','missing-release']:
            failure,events=self.facts()
            if change=='timestamp':failure['receipt']['body']['error']['rejectedAt']=999
            if change=='late-release':events[1]['owner']['releasedAt']='1970-01-01T00:00:02.500+00:00'
            if change=='missing-release':events.pop(1)
            self.assertFalse(soak.contract_failure_verdict(failure,events,'p1-69')['expected'])

    def test_same_identity_question_and_session_are_required(self):
        for field,value in [('identity','b'),('session','new-session'),('problemFingerprint','different')]:
            failure,events=self.facts();events[2][field]=value
            self.assertFalse(soak.contract_failure_verdict(failure,events,'p1-69')['expected'])

    def test_zero_extra_budget_and_unique_effective_query_are_required(self):
        for field,value in [('calls',2),('attempts',2),('queryRows',2),('validLinks',0),('wrongUsers',1),('backupVerified',False),('rpcMatchesRecovery',False)]:
            failure,events=self.facts();events[3][field]=value
            self.assertFalse(soak.contract_failure_verdict(failure,events,'p1-69')['expected'])

    def test_recovery_after_shared_deadline_is_not_pass(self):
        failure,events=self.facts();events[2]['finishedMonotonic']=13
        self.assertFalse(soak.contract_failure_verdict(failure,events,'p1-69')['expected'])

    def test_owner_log_parser_accepts_only_exact_json_fact_lines(self):
        text='2026-11-20T00:00:00Z [lucy-reload] {"event":"acquire","requestId":"one"}\n'
        text+='user text [lucy-reload] {"event":"acquire","requestId":"fake"}\n'
        text+='[lucy-reload] {"event":"release","requestId":"one"} trailing garbage\n'
        self.assertEqual([v['requestId'] for v in soak.parse_reload_owner_logs(text)],['one'])

class AuditVerifierRegressions(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=str(pathlib.Path(self.tmp.name)/'audit.sqlite')
        self.db=sqlite3.connect(self.path)
        self.db.executescript("""
        CREATE TABLE access_log(id INTEGER PRIMARY KEY,user_id TEXT,ts TEXT,client TEXT);
        CREATE TABLE inferred_turns(inferred_turn_id TEXT PRIMARY KEY,user_id TEXT);
        CREATE TABLE inferred_turn_access_logs(inferred_turn_id TEXT,access_log_id INTEGER,PRIMARY KEY(inferred_turn_id,access_log_id));
        CREATE INDEX idx_ital_access_log ON inferred_turn_access_logs(access_log_id);
        CREATE TABLE inferred_rebuild_state(user_id TEXT PRIMARY KEY,status TEXT,watermark TEXT);
        INSERT INTO access_log VALUES(1,'a','2026-11-20T00:00:00Z','uat-core1883-history');
        INSERT INTO inferred_turns VALUES('t1','a');
        INSERT INTO inferred_turn_access_logs VALUES('t1',1);
        INSERT INTO inferred_rebuild_state VALUES('a','complete','1');
        """)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def verify(self):
        output=soak.run_owned_process([sys.executable,'-c',soak.AUDIT_VERIFY,self.path,'2026-10-20','1','3'],timeout=4)
        return json.loads(output)

    def test_consistent_backup_exports_double_hash_and_readable_rows(self):
        output=pathlib.Path(self.tmp.name)/'evidence.sqlite'
        result=json.loads(soak.run_owned_process([sys.executable,'-c',soak.AUDIT_BACKUP,self.path,str(output),'2026-10-20','3'],timeout=4))
        self.assertEqual(result['maxId'],1)
        import gzip,hashlib
        compressed=pathlib.Path(str(output)+'.gz').read_bytes()
        raw=gzip.decompress(compressed)
        self.assertEqual(hashlib.sha256(raw).hexdigest(),result['sqliteSha256'])
        self.assertEqual(hashlib.sha256(compressed).hexdigest(),result['gzipSha256'])
        readback=pathlib.Path(self.tmp.name)/'readback.sqlite';readback.write_bytes(raw)
        db=sqlite3.connect('file:'+str(readback)+'?mode=ro',uri=True)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM access_log').fetchone()[0],1)
        db.close()

    def test_contract_audit_requires_one_budget_and_one_effective_query(self):
        for name in ['lucy_session_id','token_hash_prefix','tool','outcome','generated_sql','query_operation','rpc_request_id','request_id']:
            self.db.execute('ALTER TABLE access_log ADD COLUMN '+name+' TEXT')
        self.db.execute("CREATE TABLE question_budget_state(scope_key TEXT PRIMARY KEY,calls INTEGER,attempts INTEGER)")
        self.db.execute("UPDATE access_log SET lucy_session_id='session-1',token_hash_prefix='sha256:abc',tool='lucy_query',outcome='ok',generated_sql='SELECT COUNT(*) FROM orders',request_id='2'")
        self.db.execute("INSERT INTO question_budget_state VALUES('bq:a|sha256:abc:session-1',1,1)")
        self.db.commit()
        recovery={'originalRequestId':'mcp-1','originalRpcId':1,'receipt':{'rpcId':2},'scopeKey':'bq:a|sha256:abc:session-1','userId':'a','session':'session-1','tokenHashPrefix':'sha256:abc'}
        output=pathlib.Path(self.tmp.name)/'contract.sqlite'
        metadata=json.loads(soak.run_owned_process([sys.executable,'-c',soak.AUDIT_BACKUP,self.path,str(output),'2026-10-20','3'],timeout=4))
        metadata['path']='contract.sqlite.gz'
        proof=soak.verify_contract_audit_copy(pathlib.Path(self.tmp.name),metadata,[recovery],3)[0]
        self.assertTrue(proof['valid'])
        self.assertEqual(proof['calls'],1)
        self.assertEqual(proof['queryRows'],1)
        self.assertEqual(proof['validLinks'],1)
        self.db.execute("UPDATE question_budget_state SET calls=2")
        self.db.commit()
        metadata=json.loads(soak.run_owned_process([sys.executable,'-c',soak.AUDIT_BACKUP,self.path,str(output),'2026-10-20','3'],timeout=4))
        metadata['path']='contract.sqlite.gz'
        proof=soak.verify_contract_audit_copy(pathlib.Path(self.tmp.name),metadata,[recovery],3)[0]
        self.assertFalse(proof['valid'])

    def _closed_contract_evidence(self,wal=False,folder=None):
        if wal:self.db.execute('PRAGMA journal_mode=WAL')
        for name in ['lucy_session_id','token_hash_prefix','tool','outcome','generated_sql','query_operation','rpc_request_id','request_id']:
            self.db.execute('ALTER TABLE access_log ADD COLUMN '+name+' TEXT')
        self.db.execute("CREATE TABLE question_budget_state(scope_key TEXT PRIMARY KEY,calls INTEGER,attempts INTEGER)")
        self.db.execute("UPDATE access_log SET lucy_session_id='session-1',token_hash_prefix='sha256:abc',tool='lucy_query',outcome='ok',generated_sql='SELECT COUNT(*) FROM orders',request_id='2'")
        self.db.execute("INSERT INTO question_budget_state VALUES('bq:a|sha256:abc:session-1',1,1)")
        self.db.commit()
        destination=pathlib.Path(folder or self.tmp.name);destination.mkdir(parents=True,exist_ok=True)
        output=destination/'snapshot.sqlite'
        metadata=json.loads(soak.run_owned_process([sys.executable,'-c',soak.AUDIT_BACKUP,self.path,str(output),'2026-10-20','3'],timeout=4))
        metadata['path']=output.name+'.gz'
        recovery={'originalRequestId':'mcp-1','originalRpcId':1,'receipt':{'rpcId':2},'scopeKey':'bq:a|sha256:abc:session-1','userId':'a','session':'session-1','tokenHashPrefix':'sha256:abc'}
        return destination,metadata,recovery

    def test_closed_wal_backup_can_be_verified_without_sidecars(self):
        root,metadata,recovery=self._closed_contract_evidence(wal=True)
        import gzip,hashlib
        archive=root/metadata['path'];before=hashlib.sha256(archive.read_bytes()).hexdigest()
        with gzip.open(archive,'rb') as stream:self.assertEqual(list(stream.read(20)[18:20]),[2,2])
        proof=soak.verify_contract_audit_copy(root,metadata,[recovery],3)[0]
        self.assertTrue(proof['valid'])
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(),before)
        self.assertFalse((root/'audit-evidence-readonly.sqlite-wal').exists())
        self.assertFalse((root/'audit-evidence-readonly.sqlite-shm').exists())

    def test_closed_snapshot_uri_escapes_hash_and_space_in_path(self):
        root,metadata,recovery=self._closed_contract_evidence(folder=pathlib.Path(self.tmp.name)/'closed # evidence')
        self.assertTrue(soak.verify_contract_audit_copy(root,metadata,[recovery],3)[0]['valid'])

    def test_snapshot_hash_mismatch_refuses_before_sqlite_open(self):
        root,metadata,recovery=self._closed_contract_evidence(wal=True)
        metadata['sqliteSha256']='0'*64
        with mock.patch.object(sqlite3,'connect') as connect:
            with self.assertRaisesRegex(AssertionError,'hash mismatch'):
                soak.verify_contract_audit_copy(root,metadata,[recovery],3)
        connect.assert_not_called()
        self.assertFalse((root/'audit-evidence-readonly.sqlite').exists())

    def test_valid_association_and_watermark(self):
        value=self.verify()
        self.assertTrue(value['complete'])
        self.assertEqual(value['historyRows'],1)
        self.assertEqual(value['pages'],1)

    def test_complete_label_does_not_hide_missing_link(self):
        self.db.execute('DELETE FROM inferred_turn_access_logs')
        self.db.commit()
        value=self.verify()
        self.assertFalse(value['complete'])
        self.assertEqual(value['missingLinks'],1)

    def test_wrong_user_or_duplicate_link_is_invalid(self):
        self.db.execute("INSERT INTO inferred_turns VALUES('other','b')")
        self.db.execute("INSERT INTO inferred_turn_access_logs VALUES('other',1)")
        self.db.commit()
        value=self.verify()
        self.assertFalse(value['complete'])
        self.assertEqual(value['duplicates'],1)
        self.assertEqual(value['wrongUsers'],1)

    def test_orphan_link_is_not_ignored_by_inner_join(self):
        self.db.execute("INSERT INTO inferred_turn_access_logs VALUES('missing',999)")
        self.db.commit()
        value=self.verify()
        self.assertFalse(value['complete'])
        self.assertEqual(value['orphanRawLinks'],1)
        self.assertEqual(value['orphanTurnLinks'],1)

    def test_stale_watermark_is_not_complete(self):
        self.db.execute("UPDATE inferred_rebuild_state SET watermark='0'")
        self.db.commit()
        value=self.verify()
        self.assertFalse(value['complete'])
        self.assertEqual(value['pendingUsers'],1)

class OwnerLogTimestampRegressions(unittest.TestCase):
    def line(self,prefix):
        return prefix+' [lucy-reload] {"event":"acquire","requestId":"owner","deadlineAt":1795167772557,"acquiredAt":"2026-11-20T09:41:52.578Z"}'

    def test_actual_docker_nanoseconds_are_kept(self):
        line=self.line('2026-11-20T09:41:52.578412635Z')
        self.assertEqual(len(soak.parse_reload_owner_logs(line)),1)

    def test_rfc3339_fraction_widths_and_timezone_are_validated(self):
        for fraction in ['', '.5', '.578', '.578412', '.578412635']:
            self.assertEqual(len(soak.parse_reload_owner_logs(self.line('2026-11-20T09:41:52'+fraction+'Z'))),1)
        self.assertEqual(len(soak.parse_reload_owner_logs(self.line('2026-11-20T17:41:52.578412635+08:00'))),1)

    def test_invalid_calendar_date_is_not_accepted(self):
        self.assertEqual(soak.parse_reload_owner_logs(self.line('2026-02-30T09:41:52.578412635Z')),[])

    def test_missing_or_invalid_timezone_is_not_accepted(self):
        for prefix in ['2026-11-20T09:41:52.578412635','2026-11-20T09:41:52.578412635+24:00','2026-11-20T09:41:52.578412635Zjunk']:
            self.assertEqual(soak.parse_reload_owner_logs(self.line(prefix)),[])

    def test_out_of_range_offset_minutes_are_not_silently_normalized(self):
        for offset in ['+00:60','+01:99','-00:60']:
            self.assertEqual(soak.parse_reload_owner_logs(self.line('2026-11-20T09:41:52.578412635'+offset)),[])

    def test_excess_fraction_precision_and_non_numeric_fraction_are_rejected(self):
        for fraction in ['.5784126350','.578x12635','..578']:
            self.assertEqual(soak.parse_reload_owner_logs(self.line('2026-11-20T09:41:52'+fraction+'Z')),[])

    def test_arbitrary_text_prefix_is_not_a_log_timestamp(self):
        self.assertEqual(soak.parse_reload_owner_logs(self.line('user content')),[])

    def test_trailing_json_garbage_is_still_rejected(self):
        self.assertEqual(soak.parse_reload_owner_logs(self.line('2026-11-20T09:41:52.578412635Z')+' garbage'),[])

    def test_internal_owner_milliseconds_use_exact_integer_arithmetic(self):
        value=soak.timestamp_ms('2026-11-20T09:41:52.578Z')
        self.assertIsInstance(value,int)
        self.assertEqual(value,1795167712578)
        self.assertEqual(value,soak.timestamp_ms('2026-11-20T17:41:52.578+08:00'))

    def test_exact_owner_boundary_not_transport_receipt_time(self):
        acquired='2026-11-20T09:41:52.578Z';release='2026-11-20T09:41:52.580Z'
        error={'code':'EXECUTION_RUNTIME_RELOADING','requestId':'owner','deadlineAt':1795167712590,'rejectedAt':1795167712578}
        failure={'lane':'mcp','status':503,'receipt':{'httpStatus':503,'body':{'error':error}}}
        events=[{'kind':'reload-owner','owner':{'event':'acquire','requestId':'owner','deadlineAt':error['deadlineAt'],'acquiredAt':acquired}},
                {'kind':'reload-owner','owner':{'event':'release','requestId':'owner','deadlineAt':error['deadlineAt'],'releasedAt':release}}]
        self.assertIsNotNone(soak.owned_reload_rejection(failure,events))
        error['rejectedAt']=1795167712577
        self.assertIsNone(soak.owned_reload_rejection(failure,events))


class ColumnOracleRegressions(unittest.TestCase):
    def verify(self,data,who='a',bound=False):
        receipt={'httpStatus':200,'body':{'result':{'content':[{'type':'text','text':json.dumps(data)}]}}}
        return soak.verify_query_response(receipt)

    def test_column_order_is_bound_to_headers(self):
        self.verify({'headers':['amount_sum','order_count'],'rows':[['100',4]]})

    def test_named_rows_and_requested_source_prefix_are_valid(self):
        self.verify({'rows':[{'amount_sum':'100.00','order_count':4}]})
        self.verify({'headers':['uat_begin_zero_orders.order_count','uat_begin_zero_orders.amount_sum'],'rows':[['4','1e2']]})
        self.verify({'data':{'headers':['order_count','amount_sum'],'rows':[[4,100]]}})

    def test_wrong_measure_values_are_not_accepted_as_an_unordered_set(self):
        for data in [
            {'headers':['order_count','amount_sum'],'rows':[[100,4]]},
            {'headers':['wrong_count','wrong_sum'],'rows':[[4,100]]},
            {'rows':[[4,100]]},
            {'headers':['order_count','order_count'],'rows':[[4,100]]},
            {'rows':[{'wrong_count':4,'wrong_sum':100}]},
            {'headers':['order_count','amount_sum','extra'],'rows':[[4,100,'ignored']]},
            {'headers':['order_count','amount_sum'],'rows':[[4,100,0]]},
            {'headers':['order_count','amount_sum'],'rows':[[True,100]]},
            {'headers':['order_count','amount_sum'],'rows':[['4.0000000000000001',100]]},
            {'headers':['order_count','amount_sum'],'rows':[[4,'NaN']]},
            {'headers':['order_count','amount_sum'],'rows':[[4,None]]},
            {'headers':['order_count','amount_sum'],'rows':[[4,100],[4,100]]},
            {'headers':['order_count','amount_sum'],'rows':[{'amount_sum':100,'wrong':4}]},
            {'headers':['order_count','uat_begin_zero_orders.order_count'],'rows':[[4,100]]},
            {'headers':['other_source.order_count','amount_sum'],'rows':[[4,100]]},
            {'headers':['order_count','amount_sum'],'rows':{'headers':['amount_sum','order_count'],'rows':[[4,100]]}}

        ]:
            with self.subTest(data=data),self.assertRaises(AssertionError):self.verify(data)

if __name__=='__main__':unittest.main()
