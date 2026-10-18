// Case catalog loader / validator / freezer (Spec §7, §8.1, Plan T10).
// Pure functions plus a tiny CLI:
//   node scripts/e2e/lib/catalog.mjs --check        verify catalog == lock
//   node scripts/e2e/lib/catalog.mjs --write-lock   refresh the lock (a reviewed change)

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const E2E_ROOT = path.resolve(HERE, "..");
export const REPO_ROOT = path.resolve(E2E_ROOT, "../..");
export const CATALOG_PATH = path.join(E2E_ROOT, "contracts", "case-catalog.yaml");
export const LOCK_PATH = path.join(E2E_ROOT, "contracts", "case-catalog.lock.json");
export const LOCK_CONTRACT = "lucy-case-catalog-lock-v1";

export const RUNNERS = ["security", "management", "agent", "gate"];
export const EXECUTOR_LETTERS = ["B", "P", "D", "A", "O", "V"];
export const CAPABILITIES = [
  "lucy-http",
  "fault-control",
  "ktx-upstream",
  "postgres",
  "browser",
  "agent-client",
  "k8s-amd64",
  "ci-runner",
  "network-profile",
  "clock-control",
  "npm-registry"
];
export const ASSERTION_TOKENS = [
  "deny",
  "allow_control",
  "no_side_effect",
  "no_leak",
  "upstream_exec_zero",
  "typed_gold",
  "server_trace",
  "real_query",
  "repeat3",
  "audit_event",
  "artifact_scan",
  "unavailable_not_open",
  "exactly_one_wins",
  "consistency"
];

/** Spec §7: the 32 scenario ids; every one must own at least one required variant. */
export const SPEC_SCENARIO_IDS = [
  ...Array.from({ length: 23 }, (_, i) => `SEC-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 7 }, (_, i) => `UX-${String(i + 1).padStart(2, "0")}`),
  "OPS-01",
  "GATE-01"
];

/** Spec §7 explicitly numbered sub-scenarios; each must be its own catalog variant, not hidden in a parent. */
export const REQUIRED_SUBSCENARIO_IDS = [
  "SEC-09-S01", "SEC-09-S02", "SEC-09-S03", "SEC-09-S04", "SEC-09-S05",
  "UX-02-S01", "UX-04-S01", "UX-04-S02",
  "UX-03-S01", "UX-03-S02", "UX-03-S03",
  "SEC-18-S01", "SEC-18-S02", "SEC-18-S03", "SEC-18-S04", "UX-07-S01",
  "SEC-15-S01", "SEC-22-S01",
  "SEC-15-FM-01", "SEC-15-FM-02", "SEC-15-FM-03", "SEC-15-FM-04", "SEC-15-FM-05", "SEC-15-FM-06", "SEC-15-FM-SEED"
];

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`catalog matrix placeholder {${key}} has no value in "${template}"`);
    return String(values[key]);
  });
}

function cartesian(matrix) {
  return Object.entries(matrix).reduce(
    (acc, [key, list]) => acc.flatMap((combo) => list.map((value) => ({ ...combo, [key]: value }))),
    [{}]
  );
}

/** Expands scenario defaults + matrix variants into the flat, fully specified case list. */
export function expandCatalog(doc) {
  const cases = [];
  for (const [scenarioId, scenario] of Object.entries(doc.scenarios ?? {})) {
    const { variants = [], title, spec, ...defaults } = scenario;
    for (const variant of variants) {
      const { matrix, ...own } = variant;
      const combos = matrix ? cartesian(matrix) : [{}];
      for (const combo of combos) {
        const merged = { ...defaults, ...own };
        cases.push({
          id: fill(String(merged.id), combo),
          scenario: scenarioId,
          title: fill(String(merged.t ?? ""), combo),
          spec: spec ?? null,
          runner: merged.runner,
          executors: merged.executors,
          requires: merged.requires ?? [],
          assert: merged.assert,
          gold: merged.gold,
          artifacts: merged.artifacts,
          repeat: merged.runner === "agent" ? (merged.repeat ?? 1) : 1,
          required: merged.required !== false
        });
      }
    }
  }
  return cases;
}

export function loadCatalog(file = CATALOG_PATH) {
  const doc = parse(readFileSync(file, "utf8"));
  return { doc, cases: expandCatalog(doc), file };
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

/** sha256 over the canonical expanded case list; changes whenever any variant, assertion or flag changes. */
export function catalogDigest(cases) {
  const ordered = [...cases].sort((a, b) => a.id.localeCompare(b.id));
  return `sha256:${createHash("sha256").update(JSON.stringify(sortKeys(ordered))).digest("hex")}`;
}

export function requiredIds(cases) {
  return cases.filter((c) => c.required).map((c) => c.id).sort();
}

/**
 * Returns a list of human-readable problems; empty means the catalog is structurally sound.
 * `goldKeys` are the question keys exported by examples/security-e2e/gold/compute-gold.mjs.
 */
export function validateCatalog(cases, { goldKeys }) {
  const problems = [];
  const seen = new Set();
  for (const c of cases) {
    const where = `case ${c.id}`;
    if (!c.id || typeof c.id !== "string") problems.push(`${where}: missing id`);
    if (seen.has(c.id)) problems.push(`${where}: duplicate id`);
    seen.add(c.id);
    if (!RUNNERS.includes(c.runner)) problems.push(`${where}: runner "${c.runner}" is not one of ${RUNNERS.join("/")}`);
    if (!Array.isArray(c.executors) || c.executors.length === 0) problems.push(`${where}: executors missing`);
    for (const letter of c.executors ?? []) {
      if (!EXECUTOR_LETTERS.includes(letter)) problems.push(`${where}: unknown executor "${letter}"`);
    }
    for (const cap of c.requires) {
      if (!CAPABILITIES.includes(cap)) problems.push(`${where}: unknown capability "${cap}"`);
    }
    if (!Array.isArray(c.assert) || c.assert.length === 0) problems.push(`${where}: assert list is empty`);
    for (const token of c.assert ?? []) {
      if (!ASSERTION_TOKENS.includes(token)) problems.push(`${where}: unknown assertion token "${token}"`);
    }
    if (!Array.isArray(c.artifacts) || c.artifacts.length === 0) problems.push(`${where}: artifacts missing`);
    if (typeof c.gold !== "string" || c.gold === "") {
      problems.push(`${where}: gold must be "none" or a question key`);
    } else if (c.gold !== "none" && !goldKeys.includes(c.gold)) {
      problems.push(`${where}: gold "${c.gold}" is not exported by compute-gold.mjs`);
    }
    const needsGold =
      c.assert.includes("typed_gold") || c.assert.includes("real_query") || c.executors.includes("D") && c.executors.includes("A");
    if (needsGold && c.gold === "none") problems.push(`${where}: data-answer case must reference a typed gold`);
    if (c.runner === "agent" && !c.requires.includes("agent-client")) problems.push(`${where}: agent case must require agent-client`);
    if (c.runner === "management" && !c.requires.includes("browser")) problems.push(`${where}: management case must require browser`);
    if (c.runner !== "agent" && c.repeat !== 1) problems.push(`${where}: repeat only applies to agent cases`);
    if (c.runner === "agent" && c.assert.includes("repeat3") && c.repeat !== 3) problems.push(`${where}: repeat3 needs repeat: 3`);
    if (!c.required) problems.push(`${where}: optional variants are not allowed in the frozen catalog`);
  }
  for (const id of SPEC_SCENARIO_IDS) {
    if (!cases.some((c) => c.scenario === id && c.required)) problems.push(`scenario ${id} has no required variant`);
  }
  for (const id of REQUIRED_SUBSCENARIO_IDS) {
    if (!seen.has(id)) problems.push(`required sub-scenario ${id} is not a catalog variant`);
  }
  return problems;
}

/**
 * The fixed denominator: every (case, required product, run) tuple that must appear in the evidence.
 * Agent cases multiply by required product and repeat count (R9: first run and retries are all kept).
 */
export function expectedExecutions(cases, requiredProducts) {
  const keys = [];
  for (const c of cases.filter((x) => x.required)) {
    if (c.runner === "agent") {
      for (const product of requiredProducts) {
        for (let run = 1; run <= c.repeat; run += 1) keys.push(`${c.id}@${product}#${run}`);
      }
    } else {
      keys.push(c.id);
    }
  }
  return keys.sort();
}

