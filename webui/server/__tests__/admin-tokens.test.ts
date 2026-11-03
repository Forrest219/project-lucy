import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeNewTokenExpiry, presetExpiryDateString } from "../admin/token-expiry-policy.js";
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
            return { lastInsertRowid: revokedRows.length };
          })
        };
      }
      if (sql.includes("SELECT 1 AS hit FROM revoked_tokens WHERE token_hash")) {
        return {
          get: vi.fn((hash: string) =>
            revokedRows.some((row) => row.token_hash === hash) ? { hit: 1 } : undefined
          )
        };
      }
      return {
        get: vi.fn(() => undefined),
        all: vi.fn(() => []),
        run: vi.fn(() => ({ lastInsertRowid: 1 }))
      };
    }),
    exec: vi.fn(),
    pragma: vi.fn(),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn)
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => undefined),
  registerAgentAuditRoutes: vi.fn(),
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

function expiryInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

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
  process.env.LUCY_CONTENT_ROOT = ".";
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
      .send({ label: "cursor-test", expires_at: expiryInDays(30) })
      .expect(200);

    expect(res.body.ok).toBe(true);
    const { token, hash, label, token_hint: tokenHint } = res.body.data;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(tokenHint).toBe(`${token.slice(0, 6)}…${token.slice(-4)}`);
    expect(label).toBe("cursor-test");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers.pragma).toBe("no-cache");
    expect(res.headers.expires).toBe("0");
    expect(res.body.data.policyRuntimeAck).toBe(true);
    expect(res.body.data.runtimeAck).toBe(res.body.data.policyRuntimeAck);
    await app.close();
  });

  it("stores device_name when explicitly provided", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "cursor-desk", device_name: "xingchen-mbp", expires_at: expiryInDays(30) })
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
      .send({ label: "hermes-only", expires_at: expiryInDays(30) })
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
      .send({ label: "cursor-test", expires_at: expiryInDays(30) })
      .expect(200);

    const plainToken = res.body.data.token as string;
    const tokenHint = res.body.data.token_hint as string;
    const yamlContent = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yamlContent).not.toContain(plainToken);
    // but hash and fixed display hint should be present
    expect(yamlContent).toContain("sha256:");
    expect(yamlContent).toContain(`token_hint: ${tokenHint}`);
    expect(tokenHint).toBe(`${plainToken.slice(0, 6)}…${plainToken.slice(-4)}`);
    await app.close();
  });

  it("rejects duplicate label for same user", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "hermes-laptop", expires_at: expiryInDays(30) })
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
      .send({ label: "x", expires_at: expiryInDays(30) })
      .expect(404);
    expect(res.body.error.code).toBe("AGENT_NOT_FOUND");
    await app.close();
  });

  it("serializes concurrent creates so both tokens land in yaml", async () => {
    const app = buildServer();
    await app.ready();
    const [resA, resB] = await Promise.all([
      request(app.server).post("/api/admin/agents/zhangsan/tokens").send({ label: "concurrent-a", expires_at: expiryInDays(30) }),
      request(app.server).post("/api/admin/agents/zhangsan/tokens").send({ label: "concurrent-b", expires_at: expiryInDays(30) })
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.body.ok).toBe(true);
    expect(resB.body.ok).toBe(true);

    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("label: concurrent-a");
    expect(yaml).toContain("label: concurrent-b");
    expect(yaml).toContain("label: hermes-laptop");
    await app.close();
  });

  it("requires a future expiry no more than 365 calendar days away", async () => {
    const app = buildServer();
    await app.ready();

    const missing = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "missing-expiry" })
      .expect(400);
    expect(missing.body.error.code).toBe("EXPIRES_AT_REQUIRED");

    const past = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "past-expiry", expires_at: "2020-01-01T00:00:00.000Z" })
      .expect(400);
    expect(past.body.error.code).toBe("EXPIRES_AT_INVALID");

    const tooFar = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "too-far", expires_at: expiryInDays(366) })
      .expect(400);
    expect(tooFar.body.error.code).toBe("EXPIRES_AT_TOO_FAR");

    await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "max-boundary", expires_at: expiryInDays(365) })
      .expect(200);
    await app.close();
  });

  it("serializes a create with a revoke without losing unrelated tokens", async () => {
    const app = buildServer();
    await app.ready();
    const [created, revoked] = await Promise.all([
      request(app.server)
        .post("/api/admin/agents/zhangsan/tokens")
        .send({ label: "concurrent-create", expires_at: expiryInDays(30) }),
      request(app.server).delete("/api/admin/agents/zhangsan/tokens/hermes-laptop")
    ]);

    expect(created.status).toBe(200);
    expect(revoked.status).toBe(200);
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("label: concurrent-create");
    expect(yaml).not.toContain("label: hermes-laptop");
    expect(yaml).not.toContain(created.body.data.token);
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
    expect(res.body.data.policyRuntimeAck).toBe(true);
    expect(res.body.data.runtimeAck).toBe(res.body.data.policyRuntimeAck);

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

  it("serializes concurrent revokes so both tokens are removed", async () => {
    const twoTokensYaml = `users:
  - id: zhangsan
    name: 张三
    enabled: true
    tokens:
      - hash: "sha256:aaaa0000"
        label: hermes-laptop
        created: 2026-06-18
      - hash: "sha256:bbbb0000"
        label: cursor-desk
        created: 2026-06-19
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - sl_query
defaults:
  deny_tools:
    - sql_execution
`;
    await writeFile(path.join(projectRoot, "webui/config/access.yaml"), twoTokensYaml, "utf8");

    const app = buildServer();
    await app.ready();
    const [resA, resB] = await Promise.all([
      request(app.server).delete("/api/admin/agents/zhangsan/tokens/hermes-laptop"),
      request(app.server).delete("/api/admin/agents/zhangsan/tokens/cursor-desk")
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.body.ok).toBe(true);
    expect(resB.body.ok).toBe(true);

    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).not.toContain("hermes-laptop");
    expect(yaml).not.toContain("cursor-desk");
    expect(revokedRows).toHaveLength(2);
    expect(revokedRows.map((r) => r.token_hash).sort()).toEqual(["sha256:aaaa0000", "sha256:bbbb0000"]);
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
      .send({ dryRun: true, label: "preview-only", expires_at: expiryInDays(30) })
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
      .send({ label: "new-laptop", expires_at: expiryInDays(30) })
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
      .send({ label: "trace-failure-still-writes", expires_at: expiryInDays(30) })
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

describe("POST /api/admin/agents/:userId/tokens/:label/renew", () => {
  it("extends expires_at without rotating hash or returning plaintext", async () => {
    const withExpiry = `users:
  - id: zhangsan
    name: 张三
    enabled: true
    tokens:
      - hash: "sha256:aaaa0000"
        label: hermes-laptop
        created: 2026-06-18
        token_hint: a1b2c3…9f0e
        expires_at: "${expiryInDays(30)}"
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - sl_query
defaults:
  deny_tools:
    - sql_execution
`;
    await writeFile(path.join(projectRoot, "webui/config/access.yaml"), withExpiry, "utf8");

    const app = buildServer();
    await app.ready();
    const next = expiryInDays(180);
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: next })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.data.token).toBeUndefined();
    expect(res.body.data.label).toBe("hermes-laptop");
    expect(res.body.data.expires_at).toBeTruthy();
    expect(res.body.data.runtimeAck).toBe(true);
    expect(res.body.data.gate).toBeDefined();

    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("sha256:aaaa0000");
    expect(yaml).toContain("label: hermes-laptop");
    expect(yaml).toContain("token_hint: a1b2c3…9f0e");
    expect(yaml).toContain("expires_at:");
    await app.close();
  });

  it("rejects shortening a still-valid expiry", async () => {
    const withExpiry = `users:
  - id: zhangsan
    name: 张三
    enabled: true
    tokens:
      - hash: "sha256:aaaa0000"
        label: hermes-laptop
        created: 2026-06-18
        expires_at: "${expiryInDays(180)}"
    allow:
      tables: []
      tools: []
defaults:
  deny_tools: []
`;
    await writeFile(path.join(projectRoot, "webui/config/access.yaml"), withExpiry, "utf8");
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(30) })
      .expect(400);
    expect(res.body.error.code).toBe("EXPIRES_AT_NOT_EXTENDED");
    await app.close();
  });

  it("allows renewing an expired token still present in YAML", async () => {
    const expiredYaml = `users:
  - id: zhangsan
    name: 张三
    enabled: true
    tokens:
      - hash: "sha256:aaaa0000"
        label: hermes-laptop
        created: 2026-06-18
        expires_at: "2020-01-01T00:00:00.000Z"
    allow:
      tables: []
      tools: []
defaults:
  deny_tools: []
`;
    await writeFile(path.join(projectRoot, "webui/config/access.yaml"), expiredYaml, "utf8");
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(90) })
      .expect(200);
    expect(res.body.data.runtimeAck).toBe(true);
    await app.close();
  });

  it("rejects renew when hash is in revoked_tokens even if YAML residual remains", async () => {
    revokedRows.push({
      token_hash: "sha256:aaaa0000",
      revoked_at: new Date().toISOString(),
      reason: "manual_revoke"
    });
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: expiryInDays(90) })
      .expect(409);
    expect(res.body.error.code).toBe("TOKEN_REVOKED_NOT_RENEWABLE");
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).toContain("hermes-laptop");
    await app.close();
  });

  it("dryRun does not mutate YAML", async () => {
    const before = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ dryRun: true, expires_at: expiryInDays(90) })
      .expect(200);
    expect(res.body.data.dryRun).toBe(true);
    expect(res.body.data.gate).toBeDefined();
    expect(res.body.data.token).toBeUndefined();
    const after = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(after).toBe(before);
    await app.close();
  });

  it("allows same-expiry repair renew after a prior write", async () => {
    const withExpiry = `users:
  - id: zhangsan
    name: 张三
    enabled: true
    tokens:
      - hash: "sha256:aaaa0000"
        label: hermes-laptop
        created: 2026-06-18
        expires_at: "${expiryInDays(120)}"
    allow:
      tables: []
      tools: []
defaults:
  deny_tools: []
`;
    await writeFile(path.join(projectRoot, "webui/config/access.yaml"), withExpiry, "utf8");
    const app = buildServer();
    await app.ready();
    const target = expiryInDays(200);
    await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: target })
      .expect(200);
    const repair = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens/hermes-laptop/renew")
      .send({ expires_at: target, repair: true })
      .expect(200);
    expect(repair.body.data.repair).toBe(true);
    expect(repair.body.data.token).toBeUndefined();
    await app.close();
  });
});

