# Admin Usage Overview Activity Rank & Header Polish Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Usage Overview Activity Rank & Header Polish Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `/admin/governance`（7 天 / 24 小时）；已批准改善方案 1～7；`webui/docs/78-admin-usage-overview-ux-refinement-spec.md`；`webui/docs/82-admin-usage-overview-table-grid-light-conformance-spec.md`；`webui/docs/design-system/10-components-button.md`；`GovernanceOverview.tsx`；`governance-observability.ts` |
| 适用范围 | 指导使用概况页：KPI 窗口进标题、三块调用排行 1×3 条形图化、命名与窗口联动、顶栏 segmented 时间窗、删除冗余「管理角色」 |
| 输出位置 | `webui/docs/84-admin-usage-overview-activity-rank-and-header-polish-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 84 |
| 关联工单 | `webui/docs/plans/wo-202608-16-admin-usage-overview-activity-rank-and-header-polish.md` |
| 关联页面 | `/admin/governance`（路由保持；用户可见名称仍为「使用概况」） |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-governance.md`（`UX-ADMIN-GOV-010`～`016`） |
| 上游 Spec | Spec 78（使用概况 KPI/窗口）；Spec 82（三表网格轻量遵从，本 Spec **替换**三块为条形排行） |
| 状态 | Draft (v1.0) |
| 日期 | 2026-08-05 |
| 范围 | KPI 标题带窗口；Agent/Token/表调用排行 1×3 条形图；Token API 补 `calls`；顶栏 `pl-segmented-control`；删除「管理角色」；术语/台账同步 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：已批准 7 条改善方案落盘 |

## 1. 背景

Spec 78 / 82 已将 `/admin/governance` 收敛为「使用概况」KPI + 三张使用向表。2026-08-05 二轮浏览器核查确认：

| # | 反馈摘要 | 核查结论 |
|---|---|---|
| 1 | governance 命名仍不贴切 | **部分属实**：用户可见已是「使用概况」；URL/代码仍 governance（本轮不迁 URL） |
| 2 | 三块排行应桌面 1×3 | **属实**：全宽纵向堆叠 |
| 3 | 命名不统一、描述实现向、与窗口联动弱 | **属实**：排行/摘要/最受访问混用；「近窗口」「不重复展示顶部 KPI」等 |
| 4 | 应降序条形图，只体现活跃度 | **属实**：多列表格含最近访问、均值、审计等 |
| 5 | 活跃 KPI 的统计期间应进标题 | **属实**：「近 N 有调用」藏在卡底 |
| 6 | 24h/7d 按钮挤在一起 | **属实**：贴边 `pl-btn` + 选中用 `primary` |
| 7 | 「管理角色」冗余 | **属实**：侧栏已有「角色权限」 |

## 2. 目标

1. **KPI 窗口显性化**：活跃 Agent / Token / 表、调用量的主标题含「近 24 小时」或「近 7 天」；卡底不再重复藏窗口句。
2. **三块调用排行统一**：标题模式「{对象}调用排行 · {窗口}」；副文案为用户价值句；桌面 **1×3**。
3. **纯活跃度条形图**：名称 + 次数 + 相对最长条的水平条；降序；不展示最近访问 / 均值 / Token 数列 / 审计 / 活跃徽章。
4. **Token 按窗口调用次数排序**：API 返回 `calls`；前端与 Agent/表同口径。
5. **顶栏时间窗**：复用 `pl-segmented-control`（对齐 `/eval/monitor`）；删除「管理角色」。
6. **验收不以浏览器为准**：Vitest + `lint:terminology` + `build`；本轮不做浏览器验证 / 移动窄屏。

## 3. 非目标

