#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT_CODES = { pass: 0, fail: 1, usage: 2, blocked: 42 };
export const SESSION_REQUIRED_TEXT = "MCP initialize request is required before session traffic.";

const DEFAULT_PROXY_URL = process.env.LUCY_UAT_PROXY_URL ?? "http://127.0.0.1:57881/mcp";
const DEFAULT_OUT = "inbox/mcp-session-uat/evidence.json";
const DEFAULT_TOKEN_ENV = "LUCY_UAT_TOKEN";
const DEFAULT_CONTAINER = process.env.LUCY_UAT_CONTAINER ?? "project-lucy-lucy-1";

const USAGE = `Usage:
  npm run uat:mcp-session -- [options]

Options:
  --proxy-url <url>          Lucy MCP Proxy URL. Default: ${DEFAULT_PROXY_URL}
  --token-env <name>        Environment variable containing the UAT token. Default: ${DEFAULT_TOKEN_ENV}
  --connection-id <id>      Connection ID. Default: demo-mysql
  --source-name <name>      Semantic source. Default: superstore_orders
  --measure <name>          Query measure. Repeatable; defaults to demo order_count + total_sales.
  --segment <name>          Query segment. Repeatable; defaults to demo active_rows.
  --expected-order-count <n>  Optional exact order_count assertion.
  --expected-total-sales <n>  Optional exact total_sales assertion.
  --out <path>              Redacted JSON evidence. Default: ${DEFAULT_OUT}
  --container <name>        Docker container used for provenance and audit checks.
  --no-container            Skip Docker provenance/audit checks (for remote Doris or harness tests).
  --timeout-ms <n>          Per-request timeout. Default: 15000
  --help                    Show this help.
`;

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function positiveNumber(value, option) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${option} must be a positive number`);
  return parsed;
}

export function parseArgs(argv = process.argv) {
  const args = {
    proxyUrl: DEFAULT_PROXY_URL,
    tokenEnv: DEFAULT_TOKEN_ENV,
    connectionId: "demo-mysql",
    sourceName: "superstore_orders",
    measures: [],
    segments: [],
    expectedOrderCount: undefined,
    expectedTotalSales: undefined,
    out: DEFAULT_OUT,
    container: DEFAULT_CONTAINER,
    timeoutMs: 15_000,
    help: false
  };
  let expectedOrderCountExplicit = false;
  let expectedTotalSalesExplicit = false;

  for (let index = 2; index < argv.length; index += 1) {
    const option = argv[index];
    switch (option) {
      case "--proxy-url":
        args.proxyUrl = requiredValue(argv, ++index, option);
        break;
      case "--token-env":
        args.tokenEnv = requiredValue(argv, ++index, option);
        break;
      case "--connection-id":
        args.connectionId = requiredValue(argv, ++index, option);
        break;
      case "--source-name":
        args.sourceName = requiredValue(argv, ++index, option);
        break;
      case "--measure":
        args.measures.push(requiredValue(argv, ++index, option));
        break;
      case "--segment":
        args.segments.push(requiredValue(argv, ++index, option));
        break;
      case "--expected-order-count":
        args.expectedOrderCount = positiveNumber(requiredValue(argv, ++index, option), option);
        expectedOrderCountExplicit = true;
        break;
      case "--expected-total-sales":
        args.expectedTotalSales = positiveNumber(requiredValue(argv, ++index, option), option);
        expectedTotalSalesExplicit = true;
        break;
      case "--out":
        args.out = requiredValue(argv, ++index, option);
        break;
      case "--container":
        args.container = requiredValue(argv, ++index, option);
        break;
      case "--no-container":
        args.container = undefined;
        break;
      case "--timeout-ms":
        args.timeoutMs = positiveNumber(requiredValue(argv, ++index, option), option);
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${option}`);
    }
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(args.tokenEnv)) {
    throw new Error("--token-env must be an environment-variable name");
  }
  const demoDefaults = args.connectionId === "demo-mysql" && args.sourceName === "superstore_orders";
  if (args.measures.length === 0) {
    args.measures = [
      `${args.sourceName}.order_count`,
      `${args.sourceName}.total_sales`
    ];
  }
  if (args.segments.length === 0 && demoDefaults) args.segments = [`${args.sourceName}.active_rows`];
  if (demoDefaults && !expectedOrderCountExplicit) args.expectedOrderCount = 1000;
  if (demoDefaults && !expectedTotalSalesExplicit) args.expectedTotalSales = 1459476.0953;
  return args;
}

function parseRpcBody(text) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("event:")) return JSON.parse(trimmed);
  const payloads = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()));
  return payloads.findLast((payload) => payload && typeof payload === "object" && ("result" in payload || "error" in payload));
}

