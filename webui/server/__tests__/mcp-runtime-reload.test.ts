import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 191 — the execution runtime reload controller and its route.
 *
 * The controller talks to the supervisor through a file channel, so the tests
 * play the supervisor: they publish the capability file, consume the request
 * file and write the receipt. The connection level evidence comes from a stub
 * KTX MCP upstream that answers `connection_list`.
 */

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousUpstreamHost: string | undefined;
let previousUpstreamPort: string | undefined;
let previousToken: string | undefined;
let previousTimeout: string | undefined;
let previousAdminsPath: string | undefined;
let previousAuthFlag: string | undefined;
let previousDeploymentMode: string | undefined;
let previousAuditDb: string | undefined;
let auditDbPath: string;
let upstream: Server | undefined;

const KTX_YAML = `connections:
  zijin:
    host: db.example.test
    schemas: [finance]
`;

function channelDir(): string {
  return path.join(projectRoot, ".ktx-ui");
}

function capabilityPath(): string {
  return path.join(channelDir(), "ktx-reload.capability");
}

function requestPath(): string {
  return path.join(channelDir(), "ktx-reload.request");
}

function resultPath(): string {
  return path.join(channelDir(), "ktx-reload.result");
}

async function writeCapability(overrides: Record<string, unknown> = {}): Promise<void> {
  await mkdir(channelDir(), { recursive: true });
  await writeFile(
    capabilityPath(),
    JSON.stringify({
      protocol: "lucy-ktx-reload/1",
      supervisorPid: process.pid,
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      state: "idle",
      currentRequestId: "",
      ...overrides
    }),
    "utf8"
  );
}

/** Play the supervisor: take the request, then write the receipt. */
async function consumeRequest(timeoutMs = 5_000): Promise<{ requestId: string; requestedDigest: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(await readFile(requestPath(), "utf8")) as {
        requestId: string;
        requestedDigest: string;
      };
      await rm(requestPath(), { force: true });
      return parsed;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("the reload request file never appeared");
}

async function writeReceipt(
  requestId: string,
  status: "succeeded" | "failed",
  options: { actualDigest?: string; detail?: string } = {}
): Promise<void> {
  await writeFile(
    resultPath(),
    JSON.stringify({
      requestId,
      actualDigest: options.actualDigest ?? await digestOfKtxYaml(),
      status,
      ...(options.detail ? { detail: options.detail } : {}),
      finishedAt: new Date().toISOString()
    }),
    "utf8"
  );
}

async function digestOfKtxYaml(): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(await readFile(path.join(projectRoot, "ktx.yaml"))).digest("hex");
}

/** A stub KTX MCP upstream that answers `connection_list`. */
async function startUpstream(connections: string[]): Promise<void> {
  upstream = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { method?: string };
      if (body.method === "initialize") {
        response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "reload-session" });
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: "lucy-reload-verify-initialize",
          result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "ktx", version: "0" } }
        }));
        return;
      }
      if (body.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "lucy-reload-verify-call",
        result: {
          content: [{ type: "text", text: JSON.stringify({ connections }) }]
        }
      }));
    });
  });
  await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", resolve));
  process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
  process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream!.address() as AddressInfo).port);
}

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-mcp-runtime-reload-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(channelDir(), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(
    path.join(projectRoot, "webui", "config", "access.yaml"),
    "roles: {}\nusers: []\ndefaults:\n  deny_tools: []\n",
    "utf8"
  );
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousUpstreamHost = process.env.LUCY_PROXY_UPSTREAM_HOST;
  previousUpstreamPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
  previousToken = process.env.KTX_INTERNAL_TOKEN;
  previousTimeout = process.env.LUCY_KTX_RELOAD_TIMEOUT_MS;
  previousAdminsPath = process.env.LUCY_ADMINS_CONFIG_PATH;
  previousAuthFlag = process.env.LUCY_WEBUI_AUTH;
  previousDeploymentMode = process.env.LUCY_DEPLOYMENT_MODE;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.KTX_INTERNAL_TOKEN = "reload-token";
  process.env.LUCY_KTX_RELOAD_TIMEOUT_MS = "1500";
  process.env.LUCY_ADMINS_CONFIG_PATH = path.join(projectRoot, "webui", "config", "admins.yaml");
  auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.LUCY_AUDIT_DB = auditDbPath;
});

