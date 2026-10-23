// Pure HTTP contract tests for scripts/e2e/lib/target-identity.mjs (Spec §6.2 / §6.5 / §8.3).
//
// These tests verify only what the WebUI server actually emits — the auth guard allows
// /api/health and /api/auth/status publicly; the /api/wiki/:key endpoint requires an admin
// session and returns { data: { content, rawMarkdown, … } }. They do not invent any producer
// fields, and they do not invoke the marker endpoint before the postflight login.
//
// Every check is HTTP-mocked via scriptFetch. Live release execution still happens on the
// protected K8s runner; these are the harness contract proofs.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  assertSameRegisteredEndpoint,
  assertSameRegisteredOrigin,
  defaultFetchUrl,
  isSuspiciousUrlString,
  loadDeploymentEvidence,
  postflightVerify,
  preflightVerify,
  reconcileExternalFlag,
  TargetIdentityError,
  verifyAuthMode,
  verifyCandidateFingerprintFromDeployment,
  verifyHealth
} from "../lib/target-identity.mjs";

function scriptFetch(responses, { defaultResolvedUrl } = {}) {
  const calls = [];
  let i = 0;
  const fetchUrl = async (url, init = {}) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, parsed: new URL(urlStr), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
    if (i >= responses.length) throw new Error(`scriptFetch ran out of responses at call #${i + 1} for ${urlStr}`);
    const r = responses[i++];
    const out = typeof r === "function" ? r(calls[calls.length - 1]) : r;
    if (out && !out.cookie && out.headers && Array.isArray(out.headers["set-cookie"]) && out.headers["set-cookie"].length > 0) {
      out.cookie = out.headers["set-cookie"][0].split(";")[0];
    }
    if (out && out.resolvedUrl === undefined) out.resolvedUrl = defaultResolvedUrl ?? urlStr;
    return out;
  };
  fetchUrl.calls = calls;
  return fetchUrl;
}

function makeRun(overrides = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "lucy-target-b1-"));
  after(() => rmSync(tmp, { recursive: true, force: true }));
  const runDir = overrides.runDir ?? tmp;
  return {
    runId: "rel-b1-0001",
    instanceId: "00000000-0000-4000-8000-000000000001",
    fixtureDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    paths: { runDir },
    secretsDir: overrides.secretsDir ?? path.join(runDir, "checker", "secrets"),
    instance: {
      startedBy: "external",
      host: "lucy.example.com",
      mcpUrl: "https://lucy.example.com/mcp",
      baseUrl: "https://lucy.example.com",
      markerWikiKey: "shared/e2e-instance-marker"
    },
    candidate: {
      imageDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    },
    ...overrides,
    instance: {
      ...{ startedBy: "external", host: "lucy.example.com", mcpUrl: "https://lucy.example.com/mcp", baseUrl: "https://lucy.example.com", markerWikiKey: "shared/e2e-instance-marker" },
      ...(overrides.instance ?? {})
    }
  };
}

function writeDeployment(dir, payload) {
  mkdirSync(path.join(dir, "results"), { recursive: true });
  writeFileSync(path.join(dir, "results", "deployment.json"), JSON.stringify(payload));
}

