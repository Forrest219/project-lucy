#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DeliveryError, digest, getBootstrapCredential, privateLocation, statOrNull, validInstanceId, writePrivate } from './customer-bootstrap-state.mjs';

const fail = (code) => { throw new DeliveryError(code); };
const names = ['namespace', 'release', 'deployment', 'service', 'pvcName', 'bootstrapSecret'];

export function validateInstance(c) {
  if (c.schemaVersion !== 1 || !validInstanceId(c.instanceId) || !['k8s', 'k3s'].includes(c.profile) || !['install', 'upgrade'].includes(c.intent) || !['uninitialized', 'configured'].includes(c.authState)) fail('INSTANCE_CONFIG_INVALID');
  if (names.some((key) => typeof c[key] !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,61}[a-z0-9]$/.test(c[key]))) fail('RESOURCE_NAME_INVALID');
  if (typeof c.context !== 'string' || !c.context.trim() || /[\r\n\0]/.test(c.context)) fail('CONTEXT_INVALID');
  for (const key of ['webuiUrl', 'publicMcpUrl']) {
    const u = new URL(c[key]);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) fail('HTTPS_URL_REQUIRED');
  }
  if (!c.values || typeof c.values !== 'object' || Array.isArray(c.values)) fail('CUSTOMER_VALUES_REQUIRED');
  if (c.authState === 'configured' && c.credentialState !== 'none') fail('EXISTING_ADMIN_MUST_NOT_ISSUE_KEY');
  if (c.authState === 'uninitialized' && !['new', 'issued'].includes(c.credentialState)) fail('CREDENTIAL_INTENT_INVALID');
  if (c.intent === 'install' && c.authState !== 'uninitialized') fail('INSTALL_STATE_INVALID');
  if (c.intent === 'install' && (c.pvcName !== `${c.deployment}-data` || c.values.persistence?.existingClaim)) fail('NEW_INSTALL_PVC_NAME_INVALID');
  if (c.intent === 'upgrade' && (!c.namespaceUid || !c.deploymentUid || !c.pvcUid || !c.baselineImage || !c.backup || !c.recovery)) fail('UPGRADE_BASELINE_REQUIRED');
  if (c.intent === 'upgrade' && (c.backup.method !== 'quiesced-pvc-tar' || c.recovery.baselineImage !== c.baselineImage || typeof c.recovery.instructionsFile !== 'string')) fail('UPGRADE_RECOVERY_CONTRACT_REQUIRED');
  if (c.values.security?.insecureHttpTestProfile || c.values.env?.LUCY_DEPLOYMENT_MODE === 'development' || c.values.extraSecretData && Object.keys(c.values.extraSecretData).length) fail('CUSTOMER_POLICY_INVALID');
  if (Object.keys(c.values.env ?? {}).some((key) => /(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)$/.test(key))) fail('PLAINTEXT_SECRET_IN_VALUES');
  return c;
}

async function hashFile(file) {
  const h = createHash('sha256');
  for await (const block of createReadStream(file)) h.update(block);
  return h.digest('hex');
}

async function containsKey(file, key) {
  let tail = Buffer.alloc(0);
  for await (const block of createReadStream(file)) {
    const data = Buffer.concat([tail, block]);
    if (data.includes(key)) return true;
    tail = data.subarray(Math.max(0, data.length - key.length));
  }
  return false;
}

export async function packageFiles(base) {
  const out = [];
  async function walk(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, item.name);
      if (item.isSymbolicLink() || !item.isFile() && !item.isDirectory()) fail('PACKAGE_SPECIAL_FILE');
      if (item.isDirectory()) { if (['.git', 'credentials', 'node_modules'].includes(item.name)) fail('PACKAGE_PRIVATE_DIRECTORY'); await walk(abs); }
      else out.push(path.relative(base, abs).split(path.sep).join('/'));
    }
  }
  await walk(base);
  return out.sort();
}

