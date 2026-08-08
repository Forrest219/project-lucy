# Admin Audit Identity, Filters & URL Semantics Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Audit Identity, Filters & URL Semantics Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `/admin/audit` 浏览器核查（问询 vs 调用流水 Header/列/筛选/URL）；前序 Spec 89 / 94 / 99 / 100；用户改善方案确认 |
| 适用范围 | `/admin/audit` 双 Tab：身份列、序号、共享筛选、Header 同构、URL `view`/`range` |
| 输出位置 | `webui/docs/106-admin-audit-identity-filters-and-url-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 106 |
| 关联工单 | `webui/docs/plans/wo-202608-39-admin-audit-identity-filters-and-url.md` |
| 关联页面 | `/admin/audit` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-audit.md`（`UX-ADMIN-AUDIT-020`～`025`）；跨页面主题 `audit identity join keys`、`url semantic presets`、`tab header action parity` |
| 上游 Spec | Spec 89（双 Tab / hours）、Spec 94（列名/Drawer）、Spec 99/100（深链 Registry） |
| 状态 | Implemented |
| 日期 | 2026-08-06 |
| 范围 | 身份 Key 列、序号统一、共享筛选、Header 导出槽位同构、`view`/`range` URL；兼容旧 `tab`/`hours` |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地 |

## 1. 背景

浏览器核查确认 `/admin/audit?hours=168` 与 `?hours=168&tab=calls`：

1. Header：调用流水多出「导出 CSV」，切 Tab 布局跳动。
2. 问询「序号」`w-12` 导致「序/号」换行，三位数不足。
3. 调用流水缺首列序号。
4. 两表主表均无可信关联 Key（问询 ID / 事件 ID）；ID 仅藏在 testid / 展开区。
5. 筛选不对称：问询缺日期/状态/Key；调用偏 Session/平台实现字段。
6. URL 暴露 `hours=168` 等临时实现语义。

## 2. 目标

