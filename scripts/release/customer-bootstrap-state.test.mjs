import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getBootstrapCredential, digest } from './customer-bootstrap-state.mjs';
import { prepareDelivery, validateInstance, verifyBasePackage } from './prepare-customer-delivery.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
async function temp(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lucy-delivery-test-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('BS-01/02/03: issue once per instance, reuse across deliveries, keep independent instances', async (t) => {
  const stateDir = path.join(await temp(t), 'state');
  const a = await getBootstrapCredential({ stateDir, instanceId: 'customer-a', credentialState: 'new' });
  assert.match(a.key, /^[a-f0-9]{64}\n$/);
  const b = await getBootstrapCredential({ stateDir, instanceId: 'customer-a', credentialState: 'issued' });
  const c = await getBootstrapCredential({ stateDir, instanceId: 'customer-b', credentialState: 'new' });
  assert.equal(a.key, b.key);
  assert.equal(b.reused, true);
  assert.notEqual(a.key, c.key);
  assert.equal((await fs.stat(path.join(stateDir, 'instances/customer-a/bootstrap-token'))).mode & 0o777, 0o600);
});
test('BS-04: concurrent processes never issue two keys for one instance', async (t) => {
  const root = await temp(t);
  const stateDir = path.join(root, 'state');
  const module = new URL('./customer-bootstrap-state.mjs', import.meta.url).href;
  const code = `import {getBootstrapCredential,digest} from ${JSON.stringify(module)}; const r=await getBootstrapCredential({stateDir:process.argv[1],instanceId:'concurrent',credentialState:'new'}); console.log(digest(r.key));`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, stateDir]);
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', rc => rc ? reject(Error(err)) : resolve(out));
  });
  const results = await Promise.all([run(), run()]);
  assert.equal(results[0], results[1]);
});
test('BS-05: missing issued key, corrupt key, symlinks and unknown locks fail without replacement', async (t) => {
  for (const mode of ['missing', 'empty', 'symlink', 'lock']) {
    const root = await temp(t), stateDir = path.join(root, 'state');
    const args = { stateDir, instanceId: 'customer-one', credentialState: 'new' };
    await getBootstrapCredential(args);
    const keyFile = path.join(stateDir, 'instances/customer-one/bootstrap-token');
    if (mode === 'missing') await fs.unlink(keyFile);
    if (mode === 'empty') await fs.writeFile(keyFile, '');
    if (mode === 'symlink') { await fs.unlink(keyFile); await fs.symlink(path.join(root, 'other'), keyFile); }
    if (mode === 'lock') await fs.mkdir(path.join(stateDir, 'locks/customer-one'));
    await assert.rejects(getBootstrapCredential(args));
    if (mode === 'missing' || mode === 'symlink') await assert.rejects(fs.readFile(keyFile));
    if (mode === 'empty') assert.equal(await fs.readFile(keyFile, 'utf8'), '');
  }
});
test('BS-03/18: random source failure and dry-run never issue credentials', async (t) => {
  const root = await temp(t), stateDir = path.join(root, 'state');
  const args = { stateDir, instanceId: 'customer-one', credentialState: 'new' };
  await getBootstrapCredential({ ...args, dryRun: true });
  await assert.rejects(fs.stat(stateDir));
  await assert.rejects(getBootstrapCredential({ ...args, random() { throw Error('entropy unavailable'); } }));
  await assert.rejects(fs.stat(path.join(stateDir, 'issued/customer-one.json')));
});
test('existing admin upgrade does not generate a key, even when no state directory exists', async (t) => {
  const stateDir = path.join(await temp(t), 'state');
  assert.equal((await getBootstrapCredential({ stateDir, instanceId: 'existing-admin', credentialState: 'none' })).key, null);
  await assert.rejects(fs.stat(stateDir));
});

