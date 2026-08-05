# List Page KPI Metric Card Unification Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | List Page KPI Metric Card Unification Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/103-list-page-kpi-metric-card-unification-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 103：共享 MetricCard、六页收敛、Design System、台账 |
| 输出位置 | `webui/docs/plans/wo-202608-36-list-page-kpi-metric-card-unification.md` |

**Goal:** 以 Connections KPI 为唯一 List KPI 标准；每卡 ⓘ；高度一致；允许 3/4/8 网格数量。

**Architecture:** Design System 事实源 → 共享 `MetricCard` → 六页替换本地实现 → 测试与台账。

**Tech Stack:** React、Radix Tooltip（沿用 Connections）、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

---

## Non-Negotiable Boundaries

- 不改 `/overview` Ops Metric Row（Spec 102）。
- 不改 KPI API / 业务计数口径。
- KPI 保持静态不可点击筛选。
- 成功健康态不整卡 success 染色。
- 不做浏览器验证。

## Scope

### Phase 0 — Docs

- Spec 103、本工单。
- `design-system/12-components-metric-card.md`；更新 `design-system/README.md`、`20-patterns-page-layout.md`、`30-pr-compliance-template.md`。
- `webui/docs/README.md`、`plans/README.md` 登记。

### Phase 1 — Shared component

- 新增 `webui/src/components/MetricCard.tsx`：
  - props：`label`、`value`、`help`（必填 string）、`subValue?`、`tone?`、`testId?`、`metric?`
  - class：`pl-metric-card pl-metric-card--with-help` + optional tone
  - help：`pl-icon-help` + Radix tooltip；`data-testid={`metric-help-${id}`}`
- Connections：`pages/connections/MetricCard.tsx` 改为调用共享组件 + `METRIC_METADATA`。

### Phase 2 — Pages

- `CaseList.tsx`：三卡 + help 口径文案；保留 `--three`。
- `Monitor.tsx`：删本地 MetricCard；tone 映射（success/default → 无 tone；失败集中 → warning）。
- `GovernanceOverview.tsx`：八卡 + help；合并 subline/hint 为 `subValue`。
- `AgentList.tsx` / `RoleList.tsx`：四卡 + help。

### Phase 3 — Ledger

- 追加并标 Fixed：
  - `UX-CONNECTIONS-025`（基准确认 / 共享组件）
  - `UX-EVAL-005`、`UX-EVAL-006`（cases / monitor）
  - `UX-ADMIN-GOV-022`
  - `UX-ADMIN-AGENTS-040`、`UX-ADMIN-AGENTS-041`（agents / roles）
- `docs/ui-ux-feedback/README.md`：维护记录 + 主题 `list-page kpi metric-card` + 治理规则一条。

### Phase 4 — Tests + Gate

```bash
cd webui
npm test -- --run \
  src/__tests__/connection-overview.test.tsx \
  src/__tests__/eval-cases.test.tsx \
  src/__tests__/agent-list.test.tsx \
  src/__tests__/role-list.test.tsx \
  src/__tests__/admin-governance-observability.test.tsx
npm run lint:terminology
npm run build
```

若存在 monitor 测试文件一并跑。

## 验证要点

- 六页 DOM：每卡含 `.pl-metric-card-title` 与 help 按钮。
- Monitor：无 `pl-metric-card--success` 在「失败 case=0 / 正常」路径（或等价断言）。
- Usage：单卡 children 中 `small` ≤ 1。
- Connections：既有 `data-metric` / warning tone 断言仍绿。

## Design System Compliance（交付）

- Referenced：`12-components-metric-card.md`、`20-patterns-page-layout.md`
- Follows：Connections 基准、必有 ⓘ、tone 纪律、网格数量例外
- Exceptions：None
