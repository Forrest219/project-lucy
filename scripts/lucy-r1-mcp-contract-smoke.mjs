#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const R1_TOOLS = [
  "lucy_catalog",
  "lucy_read_source",
  "lucy_query",
  "lucy_explain_query",
  "lucy_freshness",
  "lucy_begin_question"
];

const LEGACY_UPSTREAM_SEMANTIC_TOOLS = [
  "sl_query",
  "sl_read_source"
];

const RAW_SQL_DENIAL_REASON_PATTERN = /^(raw_query_forbidden|ddl_dml_forbidden|read_only_violation|table_forbidden:)/;
const CONCURRENCY_DENIAL_REASON = "query_concurrency_exceeded";
const LUCY_R1_CONTRACT = "lucy-r1-controlled-data-service";
const RUNTIME_ARGUMENT_VALIDATION_PROBES = [
  {
    tool: "lucy_query",
    arguments: () => ({ connectionId, limit: 10 }),
    expectedReasonPattern: /^invalid_arguments:lucy_query:/
  },
  {
    tool: "lucy_explain_query",
    arguments: () => ({ connectionId, limit: 10 }),
    expectedReasonPattern: /^invalid_arguments:lucy_explain_query:/
  },
  {
    tool: "lucy_read_source",
    arguments: () => ({ connectionId }),
    expectedReasonPattern: /^invalid_arguments:lucy_read_source:/
  },
  {
    tool: "lucy_freshness",
    arguments: () => ({ connectionId }),
    expectedReasonPattern: /^invalid_arguments:lucy_freshness:/
  }
];
const TOOL_SCHEMA_REQUIREMENTS = {
  lucy_catalog: [],
  lucy_read_source: ["connectionId", "sourceName"],
  lucy_query: ["connectionId"],
  lucy_explain_query: ["connectionId"],
  lucy_freshness: ["connectionId", "sourceName"],
  lucy_begin_question: ["intentSummary"]
};

const REQUIRED_CHECKS = [
  "initialize",
  "toolSurface",
  "upstreamSemanticToolsHidden",
  "toolSchemas",
  "negativeSamples",
  "deniedToolsHidden",
  "forbiddenToolRejected",
  "catalog",
  "forbiddenTableRejected",
  "explainQuery",
  "concurrencyGuardrail",
  "freshness",
  "beginQuestion",
  "rawSqlRejected",
  "runtimeArgumentValidation",
  "queryArgumentNormalization",
  "limitCapped",
  "readSourceMetadata",
  "lucyMetadata"
];

const { values } = parseArgs({
  options: {
    "proxy-url": { type: "string" },
    token: { type: "string" },
    connection: { type: "string", short: "c" },
    source: { type: "string", short: "s" },
    measure: { type: "string", short: "m" },
    dimension: { type: "string", short: "d" },
    "forbid-tool": { type: "string", multiple: true },
    "forbid-source": { type: "string", multiple: true },
    "forbid-measure": { type: "string", multiple: true },
    out: { type: "string", short: "o", default: "inbox/lucy-r1-mcp-contract-evidence.json" },
    help: { type: "boolean", short: "h", default: false }
  },
  allowPositionals: false
});

const USAGE = `Usage:
  npm run r1:mcp-contract -- \\
    --proxy-url http://127.0.0.1:7879/mcp \\
    --token "$LUCY_AGENT_TOKEN" \\
    --connection doris-r1 \\
    --source ceo_metric_snapshot \\
    --measure ceo_metric_snapshot.revenue \\
    --dimension ceo_metric_snapshot.biz_date \\
    --forbid-tool sql_execution \\
    --forbid-source forbidden_source \\
    --forbid-measure forbidden_source.revenue \\
    --out inbox/lucy-r1-mcp-contract-evidence.json

Required for a passing evidence file:
  --proxy-url, --token, --connection, --source, --measure,
  at least one --forbid-tool, --forbid-source, and --forbid-measure

The script validates the live Lucy MCP Proxy R1 contract and fails closed.`;

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

