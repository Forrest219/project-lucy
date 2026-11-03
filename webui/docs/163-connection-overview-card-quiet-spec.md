# 连接概览卡片收纳

| 元数据 | 内容 |
|---|---|
| 文档名称 | 连接概览卡片收纳 |
| 文档类型 | Product / UX Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-12 |
| 委托人 | xingchen |
| 状态 | 已实现 |
| 适用范围 | `/connections` 连接卡片与列表上方的问数服务提示 |
| 关联工单 | `webui/docs/plans/wo-202610-16-connection-overview-card-quiet.md` |
| 上游 | Spec 32、Spec 73、Spec 101、Spec 107、Spec 108、Spec 127、Spec 130、Spec 157；`docs/specs/lucy-mcp-execution-runtime-ack-debug-spec.md` §8 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 从连接卡片拿掉四层运行时和页脚五按钮；接入进度兼任继续向导；低频操作进入「更多」；问数服务只在未加载或不可用时于列表上方提示一次 |

一张卡片对应一个连接。20 个库时，页面不再为每个库重复 Config、Catalog、Policy Runtime、MCP Execution，也不再把「继续向导」到「删除连接」排成一排同级按钮。

## 1. 问题

2026-10-12 在 `http://127.0.0.1:55176/connections` 看到：

- 每张卡片页脚都有 Config、Catalog、Policy Runtime、MCP Execution 和「重新检测执行层」。前三项在各卡片上相同。Policy Runtime 是全站一份。点「重新检测执行层」不会加载配置，待确认时仍提示重启问数进程。
- 页脚另有一排同级描边按钮：继续向导、+ 添加 Schema、重新拉取库内目录、同步配置变更、删除连接。删除与添加 Schema 权重相同。继续向导出现或消失时，这一排会变长。
- 卡片抬头已经有连通健康、配置同步时间和接入进度。Schema 行已经有查看 Manifest、维护启用表范围和「更多」。

## 2. 目标

1. 连接卡片表达这条库的身份、连通、Schema 和启用情况。
2. 每张卡片常驻操作只有「添加 Schema」和「更多」。
3. 接入未完成时，从已有的「接入进度 · 第 n 步」进入向导，不再另放一颗「继续向导」。
4. 「重新拉取库内目录」和「刷新本地目录」留在「更多」里，并各有一行可见说明。
5. 「删除连接」留在「更多」的危险项里。确认抽屉、连接 ID 输入和删除 API 保持 Spec 127。
6. 问数进程未加载已保存连接，或问数服务不可用时，列表上方只出现一条提示，并链到 MCP 调试台。待确认不提示。

## 3. 非目标

- 不改 MCP 调试台。四层状态和「重新检测执行层」仍只放在 `/admin/mcp-playground`。调试台上的提示文案本工单不改。
- 不在连接概览重启问数进程，也不从本页调用 `POST /api/admin/mcp-runtime/canary`。
- 不在连接概览放「重载执行层」入口，也不从本页调用 `POST /api/admin/mcp-runtime/reload`。
  复核结论（Spec 191 工单 G-5）：进程级重载按钮只放 MCP 调试台。连接概览是高频页，
  放进程级重载易被误触；本页「列表上方只出现一条提示，并链到 MCP 调试台」的口径不变。
- 不改连通探测、Schema 表、行内「更多」、启用表范围、添加 Schema 抽屉、删除确认抽屉。
- 不改 PageHeader 的「启动接入向导」和「新建连接」。
- 不把「重新拉取库内目录」和「刷新本地目录」合成一个动作。
- 不改上传抽屉、添加 Schema 抽屉里 Spec 73 已写定的「同步配置变更」。本页卡片手动刷新使用术语标准中的「刷新本地目录」，与卡片内「本地目录未刷新」横幅同名。
- 不改 `GET /api/admin/mcp-runtime/status` 的响应字段。

## 4. 修订关系