1. **Header 同构**：两 Tab 顶栏均为「统计时间 | 24h/7d | 导出 CSV」；导出始终可见可用（导出调用流水 CSV，参数取当前共享筛选）。
2. **序号**：两表首列「序号」；`th`/`td` `whitespace-nowrap`，宽度至少容纳 `999`。
3. **身份列**：问询表增加 **问询 ID**；调用表增加 **事件 ID** + **问询 ID**（可空）；mono + `notranslate`；支持复制。
4. **共享筛选**（两 Tab）：日期区间、Agent 名称或 ID、表名、结果状态、Key 模糊搜索。
5. **Tab 特有筛选**：问询＝来源类型 + 摘要；调用＝调用来源 / 工具名 / 高级（Session、协议、慢调用）。
6. **URL**：写入优先 `view=turns|calls`、`range=24h|7d`；读入兼容 `tab`、`hours=24|168`；深链生产者改为新形态。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 路径式 `/admin/audit/calls` | 本轮保留 query；可后置 |
| 问询级 CSV | Spec 89 Phase 2 |
| 改使用概况页自己的 `hours` API | 仅审计页 URL 产品化 |
| 本轮浏览器验证 | 用户约束：结束后只做 code review |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md` §4.7（本 Spec 增补）。

| Canonical Term | UI 主术语 | 禁止文案 |
|---|---|---|
| Turn ID | 问询 ID | turn id（裸露作主标签）、问题簇 ID |
| Audit Event ID | 事件 ID | access_log id、request id（与事件 ID 混用） |
| View query | `view` | 用户可见文案仍用「问询记录 / 调用流水」 |
| Range preset | `range=24h\|7d` | 地址栏 `hours=168`（新写入禁止） |

Protected：问询 ID / 事件 ID 值、`Agent`、表名 → `notranslate`。

## 5. URL 契约

| 语义 | 规范写入 | 兼容读取 |
|---|---|---|
| 视图 | `view=turns`（默认可省略）/ `view=calls` | `tab=turns\|calls` |
| 时间窗预设 | `range=24h` / `range=7d`（默认 `7d`） | `hours=24` / `hours=168` |
| 自定义区间 | `since` / `until`（ISO datetime-local 同源） | 不变 |
| Key | 问询：`turnId`；调用：`eventId` 与/或 `turnId` | 旧 `turnIdFilter` 映射为 `turnId` |

映射：`range=24h` ↔ 24h；`range=7d` ↔ 168h（仅内部）。**新写入不得再写 `hours=168`。**

深链 Registry（修订 Spec 100 / 99 生产者）：

| 旧 | 新 |
|---|---|
| `?tab=calls&hours=168` | `?view=calls&range=7d` |
| `?tab=calls&outcome=denied&hours=168` | `?view=calls&range=7d&outcome=denied` |

一版内读侧仍认旧参。

## 6. 列表列

### 6.1 问询记录

`序号 | 问询 ID | 开始时间 | 结束时间 | 问询时长 | Agent | 问询摘要 | 工具调用数 | 涉及数据表 | 耗时 | 结果 | 来源`

### 6.2 调用流水

`序号 | 事件 ID | 问询 ID | 时间 | Agent | 工具 | 表 | 裁决原因 | 状态 | 调用来源 | 耗时`

- 「用户」列改标为 **Agent**（值仍为 userId / 名称解析与问询一致更优；至少 placeholder/列头对齐）。
- 问询 ID 可点：打开问询 Drawer 或写入 `view=turns&turnId=`。
- 事件 ID：对象详情链保留；主表可见。

### 6.3 序号列样式

```text
th/td: whitespace-nowrap; min-width ≥ 3rem（或 w-14）；禁止 w-12 导致中文表头换行
```

## 7. 筛选器

### 7.1 共享（两 Tab 均展示）

| 控件 | URL / API |
|---|---|
| 日期 since — until | `since` / `until`；切换 `range` 时重置 since 为窗口起点 |
| Agent 名称或 ID | `user` |
| 表名 | `tableSearch` |
| 结果状态 | `outcome`：空 / ok / error / denied |
| Key 搜索 | 问询：`turnId` 模糊；调用：`eventId` 或 `turnId` 模糊（单框可同时试） |

### 7.2 问询特有

来源类型、摘要关键词（`turnSearch`，客户端或并入 API）。

### 7.3 调用特有

调用来源、工具名；高级折叠：Session ID、显示协议调用、仅慢于多数请求。平台筛选本轮可移除或收入高级（默认不占首行）。

### 7.4 API

- `GET /api/admin/audit/turns`：已有 `since`/`until`；新增 `turnId`（LIKE）、`tableSearch`、`outcome`（在 enrich 后、分页前过滤）。
- `GET /api/admin/audit`：新增 `eventId`（对 `id` 文本模糊或精确）。

## 8. Header

两 Tab：`统计时间` + segmented `24 小时 | 7 天`（内部写 `range`）+ **导出 CSV**（primary）。导出 URL 始终指向调用流水 export，携带当前共享筛选。

## 9. 测试要求（非浏览器）

- 问询表：问询 ID 列、序号 nowrap / 非 `w-12` 换行类。
- 调用表：序号 + 事件 ID + 问询 ID；Header 在 turns 亦有 `audit-export-csv`。
- URL：默认写入 `range=7d`；读 `hours=168` 仍生效；读 `view=calls`。
- 共享筛选控件两 Tab 可见；turns 请求带 since。
- 深链生产者（opsDashboard / mcp-playground）使用 `view`+`range`。
- `lint:terminology`、相关 Vitest、`build`。

## 10. 验收标准（非浏览器）

- [ ] Spec / Plan / docs README / plans README 已登记
- [ ] `UX-ADMIN-AUDIT-020`～`025` → `Fixed`
- [ ] 台账 README 维护记录 + 跨页面主题 + 治理规则
- [ ] Vitest / lint / build 通过
- [ ] 本轮不做浏览器验证；结束后 code review

## 11. 风险

- 旧书签 `hours=168` 依赖兼容读；新分享链应已是 `range=7d`。
- 导出在问询 Tab 仍导出调用流水——需接受「导出对象是调用」；tooltip 可注明。
- 修订 Spec 89「问询筛选刻意极简」与 Spec 100 深链字面量。
