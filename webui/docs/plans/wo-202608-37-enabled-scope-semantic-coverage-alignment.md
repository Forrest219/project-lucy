# Enabled-Scope Semantic Coverage Alignment Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Enabled-Scope Semantic Coverage Alignment Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/104-enabled-scope-semantic-coverage-alignment-spec.md`（v1.0） |
| 适用范围 | Spec 104：sources `enabled` 标记、Overview 覆盖口径、Catalog 默认已启用、手册与台账 |
| 输出位置 | `webui/docs/plans/wo-202608-37-enabled-scope-semantic-coverage-alignment.md` |

**Goal:** 语义覆盖 / 待补语义 / Catalog 默认列表与 `enabled_tables` 对齐；消除「只启用 1 张却待维护 3 张」的跨页矛盾。

**Architecture:** `listSources` 联读 `readConnections` 打 `enabled`；Overview 只聚合 `enabled`；Catalog `scope` 默认 `enabled`。

**Tech Stack:** Fastify sources API、React Router search params、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿 |

---

## Non-Negotiable Boundaries

- 不从 API 删除未启用表；只标记 + 消费方过滤。
- 不删 overlay 文件。
- 匹配键与连接页一致：`qualifiedName ?? schema.table`。
- Overview / Catalog / 手册口径同 PR 交付，禁止半截。
- 不做浏览器验证；结束后只做 code review。

## Scope

### Phase 1 — API + 类型

- `server/model.ts` / `src/lib/types.ts`：`SourceSummary` 增加 `qualifiedName: string`、`enabled: boolean`。
- `listSources`：`readConnections` → 按 conn 建 `Set(enabledTables)` → 标记。
- `semantic-layer.read.test.ts`：无 `ktx.yaml` 时 `enabled === false`；有启用项时为 `true`。

### Phase 2 — Overview

- `Onboarding.tsx`：`enabledSources = sources.filter(s => s.enabled)`；`done/total/gap/pendingCatalogItems/semanticPercent/serviceHealth` 均基于该集。
- `ops-dashboard.test.ts` / `onboarding.test.tsx`：fixture 补 `enabled`；断言已启用分母。

### Phase 3 — Catalog

- URL `scope=enabled|all|disabled`，缺省 = enabled。
- 工具栏增加「启用范围」；description 补一句。
- 未启用行：徽章「未启用」；主 CTA「去启用表范围 ↗」。
- 空态：无已启用时引导启用表范围。
- `catalog.test.tsx` 覆盖默认过滤与 `scope=all`。

### Phase 4 — 手册 / 术语 / 台账 / 索引

- `docs/SYSTEM_HANDBOOK.md` FAQ + 待处理事项表。
- `00-product-terminology-standard.md`：登记 Semantic Coverage 分母。
- `docs/ui-ux-feedback/pages/overview.md` → `UX-OVERVIEW-019` Fixed。
- `docs/ui-ux-feedback/pages/catalog.md` → `UX-CATALOG-028` Fixed。
- `docs/ui-ux-feedback/README.md`：最近维护记录 + 跨页面主题。
- `webui/docs/README.md`、`plans/README.md` 索引。
- Spec 100 顶部加交叉引用：计数口径由 Spec 104 修订。

### Phase 5 — Gate

```bash
cd webui
npm test -- --run \
  src/__tests__/ops-dashboard.test.ts \
  src/__tests__/onboarding.test.tsx \
  src/__tests__/catalog.test.tsx \
  src/__tests__/help-center.test.tsx \
  server/__tests__/semantic-layer.read.test.ts \
  server/__tests__/help.test.ts
npm run lint:terminology
npm run build
```

可选 code review：`review-agent` / Bugbot 对 branch diff。

## 验证要点

- demo 心智：启用 1 张且 done → overview 无待补语义；Catalog 默认 1 行。
- `rg "表总数 −|本地语义表总数" docs/SYSTEM_HANDBOOK.md` 无旧口径。
- Spec 100 深链 URL 未改；消费默认已启用。
