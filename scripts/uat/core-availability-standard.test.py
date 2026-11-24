"""Regression tests for independently verifiable gateway and evidence bindings."""
import hashlib
import http.server
import json
import pathlib
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent


def load(name):
    path = HERE/name
    namespace = {'__file__':str(path), '__name__':'uat_test_import'}
    exec(compile(path.read_bytes(),str(path),'exec'),namespace)
    return namespace


gateway = load('core-availability-gateway.py')
verify = load('core-availability-verify.py')


class GatewayTests(unittest.TestCase):
    def setUp(self):
        class Upstream(http.server.BaseHTTPRequestHandler):
            def log_message(self,*_):
                pass

            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Type','application/json')
                self.end_headers()
                self.wfile.write(b'{"upstream":true}')

        self.upstream = http.server.ThreadingHTTPServer(('127.0.0.1',0),Upstream)
        self.thread = threading.Thread(target=self.upstream.serve_forever,daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_upstream)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.raw = pathlib.Path(self.directory.name)/'gateway.jsonl'
        url = 'http://127.0.0.1:'+str(self.upstream.server_port)
        self.proxy = gateway['Gateway'](url,url,self.raw,1)
        self.addCleanup(self.proxy.close)

    def stop_upstream(self):
        if self.thread.is_alive():
            self.upstream.shutdown()
            self.upstream.server_close()
            self.thread.join()

    def read(self, hop):
        request = urllib.request.Request(self.proxy.url+'/api/readyz',
                                         headers={gateway['HOP']:hop,'Authorization':'Bearer fixture'})
        client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            response = client.open(request,timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status,response.read()

    def test_live_upstream_and_actual_connection_failure_are_distinct(self):
        self.assertEqual(self.read('accepted'),(200,b'{"upstream":true}'))
        self.stop_upstream()
        status,body = self.read('unavailable')
        self.assertEqual(status,503)
        self.assertIn(b'Service Unavailable',body)
        content = self.raw.read_text()
        facts = [json.loads(line) for line in content.splitlines()]
        self.assertEqual([(row['id'],row['outcome']) for row in facts],
                         [('accepted','forwarded'),('unavailable','upstream-error')])
        self.assertNotIn('Bearer',content)


class VerificationTests(unittest.TestCase):
    def test_sealed_evidence_rejects_changed_raw_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            raw = root/'events.jsonl'
            raw.write_text('original')
            manifest = {'events.jsonl':hashlib.sha256(b'original').hexdigest()}
            (root/'evidence-sha256.json').write_text(json.dumps(manifest))
            verify['verify_manifest'](root)
            raw.write_text('changed')
            with self.assertRaisesRegex(ValueError,'evidence hash mismatch'):
                verify['verify_manifest'](root)

    def test_independent_recount_rejects_proxy_bypass_and_status_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            preflight = {'gatewayReady':{'gatewayHopId':'ready','httpStatus':200},
                         'gatewayHttp':{'gatewayHopId':'project','httpStatus':200}}
            (root/'gateway-preflight.json').write_text(json.dumps(preflight))
            rows = [
                {'id':'ready','method':'GET','path':'/api/readyz','status':200,'outcome':'forwarded'},
                {'id':'project','method':'GET','path':'/api/project','status':200,'outcome':'forwarded'},
                {'id':'wrong-status','method':'POST','path':'/mcp','status':503,'outcome':'upstream-error'},
            ]
            (root/'gateway.jsonl').write_text('\n'.join(json.dumps(row) for row in rows))
            events = [
                {'kind':'request-terminal','lane':'http','requestId':'http-0','ok':True,
                 'receipt':{'httpStatus':200}},
                {'kind':'request-terminal','lane':'mcp','requestId':'mcp-0','ok':True,
                 'receipt':{'httpStatus':200,'gatewayHopId':'wrong-status'}},
            ]
            issues = []
            verify['gateway_receipts'](root,events,root,issues)
            self.assertEqual(issues,['http-0 gateway receipt not attributable','mcp-0 gateway receipt not attributable'])

    def test_formal_gate_needs_full_cycles_and_frozen_minimum_duration(self):
        self.assertTrue(verify['formal_window_valid'](1800,150))
        self.assertFalse(verify['formal_window_valid'](1800,151))
        self.assertFalse(verify['formal_window_valid'](1799,140))
        self.assertFalse(verify['formal_window_valid'](7200,600))


if __name__ == '__main__':
    unittest.main()
