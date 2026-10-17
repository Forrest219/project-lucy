import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { computeGold, generateDataset } from "../../../examples/security-e2e/gold/compute-gold.mjs";
import * as codex from "../adapters/codex.mjs";
import * as cursor from "../adapters/cursor.mjs";
import { TOKEN_ENV, adapterDigest, assertNoSecretInArgv, locateBinary, validateAdapter } from "../adapters/_contract.mjs";
import { loadCatalog } from "../lib/catalog.mjs";
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

describe("adapter contract (Spec §6.3: real clients, no scripts posing as clients)", () => {
  it("Codex and Cursor adapters satisfy the contract and declare transport cli", () => {
    for (const adapter of [codex, cursor]) {
      assert.deepEqual(validateAdapter(adapter), []);
      assert.equal(adapter.transport, "cli");
    }
  });

  it("a direct-HTTP script is not an acceptable adapter", () => {
    const curl = { product: "curl-as-agent", transport: "http", credentialEnv: [], probe() {}, prepare() {}, buildInvocation() {}, parseResult() {} };
    assert.ok(validateAdapter(curl).some((p) => /raw HTTP is not a real client/.test(p)));
    assert.ok(validateAdapter({ product: "x" }).length >= 5);
  });

  it("the registered clients are two different required products, and Hermes profiles count once", () => {
    assert.equal(countDistinctProducts(clientsDoc.clients), 2);
    assert.deepEqual(clientsDoc.clients.filter((c) => c.required).map((c) => c.product).sort(), ["codex", "cursor"]);
    assert.equal(countDistinctProducts([{ product: "hermes-a", required: true }, { product: "hermes-b", required: true }]), 1);
    assert.ok(clientsDoc.clients.find((c) => c.product === "cursor-ide").required === false, "Cursor IDE GUI stays optional (R7)");
  });

  it("probe reports BLOCKED, with reasons, when the binary and the model credential are missing", () => {
    const empty = tmp();
    for (const adapter of [codex, cursor]) {
      const result = adapter.probe({ env: { PATH: empty }, spawnSync });
      assert.equal(result.status, "blocked");
      assert.ok(result.reasons.some((r) => /binary_not_found/.test(r)));
      assert.ok(result.reasons.some((r) => /credential_missing/.test(r)));
      assert.equal(result.binaryPath, null);
    }
  });

  it("a shell function or alias named codex does not count as a binary", () => {
    assert.equal(locateBinary(["codex"], tmp()), null);
  });

  it("probe is ready only with a real executable that runs --version and a credential", () => {
    const bin = tmp();
    fakeBinary(bin, "codex", "codex-cli 9.9.9");
    const ready = codex.probe({ env: { PATH: bin, OPENAI_API_KEY: "sk-test" }, spawnSync });
    assert.equal(ready.status, "ready");
    assert.equal(ready.version, "codex-cli 9.9.9");
    assert.match(ready.binaryPath, /codex$/);
    fakeBinary(bin, "codex", "boom", 3);
    assert.equal(codex.probe({ env: { PATH: bin, OPENAI_API_KEY: "sk-test" }, spawnSync }).status, "blocked");
    const missingCred = codex.probe({ env: { PATH: bin }, spawnSync });
    assert.ok(missingCred.reasons.some((r) => /credential_missing/.test(r)));
  });

  it("an executable named `agent` that is not Cursor is rejected", () => {
    const bin = tmp();
    fakeBinary(bin, "agent", "some-other-agent 1.0");
    const result = cursor.probe({ env: { PATH: bin, CURSOR_API_KEY: "k" }, spawnSync });
    assert.equal(result.status, "blocked");
    assert.ok(result.reasons.some((r) => /not_the_expected_product/.test(r)));
    fakeBinary(bin, "cursor-agent", "cursor-agent 2026.10.01");
    assert.equal(cursor.probe({ env: { PATH: bin, CURSOR_API_KEY: "k" }, spawnSync }).status, "ready");
  });

  it("generated native configs reference the Token only by environment variable name", () => {
    const work = tmp();
    const codexPrepared = codex.prepare({ workDir: work, mcpUrl: "http://127.0.0.1:7879/mcp" });
    const cursorWork = tmp();
    const cursorPrepared = cursor.prepare({ workDir: cursorWork, mcpUrl: "http://127.0.0.1:7879/mcp" });
    for (const file of [...codexPrepared.files, ...cursorPrepared.files]) {
      const text = readFileSync(file, "utf8");
      assert.ok(text.includes(TOKEN_ENV), `${file} names the env var`);
      assert.ok(!text.includes(TOKEN), "no plaintext token");
      assert.ok(!/lucy_e2e_[a-f0-9]{16}/.test(text), "no token-shaped value");
      assert.ok(text.includes("http://127.0.0.1:7879/mcp"), "points at the Lucy MCP endpoint (never KTX stdio or :7878)");
      assert.ok(!text.includes(":7878"));
    }
  });

  it("invocations keep the Token and the gold out of argv", () => {
    const work = tmp();
    const prepared = codex.prepare({ workDir: work, mcpUrl: "http://x/mcp" });
    const invocation = codex.buildInvocation({ binaryPath: "/bin/codex", question: "最近获客成本？", workDir: work, prepared, env: { OPENAI_API_KEY: "sk-test" }, secrets: [TOKEN, "sk-test"] });
    assert.ok(!invocation.args.join(" ").includes(TOKEN));
    assert.ok(!invocation.args.join(" ").includes("sk-test"));
    assert.throws(() => assertNoSecretInArgv(["ask", `use ${TOKEN}`], [TOKEN]), /credential on the command line/);
    assert.throws(() => codex.buildInvocation({ binaryPath: "/bin/codex", question: `token ${TOKEN}`, workDir: work, prepared, env: {}, secrets: [TOKEN] }), /command line/);
    const cursorInvocation = cursor.buildInvocation({ binaryPath: "/bin/cursor-agent", question: "q", workDir: work, env: { CURSOR_API_KEY: "ck" }, secrets: [TOKEN] });
    assert.ok(!cursorInvocation.args.includes(TOKEN));
  });

  it("parses each client's native result shape", () => {
    const events = [{ type: "thread.started", thread_id: "th_1" }, { type: "item.completed", item: { type: "agent_message", text: "答案是 42" } }].map((e) => JSON.stringify(e)).join("\n");
    assert.deepEqual(codex.parseResult({ stdout: events, exitCode: 0, lastMessage: "" }), { finalAnswer: "答案是 42", model: "", sessionId: "th_1", ok: true });
    assert.equal(codex.parseResult({ stdout: "", exitCode: 1, lastMessage: "" }).ok, false);
    const cursorOut = JSON.stringify({ result: "OK 7", session_id: "s_9", model: "m" });
    assert.deepEqual(cursor.parseResult({ stdout: cursorOut, exitCode: 0 }), { finalAnswer: "OK 7", model: "m", sessionId: "s_9", ok: true });
    assert.equal(cursor.parseResult({ stdout: JSON.stringify({ result: "x", is_error: true }), exitCode: 0 }).ok, false);
  });

  it("adapter digests are stable sha256 values of the reviewed file", () => {
    const file = path.join(REPO_ROOT, "scripts/e2e/adapters/codex.mjs");
    assert.match(adapterDigest(file), /^sha256:[0-9a-f]{64}$/);
    assert.equal(adapterDigest(file), adapterDigest(file));
  });

  it("only reviewed adapters from scripts/e2e/adapters/ are loaded", async () => {
    const adapters = await loadAdapters(clientsDoc);
    assert.deepEqual(Object.keys(adapters).sort(), ["codex", "cursor"]);
    const rogue = { clients: [{ product: "rogue", required: true, adapter: "scripts/e2e/__tests__/adapter-contract.test.mjs" }] };
    await assert.rejects(loadAdapters(rogue), /must live in/);
  });
});

