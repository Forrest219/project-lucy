/**
 * WO-202610-13 T10 / SC-26 — 双轨角色的审计对比.
 *
 * `readR1AuditObservability().usage.roles` must count a denial once against
 * `matched_role_id`, not once per role in `role_ids` — otherwise the dual
 * track comparison is inflated. A denial with no matched role gets its own
 * row rather than being spread over `role_ids`. Actor grouping still uses the
 * WO-12 `usageGroup`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let auditDbPath: string;
let previousAuditDb: string | undefined;

const now = (): string => new Date().toISOString();

beforeEach(() => {
  auditDbPath = path.join(os.tmpdir(), `lucy-role-denial-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`);
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.LUCY_AUDIT_DB = auditDbPath;
});

afterEach(async () => {
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(auditDbPath, { force: true });
  await mkdtemp(path.join(os.tmpdir(), "lucy-role-denial-"));
});

describe("role denial comparison (SC-26)", () => {
  it("counts a denial once against matched_role_id, not once per role", async () => {
    const { writeLog, readR1AuditObservability, closeAuditDb } = await import("../proxy/audit");

    // One denial, one matched role, but the token carries several roles.
    // Counting per role would report 3; counting per matched role reports 1.
    await writeLog({
      ts: now(),
      userId: "dual_agent",
      tokenLabel: "dual",
      tool: "lucy_query",
      outcome: "denied",
      errorDetail: "table_forbidden:secret_payroll",
      durationMs: 7,
      requestId: "deny-1",
      decisionReason: "table_forbidden:secret_payroll",
      roleIds: ["role_old", "role_new", "role_audit"],
      matchedRoleId: "role_new"
    });
    await writeLog({
      ts: now(),
      userId: "dual_agent",
      tokenLabel: "dual",
      tool: "lucy_query",
      outcome: "denied",
      errorDetail: "table_forbidden:secret_payroll",
      durationMs: 9,
      requestId: "deny-2",
      decisionReason: "table_forbidden:secret_payroll",
      roleIds: ["role_old", "role_new", "role_audit"],
      matchedRoleId: "role_old"
    });

    const view = await readR1AuditObservability({ hours: 24 });
    closeAuditDb();

    const byRole = new Map(view.usage.roles.map((role) => [role.roleId, role]));
    expect(byRole.get("role_new")?.denied).toBe(1);
    expect(byRole.get("role_old")?.denied).toBe(1);
    // role_audit was on the token but never matched this denial.
    expect(byRole.get("role_audit")?.denied ?? 0).toBe(0);
    // Every role still sees the call itself.
    expect(byRole.get("role_audit")?.calls).toBe(2);
    expect(byRole.get("role_new")?.calls).toBe(2);

    const totalDenied = view.usage.roles.reduce((sum, role) => sum + role.denied, 0);
    expect(totalDenied).toBe(2);
  });

  it("puts a denial with no matched role on its own row", async () => {
    const { writeLog, readR1AuditObservability, closeAuditDb } = await import("../proxy/audit");

    await writeLog({
      ts: now(),
      userId: "unmatched_agent",
      tokenLabel: "unmatched",
      tool: "lucy_query",
      outcome: "denied",
      errorDetail: "wiki_forbidden",
      durationMs: 4,
      requestId: "deny-unmatched",
      decisionReason: "wiki_forbidden",
      roleIds: ["role_old", "role_new"],
      matchedRoleId: ""
    });

    const view = await readR1AuditObservability({ hours: 24 });
    closeAuditDb();

    const byRole = new Map(view.usage.roles.map((role) => [role.roleId, role]));
    expect(byRole.get("role_old")?.denied ?? 0).toBe(0);
    expect(byRole.get("role_new")?.denied ?? 0).toBe(0);

    const unmatched = view.usage.roles.find((role) => role.denied > 0);
    expect(unmatched).toBeDefined();
    expect(unmatched?.roleId).toBe("__unmatched_role__");
    // The roles on the token still record the call itself.
    expect(byRole.get("role_old")?.calls).toBe(1);
    expect(byRole.get("role_new")?.calls).toBe(1);
  });

  it("still groups actors with the WO-12 usageGroup", async () => {
    const { writeLog, readR1AuditObservability, closeAuditDb } = await import("../proxy/audit");

    await writeLog({
      ts: now(),
      userId: "person_agent",
      tokenLabel: "human",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 5,
      requestId: "ok-person",
      actorId: "alice",
      actorKind: "person",
      roleIds: ["role_a"],
      matchedRoleId: "role_a"
    });
    await writeLog({
      ts: now(),
      userId: "auto_agent",
      tokenLabel: "bot",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 5,
      requestId: "ok-automation",
      actorId: "pipeline",
      actorKind: "automation",
      roleIds: ["role_b"],
      matchedRoleId: "role_b"
    });
    await writeLog({
      ts: now(),
      userId: "plain_agent",
      tokenLabel: "unmarked",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 5,
      requestId: "ok-agent",
      roleIds: ["role_c"],
      matchedRoleId: "role_c"
    });

    const view = await readR1AuditObservability({ hours: 24 });
    closeAuditDb();

    const actors = new Map(view.usage.actors.map((entry) => [entry.group, entry.calls]));
    expect(actors.get("使用人")).toBe(1);
    expect(actors.get("自动化调用")).toBe(1);
    // An unmarked token is an Agent, not a 使用人 and not automation.
    expect(actors.get("Agent")).toBe(1);
  });
});