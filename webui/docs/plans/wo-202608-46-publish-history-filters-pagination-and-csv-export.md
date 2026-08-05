# Publish History Filters, Pagination & CSV Export Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish History Filters, Pagination & CSV Export Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/113-publish-history-filters-pagination-and-csv-export-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 113 |
| 输出位置 | `webui/docs/plans/wo-202608-46-publish-history-filters-pagination-and-csv-export.md` |

**Goal:** 发布记录对齐配置审计：序号、筛选、分页、明细 CSV 导出；移除语义资产包 ZIP。

**Architecture:** sidecar 全量读入后内存筛选/分页；CSV 与 UI 共用 `publishHistoryLabels`；Header 一键 `<a href>`。

**Tech Stack:** Fastify、React Router searchParams、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

---

## Non-Negotiable Boundaries

- 不做浏览器验证。
- 历史页禁止语义资产包 ZIP / `SemanticAssetExportButton`。
- 不做按 releaseId 历史 ZIP。
- CSV 禁止 Diff/错误全文 dump。

## Scope

### Phase 0 — Docs

- Spec 113、本工单。
- `webui/docs/README.md`、`plans/README.md`。
- 交叉修订 Spec 35 §7.3、Spec 85 顶部说明、Spec 91 §5.1。
- 台账 `UX-PUBLISH-HISTORY-008`～`010` + README 维护记录/主题。

### Phase 1 — Labels + API

- 新增 `src/lib/publishHistoryLabels.ts`（触发/状态/范围/规模/CSV 头/文件名戳）。
- `readSemanticAssetReleases(root, query?)` → `{ records, total }`。
- `buildSemanticAssetReleasesCsv(...)`。
- `GET /api/semantic-assets/releases` 接 query；新增 `GET .../releases/export.csv`。
- 类型：`SemanticAssetReleasesResponse.total`。

### Phase 2 — UI

- `PublishHistory.tsx`：searchParams 筛选、page、序号、分页、导出 CSV；去 ZIP；改 description。

### Phase 3 — Tests + Gate

```bash
cd webui
npm test -- --run src/__tests__/publish-history.test.tsx
npm test -- --run server/__tests__/api.semantic-assets.reindex.test.ts
npm run lint:terminology
npm run build
```

## Design System Compliance（交付）

- Referenced：`pl-admin-filterbar`、`pl-data-grid`、PageHeader secondary 导出
- Follows：Spec 96/97 筛选与 CSV 样板
- Exceptions：无
