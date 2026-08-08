# Publish Workbench Activation IA Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish Workbench Activation IA Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-07 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/123-publish-workbench-activation-ia-spec.md` |
| 适用范围 | 落地 Spec 123 |
| 输出位置 | `webui/docs/plans/wo-202608-57-publish-workbench-activation-ia.md` |

**Goal:** `/publish/workbench` 成为语义生效台：去上传/去导出；术语与整批同步；全量重建真 force。

**Architecture:** 纯前端 IA + reindex `force` 分流；修订 Spec 35 交叉引用与台账。

**Tech Stack:** React、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

---

## Non-Negotiable Boundaries

- 不做浏览器验证；结束后 code review。
- 本页删除上传与导出 UI；不迁入口。
- 不做多选/伪队列时长。

## Scope

### Phase 0 — Docs / Ledger

- Spec 123、本工单；修订 Spec 35；术语 §4.3；README / plans README。
- 台账 `UX-PUBLISH-WORKBENCH-007`；跨页主题。

### Phase 1 — PublishWorkbench

- 去 `SemanticAssetExportButton`、`SemanticAssetPublishDrawer`、upload 状态。
- 文案：生效准备 / 本次将同步的变更 / 同步索引并生效 / 确认同步…。
- 空态：同步索引 + 更多（全量）；无上传推销。
- 更多：全量重建 `force:true`；日常/确认同步 `force:false`。
- 布局 CSS 2fr/3fr。

### Phase 2 — Tests / Gate

```bash
cd webui
npm test -- --run src/__tests__/review.test.tsx
npm run lint:terminology
npm run build
```
