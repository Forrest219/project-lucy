#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const requiredChecks = [
  "connection",
  "readonlySelect",
  "ddlDmlRejected",
  "limitPagination",
  "typeMapping",
  "timeoutClassification",
  "errorTaxonomy",
  "lucyMetadata"
];
const LUCY_R1_CONTRACT = "lucy-r1-controlled-data-service";

const { values } = parseArgs({
  options: {
    connection: { type: "string", short: "c" },
    source: { type: "string", short: "s" },
    measure: { type: "string", short: "m" },
    dimension: { type: "string", short: "d" },
    segment: { type: "string", multiple: true },
    engine: { type: "string", default: "doris" },
    project: { type: "string", default: process.cwd() },
    out: { type: "string", short: "o" },
    limit: { type: "string", default: "5" },
    "proxy-url": { type: "string" },
    token: { type: "string" },
    "timeout-evidence": { type: "string" },
    "readonly-account-confirmed": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false }
  },
  allowPositionals: false
});

function usage() {
  return `Usage:
  npm run r1:doris-smoke -- \\
    --connection doris-r1 \\
    --source ceo_metric_snapshot \\
    --measure ceo_metric_snapshot.revenue \\
    --dimension ceo_metric_snapshot.biz_date \\
    --proxy-url http://127.0.0.1:7879/mcp \\
    --token "$LUCY_AGENT_TOKEN" \\
    --timeout-evidence inbox/doris-timeout-evidence.json \\
    --readonly-account-confirmed \\
    --out inbox/doris-r1-evidence.json

Required for a passing evidence file:
  --connection, --source, --measure, --proxy-url, --token,
  --timeout-evidence, --readonly-account-confirmed

The script fails closed. Missing dynamic checks produce a JSON evidence file with
failed checks and a non-zero exit code.`;
}

if (values.help) {
  console.log(usage());
  process.exit(0);
}

function requiredString(name) {
  const value = values[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const engine = requiredString("engine") ?? process.env.LUCY_R1_TARGET_ENGINE ?? "doris";
if (!["doris", "starrocks"].includes(engine)) {
  console.error(`[lucy-r1-doris-smoke] FAIL: --engine must be doris or starrocks, got ${engine}`);
  process.exit(1);
}
const engineEnvPrefix = engine === "starrocks" ? "STARROCKS" : "DORIS";
const targetLabel = engine === "starrocks" ? "StarRocks" : "Doris";
const defaultOut = engine === "starrocks" ? "inbox/starrocks-r1-evidence.json" : "inbox/doris-r1-evidence.json";
const generatedBy = engine === "starrocks" ? "scripts/lucy-r1-doris-smoke.mjs --engine starrocks" : "scripts/lucy-r1-doris-smoke.mjs";

function targetEnv(name) {
  return process.env[`LUCY_R1_${engineEnvPrefix}_${name}`];
}

const connectionId = requiredString("connection") ?? targetEnv("CONNECTION");
const sourceName = requiredString("source") ?? targetEnv("SOURCE");
const measure = requiredString("measure") ?? targetEnv("MEASURE");
const dimension = requiredString("dimension") ?? targetEnv("DIMENSION");
const proxyUrl = requiredString("proxy-url") ?? process.env.LUCY_R1_PROXY_URL;
const token = requiredString("token") ?? process.env.LUCY_R1_PROXY_TOKEN;
const timeoutEvidence = requiredString("timeout-evidence") ?? process.env.LUCY_R1_TIMEOUT_EVIDENCE;
const projectDir = path.resolve(String(values.project ?? process.cwd()));
const outFile = path.resolve(String(values.out ?? defaultOut));
const limit = Number.parseInt(String(values.limit ?? "5"), 10);
const segments = Array.isArray(values.segment) ? values.segment : [];

function nowIso() {
  return new Date().toISOString();
}

function tail(value, max = 4000) {
  if (!value) return "";
  return value.length > max ? value.slice(value.length - max) : value;
}

function commandLabel(command, args) {
  return [command, ...args].join(" ");
}

function run(command, args, options = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? projectDir,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      resolve({
        ok: false,
        code: null,
        error: error.message,
        stdout,
        stderr,
        durationMs: Date.now() - started
      });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        durationMs: Date.now() - started
      });
    });
  });
}

