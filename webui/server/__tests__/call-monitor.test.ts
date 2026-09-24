import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let previousRoot: string | undefined;
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
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousSlowMs = process.env.LUCY_OBSERVABILITY_SLOW_MS;
  previousMaxError = process.env.LUCY_OBSERVABILITY_MAX_ERROR_RATE;
  previousMaxDenied = process.env.LUCY_OBSERVABILITY_MAX_DENIED_RATE;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
  process.env.LUCY_OBSERVABILITY_SLOW_MS = "1000";
  process.env.LUCY_OBSERVABILITY_MAX_ERROR_RATE = "0.02";
  process.env.LUCY_OBSERVABILITY_MAX_DENIED_RATE = "0.1";
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
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

  it("returns no_data SLO when the window has no business calls", async () => {
    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/ops/call-monitor?range=1h")
        .expect(200);
      expect(res.body.data.window.range).toBe("1h");
      expect(res.body.data.window.hours).toBe(1);
      expect(res.body.data.traffic.businessCalls).toBe(0);
      expect(res.body.data.slo.status).toBe("no_data");
      expect(res.body.data.slo.violations).toEqual([]);
      expect(res.body.data.topTools).toEqual([]);
      expect(res.body.data.recentFailures).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
