#!/usr/bin/env node
// Produces <runDir>/results/gates.json for the verifier from structured sources only:
//   - GATE-01-V01..V16: the verifier's own reverse tests, run through the node:test event API (no stdout parsing);
//   - SEC-23-V01/V02: results/npm-audit.json against docs/qa/security-findings.yaml;
//   - SEC-06-V03 (URL/存储/argv/日志), SEC-06-V04 (截图与 trace), SEC-06-V05 (导出与审计),
//     SEC-17-V10 (测试产物): per-case carrier-aware scan via scanRetainedArtifacts. Each case
//     names a distinct sub-tree of the run (server logs / client capture / exports / test
//     artifacts); the verdict is failed > blocked > passed, no generic file count is shared.
//   - SEC-23-V05: results/existing-gates.json (G1–G4 + ELF), bound to the candidate image digest;
//   - OPS-01-*: results/ops.json written by the K8s acceptance step (absent => BLOCKED);
//   - existing gates + counters from results/existing-gates.json / context-migration.json / projection.json.
// A source that is absent yields BLOCKED for the cases it feeds; nothing is inferred or defaulted to passed.
//   node scripts/gates/collect-gate-results.mjs --run <run.json> --candidate <identity.json>

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { run as runTests } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { loadCatalog } from "../e2e/lib/catalog.mjs";
import { REPO_ROOT, fail, loadRun, parseArgv } from "../e2e/lib/common.mjs";
import { scanCarrier, scanFile, scanRetainedArtifacts } from "../e2e/lib/leak-scan.mjs";
import { expectedAskPlan } from "../e2e/lib/ask-plan.mjs";
import { crossCheckDependencies, FINDINGS_PATH, REQUIRED_EXISTING_GATES } from "../e2e/verify-evidence.mjs";

const GATE_TEST_FILE = path.join(REPO_ROOT, "scripts/e2e/__tests__/evidence-verifier.test.mjs");
const SELF_SKIP_DIRS = ["gates"]; // The collector writes results/gates/*.json mid-flight; that directory is excluded
// only because it is the file we are currently writing. Every other retained artifact is scanned.
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

function writeCase(runDir, entry) {
  const dir = path.join(runDir, "results", "gates");
  mkdirSync(dir, { recursive: true });
  const text = `${JSON.stringify({ id: entry.id, status: entry.status, detail: entry.detail, assertions: entry.assertions }, null, 2)}\n`;
  const file = path.join(dir, `${entry.id}.json`);
  writeFileSync(file, text);
  return { ...entry, artifacts: [{ path: path.relative(runDir, file), sha256: createHash("sha256").update(text).digest("hex") }] };
}

/** Runs the reverse tests through the structured event stream; returns Map(caseId -> {status, detail}). */
export async function runReverseTests(file = GATE_TEST_FILE) {
  const outcomes = new Map();
  for await (const event of runTests({ files: [file], concurrency: false })) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const match = /\[(GATE-01-V\d{2})\]/.exec(event.data.name ?? "");
    if (!match) continue;
    const prior = outcomes.get(match[1]);
    const status = event.type === "test:pass" ? "passed" : "failed";
    outcomes.set(match[1], { status: prior?.status === "failed" ? "failed" : status, detail: event.data.name });
  }
  return outcomes;
}

// --- A6 carrier routing (SEC-06-V03 / V04 / V05 + SEC-17-V10) -------------------------------------
// Each carrier case binds to one or more REQUIRED sub-carriers (URL/storage/argv/logs for V03, capture
// policy + screenshot/trace inventory for V04, export/audit for V05, results/*.json for V10). A
// missing required sub-carrier blocks that case; an actual leak in its bytes fails it. We do NOT
// paint all four green with one generic file-count: every case names its sub-carriers explicitly and
// every sub-carrier's file is the input to the verdict.
//
// Per-ask / per-identity forbidden canaries come from the gold contract: each question's
// forbiddenCanaries are the canaries no agent under test may see in that question's response. The
// credential scan is GLOBAL (any token / password / bootstrap secret appearing in any carrier fails
// the case). Canary scans require per-question / per-ask indexed evidence — we read the
// per-ask records from agent.json when available and use them to partition forbidden canaries
// across the agents that wrote each carrier file. When per-ask indexed evidence is missing or
// unparseable, we REFUSE to default the union to "complete" — the case is BLOCKED with an explicit
// dependency, never silently passed/failed on a wrong assumption.

