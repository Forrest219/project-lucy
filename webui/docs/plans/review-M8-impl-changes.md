# M8 Impl 复核 — Review Notes (2026-07-27)

> **作者**: Mavis (builder peer review)
> **范围**: 复核 [TableWhitelist.tsx](../../src/pages/connections/TableWhitelist.tsx) + [table-whitelist.test.tsx](../../src/__tests__/table-whitelist.test.tsx) + [AddSchemaDrawer.tsx](../../src/components/AddSchemaDrawer.tsx) + [app.css](../../src/app/app.css) 的 M8 增量修改
> **对照基线**: [11-connection-whitelist-test-ux-refresh.md](../11-connection-whitelist-test-ux-refresh.md) (spec) + [wo-M8-connection-whitelist-test-ux-refresh.md](wo-M8-connection-whitelist-test-ux-refresh.md) (plan)
> **状态**: 测试 8/8 绿，但代码层 7 条反对意见。按严重程度排序。

## TL;DR

- 🔴 **必须改** 2 条
- 🟡 **建议改** 3 条（spec 明确点名 + 测试覆盖缺口）
- 🟡 **opinion 级** 1 条（UX 取舍）
- 🟢 **Nits** 留给后续 milestone

---

## 🔴 1. "查看语义" 链接被 `row.completion !== undefined` 守门员卡死核心场景

**位置**: `TableWhitelist.tsx:474`

```tsx
{(status === "included" || status === "semantic_pending") && row.completion !== undefined ? (
  <Link to={`/sources/${conn}/${schema}/${table}`}>查看语义</Link>
)
```

**Spec 4.5 原话**:

> | enabled persisted | `查看语义`, link to the source detail page if route exists |

只说 "if route exists" —— **没说"if completion exists"**。

**踩中的真业务场景**: 一张表在 `ktx.yaml` 的 `enabled_tables` 里（即 `enabledPersisted === true`），但 `GET /api/sources` 还没返回它的 `SourceSummary`（刚 save 完还没 refresh / ingest 还没跑 / 跨数据源扫描未触达）。这种 row 的 status 走 `semantic_pending` 分支（`enabledPersisted && completion !== "done"`，completion 是 `undefined` 也走这条），但你的 `row.completion !== undefined` 守门员把链接藏掉了。

结果：用户在动作列看不到任何 actionable 的东西（fallback 是死代码 "待扫描"，见下一条）。**这就是 spec 4.1 列为目标用户的核心场景之一** —— "已存在但语义未完成"。

**建议**: 删 `row.completion !== undefined`，让所有 `included || semantic_pending` 都显示链接。如果担心 source 路由 404，至少按 completion 状态分流：
- `completion === "done"` → "查看语义"（去 source 详情）
- `completion === "partial" || completion === undefined` → "补全语义"（同上路由或 query 提示）
- `completion === "not_started"` → "开始建模"（同上）

不要用纯文字"待扫描"占位。

## 🔴 2. "待扫描" 分支是死代码

**位置**: `TableWhitelist.tsx:492`

```tsx
) : status === "pending" ? (
  <span>待保存</span>
) : (
  <span>待扫描</span>  // ← 永远走不到
);
```

`whitelistStatus()` 只有 4 个返回：`pending | included | semantic_pending | disabled`。你的前 3 个分支已经覆盖：`(included || semantic_pending)` + `pending` + `disabled`。第 4 个状态不存在，else 不可达。

如果你真打算新增一个 `not_scanned` 状态（比如表示"持久化但 sources 还没拉到"），那要同时改 `whitelistStatus` + type definition + 文案 + 测试；如果不打算，这个 else 直接删。

## 🟡 3. 多 connection 保存进度 — spec 4.6 漏了

**Spec 4.6 原话**:

> If draft changes span multiple connections, save sequentially per changed connection and **show per-connection progress**.

**当前实现**: `saveMutation` 在循环里 PUT + POST，但 floating bar 的按钮文字只从 "保存并触发扫描" 变成 "保存中..."。**没有任何 per-connection 进度**。

**问题场景**: 5 个 connection 都有改动 + 最后那个 ingest 跑 30s 时，用户盯着一个 "保存中..." 按钮不知道：
- 卡在哪一步
- 还要多久
- 是不是网络断了

