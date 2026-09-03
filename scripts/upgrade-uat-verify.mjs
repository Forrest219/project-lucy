#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
  const spotTurn = await sqliteQuery(
    auditDbPath,
    "SELECT lucy_turn_id FROM access_log WHERE lucy_turn_id IS NOT NULL AND lucy_turn_id != '' ORDER BY id DESC LIMIT 1;"
  );
  return {
    accessLogCount: Number(count),
    spotTurnId: spotTurn || null
  };
}

async function readToken(tokenEnv, tokenFile) {
  if (tokenEnv && process.env[tokenEnv]?.trim()) {
    return process.env[tokenEnv].trim();
  }
  if (tokenFile) {
    return (await readFile(tokenFile, "utf8")).trim();
  }
  throw new Error("token missing: set token env or token file");
}

async function verifyMcp(proxyUrl, token) {
  const init = await rpc(proxyUrl, token, "", "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "upgrade-uat-verify", version: "0.1.0" }
  });
  if (!init.res.ok || init.body?.error) {
    throw new Error(`initialize failed: HTTP ${init.res.status}`);
  }
  const sessionId = init.res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("initialize missing mcp-session-id");
  await rpc(proxyUrl, token, sessionId, "notifications/initialized", {});

  const query = await rpc(proxyUrl, token, sessionId, "tools/call", {
    name: "lucy_query",
    arguments: CANARY_QUERY
  });
  if (!query.res.ok || query.body?.error) {
    throw new Error(`lucy_query failed: HTTP ${query.res.status}`);
  }
  if (query.body?.result?.isError) {
    throw new Error(`lucy_query returned isError: ${query.body?.result?.content?.[0]?.text ?? "unknown"}`);
  }
  const rows = query.body?.result?.structuredContent?.rows ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("lucy_query returned no rows");
  }
  return { initializeStatus: init.res.status, queryRowCount: rows.length };
}

async function verifyTurnDetail(webuiUrl, turnId) {
  const res = await fetch(`${webuiUrl.replace(/\/$/, "")}/api/admin/audit/turns/${encodeURIComponent(turnId)}`);
  return { ok: res.ok, status: res.status };
}

function printHelp() {
  console.log(`Usage:
  node scripts/upgrade-uat-verify.mjs [options]

Options:
  --baseline <path>      Baseline snapshot JSON (default: inbox/upgrade-uat-baseline.json)
  --config-root <path>   customer-config bind mount root
  --webui <url>          WebUI base URL
  --proxy <url>          MCP Proxy URL
  --token-env <NAME>     Bearer token env var
  --token-file <path>    Bearer token file
`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const { values } = parseArgs({
    args: argv,
    options: {
      baseline: { type: "string", default: "inbox/upgrade-uat-baseline.json" },
      "config-root": { type: "string" },
      webui: { type: "string", default: "http://127.0.0.1:55177" },
      proxy: { type: "string", default: "http://127.0.0.1:57882/mcp" },
      "token-env": { type: "string", default: "LUCY_UPGRADE_TOKEN" },
      "token-file": { type: "string", default: "/tmp/lucy-macpro-m4-fast.token" }
    }
  });

  const configRoot = values["config-root"] ?? process.env.UPGRADE_CONFIG_ROOT;
  if (!configRoot) throw new Error("--config-root or UPGRADE_CONFIG_ROOT is required");

  const baseline = JSON.parse(await readFile(values.baseline, "utf8"));
  const accessYamlPath = `${configRoot}/webui/config/access.yaml`;
  const auditDbPath = `${configRoot}/.ktx-ui/audit.sqlite`;
  const checks = [];

  const accessHash = await sha256File(accessYamlPath);
  checks.push({
    name: "access_yaml_hash",
    pass: accessHash === baseline.accessYamlSha256,
    expected: baseline.accessYamlSha256,
    actual: accessHash
  });

  const audit = await readAuditStats(auditDbPath);
  checks.push({
    name: "audit_row_count",
    pass: audit.accessLogCount >= baseline.audit.accessLogCount,
    expected: baseline.audit.accessLogCount,
    actual: audit.accessLogCount
  });

  const spotTurnId = baseline.audit.spotTurnId;
  if (spotTurnId) {
    const turnExists = await sqliteQuery(
      auditDbPath,
      `SELECT COUNT(*) FROM access_log WHERE lucy_turn_id = '${spotTurnId.replace(/'/g, "''")}';`
    );
    checks.push({
      name: "spot_turn_sqlite",
      pass: Number(turnExists) > 0,
      expected: spotTurnId,
      actual: turnExists
    });
    const turnDetail = await verifyTurnDetail(values.webui, spotTurnId);
    checks.push({
      name: "spot_turn_api",
      pass: turnDetail.status === 200 || turnDetail.status === 401,
      expected: "200 or 401-with-sqlite-ok",
      actual: turnDetail.status,
      note: turnDetail.status === 401 ? "WebUI auth not provided; sqlite spot turn check is authoritative" : undefined
    });
  }

  const healthRes = await fetch(`${values.webui.replace(/\/$/, "")}/api/health`);
  const health = await healthRes.json();
  const bundled = health?.data?.bundledKtxVersion ?? health?.bundledKtxVersion;
  const expectedKtx = baseline.health?.body?.data?.bundledKtxVersion ?? "0.16.0";
  checks.push({
    name: "bundled_ktx_version",
    pass: bundled === expectedKtx,
    expected: expectedKtx,
    actual: bundled
  });

  const token = await readToken(values["token-env"], values["token-file"]);
  const mcp = await verifyMcp(values.proxy, token);
  checks.push({
    name: "mcp_initialize",
    pass: mcp.initializeStatus === 200,
    expected: 200,
    actual: mcp.initializeStatus
  });
  checks.push({
    name: "mcp_query_rows",
    pass: mcp.queryRowCount > 0,
    expected: ">0",
    actual: mcp.queryRowCount
  });

  let failed = false;
  for (const check of checks) {
    const label = check.pass ? "PASS" : "FAIL";
    console.log(`[upgrade-uat-verify] ${label} ${check.name}`);
    console.log(`  expected=${check.expected} actual=${check.actual}${check.note ? ` (${check.note})` : ""}`);
    if (!check.pass) failed = true;
  }

  if (failed) {
    console.error("\n[upgrade-uat-verify] FAIL");
    process.exit(1);
  }
  console.log("\n[upgrade-uat-verify] PASS");
}

main().catch((error) => {
  console.error(`[upgrade-uat-verify] FAIL: ${error.message}`);
  process.exit(1);
});
