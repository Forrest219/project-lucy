// v0.25 coverage manifest + legacy map + result format contract (Plan W0-2, W0-3, W0-6).
//
// These tests are the mechanical proof of what the design review asked for:
//   * every frozen required variant has exactly one owner (F-01);
//   * the 160 P0/P1 requirement ids are covered with no omission and no
//     fabrication (F-01);
//   * the two owner branches that had no execution ids now have them (F-02);
//   * the manifest never becomes a second source of truth for the frozen
//     catalog, and never carries run status (F-08).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";

import { REPO_ROOT } from "../lib/common.mjs";
import { catalogDigest, loadCatalog, readLock } from "../lib/catalog.mjs";
import {
  CON25_IDS,
  JOURNEY_CATALOG_EVIDENCE,
  JOURNEY_ID,
  LOG25_IDS,
  OWNER_BRANCHES,
  SOURCE_GROUPS,
  STAGE_IDS,
  VARIANT_OWNER_EXCEPTIONS,
  V025_LEGACY_MAP_PATH,
  coverageSummary,
  executionIdFor,
  loadCoverage,
  sourceRequirementBaseline,
  validateCoverage
} from "../lib/v025-coverage.mjs";
import {
  BLOCKED_REASONS,
  RESULT_STATUSES,
  aggregateResults,
  createResult,
  statusFromDimensions,
  validateResult
} from "../lib/v025-result.mjs";

const coverage = loadCoverage();
const specText = readFileSync(path.join(REPO_ROOT, coverage.doc.spec), "utf8");
const legacyMap = parse(readFileSync(V025_LEGACY_MAP_PATH, "utf8"));

