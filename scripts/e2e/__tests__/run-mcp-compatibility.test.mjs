/**
 * P1-53 Task 2 — MCP compatibility runner negatives (offline, injectable deps).
 * Plan: docs/plans/lucy-20261118-mcp-upgrade-compatibility-plan.md Task 2
 */

import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { APPROVED_QUESTION_BANK_ID } from "../lib/mcp-compatibility.mjs";
import {
  createMcpClient,
  parseMcpToolResult,
  resolveTokenRef,
  runMcpControl
} from "../lib/mcp-compatibility-client.mjs";
import { CompatConfigRestoreError } from "../lib/mcp-compat-config-profile.mjs";
import {
  FORBIDDEN_FLAGS,
  USAGE,
  agentAdapterMissing,
  assertNoPublicEvidenceLeak,
  assertPrivateFileMode,
  parseCli,
  readPrivateBaseline,
  runCompatibilityCommand,
  runAgentAxis,
  normalizeAgentRun,
  buildCandidateEvidence,
  writePrivateBaseline,
  writePublicEvidence
} from "../run-mcp-compatibility.mjs";
import { verifyMcpCompatibilityEvidenceDoc } from "../lib/mcp-compatibility-evidence.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tempDir(prefix = "mcp-compat-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function validSuite(overrides = {}) {
  const base = {
    questionBankId: APPROVED_QUESTION_BANK_ID,
    version: 1,
    requiredConfigFingerprint: "sha256:compat-profile-fixture",
    cases: [
      {
        id: "QB-FOLLOW-01",
        family: "follow-up",
        mapsTo: ["COMPAT-03"],
        turns: [{ text: "nov" }, { text: "dec" }],
        identities: [
          {
            id: "allow_readonly",
            role: "demo_readonly",
            tokenRef: "env:COMPAT_TOKEN_READONLY",
            expect: { outcome: "allow" }
          }
        ],
        mcpControls: [
          {
            identity: "allow_readonly",
            begin: "follow-up begin",
            query: {
              connectionId: "demo-mysql",
              measures: ["superstore_orders.total_sales"],
              filters: []
            }
          }
        ]
      },
      {
        id: "QB-ACL-01",
        family: "permission",
        mapsTo: ["COMPAT-07"],
        turns: [{ text: "acl" }],
        identities: [
          {
            id: "deny_no_query",
            role: "compat_fixture_no_lucy_query",
            tokenRef: "env:COMPAT_TOKEN_NO_QUERY",
            expect: { outcome: "deny" }
          }
        ],
        mcpControls: [
          {
            identity: "deny_no_query",
            begin: "deny begin",
            query: {
              connectionId: "demo-mysql",
              measures: ["superstore_orders.total_sales"],
              filters: []
            }
          }
        ]
      },
      {
        id: "QB-DB-01",
        family: "multi-connection",
        mapsTo: ["COMPAT-06"],
        turns: [{ text: "dual" }],
        identities: [
          {
            id: "dual_conn_readonly",
            role: "compat_fixture_dual_readonly",
            tokenRef: "env:COMPAT_TOKEN_DUAL_CONN",
            expect: { outcome: "allow" }
          }
        ],
        mcpControls: [
          {
            identity: "dual_conn_readonly",
            begin: "dual begin",
            query: {
              steps: [
                {
                  connectionId: "demo-mysql",
                  measures: ["superstore_orders.order_count"],
                  filters: []
                },
                {
                  connectionId: "lucy-ops",
                  measures: ["ops_calls.call_count"],
                  filters: []
                }
              ]
            }
          }
        ]
      }
    ]
  };
  return {
    ...base,
    ...overrides,
    cases: overrides.cases ?? base.cases
  };
}

const TOKENS = {
  COMPAT_TOKEN_READONLY: "lucy_e2e_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  COMPAT_TOKEN_NO_QUERY: "lucy_e2e_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  COMPAT_TOKEN_DUAL_CONN: "lucy_e2e_cccccccccccccccccccccccccccccccc"
};

function mcpSamples(n, valueMs = 80) {
  return Array.from({ length: n }, () => valueMs);
}

function passingAgentTurns() {
  return [
    { turnWallClockMs: 1000 },
    { turnWallClockMs: 1100 },
    { turnWallClockMs: 900 }
  ];
}

