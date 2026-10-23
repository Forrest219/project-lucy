import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeAuditDb, readR1AuditObservability, writeLog } from "../proxy/audit.js";
import { identifyRequestDetailed, invalidateAccessConfigCache } from "../proxy/identity.js";
import {
  QuestionBudget,
  actorFromToken,
  classifyFailure,
  isQuestionDataTool,
  lookupPublishedVersion,
  questionBudgetEnabled,
  registerPublishedVersion,
  repairHint,
  resolveAppliedVersion,
  usageGroup,
} from "../proxy/question-experience.js";

describe("question budget and repair hints", () => {
  it("stops on the 21st data call and again after the one allowed continuation", () => {
    const budget = new QuestionBudget();
    for (let i = 0; i < 20; i += 1) {
      expect(budget.consume("turn-1", 1_000).action).toBe("allow");
    }
    const firstStop = budget.consume("turn-1", 1_000);
    expect(firstStop.action).toBe("stop");
    if (firstStop.action !== "stop") return;
    expect(firstStop.reason).toBe("question_budget_exhausted");
    expect(firstStop.partial).toBe(true);
    expect(firstStop.continuable).toBe(true);
    expect(classifyFailure({ outcome: "budget_stop", decisionReason: firstStop.reason })).toBe("");

    expect(budget.consume("turn-1", 1_000, "turn-1").action).toBe("allow");
    for (let i = 0; i < 19; i += 1) {
      expect(budget.consume("turn-1", 1_000).action).toBe("allow");
    }
    expect(budget.consume("turn-1", 1_000).action).toBe("stop");
    expect(budget.consume("turn-1", 1_000, "turn-1").action).toBe("stop");
  });

  it("stops when the wall clock reaches 120 seconds", () => {
    const budget = new QuestionBudget();
    expect(budget.consume("turn-wall", 5_000).action).toBe("allow");
    const stopped = budget.consume("turn-wall", 5_000 + 120_000);
    expect(stopped.action).toBe("stop");
  });

  it("does not count a call that has no turn, and ignores protocol tools", () => {
    const budget = new QuestionBudget();
    expect(budget.consume(undefined, 0).action).toBe("allow");
    expect(isQuestionDataTool("lucy_begin_question")).toBe(false);
    expect(isQuestionDataTool("lucy_query")).toBe(true);
    expect(isQuestionDataTool("resources/list")).toBe(false);
  });

  it("can be switched off", () => {
    const previous = process.env.LUCY_QUESTION_BUDGET;
    process.env.LUCY_QUESTION_BUDGET = "off";
    expect(questionBudgetEnabled()).toBe(false);
    if (previous === undefined) delete process.env.LUCY_QUESTION_BUDGET;
    else process.env.LUCY_QUESTION_BUDGET = previous;
  });

  it("keeps repair hints inside the role allow list", () => {
    const allowed = new Set(["orders"]);
    const hint = repairHint(
      { failureDimension: "用法与语义", suggestedSources: ["orders", "secret_payroll"] },
      allowed,
    );
    expect(hint).toContain("orders");
    expect(hint).not.toContain("secret_payroll");
    const denied = repairHint(
      { failureDimension: "权限拒绝", suggestedSources: ["secret_payroll"] },
      allowed,
    );
    expect(denied ?? "").not.toContain("secret_payroll");
  });

  it("classifies wiki misses, empty explicit tables, pushdown, timeout, and permission denials", () => {
    expect(classifyFailure({
      outcome: "error",
      decisionReason: "upstream_error",
      errorDetail: "measure COUNT(*) has no source",
    })).toBe("用法与语义");
    expect(classifyFailure({ outcome: "error", decisionReason: "wiki_not_found" })).toBe("用法与语义");
    expect(classifyFailure({ outcome: "error", decisionReason: "explicit_table_required:<empty>" })).toBe("用法与语义");
    expect(classifyFailure({
      outcome: "error",
      decisionReason: "upstream_error",
      errorDetail: "Connection \"sql_server\" is not configured in ktx.yaml",
    })).toBe("用法与语义");
    expect(classifyFailure({
      outcome: "error",
      decisionReason: "upstream_error",
      errorDetail: "STRUCT('x' AS field, '=' AS op, 'y' AS val)",
    })).toBe("过滤条件下推");
    expect(classifyFailure({
      outcome: "error",
      decisionReason: "timeout",
      errorDetail: "Timeout",
    })).toBe("引擎超时与并发");
    expect(classifyFailure({ outcome: "denied", decisionReason: "table_forbidden:orders" })).toBe("权限拒绝");
    expect(classifyFailure({ outcome: "denied", decisionReason: "wiki_forbidden" })).toBe("权限拒绝");
    expect(classifyFailure({ outcome: "denied", decisionReason: "explicit_table_required:biods.secret" })).toBe("权限拒绝");
    expect(classifyFailure({ outcome: "denied", decisionReason: "unknown_or_forbidden_connection:sql_server" })).toBe("权限拒绝");
    expect(classifyFailure({ outcome: "denied", decisionReason: "tool_unclassified:kx" })).toBe("权限拒绝");
  });

  it("writes an applied version only when the publication declares one", () => {
    registerPublishedVersion("demo_orders", null);
    expect(resolveAppliedVersion({}, lookupPublishedVersion("demo_orders"))).toBeNull();
    expect(resolveAppliedVersion({}, null)).toBeNull();

    registerPublishedVersion("demo_orders", {
      version: "demo-v1",
      businessDate: "2026-10-01",
      valueKind: "实际",
    });
    expect(resolveAppliedVersion({}, lookupPublishedVersion("demo_orders"))).toEqual({
      version: "demo-v1",
      businessDate: "2026-10-01",
      valueKind: "实际",
    });
    expect(resolveAppliedVersion({ version: "caller-set" }, lookupPublishedVersion("demo_orders"))).toBeNull();
    registerPublishedVersion("demo_orders", null);
  });

  it("does not turn a token label or an unmarked urllib client into a person or automation", () => {
    expect(actorFromToken({ label: "测试2" })).toEqual({});
    expect(usageGroup({ userId: "agent_1", client: "Python-urllib/3.11" })).toBe("Agent");
    expect(actorFromToken({ label: "测试2", actor_id: "person-1", actor_kind: "person" })).toEqual({
      actorId: "person-1",
      actorKind: "person",
    });
    expect(usageGroup({
      userId: "agent_1",
      actorId: "person-1",
      actorKind: "person",
      client: "Python-urllib/3.11",
    })).toBe("使用人");
    expect(usageGroup({
      userId: "agent_1",
      actorId: "nightly",
      actorKind: "automation",
    })).toBe("自动化调用");
  });
});