describe("v0.25 coverage manifest (Plan W0-1 / W0-2)", () => {
  it("validates against the frozen catalog, the source Specs and the approved design Spec", () => {
    const problems = validateCoverage(coverage, { specText });
    assert.deepEqual(problems, [], `coverage manifest problems:\n${problems.join("\n")}`);
  });

  it("covers all frozen required variants exactly once (F-01)", () => {
    // 2026-10-28（D2 路径 A）：冻结 catalog 增补了 AUD25-A01..A12 与
    // ARV25-V01..V12，共 255 → 279 个 variant。这 24 个执行项因此从
    // newScenarios 移到 existingCatalogMappings —— existing 必须**恰好等于**
    // lock.requiredIds，两者不可重叠。
    const lock = readLock();
    const expectedCount = 279;
    assert.equal(lock.count, expectedCount);
    const ids = coverage.existing.map((m) => m.executionId);
    assert.equal(ids.length, expectedCount);
    assert.equal(new Set(ids).size, expectedCount, "no duplicate existing executionId");
    assert.deepEqual([...ids].sort(), [...lock.requiredIds].sort());
  });

  it("keeps the frozen release directory untouched", () => {
    const { cases } = loadCatalog();
    const lock = readLock();
    assert.equal(catalogDigest(cases), lock.catalogDigest);
  });

  it("covers all 160 P0/P1 source requirement ids with no omission and no fabrication", () => {
    const baseline = sourceRequirementBaseline();
    const expected = new Set();
    for (const [key, ids] of baseline) {
      const group = SOURCE_GROUPS.find((g) => g.key === key);
      assert.equal(ids.length, group.count, `${key} id count`);
      for (const id of ids) expected.add(executionIdFor(group, id));
    }
    assert.equal(expected.size, 160);
    const actual = coverage.newScenarios
      .filter((s) => s.sourceRequirementId !== null && s.sourceRequirementId !== undefined)
      .map((s) => s.executionId);
    // 已并入冻结 catalog 的执行项（AUD25 / ARV25 共 24 个）由 catalog 承载，
    // 不再重复登记在 newScenarios 里，但其 source requirement 覆盖不得丢失。
    const lock = readLock();
    const inFrozenCatalog = [...actual].filter((id) => lock.requiredIds.includes(id));
    assert.equal(actual.length, 160 - 24, "AUD25/ARV25 已并入冻结 catalog，不再重复登记");
    const covered = new Set([...actual, ...[...expected].filter((id) => lock.requiredIds.includes(id))]);
    assert.deepEqual([...covered].sort(), [...expected].sort(), "160 个 source requirement id 仍全覆盖");
    assert.equal(inFrozenCatalog.length, 0);
  });

  it("gives the two previously empty branches real execution ids (F-02)", () => {
    const con = coverage.newScenarios.filter((s) => s.executionId.startsWith("CON25-"));
    const log = coverage.newScenarios.filter((s) => s.executionId.startsWith("LOG25-"));
    assert.equal(con.length, 12);
    assert.equal(log.length, 1);
    assert.deepEqual(con.map((s) => s.executionId).sort(), [...CON25_IDS].sort());
    assert.deepEqual(log.map((s) => s.executionId).sort(), [...LOG25_IDS].sort());
    // the AGENT branch is no longer empty: UX-02..UX-07 variants are mapped to it
    const agentOwned = coverage.existing.filter((m) => m.ownerBranch === "AGENT");
    assert.ok(agentOwned.length >= 20, "AGENT branch owns the UX-02..UX-07 depth matrix");
    // the CONN branch is no longer Hive-only
    const connOwned = coverage.newScenarios.filter((s) => s.ownerBranch === "CONN");
    assert.equal(connOwned.length, 12 + 17, "CONN owns CON25-01..12 and HIV25-V01..17");
    assert.ok(!connOwned.some((s) => s.executionId.startsWith("LOG25-")), "LOG25-01 belongs to OBSERVE");
  });

  it("gives every execution item exactly one owner from the six branches", () => {
    for (const m of coverage.existing) {
      assert.ok(OWNER_BRANCHES.includes(m.ownerBranch), `${m.executionId} owner ${m.ownerBranch}`);
    }
    for (const s of coverage.newScenarios) {
      assert.ok(OWNER_BRANCHES.includes(s.ownerBranch), `${s.executionId} owner ${s.ownerBranch}`);
    }
  });

  it("keeps execution ids globally unique across both groups", () => {
    const all = [
      ...coverage.existing.map((m) => m.executionId),
      ...coverage.newScenarios.map((s) => s.executionId)
    ];
    assert.equal(all.length, 428);
    assert.equal(new Set(all).size, 428);
  });

  it("does not re-declare catalog-owned fields for frozen variants (F-08)", () => {
    for (const m of coverage.existing) {
      for (const f of ["executors", "requires", "assert", "artifacts", "gold", "runner", "status"]) {
        assert.ok(!(f in m), `${m.executionId} re-declares ${f}`);
      }
    }
  });

  it("never records run status in the static manifest", () => {
    const raw = readFileSync(path.join(REPO_ROOT, "scripts/e2e/contracts/v025-coverage.yaml"), "utf8");
    assert.doesNotMatch(raw, /^\s*(status|blockedReason|evidenceRefs|executorResults):/m);
  });

  it("anchors every variant-level owner exception in the approved Spec (F-04)", () => {
    const byId = new Map(coverage.existing.map((m) => [m.executionId, m]));
    for (const e of VARIANT_OWNER_EXCEPTIONS) {
      const m = byId.get(e.executionId);
      assert.ok(m, `${e.executionId} is not mapped`);
      assert.equal(m.ownerBranch, e.ownerBranch);
      const scenarioId = e.executionId.replace(/-[A-Z0-9]+$/, "");
      const specRow = specText.split("### 6.1")[1].split("### 6.2")[0]
        .split("\n").find((l) => l.startsWith(`| ${scenarioId} `));
      assert.ok(specRow, `Spec §6.1 has no row for ${scenarioId}`);
      assert.ok(specRow.includes(e.specRef), `Spec §6.1 row for ${scenarioId} lost "${e.specRef}"`);
    }
  });

  it("models the single aggregate journey with eight stages and three catalog evidence ids (F-05)", () => {
    assert.equal(coverage.journeys.length, 1);
    const j = coverage.journeys[0];
    assert.equal(j.journeyId, JOURNEY_ID);
    assert.deepEqual(j.stages.map((s) => s.stageId), [...STAGE_IDS]);
    assert.deepEqual(j.catalogEvidenceIds, [...JOURNEY_CATALOG_EVIDENCE]);
    // the journey is an aggregate, not an execution item: no executionId, no owner
    assert.equal(j.executionId, undefined);
    assert.equal(j.ownerBranch, undefined);
    // each stage carries a domain so a mainline failure is attributable
    for (const s of j.stages) {
      assert.ok(OWNER_BRANCHES.includes(s.stageOwnerBranch), `${s.stageId} stage owner`);
    }
  });

  it("summarizes coverage without implying any run status", () => {
    const summary = coverageSummary(coverage);
    assert.equal(summary.existingCount, 279);
    assert.equal(summary.newScenarioCount, 149);
    assert.equal(summary.journeyCount, 1);
    // AUD25/ARV25 的 24 个 source requirement 已随执行项并入冻结 catalog，
    // 不再登记在 newScenarios 里 —— 覆盖没有丢失，只是承载位置变了。
    assert.equal(summary.withSourceRequirement, 136);
  });
});

