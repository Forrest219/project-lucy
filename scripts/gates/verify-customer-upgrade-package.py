#!/usr/bin/env python3
"""Final-archive regression. Synthetic cluster reads; real Helm/kubectl rendering.

This is a mandatory LOCAL gate, never proof of a native amd64 K3s upgrade.
Optional --instance-dir also executes the real customer's read-only preflight.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import re
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tarfile
import tempfile

sys.dont_write_bytecode = True
from customer_deployment_fixture import discovery, fixture_environment


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        codes = re.findall(rb'\[customer-deploy\] ([A-Z][A-Z0-9_]+)', result.stderr)
        raise RuntimeError('COMMAND_FAILED:' + Path(args[0]).name + ':' + ','.join(c.decode() for c in codes))
    return result.stdout


def objects(output):
    decoder, text, result = json.JSONDecoder(), output.decode().strip(), []
    while text:
        obj, end = decoder.raw_decode(text)
        result.extend(obj['items'] if obj.get('kind') == 'List' else [obj])
        text = text[end:].lstrip()
    return result


def verify(archive, report_path, instance_dir=None):
    report = {'schemaVersion': 1, 'package': archive.name, 'packageSha256': sha(archive),
              'localGate': 'RUNNING', 'nativeAmd64UpgradeAndRecovery': 'PENDING_DEPLOYER_ACCEPTANCE',
              'productionReady': False, 'scope': 'synthetic cluster reads; real helm and kubectl client rendering'}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        report['tools'] = {'kubectl': json.loads(run(['kubectl', 'version', '--client', '-o', 'json']))['clientVersion']['gitVersion'],
                           'helm': run(['helm', 'version', '--short']).decode().strip(), 'python': sys.version.split()[0]}
        require(report['packageSha256'] == Path(str(archive) + '.sha256').read_text().split()[0], 'OUTER_CHECKSUM')
        with tempfile.TemporaryDirectory(prefix='lucy-final-archive-') as raw:
            root = Path(raw).resolve()
            with tarfile.open(archive, 'r:gz') as tar:
                members = tar.getmembers()
                for member in members:
                    path = PurePosixPath(member.name)
                    require((member.isfile() or member.isdir()) and not path.is_absolute()
                            and '..' not in path.parts, 'ARCHIVE_SPECIAL_PATH')
                    require(not any(p.startswith('._') or p in {'.DS_Store', '__MACOSX', '__pycache__', '.git', 'credentials'}
                                    or p.endswith(('.pyc', '.pyo')) for p in path.parts), 'ARCHIVE_JUNK_OR_CREDENTIAL')
                require(len({PurePosixPath(m.name).parts[0] for m in members}) == 1, 'ARCHIVE_ROOT_COUNT')
                tar.extractall(root)
            base = next(root.iterdir())
            sums = {}
            for line in (base / 'SHA256SUMS').read_text().splitlines():
                expected, name = line.split(maxsplit=1)
                name = name.removeprefix('./')
                require(name not in sums and not Path(name).is_absolute() and '..' not in Path(name).parts, 'CHECKSUM_PATH')
                sums[name] = expected
            require({str(f.relative_to(base)) for f in base.rglob('*') if f.is_file()} == set(sums) | {'SHA256SUMS'}, 'UNTRACKED_FILE')
            require(all(sha(base / name) == value for name, value in sums.items()), 'INNER_CHECKSUM')
            build = json.loads((base / 'BUILD-INFO.json').read_text())
            require(build['git']['dirty'] is False and build['image']['platform'] == 'linux/amd64', 'CLEAN_AMD64_BUILD_REQUIRED')
            report.update(git=build['git'], image=build['image'], chart=build['chart'], innerFilesVerified=len(sums),
                          baseChecksumDigest=sha(base / 'SHA256SUMS'))
            cert = root / 'synthetic-ca.pem'
            run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Lucy Fixture CA',
                 '-keyout', str(root / 'synthetic-ca.key'), '-out', str(cert)])
            keys, accesses = [], []
            with discovery(root) as (kubeconfig, requests):
                env_real = {**os.environ, 'KUBECONFIG': str(kubeconfig)}
                real_kubectl = shutil.which('kubectl')
                # A real kubectl handles all six resource kinds, including a synthetic Secret.
                kinds = [('v1', k) for k in ['Service', 'PersistentVolumeClaim', 'Secret', 'ServiceAccount', 'ConfigMap']]
                kinds.append(('apps/v1', 'Deployment'))
                documents = [{'apiVersion': v, 'kind': k, 'metadata': {'name': 'fixture-' + k.lower()}} for v, k in kinds]
                stream = run([real_kubectl, '--context', 'fixture', 'create', '--dry-run=client', '--validate=false', '-f', '-', '-o', 'json'],
                             input='\n---\n'.join(json.dumps(x) for x in documents).encode(), env=env_real)
                require(len(objects(stream)) == 6, 'REAL_KUBECTL_MULTI_RESOURCE')
                for access in ['http', 'https']:
                    config = json.loads((base / f'examples/instance.upgrade.{access}.example.json').read_text())
                    config.update(instanceId='fixture-customer', context='fixture', namespaceUid='fixture-ns',
                        deploymentUid='fixture-deploy', pvcUid='fixture-pvc', baselineImage='project-lucy:fixture-0.17.0',
                        legacyBaselineReviewed=True, webuiUrl=f'{access}://fixture.invalid:8276',
                        publicMcpUrl=f'{access}://fixture.invalid:8277/mcp', offlineNodes={'fixture-node': 'local'})
                    if access == 'https':
                        config['pvcName'] = config['deployment'] + '-data'
                    config['recovery'] = {'baselineImage': config['baselineImage'], 'instructionsFile': str(base / 'examples/RECOVERY.open-mode.md')}
                    if access == 'https':
                        config.update(tlsCaFile=cert.name, externalTlsReviewed=True, credentialState='issued')
                        # The shipped example keeps operator placeholders. This synthetic
                        # run supplies the only content root and trust-proxy pair the
                        # upgrade entry accepts. 192.0.2.0/24 is documentation space.
                        config.setdefault('values', {}).setdefault('env', {}).update({
                            'LUCY_CONTENT_ROOT': '.',
                            'LUCY_TRUST_PROXY': '1',
                            'LUCY_TRUSTED_PROXY_CIDRS': '192.0.2.0/24',
                        })
                    config_file = root / (access + '.json')
                    config_file.write_text(json.dumps(config))
                    output = root / (access + '-delivery')
                    result = json.loads(run(['python3', str(base / 'scripts/prepare-customer-instance.py'),
                        '--base-package', str(base), '--instance-config', str(config_file),
                        '--state-dir', str(root / 'private-state'), '--output', str(output)]))
                    key_file = output / 'credentials/webui-bootstrap-token'
                    keys.append(key_file.read_bytes())
                    require(len(keys[-1]) == 65 and key_file.stat().st_mode & 0o777 == 0o600, 'PRIVATE_KEY_FORMAT')
                    if access == 'https':
                        require(result['credentialReused'] and keys[0] == keys[1], 'KEY_REUSE')
                        require((output / 'tls-ca.pem').read_bytes() == cert.read_bytes(), 'CA_DELIVERY')
                    delivered = json.loads((output / 'instance.json').read_text())
                    # Simulate the old release's values/resources, not an actual old running pod.
                    old_values = {'fullnameOverride': config['deployment'], 'existingSecret': 'fixture-db',
                        'env': {'LUCY_PUBLIC_MCP_URL': config['publicMcpUrl']}, 'security': {'access': access},
                        'service': {'type': 'LoadBalancer', 'webuiPort': 8276, 'mcpPort': 8277}}
                    if access == 'http':
                        old_values['persistence'] = {'existingClaim': config['pvcName']}
                    values_file = root / (access + '-old-values.json')
                    values_file.write_text(json.dumps(old_values))
                    manifest = run(['helm', 'template', config['release'], str(base / 'helm/lucy'), '-f', str(values_file)])
                    rendered = objects(run([real_kubectl, '--context', 'fixture', 'create', '--dry-run=client', '--validate=false',
                                            '-f', '-', '-o', 'json'], input=manifest, env=env_real))
                    service = next(x for x in rendered if x['kind'] == 'Service')
                    require({p['port'] for p in service['spec']['ports']} == {8276, 8277}, 'FIXTURE_PUBLIC_PORTS')
                    dep = next(x for x in rendered if x['kind'] == 'Deployment')
                    pvc = next((x for x in rendered if x['kind'] == 'PersistentVolumeClaim'),
                               {'metadata': {'name': config['pvcName']}, 'spec': {'accessModes': ['ReadWriteOnce']}})
                    dep['metadata'].update(uid=config['deploymentUid'], annotations={'meta.helm.sh/release-name': config['release']})
                    dep['spec']['template']['spec']['containers'][0]['image'] = config['baselineImage']
                    pvc['metadata']['uid'] = config['pvcUid']
                    fixture_root = root / (access + '-fixture')
                    fixture_root.mkdir()
                    env = fixture_environment(fixture_root, delivered, dep, pvc, old_values, kubeconfig)
                    entry = ['bash', str(output / 'scripts/deploy.sh'), '--dry-run']
                    stdout = run(entry, cwd='/', env=env).decode()
                    require(json.loads(stdout.splitlines()[-1])['status'] == 'DRY_RUN', 'ENTRY_DRY_RUN')
                    require(not (output / '.deployment').exists() and not (output / '.deployment-binding.json').exists(), 'DRY_RUN_SIDE_EFFECT')
                    # File tampering, re-checksumming, and untracked files must all remain rejected.
                    package = output / 'package'
                    target = package / 'scripts/customer-deployment-helper.py'
                    original = target.read_bytes()
                    target.write_bytes(original + b'\n# synthetic tamper\n')
                    bad = subprocess.run(entry, cwd='/', env=env, capture_output=True)
                    require(bad.returncode != 0 and b'PACKAGE_CHECKSUM_MISMATCH' in bad.stderr, 'TAMPER_NOT_REJECTED')
                    sum_file = package / 'SHA256SUMS'
                    original_sums = sum_file.read_bytes()
                    sum_file.write_bytes(original_sums.replace(hashlib.sha256(original).hexdigest().encode(), sha(target).encode()))
                    bad = subprocess.run(entry, cwd='/', env=env, capture_output=True)
                    require(bad.returncode != 0 and b'PACKAGE_IDENTITY_MISMATCH' in bad.stderr, 'REBIND_BYPASS')
                    target.write_bytes(original)
                    sum_file.write_bytes(original_sums)
                    extra = package / '._synthetic'
                    extra.write_text('fixture')
                    bad = subprocess.run(entry, cwd='/', env=env, capture_output=True)
                    require(bad.returncode != 0 and b'PACKAGE_UNTRACKED_FILE' in bad.stderr, 'UNTRACKED_NOT_REJECTED')
                    extra.unlink()
                    for diagnostic in (output / '.diagnostics').glob('*.json'):
                        require(diagnostic.stat().st_mode & 0o777 == 0o600, 'DIAGNOSTIC_MODE')
                        require(keys[-1].strip() not in diagnostic.read_bytes(), 'DIAGNOSTIC_KEY_LEAK')
                    require(not list(package.rglob('__pycache__')), 'PACKAGE_BYTECODE')
                    require(all(sha(package / name) == value for name, value in sums.items()), 'ENTRY_CHANGED_PACKAGE')
                    # Retry the restored package from its final instance entry.
                    run(entry, cwd='/', env=env)
                    accesses.append({'access': access, 'entryDryRun': 'PASS', 'clusterReads': 'SYNTHETIC',
                                     'renderer': 'REAL_HELM_AND_KUBECTL', 'tamperAndUntrackedRejected': True})
                    shutil.rmtree(output)
                helper_path = base / 'scripts/customer-deployment-helper.py'
                spec = importlib.util.spec_from_file_location('packaged_customer_deploy', helper_path)
                packaged = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(packaged)
                install_checks = []
                install_keys = []
                for access in ['http', 'https']:
                    config = json.loads((base / f'examples/instance.install.{access}.example.json').read_text())
                    config.update(instanceId='fixture-install', context='fixture',
                        webuiUrl=f'{access}://fixture.invalid', publicMcpUrl=f'{access}://fixture.invalid/mcp',
                        offlineNodes={'fixture-node': 'local'})
                    config.setdefault('values', {}).setdefault('env', {}).update({
                        'LUCY_TRUST_PROXY': '1',
                        'LUCY_TRUSTED_PROXY_CIDRS': '192.0.2.0/24',
                    })
                    if access == 'https':
                        config.update(externalTlsReviewed=True, credentialState='issued')
                    config_file = root / ('install-' + access + '.json')
                    config_file.write_text(json.dumps(config))
                    output = root / ('install-' + access + '-delivery')
                    result = json.loads(run(['python3', str(base / 'scripts/prepare-customer-instance.py'),
                        '--base-package', str(base), '--instance-config', str(config_file),
                        '--state-dir', str(root / 'install-state'), '--output', str(output)]))
                    key_file = output / 'credentials/webui-bootstrap-token'
                    install_keys.append(key_file.read_bytes())
                    require(len(install_keys[-1]) == 65 and key_file.stat().st_mode & 0o777 == 0o600, 'INSTALL_PRIVATE_KEY_FORMAT')
                    if access == 'https':
                        require(result['credentialReused'] and install_keys[0] == install_keys[1], 'INSTALL_KEY_REUSE')
                    delivered = json.loads((output / 'instance.json').read_text())
                    merged = packaged.deployment_values(delivered, {})
                    if access == 'https':
                        require(merged['env'].get('LUCY_TRUST_PROXY') == '1', 'INSTALL_TRUST_PROXY_MISSING')
                        require(merged['env'].get('LUCY_TRUSTED_PROXY_CIDRS') == '192.0.2.0/24', 'INSTALL_TRUST_PROXY_CIDR')
                    else:
                        require('LUCY_TRUST_PROXY' not in merged['env'] and 'LUCY_TRUSTED_PROXY_CIDRS' not in merged['env'], 'INSTALL_HTTP_PROXY_KEPT')
                    require('LUCY_CONTENT_ROOT' not in merged['env'] or merged['env'].get('LUCY_CONTENT_ROOT') == '', 'INSTALL_CONTENT_ROOT')
                    manifest = run(['helm', 'template', config['release'], str(base / 'helm/lucy'), '-f', '-'], input=json.dumps(merged).encode())
                    require(b'kind: PersistentVolumeClaim' in manifest and b'name: lucy-data' in manifest, 'INSTALL_PVC_MISSING')
                    require(b'- name: secrets-sync' not in manifest, 'INSTALL_SECRETS_SYNC_UNEXPECTED')
                    if access == 'https':
                        require(b'name: LUCY_TRUST_PROXY' in manifest, 'INSTALL_PROXY_RENDER')
                    else:
                        require(b'LUCY_TRUST_PROXY' not in manifest, 'INSTALL_HTTP_PROXY_RENDERED')
                    fixture_root = root / ('install-' + access + '-fixture')
                    fixture_root.mkdir()
                    env = fixture_environment(fixture_root, delivered, None, None, {}, kubeconfig, empty_install=True)
                    entry = ['bash', str(output / 'scripts/deploy.sh'), '--dry-run']
                    stdout = run(entry, cwd='/', env=env).decode()
                    require(json.loads(stdout.splitlines()[-1])['status'] == 'DRY_RUN', 'INSTALL_ENTRY_DRY_RUN')
                    require(not (output / '.deployment').exists() and not (output / '.deployment-binding.json').exists(), 'INSTALL_DRY_RUN_SIDE_EFFECT')
                    if access == 'https':
                        collision_root = root / 'install-collision-fixture'
                        collision_root.mkdir()
                        collision_env = fixture_environment(
                            collision_root, delivered, None, None, {}, kubeconfig,
                            service={'metadata': {'name': config['service']}}, empty_install=True)
                        bad = subprocess.run(entry, cwd='/', env=collision_env, capture_output=True)
                        require(bad.returncode != 0 and b'INSTALL_RESOURCE_COLLISION' in bad.stderr, 'INSTALL_SERVICE_COLLISION')
                        calls = (collision_root / 'calls.jsonl').read_text() if (collision_root / 'calls.jsonl').exists() else ''
                        require('"upgrade"' not in calls, 'INSTALL_COLLISION_WROTE')
                    install_checks.append({'access': access, 'intent': 'install', 'entryDryRun': 'PASS',
                                           'clusterReads': 'SYNTHETIC', 'renderer': 'REAL_HELM_AND_KUBECTL',
                                           'serviceCollisionRejected': access == 'https'})
                    shutil.rmtree(output)
                require(len(install_checks) == 2, 'INSTALL_REGRESSION')
                require(requests and all(method == 'GET' for method, _ in requests), 'DISCOVERY_API_WRITE')
                report.update(instanceChecks=accesses, installChecks=install_checks,
                              realKubectlResourceKinds=[k for _, k in kinds], discoveryWrites=0)
            report['localGate'] = 'PASS'
        if instance_dir:
            actual = json.loads((instance_dir / 'instance.json').read_text())
            require(actual['baseChecksumDigest'] == report['baseChecksumDigest'] and actual['image'] == report['image'],
                    'REAL_INSTANCE_PACKAGE_MISMATCH')
            run(['bash', str(instance_dir.resolve() / 'scripts/deploy.sh'), '--dry-run'], cwd='/')
            report['realInstancePreflight'] = 'PASS'
    except Exception as error:
        report.update(localGate='FAIL', errorType=type(error).__name__)
        raise
    finally:
        report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'localGate': report['localGate'], 'report': str(report_path), 'productionReady': False}))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--tar', required=True, type=Path)
    p.add_argument('--report', required=True, type=Path)
    p.add_argument('--instance-dir', type=Path)
    args = p.parse_args()
    verify(args.tar.resolve(), args.report.resolve(), args.instance_dir)
