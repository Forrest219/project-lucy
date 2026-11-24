#!/usr/bin/env python3
"""Fixture-only MySQL readiness regressions: never execute Docker or business SQL."""
import importlib.util
import json
import pathlib
import subprocess
import unittest
from unittest import mock

TARGET=pathlib.Path(__file__).with_name('verify-begin-zero-binding.py')
spec=importlib.util.spec_from_file_location('fixture_helper',TARGET)
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)

class MysqlTcpReadinessRegressions(unittest.TestCase):
    def readiness(self,receipts,deadline=3):
        clock=[0.0];calls=[]
        def execute(command,**options):
            calls.append((command,options));clock[0]+=.1
            value=receipts[min(len(calls)-1,len(receipts)-1)]
            if isinstance(value,Exception):raise value
            return subprocess.CompletedProcess(command,value[0],value[1],value[2] if len(value)>2 else '')
        value=helper.wait_fixture_mysql_tcp_ready('owned-test-db',deadline,clock=lambda:clock[0],pause=lambda seconds:clock.__setitem__(0,clock[0]+seconds),execute=execute)
        return value,calls

    def test_bootstrap_socket_ping_cannot_certify_tcp_readiness(self):
        value,calls=self.readiness([(0,'mysqld is alive'),(1,''),(0,'1\n')])
        self.assertTrue(value['ready']);self.assertEqual(len(calls),3)
        for command,options in calls:
            self.assertEqual(command[:3],['docker','exec','owned-test-db'])
            self.assertIn('--protocol=TCP -h127.0.0.1',command[-1])
            self.assertIn('SELECT 1',command[-1]);self.assertNotIn('mysqladmin',command[-1]);self.assertNotIn('CREATE',command[-1])

    def test_tcp_readiness_requires_exit_zero_and_exact_select_result(self):
        value,calls=self.readiness([(1,'1'),(0,'1\n2'),(0,'1')])
        self.assertTrue(value['ready']);self.assertEqual(len(calls),3)

    def test_readiness_deadline_is_not_restarted_for_failed_attempts(self):
        value,calls=self.readiness([(1,'')],deadline=.2)
        self.assertFalse(value['ready']);self.assertEqual(value['deadlineMonotonic'],.2)
        self.assertEqual(len(calls),1);self.assertLessEqual(calls[0][1]['timeout'],.2)

    def test_success_after_absolute_deadline_is_not_ready(self):
        value,calls=self.readiness([(0,'1')],deadline=.05)
        self.assertFalse(value['ready']);self.assertEqual(len(calls),1)

    def test_only_tcp_select_is_retried_after_probe_timeout(self):
        value,calls=self.readiness([subprocess.TimeoutExpired('tcp-select',.1),(0,'1')])
        self.assertTrue(value['ready']);self.assertEqual(len(calls),2)
        self.assertTrue(value['attempts'][0]['timedOut'])
        self.assertTrue(all('SELECT 1' in command[-1] for command,_ in calls))

    def rig_before_initialization(self):
        rig=object.__new__(helper.Rig)
        rig.seed=mock.Mock(return_value=('private-boot','private-db-env'))
        rig.data_volume='owned-data';rig.network='owned-network';rig.db='owned-db';rig.created=[];rig.dbpass='fixture-only'
        rig.save=mock.Mock();rig.sql=mock.Mock(side_effect=RuntimeError('single CREATE entered'))
        return rig

    def test_initial_create_is_called_once_after_readiness_not_replayed(self):
        rig=self.rig_before_initialization()
        with mock.patch.object(helper,'run',return_value=''),mock.patch.object(helper,'wait_fixture_mysql_tcp_ready',return_value={'ready':True,'attempts':[]}):
            with self.assertRaisesRegex(RuntimeError,'single CREATE entered'):rig.start()
        self.assertEqual(rig.sql.call_count,1)
        self.assertTrue(rig.sql.call_args.args[0].startswith('CREATE DATABASE uat; CREATE TABLE uat.'+helper.SOURCE+'('))

    def test_no_initial_create_or_other_sql_when_readiness_fails(self):
        rig=self.rig_before_initialization()
        with mock.patch.object(helper,'run',return_value=''),mock.patch.object(helper,'wait_fixture_mysql_tcp_ready',return_value={'ready':False,'attempts':[]}):
            with self.assertRaisesRegex(RuntimeError,'mysql readiness timeout'):rig.start()
        rig.sql.assert_not_called()


class ColumnOracleRegressions(unittest.TestCase):
    def verify(self,data,who='a',bound=False):
        receipt={'httpStatus':200,'body':{'result':{'content':[{'type':'text','text':json.dumps(data)}]}}}
        rig=object.__new__(helper.Rig);rig.call=mock.Mock(return_value=receipt);rig.save=mock.Mock();return rig.query('column-oracle',who=who,bound=bound)

    def test_column_order_is_bound_to_headers(self):
        self.verify({'headers':['amount_sum','order_count'],'rows':[['100',4]]})

    def test_named_rows_and_requested_source_prefix_are_valid(self):
        self.verify({'rows':[{'amount_sum':'100.00','order_count':4}]})
        self.verify({'headers':['uat_begin_zero_orders.order_count','uat_begin_zero_orders.amount_sum'],'rows':[['4','1e2']]})
        self.verify({'data':{'headers':['order_count','amount_sum'],'rows':[[4,100]]}})

    def test_bound_and_rls_oracles_keep_their_named_meaning(self):
        self.verify({'headers':['amount_sum','order_count'],'rows':[[30,'2']]},who='b')
        self.verify({'rows':[{'order_count':'4'}]},bound=True)
        self.verify({'headers':['order_count'],'rows':[[2]]},who='b',bound=True)
        for data,who,bound in [
            ({'rows':[{'order_count':30,'amount_sum':2}]},'b',False),
            ({'rows':[{'order_count':4,'amount_sum':100}]},'a',True),
            ({'rows':[{'amount_sum':4}]},'a',True)
        ]:
            with self.subTest(data=data),self.assertRaises(AssertionError):self.verify(data,who=who,bound=bound)

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
