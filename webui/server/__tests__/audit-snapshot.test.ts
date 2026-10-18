import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { snapshotAuditDatabase } from "../admin/audit";

// Mirror snapshotAuditDatabase's contract — sha256 of the on-disk file bytes.
// Kept here as a verifier so the test never trusts the function under test for its own digest.
function sha256OfFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

describe("snapshotAuditDatabase (Spec 185 T13)", () => {
  let source: Database.Database;
  let sourcePath: string;
  let destinationPath: string;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "lucy-audit-snapshot-"));
    sourcePath = path.join(tempDir, "source.sqlite");
    destinationPath = path.join(tempDir, "snapshot.sqlite");
    source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        user_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        outcome TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        request_id TEXT NOT NULL,
        decision_reason TEXT
      );
    `);
  });

  afterEach(() => {
    source.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns the sha256 of the destination file, isolates post-snapshot writes, and survives a fresh re-open", async () => {
    source.prepare(
      `INSERT INTO access_log (ts, user_id, tool, outcome, duration_ms, request_id, decision_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("2026-10-18T00:00:00.000Z", "snapshot-user", "tools/list", "ok", 3, "snap-ok-1", "tools_list_filtered");

    const beforeDigest = sha256OfFile(sourcePath);
    expect(beforeDigest).toMatch(/^[0-9a-f]{64}$/);

    const returnedDigest = await snapshotAuditDatabase(source, destinationPath);
    expect(returnedDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(returnedDigest).toBe(sha256OfFile(destinationPath));
    expect(returnedDigest).not.toBe(beforeDigest);

    // Source grows after the snapshot returned — the destination must not see it.
    source.prepare(
      `INSERT INTO access_log (ts, user_id, tool, outcome, duration_ms, request_id, decision_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("2026-10-18T00:00:01.000Z", "snapshot-user", "tools/list", "denied", 2, "snap-after", "role_resolution_failed:late");

    const reopened = new Database(destinationPath, { readonly: true });
    try {
      const rows = reopened
        .prepare(`SELECT request_id, outcome, decision_reason FROM access_log ORDER BY id`)
        .all() as Array<{ request_id: string; outcome: string; decision_reason: string | null }>;
      expect(rows).toEqual([
        { request_id: "snap-ok-1", outcome: "ok", decision_reason: "tools_list_filtered" }
      ]);
    } finally {
      reopened.close();
    }
  });
});

describe("audit access log CSV distinguishes empty tools/list ok from compile-failure denied", () => {
  let projectRoot: string;
  let auditDbPath: string;
  let previousRoot: string | undefined;
  let previousAuditDb: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-audit-csv-tools-list-"));
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    auditDbPath = path.join(projectRoot, "audit.sqlite");
    previousRoot = process.env.KTX_PROJECT_ROOT;
    previousAuditDb = process.env.LUCY_AUDIT_DB;
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousRoot;
    if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
    else process.env.LUCY_AUDIT_DB = previousAuditDb;
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("exports both outcomes and preserves the compile-failure decision_reason on tools/list rows", async () => {
    const { writeLog } = await import("../proxy/audit");
    await writeLog({
      ts: "2026-10-18T00:00:00.000Z",
      userId: "tools-list-user",
      tool: "tools/list",
      outcome: "ok",
      durationMs: 4,
      requestId: "tools-list-ok-1",
      decisionReason: "tools_list_filtered"
    });
    await writeLog({
      ts: "2026-10-18T00:00:01.000Z",
      userId: "tools-list-user",
      tool: "tools/list",
      outcome: "denied",
      durationMs: 6,
      requestId: "tools-list-denied-1",
      decisionReason: "role_resolution_failed:missing_role"
    });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/admin/audit/export?includeProtocol=true")
        .expect(200);
      const csv = String(res.text).replace(/^﻿/, "");
      const [headerLine, ...dataLines] = csv.trim().split("\n");
      const headers = parseCsvLine(headerLine);
      const toolIndex = headers.indexOf("tool");
      const outcomeIndex = headers.indexOf("outcome");
      const decisionReasonIndex = headers.indexOf("decision_reason");
      const requestIdIndex = headers.indexOf("request_id");
      expect(toolIndex).toBeGreaterThanOrEqual(0);
      expect(outcomeIndex).toBeGreaterThanOrEqual(0);
      expect(decisionReasonIndex).toBeGreaterThanOrEqual(0);
      const rows = dataLines.map(parseCsvLine);
      const okRow = rows.find((row) => row[requestIdIndex] === "tools-list-ok-1");
      const deniedRow = rows.find((row) => row[requestIdIndex] === "tools-list-denied-1");
      expect(okRow).toBeDefined();
      expect(deniedRow).toBeDefined();
      expect(okRow![toolIndex]).toBe("tools/list");
      expect(okRow![outcomeIndex]).toBe("ok");
      expect(okRow![decisionReasonIndex]).toBe("tools_list_filtered");
      expect(deniedRow![toolIndex]).toBe("tools/list");
      expect(deniedRow![outcomeIndex]).toBe("denied");
      expect(deniedRow![decisionReasonIndex]).toBe("role_resolution_failed:missing_role");

      // The two outcomes must not collapse to a single label — CSV preserves the
      // legal-empty / compile-failure distinction.
      const distinctOutcomes = new Set([okRow![outcomeIndex], deniedRow![outcomeIndex]]);
      expect(distinctOutcomes.size).toBe(2);
    } finally {
      await app.close();
    }
  });
});