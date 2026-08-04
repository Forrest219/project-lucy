# 202608-GOV-02 Admin Governance Observability Dashboard Work Order

> **Scope guardrail** — 本工单是 202608-GOV-02 Dashboard 专项，**只补**：
>
> 1. `server/admin/governance-observability.ts` 五个聚合 API（`/api/admin/governance/{overview,agents,roles,tokens,denials}`）；
> 2. Dashboard UI（`src/pages/admin/GovernanceOverview.tsx` 或现有 Admin 页治理摘要区）；
> 3. 配套 Vitest（server + UI）与 `npm run lint:terminology` / `lint:ia-boundary` 自检。
>
> **不要重做**：Trace Detail Drawer（已在 `wo-202608-01` 落地）、Agent / Role Risk Review（`wo-202608-06`）、Release Readiness Evidence Package（`wo-202608-06`）、Safe Log-to-Security-Eval（`wo-202608-GOV-04`）。
>
> 若发现上述已交付模块的边界问题，请在工单末尾以"已发现但本单不修"列出，**不要顺手改它们**。

## Minimax Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 202608-GOV-02 的未交付部分：Admin Governance Observability Dashboard。

本任务**严格只补** `webui/docs/69-admin-governance-observability-spec.md` §5 的治理聚合 Dashboard（API + UI + 测试）。不要重做已经完成的 Trace Detail、Risk Review Candidates、Release Readiness Evidence Package，也不要实现 Safe Log-to-Security-Eval。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `../docs/lucy-202608-reliable-delivery-upgrade-spec.md`
- `../docs/lucy-202608-upgrade-execution-control.md`
- `docs/00-product-terminology-standard.md`
- `docs/69-admin-governance-observability-spec.md`
- `server/admin/audit.ts`
- `server/admin/agents.ts`
- `server/admin/roles.ts`
- `server/admin/tokens.ts`
- `server/admin/risk-review.ts`
- `server/admin/release-readiness-package.ts`
- `server/observability.ts`
- `src/pages/admin/Audit.tsx`
- `src/pages/admin/AgentList.tsx`
- `src/pages/admin/RoleList.tsx`

