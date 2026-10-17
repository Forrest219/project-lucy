import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import { computeContextPolicyVersion, contextCacheKey, type ContextInventoryEntry } from "../proxy/context-policy";
import type { ContextSnapshot } from "../proxy/context-acl";

/**
 * Spec §4.3/§4.4 — contextPolicyVersion, cache keys, instant narrowing, and Role id
 * retirement / reference checks. Synthetic fixtures only.
 */

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn(() => ({ lastInsertRowid: 1 })) })),
    exec: vi.fn(),
    pragma: vi.fn(),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn)
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => undefined),
  registerAuditRoutes: vi.fn()
}));

const entry = (acl: ContextInventoryEntry["acl"], fileVersion = "v1"): ContextInventoryEntry => ({
  kind: "wiki",
  id: "global/a.md",
  acl,
  fileVersion
});

describe("contextPolicyVersion and cache keys (Spec §2)", () => {
  it("changes when the ACL, file identity or role channel version changes, and is order independent", () => {
    const base = computeContextPolicyVersion([entry({ state: "roles", roles: ["b", "a"] })], "rc1");
    expect(computeContextPolicyVersion([entry({ state: "roles", roles: ["a", "b"] })], "rc1")).toBe(base);
    expect(computeContextPolicyVersion([entry({ state: "roles", roles: ["a"] })], "rc1")).not.toBe(base);
    expect(computeContextPolicyVersion([entry({ state: "roles", roles: ["a", "b"] }, "v2")], "rc1")).not.toBe(base);
    expect(computeContextPolicyVersion([entry({ state: "roles", roles: ["a", "b"] })], "rc2")).not.toBe(base);
    expect(computeContextPolicyVersion([entry({ state: "all" })], "rc1")).not.toBe(base);
  });

  it("cache keys differ by identity generation, role channel version, policy version, ACL version and action", () => {
    const snapshot = (roleChannelVersion: string, policyVersion: string): Extract<ContextSnapshot, { ok: true }> => ({
      ok: true,
      roleIds: ["r"],
      roleChannels: { r: [] },
      roleChannelVersion,
      policyVersion
    });
    const key = (over: Partial<Parameters<typeof contextCacheKey>[0]> = {}) =>
      contextCacheKey({
        identity: { userId: "u", tokenHashPrefix: "sha256:abc" },
        snapshot: snapshot("rc1", "p1"),
        contextPolicyVersion: "ctx-1",
        action: "read",
        kind: "wiki",
        ...over
      });
    const base = key();
    expect(key()).toBe(base);
    for (const changed of [
      key({ identity: { userId: "u", tokenHashPrefix: "sha256:def" } }),
      key({ snapshot: snapshot("rc2", "p1") }),
      key({ snapshot: snapshot("rc1", "p2") }),
      key({ contextPolicyVersion: "ctx-2" }),
      key({ action: "discover" }),
      key({ kind: "skill" })
    ]) {
      expect(changed).not.toBe(base);
    }
  });
});

// ─── instant narrowing through the proxy ────────────────────────────────────

const TOKEN = "invalidation-token";
const CANARY = "INVALIDATION_BODY_CANARY";
const tokenHash = (token: string) => "sha256:" + createHash("sha256").update(token).digest("hex");

const accessYaml = (tools: string[]) => `roles:
  reader:
    description: reader
    allow:
      tools: [${tools.join(", ")}]
users:
  - id: reader_agent
    name: reader_agent
    enabled: true
    role: reader
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: reader-token
        created: 2026-10-18
`;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

