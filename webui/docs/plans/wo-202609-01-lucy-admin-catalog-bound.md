# WO-202609-01 — lucy_admin Catalog-Bound Role

| 元数据 | 内容 |
|---|---|
| 文档名称 | WO-202609-01 lucy_admin Catalog-Bound |
| 文档类型 | Work Order |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-02 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec 131；ADR-AC-07；lucy_admin Spec 与实现计划 |
| 适用范围 | 实现 `source_scope: catalog_bound`、预置模板 `lucy_admin`、lint、Admin UI、单测与 demo 种子 |
| 输出位置 | `webui/docs/plans/wo-202609-01-lucy-admin-catalog-bound.md` |

---

## Goal

交付 Spec 131：预置运维数据面 Role `lucy_admin` + `allow.source_scope: catalog_bound`，在已声明 connections 内随 `enabled_tables` ∩ source map 扩权，且可审计、不绕过 AbsoluteDeny。

## Code paths

| 区域 | 文件 | 改动 |
|---|---|---|
| ACL compile | `webui/server/proxy/acl.ts` | `compileRole` 支持 `catalog_bound`；读 `enabled_tables`；扩权计数含 catalog_bound |
| Types | `webui/server/admin/agents.ts`、`webui/src/lib/types.ts` | `source_scope?: "catalog_bound"` |
| Template | `webui/server/admin/role-templates.ts` | 新增 `lucy_admin` |
| Lint | `scripts/lint-spec.mjs` | 白名单 `source_scope`；互斥与 v2 校验 |
| Role UI | `webui/src/pages/admin/RoleDetail.tsx` | scope 切换、互斥、高权限警示 |
| Demo seed | `examples/docker-demo/project-template/webui/config/access.yaml` | 正式 Role `lucy_admin`（可选 demo Agent 不强制） |
| Tests | `kx-acl` / `admin-roles` / lint / RoleDetail | 见矩阵 |

## Implementation notes

1. `EnabledTables`：`readProject` / `readConnections` 已暴露 `enabledTables`；compile 路径按 project root 读取，规范化后与 `physicalTable` 比较。
2. `catalog_bound` + 非空 `tableSelectors` → `role_resolution_failed:<id>:catalog_bound_selectors_forbidden`（或等价 reason）。
3. `catalog_bound` + `permission_model_version !== 2` → 失败。
4. 扩权：扩展 `countV1PrefixSources`（或并列计数）纳入 catalog_bound Role 的 source 基数；sourceMapVersion 变化且计数增大 → `emitPolicyScopeExpanded`。
5. UI：`source_scope=catalog_bound` 时清空/禁用 selectors；payload 不带 `tableSelectors`；对 `lucy_admin` 或 catalog_bound 显示警示文案（不得称 WebUI 所有者）。

## Test matrix

| ID | 场景 | 期望 |
|---|---|---|
| T1 | catalog_bound + demo connection + enabled tables | 可查全部 enabled sources |
| T2 | 同连接新增 enabled 表后重编译 | 可查新表；`policy_scope_expanded` |
| T3 | 第二连接未写入 connections | deny / 无 capability |
| T4 | tools 含 `*` 或 AbsoluteDeny | 编译/lint fail |
| T5 | catalog_bound + names selectors | 编译 fail |
| T6 | 既有 names Role | 回归绿 |
| T7 | 模板 `lucy_admin` 出现在 `GET /api/admin/roles?includeTemplates=true` | source=template |

## Demo seed

`examples/docker-demo/.../access.yaml` 增加 `lucy_admin` Role（`connections: [demo-mysql]`，`source_scope: catalog_bound`，显式 tools）。不强制新增默认业务 Agent。

## Rollback

- 回滚 ACL 对 `source_scope` 的分支；lint 去掉字段；删除模板与 demo Role。
- 已落盘含 `catalog_bound` 的客户配置在回滚后会 `role_resolution_failed`（fail-closed），需先迁回 `names`。

## Out of scope

- `connections: ["*"]`、WebUI 登录自动 MCP Token、AbsoluteDeny 解禁、v2 prefix。

## Status note（2026-09 P1 修复）

审阅阻断已修复：`enabled-tables` → `commitEffectivePolicy`；正式 id=`lucy_admin` 模板提升；`policyVersion` 含 `enabledTablesDigest`；AbsoluteDeny 保存 fail-closed；扩权集合差 + await 审计；Agent/Token 高权限警示。
