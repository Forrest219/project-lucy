// P1-54 Wave A2 smoke: parse mcp-upgrade-journeys.yaml and assert §5 case ids.
// Does NOT implement P1-53 three-axis judge or CompatConfigProfile apply/restore.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parse } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const YAML_PATH = join(__dirname, "../contracts/mcp-upgrade-journeys.yaml");

const REQUIRED_CASE_IDS = [
  "QB-BIZ-01",
  "QB-BIZ-02a",
  "QB-BIZ-02b",
  "QB-BIZ-02c",
  "QB-BIZ-02d",
  "QB-BIZ-03",
  "QB-FOLLOW-01",
  "QB-FOLLOW-02",
  "QB-FOLLOW-03",
  "QB-JOIN-01",
  "QB-JOIN-02",
  "QB-DB-01",
  "QB-DB-02",
  "QB-ACL-01",
  "QB-ACL-02a",
  "QB-ACL-02b",
  "QB-ACL-02c",
  "QB-ACL-03a",
  "QB-ACL-03b-gate",
  "QB-ACL-03c",
  "QB-OPS-01",
  "QB-OPS-02",
  "QB-OPS-03a",
  "QB-OPS-03b",
  "QB-OPS-04",
  "QB-OPS-05",
  "QB-OPS-05b",
  "QB-OPS-06",
  "QB-OPS-07a",
  "QB-OPS-07b",
  "QB-OPS-08",
  "QB-OPS-09",
  "QB-OPS-10",
  "QB-OPS-11",
];

