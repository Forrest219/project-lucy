# Publish Workbench Validation Disclosure and Junk Scrub Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish Workbench Validation Disclosure and Junk Scrub Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 基于材料 | `webui/docs/115-publish-workbench-validation-disclosure-and-junk-scrub-spec.md` |
| 适用范围 | 落地 Spec 115 |
| 输出位置 | `webui/docs/plans/wo-202608-48-publish-workbench-validation-disclosure-and-junk-scrub.md` |

**Goal:** 发布工作台能看到校验失败原因；`._*` 不再阻断 `ktx sl validate`。

**Architecture:** 复用 Spec 110 validation-utils；`scrubSemanticLayerJunk` 挂在 `validateSource`；上传拒收 junk 名。

**Tech Stack:** React PublishWorkbench、ktx.ts、semantic-assets filename gate、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

---

## Non-Negotiable Boundaries

- 不改 ktx 二进制。
- scrub 仅删 `._*` / `.DS_Store`，经 `safeRemove`。
- 不做浏览器验证。

## Scope

### Phase 0 — Docs / Ledger

- Spec 115、本工单；修订 Spec 110 Non-Goal 交叉引用。
- 台账 `UX-PUBLISH-WORKBENCH-004`；README 跨页主题延伸。

### Phase 1 — Scrub + upload reject

- `server/semantic-layer-junk.ts`（或 `ktx.ts` 同文件旁模块）+ 单测。
- `validateSource` 前 await scrub。
- `isValidFilename` 拒收。

### Phase 2 — Workbench UI

- 校验摘要 issues + 技术详情；Toast；`review.test.tsx`。

### Phase 3 — Gate

```bash
cd webui
npm test -- --run src/__tests__/review.test.tsx src/__tests__/validation-utils.test.ts server/__tests__/semantic-layer-junk.test.ts
npm run lint:terminology
npm run build
```
