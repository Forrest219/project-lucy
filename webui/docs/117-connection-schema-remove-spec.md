# Connection Schema Remove Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Schema Remove Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `:55176/connections` 浏览器核查（仅「+ 添加 Schema」、无移除）；`docs/design-schema-onboarding.md` v1 Non-Goal；批准改善方案（Phase 1 必做 + Phase 2 可选清文件） |
| 适用范围 | `/connections` Schema 行「移除 Schema」；`POST /api/connections/:connId/schemas/remove`；本地 Manifest / overlay 可选清理；Wiki 仅影响预览 |
| 输出位置 | `webui/docs/117-connection-schema-remove-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 117 |
| 关联工单 | `wo-202608-50-connection-schema-remove` |
| 关联页面 | `/connections` |
| 关联台账 | `docs/ui-ux-feedback/pages/connections.md`（`UX-CONNECTIONS-034`） |
| 上游 Spec | M6 / `docs/design-schema-onboarding.md`（ADR-11）；Spec 21 / 107 / 116；`03-api-spec.md` schemas |
| 状态 | Implemented |
| 日期 | 2026-08-06 |
| 范围 | 从连接配置卸载 Schema（必清 `schemas` + 前缀 `enabled_tables`）；dryRun 影响面；可选删 Manifest/overlay；Wiki 只告警不删 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地：对称 Add Schema 的移除闭环；修订 design-schema-onboarding「不做删除」 |

## 1. 背景

连接概览已提供「添加 Schema」，但无移除入口；后端亦无对称 API。M6 将「删除 / 重命名 schema」划为 v1 Non-Goal。运维误加 Schema、或需收缩启用范围时，只能手改 `ktx.yaml`，且易遗留 `enabled_tables`——`readConnections` 会把 `enabled_tables` 推导出的 schema **合并进** UI 列表，导致「删了 schemas 名仍显示」。

批准方案：提供「移除 Schema」配置卸载能力，并明确表范围、本地 YAML、业务 Wiki 的处理边界。

## 2. 目标

1. Overview Schema 行提供 **移除 Schema** 入口（危险次要动作，不与 Primary 并列）。
2. API 默认 `dryRun:true`：展示 `ktx.yaml` diff、将移出的已启用表、Manifest/overlay/Wiki 影响摘要。
3. 确认写入时 **必须**：从 `connections.<connId>.schemas` 移除该项（若存在）；**必须** prune 该 schema 前缀的全部 `enabled_tables`。
4. 可选（默认不勾）：删除 Schema Manifest、删除可解析到的 semantic overlay 文件；**不**删除业务 Wiki 正文。
5. 审计 `change_type=schema_remove`；引导「同步配置变更」。
6. **不**连接物理库、**不** DROP 远端 Schema/表。

## 3. Non-Goals

- 不删除 / 重命名物理数据库中的 Schema。
- 不自动改写或删除 Wiki Markdown（仅统计失效 `sl_refs`）。
- 不在本单清理评测用例、角色 ACL、发布包历史。
- 不重命名 Schema；不跨连接移动 Schema。
- 不做浏览器验证（本轮结束后只做 code review）。

## 4. 术语

| Canonical | UI 主术语 | 禁止 | 说明 |
|---|---|---|---|
| Remove Schema | 移除 Schema | 删除数据库、删库、删除架构/模式 | 从连接配置卸载 Schema；不触碰物理库 |
| Schema Remove Impact | 移除影响 | — | dryRun 摘要：已启用表、Manifest、overlay、Wiki 引用 |
| Delete Schema Manifest (optional) | 同时删除 Schema Manifest | 默认级联删除 | 可选勾选；默认关 |
| Delete Semantic Overlays (optional) | 同时删除 semantic overlay | 默认级联删除 | 可选勾选；默认关 |

交叉：`Invalid Enabled Table`（Spec 116）仍用于「Manifest 无 / enabled 有」；本 Spec 是主动卸载配置，方向相反。

## 5. API

### 5.1 `POST /api/connections/:connId/schemas/remove`

Body：

```ts
{
  schema: string;
  dryRun?: boolean;           // 默认 true
  deleteManifest?: boolean;   // 默认 false；dryRun=false 时才落盘删除
  deleteOverlays?: boolean;   // 默认 false
}
```

定位规则：Schema 名须匹配 `SCHEMA_NAME_PATTERN`。目标存在条件为下列之一：

- 显式出现在 `connections.<connId>.schemas`；或
- 存在 `enabled_tables` 项以 `<schema>.` 为前缀。

否则 `404 SCHEMA_NOT_FOUND`。

### 5.2 dryRun 响应 `RemoveSchemaPreview`

```ts
{
  diff: string;
  proposedYaml: string;          // 已脱敏
  oldSchemas: string[];
  newSchemas: string[];
  removedEnabledTables: string[];
  impact: {
    hasManifest: boolean;
    manifestPath: string | null; // semantic-layer/<conn>/_schema/<schema>.yaml
    overlayPaths: string[];      // 将可删的 overlay 相对路径（预览）
    wikiRefCount: number;        // 含匹配 sl_refs 的页面数
    wikiSamplePaths: string[];   // 最多 5 条 wiki 相对路径
  }
}
```

`overlayPaths` 解析来源（并集，**跳过不安全路径段**）：

1. 若 Manifest 可读：其 `tables` 键名 → `semantic-layer/<conn>/<table>.yaml`（文件存在才列入）。
2. `removedEnabledTables` 中的表名 → 同上。

表名 / connectionId 须匹配安全路径段正则（字母数字下划线连字符；禁止 `/`、`\`、`..`）。不安全键不进入预览，更不会进入 `safeRemove`。

### 5.3 写入响应 `RemoveSchemaResult`

```ts
{
  written: true;
  auditId?: number;
  oldSchemas: string[];
  newSchemas: string[];
  removedEnabledTables: string[];
  deletedFiles: string[];        // 实际经 safeRemove 删除的相对路径
}
```

写入顺序：

1. `writeKtxYaml`：移除 schemas 项 + prune `enabled_tables`（Document 就地补丁；不动 host/password 等）。
2. 若 `deleteManifest`：`safeRemove` Manifest（不存在则跳过）。
3. 若 `deleteOverlays`：对预览并集中仍存在的 overlay 逐个 `safeRemove`。
4. `recordConfigChange`：`changeType: "schema_remove"`，`targetId: "<connId>:<schema>"`，`oldSummary`/`newSummary` 含 schemas 与 removedEnabledTables 摘要，`diff` 为 ktx unified diff。

**不**要求 `ktx connection test`（移除不依赖连通；与 Add 对称处仅保留 dryRun/审计/就地补丁）。

### 5.4 错误码

| Code | HTTP | 条件 |
|---|---|---|
| `SCHEMA_NAME_INVALID` | 400 | 名不合法 |
| `CONNECTION_NOT_FOUND` | 404 | 连接不存在 |
| `SCHEMA_NOT_FOUND` | 404 | schemas 与 enabled 前缀均无 |
| `KTX_YAML_PARSE_ERROR` | 500 | YAML 不可解析 |
| `FORBIDDEN_PATH` | 403 | 可选删除路径越界（fs-safe） |

## 6. UI（`/connections`）

1. Schema 行操作区增加 **移除 Schema**（`pl-row-action-link` 危险弱化样式，如 `--danger` / muted+danger；**不得**做成 Primary）。
2. `RemoveSchemaDrawer` 步骤：影响预览（自动 dryRun）→ 确认选项 → 成功。
3. 预览必须展示：将移出的已启用表数（可展开列表）、Manifest 是否存在、overlay 候选数、Wiki 引用页数（样本路径）。
4. 勾选区默认全关：「同时删除 Schema Manifest」「同时删除 semantic overlay」。文案说明 Wiki **不会**被删除。
5. 若 `removedEnabledTables.length > 0`，确认按钮旁二次提示「将移出 N 张已启用表」。
6. 成功：Toast「已移除 Schema: \<name\>」；引导 `同步配置变更`；invalidate project/connections/sources/tables/live/catalogReloads。

## 7. 验收

1. 有启用表的 Schema：dryRun 列出将 prune 的 `schema.*`；确认后 Overview 不再显示该 Schema（schemas 与 enabled 均无）。
2. 仅 schemas、无 enabled：移除后列表消失；磁盘 Manifest 默认仍在。
3. 勾选删 Manifest + overlay：对应文件经 `safeRemove` 消失；Wiki 文件仍在。
4. 未知 Schema → `SCHEMA_NOT_FOUND`。
5. 单测覆盖 project remove + API envelope + drawer/overview；`lint:terminology` 通过。
6. 本轮不做浏览器验证。

## 8. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Remove Schema → 移除 Schema
- Schema Remove Impact → 移除影响
- Delete Schema Manifest (optional) / Delete Semantic Overlays (optional)

禁止用户可见「删除数据库 / 删库 / 删除架构 / 删除模式」。专业英文与对象名节点须 `translate="no"` + `notranslate`。

## 9. Design System Compliance

- 引用：`design-system/10-components-button.md`（危险次要动作不得升 Primary）；Drawer / DiffViewer 沿用 Add Schema 模式。
- Schema 行内「移除 Schema」与「上传 Manifest」同属低权重 row action；Footer「+ 添加 Schema」层级不变。

## 10. 交叉引用

- 修订 `docs/design-schema-onboarding.md`：删除「不做删除」为历史；指向本 Spec。
- Spec 116：本操作主动 prune 前缀 enabled，与「不自动 prune 孤儿」不冲突（用户显式确认）。
- Phase 3（Wiki 失效标黄 / 发布校验）不在本 Spec。
