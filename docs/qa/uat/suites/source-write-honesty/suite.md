# UAT-SUITE-SOURCE-WRITE-HONESTY — 语义层 source 写接口诚实响应

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-SOURCE-WRITE-HONESTY` |
| 总账 ID | **P1-89**／REQ-030-110 |
| 目标 | 验证：语义层 source 写接口（`PUT /api/sources/:conn/:schema/:table` 与 `POST /api/sources/:conn/:schema/:table/import`）的诚实响应——零写入 `written:false`＋`noChanges:true` 且无版本快照／无 changedSources 登记／无缓存失效；合同外顶层字段 400 `INVALID_SOURCE_PATCH_BODY` 并携带机器可读 `data.nextSteps`；导入分流按 2026-08-25 P0/P1 与 2026-11-26 D3a 修订执行并输出 `IMPORT_SCHEMA_KEYS_IGNORED` 告警；`patch.tableDescription` 只写 Manifest `descriptions.human` 且保留 `db`/`ai` 子键 |
| 合同回链 | Spec [`lucy-20261125-source-write-api-honesty-spec.md`](../../../../specs/lucy-20261125-source-write-api-honesty-spec.md) · Plan [`lucy-20261125-source-write-api-honesty-plan.md`](../../../../plans/lucy-20261125-source-write-api-honesty-plan.md) |
| cases | [cases.md](cases.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-SWH-01～06 | 无 |

## 边界

- **环境要求**：本机 Docker demo（WebUI `:55176`＋API 直连）＋真实前台浏览器（SC-08 面必须浏览器＋计时）。无特殊夹具需求，使用 demo 现成连接即可；如确需专用夹具，在本边界内补充说明，不建 fixtures.md。
- **浏览器与计时强制**：`UAT-SWH-06`（WebUI 表编辑器保存提示）必须在真实前台浏览器验证，记录「导航→提示可见」计时，并与 API 耗时分列；禁止只验后端 HTTP 却主张该面通过。
- **禁止**：用 vitest／CR 冒充本套件 PASS；跑次不得写入凭据明文。
- **姊妹套件**：增量拉数形状归 [`UAT-SUITE-QUERY-DETAIL-ESCAPE`](../query-detail-escape/suite.md)；本套件 PASS **不得**冒充 SC-11–14。
- **≠** 可上线；**≠** 功能合同收口；登记本套件 **≠** 开发授权。
