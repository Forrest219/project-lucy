#!/usr/bin/env node
import { accessSync, chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_OUT = "inbox/p1-agent-e2e-evidence.json";
const DEFAULT_ARTIFACTS = "inbox/p1-agent-e2e-artifacts";
const DEFAULT_HTML_REPORT = "inbox/p1-agent-e2e-report.html";
const DEFAULT_PROXY_URL = process.env.LUCY_E2E_PROXY_URL || "http://127.0.0.1:7879/mcp";

const EXIT_CODES = {
  pass: 0,
  fail: 1,
  usage: 2,
  blocked: 42
};

const CASE_SPECS = {
  "superstore-ordercount-002": {
    suite: "superstore",
    path: "evals/superstore/eval/superstore-eval-cases.yaml"
  },
  "kx-income-001": {
    suite: "kx_financial",
    path: "evals/kx_financial/eval/kx_financial-eval-cases.yaml"
  },
  "data_agent_poc-timezone-utc-display-001": {
    suite: "data_agent_poc",
    path: "evals/data_agent_poc/eval/data_agent_poc-eval-cases.yaml"
  }
};

const DIRECT_CASES = {
  superstore: {
    id: "direct-superstore-ordercount",
    connectionId: "mysql-aliyun",
    readSources: ["superstore_orders"],
    tool: "lucy_query",
    args: {
      connectionId: "mysql-aliyun",
      measures: ["superstore_orders.order_count", "superstore_orders.total_sales"],
      limit: 5
    },
    requiredPhrases: ["5083", "16867374"]
  },
  kx: {
    id: "direct-kx-income-ytd",
    connectionId: "mysql-aliyun",
    readSources: ["kx_vw_income_statement_detail"],
    tool: "lucy_query",
    args: {
      connectionId: "mysql-aliyun",
      sourceName: "kx_vw_income_statement_detail",
      measures: ["kx_vw_income_statement_detail.营业收入_本年累计"],
      dimensions: [{ field: "kx_vw_income_statement_detail.报表期间" }],
      limit: 20
    },
    requiredPhrases: ["69339.62"]
  },
  poc: {
    id: "direct-poc-ad-revenue",
    connectionId: "poc-mysql-aliyun",
    readSources: ["poc_ceo_metric_snapshot", "poc_ad_revenue_daily"],
    tool: "lucy_query",
    args: {
      connectionId: "poc-mysql-aliyun",
      measures: ["poc_ad_revenue_daily.ad_revenue"],
      dimensions: [{ field: "poc_ad_revenue_daily.dt" }],
      filters: [{ field: "poc_ad_revenue_daily.dt", op: "=", value: "2026-05-31" }],
      limit: 5
    },
    requiredPhrases: ["196314.31"]
  },
  huadong: {
    id: "direct-superstore-huadong",
    connectionId: "mysql-aliyun",
    readSources: ["superstore_orders_huadong"],
    tool: "lucy_query",
    args: {
      connectionId: "mysql-aliyun",
      measures: ["superstore_orders_huadong.order_count", "superstore_orders_huadong.total_sales"],
      limit: 5
    },
    requiredPhrases: []
  }
};

const ROLE_CASES = {
  local_dev_full_access: {
    visible: ["superstore_orders", "kx_vw_income_statement_detail", "poc_ceo_metric_snapshot"],
    tools: ["lucy_catalog", "lucy_read_source", "lucy_query", "wiki_search", "wiki_read"],
    direct: ["superstore", "kx", "poc"],
    agent: ["superstore-ordercount-002", "kx-income-001", "data_agent_poc-timezone-utc-display-001"],
    wiki: {
      required: [
        { query: "KX 财务", contains: ["kx-financial-analysis-playbook"] },
        { query: "superstore", contains: ["superstore-analysis-playbook"] },
        { query: "data_agent_poc", contains: ["poc-data-agent-playbook"] }
      ],
      deny: []
    },
    deny: []
  },
  kx_readonly: {
    visible: ["kx_vw_income_statement_detail"],
    tools: ["lucy_catalog", "lucy_read_source", "lucy_query", "wiki_search", "wiki_read"],
    direct: ["kx"],
    agent: ["kx-income-001"],
    wiki: {
      required: [
        { query: "KX 财务", contains: ["kx-financial-analysis-playbook"] }
      ],
      deny: [
        { query: "superstore", forbids: ["superstore-analysis-playbook"], readKey: "global/superstore-analysis-playbook.md" },
        { query: "data_agent_poc", forbids: ["poc-data-agent-playbook"], readKey: "global/poc-data-agent-playbook.md" }
      ]
    },
    deny: [
      { connectionId: "mysql-aliyun", sourceName: "superstore_orders" },
      { connectionId: "poc-mysql-aliyun", sourceName: "poc_ceo_metric_snapshot" }
    ]
  },
  superstore_region_huadong: {
    visible: ["superstore_orders_huadong"],
    tools: ["lucy_catalog", "lucy_read_source", "lucy_query"],
    direct: ["huadong"],
    agent: ["superstore-ordercount-002"],
    wiki: {
      required: [],
      deny: [
        { query: "KX 财务", forbids: ["kx-financial-analysis-playbook"], readKey: "global/kx-financial-analysis-playbook.md" },
        { query: "data_agent_poc", forbids: ["poc-data-agent-playbook"], readKey: "global/poc-data-agent-playbook.md" }
      ]
    },
    deny: [
      { connectionId: "mysql-aliyun", sourceName: "superstore_orders" },
      { connectionId: "poc-mysql-aliyun", sourceName: "poc_ceo_metric_snapshot" }
    ]
  }
};

const PROFILE_DEFAULTS = {
  main: {
    id: "main",
    label: "main process",
    tokenEnv: "LUCY_E2E_MAIN_TOKEN",
    expectedRole: "local_dev_full_access"
  },
  hermes: {
    id: "hermes",
    label: "Hermes",
    tokenEnv: "LUCY_E2E_HERMES_TOKEN",
    expectedRole: "kx_readonly"
  },
  moz: {
    id: "moz",
    label: "moz",
    tokenEnv: "LUCY_E2E_MOZ_TOKEN",
    expectedRoleEnv: "LUCY_E2E_MOZ_EXPECTED_ROLE"
  }
};

const DEFAULT_AGENT_COMMANDS = {
  main: [
    "claude",
    "-p",
    "{prompt}",
    "--output-format",
    "stream-json",
    "--mcp-config",
    "{mcpConfig}",
    "--strict-mcp-config",
    "--permission-mode",
    "bypassPermissions"
  ],
  hermes: ["hermes", "chat", "-q", "{prompt}", "--quiet", "--source", "lucy-e2e", "--max-turns", "30"]
};

const USAGE = `Usage:
  npm run e2e:agent
  npm run e2e:agent -- --dry-run
  npm run e2e:agent -- --profile main --profile hermes
  npm run smoke:p1:agent-e2e
  npm run smoke:p1:agent-e2e -- --dry-run
  npm run smoke:p1:agent-e2e -- --profile main --profile hermes

Note:
  The e2e:* commands are the canonical database-to-agent E2E gates. The smoke:* names are
  compatibility aliases and must not be used to downgrade real-agent validation into stub-only tests.

Options:
  --profile <id>            Profile to run: main, hermes, moz. Repeatable. Defaults to all three.
  --proxy-url <url>         Lucy MCP Proxy URL. Defaults to LUCY_E2E_PROXY_URL or ${DEFAULT_PROXY_URL}.
  --out <path>              Evidence JSON path. Defaults to ${DEFAULT_OUT}.
  --artifacts <dir>         Redacted artifact dir. Defaults to ${DEFAULT_ARTIFACTS}.
  --html-report <path>      Human-readable HTML report path. Defaults to ${DEFAULT_HTML_REPORT}.
  --timeout-ms <n>          MCP request timeout. Defaults to 10000.
  --agent-timeout-ms <n>    Agent subprocess timeout. Defaults to 600000.
  --dry-run                 Parse cases and command templates without calling MCP or agents.
  --help                    Show this help.

Environment:
  LUCY_E2E_MAIN_TOKEN, LUCY_E2E_HERMES_TOKEN, LUCY_E2E_MOZ_TOKEN
  LUCY_E2E_MOZ_EXPECTED_ROLE
  LUCY_E2E_AGENT_COMMANDS  JSON object mapping profile id to command argv array.

Exit codes: 0 pass, 1 fail, 2 usage/config parse error, 42 blocked.`;

function parseArgs(argv = process.argv) {
  const args = {
    profiles: [],
    proxyUrl: DEFAULT_PROXY_URL,
    out: DEFAULT_OUT,
    artifacts: DEFAULT_ARTIFACTS,
    htmlReport: DEFAULT_HTML_REPORT,
    timeoutMs: 10_000,
    agentTimeoutMs: 600_000,
    dryRun: false,
    help: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--profile":
        args.profiles.push(requiredValue(argv, ++i, "--profile"));
        break;
      case "--proxy-url":
        args.proxyUrl = requiredValue(argv, ++i, "--proxy-url");
        break;
      case "--out":
        args.out = requiredValue(argv, ++i, "--out");
        break;
      case "--artifacts":
        args.artifacts = requiredValue(argv, ++i, "--artifacts");
        break;
      case "--html-report":
        args.htmlReport = requiredValue(argv, ++i, "--html-report");
        break;
      case "--timeout-ms":
        args.timeoutMs = parsePositiveInt(requiredValue(argv, ++i, "--timeout-ms"), "--timeout-ms");
        break;
      case "--agent-timeout-ms":
        args.agentTimeoutMs = parsePositiveInt(requiredValue(argv, ++i, "--agent-timeout-ms"), "--agent-timeout-ms");
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`unknown arg: ${arg}`);
    }
  }

  if (args.profiles.length === 0) args.profiles = ["main", "hermes", "moz"];
  for (const profile of args.profiles) {
    if (!PROFILE_DEFAULTS[profile]) throw new Error(`unknown profile: ${profile}`);
  }
  new URL(args.proxyUrl);
  return args;
}

