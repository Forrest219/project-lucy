#!/usr/bin/env python3
"""Prepare one private customer directory from an extracted Lucy package.

Credential files match scripts/release/customer-bootstrap-state.mjs so a later
Node or Python run reuses the same bootstrap key. Stdlib only.
"""
import hashlib, json, os, re, secrets, shutil, ssl, sys, time, uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

NAMES = ['namespace', 'release', 'deployment', 'service', 'pvcName', 'bootstrapSecret']

def fail(code):
    print(code, file=sys.stderr)
    raise SystemExit(1)

def digest(data):
    if isinstance(data, str): data = data.encode()
    return hashlib.sha256(data).hexdigest()

def stat(path):
    try: return os.lstat(path)
    except FileNotFoundError: return None

import stat as statmod

def is_link(st):
    return statmod.S_ISLNK(st.st_mode)

def is_dir(st):
    return statmod.S_ISDIR(st.st_mode)

def is_file(st):
    return statmod.S_ISREG(st.st_mode)

def own_private(st, directory):
    return st and not is_link(st) and (is_dir(st) if directory else is_file(st)) and not (st.st_mode & 0o077) and st.st_uid == os.getuid()

def private_location(target):
    absolute = os.path.abspath(target)
    cursor = absolute
    while True:
        if stat(os.path.join(cursor, '.git')): fail('PATH_INSIDE_GIT')
        if os.path.basename(cursor) in {'.cache', 'node_modules', 'release', 'inbox'}: fail('PATH_INSIDE_BUILD_OR_CACHE')
        found = stat(cursor)
        if found and is_link(found): fail('SYMLINK_PATH')
        parent = os.path.dirname(cursor)
        if parent == cursor: break
        cursor = parent
    return absolute

def ensure_dir(path):
    found = stat(path)
    if not found:
        os.makedirs(path, 0o700)
        os.chmod(path, 0o700)
        return
    if not own_private(found, True): fail('PRIVATE_DIRECTORY_INVALID')

def write_private(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(path, 0o600)

def read_private(path):
    found = stat(path)
    if not own_private(found, False): fail('PRIVATE_FILE_INVALID')
    with open(path) as handle: return handle.read()

def validate(config):
    if config.get('schemaVersion') != 1 or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,62}', config.get('instanceId', '')) or config.get('profile') not in ('k8s', 'k3s') or config.get('intent') not in ('install', 'upgrade') or config.get('authState') not in ('uninitialized', 'configured'): fail('INSTANCE_CONFIG_INVALID')
    if any(not isinstance(config.get(key), str) or not re.fullmatch(r'[a-z0-9][a-z0-9.-]{0,61}[a-z0-9]', config[key]) for key in NAMES): fail('RESOURCE_NAME_INVALID')
    if not isinstance(config.get('context'), str) or not config['context'].strip() or re.search(r'[\r\n\0]', config['context']): fail('CONTEXT_INVALID')
    if config.get('access') not in ('http', 'https'): fail('ACCESS_REQUIRED')
    for key in ('webuiUrl', 'publicMcpUrl'):
        parsed = urlparse(config.get(key, ''))
        if parsed.scheme != config['access'] or parsed.username or parsed.password or parsed.query or parsed.fragment: fail('ACCESS_URL_MISMATCH')
    values = config.get('values')
    if not isinstance(values, dict): fail('CUSTOMER_VALUES_REQUIRED')
    if config['authState'] == 'configured' and config.get('credentialState') != 'none': fail('EXISTING_ADMIN_MUST_NOT_ISSUE_KEY')
    if config['authState'] == 'uninitialized' and config.get('credentialState') not in ('new', 'issued'): fail('CREDENTIAL_INTENT_INVALID')
    if config['intent'] == 'install' and config['authState'] != 'uninitialized': fail('INSTALL_STATE_INVALID')
    if config['intent'] == 'install' and (config['pvcName'] != f"{config['deployment']}-data" or values.get('persistence', {}).get('existingClaim')): fail('NEW_INSTALL_PVC_NAME_INVALID')
    if config['intent'] == 'upgrade' and not all(config.get(key) for key in ('namespaceUid', 'deploymentUid', 'pvcUid', 'baselineImage', 'backup', 'recovery')): fail('UPGRADE_BASELINE_REQUIRED')
    if config['intent'] == 'upgrade' and config['authState'] == 'uninitialized' and config.get('legacyBaselineReviewed') is not True: fail('LEGACY_BASELINE_REVIEW_REQUIRED')
    if config['intent'] == 'upgrade' and (config['backup'].get('method') != 'quiesced-pvc-tar' or config['recovery'].get('baselineImage') != config['baselineImage'] or not isinstance(config['recovery'].get('instructionsFile'), str)): fail('UPGRADE_RECOVERY_CONTRACT_REQUIRED')
    security = values.get('security') or {}
    if security.get('insecureHttpTestProfile') or security.get('access') and security.get('access') != config['access'] or (values.get('env') or {}).get('LUCY_DEPLOYMENT_MODE') == 'development' or values.get('extraSecretData'): fail('CUSTOMER_POLICY_INVALID')
    config['values'] = {**values, 'security': {**security, 'access': config['access']}}
    if any(re.search(r'(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)$', key) for key in (config['values'].get('env') or {})): fail('PLAINTEXT_SECRET_IN_VALUES')
    return config

