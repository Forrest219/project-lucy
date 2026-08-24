# Connection Create (Admin) — Design / Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Create (Admin) Plan |
| 文档类型 | Plan |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-20 |
| 撰写人 | Composer |
| 委托人 | xingchen |
| 基于材料 | `webui/docs/124-connection-create-admin-spec.md` v0.1；产品决议 Q1=B / Q2=B |
| 适用范围 | Spec 124 设计交付与后续实现认领 |
| 输出位置 | `webui/docs/plans/wo-202608-58-connection-create-admin.md` |

**Goal:** 设计并（后续）实现 WebUI **新建连接**：一次性密码写入 `.ktx/secrets/<id>-password`，`ktx.yaml` 仅存 `file:`；门禁沿用现状 local-admin 信任。

**本轮状态:** Phase A（API）与 Phase B（UI）已实现；Phase C（手册翻转）未开工。

**Architecture:** `CreateConnectionDrawer` → `POST /api/connections`（dryRun 默认 true）→ `safeWriteNewSecretPassword` + YAML Document 插入 `connections.<id>` / `setup.database_connection_ids` → `ktx connection test` → 失败整单回滚。

**Tech Stack:** Fastify、yaml Document、fs-safe 窄例外、React Query、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 设计轮：对齐 Spec 124；列出实现工作包 |
| v0.2 | Phase A/B 落地：勾选 WP；手册翻转仍属 Phase C |

---

## Non-Negotiable Boundaries

- 不引入 WebUI 登录鉴权（Q1=B）；手册必须写清暴露面风险。
- 不提供 secrets 读取 / 列表 / 轮换 UI；禁止覆盖已存在密码文件。
- 不做编辑凭据、不做删除连接。
- 不自动 ingest、不自动改 `access.yaml`。
- 密码不得出现在 API 响应、审计 diff、前端持久 state。
- 实现轮默认不做浏览器验证。

## Scope

### 设计

- [x] Spec 124
- [x] 术语标准登记 Create Connection 相关词
- [x] 本 Plan（工作包与验收指针）

### 实现

#### Phase A — Server（见 `wo-202608-58a-…`）

- [x] `safeWriteNewSecretPassword` / 回滚删除 + 单测
- [x] `createConnection()` YAML 补丁 + dryRun 脱敏
- [x] `POST /api/connections` + test 失败回滚 + audit

#### Phase B — UI（见 `wo-202608-58b-…`）

- [x] `CreateConnectionDrawer`
- [x] `/connections` PageHeader / 空态 CTA
- [x] enabled-tables / test 空态文案

#### Phase C — Docs flip

- [ ] `design-db-connection.md` §八、Spec 26、SYSTEM_HANDBOOK、feature-map、help 断言

## Workload（相对体量）

见 Spec 124 §9：WP1–WP7（安全写 / 核心补丁 / API 回滚 / Drawer / 接线 / 文档 / 回归）。主风险：secrets 例外与失败回滚。

## Acceptance Pointers

以实现 Spec 124 §10 为准。

## Out of Scope

WebUI Auth；Edit/Delete Connection；Secret 管理台；自动 ACL 同步。
