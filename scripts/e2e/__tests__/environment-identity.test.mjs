import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { parse } from "yaml";
import { computeGold, generateDataset, makeCanaries } from "../../../examples/security-e2e/gold/compute-gold.mjs";
import { REPO_ROOT, fileDigest } from "../lib/common.mjs";
import { applyDbToRun } from "../apply-db.mjs";
import { appliedDatabaseCapability } from "../lib/db-capability.mjs";
import { AGENT_TOKENS, PrepareError, prepareEnvironment } from "../prepare-environment.mjs";
import { ExternalInstance, LucyHttp } from "../lib/instance.mjs";
import { reconcileExternalFlag } from "../lib/target-identity.mjs";

const PROFILE = path.join(REPO_ROOT, "scripts/e2e/profiles/customer-release.yaml");
const roots = [];
const tmp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-e2e-env-"));
  roots.push(dir);
  return dir;
};
after(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const candidate = {
  gitSha: "a".repeat(40),
  treeDigest: `sha256:${"b".repeat(64)}`,
  imageDigest: `sha256:${"c".repeat(64)}`,
  platform: "linux/amd64",
  ktxVersion: "0.16.0",
  chartVersion: "0.17.0"
};

function writeCandidate(dir, overrides = {}) {
  const file = path.join(dir, "identity.json");
  writeFileSync(file, JSON.stringify({ ...candidate, ...overrides }));
  return file;
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

describe("prepare-environment: isolated synthetic run (Spec §6.2)", () => {
  it("renders a complete local run with secrets confined to checker/ and no placeholders left", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({ runId: "local-test-0001", mode: "local", runRoot: root, seed: "00112233445566778899aabbccddeeff" });
    assert.equal(run.executionMode, "local");
    assert.equal(run.releaseEligible, false);
    assert.equal(run.candidate, null);
    assert.match(run.fixtureDigest, /^sha256:[0-9a-f]{64}$/);
    for (const key of ["project", "checker", "probe", "outside", "client-work", "logs"]) assert.ok(statSync(run.paths[key]).isDirectory(), key);
    assert.equal(statSync(run.paths.checker).mode & 0o777, 0o700);
    for (const name of ["tokens.json", "admins.json", "bootstrap-token", "db-password"]) {
      assert.equal(statSync(path.join(run.secretsDir, name)).mode & 0o777, 0o600, name);
    }
    for (const file of walk(run.paths.project)) assert.ok(!/\{\{\w+\}\}/.test(readFileSync(file, "utf8")), `placeholder left in ${file}`);
    assert.ok(existsSync(path.join(run.paths.project, "ktx.yaml")) && !existsSync(path.join(run.paths.project, "ktx.yaml.template")));
    assert.ok(readFileSync(path.join(run.paths.project, "wiki/shared/e2e-instance-marker.md"), "utf8").includes(`run=local-test-0001`));
  });

  it("keeps credentials, gold and seed data out of run.json, the project and the client work dir", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({ runId: "local-test-0002", mode: "local", runRoot: root });
    const tokens = JSON.parse(readFileSync(path.join(run.secretsDir, "tokens.json"), "utf8"));
    const admins = JSON.parse(readFileSync(path.join(run.secretsDir, "admins.json"), "utf8"));
    const secrets = [...Object.values(tokens), admins.owner.password, admins.operator.password, readFileSync(path.join(run.secretsDir, "bootstrap-token"), "utf8").trim(), readFileSync(path.join(run.secretsDir, "db-password"), "utf8").trim()];
    const runJson = readFileSync(path.join(run.paths.runDir, "run.json"), "utf8");
    for (const secret of secrets) {
      assert.ok(!runJson.includes(secret), "secret leaked into run.json");
      for (const file of walk(run.paths.project)) assert.ok(!readFileSync(file, "utf8").includes(secret), `secret in ${file}`);
    }
    assert.equal(readdirSync(run.paths["client-work"]).length, 0, "client work dir starts empty");
    const gold = JSON.parse(readFileSync(path.join(run.paths.checker, "gold.json"), "utf8"));
    assert.ok(gold.questions["Q-CAC-28D"]);
    for (const file of walk(run.paths.project)) assert.ok(!readFileSync(file, "utf8").includes("seed-data"), file);
    assert.ok(!existsSync(path.join(run.paths.project, "gold.json")));
  });

  it("writes token hashes that are the sha256 of the per-run plaintext tokens", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({ runId: "local-test-0003", mode: "local", runRoot: root });
    const tokens = JSON.parse(readFileSync(path.join(run.secretsDir, "tokens.json"), "utf8"));
    const access = parse(readFileSync(path.join(run.paths.project, "webui/config/access.yaml"), "utf8"));
    for (const [agentId] of AGENT_TOKENS) {
      const user = access.users.find((u) => u.id === agentId);
      assert.ok(user, agentId);
      assert.equal(user.tokens[0].hash, `sha256:${createHash("sha256").update(tokens[agentId]).digest("hex")}`);
    }
    assert.equal(access.users.find((u) => u.id === "e2e_disabled").enabled, false);
    assert.equal(run.agents.length, AGENT_TOKENS.length);
  });

  it("is seeded: same seed gives the same gold; different seeds give different canaries", async () => {
    assert.deepEqual(computeGold(generateDataset("aaaaaaaaaaaaaaaa")), computeGold(generateDataset("aaaaaaaaaaaaaaaa")));
    assert.notDeepEqual(makeCanaries("aaaaaaaaaaaaaaaa"), makeCanaries("bbbbbbbbbbbbbbbb"));
    const gold = computeGold(generateDataset("aaaaaaaaaaaaaaaa"));
    const wrong = gold.questions["Q-CAC-28D"].wrongAnswers.avgOfDailyRatiosCents;
    assert.notEqual(wrong, gold.questions["Q-CAC-28D"].expected.cents, "the averaged-ratio shortcut must differ from the governed SUM/SUM");
  });

  it("refuses real project directories, bad run ids and an existing run directory", async () => {
    const root = tmp();
    await assert.rejects(prepareEnvironment({ runId: "local-test-0004", runRoot: root, projectDir: "/Users/someone/real-project" }), /私有项目目录/);
    await assert.rejects(prepareEnvironment({ runId: "Bad Id", runRoot: root }), /run id must match/);
    await prepareEnvironment({ runId: "local-test-0005", runRoot: root });
    await assert.rejects(prepareEnvironment({ runId: "local-test-0005", runRoot: root }), /already exists/);
    await prepareEnvironment({ runId: "local-test-0005", runRoot: root, reset: true });
  });

  it("refuses to run when the environment points at a project holding .ktx/secrets", async () => {
    const root = tmp();
    const realish = tmp();
    mkdirSync(path.join(realish, ".ktx", "secrets"), { recursive: true });
    const previous = process.env.KTX_PROJECT_ROOT;
    process.env.KTX_PROJECT_ROOT = realish;
    try {
      await assert.rejects(prepareEnvironment({ runId: "local-test-0006", runRoot: root }), /\.ktx\/secrets/);
    } finally {
      if (previous === undefined) delete process.env.KTX_PROJECT_ROOT;
      else process.env.KTX_PROJECT_ROOT = previous;
    }
  });

  it("--reset only removes a plain child of the run root (never a symlink to elsewhere)", async () => {
    const root = tmp();
    const victim = tmp();
    writeFileSync(path.join(victim, "keep.txt"), "keep");
    symlinkSync(victim, path.join(root, "local-test-0007"));
    await assert.rejects(prepareEnvironment({ runId: "local-test-0007", runRoot: root, reset: true }), PrepareError);
    assert.equal(readFileSync(path.join(victim, "keep.txt"), "utf8"), "keep");
  });

  it("release mode demands a valid candidate identity and a frozen profile bound by digest", async () => {
    const root = tmp();
    await assert.rejects(prepareEnvironment({ runId: "rel-test-0001", mode: "release", runRoot: root }), /requires --candidate/);
    const dir = tmp();
    await assert.rejects(
      prepareEnvironment({ runId: "rel-test-0002", mode: "release", runRoot: root, candidatePath: writeCandidate(dir, { platform: "linux/arm64" }), profilePath: PROFILE }),
      /linux\/amd64/
    );
    await assert.rejects(
      prepareEnvironment({ runId: "rel-test-0003", mode: "release", runRoot: root, candidatePath: writeCandidate(dir, { gitSha: "abc" }), profilePath: PROFILE }),
      /40-hex/
    );
    const foreignProfile = path.join(dir, "profile.yaml");
    writeFileSync(foreignProfile, readFileSync(PROFILE, "utf8"));
    await assert.rejects(
      prepareEnvironment({ runId: "rel-test-0004", mode: "release", runRoot: root, candidatePath: writeCandidate(dir), profilePath: foreignProfile }),
      /frozen inputs/
    );
    const { run } = await prepareEnvironment({ runId: "rel-test-0005", mode: "release", runRoot: root, candidatePath: writeCandidate(dir), profilePath: PROFILE });
    assert.equal(run.executionMode, "release");
    assert.equal(run.releaseEligible, true);
    assert.equal(run.profileDigest, fileDigest(PROFILE));
    assert.equal(run.candidate.imageDigest, candidate.imageDigest);
    assert.equal(run.instance.env.LUCY_WEBUI_COOKIE_SECURE, "1", "release runs use Secure cookies");
  });

  it("CLI exits 1 for refusals and prints only public identity on success", () => {
    const script = path.join(REPO_ROOT, "scripts/e2e/prepare-environment.mjs");
    const refused = spawnSync("node", [script, "--run-id", "local-test-0009", "--project-dir", "/tmp/x"], { encoding: "utf8" });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /私有项目目录/);
    const unknown = spawnSync("node", [script, "--run-id", "local-test-0010", "--nonsense"], { encoding: "utf8" });
    assert.equal(unknown.status, 1);
  });
});

