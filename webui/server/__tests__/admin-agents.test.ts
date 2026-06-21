import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";

// Mock audit db so tests don't need a real sqlite
vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  recordConfigChange: vi.fn(async () => 1),
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
  projectRoot = await makeProject();
  prevRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
});

afterEach(async () => {
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  await rm(projectRoot, { recursive: true, force: true });
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
