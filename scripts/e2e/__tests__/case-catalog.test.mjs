import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";
import { REPO_ROOT } from "../lib/common.mjs";
import { EXPECTED_FINDING_IDS, crossCheckDependencies } from "../verify-evidence.mjs";
import { computeGold, generateDataset } from "../../../examples/security-e2e/gold/compute-gold.mjs";
import {
  CAPABILITIES, REQUIRED_SUBSCENARIO_IDS, SPEC_SCENARIO_IDS, catalogDigest, checkLock, expandCatalog,
  expectedExecutions, loadCatalog, makeLock, readLock, requiredIds, validateCatalog
} from "../lib/catalog.mjs";

const goldKeys = Object.keys(computeGold(generateDataset("0123456789abcdef")).questions);
const { doc, cases } = loadCatalog();
const clone = (value) => JSON.parse(JSON.stringify(value));

describe("case catalog (Spec §7, frozen denominator)", () => {
  it("is structurally valid for every required variant", () => {
    assert.deepEqual(validateCatalog(cases, { goldKeys }), []);
  });

  it("covers all 32 scenario ids and every explicitly numbered sub-scenario", () => {
    assert.equal(SPEC_SCENARIO_IDS.length, 32);
    const ids = new Set(cases.map((c) => c.id));
    for (const id of SPEC_SCENARIO_IDS) assert.ok(cases.some((c) => c.scenario === id), `scenario ${id}`);
    for (const id of REQUIRED_SUBSCENARIO_IDS) assert.ok(ids.has(id), `sub-scenario ${id}`);
    for (let n = 1; n <= 6; n += 1) assert.ok(ids.has(`SEC-15-FM-0${n}`), `SEC-15-FM-0${n}`);
    for (let n = 1; n <= 19; n += 1) assert.ok(ids.has(`SEC-11-BY${String(n).padStart(2, "0")}`), `BY-${n}`);
  });

  it("gives every case an executor, assertions, a gold reference and artifacts, with known capabilities only", () => {
    for (const c of cases) {
      assert.ok(c.executors.length > 0, c.id);
      assert.ok(c.assert.length > 0, c.id);
      assert.ok(c.artifacts.length > 0, c.id);
      assert.ok(c.gold === "none" || goldKeys.includes(c.gold), `${c.id} gold`);
      for (const cap of c.requires) assert.ok(CAPABILITIES.includes(cap), `${c.id} ${cap}`);
    }
  });

  it("matches its lock; the lock pins the digest and every required id", () => {
    assert.deepEqual(checkLock(cases, readLock()), []);
    assert.equal(readLock().catalogDigest, catalogDigest(cases));
    assert.deepEqual(readLock().requiredIds, requiredIds(cases));
  });

  it("the frozen denominator is pinned here (the ONE literal of the digest and the case count)", () => {
    // 冻结分母的唯一字面量钉。变更必须**有意**进行：改 case-catalog.yaml → 重推
    // case-catalog.lock.json → 更新下面两行 → 在评审里说明为什么动分母。
    //
    // 2026-10-28（D2 路径 A）：AUD25-A01..A12 与 ARV25-V01..V12 并入冻结 catalog，
    // 分母 255 → 279、digest 240bff0f…4a694 → c62cf23f…ae4。
    assert.equal(cases.length, 279);
    assert.equal(catalogDigest(cases), "sha256:c62cf23f112484589e41486b7e53886d6e412e3bfc4bd587833eed3d0585aae4");
  });

  it("rejects a silently removed variant (the denominator cannot shrink)", () => {
    const smaller = cases.filter((c) => c.id !== "SEC-15-FM-03");
    const problems = checkLock(smaller, readLock());
    assert.ok(problems.some((p) => /SEC-15-FM-03/.test(p)), problems.join("\n"));
    assert.ok(validateCatalog(smaller, { goldKeys }).some((p) => /SEC-15-FM-03/.test(p)));
  });

  it("rejects flipping a required variant to optional after the fact", () => {
    const flipped = clone(cases).map((c) => (c.id === "SEC-07-V03" ? { ...c, required: false } : c));
    assert.ok(checkLock(flipped, readLock()).length > 0);
    assert.ok(validateCatalog(flipped, { goldKeys }).some((p) => /optional variants/.test(p)));
  });

  it("flags structural defects: duplicate ids, empty assertions, unknown gold, agent without a client", () => {
    const duplicate = [...cases, cases[0]];
    assert.ok(validateCatalog(duplicate, { goldKeys }).some((p) => /duplicate id/.test(p)));
    const empty = clone(cases).map((c, i) => (i === 3 ? { ...c, assert: [] } : c));
    assert.ok(validateCatalog(empty, { goldKeys }).some((p) => /assert list is empty/.test(p)));
    const badGold = clone(cases).map((c) => (c.id === "UX-02-V01" ? { ...c, gold: "Q-NOT-A-QUESTION" } : c));
    assert.ok(validateCatalog(badGold, { goldKeys }).some((p) => /not exported/.test(p)));
    const noClient = clone(cases).map((c) => (c.id === "UX-02-V01" ? { ...c, requires: ["lucy-http"] } : c));
    assert.ok(validateCatalog(noClient, { goldKeys }).some((p) => /agent-client/.test(p)));
    const dataWithoutGold = clone(cases).map((c) => (c.id === "UX-02-V01" ? { ...c, gold: "none" } : c));
    assert.ok(validateCatalog(dataWithoutGold, { goldKeys }).some((p) => /typed gold/.test(p)));
  });

  it("expands matrices deterministically and the digest changes with any variant change", () => {
    const again = expandCatalog(doc);
    assert.equal(catalogDigest(again), catalogDigest(cases));
    assert.equal(cases.filter((c) => c.id.startsWith("SEC-11-BY")).length, 19);
    assert.equal(cases.filter((c) => c.id.startsWith("SEC-22-S02-")).length, 0);
    const edited = clone(cases).map((c) => (c.id === "SEC-01-V01" ? { ...c, title: `${c.title}!` } : c));
    assert.notEqual(catalogDigest(edited), catalogDigest(cases));
  });

  it("builds the fixed denominator: agent cases multiply by required product and the three runs", () => {
    const keys = expectedExecutions(cases, ["codex", "claude-code", "openclaw"]);
    assert.ok(keys.includes("UX-02-V01@codex#1") && keys.includes("UX-02-V01@claude-code#3") && keys.includes("UX-02-V01@openclaw#2"));
    assert.ok(!keys.includes("UX-02-V01@codex#4"));
    assert.ok(keys.includes("SEC-01-V01") && !keys.includes("SEC-01-V01@codex#1"));
    const agentCases = cases.filter((c) => c.runner === "agent");
    const expected = cases.length - agentCases.length + agentCases.reduce((sum, c) => sum + c.repeat * 3, 0);
    assert.equal(keys.length, expected);
    assert.equal(new Set(keys).size, keys.length, "no duplicate execution keys");
  });

  it("emits a lock for the current catalog that equals the committed one", () => {
    assert.deepEqual(makeLock(cases), readLock());
  });

  it("every finding in the register is well-formed and cites only real catalog ids (no dangling evidence)", () => {
    const findings = parse(readFileSync(path.join(REPO_ROOT, "docs/qa/security-findings.yaml"), "utf8"));
    const ids = new Set(cases.map((c) => c.id));
    const scenarios = new Set(cases.map((c) => c.scenario));
    assert.deepEqual(EXPECTED_FINDING_IDS.filter((id) => !findings.findings.some((f) => f.id === id)), [], "no expected finding may be missing");
    for (const f of findings.findings) {
      assert.ok(["P0", "P1", "P2"].includes(f.severity), f.id);
      assert.ok(["open", "fixed", "accepted_risk"].includes(f.status), f.id);
      if (f.severity !== "P2") assert.notEqual(f.status, "accepted_risk", `${f.id}: P0/P1 can only be open or fixed`);
      if (f.status === "fixed") {
        assert.ok(f.fixedIn, `${f.id} is fixed without fixedIn`);
        assert.ok(f.verifiedBy.length > 0, `${f.id} is fixed without verifiedBy`);
      } else {
        assert.equal(f.fixedIn, null, `${f.id} is ${f.status} but names a fixing commit`);
      }
      for (const ref of f.verifiedBy) assert.ok(ids.has(ref) || scenarios.has(ref), `${f.id} cites ${ref}, which is not in the frozen catalog`);
    }
  });

  it("the dependency register is consistent with an npm audit that reports no high/critical findings", () => {
    const findings = parse(readFileSync(path.join(REPO_ROOT, "docs/qa/security-findings.yaml"), "utf8"));
    const audit = { vulnerabilities: { "moderate-only": { severity: "moderate" } }, metadata: { vulnerabilities: { high: 0, critical: 0, moderate: 1 } } };
    assert.equal(crossCheckDependencies({ findings, audit }).status, "passed");
    assert.equal(crossCheckDependencies({ findings, audit: null }).status, "blocked");
    for (const d of findings.dependencies) {
      if (d.severity === "high" || d.severity === "critical") assert.notEqual(d.status, "open", d.package);
      if (d.status === "not_reachable") assert.ok(String(d.rationale ?? "").trim(), `${d.package} not_reachable needs a rationale`);
    }
  });
});
