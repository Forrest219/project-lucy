/**
 * WO-202610-13 T7 / SC-18 — 审计导出游标分页.
 *
 * Page size defaults to 10,000. The second page reads row 10,001: nothing past
 * the page size is silently dropped. An empty `policy_version` counts as
 * missing, and a missing permission snapshot makes the export incomplete.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;

function csvDataRows(csv: string): string[] {
  const lines = csv.replace(/^﻿/, "").split("\n").filter((line) => line.trim().length > 0);
  return lines.slice(1);
}

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-audit-paging-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
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
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  delete process.env.LUCY_AUDIT_EXPORT_MAX_ROWS;
  delete process.env.LUCY_AUDIT_EXPORT_MAX_BYTES;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("audit export cursor paging", () => {
  it("round-trips a cursor through encode and decode", async () => {
    const { encodeAuditExportCursor, decodeAuditExportCursor } = await import("../admin/audit");

    for (const cursor of [
      { ts: "2026-01-01T00:00:01.000Z", id: 2 },
      { ts: "2026-06-21T09:00:00.123Z", id: 10_001 },
      { ts: "2026-12-31T23:59:59.999Z", id: 1 }
    ]) {
      const encoded = encodeAuditExportCursor(cursor);
      expect(encoded).not.toContain("\u0000");
      expect(decodeAuditExportCursor(encoded)).toEqual(cursor);
    }

    // A cursor that cannot be parsed is ignored rather than throwing.
    expect(decodeAuditExportCursor(undefined)).toBeNull();
    expect(decodeAuditExportCursor("")).toBeNull();
    expect(decodeAuditExportCursor("not-base64!!")).toBeNull();
    // Separator present but no numeric id after it.
    expect(decodeAuditExportCursor(Buffer.from("2026-01-01T00:00:00.000Z::abc").toString("base64url"))).toBeNull();
  });

  it("reads row 10,001 on the second page without dropping overflow", async () => {
    process.env.LUCY_AUDIT_EXPORT_MAX_ROWS = "10000";
    const { writeLog, closeAuditDb } = await import("../proxy/audit");
    for (let index = 0; index < 10_001; index += 1) {
      await writeLog({
        // Ascending ts so the newest row is the one the export returns first.
        ts: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + index * 1000).toISOString(),
        userId: "paging_agent",
        tokenLabel: "paging",
        tool: "lucy_query",
        outcome: "ok",
        durationMs: 5,
        requestId: `req-${index}`
      });
    }
    closeAuditDb();

    const { buildServer } = await import("../index");
    const { resetAuditDbForTests } = await import("../admin/audit");
    resetAuditDbForTests();
    const app = buildServer();
    await app.ready();

    const first = await request(app.server).get("/api/admin/audit/export").query({ includeProtocol: "1" });
    expect(first.status).toBe(200);
    const firstRows = csvDataRows(first.text);
    expect(firstRows.length).toBe(10_000);
    const cursor = first.headers["x-lucy-export-next-cursor"];
    expect(typeof cursor).toBe("string");
    expect(String(cursor).length).toBeGreaterThan(0);

    const second = await request(app.server)
      .get("/api/admin/audit/export")
      .query({ includeProtocol: "1", cursor: String(cursor) });
    expect(second.status).toBe(200);
    const secondRows = csvDataRows(second.text);

    // Export order is ts DESC, id DESC, so the 10,001st row of the full set
    // is the oldest one — it must land on page two.
    expect(firstRows.length + secondRows.length).toBe(10_001);
    const requestIdOf = (row: string): string => /req-\d+/.exec(row)?.[0] ?? "";
    expect(requestIdOf(secondRows[0] ?? "")).toBe("req-0");

    // Page one and page two together cover every row exactly once — the
    // overflow is not silently dropped and nothing is duplicated.
    const all = [...firstRows, ...secondRows].map(requestIdOf);
    expect(new Set(all).size).toBe(10_001);
    expect(all).toContain("req-10000");
    expect(all).toContain("req-0");
    expect(requestIdOf(firstRows[0] ?? "")).toBe("req-10000");

    await app.close();
    // Writing 10,001 audit rows one at a time takes ~1.5 s on an idle machine
    // and overruns the default 5 s budget on a loaded CI runner.
  }, 60_000);

  it("counts an empty policy_version as missing, not as a version", async () => {
    const { writeLog, closeAuditDb } = await import("../proxy/audit");
    await writeLog({
      ts: "2026-01-01T00:00:00.000Z",
      userId: "agent_a",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 5,
      requestId: "with-version",
      policyVersion: "pv-1",
      permissionSnapshotHash: "hash-a"
    });
    await writeLog({
      ts: "2026-01-02T00:00:00.000Z",
      userId: "agent_a",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 5,
      requestId: "empty-version",
      policyVersion: "",
      permissionSnapshotHash: "hash-a"
    });
    closeAuditDb();

    const { buildServer } = await import("../index");
    const { resetAuditDbForTests } = await import("../admin/audit");
    resetAuditDbForTests();
    const app = buildServer();
    await app.ready();

    const response = await request(app.server)
      .get("/api/admin/audit/export-pack")
      .query({ includeProtocol: "1" })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Buffer);
    const manifest = JSON.parse(readStoredZipEntry(response.body as Buffer, "manifest.json").toString("utf8"));
    // Two rows exported; the one with an empty policy_version counts as missing.
    expect(manifest.files.find((file: { name: string }) => file.name === "access_log.csv").rowCount).toBe(2);
    expect(manifest.completeness.rowsWithoutPolicyVersion).toBe(1);
    // Missing evidence is reported, but only a missing permission snapshot
    // makes the pack incomplete. Both rows carry hash-a here.
    expect(manifest.completeness.rowsWithoutPermissionSnapshot).toBe(0);

    await app.close();
  });

  it("reports completeness false when a permission snapshot is missing", async () => {
    const { writeLog, closeAuditDb } = await import("../proxy/audit");
    await writeLog({
      ts: "2026-01-01T00:00:00.000Z",
      userId: "agent_a",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 5,
      requestId: "no-snapshot",
      policyVersion: "pv-1"
    });
    closeAuditDb();

    const { buildServer } = await import("../index");
    const { resetAuditDbForTests } = await import("../admin/audit");
    resetAuditDbForTests();
    const app = buildServer();
    await app.ready();

    const zip = await request(app.server)
      .get("/api/admin/audit/export-pack")
      .query({ includeProtocol: "1" })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(zip.status).toBe(200);
    const manifest = JSON.parse(readStoredZipEntry(zip.body as Buffer, "manifest.json").toString("utf8"));
    expect(manifest.completeness.complete).toBe(false);
    expect(manifest.completeness.rowsWithoutPermissionSnapshot).toBeGreaterThan(0);

    await app.close();
  });
});

/** Minimal stored-zip reader: the export pack is written with no compression. */
function readStoredZipEntry(zip: Buffer, name: string): Buffer {
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const entryName = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataStart = offset + 30 + nameLength + extraLength;
    if (entryName === name) return zip.subarray(dataStart, dataStart + size);
    offset = dataStart + size;
  }
  throw new Error(`zip entry not found: ${name}`);
}