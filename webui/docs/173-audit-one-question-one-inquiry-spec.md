# 一次提问一条问询

| 元数据 | 内容 |
|---|---|
| 文档名称 | 一次提问一条问询 |
| 文档类型 | Product / Audit / API Spec |
| Spec 编号 | 173 |
| 版本 | v0.3 |
| 撰写日期 | 2026-10-19（v0.3 撤销 120 秒近邻回绑与写完成时重归因；与 `docs/specs/lucy-20261019-audit-trust-and-admin-investigation-spec.md` §2.1 / `inbox/audit-trust/audit-trust-2026-10-19-r1/T00-r2/RESPONSE.md` §G0-02/04 同批生效） |
| 委托人 | xingchen |
| 状态 | 设计交付，代码已落地 T01（撤销规则生效；旧常量与函数签名保留作废声明）；T03 再增关联修订事件类型 |
| 适用范围 | MCP Proxy 问询归因、推断问询重建、审计证据包。不改 KTX |
| 上游 | Spec 138、Spec 162、Spec 172；并入 WO-202610-24 |
| 关联验收 | `docs/qa/audit-trust-and-admin-investigation-acceptance.md` EA-02 / EA-03 / EA-04 / EA-05 / EA-07 |
| 关联合同 | `inbox/audit-trust/audit-trust-2026-10-19-r1/T00-r2/implementation-contract.md` §2.1、§7 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 已上报会话不再并列推断问询。同会话补绑改为 120 秒，写日志前再归因一次。仅含探测的簇不进问询。证据包带上已关联的握手 |
| v0.2 | 未上报原文的推断问询摘要固定为「未上报问询原文」，表名只留在来源明细。源已解析时，失败调用按源写入 `access_log_sources` |
| **v0.3** | **撤销 120 秒近邻回绑**：`PRIOR_BIND_MS = 120000` 删除；`bindPriorSessionCalls` 不再按 120 秒窗口回填 `lucy_turn_id`；旧 `proxy/audit.ts:1413 PRIOR_CALL_BIND_MS = 120_000` 与 `bindPriorSessionCalls()` 改写为「不再回绑」（仅握手 attachment 仍保留，但 `association_status = candidate` + `turn_attribution_confidence = low`）。**撤销写完成时重新归因**：`tools/call` 写日志前 `effective_*` 与 `original_*` 一致；不允许在响应 prepared / delivered 阶段按"最新活动 turn"再覆盖 `lucy_turn_id`。**新增 association_status 正交字段**：`confirmed / candidate / unassigned / conflict / legacy_unverified`；session 候选推断不再写入 `session_bound + high`。**新增 attemptId**（v0.4 预告；T01 仅占位，由 T07 完整实施）。 |

## 1. 问题

一次提问在问询列表里出现两条，关联调用数不能相加。按问询 ID 追数据会漏掉同会话的目录和读表。仅含 `server/discover` 的重连被收成「推断：未识别到具体数据源的调用簇」。证据包把 `compare` 标为 true，同时排除了已关联的握手。

**v0.3 进一步撤销**（依据 `claude-final-review-of-codex-cross-review-2026-10-19.md` 复算结论）：

- 仅以 120 秒近邻就把"begin 之前 10 秒的 catalog"自动绑定为 `session_bound + high`，会在无显式 turn 的情况下制造"已确认关联"假象（`aclophore-final-review` §3.2）。这种回绑不可逆，且用户授权意图未被显式表达。
- `tools/call` 写库时按"最近活动 turn"再覆盖 `lucy_turn_id`（v0.2 §6 lines 73–76）会在响应过程中悄悄改写归因，且没有审计可见的不变式。
- 把 `session_bound + high` 当作"等同 confirmed"会破坏 EA-04 / EA-07 的关联分母。

## 2. 目标

1. 客户端上报了原文时，该会话只保留这一条已上报问询。已有 `lucy_turn_id` 的调用不再进入推断问询，也不再为这些握手另写「会话建立」。
2. **v0.3 撤销**：取消"begin 前 120 秒内仍未归因的非协议调用补成 `session_bound`"规则；旧规则仅作废声明保留在 Changelog，不在 §6 伪代码中出现。
3. **v0.3 撤销**：取消"`tools/call` 写日志前若仍是 `unassigned`，且本会话已经有问询，改为 `session_bound`"的写完成时重归因；写入 `access_log` 时 `original_*` 与 `effective_*` 必须一致；不允许后续按最近活动 turn 改写。
4. 没有原文的查数会话仍是一条推断问询，不与另一个会话合并。
5. 整簇都是探测调用时不写问询。调用流水保留原行。只有三次握手的会话仍是会话访问。
6. 默认调用流水仍排除协议调用。证据包额外加入已挂到本次导出问询上的 `initialize`、`notifications/initialized`、`tools/list`，manifest 写出 `linkedHandshakeRowCount`。
7. 没有原文的推断问询，摘要固定为「未上报问询原文」。触达的表写在来源明细和「涉及数据表」，不写进摘要。会话访问仍是「会话建立：」加客户端名。
8. 一次调用解析出多个源时，`access_log_sources` 按源各写一行，失败调用同样写。没有解析出来源时不写。