| 原规定 | 本 Spec 之后 |
|---|---|
| Spec 32 §4.1：连接级操作放在底部 Action Bar，与添加 Schema、刷新本地目录并列 | 底部工具栏取消。常驻操作在卡片抬头右侧 |
| Spec 127 §6.1、§8：删除连接是页脚同级 secondary 按钮 | 删除连接在「更多」内，危险色文字。抽屉内确认按钮仍按 Spec 127 |
| Spec 130 §5.2：卡片右上方另有「继续向导」 | 「接入进度 · 第 n 步」本身就是继续入口 |
| 执行层调试 Spec §8：连接概览与 MCP 调试台都展示四层徽章 | 连接概览不再展示。MCP 调试台仍展示 |
| Spec 101：超出预算的动作进入「更多」 | 连接卡片沿用这一纪律。可见文案按钮只有「添加 Schema」 |
| Spec 191：执行层重载提供「重载执行层」入口 | 入口只在 MCP 调试台。连接概览不放进程级重载按钮，提示仍链到 MCP 调试台 |

## 5. 卡片

抬头左侧保持连接 ID、引擎、Host、Database。抬头中的连通健康、只读风险、配置同步时间保持 Spec 108 与现有目录同步时间。

抬头右侧操作区，从左到右：

| 控件 | 出现条件 | 可见文案 | 样式 |
|---|---|---|---|
| 接入进度 | `deriveAssistantResumeState` 的步骤小于 6 | `接入进度 · 第 {n} 步` | 现有进度标签的可点击形态，不是 `pl-btn--secondary`。悬停与向导弹窗抬头同为「接入进度 · 第 {n} 步，共 6 步 · 当前：{步骤名}」 |
| 添加 Schema | 始终 | `添加 Schema` | `pl-btn pl-btn--secondary` |
| 更多 | 始终 | `更多` | 与 Schema 行相同的 `details` / `summary` 菜单 |

接入进度的 `aria-label` 为 `继续向导，接入进度 · 第 {n} 步`。点击后以该连接和当前步骤打开接入向导，行为与今天的「继续向导」相同。步骤为 6 时不渲染这个控件。`data-testid` 使用 `resume-assistant-{connectionId}`。同一控件承载原来的进度文案，不再另有 `connection-assistant-banner-*` 节点。

「更多」的 `aria-label` 为 `更多连接操作：{connectionId}`，`data-testid` 为 `connection-more-{connectionId}`。菜单项顺序：

1. **重新拉取库内目录。** 可见说明：向数据库查询当前可见的 Schema 和表数量。行为、禁用和「拉取库内目录...」与现在的按钮相同。`data-testid` 仍为 `refresh-live-catalog-{connectionId}`。
2. **刷新本地目录。** 可见说明：重新读取本机 YAML，不连接数据库。行为与现在的「同步配置变更」相同，仍走 `CatalogReloadButton`。`data-testid` 仍为 `catalog-reload-{connectionId}`。进行中文案为「刷新中...」。
3. 分隔线。
4. **删除连接。** 危险色文字，打开现有 `DeleteConnectionDrawer`。`data-testid` 仍为 `delete-connection-{connectionId}`。不得使用与「添加 Schema」相同的 secondary 按钮。

「本地目录未刷新」横幅保留，横幅按钮文案仍是「刷新本地目录」。横幅是第一次尚无同步记录时的提示；菜单项留给之后再读一次。

Schema 为空时，正文仍是「尚未配置 Schema。请先添加 Schema。」不在空态再放一排按钮。

配置同步进行中、读取失败或最近一次失败时，在 Schema 表下方保留现有状态句，例如「配置同步失败」。这一行不是工具栏，不带操作按钮。没有该状态时，不渲染灰底页脚。

连接卡片内不得出现：Config、Catalog、Policy Runtime、MCP Execution、重新检测执行层、检测中...、继续向导按钮、同步配置变更按钮。

## 6. 列表提示

提示放在指标卡下方、连接列表上方，全页至多一条。数据来自已有的 `GET /api/admin/mcp-runtime/status`。本页不发起 canary。

## 核心流程（伪代码）