- 不迁 URL（仍 `/admin/governance`）；不重命名组件文件（可后续 `UsageOverview`）。
- 不改 `access.yaml` / ACL；不把风险模块拉回主屏。
- 不新增长期趋势图、不引 chart 库；用 CSS 水平条即可。
- 不做浏览器 E2E / 移动窄屏专项。
- 不删除侧栏「角色权限」入口。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`，并修订 §4.5 中与本轮冲突的主术语展示形态。

| Canonical Term | UI 主术语（本轮） | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Usage Overview Page | 使用概况 | 访问使用概况 | 治理概览（本页主标题） | 不变 |
| Active Agent | 近 N 活跃 Agent | 活跃 Agent（叙述） | 最近活跃 Agent（主标签） | N 进**标题** |
| Active Token | 近 N 活跃 Token | 活跃 Token（叙述） | 近 7 天活跃 Token（写死） | 同上 |
| Active Table Count | 近 N 活跃表 | 活跃表（叙述） | 热门表（与排行区分） | 同上 |
| Call Volume | 近 N 调用量 | 调用量（叙述） | 最近调用 | 同上；hint 可留「MCP 调用」 |
| Agent Call Ranking | Agent 调用排行 · 近 N | Agent 使用排行 | 近窗口调用；实现向排序说明 | 跟随窗口 |
| Token Call Ranking | Token 调用排行 · 近 N | Token 使用摘要 | 不重复展示顶部 KPI | 按 `calls` 降序 |
| Table Call Ranking | 表调用排行 · 近 N | 最受访问表（Top 10） | 仅统计已结构化…（主副文案） | Top 10 条形 |

Protected terms 延续 Spec 78：`Agent`、`Token`、`MCP`、`P95`、表名、token hash prefix、Agent id。

实现本 Spec 时须同步更新 `00-product-terminology-standard.md` §4.5。

## 5. Design System Compliance

- 引用：`10-components-button.md` §2–§5（筛选不是 primary；按钮组有间距）；`20-patterns-page-layout.md`（dashboard Summary + Secondary）。
- 时间窗：`pl-segmented-control` + `pl-segmented-control-item` / `--active`；两档时使用 `pl-segmented-control--cols-2`（或等价 `grid-cols-2`），**禁止**贴边拼接 `pl-btn--primary/secondary` 充当 segmented。
- 条形排行：新增页面语义类 `pl-usage-rank-*`（list / row / label / track / bar / value），不引第三方图表。
- Spec 82 的 `pl-data-grid` 三表契约：**本 Spec 废止**——三块不再渲染 usage 数据表；测试改为断言排行 list / bar。

## 6. UI 变更

### 6.1 PageHeader actions

- 仅保留时间窗 segmented control（`aria-label="时间窗口"`）。
- **删除**「管理角色」链接。
- 选中态用 `pl-segmented-control-item--active`，不用 `pl-btn--primary`。

### 6.2 KPI MetricCard

| 卡 | 标题（随 hours） | subline | hint |
|---|---|---|---|
| Agent 总数 | Agent 总数 | — | 已配置实例（含未启用） |
| 活跃 Agent | 近 N 活跃 Agent | 活跃率 x% · 共 y 个 | （可空或省略窗口句） |
| 配置 Token | 配置 Token | — | 已下发凭证… |
| 活跃 Token | 近 N 活跃 Token | 活跃率… | （可空） |
| 配置表 | 配置表 | — | 角色已授权… |
| 活跃表 | 近 N 活跃表 | 活跃率… | （可空） |
| 调用量 | 近 N 调用量 | — | MCP 调用 |
| P95 | 响应上限（P95） | — | 95%… / 当前窗口无调用 |

### 6.3 调用排行区（1×3）

容器：`pl-usage-rank-grid`（`md`/`xl` 三列；小屏可纵向，不做窄屏专项验收）。

每块：

- 标题：`Agent 调用排行 · 近 7 天`（或近 24 小时）等。
- 副文案（固定用户价值，不随实现细节变）：
  - Agent：`看哪些 Agent 调用最多，便于发现主力与闲置。`
  - Token：`看哪些 Token 调用最多，便于回收闲置凭证。`
  - 表：`看哪些表被访问最多，便于评估授权与热度。`
- 内容：最多 Top 10；按 `calls` 降序；相对 `max(calls)` 画条；`calls===0` 的行可省略（若窗口内全无调用 → 空态「近 N 暂无调用」）。
- Agent 名称可链到 `agentHref`；Token 可链到所属 Agent；表名纯文本 + `translate="no"`。
- **不**再渲染 Spec 82 三表、`查看日志`、最近访问列。

### 6.4 后端

`GET /api/admin/governance/tokens`：

- 新增字段 `calls: number`（窗口内该 Token prefix 的 `access_log` 计数，匹配逻辑与 `activeInWindow` 一致）。
- 排序：`calls` DESC，其次 `lastUsed` DESC。
- 继续双发 `activeInWindow` / 废弃 `activeInLast7d`（本轮可不删）。
- `windowHours` 不变。

Agent / overview API 无需为本 Spec 改字段（Agent 已有 `calls`）。

## 7. 验收标准

1. 顶栏无「管理角色」；时间窗为 segmented，非贴边 primary/secondary 按钮对。
2. 默认 7 天时，活跃 KPI 标题含「近 7 天」；切 24 小时后含「近 24 小时」。
3. 三块标题为「Agent/Token/表调用排行 · 近 N」；无「近窗口」「不重复展示顶部 KPI」「仅统计已结构化」主副文案。
4. 三块为条形排行 list，无 `governance-*-table` 数据表；Token mock/API 含 `calls` 且按次数排序。
5. `npm test` 相关用例绿；`lint:terminology`；`build`。
6. 台账 `UX-ADMIN-GOV-010`～`016` → `Fixed`；README 索引含 admin-governance 页。

## 8. 对上游 Spec 的修订

| Spec | 修订 |
|---|---|
| Spec 82 | 本页三块不再要求 `pl-data-grid` 表格；网格遵从保留为历史，被本 Spec 排行 UI 替代 |
| Spec 78 §6 列表区 | 「Agent 使用排行 / Token 使用摘要 / 最受访问表」表格形态 → 本 Spec 调用排行条形图 |
| 术语 §4.5 | 活跃类主术语展示改为「近 N …」；排行命名统一为「…调用排行 · 近 N」 |
