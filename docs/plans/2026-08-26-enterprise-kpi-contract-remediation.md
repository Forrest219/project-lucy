# Enterprise KPI Contract Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every Lucy KPI name, value, formula, source, time window, data-quality state, and help annotation mutually consistent, with no fabricated zeroes or cross-page population drift.

**Architecture:** Introduce one typed KPI contract registry in `webui/src/lib/kpiContracts.ts` for stable metric identity and explanatory metadata, while keeping numeric aggregation in the authoritative server/domain module. Every dynamic API metric returns an explicit `ok | no_data | unavailable | partial` state plus `asOf`, window, and formula version; the shared card renders only `ok` values as numbers. Formula contract tests pin boundary conditions and cross-page equivalence before UI copy is updated.

**Tech Stack:** TypeScript, React 19, Fastify, SQLite, TanStack Query, Radix Tooltip, Vitest, Testing Library.

---

## Design decision

Use the shared-contract approach.

- Reject copy-only remediation: it can describe current defects but cannot prevent a later formula drift.
- Reject backend-only remediation: a correct API can still be rendered as `0` when loading or unavailable.
- Adopt shared metric identity + server-owned calculation + status-aware rendering. Do not put executable SQL in the frontend registry and do not let frontend code recompute authoritative server metrics.

Each governed metric must have:

```ts
type MetricState = "ok" | "no_data" | "unavailable" | "partial";

type MetricContract = {
  id: string;
  label: string;
  unit: "count" | "percent" | "milliseconds" | "ratio" | "status";
  formulaVersion: string;
  source: string[];
  window: "point_in_time" | "24h_or_7d" | "7d" | "7d_30d_90d" | "30d";
  formula: string;
  includes: string[];
  excludes: string[];
  emptyMeaning: string;
};

type MetricResult<T> = {
  metricId: string;
  value: T | null;
  state: MetricState;
  asOf: string;
  windowStart?: string;
  windowEnd?: string;
  formulaVersion: string;
  unavailableReason?: string;
};
```

Hard rules:

1. `unavailable` and `partial` must never be converted to numeric zero.
2. `no_data` may display `—`, but only after a successful query proves the selected population is empty.
3. A percentage may render only when numerator and denominator use the same population and the denominator is known and finite.
4. Time comparisons use one canonical ISO-8601 UTC representation or numeric epoch; never compare ISO `T` timestamps to SQLite `datetime()` text.
5. Help text is generated from the same `MetricContract` used by tests; page-local prose may add context but may not redefine the formula.
6. Cross-page metrics sharing a `metricId` must share formula version and produce equal results for the same window and snapshot.

## Required formula decisions

| Metric | Corrected contract |
|---|---|
| Overview evaluation runs | Rename/value as `近 30 天评测运行` and count all `status='succeeded'` runs with `started_at >= windowStart`; do not use `limit=1` as the count. |
| Agent 7-day metrics | Use `ts >= :windowStartIso AND ts < :windowEndIso` with the same server-generated bounds as Governance. |
| Active Token | Canonical identity is full configured token hash internally; audit aggregation may expose only a prefix but must detect ambiguity. Count distinct active tokens globally for the KPI; per-Agent breakdown remains a separate dimension. |
| Latest Run pass rate | Latest **succeeded** run only. If a newer run is running/failed, expose its status separately and do not overwrite the completed KPI. Formula is `PASS / total_cases`, with SKIP explicitly included in the denominator. |
| Trend pass rate | Use the same denominator as Latest Run: `SUM(pass_count) / SUM(total_cases)` for succeeded runs. If the product instead chooses PASS/(PASS+FAIL), assign a different label and metricId; never reuse “通过率”. |
| Top failures | Include only `status='succeeded'` runs in the selected domain/window. Value card label becomes `Top 失败用例数`, and the help states the configured limit. |
| Active table rate | Do not calculate against an open-ended or incomplete denominator. State is `unavailable` with reason `open_ended_scope` until the authorized universe is resolved against the current catalog. When resolvable, use `active authorized tables / resolved authorized tables`. |
| Calls/P95 | Count the same successful audit query result and expose source availability. P95 is computed over all included Proxy call rows with non-null `duration_ms`; help lists included outcomes/tools. |
| Overview ACL denials | Count the authoritative audit population directly, not a sum of per-Agent fallback statistics. Help explicitly states whether authentication failures are excluded. |

### Task 1: Lock the metric inventory and contract schema

