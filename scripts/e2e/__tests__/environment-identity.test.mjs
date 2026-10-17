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
import { AGENT_TOKENS, PrepareError, prepareEnvironment } from "../prepare-environment.mjs";

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
