"""Exercise the final-archive gate with a synthetic image, real chart and CLIs."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

from test_image_identity import image_archive

ROOT = Path(__file__).resolve().parents[2]


class FinalUpgradePackageTests(unittest.TestCase):
    def test_final_archive_entry_runs_with_real_kubectl_multi_resource_output(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            base = root / 'synthetic-delivery'
            (base / 'image').mkdir(parents=True)
            image = base / 'image/synthetic.tar'
            identity = image_archive(image)
            build = {'git': {'commit': 'synthetic', 'dirty': False}, 'chart': {'version': '0.2.6', 'appVersion': '2.0.0'},
                     'image': {**identity, 'repository': 'project-lucy', 'tag': 'fixture-candidate',
                               'deliveryMode': 'offline', 'tarSha256': hashlib.sha256(image.read_bytes()).hexdigest()}}
            (base / 'BUILD-INFO.json').write_text(json.dumps(build))
            shutil.copytree(ROOT / 'deploy/k8s/helm/lucy', base / 'helm/lucy')
            shutil.copytree(ROOT / 'deploy/k8s/examples', base / 'examples')
            (base / 'scripts').mkdir()
            for name in ['customer-deployment-helper.py', 'image_identity.py', 'probe-customer-auth-state.mjs', 'prepare-customer-instance.py']:
                shutil.copyfile(ROOT / 'scripts/deploy' / name, base / 'scripts' / name)
            shutil.copyfile(ROOT / 'scripts/deploy/deploy-customer-k8s.sh', base / 'scripts/deploy.sh')
            sums = ''.join(hashlib.sha256(f.read_bytes()).hexdigest() + '  ./' + str(f.relative_to(base)) + '\n'
                           for f in sorted(base.rglob('*')) if f.is_file())
            (base / 'SHA256SUMS').write_text(sums)
            archive = root / 'candidate.tar.gz'
            with tarfile.open(archive, 'w:gz') as tar:
                tar.add(base, arcname=base.name)
            Path(str(archive) + '.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
            report = root / 'report.json'
            result = subprocess.run(['python3', str(ROOT / 'scripts/gates/verify-customer-upgrade-package.py'),
                                     '--tar', str(archive), '--report', str(report)], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            evidence = json.loads(report.read_text())
            self.assertEqual(evidence['localGate'], 'PASS')
            self.assertEqual(len(evidence['instanceChecks']), 2)
            self.assertEqual(len(evidence['installChecks']), 2)
            self.assertTrue(all(item['intent'] == 'install' and item['entryDryRun'] == 'PASS' for item in evidence['installChecks']))
            self.assertEqual(evidence['discoveryWrites'], 0)
            self.assertFalse(evidence['productionReady'])
            self.assertEqual(evidence['nativeAmd64UpgradeAndRecovery'], 'PENDING_DEPLOYER_ACCEPTANCE')


if __name__ == '__main__':
    unittest.main()
