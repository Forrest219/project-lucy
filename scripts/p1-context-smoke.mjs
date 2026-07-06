#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import YAML from "yaml";

const DEFAULT_SOURCES = [
  "mysql-aliyun/superstore_orders",
  "poc-mysql-aliyun/poc_ceo_metric_snapshot"
];
const DEFAULT_WIKI_KEYS = [
  "global/superstore-analysis-playbook.md",
  "global/poc-data-agent-playbook.md",
  "global/kx-financial-analysis-playbook.md"
];
const DEFAULT_WIKI_QUERIES = [
  "superstore order_count weighted_discount",
  "CEO一眼报 poc_ceo_metric_snapshot",
  "KX 财务 营业收入"
];
const CHECKS = [
  "semanticInventory",
  "semanticSourceReadability",
  "wikiPlaybooks",
  "ktxRuntime",
  "proxyRuntime"
];

const USAGE = `Usage:
  node scripts/p1-context-smoke.mjs [options]

Default mode performs static/lightweight checks and writes
inbox/p1-context-evidence.json. Runtime checks are explicit:
--with-ktx/--live runs local ktx reindex/read/search, while --proxy-url with
--token checks Lucy MCP Proxy tools/call.

Options:
  --source <connection/source>   Key semantic-layer source. Repeatable.
  --wiki <global/page.md>        Key wiki page under wiki/. Repeatable.
  --wiki-query <query>           Runtime wiki search query. Repeatable.
  --with-ktx, --live             Run ktx admin reindex, sl read, and wiki search.
  --ktx-bin <path>               ktx binary name/path. Default: KTX_BIN or ktx.
  --proxy-url <url>              Lucy MCP Proxy URL. Env: LUCY_P1_PROXY_URL.
  --token <token>                Bearer token. Env: LUCY_P1_PROXY_TOKEN or LUCY_LOCAL_TOKEN.
  --strict-runtime               Treat skipped runtime checks as failure.
  --root <path>                  Project root. Default: cwd.
  --out <path>                   Evidence path. Default: inbox/p1-context-evidence.json.
`;

const { values } = parseArgs({
  options: {
    source: { type: "string", multiple: true },
    wiki: { type: "string", multiple: true },
    "wiki-query": { type: "string", multiple: true },
    "with-ktx": { type: "boolean", default: false },
    live: { type: "boolean", default: false },
    "ktx-bin": { type: "string" },
    "proxy-url": { type: "string" },
    token: { type: "string" },
    "strict-runtime": { type: "boolean", default: false },
    root: { type: "string" },
    out: { type: "string", short: "o", default: "inbox/p1-context-evidence.json" },
    help: { type: "boolean", short: "h", default: false }
  },
  allowPositionals: false
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const projectRoot = path.resolve(String(values.root ?? process.cwd()));
const outFile = path.resolve(projectRoot, String(values.out ?? "inbox/p1-context-evidence.json"));
const sourceRefs = normalizeSourceRefs(values.source ?? DEFAULT_SOURCES);
const wikiKeys = normalizeWikiKeys(values.wiki ?? DEFAULT_WIKI_KEYS);
const wikiQueries = values["wiki-query"]?.length ? values["wiki-query"] : DEFAULT_WIKI_QUERIES;
const ktxBin = String(values["ktx-bin"] ?? process.env.KTX_BIN ?? "ktx");
const runKtx = Boolean(values["with-ktx"] || values.live || process.env.LUCY_P1_RUN_KTX === "1" || process.env.LUCY_P1_CONTEXT_LIVE === "1");
const proxyUrl = stringValue(values["proxy-url"]) ?? stringValue(process.env.LUCY_P1_PROXY_URL);
const proxyToken = stringValue(values.token) ?? stringValue(process.env.LUCY_P1_PROXY_TOKEN) ?? stringValue(process.env.LUCY_LOCAL_TOKEN);
const strictRuntime = Boolean(values["strict-runtime"]);

const evidence = {
  gate: "p1-context-semantic-wiki",
  checkedAt: new Date().toISOString(),
  generatedBy: "scripts/p1-context-smoke.mjs",
  projectRoot,
  status: "fail",
  checks: Object.fromEntries(CHECKS.map((check) => [check, "fail"])),
  checkDetails: {},
  inputs: {
    sources: sourceRefs,
    wikiKeys,
    wikiQueries,
    ktxRequested: runKtx,
    proxyConfigured: Boolean(proxyUrl && proxyToken),
    strictRuntime
  }
};

function normalizeSourceRefs(valuesToNormalize) {
  return valuesToNormalize.map((item) => {
    const normalized = String(item).trim().replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length !== 2 || parts.some((part) => part === "." || part === ".." || part.includes(".."))) {
      throw new Error(`Invalid --source '${item}'. Expected connection/sourceName.`);
    }
    return { connectionId: parts[0], sourceName: parts[1], ref: `${parts[0]}/${parts[1]}` };
  });
}

function normalizeWikiKeys(valuesToNormalize) {
  return valuesToNormalize.map((item) => {
    const normalized = String(item).trim().replaceAll("\\", "/").replace(/^wiki\//, "");
    if (!normalized || normalized.startsWith("/") || normalized.includes("..") || !normalized.endsWith(".md")) {
      throw new Error(`Invalid --wiki '${item}'. Expected markdown key under wiki/.`);
    }
    return normalized;
  });
}

function tail(value, max = 3000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > max ? text.slice(text.length - max) : text;
}

function mark(check, status, detail = {}) {
  evidence.checks[check] = status;
  evidence.checkDetails[check] = { ...(evidence.checkDetails[check] ?? {}), ...detail, status };
}

function passFail(passed) {
  return passed ? "pass" : "fail";
}

async function fileExists(absPath) {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir, predicate = () => true) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(abs, predicate)));
    } else if (entry.isFile() && predicate(abs)) {
      files.push(abs);
    }
  }
  return files;
}

