# M62 Connection & Schema Identifier Casing Consistency Work Order

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中执行 M62：Connection & Schema Identifier Casing Consistency。问题描述：2026-08-03 浏览器核查发现 `/connections`、`/connections/enabled-tables`、`/catalog` 三页上 Connection ID / Schema 名字段在分组标题里被硬编码 `.toUpperCase()`，与同页面的链接文案、aria-label、URL、下拉候选项不一致。

要求阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`（§2.6 浏览器翻译防御 + §3 Schema 行）
- `docs/69-connection-schema-identifier-casing-consistency-spec.md`
- `docs/plans/wo-M61-sidebar-brand-navigation-followup.md`
- `src/pages/Catalog.tsx`
- `src/pages/connections/TableWhitelist.tsx`
- `src/__tests__/catalog.test.tsx`（如存在）
- `src/__tests__/table-whitelist.test.tsx`
- `src/__tests__/connection-overview.test.tsx`（如存在）

## Non-negotiable Boundaries

- **只读源码找证据**：在写代码之前必须先执行搜索复核 §7 的三处源代码确实被查到（`rg -n "toUpperCase" src/` 必须命中本文列出的三处文件）。
- 三处 `.toUpperCase()` 必须删除，不得用 `css text-transform: uppercase` 替代，也不得借助任何 helper / util 转大写后再渲染。直接渲染源大小写。
- 不允许改 fixture 来"绕过"大小写问题（例如把 fixture 改成全大写）。如果当前 fixture 里连接 / Schema 已经是小写（当前测试事实：`mysql-aliyun` / `dataforai`），维持原样；只有 fixture 本身已经全大写时，才把它降为对应的原始小写值（例如 `MYSQL-ALIYUN` -> `mysql-aliyun`）。
- 单测字面量必须按 §5.2 的目标口径更新，不允许改成 `/[A-Z]+/i` 或 toMatchInlineSnapshot 来掩盖回归。
- 不动 `lint:terminology` 词表（spec §6 已说明该 linter 不覆盖本 bug）。
- 不动后端 `server/**`、`ktx.yaml`、`semantic-layer/**`。
- 不动路由 / 导航 / IA / `[data-testid]` 锚点。
- 不做移动窄屏核查。
- 不引入新依赖、不升级框架。
- 不在本 plan 顺手修改无关表名 / measure 名 / 列名大小写 —— 严格只动 Connection ID 与 Schema 名所在的分组标题节点。

## Scope

### Phase 1: 源代码证据复核

执行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
rg -n "toUpperCase" src/
rg -n "DEMO-MYSQL|DATAFORAI|MYSQL-ALIYUN" src/
rg -n "translate=\"no\"|notranslate" src/pages/Catalog.tsx src/pages/connections/TableWhitelist.tsx
```

把 `rg` 输出贴到 commit message 里（或 PR 描述里），作为"已经看到了这三处证据"的凭据。如果 `rg` 没有命中，停下来检查是不是已经被别的工单动过；不要硬推进。

预期输出：精确命中 §7 列出的三处源代码。

### Phase 2: Catalog 分组标题测试

修改 `src/__tests__/catalog.test.tsx`（如不存在，先把它当作新文件建立：测试 Catalog 页面渲染时显示的分组标题；只断言标题中存在原始大小写的连接 / Schema 名）：

1. 测试在组件文档化数据下，`/catalog` 渲染出保留源大小写的分组标题。当前 `catalog.test.tsx` fixture 使用 `mysql-aliyun` / `dataforai`；如果测试数据只传 1 张表，应断言 `连接：mysql-aliyun · Schema：dataforai（共 1 张表）`；如果为本用例构造同组 3 张表，则断言 `连接：mysql-aliyun · Schema：dataforai（共 3 张表）`。
2. 测试渲染结果中**不**包含 UI 强制转出的全大写片段，例如用大小写敏感断言确认 `MYSQL-ALIYUN` / `DEMO-MYSQL` / `DATAFORAI` 不存在。
3. 断言 `data-testid` 或外层节点的 `notranslate` className 与 `translate="no"` 属性存在（如果当前实现里没有这个属性，先断言失败，Phase 4 实现再加）。

预期：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/catalog.test.tsx
```

应先失败。

### Phase 3: TableWhitelist 分组标题测试

修改 `src/__tests__/table-whitelist.test.tsx`：

1. 把第 243 / 360 / 370 / 406 / 446 / 867 行附近所有 `MYSQL-ALIYUN` / `DATAFORAI` / `ANALYTICS` / `OPENCLAW_DB` 字面量按 fixture 源字符串替换为 `mysql-aliyun` / `dataforai` / `analytics` / `openclaw_db`。如果出现 `DEMO-MYSQL`，同样按对应 fixture 源字符串更新。
2. 检查 fixture 数据：当前 fixture 已是 `mysql-aliyun` / `dataforai`，不要为本工单迁移到 `demo-mysql`。只有 fixture 本身已经全大写时，才把 fixture 降为对应的原始小写值。
3. 不要用 `toMatchInlineSnapshot` / `/i` 正则绕过。
4. 视情加入新断言：`notranslate` className + `translate="no"` 属性存在。

预期：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/table-whitelist.test.tsx
```

应先失败（先于 Phase 4）。

### Phase 4: 移除 toUpperCase、补 translate 防御

修改 `src/pages/Catalog.tsx`：

1. 找到第 32 行形如 ``return `连接：${conn.toUpperCase()} · Schema：${schema.toUpperCase()}（共 ${count} 张表）`;`` 的语句，改成 ``return `连接：${conn} · Schema：${schema}（共 ${count} 张表）`;``。
2. 把分组标题的 DOM 节点加 `translate="no"` 与 className `notranslate`。如果当前是 `<h2>` 或 `<div>` 包整段，把它当作整段保护；如果现状是分了多个 span，至少保护 `<span>` 的文本节点。
3. 不要再用 helper 转大写。

修改 `src/pages/connections/TableWhitelist.tsx`：

1. 第 623 行 / 第 698 行：去掉 `conn.id.toUpperCase()` 和 `schema.toUpperCase()`，直接渲染。
2. 同样补 `translate="no"` / `notranslate`。

验证：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/table-whitelist.test.tsx src/__tests__/catalog.test.tsx
```

Expected: PASS。

### Phase 5: 其它已知用大写的地方

继续搜索复核：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
rg -n "toUpperCase" src/ --glob '!**/__tests__/**'
```

如果 spec §7 之外仍有其它针对 Connection / Schema 字符串的 `.toUpperCase()` 调用，统一按 Phase 4 处理；如不是连接 / Schema 字符串，继续追查原因或保留原状；如果发现与本 spec 同源的问题（不同文件连接 id 大写），就地修复并在 commit 标注。

如果搜索命中的是无关代码（例如 metric 名 / 列名），**不要**碰，记在 PR 描述的 `Out-of-Scope findings` 段。

### Phase 6: 终端验证

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/table-whitelist.test.tsx src/__tests__/catalog.test.tsx src/__tests__/connection-overview.test.tsx
npm run build
```

Expected：全部 PASS。

桌面浏览器视觉核查（仅作为本次 spec 闭环证据，spec §10 已显式要求）：

1. 打开 `http://127.0.0.1:55176/connections/enabled-tables`，看到分组标题保留实际源字符串大小写，例如浏览器实测数据为 `demo-mysql` 时显示 `连接：demo-mysql · Schema：dataforai（共 3 张表）`。
2. 打开 `http://127.0.0.1:55176/catalog`，看到同样按实际源字符串显示的分组标题。
3. 打开 `http://127.0.0.1:55176/connections`，与原状态一致（小写）。
4. 任意切一条记录，下拉候选项仍是小写。
5. 不做移动窄屏核查。

## Acceptance Criteria

- 三页面（`/connections`、`/connections/enabled-tables`、`/catalog`）上所有 Connection ID / Schema 名字符串统一使用仓库原始大小写，分组标题不再大写。
- 涉及的 DOM 节点有 `translate="no"` 与 className `notranslate`。
- `src/pages/Catalog.tsx`、`src/pages/connections/TableWhitelist.tsx` 中不再对 Connection ID / Schema 字符串调用 `.toUpperCase()`。
- 相关单测通过；hard-coded 字面量已按 §5.2 目标口径更新。
- 路由、链接、表行操作按钮、Manifest 状态 chip、缺失 Manifest 诊断跳转无回归。
- `lint:terminology` / `npm test` / `npm run build` 通过。
- 终端视觉核查与 §10 一致。
- 不动 `lint:terminology` 词表、不动后端 / 路由 / IA / `[data-testid]` 锚点 / fixture 之外的数据。

## Code Review Checklist

- [ ] `rg -n "toUpperCase" src/ --glob '!**/__tests__/**'` 在 catalog 与 whitelist 改动后**对 Connection / Schema 字符串**已无命中。
- [ ] `rg -n "DEMO-MYSQL|DATAFORAI|MYSQL-ALIYUN" src/` 在仓库根目录剩余命中仅限"故意构造的反例"或历史说明；不应再作为目标 UI 文案断言出现。
- [ ] 三个分组标题节点的 DOM 都带 `translate="no"` 与 `notranslate` className。
- [ ] 测试字面量是仓库原始大小写，不依赖正则忽略大小写。
- [ ] `lint:terminology` 不被绕过、未改词表。
- [ ] 没有顺手改 route / IA / `[data-testid]`。
- [ ] 没有改 fixture 中的连接 / schema 名字大小写来"对齐大写"。
- [ ] `npm test` 与 `npm run build` 通过。
- [ ] commit message 包含 `git status --porcelain` 输出尾巴 + `rg` 复核证据引用。
