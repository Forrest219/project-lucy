# Connection Live Catalog Discovery Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Live Catalog Discovery Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/107-connection-live-catalog-discovery-spec.md`（v1.0） |
| 适用范围 | Spec 107：live-schemas API、连接概览库内表数、Add Schema 可选、术语与台账 |
| 输出位置 | `webui/docs/plans/wo-202608-40-connection-live-catalog-discovery.md` |

**Goal:** Owner 按需只读连库；`/connections` 展示库内表数；Add Schema 靠选（手输兜底）；分连接懒加载 + 10min TTL。

**Architecture:** `ktx sql --json` 聚合查询 → 进程内 TTL 缓存 → `GET .../live-schemas` → Overview `useQueries` + AddSchemaDrawer 复用 queryKey。

**Tech Stack:** Fastify、ktx CLI、React Query、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿 |

---

## Non-Negotiable Boundaries

- 只读 SQL；不写库；不读 secrets 明文。
- 三列计数语义不得合并或改名混淆。
- 分连接失败隔离；禁止一失败整页 wipe。
- 「重新拉取库内目录」≠「刷新本地目录」。
- 不做浏览器验证；结束后只做 code review。

## Scope

### Phase 1 — Server

- `server/ktx.ts`：新增 `runSql(projectRoot, connId, sql, { maxRows?, execFileImpl? })`，解析 `--json` stdout。
- `server/live-catalog.ts`：按 wireProtocol 选 SQL、过滤系统库、TTL 缓存（默认 10min）、`listLiveSchemas(root, connId, { refresh? })`。
- `server/model.ts` + `src/lib/types.ts`：`LiveSchemaSummary` / `LiveSchemasResponse`。
- `server/index.ts`：`GET /api/connections/:connId/live-schemas`。
- 测试：mock `runSql`；缓存命中；refresh bypass；error envelope；404。

### Phase 2 — Overview UI

- `queryKeys.connectionLiveSchemas(connId)`。
- `ConnectionOverview.tsx`：`useQueries` 每连接懒加载；表增「库内表数」；loading/error/—；卡片级「重新拉取库内目录」。
- `app.css`：colgroup 宽度微调。
- `connection-overview.test.tsx`。

### Phase 3 — AddSchemaDrawer

- 复用 live query；select 候选（排除已配置）+ 手动输入切换。
- `add-schema-drawer.test.tsx`。

### Phase 4 — Docs / 术语 / 台账

- `00-product-terminology-standard.md`：登记 Live Table Count 等。
- Spec 21 顶部交叉引用 Spec 107 例外。
- `03-api-spec.md` 补 endpoint 摘要。
- `docs/ui-ux-feedback/pages/connections.md`：`UX-CONNECTIONS-026`～`027` → Fixed。
- `docs/ui-ux-feedback/README.md`：最近维护 + 跨页面主题 `live catalog vs local inventory`。
- `webui/docs/README.md`、`plans/README.md` 索引。

### Phase 5 — Gate

```bash
cd webui
npm test -- --run \
  server/__tests__/live-catalog.test.ts \
  src/__tests__/connection-overview.test.tsx \
  src/__tests__/add-schema-drawer.test.tsx
npm run lint:terminology
npm run build
```

可选：`review-agent` / Bugbot 对 branch diff。

## 验证要点

- mock live：`dataforai` 显示库内 N；与已发现/已启用可不同。
- 一连接 error：该列「不可用」，其它连接与 Manifest 列正常。
- Add Schema：候选可点选；手动输入路径仍通。
- `rg "刷新本地目录" AddSchemaDrawer` 不与「重新拉取库内目录」混用。
