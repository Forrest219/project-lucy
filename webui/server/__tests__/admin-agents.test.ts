import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";

const auditRows = vi.hoisted(() => [] as Array<{
  user_id: string;
  token_hash_prefix: string;
  ts: string;
  tool: string;
  outcome: string;
}>);

const KX_TEMPLATE_NAMES = [
  "kx_dim_company",
  "kx_dim_financial_item",
  "kx_fact_financial_amount",
  "kx_vw_balance_sheet_detail",
  "kx_vw_cash_flow_statement_detail",
  "kx_vw_income_statement_detail"
];

// Mock audit db so tests don't need a real sqlite
vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn((sql: string) => {
      if (sql.includes("ROW_NUMBER() OVER")) {
        return {
          all: vi.fn((...userIds: string[]) => auditRows
            .filter((row) => userIds.includes(row.user_id))
            .sort((a, b) => b.ts.localeCompare(a.ts)))
        };
      }
      // M55: active-token SQL is COUNT(DISTINCT token_hash_prefix)
      // restricted to the last 7 days for the supplied user_id. The mock
      // exercises the same shape so we can assert the helper emits
      // distinct-token counts (not raw row counts).
      if (sql.includes("COUNT(DISTINCT token_hash_prefix)")) {
        const CUTOFF = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return {
          get: vi.fn((userId: string) => {
            const seen = new Set<string>();
            for (const row of auditRows) {
              if (row.user_id !== userId) continue;
              if (!row.token_hash_prefix) continue;
              if (new Date(row.ts).getTime() < CUTOFF) continue;
              seen.add(row.token_hash_prefix);
            }
            return { active_tokens: seen.size };
          })
        };
      }
      if (sql.includes("COUNT(*) AS calls7")) {
        const CUTOFF = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return {
          get: vi.fn((userId: string) => {
            const matched = auditRows.filter(
              (row) => row.user_id === userId && new Date(row.ts).getTime() >= CUTOFF
            );
            return {
              calls7: matched.length,
              denied7: matched.filter((row) => row.outcome === "denied").length,
              last_seen: matched
                .map((row) => row.ts)
                .sort()
                .at(-1) ?? null
            };
          })
        };
      }
      return { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn(() => ({ lastInsertRowid: 1 })) };
    }),
    exec: vi.fn(),
    pragma: vi.fn(),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn)
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => undefined),
  registerAuditRoutes: vi.fn()
}));

const ACCESS_YAML = `roles:
  analyst:
    description: Analyst role
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - superstore_orders
      tools:
        - sl_query
users:
  - id: zhangsan
    name: 张三
    enabled: true
    tokens:
      - hash: "sha256:aaaa"
        label: hermes-laptop
        created: 2026-06-18
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - sl_query
  - id: lisi
    name: 李四
    enabled: false
    tokens: []
    allow:
      tables: ["*"]
      tools: ["*"]
defaults:
  deny_tools:
    - sql_execution
`;

let projectRoot: string;
let prevRoot: string | undefined;

async function makeProject(yamlContent = ACCESS_YAML) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-admin-agents-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), yamlContent, "utf8");
  await writeFile(path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), "tables:\n  superstore_orders:\n    table: dataforai.superstore_orders\n", "utf8");
  return root;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
  projectRoot = await makeProject();
  prevRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  auditRows.length = 0;
});

