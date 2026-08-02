# Tiered Publish Gate Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Tiered Publish Gate Spec |
| 文档类型 | Product / API / Release Gate Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-03 |
| 关联蓝图 | `docs/lucy-202608-reliable-delivery-upgrade-spec.md` |
| 关联总控 | `docs/lucy-202608-upgrade-execution-control.md` |
| 关联工单 | `webui/docs/plans/wo-202608-03-tiered-publish-gate.md` |
| 适用范围 | semantic asset publish gate、Eval risk tiers、override evidence |

## 1. Background

现有 semantic asset publish 以 validate / promote / reindex 为主。202608 要把发布判断从单一通过率升级为 P0 / P1 / P2 分级 gate，并把 gate decision 写入 Trace / Evidence Kernel。

## 2. Goals

1. 为 semantic publish 增加 tiered gate decision。
2. 支持 Eval Case 静态风险声明，Publish Gate 动态提升为辅。
3. P0 默认 100% 通过，否则阻断。
4. P1 使用阈值，默认 90%。
5. P2 warning 不阻断。
6. Emergency override 必须生成 append-only evidence。

## 3. Non-goals

- 不跑真实 LLM eval。
- 不修改 MCP Proxy ACL 判定。
- 不引入复杂 workflow engine。
- 不让 UI 自己决定 gate 结果。

## 4. Risk Tier Model

```ts
type RiskTier = "P0" | "P1" | "P2";

type GateDecision = {
  traceId: string;
  decision: "allow" | "block" | "warn" | "override_required";
  tierSummary: Record<RiskTier, { total: number; passed: number; failed: number; passRate: number }>;
  blockingReasons: string[];
  warnings: string[];
  evidenceRefs: LucyEvidenceRef[];
};
```

## 5. Static And Dynamic Classification

Static source:

- Eval Case `risk_tier`.
- Eval Case `risk_tags`.
- semantic-layer source metadata when available.

Dynamic promotion signals:

- `access.yaml` deny tags.
- semantic-layer tags.
- source classification.
- measure risk metadata.
- sensitive table prefixes from existing access policy.

Keyword matches such as `finance` or `salary` are only signals. They cannot alone promote to P0.

## 6. API Contract

Extend existing semantic publish validate / publish response with:

```ts
type PublishGateResult = {
  traceId: string;
  status: "passed" | "blocked" | "warning" | "override_required";
  p0: GateTierResult;
  p1: GateTierResult;
  p2: GateTierResult;
  override?: OverrideRequirement;
};
```

Emergency override request:

```ts
type PublishOverrideRequest = {
  releaseId: string;
  reason: string;
  approvers: Array<{ actorKind: string; actorId?: string; tokenHash?: string; identityProvider?: string }>;
  expiresAt: string;
  rollbackPlan: string;
};
```

## 7. UI / UX Rules

- Reuse existing publish workbench and validation panel.
- P0 block uses existing danger state.
- P1 threshold uses warning / progress semantics.
- P2 appears as warning list, not modal blocker.
- Override flow uses existing Drawer / diff review style.
- UI must not say that P0 can be ignored; it can only show explicit emergency override protocol.

## 8. Trace / Evidence Integration

Every gate evaluation writes:

- `trace_events.span_type = "publish_gate"`.
- evidence refs for changed files, eval suites, lint issues, policy source.
- override evidence if emergency flow is used.

## 9. Acceptance Criteria

- P0 failed case blocks publish.
- P1 below threshold blocks publish unless configured otherwise.
- P2 failure does not block, but is visible in response.
- Override requires at least two approvers, reason, expiry and rollback plan.
- Override writes evidence event and follow-up case metadata.

## 10. Self-validation Script

Create:

```text
scripts/verify-202608-publish-gate.mjs
```

The script must verify fixture decisions for:

- P0 fail -> block.
- P1 89% with 90% threshold -> block.
- P2 fail only -> warning.
- single approver override -> fail.
- two approver override with TTL -> pass and writes evidence.

## 11. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

Protected terms: `Publish Gate`、`Eval`、`Trace`、`Evidence`、`access.yaml`、`semantic-layer`、`Agent`、`MCP`。
