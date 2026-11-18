# Run — 2026-11-18 — 重建后 ESCAPE＋WorkBuddy 会员收入同形复测

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`（P1-35／REQ-030-056；含新增 ESC-11） |
| Agent | Cursor 本机全真 MCP HTTP（`run4.mjs`／`esc03.mjs`；非 Code Review；非 vitest 冒充） |
| 环境 | 本机 demo Docker `compose-lucy-1`（用户已重建）；health `gitSha=7ebedd4eb79b…`，`gitDirty=false`，`lucyVersion=0.30.0`，`ktxRuntime=ready`；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp` |
| 身份 | `~/.cursor/mcp.json` → `lucy-demo`（明文不入档） |
| 日期 | 2026-11-18（UTC+8） |
| 证据 | `inbox/uat-sag-escape-2026-11-18/{run4.out,result4.json,esc03.out,customer-iso.out}`；驱动复用 `inbox/uat-sag-fidelity-2026-11-16/` |
| 夹具 | ESC-08／10 临时 `uat_sag_1`…`5`＋`uat_sag_b`＋`demo-mysql-b`；**测完已还原**（ktx／access／semantic-layer 0 命中；表已 DROP；复跑 ESC-01 PASS） |
| 总判定 | **PASS**（R0／ESC-01～10＝28/28；ESC-03＝403；ESC-11 客户同形＝成交且无 Schema 假故障文案） |

## 结果

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | health ok；`gitSha=7ebedd4e…`；MCP initialize 200 |
| UAT-SAG-ESC-01 | **PASS** | 泛化「超市」＋唯一钉选首次成交；无 `sourceSelection` |
| UAT-SAG-ESC-02 | **PASS** | 窄意图对照成交 |
| UAT-SAG-ESC-03 | **PASS** | confirm → **403** `host_confirm_requires_person` |
| UAT-SAG-ESC-04 | **PASS** | 样例行／物理表／全名三次均非 gate |
| UAT-SAG-ESC-05 | **PASS** | 未限定 filter 成交；幽灵 `foo_table.bar` → `unresolved_source_refs` |
| UAT-SAG-ESC-06 | **PASS** | explain／never_begun／集外钉选 tolerated／read_source；无钉选硬拦 |
| UAT-SAG-ESC-07 | **PASS** | join 档①；未连通上游拒绝非 gate；审计 `unjoined_multi_source`×2 |
| UAT-SAG-ESC-08 | **PASS** | 5 来源 over_cap；`usableTargets` 非空；单来源重试成交 |
| UAT-SAG-ESC-09 | **PASS** | 档①无披露无审计；档② `pin_outside_hits`＋审计 1 条 |
| UAT-SAG-ESC-10 | **PASS** | 跨连接 deny；message＝按连接拆分 |
| UAT-SAG-ESC-11 | **PASS** | 客户原文问句 begin＋未限定 filter＋钉选 `total_sales` → 成交；`schemaEvidenceUnavailable=false` |

## 父套件硬线（SAG-01 v3）交叉证据

| 断言 | 结果 | 证据 |
|---|---|---|
| 幽灵引用仍拦 | **PASS** | ESC-05c／SAG-01 步骤 2 → `unresolved_source_refs` |
| 超上限仍拦 | **PASS** | ESC-08 |
| 跨连接仍拦 | **PASS** | ESC-10 |
| 合法钉选不得拦 | **PASS** | ESC-01／11 |

## 出包边界（诚实披露）

- 本跑次证明：**候选 demo 镜像**上，客户报障的「泛化词＋已钉表仍死路／Schema 假故障」类路径已修。
- **未**在本机重放客户 `finance`／`bidm.viz_dm_hs_pl_metric_sum`／WorkBuddy 私有 Token；`UAT-COMPAT-09` 客户层＝**BLOCKED**（无私有基线）。
- 旧容器 `lucy-old3a9`（`gitSha=3a9f0711`，缺 P1-35）仅暴露 WebUI `:55276`，**无** MCP 端口 → COMPAT-09 旧版负控 **BLOCKED**。
- **≠** 可上线；**≠** 客户现场验收 PASS；登记本跑次 **≠** 新 Spec／改代码授权。
