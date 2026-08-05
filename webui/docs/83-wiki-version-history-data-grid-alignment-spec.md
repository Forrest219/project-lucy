# Wiki Version History Data Grid Alignment Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki Version History Data Grid Alignment Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | Spec 80 落地后用户截图与 3 点反馈；浏览器 `:55176` 仍为旧双栏产物、新表以 host 源码 + 截图核查；`webui/docs/design-system/11-components-data-grid.md`；`WikiVersionHistoryDialog.tsx`、`app.css` |
| 适用范围 | 指导 `/wiki`「版本记录」历史版本表接入 `pl-data-grid`、当前行操作列与行内按钮对齐的实现与验收 |
| 输出位置 | `webui/docs/83-wiki-version-history-data-grid-alignment-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 83 |
| 关联工单 | `webui/docs/plans/wo-202608-15-wiki-version-history-data-grid-alignment.md` |
| 关联页面 | `/wiki` → 版本记录 |
| 关联台账 | `docs/ui-ux-feedback/pages/wiki.md`（`UX-WIKI-038` ~ `UX-WIKI-040`） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | 修订 Spec 80 §6 表格视觉与操作列结构；不改 API / 详情态 / 业务文案映射 |

## 1. 背景

Spec 80 列表优先已落地后，用户反馈历史版本表仍有 3 点问题（截图核查属实）：

1. 表格未遵从项目 `pl-data-grid` 规范，另起 `.pl-wiki-version-table` 基线。
2. 当前行操作列「当前」与时间列视觉不连贯（字号更小、冗余）。
3. 「查看」「恢复此版本」未与「操作」列表头左缘及同行文字垂直对齐；`display:flex` 直接作用在 `<td>` 导致行底边错阶。

本轮无特殊场景可申诉跳出 Data Grid 规范。

## 2. 目标

1. 历史版本 `<table>` 必须带 `pl-data-grid`；`pl-wiki-version-table` 仅作业务扩展，不得重写全套 typography / padding / border 基线。
2. 当前行（`versions[0]`）操作列留空；「修订 N（当前）」已在版本列表达身份。
3. 非当前行：操作按钮放在 `td` 内层容器上做 `flex-nowrap` + `items-center`；`td` 保持 table-cell + `align-middle`；按钮与同行文本垂直对齐、与「操作」表头内容左缘对齐；同行各单元格底边同一 Y。

## 3. 非目标

- 不改版本 API、倒序契约、详情态、恢复预检。
- 不引入 `?version=` URL。
- 不做浏览器验证——本轮默认非浏览器验收（Vitest + `lint:terminology` + `build`）；台账止于 `Fixed`。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md` and Spec 80.

New terms: None。

## 5. Design System Compliance

- 引用：`webui/docs/design-system/11-components-data-grid.md` §3–§7。
- 结构：`className="pl-data-grid pl-wiki-version-table"`。
- 操作列左对齐；行内动作用既有 `pl-btn` 弱层级，不升 `primary`。
- 禁止在 `<td>` 上设置 `display: flex`（破坏 table 边框连续性）。

## 6. 实现要求

### 6.1 表格类

```tsx
<table className="pl-data-grid pl-wiki-version-table" data-testid="wiki-version-table">
```

CSS：删除 `.pl-wiki-version-table` 中与 `pl-data-grid` 重复的 `text-sm` / `th`/`td` padding/border/color 规则；仅保留操作列内层、修订当前态、次要 note 等业务覆盖。

### 6.2 当前行操作列

- 操作列渲染空单元格（无「当前」hint、无按钮）。
- Spec 80 §6.3「或仅静态当前文案」在本 Spec 收敛为：**留空**。

### 6.3 操作列 DOM

```tsx
<td>
  {!isCurrent ? (
    <div className="pl-wiki-version-row-actions">
      <button className="pl-btn pl-btn--ghost">查看</button>
      <button className="pl-btn pl-btn--secondary">恢复此版本</button>
    </div>
  ) : null}
</td>
```

- `.pl-wiki-version-row-actions`：`inline-flex flex-nowrap items-center gap-2`（不要 `display:flex` 上 `td`）。
- 「查看」「恢复此版本」保持同组按钮节奏；高度由同一 `pl-btn` 体系约束。

## 7. 验收标准

### 7.1 自动化

- 断言 `wiki-version-table` 的 `className` 含 `pl-data-grid`。
- 当前行无 `wiki-version-current-hint`、无查看/恢复按钮；仍含「修订 …（当前）」。
- 非当前行仍可查看 / 恢复；返回列表 / 恢复预检回归通过。
- CSS 断言：`.pl-wiki-version-row-actions` 存在，且不把 flex 绑在会破坏 table-cell 的 `td` 选择器上（可用源码/CSS 负向断言：无 `td.pl-wiki-version-row-actions` 或等价）。
- `lint:terminology`、`build` 通过。

### 7.2 浏览器（本轮不做）

复核时验证：操作列与表头左缘对齐；同行按钮与文字垂直居中；行底边无错阶。

## 8. 对 Spec 80 的修订

- 修订 Spec 80 §6.1 / §6.3：表格基线改为 `pl-data-grid`；当前行操作列改为留空。
