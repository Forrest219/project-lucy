# 功能收口，发布类删除

| 元数据 | 内容 |
|---|---|
| 状态 | 已执行（2026-11-02） |
| 授权边界 | 只收口已经存在的产品行为，并删除发布类现行义务。不跑 E2E，不把发布编号改成通过，不改冻结发布目录，不打开 W-B，不把批量校验改成可发布计划 |
| 验收 | 功能缺口有本机断言。发布编号从五条的现行状态删除。`npm run lint:spec-docs` 通过，0 条 stale-status |

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 五条清单在功能上收口。发布类从现行状态删除，不再因为没执行而显示不通过。

**Architecture:** 功能缺口只补本机断言和缺的页面展示。发布编号从功能 Spec、升级建议书、概览和索引的现行句里删除。场景若仍被发布目录引用，留在 E2E 主线和冻结 catalog，本任务不跑、不改通过、不删 catalog 行。

**Tech Stack:** 现有 Vitest 组件测试与 Markdown 登记。验收命令是定向测试加 `npm run lint:spec-docs`。

## Global Constraints

- 功能收口的证据是本机行为断言。本条收口不表示可上线。
- 发布类删除是删掉现行义务，不是改成通过，也不是再排一次执行。
- 不改 `scripts/e2e/contracts/case-catalog.yaml`、`case-catalog.lock.json`、`v025-coverage.yaml`。
- 不跑浏览器 E2E、real-e2e、客户 linux/amd64。
- 历史版本行不回改。同一文件里和头部冲突的现在时，改成现行归属，或紧贴「已作废，不得当作现值」。
- 不再写「未执行且不排期」。不再写「不可交付 UAT」。
- 改状态时，同一次改完 Spec 头部、建议书现行状态、`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md` §9。写之前重读版本行，概览和建议书各取 current+1。
- G30 的产品合同是「校验只产报告，不产可发布计划」。收口这句话，不实现发布计划，不打开 L25-16 的 W-B。
- RTV-07 的翻译防御缺口不在本任务。
- 形态基线只减不增。提交只在用户要求时做。

## 清理范围

| 清单 | 功能收口 | 发布类删除 |
|---|---|---|
| L25-09 | 维持 S01–S07 已收口 | 从现行状态删除 S08、`AUD25-A01`…`A12`、U9 两阶段、客户单副本重跑 |
| L25-14 P0 | 维持 R2／R4／R5 已收口 | 从现行状态删除 V01–V22、C19、`ROW25`、客户 Linux 大写 Schema、Wave 0b |
| L25-02／03 | 补上两句还没有组件断言的产品行为，然后收口 | 从现行状态删除 V01–V12、`ARV25`、浏览器详情、真实事件全集、同一次读取里 API／页面／CSV 互相对上、客户单副本 |
| L25-11 | FC-01–FC-32 维持关闭。G30 按「只产报告」收口 | 从现行状态删除 `SEM25-V01`…`V22`、Wave 0b、客户交付 |
| 2026-10-19 审计可信度 | 运行时合同维持指向 L25-09 S01–S07 | 从现行状态删除 EA-01–EA-36。QA 文件退出升级管理 |

删除后的现行句不再写「不记通过」「仍未执行」「归 E2E」。那些句子会让没跑过的编号看起来像没通过。

---

### Task 1: 写清理记录

**Files:**
- Create: `docs/reviews/2026-11-02-functional-close-release-delete.md`
- Modify: `docs/README.md` 第 3 节复核表

- [x] **Step 1:** 写记录。结论是功能按本计划收口，发布类从现行状态删除。逐条抄上表。写明不跑 E2E，不改冻结 catalog，不把编号改成通过，不表示可上线。

- [x] **Step 2:** 在 `docs/README.md` 第 3 节复核表最上方加这一行。

---

### Task 2: L25-09 删掉 S08 现行义务

**Files:**
- Modify: `docs/specs/lucy-20261020-v2p5-audit-increment-spec.md` 头部、§11、§13.2
- Modify: `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` §2.3 现行状态
- Modify: `docs/governance/project-overview.md` §9 L25-09 行
- Modify: `docs/README.md` 该 Spec 索引行

- [x] **Step 1:** 头部只留功能合同 S01–S07 已收口，以及「本条收口不表示可上线」。删掉 S08、A01–A12、U9、客户单副本的现行义务句。