// B1 wiring (Spec §6.2 / §6.5 / §8.3): a real external run must use the registered MCP URL including
// its non-default pathname/query prefix; the agent journey must not silently start a local source when
// the run is registered external; and LucyHttp must refuse absolute pathnames that would override its
// registered base. These are pure/HTTP contract regressions — the harness proof, not live release proof.
describe("B1 target identity and external flag wiring", () => {
  it("SecurityContext mcpHttp uses the registered mcpUrl verbatim (host+port+path+query, not localhost-only)", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({ runId: "b1-cs-0001", mode: "local", runRoot: root });
    // Resolve the mcpHttp base by importing the module under test the way real callers do.
    const ctxMod = await import("../security/context.mjs");
    const ctx = new ctxMod.SecurityContext({ run, lucy: { dummy: true }, capabilities: new Set(["lucy-http"]) });
    assert.equal(ctx.mcpHttp.baseUrl.toString(), run.instance.mcpUrl);
    assert.equal(ctx.mcpHttp.baseUrl.protocol, "http:");
    assert.equal(ctx.mcpHttp.baseUrl.host, "127.0.0.1:17879");
    assert.equal(ctx.mcpHttp.baseUrl.pathname, "/mcp");
  });

  it("LucyHttp refuses absolute URL pathnames that would override the registered origin", async () => {
    const http = new LucyHttp("http://example.test:7879/mcp");
    await assert.rejects(
      () => http.request("GET", "http://attacker.test/steal"),
      /refuses pathname with scheme/
    );
    await assert.rejects(
      () => http.request("GET", "https://other.test/mcp"),
      /refuses pathname with scheme/
    );
    // Plain protocol-prefixed non-URL strings still fail the absolute-URL guard so they cannot be
    // smuggled into the resolver either.
    await assert.rejects(() => http.request("GET", "javascript:alert(1)"), /refuses pathname with scheme/);
  });

  it("LucyHttp preserves the registered base URL when pathname is empty (default mcp() call)", async () => {
    const http = new LucyHttp("https://lucy.example.com/lucy-v2/mcp");
    // We can't actually hit the example host; we only assert the URL that would be requested.
    // Override global fetch to capture the call.
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = (url) => {
      calls.push(new URL(String(url)));
      return Promise.resolve(new Response('{"data":{"ok":true}}', { status: 200, headers: { "content-type": "application/json" } }));
    };
    try {
      const res = await http.request("POST", "");
      assert.equal(res.status, 200);
      assert.equal(calls.length, 1);
      // The non-default pathname prefix MUST survive.
      assert.equal(calls[0].host, "lucy.example.com");
      assert.equal(calls[0].pathname, "/lucy-v2/mcp");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("LucyHttp enforces http(s) scheme on the constructor", () => {
    assert.throws(() => new LucyHttp("file:///etc/passwd"), /protocol must be http\(s\)/);
    assert.throws(() => new LucyHttp("ftp://example.com/x"), /protocol must be http\(s\)/);
    assert.throws(() => new LucyHttp("not a url"), /not a valid URL/);
  });

  it("reconcileExternalFlag refuses --external against a local run (startedBy=runner)", () => {
    const result = reconcileExternalFlag({ run: { instance: { startedBy: "runner" } }, flagValue: true });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /--external was given/);
  });

  it("reconcileExternalFlag refuses to omit --external when startedBy=external (no accidental local start)", () => {
    const result = reconcileExternalFlag({ run: { instance: { startedBy: "external" } }, flagValue: false });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /refusing to start a local source/);
  });

  it("reconcileExternalFlag accepts a consistent external flag pair", () => {
    const external = reconcileExternalFlag({ run: { instance: { startedBy: "external" } }, flagValue: true });
    assert.equal(external.ok, true);
    const local = reconcileExternalFlag({ run: { instance: { startedBy: "runner" } }, flagValue: false });
    assert.equal(local.ok, true);
  });

  it("ExternalInstance.start refuses to run when the run is not registered external", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({ runId: "b1-ext-0001", mode: "local", runRoot: root });
    // Local runs have startedBy="runner"; ExternalInstance must refuse rather than start a phantom.
    const inst = new ExternalInstance(run);
    await assert.rejects(inst.start(), /startedBy is "runner", expected "external"/);
    assert.equal(inst.preflight, null);
    assert.equal(inst.postflight, null);
  });

  it("ExternalInstance.start fails closed when preflight reports problems (TargetIdentityError stage=preflight)", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "b1-ext-0002",
      mode: "release",
      runRoot: root,
      baseUrl: "https://lucy.example.com/mcp",
      mcpUrl: "https://lucy.example.com/mcp",
      candidatePath: writeCandidate(root),
      profilePath: PROFILE
    });
    const preflight = async () => ({
      ok: false,
      problems: ["KTX runtime is not ready", "deployment evidence not found"],
      aspects: { health: { ok: false, problems: ["KTX runtime is not ready"] } }
    });
    const postflight = async () => {
      throw new Error("postflight must not be reached when preflight fails");
    };
    const inst = new ExternalInstance(run, { preflight, postflight });
    await assert.rejects(inst.start(), { message: /preflight: KTX runtime is not ready/ });
    assert.equal(inst.preflight.ok, false);
    assert.equal(inst.postflight, null, "postflight must not run when preflight fails closed");
  });

  it("ExternalInstance.start fails closed when postflight reports problems (TargetIdentityError stage=postflight)", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "b1-ext-0003",
      mode: "release",
      runRoot: root,
      baseUrl: "https://lucy.example.com/mcp",
      mcpUrl: "https://lucy.example.com/mcp",
      candidatePath: writeCandidate(root),
      profilePath: PROFILE
    });
    const preflight = async () => ({ ok: true, problems: [], aspects: {}, registered: { webHost: "lucy.example.com" } });
    const postflight = async () => ({
      ok: false,
      problems: ["marker does not contain this run's id"],
      aspects: { markerRead: { ok: false, problems: ["marker does not contain this run's id"] } }
    });
    const inst = new ExternalInstance(run, { preflight, postflight });
    await assert.rejects(inst.start(), { message: /postflight: marker does not contain this run's id/ });
    assert.equal(inst.preflight.ok, true);
    assert.equal(inst.postflight.ok, false);
  });

  it("ExternalInstance.start records both phases when every aspect passes", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "b1-ext-0004",
      mode: "release",
      runRoot: root,
      baseUrl: "https://lucy.example.com/mcp",
      mcpUrl: "https://lucy.example.com/mcp",
      candidatePath: writeCandidate(root),
      profilePath: PROFILE
    });
    const preflight = async () => ({ ok: true, problems: [], aspects: {}, registered: { webProtocol: "https:", webHost: "lucy.example.com", webPathname: "/mcp", mcpProtocol: "https:", mcpHost: "lucy.example.com", mcpPathname: "/mcp" } });
    const postflight = async () => ({ ok: true, problems: [], aspects: { ownerLogin: { ok: true }, markerRead: { ok: true } } });
    const inst = new ExternalInstance(run, { preflight, postflight });
    await inst.start();
    assert.equal(inst.preflight.ok, true);
    assert.deepEqual(inst.preflight.problems, []);
    assert.equal(inst.postflight.ok, true);
    assert.deepEqual(inst.postflight.problems, []);
  });

  it("ExternalInstance has no child handle, no log path, and stop is a no-op (proves it is independent of LucyProcess)", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "b1-ext-0005",
      mode: "release",
      runRoot: root,
      baseUrl: "https://lucy.example.com/mcp",
      mcpUrl: "https://lucy.example.com/mcp",
      candidatePath: writeCandidate(root),
      profilePath: PROFILE
    });
    const preflight = async () => ({ ok: true, problems: [], aspects: {}, registered: { webHost: "lucy.example.com" } });
    const postflight = async () => ({ ok: true, problems: [], aspects: { ownerLogin: { ok: true }, markerRead: { ok: true } } });
    const inst = new ExternalInstance(run, { preflight, postflight });
    await inst.start();
    // ExternalInstance exposes no child handle and no local log path; the runner does not own
    // a process. Stop is a no-op (it must not try to kill anything).
    assert.equal(inst.logPath, null, "no local log file path");
    const result = await inst.stop();
    assert.deepEqual(result, { code: null, signal: null });
    await assert.rejects(inst.restart(), /external instance has no restart control plane/);
  });

  it("runSecurity with external=true constructs ExternalInstance (NOT LucyProcess) and runs preflight+postflight before any handler", async () => {
    // Wire runSecurity through its real entry point. The two phases use the registered target;
    // no local child is spawned, no handler is invoked when verification refuses. We pass a
    // non-terminating onTargetRefused so the test can assert the refusal without process.exit
    // killing the test runner.
    const { runSecurity } = await import("../run-security.mjs");
    const { loadCatalog } = await import("../lib/catalog.mjs");
    const { cases } = loadCatalog();
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "b1-sec-ext-0001",
      mode: "release",
      runRoot: root,
      // Use an unresolvable hostname so the real ExternalInstance.preflight fails closed
      // (DNS lookup returns an error). No HTTP call ever reaches a wrong deployment.
      baseUrl: "https://no-such-host-b1-test.invalid",
      mcpUrl: "https://no-such-host-b1-test.invalid/mcp",
      candidatePath: writeCandidate(root),
      profilePath: PROFILE
    });
    let handlerRan = false;
    const handler = async () => { handlerRan = true; return { assertions: [{ token: "deny", passed: true }] }; };
    const handlers = Object.fromEntries(cases.filter((c) => c.runner === "security").map((c) => [c.id, handler]));
    let onTargetRefusedCalled = null;
    let thrown = null;
    try {
      await runSecurity({
        run, cases, handlers, external: true,
        ctxFactory: () => ({ mcpHttp: null, web: null, adminCall: () => ({ json: { data: null } }) }),
        onTargetRefused: (message, code) => { onTargetRefusedCalled = { message, code }; throw new Error(message); }
      });
    } catch (error) { thrown = error; }
    assert.ok(onTargetRefusedCalled, "onTargetRefused must be invoked when target verification refuses");
    assert.match(onTargetRefusedCalled.message, /target verification refused/);
    assert.equal(handlerRan, false, "no security case handler must be invoked when preflight refuses");
    assert.ok(thrown, "runSecurity must surface the refusal as a thrown error to the test");
  });

  it("runAgentJourney's main path wires external=true into ExternalInstance (regression: was previously a no-op skip)", async () => {
    // The harness's main() is invoked directly via dynamic import; we can assert it via the
    // module exports: the file imports `ExternalInstance` (not only `LucyProcess`) and the
    // construction is now bound by reconcileExternalFlag + a try/catch on TargetIdentityError.
    const source = readFileSync(new URL("../run-agent-journey.mjs", import.meta.url), "utf8");
    assert.match(source, /import\s*\{[^}]*ExternalInstance[^}]*\}\s*from\s*"\.\/lib\/instance\.mjs"/);
    assert.match(source, /reconcileExternalFlag/);
    assert.match(source, /lucy\s*=\s*new\s+ExternalInstance\(run\)/);
    assert.match(source, /TargetIdentityError/);
    // Also proves the old "if (!args.external) { LucyProcess }" path is still there, but the
    // new ExternalInstance path is the only thing that runs for --external.
  });

  it("runManagement's main path wires external=true into ExternalInstance (regression: was previously a no-op skip)", async () => {
    const source = readFileSync(new URL("../run-management.mjs", import.meta.url), "utf8");
    assert.match(source, /import\s*\{[^}]*ExternalInstance[^}]*\}\s*from\s*"\.\/lib\/instance\.mjs"/);
    assert.match(source, /reconcileExternalFlag/);
    assert.match(source, /lucy\s*=\s*new\s+ExternalInstance\(run\)/);
    assert.match(source, /TargetIdentityError/);
  });

  // B2 lifecycle: the management journey performs first-owner bootstrap on a fresh target, so
  // postflight MUST run after that intended bootstrap. The orchestrator therefore calls
  // verifyPreflight() before Playwright and verifyPostflight() after, not the combined start().
  it("runManagement's external orchestration uses split verifyPreflight / verifyPostflight, with postflight AFTER Playwright", async () => {
    const source = readFileSync(new URL("../run-management.mjs", import.meta.url), "utf8");
    assert.match(source, /verifyPreflight\(\)/, "external mode must call verifyPreflight() (not the combined start())");
    assert.match(source, /verifyPostflight\(\)/, "external mode must re-verify postflight after the management journey's intended UI bootstrap");
    // The postflight call must be placed AFTER the Playwright run, not before.
    const playwrightIdx = source.indexOf("runPlaywright(run");
    const postflightIdx = source.indexOf("verifyPostflight()");
    assert.ok(playwrightIdx > 0 && postflightIdx > 0, "both Playwright run and postflight re-verify must be present");
    assert.ok(postflightIdx > playwrightIdx, "verifyPostflight() must run AFTER Playwright (otherwise it consumes the bootstrap before the UI flow)");
  });
});

