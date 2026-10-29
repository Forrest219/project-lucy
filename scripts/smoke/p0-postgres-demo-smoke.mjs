#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { ensureWebuiBootstrapToken } from "./ensure-webui-bootstrap-token.mjs";

const project = process.env.LUCY_POSTGRES_DEMO_COMPOSE_PROJECT ?? process.env.LUCY_DEMO_COMPOSE_PROJECT ?? "lucy-p0-postgres-demo";
const webPort = process.env.LUCY_POSTGRES_DEMO_WEBUI_HOST_PORT ?? "55177";
const proxyPort = process.env.LUCY_POSTGRES_DEMO_PROXY_HOST_PORT ?? "57882";
const demoToken = process.env.LUCY_DEMO_AGENT_TOKEN ?? "lucy-demo-agent-token";
const expectedKtxVersion = process.env.LUCY_EXPECTED_KTX_VERSION ?? "0.16.0";
const demoPassword = process.env.LUCY_POSTGRES_DEMO_PASSWORD ?? randomBytes(24).toString("base64url");
const composeFile = "deploy/compose/docker-compose.postgres-demo.yml";
const accessConfigPath = "examples/postgres-demo/project-template/webui/config/access.yaml";
// The compose files default TARGETPLATFORM to linux/arm64 because that is the
// common developer machine. On any other host that produces an image the host
// cannot execute ("exec /bin/sh: exec format error"), so default to the host
// architecture and let an explicit env var win.
const hostArch = process.arch === "arm64" ? "arm64" : "amd64";
const targetPlatform = process.env.TARGETPLATFORM ?? `linux/${hostArch}`;
const targetArch = process.env.TARGETARCH ?? hostArch;
let tempDockerConfig;
let tempSecretDir;

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const label = [command, ...commandArgs].join(" ");
    console.log(`\n[p0-postgres-demo-smoke] $ ${label}`);
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    if (child.stderr) child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`${label} failed with exit code ${code}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function composeArgs(args) {
  return ["compose", "-f", composeFile, "-p", project, ...args];
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return await res.json();
}

async function waitForJson(url, timeoutMs = 120_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function parseRpcBody(text) {
  if (!text.startsWith("event:")) return JSON.parse(text);
  const data = text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  return data ? JSON.parse(data) : null;
}

async function rpc(sessionId, method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${demoToken}`
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params })
  });
  const text = await res.text();
  return { res, body: parseRpcBody(text), text };
}

async function expectedProxyToolsFromAccess() {
  const config = parse(await readFile(accessConfigPath, "utf8")) ?? {};
  const user = (Array.isArray(config.users) ? config.users : []).find((item) => item?.id === "demo_agent");
  if (!user) throw new Error(`${accessConfigPath}: user demo_agent not found`);
  const roleId = user?.role;
  if (!roleId) throw new Error(`${accessConfigPath}: demo_agent has no role assigned`);
  const role = roleId ? config.roles?.[roleId] : undefined;
  if (!role) throw new Error(`${accessConfigPath}: role ${roleId} declared by demo_agent not found in roles`);
  const allowedTools = role?.allow?.tools;
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    throw new Error(`${accessConfigPath}: demo_agent role must declare allow.tools`);
  }
  const denyTools = Array.isArray(config.defaults?.deny_tools) ? config.defaults.deny_tools : [];
  return {
    allowed: [...allowedTools].sort(),
    denied: [...denyTools].sort()
  };
}

function toolText(body) {
  return (body?.result?.content ?? []).map((item) => item?.text ?? "").join("\n");
}

