# Publish History Business Columns & Export Clarity Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish History Business Columns & Export Clarity Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/85-publish-history-business-columns-and-export-clarity-spec.md`（v1.0）；浏览器核查属实的 4 点反馈 |
| 适用范围 | 指导 Spec 85 实施与验收（本轮不做浏览器验证） |
| 输出位置 | `webui/docs/plans/wo-202608-17-publish-history-business-columns-and-export-clarity.md` |

**Goal:** 落地 Spec 85：修复 export ESM、澄清 Header 导出语义、发布记录表增加序号/变更范围/规模并收敛 `pl-data-grid`。

**Architecture:** 后端 `semantic-asset-export.ts` 去掉 `require("yaml")`；前端 `PublishHistory.tsx` + `app.css`；台账新建 `publish-history.md`；索引与术语无新主术语。

**Tech Stack:** React、TypeScript、Fastify、Vitest、既有 `pl-data-grid` / `SemanticAssetExportButton`。

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 执行本工单。先读 Spec **85 v1.0**。

必须先阅读：`../docs/DEVELOPMENT.md`、`docs/00-product-terminology-standard.md`、`docs/design-system/11-components-data-grid.md`、`docs/85-…`、本 Plan、`PublishHistory.tsx`、`semantic-asset-export.ts`、`publish-history.test.tsx`、`api.semantic-asset-export.test.ts`。

## Non-Negotiable Boundaries

- 行内不得再放「下载当前快照」或等价伪历史下载。
- Header 文案必须是「导出当前语义资产包 (.zip)」。
- 不实现按 releaseId 历史包下载。
- 表格必须含 `pl-data-grid`；禁止继续用未定义的 `pl-table*`。
- 状态禁止继续用 `pl-validation-banner` 塞进单元格。
- 不做浏览器验证 / 移动窄屏；台账标 Fixed。

## Scope

### Phase 0: Spec / Plan / Ledger / Indexes

1. Spec 85 + 本 Plan 已落盘（本工单前提）。
2. 新建 `docs/ui-ux-feedback/pages/publish-history.md`：`UX-PUBLISH-HISTORY-001`～`005`，落地后标 `Fixed`。
3. `docs/ui-ux-feedback/README.md`：页面索引 + 最近维护记录。
4. `webui/docs/README.md`、`webui/docs/plans/README.md` 登记 Spec 85 / wo-202608-17。
5. Spec 35 §7 加交叉引用指向 Spec 85（短注即可）。

### Phase 1: Export ESM fix

- `makeScalar`：`import { …, Scalar } from "yaml"`，`return new Scalar(value)`。
- 跑 `server/__tests__/api.semantic-asset-export.test.ts`。

### Phase 2: PublishHistory UI

- 列：# / 发布时间 / 触发方式 / 操作人 / 变更范围 / 规模 / 结果 / 操作。
- Header 唯一导出；行内仅 Diff/错误。
- `pl-data-grid pl-data-table pl-publish-history-table`。
- CSS 最小语义块（num / scope / status / row-action 12px）。
- Connection ID、sourceName、actor、`Reindex` 表头片段：`translate="no"` + `notranslate`。
- 更新 `publish-history.test.tsx`。

### Phase 3: Gate

```bash
cd webui
npm test -- src/__tests__/publish-history.test.tsx \
  server/__tests__/api.semantic-asset-export.test.ts
npm run lint:terminology
npm run build
git diff --check
```

台账 `UX-PUBLISH-HISTORY-001`～`005` → Fixed。结束后只做 code review，不做浏览器验证。

## Out of Scope

按 releaseId 下载历史包；改 sidecar schema；connections 级 colgroup；浏览器 E2E。
