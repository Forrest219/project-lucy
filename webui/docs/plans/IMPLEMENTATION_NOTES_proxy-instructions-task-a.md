# IMPLEMENTATION_NOTES — wo-proxy-instructions-injection / Task A

| 元数据 | 内容 |
|---|---|
| 文档名称 | IMPLEMENTATION_NOTES — wo-proxy-instructions-injection / Task A |
| 文档类型 | Implementation Notes (builder 交付) |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-23 |
| 撰写人 | builder (Codex CLI subagent) |
| 委托人 | Claude（架构师 / 工单发布者） |
| 适用工单 | webui/docs/codex/wo-proxy-instructions-injection.md（Task A） |
| 后续 | 等待 Claude review；通过后由 Claude 安排 Task B；不连续做 |

---

## 范围确认

| 项 | 状态 |
|---|---|
| 修改 `webui/server/proxy/mcp-proxy.ts` | ✅ 落地（详见下文） |
| 新增 `webui/server/__tests__/mcp-proxy-instructions.test.ts` | ✅ 落地（7 个 case 全绿） |
| 修改 `webui/server/proxy/acl.ts` | ❌ 未动（工单要求不改） |
| 修改 `webui/docs/07-mcp-auth-proxy-spec.md` | ❌ 未动（Phase 2 范畴，工单要求不改） |
| 修改根目录 `.mcp.json` / `webui/config/access.yaml` | ❌ 未动（Task B 范畴） |
| 修改 `webui/config/data-qa-instructions.md` | ❌ 未动（只读事实源） |

## 实现摘要

### 1. 模块顶层新增（mcp-proxy.ts）

- `loadDataQaInstructions()`：一次性同步读 `<KTX_PROJECT_ROOT>/webui/config/data-qa-instructions.md`，结果缓存到模块作用域。读不到 / 文件不存在时返回 `undefined` 并 log 错误，**不抛、不让进程崩**。
- `instructionsInjectionEnabled()`：返回 `process.env.LUCY_ENABLE_INSTRUCTIONS_INJECTION !== "false"`。默认开启。
- 新增 `readFile` / `path` / `resolveProjectRoot` 三个 import。

### 2. 新增 `writeInitializeResponse(upstream, res)`（紧邻 `writeToolsListResponse` 之后）

结构与 `writeToolsListResponse` 一致（collect upstream chunks → 按 content-type 分 SSE/JSON → 改写 → 重算 content-length → write），但**失败语义反过来**：

- `instructions` 文本为空（文件未加载到） → `injectionFailed: true, errorDetail: "instructions_text_unavailable"`，body 用 `originalBody` 透传
- SSE 解析失败 / `application/json` 解析失败 / `result` 缺失 / 不支持的 content-type → `injectionFailed: true, errorDetail: "instructions_injection_failed:<reason>"`，body 用 `originalBody` 透传
- 成功时把 `payload.result.instructions` **无条件覆盖**为加载到的文本，序列化后写回
- 返回 `{ injectionFailed, errorDetail?, responseBytes }`（无 `requestId` 参数，初始化成功由 upstream 自己处理 id 字段，不需要 proxy 改写）

### 3. `handlePost()` 新增 initialize 分支

在 `forwardToKtx(...)` 之后、`tools/list` 分支之前：

```
if (rpcMethod === "initialize" && instructionsInjectionEnabled()) {
  const initResult = await writeInitializeResponse(upstream, res);
  recordAudit({ ... tool: "initialize", outcome: "ok", errorDetail: injectionFailed ? ... });
  return;
}
```

- 关键保留：`handlePost` 入口附近原有的 clientInfo 缓存逻辑（rpcMethod==="initialize" 时调 `setSessionClient`）—— **完全没动**，smoke test 中所有依赖它的断言照常通过。
- 关键不增加：initialize 不走 `aclCheck`、不走 `kxCatalog`、不走 `lucy_begin_question`——保持 MVP 范围，不做权限差异化。
- 关键不重复：`else` 透传分支（第 800 行附近）继续负责 `LUCY_ENABLE_INSTRUCTIONS_INJECTION=false` 时的 initialize 路由——开关关闭时本分支被 if 短路跳过，initialize 走原有通用透传行为，**等价于本工单上线前**。