export function executionKey(entry) {
  return entry.client ? `${entry.id}@${entry.client}#${entry.run ?? 1}` : entry.id;
}

export function makeLock(cases) {
  return {
    contract: LOCK_CONTRACT,
    catalogDigest: catalogDigest(cases),
    count: cases.length,
    requiredIds: requiredIds(cases)
  };
}

export function readLock(file = LOCK_PATH) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Compares the live catalog with the lock; returns problems (empty = frozen and unchanged). */
export function checkLock(cases, lock) {
  const problems = [];
  if (lock.contract !== LOCK_CONTRACT) problems.push(`lock contract is "${lock.contract}"`);
  const live = makeLock(cases);
  if (live.catalogDigest !== lock.catalogDigest) problems.push(`catalog digest ${live.catalogDigest} != locked ${lock.catalogDigest}`);
  const lockedIds = new Set(lock.requiredIds);
  for (const id of live.requiredIds) if (!lockedIds.has(id)) problems.push(`required variant ${id} is not in the lock`);
  for (const id of lock.requiredIds) if (!live.requiredIds.includes(id)) problems.push(`locked required variant ${id} was removed or made optional`);
  if (live.count !== lock.count) problems.push(`case count ${live.count} != locked ${lock.count}`);
  return problems;
}

async function goldKeysFromModule() {
  const mod = await import(path.join(REPO_ROOT, "examples/security-e2e/gold/compute-gold.mjs"));
  return Object.keys(mod.computeGold(mod.generateDataset("0123456789abcdef")).questions);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { cases } = loadCatalog();
  const problems = validateCatalog(cases, { goldKeys: await goldKeysFromModule() });
  if (problems.length > 0) {
    process.stderr.write(`catalog invalid:\n- ${problems.join("\n- ")}\n`);
    process.exit(1);
  }
  if (process.argv.includes("--write-lock")) {
    writeFileSync(LOCK_PATH, `${JSON.stringify(makeLock(cases), null, 2)}\n`);
    process.stdout.write(`lock written: ${cases.length} cases\n`);
  } else {
    const lockProblems = checkLock(cases, readLock());
    if (lockProblems.length > 0) {
      process.stderr.write(`catalog drifted from lock:\n- ${lockProblems.join("\n- ")}\n`);
      process.exit(1);
    }
    process.stdout.write(`catalog frozen: ${cases.length} cases, digest ${catalogDigest(cases)}\n`);
  }
}
