# 版本升级清单：产品与发布拆分

| 元数据 | 内容 |
|---|---|
| 状态 | 已执行（2026-11-02） |
| 授权边界 | 只改升级清单的现行归属。不改运行代码，不重跑产品测试，不把未执行的发布编号改成通过 |
| 验收 | `npm run lint:spec-docs` 通过，0 条 stale-status |

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 版本升级清单只保留产品合同。四条历史清单里的发布和现场验收不再决定该功能收口。

**Architecture:** 不新建发布 Spec。场景文本留在原 Spec 或既有 QA 文件里，执行编号继续由 E2E 主线持有。升级建议书、概览和 Spec 头部只写产品出口。已有行为断言的产品合同收口；没有断言的产品承诺保持未收口。未执行的发布编号不改成通过。

**Tech Stack:** Markdown 登记。验收命令只有 `npm run lint:spec-docs`。不改运行代码，不重跑产品测试。

## Global Constraints

- 产品合同收口的证据是已经存在的本机行为断言。没有断言的产品句子保持未收口。
- 发布、现场、客户单副本、Wave 0b、`blocked_delivery` 从这四条的现行状态里退出。它们留在 [E2E 主线 Spec](../specs/lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md) 或既有 QA 矩阵。
- 未执行保持未执行。拆出、删除现行状态、合并到 E2E，都不等于通过。
- 历史版本行不回改。同一文件里和头部冲突的现在时，改成现行归属，或紧贴「已作废，不得当作现值」。
- 不再写「未执行且不排期」。不再写「不可交付 UAT」。
- 功能合同收口写「本条收口不表示可上线」。
- 改状态时，同一次改完 Spec 头部、建议书现行状态、`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md` §9。写之前重读版本行，概览和建议书各取 current+1。
- 提交只在用户要求时做。

## 四条怎么处理

| 清单 | 产品 | 发布和现场 |
|---|---|---|
| L25-14 P0 行权限 | 维持已收口。出口仍是 R2／R4／R5 | V01–V22、C19、客户 Linux 大写 Schema、Wave 0b 退出升级状态。执行编号已是 E2E 的 `ROW25-V01`…`ROW25-V22` |
| L25-02／03 审计只读对账 | 只收口已有本机断言的读取合同。没有断言的产品句子保持未收口 | V01–V12 退出升级状态。执行编号已是 E2E 的 `ARV25-V01`…`ARV25-V12` |
| 2026-10-19 审计可信度 | 运行时合同指向已收口的 L25-09 S01–S07，不新收一份 | EA-01–EA-36 留在 QA 矩阵，退出这条的未收口原因 |
| L25-11 语义批量 | 维持 FC-01–FC-32 已关闭。G30 是产品缺口，留一行，不把整条重新打开 | `SEM25-V01`…`V22`、Wave 0b、客户交付退出升级状态。E2E 已持有 `SEM25` |

R1／R3 的 RTV-07 翻译防御缺口留在产品清单，不并进这次发布删除。

---

### Task 1: 写通过记录

**Files:**
- Create: `docs/reviews/2026-11-02-upgrade-list-product-release-split.md`

- [x] **Step 1:** 写记录。结论是只改升级清单的现行归属。逐条抄上表。写明未执行的 `ROW25`、`ARV25`、`SEM25`、EA 不改成通过，不重跑测试，不改运行代码，不表示可上线。

- [x] **Step 2:** 在 `docs/README.md` 第 3 节复核表最上方加这一行。

---

### Task 2: L25-14 从升级状态里拿开发布

**Files:**
- Modify: `docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md` 头部、§9 表前、§14.7(c)、§14.8、§14.9
- Modify: `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` §2.8 状态
- Modify: `docs/governance/project-overview.md` §9 行权限行
- Modify: `docs/README.md` 该 Spec 索引行

- [x] **Step 1:** 头部状态保持「P0 已收口。出口只含 R2／R4／R5」。补一句：V01–V22 与 C19 归 E2E 的 `ROW25`，不决定本条收口，不记通过。本条收口不表示可上线。

- [x] **Step 2:** §9 表前的现行句改成：这些行是场景文本，执行归 `ROW25`，不决定 L25-14 是否收口。

- [x] **Step 3:** §14.7(c) 和 §14.8 里「C14–C18 未验收、C19 待正式验收、V01–V22 全部未执行、D-03 仍 open」若是现在时，改成：该轮记录已作废，不得当作现值。现行出口见头部与 §14.9。D-03 的现行值以 §14.9 的 `fixed` 为准。

- [x] **Step 4:** 建议书 §2.8、概览 §9、`docs/README.md` 改成与头部同一句。删掉「已实现未验收」作为现行状态。

---

### Task 3: L25-02／03 只收口已有断言

**Files:**
- Modify: `docs/specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md`
- Modify: `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` L25-02、L25-03 状态
- Modify: `docs/governance/project-overview.md` §9 对账行
- Modify: `docs/README.md` 该 Spec 索引行
- Modify: `docs/reviews/2026-11-02-upgrade-list-product-release-split.md`