`previewMutation` 你已经做到 per-connection section（drawer 里多个 `pl-preview-section`），save 这边复用 `results` 数组的 `connId` 就能写一个 stepper：
```
已保存 mysql-aliyun (1/3) · 正在写入 analytics-pg… · 等待 finance-db
```

**测试覆盖**: 现有 `defaultHandlers` fixture 只用 1 connection。2 connection 的 case 只验证 preview 路径，没验证 save 路径的 per-connection 进度 UI。

## 🟡 4. "可折叠的扫描日志" 你只渲染成静态 `<pre>`

**位置**: `TableWhitelist.tsx:617-624`

**Spec 4.8 原话**:

> Show success/failure toast and retain a **collapsible** scan log.

**当前实现**:
```tsx
{scanLog && (
  <div className="mt-6">
    <p>扫描日志 ({scanLog.connectionId})</p>
    <pre>{stdout/stderr}</pre>
  </div>
)}
```

`pre` 永远展开。`ConnectionTest` 那边的 `.pl-collapsible-log` + `<button aria-expanded>` 套路是现成的，照搬即可。

**更严重的问题**: 5 个 connection 时 `scanLog` 只显示**最后一个**的（`results[results.length - 1]`），前 4 个的失败/成功 stdout 用户根本看不到。要么按 `results` 数组分别渲染，要么明确把每个 connId 的日志分别折叠收起。

## 🟡 5. 抽屉里"已移除" chip + 排序稳定性无测试

**Spec 4.7 原话**:

> Changed table chips grouped into `新增` and `移除`

你的 `previewMutation.data.map` 里两段 `setDifference` 都有 —— **逻辑正确**。但你的测试里只测了"新增"路径（`dataforai.superstore_returns`）：

```ts
// 现有 "previews every changed connection" 测试
expect(within(drawer).getAllByText(/dataforai\.superstore_returns/).length).toBeGreaterThan(0);
// 没有移除 chip 的断言
```

**没覆盖**:
- 用户从 `enabledTables` 移除一张表，点预览，能看到 "移除：xxx" chip 吗？
- 新增 + 移除混合时，chip 顺序稳定吗？（`setDifference` 用 `for..of` 在不同浏览器上顺序一致吗？）
- 移除后 `oldEnabledTables` 包含这张表、`newEnabledTables` 不包含 —— 这个 API 行为你 mock 对了吗？

建议加 1 个测试 fixture：persisted = `[orders, returns]`，draft = `[people]`，预览应该看到：
- 旧 → 新：`2 -> 1`
- 新增 chip：`dataforai.superstore_people`
- 移除 chip：`dataforai.superstore_returns`

## 🟡 6. `setPreviewOpen(false)` 在所有 draft mutation 路径上 —— UX 反直觉（opinion 级）

你的设计意图我理解：避免 stale dry-run。这是对的。**但代价**:

| 操作 | 现在关 preview | 我的建议 |
|---|---|---|
| `toggleRow` (单 checkbox) | ✓ 关 | ✗ 保留 —— 单 checkbox 改完，用户大概率想"再点确认看下新 diff"。关掉反而要再点 2 次 |
| `selectAllVisible` | ✓ 关 | ✓ 关 —— 批量操作，预览肯定过期 |
| `invertVisible` | ✓ 关 | ✓ 关 —— 同上 |
| `resetDraft` | ✓ 关 | ✓ 关 —— 兜底 |

更好的方案：保留 preview 但加一个"已过期"小提示："预览基于旧 draft，点击重新生成"。这样单 checkbox 微调的用户不用多点一次。

这个算 opinion 层面，spec 没强制，看你取舍。要保留现状至少加个 `previewMutation.isStale` 的 indicator。

## 🟢 7. Nits（不阻塞，留给 M9 / M10）

### 7a. `tablesQueries[idx]?.data` 索引脆弱

**位置**: `TableWhitelist.tsx:135`

```tsx
const tablesData = tablesQueries[idx]?.data;
```

如果未来 connections 顺序会变（re-order / 增删），`idx` 会错位。改成在 `useQueries` 里每个 query 自带 `connId` 元数据，或者用 `find` 而不是索引。

### 7b. `allSchemas` 跳过空 schema 行

**位置**: `TableWhitelist.tsx:163`

```tsx
for (const r of rows) if (r.schema) set.add(r.schema);
```

