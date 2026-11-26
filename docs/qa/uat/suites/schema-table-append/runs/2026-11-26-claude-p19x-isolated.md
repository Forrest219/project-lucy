# Run — 2026-11-26 — Claude — UAT-SUITE-SCHEMA-TABLE-APPEND（隔离栈 p19x）

| 元数据 | 内容 |
|---|---|
| 总账 / REQ | P1-90／REQ-030-111 |
| 合同 | [Spec](../../../../specs/lucy-20261125-schema-manifest-table-append-spec.md) SC-01–SC-07 · [Plan](../../../../plans/lucy-20261125-schema-manifest-table-append-plan.md) |
| 环境 | 本机**隔离** Docker demo 栈 `lucy-uat-p19x`（独立 compose project／独立 volume）：WebUI `http://127.0.0.1:55186`、MCP `http://127.0.0.1:57891/mcp`、demo-db 宿主端口 `53316`、容器 `lucy-uat-p19x-lucy-1`；lean 档；探针 Agent `uat_probe_p19x`（跑后已禁用）；共享 demo（`:55176`）注记见「环境注记」 |
| 候选 | 镜像 `project-lucy:demo`；`gitSha=c033eb97eeabd60c01c9a6aaf29bf5027ce7d0e1`（dirty＝共享工作树其他在途任务） |
| 变体 | lean 档（非 scale）；纯 API＋MCP（无浏览器面） |
| 总判定 | **PASS WITH GAP**（UAT-R0／STA-01–07 全绿；GAP-STA-02-DISCOVER）；≠ 功能合同收口；≠ 可上线 |

## 执行顺序与结果

执行器：`inbox/uat-p189-90-91-20261126/run-sta.mjs`（判定 `inbox/uat-p189-90-91-20261126/sta-verdict.json`，executedAt `2026-11-26T02:22:47.973Z`）。

| 用例 | 结果 | 关键证据（verdict checks 摘要） |
|---|---|---|
| UAT-R0 | PASS | `health-200`；`gitSha=c033eb97eeabd60c01c9a6aaf29bf5027ce7d0e1`；`sources-200`；`mcp-57891-reachable=200` |
| STA-01（dryRun 幂等：diff 仅新表） | PASS | 7 checks 全 ok：`noChanges:false`（有真实 diff）、`files-has-manifest=["semantic-layer/demo-mysql/_schema/uat_sta.yaml"]`、`diff-only-new-table`、`warnings:[]`、`no-disk-write`（夹具 md5 不变）、两次 dryRun diff 相等（幂等） |
| STA-02（追加落盘＋catalog／MCP 可见性＋100 表保留） | PASS WITH GAP | 13 checks 全 ok：`written:true`；`writtenFiles-manifest`；`nextSteps=["PUT /api/connections/demo-mysql/enabled-tables","POST /api/semantic-assets/reindex"]`；`existing-100-kept`（既有表 keys=100，首个既有节点逐字保留）；`append-node-on-disk`；`catalog-has-new-table=demo-mysql/v_token_income_unified`；`enabled-tables-ok=200/true`；`mcp-read-source-visible`（lucy_read_source 返回 yaml，table `DATAFOR.dbo.v_token_income_unified`）；`mcp-discover-visible-or-env-gap`。**GAP-STA-02-DISCOVER**：`discover_data` 被本实例敏感元数据策略拒绝（`sensitive_metadata_forbidden:kx 可用连接：demo-mysql。 可用来源：superstore_orders、superstore_people、superstore_returns、v_token_income_unified…`）；MCP 可见性由 `lucy_read_source` 与 `/api/sources` 证实 |
| STA-03（create-only 409） | PASS | 4 checks 全 ok：重复 create → `409/TABLE_ALREADY_EXISTS`；`nextSteps=["POST /api/sources/demo-mysql/uat_sta/v_token_income_unified/import"]`；`manifest-bytes-unchanged` |
| STA-04（四类校验拒绝与 400/422 归一） | PASS | 8 checks 全 ok：未知字段 → `400/INVALID_SCHEMA_APPEND_BODY`（`unknownKeys=["confirmOverwrite"]`、`allowedKeys=["table","yaml","dryRun"]`）；缺 table → `400/INVALID_SCHEMA_APPEND_BODY`；`422/OVERLAY_ONLY_KEY`、`422/TABLE_NAME_MISMATCH`、`422/YAML_PARSE_ERROR`、`422/SCHEMA_APPEND_UNKNOWN_KEY`；全程 `no-disk-write`（夹具 md5 不变） |
| STA-05（404/409 归一化，不 500） | PASS | 7 checks 全 ok：import 未知 source → `404/SOURCE_NOT_FOUND`＋`nextSteps=["POST /api/schema-manifests/demo-mysql/uat_sta/tables"]`；GET／PUT／import／append 对不存在 manifest 四路径均 `404/SCHEMA_MANIFEST_NOT_FOUND`（非 500）；歧义 → `409/AMBIGUOUS_SCHEMA` |
| STA-06（三段名＋大小写归一＋遮蔽警告） | PASS | 7 checks 全 ok：大写请求 GET 归一为 `uat_sta_tbl_001`（200）；经大写请求追加成功；三段名逐字保留；dryRun 警告 `EXISTING_STANDALONE_SHADOW`（file `semantic-layer/demo-mysql/uat_sta_shadow.yaml`，hint「同连接存在同名 standalone 文件，将遮蔽刚追加的 Manifest 定义；可经 DELETE /api/semantic-assets/overlay/<conn>/<table> 清理」）；write 不被阻塞（200）；write 亦带警告；节点落盘 |
| STA-07（写管线审计／恢复／无表级快照） | PASS | 9 checks 全 ok：审计行 `id=205`、`ts=2026-11-26T02:22:44.957Z`、`actor=xingchen`、`actorType=ui_admin`、`source=schema_manifest_append_api`；审计含 actor／target（`demo-mysql:uat_sta:uat_sta_shadow` 等，仅相对路径）；`audit-no-credential`；`audit-no-absolute-path`；`no-table-yaml-snapshot=[]`（追加不产生表级 YAML 版本快照）；失败注入 → `500` 非 2xx；`no-partial-file`（无半写节点）；恢复后重放 `replay-after-recovery-ok=200` |

