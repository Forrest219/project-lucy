# Minimal RDS Data-Plane Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已批准的「最小化 RDS 迁移」收成可执行门禁：一推一／Strength B 只认 `row-policy` + `rds-mysql-readonly`；`security-e2e` 合成库明确不迁；禁止用错误 pack 跑 SEC-11 当证据。

**Architecture:** 双包并存。`examples/row-policy-e2e` 是唯一 RDS 同步面（只读 `mysql-aliyun`／`cw_rds_bot`）。`examples/security-e2e` 继续 `fin-db` + 可选 `--apply-db`，服务非行权限 SEC／UX／fault。本计划不重绑 SEC-09／10／12／16／UX／ARV／AUD。只补：设计台账、SEC-11 错包拒绝、一推一入口硬校验、回归测试。

**Tech Stack:** Node.js ESM（`scripts/e2e/*`）、`node --test`、既有 `db-capability.mjs`／`row-policy-pack.mjs`／`run-security.mjs`／`run-row-policy-b.mjs`。

## Global Constraints

- 不 `--no-cache` 重建 Docker；本计划不要求重建 demo 栈。
- RDS 账号只读：禁止对本 RDS seed／DDL／DML；密码只走文件，不入仓／入证。
- 行字段与谓词：物理列 `region`；值 **华东**／**西南**。
- 冻结 catalog 里 SEC-11 的 `requires: postgres` 不改合同字面量；由 `capabilitySatisfied` + `readonlyProven` 在 row-policy pack 上满足。
- 用户未要求则不自动 `git commit`；任务内 Commit 步骤改为「暂存说明，仅当用户要求时再 commit」。
- 术语遵守 `webui/docs/00-product-terminology-standard.md`。

## 范围（批准口径）

| 层级 | 范围 | 本计划 |
|---|---|---|
| A | Strength B：ROW25／RTP／RTV／SEC-11 BY；`--pack row-policy` | **收口门禁**（实现已大部落地，本计划补硬拒绝与文档） |
| B | SEC-09 等「可选下一波」 | **不做** |
| C | 鉴权／MCP／fault／需写库／demo | **明确不迁** |
| D | 默认 `pack=security` vs `--pack row-policy` | **保持双包**；错包跑 SEC-11 → blocked／failed closed |

## File Map

| File | Responsibility |
|---|---|
| `docs/superpowers/specs/2026-11-04-row-policy-real-e2e-pack-design.md` §8.1 | 台账：已切／不迁／门禁 |
| `scripts/e2e/lib/rds-dataplane-policy.mjs` | 纯函数：一推一／SEC-11 是否允许在当前 run 上执行 |
| `scripts/e2e/__tests__/rds-dataplane-policy.test.mjs` | 上列策略的单测 |
| `scripts/e2e/run-security.mjs` | 选中 SEC-11 时调用策略；非 RDS pack → blocked |
| `scripts/e2e/run-row-policy-b.mjs` | execute 前断言 `dataPlane` + `readonlyProven` |
| `scripts/e2e/__tests__/rds-dataplane-gates.test.mjs` | 既有 capability 测；可增策略导入烟雾 |
| `examples/row-policy-e2e/README.md` | 双包与证据边界一句话 |
| `scripts/gates/root-test-registry.json` | 注册新测试（若尚未注册 policy 测） |

---

### Task 1: 设计台账收口（最小化批准）

**Files:**
- Modify: `docs/superpowers/specs/2026-11-04-row-policy-real-e2e-pack-design.md`（§8 决策表 + §8.1）
- Modify: `examples/row-policy-e2e/README.md`（边界段）

- [x] **Step 1: 在决策表追加一行**

在 §8 决策表增加：

| 决策 | 选择 | 日期 |
|------|------|------|
| RDS 迁移范围 | **最小化**：仅 Strength B／row-policy 一推一；security-e2e 需库案与 demo **明确不迁**；禁止用 `pack=security` 的 SEC-11 结果当 RDS 证据 | 2026-11-04 |

- [x] **Step 2: 改写 §8.1 台账「待迁」行**

将「`examples/security-e2e`／mainline … **待迁**」改为：