function ktxArgs(args) {
  return ["--project-dir", projectDir, ...args];
}

function firstJsonValue(text) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    for (const start of ["{", "["]) {
      const index = trimmed.indexOf(start);
      if (index >= 0) {
        try {
          return JSON.parse(trimmed.slice(index));
        } catch {
          // Continue with the next candidate.
        }
      }
    }
  }
  return undefined;
}

function rowsFromJson(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return undefined;
  for (const key of ["rows", "data", "records"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  for (const key of ["result", "structuredContent", "content"]) {
    const nested = rowsFromJson(value[key]);
    if (nested) return nested;
  }
  return undefined;
}

function parseMcpBody(text) {
  if (!text.startsWith("event:")) return JSON.parse(text);
  const line = text.split("\n").find((item) => item.startsWith("data: "));
  if (!line) throw new Error("SSE response does not contain a data line");
  return JSON.parse(line.slice(6));
}

async function rpc(sessionId, method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params })
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    sessionId: response.headers.get("mcp-session-id"),
    body: parseMcpBody(text),
    text
  };
}

function resultContainsLucyMeta(body) {
  return Boolean(findLucyMeta(body));
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

function hasResultSummary(lucyMeta) {
  if (!lucyMeta || typeof lucyMeta !== "object" || Array.isArray(lucyMeta)) return false;
  const result = lucyMeta.result;
  return result && typeof result === "object" && !Array.isArray(result)
    && Object.hasOwn(result, "rowCount")
    && Object.hasOwn(result, "columnCount")
    && Object.hasOwn(result, "truncated");
}

function provenanceSummary(lucyMeta) {
  const provenance = lucyMeta && typeof lucyMeta === "object" && !Array.isArray(lucyMeta)
    ? lucyMeta.provenance
    : undefined;
  const hasProvenance = Boolean(provenance && typeof provenance === "object" && !Array.isArray(provenance));
  const record = hasProvenance ? provenance : {};
  const freshness = hasProvenance ? record.freshness : undefined;
  const freshnessRecord = freshness && typeof freshness === "object" && !Array.isArray(freshness) ? freshness : {};
  return {
    hasProvenance,
    hasConnectionId: hasProvenance && Object.hasOwn(record, "connectionId"),
    hasSourceName: hasProvenance && Object.hasOwn(record, "sourceName"),
    hasMeasures: hasProvenance && Object.hasOwn(record, "measures"),
    hasDimensions: hasProvenance && Object.hasOwn(record, "dimensions"),
    hasFilters: hasProvenance && Object.hasOwn(record, "filters"),
    hasSegments: hasProvenance && Object.hasOwn(record, "segments"),
    hasOrderBy: hasProvenance && Object.hasOwn(record, "orderBy"),
    hasFreshnessStatus: Object.hasOwn(freshnessRecord, "status"),
    hasFreshnessTool: Object.hasOwn(freshnessRecord, "tool"),
    hasTruncation: hasProvenance && Object.hasOwn(record, "truncation")
  };
}

function hasProvenanceSummary(lucyMeta) {
  return Object.values(provenanceSummary(lucyMeta)).every(Boolean);
}

function lucyContract(lucyMeta) {
  return lucyMeta && typeof lucyMeta === "object" && !Array.isArray(lucyMeta)
    ? lucyMeta.contract
    : undefined;
}

function hasLucyR1Contract(lucyMeta) {
  return lucyContract(lucyMeta) === LUCY_R1_CONTRACT;
}

function denialReason(body) {
  const text = JSON.stringify(body ?? {});
  const match = text.match(/(raw_query_forbidden|ddl_dml_forbidden|read_only_violation|table_forbidden:[^"\\\s,}]+)/);
  return match?.[1];
}

function evidencePass(value, expectedWords) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value.status ?? value.result ?? value.check;
  if (status !== "pass") return false;
  const text = JSON.stringify(value).toLowerCase();
  return expectedWords.some((word) => text.includes(word));
}

function sourceTimeoutEvidencePass(value) {
  return evidencePass(value, ["source_timeout"]);
}

const evidence = {
  connectionId,
  sourceName,
  measure,
  dimension,
  engine,
  wireProtocol: "mysql",
  readonlyAccount: values["readonly-account-confirmed"] === true,
  checkedAt: nowIso(),
  generatedBy,
  projectDir,
  checks: Object.fromEntries(requiredChecks.map((check) => [check, "fail"])),
  checkDetails: {},
  performance: {
    slowQueryThresholdMs: 30000
  },
  artifacts: {}
};

function mark(check, passed, detail) {
  evidence.checks[check] = passed ? "pass" : "fail";
  evidence.checkDetails[check] = {
    ...(evidence.checkDetails[check] ?? {}),
    ...detail,
    status: passed ? "pass" : "fail"
  };
}

function missingInput(check, message) {
  mark(check, false, { reason: "missing_input", message });
}

async function checkKtxConnection() {
  if (!connectionId) {
    missingInput("connection", `--connection or LUCY_R1_${engineEnvPrefix}_CONNECTION is required`);
    return;
  }
  const args = ktxArgs(["connection", "test", connectionId]);
  const result = await run("ktx", args);
  evidence.artifacts.connectionCommand = commandLabel("ktx", args);
  mark("connection", result.ok, {
    command: evidence.artifacts.connectionCommand,
    exitCode: result.code,
    durationMs: result.durationMs,
    stdout: tail(result.stdout),
    stderr: tail(result.stderr),
    error: result.error
  });
}

async function checkSemanticValidate() {
  if (!connectionId || !sourceName) {
    missingInput("typeMapping", "--connection and --source are required");
    return;
  }
  const args = ktxArgs(["sl", "validate", sourceName, "--connection-id", connectionId]);
  const result = await run("ktx", args);
  evidence.artifacts.validateCommand = commandLabel("ktx", args);
  mark("typeMapping", result.ok, {
    command: evidence.artifacts.validateCommand,
    exitCode: result.code,
    durationMs: result.durationMs,
    stdout: tail(result.stdout),
    stderr: tail(result.stderr),
    error: result.error
  });
}

async function checkReadOnlySemanticQuery() {
  if (!connectionId || !measure) {
    missingInput("readonlySelect", "--connection and --measure are required");
    missingInput("limitPagination", "--connection and --measure are required");
    return;
  }
  const queryArgs = ["sl", "--connection-id", connectionId, "query", "--measure", measure];
  if (dimension) queryArgs.push("--dimension", dimension);
  for (const segment of segments) queryArgs.push("--segment", segment);
  queryArgs.push("--limit", String(limit), "--execute", "--max-rows", String(limit), "--format", "json");
  const args = ktxArgs(queryArgs);
  const result = await run("ktx", args);
  evidence.artifacts.readonlyQueryCommand = commandLabel("ktx", args);
  const parsed = firstJsonValue(result.stdout);
  const rows = rowsFromJson(parsed);
  if (result.ok && Array.isArray(rows)) {
    evidence.performance.p50Ms = result.durationMs;
    evidence.performance.p95Ms = result.durationMs;
  }
  mark("readonlySelect", result.ok && Array.isArray(rows), {
    command: evidence.artifacts.readonlyQueryCommand,
    exitCode: result.code,
    durationMs: result.durationMs,
    rowCount: Array.isArray(rows) ? rows.length : undefined,
    stdout: tail(result.stdout),
    stderr: tail(result.stderr),
    error: result.error
  });
  mark("limitPagination", result.ok && Array.isArray(rows) && rows.length <= limit, {
    requestedLimit: limit,
    rowCount: Array.isArray(rows) ? rows.length : undefined
  });
}

async function checkProxyPath() {
  if (!proxyUrl || !token) {
    missingInput("ddlDmlRejected", "--proxy-url and --token are required");
    missingInput("lucyMetadata", "--proxy-url and --token are required");
    missingInput("errorTaxonomy", "--proxy-url and --token are required");
    return;
  }
  try {
    const init = await rpc("", "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: `lucy-r1-${engine}-smoke`, version: "0.1.0" }
    });
    if (!init.ok || init.body?.error || !init.sessionId) {
      throw new Error(`initialize failed: HTTP ${init.status} ${JSON.stringify(init.body?.error ?? init.body)}`);
    }
    await rpc(init.sessionId, "notifications/initialized", {});

    const safeQuery = await rpc(init.sessionId, "tools/call", {
      name: "lucy_query",
      arguments: {
        connectionId,
        measures: [measure],
        dimensions: dimension ? [{ field: dimension }] : [],
        limit,
        include: ["sql"]
      }
    });
    const safeQueryLucyMeta = findLucyMeta(safeQuery.body);
    const safeQueryProvenance = provenanceSummary(safeQueryLucyMeta);
    mark("lucyMetadata", safeQuery.ok && !safeQuery.body?.error && hasLucyR1Contract(safeQueryLucyMeta) && hasResultSummary(safeQueryLucyMeta) && hasProvenanceSummary(safeQueryLucyMeta), {
      httpStatus: safeQuery.status,
      hasLucyMeta: Boolean(safeQueryLucyMeta),
      contract: lucyContract(safeQueryLucyMeta),
      hasLucyR1Contract: hasLucyR1Contract(safeQueryLucyMeta),
      hasResultSummary: hasResultSummary(safeQueryLucyMeta),
      ...safeQueryProvenance,
      response: tail(JSON.stringify(safeQuery.body ?? {}))
    });

    const rawDdl = await rpc(init.sessionId, "tools/call", {
      name: "lucy_query",
      arguments: {
        connectionId,
        query: `DROP TABLE ${sourceName ?? "lucy_r1_guardrail_probe"}`
      }
    });
    const reason = denialReason(rawDdl.body);
    const rejected = rawDdl.ok && (rawDdl.body?.error || rawDdl.body?.result?.isError || reason);
    mark("ddlDmlRejected", Boolean(rejected && reason), {
      httpStatus: rawDdl.status,
      reason,
      response: tail(JSON.stringify(rawDdl.body ?? {}))
    });
    mark("errorTaxonomy", Boolean(reason), {
      reason,
      source: "lucy_query raw-query guardrail"
    });
  } catch (error) {
    const detail = { error: error instanceof Error ? error.message : String(error) };
    mark("ddlDmlRejected", false, detail);
    mark("lucyMetadata", false, detail);
    mark("errorTaxonomy", false, detail);
  }
}

async function checkTimeoutEvidence() {
  if (!timeoutEvidence) {
    missingInput("timeoutClassification", "--timeout-evidence or LUCY_R1_TIMEOUT_EVIDENCE is required");
    return;
  }
  const file = path.isAbsolute(timeoutEvidence) ? timeoutEvidence : path.resolve(projectDir, timeoutEvidence);
  evidence.artifacts.timeoutEvidence = file;
  if (!existsSync(file)) {
    mark("timeoutClassification", false, { file, reason: "missing_file" });
    return;
  }
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    mark("timeoutClassification", sourceTimeoutEvidencePass(value), {
      file,
      evidence: value
    });
  } catch (error) {
    mark("timeoutClassification", false, {
      file,
      reason: "invalid_json",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function main() {
  if (!connectionId) missingInput("connection", `--connection or LUCY_R1_${engineEnvPrefix}_CONNECTION is required`);
  if (!sourceName) missingInput("typeMapping", `--source or LUCY_R1_${engineEnvPrefix}_SOURCE is required`);
  if (!measure) {
    missingInput("readonlySelect", `--measure or LUCY_R1_${engineEnvPrefix}_MEASURE is required`);
    missingInput("limitPagination", `--measure or LUCY_R1_${engineEnvPrefix}_MEASURE is required`);
  }
  if (!evidence.readonlyAccount) {
    evidence.checkDetails.readonlyAccount = {
      status: "fail",
      reason: "missing_operator_confirmation",
      message: `--readonly-account-confirmed is required after the ${targetLabel} credential has been verified as read-only`
    };
  }

  await checkKtxConnection();
  await checkSemanticValidate();
  await checkReadOnlySemanticQuery();
  await checkProxyPath();
  await checkTimeoutEvidence();

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  const failed = requiredChecks.filter((check) => evidence.checks[check] !== "pass");
  if (!evidence.readonlyAccount) failed.push("readonlyAccount");
  const summary = {
    ok: failed.length === 0,
    outFile,
    failed,
    checks: evidence.checks
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length) process.exit(1);
  process.exit(0);
}

main().catch(async (error) => {
  evidence.fatalError = error instanceof Error ? error.message : String(error);
  await mkdir(path.dirname(outFile), { recursive: true }).catch(() => undefined);
  await writeFile(outFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8").catch(() => undefined);
  console.error(`[lucy-r1-${engine}-smoke] FAIL: ${evidence.fatalError}`);
  process.exit(1);
});
