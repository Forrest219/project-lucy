# Publish History Filters, Pagination & CSV Export Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish History Filters, Pagination & CSV Export Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `/publish/history` vs `/admin/config-audit`；用户批准改善方案（序号/筛选/分页；导出改为明细 CSV，禁止语义资产包 ZIP）；`UX-PUBLISH-HISTORY-011`（时间筛选缺可见名称与默认窗口） |
| 适用范围 | `/publish/history` 列表契约、筛选分页、Header 导出明细；修订 Spec 35 §7.3、Spec 85 Header 导出、Spec 91 §5.1 actions |
| 输出位置 | `webui/docs/113-publish-history-filters-pagination-and-csv-export-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 113 |
| 关联工单 | `webui/docs/plans/wo-202608-46-publish-history-filters-pagination-and-csv-export.md`；`wo-202608-55-publish-history-time-filter-default-24h.md` |
| 关联页面 | `/publish/history` |
| 关联台账 | `docs/ui-ux-feedback/pages/publish-history.md`（`UX-PUBLISH-HISTORY-008`～`011`） |
| 上游 Spec | Spec 35（发布记录 IA）；Spec 85（业务列）；Spec 91（Header）；Spec 96/97（配置审计筛选/导出样板） |
| 状态 | Implemented |
| 日期 | 2026-08-07 |
| 范围 | `#`→序号；筛选栏；分页；Header「导出 CSV」明细；移除语义资产包 ZIP；releases API `total`+筛选+`export.csv`；时间筛选可见标签 + 默认近 24 小时（整点） |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.1 | 时间筛选补可见标签「时间」；快捷窗口增加「近 24 小时」；首访无时间参数时默认 `window=24h`，`since` 取整点 |
| v1.0 | 初稿并落地 |

## 1. 背景

浏览器核查确认：

1. 表头仍为 `#`，缺配置审计式「序号」；无筛选、无分页（一次拉全量，sidecar 上限 100）。
2. Header「导出当前语义资产包 (.zip)」与「查看历史」职责错位；两步打包+摘要卡像工具面板，不是一键下载明细。
3. 用户批准：对齐配置审计；**不要导出语义资产包，只导出明细表 CSV**。

## 2. 目标

1. 首列文案改为 **序号**；序号随分页连续（`page * PAGE_SIZE + index + 1`）。
2. 增加 `pl-admin-filterbar`：时间窗口、起止、触发方式、Reindex 状态、操作人。
3. 固定每页 **20** 行；上方 `x–y / 共 N 条`；下方上一页/下一页。
4. Header actions 改为 **导出 CSV**（`pl-btn--secondary`）：一键下载当前筛选下的明细；无 ZIP、无摘要卡。
5. 副标题去掉「并导出当前工作区语义资产包」。
6. ZIP 导出仅保留在「发布工作台」（既有入口）；历史页不得挂 `SemanticAssetExportButton`。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 按 releaseId 下载历史批次 ZIP | Spec 85 Non-Goal；本轮仍不做 |
| 历史页保留语义资产包导出 | 用户明确否决 |
| Diff / 错误全文进 CSV | 明细表膨胀；行内展开仍保留 |
| 本轮浏览器验证 | 用户约束：结束后只做 code review |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`.

| 场景 | 采用 | 禁止 |
|---|---|---|
| Header 导出 | 导出 CSV | 导出当前语义资产包 (.zip)、下载当前快照 |
| 序号列 | 序号 | `#` 作为表头 |
| 分页计数 | `1–20 / 共 N 条` | PageHeader badges「共 N 条」 |

Protected：`Reindex`、actor、connectionId、sourceName、release id → `notranslate`。

## 5. Design System Compliance

- 筛选：`pl-admin-filterbar`（对齐 ConfigAudit）。
- 表格：维持 `pl-data-grid pl-data-table pl-publish-history-table`。
- 序号列：`whitespace-nowrap`，宽度至少容纳三位数。
- Header 导出：`pl-btn pl-btn--secondary text-sm` 链接或同级 `<a>`。

## 6. URL / 筛选契约

