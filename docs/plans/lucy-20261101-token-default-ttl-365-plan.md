# Token 新建默认有效期 365 天 Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

| 元数据 | 内容 |
|---|---|
| 状态 | **v0.3 已实施，功能合同未收口（2026-11-02 核对）**。Task 0–4 已勾销。此前「开工前不改运行代码」作废。SC-01–SC-08 尚无逐条收口记录 |
| 主 Spec | [`docs/specs/lucy-20261101-token-default-ttl-365-spec.md`](../specs/lucy-20261101-token-default-ttl-365-spec.md) |
| 授权边界 | 定稿＋明示开工前仅文档。开工后：`token-expiry-policy` 默认常量、`NewToken.tsx` 与测试、Spec 124 §7、`SYSTEM_HANDBOOK`、UX Spec／索引覆盖注记。不改续期 API（另 Plan）、不改 Step6、不要求浏览器／docker |
| 验收 | SC-01–SC-08。SC-08 只含 Step6 短窗回归；术语 lint 与落盘清单已拆出 |

**Goal:** Admin 新建 Token 默认 365 天；文档口径一致。

**Architecture:** 改默认常量与 NewToken 初载；校验上限不变。

**Tech Stack:** TypeScript / React / Vitest

## 1. 目标

落地默认 TTL 365 与文档覆盖注记。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | Codex 对本 Spec／Plan 再审可定稿 | **满足**（第 2／3 轮） |
| P2 | 委托人明示开工 | **满足**（2026-11-01） |
| P3 | `lint:spec-docs`／`lint:spec`／`lint:terminology`／`lint:ia-boundary` 有记录 | 待办 |

## 3. 任务

- [x] Task 0：Codex 再审通过（文档定稿）
- [x] Task 1：RED — 默认常量与 NewToken 测试改为 365
- [x] Task 2：GREEN — 常量＋UI＋测试转绿
- [x] Task 3：Spec 124 §7、手册、UX Spec 文首注记、索引措辞
- [x] Task 4：SC-01–SC-08 留证；四门禁记录（本机 vitest + lint 绿）

## 4. 验收

SC-01–SC-08。

## 5. 完成定义

Task 勾销；SC 关闭；收口不表示可上线。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 与 UX Spec 旧 SC-02 双口径 | Task 3 注记覆盖 |
| 与续期 Plan 抢同一 PR | 可同 PR 但分 Spec 收口 |