function stringValue(name, envName) {
  const value = values[name] ?? process.env[envName];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const proxyUrl = stringValue("proxy-url", "LUCY_R1_PROXY_URL");
const token = stringValue("token", "LUCY_R1_PROXY_TOKEN");
const connectionId = stringValue("connection", "LUCY_R1_CONTRACT_CONNECTION");
const sourceName = stringValue("source", "LUCY_R1_CONTRACT_SOURCE");
const measure = stringValue("measure", "LUCY_R1_CONTRACT_MEASURE");
const dimension = stringValue("dimension", "LUCY_R1_CONTRACT_DIMENSION");
const forbiddenTools = Array.isArray(values["forbid-tool"]) ? values["forbid-tool"] : [];
const forbiddenSources = Array.isArray(values["forbid-source"]) ? values["forbid-source"] : [];
const forbiddenMeasures = Array.isArray(values["forbid-measure"]) ? values["forbid-measure"] : [];
const outFile = path.resolve(String(values.out ?? "inbox/lucy-r1-mcp-contract-evidence.json"));

const evidence = {
  contract: "lucy-r1-controlled-data-service",
  target: "lucy-mcp-proxy",
  checkedAt: new Date().toISOString(),
  generatedBy: "scripts/lucy-r1-mcp-contract-smoke.mjs",
  proxyUrl,
  connectionId,
  sourceName,
  checks: Object.fromEntries(REQUIRED_CHECKS.map((check) => [check, "fail"])),
  checkDetails: {}
};

function tail(value, max = 3000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > max ? text.slice(text.length - max) : text;
}

function mark(check, passed, detail = {}) {
  evidence.checks[check] = passed ? "pass" : "fail";
  evidence.checkDetails[check] = {
    ...(evidence.checkDetails[check] ?? {}),
    ...detail,
    status: passed ? "pass" : "fail"
  };
}

function parseRpcBody(text) {
  if (!text.startsWith("event:")) return JSON.parse(text);
  const line = text.split("\n").find((item) => item.startsWith("data: "));
  if (!line) throw new Error("SSE response does not contain a data line");
  return JSON.parse(line.slice(6));
}

async function rpc(sessionId, method, params) {
  if (!proxyUrl || !token) throw new Error("--proxy-url and --token are required");
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
    body: parseRpcBody(text),
    text
  };
}

function toolNames(listBody) {
  return (listBody?.result?.tools ?? []).map((tool) => tool.name).sort();
}

function toolByName(listBody) {
  return new Map((listBody?.result?.tools ?? []).map((tool) => [tool.name, tool]));
}

function inspectToolSchemas(byName) {
  const schemaMissing = [];
  const invalidSchemas = [];
  for (const [toolName, requiredFields] of Object.entries(TOOL_SCHEMA_REQUIREMENTS)) {
    const schema = byName.get(toolName)?.inputSchema;
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      schemaMissing.push(toolName);
      continue;
    }
    if (schema.type !== "object") {
      invalidSchemas.push({ tool: toolName, reason: "schema_type_must_be_object", actual: schema.type });
    }
    const required = Array.isArray(schema.required) ? schema.required : [];
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? schema.properties
      : {};
    for (const field of requiredFields) {
      if (!required.includes(field)) {
        invalidSchemas.push({ tool: toolName, field, reason: "required_field_missing" });
      }
      if (!Object.hasOwn(properties, field)) {
        invalidSchemas.push({ tool: toolName, field, reason: "property_missing" });
      }
    }
  }
  return {
    schemaMissing,
    invalidSchemas,
    expectedRequired: TOOL_SCHEMA_REQUIREMENTS
  };
}