| 路径 | 状态 | 说明 |
|---|---|---|
| `examples/security-e2e`／mainline 声明 `postgres` + `fin-db`／`--apply-db` 的数据案 | **明确不迁（最小化）** | 合成可写／canary／fault 保留；不是跨环境行权限真源。后续若升为「跨环境数据面合同」另开计划，不夹带本收口 |
| SEC-11 错包防护 | **本计划落地** | `run.pack !== row-policy` 或未 `readonlyProven` 时 SEC-11 → `blocked`，不得 `passed` |

- [x] **Step 3: README 补两句**

在 `examples/row-policy-e2e/README.md`「边界（硬）」下增加：

```markdown
- **证据边界**：Strength B／SEC-11 一推一证据只认本包（`--pack row-policy` + `dataPlane=rds-mysql-readonly`）。`examples/security-e2e` 的 `fin-db` 合成面不得冒充本证据。
- **双包**：默认 prepare 仍是 `security`；行权限真实审判必须显式 `--pack row-policy` 或 `run-row-policy-b`。
```

- [x] **Step 4: 自检**

确认文中不再出现「其余需活库的一推一后续一律改引用 mysql-aliyun」这种与最小化批准冲突的全量表述（改成「最小化范围外另开计划」）。

---

### Task 2: `rds-dataplane-policy` 纯策略 + 失败测试

**Files:**
- Create: `scripts/e2e/lib/rds-dataplane-policy.mjs`
- Create: `scripts/e2e/__tests__/rds-dataplane-policy.test.mjs`
- Modify: `scripts/gates/root-test-registry.json`（注册新测）

**Interfaces:**
- Produces:
  - `export const ROW_POLICY_PACK_ID = "row-policy"`
  - `export function isRdsMysqlReadonlyRun(run): boolean`
  - `export function sec11AllowedOnRun(run): { ok: true } | { ok: false, blockedReason: string, detail: string }`
  - `export function assertRowPolicyBDataPlane(run): void`（失败抛 `Error`）

- [x] **Step 1: 写失败测试**

```js
// scripts/e2e/__tests__/rds-dataplane-policy.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  isRdsMysqlReadonlyRun,
  sec11AllowedOnRun,
  assertRowPolicyBDataPlane
} from "../lib/rds-dataplane-policy.mjs";
import { RDS_MYSQL_READONLY_DATAPLANE } from "../lib/db-capability.mjs";

test("security pack run refuses SEC-11 even if postgres applied", () => {
  const run = {
    pack: "security",
    db: { engine: "postgres", applied: true, dataPlane: undefined }
  };
  assert.equal(isRdsMysqlReadonlyRun(run), false);
  const gate = sec11AllowedOnRun(run);
  assert.equal(gate.ok, false);
  assert.match(gate.blockedReason, /row_policy_pack_required|rds_dataplane_required/);
});

test("row-policy pack without readonlyProven refuses SEC-11", () => {
  const run = {
    pack: "row-policy",
    db: { dataPlane: RDS_MYSQL_READONLY_DATAPLANE, readonlyProven: false, engine: "mysql" }
  };
  const gate = sec11AllowedOnRun(run);
  assert.equal(gate.ok, false);
  assert.match(gate.detail, /readonlyProven/);
});

test("row-policy + readonlyProven allows SEC-11", () => {
  const run = {
    pack: "row-policy",
    db: { dataPlane: RDS_MYSQL_READONLY_DATAPLANE, readonlyProven: true, engine: "mysql" }
  };
  assert.equal(sec11AllowedOnRun(run).ok, true);
  assert.doesNotThrow(() => assertRowPolicyBDataPlane(run));
});

test("assertRowPolicyBDataPlane throws on security pack", () => {
  assert.throws(
    () => assertRowPolicyBDataPlane({ pack: "security", db: { applied: true } }),
    /row-policy|rds-mysql-readonly/
  );
});
```

- [x] **Step 2: 跑测确认失败**

```bash
node --test scripts/e2e/__tests__/rds-dataplane-policy.test.mjs
```

Expected: FAIL（模块不存在或导出走样）

- [x] **Step 3: 实现策略模块**

