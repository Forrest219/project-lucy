# M36 Data Agent Ops Platform Global UX Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade Lucy WebUI from a set of semantic asset maintenance pages into a data agent operations control plane with a global ops dashboard, cross-module object context, release risk review, quality operations, and audit traceability.

**Architecture:** Frontend-first IA and UX upgrade using existing React pages, PageHeader, CSS tokens, TanStack Query data, and current API contracts where possible. New derived view models should live in `webui/src/lib/` and aggregate existing endpoints before any backend API is added. Cross-module context is delivered through a reusable object detail drawer keyed by URL query parameters.

**Tech Stack:** React, TypeScript, React Router, TanStack Query, Vitest, Testing Library, existing `app.css` token system, existing Fastify API when new lightweight aggregation endpoints are unavoidable.

**Source Spec:** [../39-data-agent-ops-platform-global-ux-spec.md](../39-data-agent-ops-platform-global-ux-spec.md)

---

## Context For Developer

Read these documents before editing:

- `AGENTS.md`
- `docs/DEVELOPMENT.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/06-navigation-ia.md`
- `webui/docs/19-system-overview-runtime-monitoring-spec.md`
- `webui/docs/35-semantic-publish-workbench-ia-spec.md`
- `webui/docs/36-business-wiki-read-edit-workbench-spec.md`
- `webui/docs/37-sidebar-navigation-ia-consolidation-spec.md`
- `webui/docs/38-data-heatmap-tab-subsumption-spec.md`
- `webui/docs/39-data-agent-ops-platform-global-ux-spec.md`

Inspect these implementation files:

- `webui/src/app/App.tsx`
- `webui/src/app/app.css`
- `webui/src/components/PageHeader.tsx`
- `webui/src/pages/Onboarding.tsx`
- `webui/src/pages/Catalog.tsx`
- `webui/src/pages/WikiEditor.tsx`
- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/pages/connections/TableWhitelist.tsx`
- `webui/src/pages/publish/PublishWorkbench.tsx`
- `webui/src/pages/publish/PublishHistory.tsx`
- `webui/src/pages/eval/CaseList.tsx`
- `webui/src/pages/eval/RunList.tsx`
- `webui/src/pages/eval/RunDetail.tsx`
- `webui/src/pages/eval/Monitor.tsx`
- `webui/src/pages/admin/AgentList.tsx`
- `webui/src/pages/admin/RoleList.tsx`
- `webui/src/pages/admin/Audit.tsx`
- `webui/src/pages/admin/ConfigAudit.tsx`
- `webui/src/lib/apiClient.ts`
- `webui/src/lib/queryKeys.ts`
- `webui/src/lib/types.ts`
- `webui/docs/user-guide.html`

Inspect these tests and extend them:

- `webui/src/__tests__/onboarding.test.tsx`
- `webui/src/__tests__/app-shell.test.tsx`
- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/table-whitelist.test.tsx`
- `webui/src/__tests__/wiki.test.tsx`
- `webui/src/__tests__/review.test.tsx`
- `webui/src/__tests__/publish-history.test.tsx`
- `webui/src/__tests__/eval-cases.test.tsx`
- `webui/src/__tests__/monitor.test.tsx`
- `webui/src/__tests__/admin-agents.test.tsx`
- `webui/src/__tests__/admin-roles.test.tsx`
- `webui/src/__tests__/admin-audit.test.tsx`
- `webui/src/__tests__/admin-config-audit.test.tsx`
- `webui/src/__tests__/lint-terminology-scan.test.ts`
- `webui/src/__tests__/lint-ia-boundary.test.ts`

Non-negotiable boundaries:

