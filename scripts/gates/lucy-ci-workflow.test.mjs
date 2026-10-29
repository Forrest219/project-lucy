// Contract tests for the split of the CI workflows (Spec §1.1, §4.1, §4.2, §5, §6).
//
// These assertions are the machine-checkable form of the split contract:
//   - the daily workflow keeps the job ids the branch protection names,
//   - the daily aggregate only reads needs.<job>.result and always runs,
//   - the release workflow no longer has a daily trigger and owns packages:write alone,
//   - the type check lives in its own workflow and never decides the daily workflow,
//   - a pull request run and a push run of the same sha never cancel each other.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";
import { REPO_ROOT } from "../e2e/lib/common.mjs";

const readWorkflow = (name) => {
  const text = readFileSync(path.join(REPO_ROOT, ".github/workflows", name), "utf8");
  return { text, workflow: parse(text) };
};

// YAML comments carry the rationale of this split. They must never be mistaken for a
// configuration value, so every raw-text assertion runs against the comment-free text.
const stripYamlComments = (text) =>
  text
    .split("\n")
    .map((line) => {
      if (line.trim().startsWith("#")) return "";
      const index = line.indexOf(" #");
      return index === -1 ? line : line.slice(0, index);
    })
    .join("\n");

const daily = readWorkflow("lucy-ci.yml");
const release = readWorkflow("lucy-release.yml");
const typecheck = readWorkflow("lucy-typecheck.yml");

const dailyText = stripYamlComments(daily.text);
const releaseText = stripYamlComments(release.text);
const typecheckText = stripYamlComments(typecheck.text);

const needsOf = (workflow, name) => {
  const needs = workflow.jobs[name]?.needs ?? [];
  return Array.isArray(needs) ? needs : [needs];
};

// The run/uses/env/with body of a job, as one searchable string.
const jobBody = (job) =>
  (job.steps ?? [])
    .map((step) => [step.run ?? "", step.uses ?? "", JSON.stringify(step.env ?? {}), JSON.stringify(step.with ?? {})].join("\n"))
    .join("\n");

const jobRuns = (job) => (job.steps ?? []).map((step) => step.run ?? "").join("\n");

// The four checks the branch protection on main currently names. They must keep being produced
// with exactly these names, or the required checks would never report.
const BRANCH_PROTECTION_CHECKS = ["spec-and-webui", "docker-smoke", "k8s-static", "k8s-upgrade-gate"];
const PRESERVED_JOB_IDS = [
  ...BRANCH_PROTECTION_CHECKS,
  "business-eval-catalog",
  "headless-config",
  "demo-db-smoke",
  "postgres-demo-db-smoke",
  "ktx-diff-audit",
];