function requiredValue(argv, index, label) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${label} requires a value`);
  return value;
}

function parsePositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function loadAgentCommands(env = process.env) {
  const configured = env.LUCY_E2E_AGENT_COMMANDS?.trim();
  if (!configured) return { ...DEFAULT_AGENT_COMMANDS };
  let parsed;
  try {
    parsed = JSON.parse(configured);
  } catch (error) {
    throw new Error(`LUCY_E2E_AGENT_COMMANDS must be valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LUCY_E2E_AGENT_COMMANDS must be a JSON object");
  }
  const commands = { ...DEFAULT_AGENT_COMMANDS };
  for (const [profile, command] of Object.entries(parsed)) {
    if (!Array.isArray(command) || command.some((part) => typeof part !== "string" || part.length === 0)) {
      throw new Error(`LUCY_E2E_AGENT_COMMANDS.${profile} must be a non-empty string array`);
    }
    commands[profile] = command;
  }
  return commands;
}

function loadEvalCase(caseId) {
  const spec = CASE_SPECS[caseId];
  if (!spec) throw new Error(`unknown e2e case id: ${caseId}`);
  const abs = resolve(REPO_ROOT, spec.path);
  const raw = readFileSync(abs, "utf8");
  const doc = parseYaml(raw);
  const cases = Array.isArray(doc?.cases) ? doc.cases : [];
  const found = cases.find((item) => item?.id === caseId);
  if (!found) throw new Error(`case ${caseId} not found in ${spec.path}`);
  return { ...found, suite: spec.suite, casesPath: spec.path };
}

