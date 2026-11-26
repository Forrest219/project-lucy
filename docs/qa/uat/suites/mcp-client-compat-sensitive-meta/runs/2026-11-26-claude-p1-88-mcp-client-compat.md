# Run — 2026-11-26 — Claude — UAT-SUITE-MCP-CLIENT-COMPAT

| 元数据 | 内容 |
|---|---|
| 总账 / REQ | P1-88／REQ-030-109 |
| 合同 | [Spec](../../../../specs/lucy-20261125-mcp-client-compat-and-sensitive-meta-visibility-spec.md) SC-01–SC-05 · [Plan](../../../../plans/lucy-20261125-mcp-client-compat-and-sensitive-meta-visibility-plan.md) |
| 环境 | 本机 Docker demo（`deploy/compose/docker-compose.demo.yml`）＋敏感表夹具＋纯 MCP `:57881`；无 WebUI 登录；探针显式忽略 `initialize.result.instructions` |
| 候选 | 镜像 `project-lucy:demo`（linux/arm64，2026-11-26 重建）；`gitSha=b4bc7c6ef1c17c3b310a68da0fb89fcfef521e78`（dirty＝共享工作树其他在途任务，与本条无关，见「基线甄别」）；`bundledKtxVersion=0.16.0` |
| 变体 | **基线**（未启用 `entity_details` 现场假设变体；`sensitive_metadata_tools` 保持默认 `dictionary_search`／`discover_data`） |
| 总判定 | **PASS**（UAT-R0／MCCC-01 Case A＋B／02／03／04 全绿）；≠ 功能合同收口；≠ 可上线；待委托人验收 |

## 执行顺序与结果

按 [cases.md](../cases.md) 推荐顺序：`UAT-R0` → `MCCC-01 Case B`（空匹配，未注入种子）→ 注入种子 → `MCCC-02` → `MCCC-01 Case A` → `MCCC-03` → `MCCC-04`。

| 用例 | 结果 | 关键证据 |
|---|---|---|
| UAT-R0 | PASS | `/api/health`：`status=ok`、`lucyVersion=0.35.0`、`ktxRuntime=ready`；T-PARTIAL `initialize` 返回 200＋`mcp-session-id`，`notifications/initialized` 后 `tools/list` 正常 |
| MCCC-01 Case B（空匹配对照，OQ-2） | PASS | 种子注入前：T-PARTIAL `tools/list` 仅 `connection_list / lucy_catalog / lucy_continue_question / lucy_explain_query / lucy_query / lucy_read_source`，**不含** `discover_data`／`dictionary_search`；直接 `tools/call discover_data` → `Access denied: sensitive_metadata_forbidden:kx`（隐藏＋拒绝双生效） |
| MCCC-02（夹具有效性证明） | PASS | 种子注入后：T-FULL `tools/list` **包含** `discover_data`／`dictionary_search`；`tools/call discover_data` 无 `sensitive_metadata_forbidden`（isError 为上游参数校验 `query` 必填，属 OQ-1 范围外，非 ACL 拒绝）；T-FULL `lucy_explain_query`／`lucy_read_source` 指向 `kx_fin_summary` 无 ACL 拒绝 |
| MCCC-01 Case A（非空匹配） | PASS | 同一 T-PARTIAL 在种子注入后 `tools/list` 仍不含敏感元数据工具，且 `lucy_catalog`／`lucy_query`／`lucy_read_source` 保留（主路径不受伤） |
| MCCC-03 步骤 1–2 | PASS | T-PARTIAL 误调 `discover_data`：`isError=true`＋拒绝码；文案含「全局敏感元数据搜索工具受限」「已授权数据源」区分；`可用来源：` 全文**恰出现 1 次**；载荷仅含 `connections=["demo-mysql"]`、`sources=["superstore_orders"]`、`nextTools=["lucy_catalog","lucy_read_source","lucy_query"]`；响应全文无 `kx_` 表名泄露 |
| MCCC-03 步骤 3（逃生链假设取证） | PASS | T-PARTIAL：`lucy_catalog`（含 superstore_orders）→ `lucy_read_source`（返回字段 yaml）→ `lucy_query`（region×total_sales）返回 **4 行真实数据**（Central South=363958.9831／East=550670.8159／Northeast=302200.0925／Southwest=242646.2038）。**Spec「经 lucy_read_source 逃生」假设由待验证转为成立** |
| MCCC-03 步骤 4（T-ZERO） | PASS | 零来源身份：B15 事实性兜底（「暂无已授权来源」），**无**「可用来源：」死路文案；`nextTools=[]` |
| MCCC-03 步骤 5（T-NOREAD） | PASS | 未授 `lucy_read_source`：文案与 `nextTools=["lucy_catalog","lucy_query"]` 均不含 `lucy_read_source` |
| MCCC-03 步骤 6（审计） | PASS | `audit.sqlite access_log`：三次误调均 `outcome=denied`＋`decision_reason=sensitive_metadata_forbidden:kx`；`error_detail` 仅拒绝码，无表名/凭据 |
| MCCC-04 步骤 1 | PASS | `sl_query`／`sql_execution` → `tool_absolute_deny:*` |
| MCCC-04 步骤 2 | PASS | T-PARTIAL 经 `lucy_read_source`／`lucy_query` 触碰 `kx_fin_summary` → `explicit_table_required:dataforai.kx_fin_summary`（该拒绝串回显**客户端自请**表名为既有 ACL 合同，非本修复新增泄露面） |
| MCCC-04 步骤 3 | PASS | 审计：`tool_absolute_deny:sl_query`／`tool_absolute_deny:sql_execution`／`explicit_table_required:dataforai.kx_fin_summary` 均 `outcome=denied`；同一 T-PARTIAL 的合法 `lucy_query`／`lucy_read_source`（superstore_orders）`outcome=ok` |
| MCCC-04 步骤 4（单测证据） | PASS | `cd webui && npm test -- kx-acl mcp-proxy-acl denial-repair-hint mcp-proxy-instructions`：4 文件／89 项全绿（含「`sensitiveTables` 为空＋`sensitive_metadata_tools` 非空」fail-closed 与「`tables:["*"]` 通配非显式全量」覆盖） |

