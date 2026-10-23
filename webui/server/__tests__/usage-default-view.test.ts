/**
 * WO-202610-13 T6 / SC-16 — 使用分析默认视图.
 *
 * Protocol tools never enter the default KPI. A probe call leaves the default
 * view only when BOTH hold: the args or connection name looks like a probe,
 * and the Token carries an explicit `eval_mark`. A name-only match stays.
 * `eval_mark` is never inferred from User-Agent, `token_label`, `actor_kind`,
 * or the connection name. Raw rows are never dropped.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultUsageExcluded,
  evalMarkFromToken,
  hasProbeName,
  isEvalProbeCall,
} from "../proxy/question-experience.js";

let auditDbPath: string;
let previousAuditDb: string | undefined;

beforeEach(() => {
  auditDbPath = path.join(
    process.env.LUCY_AUDIT_TEST_ROOT ?? os.tmpdir(),
    `lucy-usage-view-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.LUCY_AUDIT_DB = auditDbPath;
});

afterEach(async () => {
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(auditDbPath, { force: true });
  await mkdtemp(path.join(os.tmpdir(), "lucy-usage-view-"));
});

describe("usage analysis default view", () => {
  it("keeps protocol tools out of the default view", () => {
    for (const tool of ["tools/list", "initialize", "notifications/initialized", "ping", "resources/list"]) {
      expect(defaultUsageExcluded({ tool, evalMark: false })).toBe(true);
    }
    expect(defaultUsageExcluded({ tool: "lucy_query", evalMark: false })).toBe(false);
  });

  it("separates a probe call only when the name matches AND eval_mark is set", () => {
    expect(isEvalProbeCall({ evalMark: true, connectionName: "demo-mysql" })).toBe(true);
    expect(isEvalProbeCall({ evalMark: true, connectionName: "rds-test" })).toBe(true);
    expect(isEvalProbeCall({ evalMark: true, connectionName: "probe-orders" })).toBe(true);
  });

  it("keeps a name-only match in the default view when eval_mark is unset", () => {
    expect(isEvalProbeCall({ evalMark: false, connectionName: "demo-mysql" })).toBe(false);
    expect(isEvalProbeCall({ connectionName: "demo-mysql" })).toBe(false);
    expect(isEvalProbeCall({ evalMark: null, connectionName: "rds-test" })).toBe(false);
  });

  it("reads the probe marker out of the args as well as the connection name", () => {
    expect(isEvalProbeCall({ evalMark: true, args: { connectionId: "demo-mysql" } })).toBe(true);
    expect(isEvalProbeCall({ evalMark: true, args: { sourceName: "probe-orders" } })).toBe(true);
    expect(isEvalProbeCall({ evalMark: true, args: { limit: 10 } })).toBe(false);
  });

  it("treats eval_mark as absent unless the Token says true", () => {
    expect(evalMarkFromToken({ eval_mark: true })).toBe(true);
    expect(evalMarkFromToken({ eval_mark: false })).toBe(false);
    expect(evalMarkFromToken({})).toBe(false);
    expect(evalMarkFromToken(null)).toBe(false);
    expect(evalMarkFromToken(undefined)).toBe(false);
    // Anything truthy-but-not-true is not an explicit mark.
    expect(evalMarkFromToken({ eval_mark: "yes" })).toBe(false);
    expect(evalMarkFromToken({ eval_mark: 1 })).toBe(false);
  });

  it("never infers the eval mark from actor_kind or the token label", () => {
    // An automation token with a probe-looking name is still unmarked.
    expect(isEvalProbeCall({ evalMark: false, connectionName: "demo-mysql" })).toBe(false);
    expect(hasProbeName("demo-mysql")).toBe(true);
    expect(hasProbeName("reporting")).toBe(false);
    expect(hasProbeName(undefined)).toBe(false);
  });

  it("does not drop raw rows — it only splits the default view", async () => {
    const { writeLog, readR1AuditObservability, closeAuditDb } = await import("../proxy/audit");

    await writeLog({
      ts: new Date().toISOString(),
      userId: "eval_agent",
      tokenLabel: "测试2",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 12,
      requestId: "probe-eval",
      evalMark: true,
      argsSummary: { connectionId: "demo-mysql" }
    });
    await writeLog({
      ts: new Date().toISOString(),
      userId: "analyst",
      tokenLabel: "human",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 12,
      requestId: "human-call",
      evalMark: false,
      argsSummary: { connectionId: "reporting" }
    });
    await writeLog({
      ts: new Date().toISOString(),
      userId: "analyst",
      tokenLabel: "human",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 12,
      requestId: "human-probe-name",
      evalMark: false,
      argsSummary: { connectionId: "demo-mysql" }
    });
    await writeLog({
      ts: new Date().toISOString(),
      userId: "analyst",
      tokenLabel: "human",
      tool: "tools/list",
      outcome: "ok",
      durationMs: 3,
      requestId: "protocol"
    });

    const view = await readR1AuditObservability({ hours: 24 });
    closeAuditDb();

    const toolCalls = view.usage.tools.find((entry) => entry.tool === "lucy_query");
    // Default KPI sees only the two unmarked business calls.
    expect(toolCalls?.calls).toBe(2);
    expect(view.usage.defaultViewExcluded).toBe(1);
    // Raw rows survive: businessCalls still counts the probe-marked call.
    expect(view.traffic.businessCalls).toBe(3);
    expect(view.traffic.totalRequests).toBe(4);
  });
});