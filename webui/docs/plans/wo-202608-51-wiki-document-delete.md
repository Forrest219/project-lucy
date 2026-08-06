# Wiki Document Delete Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki Document Delete Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/118-wiki-document-delete-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 118：单文档删除 API、Header 按钮、确认对话框、台账 |
| 输出位置 | `webui/docs/plans/wo-202608-51-wiki-document-delete.md` |

**Goal:** 为 `/wiki` 已保存 Markdown 提供「删除文档」能力，兑现 `UX-WIKI-045`。

**Architecture:** `DELETE /api/wiki/:key` + 确认 Dialog；`auditedRemoveFile` 删文件并清理该 key 版本历史；UI 对齐空目录删除确认模式；Header 保持「编辑」唯一 primary。

**Tech Stack:** Fastify wiki routes、`fs-safe`、`auditedRemoveFile`、React Dialog、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Draft |
| v1.1 | Implemented |

---

## Non-Negotiable Boundaries

- 只做单文档硬删除；不做软删除/回收站/批量/目录递归删文档。
- 不改 UX-WIKI-020；不改 Explorer IA。
- 全部写入/删除经 `fs-safe`；配置审计必写。
- 不做浏览器验证（用户约束：结束后只做 code review）。

## Scope

### Phase 0 — Docs / Terminology

- Spec 118、本工单。
- `00-product-terminology-standard.md` 登记「删除文档」等。
- `webui/docs/README.md`、`plans/README.md` 登记。
- Spec 58 / 81 交叉引用。
- 台账追加 `UX-WIKI-045`（实现后 Fixed）。

### Phase 1 — Server

- `deleteWiki` in `server/wiki.ts`：存在性检查 → `auditedRemoveFile` → 清理 history index/snapshots。
- Route：`DELETE /api/wiki/:key`。
- 更新 `03-api-spec.md`。
- Server tests：成功、404、历史清理。

### Phase 2 — Frontend

- types：`WikiDocumentDeleteResult`。
- `WikiDeleteDocumentDialog`。
- `WikiEditor`：Header 按钮 + mutation + 成功导航。
- 更新 UX-WIKI-037 顺序断言。

### Phase 3 — Ledger

- `UX-WIKI-045` → `Fixed`。
- README 维护记录 + `button hierarchy consistency` 挂接。

### Phase 4 — Gate

```bash
cd webui
npm test -- --run src/__tests__/wiki.test.tsx server/__tests__/wiki.test.ts
npm run lint:terminology
npm run build
```

## 验证要点

- Header 可见「删除文档」；确认后 `DELETE /api/wiki/<key>`。
- 成功后离开文档页；列表不再含该 key。
- 「编辑」仍为唯一 primary。

## Design System Compliance（交付）

- Referenced：`WikiDeleteDirectoryDialog` 确认模式；Spec 81 Header 层级
- Follows：破坏性动作 ghost 触发 + dialog `danger` 确认
- Exceptions：None