如果 `parseQualifiedName` 解析出空 schema（qualifiedName 没 `.`），这张表**永远不进 schema filter 候选**。当前 spec 数据都有 schema，无影响；留个边角。

### 7c. `enabledTables` 持久态 vs `/tables` 端点列表不一致

如果某张表在 `enabledTables` 里但 `/tables` 这次没列出来（incremental 扫描、表被删），它就完全不会出现在 row 列表里 —— 用户以为"还在白名单里"但 UI 看不到。

pre-existing，M8 不要求修。建议在 status banner / floating bar 的 "重置" tooltip 里挂个 caveat。

### 7d. AppFrame 测试 Toaster portal 污染

`test/setup.ts` 的全局 `cleanup()` 你之前加了，但 commit 里没碰它。`M9` 真要把 `ConnectionTest` 引入 Toaster 测试时这个坑会再咬一次（你 M8 期间就为这个改了 5 个测试文件）。建议在 M8 commit message 里挂一句"全局 cleanup 在 setup.ts，下个 milestone 别动"。

---

## 推荐的修法（按优先级）

### P0 — 必修
1. **删 `row.completion !== undefined` 守门员 + 删死代码 `待扫描` 分支**。spec 4.5 明确说要给 enabled-persisted 行提供 source 详情入口。简单 2 行改动，但影响 spec acceptance。

### P1 — 强烈建议
2. **加 per-connection 保存进度 UI**。复用 `saveMutation` 已经有的 `results` 数组，加 `savingConnIds` 状态 + floating bar 内部 stepper。一个新测试 fixture（3 connection）就能盖住。
3. **扫描日志按 connection 分组 + 折叠**。`ConnectionTest` 那边 `.pl-collapsible-log` 套路现成，照搬。日志按 `results` 数组渲染多 section。

### P2 — 建议（不影响交付）
4. **加"移除 chip"测试覆盖**。5 分钟的活，覆盖 spec 4.7 的另一半 acceptance。
5. **`toggleRow` 不要关 preview**（opinion 级，见上）。

### P3 — Nits，留 M9
- 7a `tablesQueries[idx]` 索引
- 7b 空 schema 行
- 7c enabledTables vs /tables 不一致
- 7d setup.ts 全局 cleanup 文档化

---

## 验收对照

| spec acceptance | 状态 | 备注 |
|---|---|---|
| 4.1 表格按 connection+schema 分组 | ✅ | 你修了 |
| 4.4 search + schema filter + 可见选择工具 | ✅ | |
| 4.5 4 个 status badges + 行动作 | ⚠️ | "查看语义" 守门员 bug，见 #1 |
| 4.5 enabled persisted 显示"查看语义" | ❌ | 见 #1 |
| 4.6 draft 变更时关闭旧预览 | ✅ | 但 #6 opinion |
| 4.6 multi-connection 顺序保存 | ✅ | 逻辑对 |
| 4.6 multi-connection **per-conn 进度** | ❌ | 见 #3 |
| 4.7 YAML drawer per-connection section | ✅ | 你加了 |
| 4.7 新增/移除 chips 分组 | ⚠️ | 逻辑对、测试只盖一半，见 #5 |
| 4.8 save 后保留**可折叠** scan log | ❌ | 静态 `<pre>`，见 #4 |
| 4.8 多 connection 时所有日志可见 | ❌ | 只显示最后一个，见 #4 |
| 7 a11y icon-only 按钮 aria-label | ✅ | checkbox `aria-label` 有了 |
| 7 floating bar 键盘可达 | ✅ | button + region |
| 7 drawer close 键盘可达 | ✅ | button |
| 7 collapsible logs aria-expanded | ⚠️ | #4 没折叠 |
| 7 状态 banner text+color | ✅ | pl-validation-banner 双通道 |

**结论**: spec 的硬性 acceptance 有 3 条不达标（4.5、4.6 进度、4.8 折叠）。其余都对。

---

## 不会做但你可能想做

- M9 提一个 "在 source 详情补语义" 的入口（route `/sources/:conn/:schema/:table` 已存在但 M8 不要求）
- 移除 `previewMutation` 里 `setPreviewOpen(false)` 的全套连锁（如果你 #6 选择不关 preview）

---

**这个 review 不阻塞 commit 已经合的 3c46a58**，但建议下一 PR 至少修 #1（守门员 + 死代码）+ #3（per-conn 进度）。