describe("target-identity: assertSameRegisteredOrigin", () => {
  it("accepts the registered URL exactly as written", () => {
    const reg = new URL("https://lucy.example.com/mcp");
    const result = assertSameRegisteredOrigin({ registered: reg, actual: reg });
    assert.equal(result.ok, true);
    assert.deepEqual(result.problems, []);
  });

  it("rejects a different host", () => {
    const reg = new URL("https://lucy.example.com/mcp");
    const wrong = new URL("https://attacker.example.com/mcp");
    const result = assertSameRegisteredOrigin({ registered: reg, actual: wrong });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /host attacker/);
  });

  it("rejects a different scheme", () => {
    const reg = new URL("https://lucy.example.com/mcp");
    const wrong = new URL("http://lucy.example.com/mcp");
    const result = assertSameRegisteredOrigin({ registered: reg, actual: wrong });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /protocol http/);
  });

  it("accepts a different pathname (pathname is part of the resource, not the origin)", () => {
    const reg = new URL("https://lucy.example.com");
    const resource = new URL("https://lucy.example.com/mcp");
    const result = assertSameRegisteredOrigin({ registered: reg, actual: resource });
    assert.equal(result.ok, true);
  });

  it("rejects credentials in either URL", () => {
    const reg = new URL("https://user:pass@lucy.example.com/mcp");
    const wrong = new URL("https://lucy.example.com/mcp");
    const result = assertSameRegisteredOrigin({ registered: reg, actual: wrong });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /registered URL carries credentials/);
  });

  it("rejects non-http(s) schemes outright", () => {
    const reg = new URL("ftp://lucy.example.com/mcp");
    const wrong = new URL("ftp://lucy.example.com/mcp");
    const result = assertSameRegisteredOrigin({ registered: reg, actual: wrong });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /scheme/);
  });

  it("rejects an undefined actual URL (call did not produce a resolved URL)", () => {
    const result = assertSameRegisteredOrigin({ registered: new URL("https://x"), actual: undefined });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /target URL is missing/);
  });

  it("enforces a search/query on the actual URL when the registered URL carries one (assertSameRegisteredEndpoint)", () => {
    const reg = new URL("https://lucy.example.com/mcp?trace=1");
    const same = new URL("https://lucy.example.com/mcp?trace=1");
    const mismatch = new URL("https://lucy.example.com/mcp?other=1");
    assert.equal(assertSameRegisteredEndpoint({ registered: reg, actual: same }).ok, true);
    const bad = assertSameRegisteredEndpoint({ registered: reg, actual: mismatch });
    assert.equal(bad.ok, false);
    assert.match(bad.problems.join(" "), /search/);
  });

  it("assertSameRegisteredEndpoint catches pathname drift when assertSameRegisteredOrigin would not", () => {
    const reg = new URL("https://lucy.example.com/lucy-v2/mcp");
    const wrong = new URL("https://lucy.example.com/mcp");
    assert.equal(assertSameRegisteredOrigin({ registered: reg, actual: wrong }).ok, true, "origin-only check passes for same authority");
    const endpoint = assertSameRegisteredEndpoint({ registered: reg, actual: wrong });
    assert.equal(endpoint.ok, false);
    assert.match(endpoint.problems.join(" "), /pathname \/mcp != registered pathname \/lucy-v2\/mcp/);
  });

  it("rejects a backslash in either URL", () => {
    const result = assertSameRegisteredOrigin({ registered: "https://lucy.example.com/mcp", actual: "https:/\\\\attacker.example.com/mcp" });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /backslash/);
  });
});

describe("target-identity: isSuspiciousUrlString", () => {
  it("flags any scheme-prefixed URL, scheme-relative, and userinfo", () => {
    assert.equal(isSuspiciousUrlString("http://x"), true);
    assert.equal(isSuspiciousUrlString("https://x"), true);
    assert.equal(isSuspiciousUrlString("javascript:alert(1)"), true);
    assert.equal(isSuspiciousUrlString("file:///etc/passwd"), true);
    assert.equal(isSuspiciousUrlString("//other.example.com/x"), true);
    assert.equal(isSuspiciousUrlString("user@host"), true);
  });

  it("accepts plain pathnames", () => {
    assert.equal(isSuspiciousUrlString("/mcp"), false);
    assert.equal(isSuspiciousUrlString("mcp/foo"), false);
    assert.equal(isSuspiciousUrlString(""), false);
  });
});

