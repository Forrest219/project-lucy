# 概念注册表接入 Lucy Ops 控制面 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / **v0.5** |
| 日期 / 目标版本 | 2026-11-09 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无 |
| 状态 | **v0.5；R2-F＋R3（O1＝A／O2＝B）＋R4 已闭合（2026-11-09）；实现中（Cursor）；未宣称可上线**（P1-11／REQ-030-032）。本条不表示可上线 |
| 授权边界 | **R4 已授予（2026-11-09）**。按 S1–S7 改运行代码；**不含**本版 WebUI；**不含**问数热路径注入 |
| 验收 | Spec SC-01–SC-22；步骤出口见下表 |
| 对应 Spec | [lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md](../specs/lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md)（v0.5） |
| 需求池条目 | REQ-030-032 |
| 清单条目 | P1-11 |
| 上游 | P1-10／REQ-030-031 |
| 评审记录 | [Codex 对抗](../reviews/2026-11-09-concept-registry-lucy-ops-control-plane-codex-review.md) |

## 变更记录

| 版本 | 说明 |
|---|---|
| v0.1-draft | 正式立项 |
| v0.2-draft | D2b：本版 Ops／下版 WebUI |
| v0.3-draft | Codex R1 闭合 F-01…F-09 |
| v0.4-draft | Codex R2 闭合残留（部分） |
| v0.5-draft | Codex R3 后作者侧闭合：幂等核验序（D20）、半进位恢复（D21）、whitelist／目标映射（D22）、execute 内核验（D23）、SC-21／22；**不再开第 4 轮 Codex** |
| v0.5 | 委托人 **R2-F** 认可 v0.5；**O2＝B**；**R4 开发授权（2026-11-09）**；实现中 |

> **For agentic workers:** R4 已授予；按本 Plan 改 `scripts/concepts/**` 与 `webui/server/**`（差分边界内）。

## 目标

1. Ops MCP 成为概念权威主交付面。
2. 纯计算核心与 P1-10 单一语义；适配器只做授权／计划／锁／审计。
3. 关闭 Spec SC-01–SC-22。

## 开工前置

1. R2-F＋R3（O1＝A／O2＝B）＋R4 已闭合（2026-11-09）。
2. P1-10 `concepts:test` 绿作语义基线。
3. 与 P0 争文件时 P0 优先。

## 文件结构（拟）

| 路径 | 职责 |
|---|---|
| `scripts/concepts/{plan,apply}.mjs`（或拆出 pure API） | `planScan`／`applyScanPlan`／`planSetCanonical`／`planReject`；CLI 改调此层 |
| `webui/server/ops/concepts-adapter.ts` | 根解析 D11/D12、调纯计算、组装写集 |
| `webui/server/ops/control-plane.ts` | 登记六工具规格（§2.1） |
| `webui/server/ops/ops-batch.ts` 复用 | preview/commit／digest／claim |
| `webui/server/ops/ops-tools.ts` | **只读旁路**：list／show／summary 不入计划机 |
| `webui/server/proxy/acl.ts`／known_tools | 可见性／登记 |
| 测试 | 授权矩阵、digest 竞态、只读不建目录、服务⇄纯计算对照、SC-09 问数参数基线 |

### 差分边界

允许：上表；`scripts/concepts/**` 纯 API 重构；本条 Spec／Plan／review／清单／需求池／README；术语若需。  
禁止：问数热路径行为变更；WebUI 产品页；无关 package scripts。

## 实施步骤

| 步骤 | 内容 | 产出 | SC |
|---|---|---|---|
| S0 | O2＝B 已落笔；冻结工具登记表（待 R4 后执行登记） | 决策纸 | O2 |
| S1 | 纯计算 API＋**D20 realpath／symlink 围栏**；CLI 改调；旧测试仍绿 | plan/apply＋SC-19 | D18 |
| S2 | 登记六工具＋I／O 合同；只读旁路；grant 示例；SC-10 核对无 WebUI diff | SC-01／05／06／10／13／16／18 | D15／§4.6 |
| S3 | 内容根＋scan 单组 staging＋中断恢复阻断＋execute 内后像核验＋空写集拒绝＋幂等核验序 | SC-07／08／12／15／17／20／21／22 | D14／D16–D23 |
| S4 | set_canonical／reject 两段式（计划载荷执行） | SC-02／03／04／20 | — |
| S5 | 服务⇄纯计算对照 | SC-11 | — |
| S6 | `CONCEPT_OPS_DIFF_BASE`＋归属差分＋问数夹具双比较 | SC-09 | D19／F-09 |
| S7 | 文档降级 CLI；状态镜像 | SC-14 | — |

## 浏览器验证

不适用：本条仅交付 Lucy Ops MCP 控制面，不改变用户可见 WebUI 表面，无浏览器验收步骤

## 验收

| 步骤 | 出口 |
|---|---|
| S0 | O2＝B 已裁定（2026-11-09） |
| S1 | 纯 API 可 preview 不写盘；CLI 仍绿 |
| S2 | 只读无计划／不建目录；授权矩阵测试 |
| S3 | digest 竞态拒绝；batch 全有或全无 |
| S4 | 权威保护夹具 |
| S5 | 适配器对照通过 |
| S6 | SC-09 基线断言通过 |
| S7 | 文档与清单同句 |

## 完成定义

- SC-01–SC-22 关闭有测试证据。
- 本版无 WebUI 概念页。
- 未宣称问数准备率提升。

## 风险

| 风险 | 缓解 |
|---|---|
| ops-tools 只读旁路漏接 | S2 显式分支＋SC-16 |
| 纯 API 抽取破坏 CLI | S1 先绿再接 Proxy |
| 控制面基建未 VOPS 全绿 | 复用已合并分支；本条自带矩阵测试 |

## 回滚

下线六工具登记与 grant；保留 `concepts/` 与 CLI。无 DB 迁移（控制面计划行可保留至自然过期）。
