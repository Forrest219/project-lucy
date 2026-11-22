/**
 * P1-53 Task 5 — offline contract tests for Compose/upgrade/release wiring helpers.
 * No Docker / live MCP required.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { EXIT_CODES, REPO_ROOT } from "../lib/common.mjs";
import {
  MCP_COMPAT_BASELINE_ENV,
  MCP_COMPAT_ENTRYPOINT_ENV,
  MCP_COMPAT_FLAG_ENV,
  MCP_COMPAT_MCP_URL_ENV,
  MCP_COMPAT_WIRING_ENV_CONTRACT,
  applyMcpCompatibilityReleaseGate,
  buildMcpCompatRunnerArgv,
  isMcpCompatEnabled,
  requireRollbackVerifyPlan,
  resolveMcpCompatEntrypoint,
  resolveMcpCompatHookPlan
} from "../lib/mcp-compatibility-wiring.mjs";

const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix = "mcp-wire-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

describe("mcp-compatibility-wiring (Task 5)", () => {
  test("flag default off → not enabled", () => {
    assert.equal(isMcpCompatEnabled({}), false);
    assert.equal(isMcpCompatEnabled({ [MCP_COMPAT_FLAG_ENV]: "0" }), false);
    assert.equal(isMcpCompatEnabled({ [MCP_COMPAT_FLAG_ENV]: "1" }), true);
  });

  test("compose lane defaults to candidate; customer/instance → upgrade; rollbackOccurred → rollback", () => {
    assert.equal(resolveMcpCompatEntrypoint({ lane: "compose" }).entrypoint, "candidate");
    assert.equal(resolveMcpCompatEntrypoint({ lane: "acceptance" }).entrypoint, "candidate");
    assert.equal(resolveMcpCompatEntrypoint({ lane: "customer" }).entrypoint, "upgrade");
    assert.equal(resolveMcpCompatEntrypoint({ lane: "instance" }).entrypoint, "upgrade");
    assert.equal(
      resolveMcpCompatEntrypoint({ lane: "instance", rollbackOccurred: true }).entrypoint,
      "rollback"
    );
    assert.equal(
      resolveMcpCompatEntrypoint({
        env: { [MCP_COMPAT_ENTRYPOINT_ENV]: "candidate" },
        lane: "instance"
      }).entrypoint,
      "candidate"
    );
  });

  test("default off → SKIPPED, never publishable PASS", () => {
    const plan = resolveMcpCompatHookPlan({ env: {}, lane: "compose" });
    assert.equal(plan.action, "skip");
    assert.equal(plan.status, "SKIPPED");
    assert.equal(plan.publishable, false);
    assert.equal(plan.exitCode, EXIT_CODES.skipped);
    assert.match(plan.reasons[0], /unset\/off|SKIPPED|not MCP compatibility PASS/i);
  });

  test("skipMcp → SKIPPED with no publishable evidence", () => {
    const plan = resolveMcpCompatHookPlan({
      env: { [MCP_COMPAT_FLAG_ENV]: "1", [MCP_COMPAT_MCP_URL_ENV]: "http://127.0.0.1:57881/mcp" },
      lane: "acceptance",
      skipMcp: true
    });
    assert.equal(plan.action, "skip");
    assert.equal(plan.publishable, false);
    assert.match(plan.reasons.join(" "), /skip-mcp/i);
  });

  test("enabled without MCP URL → BLOCKED (fail closed)", () => {
    const plan = resolveMcpCompatHookPlan({
      env: { [MCP_COMPAT_FLAG_ENV]: "1" },
      lane: "compose"
    });
    assert.equal(plan.action, "block");
    assert.equal(plan.status, "BLOCKED");
    assert.equal(plan.exitCode, EXIT_CODES.blocked);
    assert.ok(plan.reasons.some((r) => /LUCY_MCP_URL/.test(r)));
  });

  test("customer/instance upgrade without baseline → BLOCKED", () => {
    const plan = resolveMcpCompatHookPlan({
      env: {
        [MCP_COMPAT_FLAG_ENV]: "1",
        [MCP_COMPAT_MCP_URL_ENV]: "http://127.0.0.1:57881/mcp"
      },
      lane: "customer"
    });
    assert.equal(plan.action, "block");
    assert.ok(plan.reasons.some((r) => /BASELINE_MISSING/.test(r)));
  });

  test("customer upgrade with baseline file → READY upgrade argv", () => {
    const dir = tmp();
    const baseline = path.join(dir, "baseline.json");
    writeFileSync(baseline, "{}\n");
    const plan = resolveMcpCompatHookPlan({
      env: {
        [MCP_COMPAT_FLAG_ENV]: "1",
        [MCP_COMPAT_MCP_URL_ENV]: "http://127.0.0.1:57881/mcp",
        [MCP_COMPAT_BASELINE_ENV]: baseline
      },
      lane: "instance"
    });
    assert.equal(plan.action, "run");
    assert.equal(plan.entrypoint, "upgrade");
    assert.ok(plan.argv.includes("upgrade"));
    assert.ok(plan.argv.includes("--baseline"));
    assert.ok(plan.argv.includes("--mcp-url"));
  });

  test("compose candidate READY when flag + url present", () => {
    const plan = resolveMcpCompatHookPlan({
      env: {
        [MCP_COMPAT_FLAG_ENV]: "1",
        [MCP_COMPAT_MCP_URL_ENV]: "http://127.0.0.1:57881/mcp"
      },
      lane: "compose"
    });
    assert.equal(plan.action, "run");
    assert.equal(plan.entrypoint, "candidate");
    assert.deepEqual(plan.argv.slice(0, 1), ["candidate"]);
  });

  test("missing baseline path on disk → BLOCKED", () => {
    const plan = resolveMcpCompatHookPlan({
      env: {
        [MCP_COMPAT_FLAG_ENV]: "1",
        [MCP_COMPAT_MCP_URL_ENV]: "http://127.0.0.1:9/mcp",
        [MCP_COMPAT_BASELINE_ENV]: "/no/such/baseline.json"
      },
      lane: "instance"
    });
    assert.equal(plan.action, "block");
    assert.ok(plan.reasons.some((r) => /not found/.test(r)));
  });

  test("rollbackOccurred + flag off → SKIPPED; flag on requires rollback entrypoint", () => {
    const skipped = requireRollbackVerifyPlan({
      env: {},
      rollbackOccurred: true,
      lane: "instance"
    });
    assert.equal(skipped.action, "skip");
    assert.equal(skipped.status, "SKIPPED");
    assert.equal(skipped.exitCode, 3);
    assert.match(skipped.reasons.join(" "), /unset\/off|deferred|LUCY_MCP_COMPAT/i);

    const dir = tmp();
    const baseline = path.join(dir, "b.json");
    writeFileSync(baseline, "{}\n");
    const ready = requireRollbackVerifyPlan({
      env: {
        [MCP_COMPAT_FLAG_ENV]: "1",
        [MCP_COMPAT_MCP_URL_ENV]: "http://127.0.0.1:57881/mcp",
        [MCP_COMPAT_BASELINE_ENV]: baseline
      },
      rollbackOccurred: true,
      lane: "instance"
    });
    assert.equal(ready.action, "run");
    assert.equal(ready.entrypoint, "rollback");

    const enabledNoBaseline = requireRollbackVerifyPlan({
      env: {
        [MCP_COMPAT_FLAG_ENV]: "1",
        [MCP_COMPAT_MCP_URL_ENV]: "http://127.0.0.1:57881/mcp"
      },
      rollbackOccurred: true,
      lane: "instance"
    });
    assert.equal(enabledNoBaseline.action, "block");
    assert.equal(enabledNoBaseline.status, "BLOCKED");
  });

  test("buildMcpCompatRunnerArgv never puts secrets on argv", () => {
    const argv = buildMcpCompatRunnerArgv({
      entrypoint: "candidate",
      env: {
        [MCP_COMPAT_MCP_URL_ENV]: "http://127.0.0.1:57881/mcp",
        LUCY_MCP_TOKEN: "lucy_e2e_should_not_appear_on_argv",
        COMPAT_TOKEN_READONLY: "secret-token-value"
      }
    });
    const joined = argv.join(" ");
    assert.ok(!joined.includes("lucy_e2e_should_not_appear_on_argv"));
    assert.ok(!joined.includes("secret-token-value"));
  });

  test("applyMcpCompatibilityReleaseGate: missing evidence ⇒ not releaseReady", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "results"), { recursive: true });
    const gated = applyMcpCompatibilityReleaseGate({
      runDir: dir,
      verdict: { status: "passed", releaseReady: true, problems: [], exitCode: 0 },
      require: "candidate"
    });
    assert.equal(gated.releaseReady, false);
    assert.ok(gated.mcpCompatibility);
    assert.notEqual(gated.mcpCompatibility.status, "PASS");
  });

  test("applyMcpCompatibilityReleaseGate: ci-subset cannot releaseReady=true", () => {
    const dir = tmp();
    const results = path.join(dir, "results");
    mkdirSync(results, { recursive: true });
    // Minimal stub; verifier will BLOCK/FAIL — gate must still refuse releaseReady.
    writeFileSync(
      path.join(results, "mcp-compatibility-candidate.json"),
      JSON.stringify({
        contract: "lucy-mcp-compatibility-evidence-v1",
        kind: "candidate",
        coverageMode: "ci-subset",
        status: "PASS",
        entrypoint: "certifyCandidate",
        suiteDigest: "sha256:x",
        candidateDigest: "sha256:x",
        clientFingerprint: "c",
        modelFingerprint: "m",
        configProfileFingerprint: "sha256:p",
        batchWallClockMs: 1,
        denominator: { expectedCaseIds: [], complete: false },
        cases: []
      })
    );
    const gated = applyMcpCompatibilityReleaseGate({
      runDir: dir,
      verdict: { status: "passed", releaseReady: true, problems: [], exitCode: 0 },
      ciSubset: true,
      require: "candidate"
    });
    assert.equal(gated.releaseReady, false);
    assert.ok(
      gated.problems.some((p) => /ci_subset|subset/i.test(p.code) || /ci_subset|subset/i.test(p.message))
    );
  });

  test("env contract documents Wave D authorization gap", () => {
    assert.equal(MCP_COMPAT_WIRING_ENV_CONTRACT.enableFlag, MCP_COMPAT_FLAG_ENV);
    assert.ok(MCP_COMPAT_WIRING_ENV_CONTRACT.notes.some((n) => /Wave D/i.test(n)));
  });

  test("hook CLI plan exits 3 when flag off; shell wrapper is bash-3.2 safe", () => {
    const hookJs = path.join(REPO_ROOT, "scripts/e2e/mcp-compatibility-hook.mjs");
    const hookSh = path.join(REPO_ROOT, "scripts/e2e/mcp-compatibility-hook.sh");
    const plan = spawnSync(process.execPath, [hookJs, "plan", "--lane", "compose"], {
      cwd: REPO_ROOT,
      env: { ...process.env, [MCP_COMPAT_FLAG_ENV]: "0" },
      encoding: "utf8"
    });
    assert.equal(plan.status, EXIT_CODES.skipped, plan.stderr);
    const body = JSON.parse(plan.stdout);
    assert.equal(body.status, "SKIPPED");

    const shText = readFileSync(hookSh, "utf8");
    const code = shText.replace(/^\s*#.*$/gm, "");
    assert.ok(!/readarray|mapfile|declare -A|\$\{[A-Za-z_]+\[-1\]\}/.test(code));
    assert.equal(spawnSync("bash", ["-n", hookSh]).status, 0);
  });

  test("hook CLI release-gate missing evidence exits blocked/failed and releaseReady false", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "results"), { recursive: true });
    const hookJs = path.join(REPO_ROOT, "scripts/e2e/mcp-compatibility-hook.mjs");
    const result = spawnSync(
      process.execPath,
      [hookJs, "release-gate", "--run-dir", dir, "--require", "candidate"],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );
    assert.ok([EXIT_CODES.blocked, EXIT_CODES.failed].includes(result.status), result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.releaseReady, false);
  });

  test("Compose/upgrade/acceptance scripts wire the hook without auto production rollback", () => {
    const files = [
      "scripts/upgrade/upgrade-lucy.sh",
      "scripts/gates/k8s-acceptance.sh",
      "scripts/gates/k8s-upgrade-gate.sh"
    ];
    for (const rel of files) {
      const text = readFileSync(path.join(REPO_ROOT, rel), "utf8");
      assert.match(text, /mcp-compatibility-hook/);
      assert.match(text, /LUCY_MCP_COMPAT/);
      assert.equal(spawnSync("bash", ["-n", path.join(REPO_ROOT, rel)]).status, 0);
      const code = text.replace(/^\s*#.*$/gm, "");
      assert.ok(!/helm rollback.*mcp-compat|kubectl.*rollback.*mcp-compat/i.test(code));
    }
    const upgrade = readFileSync(path.join(REPO_ROOT, "scripts/gates/k8s-upgrade-gate.sh"), "utf8");
    assert.match(upgrade, /--rollback-occurred/);
    assert.match(upgrade, /ROLLBACK_VERIFY/);
    assert.ok(
      !/helm rollback/.test(upgrade.split("maybe_run_mcp_compat_rollback_verify")[1]?.split("log \"H4-2")[0] ?? ""),
      "ROLLBACK_VERIFY helper must not itself call helm rollback"
    );
  });
});
