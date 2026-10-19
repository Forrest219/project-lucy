#!/usr/bin/env python3
"""Customer deployment, standard library only. Tool output is captured, never echoed."""
import argparse
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from urllib.parse import urlparse


class DeploymentError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise DeploymentError(code)


def sha_file(file):
    h = hashlib.sha256()
    with open(file, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def private_read(file):
    require(not file.is_symlink() and file.is_file(), 'PRIVATE_FILE_MISSING')
    st = file.stat()
    require(st.st_mode & 0o077 == 0 and st.st_uid == os.getuid(), 'PRIVATE_FILE_PERMISSIONS')
    return file.read_bytes()


def read_json(file):
    return json.loads(file.read_text())


def save_private(file, value):
    data = (json.dumps(value, indent=2) + '\n').encode()
    fd = os.open(str(file), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def merge_values(old, changes):
    out = copy.deepcopy(old)
    for key, value in changes.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge_values(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def deployment_values(config, old):
    image = config['image']
    if config['intent'] == 'upgrade':
        # Upgrade overlays are explicitly restricted; everything else remains authoritative on site.
        changes = {'image': {}, 'lucy': {}}
        for key in ['version', 'bundledKtxVersion']:
            if key in config['values'].get('lucy', {}):
                changes['lucy'][key] = config['values']['lucy'][key]
        out = merge_values(old, changes)
        require(out.get('fullnameOverride', config['release']) == config['deployment'], 'DEPLOYMENT_NAME_DRIFT')
    else:
        out = copy.deepcopy(config['values'])
        out['fullnameOverride'] = config['deployment']
    out['image'] = {'repository': image['repository'], 'tag': image['tag'],
                    'digest': image.get('registryManifestDigest') or '',
                    'pullPolicy': 'Never' if image['deliveryMode'] == 'offline' else 'IfNotPresent'}
    require(out.get('replicaCount', 1) == 1, 'SINGLE_REPLICA_REQUIRED')
    out.setdefault('persistence', {})['enabled'] = True
    # Preserve Helm's PVC ownership model. Setting existingClaim on a formerly
    # chart-managed PVC would remove it from the manifest and Helm could delete it.
    out.setdefault('env', {})['LUCY_PUBLIC_MCP_URL'] = config['publicMcpUrl']
    require(out['env'].get('LUCY_DEPLOYMENT_MODE', 'customer') == 'customer', 'CUSTOMER_MODE_REQUIRED')
    require(not out.get('security', {}).get('insecureHttpTestProfile'), 'HTTPS_REQUIRED')
    return out


def secret_matches(secret, instance_id, key):
    try:
        return (secret['metadata'].get('labels', {}).get('lucy.io/instance-id') == instance_id
                and base64.b64decode(secret['data']['token'], validate=True).strip() == key.strip())
    except (KeyError, ValueError):
        return False


class Deployment:
    def __init__(self, bundle, dry_run=False):
        self.bundle = Path(bundle).resolve()
        self.package = self.bundle / 'package'
        self.c = json.loads(private_read(self.bundle / 'instance.json'))
        self.dry_run = dry_run
        self.temp = None
        self.backup_pod = None
        self.scaled_down = False
        self.helm_started = False
        self.baseline = None
        self.report = {'instanceId': self.c.get('instanceId'), 'deliveryId': self.c.get('deliveryId'), 'status': 'RUNNING', 'stages': []}

    def command(self, args, data=None, timeout=60, output=None, allow_failure=False):
        try:
            p = subprocess.run(args, input=data, stdout=output or subprocess.PIPE,
                               stderr=subprocess.PIPE, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise DeploymentError('TOOL_UNAVAILABLE_OR_TIMEOUT') from None
        if p.returncode and not allow_failure:
            raise DeploymentError('TOOL_REQUEST_FAILED')
        return p

    def kubectl(self, *args, data=None, timeout=60, output=None):
        return self.command(['kubectl', '--context', self.c['context'], '-n', self.c['namespace'], *args], data, timeout, output)

    def helm(self, *args, timeout=60):
        return self.command(['helm', '--kube-context', self.c['context'], '-n', self.c['namespace'], *args], timeout=timeout)

    def get(self, kind, name):
        p = self.kubectl('get', kind, name, '--ignore-not-found=true', '-o', 'json')
        return json.loads(p.stdout) if p.stdout.strip() else None

    def stage(self, name):
        self.report['stages'].append({'stage': name, 'time': time.time()})
        print('[customer-deploy] ' + name, flush=True)

    def validate(self):
        c = self.c
        require(c.get('schemaVersion') == 1 and c.get('profile') in ['k8s', 'k3s'], 'INSTANCE_CONFIG_INVALID')
        require(c.get('intent') in ['install', 'upgrade'] and c.get('authState') in ['uninitialized', 'configured'], 'INSTANCE_CONFIG_INVALID')
        for key in ['instanceId', 'namespace', 'release', 'deployment', 'service', 'pvcName', 'bootstrapSecret']:
            require(isinstance(c.get(key), str) and re.fullmatch(r'[a-z0-9][a-z0-9.-]{0,61}[a-z0-9]', c[key]), 'RESOURCE_ID_INVALID')
        for key in ['webuiUrl', 'publicMcpUrl']:
            u = urlparse(c[key])
            require(u.scheme == 'https' and u.hostname and not u.username and not u.password and not u.query and not u.fragment, 'HTTPS_REQUIRED')
        for tool in ['kubectl', 'helm']:
            require(shutil.which(tool), 'TOOL_REQUIRED')
        require(self.command(['kubectl', 'config', 'current-context']).stdout.decode().strip() == c['context'], 'CONTEXT_MISMATCH')
        require(not (self.bundle / 'credentials').is_symlink(), 'CREDENTIAL_PATH_INVALID')
        require(sha_file(self.package / 'SHA256SUMS') == c['baseChecksumDigest'], 'PACKAGE_IDENTITY_MISMATCH')
        listed = set()
        for line in (self.package / 'SHA256SUMS').read_text().splitlines():
            m = re.fullmatch(r'([a-f0-9]{64}) [ *](?:\./)?(.+)', line)
            require(m, 'PACKAGE_CHECKSUM_INVALID')
            rel = Path(m[2])
            require(not rel.is_absolute() and '..' not in rel.parts and str(rel) not in listed, 'PACKAGE_PATH_INVALID')
            listed.add(str(rel))
            file = self.package / rel
            require(not file.is_symlink() and file.is_file() and sha_file(file) == m[1], 'PACKAGE_CHECKSUM_MISMATCH')
        actual = set()
        for file in self.package.rglob('*'):
            require(not file.is_symlink(), 'PACKAGE_SYMLINK')
            if file.is_file():
                actual.add(str(file.relative_to(self.package)))
        require(actual == listed | {'SHA256SUMS'}, 'PACKAGE_UNTRACKED_FILE')
        build = read_json(self.package / 'BUILD-INFO.json')
        require(build['image'] == c['image'] and c['image']['platform'] == 'linux/amd64', 'IMAGE_IDENTITY_MISMATCH')
        if c['intent'] == 'upgrade':
            require(c.get('backup', {}).get('method') == 'quiesced-pvc-tar', 'BACKUP_METHOD_INVALID')
            recovery = c.get('recovery', {})
            require(recovery.get('instructionsFile') == 'RECOVERY.md' and recovery.get('baselineImage') == c.get('baselineImage'), 'RECOVERY_CONTRACT_INVALID')
            require(sha_file(self.bundle / 'RECOVERY.md') == recovery.get('sha256'), 'RECOVERY_INSTRUCTIONS_MISMATCH')
        require(c.get('values') == read_json(self.bundle / 'customer-values.yaml'), 'CUSTOMER_VALUES_MISMATCH')
        if c.get('tlsCaFile'):
            require(c['tlsCaFile'] == 'tls-ca.pem' and sha_file(self.bundle / 'tls-ca.pem') == c.get('tlsCaSha256'), 'TLS_CA_IDENTITY_MISMATCH')
        self.namespace = self.get('namespace', c['namespace'])
        require(self.namespace is not None or c['intent'] == 'install', 'UPGRADE_NAMESPACE_MISSING')
        self.cluster = self.get('namespace', 'kube-system')['metadata']['uid']
        if c.get('clusterUid'):
            require(self.cluster == c['clusterUid'], 'CLUSTER_ID_MISMATCH')
        if c.get('namespaceUid'):
            require(self.namespace and self.namespace['metadata']['uid'] == c['namespaceUid'], 'NAMESPACE_ID_MISMATCH')
        binding_file = self.bundle / '.deployment-binding.json'
        self.binding = {'instanceId': c['instanceId'], 'clusterUid': self.cluster, 'namespaceUid': self.namespace['metadata']['uid'] if self.namespace else None, 'release': c['release'], 'deployment': c['deployment'], 'pvcName': c['pvcName']}
        if binding_file.exists():
            require(json.loads(private_read(binding_file)) == self.binding, 'DEPLOYMENT_BINDING_MISMATCH')
        self.deployment = self.get('deployment', c['deployment'])
        self.pvc = self.get('pvc', c['pvcName'])
        releases = json.loads(self.helm('list', '--all', '-o', 'json').stdout)
        self.release = next((r for r in releases if r['name'] == c['release']), None)
        if c['intent'] == 'install' and not self.deployment:
            require(not self.pvc and not self.release, 'INSTALL_RESOURCE_COLLISION')
            self.old_values = {}
            self.auth = {'status': 'uninitialized', 'fingerprint': None}
        else:
            # A repeated install can resume only a release already bound to this private bundle.
            if c['intent'] == 'install':
                require(binding_file.exists(), 'INSTALL_RESOURCE_COLLISION')
            allowed_statuses = ['deployed', 'failed'] if c['intent'] == 'install' and binding_file.exists() else ['deployed']
            require(self.deployment and self.pvc and self.release and self.release['status'] in allowed_statuses, 'UPGRADE_RESOURCES_UNAVAILABLE')
            require(self.deployment['metadata'].get('annotations', {}).get('meta.helm.sh/release-name') == c['release'], 'RELEASE_OWNERSHIP_MISMATCH')
            live_spec = self.deployment['spec']['template']['spec']
            live_container = next((item for item in live_spec['containers'] if item['name'] == c.get('container', 'lucy')), None)
            require(live_container is not None, 'BASELINE_CONTAINER_MISSING')
            mounts = {item['name'] for item in live_container.get('volumeMounts', []) if item['mountPath'] == '/data/lucy'}
            claims = [item['persistentVolumeClaim']['claimName'] for item in live_spec.get('volumes', []) if item['name'] in mounts and 'persistentVolumeClaim' in item]
            require(claims == [c['pvcName']], 'BASELINE_PVC_MISMATCH')
            if c['intent'] == 'upgrade':
                require(c.get('deploymentUid') == self.deployment['metadata']['uid'] and c.get('pvcUid') == self.pvc['metadata']['uid'], 'BASELINE_RESOURCE_MISMATCH')
                current_image = self.deployment['spec']['template']['spec']['containers'][0]['image']
                candidate_ref = self.image_ref()
                require(current_image in [c.get('baselineImage'), candidate_ref], 'BASELINE_IMAGE_MISMATCH')
                self.baseline = current_image
            self.old_values = json.loads(self.helm('get', 'values', c['release'], '-o', 'json').stdout) or {}
            self.pod = self.running_pod()
            self.auth = self.probe(self.pod['metadata']['name'])
            require(self.auth['status'] == c['authState'] or self.auth['status'] == 'configured' and binding_file.exists(), 'AUTH_INTENT_MISMATCH')
        self.needs_key = self.auth['status'] == 'uninitialized'
        self.key = None
        if self.needs_key:
            self.key = private_read(self.bundle / 'credentials/webui-bootstrap-token')
            require(re.fullmatch(rb'[a-f0-9]{64}\n', self.key), 'CREDENTIAL_INVALID')
        self.values = deployment_values({**c, 'intent': 'upgrade'} if self.deployment else c, self.old_values)
        if self.needs_key:
            self.values['bootstrap'] = {'existingSecret': c['bootstrapSecret']}
        self.check_secrets()
        self.check_nodes()

    def image_ref(self):
        image = self.c['image']
        return image['repository'] + ('@' + image['registryManifestDigest'] if image.get('registryManifestDigest') else ':' + image['tag'])

    def running_pod(self):
        pods = json.loads(self.kubectl('get', 'pods', '-l', 'app.kubernetes.io/instance=' + self.c['release'], '-o', 'json').stdout)['items']
        pods = [p for p in pods if not p['metadata'].get('deletionTimestamp') and p.get('status', {}).get('phase') == 'Running']
        require(len(pods) == 1, 'SINGLE_RUNNING_POD_REQUIRED')
        return pods[0]

    def probe(self, pod, container=None):
        data = (Path(__file__).parent / 'probe-customer-auth-state.mjs').read_bytes()
        root = self.c.get('projectRoot', '/data/lucy')
        require(root.startswith('/') and '..' not in Path(root).parts, 'PROJECT_ROOT_INVALID')
        args = ['exec', '-i', pod, '-c', container or self.c.get('container', 'lucy'), '--', 'node', '--input-type=module', '-', root, '/app/webui']
        if self.c.get('legacyBaselineReviewed') or self.c['intent'] == 'install':
            args.append('legacy-reviewed')
        result = json.loads(self.kubectl(*args, data=data).stdout)
        require(result.get('status') in ['configured', 'uninitialized'], 'AUTH_STATE_UNAVAILABLE')
        return result

    def check_secrets(self):
        if self.needs_key:
            s = self.get('secret', self.c['bootstrapSecret'])
            require(not s or secret_matches(s, self.c['instanceId'], self.key), 'BOOTSTRAP_SECRET_CONFLICT')
        refs = set()
        for name in [self.values.get('existingSecret'), self.values.get('bootstrap', {}).get('existingSecret')]:
            if name:
                refs.add(name)
        for source in self.values.get('extraEnvFrom', []):
            if source.get('secretRef', {}).get('name'):
                refs.add(source['secretRef']['name'])
        for source in self.values.get('imagePullSecrets', []):
            refs.add(source['name'])
        if self.values.get('db', {}).get('existingSecret'):
            refs.add(self.values['db']['existingSecret'])
        for tls in self.values.get('ingress', {}).get('tls', []):
            refs.add(tls['secretName'])
        for name in refs:
            if self.needs_key and name == self.c['bootstrapSecret']:
                continue
            require(self.get('secret', name) is not None, 'REFERENCED_SECRET_MISSING')
        if self.needs_key:
            allowed = self.kubectl('auth', 'can-i', 'create', 'secrets').stdout.decode().strip()
            require(allowed == 'yes', 'SECRET_CREATE_FORBIDDEN')

    def check_nodes(self):
        nodes = json.loads(self.kubectl('get', 'nodes', '-o', 'json').stdout)['items']
        selector = self.values.get('nodeSelector', {})
        self.nodes = [n for n in nodes if not n.get('spec', {}).get('unschedulable') and all(n['metadata'].get('labels', {}).get(k) == v for k, v in selector.items())]
        require(self.nodes and all(n['status']['nodeInfo']['architecture'] == 'amd64' and n['status']['nodeInfo']['operatingSystem'] == 'linux' for n in self.nodes), 'AMD64_NODES_REQUIRED')
        require(all(any(c.get('type') == 'Ready' and c.get('status') == 'True' for c in n['status'].get('conditions', [])) for n in self.nodes), 'NODES_NOT_READY')
        if self.c['image']['deliveryMode'] == 'offline':
            importers = self.c.get('offlineNodes', {})
            require(all(n['metadata']['name'] in importers for n in self.nodes), 'OFFLINE_NODE_IMPORT_MAPPING_REQUIRED')
            for n in self.nodes:
                host = importers[n['metadata']['name']]
                require(host == 'local' or re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9@._:-]*', host), 'OFFLINE_SSH_HOST_INVALID')

    def render(self):
        file = Path(self.temp.name) / 'values.json'
        save_private(file, self.values)
        self.values_file = file
        chart = str(self.package / 'helm/lucy')
        self.helm('lint', chart, '-f', str(file))
        manifest = self.helm('template', self.c['release'], chart, '-f', str(file)).stdout
        rendered = json.loads(self.kubectl('create', '--dry-run=client', '--validate=false', '-f', '-', '-o', 'json', data=manifest).stdout)
        items = rendered.get('items', [rendered])
        desired = next((i for i in items if i.get('kind') == 'Deployment' and i['metadata']['name'] == self.c['deployment']), None)
        require(desired, 'RENDERED_DEPLOYMENT_MISSING')
        spec = desired['spec']['template']['spec']
        env = {e['name']: e.get('value') for e in spec['containers'][0]['env']}
        require(env.get('LUCY_DEPLOYMENT_MODE') == 'customer' and env.get('LUCY_WEBUI_COOKIE_SECURE') == '1' and env.get('KTX_PROJECT_ROOT') == '/data/lucy', 'CUSTOMER_AUTH_POLICY_INVALID')
        require(desired['spec']['replicas'] == 1 and desired['spec']['strategy']['type'] == 'Recreate', 'SINGLE_REPLICA_RECREATE_REQUIRED')
        require(spec.get('securityContext', {}).get('fsGroup') == 10001 and spec['containers'][0].get('securityContext', {}).get('runAsUser') == 10001, 'RUNTIME_IDENTITY_INVALID')
        require(spec['containers'][0]['image'] == self.image_ref(), 'RENDERED_IMAGE_MISMATCH')
        claims = [v['persistentVolumeClaim']['claimName'] for v in spec['volumes'] if 'persistentVolumeClaim' in v]
        require(claims == [self.c['pvcName']], 'PVC_NAME_DRIFT')
        if self.deployment:
            managed_pvc = next((i for i in items if i.get('kind') == 'PersistentVolumeClaim' and i['metadata']['name'] == self.c['pvcName']), None)
            if not self.old_values.get('persistence', {}).get('existingClaim'):
                require(managed_pvc is not None, 'MANAGED_PVC_REMOVED')
            if managed_pvc:
                # Storage changes belong to a separate, reviewed operation.
                for field in ['accessModes', 'resources', 'storageClassName']:
                    if field in managed_pvc['spec']:
                        require(managed_pvc['spec'][field] == self.pvc['spec'].get(field), 'PVC_SPEC_DRIFT')
            require(desired['spec']['selector'] == self.deployment['spec']['selector'], 'DEPLOYMENT_SELECTOR_DRIFT')
            live = self.deployment['spec']['template']['spec']['containers'][0]
            require(not live.get('command') and not live.get('args'), 'CUSTOM_ENTRYPOINT_REQUIRES_REVIEW')
        require(any(i.get('kind') == 'Service' and i['metadata']['name'] == self.c['service'] for i in items), 'SERVICE_NAME_DRIFT')
        if self.needs_key:
            require(env.get('LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE') == '/run/secrets/lucy-bootstrap/token', 'BOOTSTRAP_MOUNT_MISSING')
        ingress = self.values.get('ingress', {})
        if ingress.get('enabled'):
            host = urlparse(self.c['webuiUrl']).hostname
            require(any(host in t.get('hosts', []) for t in ingress.get('tls', [])), 'INGRESS_TLS_REQUIRED')
        else:
            require(self.c.get('externalTlsReviewed') is True, 'EXTERNAL_TLS_REVIEW_REQUIRED')

    def create_secret(self):
        if not self.needs_key:
            return
        name = self.c['bootstrapSecret']
        existing = self.get('secret', name)
        if existing:
            require(secret_matches(existing, self.c['instanceId'], self.key), 'BOOTSTRAP_SECRET_CONFLICT')
            return
        body = {'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': name, 'namespace': self.c['namespace'], 'labels': {'lucy.io/instance-id': self.c['instanceId']}}, 'type': 'Opaque', 'data': {'token': base64.b64encode(self.key).decode()}}
        try:
            self.kubectl('create', '-f', '-', data=json.dumps(body).encode())
        except DeploymentError:
            # This also handles a concurrent create, but never converts RBAC errors into NotFound.
            actual = self.get('secret', name)
            require(actual is not None and secret_matches(actual, self.c['instanceId'], self.key), 'BOOTSTRAP_SECRET_CREATE_FAILED')

    def import_image(self):
        if self.c['image']['deliveryMode'] != 'offline':
            return
        archives = list((self.package / 'image').glob('*.tar'))
        require(len(archives) == 1 and sha_file(archives[0]) == self.c['image']['tarSha256'], 'IMAGE_ARCHIVE_MISMATCH')
        command = ['sudo', '-n', 'k3s', 'ctr', 'images', 'import', '-'] if self.c['profile'] == 'k3s' else ['sudo', '-n', 'ctr', '-n', 'k8s.io', 'images', 'import', '-']
        for node in self.nodes:
            host = self.c['offlineNodes'][node['metadata']['name']]
            args = command if host == 'local' else ['ssh', '-oBatchMode=yes', '-oConnectTimeout=10', host, *command]
            with archives[0].open('rb') as stream:
                try:
                    p = subprocess.run(args, stdin=stream, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600)
                except (OSError, subprocess.TimeoutExpired):
                    raise DeploymentError('IMAGE_IMPORT_FAILED') from None
                require(p.returncode == 0, 'IMAGE_IMPORT_FAILED')

    def backup(self):
        if not self.deployment or self.c['intent'] == 'install':
            return
        require(self.c.get('backup') and self.c.get('recovery'), 'BACKUP_RECOVERY_REQUIRED')
        self.kubectl('scale', 'deployment', self.c['deployment'], '--replicas=0')
        self.scaled_down = True
        self.kubectl('wait', '--for=delete', 'pod', '-l', 'app.kubernetes.io/instance=' + self.c['release'], '--timeout=180s', timeout=200)
        self.backup_pod = 'lucy-backup-' + self.c['deliveryId'].replace('-', '')[:16]
        spec = {'apiVersion': 'v1', 'kind': 'Pod', 'metadata': {'name': self.backup_pod, 'labels': {'lucy.io/instance-id': self.c['instanceId']}}, 'spec': {'restartPolicy': 'Never', 'nodeName': self.pod['spec']['nodeName'], 'containers': [{'name': 'lucy', 'image': self.pod['spec']['containers'][0]['image'], 'imagePullPolicy': 'IfNotPresent', 'command': ['/bin/sh', '-c', 'sleep 900'], 'securityContext': {'runAsUser': 10001, 'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']}}, 'volumeMounts': [{'name': 'data', 'mountPath': '/data/lucy', 'readOnly': True}]}], 'volumes': [{'name': 'data', 'persistentVolumeClaim': {'claimName': self.c['pvcName'], 'readOnly': True}}]}}
        self.kubectl('create', '-f', '-', data=json.dumps(spec).encode())
        self.kubectl('wait', '--for=condition=Ready', 'pod/' + self.backup_pod, '--timeout=120s', timeout=140)
        after = self.probe(self.backup_pod, container='lucy')
        require(after['fingerprint'] == self.auth['fingerprint'], 'AUTH_STATE_CHANGED_DURING_PREFLIGHT')
        target = self.runtime / ('backup-' + str(time.time_ns()) + '.tgz')
        fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            self.kubectl('exec', self.backup_pod, '-c', 'lucy', '--', 'tar', '-C', '/data/lucy', '-czf', '-', '.', output=stream, timeout=600)
        with tarfile.open(target, 'r:gz') as archive:
            names = archive.getnames()
            require(any(n in ['./ktx.yaml', 'ktx.yaml'] for n in names), 'BACKUP_PROJECT_MISSING')
        self.report['backup'] = {'file': target.name, 'sha256': sha_file(target), 'authFingerprint': after['fingerprint']}
        self.kubectl('delete', 'pod', self.backup_pod, '--wait=true', '--timeout=120s', timeout=140)
        self.backup_pod = None

    def verify(self):
        self.kubectl('rollout', 'status', 'deployment/' + self.c['deployment'], '--timeout=600s', timeout=620)
        pod = self.running_pod()
        container = next(s for s in pod['status']['containerStatuses'] if s['name'] == self.c.get('container', 'lucy'))
        image_id = re.sub(r'^(?:containerd|docker)://', '', container['imageID'].split('@')[-1])
        expected = self.c['image'].get('registryManifestDigest') or self.c['image']['configId']
        require(image_id == expected, 'RUNNING_IMAGE_ID_MISMATCH')
        actual = self.probe(pod['metadata']['name'])
        require(actual['status'] == self.auth['status'], 'POST_DEPLOY_AUTH_MISMATCH')
        if self.needs_key:
            self.kubectl('exec', pod['metadata']['name'], '-c', self.c.get('container', 'lucy'), '--', 'node', '-e', "const f=require('fs');if(process.getuid()!==10001||!f.readFileSync(process.env.LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE,'utf8').trim())process.exit(1)")
        ca = self.c.get('tlsCaFile')
        context = ssl.create_default_context(cafile=str(self.bundle / ca) if ca else None)
        url = self.c['webuiUrl'].rstrip('/') + '/api/auth/status'
        with urllib.request.urlopen(url, context=context, timeout=30) as response:
            status = json.load(response)['data']['mode']
        require(status == ('bootstrap' if self.needs_key else 'required'), 'PUBLIC_AUTH_STATE_MISMATCH')
        self.report['runningImageId'] = image_id

    def run(self):
        try:
            self.stage('preflight')
            self.validate()
            self.temp = tempfile.TemporaryDirectory(prefix='lucy-deploy-')
            self.render()
            if self.dry_run:
                self.report['status'] = 'DRY_RUN'
                print(json.dumps({'status': 'DRY_RUN', 'instanceId': self.c['instanceId']}))
                return
            self.runtime = self.bundle / '.deployment'
            self.runtime.mkdir(mode=0o700, exist_ok=True)
            require(not self.runtime.is_symlink() and self.runtime.stat().st_mode & 0o077 == 0 and self.runtime.stat().st_uid == os.getuid(), 'RUNTIME_DIRECTORY_INVALID')
            lock = self.runtime / 'lock'
            try:
                lock.mkdir(mode=0o700)
            except FileExistsError:
                raise DeploymentError('DEPLOYMENT_LOCKED') from None
            self.lock = lock
            if self.namespace is None:
                body = {'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': self.c['namespace'], 'labels': {'lucy.io/instance-id': self.c['instanceId']}}}
                self.kubectl('create', '-f', '-', data=json.dumps(body).encode())
                self.namespace = self.get('namespace', self.c['namespace'])
                self.binding['namespaceUid'] = self.namespace['metadata']['uid']
            binding_file = self.bundle / '.deployment-binding.json'
            if not binding_file.exists():
                save_private(binding_file, self.binding)
            if self.deployment and self.c['intent'] == 'install' and self.release['status'] == 'deployed':
                # Resume an already successful installation without rewriting its configuration.
                self.stage('verify-existing-install')
                self.verify()
                self.report['status'] = 'PASSED'
                print(json.dumps({'status': 'PASSED', 'webuiUrl': self.c['webuiUrl'].rstrip('/') + '/login', 'next': 'create-first-owner' if self.needs_key else 'sign-in'}))
                return
            self.stage('image-availability')
            self.import_image()
            self.stage('backup')
            self.backup()
            self.stage('bootstrap-secret')
            self.create_secret()
            self.stage('helm-deploy')
            self.helm_started = True
            # Atomic first install uninstalls the release (including its new PVC) on failure.
            # Keep failed-install resources for retry; only established upgrades may auto-rollback.
            args = ['upgrade', '--install', self.c['release'], str(self.package / 'helm/lucy'), '-f', str(self.values_file), '--wait', '--timeout', '15m']
            if self.c['intent'] == 'upgrade':
                args.append('--atomic')
            self.helm(*args, timeout=1000)
            self.stage('verify')
            self.verify()
            self.report['status'] = 'PASSED'
            print(json.dumps({'status': 'PASSED', 'webuiUrl': self.c['webuiUrl'].rstrip('/') + '/login', 'next': 'create-first-owner' if self.needs_key else 'sign-in'}))
        except DeploymentError as error:
            self.report['errorCode'] = str(error)
            self.report['nextAction'] = 'review-runtime-and-RECOVERY.md' if self.helm_started else 'resolve-preflight-or-backup-error-and-retry-same-bundle'
            raise
        except KeyboardInterrupt:
            self.report['errorCode'] = 'INTERRUPTED'
            self.report['nextAction'] = 'review-runtime-before-retrying-same-bundle'
            raise
        except Exception:
            self.report['errorCode'] = 'DEPLOYMENT_FAILED'
            self.report['nextAction'] = 'review-runtime-and-RECOVERY.md'
            raise DeploymentError('DEPLOYMENT_FAILED') from None
        finally:
            if self.backup_pod:
                try:
                    self.kubectl('delete', 'pod', self.backup_pod, '--wait=true', '--timeout=60s')
                except DeploymentError:
                    self.report['cleanup'] = 'BACKUP_POD_REQUIRES_ATTENTION'
            if self.scaled_down and not self.helm_started:
                try:
                    self.kubectl('scale', 'deployment', self.c['deployment'], '--replicas=1')
                except DeploymentError:
                    self.report['recovery'] = 'OLD_DEPLOYMENT_REQUIRES_ATTENTION'
            if getattr(self, 'lock', None):
                if self.report['status'] == 'RUNNING':
                    self.report['status'] = 'FAILED_RECOVERY_REVIEW_REQUIRED' if self.helm_started else 'FAILED'
                try:
                    save_private(self.runtime / ('result-' + str(time.time_ns()) + '.json'), self.report)
                finally:
                    self.lock.rmdir()
            if self.temp:
                self.temp.cleanup()


def main():
    parser = argparse.ArgumentParser(description='Deploy a private Lucy customer bundle; never prints credentials.')
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    try:
        Deployment(args.bundle, args.dry_run).run()
    except DeploymentError as error:
        print('[customer-deploy] ' + str(error), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('[customer-deploy] INTERRUPTED', file=sys.stderr)
        return 130
    except Exception:
        print('[customer-deploy] DEPLOYMENT_FAILED', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
