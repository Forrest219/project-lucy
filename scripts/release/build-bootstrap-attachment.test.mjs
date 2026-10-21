#!/usr/bin/env node
/**
 * Build-time bootstrap attachment regressions (plan 2026-10-20):
 * every customer package build issues or reuses the instance key and ships the
 * private attachment; deployers never hand-generate credentials.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { digest } from './customer-bootstrap-state.mjs';
import { buildAttachment, resolveInstanceId, validCustomer } from './build-bootstrap-attachment.mjs';
import { fixturePackage, instanceFixture } from './customer-bootstrap-state.test.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
async function temp(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lucy-attachment-test-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const args = (root, output, extra = {}) => ({
  customer: 'acme', stateDir: path.join(root, 'supplier-state'),
  output, packageName: 'lucy-k8s-integration-delivery-test-r1.tar.gz',
  packageSha256: digest('outer-tar'), packageBaseChecksumDigest: digest('sha256sums'), ...extra,
});

test('BA-01: first build issues the key, rebuild for the same customer reuses it', async (t) => {
  const root = await temp(t);
  const first = await buildAttachment(args(root, path.join(root, 'attachment-r1')));
  assert.equal(first.credentialState, 'issued');
  assert.equal(first.credentialReused, false);
  const token = await fs.readFile(path.join(first.attachment, 'credentials/webui-bootstrap-token'), 'utf8');
  assert.match(token, /^[a-f0-9]{64}\n$/);
  assert.equal((await fs.stat(path.join(first.attachment, 'credentials/webui-bootstrap-token'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(first.attachment)).mode & 0o777, 0o700);
  const meta = JSON.parse(await fs.readFile(path.join(first.attachment, 'instance-credential.json'), 'utf8'));
  assert.equal(meta.instanceId, first.instanceId);
  assert.equal(meta.keyDigest, digest(token));
  assert.equal(meta.package.sha256, digest('outer-tar'));

  const second = await buildAttachment(args(root, path.join(root, 'attachment-r2'), { packageName: 'lucy-k8s-integration-delivery-test-r2.tar.gz', packageSha256: digest('outer-tar-r2') }));
  assert.equal(second.instanceId, first.instanceId);
  assert.equal(second.credentialReused, true);
  assert.equal(second.keyDigest, first.keyDigest);
  assert.equal(await fs.readFile(path.join(second.attachment, 'credentials/webui-bootstrap-token'), 'utf8'), token);
});

test('BA-02: different customers get independent instances and keys', async (t) => {
  const root = await temp(t);
  const a = await buildAttachment(args(root, path.join(root, 'a')));
  const b = await buildAttachment(args(root, path.join(root, 'b'), { customer: 'globex' }));
  assert.notEqual(a.instanceId, b.instanceId);
  assert.notEqual(a.keyDigest, b.keyDigest);
  assert.equal(validCustomer('globex'), true);
  assert.equal(validCustomer('Bad Name'), false);
});

test('BA-03: existing admin never issues or ships a key', async (t) => {
  const root = await temp(t);
  const result = await buildAttachment(args(root, path.join(root, 'attachment'), { existingAdmin: true }));
  assert.equal(result.credentialState, 'none');
  assert.equal(result.keyDigest, null);
  await assert.rejects(fs.stat(path.join(result.attachment, 'credentials')));
  const meta = JSON.parse(await fs.readFile(path.join(result.attachment, 'instance-credential.json'), 'utf8'));
  assert.equal(meta.credentialState, 'none');
});

test('BA-04: bad identity, existing output, repo paths and bad customers are rejected', async (t) => {
  const root = await temp(t);
  await assert.rejects(buildAttachment(args(root, path.join(root, 'x'), { packageSha256: 'not-hex' })), /PACKAGE_SHA_INVALID/);
  await assert.rejects(buildAttachment(args(root, path.join(root, 'x'), { packageName: '../evil.tar.gz' })), /PACKAGE_NAME_INVALID/);
  await assert.rejects(buildAttachment(args(root, path.join(root, 'x'), { customer: 'Bad Name' })), /CUSTOMER_INVALID/);
  await buildAttachment(args(root, path.join(root, 'x')));
  await assert.rejects(buildAttachment(args(root, path.join(root, 'x'))), /OUTPUT_ALREADY_EXISTS/);
  await assert.rejects(buildAttachment(args(root, path.join(repoRoot, 'inbox', 'leak'))), /PATH_INSIDE_BUILD_OR_CACHE/);
  await assert.rejects(buildAttachment(args(root, repoRoot)), /PATH_INSIDE_GIT/);
});

test('BA-05: the registry keeps the instance id stable without cluster UIDs', async (t) => {
  const root = await temp(t);
  const stateDir = path.join(root, 'supplier-state');
  const id = await resolveInstanceId(stateDir, 'acme');
  assert.match(id, /^acme-[a-f0-9]{8}$/);
  for (let i = 0; i < 3; i++) assert.equal(await resolveInstanceId(stateDir, 'acme'), id);
  await assert.rejects(resolveInstanceId(stateDir, 'Bad Name'), /CUSTOMER_INVALID/);
});

function run(file, argv, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, { ...opts, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...(opts.env || {}) } });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (rc) => rc ? reject(Error(err || `exit ${rc}`)) : resolve({ out, err }));
  });
}

test('BA-06: the shipped prepare entry reuses the attachment key from another cwd', async (t) => {
  const root = await temp(t);
  const base = await fixturePackage(root);
  const built = await buildAttachment(args(root, path.join(root, 'attachment'), { packageBaseChecksumDigest: digest(await fs.readFile(path.join(base, 'SHA256SUMS'), 'utf8')) }));
  const site = instanceFixture();
  delete site.instanceId;
  delete site.credentialState;
  const siteFile = path.join(root, 'site.json');
  await fs.writeFile(siteFile, JSON.stringify(site));
  const entry = path.join(built.attachment, 'scripts/prepare.sh');

  const dry = JSON.parse((await run('bash', [entry, '--package', base, '--config', siteFile, '--output', path.join(root, 'dry'), '--dry-run'], { cwd: '/' })).out.trim().split("\n").filter(Boolean).pop());
  assert.equal(dry.dryRun, true);
  assert.equal(dry.instanceId, built.instanceId);
  assert.equal(dry.credentialReusable, true);
  await assert.rejects(fs.stat(path.join(root, 'dry')));

  const out = path.join(root, 'customer-delivery');
  const done = JSON.parse((await run('bash', [entry, '--package', base, '--config', siteFile, '--output', out], { cwd: '/' })).out.trim().split("\n").filter(Boolean).pop());
  assert.equal(done.instanceId, built.instanceId);
  assert.equal(done.credentialReused, true);
  const delivered = await fs.readFile(path.join(out, 'credentials/webui-bootstrap-token'), 'utf8');
  assert.equal(digest(delivered), built.keyDigest);

  // A site file bound to another real instance must be rejected, and so must a
  // package whose identity does not match the attachment.
  const foreign = { ...site, instanceId: 'other-customer-123' };
  const foreignFile = path.join(root, 'foreign.json');
  await fs.writeFile(foreignFile, JSON.stringify(foreign));
  await assert.rejects(run('bash', [entry, '--package', base, '--config', foreignFile, '--output', path.join(root, 'x')], { cwd: '/' }), /INSTANCE_BINDING_MISMATCH/);
  await assert.rejects(run('bash', [entry, '--package', base, '--config', siteFile, '--output', path.join(root, 'y'), '--bogus'], { cwd: '/' }));
});
