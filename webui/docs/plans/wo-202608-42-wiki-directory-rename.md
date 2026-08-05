# Wiki Directory Rename Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki Directory Rename Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/109-wiki-directory-rename-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 109：目录重命名预检/提交 API、菜单、对话框、URL 跟随 |
| 输出位置 | `webui/docs/plans/wo-202608-42-wiki-directory-rename.md` |

**Goal:** 为 `/wiki` 目录提供「重命名目录」能力，兑现 `UX-WIKI-044`。

**Architecture:** preview/commit 双端点；同父级最后一段改名；前缀批量改写 Markdown key + `.lucy-directories.json`；UI 对齐既有删除/移动预检。

**Tech Stack:** Fastify wiki routes、`fs-safe`、既有 `moveWiki` 历史携带、React Dialog、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Draft |
| v1.1 | Implemented |

---

## Non-Negotiable Boundaries

- 只做同父级最后一段改名；不做跨父级移动目录。
- 不改 UX-WIKI-020；不改 Spec 105 右栏递归列表口径。
- 全部写入经 `fs-safe`；不暴露 history 进 pages / `wiki_search`。
- 不做浏览器验证（除非后续明确要求）。

## Scope

### Phase 0 — Docs / Terminology

- Spec 109（已有）、本工单。
- `webui/docs/00-product-terminology-standard.md` 登记「重命名目录」等术语。
- `webui/docs/README.md`、`plans/README.md` 登记（若尚未）。
- Spec 58 / 105 Non-Goal 交叉引用 Spec 109。

### Phase 1 — Server

- `previewWikiDirectoryRename` / `renameWikiDirectory` in `server/wiki.ts`。
- Routes：`POST /api/wiki/directories/rename/preview`、`POST /api/wiki/directories/rename`。
- 更新 `03-api-spec.md`。
- Server tests：非法名、冲突、空目录、含文档前缀改写、history 携带。

### Phase 2 — Frontend

- types + API client。
- `WikiRenameDirectoryDialog`。
- `WikiTree` 菜单项 + `WikiEditor` wiring / URL 跟随。
- Toast / dirty confirm 对齐既有目录操作。

### Phase 3 — Ledger

- `UX-WIKI-044` → `Fixed`；Notes → Spec 109 / 本工单。
- `docs/ui-ux-feedback/README.md` 维护记录。

### Phase 4 — Gate

```bash
cd webui
npm test -- --run src/__tests__/wiki.test.tsx
npm run lint:terminology
npm run build
```

## 验证要点

- 菜单可见「重命名目录」；根桶不可用。
- `m56-msbye4tr-top` → 新名后，文档 key 与 `?dir=` 同步更新。
- 目标已存在 → 409 / 预检 conflicts。
- UX-WIKI-020 默认树无文档行。

## Design System Compliance（交付）

- Referenced：既有 Wiki preflight Dialog 模式（Delete / Move）
- Follows：Attu 资源旁 `...` 操作；不新增第四栏
- Exceptions：None