**v0.3 新增**：

9. **不自动回绑**：同一会话的后续同 user / token 调用，在没有合法显式 turn 时不得 `session_bound + high`；只能形成 `candidate + low` 候选，不进 `confirmed` 分母（EA-04）。
10. **关联质量正交判定**：在 `turn_attribution_mode` / `turn_attribution_confidence` 之外，新增 `association_status ∈ {confirmed, candidate, unassigned, conflict, legacy_unverified}`；该字段由准入路径冻结（不可由 prepared / delivered 阶段改写）。
11. **历史保留**：迁移前自动归因（`session_bound + high`）的旧行不静默升级；`legacy_unverified` 状态由 T03 backfill 脚本统一回填。
12. **请求 ID 命名空间**：同一 `request_id`（如 =8）跨会话复用不视为同一事件；`eventId` 由 `(instance_id, start_generation, attempt_id)` 共同构成。

## 3. 非目标

- 不新增归因枚举。仍是 `explicit` / `session_bound` / `identity_inferred` / `unassigned`（v0.3 不替换；新增正交字段 `association_status`）。
- 不因缺少 `lucy_begin_question` 拒绝查数。
- 不保存客户端最终回答。
- 不根据 User-Agent 把 `undici` 改写成 WorkBuddy，也不改客户端自报的名字。
- WorkBuddy 若不调用 `lucy_begin_question`，问询仍是推断问询。摘要固定为「未上报问询原文」，不编造原句，也不用触达的表充当摘要。
- 不把未关联的后续 `tools/list` 放进默认调用流水或证据包。
- 不改 KTX。
- **v0.3 新增**：不恢复 120 秒回绑作为可选策略；不在客户端配置开关里再开。
- **v0.3 新增**：不把 `association_status` 当作 `turn_attribution_mode` 的别名；二者各自维护，UI 双列展示。

## 4. 修订关系

| 原规定 | 本 Spec 之后（v0.3） |
|---|---|
| Spec 172：begin 前 2 秒内的同会话未归因调用补绑 | 取消；任何"按时间窗回绑"行为作废 |
| Spec 172：推断重建把已上报调用再收成一条推断问询 | 已有 `lucy_turn_id` 的调用不进推断簇。该会话没有剩余业务调用时不写推断问询 |
| Spec 172：空会话里的 `server/discover` 按间隔成簇 | 整簇都是探测调用时跳过。探测名单：`server/discover`、`ping`、`resources/list`、`resources/templates/list`、`notifications/cancelled` |
| 证据包在 `includeProtocol: false` 时不含握手 | 已挂到导出问询上的三次握手进入证据包。默认调用流水不变 |
| 未上报原文时，摘要由触达的表拼成「推断：触达…」 | 摘要固定为「未上报问询原文」。表名留在来源明细 |
| 只有 `outcome = ok` 才写 `access_log_sources` | 源已解析时按源写入，包含失败调用。未解析出源时不写 |
| **v0.1 / v0.2**：同会话 120 秒内未归因补 `session_bound` | **撤销**；v0.3 不再以时间窗回填；同会话未归因保持 `unassigned` |
| **v0.2 §6 lines 73–76**：`tools/call` 写日志前再归因 | **撤销**；`access_log` 写入后 `original_*` 与 `effective_*` 一致；不得在 prepared / delivered 阶段按"最新活动 turn"改写 |
| `session_bound + high` 作为归因结果 | **降级**：`association_status = candidate` + `turn_attribution_confidence = low`；`session_bound + high` 仅在历史未核验行上保留作废状态 `legacy_unverified` |

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

**v0.3 新增**（已登记主标准 §4.7）：

- 「凭证主体 / Credential principal」：UI 列与既有 `Agent` 列并存说明；服务端语义 = `user_id`（非空）
- 「已确认关联 / Confirmed association」：仅合法显式 turn 或 `lucy_begin_question` 自身
- 「候选关联 / Candidate association」：自动 session 推断 + `confidence=low`
- 「归属待核验 / Association review」：含 `conflict` / `legacy_unverified`
- 「客户端采集范围 / Client coverage」：observed / gap / unknown；不称「未外发」
- 「工具调用数 / Tool call count」：`count(event_type = tool_call)`；旧"触达物理表"语义标 `legacy`
- 「原文登记分组占比 / Reported group ratio」：分母含已上报与推断问询；分子只计已上报
- 「证据校验 / Audit integrity verification」：文件 hash / 独立签名 / 外部保全；本地 hash 自检不称为防篡改签名