function deepParseJsonStrings(value, depth = 0) {
  if (depth > 8) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
    try {
      return deepParseJsonStrings(JSON.parse(trimmed), depth + 1);
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map((item) => deepParseJsonStrings(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepParseJsonStrings(item, depth + 1)]));
}

export function extractMetric(payload, metricName) {
  const parsed = deepParseJsonStrings(payload);
  const visit = (value, depth = 0) => {
    if (depth > 12 || value === null || value === undefined) return undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (typeof value !== "object") return undefined;
    const record = value;
    for (const [key, item] of Object.entries(record)) {
      if (key === metricName || key.endsWith(`.${metricName}`)) return item;
    }
    if (Array.isArray(record.headers) && Array.isArray(record.rows)) {
      const index = record.headers.findIndex((header) => header === metricName || String(header).endsWith(`.${metricName}`));
      if (index >= 0 && Array.isArray(record.rows[0])) return record.rows[0][index];
    }
    for (const item of Object.values(record)) {
      const found = visit(item, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return visit(parsed);
}

function safeSnippet(value, token, max = 500) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const redacted = token ? text.split(token).join("[REDACTED]") : text;
  return redacted.length > max ? `${redacted.slice(0, max)}…` : redacted;
}

async function rpc({ proxyUrl, token, timeoutMs, sessionId, authorized = true }, method, params, id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    };
    if (authorized) headers.authorization = `Bearer ${token}`;
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
    });
    const text = await response.text();
    let body;
    try {
      body = parseRpcBody(text);
    } catch (error) {
      body = { parseError: error instanceof Error ? error.message : String(error), raw: safeSnippet(text, token) };
    }
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      sessionId: response.headers.get("mcp-session-id") ?? undefined,
      body,
      text
    };
  } finally {
    clearTimeout(timer);
  }
}

async function terminate({ proxyUrl, token, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(proxyUrl, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal
    });
    await response.text();
    return response.status;
  } finally {
    clearTimeout(timer);
  }
}

function assertRpcSuccess(label, response, token) {
  const visible = response.text || JSON.stringify(response.body ?? {});
  if (visible.includes(SESSION_REQUIRED_TEXT)) {
    throw new Error(`${label} exposed historical Session error: ${SESSION_REQUIRED_TEXT}`);
  }
  if (response.status < 200 || response.status >= 300 || response.body?.error || response.body?.result?.isError === true) {
    throw new Error(`${label} failed: HTTP ${response.status} ${safeSnippet(response.body ?? response.text, token)}`);
  }
}

function assertClose(label, actual, expected, tolerance = 0.01) {
  const actualNumber = Number(actual);
  if (!Number.isFinite(actualNumber) || Math.abs(actualNumber - expected) > tolerance) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return undefined;
  }
}

function collectProvenance(container) {
  const provenance = {
    gitSha: commandOutput("git", ["rev-parse", "HEAD"]),
    container: container ?? null
  };
  if (!container) return provenance;
  provenance.image = commandOutput("docker", ["inspect", container, "--format", "{{.Config.Image}}|{{.Image}}|{{.State.StartedAt}}"]);
  provenance.ktxVersion = commandOutput("docker", ["exec", container, "ktx", "--version"]);
  provenance.sessionKeepalivePresent = commandOutput("docker", [
    "exec",
    container,
    "node",
    "-e",
    "const fs=require('fs');const p=fs.readFileSync('/app/webui/server/proxy/mcp-proxy.ts','utf8');const s=fs.readFileSync('/app/webui/server/proxy/upstream-session.ts','utf8');process.stdout.write(String(p.includes('handshakeUpstreamSession')&&s.includes('LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE')));"
  ]) === "true";
  return provenance;
}

