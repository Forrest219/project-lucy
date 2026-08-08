# Agent Admin KPI Column Order & Identity Header Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent Admin KPI Column Order & Identity Header Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/98-agent-admin-kpi-column-order-and-identity-header-spec.md` |
| 适用范围 | `/admin/agents` KPI 顺序、表列顺序、主列头命名 |
| 输出位置 | `webui/docs/plans/wo-202608-31-agent-admin-kpi-column-order-and-identity-header.md` |

**Goal:** 按「存量 → 活跃 → 调用」重排 KPI；按「配置 Token → 活跃 Token → 调用 → 创建 → 变更 → 最近访问」重排表列；主列头改为「显示名/用户 ID」。

**约束：** 结束后只做 code review，不做浏览器验证。

## Phase 1 — AgentList UI

- `webui/src/pages/admin/AgentList.tsx`
  - KPI：`metric-calls` 移到四卡末位。
  - 表头与 `<td>`：按 Spec 98 §5.2 重排。
  - 主列头：`显示名` → `显示名/用户 ID`。

## Phase 2 — 测试

- `webui/src/__tests__/agent-list.test.tsx`
  - 断言 KPI DOM 顺序。
  - 断言表头顺序与 `显示名/用户 ID`。

## Phase 3 — 术语与台账

- `00-product-terminology-standard.md` §4.5：补 `Agent List Identity Column`；澄清列表主列文案。
- `docs/ui-ux-feedback/pages/admin-agents.md`：追加 `UX-ADMIN-AGENTS-037`～`039` → `Fixed`。
- `docs/ui-ux-feedback/README.md`：最近维护记录 + 跨页面主题更新。
- `webui/docs/README.md`、`webui/docs/plans/README.md` 登记 Spec 98 / wo-202608-31。
- Spec 93 / 95 交叉引用由 Spec 98 §7 澄清（不必改历史 Expected 正文）。

## Phase 4 — Gate

```bash
cd webui
npm test -- --run src/__tests__/agent-list.test.tsx
npm run lint:terminology
npm run build
```

## 验证要点（非浏览器）

- KPI testId 顺序：agent-count → active-agent → active-token → calls。
- 表头含 `显示名/用户 ID`；`配置 Token` 在 `近 7 天活跃 Token` 之前；`创建日期` 在 `配置最后变更时间` 之前；`最近访问时间` 在操作列之前。
