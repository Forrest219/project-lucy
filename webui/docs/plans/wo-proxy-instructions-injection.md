# 工单：Lucy MCP Proxy Initialize Instructions 注入 + 本地切换到走 Proxy

> 先读 [README.md 总纲](README.md) 的「0. 作业环境」「2. 全局护栏」「3. 完成定义」——本工单同样适用，但本工单的代码改动范围在 `webui/server/proxy/`，不是 M0-M5 那条语义层编辑器主线，与 M0-M5 工单互不冲突、可并行。

本工单分两个任务，**必须串行**：Task A 先落地并通过验收，Task B 才能开始（Task B 依赖 Task A 产出的 instructions 注入能力，否则本地切换后会出现"指导真空"——本地数据问答既没有旧 CLAUDE.md 兜底也没有新 proxy instructions）。每个任务结束后**停下来交回**给 Claude（架构师/工单发布者）确认，不要连续做完两个任务再一起交付。

## 背景

project-lucy 仓库当前把"数据问答指导文字"塞在根目录 `CLAUDE.md` 里，这是 Claude Code 专有的自动加载约定，对走 Lucy MCP Proxy（`:7879`，对外发 token）连接的外部客户端（Codex/Cursor/其他 Claude Code 用户）完全不生效——他们从不读这个仓库的 CLAUDE.md。本工单要把这份指导迁移到 MCP 协议原生支持的 `InitializeResult.instructions` 字段，由 Lucy MCP Proxy 在 `initialize` 响应里统一注入，这样所有走 proxy 的客户端（包括本地仓库内的 Claude Code 开发会话，因为本工单 Task B 也会把本地 `.mcp.json` 切到走 proxy）都能拿到同一份指导。

指导文字的最终内容已经由 Claude 撰写好，落在 `webui/config/data-qa-instructions.md`——**本工单不需要也不应该改动这份内容**，只需要让 proxy 把它读出来注入到协议响应里。

---

## Task A：Proxy 新增 `initialize` 响应改写

### codex 直投 prompt

```
工作目录：/Users/forrest/Projects/project-lucy/webui。先读 docs/codex/wo-proxy-instructions-injection.md 的「背景」和「Task A」全部内容，以及 server/proxy/mcp-proxy.ts 现有的 writeToolsListResponse()（约 416-462 行）和 handlePost() 里 tools/list 分支（约 701-717 行）。

任务：给 Lucy MCP Proxy 的 initialize 方法新增响应改写，把 webui/config/data-qa-instructions.md 的内容注入到 MCP 协议标准字段 result.instructions 里。

关键约束：
1. 失败语义与 tools/list 不同——tools/list 改写失败要 fail-closed 返回 JSON-RPC error（涉及权限边界）；initialize 改写失败必须退化为透传原始上游响应，不能让客户端连不上 MCP server。这是本工单最容易踩错的地方，务必对照「Task A 约束」里的说明实现。
2. 不能破坏现有 490-495 行「缓存 clientInfo 到 session」的逻辑。
3. acl.ts 本次不用改。

完成后跑 npm test，贴 mcp-proxy-smoke.test.ts / mcp-proxy-acl.test.ts / 新增测试的结果，并按本单「自验」做一次手测 curl，按 DoD 收尾交回，不要继续做 Task B。
```

### 必读

- `server/proxy/mcp-proxy.ts` 全文（尤其 360-462 行的 `tools/list` 改写参照模式、464-520 行 `handlePost` 的方法分支结构、790-808 行通用透传 `else` 分支）
- `webui/config/data-qa-instructions.md`（本次要注入的内容，只读不改）
- `webui/docs/07-mcp-auth-proxy-spec.md` §4.2/§4.3（请求生命周期、Session 透传现状）——本工单完成后 Claude 会另外修订这份 spec，**本工单不需要改 spec 文件**

### 交付文件

```
server/proxy/mcp-proxy.ts                              # 新增 writeInitializeResponse()，改 handlePost() 分支
server/__tests__/mcp-proxy-instructions.test.ts         # 新增测试文件
```

### 实现步骤