- [x] **Step 1:** 列出已有本机断言，只收这些。已知落点是 `webui/server/__tests__/audit-reconciliation-routes.test.ts`：三个只读端点存在；用量端点返回六项覆盖检查，缺证据保持 `unknown`。同目录里其他 `audit-reconciliation*.test.ts`、`audit-v025-as-of-proof.test.ts` 若断言的是本 Spec 的读取失败关闭或诊断披露，一并列入出口。

- [x] **Step 2:** 没有断言的产品句子单独列表，状态写未收口。不把它们挪去发布，也不写成通过。浏览器详情、真实事件全集、CSV 与页面同源，归发布。

- [x] **Step 3:** 头部改成两句。第一句写已收口的读取合同和文件名。第二句写未收口的产品句子仍未收口。V01–V12 归 `ARV25`，不决定本条产品收口，不记通过。本条收口不表示可上线。

- [x] **Step 4:** §7 与 §3.6.3 的「V01–V12 全部未执行」改成：这些编号归 `ARV25`。其中已有本机断言的读取合同见头部。没有断言的产品句子仍未收口。

- [x] **Step 5:** 建议书 L25-02、L25-03、概览、README 改成与头部同一句。删掉「整条未验收」。

---

### Task 4: 审计可信度退出升级核心

**Files:**
- Modify: `docs/specs/lucy-20261019-audit-trust-and-admin-investigation-spec.md` 状态行
- Modify: `docs/qa/audit-trust-and-admin-investigation-acceptance.md` 文首
- Modify: `docs/reviews/2026-11-02-upgrade-list-product-release-split.md`

- [x] **Step 1:** Spec 状态改为：运行时合同见 L25-09 S01–S07，该合同已收口。管理员第一现场的页面接入保留为历史事实。EA-01–EA-36 是现场清单，不决定这条是否收口，不进入版本升级清单。

- [x] **Step 2:** QA 矩阵文首加一段：本文件是现场验收清单。执行状态保持原样，不改成通过。它不是 v0.25 升级建议书的现行状态。

- [x] **Step 3:** 不把这份 2026-10-19 Spec 写进升级建议书。概览里若有把它当成未收口升级项的现行句，改成 Task 4 Step 1 的同一句。

---

### Task 5: L25-11 的升级状态只留产品

**Files:**
- Modify: `docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md` 头部、§1.5、§10 表前
- Modify: `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` §2.5 状态
- Modify: `docs/plans/lucy-20261030-semantic-batch-functional-contract-plan.md` 状态行，若它仍把 `SEM25` 写成这条未完成
- Modify: `docs/governance/project-overview.md` §9 语义批量行
- Modify: `docs/README.md` 该 Spec 与其 Plan 的索引行

- [x] **Step 1:** 头部状态改为：已关闭。出口是 FC-01–FC-32。G30 仍开，不回开已关闭的 FC。`SEM25` 归 E2E，不决定本条收口，不记通过。本条关闭不表示可上线。

- [x] **Step 2:** 从这句现行状态里删除 Wave 0b、`blocked_delivery`、V01–V22 未执行、G31、W-B。这些留在 E2E 主线和 L25-16 自己的状态里。

- [x] **Step 3:** 「评审状态」行里「应先补齐实现再安排完整 UAT」「V01–V22 全部未执行」若是现在时，改成：该对齐记录已作废，不得当作现值。现行状态见头部。

- [x] **Step 4:** §10 的 V 表前加一段：本表归 `SEM25`，不决定 FC 是否关闭，行状态不改成通过。

- [x] **Step 5:** 建议书 §2.5、语义批量 Plan、概览、README 改成与头部同一句。

---

### Task 6: 登记版本并检查

**Files:**
- Modify: `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` 版本行
- Modify: `docs/governance/project-overview.md` 版本行

- [x] **Step 1:** 写之前重读两份文件的顶部版本。各加一条 current+1。内容只写：四条清单的发布和现场退出升级现行状态；产品只收口已有断言的部分；未执行的发布编号不改成通过。

- [x] **Step 2:** 跑 `npm run lint:spec-docs`。预期：通过，0 条 stale-status。

- [x] **Step 3:** 搜索建议书现行状态段。L25-14 不再写「已实现未验收」。L25-02／03 不再写「V01–V12 全部未执行」作为整条状态。L25-11 不再把 `SEM25` 或 Wave 0b 写成这条未关闭。

- [x] **Step 4:** 不提交，除非用户要求。

## 目标

版本升级清单只保留产品合同。四条历史清单里的发布和现场不再决定该功能收口。

## 开工前置

用户已批准按本计划执行。证据用仓库里已经存在的本机断言，不新跑产品测试。

## 验收

`npm run lint:spec-docs` 通过，0 条 stale-status。建议书现行状态段里，L25-14 不再写「已实现未验收」。L25-02／03 不再用「V01–V12 全部未执行」作为整条状态。L25-11 不再把 `SEM25` 或 Wave 0b 写成这条未关闭。

## 完成定义

四条清单的发布和现场已退出升级现行状态。产品只收口已有断言的部分。未执行的发布编号不改成通过。

## 风险

把未执行的 `ROW25`、`ARV25`、`SEM25` 或 EA 写成通过。本记录不表示可上线。
