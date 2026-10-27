import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let previousRoot: string | undefined;
  let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousSlowMs: string | undefined;
let previousMaxError: string | undefined;
let previousMaxDenied: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-call-monitor-"));
  await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousSlowMs = process.env.LUCY_OBSERVABILITY_SLOW_MS;
  previousMaxError = process.env.LUCY_OBSERVABILITY_MAX_ERROR_RATE;
  previousMaxDenied = process.env.LUCY_OBSERVABILITY_MAX_DENIED_RATE;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
  process.env.LUCY_OBSERVABILITY_SLOW_MS = "1000";
  process.env.LUCY_OBSERVABILITY_MAX_ERROR_RATE = "0.02";
  process.env.LUCY_OBSERVABILITY_MAX_DENIED_RATE = "0.1";
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
    if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (previousSlowMs === undefined) delete process.env.LUCY_OBSERVABILITY_SLOW_MS;
  else process.env.LUCY_OBSERVABILITY_SLOW_MS = previousSlowMs;
  if (previousMaxError === undefined) delete process.env.LUCY_OBSERVABILITY_MAX_ERROR_RATE;
  else process.env.LUCY_OBSERVABILITY_MAX_ERROR_RATE = previousMaxError;
  if (previousMaxDenied === undefined) delete process.env.LUCY_OBSERVABILITY_MAX_DENIED_RATE;
  else process.env.LUCY_OBSERVABILITY_MAX_DENIED_RATE = previousMaxDenied;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("GET /api/ops/call-monitor", () => {
  it("aggregates MCP business calls with SLO and without eval fields", async () => {
    const { writeLog } = await import("../proxy/audit");

    await writeLog({
      ts: new Date().toISOString(),
      userId: "agent-a",
      tokenLabel: "secret-token-label",
      tokenHashPrefix: "sha256:deadbeef",
      tool: "tools/list",
      outcome: "ok",
      durationMs: 3,
      requestId: "protocol-only"
    });
    await writeLog({
      ts: new Date().toISOString(),
      userId: "agent-a",
      tokenLabel: "secret-token-label",
      tokenHashPrefix: "sha256:deadbeef",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 20,
      requestId: "query-ok",
      traceId: "trace-ok"
    });
    await writeLog({
      ts: new Date().toISOString(),
      userId: "agent-a",
      tokenLabel: "secret-token-label",
      tokenHashPrefix: "sha256:deadbeef",
      tool: "lucy_query",
      outcome: "error",
      durationMs: 50,
      requestId: "query-error",
      decisionReason: "upstream_error",
      traceId: "trace-error"
    });
    await writeLog({
      ts: new Date().toISOString(),
      userId: "agent-b",
      tokenLabel: "secret-token-label",
      tokenHashPrefix: "sha256:deadbeef",
      tool: "lucy_sl",
      outcome: "denied",
      durationMs: 2500,
      requestId: "query-denied",
      decisionReason: "capability_forbidden",
      traceId: "trace-denied"
    });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/ops/call-monitor?range=24h")
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(res.body.data.traffic).toMatchObject({
        businessCalls: 3,
        okCalls: 1,
        errorCalls: 1,
        deniedCalls: 1
      });
      expect(res.body.data.series).toHaveLength(24);
      expect(res.body.data.series.reduce((sum: number, point: { businessCalls: number }) => sum + point.businessCalls, 0)).toBe(3);
      expect(res.body.data.series.every((point: { p95Ms: number | null }) => point.p95Ms === null)).toBe(true);
      expect(res.body.data.window.timeZone).toBe("Asia/Shanghai");
      expect(res.body.data.latency.p95Ms).toEqual(expect.any(Number));
      expect(res.body.data.latency.slowCalls).toBe(1);
      expect(res.body.data.topTools[0]).toMatchObject({
        tool: "lucy_query",
        calls: 2,
        errors: 1,
        denied: 0
      });
      expect(res.body.data.recentFailures).toHaveLength(2);
      expect(res.body.data.recentFailures.every((row: { id: number }) => row.id > 0)).toBe(true);
      expect(res.body.data.slo.status).toBe("warn");
      expect(res.body.data.slo.violations).toEqual(
        expect.arrayContaining(["error_rate", "denied_rate", "latency_p95"])
      );
      expect(res.body.data).not.toHaveProperty("eval");
      expect(res.body.data).not.toHaveProperty("hermes");
      expect(JSON.stringify(res.body)).not.toContain("secret-token-label");
      expect(JSON.stringify(res.body)).not.toContain("sha256:deadbeef");
    } finally {
      await app.close();
    }
  });

  it("excludes the full protocol set and eval probes from every KPI (Spec 189)", async () => {
    const { getAuditDb } = await import("../admin/audit.js");
    const { writeLog } = await import("../proxy/audit");
    const ts = new Date().toISOString();

    // One row per protocol method — including the ones the old 3-method list
    // missed (ping / resources/* / prompts/list / notifications/cancelled /
    // server/*).
    for (const tool of [
      "initialize",
      "notifications/initialized",
      "tools/list",
      "ping",
      "resources/list",
      "resources/templates/list",
      "prompts/list",
      "notifications/cancelled",
      "server/discover",
      "server/unknown"
    ]) {
      await writeLog({
        ts,
        userId: "agent-protocol",
        tokenHashPrefix: "sha256:aaaaaaaaaaaa",
        tool,
        outcome: "ok",
        durationMs: 2,
        requestId: `protocol-${tool}`
      });
    }

    // One real business call.
    await writeLog({
      ts,
      userId: "agent-business",
      tokenHashPrefix: "sha256:bbbbbbbbbbbb",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 20,
      requestId: "business-ok"
    });

    // One explicit eval probe (eval_mark = 1 + a probe-looking argument).
    const db = await getAuditDb();
    db.prepare(
      `INSERT INTO access_log
         (ts, user_id, token_hash_prefix, tool, outcome, duration_ms, eval_mark,
          args_summary, request_id)
       VALUES (?, 'agent-probe', 'sha256:cccccccccccc', 'lucy_query', 'ok', 30, 1, ?, 'probe-1')`
    ).run(ts, JSON.stringify({ connection: "probe-demo" }));

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server).get("/api/ops/call-monitor?range=24h").expect(200);

      // Only the one real business call counts.
      expect(res.body.data.traffic.businessCalls).toBe(1);
      expect(res.body.data.traffic.okCalls).toBe(1);
      expect(res.body.data.traffic.errorCalls).toBe(0);
      expect(res.body.data.traffic.deniedCalls).toBe(0);
      expect(
        res.body.data.series.reduce((sum: number, p: { businessCalls: number }) => sum + p.businessCalls, 0)
      ).toBe(1);
      // The tool ranking carries the business tool only.
      expect(res.body.data.topTools.map((t: { tool: string }) => t.tool)).toEqual(["lucy_query"]);
      expect(res.body.data.recentFailures).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("returns no_data SLO when the window has no business calls", async () => {
    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/ops/call-monitor?range=1h")
        .expect(200);
      expect(res.body.data.window.range).toBe("1h");
      expect(res.body.data.window.bucket).toBe("5m");
      expect(res.body.data.series).toHaveLength(12);
      expect(res.body.data.traffic.businessCalls).toBe(0);
      expect(res.body.data.slo.status).toBe("no_data");
      expect(res.body.data.slo.violations).toEqual([]);
      expect(res.body.data.topTools).toEqual([]);
      expect(res.body.data.recentFailures).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("uses fixed bucket counts and does not treat hours=168 as 7 days", async () => {
    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const week = await request(app.server).get("/api/ops/call-monitor?range=7d").expect(200);
      expect(week.body.data.window.bucket).toBe("day");
      expect(week.body.data.series).toHaveLength(7);

      const month = await request(app.server).get("/api/ops/call-monitor?range=30d").expect(200);
      expect(month.body.data.series).toHaveLength(30);

      const legacy = await request(app.server).get("/api/ops/call-monitor?hours=168").expect(200);
      expect(legacy.body.data.window.range).toBe("24h");
      expect(legacy.body.data.series).toHaveLength(24);
    } finally {
      await app.close();
    }
  });

  it("leaves sparse bucket percentiles empty while the window percentile stays", async () => {
    const { writeLog, readCallMonitorSnapshot } = await import("../proxy/audit");
    const { callMonitorWindow } = await import("../../src/lib/callMonitorWindow");
    const now = new Date("2026-10-12T12:30:00.000Z");
    const plan = callMonitorWindow("24h", now);
    const previous = new Date(Date.parse(plan.buckets[22].start) + 10 * 60 * 1000).toISOString();
    const current = new Date(Date.parse(plan.buckets[23].start) + 10 * 60 * 1000).toISOString();

    for (let index = 0; index < 19; index += 1) {
      await writeLog({
        ts: previous,
        userId: "agent-a",
        tool: "lucy_query",
        outcome: "ok",
        durationMs: 100,
        requestId: `sparse-${index}`
      });
    }
    for (let index = 0; index < 20; index += 1) {
      await writeLog({
        ts: current,
        userId: "agent-a",
        tool: "lucy_query",
        outcome: "ok",
        durationMs: 400,
        requestId: `dense-${index}`
      });
    }
    await writeLog({
      ts: current,
      userId: "agent-a",
      tool: "tools/list",
      outcome: "ok",
      durationMs: 5,
      requestId: "protocol"
    });
    await writeLog({
      ts: "2026-10-01T00:00:00.000Z",
      userId: "agent-a",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 9,
      requestId: "outside-window"
    });

    const snapshot = await readCallMonitorSnapshot({ range: "24h", now, slowMs: 1000 });
    const sparse = snapshot.series.find((point) => point.businessCalls === 19);
    const dense = snapshot.series.find((point) => point.businessCalls === 20);
    const empty = snapshot.series.find((point) => point.businessCalls === 0);

    expect(snapshot.series).toHaveLength(24);
    expect(snapshot.traffic.businessCalls).toBe(39);
    expect(snapshot.series.reduce((sum, point) => sum + point.businessCalls, 0)).toBe(39);
    expect(sparse?.p95Ms).toBeNull();
    expect(sparse?.successRate).toBe(1);
    expect(dense?.p95Ms).toEqual(expect.any(Number));
    expect(empty?.successRate).toBeNull();
    expect(empty?.p95Ms).toBeNull();
    expect(empty?.slowCalls).toBe(0);
    expect(snapshot.latency.p95Ms).toEqual(expect.any(Number));
    expect(JSON.stringify(snapshot)).not.toContain("outside-window");
  });
});