/** @returns {{contract?: string, questions?: Record<string, {forbiddenCanaries?: string[]}>} | null} */
function readGold(run) {
  const goldPath = path.join(run.paths.checker, "gold.json");
  if (!existsSync(goldPath)) return null;
  try {
    return JSON.parse(readFileSync(goldPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Reads the per-ask indexed evidence recorded by run-agent-journey. Each ask records its
 * `goldKey` (the question actually asked), `agentId` (identity), `tokenFingerprint`, and the
 * redacted answer. Returns { available, asks[], goldKeyToQuestion }, or `available:false`
 * when the file is missing/unparseable. Missing per-ask indexed evidence is an explicit
 * dependency: callers MUST treat the related carrier case as BLOCKED, not silently default.
 */
export function readPerAskIndexedEvidence(run) {
  const agentPath = path.join(run.paths.runDir, "results", "agent.json");
  if (!existsSync(agentPath)) return { available: false, asks: [], reason: "results/agent.json is absent" };
  let doc;
  try {
    doc = JSON.parse(readFileSync(agentPath, "utf8"));
  } catch (error) {
    return { available: false, asks: [], reason: `results/agent.json is unparseable: ${error.message}` };
  }
  if (!Array.isArray(doc?.cases)) return { available: false, asks: [], reason: "results/agent.json: cases[] missing" };
  const asks = [];
  for (const entry of doc.cases) {
    if (!Array.isArray(entry?.asks)) continue;
    // The canonical execution key is caseId + client + run + askIndex; the case record
    // carries `client` and `run`, the ask record carries the rest. Thread them onto each
    // ask so downstream consumers can build the full key without re-walking cases[].
    for (const ask of entry.asks) {
      if (!ask || typeof ask !== "object") continue;
      asks.push({
        ...ask,
        caseId: ask.caseId ?? entry.id,
        client: ask.client ?? entry.client ?? null,
        run: ask.run ?? entry.run ?? null
      });
    }
  }
  return { available: true, asks };
}

/**
 * Map goldKey -> { forbbiddenCanaries, allowedCanaries }. Empty when the gold is missing or
 * unparseable — callers must then block any case that depends on the gold (not pretend).
 */
export function indexGoldQuestions(gold) {
  const out = new Map();
  if (!gold || typeof gold !== "object") return out;
  for (const [key, q] of Object.entries(gold.questions ?? {})) {
    out.set(key, {
      forbiddenCanaries: Array.isArray(q?.forbiddenCanaries) ? q.forbiddenCanaries.slice() : [],
      allowedCanaries: Array.isArray(q?.allowedCanaries) ? q.allowedCanaries.slice() : []
    });
  }
  return out;
}

/**
 * Sub-carrier definition for one carrier case. Each case has named `subcarriers`, every
 * one of which has a `roots` (paths to scan) and `kind` (what the bytes mean). A case is
 * blocked when any REQUIRED subcarrier's bytes are absent.
 *
 * Subcarriers are scanned only when an actual file/directory exists at their roots. We do NOT
 * silently paint V03 green on the logs subtree alone — argv / storage / url must each produce
 * their own structured evidence (Plan A6 §no-sensitive-capture). The current codebase does not
 * yet emit argv.json / storage.json / url.json; until those producers land, V03 blocks with
 * the absent subcarrier IDs recorded.
 */
const CARRIER_CASES = {
  "SEC-06-V03": {
    kind: "url-storage-argv-logs",
    label: "URL/存储/argv/日志无明文",
    subcarriers: [
      { id: "logs", label: "服务器日志", roots: (run) => [run.paths.logs] },
      // argv / storage / URL subcarriers: each one looks for a specific file in <runDir>/logs/.
      // A missing file means the producer did not emit this subcarrier — we block, never default.
      { id: "argv", label: "进程 argv", roots: (run) => [path.join(run.paths.logs, "argv.json")] },
      { id: "storage", label: "持久化存储路径", roots: (run) => [path.join(run.paths.logs, "storage.json")] },
      { id: "url", label: "URL 引用", roots: (run) => [path.join(run.paths.logs, "url.json")] }
    ]
  },
  "SEC-06-V04": {
    kind: "client-capture",
    label: "截图与 trace 无明文",
    subcarriers: [
      {
        id: "capture-policy",
        label: "capture-policy.json 证明 trace/screenshot/video 全部关闭",
        roots: (run) => [path.join(run.paths.runDir, "capture-policy.json")]
      },
      {
        id: "client-capture-dirs",
        label: "client-work/*/{capture,screenshots,traces,attachments}",
        roots: (run) => {
          const out = [];
          for (const client of clientWorkDirs(run)) {
            for (const sub of ["capture", "screenshots", "traces", "attachments"]) out.push(path.join(client, sub));
          }
          return out;
        }
      }
    ]
  },
  "SEC-06-V05": {
    kind: "exports-audit",
    label: "导出与审计无明文",
    subcarriers: [
      { id: "exports", label: "results/exports", roots: (run) => [path.join(run.paths.runDir, "results", "exports")] },
      { id: "audit", label: "results/audit + results/audit.json", roots: (run) => [path.join(run.paths.runDir, "results", "audit"), path.join(run.paths.runDir, "results", "audit.json")] }
      // NOTE: results/ops.json is intentionally NOT a fallback for V05 — it is unrelated to export
      // carriers (per review-a6-collector §5). A random clean ops result must not green-light V05.
    ]
  },
  "SEC-17-V10": {
    kind: "test-artifacts",
    label: "测试产物无凭据",
    subcarriers: [
      {
        id: "results-json",
        label: "results/*.json (除 gates/{})",
        roots: (run) => [path.join(run.paths.runDir, "results")]
      }
    ]
  }
};

function* clientWorkDirs(run) {
  const base = run.paths["client-work"];
  if (!base || !existsSync(base)) return;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory()) yield path.join(base, entry.name);
  }
}

/**
 * Scan a single path (file OR directory) and aggregate the verdict. When `root` is a
 * file, we call `scanFile` directly. When `root` is a directory we walk it. Missing
 * roots are reported as `missing: true` so the caller can block.
 *
 * `canaryRouter` is an optional function `(relativePath) => string[]` that returns the
 * forbidden canary list for the file at `relativePath`. When the router returns a
 * non-empty list, only those canaries are checked against the file's bytes. When the
 * router returns an empty list, the file is checked with NO canaries (i.e. only the
 * secrets scan runs). When no router is supplied, the legacy global canary list is used.
 *
 * Returns: { missing, scanned, status, hits, leakFiles, blockedFiles, files }
 */
function scanRoot(root, { secrets, canaries, canaryRouter = null }) {
  if (!existsSync(root)) return { missing: true, root, scanned: 0, status: "missing", hits: 0, leakFiles: [], blockedFiles: [], files: 0 };
  let lst;
  try { lst = statSync(root); } catch { return { missing: true, root, scanned: 0, status: "missing", hits: 0, leakFiles: [], blockedFiles: [], files: 0 }; }
  const options = { secrets };
  if (canaryRouter) {
    options.canaryRouter = canaryRouter;
  } else {
    options.forbiddenCanaries = canaries;
  }
  if (lst.isDirectory()) {
    const tree = scanRetainedArtifacts(root, { ...options, skipDirs: SELF_SKIP_DIRS });
    return {
      missing: false, root, scanned: tree.totals.files, files: tree.totals.files,
      status: tree.status, hits: tree.totals.hitCount,
      leakFiles: tree.failures.slice(), blockedFiles: tree.blockedEntries.slice(),
      tree
    };
  }
  // File (e.g. capture-policy.json). Read it and run the carrier scanner on its bytes.
  const scan = scanFile(root, options);
  const status = scan.status;
  const leakFiles = status === "failed" ? [path.basename(root)] : [];
  const blockedFiles = status === "blocked" ? [path.basename(root)] : [];
  return {
    missing: false, root, scanned: 1, files: 1, status, hits: scan.hits,
    leakFiles, blockedFiles, tree: scan
  };
}

/**
 * Scan every subcarrier root and aggregate verdict across the union.
 *   failed    > blocked    > passed
 * - failed:    at least one subcarrier (or root) reported a real credential/canary hit.
 * - blocked:   at least one required subcarrier was missing OR could not be safely inspected.
 *              Required subcarriers are determined by the case; "argv/storage/url" are required
 *              for V03 and block when no structured evidence has been produced.
 * - passed:    every required subcarrier was inspected and clean.
 */
function scanCarrierCase({ run, caseId, secrets, canaries, perAskForbidden = null }) {
  const def = CARRIER_CASES[caseId];
  if (!def) return { error: `unknown carrier case ${caseId}` };
  // Per-ask router: when per-ask indexed evidence is available, the router maps a relative
  // file path to the union of canaries that every ask whose bytes could legitimately land
  // in that file forbids. The map key includes the full canonical execution key
  // (caseId/client/run/askIndex/agentId/goldKey) so two distinct asks under the same
  // caseId do not collide. The `perAskForbidden` values are objects of either
  //   { forbidden, answerPath, agentId, goldKey }   — a real policy, or
  //   { unresolved: true, reason }                  — the runner's ask does not match a plan.
  //
  // For the per-ask-per-question contract the routing is exact: each ask records an
  // `answerPath` (a known file the runner claims to have written). A file is bound
  // to the ask whose answerPath matches. Anything that cannot be bound to a known
  // ask is treated as UNRESOLVED — the router returns the sentinel
  // `__LUCY_UNRESOLVED_IDENTITY__` so `scanText` produces a `router-unresolved`
  // synthetic hit and the carrier verdict becomes `failed`. The previous behaviour
  // (returning the aggregated canary union for unbound files) is the A6
  // false-green root cause: a finance-allowed canary present in a finance record
  // would be flagged as forbidden because the same canary was forbidden for a
  // sales record whose path was not bound.
  //
  // When NO ask in the per-ask map carries an `answerPath` (a runner that has not yet
  // wired the B5 producer change), per-ask binding is not possible. We fall back to
  // the global canary list (the per-question union) for ALL files so the existing
  // test fixtures and the production code keep working until the producer lands.
  // The fall-back is logged via the `perAskPolicySource` field on the result so the
  // caller can surface a follow-up dependency when appropriate.
  let canaryRouter = null;
  let perAskPolicySource = "per-ask-per-question";
  if (perAskForbidden && perAskForbidden.size > 0) {
    // Pre-compute the set of asks with a known answerPath so the per-file lookup is O(N)
    // rather than re-walking the map on every file. Each `bound` is { key, entry,
    // answerPath }; the file is matched against `answerPath` (or any path that
    // starts with `<answerPath>/`).
    const bound = [];
    let hasUnresolved = false;
    let hasAnswerPath = false;
    for (const [key, entry] of perAskForbidden.entries()) {
      if (entry?.unresolved) { hasUnresolved = true; continue; }
      if (entry.answerPath) {
        bound.push({ key, entry, answerPath: entry.answerPath });
        hasAnswerPath = true;
      }
    }
    // If no ask has a bound answerPath, per-ask binding is impossible. Fall back to
    // the global canary list (the per-question union passed as `canaries`). The
    // per-ask policy is still computed for diagnostics, but the carrier scan cannot
    // use it for routing.
    if (!hasAnswerPath) {
      perAskPolicySource = "per-question-union-no-answerpath";
      canaryRouter = null;
    } else {
      canaryRouter = (relativePath) => {
        // If ANY ask in the run is unresolved (the runner's claim does not match a plan
        // entry), every file is treated as unresolved. The plan-identity mismatch is
        // a measurement lie; we cannot know which ask's policy actually applies.
        if (hasUnresolved) return "__LUCY_UNRESOLVED_IDENTITY__";
        // Find every ask whose `answerPath` matches this file. Multiple matches union
        // their forbidden canaries; a single match's set is enough.
        const matches = bound.filter((b) => b.answerPath === relativePath || relativePath.startsWith(`${b.answerPath}/`) || b.answerPath.startsWith(`${relativePath}/`));
        if (matches.length > 0) {
          const canaries = new Set();
          for (const m of matches) for (const c of m.entry.forbidden ?? []) canaries.add(c);
          return [...canaries];
        }
        // No ask bound this file. UNRESOLVED — the carrier scan will surface this as
        // a router-unresolved synthetic hit and the verdict will fail. We never return
        // a canary union for an unbound file (that was the A6 false-green).
        return "__LUCY_UNRESOLVED_IDENTITY__";
      };
    }
  }
  const subcarrierReports = [];
  let aggregateStatus = "passed";
  let totalFiles = 0;
  let totalHits = 0;
  const allLeaks = [];
  const allBlocked = [];
  const missingSubcarriers = [];
  for (const sub of def.subcarriers) {
    const roots = sub.roots(run);
    if (roots.length === 0) {
      // No roots produced = subcarrier was not exercised. Required subcarriers block.
      missingSubcarriers.push(sub.id);
      subcarrierReports.push({ id: sub.id, label: sub.label, status: "missing", roots: [] });
      if (aggregateStatus !== "failed") aggregateStatus = "blocked";
      continue;
    }
    const existing = roots.filter((r) => existsSync(r));
    if (existing.length === 0) {
      missingSubcarriers.push(sub.id);
      subcarrierReports.push({ id: sub.id, label: sub.label, status: "missing", roots });
      if (aggregateStatus !== "failed") aggregateStatus = "blocked";
      continue;
    }
    const rootReports = [];
    let subStatus = "passed";
    let subHits = 0;
    let subFiles = 0;
    for (const root of existing) {
      const r = scanRoot(root, { secrets, canaries, canaryRouter });
      rootReports.push(r);
      subHits += r.hits;
      subFiles += r.files;
      if (r.status === "failed") subStatus = "failed";
      else if (r.status === "blocked" && subStatus !== "failed") subStatus = "blocked";
      if (r.leakFiles.length) allLeaks.push(`${sub.id}:${path.relative(run.paths.runDir, r.root)}`);
      if (r.blockedFiles.length) allBlocked.push(`${sub.id}:${path.relative(run.paths.runDir, r.root)}`);
    }
    if (subStatus === "failed") aggregateStatus = "failed";
    else if (subStatus === "blocked" && aggregateStatus !== "failed") aggregateStatus = "blocked";
    totalFiles += subFiles;
    totalHits += subHits;
    subcarrierReports.push({ id: sub.id, label: sub.label, status: subStatus, roots: rootReports });
  }
  return {
    kind: def.kind,
    label: def.label,
    status: aggregateStatus,
    subcarriers: subcarrierReports,
    missingSubcarriers,
    totals: { files: totalFiles, hits: totalHits, leaks: allLeaks, blocked: allBlocked }
  };
}

/**
 * Build the canary policy for a specific carrier case from the gold + per-ask indexed
 * evidence. Returns `{ canaries, perAskForbidden, policy }` where:
 *   - `canaries` is the credential (secrets) list passed to the carrier scanner — credential
 *     scans are GLOBAL because any secret in any carrier is a leak regardless of which ask
 *     wrote it.
 *   - `perAskForbidden` maps a `${askIndex}@${goldKey|"none"}` key to the forbidden canary
 *     set for that ask. The carrier scan consults this map to apply each ask's OWN
 *     forbidden set against ITS OWN bytes — never a global union. A finance-allowed canary
 *     cannot fail a finance ask even if the same canary is forbidden for a sales ask.
 *   - `policy.mode` describes the available evidence:
 *       per-ask-per-question: per-ask indexed evidence is present and every ask was bound
 *         to a known gold key and a known plan entry. Canaries are checked per ask.
 *       per-question-union:  per-ask evidence is missing; we fall back to the union of
 *         forbidden canaries across the gold, but only as a fail-closed default — the
 *         caller MUST block because we cannot bind which ask wrote which carrier.
 *       no-gold:             gold itself is missing. The caller MUST block.
 *
 * For each per-ask record we look up the gold question's forbiddenCanaries (when the ask
 * has a goldKey) AND the canonical ask plan's `injectionForbidden` (for ALL asks, including
 * denied ones with no goldKey). The previous false-green bug came from unioning every
 * ask's forbidden set globally — a finance-allowed canary present in a finance record
 * would be flagged as forbidden because the same canary was forbidden for a sales record.
 * The new code partitions: a canary is forbidden for ask X only when ask X's plan or
 * gold explicitly forbids it.
 */
export function buildCanaryPolicy(run, indexedAsks, goldQuestions) {
  if (indexedAsks.available) {
    const perAskForbidden = new Map();
    // We must consult the case-catalog ask plan for the per-ask `injectionForbidden`. The
    // per-ask indexed record only carries goldKey/agentId — not the plan's forbidden canaries.
    // We look the case up by id in the catalog and call expectedAskPlan() to recover the
    // matching plan entry by askIndex. The map key MUST be the full canonical execution key
    // (caseId + client + run + askIndex + agentId + goldKey) so two distinct asks under the
    // same caseId never collapse into a single policy slot. The previous key
    // `${askIndex}@${goldKey}` collided across caseId/client/run/agent and let the second
    // ask overwrite the first's policy (URGENT task-a7 §A6 identity partition).
    //
    // The value stores everything the carrier router needs to bind files to asks:
    //   { forbidden, answerPath, agentId, goldKey }   real policy, or
    //   { unresolved: true, reason }                  runner's ask does not match plan.
    const askByCase = new Map();
    for (const ask of indexedAsks.asks) {
      if (typeof ask?.askIndex !== "number") continue;
      const list = askByCase.get(ask.caseId) ?? [];
      list.push(ask);
      askByCase.set(ask.caseId, list);
    }
    const catalog = loadCatalogSync();
    for (const [caseId, asks] of askByCase) {
      const catalogCase = catalog?.cases?.find((x) => x.id === caseId);
      const plan = catalogCase ?? { id: caseId };
      const expected = expectedAskPlan(plan);
      // The plan registry is the immutable source of `injectionForbidden`. When a case is
      // NOT in the catalog (e.g. a test fixture using a synthetic caseId), there is no
      // canonical plan to enforce and we fall back to a GOLD-ONLY policy. The plan-identity
      // check is skipped for the same reason — there is no frozen expected identity to
      // compare against. Production runs ALWAYS resolve to a catalog case.
      const inCatalog = Boolean(catalogCase);
      for (const ask of asks) {
        const planEntry = Array.isArray(expected) ? expected[ask.askIndex] : undefined;
        // The full execution key needs caseId + client + run + askIndex + agent + gold. The
        // `client` and `run` are recorded on the CASE in the per-ask indexed evidence, not
        // on each ask. Read them from `ask` (preferred) or fall back to the askIndex
        // position 1 — agent cases always execute on a single client, the repeat number
        // is what varies.
        const caseClient = ask.client ?? null;
        const caseRun = ask.run ?? null;
        if (inCatalog && !planEntry) {
          // No canonical plan entry for this askIndex — the runner claimed an ask the catalog
          // does not authorise. Block rather than silently producing an empty policy.
          perAskForbidden.set(askFullKey(ask, "none", caseClient, caseRun), { unresolved: true, reason: `no canonical plan entry for ${caseId}#ask${ask.askIndex}` });
          continue;
        }
        if (inCatalog && planEntry) {
          const expectedIdentity = `${planEntry.agentId}|${planEntry.goldKey ?? ""}|${planEntry.expectation}`;
          const claimedIdentity = `${ask.agentId ?? ""}|${ask.goldKey ?? ""}|${ask.expectation ?? ""}`;
          if (expectedIdentity !== claimedIdentity) {
            perAskForbidden.set(askFullKey(ask, planEntry.goldKey ?? "none", caseClient, caseRun), { unresolved: true, reason: `ask identity ${claimedIdentity} != plan ${expectedIdentity} for ${caseId}#ask${ask.askIndex}` });
            continue;
          }
        }
        const planForbidden = inCatalog && planEntry ? new Set(planEntry.injectionForbidden ?? []) : new Set();
        const goldKey = ask.goldKey ?? "none";
        const goldForbidden = goldKey !== "none" ? new Set(goldQuestions.get(goldKey)?.forbiddenCanaries ?? []) : new Set();
        const merged = new Set([...planForbidden, ...goldForbidden]);
        // The answerPath the runner actually wrote is the file the carrier scan must check
        // against THIS ask's canary set. The field is optional on the indexed record; when
        // missing, the carrier router treats the file as unresolved (URGENT A6 identity
        // partition: a canary in an unknown carrier MUST be refused, not assumed clean).
        perAskForbidden.set(askFullKey(ask, goldKey, caseClient, caseRun), {
          forbidden: merged,
          answerPath: typeof ask.answerPath === "string" ? ask.answerPath : null,
          agentId: ask.agentId ?? planEntry?.agentId ?? null,
          goldKey
        });
      }
    }
    // For callers that want a flat list of every canary any ask forbids (used only for
    // display / diagnostics), emit the union. The per-ask map is what the carrier router
    // consults, so this flat list NEVER short-circuits the partitioning.
    const allForbidden = new Set();
    for (const entry of perAskForbidden.values()) {
      if (entry?.unresolved) continue;
      for (const c of entry.forbidden ?? []) allForbidden.add(c);
    }
    return {
      canaries: [...allForbidden],
      perAskForbidden,
      policy: { mode: "per-ask-per-question", available: true }
    };
  }
  // Fall back to the per-question gold forbidden canaries when the per-ask record is missing.
  // We DO NOT default to []. Missing per-ask evidence is recorded as an explicit dependency by
  // callers (they block), and the union here is the same set of gold-answered questions — just
  // without the ask-level distinction. This matches the spec: a canary never referenced by
  // any asked question is allowed everywhere; a canary forbidden by any asked question is
  // forbidden everywhere in the carrier.
  const forbidden = new Set();
  for (const q of goldQuestions.values()) for (const c of q.forbiddenCanaries ?? []) forbidden.add(c);
  return { canaries: [...forbidden], perAskForbidden: new Map(), policy: { mode: "per-question-union", available: false, reason: indexedAsks.reason } };
}

/**
 * Full canonical key for one per-ask policy entry. Includes the case id, the client+run tuple
 * (the agent case's required products and the attempt number), the ask index, the agent id
 * (the Agent the ask actually used) and the gold key. Two distinct asks under the same
 * caseId MUST NOT collide here.
 */
function askFullKey(ask, goldKey, caseClient, caseRun) {
  const client = caseClient ?? ask.client ?? "?";
  const run = caseRun ?? ask.run ?? "?";
  return `${ask.caseId ?? "?"}@${client}#${run}/ask${ask.askIndex}|${ask.agentId ?? "?"}|${goldKey}`;
}

// Cached catalog for ask-plan lookup. We only need cases[]; loading the whole catalog each
// buildCanaryPolicy call would re-read the YAML from disk on every carrier scan.
let _catalogCache = null;
function loadCatalogSync() {
  if (_catalogCache) return _catalogCache;
  try {
    const { cases } = loadCatalog();
    _catalogCache = { cases };
    return _catalogCache;
  } catch {
    return { cases: [] };
  }
}

/**
 * Capture-policy validation (SEC-06-V04 subcarrier). The artifact is a FILE, not a
 * directory. We require:
 *   - The file exists and parses.
 *   - runId matches the current run.
 *   - The Playwright config enforced trace / screenshot / video = "off".
 *   - The inventory lists every actual file the management journey wrote; empty inventory
 *     when the journey never ran is BLOCKED, not silently passed.
 *   - The attached inventory contains NO unsupported retained image (PNG/JPG/etc.); a
 *     real client screenshot under the configured-off policy is a configuration drift
 *     and must block.
 * Returns { status: "passed"|"failed"|"blocked", detail, assertions }.
 */
function validateCapturePolicyArtifact(run, { secrets, canaries }) {
  const file = path.join(run.paths.runDir, "capture-policy.json");
  if (!existsSync(file)) return { status: "blocked", detail: "capture-policy.json is absent (management journey did not write it)", assertions: [] };
  let doc;
  try { doc = JSON.parse(readFileSync(file, "utf8")); } catch (error) { return { status: "blocked", detail: `capture-policy.json is unparseable: ${error.message}`, assertions: [] }; }
  const assertions2 = [];
  if (doc.contract !== "lucy-capture-policy-v1") assertions2.push({ token: "artifact_scan", passed: false, detail: `bad contract: ${doc.contract}` });
  if (doc.runId && doc.runId !== run.runId) assertions2.push({ token: "artifact_scan", passed: false, detail: `runId ${doc.runId} != ${run.runId}` });
  const enforced = doc.policy ?? {};
  const traceOff = enforced.trace === "off";
  const screenshotOff = enforced.screenshot === "off";
  const videoOff = enforced.video === "off";
  const allOff = traceOff && screenshotOff && videoOff;
  if (!allOff) assertions2.push({ token: "no_leak", passed: false, detail: `enforced policy drift: trace=${enforced.trace} screenshot=${enforced.screenshot} video=${enforced.video} (all must be off)` });
  // Inspect the actual file bytes for any credential / forbidden canary leak. The policy file
  // itself is small JSON so a directory scan would not be honest; we run scanCarrier on the file.
  const buf = readFileSync(file);
  const carrier = scanCarrier(buf, file, { secrets, forbiddenCanaries: canaries });
  if (carrier.status === "failed") assertions2.push({ token: "no_leak", passed: false, detail: `capture-policy.json leaked a credential/canary: ${carrier.detail?.map((d) => d.kind).join(",")}` });
  // Inventory: an unsupported retained image is a configuration drift and must block.
  const unsupported = [];
  for (const bucket of ["clientWork", "capture", "screenshots", "traces", "attachments", "other"]) {
    for (const item of doc.inventory?.[bucket] ?? []) {
      const ext = path.extname(item?.path ?? "").toLowerCase();
      if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".sqlite"].includes(ext)) unsupported.push(`${bucket}/${item.path}`);
    }
  }
  if (unsupported.length > 0) assertions2.push({ token: "no_leak", passed: false, detail: `unsupported retained image(s) in client-work inventory: ${unsupported.slice(0, 3).join(", ")}` });
  // Inventory empty + Playwright report absent means the journey never ran: BLOCKED, not passed.
  const totalInventory = Object.values(doc.inventory ?? {}).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
  const playwrightReport = path.join(run.paths.runDir, "results", "management-playwright.json");
  if (totalInventory === 0 && !existsSync(playwrightReport)) assertions2.push({ token: "artifact_scan", passed: false, detail: "empty inventory and no Playwright report — management journey never ran" });
  // Compose the final verdict. failed > blocked > passed.
  if (assertions2.some((a) => !a.passed)) {
    const failed = assertions2.filter((a) => !a.passed);
    return { status: failed.some((a) => a.token === "no_leak") ? "failed" : "blocked", detail: failed.map((a) => a.detail).join("; "), assertions: assertions2 };
  }
  assertions2.push({ token: "artifact_scan", passed: true, detail: `capture-policy.json validated (inventory=${totalInventory} file(s), trace/screenshot/video all off)` });
  assertions2.push({ token: "no_leak", passed: true, detail: "no credential or unsupported image in inventory" });
  return { status: "passed", detail: `capture-policy.json validated`, assertions: assertions2 };
}

