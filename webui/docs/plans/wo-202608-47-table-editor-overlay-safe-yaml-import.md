# Table Editor Overlay-Safe YAML Import Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Table Editor Overlay-Safe YAML Import Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 基于材料 | `webui/docs/114-table-editor-overlay-safe-yaml-import-spec.md` |
| 适用范围 | 落地 Spec 114 |
| 输出位置 | `webui/docs/plans/wo-202608-47-table-editor-overlay-safe-yaml-import.md` |

**Goal:** 表编辑器导入 overlay 不再冲掉 Schema Manifest 字段。

**Architecture:** 改 `previewSourceYamlImport` 为 schema merge-safe；抽屉补指引。

**Tech Stack:** TypeScript server semantic-layer、React TableEditor、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

---

## Non-Negotiable Boundaries

- YAML 就地补丁 / Document API；禁止 dump 整文件毁掉注释顺序以外的必要 merge 可用 `createNode`。
- 不做浏览器验证。
- 不改发布工作台上传主路径。

## Scope

### Phase 0 — Docs / Terminology / Ledger

- Spec 114、本工单；术语表登记 Table YAML Import 等。
- 台账追加 `UX-CATALOG-030`（落地后 Fixed）。
- 索引：`webui/docs/README.md`、`plans/README.md`。

### Phase 1 — Server

- `semantic-layer.ts`：`previewSourceYamlImport` merge-safe。
- `api.source-import.test.ts`：overlay-only 保留 columns。

### Phase 2 — Frontend

- `ImportYamlDrawer` 说明 + placeholder。
- `table-editor.test.tsx` 断言引导文案。

### Phase 3 — Gate

```bash
cd webui
npm test -- --run src/__tests__/table-editor.test.tsx server/__tests__/api.source-import.test.ts
npm run lint:terminology
npm run build
```
