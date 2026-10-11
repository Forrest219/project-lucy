/**
 * WO-202610-14 T2 / SC-21 — 鉴权失败时间线.
 *
 * `GET /api/admin/audit` merges access_log and auth_failure_log under the same
 * time filter. `token_expired` and an ordinary call are distinguishable by a
 * type field. Auth failures are never written as `lucy_query`, never enter
 * access_log, and `auth_failure_log.csv` stays its own file in the pack.
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

function parseStoredZipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataStart = offset + 30 + nameLength + extraLength;
    entries.set(name, zip.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

function zipBufferParser(res: NodeJS.ReadableStream, callback: (err: Error | null, body?: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-auth-timeline-"));
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
  await rm(projectRoot, { recursive: true, force: true });
});

async function seedTimeline(): Promise<void> {
  const { writeLog, writeAuthFailureLog, closeAuditDb } = await import("../proxy/audit");
  await writeLog({
    ts: "2026-10-11T09:00:00.000Z",
    userId: "workhorse",
    tokenLabel: "kscc",
    tool: "lucy_query",
    outcome: "ok",
    durationMs: 120,
    requestId: "call-1",
    client: "kscc-code",
    clientVersion: "1.3.7"
  });
  await writeAuthFailureLog({
    ts: "2026-10-11T09:05:00.000Z",
    reason: "token_expired",
    clientIp: "203.0.113.10",
    userAgent: "kscc-code/1.3.7 (cli)",
    tokenHashPrefix: "sha256:aaaa",
    userId: "workhorse",
    tokenLabel: "kscc",
    requestId: "auth-1"
  });
  await writeAuthFailureLog({
    ts: "2026-10-11T09:06:00.000Z",
    reason: "token_unrecognized",
    clientIp: "203.0.113.10",
    userId: "workhorse",
    requestId: "auth-2"
  });
  closeAuditDb();
}

describe("auth failure timeline (SC-21)", () => {
  it("shows token_expired and an ordinary call in the same time filter", async () => {
    await seedTimeline();
    const { buildServer } = await import("../index");
    const { resetAuditDbForTests } = await import("../admin/audit");
    resetAuditDbForTests();
    const app = buildServer();
    await app.ready();

    const response = await request(app.server)
      .get("/api/admin/audit")
      .query({ since: "2026-10-11T00:00:00.000Z", until: "2026-10-12T00:00:00.000Z", includeProtocol: "1" })
      .expect(200);

    const entries = response.body.data.entries as Array<Record<string, unknown>>;
    const calls = entries.filter((entry) => entry.eventType === "call");
    const failures = entries.filter((entry) => entry.eventType === "auth_failure");

    expect(calls.length).toBe(1);
    expect(calls[0].tool).toBe("lucy_query");
    expect(calls[0].outcome).toBe("ok");

    expect(failures.length).toBe(2);
    const reasons = failures.map((entry) => entry.reason).sort();
    expect(reasons).toEqual(["token_expired", "token_unrecognized"]);
    // The type field is what separates them; an auth failure is never a call.
    for (const failure of failures) {
      expect(failure.eventType).toBe("auth_failure");
      expect(failure.tool).toBeUndefined();
      expect(failure.outcome).toBeUndefined();
    }
    expect(response.body.data.authFailureCount).toBe(2);

    await app.close();
  });

  it("keeps both event types on one time-ordered timeline", async () => {
    await seedTimeline();
    const { buildServer } = await import("../index");
    const { resetAuditDbForTests } = await import("../admin/audit");
    resetAuditDbForTests();
    const app = buildServer();
    await app.ready();

    const response = await request(app.server)
      .get("/api/admin/audit")
      .query({ since: "2026-10-11T00:00:00.000Z", until: "2026-10-12T00:00:00.000Z", includeProtocol: "1" })
      .expect(200);

    const timestamps = (response.body.data.entries as Array<{ ts: string }>).map((entry) => entry.ts);
    const sorted = [...timestamps].sort().reverse();
    expect(timestamps).toEqual(sorted);

    await app.close();
  });

  it("never writes an auth failure into access_log", async () => {
    await seedTimeline();
    const { getAuditDb } = await import("../admin/audit");
    const database = await getAuditDb();
    const authRows = database.prepare("SELECT * FROM auth_failure_log").all() as Array<Record<string, unknown>>;
    const callRows = database.prepare("SELECT tool, outcome, decision_reason FROM access_log").all() as Array<Record<string, unknown>>;

    expect(authRows.length).toBe(2);
    for (const row of authRows) {
      expect(row.reason).toMatch(/^token_(expired|unrecognized)$/);
      // No call-shaped fields are invented for an auth failure.
      expect(row.tool).toBeUndefined();
    }
    for (const row of callRows) {
      expect(row.tool).toBe("lucy_query");
      expect(row.outcome).toBe("ok");
    }
    await rm(auditDbPath, { force: true });
  });

  it("keeps auth_failure_log.csv as its own file in the evidence pack", async () => {
    await seedTimeline();
    const { buildServer } = await import("../index");
    const { resetAuditDbForTests } = await import("../admin/audit");
    resetAuditDbForTests();
    const app = buildServer();
    await app.ready();

    const zip = await request(app.server)
      .get("/api/admin/audit/export-pack")
      .query({ since: "2026-10-11T00:00:00.000Z", until: "2026-10-12T00:00:00.000Z" })
      .buffer(true)
      .parse(zipBufferParser)
      .expect(200);

    const entries = parseStoredZipEntries(zip.body as Buffer);
    expect(entries.has("auth_failure_log.csv")).toBe(true);
    expect(entries.has("access_log.csv")).toBe(true);

    // The auth file holds only auth failures — never a lucy_query row.
    const authCsv = (entries.get("auth_failure_log.csv") ?? Buffer.alloc(0)).toString("utf8");
    expect(authCsv).toContain("token_expired");
    expect(authCsv).not.toContain("lucy_query");

    const accessCsv = (entries.get("access_log.csv") ?? Buffer.alloc(0)).toString("utf8");
    expect(accessCsv).toContain("lucy_query");
    expect(accessCsv).not.toContain("token_expired");

    await app.close();
  });

  it("can hide auth failures from the default timeline without losing them", async () => {
    await seedTimeline();
    const { buildServer } = await import("../index");
    const { resetAuditDbForTests } = await import("../admin/audit");
    resetAuditDbForTests();
    const app = buildServer();
    await app.ready();

    const response = await request(app.server)
      .get("/api/admin/audit")
      .query({ since: "2026-10-11T00:00:00.000Z", until: "2026-10-12T00:00:00.000Z", includeAuthFailures: "0" })
      .expect(200);

    const entries = response.body.data.entries as Array<Record<string, unknown>>;
    expect(entries.every((entry) => entry.eventType === "call")).toBe(true);
    expect(response.body.data.authFailureCount).toBe(0);

    // The raw auth table is untouched.
    const { getAuditDb } = await import("../admin/audit");
    const database = await getAuditDb();
    const authRows = database.prepare("SELECT COUNT(*) AS cnt FROM auth_failure_log").get() as { cnt: number };
    expect(authRows.cnt).toBe(2);

    await app.close();
  });
});