describe("narrowing takes effect on the next request (Spec §4.4)", () => {
  let root: string;
  let upstream: ReturnType<typeof createServer>;
  let proxy: ReturnType<typeof createServer>;
  let port: number;
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["KTX_PROJECT_ROOT", "LUCY_CONTENT_ROOT", "LUCY_PROXY_UPSTREAM_PORT", "KTX_INTERNAL_TOKEN"];

  beforeEach(async () => {
    for (const key of KEYS) saved[key] = process.env[key];
    root = await mkdtemp(path.join(os.tmpdir(), "lucy-invalidate-"));
    process.env.KTX_PROJECT_ROOT = root;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.KTX_INTERNAL_TOKEN = "internal-invalidation";
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
    await mkdir(path.join(root, "wiki", "global"), { recursive: true });
    await mkdir(path.join(root, "skills", "ops"), { recursive: true });
    await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n");
    await writeFile(path.join(root, "webui", "config", "access.yaml"), accessYaml(["wiki_read", "lucy_skill_read"]));
    await writeFile(path.join(root, "wiki", "global", "n.md"), `---\nallowed_roles: [reader]\n---\n# N\n${CANARY}\n`);
    await writeFile(
      path.join(root, "skills", "ops", "n.skill.md"),
      `---\nname: n-sop\ntitle: N\ndomain: ops\nstatus: published\nroles_allowed: [reader]\n---\n${CANARY}\n`
    );
    upstream = createServer(async (req, res) => {
      await readBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);
    vi.resetModules();
    const { buildProxy } = await import("../proxy/mcp-proxy.js");
    proxy = buildProxy().server;
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", () => resolve()));
    port = (proxy.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "x", method: "tools/call", params: { name, arguments: args } })
    });
    return res.text();
  };

  it("an ACL edit on disk narrows Wiki and Skill reads immediately (no listing-cache or reindex wait)", async () => {
    expect(await call("wiki_read", { key: "global/n.md" })).toContain(CANARY);
    expect(await call("lucy_skill_read", { skill_name: "n-sop" })).toContain(CANARY);

    await writeFile(path.join(root, "wiki", "global", "n.md"), `---\nallowed_roles: [someone_else]\n---\n# N\n${CANARY}\n`);
    await writeFile(
      path.join(root, "skills", "ops", "n.skill.md"),
      `---\nname: n-sop\ntitle: N\ndomain: ops\nstatus: published\nroles_allowed: [someone_else]\n---\n${CANARY}\n`
    );
    for (const text of [await call("wiki_read", { key: "global/n.md" }), await call("lucy_skill_read", { skill_name: "n-sop" })]) {
      expect(text).toContain("context_not_available");
      expect(text).not.toContain(CANARY);
    }
  });

  it("a deprecated Skill and a corrupt ACL stop serving immediately", async () => {
    await writeFile(
      path.join(root, "skills", "ops", "n.skill.md"),
      `---\nname: n-sop\ntitle: N\ndomain: ops\nstatus: deprecated\nroles_allowed: [reader]\n---\n${CANARY}\n`
    );
    expect(await call("lucy_skill_read", { skill_name: "n-sop" })).not.toContain(CANARY);
    await writeFile(path.join(root, "wiki", "global", "n.md"), `---\nallowed_roles: "reader"\n---\n# N\n${CANARY}\n`);
    expect(await call("wiki_read", { key: "global/n.md" })).not.toContain(CANARY);
  });

  it("removing a channel from the Role closes it on the next request (narrowing never waits)", async () => {
    const { invalidateAccessConfigCache } = await import("../proxy/identity.js");
    const { commitEffectivePolicy } = await import("../proxy/acl.js");
    await writeFile(path.join(root, "webui", "config", "access.yaml"), accessYaml(["lucy_skill_read"]));
    invalidateAccessConfigCache();
    await commitEffectivePolicy();
    const text = await call("wiki_read", { key: "global/n.md" });
    expect(text).not.toContain(CANARY);
    expect(await call("lucy_skill_read", { skill_name: "n-sop" })).toContain(CANARY);
  });
});

// ─── Role id retirement and context reference checks ────────────────────────

