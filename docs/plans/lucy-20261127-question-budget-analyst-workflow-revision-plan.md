# 问询预算分析师工作流修订 Implementation Plan

> **For agentic workers:** REQUIRED：按任务落地；步骤用 checkbox。开发授权已获得。本条不表示可上线。

**Goal:** 按 REQ-0122 Spec D1–D8／OQ-4／OQ-6，在保留 runaway 防火墙前提下，让 Claude Code ＋ 慢数仓（hive-jd）分析师主路径不再被 4 路硬并发、轻重同桶、30s 超时与失败全额 busy、30s 取消冻结、偏保守停机文案频繁打断。

**Architecture:** Lucy Proxy 问询预算层（`question-experience.ts`）做轻重分层计费、失败封顶结算、并发／续查默认放宽；容量舱壁（`mcp-execution-capacity.ts`）抬默认档并为 `lucy_read_source` 接独立元数据池；`mcp-proxy.ts` 对齐超时／取消冻结与 concurrency 信封；interactive `data-qa-instructions`／动态指引修订（D7）。不改 KTX；不改 integration 静态极简指引。

**Tech Stack:** TypeScript／Node Lucy MCP Proxy、vitest、Docker demo MCP、真实 Claude Code（UAT 另授后跑）。

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.1** / 2026-11-27 |
| 主 Spec | [lucy-20261126-question-budget-analyst-workflow-revision-spec.md](../specs/lucy-20261126-question-budget-analyst-workflow-revision-spec.md)（**v1.0-r8**） |
| 编号 | **REQ-0122** |
| 阶段 | S3 |
| 状态 | S4｜**实现已落地＋UAT 已执行**：Tasks 0–5 全部完成（demo 镜像 2026-11-27 23:39 重建成功，health＋MCP catalog/query 冒烟通过，新档位 8/16/32/48 生效）；UAT-SUITE-BUDGET-ANALYST-UX v1.1 跑次 **PASS WITH FINDINGS**（2026-11-28，[跑次](../qa/uat/suites/budget-analyst-ux/runs/2026-11-28-kscc-budget-analyst-ux.md)）；F1–F3 待裁定；≠ 功能合同收口；≠ 可上线 |
| 授权边界 | 允许改运行代码／单测／demo 验证；**未授权** push／发布／客户出包／`--fresh` 除非另授 |
| 验收 | Spec SC-01–SC-12＋SC-02b＋SC-07b ↔ UAT-SUITE-BUDGET-ANALYST-UX v1.1；跨 Spec IMC-03 混合臂 |
| 实施主体 | Lucy；不改 KTX |

## Global Constraints

- 保留 runaway：主桶 60 次；轻工具 200／窗；硬执行 120s；protocol reason 码不变。
- OQ-4：窄 `failedKind`；无连败 N reason；跨窗靠既有续查档。
- OQ-6＝A：跨窗总界＝共用续查档；无 `metaCallsLifetime`／速率护栏。
- D7 仅 interactive；integration 指引归 REQ-0119。
- 平滑升级；默认不用 `--fresh`。
- 主路径双覆盖：约束生效＋合法成交。

---

## 文件地图

| 文件 | 职责 |
|---|---|
| `webui/server/proxy/question-experience.ts` | D1 分层、D2 inflight 默认／env、D3 busy 默认／env、D4 封顶结算、D6 active 续查、metaCalls、concurrency 信封 |
| `webui/server/runtime/mcp-execution-capacity.ts` | D2 四层默认 8/16/32/48；元数据池 16/64 |
| `webui/server/proxy/mcp-proxy.ts` | D3 超时默认、D5 cancel hold、容量分池路由、concurrency `next_step`、interactive 指引数字 |
| `webui/config/data-qa-instructions.md` | D7 文案 |
| `webui/server/__tests__/question-budget-*.test.ts` 等 | 单测／合同回归 |
| `docs/qa/uat/suites/budget-analyst-ux/` | 已 v1.1；本 Plan 不改设计，仅实现后另授跑次 |

---

## Task 0 — 默认常量与环境变量（D2／D3／D5／D6／D8 可配骨架）

- [x] 写／改失败单测：默认 `MAX_INFLIGHT=8`、`MAX_BUSY_MS=900_000`、active 续查 3、cancel hold 5s、upstream idle 90s／hard 120s、capacity `8/16/32/48`
- [x] 实现常量与 `env` 覆盖（含回退 SC-11 变量集）
- [x] 跑相关 vitest 至绿

## Task 1 — D1 轻重分层＋metaCalls（含 OQ-6 换窗清零）