afterEach(async () => {
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  await rm(projectRoot, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("GET /api/admin/agents", () => {
  it("returns agents list", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/agents").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.agents).toHaveLength(2);
    expect(res.body.data.agents[0].id).toBe("zhangsan");
    expect(res.body.data.version).toBeTruthy();
    await app.close();
  });

  it("attaches per-token last-used metadata from access_log", async () => {
    auditRows.push(
      {
        user_id: "zhangsan",
        token_hash_prefix: "sha256:aaaa",
        ts: "2026-06-21T08:00:00.000Z",
        tool: "tools/list",
        outcome: "ok"
      },
      {
        user_id: "zhangsan",
        token_hash_prefix: "sha256:aaaa",
        ts: "2026-06-21T09:00:00.000Z",
        tool: "sl_query",
        outcome: "ok"
      },
      {
        user_id: "zhangsan",
        token_hash_prefix: "sha256:other",
        ts: "2026-06-21T10:00:00.000Z",
        tool: "sl_query",
        outcome: "denied"
      }
    );

    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/agents/zhangsan").expect(200);
    const token = res.body.data.agent.tokens[0];
    expect(token).toMatchObject({
      label: "hermes-laptop",
      last_used: "2026-06-21T09:00:00.000Z",
      last_tool: "sl_query",
      last_outcome: "ok"
    });
    await app.close();
  });

  it("emits activeTokensLast7d as distinct token count in last 7 days", async () => {
    const inside = "2026-08-02T08:00:00.000Z";
    const outside = "2026-07-20T08:00:00.000Z";
    auditRows.push(
      // 同一 token 多次命中，应只计 1 个 active token
      { user_id: "zhangsan", token_hash_prefix: "sha256:aaaa", ts: inside, tool: "sl_query", outcome: "ok" },
      { user_id: "zhangsan", token_hash_prefix: "sha256:aaaa", ts: inside, tool: "sl_query", outcome: "ok" },
      // 第二个 distinct token
      { user_id: "zhangsan", token_hash_prefix: "sha256:bbbb", ts: inside, tool: "sl_query", outcome: "ok" },
      // 超出 7 天窗口，忽略
      { user_id: "zhangsan", token_hash_prefix: "sha256:cccc", ts: outside, tool: "sl_query", outcome: "ok" }
    );

    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/agents/zhangsan").expect(200);
    expect(res.body.data.agent.stats.activeTokensLast7d).toBe(2);
    expect(res.body.data.agent.stats.configuredTokens).toBe(1);
    // 拒绝计数应独立于 active-token 去重：窗口内 3 条记录（aaaa/aaaa/bbbb），全部 ok
    expect(res.body.data.agent.stats.callsLast7d).toBe(3);
    expect(res.body.data.agent.stats.deniedLast7d).toBe(0);
    await app.close();
  });

  it("GET /api/admin/agents surfaces the aggregate summary block", async () => {
    auditRows.push(
      { user_id: "zhangsan", token_hash_prefix: "sha256:aaaa", ts: "2026-08-02T08:00:00.000Z", tool: "sl_query", outcome: "ok" },
      { user_id: "zhangsan", token_hash_prefix: "sha256:aaaa", ts: "2026-08-02T09:00:00.000Z", tool: "sl_query", outcome: "denied" },
      { user_id: "zhangsan", token_hash_prefix: "sha256:bbbb", ts: "2026-08-02T10:00:00.000Z", tool: "sl_query", outcome: "ok" }
    );

    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/agents").expect(200);
    expect(res.body.data.summary).toMatchObject({
      agentCount: 2,
      enabledAgentCount: 1,
      configuredTokenCount: 1,
      // zhangsan 的 3 条记录中 aaaa/bbbb 是 distinct token，所以 2 个活跃 token
      activeTokenCountLast7d: 2,
      callsLast7d: 3,
      deniedLast7d: 1
    });
    await app.close();
  });

  it("returns roles and effective permissions", async () => {
    const app = buildServer();
    await app.ready();
    const roles = await request(app.server).get("/api/admin/roles").expect(200);
    expect(roles.body.data.roles[0]).toMatchObject({
      id: "analyst",
      invalid: false,
      sourceCount: 1
    });

    await request(app.server)
      .patch("/api/admin/agents/zhangsan")
      .send({ dryRun: false, patch: { role: "analyst" } })
      .expect(200);

    const effective = await request(app.server).get("/api/admin/agents/zhangsan/effective-permissions").expect(200);
    expect(effective.body.data.roleIds).toEqual(["analyst"]);
    expect(effective.body.data.snapshotHash).toBeTruthy();
    expect(effective.body.data.sourceMapVersion).toBeTruthy();
    expect(effective.body.data.sources).toHaveLength(1);
    await app.close();
  });
});

describe("POST /api/admin/agents", () => {
  it("returns diff on dryRun", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents")
      .send({ dryRun: true, agent: { id: "wangwu", name: "王五", role: "analyst" } })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.diff).toBeTruthy();
    expect(res.body.data.proposedYaml).toContain("wangwu");
    // file unchanged
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).not.toContain("wangwu");
    await app.close();
  });

  it("writes agent when dryRun:false", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents")
      .send({ dryRun: false, agent: { id: "wangwu", name: "王五", role: "analyst" } })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.written).toBe(true);
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("wangwu");
    expect(yaml).toContain("role: analyst");
    expect(yaml).not.toContain("id: wangwu\n    name: 王五\n    enabled: true\n    tokens: []\n    allow:");
    await app.close();
  });

  it("returns 409 AGENT_ID_TAKEN on duplicate id", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents")
      .send({ dryRun: false, agent: { id: "zhangsan", name: "重复", role: "analyst" } })
      .expect(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("AGENT_ID_TAKEN");
    await app.close();
  });

  it("rejects legacy allow on create", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents")
      .send({ dryRun: false, agent: { id: "superuser", name: "超级用户", allow: { tables: ["*"], tools: ["*"] } } })
      .expect(400);
    expect(res.body.error.code).toBe("LEGACY_ALLOW_READONLY");
    await app.close();
  });
});