function resolveProfiles(profileIds, env = process.env) {
  return profileIds.map((id) => {
    const base = PROFILE_DEFAULTS[id];
    const expectedRole = base.expectedRoleEnv ? env[base.expectedRoleEnv] : base.expectedRole;
    return {
      ...base,
      expectedRole,
      tokenPresent: Boolean(env[base.tokenEnv]),
      token: env[base.tokenEnv] || ""
    };
  });
}

function checkProfilePlan(profile) {
  if (!profile.expectedRole) {
    return {
      status: "blocked",
      reason: "missing_expected_role",
      message: `${profile.id} requires ${profile.expectedRoleEnv}`
    };
  }
  const rolePlan = ROLE_CASES[profile.expectedRole];
  if (!rolePlan) {
    return {
      status: "blocked",
      reason: "unsupported_expected_role",
      message: `${profile.id} role ${profile.expectedRole} is not supported by this E2E runner`
    };
  }
  return { status: "ok", rolePlan };
}

function textOf(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function normalizeText(value) {
  return textOf(value)
    .toLowerCase()
    .replace(/[\s　\-_—–，。！？：；、（）()【】[\]「」『』""''《》<>·,!?:;().<>/\\|`~@#$%^&*=+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stringIncludesLoose(haystack, needle) {
  const raw = textOf(haystack);
  const target = textOf(needle);
  if (raw.includes(target)) return true;
  const strippedRaw = raw.replace(/,/g, "");
  const strippedTarget = target.replace(/,/g, "");
  if (strippedRaw.includes(strippedTarget)) return true;
  return normalizeText(raw).includes(normalizeText(target));
}

function collectPrimitivePhrases(value, out = []) {
  if (value == null) return out;
  if (typeof value === "string" || typeof value === "number") {
    const phrase = String(value);
    if (phrase.trim() && phrase !== "null") out.push(phrase);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPrimitivePhrases(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectPrimitivePhrases(item, out);
  }
  return out;
}

function assertionsFromCase(testCase) {
  const required = [];
  const forbidden = [];
  for (const assertion of testCase.result_assertions || []) {
    const data = assertion?.data || {};
    const explicitRequired = Array.isArray(data.required_phrases) || Array.isArray(data.must_mention);
    const explicitForbidden = Array.isArray(data.forbidden_phrases) || Array.isArray(data.must_not_mention);
    for (const field of ["required_phrases", "must_mention"]) {
      if (Array.isArray(data[field])) required.push(...data[field].map(String));
    }
    for (const field of ["forbidden_phrases", "must_not_mention"]) {
      if (Array.isArray(data[field])) forbidden.push(...data[field].map(String));
    }
    if (!explicitRequired && !explicitForbidden) {
      required.push(...collectPrimitivePhrases(data).filter((phrase) => phrase.length <= 80));
    }
  }
  return {
    required: Array.from(new Set(required.filter(Boolean))),
    forbidden: Array.from(new Set(forbidden.filter(Boolean)))
  };
}

function checkTextAssertions(finalText, assertions) {
  const missing = assertions.required.filter((phrase) => !stringIncludesLoose(finalText, phrase));
  const forbiddenHits = assertions.forbidden.filter((phrase) => stringIncludesLoose(finalText, phrase));
  return {
    ok: missing.length === 0 && forbiddenHits.length === 0,
    missing,
    forbiddenHits
  };
}

function parseRpcBody(text) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("event:")) return JSON.parse(trimmed);
  const line = trimmed.split("\n").find((item) => item.startsWith("data: "));
  if (!line) throw new Error("SSE response does not contain a data line");
  return JSON.parse(line.slice(6));
}

function tail(value, max = 2500) {
  const text = textOf(value);
  return text.length > max ? text.slice(text.length - max) : text;
}

async function rpc({ proxyUrl, token, timeoutMs, sessionId }, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const response = await fetch(proxyUrl, {
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

function parseJsonStrings(value, depth = 0) {
  if (depth > 8) return value;
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

function findSources(value, depth = 0, out = []) {
  if (!value || depth > 12) return out;
  const expanded = parseJsonStrings(value, depth);
  if (Array.isArray(expanded)) {
    for (const item of expanded) findSources(item, depth + 1, out);
    return out;
  }
  if (typeof expanded !== "object") return out;
  if (typeof expanded.connectionId === "string" && typeof expanded.sourceName === "string") {
    out.push({ connectionId: expanded.connectionId, sourceName: expanded.sourceName });
  }
  for (const nested of Object.values(expanded)) findSources(nested, depth + 1, out);
  return out;
}

function hasSource(catalogBody, sourceName) {
  return findSources(catalogBody).some((source) => source.sourceName === sourceName);
}

function responseContains(body, phrases = []) {
  const text = textOf(parseJsonStrings(body));
  return phrases.every((phrase) => stringIncludesLoose(text, phrase));
}

function responseForbids(body, phrases = []) {
  const text = textOf(parseJsonStrings(body));
  return phrases.every((phrase) => !stringIncludesLoose(text, phrase));
}

async function runDirectMcpProfile(profile, rolePlan, args) {
  const checks = [];
  const client = { proxyUrl: args.proxyUrl, token: profile.token, timeoutMs: args.timeoutMs };
  let sessionId = "";

  let init;
  try {
    init = await rpc(client, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "p1-agent-e2e", version: "0.1.0" }
    });
  } catch (error) {
    return {
      status: "blocked",
      checks: [{ name: "initialize", status: "blocked", reason: "proxy_unreachable", message: error.message }]
    };
  }
  sessionId = init.sessionId || "";
  checks.push({
    name: "initialize",
    status: init.ok && sessionId && !init.body?.error ? "pass" : "fail",
    httpStatus: init.status,
    sessionIdPresent: Boolean(sessionId),
    response: init.ok ? undefined : tail(init.body)
  });
  if (checks.at(-1).status !== "pass") return { status: "fail", checks };

  await rpc({ ...client, sessionId }, "notifications/initialized", {}).catch(() => undefined);

  const list = await rpc({ ...client, sessionId }, "tools/list", {});
  const tools = toolNames(list.body);
  const requiredTools = rolePlan.tools || ["lucy_catalog", "lucy_read_source", "lucy_query"];
  const missingTools = requiredTools.filter((name) => !tools.includes(name));
  checks.push({
    name: "tools_list",
    status: list.ok && !list.body?.error && missingTools.length === 0 ? "pass" : "fail",
    httpStatus: list.status,
    tools,
    missingTools
  });
  if (checks.at(-1).status !== "pass") return { status: "fail", checks };

  const catalog = await rpc({ ...client, sessionId }, "tools/call", { name: "lucy_catalog", arguments: {} });
  const missingSources = rolePlan.visible.filter((sourceName) => !hasSource(catalog.body, sourceName));
  checks.push({
    name: "lucy_catalog",
    status: catalog.ok && !isErrorResult(catalog.body) && missingSources.length === 0 ? "pass" : "fail",
    httpStatus: catalog.status,
    expectedSources: rolePlan.visible,
    missingSources,
    sourceCount: findSources(catalog.body).length
  });
  if (checks.at(-1).status !== "pass") return { status: "fail", checks };

  const wikiPlan = rolePlan.wiki || {
    required: [{ query: profile.expectedRole === "kx_readonly" ? "KX 财务" : "playbook semantic layer", contains: [] }],
    deny: []
  };
  if (!tools.includes("wiki_search") && (wikiPlan.required.length > 0 || wikiPlan.deny.length > 0)) {
    checks.push({
      name: "wiki_search:tool_visible",
      status: "fail",
      reason: "required_context_tool_not_visible",
      role: profile.expectedRole
    });
    return { status: "fail", checks };
  }

  for (const wikiCase of wikiPlan.required) {
    const wiki = await rpc({ ...client, sessionId }, "tools/call", {
      name: "wiki_search",
      arguments: { query: wikiCase.query, limit: 5 }
    });
    const passed = wiki.ok && !isErrorResult(wiki.body) && responseContains(wiki.body, wikiCase.contains || []);
    checks.push({
      name: `wiki_search:allow:${wikiCase.query}`,
      status: passed ? "pass" : "fail",
      httpStatus: wiki.status,
      requiredPhrases: wikiCase.contains || [],
      response: tail(wiki.body, 1200)
    });
    if (!passed) return { status: "fail", checks };
  }

  for (const wikiCase of wikiPlan.deny) {
    if (tools.includes("wiki_search")) {
      const wiki = await rpc({ ...client, sessionId }, "tools/call", {
        name: "wiki_search",
        arguments: { query: wikiCase.query, limit: 5 }
      });
      const passed = wiki.ok && !isErrorResult(wiki.body) && responseForbids(wiki.body, wikiCase.forbids || []);
      checks.push({
        name: `wiki_search:deny:${wikiCase.query}`,
        status: passed ? "pass" : "fail",
        httpStatus: wiki.status,
        forbiddenPhrases: wikiCase.forbids || [],
        response: tail(wiki.body, 1200)
      });
      if (!passed) return { status: "fail", checks };
    }
    if (tools.includes("wiki_read") && wikiCase.readKey) {
      const read = await rpc({ ...client, sessionId }, "tools/call", {
        name: "wiki_read",
        arguments: { key: wikiCase.readKey }
      });
      checks.push({
        name: `wiki_read:deny:${wikiCase.readKey}`,
        status: read.ok && isErrorResult(read.body) && responseForbids(read.body, wikiCase.forbids || []) ? "pass" : "fail",
        httpStatus: read.status,
        forbiddenPhrases: wikiCase.forbids || [],
        response: tail(read.body, 1200)
      });
      if (checks.at(-1).status !== "pass") return { status: "fail", checks };
    }
  }

  for (const directId of rolePlan.direct) {
    const direct = DIRECT_CASES[directId];
    for (const sourceName of direct.readSources) {
      const read = await rpc({ ...client, sessionId }, "tools/call", {
        name: "lucy_read_source",
        arguments: { connectionId: direct.connectionId, sourceName }
      });
      checks.push({
        name: `${direct.id}:read:${sourceName}`,
        status: read.ok && !isErrorResult(read.body) ? "pass" : "fail",
        httpStatus: read.status,
        sourceName,
        response: read.ok ? undefined : tail(read.body)
      });
      if (checks.at(-1).status !== "pass") return { status: "fail", checks };
    }
    const query = await rpc({ ...client, sessionId }, "tools/call", {
      name: direct.tool,
      arguments: direct.args
    });
    const passed = query.ok && !isErrorResult(query.body) && responseContains(query.body, direct.requiredPhrases);
    checks.push({
      name: `${direct.id}:query`,
      status: passed ? "pass" : "fail",
      httpStatus: query.status,
      requiredPhrases: direct.requiredPhrases,
      response: tail(query.body)
    });
    if (!passed) return { status: "fail", checks };
  }

  for (const denied of rolePlan.deny) {
    const result = await rpc({ ...client, sessionId }, "tools/call", {
      name: "lucy_read_source",
      arguments: denied
    });
    checks.push({
      name: `deny:${denied.sourceName}`,
      status: !result.ok || isErrorResult(result.body) ? "pass" : "fail",
      httpStatus: result.status,
      denied,
      response: tail(result.body)
    });
    if (checks.at(-1).status !== "pass") return { status: "fail", checks };
  }

  return { status: checks.every((check) => check.status === "pass" || check.status === "skip") ? "pass" : "fail", checks };
}

function commandUsesMcpConfig(command = []) {
  return command.some((part) => part.includes("{mcpConfig}"));
}

function buildMcpConfig(profile, args, artifactsDir) {
  const configPath = resolve(artifactsDir, `mcp-${profile.id}-${process.pid}.json`);
  const config = {
    mcpServers: {
      lucy: {
        type: "http",
        url: args.proxyUrl,
        headers: { Authorization: `Bearer ${profile.token}` }
      }
    }
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(configPath, 0o600);
  return configPath;
}

function renderPrompt(profile, testCase) {
  const kxHint = testCase.domain === "kx_financial"
    ? [
        "",
        "KX 财务 case 的可复现工具路径：",
        "1. 调用 lucy_read_source，参数为 {\"connectionId\":\"mysql-aliyun\",\"sourceName\":\"kx_vw_income_statement_detail\"}。",
        "2. 调用 lucy_query，参数必须使用已发布的 source-qualified semantic measure 字符串，避免临时 {expr,name} 对象在 agent transport 中被丢弃：",
        "{\"connectionId\":\"mysql-aliyun\",\"sourceName\":\"kx_vw_income_statement_detail\",\"measures\":[\"kx_vw_income_statement_detail.营业收入_本年累计\"],\"dimensions\":[{\"field\":\"kx_vw_income_statement_detail.报表期间\"}],\"limit\":20}",
        "3. 只要 lucy_query 返回 rows，就立刻在返回行中定位 report_period / 报表期间 = 202605，并回答一、营业收入的本年累计金额。",
        "4. 禁止在成功返回 rows 后继续改用 {expr,name}、{name}、{$text} 或其它 measure 形态重试；这些重试会污染 E2E 结果。"
      ]
    : [];
  return [
    "你正在执行 Project Lucy P1 agent E2E 验证。",
    "必须通过可见的 Lucy MCP 工具检索数据库数据后再回答；如果 wiki/context 工具可见，也要先检索相关上下文。不要凭记忆、不要编造。",
    "最终答案请包含：结论、关键数值、使用的数据源或 source、关键过滤条件。",
    `当前 profile: ${profile.id}; expected role: ${profile.expectedRole}。`,
    `Case id: ${testCase.id}`,
    `问题：${testCase.question}`,
    ...kxHint
  ].join("\n");
}

function renderCommand(command, replacements) {
  return command.map((part) => part.replaceAll("{prompt}", replacements.prompt)
    .replaceAll("{mcpConfig}", replacements.mcpConfig)
    .replaceAll("{profile}", replacements.profile)
    .replaceAll("{caseId}", replacements.caseId));
}

function checkCommandExecutable(command) {
  const binary = command[0];
  if (!binary) return { ok: false, reason: "empty_command" };
  if (binary.includes("/")) {
    try {
      accessSync(binary);
      return { ok: true, binary };
    } catch (error) {
      return { ok: false, reason: "binary_not_accessible", binary, error: error.message };
    }
  }
  return { ok: true, binary, reason: "path_lookup_deferred" };
}

function runCommand(command, commandArgs, { cwd = REPO_ROOT, env = process.env, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: null, signal: "SIGTERM", stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, signal: null, stdout, stderr: `${stderr}\n${error.message}`, error: error.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function parseAgentFinalText(stdout, stderr = "") {
  const lines = String(stdout).split("\n").filter((line) => line.trim());
  const results = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event?.type === "result" && typeof event.result === "string") results.push(event.result);
      if (event?.type === "assistant" && Array.isArray(event.message?.content)) {
        for (const block of event.message.content) {
          if (block?.type === "text" && typeof block.text === "string") results.push(block.text);
        }
      }
    } catch {
      // Plain-text agents are allowed.
    }
  }
  if (results.length > 0) return results.at(-1);
  return `${stdout}\n${stderr}`.trim();
}

async function runAgentProfile(profile, rolePlan, args, agentCommands, artifactsDir) {
  const commandTemplate = agentCommands[profile.id];
  if (!commandTemplate) {
    return {
      status: "blocked",
      checks: [{ name: "agent_command", status: "blocked", reason: "missing_agent_command", profile: profile.id }]
    };
  }
  const executable = checkCommandExecutable(commandTemplate);
  if (!executable.ok) {
    return {
      status: "blocked",
      checks: [{ name: "agent_command", status: "blocked", ...executable }]
    };
  }

  const checks = [{ name: "agent_command", status: "pass", binary: executable.binary, usesMcpConfig: commandUsesMcpConfig(commandTemplate) }];
  const mcpConfig = commandUsesMcpConfig(commandTemplate) ? buildMcpConfig(profile, args, artifactsDir) : "";
  try {
    for (const caseId of rolePlan.agent) {
      const testCase = loadEvalCase(caseId);
      const prompt = renderPrompt(profile, testCase);
      const rendered = renderCommand(commandTemplate, {
        prompt,
        mcpConfig,
        profile: profile.id,
        caseId
      });
      const [command, ...commandArgs] = rendered;
      const startedAt = new Date().toISOString();
      const result = await runCommand(command, commandArgs, { timeoutMs: args.agentTimeoutMs });
      const finishedAt = new Date().toISOString();
      const finalText = parseAgentFinalText(result.stdout, result.stderr);
      const assertions = assertionsFromCase(testCase);
      const assertionResult = checkTextAssertions(finalText, assertions);
      const artifactPath = resolve(artifactsDir, `${profile.id}-${caseId}.json`);
      writeFileSync(artifactPath, `${JSON.stringify(redactValue({
        profile: profile.id,
        caseId,
        startedAt,
        finishedAt,
        command: [basename(command), ...commandArgs.map((arg) => arg === prompt ? "{prompt}" : arg === mcpConfig ? "{mcpConfig}" : arg)],
        exitCode: result.code,
        signal: result.signal,
        timedOut: Boolean(result.timedOut),
        stdout: result.stdout,
        stderr: result.stderr,
        finalText,
        assertions: assertionResult
      }, profile.token), null, 2)}\n`, "utf8");
      checks.push({
        name: `agent:${caseId}`,
        status: result.code === 0 && assertionResult.ok ? "pass" : "fail",
        exitCode: result.code,
        signal: result.signal,
        timedOut: Boolean(result.timedOut),
        artifactPath,
        requiredPhrases: assertions.required,
        forbiddenPhrases: assertions.forbidden,
        missing: assertionResult.missing,
        forbiddenHits: assertionResult.forbiddenHits
      });
      if (checks.at(-1).status !== "pass") return { status: "fail", checks };
    }
  } finally {
    if (mcpConfig) rmSync(mcpConfig, { force: true });
  }

  return { status: "pass", checks };
}

function redactString(value, knownToken = "") {
  let text = String(value);
  if (knownToken) text = text.split(knownToken).join("[REDACTED]");
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(/(token|password|secret|api[_-]?key)=([^\s]+)/gi, "$1=[REDACTED]")
    .replace(/\.ktx\/secrets\/[^\s"'`]+/g, ".ktx/secrets/[REDACTED]");
}

function redactValue(value, knownToken = "", depth = 0) {
  if (depth > 12) return "[MAX_DEPTH]";
  if (typeof value === "string") return redactString(value, knownToken);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, knownToken, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/authorization|token|password|secret|api[_-]?key|host|hostname|username|user/i.test(key)) {
      out[key] = item ? "[REDACTED]" : item;
    } else {
      out[key] = redactValue(item, knownToken, depth + 1);
    }
  }
  return out;
}

