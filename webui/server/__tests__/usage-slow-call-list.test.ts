/**
 * SC-20b — the calls list exposes the stored `is_slow_call` column as
 * `usageSlowCall`. Rows are written to a temp sqlite file, never the
 * running audit database.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-usage-slow-"));
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = auditDbPath;
});

afterEach(async () => {
  const { closeAuditDb } = await import("../proxy/audit.js");
  closeAuditDb();
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("GET /api/admin/audit usageSlowCall", () => {
  it("maps the stored slow mark and does not treat a long wiki_read as slow", async () => {
    const { writeLog, closeAuditDb } = await import("../proxy/audit.js");
    const base = {
      ts: "2026-10-13T02:00:00.000Z",
      userId: "demo_agent",
      outcome: "ok" as const
    };
    await writeLog({ ...base, tool: "lucy_query", durationMs: 5_000, requestId: "slow-query" });
    await writeLog({ ...base, ts: "2026-10-13T02:01:00.000Z", tool: "lucy_query", durationMs: 1_600, requestId: "fast-query" });
    await writeLog({ ...base, ts: "2026-10-13T02:02:00.000Z", tool: "wiki_read", durationMs: 60_000, requestId: "wiki-slow" });
    await writeLog({ ...base, ts: "2026-10-13T02:03:00.000Z", tool: "wiki_read", durationMs: 60_000, requestId: "wiki-marked" });
    closeAuditDb();

    const database = new Database(auditDbPath);
    database.prepare("UPDATE access_log SET is_slow_call = 1 WHERE request_id = ?").run("wiki-marked");
    database.close();

    const { buildServer } = await import("../index.js");
    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/api/admin/audit?limit=20" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { entries: Array<{ requestId: string; usageSlowCall?: boolean; tool: string }> } };
    const entries = body.data.entries;
    const byRequest = new Map(entries.filter((entry) => entry.requestId).map((entry) => [entry.requestId, entry]));
    expect(byRequest.get("slow-query")).toMatchObject({ tool: "lucy_query", usageSlowCall: true });
    expect(byRequest.get("fast-query")).toMatchObject({ tool: "lucy_query", usageSlowCall: false });
    expect(byRequest.get("wiki-slow")).toMatchObject({ tool: "wiki_read", usageSlowCall: false });
    expect(byRequest.get("wiki-marked")).toMatchObject({ tool: "wiki_read", usageSlowCall: true });
    await app.close();
  }, 20_000);
});