def package_files(base):
    found = []
    for dirpath, dirnames, filenames in os.walk(base):
        for name in list(dirnames):
            path = os.path.join(dirpath, name)
            if os.path.islink(path): fail('PACKAGE_SPECIAL_FILE')
            if name in {'.git', 'credentials', 'node_modules'}: fail('PACKAGE_PRIVATE_DIRECTORY')
        for name in filenames:
            path = os.path.join(dirpath, name)
            if os.path.islink(path): fail('PACKAGE_SPECIAL_FILE')
            found.append(os.path.relpath(path, base).replace(os.sep, '/'))
    return sorted(found)

def file_digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()

def verify_base(base):
    if not os.path.isdir(base) or os.path.islink(base): fail('EXTRACTED_BASE_PACKAGE_REQUIRED')
    files = package_files(base)
    sums_path = os.path.join(base, 'SHA256SUMS')
    listed = {}
    for line in Path(sums_path).read_text().strip().split('\n'):
        match = re.fullmatch(r'([a-f0-9]{64}) [ *](?:\./)?(.+)', line)
        if not match or match.group(2).startswith('/') or '..' in match.group(2).split('/') or match.group(2) in listed: fail('PACKAGE_CHECKSUM_LIST_INVALID')
        listed[match.group(2)] = match.group(1)
    if any(name != 'SHA256SUMS' and name not in listed for name in files) or any(name not in files for name in listed): fail('PACKAGE_UNTRACKED_FILE')
    for name, expected in listed.items():
        if file_digest(os.path.join(base, name)) != expected: fail('PACKAGE_CHECKSUM_MISMATCH')
    for required in ('BUILD-INFO.json', 'helm/lucy/Chart.yaml', 'scripts/deploy.sh', 'scripts/customer-deployment-helper.py', 'scripts/probe-customer-auth-state.mjs'):
        if required not in files: fail('PACKAGE_DEPLOY_ENTRY_MISSING')
    build = json.loads(Path(base, 'BUILD-INFO.json').read_text())
    image = build.get('image') or {}
    if image.get('platform') != 'linux/amd64' or not re.fullmatch(r'sha256:[a-f0-9]{64}', image.get('configId', '')) or image.get('deliveryMode') not in ('offline', 'registry'): fail('PACKAGE_IMAGE_INVALID')
    if image['deliveryMode'] == 'offline' and not re.fullmatch(r'[a-f0-9]{64}', image.get('tarSha256', '')): fail('OFFLINE_IMAGE_HASH_INVALID')
    archives = [name for name in files if name.startswith('image/') and name.endswith('.tar')]
    if image['deliveryMode'] == 'offline' and (len(archives) != 1 or listed[archives[0]] != image['tarSha256']): fail('OFFLINE_IMAGE_METADATA_MISMATCH')
    return {'build': build, 'files': files, 'checksumDigest': file_digest(sums_path)}