**Files:**
- Create: `webui/src/lib/kpiContracts.ts`
- Create: `webui/src/__tests__/kpi-contracts.test.ts`
- Modify: `webui/docs/design-system/12-components-metric-card.md`
- Modify: `webui/docs/103-list-page-kpi-metric-card-unification-spec.md`
- Modify: `webui/docs/102-overview-quality-risk-metric-row-unification-spec.md`

**Step 1: Write failing registry tests**

Assert that every KPI inventoried in `inbox/20260826-1240-webui-kpi-card-audit.md` has a unique id and non-empty `label`, `source`, `formula`, `formulaVersion`, `includes`, `excludes`, and `emptyMeaning`. Assert that percentage contracts declare a denominator and that every windowed metric declares a window.

**Step 2: Run the test and verify it fails**

Run: `cd webui && npx vitest run src/__tests__/kpi-contracts.test.ts`

Expected: FAIL because the registry does not exist.

**Step 3: Implement the minimal registry**

Create the types shown above and register all List KPI and Overview Ops metrics. Treat Agent/Role detail permission summaries as `summary` contracts, not List KPI contracts, so Spec 103 scope remains accurate.

**Step 4: Update normative documentation**

Add the four-state rule, the no-fabricated-zero rule, source/as-of requirements, and the distinction between KPI and permission summary. Keep visual rules in the design system and formula truth in the registry/domain specs.

**Step 5: Verify**

Run:

```bash
cd webui
npx vitest run src/__tests__/kpi-contracts.test.ts
npm run lint:terminology
```

Expected: PASS.

### Task 2: Add status-aware MetricCard rendering

**Files:**
- Modify: `webui/src/components/MetricCard.tsx`
- Modify: `webui/src/__tests__/admin-governance-observability.test.tsx`
- Modify: `webui/src/__tests__/monitor.test.tsx`
- Modify: `webui/src/__tests__/eval-cases.test.tsx`
- Create: `webui/src/__tests__/metric-card.test.tsx`

**Step 1: Write failing component tests**

Cover:

- `ok` renders the supplied value.
- `no_data` renders `—` and “所选范围内无数据”.
- `unavailable` renders `—` and “数据源不可用”, never `0`.
- `partial` renders `—` or a clearly marked partial value and a persistent warning.
- `aria-label` includes metric label and state.
- Help content accepts `ReactNode` so `Schema`, `Manifest`, paths, config keys, Agent, Token, Role, Case, and Run can use `notranslate` markup.

**Step 2: Run and verify failure**

Run: `cd webui && npx vitest run src/__tests__/metric-card.test.tsx`

Expected: FAIL because MetricCard has no state contract and help accepts only `string`.

**Step 3: Implement minimal rendering**

Add `state`, `unavailableReason`, and `asOf` props. Centralize value-state rendering inside `MetricCard`; pages must not use `?? 0` for dynamic metrics.

**Step 4: Verify**

Run the four focused component suites. Expected: PASS with explicit state assertions.

### Task 3: Correct Agent and Governance time windows

**Files:**
- Modify: `webui/server/admin/agents.ts`
- Modify: `webui/server/admin/governance-observability.ts`
- Create: `webui/server/admin/metric-window.ts`
- Modify: `webui/server/__tests__/admin-agents.test.ts`
- Modify: `webui/server/__tests__/admin-governance-observability.test.ts`

**Step 1: Write boundary tests**

Freeze time and insert audit rows at `windowStart - 1ms`, `windowStart`, `windowEnd - 1ms`, and `windowEnd`. Assert Agent and Governance return identical 7-day call, active-Agent, and active-Token results.

Also add a regression fixture whose timestamp contains `T` and `Z`; it must not be admitted merely because SQLite `datetime()` uses a space.

**Step 2: Verify the tests fail**

Run:

```bash
cd webui
npx vitest run server/__tests__/admin-agents.test.ts server/__tests__/admin-governance-observability.test.ts
```

Expected: boundary/equivalence assertions FAIL against the current mixed timestamp comparison.

**Step 3: Implement one window helper**

Generate `{ startIso, endIso, asOf }` once per request. Pass both bounds into all SQL with `ts >= ? AND ts < ?`. Remove `datetime('now','-7 days')` from KPI queries.

**Step 4: Remove silent zero fallback**

Return `MetricResult` with `state='unavailable'` and a safe reason code when the audit database cannot be queried. Preserve successful zero as `state='ok', value=0`.

**Step 5: Verify**

Expected: all boundary and cross-page equivalence tests PASS.

### Task 4: Correct the Overview 30-day evaluation KPI