```text
status = GET /api/admin/mcp-runtime/status

if request failed or status is still loading:
  render no execution notice
  render connection cards
  stop

execution = status.execution.status

if execution == "stale":
  render one notice:
    问数服务仍在使用旧配置。已保存的连接里有尚未被它加载的项。
    link 打开 MCP 调试台 -> /admin/mcp-playground
else if execution == "unavailable" or execution == "error":
  render one notice:
    问数服务当前不可用。连接配置已保存，问数要等服务恢复后才能使用这些连接。
    link 打开 MCP 调试台 -> /admin/mcp-playground
else:
  render no execution notice
  # unknown 与 ok 都走这里。unknown 表示尚无成功问数证据，不在本页提示。

for each connection card:
  do not render Config, Catalog, Policy Runtime, MCP Execution, or 重新检测执行层
```

`stale`、`unavailable`、`error` 在现有 `summarizeExecution` 里互斥，提示也只取一条。提示不列举连接 ID。状态请求失败时，连接卡片照常可用。

Policy Runtime 降级不在本页提示。

## 7. 验收

| ID | 场景 | 期望 |
|---|---|---|
| SC-1 | 3 张或更多连接卡片 | 每张卡片都没有四层徽章和「重新检测执行层」。页面不请求 `/api/admin/mcp-runtime/canary` |
| SC-2 | 任意卡片 | 常驻可见操作只有「添加 Schema」和「更多」。页脚没有五按钮工具栏 |
| SC-3 | 向导步骤小于 6 | 可见「接入进度 · 第 n 步」。点击打开该连接的对应步骤。没有第二颗「继续向导」 |
| SC-4 | 向导步骤为 6 | 不显示接入进度，也不显示继续向导 |
| SC-5 | 打开「更多」 | 顺序为重新拉取库内目录、刷新本地目录、分隔线、删除连接。前两项各有 §5 的可见说明 |
| SC-6 | 刷新本地目录 | 只读取本地 YAML，文案不是「同步配置变更」。横幅上的同名按钮仍在 |
| SC-7 | 删除连接 | 菜单项为危险色。确认前必须原样输入连接 ID。不删除物理库 |
| SC-8 | `execution.status=unknown` 或 `ok` | 列表上方没有问数提示 |
| SC-9 | `execution.status=stale` | 只有 §6 的未加载提示，链到 `/admin/mcp-playground` |
| SC-10 | `execution.status=unavailable` 或 `error` | 只有 §6 的不可用提示，链到 MCP 调试台 |
| SC-11 | 状态接口失败 | 不出现问数提示，连接卡片仍可操作 |
| SC-12 | `/admin/mcp-playground` | 四层状态和「重新检测执行层」仍在 |
| SC-13 | 打开连接「更多」后点击菜单外或按 Esc | 菜单关闭。打开另一张卡或 Schema 行的「更多」时，当前菜单也关闭。点菜单项后菜单关闭 |

## 8. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None

沿用已有主术语：添加 Schema、刷新本地目录、重新拉取库内目录、删除连接、继续向导（仅作无障碍名称）、接入进度、MCP 调试台。

禁止把本页卡片动作写成「同步配置变更」「重新检测执行层」，或把 Schema 写成架构 / 模式。`Schema`、`MCP`、`YAML`、连接 ID 的 DOM 节点保持 `notranslate` 与 `translate="no"`。

## 9. Design System Compliance

- 引用 `webui/docs/design-system/10-components-button.md`：同组一个主层级；超出的动作进入「更多」；危险确认留在抽屉，抽屉内确认按钮使用 `pl-btn--danger`。
- PageHeader 仍是「启动接入向导」primary 与「新建连接」secondary，不新增第三颗。
- 卡片「更多」复用 Schema 行的 `pl-row-action-more`，不新做一套菜单。
- 问数提示使用现有 `pl-notice`，不用每卡一枚状态徽章。

## 10. 测试

更新 `webui/src/__tests__/connection-overview.test.tsx`：去掉对页脚五按钮和卡片内四层徽章的断言，改为 SC-1 至 SC-11。SC-13 的连接「更多」收回也由该文件覆盖。更新 `webui/src/__tests__/setup-assistant.test.tsx` 中对「继续向导」按钮文案的断言，改为点击「接入进度」控件。`mcp-playground.test.tsx` 继续断言调试台徽章，对应 SC-12。

本 Spec 的实现验收用 Vitest 与 `npm run lint:terminology`。不要求浏览器测试。