def issue(state_dir, instance_id, credential_state):
    if credential_state not in ('new', 'issued', 'none'): fail('CREDENTIAL_INTENT_INVALID')
    if credential_state == 'none': return None, False
    root = private_location(state_dir)
    entry = os.path.join(root, 'instances', instance_id)
    ledger = os.path.join(root, 'issued', f'{instance_id}.json')
    def read_issued():
        if not own_private(stat(entry), True): fail('PRIVATE_DIRECTORY_INVALID')
        metadata = json.loads(read_private(os.path.join(entry, 'record.json')))
        marker = json.loads(read_private(ledger))
        key = read_private(os.path.join(entry, 'bootstrap-token'))
        if metadata.get('instanceId') != instance_id or marker.get('instanceId') != instance_id or not re.fullmatch(r'[a-f0-9]{64}\n', key) or metadata.get('keyDigest') != digest(key) or marker.get('issueId') != metadata.get('issueId'): fail('CREDENTIAL_STATE_INVALID')
        return key, True
    ensure_dir(root)
    for child in ('instances', 'issued', 'locks'): ensure_dir(os.path.join(root, child))
    lock = os.path.join(root, 'locks', instance_id)
    locked = False
    for _ in range(40):
        try:
            os.mkdir(lock, 0o700)
            locked = True
            break
        except FileExistsError:
            time.sleep(0.05)
    if not locked: fail('CREDENTIAL_LOCKED')
    staging = None
    try:
        has_entry, has_ledger = stat(entry), stat(ledger)
        if has_entry and has_ledger: return read_issued()
        if has_entry or has_ledger or credential_state != 'new': fail('CREDENTIAL_RECOVERY_REQUIRED')
        key = secrets.token_hex(32) + '\n'
        issue_id = secrets.token_hex(16)
        write_private(ledger, json.dumps({'instanceId': instance_id, 'issueId': issue_id}) + '\n')
        staging = os.path.join(root, 'instances', f'.{instance_id}-{secrets.token_hex(4)}')
        os.mkdir(staging, 0o700)
        write_private(os.path.join(staging, 'bootstrap-token'), key)
        write_private(os.path.join(staging, 'record.json'), json.dumps({'instanceId': instance_id, 'issueId': issue_id, 'keyDigest': digest(key), 'createdAt': datetime.now(timezone.utc).isoformat()}) + '\n')
        os.rename(staging, entry)
        staging = None
        return key, False
    finally:
        if staging and os.path.isdir(staging): shutil.rmtree(staging)
        if locked: os.rmdir(lock)

def contains_key(path, key):
    tail = b''
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            data = tail + block
            if key in data: return True
            tail = data[-(len(key) - 1):] if len(key) > 1 else b''
    return False

