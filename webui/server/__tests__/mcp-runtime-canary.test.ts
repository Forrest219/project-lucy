import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let previousRoot: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-mcp-runtime-canary-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "ktx.yaml"),
    "connections:\n  zijin:\n    schemas: [finance]\n",
    "utf8"
  );
  await writeFile(
    path.join(projectRoot, "webui", "config", "access.yaml"),
    "roles: {}\nusers: []\ndefaults:\n  deny_tools: []\n",
    "utf8"
  );
  previousRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

async function buildApp(probeStatus: "reachable" | "unavailable" = "reachable") {
  const { registerMcpRuntimeRoutes } = await import("../admin/mcp-runtime");
  const app = Fastify();
  registerMcpRuntimeRoutes(app, {
    probeExecutionRuntime: async () => ({
      status: probeStatus,
      checkedAt: "2026-09-08T00:00:00.000Z",
      ...(probeStatus === "unavailable" ? { error: "connection refused" } : {})
    })
  });
  await app.ready();
  return app;
}

describe("POST /api/admin/mcp-runtime/canary", () => {
  it("requires connectionId", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/mcp-runtime/canary",
      payload: {}
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("fails when the connection is absent from disk config", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/mcp-runtime/canary",
      payload: { connectionId: "missing" }
    });
    expect(response.json().data).toMatchObject({
      status: "fail",
      executionRuntimeAck: false,
      decisionReason: "config_missing"
    });
    await app.close();
  });

  it("does not turn tools/list reachability into connection execution acknowledgement", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/mcp-runtime/canary",
      payload: { connectionId: "zijin" }
    });
    expect(response.json().data).toMatchObject({
      status: "blocked",
      executionRuntimeAck: false,
      decisionReason: "execution_canary_blocked"
    });
    await app.close();
  });

  it("acknowledges only a successful query observation tied to the current config digest", async () => {
    const state = await import("../mcp-runtime-state");
    state.recordExecutionRuntimeObservation({
      connectionId: "zijin",
      configDigest: await state.readKtxYamlDigest(projectRoot),
      status: "ok",
      checkedAt: "2026-09-08T00:01:00.000Z"
    });
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/mcp-runtime/canary",
      payload: { connectionId: "zijin" }
    });
    expect(response.json().data).toMatchObject({
      status: "pass",
      executionRuntimeAck: true,
      decisionReason: "allowed"
    });
    await app.close();
  });

  it("reports upstream unavailability distinctly", async () => {
    const app = await buildApp("unavailable");
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/mcp-runtime/canary",
      payload: { connectionId: "zijin" }
    });
    expect(response.json().data).toMatchObject({
      status: "fail",
      executionRuntimeAck: false,
      decisionReason: "execution_runtime_unavailable"
    });
    await app.close();
  });

  it("reports a Policy Runtime mismatch before blaming execution", async () => {
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      `users:
  - id: blocked_agent
    enabled: true
    tokens: []
    allow:
      connections: []
      tables: []
      tools: [lucy_query]
defaults:
  deny_tools: []
`,
      "utf8"
    );
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/mcp-runtime/canary",
      payload: { connectionId: "zijin", agentId: "blocked_agent" }
    });
    expect(response.json().data).toMatchObject({
      status: "fail",
      executionRuntimeAck: false,
      decisionReason: "policy_missing_connection"
    });
    await app.close();
  });
});
