"""Archive and CRI identity regressions, independent of Docker metadata."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

from image_identity import archive_identity, runtime_digest, trusted_digests, verify_metadata


def image_archive(path, oci=True, corrupt=False):
    files = {}
    def add(value, media):
        raw = json.dumps(value).encode()
        digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
        files['blobs/' + digest.replace(':', '/')] = raw
        return {'mediaType': media, 'digest': digest, 'size': len(raw)}
    config = add({'os': 'linux', 'architecture': 'amd64'}, 'application/vnd.oci.image.config.v1+json')
    manifest = add({'schemaVersion': 2, 'config': config, 'layers': []}, 'application/vnd.oci.image.manifest.v1+json')
    manifest['platform'] = {'os': 'linux', 'architecture': 'amd64'}
    if oci:
        attestation = add({'os': 'unknown', 'architecture': 'unknown'}, config['mediaType'])
        attestation = add({'schemaVersion': 2, 'config': attestation, 'layers': []}, manifest['mediaType'])
        index = add({'schemaVersion': 2, 'manifests': [manifest, attestation]}, 'application/vnd.oci.image.index.v1+json')
        files['index.json'] = json.dumps({'schemaVersion': 2, 'manifests': [index]}).encode()
    else:
        files['manifest.json'] = json.dumps([{'Config': 'blobs/' + config['digest'].replace(':', '/'), 'Layers': []}]).encode()
    if corrupt:
        files['blobs/' + config['digest'].replace(':', '/')] = b'{}'
    with tarfile.open(path, 'w') as archive:
        for name, raw in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(raw)
            archive.addfile(info, io.BytesIO(raw))
    return {'platform': 'linux/amd64', 'configId': config['digest'],
            'platformManifestDigest': manifest['digest'] if oci else None,
            'indexDigest': index['digest'] if oci else None}


class ImageIdentityTests(unittest.TestCase):
    def test_real_descriptor_chain_distinguishes_three_identities(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'image.tar'
            expected = image_archive(path)
            actual = archive_identity(path)
            self.assertEqual(actual, expected)
            self.assertEqual(len(trusted_digests(actual)), 3)
            verify_metadata(actual, expected)
            for value in trusted_digests(actual):
                self.assertIn(runtime_digest('docker-pullable://repo@' + value), trusted_digests(actual))
            self.assertNotIn('sha256:' + 'f' * 64, trusted_digests(actual))
            with self.assertRaisesRegex(ValueError, 'MISMATCH'):
                verify_metadata(actual, {**expected, 'configId': expected['indexDigest']})

    def test_legacy_archive_has_config_without_invented_manifest(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'image.tar'
            expected = image_archive(path, oci=False)
            self.assertEqual(archive_identity(path), expected)

    def test_corrupt_config_is_refused(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'image.tar'
            image_archive(path, corrupt=True)
            with self.assertRaisesRegex(ValueError, 'MISMATCH'):
                archive_identity(path)


if __name__ == '__main__':
    unittest.main()
