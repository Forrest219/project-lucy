# Publish Workbench Flow and Gate IA Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish Workbench Flow and Gate IA Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/112-publish-workbench-flow-and-gate-ia-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 112 |
| 输出位置 | `webui/docs/plans/wo-202608-45-publish-workbench-flow-and-gate-ia.md` |

**Goal:** `/publish/workbench` 首屏可读「审阅 → 校验 → 发布」；三栏角色清晰；Header 收口；Schema/表影响分流。

**Architecture:** 纯前端 IA 重组 `PublishWorkbench.tsx`；复用既有 diff / validate / reindex / sources API；自动校验一次。

**Tech Stack:** React Query、既有 `apiGet`/`apiPost`、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

---

## Non-Negotiable Boundaries

- 不做浏览器验证。
- 不改 Validate Gate / reindex API。
- 不新增二级导航。
- Header 禁止「表目录」。
- Schema Manifest 不得计入「影响表」。

## Scope

### Phase 0 — Docs

- Spec 112、本工单。
- `webui/docs/README.md`、`plans/README.md`。
- 术语标准 §4.3 增补：发布门禁、变更详情、文件变更状态、Schema Manifest 变更 / 表语义变更、发布步骤。
- Spec 35 顶部交叉引用：§6.1–6.3 由 Spec 112 修订。

### Phase 1 — PublishWorkbench IA

- Header：按 empty / pending 切换动作；删「表目录」；description 改用户价值句。
- 三栏标题：待发布变更 / 变更详情 / 发布门禁。
- 中栏：路径副标题 + `fileChangeStatusLabel`。
- 右栏：步骤指示 + 状态 + 影响分流 + 校验摘要 + 下一步说明；删建议命令；高级折叠（强制重建 / 上传 / 边界检查 / KTX 结果）。
- `classifyChangedSemanticFile` / 影响列表：Manifest vs overlay。
- 有待发布且无校验结果时自动 `validate-changed` 一次。

### Phase 2 — Tests & Ledger

- 更新 `webui/src/__tests__/review.test.tsx`：Header 收口、门禁标题、Schema 不影响表列表、自动校验、状态文案。
- 台账 `UX-PUBLISH-WORKBENCH-001`～`003` → Fixed；README 维护记录 + 主题 Spec 引用。

### Phase 3 — Gate

```bash
cd webui
npm test -- --run src/__tests__/review.test.tsx
npm run lint:terminology
npm run build
```

## Design System Compliance（交付）

- Referenced：PageHeader、button hierarchy、review layout
- Follows：≤1 primary、sibling nav 不进 Header、动作密度收口
- Exceptions：工作流 badges 保留
- Deviations：无
