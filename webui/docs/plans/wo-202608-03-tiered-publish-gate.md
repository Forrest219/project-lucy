# 202608-GOV-03 Tiered Access Governance Gate Work Order

## Minimax Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 202608-GOV-03 Tiered Access Governance Gate。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `../docs/lucy-202608-upgrade-execution-control.md`
- `docs/00-product-terminology-standard.md`
- `docs/07-mcp-auth-proxy-spec.md`
- `docs/14-agent-admin-enterprise-delivery-spec.md`
- `docs/15-role-admin-spec.md`
- `docs/64-tiered-publish-gate-spec.md`
- `server/admin/agents.ts`
- `server/admin/roles.ts`
- `server/admin/tokens.ts`
- `server/proxy/acl.ts`
- `server/admin/audit.ts`

目标：为 Agent / Role / Token / `access.yaml` governance changes 增加 P0 / P1 / P2 分级门禁和 override evidence。不要实现通用 semantic publish gate。

## Scope

1. 新建 `server/access-governance-gate.ts`。
2. Agent / Role / Token dryRun response 增加 gate decision。
3. P0 覆盖 permission expansion、global deny weakening、sensitive source exposure、raw query path exposure。
4. P1 覆盖非敏感 Role widening、高流量 Agent Token 创建、高 deny Role 变更。
5. P2 覆盖 stale Token、unused Role、低风险 cleanup warning。
6. Durable write 前必须检查 gate pass 或 valid emergency override。
7. Override 要求两个 approver、reason、expiresAt、rollbackPlan。
8. Gate decision / override 写 Trace / Evidence event。
9. 新增测试：
   - `server/__tests__/access-governance-gate.test.ts`
   - 回归 `admin-agents` / `admin-roles` / `admin-tokens`。
10. 新增自检脚本：`../scripts/verify-202608-access-governance-gate.mjs`。

## Implementation Notes

- 关键词只能作为 signal，不能单独提升 P0。
- Gate truth lives in backend, not frontend.
- Do not change MCP Proxy ACL final allow / deny behavior.
- Do not write `.ktx/secrets/**`.
- Tests must use temp SQLite via `LUCY_AUDIT_DB`, not real `.ktx-ui/audit.sqlite`.

## Acceptance Criteria

- Sensitive Role widening -> P0 block.
- Global deny weakening -> P0 block.
- Stale Token -> P2 warning, not block.
- Single approver override -> rejected.
- Valid two-approver override -> accepted and writes evidence.
- Existing Admin dryRun / diff behavior remains compatible.

## Verification

WebUI Vitest:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- server/__tests__/access-governance-gate.test.ts server/__tests__/admin-agents.test.ts server/__tests__/admin-roles.test.ts server/__tests__/admin-tokens.test.ts
```

Root verifier:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
node scripts/verify-202608-access-governance-gate.mjs
npm run lint:terminology
```

Browser check: not required.

## Code Review Checklist

- [ ] Gate cannot be bypassed on durable P0 governance writes.
- [ ] Frontend does not compute final gate decision.
- [ ] Override event is append-only.
- [ ] No semantic publish / Static Lint implementation sneaks into this work order.