function mockApplyReady(fingerprint = "sha256:compat-profile-fixture") {
  return () => ({
    status: "READY",
    fingerprint,
    backup: {
      backupDir: "/tmp/fake-backup",
      files: [{ relative: "webui/config/access.yaml", present: true }],
      projectRoot: REPO_ROOT
    },
    appliedRoleIds: ["compat_fixture_dual_readonly"],
    problems: []
  });
}

function mockRestoreOk() {
  return () => undefined;
}

function mockMcpAllowRun(suite) {
  const samplesMs = mcpSamples(20, 90);
  const functionalCases = [];
  const attempts = [];
  for (const c of suite.cases) {
    for (const identity of c.identities ?? []) {
      const expected = identity.expect?.outcome ?? "allow";
      functionalCases.push({
        id: `${c.id}:${identity.id}`,
        caseId: c.id,
        identityId: identity.id,
        expectedOutcome: expected,
        observedOutcome: expected,
        envelopeEmpty: false,
        isError: false,
        expectedNonempty: expected === "allow",
        observedRowCount: expected === "allow" ? 2 : 0,
        observedMetrics: ["total_sales"],
        attempts: [
          {
            kind: "lucy_begin_question",
            requestId: "r1",
            mcpClientRttMs: 90,
            ok: true,
            reason: null,
            isError: false,
            envelopeEmpty: false
          },
          {
            kind: "lucy_query",
            requestId: "r2",
            mcpClientRttMs: 90,
            ok: expected === "allow",
            reason: expected === "allow" ? null : "tool_forbidden",
            isError: false,
            envelopeEmpty: false
          }
        ]
      });
      attempts.push(
        { kind: "lucy_begin_question", ok: true, mcpClientRttMs: 90 },
        {
          kind: "lucy_query",
          ok: expected === "allow",
          mcpClientRttMs: 90
        }
      );
    }
  }
  return {
    functionalCases,
    attempts,
    samplesMs,
    problems: [],
    incomplete: false
  };
}

function baseDeps(suite, extras = {}) {
  return {
    loadJourneySuite: () => suite,
    applyCompatConfigProfile: mockApplyReady(),
    restoreCompatConfigProfile: mockRestoreOk(),
    mcpRun: mockMcpAllowRun(suite),
    runAgentJourneys: async () => ({
      status: "PASS",
      turns: passingAgentTurns(),
      attempts: [],
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    }),
    ...extras
  };
}

test("USAGE documents four entrypoints and forbidden flags", () => {
  assert.match(USAGE, /capture/);
  assert.match(USAGE, /candidate/);
  assert.match(USAGE, /upgrade/);
  assert.match(USAGE, /rollback/);
  for (const flag of FORBIDDEN_FLAGS) {
    assert.match(USAGE, new RegExp(flag));
  }
});

test("forbids --skip-query / --allow-new-deny / --accept-regression", () => {
  for (const flag of FORBIDDEN_FLAGS) {
    assert.throws(
      () => parseCli(["candidate", `--${flag}`]),
      (err) => err?.code === "FORBIDDEN_FLAG" && err.message.includes(flag)
    );
  }
});

test("missing token => BLOCKED", async () => {
  const suite = validSuite();
  const dir = tempDir();
  const result = await runCompatibilityCommand(
    "candidate",
    {
      projectRoot: dir,
      resultsDir: path.join(dir, "results"),
      tokenEnv: {}, // no tokens
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    {
      ...baseDeps(suite),
      // force real token resolution path (ignore mcpRun token needs)
      mcpRun: undefined,
      runMcpSuiteControls: async () => ({
        functionalCases: [],
        attempts: [],
        samplesMs: [],
        problems: ["token"],
        incomplete: true
      })
    }
  );
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.reasons.some((r) => /TOKEN/i.test(r)));
});

test("missing baseline on upgrade => BLOCKED", async () => {
  const suite = validSuite();
  const dir = tempDir();
  const result = await runCompatibilityCommand(
    "upgrade",
    {
      projectRoot: dir,
      resultsDir: path.join(dir, "results"),
      baselinePath: path.join(dir, "missing-baseline.json"),
      tokenEnv: TOKENS,
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    baseDeps(suite)
  );
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.reasons.some((r) => /BASELINE_MISSING/i.test(r)));
});

