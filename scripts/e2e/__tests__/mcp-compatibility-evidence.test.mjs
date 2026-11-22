/**
 * P1-53 Task 4 — dual evidence files + verifier re-read/recompute (D26 / SC-16 / SC-21 / SC-24).
 * Plan negatives: missing file, FAIL/BLOCKED/NOT RUN, deleted cases, single attempt only,
 * old digest, rewritten summary, relative regression accepted notes, secret leak,
 * missing axis, attribution masquerading as PASS; CI subset never releaseReady.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  APPROVED_QUESTION_BANK_ID,
  digestJourneySuite
} from "../lib/mcp-compatibility.mjs";
import {
  CANDIDATE_EVIDENCE_REL,
  INSTANCE_EVIDENCE_REL,
  MCP_COMPAT_EVIDENCE_CONTRACT,
  MCP_COMPAT_EVIDENCE_FIELD_CONTRACT,
  assembleMcpCompatibilityEvidenceIndex,
  evaluateMcpCompatibilityReleaseGate,
  registerMcpCompatibilityEvidence,
  verifyMcpCompatibilityEvidenceDoc,
  verifyMcpCompatibilityEvidenceFiles
} from "../lib/mcp-compatibility-evidence.mjs";

function validSuite() {
  return {
    questionBankId: APPROVED_QUESTION_BANK_ID,
    version: 1,
    requiredConfigFingerprint: "sha256:compat-profile-fixture",
    cases: [
      {
        id: "QB-FOLLOW-01",
        family: "follow-up",
        mapsTo: ["COMPAT-03"],
        turns: [{ text: "nov" }, { text: "dec" }]
      },
      {
        id: "QB-ACL-01",
        family: "permission",
        mapsTo: ["COMPAT-07"],
        turns: [{ text: "orders" }]
      },
      {
        id: "QB-DB-01",
        family: "multi-connection",
        mapsTo: ["COMPAT-06"],
        turns: [{ text: "compare" }]
      }
    ]
  };
}

function mcpSamples(n, valueMs) {
  return Array.from({ length: n }, () => valueMs);
}

function passingCases() {
  return [
    {
      id: "QB-FOLLOW-01",
      status: "PASS",
      attempts: [{ n: 1 }, { n: 2 }, { n: 3 }],
      expectedOutcome: "allow",
      observedOutcome: "allow",
      expectedNonempty: true,
      observedRowCount: 3,
      expectedMetrics: ["total_sales"],
      observedMetrics: ["total_sales"]
    },
    {
      id: "QB-ACL-01",
      status: "PASS",
      attempts: [{ n: 1 }],
      expectedOutcome: "deny",
      observedOutcome: "deny"
    },
    {
      id: "QB-DB-01",
      status: "PASS",
      attempts: [{ n: 1 }],
      expectedOutcome: "allow",
      observedOutcome: "allow",
      observedRowCount: 1
    }
  ];
}

function baseCandidate(overrides = {}) {
  const suite = overrides.suite ?? validSuite();
  const digest = digestJourneySuite(suite);
  const expectedIds = suite.cases.map((c) => c.id);
  const doc = {
    contract: MCP_COMPAT_EVIDENCE_CONTRACT,
    kind: "candidate",
    entrypoint: "certifyCandidate",
    suiteDigest: digest,
    candidateDigest: "sha256:candidate-image-digest",
    clientFingerprint: "client:cursor@1",
    modelFingerprint: "model:gpt-test",
    configProfileFingerprint: suite.requiredConfigFingerprint,
    batchWallClockMs: 12_000,
    coverageMode: "full",
    status: "PASS",
    summary: "overall PASS",
    verdicts: {
      functionalCompatibility: "PASS",
      serviceLatency: "PASS",
      agentLatency: "PASS"
    },
    denominator: {
      expectedCaseIds: expectedIds,
      observedCaseIds: expectedIds,
      complete: true
    },
    cases: passingCases(),
    mcp: { budgetClass: "simple", samplesMs: mcpSamples(20, 100) },
    agent: {
      turns: [{ turnWallClockMs: 1000 }, { turnWallClockMs: 1100 }, { turnWallClockMs: 900 }]
    },
    suite,
    ...overrides
  };
  if (overrides.cases) doc.cases = overrides.cases;
  if (overrides.denominator) doc.denominator = overrides.denominator;
  if (overrides.verdicts) doc.verdicts = overrides.verdicts;
  if (overrides.mcp) doc.mcp = overrides.mcp;
  if (overrides.agent) doc.agent = overrides.agent;
  return doc;
}

function baseInstance(overrides = {}) {
  return {
    ...baseCandidate({
      kind: "instance",
      entrypoint: "certifyInstanceUpgrade",
      phases: { POST: { status: "PASS" } },
      snapshotId: "snap-1",
      baseline: { snapshotId: "snap-1", clientFingerprint: "client:cursor@1", modelFingerprint: "model:gpt-test" },
      candidateEvidence: { status: "PASS" },
      ...overrides
    }),
    kind: "instance",
    entrypoint: "certifyInstanceUpgrade",
    phases: overrides.phases ?? { POST: { status: "PASS" } },
    snapshotId: overrides.snapshotId ?? "snap-1"
  };
}

function writeRun(docs) {
  const dir = mkdtempSync(path.join(tmpdir(), "lucy-mcp-compat-ev-"));
  mkdirSync(path.join(dir, "results"), { recursive: true });
  if (docs.candidate !== undefined) {
    writeFileSync(path.join(dir, CANDIDATE_EVIDENCE_REL), `${JSON.stringify(docs.candidate, null, 2)}\n`);
  }
  if (docs.instance !== undefined) {
    writeFileSync(path.join(dir, INSTANCE_EVIDENCE_REL), `${JSON.stringify(docs.instance, null, 2)}\n`);
  }
  return dir;
}

describe("MCP compatibility evidence field contract (B1)", () => {
  test("exports a stable field contract both runner and verifier can import", () => {
    assert.equal(MCP_COMPAT_EVIDENCE_FIELD_CONTRACT.contract, MCP_COMPAT_EVIDENCE_CONTRACT);
    assert.ok(MCP_COMPAT_EVIDENCE_FIELD_CONTRACT.requiredTopLevel.includes("suiteDigest"));
    assert.ok(MCP_COMPAT_EVIDENCE_FIELD_CONTRACT.untrustedTopLevel.includes("status"));
    assert.equal(MCP_COMPAT_EVIDENCE_FIELD_CONTRACT.candidateRelPath, CANDIDATE_EVIDENCE_REL);
    assert.equal(MCP_COMPAT_EVIDENCE_FIELD_CONTRACT.instanceRelPath, INSTANCE_EVIDENCE_REL);
  });
});

describe("assembler registers path + sha256 only", () => {
  test("missing files are present=false with zero digest, never PASS", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lucy-mcp-compat-miss-"));
    const index = assembleMcpCompatibilityEvidenceIndex({ runDir: dir });
    assert.equal(index.artifacts.length, 2);
    for (const a of index.artifacts) {
      assert.equal(a.present, false);
      assert.equal(a.sha256, "0".repeat(64));
    }
  });

  test("present file sha256 is bytes of the file, independent of status field", () => {
    const doc = baseCandidate({ status: "FAIL" });
    const dir = writeRun({ candidate: doc });
    const entry = registerMcpCompatibilityEvidence(dir, "candidate");
    assert.equal(entry.present, true);
    assert.equal(entry.path, CANDIDATE_EVIDENCE_REL);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    // Rewrite status — path stays; sha changes only if bytes change
    const again = registerMcpCompatibilityEvidence(dir, "candidate");
    assert.equal(again.sha256, entry.sha256);
  });
});

describe("verifier negatives (D26)", () => {
  test("missing file => BLOCKED and releaseReady=false", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lucy-mcp-compat-nofile-"));
    const gate = verifyMcpCompatibilityEvidenceFiles({ runDir: dir, require: "both" });
    assert.equal(gate.releaseReady, false);
    assert.equal(gate.status, "BLOCKED");
    assert.ok(gate.problems.some((p) => p.code === "missing_file"));
  });

  test("FAIL status with failing functional observation stays FAIL / not releaseReady", () => {
    const doc = baseCandidate({
      status: "FAIL",
      cases: passingCases().map((c, i) =>
        i === 0
          ? { ...c, expectedOutcome: "allow", observedOutcome: "deny", status: "FAIL" }
          : c
      ),
      verdicts: {
        functionalCompatibility: "FAIL",
        serviceLatency: "PASS",
        agentLatency: "PASS"
      }
    });
    const v = verifyMcpCompatibilityEvidenceDoc({
      doc,
      expectedKind: "candidate",
      suite: doc.suite
    });
    assert.notEqual(v.status, "PASS");
    assert.equal(v.fileReleaseSignal, false);
  });

  test("BLOCKED top-level / insufficient samples => not releaseReady", () => {
    const doc = baseCandidate({
      status: "BLOCKED",
      mcp: { budgetClass: "simple", samplesMs: mcpSamples(5, 100) }
    });
    const v = verifyMcpCompatibilityEvidenceDoc({
      doc,
      expectedKind: "candidate",
      suite: doc.suite
    });
    assert.notEqual(v.status, "PASS");
    assert.equal(v.ok, false);
  });

  test("NOT RUN case or top-level => FAIL and releaseReady=false", () => {
    const doc = baseCandidate({
      status: "PASS",
      cases: passingCases().map((c, i) => (i === 2 ? { ...c, status: "NOT RUN" } : c))
    });
    const v = verifyMcpCompatibilityEvidenceDoc({
      doc,
      expectedKind: "candidate",
      suite: doc.suite
    });
    assert.equal(v.ok, false);
    assert.ok(v.problems.some((p) => p.code === "not_run" || p.code === "case_status_ignored"));
  });

  test("deleted cases (missing from denominator) => FAIL", () => {
    const suite = validSuite();
    const doc = baseCandidate({
      suite,
      cases: passingCases().slice(0, 2),
      denominator: {
        expectedCaseIds: suite.cases.map((c) => c.id),
        observedCaseIds: suite.cases.map((c) => c.id).slice(0, 2),
        complete: true
      }
    });
    const v = verifyMcpCompatibilityEvidenceDoc({
      doc,
      expectedKind: "candidate",
      suite,
      expectedCaseIds: suite.cases.map((c) => c.id)
    });
    assert.equal(v.ok, false);
    assert.ok(v.problems.some((p) => p.code === "deleted_cases" || p.code === "forged_denominator"));
  });

  test("single attempt only (agent samples < 3) => insufficient_attempts / not PASS", () => {
    const doc = baseCandidate({
      agent: { turns: [{ turnWallClockMs: 1000 }] },
      cases: passingCases().map((c) =>
        c.id === "QB-FOLLOW-01"
          ? {
              ...c,
              attempts: [{ n: 1 }],
              agent: { turns: [{ turnWallClockMs: 1000 }] }
            }
          : c
      )
    });
    const v = verifyMcpCompatibilityEvidenceDoc({
      doc,
      expectedKind: "candidate",
      suite: doc.suite
    });
    assert.equal(v.ok, false);
    assert.ok(v.problems.some((p) => p.code === "insufficient_attempts"));
  });

  test("old suiteDigest vs recomputed => FAIL", () => {
    const suite = validSuite();
    const doc = baseCandidate({
      suite,
      suiteDigest: "sha256:deadbeef"
    });
    const v = verifyMcpCompatibilityEvidenceDoc({
      doc,
      expectedKind: "candidate",
      suite
    });
    assert.equal(v.ok, false);
    assert.ok(v.problems.some((p) => p.code === "old_digest"));
  });

  test("rewritten summary claiming PASS while recomputed FAIL => FAIL", () => {
    const doc = baseCandidate({
      summary: "overall PASS — all green",
      status: "PASS",
      mcp: { budgetClass: "simple", samplesMs: mcpSamples(20, 6000) }
    });
    const v = verifyMcpCompatibilityEvidenceDoc({
      doc,
      expectedKind: "candidate",
      suite: doc.suite
    });
    assert.equal(v.ok, false);
    assert.ok(
      v.problems.some(
        (p) => p.code === "rewritten_summary" || p.code === "forged_status" || p.code === "rewritten_verdict"
      )
    );
  });

  test("relative regression accepted notes => FAIL (D12 no exemption)", () => {
    const doc = baseCandidate({
      notes: ["accepted relative regression vs baseline for MCP p95"]
    });
    const v = verifyMcpCompatibilityEvidenceDoc({
      doc,
      expectedKind: "candidate",
      suite: doc.suite
    });
    assert.equal(v.ok, false);
    assert.ok(v.problems.some((p) => p.code === "relative_regression_accepted"));
  });

  test("secret leak in public evidence => FAIL", () => {
    const doc = baseCandidate({
      token: "lucy_e2e_0123456789abcdef0123456789abcdef"
    });
    const v = verifyMcpCompatibilityEvidenceDoc({
      doc,
      rawText: JSON.stringify(doc),
      expectedKind: "candidate",
      suite: doc.suite
    });
    assert.equal(v.ok, false);
    assert.ok(v.problems.some((p) => p.code === "secret_leak"));
  });

  test("missing axis on claimed verdicts => FAIL", () => {
    const doc = baseCandidate({
      verdicts: {
        functionalCompatibility: "PASS",
        serviceLatency: "PASS"
        // agentLatency omitted
      }
    });
    const v = verifyMcpCompatibilityEvidenceDoc({
      doc,
      expectedKind: "candidate",
      suite: doc.suite
    });
    assert.equal(v.ok, false);
    assert.ok(v.problems.some((p) => p.code === "missing_axis"));
  });

  test("attribution masquerading as PASS (DEGRADED_PROVIDER_LATENCY) => FAIL", () => {
    const doc = baseCandidate({
      status: "PASS",
      summary: "overall PASS with DEGRADED_PROVIDER_LATENCY attribution",
      agent: {
        attribution: "DEGRADED_PROVIDER_LATENCY",
        turns: [
          { turnWallClockMs: 130_000 },
          { turnWallClockMs: 130_000 },
          { turnWallClockMs: 130_000 }
        ]
      },
      verdicts: {
        functionalCompatibility: "PASS",
        serviceLatency: "PASS",
        agentLatency: "FAIL",
        attribution: "DEGRADED_PROVIDER_LATENCY"
      }
    });
    const v = verifyMcpCompatibilityEvidenceDoc({
      doc,
      expectedKind: "candidate",
      suite: doc.suite
    });
    assert.equal(v.ok, false);
    assert.ok(
      v.problems.some((p) => p.code === "attribution_masquerade" || p.code === "forged_status")
    );
    assert.notEqual(v.recomputed.aggregateStatus, "PASS");
  });
});

describe("dual files + CI subset gate", () => {
  test("consumes candidate and instance separately; both green full => releaseReady", () => {
    const candidate = baseCandidate();
    const instance = baseInstance();
    const dir = writeRun({ candidate, instance });
    const gate = verifyMcpCompatibilityEvidenceFiles({
      runDir: dir,
      suite: candidate.suite,
      require: "both"
    });
    assert.equal(gate.candidate.status, "PASS", JSON.stringify(gate.candidate.problems, null, 2));
    assert.equal(gate.instance.status, "PASS", JSON.stringify(gate.instance.problems, null, 2));
    assert.equal(gate.releaseReady, true);
    assert.equal(gate.status, "PASS");
  });

  test("CI subset alone must not set releaseReady=true", () => {
    const candidate = baseCandidate({ coverageMode: "ci-subset" });
    const dir = writeRun({ candidate });
    const gate = verifyMcpCompatibilityEvidenceFiles({
      runDir: dir,
      suite: candidate.suite,
      require: "candidate",
      ciSubset: true
    });
    assert.equal(gate.releaseReady, false);
    assert.ok(gate.problems.some((p) => /ci_subset/i.test(p.code)));
  });

  test("evaluateMcpCompatibilityReleaseGate refuses subset even if axes look green", () => {
    const candidate = verifyMcpCompatibilityEvidenceDoc({
      doc: baseCandidate({ coverageMode: "ci-subset" }),
      expectedKind: "candidate",
      suite: validSuite(),
      requireFullCoverage: false
    });
    // Force a green-looking file signal for the trap
    candidate.ok = true;
    candidate.status = "PASS";
    candidate.fileReleaseSignal = true;
    candidate.coverageMode = "ci-subset";
    const gate = evaluateMcpCompatibilityReleaseGate({
      results: { candidate },
      ciSubset: true
    });
    assert.equal(gate.releaseReady, false);
  });

  test("does not trust forged top-level PASS when recomputed axis is FAIL", () => {
    const doc = baseCandidate({
      status: "PASS",
      summary: "overall PASS",
      mcp: { budgetClass: "simple", samplesMs: mcpSamples(20, 9000) },
      verdicts: {
        functionalCompatibility: "PASS",
        serviceLatency: "PASS",
        agentLatency: "PASS"
      }
    });
    const v = verifyMcpCompatibilityEvidenceDoc({
      doc,
      expectedKind: "candidate",
      suite: doc.suite
    });
    assert.equal(v.recomputed.verdicts.serviceLatency, "FAIL");
    assert.notEqual(v.status, "PASS");
    assert.equal(v.fileReleaseSignal, false);
  });
});
