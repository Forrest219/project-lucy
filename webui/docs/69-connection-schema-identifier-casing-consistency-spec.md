# Connection & Schema Identifier Casing Consistency Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection & Schema Identifier Casing Consistency Spec |
| 文档类型 | Product / UX / Identifiers Hygiene Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-03 |
| 反馈来源 | 2026-08-03 浏览器核查 `/connections` / `/connections/enabled-tables` / `/catalog` 三页面对照 |
| 适用范围 | Lucy WebUI 数据接入与语义建模分组标题、链接、aria-label、URL、术语呈现 |
| 前置术语 | `webui/docs/00-product-terminology-standard.md` §2.6 浏览器翻译防御、§3 Schema 行 |
| 关联工单 | `webui/docs/plans/wo-M62-connection-schema-identifier-casing-consistency.md` |

## 1. Background

2026-08-03 浏览器核查发现，连接 / Schema 标识符在 Lucy WebUI 的三个相关页面上同时存在两套写法，跨页面观感割裂：

- `/connections`：连接名 + Database 名 + Schema 行 均按仓库原始小写呈现（浏览器实测样例：`demo-mysql`、`dataforai`、`openclaw_db` 等；当前单测 fixture 样例：`mysql-aliyun` / `dataforai`）。
- `/connections/enabled-tables`：筛选下拉里 `Schema` 候选项是小写（`dataforai`/`meta`/`demo_finance`/...）；但表上方的分组标题会把源字符串转成全大写，例如 `连接：DEMO-MYSQL · Schema：DATAFORAI（共 3 张表）` 或测试 fixture 中的 `连接：MYSQL-ALIYUN · Schema：DATAFORAI（共 3 张表）`。
- `/catalog`：表名链接、aria-label 和路径都保留源大小写（例如 `/catalog/demo-mysql/dataforai/superstore_orders` 或测试 fixture 的 `/catalog/mysql-aliyun/dataforai/superstore_orders`、维护 `dataforai.superstore_orders 语义`）；但表格上方的分组标题同样被转成全大写。

源头定位（v0.1 核查）：

- `webui/src/pages/Catalog.tsx:32` —— ``return `连接：${conn.toUpperCase()} · Schema：${schema.toUpperCase()}（共 ${count} 张表）`;``
- `webui/src/pages/connections/TableWhitelist.tsx:623` —— `连接：{conn.id.toUpperCase()} · Schema：{schema.toUpperCase()}`
- `webui/src/pages/connections/TableWhitelist.tsx:698` —— `连接：{conn.id.toUpperCase()} · Schema：{schema.toUpperCase()}`

相关测试已在用全大写断言（侧面说明实现与测试同步大写并不代表"正确"）：

- `webui/src/__tests__/table-whitelist.test.tsx:243 / 360 / 370 / 406 / 446 / 867` —— `expect(screen.getByText("连接：MYSQL-ALIYUN · Schema：DATAFORAI")).toBeInTheDocument()`

## 2. Goals

1. 同一连接 / Schema 在所有相关页面里显示同一个字符串，**严格保留仓库原始大小写**（浏览器实测样例：`demo-mysql`、`dataforai`、`openclaw_db`；当前单测 fixture 样例：`mysql-aliyun` / `dataforai`）。
2. 三页（`/connections`、`/connections/enabled-tables`、`/catalog`）的分组标题、链接文案、aria-label、URL 风格统一。
3. 数据库 / 仓库对象标识符的显示与术语标准 §3 Schema 行、§2.6 浏览器翻译防御兼容。
4. 保留所有现存的可用行为（路由跳转、Manifest 状态 chip、表行操作按钮、缺失 Manifest 诊断跳转、键盘交互）。

## 3. Non-goals

- 不修改任何后端 API、路由或 `ktx.yaml`。
- 不调整数据接入、语义建模的整体信息架构。
- 不重做 `/connections`、`/connections/enabled-tables`、`/catalog` 的页面布局。
- 不引入新的依赖或图表方案。
- 不做移动窄屏适配。
- 不动不相关的命名（例如表名 / 列名 / measure 名），仅处理连接 ID 与 Schema 名。
- 不修改 `webui/config/data-qa-instructions.md` 或运行时提示文案。
- 不改 `lint:terminology` 现有禁用词表（见 §6）。

## 4. Findings From Browser QA

| 反馈 | 核查结论 | 当前原因 | 修正方向 |
|---|---|---|---|
| `/connections/enabled-tables` 分组标题"全大写" | 属实 | `TableWhitelist.tsx:623` 与 `:698` 两次 `.toUpperCase()` | 移除 `.toUpperCase()`，直接渲染 `conn.id` 与 `schema` |
| `/catalog` 分组标题"全大写" | 属实 | `Catalog.tsx:32` 模板字符串里 `.toUpperCase()` | 移除 `.toUpperCase()` |
| `/connections` 与其他两页命名不一致 | 属实 | `/connections` 直接渲染源数据，没有 `.toUpperCase()`，所以保持小写 | 维持原样作为 reference，修正另外两页向其看齐 |
| 链接 / aria-label / URL 已经是小写 | 属实 | 链接构造未调用 `.toUpperCase()` | 不需要修改，作为对齐基线 |