- Do not change `ktx.yaml`, `webui/config/access.yaml`, or `.ktx/secrets/**`.
- Do not write data question-answering runtime rules into `CLAUDE.md`, `AGENTS.md`, or `webui/config/data-qa-instructions.md`.
- Do not remove any route from `App.tsx`.
- Do not translate `Schema`, `Manifest`, `Catalog`, `MCP`, `KTX`, `Agent`, or `Endpoint`.
- Add `translate="no"` and `notranslate` to DOM nodes that render professional English terms, identifiers, file paths, URLs, database object names, token ids, session ids, or turn ids.
- Keep card radius at existing token values; do not add decorative gradients, hero sections, or marketing layout.
- Treat existing dirty worktree changes as user-owned unless they are directly part of this work order.

---

## Codex Direct Prompt

你在 `/Users/zhangxingchen/Projects/project-lucy` 工作。请按 `webui/docs/39-data-agent-ops-platform-global-ux-spec.md` 实施 M36。

交付：

1. 将系统概览升级为 data agent 运维驾驶舱，增加 `待处理事项`、质量快照和访问风险快照。
2. 新增可复用 `ObjectDetailDrawer`，至少支持 Table、Agent、Eval Run、Audit Event 四类对象。
3. 在表目录、Agent 列表、运行历史、访问日志中加入打开对象详情的入口。
4. 发布工作台展示 `变更影响范围`，发布成功后提示触发相关 domain 的评测 run。
5. 趋势监控和其他空状态必须提供下一步动作。
6. Agent / Role / Audit / Config Audit 页面增加跨模块追溯链接。
7. 更新术语标准、用户手册、测试。
8. 收尾说明必须列出修改文件、验证命令与结果。

---

## Task 1: Terminology And View Model Groundwork

**Files:**

- Modify: `webui/docs/00-product-terminology-standard.md`
- Create: `webui/src/lib/opsDashboard.ts`
- Modify: `webui/src/lib/queryKeys.ts`
- Test: `webui/src/__tests__/lint-terminology-scan.test.ts`
- Test: create `webui/src/__tests__/ops-dashboard.test.ts`

**Step 1: Register new product terms**

Add terms from the spec:

- `运维驾驶舱`
- `待处理事项`
- `对象详情抽屉`
- `变更影响范围`
- `质量运营`

**Step 2: Write failing tests for derived ops items**

Create `ops-dashboard.test.ts` with assertions for a pure function:

```ts
import { buildActionRequiredItems } from "../lib/opsDashboard";

it("prioritizes semantic gaps, pending changes, eval gaps, and access risk", () => {
  const items = buildActionRequiredItems({
    semanticCoverage: { done: 4, total: 16 },
    pendingCatalogItems: 10,
    pendingPublishFiles: 3,
    evalRunsLast30d: 0,
    aclDenied7d: 2
  });
  expect(items.map((item) => item.label)).toEqual([
    "12 张表待补语义",
    "10 个 Catalog 对象待处理",
    "存在 3 个待发布文件",
    "近 30 天无评测数据",
    "近 7 天存在 ACL deny"
  ]);
});
```

**Step 3: Run the failing test**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/ops-dashboard.test.ts
```

Expected: FAIL because `opsDashboard.ts` does not exist.

**Step 4: Implement minimal pure view model helpers**

Create typed helpers:

- `buildActionRequiredItems(input)`
- `buildServiceHealth(input)`
- `severityOrder`

Keep this file pure; no fetches and no React.

**Step 5: Run focused tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/ops-dashboard.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add webui/docs/00-product-terminology-standard.md webui/src/lib/opsDashboard.ts webui/src/lib/queryKeys.ts webui/src/__tests__/ops-dashboard.test.ts
git commit -m "feat(webui): add ops dashboard view model"
```

## Task 2: System Overview Ops Dashboard

**Files:**

- Modify: `webui/src/pages/Onboarding.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/onboarding.test.tsx`

**Step 1: Write failing tests for dashboard sections**

Assert visible sections:

- `服务健康`
- `待处理事项`
- `质量快照`
- `访问风险`

Also assert empty / healthy fallback text:

- `暂无高优先级待处理事项`
- `触发首次 Run` when there is no recent eval data

