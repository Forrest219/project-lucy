#!/usr/bin/env python3
"""Read verified image identities from a Docker/OCI archive; stdlib only."""
import argparse
import hashlib
import json
import re
import tarfile


def runtime_digest(value):
    value = value.rsplit('@', 1)[-1]
    value = re.sub(r'^(?:containerd|docker|docker-pullable)://', '', value)
    return value if re.fullmatch(r'sha256:[a-f0-9]{64}', value) else None


def trusted_digests(image):
    return {value for key in ('configId', 'platformManifestDigest', 'indexDigest', 'registryManifestDigest')
            if (value := image.get(key)) and runtime_digest(value) == value}


def archive_identity(path):
    with tarfile.open(path, 'r:*') as archive:
        members = archive.getmembers()
        names = {m.name for m in members}
        if len(names) != len(members):
            raise ValueError('IMAGE_ARCHIVE_DUPLICATE_PATH')

        def read(name):
            member = archive.getmember(name)
            if not member.isfile() or member.size > 8 * 1024 * 1024:
                raise ValueError('IMAGE_DESCRIPTOR_INVALID')
            return archive.extractfile(member).read()

        def blob(descriptor):
            digest = descriptor['digest']
            if runtime_digest(digest) != digest:
                raise ValueError('IMAGE_DIGEST_INVALID')
            raw = read('blobs/' + digest.replace(':', '/'))
            if hashlib.sha256(raw).hexdigest() != digest.split(':')[1] or len(raw) != descriptor['size']:
                raise ValueError('IMAGE_DESCRIPTOR_MISMATCH')
            return json.loads(raw)

        candidates = []

        def visit(descriptor, parent_index=None, depth=0):
            if depth > 4:
                raise ValueError('IMAGE_INDEX_DEPTH')
            doc = blob(descriptor)
            if 'manifests' in doc:
                for child in doc['manifests']:
                    visit(child, parent_index or descriptor['digest'], depth + 1)
            elif 'config' in doc:
                config = blob(doc['config'])
                if (config.get('os'), config.get('architecture')) == ('linux', 'amd64'):
                    candidates.append({'platform': 'linux/amd64', 'configId': doc['config']['digest'],
                                       'platformManifestDigest': descriptor['digest'], 'indexDigest': parent_index})

        if 'index.json' in names:
            for descriptor in json.loads(read('index.json'))['manifests']:
                visit(descriptor)
        else:
            for item in json.loads(read('manifest.json')):
                raw = read(item['Config'])
                config = json.loads(raw)
                if (config.get('os'), config.get('architecture')) == ('linux', 'amd64'):
                    candidates.append({'platform': 'linux/amd64', 'configId': 'sha256:' + hashlib.sha256(raw).hexdigest(),
                                       'platformManifestDigest': None, 'indexDigest': None})
        if len(candidates) != 1:
            raise ValueError('SINGLE_AMD64_IMAGE_REQUIRED')
        return candidates[0]


def verify_metadata(identity, image):
    if any(image.get(key) != value for key, value in identity.items()):
        raise ValueError('IMAGE_IDENTITY_MISMATCH')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--metadata')
    parser.add_argument('--docker-id')
    args = parser.parse_args()
    identity = archive_identity(args.archive)
    if args.metadata:
        with open(args.metadata) as stream:
            metadata = json.load(stream)
        verify_metadata(identity, metadata.get('image', metadata))
    if args.docker_id and runtime_digest(args.docker_id) not in trusted_digests(identity):
        raise ValueError('LOADED_IMAGE_ID_MISMATCH')
    print(json.dumps(identity, indent=2))


if __name__ == '__main__':
    main()
