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
    const bound = bindEvidence({ entries: [entry(), entry({ id: 2, tool: "wiki_read", traceId: "trace_y" })], agentId: "e2e_finance", tokenFingerprint: fp, since, until });
    assert.deepEqual(bound.bindingProblems, []);
    assert.deepEqual(bound.traceIds.sort(), ["trace_x", "trace_y"]);
    assert.deepEqual(bound.queryEventIds, ["1"]);
    assert.equal(bound.policyVersion, "pv1");
    assert.deepEqual(bound.roleIds, ["finance_reader"]);
  });

  it("ignores events outside the window (old windows cannot satisfy a new case)", () => {
    const stale = entry({ id: 9, ts: "2026-10-18T09:00:00.000Z" });
    const bound = bindEvidence({ entries: [stale], agentId: "e2e_finance", tokenFingerprint: fp, since, until });
    assert.deepEqual(bound.events, []);
    assert.deepEqual(bound.traceIds, []);
  });

  it("reports another Token's or another agent's events inside the window instead of counting them", () => {
    const foreignToken = entry({ id: 3, tokenHashPrefix: "sha256:ffffffffffff" });
    const foreignAgent = entry({ id: 4, userId: "e2e_sales" });
    const bound = bindEvidence({ entries: [foreignToken, foreignAgent], agentId: "e2e_finance", tokenFingerprint: fp, since, until });
    assert.equal(bound.events.length, 0);
    assert.equal(bound.traceIds.length, 0);
    assert.equal(bound.bindingProblems.length, 2);
    assert.match(bound.bindingProblems.join(" "), /another|not/);
  });

  it("a request id is not a trace: entries without a server trace id yield no traceIds and a problem", () => {
    const noTrace = entry({ traceId: null, requestId: "1" });
    const bound = bindEvidence({ entries: [noTrace], agentId: "e2e_finance", tokenFingerprint: fp, since, until });
    assert.deepEqual(bound.traceIds, []);
    assert.ok(bound.bindingProblems.some((p) => /no server trace id/.test(p)));
    const fake = bindEvidence({ entries: [entry({ traceId: "req-1" })], agentId: "e2e_finance", tokenFingerprint: fp, since, until });
    assert.deepEqual(fake.traceIds, [], "only ids with the server trace_ form count");
  });

  it("flags a policy change inside the case window", () => {
    const bound = bindEvidence({ entries: [entry(), entry({ id: 2, policyVersion: "pv2" })], agentId: "e2e_finance", tokenFingerprint: fp, since, until });
    assert.ok(bound.bindingProblems.some((p) => /policy changed/.test(p)));
  });

  it("reads through the ledger reader only; an unreadable ledger is an error, never a fabricated trace", async () => {
    const broken = { entries: async () => { throw new Error("cannot read the server ledger: audit API -> HTTP 503"); }, contextPolicyVersion: async () => null };
    await assert.rejects(collectServerEvidence({ run: {}, agentId: "e2e_finance", tokenFingerprint: fp, since, until, reader: broken }), /cannot read the server ledger/);
  });

  it("carries the context policy version from the matched Role and flags an incomplete projection", async () => {
    const reader = {
      entries: async () => ({ entries: [entry()], projection: { complete: false } }),
      contextPolicyVersion: async (roleId) => (roleId === "finance_reader" ? "ctx-v1" : null)
    };
    const evidence = await collectServerEvidence({ run: {}, agentId: "e2e_finance", tokenFingerprint: fp, since, until, reader });
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
});
