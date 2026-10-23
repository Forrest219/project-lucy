import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { redactAuditDiff, redactAuditSummary, redactAuditText } from "./redaction.js";

/**
 * Historical credential cleanup for `config_change_log` (Spec §5.3, T08-3).
 *
 * Flow: dry run (counts + digest only) → verified encrypted backup → one transaction that
 * rewrites only the affected fields → maintenance event → re-scan. Nothing here ever returns,
 * prints or logs row text, so the report itself cannot leak an old hash.
 *
 * Scope is deliberate: it rewrites rows in this database. It does not (and cannot) clean older
 * database backups, exported CSV/zip packs, volume snapshots or the backup this tool writes —
 * the report says so, and retention/destruction of those copies stays an operator action.
 */

export const SCRUB_ALGORITHM_VERSION = "audit-secret-scrub/v1";
export const SCRUB_EVENT_TYPE = "config_change_log_secret_scrub";

type Row = {
  id: number;
  change_type: string;
  diff: string | null;
  old_summary: string | null;
  new_summary: string | null;
  error_reason: string | null;
};

type Field = "diff" | "old_summary" | "new_summary" | "error_reason";
const FIELDS: Field[] = ["diff", "old_summary", "new_summary", "error_reason"];

type Update = { id: number; changeType: string; before: Partial<Record<Field, string | null>>; after: Partial<Record<Field, string | null>> };

export type ScrubScan = {
  scanned: number;
  affectedRows: number;
  /** Affected field counts, never values. */
  byField: Record<Field, number>;
  byChangeType: Record<string, number>;
  /** Fingerprint of the affected inventory; an apply must quote the digest of a reviewed dry run. */
  digest: string;
  updates: Update[];
};

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function cleanSummary(changeType: string, raw: string): string {
  try {
    return JSON.stringify(redactAuditSummary(changeType, JSON.parse(raw)));
  } catch {
    return redactAuditText(raw);
  }
}

function cleanField(field: Field, changeType: string, value: string): string {
  if (field === "diff") return redactAuditDiff(value);
  if (field === "error_reason") return redactAuditText(value);
  return cleanSummary(changeType, value);
}

export function scanAuditSecrets(db: Database.Database): ScrubScan {
  const rows = db
    .prepare("SELECT id, change_type, diff, old_summary, new_summary, error_reason FROM config_change_log ORDER BY id")
    .all() as Row[];
  const byField: Record<Field, number> = { diff: 0, old_summary: 0, new_summary: 0, error_reason: 0 };
  const byChangeType: Record<string, number> = {};
  const updates: Update[] = [];
  for (const row of rows) {
    const before: Update["before"] = {};
    const after: Update["after"] = {};
    for (const field of FIELDS) {
      const value = row[field];
      if (!value) continue;
      const cleaned = cleanField(field, row.change_type, value);
      if (cleaned === value) continue;
      before[field] = value;
      after[field] = cleaned;
      byField[field] += 1;
    }
    if (Object.keys(before).length === 0) continue;
    byChangeType[row.change_type] = (byChangeType[row.change_type] ?? 0) + 1;
    updates.push({ id: row.id, changeType: row.change_type, before, after });
  }
  const digest = sha256(
    JSON.stringify(updates.map((u) => ({ id: u.id, fields: Object.entries(u.before).map(([f, v]) => [f, sha256(v ?? "")]) })))
  );
  return { scanned: rows.length, affectedRows: updates.length, byField, byChangeType, digest, updates };
}

export type ScrubReport = Omit<ScrubScan, "updates"> & {
  mode: "dry-run" | "applied";
  backup?: { file: string; bytes: number; sha256: string; rows: number };
  maintenanceEventId?: number;
  residualAfter?: number;
  notices: string[];
};

const NOTICES = [
  "仅改写当前审计库 config_change_log；此前的数据库备份、已导出的 CSV/zip、卷快照中的副本不受影响，需按保留策略隔离或销毁。",
  "本次生成的加密备份含清理前的原文，只能用于回滚；不再需要时请按保留策略销毁，工具不会自动删除。"
];

export function toReport(scan: ScrubScan, extra: Partial<ScrubReport> = {}): ScrubReport {
  const { updates: _updates, ...summary } = scan;
  void _updates;
  return { ...summary, mode: "dry-run", notices: NOTICES, ...extra };
}

