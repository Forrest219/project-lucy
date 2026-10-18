// Negative/contract tests for the customer release pipeline wiring (Spec §8.3, Plan T14).
// They parse the real workflow and scripts; a customer package or tag must be impossible without
// customer-release-readiness, and the amd64 single-arch / no-rebuild / no `buildx create --use` rules must hold.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";
import { REQUIRED_EXISTING_GATES } from "../e2e/verify-evidence.mjs";
import { REPO_ROOT } from "../e2e/lib/common.mjs";

const WORKFLOW_PATH = path.join(REPO_ROOT, ".github/workflows/lucy-release.yml");
const workflowText = readFileSync(WORKFLOW_PATH, "utf8");
const workflow = parse(workflowText);
const jobs = workflow.jobs;

const needsOf = (name) => {
  const needs = jobs[name]?.needs ?? [];
  return Array.isArray(needs) ? needs : [needs];
};

function transitiveNeeds(name, seen = new Set()) {
  for (const dep of needsOf(name)) {
    if (!seen.has(dep)) {
      seen.add(dep);
      transitiveNeeds(dep, seen);
    }
  }
  return seen;
}

const stepsText = (job) => (jobs[job].steps ?? []).map((step) => `${step.run ?? ""}\n${step.uses ?? ""}`).join("\n");
const releaseJobs = Object.keys(jobs).filter((name) => /customer-release|release-package|customer-amd64-native/.test(name));

const gate = (snippet) => spawnSync("bash", ["-c", `source "${REPO_ROOT}/scripts/gates/k8s-gate-lib.sh"; ${snippet}`], { cwd: REPO_ROOT, encoding: "utf8" });
const DIGEST = `sha256:${"a".repeat(64)}`;

