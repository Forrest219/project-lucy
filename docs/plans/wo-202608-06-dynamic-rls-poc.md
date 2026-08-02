# 202608-06 Dynamic RLS POC Work Order

## Minimax Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy` 中实现 202608-06 Dynamic RLS POC。

必须先阅读：

- `docs/DEVELOPMENT.md`
- `docs/security-guide.md`
- `docs/access-governance-design.md`
- `docs/lucy-202608-reliable-delivery-upgrade-spec.md`
- `docs/lucy-202608-upgrade-execution-control.md`
- `docs/lucy-202608-dynamic-rls-poc-spec.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`
- `webui/server/proxy/acl.ts`
- `webui/server/proxy/mcp-proxy.ts`
- `scripts/security-baseline.mjs`

目标：实现隔离的 `tenant_id` Dynamic RLS POC，不接入生产 MCP 查询路径，不改变默认静态 ACL。

## Scope

1. 新建 `scripts/rls-poc/dynamic-rls-poc.mjs`。
2. 新建 `scripts/rls-poc/dynamic-rls-poc.test.mjs`。
3. 新建 `scripts/verify-202608-dynamic-rls-poc.mjs`。
4. 构造内存或 fixture SQL 场景，不连接生产数据库。
5. 实现最小 AST / structured query rewrite model。
6. 覆盖 spec 要求场景：
   - tenant filter 注入。
   - conflicting tenant filter deny。
   - join table lacks isolation deny。
   - small aggregation deny。
   - denied derived measure deny。
   - cache key missing tenant deny。
7. 输出 evidence report 到 `inbox/202608-dynamic-rls-poc-evidence.json`。

## Implementation Notes

- POC 代码必须留在 `scripts/rls-poc/**`。
- 不修改 `webui/server/proxy/acl.ts` runtime 行为。
- 不修改 `webui/config/access.yaml` 默认策略。
- 不读取 `.ktx/secrets/**`。
- Unsupported scenario 必须 fail-closed。

## Acceptance Criteria

- 所有 required scenarios 有 explicit pass / fail。
- Evidence report 包含 `supported`、`unsupported`、`failClosed`、`knownBypassRisks`。
- `node --test scripts/rls-poc/dynamic-rls-poc.test.mjs` 通过。
- `node scripts/verify-202608-dynamic-rls-poc.mjs` 通过。
- `npm run security:baseline` 仍通过或仅有既有无关失败并说明。

## Verification

Root Node native test:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
node --test scripts/rls-poc/dynamic-rls-poc.test.mjs
```

Root verifier:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
node scripts/verify-202608-dynamic-rls-poc.mjs
npm run security:baseline
npm run lint:terminology
```

Browser check: not required.

## Code Review Checklist

- [ ] POC not wired to production MCP path.
- [ ] Static ACL behavior unchanged.
- [ ] Fail-closed scenarios are explicit.
- [ ] Evidence report contains no secrets or real customer rows.
