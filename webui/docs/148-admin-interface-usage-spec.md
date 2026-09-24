# Admin Interface Usage Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Interface Usage Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-24 |
| 关联页面 | `/admin/usage?view=interface` |
| 关联实现 | `webui/server/admin/ui-usage.ts`、`webui/src/app/ui-usage-beacon.ts`、`webui/src/pages/admin/GovernanceOverview.tsx` |
| 关联标准 | `webui/docs/00-product-terminology-standard.md` §4.5 |
| 状态 | Draft (v1.0) |

## 1. 背景

使用概况已能回答 Agent、Token 和数据表的调用热度。WebUI 自身的菜单和页面没有打开记录，迭代时看不到哪些入口闲置、哪些页面被反复打开。

## 2. 目标

1. 已登录壳层在路径稳定后记录一次页面打开。
2. 记录只留在本机审计库，供管理员在使用概况的「界面使用」视图查看。
3. 近 24 小时 / 近 7 天展示页面访问、访问账户、活跃菜单，以及分组、菜单、页面排行（含 0 次）。
4. 深层页面计入父菜单；不保存原始路径、查询串或业务对象名。

## 3. 非目标

- 不改数据访问 KPI 与 Agent / Token / 表调用排行。
- 不记录点击来源（侧栏、命令面板、地址栏都只算一次页面打开）。
- 不记录停留时长，不做导出，不清理历史，不外发。
- 不做浏览器验收。

## 4. Terminology Compliance

本功能遵循 `webui/docs/00-product-terminology-standard.md`，并在 §4.5 登记下列术语。

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Interface Usage View | 界面使用 | — | 埋点、telemetry、pageview | `?view=interface`；默认仍是数据访问 |
| Data Access View | 数据访问 | — | 治理概览 | 使用概况默认视图 |
| Page Views | 近 N 页面访问 | 页面访问（叙述） | 浏览量 | 窗口内已记录的页面打开次数 |
| Visiting Accounts | 近 N 访问账户 | 访问账户（叙述） | 访客、UV | 窗口内去重登录账户；未启用登录时为本地管理员 |
| Active Menus | 近 N 活跃菜单 | 活跃菜单（叙述） | 热门菜单（与排行混用） | 窗口内至少打开 1 次的侧栏菜单数 |
| Group Visit Ranking | 分组访问 · 近 N | — | 模块热度 | 全部分组，含 0 次 |
| Menu Visit Ranking | 菜单访问排行 · 近 N | — | 点击排行 | 全部侧栏菜单，含 0 次；深层页计入父菜单 |
| Page Visit Ranking | 页面访问排行 · 近 N | — | 路由排行 | 目录中的每个页面，含 0 次 |

用户可见文案不出现「埋点」「telemetry」「pageview」。`Agent`、`Token`、`MCP` 继续 `translate="no"`。

## 5. 记录口径

一次页面打开 = 地址路径变化并稳定约 300ms 后的一条记录。同一路径上只改查询串或 hash 不另记。

身份取 `actorIdFromRequest`（未启用登录时为 `local-admin`）。`/login` 不记。未登录打开 `/help` 不记；已登录或未启用登录时打开帮助中心要记。

服务端把路径收成页面键。纯跳转路径不落库：`/`、`/onboarding`、`/admin/governance`、`/review`、`/connections/whitelist`、`/admin/audit-sources`、`/sources/:conn/:schema/:table`。

目录外路径记为页面键 `unknown`，只增加「未能对应到已知页面」的次数，不保存原始路径。

事件列：`ts`、`admin_id`、`page_key`、`menu_id`、`group_id`。表名 `ui_page_views`，位于审计库。

深层页归菜单：

| 路径 | 页面 | 菜单 |
|---|---|---|
| `/catalog/:conn/:schema/:table` | 表语义编辑 | 语义资产 |
| `/joins/:conn/:schema/:table` | 关联关系 | 语义资产 |
| `/admin/agents/:userId` | Agent 详情 | Agent |
| `/admin/agents/:userId/tokens/new` | 签发 Token | Agent |
| `/admin/tokens/new` | 签发 Token | Token 凭据 |
| `/admin/roles/new` | 新建角色 | 角色权限 |
| `/admin/roles/:roleId` | 角色详情 | 角色权限 |
| `/eval/cases/:domain` | 评测用例 | 评测用例 |
| `/eval/cases/:domain/new` 与 `/eval/cases/:domain/:caseId` | 评测用例编辑 | 评测用例 |
| `/eval/runs/:runId` | 运行详情 | 运行历史 |
| `/connections/test` | 连通测试 | 连接概览 |
| `/help` | 帮助中心 | 无（不进入菜单排行） |

系统概览是菜单，但不属于六个侧栏分组。

## 6. API

`POST /api/admin/ui-usage/page-view`

- 请求体仅 `{ "pathname": "/catalog" }`。
- 走现有 WebUI 管理员鉴权。required 且未登录返回 401。
- 成功 `{ ok: true, data: { recorded: true | false } }`。跳转路径 `recorded: false`。
- 非法路径返回 400，错误文案不回显路径。

`GET /api/admin/ui-usage/overview?hours=24|168`

- 仅接受 24 与 168，缺省或其他值按 168。
- `pageViews`、`visitorCount`、`activeMenuCount`、`unmappedViews`。
- `groups`、`menus`、`pages`：`{ id, label, visits }`，按 `visits` 降序，其次按标签。含 0 次。`pages` 不含 `unknown`。

## 7. 界面

`/admin/usage` 增加「数据访问 / 界面使用」切换。默认数据访问，现有内容不变。`?view=interface` 展示三个指标卡和三块排行，时间窗口与数据访问共用。

0 次保留。`unmappedViews > 0` 时提示「另有 N 次页面打开未能对应到已知页面。」

## 8. 验收

- 服务端：窗口聚合、深层页归入父菜单、未知路径不落原文、required 未登录 401、open 模式记为 `local-admin`。
- 前端：路径变化上报一次；只改查询串不上报；界面使用渲染排行与 0 次。
- `lint:terminology` 通过。不做浏览器验收。