| 控件 | Query | 说明 |
|---|---|---|
| 时间（可见标签） | — | 筛选栏最左侧文案「时间」，覆盖快捷窗口 + 起止 |
| 时间窗口 | `window=24h\|7d\|30d` | 设 since=窗口起点（整点）；清 until；切自定义时间删 window |
| 开始/结束 | `since` / `until` | ISO；datetime-local |
| 触发方式 | `trigger=webui_publish\|webui_manual_reindex` | 空=全部 |
| Reindex 状态 | `reindexStatus=success\|failed\|running\|not_run` | 对齐 UI 成功/失败/进行中/未执行 |
| 操作人 | `actor` | 子串匹配（大小写不敏感） |
| 分页 | `limit` / `offset`（API）；UI 本地 `page` 或 URL 均可，默认 20 | 改筛选重置 page=0 |

**默认：** 首访 URL 无 `window`/`since`/`until` 时，`replace` 写入 `window=24h` 与整点 `since`（`now - 24h`，分钟/秒归零）。用户显式选「全部时间」后不再自动回填。快捷窗口文案：「全部时间 / 近 24 小时 / 近 7 天 / 近 30 天」。

## 7. API

### 7.1 `GET /api/semantic-assets/releases`

Query：§6 筛选 + `limit` + `offset`。

- 省略 `limit`/`offset`：返回全部匹配记录（仍受 sidecar `MAX_RELEASE_RECORDS` 约束），兼容既有调用方。
- 提供 `limit`：分页切片。

Response：

```ts
{ records: SemanticAssetReleaseRecord[]; total: number }
```

### 7.2 `GET /api/semantic-assets/releases/export.csv`

同筛选参数（无 limit/offset）；返回 UTF-8 CSV，`Content-Disposition` 文件名：

`publish-history-YYYYMMDD-HHmmss.csv`（Asia/Shanghai，精确到秒；对齐 Spec 97）。

### 7.3 CSV 列（与主表业务文案一致）

| 列 | 内容 |
|---|---|
| 序号 | 1..N（当前筛选全集） |
| 发布时间 | 与表格式一致的本地时间串 |
| 发布状态 | 已发布 / 已阻断 / … |
| 触发方式 | WebUI 发布 / WebUI 强制重建索引 / 系统 |
| 操作人 | actor |
| 变更范围 | 连接+语义源摘要，或「全库索引重建（无资产变更）」 |
| 规模 | `文件 N · 语义源 M` 或 `—` |
| Reindex 状态 | 成功 / 失败 / 进行中 / 未执行 |
| 发布 ID | release id |

禁止把 Diff、stderr、validation issues dump 进默认 CSV。

## 8. UI 变更

| 区域 | 调整 |
|---|---|
| PageHeader description | 「查看历次语义发布的变更范围、执行结果与操作记录。」 |
| PageHeader actions | `<a href={exportUrl}>导出 CSV</a>` |
| 筛选栏 | 新建，见 §6；时间组前可见标签「时间」；默认近 24 小时 |
| 表头 | `#` → **序号** |
| 分页 | 对齐 ConfigAudit |

## 9. 交叉修订

- **Spec 35 §7.3**：Header 导出改为明细 CSV；`POST /api/semantic-assets/export` 不再挂在发布记录页。
- **Spec 85**：Header ZIP 辅助动作由本 Spec 取代为 CSV；行内仍禁止伪快照下载。
- **Spec 91 §5.1**：actions 从 ZIP 改为「导出 CSV」secondary。

## 10. 验收标准

1. `/publish/history` 表头为「序号」；有筛选栏与分页；空态与错误态仍可用。
2. Header 仅「导出 CSV」；无 ZIP / `SemanticAssetExportButton`。
3. CSV 列与主表中文业务文案一致；文件名精确到秒。
4. `GET .../releases` 返回 `total`；筛选/分页正确。
5. Vitest + `lint:terminology` + `build` 通过。
6. 台账 `UX-PUBLISH-HISTORY-008`～`010` → `Fixed`（本轮不做浏览器验证）。
7. 时间筛选有可见「时间」标签；无 URL 时间参数时默认「近 24 小时」且 `since` 为整点；台账 `UX-PUBLISH-HISTORY-011` → `Fixed`。

## 11. 测试要求

- `publish-history.test.tsx`：序号、筛选、分页、导出 CSV 链接；无 ZIP 按钮；时间标签与默认 24h。
- `api.semantic-assets.reindex.test.ts`（或新增）：releases list `total`/筛选；export.csv 表头与筛选。
