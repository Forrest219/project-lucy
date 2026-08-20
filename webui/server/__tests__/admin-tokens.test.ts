import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";

const revokedRows: Array<{ token_hash: string; revoked_at: string; reason: string }> = [];
const traceWriteFailure = vi.hoisted(() => ({ enabled: false }));

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn((sql: string) => {
      if (traceWriteFailure.enabled && sql.includes("INSERT INTO trace_events")) {
        throw new Error("trace write unavailable");
      }
      if (sql.includes("INSERT OR REPLACE INTO revoked_tokens")) {
        return {
          run: vi.fn((hash: string, revokedAt: string, reason: string) => {
            revokedRows.push({ token_hash: hash, revoked_at: revokedAt, reason });
          })
        };
      }
      return { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() };
    }),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => undefined),
  registerAuditRoutes: vi.fn()
}));

const ACCESS_YAML = `users:
  - id: zhangsan
    name: 张三
    enabled: true
    tokens:
      - hash: "sha256:aaaa0000"
        label: hermes-laptop
        created: 2026-06-18
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - sl_query
defaults:
  deny_tools:
    - sql_execution
`;

let projectRoot: string;
let prevRoot: string | undefined;

async function makeProject(yamlContent = ACCESS_YAML) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-admin-tokens-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), yamlContent, "utf8");
  return root;
}

beforeEach(async () => {
  projectRoot = await makeProject();
  prevRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  revokedRows.length = 0;
  traceWriteFailure.enabled = false;
});

afterEach(async () => {
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("POST /api/admin/agents/:userId/tokens", () => {
  it("generates a 64-char hex token (32 random bytes)", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "cursor-test" })
      .expect(200);

    expect(res.body.ok).toBe(true);
    const { token, hash, label } = res.body.data;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(label).toBe("cursor-test");
    await app.close();
  });

  it("stores device_name when explicitly provided", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "cursor-desk", device_name: "xingchen-mbp" })
      .expect(200);

    expect(res.body.data.device_name).toBe("xingchen-mbp");
    const yamlContent = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yamlContent).toContain("device_name: xingchen-mbp");
    expect(yamlContent).toContain("label: cursor-desk");
    await app.close();
  });

  it("omits device_name from yaml when not provided", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "hermes-only" })
      .expect(200);

    expect(res.body.data.device_name).toBeNull();
    const yamlContent = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yamlContent).toContain("label: hermes-only");
    expect(yamlContent).not.toContain("device_name");
    await app.close();
  });

  it("does not write plaintext token to yaml", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "cursor-test" })
      .expect(200);

    const plainToken = res.body.data.token as string;
    const yamlContent = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yamlContent).not.toContain(plainToken);
    // but hash should be present
    expect(yamlContent).toContain("sha256:");
    await app.close();
  });

  it("rejects duplicate label for same user", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "hermes-laptop" })
      .expect(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("TOKEN_LABEL_TAKEN");
    await app.close();
  });

  it("returns 404 for non-existent user", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/nobody/tokens")
      .send({ label: "x" })
      .expect(404);
    expect(res.body.error.code).toBe("AGENT_NOT_FOUND");
    await app.close();
  });
});

describe("DELETE /api/admin/agents/:userId/tokens/:label", () => {
  it("removes token from yaml and writes to revoked_tokens", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .delete("/api/admin/agents/zhangsan/tokens/hermes-laptop")
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.data.written).toBe(true);
    expect(res.body.data.revokedAt).toBeTruthy();

    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).not.toContain("hermes-laptop");

    // Verify revoked_tokens was written
    expect(revokedRows).toHaveLength(1);
    expect(revokedRows[0].token_hash).toBe("sha256:aaaa0000");
    expect(revokedRows[0].reason).toBe("manual_revoke");
    await app.close();
  });

  it("returns 404 for non-existent token label", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .delete("/api/admin/agents/zhangsan/tokens/not-a-label")
      .expect(404);
    expect(res.body.error.code).toBe("TOKEN_NOT_FOUND");
    await app.close();
  });
});

describe("Access Governance Gate — Token endpoints", () => {
  it("POST token dryRun returns gate decision without generating or writing token", async () => {
    const app = buildServer();
    await app.ready();
    const beforeYaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ dryRun: true, label: "preview-only" })
      .expect(200);

    expect(res.body.data.dryRun).toBe(true);
    expect(res.body.data.gate).toBeDefined();
    expect(res.body.data.gate.targetKind).toBe("token");
    expect(res.body.data.proposed).toMatchObject({ userId: "zhangsan", label: "preview-only" });
    expect(res.body.data.token).toBeUndefined();

    const afterYaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(afterYaml).toBe(beforeYaml);
    expect(afterYaml).not.toContain("preview-only");
    await app.close();
  });

  it("POST token create returns gate decision in payload", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "new-laptop" })
      .expect(200);
    expect(res.body.data.gate).toBeDefined();
    expect(res.body.data.gate.targetKind).toBe("token");
    expect(res.body.data.gate.targetId).toContain("zhangsan:new-laptop");
    await app.close();
  });

  it("POST token create logs trace failures without blocking the durable write", async () => {
    traceWriteFailure.enabled = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "trace-failure-still-writes" })
      .expect(200);

    expect(res.body.data.gate).toBeDefined();
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("trace-failure-still-writes");
    expect(errorSpy).toHaveBeenCalledWith(
      "[lucy-admin] failed to write access governance gate trace",
      expect.objectContaining({
        targetKind: "token",
        targetId: "zhangsan:trace-failure-still-writes",
        error: "trace write unavailable"
      })
    );
    errorSpy.mockRestore();
    await app.close();
  });

  it("DELETE token returns gate decision in payload", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .delete("/api/admin/agents/zhangsan/tokens/hermes-laptop")
      .expect(200);
    expect(res.body.data.gate).toBeDefined();
    expect(res.body.data.gate.targetKind).toBe("token");
    await app.close();
  });
});