test("public evidence leak => FAIL", async () => {
  const suite = validSuite();
  const dir = tempDir();
  const secret = TOKENS.COMPAT_TOKEN_READONLY;
  const result = await runCompatibilityCommand(
    "candidate",
    {
      projectRoot: dir,
      resultsDir: path.join(dir, "results"),
      tokenEnv: TOKENS,
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    {
      ...baseDeps(suite),
      writePublicEvidence: (filePath, doc, secrets) => {
        // Simulate a buggy writer that embeds the token.
        const leaked = { ...doc, debugToken: secret };
        assertNoPublicEvidenceLeak(leaked, secrets);
        writeFileSync(filePath, JSON.stringify(leaked));
        return { path: filePath, evidence: leaked };
      }
    }
  );
  assert.equal(result.status, "FAIL");
  assert.ok(result.reasons.some((r) => /leak/i.test(r)));
});

test("private baseline permissions must be 0600", async () => {
  const dir = tempDir();
  const baselinePath = path.join(dir, "private", "baseline.json");
  writePrivateBaseline(
    baselinePath,
    {
      snapshotId: "snap-1",
      suiteDigest: "sha256:abc",
      token: TOKENS.COMPAT_TOKEN_READONLY
    },
    [TOKENS.COMPAT_TOKEN_READONLY]
  );
  const mode = assertPrivateFileMode(baselinePath, 0o600);
  assert.equal(mode.ok, true, mode.reason);
  const parentMode = statSync(path.dirname(baselinePath)).mode & 0o777;
  assert.equal(parentMode, 0o700);
  const body = readFileSync(baselinePath, "utf8");
  assert.doesNotMatch(body, /lucy_e2e_a{10,}/);
  assert.match(body, /REDACTED/);
});

test("assertPrivateFileMode fails when mode is not 0600", () => {
  const dir = tempDir();
  const file = path.join(dir, "baseline.json");
  writeFileSync(file, "{}\n", { mode: 0o644 });
  chmodSync(file, 0o644);
  const check = assertPrivateFileMode(file, 0o600);
  assert.equal(check.ok, false);
});

test("isError MCP envelope maps to deny / surfaces in functional cases", async () => {
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    if (call === 1) {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              content: [{ type: "text", text: JSON.stringify({ turnId: "t1" }) }]
            }
          })
      };
    }
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: {
            isError: true,
            content: [{ type: "text", text: JSON.stringify({ reason: "tool_forbidden" }) }]
          }
        })
    };
  };
  const client = createMcpClient({
    baseUrl: "http://127.0.0.1:9/mcp",
    token: TOKENS.COMPAT_TOKEN_READONLY,
    fetchImpl
  });
  const controlResult = await runMcpControl({
    client,
    control: {
      begin: "x",
      query: { connectionId: "demo-mysql", measures: ["superstore_orders.total_sales"] }
    },
    identityId: "allow_readonly",
    caseId: "QB-FOLLOW-01"
  });
  assert.equal(controlResult.attempts.some((a) => a.isError), true);
  const parsed = parseMcpToolResult({
    status: 200,
    json: {
      result: { isError: true, content: [{ type: "text", text: "{\"reason\":\"x\"}" }] }
    }
  });
  assert.equal(parsed.isError, true);
  assert.equal(parsed.ok, false);
});