def prepare(base, config_path, state_dir, output):
    config = validate(json.loads(Path(config_path).read_text()))
    base, target, state = map(private_location, (base, output, state_dir))
    if stat(target): fail('OUTPUT_ALREADY_EXISTS')
    verified = verify_base(base)
    tls_ca = None
    if config.get('tlsCaFile'):
        if config['access'] != 'https': fail('TLS_CA_REQUIRES_HTTPS')
        src = config['tlsCaFile']
        if not os.path.isabs(src): src = os.path.join(os.path.dirname(os.path.abspath(config_path)), src)
        found = stat(src)
        if not found or not is_file(found) or is_link(found): fail('TLS_CA_FILE_INVALID')
        tls_ca = Path(src).read_bytes()
        try:
            if b'PRIVATE KEY' in tls_ca: fail('TLS_CA_FILE_INVALID')
            ssl.create_default_context(cadata=tls_ca.decode('ascii'))
        except (ValueError, UnicodeError, ssl.SSLError):
            fail('TLS_CA_FILE_INVALID')
    recovery = None
    if config['intent'] == 'upgrade':
        src = config['recovery']['instructionsFile']
        if not os.path.isabs(src): src = os.path.join(os.path.dirname(os.path.abspath(config_path)), src)
        found = stat(src)
        if not found or not is_file(found) or is_link(found): fail('RECOVERY_INSTRUCTIONS_INVALID')
        recovery = Path(src).read_bytes()
        if not recovery: fail('RECOVERY_INSTRUCTIONS_INVALID')
        if re.search(rb'ACTUAL_|ORIGINAL_|HASH_FROM_INITIAL_BACKUP_JSON', recovery): fail('RECOVERY_INSTRUCTIONS_INCOMPLETE')
    if target == base or target.startswith(base + os.sep) or state == target or state.startswith(target + os.sep) or target.startswith(state + os.sep): fail('OVERLAPPING_DELIVERY_PATHS')
    key, reused = issue(state, config['instanceId'], config['credentialState'])
    os.makedirs(os.path.dirname(target), 0o700, exist_ok=True)
    staging = os.path.join(os.path.dirname(target), f'.lucy-delivery-{secrets.token_hex(4)}')
    os.mkdir(staging, 0o700)
    try:
        shutil.copytree(base, os.path.join(staging, 'package'), symlinks=False)
        delivery = {**config, 'credentialState': 'issued' if key else 'none', 'deliveryId': str(uuid.uuid4()), 'image': verified['build']['image'], 'baseChecksumDigest': verified['checksumDigest']}
        if tls_ca is not None:
            delivery['tlsCaFile'] = 'tls-ca.pem'
            delivery['tlsCaSha256'] = digest(tls_ca)
            write_private(os.path.join(staging, 'tls-ca.pem'), tls_ca.decode('ascii'))
        if recovery is not None:
            delivery['recovery'] = {'baselineImage': config['baselineImage'], 'instructionsFile': 'RECOVERY.md', 'sha256': digest(recovery)}
            fd = os.open(os.path.join(staging, 'RECOVERY.md'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as handle: handle.write(recovery)
            os.chmod(os.path.join(staging, 'RECOVERY.md'), 0o600)
        write_private(os.path.join(staging, 'instance.json'), json.dumps(delivery, indent=2) + '\n')
        write_private(os.path.join(staging, 'customer-values.yaml'), json.dumps(config['values'], indent=2) + '\n')
        if key:
            os.mkdir(os.path.join(staging, 'credentials'), 0o700)
            write_private(os.path.join(staging, 'credentials', 'webui-bootstrap-token'), key)
            trimmed = key.strip().encode()
            for name in verified['files']:
                if contains_key(os.path.join(base, name), trimmed): fail('CREDENTIAL_IN_PUBLIC_PACKAGE')
            if key.strip() in json.dumps(delivery): fail('CREDENTIAL_IN_PUBLIC_METADATA')
        os.mkdir(os.path.join(staging, 'scripts'), 0o700)
        write_private(os.path.join(staging, 'scripts', 'deploy.sh'), '#!/usr/bin/env bash\nset +x\nset -Eeuo pipefail\nROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"\nexec bash "${ROOT}/package/scripts/deploy.sh" --bundle "${ROOT}" "$@"\n')
        os.chmod(os.path.join(staging, 'scripts', 'deploy.sh'), 0o700)
        write_private(os.path.join(staging, 'README.md'), '# Lucy 客户部署\n\n1. 执行 `bash scripts/deploy.sh`。\n2. 打开实例配置中的 WebUI 地址，输入配套引导密钥并设置首个所有者账号与密码。已有管理员直接登录。\n\n引导密钥由交付人员通过受控渠道提供，凭据附件由部署入口自动配置。不要上传此客户专属目录到公共仓库。\n')
        os.rename(staging, target)
        staging = None
        print(json.dumps({'instanceId': config['instanceId'], 'output': target, 'credentialReused': reused}))
    finally:
        if staging and os.path.isdir(staging): shutil.rmtree(staging)

def main(argv):
    args = {}
    position = 1
    while position < len(argv):
        if argv[position] in ('--base-package', '--instance-config', '--state-dir', '--output') and position + 1 < len(argv):
            args[argv[position][2:]] = argv[position + 1]
            position += 2
        else:
            fail('ARGUMENT_REQUIRED')
    for key in ('base-package', 'instance-config', 'state-dir', 'output'):
        if key not in args: fail('ARGUMENT_REQUIRED')
    prepare(args['base-package'], args['instance-config'], args['state-dir'], args['output'])

if __name__ == '__main__':
    main(sys.argv)