describe("target-identity: verifyHealth (real response shape, fail closed on missing fields)", () => {
  it("accepts /api/health with ready KTX, healthy policy, ok status, ok execution", async () => {
    const fetchUrl = scriptFetch([{
      status: 200,
      json: { data: { status: "ok", ktxRuntime: { ready: true }, policy: { healthy: true }, execution: { status: "ok" }, lucyVersion: "0.17.0" } },
      text: "",
      headers: {}
    }]);
    const result = await verifyHealth({ fetchUrl, baseUrl: new URL("https://lucy.example.com") });
    assert.equal(result.ok, true, result.problems.join("; "));
    assert.equal(result.detail.lucyVersion, "0.17.0");
  });

  it("rejects when status field is missing (no silent default)", async () => {
    const fetchUrl = scriptFetch([{
      status: 200,
      json: { data: { ktxRuntime: { ready: true }, policy: { healthy: true }, execution: { status: "ok" } } },
      text: "",
      headers: {}
    }]);
    const result = await verifyHealth({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /missing the 'status' field/);
  });

  it("rejects when ktxRuntime.ready is missing (not silently defaulted)", async () => {
    const fetchUrl = scriptFetch([{
      status: 200,
      json: { data: { status: "ok", ktxRuntime: {}, policy: { healthy: true }, execution: { status: "ok" } } },
      text: "",
      headers: {}
    }]);
    const result = await verifyHealth({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /missing the 'ktxRuntime\.ready'/);
  });

  it("rejects when policy.healthy is missing", async () => {
    const fetchUrl = scriptFetch([{
      status: 200,
      json: { data: { status: "ok", ktxRuntime: { ready: true }, policy: {}, execution: { status: "ok" } } },
      text: "",
      headers: {}
    }]);
    const result = await verifyHealth({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /missing the 'policy\.healthy'/);
  });

  it("rejects when execution.status is missing", async () => {
    const fetchUrl = scriptFetch([{
      status: 200,
      json: { data: { status: "ok", ktxRuntime: { ready: true }, policy: { healthy: true }, execution: {} } },
      text: "",
      headers: {}
    }]);
    const result = await verifyHealth({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /missing the 'execution\.status'/);
  });

  it("rejects a degraded KTX runtime", async () => {
    const fetchUrl = scriptFetch([{
      status: 200,
      json: { data: { status: "degraded", ktxRuntime: { ready: false }, policy: { healthy: true }, execution: { status: "ok" } } },
      text: "",
      headers: {}
    }]);
    const result = await verifyHealth({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /KTX runtime is not ready/);
    assert.match(result.problems.join(" "), /degraded/);
  });

  it("rejects an unhealthy policy runtime", async () => {
    const fetchUrl = scriptFetch([{
      status: 200,
      json: { data: { status: "ok", ktxRuntime: { ready: true }, policy: { healthy: false }, execution: { status: "ok" } } },
      text: "",
      headers: {}
    }]);
    const result = await verifyHealth({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /policy runtime reports unhealthy/);
  });

  it("rejects stale/unavailable/error execution", async () => {
    for (const status of ["stale", "unavailable", "error"]) {
      const fetchUrl = scriptFetch([{
        status: 200,
        json: { data: { status: "ok", ktxRuntime: { ready: true }, policy: { healthy: true }, execution: { status } } },
        text: "",
        headers: {}
      }]);
      const result = await verifyHealth({ fetchUrl, baseUrl: new URL("https://x") });
      assert.equal(result.ok, false, `status=${status}`);
      assert.match(result.problems.join(" "), new RegExp(`execution runtime status is "${status}"`));
    }
  });

  it("rejects an unreachable health endpoint", async () => {
    const fetchUrl = async () => { throw new Error("ETIMEDOUT"); };
    const result = await verifyHealth({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /ETIMEDOUT/);
  });

  it("rejects when the resolved URL escapes the registered origin", async () => {
    const fetchUrl = scriptFetch([{
      status: 200,
      json: { data: { status: "ok", ktxRuntime: { ready: true }, policy: { healthy: true }, execution: { status: "ok" } } },
      text: "",
      headers: {},
      resolvedUrl: "https://attacker.example.com/api/health"
    }]);
    const result = await verifyHealth({ fetchUrl, baseUrl: new URL("https://lucy.example.com") });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /host attacker/);
  });

  it("does not invent a digest from /api/health (the field is not in the actual contract)", async () => {
    const fetchUrl = scriptFetch([{
      status: 200,
      json: { data: { status: "ok", ktxRuntime: { ready: true }, policy: { healthy: true }, execution: { status: "ok" } } },
      text: "",
      headers: {}
    }]);
    const result = await verifyHealth({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.detail.imageDigest ?? null, null);
    assert.equal(result.detail.deployedImageDigest ?? null, null);
  });
});

describe("target-identity: verifyAuthMode", () => {
  it("accepts a required + authEnabled response", async () => {
    const fetchUrl = scriptFetch([{ status: 200, json: { data: { mode: "required", authEnabled: true } }, text: "", headers: {} }]);
    const result = await verifyAuthMode({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, true);
    assert.equal(result.detail.mode, "required");
  });

  it("rejects when mode field is missing (no silent default)", async () => {
    const fetchUrl = scriptFetch([{ status: 200, json: { data: { authEnabled: true } }, text: "", headers: {} }]);
    const result = await verifyAuthMode({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /mode is missing or unknown/);
  });

  it("rejects when mode is an unknown string ('banana')", async () => {
    const fetchUrl = scriptFetch([{ status: 200, json: { data: { mode: "banana", authEnabled: true } }, text: "", headers: {} }]);
    const result = await verifyAuthMode({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /mode is missing or unknown/);
  });

  it("rejects when authEnabled is missing (no silent default)", async () => {
    const fetchUrl = scriptFetch([{ status: 200, json: { data: { mode: "required" } }, text: "", headers: {} }]);
    const result = await verifyAuthMode({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /missing the 'authEnabled'/);
  });

  it("rejects an `open` auth mode (release must enforce auth)", async () => {
    const fetchUrl = scriptFetch([{ status: 200, json: { data: { mode: "open", authEnabled: false } }, text: "", headers: {} }]);
    const result = await verifyAuthMode({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /auth mode is 'open'/);
  });

  it("rejects an `unavailable` auth config", async () => {
    const fetchUrl = scriptFetch([{ status: 200, json: { data: { mode: "unavailable", authEnabled: true } }, text: "", headers: {} }]);
    const result = await verifyAuthMode({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /auth config is 'unavailable'/);
  });

  it("accepts a bootstrap response (preflight does not consume the token)", async () => {
    const fetchUrl = scriptFetch([{ status: 200, json: { data: { mode: "bootstrap", authEnabled: true } }, text: "", headers: {} }]);
    const result = await verifyAuthMode({ fetchUrl, baseUrl: new URL("https://x") });
    assert.equal(result.ok, true);
    assert.equal(result.detail.mode, "bootstrap");
  });
});

describe("target-identity: deployment evidence + candidate fingerprint", () => {
  it("returns missing_measurement when results/deployment.json does not exist", () => {
    const run = makeRun();
    const result = verifyCandidateFingerprintFromDeployment({ run });
    assert.equal(result.ok, false);
    assert.equal(result.classification, "missing_measurement");
    assert.match(result.problems.join(" "), /deployment evidence not found/);
  });

  it("rejects when the candidate imageDigest is missing on a release run", () => {
    const run = makeRun({ candidate: { imageDigest: null } });
    const result = verifyCandidateFingerprintFromDeployment({ run });
    assert.equal(result.ok, false);
    assert.equal(result.classification, "missing_measurement");
    assert.match(result.problems.join(" "), /run.candidate.imageDigest is missing/);
  });

  it("rejects a deployment.json with the wrong contract", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-dep-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    writeDeployment(dir, { contract: "wrong" });
    const run = makeRun({ runDir: dir });
    const result = verifyCandidateFingerprintFromDeployment({ run });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /contract is "wrong"/);
  });

  it("rejects a deployment.json missing the logical instance id (the run is the producer)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-dep-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    writeDeployment(dir, { contract: "lucy-deployment-v1", instanceId: "uid-1", deployedImageDigest: "sha256:any", topology: "single-replica-k8s" });
    const run = makeRun({ runDir: dir });
    const result = verifyCandidateFingerprintFromDeployment({ run });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /missing logicalInstanceId/);
  });

  it("rejects a deployment.json whose logical id disagrees with run.instanceId", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-dep-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    writeDeployment(dir, { contract: "lucy-deployment-v1", instanceId: "uid-1", logicalInstanceId: "forged", deployedImageDigest: "sha256:any", topology: "single-replica-k8s" });
    const run = makeRun({ runDir: dir });
    const result = verifyCandidateFingerprintFromDeployment({ run });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /forged != /);
  });

  it("rejects a deployment.json with a non single-replica topology", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-dep-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const run = makeRun({ runDir: dir });
    writeDeployment(dir, { contract: "lucy-deployment-v1", instanceId: "uid-1", logicalInstanceId: run.instanceId, deployedImageDigest: "sha256:any", topology: "ha-3-replica" });
    const result = verifyCandidateFingerprintFromDeployment({ run });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /topology is "ha-3-replica"/);
  });

  it("rejects a deployment.json with a mismatched deployedImageDigest", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-dep-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const run = makeRun({ runDir: dir });
    writeDeployment(dir, { contract: "lucy-deployment-v1", instanceId: "uid-1", logicalInstanceId: run.instanceId, deployedImageDigest: "sha256:other", topology: "single-replica-k8s" });
    const result = verifyCandidateFingerprintFromDeployment({ run });
    assert.equal(result.ok, false);
    assert.equal(result.classification, "refused");
    assert.match(result.problems.join(" "), /measured digest sha256:other != candidate/);
  });

  it("accepts a deployment.json with the matching digest AND matching logical id", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-dep-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const run = makeRun({ runDir: dir });
    writeDeployment(dir, { contract: "lucy-deployment-v1", instanceId: "uid-1", logicalInstanceId: run.instanceId, deployedImageDigest: run.candidate.imageDigest, topology: "single-replica-k8s" });
    const result = verifyCandidateFingerprintFromDeployment({ run });
    assert.equal(result.ok, true);
    assert.equal(result.classification, "ok");
    assert.equal(result.detail.instanceId, "uid-1");
    assert.equal(result.detail.logicalInstanceId, run.instanceId);
  });

  it("loadDeploymentEvidence parses the file the K8s deploy step writes", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-dep-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const run = makeRun({ runDir: dir });
    writeDeployment(dir, { contract: "lucy-deployment-v1", instanceId: "uid-x", logicalInstanceId: run.instanceId, deployedImageDigest: "sha256:abc", topology: "single-replica-k8s" });
    const loaded = loadDeploymentEvidence(run);
    assert.equal(loaded.found, true);
    assert.equal(loaded.deployment.instanceId, "uid-x");
    assert.equal(loaded.deployment.logicalInstanceId, run.instanceId);
  });
});

describe("target-identity: preflightVerify (public, no auth)", () => {
  it("runs health, auth/status, and candidate fingerprint without consuming the bootstrap", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-pre-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const run = makeRun({ runDir: dir });
    writeDeployment(dir, { contract: "lucy-deployment-v1", instanceId: "uid-1", logicalInstanceId: run.instanceId, deployedImageDigest: run.candidate.imageDigest, topology: "single-replica-k8s" });
    const fetchUrl = scriptFetch([
      { status: 200, json: { data: { status: "ok", ktxRuntime: { ready: true }, policy: { healthy: true }, execution: { status: "ok" } } }, text: "", headers: {} }, // health
      { status: 200, json: { data: { mode: "required", authEnabled: true } }, text: "", headers: {} } // auth/status
    ]);
    const result = await preflightVerify({ run, fetchUrl });
    assert.equal(result.ok, true, result.problems.join("; "));
    assert.equal(result.aspects.health.ok, true);
    assert.equal(result.aspects.authMode.ok, true);
    assert.equal(result.aspects.candidateFingerprint.ok, true);
    assert.equal(result.registered.webHost, "lucy.example.com");
    assert.equal(result.registered.mcpPathname, "/mcp");
    assert.equal(result.classification, "ok");
  });

  it("rejects a non-external run before issuing any HTTP request", async () => {
    const run = makeRun({ instance: { ...makeRun().instance, startedBy: "runner" } });
    const fetchUrl = scriptFetch([]);
    const result = await preflightVerify({ run, fetchUrl });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /startedBy is "runner"/);
    assert.equal(fetchUrl.calls.length, 0);
  });

  it("rejects credentials in the registered URL", async () => {
    const run = makeRun({ instance: { ...makeRun().instance, baseUrl: "https://user:token@lucy.example.com" } });
    const result = await preflightVerify({ run, fetchUrl: scriptFetch([]) });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /carries credentials/);
  });

  it("preserves missing_measurement classification when deployment.json is absent", async () => {
    const run = makeRun();
    const fetchUrl = scriptFetch([
      { status: 200, json: { data: { status: "ok", ktxRuntime: { ready: true }, policy: { healthy: true }, execution: { status: "ok" } } }, text: "", headers: {} },
      { status: 200, json: { data: { mode: "required", authEnabled: true } }, text: "", headers: {} }
    ]);
    const result = await preflightVerify({ run, fetchUrl });
    assert.equal(result.ok, false);
    assert.equal(result.classification, "missing_measurement");
    assert.equal(result.aspects.candidateFingerprint.classification, "missing_measurement");
  });

  it("rejects when the resolved URL escapes the registered origin (real fetch, no self-comparison)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-pre-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const run = makeRun({ runDir: dir });
    writeDeployment(dir, { contract: "lucy-deployment-v1", instanceId: "uid-1", logicalInstanceId: run.instanceId, deployedImageDigest: run.candidate.imageDigest, topology: "single-replica-k8s" });
    const fetchUrl = scriptFetch([
      { status: 200, json: { data: { status: "ok", ktxRuntime: { ready: true }, policy: { healthy: true }, execution: { status: "ok" } } }, text: "", headers: {}, resolvedUrl: "https://attacker.example.com/api/health" }
    ]);
    const result = await preflightVerify({ run, fetchUrl });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /host attacker/);
  });
});

