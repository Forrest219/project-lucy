// Product-track target selector for one mainline or one branch.
// A call with no target keeps today's full management collection.

import { loadCatalog } from "./catalog.mjs";
import { loadCoverage } from "./v025-coverage.mjs";

export const PRODUCT_TARGETS = Object.freeze([
  "mainline", "CONN", "SEM", "ACCESS", "OBSERVE", "AGENT", "LIFECYCLE"
]);

export const REAL_CONFIG = "webui/playwright.real.config.ts";
export const UPGRADE_CONFIG = "webui/playwright.upgrade.config.ts";
export const LIFECYCLE_COMMAND = "scripts/e2e/run-upgrade-features.mjs";
export const LIFECYCLE_CONTRACT = "lucy-upgrade-checklist/v1";

export const FROZEN_SPECS = Object.freeze([
  "webui/tests/real-e2e/mainline-journey.spec.ts",
  "webui/tests/real-e2e/admin-auth.spec.ts",
  "webui/tests/real-e2e/management-journey.spec.ts",
  "webui/tests/real-e2e/context-isolation.spec.ts",
  "webui/tests/real-e2e/audit-export.spec.ts"
]);

const REAL = "webui/tests/real-e2e";

const FILE_LAYER = Object.freeze({
  [`${REAL}/journey-v025.spec.ts`]: "mixed",
  [`${REAL}/connection-matrix-v025.spec.ts`]: "mixed",
  [`${REAL}/semantic-batch-v025.spec.ts`]: "mixed",
  [`${REAL}/row-policy-v025.spec.ts`]: "protocol",
  [`${REAL}/row-policy-templates-v025.spec.ts`]: "mixed",
  [`${REAL}/authorization-summary-v025.spec.ts`]: "protocol",
  [`${REAL}/audit-reconciliation-v025.spec.ts`]: "mixed",
  [`${REAL}/access-map-v025.spec.ts`]: "mixed",
  "webui/tests/upgrade-e2e/upgrade-features.spec.ts": "mixed"
});

