# Tiered Access Governance Gate Spec

| Metadata | Content |
|---|---|
| Document name | Tiered Access Governance Gate Spec |
| Document type | Product / API / Access Governance Spec |
| Version | v0.2 |
| Written date | 2026-08-03；v0.2 更新 2026-08-03（由通用 Publish Gate 收窄为 Agent / Role / Token / access policy 治理门禁） |
| Related blueprint | `docs/lucy-202608-reliable-delivery-upgrade-spec.md` |
| Related execution control | `docs/lucy-202608-upgrade-execution-control.md` |
| Related work order | `webui/docs/plans/wo-202608-03-tiered-publish-gate.md` |
| Scope | Agent / Role / Token / `access.yaml` governance gate, risk tiers, override evidence |

## 1. Background

Lucy 已有 Role-first ACL、Admin dryRun / diff、`config_change_log` 和 runtime audit。202608 需要把 Agent / Role / Token 变更从“可保存 + 可审计”升级为“高风险变更可分级拦截 + 可追溯证据”。

This spec replaces the previous generic semantic Publish Gate for the active 202608 iteration. Semantic publish gates can be revisited later; 202608 only gates access governance changes and governance-sensitive release checks.

## 2. Goals

1. Add deterministic tiered gate decisions for Agent / Role / Token / `access.yaml` changes.
2. P0 blocks permission expansion and sensitive exposure unless all security checks pass or a valid emergency override is provided.
3. P1 requires review / threshold.
4. P2 produces warnings and follow-up candidates.
5. Gate decisions and overrides write Trace / Evidence events.
6. UI renders gate results from API; frontend must not compute final gate decisions.

## 3. Non-goals

- Do not implement generic semantic-layer Static Lint / Reindex gate.
- Do not run real LLM Eval.
- Do not change MCP Proxy ACL allow / deny semantics.
- Do not introduce workflow engine.
- Do not allow one-click override without evidence.

## 4. Risk Tier Model

```ts
type RiskTier = "P0" | "P1" | "P2";

type AccessGovernanceGateDecision = {
  traceId: string;
  targetKind: "agent" | "role" | "token" | "access_defaults" | "release";
  targetId?: string;
  decision: "allow" | "block" | "warn" | "override_required";
  tierSummary: Record<RiskTier, { count: number; reasons: string[] }>;
  evidenceRefs: LucyEvidenceRef[];
  override?: OverrideRequirement;
};
```

## 5. Classification Rules

| Tier | Signals | Decision |
|---|---|---|
| P0 | Role selector widens into sensitive source；`defaults.deny_tools` is weakened；raw query path becomes available；disabled high-risk Agent is enabled；Token is created for P0 Role；core finance / security suite fails | block or override_required |
| P1 | Role selector widens non-sensitive source；Agent switches to broader Role；Token created for high-traffic Agent；Role has high denial rate but remains in use | review / threshold |
| P2 | unused Role；stale Token；disabled Agent cleanup；metadata-only description changes | warning |

Keywords alone cannot decide P0. P0 must be supported by access policy, source classification, sensitive table prefixes, Role diff, or security Eval evidence.

## 6. API Contract

Gate evaluation helper:

```ts
type EvaluateAccessGovernanceGateInput = {
  targetKind: "agent" | "role" | "token" | "access_defaults" | "release";
  targetId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  diff?: string;
  actor?: { actorKind: string; actorId?: string; tokenHash?: string; identityProvider?: string };
};
```

Admin dryRun responses should include:

```ts
type GovernanceDryRunResponse = {
  diff: string;
  proposedYaml?: string;
  gate: AccessGovernanceGateDecision;
};
```

Emergency override request:

```ts
type GovernanceOverrideRequest = {
  reason: string;
  approvers: Array<{ actorKind: string; actorId?: string; tokenHash?: string; identityProvider?: string }>;
  expiresAt: string;
  rollbackPlan: string;
};
```

## 7. UI / UX Rules

- Reuse existing Admin Agent / Role / Token dryRun diff surface.
- P0 block uses danger state and cannot be hidden.
- P1 uses review-required warning state.
- P2 appears as inline warning / follow-up.
- Override flow uses existing Drawer / diff review pattern.
- UI must say `local-admin` is deployment-local identity, not a real enterprise personal identity.

## 8. Trace / Evidence Integration

Every gate evaluation writes:

- `trace_events.span_type = "publish_gate"` for compatibility with existing Trace span taxonomy; metadata must include `gateKind = "access_governance"`.
- Evidence refs for changed `access.yaml` node, permission snapshot, Role diff hash, security Eval suite result, and override evidence when present.

Override evidence uses `evidence_events.relation = "reviewer_override"`.

## 9. Acceptance Criteria

- P0 permission expansion blocks durable save.
- P1 selector widening returns review-required warning.
- P2 stale Token warning does not block save.
- Single-approver P0 override fails.
- Valid two-approver override requires reason, expiry, and rollback plan.
- Gate result is present in Agent / Role / Token dryRun APIs.
- Gate decision writes Trace / Evidence events.

## 10. Self-validation Script

Create:

```text
scripts/verify-202608-access-governance-gate.mjs
```

The script must verify:

1. sensitive Role widening -> P0 block.
2. global deny weakening -> P0 block.
3. stale Token -> P2 warning.
4. single approver override -> fail.
5. valid two approver override -> writes evidence.
6. frontend-independent gate decision shape.

## 11. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

Protected terms: `Agent`、`Role`、`Token`、`ACL`、`Trace`、`Evidence`、`Eval`、`MCP`、`access.yaml`、`semantic-layer`。

