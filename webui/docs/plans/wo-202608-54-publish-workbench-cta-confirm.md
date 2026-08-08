# Publish Workbench CTA Confirm Path Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish Workbench CTA Confirm Path Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-07 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/121-publish-workbench-cta-confirm-spec.md` |
| 适用范围 | 落地 Spec 121 |
| 输出位置 | `webui/docs/plans/wo-202608-54-publish-workbench-cta-confirm.md` |

**Goal:** Header「发布并重建索引」打开确认侧栏并 reindex；不再打开上传「发布语义资产」Drawer。

**Architecture:** 拆分 `uploadOpen` / `confirmPublishOpen`；确认 Drawer 调既有 reindex mutation。

**Tech Stack:** React、`pl-drawer-*`、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

---

## Non-Negotiable Boundaries

- 不做浏览器验证；结束后 code review。
- 不新开 promote-pending API。
- 不把上传 Drawer 改成双模式。

## Scope

### Phase 0 — Docs / Ledger

- Spec 121、本工单；修订 Spec 35 §6.2 / Spec 112 交叉引用。
- 术语 §4.3 增补 Confirm Publish Drawer。
- 台账 `UX-PUBLISH-WORKBENCH-006`；README 维护记录与跨页主题。

### Phase 1 — UI

- `PublishWorkbench`：拆分状态；Header CTA → 确认 Drawer；上传仍走 `SemanticAssetPublishDrawer`。
- 确认 Drawer：摘要 + 主 CTA → reindex；成功关闭。

### Phase 2 — Tests / Gate

```bash
cd webui
npm test -- --run src/__tests__/review.test.tsx
npm run lint:terminology
npm run build
```
