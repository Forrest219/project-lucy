# Run — 2026-11-16 — P1-35 提交 ce8610f7 全真复核（客户形态＋拒绝载荷）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`（P1-35／REQ-030-056；v2 扩展 ESC-04～08） |
| Agent | Cursor 本机全真 MCP HTTP（非 Code Review；非 vitest 冒充） |
| 环境 | 本机 demo Docker `compose-lucy-1`；先 `BUILDPLATFORM=linux/arm64 npm run demo:upgrade` 平滑升级（volume 保留）；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；health `gitSha=ce8610f7ad9c415ca69e4a0b368ac8c6deb37b84`，`gitDirty=false`，`lucyVersion=0.30.0`，`ktxRuntime.status=ready` |
| 身份 | `~/.cursor/mcp.json` → `lucy-demo`（明文不入档） |
| 开始／结束 | 2026-11-16 22:57–23:10（UTC+8） |
| 证据 | `inbox/uat-sag-fidelity-2026-11-16/result.json`、`run.mjs`（可删临时目录） |
| 触发 | 客户报障截图（`doris-main` 样例查询被来源确认门槛拦；`finance` 会员收入查询被 `source_ambiguity_gate` 拒）；评估提交 ce8610f7 是否如实修复 |
| 总判定 | **FAIL**（v2 扩展 ESC-07／ESC-08 FAIL；原必做 R0／ESC-01／02／03 与 SAG-01 v2 在 `gitDirty=false` 构建上复跑仍 PASS） |

## 原必做在干净构建上复跑

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | health ok；`gitSha=ce8610f7…`；MCP initialize 200 |
| UAT-SAG-ESC-01 | **PASS** | begin「超市最近怎么样」＋首次 `measures=[superstore_orders.order_count]` → 成交，非 ambiguity |
| UAT-SAG-ESC-02 | **PASS** | 窄意图 begin 对照成交 |
| UAT-SAG-ESC-03 | **PASS** | 同 Bearer `POST /mcp/host/source-ambiguity/confirm` → **403** `host_confirm_requires_person` |
| UAT-SAG-01 v2（伴生） | **PASS** | 泛化词＋双身份 measures → `source_ambiguity_gate` |

## v2 扩展

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-SAG-ESC-04 | **PASS** | 即席 `count(<src>.order_id)`＋限定 dimensions、`limit=5`：orders／仅物理表 returns／`dataforai.superstore_orders.*` 全名三种写法，泛化词 begin 后首次均成交 |
| UAT-SAG-ESC-05 | **PASS** | 语义度量＋未限定字符串 filter（`region='East'`、`discount > 0.2`）成交；即席 `sum(superstore_orders.sales)` 成交；`foo_table.bar = 1` → `source_ambiguity_gate`／`unresolved_source_refs` |
| UAT-SAG-ESC-06 | **PASS** | explain 单钉选 allow；never_begun 单钉选 allow、双身份 deny；deny 后集内单钉选重试 allow；集外钉选 deny，重新 begin 窄意图后 allow；`lucy_read_source` 不受门闩 |
| UAT-SAG-ESC-07 | **FAIL** | 如实 begin 点名 orders＋returns → `lucy_query`（orders 度量＋returns 维度）→ `source_ambiguity_gate`；无 begin → `need_begin_or_confirm`；原样重试仍拦。**对照**：begin 改为不含表词的含糊 intent 后同 query **成交**——如实声明意图反而更难查数 |
| UAT-SAG-ESC-08 | **FAIL** | 多身份 deny（orders＋returns）载荷：`usableTargets=[]`；`superstore_orders` 被 `rejected` 为 `invalid_parameter_shape`；`factualError`＝「当前没有可用的合法目标…」。而 orders 单钉选重试已证可成交（ESC-06 步 4）。违反 Spec §4.4「argsShape 相对候选 T 的重试形态」与 SC-E08（H1 须非空） |

## 备注

- 根因指针（读代码仅作定位，非判定依据）：`source-ambiguity-gate.ts` `argsReferencesIdentity` 把「引用了其他 source」判为对该候选参数形态不合法，使任何多身份 deny 的候选恒为 `invalid_parameter_shape`；D1 钉选只认 `keys.length===1`，无多表 join 出口。
- 客户样例查询形态（ESC-04／05）在 demo 上全部绿；客户 `doris-main`／`finance` 实例未在本机验证（demo 为 MySQL，`schema.table` 与带连字符 connectionId 形态等价，物理类型差异未覆盖）。
- 升级前发现容器镜像为 07:57 构建（早于 ce8610f7），已按平滑升级重建后再测；未使用 `docker restart` 冒充生效。
- **合同后续修订**：本跑次 ESC-06 步 5（集外钉选 deny）、ESC-07／08 夹具按 v0.3 判定；v0.4-draft（容错三档）已修订这些期望，见 cases／Spec §4.5。本跑次保留为 v0.3 构建证据，v0.4 实现后须复跑。
- 清理：无持久化配置变更；会话丢弃。
- **≠** 可上线；**≠** 功能合同收口；**≠** 开发授权。据委托人「分析师群体通用性」标准，ESC-04～08 已升必做；INDEX／总账／e2e-ledger／Spec／Plan 现值已同步为 FAIL＋GAP 重开。
