#!/usr/bin/env node
/**
 * Fallback checker for end-to-end ledger links (DEVELOPMENT §端到端三台账).
 * Verifies registered suite paths + latest run files exist.
 * Does not claim UAT freshness or Spec status consistency.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Registered rows that must resolve on disk (keep in sync with docs/governance/e2e-ledger.md §2). */
const REQUIRED = [
  {
    poolId: "P0-3",
    suiteId: "UAT-SUITE-SOURCE-AMBIGUITY",
    suiteDir: "docs/qa/uat/suites/source-ambiguity-gate",
    latestRun: "docs/qa/uat/suites/source-ambiguity-gate/runs/2026-11-14-claude-macmini-p0-post-upgrade.md"
  },
  {
    poolId: "P0-1",
    suiteId: "UAT-SUITE-CALIBER-BINDING",
    suiteDir: "docs/qa/uat/suites/question-type-caliber-binding",
    latestRun: "docs/qa/uat/suites/question-type-caliber-binding/runs/2026-11-14-claude-macmini-p0-post-upgrade.md"
  },
  {
    poolId: "P0-A",
    suiteId: "UAT-SUITE-FIELD-EXPOSURE",
    suiteDir: "docs/qa/uat/suites/semantic-source-field-exposure",
    latestRun: "docs/qa/uat/suites/semantic-source-field-exposure/runs/2026-11-14-claude-macmini-p0-post-upgrade.md"
  },
  {
    poolId: "P0-4",
    suiteId: "UAT-SUITE-ANSWER-VERIFIABILITY",
    suiteDir: "docs/qa/uat/suites/answer-verifiability",
    latestRun: "docs/qa/uat/suites/answer-verifiability/runs/2026-11-14-claude-macmini-p0-post-upgrade.md"
  },
  {
    poolId: "P0-5",
    suiteId: "UAT-SUITE-EMPTY-NEXT-STEP",
    suiteDir: "docs/qa/uat/suites/empty-result-next-step",
    latestRun: "docs/qa/uat/suites/empty-result-next-step/runs/2026-11-14-claude-macmini-p0-post-upgrade.md"
  },
  {
    poolId: "P0-2",
    suiteId: "UAT-SUITE-CATALOG-SEMANTICS",
    suiteDir: "docs/qa/uat/suites/catalog-business-semantics",
    latestRun: "docs/qa/uat/suites/catalog-business-semantics/runs/2026-11-14-claude-macmini-p0-post-upgrade.md"
  },
  {
    poolId: "P1-15",
    suiteId: "UAT-SUITE-CONN-RELOAD",
    suiteDir: "docs/qa/uat/suites/connection-runtime-reload",
    latestRun: "docs/qa/uat/suites/connection-runtime-reload/runs/2026-11-13-claude-adversarial.md"
  },
  {
    poolId: "P1-16",
    suiteId: "UAT-SUITE-CATALOG-SCAN",
    suiteDir: "docs/qa/uat/suites/catalog-scan-read-path",
    latestRun: "docs/qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-claude-adversarial.md"
  },
  {
    poolId: "P1-17",
    suiteId: "UAT-SUITE-ACCESS-MAP",
    suiteDir: "docs/qa/uat/suites/access-map-sankey-empty",
    latestRun: "docs/qa/uat/suites/access-map-sankey-empty/runs/2026-11-14-claude-macmini-p119-access-map.md"
  },
  {
    poolId: "P1-19",
    suiteId: "UAT-SUITE-ACCESS-MAP",
    suiteDir: "docs/qa/uat/suites/access-map-sankey-empty",
    latestRun: "docs/qa/uat/suites/access-map-sankey-empty/runs/2026-11-14-claude-macmini-p119-access-map.md"
  },
  {
    poolId: "P1-13",
    suiteId: "UAT-SUITE-ROLES-AGENT-PERF",
    suiteDir: "docs/qa/uat/suites/roles-agent-page-perf",
    latestRun: "docs/qa/uat/suites/roles-agent-page-perf/runs/2026-11-13-cursor-docker-page-perf.md"
  },
  {
    poolId: "P1-21",
    suiteId: "UAT-SUITE-EVENT-LOOP-RELIEF",
    suiteDir: "docs/qa/uat/suites/event-loop-relief",
    latestRun: "docs/qa/uat/suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md"
  },
  {
    poolId: "P1-40",
    suiteId: "UAT-SUITE-COPY-FAKE-SUCCESS",
    suiteDir: "docs/qa/uat/suites/copy-fake-success",
    latestRun: "docs/qa/uat/suites/copy-fake-success/runs/2026-11-17-cursor-copy-probe-hardened.md"
  },
  {
    poolId: "P1-42",
    suiteId: "UAT-SUITE-BUTTON-FEEDBACK",
    suiteDir: "docs/qa/uat/suites/button-feedback",
    latestRun: "docs/qa/uat/suites/button-feedback/runs/2026-11-17-cursor-button-feedback-after-fix.md"
  },
  {
    poolId: "P1-31",
    suiteId: "UAT-SUITE-PAGE-SWEEP",
    suiteDir: "docs/qa/uat/suites/page-event-loop-sweep",
    latestRun: "docs/qa/uat/suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-rebuild.md"
  },
  {
    poolId: "P1-32",
    suiteId: "UAT-SUITE-PAGE-SWEEP",
    suiteDir: "docs/qa/uat/suites/page-event-loop-sweep",
    latestRun: "docs/qa/uat/suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-rebuild.md"
  },
  {
    poolId: "P1-33",
    suiteId: "UAT-SUITE-PAGE-SWEEP",
    suiteDir: "docs/qa/uat/suites/page-event-loop-sweep",
    latestRun: "docs/qa/uat/suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-rebuild.md"
  },
  {
    poolId: "P1-32",
    suiteId: "UAT-SUITE-EQUIV-GUARD",
    suiteDir: "docs/qa/uat/suites/audit-scale-equivalence-guard",
    latestRun: "docs/qa/uat/suites/audit-scale-equivalence-guard/runs/2026-11-16-claude-equiv-first.md"
  },
  {
    poolId: "P1-33",
    suiteId: "UAT-SUITE-EQUIV-GUARD",
    suiteDir: "docs/qa/uat/suites/audit-scale-equivalence-guard",
    latestRun: "docs/qa/uat/suites/audit-scale-equivalence-guard/runs/2026-11-16-claude-equiv-first.md"
  },
  {
    poolId: "P1-30",
    suiteId: "UAT-SUITE-CONTEXT-CONTENT",
    suiteDir: "docs/qa/uat/suites/context-content",
    latestRun: "docs/qa/uat/suites/context-content/runs/2026-11-15-claude-ctx-content.md"
  },
  {
    poolId: "P1-11",
    suiteId: "UAT-SUITE-OPS-CONCEPTS",
    suiteDir: "docs/qa/uat/suites/ops-concepts",
    latestRun: "docs/qa/uat/suites/ops-concepts/runs/2026-11-15-cursor-p1-27-ops-retest.md"
  },
  {
    poolId: "P1-27",
    suiteId: "UAT-SUITE-OPS-CONCEPTS",
    suiteDir: "docs/qa/uat/suites/ops-concepts",
    latestRun: "docs/qa/uat/suites/ops-concepts/runs/2026-11-15-cursor-p1-27-ops-retest.md"
  },
  {
    poolId: "P1-28",
    suiteId: "UAT-SUITE-ROW-POLICY",
    suiteDir: "docs/qa/uat/suites/row-policy-finance-scenario",
    latestRun: "docs/qa/uat/suites/row-policy-finance-scenario/runs/2026-11-22-cursor-row-policy-decouple-retest.md"
  },
  {
    poolId: "P1-29",
    suiteId: "UAT-SUITE-ROW-POLICY",
    suiteDir: "docs/qa/uat/suites/row-policy-finance-scenario",
    latestRun: "docs/qa/uat/suites/row-policy-finance-scenario/runs/2026-11-22-cursor-row-policy-decouple-retest.md"
  },
  {
    poolId: "P1-12",
    suiteId: "UAT-SUITE-QUESTION-BUDGET",
    suiteDir: "docs/qa/uat/suites/question-budget",
    latestRun: "docs/qa/uat/suites/question-budget/runs/2026-11-16-cursor-p1-12-budget-uat-rerun.md"
  },
  {
    poolId: "P1-14",
    suiteId: "UAT-SUITE-BUDGET-AUDIT",
    suiteDir: "docs/qa/uat/suites/budget-audit",
    latestRun: "docs/qa/uat/suites/budget-audit/runs/2026-11-15-cursor-p1-14-audit-retest.md"
  }
];