describe("target-identity: postflightVerify (authenticated, marker read)", () => {
  it("logs in, reads the marker, and accepts when run= / fixture= / instance= are all present", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-post-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const secretsDir = path.join(dir, "checker", "secrets");
    mkdirSync(secretsDir, { recursive: true });
    writeFileSync(path.join(secretsDir, "bootstrap-token"), "bt");
    writeFileSync(path.join(secretsDir, "admins.json"), JSON.stringify({ owner: { adminId: "o", password: "p" } }));
    const run = makeRun({ runDir: dir, secretsDir });
    const fetchUrl = scriptFetch([
      { status: 200, json: { data: { mode: "required", authEnabled: true } }, text: "", headers: {} }, // login status
      { status: 200, json: { data: { me: { id: "o" } } }, headers: { "set-cookie": ["lucy_sess=xyz"] }, text: "" }, // login
      { status: 200, json: { data: { content: `run=${run.runId} fixture=${run.fixtureDigest} instance=${run.instanceId}` } }, text: "", headers: {} } // marker
    ]);
    const result = await postflightVerify({ run, fetchUrl });
    assert.equal(result.ok, true, result.problems.join("; "));
    assert.equal(result.aspects.ownerLogin.ok, true);
    assert.equal(result.aspects.markerRead.ok, true);
    assert.equal(result.classification, "ok");
  });

  it("rejects a marker that does not carry the run id (no fabricated match)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-post-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const secretsDir = path.join(dir, "checker", "secrets");
    mkdirSync(secretsDir, { recursive: true });
    writeFileSync(path.join(secretsDir, "bootstrap-token"), "bt");
    writeFileSync(path.join(secretsDir, "admins.json"), JSON.stringify({ owner: { adminId: "o", password: "p" } }));
    const run = makeRun({ runDir: dir, secretsDir });
    const fetchUrl = scriptFetch([
      { status: 200, json: { data: { mode: "required", authEnabled: true } }, text: "", headers: {} },
      { status: 200, json: { data: { me: { id: "o" } } }, headers: { "set-cookie": ["lucy_sess=xyz"] }, text: "" },
      { status: 200, json: { data: { content: "different content" } }, text: "", headers: {} }
    ]);
    const result = await postflightVerify({ run, fetchUrl });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(" "), /does not contain this run's id/);
  });

  it("fails when owner login fails (no marker read attempted)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-post-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const secretsDir = path.join(dir, "checker", "secrets");
    mkdirSync(secretsDir, { recursive: true });
    writeFileSync(path.join(secretsDir, "bootstrap-token"), "bt");
    writeFileSync(path.join(secretsDir, "admins.json"), JSON.stringify({ owner: { adminId: "o", password: "p" } }));
    const run = makeRun({ runDir: dir, secretsDir });
    const fetchUrl = scriptFetch([
      { status: 200, json: { data: { mode: "required", authEnabled: true } }, text: "", headers: {} },
      { status: 401, json: null, text: "", headers: {} }
    ]);
    const result = await postflightVerify({ run, fetchUrl });
    assert.equal(result.ok, false);
    assert.equal(result.aspects.ownerLogin.ok, false);
    assert.equal(fetchUrl.calls.length, 2);
  });

  it("returns needs-bootstrap classification (and never POSTs to /api/auth/bootstrap) when target is in bootstrap mode", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-post-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const secretsDir = path.join(dir, "checker", "secrets");
    mkdirSync(secretsDir, { recursive: true });
    writeFileSync(path.join(secretsDir, "bootstrap-token"), "bt");
    writeFileSync(path.join(secretsDir, "admins.json"), JSON.stringify({ owner: { adminId: "o", password: "p" } }));
    const run = makeRun({ runDir: dir, secretsDir });
    const fetchUrl = scriptFetch([
      { status: 200, json: { data: { mode: "bootstrap", authEnabled: true } }, text: "", headers: {} } // status only
    ]);
    const result = await postflightVerify({ run, fetchUrl });
    assert.equal(result.ok, false);
    assert.equal(result.classification, "missing_measurement");
    assert.equal(result.aspects.ownerLogin.classification, "missing_measurement");
    // Zero POST bootstrap: only one GET against /api/auth/status
    assert.equal(fetchUrl.calls.length, 1);
    assert.match(fetchUrl.calls[0].url, /\/api\/auth\/status$/);
    assert.notEqual(fetchUrl.calls[0].method, "POST");
  });

  it("regression: preflightVerify NEVER issues any POST (no auto-bootstrap in the public phase)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-pre-no-post-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const run = makeRun({ runDir: dir });
    writeDeployment(dir, { contract: "lucy-deployment-v1", instanceId: "uid-1", logicalInstanceId: run.instanceId, deployedImageDigest: run.candidate.imageDigest, topology: "single-replica-k8s" });
    const fetchUrl = scriptFetch([
      { status: 200, json: { data: { status: "ok", ktxRuntime: { ready: true }, policy: { healthy: true }, execution: { status: "ok" } } }, text: "", headers: {} },
      { status: 200, json: { data: { mode: "bootstrap", authEnabled: true } }, text: "", headers: {} }
    ]);
    await preflightVerify({ run, fetchUrl });
    for (const call of fetchUrl.calls) {
      assert.notEqual(call.method, "POST", `preflight must not POST; got ${call.method} ${call.url}`);
    }
  });

  it("regression: postflightVerify in 'required' mode never POSTs to /api/auth/bootstrap (only to /api/auth/login)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-post-no-bootstrap-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const secretsDir = path.join(dir, "checker", "secrets");
    mkdirSync(secretsDir, { recursive: true });
    writeFileSync(path.join(secretsDir, "bootstrap-token"), "bt");
    writeFileSync(path.join(secretsDir, "admins.json"), JSON.stringify({ owner: { adminId: "o", password: "p" } }));
    const run = makeRun({ runDir: dir, secretsDir });
    const fetchUrl = scriptFetch([
      { status: 200, json: { data: { mode: "required", authEnabled: true } }, text: "", headers: {} },
      { status: 200, json: { data: { me: { id: "o" } } }, headers: { "set-cookie": ["lucy_sess=xyz"] }, text: "" },
      { status: 200, json: { data: { content: `run=${run.runId} fixture=${run.fixtureDigest} instance=${run.instanceId}` } }, text: "", headers: {} }
    ]);
    await postflightVerify({ run, fetchUrl });
    for (const call of fetchUrl.calls) {
      if (call.method === "POST") {
        assert.match(call.url, /\/api\/auth\/login$/, `postflight must only POST to /api/auth/login, not to ${call.url}`);
      }
    }
  });
});

