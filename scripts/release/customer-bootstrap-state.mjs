import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export class DeliveryError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const digest = (data) => createHash('sha256').update(data).digest('hex');
export const validInstanceId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{1,62}$/.test(id);
const fail = (code) => { throw new DeliveryError(code); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function statOrNull(file) {
  try { return await fs.lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

export async function privateFile(file) {
  const st = await statOrNull(file);
  if (!st || !st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) || st.uid !== process.getuid()) fail('PRIVATE_FILE_INVALID');
  return fs.readFile(file);
}

export async function writePrivate(file, data) {
  const fh = await fs.open(file, 'wx', 0o600);
  try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
}

export async function privateLocation(target) {
  const absolute = path.resolve(target);
  let cursor = absolute;
  while (true) {
    if (await statOrNull(path.join(cursor, '.git'))) fail('PATH_INSIDE_GIT');
    if (['.cache', 'node_modules', 'release', 'inbox'].includes(path.basename(cursor))) fail('PATH_INSIDE_BUILD_OR_CACHE');
    const st = await statOrNull(cursor);
    if (st?.isSymbolicLink()) fail('SYMLINK_PATH');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return absolute;
}

async function ensureDir(dir) {
  const st = await statOrNull(dir);
  if (!st) { await fs.mkdir(dir, { recursive: true, mode: 0o700 }); return; }
  if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) || st.uid !== process.getuid()) fail('PRIVATE_DIRECTORY_INVALID');
}

export async function getBootstrapCredential({ stateDir, instanceId, credentialState, dryRun = false, random = randomBytes }) {
  if (!validInstanceId(instanceId) || !['new', 'issued', 'none'].includes(credentialState)) fail('CREDENTIAL_INTENT_INVALID');
  const root = await privateLocation(stateDir);
  const entry = path.join(root, 'instances', instanceId);
  const ledger = path.join(root, 'issued', `${instanceId}.json`);
  async function readIssued() {
    const st = await statOrNull(entry);
    if (!st || !st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) || st.uid !== process.getuid()) fail('PRIVATE_DIRECTORY_INVALID');
    const metadata = JSON.parse((await privateFile(path.join(entry, 'record.json'))).toString());
    const marker = JSON.parse((await privateFile(ledger)).toString());
    const key = (await privateFile(path.join(entry, 'bootstrap-token'))).toString();
    if (metadata.instanceId !== instanceId || marker.instanceId !== instanceId || !/^[a-f0-9]{64}\n$/.test(key) || metadata.keyDigest !== digest(key) || marker.issueId !== metadata.issueId) fail('CREDENTIAL_STATE_INVALID');
    return { key, reused: true };
  }
  if (credentialState === 'none') return { key: null, reused: false };
  const existing = await statOrNull(entry);
  const issued = await statOrNull(ledger);
  if (dryRun) {
    if (existing && issued) { await readIssued(); return { key: null, reused: true }; }
    if (existing || issued || credentialState !== 'new') fail('CREDENTIAL_RECOVERY_REQUIRED');
    return { key: null, reused: false };
  }
  await ensureDir(root);
  for (const child of ['instances', 'issued', 'locks']) await ensureDir(path.join(root, child));
  const lock = path.join(root, 'locks', instanceId);
  let locked = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await fs.mkdir(lock, { mode: 0o700 }); locked = true; break; }
    catch (e) { if (e.code !== 'EEXIST') throw e; await sleep(50); }
  }
  if (!locked) fail('CREDENTIAL_LOCKED');
  let staging;
  try {
    const hasEntry = await statOrNull(entry);
    const hasLedger = await statOrNull(ledger);
    if (hasEntry && hasLedger) return await readIssued();
    if (hasEntry || hasLedger || credentialState !== 'new') fail('CREDENTIAL_RECOVERY_REQUIRED');
    const key = `${random(32).toString('hex')}\n`;
    if (!/^[a-f0-9]{64}\n$/.test(key)) fail('RANDOM_SOURCE_INVALID');
    const issueId = randomBytes(16).toString('hex');
    // The permanent marker survives failed assembly or a missing credential directory.
    await writePrivate(ledger, `${JSON.stringify({ instanceId, issueId })}\n`);
    const ledgerDir = await fs.open(path.dirname(ledger), 'r');
    try { await ledgerDir.sync(); } finally { await ledgerDir.close(); }
    staging = await fs.mkdtemp(path.join(root, 'instances', `.${instanceId}-`));
    await writePrivate(path.join(staging, 'bootstrap-token'), key);
    await writePrivate(path.join(staging, 'record.json'), `${JSON.stringify({ instanceId, issueId, keyDigest: digest(key), createdAt: new Date().toISOString() })}\n`);
    const dir = await fs.open(staging, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
    await fs.rename(staging, entry);
    const parent = await fs.open(path.dirname(entry), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
    staging = null;
    return { key, reused: false };
  } finally {
    if (staging) await fs.rm(staging, { recursive: true, force: true });
    await fs.rmdir(lock);
  }
}
