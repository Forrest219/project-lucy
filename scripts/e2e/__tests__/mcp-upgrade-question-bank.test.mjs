/**
 * P1-54 Plan step 4 — question-bank contract negative tests.
 *
 * Mutates inline copies only; never rewrites checked-in journeys / profile YAML.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  CompatConfigRestoreError,
  applyCompatConfigProfile,
  loadCompatConfigProfile,
  restoreCompatConfigProfile,
} from "../lib/mcp-compat-config-profile.mjs";
import {
  aggregateCompatibility,
  loadJourneySuite,
  validateJourneySuite,
} from "../lib/mcp-compatibility.mjs";
import {
  aggregateWithMissingFingerprint,
  evaluateDenyEvidence,
  evaluateOracleClaim,
  runCasesWithFixtureRestore,
  validateQuestionBankContract,
} from "../lib/mcp-upgrade-question-bank.mjs";

function loadGoodSuite() {
  return loadJourneySuite();
}

function cloneSuite(mutator) {
  const suite = structuredClone(loadGoodSuite());
  mutator(suite);
  return suite;
}

test("missing CompatConfigProfile fingerprint => BLOCKED", () => {
  const suite = loadGoodSuite();

  // Suite-level missing requiredConfigFingerprint → structural BLOCKED.
  const noSuiteFp = structuredClone(suite);
  delete noSuiteFp.requiredConfigFingerprint;
  const structural = validateJourneySuite(noSuiteFp);
  assert.equal(structural.ok, false);
  assert.ok(structural.problems.some((p) => /requiredConfigFingerprint/i.test(p)));

  const contract = validateQuestionBankContract(noSuiteFp);
  assert.equal(contract.status, "BLOCKED");

  const agg = aggregateWithMissingFingerprint(suite);
  assert.equal(agg.status, "BLOCKED");

  // Runtime CompatConfigProfile fingerprint missing while suite declares one → BLOCKED.
  const runtimeMissing = validateQuestionBankContract(suite, {
    configProfileFingerprint: null,
  });
  assert.equal(runtimeMissing.status, "BLOCKED");
  assert.ok(
    runtimeMissing.problems.some((p) => /CompatConfigProfile fingerprint/i.test(p)),
  );

  const aggRuntime = aggregateCompatibility({
    entrypoint: "certifyCandidate",
    suite,
    configProfileFingerprint: "",
    functionalCases: [],
    mcp: { samplesMs: Array(20).fill(10), budgetClass: "simple", baselineP95Ms: 10 },
    agent: {
      turns: [
        { turnWallClockMs: 1000 },
        { turnWallClockMs: 1100 },
        { turnWallClockMs: 1200 },
      ],
      baselineMedianMs: 1000,
    },
  });
  assert.equal(aggRuntime.status, "BLOCKED");
});

test("COMPAT-02 missing QB-BIZ-02c or 02d => FAIL", () => {
  const drop02c = cloneSuite((suite) => {
    suite.denominatorMaps["COMPAT-02"] = suite.denominatorMaps["COMPAT-02"].filter(
      (id) => id !== "QB-BIZ-02c",
    );
    suite.cases = suite.cases.filter((c) => c.id !== "QB-BIZ-02c");
  });
  const r1 = validateQuestionBankContract(drop02c);
  assert.equal(r1.status, "FAIL");
  assert.ok(r1.problems.some((p) => /COMPAT-02 missing QB-BIZ-02c/.test(p)));

  const drop02d = cloneSuite((suite) => {
    suite.denominatorMaps["COMPAT-02"] = ["QB-BIZ-02a", "QB-BIZ-02b", "QB-BIZ-02c"];
    suite.cases = suite.cases.filter((c) => c.id !== "QB-BIZ-02d");
  });
  const r2 = validateQuestionBankContract(drop02d);
  assert.equal(r2.status, "FAIL");
  assert.ok(r2.problems.some((p) => /COMPAT-02 missing QB-BIZ-02d/.test(p)));
});

test("deny case without tools/call evidence => FAIL", () => {
  // Contract shape: deny identity drops requireToolsCall.
  const mutated = cloneSuite((suite) => {
    const c = suite.cases.find((x) => x.id === "QB-ACL-01");
    const deny = c.identities.find((i) => i.expect?.outcome === "deny");
    delete deny.expect.requireToolsCall;
  });
  const contract = validateQuestionBankContract(mutated);
  assert.equal(contract.status, "FAIL");
  assert.ok(contract.problems.some((p) => /tools\/call evidence|requireToolsCall/i.test(p)));

  // Runtime observation: oral denial / missing tools/call ⇒ FAIL (D7a).
  const observed = evaluateDenyEvidence({
    expect: { outcome: "deny", requireToolsCall: true },
    observed: { outcome: "deny", oralDenialOnly: true, toolsCallEvidence: false },
  });
  assert.equal(observed.verdict, "FAIL");
  assert.ok(observed.reasons.some((r) => /tools\/call evidence/i.test(r)));

  const ok = evaluateDenyEvidence({
    expect: { outcome: "deny", requireToolsCall: true },
    observed: {
      outcome: "deny",
      toolsCallEvidence: { method: "tools/call", name: "lucy_query" },
      upstreamExecutions: 0,
    },
  });
  assert.equal(ok.verdict, "PASS");
});

test("QB-ACL-02c bound to healable lucy_ops_reader => FAIL", () => {
  const mutated = cloneSuite((suite) => {
    const c = suite.cases.find((x) => x.id === "QB-ACL-02c");
    const deny = c.identities.find((i) => i.id === "deny_frozen_w0");
    deny.role = "lucy_ops_reader";
    delete deny.constraints.frozenW0Only;
  });
  const result = validateQuestionBankContract(mutated);
  assert.equal(result.status, "FAIL");
  assert.ok(result.problems.some((p) => /lucy_ops_reader/i.test(p)));
});

test("W0 mcpControls filters contain gov.* => FAIL", () => {
  const mutated = cloneSuite((suite) => {
    const w0 = suite.cases.find((c) => c.lane === "ops-w0");
    assert.ok(w0, "fixture must include an ops-w0 case");
    const ctrl = w0.mcpControls[0];
    ctrl.query = ctrl.query || {};
    ctrl.query.filters = [{ field: "gov.calendar_days", op: "eq", value: 7 }];
  });
  const result = validateQuestionBankContract(mutated);
  assert.equal(result.status, "FAIL");
  assert.ok(result.problems.some((p) => /W0 mcpControls filters contain gov\.\*/.test(p)));
});

