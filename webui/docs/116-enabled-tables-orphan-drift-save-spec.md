# Enabled Tables Orphan Drift Save Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Enabled Tables Orphan Drift Save Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `:55176` 复现（`starrocks-r1` 启用含 `demo_finance`/`meta` 孤儿、Manifest 仅 `ai`）；`PUT /api/connections/:connId/enabled-tables`；`TableWhitelist` 草稿模型；Spec 104 §5.2 drift 备注 |
| 适用范围 | 启用表范围保存门禁差分语义；`/connections/enabled-tables` 无效启用可见性与清理闭环 |
| 输出位置 | `webui/docs/116-enabled-tables-orphan-drift-save-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 116 |
| 关联工单 | Enabled Tables Orphan Fix plan |
| 关联页面 | `/connections/enabled-tables` |
| 关联台账 | `docs/ui-ux-feedback/pages/connections.md`（`UX-CONNECTIONS-031`）；交叉 `UX-CONNECTIONS-005` |
| 上游 Spec | Spec 47（启用表范围）；Spec 104（drift 暴露）；`03-api-spec.md` enabled-tables |
| 状态 | Implemented |
| 日期 | 2026-08-06 |
| 范围 | 差分门禁（仅拒绝新增未扫描表）+ warnings；UI 暴露无效启用并一键移出 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：孤儿启用不挡保存；新增仍须 Manifest；UI 清理闭环 |

## 1. 背景

`enabled_tables` 可含「本地 Schema Manifest 已不存在」的表（**无效启用 / 孤儿启用**）。启用表范围页只渲染 `GET .../tables`（已扫描表），草稿却默认等于全连接 `enabledTables`。保存时旧实现要求 `new ⊆ scanned`，导致勾选新 Schema 表时因看不见的孤儿报 `TABLE_NOT_SCANNED`，保存永久卡住。

## 2. 目标

1. **新增**启用必须仍在本地 Manifest；**保留**历史无效启用不阻塞同连接其它变更。
2. `/connections/enabled-tables` **暴露**无效启用，支持勾选取消与一键移出。
3. 保存成功若仍保留无效启用，以 warning 提示，不挡写入。

## 3. Non-Goals

- 不自动 prune / 静默删除 `enabled_tables` 中的无效项。
- 不改 `scannedPhysicalTables` 数据源（仍只读 `_schema/*.yaml`）。
- 不在本单做 ingest 或自动补 Manifest。
- 不改 Overview 本地表数 drift（M65 / UX-CONNECTIONS-005 已有）。

## 4. 术语

| Canonical | UI 主术语 | 说明 |
|---|---|---|
| Invalid Enabled Table | 无效启用 | `enabled_tables` 有、本地 Manifest 无的 `schema.table` |
| Remove Invalid Enabled | 移出无效启用 | 从草稿移除全部无效启用项 |

禁止：孤儿表（用户可见主文案）、表白名单（主导航禁用）。

## 5. API

### 5.1 `PUT /api/connections/:connId/enabled-tables`

设 `old` = 当前 `ktx.yaml` 该连接 `enabled_tables`，`scanned` = 本地 Manifest 物理表集，`new` = 请求体。

| 条件 | 行为 |
|---|---|
| `t ∈ new` 且 `t ∉ scanned` 且 `t ∉ old` | `400 TABLE_NOT_SCANNED` |
| `t ∈ new` 且 `t ∉ scanned` 且 `t ∈ old` | 允许写入；计入 `warnings` |
| 格式非法 / 重复 | 既有 `INVALID_*` / `DUPLICATE_*` |

`warnings` 项：

```jsonc
{ "code": "ENABLED_TABLE_NOT_SCANNED", "table": "demo_finance.ads_finance_revenue_day", "message": "..." }
```

dryRun 与 `dryRun:false` 均返回 `warnings`（可为空数组）。

### 5.2 不变式

- 空列表、仅删除（含删除无效启用）始终允许。
- 不得通过本 API **新引入**未扫描表。

## 6. UI（`/connections/enabled-tables`）

1. 每连接：`invalidEnabled = draft∪persisted − scanned`。
2. 分区「已启用 · 本地无 Manifest」：Schema 筛选为 `all` 或匹配该表 schema 时展示；行可取消勾选。
3. 聚焦其它 Schema 时：顶部告警「本连接另有 N 张无效启用」+ 链到清理（切 `全部 Schema` 或触发移出）。
4. 工具区：**移出无效启用** — 从当前筛选连接的 draft 去掉全部无效启用。
5. 状态：`无效启用` / `待移出`（取消勾选后、保存前）。
6. 保存成功且 `warnings.length > 0`：Toast/状态条提示仍有无效启用，引导清理。

## 7. 验收

1. 复现态勾选已扫描表保存成功；`ktx` 可仍含旧无效启用。
2. 新启用未扫描表 → `TABLE_NOT_SCANNED`。
3. 移出无效启用后保存 → `enabled_tables` 仅含 scanned。
4. `api.save` + `table-whitelist` 单测覆盖；术语 lint 通过。

## 8. Terminology Compliance

本 Spec 登记 `Invalid Enabled Table` / `Remove Invalid Enabled`；实现文案与断言必须使用上述主术语。