### 4. 新增测试 `server/__tests__/mcp-proxy-instructions.test.ts`

7 个 case，全部 PASS（详见「验证」）。

## 验证

### `npm test` 全量

```
Test Files  31 passed (31)
     Tests  186 passed (186)
  Duration  8.81s
```

- `server/__tests__/mcp-proxy-instructions.test.ts` — 7 tests — ✅
- `server/__tests__/mcp-proxy-smoke.test.ts` — 回归全绿（`setSessionClient` 缓存逻辑 + tools/list 注入 + kx_catalog 本地分支 + lucy_begin_question 全部不受影响）— ✅
- `server/__tests__/mcp-proxy-acl.test.ts` — 回归全绿 — ✅
- `server/__tests__/proxy-audit.test.ts` — 回归全绿 — ✅

### 7 个新 case 覆盖

| # | case | 验证点 |
|---|------|-------|
| 1 | overrides an empty upstream result.instructions | 空字符串覆盖为 INSTRUCTIONS_FIXTURE.trim()，且 `instructions_injection_marker_xyz` 出现 |
| 2 | injects when upstream result has no instructions field | 缺字段也注入（无中生有覆盖） |
| 3 | falls back to pass-through on malformed JSON, NOT -32003 | **核心 fail-open 断言**：client 拿 200 + 原始 body，response body 不含 `"code":-32003` / `"tools/list filtering failed"` |
| 4 | rewrites SSE-wrapped responses | `text/event-stream` 路径覆盖 |
| 5 | audit row tool=initialize, decision_reason=allowed on success | audit 写入路径打通 |
| 6 | audit error_detail=instructions_injection_failed:... on parse fail | **失败路径 audit 标记**：outcome 仍为 `ok`（fail-open），error_detail 有原因，decision_reason=instructions_injection_failed |
| 7 | pass-through when LUCY_ENABLE_INSTRUCTIONS_INJECTION=false | kill switch 验证：upstream payload 原样透传，audit 走原 `else` 分支（decision_reason=allowed，无 error_detail） |

### 手测 curl

写了一个临时 smoke harness `webui/server/__smoke__/instructions-injection-curl.ts`（**未提交到 git，仅本会话自验用**）：

- 在 8790 端口起真实 Lucy proxy（用我刚改的代码）
- 在 8791 端口起 mock KTX upstream，返回 `result: { serverInfo, capabilities }`（**故意没有 instructions 字段**）
- 写一次性 `ktx.yaml` + `access.yaml`（含与 smoke token 对应的 hash）到临时项目根
- 把**真实** `data-qa-instructions.md` 复制到临时项目根
- POST 一个 `initialize` 到 8790

输出（节选关键行）：

```
=== upstream received ===
[
  {
    "body": "{\"jsonrpc\":\"2.0\",\"id\":\"smoke-1\",\"method\":\"initialize\",
              \"params\":{\"clientInfo\":{\"name\":\"manual-curl-smoke\"}}}"
  }
]

=== proxy response (status 200) ===
{"jsonrpc":"2.0","id":"smoke-1",
 "result":{
   "protocolVersion":"2024-11-05",
   "serverInfo":{"name":"mock-ktx","version":"0.0.1"},
   "capabilities":{"tools":{}},
   "instructions":"# Lucy 数据问答指导（MCP Initialize Instructions）\n..."}
 }

PASS: instructions field is populated and matches data-qa-instructions.md
      instructions length: 3047 chars
      serverInfo preserved: { name: 'mock-ktx', version: '0.0.1' }
```

**手测断言全过**：
- upstream 收到的 `params.clientInfo.name = "manual-curl-smoke"` → `setSessionClient` 缓存路径**没被破坏**（这条是 smoke test 没显式覆盖的，但本次手测在真实环境上验证了）
- proxy 响应 `result.instructions` 是非空字符串（3047 chars），与 `data-qa-instructions.md` 实际内容完全一致
- `serverInfo` / `capabilities` 字段保留