describe("daily workflow (lucy-ci.yml)", () => {
  it("keeps every preserved job id", () => {
    for (const id of PRESERVED_JOB_IDS) {
      assert.ok(daily.workflow.jobs[id], `the daily workflow lost the job id ${id}`);
    }
  });

  it("produces the branch protection check names unchanged", () => {
    for (const id of BRANCH_PROTECTION_CHECKS) {
      const job = daily.workflow.jobs[id];
      assert.ok(!job.name, `${id} must not rename itself: the required check context is "${id}"`);
    }
  });

  it("triggers on every pull request and on push to main and lucy-v0.25, with no path filter", () => {
    const on = daily.workflow.on ?? daily.workflow[true];
    assert.ok(on.pull_request !== undefined, "the daily workflow must run on pull requests");
    assert.deepEqual(on.push.branches, ["main", "lucy-v0.25"]);
    assert.equal(on.push.paths, undefined, "the first rollout must not filter by path");
    assert.equal(on.pull_request?.paths, undefined, "the first rollout must not filter by path");
    assert.ok(on.workflow_dispatch !== undefined, "a manual daily run must be possible");
  });

  it("is read-only: contents:read by default and no packages:write anywhere", () => {
    assert.equal(daily.workflow.permissions.contents, "read");
    assert.ok(!/packages:\s*write/.test(dailyText), "the daily workflow must not have packages:write");
    for (const [name, job] of Object.entries(daily.workflow.jobs)) {
      assert.ok(!job.permissions?.packages, `${name} must not have packages:write`);
    }
  });

  it("gives every job a timeout and forbids continue-on-error", () => {
    for (const [name, job] of Object.entries(daily.workflow.jobs)) {
      assert.ok(typeof job["timeout-minutes"] === "number", `${name} has no timeout`);
      assert.ok(job["timeout-minutes"] > 0 && job["timeout-minutes"] <= 120, `${name} has a nonsensical timeout`);
      assert.ok(!("continue-on-error" in job), `${name} must not be allowed to continue on error`);
      for (const step of job.steps ?? []) {
        assert.ok(!("continue-on-error" in step), `${name}: a step must not be allowed to continue on error`);
      }
    }
  });

  it("runs on ubuntu-24.04 with Node 22 and does not persist the checkout credentials", () => {
    for (const [name, job] of Object.entries(daily.workflow.jobs)) {
      assert.equal(job["runs-on"], "ubuntu-24.04", `${name} must run on ubuntu-24.04`);
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith("actions/checkout@")) {
          assert.equal(step.with?.["persist-credentials"], false, `${name}: checkout must not persist credentials`);
        }
        if (step.uses?.startsWith("actions/setup-node@")) {
          assert.equal(step.with?.["node-version"], "22", `${name}: the hosted baseline is Node 22`);
        }
      }
    }
  });

  it("aggregates every daily job in ci-required, with if: always()", () => {
    const aggregate = daily.workflow.jobs["ci-required"];
    assert.ok(aggregate, "the daily workflow has no ci-required job");
    assert.equal(String(aggregate.if).replace(/\s/g, ""), "always()");
    const otherJobs = Object.keys(daily.workflow.jobs).filter((name) => name !== "ci-required");
    assert.deepEqual([...needsOf(daily.workflow, "ci-required")].sort(), otherJobs.sort());
    // The list the aggregate step passes to the gate must be the same list.
    const step = aggregate.steps.find((s) => s.run?.includes("ci-required-gate.mjs"));
    assert.ok(step, "ci-required does not call the aggregate gate script");
    const expected = String(step.env?.EXPECTED_JOBS ?? "").split(",").filter(Boolean);
    assert.deepEqual(expected.sort(), otherJobs.sort());
  });

  it("keeps the pull request run and the push run of the same sha in different concurrency groups", () => {
    const group = daily.workflow.concurrency.group;
    assert.match(group, /github\.event_name/, "the concurrency group must separate the event kinds");
    assert.match(group, /pull_request\.number/, "each pull request needs its own group");
    assert.notEqual(group, release.workflow.concurrency.group);
  });

  it("cancels a superseded pull request run and a stale push run, but never a release run", () => {
    const cancel = String(daily.workflow.concurrency["cancel-in-progress"]);
    assert.match(cancel, /pull_request/);
    assert.match(cancel, /refs\/heads\/main/);
    assert.match(cancel, /refs\/heads\/lucy-v0\.25/);
    assert.equal(release.workflow.concurrency["cancel-in-progress"], false, "a release run must never be auto-cancelled");
  });

  it("pins the upstream KTX commit instead of tracking its default branch", () => {
    const body = jobBody(daily.workflow.jobs["ktx-diff-audit"]);
    assert.match(body, /KTX_UPSTREAM_SHA["\s:]+[0-9a-f]{40}/, "the upstream clone must be pinned to a commit sha");
    assert.ok(!/git clone[^\n]*--depth 1[^\n]*ktx\b/.test(body), "the upstream clone must not follow the default branch head");
    assert.match(body, /git fetch[^\n]*KTX_UPSTREAM_SHA/);
  });

  it("does not contain the type check, and does not decide it", () => {
    assert.ok(!/tsc --noEmit/.test(dailyText), "the type check must live in its own workflow");
    assert.ok(!/typecheck/.test(dailyText), "the daily workflow must not reference the type check");
    assert.ok(!Object.keys(daily.workflow.jobs).some((name) => /typecheck/.test(name)));
  });
});