**Files:**
- Modify: `webui/server/eval/runner.ts`
- Modify: `webui/src/pages/Onboarding.tsx`
- Modify: `webui/src/lib/opsDashboard.ts`
- Modify: `webui/server/__tests__/eval-runs.test.ts`
- Modify: `webui/src/__tests__/onboarding.test.tsx`
- Modify: `webui/src/__tests__/ops-dashboard.test.ts`
- Modify: `docs/SYSTEM_HANDBOOK.md`

**Step 1: Write failing API tests**

Add a bounded query contract such as `GET /api/eval/runs/summary?days=30` returning:

```ts
{
  runCount: MetricResult<number>;
  latestSucceededRunAt: string | null;
}
```

Seed succeeded runs at 29 and 31 days, plus a recent running run. Assert only the 29-day succeeded run counts.

**Step 2: Write failing UI tests**

Assert the card says `近 30 天评测运行`, displays the real count, and renders unavailable instead of zero on API failure. Assert the action-required eval gap appears only when a successful query returns count 0.

**Step 3: Implement the bounded aggregate**

Use explicit start/end ISO bounds and `status='succeeded'`. Remove `/api/eval/runs?limit=1` from Overview.

**Step 4: Correct documentation**

Delete the handbook’s known-limitation wording and replace it with the exact status/window/source contract.

**Step 5: Verify**

Run the three focused test files. Expected: PASS for 29/30/31-day boundaries, running/failed exclusion, and unavailable state.

### Task 5: Unify evaluation populations and denominators

**Files:**
- Modify: `webui/server/eval/runner.ts`
- Modify: `webui/server/eval/monitor.ts`
- Modify: `webui/src/pages/eval/CaseList.tsx`
- Modify: `webui/src/pages/eval/Monitor.tsx`
- Modify: `webui/server/__tests__/eval-runs.test.ts`
- Modify: `webui/src/__tests__/eval-cases.test.tsx`
- Modify: `webui/src/__tests__/monitor.test.tsx`

**Step 1: Write failing population tests**

Seed one succeeded run with PASS/FAIL/SKIP, one newer running run, and one failed run. Assert:

- Latest Run KPI selects the succeeded run.
- Latest and trend pass rates both use `pass_count / total_cases`.
- Top failures includes only cases from succeeded runs.
- Empty and failed data-source states are distinguishable.

**Step 2: Verify current failure**

Expected: latest-run status, denominator-equivalence, and Top-failure population tests FAIL.

**Step 3: Implement authoritative queries**

Add a succeeded-only latest-run query. Change trend aggregation to `SUM(pass_count) / SUM(total_cases)`. Add `er.status='succeeded'` to Top failures. Return the configured Top-N limit as metadata.

**Step 4: Update labels/help from the registry**

Use `最近完成 Run 通过率`, `最近完成 Run 失败数`, and `Top 失败用例数`. Explicitly state that SKIP remains in `total_cases`.

**Step 5: Verify**

Run the three focused suites. Expected: PASS, including cross-page formula-version equality.

### Task 6: Make active-table coverage mathematically valid

**Files:**
- Modify: `webui/server/admin/governance-observability.ts`
- Modify: `webui/src/pages/admin/GovernanceOverview.tsx`
- Modify: `webui/server/__tests__/admin-governance-observability.test.ts`
- Modify: `webui/src/__tests__/admin-governance-observability.test.tsx`

**Step 1: Write failing tests**

Cover explicit table scopes, prefix scopes, wildcard scopes, removed authorization, and historical access outside the current authorized set. Assert no rendered percentage can exceed 100%.

**Step 2: Implement resolved authorization universe**

For explicit scopes, intersect the current authorized table set with the current catalog and count active members of that same set. For prefix/wildcard scopes, resolve against the catalog; if the catalog is unavailable or incomplete, return `state='unavailable'` or `partial` instead of a percentage.

**Step 3: Update annotation**

Replace “配置授权与访问日志并集口径” with explicit numerator, denominator, catalog snapshot, and open-ended-scope behavior.

**Step 4: Verify**

Expected: 0–100% invariant and unavailable/partial cases PASS.

### Task 7: Correct calls, latency, ACL, and source failure semantics

**Files:**
- Modify: `webui/server/admin/governance-observability.ts`
- Modify: `webui/src/pages/admin/GovernanceOverview.tsx`
- Modify: `webui/src/pages/Onboarding.tsx`
- Modify: `webui/server/__tests__/admin-governance-observability.test.ts`
- Modify: `webui/src/__tests__/admin-governance-observability.test.tsx`
- Modify: `webui/src/__tests__/onboarding.test.tsx`

