# Run — 2026-11-16 — P1-35 Spec v0.4（容错三档）实现后全真复测

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`（P1-35／REQ-030-056；v0.4：ESC-01～10 全必做） |
| Agent | Cursor 本机全真 MCP HTTP（非 Code Review；非 vitest 冒充） |
| 环境 | 本机 demo Docker `compose-lucy-1`；`BUILDPLATFORM=linux/arm64 npm run demo:upgrade` 平滑升级（volume 保留；`ktx install layer: CACHED`）；基线提交 `ce8610f7`＋未提交 v0.4 实现（health `gitDirty=true`，`lucyVersion=0.30.0`，`ktxRuntime` ready）；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp` |
| 身份 | `~/.cursor/mcp.json` → `lucy-demo`（明文不入档） |
| 日期 | 2026-11-16 夜（UTC+8） |
| 证据 | `inbox/uat-sag-fidelity-2026-11-16/run4.mjs`＋`result4.json`（28 项断言 28/28 PASS）、`fixture.mjs`（夹具）、`esc03.mjs`（可删临时目录） |
| 夹具（UAT 自造，已清理） | `dataforai.uat_sag_1`…`uat_sag_5`＋`uat_sag_b`（`superstore_orders` 的 20 行副本）；语义层 `uat_sag_N.yaml`；第二连接 `demo-mysql-b`（同 demo-db，含 `superstore_orders`／`uat_sag_b`）；测试 Agent 角色 `demo_readonly` 追加可见。**测完已还原** `ktx.yaml`／`access.yaml`／`semantic-layer`、删表、清审计文件；还原后复跑 27 项断言中 23 项 PASS，其余 4 项为夹具依赖断言按预期失败 |
| 总判定 | **PASS**（R0／ESC-01～10 全绿；无 PASS WITH GAP） |

## 结果

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | health ok；MCP initialize 200 |
| UAT-SAG-ESC-01 | **PASS** | begin「超市最近怎么样」＋首次 `measures=[superstore_orders.order_count]` → 成交；响应**无** `sourceSelection`（档①） |
| UAT-SAG-ESC-02 | **PASS** | 窄意图对照成交，无披露 |
| UAT-SAG-ESC-03 | **PASS** | 同 Bearer `POST /mcp/host/source-ambiguity/confirm` → **403** `host_confirm_requires_person` |
| UAT-SAG-ESC-04 | **PASS** | 即席度量＋限定 dimensions（orders／仅物理表 returns／`dataforai.superstore_orders.*`）首次均非 gate |
| UAT-SAG-ESC-05 | **PASS** | 未限定字符串 filter 成交；表名只在 expr 内成交；`foo_table.bar = 1` → `source_ambiguity_gate`／`unresolved_source_refs` |
| UAT-SAG-ESC-06 | **PASS**（v0.4 口径） | explain 单钉选 allow；never_begun 单钉选 allow；never_begun orders＋returns（已声明 join）**档① allow**；无任何钉选（`sum(sales)`）→ `explicit_table_required` 硬拦（M12）；集外钉选 → allow＋`sourceSelection{tolerated,pin_outside_hits}`；`lucy_read_source` 不受门闩 |
| UAT-SAG-ESC-07 | **PASS** | 如实 begin／含糊 begin 下 orders＋returns join 均成交且**无** `tolerated`（档①）；星型 orders＋returns＋`people.regional_manager` 成交；未连通 returns＋people、`uat_sag_1`＋`uat_sag_2`：门闩放行，**上游**拒绝（`Aggregate locality…`／`No join path…`），**不是** `source_ambiguity_gate`，审计各记一条 `unjoined_multi_source` |
| UAT-SAG-ESC-08 | **PASS** | 5 来源 → `source_ambiguity_gate`／`source_count_over_cap`，message 直接写下一步；`usableTargets=[uat_sag_1…5]` 非空，`rejected=[]`，`factualError=null`；按 `usableTargets[0]` 单来源重试**成交**（v0.3 偏差——orders 被判 `invalid_parameter_shape`、usable 恒空——已消除） |
| UAT-SAG-ESC-09 | **PASS** | 档①无 `sourceSelection`且不写审计；档②响应含 `sourceSelection{status=tolerated,reason=pin_outside_hits,usedSources[1],termHits[2]}`；审计 JSONL 新增 1 条，键仅 `ts/reason/tool/session/usedSources/termHits`，无取值与凭据，`session` 为哈希；代码无阈值逻辑 |
| UAT-SAG-ESC-10 | **PASS** | `connectionId=demo-mysql` 同时引用 `superstore_orders` 与仅在 B 连接的 `uat_sag_b` → `source_ambiguity_gate`／`cross_connection`；message＝「请按连接拆分为单连接查询」；`usableTargets=[superstore_orders, uat_sag_b]` |

## 观察与边界（诚实披露）

- **未连通多来源（M6）在 demo 上必由上游拒绝**：KTX 对未声明 join 路径的来源报 `No join path`／`Aggregate locality`，所以披露字段（只随成功响应出现）对这一类实际不可见；其取证面是审计事件与上游错误文本。这符合 Spec M6 对「上游自行拒绝」的描述，但意味着「档② `unjoined_multi_source` 带披露成交」在当前 KTX 规则下不可达；价值＝把「被 `source_ambiguity_gate` 误拦」换成上游给出的真实原因。
- `multi_hit_unconfirmed` 仅由 vitest 覆盖（`source-ambiguity-tolerance.test.ts` M7），本跑次无全真夹具。
- `lucy_query` 无法直接写跨连接引用，ESC-10 的跨连接键经反查（来源名只存在于另一连接）产生；真实客户同形路径应属同一类。
- 套件外回归：`vitest run server/__tests__` 失败集合与基线（stash 本改动后）逐条一致（均为本机既有失败，16 个文件／51→50 条，无新增）。
- 本跑次**不**构成 D5 全量功能合同收口；**≠** 可上线。
