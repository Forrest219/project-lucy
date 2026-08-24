import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../proxy/identity";

const ACCESS_YAML = `roles:
  ok_role:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
      tools: [lucy_query, wiki_search]
users:
  - id: ok_agent
    name: OK
    enabled: true
    role: ok_role
    tokens: []
defaults:
  deny_tools: []
`;

const FIN_SCHEMA = `tables:
  fin_ledger:
    table: fin.fin_ledger
`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "i6", tokenHashPrefix: "i6" };
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-i6-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"), FIN_SCHEMA, "utf8");
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("WP-I6 audit + policy-runtime", () => {
  it("writeLog persists policy_version and capability_digest on access_log + snapshots", async () => {
    vi.resetModules();
    const acl = await import("../proxy/acl");
    const audit = await import("../proxy/audit");
    await acl.commitEffectivePolicy();
    const snap = await acl.permissionSnapshot(identity("ok_agent"));
    expect(snap?.policyVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(snap?.capabilityDigest).toBeTruthy();

    const id = await audit.writeLog({
      ts: new Date().toISOString(),
      userId: "ok_agent",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 1,
      requestId: "req-i6-1",
      decisionReason: "allowed",
      policyVersion: snap!.policyVersion,
      capabilityDigest: snap!.capabilityDigest,
      roleIds: snap!.roleIds,
      permissionSnapshotHash: snap!.hash,
      permissionSnapshot: {
        hash: snap!.hash,
        rolesJson: snap!.rolesJson,
        resolvedJson: snap!.resolvedJson,
        capabilityDigest: snap!.capabilityDigest,
        toolClassificationVersion: snap!.toolClassificationVersion
      }
    });
    expect(id).toBeGreaterThan(0);

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.LUCY_AUDIT_DB!);
    const row = db.prepare("SELECT policy_version, capability_digest FROM access_log WHERE id = ?").get(id) as {
      policy_version: string;
      capability_digest: string;
    };
    expect(row.policy_version).toBe(snap!.policyVersion);
    expect(row.capability_digest).toBe(snap!.capabilityDigest);
    const snapRow = db.prepare(
      "SELECT capability_digest, tool_classification_version FROM permission_snapshots WHERE hash = ?"
    ).get(snap!.hash) as { capability_digest: string; tool_classification_version: string };
    expect(snapRow.capability_digest).toBe(snap!.capabilityDigest);
    expect(snapRow.tool_classification_version).toBe(acl.TOOL_CLASSIFICATION_VERSION);
    db.close();
  });

  it("GET /api/admin/policy-runtime reports healthy after commit", async () => {
    vi.resetModules();
    const acl = await import("../proxy/acl");
    await acl.commitEffectivePolicy();
    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/admin/policy-runtime" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; data: { healthy: boolean; policyVersion: string } };
    expect(body.ok).toBe(true);
    expect(body.data.healthy).toBe(true);
    expect(body.data.policyVersion).toBe(acl.getPolicyRuntimeStatus().policyVersion);
    await app.close();
  });

  it("P1-1: /api/health is degraded when EffectivePolicy is uninitialized", async () => {
    vi.resetModules();
    const acl = await import("../proxy/acl");
    acl.resetEffectivePolicyForTests();
    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      data: { status: string; policy: { healthy: boolean; policyVersion: string } };
    };
    expect(body.data.status).toBe("degraded");
    expect(body.data.policy.healthy).toBe(false);
    expect(body.data.policy.policyVersion).toBe("");
    await app.close();
  });

  it("P1-3: compile-failed deny audit still stamps policy_version", async () => {
    vi.resetModules();
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      `roles:
  bad_role:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          prefix: fin_
          row_access: all
      tools: [lucy_query]
users:
  - id: bad_agent
    name: Bad
    enabled: true
    role: bad_role
    tokens: []
defaults:
  deny_tools: []
`,
      "utf8"
    );

    const acl = await import("../proxy/acl");
    const audit = await import("../proxy/audit");
    const status = await acl.commitEffectivePolicy();
    expect(status.degradedAgents).toContain("bad_agent");
    expect(status.policyVersion).toMatch(/^[a-f0-9]{64}$/);

    const snap = await acl.permissionSnapshot(identity("bad_agent"));
    expect(snap).toBeUndefined();

    // Mimic mcp-proxy auditMeta fallback: policyVersion from runtime, no digest.
    const id = await audit.writeLog({
      ts: new Date().toISOString(),
      userId: "bad_agent",
      tool: "lucy_query",
      outcome: "denied",
      durationMs: 1,
      requestId: "req-i6-deny",
      decisionReason: "role_resolution_failed:bad_role:v2_prefix_forbidden",
      policyVersion: status.policyVersion
    });
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.LUCY_AUDIT_DB!);
    const row = db.prepare("SELECT policy_version, capability_digest, decision_reason FROM access_log WHERE id = ?").get(id) as {
      policy_version: string;
      capability_digest: string | null;
      decision_reason: string;
    };
    expect(row.policy_version).toBe(status.policyVersion);
    expect(row.capability_digest).toBeNull();
    expect(row.decision_reason).toContain("role_resolution_failed");
    db.close();
  });
});