describe("v0.25 legacy id compatibility map (Plan W0-3)", () => {
  it("maps all frozen ids by identity so history stays traceable both ways", () => {
    assert.equal(legacyMap.frozenVariants.length, 279);
    const lock = readLock();
    assert.deepEqual(
      legacyMap.frozenVariants.map((v) => v.executionId).sort(),
      [...lock.requiredIds].sort()
    );
    for (const v of legacyMap.frozenVariants) {
      assert.equal(v.legacyId, v.executionId, `${v.executionId} is renamed`);
      assert.equal(v.namespace, "frozen:catalog");
    }
  });

  it("gives every source requirement id a namespace", () => {
    const ids = legacyMap.requirementNamespaces.flatMap((n) => n.ids);
    assert.equal(ids.length, 160);
    const namespaced = new Set(legacyMap.requirementNamespaces.map((n) => n.namespace));
    assert.equal(namespaced.size, 11);
    // the four V series and the SC series are in different namespaces
    const vNamespaces = legacyMap.requirementNamespaces.filter((n) => n.ids.every((i) => /^V\d{2}$/.test(i)));
    assert.equal(vNamespaces.length, 4, "four distinct V01..Vn namespaces");
  });

  it("keeps the old upgrade feature list in its own namespace and out of UPG25", () => {
    const legacy = legacyMap.legacyFamilies.find((f) => f.namespace === "legacy:upgrade-feature");
    assert.ok(legacy, "legacy:upgrade-feature namespace missing");
    assert.equal(legacy.ids.length, 14);
    const upgradeNamespace = legacyMap.requirementNamespaces.find((n) => n.executionPrefix === "UPG25");
    const upgradeIds = new Set(upgradeNamespace.ids);
    for (const id of legacy.ids) {
      assert.ok(upgradeIds.has(id), `${id} unexpectedly also belongs to P1-5`);
    }
    // the two lists are semantically disjoint: same bare ids, different meaning
    assert.notEqual(legacy.sourceFiles[0], upgradeNamespace.sourceSpec);
  });

  it("resolves every manifest source requirement id to a namespace", () => {
    // A bare requirement id is deliberately ambiguous: V01 exists in four
    // namespaces (ROW25 / SEM25 / ARV25 / HIV25). The source Spec is what
    // disambiguates it, so the resolver keys on the pair.
    const index = new Map();
    for (const n of legacyMap.requirementNamespaces) {
      n.ids.forEach((id, i) => index.set(`${n.sourceSpec}::${id}`, { ns: n, executionId: n.executionIds[i] }));
    }
    const bareIds = new Map();
    for (const n of legacyMap.requirementNamespaces) {
      for (const id of n.ids) bareIds.set(id, (bareIds.get(id) ?? 0) + 1);
    }
    assert.ok([...bareIds.values()].some((n) => n > 1), "some bare ids are reused across namespaces");

    for (const s of coverage.newScenarios) {
      if (s.sourceRequirementId === null) continue;
      const hit = index.get(`${s.sourceSpec}::${s.sourceRequirementId}`);
      assert.ok(hit, `${s.sourceRequirementId} in ${s.sourceSpec} has no namespace`);
      assert.equal(s.executionId, hit.executionId);
    }
  });
});

describe("v0.25 result format (Plan W0-6)", () => {
  const identity = { runId: "r1", instanceId: "i1", candidateDigest: "sha256:x" };

  it("derives status from evidence dimensions without folding a partial run into a pass", () => {
    // a single passing layer is not a pass when more layers are required
    assert.equal(
      statusFromDimensions({ P: { status: "passed" } }, { required: ["P", "B"] }),
      "not_run",
      "one layer is not a pass"
    );
    assert.equal(
      statusFromDimensions({ P: { status: "passed" }, B: { status: "not_run" } }, { required: ["P", "B"] }),
      "not_run"
    );
    assert.equal(
      statusFromDimensions({ P: { status: "passed" }, B: { status: "failed" } }, { required: ["P", "B"] }),
      "failed"
    );
    assert.equal(
      statusFromDimensions({ P: { status: "passed" }, B: { status: "passed" } }, { required: ["P", "B"] }),
      "passed"
    );
    assert.equal(
      statusFromDimensions({ P: { status: "passed" }, B: { status: "passed" } }, { required: ["P", "B"], verifierPassed: false }),
      "failed"
    );
    // a dimension that is not required does not make a partial item pass either
    assert.equal(
      statusFromDimensions({ P: { status: "passed" } }, { required: ["P"] }),
      "passed"
    );
  });

  it("requires a structured reason for blocked and forbids it elsewhere", () => {
    assert.throws(() => createResult({ ...identity, executionId: "X", status: "blocked" }));
    assert.doesNotThrow(() => createResult({ ...identity, executionId: "X", status: "blocked", blockedReason: "environment" }));
    assert.throws(() => createResult({ ...identity, executionId: "X", status: "passed", blockedReason: "environment" }));
    for (const r of BLOCKED_REASONS) {
      assert.doesNotThrow(() => createResult({ ...identity, executionId: "X", status: "blocked", blockedReason: r }));
    }
  });

  it("never aggregates blocked, not_run or not_applicable into a pass count", () => {
    const results = [
      createResult({ ...identity, executionId: "A", status: "passed" }),
      createResult({ ...identity, executionId: "B", status: "blocked", blockedReason: "delivery" }),
      createResult({ ...identity, executionId: "C", status: "not_run" }),
      createResult({ ...identity, executionId: "D", status: "not_applicable" })
    ];
    const summary = aggregateResults(results);
    assert.equal(summary.total, 4);
    assert.equal(summary.passed, 1);
    assert.equal(summary.notPassed, 3);
    assert.equal(summary.byStatus.blocked, 1);
    assert.equal(summary.byStatus.not_run, 1);
    assert.equal(summary.byStatus.not_applicable, 1);
  });

  it("rejects malformed result records", () => {
    assert.ok(validateResult({}).length > 0);
    assert.ok(validateResult({ ...identity, executionId: "X", status: "nope" }).length > 0);
    assert.deepEqual(validateResult(createResult({ ...identity, executionId: "X", status: "not_run" })), []);
  });
});