**Step 2: Run focused tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/onboarding.test.tsx
```

Expected: FAIL.

**Step 3: Refactor `Onboarding.tsx` into dashboard sections**

Use existing query data where available. For missing cross-module data, add local placeholders only when clearly marked as unavailable or derived from current endpoint state. Do not fabricate success metrics.

Required layout:

- Existing `PageHeader`
- Service health strip
- `待处理事项`
- Two-column `质量快照` / `访问风险`
- Existing runtime diagnostics below the fold

**Step 4: Add layout CSS using existing tokens**

Add only reusable classes such as:

- `.pl-ops-grid`
- `.pl-action-required-list`
- `.pl-risk-item`

Keep radius and colors tied to existing tokens.

**Step 5: Run focused and shell tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/onboarding.test.tsx src/__tests__/app-shell.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add webui/src/pages/Onboarding.tsx webui/src/app/app.css webui/src/__tests__/onboarding.test.tsx
git commit -m "feat(webui): upgrade system overview to ops dashboard"
```

## Task 3: Reusable Object Detail Drawer

**Files:**

- Create: `webui/src/components/ObjectDetailDrawer.tsx`
- Create: `webui/src/lib/objectDetail.ts`
- Modify: `webui/src/app/App.tsx`
- Modify: `webui/src/app/app.css`
- Test: create `webui/src/__tests__/object-detail-drawer.test.tsx`

**Step 1: Write failing drawer tests**

Cover:

- `?object=table&conn=mysql-aliyun&schema=dataforai&table=superstore_orders` opens a drawer titled `superstore_orders`
- Drawer renders `Connection` / `Schema` / `Table` with translation defense
- Close button removes query params
- Unknown object type shows a safe error state, not a blank drawer

**Step 2: Run focused tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/object-detail-drawer.test.tsx
```

Expected: FAIL.

**Step 3: Implement URL query parsing**

In `objectDetail.ts`, implement:

- `parseObjectDetailSearch(search: string)`
- `buildObjectDetailSearch(target)`
- `clearObjectDetailSearch(search: string)`

**Step 4: Implement `ObjectDetailDrawer`**

Use the existing dialog / drawer dependency if already present in the project. If no drawer primitive exists, use `@radix-ui/react-dialog` already listed in dependencies.

Supported initial object types:

- `table`
- `agent`
- `evalRun`
- `auditEvent`

**Step 5: Mount drawer once in `AppFrame`**

Mount below routes so every page can open it by updating query params.

**Step 6: Run tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/object-detail-drawer.test.tsx src/__tests__/app-shell.test.tsx
```

Expected: PASS.

**Step 7: Commit**

```bash
git add webui/src/components/ObjectDetailDrawer.tsx webui/src/lib/objectDetail.ts webui/src/app/App.tsx webui/src/app/app.css webui/src/__tests__/object-detail-drawer.test.tsx
git commit -m "feat(webui): add object detail drawer"
```

## Task 4: Cross-Module Object Entry Points

**Files:**

- Modify: `webui/src/pages/Catalog.tsx`
- Modify: `webui/src/pages/admin/AgentList.tsx`
- Modify: `webui/src/pages/eval/RunList.tsx`
- Modify: `webui/src/pages/admin/Audit.tsx`
- Test: `webui/src/__tests__/table-editor.test.tsx`
- Test: `webui/src/__tests__/agent-list.test.tsx`
- Test: `webui/src/__tests__/monitor.test.tsx`
- Test: `webui/src/__tests__/admin-audit.test.tsx`

**Step 1: Write failing entry point tests**

Assert:

- Table rows expose `查看详情`
- Agent rows expose `查看详情`
- Run rows expose `查看详情`
- Audit rows expose links or buttons to related Agent / Table where data exists

