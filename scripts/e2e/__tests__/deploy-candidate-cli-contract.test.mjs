// B1 producer+consumer CLI contract test: drive the REAL `deploy/k8s/security-e2e/deploy-candidate.sh`
// end-to-end with synthetic kubectl/helm/k8s-acceptance stubs. The test proves the actual full deploy
// call (not just the shell function it delegates to) reads the run's logical instance id from run.json
// and forwards it to k8s-acceptance.sh via `--logical-instance-id` — which k8s-acceptance.sh now
// requires whenever `--deployment-evidence` is used. Without this, B1's target-identity refuses any
// external deployment and the real-user E2E gate cannot produce target identity.
//
// The kubectl/helm stubs simply record every call to a JSON log and exit 0. The k8s-acceptance stub
// validates every required flag, writes the recorded `deployment.json` to the run directory, and
// records the actual argument vector. The test inspects those records to prove the contract.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { REPO_ROOT } from "../lib/common.mjs";

const TMP_ROOT = mkdtempSync(path.join(tmpdir(), "deploy-candidate-cli-"));
const STUB_BIN = path.join(TMP_ROOT, "stub-bin");
const ACCEPTANCE_STUB = path.join(TMP_ROOT, "acceptance-stub.sh");

function track(dir) {
  // keep for cleanup; the same mkdtempSync is reused for the whole test file
  return dir;
}

const DIGEST = `sha256:${"a".repeat(64)}`;
const NAMESPACE = "lucy-e2e-cli";
const RELEASE = "lucy-e2e";
const REPOSITORY = "ghcr.io/example/project-lucy";
const PUBLIC_MCP_URL = "https://lucy-e2e.example.com/mcp";

function writeStubKubectl() {
  const log = path.join(TMP_ROOT, "kubectl.log");
  // Bash 3.2 compatible stub. Real kubectl accepts `-n <ns> <verb> ...` so we strip the
  // leading -n flag once and then pattern-match on the verb that follows.
  const stub = `#!/bin/bash
echo "CALL: $*" >> "${log}"
# Strip the leading -n namespace flag (only -n is used by these scripts).
ARGS="$*"
case "$ARGS" in
  "-n "*) ARGS="\${ARGS#-n }" ;;
esac
# ARGS now looks like "<ns> <verb> ...". Strip the namespace token (one word, no spaces).
case "$ARGS" in
  *" "*) ARGS="\${ARGS#* }" ;;
esac
# Now ARGS starts with the verb (get, exec, rollout, apply, create, delete, wait).
case "$ARGS" in
  "get namespace "*) exit 0 ;;
  "get pods -l "*) printf 'lucy-e2e-abc'; exit 0 ;;
  "get pod "*jsonpath*)
    case "$ARGS" in
      *"imageID"*) printf 'docker-pullable://ghcr.io/example/project-lucy@${DIGEST}' ;;
      *".metadata.uid"*) printf 'physical-pod-uid-123' ;;
      *"status.phase"*) printf 'Running true' ;;
      *) printf '' ;;
    esac
    exit 0
    ;;
  "get deploy "*jsonpath*)
    case "$ARGS" in
      *"readyReplicas"*) printf '1' ;;
      *"spec.replicas"*) printf '1' ;;
      *) printf '1' ;;
    esac
    exit 0
    ;;
  "get deploy "*go-template*) printf 'app=foo,'; exit 0 ;;
  "get svc "*jsonpath*) printf 'webui:5174->5174 mcp:7879->7879'; exit 0 ;;
  "get endpoints "*jsonpath*) printf '5174 7879'; exit 0 ;;
  "rollout status "*|"rollout restart "*) exit 0 ;;
  "exec "*)
    # Consume stdin (tar archive piped from the deploy script) and exit 0.
    cat >/dev/null
    exit 0
    ;;
  "apply "*|"create "*|"delete "*|"wait "*) exit 0 ;;
  *) exit 0 ;;
esac
`;
  writeFileSync(path.join(STUB_BIN, "kubectl"), stub, { mode: 0o755 });
}

function writeStubHelm() {
  const log = path.join(TMP_ROOT, "helm.log");
  const stub = `#!/bin/bash
echo "CALL: $*" >> "${log}"
# helm status -o json: the acceptance script parses this for the "info.status" field. Return a
# minimal valid JSON envelope so the python3 status parser does not crash on empty input.
if [[ "$*" == *"-o json"* ]]; then
  printf '{"info":{"status":"deployed"}}'
  exit 0
fi
exit 0
`;
  writeFileSync(path.join(STUB_BIN, "helm"), stub, { mode: 0o755 });
}