// Spec §4 / T05+T06: default-deny Wiki ACL. The template page is granted to the demo role;
// a synthetic page granted only to another role must answer `context_not_available`
// (same text as an unknown key) and never leak its body.
async function verifyContextAcl(sessionId) {
  const grantedKey = "global/demo-superstore.md";
  const granted = await rpc(sessionId, "tools/call", { name: "wiki_read", arguments: { key: grantedKey } });
  if (!granted.res.ok || granted.body?.error || granted.body?.result?.isError) {
    throw new Error(`wiki_read ${grantedKey} should be authorized for demo_agent: ${granted.text}`);
  }
  if (!toolText(granted.body).includes("superstore_orders")) {
    throw new Error(`wiki_read ${grantedKey} did not return the template page body`);
  }
  console.log("[p0-postgres-demo-smoke] authorized role can wiki_read the template page");

  const deniedKey = "global/smoke-acl-denied.md";
  const canary = "SMOKE_ACL_CANARY_DO_NOT_LEAK";
  const page = ["---", "allowed_roles: [smoke_other_role]", "---", "# Smoke ACL denied", canary].join("\n");
  await run("docker", composeArgs([
    "exec", "-T", "-e", "SMOKE_ACL_PAGE", "lucy", "sh", "-c",
    `mkdir -p /data/lucy/config/wiki/global && printf '%s\\n' "$SMOKE_ACL_PAGE" > /data/lucy/config/wiki/${deniedKey}`
  ]), { env: { SMOKE_ACL_PAGE: page }, capture: true });
  try {
    const denied = await rpc(sessionId, "tools/call", { name: "wiki_read", arguments: { key: deniedKey } });
    const unknown = await rpc(sessionId, "tools/call", { name: "wiki_read", arguments: { key: "global/smoke-acl-unknown.md" } });
    if (denied.body?.result?.isError !== true || toolText(denied.body) !== "context_not_available") {
      throw new Error(`unauthorized wiki_read must return context_not_available, got: ${denied.text}`);
    }
    if (denied.text.includes(canary)) throw new Error("unauthorized wiki_read leaked the page body");
    if (toolText(unknown.body) !== toolText(denied.body)) {
      throw new Error("unauthorized and unknown wiki_read responses must be identical");
    }
    console.log("[p0-postgres-demo-smoke] unauthorized role gets context_not_available (same as unknown key)");
  } finally {
    await run("docker", composeArgs(["exec", "-T", "lucy", "rm", "-f", `/data/lucy/config/wiki/${deniedKey}`]), { capture: true }).catch(() => undefined);
  }
}

async function verifyProxyAgentPath() {
  const init = await rpc("", "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "lucy-p0-postgres-demo-smoke", version: "0.1.0" }
  });
  if (!init.res.ok || init.body?.error) {
    throw new Error(`proxy initialize failed: HTTP ${init.res.status} ${JSON.stringify(init.body?.error ?? init.body)}`);
  }
  const sessionId = init.res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("proxy initialize did not return mcp-session-id");
  await rpc(sessionId, "notifications/initialized", {});

  const list = await rpc(sessionId, "tools/list", {});
  if (!list.res.ok || list.body?.error) {
    throw new Error(`proxy tools/list failed: HTTP ${list.res.status} ${JSON.stringify(list.body?.error ?? list.body)}`);
  }
  const names = (list.body?.result?.tools ?? []).map((tool) => tool.name).sort();
  const expected = await expectedProxyToolsFromAccess();
  const missing = expected.allowed.filter((name) => !names.includes(name));
  const unexpected = names.filter((name) => !expected.allowed.includes(name));
  const exposedDenied = names.filter((name) => expected.denied.includes(name));
  if (missing.length) throw new Error(`proxy tools/list missing role-allowed tools from ${accessConfigPath}: ${missing.join(", ")}`);
  if (unexpected.length) throw new Error(`proxy tools/list exposed tools outside role allow.tools from ${accessConfigPath}: ${unexpected.join(", ")}`);
  if (exposedDenied.length) throw new Error(`proxy tools/list exposed denied tools from ${accessConfigPath}: ${exposedDenied.join(", ")}`);
  console.log(`[p0-postgres-demo-smoke] proxy tools: ${names.join(", ")}`);

  // The Lucy proxy exposes the STABLE WRAPPER names, not the upstream KTX
  // names. `sl_read_source` is in ABSOLUTE_DENY_TOOLS (Spec 98 §4.2, added
  // 2026-08-08 / 1062bf4), so calling it through the proxy is denied with
  // "tool_absolute_deny:sl_read_source" — while this very script's own
  // tools/list assertion above proves the exposed set is exactly the
  // access.yaml allow list, which contains `lucy_read_source` and not
  // `sl_read_source`. The script was calling the upstream name and had been
  // failing since the deny list landed.
  const read = await rpc(sessionId, "tools/call", {
    name: "lucy_read_source",
    arguments: {
      connectionId: "demo-postgres",
      sourceName: "superstore_orders"
    }
  });
  if (!read.res.ok || read.body?.error) {
    throw new Error(`proxy lucy_read_source failed: HTTP ${read.res.status} ${JSON.stringify(read.body?.error ?? read.body)}`);
  }
  const readText = JSON.stringify(read.body?.result ?? {});
  if (!readText.includes("total_sales") || !readText.includes("active_rows")) {
    throw new Error("proxy lucy_read_source did not include expected demo semantic layer content");
  }
  console.log("[p0-postgres-demo-smoke] proxy lucy_read_source returned demo semantic layer content");

  // Same reason as the read above: the proxy exposes the Lucy wrapper names.
  // `sl_query` is in ABSOLUTE_DENY_TOOLS, so the upstream name is denied.
  // `lucy_query` takes the same arguments (source-qualified measures,
  // dimensions as objects, segments, limit, include).
  const call = await rpc(sessionId, "tools/call", {
    name: "lucy_query",
    arguments: {
      connectionId: "demo-postgres",
      measures: ["superstore_orders.total_sales"],
      dimensions: [{ field: "superstore_orders.region" }],
      segments: ["superstore_orders.active_rows"],
      limit: 5,
      include: ["sql"]
    }
  });
  if (!call.res.ok || call.body?.error) {
    throw new Error(`proxy lucy_query failed: HTTP ${call.res.status} ${JSON.stringify(call.body?.error ?? call.body)}`);
  }
  const structured = call.body?.result?.structuredContent;
  if (!structured || !Array.isArray(structured.rows) || structured.rows.length < 3) {
    throw new Error("proxy lucy_query did not return expected demo rows");
  }
  console.log(`[p0-postgres-demo-smoke] proxy lucy_query returned ${structured.rows.length} rows`);
  await verifyContextAcl(sessionId);
}

