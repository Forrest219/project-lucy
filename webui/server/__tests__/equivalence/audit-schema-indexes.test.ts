/**
 * P1-32/P1-33 — lookups that scale with audit volume must be index-backed in the REAL audit
 * schema (admin opener and proxy opener both create it). A table scan here is the root of
 * F-1 (per-row EXISTS), F-4 (link lookup per export chunk) and F-7 (per-inquiry full scan).
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;
let prev: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lucy-audit-idx-"));
  prev = process.env.LUCY_AUDIT_DB;
  process.env.LUCY_AUDIT_DB = path.join(dir, "audit.sqlite");
});
afterEach(async () => {
  if (prev === undefined) delete process.env.LUCY_AUDIT_DB; else process.env.LUCY_AUDIT_DB = prev;
  const admin = await import("../../admin/audit");
  admin.resetAuditDbForTests();
  (await import("../../proxy/audit")).closeAuditDb();
  await rm(dir, { recursive: true, force: true });
});

const plan = (db: import("better-sqlite3").Database, sql: string, ...params: unknown[]) =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map((r) => r.detail).join(" | ");

type Lookup = { name: string; sql: string; params?: unknown[]; proxyOnly?: boolean };
const LOOKUPS: Lookup[] = [
  { name: "link by access_log_id (F-1/F-4)", sql: "SELECT access_log_id, inferred_turn_id FROM inferred_turn_access_logs WHERE access_log_id IN (?,?,?)", params: [1, 2, 3] },
  { name: "call by effective_turn_id (F-7)", sql: "SELECT id FROM access_log WHERE effective_turn_id = ?", params: ["t"], proxyOnly: true },
  { name: "call by original_turn_id (F-7)", sql: "SELECT id FROM access_log WHERE original_turn_id = ?", params: ["t"], proxyOnly: true },
  { name: "call by lucy_turn_id (F-7)", sql: "SELECT id FROM access_log WHERE lucy_turn_id = ?", params: ["t"] }
];

describe("audit schema keeps volume-scaled lookups indexed", () => {
  for (const opener of ["admin", "proxy"] as const) {
    it(`${opener} opener: no full scan for any registered lookup`, async () => {
      let db: import("better-sqlite3").Database;
      if (opener === "admin") {
        db = await (await import("../../admin/audit")).getAuditDb();
      } else {
        // The proxy opener owns the access_log migrations; open the migrated file read-only to inspect plans.
        await (await import("../../proxy/audit")).isTokenRevoked("schema-index-probe");
        const Database = (await import("better-sqlite3")).default;
        db = new Database(process.env.LUCY_AUDIT_DB!, { readonly: true });
      }
      for (const { name, sql, params = [], proxyOnly } of LOOKUPS) {
        if (proxyOnly && opener === "admin") continue; // columns are added by the proxy migration
        const detail = plan(db, sql, ...params);
        expect(detail, name).not.toMatch(/SCAN (TABLE )?(access_log|inferred_turn_access_logs)(?! USING)/);
        expect(detail, name).toMatch(/USING (COVERING )?INDEX/);
      }
    });
  }
});
