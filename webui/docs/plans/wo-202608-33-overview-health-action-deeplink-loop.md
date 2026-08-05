# Overview Health-to-Action Deep Link Closed Loop Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Overview Health-to-Action Deep Link Closed Loop Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.2 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/100-overview-health-action-deeplink-loop-spec.md`（v1.2） |
| 适用范围 | Spec 100：Registry、Catalog query 原子交付、必填 impact/evidence、回写 refetch、指标卡 icon |
| 输出位置 | `webui/docs/plans/wo-202608-33-overview-health-action-deeplink-loop.md` |

**Goal:** overview 待办/健康 CTA 只生产 Canonical Registry URL；Catalog/Audit 消费一致；返回 overview 可见回写；快照 Attu 式小 icon。

**Architecture:** `opsDashboard` 唯一生产者 + Catalog URL 同步同 PR + Onboarding refetch on enter + `pl-metric-card` icon。

**Tech Stack:** React Router search params、opsDashboard、lucide、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿 |
| v1.1 | Spec 100 v1.1 指标卡 icon |
| v1.2 | Spec 100 v1.2：Registry/弃用表；impact/evidence 必填；Catalog 原子交付；§7.2 回写 refetch |

---

## Non-Negotiable Boundaries

- 禁止半截发布：新 `actionUrl` 与 Catalog query 消费必须同 PR。
- 禁止 overview 再产出 `/?status=partial` 或无 `tab` 的 denied 链。
- 不恢复四卡健康条 / interval auto-refresh。
- 不造假负责人时间。
- Spec 99 未合并时 MCP 链回退 `#overview-mcp`。
- 不做浏览器验证。

## Scope

### Phase 1+2（同 PR）— Registry + Catalog

- `opsDashboard.ts`：全表 Registry URL；`impact`/`evidence` 必填；类型收紧。
- 消灭测试与调用方对旧 URL 的断言。
- `Catalog.tsx`：`incomplete` + `useSearchParams` 双向同步。
- `ops-dashboard.test.ts` + catalog 测试锁定。

### Phase 3 — Overview CTA

- `Onboarding.tsx`：摘要/danger CTA；访问风险 audit 链对齐 Registry；`#overview-mcp`。
- 修正现有 `to="/admin/audit?outcome=denied"` 等遗留。

### Phase 4 — 回写 refetch

- 进入 `/overview`（含从其它路由 navigate 回来）触发待办相关 queries refetch（与刷新首页数据同组）。
- 测试：mock 路由进入触发 refetch（或调用共享 `refreshOverviewQueries`）。

### Phase 5 — impact/evidence UI + 指标卡 icon

- ActionRequiredRow 展示影响/证据来源。
- 快照区 Attu 式 icon（Spec 100 §8）。

### Phase 6 — Audit 回归 + 台账

- 确认 `tab=calls&outcome=denied&hours=168`。
- `UX-OVERVIEW-011`～`014` → Fixed。

### Phase 7 — Gate

```bash
cd webui
npm test -- --run src/__tests__/ops-dashboard.test.ts src/__tests__/onboarding.test.tsx src/__tests__/catalog.test.tsx
npm run lint:terminology
npm run build
```

## 验证要点

- `rg 'status=partial|/\\?status=' webui/src` 无 overview 生产路径。
- `rg 'audit\\?outcome=denied"' webui/src/pages/Onboarding.tsx webui/src/lib/opsDashboard.ts` 无裸 outcome 链。
- Catalog incomplete + 返回 overview refetch + 双字段待办可见。