async function readAuditRow(container, requestId, timeoutMs = 5_000) {
  if (!container) return undefined;
  const script = [
    "const Database=require('/app/webui/node_modules/better-sqlite3');",
    "const db=new Database('/data/lucy/.ktx-ui/audit.sqlite',{readonly:true});",
    "const row=db.prepare('SELECT tool,outcome,decision_reason,error_detail FROM access_log WHERE request_id=? ORDER BY id DESC LIMIT 1').get(process.env.UAT_REQUEST_ID);",
    "process.stdout.write(JSON.stringify(row||null));"
  ].join("");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = commandOutput("docker", ["exec", "-e", `UAT_REQUEST_ID=${requestId}`, container, "node", "-e", script]);
    if (output) {
      const row = JSON.parse(output);
      if (row) return row;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}

async function writeEvidence(out, evidence) {
  const absolute = path.resolve(out);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

export async function runSessionUat(options) {
  const {
    proxyUrl,
    token,
    tokenEnv,
    connectionId,
    sourceName,
    out,
    container,
    timeoutMs = 15_000
  } = options;
  const measures = options.measures?.length
    ? options.measures
    : [`${sourceName}.order_count`, `${sourceName}.total_sales`];
  const segments = options.segments ?? (connectionId === "demo-mysql" && sourceName === "superstore_orders"
    ? [`${sourceName}.active_rows`]
    : []);
  const expectedOrderCount = options.expectedOrderCount
    ?? (connectionId === "demo-mysql" && sourceName === "superstore_orders" ? 1000 : undefined);
  const expectedTotalSales = options.expectedTotalSales
    ?? (connectionId === "demo-mysql" && sourceName === "superstore_orders" ? 1459476.0953 : undefined);
  const prefix = `mcp-session-uat-${Date.now()}`;
  const requestIds = {};
  const evidence = {
    contract: "lucy-mcp-session-regression-uat",
    generatedAt: new Date().toISOString(),
    status: "running",
    target: { proxyUrl, connectionId, sourceName, tokenEnv, tokenPresent: Boolean(token) },
    provenance: collectProvenance(container),
    checks: []
  };
  const check = (name, details = {}) => evidence.checks.push({ name, status: "pass", ...details });

  try {
    if (!token) throw new Error(`Missing UAT token in environment variable ${tokenEnv}`);
    if (container && !evidence.provenance.sessionKeepalivePresent) {
      throw new Error(`Container ${container} does not contain the upstream Session keepalive implementation`);
    }

    const unauthorized = await rpc(
      { proxyUrl, token, timeoutMs, authorized: false },
      "initialize",
      { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "lucy-session-uat", version: "1.0.0" } },
      `${prefix}-unauthorized`
    );
    if (unauthorized.status !== 401) throw new Error(`unauthorized preflight expected HTTP 401, got ${unauthorized.status}`);
    check("unauthorized_preflight", { httpStatus: unauthorized.status });

    requestIds.initialize = `${prefix}-initialize`;
    const initialize = await rpc(
      { proxyUrl, token, timeoutMs },
      "initialize",
      { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "lucy-session-uat", version: "1.0.0" } },
      requestIds.initialize
    );
    assertRpcSuccess("initialize", initialize, token);
    if (!initialize.sessionId) throw new Error("initialize did not return mcp-session-id");
    check("initialize", { httpStatus: initialize.status, sessionIdPresent: true });

    const notification = await rpc(
      { proxyUrl, token, timeoutMs },
      "notifications/initialized",
      {},
      `${prefix}-initialized-without-session`
    );
    if (notification.status < 200 || notification.status >= 300) {
      throw new Error(`notifications/initialized without Session failed: HTTP ${notification.status}`);
    }
    check("initialized_without_session", { httpStatus: notification.status });

    requestIds.catalog = `${prefix}-catalog-without-session`;
    const catalog = await rpc(
      { proxyUrl, token, timeoutMs },
      "tools/call",
      { name: "lucy_catalog", arguments: {} },
      requestIds.catalog
    );
    assertRpcSuccess("lucy_catalog without Session", catalog, token);
    const catalogText = JSON.stringify(deepParseJsonStrings(catalog.body));
    if (!catalogText.includes(connectionId) || !catalogText.includes(sourceName)) {
      throw new Error(`lucy_catalog did not expose ${connectionId}/${sourceName}`);
    }
    check("catalog_without_session", { httpStatus: catalog.status, sourceVisible: true });

    requestIds.readSource = `${prefix}-read-without-session`;
    const readSource = await rpc(
      { proxyUrl, token, timeoutMs },
      "tools/call",
      { name: "lucy_read_source", arguments: { connectionId, sourceName } },
      requestIds.readSource
    );
    assertRpcSuccess("lucy_read_source without Session", readSource, token);
    if (!JSON.stringify(deepParseJsonStrings(readSource.body)).includes(sourceName)) {
      throw new Error(`lucy_read_source response did not identify ${sourceName}`);
    }
    check("read_source_without_session", { httpStatus: readSource.status });

    const queryArguments = { connectionId, measures, limit: 5 };
    if (segments.length > 0) queryArguments.segments = segments;
    requestIds.query = `${prefix}-query-without-session`;
    const query = await rpc(
      { proxyUrl, token, timeoutMs },
      "tools/call",
      { name: "lucy_query", arguments: queryArguments },
      requestIds.query
    );
    assertRpcSuccess("lucy_query without Session", query, token);
    const orderCount = extractMetric(query.body, "order_count");
    const totalSales = extractMetric(query.body, "total_sales");
    if (expectedOrderCount !== undefined) assertClose("order_count", orderCount, expectedOrderCount, 0);
    if (expectedTotalSales !== undefined) assertClose("total_sales", totalSales, expectedTotalSales, 0.01);
    if (orderCount === undefined && totalSales === undefined) throw new Error("lucy_query returned no expected metric values");
    check("query_without_session", { httpStatus: query.status, metrics: { orderCount, totalSales } });

    const deleteStatus = await terminate({ proxyUrl, token, timeoutMs });
    if (deleteStatus < 200 || deleteStatus >= 300) throw new Error(`DELETE /mcp failed: HTTP ${deleteStatus}`);
    check("delete_held_session", { httpStatus: deleteStatus });

    requestIds.recovery = `${prefix}-query-after-delete`;
    const recovery = await rpc(
      { proxyUrl, token, timeoutMs },
      "tools/call",
      { name: "lucy_query", arguments: queryArguments },
      requestIds.recovery
    );
    assertRpcSuccess("lucy_query recovery after DELETE", recovery, token);
    if (expectedOrderCount !== undefined) assertClose("recovered order_count", extractMetric(recovery.body, "order_count"), expectedOrderCount, 0);
    const recoveryAudit = await readAuditRow(container, requestIds.recovery);
    if (container) {
      if (!recoveryAudit) throw new Error(`audit row not found for ${requestIds.recovery}`);
      if (recoveryAudit.outcome !== "ok" || recoveryAudit.decision_reason !== "upstream_session_recovered") {
        throw new Error(`recovery audit expected ok/upstream_session_recovered, got ${safeSnippet(recoveryAudit, token)}`);
      }
    }
    check("query_after_session_delete", {
      httpStatus: recovery.status,
      audit: recoveryAudit
        ? { outcome: recoveryAudit.outcome, decisionReason: recoveryAudit.decision_reason }
        : { status: "not_checked", reason: "no_container" }
    });

    requestIds.compliantInitialize = `${prefix}-compliant-initialize`;
    const compliantInitialize = await rpc(
      { proxyUrl, token, timeoutMs },
      "initialize",
      { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "lucy-session-uat-compliant", version: "1.0.0" } },
      requestIds.compliantInitialize
    );
    assertRpcSuccess("compliant initialize", compliantInitialize, token);
    if (!compliantInitialize.sessionId) throw new Error("compliant initialize did not return mcp-session-id");
    await rpc(
      { proxyUrl, token, timeoutMs, sessionId: compliantInitialize.sessionId },
      "notifications/initialized",
      {},
      `${prefix}-compliant-initialized`
    );
    const compliantRead = await rpc(
      { proxyUrl, token, timeoutMs, sessionId: compliantInitialize.sessionId },
      "tools/call",
      { name: "lucy_read_source", arguments: { connectionId, sourceName } },
      `${prefix}-compliant-read`
    );
    assertRpcSuccess("compliant lucy_read_source", compliantRead, token);
    const compliantQuery = await rpc(
      { proxyUrl, token, timeoutMs, sessionId: compliantInitialize.sessionId },
      "tools/call",
      { name: "lucy_query", arguments: queryArguments },
      `${prefix}-compliant-query`
    );
    assertRpcSuccess("compliant lucy_query", compliantQuery, token);
    if (expectedOrderCount !== undefined) assertClose("compliant order_count", extractMetric(compliantQuery.body, "order_count"), expectedOrderCount, 0);
    check("compliant_client", { readHttpStatus: compliantRead.status, queryHttpStatus: compliantQuery.status });

    evidence.status = "pass";
    evidence.completedAt = new Date().toISOString();
    evidence.requestIds = requestIds;
    await writeEvidence(out, evidence);
    return evidence;
  } catch (error) {
    evidence.status = "fail";
    evidence.completedAt = new Date().toISOString();
    evidence.failure = { message: safeSnippet(error instanceof Error ? error.message : String(error), token) };
    evidence.requestIds = requestIds;
    await writeEvidence(out, evidence);
    throw error;
  }
}

async function main() {
  let args;
  try {
    args = parseArgs();
  } catch (error) {
    console.error(`[mcp-session-uat] ${error instanceof Error ? error.message : String(error)}`);
    console.error(USAGE);
    process.exitCode = EXIT_CODES.usage;
    return;
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const token = process.env[args.tokenEnv];
  if (!token) {
    console.error(`[mcp-session-uat] missing token environment variable: ${args.tokenEnv}`);
    process.exitCode = EXIT_CODES.blocked;
    return;
  }
  try {
    const evidence = await runSessionUat({ ...args, token });
    console.log(`[mcp-session-uat] PASS checks=${evidence.checks.length} evidence=${path.resolve(args.out)}`);
  } catch (error) {
    console.error(`[mcp-session-uat] FAIL ${safeSnippet(error instanceof Error ? error.message : String(error), token)}`);
    console.error(`[mcp-session-uat] evidence=${path.resolve(args.out)}`);
    process.exitCode = EXIT_CODES.fail;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