1. 在模块顶层新增一段一次性读取并缓存 `webui/config/data-qa-instructions.md` 内容的逻辑（参考仓库里 `access.yaml` 现有的同步读取方式，不需要做 hot-reload）。路径建议用相对 `webui/` 的固定路径，不要硬编码绝对路径。

2. 新增 `writeInitializeResponse()` 函数，紧邻 `writeToolsListResponse()`（约 416-462 行）之后，结构照抄该函数的"缓冲响应体 → 按 content-type 分 SSE/JSON → JSON.parse → 改写 → 重新序列化 → 重算 content-length"模式：
   - 定位 `payload.result.instructions`，无条件覆盖为第 1 步读到的文本（当前 KTX 上游该字段为空/缺失，是"无中生有覆盖"，不存在合并逻辑要处理）。
   - **失败处理与 `writeToolsListResponse` 必须不同**：`writeToolsListResponse` 失败时调 `toolsListErrorResponse()` 返回 `-32003` JSON-RPC error（约 404-414 行）。`writeInitializeResponse` 失败时（JSON.parse 失败、content-type 不认识等）**直接把原始 `originalBody` 原样写回给客户端**，不要返回 JSON-RPC error，也不要让请求失败——instructions 只是指导文案，注入失败不该阻断 MCP session 建立。建议返回值里带一个 `injectionFailed: boolean` 字段，供 `handlePost()` 决定 audit 日志怎么写（参考 `writeToolsListResponse` 返回的 `filterFailed` 字段的用法）。

3. 改 `handlePost()`：当前第 490-495 行 `initialize` 方法只在请求侧缓存 `clientInfo`（**必须保留，不要动**）；响应侧目前落在第 792 行附近的通用透传 `else` 分支里（`pipeResponse(upstream, res)`）。需要在第 701-717 行 `tools/list` 分支之后、第 720 行 `tools/call` 分支之前，新增一段：

   ```ts
   if (rpcMethod === "initialize") {
     const result = await writeInitializeResponse(upstream, res, requestId);
     recordAudit({
       ts: new Date().toISOString(),
       userId: identity.userId,
       client: identity.client,
       tool: rpcMethod,
       outcome: "ok",
       errorDetail: result.injectionFailed ? "instructions_injection_failed" : undefined,
       durationMs: Date.now() - start,
       responseBytes: result.responseBytes,
       requestId,
       ...requestMeta,
       ...(await auditMeta(identity, "allowed")),
     });
     return;
   }
   ```

   （上面是示意结构，不是要求逐字照抄；具体字段名以现有 `recordAudit` 调用签名为准，照抄 `tools/list` 分支末尾那段 `recordAudit` 调用的字段习惯。）注意 `initialize` 不需要走 `identity` 鉴权判定（401 检查在 `handlePost` 更早处已经做过），不需要额外加 ACL 判定逻辑——instructions 内容对所有通过鉴权的 token 一致，不做权限差异化（这是已确认的 MVP 范围决策，不要自行扩展）。

4. 新增环境变量 `LUCY_ENABLE_INSTRUCTIONS_INJECTION`（默认开启，即 `!== "false"` 时启用），仿照现有 `LUCY_ENABLE_QUESTION_TOOL` 的写法（约 364 行）。该变量关闭时，`initialize` 走原来的透传分支，行为等价于本工单上线前。

### Task A 约束（重点，容易踩的坑）

- **不要把 `tools/list` 的 fail-closed 语义抄到 `initialize` 上**——这是本工单设计意图里最核心的一条差异，如果照抄会导致 instructions 注入一旦有 bug，所有客户端连不上 proxy，影响范围远大于一次工具调用失败。
- **不要遗漏 `recordAudit`**——`tools/list` 分支末尾有调用，`initialize` 分支同样需要，否则这次改动后 `initialize` 请求会从审计日志里消失。
- **不要碰 `acl.ts`**——本次是无差异化的通用文本，不涉及权限判断。
- 读取 `data-qa-instructions.md` 时如果文件不存在或读取失败，行为应该等同于"注入失败退化为透传"，不要让整个 proxy 进程启动失败（这个文件理论上一定存在，但防御性地处理一下，不要假设它永远存在）。

