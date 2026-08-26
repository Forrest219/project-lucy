# Connection Delete Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Delete Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-25 |
| 撰写人 | Cursor Grok 4.6 |
| 委托人 | xingchen |
| 基于材料 | `/connections` 核实无删除连接入口；Spec 124 Non-Goal「不删除连接」；Spec 117 移除 Schema dryRun / 可选清文件模式；`CreateConnectionDrawer` / `RemoveSchemaDrawer` |
| 适用范围 | `/connections` 连接卡片「删除连接」；`POST /api/connections/:connId/remove`；`ktx.yaml` 连接键与 `setup.database_connection_ids`；可选约定密码文件与本地 YAML 资产；ACL / Wiki 仅影响预览 |
| 输出位置 | `webui/docs/127-connection-delete-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 127 |
| 关联工单 | 本轮直接落地（无独立 WO 包） |
| 关联页面 | `/connections` |
| 上游 Spec | Spec 124（新建连接）；Spec 117（移除 Schema）；Spec 26 Runbook；ADR-05 / ADR-11 |
| 状态 | Implemented |
| 日期 | 2026-08-25 |
| 范围 | 从 `ktx.yaml` 删除整条连接配置；dryRun 影响面；可选删约定 secret 与 `semantic-layer/<connId>/` YAML；不改 `access.yaml`、不删 Wiki、不触碰物理库 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地：对称新建连接的删除闭环；翻转 Spec 124「删除仍手工」 |
| v1.1 | 确认区显式展示连接 ID；卡片「删除连接」改为与同组 secondary 一致 |

## 1. 背景

连接概览已提供「新建连接」，但无删除入口；后端亦无对称 API。Spec 124 将删除划为 Non-Goal，因为需要单独设计 Schema / Manifest / ACL / `enabled_tables` / secrets 级联。误建连接或下线旧库时，只能手改 `ktx.yaml`，且易遗留 secret、Manifest 与角色引用。

本 Spec 补齐删除，并明确哪些必须写、哪些可选删、哪些只告警。

## 2. 目标

1. 连接卡片提供 **删除连接** 入口（危险次要动作，不得与「新建连接」Primary 并列）。
2. API 默认 `dryRun:true`：展示脱敏 `ktx.yaml` diff、将带走的 Schema / 已启用表、约定 secret 是否可删、本地 YAML 资产候选、角色 ACL 引用、Wiki 引用。
3. 确认写入时 **必须**：删除 `connections.<connId>`；若存在则从 `setup.database_connection_ids` 移出该项。该连接的 `schemas` / `enabled_tables` 随键一起消失。
4. 可选（默认不勾）：删除约定路径密码文件 `.ktx/secrets/<connId>-password`；删除 `semantic-layer/<connId>/` 下现存 YAML 资产。
5. **不**改写 `access.yaml`（只列出仍引用该连接的 Role）；**不**删除业务 Wiki 正文。
6. 确认前须原样输入连接 ID。
7. 审计 `change_type=connection_delete`；diff / 响应 **脱敏**。
8. **不**连接物理库、**不** DROP 远端库/Schema/表。

## 3. Non-Goals

| 非目标 | 理由 |
|---|---|
| 不删除 / 重命名物理数据库 | 配置卸载，不是 DBA 删库 |
| 不自动改写 `access.yaml` | Role Admin 是 ACL 写入路径；本单只预览引用，避免双通道改权限 |
| 不删除 Wiki Markdown | 与 Spec 117 一致：只统计失效 `sl_refs` |
| 不删除评测用例、发布包历史 | 独立治理 |
| 不编辑连接凭据 / 不轮换密码 | Spec 124 仍保留 |
| 不引入 WebUI 登录鉴权 | 沿用 ADR-05 |
| 不做浏览器 / E2E 验证 | 与连接模块近期交付一致：Vitest + terminology + build |

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Delete Connection | 删除连接 | 删除链接、删除联接、删除数据库、删库 | 从 `ktx.yaml` 卸载整条连接配置；不触碰物理库 |
| Connection Delete Impact | 删除影响 | — | dryRun 摘要：Schema、已启用表、secret、YAML 资产、Role、Wiki |
| Confirm Connection ID | 输入连接 ID 以确认 | — | 确认写入前须原样输入目标连接 ID |
| Delete Password File (optional) | 同时删除密码文件 | 默认级联删除密钥 | 仅约定 `.ktx/secrets/<connId>-password` |
| Delete Connection YAML Assets (optional) | 同时删除本地 YAML 资产 | 默认级联删除 | `semantic-layer/<connId>/` 下 Manifest / overlay |

Forbidden：把「删除连接」写成「移除 Schema」或「删除数据库」。Protected DOM：连接 ID、`file:` 路径、`.ktx/secrets/…`、`semantic-layer/…`、Role ID、Wiki 路径 → `translate="no"` + `notranslate`。

## 5. API

### 5.1 `POST /api/connections/:connId/remove`

Body：

```ts
{
  dryRun?: boolean;     // 默认 true
  deleteSecret?: boolean; // 默认 false；仅约定密码文件
  deleteAssets?: boolean; // 默认 false；仅 semantic-layer/<connId>/**/*.yaml
}
```

`:connId` 须匹配 `CONNECTION_ID_PATTERN`。目标必须已存在于 `connections.<connId>`，否则 `404 CONNECTION_NOT_FOUND`。

### 5.2 dryRun 响应 `DeleteConnectionPreview`

```ts
{
  diff: string;                 // 脱敏 unified diff
  proposedYaml: string;         // 脱敏
  connectionId: string;
  schemas: string[];
  enabledTables: string[];
  impact: {
    canDeleteSecret: boolean;
    secretRelPath: string | null;   // 仅约定路径且当前 password 指向它时
    yamlAssetPaths: string[];
    aclRoleIds: string[];           // access.yaml 中仍引用该连接的 Role
    wikiRefCount: number;
    wikiSamplePaths: string[];      // 最多 5 条
  }
}
```

约定密码文件：`password` 为 `file:` 且解析后等于 `<projectRoot>/.ktx/secrets/<connId>-password`。其它 `file:` / `env:` / inline **不可**经本 API 删除。

`yamlAssetPaths`：递归列出 `semantic-layer/<connId>/` 下现存 `.yaml` / `.yml`（跳过不安全路径段）。

`aclRoleIds`：`roles.*.allow.connections` 含该 ID，或 `roles.*.allow.tableSelectors[].connection` 等于该 ID。文件缺失或无法解析时视为无引用，不阻断删除。

### 5.3 写入响应 `DeleteConnectionResult`

```ts
{
  written: true;
  auditId?: number;
  connectionId: string;
  deletedFiles: string[];
}
```

写入顺序：

1. `writeKtxYaml`：删除 `connections.<connId>`；从 `setup.database_connection_ids` prune 该项（Document 就地补丁）。
2. 若 `deleteSecret` 且 `canDeleteSecret`：`safeRemoveSecretPasswordIfExists`。
3. 若 `deleteAssets`：对预览中的 `yamlAssetPaths` 逐个 `safeRemove`。
4. `recordConfigChange`：`changeType: "connection_delete"`，`targetId: connId`，`diff` 为 ktx unified diff。

`deleteSecret=true` 但 `canDeleteSecret=false` → `400 CONNECTION_DELETE_SECRET_NOT_ELIGIBLE`（先于写 yaml）。

yaml 写入失败则不删文件。文件删除失败时 yaml 已提交：残留孤儿文件可手工清理；响应仍 `written:true` 并只列入实际删掉的路径。不回滚 yaml（避免「文件已删、连接还在」的半成品；文件删除失败的半成品是「连接已删、文件还在」，可重试或手工删）。

**不**要求 `ktx connection test`。

### 5.4 错误码

| Code | HTTP | 条件 |
|---|---|---|
| `CONNECTION_ID_INVALID` | 400 | 连接 ID 不合法 |
| `CONNECTION_NOT_FOUND` | 404 | `ktx.yaml` 无该连接 |
| `CONNECTION_DELETE_SECRET_NOT_ELIGIBLE` | 400 | 要求删 secret 但路径非约定 |
| `KTX_YAML_PARSE_ERROR` | 500 | YAML 不可解析 |
| `FORBIDDEN_PATH` | 403 | 可选删除路径越界 |

## 6. UI（`/connections`）

1. 连接卡片 footer 增加 **删除连接**（与同组「+ 添加 Schema / 重新拉取库内目录 / 同步配置变更」同为 `pl-btn pl-btn--secondary`；**不得**做成 Primary 或幽灵链接）。
2. `DeleteConnectionDrawer`：打开即 dryRun → 影响预览 + 可选项 + 输入连接 ID → 确认。标题区与确认输入框均显式标注 **连接 ID** 及待输入值。
3. 预览必须展示：Schema 数、已启用表数（可展开）、约定密码文件是否可删、YAML 资产数、Role 引用、Wiki 引用页数。
4. 勾选区默认全关。文案说明：不删物理库；`access.yaml` 与 Wiki **不会**被本操作改写。
5. 确认按钮在连接 ID 原样匹配前 disabled。
6. 成功：Toast「已删除连接: \<id\>」；关闭 Drawer；invalidate project / connections / sources / catalogReloads / 该连接 tables 与 live-schemas。

## 7. 验收

1. 有 Schema 与启用表的连接：dryRun 列出将随键消失的项；确认后 Overview 不再显示该卡片，其它连接不变。
2. `setup.database_connection_ids` 含该 ID 时写入后不再含。
3. 默认不勾：secret 与 `semantic-layer/<connId>/` 文件仍在。
4. 勾选删约定 secret + YAML 资产：对应文件经安全删除消失；Wiki / `access.yaml` 仍在。
5. inline / 非约定 `file:` 密码：勾选删 secret 被禁用；若 API 仍传 `deleteSecret:true` → `CONNECTION_DELETE_SECRET_NOT_ELIGIBLE`。
6. 未知连接 → `CONNECTION_NOT_FOUND`。
7. 确认按钮在未输入正确连接 ID 时不可点。
8. 单测覆盖 project + API envelope + drawer/overview；`lint:terminology` 通过。
9. 本轮不做浏览器验证。

## 8. Design System Compliance

- 引用：`design-system/10-components-button.md`（同组并列维护动作为 secondary；危险确认在 Drawer 内用 `pl-btn--danger`；不得升 Primary）。
- PageHeader「新建连接」仍为唯一 primary。
- 删除连接放在卡片 footer，与「+ 添加 Schema」同层级 chrome，不可逆确认留在抽屉。

## 9. 交叉引用

- 修订 Spec 124：删除连接从 Non-Goal 改为指向本 Spec。
- Spec 117：本操作删除整条连接；Schema 行「移除 Schema」仍用于收缩单个 Schema。
- Spec 15 Role Admin：残留 Role 引用需运维在角色管理中手工清理；本单只预览。
