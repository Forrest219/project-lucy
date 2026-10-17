import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createAuthFixture,
  login,
  loginCookie,
  startLucy,
  type AuthFixture,
  type RunningLucy
} from "./webui-auth-fixture";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit";
import { getSecurityStore } from "../security/instance";

const NEW_PASSWORD = "another-correct-horse-1";

type ConfigRow = {
  change_type: string;
  actor: string;
  diff: string | null;
  old_summary: string | null;
  new_summary: string | null;
  error_reason: string | null;
};

async function allConfigRows(): Promise<ConfigRow[]> {
  const db = await getAuditDb();
  return db
    .prepare("SELECT change_type, actor, diff, old_summary, new_summary, error_reason FROM config_change_log ORDER BY id")
    .all() as ConfigRow[];
}

async function allSecurityEvents() {
  const store = await getSecurityStore();
  if (!store.ok) throw new Error("security store unavailable");
  const events = store.value.listEventsAfter(0, 5000);
  if (!events.ok) throw new Error("security events unreadable");
  return events.value;
}

describe("T08-2 write-time redaction and authentication events", () => {
  let fx: AuthFixture;
  let lucy: RunningLucy;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    fx = await createAuthFixture({ secret: "env" });
    savedEnv.LUCY_AUDIT_DB = process.env.LUCY_AUDIT_DB;
    process.env.LUCY_AUDIT_DB = path.join(fx.root, "audit.sqlite");
    resetAuditDbForTests();
    await fx.writeAdmins([
      { id: "alice", role: "owner" },
      { id: "bob", role: "operator" }
    ]);
    lucy = await startLucy();
  });

  afterEach(async () => {
    await lucy.stop();
    resetAuditDbForTests();
    if (savedEnv.LUCY_AUDIT_DB === undefined) delete process.env.LUCY_AUDIT_DB;
    else process.env.LUCY_AUDIT_DB = savedEnv.LUCY_AUDIT_DB;
    await fx.restore();
  });

  async function accountLifecycle(owner: string) {
    const b = lucy.baseUrl;
    const create = await api(b, "POST", "/api/admin/admins", owner, {
      adminId: "carol",
      displayName: "Carol",
      password: NEW_PASSWORD,
      role: "operator"
    });
    expect(create.status).toBe(200);
    const rotate = await api(b, "PATCH", "/api/admin/admins/bob", owner, { password: NEW_PASSWORD });
    expect(rotate.status).toBe(200);
    const promote = await api(b, "PATCH", "/api/admin/admins/carol", owner, { role: "owner" });
    expect(promote.status).toBe(200);
    const disable = await api(b, "PATCH", "/api/admin/admins/carol", owner, { enabled: false });
    expect(disable.status).toBe(200);
    const del = await api(b, "DELETE", "/api/admin/admins/carol", owner);
    expect(del.status).toBe(200);
  }

  it("never persists a password hash in config audit diffs or summaries (V-05 write path)", async () => {
    const owner = await loginCookie(lucy.baseUrl, "alice");
    await accountLifecycle(owner);

    const hashes = (await fx.readAdmins()).map((row) => String(row.password_hash));
    const rows = await allConfigRows();
    const adminRows = rows.filter((row) => row.change_type.startsWith("admin_"));
    expect(adminRows.length).toBeGreaterThanOrEqual(5);

    const dump = JSON.stringify(rows);
    expect(dump).not.toMatch(/scrypt:/);
    for (const hash of hashes) expect(dump).not.toContain(hash);
    expect(dump).not.toContain(NEW_PASSWORD);

    // The redacted diff stays reviewable: structure and non-secret fields remain, the hash value is masked.
    const created = adminRows.find((row) => row.change_type === "admin_create");
    expect(created?.diff).toContain("display_name: Carol");
    expect(created?.diff).toMatch(/password_hash: \[REDACTED\]/);
  });

  it("does not expose scrypt through the config-audit read API, even to an operator", async () => {
    const owner = await loginCookie(lucy.baseUrl, "alice");
    await accountLifecycle(owner);
    const bob = await loginCookie(lucy.baseUrl, "bob", NEW_PASSWORD);
    const res = await api(lucy.baseUrl, "GET", "/api/admin/config-audit?limit=200", bob);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/scrypt:/);
    expect(text).toContain("admin_create");
  });

  it("records authentication and account-lifecycle events without credentials", async () => {
    const owner = await loginCookie(lucy.baseUrl, "alice");
    expect((await login(lucy.baseUrl, "bob", "wrong-password-xyz")).status).toBe(401);
    await accountLifecycle(owner);
    const out = await api(lucy.baseUrl, "POST", "/api/auth/logout", owner, {});
    expect(out.status).toBe(200);

    const events = await allSecurityEvents();
    const verdicts = events.map((event) => event.verdict);
    for (const expected of [
      "login_success",
      "login_failure",
      "logout",
      "admin_created",
      "password_rotated",
      "admin_role_changed",
      "admin_disabled",
      "admin_deleted"
    ]) {
      expect(verdicts, expected).toContain(expected);
    }

    const success = events.find((event) => event.verdict === "login_success");
    expect(success).toMatchObject({ actor: "alice", actorType: "ui_admin", phase: "result" });
    expect(success?.networkInfo).toMatch(/127\.0\.0\.1$/);

    const failure = events.find((event) => event.verdict === "login_failure");
    expect(failure).toMatchObject({ actor: "anonymous", actorType: "anonymous" });

    const rotated = events.find((event) => event.verdict === "password_rotated");
    expect(rotated).toMatchObject({ actor: "alice", actorType: "ui_admin" });
    expect(JSON.parse(rotated!.resultSummary)).toMatchObject({ targetId: "bob" });

    const dump = JSON.stringify(events);
    expect(dump).not.toMatch(/scrypt:/);
    expect(dump).not.toContain(NEW_PASSWORD);
    expect(dump).not.toContain("wrong-password-xyz");
    // The attempted id is a digest only, so a typo'd password cannot be mined from the ledger.
    expect(failure!.resultSummary).not.toContain("bob");
  });

  it("keeps the admins.yaml store itself unchanged (hashes stay in the config file, not the audit trail)", async () => {
    const owner = await loginCookie(lucy.baseUrl, "alice");
    await accountLifecycle(owner);
    const raw = await readFile(fx.adminsPath, "utf8");
    expect(raw).toContain("scrypt:");
  });
});

