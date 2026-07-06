#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const DEFAULT_OUT = "inbox/p1-endpoint-evidence.json";
const REQUIRED_FORWARDING_TOOL = "lucy_read_source";
const CATALOG_TOOL = "lucy_catalog";

const { values } = parseArgs({
  options: {
    "proxy-url": { type: "string" },
    token: { type: "string" },
    connection: { type: "string", short: "c" },
    source: { type: "string", short: "s" },
    out: { type: "string", short: "o", default: DEFAULT_OUT },
    "timeout-ms": { type: "string", default: "5000" },
    help: { type: "boolean", short: "h", default: false }
  },
  allowPositionals: false
});

const USAGE = `Usage:
  node scripts/p1-endpoint-smoke.mjs \\
    --proxy-url http://127.0.0.1:7879/mcp \\
    --token "$LUCY_AGENT_TOKEN" \\
    --connection doris-r1 \\
    --source ceo_metric_snapshot

Environment fallbacks:
  proxy URL: LUCY_MCP_PROXY_URL, LUCY_PROXY_URL, LUCY_R1_PROXY_URL
  token:     LUCY_MCP_PROXY_TOKEN, LUCY_PROXY_TOKEN, LUCY_AGENT_TOKEN, LUCY_LOCAL_TOKEN, LUCY_R1_PROXY_TOKEN
  source:    LUCY_MCP_CONNECTION/LUCY_MCP_SOURCE, LUCY_ENDPOINT_CONNECTION/LUCY_ENDPOINT_SOURCE,
             LUCY_R1_CONTRACT_CONNECTION/LUCY_R1_CONTRACT_SOURCE

Writes machine-readable evidence to ${DEFAULT_OUT} by default.
Exit codes: 0 pass, 1 fail, 2 blocked/precheck.`;

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

function firstConfigured(cliName, envNames) {
  const cliValue = values[cliName];
  if (typeof cliValue === "string" && cliValue.trim()) {
    return { value: cliValue.trim(), source: `--${cliName}` };
  }
  for (const envName of envNames) {
    const value = process.env[envName];
    if (typeof value === "string" && value.trim()) {
      return { value: value.trim(), source: envName };
    }
  }
  return { value: undefined, source: undefined };
}

const proxyInput = firstConfigured("proxy-url", ["LUCY_MCP_PROXY_URL", "LUCY_PROXY_URL", "LUCY_R1_PROXY_URL"]);
const tokenInput = firstConfigured("token", ["LUCY_MCP_PROXY_TOKEN", "LUCY_PROXY_TOKEN", "LUCY_AGENT_TOKEN", "LUCY_LOCAL_TOKEN", "LUCY_R1_PROXY_TOKEN"]);
const connectionInput = firstConfigured("connection", ["LUCY_MCP_CONNECTION", "LUCY_ENDPOINT_CONNECTION", "LUCY_R1_CONTRACT_CONNECTION"]);
const sourceInput = firstConfigured("source", ["LUCY_MCP_SOURCE", "LUCY_ENDPOINT_SOURCE", "LUCY_R1_CONTRACT_SOURCE"]);
const outFile = path.resolve(String(values.out ?? DEFAULT_OUT));
const timeoutMs = Number.parseInt(String(values["timeout-ms"] ?? "5000"), 10);

const evidence = {
  contract: "p1-mcp-endpoint-lifecycle",
  target: "lucy-mcp-proxy",
  checkedAt: new Date().toISOString(),
  generatedBy: "scripts/p1-endpoint-smoke.mjs",
  status: "fail",
  proxyUrl: proxyInput.value,
  inputs: {
    proxyUrl: { present: Boolean(proxyInput.value), source: proxyInput.source },
    token: { present: Boolean(tokenInput.value), source: tokenInput.source, redacted: true },
    connectionId: { value: connectionInput.value, source: connectionInput.source },
    sourceName: { value: sourceInput.value, source: sourceInput.source }
  },
  checks: {
    precheck: "fail",
    reachable: "skip",
    initialize: "skip",
    toolsList: "skip",
    keyToolForwarding: "skip"
  },
  checkDetails: {}
};

function setCheck(name, status, detail = {}) {
  evidence.checks[name] = status;
  evidence.checkDetails[name] = {
    ...(evidence.checkDetails[name] ?? {}),
    ...detail,
    status
  };
}

function deriveStatus() {
  const statuses = Object.values(evidence.checks);
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("blocked")) return "blocked";
  return "pass";
}