describe("PATCH /api/admin/agents/:userId", () => {
  it("updates agent name on dryRun:false", async () => {
    const app = buildServer();
    await app.ready();
    // first get version
    const getRes = await request(app.server).get("/api/admin/agents/zhangsan").expect(200);
    const version = getRes.body.data.version;

    const res = await request(app.server)
      .patch("/api/admin/agents/zhangsan")
      .send({ dryRun: false, version, patch: { name: "张三三" } })
      .expect(200);
    expect(res.body.ok).toBe(true);
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("张三三");
    await app.close();
  });

  it("returns 409 VERSION_CONFLICT on stale version", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .patch("/api/admin/agents/zhangsan")
      .send({ dryRun: false, version: "0000000000000-stale", patch: { name: "冲突" } })
      .expect(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("VERSION_CONFLICT");
    await app.close();
  });

  it("returns 404 for non-existent agent", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .patch("/api/admin/agents/notexist")
      .send({ dryRun: false, patch: { name: "X" } })
      .expect(404);
    expect(res.body.error.code).toBe("AGENT_NOT_FOUND");
    await app.close();
  });

  it("rejects patching legacy allow", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .patch("/api/admin/agents/zhangsan")
      .send({ dryRun: false, patch: { allow: { tables: ["*"] } } })
      .expect(400);
    expect(res.body.error.code).toBe("LEGACY_ALLOW_READONLY");
    await app.close();
  });

  it("rejects re-enabling legacy wildcard agent without role", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .patch("/api/admin/agents/lisi")
      .send({ dryRun: false, patch: { enabled: true } })
      .expect(400);
    expect(res.body.error.code).toBe("LEGACY_WILDCARD_AGENT_REQUIRES_ROLE");
    await app.close();
  });

  it("migrates legacy allow away when assigning a role", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .patch("/api/admin/agents/lisi")
      .send({ dryRun: false, patch: { role: "analyst" } })
      .expect(200);
    expect(res.body.ok).toBe(true);
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("roles:");
    expect(yaml).toContain("defaults:");
    expect(yaml).toContain("id: lisi");
    expect(yaml).toContain("role: analyst");
    expect(yaml).not.toContain('tables: ["*"]');
    await app.close();
  });
});

describe("DELETE /api/admin/agents/:userId", () => {
  it("removes agent from yaml", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server).delete("/api/admin/agents/zhangsan").expect(200);
    expect(res.body.ok).toBe(true);
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).not.toContain("zhangsan");
    await app.close();
  });
});

