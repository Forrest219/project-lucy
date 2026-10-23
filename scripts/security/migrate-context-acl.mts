#!/usr/bin/env -S npx tsx
/**
 * Context ACL migration (Spec §4.3, T06).
 *
 *   cd webui && npx tsx ../scripts/security/migrate-context-acl.mts --project-dir <dir> --dry-run [--out report.json]
 *   cd webui && npx tsx ../scripts/security/migrate-context-acl.mts --project-dir <dir> --apply \
 *       --owner <adminId> --expected-digest <inventoryDigest> --decisions decisions.json --backup-dir <dir>
 *
 * - Dry run (default) prints metadata only: object ids, ACL state, file versions. No body text.
 * - Apply is owner-only and requires the reviewed digest, per-file expected_version in the
 *   decisions file, and LUCY_MIGRATION_BACKUP_KEY (base64, 32 bytes) for the encrypted backup.
 * - Run it on a synthetic fixture first. Applying to a customer's private configuration is a
 *   deployment-authorization matter: the approved plan does not substitute for that confirmation.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
  console.error(`[migrate-context-acl] ${message}`);
  process.exit(1);
}

const projectDir = arg("project-dir");
if (!projectDir) fail("--project-dir is required");
process.env.KTX_PROJECT_ROOT = path.resolve(projectDir);

const apply = process.argv.includes("--apply");
if (apply && process.argv.includes("--dry-run")) fail("choose either --dry-run or --apply");

const { scanContextAcl, applyContextAclMigration, ContextMigrationError } = await import(
  "../../webui/server/security/context-migration.js"
);

try {
  if (!apply) {
    const report = await scanContextAcl();
    const text = `${JSON.stringify(report, null, 2)}\n`;
    const out = arg("out");
    if (out) await writeFile(out, text, { mode: 0o600 });
    else process.stdout.write(text);
    console.error(
      `[migrate-context-acl] dry run: keep=${report.counts.keep} explicitAll=${report.counts.explicitAll} ` +
        `needsConfirmation=${report.counts.needsConfirmation} legacyAgents=${report.counts.legacyAgents} ` +
        `digest=${report.inventoryDigest}`
    );
  } else {
    const ownerId = arg("owner");
    const expectedDigest = arg("expected-digest");
    const decisionsPath = arg("decisions");
    const backupDir = arg("backup-dir");
    const keyBase64 = process.env.LUCY_MIGRATION_BACKUP_KEY;
    if (!ownerId || !expectedDigest || !decisionsPath || !backupDir) {
      fail("--apply needs --owner, --expected-digest, --decisions and --backup-dir");
    }
    if (!keyBase64) fail("LUCY_MIGRATION_BACKUP_KEY (base64, 32 bytes) is required for the encrypted backup");

    const { loadAdminsConfig } = await import("../../webui/server/auth/admins-store.js");
    const admin = (await loadAdminsConfig({ fresh: true })).admins.find((item) => item.id === ownerId && item.enabled);
    if (!admin) fail(`owner '${ownerId}' not found or disabled in admins.yaml`);

    const decisions = JSON.parse(await readFile(decisionsPath, "utf8")) as unknown;
    if (!Array.isArray(decisions)) fail("decisions file must be a JSON array");
    const result = await applyContextAclMigration({
      expectedDigest,
      decisions,
      actor: { id: admin.id, role: admin.role },
      backup: { dir: path.resolve(backupDir), key: Buffer.from(keyBase64, "base64") }
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.failed.length > 0) process.exit(2);
  }
} catch (error) {
  if (error instanceof ContextMigrationError) fail(`${error.code}: ${error.message}`);
  throw error;
}