function numbered(prefix, count) {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, "0")}`);
}

export const SELECTED_IDS = Object.freeze({
  mainline: Object.freeze(["J25-01"]),
  CONN: Object.freeze(numbered("CON25-", 12)),
  SEM: Object.freeze(["SEM25-V17", "SEM25-V09", "SEM25-V20", "SEM25-V16", "SEM25-V05", "SEM25-V06"]),
  ACCESS: Object.freeze([
    "ROW25-V08", "ROW25-V12", "ROW25-V09", "ROW25-V10", "ROW25-V04", "ROW25-V05",
    ...numbered("RTP25-", 10),
    ...numbered("RTV25-", 8),
    ...numbered("ASV25-", 14)
  ]),
  OBSERVE: Object.freeze([
    "ARV25-V01", "ARV25-V02", "ARV25-V03", "ARV25-V05", "ARV25-V06",
    "ARV25-V04", "ARV25-V07", "ARV25-V08", "ARV25-V09", "ARV25-V10", "ARV25-V11",
    ...numbered("ACM25-SC-", 14)
  ])
});

const TARGETS = Object.freeze({
  mainline: {
    files: [`${REAL}/journey-v025.spec.ts`],
    evidenceLayer: "mixed",
    config: REAL_CONFIG,
    command: null
  },
  CONN: {
    files: [`${REAL}/connection-matrix-v025.spec.ts`],
    evidenceLayer: "mixed",
    config: REAL_CONFIG,
    command: null
  },
  SEM: {
    files: [`${REAL}/semantic-batch-v025.spec.ts`],
    evidenceLayer: "mixed",
    config: REAL_CONFIG,
    command: null
  },
  ACCESS: {
    files: [
      `${REAL}/row-policy-v025.spec.ts`,
      `${REAL}/row-policy-templates-v025.spec.ts`,
      `${REAL}/authorization-summary-v025.spec.ts`
    ],
    evidenceLayer: "mixed",
    config: REAL_CONFIG,
    command: null
  },
  OBSERVE: {
    files: [`${REAL}/audit-reconciliation-v025.spec.ts`, `${REAL}/access-map-v025.spec.ts`],
    evidenceLayer: "mixed",
    config: REAL_CONFIG,
    command: null
  },
  AGENT: {
    files: [],
    evidenceLayer: "real-agent",
    config: null,
    command: "scripts/e2e/run-agent-journey.mjs"
  },
  LIFECYCLE: {
    files: ["webui/tests/upgrade-e2e/upgrade-features.spec.ts"],
    evidenceLayer: "mixed",
    config: UPGRADE_CONFIG,
    command: LIFECYCLE_COMMAND
  }
});

export function filesFor(target) {
  return [...(TARGETS[target]?.files ?? [])];
}

export function evidenceLayerFor(target) {
  return TARGETS[target]?.evidenceLayer ?? null;
}

export function configFor(target) {
  return TARGETS[target]?.config ?? null;
}

export function commandFor(target) {
  return TARGETS[target]?.command ?? null;
}

export function fileLayer(file) {
  return FILE_LAYER[file] ?? null;
}

export function agentIdsForExecutor(coverage, cases) {
  const owners = new Set(
    [...(coverage.existing ?? []), ...(coverage.newScenarios ?? [])]
      .filter((row) => row.ownerBranch === "AGENT")
      .map((row) => row.executionId)
  );
  const runners = new Set(cases.filter((entry) => entry.runner === "agent").map((entry) => entry.id));
  return [...owners].filter((id) => runners.has(id)).sort();
}

export function selectedIdsFor(target, extras = {}) {
  if (target === "AGENT") return agentIdsForExecutor(loadCoverage(), loadCatalog().cases);
  if (target === "LIFECYCLE") return [...(extras.selectedIds ?? [])];
  const ids = SELECTED_IDS[target];
  if (!ids) throw new Error(`unknown target ${target}`);
  return [...ids];
}

export function untargetedPlaywrightArgs({ project = "chromium", grep } = {}) {
  const args = ["test", "-c", "playwright.real.config.ts", "--project", project, "--workers", "1", "--retries", "0"];
  if (grep) args.push("--grep", grep);
  return args;
}

export function managementPlaywrightArgs(target) {
  if (configFor(target) !== REAL_CONFIG) {
    throw new Error(`${target} does not use playwright.real.config.ts`);
  }
  return {
    config: "playwright.real.config.ts",
    configPath: REAL_CONFIG,
    files: filesFor(target).map((file) => file.slice("webui/".length))
  };
}

export function productExitCode({ selectedIds, resultsById }) {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) throw new Error("empty selection");
  let passedCount = 0;
  let sawFailed = false;
  let sawBlocked = false;
  for (const id of selectedIds) {
    const status = resultsById?.[id]?.status;
    if (status === "passed") passedCount += 1;
    else if (status === "failed") sawFailed = true;
    else sawBlocked = true;
  }
  const status = sawFailed ? "failed" : sawBlocked ? "blocked" : "passed";
  return { status, exitCode: status === "passed" ? 0 : status === "failed" ? 1 : 2, passedCount };
}

export function assertEvidenceStamp({ target, file, stamped, recordText }) {
  const layer = file ? fileLayer(file) : null;
  if (typeof recordText === "string" && recordText.includes("页面旅程完成") && (stamped === "protocol" || layer === "protocol")) {
    throw new Error("protocol record must not say 页面旅程完成");
  }
  if (layer === "protocol" && stamped === "browser") throw new Error("protocol file stamped browser");
  if (target && evidenceLayerFor(target) === "mixed" && stamped === "protocol" && layer !== "protocol") {
    throw new Error("mixed target stamped protocol");
  }
}

export function lifecycleSelectionFromChecklist(checklist, { childRunId, resultFile } = {}) {
  if (checklist?.contract !== LIFECYCLE_CONTRACT) {
    throw new Error(`lifecycle selection requires ${LIFECYCLE_CONTRACT}`);
  }
  const selectedIds = (checklist.entries ?? []).map((entry) => entry.id).filter((id) => typeof id === "string" && id.length > 0);
  if (selectedIds.length === 0) throw new Error("empty selection");
  return {
    target: "LIFECYCLE",
    command: LIFECYCLE_COMMAND,
    contract: LIFECYCLE_CONTRACT,
    childRunId,
    resultFile,
    files: filesFor("LIFECYCLE"),
    evidenceLayer: evidenceLayerFor("LIFECYCLE"),
    selectedIds
  };
}

function describe(target) {
  return {
    target,
    files: filesFor(target),
    evidenceLayer: evidenceLayerFor(target),
    config: configFor(target),
    command: commandFor(target),
    selectedIds: target === "LIFECYCLE" ? [] : selectedIdsFor(target)
  };
}

export function selectProductTarget(argv) {
  const list = argv.includes("--list");
  const targets = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--target") continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error("empty target");
    targets.push(value);
    index += 1;
  }
  if (list && targets.length === 0) return { execute: false, listings: PRODUCT_TARGETS.map(describe) };
  if (targets.length !== 1) throw new Error("exactly one target");
  const target = targets[0];
  if (!PRODUCT_TARGETS.includes(target)) throw new Error(`unknown target ${target}`);
  const selected = describe(target);
  if (!list && target !== "LIFECYCLE" && selected.selectedIds.length === 0) throw new Error("empty selection");
  return { execute: !list, ...selected };
}

export function renderSelection(selected) {
  const rows = selected.listings ?? [selected];
  return `${rows.map((row) => [
    `target=${row.target}`,
    `evidenceLayer=${row.evidenceLayer}`,
    `config=${row.config ?? "none"}`,
    ...(row.files?.length ? row.files.map((file) => `file=${file}`) : ["file=none"]),
    row.command ? `command=${row.command}` : null
  ].filter(Boolean).join("\n")).join("\n\n")}\n`;
}