describe("Role delete / create vs Wiki and Skill ACL references (Spec §4.3)", () => {
  let projectRoot: string;
  let prevRoot: string | undefined;
  let prevContent: string | undefined;

  const ROLE = {
    allow: {
      connections: ["mysql-aliyun"],
      tableSelectors: [{ connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }],
      tools: ["lucy_query", "wiki_search", "wiki_read"]
    }
  };

  beforeEach(async () => {
    prevRoot = process.env.KTX_PROJECT_ROOT;
    prevContent = process.env.LUCY_CONTENT_ROOT;
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-role-ctx-"));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
    await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
    await mkdir(path.join(projectRoot, "skills", "ops"), { recursive: true });
    await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "roles: {}\nusers: []\n");
    await writeFile(
      path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
      "tables:\n  superstore_orders:\n    table: dataforai.superstore_orders\n"
    );
  });

  afterEach(async () => {
    if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = prevRoot;
    if (prevContent === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = prevContent;
    const { closeSecurityStore } = await import("../security/instance");
    closeSecurityStore();
    await rm(projectRoot, { recursive: true, force: true });
  });

  const createRole = (app: ReturnType<typeof buildServer>, roleId: string, extra: Record<string, unknown> = {}) =>
    request(app.server).post("/api/admin/roles").send({ dryRun: false, roleId, role: ROLE, ...extra });

  it("blocks deleting a Role that a Wiki or Skill ACL names, then retires the id after a clean delete", async () => {
    const app = buildServer();
    await app.ready();
    await createRole(app, "doomed").expect(200);
    await createRole(app, "source_role").expect(200);
    await writeFile(path.join(projectRoot, "wiki", "global", "ref.md"), "---\nallowed_roles: [doomed]\n---\n# Ref\n");
    await writeFile(
      path.join(projectRoot, "skills", "ops", "ref.skill.md"),
      "---\nname: ref-sop\ntitle: Ref\ndomain: ops\nstatus: published\nroles_allowed: [doomed]\n---\nBody\n"
    );

    const blocked = await request(app.server).delete("/api/admin/roles/doomed").send({ dryRun: false }).expect(409);
    expect(blocked.body.error.code).toBe("ROLE_REFERENCED_BY_CONTEXT");
    expect(blocked.body.error.detail).toEqual({ skills: ["lucy-skill://ops/ref-sop"], wiki: ["global/ref.md"] });
    expect(JSON.stringify(blocked.body)).not.toContain("Body");

    // dry-run reports the same blocker; nothing is retired by a blocked / dry delete.
    await request(app.server).delete("/api/admin/roles/doomed").send({ dryRun: true }).expect(409);
    await writeFile(path.join(projectRoot, "wiki", "global", "ref.md"), "---\nallowed_roles: []\n---\n# Ref\n");
    await writeFile(
      path.join(projectRoot, "skills", "ops", "ref.skill.md"),
      "---\nname: ref-sop\ntitle: Ref\ndomain: ops\nstatus: published\nroles_allowed: []\n---\nBody\n"
    );
    await request(app.server).delete("/api/admin/roles/doomed").send({ dryRun: false }).expect(200);

    const reuse = await createRole(app, "doomed").expect(409);
    expect(reuse.body.error.code).toBe("ROLE_ID_RETIRED");
    const copyReuse = await request(app.server)
      .post("/api/admin/roles/source_role/copy")
      .send({ dryRun: false, newRoleId: "doomed" })
      .expect(409);
    expect(copyReuse.body.error.code).toBe("ROLE_ID_RETIRED");
    await app.close();
  });

  it("creating a Role whose id already appears in an ACL needs an explicit acknowledgement", async () => {
    await writeFile(path.join(projectRoot, "wiki", "global", "ghost.md"), "---\nallowed_roles: [ghost_role]\n---\n# Ghost\n");
    const app = buildServer();
    await app.ready();
    const blocked = await createRole(app, "ghost_role").expect(409);
    expect(blocked.body.error.code).toBe("ROLE_ID_HAS_CONTEXT_REFERENCES");
    expect(blocked.body.error.detail.wiki).toEqual(["global/ghost.md"]);
    await createRole(app, "ghost_role", { acknowledgeContextReferences: true }).expect(200);
    await app.close();
  });

  it("a Role id that no ACL names is created normally and a `*` grant references no role", async () => {
    await writeFile(path.join(projectRoot, "wiki", "global", "all.md"), "---\nallowed_roles: ['*']\n---\n# All\n");
    const app = buildServer();
    await app.ready();
    await createRole(app, "fresh_role").expect(200);
    const detail = await request(app.server).get("/api/admin/roles/fresh_role").expect(200);
    // `*` is visible to every validly assigned role with the channel, so the Role summary lists it.
    expect(detail.body.data.wikiAccess.declared).toEqual(["global/all.md"]);
    expect(detail.body.data.wikiAccess.readable).toEqual(["global/all.md"]);
    expect(detail.body.data.contextPolicyVersion).toMatch(/^ctx-/);
    await app.close();
  });
});
