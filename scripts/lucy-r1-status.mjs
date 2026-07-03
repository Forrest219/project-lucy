#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";

const { values } = parseArgs({
  options: {
    json: { type: "boolean", default: false },
    "readiness-file": { type: "string" },
    target: { type: "string", default: "doris" },
    help: { type: "boolean", short: "h", default: false }
  },
  allowPositionals: false
});

const USAGE = `Usage:
  npm run r1:status
  npm run r1:status -- --json

Summarizes Lucy R1 release readiness without weakening the strict gate. The
status is diagnostic: it reports missing runtime evidence, current Doris target
configuration, and the next commands to run.`;

const TARGET = String(values.target ?? "doris").trim().toLowerCase();
const TARGET_PROFILES = {
  doris: {
    id: "doris",
    label: "Doris",
    connectionId: "doris-r1",
    engine: "doris",
    evidenceId: "external.doris",
    evidenceEnv: "LUCY_R1_DORIS_EVIDENCE",
    evidenceLabel: "Doris vertical slice evidence",
    dataset: "r1_doris_benchmark",
    timeoutEvidence: "inbox/doris-timeout-evidence.json",
    out: "inbox/doris-r1-evidence.json",
    smokeCommand: "r1:doris-smoke"
  },
  starrocks: {
    id: "starrocks",
    label: "StarRocks",
    connectionId: "starrocks-r1",
    engine: "starrocks",
    evidenceId: "external.starrocks",
    evidenceEnv: "LUCY_R1_STARROCKS_EVIDENCE",
    evidenceLabel: "StarRocks vertical slice evidence",
    dataset: "r1_doris_benchmark",
    timeoutEvidence: "inbox/starrocks-timeout-evidence.json",
    out: "inbox/starrocks-r1-evidence.json",
    smokeCommand: "r1:starrocks-smoke"
  }
};
const TARGET_PROFILE = TARGET_PROFILES[TARGET];
if (!TARGET_PROFILE) {
  console.error(`--target must be doris or starrocks, got ${TARGET}`);
  process.exit(1);
}
const REQUIRED_EXTERNAL = [
  ["external.mcp_contract", "LUCY_R1_MCP_CONTRACT_EVIDENCE", "MCP contract smoke evidence"],
  [TARGET_PROFILE.evidenceId, TARGET_PROFILE.evidenceEnv, TARGET_PROFILE.evidenceLabel],
  ["external.hermes", "LUCY_R1_HERMES_ACCURACY_REPORT", "Hermes >=95% QA accuracy report"]
];
const R1_TOOLS = [
  "lucy_catalog",
  "lucy_read_source",
  "lucy_query",
  "lucy_explain_query",
  "lucy_freshness",
  "lucy_begin_question"
];

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

function absolute(file) {
  return path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
}

