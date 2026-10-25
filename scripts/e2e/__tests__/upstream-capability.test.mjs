// The `ktx-upstream` capability must be PROVEN, never declared — and BOTH real
// legs that talk to the data plane must own the upstream they use.
//
// Why this is a contract and not a style rule: Lucy's MCP proxy forwards every
// data-plane call to a KTX upstream (LUCY_PROXY_UPSTREAM_HOST/PORT, default
// 127.0.0.1:7878). When nothing listens there, every query answers empty. That
// reads exactly like a product defect and is not one — it is a missing
// environment. The v0.25 round-3 attribution found six "failures" that were
// mostly this, in the management leg. The agent leg had the same shape and was
// not fixed at the time, so it is locked here for BOTH legs.
//
// What is locked here:
//   * `withProvenUpstream` grants the capability ONLY by proof (local run) or by
//     operator attestation (external run, where the upstream is in-cluster and
//     cannot be probed from here);
//   * a declaration in LUCY_REAL_E2E_CAPABILITIES never grants it on its own;
//   * each local leg starts its OWN upstream for its OWN project, points Lucy at
//     it, and stops it when the run ends.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO_ROOT } from "../lib/common.mjs";
import {
  UPSTREAM_CAPABILITY,
  declaredCapabilities,
  upstreamTarget,
  withProvenUpstream
} from "../lib/upstream-capability.mjs";

const read = (relative) => readFileSync(path.join(REPO_ROOT, relative), "utf8");

describe("upstream capability: the decision function", () => {
  it("reads the upstream target from the environment, with the product's defaults", () => {
    assert.deepEqual(upstreamTarget({}), { host: "127.0.0.1", port: 7878 });
    assert.deepEqual(upstreamTarget({ LUCY_PROXY_UPSTREAM_HOST: "10.0.0.1", LUCY_PROXY_UPSTREAM_PORT: "19000" }), {
      host: "10.0.0.1",
      port: 19000
    });
  });

  it("treats a nonsense port as no port at all (never a port 0 target)", () => {
    assert.equal(upstreamTarget({ LUCY_PROXY_UPSTREAM_PORT: "not-a-port" }).port, 0);
    assert.equal(upstreamTarget({ LUCY_PROXY_UPSTREAM_PORT: "0" }).port, 0);
  });

  it("reads the declared capabilities, ignoring blanks", () => {
    assert.deepEqual(declaredCapabilities({ LUCY_REAL_E2E_CAPABILITIES: "a, b ,,c" }), ["a", "b", "c"]);
    assert.deepEqual(declaredCapabilities({}), []);
  });

  it("grants the capability to a local run whose upstream really answered", () => {
    const caps = withProvenUpstream(new Set(["lucy-http"]), { upstreamOk: true });
    assert.ok(caps.has(UPSTREAM_CAPABILITY));
  });

  it("REFUSES to grant it to a local run whose upstream did not answer — even when it was declared", () => {
    const declared = new Set(["lucy-http", UPSTREAM_CAPABILITY]);
    const caps = withProvenUpstream(declared, { upstreamOk: false, env: { LUCY_REAL_E2E_CAPABILITIES: UPSTREAM_CAPABILITY } });
    assert.equal(caps.has(UPSTREAM_CAPABILITY), false, "a declaration must not survive an unproven upstream");
    assert.ok(caps.has("lucy-http"), "the other capabilities are unaffected");
  });

  it("accepts the operator's attestation only for an external run (the in-cluster upstream cannot be probed here)", () => {
    const env = { LUCY_REAL_E2E_CAPABILITIES: UPSTREAM_CAPABILITY };
    assert.ok(withProvenUpstream(new Set(["lucy-http"]), { external: true, env }).has(UPSTREAM_CAPABILITY));
    assert.equal(withProvenUpstream(new Set(["lucy-http"]), { external: true, env: {} }).has(UPSTREAM_CAPABILITY), false);
    // An external run without the attestation must not get it from the local proof path either.
    assert.equal(withProvenUpstream(new Set(["lucy-http"]), { external: true, env: {}, upstreamOk: true }).has(UPSTREAM_CAPABILITY), false);
  });
});

describe("upstream capability: every local leg owns its upstream", () => {
  for (const leg of ["run-management.mjs", "run-agent-journey.mjs", "run-security.mjs"]) {
    it(`${leg} starts its own upstream and points Lucy at it`, () => {
      const source = read(path.join("scripts", "e2e", leg));
      assert.match(source, /startKtxUpstream/, "the leg must start the upstream it uses");
      assert.match(source, /LUCY_PROXY_UPSTREAM_PORT/, "Lucy must be pointed at the upstream this run owns");
      assert.match(source, /upstream\?\.ok\)\s*await upstream\.stop\(\)/, "the upstream must be stopped with the run");
    });
  }

  it("the management leg grants the capability only through the shared decision function", () => {
    const source = read(path.join("scripts", "e2e", "run-management.mjs"));
    assert.match(source, /withProvenUpstream\(managementCapabilities\(run, env\)/);
    // No place may add the capability to a set by hand.
    assert.equal(/capabilities\.add\(\s*["'`]ktx-upstream["'`]\s*\)/.test(source), false);
  });

  it("the agent leg never puts the data-plane capability into its base set by hand", () => {
    const source = read(path.join("scripts", "e2e", "run-agent-journey.mjs"));
    assert.equal(/capabilities\.add\(\s*["'`]ktx-upstream["'`]\s*\)/.test(source), false);
    assert.equal(/add\(\s*UPSTREAM_CAPABILITY\s*\)/.test(source), false, "only withProvenUpstream may add it");
  });

  it("the security leg grants the capability from the upstream it owns, never from a host port probe", () => {
    const source = read(path.join("scripts", "e2e", "run-security.mjs"));
    // The old behaviour probed a host default port (7878) and handed the run whatever
    // answered there — somebody else's upstream at best, nothing at worst.
    assert.equal(/portOpen\(\s*["']127\.0\.0\.1["']/.test(source), false, "the leg must not probe a host default upstream port");
    assert.match(source, /"ktx-upstream":\s*external\s*\?\s*declared\.has\("ktx-upstream"\)\s*:\s*upstream\?\.ok\s*===\s*true/);
    assert.match(source, /detectCapabilities\(run, true, external, upstream\)/, "the capability decision must see the run's own upstream");
  });
});
