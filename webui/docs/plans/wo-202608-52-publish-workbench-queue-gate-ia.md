# Publish Workbench Queue–Gate IA Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish Workbench Queue–Gate IA Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-07 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/119-publish-workbench-queue-gate-ia-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 119 |
| 输出位置 | `webui/docs/plans/wo-202608-52-publish-workbench-queue-gate-ia.md` |

**Goal:** `/publish/workbench` 首屏改为「待发布变更 | 发布门禁」；变更详情（Diff）下沉为按需 Drawer。

**Architecture:** 纯前端 IA 重组 `PublishWorkbench.tsx` + `app.css` 双栏；复用 `pl-drawer-*` 与既有 Diff / validate / publish。

**Tech Stack:** React、既有 drawer CSS、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

---

## Non-Negotiable Boundaries

- 不做浏览器验证；结束后只做 code review。
- 不改 Validate Gate / reindex / publish API。
- 不做批量勾选分文件发布。
- 不自动打开变更详情 Drawer。
- Header 禁止「表目录」。

## Scope

### Phase 0 — Docs / Ledger

- Spec 119、本工单。
- `webui/docs/README.md`、`plans/README.md`。
- 术语标准 §4.3：发布门禁=主工作面；变更详情=按需 Drawer。
- Spec 112 / 35 顶部交叉引用：§5.3 / 三栏由 Spec 119 修订。
- 台账 `UX-PUBLISH-WORKBENCH-005`；跨页主题 `publish workbench queue-gate ia`；更新 `three-panel ia` 为 superseded。

### Phase 1 — Layout

- `pl-review-layout` 改为双栏（左队列 / 主门禁）。
- `PublishWorkbench`：门禁迁入主栏；移除常驻中栏 Diff。
- 文件点击打开变更详情 Drawer（路径 + 状态 + DiffViewer）。
- 进页不自动打开 Drawer。

### Phase 2 — Tests

- 更新 `review.test.tsx`：双栏断言；Diff 仅在打开 Drawer 后可见；进页无 Drawer。

### Phase 3 — Gate

```bash
cd webui
npm test -- --run src/__tests__/review.test.tsx
npm run lint:terminology
npm run build
```

## Design System Compliance（交付）

- Referenced：PageHeader、pl-drawer、button hierarchy、review layout（双栏）
- Follows：队列→门禁主路径；Diff 按需
- Exceptions：工作流 badges
- Deviations：无