## 防假绿检查单（fixtures.md §3 逐项）

1. MCCC-02 先于 Case A 执行并 PASS（T-FULL 可见可调用）→ **满足**。
2. `sourceMap` 已加载种子：注入前后 `/api/health` `policyVersion` 由 `964423ed…` 变为 `0d46ab55…`；且 T-FULL `lucy_explain_query`／`lucy_read_source` 指向 `kx_fin_summary` 无 ACL 拒绝 → **满足**（双证）。
3. T-PARTIAL 与 T-FULL 唯一差异为敏感表显式授权：两角色 `allow.tools` 完全一致，`tableSelectors.names` 仅差 `kx_fin_summary`／`kx_ops_cost` → **满足**。
4. 探针为纯 curl JSON-RPC，从不读取 `initialize.result.instructions` → **满足**。
5. 本记录含变体（基线）、顺序、凭据代号、`gitSha`、注入前后 `policyVersion` → **满足**。

## 夹具构造

- **种子**：`demo-db`（mysql:8.4，库 `dataforai`）新建 `kx_fin_summary`／`kx_ops_cost` 各 3 行真实数据（SQL 夹具留存于本机 `/tmp/p188/seed-kx-tables.sql`，不入库 git）。
- **入图**：`/data/lucy/ktx.yaml` `enabled_tables` 追加两表；`config/semantic-layer/demo-mysql/_schema/dataforai.yaml`（content root 与 runtime mirror 同步）追加**含 `columns` 定义**的表项。教训：首次仅追加 `table:` 映射（无 `columns`）令 KTX `sl_read_source` 扫描崩溃（`Cannot read properties of undefined (reading 'map')`）——夹具表项必须带 `columns`。
- **身份**：四个正式 Role（`uat_mccc_full`／`uat_mccc_partial`／`uat_mccc_noread`／`uat_mccc_zero`）＋四 Token（代号 T-FULL／T-PARTIAL／T-ZERO／T-NOREAD），非 legacy 直配；Token 明文仅存本机临时环境（用后清除），本记录与容器外不落明文。
- **空匹配态**：身份注入不改变 `sourceMap`（无 `kx_*` 表），Case B 在种子注入前执行，符合执行顺序硬约束。

## 本机自动化与基线甄别

- 定向：`kx-acl`（42，含 2 项新增 P1-88 用例）／`mcp-proxy-acl`（9，含 3 项新增修复载荷用例）／`denial-repair-hint`／`mcp-proxy-instructions` 合计 **89 项全绿**；`tsc --noEmit` 零错误；`lint:spec-docs`／`lint:terminology` 全绿。
- 全量 vitest 有存量失败（`empty-result-next-step-proxy`／`mcp-proxy-smoke`／`admin-*`／`api.*`／`audit-export-n26` 等，另 `lint:url-driven-input` 报 `Audit.tsx:2527`）：**HEAD 基线对照**（仅还原 `acl.ts`／`mcp-proxy.ts` 为 HEAD 后重跑同批文件）失败集合一致，归因共享工作树其他在途任务，非本条引入；本条不越界修复。

## 边界

- 本跑次为隔离 Docker demo 全真 MCP 验收；未执行远端 CI、客户实例与其他数据库版本；未提交／推送。
- `MCP_INVALID_OPERATION`／Tool `inputSchema`（OQ-1）、`lucy-ops` 可见性分叉（OQ-3）、`ambiguous_field`（OQ-4）不在本套件（MCCC-02 中 `discover_data` 缺 `query` 参数的上游校验报错即 OQ-1 范围，已按 Spec 剥离）。
- ≠ 功能合同收口（待委托人验收）；≠ 可上线。