```js
// scripts/e2e/lib/rds-dataplane-policy.mjs
import { RDS_MYSQL_READONLY_DATAPLANE } from "./db-capability.mjs";
import { PACK_ID } from "./row-policy-pack.mjs";

export const ROW_POLICY_PACK_ID = PACK_ID;

export function isRdsMysqlReadonlyRun(run) {
  return (
    run?.pack === PACK_ID &&
    run?.db?.dataPlane === RDS_MYSQL_READONLY_DATAPLANE
  );
}

export function sec11AllowedOnRun(run) {
  if (run?.pack !== PACK_ID) {
    return {
      ok: false,
      blockedReason: "row_policy_pack_required",
      detail:
        "SEC-11 (BY) one-to-one evidence requires --pack row-policy; security-e2e/fin-db results are not RDS evidence"
    };
  }
  if (run?.db?.dataPlane !== RDS_MYSQL_READONLY_DATAPLANE) {
    return {
      ok: false,
      blockedReason: "rds_dataplane_required",
      detail: `SEC-11 requires dataPlane=${RDS_MYSQL_READONLY_DATAPLANE}, got ${run?.db?.dataPlane ?? "unset"}`
    };
  }
  if (run?.db?.readonlyProven !== true) {
    return {
      ok: false,
      blockedReason: "rds_readonly_unproven",
      detail: "SEC-11 requires run.db.readonlyProven=true (prepare/live RDS SELECT probe)"
    };
  }
  return { ok: true };
}

export function assertRowPolicyBDataPlane(run) {
  const gate = sec11AllowedOnRun(run);
  // Strength B needs the same plane even before SEC-11 runs (ROW/RTP share the pack).
  if (!isRdsMysqlReadonlyRun(run) || run?.db?.readonlyProven !== true) {
    const detail = gate.ok === false ? gate.detail : "row-policy B requires rds-mysql-readonly + readonlyProven";
    throw new Error(`assertRowPolicyBDataPlane: ${detail}`);
  }
}
```

- [x] **Step 4: 再跑测**

```bash
node --test scripts/e2e/__tests__/rds-dataplane-policy.test.mjs
```

Expected: 全部 pass

- [x] **Step 5: 注册 root-test-registry**

在 `scripts/gates/root-test-registry.json` 的 `entries` 中、紧挨 `rds-dataplane-gates.test.mjs` 插入：

```json
{
  "path": "scripts/e2e/__tests__/rds-dataplane-policy.test.mjs",
  "runner": "node --test",
  "environment": "deterministic",
  "sideEffects": "none",
  "command": "node --test scripts/e2e/__tests__/rds-dataplane-policy.test.mjs",
  "gate": "k8s-static",
  "gateCommand": "npm run test:e2e-harness",
  "reason": null
}
```

---

### Task 3: `run-security` 对 SEC-11 错包 fail-closed

**Files:**
- Modify: `scripts/e2e/run-security.mjs`（case 循环选中后、调用 handler 前）
- Modify: `scripts/e2e/__tests__/rds-dataplane-policy.test.mjs` 或新增轻量 integration 测（可选：纯测导出的 helper 若从 run-security 抽出 `gateSec11Case`）

**Interfaces:**
- Consumes: `sec11AllowedOnRun(run)`
- Produces: 对 `testCase.id` 匹配 `/^SEC-11-/` 且 `gate.ok === false` 的条目：`status: "blocked"`，`blockedBy: [gate.blockedReason]`，**不得**进入 handler（避免 fin-db 假绿）

- [x] **Step 1: 在 run-security 导入策略**

```js
import { sec11AllowedOnRun } from "./lib/rds-dataplane-policy.mjs";
```

- [x] **Step 2: 在执行单个 case 前插入门禁**

找到现有「missing capability → blocked」分支附近，增加：

```js
if (typeof testCase?.id === "string" && testCase.id.startsWith("SEC-11-")) {
  const sec11Gate = sec11AllowedOnRun(run);
  if (!sec11Gate.ok) {
    finish({
      status: "blocked",
      policyVersion: "n/a",
      contextPolicyVersion: "n/a",
      detail: sec11Gate.detail,
      blockedBy: [sec11Gate.blockedReason]
    });
    continue; // 或与该文件既有 finish/continue 结构对齐
  }
}
```

实现时必须对齐 `run-security.mjs` 现有 `finish`／`entry`／`continue` 控制流，避免双重写入 `results`。

- [x] **Step 3: 单元验证策略仍独立通过；手工烟雾（可选）**

```bash
node --test scripts/e2e/__tests__/rds-dataplane-policy.test.mjs scripts/e2e/__tests__/rds-dataplane-gates.test.mjs
```

若本地已有 `inbox/e2e/local-rds-gate-smoke`（`pack=row-policy`，`readonlyProven=true`）：

```bash
node scripts/e2e/run-security.mjs --run inbox/e2e/local-rds-gate-smoke/run.json --only SEC-11-BY09
```

