# Admin Config Audit Header & Export Parity Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Config Audit Header & Export Parity Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `/admin/config-audit?targetId=demo_agent`（2026-08-05）；`docs/ui-ux-feedback/pages/admin-config-audit.md`；Spec 90 §8.3 / Spec 91 / Spec 96 |
| 适用范围 | `/admin/config-audit` PageHeader actions；`GET /api/admin/config-audit/export.csv` 列与文件名 |
| 输出位置 | `webui/docs/97-admin-config-audit-header-export-parity-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 97 |
| 关联工单 | `webui/docs/plans/wo-202608-30-admin-config-audit-header-export-parity.md` |
| 关联页面 | `/admin/config-audit` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-config-audit.md`（`UX-ADMIN-CONFIG-AUDIT-007`～`008`） |
| 上游 Spec | Spec 90（「导出 CSV 与表格字段一致」）；Spec 91（Header actions）；Spec 96（中文业务列） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | 删页头「访问日志」；CSV 与主表 7 列中文对齐；文件名精确到秒 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地 |

## 1. 背景

浏览器核查确认（`?targetId=demo_agent`）：

1. PageHeader 右上角同时有「导出 CSV」与「访问日志」；侧栏「访问治理」已有「访问日志」，页头入口冗余。
2. 「导出 CSV」下载内容与页面主表不一致：CSV 为 16 列英文原始字段（`actor=local-admin`、`change_type=agent_patch` 等），主表为 7 列中文业务文案（本机管理员 / Agent 信息变更等）。
3. `Content-Disposition` 文件名为 `config-audit-YYYYMMDD.csv`，缺少时分秒，同日多次导出易覆盖混淆。

Spec 90 §8.3 已要求「导出 CSV 与表格字段一致」，本轮补齐落地缺口。

## 2. 目标

1. **删除 PageHeader「访问日志」**（P1）：actions 仅保留「导出 CSV」。
2. **CSV 与主表字段/文案一致**（P1）：7 列中文表头 + 与表格相同的 label 映射。
3. **导出文件名精确到秒**（P1）：`config-audit-YYYYMMDD-HHmmss.csv`（本地时区 Asia/Shanghai）。

## 3. 非目标

- 不改列表筛选、分页、展开详情（Spec 96）。
- 不把详情字段（`diff` / `old_summary` / `new_summary` / `request_id` 等）默认打进 CSV；不新增「导出含详情」开关（可后续单独立项）。
- 不改访问日志页本身（`/admin/audit`）。
- 不做浏览器验证（本轮结束后只做 code review）。

## 4. Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md` 与 Spec 96 枚举映射。本 Spec 补充：

| 概念 | UI / CSV 文案 | 禁止 |
|---|---|---|
| 导出列头 | 与主表一致：时间 / 操作者 / 来源 / 资产域 / 变更类型 / 目标 / 文件路径 | 英文原始列名作唯一表头（`actor`、`change_type` 等） |
| 导出单元格 | 与主表相同中文 label（本机管理员、Agent 管理、访问治理、Agent 信息变更…） | 裸 code 作为默认导出值 |
| 导出文件名 | `config-audit-YYYYMMDD-HHmmss.csv` | 仅到日的 `config-audit-YYYYMMDD.csv` |

## 5. UI 变更

### 5.1 PageHeader actions

```tsx
actions={<a href={exportUrl} className="pl-btn pl-btn--secondary text-sm">导出 CSV</a>}
```

- 删除指向 `/admin/audit` 的「访问日志」`Link`。
- 侧栏入口不变。

### 5.2 导出入口

- 仍为 Header「导出 CSV」`<a href=...>`；筛选参数透传不变（`targetId` / `filePath` / `assetKind` / `changeType` / `source` / `since` / `until`）。

## 6. API 变更：`GET /api/admin/config-audit/export.csv`

### 6.1 CSV 列（顺序固定）

| 列头 | 取值 |
|---|---|
| 时间 | `ts` 的 `zh-CN` 本地可读串（Asia/Shanghai），与表格 `toLocaleString("zh-CN")` 口径一致 |
| 操作者 | `actorLabel(actor)`（`local-admin` → 本机管理员） |
| 来源 | `sourceLabel(source)`；空 → `—` |
| 资产域 | `assetKindLabel(asset_kind)` |
| 变更类型 | `changeTypeLabel(change_type)` |
| 目标 | `target_id`；空 → `—` |
| 文件路径 | `file_path` |

- BOM + `text/csv; charset=utf-8` 保留。
- 筛选与列表 API 相同；默认仅 `write_status='committed'`。
- label 映射与前端共用同一模块，避免表/导出漂移。

### 6.2 Content-Disposition

```
attachment; filename="config-audit-YYYYMMDD-HHmmss.csv"
```

时间戳取导出时刻的 Asia/Shanghai 本地墙钟（年月日 + 时分秒）。

## 7. 验收标准

- [ ] `/admin/config-audit` PageHeader 无「访问日志」链接；仅有「导出 CSV」。
- [ ] CSV 首行恰为上述 7 个中文列头；无 `actor_type` / `diff` 等详情列。
- [ ] 样例行：`local-admin` 导为「本机管理员」；`agent_patch` 导为「Agent 信息变更」；`governance` 导为「访问治理」。
- [ ] `Content-Disposition` 匹配 `config-audit-\d{8}-\d{6}\.csv`。
- [ ] Vitest（前后端）+ `lint:terminology` + `build` 通过；本轮不做浏览器验证。

## 8. 对上游 Spec 的澄清

修订 Spec 90 §8.3「导出 CSV 与表格字段一致」的落地口径：

- **一致对象 = 主表可见列**（非展开详情、非全量 DB 列 dump）。
- 中文业务 label 与 Spec 96 表格展示同一套映射。
