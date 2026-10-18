// Per-carrier A6 integration tests for collect-gate-results.mjs (Plan A6, Review a6-collector).
//
// Each of the four carrier cases (SEC-06-V03 / V04 / V05 + SEC-17-V10) names a SPECIFIC sub-tree of
// the run; a missing carrier blocks that case, an actual leak in its bytes fails it. These tests
// build a synthetic run directory, call collectGateResults(), and assert the per-case verdict.
//
// Per-ask indexed evidence is the binding between an ask (identity / goldKey) and the carrier
// bytes it produced. The gate collector reads results/agent.json for the `asks[]` records
// (Review A4) and uses them to compute per-question forbidden canaries. Without agent.json,
// the per-ask canary binding cannot be established and V03/V10 block with the reason recorded
// (not silently default to a global union of canaries). Tests that want a per-question scan to
// pass MUST seed agent.json.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { collectGateResults } from "../../gates/collect-gate-results.mjs";
import { loadCatalog } from "../lib/catalog.mjs";

const tmp = () => mkdtempSync(path.join(tmpdir(), "gate-carrier-"));
const cleanup = new Set();
function track(dir) { cleanup.add(dir); return dir; }
after(() => { for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const SAMPLE_SECRETS = {
  owner: { password: "owner-secret-VALUE-12345" },
  operator: { password: "operator-secret-VALUE-12345" }
};
const SAMPLE_TOKENS = {
  "e2e-finance": "finance-token-VALUE-12345",
  "e2e-sales": "sales-token-VALUE-12345"
};
const SAMPLE_FORBIDDEN_CANARIES = ["CANARY-FIN-ROW-91D5CA3489", "CANARY-SALES-WIKI-8C78D46113"];

// A minimal gold that splits per-question canaries like real SEC-06/17 cases:
//   - Q-FIN-ORDERS-EAST forbids salesRow + piiEmail (finance is allowed)
//   - Q-SALES-ORDERS-WEST forbids financeRow (sales is forbidden from seeing finance data)
//   - Q-NEUTRAL forbids nothing
const SAMPLE_GOLD = {
  contract: "lucy-security-e2e-gold-v1",
  canaries: { financeRow: "CANARY-FIN-ROW-X", salesRow: "CANARY-SALES-ROW-X", salesWiki: "CANARY-SALES-WIKI-X", financeWiki: "CANARY-FIN-WIKI-X" },
  questions: {
    "Q-FIN-ORDERS-EAST": { forbiddenCanaries: ["CANARY-SALES-ROW-91D5CA3489", "CANARY-PII-EMAIL-91D5CA3489"] },
    "Q-SALES-ORDERS-WEST": { forbiddenCanaries: ["CANARY-FIN-ROW-91D5CA3489"] },
    "Q-NEUTRAL": { forbiddenCanaries: [] }
  }
};

function seedAgentJson(run, { asks }) {
  const resultsDir = path.join(run.paths.runDir, "results");
  mkdirSync(resultsDir, { recursive: true });
  // The carrier router consults the catalog's per-case ask plan to enforce plan-identity
  // and `injectionForbidden`. Test fixtures that exercise per-ask routing with custom
  // gold keys use a synthetic caseId that is NOT in the catalog, so the buildCanaryPolicy
  // falls back to a GOLD-ONLY policy. Real production runs always resolve to a catalog
  // case and so always get the full plan enforcement.
  const cases = [{
    id: "TEST-AGENT-CASE", runner: "agent", scenario: "TEST", client: "claude-code", run: 1,
    status: "passed", startedAt: "2026-10-18T00:00:00.000Z", finishedAt: "2026-10-18T00:01:00.000Z",
    serverTraceIds: [], queryEventIds: [], policyVersion: "v1", contextPolicyVersion: "v1",
    asks: asks.map((a, askIndex) => ({
      askIndex,
      agentId: a.agentId,
      goldKey: a.goldKey,
      expectation: a.expectation ?? "answer",
      sessionId: `session-${askIndex}`,
      model: "test-model",
      since: "2026-10-18T00:00:00.000Z",
      until: "2026-10-18T00:01:00.000Z",
      tokenFingerprint: `fingerprint-${askIndex}`,
      answer: a.answer ?? "",
      // The carrier router binds the ask's policy to a file via `answerPath`. Tests that
      // want per-ask routing to apply to a specific file set the same `answerPath` here
      // as the test writes to. The default is the canonical client-work path for the
      // ask's agentId; tests can override by passing `answerPath` in the ask spec.
      answerPath: a.answerPath ?? `client-work/${a.agentId}/answer.json`,
      bindingProblems: []
    })),
    assertions: [], artifacts: []
  }];
  const body = {
    contract: "lucy-agent-e2e-v1",
    runId: run.runId,
    startedAt: "2026-10-18T00:00:00.000Z",
    finishedAt: "2026-10-18T00:01:00.000Z",
    cases
  };
  writeFileSync(path.join(resultsDir, "agent.json"), `${JSON.stringify(body, null, 2)}\n`);
}

function seedCapturePolicy(run, { trace = "off", screenshot = "off", video = "off", inventory = [], runId } = {}) {
  const body = {
    contract: "lucy-capture-policy-v1",
    runId: runId ?? run.runId,
    generatedAt: new Date().toISOString(),
    policy: { trace, screenshot, video, source: "webui/playwright.real.config.ts" },
    inventory: { clientWork: inventory, capture: [], screenshots: [], traces: [], attachments: [], other: [] },
    violated: !(trace === "off" && screenshot === "off" && video === "off")
  };
  writeFileSync(path.join(run.paths.runDir, "capture-policy.json"), `${JSON.stringify(body, null, 2)}\n`);
}

/**
 * V03 (URL/存储/argv/日志) needs four subcarrier files. The current codebase does not yet
 * produce argv.json / storage.json / url.json; tests that want V03 to pass must seed stubs.
 */
function seedV03Subcarriers(run, { argv = ["node", "server/index.ts"], storage = ["/var/lib/lucy/store"], urls = ["http://127.0.0.1:8787"] } = {}) {
  writeFileSync(path.join(run.paths.logs, "argv.json"), JSON.stringify({ argv }));
  writeFileSync(path.join(run.paths.logs, "storage.json"), JSON.stringify({ paths: storage }));
  writeFileSync(path.join(run.paths.logs, "url.json"), JSON.stringify({ referenced: urls }));
}

function seedRun({ runId, withGold = true, goldForbidden = SAMPLE_FORBIDDEN_CANARIES, goldJson = null, agentAsks = null } = {}) {
  const runDir = track(tmp());
  for (const name of ["project", "checker", "probe", "outside", "client-work", "logs"]) {
    mkdirSync(path.join(runDir, name), { recursive: true });
  }
  const secretsDir = path.join(runDir, "checker", "secrets");
  mkdirSync(secretsDir, { recursive: true });
  writeFileSync(path.join(secretsDir, "admins.json"), JSON.stringify(SAMPLE_SECRETS));
  writeFileSync(path.join(secretsDir, "tokens.json"), JSON.stringify(SAMPLE_TOKENS));
  writeFileSync(path.join(secretsDir, "bootstrap-token"), "bootstrap-secret-VALUE-12345\n");
  if (withGold) {
    const gold = goldJson ?? {
      contract: "lucy-security-e2e-gold-v1",
      canaries: { financeRow: "CANARY-FIN-ROW-X", salesWiki: "CANARY-SALES-WIKI-X" },
      questions: { "Q-1": { forbiddenCanaries: goldForbidden } }
    };
    writeFileSync(path.join(runDir, "checker", "gold.json"), JSON.stringify(gold));
  }
  const run = {
    contract: "lucy-e2e-run-v1",
    runId,
    mode: "local",
    executionMode: "local",
    releaseEligible: false,
    paths: {
      runDir,
      project: path.join(runDir, "project"),
      checker: path.join(runDir, "checker"),
      probe: path.join(runDir, "probe"),
      outside: path.join(runDir, "outside"),
      "client-work": path.join(runDir, "client-work"),
      logs: path.join(runDir, "logs")
    },
    instance: { baseUrl: "http://127.0.0.1:0", mcpUrl: "http://127.0.0.1:0/mcp" },
    db: { host: "127.0.0.1", port: 0 },
    secretsDir
  };
  if (agentAsks) seedAgentJson(run, { asks: agentAsks });
  return run;
}

const CANDIDATE = { imageDigest: "sha256:" + "0".repeat(64), gitSha: "0".repeat(40), treeDigest: "0".repeat(64), platform: "test", ktxVersion: "test", chartVersion: "test" };

function findCase(body, id) {
  return body.cases.find((c) => c.id === id);
}

// A no-op reverse-tests stub: GATE-01 cases all "not found" -> blocked; the carrier cases are
// what we are testing here, so this only exercises the carrier path.
const stubReverseTests = async () => new Map();

const catalog = loadCatalog();
const expectedAssertTokens = Object.fromEntries(
  catalog.cases.filter((c) => c.runner === "gate").map((c) => [c.id, new Set(c.assert)])
);

describe("collect-gate-results: per-carrier A6 routing (review-a6-collector)", () => {
  // ---------------------------------------------------------------------------------------------
  // REVIEW ITEM 1: catalog assertions. SEC-06-V03/V04/V05 + SEC-17-V10 declare
  //   assert: [no_leak, artifact_scan]. The collector MUST emit BOTH tokens as true for a passed
  //   entry, and the verifier rejects missing assertion evaluations.
  // ---------------------------------------------------------------------------------------------
  it("[review-1] producer→verifier integration: every passed carrier entry evaluates BOTH no_leak AND artifact_scan (the actual catalog tokens)", async () => {
    // Build a run with all four cases passing their carriers and a per-ask agent.json so the
    // canary policy is bound. Every passed entry's `assertions` must contain both tokens as true.
    const run = seedRun({
      runId: "gate-review-1-pass",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    // V03: clean log + URL/storage/argv subcarrier stubs
    writeFileSync(path.join(run.paths.logs, "lucy.log"), "INFO server ok\nINFO ready\n");
    seedV03Subcarriers(run);
    // V04: clean capture-policy + a clean client-work capture directory + Playwright report stub
    // (the report is the runtime receipt that proves the management journey actually ran; without
    // it the capture-policy proof is "empty inventory / no receipt" -> blocked).
    seedCapturePolicy(run);
    mkdirSync(path.join(run.paths.runDir, "results"), { recursive: true });
    writeFileSync(path.join(run.paths.runDir, "results", "management-playwright.json"), JSON.stringify({ ok: true }));
    const clientCapture = path.join(run.paths["client-work"], "claude-code", "capture");
    mkdirSync(clientCapture, { recursive: true });
    writeFileSync(path.join(clientCapture, "mcp.json"), JSON.stringify({ note: "clean" }));
    // V05: clean exports + audit
    mkdirSync(path.join(run.paths.runDir, "results", "exports"), { recursive: true });
    writeFileSync(path.join(run.paths.runDir, "results", "exports", "ok.json"), JSON.stringify({ note: "clean export" }));
    mkdirSync(path.join(run.paths.runDir, "results", "audit"), { recursive: true });
    writeFileSync(path.join(run.paths.runDir, "results", "audit", "audit.json"), JSON.stringify({ entries: [] }));
    // V10: clean results.json (this will share with V05)
    writeFileSync(path.join(run.paths.runDir, "results", "test.json"), JSON.stringify({ ok: true }));
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    for (const id of ["SEC-06-V03", "SEC-06-V04", "SEC-06-V05", "SEC-17-V10"]) {
      const entry = findCase(body, id);
      assert.equal(entry.status, "passed", `${id} should pass; got ${entry.status}; detail=${entry.detail}`);
      const tokens = new Set(entry.assertions.map((a) => a.token));
      const expected = expectedAssertTokens[id];
      for (const token of expected) {
        assert.ok(tokens.has(token), `${id} missing catalog assertion "${token}"; emitted tokens: ${[...tokens].join(",")}`);
        const evalToken = entry.assertions.find((a) => a.token === token);
        assert.equal(evalToken.passed, true, `${id} catalog assertion "${token}" did not hold: ${evalToken.detail}`);
      }
    }
  });

  it("[review-1] the collector does NOT emit carrier_present (a non-catalog token)", async () => {
    const run = seedRun({
      runId: "gate-review-1-no-carrier-present",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    writeFileSync(path.join(run.paths.logs, "lucy.log"), "INFO server ok\n");
    seedV03Subcarriers(run);
    seedCapturePolicy(run);
    mkdirSync(path.join(run.paths.runDir, "results", "exports"), { recursive: true });
    writeFileSync(path.join(run.paths.runDir, "results", "exports", "ok.json"), JSON.stringify({ note: "clean" }));
    mkdirSync(path.join(run.paths.runDir, "results", "audit"), { recursive: true });
    writeFileSync(path.join(run.paths.runDir, "results", "audit", "audit.json"), JSON.stringify({}));
    writeFileSync(path.join(run.paths.runDir, "results", "test.json"), JSON.stringify({ ok: true }));
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    for (const id of ["SEC-06-V03", "SEC-06-V04", "SEC-06-V05", "SEC-17-V10"]) {
      const entry = findCase(body, id);
      assert.ok(!entry.assertions.some((a) => a.token === "carrier_present"), `${id} must not emit the non-catalog token "carrier_present"; emitted: ${entry.assertions.map((a) => a.token).join(",")}`);
    }
  });

  // ---------------------------------------------------------------------------------------------
  // REVIEW ITEM 2: scanCarrierCase previously scanned only existing[0]; a first clean root could
  // hide a later root's leak. Now the collector scans every required root and aggregates.
  // ---------------------------------------------------------------------------------------------
  it("[review-2] two-root leak: a clean first root does NOT hide a leaked second root", async () => {
    // V05 has two subcarrier roots: results/exports + results/audit (and audit.json).
    // Put a credential inside the SECOND root; the first root is clean. The case must FAIL
    // because the leak is in a scanned root, not silently pass because of the clean first.
    const run = seedRun({
      runId: "gate-review-2-two-root-leak",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    mkdirSync(path.join(run.paths.runDir, "results", "exports"), { recursive: true });
    writeFileSync(path.join(run.paths.runDir, "results", "exports", "ok.json"), JSON.stringify({ note: "clean" }));
    mkdirSync(path.join(run.paths.runDir, "results", "audit"), { recursive: true });
    writeFileSync(path.join(run.paths.runDir, "results", "audit", "leak.json"), JSON.stringify({ note: "the secret is operator-secret-VALUE-12345" }));
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V05");
    assert.equal(entry.status, "failed", `two-root leak should fail; got ${entry.status}; detail=${entry.detail}`);
    assert.ok(entry.assertions.some((a) => a.token === "no_leak" && !a.passed));
  });

  it("[review-2] multi-client leak: a clean first client's capture does NOT hide a leaked second client's trace", async () => {
    // V04's client-capture subcarrier walks EVERY client-work/*/{capture,screenshots,traces,...}.
    // A clean first client must not hide a leaked second client's screenshot.
    const run = seedRun({
      runId: "gate-review-2-multi-client-leak",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    seedCapturePolicy(run); // capture-policy.json validated independently
    // First client is clean (only a JSON file inside its capture dir)
    const client1 = path.join(run.paths["client-work"], "claude-code", "capture");
    mkdirSync(client1, { recursive: true });
    writeFileSync(path.join(client1, "mcp.json"), JSON.stringify({ note: "clean" }));
    // Second client has a PNG with a plaintext credential in the body
    const client2 = path.join(run.paths["client-work"], "openclaw", "screenshots");
    mkdirSync(client2, { recursive: true });
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const body = Buffer.from("the secret is finance-token-VALUE-12345", "utf8");
    writeFileSync(path.join(client2, "trace.png"), Buffer.concat([pngHeader, body]));
    const result = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(result, "SEC-06-V04");
    assert.equal(entry.status, "failed", `multi-client leak should fail; got ${entry.status}; detail=${entry.detail}`);
  });

  // ---------------------------------------------------------------------------------------------
  // REVIEW ITEM 3: per-ask forbidden canaries. The previous code UNIONed every question's
  // forbidden canaries and treated them as forbidden for everyone. Finance canary was forbidden
  // globally even for finance asks that were allowed to see it. The fix: read per-ask indexed
  // evidence from results/agent.json and compute the union ONLY across asks that ACTUALLY RAN.
  // Missing per-ask indexed evidence blocks the case (does not default to "complete").
  // ---------------------------------------------------------------------------------------------
  it("[review-3] authorized-finance control: a finance ask sees its allowed canary in a server log and the case PASSES", async () => {
    // Q-FIN-ORDERS-EAST forbids salesRow + piiEmail but allows financeRow. The finance ask runs
    // Q-FIN-ORDERS-EAST and the server log contains financeRow (it would not — but the test is
    // simulating a benign authorization path). The case should not falsely fail on the canary
    // financeRow: only asks' forbidden canaries are enforced.
    const run = seedRun({
      runId: "gate-review-3-finance-control",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-FIN-ORDERS-EAST" }]
    });
    writeFileSync(path.join(run.paths.logs, "lucy.log"), "INFO server contains CANARY-FIN-ROW-91D5CA3489 (allowed for finance) ok\n");
    seedV03Subcarriers(run);
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V03");
    assert.equal(entry.status, "passed", `authorized-finance control should pass; got ${entry.status}; detail=${entry.detail}`);
  });

  it("[review-3] sales-denied same file: a sales ask sees the finance canary in the same log and the case FAILS", async () => {
    // The sales ask runs Q-SALES-ORDERS-WEST which forbids financeRow. The server log contains
    // financeRow — that is forbidden for the sales ask and must FAIL. The ask's answerPath
    // is bound to the log file so the carrier router routes the file to the sales policy.
    const run = seedRun({
      runId: "gate-review-3-sales-denied",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-sales", goldKey: "Q-SALES-ORDERS-WEST", answerPath: "logs/lucy.log" }]
    });
    writeFileSync(path.join(run.paths.logs, "lucy.log"), "INFO server contains CANARY-FIN-ROW-91D5CA3489 (forbidden for sales) ok\n");
    seedV03Subcarriers(run);
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V03");
    assert.equal(entry.status, "failed", `sales-denied finance canary should fail; got ${entry.status}; detail=${entry.detail}`);
  });

  it("[review-3] wrong-identity leak: a finance ask sees salesRow and the case FAILS", async () => {
    // The finance ask runs Q-FIN-ORDERS-EAST which forbids salesRow. The server log contains
    // salesRow — that is a real wrong-identity leak and must FAIL. The ask's answerPath is
    // bound to the log so the carrier router routes the file to the finance policy.
    const run = seedRun({
      runId: "gate-review-3-wrong-identity",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-FIN-ORDERS-EAST", answerPath: "logs/lucy.log" }]
    });
    writeFileSync(path.join(run.paths.logs, "lucy.log"), "INFO server contains CANARY-SALES-ROW-91D5CA3489 (forbidden for finance) ok\n");
    seedV03Subcarriers(run);
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V03");
    assert.equal(entry.status, "failed", `wrong-identity leak should fail; got ${entry.status}; detail=${entry.detail}`);
  });

  it("[review-3] missing per-ask indexed evidence BLOCKS the case with an explicit dependency", async () => {
    // No agent.json seeded -> the per-ask canary binding cannot be established. The case must
    // block with the reason recorded, NOT default to union.
    const run = seedRun({ runId: "gate-review-3-no-agent-json" }); // gold seeded, no agent.json
    writeFileSync(path.join(run.paths.logs, "lucy.log"), "INFO server ok\n");
    seedV03Subcarriers(run);
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V03");
    assert.equal(entry.status, "blocked", `missing per-ask evidence should block; got ${entry.status}; detail=${entry.detail}`);
    assert.match(entry.detail, /per-ask indexed evidence unavailable|results\/agent\.json/);
  });

  // ---------------------------------------------------------------------------------------------
  // REVIEW ITEM 4: capture-policy validation. capture-policy.json is a FILE (not a directory).
  // The validation must check: same run, enforced trace/screenshot/video=off, no unsupported
  // retained image, actual report/inventory. Unsupported inventory or wrong run blocks.
  // ---------------------------------------------------------------------------------------------
  it("[review-4] forged trace:on is VALIDATED: capture-policy.json with trace!='off' blocks V04", async () => {
    const run = seedRun({
      runId: "gate-review-4-forged-trace-on",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    seedCapturePolicy(run, { trace: "on" }); // policy says trace IS on — drift!
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V04");
    assert.ok(["blocked", "failed"].includes(entry.status), `forged trace:on should block/fail; got ${entry.status}; detail=${entry.detail}`);
    assert.match(entry.detail, /trace|screenshot|video|drift/);
  });

  it("[review-4] wrong runId: capture-policy.json bound to a different runId BLOCKS V04", async () => {
    const run = seedRun({
      runId: "gate-review-4-wrong-run",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    seedCapturePolicy(run, { runId: "totally-different-run-id" });
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V04");
    assert.ok(["blocked", "failed"].includes(entry.status), `wrong runId should block/fail; got ${entry.status}; detail=${entry.detail}`);
    assert.match(entry.detail, /runId/);
  });

  it("[review-4] unsupported retained image in inventory BLOCKS V04", async () => {
    // A PNG saved inside client-work is recorded in capture-policy.json's inventory. The policy
    // claim "trace/screenshot/video all off" is contradicted by the inventory listing a PNG.
    const run = seedRun({
      runId: "gate-review-4-unsupported-image",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    seedCapturePolicy(run, { inventory: [{ path: "client-work/claude-code/screenshots/trace.png", bytes: 4096 }] });
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V04");
    assert.ok(["blocked", "failed"].includes(entry.status), `unsupported retained image should block/fail; got ${entry.status}; detail=${entry.detail}`);
    assert.match(entry.detail, /unsupported retained image/);
  });

  it("[review-4] missing inventory AND no Playwright report BLOCKS V04", async () => {
    // Empty inventory + no Playwright report = the management journey never ran. Capture policy
    // proof is absent → blocked.
    const run = seedRun({
      runId: "gate-review-4-no-journey",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    seedCapturePolicy(run); // inventory=[] (default), no Playwright report written
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V04");
    assert.ok(["blocked", "failed"].includes(entry.status), `no journey should block/fail; got ${entry.status}; detail=${entry.detail}`);
    assert.match(entry.detail, /empty inventory|Playwright|management journey/);
  });

  it("[review-4] a capture-policy.json that itself contains a credential FAILS V04", async () => {
    const run = seedRun({
      runId: "gate-review-4-policy-leak",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    seedCapturePolicy(run);
    // Overwrite with a credential leak inside the policy file body
    const file = path.join(run.paths.runDir, "capture-policy.json");
    const original = JSON.parse((await import("node:fs")).readFileSync(file, "utf8"));
    original.note = "this should leak bootstrap-secret-VALUE-12345";
    writeFileSync(file, JSON.stringify(original));
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V04");
    assert.equal(entry.status, "failed", `capture-policy credential leak should fail; got ${entry.status}; detail=${entry.detail}`);
  });

  // ---------------------------------------------------------------------------------------------
  // REVIEW ITEM 5: V03 has FOUR subcarriers (URL/storage/argv/logs); the logs subcarrier alone
  // does NOT prove the other three. V05 must require actual export/audit carriers, not the
  // unrelated results/ops.json. Missing required subcarriers block.
  // ---------------------------------------------------------------------------------------------
  it("[review-5] V03 BLOCKS when URL/storage/argv subcarriers have no structured evidence (logs alone is insufficient)", async () => {
    const run = seedRun({
      runId: "gate-review-5-v03-missing-subcarriers",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    writeFileSync(path.join(run.paths.logs, "lucy.log"), "INFO server ok\n"); // logs subcarrier is fine
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V03");
    assert.equal(entry.status, "blocked", `V03 missing URL/storage/argv should block; got ${entry.status}; detail=${entry.detail}`);
    assert.match(entry.detail, /argv|storage|url/);
  });

  it("[review-5] V05 BLOCKS when no exports/audit subcarrier is present (a clean ops.json does NOT green-light V05)", async () => {
    const run = seedRun({
      runId: "gate-review-5-v05-no-exports",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    // No exports/ or audit/. Just a clean ops.json (the previous fallback that silently painted
    // V05 green). The case must BLOCK on the missing subcarriers, not pass on the unrelated file.
    mkdirSync(path.join(run.paths.runDir, "results"), { recursive: true });
    writeFileSync(path.join(run.paths.runDir, "results", "ops.json"), JSON.stringify({ cases: [] }));
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V05");
    assert.equal(entry.status, "blocked", `V05 with no exports/audit should block; got ${entry.status}; detail=${entry.detail}`);
    assert.match(entry.detail, /exports|audit/);
  });

  // ---------------------------------------------------------------------------------------------
  // REVIEW ITEM 6: the collector must NOT skip an entire results/gates directory (its own
  // output mid-flight). The previous comment claimed the JSON file was a credential; an arbitrary
  // 'no_leak passed' JSON is not a credential. The collector's self-index exclusion is only the
  // gates subdirectory (currently being written); every other retained artifact is scanned.
  // ---------------------------------------------------------------------------------------------
  it("[review-6] the collector scans results/*.json files; only its own results/gates/ subdirectory is skipped", async () => {
    const run = seedRun({
      runId: "gate-review-6-self-skip",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    mkdirSync(path.join(run.paths.runDir, "results"), { recursive: true });
    writeFileSync(path.join(run.paths.runDir, "results", "evidence.json"), JSON.stringify({ ok: true }));
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    // The collector wrote results/gates/*.json mid-flight. The V10 scan must NOT skip the entire
    // results/ directory (which would hide its own output); it only skips results/gates/.
    const v10 = findCase(body, "SEC-17-V10");
    assert.equal(v10.status, "passed", `clean evidence.json in results/ should pass; got ${v10.status}; detail=${v10.detail}`);
    // The V10 subcarrier report must NOT have excluded `evidence.json`. Both the agent.json
    // (seeded by seedRun for per-ask binding) and evidence.json are scanned.
    const v10Entry = v10.assertions.find((a) => a.token === "artifact_scan");
    assert.ok(v10Entry, "artifact_scan assertion must be present");
    const files = v10Entry.detail.match(/(\d+) file/);
    assert.ok(files && Number(files[1]) >= 1, `expected at least 1 file inspected; got ${v10Entry.detail}`);
    assert.match(v10Entry.detail, /1 subcarrier/);
  });

  it("[review-6] a credential inside results/evidence.json FAILS V10 (not silently skipped because it's 'in the gate collector's directory')", async () => {
    const run = seedRun({
      runId: "gate-review-6-self-skip-leak",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    mkdirSync(path.join(run.paths.runDir, "results"), { recursive: true });
    writeFileSync(path.join(run.paths.runDir, "results", "evidence.json"), JSON.stringify({ note: "the secret is operator-secret-VALUE-12345" }));
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const v10 = findCase(body, "SEC-17-V10");
    assert.equal(v10.status, "failed", `credential in results/evidence.json should fail; got ${v10.status}; detail=${v10.detail}`);
  });

  // ---------------------------------------------------------------------------------------------
  // Original tests, updated to seed agent.json so per-ask binding is available
  // ---------------------------------------------------------------------------------------------
  it("SEC-06-V03 (server logs) is BLOCKED when the logs directory is empty (no files inspected = no proof)", async () => {
    const run = seedRun({
      runId: "gate-v03-empty",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    mkdirSync(path.join(run.paths.runDir, "results"), { recursive: true }); // for agent.json
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V03");
    assert.ok(entry, "SEC-06-V03 case missing from gate output");
    assert.equal(entry.status, "blocked", `empty logs should block; got ${entry.status}; detail=${entry.detail}`);
  });

  it("SEC-06-V03 PASSES when a clean log file is present (with per-ask binding)", async () => {
    const run = seedRun({
      runId: "gate-v03-clean",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    writeFileSync(path.join(run.paths.logs, "lucy.log"), "INFO server start ok\nINFO ready\n");
    seedV03Subcarriers(run);
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V03");
    assert.equal(entry.status, "passed", `clean log should pass; got ${entry.status}; detail=${entry.detail}`);
  });

  it("SEC-06-V03 FAILS when a server log contains an exact credential", async () => {
    const run = seedRun({
      runId: "gate-v03-leak",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    writeFileSync(path.join(run.paths.logs, "lucy.log"), "INFO server start token=finance-token-VALUE-12345 ok\n");
    seedV03Subcarriers(run);
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V03");
    assert.equal(entry.status, "failed", `expected failed; got ${entry.status}; detail=${entry.detail}`);
    assert.ok(entry.assertions.some((a) => a.token === "no_leak" && !a.passed));
  });

  it("SEC-06-V03 BLOCKS when the logs directory does not exist at all", async () => {
    const run = seedRun({
      runId: "gate-v03-missing",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    rmSync(run.paths.logs, { recursive: true, force: true });
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V03");
    assert.equal(entry.status, "blocked", `missing carrier should block; got ${entry.status}`);
    assert.match(entry.detail, /argv|storage|url|required subcarrier/);
  });

  it("SEC-06-V03 FAILS when a forbidden canary appears in a server log", async () => {
    const run = seedRun({
      runId: "gate-v03-canary",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-FIN-ORDERS-EAST", answerPath: "logs/lucy.log" }]
    });
    writeFileSync(path.join(run.paths.logs, "lucy.log"), `INFO leak CANARY-SALES-ROW-91D5CA3489 here\n`);
    seedV03Subcarriers(run);
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V03");
    assert.equal(entry.status, "failed", `expected failed on forbidden canary; got ${entry.status}; detail=${entry.detail}`);
  });

  it("SEC-06-V04 (screenshots / trace) is BLOCKED when no client capture directory exists", async () => {
    const run = seedRun({
      runId: "gate-v04-empty",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V04");
    assert.equal(entry.status, "blocked", `no capture carrier should block; got ${entry.status}`);
  });

  it("SEC-06-V04 FAILS when a screenshot contains a plaintext credential", async () => {
    const run = seedRun({
      runId: "gate-v04-leak",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    seedCapturePolicy(run);
    const capture = path.join(run.paths["client-work"], "claude-code", "capture");
    mkdirSync(capture, { recursive: true });
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const body = Buffer.from("the secret is finance-token-VALUE-12345 here", "utf8");
    writeFileSync(path.join(capture, "screenshot.png"), Buffer.concat([pngHeader, body]));
    const result = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(result, "SEC-06-V04");
    assert.equal(entry.status, "failed", `expected failed; got ${entry.status}; detail=${entry.detail}`);
  });

  it("SEC-06-V04 BLOCKS when a screenshot is present but the secret is pixel-only (no plaintext)", async () => {
    const run = seedRun({
      runId: "gate-v04-pixel",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    seedCapturePolicy(run);
    const capture = path.join(run.paths["client-work"], "claude-code", "capture");
    mkdirSync(capture, { recursive: true });
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(128, 0xff)
    ]);
    writeFileSync(path.join(capture, "screenshot.png"), png);
    const result = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(result, "SEC-06-V04");
    assert.equal(entry.status, "blocked", `pixel-only PNG should block; got ${entry.status}; detail=${entry.detail}`);
  });

  it("SEC-06-V05 (exports / audit) is BLOCKED when no exports directory exists", async () => {
    const run = seedRun({
      runId: "gate-v05-empty",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V05");
    assert.equal(entry.status, "blocked", `no exports carrier should block; got ${entry.status}`);
  });

  it("SEC-06-V05 FAILS when a credential is inside a JSON export", async () => {
    const run = seedRun({
      runId: "gate-v05-leak",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    const exports = path.join(run.paths.runDir, "results", "exports");
    mkdirSync(exports, { recursive: true });
    writeFileSync(path.join(exports, "report.json"), JSON.stringify({ note: "the secret is operator-secret-VALUE-12345" }));
    mkdirSync(path.join(run.paths.runDir, "results", "audit"), { recursive: true });
    writeFileSync(path.join(run.paths.runDir, "results", "audit", "audit.json"), JSON.stringify({}));
    const result = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(result, "SEC-06-V05");
    assert.equal(entry.status, "failed", `expected failed; got ${entry.status}; detail=${entry.detail}`);
  });

  it("SEC-06-V05 FAILS when a credential is inside a zip export member", async () => {
    const run = seedRun({
      runId: "gate-v05-zip",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    const exports = path.join(run.paths.runDir, "results", "exports");
    mkdirSync(exports, { recursive: true });
    const inner = Buffer.from("the password is bootstrap-secret-VALUE-12345 ok", "utf8");
    const nameBuf = Buffer.from("note.txt", "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    const crc = (() => { let c = 0xffffffff; for (const b of inner) c = (crcTable[(c ^ b) & 0xff] ^ (c >>> 8)) >>> 0; return (c ^ 0xffffffff) >>> 0; })();
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(inner.length, 18);
    localHeader.writeUInt32LE(inner.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    const local = Buffer.concat([localHeader, nameBuf, inner]);
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4);
    cdHeader.writeUInt16LE(20, 6);
    cdHeader.writeUInt16LE(0, 8);
    cdHeader.writeUInt16LE(0, 10);
    cdHeader.writeUInt32LE(crc, 16);
    cdHeader.writeUInt32LE(inner.length, 20);
    cdHeader.writeUInt32LE(inner.length, 24);
    cdHeader.writeUInt16LE(nameBuf.length, 28);
    const cd = Buffer.concat([cdHeader, nameBuf]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(local.length, 16);
    const zip = Buffer.concat([local, cd, eocd]);
    writeFileSync(path.join(exports, "report.zip"), zip);
    mkdirSync(path.join(run.paths.runDir, "results", "audit"), { recursive: true });
    writeFileSync(path.join(run.paths.runDir, "results", "audit", "audit.json"), JSON.stringify({}));
    const result = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(result, "SEC-06-V05");
    assert.equal(entry.status, "failed", `zip export with credential should fail; got ${entry.status}; detail=${entry.detail}`);
  });

  it("SEC-17-V10 (test artifacts) is BLOCKED when results/ has no scannable files", async () => {
    const run = seedRun({
      runId: "gate-v10-empty",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    // The seeded agent.json is in results/; remove it so V10 has zero scannable files to
    // prove "no leak" with. (agent.json was seeded only for canary binding on V03; V10 has
    // its own requirement that results/ hold real artifacts.)
    rmSync(path.join(run.paths.runDir, "results", "agent.json"));
    const result = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(result, "SEC-17-V10");
    assert.equal(entry.status, "blocked", `empty results/ should block; got ${entry.status}; detail=${entry.detail}`);
  });

  it("SEC-17-V10 FAILS when a results/*.json contains an exact credential", async () => {
    const run = seedRun({
      runId: "gate-v10-leak",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    const results = path.join(run.paths.runDir, "results");
    mkdirSync(results, { recursive: true });
    writeFileSync(path.join(results, "management.json"), JSON.stringify({ note: "the secret is finance-token-VALUE-12345" }));
    const result = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(result, "SEC-17-V10");
    assert.equal(entry.status, "failed", `expected failed; got ${entry.status}; detail=${entry.detail}`);
  });

  it("SEC-17-V10 BLOCKS when an unsupported carrier (PNG) appears in results/", async () => {
    const run = seedRun({
      runId: "gate-v10-png",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    const results = path.join(run.paths.runDir, "results");
    mkdirSync(results, { recursive: true });
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 0xff)
    ]);
    writeFileSync(path.join(results, "screenshot.png"), png);
    const result = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(result, "SEC-17-V10");
    assert.equal(entry.status, "blocked", `unsupported carrier in results/ should block; got ${entry.status}; detail=${entry.detail}`);
  });

  it("all four cases report independently (no shared count)", async () => {
    const run = seedRun({
      runId: "gate-independent",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    writeFileSync(path.join(run.paths.logs, "lucy.log"), "INFO server start ok\n");
    seedV03Subcarriers(run);
    const results = path.join(run.paths.runDir, "results");
    mkdirSync(results, { recursive: true });
    writeFileSync(path.join(results, "management.json"), JSON.stringify({ note: "secret bootstrap-secret-VALUE-12345" }));
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    // V03: passed (clean log + clean subcarriers)
    assert.equal(findCase(body, "SEC-06-V03").status, "passed", `logs clean + subcarriers -> pass; got ${findCase(body, "SEC-06-V03").status}`);
    // V10: failed (leaky results/management.json)
    assert.equal(findCase(body, "SEC-17-V10").status, "failed", `results leaky -> fail; got ${findCase(body, "SEC-17-V10").status}`);
  });

  it("forbidden canaries are sourced from gold.json, not a global canary pool", async () => {
    const run = seedRun({
      runId: "gate-gold-canary",
      goldJson: SAMPLE_GOLD,
      goldForbidden: ["CANARY-A"],
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-FIN-ORDERS-EAST" }]
    });
    writeFileSync(path.join(run.paths.logs, "lucy.log"), "INFO server contains CANARY-Z (not in gold) ok\n");
    seedV03Subcarriers(run);
    const body = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    const entry = findCase(body, "SEC-06-V03");
    // With subcarriers + a benign canary (CANARY-Z is NOT in the gold's forbidden list), V03 passes.
    assert.equal(entry.status, "passed", `unknown canary must not fail; got ${entry.status}; detail=${entry.detail}`);
  });

  it("A6 archive relocation resilience: the carrier cases are bound to the run, not absolute paths", async () => {
    const run = seedRun({
      runId: "gate-relocation",
      goldJson: SAMPLE_GOLD,
      agentAsks: [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }]
    });
    writeFileSync(path.join(run.paths.logs, "lucy.log"), "INFO server ok\n");
    seedV03Subcarriers(run);
    const body1 = await collectGateResults({ run, candidate: CANDIDATE, reverseTests: stubReverseTests });
    assert.equal(findCase(body1, "SEC-06-V03").status, "passed", `relocated logs should still pass; got ${findCase(body1, "SEC-06-V03").status}`);
    // Move the entire run dir to a different location. Use a fresh tmpdir so cleanup still works.
    const newRoot = track(tmp());
    const { cpSync } = await import("node:fs");
    cpSync(run.paths.runDir, newRoot, { recursive: true });
    const relocated = seedRun({ runId: "gate-relocation-2" });
    relocated.paths = {
      ...run.paths,
      runDir: newRoot,
      project: path.join(newRoot, "project"),
      checker: path.join(newRoot, "checker"),
      probe: path.join(newRoot, "probe"),
      outside: path.join(newRoot, "outside"),
      "client-work": path.join(newRoot, "client-work"),
      logs: path.join(newRoot, "logs")
    };
    relocated.secretsDir = path.join(newRoot, "checker", "secrets");
    // Re-seed agent.json at the new location so the canary policy is bound.
    const asks = [{ agentId: "e2e-finance", goldKey: "Q-NEUTRAL" }];
    seedAgentJson(relocated, { asks });
    const body2 = await collectGateResults({ run: relocated, candidate: CANDIDATE, reverseTests: stubReverseTests });
    assert.equal(findCase(body2, "SEC-06-V03").status, "passed", `relocated logs should still pass; got ${findCase(body2, "SEC-06-V03").status}`);
  });
});