async function readYaml(absPath) {
  const text = await readFile(absPath, "utf8");
  const doc = YAML.parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
  return { data: doc.toJS() ?? {}, text };
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function rel(absPath) {
  return path.relative(projectRoot, absPath).replaceAll(path.sep, "/");
}

function parseWikiFrontmatter(text) {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end < 0) return {};
  try {
    const doc = YAML.parseDocument(text.slice(4, end), { prettyErrors: true });
    if (doc.errors.length > 0) return {};
    return asRecord(doc.toJS());
  } catch {
    return {};
  }
}

function manifestColumnLeaks(manifestData, manifestPath) {
  const leaks = [];
  for (const [tableName, table] of Object.entries(asRecord(manifestData.tables))) {
    for (const column of asArray(asRecord(table).columns)) {
      const record = asRecord(column);
      const forbiddenKeys = ["expr", "role"].filter((key) => Object.hasOwn(record, key));
      if (forbiddenKeys.length > 0) {
        leaks.push({ manifest: manifestPath, sourceName: tableName, column: record.name, forbiddenKeys });
      }
    }
  }
  return leaks;
}

async function semanticInventoryCheck() {
  const root = path.join(projectRoot, "semantic-layer");
  const connections = await readdir(root, { withFileTypes: true }).catch(() => []);
  const details = [];
  const parseErrors = [];
  const computedColumnLeaks = [];
  for (const connection of connections.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))) {
    const connectionDir = path.join(root, connection.name);
    const manifestDir = path.join(connectionDir, "_schema");
    const manifestFiles = await listFiles(manifestDir, (file) => file.endsWith(".yaml") || file.endsWith(".yml"));
    const overlayFiles = (await readdir(connectionDir, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")))
      .map((entry) => path.join(connectionDir, entry.name));
    for (const file of [...manifestFiles, ...overlayFiles]) {
      try {
        const parsed = await readYaml(file);
        if (file.includes(`${path.sep}_schema${path.sep}`)) computedColumnLeaks.push(...manifestColumnLeaks(parsed.data, rel(file)));
      } catch (error) {
        parseErrors.push({ path: rel(file), error: error.message });
      }
    }
    details.push({
      connectionId: connection.name,
      manifestFiles: manifestFiles.map(rel).sort(),
      overlayFiles: overlayFiles.map(rel).sort(),
      manifestCount: manifestFiles.length,
      overlayCount: overlayFiles.length,
      hasManifest: manifestFiles.length > 0,
      hasOverlay: overlayFiles.length > 0
    });
  }
  const missing = details.filter((item) => !item.hasManifest || !item.hasOverlay);
  mark("semanticInventory", passFail(details.length > 0 && missing.length === 0 && parseErrors.length === 0 && computedColumnLeaks.length === 0), {
    connections: details,
    missing,
    parseErrors,
    computedColumnLeaks,
    message: "Manifests live under _schema; overlays live beside _schema. Manifest columns must not carry expr/role."
  });
}

async function semanticSourceReadabilityCheck() {
  const sourceDetails = [];
  for (const source of sourceRefs) {
    const connectionDir = path.join(projectRoot, "semantic-layer", source.connectionId);
    const overlayPath = path.join(connectionDir, `${source.sourceName}.yaml`);
    const manifestFiles = await listFiles(path.join(connectionDir, "_schema"), (file) => file.endsWith(".yaml") || file.endsWith(".yml"));
    const detail = {
      ...source,
      overlayPath: rel(overlayPath),
      overlayExists: await fileExists(overlayPath),
      overlayReadable: false,
      overlayNameMatches: false,
      hasGrain: false,
      measureCount: 0,
      segmentCount: 0,
      manifestFound: false,
      manifestPath: undefined,
      manifestTable: undefined,
      error: undefined
    };
    try {
      if (!detail.overlayExists) throw new Error(`overlay missing: ${detail.overlayPath}`);
      const overlay = await readYaml(overlayPath);
      const overlayData = asRecord(overlay.data);
      detail.overlayReadable = true;
      detail.overlayNameMatches = overlayData.name === source.sourceName;
      detail.hasGrain = asArray(overlayData.grain).length > 0;
      detail.measureCount = asArray(overlayData.measures).length;
      detail.segmentCount = asArray(overlayData.segments).length;
      for (const manifestFile of manifestFiles) {
        const manifest = await readYaml(manifestFile);
        const table = asRecord(asRecord(manifest.data).tables)[source.sourceName];
        if (table) {
          detail.manifestFound = true;
          detail.manifestPath = rel(manifestFile);
          detail.manifestTable = asRecord(table).table;
          break;
        }
      }
      if (!detail.manifestFound) throw new Error(`manifest table missing for ${source.ref}`);
    } catch (error) {
      detail.error = error.message;
    }
    sourceDetails.push(detail);
  }
  const failed = sourceDetails.filter((detail) => !detail.overlayExists || !detail.overlayReadable || !detail.overlayNameMatches || !detail.hasGrain || detail.measureCount < 1 || !detail.manifestFound);
  mark("semanticSourceReadability", passFail(failed.length === 0), {
    sources: sourceDetails,
    failed,
    required: "Each key source must have a readable overlay with grain/measures and a matching manifest table."
  });
}

async function wikiPlaybooksCheck() {
  const details = [];
  for (const key of wikiKeys) {
    const absPath = path.join(projectRoot, "wiki", key);
    const detail = {
      key,
      path: rel(absPath),
      exists: await fileExists(absPath),
      readable: false,
      hasHeading: false,
      hasFrontmatter: false,
      slRefCount: 0,
      bytes: 0,
      error: undefined
    };
    try {
      if (!detail.exists) throw new Error(`wiki page missing: wiki/${key}`);
      const text = await readFile(absPath, "utf8");
      detail.readable = true;
      detail.bytes = Buffer.byteLength(text);
      detail.hasHeading = /^#\s+/m.test(text);
      const frontmatter = parseWikiFrontmatter(text);
      detail.hasFrontmatter = Object.keys(frontmatter).length > 0;
      detail.slRefCount = asArray(frontmatter.sl_refs).length;
      if (detail.bytes === 0) throw new Error(`wiki page empty: wiki/${key}`);
    } catch (error) {
      detail.error = error.message;
    }
    details.push(detail);
  }
  const failed = details.filter((detail) => !detail.exists || !detail.readable || !detail.hasHeading || detail.slRefCount < 1);
  mark("wikiPlaybooks", passFail(failed.length === 0), {
    pages: details,
    failed,
    required: "Each key wiki playbook must be readable, have a heading, and carry at least one sl_refs frontmatter entry."
  });
}

function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? projectRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs ?? 45_000);
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, signal: null, durationMs: Date.now() - started, stdout, stderr, error: error.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, signal, durationMs: Date.now() - started, stdout, stderr });
    });
  });
}

