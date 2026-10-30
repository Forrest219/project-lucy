/**
 * v0.25 审计案例（AUD25 / ARV25）进入 release 证据链的**接线测试**。
 *
 * 背景：本轮修复前，AUD25-A01..A12 与 ARV25-V01..V12 只登记在
 * `scripts/e2e/contracts/v025-coverage.yaml`（v0.25 覆盖清单）里，
 * **不在冻结的 case catalog 中**。后果：
 *
 *   1. `collect-v025-results.mjs` 把结果写进 `<runDir>/v025/`；
 *   2. 但 `scripts/e2e/lib/assemble.mjs` 的 `loadResults()` **不读** `v025/`；
 *   3. `verify-evidence.mjs` 的 `passedIds` 来自 `evidence.cases`（装配结果）；
 *   4. ⇒ 即使本地把 A01–A12 / V01–V12 跑成 passed，台账的 `verifiedBy`
 *      也**永远填不上** —— 这正是 33 条 open 缺陷的共同根因。
 *
 * 经 D2 拍板采用**路径 A**：把 AUD25 / ARV25 作为正式 case variant 并入
 * 冻结 catalog（`case-catalog.yaml` + `case-catalog.lock.json` 同步重推），
 * 使它们进入 `evidence.cases` 与 `passedIds`。
 *
 * 本测试固定以下不变量：
 * - AUD25 / ARV25 的 24 个 variant 全部在冻结 catalog 中且为 required；
 * - 并入冻结 catalog **只能加强、不能弱化** v0.25 清单原来的合同
 *   （执行器 / 断言 / 产物 / 能力逐项不丢）；
 * - 覆盖清单侧仍登记归属与需求指向，且**不复制** catalog 拥有的字段；
 * - 无 Playwright spec 覆盖时，management runner 产出 **blocked**，
 *   绝不产出 passed / skipped；
 * - 能力缺失时必须是 blocked，且写明缺哪个能力。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCatalog, readLock, checkLock } from "../lib/catalog.mjs";
import { collectManagementResults } from "../collect-management-results.mjs";
import { loadCoverage } from "../lib/v025-coverage.mjs";

const { cases } = loadCatalog();
const AUDIT_IDS = [
  ...Array.from({ length: 12 }, (_, i) => `AUD25-A${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 12 }, (_, i) => `ARV25-V${String(i + 1).padStart(2, "0")}`)
];

const byId = new Map(cases.map((c) => [c.id, c]));

describe("v0.25 审计案例并入冻结 catalog（D2 路径 A）", () => {
  it("冻结 catalog 含全部 24 个审计 variant，且全部 required", () => {
    for (const id of AUDIT_IDS) {
      const c = byId.get(id);
      assert.ok(c, `${id} 不在冻结 catalog 中`);
      assert.equal(c.required, true, `${id} 必须是 required`);
      assert.equal(c.scenario, id.startsWith("AUD25") ? "AUD25" : "ARV25", `${id} 场景归属`);
    }
    // 分母不得静默缩小：lock 必须同时锁住这些 id。
    const locked = new Set(readLock().requiredIds);
    for (const id of AUDIT_IDS) assert.ok(locked.has(id), `${id} 不在 lock 的 requiredIds 中`);
    assert.deepEqual(checkLock(cases, readLock()), [], "catalog 与 lock 必须一致");
  });

  it("并入冻结 catalog 只能加强、不能弱化 v0.25 清单的原合同", () => {
    // 并入前（v0.25 覆盖清单 newScenarios）这 24 项的合同，在这里**冻结为基线**：
    // 它是「同名不同义」的判据来源，此后冻结 catalog 只能比它更强，不得更弱。
    const AUDIT_BASELINE = {
      executors: ["P", "D", "A", "O", "V"],
      requires: ["lucy-http", "ktx-upstream", "postgres", "fault-control", "agent-client"],
      assert: ["audit_event", "artifact_scan", "consistency"],
      artifacts: ["security-case-result.json", "leak-scan.json"]
    };
    const ARV_BASELINE = {
      executors: ["P", "B", "D", "V"],
      requires: ["lucy-http", "ktx-upstream", "postgres", "browser", "agent-client"],
      assert: ["audit_event", "consistency", "deny", "no_leak"],
      artifacts: ["management-case-result.json", "security-case-result.json", "leak-scan.json"]
    };
    for (const id of AUDIT_IDS) {
      const c = byId.get(id);
      const baseline = id.startsWith("AUD25") ? AUDIT_BASELINE : ARV_BASELINE;
      // 执行器：不得减少（多一个允许，少一个就不执行了）
      for (const e of baseline.executors) {
        assert.ok(c.executors.includes(e), `${id} 丢失了执行器 ${e}`);
      }
      // 断言：不得减少（少一条断言 = 少验一件事）
      for (const a of baseline.assert) {
        assert.ok(c.assert.includes(a), `${id} 丢失了断言 ${a}`);
      }
      // 产物：不得减少（少了证据文件，取证链断）
      for (const artifact of baseline.artifacts) {
        assert.ok(c.artifacts.includes(artifact), `${id} 丢失了产物 ${artifact}`);
      }
      // 能力：不得减少（少了能力会在缺能力时被误判为可执行）
      for (const cap of baseline.requires) {
        assert.ok(c.requires.includes(cap), `${id} 丢失了能力 ${cap}`);
      }
    }
    // ARV25-V12 逐 variant 额外要求客户 amd64 K8s 环境（Stage 2 专用）
    assert.ok(byId.get("ARV25-V12").requires.includes("k8s-amd64"), "ARV25-V12 必须要求 k8s-amd64");
  });

  it("覆盖清单仍登记这 24 项的归属与需求指向（清单不是第二套事实源，但归属不能丢）", () => {
    const manifest = loadCoverage();
    // 2026-10-28（D2 路径 A）：这 24 项的**执行合同**已由冻结 catalog 承载，
    // 因此从 newScenarios 移到 existingCatalogMappings；清单侧只保留**归属**
    // （ownerBranch + 需求指向），不得再复制 executors/requires/assert/artifacts/gold。
    const byExecutionId = new Map(manifest.existing.map((e) => [e.executionId, e]));
    for (const id of AUDIT_IDS) {
      const entry = byExecutionId.get(id);
      assert.ok(entry, `${id} 不在 v0.25 覆盖清单的 existingCatalogMappings 中`);
      assert.equal(entry.ownerBranch, "OBSERVE", `${id} owner`);
      // 需求指向必须与执行 id 后缀一致（AUD25-A01 ↔ A01，ARV25-V01 ↔ V01）
      const suffix = id.slice(id.indexOf("-") + 1);
      assert.equal(entry.sourceRequirementId, suffix, `${id} 需求指向`);
      const expectedSpec = id.startsWith("AUD25")
        ? "docs/specs/lucy-20261020-v2p5-audit-increment-spec.md"
        : "docs/specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md";
      assert.equal(entry.sourceSpec, expectedSpec, `${id} sourceSpec`);
      // 清单不得复制 catalog 拥有的字段（F-08）
      for (const f of ["executors", "requires", "assert", "artifacts", "gold", "runner", "status"]) {
        assert.ok(!(f in entry), `${id} 在清单里复制了 catalog 拥有的字段 ${f}`);
      }
    }
    // 它们**不在** newScenarios 里了（两组不可重叠）
    const newIds = new Set((manifest.newScenarios ?? []).map((s) => s.executionId));
    for (const id of AUDIT_IDS) {
      assert.ok(!newIds.has(id), `${id} 同时出现在 newScenarios 与 existingCatalogMappings`);
    }
  });

  it("无 spec 覆盖 → blocked，绝不 passed / skipped", () => {
    // 空的 playwright report：没有任何 spec 用 covers() 声明这些 case。
    const report = { suites: [], stats: { startTime: "2026-10-28T00:00:00.000Z" } };
    const results = collectManagementResults({
      run: { runId: "test-run" },
      report,
      cases,
      capabilities: new Set(["lucy-http", "browser"])
    });
    const auditResults = results.filter((r) => AUDIT_IDS.includes(r.id));
    assert.equal(auditResults.length, 24, "24 个审计 case 都必须出现在 management 结果里");
    for (const r of auditResults) {
      assert.notEqual(r.status, "passed", `${r.id} 无 spec 覆盖时不得记 passed`);
      assert.notEqual(r.status, "skipped", `${r.id} 无 spec 覆盖时不得记 skipped`);
      assert.equal(r.status, "blocked", `${r.id} 应为 blocked，实际 ${r.status}`);
    }
  });

  it("能力缺失 → blocked 且写明缺哪个能力（不是 skip，不是 pass）", () => {
    const report = { suites: [], stats: { startTime: "2026-10-28T00:00:00.000Z" } };
    const results = collectManagementResults({
      run: { runId: "test-run" },
      report,
      cases,
      capabilities: new Set(["lucy-http"]) // 没有 browser
    });
    const arv = results.find((r) => r.id === "ARV25-V01");
    assert.equal(arv.status, "blocked");
    assert.ok(
      (arv.blockedBy ?? []).includes("browser"),
      `ARV25-V01 应写明缺 browser，实际 ${JSON.stringify(arv.blockedBy)}`
    );
  });
});