function deriveStatus(profileResults) {
  const statuses = profileResults.flatMap((profile) => [profile.status, profile.direct?.status, profile.agent?.status].filter(Boolean));
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("blocked")) return "blocked";
  return "pass";
}

function summarize(profileResults) {
  const allChecks = profileResults.flatMap((profile) => [
    ...(profile.precheck ?? []),
    ...(profile.direct?.checks ?? []),
    ...(profile.agent?.checks ?? [])
  ]);
  return {
    profiles: profileResults.length,
    pass: allChecks.filter((check) => check.status === "pass").length,
    fail: allChecks.filter((check) => check.status === "fail").length,
    blocked: allChecks.filter((check) => check.status === "blocked").length,
    skip: allChecks.filter((check) => check.status === "skip").length,
    dryRun: allChecks.filter((check) => check.status === "dry-run").length
  };
}

function writeEvidence(outPath, evidence) {
  const abs = resolve(REPO_ROOT, outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(redactValue(evidence), null, 2)}\n`, "utf8");
  return abs;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cssStatus(status) {
  const normalized = String(status || "unknown").toLowerCase();
  if (["pass", "fail", "blocked", "skip", "dry-run"].includes(normalized)) return normalized;
  return "unknown";
}

function statusLabel(status) {
  const labels = {
    pass: "通过",
    fail: "失败",
    blocked: "阻塞",
    skip: "跳过",
    "dry-run": "演练",
    unknown: "未知"
  };
  return labels[String(status || "unknown").toLowerCase()] || labels.unknown;
}

function conciseValue(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function checkDetails(check) {
  const details = [];
  const labels = {
    reason: "原因",
    message: "说明",
    httpStatus: "HTTP 状态",
    sourceName: "数据源",
    sourceCount: "数据源数量",
    role: "角色",
    exitCode: "退出码",
    signal: "信号",
    artifactPath: "产物路径"
  };
  for (const [key, label] of Object.entries(labels)) {
    if (check[key] != null && check[key] !== "") details.push(`${label}: ${conciseValue(check[key])}`);
  }
  if (Array.isArray(check.missingTools) && check.missingTools.length > 0) details.push(`缺失工具: ${check.missingTools.join(", ")}`);
  if (Array.isArray(check.missingSources) && check.missingSources.length > 0) details.push(`缺失数据源: ${check.missingSources.join(", ")}`);
  if (Array.isArray(check.missing) && check.missing.length > 0) details.push(`缺失断言: ${check.missing.join(" | ")}`);
  if (Array.isArray(check.forbiddenHits) && check.forbiddenHits.length > 0) details.push(`命中禁止内容: ${check.forbiddenHits.join(" | ")}`);
  if (check.timedOut) details.push("是否超时: 是");
  return details.join("\n");
}

function renderChecksTable(title, checks = []) {
  if (!checks.length) {
    return `<section class="panel"><h3>${escapeHtml(title)}</h3><p class="muted">没有记录检查项。</p></section>`;
  }
  const rows = checks.map((check) => `
      <tr>
        <td><span class="badge ${cssStatus(check.status)}">${escapeHtml(statusLabel(check.status))}</span></td>
        <td>${escapeHtml(check.name || check.caseId || "检查项")}</td>
        <td><pre>${escapeHtml(checkDetails(check) || "正常")}</pre></td>
      </tr>`).join("");
  return `
    <section class="panel">
      <h3>${escapeHtml(title)}</h3>
      <table>
        <thead><tr><th>状态</th><th>检查项</th><th>详情</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderHtmlReport(evidence) {
  const safe = redactValue(evidence);
  const summary = safe.summary || {};
  const generatedAt = safe.generatedAt || new Date().toISOString();
  const profiles = Array.isArray(safe.profiles) ? safe.profiles : [];
  const cards = [
    ["Profile 数量", summary.profiles ?? profiles.length],
    ["通过", summary.pass ?? 0],
    ["失败", summary.fail ?? 0],
    ["阻塞", summary.blocked ?? 0],
    ["跳过", summary.skip ?? 0],
    ["演练", summary.dryRun ?? 0],
    ["Agent 运行时", safe.config?.agentRuntime || "未声明"],
    ["Stub 模式", safe.config?.stub === true ? "是" : safe.config?.stub === false ? "否" : "未声明"]
  ].map(([label, value]) => `<div class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");

  const profileSections = profiles.map((profile) => `
    <section class="profile">
      <div class="profile-header">
        <div>
          <h2>${escapeHtml(profile.id)} <small>${escapeHtml(profile.label || "")}</small></h2>
          <p>预期角色：<code>${escapeHtml(profile.expectedRole || "未设置")}</code></p>
        </div>
        <span class="badge ${cssStatus(profile.status)}">${escapeHtml(statusLabel(profile.status))}</span>
      </div>
      ${renderChecksTable("预检", profile.precheck)}
      ${renderChecksTable("直接 MCP 控制检查", profile.direct?.checks)}
      ${renderChecksTable("Agent 端到端检查", profile.agent?.checks)}
    </section>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lucy P1 Agent 端到端测试报告</title>
  <style>
    :root { color-scheme: light; --bg: #f7f8fa; --ink: #17202a; --muted: #637083; --line: #d9dee7; --panel: #ffffff; --pass: #147a3f; --fail: #b42318; --blocked: #9a5b00; --skip: #536579; --dry: #315a9c; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 56px; }
    header { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 22px; }
    h1, h2, h3 { margin: 0; line-height: 1.2; }
    h1 { font-size: 28px; }
    h2 { font-size: 20px; }
    h3 { font-size: 15px; margin-bottom: 12px; }
    small, .muted { color: var(--muted); font-weight: 400; }
    code { background: #eef1f5; border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
    .badge { display: inline-flex; align-items: center; min-width: 68px; justify-content: center; border-radius: 999px; padding: 4px 10px; color: white; font-weight: 700; text-transform: uppercase; font-size: 12px; }
    .badge.pass { background: var(--pass); }
    .badge.fail { background: var(--fail); }
    .badge.blocked { background: var(--blocked); }
    .badge.skip { background: var(--skip); }
    .badge.dry-run { background: var(--dry); }
    .badge.unknown { background: #687083; }
    .summary { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin: 18px 0 22px; }
    .card, .profile, .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
    .card { padding: 14px; }
    .card span { display: block; color: var(--muted); font-size: 12px; }
    .card strong { display: block; font-size: 24px; margin-top: 4px; }
    .profile { margin-top: 16px; overflow: hidden; }
    .profile-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 18px; border-bottom: 1px solid var(--line); }
    .profile-header p { margin: 8px 0 0; color: var(--muted); }
    .panel { margin: 14px 18px 18px; padding: 14px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 760px; }
    th, td { border-top: 1px solid var(--line); padding: 9px 8px; text-align: left; vertical-align: top; }
    thead th { border-top: 0; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    th:first-child, td:first-child { width: 96px; }
    th:nth-child(2), td:nth-child(2) { width: 280px; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #243043; }
    @media (max-width: 760px) {
      main { padding: 20px 12px 40px; }
      header { display: block; }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .profile-header { display: block; }
      .profile-header .badge { margin-top: 12px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Lucy P1 Agent 端到端测试报告</h1>
        <p class="muted">生成时间：${escapeHtml(generatedAt)}；生成脚本：${escapeHtml(safe.generatedBy || "未知")}</p>
      </div>
      <span class="badge ${cssStatus(safe.status)}">${escapeHtml(statusLabel(safe.status))}</span>
    </header>
    <section class="summary">${cards}</section>
    <section class="panel">
      <h3>运行上下文</h3>
      <pre>${escapeHtml(JSON.stringify(safe.config || {}, null, 2))}</pre>
    </section>
    ${profileSections || '<section class="panel"><h3>Profiles</h3><p class="muted">没有记录 profile。</p></section>'}
  </main>
</body>
</html>`;
}

function writeHtmlReport(outPath, evidence) {
  const abs = resolve(REPO_ROOT, outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, renderHtmlReport(evidence), "utf8");
  return abs;
}

async function runAgentE2E({ args, env = process.env } = {}) {
  const agentCommands = loadAgentCommands(env);
  const profiles = resolveProfiles(args.profiles, env);
  const artifactsDir = resolve(REPO_ROOT, args.artifacts);
  mkdirSync(artifactsDir, { recursive: true });

  const evidence = {
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/p1-agent-e2e.mjs",
    contract: "p1-agent-database-e2e",
    status: "running",
    dryRun: args.dryRun,
    config: {
      proxyUrl: args.proxyUrl,
      profiles: args.profiles,
      out: args.out,
      artifacts: args.artifacts,
      htmlReport: args.htmlReport,
      timeoutMs: args.timeoutMs,
      agentTimeoutMs: args.agentTimeoutMs,
      gateKind: "e2e",
      agentRuntime: env.LUCY_E2E_AGENT_RUNTIME || "configured-agent-command",
      stub: env.LUCY_E2E_STUB === "true" ? true : env.LUCY_E2E_STUB === "false" ? false : null
    },
    profiles: [],
    summary: {}
  };

  for (const profile of profiles) {
    const profileResult = {
      id: profile.id,
      label: profile.label,
      expectedRole: profile.expectedRole,
      token: { present: profile.tokenPresent, env: profile.tokenEnv, redacted: true },
      precheck: []
    };
    const plan = checkProfilePlan(profile);
    if (plan.status !== "ok") {
      profileResult.status = "blocked";
      profileResult.precheck.push({ name: "profile_role", status: "blocked", reason: plan.reason, message: plan.message });
      evidence.profiles.push(profileResult);
      continue;
    }

    const caseIds = [...plan.rolePlan.agent];
    const caseChecks = [];
    for (const caseId of caseIds) {
      try {
        const testCase = loadEvalCase(caseId);
        caseChecks.push({ caseId, status: "pass", questionPresent: Boolean(testCase.question) });
      } catch (error) {
        caseChecks.push({ caseId, status: "blocked", reason: "case_load_failed", message: error.message });
      }
    }
    profileResult.precheck.push({ name: "eval_cases", status: caseChecks.every((check) => check.status === "pass") ? "pass" : "blocked", cases: caseChecks });

    const commandTemplate = agentCommands[profile.id];
    profileResult.precheck.push({
      name: "agent_command_template",
      status: commandTemplate ? "pass" : args.dryRun ? "dry-run" : "blocked",
      commandConfigured: Boolean(commandTemplate),
      usesMcpConfig: commandTemplate ? commandUsesMcpConfig(commandTemplate) : false
    });

    if (args.dryRun) {
      profileResult.status = profileResult.precheck.some((check) => check.status === "blocked") ? "blocked" : "pass";
      profileResult.direct = { status: "dry-run", checks: [] };
      profileResult.agent = { status: "dry-run", checks: [] };
      evidence.profiles.push(profileResult);
      continue;
    }

    if (!profile.tokenPresent) {
      profileResult.precheck.push({ name: "profile_token", status: "blocked", reason: "missing_token", env: profile.tokenEnv });
      profileResult.status = "blocked";
      evidence.profiles.push(profileResult);
      continue;
    }
    profileResult.precheck.push({ name: "profile_token", status: "pass", env: profile.tokenEnv, redacted: true });

    if (profileResult.precheck.some((check) => check.status === "blocked")) {
      profileResult.status = "blocked";
      evidence.profiles.push(profileResult);
      continue;
    }

    profileResult.direct = await runDirectMcpProfile(profile, plan.rolePlan, args);
    if (profileResult.direct.status === "pass") {
      profileResult.agent = await runAgentProfile(profile, plan.rolePlan, args, agentCommands, artifactsDir);
    } else {
      profileResult.agent = { status: "blocked", checks: [{ name: "agent_after_direct_mcp", status: "blocked", reason: "direct_mcp_not_passed" }] };
    }
    profileResult.status = deriveStatus([profileResult]);
    evidence.profiles.push(profileResult);
  }

  evidence.status = deriveStatus(evidence.profiles);
  evidence.summary = summarize(evidence.profiles);
  evidence.exitCode = evidence.status === "pass"
    ? EXIT_CODES.pass
    : evidence.status === "blocked"
      ? EXIT_CODES.blocked
      : EXIT_CODES.fail;

  return { evidence, exitCode: evidence.exitCode };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(`error: ${error.message}\n\n${USAGE}`);
    process.exit(EXIT_CODES.usage);
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }
  try {
    const { evidence, exitCode } = await runAgentE2E({ args });
    const outPath = writeEvidence(args.out, evidence);
    const htmlPath = writeHtmlReport(args.htmlReport, evidence);
    console.error(`[p1-agent-e2e] wrote evidence: ${outPath}`);
    console.error(`[p1-agent-e2e] wrote HTML report: ${htmlPath}`);
    console.error(`[p1-agent-e2e] ${evidence.status.toUpperCase()} ${JSON.stringify(evidence.summary)}`);
    process.exit(exitCode);
  } catch (error) {
    console.error(`fatal: ${error.stack || error.message || error}`);
    process.exit(EXIT_CODES.usage);
  }
}

export {
  DIRECT_CASES,
  EXIT_CODES,
  ROLE_CASES,
  assertionsFromCase,
  checkTextAssertions,
  loadAgentCommands,
  loadEvalCase,
  parseAgentFinalText,
  parseArgs,
  redactValue,
  renderHtmlReport,
  resolveProfiles,
  runAgentE2E,
  stringIncludesLoose,
  writeEvidence,
  writeHtmlReport
};

const isEntry = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === __filename;
  } catch {
    return false;
  }
})();

if (isEntry) {
  main();
}
