"""Behavioral tests for customer deployment; all credentials and resources are synthetic."""
import base64
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import tarfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

SOURCE = Path(__file__).with_name('customer-deployment-helper.py')
spec = importlib.util.spec_from_file_location('customer_deploy', SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
ROOT = SOURCE.parents[2]


def config():
    return {'instanceId': 'customer-one', 'namespace': 'lucy-test', 'release': 'lucy-release',
            'deployment': 'lucy-app', 'service': 'lucy-app', 'pvcName': 'lucy-app-data',
            'bootstrapSecret': 'lucy-bootstrap', 'intent': 'install', 'profile': 'k3s',
            'context': 'isolated', 'access': 'https', 'publicMcpUrl': 'https://lucy.example.test/mcp',
            'webuiUrl': 'https://lucy.example.test', 'externalTlsReviewed': True,
            'image': {'repository': 'project-lucy', 'tag': 'candidate', 'deliveryMode': 'offline',
                      'registryManifestDigest': None, 'configId': 'sha256:' + 'a' * 64},
            'values': {'fullnameOverride': 'lucy-app', 'service': {'type': 'ClusterIP'}, 'env': {}}}


class SecretDeployment(mod.Deployment):
    def __init__(self):
        self.c = config()
        self.key = b'b' * 64 + b'\n'
        self.needs_key = True
        self.secret = None
        self.mutations = []
        self.race = False

    def get(self, kind, name):
        return copy.deepcopy(self.secret)

    def kubectl(self, *args, data=None, **kwargs):
        self.mutations.append(args)
        body = json.loads(data)
        body['metadata']['resourceVersion'] = '1'
        self.secret = body
        if self.race:
            raise mod.DeploymentError('ALREADY_EXISTS')
        return subprocess.CompletedProcess(args, 0, stdout=b'created')


class CustomerDeploymentTests(unittest.TestCase):
    def test_verify_accepts_only_the_candidates_config_manifest_or_index(self):
        ids = ['sha256:' + c * 64 for c in 'abc']
        for actual in ids + ['sha256:' + 'd' * 64]:
            d = SecretDeployment()
            d.c['image'].update(configId=ids[0], platformManifestDigest=ids[1], indexDigest=ids[2])
            d.auth = {'status': 'configured'}
            d.needs_key = False
            d.report = {}
            pod = {'metadata': {'name': 'synthetic'}, 'status': {'containerStatuses': [
                {'name': 'lucy', 'imageID': 'docker-pullable://project-lucy@' + actual}]}}
            with patch.object(d, 'kubectl'), patch.object(d, 'running_pod', return_value=pod), \
                 patch.object(d, 'probe', return_value=d.auth), \
                 patch.object(mod.urllib.request, 'urlopen', return_value=io.BytesIO(b'{"data":{"mode":"required"}}')):
                if actual in ids:
                    d.verify()
                    self.assertEqual(d.report['runningImageId'], actual)
                else:
                    with self.assertRaisesRegex(mod.DeploymentError, 'RUNNING_IMAGE_ID_MISMATCH'):
                        d.verify()

    def test_initial_backup_preserves_original_revision_across_candidate_retry(self):
        d = SecretDeployment()
        d.deployment = {'metadata': {'name': 'lucy'}}
        d.c.update(intent='upgrade', baselineImage='project-lucy:old', deliveryId='synthetic-delivery',
                   pvcName='lucy', backup={'method': 'quiesced-pvc-tar'}, recovery={'instructionsFile': 'RECOVERY.md'})
        d.baseline = 'project-lucy:old'
        d.binding = {'instanceId': 'synthetic-instance'}
        d.release = {'revision': '14'}
        d.pod = {'spec': {'nodeName': 'synthetic-node', 'containers': [{'image': d.baseline}]}}
        d.auth = {'fingerprint': 'unchanged'}
        d.report = {}
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w:gz') as archive:
            info = tarfile.TarInfo('./ktx.yaml')
            info.size = 16
            archive.addfile(info, io.BytesIO(b'connections: {}\n\n'))
        def kubectl(*args, output=None, **kwargs):
            if output is not None:
                output.write(data.getvalue())
            return subprocess.CompletedProcess(args, 0, stdout=b'{}')
        with tempfile.TemporaryDirectory() as root:
            d.runtime = Path(root)
            with patch.object(d, 'kubectl', side_effect=kubectl), patch.object(d, 'probe', return_value=d.auth), \
                 patch.object(d, 'helm', return_value=subprocess.CompletedProcess([], 0, stdout=b'{"secret":"reference-only"}')):
                d.backup()
            original = (d.runtime / 'baseline.json').read_bytes()
            backup = (d.runtime / 'initial-backup.json').read_bytes()
            d.baseline = d.image_ref()
            with patch.object(d, 'kubectl') as kubectl_mock, patch.object(d, 'helm') as helm_mock:
                d.backup()
                kubectl_mock.assert_not_called()
                helm_mock.assert_not_called()
            self.assertEqual((d.runtime / 'baseline.json').read_bytes(), original)
            self.assertEqual((d.runtime / 'initial-backup.json').read_bytes(), backup)
            self.assertEqual(d.report['baseline']['revision'], '14')

    def test_bs09_secret_create_reuse_and_race_are_atomic(self):
        for race in [False, True]:
            d = SecretDeployment()
            d.race = race
            d.create_secret()
            version = d.secret['metadata']['resourceVersion']
            d.create_secret()
            self.assertEqual(len(d.mutations), 1)
            self.assertEqual(d.secret['metadata']['resourceVersion'], version)
            self.assertTrue(mod.secret_matches(d.secret, d.c['instanceId'], d.key))
            self.assertNotIn(d.key.decode().strip(), ' '.join(d.mutations[0]))

    def test_bs09_conflict_and_forbidden_never_overwrite(self):
        d = SecretDeployment()
        d.create_secret()
        d.secret['data']['token'] = base64.b64encode(b'other-key').decode()
        before = copy.deepcopy(d.secret)
        with self.assertRaisesRegex(mod.DeploymentError, 'CONFLICT'):
            d.create_secret()
        self.assertEqual(d.secret, before)
        self.assertEqual(len(d.mutations), 1)
        with patch.object(d, 'get', side_effect=mod.DeploymentError('FORBIDDEN')):
            with self.assertRaisesRegex(mod.DeploymentError, 'FORBIDDEN'):
                d.create_secret()
        self.assertEqual(len(d.mutations), 1)

    def test_bs10_upgrade_preserves_customer_configuration(self):
        c = config()
        c['intent'] = 'upgrade'
        c['values']['lucy'] = {'version': '0.17.0'}
        old = {'fullnameOverride': 'lucy-app', 'persistence': {'existingClaim': 'lucy-app-data', 'storageClass': 'customer-sc'},
               'existingSecret': 'database-secret', 'bootstrap': {'existingSecret': 'old-bootstrap'},
               'env': {'LUCY_CONTENT_ROOT': '.', 'KTX_PROJECT_ROOT': '/data/lucy'},
               'customUninterpreted': {'nested': ['keep']}, 'service': {'webuiPort': 8276}}
        snapshot = copy.deepcopy(old)
        merged = mod.deployment_values(c, old)
        self.assertEqual(old, snapshot)
        for key in ['existingSecret', 'bootstrap', 'customUninterpreted', 'service']:
            self.assertEqual(merged[key], old[key])
        self.assertEqual(merged['env']['LUCY_CONTENT_ROOT'], '.')
        self.assertEqual(merged['persistence']['storageClass'], 'customer-sc')
        self.assertEqual(merged['image']['tag'], 'candidate')

    def test_bs10_chart_managed_pvc_stays_in_helm_manifest(self):
        c = config()
        c['intent'] = 'upgrade'
        for existing_claim in [None, '']:
            old = {'fullnameOverride': c['deployment'], 'persistence': {'size': '10Gi'}}
            if existing_claim is not None:
                old['persistence']['existingClaim'] = existing_claim
            merged = mod.deployment_values(c, old)
            self.assertFalse(merged['persistence'].get('existingClaim'))
            values = json.dumps(merged).encode()
            result = subprocess.run(['helm', 'template', c['release'], str(ROOT / 'deploy/k8s/helm/lucy'), '-f', '-'], input=values, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.assertEqual(result.returncode, 0)
            self.assertIn(b'kind: PersistentVolumeClaim', result.stdout)
            self.assertIn(b'name: lucy-app-data', result.stdout)

    def test_bs16_first_install_keeps_resources_and_upgrade_uses_atomic(self):
        for intent in ['install', 'upgrade']:
            d = SecretDeployment()
            d.c['intent'] = intent
            d.temp = None
            d.backup_pod = None
            d.scaled_down = False
            d.helm_started = False
            d.dry_run = False
            d.report = {'status': 'RUNNING', 'stages': []}
            d.namespace = {'metadata': {'uid': 'namespace-uid'}}
            d.binding = {'instanceId': d.c['instanceId']}
            d.deployment = None
            with tempfile.TemporaryDirectory() as temp:
                d.bundle = Path(temp)
                d.package = d.bundle / 'package'
                def render():
                    d.values_file = Path(d.temp.name) / 'values.json'
                with patch.object(d, 'validate'), patch.object(d, 'render', side_effect=render), patch.object(d, 'import_image'), patch.object(d, 'backup'), patch.object(d, 'create_secret'), patch.object(d, 'verify'), patch.object(d, 'helm') as helm, redirect_stdout(io.StringIO()):
                    d.run()
                self.assertEqual('--atomic' in helm.call_args.args, intent == 'upgrade')
                self.assertEqual(d.report['status'], 'PASSED')
                self.assertFalse((d.bundle / '.deployment/lock').exists())
                self.assertEqual(len(list((d.bundle / '.deployment').glob('result-*.json'))), 1)

    def test_bs16_backup_failure_restores_old_replica_and_records_failure(self):
        d = SecretDeployment()
        d.temp = None
        d.backup_pod = None
        d.scaled_down = False
        d.helm_started = False
        d.dry_run = False
        d.report = {'status': 'RUNNING', 'stages': []}
        d.namespace = {'metadata': {'uid': 'namespace-uid'}}
        d.binding = {'instanceId': d.c['instanceId']}
        d.deployment = None
        def backup():
            d.scaled_down = True
            raise mod.DeploymentError('BACKUP_FAILED')
        with tempfile.TemporaryDirectory() as temp:
            d.bundle = Path(temp)
            with patch.object(d, 'validate'), patch.object(d, 'render'), patch.object(d, 'import_image'), patch.object(d, 'backup', side_effect=backup), patch.object(d, 'kubectl') as kubectl, patch.object(d, 'helm') as helm, redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(mod.DeploymentError, 'BACKUP_FAILED'):
                    d.run()
            helm.assert_not_called()
            kubectl.assert_called_once_with('scale', 'deployment', d.c['deployment'], '--replicas=1')
            report = json.loads(next((d.bundle / '.deployment').glob('result-*.json')).read_text())
            self.assertEqual(report['status'], 'FAILED')
            self.assertEqual(report['errorCode'], 'BACKUP_FAILED')
            self.assertFalse((d.bundle / '.deployment/lock').exists())

    def test_bs10_name_drift_and_insecure_profiles_fail(self):
        c = config()
        c['intent'] = 'upgrade'
        with self.assertRaisesRegex(mod.DeploymentError, 'NAME_DRIFT'):
            mod.deployment_values(c, {'fullnameOverride': 'wrong'})
        converted = mod.deployment_values(c, {'fullnameOverride': 'lucy-app', 'security': {'insecureHttpTestProfile': True}})
        self.assertEqual(converted['security'], {'access': 'https'})
        c['values'] = {'security': {'insecureHttpTestProfile': True}, 'env': {}}
        with self.assertRaisesRegex(mod.DeploymentError, 'CUSTOMER_POLICY_INVALID'):
            mod.deployment_values(c, {'fullnameOverride': 'lucy-app'})
        c = config()
        c['intent'] = 'upgrade'
        c['access'] = 'http'
        c['webuiUrl'] = 'http://lucy.internal'
        c['publicMcpUrl'] = 'http://lucy.internal/mcp'
        intranet = mod.deployment_values(c, {'fullnameOverride': 'lucy-app'})
        self.assertEqual(intranet['security']['access'], 'http')

    def test_bs17_raw_tool_error_is_never_forwarded(self):
        d = SecretDeployment()
        secret = 'synthetic-sensitive-marker'
        raw = subprocess.CompletedProcess(['kubectl'], 1, stdout=secret.encode(), stderr=secret.encode())
        output = io.StringIO()
        with patch.object(mod.subprocess, 'run', return_value=raw), redirect_stdout(output):
            with self.assertRaisesRegex(mod.DeploymentError, '^TOOL_REQUEST_FAILED$') as caught:
                mod.Deployment.command(d, ['kubectl', 'create', '-f', '-'], data=secret.encode())
        self.assertNotIn(secret, str(caught.exception))
        self.assertNotIn(secret, output.getvalue())

    def test_bs18_dry_run_does_not_create_runtime_binding_secret_or_helm_revision(self):
        d = SecretDeployment()
        d.temp = None
        d.backup_pod = None
        d.scaled_down = False
        d.helm_started = False
        d.dry_run = True
        d.report = {'status': 'RUNNING', 'stages': []}
        with tempfile.TemporaryDirectory() as temp:
            d.bundle = Path(temp)
            before = list(d.bundle.iterdir())
            with patch.object(d, 'validate'), patch.object(d, 'render'), redirect_stdout(io.StringIO()):
                d.run()
            self.assertEqual(list(d.bundle.iterdir()), before)
            self.assertEqual(d.report['status'], 'DRY_RUN')
            self.assertEqual(d.mutations, [])

    def test_bs11_real_helm_render_preserves_chart_mount_and_runtime_contract(self):
        """Use actual repository Chart; convert YAML through the TEST host's Node dependency only."""
        d = SecretDeployment()
        d.values = mod.deployment_values(d.c, {})
        d.values['bootstrap'] = {'existingSecret': d.c['bootstrapSecret']}
        d.deployment = None
        d.package = ROOT
        with tempfile.TemporaryDirectory() as package, tempfile.TemporaryDirectory() as temp:
            d.package = Path(package)
            (d.package / 'helm').mkdir()
            (d.package / 'helm/lucy').symlink_to(ROOT / 'deploy/k8s/helm/lucy', target_is_directory=True)
            d.temp = type('Temp', (), {'name': temp})()
            def convert(*args, data=None, **kwargs):
                source = "const Y=require(process.argv[1]);let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.stringify({items:Y.parseAllDocuments(s).filter(d=>d.contents).map(d=>d.toJSON())})));"
                result = subprocess.run(['node', '-e', source, str(ROOT / 'webui/node_modules/yaml')], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                self.assertEqual(result.returncode, 0)
                return result
            with patch.object(d, 'kubectl', side_effect=convert):
                d.render()
            values = json.loads(d.values_file.read_text())
            self.assertEqual(values['bootstrap']['existingSecret'], 'lucy-bootstrap')
            self.assertNotIn(d.key.decode().strip(), d.values_file.read_text())

    def test_shell_entry_help_needs_no_cluster_or_node(self):
        result = subprocess.run(['/bin/bash', str(ROOT / 'scripts/deploy/deploy-customer-k8s.sh'), '--help'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(result.returncode, 0)
        self.assertIn(b'--dry-run', result.stdout)


if __name__ == '__main__':
    unittest.main()