## 5. UX Requirements

### 5.1 单一显示规则

在 Lucy WebUI 任何用户可见位置显示 Connection ID 或 Schema 名时，**必须使用仓库中的原始大小写**，不得调用 `.toUpperCase()`、`.toLowerCase()` 或任何隐式改大小写的转换（CSS `text-transform` 也算例外 —— 见 §5.4）。

适用范围：

- 表格 / 列表 / Drawer / Modal / Toast 内的分组标题、列头、单元。
- 链接文案、aria-label、`<title>`、Tooltip。
- 路径和 URL 显式展示。
- PageHeader / Breadcrumb 等导航元素。
- 测试断言。

不进数据库 schema 表的物理字符串（`host`、`database`、`endpoint`）不在本 spec 范围，但 `Database` 字段紧邻 Connection ID 的情况下也不得调用大小写转换（保持现状 —— `/connections` 直接渲染）。

### 5.2 三页面一致性

| 页面 | 元素 | 当前 | 目标 |
|---|---|---|---|
| `/connections` | 连接名 | 源字符串，例如 `demo-mysql` 或 `mysql-aliyun` | 维持源字符串 |
| `/connections` | Database | `dataforai` / `demo_finance` | 维持 |
| `/connections` | Schema 行 | `dataforai`、`openclaw_db` 等 | 维持 |
| `/connections/enabled-tables` | 分组标题 | 源字符串被转全大写，例如 `连接：DEMO-MYSQL · Schema：DATAFORAI（共 3 张表）` / `连接：MYSQL-ALIYUN · Schema：DATAFORAI（共 3 张表）` | 保留源字符串，例如 `连接：demo-mysql · Schema：dataforai（共 3 张表）` / `连接：mysql-aliyun · Schema：dataforai（共 3 张表）` |
| `/connections/enabled-tables` | "Schema 筛选" 下拉选项 | `ai` / `dataforai` / ... | 维持 |
| `/catalog` | 分组标题 | 源字符串被转全大写，例如 `连接：DEMO-MYSQL · Schema：DATAFORAI（共 3 张表）` / `连接：MYSQL-ALIYUN · Schema：DATAFORAI（共 3 张表）` | 保留源字符串，例如 `连接：demo-mysql · Schema：dataforai（共 3 张表）` / `连接：mysql-aliyun · Schema：dataforai（共 3 张表）` |
| `/catalog` | 链接 URL | `/catalog/demo-mysql/dataforai/...` 或 `/catalog/mysql-aliyun/dataforai/...` | 维持源字符串 |
| `/catalog` | 链接文案 | `superstore_orders`、`维护 dataforai.superstore_xxx 语义` | 维持 |

### 5.3 浏览器翻译防御

§2.6 要求对数据库对象名节点加上 `translate="no"` 与 className `notranslate`。本次涉及的所有连接 / Schema 字符串所在 DOM 节点（分组标题、链接、aria-label、URL 区）必须满足：

- `translate="no"`
- className 含 `notranslate`

如果当前没有，需要同时补齐；如果已有，仅跟随 `.toUpperCase()` 删除一起刷新断言。

### 5.4 CSS 例外

**不允许**用 CSS `text-transform: uppercase` 或 `text-transform: capitalize` 对 Connection ID / Schema 字符串做视觉变形 —— 这同样会让浏览器翻译插件获得不一致的视觉与 DOM 文案组合。分组标题与所有用户可见区域必须用源字符串大小写。

### 5.5 标签 / 计数 / 标点

- 分组标题结构：``连接：<conn> · Schema：<schema>（共 <count> 张表）``，结构与连接符 `·`、计数格式维持现状，仅大小写修正。
- 计数值仍按当前显示规则（小写数字 + "张表"），不做大小写改动。
- 分组标题前后不得加额外 lower / upper 装饰。

## 6. Tooling / Linter

- `npm run lint:terminology` 当前扫的是禁用词（"财政部舱单 / 舱单 / 替代测试 / 重新加载资产 / 模式清单 / 添加架构 / 目标架构 / 上传报价包" 等），不会 fail 调 `.toUpperCase()` 的代码。本次不进 linter 词表。
- 如果后续要把"对连接 / Schema 名调用 `.toUpperCase()` / `.toLowerCase()`"列为 linter 级别防错，必须新写一个静态扫描脚本（不在本 spec 内）。
- `lint:ia-boundary`、`lint:spec`、`snapshot-product.mjs` 不在本 spec 触达范围。

## 7. Implementation Surface

必须修改：