describe("GET /api/admin/tokens", () => {
  it("returns aggregated tokens across agents with stats", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/admin/tokens")
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.data.tokens).toHaveLength(1);
    const token = res.body.data.tokens[0];
    expect(token.label).toBe("hermes-laptop");
    expect(token.agent.id).toBe("zhangsan");
    expect(token.agent.name).toBe("张三");
    expect(token.status).toBe("available");
    // Fixture has no token_hint — must not fabricate from hash.
    expect(token.tokenHint).toBeNull();
    expect(token.hashPrefix).toMatch(/^sha256:/);
    expect(res.body.data.stats).toEqual({
      totalTokens: 1,
      availableTokens: 1,
      activeLast7dTokens: 0,
      expiringSoonTokens: 0,
      expiredTokens: 0
    });
    await app.close();
  });

  it("returns tokenHint for newly created tokens and keeps hashPrefix for audit", async () => {
    const app = buildServer();
    await app.ready();
    const created = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "hint-list-check", expires_at: expiryInDays(30) })
      .expect(200);
    const plain = created.body.data.token as string;
    const expectedHint = `${plain.slice(0, 6)}…${plain.slice(-4)}`;

    const res = await request(app.server).get("/api/admin/tokens").expect(200);
    const row = res.body.data.tokens.find((t: { label: string }) => t.label === "hint-list-check");
    expect(row).toBeTruthy();
    expect(row.tokenHint).toBe(expectedHint);
    expect(row.hashPrefix).toMatch(/^sha256:/);
    await app.close();
  });

  it("filters tokens by search query", async () => {
    const app = buildServer();
    await app.ready();
    const resMatch = await request(app.server)
      .get("/api/admin/tokens?search=hermes")
      .expect(200);
    expect(resMatch.body.data.tokens).toHaveLength(1);

    const resNone = await request(app.server)
      .get("/api/admin/tokens?search=nonexistent")
      .expect(200);
    expect(resNone.body.data.tokens).toHaveLength(0);
    await app.close();
  });
});