async function main() {
  const secretDir = process.env.LUCY_POSTGRES_DEMO_SECRET_DIR ?? await (async () => {
    tempSecretDir = await mkdtemp(path.join(tmpdir(), "lucy-postgres-demo-secrets-"));
    await writeFile(path.join(tempSecretDir, "postgres-password"), demoPassword, { mode: 0o600 });
    return tempSecretDir;
  })();
  await ensureWebuiBootstrapToken(secretDir);
  const env = {
    LUCY_POSTGRES_DEMO_WEBUI_HOST_PORT: webPort,
    LUCY_POSTGRES_DEMO_PROXY_HOST_PORT: proxyPort,
    LUCY_POSTGRES_DEMO_SECRET_DIR: secretDir,
    TARGETPLATFORM: targetPlatform,
    TARGETARCH: targetArch
  };
  if (!process.env.DOCKER_CONFIG) {
    tempDockerConfig = await mkdtemp(path.join(tmpdir(), "lucy-demo-docker-config-"));
    console.log(`[p0-postgres-demo-smoke] using temporary DOCKER_CONFIG=${tempDockerConfig} for Docker Hub pulls`);
    await run("docker", ["pull", "postgres:16-alpine"], { env: { DOCKER_CONFIG: tempDockerConfig } });
  }
  await run("docker", composeArgs(["up", "-d", "--build"]), { env });
  try {
    const health = await waitForJson(`http://127.0.0.1:${webPort}/api/health`);
    if (health?.ok !== true) throw new Error("demo /api/health envelope was not ok");
    if (health?.data?.bundledKtxVersion !== expectedKtxVersion) {
      throw new Error(`demo bundledKtxVersion expected ${expectedKtxVersion}, got ${health?.data?.bundledKtxVersion}`);
    }
    await run("docker", composeArgs(["exec", "-T", "lucy", "ktx", "--project-dir", "/data/lucy", "connection", "test", "demo-postgres"]));
    await run("docker", composeArgs(["exec", "-T", "lucy", "ktx", "--project-dir", "/data/lucy", "admin", "reindex", "--force", "--output", "json"]), { capture: true });
    await run("docker", composeArgs(["exec", "-T", "lucy", "ktx", "--project-dir", "/data/lucy", "sl", "validate", "superstore_orders", "--connection-id", "demo-postgres"]));
    await run("docker", composeArgs([
      "exec", "-T", "lucy", "ktx", "--project-dir", "/data/lucy",
      "sl", "--connection-id", "demo-postgres", "query",
      "--measure", "superstore_orders.total_sales",
      "--dimension", "superstore_orders.region",
      "--segment", "superstore_orders.active_rows",
      "--limit", "5",
      "--execute",
      "--max-rows", "5"
    ]));
    await verifyProxyAgentPath();
    await run("docker", composeArgs(["ps"]));
    console.log("\n[p0-postgres-demo-smoke] PASS");
  } finally {
    await run("docker", composeArgs(["down", "-v"]), { capture: true, env }).catch((error) => {
      console.error(error.message);
    });
  }
}

main().catch((error) => {
  console.error(`\n[p0-postgres-demo-smoke] FAIL: ${error.message}`);
  if (error.stderr) console.error(error.stderr);
  process.exit(1);
}).finally(async () => {
  if (tempDockerConfig) {
    await rm(tempDockerConfig, { recursive: true, force: true }).catch(() => undefined);
  }
  if (tempSecretDir) {
    await rm(tempSecretDir, { recursive: true, force: true }).catch(() => undefined);
  }
});
