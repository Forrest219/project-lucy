# Safe Log-to-Security-Eval Spec

| Metadata | Content |
|---|---|
| Document name | Safe Log-to-Security-Eval Spec |
| Document type | Product / API / Security Eval Data Contract Spec |
| Version | v0.3 |
| Written date | 2026-08-03；v0.3 更新 2026-08-03（从通用 Log-to-Eval 收窄为权限 / 安全负样本闭环） |
| Related blueprint | `docs/lucy-202608-reliable-delivery-upgrade-spec.md` |
| Related execution control | `docs/lucy-202608-upgrade-execution-control.md` |
| Related work order | `webui/docs/plans/wo-202608-04-safe-log-to-eval.md` |
| Scope | Security Candidate Pool、denied / forbidden logs、Reviewer Evidence、P0 negative Eval promotion、redaction |

## 1. Background

真实访问日志不是 ground truth，但 denied / forbidden / raw query / sensitive metadata 事件是企业访问治理最有价值的安全回归来源。202608 不做通用业务质量 Log-to-Eval，只做 Safe Log-to-Security-Eval。

## 2. Goals

1. Add Security Candidate Pool physically separated from Formal Eval Case.
2. Extract candidates from denied / forbidden / raw query / sensitive metadata access logs and linked Trace / Evidence events.
3. Redact or reject sensitive payloads fail-closed.
4. Reviewer must approve before promotion to formal P0 security Eval.
5. Promotion produces preview / diff first; durable write requires explicit confirmation.

## 3. Non-goals

- Do not convert all user questions into Eval.
- Do not save unredacted original questions.
- Do not let model output count as reviewer evidence.
- Do not use unreviewed candidates in Gate.
- Do not implement FDE quality flywheel.

## 4. Candidate Sources

| Source | Candidate tier | Example reason |
|---|---|---|
| `outcome = denied` + `tool_forbidden_global` | P0 | forbidden tool regression |
| `table_forbidden:*` | P0 | unauthorized table |
| `unknown_or_forbidden_connection:*` | P0 | unauthorized connection |
| `raw_query_forbidden` | P0 | raw SQL path attempt |
| `sensitive_metadata_forbidden:*` | P0 | sensitive metadata exposure attempt |
| repeated permission-related upstream errors | P1 | likely config / source mismatch |
| reviewer-marked suspicious successful access | P1 / P0 | requires human classification |

## 5. Data Model

Use existing Eval SQLite path under `.ktx-ui/eval/` and add security candidate tables.

```sql
CREATE TABLE IF NOT EXISTS security_eval_candidate (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_trace_id TEXT,
  source_access_log_id INTEGER,
  normalized_event TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  decision_reason TEXT NOT NULL,
  tool TEXT,
  user_id TEXT,
  token_hash_prefix TEXT,
  role_ids_json TEXT NOT NULL DEFAULT '[]',
  table_refs_json TEXT NOT NULL DEFAULT '[]',
  risk_tier TEXT NOT NULL,
  status TEXT NOT NULL,
  redaction_status TEXT NOT NULL,
  evidence_json TEXT NOT NULL
);
```

```sql
CREATE TABLE IF NOT EXISTS security_eval_candidate_review (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  reviewer_actor_json TEXT NOT NULL,
  permission_boundary_confirmed INTEGER NOT NULL,
  expected_denial_confirmed INTEGER NOT NULL,
  business_context_confirmed INTEGER NOT NULL,
  decision TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
```

## 6. API Contract

- `GET /api/eval/security-candidates`
- `POST /api/eval/security-candidates/extract`
- `POST /api/eval/security-candidates/:id/review`
- `POST /api/eval/security-candidates/:id/promote/preview`
- `POST /api/eval/security-candidates/:id/promote`

Promotion must fail unless candidate has accepted reviewer evidence.

## 7. Redaction Rules

Redaction is fail-closed:

- high-entropy credential string detected -> reject candidate.
- known token / secret / API key signature detected -> reject candidate.
- semantic words or field names such as `token`、`secret`、`api_key` without credential value -> keep candidate, mask if needed.
- security / metering questions about Token or API key usage -> P0 security candidate, not automatic reject.
- raw result row detected without explicit debug sample policy -> reject candidate.

## 8. Trace / Evidence Integration

Candidate extraction writes or links:

- `trace_events.span_type = "eval_run"` with `metadata.gateKind = "security_eval_candidate_extraction"`.
- Evidence refs for access log row, policy decision, permission snapshot, Role ids, and source refs.
- Promotion writes `evidence_events.relation = "promoted"`.
- Rejection writes `evidence_events.relation = "denied_by"`.

## 9. Acceptance Criteria

- Candidate and Formal Eval Case are physically separated.
- Denied tool / table / connection / raw query logs become P0 candidates.
- High-entropy credential payload is rejected.
- Semantic Token / API key usage language is retained as security candidate.
- Unreviewed candidate promotion fails.
- Reviewed candidate promotion preview produces a formal Eval diff.

## 10. Self-validation Script

Create:

```text
scripts/verify-202608-safe-log-to-security-eval.mjs
```

The script must verify:

1. denied tool log -> P0 candidate.
2. forbidden table log -> P0 candidate.
3. high-entropy secret -> rejected.
4. semantic Token / API key usage -> retained.
5. duplicate event -> single candidate.
6. unreviewed promotion -> fail.
7. reviewed promotion preview -> valid P0 security Eval diff.

## 11. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

Protected terms: `Eval`、`Trace`、`Evidence`、`Token`、`Role`、`Agent`、`MCP`、`ACL`、`SQL AST`。