/** The audit rows written for the reload, newest last. */
function readReloadAuditRows(): Array<Record<string, unknown>> {
  const db = new Database(auditDbPath, { readonly: true });
  try {
    return db
      .prepare("SELECT actor, actor_type, operation, write_status, new_summary FROM config_change_log WHERE change_type = ?")
      .all("execution_runtime_reload") as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/**
 * Put the auth mode into a concrete state. The route checks the mode BEFORE
 * the owner check, so the test has to know which mode it is really in.
 */
async function setAuthMode(mode: "open" | "bootstrap" | "required"): Promise<void> {
  const { resetAdminsCache, resolveAuthMode } = await import("../auth/admins-store");
  if (mode === "open") {
    process.env.LUCY_DEPLOYMENT_MODE = "development";
    process.env.LUCY_WEBUI_AUTH = "off";
    await writeFile(
      path.join(projectRoot, "webui", "config", "admins.yaml"),
      'version: "1"\nadmins: []\n',
      "utf8"
    );
  } else if (mode === "bootstrap") {
    process.env.LUCY_DEPLOYMENT_MODE = "customer";
    delete process.env.LUCY_WEBUI_AUTH;
    await writeFile(
      path.join(projectRoot, "webui", "config", "admins.yaml"),
      'version: "1"\nadmins: []\n',
      "utf8"
    );
  } else {
    process.env.LUCY_DEPLOYMENT_MODE = "customer";
    delete process.env.LUCY_WEBUI_AUTH;
    await writeFile(
      path.join(projectRoot, "webui", "config", "admins.yaml"),
      [
        'version: "1"',
        "admins:",
        "  - id: owner-one",
        "    display_name: owner-one",
        '    password_hash: "not-used-here"',
        "    role: owner",
        "    enabled: true",
        '    created_at: "2026-10-27T00:00:00.000Z"'
      ].join("\n") + "\n",
      "utf8"
    );
  }
  resetAdminsCache();
  expect(await resolveAuthMode()).toBe(mode);
}

afterEach(async () => {
  const { resetReloadControllerForTests } = await import("../admin/mcp-runtime-reload");
  resetReloadControllerForTests();
  const { resetExecutionRuntimeObservationsForTests } = await import("../mcp-runtime-state");
  resetExecutionRuntimeObservationsForTests();
  const { resetAuditDbForTests } = await import("../admin/audit");
  resetAuditDbForTests();
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousUpstreamHost === undefined) delete process.env.LUCY_PROXY_UPSTREAM_HOST;
  else process.env.LUCY_PROXY_UPSTREAM_HOST = previousUpstreamHost;
  if (previousUpstreamPort === undefined) delete process.env.LUCY_PROXY_UPSTREAM_PORT;
  else process.env.LUCY_PROXY_UPSTREAM_PORT = previousUpstreamPort;
  if (previousToken === undefined) delete process.env.KTX_INTERNAL_TOKEN;
  else process.env.KTX_INTERNAL_TOKEN = previousToken;
  if (previousTimeout === undefined) delete process.env.LUCY_KTX_RELOAD_TIMEOUT_MS;
  else process.env.LUCY_KTX_RELOAD_TIMEOUT_MS = previousTimeout;
  if (previousAdminsPath === undefined) delete process.env.LUCY_ADMINS_CONFIG_PATH;
  else process.env.LUCY_ADMINS_CONFIG_PATH = previousAdminsPath;
  if (previousAuthFlag === undefined) delete process.env.LUCY_WEBUI_AUTH;
  else process.env.LUCY_WEBUI_AUTH = previousAuthFlag;
  if (previousDeploymentMode === undefined) delete process.env.LUCY_DEPLOYMENT_MODE;
  else process.env.LUCY_DEPLOYMENT_MODE = previousDeploymentMode;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (upstream) {
    await new Promise<void>((resolve, reject) => upstream!.close((error) => (error ? reject(error) : resolve())));
    upstream = undefined;
  }
  await rm(projectRoot, { recursive: true, force: true });
});

describe("Spec 191 — execution runtime reload controller", () => {
  it("reports unsupported and leaves NO file side effect when there is no supervisor capability", async () => {
    const { reloadExecutionRuntime } = await import("../admin/mcp-runtime-reload");
    const result = await reloadExecutionRuntime({ projectRoot });

    expect(result.reloadStatus).toBe("unsupported");
    expect(result.configVerification).toBe("unverified");
    await expect(readFile(requestPath(), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(channelDir(), "ktx-reload.state.json"), "utf8")).rejects.toThrow();
  });

  it("reports unsupported when the capability heartbeat is stale", async () => {
    await writeCapability({ heartbeatAt: new Date(Date.now() - 120_000).toISOString() });
    const { reloadExecutionRuntime } = await import("../admin/mcp-runtime-reload");
    const result = await reloadExecutionRuntime({ projectRoot });

    expect(result.reloadStatus).toBe("unsupported");
    await expect(readFile(requestPath(), "utf8")).rejects.toThrow();
  });

  it("reports unsupported when the capability protocol version does not match", async () => {
    await writeCapability({ protocol: "lucy-ktx-reload/99" });
    const { reloadExecutionRuntime } = await import("../admin/mcp-runtime-reload");
    const result = await reloadExecutionRuntime({ projectRoot });

    expect(result.reloadStatus).toBe("unsupported");
    await expect(readFile(requestPath(), "utf8")).rejects.toThrow();
  });

  it("reloads the daemon, verifies the configuration with connection level evidence and reports both facts", async () => {
    await writeCapability();
    await startUpstream(["zijin"]);
    const { reloadExecutionRuntime } = await import("../admin/mcp-runtime-reload");

    const pending = reloadExecutionRuntime({ projectRoot, connectionId: "zijin" });
    const request = await consumeRequest();
    expect(request.requestId).toBeTruthy();
    expect(request.requestedDigest).toBe(await digestOfKtxYaml());
    await writeReceipt(request.requestId, "succeeded");

    const result = await pending;
    expect(result.reloadStatus).toBe("succeeded");
    expect(result.configVerification).toBe("verified");
    expect(result.requestId).toBe(request.requestId);
    expect(result.actualDigest).toBe(request.requestedDigest);
    expect(result.mcpReachable).toBe("reachable");
  });

  it("reports a failed reload honestly and never rolls the configuration back", async () => {
    await writeCapability();
    await startUpstream(["zijin"]);
    const { reloadExecutionRuntime } = await import("../admin/mcp-runtime-reload");
    const digestBefore = await digestOfKtxYaml();

    const pending = reloadExecutionRuntime({ projectRoot });
    const request = await consumeRequest();
    await writeReceipt(request.requestId, "failed", { detail: "KTX MCP upstream did not become ready" });

    const result = await pending;
    expect(result.reloadStatus).toBe("failed");
    expect(result.configVerification).toBe("unverified");
    expect(result.detail).toContain("did not become ready");
    // The configuration on disk is untouched — the decision is "never roll back".
    expect(await digestOfKtxYaml()).toBe(digestBefore);
  });

  it("does not claim success when the daemon restarted but the connection evidence is missing", async () => {
    await writeCapability();
    // The daemon knows only the OLD connection: the new configuration is not loaded.
    await startUpstream(["legacy-db"]);
    const { reloadExecutionRuntime } = await import("../admin/mcp-runtime-reload");

    const pending = reloadExecutionRuntime({ projectRoot, connectionId: "zijin" });
    const request = await consumeRequest();
    await writeReceipt(request.requestId, "succeeded");

    const result = await pending;
    expect(result.reloadStatus).toBe("succeeded");
    expect(result.configVerification).toBe("failed");
    expect(result.detail).toContain("zijin");
  });

  it("returns already_running while the supervisor is executing another reload", async () => {
    await writeCapability({ state: "reloading", currentRequestId: "other-request" });
    const { reloadExecutionRuntime } = await import("../admin/mcp-runtime-reload");
    const result = await reloadExecutionRuntime({ projectRoot });

    expect(result.reloadStatus).toBe("already_running");
    await expect(readFile(requestPath(), "utf8")).rejects.toThrow();
  });

  it("does not start a second reload after a timeout and ignores the late receipt", async () => {
    process.env.LUCY_KTX_RELOAD_TIMEOUT_MS = "300";
    await writeCapability();
    await startUpstream(["zijin"]);
    const { reloadExecutionRuntime } = await import("../admin/mcp-runtime-reload");

    const first = await reloadExecutionRuntime({ projectRoot });
    expect(first.reloadStatus).toBe("failed");
    expect(first.detail).toContain("超时");

    // A late receipt for the timed-out request must not complete a later one.
    await writeReceipt(first.requestId, "succeeded");
    const second = await reloadExecutionRuntime({ projectRoot });
    expect(second.requestId).not.toBe(first.requestId);
    // The second request is still waiting for ITS receipt: the late one was discarded.
    expect(second.reloadStatus).toBe("failed");
    expect(second.detail).toContain("超时");
  });

  it("refuses a target connection that is not in the configuration on disk", async () => {
    await writeCapability();
    await startUpstream(["zijin"]);
    const { reloadExecutionRuntime } = await import("../admin/mcp-runtime-reload");

    const result = await reloadExecutionRuntime({ projectRoot, connectionId: "not-in-ktx-yaml" });
    expect(result.reloadStatus).toBe("failed");
    expect(result.detail).toContain("not-in-ktx-yaml");
    // No request was issued: the daemon was not restarted for a target that
    // could never be confirmed.
    await expect(readFile(requestPath(), "utf8")).rejects.toThrow();
  });

  it("refuses a second reload while one is in flight, for ANY digest", async () => {
    await writeCapability();
    await startUpstream(["zijin"]);
    const { reloadExecutionRuntime } = await import("../admin/mcp-runtime-reload");

    // Two concurrent callers: the second must not issue a second request.
    const first = reloadExecutionRuntime({ projectRoot });
    const second = await reloadExecutionRuntime({ projectRoot });
    expect(second.reloadStatus).toBe("already_running");
    expect(second.requestId).not.toBe("");

    // Exactly one request reached the channel.
    const request = await consumeRequest();
    await writeReceipt(request.requestId, "succeeded");
    const firstResult = await first;
    expect(firstResult.reloadStatus).toBe("succeeded");
    expect(firstResult.requestId).toBe(request.requestId);
  });

  it("keeps the activation statement digest-bound", async () => {
    await writeCapability();
    await startUpstream(["zijin"]);
    const { markExecutionRuntimePending, readReloadState } = await import("../admin/mcp-runtime-reload");

    expect(await markExecutionRuntimePending(projectRoot)).toBe(true);
    const pendingState = await readReloadState(projectRoot);
    expect(pendingState.activation).toBe("reload_required");

    // A write that does not change the configuration leaves the state alone.
    expect(await markExecutionRuntimePending(projectRoot, await digestOfKtxYaml())).toBe(false);
    expect((await readReloadState(projectRoot)).activation).toBe("reload_required");
  });

  it("clears the old execution evidence when a reload succeeds", async () => {
    await writeCapability();
    await startUpstream(["zijin"]);
    const { reloadExecutionRuntime } = await import("../admin/mcp-runtime-reload");
    const state = await import("../mcp-runtime-state");

    const digest = await digestOfKtxYaml();
    state.recordExecutionRuntimeObservation({
      connectionId: "zijin",
      configDigest: digest,
      status: "ok",
      checkedAt: new Date().toISOString()
    });
    expect(state.listExecutionRuntimeObservations(digest)).toHaveLength(1);

    const pending = reloadExecutionRuntime({ projectRoot });
    const request = await consumeRequest();
    await writeReceipt(request.requestId, "succeeded");
    await pending;

    // Fresh evidence, written for the digest the daemon actually loaded.
    const observations = state.listExecutionRuntimeObservations(digest);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.status).toBe("ok");
  });
});

