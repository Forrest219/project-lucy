# Wiki Read Layout and Header Action Hierarchy Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki Read Layout and Header Action Hierarchy Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/81-wiki-read-layout-and-header-action-hierarchy-spec.md` |
| 适用范围 | 指导阅读态防拉伸、Header 动作主次、台账机制更新的实施与非浏览器验收 |
| 输出位置 | `webui/docs/plans/wo-202608-13-wiki-read-layout-and-header-action-hierarchy.md` |

**Goal:** 落地 Spec 81：阅读区 `content-start`；`编辑` 为唯一末位 primary；台账 `UX-WIKI-036`/`037` + 跨页面主题/治理规则。

**Architecture:** 纯前端 CSS + Header JSX；不改后端。

**Tech Stack:** React、CSS (`app.css`)、Vitest。

---

## Non-Negotiable Boundaries

- 不改编辑态、版本弹窗、上传预检逻辑、后端 API。
- 不删除任一 Header 动作；只改 class 与顺序。
- 本轮不做浏览器验证；验收以 Vitest + lint + build 为准。

## Phase 1: CSS

修改 `src/app/app.css`：

```css
.pl-wiki-read-view { @apply grid content-start gap-3 ...; }
.pl-wiki-read-layout { @apply grid content-start gap-6; ... }
```

## Phase 2: Header actions

修改 `src/pages/WikiEditor.tsx` loaded-read actions：

1. `wiki-upload-replace-button`：`pl-btn--primary` → `pl-btn--ghost`
2. `wiki-edit-button`：`pl-btn--ghost` → `pl-btn--primary`
3. DOM 顺序保持：下载 → 移动 → 版本 → 上传覆盖 → 编辑

## Phase 3: Tests

更新 `src/__tests__/wiki.test.tsx`：

- 断言 edit primary、upload-replace 非 primary、五钮顺序
- 断言 `app.css` 中 `.pl-wiki-read-view` 含 `content-start`

## Phase 4: Verification

```bash
cd webui
npm run lint:terminology
npm test -- src/__tests__/wiki.test.tsx
npm run build
git diff --check
```

## Phase 5: Ledger

1. `pages/wiki.md`：追加 `UX-WIKI-036`、`037`，状态 `Fixed`
2. `README.md`：维护记录 + 主题 `css grid track stretch` + 更新 `button hierarchy consistency` + 治理规则（grid content-start）

## Acceptance / Code Review

见 Spec 81 §9 与 checklist：无无关重构；primary 唯一且为编辑；拉伸 CSS 已加；台账与主题齐全。
