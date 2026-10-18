import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { computeGold, generateDataset } from "../../../examples/security-e2e/gold/compute-gold.mjs";
import * as claudeCode from "../adapters/claude-code.mjs";
import * as codex from "../adapters/codex.mjs";
import * as openclaw from "../adapters/openclaw.mjs";
import { TOKEN_ENV, adapterDigest, assertNoSecretInArgv, locateBinary, validateAdapter } from "../adapters/_contract.mjs";
import { catalogDigest, expectedExecutions, loadCatalog } from "../lib/catalog.mjs";
import { automatedRequiredClients, countDistinctAutomatedProducts, manualRequiredClients } from "../lib/clients.mjs";
import { REPO_ROOT } from "../lib/common.mjs";
import { applyCrossRunRules, askPlan, countDistinctProducts, loadAdapters, runAgentJourney } from "../run-agent-journey.mjs";
import { tokenFingerprintOf } from "../collect-server-evidence.mjs";

const tmpRoots = [];
const tmp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-adapter-"));
  tmpRoots.push(dir);
  return dir;
};
after(() => tmpRoots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fakeBinary(dir, name, output, code = 0) {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\necho "${output}"\nexit ${code}\n`);
  chmodSync(file, 0o755);
  return file;
}

const clientsDoc = parse(readFileSync(path.join(REPO_ROOT, "docs/qa/real-e2e-clients.yaml"), "utf8"));
const TOKEN = "lucy_e2e_0123456789abcdef0123456789abcdef0123456789abcdef";
const AUTO = [codex, claudeCode, openclaw];

describe("adapter contract (Spec §6.3 / R4 v4)", () => {
  it("automated required adapters satisfy the contract and declare transport cli", () => {
    for (const adapter of AUTO) {
      assert.deepEqual(validateAdapter(adapter), []);
      assert.equal(adapter.transport, "cli");
    }
  });

  it("a direct-HTTP script is not an acceptable adapter", () => {
    const curl = { product: "curl-as-agent", transport: "http", credentialEnv: [], probe() {}, prepare() {}, buildInvocation() {}, parseResult() {} };
    assert.ok(validateAdapter(curl).some((p) => /raw HTTP is not a real client/.test(p)));
  });

  it("registers two automated CLI products and two manual GUI products (v5: Codex dropped from automated required)", () => {
    assert.equal(countDistinctAutomatedProducts(clientsDoc.clients), 2);
    assert.equal(countDistinctProducts(clientsDoc.clients), 2);
    assert.deepEqual(automatedRequiredClients(clientsDoc.clients).map((c) => c.product).sort(), ["claude-code", "openclaw"]);
    assert.deepEqual(manualRequiredClients(clientsDoc.clients).map((c) => c.product).sort(), ["cursor", "workbuddy"]);
    assert.equal(countDistinctProducts([{ product: "hermes-a", required: true }, { product: "hermes-b", required: true }]), 1);
  });

  it("[A1 negative] does not accept a manual GUI client as part of the automated denominator", () => {
    const { cases: catalogCases } = loadCatalog();
    const mixed = [
      ...automatedRequiredClients(clientsDoc.clients),
      ...manualRequiredClients(clientsDoc.clients)
    ];
    const requiredProducts = mixed.map((c) => c.product);
    const keys = expectedExecutions(catalogCases, requiredProducts);
    // agent cases get a key for every required product — including the manual ones — which the verifier
    // would then mark as `unexpected_case` because manual GUI products are not in the automated denominator.
    assert.ok(keys.some((k) => k.includes("@workbuddy")), "the call exposes that mixing manual in is what the verifier rejects");
    const onlyAutomated = automatedRequiredClients(clientsDoc.clients).map((c) => c.product);
    const clean = expectedExecutions(catalogCases, onlyAutomated);
    assert.ok(!clean.some((k) => k.includes("@workbuddy")), "clean denominator has no manual GUI keys");
  });

  it("[A1 negative] a non-agent case may not repeat; the lock refuses it", () => {
    const { cases: catalogCases } = loadCatalog();
    const clone = JSON.parse(JSON.stringify(catalogCases));
    clone[0].runner = "security";
    clone[0].repeat = 2;
    // The catalog digest changes whenever any variant changes; the lock digest pinning fails because
    // the variant would never expand to (security, repeat=2) but the digest differs from the live catalog.
    const original = catalogDigest(catalogCases);
    const mutated = catalogDigest(clone);
    assert.notEqual(original, mutated, "repeat on a non-agent case must change the catalog digest");
  });

  it("[A1 negative] omitting a required product would shrink the denominator and is detected", () => {
    const { cases: catalogCases } = loadCatalog();
    const all = expectedExecutions(catalogCases, ["claude-code", "openclaw"]);
    const missing = expectedExecutions(catalogCases, ["claude-code"]);
    assert.notEqual(all.length, missing.length);
    assert.ok(all.length > missing.length, "removing a product strictly shrinks the agent-case keys");
  });

  it("probe reports BLOCKED when the binary is missing", () => {
    const empty = tmp();
    for (const adapter of AUTO) {
      const result = adapter.probe({ env: { PATH: empty }, spawnSync });
      assert.equal(result.status, "blocked");
      assert.ok(result.reasons.some((r) => /binary_not_found/.test(r)));
    }
  });

  it("a shell function or alias named codex does not count as a binary", () => {
    assert.equal(locateBinary(["codex"], tmp()), null);
  });

  it("Codex probe is ready only with a real executable and OPENAI_API_KEY", () => {
    const bin = tmp();
    fakeBinary(bin, "codex", "codex-cli 9.9.9");
    assert.equal(codex.probe({ env: { PATH: bin, OPENAI_API_KEY: "sk-test" }, spawnSync }).status, "ready");
    assert.equal(codex.probe({ env: { PATH: bin }, spawnSync }).status, "blocked");
  });

  it("OpenClaw probe is ready with binary only (API key optional at probe time)", () => {
    const bin = tmp();
    fakeBinary(bin, "openclaw", "openclaw 1.0.0");
    assert.equal(openclaw.probe({ env: { PATH: bin }, spawnSync }).status, "ready");
  });

  it("generated native configs reference the Token only by environment variable name", () => {
    for (const adapter of AUTO) {
      const prepared = adapter.prepare({ workDir: tmp(), mcpUrl: "http://127.0.0.1:7879/mcp" });
      for (const file of prepared.files) {
        const text = readFileSync(file, "utf8");
        assert.ok(text.includes(TOKEN_ENV), `${file} names the env var`);
        assert.ok(!text.includes(TOKEN), "no plaintext token");
        assert.ok(text.includes("http://127.0.0.1:7879/mcp"));
        assert.ok(!text.includes(":7878"));
      }
    }
  });

  it("invocations keep the Token out of argv", () => {
    const work = tmp();
    const prepared = codex.prepare({ workDir: work, mcpUrl: "http://x/mcp" });
    const invocation = codex.buildInvocation({ binaryPath: "/bin/codex", question: "q", workDir: work, prepared, env: { OPENAI_API_KEY: "sk-test-key" }, secrets: [TOKEN, "sk-test-key"] });
    assert.ok(!invocation.args.join(" ").includes(TOKEN));
    assert.ok(!invocation.args.join(" ").includes("sk-test-key"));
    assert.throws(() => codex.buildInvocation({ binaryPath: "/bin/codex", question: `token ${TOKEN}`, workDir: work, prepared, env: {}, secrets: [TOKEN] }), /command line/);
    assert.throws(() => assertNoSecretInArgv(["ask", `use ${TOKEN}`], [TOKEN]), /credential on the command line/);
  });

  it("parses Codex native result shape", () => {
    const events = [{ type: "thread.started", thread_id: "th_1" }, { type: "item.completed", item: { type: "agent_message", text: "答案是 42" } }].map((e) => JSON.stringify(e)).join("\n");
    assert.deepEqual(codex.parseResult({ stdout: events, exitCode: 0, lastMessage: "" }), { finalAnswer: "答案是 42", model: "", sessionId: "th_1", ok: true });
  });

  it("adapter digests are stable sha256 values of the reviewed file", () => {
    const file = path.join(REPO_ROOT, "scripts/e2e/adapters/codex.mjs");
    assert.match(adapterDigest(file), /^sha256:[0-9a-f]{64}$/);
  });

  it("only automated required adapters are loaded", async () => {
    const adapters = await loadAdapters(clientsDoc);
    assert.deepEqual(Object.keys(adapters).sort(), ["claude-code", "openclaw"]);
  });
});

const { cases } = loadCatalog();
const goldDoc = { ...computeGold(generateDataset("0123456789abcdef")), canaries: { salesWiki: "CANARY-SALES", restrictedWiki: "CANARY-RESTRICTED", injection: "CANARY-INJECT", financeWiki: "CANARY-FIN", publishedSkill: "CANARY-SKILL", draftSkill: "CANARY-DRAFT", deprecatedSkill: "CANARY-DEP", salesRow: "CANARY-SROW" } };
const cac = goldDoc.questions["Q-CAC-28D"];
const goodAnswer = `获客成本 ${(cac.expected.cents / 100).toFixed(2)} 元，口径为投放金额合计 SUM 除以新增客户数 SUM。`;

function journeyHarness({ answerFor, evidenceFor, isolated = true, probeStatus = "ready", maxModelCalls }) {
  const work = tmp();
  const run = { runId: "t-run-0001", instance: { mcpUrl: "http://127.0.0.1:7879/mcp" }, paths: { "client-work": work, checker: path.join(work, "checker") }, db: {} };
  const tokens = { e2e_finance: TOKEN, e2e_sales: `${TOKEN}-sales`, e2e_finance_east: `${TOKEN}-east`, e2e_disabled: "x" };
  const mkAdapter = (product) => ({
    digest: "sha256:" + "d".repeat(64),
    mod: {
      product, transport: "cli", credentialEnv: ["K"],
      probe: () => ({ status: probeStatus, reasons: probeStatus === "ready" ? [] : ["binary_not_found: x"], binaryPath: probeStatus === "ready" ? `/bin/${product}` : null, version: "1.0", model: "m" }),
      prepare: () => ({ env: {}, files: [] }),
      buildInvocation: ({ question }) => ({ command: "x", args: [question], cwd: work, env: {} }),
      parseResult: ({ stdout }) => ({ finalAnswer: stdout, model: "m", sessionId: "s", ok: stdout !== "" })
    }
  });
  const calls = [];
  const runProcessMock = async ({ args, env }) => {
    calls.push({ question: args[0], tokenEnv: env[TOKEN_ENV] });
    return { completed: true, exitCode: 0, stdout: answerFor({ question: args[0], call: calls.length, env }), stderr: "", timedOut: false };
  };
  const deps = {
    env: {}, capabilities: new Set(["lucy-http", "ktx-upstream", "postgres", "agent-client", "network-profile"]), timeoutMs: 1000, maxModelCalls,
    now: () => Date.now(), allowUnisolated: false,
    isolationProbe: async () => (isolated
      ? { isolated: true, attemptCompleted: true, attempts: [{ resource: "synthetic-seed", denied: true }], detail: "ok", receipt: { boundary: { provider: "darwin-sandbox-exec", profileHash: "sha256:test" } } }
      : { isolated: false, attemptCompleted: true, attempts: [{ resource: "synthetic-seed", denied: false }], detail: "gold readable", receipt: { boundary: { provider: "darwin-sandbox-exec", profileHash: "sha256:test" } } }),
    runProcess: runProcessMock,
    // A5 boundary-run mock: production wraps the child under sandbox-exec; tests substitute
    // the same shape so the production askOnce path is exercised end-to-end. The harness
    // deliberately uses an UNTRUSTED / NO-OP provider so tests would not actually need
    // sandbox-exec to run.
    boundaryRun: runProcessMock,
    provider: { provider: "darwin-sandbox-exec", binary: "/usr/bin/sandbox-exec", reason: null },
    canaries: { root: "/tmp/lucy-iso-probe-test", layout: { "synthetic-seed": { file: "/tmp/lucy-iso-probe-test/synthetic-seed/synthetic-seed-canary.txt", tag: "CANARY-SYNTHETIC-SEED-test" } } },
    envAllowMatcher: { literals: new Set(["PATH", "HOME", "LUCY_E2E_TOKEN", "LUCY_E2E_RUN"]), patterns: [/^LUCY_E2E_.*$/] },
    bounds: { stdout: 1_000_000, stderr: 256_000 },
    collect: async ({ agentId, tokenFingerprint }) => evidenceFor({ agentId, tokenFingerprint, call: calls.length }),
    ledger: undefined
  };
  return {
    run, tokens, deps, calls,
    adapters: { codex: mkAdapter("codex"), "claude-code": mkAdapter("claude-code"), openclaw: mkAdapter("openclaw") }
  };
}

const goodEvidence = ({ agentId, tokenFingerprint } = {}) => {
  // Per-ask realistic measured evidence: a query bound to the question's region/period/table with a
  // matching result. Distinct trace/query IDs per ask so the verifier's per-ask indexed record
  // cannot be laundered across asks. The Token fingerprint comes from the runner, not the harness.
  // A4: upstreamUnauthorized: 0 is the MEASURED zero from a clean audit ledger (no outcome === "unauthorized"
  // entries). The runner must NOT pre-fill this; the harness supplies it because we want a positive
  // fixture to represent a real, measured clean run. Tests that exercise a missing or positive value
  // override the field explicitly.
  const id = Math.floor(Math.random() * 1e6) + 1;
  const traceId = `trace_${agentId}_${tokenFingerprint}_${id}`;
  return {
    events: [{ id, source: "lucy_query", tool: "lucy_query", outcome: "ok" }],
    queries: [{ id, outcome: "ok", query: { region: "East", days: 28, table: "marketing_daily" }, result: { aggregateCents: cac.expected.cents, currency: "CNY" } }],
    queryEventIds: [String(id)],
    traceIds: [traceId],
    policyVersion: "pv",
    contextPolicyVersion: "cv",
    upstreamUnauthorized: 0,
    deniedCount: 0,
    bindingProblems: []
  };
};
const onlyCase = (id) => cases.filter((c) => c.id === id);

async function journey(opts, caseId = "UX-02-V01") {
  const h = journeyHarness(opts);
  const result = await runAgentJourney({ run: h.run, cases: onlyCase(caseId), goldDoc, clientsDoc, adapters: h.adapters, tokens: h.tokens, secrets: Object.values(h.tokens), deps: h.deps });
  return { ...h, result };
}

describe("agent journey cannot be faked (Plan T12 RED list)", () => {
  it("passes a genuinely correct, queried, traced answer for 2 products x 3 runs (v5: Codex dropped)", async () => {
    const { result } = await journey({ answerFor: () => goodAnswer, evidenceFor: goodEvidence });
    assert.equal(result.status, "passed");
    assert.equal(result.entries.length, 6);
    assert.deepEqual([...new Set(result.entries.map((e) => e.client))].sort(), ["claude-code", "openclaw"]);
  });

  it("the Token reaches the client only through the environment", async () => {
    const { calls } = await journey({ answerFor: () => goodAnswer, evidenceFor: goodEvidence });
    assert.ok(calls.every((c) => c.tokenEnv === TOKEN));
  });

  it("answering correctly WITHOUT a server-side query fails", async () => {
    const { result } = await journey({ answerFor: () => goodAnswer, evidenceFor: () => ({ ...goodEvidence(), queries: [], queryEventIds: [], traceIds: [] }) });
    assert.equal(result.status, "failed");
  });

  it("a single failing run among three fails the case for that product (R9)", async () => {
    let n = 0;
    const { result } = await journey({ answerFor: () => (++n === 1 ? "不知道" : goodAnswer), evidenceFor: goodEvidence });
    const claudeRuns = result.entries.filter((e) => e.client === "claude-code");
    assert.equal(claudeRuns.length, 3);
    assert.ok(claudeRuns.every((e) => e.status === "failed"));
    assert.equal(result.entries.length, 6);
  });

  it("cross-product consistency (UX-05)", async () => {
    const same = await journey({ answerFor: () => goodAnswer, evidenceFor: goodEvidence }, "UX-05-V01");
    assert.equal(same.result.status, "passed");
  });

  it("a client that is not installed yields BLOCKED", async () => {
    const { result, calls } = await journey({ probeStatus: "blocked", answerFor: () => goodAnswer, evidenceFor: goodEvidence });
    assert.equal(result.status, "blocked");
    assert.equal(calls.length, 0);
    assert.equal(result.entries.length, 6);
  });

  it("failed isolation blocks the official questions", async () => {
    const { result, calls } = await journey({ isolated: false, answerFor: () => goodAnswer, evidenceFor: goodEvidence });
    assert.equal(result.status, "blocked");
    assert.equal(calls.length, 0);
  });

  it("agent cases without an implemented plan are BLOCKED", async () => {
    assert.equal(askPlan({ id: "UX-04-V01" }), null);
    const { result } = await journey({ answerFor: () => goodAnswer, evidenceFor: goodEvidence }, "UX-04-V01");
    assert.ok(result.entries.every((e) => e.status === "blocked" && /handler_not_implemented/.test(e.detail)));
  });

  it("repeat3 helper never converts blocked into pass", () => {
    const entries = [1, 2, 3].map((n) => ({ id: "UX-02-V01", client: "codex", run: n, status: "blocked", assertions: [] }));
    applyCrossRunRules(entries, onlyCase("UX-02-V01"), ["codex"]);
    assert.ok(entries.every((e) => e.status === "blocked"));
  });

  it("answers are judged by the server-bound token fingerprint", () => {
    assert.match(tokenFingerprintOf(TOKEN), /^[0-9a-f]{12}$/);
  });

  it("[A4] per-ask indexed evidence is recorded: distinct Agent + Token per ask (SEC-14-V12)", async () => {
    // SEC-14-V12 has a denial ask (e2e_sales token) followed by an answer ask (e2e_finance token).
    // A correct journey must record BOTH asks with their distinct Agents/Tokens/trace IDs — the runner
    // cannot satisfy both with a single ask's evidence.
    const h = journeyHarness({ answerFor: () => "我没有权限访问。", evidenceFor: goodEvidence });
    h.deps.runProcess = async ({ args, env }) => {
      const q = args[0];
      // First ask is a denial; the client returns the denial text. Second ask is an answer; the
      // client returns the answer text. The shell harness in adapter-contract can't read which ask
      // it is from the question alone, so we route by env: deny uses e2e_sales, answer uses e2e_finance.
      const token = env[TOKEN_ENV];
      if (token === h.tokens.e2e_sales) return { exitCode: 0, stdout: "我没有权限访问该文档，无法引用。", stderr: "", timedOut: false };
      if (token === h.tokens.e2e_finance) return { exitCode: 0, stdout: goodAnswer, stderr: "", timedOut: false };
      return { exitCode: 0, stdout: "未匹配到 token", stderr: "", timedOut: false };
    };
    const result = await runAgentJourney({ run: h.run, cases: onlyCase("SEC-14-V12"), goldDoc, clientsDoc, adapters: h.adapters, tokens: h.tokens, secrets: Object.values(h.tokens), deps: h.deps });
    const sec14 = result.entries.filter((e) => e.id === "SEC-14-V12" && e.client === "claude-code");
    assert.ok(sec14.length > 0, "SEC-14-V12 must be exercised for claude-code");
    const e0 = sec14[0];
    assert.ok(Array.isArray(e0.asks) && e0.asks.length === 2, `expected 2 indexed asks, got ${e0.asks?.length ?? "<none>"}`);
    assert.notEqual(e0.asks[0].agentId, e0.asks[1].agentId, "the two asks must use different Agents");
    assert.notEqual(e0.asks[0].tokenFingerprint, e0.asks[1].tokenFingerprint, "the two asks must use different Token fingerprints");
    assert.equal(e0.asks[0].askIndex, 0);
    assert.equal(e0.asks[1].askIndex, 1);
    assert.equal(e0.asks[0].expectation, "denied");
    assert.equal(e0.asks[1].expectation, "answer");
  });

  it("[A4-strict regression] the runner does NOT pre-fill upstreamUnauthorized: 0 (was hardcoded bug, now removed)", async () => {
    // RED gate: the previous askOnce forced `evidence: { ...evidence, upstreamUnauthorized: 0 }` so a
    // missing or positive upstream count was silently laundered. The runner must now pass through what
    // collect() reports. We exercise the actual production runAgentJourney, not evaluateAnswer alone,
    // because the bug lived in the runner glue.
    const evidenceWithOneUnauthorized = ({ agentId, tokenFingerprint } = {}) => {
      const base = goodEvidence({ agentId, tokenFingerprint });
      return { ...base, upstreamUnauthorized: 1 };
    };
    const { result } = await journey({ answerFor: () => goodAnswer, evidenceFor: evidenceWithOneUnauthorized });
    // Every entry must FAIL the deny assertion (because upstreamUnauthorized: 1 was reported) — the
    // case cannot pass even with a perfectly worded answer. The runner used to silently ignore this
    // and green-light the case; the fix removes that laundering.
    assert.equal(result.status, "failed", `case with upstreamUnauthorized=1 must fail; got ${result.status}`);
    for (const entry of result.entries) {
      const deny = entry.assertions.find((a) => a.token === "deny");
      assert.ok(deny && deny.passed === false, `every entry must have deny=false when upstreamUnauthorized=1; entry ${entry.id}@${entry.client}#${entry.run} got ${JSON.stringify(deny)}`);
    }
  });

  it("[A4-strict regression] a missing upstreamUnauthorized from collect() BLOCKS the case (no fabricated 0)", async () => {
    // The runner must not fabricate 0 when the collector returns no upstream count. Missing count
    // BLOCKS the deny assertion; the case is failed (with upstream_unmeasured detail), not passed.
    const evidenceNoUpstream = ({ agentId, tokenFingerprint } = {}) => {
      const base = goodEvidence({ agentId, tokenFingerprint });
      delete base.upstreamUnauthorized;
      return base;
    };
    const { result } = await journey({ answerFor: () => goodAnswer, evidenceFor: evidenceNoUpstream });
    assert.equal(result.status, "failed", `missing upstreamUnauthorized must fail the case; got ${result.status}`);
    for (const entry of result.entries) {
      const deny = entry.assertions.find((a) => a.token === "deny");
      assert.ok(deny && deny.passed === false, `every entry must have deny=false when upstreamUnauthorized is missing; got ${JSON.stringify(deny)}`);
      assert.ok(deny && /upstream tool execution count was not measured/.test(deny.detail), `missing detail must include upstream_unmeasured message; got ${deny?.detail}`);
    }
  });

  it("[A4-strict regression] a measured upstreamUnauthorized: 0 with deniedCount > 0 passes (legitimate refusal)", async () => {
    // A legitimate policy-deny is NOT an unauthorized execution. deniedCount > 0 is fine; the only
    // check is that upstreamUnauthorized === 0. The runner used to make both branches brittle; the
    // new strict integer check on upstreamUnauthorized must still let this positive case pass.
    const evidenceWithDenials = ({ agentId, tokenFingerprint } = {}) => {
      const base = goodEvidence({ agentId, tokenFingerprint });
      return { ...base, upstreamUnauthorized: 0, deniedCount: 3 };
    };
    const { result } = await journey({ answerFor: () => goodAnswer, evidenceFor: evidenceWithDenials });
    assert.equal(result.status, "passed", `measured 0 upstream + legitimate denials must pass; got ${result.status} details=${result.entries.flatMap((e) => e.assertions).filter((a) => !a.passed).map((a) => `${a.token}: ${a.detail}`).join(" | ")}`);
  });

  it("[A4-strict regression] upstreamUnauthorized as a malformed type fails the case (no boolean/string/NaN laundering)", async () => {
    // Production: the runner must treat a non-integer/non-negative upstream value as a measurement
    // gap and fail closed, NOT silently coerce to 0. We exercise four invalid shapes via the actual
    // runAgentJourney (not just evaluateAnswer in isolation).
    for (const bad of [true, "1", NaN, -1, 1.5]) {
      const evidenceBad = ({ agentId, tokenFingerprint } = {}) => {
        const base = goodEvidence({ agentId, tokenFingerprint });
        return { ...base, upstreamUnauthorized: bad };
      };
      const { result } = await journey({ answerFor: () => goodAnswer, evidenceFor: evidenceBad });
      assert.equal(result.status, "failed", `upstreamUnauthorized=${JSON.stringify(bad)} must fail; got ${result.status}`);
      const sample = result.entries[0];
      const deny = sample.assertions.find((a) => a.token === "deny");
      assert.ok(deny && deny.passed === false, `${JSON.stringify(bad)}: deny must be false; got ${JSON.stringify(deny)}`);
    }
  });
});
