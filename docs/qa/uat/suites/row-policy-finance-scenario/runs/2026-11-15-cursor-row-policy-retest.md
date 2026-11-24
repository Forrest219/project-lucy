# Run — 2026-11-15 — cursor-row-policy-retest — UAT-SUITE-ROW-POLICY

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ROW-POLICY` |
| 总账 | P1-28／REQ-030-049（核心分母）；P1-29／REQ-030-050（ROW-07） |
| Agent | Cursor（全真）；相对 [首跑](2026-11-15-cursor-row-policy-first.md) 补了 `lucy_begin_question`（Role 含该工具） |
| Plan／Brief | [`lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md`](../../../../../plans/lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md)；[`inbox/20261115-p1-28-row-policy-claude-brief.md`](../../../../../inbox/20261115-p1-28-row-policy-claude-brief.md) |
| 环境 | compose project `compose`；`compose-lucy-1`；WebUI `:55176`；MCP `:57881` |
| Health | `lucyVersion=0.30.0`；各阶段重建后 `gitSha=d64414d68a19…`；`gitDirty=false` |
| 开跑前 proven | 未设置 |
| 凭据 | WebUI：`/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`。问数 Bearer 路径 `/Users/forrest/Desktop/lucy token.txt`（JSON 片段内 Bearer）。明文未写入本跑次 |
| 自造数据 | `demo-mysql`／`uat_row_policy_pl`＋`uat_row_policy_expense`；行级列 `company`；取值 NORTH／EAST／SOUTH；12 Agent＋ctl＋bad；Role `uat-row-policy-role`（补 `lucy_begin_question`） |
| 证据 | [`inbox/uat-p1-27-28-12-14-2026-11-15/p1-28/`](../../../../../inbox/uat-p1-27-28-12-14-2026-11-15/p1-28/)（phase-off／phase-on／seed／cleanup 输出；禁 secret） |
| 总判定 | **FAIL**。必做未全部达到期望。≠ 可上线；≠ 核心升级完成 |

## 结果表

| ID | 结果 | 摘要 |
|---|---|---|
| UAT-R0 | **PASS** | 自造两表＋12 Agent；proven 开跑前未设置；Role 无 `*` |
| UAT-ROW-01 | **PASS** | Gate-Off（`…proven-off.yml`）；`printenv=false`；`u01` → `row_policy_upstream_unproven`；无事实行 |
| UAT-ROW-02 | **BLOCKED** | Gate-On（`…proven-on.yml`）；`printenv=true`。12 人在 begin 后仍 `source_ambiguity_gate`（`detail=need_begin_or_confirm`；`candidates=[]`；repair＝未找到通过可用性检查的来源）。另：同会话 `lucy_begin_question` 曾返 `caliber_binding_unresolved`。catalog 对 u01 可见两张 uat 表，但门闩仍空候选。未得到隔离分组 |
| UAT-ROW-03 | **BLOCKED** | 同歧义门闩；无跨表对照 |
| UAT-ROW-04 | **PASS** | `row_policy_query_shape_forbidden`；无事实行 |
| UAT-ROW-05 | **BLOCKED** | forged／widen 停在 `source_ambiguity_gate`；orTree＝`row_policy_query_shape_forbidden`（该向量符合）。三条未齐 |
| UAT-ROW-06 | **PASS** | `lucy_read_source`／`lucy_freshness` → `row_policy_requires_wrapped_tool` |
| UAT-ROW-07 | **FAIL** | 字面量 `NO_SUCH_COMPANY`；preview／save HTTP 200 `ok=true`；无独立「取值不存在」警告（脚本命中字面量≠产品警告）。归 `GAP-UAT-P1-28-VALUE`／P1-29。不改期望 |
| UAT-ROW-08 | **PASS** | 14 Agent／Role 删除 200；enabled_tables 恢复三张 superstore；MySQL 表与 yaml 已删；原 compose 重建后 `printenv`＝未设置 |
| UAT-ROW-OBS | **SKIPPED** | 未做 |

## 相对首跑的进展／仍卡点

- 进展：Role 已授 `lucy_begin_question`；Gate-Off／On／恢复流程可复查；ROW-01／04／06／08 仍稳。  
- 仍卡：Gate-On 隔离主路径被表级歧义门闩挡住（空候选／可用性检查），begin 本身还撞 `caliber_binding_unresolved`。**未**完成来源确认到可查数；按 cases 记 BLOCKED，不记成行权限码错误，也不改期望。  
- 宿主确认 API（person＋`x-lucy-host-attestation`）本波未打通；Agent Token 路径不足以单独关闭歧义。

## 复跑建议

1. 先查清自造 source「可用性检查」为何对歧义门闩为空候选（与 catalog 可见分叉）。  
2. 闭合 `caliber_binding_unresolved`（绑定注册表）后再谈 begin→confirm→隔离。  
3. 有 person／attestation 路径时再试宿主确认。  
4. ROW-07 仍预期 FAIL，直至 P1-29 授权实现。  