### 自验

```bash
npm test                                    # 全部通过，尤其 mcp-proxy-smoke.test.ts / mcp-proxy-acl.test.ts
```

新增 `server/__tests__/mcp-proxy-instructions.test.ts`，仿照 `mcp-proxy-smoke.test.ts` 的 `buildProxy()` + mock upstream 写法，至少覆盖：

1. upstream `initialize` 响应 `result.instructions` 为空字符串或缺失字段时，代理响应里该字段被替换为非空文本（断言包含 `data-qa-instructions.md` 里的一个关键短语，如某个具体表名）。
2. 构造一个会让 JSON.parse 失败的畸形 upstream 响应体，断言客户端仍拿到 200 + 原始内容，**不是** `tools/list` 那种 `-32003` 错误——这条用来验证"失败退化为透传"真的生效，是本工单验收的核心断言，不能省略。
3. SSE content-type 分支（先看 `mcp-proxy-smoke.test.ts` 现有用例有没有覆盖 SSE 路径，没有的话这里一并补一条）。

手测（贴结果到收尾说明）：

```bash
# 本机起一次 proxy（具体起法参考 server/index.ts 里 buildProxy() 的调用方式，或直接 npm run dev）
curl -s -X POST http://127.0.0.1:7879/mcp \
  -H 'Authorization: Bearer <现有任一测试 token>' \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"manual-test"}}}'
# 期望：响应体 result.instructions 是非空字符串，包含 data-qa-instructions.md 的内容
```

### Task A DoD

- 总纲 §3 全项 + 上述 3 条新增测试全绿 + 手测 curl 贴结果
- `mcp-proxy-smoke.test.ts`、`mcp-proxy-acl.test.ts` 回归全绿，`setSessionClient` 缓存逻辑未受影响
- 完成后**停下交回**，不要直接开始 Task B

---

## Task B：本地仓库切换到走 Proxy

> **前置条件**：Task A 已交回并通过 Claude review。开工前先确认 Task A 的代码已经在主分支/当前工作区里（`git log` 或直接看 `mcp-proxy.ts` 是否已有 `writeInitializeResponse`），否则本任务的验证步骤（"确认本地数据问答拿到新 instructions"）无法通过。

### codex 直投 prompt

```
工作目录：/Users/forrest/Projects/project-lucy（注意：本任务改动根目录 .mcp.json 和 webui/config/access.yaml，不只在 webui/ 下）。先读 docs/codex/wo-proxy-instructions-injection.md 的「背景」和「Task B」全部内容。

任务：
1. 在 webui/config/access.yaml 新增一个 local_dev_full_access role（按本单「实现步骤」给的 YAML 块原样加）和一个本地用户，覆盖 ktx.yaml 里 enabled_tables 列出的全部 10 张表，保证本地数据问答权限不比现在直连 KTX 更窄。
2. 用现成的 admin token 生成流程（webui/server/admin/tokens.ts 的逻辑 / POST /api/admin/agents/:userId/tokens）给这个本地用户生成一个 token。
3. 改根目录 .mcp.json，把 mcpServers 从直连 KTX(:7878) 切到走 Lucy MCP Proxy(:7879)。这一步涉及把 token 放进一个会被 git 提交的文件，处理方式必须先做环境变量插值的可行性实测，不能直接把明文 token 写进 .mcp.json，具体怎么测、两条路径分别怎么做，按本单「实现步骤」第 3 步执行。

最高优先级约束：提交前必须用 git diff --cached 肉眼确认 access.yaml 和 .mcp.json 的改动里不包含任何 token 明文（access.yaml 只能有 hash，不能有明文；.mcp.json 要么用环境变量插值要么不直接带 token）。这条是 DoD 硬性项。

完成后按本单「自验」验证本地 Claude Code 重连 proxy 后的数据问答效果，贴验证结果和你最终选择的 .mcp.json 路径（环境变量插值 or 其他），按 DoD 收尾交回。
```