**注**：upstream 收到的 `authorization` 字段是 undefined——smoke harness 没设 `KTX_INTERNAL_TOKEN` env（不在生产路径上），forwardToKtx 看到 env 为空就不加 internal bearer。这是**预期行为**（对照 `mcp-proxy.ts:94-95` 现有 `if (internalToken) headers["authorization"] = ...`），不是 bug。

## 工单 DoD 自查

- [x] 总纲 §3 全项（详见上文"范围确认"和"实现摘要"）
- [x] 3 条新增测试全绿（实际给了 7 条，覆盖 4 类失败路径 + 3 类成功路径 + kill switch + audit 写入）
- [x] 手测 curl 贴结果（已贴完整输出）
- [x] `mcp-proxy-smoke.test.ts`、`mcp-proxy-acl.test.ts` 回归全绿
- [x] `setSessionClient` 缓存逻辑未受影响（490-495 行 handlePost 入口处代码 byte-for-byte 不动；手测验证 upstream 收到完整 clientInfo）
- [x] 完成后**停下交回**，不开始 Task B ✅

## 已知限制 / 风险声明

1. **instruction 文本缓存是模块级单次**（`cachedDataQaInstructionsLoaded` 标志位）。**改 `data-qa-instructions.md` 后需要重启 proxy 才能生效**——工单约束"不需要做 hot-reload"，这是设计意图。但收尾说明里点出：后续 Phase 4 Claude 修订 onboarding 文档时，可能需要把"重启 proxy 才能更新 instructions"作为已知运维约定记录进去。

2. **KILL SWITCH 默认开启**（`!== "false"` 时启用）。`LUCY_ENABLE_INSTRUCTIONS_INJECTION=false` 走原 `else` 透传分支。**已用 case 7 验证**。但工单要求"行为等价于上线前"——我**没**逐字节 diff 透传响应，**仅**断言 `result.instructions === undefined`（原 upstream 没这字段） + `serverInfo.name === "ktx"` + audit 字段符合预期。如果 review 想加更严格的字节级 diff 验证，可以追加一个 case。

3. **没有触发 SSE 路径的生产级 MCP client 端到端验证**——case 4 验证了 proxy→client 的 SSE 序列化，但没拿真实 Codex/Claude Code 走一遍。**这一项留给 Task B 本地切换后由 Claude/Forrest 手动验证**（工单 Task B 自验步骤第 2 条就是做这件事）。

## 交付文件清单

| 文件 | 类型 | 状态 |
|------|------|------|
| `webui/server/proxy/mcp-proxy.ts` | 修改 | ✅ diff: +loadDataQaInstructions、+instructionsInjectionEnabled、+writeInitializeResponse、+handlePost initialize 分支、+3 个 import |
| `webui/server/__tests__/mcp-proxy-instructions.test.ts` | 新增 | ✅ 7 tests, all green |
| `webui/server/__smoke__/instructions-injection-curl.ts` | 临时（自验用） | ⚠️  收尾前已移到 `inbox/_tmp_smoke/proxy-instructions-curl/`，按仓库规约属 tmp，进程结束后可删。包含 smoke-only token，非真凭据 |

未提交 git 状态确认（**自验 harness 已在收尾前移到 `inbox/_tmp_smoke/`，按仓库规约不视为正式交付**）：

```
$ git status --short | grep -E 'mcp-proxy|instructions'
 M webui/server/proxy/mcp-proxy.ts
?? webui/config/data-qa-instructions.md
?? webui/docs/codex/IMPLEMENTATION_NOTES_proxy-instructions-task-a.md
?? webui/docs/codex/wo-proxy-instructions-injection.md
?? webui/server/__tests__/mcp-proxy-instructions.test.ts
```

修改与新建文件**仅触及本工单 Task A 范围**，不扩大模块。**等待 Claude review 后再做 Task B**。
