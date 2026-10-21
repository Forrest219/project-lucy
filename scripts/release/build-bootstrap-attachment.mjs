#!/usr/bin/env node
/**
 * Build-time bootstrap credential attachment (supplier side).
 *
 * Reuses customer-bootstrap-state.mjs so a customer delivery always ships its
 * webui-bootstrap-token together with the package: the standard package build
 * calls this after the final archive verification and the C20 gate re-runs the
 * attachment's own prepare entry against the final archive.
 *
 * The attachment is private: dir 0700, files 0600, never prints key material.
 * It never lands in Git, inbox, release/, node_modules, the image build
 * context, or the public package.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DeliveryError, digest, getBootstrapCredential, privateFile, privateLocation, statOrNull, validInstanceId, writePrivate } from './customer-bootstrap-state.mjs';

const fail = (code) => { throw new DeliveryError(code); };
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const validCustomer = (slug) => typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,40}$/.test(slug);

async function ensurePrivateDir(dir) {
  const st = await statOrNull(dir);
  if (!st) { await fs.mkdir(dir, { recursive: true, mode: 0o700 }); return; }
  if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) || st.uid !== process.getuid()) fail('PRIVATE_DIRECTORY_INVALID');
}

async function copyPrivate(src, dst) {
  await writePrivate(dst, await privateFile(src));
}

/**
 * Resolve the stable instance id for a customer: reuse the persisted registry
 * entry, or preallocate and persist a new one. Never depends on cluster UIDs.
 */