describe("usage actor groups", () => {
  let dir = "";
  const previousAudit = process.env.LUCY_AUDIT_DB;
  const previousAccess = process.env.LUCY_ACCESS_CONFIG_PATH;

  afterEach(async () => {
    closeAuditDb();
    invalidateAccessConfigCache();
    if (previousAudit === undefined) delete process.env.LUCY_AUDIT_DB;
    else process.env.LUCY_AUDIT_DB = previousAudit;
    if (previousAccess === undefined) delete process.env.LUCY_ACCESS_CONFIG_PATH;
    else process.env.LUCY_ACCESS_CONFIG_PATH = previousAccess;
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("groups audit rows by actor without using the token label", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lucy-usage-"));
    process.env.LUCY_AUDIT_DB = path.join(dir, "audit.sqlite");
    closeAuditDb();
    const base = { ts: new Date().toISOString(), userId: "agent_1", tool: "lucy_query", durationMs: 10 };
    await writeLog({ ...base, requestId: "person", outcome: "ok", actorId: "person-1", actorKind: "person", tokenLabel: "测试2" });
    await writeLog({ ...base, requestId: "agent", outcome: "ok", client: "Python-urllib/3.11", tokenLabel: "测试2" });
    await writeLog({ ...base, requestId: "job", outcome: "ok", actorId: "nightly", actorKind: "automation", tokenLabel: "测试2" });

    const snapshot = await readR1AuditObservability({ hours: 24 });
    expect(snapshot.usage.actors).toEqual(expect.arrayContaining([
      { group: "使用人", calls: 1 },
      { group: "Agent", calls: 1 },
      { group: "自动化调用", calls: 1 },
    ]));
  });

  it("reads actor_id from the token and leaves the label as a remark", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lucy-actor-"));
    process.env.LUCY_AUDIT_DB = path.join(dir, "audit.sqlite");
    process.env.LUCY_ACCESS_CONFIG_PATH = path.join(dir, "access.yaml");
    closeAuditDb();
    invalidateAccessConfigCache();
    const token = "actor-test-token";
    const hash = `sha256:${createHash("sha256").update(token).digest("hex")}`;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(process.env.LUCY_ACCESS_CONFIG_PATH, `users:
  - id: agent_1
    enabled: true
    tokens:
      - hash: "${hash}"
        label: "测试2"
        actor_id: person-1
        actor_kind: person
`, "utf8");

    const identified = await identifyRequestDetailed(`Bearer ${token}`);
    expect(identified.ok).toBe(true);
    if (!identified.ok) return;
    expect(identified.identity.tokenLabel).toBe("测试2");
    expect(identified.identity.actorId).toBe("person-1");
    expect(identified.identity.actorKind).toBe("person");
    expect(identified.identity.actorId).not.toBe(identified.identity.tokenLabel);
  });
});
