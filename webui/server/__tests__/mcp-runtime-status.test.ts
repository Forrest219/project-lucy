import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let previousRoot: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-mcp-runtime-status-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "ktx.yaml"),
    `connections:
  zijin:
    host: db.example.test
    password: super-secret-value
    schemas: [finance]
`,
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

async function buildApp(probeStatus: "reachable" | "unavailable") {
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

describe("GET /api/admin/mcp-runtime/status", () => {
  it("reports disk, Catalog, Policy Runtime, and conservative execution state without secrets", async () => {
    const app = await buildApp("reachable");
    const response = await app.inject({ method: "GET", url: "/api/admin/mcp-runtime/status" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, any>;
    expect(body.ok).toBe(true);
    expect(body.data.config.connectionIds).toEqual(["zijin"]);
    expect(body.data.config.ktxYamlDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(body.data.policy).toHaveProperty("policyVersion");
    expect(body.data.policy).toHaveProperty("healthy");
    expect(body.data.execution).toMatchObject({
      status: "unknown",
      unknownConnections: ["zijin"]
    });
    expect(JSON.stringify(body)).not.toContain("super-secret-value");
    await app.close();
  });

  it("reports unavailable when the resident KTX MCP process cannot be reached", async () => {
    const app = await buildApp("unavailable");
    const response = await app.inject({ method: "GET", url: "/api/admin/mcp-runtime/status" });
    expect(response.json().data.execution).toMatchObject({
      status: "unavailable",
      lastError: "connection refused"
    });
    await app.close();
  });

  it("probes the resident KTX MCP endpoint with the internal token", async () => {
    let authorization = "";
    const upstream = createServer((request, response) => {
      authorization = request.headers.authorization ?? "";
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: "lucy-runtime-probe", result: { tools: [] } }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const previousHost = process.env.LUCY_PROXY_UPSTREAM_HOST;
    const previousPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
    const previousToken = process.env.KTX_INTERNAL_TOKEN;
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);
    process.env.KTX_INTERNAL_TOKEN = "runtime-probe-token";
    try {
      const runtime = await import("../admin/mcp-runtime");
      runtime.resetExecutionRuntimeProbeForTests();
      await expect(runtime.probeExecutionRuntime({ force: true })).resolves.toMatchObject({ status: "reachable" });
      expect(authorization).toBe("Bearer runtime-probe-token");
    } finally {
      if (previousHost === undefined) delete process.env.LUCY_PROXY_UPSTREAM_HOST;
      else process.env.LUCY_PROXY_UPSTREAM_HOST = previousHost;
      if (previousPort === undefined) delete process.env.LUCY_PROXY_UPSTREAM_PORT;
      else process.env.LUCY_PROXY_UPSTREAM_PORT = previousPort;
      if (previousToken === undefined) delete process.env.KTX_INTERNAL_TOKEN;
      else process.env.KTX_INTERNAL_TOKEN = previousToken;
      await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("distinguishes a reachable JSON-RPC error from transport unavailability", async () => {
    const upstream = createServer((request, response) => {
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "lucy-runtime-probe",
        error: { code: -32000, message: "probe rejected" }
      }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const previousHost = process.env.LUCY_PROXY_UPSTREAM_HOST;
    const previousPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);
    try {
      const runtime = await import("../admin/mcp-runtime");
      runtime.resetExecutionRuntimeProbeForTests();
      await expect(runtime.probeExecutionRuntime({ force: true })).resolves.toMatchObject({ status: "error" });
    } finally {
      if (previousHost === undefined) delete process.env.LUCY_PROXY_UPSTREAM_HOST;
      else process.env.LUCY_PROXY_UPSTREAM_HOST = previousHost;
      if (previousPort === undefined) delete process.env.LUCY_PROXY_UPSTREAM_PORT;
      else process.env.LUCY_PROXY_UPSTREAM_PORT = previousPort;
      await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
    }
  });
});