export async function verifyBasePackage(base) {
  if (!(await fs.lstat(base)).isDirectory()) fail('EXTRACTED_BASE_PACKAGE_REQUIRED');
  const files = await packageFiles(base);
  const sums = await fs.readFile(path.join(base, 'SHA256SUMS'), 'utf8');
  const listed = new Map();
  for (const line of sums.trim().split('\n')) {
    const m = /^([a-f0-9]{64}) [ *](?:\.\/)?(.+)$/.exec(line);
    if (!m || m[2].startsWith('/') || m[2].split('/').includes('..') || listed.has(m[2])) fail('PACKAGE_CHECKSUM_LIST_INVALID');
    listed.set(m[2], m[1]);
  }
  if (files.some((f) => f !== 'SHA256SUMS' && !listed.has(f)) || [...listed.keys()].some((f) => !files.includes(f))) fail('PACKAGE_UNTRACKED_FILE');
  for (const [file, hash] of listed) if (await hashFile(path.join(base, file)) !== hash) fail('PACKAGE_CHECKSUM_MISMATCH');
  for (const required of ['BUILD-INFO.json', 'helm/lucy/Chart.yaml', 'scripts/deploy.sh', 'scripts/customer-deployment-helper.py', 'scripts/probe-customer-auth-state.mjs']) if (!files.includes(required)) fail('PACKAGE_DEPLOY_ENTRY_MISSING');
  const build = JSON.parse(await fs.readFile(path.join(base, 'BUILD-INFO.json'), 'utf8'));
  const i = build.image;
  if (!i || i.platform !== 'linux/amd64' || !/^sha256:[a-f0-9]{64}$/.test(i.configId) || !['offline', 'registry'].includes(i.deliveryMode)) fail('PACKAGE_IMAGE_INVALID');
  if (i.deliveryMode === 'registry' && (!/^sha256:[a-f0-9]{64}$/.test(i.registryManifestDigest) || i.registryManifestDigest === i.configId)) fail('REGISTRY_DIGEST_INVALID');
  if (i.deliveryMode === 'offline' && !/^[a-f0-9]{64}$/.test(i.tarSha256)) fail('OFFLINE_IMAGE_HASH_INVALID');
  const imageArchives = files.filter((f) => f.startsWith('image/') && f.endsWith('.tar'));
  if (i.deliveryMode === 'offline' && (imageArchives.length !== 1 || listed.get(imageArchives[0]) !== i.tarSha256)) fail('OFFLINE_IMAGE_METADATA_MISMATCH');
  return { build, files, checksumDigest: digest(sums) };
}

