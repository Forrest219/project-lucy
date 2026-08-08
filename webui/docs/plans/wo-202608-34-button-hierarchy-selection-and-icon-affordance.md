# Button Hierarchy, Selection Controls, and Icon Affordance Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Button Hierarchy, Selection Controls, and Icon Affordance Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/101-button-hierarchy-selection-and-icon-affordance-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 101 Wave A+B：Design System 按钮 v1.1、CaseList segmented、pl-icon-btn、Overview/Connections 刷新图标化 |
| 输出位置 | `webui/docs/plans/wo-202608-34-button-hierarchy-selection-and-icon-affordance.md` |

**Goal:** 选中态与主按钮分离；Header 工具动作图标化；升级按钮规范并在 Eval / Overview / Connections 首批落地。

**Architecture:** Design System 事实源升级 → CSS `pl-icon-btn` + loading → 三页调用点收敛 → 测试与台账。

**Tech Stack:** React、现有 `pl-segmented-control`、lucide（或现有图标集）、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿（Draft，待实现） |

---

## Non-Negotiable Boundaries

- 不换品牌主色为 Attu 绿。
- 不实现 Wave C（More 菜单 / 全站行内扫尾 / disabledTooltip 平台化）。
- 不改 API；不碰 Spec 100 指标卡 icon 范围（除非共享文件时仅做按钮相关）。
- Overview「上次更新」与刷新必须保持同组邻接。
- Connections「添加 Schema」与刷新可一文案一图标，但不得出现双 primary。
- 不做浏览器验证。

## Scope

### Phase 0 — Design System 文档（可与代码同 PR）

- `webui/docs/design-system/10-components-button.md` → v1.1（选中分离、Header 预算、icon-btn、loading/disabled）。
- `webui/docs/design-system/30-pr-compliance-template.md`：追加选中态 / Header 预算 / disabled 解释勾选。
- `webui/docs/README.md`、`plans/README.md` 已登记 Spec 101 / 本工单。

### Phase 1 — CSS / 可选封装

- `app.css`：
  - `.pl-icon-btn`（h-8 w-8、ghost hover、focus-visible ring、disabled）。
  - `.pl-btn[data-loading="true"]`（aria 配套在 JSX；min-width 策略）。
- 可选：`IconButton.tsx` 统一 `aria-label` + title/tooltip；若不用组件，页面须自行满足契约。

### Phase 2 — `/eval/cases` 域名 segmented（Wave A）

- `CaseList.tsx`：域名按钮组改为 `pl-segmented-control`；选中 `--active`。
- 域名多时允许 wrap；禁止 `pl-btn--primary` 表示选中。
- 「新建 Case」保持独立动作按钮（ghost 或 secondary，与 Spec 101 §6.1）。

### Phase 3 — Overview / Connections icon-btn（Wave B）

- `Onboarding.tsx`：刷新 → `pl-icon-btn`；`aria-label="刷新首页数据"`；loading 态；徽标邻接不变。
- `CatalogReloadButton.tsx` / `ConnectionOverview.tsx`：刷新本地目录 → icon-btn；添加 Schema 保持 secondary。
- 更新既有「不得为 primary」类断言，改为 icon-btn / secondary 断言。

### Phase 4 — 台账

- `eval.md`：`UX-EVAL-004` → Fixed（实现后）。
- `overview.md`：`UX-OVERVIEW-015` → Fixed。
- `connections.md`：`UX-CONNECTIONS-024` → Fixed。
- `docs/ui-ux-feedback/README.md`：跨页面主题四条 + 维护记录一行。

### Phase 5 — Tests + Gate

```bash
cd webui
npm test -- --run src/__tests__/eval-cases.test.tsx src/__tests__/onboarding.test.tsx src/__tests__/connection-overview.test.tsx
npm run lint:terminology
npm run build
```

## 验证要点

- `rg 'pl-btn--primary' webui/src/pages/eval/CaseList.tsx`：域名切换路径无 primary 选中。
- Overview 刷新：`pl-icon-btn` + aria-label；无「刷新首页数据」宽文案按钮抢 Header。
- Connections：刷新 icon-btn；添加 Schema `pl-btn--secondary`；同组无双 primary。
- Design System Compliance 小节写入 PR/交付说明。

## 明确不做（Wave C 备忘）

- Header「更多」溢出菜单组件。
- 全站表 Actions 列 ghost 化扫尾。
- disabledTooltip 平台组件（本轮仅对新改按钮按需加 title/aria-describedby）。