test("W1/W2 missing any allowed gov window knob => FAIL", () => {
  const mutated = cloneSuite((suite) => {
    const w12 = suite.cases.find((c) => c.lane === "ops-w1" || c.lane === "ops-w2");
    assert.ok(w12, "fixture must include an ops-w1/w2 case");
    for (const ctrl of w12.mcpControls || []) {
      if (ctrl.query) ctrl.query.filters = [];
    }
  });
  const result = validateQuestionBankContract(mutated);
  assert.equal(result.status, "FAIL");
  assert.ok(result.problems.some((p) => /W1\/W2 missing any allowed gov window knob/.test(p)));
});

test("QB-DB-01 identity lucy_admin => FAIL", () => {
  const mutated = cloneSuite((suite) => {
    const c = suite.cases.find((x) => x.id === "QB-DB-01");
    c.identities[0].role = "lucy_admin";
    delete c.identities[0].expect.forbiddenRole;
  });
  const result = validateQuestionBankContract(mutated);
  assert.equal(result.status, "FAIL");
  assert.ok(result.problems.some((p) => /QB-DB-01 identity lucy_admin/.test(p)));
});

test("region vocabulary 华东/西南 in fixture => FAIL", () => {
  const mutated = cloneSuite((suite) => {
    const c = suite.cases.find((x) => x.id === "QB-ACL-03b-gate");
    c.identities[0].constraints.rowScopeExample = {
      field: "region",
      values: ["华东", "西南"],
    };
  });
  const result = validateQuestionBankContract(mutated);
  assert.equal(result.status, "FAIL");
  assert.ok(result.problems.some((p) => /region vocabulary|华东|西南/.test(p)));
});