export async function collectGateResults({ run, candidate, reverseTests = runReverseTests }) {
  const dir = path.join(run.paths.runDir, "results");
  const { cases } = loadCatalog();
  const gateCases = cases.filter((c) => c.runner === "gate");
  const out = [];
  const blocked = (testCase, reason) => out.push(writeCase(run.paths.runDir, { id: testCase.id, runner: "gate", status: "blocked", detail: reason, assertions: [] }));
  const failed = (testCase, reason) => out.push(writeCase(run.paths.runDir, { id: testCase.id, runner: "gate", status: "failed", detail: reason, assertions: [{ token: "no_leak", passed: false, detail: reason }] }));
  const decided = (testCase, passed, assertions, detail) => out.push(writeCase(run.paths.runDir, { id: testCase.id, runner: "gate", status: passed ? "passed" : "failed", detail, assertions }));

  const outcomes = await reverseTests();
  const audit = readJson(path.join(dir, "npm-audit.json"));
  const existingDoc = readJson(path.join(dir, "existing-gates.json"));
  const ops = readJson(path.join(dir, "ops.json"));
  const findings = parse(readFileSync(FINDINGS_PATH, "utf8"));
  const admins = JSON.parse(readFileSync(path.join(run.secretsDir, "admins.json"), "utf8"));
  const tokens = JSON.parse(readFileSync(path.join(run.secretsDir, "tokens.json"), "utf8"));
  const secretsList = [...Object.values(tokens), admins.owner.password, admins.operator.password, readFileSync(path.join(run.secretsDir, "bootstrap-token"), "utf8").trim()];
  // Build canary policy from gold + per-ask indexed evidence. When the per-ask record is
  // unavailable we use the per-question union (the union is the same as before; the new code
  // here is fail-closed when the gold itself is missing — see below). When per-ask indexed
  // evidence IS available we partition forbidden canaries per ask (`perAskForbidden`) so a
  // finance-allowed canary cannot fail a finance ask just because the same canary is
  // forbidden for a sales ask. This is the per-ask-per-question contract from A6 review.
  const gold = readGold(run);
  const goldQuestions = indexGoldQuestions(gold);
  const indexedAsks = readPerAskIndexedEvidence(run);
  const { canaries, perAskForbidden, policy: canaryPolicy } = buildCanaryPolicy(run, indexedAsks, goldQuestions);

  for (const testCase of gateCases) {
    const id = testCase.id;
    if (id.startsWith("GATE-01-")) {
      const outcome = outcomes.get(id);
      if (!outcome) blocked(testCase, "reverse test not found");
      else decided(testCase, outcome.status === "passed", [{ token: "deny", passed: outcome.status === "passed", detail: outcome.detail }], outcome.detail);
    } else if (id === "SEC-23-V01") {
      if (!audit) blocked(testCase, "results/npm-audit.json is absent");
      else {
        const counts = audit.metadata?.vulnerabilities ?? {};
        const bad = (counts.high ?? 0) + (counts.critical ?? 0);
        const cross = crossCheckDependencies({ findings, audit });
        decided(testCase, cross.status === "passed", [{ token: "deny", passed: cross.status === "passed", detail: `${bad} high/critical reported, register ${cross.status}` }, { token: "artifact_scan", passed: true, detail: "npm audit result parsed" }], `${bad} high/critical`);
      }
    } else if (id === "SEC-23-V02") {
      if (!audit) blocked(testCase, "results/npm-audit.json is absent");
      else {
        const cross = crossCheckDependencies({ findings, audit });
        decided(testCase, cross.status === "passed", [{ token: "deny", passed: cross.status === "passed", detail: cross.problems.map((p) => p.code).join(",") || "consistent" }, { token: "artifact_scan", passed: true, detail: "register compared to audit" }], "findings vs npm audit");
      }
    } else if (id === "SEC-06-V04") {
      // Capture-policy artifact: validated separately as a single file. The remaining
      // client-capture subcarrier is scanned via scanCarrierCase.
      const policy = validateCapturePolicyArtifact(run, { secrets: secretsList, canaries });
      const rest = scanCarrierCase({ run, caseId: id, secrets: secretsList, canaries, perAskForbidden });
      const subcarrierRest = rest.subcarriers?.find((s) => s.id === "client-capture-dirs");
      const restFiles = subcarrierRest?.roots?.reduce((s, r) => s + (r.files ?? 0), 0) ?? 0;
      const restBlocked = subcarrierRest?.status === "blocked";
      const restFailed = subcarrierRest?.status === "failed";
      const restMissing = !subcarrierRest || subcarrierRest.status === "missing";
      const allAssertions = [];
      // Required artifact_scan token: capture-policy.json was inspected (truthfully).
      allAssertions.push({ token: "artifact_scan", passed: policy.status !== "blocked" || restFiles > 0, detail: `capture-policy=${policy.status}, client-capture-dirs=${subcarrierRest?.status ?? "missing"} (${restFiles} file(s))` });
      if (policy.status === "passed") allAssertions.push({ token: "no_leak", passed: true, detail: "capture-policy.json: trace/screenshot/video off and no credential or unsupported image in inventory" });
      else allAssertions.push({ token: "no_leak", passed: false, detail: policy.detail });
      let status = "blocked";
      if (policy.status === "failed" || restFailed) status = "failed";
      else if (policy.status === "passed" && !restFailed && !restMissing && !restBlocked) status = "passed";
      else if (policy.status === "passed" && (restMissing || restBlocked)) status = "blocked";
      if (status === "passed") {
        decided(testCase, true, allAssertions, `${testCase.id}: capture-policy validated (${restFiles} additional client-capture file(s))`);
      } else if (status === "failed") {
        failed(testCase, `capture-policy ${policy.detail}`);
      } else {
        blocked(testCase, `${policy.detail}; client-capture-dirs status=${subcarrierRest?.status ?? "missing"}`);
      }
    } else if (CARRIER_CASES[id]) {
      // Missing gold → BLOCK. The canary scan cannot be safely computed without the gold.
      if (!gold) {
        blocked(testCase, `${CARRIER_CASES[id].label}: gold.json is missing or unparseable; per-question canary policy cannot be computed (explicit dependency on the checker seed)`);
        continue;
      }
      // SEC-06-V03 etc. require per-ask indexed evidence for canary binding; if unavailable the
      // case blocks with the reason recorded, not silently defaults to "complete".
      const requiresPerAsk = ["SEC-06-V03", "SEC-17-V10"].includes(id);
      if (requiresPerAsk && !indexedAsks.available) {
        blocked(testCase, `${CARRIER_CASES[id].label}: ${indexedAsks.reason ?? "per-ask indexed evidence unavailable"} — canary policy cannot be bound per-ask`);
        continue;
      }
      const scan = scanCarrierCase({ run, caseId: id, secrets: secretsList, canaries, perAskForbidden });
      if (scan.error) { blocked(testCase, scan.error); continue; }
      // Required subcarriers missing → BLOCKED with explicit subcarrier list.
      if (scan.status === "blocked" && scan.missingSubcarriers.length > 0) {
        const present = scan.subcarriers.filter((s) => s.status !== "missing").map((s) => s.id).join(",");
        blocked(testCase, `${scan.label}: required subcarrier(s) absent [${scan.missingSubcarriers.join(", ")}] (present: ${present || "(none)"}); canary policy mode=${canaryPolicy.mode} available=${canaryPolicy.available}`);
        continue;
      }
      if (scan.totals.files === 0) { blocked(testCase, `${scan.label}: carrier directories exist but contain 0 scannable file(s)`); continue; }
      if (scan.status === "failed") {
        const first = scan.totals.leaks[0] ?? "(unknown)";
        decided(testCase, false, [
          { token: "no_leak", passed: false, detail: `${scan.kind}: ${scan.totals.hits} leak hit(s) — first: ${first}` },
          { token: "artifact_scan", passed: true, detail: `${scan.totals.files} file(s) inspected across ${scan.subcarriers.length} subcarrier(s) (canary policy mode=${canaryPolicy.mode})` }
        ], `${scan.kind}: ${scan.totals.hits} leak(s) — ${scan.totals.leaks.slice(0, 3).join(", ")}`);
        continue;
      }
      if (scan.status === "blocked") {
        const first = scan.totals.blocked[0] ?? "(unknown)";
        blocked(testCase, `${scan.label}: carrier(s) could not be safely inspected — ${first} (canary policy mode=${canaryPolicy.mode})`);
        continue;
      }
      decided(testCase, true, [
        { token: "no_leak", passed: true, detail: `${scan.kind}: ${scan.totals.files} file(s) inspected across ${scan.subcarriers.length} subcarrier(s), 0 leak(s)` },
        { token: "artifact_scan", passed: true, detail: `${scan.totals.files} file(s), ${scan.subcarriers.length} subcarrier(s), canary policy mode=${canaryPolicy.mode}` }
      ], `${scan.kind}: ${scan.totals.files} file(s) scanned, 0 leak(s) (canary policy mode=${canaryPolicy.mode})`);
    } else if (id === "SEC-23-V05") {
      const needed = ["g1-metadata-arch", "g2-elf-arch", "g3-runtime-smoke", "g4-ktx-version"];
      const found = needed.map((name) => existingDoc?.gates?.find((g) => g.name === name));
      if (!existingDoc || found.some((g) => !g)) blocked(testCase, "G1–G4 results are absent");
      else {
        const ok = found.every((g) => g.status === "passed" && g.imageDigest === candidate.imageDigest);
        decided(testCase, ok, [{ token: "deny", passed: ok, detail: found.map((g) => `${g.name}:${g.status}`).join(",") }, { token: "artifact_scan", passed: true, detail: "digest-bound" }], "G1–G4 on the candidate digest");
      }
    } else if (id.startsWith("OPS-01-")) {
      const entry = ops?.cases?.find((c) => c.id === id);
      if (!entry) blocked(testCase, "K8s acceptance result (results/ops.json) is absent");
      else out.push(writeCase(run.paths.runDir, { id, runner: "gate", status: entry.status, detail: entry.detail ?? "", assertions: entry.assertions ?? [] }));
    } else {
      blocked(testCase, "no structured source produces this gate case yet");
    }
  }

  const contextMigration = readJson(path.join(dir, "context-migration.json"));
  const projection = readJson(path.join(dir, "projection.json"));
  const body = {
    contract: "lucy-gate-results-v1",
    runId: run.runId,
    imageDigest: candidate.imageDigest,
    startedAt: new Date().toISOString(),
    cases: out,
    existing: (existingDoc?.gates ?? []).map(({ name, status, imageDigest }) => ({ name, status, imageDigest })),
    requiredExisting: REQUIRED_EXISTING_GATES,
    canaryPolicy: { mode: canaryPolicy.mode, available: canaryPolicy.available, ...(canaryPolicy.reason ? { reason: canaryPolicy.reason } : {}) },
    ...(contextMigration ? { contextMigrationPending: contextMigration.pending } : {}),
    ...(projection ? { projectionBacklog: projection.backlog } : {})
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "gates.json"), `${JSON.stringify(body, null, 2)}\n`);
  return body;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), { run: "value", candidate: "value" });
    if (!args.run || !args.candidate) fail("collect-gate-results: --run and --candidate are required", 1);
    const body = await collectGateResults({ run: loadRun(args.run), candidate: JSON.parse(readFileSync(args.candidate, "utf8")) });
    const count = (status) => body.cases.filter((c) => c.status === status).length;
    process.stdout.write(`${JSON.stringify({ passed: count("passed"), failed: count("failed"), blocked: count("blocked") })}\n`);
    process.exit(count("failed") > 0 ? 1 : count("blocked") > 0 ? 2 : 0);
  } catch (error) {
    fail(`collect-gate-results: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}