describe("release workflow cannot produce a customer release without customer-release-readiness", () => {
  it("renames the smoke jobs that were mistaken for E2E gates, everywhere", () => {
    assert.ok(jobs["demo-db-smoke"] && jobs["postgres-demo-db-smoke"]);
    assert.ok(!jobs["demo-e2e"] && !jobs["postgres-demo-e2e"]);
    assert.ok(!/\bdemo-e2e\b|\bpostgres-demo-e2e\b/.test(workflowText), "no stale job name remains in a needs list or comment");
    const readiness = readFileSync(path.join(REPO_ROOT, "scripts/gates/p1-release-readiness.mjs"), "utf8");
    assert.ok(!/"demo-e2e"|"postgres-demo-e2e"/.test(readiness));
  });

  it("customer-release-readiness is a job and release-package transitively depends on it", () => {
    assert.ok(jobs["customer-release-readiness"]);
    assert.ok(needsOf("release-package").includes("customer-release-readiness"));
    for (const dep of ["real-e2e", "customer-amd64-native", "demo-db-smoke", "postgres-demo-db-smoke", "k8s-upgrade-gate"]) {
      assert.ok(transitiveNeeds("release-package").has(dep), `release-package must (transitively) depend on ${dep}`);
    }
  });

  it("every job that can publish or tag a customer artifact depends on the readiness gate (or only pushes the candidate)", () => {
    for (const name of releaseJobs) {
      const text = stepsText(name);
      const publishesRelease = /imagetools create|release:artifacts|upload-artifact@v4[\s\S]*lucy-release-artifacts/.test(text) || name === "release-package";
      if (publishesRelease) {
        assert.ok(transitiveNeeds(name).has("customer-release-readiness"), `${name} publishes without customer-release-readiness`);
      }
    }
    // The only job that pushes before the gate pushes a `candidate-` tag, never a customer tag.
    const native = stepsText("customer-amd64-native");
    assert.match(native, /candidate-amd64-/);
    assert.ok(!/TAG="customer-/.test(native), "the native job must not mint a customer release tag");
  });

  it("the readiness job re-verifies with the one verifier and checks the signed archive", () => {
    const text = stepsText("customer-release-readiness");
    assert.match(text, /archive-evidence\.mjs --verify/);
    assert.match(text, /gate:customer-release/);
    assert.ok(needsOf("customer-release-readiness").includes("real-e2e"));
  });

  it("real-e2e needs a protected runner and the candidate; it never falls back to a hosted headless runner", () => {
    const runsOn = jobs["real-e2e"]["runs-on"];
    assert.ok(Array.isArray(runsOn) && runsOn.includes("self-hosted") && runsOn.includes("lucy-protected"), JSON.stringify(runsOn));
    assert.ok(needsOf("real-e2e").includes("customer-amd64-native"));
    assert.ok(!("continue-on-error" in jobs["real-e2e"]), "a failing real E2E must not be allowed to continue");
    const text = stepsText("real-e2e");
    for (const required of ["prepare-environment.mjs", "--mode release", "deploy-candidate.sh", "run-security.mjs", "e2e:real:management", "run-agent-journey.mjs", "collect-gate-results.mjs", "archive-evidence.mjs"]) {
      assert.ok(text.includes(required), `real-e2e is missing ${required}`);
    }
    assert.ok(!/--allow-unisolated-local/.test(text), "the isolation override is for local runs only");
  });

  it("real-e2e passes --external to every external runner; run-agent-journey would otherwise start local source", () => {
    const text = stepsText("real-e2e");
    // The whole "runners" block must invoke each of the three external-aware runners with --external,
    // so the registered MCP URL is the only target contacted. run-agent-journey was the easy one to
    // miss; assert it explicitly here (Spec §6.5, §8.3).
    assert.match(text, /run-security\.mjs --run "\$\{RUN\}" --external/);
    assert.match(text, /e2e:real:management -- --run "\$\{RUN\}" --external/);
    assert.match(text, /run-agent-journey\.mjs --run "\$\{RUN\}" --external/);
  });

  it("promotes the tested digest and never rebuilds after the gates", () => {
    const text = stepsText("release-package");
    assert.match(text, /imagetools create/);
    assert.ok(!/docker build(?!x)|buildx build|docker push/.test(text), "release-package must not build or push a new image");
    assert.match(text, /promoted digest .* differs from the tested candidate/);
    assert.match(text, /customer-amd64-\$\{LUCY_VERSION\}/, "default release tag is the single-arch amd64 form");
  });
});

describe("customer image stays linux/amd64 single-arch and G1–G4 are not weakened", () => {
  it("no arm64 or multi-arch build, no QEMU, no builder creation anywhere in the workflow", () => {
    assert.ok(!/linux\/arm64/.test(workflowText), "arm64 must not appear in the customer pipeline");
    assert.ok(!/setup-qemu-action|setup-buildx-action/.test(workflowText));
    assert.ok(!/buildx create/.test(workflowText));
    assert.ok(!/linux\/amd64,linux\/arm64/.test(workflowText));
  });

  it("no script or workflow runs `docker buildx create --use` (it would pollute the default builder)", () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", "inbox", ".git"].includes(entry.name)) continue;
          walk(full);
        } else if (/\.(sh|mjs|yml|yaml)$/.test(entry.name) && !/\.test\.mjs$/.test(entry.name)) {
          if (/buildx\s+create[^\n]*--use|--use[^\n]*buildx\s+create/.test(readFileSync(full, "utf8"))) offenders.push(path.relative(REPO_ROOT, full));
        }
      }
    };
    for (const dir of ["scripts", "deploy", ".github"]) walk(path.join(REPO_ROOT, dir));
    assert.deepEqual(offenders, []);
  });

  it("the native job runs G1, G2, G3, G4, G4b and G8 and records each against the candidate digest", () => {
    const text = stepsText("customer-amd64-native");
    for (const name of ["g1-metadata-arch", "g2-elf-arch", "g3-runtime-smoke", "g4-ktx-version", "g4b-python-runtime", "g8-k8s-contract"]) {
      assert.ok(text.includes(name), `native job does not record ${name}`);
      assert.ok(REQUIRED_EXISTING_GATES.includes(name), `${name} must be a required gate for the verifier`);
    }
    assert.match(text, /assert-image-elf-arch\.sh "\$\{IMAGE_REF\}" amd64/, "ELF architecture is checked, not just metadata");
    assert.match(text, /record-gate-result\.mjs --results-dir release\/results/);
    assert.match(text, /--platform linux\/amd64/);
    assert.ok(!/continue-on-error/.test(JSON.stringify(jobs["customer-amd64-native"])));
  });

  it("the local customer build script keeps its amd64-only, non-default-builder behavior", () => {
    const script = readFileSync(path.join(REPO_ROOT, "scripts/release/build-customer-amd64-image.sh"), "utf8");
    assert.match(script, /--platform linux\/amd64/);
    assert.match(script, /docker buildx use default/);
    assert.ok(!/buildx create/.test(script));
    assert.ok(!/FROM --platform=\$BUILDPLATFORM/.test(readFileSync(path.join(REPO_ROOT, "Dockerfile"), "utf8")));
  });
});

