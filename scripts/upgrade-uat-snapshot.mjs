#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

const CANARY_QUERY = {
  connectionId: "mysql-aliyun",
  measures: ["ai_intl_country_daily.dau"],
  filters: [
    { field: "ai_intl_country_daily.date", op: "eq", value: "2026-07-13" },
    { field: "ai_intl_country_daily.country_region_cn", op: "eq", value: "韩国" },
    { field: "ai_intl_country_daily.platform", op: "eq", value: "android" }
  ],
  limit: 3
};

function parseRpcBody(text) {
  if (!text.startsWith("event:")) return JSON.parse(text);
  const data = text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  return data ? JSON.parse(data) : null;
}

function normalizeProxyUrl(proxyUrl) {
  const trimmed = proxyUrl.replace(/\/$/, "");
  return trimmed.endsWith("/mcp") ? trimmed : `${trimmed}/mcp`;
}

async function rpc(proxyUrl, token, sessionId, method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(normalizeProxyUrl(proxyUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params })
  });
  const text = await res.text();
  return { res, body: parseRpcBody(text), text };
}

async function sha256File(filePath) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

async function sqliteQuery(dbPath, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", [dbPath, sql], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`sqlite3 failed (${code}): ${stderr || stdout}`));
    });
  });
}

async function readAuditStats(auditDbPath) {
  const count = await sqliteQuery(auditDbPath, "SELECT COUNT(*) FROM access_log;");
  const maxId = await sqliteQuery(auditDbPath, "SELECT COALESCE(MAX(id), 0) FROM access_log;");
  const spotTurn = await sqliteQuery(
    auditDbPath,
    "SELECT lucy_turn_id FROM access_log WHERE lucy_turn_id IS NOT NULL AND lucy_turn_id != '' ORDER BY id DESC LIMIT 1;"
  );
  return {
    accessLogCount: Number(count),
    maxAccessLogId: Number(maxId),
    spotTurnId: spotTurn || null
  };
}

async function fetchHealth(webuiUrl) {
  const res = await fetch(`${webuiUrl.replace(/\/$/, "")}/api/health`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

async function runMcpCanary(proxyUrl, token) {
  const init = await rpc(proxyUrl, token, "", "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "upgrade-uat-snapshot", version: "0.1.0" }
  });
  if (!init.res.ok || init.body?.error) {
    throw new Error(`initialize failed: HTTP ${init.res.status} ${init.text}`);
  }
  const sessionId = init.res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("initialize missing mcp-session-id");
  await rpc(proxyUrl, token, sessionId, "notifications/initialized", {});

  const catalog = await rpc(proxyUrl, token, sessionId, "tools/call", {
    name: "lucy_catalog",
    arguments: {}
  });
  if (!catalog.res.ok || catalog.body?.error) {
    throw new Error(`lucy_catalog failed: HTTP ${catalog.res.status} ${JSON.stringify(catalog.body?.error ?? catalog.body)}`);
  }

  const query = await rpc(proxyUrl, token, sessionId, "tools/call", {
    name: "lucy_query",
    arguments: CANARY_QUERY
  });
  if (!query.res.ok || query.body?.error) {
    throw new Error(`lucy_query failed: HTTP ${query.res.status} ${JSON.stringify(query.body?.error ?? query.body)}`);
  }
  if (query.body?.result?.isError) {
    const message = query.body?.result?.content?.[0]?.text ?? JSON.stringify(query.body?.result);
    throw new Error(`lucy_query returned isError: ${message}`);
  }
  const rows = query.body?.result?.structuredContent?.rows ?? [];
  return {
    initializeStatus: init.res.status,
    catalogOk: true,
    queryRowCount: Array.isArray(rows) ? rows.length : 0
  };
}

async function readToken(tokenEnv, tokenFile) {
  if (tokenEnv && process.env[tokenEnv]?.trim()) {
    return process.env[tokenEnv].trim();
  }
  if (tokenFile) {
    return (await readFile(tokenFile, "utf8")).trim();
  }
  return undefined;
}

async function writeSnapshot(options) {
  const accessYamlPath = `${options.configRoot}/webui/config/access.yaml`;
  const auditDbPath = `${options.configRoot}/.ktx-ui/audit.sqlite`;
  await access(accessYamlPath);
  await access(auditDbPath);

  const snapshot = {
    capturedAt: new Date().toISOString(),
    gitCommit: options.gitCommit ?? null,
    upgradeTag: options.upgradeTag ?? null,
    configRoot: options.configRoot,
    webui: options.webui,
    proxy: options.proxy,
    accessYamlSha256: await sha256File(accessYamlPath),
    audit: await readAuditStats(auditDbPath),
    health: await fetchHealth(options.webui)
  };

  const token = await readToken(options.tokenEnv, options.tokenFile);
  if (token) {
    snapshot.mcp = await runMcpCanary(options.proxy, token);
  } else {
    snapshot.mcp = { skipped: true, reason: "no token provided" };
  }

  await writeFile(options.out, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`[upgrade-uat-snapshot] wrote ${options.out}`);
  console.log(JSON.stringify(snapshot, null, 2));
}

function printHelp() {
  console.log(`Usage:
  node scripts/upgrade-uat-snapshot.mjs write [options]

Options:
  --config-root <path>   customer-config bind mount root
  --webui <url>          Lucy WebUI base URL (default: http://127.0.0.1:55177)
  --proxy <url>          Lucy MCP Proxy URL (default: http://127.0.0.1:57882/mcp)
  --token-env <NAME>     Env var holding bearer token plaintext
  --token-file <path>    Token plaintext file (default: /tmp/lucy-macpro-m4-fast.token)
  --out <path>           Snapshot output JSON
  --git-commit <sha>     Optional git commit label
  --upgrade-tag <tag>    Optional UPGRADE_TAG label
`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(command ? 0 : 1);
  }
  if (command !== "write") {
    throw new Error(`Unknown command: ${command}`);
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      "config-root": { type: "string" },
      webui: { type: "string", default: "http://127.0.0.1:55177" },
      proxy: { type: "string", default: "http://127.0.0.1:57882/mcp" },
      "token-env": { type: "string", default: "LUCY_UPGRADE_TOKEN" },
      "token-file": { type: "string", default: "/tmp/lucy-macpro-m4-fast.token" },
      out: { type: "string", default: "inbox/upgrade-uat-baseline.json" },
      "git-commit": { type: "string" },
      "upgrade-tag": { type: "string" }
    }
  });

  const configRoot = values["config-root"] ?? process.env.UPGRADE_CONFIG_ROOT;
  if (!configRoot) throw new Error("--config-root or UPGRADE_CONFIG_ROOT is required");

  await writeSnapshot({
    configRoot,
    webui: values.webui,
    proxy: values.proxy,
    tokenEnv: values["token-env"],
    tokenFile: values["token-file"],
    out: values.out,
    gitCommit: values["git-commit"],
    upgradeTag: values["upgrade-tag"]
  });
}

main().catch((error) => {
  console.error(`[upgrade-uat-snapshot] FAIL: ${error.message}`);
  process.exit(1);
});