// ---- journey anti-cheating rules -------------------------------------------------------------------------------
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
  const deps = {
    env: {}, capabilities: new Set(["lucy-http", "ktx-upstream", "postgres", "agent-client", "network-profile"]), timeoutMs: 1000, maxModelCalls,
    now: () => Date.now(), allowUnisolated: false,
    isolationProbe: async () => (isolated ? { isolated: true, detail: "ok" } : { isolated: false, detail: "gold readable" }),
    runProcess: async ({ args, env }) => {
      const question = args[0];
      const product = calls.length % 2 === 0 ? "codex" : "cursor";
      calls.push({ question, tokenEnv: env[TOKEN_ENV] });
      return { exitCode: 0, stdout: answerFor({ question, call: calls.length, env }), stderr: "", timedOut: false };
    },
    collect: async ({ agentId, tokenFingerprint }) => evidenceFor({ agentId, tokenFingerprint, call: calls.length }),
    ledger: undefined
  };
  return { run, tokens, deps, adapters: { codex: mkAdapter("codex"), cursor: mkAdapter("cursor") }, calls };
}

const goodEvidence = () => ({ events: [{ id: 1 }], queries: [{ id: 1, outcome: "ok" }], queryEventIds: ["1"], traceIds: ["trace_1"], policyVersion: "pv", contextPolicyVersion: "cv", bindingProblems: [] });
const onlyCase = (id) => cases.filter((c) => c.id === id);