describe("mcp-upgrade-journeys.yaml schema smoke", () => {
  const doc = parse(readFileSync(YAML_PATH, "utf8"));

  it("parses as mcp-upgrade-question-bank with bank ids", () => {
    assert.equal(doc.kind, "mcp-upgrade-question-bank");
    assert.equal(doc.questionBankId, "lucy-mcp-upgrade-question-bank");
    assert.equal(doc.version, 1);
    assert.equal(doc.configProfileId, "lucy-mcp-compat-demo");
    assert.ok(Array.isArray(doc.cases));
    assert.ok(doc.cases.length >= REQUIRED_CASE_IDS.length);
  });

  it("contains every required §4/§5 case id exactly once", () => {
    const ids = doc.cases.map((c) => c.id);
    const seen = new Set();
    for (const id of ids) {
      assert.equal(seen.has(id), false, `duplicate case id: ${id}`);
      seen.add(id);
    }
    for (const id of REQUIRED_CASE_IDS) {
      assert.ok(seen.has(id), `missing required case id: ${id}`);
    }
  });

  it("denominatorMaps cover Spec §5 mappings", () => {
    const maps = doc.denominatorMaps;
    assert.ok(maps);
    assert.deepEqual(maps["COMPAT-01"], ["QB-BIZ-01"]);
    assert.deepEqual(maps["COMPAT-02"], [
      "QB-BIZ-02a",
      "QB-BIZ-02b",
      "QB-BIZ-02c",
      "QB-BIZ-02d",
    ]);
    assert.deepEqual(maps["COMPAT-07"], [
      "QB-ACL-01",
      "QB-ACL-02a",
      "QB-ACL-02b",
      "QB-ACL-02c",
    ]);
    assert.deepEqual(maps["COMPAT-08"], [
      "QB-ACL-03a",
      "QB-ACL-03b-gate",
      "QB-ACL-03c",
    ]);
    assert.deepEqual(maps["COMPAT-OPS-05"], ["QB-OPS-05", "QB-OPS-05b"]);
    for (const [compat, qbs] of Object.entries(maps)) {
      for (const qb of qbs) {
        assert.ok(
          doc.cases.some((c) => c.id === qb),
          `${compat} maps to missing case ${qb}`,
        );
      }
    }
  });

  it("QB-ACL-02c binds frozen W0 role, not lucy_ops_reader", () => {
    const c = doc.cases.find((x) => x.id === "QB-ACL-02c");
    assert.ok(c);
    const deny = c.identities.find((i) => i.id === "deny_frozen_w0");
    assert.equal(deny.role, "compat_fixture_frozen_w0_only");
    assert.ok(deny.expect.forbiddenRoles.includes("lucy_ops_reader"));
    assert.notEqual(deny.role, "lucy_ops_reader");
  });

  it("QB-ACL-03b-gate expects row_policy_upstream_unproven", () => {
    const c = doc.cases.find((x) => x.id === "QB-ACL-03b-gate");
    assert.ok(c);
    assert.equal(c.oracle.expect.reasonCode, "row_policy_upstream_unproven");
    assert.equal(c.oracle.expect.notRowIsolationDeal, true);
  });

  it("QB-DB cases forbid lucy_admin", () => {
    for (const id of ["QB-DB-01", "QB-DB-02"]) {
      const c = doc.cases.find((x) => x.id === id);
      assert.ok(c);
      for (const ident of c.identities) {
        assert.notEqual(ident.role, "lucy_admin");
        assert.equal(ident.expect.forbiddenRole, "lucy_admin");
      }
    }
  });

  it("W0 mcpControls filters contain no gov.*; W1/W2 declare a gov window knob", () => {
    const w0 = doc.cases.filter((c) => c.lane === "ops-w0");
    const w12 = doc.cases.filter((c) => c.lane === "ops-w1" || c.lane === "ops-w2");
    assert.ok(w0.length >= 5);
    assert.ok(w12.length >= 6);

    const collectFilters = (query) => {
      const out = [];
      if (Array.isArray(query?.filters)) out.push(...query.filters);
      if (Array.isArray(query?.steps)) {
        for (const step of query.steps) {
          if (Array.isArray(step?.filters)) out.push(...step.filters);
        }
      }
      return out;
    };

    const hasGov = (filters) =>
      (filters || []).some((f) => {
        const field = typeof f === "string" ? f : f?.field;
        return typeof field === "string" && field.startsWith("gov.");
      });

    const hasWindowKnob = (filters) =>
      (filters || []).some((f) => {
        const field = typeof f === "string" ? f : f?.field;
        return (
          field === "gov.calendar_days" ||
          field === "gov.window_hours" ||
          (typeof field === "string" && field.startsWith("gov.") && /window|calendar|start|end/i.test(field))
        );
      });

    for (const c of w0) {
      for (const ctrl of c.mcpControls || []) {
        assert.equal(
          hasGov(collectFilters(ctrl.query)),
          false,
          `${c.id} W0 filters must not contain gov.*`,
        );
      }
    }
    for (const c of w12) {
      for (const ctrl of c.mcpControls || []) {
        assert.equal(
          hasWindowKnob(collectFilters(ctrl.query)),
          true,
          `${c.id} W1/W2 must declare an allowed gov window knob`,
        );
      }
    }
  });

  it("does not embed secret-looking token values", () => {
    const raw = readFileSync(YAML_PATH, "utf8");
    assert.match(raw, /env:COMPAT_TOKEN_/);
    assert.doesNotMatch(raw, /sk-[A-Za-z0-9]{10,}/);
    assert.doesNotMatch(raw, /Bearer [A-Za-z0-9._-]{20,}/);
  });

  it("region vocabulary stays English East/Southwest in fixtures", () => {
    assert.deepEqual(doc.regionVocabulary.slice(0, 2), ["East", "Southwest"]);
    const raw = readFileSync(YAML_PATH, "utf8");
    // Fixture/constraint examples must not use Chinese region labels.
    assert.doesNotMatch(raw, /rowScopeExample:.*华东|values:\s*\[华东/);
    assert.ok(doc.forbiddenRegionVocabulary.includes("华东"));
    assert.ok(doc.forbiddenRegionVocabulary.includes("西南"));
  });

  it("every identity.role exists in CompatConfigProfile productRoles∪fixtureRoles", async () => {
    const { loadCompatConfigProfile } = await import("../lib/mcp-compat-config-profile.mjs");
    const profile = await loadCompatConfigProfile();
    const known = new Set([
      ...Object.keys(profile.productRoles || {}),
      ...Object.keys(profile.fixtureRoles || {})
    ]);
    const missing = [];
    for (const c of doc.cases) {
      for (const ident of c.identities || []) {
        if (!known.has(ident.role)) {
          missing.push(`${c.id}/${ident.id || "?"}=${ident.role}`);
        }
      }
    }
    assert.deepEqual(missing, [], `unknown roles: ${missing.join(", ")}`);
  });

  it("requiredConfigFingerprint matches computeConfigProfileFingerprint(profile)", async () => {
    const {
      loadCompatConfigProfile,
      computeConfigProfileFingerprint
    } = await import("../lib/mcp-compat-config-profile.mjs");
    const profile = await loadCompatConfigProfile();
    const fp = computeConfigProfileFingerprint(profile);
    assert.equal(doc.requiredConfigFingerprint, fp);
  });
});