function readReadiness() {
  if (typeof values["readiness-file"] === "string" && values["readiness-file"].trim()) {
    const file = absolute(values["readiness-file"].trim());
    return { status: 0, stdout: readFileSync(file, "utf8"), stderr: "", source: file };
  }
  const result = spawnSync(process.execPath, ["scripts/lucy-r1-readiness.mjs", "--strict"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8"
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    source: "npm run r1:readiness:strict"
  };
}

function parseReadiness(readiness) {
  try {
    return JSON.parse(readiness.stdout);
  } catch (error) {
    return {
      ok: false,
      strict: true,
      counts: { fail: 1 },
      results: [{
        status: "fail",
        id: "readiness.parse",
        message: `could not parse readiness output: ${error instanceof Error ? error.message : String(error)}`
      }]
    };
  }
}

function envFileState(envName) {
  const raw = process.env[envName];
  if (!raw || !raw.trim()) return { envName, envSet: false, fileExists: false };
  const file = absolute(raw.trim());
  return {
    envName,
    envSet: true,
    file,
    fileExists: existsSync(file)
  };
}

function readYamlIfExists(file) {
  if (!existsSync(file)) return undefined;
  return parseYaml(readFileSync(file, "utf8"));
}

function targetStatus(profile) {
  const config = readYamlIfExists(absolute("ktx.yaml"));
  const connection = config?.connections?.[profile.connectionId];
  if (!connection) {
    return {
      present: false,
      ready: false,
      reason: `ktx.yaml does not define connections.${profile.connectionId}`
    };
  }
  const checks = {
    engine: connection.engine === profile.engine,
    wireProtocol: connection.wire_protocol === "mysql" || connection.wireProtocol === "mysql",
    readonly: connection.readonly === true,
    r1Target: connection.r1_target === true || connection.r1Target === true,
    enabledTables: Array.isArray(connection.enabled_tables) && connection.enabled_tables.length > 0
  };
  return {
    present: true,
    ready: Object.values(checks).every(Boolean),
    checks
  };
}

function exactRoleStatus(profile) {
  const config = readYamlIfExists(absolute("webui/config/access.yaml"));
  const role = config?.roles?.lucy_r1_exact_readonly;
  const connections = Array.isArray(role?.allow?.connections) ? role.allow.connections : [];
  const tools = Array.isArray(role?.allow?.tools) ? role.allow.tools : [];
  const tableSelectors = Array.isArray(role?.allow?.tableSelectors) ? role.allow.tableSelectors : [];
  const tableSelectorConnections = [...new Set(tableSelectors
    .map((item) => item?.connection)
    .filter((item) => typeof item === "string" && item.trim()))];
  const exactTools = tools.length === R1_TOOLS.length && R1_TOOLS.every((tool) => tools.includes(tool));
  return {
    present: Boolean(role),
    connections,
    tableSelectorConnections,
    exactToolCount: tools.length,
    exactTools,
    pointsToDoris: connections.includes("doris-r1"),
    tableSelectorsPointToDoris: tableSelectorConnections.includes("doris-r1"),
    pointsToTarget: connections.includes(profile.connectionId),
    tableSelectorsPointToTarget: tableSelectorConnections.includes(profile.connectionId)
  };
}

function buildSummary() {
  const readinessRun = readReadiness();
  const readiness = parseReadiness(readinessRun);
  const results = Array.isArray(readiness.results) ? readiness.results : [];
  const externalEvidence = REQUIRED_EXTERNAL.map(([id, envName, label]) => {
    const result = results.find((item) => item?.id === id);
    return {
      id,
      label,
      status: result?.status ?? "missing",
      message: result?.message,
      ...envFileState(envName)
    };
  });
  const missingExternal = externalEvidence.filter((item) => item.status !== "pass");
  const selectedTarget = targetStatus(TARGET_PROFILE);
  const exactRole = exactRoleStatus(TARGET_PROFILE);
  const configReady = selectedTarget.ready === true
    && exactRole.present === true
    && exactRole.exactTools === true
    && exactRole.pointsToTarget === true
    && exactRole.tableSelectorsPointToTarget === true;
  return {
    ok: readiness.ok === true,
    releaseReady: readiness.ok === true && missingExternal.length === 0 && configReady,
    target: TARGET_PROFILE.id,
    configReady,
    readiness: {
      source: readinessRun.source,
      exitStatus: readinessRun.status,
      strict: readiness.strict === true,
      counts: readiness.counts ?? {},
      failures: results
        .filter((item) => item?.status === "fail")
        .map((item) => ({ id: item.id, message: item.message }))
    },
    externalEvidence,
    dorisTarget: TARGET_PROFILE.id === "doris" ? selectedTarget : targetStatus(TARGET_PROFILES.doris),
    selectedTarget,
    exactRole,
    nextCommands: [
      `npm run r1:mcp-contract -- --proxy-url http://127.0.0.1:7879/mcp --token "$LUCY_AGENT_TOKEN" --connection ${TARGET_PROFILE.connectionId} --source ceo_metric_snapshot --measure ceo_metric_snapshot.revenue --dimension ceo_metric_snapshot.biz_date --forbid-tool sl_query --forbid-source hidden_source --forbid-measure hidden_source.revenue --out inbox/lucy-r1-mcp-contract-evidence.json`,
      `npm run ${TARGET_PROFILE.smokeCommand} -- --connection ${TARGET_PROFILE.connectionId} --source ceo_metric_snapshot --measure ceo_metric_snapshot.revenue --dimension ceo_metric_snapshot.biz_date --proxy-url http://127.0.0.1:7879/mcp --token "$LUCY_AGENT_TOKEN" --timeout-evidence ${TARGET_PROFILE.timeoutEvidence} --readonly-account-confirmed --out ${TARGET_PROFILE.out}`,
      `npm run r1:hermes-report -- --cases "$LUCY_R1_BENCHMARK_CASES" --results inbox/hermes-r1-results.json --dataset ${TARGET_PROFILE.dataset} --out inbox/hermes-r1-accuracy.json`,
      `npm run r1:readiness:strict -- --target ${TARGET_PROFILE.id}`,
      "npm run r1:release-bundle -- --observability-url \"http://127.0.0.1:5174/api/r1/observability?hours=24&slowMs=30000\" --eval-artifact inbox/hermes-r1-eval-artifacts --out inbox/lucy-r1-release-bundle"
    ]
  };
}

function printHuman(summary) {
  console.log(`Lucy R1 status: ${summary.releaseReady ? "release-ready" : "not release-ready"}`);
  console.log(`Strict readiness: ${summary.ok ? "pass" : "fail"} (${summary.readiness.counts.pass ?? 0} pass, ${summary.readiness.counts.fail ?? 0} fail, ${summary.readiness.counts.manual ?? 0} manual)`);
  console.log("");
  console.log("External evidence:");
  for (const item of summary.externalEvidence) {
    const env = item.envSet ? `${item.envName}=<set>${item.fileExists ? "" : " (file missing)"}` : `${item.envName}=<unset>`;
    console.log(`- ${item.id}: ${item.status} — ${env}`);
  }
  console.log("");
  console.log(`${TARGET_PROFILE.label} target config: ${summary.selectedTarget.ready ? "ready" : "not ready"}${summary.selectedTarget.reason ? ` — ${summary.selectedTarget.reason}` : ""}`);
  console.log(`Exact R1 role: ${summary.exactRole.present ? "present" : "missing"}; connections=${summary.exactRole.connections.join(",") || "<none>"}; tableSelectorConnections=${summary.exactRole.tableSelectorConnections.join(",") || "<none>"}; exactTools=${summary.exactRole.exactTools}; pointsToTarget=${summary.exactRole.pointsToTarget}; tableSelectorsPointToTarget=${summary.exactRole.tableSelectorsPointToTarget}`);
  console.log(`Config ready: ${summary.configReady}`);
  if (summary.readiness.failures.length > 0) {
    console.log("");
    console.log("Failing readiness items:");
    for (const failure of summary.readiness.failures) {
      console.log(`- ${failure.id}: ${failure.message}`);
    }
  }
  console.log("");
  console.log("Next commands are available with: npm run r1:status -- --json");
}

const summary = buildSummary();
if (values.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  printHuman(summary);
}