**Step 2: Run focused tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/table-editor.test.tsx src/__tests__/agent-list.test.tsx src/__tests__/monitor.test.tsx src/__tests__/admin-audit.test.tsx
```

Expected: FAIL.

**Step 3: Add query-param links**

Use `buildObjectDetailSearch` from `objectDetail.ts`. Do not hard-code query strings in page components.

**Step 4: Add translation defense to object ids**

All connection, schema, table, agent id, session id, and turn id nodes must use `translate="no"` and `notranslate`.

**Step 5: Run focused tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/table-editor.test.tsx src/__tests__/agent-list.test.tsx src/__tests__/monitor.test.tsx src/__tests__/admin-audit.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add webui/src/pages/Catalog.tsx webui/src/pages/admin/AgentList.tsx webui/src/pages/eval/RunList.tsx webui/src/pages/admin/Audit.tsx webui/src/__tests__
git commit -m "feat(webui): link core objects across ops pages"
```

## Task 5: Publish Workbench Change Impact

**Files:**

- Modify: `webui/src/pages/publish/PublishWorkbench.tsx`
- Modify: `webui/src/components/semantic-assets/SemanticAssetValidationPanel.tsx`
- Test: `webui/src/__tests__/review.test.tsx`
- Test: `webui/src/__tests__/semantic-asset-publish.test.tsx`

**Step 1: Write failing tests**

Assert:

- Workbench renders `变更影响范围`
- Pending semantic overlay changes show affected table names
- Publish success path renders `触发相关 domain 的评测 Run`
- Empty state keeps `上传语义资产` and `强制重建索引`

**Step 2: Run focused tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/review.test.tsx src/__tests__/semantic-asset-publish.test.tsx
```

Expected: FAIL.

**Step 3: Add change impact panel**

Derive impact from changed file paths and known semantic asset validation results. If impact cannot be derived, show `影响范围待校验` and link to `校验变更`.

**Step 4: Add post-publish evaluation prompt**

After successful publish / reindex, show a secondary action that navigates to `/eval/runs` with the relevant domain where available.

**Step 5: Run focused tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/review.test.tsx src/__tests__/semantic-asset-publish.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add webui/src/pages/publish/PublishWorkbench.tsx webui/src/components/semantic-assets/SemanticAssetValidationPanel.tsx webui/src/__tests__/review.test.tsx webui/src/__tests__/semantic-asset-publish.test.tsx
git commit -m "feat(webui): show publish change impact"
```

## Task 6: Quality Operations Empty States And Diagnosis

**Files:**

- Modify: `webui/src/pages/eval/CaseList.tsx`
- Modify: `webui/src/pages/eval/RunList.tsx`
- Modify: `webui/src/pages/eval/RunDetail.tsx`
- Modify: `webui/src/pages/eval/Monitor.tsx`
- Test: `webui/src/__tests__/eval-cases.test.tsx`
- Test: `webui/src/__tests__/monitor.test.tsx`

**Step 1: Write failing tests**

Assert:

- `趋势监控` empty state shows `触发首次 Run`、`导入评测用例`、`配置阈值`
- Trend chart renders warning / critical threshold reference lines from the configured yellow / red thresholds
- A trend point below the red threshold is highlighted and exposes `查看失败 Case`
- Run history rows link to failed cases where available
- Case list shows coverage context, not only raw case count

**Step 2: Run focused tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/eval-cases.test.tsx src/__tests__/monitor.test.tsx
```

Expected: FAIL.

**Step 3: Implement quality operations states**

Keep current routes and API contract. Add only derived UI sections and links.

For the `趋势监控` chart, keep the MVP implementation small:

- Reuse the existing chart / SVG / CSS approach in `Monitor.tsx`; do not add a charting dependency.
- Draw yellow and red threshold reference lines as dashed baselines on the pass-rate trend chart.
- Label both lines with their configured threshold values so the state is understandable without relying on color.
- Highlight any point below the red threshold and render a `查看失败 Case` drill-down link when the run / case id is available.
- When no trend data exists, keep the empty-state actions and do not render fake points.

**Step 4: Run focused tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/eval-cases.test.tsx src/__tests__/monitor.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add webui/src/pages/eval webui/src/__tests__/eval-cases.test.tsx webui/src/__tests__/monitor.test.tsx
git commit -m "feat(webui): improve quality operations flow"
```

