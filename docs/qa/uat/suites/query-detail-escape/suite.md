# UAT-SUITE-QUERY-DETAIL-ESCAPE — 查数拉数不得强制业务 measures

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-QUERY-DETAIL-ESCAPE` |
| 总账 ID | **P1-89**／REQ-030-110（**增量 §2.4**；与写诚实子集分套件） |
| 目标 | 验证：成形拉数（`dimensions`／`filters`／`segments`）可不传业务 `measures` 仍经纯 MCP `lucy_query` 成交；显式业务 measures 分析路径不回归；Proxy 技术性适配须披露 `detailMode` 且不得把 `_lucy_detail_count` 当业务度量叙事；`LUCY_QUERY_REQUIRE_BUSINESS_MEASURES` 可回退旧门禁 |
| 合同回链 | Spec [`lucy-20261125-source-write-api-honesty-spec.md`](../../../../specs/lucy-20261125-source-write-api-honesty-spec.md) §2.4／SC-11–SC-14 · Plan [`lucy-20261125-source-write-api-honesty-plan.md`](../../../../plans/lucy-20261125-source-write-api-honesty-plan.md) |
| cases | [cases.md](cases.md) |
| runs | [runs/](runs/) |
| mip | **exempt**（形状／门禁／披露语义；问询热路径时延与大明细背压分别归 `UAT-MIP-*`／`UAT-SUITE-INTEGRATION-MCP-CAP`） |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-QDE-R0、UAT-QDE-01～04 | 无 |

## 边界

- **环境要求**：本机 Docker demo（WebUI `:55176`＋MCP Proxy `:57881`）＋纯 MCP；lean 档即可。demo 现成 `demo-mysql`／`superstore_orders`（或当前栈等价可见源）即可；无专用 fixtures。
- **验收面**：仅 **mcp**（形状诚实）。无 WebUI 浏览器臂。
- **禁止**：用 `UAT-SWH-*` PASS、vitest／CR 冒充本套件 PASS；跑次不得写入凭据明文。
- **不在本套件**：并行／Hive 慢／多形态压力（归姊妹 [`UAT-SUITE-QUERY-DETAIL-STRESS`](../query-detail-stress/suite.md)／**QDE-STRESS-B**）；REQ-0119 流式背压全套（归 `UAT-SUITE-INTEGRATION-MCP-CAP`）；问询性能主档（归 `UAT-MIP-*`）；写诚实（归 `UAT-SUITE-SOURCE-WRITE-HONESTY`）。
- **交叉引用**：本套件 PASS ≠ 压力基准已验 ≠ 0119 PASS。
- **最近跑次**：[2026-11-27-cursor-qde-lean](runs/2026-11-27-cursor-qde-lean.md) **PASS**（R0／QDE-01–04）。
- **≠** 可上线；**≠** 功能合同收口；登记／PASS 本套件 **≠** 整条 P1-89 功能合同收口。
