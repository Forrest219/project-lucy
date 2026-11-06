// v0.25 覆盖可达性门禁（覆盖清单 vs 分支判定分母）。
//
// 为什么要有这道门禁
// ------------------
// v0.25 覆盖清单（scripts/e2e/contracts/v025-coverage.yaml）的 149 个 newScenarios
// 并不都能被某个分支真的跑到。各分支的选择集（SELECTED_IDS + AGENT 派生集）是它们的
// **判定分母**：分母外的执行项永远不参与分支判定。于是「一个分支跑绿了」并不等于
// 「这个分支归属的执行项都跑过了」——缺 16 个 id 时分支照样可以报 passed。
//
// 这道门禁把这件事变成机器可校验的合同：
//   1. 清单里的每个执行项，要么被某个分支选中，要么必须出现在已知缺口清单里；
//      两者都不满足 = 静默漏项 = 失败。
//   2. 缺口清单里的每一项必须当前确实不可达；一旦某项变得可达，必须把它移出去，
//      否则缺口清单会变成垃圾桶。
//   3. 缺口项永远不折叠成 passed；它们在运行结果里仍然是 blocked / not_run。
//
// 登记不改变状态口径：缺口是「为什么跑不到」，不是「跑过了」。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";

import { REPO_ROOT } from "../lib/common.mjs";
import { loadCatalog } from "../lib/catalog.mjs";
import { loadCoverage } from "../lib/v025-coverage.mjs";
import { SELECTED_IDS, agentIdsForExecutor } from "../lib/product-targets.mjs";

const GAP_PATH = path.join(REPO_ROOT, "scripts", "e2e", "contracts", "v025-known-gaps.yaml");

/** 分支的选择集 = 该分支的判定分母。 */
export function branchSelection() {
  const coverage = loadCoverage();
  const cases = loadCatalog().cases;
  const selection = new Map();
  for (const branch of ["CONN", "SEM", "ACCESS", "OBSERVE"]) {
    selection.set(branch, new Set(SELECTED_IDS[branch] ?? []));
  }
  // AGENT 分支的选择是派生的：AGENT 归属的冻结 variant 且 runner=agent。
  selection.set("AGENT", new Set(agentIdsForExecutor(coverage, cases)));
  return selection;
}

export function loadKnownGaps(file = GAP_PATH) {
  const doc = parse(readFileSync(file, "utf8"));
  const groups = doc.gaps ?? [];
  const ids = new Set();
  for (const group of groups) {
    for (const id of group.executionIds ?? []) {
      assert.ok(!ids.has(id), `known-gaps: ${id} appears in more than one group`);
      ids.add(id);
    }
  }
  return { doc, groups, ids };
}

/** 清单里**不属于**新执行项、也不在缺口清单里的静默漏项。 */
export function silentlyDropped() {
  const coverage = loadCoverage();
  const selection = branchSelection();
  const reachable = new Set();
  for (const ids of selection.values()) for (const id of ids) reachable.add(id);
  const gaps = loadKnownGaps().ids;
  return coverage.newScenarios
    .map((s) => s.executionId)
    .filter((id) => !reachable.has(id) && !gaps.has(id));
}

describe("v0.25 覆盖可达性（判定分母不得静默漏项）", () => {
  it("known-gaps 合同存在且每个分组都写明原因、解法与归属", () => {
    const { groups } = loadKnownGaps();
    assert.ok(groups.length > 0, "known-gaps 合同不得为空");
    for (const group of groups) {
      assert.ok(typeof group.group === "string" && group.group.length > 0, "分组缺少 group 名");
      assert.ok(typeof group.reason === "string" && group.reason.length > 10, `${group.group} 缺少 reason`);
      assert.ok(typeof group.unblock === "string" && group.unblock.length > 10, `${group.group} 缺少 unblock`);
      assert.ok(
        typeof group.ownerBranch === "string" && group.ownerBranch.length > 0,
        `${group.group} 缺少 ownerBranch`
      );
      assert.ok(Array.isArray(group.executionIds) && group.executionIds.length > 0, `${group.group} 没有执行项`);
    }
  });

  it("清单里的每个执行项要么被某个分支选中，要么在已知缺口清单里（无静默漏项）", () => {
    const dropped = silentlyDropped();
    assert.deepEqual(
      dropped,
      [],
      `这些执行项既没有被任何分支选中、也不在已知缺口清单里，属于静默漏项：${dropped.join(", ")}`
    );
  });

  it("缺口清单里的每一项都真实存在于覆盖清单，且当前确实不可达", () => {
    const coverage = loadCoverage();
    const known = new Set(coverage.newScenarios.map((s) => s.executionId));
    const selection = branchSelection();
    const reachable = new Set();
    for (const ids of selection.values()) for (const id of ids) reachable.add(id);
    const { ids } = loadKnownGaps();
    for (const id of ids) {
      assert.ok(known.has(id), `known-gaps 里的 ${id} 不在覆盖清单的 newScenarios 里`);
      assert.ok(!reachable.has(id), `known-gaps 里的 ${id} 现在已经可达，必须从缺口清单移除`);
    }
  });

  it("缺口项的归属分支与覆盖清单一致", () => {
    const coverage = loadCoverage();
    const ownerOf = new Map(coverage.newScenarios.map((s) => [s.executionId, s.ownerBranch]));
    for (const group of loadKnownGaps().groups) {
      for (const id of group.executionIds ?? []) {
        assert.equal(ownerOf.get(id), group.ownerBranch, `${id} 的归属分支与缺口分组不一致`);
      }
    }
  });

  it("分支的判定分母与它归属的执行项一致（分母不得比归属少）", () => {
    // 少的那部分必须正好是缺口清单里、且归属该分支的项。
    const coverage = loadCoverage();
    const selection = branchSelection();
    const gaps = loadKnownGaps();
    const gapOwner = new Map();
    for (const group of gaps.groups) {
      for (const id of group.executionIds ?? []) gapOwner.set(id, group.ownerBranch);
    }
    for (const branch of ["CONN", "SEM", "ACCESS", "OBSERVE"]) {
      const owned = coverage.newScenarios
        .filter((s) => s.ownerBranch === branch)
        .map((s) => s.executionId);
      const selected = selection.get(branch);
      for (const id of owned) {
        const missing = !selected.has(id);
        const declared = gapOwner.get(id) === branch;
        assert.ok(
          !missing || declared,
          `${branch} 归属的 ${id} 既不在分支分母里、也没登记为缺口，属于静默漏项`
        );
      }
    }
  });
});
