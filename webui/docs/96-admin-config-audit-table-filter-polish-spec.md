# Admin Config Audit Table & Filter Polish Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Config Audit Table & Filter Polish Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `/admin/config-audit`（2026-08-05）；`docs/ui-ux-feedback/pages/admin-config-audit.md`；Spec 90 / 91 / 82 |
| 适用范围 | `/admin/config-audit` 分页、表格规范、术语、筛选对齐与时间窗口 |
| 输出位置 | `webui/docs/96-admin-config-audit-table-filter-polish-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 96 |
| 关联工单 | `webui/docs/plans/wo-202608-29-admin-config-audit-table-filter-polish.md` |
| 关联页面 | `/admin/config-audit` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-config-audit.md`（`UX-ADMIN-CONFIG-AUDIT-002`～`006`） |
| 上游 Spec | Spec 90（统一写审计范围）；Spec 91（Header）；Spec 82（`pl-data-grid` 轻量） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | Wave A 表格/术语/分页；Wave B 时间筛选 API+UI；Wave C 快捷窗口与变更类型动态选项 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地 Wave A/B/C |

## 1. 背景

浏览器核查确认：

1. `PAGE_SIZE=50`，22 条一页展示，分页控件无效。
2. 表格用 `pl-audit-table` 且列级混用 `text-xs` / `text-sm`，未遵从 `pl-data-grid`。
3. 表头 `Actor`、单元格 `local-admin` / `agent_patch` / `governance` 等原始值业务可读性弱。
4. `actorNotice` 与 PageHeader 描述重复。
5. 筛选器与表头不对齐，且无时间筛选（API 亦无 `since`/`until`）。

## 2. 目标

1. **固定每页 20 行**（P1）。
2. **表格轻量遵从 `pl-data-grid`**，统一 12px 密度（P1）。
3. **列头与枚举中文化**；操作者业务化展示（P1）。
4. **删除 `actorNotice` 提示条**；精简 PageHeader 描述（P1）。
5. **筛选器与表头对齐**；API+UI 支持 `since`/`until`（P1）。
6. **快捷时间窗口**（近 7/30 天）与 **变更类型按资产域动态选项**（P2）。

## 3. 非目标

- 不改写审计触发通道（Spec 90）。
- 不做多人问责 / SSO actor。
- 不做浏览器验证（本轮结束后只做 code review）。
- 不新增独立「操作者」筛选（本机单管理员模式无业务价值）。

## 4. Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md`。本 Spec 新增：

| 概念 | UI 文案 | 禁止 |
|---|---|---|
| 操作者列 | **操作者** | Actor |
| `local-admin` 展示 | **本机管理员** | 裸 `local-admin` 作为唯一可见文案（详情可保留原始值） |
| 变更类型列 | **变更类型** | 类型（过宽） |
| 目标列 | **目标** | Agent / target（筛选 placeholder） |
| 文件列 | **文件路径** | 文件（过短） |
| 资产域 / 来源 | **资产域** / **来源** | 英文夹杂 placeholder（如「来源 source」） |

枚举映射（表体展示用中文 label；展开详情可保留原始 code）：

| 字段 | code | label |
|---|---|---|
| assetKind | governance / semantic / wiki / eval / publish | 访问治理 / 语义 YAML / 业务 Wiki / 评测 / 发布 |
| source | admin_agents_api 等 | Agent 管理 / 角色管理 / Token 管理 / …（见实现映射表） |
| changeType | agent_patch 等 | Agent 信息变更 / …（见实现映射表） |

## 5. UI 变更

### 5.1 分页

- `PAGE_SIZE = 20`（常量，不可配置）。
- 分页文案：`x–y / 共 N 条`；页脚 `当前页 / 总页数`。

### 5.2 表格

- `className="pl-data-grid pl-data-table pl-config-audit-table pl-audit-table"`。
- 列：时间、操作者、来源、资产域、变更类型、目标、文件路径。
- 正文统一 `text-xs`；`font-mono` 仅用于目标 ID、文件路径。
- 去掉列级 `text-sm` / `text-xs` 分叉。

### 5.3 Header / Notice

- PageHeader description：`查看治理配置与语义资产的写入历史。`
- **不渲染** `data.actorNotice`。

### 5.4 筛选栏（与表头对齐）

顺序：

```
[快捷窗口 ▼] [开始时间] — [结束时间] | [资产域 ▼] | [变更类型 ▼] | [目标 ID] | [文件路径] | [来源]
```

- 快捷窗口：全部 / 近 7 天 / 近 30 天（Wave C）；选中后写入 `since`/`until`（或仅 `since`）。
- 变更类型：选项随当前 `assetKind` 过滤（Wave C）；无资产域时展示全量已知类型。
- 导出 CSV 携带与列表相同的筛选参数（含 `since`/`until`/`changeType`）。

## 6. API 变更

`GET /api/admin/config-audit` 与 `export.csv` 新增可选：

| 参数 | 语义 |
|---|---|
| `since` | ISO-8601，`ts >= since` |
| `until` | ISO-8601，`ts <= until` |

既有：`targetId`、`filePath`、`assetKind`、`changeType`、`source`、`limit`、`offset`。

默认仍只返回 `write_status='committed'`。

`actorMode` / `actorNotice` 可继续返回以兼容旧客户端；WebUI 不再展示。

## 7. 验收标准

- [ ] 22 条数据时首屏为 `1–20 / 共 22 条`，总页数 2。
- [ ] 表格含 `pl-data-grid`；无列级字号分叉。
- [ ] 表头无 `Actor`；操作者展示「本机管理员」。
- [ ] 无 `actorNotice` 提示条。
- [ ] 时间筛选生效；CSV 与列表口径一致。
- [ ] 快捷窗口与变更类型动态选项可用。
- [ ] Vitest + `lint:terminology` + `build` 通过；本轮不做浏览器验证。

## 8. Non-Goals 回顾

本 Spec 不改变 Spec 90 的主审计通道 / 排除通道边界。
