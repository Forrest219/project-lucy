# Enabled-Scope Semantic Coverage Alignment Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Enabled-Scope Semantic Coverage Alignment Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `/catalog` + `/connections/enabled-tables` + `/overview`（2026-08-05）：启用 1/3 表 vs 语义资产 3 条 / 覆盖 1/3；`webui/docs/00-product-terminology-standard.md` §4.2.1；`webui/docs/39-data-agent-ops-platform-global-ux-spec.md` §5；`webui/docs/100-overview-health-action-deeplink-loop-spec.md`；`webui/server/semantic-layer.ts` `listSources`；`webui/src/pages/Onboarding.tsx` / `Catalog.tsx` |
| 适用范围 | 语义覆盖 / 待补语义口径；`GET /api/sources` 启用标记；`/catalog` 默认范围与跨页关联；手册 FAQ；修订 Spec 100「不改计数口径」约束 |
| 输出位置 | `webui/docs/104-enabled-scope-semantic-coverage-alignment-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 104 |
| 关联工单 | `webui/docs/plans/wo-202608-37-enabled-scope-semantic-coverage-alignment.md` |
| 关联页面 | `/overview`；`/catalog`；`/connections/enabled-tables`（交叉链接）；Help `/help` |
| 关联台账 | `docs/ui-ux-feedback/pages/overview.md`（`UX-OVERVIEW-019`）；`docs/ui-ux-feedback/pages/catalog.md`（`UX-CATALOG-028`）；`docs/ui-ux-feedback/pages/connections.md`（交叉引用） |
| 上游 Spec | Spec 39（接入↔语义强链接）；Spec 47（启用表范围）；Spec 48/100（Catalog / overview 深链）；术语标准 §4.2.1 |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | 已启用表为语义覆盖分母；sources 暴露 `enabled`；Catalog 默认已启用；未启用降权 CTA；手册与台账同步 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地：启用范围对齐语义覆盖 / Catalog 默认筛选 |

## 1. 背景

浏览器核查（demo：`demo-mysql` / `dataforai`）确认矛盾：

| 表面 | 事实 |
|---|---|
| 启用表范围 | 已选 **1/3**（仅 `superstore_orders`） |
| 语义资产 | **3 条结果**，三行均「维护语义 ↗」 |
| 系统概览 | 「语义覆盖 **1/3**」「**2** 张表待补语义」 |

根因：`listSources` 扫全部 Schema Manifest 表，**不读** `ktx.yaml` `enabled_tables`；Overview / Catalog 把 Manifest 全量当作「需要维护的语义宇宙」。

术语标准 §4.2.1 与启用表范围页描述均指向：**启用表范围控制进入语义层的表**；语义建模维护**已进入**的表。实现未对齐。

启用表范围页已区分「查看语义 / 查看字段」；语义资产一律「维护语义」，跨页关联感更弱。

## 2. 目标

1. **运维口径**：`/overview`「待补语义 / 语义覆盖」分母 = **已启用且出现在本地 Manifest 的表**；未启用表不进待办。
2. **API**：`SourceSummary` 增加 `enabled: boolean`（及类型上明确 `qualifiedName`），由服务端用 `enabled_tables` 标记。
3. **Catalog**：默认只展示已启用表；可切换「全部 / 未启用」；未启用行标「未启用」，主操作改为「去启用表范围」，不主推「维护语义」。
4. **深链**：`/catalog?completion=incomplete` 在默认已启用范围内筛未完成（与 Spec 100 Registry 兼容）。
5. **手册 / FAQ**：更新「N 张表待补语义」计算公式。
6. **台账**：登记并 Fixed 本轮条目；跨页面主题补「启用范围与语义覆盖对齐」。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 不从 `listSources` 物理删除未启用表 | Catalog 仍需可查看 Manifest 库存（`scope=all`） |
| 不自动删除未启用表的 semantic overlay | 避免误伤准备中的资产 |
| 不重做启用表范围页状态机 | 已有「已启用，待补语义 / 未启用」 |
| 不新造独立 Catalog 同步指标 | `pendingCatalogItems` 仍与语义缺口同公式，但作用域改为已启用集（见 §5.3） |
| 不把「Manifest 未启用表数」做成强制待办 | 避免逼用户启用全部 Manifest 表；可作为后续次级提示 |
| 不做浏览器验证（本轮） | Vitest + terminology + build + code review |

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Enabled Tables | 启用表范围 / 已启用 | 白名单（主导航）、表白 | `ktx.yaml` `enabled_tables` |
| Semantic Coverage | 语义覆盖 | 完成度（作 overview 主标签） | 分母 = 已启用 ∩ Manifest |
| Semantic Gap Pending | N 张表待补语义 | N 张表需要维护（歧义） | 仅已启用且 `completion !== done` |
| Enabled Scope Filter | 启用范围 | 白名单筛选 | Catalog 工具栏：已启用 / 全部 / 未启用 |
| Not Enabled | 未启用 | 未开放、已禁用（易与 Agent 停用混） | Manifest 有、未进 `enabled_tables` |
| Go To Enabled Tables | 去启用表范围 | 去白名单 | 未启用行主 CTA |

Protected：`enabled_tables`、`Schema Manifest`、`Agent`、Connection / Schema / 表名、路由与 query key。

## 5. 口径定义（事实源）

### 5.1 匹配键

表是否启用：`connectionId` + qualified name。

```text
qualifiedName = SourceSummary.qualifiedName ?? `${schema}.${table}`
enabled ≡ connections[conn].enabledTables.includes(qualifiedName)
```

与连接概览 `enabledLocalTableCount`、启用表范围页一致。

### 5.2 语义覆盖 / 待补语义

设 `S` = `GET /api/sources` 的 `tables`。

```text
enabledSources = S.filter(t => t.enabled === true)
done = enabledSources.filter(t => t.completion === "done").length
total = enabledSources.length
gap = max(0, total - done)
```

- Overview 待办 `semantic-gap`、质量快照「语义覆盖」、`buildServiceHealth` / `summarizeServiceHealth` 的 coverage **一律用上述 done/total**。
- `total === 0`（无启用表或启用表均无 Manifest）：不造「待补语义」项；沿用既有「限定表范围」类就绪提示，不把 Manifest 未启用缺口算进 gap。
- **已启用但不在 Manifest**：不进入 `enabledSources`（无法在语义资产维护）；连接概览 / 启用表范围继续暴露 drift。启用表范围页的无效启用可见性、保存差分门禁与一键移出见 **Spec 116**。本单不把该类计入 gap。

### 5.3 Catalog 对象待处理（本单收窄）

当前实现中 `pendingCatalogItems` 与语义缺口同公式。本单将其同步改为 **已启用集上的 `gap`**，避免 overview 再出现「覆盖 1/3」与「只启用 1 张」双信号。独立「Manifest ↔ enabled_tables drift」指标列为后续 Non-Goal 外演进。

### 5.4 对 Spec 100 的修订

Spec 100 §3 原「不改待处理事项计数口径」被本 Spec **显式修订**：计数公式的分母从「Manifest 全量」改为「已启用 ∩ Manifest」。深链 URL（`/catalog?completion=incomplete`）不变；目标页默认已启用范围后，深链结果与待办一致。

## 6. API

### 6.1 `SourceSummary` 增补

| 字段 | 类型 | 说明 |
|---|---|---|
| `qualifiedName` | `string` | 物理 `schema.table`；与 Manifest `table:` / `enabled_tables` 对齐 |
| `enabled` | `boolean` | 是否出现在该 Connection 的 `enabled_tables` |

`GET /api/sources` 仍返回 Manifest 全量；过滤在消费者侧（或 Catalog 筛选）完成。

### 6.2 实现位置

- `listSources(projectRoot)`：读取 `readConnections`，按 §5.1 标记 `enabled`。
- 客户端 `webui/src/lib/types.ts` 与 server `model.ts` 同步。

## 7. `/catalog` UX

### 7.1 启用范围筛选

| Query | UI 标签 | 行为 |
|---|---|---|
| （缺省）或 `scope=enabled` | 已启用 | 只显示 `enabled === true` |
| `scope=all` | 全部 | Manifest 全量 |
| `scope=disabled` | 未启用 | 只显示 `enabled === false` |

- 工具栏顺序：`搜索 → 连接 → Schema → 启用范围 → 语义状态`。
- URL 双向同步（同 Spec 100 Catalog 约定）：`replace: true`。
- PageHeader description 补一句：默认展示已启用进入语义层的表；可切换查看 Manifest 全量。

### 7.2 行呈现

| 条件 | 语义状态列旁 / 表名区 | 操作列主链接 |
|---|---|---|
| `enabled` | 无额外徽章（或轻量「已启用」可选，默认不加） | `维护语义 ↗` → `/catalog/...` |
| `!enabled` | 徽章「未启用」 | `去启用表范围 ↗` → `/connections/enabled-tables?connection=&schema=`；不把「维护语义」当主 CTA |

允许在「更多」或次级链保留打开表编辑（可选）；本单可不做更多菜单，避免扩散。

### 7.3 空态

默认已启用且无启用表：标题「当前没有已启用的语义资产」；说明引导去启用表范围；提供链到 `/connections/enabled-tables`。

## 8. `/overview` UX

- 使用 §5.2 计算 coverage；demo 期望：**覆盖 1/1，待补 0**（在仅 `orders` 启用且 done 时）。
- 待办「前往补全」仍指向 `/catalog?completion=incomplete`（默认已启用 + 未完成）。
- 质量快照文案「D/T 语义完成」的 T 为已启用分母；ⓘ / 手册说明口径。

## 9. Help / 手册

更新 `docs/SYSTEM_HANDBOOK.md`：

- FAQ「N 张表待补语义怎么算？」→ `N` = 已启用 ∩ Manifest 中 `completion !== done` 的表数；未启用 Manifest 表不计入。
- 「系统概览待处理事项」表同步。

## 10. 验收标准

1. `SourceSummary` 含 `enabled` / `qualifiedName`；单测覆盖启用 / 未启用标记。
2. Overview：仅 1 张启用且 done → 无「待补语义」项；覆盖 1/1。
3. Catalog 默认不列出未启用表；`scope=all` 可见且未启用行主 CTA 为「去启用表范围」。
4. `/catalog?completion=incomplete` 不把未启用的 partial 表算进默认结果。
5. 手册 FAQ 与测试断言新口径。
6. 台账 `UX-OVERVIEW-019`、`UX-CATALOG-028` → `Fixed`；跨页面主题登记。
7. `npm test`（相关）、`lint:terminology`、`build` 通过；**不做浏览器验证**。

## 11. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 用户习惯「在 Catalog 看到全部 Manifest」 | `scope=all` + description 说明 |
| 深链收藏夹期望看到未启用缺口 | 文档说明；可手动加 `scope=all` |
| Spec 100 测试仍按全量 total | 同步改 onboarding / ops / help 测试 |

回滚：恢复 coverage 用全量 `sources.length`，Catalog 去掉默认 scope（不推荐）。