### 必读

- `webui/config/access.yaml` 现有 `roles`/`users`/`defaults` 结构（已有 `kx_readonly`、`superstore_region_huadong` 两个 role 可参照格式）
- `ktx.yaml` 的 `enabled_tables` 列表（本次新 role 要覆盖的全部表）
- `webui/server/admin/tokens.ts`、`webui/src/pages/admin/NewToken.tsx`（token 生成现成流程）
- `webui/docs/07-mcp-auth-proxy-spec.md` §5.1.4「客户端配置合同」——里面定义的 `{"mcpServers":{"lucy":{"url":"...","headers":{"Authorization":"Bearer <token>"}}}}` 格式假设的是"用户自己本地、不进 git 的客户端配置"，根目录 `.mcp.json` 是会被提交的文件，**不能直接套用明文 token 那部分**，key 名 `lucy` 这部分可以沿用
- 根目录 `ktx.yaml:20` 的 `password: file:/Users/.../.ktx/secrets/mysql-aliyun-password` —— 本仓库已有的"配置文件可提交、敏感值用外部文件/环境变量引用"模式，token 的处理思路应该参照这个先例

### 交付文件

```
webui/config/access.yaml         # 新增 local_dev_full_access role + 本地用户（token 只存 hash）
.mcp.json                        # 切到 :7879，具体写法见下方实现步骤第 3 点
.ktx/secrets/<新文件，命名自定>   # 仅当走环境变量插值路径时需要；该目录已在 .gitignore，不会被提交
```

### 实现步骤

1. `webui/config/access.yaml` 新增 role（放在现有 `roles:` 块下，与 `kx_readonly`、`superstore_region_huadong` 同级）：

   ```yaml
   local_dev_full_access:
     description: 本地开发全量只读访问（等价 ktx.yaml 直连范围）
     allow:
       connections:
         - mysql-aliyun
       tableSelectors:
         - connection: mysql-aliyun
           schema: dataforai
           names:
             - superstore_orders
             - superstore_returns
             - superstore_people
             - superstore_orders_huadong
             - kx_dim_company
             - kx_dim_financial_item
             - kx_fact_financial_amount
             - kx_vw_balance_sheet_detail
             - kx_vw_cash_flow_statement_detail
             - kx_vw_income_statement_detail
       tools:
         - kx_catalog
         - sl_query
         - sl_read_source
         - sl_validate
         - wiki_search
         - wiki_read
         - entity_details
         - dictionary_search
         - discover_data
         - connection_list
   ```

   `users:` 块新增一条（id 用 `forrest_local`，与现有 `zhangsan`/`workhorse` 同级写法）：

   ```yaml
   - id: forrest_local
     name: Forrest（本地开发）
     enabled: true
     tokens: []
     role: local_dev_full_access
   ```

   （`tokens: []` 先留空，下一步用 admin API 生成后会自动补一条 `hash:`，**不要手写 hash**。）

2. 调用现成的 token 生成接口（`POST /api/admin/agents/forrest_local/tokens`，或走 `NewToken.tsx` 管理页面）生成 token。明文只会在这次调用的响应里出现一次，**不要把明文写进任何 commit、日志文件、或贴进收尾说明里**——收尾说明只需要写"已生成"，不需要也不应该贴 token 本身。