describe("T08-2 redaction primitives", () => {
  it("masks credential values line by line and keeps the surrounding diff reviewable", async () => {
    const { redactAuditDiff } = await import("../security/redaction");
    const diff = [
      "--- a/webui/config/admins.yaml",
      "+++ b/webui/config/admins.yaml",
      "@@ -1,3 +1,3 @@",
      "   - id: carol",
      '-    password_hash: "scrypt:16384:8:1:aaaa:bbbb"',
      '+    password_hash: "scrypt:16384:8:1:cccc:dddd"',
      "+    api_key: sk-live-123",
      "+    note: copied scrypt:16384:8:1:eeee:ffff by hand"
    ].join("\n");
    const out = redactAuditDiff(diff);
    expect(out).not.toMatch(/scrypt:16384/);
    expect(out).not.toContain("sk-live-123");
    expect(out).toContain("id: carol");
    expect(out).toContain("password_hash: [REDACTED]");
  });

  it("summarizes wiki and skill bodies as digests instead of copying them", async () => {
    const { auditDiffForContent } = await import("../security/redaction");
    const before = "---\nsummary: s\nallowed_roles: [finance]\n---\nQuarterly secret numbers: 4242\n";
    const after = "---\nsummary: s\nallowed_roles: [finance, ops]\n---\nQuarterly secret numbers: 9999\n";
    const diff = auditDiffForContent({ assetKind: "wiki", relPath: "wiki/global/q.md", oldText: before, newText: after });
    expect(diff).not.toContain("4242");
    expect(diff).not.toContain("9999");
    expect(diff).toContain("allowed_roles: [finance, ops]");
    expect(diff).toMatch(/body: sha256:[0-9a-f]{12} -> sha256:[0-9a-f]{12}/);
  });

  it("applies a strict key allowlist to authentication summaries and a pattern mask elsewhere", async () => {
    const { redactAuditSummary } = await import("../security/redaction");
    expect(
      redactAuditSummary("admin_patch", { id: "bob", role: "operator", password: "hunter2", password_hash: "scrypt:1:2:3:a:b", extra: "x" })
    ).toEqual({ id: "bob", role: "operator" });
    expect(redactAuditSummary("token_create", { label: "ci", token: "abc", nested: { secret: "s", ok: 1 } })).toEqual({
      label: "ci",
      token: "[REDACTED]",
      nested: { secret: "[REDACTED]", ok: 1 }
    });
  });
});

