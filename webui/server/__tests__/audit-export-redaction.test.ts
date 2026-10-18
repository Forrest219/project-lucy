/**
 * T10 — audit export redaction.
 *
 * Goal: synthetic multi-line diff / summary / error fixtures confirm that no
 * raw `password_hash` value or full token hash leaves the process via the
 * config-audit read API (`/api/admin/config-audit`) or the access-log CSV
 * export (`/api/admin/audit/export`). Write-time redaction is already in place;
 * these tests are the defensive export-boundary check.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createAuthFixture,
  loginCookie,
  startLucy,
  type AuthFixture,
  type RunningLucy
} from "./webui-auth-fixture";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit";

const FULL_PASSWORD_HASH = "scrypt:16384:8:1:p4p4p4p4p4p4p4p4p4p4p4p4p4p4p4p4p4p4p4:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const FULL_TOKEN_HASH = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

beforeEach(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-t10-"));
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  process.env.LUCY_AUDIT_DB = path.join(root, "audit.sqlite");
  process.env.KTX_PROJECT_ROOT = root;
  resetAuditDbForTests();
});

afterEach(async () => {
  resetAuditDbForTests();
  delete process.env.LUCY_AUDIT_DB;
  delete process.env.KTX_PROJECT_ROOT;
});

async function seedSyntheticFixtures(): Promise<void> {
  const db = await getAuditDb();
  // Bypass write-time redaction: write the raw secret to disk so we can prove
  // the export boundary re-applies the mask. The seed is committed so
  // production-grade scrubbing (T08-3) would have already removed it.
  const insert = db.prepare(
    `INSERT INTO config_change_log
       (ts, actor, actor_type, change_type, file_path, diff, old_summary, new_summary, error_reason, write_status, idempotency_key, asset_kind, target_id)
     VALUES (?, 'legacy', 'ui_admin', ?, ?, ?, ?, ?, ?, 'committed', ?, 'governance', ?)`
  );
  const seed = (id: number, changeType: string, filePath: string, diff: string, oldSummary: unknown, newSummary: unknown, errorReason: string | null) =>
    insert.run(
      `2026-10-01T00:00:0${id}.000Z`,
      changeType,
      filePath,
      diff,
      oldSummary === undefined ? null : JSON.stringify(oldSummary),
      newSummary === undefined ? null : JSON.stringify(newSummary),
      errorReason,
      `seed-t10-${id}`,
      `target-${id}`
    );

  // Multi-line diff with two leaked credential shapes.
  seed(
    1,
    "admin_create",
    "webui/config/admins.yaml",
    [
      "--- a/webui/config/admins.yaml",
      "+++ b/webui/config/admins.yaml",
      "@@ -1,3 +1,4 @@",
      "   - id: carol",
      '-    password_hash: "scrypt:16384:8:1:aaaa:0123"',
      '+    password_hash: "scrypt:16384:8:1:bbbb:4567"',
      '+    api_key: sk-live-leak-9012',
      '+    display_name: Carol',
      '+    bootstrap_token: "bt_' + FULL_TOKEN_HASH.slice(7) + '"'
    ].join("\n"),
    undefined,
    {
      id: "carol",
      role: "operator",
      password_hash: FULL_PASSWORD_HASH,
      display_name: "Carol",
      extra: "scrypt:16384:8:1:cccc:9999 surfaced in summary"
    },
    null
  );

  // Error reason with a leaked bearer token.
  seed(
    2,
    "token_create",
    "webui/config/tokens.yaml",
    [
      "--- a/webui/config/tokens.yaml",
      "+++ b/webui/config/tokens.yaml",
      "@@ -1,1 +1,1 @@",
      '-hash: "' + FULL_TOKEN_HASH + '"',
      '+hash: "' + FULL_TOKEN_HASH.slice(0, 18) + 'suffix"'
    ].join("\n"),
    undefined,
    undefined,
    `forwarding failed: Authorization Bearer ${FULL_TOKEN_HASH.slice(7)} retry`
  );

  // Access log: a token hash prefix and an error_detail that quotes a
  // scrypt-shaped value. The token_hash_prefix column only ever stores a
  // 19-char fingerprint at write time; the error_detail must be defensively
  // scrubbed by the export.
  const tokenHashPrefix = FULL_TOKEN_HASH.slice(0, 19);
  db.prepare(
    `INSERT INTO access_log
       (ts, user_id, tool, args_summary, error_detail, outcome, duration_ms, token_hash_prefix, request_id, role_ids, decision_reason, policy_version)
     VALUES (?, 'alice', 'lucy_query', ?, ?, 'error', 12, ?, 'req-t10-1', '["r1"]', 'upstream_error', 'v1')`
  ).run(
    "2026-10-01T00:00:03.000Z",
    JSON.stringify({ password_hash: FULL_PASSWORD_HASH, bootstrap_token: "bt_secret_value_here", ok: 1 }),
    `upstream error: auth=${FULL_TOKEN_HASH} scrypt:16384:8:1:zzzz:1111 retry`,
    tokenHashPrefix
  );
}

describe("T10 audit export redaction", () => {
  let fx: AuthFixture;
  let lucy: RunningLucy;

  beforeEach(async () => {
    fx = await createAuthFixture({ secret: "env" });
    process.env.LUCY_AUDIT_DB = path.join(fx.root, "audit.sqlite");
    resetAuditDbForTests();
    await fx.writeAdmins([
      { id: "alice", role: "owner" }
    ]);
    await seedSyntheticFixtures();
    lucy = await startLucy();
  });

  afterEach(async () => {
    await lucy.stop();
    resetAuditDbForTests();
    if (process.env.LUCY_AUDIT_DB === undefined) delete process.env.LUCY_AUDIT_DB;
    await fx.restore();
  });

  it("config-audit JSON API masks scrypt values, full hashes and bearer tokens in diff / summary / error_reason", async () => {
    const owner = await loginCookie(lucy.baseUrl, "alice");
    const res = await api(lucy.baseUrl, "GET", "/api/admin/config-audit?limit=50", owner);
    expect(res.status).toBe(200);
    const text = await res.text();

    // Full credential values must never leave the process.
    expect(text).not.toContain(FULL_PASSWORD_HASH);
    expect(text).not.toContain("scrypt:16384:8:1:bbbb:4567");
    expect(text).not.toContain("scrypt:16384:8:1:cccc:9999");
    expect(text).not.toContain("sk-live-leak-9012");
    expect(text).not.toContain(FULL_TOKEN_HASH);
    expect(text).not.toContain(FULL_TOKEN_HASH.slice(7));
    expect(text).not.toContain("bt_" + FULL_TOKEN_HASH.slice(7));

    // The redaction markers + the surrounding reviewable structure remain.
    expect(text).toContain("password_hash");
    expect(text).toContain("[REDACTED]");
    expect(text).toContain("display_name");
    expect(text).toContain("Carol");
  });

  it("access-log CSV export masks error_detail and args_summary JSON; token_hash_prefix is the short fingerprint only", async () => {
    const owner = await loginCookie(lucy.baseUrl, "alice");
    const res = await api(lucy.baseUrl, "GET", "/api/admin/audit/export?limit=50", owner);
    expect(res.status).toBe(200);
    const text = await res.text();

    // Full credential values must not appear anywhere in the CSV.
    expect(text).not.toContain(FULL_PASSWORD_HASH);
    expect(text).not.toContain("scrypt:16384:8:1:zzzz:1111");
    expect(text).not.toContain(FULL_TOKEN_HASH);
    expect(text).not.toContain("bt_secret_value_here");

    // The token_hash_prefix column is the short fingerprint (19 chars).
    const prefixMatches = text.match(/sha256:[0-9a-f]{12}/g) ?? [];
    expect(prefixMatches.length).toBeGreaterThan(0);
    for (const m of prefixMatches) {
      expect(m.length).toBeLessThanOrEqual(19);
    }
    // The CSV uses a redaction marker for sensitive keys.
    expect(text).toContain("[REDACTED]");
  });

  it("multi-line diff fixtures retain the surrounding reviewable structure but every credential-shaped line is masked", async () => {
    const owner = await loginCookie(lucy.baseUrl, "alice");
    const res = await api(lucy.baseUrl, "GET", "/api/admin/config-audit?limit=50", owner);
    const body = (await res.json() as { data: { entries: Array<{ diff?: string; oldSummary?: unknown; newSummary?: unknown; errorReason?: string }> } });
    const entry = body.data.entries.find((row) => row.diff?.includes("display_name: Carol"));
    expect(entry).toBeDefined();
    if (!entry) return;
    // Diff structure preserved.
    expect(entry.diff).toContain("--- a/webui/config/admins.yaml");
    expect(entry.diff).toContain("+++ b/webui/config/admins.yaml");
    expect(entry.diff).toContain("display_name: Carol");
    // Credential values masked line by line.
    expect(entry.diff).not.toMatch(/scrypt:16384:8:1:[a-z0-9]+/);
    expect(entry.diff).not.toContain("sk-live-leak-9012");
    expect(entry.diff).toContain("password_hash: [REDACTED]");
    // Summary masking: the new_summary is a redacted object — the password_hash
    // key survives, the value is replaced with [REDACTED], the embedded
    // scrypt value in the `extra` field is scrubbed by `redactAuditText`.
    const newSummary = entry.newSummary as Record<string, unknown>;
    expect(newSummary.id).toBe("carol");
    expect(newSummary.password_hash).toBe("[REDACTED]");
    expect(JSON.stringify(newSummary)).not.toMatch(/scrypt:16384:8:1:[a-z0-9]+/);
  });
});