export async function fixturePackage(root) {
  const base = path.join(root, 'base');
  const files = {
    'BUILD-INFO.json': JSON.stringify({ image: { repository: 'project-lucy', tag: 'customer-test', platform: 'linux/amd64', configId: 'sha256:' + 'a'.repeat(64), registryManifestDigest: null, deliveryMode: 'offline', tarSha256: digest('dummy-image') } }),
    'helm/lucy/Chart.yaml': 'apiVersion: v2\nname: lucy\nversion: 0.2.4\n',
    'scripts/deploy.sh': await fs.readFile(path.join(scriptDir, '../deploy/deploy-customer-k8s.sh'), 'utf8'),
    'scripts/customer-deployment-helper.py': await fs.readFile(path.join(scriptDir, '../deploy/customer-deployment-helper.py'), 'utf8'),
    'scripts/image_identity.py': await fs.readFile(path.join(scriptDir, '../deploy/image_identity.py'), 'utf8'),
    'scripts/probe-customer-auth-state.mjs': await fs.readFile(path.join(scriptDir, '../deploy/probe-customer-auth-state.mjs'), 'utf8'),
    'scripts/prepare-customer-instance.py': await fs.readFile(path.join(scriptDir, '../deploy/prepare-customer-instance.py'), 'utf8'),
    'image/test.tar': 'dummy-image'
  };
  for (const [name, data] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(base, name)), { recursive: true }); await fs.writeFile(path.join(base, name), data); }
  await fs.writeFile(path.join(base, 'SHA256SUMS'), Object.entries(files).map(([name, data]) => `${digest(data)}  ./${name}\n`).join(''));
  return base;
}
export const instanceFixture = () => ({ schemaVersion: 1, instanceId: 'customer-one', profile: 'k3s', intent: 'install', authState: 'uninitialized', credentialState: 'new', context: 'customer-cluster', namespace: 'lucy-test', release: 'lucy-release', deployment: 'lucy-app', service: 'lucy-app', pvcName: 'lucy-app-data', bootstrapSecret: 'lucy-bootstrap', access: 'https', webuiUrl: 'https://lucy.example.test', publicMcpUrl: 'https://lucy.example.test/mcp', values: { persistence: { enabled: true }, env: {} } });

