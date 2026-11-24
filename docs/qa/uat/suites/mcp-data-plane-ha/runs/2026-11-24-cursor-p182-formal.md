# UAT-SUITE-MCP-DATA-PLANE-HA 正式跑次 — 2026-11-24

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-82 MCP 数据面舱壁正式 UAT 跑次 |
| 文档类型 | Test Report |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-24 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec v0.3／suite；证据 `inbox/p181-p182-uat-20261124/p182-artifacts/` |
| 适用范围 | 测试台判定；≠ 功能合同收口；≠ 可上线 |
| 输出位置 | `docs/qa/uat/suites/mcp-data-plane-ha/runs/2026-11-24-cursor-p182-formal.md` |

## 候选

与 [P1-81 同日跑次](../../self-healing/runs/2026-11-24-cursor-p181-formal.md) 同一隔离实例 `lucy-uat-p18182`／同一镜像 digest。

| 项 | 值 |
|---|---|
| 配额冻结 | token=4／agent=8／connection=16／global=24 |
| 规模预检 | `npm run uat:scale-baseline` → **PASS**（Hive SKIPPED） |
| 身份 | A=`uat_agent_004`（tk1–3）；B=`uat_agent_006`；C=`demo_agent`；D=`demo_ops`（lucy-ops） |
| 独立 SQL | `COUNT(*)` superstore_orders = **1000** |

## 判定总表

| ID | 结果 | 证据要点 |
|---|---|---|
| UAT-MCPHA-R0 | **PASS** | 规模达标；A／B／C 可查数=1000；D 无 demo-mysql；容量限额可见 |
| UAT-MCPHA-01 | **PASS** | 单 Token 超额 → `scope=token`；3×3 跨 Token → `scope=agent`（`rejectedByScope.agent≥1`）；B／C 仍返回 1000（`case01-agent-scope.json`／token burst） |
| UAT-MCPHA-02 | **PASS**（formal 当时 BLOCKED；[缺口补跑](2026-11-24-cursor-p182-gap-close.md)） | formal 未打满。补跑：`scope=connection`＋`scope=global`（peak=24），撤压后查数=1000 |
| UAT-MCPHA-03 | **PASS WITH GAP**（formal 当时 BLOCKED；[缺口补跑](2026-11-24-cursor-p182-gap-close.md)） | 补跑打出真实 `DISPLAY_SNAPSHOT_BUSY` 503＋两路 MCP 成交＋`/catalog` 可见；**残余**：同毫秒 Web／MCP 重叠窗未取到（MCP listen 更晚；Spec v0.2-r1 A 类亦收窄为 `stale`／`pending`） |
| UAT-MCPHA-04 | **PASS** | 多轮取消后 `acquired==released`，`global.active→0`（健康摘要） |
| UAT-MCPHA-05 | **SKIPPED** | SC-06 已移下期 |
| UAT-MCPHA-06 | **PASS** | `/api/health.mcpCapacity` 暴露 limits／peak／rejectedByScope |
| UAT-MCPHA-07 | **PASS** | 权限拒绝（D→demo-mysql）与容量拒绝（`query_concurrency_exceeded`）文案／reason 可区分 |
| UAT-MCPHA-08 | **PASS** | 撤压后容量归零，合法 `lucy_query` 再成交=1000；无手工 `docker restart` |
| UAT-MCPHA-09 | SKIPPED | 可选 |

## 套件结论

正式开跑当时 02／03 BLOCKED。缺口补跑后 **02 PASS**、**03 PASS WITH GAP** → 套件仍 **PASS WITH GAP**（仅 03 同窗残余＋05 SKIPPED）。GAP-UAT-P1-82 收窄为 03 残余。

不入核心分母；≠ 功能合同收口；≠ 可上线。

## 原始证据

- `inbox/p181-p182-uat-20261124/p182-artifacts/`（`r0.json`、`case01-*.json`、`case03-cpu.json`、`case06–08.json`、`p182-report.json`）
- 缺口补跑：`inbox/p181-p182-uat-20261124/gap-close/mcpha-02-strict.json`、`mcpha-03.json`
