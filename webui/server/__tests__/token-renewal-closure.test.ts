import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redactAuditSummary } from "../security/redaction.js";
import { changeTypeLabel } from "../../src/lib/configAuditLabels.js";

const auditControl = vi.hoisted(() => ({
  revokedThrow: false,
  calls7d: 0,
  revoked: [] as Array<{ token_hash: string }>,
  record: vi.fn(async () => 1)
}));

const gateInject = vi.hoisted(() => ({
  decision: null as null | "block" | "override_required"
}));

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(async () => ({
    prepare: (sql: string) => {
      if (sql.includes("revoked_tokens") && auditControl.revokedThrow) {
        return {
          get: () => {
            throw new Error("revoked_tokens unavailable");
          }
        };
      }
      if (sql.includes("INSERT OR REPLACE INTO revoked_tokens")) {
        return {
          run: (hash: string) => {
            auditControl.revoked.push({ token_hash: hash });
            return { lastInsertRowid: auditControl.revoked.length };
          }
        };
      }
      if (sql.includes("SELECT 1 AS hit FROM revoked_tokens")) {
        return {
          get: (hash: string) =>
            auditControl.revoked.some((row) => row.token_hash === hash) ? { hit: 1 } : undefined
        };
      }
      if (sql.includes("FROM access_log")) {
        return { get: () => ({ cnt: auditControl.calls7d }) };
      }
      return { get: () => undefined, all: () => [], run: () => ({ lastInsertRowid: 1 }) };
    },
    exec: vi.fn(),
    pragma: vi.fn(),
    transaction: (fn: (...args: unknown[]) => unknown) => fn
  })),
  recordConfigChange: (...args: unknown[]) => auditControl.record(...args),
  updateConfigChangeStatus: vi.fn(async () => undefined),
  registerAgentAuditRoutes: vi.fn(),
  registerAuditRoutes: vi.fn()
}));

vi.mock("../access-governance-gate.js", async () => {
  const actual = await vi.importActual<typeof import("../access-governance-gate.js")>(
    "../access-governance-gate.js"
  );
  return {
    ...actual,
    evaluateAccessGovernanceGate: (input: Parameters<typeof actual.evaluateAccessGovernanceGate>[0]) => {
      const decision = actual.evaluateAccessGovernanceGate(input);
      if (!gateInject.decision) return decision;
      return {
        ...decision,
        decision: gateInject.decision,
        override:
          gateInject.decision === "override_required"
            ? {
                reason: "injected",
                requiredApproverCount: 2,
                requiredFields: ["reason", "approvers", "expiresAt", "rollbackPlan"] as const
              }
            : decision.override
      };
    }
  };
});

import { buildServer } from "../index";
import { identifyRequestDetailed, invalidateAccessConfigCache, isTokenExpired } from "../proxy/identity.js";
import * as acl from "../proxy/acl.js";
import * as gate from "../access-governance-gate.js";
import type { FastifyInstance } from "fastify";

function accessYaml(expiresLine: string, delegatedFrom?: string): string {
  const delegated = delegatedFrom ? `\n    delegated_from: ${delegatedFrom}` : "";
  return `users:
  - id: zhangsan
    name: 张三
    enabled: true${delegated}
    tokens:
      - hash: "sha256:aaaa0000"
        label: hermes-laptop
        device_name: desk
        created: 2026-06-18
        ${expiresLine}
    allow:
      tables: []
      tools: []
defaults:
  deny_tools: []
`;
}

let projectRoot: string;
let prevRoot: string | undefined;
let prevAuth: string | undefined;

function expiryInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function dateOnlyInDays(days: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days))
    .toISOString()
    .slice(0, 10);
}

async function makeProject(yaml: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-token-renew-closure-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), yaml, "utf8");
  return root;
}

async function useYaml(yaml: string) {
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), yaml, "utf8");
}

async function yamlNow(): Promise<string> {
  return readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
}