describe("token issue discoverability", () => {
  const t0 = Date.parse("2026-06-15T08:00:00.000Z");
  let dateNow: ReturnType<typeof vi.spyOn> | undefined;
  const previousMcp = process.env.LUCY_PUBLIC_MCP_URL;

  function expectedPreset(days: number): string {
    return normalizeNewTokenExpiry(presetExpiryDateString(days, t0), t0);
  }

  beforeEach(() => {
    dateNow = vi.spyOn(Date, "now").mockReturnValue(t0);
  });

  afterEach(() => {
    dateNow?.mockRestore();
    if (previousMcp === undefined) delete process.env.LUCY_PUBLIC_MCP_URL;
    else process.env.LUCY_PUBLIC_MCP_URL = previousMcp;
  });

  it("SC-07 duplicate label returns a non-sensitive existingToken", async () => {
    const app = buildServer();
    await app.ready();
    const created = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "taken-label", expires_in: "30d" })
      .expect(200);
    const plain = created.body.data.token as string;
    const again = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "taken-label", expires_in: "30d" })
      .expect(409);
    expect(again.body.error.code).toBe("TOKEN_LABEL_TAKEN");
    const existing = again.body.error.detail.existingToken;
    expect(existing.label).toBe("taken-label");
    expect(existing.created).toBeTruthy();
    expect(existing.expires_at).toBe(expectedPreset(30));
    expect(existing.status).toBe("available");
    expect(existing.tokenHint).toBe(created.body.data.token_hint);
    expect(existing.hashPrefix).toMatch(/^sha256:/);
    expect(existing.token).toBeUndefined();
    expect(existing.hash).toBeUndefined();
    expect(JSON.stringify(again.body)).not.toContain(plain);
    const listed = await request(app.server).get("/api/admin/tokens").expect(200);
    const row = listed.body.data.tokens.find((token: { label: string }) => token.label === "taken-label");
    expect(row.label).toBe(existing.label);
    expect(row.created).toBe(existing.created);
    expect(row.expires_at).toBe(existing.expires_at);
    expect(row.status).toBe(existing.status);
    expect(row.tokenHint).toBe(existing.tokenHint);
    expect(row.hashPrefix).toBe(existing.hashPrefix);
    await app.close();
  });

  it("SC-11 expires_in 365d matches the fixed t0 preset", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "year-token", expires_in: "365d" })
      .expect(200);
    expect(res.body.data.expires_at).toBe(expectedPreset(365));
    await app.close();
  });

  it("SC-12 accepts equal expiry fields and rejects a conflict", async () => {
    const app = buildServer();
    await app.ready();
    const equal = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "equal-expiry", expires_in: "365d", expires_at: expectedPreset(365) })
      .expect(200);
    expect(equal.body.data.expires_at).toBe(expectedPreset(365));
    const conflict = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "conflict-expiry", expires_in: "30d", expires_at: expectedPreset(365) })
      .expect(400);
    expect(conflict.body.error.code).toBe("EXPIRES_CONFLICT");
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).not.toContain("conflict-expiry");
    await app.close();
  });

  it("SC-13 rejects expires_in 7d", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "week-token", expires_in: "7d" })
      .expect(400);
    expect(res.body.error.code).toBe("EXPIRES_IN_INVALID");
    await app.close();
  });

  it("SC-14 gates clientConfigs on a configured MCP endpoint", async () => {
    const app = buildServer();
    await app.ready();
    const before = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");

    delete process.env.LUCY_PUBLIC_MCP_URL;
    const fallback = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "fallback-token", expires_in: "30d", includeClientConfigs: true })
      .expect(503);
    expect(fallback.body.error.code).toBe("MCP_ENDPOINT_UNAVAILABLE");
    expect(fallback.body.data?.token).toBeUndefined();
    expect(fallback.body.data?.clientConfigs).toBeUndefined();

    process.env.LUCY_PUBLIC_MCP_URL = "not-a-url";
    const invalid = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "invalid-token", expires_in: "30d", includeClientConfigs: true })
      .expect(503);
    expect(invalid.body.error.code).toBe("MCP_ENDPOINT_UNAVAILABLE");

    process.env.LUCY_PUBLIC_MCP_URL = "ftp://lucy.example.com/mcp";
    const ftp = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "ftp-token", expires_in: "30d", includeClientConfigs: true })
      .expect(503);
    expect(ftp.body.error.code).toBe("MCP_ENDPOINT_UNAVAILABLE");
    expect(await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8")).toBe(before);

    process.env.LUCY_PUBLIC_MCP_URL = "https://lucy.example.com/agent";
    const recommended = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "path-token", expires_in: "30d", includeClientConfigs: true })
      .expect(200);
    expect(recommended.body.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(recommended.body.data.clientConfigs).sort()).toEqual(["claude_code", "codex", "cursor", "json"]);

    process.env.LUCY_PUBLIC_MCP_URL = "https://lucy.example.com/mcp";
    const issued = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "config-token", expires_in: "30d", includeClientConfigs: true })
      .expect(200);
    const plain = issued.body.data.token as string;
    const configs = issued.body.data.clientConfigs;
    expect(Object.keys(configs).sort()).toEqual(["claude_code", "codex", "cursor", "json"]);
    const cursor = JSON.parse(configs.cursor.snippet);
    const generic = JSON.parse(configs.json.snippet);
    expect(JSON.stringify(cursor)).toContain("https://lucy.example.com/mcp");
    expect(JSON.stringify(cursor)).toContain(plain);
    expect(JSON.stringify(generic)).toContain(plain);
    expect(configs.claude_code.snippet).toContain("https://lucy.example.com/mcp");
    expect(configs.codex.snippet).toContain("https://lucy.example.com/mcp");
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).not.toContain(plain);
    expect(yaml).not.toContain(recommended.body.data.token);
    await app.close();
  });

  it("SC-15 omits clientConfigs unless includeClientConfigs is true", async () => {
    process.env.LUCY_PUBLIC_MCP_URL = "https://lucy.example.com/mcp";
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "no-fragment", expires_in: "30d" })
      .expect(200);
    expect(res.body.data).not.toHaveProperty("clientConfigs");
    await app.close();
  });

  it("SC-19 dryRun shares resolve_expiry and skips mint plus endpoint failures", async () => {
    delete process.env.LUCY_PUBLIC_MCP_URL;
    const app = buildServer();
    await app.ready();
    const before = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    const preview = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ dryRun: true, label: "preview-year", expires_in: "365d", includeClientConfigs: true })
      .expect(200);
    expect(preview.body.data.dryRun).toBe(true);
    expect(preview.body.data.proposed.expires_at).toBe(expectedPreset(365));
    expect(preview.body.data.token).toBeUndefined();
    expect(preview.body.data).not.toHaveProperty("clientConfigs");
    expect(await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8")).toBe(before);

    const invalid = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ dryRun: true, label: "preview-bad", expires_in: "7d", includeClientConfigs: true })
      .expect(400);
    expect(invalid.body.error.code).toBe("EXPIRES_IN_INVALID");

    const conflict = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({
        dryRun: true,
        label: "preview-conflict",
        expires_in: "30d",
        expires_at: expectedPreset(365),
        includeClientConfigs: true
      })
      .expect(400);
    expect(conflict.body.error.code).toBe("EXPIRES_CONFLICT");
    expect(await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8")).toBe(before);

    const issued = await request(app.server)
      .post("/api/admin/agents/zhangsan/tokens")
      .send({ label: "real-year", expires_in: "90d" })
      .expect(200);
    expect(issued.body.data.expires_at).toBe(expectedPreset(90));
    await app.close();
  });
});
