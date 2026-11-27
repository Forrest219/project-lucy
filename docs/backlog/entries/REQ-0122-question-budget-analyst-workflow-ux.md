# REQ-0122：问询预算面向分析师高频工作流与慢数仓（hive-jd）体验修订

| 元数据 | 内容 |
|---|---|
| 文档类型 | 常青需求池单条正文（一需一档）。**不是**功能 Spec，**不构成**开发授权 |
| 稳定 ID | `REQ-0122` |
| 类型 | `需求`（主路径体验严重缺陷修复） |
| 优先级 | `P0` |
| 阶段 | `S2`（Spec v1.0 终稿已确权 2026-11-27，D1–D8 全案采纳推荐案 (a)；UAT 套件已登记；**开发未授权**，PRE-01 抓包为开工前置门禁） |
| 目标版本 | `—`（P0，建议候选 `v0.35.0`，待委托人挑入范围单） |
| 授权边界 | **入池 ≠ 立项 ≠ 终稿确权 ≠ 开发授权**。进入开发前须：PRE-01（Claude Code `mcp-session-id` 三模式抓包）→ 配对 Plan → 委托人另发开发授权 |

## 来源与背景

- 提出日期／来源：2026-11-26／委托人（xingchen）审阅反馈。当前问询预算规格（60 次／300s 忙时／4 路并发）按「单路串行、亚秒级 MySQL 轻量问数」假设校准，对重度使用 Claude Code ＋ Lucy MCP 且强依赖慢分析型外部目录（SelectDB／Doris 外部 Hive Catalog `hive-jd`）的数据分析师形成五个高频干扰点：并发硬闸撞墙、轻重工具同桶争抢、慢查询 30s 超时叠加失败全额计 busyMs、Esc 中断后槽位锁死 30s、`"stop looping"` 文案诱发提前收口。定性为严重用户体验 Bug。
- 现状：窗口优化（settled busyMs）、P1-12（60 次／300s）、P1-74（两段式逃生）已落地，但默认并发／超时／计费分层未适配并行 Agent ＋ 慢数仓实况。

## 已裁定方向（2026-11-27，D1–D8 全案采纳 (a)）

- **D1** 轻重分层：主预算桶仅计重查询工具（`lucy_query`／`lucy_certified_route`／`lucy_report_template`）；轻工具（`lucy_read_source`／`lucy_freshness`／`lucy_explain_query`／`wiki_search`／`wiki_read`）独立 200 次／窗，不占 busyMs 与查询并发槽。
- **D2** 并发：预算层 `MAX_INFLIGHT` 4→8；容量层默认 `token 8 / agent 16 / connection 32 / global 48`；`lucy_read_source` 接独立元数据并发池（`token 16 / global 64`），保留 `UPSTREAM_SEMANTIC_TOOLS` 不破 Strat-B DRAIN；超限返回 `retryable: true`＋`retryAfterMs`＋`next_step.reduce_concurrency_and_retry`。
- **D3** 忙时与超时：`busyMs` 300s→900s（可配）；上游空闲超时 30s→90s、硬时限 90s→120s（与预算绝对执行时限对齐）。
- **D4** 失败封顶记账：超时／失败调用计入 `busyMs` 单次封顶 30s，原始耗时全量审计。
- **D5** 取消未确认冻结 30s→5s（可配，0 为不保留）。
- **D6** `begin active` 续查档数 1→3（`inactive` 保持 5）。
- **D7** 修订 `initialize` 指导与 `data-qa-instructions.md`：移除首句 `"stop looping"`，改为静默逃生引导＋并发规则披露。
- **D8** 全部新默认值环境变量可覆盖回退（SC-11 逐变量验证）。

## 期望方向（非实现承诺）

- Claude Code 并行 5–8 工具调用不再撞硬闸；超限可按结构化 `next_step` 自愈缩并发重试。
- 慢数仓 45–90s 查询正常出数并如实记账；上游抖动不迅速打空窗口。
- Esc 中断后 5s 内可重问；长会话可逃生时模型静默续跑。
- runaway 防火墙、settled busy 口径、ACL、协议 reason 码全部保留。

## 非目标与边界

- 不取消问询预算；不改 KTX 源码；不做跨副本分布式限流；不新增 WebUI 页面；per-connection 超时配置（OQ-1）留二期。

## 关联

- Spec：[docs/specs/lucy-20261126-question-budget-analyst-workflow-revision-spec.md](../../specs/lucy-20261126-question-budget-analyst-workflow-revision-spec.md)
- UAT：[docs/qa/uat/suites/budget-analyst-ux/suite.md](../../qa/uat/suites/budget-analyst-ux/suite.md)
- 修订对象：[Spec 162 §7.2](../../webui/docs/162-customer-query-experience-and-usage-evidence-spec.md) · [窗口优化 Spec](../../specs/lucy-20261029-question-budget-window-optimization-spec.md) · [P1-12 阈值放宽](../../specs/lucy-20261111-question-budget-threshold-relax-spec.md) · [P1-74 主路径逃生](../../specs/lucy-20261122-question-budget-mainpath-escape-spec.md)
- 勾连测试台：[UAT-SUITE-BUDGET-ESCAPE](../../qa/uat/suites/budget-escape/suite.md)（BESC-07／10A 回归臂由本条套件补齐）· [UAT-SUITE-QUESTION-BUDGET](../../qa/uat/suites/question-budget/suite.md)
- 跨 Spec 基线（2026-11-27 r1）：[REQ-0119](../../specs/lucy-20261127-integration-mcp-capacity-backpressure-spec.md)（C1 案 A：本条 D2 为两 Spec 共同基线；其 workload 门覆盖本条轻工具元数据池；本条先落地、REQ-0119 压测随后）
- 常青需求池：[docs/backlog/README.md](../README.md)
