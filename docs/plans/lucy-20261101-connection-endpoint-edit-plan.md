# 连接服务器地址编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

| 元数据 | 内容 |
|---|---|
| 状态 | **v0.3 功能合同已收口（2026-11-01）**。r1–r3=A；Task 0–5 勾销；SC-01–SC-23 全部关闭。收口记录见 [`docs/reviews/2026-11-01-connection-endpoint-edit-closure.md`](../reviews/2026-11-01-connection-endpoint-edit-closure.md)。本条收口不表示可上线 |
| 主 Spec | [`docs/specs/lucy-20261101-connection-endpoint-edit-spec.md`](../specs/lucy-20261101-connection-endpoint-edit-spec.md) **v0.3** |
| 审阅 | r1 / r2 见 `inbox/2026-11-01-connection-endpoint-edit-spec-plan-cross-review-r{1,2}.md` |
| 授权边界 | 仅实现 Spec v0.3：endpoint 编辑、编辑专用门禁、`safeOverwriteSecretPassword`、Drawer（`connections/` 目录）、`current` 预填、live-tables presence、审计标签、手册结论性同步、术语登记。**不**改 connection id/schemas/enabled_tables/ACL、命名环境档、`createConnection` 回滚、`testConnection` failureKind；**不**要求浏览器 E2E |
| 验收 | Spec SC-01–SC-23 |

**Goal:** 连接概览可就地编辑服务器地址；测通后落盘；保留连接身份。

**Architecture:** `updateConnectionEndpoint` + `decideEndpointEditGate`（复用 Spec 160 匹配键，排除自身）+ `safeOverwriteSecretPassword`；锁内回滚基线；响应 `current` / `presence` / `executionRuntimePending`；前端 `EditConnectionDrawer`（专用冲突提示，不复用新建 EndpointConflictPanel 动作）。

**Tech Stack:** Fastify、fs-safe、ktx connection test、React Drawer、Vitest。

## Global Constraints

- 回滚基线 = 持锁后 `oldText` / 旧 secret 字节
- 测失败与审计失败必须回滚
- 非约定 `file:` 密码来源拒绝 replace；不得产生孤儿 secret
- 编辑门禁不用 `decideEndpointGate` / `conflictSchema`
- presence 强制三态，永不回滚成功写入
- 成功文案禁止「问数已切到新库」
- PageHeader primary 仍为「新建连接」

---

## 1. 目标

落地 Spec v0.3（方案 A + r1–r3 审阅闭口项）。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | Spec v0.3 + Plan v0.3 定稿；r1–r3 交叉审阅 | **满足**（r3=A） |
| P2 | 开发授权 | **满足**（2026-11-01「授权你开发」） |
| P3 | Task 0 文档交叉引用 | **满足** |

## 3. 文件地图

| 文件 | 职责 | SC |
|---|---|---|
| `webui/server/fs-safe.ts` + `__tests__` | `safeOverwriteSecretPassword`；new-only 回归 | SC-04 |
| `webui/server/connection-endpoint-gate.ts` | `decideEndpointEditGate` | SC-06/07/20 |
| `webui/server/project.ts` | `updateConnectionEndpoint`；`lucy-ops` 禁改 | SC-01–05,08–10,16–18,23 |
| `webui/server/live-tables.ts` / `admin/live-discovery.ts` | presence 复用（按需只读调用，本条可不改实现） | SC-10 |
| `webui/server/index.ts` | 路由；detail 白名单；`executionRuntimePending` | SC-15,19–21 |
| `webui/server/model.ts` | 请求/响应类型（含 `current` / `presence`） | — |
| `webui/server/__tests__/project.connection-endpoint-update.test.ts` | 核心服务端 | SC-01–10,16–18,23 |
| `webui/server/__tests__/api.connection-endpoint-update.test.ts` | HTTP | SC-15,19–21 |
| `webui/src/components/connections/EditConnectionDrawer.tsx` | Drawer + 编辑冲突提示 | SC-11/12/22 |
| `webui/src/pages/connections/ConnectionOverview.tsx` | 入口 | SC-11/13 |
| `webui/src/__tests__/edit-connection-drawer.test.tsx` | 组件 | SC-11–13,22 |
| `webui/src/lib/configAuditLabels.ts` | `connection_endpoint_update` 中文标签 | SC-09 可见性 |
| `webui/docs/00-product-terminology-standard.md` | New terms | SC-14 |
| `docs/SYSTEM_HANDBOOK.md` 等 | 结论性表述翻转 | Task 5 |
| `webui/docs/03-api-spec.md` | 路由行（若维护） | — |

## 4. 任务

### Task 0: 文档交叉引用

- [x] Spec / Plan / 索引 / 124·26·160·127 后继注记（v0.1）
- [x] Spec / Plan 升 v0.2（吸收 r1）
- [x] Spec / Plan 升 v0.3（吸收 r2 残留 P1/P2）

### Task 1: RED — 服务端合同

- [x] 写齐核心 SC 服务端测试（`project.connection-endpoint-update.test.ts`）
- [x] 确认失败原因对齐 Spec

### Task 2: GREEN — fs-safe + gate + updateConnectionEndpoint

- [x] `safeOverwriteSecretPassword` + create new-only 回归
- [x] `decideEndpointEditGate` + index detail 白名单
- [x] `updateConnectionEndpoint`（锁内基线、密码来源拒绝、`lucy-ops` 禁改、presence 边界、审计回滚）
- [x] 单测转绿

### Task 3: API 路由

- [x] `POST /api/connections/:connId/endpoint`
- [x] API 专测文件 `api.connection-endpoint-update.test.ts`（SC-15／19／20／21）
- [x] 可选：`03-api-spec.md` 一行——本轮未改；不阻塞收口

### Task 4: Drawer + 概览

- [x] 组件测 SC-11/12/22
- [x] `EditConnectionDrawer`（编辑专用冲突提示）
- [x] 概览「编辑连接」入口
- [x] SC-13：PageHeader「新建连接」为唯一实心 primary

### Task 5: 术语、手册、门禁、收口

- [x] 术语标准登记；`lint:terminology` exit 0
- [x] SYSTEM_HANDBOOK 结论性句子
- [x] `configAuditLabels.ts`
- [x] `lint:spec-docs` 通过
- [x] Spec/Plan 状态 → 功能合同已收口（见收口记录）

## 5. 验收

```bash
cd webui && npx vitest run \
  server/__tests__/project.connection-endpoint-update.test.ts \
  server/__tests__/api.connection-endpoint-update.test.ts \
  src/__tests__/edit-connection-drawer.test.tsx \
  server/__tests__/fs-safe*.test.ts
cd webui && npm run lint:terminology
npm run lint:spec-docs
```

浏览器 / docker 不在出口。

## 6. 完成定义

- Task 1–5 勾销；SC-01–SC-23 有通过记录
- 本条收口不表示可上线

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 误用新建门禁 | 独立 `decideEndpointEditGate`；SC-06/20/22 |
| 削弱 create secret | new-only 回归测 |
| 手册残留「只能改 yaml」 | Task 5 扫结论性句 |
| presence 拖慢 | ≤10s；`not_completed` |
| 持锁 30s 测连接 | Spec 已文档化 |
