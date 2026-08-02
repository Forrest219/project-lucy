# Lucy 202608 Dynamic RLS POC Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 202608 Dynamic RLS POC Spec |
| 文档类型 | Security Architecture / POC Spec |
| 版本 | v0.2 |
| 撰写日期 | 2026-08-03；v0.2 更新 2026-08-03（明确 POC 可在 Wave B 并行执行） |
| 关联蓝图 | `docs/lucy-202608-reliable-delivery-upgrade-spec.md` |
| 关联总控 | `docs/lucy-202608-upgrade-execution-control.md` |
| 关联工单 | `docs/plans/wo-202608-06-dynamic-rls-poc.md` |
| 适用范围 | `tenant_id` Dynamic RLS / CLS POC、安全边界、失败标准 |

## 1. Positioning

202608 只做 Dynamic RLS / CLS 安全设计与 POC，不承诺 GA。POC 的成功标准不是“能注入 `tenant_id` filter”，而是同时证明支持场景可用、不支持场景 fail-closed、泄露路径被记录。

执行编排：本 POC 完全隔离在 `scripts/rls-poc/**`，不接入生产 MCP 查询路径，不修改 `webui/` runtime 和静态 ACL，因此可在 Wave B 与 Static Lint、Tiered Publish Gate 并行执行。

## 2. Goals

1. 使用 `tenant_id` 强隔离作为第一验证场景。
2. 设计 AST rewrite 最小模型。
3. 验证跨租户 join、聚合小样本、cache 复用、派生 measure 泄露。
4. 输出支持 / 不支持 / 已知绕过 / fail-closed evidence。
5. 不接入生产 MCP 查询路径。

## 3. Non-goals

- 不上线 Dynamic RLS / CLS。
- 不改默认 `access.yaml` 静态 ACL 语义。
- 不支持任意复杂 policy expression。
- 不保存真实客户数据。
- 不让 POC 查询路径被 Agent 直接调用。

## 4. POC Model

Input:

```ts
type RlsContext = {
  actorId: string;
  tenantId: string;
  allowedColumns?: string[];
};
```

Policy:

```ts
type RlsPolicy = {
  sourceName: string;
  tenantColumn: string;
  minAggregationGroupSize: number;
  deniedDerivedMeasures: string[];
};
```

Output:

```ts
type RlsRewriteDecision = {
  decision: "allow" | "deny";
  rewrittenSql?: string;
  reason?: string;
  evidence: string[];
};
```

## 5. Required Test Scenarios

| Scenario | Expected |
|---|---|
| single source query with tenant column | allow and inject tenant filter |
| query already has same tenant filter | allow without duplicate predicate |
| query has conflicting tenant filter | deny |
| join where all tables have compatible tenant filters | allow |
| join where one table lacks tenant isolation | deny |
| aggregation below min group size | deny or redact according to POC rule |
| derived measure references denied column | deny |
| cached result without tenant cache key | deny |

## 6. Evidence Output

POC must write a machine-readable report:

```text
inbox/202608-dynamic-rls-poc-evidence.json
```

Report fields:

- `generatedAt`
- `generatedBy`
- `scenarios`
- `supported`
- `unsupported`
- `failClosed`
- `knownBypassRisks`
- `nextProductizationRequirements`

## 7. Acceptance Criteria

- All required scenarios have explicit pass / fail.
- Unsupported scenarios fail closed.
- Evidence report does not include secrets or real customer rows.
- Static ACL remains unchanged.
- POC code is isolated under `scripts/rls-poc/**`.

## 8. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

Protected terms: `Dynamic RLS`、`CLS`、`tenant_id`、`SQL AST`、`Agent`、`MCP`、`ACL`、`access.yaml`、`Trace`、`Evidence`。