describe("target-identity: TargetIdentityError classification", () => {
  it("carries the failing stage, every problem, the per-aspect verdict, and the top-level classification", () => {
    const aspects = {
      health: { ok: false, problems: ["KTX runtime is not ready"] },
      authMode: { ok: true, problems: [] },
      candidateFingerprint: { ok: false, classification: "missing_measurement", problems: ["deployment evidence not found"] }
    };
    const err = new TargetIdentityError({ stage: "preflight", problems: ["KTX runtime is not ready", "deployment evidence not found"], aspects, classification: "missing_measurement" });
    assert.equal(err.stage, "preflight");
    assert.equal(err.classification, "missing_measurement");
    assert.equal(err.aspects.candidateFingerprint.classification, "missing_measurement");
    assert.match(err.message, /preflight/);
    assert.match(err.message, /KTX runtime is not ready/);
  });
});

describe("target-identity: reconcileExternalFlag", () => {
  it("rejects --external against a local run", () => {
    const r = reconcileExternalFlag({ run: { instance: { startedBy: "runner" } }, flagValue: true });
    assert.equal(r.ok, false);
  });

  it("rejects omitting --external against a registered external run", () => {
    const r = reconcileExternalFlag({ run: { instance: { startedBy: "external" } }, flagValue: false });
    assert.equal(r.ok, false);
  });

  it("accepts consistent flag/run pairs", () => {
    assert.equal(reconcileExternalFlag({ run: { instance: { startedBy: "external" } }, flagValue: true }).ok, true);
    assert.equal(reconcileExternalFlag({ run: { instance: { startedBy: "runner" } }, flagValue: false }).ok, true);
  });

  it("treats a missing startedBy as 'must not pass --external'", () => {
    const r = reconcileExternalFlag({ run: { instance: {} }, flagValue: true });
    assert.equal(r.ok, false);
  });
});