3. 改根目录 `.mcp.json`，**先做实测再定写法**：
   - 实测：用当前安装的 Claude Code 版本，配一个临时的 `.mcp.json`（建议先在别处试，不要直接改仓库根目录这份），`headers` 字段写 `"Authorization": "Bearer ${SOME_TEST_VAR}"`，本机 export 一下这个环境变量，重启 Claude Code 连接，确认 token 真的被替换发出去了（可以用 `kx_catalog` 工具调用是否成功来判断——如果 token 没被正确插值，鉴权会直接 401）。
   - **若实测确认插值生效**：
     - 把 token 明文存进 `.ktx/secrets/lucy-local-token`（该目录已在 `.gitignore` 排除，不会被提交）。
     - 本机 shell 配置（比如 `.zshrc`，不在本仓库内）里加一行从该文件读取并 `export LUCY_LOCAL_TOKEN=...`。这一步是本机操作，不属于本仓库的交付文件。
     - 根目录 `.mcp.json` 改为：
       ```json
       {
         "mcpServers": {
           "lucy": {
             "type": "http",
             "url": "http://localhost:7879/mcp",
             "headers": { "Authorization": "Bearer ${LUCY_LOCAL_TOKEN}" }
           }
         }
       }
       ```
       这份文件本身不含明文，可以正常提交。
   - **若实测发现插值不生效或行为不稳定**：不要硬上。改为保持根目录 `.mcp.json` 不直接配置 proxy（可以删除 `mcpServers` 内容或保留一个注释说明），并在收尾说明里写清楚"插值不可用，原因是 XXX"，把这个结论原样转告 Claude——Claude 会在 Phase 4 更新 `docs/DEVELOPMENT.md` 的 Onboarding 流程时采用你的实测结论决定最终方案，**不要自己决定走哪条路径，只需要把实测结果如实报告**。
   - 不管走哪条路径，`mcpServers` 的 key 名统一改成 `lucy`（不要继续用现在的 `ktx`）。

4. 验证本地链路：重启 Claude Code（让它重新加载 `.mcp.json`），确认能连上 `:7879`（用 `kx_catalog` 或任意只读工具调用确认鉴权通过）。

### Task B 约束（重点，容易踩的坑）

- **本地新 role 的表清单必须覆盖 `ktx.yaml` 的全部 10 张 `enabled_tables`，不能少**——这是 Forrest 已经确认的决策（"本地开发能力不能比现在收紧"），如果漏了某张表会被判定为功能回退，不是小问题。
- **`access.yaml` 任何时候都不能出现 token 明文**——只能有 `hash: sha256:...`。
- **`.mcp.json` 是会被提交的文件**——默认假设它最终会进 git history，任何写法都要先问"如果这份内容被提交，会不会泄漏凭据"。
- 不要因为"图方便"就把 `.ktx/secrets/` 之外的位置拿来存 token 明文——这个目录是仓库里唯一已经验证过、被 `.gitignore` 排除的敏感信息存放点，别新建别的位置。
- Task A 必须先落地——如果 proxy 还没有 `writeInitializeResponse`，本任务第 4 步"验证本地数据问答拿到新 instructions"会失败，但失败原因是 Task A 没做完，不是 Task B 写错了，遇到这种情况先确认 Task A 状态，不要在 Task B 里返工 proxy 代码。

### 自验

```bash
git diff --cached -- webui/config/access.yaml .mcp.json   # 提交前必跑，肉眼确认无 token 明文
```

人工验证（贴结果到收尾说明）：

1. 重启本地 Claude Code，确认 MCP server 列表里 `lucy` 状态正常（已连接，非鉴权失败）。
2. 用一个简单数据问答 prompt（如"superstore 订单总数是多少"）手测，确认：模型的回答里能看到 instructions 指导起作用的迹象（比如先调用语义层工具、按口径计算、附 provenance footer 这类行为）；查询结果正确。
3. 可选：扩展 `webui/server/__tests__/mcp-proxy-smoke.test.ts`，加一个 `local_dev_full_access` role 的测试用例，断言该 role 能访问全部 10 张表。

### Task B DoD

- `access.yaml` 新 role + 本地用户落地，token 已生成（明文不出现在任何交付物里）
- `.mcp.json` 切到 `:7879`，`git diff --cached` 确认无明文 token
- 本地 Claude Code 数据问答手测通过，效果不劣于切换前
- 收尾说明里明确写清楚 `.mcp.json` 走的是环境变量插值还是替代方案，附实测依据
- 完成后**停下交回**给 Claude，由 Claude 接手 Phase 2（spec 修订）和 Phase 4（CLAUDE.md 清理）

---

## Task B 续：阻塞解除，收尾剩余步骤（2026-06-23 架构师补充）