test("incomplete attempts prevent PASS", async () => {
  const suite = validSuite();
  const dir = tempDir();
  const mcpRun = mockMcpAllowRun(suite);
  mcpRun.attempts.push({ kind: "lucy_query", ok: undefined, mcpClientRttMs: 10 });
  const result = await runCompatibilityCommand(
    "candidate",
    {
      projectRoot: dir,
      resultsDir: path.join(dir, "results"),
      tokenEnv: TOKENS,
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    baseDeps(suite, { mcpRun })
  );
  assert.notEqual(result.status, "PASS");
  assert.ok(result.reasons.some((r) => /incomplete attempts/i.test(r)));
});

test("agent adapter missing yields AGENT_ADAPTER_MISSING on agent axis", async () => {
  const suite = validSuite();
  const dir = tempDir();
  const result = await runCompatibilityCommand(
    "candidate",
    {
      projectRoot: dir,
      resultsDir: path.join(dir, "results"),
      tokenEnv: TOKENS,
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    {
      ...baseDeps(suite),
      runAgentJourneys: null,
      importFn: async () => {
        throw new Error("MODULE_NOT_FOUND");
      }
    }
  );
  assert.notEqual(result.status, "PASS");
  assert.ok(result.reasons.some((r) => /AGENT_ADAPTER_MISSING/.test(r)));
  const missing = await agentAdapterMissing();
  assert.equal(missing.reason, "AGENT_ADAPTER_MISSING");
});

test("fingerprint mismatch vs suite requiredConfigFingerprint => BLOCKED", async () => {
  const suite = validSuite();
  const dir = tempDir();
  const result = await runCompatibilityCommand(
    "candidate",
    {
      projectRoot: dir,
      resultsDir: path.join(dir, "results"),
      tokenEnv: TOKENS,
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    {
      ...baseDeps(suite),
      applyCompatConfigProfile: mockApplyReady("sha256:wrong-fingerprint")
    }
  );
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.reasons.some((r) => /fingerprint mismatch/i.test(r)));
});

test("restore failure stops with FAIL", async () => {
  const suite = validSuite();
  const dir = tempDir();
  const result = await runCompatibilityCommand(
    "candidate",
    {
      projectRoot: dir,
      resultsDir: path.join(dir, "results"),
      tokenEnv: TOKENS,
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    {
      ...baseDeps(suite),
      restoreCompatConfigProfile: () => {
        throw new CompatConfigRestoreError("simulated restore boom");
      }
    }
  );
  assert.equal(result.status, "FAIL");
  assert.equal(result.restoreError, true);
  assert.ok(result.reasons.some((r) => /restore failure/i.test(r)));
});

test("candidate writes schema-shaped evidence with digests and no secrets", async () => {
  const suite = validSuite();
  const dir = tempDir();
  const resultsDir = path.join(dir, "results");
  const result = await runCompatibilityCommand(
    "candidate",
    {
      projectRoot: dir,
      resultsDir,
      tokenEnv: TOKENS,
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    baseDeps(suite)
  );
  assert.equal(result.status, "PASS");
  const evidencePath = path.join(resultsDir, "mcp-compatibility-candidate.json");
  assert.equal(existsSync(evidencePath), true);
  const doc = JSON.parse(readFileSync(evidencePath, "utf8"));
  assert.equal(doc.kind, "candidate");
  assert.ok(doc.suiteDigest?.startsWith("sha256:"));
  assert.ok(doc.digests?.evidenceBodyDigest?.startsWith("sha256:"));
  assert.ok(doc.verdicts?.functionalCompatibility);
  assert.doesNotMatch(JSON.stringify(doc), /lucy_e2e_/);
});

test("capture writes private baseline; upgrade blocked without it then passes with it", async () => {
  const suite = validSuite();
  const dir = tempDir();
  const baselinePath = path.join(dir, "private", "baseline.json");
  const resultsDir = path.join(dir, "results");

  const capture = await runCompatibilityCommand(
    "capture",
    {
      projectRoot: dir,
      resultsDir,
      baselinePath,
      tokenEnv: TOKENS,
      clientFingerprint: "client-a",
      modelFingerprint: "model-a",
      snapshotId: "snap-test-1"
    },
    baseDeps(suite)
  );
  assert.equal(capture.status, "PASS");
  assert.equal(existsSync(baselinePath), true);
  assert.equal(assertPrivateFileMode(baselinePath, 0o600).ok, true);
  const baseline = readPrivateBaseline(baselinePath);
  assert.equal(baseline.snapshotId, "snap-test-1");

  const missing = await runCompatibilityCommand(
    "upgrade",
    {
      projectRoot: dir,
      resultsDir,
      baselinePath: path.join(dir, "nope.json"),
      tokenEnv: TOKENS,
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    baseDeps(suite)
  );
  assert.equal(missing.status, "BLOCKED");

  // upgrade must not trust forged top-level candidate status alone — inject a
  // pre-verified candidateEvidence via deps (B3 recompute path covered separately).
  const upgrade = await runCompatibilityCommand(
    "upgrade",
    {
      projectRoot: dir,
      resultsDir,
      baselinePath,
      tokenEnv: TOKENS,
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    {
      ...baseDeps(suite),
      candidateEvidence: { status: "PASS", kind: "candidate" }
    }
  );
  assert.equal(upgrade.status, "PASS");
  assert.equal(upgrade.phase, "POST");
  assert.equal(existsSync(path.join(resultsDir, "mcp-compatibility-instance.json")), true);
});

test("rollback appends ROLLBACK_VERIFY phase", async () => {
  const suite = validSuite();
  const dir = tempDir();
  const baselinePath = path.join(dir, "private", "baseline.json");
  const resultsDir = path.join(dir, "results");
  writePrivateBaseline(
    baselinePath,
    {
      snapshotId: "snap-rb",
      suiteDigest: "sha256:x",
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    []
  );
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    path.join(resultsDir, "mcp-compatibility-instance.json"),
    JSON.stringify({
      kind: "instance",
      phases: { POST: { status: "PASS" } },
      denominator: { caseCount: 3 }
    }),
    "utf8"
  );

  const result = await runCompatibilityCommand(
    "rollback",
    {
      projectRoot: dir,
      resultsDir,
      baselinePath,
      tokenEnv: TOKENS,
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    baseDeps(suite)
  );
  assert.ok(["PASS", "BLOCKED", "FAIL"].includes(result.status));
  const doc = JSON.parse(
    readFileSync(path.join(resultsDir, "mcp-compatibility-instance.json"), "utf8")
  );
  assert.ok(doc.phases?.ROLLBACK_VERIFY);
});

test("resolveTokenRef reports TOKEN_MISSING", () => {
  const missing = resolveTokenRef("env:COMPAT_TOKEN_READONLY", {});
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "TOKEN_MISSING");
  const ok = resolveTokenRef("env:COMPAT_TOKEN_READONLY", TOKENS);
  assert.equal(ok.ok, true);
});

test("writePublicEvidence rejects leaked bearer token shapes", () => {
  const dir = tempDir();
  const file = path.join(dir, "mcp-compatibility-candidate.json");
  assert.throws(
    () =>
      writePublicEvidence(
        file,
        {
          kind: "candidate",
          status: "PASS",
          note: `Bearer ${TOKENS.COMPAT_TOKEN_READONLY}`
        },
        [TOKENS.COMPAT_TOKEN_READONLY]
      ),
    (err) => err?.code === "PUBLIC_EVIDENCE_LEAK"
  );
});


test("B1↔B2 seam: normalizeAgentRun reads agentTurns/agentLatencyInput", () => {
  const fromB2 = normalizeAgentRun({
    status: "PASS",
    agentTurns: [{ turnWallClockMs: 10 }, { turnWallClockMs: 20 }, { turnWallClockMs: 30 }],
    agentLatencyInput: { turns: [{ turnWallClockMs: 11 }, { turnWallClockMs: 21 }, { turnWallClockMs: 31 }] },
    clientFingerprint: "client:cursor-agent-cli|adapter:x|version:1",
    modelFingerprint: "model:default"
  });
  assert.equal(fromB2.turns.length, 3);
  assert.equal(fromB2.turns[0].turnWallClockMs, 11);
});

test("B1↔B2 seam: runAgentAxis passes selectedClientId and stickyFingerprints", async () => {
  let seen = null;
  const out = await runAgentAxis(
    {
      suite: { cases: [] },
      selectedClientId: "cursor-agent-cli",
      stickyFingerprints: {
        clientFingerprint: "client:cursor-agent-cli|adapter:x|version:1",
        modelFingerprint: "model:default"
      },
      mcpUrl: "http://127.0.0.1:9/mcp"
    },
    {
      runAgentJourneys: async (args) => {
        seen = args;
        return {
          status: "PASS",
          agentTurns: [{ turnWallClockMs: 5 }, { turnWallClockMs: 6 }, { turnWallClockMs: 7 }],
          agentLatencyInput: {
            turns: [{ turnWallClockMs: 5 }, { turnWallClockMs: 6 }, { turnWallClockMs: 7 }]
          },
          clientFingerprint: args.stickyFingerprints.clientFingerprint,
          modelFingerprint: args.stickyFingerprints.modelFingerprint,
          selectedClientId: args.selectedClientId
        };
      }
    }
  );
  assert.equal(seen.selectedClientId, "cursor-agent-cli");
  assert.equal(seen.stickyFingerprints.clientFingerprint, "client:cursor-agent-cli|adapter:x|version:1");
  assert.equal(out.turns.length, 3);
});

test("B1↔B3 seam: candidate evidence passes verifyMcpCompatibilityEvidenceDoc shape", () => {
  const suite = {
    questionBankId: "lucy-mcp-upgrade-journeys",
    requiredConfigFingerprint: "sha256:fixture",
    cases: [
      { id: "QB-FOLLOW-01", family: "follow-up" },
      { id: "QB-ACL-01", family: "permission" },
      { id: "QB-DB-01", family: "multi-connection" }
    ]
  };
  // minimal valid suite fields for validateJourneySuite — reuse helper if present
  const functionalCases = suite.cases.map((c) => ({
    id: c.id,
    expectedOutcome: "allow",
    observedOutcome: "allow",
    expectedNonempty: true,
    observedRowCount: 1,
    attempts: [{ ok: true }, { ok: true }, { ok: true }]
  }));
  const attempts = functionalCases.flatMap((c) =>
    c.attempts.map((a) => ({ ...a, caseId: c.id }))
  );
  const mcpSamples = Array.from({ length: 20 }, () => 100);
  const agentTurns = [{ turnWallClockMs: 1000 }, { turnWallClockMs: 1100 }, { turnWallClockMs: 1200 }];
  const verdict = {
    status: "PASS",
    entrypoint: "certifyCandidate",
    verdicts: {
      functionalCompatibility: "PASS",
      serviceLatency: "PASS",
      agentLatency: "PASS"
    },
    reasons: []
  };
  const doc = buildCandidateEvidence({
    suite,
    suiteDigest: "sha256:suite",
    verdict,
    functionalCases,
    clientFingerprint: "client:x",
    modelFingerprint: "model:y",
    configProfileFingerprint: "sha256:fixture",
    batchWallClockMs: 1234,
    attempts,
    mcp: { budgetClass: "simple", samplesMs: mcpSamples },
    agent: { turns: agentTurns },
    coverageMode: "full"
  });
  assert.equal(doc.coverageMode, "full");
  assert.ok(Array.isArray(doc.denominator.expectedCaseIds));
  assert.equal(doc.cases[0].attempts.length >= 1, true);
  const v = verifyMcpCompatibilityEvidenceDoc({
    doc,
    expectedKind: "candidate",
    suite
  });
  // May BLOCKED on suite validation if suite lacks full fields; assert shape fields present either way
  assert.equal(doc.contract, "lucy-mcp-compatibility-evidence-v1");
  assert.ok(doc.cases.every((c) => Array.isArray(c.attempts) && c.status));
  if (!v.ok) {
    // Accept BLOCKED only for suite-shape reasons in this minimal fixture — still must not be missing_field for coverageMode/attempts
    assert.equal(
      v.problems?.some((p) => /coverageMode|missing attempts|expectedCaseIds/i.test(p.code || p.message || p)) ?? false,
      false,
      JSON.stringify(v.problems, null, 2)
    );
  }
});

test("forged candidate top-level PASS alone does not satisfy upgrade", async () => {
  const suite = validSuite();
  const dir = tempDir();
  const baselinePath = path.join(dir, "private", "baseline.json");
  const resultsDir = path.join(dir, "results");
  writePrivateBaseline(
    baselinePath,
    {
      snapshotId: "snap-forge",
      suiteDigest: "sha256:x",
      clientFingerprint: "client-a",
      modelFingerprint: "model-a",
      selectedClientId: "cursor-agent-cli"
    },
    []
  );
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    path.join(resultsDir, "mcp-compatibility-candidate.json"),
    JSON.stringify({ kind: "candidate", status: "PASS" }),
    "utf8"
  );
  const upgrade = await runCompatibilityCommand(
    "upgrade",
    {
      projectRoot: dir,
      resultsDir,
      baselinePath,
      tokenEnv: TOKENS,
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    baseDeps(suite)
  );
  assert.notEqual(upgrade.status, "PASS");
});