function resultText(body) {
  return JSON.stringify(body?.result ?? body ?? {});
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

function resultContains(body, phrase) {
  return resultText(body).includes(phrase);
}

function findFieldValue(value, field) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return undefined;
    try {
      return findFieldValue(JSON.parse(text), field);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object") return undefined;
  if (Object.hasOwn(value, field)) return value[field];
  for (const nested of Object.values(value)) {
    const found = findFieldValue(nested, field);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findNumericField(value, field) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return undefined;
    try {
      return findNumericField(JSON.parse(text), field);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object") return undefined;
  if (typeof value[field] === "number" && Number.isFinite(value[field])) return value[field];
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNumericField(item, field);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const item of Object.values(value)) {
    const found = findNumericField(item, field);
    if (found !== undefined) return found;
  }
  return undefined;
}

function denialReason(body) {
  const text = resultText(body);
  const directReason = body?.error?.data?.reason;
  if (typeof directReason === "string" && directReason.trim()) return directReason.trim();
  const match = text.match(/(query_concurrency_exceeded|invalid_arguments:[^"\\\s,}]+|raw_query_forbidden|ddl_dml_forbidden|read_only_violation|tool_forbidden_global|tool_forbidden|table_forbidden:[^"\\\s,}]+|unknown_or_forbidden_connection:[^"\\\s,}]+)/);
  return match?.[1];
}

function safeQueryArgs() {
  const args = {
    connectionId,
    measures: [measure],
    limit: 5,
    include: ["sql"]
  };
  if (dimension) args.dimensions = [{ field: dimension }];
  return args;
}

async function concurrencyProbe(sessionId, maxConcurrentQueries) {
  if (typeof maxConcurrentQueries !== "number" || !Number.isFinite(maxConcurrentQueries) || maxConcurrentQueries < 1) {
    return {
      attempted: false,
      probeCount: 0,
      denialCount: 0,
      deniedReasons: [],
      responses: []
    };
  }
  const probeCount = Math.min(Math.floor(maxConcurrentQueries) + 1, 16);
  const calls = Array.from({ length: probeCount }, (_, index) => rpc(sessionId, "tools/call", {
    name: "lucy_query",
    arguments: {
      ...safeQueryArgs(),
      limit: 1,
      contractProbe: `concurrency-${index + 1}`
    }
  }));
  const responses = await Promise.all(calls);
  const deniedReasons = responses
    .map((response) => denialReason(response.body))
    .filter((reason) => typeof reason === "string" && reason.trim());
  return {
    attempted: true,
    probeCount,
    denialCount: deniedReasons.filter((reason) => reason === CONCURRENCY_DENIAL_REASON).length,
    deniedReasons,
    responses: responses.map((response) => ({
      httpStatus: response.status,
      reason: denialReason(response.body),
      response: tail(response.body, 1000)
    }))
  };
}

async function runtimeArgumentValidationProbes(sessionId) {
  const probes = [];
  for (const probe of RUNTIME_ARGUMENT_VALIDATION_PROBES) {
    const response = await rpc(sessionId, "tools/call", {
      name: probe.tool,
      arguments: probe.arguments()
    });
    const reason = denialReason(response.body);
    probes.push({
      tool: probe.tool,
      httpStatus: response.status,
      reason,
      passed: response.ok && probe.expectedReasonPattern.test(String(reason ?? "")),
      response: tail(response.body)
    });
  }
  return probes;
}

function ensureInputs() {
  const missing = [];
  if (!proxyUrl) missing.push("--proxy-url or LUCY_R1_PROXY_URL");
  if (!token) missing.push("--token or LUCY_R1_PROXY_TOKEN");
  if (!connectionId) missing.push("--connection or LUCY_R1_CONTRACT_CONNECTION");
  if (!sourceName) missing.push("--source or LUCY_R1_CONTRACT_SOURCE");
  if (!measure) missing.push("--measure or LUCY_R1_CONTRACT_MEASURE");
  if (missing.length) throw new Error(`missing required inputs: ${missing.join(", ")}`);
}

async function main() {
  try {
    ensureInputs();
    const init = await rpc("", "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "lucy-r1-mcp-contract-smoke", version: "0.1.0" }
    });
    mark("initialize", init.ok && !init.body?.error && Boolean(init.sessionId), {
      httpStatus: init.status,
      sessionIdPresent: Boolean(init.sessionId),
      response: tail(init.body)
    });
    if (!init.ok || init.body?.error || !init.sessionId) throw new Error("initialize failed");
    await rpc(init.sessionId, "notifications/initialized", {});

    const list = await rpc(init.sessionId, "tools/list", {});
    const names = toolNames(list.body);
    const missingTools = R1_TOOLS.filter((tool) => !names.includes(tool));
    const extraTools = names.filter((tool) => !R1_TOOLS.includes(tool));
    const exposedUpstreamSemanticTools = LEGACY_UPSTREAM_SEMANTIC_TOOLS.filter((tool) => names.includes(tool));
    const exposedForbiddenTools = forbiddenTools.filter((tool) => names.includes(tool));
    mark("toolSurface", list.ok && !list.body?.error && missingTools.length === 0 && extraTools.length === 0, {
      tools: names,
      expectedTools: R1_TOOLS,
      missingTools,
      extraTools
    });
    mark("upstreamSemanticToolsHidden", exposedUpstreamSemanticTools.length === 0, {
      forbiddenUpstreamSemanticTools: LEGACY_UPSTREAM_SEMANTIC_TOOLS,
      exposedUpstreamSemanticTools,
      message: "R1 agents must use lucy_* tools; upstream semantic tools stay behind the proxy adapter"
    });
    const byName = toolByName(list.body);
    const schemaInspection = inspectToolSchemas(byName);
    mark("toolSchemas", schemaInspection.schemaMissing.length === 0 && schemaInspection.invalidSchemas.length === 0, schemaInspection);
    mark("negativeSamples", forbiddenTools.length > 0 && forbiddenSources.length > 0 && forbiddenMeasures.length > 0, {
      forbiddenTools,
      forbiddenSources,
      forbiddenMeasures,
      message: "R1 contract smoke requires at least one denied tool, one hidden source, and one forbidden measure/table probe"
    });
    mark("deniedToolsHidden", forbiddenTools.length > 0 && exposedForbiddenTools.length === 0, {
      forbiddenTools,
      exposedForbiddenTools
    });
    if (forbiddenTools.length > 0) {
      const forbiddenToolCall = await rpc(init.sessionId, "tools/call", {
        name: forbiddenTools[0],
        arguments: {}
      });
      const forbiddenToolReason = denialReason(forbiddenToolCall.body);
      mark("forbiddenToolRejected", forbiddenToolCall.ok && /^(tool_forbidden|tool_forbidden_global)$/.test(String(forbiddenToolReason ?? "")), {
        httpStatus: forbiddenToolCall.status,
        forbiddenTool: forbiddenTools[0],
        reason: forbiddenToolReason,
        response: tail(forbiddenToolCall.body)
      });
    } else {
      mark("forbiddenToolRejected", false, {
        reason: "missing_forbidden_tool"
      });
    }

    const catalog = await rpc(init.sessionId, "tools/call", {
      name: "lucy_catalog",
      arguments: {}
    });
    const leakedSources = forbiddenSources.filter((source) => resultContains(catalog.body, source));
    mark("catalog", catalog.ok && !catalog.body?.error && forbiddenSources.length > 0 && leakedSources.length === 0, {
      httpStatus: catalog.status,
      leakedSources,
      response: tail(catalog.body)
    });

    let forbiddenTableReason;
    if (forbiddenMeasures.length > 0) {
      const forbiddenQuery = await rpc(init.sessionId, "tools/call", {
        name: "lucy_query",
        arguments: {
          connectionId,
          measures: [forbiddenMeasures[0]],
          limit: 5
        }
      });
      forbiddenTableReason = denialReason(forbiddenQuery.body);
      mark("forbiddenTableRejected", forbiddenQuery.ok && Boolean(forbiddenTableReason), {
        httpStatus: forbiddenQuery.status,
        forbiddenMeasure: forbiddenMeasures[0],
        reason: forbiddenTableReason,
        response: tail(forbiddenQuery.body)
      });
    } else {
      mark("forbiddenTableRejected", false, {
        reason: "missing_forbidden_measure"
      });
    }

    const explain = await rpc(init.sessionId, "tools/call", {
      name: "lucy_explain_query",
      arguments: safeQueryArgs()
    });
    const maxConcurrentQueries = findNumericField(explain.body, "maxConcurrentQueries");
    const explainExecutionMode = findFieldValue(explain.body, "executionMode");
    const explainExecuted = findFieldValue(explain.body, "executed");
    mark("explainQuery", explain.ok
      && !explain.body?.error
      && resultContains(explain.body, "guardrails")
      && explainExecutionMode === "plan_only"
      && explainExecuted === false, {
      httpStatus: explain.status,
      executionMode: explainExecutionMode,
      executed: explainExecuted,
      response: tail(explain.body)
    });
    const concurrency = await concurrencyProbe(init.sessionId, maxConcurrentQueries);
    mark("concurrencyGuardrail", explain.ok
      && !explain.body?.error
      && maxConcurrentQueries !== undefined
      && maxConcurrentQueries >= 1
      && concurrency.attempted
      && concurrency.denialCount > 0, {
      httpStatus: explain.status,
      maxConcurrentQueries,
      ...concurrency,
      response: tail(explain.body)
    });

    const freshness = await rpc(init.sessionId, "tools/call", {
      name: "lucy_freshness",
      arguments: { connectionId, sourceName }
    });
    mark("freshness", freshness.ok && !freshness.body?.error && resultContains(freshness.body, "metadata_only"), {
      httpStatus: freshness.status,
      response: tail(freshness.body)
    });

    const begin = await rpc(init.sessionId, "tools/call", {
      name: "lucy_begin_question",
      arguments: {
        intentSummary: "Lucy R1 contract smoke",
        question: "Validate R1 MCP contract",
        entities: [sourceName]
      }
    });
    mark("beginQuestion", begin.ok && !begin.body?.error && resultContains(begin.body, "turnId"), {
      httpStatus: begin.status,
      response: tail(begin.body)
    });

    const raw = await rpc(init.sessionId, "tools/call", {
      name: "lucy_query",
      arguments: {
        connectionId,
        query: `DROP TABLE ${sourceName}`
      }
    });
    const reason = denialReason(raw.body);
    mark("rawSqlRejected", raw.ok && RAW_SQL_DENIAL_REASON_PATTERN.test(String(reason ?? "")), {
      httpStatus: raw.status,
      reason,
      response: tail(raw.body)
    });

    const invalidArgProbes = await runtimeArgumentValidationProbes(init.sessionId);
    const invalidArgsReason = invalidArgProbes.find((probe) => probe.tool === "lucy_query")?.reason;
    mark("runtimeArgumentValidation", invalidArgProbes.every((probe) => probe.passed), {
      reason: invalidArgsReason,
      probes: invalidArgProbes
    });

    const capped = await rpc(init.sessionId, "tools/call", {
      name: "lucy_query",
      arguments: {
        ...safeQueryArgs(),
        limit: 999999
      }
    });
    const effectiveLimit = findNumericField(capped.body, "effectiveLimit");
    const maxLimit = findNumericField(capped.body, "maxLimit");
    mark("limitCapped", capped.ok && !capped.body?.error && effectiveLimit !== undefined && maxLimit !== undefined && effectiveLimit <= maxLimit, {
      httpStatus: capped.status,
      effectiveLimit,
      maxLimit,
      response: tail(capped.body)
    });

    const query = await rpc(init.sessionId, "tools/call", {
      name: "lucy_query",
      arguments: safeQueryArgs()
    });
    const queryLucyMeta = findLucyMeta(query.body);
    const queryProvenance = provenanceSummary(queryLucyMeta);
    mark("lucyMetadata", query.ok && !query.body?.error && hasLucyR1Contract(queryLucyMeta) && hasResultSummary(queryLucyMeta) && hasProvenanceSummary(queryLucyMeta), {
      httpStatus: query.status,
      hasLucyMeta: Boolean(queryLucyMeta),
      contract: lucyContract(queryLucyMeta),
      hasLucyR1Contract: hasLucyR1Contract(queryLucyMeta),
      hasResultSummary: hasResultSummary(queryLucyMeta),
      ...queryProvenance,
      response: tail(query.body)
    });

    const canonicalOrder = [{ field: dimension ?? measure, direction: "desc" }];
    const normalizationProbe = await rpc(init.sessionId, "tools/call", {
      name: "lucy_query",
      arguments: {
        ...safeQueryArgs(),
        filters: "[]",
        orderBy: canonicalOrder
      }
    });
    const normalizationMeta = findLucyMeta(normalizationProbe.body);
    const normalizationProvenance = normalizationMeta?.provenance;
    const normalizedFilters = normalizationProvenance?.filters;
    const normalizedOrder = normalizationProvenance?.orderBy;
    mark(
      "queryArgumentNormalization",
      normalizationProbe.ok
        && !normalizationProbe.body?.error
        && Array.isArray(normalizedFilters)
        && JSON.stringify(normalizedOrder) === JSON.stringify(canonicalOrder),
      {
        httpStatus: normalizationProbe.status,
        serializedFiltersRestored: Array.isArray(normalizedFilters),
        orderAliasCanonicalized: JSON.stringify(normalizedOrder) === JSON.stringify(canonicalOrder),
        response: tail(normalizationProbe.body)
      }
    );

    const readSource = await rpc(init.sessionId, "tools/call", {
      name: "lucy_read_source",
      arguments: { connectionId, sourceName }
    });
    const readSourceLucyMeta = findLucyMeta(readSource.body);
    mark("readSourceMetadata", readSource.ok && !readSource.body?.error && hasLucyR1Contract(readSourceLucyMeta), {
      httpStatus: readSource.status,
      hasLucyMeta: Boolean(readSourceLucyMeta),
      contract: lucyContract(readSourceLucyMeta),
      hasLucyR1Contract: hasLucyR1Contract(readSourceLucyMeta),
      response: tail(readSource.body)
    });
  } catch (error) {
    evidence.fatalError = error instanceof Error ? error.message : String(error);
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const failed = REQUIRED_CHECKS.filter((check) => evidence.checks[check] !== "pass");
  const summary = {
    ok: failed.length === 0,
    outFile,
    failed,
    checks: evidence.checks
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