describe("v0.25 coverage manifest rejects defective edits (Plan W0-2)", () => {
  const clone = () => structuredClone(coverage.doc);
  // validateCoverage reads the three groups off the loaded object, so a mutated
  // doc must be re-wrapped — otherwise the mutation would not be exercised.
  const loaded = (doc) => ({
    doc,
    existing: doc.existingCatalogMappings,
    newScenarios: doc.newScenarios,
    journeys: doc.journeys
  });

  it("catches a missing frozen variant", () => {
    const doc = clone();
    doc.existingCatalogMappings.pop();
    const problems = validateCoverage(loaded(doc), { specText });
    assert.ok(problems.some((p) => p.includes("existingCatalogMappings")), problems.join("; "));
  });

  it("catches a wrong owner", () => {
    const doc = clone();
    doc.existingCatalogMappings[0].ownerBranch = "LIFECYCLE";
    const problems = validateCoverage(loaded(doc), { specText });
    assert.ok(problems.some((p) => p.includes("owner")), problems.join("; "));
  });

  it("catches an undeclared variant-level split", () => {
    const doc = clone();
    const target = doc.existingCatalogMappings.find((m) => m.executionId === "SEC-01-V01");
    target.ownerBranch = "OBSERVE";
    const problems = validateCoverage(loaded(doc), { specText });
    assert.ok(problems.some((p) => p.includes("without a declared exception")), problems.join("; "));
  });

  it("catches a fabricated P0/P1 execution id", () => {
    const doc = clone();
    doc.newScenarios.push({
      executionId: "ROW25-V99", sourceSpec: "x", sourceRequirementId: "V99",
      ownerBranch: "ACCESS", priority: "P0", executors: ["P"], requires: ["lucy-http"],
      assert: ["deny"], artifacts: ["a.json"], gold: null
    });
    const problems = validateCoverage(loaded(doc), { specText });
    assert.ok(problems.some((p) => p.includes("ROW25-V99")), problems.join("; "));
  });

  it("catches an execution id that does not match the approved form", () => {
    const doc = clone();
    const target = doc.newScenarios.find((s) => s.executionId === "RTP25-01");
    target.executionId = "RTP25-RTP-01";
    const problems = validateCoverage(loaded(doc), { specText });
    assert.ok(problems.some((p) => p.includes("approved form")), problems.join("; "));
  });

  it("catches an unknown vocabulary token", () => {
    const doc = clone();
    doc.newScenarios[0].assert = ["not_a_token"];
    const problems = validateCoverage(loaded(doc), { specText });
    assert.ok(
      problems.some((p) => p.includes("unknown assertion token") || p.includes("must be one of")),
      problems.join("; ")
    );
  });

  it("catches a second journey", () => {
    const doc = clone();
    doc.journeys.push(structuredClone(doc.journeys[0]));
    const problems = validateCoverage(loaded(doc), { specText });
    assert.ok(problems.some((p) => p.includes("journeys count")), problems.join("; "));
  });

  it("catches a manifest that smuggles in run status", () => {
    const doc = clone();
    doc.existingCatalogMappings[0].status = "passed";
    const problems = validateCoverage(loaded(doc), { specText });
    assert.ok(problems.some((p) => p.includes("catalog-owned")), problems.join("; "));
  });
});
