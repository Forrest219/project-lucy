# Static Lint And Reindex Diagnosis Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Static Lint And Reindex Diagnosis Spec |
| 文档类型 | Product / API / Semantic Tooling Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-03 |
| 关联蓝图 | `docs/lucy-202608-reliable-delivery-upgrade-spec.md` |
| 关联总控 | `docs/lucy-202608-upgrade-execution-control.md` |
| 关联工单 | `webui/docs/plans/wo-202608-02-static-lint-reindex-diagnosis.md` |
| 适用范围 | semantic-layer static lint、Reindex failure diagnosis、patch draft、impact diff |

## 1. Background

Lucy 202608 要把 YAML / semantic-layer 风险拦截在发布前。现有 `semantic-assets` 已有 validate / publish / reindex 能力，本 spec 在其上增加静态 lint 与 Reindex 诊断，不改变 manifest / overlay 写入规则。

## 2. Goals

1. 新增 deterministic static lint engine。
2. Reindex 失败时定位到 connection、source、文件、行号、错误类型和依赖对象。
3. 只生成 patch draft 与 impact diff，不自动写入。
4. Lint / diagnosis 结果写入 Trace / Evidence Kernel。
5. 提供 CLI / WebUI 可复用的 API。

## 3. Non-goals

- 不自动修复 semantic-layer。
- 不调用真实 LLM。
- 不修改 KTX CLI。
- 不替代 `ktx sl validate`。
- 不做新 UI 设计系统；WebUI 展示复用现有 validation panel / diff panel / Drawer。

## 4. Lint Rules

| Rule ID | Severity | Scope | Description |
|---|---|---|---|
| `SL001_GRAIN_MISSING` | P1 | overlay | 有 measure 或 join 的 source 缺少 `grain` |
| `SL002_CYCLIC_JOIN` | P0 | connection | confirmed joins 形成环形路径且无明确 bridge 标记 |
| `SL003_DUPLICATE_DIMENSION_NAME` | P1 | connection | 同 connection 下多个 source 暴露同名维度但 description / expr 冲突 |
| `SL004_MANIFEST_OVERLAY_MIXED` | P0 | manifest | `_schema/*.yaml` 中出现 `grain`、`measures`、`segments`、computed `expr` |
| `SL005_MEASURE_EXPR_RISK` | P1 | overlay | measure expr 包含硬编码部门、租户、财务口径或不透明常量 |
| `SL006_JOIN_TARGET_MISSING` | P0 | overlay / manifest | join target 不存在或未进入当前 connection manifest |

Severity mapping:

- P0 blocks publish gate.
- P1 participates threshold.
- P2 warning only.

## 5. API Contract

### 5.1 `POST /api/semantic-lint`

Request:

```ts
type SemanticLintRequest = {
  connectionId?: string;
  sourceName?: string;
  changedFiles?: string[];
};
```

Response:

```ts
type SemanticLintResponse = {
  ok: boolean;
  traceId: string;
  issues: SemanticLintIssue[];
  summary: { p0: number; p1: number; p2: number };
};
```

### 5.2 `POST /api/semantic-assets/reindex/diagnose`

Request:

```ts
type ReindexDiagnosisRequest = {
  releaseId?: string;
  stdout?: string;
  stderr?: string;
};
```

Response:

```ts
type ReindexDiagnosisResponse = {
  traceId: string;
  failures: ReindexFailure[];
  patchDrafts: PatchDraft[];
  impactDiff: string;
};
```

## 6. Patch Draft Rules

- Patch draft is returned as text and never written automatically.
- Draft must include `requiresOwnerApproval: true`.
- Draft must include `evidenceRefs`.
- Draft must not modify `_schema/*.yaml` except diagnostic comments in output text.
- Draft must not modify `.ktx/secrets/**` or `ktx.yaml`.

## 7. Trace / Evidence Integration

Every lint run writes:

- `trace_events.span_type = "reindex"` or `"publish_gate"` depending caller.
- evidence refs for each YAML node / file hash.
- metadata with rule ids, severity counts, and affected sources.

## 8. Acceptance Criteria

- Lint engine detects manifest / overlay mixed fields using fixture YAML.
- Reindex diagnosis parses common `Unknown column`, missing source, YAML parse, and embedding provider warning cases.
- Patch draft is present only for deterministic safe suggestions.
- No code path writes patch draft to disk.
- WebUI can display the response using existing validation / diff components.

## 9. Self-validation Script

Create:

```text
scripts/verify-202608-static-lint.mjs
```

The script must run fixtures through the lint engine and fail if:

- `_schema` fixture with computed `expr` is not P0.
- missing grain fixture is not P1.
- cyclic join fixture is not P0.
- patch draft contains a write command or target path under `_schema`.

## 10. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

Protected terms: `YAML`、`semantic-layer`、`Manifest`、`Schema`、`KTX`、`Reindex`、`Trace`、`Evidence`、`SQL AST`。