- [x] **Step 2:** §11 与 §13.2 的表前现行句改成：本节已从功能合同删除。场景文本保留给发布目录，不决定本条收口。不要写「仍未执行」或「不记通过」。

- [x] **Step 3:** 建议书 §2.3、概览 §9、README 改成与头部同一句。

---

### Task 3: L25-14 删掉 ROW25 现行义务

**Files:**
- Modify: `docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md` 头部、§9 表前、§14.9
- Modify: `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` §2.8 现行状态
- Modify: `docs/governance/project-overview.md` §9 行权限行
- Modify: `docs/README.md` 该 Spec 索引行

- [x] **Step 1:** 头部保持「P0 已收口。出口只含 R2／R4／R5」。删掉 V01–V22、C19、`ROW25`、Wave 0b 的现行义务句。保留「本条收口不表示可上线」。

- [x] **Step 2:** §9 表前改成：本节已从功能合同删除。场景文本保留给发布目录，不决定本条收口。

- [x] **Step 3:** §14.9 里把客户 Linux 大写 Schema 与 Wave 0b 写成已从本条删除。D-03 的现行值仍是 §14.9 的 `fixed`。R1／R3 的现行状态仍见行策略模板 Spec 头部。

- [x] **Step 4:** 建议书 §2.8、概览、README 改成与头部同一句。

---

### Task 4: L25-02／03 补上两句产品行为

**Files:**
- Modify: `webui/src/__tests__/audit-reconciliation-page.test.tsx`
- Modify: `webui/src/pages/admin/AuditReconciliation.tsx`（只在测试证明页面没有完整表身份时）
- Test: `webui/src/__tests__/audit-reconciliation-page.test.tsx`

问询详情现在把接口返回的问询对象整段显示在 `reconciliation-inquiry-detail`。使用概况接口已经带上表清单 CSV，页面还没有排行列表。

- [x] **Step 1:** 先写失败测试。构造 13 条长表身份，断言 `reconciliation-inquiry-detail` 逐条含有 `connectionId`、`schema`、`table`，并且全文没有「等 N 个」。

- [x] **Step 2:** 跑这个文件，确认新测试先失败或已通过。已通过就不要改页面。失败就只让详情展示接口已经返回的完整身份，禁止截成「等 N 个」。

- [x] **Step 3:** 再写失败测试。使用概况返回的表清单里有一条长身份。页面要列出完整 `connectionId / schema / table`，并提供复制全文。列表文本没有「等 N 个」。

- [x] **Step 4:** 跑测试，确认失败。然后在 `AuditReconciliation.tsx` 用该响应里已有的表清单渲染这个列表。不新请求，不合并同名表。

- [x] **Step 5:** 再跑 `webui/src/__tests__/audit-reconciliation-page.test.tsx`，两条新测试通过。

- [x] **Step 6:** 把这两句写入对账 Spec 头部的已收口句子，并写明落点文件。保留「本条收口不表示可上线」。

---

### Task 5: L25-02／03 删掉 ARV25 现行义务

**Files:**
- Modify: `docs/specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md` 头部、§7、§3.6.3
- Modify: `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` L25-02、L25-03 现行状态
- Modify: `docs/governance/project-overview.md` §9 对账行
- Modify: `docs/README.md` 该 Spec 索引行
- Modify: `docs/reviews/2026-11-02-functional-close-release-delete.md`

- [x] **Step 1:** 头部只留 Task 4 收口的读取合同和两句页面行为。删掉 V01–V12、`ARV25`、浏览器详情、真实事件全集、API／页面／CSV 同一次互相对上、客户单副本的现行义务句。

- [x] **Step 2:** §7 与 §3.6.3 的表前现行句改成：本节已从功能合同删除。场景文本保留给发布目录，不决定本条收口。

- [x] **Step 3:** 建议书 L25-02、L25-03、概览、README 改成与头部同一句。

- [x] **Step 4:** 在清理记录里写上这两句的测试名。

---

### Task 6: L25-11 收口 G30，并删掉 SEM25

