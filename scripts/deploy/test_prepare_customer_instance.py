"""Exercise the shipped Python preparer with actual archive and CA files."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_image_identity import image_archive

SOURCE = Path(__file__).with_name('prepare-customer-instance.py')
spec = importlib.util.spec_from_file_location('prepare_instance', SOURCE)
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class PrepareInstanceTests(unittest.TestCase):
    def fixture(self, root):
        base = root / 'package'
        (base / 'image').mkdir(parents=True)
        archive = base / 'image/test.tar'
        identity = image_archive(archive)
        build = {'image': {**identity, 'repository': 'project-lucy', 'tag': 'synthetic',
                          'deliveryMode': 'offline', 'tarSha256': hashlib.sha256(archive.read_bytes()).hexdigest()}}
        files = {'BUILD-INFO.json': json.dumps(build), 'image/image-identity.json': json.dumps(identity),
                 'helm/lucy/Chart.yaml': 'apiVersion: v2\nname: lucy\nversion: 0.2.6\n'}
        for name in ['deploy.sh', 'customer-deployment-helper.py', 'probe-customer-auth-state.mjs', 'image_identity.py']:
            source = SOURCE.parent / (name if name != 'deploy.sh' else 'deploy-customer-k8s.sh')
            files['scripts/' + name] = source.read_text()
        for name, data in files.items():
            target = base / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(data)
        sums = ''.join(hashlib.sha256(f.read_bytes()).hexdigest() + '  ./' + str(f.relative_to(base)) + '\n'
                       for f in sorted(base.rglob('*')) if f.is_file())
        (base / 'SHA256SUMS').write_text(sums)
        config = {'schemaVersion': 1, 'instanceId': 'synthetic-customer', 'profile': 'k3s', 'intent': 'upgrade',
                  'authState': 'uninitialized', 'credentialState': 'new', 'legacyBaselineReviewed': True,
                  'context': 'synthetic', 'namespace': 'lucy', 'release': 'lucy', 'deployment': 'lucy',
                  'service': 'lucy', 'pvcName': 'lucy', 'bootstrapSecret': 'lucy-bootstrap', 'access': 'https',
                  'webuiUrl': 'https://lucy.example.test', 'publicMcpUrl': 'https://mcp.example.test/mcp',
                  'namespaceUid': 'ns', 'deploymentUid': 'dep', 'pvcUid': 'pvc', 'baselineImage': 'project-lucy:old',
                  'backup': {'method': 'quiesced-pvc-tar'},
                  'recovery': {'baselineImage': 'project-lucy:old', 'instructionsFile': 'RECOVERY.md'},
                  'values': {}}
        (root / 'RECOVERY.md').write_text('Synthetic reviewed recovery instructions.\n')
        return base, config

    def test_private_ca_is_delivered_and_same_instance_reuses_key(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            base, config = self.fixture(root)
            cert, key = root / 'customer-ca.pem', root / 'ca-private.key'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                            '-subj', '/CN=Lucy Synthetic CA', '-keyout', str(key), '-out', str(cert)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            config['tlsCaFile'] = cert.name
            config_file = root / 'instance.json'
            config_file.write_text(json.dumps(config))
            outputs = [root / 'first', root / 'second']
            for output in outputs:
                prepare.prepare(str(base), str(config_file), str(root / 'state'), str(output))
                delivered = json.loads((output / 'instance.json').read_text())
                self.assertEqual(delivered['tlsCaFile'], 'tls-ca.pem')
                self.assertEqual(delivered['tlsCaSha256'], hashlib.sha256(cert.read_bytes()).hexdigest())
                self.assertEqual((output / 'tls-ca.pem').read_bytes(), cert.read_bytes())
                self.assertEqual((output / 'tls-ca.pem').stat().st_mode & 0o777, 0o600)
                self.assertFalse((output / key.name).exists())
            self.assertEqual((outputs[0] / 'credentials/webui-bootstrap-token').read_bytes(),
                             (outputs[1] / 'credentials/webui-bootstrap-token').read_bytes())

    def test_bad_ca_and_unfilled_recovery_fail_before_key_issue(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            base, config = self.fixture(root)
            config['tlsCaFile'] = 'bad.pem'
            (root / 'bad.pem').write_text('not a certificate')
            config_file = root / 'instance.json'
            config_file.write_text(json.dumps(config))
            with self.assertRaises(SystemExit):
                prepare.prepare(str(base), str(config_file), str(root / 'state'), str(root / 'first'))
            self.assertFalse((root / 'state').exists())
            del config['tlsCaFile']
            config_file.write_text(json.dumps(config))
            (root / 'RECOVERY.md').write_text('ACTUAL_CONTEXT still missing')
            with self.assertRaises(SystemExit):
                prepare.prepare(str(base), str(config_file), str(root / 'state'), str(root / 'first'))
            self.assertFalse((root / 'state').exists())


if __name__ == '__main__':
    unittest.main()
