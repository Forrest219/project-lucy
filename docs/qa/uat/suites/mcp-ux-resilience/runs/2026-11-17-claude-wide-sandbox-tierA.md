# Run — 2026-11-17 — claude-wide-sandbox-tierA

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-MCP-UX-RESILIENCE` |
| Agent | Claude（Cursor） |
| 环境 | **宽目录沙箱** `lucy-uat-wide`（本机 Docker，独立容器＋独立 volume＋独立 MySQL 库 `uat_wide_mcp`，与 demo 隔离）：**320 个 Source**、**20 个 Agent**（`uat_a01..a20`，按 `uat_wide_full`／`uat_wide_noquery`／`uat_wide_half` 三个角色轮转）、`ktx.yaml` 单连接 `uat-wide-catalog`。WebUI `http://127.0.0.1:55276`，MCP `http://127.0.0.1:57981/mcp`。**demo** `compose-lucy-1`：WebUI `http://127.0.0.1:55176`，MCP `http://127.0.0.1:57881` |
| 被测构建 | 沙箱与 demo 同源：`gitSha=28cad205f597940e5f8b2d91c5d7beb1aa6f2bd3`、`gitDirty=true`（含本批未提交改动）；容器内 `mcp-proxy.ts`／`source-descriptions.ts`／`semantic-layer.ts` 的 sha1 与宿主工作树一致（`d9b3d16fde13`／`cd6d28396a97`／`61e96c00c461`）；`derivation_version=v2p5-2` |
| 夹具生成 | `node scripts/uat/uat-wide-sandbox.mjs up｜restart｜seed-rows｜status｜down`；密码、令牌只在 `$TMPDIR/lucy-uat-wide`（0600），不入库、不打印 |
| 运行器 | `node scripts/uat/mcp-ux-resilience-uat.mjs all --out inbox/uat-all.json`（沙箱）；`node scripts/uat/mcp-ux-resilience-demo.mjs all`（demo，令牌取自本机 Cursor MCP 配置的 `lucy-demo` 项，仅内存） |
| 开始／结束 | 2026-11-17 ≈02:30–02:55 CST（完整 `all` 单次 190 s） |
| 总判定 | **PASS WITH GAP**（可确定性执行的用例全部通过；MCPX-09／10 **BLOCKED**；各用例的缺口逐条列在下表） |

> 结论口径：这是**功能合同验证**，**≠ 可上线**，**≠ 客户现场复现**（见「与客户现场的差异」）。

