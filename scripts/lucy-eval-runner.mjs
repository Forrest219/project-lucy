#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { listAdapters, normalizeAdapterName, resolveAdapter } from "./eval/adapters/index.mjs";

const RESULT_VERSION = 1;
const SUITE_VERSION = 1;
const SUITE_KIND = "lucy_eval_suite";

const USAGE = `Usage: node scripts/lucy-eval-runner.mjs --suite <eval.yaml> --output <result.json> [options]

Options:
  --suite <path>       Canonical Lucy Eval YAML suite
  --output <path>      Result JSON output path
  --adapter <name>     Agent adapter (default: EVAL_AGENT_ADAPTER or noop)
  --model <name>       Optional model label for metadata
  --help              Show this help

Supported adapters:
  ${listAdapters().map((item) => item.id).join(", ")}
`;

function parseArgs(argv) {
  const out = {
    adapter: normalizeAdapterName(process.env.LUCY_EVAL_RUNNER_ADAPTER || process.env.EVAL_AGENT_ADAPTER || "noop"),
    model: process.env.LUCY_EVAL_RUNNER_MODEL || process.env.EVAL_AGENT_MODEL || "",
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--suite") out.suite = argv[++i];
    else if (arg === "--output") out.output = argv[++i];
    else if (arg === "--adapter") out.adapter = argv[++i];
    else if (arg === "--model") out.model = argv[++i];
    else throw new Error(`unknown arg: ${arg}`);
  }
  return out;
}

function stable(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).filter((k) => k !== "suite_hash").sort()) {
      sorted[key] = stable(value[key]);
    }
    return sorted;
  }
  return value;
}

function suiteHash(suite) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stable(suite)), "utf8").digest("hex")}`;
}

function safeId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]*$/.test(value);
}

function validateSuite(suite) {
  const errors = [];
  if (!suite || typeof suite !== "object" || Array.isArray(suite)) errors.push("suite root must be an object");
  if (suite?.lucy_eval_schema_version !== SUITE_VERSION) errors.push(`lucy_eval_schema_version must be ${SUITE_VERSION}`);
  if (suite?.kind !== SUITE_KIND) errors.push(`kind must be ${SUITE_KIND}`);
  if (!safeId(suite?.suite_id)) errors.push("suite_id must be a safe id");
  if (!safeId(suite?.domain)) errors.push("domain must be a safe id");
  if (!Array.isArray(suite?.cases) || suite.cases.length === 0) errors.push("cases must be a non-empty array");
  for (const [index, evalCase] of (suite?.cases || []).entries()) {
    if (!safeId(evalCase?.id)) errors.push(`cases[${index}].id must be a safe id`);
    if (evalCase?.case_type === "single_turn" && typeof evalCase.question !== "string") {
      errors.push(`cases[${index}].question is required for single_turn`);
    }
    if (evalCase?.case_type === "multi_turn" && !Array.isArray(evalCase.turns)) {
      errors.push(`cases[${index}].turns is required for multi_turn`);
    }
  }
  return errors;
}

function promptForCase(evalCase) {
  if (evalCase.case_type === "multi_turn") {
    return (evalCase.turns || []).map((turn, index) => `Turn ${index + 1}: ${turn.user}`).join("\n");
  }
  return evalCase.question || "";
}

async function runCase(evalCase, adapter) {
  const start = Date.now();
  if (adapter.id === "noop") {
    return {
      case_id: evalCase.id,
      status: "SKIPPED",
      duration_ms: Date.now() - start,
      final_text: `Skipped by noop adapter. Re-run with --adapter <name> to execute locally. Supported: ${listAdapters().map((item) => item.id).join(", ")}`
    };
  }
  try {
    const prompt = promptForCase(evalCase);
    const res = await adapter.invoke({ question: prompt, mcpConfigPath: process.env.EVAL_MCP_CONFIG || "", caseId: evalCase.id });
    if (res.skipped) {
      return {
        case_id: evalCase.id,
        status: "SKIPPED",
        duration_ms: Date.now() - start,
        final_text: "Skipped by adapter."
      };
    }
    if (res.code !== 0) {
      return {
        case_id: evalCase.id,
        status: "ERROR",
        duration_ms: Date.now() - start,
        failures: [`${adapter.id} exited with code ${res.code}`],
        error_message: res.err?.trim() || res.out?.trim() || `${adapter.id} exited with code ${res.code}`
      };
    }
    return {
      case_id: evalCase.id,
      status: "PASS",
      duration_ms: Date.now() - start,
      final_text: res.out?.trim() || res.err?.trim() || ""
    };
  } catch (error) {
    return {
      case_id: evalCase.id,
      status: "ERROR",
      duration_ms: Date.now() - start,
      failures: [error.message || String(error)],
      error_message: error.message || String(error)
    };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (!args.suite || !args.output) {
    throw new Error("--suite and --output are required");
  }

  const adapter = resolveAdapter(args.adapter);
  if (adapter.id !== "noop") {
    await adapter.preflight();
  }

  const suiteText = await readFile(args.suite, "utf8");
  const suite = parseYaml(suiteText);
  const errors = validateSuite(suite);
  if (errors.length > 0) {
    throw new Error(`Invalid Eval YAML:\n${errors.map((e) => `- ${e}`).join("\n")}`);
  }

  const computedHash = suiteHash(suite);
  const startedAt = new Date().toISOString();
  const results = [];
  for (const evalCase of suite.cases) {
    results.push(await runCase(evalCase, adapter));
  }
  const finishedAt = new Date().toISOString();

  const result = {
    lucy_eval_result_version: RESULT_VERSION,
    suite_id: suite.suite_id,
    suite_hash: suite.suite_hash || computedHash,
    domain: suite.domain,
    runner: {
      kind: adapter.id,
      version: "lucy-eval-runner-v1",
      ...(args.model ? { model: args.model } : {})
    },
    started_at: startedAt,
    finished_at: finishedAt,
    results
  };
  await writeFile(args.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(`fatal: ${error.stack || error.message || error}`);
  process.exit(2);
});
