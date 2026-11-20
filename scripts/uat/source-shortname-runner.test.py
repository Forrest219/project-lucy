"""Regression tests for the UAT oracle; no Docker or credentials required."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('shortname_runner', pathlib.Path(__file__).with_name('reproduce-source-shortname-conflict.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def response(status, code=None):
    return {'httpStatus': status, 'body': {'ok': code is None, 'data': {'uploaded': code is None}, 'error': {'code': code}}}


class RaceOracleTests(unittest.TestCase):
    def test_duplicate_is_required_for_a_nonbusy_loser(self):
        self.assertEqual(runner.classify_race_responses([response(200), response(400, 'DUPLICATE_SOURCE_NAME')]), (1, False))

    def test_only_named_busy_can_trigger_a_postwindow_retry(self):
        self.assertEqual(runner.classify_race_responses([response(500, 'PUBLISH_COORDINATOR_BUSY'), response(200)]), (0, True))

    def test_arbitrary_5xx_and_unrelated_4xx_are_failures(self):
        for status, code in [(500, 'INTERNAL_SERVER_ERROR'), (503, 'UNAVAILABLE'), (400, 'INVALID_MANIFEST'), (409, 'OTHER_CONFLICT')]:
            with self.subTest(status=status, code=code):
                with self.assertRaises(RuntimeError):
                    runner.classify_race_responses([response(200), response(status, code)])

    def test_both_successful_or_both_failed_is_not_a_pass(self):
        for pair in [[response(200), response(200)], [response(400, 'DUPLICATE_SOURCE_NAME'), response(500, 'PUBLISH_COORDINATOR_BUSY')]]:
            with self.assertRaises(RuntimeError):
                runner.classify_race_responses(pair)


class BeginContractTests(unittest.TestCase):
    def test_only_hidden_begin_with_exact_contract_reason_is_expected(self):
        results = {'tools-list': {'body': {'result': {'tools': []}}},
                   'begin': {'httpStatus': 200, 'body': {'result': {'isError': True, 'data': {'reason': 'begin_not_available'}}}}}
        self.assertTrue(runner.expected_inactive_begin(results, 'begin'))
        self.assertFalse(runner.expected_inactive_begin(results, 'query'))
        results['tools-list']['body']['result']['tools'] = [{'name': 'lucy_begin_question'}]
        self.assertFalse(runner.expected_inactive_begin(results, 'begin'))
        results['tools-list']['body']['result']['tools'] = []
        results['begin']['body']['result']['data']['reason'] = 'source_map_compile_failed'
        self.assertFalse(runner.expected_inactive_begin(results, 'begin'))


if __name__ == '__main__':
    unittest.main()