## 用例结果

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | demo healthy，`/api/livez` 200，`initialize` 200 且带 instructions；`gitSha`／`gitDirty` 如上；事件环 P99 30.8 ms。沙箱同样 healthy（`/api/health`） |
| UAT-MCPX-01 | **PASS** | 顺序 200 次：P50 12.3／P95 18.8／P99 22.4／max 35.7 ms，0 次 >30 s；20 并发：P50 132／P99 157 ms；流水里 `initialize` 行数 = 发送数 220（无漏记） |
| UAT-MCPX-02 | **PASS WITH GAP** | 3 次策略变更（`PATCH /api/admin/agents/{id}`）窗口内并发 20 握手：P99 522／612／513 ms（≤ 5 s），0 次 >30 s；`policy_version` 确实变化；Visible Scope 不同的身份 instructions 不同（27296 vs 17376 字符）；同 Visible Scope 不同工具权限：instructions 相同、`tools/list` 不同（11 vs 9）；收窄后 20 次新握手 0 次含被收回 Source；还原后恢复。**缺口**：Spec 里针对「instructions 缓存」方案的 (a)(c)5b6 项**不适用**（U1 最终采用「描述索引按文件指纹缓存」，无跨身份缓存、无陈旧窗口——见取证记录 §9）；未另造 overlay 差异变体。**观察**：策略提交后的首批握手约 0.5–0.6 s（所有身份权限重编译） |
| UAT-MCPX-03 | **PASS（伴生）** | 握手阶段可读出并归因（P1-36 span，宽目录沙箱最近 23 条 `initialize` 的 `access_trace_span` 平均）：`admission` 13.7 ms、`instructions_build` 10.0 ms、`skills_load` 8.3 ms、`upstream_handshake` 3.3 ms、`catalog_resolve` 1.5 ms。SQL 见下 |
| UAT-MCPX-04 | **PASS** | A、N 两个身份各 4 次调用（无入参、带合法入参各两次）均为 `tool_unclassified:*`，无 `invalid_arguments`；拒绝文案中的工具清单＝该身份真实 `tools/list`（A 11 个、N 9 个，差分成立）；含「请勿猜测工具名」；不含 `sl_query` 等 absolute-deny／控制面名；对照：同身份 `lucy_catalog` 成功（4–6 ms）；流水 8 行 `decision_reason` 均为 `tool_unclassified:*`。未知工具名拒绝 P50 约 3.6 ms |
| UAT-MCPX-05 | **PASS WITH GAP** | 两种必然被拒的形状（仅 `connectionId`；`measures: []`）：代理侧 `invalid_arguments:lucy_query:query_shape_required`，**含示例**、不含 `sl_query`，流水 `error_category=client_schema_failure`（非 `upstream_failed`）；三种合法形状（measures＋dimensions／filters／order＋limit）仍成交。本批**发现并修复了真实缺口**：此前裸形状的拒绝文案无示例，已在 `mcp-proxy.ts` 补示例并加 vitest。**缺口**：「仅 segments＋measures」与「sourceName＋SQL」形态未测（沙箱 Source 未定义 segment；SQL 形式不属 `lucy_query` 合同形状） |
| UAT-MCPX-06 | **PASS WITH GAP** | 同身份同会话原样重提：首次无提示，第二次含「Do not retry it unchanged」；键序变化指纹相同仍提示；仅改一个过滤值指纹不同不提示；`filters` 以序列化 JSON 串传入还原后仍提示；身份 B 不被提示；策略变化后不再提示、新策略下重新开始；对照：钉选唯一来源后成交；**LRU**：单身份 65 个键后第 65 个仍命中、第 1 个被淘汰，身份间不互相淘汰；全局 16×64+1＝1025 键（耗时 4 s，排除 TTL）最久未用键被淘汰；TTL：间隔 >60 s 后无提示；**HMAC**：审计列哈希段不等于任何无密钥 SHA-256 前缀，审计库内找不到密钥材料（密钥在 `/data/lucy/.ktx-ui/rejection-fingerprint.key`，0600）；M3 可由指纹算出（7 拒绝、5 重复、0.714）。**缺口**：(1) 无「内存项消失的只读状态计数入口」，TTL／LRU 内部状态只证行为，内部由 vitest `RepeatRejectionTracker` 覆盖；(2) 导出包密钥扫描见 TRC-05 的导出批；(3) `{field,op,value}` 对象与 `x = 1` 表达式串被视为**不同请求**（不归一）——Spec 只要求序列化 JSON 串还原，非缺陷但需写明 |
| UAT-MCPX-07 | **PASS** | 320 个可见 Source：100 次门闩拒绝 P50 189.5／P95 210.1／P99 230.1／max 235.8 ms（门槛 P95 ≤ 500 ms、P99 ≤ 2 s）；流水侧（M2 口径）P95 206／P99 225 ms，与客户端侧一致；同一部署下钉选唯一来源的合法查询成交（874 ms，非 `source_ambiguity_gate`） |
| UAT-MCPX-08 | **PASS WITH GAP** | 四个工具（`lucy_query`、`wiki_search`、`lucy_read_source`、`ping`）各自在**真实重启 KTX 子进程**后用**同一个旧 Lucy 会话**调用：全部无感拿到结果；审计每次有 `session_recover`（状态 ok，理由 `upstream_session_recovered`）；本请求上游相关 span 恰为 4（原请求、握手 initialize、通知 initialized、重试）。**缺口**：只覆盖「真实重启后旧会话号的实际响应（404 Unknown MCP session）」一种形态，未单独造 400 initialize-required 等其他形态；上游调用数以 span 计，不是 KTX 子进程请求日志计数 |
| UAT-MCPX-09 | **BLOCKED** | 夹具待 O7；U3b（持续失效短路）按委托人决定**不实现**，不得写 PASS／FAIL |
| UAT-MCPX-10 | **BLOCKED** | 同上 |
| UAT-MCPX-11 | **PASS** | demo：单表度量查询（418 ms）、多表 join（385 ms）、钉选唯一来源的合法查询（362 ms，非 `source_ambiguity_gate`）、纯 MCP 客户端（无宿主头）同样成交——约束只出现在拒绝路径，合法用户主路径未受影响 |
| UAT-MCPX-12 | **PASS** | 以本套件自产行为已知值核对 `scripts/uat/lib/mcp-ux-metrics.mjs`：M1（`initialize` 条数）、M4（未知工具）、M6（入参错误，均为 `client_schema_failure`）、M3 分母（12＝3 未知工具＋…＋门闩拒绝）与分子（8 次重复，键序变化计入、仅改值不计入）、M2（P95 196 ms）、M5（本批 0 次会话类失败）全部与发送清单一致。脚本自测 `node --test scripts/uat/lib/mcp-ux-metrics.test.mjs`＝5 项通过 |