function exitCodeFor(status) {
  if (status === "pass") return 0;
  if (status === "blocked") return 2;
  return 1;
}

function tail(value, max = 2500) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > max ? text.slice(text.length - max) : text;
}

async function writeEvidence() {
  evidence.status = deriveStatus();
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(evidence, null, 2)}\n`);
}

function parseRpcBody(text) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("event:")) return JSON.parse(trimmed);
  const line = trimmed.split("\n").find((item) => item.startsWith("data: "));
  if (!line) throw new Error("SSE response does not contain a data line");
  return JSON.parse(line.slice(6));
}

async function rpc(sessionId, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000);
  try {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${tokenInput.value}`
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const response = await fetch(proxyInput.value, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params })
    });
    const text = await response.text();
    let body;
    try {
      body = parseRpcBody(text);
    } catch (error) {
      body = { parseError: error instanceof Error ? error.message : String(error), raw: tail(text) };
    }
    return {
      ok: response.ok,
      status: response.status,
      sessionId: response.headers.get("mcp-session-id"),
      body,
      text
    };
  } finally {
    clearTimeout(timer);
  }
}

function toolNames(body) {
  return (body?.result?.tools ?? []).map((tool) => tool?.name).filter((name) => typeof name === "string").sort();
}

function isErrorResult(body) {
  return Boolean(body?.error || body?.result?.isError === true);
}