describe("target-identity: defaultFetchUrl against a real loopback HTTP server", () => {
  let server;
  let baseUrl;
  let observedOrigins = [];
  let observedLoginCookies = [];
  let observedPostflightPaths = [];
  before(async () => {
    await new Promise((resolve) => {
      server = createServer((req, res) => {
        observedOrigins.push(req.headers.host ?? "");
        if (req.url === "/api/auth/status") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ data: { mode: "required", authEnabled: true } }));
        } else if (req.url === "/api/auth/login" && req.method === "POST") {
          observedLoginCookies.push(req.headers.cookie ?? "");
          res.writeHead(200, {
            "content-type": "application/json",
            "set-cookie": ["lucy_sess=loopback-xyz; Path=/; HttpOnly", "other=1"]
          });
          res.end(JSON.stringify({ data: { me: { id: "loopback" } } }));
        } else if (req.url === "/api/wiki/shared%2Fe2e-instance-marker") {
          observedPostflightPaths.push({ url: req.url, cookie: req.headers.cookie ?? "" });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ data: { content: "run=loopback-run fixture=sha256:abc instance=logical-x" } }));
        } else {
          res.writeHead(404);
          res.end("nope");
        }
      });
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });
  after((done) => { server.close(done); });

  it("real Set-Cookie flows through defaultFetchUrl.cookie (not invented)", async () => {
    const res = await defaultFetchUrl(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { adminId: "x", password: "y" }
    });
    assert.equal(res.status, 200);
    assert.equal(res.cookie, "lucy_sess=loopback-xyz");
    assert.deepEqual(res.setCookies, ["lucy_sess=loopback-xyz; Path=/; HttpOnly", "other=1"]);
  });

  it("real /api/auth/status + /api/auth/login + /api/wiki/<key> round-trip through postflight with zero POSTs to /api/auth/bootstrap", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-loopback-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const secretsDir = path.join(dir, "checker", "secrets");
    mkdirSync(secretsDir, { recursive: true });
    writeFileSync(path.join(secretsDir, "bootstrap-token"), "bt");
    writeFileSync(path.join(secretsDir, "admins.json"), JSON.stringify({ owner: { adminId: "o", password: "p" } }));
    writeDeployment(dir, { contract: "lucy-deployment-v1", instanceId: "uid-loopback", logicalInstanceId: "logical-x", deployedImageDigest: "sha256:any", topology: "single-replica-k8s" });
    const run = {
      runId: "loopback-run",
      instanceId: "logical-x",
      fixtureDigest: "sha256:abc",
      candidate: { imageDigest: "sha256:any" },
      paths: { runDir: dir },
      secretsDir,
      instance: { startedBy: "external", baseUrl, mcpUrl: `${baseUrl}/mcp`, markerWikiKey: "shared/e2e-instance-marker" }
    };
    observedLoginCookies.length = 0;
    observedPostflightPaths.length = 0;
    const post = await postflightVerify({ run, fetchUrl: defaultFetchUrl });
    assert.equal(post.ok, true, post.problems.join("; "));
    assert.ok(observedOrigins.some((host) => host.startsWith("127.0.0.1")));
    assert.equal(observedLoginCookies.length, 1, "exactly one POST to /api/auth/login (no auto-bootstrap)");
    assert.equal(observedLoginCookies[0], "", "login request itself did not carry a stale cookie");
    assert.equal(observedPostflightPaths.length, 1);
    assert.equal(observedPostflightPaths[0].url, "/api/wiki/shared%2Fe2e-instance-marker");
    assert.equal(observedPostflightPaths[0].cookie, "lucy_sess=loopback-xyz");
  });
});