export class ScrubError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ScrubError";
  }
}

function encryptRows(rows: Array<{ id: number } & Update["before"]>, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ table: "config_change_log", rows }), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptScrubBackup(file: Buffer, key: Buffer): { table: string; rows: Array<Record<string, unknown>> } {
  const decipher = createDecipheriv("aes-256-gcm", key, file.subarray(0, 12));
  decipher.setAuthTag(file.subarray(12, 28));
  const plain = Buffer.concat([decipher.update(file.subarray(28)), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

function writeBackup(dir: string, operationId: string, scan: ScrubScan, key: Buffer): NonNullable<ScrubReport["backup"]> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${operationId}.backup.enc`);
  const payload = encryptRows(
    scan.updates.map((u) => ({ id: u.id, ...u.before })),
    key
  );
  const fd = openSync(file, "wx", 0o600);
  try {
    writeSync(fd, payload);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(file, 0o600);
  // Read back and decrypt before any row is touched: an unreadable backup must stop the cleanup.
  const verified = decryptScrubBackup(readFileSync(file), key);
  if (verified.rows.length !== scan.updates.length) {
    throw new ScrubError("BACKUP_VERIFY_FAILED", "backup did not read back completely; cleanup not started");
  }
  return { file, bytes: payload.length, sha256: createHash("sha256").update(payload).digest("hex"), rows: scan.updates.length };
}

export type ApplyScrubInput = {
  expectedDigest: string;
  reason: string;
  actor: string;
  backup: { dir: string; key: Buffer };
  requestId?: string;
};

export function applyAuditSecretScrub(db: Database.Database, input: ApplyScrubInput): ScrubReport {
  if (input.backup.key.length !== 32) throw new ScrubError("BACKUP_KEY_INVALID", "backup key must be 32 bytes");
  if (!input.reason.trim()) throw new ScrubError("REASON_REQUIRED", "a reason is required for cleanup");
  const scan = scanAuditSecrets(db);
  if (scan.digest !== input.expectedDigest) {
    throw new ScrubError("INVENTORY_STALE", "inventory changed since the dry run; re-run the dry run and review it again");
  }
  if (scan.affectedRows === 0) return toReport(scan, { mode: "applied", residualAfter: 0 });

  const operationId = `scrub-${randomUUID()}`;
  const backup = writeBackup(input.backup.dir, operationId, scan, input.backup.key);

  db.pragma("secure_delete = ON");
  const afterDigest = sha256(JSON.stringify(scan.updates.map((u) => ({ id: u.id, after: u.after }))));
  const update = db.transaction(() => {
    for (const item of scan.updates) {
      const sets = Object.keys(item.after).map((field) => `${field} = @${field}`);
      db.prepare(`UPDATE config_change_log SET ${sets.join(", ")} WHERE id = @id`).run({ id: item.id, ...item.after });
    }
    const event = db
      .prepare(
        `INSERT INTO audit_maintenance_log
           (ts, event_type, actor, reason, request_id, algorithm_version, scanned, matched, updated, before_digest, after_digest)
         VALUES (@ts, @eventType, @actor, @reason, @requestId, @algorithmVersion, @scanned, @matched, @updated, @beforeDigest, @afterDigest)`
      )
      .run({
        ts: new Date().toISOString(),
        eventType: SCRUB_EVENT_TYPE,
        actor: input.actor,
        reason: input.reason.trim(),
        requestId: input.requestId ?? operationId,
        algorithmVersion: SCRUB_ALGORITHM_VERSION,
        scanned: scan.scanned,
        matched: scan.affectedRows,
        updated: scan.affectedRows,
        beforeDigest: scan.digest,
        afterDigest
      });
    return Number(event.lastInsertRowid);
  });
  const maintenanceEventId = update.immediate();
  // Old pages may linger in the WAL until it is folded back into the main file.
  db.pragma("wal_checkpoint(TRUNCATE)");

  const residual = scanAuditSecrets(db).affectedRows;
  if (residual > 0) throw new ScrubError("RESIDUAL_AFTER_SCRUB", `cleanup left ${residual} rows still matching`);
  return toReport(scan, { mode: "applied", backup, maintenanceEventId, residualAfter: residual });
}
