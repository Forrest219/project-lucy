# Superstore Eval v1.4 Migration Spec

| Item | Value |
|---|---|
| Document type | Migration spec |
| Date | 2026-06-21 |
| Scope | `evals/superstore/eval/superstore-eval-cases.yaml` only |
| Non-goal | Do not change business expected results unless a failing validation proves drift |
| Status | Revised after builder review; ready for second review |

## 1. Current State

`evals/superstore/eval/superstore-eval-cases.yaml` currently declares:

- `metadata.version: v1.4`
- `metadata.runner_schema_version: v1.3`
- `metadata.runner_schema_note`: v1.3 is retained until case bodies complete v1.4 structural migration
- file-level `safety_contract` already added in v1.4 style
- `quiz_cases` already embedded in the same file
- case bodies have already been statically checked as v1.4-shaped: no `expected_result`, `required_sql_pattern`, or `forbidden_sql_pattern` legacy fields were found in the file

`npm run lint:spec` currently passes with a warning:

```text
evals/superstore/eval/superstore-eval-cases.yaml: runner_schema_version v1.3 is older than v1.4
```

## 2. Objective

Upgrade Superstore eval to `runner_schema_version: v1.4` so that:

1. `npm run lint:spec` no longer warns on Superstore schema version.
2. Superstore and KX Financial eval files use the same current schema version.
3. v1.4 safety contract is fully declared and compatible with the runner.
4. Existing case intent, expected SQL semantics, expected results, quiz linkage, and coverage categories remain unchanged unless explicitly justified.

This is a metadata-only migration unless validation proves otherwise.

## 3. Required Migration Rules

### 3.1 Metadata

Update:

```yaml
metadata:
  runner_schema_version: v1.4
```

Remove `metadata.runner_schema_note` after migration is complete.

Keep existing metadata fields. The list below is not exhaustive; any existing metadata field not named for removal must remain:

- `document_name`
- `document_type`
- `version`
- `written_date`
- `author`
- `requester`
- `based_on`
- `scope`
- `output_path`
- `snapshot_date`
- `snapshot_batch`
- `snapshot_rows`
- `data_source`
- `legacy_migration`

Ensure `metadata.paired_quiz` remains present:

```yaml
paired_quiz:
  path: evals/superstore/superstore-quiz-cases.html
  version: v1.4
```

### 3.2 Safety Contract

Keep file-level v1.4 `safety_contract`:

```yaml
safety_contract:
  readonly: true
  forbid_secret_paths:
    - ".ktx/secrets/"
  forbid_cross_source_join: true
  forbidden_ast:
    - type: forbidden_ast
      value: "UPDATE | DELETE | INSERT | MERGE | DROP | ALTER | TRUNCATE | CREATE"
      reason: eval / fallback 只能只读，不允许 DDL 或 DML。
    - type: forbidden_ast
      value: "cross_source_join"
      reason: 禁止跨数据源 Join；跨源分析必须拆成单源结果后人工解释。
```

Do not weaken this contract. Case-level assertions may add constraints, but must not override or loosen file-level read-only/secrets/cross-source rules.

### 3.3 Case Body Compatibility

No case body rewrite is expected. Static review found no legacy fields requiring conversion. For every item under `cases:`:

- Keep `id` stable.
- Keep `question` / `turns` stable.
- Keep `domain` stable.
- Keep `coverage` or equivalent coverage tagging stable.
- Keep expected business answer/result stable.
- Keep SQL lineage and safety assertions stable.
- Do not delete legacy fields until they have an equivalent v1.4 field.
- Do not change `result_assertions`, `sql_assertions`, `context_assertions`, or expected values.
- Do not reorder or rewrite cases unless a parser requires purely mechanical formatting.

The mapping below is a regression guard only. It should not trigger any edit in the current file. If a builder finds a legacy field that contradicts the current static review, stop and report it before editing case bodies.

Legacy mapping for unexpected findings:

| Legacy field | v1.4 target |
|---|---|
| `expected_result` scalar | `result_assertions: [{ value_type: scalar, compare_mode: exact/approx, data: ... }]` |
| `expected_result` dataframe/list | `result_assertions: [{ value_type: dataframe, compare_mode: unordered_rows/subset/exact, data: ... }]` |
| SQL pattern checks | `sql_assertions` with `required_ast`, `forbidden_ast`, `measure_lineage`, or normalized matcher assertions such as `required_normalized_regex` |
| Required context/provenance checks | `context_assertions` |
| Linked quiz ids | `linked_quiz_questions` |

### 3.4 Quiz Linkage

For each `quiz_cases[].eval_refs` entry:

- The referenced eval case id must exist under `cases:`.
- Do not change quiz answers during schema migration.
- If an eval case has `linked_quiz_questions`, each referenced quiz id must exist under `quiz_cases:`.

This migration does not require an automated quiz-link checker. Builder must perform a targeted manual/static check and record the result. Current review sampled links as self-consistent; the migration must not touch quiz fields.

### 3.5 Coverage Matrix

If Superstore has a `metadata.coverage_matrix` or equivalent grouping:

- Ensure every listed case id exists.
- Ensure every case id appears in at least one meaningful coverage grouping, unless explicitly marked as auxiliary.

If no coverage matrix exists, do not invent a large taxonomy in this migration. Add only minimal metadata needed for v1.4 compatibility.

## 4. Validation Requirements

Builder must run:

```bash
npm run lint:spec
```

Expected:

- No Superstore `runner_schema_version` warning in the `eval-schema-version` section.
- `eval-schema-version` PASS.
- The disabled legacy wildcard `lisi` warning may remain.
- If full-repo `lint:spec` fails for a reason unrelated to this migration, do not change Superstore eval to hide that failure; report the unrelated failure separately.

Builder should also run:

```bash
npm run eval:list
```

Expected:

- Superstore cases still parse/list.
- Superstore `cases:` count remains 17. This count excludes `quiz_cases`.
- Case ids remain stable.

Do not run full model eval for this migration unless explicitly requested:

- Allowed: `npm run eval:list`
- Not allowed by default: `npm run eval`

If runner supports a dry/contract validation mode, run it against Superstore before changing expected values. Expected values should not change in this migration.

## 5. Acceptance Criteria

1. `metadata.runner_schema_version` is `v1.4`.
2. `metadata.runner_schema_note` is removed.
3. `safety_contract` remains present and unchanged or stricter.
4. `metadata.paired_quiz` remains present.
5. Existing metadata fields such as `based_on` and `legacy_migration` remain unless explicitly justified.
6. All quiz `eval_refs` resolve to existing case ids by targeted static/manual check.
7. All 17 `cases:` ids are preserved.
8. No `cases:` or `quiz_cases:` expected business values change.
9. `npm run lint:spec` has no Superstore `runner_schema_version v1.3 is older than v1.4` warning in the `eval-schema-version` section; if full-repo lint exits non-zero for an unrelated failure, report it separately and do not make out-of-scope changes for this migration.
10. `npm run eval:list` exits 0 and reports the same 17 Superstore eval cases.

## 6. Out of Scope

- Recomputing ground truth.
- Changing Superstore semantic-layer definitions.
- Changing quiz answers or explanations.
- Running full model eval.
- Editing KX Financial eval cases.
- Removing `lisi` from `webui/config/access.yaml`.
