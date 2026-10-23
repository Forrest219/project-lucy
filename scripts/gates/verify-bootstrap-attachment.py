#!/usr/bin/env python3
"""C20 bundle gate: the private bootstrap attachment and the final archive must
ship together and reproduce one customer directory with the same key.

Local gate only: synthetic cluster reads with real Helm/kubectl rendering.
Never prints key material; the report records digests and paths only.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

sys.dont_write_bytecode = True
from customer_deployment_fixture import discovery, fixture_environment

KEY_RE = re.compile(rb'[a-f0-9]{64}\n')


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        codes = re.findall(rb'\[?[A-Z][A-Z0-9_]{5,}', result.stderr)
        raise RuntimeError('COMMAND_FAILED:' + Path(args[0]).name + ':' + ','.join(c.decode() for c in codes))
    return result.stdout


def extract_archive(archive, root, reject_credentials=True):
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        for member in members:
            path = PurePosixPath(member.name)
            require((member.isfile() or member.isdir()) and not path.is_absolute()
                    and '..' not in path.parts, 'ARCHIVE_SPECIAL_PATH')
            banned = {'.DS_Store', '__MACOSX', '__pycache__', '.git'}
            if reject_credentials:
                banned.add('credentials')
            require(not any(p.startswith('._') or p in banned or p.endswith(('.pyc', '.pyo')) for p in path.parts),
                    'ARCHIVE_JUNK_OR_CREDENTIAL')
        require(len({PurePosixPath(m.name).parts[0] for m in members}) == 1, 'ARCHIVE_ROOT_COUNT')
        tar.extractall(root)
    return next(root.iterdir())


def check_private_tree(base):
    for dirpath, dirnames, filenames in os.walk(base):
        st = os.lstat(dirpath)
        require(st.st_mode & 0o777 == 0o700 and not os.path.islink(dirpath), 'ATTACHMENT_DIR_MODE')
        for name in dirnames + filenames:
            path = os.path.join(dirpath, name)
            st = os.lstat(path)
            require(not os.path.islink(path), 'ATTACHMENT_SYMLINK')
            if os.path.isfile(path):
                mode = st.st_mode & 0o777
                allowed = 0o700 if os.path.relpath(path, base).replace(os.sep, '/') == 'scripts/prepare.sh' else 0o600
                require(mode == allowed, 'ATTACHMENT_FILE_MODE')


def verify(attachment_tar, package_tar, report_path=None):
    report = {'schemaVersion': 1, 'gate': 'C20', 'attachment': Path(attachment_tar).name,
              'package': Path(package_tar).name, 'result': 'RUNNING'}
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        package_tar = Path(package_tar).resolve()
        attachment_tar = Path(attachment_tar).resolve()
        outer_sha_file = Path(str(package_tar) + '.sha256')
        if outer_sha_file.exists():
            require(sha(package_tar) == outer_sha_file.read_text().split()[0], 'OUTER_CHECKSUM')
        with tempfile.TemporaryDirectory(prefix='lucy-c20-') as raw:
            root = Path(raw).resolve()
            attachment = extract_archive(attachment_tar, root / 'attachment-x', reject_credentials=False)
            base = extract_archive(package_tar, root / 'package-x')

            meta = json.loads((attachment / 'instance-credential.json').read_text())
            require(meta['package']['name'] == package_tar.name, 'PACKAGE_NAME_MISMATCH')
            require(sha(package_tar) == meta['package']['sha256'], 'PACKAGE_SHA_MISMATCH')
            require(sha(base / 'SHA256SUMS') == meta['package']['baseChecksumDigest'], 'PACKAGE_DIGEST_MISMATCH')
            check_private_tree(attachment)
            key = (attachment / 'credentials/webui-bootstrap-token').read_bytes()
            require(KEY_RE.fullmatch(key), 'PRIVATE_KEY_FORMAT')
            key_digest = hashlib.sha256(key).hexdigest()
            require(meta['keyDigest'] == key_digest, 'KEYDIGEST_MISMATCH')
            record = json.loads((attachment / 'credentials/record.json').read_text())
            require(record['instanceId'] == meta['instanceId'] and record['keyDigest'] == key_digest, 'RECORD_MISMATCH')
            state_entry = attachment / 'state/instances' / meta['instanceId']
            state_key = (state_entry / 'bootstrap-token').read_bytes()
            require(state_key == key, 'STATE_COPY_MISMATCH')
            state_record = json.loads((state_entry / 'record.json').read_text())
            require(state_record['keyDigest'] == key_digest, 'STATE_COPY_MISMATCH')
            report['credential'] = {'instanceId': meta['instanceId'], 'credentialState': meta['credentialState'],
                                    'keyDigest': key_digest, 'customer': meta.get('customer')}
            require(meta['credentialState'] == 'issued', 'CREDENTIAL_NOT_ISSUED')

            # Complete the shipped HTTP example with fixture site values: the
            # deployer only ever supplies site parameters.
            config = json.loads((attachment / 'examples/instance.upgrade.http.example.json').read_text())
            config.update(context='fixture', namespaceUid='fixture-ns', deploymentUid='fixture-deploy',
                          pvcUid='fixture-pvc', baselineImage='project-lucy:fixture-0.17.0',
                          legacyBaselineReviewed=True, webuiUrl='http://fixture.invalid:8276',
                          publicMcpUrl='http://fixture.invalid:8277/mcp', offlineNodes={'fixture-node': 'local'})
            config['recovery'] = {'baselineImage': config['baselineImage'],
                                  'instructionsFile': str(base / 'examples/RECOVERY.open-mode.md')}
            config_file = root / 'site.json'
            config_file.write_text(json.dumps(config))
            entry = ['bash', str(attachment / 'scripts/prepare.sh'), '--package', str(package_tar),
                     '--config', str(config_file), '--output', str(root / 'delivery')]
            dry = json.loads(run(entry + ['--dry-run'], cwd='/'))
            require(dry['credentialReusable'] is True, 'DRY_RUN_REUSE')
            done = json.loads(run(entry, cwd='/'))
            require(done['instanceId'] == meta['instanceId'] and done['credentialReused'] is True, 'ATTACHMENT_REUSE')
            delivery = root / 'delivery'
            delivered = json.loads((delivery / 'instance.json').read_text())
            require(delivered['baseChecksumDigest'] == meta['package']['baseChecksumDigest'], 'DELIVERY_DIGEST_MISMATCH')
            require(hashlib.sha256((delivery / 'credentials/webui-bootstrap-token').read_bytes()).hexdigest() == key_digest,
                    'DELIVERED_CREDENTIAL_MISMATCH')

            # The attachment-produced bundle must pass the customer entry dry-run
            # against synthetic cluster reads with real Helm/kubectl rendering.
            real_kubectl = shutil.which('kubectl')
            with discovery(root) as (kubeconfig, requests):
                env_real = {**os.environ, 'KUBECONFIG': str(kubeconfig)}
                old_values = {'fullnameOverride': config['deployment'], 'existingSecret': 'fixture-db',
                              'env': {'LUCY_PUBLIC_MCP_URL': config['publicMcpUrl']},
                              'security': {'access': 'http'},
                              'service': {'type': 'LoadBalancer', 'webuiPort': 8276, 'mcpPort': 8277},
                              'persistence': {'existingClaim': config['pvcName']}}
                values_file = root / 'old-values.json'
                values_file.write_text(json.dumps(old_values))
                manifest = run(['helm', 'template', config['release'], str(base / 'helm/lucy'), '-f', str(values_file)])
                decoder, text, rendered = json.JSONDecoder(), b'', []
                kubectl_out = run([real_kubectl, '--context', 'fixture', 'create', '--dry-run=client', '--validate=false',
                                   '-f', '-', '-o', 'json'], input=manifest, env=env_real)
                text = kubectl_out.decode().strip()
                while text:
                    obj, end = decoder.raw_decode(text)
                    rendered.extend(obj['items'] if obj.get('kind') == 'List' else [obj])
                    text = text[end:].lstrip()
                dep = next(x for x in rendered if x['kind'] == 'Deployment')
                dep['metadata'].update(uid=config['deploymentUid'], annotations={'meta.helm.sh/release-name': config['release']})
                dep['spec']['template']['spec']['containers'][0]['image'] = config['baselineImage']
                pvc = {'metadata': {'name': config['pvcName'], 'uid': config['pvcUid']},
                       'spec': {'accessModes': ['ReadWriteOnce']}}
                fixture_root = root / 'fixture'
                fixture_root.mkdir()
                fenv = fixture_environment(fixture_root, delivered, dep, pvc, old_values, kubeconfig)
                stdout = run(['bash', str(delivery / 'scripts/deploy.sh'), '--dry-run'], cwd='/', env=fenv).decode()
                require(json.loads(stdout.splitlines()[-1])['status'] == 'DRY_RUN', 'ENTRY_DRY_RUN')
                require(not (delivery / '.deployment').exists(), 'DRY_RUN_SIDE_EFFECT')
                report['entryDryRun'] = 'PASS'

                require((attachment / 'CUSTOMER-INSTALL.md').is_file(), 'INSTALL_DOC_MISSING')
                require((attachment / 'examples/instance.install.https.example.json').is_file(), 'INSTALL_EXAMPLE_MISSING')
                install = json.loads((attachment / 'examples/instance.install.http.example.json').read_text())
                install.update(context='fixture', webuiUrl='http://fixture.invalid',
                               publicMcpUrl='http://fixture.invalid/mcp',
                               offlineNodes={'fixture-node': 'local'})
                install.setdefault('values', {}).setdefault('env', {}).update({
                    'LUCY_TRUST_PROXY': '1',
                    'LUCY_TRUSTED_PROXY_CIDRS': '192.0.2.0/24',
                })
                install_file = root / 'install-site.json'
                install_file.write_text(json.dumps(install))
                install_entry = ['bash', str(attachment / 'scripts/prepare.sh'), '--package', str(package_tar),
                                 '--config', str(install_file), '--output', str(root / 'delivery-install')]
                prepared = json.loads(run(install_entry, cwd='/'))
                require(prepared['instanceId'] == meta['instanceId'] and prepared['credentialReused'] is True, 'INSTALL_PREPARE')
                install_delivery = root / 'delivery-install'
                installed = json.loads((install_delivery / 'instance.json').read_text())
                require(installed['intent'] == 'install' and installed['pvcName'].endswith('-data'), 'INSTALL_CONTRACT')
                install_fixture = root / 'install-fixture'
                install_fixture.mkdir()
                install_env = fixture_environment(install_fixture, installed, None, None, {}, kubeconfig, empty_install=True)
                install_stdout = run(['bash', str(install_delivery / 'scripts/deploy.sh'), '--dry-run'], cwd='/', env=install_env).decode()
                require(json.loads(install_stdout.splitlines()[-1])['status'] == 'DRY_RUN', 'INSTALL_ENTRY_DRY_RUN')
                report['installEntryDryRun'] = 'PASS'

            # Negative: an attachment must never prepare against a different package.
            other_tar = root / 'other.tar.gz'
            other_tar.write_bytes(os.urandom(64))
            bad = subprocess.run(['bash', str(attachment / 'scripts/prepare.sh'), '--package', str(other_tar),
                                  '--config', str(config_file), '--output', str(root / 'delivery-foreign')],
                                 cwd='/', capture_output=True)
            require(bad.returncode != 0 and b'PACKAGE_BINDING_MISMATCH' in bad.stderr, 'PACKAGE_MISMATCH_NOT_REJECTED')
            foreign = json.loads(config_file.read_text())
            foreign['instanceId'] = 'foreign-instance-123'
            foreign_file = root / 'foreign.json'
            foreign_file.write_text(json.dumps(foreign))
            bad = subprocess.run(['bash', str(attachment / 'scripts/prepare.sh'), '--package', str(package_tar),
                                  '--config', str(foreign_file), '--output', str(root / 'delivery-2')],
                                 cwd='/', capture_output=True)
            require(bad.returncode != 0 and b'INSTANCE_BINDING_MISMATCH' in bad.stderr, 'INSTANCE_MIX_NOT_REJECTED')
            report['negativeChecks'] = {'packageMismatchRejected': True, 'instanceMixRejected': True}
            report['result'] = 'PASS'
    except Exception as error:
        report.update(result='FAIL', errorType=type(error).__name__)
        raise
    finally:
        if report_path:
            report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'gate': 'C20', 'result': report['result'],
                      'report': str(report_path) if report_path else None, 'productionReady': False}))
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--attachment', required=True, type=Path, help='私有附件 .tar.gz')
    p.add_argument('--package-tar', required=True, type=Path, help='最终软件归档 .tar.gz')
    p.add_argument('--report', type=Path)
    args = p.parse_args()
    verify(args.attachment.resolve(), args.package_tar.resolve(), args.report.resolve() if args.report else None)
