# Global Toast Placement Away From Header Actions Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Global Toast Placement Away From Header Actions Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-07 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/120-global-toast-placement-away-from-header-actions-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 120 |
| 输出位置 | `webui/docs/plans/wo-202608-53-global-toast-placement-away-from-header-actions.md` |

**Goal:** 全局 sonner Toaster 从 `top-right` 改为 `bottom-right`，避免与 PageHeader actions 重叠。

**Architecture:** 单点配置 `App.tsx`；Design System + 台账固化约定；修订 Spec 28 过时偏好。

**Tech Stack:** React、sonner、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

---

## Non-Negotiable Boundaries

- 不做浏览器验证；结束后只做 code review。
- 不改各页 `toast.*` 文案与调用点。
- 不把 toast 改为居中 Modal。
- 不引入动态 top-offset 方案。

## Scope

### Phase 0 — Docs / Ledger

- Spec 120、本工单。
- `webui/docs/README.md`、`plans/README.md`。
- Design System `13-components-toast.md` + README 索引。
- 台账 `UX-GLOBAL-SHELL-009`；跨页主题 `toast vs pageheader actions`；治理规则一条。
- 修订 Spec 28 §5.2 toast 落点；澄清 overview ledger 中「sonner 默认右下角」与历史 `top-right` 的表述。
- 证据图：`docs/ui-ux-feedback/assets/global-shell/UX-GLOBAL-SHELL-009-before.png`。

### Phase 1 — Code

- `App.tsx`：`position="bottom-right"`。
- `app-shell.test.tsx`：源码契约断言 Toaster 落点。

### Phase 2 — Gate

```bash
cd webui
npm test -- --run src/__tests__/app-shell.test.tsx
npm run lint:terminology
npm run build
```

## Design System Compliance（交付）

- Referenced：`13-components-toast.md`；PageHeader actions 避让
- Follows：边角 toast；禁默认盖住页头动作
- Exceptions：无
- Deviations：无