describe("K8s gate scripts bind evidence to the candidate digest", () => {
  it("accepts a registry digest from a runtime imageID and rejects bare config IDs / tags", () => {
    assert.equal(gate(`image_digest_from_id "docker-pullable://ghcr.io/x/lucy@${DIGEST}"`).stdout, DIGEST);
    assert.equal(gate(`image_digest_from_id "ghcr.io/x/lucy@${DIGEST}"`).stdout, DIGEST);
    assert.notEqual(gate(`image_digest_from_id "${DIGEST}"`).status, 0, "a bare config ID is not a registry digest");
    assert.notEqual(gate(`image_digest_from_id "ghcr.io/x/lucy:customer-amd64-0.17.0"`).status, 0, "a tag proves nothing");
  });

  it("fails when the Pod runs another digest, an undigested image, or the expectation is malformed", () => {
    const other = `sha256:${"b".repeat(64)}`;
    assert.equal(gate(`assert_expected_image_digest "ghcr.io/x/lucy@${DIGEST}" "${DIGEST}"`).status, 0);
    const mismatch = gate(`assert_expected_image_digest "ghcr.io/x/lucy@${other}" "${DIGEST}"`);
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /not the candidate/);
    assert.match(gate(`assert_expected_image_digest "ghcr.io/x/lucy:tag" "${DIGEST}"`).stderr, /carries no registry digest/);
    assert.match(gate(`assert_expected_image_digest "ghcr.io/x/lucy@${DIGEST}" "latest"`).stderr, /must be sha256/);
  });

  it("deployment evidence records the digest AND the logical run id, and refuses anything but a single replica", () => {
    const dir = path.join(REPO_ROOT, "inbox", `deployment-evidence-test-${process.pid}`);
    const ok = gate(`mkdir -p "${dir}" && write_deployment_evidence "${dir}/d.json" ns rel "ghcr.io/x/lucy@${DIGEST}" uid-1 1 logical-uuid-x && cat "${dir}/d.json"`);
    assert.equal(ok.status, 0, ok.stderr);
    const doc = JSON.parse(ok.stdout);
    assert.deepEqual({ topology: doc.topology, digest: doc.deployedImageDigest, instance: doc.instanceId, logical: doc.logicalInstanceId }, { topology: "single-replica-k8s", digest: DIGEST, instance: "uid-1", logical: "logical-uuid-x" });
    const two = gate(`write_deployment_evidence "${dir}/e.json" ns rel "ghcr.io/x/lucy@${DIGEST}" uid-1 2 logical-uuid-x`);
    assert.notEqual(two.status, 0);
    assert.match(two.stderr, /single-replica/);
    const noLogical = gate(`write_deployment_evidence "${dir}/f.json" ns rel "ghcr.io/x/lucy@${DIGEST}" uid-1 1 ""`);
    assert.notEqual(noLogical.status, 0);
    assert.match(noLogical.stderr, /logical_instance_id is required/);
    gate(`rm -rf "${dir}"`);
  });

  it("acceptance and release gate expose the digest and evidence options", () => {
    for (const file of ["scripts/gates/k8s-acceptance.sh", "scripts/gates/k8s-release-gate.sh"]) {
      const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
      assert.match(text, /--expect-image-digest/);
      assert.match(text, /--deployment-evidence/);
      assert.equal(spawnSync("bash", ["-n", path.join(REPO_ROOT, file)]).status, 0);
    }
  });

  it("the E2E deploy script is bash-3.2 safe, injects secrets only from files, and pins by digest", () => {
    const file = path.join(REPO_ROOT, "deploy/k8s/security-e2e/deploy-candidate.sh");
    const text = readFileSync(file, "utf8");
    assert.equal(spawnSync("bash", ["-n", file]).status, 0);
    const code = text.replace(/^\s*#.*$/gm, "");
    assert.ok(!/readarray|mapfile|declare -A|\$\{[A-Za-z_]+\[-1\]\}/.test(code));
    assert.match(text, /--from-file=token=/);
    assert.ok(!/--from-literal/.test(text), "no secret may be passed on a command line");
    assert.match(text, /\^sha256:\[0-9a-f\]\{64\}\$/);
    assert.match(text, /--expect-image-digest/);
    assert.match(text, /--deployment-evidence/);
    assert.match(text, /no private configuration is ever copied/);
  });

  it("the isolated deployment profile has no credentials and no fault-injection switch", () => {
    for (const name of ["values.security-e2e.yaml", "networkpolicy.yaml", "deploy-candidate.sh", "README.md"]) {
      const raw = readFileSync(path.join(REPO_ROOT, "deploy/k8s/security-e2e", name), "utf8");
      // Comments and README prose may say there is NO such switch; only live content is checked.
      // B3 mounts the per-run DB password into a K8s Secret via
      // `kubectl create secret generic --from-file=password=<file>`. The string
      // "password" there is the Secret data key, not a literal credential; the
      // value stays in the per-run file (mode 0600). Strip `--from-file=password=...`
      // (including variable references like `${DB_READER_PASSWORD_FILE}`) so the
      // credential check focuses on actual plaintext values.
      const stripped = name === "deploy-candidate.sh"
        ? raw.replace(/--from-file=password=[\w$\{\}\/\-\.\/]+/g, "--from-file=password=<file>")
        : raw;
      const text = name === "README.md" ? stripped : stripped.replace(/^\s*#.*$/gm, "");
      assert.ok(!/password\s*[:=]\s*\S{6,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/-]{20,}/.test(text), `${name} contains a credential`);
      if (name !== "README.md") assert.ok(!/LUCY_FAULT|fault[-_]?inject|failpoint/i.test(text), `${name} carries a fault switch`);
    }
    const values = parse(readFileSync(path.join(REPO_ROOT, "deploy/k8s/security-e2e/values.security-e2e.yaml"), "utf8"));
    assert.equal(values.replicaCount, 1);
    assert.match(values.image.repository, /^REPLACE-ME-/, "the profile cannot render until a real candidate repository is supplied");
  });
});
