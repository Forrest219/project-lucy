#!/usr/bin/env -S npx tsx
/**
 * Historical credential cleanup for the config audit trail (Spec §5.3, T08-3).
 *
 *   cd webui && npx tsx ../scripts/security/scrub-audit-secrets.mts --project-dir <dir> --dry-run [--out report.json]
 *   cd webui && LUCY_SCRUB_BACKUP_KEY=<base64, 32 bytes> npx tsx ../scripts/security/scrub-audit-secrets.mts \
 *       --project-dir <dir> --apply --expected-digest <digest from the reviewed dry run> \
 *       --backup-dir <dir> --reason "<why>" [--actor <label>]
 *
 * - Output is counts, a digest and notices only. It never prints row text or an old hash.
 * - Apply order: dry-run digest check -> verified AES-256-GCM backup -> one transaction -> maintenance
 *   event -> WAL checkpoint -> re-scan (must be zero).
 * - Only the audit database named by LUCY_AUDIT_DB (or <project-dir>/.ktx-ui/audit.sqlite) is rewritten.
 *   Older backups, exported packs and the backup written here are NOT cleaned or deleted.
 */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string, code = 1): never {
  console.error(`[scrub-audit-secrets] ${message}`);
  process.exit(code);
}

const projectDir = arg("project-dir");
if (!projectDir) fail("--project-dir is required");
process.env.KTX_PROJECT_ROOT = path.resolve(projectDir);

const apply = process.argv.includes("--apply");
if (apply && process.argv.includes("--dry-run")) fail("choose either --dry-run or --apply");

const auditDbPath = process.env.LUCY_AUDIT_DB?.trim()
  ? path.resolve(process.env.LUCY_AUDIT_DB)
  : path.join(path.resolve(projectDir), ".ktx-ui", "audit.sqlite");
if (!existsSync(auditDbPath)) fail(`audit database not found: ${auditDbPath}`);

const { getAuditDb } = await import("../../webui/server/admin/audit.js");
const { scanAuditSecrets, toReport, applyAuditSecretScrub, ScrubError } = await import(
  "../../webui/server/security/audit-secret-scrub.js"
);

try {
  const db = await getAuditDb();
  if (!apply) {
    const report = toReport(scanAuditSecrets(db));
    const text = `${JSON.stringify(report, null, 2)}\n`;
    const out = arg("out");
    if (out) await writeFile(out, text, { mode: 0o600 });
    else process.stdout.write(text);
    console.error(
      `[scrub-audit-secrets] dry run: scanned=${report.scanned} affectedRows=${report.affectedRows} digest=${report.digest}`
    );
  } else {
    const expectedDigest = arg("expected-digest");
    const backupDir = arg("backup-dir");
    const reason = arg("reason");
    const keyBase64 = process.env.LUCY_SCRUB_BACKUP_KEY;
    if (!expectedDigest || !backupDir || !reason) fail("--apply needs --expected-digest, --backup-dir and --reason");
    if (!keyBase64) fail("LUCY_SCRUB_BACKUP_KEY (base64, 32 bytes) is required for the encrypted backup");
    const report = applyAuditSecretScrub(db, {
      expectedDigest,
      reason,
      actor: arg("actor") ?? "scrub-audit-secrets",
      backup: { dir: path.resolve(backupDir), key: Buffer.from(keyBase64, "base64") }
    });
    console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  if (error instanceof ScrubError) fail(`${error.code}: ${error.message}`);
  throw error;
}
