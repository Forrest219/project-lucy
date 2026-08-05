# Wiki Directory Selection Explorer IA Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki Directory Selection Explorer IA Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/105-wiki-directory-selection-explorer-ia-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 105：`?dir=`、右栏过滤、面板视觉、台账 |
| 输出位置 | `webui/docs/plans/wo-202608-38-wiki-directory-selection-explorer-ia.md` |

**Goal:** 将 `/wiki` 中栏对齐 Attu Explorer：目录可选、右栏跟随、面板分割清晰。

**Architecture:** URL `dir` 为选中态事实源；树负责选择；LibraryHome 负责过滤/空态；CSS 实体化中栏。

**Tech Stack:** React Router searchParams、既有 WikiTree / WikiLibraryHome、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

---

## Non-Negotiable Boundaries

- 不实现目录重命名 API / 菜单项。
- 不改为四栏；不移除全局侧栏。
- 不破坏 UX-WIKI-020（树默认不混排文档）。
- 不做浏览器验证。

## Scope

### Phase 0 — Docs

- Spec 105、本工单。
- `webui/docs/README.md`、`plans/README.md` 登记。

### Phase 1 — Helpers + Tree + Library

- `lib/wiki.ts`：`pagesUnderDirectory(pages, dir)`。
- `WikiTree`：`selectedDirectory` / `onSelectDirectory`；active class；click 语义。
- `WikiLibraryHome`：按 `selectedDirectory` 过滤；双空态。

### Phase 2 — WikiEditor wiring + CSS

- 读 `dir` query；`navigateToDirectory`；`navigateTo` 清 dir。
- `selectedDirectory` 派生：`dir` 或文档父路径。
- `app.css`：sidebar 面板、main 分割、toggle `text-sm`、active 行。

### Phase 3 — Ledger

- 追加 `UX-WIKI-041`～`044`；041–043 Fixed，044 Open。
- `docs/ui-ux-feedback/README.md`：维护记录、主题 `explorer panel selection ia`、治理规则一条。

### Phase 4 — Tests + Gate

```bash
cd webui
npm test -- --run src/__tests__/wiki.test.tsx
npm run lint:terminology
npm run build
```

## 验证要点

- 无参数 → `wiki-library-select-prompt`。
- 选目录 → `dir=` + 过滤列表。
- 空目录 → `wiki-library-directory-empty`。
- 选文档 → `key=`；树父目录 active。
- UX-WIKI-020 回归绿。

## Design System Compliance（交付）

- Referenced：既有 wiki layout tokens（`bg-bg-subtle` / `border-border-default` / `bg-bg-selected`）
- Follows：Attu 面板语言（色阶 + divider）；不引入第四栏
- Exceptions：None