describe("Spec 191 — POST /api/admin/mcp-runtime/reload", () => {
  async function buildApp(options: {
    admin?: { id: string; role: "owner" | "operator" } | null;
    authMode: "open" | "bootstrap" | "required";
    reload?: unknown;
  }) {
    const { registerMcpRuntimeRoutes } = await import("../admin/mcp-runtime");
    const app = Fastify();
    app.addHook("onRequest", async (request) => {
      request.lucyAdmin = {
        session: null,
        admin: options.admin
          ? {
              id: options.admin.id,
              display_name: options.admin.id,
              role: options.admin.role,
              enabled: true,
              created_at: "2026-10-27T00:00:00.000Z"
            }
          : null,
        stateUnavailable: false,
        authMode: options.authMode
      };
    });
    registerMcpRuntimeRoutes(app, {
      probeExecutionRuntime: async () => ({
        status: "reachable",
        checkedAt: new Date().toISOString()
      }),
      ...(options.reload ? { reloadExecutionRuntime: options.reload as never } : {})
    });
    await app.ready();
    return app;
  }

  it("refuses the request in open mode and writes NO request file", async () => {
    await setAuthMode("open");
    const app = await buildApp({ admin: null, authMode: "open" });

    const response = await app.inject({ method: "POST", url: "/api/admin/mcp-runtime/reload" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("AUTH_NOT_CONFIGURED");
    await expect(readFile(requestPath(), "utf8")).rejects.toThrow();
    await app.close();
  });

  it("refuses the request in bootstrap mode", async () => {
    await setAuthMode("bootstrap");
    const app = await buildApp({ admin: null, authMode: "bootstrap" });

    const response = await app.inject({ method: "POST", url: "/api/admin/mcp-runtime/reload" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("AUTH_NOT_CONFIGURED");
    await app.close();
  });

  it("answers 401 for a request without an administrator", async () => {
    await setAuthMode("required");
    const app = await buildApp({ admin: null, authMode: "required" });

    const response = await app.inject({ method: "POST", url: "/api/admin/mcp-runtime/reload" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_REQUIRED");
    // The refusal is audited even though no administrator could be resolved.
    const rows = readReloadAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.operation).toBe("denied");
    expect(rows[0]?.actor).toBe("anonymous");
    await app.close();
  });

  it("answers 403 for an authenticated non-owner and writes NO request file", async () => {
    await setAuthMode("required");
    const app = await buildApp({ admin: { id: "op-one", role: "operator" }, authMode: "required" });

    const response = await app.inject({ method: "POST", url: "/api/admin/mcp-runtime/reload" });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("OWNER_REQUIRED");
    await expect(readFile(requestPath(), "utf8")).rejects.toThrow();
    const rows = readReloadAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.operation).toBe("denied");
    expect(rows[0]?.actor).toBe("op-one");
    await app.close();
  });

  it("lets the owner trigger the reload and reports the three facts separately", async () => {
    await setAuthMode("required");
    const app = await buildApp({
      admin: { id: "owner-one", role: "owner" },
      authMode: "required",
      reload: async () => ({
        requestId: "req-1",
        reloadStatus: "succeeded" as const,
        configVerification: "verified" as const,
        mcpReachable: "reachable" as const,
        requestedDigest: "digest-a",
        actualDigest: "digest-a",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 12
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/mcp-runtime/reload",
      payload: { reason: "user_confirmed" }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.data.reloadStatus).toBe("succeeded");
    expect(body.data.configVerification).toBe("verified");
    const rows = readReloadAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.operation).toBe("succeeded");
    expect(rows[0]?.actor).toBe("owner-one");
    await app.close();
  });

  it("exposes the three dimensional execution state on the status surface", async () => {
    const { registerMcpRuntimeRoutes } = await import("../admin/mcp-runtime");
    const app = Fastify();
    registerMcpRuntimeRoutes(app, {
      probeExecutionRuntime: async () => ({
        status: "reachable",
        checkedAt: new Date().toISOString()
      })
    });
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/api/admin/mcp-runtime/status" });
    expect(response.statusCode).toBe(200);
    const execution = response.json().data.execution;
    expect(execution).toHaveProperty("activation");
    expect(execution).toHaveProperty("reload");
    expect(execution).toHaveProperty("verification");
    expect(execution.activation).toBe("unknown");
    expect(execution.reload.state).toBe("idle");
    expect(execution.verification.state).toBe("unverified");
    await app.close();
  });
});