上一轮 builder 交付报告（`inbox/_tmp_smoke/builder-report-task-b-2026-06-23.md`）里升级了两个阻塞点，Claude 已亲自复核，**两个都不成立**，记录如下，避免本轮重复踩同样的误判：

1. **"KTX upstream SSE 握手 gap"（原阻塞点 #1，曾标 P0）—— 不成立。** 用完整的 initialize 请求体（含 `protocolVersion` + `capabilities` + `clientInfo`，MCP 协议规定这三项必填）直接测试，`:7878`（KTX 上游）和 `:7879`（Lucy proxy）都返回 200，不是 400。之前报的 400 是因为复现请求漏了必填字段（MCP SDK 的 zod schema 在缺字段时直接拒绝），跟 SSE 握手无关。**KTX upstream 没有任何兼容性问题，不需要改 KTX 仓库或加握手层。**
2. **`.mcp.json` `${VAR}` 插值是否生效（原阻塞点 #2 的核心顾虑）—— 已验证生效。** 用 `claude -p --mcp-config <临时配置> --strict-mcp-config` 非交互模式实测：`headers.Authorization` 写 `Bearer ${某环境变量}`，本机 export 真实 token 后调用 `kx_catalog` 成功，返回完整 10 张表。**不需要再做插值可行性实测这一步，直接按「实现步骤」第 3 点"若实测确认插值生效"分支执行即可。**

上一轮已经完成的部分（**本轮不要重做**）：

- `webui/config/access.yaml` 已有 `local_dev_full_access` role（覆盖全部 10 张 `enabled_tables`）+ `forrest_local` 用户，已生效（Claude 用 `kx_catalog` 实测过，能看到全部 10 张表）。
- `.ktx/secrets/lucy-local-token` 已存在（600 权限，gitignored，对应 token 已在 access.yaml 里以 `sha256:` hash 形式落地）。

本轮 codex 只需要做「实现步骤」剩余的第 3、4 点，范围收得很窄：

1. 根目录 `.mcp.json` 改写为：
   ```json
   {
     "mcpServers": {
       "lucy": {
         "type": "http",
         "url": "http://localhost:7879/mcp",
         "headers": { "Authorization": "Bearer ${LUCY_LOCAL_TOKEN}" }
       }
     }
   }
   ```
   （key 名从 `ktx` 改成 `lucy`；不要在文件里写任何 token 明文，只写 `${LUCY_LOCAL_TOKEN}` 这个占位符。）
2. 确认本机 shell 配置（如 `~/.zshrc`，**不属于本仓库**，不要改仓库内文件去做这件事）里已经/需要 `export LUCY_LOCAL_TOKEN=$(cat /Users/forrest/Projects/project-lucy/.ktx/secrets/lucy-local-token)` 之类的语句，让 `LUCY_LOCAL_TOKEN` 在新开的 shell/Claude Code 会话里可用。如果发现还没配置，在收尾说明里写清楚需要 Forrest 自己手动加这一行（**不要让 codex 直接改 `~/.zshrc`**，这是用户主目录配置，超出本仓库范围）。
3. `git diff --cached -- .mcp.json` 肉眼确认改动只有 key 名和 url/headers 结构，没有任何 token 明文——这条是硬性 DoD，不能省。
4. 本地手测：在确认 `LUCY_LOCAL_TOKEN` 环境变量已设置的前提下，用非交互方式验证一次（避免又误触发交互式 REPL 浪费 token）：
   ```bash
   claude -p --mcp-config .mcp.json --strict-mcp-config "调用 lucy 这个 MCP server 的 kx_catalog 工具，汇报返回的 connections 字段"
   ```
   期望：能看到所有数据域（不是 401/连接失败）。把这条命令的实际输出贴进收尾说明。
5. 收尾说明里**不要**贴任何 token 明文，只需要写"已验证 `LUCY_LOCAL_TOKEN` 插值生效，kx_catalog 调用成功"这类描述性结论。

完成后**停下交回**给 Claude，不要自行继续 Phase 2/4（那两步是 Claude 亲自执行的范畴）。

---

_工单 by Claude（架构师 / 工单发布者）· 2026-06-23_