## 前后对照（宽目录沙箱，同一目录与同一批身份）

| 形态 | 修复前 | 修复后 | 说明 |
|---|---|---|---|
| 门闩拒绝（缺 `measures`，100 次）P50／P95／P99 | 568.4／614.3／722.7 ms | 193.6／218.1／235.2 ms | U4：拒绝路径不再做逐 Agent 权限编译（`listSources(..., { skipAuthorizedCounts: true })`） |
| ACL 工具拒绝（100 次）P50／P95／P99 | 466.4／505.1／514.9 ms | 177.4／198.9／222.0 ms | 同上 |
| 未知工具名（100 次）P50／P95 | 3.9／7.4 ms | 3.6／10.3 ms | 本就便宜，未受影响 |
| 握手（顺序 100 次）P50／P95／P99 | — | 13.1／20.8／55.5 ms | U1：`loadDescriptionIndexes` 加文件指纹缓存 |
| 握手并发突发 20／50／100／200 P99 | — | 184／374／741／1511 ms（0 次 >30 s） | 同进程串行排队，随并发线性增长 |
| M1 15 分钟窗 P99 | **18.4 s**（旧构建窗口，n＝891，含并发突发） | 0.58–0.62 s（新构建窗口，n＝620／711） | 两窗负载构成不完全相同，**不是严格 A/B**；只说明修复前的长尾在宽目录上可复现，修复后消失 |

原始 JSON 在 `inbox/`（临时目录，可删）：`wide-deny-before.json`、`wide-deny-after2.json`、`wide-handshake-after.json`、`uat-all.json`。

## 命令与 SQL（原样）

```bash
node scripts/uat/uat-wide-sandbox.mjs up
node scripts/uat/uat-wide-sandbox.mjs restart            # 换新镜像，沿用 volume
node scripts/uat/mcp-ux-resilience-wide.mjs deny --n 100 # 拒绝形态基准
node scripts/uat/mcp-ux-resilience-wide.mjs handshake --levels 20,50,100,200
node scripts/uat/mcp-ux-resilience-uat.mjs all --out inbox/uat-all.json
node scripts/uat/mcp-ux-resilience-demo.mjs all
node scripts/uat/mcp-ux-metrics.mjs --container lucy-uat-wide --since-id 0
```

```sql
-- MCPX-03 握手阶段归因
SELECT stage, COUNT(*) n, ROUND(AVG(duration_ms),1) avg_ms, MAX(duration_ms) max_ms
FROM access_trace_span
WHERE trace_id IN (SELECT trace_id FROM access_log WHERE tool='initialize' AND id > (SELECT MAX(id)-400 FROM access_log))
GROUP BY stage ORDER BY avg_ms DESC;
```

## 与客户现场的差异（如实）

- 客户流水里的 >30 s 握手长尾**未在 demo 复现**；在宽目录沙箱（320 Source、20 身份、并发突发）上复现了秒级长尾（18.4 s），已据此改 U1／U4。**客户现场的 >30 s 是否同一根因仍未证实**，须客户侧用 P1-36 的阶段 span 取证。
- 单机 Docker，单上游 KTX 子进程；沙箱数据表仅 3 行／表，**不测大结果集**。
- 沙箱用 `PATCH agents` 触发策略提交，与客户真实运维动作等价但不等同。

## 缺口与未测

- MCPX-09／10：**BLOCKED**（U3b 不实现）。
- MCPX-02：instructions 缓存相关子项**不适用**；overlay 变体未造。
- MCPX-05：segments 形态、SQL 形态未测。
- MCPX-06：无只读状态计数入口；`{field,op,value}` 与表达式串不归一（已写明）。
- MCPX-08：仅「重启后旧会话号」一种失效形态。
- 允许路径残余：宽目录上合法 `lucy_query` 约 600 ms（manifest 解析，未在本批优化；见取证记录 §9 残余项）。

## 清理

沙箱在全部 UAT 结束后执行 `node scripts/uat/uat-wide-sandbox.mjs down`（删除容器、volume、库 `uat_wide_mcp` 与本机密钥文件）；`uat_lru_*` Agent 随 volume 一并删除。