test("agent self-reported number cannot replace oracle", () => {
  const suite = loadGoodSuite();
  const biz = suite.cases.find((c) => c.id === "QB-BIZ-01");
  assert.ok(biz?.oracle);

  const selfOnly = evaluateOracleClaim({
    oracle: biz.oracle,
    observed: {
      agentSelfReported: { order_count: 1000, total_sales: 1459476.0953 },
      independentOracleVerified: false,
    },
  });
  assert.equal(selfOnly.verdict, "FAIL");
  assert.ok(
    selfOnly.reasons.some((r) => /agent self-reported number cannot replace oracle/.test(r)),
  );

  const withOracle = evaluateOracleClaim({
    oracle: biz.oracle,
    observed: {
      agentSelfReported: { order_count: 1000, total_sales: 1459476.0953 },
      independentOracleVerified: true,
      baselineMatch: true,
    },
  });
  assert.equal(withOracle.verdict, "PASS");
});

test("fixture restore failure stops subsequent cases", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "lucy-qb-restore-stop-"));
  try {
    // Minimal project for apply/restore.
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(path.join(root, "webui", "config"), { recursive: true });
    writeFileSync(
      path.join(root, "webui", "config", "access.yaml"),
      "roles: {}\nusers: []\ndefaults:\n  deny_tools: []\n",
      "utf8",
    );
    writeFileSync(
      path.join(root, "ktx.yaml"),
      "connections:\n  demo-mysql:\n    driver: mysql\n  lucy-ops:\n    driver: sqlite\n",
      "utf8",
    );

    const applied = applyCompatConfigProfile({
      projectRoot: root,
      profile: loadCompatConfigProfile(),
      backupDir: path.join(root, ".backup"),
    });
    assert.equal(applied.status, "READY", applied.problems.join("; "));

    // Corrupt backup so restore fails.
    rmSync(applied.backup.backupDir, { recursive: true, force: true });

    const cases = ["case-a", "case-b", "case-c"];
    const ranIds = [];
    const result = await runCasesWithFixtureRestore({
      cases,
      runCase: (id) => {
        ranIds.push(id);
      },
      restore: () => {
        restoreCompatConfigProfile(
          { ...applied.backup, projectRoot: root },
          { projectRoot: root },
        );
      },
    });

    assert.equal(result.stopped, true);
    assert.ok(result.error instanceof CompatConfigRestoreError);
    assert.equal(ranIds.length, 1, "only the case before restore failure may run");
    assert.deepEqual(ranIds, ["case-a"]);
    assert.equal(result.ran, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("QB-ACL-03b-gate expects row isolation success (allow), not unproven deny", () => {
  const mutated = cloneSuite((suite) => {
    const c = suite.cases.find((x) => x.id === "QB-ACL-03b-gate");
    c.oracle.kind = "deny";
    c.oracle.expect = {
      reasonCode: "row_policy_upstream_unproven",
      notRowIsolationDeal: true
    };
    c.identities[0].expect = {
      outcome: "deny",
      reasonCode: "row_policy_upstream_unproven",
      notRowIsolationSuccess: true
    };
  });
  const result = validateQuestionBankContract(mutated);
  assert.equal(result.status, "FAIL");
  assert.ok(
    result.problems.some((p) =>
      /QB-ACL-03b-gate expects row isolation success \(allow\), not unproven deny/.test(p),
    ),
  );

  // Good suite still passes this rule.
  const good = validateQuestionBankContract(loadGoodSuite());
  assert.equal(good.ok, true, good.problems.join("; "));
  assert.equal(good.status, "PASS");
});