// B2 lifecycle: ExternalInstance exposes verifyPreflight() and verifyPostflight() so the
// orchestrator can put the intended UI bootstrap between the two phases. A fresh target is in
// `bootstrap` mode; the preflight (public-only) passes, postflight (login + marker) refuses
// with `needs-bootstrap`. The management flow then performs the bootstrap and re-calls
// postflight, which now passes.
describe("B2 external instance: split preflight / postflight orchestration", () => {
  it("verifyPreflight runs preflight only and does NOT touch auth or the marker", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "b2-ext-pre-0001",
      mode: "release",
      runRoot: root,
      baseUrl: "https://lucy.example.com",
      mcpUrl: "https://lucy.example.com/mcp",
      candidatePath: writeCandidate(root),
      profilePath: PROFILE
    });
    let preCalls = 0;
    let postCalls = 0;
    const preflight = async () => { preCalls += 1; return { ok: true, problems: [], aspects: {}, registered: { webHost: "lucy.example.com" } }; };
    const postflight = async () => { postCalls += 1; return { ok: true, problems: [], aspects: { ownerLogin: { ok: true }, markerRead: { ok: true } } }; };
    const inst = new ExternalInstance(run, { preflight, postflight });
    const result = await inst.verifyPreflight();
    assert.equal(result.ok, true);
    assert.equal(preCalls, 1, "preflight must run exactly once");
    assert.equal(postCalls, 0, "verifyPreflight must NOT call postflight (no auth, no marker read)");
    assert.equal(inst.preflight.ok, true);
    assert.equal(inst.postflight, null, "postflight remains unrun until verifyPostflight()");
  });

  it("verifyPostflight runs postflight only and a fresh bootstrap-mode target fails closed with needs-bootstrap", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "b2-ext-post-0001",
      mode: "release",
      runRoot: root,
      baseUrl: "https://lucy.example.com",
      mcpUrl: "https://lucy.example.com/mcp",
      candidatePath: writeCandidate(root),
      profilePath: PROFILE
    });
    const preflight = async () => ({ ok: true, problems: [], aspects: {}, registered: { webHost: "lucy.example.com" } });
    // Simulate a fresh target in `bootstrap` mode: postflight's ownerLogin refuses (the real
    // postflightVerify returns classification=needs-bootstrap in this case).
    const postflight = async () => ({
      ok: false,
      problems: ["target is in 'bootstrap' mode: first-owner setup is B2's responsibility; target verifier refuses to consume the bootstrap token"],
      aspects: { ownerLogin: { ok: false, classification: "missing_measurement", problems: ["target is in 'bootstrap' mode"] } },
      classification: "missing_measurement"
    });
    const inst = new ExternalInstance(run, { preflight, postflight });
    await inst.verifyPreflight();
    // Now run postflight — it must throw TargetIdentityError with the right classification.
    await assert.rejects(inst.verifyPostflight(), { name: "TargetIdentityError", stage: "postflight", classification: "missing_measurement" });
  });

  it("the orchestrator pattern works: verifyPreflight -> [intended UI bootstrap] -> verifyPostflight", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "b2-ext-both-0001",
      mode: "release",
      runRoot: root,
      baseUrl: "https://lucy.example.com",
      mcpUrl: "https://lucy.example.com/mcp",
      candidatePath: writeCandidate(root),
      profilePath: PROFILE
    });
    // First call: target is in bootstrap mode (postflight refuses). After the orchestrator's
    // intended UI bootstrap (simulated by a flag flip), the second call succeeds. This is the
    // exact lifecycle the management journey drives: a fresh target, preflight passes, the
    // journey's first-owner Playwright case consumes the bootstrap, postflight then logs in
    // and reads the marker.
    let targetMode = "bootstrap";
    const preflight = async () => ({ ok: true, problems: [], aspects: {}, registered: { webHost: "lucy.example.com" } });
    const postflight = async () => {
      if (targetMode === "bootstrap") {
        return {
          ok: false,
          problems: ["target is in 'bootstrap' mode: first-owner setup is B2's responsibility"],
          aspects: { ownerLogin: { ok: false, classification: "missing_measurement", problems: ["bootstrap"] } },
          classification: "missing_measurement"
        };
      }
      return { ok: true, problems: [], aspects: { ownerLogin: { ok: true }, markerRead: { ok: true } } };
    };
    const inst = new ExternalInstance(run, { preflight, postflight });
    // Phase 1: preflight only — succeeds, does not touch auth.
    await inst.verifyPreflight();
    // Phase 2 (intended UI bootstrap happens here, simulated).
    targetMode = "required";
    // Phase 3: postflight re-verify — now passes.
    const result = await inst.verifyPostflight();
    assert.equal(result.ok, true);
    assert.equal(inst.preflight.ok, true);
    assert.equal(inst.postflight.ok, true);
  });

  it("verifyPostflight fails closed when postflight reports problems AFTER intended bootstrap", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "b2-ext-post-0002",
      mode: "release",
      runRoot: root,
      baseUrl: "https://lucy.example.com",
      mcpUrl: "https://lucy.example.com/mcp",
      candidatePath: writeCandidate(root),
      profilePath: PROFILE
    });
    const preflight = async () => ({ ok: true, problems: [], aspects: {}, registered: { webHost: "lucy.example.com" } });
    const postflight = async () => ({
      ok: false,
      problems: ["marker does not contain this run's id"],
      aspects: { markerRead: { ok: false, problems: ["marker does not contain this run's id"] } }
    });
    const inst = new ExternalInstance(run, { preflight, postflight });
    await inst.verifyPreflight();
    await assert.rejects(inst.verifyPostflight(), { stage: "postflight", message: /marker does not contain this run's id/ });
  });

  it("start() still composes both phases for callers that do not drive a UI bootstrap (security/agent external)", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "b2-ext-start-0001",
      mode: "release",
      runRoot: root,
      baseUrl: "https://lucy.example.com",
      mcpUrl: "https://lucy.example.com/mcp",
      candidatePath: writeCandidate(root),
      profilePath: PROFILE
    });
    let preCalls = 0;
    let postCalls = 0;
    const preflight = async () => { preCalls += 1; return { ok: true, problems: [], aspects: {}, registered: { webHost: "lucy.example.com" } }; };
    const postflight = async () => { postCalls += 1; return { ok: true, problems: [], aspects: { ownerLogin: { ok: true }, markerRead: { ok: true } } }; };
    const inst = new ExternalInstance(run, { preflight, postflight });
    await inst.start();
    assert.equal(preCalls, 1);
    assert.equal(postCalls, 1, "start() must still run postflight for non-management callers");
  });
});