开始前记录：

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git status --short
```

## Current State

已完成：

- `/api/admin/trace/events` read-only Trace read model。
- Audit 页面 Trace Drawer / trace link。
- `/api/admin/governance/risk-review`。
- `/api/admin/governance/release-readiness-package`。

未完成：

- `GET /api/admin/governance/overview?hours=24`
- `GET /api/admin/governance/agents?hours=168`
- `GET /api/admin/governance/roles?hours=168`
- `GET /api/admin/governance/tokens?hours=168`
- `GET /api/admin/governance/denials?hours=168`
- Dashboard UI and tests.

## Scope

1. Create or modify server module for governance aggregate APIs.
   - Preferred new file: `server/admin/governance-observability.ts`.
   - Register routes in `server/index.ts`.
2. Create bounded aggregate APIs:
   - `GET /api/admin/governance/overview?hours=24`
   - `GET /api/admin/governance/agents?hours=168`
   - `GET /api/admin/governance/roles?hours=168`
   - `GET /api/admin/governance/tokens?hours=168`
   - `GET /api/admin/governance/denials?hours=168`
3. Aggregate only from current facts:
   - `access_log`
   - `access_log_sources`
   - `revoked_tokens`
   - `config_change_log`
   - current `access.yaml`
   - existing permission preview helpers when needed
4. Add UI using existing Admin IA and components.
   - Preferred new page: `src/pages/admin/GovernanceOverview.tsx`.
   - Or add a governance summary section to existing Admin pages if that is less invasive.
   - Must link to `/admin/audit`, Agent detail, and Role detail where available.
5. Add tests:
   - `server/__tests__/admin-governance-observability.test.ts`
   - `src/__tests__/admin-governance-observability.test.tsx`

## Allowed Files

Expected files (新建):

- `webui/server/admin/governance-observability.ts`
- `webui/server/__tests__/admin-governance-observability.test.ts`
- `webui/src/pages/admin/GovernanceOverview.tsx`（或对 `src/pages/admin/**` 内现有页面做最小侵入式增量）
- `webui/src/__tests__/admin-governance-observability.test.tsx`

May modify (最小化、只为接入本工单):

- `webui/server/index.ts` —— 仅注册本工单新增的五个 `GET /api/admin/governance/*` 路由，不动既有 admin 路由注册。
- 路由调用所必需的 `webui/server/admin/audit.ts` 类型或工具函数引用（只读不改）。

Do not modify（本工单禁止触碰）:

- `webui/server/admin/risk-review.ts`、`webui/server/admin/release-readiness-package.ts`（属 `wo-202608-06`）。
- `webui/server/trace/**`、`webui/server/proxy/audit.ts`、`webui/server/proxy/mcp-proxy.ts`（Trace 事件契约由 GOV-01 锁定）。
- `webui/server/eval/**`（属 `wo-202608-GOV-04`）。
- `webui/src/pages/eval/**`、FDE Copilot、Static Lint 相关 UI。
- `semantic-layer/**`、`.ktx/secrets/**`、生产 `.ktx-ui/audit.sqlite` 与 `.ktx-ui/eval/**`。
- 现有 Admin IA、PageHeader、Drawer、metric card 等通用组件本身（不要顺手重做设计系统）。

## Required Metrics

Server payloads must be bounded and deterministic. Cover at least:

- Agent calls, denied rate, error rate, p95 latency, active Token count, last seen, top denied reason.
- Role usage count, denied count, source count, broken Role count, over-broad selector warning.
- Token last used, stale Token, revoked Token attempts, high-denial Token.
- Denial top reasons, affected tools, affected sources, trend by day.
- Config changes by target kind and local-admin notice.

## Implementation Notes

- Do not expose Token plaintext, raw SQL AST, raw result rows, full original question, DB credentials, customer row samples, or unredacted arguments.
- Do not mutate `access.yaml`.
- Do not create remediation workflows, assignments, due dates, SLA, or automatic cleanup.
- Do not add a new design system. Reuse existing PageHeader, metric cards, tables, Drawer, and Admin navigation conventions.
- Keep API rows bounded. Default max list sizes should be small, e.g. top 10 or top 20.
- If a source table is unavailable in a test fixture, return an empty section plus explicit `unavailable` / `skipped` metadata instead of inventing evidence.
- Existing `/api/r1/observability` is not the target. GOV-02 needs `/api/admin/governance/*` operator-facing aggregates.

## Acceptance Criteria

- Overview API returns aggregate cards for calls, denial rate, error rate, p95 latency, active Token count, stale Token count, high-denial Agent count, broken / over-broad Role count.
- Agent API identifies high-denial Agent and links it to `/admin/audit`.
- Role API identifies unused / broken / over-broad Role without mutating permissions.
- Token API identifies stale Token, revoked Token attempt, and high-denial Token using only redacted / hashed token identifiers.
- Denials API returns reason trends and top affected sources/tools.
- UI renders the dashboard without browser-only validation and does not display raw sensitive payloads.
- Tests prove raw Token / SQL AST / result rows / DB credentials are not returned by any of the five APIs **and** are not rendered into the DOM (assert via `getByText` / `queryByText` 负向断言 + token-format 正则 `^[a-z0-9_-]{6,12}$` 等可机检形态)。

## Out Of Scope (再次强调)

不要在本工单顺手实现以下任何一项：

- Trace Detail Drawer 改动（已完成，`wo-202608-01`）。
- Agent / Role Risk Review 候选（已完成，`wo-202608-06`）。
- Release Readiness Evidence Package（已完成，`wo-202608-06`）。
- Safe Log-to-Security-Eval（`wo-202608-GOV-04`，独立工单）。
- 任何新增的治理任务流、assignee、SLA、自动清理或修复 workflow。

## Verification

WebUI Vitest:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- server/__tests__/admin-governance-observability.test.ts src/__tests__/admin-governance-observability.test.tsx server/__tests__/admin-trace-events.test.ts src/__tests__/admin-audit-trace-link.test.tsx
```

Broader regression:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- server/__tests__/admin-agents.test.ts server/__tests__/admin-roles.test.ts server/__tests__/admin-tokens.test.ts server/__tests__/admin-risk-review.test.ts server/__tests__/admin-release-readiness-package.test.ts
```

Terminology / IA:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm run lint:ia-boundary
```

Browser check: not required.

## Code Review Checklist

- [ ] No raw payload or Token plaintext is returned by the APIs or rendered by UI.
- [ ] No permission mutation or remediation lifecycle was added.
- [ ] Dashboard links to existing `/admin/audit`, Agent, and Role pages.
- [ ] Payloads are bounded and deterministic.
- [ ] This task does not implement Safe Log-to-Security-Eval, FDE Copilot, Static Lint / Reindex, or Dynamic RLS / CLS.