function renewCalls() {
  return auditControl.record.mock.calls.map((call) => call[0] as {
    changeType?: string;
    actor?: string;
    actorIp?: string;
    targetId?: string;
    source?: string;
    oldSummary?: { label?: string; hashPrefix?: string; expires_at?: string };
    newSummary?: { label?: string; hashPrefix?: string; expires_at?: string; repair?: boolean; token?: string };
  });
}

function asActor(app: FastifyInstance, role: "owner" | "operator") {
  app.addHook("onRequest", async (request) => {
    request.lucyAdmin = {
      session: null,
      admin: {
        id: role === "owner" ? "owner_1" : "op_1",
        account_uid: "uid",
        display_name: role,
        role,
        enabled: true,
        created_at: "2026-01-01T00:00:00.000Z"
      },
      stateUnavailable: false,
      authMode: "required"
    };
  });
}

function validOverride() {
  return {
    reason: "incident renew",
    rollbackPlan: "restore the previous expires_at",
    expiresAt: expiryInDays(1),
    approvers: [
      { actorKind: "admin" as const, actorId: "local-admin-1", identityProvider: "deployment-local" },
      { actorKind: "admin" as const, actorId: "local-admin-2", identityProvider: "deployment-local" }
    ]
  };
}

beforeEach(async () => {
  projectRoot = await makeProject(accessYaml(`expires_at: "${expiryInDays(30)}"`));
  prevRoot = process.env.KTX_PROJECT_ROOT;
  prevAuth = process.env.LUCY_WEBUI_AUTH;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_WEBUI_AUTH = "off";
  auditControl.revokedThrow = false;
  auditControl.calls7d = 0;
  auditControl.revoked.length = 0;
  auditControl.record.mockReset();
  auditControl.record.mockResolvedValue(1);
  gateInject.decision = null;
});