## 缺口

- **GAP-STA-02-DISCOVER**：追加后 `discover_data` 被本实例敏感元数据策略拒绝（`sensitive_metadata_forbidden`），新增表经 `discover_data` 的可见性未在本实例证实；可见性已由 `lucy_read_source`（返回 `v_token_income_unified` yaml）与 `/api/sources`／catalog（`catalog-has-new-table`）证实。关闭条件：本实例策略允许 `discover_data` 后复验，或委托人明示接受该口径。

## 证据清单

- 判定：`inbox/uat-p189-90-91-20261126/sta-verdict.json`
- 执行器：`inbox/uat-p189-90-91-20261126/run-sta.mjs`

## 环境注记

- **隔离栈**：`lucy-uat-p19x` 为独立 compose project＋独立 volume，不与共享 demo（`http://127.0.0.1:55176`）共享数据面；地址端口见元数据「环境」行。
- **共享 demo 注记**：共享 demo 在 docker.io 不可达窗口期经本地重打基础镜像升级（`gitSha=b4bc7c6e`，dirty；含 A／B／C 代码但不含 OPG 删除管线 TOCTOU 复验之后修复），且存在并发会话实验；本跑次因此全部在隔离栈执行。共享 demo 是否升级到 `c033eb97` 由委托人择时决定，不在本跑次范围。
- **夹具与还原**：夹具为 100 表三段名 catalog（`uat_sta` schema manifest）＋写失败注入；测试表 `v_token_income_unified`／`uat_sta_tbl_001`／`uat_sta_shadow` 等均限隔离栈；探针身份跑后禁用；夹具随隔离栈生命周期存在，不落共享态。
- **探针 Agent 禁用**：探针 Agent `uat_probe_p19x` 在跑次结束后已禁用。

## 边界与结论

- **套件结论：PASS WITH GAP**（UAT-R0／STA-01–07 全绿；唯一缺口 GAP-STA-02-DISCOVER 如上）。
- 本跑次为隔离 Docker demo 全真验收；未执行远端 CI、客户实例与其他数据库版本；未提交／推送。
- **≠ 功能合同收口；≠ 可上线。**