- `webui/src/pages/Catalog.tsx`
  - 删除第 32 行模板字符串里的 `conn.toUpperCase()` 与 `schema.toUpperCase()`；保留连接符、空格、计数格式。
  - 包装分组标题的节点加 `translate="no"` 与 `notranslate`（如果还没有）。
- `webui/src/pages/connections/TableWhitelist.tsx`
  - 第 623 行与第 698 行：移除 `conn.id.toUpperCase()` 与 `schema.toUpperCase()`。
  - 同样补全 `translate="no"` / `notranslate`（如果还没有）。
- `webui/src/__tests__/table-whitelist.test.tsx`
  - 把所有 hard-coded 大写字面量（`MYSQL-ALIYUN`、`DEMO-MYSQL`、`DATAFORAI`）改为当前连接 / Schema 的原始大小写。
  - 不要为了本工单迁移 fixture ID；当前 fixture 已使用 `mysql-aliyun` / `dataforai`，断言应按这些源字符串更新。只有 fixture 本身已经全大写时，才把 fixture 降为对应的原始小写值（例如 `MYSQL-ALIYUN` -> `mysql-aliyun`）。

不需要修改：

- 后端 `webui/server/**`、`ktx.yaml`、`semantic-layer/**`、`/connections` 页面现有逻辑。
- 路由器、导航、IA。
- 任何 `[data-testid]` 锚点（避免回归）。

## 8. Out-of-Scope But Adjacent

- Connection Test 标题中的大小写：保留原样。
- `Database` 字段内容：保留原样。
- `/connections` 内的连接名（例如 `demo-mysql` / `mysql-aliyun` / `starrocks-r1`）大小写本身就是源数据，本 spec 不引入新约束，只是确认现状符合目标 §5.2。
- KTX daemon / Lucy MCP Proxy 任何字段大小写：本 spec 不介入运行时，只覆盖 WebUI 渲染。

## 9. Acceptance Criteria

1. `/connections/enabled-tables` 分组标题保留源字符串大小写（浏览器实测样例：`连接：demo-mysql · Schema：dataforai（共 3 张表）`；当前单测 fixture 样例：`连接：mysql-aliyun · Schema：dataforai（共 3 张表）`），**不再**出现 `DEMO-MYSQL` / `MYSQL-ALIYUN` / `DATAFORAI` 这类由 UI 强制转出的全大写。
2. `/catalog` 分组标题同上，按实际源数据保留大小写。
3. 三页面里所有用户可见的 Connection ID 与 Schema 名都使用仓库原始大小写（不存在 `toUpperCase` / `toLowerCase` / `text-transform: uppercase` / `text-transform: capitalize` 的副作用）。
4. 涉及的 DOM 节点有 `translate="no"` 与 className `notranslate`。
5. 所有相关单测通过；hard-coded 字面量已经按新口径更新。
6. 路由、链接、表行操作按钮、Manifest 状态 chip、缺失 Manifest 诊断跳转无回归。
7. `npm run lint:terminology`、`npm test`、`npm run build` 全部通过。
8. 桌面浏览器核查 `/connections`、`/connections/enabled-tables`、`/catalog` 三页，分组标题与下拉候选项、链接文案、URL 风格一致（仓库原始大小写）。

## 10. Verification

默认非浏览器验证：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/catalog.test.tsx src/__tests__/table-whitelist.test.tsx src/__tests__/connection-overview.test.tsx
npm run build
```

桌面浏览器视觉核查（仅作为 spec 闭环证据；本仓库默认不做浏览器测试，本 spec 内显式列出核查项是因为问题本质是肉眼可读的一致性）：

- 打开 `http://127.0.0.1:55176/connections`、`/connections/enabled-tables`、`/catalog`。
- 在每个页面对照"§5.2 三页面一致性"表的"目标"列。
- 不做移动窄屏核查。

> 重要提示：reviewer / 上层 agent 在执行该 spec 时如果只跑 `lint:terminology` 是不会 fail 该 bug 的，必须读 §7 Implementation Surface 和源代码才能定位。

## 11. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

Protected terms: `Schema`、`Manifest`、`Catalog`、`Connection`、所有 Schema 名（`dataforai`、`meta`、`openclaw_db`、`demo_finance`、`ai`、`sandbox`）、所有 Connection ID（`demo-mysql`、`mysql-aliyun`、`starrocks-r1`）。

New terms:

- None.

## 12. Reviewer Hints

- 三处 `.toUpperCase()` 调用是直接证据源；不要绕过源码去重写组件 API。
- `lint:terminology` 不会覆盖此类 bug，reviewer 必须 read 源码（§7）核对。
- 不要顺手把测试断言改成忽略大小写（`toMatchInlineSnapshot` 之类），这会掩盖回归。直接更新字面量为正确大小写。
- 分组标题 DOM 节点如果已有 `notranslate`，这次只刷新断言；如果没加，按 §5.3 补齐。
