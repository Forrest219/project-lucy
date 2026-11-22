/**
 * P1-53 Task 3 — Agent journey runner unit tests (mocked adapters; no live CLI).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  assertFingerprintsSticky,
  buildClientFingerprint,
  buildModelFingerprint,
  detectCompatClients,
  isDirectMcpMasquerade,
  loadCompatClients,
  mapPool,
  resolveAgentConcurrency,
  runAgentJourneys,
  selectCompatClient
} from "../lib/mcp-agent-journeys.mjs";
import { DEFAULT_COMPAT_CLIENTS_PATH } from "../lib/mcp-agent-journeys.mjs";

const tmpRoots = [];
after(() => {
  for (const dir of tmpRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tmp() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-mcp-agent-"));
  tmpRoots.push(dir);
  return dir;
}

function mockAdapter({
  product = "mock-agent",
  transport = "cli",
  model = "mock-model-1",
  version = "1.0.0",
  probeStatus = "ready",
  probeReasons = [],
  sessionPrefix = "sess"
} = {}) {
  let turnCounter = 0;
  return {
    product,
    transport,
    credentialEnv: [],
    supportsContinuation: true,
    probe() {
      return {
        status: probeStatus,
        reasons: probeReasons,
        binaryPath: "/tmp/mock-agent",
        version,
        model
      };
    },
    prepare({ workDir }) {
      return { env: {}, files: [], workDir };
    },
    buildInvocation({ question, sessionId, continueSession }) {
      return {
        command: "/tmp/mock-agent",
        args: [question, continueSession ? `--resume=${sessionId}` : "--fresh"],
        cwd: "/tmp",
        env: {}
      };
    },
    parseResult() {
      turnCounter += 1;
      return {
        finalAnswer: `answer-${turnCounter}`,
        model,
        sessionId: `${sessionPrefix}-1`,
        ok: true
      };
    }
  };
}

function poolDoc(candidates) {
  return { version: 1, candidates };
}

function readyCandidate(overrides = {}) {
  const id = overrides.id ?? "claude-code-cli";
  const adapterPath = overrides.adapter ?? "scripts/e2e/adapters/claude-code.mjs";
  const candidate = {
    id,
    detect: "true",
    adapter: adapterPath,
    multiTurn: overrides.multiTurn ?? true,
    authHint: "test",
    ...overrides.candidate
  };
  const mod = overrides.mod ?? mockAdapter({ product: id, model: overrides.model ?? "m1", version: overrides.version ?? "9.9.9" });
  const probe = mod.probe();
  return {
    id,
    candidate,
    status: "ready",
    reasons: [],
    reselect: false,
    detect: { ok: true, detail: "ok" },
    probe,
    adapter: { mod, file: adapterPath, digest: "sha256:test" },
    clientFingerprint: buildClientFingerprint(candidate, probe),
    modelFingerprint: buildModelFingerprint(probe),
    authHint: candidate.authHint
  };
}

function miniSuite() {
  return {
    kind: "mcp-upgrade-question-bank",
    questionBankId: "lucy-mcp-upgrade-question-bank",
    version: 1,
    requiredConfigFingerprint: "sha256:test",
    cases: [
      {
        id: "QB-FOLLOW-01",
        turns: [{ text: "十一月销售额？" }, { text: "那十二月呢？" }],
        agentRequirements: { publicMcp: true, sameSession: true }
      },
      {
        id: "QB-BIZ-01",
        turns: [{ text: "订单数？" }],
        agentRequirements: { publicMcp: true, sameSession: false }
      }
    ]
  };
}

function clock(steps) {
  let i = 0;
  return () => {
    const v = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return v;
  };
}

test("loadCompatClients reads the A4 pool YAML", () => {
  const doc = loadCompatClients(DEFAULT_COMPAT_CLIENTS_PATH);
  assert.equal(doc.version, 1);
  assert.ok(Array.isArray(doc.candidates));
  assert.ok(doc.candidates.some((c) => c.id === "claude-code-cli"));
  assert.ok(doc.candidates.every((c) => typeof c.multiTurn === "boolean"));
});

test("isDirectMcpMasquerade rejects http / direct-mcp ids", () => {
  assert.equal(isDirectMcpMasquerade({ id: "direct-mcp" }), true);
  assert.equal(isDirectMcpMasquerade({ id: "curl" }), true);
  assert.equal(isDirectMcpMasquerade({ id: "claude-code-cli" }, { transport: "http" }), true);
  assert.equal(isDirectMcpMasquerade({ id: "claude-code-cli" }, { transport: "cli" }), false);
});

test("detectCompatClients: missing adapter / auth / multiTurn => blocked with reselect", async () => {
  const clientsDoc = poolDoc([
    {
      id: "no-multiturn",
      detect: "true",
      adapter: "scripts/e2e/adapters/claude-code.mjs",
      multiTurn: false,
      authHint: "x"
    },
    {
      id: "no-adapter",
      detect: "true",
      adapter: null,
      multiTurn: true,
      authHint: "x"
    },
    {
      id: "auth-blocked",
      detect: "true",
      adapter: "scripts/e2e/adapters/claude-code.mjs",
      multiTurn: true,
      authHint: "x"
    },
    {
      id: "ready-one",
      detect: "true",
      adapter: "scripts/e2e/adapters/claude-code.mjs",
      multiTurn: true,
      authHint: "x"
    }
  ]);

  const detection = await detectCompatClients({
    clientsDoc,
    env: {},
    deps: {
      runDetect: (c) => ({ ok: true, detail: c.id }),
      loadAdapter: async (c) => {
        if (c.id === "no-adapter" || !c.adapter) throw new Error("adapter file missing");
        if (c.id === "auth-blocked") {
          return {
            mod: mockAdapter({ probeStatus: "blocked", probeReasons: ["credential_missing: KEY"] }),
            file: c.adapter,
            digest: "sha256:x"
          };
        }
        return {
          mod: mockAdapter({ product: c.id, model: "m-ready", version: "1.0" }),
          file: c.adapter,
          digest: "sha256:x"
        };
      }
    }
  });

  const byId = Object.fromEntries(detection.candidates.map((c) => [c.id, c]));
  assert.equal(byId["no-multiturn"].status, "blocked");
  assert.ok(byId["no-multiturn"].reasons.some((r) => /multi_turn/i.test(r)));
  assert.equal(byId["no-multiturn"].reselect, true);

  assert.equal(byId["no-adapter"].status, "blocked");
  assert.ok(byId["no-adapter"].reasons.some((r) => /adapter/i.test(r)));

  assert.equal(byId["auth-blocked"].status, "blocked");
  assert.ok(byId["auth-blocked"].reasons.some((r) => /credential_missing/i.test(r)));

  assert.equal(byId["ready-one"].status, "ready");
  assert.deepEqual(detection.ready.map((r) => r.id), ["ready-one"]);
});

test("detectCompatClients: direct MCP candidate never becomes ready", async () => {
  const detection = await detectCompatClients({
    clientsDoc: poolDoc([
      {
        id: "direct-mcp",
        detect: "true",
        adapter: "scripts/e2e/adapters/claude-code.mjs",
        multiTurn: true,
        authHint: "n/a",
        transport: "http"
      }
    ]),
    deps: {
      runDetect: () => ({ ok: true, detail: "ok" }),
      loadAdapter: async () => ({
        mod: mockAdapter({ transport: "http" }),
        file: "x",
        digest: "sha256:x"
      })
    }
  });
  assert.equal(detection.ready.length, 0);
  assert.ok(detection.candidates[0].reasons.some((r) => /direct_mcp/i.test(r)));
});

test("selectCompatClient: missing selection or blocked id => reselect", () => {
  const ready = readyCandidate({ id: "claude-code-cli" });
  const detection = {
    candidates: [ready],
    ready: [ready]
  };
  const none = selectCompatClient(detection, null);
  assert.equal(none.ok, false);
  assert.equal(none.reselect, true);

  const bad = selectCompatClient(detection, "direct-mcp");
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.some((r) => /Agent denominator/i.test(r)));

  const ok = selectCompatClient(detection, "claude-code-cli");
  assert.equal(ok.ok, true);
  assert.equal(ok.selected.id, "claude-code-cli");
});

test("fingerprint sticky PRE/POST; switch client => BLOCKED", async () => {
  const workDir = tmp();
  const readyA = readyCandidate({ id: "claude-code-cli", model: "m-a", version: "1.0" });
  const readyB = readyCandidate({ id: "cursor-agent-cli", model: "m-b", version: "2.0" });

  const detectionA = {
    candidates: [readyA, readyB],
    ready: [readyA, readyB]
  };

  const wall = clock([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500]);

  const pre = await runAgentJourneys({
    suite: miniSuite(),
    selectedClientId: "claude-code-cli",
    workDir,
    token: "tok",
    attemptsPerCase: 3,
    caseIds: ["QB-BIZ-01"],
    deps: {
      detection: detectionA,
      now: wall,
      runTurn: async ({ turnIndex, attempt }) => ({
        ok: true,
        finalAnswer: `a-${attempt}-${turnIndex}`,
        sessionId: "sess-a",
        model: "m-a"
      })
    }
  });
  assert.equal(pre.status, "PASS");
  assert.ok(pre.clientFingerprint);
  assert.ok(pre.modelFingerprint);
  assert.equal(pre.attempts.length, 3);

  // Same fingerprints on POST ⇒ PASS
  const postOk = await runAgentJourneys({
    suite: miniSuite(),
    selectedClientId: "claude-code-cli",
    stickyFingerprints: {
      clientFingerprint: pre.clientFingerprint,
      modelFingerprint: pre.modelFingerprint
    },
    workDir,
    token: "tok",
    attemptsPerCase: 3,
    caseIds: ["QB-BIZ-01"],
    deps: {
      detection: detectionA,
      now: clock([0, 50, 100, 150, 200, 250, 300, 350, 400, 450]),
      runTurn: async () => ({
        ok: true,
        finalAnswer: "ok",
        sessionId: "sess-a",
        model: "m-a"
      })
    }
  });
  assert.equal(postOk.status, "PASS");
  assert.equal(postOk.clientFingerprint, pre.clientFingerprint);
  assert.equal(postOk.modelFingerprint, pre.modelFingerprint);

  // Switch client on POST ⇒ BLOCKED
  const postSwitch = await runAgentJourneys({
    suite: miniSuite(),
    selectedClientId: "cursor-agent-cli",
    stickyFingerprints: {
      clientFingerprint: pre.clientFingerprint,
      modelFingerprint: pre.modelFingerprint
    },
    workDir,
    attemptsPerCase: 3,
    caseIds: ["QB-BIZ-01"],
    deps: {
      detection: detectionA,
      now: () => 0,
      runTurn: async () => ({ ok: true, finalAnswer: "x", sessionId: "s", model: "m-b" })
    }
  });
  assert.equal(postSwitch.status, "BLOCKED");
  assert.ok(postSwitch.reasons.some((r) => /fingerprint|switched/i.test(r)));

  // Explicit mid-suite switch flag ⇒ BLOCKED
  const midSwitch = await runAgentJourneys({
    suite: miniSuite(),
    selectedClientId: "claude-code-cli",
    switchedSelectedClientId: "cursor-agent-cli",
    workDir,
    attemptsPerCase: 1,
    caseIds: ["QB-BIZ-01"],
    deps: {
      detection: detectionA,
      now: () => 0,
      runTurn: async () => ({ ok: true, finalAnswer: "x", sessionId: "s", model: "m-a" })
    }
  });
  assert.equal(midSwitch.status, "BLOCKED");
  assert.ok(midSwitch.reasons.some((r) => /mid-suite/i.test(r)));
});

test("assertFingerprintsSticky helper", () => {
  assert.equal(
    assertFingerprintsSticky(
      { clientFingerprint: "c1", modelFingerprint: "m1" },
      { clientFingerprint: "c1", modelFingerprint: "m1" }
    ).ok,
    true
  );
  assert.equal(
    assertFingerprintsSticky(
      { clientFingerprint: "c2", modelFingerprint: "m1" },
      { clientFingerprint: "c1", modelFingerprint: "m1" }
    ).ok,
    false
  );
});

test("multi-turn sameSession retains wall-clock per turn and all attempts", async () => {
  const workDir = tmp();
  const ready = readyCandidate({ id: "claude-code-cli", model: "m1" });
  const detection = { candidates: [ready], ready: [ready] };

  // 3 attempts × 2 turns = 6 wall samples; spaced clocks.
  const ticks = [];
  for (let i = 0; i < 20; i += 1) ticks.push(i * 1_000);
  const result = await runAgentJourneys({
    suite: miniSuite(),
    selectedClientId: "claude-code-cli",
    workDir,
    attemptsPerCase: 3,
    caseIds: ["QB-FOLLOW-01"],
    deps: {
      detection,
      now: clock(ticks),
      runTurn: async ({ turnIndex, continueSession, sessionId }) => {
        if (turnIndex > 0) {
          assert.equal(continueSession, true);
          assert.equal(sessionId, "sess-follow");
        }
        return {
          ok: true,
          finalAnswer: `turn-${turnIndex}`,
          sessionId: "sess-follow",
          model: "m1"
        };
      }
    }
  });

  assert.equal(result.status, "PASS");
  assert.equal(result.attempts.length, 3);
  for (const attempt of result.attempts) {
    assert.equal(attempt.turns.length, 2);
    assert.equal(attempt.sameSession, true);
    assert.equal(attempt.turns[0].sessionId, attempt.turns[1].sessionId);
    assert.ok(typeof attempt.turns[0].turnWallClockMs === "number");
    assert.ok(typeof attempt.turns[1].turnWallClockMs === "number");
  }
  assert.equal(result.agentTurns.length, 6);
  assert.equal(result.agentLatencyInput.turns.length, 6);
});

test("never count direct MCP as Agent denominator", async () => {
  const blockedSurface = await runAgentJourneys({
    suite: miniSuite(),
    selectedClientId: "claude-code-cli",
    executionSurface: "direct-mcp",
    deps: { detection: { candidates: [], ready: [] } }
  });
  assert.equal(blockedSurface.status, "BLOCKED");
  assert.ok(blockedSurface.reasons.some((r) => /direct MCP/i.test(r)));
  assert.equal(blockedSurface.attempts.length, 0);

  const blockedSelect = await runAgentJourneys({
    suite: miniSuite(),
    selectedClientId: "direct-mcp",
    deps: {
      detection: {
        candidates: [],
        ready: []
      }
    }
  });
  assert.equal(blockedSelect.status, "BLOCKED");
  assert.ok(blockedSelect.reselect);
});

test("selected client not ready => BLOCKED with reselect hint", async () => {
  const blockedOnly = {
    id: "auth-blocked",
    candidate: {
      id: "auth-blocked",
      detect: "true",
      adapter: "x",
      multiTurn: true
    },
    status: "blocked",
    reasons: ["credential_missing: KEY"],
    reselect: true,
    probe: null,
    adapter: null,
    clientFingerprint: null,
    modelFingerprint: null
  };
  const result = await runAgentJourneys({
    suite: miniSuite(),
    selectedClientId: "auth-blocked",
    deps: {
      detection: {
        candidates: [blockedOnly],
        ready: []
      }
    }
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reselect, true);
  assert.ok(result.reasons.some((r) => /not ready|credential_missing/i.test(r)));
});

test("mapPool / resolveAgentConcurrency: parallel attempt jobs keep order and bound concurrency", async () => {
  assert.equal(resolveAgentConcurrency({}), 1);
  assert.equal(resolveAgentConcurrency({ concurrency: 8 }), 8);
  assert.equal(resolveAgentConcurrency({}, { LUCY_MCP_COMPAT_AGENT_CONCURRENCY: "4" }), 4);

  let inflight = 0;
  let maxInflight = 0;
  const out = await mapPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, 20));
    inflight -= 1;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
  assert.ok(maxInflight <= 2);
  assert.ok(maxInflight >= 2);
});

test("runAgentJourneys concurrency>1 overlaps independent attempts", async () => {
  const workDir = mkdtempSync(path.join(os.tmpdir(), "lucy-agent-par-"));
  tmpRoots.push(workDir);
  const ready = readyCandidate({ id: "claude-code-cli", model: "m-a", version: "1.0" });
  let inflight = 0;
  let maxInflight = 0;
  const result = await runAgentJourneys({
    suite: miniSuite(),
    selectedClientId: "claude-code-cli",
    workDir,
    token: "tok",
    attemptsPerCase: 3,
    caseIds: ["QB-BIZ-01"],
    concurrency: 3,
    deps: {
      detection: { candidates: [ready], ready: [ready] },
      now: () => Date.now(),
      runTurn: async ({ attempt }) => {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 40));
        inflight -= 1;
        return { ok: true, finalAnswer: `a-${attempt}`, sessionId: `sess-${attempt}`, model: "m-a" };
      }
    }
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.concurrency, 3);
  assert.equal(result.attempts.length, 3);
  assert.ok(maxInflight >= 2, `expected overlapping attempts, maxInflight=${maxInflight}`);
});
