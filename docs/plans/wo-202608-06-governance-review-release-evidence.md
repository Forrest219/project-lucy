# 202608-GOV-06 Governance Review And Release Evidence Work Order

## MiniMax Code Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy` 中实现 `202608-GOV-06`：P2 Governance Review And Release Evidence。

本任务只基于 Lucy 当前已经存在的 Agent / Role / Token / ACL / Audit / Eval 事实源，交付只读风险复核候选项和唯一版本的 Release Readiness Evidence Package。不要引入未来多租户、Dynamic RLS / CLS、客户版 / 内部版分叉，或自动权限修复流程。

必须先阅读：

- `docs/DEVELOPMENT.md`
- `docs/lucy-202608-reliable-delivery-upgrade-spec.md`
- `docs/lucy-202608-upgrade-execution-control.md`
- `docs/lucy-202608-access-governance-gap-analysis.md`
- `docs/plans/2026-08-03-lucy-enterprise-data-agent-access-governance-plan.md` Task 6 / 7
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/69-admin-governance-observability-spec.md`
- `webui/server/admin/agents.ts`
- `webui/server/admin/roles.ts`
- `webui/server/admin/tokens.ts`
- `webui/server/admin/audit.ts`
- `webui/server/access-governance-gate.ts`

开始前记录：

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git status --short
```

## Scope

### P2-A: Agent / Role Risk Review Candidates

实现只读风险复核候选项生成。

Candidate rules:

| Candidate | Trigger | Severity | Notes |
|---|---|---|---|
| unused Role | Role has no Agent reference, or has no observed usage in review window when usage data exists | P2 | Must not delete or disable Role |
| broken Role | existing preview / selector resolution fails, or selector resolves zero sources | P1 | Use existing preview helpers where available |
| over-broad Role | existing access classification shows sensitive source exposure or broad connection selector | P1 | Do not invent new sensitivity taxonomy |
| stale Token | Token has no usage beyond configured review window | P2 | Use hashed / redacted Token identifiers only |
| revoked Token attempt | revoked Token appears in denied / rejected access records | P0 | Evidence only, no mutation |
| high-denial Agent | Agent denial rate exceeds configured threshold in review window | P1 | Link to Audit evidence where possible |

Required behavior:

1. Create `webui/server/admin/risk-review.ts`.
2. Create `webui/server/__tests__/admin-risk-review.test.ts`.
3. Register `GET /api/admin/governance/risk-review`.
4. Optionally register `POST /api/admin/governance/risk-review/:id/review` if the existing Trace / Evidence helper can store reviewer note evidence safely.
5. Review writes optional note / evidence only.
6. Do not auto-change `access.yaml`.
7. Do not implement remediation lifecycle, assignment, SLA, due date, workflow state machine, or automatic cleanup.
8. Link candidates to Agent / Role / Token / Audit / Trace references when the underlying data exists.
9. Keep payload bounded and deterministic.

### P2-B: Release Readiness Evidence Package

实现唯一版本的 Release Readiness Evidence Package。

Required behavior:

1. Create `webui/server/admin/release-readiness-package.ts`.
2. Create `webui/server/__tests__/admin-release-readiness-package.test.ts`.
3. Register `GET /api/admin/governance/release-readiness-package`.
4. Generate `inbox/202608-governance-release-readiness.md` from the same package shape or a dedicated verifier script if that pattern is cleaner.
5. The package must include:
   - `generatedAt`.
   - access config hash.
   - Agent / Role / Token inventory summary.
   - denied event summary and top denial reasons.
   - config change summary.
   - security Eval candidate / promoted case summary when available.
   - risk review candidate summary.
   - known limitations.
6. There is only one package shape. Do not split audience-specific variants.
7. Use only current Agent / Role / Token / ACL / Audit / Eval facts.
8. The package must not include Dynamic RLS / CLS evidence, tenant isolation claims, future multi-tenant claims, Token plaintext, raw result rows, raw SQL AST, full original question, DB credentials, or customer row samples.

## Allowed Files

Prefer narrow changes. Expected files:

- `webui/server/admin/risk-review.ts`
- `webui/server/admin/release-readiness-package.ts`
- `webui/server/__tests__/admin-risk-review.test.ts`
- `webui/server/__tests__/admin-release-readiness-package.test.ts`
- Existing admin route registration file(s), only if needed.
- `inbox/202608-governance-release-readiness.md`
- Minimal docs index update only if route names or file names differ from this work order.

Do not modify:

- `webui/config/access.yaml` except in isolated test fixtures.
- `.ktx/secrets/**`.
- production `.ktx-ui/audit.sqlite`.
- semantic-layer files.
- Dynamic RLS / CLS specs, scripts, or any `scripts/rls-poc/**` path.

## Implementation Notes

- Reuse existing Admin / ACL / Audit helper APIs and local types before adding new abstractions.
- Use hashed or redacted Token identifiers only.
- If an optional source is unavailable, return an empty bounded section plus an `unavailable` / `skipped` note; do not invent evidence.
- Review candidate IDs must be deterministic for stable tests.
- Treat SQLite test DBs as isolated: `:memory:` or unique temp paths only.
- Browser / mobile tests are not required for this task.

## Verification

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- server/__tests__/admin-risk-review.test.ts server/__tests__/admin-release-readiness-package.test.ts
```

Then run from repo root:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
npm run lint:terminology
npm run lint:spec
```

If lint failures are pre-existing and unrelated, report the exact file / rule.

## Acceptance Criteria

- Risk review API returns unused Role, broken Role, stale Token, revoked Token attempt, and high-denial Agent candidates from controlled test fixtures.
- Risk review never mutates `access.yaml`.
- Optional review evidence writes are append-only and contain no sensitive payloads.
- Release readiness package returns one bounded package shape with current governance facts only.
- Package excludes Token plaintext, raw rows, raw SQL AST, full original question, DB credentials, customer row samples, Dynamic RLS / CLS evidence, and future multi-tenant claims.
- Tests pass with isolated DB fixtures.
- Browser check: not required.

## Code Review Checklist

- [ ] No Dynamic RLS / CLS, tenant isolation, or multi-tenant POC code was added.
- [ ] No internal/customer package split was added.
- [ ] No remediation lifecycle or automatic permission cleanup was added.
- [ ] No raw sensitive payload can enter package or reviewer evidence.
- [ ] All risk candidates link to real existing facts or explicitly mark unavailable evidence.
- [ ] Verification commands pass or document unrelated pre-existing failures.
