# Help Center Search and Connection KPI Glossary Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Help Center Search and Connection KPI Glossary Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/111-help-center-search-and-connection-kpi-glossary-spec.md`（v1.0）；`docs/design-system-handbook-help.md` M15-P1-2 |
| 适用范围 | `/help` 手册搜索落地 + 连接概览 KPI 术语写入手册并可搜索命中 |
| 输出位置 | `webui/docs/plans/wo-202608-44-help-center-search-and-connection-kpi-glossary.md` |

**Goal:** 让用户在 `/help` 能搜到「已发现表数」等连接概览指标说明，并补齐手册与术语标准中的对应定义。

**Architecture:** 沿用 M15-P1-2：`help.ts` 在固定白名单手册上做本地关键词检索 → `GET /api/help/search` → `HelpCenter` 搜索框 + 结果跳 `?section=`；手册新增 `connection-overview-metrics` 章节作为可搜内容 SSOT。

**Tech Stack:** Fastify、Vitest、React Query、既有 `MarkdownPreview` / whitelist-search 样式。

## Non-Negotiable Boundaries

- 只读固定文件 `docs/SYSTEM_HANDBOOK.md`；不接受客户端 path；不搜 wiki / 任意 docs。
- 后端 snippet 纯文本，不高亮 HTML。
- 不改 `/connections` UI 与列计算逻辑。
- 不做 Help Drawer、不做 LLM 搜索、不做浏览器验证。
- 不顺手做 GFM 表格 / 代码复制（M15-P1-3）。

## Scope

### Phase 1: 手册内容 + 术语登记（搜索可命中的前提）

**验证：** `rg "已发现表数" docs/SYSTEM_HANDBOOK.md` 有命中。

1. `docs/SYSTEM_HANDBOOK.md`
   - FAQ 速查表增加「已发现表数」一行，深链到新小节。
   - 在 §3.2「刷新本地目录」附近新增 H4 **连接概览指标说明**。
   - 正文字面包含：`已发现表数`、`已启用表数`、`服务器目录已发现表`、`未启用表` + 对照表 +「非物理库实时表数」说明。
   - 同段过时路径 `/connections/whitelist` → `/connections/enabled-tables`（仅本段相关处，不做全手册大扫）。
2. `webui/docs/00-product-terminology-standard.md`
   - 登记 Discovered Tables / Enabled Tables Count / Unenabled Tables（见 Spec §4）。
3. `webui/server/help.ts`
   - `SECTION_ALIASES` 增加 `连接概览指标说明` → `connection-overview-metrics`。
   - 将该 H4 加入 DATABASE_OPS TOC allowlist（与「刷新本地目录」同级可见）。

### Phase 2: Search API

**验证：** `npm test -- server/__tests__/help.test.ts` 中 search 用例全绿。

1. `webui/server/help.ts`
   - 导出 `searchHelpHandbook(q, { limit })`：按 TOC 切段 → 标题/正文匹配 → 排序 → snippet 截取。
   - query trim；空串 → 空 items；长度 > 80 → `ERR_HELP_QUERY_TOO_LONG`。
2. `webui/server/index.ts`
   - 注册 `GET /api/help/search`。
3. `webui/src/lib/types.ts`
   - 增加 `HelpSearchResponse` / `HelpSearchItem`。
4. `webui/src/lib/queryKeys.ts`
   - 增加 `helpSearch(q)`。
5. `webui/server/__tests__/help.test.ts`
   - 覆盖：`已发现表数` → `connection-overview-metrics`；`token` 回归；空 query；过长 query。

### Phase 3: HelpCenter 搜索 UI

**验证：** `npm test -- src/__tests__/help-center.test.tsx` 全绿。

1. `webui/src/pages/HelpCenter.tsx`
   - TOC 上方搜索框；`q` 可写入 URL search params。
   - 有 query 时请求 `/api/help/search`，展示结果列表；点击 → `section` 深链。
   - 空态文案明确；高亮在前端做。
2. `webui/src/app/app.css`
   - 增加 `pl-help-search*`（或复用 whitelist-search class），不破坏现有 TOC sticky 布局。
3. `webui/src/__tests__/help-center.test.tsx`
   - mock search API；断言输入「已发现表数」出现结果并跳转正确 section。

### Phase 4: 文档登记与 Gate

1. `webui/docs/README.md`、`webui/docs/plans/README.md` 登记 Spec 111 / WO-36。
2. 若存在 `docs/ui-ux-feedback/pages/help.md`，追加搜索能力相关条目或维护记录（有则更新，无则跳过）。

```bash
cd webui
npm test -- server/__tests__/help.test.ts src/__tests__/help-center.test.tsx
npm run lint:terminology
npm run build
```

## File Checklist

| 文件 | 动作 |
|---|---|
| `docs/SYSTEM_HANDBOOK.md` | 改：FAQ + 指标说明章节 + 路径校正 |
| `webui/docs/00-product-terminology-standard.md` | 改：登记 KPI 术语 |
| `webui/server/help.ts` | 改：alias + search |
| `webui/server/index.ts` | 改：注册 search 路由 |
| `webui/server/__tests__/help.test.ts` | 改：search 用例 |
| `webui/src/pages/HelpCenter.tsx` | 改：搜索 UI |
| `webui/src/app/app.css` | 改：搜索样式 |
| `webui/src/lib/types.ts` | 改：search 类型 |
| `webui/src/lib/queryKeys.ts` | 改：`helpSearch` |
| `webui/src/__tests__/help-center.test.tsx` | 改：搜索交互 |
| `webui/docs/111-...-spec.md` | 已有（本轮 Spec） |
| `webui/docs/plans/wo-202608-44-...md` | 已有（本 Plan） |
| `webui/docs/README.md` / `plans/README.md` | 改：索引 |

## Out of Scope Reminder

- Help Drawer、GFM 表格增强、代码复制、连接页 UI、Command Palette 手册联合搜索。