export async function prepareDelivery({ basePackage, instanceConfig, stateDir, output, dryRun = false }) {
  const c = validateInstance(JSON.parse(await fs.readFile(instanceConfig, 'utf8')));
  const base = path.resolve(basePackage);
  const target = await privateLocation(output);
  await privateLocation(stateDir);
  if (await statOrNull(target)) fail('OUTPUT_ALREADY_EXISTS');
  const verified = await verifyBasePackage(base);
  let tlsCa;
  if (c.tlsCaFile) {
    const file = path.resolve(path.dirname(path.resolve(instanceConfig)), c.tlsCaFile);
    const st = await fs.lstat(file);
    if (!st.isFile() || st.isSymbolicLink()) fail('TLS_CA_FILE_INVALID');
    tlsCa = await fs.readFile(file);
    if (!tlsCa.toString().includes('-----BEGIN CERTIFICATE-----') || tlsCa.toString().includes('PRIVATE KEY')) fail('TLS_CA_FILE_INVALID');
  }
  let recoveryInstructions;
  if (c.intent === 'upgrade') {
    const file = path.resolve(path.dirname(path.resolve(instanceConfig)), c.recovery.instructionsFile);
    const st = await fs.lstat(file);
    if (!st.isFile() || st.isSymbolicLink()) fail('RECOVERY_INSTRUCTIONS_INVALID');
    recoveryInstructions = await fs.readFile(file);
    if (!recoveryInstructions.length) fail('RECOVERY_INSTRUCTIONS_INVALID');
  }
  // Everything that can be checked without credentials runs before signing a new record.
  const state = path.resolve(stateDir);
  if (target === base || target.startsWith(`${base}${path.sep}`) || state === target || state.startsWith(`${target}${path.sep}`) || target.startsWith(`${state}${path.sep}`)) fail('OVERLAPPING_DELIVERY_PATHS');
  const credential = await getBootstrapCredential({ stateDir, instanceId: c.instanceId, credentialState: c.credentialState, dryRun });
  if (dryRun) return { dryRun: true, instanceId: c.instanceId, credentialReused: credential.reused };
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const staging = await fs.mkdtemp(path.join(path.dirname(target), '.lucy-delivery-'));
  try {
    await fs.cp(base, path.join(staging, 'package'), { recursive: true, dereference: false });
    const delivery = { ...c, credentialState: credential.key ? 'issued' : 'none', deliveryId: randomUUID(), image: verified.build.image, baseChecksumDigest: verified.checksumDigest };
    if (tlsCa) {
      delivery.tlsCaFile = 'tls-ca.pem';
      delivery.tlsCaSha256 = digest(tlsCa);
      await writePrivate(path.join(staging, 'tls-ca.pem'), tlsCa);
    }
    if (recoveryInstructions) {
      delivery.recovery = { baselineImage: c.baselineImage, instructionsFile: 'RECOVERY.md', sha256: digest(recoveryInstructions) };
      await writePrivate(path.join(staging, 'RECOVERY.md'), recoveryInstructions);
    }
    await writePrivate(path.join(staging, 'instance.json'), `${JSON.stringify(delivery, null, 2)}\n`);
    await writePrivate(path.join(staging, 'customer-values.yaml'), `${JSON.stringify(c.values, null, 2)}\n`); // JSON is a YAML subset.
    if (credential.key) {
      await fs.mkdir(path.join(staging, 'credentials'), { mode: 0o700 });
      await writePrivate(path.join(staging, 'credentials', 'webui-bootstrap-token'), credential.key);
      for (const file of verified.files) {
        if (await containsKey(path.join(base, file), Buffer.from(credential.key.trim()))) fail('CREDENTIAL_IN_PUBLIC_PACKAGE');
      }
      if (JSON.stringify(delivery).includes(credential.key.trim())) fail('CREDENTIAL_IN_PUBLIC_METADATA');
    }
    await fs.mkdir(path.join(staging, 'scripts'), { mode: 0o700 });
    await writePrivate(path.join(staging, 'scripts', 'deploy.sh'), '#!/usr/bin/env bash\nset +x\nset -Eeuo pipefail\nROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"\nexec bash "${ROOT}/package/scripts/deploy.sh" --bundle "${ROOT}" "$@"\n');
    await fs.chmod(path.join(staging, 'scripts', 'deploy.sh'), 0o700);
    await writePrivate(path.join(staging, 'README.md'), '# Lucy 客户部署\n\n1. 执行 `bash scripts/deploy.sh`。\n2. 打开部署结果中的 HTTPS 地址，输入配套引导密钥并设置首个所有者账号与密码。已有管理员直接登录。\n\n引导密钥由交付人员通过受控渠道提供，凭据附件由部署入口自动配置。不要上传此客户专属目录到公共仓库。\n');
    await fs.rename(staging, target);
    return { dryRun: false, instanceId: c.instanceId, deliveryId: delivery.deliveryId, credentialReused: credential.reused, output: target };
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'base-package': { type: 'string' }, 'instance-config': { type: 'string' }, 'state-dir': { type: 'string' }, output: { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean' } } });
    if (values.help) { console.log('prepare-customer-delivery.mjs --base-package <extracted-dir> --instance-config <json> --state-dir <private-dir> --output <new-private-dir> [--dry-run]'); }
    else {
      for (const key of ['base-package', 'instance-config', 'state-dir', 'output']) if (!values[key]) fail('ARGUMENT_REQUIRED');
      console.log(JSON.stringify(await prepareDelivery({ basePackage: values['base-package'], instanceConfig: values['instance-config'], stateDir: values['state-dir'], output: values.output, dryRun: values['dry-run'] })));
    }
  } catch (error) { console.error(`[customer-delivery] ${error instanceof DeliveryError ? error.code : 'PREPARATION_FAILED'}`); process.exitCode = 1; }
}