function summarizeCommand(label, result) {
  return {
    label,
    ok: result.ok,
    code: result.code,
    signal: result.signal,
    durationMs: result.durationMs,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    error: result.error
  };
}

function outputContains(result, needle) {
  return `${result.stdout}\n${result.stderr}`.includes(needle);
}

function runtimeBlockedByEnvironment(result) {
  const text = `${result.error ?? ""}\n${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.stdoutTail ?? ""}\n${result.stderrTail ?? ""}`;
  return /Operation not permitted|permission denied|EACCES|EPERM|could not lock config file|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(text);
}

async function ktxRuntimeCheck() {
  if (!runKtx) {
    mark("ktxRuntime", "skipped", { reason: "not_requested", howToRun: "node scripts/p1-context-smoke.mjs --with-ktx" });
    return;
  }
  const ktxEnv = {
    KTX_TELEMETRY_DISABLED: "1",
    DO_NOT_TRACK: "1",
    CI: process.env.CI ?? "1"
  };
  const commands = [];
  const version = await runCommand(ktxBin, ["--version"], { timeoutMs: 15_000, env: ktxEnv });
  commands.push(summarizeCommand(`${ktxBin} --version`, version));
  if (!version.ok) {
    mark("ktxRuntime", "blocked", { reason: "ktx_unavailable", commands });
    return;
  }
  const reindex = await runCommand(ktxBin, ["--project-dir", projectRoot, "admin", "reindex", "--json"], { timeoutMs: 60_000, env: ktxEnv });
  const slReads = [];
  for (const source of sourceRefs) {
    const result = await runCommand(ktxBin, ["--project-dir", projectRoot, "sl", "--connection-id", source.connectionId, "--json", "read", source.sourceName], { env: ktxEnv });
    slReads.push({ ...source, passed: result.ok && outputContains(result, source.sourceName), ...summarizeCommand(`ktx sl read ${source.ref}`, result) });
  }
  const wikiSearches = [];
  for (const query of wikiQueries) {
    const result = await runCommand(ktxBin, ["--project-dir", projectRoot, "wiki", "--json", "--limit", "5", query], { env: ktxEnv });
    const passed = result.ok && wikiKeys.some((key) => outputContains(result, key) || outputContains(result, path.basename(key, ".md")));
    wikiSearches.push({ query, passed, ...summarizeCommand(`ktx wiki ${query}`, result) });
  }
  const failedReads = slReads.filter((item) => !item.passed);
  const failedWiki = wikiSearches.filter((item) => !item.passed);
  const blockedByEnvironment = [reindex, ...slReads, ...wikiSearches].some((item) => !item.ok && runtimeBlockedByEnvironment(item));
  mark("ktxRuntime", reindex.ok && failedReads.length === 0 && failedWiki.length === 0 ? "pass" : blockedByEnvironment ? "blocked" : "fail", {
    reason: blockedByEnvironment ? "runtime_environment_blocked" : undefined,
    commands,
    reindex: summarizeCommand("ktx admin reindex --json", reindex),
    slReads,
    wikiSearches,
    failedReads,
    failedWiki
  });
}