afterEach(async () => {
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevAuth === undefined) delete process.env.LUCY_WEBUI_AUTH;
  else process.env.LUCY_WEBUI_AUTH = prevAuth;
  vi.restoreAllMocks();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("token renewal functional contract", () => {
  it("SC-01 / SC-07 keeps identity fields, returns no plaintext, and lets an admin renew", async () => {
    const before = await yamlNow();
    const app = buildServer();
    await app.ready();
    const next = expiryInDays(180);
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: next })
      .expect(200);

    expect(res.body.data.runtimeAck).toBe(true);
    expect(res.body.data.token).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/"token"\s*:/);
    const yaml = await yamlNow();
    expect(yaml).toContain("sha256:aaaa0000");
    expect(yaml).toContain("label: hermes-laptop");
    expect(yaml).toContain("device_name: desk");
    expect(yaml).toContain("created: 2026-06-18");
    expect(yaml).not.toBe(before);
    await app.close();
  });

  it("SC-02 makes an expired token available and stops the Proxy expiry reject", async () => {
    const app = buildServer();
    await app.ready();
    const created = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "cursor-desk", device_name: "desk", expires_at: expiryInDays(30) })
      .expect(200);
    const plaintext = created.body.data.token as string;
    const hash = created.body.data.hash as string;
    const expiredYaml = `users:
  - id: zhangsan
    name: 张三
    enabled: true
    tokens:
      - hash: "${hash}"
        label: cursor-desk
        device_name: desk
        created: 2026-06-18
        expires_at: "2020-01-01T00:00:00.000Z"
    allow:
      tables: []
      tools: []
defaults:
  deny_tools: []
`;
    await useYaml(expiredYaml);
    invalidateAccessConfigCache();
    const denied = await identifyRequestDetailed(`Bearer ${plaintext}`);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("token_expired");

    const next = expiryInDays(90);
    await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/cursor-desk/renew")
      .send({ expires_at: next })
      .expect(200);

    const allowed = await identifyRequestDetailed(`Bearer ${plaintext}`);
    expect(allowed.ok).toBe(true);
    const listed = await request(app.server).get("/api/admin/tokens").expect(200);
    const row = listed.body.data.tokens.find((token: { label: string }) => token.label === "cursor-desk");
    expect(row.status).toBe("available");
    expect(isTokenExpired(row.expires_at)).toBe(false);
    await app.close();
  });

  it("SC-03 keeps the hash in revoked_tokens and rejects renew after a real revoke", async () => {
    const app = buildServer();
    await app.ready();
    await request(app.server)
      .delete("/api/admin/agents/zhangsan/tokens/hermes-laptop")
      .expect(200);
    expect(auditControl.revoked.some((row) => row.token_hash === "sha256:aaaa0000")).toBe(true);
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(90) })
      .expect(404);
    expect(res.body.error.code).toBe("TOKEN_NOT_FOUND");
    expect(auditControl.revoked.some((row) => row.token_hash === "sha256:aaaa0000")).toBe(true);
    await app.close();
  });

  it("SC-04 rejects a residual YAML row whose hash is already revoked", async () => {
    auditControl.revoked.push({ token_hash: "sha256:aaaa0000" });
    const before = await yamlNow();
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(90) })
      .expect(409);
    expect(res.body.error.code).toBe("TOKEN_REVOKED_NOT_RENEWABLE");
    expect(await yamlNow()).toBe(before);
    expect(renewCalls().some((call) => call.changeType === "token_renew")).toBe(false);
    await app.close();
  });

  it("SC-05 writes nothing when the revoked-token lookup throws", async () => {
    auditControl.revokedThrow = true;
    const before = await yamlNow();
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(90) })
      .expect(500);
    expect(res.body.ok).toBe(false);
    expect(await yamlNow()).toBe(before);
    expect(renewCalls().some((call) => call.changeType === "token_renew")).toBe(false);
    await app.close();
  });

  it("SC-06 rejects an operator on a delegated agent and lets the owner renew", async () => {
    await useYaml(accessYaml(`expires_at: "${expiryInDays(30)}"`, "owner_1"));
    const before = await yamlNow();
    const operator = buildServer();
    asActor(operator, "operator");
    await operator.ready();
    const denied = await request(operator.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(120) })
      .expect(403);
    expect(denied.body.error.code).toBe("OWNER_REQUIRED");
    expect(await yamlNow()).toBe(before);
    await operator.close();

    const owner = buildServer();
    asActor(owner, "owner");
    await owner.ready();
    await request(owner.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(120) })
      .expect(200);
    expect(await yamlNow()).not.toBe(before);
    await owner.close();
  });

  it("SC-08 dryRun returns the gate and does not write or audit", async () => {
    const before = await yamlNow();
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ dryRun: true, expires_at: expiryInDays(90) })
      .expect(200);
    expect(res.body.data.dryRun).toBe(true);
    expect(res.body.data.gate).toBeDefined();
    expect(res.body.data.proposed.expires_at).toBeTruthy();
    expect(res.body.data.token).toBeUndefined();
    expect(await yamlNow()).toBe(before);
    expect(renewCalls().some((call) => call.changeType === "token_renew")).toBe(false);
    await app.close();
  });

  it("SC-09 warns and still writes when the agent is really high-traffic", async () => {
    auditControl.calls7d = 50;
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(90) })
      .expect(200);
    expect(res.body.data.gate.decision).toBe("warn");
    expect(res.body.data.gate.findings.some((finding: { code: string }) => finding.code === "TOKEN_FOR_HIGH_TRAFFIC_AGENT")).toBe(true);
    expect(res.body.data.runtimeAck).toBe(true);
    await app.close();
  });

  it("SC-10 injected block leaves YAML unchanged", async () => {
    gateInject.decision = "block";
    const before = await yamlNow();
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(90) })
      .expect(409);
    expect(res.body.error.code).toBe("GOVERNANCE_GATE_BLOCKED");
    expect(await yamlNow()).toBe(before);
    await app.close();
  });

  it("SC-11 injected override rejects a missing payload and accepts a valid one with a trace", async () => {
    const trace = vi.spyOn(gate, "recordAccessGovernanceGateEvent").mockImplementation(() => undefined);
    gateInject.decision = "override_required";
    const before = await yamlNow();
    const app = buildServer();
    await app.ready();
    const missing = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(90) })
      .expect(409);
    expect(missing.body.error.code).toBe("GOVERNANCE_GATE_OVERRIDE_REQUIRED");
    expect(await yamlNow()).toBe(before);

    const accepted = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(90), override: validOverride() })
      .expect(200);
    expect(accepted.body.data.runtimeAck).toBe(true);
    expect(trace).toHaveBeenCalled();
    await app.close();
  });

  it("SC-12 records token_renew with actor, ip, target and both expiries, and no plaintext", async () => {
    const app = buildServer();
    await app.ready();
    await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(160) })
      .expect(200);
    const call = renewCalls().find((entry) => entry.changeType === "token_renew");
    expect(call).toBeDefined();
    expect(call?.actor).toBeTruthy();
    expect(call?.actorIp).toBeTruthy();
    expect(call?.targetId).toBe("zhangsan");
    expect(call?.source).toBe("admin_tokens_api");
    expect(call?.oldSummary?.label).toBe("hermes-laptop");
    expect(call?.oldSummary?.hashPrefix).toBe("sha256:aaaa0000");
    expect(call?.oldSummary?.expires_at).toBeTruthy();
    expect(call?.newSummary?.expires_at).toBeTruthy();
    expect(JSON.stringify(call)).not.toMatch(/"token"\s*:/);
    await app.close();
  });

  it("SC-13 labels 续期 Token, redacts a plaintext token, and counts token_renew in the agent timeline", async () => {
    expect(changeTypeLabel("token_renew")).toBe("续期 Token");
    const redacted = redactAuditSummary("audit_export", {
      label: "hermes-laptop",
      token: "a".repeat(64),
      hashPrefix: "sha256:aaaa0000",
      expires_at: "2027-11-02"
    }) as { token?: string; label?: string; hashPrefix?: string };
    expect(redacted.token).toBe("[REDACTED]");
    expect(redacted.label).toBe("hermes-laptop");
    expect(redacted.hashPrefix).toBe("sha256:aaaa0000");
    const source = await readFile(path.join(import.meta.dirname, "../admin/agents.ts"), "utf8");
    expect(source).toContain("'token_renew'");
    expect(source).toMatch(/change_type IN \([^)]*'token_renew'/);
  });

  it("SC-14 rejects a shorter expiry and an equal expiry that is not a repair", async () => {
    const before = await yamlNow();
    const app = buildServer();
    await app.ready();
    const shorter = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(1) })
      .expect(400);
    expect(shorter.body.error.code).toBe("EXPIRES_AT_NOT_EXTENDED");

    const current = before.match(/expires_at: "([^"]+)"/)?.[1];
    const equal = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: current })
      .expect(400);
    expect(equal.body.error.code).toBe("EXPIRES_AT_NOT_EXTENDED");
    expect(await yamlNow()).toBe(before);
    await app.close();
  });

  it("SC-15 compares a date-only old expiry at UTC end of day", async () => {
    const day = dateOnlyInDays(10);
    await useYaml(accessYaml(`expires_at: "${day}"`));
    const app = buildServer();
    await app.ready();
    const noon = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: `${day}T12:00:00.000Z` })
      .expect(400);
    expect(noon.body.error.code).toBe("EXPIRES_AT_NOT_EXTENDED");
    await app.close();
  });

  it("SC-16 lets an expired token take a legal future date", async () => {
    await useYaml(accessYaml('expires_at: "2020-01-01T00:00:00.000Z"'));
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(20) })
      .expect(200);
    expect(res.body.data.runtimeAck).toBe(true);
    await app.close();
  });

  it("SC-17 sets the first finite expiry from absent and permanent aliases", async () => {
    for (const line of ["expires_at:", 'expires_at: ""', 'expires_at: "permanent"', "expires_at: null"]) {
      await useYaml(accessYaml(line));
      const app = buildServer();
      await app.ready();
      const res = await request(app.server)
        .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
        .send({ expires_at: expiryInDays(15) })
        .expect(200);
      expect(res.body.data.runtimeAck).toBe(true);
      await app.close();
    }
  });

  it("SC-21 returns non-success with the disk expiry when runtime ack fails", async () => {
    vi.spyOn(acl, "evaluateRuntimeAck").mockReturnValueOnce(false);
    const app = buildServer();
    await app.ready();
    const next = expiryInDays(200);
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: next });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.detail.runtimeAck).toBe(false);
    expect(res.body.error.detail.expires_at).toBeTruthy();
    expect(await yamlNow()).toContain("expires_at");
    await app.close();
  });

  it("SC-22 repair of the same expiry after ack failure writes token_renew and acks", async () => {
    vi.spyOn(acl, "evaluateRuntimeAck").mockReturnValueOnce(false);
    const app = buildServer();
    await app.ready();
    const next = expiryInDays(220);
    const failed = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: next });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    const diskExpiry = failed.body.error.detail.expires_at as string;
    auditControl.record.mockClear();
    const repaired = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: diskExpiry, repair: true })
      .expect(200);
    expect(repaired.body.data.runtimeAck).toBe(true);
    expect(repaired.body.data.repair).toBe(true);
    const call = renewCalls().find((entry) => entry.changeType === "token_renew");
    expect(call?.newSummary?.repair).toBe(true);
    await app.close();
  });

  it("SC-23 does not report success when the audited write throws before the file changes", async () => {
    const before = await yamlNow();
    auditControl.record.mockRejectedValueOnce(new Error("audit intent failed"));
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(140) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.data?.runtimeAck).not.toBe(true);
    expect(await yamlNow()).toBe(before);
    await app.close();
  });

  it("SC-24 refuses success while the new expiry has no renew audit, then repair can commit one", async () => {
    const target = expiryInDays(250);
    const normalized = await (async () => {
      const app = buildServer();
      await app.ready();
      const probe = await request(app.server)
        .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
        .send({ expires_at: target })
        .expect(200);
      await app.close();
      return probe.body.data.expires_at as string;
    })();
    auditControl.record.mockClear();
    await useYaml(accessYaml(`expires_at: "${normalized}"`));

    const ordinary = buildServer();
    await ordinary.ready();
    const notRepair = await request(ordinary.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: normalized })
      .expect(400);
    expect(notRepair.body.error.code).toBe("EXPIRES_AT_NOT_EXTENDED");
    expect(renewCalls().some((call) => call.changeType === "token_renew")).toBe(false);
    await ordinary.close();

    auditControl.record.mockRejectedValueOnce(new Error("terminal audit missing"));
    const broken = buildServer();
    await broken.ready();
    const failedRepair = await request(broken.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: normalized, repair: true });
    expect(failedRepair.status).toBeGreaterThanOrEqual(400);
    expect(failedRepair.body.ok).toBe(false);
    expect(await yamlNow()).toContain(normalized);
    await broken.close();

    auditControl.record.mockReset();
    auditControl.record.mockResolvedValue(1);
    const repaired = buildServer();
    await repaired.ready();
    const ok = await request(repaired.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: normalized, repair: true })
      .expect(200);
    expect(ok.body.data.runtimeAck).toBe(true);
    const call = renewCalls().find((entry) => entry.changeType === "token_renew");
    expect(call?.newSummary?.repair).toBe(true);
    if (!call) throw new Error("ack-only repair must not count as success");
    await repaired.close();
  });
});