describe("Access Governance Gate — Agent endpoints", () => {
  const KX_FACT = "dataforai.kx_fact_financial_amount";
  const SENSITIVE_PROJECT_YAML = `roles:
  risk_officer:
    description: Sensitive finance role
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - kx_fact_financial_amount
      tools:
        - sl_query
  analyst:
    description: Analyst role
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - superstore_orders
      tools:
        - sl_query
users:
  - id: zhangsan
    name: 张三
    enabled: true
    tokens: []
    role: analyst
defaults:
  deny_tools:
    - sql_execution
`;

  async function makeSensitiveProject() {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = await makeProject(SENSITIVE_PROJECT_YAML);
    // Add the KX table to the schema so resolveEffectivePermissionsForAdmin
    // finds it.
    const schemaPath = path.join(projectRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml");
    await writeFile(
      schemaPath,
      [
        "tables:",
        ...KX_TEMPLATE_NAMES.map((name) => `  ${name}:\n    table: dataforai.${name}`),
        "  superstore_orders:",
        "    table: dataforai.superstore_orders",
        ""
      ].join("\n"),
      "utf8"
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
  }

  it("dryRun returns gate decision with tier summary", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents")
      .send({ dryRun: true, agent: { id: "newagent", name: "新用户", role: "analyst" } })
      .expect(200);
    expect(res.body.data.gate).toBeDefined();
    expect(res.body.data.gate.targetKind).toBe("agent");
    // Creating a new agent bound to a non-sensitive role is a P1 warning
    // (permission expansion into a non-sensitive source). Not a P0 block.
    expect(["allow", "warn"]).toContain(res.body.data.gate.decision);
    expect(res.body.data.gate.tierSummary.P0.count).toBe(0);
    expect(res.body.data.gate.tierSummary.P0.reasons).toEqual([]);
    await app.close();
  });

  it("P0 permission expansion to sensitive KX source is blocked unless override is provided", async () => {
    await makeSensitiveProject();
    const app = buildServer();
    await app.ready();
    // Without override
    const blocked = await request(app.server)
      .post("/api/admin/agents")
      .send({ dryRun: false, agent: { id: "finance_bot", name: "财务机器人", role: "risk_officer" } })
      .expect(409);
    expect(blocked.body.error.code).toBe("GOVERNANCE_GATE_OVERRIDE_REQUIRED");
    expect(blocked.body.error.detail.gate.decision).toBe("override_required");
    expect(blocked.body.error.detail.gate.tierSummary.P0.count).toBeGreaterThan(0);

    // With a single approver
    const singleApprover = await request(app.server)
      .post("/api/admin/agents")
      .send({
        dryRun: false,
        agent: { id: "finance_bot", name: "财务机器人", role: "risk_officer" },
        override: {
          reason: "hotfix",
          approvers: [{ actorKind: "admin", actorId: "local-admin-1", identityProvider: "deployment-local" }],
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          rollbackPlan: "Revert via git"
        }
      })
      .expect(409);
    expect(singleApprover.body.error.code).toBe("GOVERNANCE_GATE_OVERRIDE_REQUIRED");
    expect(singleApprover.body.error.detail.override.code).toBe("OVERRIDE_APPROVERS_INSUFFICIENT");

    // With two distinct approvers
    const ok = await request(app.server)
      .post("/api/admin/agents")
      .send({
        dryRun: false,
        agent: { id: "finance_bot", name: "财务机器人", role: "risk_officer" },
        override: {
          reason: "incident rollback",
          approvers: [
            { actorKind: "admin", actorId: "local-admin-1", identityProvider: "deployment-local" },
            { actorKind: "admin", actorId: "local-admin-2", identityProvider: "deployment-local" }
          ],
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          rollbackPlan: "Revert via git"
        }
      })
      .expect(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.data.gate.decision).toBe("override_required");
    expect(ok.body.data.written).toBe(true);
    await app.close();
  });

  it("P0 permission expansion through built-in KX template is blocked in Agent create and patch dryRun", async () => {
    await makeSensitiveProject();
    const app = buildServer();
    await app.ready();

    const createPreview = await request(app.server)
      .post("/api/admin/agents")
      .send({ dryRun: true, agent: { id: "kx_bot", name: "KX Bot", role: "kx_readonly" } })
      .expect(200);
    expect(createPreview.body.data.gate.decision).toBe("override_required");
    expect(createPreview.body.data.gate.tierSummary.P0.count).toBeGreaterThan(0);
    expect(createPreview.body.data.gate.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "sensitive_source", ref: KX_FACT })
    ]));

    const patchPreview = await request(app.server)
      .patch("/api/admin/agents/zhangsan")
      .send({ dryRun: true, patch: { role: "kx_readonly" } })
      .expect(200);
    expect(patchPreview.body.data.gate.decision).toBe("override_required");
    expect(patchPreview.body.data.gate.tierSummary.P0.count).toBeGreaterThan(0);
    expect(patchPreview.body.data.gate.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "sensitive_source", ref: KX_FACT })
    ]));

    await app.close();
  });

  it("PATCH dryRun surfaces gate decision", async () => {
    await makeSensitiveProject();
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .patch("/api/admin/agents/zhangsan")
      .send({ dryRun: true, patch: { role: "risk_officer" } })
      .expect(200);
    expect(res.body.data.gate).toBeDefined();
    expect(res.body.data.gate.decision).toBe("override_required");
    await app.close();
  });

  it("DELETE includes gate block when prior sensitive sources are removed by an override-required scenario", async () => {
    // Deletion is normally allow; we just assert the gate field is present
    // so the front-end has a stable shape.
    await makeSensitiveProject();
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .delete("/api/admin/agents/zhangsan")
      .expect(200);
    expect(res.body.data.gate).toBeDefined();
    await app.close();
  });
});
