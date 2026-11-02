# Token 续期 Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

| 元数据 | 内容 |
|---|---|
| 状态 | **v0.4 功能合同已收口（2026-11-02）**。SC-01–SC-24 关闭。SC-25 已拆出。本条收口不表示可上线 |
| 主 Spec | [`docs/specs/lucy-20261101-token-renewal-spec.md`](../specs/lucy-20261101-token-renewal-spec.md) |
| 授权边界 | 定稿＋明示开工前仅文档／审阅。开工后：renew API、Tokens／Agent Token UI、审计枚举与 redaction／中文标签、术语标准、selector-contract、相关测试。不改 KTX；不改 Step6；不引入自动续期；不要求浏览器／docker。Gate 政策变更必须回 Spec，禁止私自降级。须实现 repair 重试与 Proxy 对齐的旧值解析 |
| 验收 | SC-01–SC-24 已关闭。SC-25 已拆出 |

**Goal:** 显式续期（含过期）；撤销不可续；严格延长；审计与失败关闭完备。

**Architecture:** `POST .../tokens/:label/renew`；锁内强制查 `revoked_tokens`；复用 create 的 expiry normalize、owner 委托门禁、governance gate 矩阵与 display barrier。

**Tech Stack:** Fastify、React、Vitest、auditedWriteFile

## Global Constraints

- 响应禁止明文；禁止移出 `revoked_tokens`
- 打开续期对话框默认 365d
- 高流量 gate = `warn`（与创建一致），不得跳过

## 1. 目标

落地 Spec 续期合同。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | Codex 再审可定稿 | **满足**（第 4 轮） |
| P2 | 委托人明示开工 | **满足**（2026-11-01） |
| P3 | 四门禁有记录 | **有记录**（收口记录，不在本条出口） |

## 3. 任务

### Task 0: 再审定稿

- [x] Codex 第 1–4 轮；v0.4 文档定稿

### Task 1: RED — API／策略

- [x] 续期校验：Proxy 对齐旧值解析、严格延长、date-only 日终、过期可续、缺省／null 可设、撤销表命中
- [x] dryRun；gate 路径与 create 对齐（高流量 warn）
- [x] repair 同值重试成功（`admin-tokens.test.ts`）

### Task 2: GREEN — 服务端

- [x] 实现 renew 路由与伪代码顺序
- [x] `token_renew` 审计、configAuditLabels、agents SQL 白名单
- [x] 策略单测 + API 测（撤销残留、缩短拒绝、过期可续）

### Task 3: GREEN — 前端

- [x] 续期入口＋对话框（打开时 365d）
- [x] Toast／文案；selector-contract
- [x] 「30 天内到期」含续期

### Task 4: 术语与手册交叉

- [x] 术语标准登记 Renewal／Rotation
- [x] 手册补充续期≠换签

### Task 5: 收口

- [x] SC-01–SC-24 由本机 vitest 关闭，含委托 owner 与 ack／审计故障注入
- [x] `lint:spec-docs`、`lint:spec`、`lint:terminology`、`lint:ia-boundary`

## 4. 验收

以 SC-01–SC-24 为准。SC-25 已拆出。

## 5. 完成定义

Task 勾销；SC 关闭；收口不表示可上线。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 半失败撤销被续 | SC-04／SC-05；Task 1 |
| repair 无审计成功 | SC-22／SC-24 |
| Gate 被私下跳过 | 授权边界＋SC-09–SC-11 |
| 失败仍成功 Toast | SC-21–SC-23 |
| 严格延长卡住 ack 重试 | repair 路径＋SC-22 |
