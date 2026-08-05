# Overview Quality / Access Risk Metric Row Unification Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Overview Quality / Access Risk Metric Row Unification Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/102-overview-quality-risk-metric-row-unification-spec.md`（v1.0） |
| 适用范围 | Spec 102：统一 `/overview` 质量快照 / 访问风险六卡布局与 CTA |
| 输出位置 | `webui/docs/plans/wo-202608-35-overview-quality-risk-metric-row-unification.md` |

**Goal:** 六卡共用 Ops Metric Row：标题左上、主值左下、CTA 右中；对齐待处理事项。

**Architecture:** `OpsMetricRow` 组件 + `.pl-ops-metric-row` CSS；语义卡 progress 作 `extra`；Token 补 icon。

**Tech Stack:** React、lucide、现有 `pl-card-cta` / Registry deep links、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并实现 |

---

## Non-Negotiable Boundaries

- 不改 API / 计数口径 / Spec 100 Registry URL 形态。
- 不改待处理事项行结构。
- 不落地 Spec 101 刷新 icon-btn。
- 不做浏览器验证。

## Scope

### Phase 1 — CSS

- `app.css` 新增 `.pl-ops-metric-row*`（双列：body | CTA；body 内标题→值 gap）。
- 收敛 `.pl-snapshot-item` / `.pl-risk-item`：不再作为六卡主布局依赖（可保留兼容或改为 list 间距专用）。
- 主值字号统一 `text-xl tabular-nums`；消除 snapshot `strong` 压成 `text-sm` 的冲突。

### Phase 2 — Component

- `Onboarding.tsx`：抽取 `OpsMetricRow`；重写 `SemanticCoverageCard` 与五张风险/快照卡。
- 语义 CTA：`查看语义资产 ↗` → `DEEP_LINKS.catalogIncomplete`。
- Token：`KeyRound` icon + 主值数字 + 次行说明 + 右中 CTA。

### Phase 3 — Tests

- `onboarding.test.tsx`：
  - 六卡均含 `.pl-ops-metric-row`（或等价 testid）。
  - 语义 progress a11y 不回归。
  - 语义 / Token / 发布 / ACL 等 CTA `href` 正确且位于行内（存在 `pl-ops-metric-row-cta`）。
  - Token 文案仍含「可用」「Token」。

### Phase 4 — 台账

- `overview.md`：追加并标记 `UX-OVERVIEW-016`～`018` → `Fixed`。
- `docs/ui-ux-feedback/README.md`：维护记录 + 主题 `ops metric-row symmetry`。
- `webui/docs/README.md`、`plans/README.md` 登记 Spec 102 / 本工单。

### Phase 5 — Gate

```bash
cd webui
npm test -- --run src/__tests__/onboarding.test.tsx
npm run lint:terminology
npm run build
```

## 验证要点

- `rg 'pl-snapshot-item|pl-risk-item' webui/src/pages/Onboarding.tsx`：六卡主容器不再依赖旧双列隐式排布。
- 语义 CTA href = `/catalog?completion=incomplete`。
- ACL CTA 仍为 Registry denied URL。