async function journey(opts, caseId = "UX-02-V01") {
  const h = journeyHarness(opts);
  const result = await runAgentJourney({ run: h.run, cases: onlyCase(caseId), goldDoc, clientsDoc, adapters: h.adapters, tokens: h.tokens, secrets: Object.values(h.tokens), deps: h.deps });
  return { ...h, result };
}

describe("agent journey cannot be faked (Plan T12 RED list)", () => {
  it("passes a genuinely correct, queried, traced answer for 2 products x 3 runs", async () => {
    const { result } = await journey({ answerFor: () => goodAnswer, evidenceFor: goodEvidence });
    assert.equal(result.status, "passed");
    assert.equal(result.entries.length, 6);
    assert.ok(result.entries.every((e) => e.status === "passed" && e.assertions.some((a) => a.token === "repeat3" && a.passed)));
    assert.deepEqual([...new Set(result.entries.map((e) => e.client))].sort(), ["codex", "cursor"]);
  });

  it("the Token reaches the client only through the environment, and the gold never reaches the prompt", async () => {
    const { calls } = await journey({ answerFor: () => goodAnswer, evidenceFor: goodEvidence });
    assert.ok(calls.every((c) => c.tokenEnv === TOKEN));
    for (const call of calls) {
      assert.ok(!call.question.includes(String(cac.expected.cents)));
      assert.ok(!call.question.includes((cac.expected.cents / 100).toFixed(2)));
      assert.ok(!call.question.includes(TOKEN));
    }
  });

  it("answering correctly WITHOUT a server-side query fails (the statically printed answer case)", async () => {
    const { result } = await journey({ answerFor: () => goodAnswer, evidenceFor: () => ({ ...goodEvidence(), queries: [], queryEventIds: [] }) });
    assert.equal(result.status, "failed");
    assert.ok(result.entries.every((e) => e.status === "failed" && e.assertions.find((a) => a.token === "real_query").passed === false));
  });

  it("a runner-fabricated trace is useless: no ledger trace id, no server_trace", async () => {
    const { result } = await journey({ answerFor: () => goodAnswer, evidenceFor: () => ({ ...goodEvidence(), traceIds: [], bindingProblems: ["bound entries carry no server trace id"] }) });
    assert.equal(result.status, "failed");
    assert.ok(result.entries.every((e) => e.assertions.find((a) => a.token === "server_trace").passed === false));
  });

  it("another Token's or an old window's events fail the binding", async () => {
    const { result } = await journey({ answerFor: () => goodAnswer, evidenceFor: () => ({ ...goodEvidence(), traceIds: [], queries: [], queryEventIds: [], bindingProblems: ["entry 7 was made with Token ffffffffffff, not abc"] }) });
    assert.equal(result.status, "failed");
  });

  it("a single failing run among three fails the case for that product and the failure is kept (R9)", async () => {
    let n = 0;
    const { result } = await journey({ answerFor: () => (++n === 1 ? "不知道" : goodAnswer), evidenceFor: goodEvidence });
    const codexRuns = result.entries.filter((e) => e.client === "codex");
    assert.equal(codexRuns.length, 3);
    assert.ok(codexRuns.every((e) => e.status === "failed"), "all three runs of that product are failed once one run failed");
    assert.ok(codexRuns.some((e) => /repeat3/.test(e.detail)));
    assert.equal(result.entries.length, 6, "nothing was dropped");
  });

  it("the same answer from both products is consistent; different verdicts across products fail UX-05", async () => {
    const same = await journey({ answerFor: () => goodAnswer, evidenceFor: goodEvidence }, "UX-05-V01");
    assert.equal(same.result.status, "passed");
    let n = 0;
    const differing = await journey({ answerFor: () => (++n % 2 === 0 ? "不知道" : goodAnswer), evidenceFor: goodEvidence }, "UX-05-V01");
    assert.equal(differing.result.status, "failed");
  });

  it("a client that is not installed or lacks credentials yields BLOCKED, never passed", async () => {
    const { result, calls } = await journey({ probeStatus: "blocked", answerFor: () => goodAnswer, evidenceFor: goodEvidence });
    assert.equal(result.status, "blocked");
    assert.equal(calls.length, 0, "no process was started");
    assert.ok(result.entries.every((e) => e.status === "blocked" && /binary_not_found/.test(e.detail)));
    assert.equal(result.entries.length, 6);
  });

  it("failed isolation (the client can read gold) blocks the official questions", async () => {
    const { result, calls } = await journey({ isolated: false, answerFor: () => goodAnswer, evidenceFor: goodEvidence });
    assert.equal(result.status, "blocked");
    assert.equal(calls.length, 0);
    assert.ok(result.entries.every((e) => /isolation_not_established/.test(e.detail)));
  });

  it("a model-call budget caps spending and the rest is blocked, not silently dropped", async () => {
    const { result } = await journey({ answerFor: () => goodAnswer, evidenceFor: goodEvidence, maxModelCalls: 2 });
    assert.equal(result.entries.length, 6);
    assert.equal(result.entries.filter((e) => e.status === "passed").length, 2);
    assert.ok(result.entries.filter((e) => e.status === "blocked").every((e) => /budget_exhausted/.test(e.detail)));
  });

  it("injected instructions: leaking a forbidden canary into the answer fails the security case", async () => {
    const leak = `${goodAnswer} CANARY-INJECT`;
    const { result } = await journey({ answerFor: () => leak, evidenceFor: goodEvidence }, "SEC-16-V01");
    assert.equal(result.status, "failed");
    assert.ok(result.entries.every((e) => e.assertions.find((a) => a.token === "no_leak").passed === false));
  });

  it("an entitled/denied pair: the unentitled identity must be refused and the entitled one correct", async () => {
    let n = 0;
    const answerFor = () => (++n % 2 === 1 ? "我没有权限访问该文档。" : goodAnswer);
    const { result } = await journey({ answerFor, evidenceFor: goodEvidence }, "SEC-14-V12");
    assert.equal(result.status, "passed");
    const bad = await journey({ answerFor: () => goodAnswer, evidenceFor: goodEvidence }, "SEC-14-V12");
    assert.equal(bad.result.status, "failed", "an identity that answers instead of being refused fails");
  });

  it("agent cases without an implemented plan are BLOCKED rather than guessed", async () => {
    assert.equal(askPlan({ id: "UX-04-V01" }), null);
    const { result } = await journey({ answerFor: () => goodAnswer, evidenceFor: goodEvidence }, "UX-04-V01");
    assert.ok(result.entries.every((e) => e.status === "blocked" && /handler_not_implemented/.test(e.detail)));
  });

  it("missing capabilities (database, KTX upstream, client) block the case", async () => {
    const h = journeyHarness({ answerFor: () => goodAnswer, evidenceFor: goodEvidence });
    h.deps.capabilities = new Set(["lucy-http"]);
    const result = await runAgentJourney({ run: h.run, cases: onlyCase("UX-02-V01"), goldDoc, clientsDoc, adapters: h.adapters, tokens: h.tokens, secrets: [], deps: h.deps });
    assert.ok(result.entries.every((e) => e.status === "blocked" && /missing capability/.test(e.detail)));
  });

  it("repeat3 helper never converts blocked into pass", () => {
    const entries = [1, 2, 3].map((n) => ({ id: "UX-02-V01", client: "codex", run: n, status: "blocked", assertions: [] }));
    applyCrossRunRules(entries, onlyCase("UX-02-V01"), ["codex"]);
    assert.ok(entries.every((e) => e.status === "blocked" && e.assertions.length === 0));
  });

  it("answers are judged by the server-bound token fingerprint, which is what the ledger stores", () => {
    assert.match(tokenFingerprintOf(TOKEN), /^[0-9a-f]{12}$/);
  });
});
