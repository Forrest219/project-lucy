# Wiki Version History Data Grid Alignment Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki Version History Data Grid Alignment Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/83-wiki-version-history-data-grid-alignment-spec.md` |
| 适用范围 | 落地版本记录表 `pl-data-grid` 与操作列对齐 |
| 输出位置 | `webui/docs/plans/wo-202608-15-wiki-version-history-data-grid-alignment.md` |

**Goal:** Spec 83：历史版本表接入 `pl-data-grid`；当前行操作列留空；操作按钮内层 flex，修复列/行对齐与底边错阶。

**Architecture:** 仅前端 `WikiVersionHistoryDialog` + CSS + 测试 + 台账。

---

## Non-Negotiable

- 不改后端 API / 详情态逻辑。
- 不做浏览器验证；Vitest + `lint:terminology` + `build`。
- 不得在 `<td>` 上设 `display:flex`。

## Phases

### 1. Markup

`WikiVersionHistoryDialog.tsx`：

- `className="pl-data-grid pl-wiki-version-table"`
- 当前行操作列 `null`
- 非当前：`<td><div className="pl-wiki-version-row-actions">…</div></td>`
- 删除 `pl-wiki-version-current-hint`

### 2. CSS

`app.css`：

- 收敛 `.pl-wiki-version-table` 重复基线
- `.pl-wiki-version-row-actions` 改为内层 `inline-flex flex-nowrap items-center gap-2`
- 删除仅服务旧「当前」hint 的规则（若无引用）

### 3. Tests + ledger

- `wiki.test.tsx`：断言 `pl-data-grid`；当前行无 hint；主路径回归
- 台账 `UX-WIKI-038`～`040` → `Fixed`
- README 索引 Spec 83 / 本工单；Spec 80 加交叉修订一句

### 4. Verify

```bash
cd webui && npm test -- src/__tests__/wiki.test.tsx && npm run build
```

## Acceptance

- [ ] Spec 83 / Plan / 台账已更新
- [ ] `pl-data-grid` + 内层 actions + 当前行空操作列
- [ ] Vitest / terminology / build 通过
- [ ] 仅 code review，无浏览器验证
