#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export function probeAuthState({ root, dependencyRoot = '/app/webui', legacyAllowed = false }) {
  const require = createRequire(path.join(dependencyRoot, 'package.json'));
  const { parse } = require('yaml');
  const Database = require('better-sqlite3');
  const adminFile = process.env.LUCY_ADMINS_CONFIG_PATH || path.join(root, 'webui/config/admins.yaml');
  const dbFile = path.join(root, '.ktx-ui/security.sqlite');
  const read = (file) => { try { if (!fs.lstatSync(file).isFile()) throw Error('CONFIG_INVALID'); return fs.readFileSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const adminRaw = read(adminFile);
  const doc = adminRaw ? parse(adminRaw.toString()) : null;
  if (doc !== null && (typeof doc !== 'object' || Array.isArray(doc) || doc.admins != null && !Array.isArray(doc.admins))) throw Error('CONFIG_INVALID');
  const rows = doc?.admins ?? [];
  const ids = new Set();
  let owners = 0;
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id) || !['owner', 'operator', 'admin'].includes(row.role) || !(typeof row.password_hash === 'string' && row.password_hash || Array.isArray(row.oidc_bindings) && row.oidc_bindings.length)) throw Error('CONFIG_INVALID');
    ids.add(row.id);
    if (row.enabled !== false && row.role === 'owner' && row.password_hash) owners++;
  }
  let bootstrap = 'legacy-absent';
  let historicalAccounts = 0;
  if (fs.existsSync(dbFile)) {
    if (!fs.lstatSync(dbFile).isFile()) throw Error('SECURITY_STATE_INVALID');
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      const version = db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get()?.value;
      if (String(version) !== '1') throw Error('SECURITY_SCHEMA_UNSUPPORTED');
      bootstrap = db.prepare('SELECT state FROM bootstrap_state WHERE id=1').get()?.state;
      if (!['open', 'consumed'].includes(bootstrap)) throw Error('SECURITY_STATE_INVALID');
      historicalAccounts = db.prepare('SELECT COUNT(*) AS n FROM admin_account_state').get().n;
      if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('SECURITY_STATE_INVALID');
    } finally { db.close(); }
  }
  const fingerprint = createHash('sha256').update(adminRaw ?? '<missing>').update(`\0${bootstrap}\0${historicalAccounts}`).digest('hex');
  if (owners > 0) return { status: 'configured', administrators: rows.length, bootstrap, fingerprint };
  if (rows.length || bootstrap === 'consumed' || historicalAccounts > 0 || bootstrap === 'legacy-absent' && !legacyAllowed) throw Error('ADMIN_RECOVERY_REQUIRED');
  return { status: 'uninitialized', administrators: 0, bootstrap, fingerprint };
}

if (process.argv[1] === '-' || process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = process.argv[2] || process.env.KTX_PROJECT_ROOT;
    if (!root || !path.isAbsolute(root)) throw Error('PROJECT_ROOT_REQUIRED');
    console.log(JSON.stringify(probeAuthState({ root, dependencyRoot: process.argv[3] || '/app/webui', legacyAllowed: process.argv[4] === 'legacy-reviewed' })));
  } catch { console.log(JSON.stringify({ status: 'unavailable', code: 'AUTH_STATE_PROBE_FAILED' })); process.exitCode = 1; }
}