## Task 7: Access Governance Traceability

**Files:**

- Modify: `webui/src/pages/admin/AgentList.tsx`
- Modify: `webui/src/pages/admin/RoleList.tsx`
- Modify: `webui/src/pages/admin/ConfigAudit.tsx`
- Modify: `webui/src/pages/admin/Audit.tsx`
- Test: `webui/src/__tests__/admin-agents.test.tsx`
- Test: `webui/src/__tests__/admin-roles.test.tsx`
- Test: `webui/src/__tests__/admin-config-audit.test.tsx`
- Test: `webui/src/__tests__/admin-audit.test.tsx`

**Step 1: Write failing traceability tests**

Assert:

- Agent rows display `resource scope` and `tool scope` summaries.
- Role rows display how many Agent instances use the role when data exists.
- Config audit rows expose links back to target Agent / Role.
- Audit filters preserve the last selected tab and filter values locally.

**Step 2: Run focused tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/admin-agents.test.tsx src/__tests__/admin-roles.test.tsx src/__tests__/admin-config-audit.test.tsx src/__tests__/admin-audit.test.tsx
```

Expected: FAIL.

**Step 3: Implement traceability links and filter persistence**

Prefer URL query params first. Use localStorage only for non-shareable last-used filter memory.

**Step 4: Run focused tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/admin-agents.test.tsx src/__tests__/admin-roles.test.tsx src/__tests__/admin-config-audit.test.tsx src/__tests__/admin-audit.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add webui/src/pages/admin webui/src/__tests__/admin-agents.test.tsx webui/src/__tests__/admin-roles.test.tsx webui/src/__tests__/admin-config-audit.test.tsx webui/src/__tests__/admin-audit.test.tsx
git commit -m "feat(webui): improve access governance traceability"
```

## Task 8: Documentation, Accessibility, And Full Verification

**Files:**

- Modify: `webui/docs/user-guide.html`
- Modify: `webui/docs/README.md`
- Modify: `webui/docs/plans/README.md`
- Modify: `webui/src/__tests__/lint-terminology-scan.test.ts`
- Modify: `webui/src/__tests__/lint-ia-boundary.test.ts`

**Step 1: Update user-facing docs**

Document the new operating model:

- 运维驾驶舱
- 待处理事项
- 对象详情抽屉
- 变更影响范围
- 质量运营
- Agent / audit traceability

**Step 2: Run terminology and IA lint**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm run lint:ia-boundary
```

Expected: PASS.

**Step 3: Run typecheck, full test, and build**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx tsc --noEmit
npm test
npm run build
```

Expected: PASS.

**Step 4: Manual visual QA**

Start local dev server:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run dev
```

Verify:

- Desktop 2880 x 1800: no overlap, high-density tables remain readable.
- Laptop 1440 x 900: sidebar and object drawer fit.
- Mobile 390 x 844: drawer becomes full-screen; buttons wrap without overflow.
- Professional English terms and identifiers are not browser-translated.

**Step 5: Commit**

```bash
git add webui/docs webui/src
git commit -m "docs(webui): document data agent ops platform ux"
```

## Final Verification Checklist

- [ ] `npm run lint:terminology` passes.
- [ ] `npm run lint:ia-boundary` passes.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Object drawer supports Table, Agent, Eval Run, Audit Event.
- [ ] System Overview shows service health, `待处理事项`, quality snapshot, and access risk.
- [ ] Publish Workbench shows `变更影响范围`.
- [ ] Trend Monitor empty state has next actions and pass-rate charts show yellow / red threshold reference lines.
- [ ] Trend points below the red threshold are highlighted and can drill down to failed cases when data exists.
- [ ] Audit and Config Audit link back to Agent / Role / Table where data exists.
- [ ] `webui/docs/user-guide.html` reflects the new operating model.
