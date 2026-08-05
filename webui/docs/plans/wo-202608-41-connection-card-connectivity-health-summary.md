# Connection Card Connectivity Health Summary Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Card Connectivity Health Summary Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/108-connection-card-connectivity-health-summary-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 108 |
| 输出位置 | `webui/docs/plans/wo-202608-41-connection-card-connectivity-health-summary.md` |

**Goal:** `/connections` 每张连接卡右侧展示连通健康（状态 + ms），进页并行探测一次，与 Drawer 结果同源。

**Architecture:** React Query per-connection POST test；共享 `connectionHealth` 工具函数；卡摘要 + `ConnectionTestDrawer`。

**Tech Stack:** React Query、既有 `apiPost`、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

---

## Non-Negotiable Boundaries

- 不做浏览器验证。
- 不改 `/api/health`。
- 不在 footer 恢复大号「测试连接」按钮。
- 卡上不展示原始日志。

## Scope

### Phase 0 — Docs

- Spec 108、本工单。
- `webui/docs/README.md`、`plans/README.md`。
- 术语标准增补 §3 / 数据接入相关行：连通健康、通 / 偏慢 / 需关注 / 不通 / 探测中…、响应延时（卡摘要语境）。
- Spec 44 交叉引用一句（允许摘要入口）。

### Phase 1 — Shared health helpers

- `webui/src/lib/connectionHealth.ts`：`latencyTone` / 卡摘要文案映射；供 Panel 与卡复用。
- `queryKeys.connectionHealth(connId)`。

### Phase 2 — ConnectionOverview

- `useQueries` 并行 `POST /api/connections/:id/test`（`staleTime: 0`，`retry: false`）。
- Header meta 右侧渲染可点击摘要。
- 状态：`testDrawerConnId`、`logsExpanded`；打开 Drawer；重新测试 = refetch。
- CSS：`.pl-connection-health` 及 tone 修饰。

### Phase 3 — Panel

- `ConnectionTestResultPanel` 改用共享 `latencyTone`（行为不变）。

### Phase 4 — Tests & Ledger

- `connection-overview.test.tsx`：进页 POST test、摘要文案、点击开 Drawer、失败隔离。
- 必要时轻量调整 `connection-test.test.tsx`。
- 台账 `UX-CONNECTIONS-028`～`030` → Fixed；README 维护记录 + 跨页面主题。

### Phase 5 — Gate

```bash
cd webui
npm test -- --run src/__tests__/connection-overview.test.tsx src/__tests__/connection-test.test.tsx
npm run lint:terminology
npm run build
```

## Design System Compliance（交付）

- Referenced：连接卡 Header meta、Drawer
- Follows：摘要可点击、不挡首屏、失败隔离
- Exceptions：卡用「通」缩短文案
- Deviations：无