function writeAcceptanceStub() {
  // Real `k8s-acceptance.sh` talks to a cluster. This stub records the call, validates the
  // --logical-instance-id flag is present, and writes a synthetic deployment.json into the
  // --deployment-evidence path so the rest of the test can read what the real call would have
  // produced.
  const log = path.join(TMP_ROOT, "acceptance.log");
  const stub = `#!/bin/bash
set -euo pipefail
LOG="${log}"
EVIDENCE_FILE=""
LOGICAL_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deployment-evidence) EVIDENCE_FILE="$2"; shift 2 ;;
    --logical-instance-id) LOGICAL_ID="$2"; shift 2 ;;
    *) shift ;;
  esac
done
echo "CALL: logical_instance_id='\${LOGICAL_ID}' evidence='\${EVIDENCE_FILE}'" >> "\${LOG}"
if [[ -z "\${LOGICAL_ID}" ]]; then
  echo "STUB: refusing to write evidence without --logical-instance-id" >&2
  exit 1
fi
if [[ -z "\${EVIDENCE_FILE}" ]]; then
  echo "STUB: refusing to proceed without --deployment-evidence" >&2
  exit 1
fi
mkdir -p "\$(dirname "\${EVIDENCE_FILE}")"
cat > "\${EVIDENCE_FILE}" <<EOF
{
  "contract": "lucy-deployment-v1",
  "instanceId": "physical-pod-uid-123",
  "logicalInstanceId": "\${LOGICAL_ID}",
  "topology": "single-replica-k8s",
  "deployedImageDigest": "${DIGEST}",
  "namespace": "${NAMESPACE}",
  "release": "${RELEASE}"
}
EOF
exit 0
`;
  writeFileSync(ACCEPTANCE_STUB, stub, { mode: 0o755 });
}

function writeStubHelm2() {
  const log = path.join(TMP_ROOT, "helm.log");
  const stub = `#!/bin/bash
echo "CALL: $*" >> "${log}"
exit 0
`;
  writeFileSync(path.join(STUB_BIN, "helm"), stub, { mode: 0o755 });
}

function buildSyntheticRunDir() {
  const runDir = path.join(TMP_ROOT, "runs", "synthetic");
  const projectDir = path.join(runDir, "project");
  const checkerDir = path.join(runDir, "checker");
  const secretsDir = path.join(checkerDir, "secrets");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(secretsDir, { recursive: true });
  // The deployment script needs a non-empty project dir to copy and a readable bootstrap token file.
  writeFileSync(path.join(projectDir, "ktx.yaml"), "connections: {}\n");
  writeFileSync(path.join(projectDir, ".ktx-secrets-marker"), "ok\n");
  writeFileSync(path.join(secretsDir, "bootstrap-token"), randomUUID());
  const logicalInstanceId = randomUUID();
  const run = {
    contract: "lucy-e2e-run-v1",
    runId: "synthetic-run",
    instanceId: logicalInstanceId,
    paths: {
      runDir,
      project: projectDir,
      checker: checkerDir
    },
    secretsDir
  };
  writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  return { runDir, logicalInstanceId };
}

function buildEnv() {
  // We replace the script's kubectl/helm with stubs and intercept the call to k8s-acceptance.sh by
  // creating a temporary k8s-acceptance.sh on PATH first. Easiest: put STUB_BIN on PATH first AND
  // override SCRIPT_DIR in k8s-gate-lib... but the deploy script sources k8s-acceptance.sh by
  // absolute path. So we have to take a different approach: copy deploy-candidate.sh to a temp
  // location, then patch the path to k8s-acceptance.sh inside it.
  return {
    ...process.env,
    PATH: `${STUB_BIN}:${process.env.PATH}`,
    LUCY_E2E_NAMESPACE: NAMESPACE
  };
}

function copyAndPatchDeployScript() {
  const src = path.join(REPO_ROOT, "deploy/k8s/security-e2e/deploy-candidate.sh");
  const dst = path.join(TMP_ROOT, "deploy-candidate.sh");
  const text = readFileSync(src, "utf8").replace(
    /bash "\${ROOT}\/scripts\/gates\/k8s-acceptance.sh"/g,
    `bash "${ACCEPTANCE_STUB}"`
  );
  writeFileSync(dst, text, { mode: 0o755 });
  return dst;
}

before(() => {
  mkdirSync(STUB_BIN, { recursive: true });
  writeStubKubectl();
  writeStubHelm();
  writeAcceptanceStub();
});