test('BS-06: private assembly leaves the verified base unchanged and supplies a standalone entry', async (t) => {
  const root = await temp(t), base = await fixturePackage(root);
  const config = path.join(root, 'customer.json');
  await fs.writeFile(config, JSON.stringify(instanceFixture()));
  const opts = { basePackage: base, instanceConfig: config, stateDir: path.join(root, 'state'), output: path.join(root, 'delivery') };
  await prepareDelivery(opts);
  const token = await fs.readFile(path.join(opts.output, 'credentials/webui-bootstrap-token'), 'utf8');
  assert.match(token, /^[a-f0-9]{64}\n$/);
  assert.equal((await fs.stat(path.join(opts.output, 'credentials/webui-bootstrap-token'))).mode & 0o777, 0o600);
  assert.ok(!(await fs.readFile(path.join(opts.output, 'instance.json'), 'utf8')).includes(token.trim()));
  assert.ok(!(await fs.readFile(path.join(opts.output, 'README.md'), 'utf8')).includes(token.trim()));
  await new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.PYTHONDONTWRITEBYTECODE;
    const child = spawn('bash', [path.join(opts.output, 'scripts/deploy.sh'), '--help'], { env });
    let err = '';
    child.stdout.resume();
    child.stderr.on('data', d => { err += d; });
    child.on('close', rc => rc ? reject(Error(err)) : resolve());
  });
  await assert.rejects(fs.stat(path.join(opts.output, 'package/scripts/__pycache__')));
  await verifyBasePackage(base);
  await prepareDelivery({ ...opts, output: path.join(root, 'second') });
  assert.equal(await fs.readFile(path.join(root, 'second/credentials/webui-bootstrap-token'), 'utf8'), token);
  await assert.rejects(prepareDelivery(opts), /OUTPUT_ALREADY_EXISTS/);
});
test('BS-06/18: tampering is rejected and dry-run leaves no output or state', async (t) => {
  const root = await temp(t), base = await fixturePackage(root), config = path.join(root, 'instance.json');
  await fs.writeFile(config, JSON.stringify(instanceFixture()));
  const opts = { basePackage: base, instanceConfig: config, stateDir: path.join(root, 'state'), output: path.join(root, 'delivery'), dryRun: true };
  await prepareDelivery(opts);
  await assert.rejects(fs.stat(opts.stateDir));
  await assert.rejects(fs.stat(opts.output));
  await fs.writeFile(path.join(base, 'image/test.tar'), 'changed');
  await assert.rejects(prepareDelivery(opts), /CHECKSUM_MISMATCH/);
});
test('wrong intent, plaintext secrets, insecure policy and incomplete upgrade identity are rejected', () => {
  for (const patch of [{ authState: 'configured' }, { webuiUrl: 'http://customer.test' }, { access: 'http' }, { intent: 'upgrade' }, { values: { env: { LUCY_WEBUI_SESSION_SECRET: 'do-not-store-me' } } }, { values: { security: { insecureHttpTestProfile: true }, env: {} } }]) {
    assert.throws(() => validateInstance({ ...instanceFixture(), ...patch }));
  }
});
test('intranet HTTP is an explicit customer access mode and must match both URLs', () => {
  const http = { ...instanceFixture(), access: 'http', webuiUrl: 'http://lucy.internal', publicMcpUrl: 'http://lucy.internal/mcp' };
  assert.equal(validateInstance(http).values.security.access, 'http');
  assert.throws(() => validateInstance({ ...http, publicMcpUrl: 'https://lucy.internal/mcp' }));
  assert.throws(() => validateInstance({ ...instanceFixture(), access: 'cleartext' }));
});
test('an uninitialized upgrade must record that the old open-mode baseline was reviewed', () => {
  const upgrade = { ...instanceFixture(), intent: 'upgrade', namespaceUid: 'ns', deploymentUid: 'dep', pvcUid: 'pvc', baselineImage: 'project-lucy:old', backup: { method: 'quiesced-pvc-tar' }, recovery: { baselineImage: 'project-lucy:old', instructionsFile: 'RECOVERY.md' } };
  assert.throws(() => validateInstance(upgrade), /LEGACY_BASELINE_REVIEW_REQUIRED/);
  assert.equal(validateInstance({ ...upgrade, legacyBaselineReviewed: true }).intent, 'upgrade');
});
test('python prepare writes a credential the node issuer can reuse', async (t) => {
  const root = await temp(t), base = await fixturePackage(root);
  const config = path.join(root, 'customer.json');
  await fs.writeFile(config, JSON.stringify(instanceFixture()));
  const stateDir = path.join(root, 'state');
  const output = path.join(root, 'out');
  await new Promise((resolve, reject) => {
    const child = spawn('python3', [path.join(scriptDir, '../deploy/prepare-customer-instance.py'), '--base-package', base, '--instance-config', config, '--state-dir', stateDir, '--output', output]);
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.resume();
    child.on('close', (rc) => rc ? reject(Error(err || `python exited ${rc}`)) : resolve());
  });
  const token = await fs.readFile(path.join(output, 'credentials/webui-bootstrap-token'), 'utf8');
  const reused = await getBootstrapCredential({ stateDir, instanceId: 'customer-one', credentialState: 'issued' });
  assert.equal(reused.key, token);
  assert.equal(reused.reused, true);
  const delivery = JSON.parse(await fs.readFile(path.join(output, 'instance.json'), 'utf8'));
  assert.equal(delivery.credentialState, 'issued');
  assert.equal(delivery.image.platform, 'linux/amd64');
  assert.equal(JSON.parse(await fs.readFile(path.join(output, 'customer-values.yaml'), 'utf8')).security.access, 'https');
});