function findLucyMeta(value, depth = 0) {
  if (!value || depth > 8) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findLucyMeta(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const record = value;
  const meta = record._meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta) && meta.lucy && typeof meta.lucy === "object" && !Array.isArray(meta.lucy)) {
    return meta.lucy;
  }
  for (const nested of Object.values(record)) {
    const found = findLucyMeta(nested, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function parseJsonStrings(value, depth = 0) {
  if (depth > 6) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
    try {
      return parseJsonStrings(JSON.parse(trimmed), depth + 1);
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map((item) => parseJsonStrings(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, parseJsonStrings(item, depth + 1)]));
}

function findFirstCatalogSource(value, preferredConnection, preferredSource, depth = 0) {
  if (!value || depth > 10) return undefined;
  const expanded = parseJsonStrings(value, depth);
  if (Array.isArray(expanded)) {
    for (const item of expanded) {
      const found = findFirstCatalogSource(item, preferredConnection, preferredSource, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof expanded !== "object") return undefined;
  const record = expanded;
  if (typeof record.connectionId === "string" && typeof record.sourceName === "string") {
    const connectionMatches = !preferredConnection || record.connectionId === preferredConnection;
    const sourceMatches = !preferredSource || record.sourceName === preferredSource;
    if (connectionMatches && sourceMatches) {
      return { connectionId: record.connectionId, sourceName: record.sourceName, table: record.table, schema: record.schema };
    }
  }
  for (const nested of Object.values(record)) {
    const found = findFirstCatalogSource(nested, preferredConnection, preferredSource, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function missingPrecheckInputs() {
  const missing = [];
  if (!proxyInput.value) missing.push("proxy_url");
  if (!tokenInput.value) missing.push("token");
  if (proxyInput.value) {
    try {
      new URL(proxyInput.value);
    } catch {
      missing.push("valid_proxy_url");
    }
  }
  return missing;
}

async function chooseForwardingTarget(sessionId, names) {
  if (connectionInput.value && sourceInput.value) {
    return {
      connectionId: connectionInput.value,
      sourceName: sourceInput.value,
      source: "explicit"
    };
  }
  if (!names.includes(CATALOG_TOOL)) return undefined;
  const catalog = await rpc(sessionId, "tools/call", {
    name: CATALOG_TOOL,
    arguments: {}
  });
  const selected = catalog.ok && !isErrorResult(catalog.body)
    ? findFirstCatalogSource(catalog.body, connectionInput.value, sourceInput.value)
    : undefined;
  setCheck("keyToolForwarding", selected ? "skip" : "blocked", {
    catalogProbe: {
      httpStatus: catalog.status,
      attempted: true,
      selected,
      response: tail(catalog.body)
    }
  });
  if (!selected) return undefined;
  return {
    connectionId: selected.connectionId,
    sourceName: selected.sourceName,
    source: "lucy_catalog"
  };
}

async function finishWithLog(message) {
  await writeEvidence();
  console.error(message);
  console.error(`[p1-endpoint-smoke] evidence: ${outFile}`);
  process.exit(exitCodeFor(evidence.status));
}

async function main() {
  const missing = missingPrecheckInputs();
  if (missing.length > 0) {
    setCheck("precheck", "blocked", {
      phase: "precheck",
      reason: "missing_or_invalid_endpoint_inputs",
      missing,
      message: "Set proxy URL and token before running endpoint lifecycle smoke."
    });
    await finishWithLog(`[p1-endpoint-smoke] BLOCKED precheck: ${missing.join(", ")}`);
  }
  setCheck("precheck", "pass", {
    proxyUrlSource: proxyInput.source,
    tokenSource: tokenInput.source,
    connectionSource: connectionInput.source,
    sourceSource: sourceInput.source
  });

  let init;
  try {
    init = await rpc("", "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "p1-endpoint-smoke", version: "0.1.0" }
    });
  } catch (error) {
    setCheck("reachable", "blocked", {
      phase: "precheck",
      reason: "proxy_unreachable",
      message: error instanceof Error ? error.message : String(error)
    });
    await finishWithLog("[p1-endpoint-smoke] BLOCKED precheck: proxy_unreachable");
  }

  setCheck("reachable", "pass", {
    httpStatus: init.status,
    message: "Proxy endpoint returned an HTTP response."
  });
  setCheck("initialize", init.ok && !init.body?.error && Boolean(init.sessionId) ? "pass" : "fail", {
    httpStatus: init.status,
    sessionIdPresent: Boolean(init.sessionId),
    response: tail(init.body)
  });
  if (evidence.checks.initialize !== "pass") {
    await finishWithLog("[p1-endpoint-smoke] FAIL: initialize/auth did not complete");
  }

  await rpc(init.sessionId, "notifications/initialized", {}).catch(() => undefined);

  const list = await rpc(init.sessionId, "tools/list", {});
  const names = toolNames(list.body);
  setCheck("toolsList", list.ok && !list.body?.error && Array.isArray(list.body?.result?.tools) ? "pass" : "fail", {
    httpStatus: list.status,
    toolCount: names.length,
    tools: names,
    hasCatalogTool: names.includes(CATALOG_TOOL),
    hasForwardingTool: names.includes(REQUIRED_FORWARDING_TOOL),
    response: names.length > 0 ? undefined : tail(list.body)
  });
  if (evidence.checks.toolsList !== "pass") {
    await finishWithLog("[p1-endpoint-smoke] FAIL: tools/list did not complete");
  }

  if (!names.includes(REQUIRED_FORWARDING_TOOL)) {
    setCheck("keyToolForwarding", "fail", {
      reason: "required_forwarding_tool_not_visible",
      requiredTool: REQUIRED_FORWARDING_TOOL,
      tools: names
    });
    await finishWithLog("[p1-endpoint-smoke] FAIL: lucy_read_source is not visible to this token");
  }

  const target = await chooseForwardingTarget(init.sessionId, names);
  if (!target) {
    setCheck("keyToolForwarding", "blocked", {
      ...(evidence.checkDetails.keyToolForwarding ?? {}),
      phase: "precheck",
      reason: "forwarding_target_unavailable",
      message: "Provide --connection and --source, or use a token whose lucy_catalog exposes at least one source."
    });
    await finishWithLog("[p1-endpoint-smoke] BLOCKED precheck: forwarding_target_unavailable");
  }

  const readSource = await rpc(init.sessionId, "tools/call", {
    name: REQUIRED_FORWARDING_TOOL,
    arguments: {
      connectionId: target.connectionId,
      sourceName: target.sourceName
    }
  });
  const lucyMeta = findLucyMeta(readSource.body);
  const forwardingPassed = readSource.ok
    && !isErrorResult(readSource.body)
    && lucyMeta?.tool === REQUIRED_FORWARDING_TOOL
    && lucyMeta?.upstreamTool === "sl_read_source";
  setCheck("keyToolForwarding", forwardingPassed ? "pass" : "fail", {
    ...(evidence.checkDetails.keyToolForwarding ?? {}),
    httpStatus: readSource.status,
    tool: REQUIRED_FORWARDING_TOOL,
    target,
    hasLucyMeta: Boolean(lucyMeta),
    lucyTool: lucyMeta?.tool,
    upstreamTool: lucyMeta?.upstreamTool,
    response: tail(readSource.body)
  });

  await writeEvidence();
  const status = evidence.status.toUpperCase();
  console.log(`[p1-endpoint-smoke] ${status}`);
  console.log(`[p1-endpoint-smoke] evidence: ${outFile}`);
  process.exit(exitCodeFor(evidence.status));
}

await main();