describe("release workflow (lucy-release.yml)", () => {
  it("has no daily trigger left", () => {
    const on = release.workflow.on ?? release.workflow[true];
    assert.equal(on.pull_request, undefined, "the release workflow must not run on pull requests");
    assert.equal(on.push?.branches, undefined, "the release workflow must not run on a push to a branch");
    assert.deepEqual(on.push.tags, ["v*"]);
    assert.ok(on.workflow_dispatch !== undefined, "the release workflow must stay manually reachable");
  });

  it("offers an explicit manual mode and keeps diagnostics as the safe default", () => {
    const on = release.workflow.on ?? release.workflow[true];
    const mode = on.workflow_dispatch.inputs.mode;
    assert.ok(mode, "the manual entry must ask for a mode");
    assert.equal(mode.default, "diagnostics");
    assert.deepEqual([...mode.options].sort(), ["customer-candidate", "diagnostics", "ktx-compat"]);
  });

  it("keeps packages:write only on the candidate image job and the promote job", () => {
    assert.equal(release.workflow.permissions.contents, "read");
    assert.equal(release.workflow.permissions.packages, undefined, "packages:write must not be workflow-wide");
    const writers = Object.entries(release.workflow.jobs)
      .filter(([, job]) => job.permissions?.packages === "write")
      .map(([name]) => name);
    assert.deepEqual(writers.sort(), ["customer-amd64-native", "release-package"]);
  });

  it("passes the manual release tag through the environment, never as shell source", () => {
    for (const [name, job] of Object.entries(release.workflow.jobs)) {
      for (const step of job.steps ?? []) {
        assert.ok(
          !/\$\{\{\s*inputs\./.test(step.run ?? ""),
          `${name}: a manual input is spliced into the shell source`,
        );
      }
    }
    const env = release.workflow.jobs["release-package"].steps
      .flatMap((step) => Object.entries(step.env ?? {}))
      .filter(([key]) => key === "RELEASE_TAG_INPUT");
    assert.equal(env.length, 1, "the release tag must reach the shell through one environment variable");
    assert.match(env[0][1], /inputs\.release_tag/);
  });

  it("never shares a check context with the daily workflow", () => {
    const contextOf = (workflow) => Object.entries(workflow.jobs).map(([id, job]) => job.name ?? id);
    const dailyContexts = new Set(contextOf(daily.workflow));
    for (const context of contextOf(release.workflow)) {
      assert.ok(!dailyContexts.has(context), `the check context "${context}" exists in both workflows`);
    }
    for (const id of PRESERVED_JOB_IDS) {
      if (!release.workflow.jobs[id]) continue;
      assert.notEqual(release.workflow.jobs[id].name, undefined, `${id} must be renamed in the release workflow`);
    }
  });

  it("still gates the release on customer-release-readiness", () => {
    const releasePackageNeeds = needsOf(release.workflow, "release-package");
    assert.ok(releasePackageNeeds.includes("customer-release-readiness"));
    assert.ok(release.workflow.jobs["customer-release-readiness"]);
    assert.ok(needsOf(release.workflow, "customer-release-readiness").includes("real-e2e"));
  });

  it("keeps the customer candidate path behind the explicit mode", () => {
    for (const id of ["customer-amd64-native", "real-e2e", "customer-release-readiness", "release-package"]) {
      const condition = String(release.workflow.jobs[id].if ?? "");
      assert.match(condition, /inputs\.mode == 'customer-candidate'/, `${id} must require the explicit mode`);
    }
  });
});

describe("type check workflow (lucy-typecheck.yml)", () => {
  it("is a separate workflow with the same triggers as the daily workflow", () => {
    const dailyOn = daily.workflow.on ?? daily.workflow[true];
    const typeOn = typecheck.workflow.on ?? typecheck.workflow[true];
    assert.deepEqual(typeOn.push.branches, dailyOn.push.branches);
    assert.ok(typeOn.pull_request !== undefined);
    assert.ok(typeOn.workflow_dispatch !== undefined);
  });

  it("runs an explicit tsc --noEmit and reports the diagnostic count", () => {
    assert.match(typecheckText, /tsc --noEmit --incremental false -p webui\/tsconfig\.json/);
    assert.match(typecheckText, /diagnostics:/);
    for (const [name, job] of Object.entries(typecheck.workflow.jobs)) {
      assert.ok(!("continue-on-error" in job), `${name} must not be allowed to continue on error`);
      for (const step of job.steps ?? []) {
        assert.ok(!("continue-on-error" in step), `${name}: a step must not be allowed to continue on error`);
      }
    }
    assert.ok(!/allowlist|baseline-ignore/i.test(typecheckText), "there is no diagnostic allowlist");
  });

  it("cannot change the daily workflow's conclusion", () => {
    assert.ok(!/needs:.*typecheck/.test(dailyText));
    assert.ok(!Object.keys(daily.workflow.jobs).some((name) => /typecheck/.test(name)));
    assert.equal(typecheck.workflow.permissions.contents, "read");
    assert.ok(!/packages:\s*write/.test(typecheckText));
  });

  it("runs the same flags as the local npm entry point", () => {
    const webuiPackage = JSON.parse(readFileSync(path.join(REPO_ROOT, "webui/package.json"), "utf8"));
    const script = webuiPackage.scripts.typecheck;
    assert.ok(script, "webui/package.json has no typecheck script");
    // The npm script runs with cwd=webui, the workflow with the repo root. Only the flags
    // themselves have to agree.
    const flagsOf = (text) =>
      [...text.matchAll(/--noEmit|--incremental\s+false|-p\s+\S+/g)].map((match) => match[0].replace(/\s+/g, " "));
    const workflowCommand = /webui\/node_modules\/\.bin\/tsc[^\n]*/.exec(typecheckText)?.[0];
    assert.ok(workflowCommand, "the workflow does not run the webui tsc binary");
    const workflowFlags = flagsOf(workflowCommand).filter((flag) => !flag.startsWith("-p "));
    const scriptFlags = flagsOf(script).filter((flag) => !flag.startsWith("-p "));
    assert.deepEqual(workflowFlags, scriptFlags, "the workflow command and the npm script drifted apart");
    assert.match(workflowCommand, /-p webui\/tsconfig\.json/);
    assert.match(script, /-p tsconfig\.json/);
  });
});