describe("deploy-candidate.sh: producer+consumer CLI contract (B1 logical instance id)", () => {
  it("the script is bash-3.2 safe and bash-parses", () => {
    const src = path.join(REPO_ROOT, "deploy/k8s/security-e2e/deploy-candidate.sh");
    assert.equal(spawnSync("bash", ["-n", src]).status, 0, "deploy-candidate.sh must be parseable");
    const text = readFileSync(src, "utf8").replace(/^\s*#.*$/gm, "");
    assert.ok(!/readarray|mapfile|declare -A/.test(text), "no bash 4+ features");
  });

  it("sources logicalInstanceId from run.json and forwards it to k8s-acceptance.sh", () => {
    const { runDir, logicalInstanceId } = buildSyntheticRunDir();
    const runJson = path.join(runDir, "run.json");
    const deployScript = copyAndPatchDeployScript();
    const result = spawnSync("bash", [
      deployScript,
      "--run", runJson,
      "--namespace", NAMESPACE,
      "--release", RELEASE,
      "--repository", REPOSITORY,
      "--digest", DIGEST,
      "--public-mcp-url", PUBLIC_MCP_URL
    ], { env: buildEnv(), encoding: "utf8" });

    assert.equal(result.status, 0, `deploy-candidate.sh failed:\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    // The acceptance stub wrote a log line describing what it received.
    const acceptanceLog = readFileSync(path.join(TMP_ROOT, "acceptance.log"), "utf8").trim();
    assert.match(acceptanceLog, new RegExp(`logical_instance_id='${logicalInstanceId}'`), `acceptance stub did not see the logical instance id; log:\n${acceptanceLog}`);
    // deployment.json was written and carries BOTH the physical Pod UID and the logical id.
    const deploymentFile = path.join(runDir, "results", "deployment.json");
    assert.ok(existsSync(deploymentFile), "deployment.json was not written");
    const deployment = JSON.parse(readFileSync(deploymentFile, "utf8"));
    assert.equal(deployment.contract, "lucy-deployment-v1");
    assert.equal(deployment.logicalInstanceId, logicalInstanceId, "deployment.json logicalInstanceId must match run.instanceId");
    assert.equal(deployment.deployedImageDigest, DIGEST);
    assert.equal(deployment.topology, "single-replica-k8s");
    // The physical Pod UID is measured independently inside the acceptance step; the stub wrote
    // a synthetic physical id, but the contract demands a non-empty distinct value.
    assert.ok(deployment.instanceId, "deployment.json instanceId (physical Pod UID) must be present");
    assert.notEqual(deployment.instanceId, logicalInstanceId, "physical and logical ids must be different (different sources)");
  });

  it("a real run.json without instanceId is refused by the deploy script (no fallback)", () => {
    const runDir = path.join(TMP_ROOT, "runs", "no-instanceid");
    mkdirSync(path.join(runDir, "project"), { recursive: true });
    mkdirSync(path.join(runDir, "checker", "secrets"), { recursive: true });
    writeFileSync(path.join(runDir, "project", "ktx.yaml"), "x");
    writeFileSync(path.join(runDir, "checker", "secrets", "bootstrap-token"), "t");
    writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({ contract: "lucy-e2e-run-v1", runId: "x", paths: { runDir } }, null, 2)}\n`);
    const runJson = path.join(runDir, "run.json");
    const deployScript = copyAndPatchDeployScript();
    const result = spawnSync("bash", [
      deployScript,
      "--run", runJson,
      "--namespace", NAMESPACE,
      "--release", RELEASE,
      "--repository", REPOSITORY,
      "--digest", DIGEST,
      "--public-mcp-url", PUBLIC_MCP_URL
    ], { env: buildEnv(), encoding: "utf8" });
    assert.notEqual(result.status, 0, "deploy-candidate.sh must refuse a run.json without instanceId");
    assert.match(result.stderr, /instanceId/);
  });

  it("k8s-acceptance.sh requires --logical-instance-id whenever --deployment-evidence is given", () => {
    // The consumer side: a fresh acceptance.sh with --deployment-evidence and NO
    // --logical-instance-id must exit non-zero. We omit --expect-image-digest so the digest
    // check is skipped (we have no real cluster); the script then proceeds straight to the
    // deployment-evidence branch where it must demand --logical-instance-id.
    const k8sAcceptance = path.join(REPO_ROOT, "scripts/gates/k8s-acceptance.sh");
    const tmp = path.join(TMP_ROOT, "runs", "consumer-check");
    mkdirSync(tmp, { recursive: true });
    const result = spawnSync("bash", [
      k8sAcceptance,
      "--namespace", NAMESPACE,
      "--release", RELEASE,
      "--skip-mcp", "--skip-ktx", "--skip-secrets-check",
      "--skip-helm",
      "--deployment-evidence", path.join(tmp, "deployment.json")
    ], { env: buildEnv(), encoding: "utf8" });
    assert.notEqual(result.status, 0, "k8s-acceptance.sh must refuse --deployment-evidence without --logical-instance-id");
    assert.match(result.stderr, /logical-instance-id/, `acceptance must report missing --logical-instance-id; got: ${result.stderr}`);
  });
});

after(() => {
  // Best-effort cleanup; we don't fail the test if rm fails.
  try {
    execFileSync("rm", ["-rf", TMP_ROOT], { stdio: "ignore" });
  } catch {
    // ignore
  }
});
