#!/usr/bin/env python3
"""Exercise Secret create/compare against an explicitly chosen disposable Kubernetes namespace."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import uuid

module_spec = importlib.util.spec_from_file_location('customer_deploy', Path(__file__).with_name('customer-deployment-helper.py'))
mod = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(mod)


def validate(context):
    instance = 'bootstrap-test-' + uuid.uuid4().hex[:12]
    namespace = instance
    d = object.__new__(mod.Deployment)
    d.c = {'context': context, 'namespace': namespace, 'instanceId': instance, 'bootstrapSecret': 'lucy-bootstrap'}
    d.key = os.urandom(32).hex().encode() + b'\n'
    d.needs_key = True
    created = False
    try:
        body = {'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': namespace, 'labels': {'lucy.io/instance-id': instance}}}
        d.kubectl('create', '-f', '-', data=json.dumps(body).encode())
        created = True
        d.create_secret()
        original = d.get('secret', 'lucy-bootstrap')
        version = original['metadata']['resourceVersion']
        d.create_secret()
        assert d.get('secret', 'lucy-bootstrap')['metadata']['resourceVersion'] == version
        d.key = os.urandom(32).hex().encode() + b'\n'
        try:
            d.create_secret()
            raise AssertionError('conflicting key was accepted')
        except mod.DeploymentError as error:
            assert str(error) == 'BOOTSTRAP_SECRET_CONFLICT'
        assert d.get('secret', 'lucy-bootstrap')['metadata']['resourceVersion'] == version
        denied = d.command(['kubectl', '--context', context, '-n', namespace, '--as=system:serviceaccount:' + namespace + ':default', 'get', 'secret', 'lucy-bootstrap', '-o', 'json'], allow_failure=True)
        assert denied.returncode != 0
        return {'status': 'PASSED', 'scope': 'live Kubernetes Secret API; not workload deployment', 'context': context, 'checks': ['atomic-create', 'same-key-reuse-without-version-change', 'different-key-refused-without-update', 'unprivileged-read-denied']}
    finally:
        if created:
            ns = d.get('namespace', namespace)
            if ns and ns['metadata'].get('labels', {}).get('lucy.io/instance-id') == instance:
                d.kubectl('delete', 'namespace', namespace, '--wait=false')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--context', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    try:
        result = validate(args.context)
        file = Path(args.out)
        mod.save_private(file, result)
        print(json.dumps(result))
    except Exception:
        print('Live Secret validation failed; no credentials are printed.')
        raise SystemExit(1)
