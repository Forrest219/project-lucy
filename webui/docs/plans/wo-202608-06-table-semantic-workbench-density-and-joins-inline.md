# Table Semantic Workbench Density and Joins Inline Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Table Semantic Workbench Density and Joins Inline Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/73-table-semantic-workbench-density-and-joins-inline-spec.md`；`docs/ui-ux-feedback/pages/catalog.md` UX-CATALOG-021–026；用户确认 1–5 按建议、6 修正 UX-CATALOG-011 |
| 适用范围 | 指导单表语义工作台密度、文案与关联内联的实现与非浏览器验收 |
| 输出位置 | `webui/docs/plans/wo-202608-06-table-semantic-workbench-density-and-joins-inline.md` |

**Goal:** 落地 Spec 73：统一 Header 按钮语义、基础语义三段式与字段多选 grain、字段表密度、指标/分群/关联价值文案、关联内联维护。

**Architecture:** 仅 WebUI 前端 + 测试 + ledger；复用现有 `/api/joins/candidates` 与 source PUT patch；`/joins` 路由改为兼容重定向。

**Tech Stack:** React、TypeScript、CSS (`src/app/app.css`)、Vitest/Testing Library。

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 Spec 73 / 本工单。结束后只做 code review，不做浏览器验证。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/design-system/10-components-button.md`
- `docs/design-system/11-components-data-grid.md`
- `docs/73-table-semantic-workbench-density-and-joins-inline-spec.md`
- `src/pages/TableEditor.tsx`
- `src/pages/JoinEditor.tsx`
- `src/pages/semantic/join-utils.ts`
- `src/app/app.css`
- `src/__tests__/table-editor.test.tsx`
- `../docs/ui-ux-feedback/pages/catalog.md`（UX-CATALOG-011、021–026）

## Non-Negotiable Boundaries

- 不新增后端 API，不改 YAML / candidates 数据契约。
- 不恢复表页首屏「待处理建议」banner。
- Human 描述初始仍只载入 `descriptions.human`，不预填 AI。
- 不做浏览器验证；ledger 实现后标 `Fixed`。
- 术语、对象名继续 `notranslate` / `translate="no"`。

## Scope

### Phase 1: Tests First

更新 `src/__tests__/table-editor.test.tsx`：

1. `校验` 按钮 class 含 `pl-btn--secondary`，不含 `pl-btn--ghost`；具备用途 `title`。
2. 基础语义展示 AI 表描述与「采纳 AI 描述」。
3. 行粒度不是自由文本 `input`；可从字段列表选择。
4. 字段列表根节点为 table / `pl-data-grid`；工具条含批量采纳用途说明。
5. 指标 / 分群文案含业务价值句。
6. 关联 tab：无「打开关联关系」；可拉取 candidates；可确认候选写入。
7. 翻转旧断言：`removes prominent candidate suggestions` 仍禁止首屏 banner；`keeps formal join maintenance` 改为内联断言。

### Phase 2: Header + Overview

修改 `TableEditor.tsx`：

1. `校验`：`pl-btn--ghost` → `pl-btn--secondary` + tooltip。
2. 表描述三段式（DB / AI / Human）+ 采纳 AI。
3. grain 多选控件（字段 chip + 候选；缺失字段可见标注）。

### Phase 3: Field Table Density

1. 将 `FieldCard` 改为表格行布局（`pl-data-grid`）。
2. 工具条补充选择用途说明。
3. CSS：字段表、sticky thead、描述列密度。

### Phase 4: Copy + Joins Inline

1. 指标 / 分群 / 关联短文案（价值 + 写入路径）。
2. 内联 JoinEditor 能力到 `关联` tab（复用 `tableJoinCandidates` / mutations）。
3. 支持 `?tab=joins` 初始化 activeSection。
4. `JoinEditor` 改为 `Navigate` 到 catalog `?tab=joins`。
5. 更多菜单「关联关系」改为切 tab。

### Phase 5: Ledger + Docs Index

1. `docs/ui-ux-feedback/pages/catalog.md`：021–026 → `Fixed`；011 Notes 追加修正说明。
2. `docs/ui-ux-feedback/README.md` 最近维护记录。
3. `webui/docs/README.md` 索引追加 Spec 73。
4. `webui/docs/plans/README.md` 工单清单追加本工单（可选轻量）。

### Phase 6: Non-browser Verification

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/table-editor.test.tsx
npm run lint:terminology
npm run build
git diff --check
```

### Phase 7: Code Review Only

对照 Spec 73 验收项做缺陷优先 code review；不跑浏览器。

## Design System Compliance

- Button：导入 / 导出 / 校验 = secondary；保存 = primary。
- Data grid：字段列表用 `pl-data-grid` 密度与选择窄列。
- Copy：短句业务价值，避免 spec 式长文。