**Files:**
- Modify: `docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md` 头部、§10 表前、§10.3
- Modify: `docs/plans/lucy-20261030-semantic-batch-functional-contract-plan.md` 状态行
- Modify: `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` §2.5 现行状态
- Modify: `docs/governance/project-overview.md` §9 语义批量行
- Modify: `docs/README.md` 该 Spec 与其 Plan 的索引行
- Modify: 现有校验测试，仅当仓库里还没有「校验只产报告、不写发布」的断言

- [x] **Step 1:** 在 `webui/server/__tests__/` 搜索批量校验只返回报告、不写 release 的断言。已有就记下文件名和测试名。没有就补一条失败测试，再让它通过。不改校验端点去产出可发布计划。

- [x] **Step 2:** 头部改为：已关闭。出口是 FC-01–FC-32。G30 已收口：校验只产报告，不产可发布计划。不打开 W-B。本条关闭不表示可上线。删掉 `SEM25`、Wave 0b、客户交付的现行义务句。

- [x] **Step 3:** §10 的 V 表前改成：本节已从功能合同删除。场景文本保留给发布目录，不决定 FC 是否关闭。

- [x] **Step 4:** §10.3、语义批量 Plan、建议书 §2.5、概览、README 改成与头部同一句。G31 与 W-B 仍只写在 L25-16。

---

### Task 7: 审计可信度删掉 EA 现行义务

**Files:**
- Modify: `docs/specs/lucy-20261019-audit-trust-and-admin-investigation-spec.md` 状态行
- Modify: `docs/plans/2026-10-19-audit-trust-and-admin-investigation-plan.md` 状态行
- Modify: `docs/qa/audit-trust-and-admin-investigation-acceptance.md` 文首
- Modify: `docs/README.md` 与 `docs/plans/README.md` 的对应索引行

- [x] **Step 1:** Spec 与 Plan 的状态只留：运行时合同见 L25-09 S01–S07，该合同已收口。管理员第一现场的页面接入保留为历史事实。EA 已从本条删除。不进入版本升级清单。

- [x] **Step 2:** QA 文首改为：本文件已退出升级管理。场景文本保留，不决定任何功能是否收口，也不进入升级建议书。不要把 EA 改成通过。

- [x] **Step 3:** 两处索引改成与 Spec 头部同一句。不把这份 Spec 写进升级建议书。

---

### Task 8: 登记版本并检查

**Files:**
- Modify: `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` 版本行
- Modify: `docs/governance/project-overview.md` 版本行
- Modify: `docs/specs/lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md` 只加一句边界

- [x] **Step 1:** 在 E2E 主线 Spec 的 `AUD25`、`ROW25`、`ARV25`、`SEM25` 对照表前加一句：这些编号不再决定功能收口。本任务不改它们的执行状态。不改冻结 catalog。

- [x] **Step 2:** 写之前重读建议书和概览的顶部版本。各加一条 current+1。内容只写：功能缺口已收口；发布类已从现行状态删除；发布编号不改成通过。

- [x] **Step 3:** 跑 `npm run lint:spec-docs`。预期：通过，0 条 stale-status。

- [x] **Step 4:** 搜索五条现行状态。不再出现「不记通过」「仍未执行」「归 E2E」作为这些功能没收口的原因。G30 不再写「仍开」。

- [x] **Step 5:** 不提交，除非用户要求。

## 目标

五条清单的功能合同收口。发布类不再出现在升级现行状态里。

## 开工前置

用户批准本计划后再改代码和登记。Task 4 开工前先读 `AuditReconciliation.tsx` 与 usage 响应里的表清单文件，不另造一份表身份。

## 验收

定向组件测试通过。G30 有「只产报告、不写发布」的断言。`npm run lint:spec-docs` 通过，0 条 stale-status。五条现行状态不再用发布编号解释功能没收口。

## 完成定义

L25-09、L25-14、L25-02／03、L25-11、审计可信度的头部都只剩产品出口。两句对账页面行为有测试。G30 按现有合同收口。发布编号未改成通过，冻结 catalog 未改。

## 风险

- 把「不记通过」改写成「通过」，会把没跑过的发布场景说成已经成立。
- 删除或改写 `case-catalog.yaml`，会改发布门禁。
- 为了关掉 G30 去让批量校验产出可发布计划，会改冻结合同并碰 W-B。
- 顺手修 RTV-07，会把另一个产品缺口混进这次删除。
