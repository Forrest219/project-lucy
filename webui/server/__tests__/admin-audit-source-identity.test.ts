import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildServer } from "../index";
import { writeAccessLogSources } from "../proxy/audit";
import request from "supertest";

/**
 * Lucy v0.25 / P0-4 §3.4 (E5) — full table identity.
 *
 * Two connections may expose the same `schema.table`. The sources view must
 * report them as two distinct tables, under their real connection, and it must
 * not merge them into one row nor report them under a fabricated connection.
 */
describe("GET /api/admin/audit/sources — full table identity (E5)", () => {
  let projectRoot: string;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-audit-source-identity-"));
    await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: []\n", "utf8");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    // The audit database is a process-level singleton shared by every test in
    // this file; rows written by an earlier case would otherwise be counted
    // here.
    const { getAuditDb } = await import("../admin/audit");
    const database = await getAuditDb();
    // Child rows first: `access_log_sources.access_log_id` references
    // `access_log.id`.
    database.exec("DELETE FROM access_log_sources");
    database.exec("DELETE FROM access_log");
    app = buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeCall(
    requestId: string,
    tables: string[],
    sources: Array<{ connectionId: string; schema: string; sourceName: string; physicalTable: string }>
  ): Promise<void> {
    const { writeLog } = await import("../proxy/audit");
    const accessLogId = await writeLog({
      ts: new Date().toISOString(),
      userId: "user-1",
      tool: "lucy_query",
      tables: JSON.stringify(tables),
      outcome: "ok",
      durationMs: 5,
      requestId,
      traceId: requestId
    } as Parameters<typeof writeLog>[0]);
    await writeAccessLogSources(
      accessLogId,
      new Date().toISOString(),
      "user-1",
      "lucy_query",
      sources.map((source) => ({
        connectionId: source.connectionId,
        schemaName: source.schema,
        sourceName: source.sourceName,
        physicalTable: source.physicalTable,
        extractionMethod: "declared",
        confidence: "high" as const
      }))
    );
  }

  it("keeps two connections that expose the same schema.table apart", async () => {
    await writeCall("same-table-1", ["dataforai.kx_fact"], [
      {
        connectionId: "conn_a",
        schema: "dataforai",
        sourceName: "kx_fact",
        physicalTable: "kx_fact"
      }
    ]);
    await writeCall("same-table-2", ["dataforai.kx_fact"], [
      {
        connectionId: "conn_b",
        schema: "dataforai",
        sourceName: "kx_fact",
        physicalTable: "kx_fact"
      }
    ]);

    const res = await request(app.server).get("/api/admin/audit/sources").expect(200);

    const connections = res.body.data.connections as Array<{ connection: string; calls: number }>;
    expect(connections).toContainEqual({ connection: "conn_a", calls: 1 });
    expect(connections).toContainEqual({ connection: "conn_b", calls: 1 });
    // The two calls must not be collapsed into a single shared bucket.
    expect(connections.find((entry) => entry.connection === "conn_a")?.calls).toBe(1);
    expect(connections.find((entry) => entry.connection === "conn_b")?.calls).toBe(1);

    const topTables = res.body.data.topTables as Array<{ table: string; calls: number; denied: number }>;
    const tableKeys = topTables.map((entry) => entry.table);
    expect(tableKeys).toContain("conn_a.dataforai.kx_fact");
    expect(tableKeys).toContain("conn_b.dataforai.kx_fact");
    // Same table name, two connections → two distinct rows, never merged.
    expect(topTables.filter((entry) => entry.table === "conn_a.dataforai.kx_fact")).toHaveLength(1);
    expect(topTables.filter((entry) => entry.table === "conn_b.dataforai.kx_fact")).toHaveLength(1);
    // No fabricated connection bucket.
    expect(tableKeys.some((key) => key.startsWith("audit-derived."))).toBe(false);
  });

  it("reports the real connection, schema and table for a recorded source", async () => {
    await writeCall("identity-1", ["dataforai.kx_fact"], [
      {
        connectionId: "conn_real",
        schema: "dataforai",
        sourceName: "kx_fact",
        physicalTable: "kx_fact"
      }
    ]);

    const res = await request(app.server).get("/api/admin/audit/sources").expect(200);
    const body = res.body.data;
    expect(body.connections).toContainEqual({ connection: "conn_real", calls: 1 });
    expect(body.schemas).toContainEqual({ schema: "dataforai", calls: 1 });
    expect(body.topTables).toContainEqual({
      table: "conn_real.dataforai.kx_fact",
      calls: 1,
      denied: 0
    });
  });
});