export async function resolveInstanceId(stateDir, customer) {
  if (!validCustomer(customer)) fail('CUSTOMER_INVALID');
  const registryDir = path.join(stateDir, 'customers');
  await ensurePrivateDir(registryDir);
  const registryFile = path.join(registryDir, `${customer}.json`);
  const existing = await statOrNull(registryFile);
  if (existing) {
    const record = JSON.parse((await privateFile(registryFile)).toString());
    if (!validInstanceId(record.instanceId)) fail('INSTANCE_REGISTRY_INVALID');
    return record.instanceId;
  }
  const instanceId = `${customer}-${randomBytes(4).toString('hex')}`;
  if (!validInstanceId(instanceId)) fail('INSTANCE_REGISTRY_INVALID');
  try {
    await writePrivate(registryFile, `${JSON.stringify({ instanceId, createdAt: new Date().toISOString() })}\n`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  // A concurrent first run may have persisted another id; the registry wins.
  const written = JSON.parse((await privateFile(registryFile)).toString());
  if (!validInstanceId(written.instanceId)) fail('INSTANCE_REGISTRY_INVALID');
  return written.instanceId;
}

const PREPARE_ENTRY = `#!/usr/bin/env bash
# Lucy 私有附件实例准备入口。从任意 cwd 运行；自动注入实例 ID、签发状态和
# state-dir，部署人员只提供现场参数。绝不打印密钥内容。
set +x
set -Eeuo pipefail
ROOT="$(cd "\$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 - "\$ROOT" "\$@" <<'PY'
import argparse, hashlib, json, os, re, shutil, stat, subprocess, sys, tarfile, tempfile
from pathlib import Path, PurePosixPath

def fail(code):
    print(code, file=sys.stderr)
    raise SystemExit(1)

def digest_bytes(data):
    return hashlib.sha256(data).hexdigest()

def stream_sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def lstat(path):
    try: return os.lstat(path)
    except FileNotFoundError: return None

def private_file(path):
    st = lstat(path)
    if not st or not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode) or (st.st_mode & 0o077) or st.st_uid != os.getuid():
        fail('PRIVATE_FILE_INVALID')
    return Path(path).read_bytes()

parser = argparse.ArgumentParser(prog='prepare.sh')
parser.add_argument('--package', required=True, help='提取后的软件目录或软件 .tar.gz')
parser.add_argument('--config', required=True, help='现场实例 JSON（context/UID/访问地址等）')
parser.add_argument('--output', required=True, help='新的客户目录（不得已存在）')
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args(sys.argv[2:])

root = Path(sys.argv[1]).resolve()
meta = json.loads(private_file(root / 'instance-credential.json'))
site = json.loads(Path(args.config).resolve().read_bytes())

# The attachment owns the credential identity. A site file that already carries
# a *real* instance id means this attachment was mixed with another customer's
# delivery and must be rejected; placeholder example values are overwritten.
if site.get('instanceId') and site['instanceId'] != 'must-replace-instance' \\
        and site['instanceId'] != meta['instanceId']:
    fail('INSTANCE_BINDING_MISMATCH')
site['instanceId'] = meta['instanceId']
site['credentialState'] = meta['credentialState']

package_arg = Path(args.package).resolve()
extracted = None
if package_arg.is_file():
    if not str(package_arg).endswith('.tar.gz'): fail('PACKAGE_ARCHIVE_INVALID')
    if stream_sha(package_arg) != meta['package']['sha256']: fail('PACKAGE_BINDING_MISMATCH')
    extracted = Path(tempfile.mkdtemp(prefix='lucy-attachment-pkg-', dir=str(root.parent.resolve())))
    with tarfile.open(package_arg, 'r:gz') as tar:
        for member in tar.getmembers():
            p = PurePosixPath(member.name)
            if not (member.isfile() or member.isdir()) or p.is_absolute() or '..' in p.parts: fail('ARCHIVE_SPECIAL_PATH')
            if any(part.startswith('._') or part in {'.DS_Store', '__MACOSX', 'credentials'} or part.endswith(('.pyc', '.pyo')) for part in p.parts): fail('ARCHIVE_JUNK_OR_CREDENTIAL')
        tar.extractall(extracted)
    roots = [p for p in extracted.iterdir() if p.is_dir()]
    if len(roots) != 1: fail('ARCHIVE_ROOT_COUNT')
    base = roots[0]
    if stream_sha(base / 'SHA256SUMS') != meta['package']['baseChecksumDigest']: fail('PACKAGE_BINDING_MISMATCH')
elif package_arg.is_dir():
    base = package_arg
    if stream_sha(base / 'SHA256SUMS') != meta['package']['baseChecksumDigest']: fail('PACKAGE_BINDING_MISMATCH')
else:
    fail('PACKAGE_NOT_FOUND')

state_dir = root / meta.get('stateDir', 'state')
if meta['credentialState'] == 'issued':
    # The attachment must still be able to reuse its own key material.
    entry = state_dir / 'instances' / meta['instanceId']
    ledger = state_dir / 'issued' / (meta['instanceId'] + '.json')
    record = json.loads(private_file(entry / 'record.json'))
    marker = json.loads(private_file(ledger))
    key = private_file(entry / 'bootstrap-token')
    if record.get('instanceId') != meta['instanceId'] or marker.get('instanceId') != meta['instanceId'] \\
            or not re.fullmatch(rb'[a-f0-9]{64}\\n', key) or record.get('keyDigest') != digest_bytes(key):
        fail('CREDENTIAL_STATE_INVALID')

merged_dir = Path(tempfile.mkdtemp(prefix='lucy-attachment-merge-', dir=str(root.parent.resolve())))
try:
    merged = merged_dir / 'instance.json'
    fd = os.open(merged, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as handle: handle.write(json.dumps(site, indent=2) + '\\n')
    if args.dry_run:
        print(json.dumps({'dryRun': True, 'instanceId': meta['instanceId'], 'credentialState': meta['credentialState'],
                          'credentialReusable': meta['credentialState'] == 'issued'}))
        raise SystemExit(0)
    result = subprocess.run(['python3', str(base / 'scripts/prepare-customer-instance.py'),
        '--base-package', str(base), '--instance-config', str(merged),
        '--state-dir', str(state_dir), '--output', args.output], capture_output=True, text=True)
    if result.returncode:
        sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode)
    reused = json.loads(result.stdout.strip().splitlines()[-1])['credentialReused']
    if meta['credentialState'] == 'issued':
        delivered = digest_bytes(private_file(Path(args.output) / 'credentials/webui-bootstrap-token'))
        if delivered != meta['keyDigest']: fail('DELIVERED_CREDENTIAL_MISMATCH')
    print(json.dumps({'instanceId': meta['instanceId'], 'output': str(Path(args.output).resolve()),
                      'credentialReused': reused, 'credentialState': meta['credentialState']}))
finally:
    shutil.rmtree(merged_dir, ignore_errors=True)
    if extracted: shutil.rmtree(extracted, ignore_errors=True)
PY
`;

const README = (packageName) => `# Lucy 客户私有交付附件（引导密钥）

本目录随 ${packageName} 成套交付，二者必须一起交给该实例部署人员，不要上传到公共仓库、CI 制品或镜像。
目录 0700、文件 0600；不要改动其中任何文件。

## 内容

- credentials/webui-bootstrap-token：该实例的引导密钥（64 位十六进制）。供应方已签发或复用，部署人员不需要生成密钥。
- credentials/record.json：签发记录（实例 ID、issueId、密钥摘要）。
- state/：本附件自带的签发状态副本，供准备入口复用同一密钥；损坏或缺失时停止并联系供应方，不要手工重建。
- instance-credential.json：凭据元数据（实例 ID、签发状态、密钥摘要、软件包绑定）。
- scripts/prepare.sh：实例准备入口，从任意目录运行，自动注入实例 ID、签发状态和 state-dir。
- examples/：实例与恢复说明样例。

## 部署人员步骤

1. 解压通用软件包（tar.gz），校验其 SHA256 与本附件记录的 package.sha256 一致。
2. 复制 examples/instance.upgrade.http.example.json（或 https），把 MUST-REPLACE 字段换成现场参数：
   context、UID、旧镜像、访问地址、节点映射和恢复说明。不要填写 instanceId 和 credentialState。
3. 从任意目录执行准备入口（先用 --dry-run 核对）：
   bash <本附件>/scripts/prepare.sh --package <软件包.tar.gz 或解压目录> --config <现场实例.json> --output <新的客户目录>
   入口自动校验软件包绑定、复用本附件的引导密钥并生成客户目录。
4. 在客户目录执行 bash scripts/deploy.sh --dry-run，通过后执行 bash scripts/deploy.sh。
5. 打开 WebUI 地址，输入引导密钥创建首个所有者。已有管理员的实例不签发密钥，直接登录。

软件包绑定不符、实例绑定冲突或签发状态损坏时入口会明确失败并停止，不要绕过。
`;

export async function buildAttachment({ customer, stateDir, output, packageName, packageSha256, packageBaseChecksumDigest, existingAdmin = false, dryRun = false }) {
  if (!/^[a-f0-9]{64}$/.test(packageSha256 || '')) fail('PACKAGE_SHA_INVALID');
  if (!/^[a-f0-9]{64}$/.test(packageBaseChecksumDigest || '')) fail('PACKAGE_DIGEST_INVALID');
  if (!packageName || packageName !== path.basename(packageName) || packageName.includes('..') || packageName.startsWith('.')) fail('PACKAGE_NAME_INVALID');
  const root = await privateLocation(stateDir);
  const target = await privateLocation(output);
  if (await statOrNull(target)) fail('OUTPUT_ALREADY_EXISTS');
  const instanceId = await resolveInstanceId(root, customer);
  const credentialState = existingAdmin ? 'none' : 'new';
  const credential = await getBootstrapCredential({ stateDir: root, instanceId, credentialState, dryRun });
  if (dryRun) return { dryRun: true, instanceId, credentialState, credentialReused: credential.reused, output: target };

  const keyDigest = credential.key ? digest(credential.key) : null;
  const issueId = credential.key ? JSON.parse((await privateFile(path.join(root, 'issued', `${instanceId}.json`))).toString()).issueId : null;
  if (credential.key && !/^[a-f0-9]{64}\n$/.test(credential.key)) fail('RANDOM_SOURCE_INVALID');
  const createdAt = new Date().toISOString();
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const staging = await fs.mkdtemp(path.join(path.dirname(target), `.${path.basename(target)}-`));
  try {
    await fs.chmod(staging, 0o700);
    if (credential.key) {
      await fs.mkdir(path.join(staging, 'credentials'), { mode: 0o700 });
      await writePrivate(path.join(staging, 'credentials', 'webui-bootstrap-token'), credential.key);
      const record = { instanceId, issueId, keyDigest, createdAt };
      await writePrivate(path.join(staging, 'credentials', 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
      // Portable issuance state so the prepare entry reuses the same key on any machine.
      await fs.mkdir(path.join(staging, 'state', 'instances', instanceId), { recursive: true, mode: 0o700 });
      await fs.mkdir(path.join(staging, 'state', 'issued'), { mode: 0o700 });
      await fs.mkdir(path.join(staging, 'state', 'locks'), { mode: 0o700 });
      await copyPrivate(path.join(root, 'instances', instanceId, 'bootstrap-token'), path.join(staging, 'state', 'instances', instanceId, 'bootstrap-token'));
      await copyPrivate(path.join(root, 'instances', instanceId, 'record.json'), path.join(staging, 'state', 'instances', instanceId, 'record.json'));
      await copyPrivate(path.join(root, 'issued', `${instanceId}.json`), path.join(staging, 'state', 'issued', `${instanceId}.json`));
      // The copied state must independently reproduce the issued key.
      const copyKey = await privateFile(path.join(staging, 'state', 'instances', instanceId, 'bootstrap-token'));
      if (digest(copyKey) !== keyDigest) fail('CREDENTIAL_STATE_INVALID');
    }
    const meta = {
      schemaVersion: 1,
      customer,
      instanceId,
      credentialState: credential.key ? 'issued' : 'none',
      keyDigest,
      issueId,
      package: { name: packageName, sha256: packageSha256, baseChecksumDigest: packageBaseChecksumDigest },
      stateDir: 'state',
      createdAtUtc: createdAt,
    };
    await writePrivate(path.join(staging, 'instance-credential.json'), `${JSON.stringify(meta, null, 2)}\n`);
    await fs.mkdir(path.join(staging, 'scripts'), { mode: 0o700 });
    await writePrivate(path.join(staging, 'scripts', 'prepare.sh'), PREPARE_ENTRY);
    await fs.chmod(path.join(staging, 'scripts', 'prepare.sh'), 0o700);
    await fs.mkdir(path.join(staging, 'examples'), { mode: 0o700 });
    for (const file of ['instance.upgrade.http.example.json', 'instance.upgrade.https.example.json', 'RECOVERY.open-mode.md']) {
      await writePrivate(path.join(staging, 'examples', file), await fs.readFile(path.join(REPO_ROOT, 'deploy/k8s/examples', file)));
    }
    await writePrivate(path.join(staging, 'README.md'), README(packageName));
    await fs.rename(staging, target);
    return { attachment: target, instanceId, credentialState: meta.credentialState, credentialReused: credential.reused, keyDigest, packageName };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        customer: { type: 'string', default: 'customer' },
        'state-dir': { type: 'string', default: path.join(process.env.HOME || '', '.lucy', 'customer-credentials') },
        output: { type: 'string' },
        'package-name': { type: 'string' },
        'package-sha256': { type: 'string' },
        'package-base-checksum': { type: 'string' },
        'existing-admin': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean' },
      },
    });
    if (values.help) {
      console.log('build-bootstrap-attachment.mjs --output <new-private-dir> --package-name <file> --package-sha256 <hex> --package-base-checksum <hex> [--customer <slug>] [--state-dir <private-dir>] [--existing-admin] [--dry-run]');
    } else {
      for (const key of ['output', 'package-name', 'package-sha256', 'package-base-checksum']) if (!values[key]) fail('ARGUMENT_REQUIRED');
      console.log(JSON.stringify(await buildAttachment({
        customer: values.customer,
        stateDir: values['state-dir'],
        output: values.output,
        packageName: values['package-name'],
        packageSha256: values['package-sha256'],
        packageBaseChecksumDigest: values['package-base-checksum'],
        existingAdmin: values['existing-admin'],
        dryRun: values['dry-run'],
      })));
    }
  } catch (error) {
    console.error(`[bootstrap-attachment] ${error instanceof DeliveryError ? error.code : 'ATTACHMENT_FAILED'}`);
    process.exitCode = 1;
  }
}
