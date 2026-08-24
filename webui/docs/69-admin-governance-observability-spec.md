# Admin Governance Observability Spec

| Metadata | Content |
|---|---|
| Document name | Admin Governance Observability Spec |
| Document type | Product / API / UX Spec |
| Version | v0.2 |
| Written date | 2026-08-03；v0.2 更新 2026-08-03（P2 收敛为只读风险复核候选项与统一 Release Readiness Evidence Package，移除动态隔离超前引用） |
| Related blueprint | `docs/lucy-202608-reliable-delivery-upgrade-spec.md` |
| Related execution control | `docs/lucy-202608-upgrade-execution-control.md` |
| Scope | Admin Audit Trace read model、Agent / Role / Token observability dashboard、risk review candidates、release readiness evidence package |

## 1. Background

`/admin` 已经覆盖 Agent、Role、Token、访问日志与配置审计，但当前体验偏对象管理和明细排查。202608 要把它升级成企业访问治理与可观测工作台：能解释单次访问，也能发现 Agent / Role / Token 层面的趋势和风险。

## 2. Goals

1. Add read-only Trace detail from `/admin/audit`.
2. Add governance observability aggregates for Agent / Role / Token.
3. Generate risk review candidates without changing permissions automatically.
4. Build one bounded release readiness evidence package from current governance facts.
5. Reuse existing Admin IA, PageHeader, metric cards, tables, Drawer, and links.

## 3. Non-goals

- Do not build a full Visual Debugger.
- Do not introduce a new Admin design system.
- Do not auto-remediate Role / Token risks.
- Do not expose raw SQL AST / raw query attack payloads, result rows, full original question, Token plaintext, DB credentials, or customer samples. Compiled **generated SQL** may appear on the audit call log (Spec 125).
- Do not implement SSO / OIDC.

## 4. API Surface

Read-only trace events:

- `GET /api/admin/trace/events?traceId=<id>`
- `GET /api/admin/trace/events?turnId=<id>`

Governance observability:

- `GET /api/admin/governance/overview?hours=24`
- `GET /api/admin/governance/agents?hours=168`
- `GET /api/admin/governance/roles?hours=168`
- `GET /api/admin/governance/tokens?hours=168`
- `GET /api/admin/governance/denials?hours=168`

Risk review:

- `GET /api/admin/governance/risk-review`
- `POST /api/admin/governance/risk-review/:id/review`

Release readiness evidence package:

- `GET /api/admin/governance/release-readiness-package`

## 5. Metrics

| Area | Metrics |
|---|---|
| Agent | calls, denied rate, error rate, p95 latency, active Token count, last seen, top denied reason |
| Role | usage count, denied count, source count, broken Role count, over-broad selector warning |
| Token | last used, revoked attempts, stale count, high-denial Token |
| Denial | top reasons, affected tools, affected sources, trend by day |
| Config | changes by target kind, last change, local-admin notice |

All aggregate payloads must be bounded and must not include raw result rows or unredacted arguments.

## 6. Trace Detail UI

From an audit row, the user can open evidence chain detail.

The detail should show:

- trace id / turn id / request id.
- ordered spans.
- policy decision.
- Role ids and permission snapshot hash.
- evidence refs.
- artifact hashes.
- redacted metadata.

It must not show:

- Token plaintext.
- raw SQL AST / raw query attack payloads（compiled generated SQL is allowed on the call log per Spec 125）.
- raw result rows.
- full original question.
- DB credentials.

## 7. Risk Review Candidate Rules

| Candidate | Trigger | Action |
|---|---|---|
| unused Role | no Agent reference or no usage in review window | warning / review |
| broken Role | preview fails or selector resolves 0 sources | P1 review |
| over-broad Role | prefix selector on sensitive source or broad connection | P1 review |
| stale Token | no usage beyond configured window | P2 review |
| revoked Token attempt | revoked token was used | P0 review |
| high-denial Agent | denial rate above threshold | P1 review |

Review writes optional note / evidence only. It must not mutate `access.yaml`, and this spec does not introduce a remediation lifecycle.

## 8. Release Readiness Evidence Package

The package is the single release readiness export shape. It must not split into audience-specific variants, and it must include only current Agent / Role / Token / ACL / Audit / Eval facts:

- generatedAt.
- access config hash.
- Agent / Role / Token inventory summary.
- denied event summary.
- config change summary.
- security Eval candidate / promoted case summary.
- risk review candidate summary.
- known limitations.

The package must redact sensitive payloads and stay bounded.

## 9. Acceptance Criteria

- Audit row can open trace detail when events exist.
- Trace detail is read-only.
- Governance overview identifies high-denial Agent, stale Token, broken Role.
- Risk review candidate review writes evidence and does not change permissions.
- Release readiness evidence package excludes Token plaintext, raw rows, raw SQL AST, DB credentials, future multi-tenant claims, and Dynamic RLS / CLS references.

## 10. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

Protected terms: `Agent`、`Role`、`Token`、`MCP`、`Trace`、`Evidence`、`Eval`、`ACL`、`SQL AST`、`access.yaml`。