// ─── T08-3 historical cleanup ────────────────────────────────────────────────

describe("T08-3 historical credential cleanup", () => {
  const HASH_A = "scrypt:0a1b2c3d4e5f60718293a4b5c6d7e8f9:" + "ab".repeat(64);
  const HASH_B = "scrypt:ffeeddccbbaa99887766554433221100:" + "cd".repeat(64);
  const KEY = Buffer.alloc(32, 7);

  let root: string;
  let db: Awaited<ReturnType<typeof getAuditDb>>;
  const saved: Record<string, string | undefined> = {};

  const insert = (id: number, changeType: string, fields: Partial<Record<"diff" | "old_summary" | "new_summary" | "error_reason" | "write_status", string>>) =>
    db
      .prepare(
        `INSERT INTO config_change_log (id, ts, actor, change_type, file_path, diff, old_summary, new_summary, error_reason, write_status, idempotency_key)
         VALUES (?, ?, 'alice', ?, 'webui/config/admins.yaml', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        "2026-10-01T00:00:00.000Z",
        changeType,
        fields.diff ?? null,
        fields.old_summary ?? null,
        fields.new_summary ?? null,
        fields.error_reason ?? null,
        fields.write_status ?? "committed",
        `seed-${id}`
      );

  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const os = await import("node:os");
    root = await mkdtemp(path.join(os.tmpdir(), "lucy-scrub-"));
    await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
    saved.LUCY_AUDIT_DB = process.env.LUCY_AUDIT_DB;
    saved.KTX_PROJECT_ROOT = process.env.KTX_PROJECT_ROOT;
    process.env.LUCY_AUDIT_DB = path.join(root, "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = root;
    resetAuditDbForTests();
    db = await getAuditDb();
    insert(1, "admin_create", {
      diff: `@@ -1 +1 @@\n-    password_hash: "${HASH_A}"\n+    password_hash: "${HASH_B}"\n+    display_name: Carol`,
      new_summary: JSON.stringify({ id: "carol", role: "operator", password_hash: HASH_B })
    });
    insert(2, "admin_patch", { old_summary: JSON.stringify({ id: "bob", password: "hunter2hunter2" }), write_status: "pending" });
    insert(3, "wiki_edit_save", { error_reason: `write failed near ${HASH_A}` });
    insert(4, "token_create", { new_summary: JSON.stringify({ label: "ci", hashPrefix: "sha256:abcd" }) });
  });

  afterEach(async () => {
    resetAuditDbForTests();
    (await import("../security/instance")).closeSecurityStore();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });

  const rowsText = () => JSON.stringify(db.prepare("SELECT * FROM config_change_log ORDER BY id").all());

  it("dry run reports counts and a digest only, and changes nothing", async () => {
    const { scanAuditSecrets, toReport } = await import("../security/audit-secret-scrub");
    const before = rowsText();
    const report = toReport(scanAuditSecrets(db));
    expect(report).toMatchObject({ mode: "dry-run", scanned: 4, affectedRows: 3 });
    expect(report.byField).toEqual({ diff: 1, old_summary: 1, new_summary: 1, error_reason: 1 });
    expect(report.byChangeType).toEqual({ admin_create: 1, admin_patch: 1, wiki_edit_save: 1 });
    expect(report.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(report.notices.join(" ")).toContain("备份");
    const text = JSON.stringify(report);
    expect(text).not.toContain(HASH_A);
    expect(text).not.toContain(HASH_B);
    expect(text).not.toContain("hunter2hunter2");
    expect(rowsText()).toBe(before);
  });

  it("refuses to apply without the reviewed digest, a reason and a valid key — and leaves rows and disk untouched", async () => {
    const { scanAuditSecrets, applyAuditSecretScrub } = await import("../security/audit-secret-scrub");
    const { readdir } = await import("node:fs/promises");
    const before = rowsText();
    const backupDir = path.join(root, "backups");
    const digest = scanAuditSecrets(db).digest;
    const base = { actor: "tool", reason: "t08-3", backup: { dir: backupDir, key: KEY } };
    expect(() => applyAuditSecretScrub(db, { ...base, expectedDigest: "0".repeat(64) })).toThrow(/INVENTORY_STALE|inventory changed/);
    expect(() => applyAuditSecretScrub(db, { ...base, expectedDigest: digest, reason: "  " })).toThrow(/reason/);
    expect(() => applyAuditSecretScrub(db, { ...base, expectedDigest: digest, backup: { dir: backupDir, key: Buffer.alloc(8) } })).toThrow(/32 bytes/);
    expect(rowsText()).toBe(before);
    await expect(readdir(backupDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops before any rewrite when the backup cannot be written", async () => {
    const { scanAuditSecrets, applyAuditSecretScrub } = await import("../security/audit-secret-scrub");
    const before = rowsText();
    const blocker = path.join(root, "not-a-dir");
    await writeFile(blocker, "x");
    expect(() =>
      applyAuditSecretScrub(db, {
        expectedDigest: scanAuditSecrets(db).digest,
        reason: "t08-3",
        actor: "tool",
        backup: { dir: path.join(blocker, "sub"), key: KEY }
      })
    ).toThrow();
    expect(rowsText()).toBe(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_maintenance_log WHERE event_type = 'config_change_log_secret_scrub'").get()).toEqual({ n: 0 });
  });

  it("backs up (encrypted, 0600, verified), cleans, records a maintenance event and re-scans to zero", async () => {
    const { scanAuditSecrets, applyAuditSecretScrub, decryptScrubBackup } = await import("../security/audit-secret-scrub");
    const { stat, readFile: read } = await import("node:fs/promises");
    const ids = (db.prepare("SELECT id FROM config_change_log ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id);
    const digest = scanAuditSecrets(db).digest;

    const report = applyAuditSecretScrub(db, {
      expectedDigest: digest,
      reason: "remove legacy credential copies",
      actor: "ops-tool",
      backup: { dir: path.join(root, "backups"), key: KEY }
    });
    expect(report).toMatchObject({ mode: "applied", affectedRows: 3, residualAfter: 0 });
    expect(report.backup).toMatchObject({ rows: 3 });
    const reportText = JSON.stringify(report);
    expect(reportText).not.toContain(HASH_A);
    expect(reportText).not.toContain(HASH_B);

    // Backup: owner-only, ciphertext only, and restorable with the key.
    const file = report.backup!.file;
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const raw = await read(file);
    expect(raw.includes(Buffer.from(HASH_A))).toBe(false);
    const restored = decryptScrubBackup(raw, KEY);
    expect(restored.rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(JSON.stringify(restored.rows)).toContain(HASH_A);

    // Rows: same ids, same statuses (pending is not dropped), credentials gone, benign rows untouched.
    expect((db.prepare("SELECT id FROM config_change_log ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id)).toEqual(ids);
    expect(db.prepare("SELECT write_status FROM config_change_log WHERE id = 2").get()).toEqual({ write_status: "pending" });
    const after = rowsText();
    expect(after).not.toContain(HASH_A);
    expect(after).not.toContain(HASH_B);
    expect(after).not.toContain("hunter2hunter2");
    expect(db.prepare("SELECT new_summary FROM config_change_log WHERE id = 4").get()).toEqual({
      new_summary: JSON.stringify({ label: "ci", hashPrefix: "sha256:abcd" })
    });
    expect(String((db.prepare("SELECT diff FROM config_change_log WHERE id = 1").get() as { diff: string }).diff)).toContain("display_name: Carol");

    // Maintenance event: counts and digests, no content.
    const event = db.prepare("SELECT * FROM audit_maintenance_log WHERE event_type = 'config_change_log_secret_scrub'").get() as Record<string, unknown>;
    expect(event).toMatchObject({ actor: "ops-tool", reason: "remove legacy credential copies", scanned: 4, matched: 3, updated: 3, before_digest: digest });
    expect(JSON.stringify(event)).not.toContain("scrypt:");
    expect(scanAuditSecrets(db).affectedRows).toBe(0);

    // The database file itself no longer carries the old hash after secure_delete + WAL truncate.
    for (const suffix of ["", "-wal"]) {
      const bytes = await read(path.join(root, `audit.sqlite${suffix}`)).catch(() => Buffer.alloc(0));
      expect(bytes.includes(Buffer.from(HASH_A)), `audit.sqlite${suffix}`).toBe(false);
    }
  });

  it("does not delete unprojected events, and leaves the question-text retention at its own short window", async () => {
    const { scanAuditSecrets, applyAuditSecretScrub } = await import("../security/audit-secret-scrub");
    const { getSecurityStore } = await import("../security/instance");
    const { purgeExpiredConversationTurns } = await import("../proxy/audit");
    const store = await getSecurityStore();
    if (!store.ok) throw new Error("security store unavailable");
    store.value.appendEvent({ eventId: "keep-1", operationId: "op-keep", phase: "request_admitted", actor: "x", actorType: "mcp" });
    const turn = db.prepare(
      `INSERT INTO conversation_turns (turn_id, user_id, question_preview, question_source, created_at) VALUES (?, 'u', 'q', 'reported', ?)`
    );
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    turn.run("t-45", daysAgo(45));
    turn.run("t-10", daysAgo(10));

    applyAuditSecretScrub(db, {
      expectedDigest: scanAuditSecrets(db).digest,
      reason: "t08-3",
      actor: "tool",
      backup: { dir: path.join(root, "b"), key: KEY }
    });
    const events = store.value.listEventsAfter(0, 100);
    expect(events.ok && events.value.some((e) => e.eventId === "keep-1")).toBe(true);
    expect(store.value.listUnterminatedOperations("request_admitted", ["response_delivered"]).ok).toBe(true);
    // A 180-day security-event window must not widen the 30-day question-text window.
    const dry = await purgeExpiredConversationTurns({ dryRun: true });
    expect(dry.scanned).toBe(1);
  });

  it("CLI: dry run prints only counts; apply needs the reviewed digest and writes an encrypted backup", async () => {
    resetAuditDbForTests();
    db.close();
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const tsx = path.resolve(__dirname, "../../node_modules/.bin/tsx");
    const script = path.resolve(__dirname, "../../../scripts/security/scrub-audit-secrets.mts");
    const env = { ...process.env, LUCY_SCRUB_BACKUP_KEY: KEY.toString("base64") };
    const common = ["--project-dir", root];

    const dry = await run(tsx, [script, ...common, "--dry-run"], { env, cwd: path.resolve(__dirname, "../..") });
    const dryReport = JSON.parse(dry.stdout);
    expect(dryReport).toMatchObject({ mode: "dry-run", affectedRows: 3 });
    expect(dry.stdout + dry.stderr).not.toContain("scrypt:");

    const bad = await run(tsx, [script, ...common, "--apply", "--expected-digest", "0".repeat(64), "--backup-dir", path.join(root, "cli-b"), "--reason", "x"], {
      env,
      cwd: path.resolve(__dirname, "../..")
    }).then(
      () => "ok",
      (error: { stderr?: string }) => String(error.stderr)
    );
    expect(bad).toContain("INVENTORY_STALE");

    const applied = await run(
      tsx,
      [script, ...common, "--apply", "--expected-digest", dryReport.digest, "--backup-dir", path.join(root, "cli-b"), "--reason", "t08-3 cli"],
      { env, cwd: path.resolve(__dirname, "../..") }
    );
    const appliedReport = JSON.parse(applied.stdout);
    expect(appliedReport).toMatchObject({ mode: "applied", residualAfter: 0 });
    expect(applied.stdout + applied.stderr).not.toContain("scrypt:");
    db = await getAuditDb();
    expect(rowsText()).not.toContain(HASH_A);
  });
});
