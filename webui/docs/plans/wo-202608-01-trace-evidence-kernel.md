# 202608-01 Trace / Evidence Kernel Work Order

## Minimax Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 202608-01 Trace / Evidence Kernel。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `../docs/lucy-202608-reliable-delivery-upgrade-spec.md`
- `../docs/lucy-202608-upgrade-execution-control.md`
- `docs/00-product-terminology-standard.md`
- `docs/07-mcp-auth-proxy-spec.md`
- `docs/08-mcp-audit-question-tracing-spec.md`
- `docs/62-trace-evidence-kernel-spec.md`
- `server/proxy/audit.ts`
- `server/proxy/mcp-proxy.ts`
- `server/proxy/acl.ts`
- `server/__tests__/proxy-audit.test.ts`
- `server/__tests__/mcp-proxy-acl.test.ts`

目标：新增 append-only `trace_events` / `evidence_events`，提供统一写入 helper，并在 MCP Proxy 基础路径写入 `mcp_tools_call` / `policy_decision` trace。不要做 Visual Debugger UI，不要保存原始结果样本。

## Scope

1. 新建 `server/trace/evidence.ts`。
2. 在现有 audit SQLite 中 idempotent 创建 `trace_events` 和 `evidence_events`。
3. 增加 `writeTraceEvent`、`writeEvidenceEvents`、`listTraceEvents`、`hashArtifact`。
4. SQLite 连接必须设置 `busyTimeout: 5000` 或等效 retry 逻辑。
5. 在 `server/proxy/mcp-proxy.ts` 的 `tools/call` 路径写 trace event。
6. denied / error 路径必须记录 policy decision metadata。
7. 新增 read-only trace API 如 `GET /api/trace/events`，仅用于验证与后续 UI。
8. 新增测试：
   - `server/__tests__/trace-evidence.test.ts`
   - `server/__tests__/mcp-proxy-trace.test.ts`
9. 新增自检脚本：`../scripts/verify-202608-trace-evidence.mjs`。

## Implementation Notes

- 复用 `server/proxy/audit.ts` 的 SQLite 连接思路，保持 WAL。
- event rows 不允许 update；修正只能写新 evidence relation。
- trace 写入失败不得中断 MCP 请求，但测试中要覆盖错误被记录。
- `metadata_json` 必须限长和脱敏，不要放 token 明文、完整 SQL 或完整 result rows。
- 若需要导出 DB helper，保持现有 `writeLog()` 行为兼容。
- 所有测试与自检脚本必须使用 `:memory:` 或独立 temp SQLite 文件，禁止写真实 `.ktx-ui/audit.sqlite`。
- 并行 subagent 可能同时跑测试，不能依赖固定 test DB path。

## Acceptance Criteria

- `trace_events` / `evidence_events` schema setup 可重复执行。
- 同一 `traceId` 写两次产生两行 event。
- denied MCP call 可查到 `policy_decision`。
- 现有 audit tests 仍通过。
- 自检脚本能在临时 DB 上独立跑通。
- 自检脚本证明 `busyTimeout` 或 retry 已配置。

## Verification

WebUI Vitest:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- server/__tests__/trace-evidence.test.ts server/__tests__/mcp-proxy-trace.test.ts server/__tests__/proxy-audit.test.ts server/__tests__/mcp-proxy-acl.test.ts
```

Root verifier:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
node scripts/verify-202608-trace-evidence.mjs
npm run lint:terminology
```

Browser check: not required.

## Code Review Checklist

- [ ] No event overwrite path.
- [ ] No token plaintext or raw result payload in trace tables.
- [ ] MCP behavior remains compatible if trace write fails.
- [ ] Existing audit table contract remains compatible.
- [ ] Tests and verifier do not touch real `.ktx-ui/audit.sqlite`.
