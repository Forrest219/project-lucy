# Safe Log-to-Eval Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Safe Log-to-Eval Spec |
| 文档类型 | Product / API / Eval Data Contract Spec |
| 版本 | v0.2 |
| 撰写日期 | 2026-08-03；v0.2 更新 2026-08-03（修正 token / secret / api_key 脱敏策略，避免误杀合法安全分析问题） |
| 关联蓝图 | `docs/lucy-202608-reliable-delivery-upgrade-spec.md` |
| 关联总控 | `docs/lucy-202608-upgrade-execution-control.md` |
| 关联工单 | `webui/docs/plans/wo-202608-04-safe-log-to-eval.md` |
| 适用范围 | Eval Candidate Pool、Reviewer Evidence、Formal Eval promotion、redaction、negative case library |

## 1. Background

真实访问日志不是 ground truth。202608 的 Log-to-Eval 只允许从 audit / trace 中生成 candidate，必须经 reviewer evidence 审定后才能转为正式 Eval Case。

## 2. Goals

1. 新增 Eval Candidate Pool。
2. 从 `access_log`、`trace_events`、`evidence_events` 抽取候选问题。
3. 对候选执行去重、脱敏、负样本分类。
4. Reviewer 必须确认 SQL 正确性、结果数据快照、业务口径 / 时间窗口。
5. Promotion 只能生成 draft / preview，正式写入需显式确认。

## 3. Non-goals

- 不把日志直接写入正式 eval YAML。
- 不保存未脱敏原始问题。
- 不让模型自己签名为 reviewer。
- 不做浏览器验证。

## 4. Candidate Data Model

Use existing Eval SQLite path under `.ktx-ui/eval/` and add candidate tables.

```sql
CREATE TABLE IF NOT EXISTS eval_candidate (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_trace_id TEXT,
  source_access_log_id INTEGER,
  normalized_question TEXT NOT NULL,
  question_hash TEXT NOT NULL,
  semantic_route_hash TEXT,
  sql_ast_hash TEXT,
  result_snapshot_hash TEXT,
  risk_tier TEXT NOT NULL,
  status TEXT NOT NULL,
  redaction_status TEXT NOT NULL,
  negative_case_kind TEXT,
  evidence_json TEXT NOT NULL
);
```

```sql
CREATE TABLE IF NOT EXISTS eval_candidate_review (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  reviewer_actor_json TEXT NOT NULL,
  sql_correct INTEGER NOT NULL,
  result_snapshot_confirmed INTEGER NOT NULL,
  business_context_confirmed INTEGER NOT NULL,
  time_window_confirmed INTEGER NOT NULL,
  decision TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
```

## 5. API Contract

- `GET /api/eval/candidates`
- `POST /api/eval/candidates/extract`
- `POST /api/eval/candidates/:id/review`
- `POST /api/eval/candidates/:id/promote/preview`
- `POST /api/eval/candidates/:id/promote`

Promotion must fail unless candidate has accepted reviewer evidence.

## 6. Redaction And Dedup Rules

Redaction fail-closed:

- high-entropy credential string detected -> reject candidate.
- known token / secret / API key signature detected -> reject candidate.
- semantic words or field names such as `token`、`secret`、`api_key` without credential value -> mask if needed and keep as candidate.
- security / metering questions about Token or API key usage -> mark as P0 security candidate, not automatic reject.
- direct personal contact detected -> reject or mask depending configured policy.
- raw result row detected without `DEBUG_SAMPLE` -> reject candidate.

Credential detection must distinguish secret values from business vocabulary. Example allowed candidate topics:

- “统计 API key 调用次数”
- “找出 Token 消耗最高的 Agent”
- “哪些表涉及 secret 字段”

Example rejected input:

- contains a high-entropy Base64 / Hex credential string.
- contains a known bearer token, private key, cloud access key, or signed token format.

Dedup keys:

- `question_hash`
- `semantic_route_hash`
- `sql_ast_hash`
- `result_snapshot_hash`

## 7. Negative Case Library

Unauthorized access logs become negative cases:

- forbidden tool.
- forbidden connection.
- forbidden table / measure.
- cross-department request.

Negative cases must be tagged P0 unless explicitly downgraded by reviewer evidence.

## 8. Trace / Evidence Integration

Candidate extraction writes `eval_run` or `publish_gate` linked trace events depending trigger. Promotion writes evidence relation `promoted`. Rejected candidate writes evidence relation `denied_by` with reviewer decision metadata.

## 9. Acceptance Criteria

- Candidate and Formal Eval Case are physically separated.
- Unreviewed candidate cannot be promoted.
- Reviewer decision requires all four confirmations for P0 / P1.
- Redaction failure prevents candidate insertion.
- Semantic security vocabulary does not cause automatic rejection.
- Negative permission cases can be promoted into security regression suite.

## 10. Self-validation Script

Create:

```text
scripts/verify-202608-safe-log-to-eval.mjs
```

The script must seed temp audit / trace rows and verify:

- high frequency log -> candidate.
- duplicate log -> one candidate.
- high-entropy secret-containing question -> rejected.
- semantic `token` / `api_key` usage question -> P0 security candidate.
- denied tool log -> P0 negative case candidate.
- unreviewed candidate promotion -> fail.
- reviewed candidate promotion preview -> valid YAML diff.

## 11. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

Protected terms: `Eval`、`Candidate Pool`、`Reviewer Evidence`、`Trace`、`Evidence`、`SQL AST`、`Token`、`Agent`、`MCP`。
