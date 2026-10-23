import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { probeAuthState } from './probe-customer-auth-state.mjs';

const dependencyRoot = path.resolve(new URL('../../webui/', import.meta.url).pathname);
const require = createRequire(path.join(dependencyRoot, 'package.json'));
const Database = require('better-sqlite3');
async function fixture(t, yaml = 'admins: []\n', state = null) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lucy-auth-probe-'));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  await fs.mkdir(path.join(root, 'webui/config'), { recursive: true });
  await fs.writeFile(path.join(root, 'webui/config/admins.yaml'), yaml);
  if (state) {
    await fs.mkdir(path.join(root, '.ktx-ui'));
    const db = new Database(path.join(root, '.ktx-ui/security.sqlite'));
    db.exec("CREATE TABLE schema_meta(key TEXT, value TEXT); INSERT INTO schema_meta VALUES('schema_version','1'); CREATE TABLE bootstrap_state(id INTEGER, state TEXT); CREATE TABLE admin_account_state(account_uid TEXT);");
    db.prepare('INSERT INTO bootstrap_state VALUES(1,?)').run(state);
    db.close();
  }
  return { root, dependencyRoot };
}
test('BS-07: reviewed legacy no-admin state is observed without creating a security database', async t => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.root, 'webui/config/admins.yaml'));
  assert.equal(probeAuthState({ ...f, legacyAllowed: true }).status, 'uninitialized');
  assert.deepEqual(await fs.readFile(path.join(f.root, 'webui/config/admins.yaml')), before);
  await assert.rejects(fs.stat(path.join(f.root, '.ktx-ui')));
  assert.throws(() => probeAuthState(f), /RECOVERY_REQUIRED/);
});
test('BS-08: enabled owner is authoritative even if an old installation forced open mode', async t => {
  const f = await fixture(t, 'admins:\n  - id: owner\n    role: owner\n    password_hash: scrypt:synthetic:hash\n');
  const r = probeAuthState(f);
  assert.equal(r.status, 'configured');
  assert.ok(!JSON.stringify(r).includes('synthetic'));
});
test('BS-08: disabled accounts, consumed bootstrap, malformed YAML and unknown roles never reopen claim', async t => {
  for (const yaml of ['admins:\n  - id: owner\n    role: owner\n    password_hash: test\n    enabled: false\n', 'admins: [broken', 'admins:\n - id: owner\n   role: unknown\n   password_hash: test\n']) {
    const f = await fixture(t, yaml);
    assert.throws(() => probeAuthState({ ...f, legacyAllowed: true }));
  }
  const consumed = await fixture(t, 'admins: []\n', 'consumed');
  assert.throws(() => probeAuthState(consumed), /RECOVERY_REQUIRED/);
});
test('BS-07/08: real SQLite state is opened read-only and unknown schema fails', async t => {
  const f = await fixture(t, 'admins: []\n', 'open');
  const dbFile = path.join(f.root, '.ktx-ui/security.sqlite');
  const before = await fs.readFile(dbFile);
  assert.equal(probeAuthState(f).status, 'uninitialized');
  assert.deepEqual(await fs.readFile(dbFile), before);
  const db = new Database(dbFile);
  db.exec("UPDATE schema_meta SET value='99'");
  db.close();
  assert.throws(() => probeAuthState(f), /SCHEMA_UNSUPPORTED/);
});
test('supported schema 2 is read-only and a schema 2 store missing its column is invalid', async t => {
  const f = await fixture(t, 'admins: []\n', 'open');
  const dbFile = path.join(f.root, '.ktx-ui/security.sqlite');
  const db = new Database(dbFile);
  db.exec("UPDATE schema_meta SET value='2'; CREATE TABLE security_events(seq INTEGER); ALTER TABLE security_events ADD COLUMN audit_event_kind TEXT;");
  db.pragma('user_version = 2');
  db.close();
  const before = await fs.readFile(dbFile);
  assert.equal(probeAuthState({ ...f, legacyAllowed: true }).status, 'uninitialized');
  assert.deepEqual(await fs.readFile(dbFile), before);
  const brokenRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lucy-auth-probe-'));
  t.after(() => fs.rm(brokenRoot, { force: true, recursive: true }));
  await fs.mkdir(path.join(brokenRoot, '.ktx-ui'), { recursive: true });
  const broken = new Database(path.join(brokenRoot, '.ktx-ui/security.sqlite'));
  broken.exec("CREATE TABLE schema_meta(key TEXT, value TEXT); INSERT INTO schema_meta VALUES('schema_version','2'); CREATE TABLE bootstrap_state(id INTEGER, state TEXT); INSERT INTO bootstrap_state VALUES(1,'open'); CREATE TABLE admin_account_state(account_uid TEXT); CREATE TABLE security_events(seq INTEGER);");
  broken.close();
  assert.throws(() => probeAuthState({ root: brokenRoot, dependencyRoot }), /SECURITY_STATE_INVALID/);
});
