# FDE Copilot Candidate Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | FDE Copilot Candidate Spec |
| 文档类型 | Product / UX / Semantic Tooling Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-03 |
| 关联蓝图 | `docs/lucy-202608-reliable-delivery-upgrade-spec.md` |
| 关联总控 | `docs/lucy-202608-upgrade-execution-control.md` |
| 关联工单 | `webui/docs/plans/wo-202608-05-fde-copilot-candidate.md` |
| 适用范围 | FDE Copilot 候选补全、证据引用、冲突提示、unverified candidate 隔离区 |

## 1. Background

FDE Copilot 的价值不是自动落库，而是降低人工发现候选维度、measure、join 和冲突的成本。202608 MVP 必须 deterministic-first，真实 LLM 调用不是上线前提。

## 2. Goals

1. 基于 manifest、overlay、历史 SQL 摘要和 audit evidence 生成 candidate。
2. 每条 candidate 必须带 evidence refs、confidence、risk tier、conflict notes。
3. 无足够证据的 candidate 只能进入 `unverified candidate` 隔离区。
4. 只生成 patch draft / diff，不自动写 semantic-layer。
5. UI 复用现有 Table semantic workbench 的辅助维护区域。

## 3. Non-goals

- 不调用真实外部 LLM 作为 MVP 必需项。
- 不自动写入 manifest / overlay。
- 不修改 `_schema/*.yaml`。
- 不替代 FDE / Owner approve。
- 不为 Copilot 设计全新页面。

## 4. Candidate Types

| Type | Example | Required evidence |
|---|---|---|
| `dimension_candidate` | time / region / tenant dimension | manifest column + usage evidence |
| `measure_candidate` | `sum(amount)` | historical SQL pattern + source table evidence |
| `join_candidate` | `orders.customer_id = customers.id` | repeated join pattern + target source exists |
| `segment_candidate` | active rows filter | repeated safe filter + no policy conflict |
| `conflict_warning` | department hardcoded filter conflict | conflicting SQL evidence or policy tag |

## 5. API Contract

- `POST /api/fde-copilot/candidates`
- `POST /api/fde-copilot/candidates/:id/patch-preview`
- `POST /api/fde-copilot/candidates/:id/dismiss`

Patch preview returns diff only. It must never persist semantic-layer changes.

## 6. Evidence Rules

Main recommendation requires:

- at least one `semantic_yaml_node` or manifest source evidence.
- at least one usage / SQL / audit evidence.
- no P0 conflict.

Otherwise candidate is `unverified`.

## 7. UI / UX Rules

- Reuse existing Table semantic workbench layout.
- Candidate list appears as auxiliary panel, not main editing surface.
- Candidate cards use compact rows, no nested cards.
- Patch preview uses existing diff viewer.
- Buttons use existing icon + text conventions.
- Low confidence candidate must show `unverified candidate` and cannot show as primary CTA.

## 8. Trace / Evidence Integration

Every candidate generation writes `trace_events.span_type = "copilot_candidate"` and evidence refs for source files, SQL hash, access log ids or reviewer evidence.

## 9. Acceptance Criteria

- Candidate engine works without network.
- Candidate without evidence is quarantined.
- Patch preview returns diff and does not write files.
- Conflict warning blocks main recommendation.
- Tests prove `_schema/*.yaml` is never a patch target.

## 10. Self-validation Script

Create:

```text
scripts/verify-202608-fde-copilot.mjs
```

The script must verify:

- repeated SQL pattern creates candidate.
- single unproven guess becomes `unverified`.
- P0 policy conflict creates `conflict_warning`.
- patch preview writes no file.
- generated patch target is overlay only.

## 11. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

Protected terms: `FDE Copilot`、`unverified candidate`、`YAML`、`semantic-layer`、`Manifest`、`Schema`、`Trace`、`Evidence`、`SQL AST`。