Expected: `passed`（或既有 phase-off 行为）。

对 **security pack** run（任选已有 `inbox/e2e/local-*` 且 `pack` 缺省／`security`）：

```bash
node scripts/e2e/run-security.mjs --run <security-pack-run.json> --only SEC-11-BY01
```

Expected: case `blocked`，detail 含 `row_policy_pack_required` 或等价；**不得** `passed`。

---

### Task 4: `run-row-policy-b` execute 前硬断言

**Files:**
- Modify: `scripts/e2e/run-row-policy-b.mjs`
- Modify: `scripts/e2e/__tests__/row-policy-phase.test.mjs`（若有 execute 路径可 stub；否则只测 `assertRowPolicyBDataPlane` 已在 Task 2 覆盖）

- [x] **Step 1: 在 `--execute` 分支、第一阶段 spawn 之前调用**

```js
import { assertRowPolicyBDataPlane } from "./lib/rds-dataplane-policy.mjs";

// inside runRowPolicyB, when execute === true, after load/prepare:
assertRowPolicyBDataPlane(run);
```

若 prepare 刚完成但 `readonlyProven` 仍为 false（探针失败），execute 必须抛错退出，不得写假绿 `evidence/phase-*`。

- [x] **Step 2: skeleton（非 execute）不强制活探成功**

`execute !== true` 时不调用 `assertRowPolicyBDataPlane`（允许离线编排 plan／not_run 表）。

- [x] **Step 3: 跑既有 phase 测**

```bash
node --test scripts/e2e/__tests__/row-policy-phase.test.mjs scripts/e2e/__tests__/row-policy-pack.test.mjs
```

Expected: pass

---

### Task 5: 收口自检与证据说明

**Files:**
- Modify: `docs/superpowers/specs/2026-11-04-row-policy-real-e2e-pack-design.md` §8.1（勾选「SEC-11 错包防护」为已落地，若 Task 3 完成）

- [x] **Step 1: 跑门禁相关测**

```bash
node --test \
  scripts/e2e/__tests__/rds-dataplane-policy.test.mjs \
  scripts/e2e/__tests__/rds-dataplane-gates.test.mjs \
  scripts/e2e/__tests__/row-policy-pack.test.mjs
```

Expected: all pass

- [x] **Step 2: 写进台账的「完成定义」核对**

最小化完成 = 同时满足：

1. 文档：双包 + 不迁 80 案 + 证据边界写清  
2. `sec11AllowedOnRun`：security pack → SEC-11 blocked  
3. `run-row-policy-b --execute`：无 RDS 证明则拒绝  
4. **不**改 SEC-09／10／12／UX handlers 去打 `mysql-aliyun`  
5. **不**宣称 Strength B 全量已绿（V15／V19／V22／RTP25-07 仍可 blocked）

- [x] **Step 3: 仅当用户要求时再 commit**

建议信息（用户要求时再用）：

```text
gate: enforce minimal RDS plane for SEC-11 and row-policy B

Refuse SEC-11 evidence on security-e2e/fin-db packs; require
rds-mysql-readonly + readonlyProven for Strength B execute.
```

---

## Self-Review

1. **Spec coverage:** 批准的最小化口径 → Task 1 文档；错包防护 → Task 2–3；B execute 硬门 → Task 4；不做 B 层 SEC-09 → 无对应任务。  
2. **Placeholder scan:** 无 TBD；Commit 已改为「仅当用户要求」。  
3. **Type consistency:** `sec11AllowedOnRun` / `assertRowPolicyBDataPlane` / `RDS_MYSQL_READONLY_DATAPLANE` / `PACK_ID` 与现有 `db-capability.mjs`、`row-policy-pack.mjs` 一致。

## Out of Scope（显式）

- 将 SEC-09／10／12／16、UX、ARV25、AUD25、mainline 迁到 RDS  
- 修改冻结 catalog 把 `postgres` 改成 `mysql`  
- Strength B 全量 `--execute` 冲绿  
- Docker demo-db 替换为 RDS  

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-11-04-minimal-rds-dataplane-plan.md`.

**执行方式二选一：**

1. **Subagent-Driven（推荐）** — 按 Task 1→5 派发，每 Task 再复核  
2. **Inline** — 本会话按 `executing-plans` 顺序做完  

需要我现在按 Subagent-Driven 开做吗？
