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
| 状态 | S3｜**开发授权已获得（2026-11-27）**；Tasks 0–4 已落地；Task 5 定向 vitest 全绿；demo 镜像重建因本机 Docker Hub `dockerfile:1.7` config resolve 挂起未完成（容器仍为旧档 capacity 4/8/16/24）；UAT v1.1 NOT RUN；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
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
- [ ] `npm run demo:upgrade`（平滑，保留 volume）冒烟：health＋一次 MCP catalog／query — **阻塞**：本机 BuildKit 解析 `docker/dockerfile:1.7` 挂起；现网 demo 健康但镜像未含本批改动
- [x] 回写 Spec／Plan 状态（实现进度）；**不**主张 UAT PASS；不申请发布

## 非目标（本 Plan）

- 不跑完整 UAT-SUITE-BUDGET-ANALYST-UX（须另授跑次）
- 不改 REQ-0119 实现主线（仅保持 D2 基线一致；IMC-03 混合臂随 0119 开发）
- 不 push／出包
