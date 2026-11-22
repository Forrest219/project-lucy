# Run — 2026-11-22 — cursor-row-policy-decouple-retest — UAT-SUITE-ROW-POLICY

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ROW-POLICY` |
| 总账 | **P1-28**／REQ-030-049（核心分母）；**P1-29**／REQ-030-050（ROW-07 单列，不计入套件 PASS） |
| Agent | Cursor（全真脚本 `inbox/uat-p1-28-2026-11-22/run-row-policy-uat.mjs`） |
| 合同口径 | 委托人 2026-11-22 选解耦：套件 PASS 不含 ROW-07；默认自动强制行域（P1-72），无 proven 切换 |
| 环境 | compose project `compose`；`compose-lucy-1`；WebUI `:55176`；MCP `:57881` |
| Health | `lucyVersion=0.30.0`；`gitSha=88b2e9ea9ca39e79e65ca26358500126ca7d3ec7`；`gitDirty=false` |
| 开跑前 proven | 未设置（已忽略） |
| 凭据 | WebUI：`/Users/zhangxingchen/Projects/config_for_agents/lucy-demo-webui-local.txt`。问数 Token 由套件签发。明文未写入本跑次 |
| 自造数据 | `demo-mysql`／`uat_row_policy_pl`＋`uat_row_policy_expense`；行级列 `company`；取值 NORTH／EAST／SOUTH；12 Agent＋ctl＋bad；Role `uat-row-policy-role-*`（一次性 id） |
| 证据 | [`inbox/uat-p1-28-2026-11-22/`](../../../../../inbox/uat-p1-28-2026-11-22/)（`verdict.json`／`console.log`；禁 secret） |
| 总判定 | **PASS**（计入核心分母的必做全绿）。ROW-07 **FAIL**（预期 GAP-VALUE，不计入）。≠ 可上线；≠ 功能合同收口 |

## 结果表

| ID | 结果 | 摘要 |
|---|---|---|
| UAT-R0 | **PASS** | 自造两表＋12 Agent；proven 未设置；Role 无 `*` |
| UAT-ROW-01 | **PASS** | 默认环境；`u01` 仅 NORTH／100 |
| UAT-ROW-02 | **PASS** | 12 人表 A 各仅一分组＝对照 |
| UAT-ROW-03 | **PASS** | 表 B 隔离；`u12` A＝NORTH／B＝SOUTH |
| UAT-ROW-04 | **PASS** | 双表点名 → `row_policy_query_shape_forbidden`；无事实行 |
| UAT-ROW-05 | **PASS** | 伪造剥掉；AND 放宽→0 行；OR 树 → `row_policy_query_shape_forbidden` |
| UAT-ROW-06 | **PASS** | `lucy_read_source`／`lucy_freshness` → `row_policy_requires_wrapped_tool` |
| UAT-ROW-07 | **FAIL** | 字面量 `NO_SUCH_COMPANY` 仍可保存；无「取值不存在」警告。归 P1-29／`GAP-UAT-P1-28-VALUE`。**不计入**套件 PASS |
| UAT-ROW-08 | **PASS** | Agent／Role／表／语义 yaml／enabled_tables 已清理 |
| UAT-ROW-OBS | **SKIPPED** | 未做 |

## 相对 2026-11-15 retest

- 前置：P1-35／P1-60／P1-72 已落地；本跑按新 cases（无 proven Gate-On／Off；单源钉选）。
- 夹具要点：Agent **constraints 必须经 PATCH（previewToken＋客户端 UUID operationId）写入**；POST create 不落 constraints。
- 语义层双写：`/data/lucy/config/semantic-layer`（WebUI 目录）与 `/data/lucy/semantic-layer`（KTX 镜像）。
- 历史歧义空候选 BLOCKED 未再复现；隔离数值与拒绝码均达期望。

## 清理

测后无 `uat-row-policy-*` 残留；`uat_row_policy_*` 表与 yaml 已删；enabled_tables 恢复含三张 superstore。
