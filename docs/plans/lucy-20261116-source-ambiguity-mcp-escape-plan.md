# 表级歧义门闩：纯 MCP 逃生与拒绝载荷持久修复 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | **v0.3**／2026-11-16 |
| 状态 | **v0.3；R2-F＋R4 已闭合（2026-11-16）；实现已合入；ESCAPE UAT INDEX＝PASS（cursor-sag-escape-retest）；GAP-UAT-P0-3-ESCAPE 已关。≠ D5／功能合同收口 ≠ 可上线** |
| 授权边界 | R2-F＋R4 已闭合（2026-11-16）。可按本 Plan 改运行代码；**≠ 可上线** |
| 验收 | Spec SC-E01–SC-E19；ESCAPE INDEX＝**PASS**（收紧后 ESC-01／02／03 全绿）；SAG-01 v2 deny；D5＝H1／H2／F1 vitest；`lint:spec-docs`。**GAP 关闭 ≠ 功能合同收口**。**≠ 发布取证／可上线** |
| 台账号 | 无 |
| 目标分支 / 产品线 | `lucy-v0.30`／`0.30.0` |
| 需求来源 | 清单 **P1-35**；**REQ-030-056**；父 P0-3／REQ-030-024 |
| Spec | [lucy-20261116-source-ambiguity-mcp-escape-spec.md](../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md)（**v0.3-draft**） |
| 错题／评估／评审 | [deadlock](../lessons/2026-11-16-source-ambiguity-gate-deadlock.md)；[可用性评估](../reviews/2026-11-16-source-ambiguity-gate-availability-assessment.md)；[Codex 过程对抗](../reviews/2026-11-16-source-ambiguity-mcp-escape-codex-review.md) |
| 测试台 | [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md) |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) |

> **For agentic workers（获 R4 后）:** 按 Task 顺序 TDD；每 Task 末独立可测。REQUIRED：`verification-before-completion`。未获 R4 **不得**改 `webui/server/proxy/**` 运行代码。

**Goal:** 持久修复纯 MCP 下表级歧义死路：钉选放行＋真实 repair 证据；不以 kill switch 结案；显式接受 D9 集内错表残余风险。

**Architecture:** 按 Spec §4.1 优先级在 `checkSourceAmbiguityGate` 插入 D1／D3；`mcp-proxy` **必须**向 gate 传入完整身份探测＋本次 args；`buildRepairEvidenceForGate` 按 Spec §4.4 抬严接线；宿主 person confirm 保留 HTTP 403，不作唯一逃生。

**Tech Stack:** Lucy MCP Proxy（TypeScript）、既有 `source-ambiguity-gate.ts`／`question-experience.ts`／vitest／demo Docker UAT。

## Global Constraints

- 父 Spec 未声明修订处仍有效；不得关闭「未形成 D1」的多表硬拦。
- 禁止 kill switch 作为本 Plan 出口。
- 禁止削弱 SC-17 **HTTP 403**；不得再声称完整「用户参与才成交」语义不变（Spec D9）。
- 术语遵守 `webui/docs/00-product-terminology-standard.md`。
- Docker 对齐；默认不谈客户 K8s 部署。
- **允许**修订 SAG-01／ESCAPE suite 文以对齐 Spec §5.2；禁止把 ESC-01 期望改回 deny。

---

## 1. 目标

1. **D1／D3／D9**：唯一 ACL 可见钉选且满足 D1 → allow（含 never_begun）；集内自选钉选为显式合同。
2. **D5**：**H1**（≥1 候选五项全真）usable 必须非空且无假 Schema 刷屏；**H2** 允许空但失败原因须齐全；**F1** 故障夹具诚实分态。
3. **D8**：ESCAPE INDEX＝PASS；修订后 SAG-01 deny；ESC-02／03 不回退。

## 2. 开工前置（R4 前）

1. Spec 过程对抗收束后 **R2-F**（Codex CLI 终审或委托人明示确权）。
2. O1＝本波不做；O2＝不降级五项（**已在 Spec 闭合**）。
3. **R4 开发授权**另发后才改运行代码。
4. 基线：当前 ESCAPE INDEX＝FAIL；证据 `inbox/uat-sag-escape-2026-11-16/`（可删）。
5. 文档波：SAG-01 v2 cases／suite 注明／ESCAPE 回链 P1-35（可与过程审并行，仍 ≠ 改运行代码）。