const INDEX = "docs/qa/uat/INDEX.md";
const LEDGER = "docs/governance/e2e-ledger.md";
const DEV = "docs/governance/DEVELOPMENT.md";

let failed = 0;

function ok(msg) {
  console.log(`  ok   — ${msg}`);
}
function fail(msg) {
  failed += 1;
  console.error(`  FAIL — ${msg}`);
}

function mustExist(rel, label) {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) fail(`${label} missing: ${rel}`);
  else ok(`${label}: ${rel}`);
}

console.log("== e2e ledger link check ==");

mustExist(DEV, "DEVELOPMENT");
mustExist(LEDGER, "e2e-ledger");
mustExist(INDEX, "UAT INDEX");

const indexText = readFileSync(path.join(root, INDEX), "utf8");
const ledgerText = readFileSync(path.join(root, LEDGER), "utf8");
const devText = readFileSync(path.join(root, DEV), "utf8");

if (!devText.includes("端到端三台账")) {
  fail("DEVELOPMENT.md missing section 端到端三台账");
} else {
  ok("DEVELOPMENT.md has 端到端三台账");
}

for (const row of REQUIRED) {
  mustExist(path.join(row.suiteDir, "suite.md"), `${row.poolId} suite.md`);
  mustExist(path.join(row.suiteDir, "cases.md"), `${row.poolId} cases.md`);
  mustExist(path.join(row.suiteDir, "fixtures.md"), `${row.poolId} fixtures.md`);
  if (row.latestRun) mustExist(row.latestRun, `${row.poolId} latest run`);
  else ok(`${row.poolId} has no run yet`);
  if (!indexText.includes(row.suiteId)) fail(`INDEX missing ${row.suiteId}`);
  else ok(`INDEX lists ${row.suiteId}`);
  if (!ledgerText.includes(row.poolId) || !ledgerText.includes(row.suiteId)) {
    fail(`e2e-ledger.md missing link ${row.poolId} ↔ ${row.suiteId}`);
  } else {
    ok(`e2e-ledger links ${row.poolId} ↔ ${row.suiteId}`);
  }
}

if (failed > 0) {
  console.error(`\nFAILED: ${failed} check(s)`);
  process.exit(1);
}
console.log("\nPASSED: e2e ledger links");