## 6. 核心流程

```text
PROBE = {server/discover, ping, resources/list, resources/templates/list, notifications/cancelled}
HANDSHAKE = {initialize, notifications/initialized, tools/list}

on begin_question:
  persist new reported turn; confirm this begin event only
  attach first session's HANDSHAKE rows with turn_id (NOT prior catalog/read_source)
  stamps: original_attribution_mode = explicit
          original_association_status = confirmed
          effective_attribution_mode = explicit
          effective_association_status = confirmed
          association_status = confirmed
          turn_attribution_confidence = high

on other tools/call admission:
  if explicit turn id from same principal + credential + bound session: confirm
    freeze original_* == effective_* == explicit at admission
  else if exactly one valid session candidate (no explicit turn): candidate / low
  else: unassigned
  NEVER backbind by elapsed time or "most recent activity turn"

on response_prepared / response_delivered:
  do NOT rewrite lucy_turn_id / association_status / effective_*
  effective_* must equal original_* captured at admission

on rebuild_inferred_turns (T07+):
  business = rows with empty lucy_turn_id and tool not in HANDSHAKE
  skip a cluster whose every tool is in PROBE
  do NOT touch rows whose effective_* is non-empty
  a session with no remaining business row does not get an inferred turn
  a handshake-only session still gets 会话建立
  any other inferred cluster summary is 未上报问询原文
  mode = identity_inferred, confidence = low
  association_status = candidate (NOT confirmed; NOT legacy_unverified)

on bindPriorSessionCalls (T01 撤销回填, 保留握手 attachment):
  attach session handshake only (initialize / notifications/initialized / tools/list)
    with turn_id, mode = explicit, association_status = candidate
    confidence = low
  do NOT update prior non-protocol calls within any time window
  callers (mcp-proxy.ts begin_question handler) treat this as handshake-only path

on tools/call source rows:
  write one access_log_sources row per resolved source
  write those rows when outcome is error
  write none when no source was resolved

on evidence pack:
  rows = current filter
  add HANDSHAKE rows already linked to those turn ids
  manifest.linkedHandshakeRowCount = added count
```

**T00-r2 实施合同 §6.1 准入冻结伪代码** 与本 §6 同源；`effective_*` 与 `original_*` 分离由 `implementation-contract §2.1` 冻结。

## 7. 验收

| ID | 断言 | EA 映射 |
|---|---|---|
| SC-1 | 同会话 `lucy_catalog` 比 begin 早 10 秒，`lucy_read_source` 在 begin 落库后才写完。**v0.3**：两条均**不**被回绑为 `session_bound`；保持 `unassigned` / `candidate`。已上报问询只包含 `lucy_begin_question` 自身。重建后该会话没有第二条推断问询 | EA-02 / EA-03 |
| SC-2 | 同会话、早于任意时间窗的未归因调用保持 `unassigned`（v0.3 撤销"120 秒后保留"） | EA-03 |
| SC-3 | 无 begin 的查数会话仍是一条推断问询，且不与另一个会话合并 | EA-04 |
| SC-4 | 只有两次 `server/discover` 时问询匴为 0。默认调用流水仍能查到这两行 | EA-21 |
| SC-5 | 同会话有三次握手和一条 `server/discover`、没有查数时，问询只有一条，摘要为 `会话建立：{client}` | EA-21 |
| SC-6 | 证据包含该问询已关联的 `initialize`。默认调用列表不含 `initialize` | EA-17 |
| SC-7 | 无 begin 的查数问询摘要为「未上报问询原文」，摘要不含表名。来源明细仍有被解析出的表 | EA-21 |
| SC-8 | `lucy_query` 失败且解析出两个源时，`access_log_sources` 有两行。`count(*)` 未解析出源时为 0 行。只解析出一个源的失败调用为 1 行 | EA-14 |
| SC-9 (v0.3) | 三会话复用 `request_id=8` 不导致同一 `eventId`；短 hash / `token_label` 不作为安全主键 | EA-07 |
| SC-10 (v0.3) | 原始 12 项关联以 `original_*` 持久化；`effective_*` 由 `association_revisions` 事件链读路径计算（idempotent）；管理员追加修订后有效视图 = 5 | EA-02 / EA-06 |