## 3. 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `webui/server/proxy/source-ambiguity-gate.ts` | 修改 | §4.1 优先级；D1／D3；`buildRepairEvidenceForGate` 接收探测＋args |
| `webui/server/proxy/mcp-proxy.ts` | 修改 | **必须**传入 sourceMap／completion／args；审计 reason 族不变 |
| `webui/server/proxy/question-experience.ts` | 复用／小改 | `buildRepairClosure`；健康／故障文案分态 |
| `webui/server/proxy/acl.ts` | 只读复用 | `collectCanonicalSourceKeys` |
| `webui/config/data-qa-instructions.md` | 小改 | 多表时可钉选唯一完整来源身份后重试；禁止暗示「只能宿主 confirm」 |
| `webui/server/__tests__/source-ambiguity-gate.test.ts`（及／或新文件） | 修改／新增 | SC-E01–E18 可单测部分 |
| `docs/qa/uat/suites/source-ambiguity-gate/cases.md` | 修订 | SAG-01 v2（§5.2） |
| `docs/qa/uat/suites/source-ambiguity-mcp-escape/*` | 修订回链 | 合同指向 P1-35 Spec |
| `docs/specs/lucy-20261107-source-ambiguity-gate-spec.md` | 头部镜像 | 收口后加修订指针 |
| UAT ESCAPE／INDEX／e2e-ledger | 复跑／同句 | INDEX＝PASS 后关 GAP |

**不应被多 agent 同时修改：** `source-ambiguity-gate.ts`、`mcp-proxy.ts` 门闩段。

## 4. 任务分解

### T0：决策闭合与夹具（文档／过程审）

- [x] Codex R3（三轮上限）→ 修订 Spec／Plan
- [x] R2-F 回写状态行（委托人明示 2026-11-16）
- [x] O1／O2 已闭合（本波不做／不降级）
- [x] SAG-01 v2；ESCAPE cases 收紧；SAG-02 期望拆分；索引同句
- [x] 锁定夹具：ESC-01／02／03；双身份 SAG-01；H1／H2／F1；SC-E19 目录失败
- **验证：** 状态行同句；cases 与 Spec §5／§5.2 一致

### T1：钉选放行纯函数（TDD；需 R4）

- [x] 写失败单测：SC-E01／E05／E06／E13／E14／E19
- [x] 实现 §4.1／伪代码（健康独立于空 hits）
- [x] 单测绿
- **验证：** vitest 覆盖上列

### T2：Proxy 接线与上游计数

- [x] mcp-proxy 插入点走更新后 gate；query／explain 分支分别断言
- [x] 钉选路径可执行；未钉选／双钉选路径执行计数 0
- **验证：** SC-E10／E12／E15／E16（单测＋host-confirm HTTP）

### T3：五项证据接线（D5）

- [x] 失败单测：SC-E07／E08（H1／H2）／E09（F1）／E18
- [x] 扩展 `buildRepairEvidenceForGate`；mcp-proxy **必须**传探测＋args
- [x] 抬严＋§4.4 重试参数改写规则
- **验证：** H1 usable 非空；H2 空但原因齐；F1 诚实

### T4：instructions 与 SC-17 HTTP 回归

- [x] 更新 ASK_FIRST／data-qa-instructions：钉选放行说明（含 D9；不写「已确认」）
- [x] host confirm 403 仍绿（SC-E04）；SAG-02 期望已拆
- **验证：** SC-E04／E11

### T5：UAT 翻绿与台账

- [x] 获 R4 且实现合入 demo 后：全真跑 ESCAPE → INDEX＝**PASS**（[cursor-sag-escape-retest](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-retest.md)）
- [x] SAG-01 v2 回归 deny（同跑次伴生）
- [x] 关 `GAP-UAT-P0-3-ESCAPE`（逃生缺口；**叙事禁止**写成 D5／P1-35 已收口）
- [ ] 功能合同收口另证 SC-E07–09／E18／E19
- [x] INDEX／ledger／总账跟进状态**同句**
- **验证：** 上句；**≠** 可上线

## 5. 明确不做

- kill switch 当出口
- 全面「有限定名就跳过」（集外钉选仍须 deny）
- 削弱 person 宿主 confirm **HTTP** 403
- 声称已消灭集内错表误报（D9 残余）
- 未授权改客户包／Helm
- 以 PASS WITH GAP 关闭本条 GAP
- 以 GAP 关闭代替 D5／功能合同出口

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 钉错候选表成交 | D9 显式接受；SC-E05／E14；Eval 另线 |
| D5 探测引入重读／DESC 坑 | §4.4；禁止为探测取数 |
| 与评估「不建议 B」叙事冲突 | Spec＝收窄钉选＋D9，非全面跳过 |
| 旧 SAG-01 与 ESC-01 期望对撞 | §5.2 已拆分合同 |
| GAP 与功能合同混淆 | §7 范围拆分 |

## 7. 完成定义

- [ ] Spec 状态可写功能合同收口（SC-E01–E19 齐）且 R4 已执行
- [ ] ESCAPE INDEX＝PASS；SAG-01 v2 不回退
- [ ] 总账 P1-35 跟进状态与 Spec 头部同句
- [ ] **仍 ≠ 可上线**

## 变更

| 版本 | 内容 |
|---|---|
| v0.1-draft | 2026-11-16｜首落盘 |
| v0.2-draft | 2026-11-16｜对齐 Spec v0.2 |
| v0.3-draft | 2026-11-16｜对齐 Spec v0.3：健康分离、H1／H2／F1、ESC 收紧、GAP≠D5、SC-E19 |
