import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { bindEvidence, collectServerEvidence, tokenFingerprintOf, writeServerEvidenceFile } from "../collect-server-evidence.mjs";

const TOKEN = "lucy_e2e_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const fp = tokenFingerprintOf(TOKEN);
const since = "2026-10-18T10:00:00.000Z";
const until = "2026-10-18T10:01:00.000Z";
const entry = (over = {}) => ({ id: 1, ts: "2026-10-18T10:00:30.000Z", userId: "e2e_finance", tokenHashPrefix: `sha256:${fp}`, tool: "lucy_query", outcome: "ok", traceId: "trace_x", policyVersion: "pv1", roleIds: ["finance_reader"], decisionReason: "allowed", ...over });

describe("server evidence binding (Spec §6.4, §8.1)", () => {
  it("binds entries made with this Token and agent inside the window, with trace and policy version", () => {
    const bound = bindEvidence({ entries: [entry(), entry({ id: 2, tool: "wiki_read", traceId: "trace_y" })], agentId: "e2e_finance", tokenFingerprint: fp, since, until, upstreamExecutionCount: 0 });
    assert.deepEqual(bound.bindingProblems, []);
    assert.deepEqual(bound.traceIds.sort(), ["trace_x", "trace_y"]);
    assert.deepEqual(bound.queryEventIds, ["1"]);
    assert.equal(bound.policyVersion, "pv1");
    assert.deepEqual(bound.roleIds, ["finance_reader"]);
  });

  it("ignores events outside the window (old windows cannot satisfy a new case)", () => {
    const stale = entry({ id: 9, ts: "2026-10-18T09:00:00.000Z" });
    const bound = bindEvidence({ entries: [stale], agentId: "e2e_finance", tokenFingerprint: fp, since, until, upstreamExecutionCount: 0 });
    assert.deepEqual(bound.events, []);
    assert.deepEqual(bound.traceIds, []);
  });

  it("reports another Token's or another agent's events inside the window instead of counting them", () => {
    const foreignToken = entry({ id: 3, tokenHashPrefix: "sha256:ffffffffffff" });
    const foreignAgent = entry({ id: 4, userId: "e2e_sales" });
    const bound = bindEvidence({ entries: [foreignToken, foreignAgent], agentId: "e2e_finance", tokenFingerprint: fp, since, until, upstreamExecutionCount: 0 });
    assert.equal(bound.events.length, 0);
    assert.equal(bound.traceIds.length, 0);
    assert.equal(bound.bindingProblems.length, 2);
    assert.match(bound.bindingProblems.join(" "), /another|not/);
  });

  it("a request id is not a trace: entries without a server trace id yield no traceIds and a problem", () => {
    const noTrace = entry({ traceId: null, requestId: "1" });
    const bound = bindEvidence({ entries: [noTrace], agentId: "e2e_finance", tokenFingerprint: fp, since, until, upstreamExecutionCount: 0 });
    assert.deepEqual(bound.traceIds, []);
    assert.ok(bound.bindingProblems.some((p) => /no server trace id/.test(p)));
    const fake = bindEvidence({ entries: [entry({ traceId: "req-1" })], agentId: "e2e_finance", tokenFingerprint: fp, since, until, upstreamExecutionCount: 0 });
    assert.deepEqual(fake.traceIds, [], "only ids with the server trace_ form count");
  });

  it("flags a policy change inside the case window", () => {
    const bound = bindEvidence({ entries: [entry(), entry({ id: 2, policyVersion: "pv2" })], agentId: "e2e_finance", tokenFingerprint: fp, since, until, upstreamExecutionCount: 0 });
    assert.ok(bound.bindingProblems.some((p) => /policy changed/.test(p)));
  });

  it("reads through the ledger reader only; an unreadable ledger is an error, never a fabricated trace", async () => {
    const broken = { entries: async () => { throw new Error("cannot read the server ledger: audit API -> HTTP 503"); }, contextPolicyVersion: async () => null };
    await assert.rejects(collectServerEvidence({ run: {}, agentId: "e2e_finance", tokenFingerprint: fp, since, until, reader: broken, upstreamExecutionCount: 0 }), /cannot read the server ledger/);
  });

  it("carries the context policy version from the matched Role and flags an incomplete projection", async () => {
    const reader = {
      entries: async () => ({ entries: [entry()], projection: { complete: false } }),
      contextPolicyVersion: async (roleId) => (roleId === "finance_reader" ? "ctx-v1" : null)
    };
    const evidence = await collectServerEvidence({ run: {}, agentId: "e2e_finance", tokenFingerprint: fp, since, until, reader, upstreamExecutionCount: 0 });
    assert.equal(evidence.contextPolicyVersion, "ctx-v1");
    assert.ok(evidence.bindingProblems.some((p) => /projection is incomplete/.test(p)));
  });

  it("writes a hashed per-run evidence file sourced from the instance ledger", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-se-"));
    try {
      const run = { runId: "run-test-0001", instanceId: "inst-1", paths: { runDir: dir } };
      const written = writeServerEvidenceFile(run, [{ caseId: "UX-02-V01" }]);
      const file = path.join(dir, written.path);
      assert.ok(existsSync(file));
      const body = readFileSync(file);
      assert.equal(written.sha256, createHash("sha256").update(body).digest("hex"));
      assert.equal(JSON.parse(body).source, "instance-ledger");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the Token fingerprint is the first 12 hex of its sha256 (what the ledger stores)", () => {
    assert.equal(fp, createHash("sha256").update(TOKEN).digest("hex").slice(0, 12));
  });

  // A4-strict: upstream tool execution count is an INDEPENDENT measurement, not a derivation from
  // audit ledger outcomes. The previous implementation silently used
  // `bound.filter(e => e.outcome === "unauthorized").length` and called it a real measured zero.
  // That is a fabricated zero: outcome is a verdict enum (ok/denied/error), not a raw count, and
  // the production provider does not emit an "unauthorized" outcome at all.
  it("[A4-strict RED] bindEvidence without an independent execution observation provider must leave upstreamUnauthorized undefined, even when bound entries are present", () => {
    const bound = bindEvidence({ entries: [entry()], agentId: "e2e_finance", tokenFingerprint: fp, since, until });
    assert.equal(bound.upstreamUnauthorized, undefined, "missing provider must NOT yield 0");
    assert.ok(bound.bindingProblems.some((p) => /upstream tool execution count was not provided/.test(p)), `must record the missing-provider binding problem; got ${JSON.stringify(bound.bindingProblems)}`);
  });
  it("[A4-strict RED] bindEvidence with entries[] of outcome: 'denied' still must NOT derive a count from the audit ledger", () => {
    const bound = bindEvidence({ entries: [entry({ outcome: "denied" })], agentId: "e2e_finance", tokenFingerprint: fp, since, until });
    assert.equal(bound.upstreamUnauthorized, undefined, "denied outcome is not a raw count; do not infer 0 from it");
    assert.equal(bound.deniedCount, 1, "deniedCount is the verdict count, separate from the upstream execution count");
    assert.ok(bound.bindingProblems.some((p) => /upstream tool execution count was not provided/.test(p)));
  });
  it("[A4-strict GREEN] bindEvidence with an explicit non-negative integer from a real provider yields that count", () => {
    const bound = bindEvidence({ entries: [entry()], agentId: "e2e_finance", tokenFingerprint: fp, since, until, upstreamExecutionCount: 0 });
    assert.equal(bound.upstreamUnauthorized, 0);
    assert.equal(bound.bindingProblems.length, 0, "real measured zero with a real provider is a clean measurement, not a binding problem");
  });
  it("[A4-strict RED] bindEvidence with a non-integer provider value (string/boolean/NaN) is rejected", () => {
    for (const bad of ["zero", true, false, NaN, -1, 1.5, null]) {
      const bound = bindEvidence({ entries: [entry()], agentId: "e2e_finance", tokenFingerprint: fp, since, until, upstreamExecutionCount: bad });
      assert.equal(bound.upstreamUnauthorized, undefined, `${JSON.stringify(bad)} must not pass through`);
      const problems = bound.bindingProblems.join(" ");
      assert.ok(/non-negative integer from a real provider|was not provided/.test(problems), `${JSON.stringify(bad)} must record a binding problem; got ${JSON.stringify(bound.bindingProblems)}`);
    }
  });
  it("[A4-strict RED] a measured upstreamUnauthorized: 1 (real provider) yields upstreamUnauthorized: 1 with no binding problem", () => {
    const bound = bindEvidence({ entries: [entry()], agentId: "e2e_finance", tokenFingerprint: fp, since, until, upstreamExecutionCount: 1 });
    assert.equal(bound.upstreamUnauthorized, 1, "real provider value flows through");
    assert.equal(bound.bindingProblems.length, 0);
  });
});
