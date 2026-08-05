# Admin Usage Overview UX Refinement Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Usage Overview UX Refinement Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/78-admin-usage-overview-ux-refinement-spec.md`（**v1.1**）；浏览器核查；已批准改善方案；交叉评估拍板（activeInWindow、表并集、IA 同步、P95 空态、含未启用） |
| 适用范围 | 指导 `/admin/governance` 使用概况二轮打磨的实施与验收 |
| 输出位置 | `webui/docs/plans/wo-202608-10-admin-usage-overview-ux-refinement.md` |

**Goal:** 落地 Spec 78 v1.1。

**Architecture:** 前端 `GovernanceOverview.tsx` + `navigation.ts`；后端 `governance-observability.ts` 窗口全局化、表 KPI、`activeInWindow`、`tableStatsSource`。不改 ACL / access.yaml schema / URL。

**Tech Stack:** React、TypeScript、Fastify、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿 |
| v1.1 | 钉死 API/表口径/空态/enabled/Phase 0 IA 同步 |

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 执行本工单。先读 Spec **78 v1.1**。

必须先阅读：`../docs/DEVELOPMENT.md`、`docs/00-product-terminology-standard.md`、`docs/06-navigation-ia.md`、`docs/75-…`、`docs/78-…`（v1.1）、`GovernanceOverview.tsx`、`navigation.ts`、`governance-observability.ts`、前后端 `admin-governance-observability` 测试、`navigation.test.ts`。

## Non-Negotiable Boundaries

- 不改 access.yaml schema / ACL；不迁 URL；不拉回风险主屏。
- 配置存量（含未启用）不随 hours；其余使用类随 hours。
- `activeInWindow` 必返回；双发废弃 `activeInLast7d=activeInWindow`；前端只读新字段。
- `activeTableCount` = 两源去重并集；`popularTables` 互斥主路径 + `tableStatsSource`。
- P95 真实分位；无调用 UI 不得「0 ms + 95% 文案」。
- Phase 0 必同步术语标准 + `06-navigation-ia.md` + `rg`「治理概览」用户可见/索引。
- 不做浏览器验证 / 移动窄屏；台账标 Fixed。

## Scope

### Phase 0: Terminology + IA Sync

1. 更新 `00-product-terminology-standard.md`（Spec 78 §4）。
2. 更新 `06-navigation-ia.md`：访问治理下增加「使用概况」→ `/admin/governance`。
3. `rg -n "治理概览"` 清理用户可见/索引文案（历史 wo 文件名可留）。

### Phase 1–2: Baseline + Test Contracts

更新前后端测试契约（标题、KPI、窗口、activeInWindow、表并集、P95 空态、导航）。实现前可红。

### Phase 3: Backend

- active*/popularTables/agent activeToken 随 hours。
- usageOverview + configured/active table + p95 + tableStatsSource。
- tokens: `activeInWindow` + deprecated twin。
- configuredTableCount：显式 names union；open-ended flag。

### Phase 4: Frontend

- 使用概况命名；去 badge/访问日志；KPI 2×4；P95/空态；去技术 hint；列表对齐。

### Phase 5: Gate

```bash
cd webui
npm test -- server/__tests__/admin-governance-observability.test.ts \
  src/__tests__/admin-governance-observability.test.tsx \
  src/__tests__/navigation.test.ts
npm run lint:terminology
npm run build
git diff --check
```

台账 `UX-ADMIN-GOV-001`～`008` → Fixed。

## Out of Scope

URL 迁移；Risk 主屏；启用表范围混入口径；浏览器 E2E。
