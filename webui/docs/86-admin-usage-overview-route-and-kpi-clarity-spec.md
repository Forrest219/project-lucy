# Admin Usage Overview Route & KPI Clarity Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Usage Overview Route & KPI Clarity Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `/admin/governance` 与 `/connections`；已批准改善方案（URL 迁路径、排行槽位高度、授权表、多数请求耗时）；`webui/docs/84-admin-usage-overview-activity-rank-and-header-polish-spec.md`；`00-product-terminology-standard.md` |
| 适用范围 | 指导使用概况页路由迁至 `/admin/usage`、调用排行固定槽位高度、KPI「配置表」「响应上限（P95）」业务化更名 |
| 输出位置 | `webui/docs/86-admin-usage-overview-route-and-kpi-clarity-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 86 |
| 关联工单 | `webui/docs/plans/wo-202608-18-admin-usage-overview-route-and-kpi-clarity.md` |
| 关联页面 | `/admin/usage`（旧 `/admin/governance` redirect） |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-governance.md`（`UX-ADMIN-GOV-017`～`020`） |
| 上游 Spec | Spec 84（调用排行条形图）；Spec 78（KPI 口径） |
| 状态 | Draft (v1.0) |
| 日期 | 2026-08-05 |
| 范围 | 前端路由迁路径 + redirect；排行区 min/max 高度；授权表 / 多数请求耗时文案；术语与 IA / 台账同步 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：已批准 4 条改善方案落盘 |

## 1. 背景

Spec 84 落地后浏览器复核确认：

| # | 反馈摘要 | 核查结论 |
|---|---|---|
| 1 | URL 仍为 `/admin/governance` | **属实**；用户可见已是「使用概况」，路径后缀仍像治理门户 |
| 2 | 排行 1 行时高度蜷缩 | **属实**；1×3 条形图正确，但 1 行时内容区极矮 |
| 3 | 「配置表」与连接页不一致、缺业务含义 | **属实**；本页=角色 ACL 授权表；连接页=「启用表范围 / 已启用表数」 |
| 4 | 「响应上限（P95）」表意不清 | **属实**；业务含义藏在 hint |

## 2. 目标

1. 主路由改为 `/admin/usage`；旧 path redirect。
2. 调用排行内容区按 Top 10 槽位定高：空态 / 1 行 / 满 10 行视觉体积均衡；溢出可滚。
3. 「配置表」→「授权表」，hint 标明角色权限口径，禁止与「启用表」混用。
4. 「响应上限（P95）」→「多数请求耗时」，hint 业务化；`P95` 仅作次级/括号保护术语。
5. 验收：Vitest + `lint:terminology` + `build`；本轮不做浏览器验证。

## 3. 非目标

- 不改 `/api/admin/governance/*` API path（本轮保留）。
- 不改 `configuredTableCount` / P95 计算口径。
- 不把「授权表」改成连接页「启用表」统计。
- 不把排行 Top 10 扩到 50 行展示；>槽位用滚动覆盖极端。
- 不做浏览器 E2E / 移动窄屏。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`，并修订 §4.5：

| Canonical Term | UI 主术语（本轮） | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Usage Overview Page | 使用概况 | — | 治理概览 | 路由改为 `/admin/usage` |
| Authorized Table Count | 授权表 | 角色已授权表 | 配置表（本页主标签）、启用表、白名单表 | ACL 授权去重；≠ 启用表范围 |
| Active Table Count | 近 N 活跃表 | — | — | 活跃率分母=授权表 |
| Typical Request Latency | 多数请求耗时 | P95（次级） | 响应上限（P95）作主标签；平均响应时长 | hint：95% 的请求在此时间内完成 |

Protected：`Agent`、`Token`、`MCP`、`P95`。

## 5. Design System Compliance

- 引用：`20-patterns-page-layout.md`（dashboard secondary lists）；`10-components-button.md`（时间窗不变）。
- 排行槽：`pl-usage-rank-body` 固定 `min-height` / `max-height`（按约 10 行 × 行高 + gap）；空态 flex 居中；溢出 `overflow-y: auto`。
- 三列共用同一高度 token，保持 1×3 对齐。

## 6. 变更明细

### 6.1 路由

- `navigation.ts`：`to: "/admin/usage"`；`active` 匹配 `/admin/usage`。
- `App.tsx`：`<Route path="/admin/usage" element={<GovernanceOverview />} />`；`<Route path="/admin/governance" element={<Navigate to="/admin/usage" replace />} />`。
- `06-navigation-ia.md`、帮助/命令面板若硬编码 path 一并改。
- 测试：`navigation.test.ts` 等断言新 path；redirect 可测。

### 6.2 排行高度

- 包裹 `RankingBarList` 的 body：`pl-usage-rank-body`。
- CSS：`min-height` ≈ 10 槽；`max-height` 同值或略大；`overflow-y: auto`。
- 空态与有数据共用 body 高度。

### 6.3 KPI 文案

| testId | 标题 | hint |
|---|---|---|
| `metric-configured-table-count` | 授权表 | 角色权限中已明确授权的表（含前缀授权时附加说明） |
| `metric-p95-latency` | 多数请求耗时 | 有样本：`95% 的请求在此时间内完成`；无样本：`当前窗口无调用` |

## 7. 验收标准

1. 打开 `/admin/usage` 为使用概况；`/admin/governance` replace 到 `/admin/usage`。
2. 侧栏「使用概况」高亮 `/admin/usage`。
3. 排行 body 有稳定 min-height；1 行时不蜷成细条。
4. KPI 无「配置表」「响应上限」主标签；有「授权表」「多数请求耗时」。
5. 相关 Vitest + terminology lint + build 通过；台账 017～020 → Fixed。

## 8. 对上游修订

| Spec | 修订 |
|---|---|
| Spec 78/84 Non-Goal「不迁 URL」 | 被本 Spec 覆盖：迁至 `/admin/usage` |
| 术语 §4.5 配置表 / 响应上限（P95） | 改为授权表 / 多数请求耗时 |