**Step 1: Write failing failure-injection tests**

Force audit DB open/query errors independently for calls, P95, active counts, and denials. Assert the API returns unavailable with a reason code and the UI never renders a healthy zero.

**Step 2: Pin populations**

Define whether calls include all Proxy access-log rows or only tool calls; choose one and encode it in SQL and the contract. Compute P95 over the same declared population with non-null duration. Query ACL denials directly from the audit source, with authentication failures explicitly included or excluded under a separate metricId.

**Step 3: Implement and verify**

Expected: failure-injection, zero-data, and mixed-outcome tests PASS; UI values and help use the same metricId/formulaVersion.

### Task 8: Repair terminology, detail summaries, and the broken test contract

**Files:**
- Modify: `webui/src/pages/connections/constants.ts`
- Modify: `webui/src/pages/admin/RoleList.tsx`
- Modify: `webui/src/pages/admin/AgentDetail.tsx`
- Modify: `webui/src/pages/admin/RoleDetail.tsx`
- Modify: `webui/src/pages/eval/CaseList.tsx`
- Modify: `webui/src/pages/eval/Monitor.tsx`
- Modify: `webui/src/__tests__/agent-list.test.tsx`
- Modify: `webui/scripts/lint-terminology.mjs`

**Step 1: Extend terminology coverage**

Add tests/lint rules for KPI labels and registry entries, including lowercase `token`, lowercase `case`, `Top failures`, config keys, paths, and unprotected professional English DOM text.

**Step 2: Fix help rendering**

Use ReactNode help fragments with `notranslate` wrappers. Keep Agent/Role detail blocks named and styled as `权限摘要`; do not claim they violate List KPI Spec 103.

**Step 3: Repair AgentList test mocks**

Update GET mocks to accept `fetch(path, { credentials: 'same-origin' })`; preserve assertions for real API failure states.

**Step 4: Verify**

Run:

```bash
cd webui
npx vitest run src/__tests__/agent-list.test.tsx src/__tests__/kpi-contracts.test.ts src/__tests__/metric-card.test.tsx
npm run lint:terminology
```

Expected: PASS with no mock-contract failures.

### Task 9: Full regression and enterprise acceptance evidence

**Files:**
- Modify: `inbox/20260826-1240-webui-kpi-card-audit.md`
- Create: `inbox/20260826-enterprise-kpi-remediation-verification.md`

**Step 1: Run automated gates**

Run:

```bash
cd webui
npm test
npm run build
```

Expected: all tests, terminology lint, IA boundary lint, and build exit 0.

**Step 2: Run formula invariants**

Required assertions:

- Same metricId + same window + same snapshot => equal value across pages.
- `unavailable !== 0`, `partial !== ok`, and `no_data` follows a successful query.
- Every percentage is between 0 and 100 inclusive.
- Every window has tested inclusive/exclusive boundaries.
- Latest metrics exclude running/failed records unless the label explicitly says otherwise.
- Displayed formulaVersion matches the API result and registry.

**Step 3: Perform approved browser acceptance**

Only after automated gates pass, verify `/overview`, `/connections`, `/admin/governance/overview`, `/admin/agents`, `/admin/roles`, `/eval/cases/:domain`, and `/eval/monitor` for loading, zero, no-data, partial, unavailable, and normal states. Do not fabricate fixture values in production data; use isolated test fixtures or API mocks.

**Step 4: Update the audit conclusion**

Replace the previous “aligned” summary with evidence-backed per-metric status. Enterprise sign-off requires all P0/P1 formula and state gates green; visual tooltip presence alone is insufficient.

## Release sequencing

1. Release gate A: Tasks 1–3 — contract, state model, canonical time windows.
2. Release gate B: Tasks 4–7 — formula corrections and authoritative sources.
3. Release gate C: Task 8 — terminology and test contract cleanup.
4. Release gate D: Task 9 — full verification and audit sign-off.

Do not partially ship corrected labels ahead of formulas, or corrected formulas ahead of unavailable-state rendering. Each metric must migrate atomically as `contract + calculation + API state + UI + help + tests`.

## Definition of done

- No KPI value is synthesized from `undefined`, query failure, or loading state.
- Every KPI has a stable id, formula version, authoritative source, window, and explicit empty/error semantics.
- Cross-page shared metrics pass equality tests.
- All percentages have a valid, same-population denominator and cannot exceed 100%.
- Existing known limitations about false labels are removed because the implementation is corrected, not merely documented.
- Targeted and full automated suites pass; browser acceptance is performed only when explicitly approved.

