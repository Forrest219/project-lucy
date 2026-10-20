"""Synthetic cluster reads + real Helm/kubectl client rendering; NOT a K3s test.

Developer-only fixture. Never shipped as the customer deployment entry.
The localhost API serves discovery GETs only and rejects every write.
"""
import contextlib
import http.server
import json
import os
from pathlib import Path
import shutil
import sys
import threading


@contextlib.contextmanager
def discovery(root):
    requests = []
    resources = {
        'v1': [('Service', 'services'), ('PersistentVolumeClaim', 'persistentvolumeclaims'),
               ('Secret', 'secrets'), ('ServiceAccount', 'serviceaccounts'), ('ConfigMap', 'configmaps')],
        'apps/v1': [('Deployment', 'deployments')],
        'networking.k8s.io/v1': [('Ingress', 'ingresses')],
    }
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            path = self.path.split('?')[0]
            requests.append(('GET', path))
            if path == '/api':
                body = {'kind': 'APIVersions', 'apiVersion': 'v1', 'versions': ['v1']}
            elif path == '/apis':
                body = {'kind': 'APIGroupList', 'apiVersion': 'v1', 'groups': [
                    {'name': g, 'versions': [{'groupVersion': g + '/v1', 'version': 'v1'}],
                     'preferredVersion': {'groupVersion': g + '/v1', 'version': 'v1'}}
                    for g in ['apps', 'networking.k8s.io']]}
            else:
                version = path.removeprefix('/apis/').removeprefix('/api/')
                if version not in resources:
                    self.send_error(404)
                    return
                body = {'kind': 'APIResourceList', 'apiVersion': 'v1', 'groupVersion': version,
                        'resources': [{'kind': k, 'name': n, 'singularName': '', 'namespaced': True,
                                       'verbs': ['get', 'list', 'create']} for k, n in resources[version]]}
            encoded = json.dumps(body).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_POST(self):
            requests.append(('POST', self.path))
            self.send_error(405)

        do_PUT = do_PATCH = do_DELETE = do_POST

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    kubeconfig = root / 'kubeconfig.json'
    kubeconfig.write_text(json.dumps({'apiVersion': 'v1', 'kind': 'Config',
        'clusters': [{'name': 'fixture', 'cluster': {'server': 'http://127.0.0.1:' + str(server.server_port)}}],
        'contexts': [{'name': 'fixture', 'context': {'cluster': 'fixture', 'user': 'fixture'}}],
        'users': [{'name': 'fixture', 'user': {}}], 'current-context': 'fixture'}))
    try:
        yield kubeconfig, requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def fixture_environment(root, config, deployment, pvc, old_values, kubeconfig):
    """Cluster reads are synthetic. Lint/template and create --dry-run use real CLIs."""
    state = {'config': config, 'deployment': deployment, 'pvc': pvc, 'values': old_values,
             'kubectl': shutil.which('kubectl'), 'helm': shutil.which('helm'), 'root': str(root)}
    assert state['kubectl'] and state['helm'], 'helm and kubectl required on verification host'
    state_file = root / 'fixture.json'
    state_file.write_text(json.dumps(state))
    bindir = root / 'bin'
    bindir.mkdir()
    for tool in ['kubectl', 'helm']:
        target = bindir / tool
        target.write_text('#!' + sys.executable + '\nimport os, runpy\nos.environ["LUCY_FIXTURE_TOOL"] = '
                          + repr(tool) + '\nrunpy.run_path('
                          + repr(str(Path(__file__).resolve())) + ', run_name="__main__")\n')
        target.chmod(0o700)
    env = {**os.environ, 'PATH': str(bindir) + os.pathsep + os.environ['PATH'],
           'KUBECONFIG': str(kubeconfig), 'LUCY_FIXTURE_STATE': str(state_file)}
    env.pop('PYTHONDONTWRITEBYTECODE', None)
    return env


def main():
    state = json.loads(Path(os.environ['LUCY_FIXTURE_STATE']).read_text())
    args = sys.argv[1:]
    tool = os.environ['LUCY_FIXTURE_TOOL']
    clean = list(args)
    for flag in ['--context', '--kube-context', '-n']:
        if flag in clean:
            i = clean.index(flag)
            del clean[i:i + 2]
    c = state['config']
    with (Path(state['root']) / 'calls.jsonl').open('a') as log:
        log.write(json.dumps({'tool': tool, 'operation': clean[:2]}) + '\n')
    if tool == 'helm':
        if clean[0] in ['lint', 'template']:
            os.execv(state['helm'], [state['helm'], *args])
        if clean[:1] == ['list']:
            result = [{'name': c['release'], 'status': 'deployed', 'revision': '14'}]
        elif clean[:2] == ['get', 'values']:
            result = state['values']
        else:
            raise RuntimeError('unexpected helm operation in dry-run')
    elif clean == ['config', 'current-context']:
        print('fixture')
        return
    elif clean[:1] == ['create'] and '--dry-run=client' in clean:
        os.execv(state['kubectl'], [state['kubectl'], *args])
    elif clean[:1] == ['exec']:
        # The auth-state probe is independently tested; this is a synthetic old cluster.
        sys.stdin.buffer.read()
        result = {'status': 'uninitialized', 'bootstrap': 'legacy-absent',
                  'administrators': 0, 'fingerprint': 'synthetic'}
    elif clean[:2] == ['auth', 'can-i']:
        print('yes')
        return
    elif clean[:1] == ['get']:
        kind, name = clean[1], clean[2] if len(clean) > 2 else ''
        if kind == 'namespace':
            result = {'metadata': {'uid': 'fixture-cluster' if name == 'kube-system' else c['namespaceUid']}}
        elif kind == 'deployment':
            result = state['deployment']
        elif kind == 'pvc':
            result = state['pvc']
        elif kind == 'secret':
            result = None if name == c['bootstrapSecret'] else {'metadata': {'name': name}}
        elif kind == 'pods':
            result = {'items': [{'metadata': {'name': 'fixture-old'}, 'status': {'phase': 'Running'},
                                 'spec': {'nodeName': 'fixture-node'}}]}
        elif kind == 'nodes':
            result = {'items': [{'metadata': {'name': 'fixture-node'}, 'spec': {},
                'status': {'nodeInfo': {'architecture': 'amd64', 'operatingSystem': 'linux'},
                           'conditions': [{'type': 'Ready', 'status': 'True'}]}}]}
        else:
            raise RuntimeError('unexpected get kind')
    else:
        raise RuntimeError('unexpected kubectl operation in dry-run')
    if result is not None:
        print(json.dumps(result))


if __name__ == '__main__':
    main()