function parseRpcBody(text) {
  if (!text.startsWith("event:")) return JSON.parse(text);
  const line = text.split("\n").find((item) => item.startsWith("data: "));
  if (!line) throw new Error("SSE response does not contain a data line");
  return JSON.parse(line.slice(6));
}

async function rpc(sessionId, method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${proxyToken}`
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params })
  });
  const text = await response.text();
  let body;
  try {
    body = parseRpcBody(text);
  } catch (error) {
    body = { parseError: error.message, raw: tail(text) };
  }
  return { ok: response.ok, status: response.status, sessionId: response.headers.get("mcp-session-id"), body, text };
}

function resultText(body) {
  return JSON.stringify(body?.result ?? body ?? {});
}

function toolNames(listBody) {
  return (listBody?.result?.tools ?? []).map((tool) => tool.name).sort();
}

async function proxyRuntimeCheck() {
  if (!proxyUrl) {
    mark("proxyRuntime", "skipped", {
      reason: proxyToken ? "proxy_url_not_configured" : "not_configured",
      requiredEnv: ["LUCY_P1_PROXY_URL", "LUCY_P1_PROXY_TOKEN or LUCY_LOCAL_TOKEN"]
    });
    return;
  }
  if (!proxyToken) {
    mark("proxyRuntime", "blocked", {
      reason: "incomplete_proxy_configuration",
      hasProxyUrl: Boolean(proxyUrl),
      hasToken: Boolean(proxyToken)
    });
    return;
  }
  try {
    const init = await rpc("", "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "p1-context-smoke", version: "0.1.0" }
    });
    if (!init.ok || init.body?.error || !init.sessionId) {
      mark("proxyRuntime", "blocked", {
        reason: "initialize_failed",
        initialize: { httpStatus: init.status, sessionIdPresent: Boolean(init.sessionId), response: tail(init.body) }
      });
      return;
    }
    await rpc(init.sessionId, "notifications/initialized", {});
    const list = await rpc(init.sessionId, "tools/list", {});
    const tools = toolNames(list.body);
    const semanticReadTool = tools.includes("sl_read_source") ? "sl_read_source" : tools.includes("lucy_read_source") ? "lucy_read_source" : undefined;
    const hasWikiSearch = tools.includes("wiki_search");
    const slReads = [];
    if (semanticReadTool) {
      for (const source of sourceRefs) {
        const response = await rpc(init.sessionId, "tools/call", {
          name: semanticReadTool,
          arguments: { connectionId: source.connectionId, sourceName: source.sourceName }
        });
        const text = resultText(response.body);
        slReads.push({ ...source, tool: semanticReadTool, passed: response.ok && !response.body?.error && text.includes(source.sourceName), httpStatus: response.status, response: tail(response.body) });
      }
    }
    const wikiSearches = [];
    if (hasWikiSearch) {
      for (const query of wikiQueries) {
        const response = await rpc(init.sessionId, "tools/call", {
          name: "wiki_search",
          arguments: { query, limit: 5 }
        });
        const text = resultText(response.body);
        wikiSearches.push({ query, passed: response.ok && !response.body?.error && wikiKeys.some((key) => text.includes(key) || text.includes(path.basename(key, ".md"))), httpStatus: response.status, response: tail(response.body) });
      }
    }
    const missingTools = [
      ...(semanticReadTool ? [] : ["sl_read_source or lucy_read_source"]),
      ...(hasWikiSearch ? [] : ["wiki_search"])
    ];
    const failedReads = slReads.filter((item) => !item.passed);
    const failedWiki = wikiSearches.filter((item) => !item.passed);
    mark("proxyRuntime", missingTools.length === 0 && failedReads.length === 0 && failedWiki.length === 0 ? "pass" : "fail", {
      proxyUrl,
      initialize: { httpStatus: init.status, sessionIdPresent: Boolean(init.sessionId) },
      tools,
      semanticReadTool,
      missingTools,
      slReads,
      wikiSearches,
      failedReads,
      failedWiki
    });
  } catch (error) {
    mark("proxyRuntime", "blocked", {
      reason: "proxy_unreachable_or_protocol_error",
      error: error.message
    });
  }
}

function summarizeEvidence() {
  const counts = CHECKS.reduce((acc, check) => {
    const status = evidence.checks[check];
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  const staticChecks = ["semanticInventory", "semanticSourceReadability", "wikiPlaybooks"];
  const staticFailed = staticChecks.filter((check) => evidence.checks[check] !== "pass");
  const failed = CHECKS.filter((check) => evidence.checks[check] === "fail");
  const blocked = CHECKS.filter((check) => evidence.checks[check] === "blocked");
  const skippedRuntime = ["ktxRuntime", "proxyRuntime"].filter((check) => evidence.checks[check] === "skipped");
  const strictRuntimeFailed = strictRuntime && ["ktxRuntime", "proxyRuntime"].some((check) => evidence.checks[check] !== "pass");
  const exitCode = staticFailed.length > 0 || failed.length > 0 || blocked.length > 0 || strictRuntimeFailed ? 1 : 0;
  evidence.status = exitCode !== 0
    ? (blocked.length > 0 || strictRuntimeFailed ? "blocked" : "fail")
    : skippedRuntime.length > 0
      ? "partial"
      : "pass";
  evidence.summary = { counts, staticFailed, failed, blocked, skippedRuntime, strictRuntimeFailed, exitCode };
  return { exitCode };
}

async function main() {
  try {
    await stat(projectRoot);
    await semanticInventoryCheck();
    await semanticSourceReadabilityCheck();
    await wikiPlaybooksCheck();
    await ktxRuntimeCheck();
    await proxyRuntimeCheck();
  } catch (error) {
    evidence.fatalError = error.message;
  }
  const { exitCode } = summarizeEvidence();
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: exitCode === 0, status: evidence.status, outFile, checks: evidence.checks, summary: evidence.summary }, null, 2));
  process.exit(exitCode);
}

main();