describe("prepare-environment: --apply-db contract (B3)", () => {
  it("defaults db.applied to false and records the safe per-run password files + the path the instance reads", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({ runId: "local-test-db-0001", mode: "local", runRoot: root });
    // `applied` is the contract; it stays false until the producer (apply-db.mjs)
    // actually seeds the disposable DB. `applyRequested` records the user opt-in.
    assert.equal(run.db.applied, false);
    assert.equal(run.db.applyRequested, false);
    assert.equal(run.db.engine, "mysql");
    assert.equal(run.db.port, 3306);
    assert.equal(run.db.ownerRole, "root");
    const ktx = parse(readFileSync(path.join(run.paths.project, "ktx.yaml"), "utf8"));
    assert.equal(ktx.connections["fin-db"].driver, "mysql");
    assert.equal(ktx.connections["sales-db"].driver, "mysql");
    assert.equal(ktx.connections["fin-db"].port, 3306);
    // The host secret files hold the reader/owner passwords (mode 0600).
    assert.equal(run.db.passwordFile, path.join(run.secretsDir, "db-reader.password"));
    assert.equal(run.db.ownerPasswordFile, path.join(run.secretsDir, "db-owner.password"));
    // A LOCAL run serves its instance on the host, so the password must be
    // readable at a real host path. `/var/run/secrets/lucy/db` only exists
    // inside the customer's pod — pointing a host-side run at it leaves the
    // database unreachable and every data-plane call empty.
    assert.equal(run.db.secretMount, path.join(run.secretsDir, "db"));
    assert.equal(run.db.containerPasswordPath, path.join(run.secretsDir, "db", "password"));
    // The env block points at the path the instance actually reads.
    assert.equal(run.instance.env.LUCY_DB_PASSWORD_FILE, run.db.containerPasswordPath);
    assert.notEqual(run.instance.env.LUCY_DB_PASSWORD_FILE, run.db.passwordFile);
    // And that path really holds the reader password, so the host-side instance
    // and the KTX upstream can connect to the run's own database.
    const readerPassword = readFileSync(run.db.containerPasswordPath, "utf8").trim();
    assert.equal(readerPassword, readFileSync(run.db.passwordFile, "utf8").trim());
  });

  it("--apply-db flags applyRequested but does NOT mark db.applied; the producer is the sole writer of applied", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "local-test-db-0002",
      mode: "local",
      runRoot: root,
      applyDb: true,
      dbName: "lucy_e2e_ro",
      dbReadonlyRoles: "lucy_e2e_reader_a, lucy_e2e_reader_b"
    });
    // applyRequested reflects the user's intent; applied stays false until the producer runs.
    assert.equal(run.db.applyRequested, true);
    assert.equal(run.db.applied, false);
    assert.equal(run.db.name, "lucy_e2e_ro");
    assert.deepEqual(run.db.readonlyRoles, ["lucy_e2e_reader_a", "lucy_e2e_reader_b"]);
    // The Secret name is deterministic so a re-run with the same id reuses the same Secret.
    assert.equal(run.db.secretName, "lucy-e2e-db-local-test-db-0002");
    // Per-run DB and reader role names are derived from runOwnerIsolationId, NOT the
    // legacy `lucy_e2e_*` hard-coded names that earlier drafts produced.
    assert.match(run.db.finName, /^lucy_e2e_fin_[a-zA-Z0-9_]+$/);
    assert.match(run.db.salesName, /^lucy_e2e_sales_[a-zA-Z0-9_]+$/);
    assert.match(run.db.readerRole, /^lucy_e2e_reader_[a-zA-Z0-9_]+$/);
    // The same isolation id must be the suffix of fin / sales / reader role names.
    const finSuffix = run.db.finName.replace(/^lucy_e2e_fin_/, "");
    assert.equal(run.db.salesName.replace(/^lucy_e2e_sales_/, ""), finSuffix);
    assert.equal(run.db.readerRole.replace(/^lucy_e2e_reader_/, ""), finSuffix);
  });

  it("does not leak the DB password into run.json or the rendered project", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({ runId: "local-test-db-0003", mode: "local", runRoot: root, applyDb: true });
    const readerPassword = readFileSync(path.join(run.secretsDir, "db-reader.password"), "utf8").trim();
    const ownerPassword = readFileSync(path.join(run.secretsDir, "db-owner.password"), "utf8").trim();
    const legacyPassword = readFileSync(path.join(run.secretsDir, "db-password"), "utf8").trim();
    const runJson = readFileSync(path.join(run.paths.runDir, "run.json"), "utf8");
    for (const password of [readerPassword, ownerPassword, legacyPassword]) {
      assert.ok(!runJson.includes(password), `DB password leaked into run.json (${password.length} chars)`);
      for (const file of walk(run.paths.project)) {
        assert.ok(!readFileSync(file, "utf8").includes(password), `DB password in ${file}`);
      }
    }
    // The host secret file path is recorded so the harness can mount it, but the password itself is never embedded.
    assert.equal(run.db.passwordFile, path.join(run.secretsDir, "db-reader.password"));
    // The digests the producer verifies against are recorded; the producer refuses if either is missing.
    assert.match(run.db.seedSqlDigest, /^sha256:[0-9a-f]{64}$/);
    assert.match(run.db.datasetDigest, /^sha256:[0-9a-f]{64}$/);
  });

  it("custom mount path is propagated to the in-container env", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "local-test-db-0004",
      mode: "local",
      runRoot: root,
      applyDb: true,
      dbSecretMountPath: "/etc/lucy/secrets/db"
    });
    assert.equal(run.db.secretMount, "/etc/lucy/secrets/db");
    assert.equal(run.db.containerPasswordPath, "/etc/lucy/secrets/db/password");
    assert.equal(run.instance.env.LUCY_DB_PASSWORD_FILE, "/etc/lucy/secrets/db/password");
  });

  it("selects PostgreSQL only when --db-engine postgres is set", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "local-test-db-pg-0001",
      mode: "local",
      runRoot: root,
      dbEngine: "postgres"
    });
    assert.equal(run.db.engine, "postgres");
    assert.equal(run.db.port, 5432);
    assert.equal(run.db.ownerRole, "postgres");
    const ktx = parse(readFileSync(path.join(run.paths.project, "ktx.yaml"), "utf8"));
    assert.equal(ktx.connections["fin-db"].driver, "postgres");
    assert.equal(ktx.connections["fin-db"].port, 5432);
  });

  it("keeps an explicit port and refuses an unknown engine", async () => {
    const root = tmp();
    const { run } = await prepareEnvironment({
      runId: "local-test-db-port-0001",
      mode: "local",
      runRoot: root,
      dbPort: 13306
    });
    assert.equal(run.db.engine, "mysql");
    assert.equal(run.db.port, 13306);
    await assert.rejects(
      prepareEnvironment({ runId: "local-test-db-engine-0001", mode: "local", runRoot: root, dbEngine: "oracle" }),
      /--db-engine must be mysql or postgres/
    );
  });

  it("does not run the PostgreSQL seed producer against a MySQL run", async () => {
    const root = tmp();
    const { runJsonPath } = await prepareEnvironment({
      runId: "local-test-db-apply-0001",
      mode: "local",
      runRoot: root,
      applyDb: true
    });
    await assert.rejects(applyDbToRun({ runJsonPath }), /seeds PostgreSQL only/);
  });

  it("grants mysql only after a MySQL seed is applied, and postgres only for that engine", () => {
    assert.equal(appliedDatabaseCapability({ applied: false, engine: "mysql" }), null);
    assert.equal(appliedDatabaseCapability({ applied: true, engine: "mysql" }), "mysql");
    assert.equal(appliedDatabaseCapability({ applied: true, engine: "postgres" }), "postgres");
    assert.equal(appliedDatabaseCapability({ applied: true }), "postgres");
  });
});