- [x] 失败单测：轻工具不占 calls／busy／query inflight；第 201 次 meta 触顶；换窗清零 metaCalls
- [x] 实现 `QUERY_TIER`／`METADATA_TIER`、`metaCalls` 状态字段与持久化兼容
- [x] vitest 绿

## Task 2 — D4／OQ-4 失败封顶结算

- [x] 失败单测：`failedKind` 窄集合封顶 30s；`no_data` 不封顶；审计 raw／billed
- [x] 扩展 `settle(...)` 入参与 audit 写入
- [x] vitest 绿

## Task 3 — D2 元数据并发池＋超限信封

- [x] 失败单测：`lucy_read_source` 走 meta 池；第 17 路拒绝；重查询第 9 路含 `retryable`／`retryAfterMs`／`next_step.reduce_concurrency_and_retry`
- [x] 实现分池与拒绝载荷
- [x] vitest 绿

## Task 4 — D7 interactive 指引

- [x] 合同测试：无 `"stop looping"` 首句倾向；含并发上限与缩并发重试；busy 文案跟 900s
- [x] 改 `data-qa-instructions.md` 与 proxy 动态指引
- [x] vitest 绿

## Task 5 — 组装回归与 demo 冒烟

- [x] 定向跑 question-budget／capacity／instructions 相关单测
- [x] `npm run demo:upgrade`（平滑，保留 volume）冒烟：health＋一次 MCP catalog／query — **已完成（2026-11-27 23:43）**：`docker/dockerfile:1.7` 前端镜像补拉后重建成功，health ok＋catalog/query 成交＋新档位生效
- [x] 回写 Spec／Plan 状态（实现进度）；**不**主张 UAT PASS；不申请发布

## 非目标（本 Plan）

- 不跑完整 UAT-SUITE-BUDGET-ANALYST-UX（须另授跑次）
- 不改 REQ-0119 实现主线（仅保持 D2 基线一致；IMC-03 混合臂随 0119 开发）
- 不 push／出包

## 开工前置

- 开发授权：委托人 2026-11-27 明示「授权开发」（Spec v1.0-r8 状态行同句）。
- 依赖闭合：PRE-01 证据已落盘（`inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md`）；Spec §10.3 六项已同步进 UAT v1.1；OQ-4／OQ-6 已裁定。
- 环境前提：本机 Docker Desktop 可用；demo 栈 volume 保留（平滑升级，禁 `--fresh`）。
- 跨 Spec 基线：REQ-0119 r1 已确认 D2 四层默认（8/16/32/48）为两 Spec 共同基线，本条先落地。

## 验收

- 验收合同：Spec SC-01–SC-12＋SC-02b＋SC-07b ↔ UAT-SUITE-BUDGET-ANALYST-UX v1.1 全用例；跨 Spec IMC-03 混合臂勾连。
- 双覆盖：每条约束臂（防火墙拦得住 runaway）与成交臂（合法高频工作流端到端）同时覆盖；BA-12A／12B 须真实 Claude Code 轨迹。
- 实跑结果：2026-11-28 跑次 **PASS WITH FINDINGS**（R0／01–12B 全 PASS；发现 F1–F3 待裁定，见跑次报告）；F1／F2／F3 均已修复＋实机回归闭合（SC-03 全子点闭合）。

## 完成定义

- Tasks 0–5 全勾：常量／分层／封顶／分池／指引落地，定向单测绿，demo 镜像重建＋冒烟通过（2026-11-27 23:43）。
- UAT 跑次落盘并入 INDEX／需求池镜像／e2e 台账，机检（`lint:spec-docs` 增量、`check-e2e-ledger`）通过。
- 终态：F1–F3 裁定闭环且 SC 全关后，Spec 才可推进 S5（功能合同已收口）；本 Plan 不代替该裁定。

## 风险

- F1（并发拒绝不退账）：高频撞并发场景加速预算耗尽；修复需在 capacity 拒绝路径补 refund 或调整 consume 顺序，须回归 question-budget／capacity 单测与 BA-03／09 拒绝臂。
- F2（预算层 inflight 并发记账失真）：并发下预算层闸门可能失效退化为 capacity 层单层防护；容量防火墙仍有效（capacity 层拦得住），但 reason 语义与 Spec 伪码分层不一致。
- F3（reason 码命名偏差）：客户端可见协议字面变化须谨慎；若裁定改实现 reason 码，需同步 instructions 文案与单测断言；若修订 Spec，需在 D2 登记双层命名。
- BA-12 agent 臂的并发信封触发依赖时序（快查询可能整批穿过 8 路闸），复跑不保证复现；缩并发语义以 harness 臂＋单测为准。
- UAT-IMC-03 混合臂未执行：REQ-0119 套件落地前，本条 SC-03 的跨 Spec 组合证据保持开口。
