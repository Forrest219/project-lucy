import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";

const revokedRows: Array<{ token_hash: string; revoked_at: string; reason: string }> = [];

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn((sql: string) => {
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
