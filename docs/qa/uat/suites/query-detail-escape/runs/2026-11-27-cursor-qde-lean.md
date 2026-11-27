# Run — 2026-11-27 — Cursor — UAT-SUITE-QUERY-DETAIL-ESCAPE

| 元数据 | 内容 |
|---|---|
| 总账 / REQ | **P1-89**／REQ-030-110（增量 §2.4） |
| 合同 | [Spec](../../../../specs/lucy-20261125-source-write-api-honesty-spec.md) SC-11–SC-14 · [cases](../cases.md) |
| 环境 | 本机 Docker demo lean（`project-lucy`／`:55176`＋`:57881`）＋纯 MCP；身份 `demo_agent`（默认 seed token，明文不入档） |
| 候选 | 镜像 `project-lucy:demo`；`gitSha=7e377afc56f60588f653a1365c3d01d2f40c2613`／`gitDirty=true`（共享工作树）；`lucyVersion=0.35.0`；`bundledKtxVersion=0.16.0`；health `status=degraded`（既有 policy／execution 观察，与本套件无关）／`ktxRuntime=ready` |
| 授权 | 委托人 2026-11-27 明示「授权跑真实的 UAT」 |
| 总判定 | **PASS**（R0／QDE-01–04 全绿）；≠ 写诚实收口冒充；≠ 功能合同收口；≠ 可上线；压力／Java·Python 大明细仍归 `UAT-SUITE-INTEGRATION-MCP-CAP` |

## 执行与结果

机读证据：`inbox/2026-11-27-qde-uat-evidence.json`（无 Bearer）。跑器：`inbox/2026-11-27-qde-uat-runner.mjs`。

| 用例 | 结果 | 关键证据 |
|---|---|---|
| UAT-QDE-R0 | PASS | `/api/health` ok 体；`LUCY_QUERY_REQUIRE_BUSINESS_MEASURES` unset；`initialize`＋`tools/list` 含 `lucy_query` |
| UAT-QDE-01 | PASS | dims-only omit measures：580ms／**4 行**／`detailAdapted`；`measures:[]`＋dims：423ms／4 行；bare connection：15ms／`measures_required` |
| UAT-QDE-02 | PASS | `measures=["superstore_orders.total_sales"]`＋region：458ms／4 行／**无** `detailMode`；同会话再发 dims-only：448ms／4 行 |
| UAT-QDE-03 | PASS | `_meta.lucy.detailMode`：`adapted=true`、`mode=technical_projection`、`anchorField=superstore_orders.region`、`injectedMeasure.name=_lucy_detail_count`、`note` 标明非业务度量 |
| UAT-QDE-04 | PASS | override 重建 `REQUIRE_BUSINESS_MEASURES=1`：dims-only → `measures_required`（46ms）；去掉 override 再重建：dims-only 2683ms／4 行／`detailAdapted`；跑后容器 env 已还原 unset |

## 边界

- 纯 MCP 形状验收；无 WebUI 浏览器臂；未跑 IMC 压测／MIP 基线。
- QDE-04 两次 `--force-recreate --no-build`（保留 `lucy-demo-data` volume）；未 `--fresh`。
- ≠ 功能合同收口；≠ 可上线。
