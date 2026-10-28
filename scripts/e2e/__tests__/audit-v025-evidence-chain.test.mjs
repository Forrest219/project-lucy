/**
 * L25-09 批 D · Stage 1 证据链自检。
 *
 * 目的（计划 §4.4「Stage 1 准备」）：
 *  验证「AUD25 / ARV25 的 passed 结果能被 `verify-evidence.mjs` 采信」这条链路
 *  **本身是通的** —— 也就是断点 §1.3 被真正堵上，而不只是文档上声称堵上了。
 *
 * 链路（逐段可查）：
 *   冻结 catalog（required ids）
 *     → expectedExecutions() 分母
 *     → runner 结果（results/*.json 的 cases）
 *     → assembleEvidence() 装配
 *     → evidence.cases
 *     → verify-evidence.mjs 的 passedIds
 *     → 台账 verifiedBy 不再被判 finding_not_verified
 *
 * 本测试**不**证明任何场景真的通过了 —— 它只证明**通道**是通的。
 * 场景是否真的通过，必须由真实 runner 的真实结果回答；没有真实结果就记
 * blocked / not_run，不在这里伪造。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assembleEvidence } from "../lib/assemble.mjs";
import { expectedExecutions, loadCatalog, readLock } from "../lib/catalog.mjs";
import { loadVerifyInputs } from "../verify-evidence.mjs";

const AUDIT_IDS = [
  ...Array.from({ length: 12 }, (_, i) => `AUD25-A${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 12 }, (_, i) => `ARV25-V${String(i + 1).padStart(2, "0")}`)
];

const inputs = loadVerifyInputs();
const { cases } = loadCatalog();
const byId = new Map(cases.map((c) => [c.id, c]));

function minimalRun() {
  return {
    runId: "run-audit-chain",
    instanceId: "inst-audit-chain",
    executionMode: "local",
    paths: { runDir: "/tmp/lucy-audit-chain" },
    startedAt: "2026-10-28T00:00:00.000Z",
    finishedAt: "2026-10-28T00:30:00.000Z",
    caseCatalogDigest: inputs.catalogDigest,
    profileDigest: inputs.profileDigest
  };
}

function candidateBlock() {
  return {
    gitSha: "a".repeat(40),
    treeDigest: `sha256:${"b".repeat(64)}`,
    imageDigest: `sha256:${"c".repeat(64)}`,
    platform: "linux/amd64",
    ktxVersion: "0.16.0",
    chartVersion: "0.17.0"
  };
}

describe("批 D：审计案例进入 release 证据链的链路自检", () => {
  it("24 个审计 variant 都在冻结 catalog、都是 required、且在 lock 里", () => {
    const locked = new Set(readLock().requiredIds);
    for (const id of AUDIT_IDS) {
      const c = byId.get(id);
      assert.ok(c, `${id} 不在冻结 catalog 中`);
      assert.equal(c.required, true, `${id} 必须是 required`);
      assert.ok(locked.has(id), `${id} 不在 lock 的 requiredIds 中`);
    }
  });

  it("expectedExecutions 的分母包含全部 24 个审计 variant（不再是影子清单里的空条目）", () => {
    const keys = expectedExecutions(cases, []);
    for (const id of AUDIT_IDS) {
      assert.ok(keys.includes(id), `${id} 不在 expectedExecutions 分母里`);
    }
  });

  it("runner 产出的 passed 结果会被装配进 evidence.cases", () => {
    const run = minimalRun();
    const managementCases = AUDIT_IDS.map((id) => {
      const spec = byId.get(id);
      return {
        id,
        runner: spec.runner,
        status: "passed",
        startedAt: "2026-10-28T00:00:00.000Z",
        finishedAt: "2026-10-28T00:05:00.000Z",
        assertions: spec.assert.map((token) => ({ token, passed: true })),
        artifacts: []
      };
    });
    const { evidence } = assembleEvidence({
      run,
      results: { management: { cases: managementCases } },
      candidate: candidateBlock(),
      profileDigest: inputs.profileDigest,
      cases,
      expectedCount: expectedExecutions(cases, []).length,
      clientsDoc: inputs.clientsDoc
    });
    const assembled = new Map(evidence.cases.map((c) => [c.id, c]));
    for (const id of AUDIT_IDS) {
      const c = assembled.get(id);
      assert.ok(c, `${id} 没有被装配进 evidence.cases`);
      assert.equal(c.status, "passed", `${id} 装配后状态不是 passed`);
    }
  });

  it("verify-evidence 的 passedIds 会包含审计 variant —— 台账 verifiedBy 填得上了", () => {
    // 与 verify-evidence.mjs:770 同一判据：passedIds = evidence.cases 中
    // status === "passed" 的 id 集合。
    const run = minimalRun();
    const managementCases = AUDIT_IDS.map((id) => {
      const spec = byId.get(id);
      return {
        id,
        runner: spec.runner,
        status: "passed",
        startedAt: "2026-10-28T00:00:00.000Z",
        finishedAt: "2026-10-28T00:05:00.000Z",
        assertions: spec.assert.map((token) => ({ token, passed: true })),
        artifacts: []
      };
    });
    const { evidence } = assembleEvidence({
      run,
      results: { management: { cases: managementCases } },
      candidate: candidateBlock(),
      profileDigest: inputs.profileDigest,
      cases,
      expectedCount: expectedExecutions(cases, []).length,
      clientsDoc: inputs.clientsDoc
    });
    const passedIds = new Set(evidence.cases.filter((c) => c.status === "passed").map((c) => c.id));
    for (const id of AUDIT_IDS) {
      assert.ok(passedIds.has(id), `${id} 不在 passedIds 里`);
    }
  });

  it("未产出结果的审计 variant 不会被装配层凭空补成 passed", () => {
    const run = minimalRun();
    const { evidence } = assembleEvidence({
      run,
      results: { management: { cases: [] } },
      candidate: candidateBlock(),
      profileDigest: inputs.profileDigest,
      cases,
      expectedCount: expectedExecutions(cases, []).length,
      clientsDoc: inputs.clientsDoc
    });
    const assembled = new Map(evidence.cases.map((c) => [c.id, c]));
    for (const id of AUDIT_IDS) {
      assert.ok(!assembled.has(id), `${id} 没有任何 runner 结果却被装配出来`);
    }
  });
});
