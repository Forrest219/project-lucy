# Run — 2026-11-26 — Claude — UAT-SUITE-OVERLAY-PUBLISH-GUARD（隔离栈 p19x）

| 元数据 | 内容 |
|---|---|
| 总账 / REQ | P1-91／REQ-030-112 |
| 合同 | [Spec](../../../../specs/lucy-20261125-overlay-publish-guard-spec.md) SC-01–SC-08 · [Plan](../../../../plans/lucy-20261125-overlay-publish-guard-plan.md) |
| 环境 | 本机**隔离** Docker demo 栈 `lucy-uat-p19x`（独立 compose project／独立 volume）：WebUI `http://127.0.0.1:55186`、MCP `http://127.0.0.1:57891/mcp`、demo-db 宿主端口 `53316`、容器 `lucy-uat-p19x-lucy-1`；lean 档；探针 Agent `uat_probe_p19x`（跑后已禁用）；共享 demo（`:55176`）注记见「环境注记」 |
| 候选 | 镜像 `project-lucy:demo`；`gitSha=c033eb97eeabd60c01c9a6aaf29bf5027ce7d0e1`（dirty＝共享工作树其他在途任务） |
| 变体 | lean 档（非 scale）；纯 API＋MCP（无浏览器面） |
| 总判定 | **PASS WITH GAP**（UAT-R0／OPG-01–08 全绿；GAP-OPG-02-ENGINE／GAP-OPG-08-BATCH）；≠ 功能合同收口；≠ 可上线 |

## 执行顺序与结果

执行器：`inbox/uat-p189-90-91-20261126/run-opg.mjs`（判定 `inbox/uat-p189-90-91-20261126/opg-verdict.json`，executedAt `2026-11-26T02:21:22.838Z`）。

| 用例 | 结果 | 关键证据（verdict checks 摘要） |
|---|---|---|
| UAT-R0 | PASS | `health-200`；`gitSha=c033eb97eeabd60c01c9a6aaf29bf5027ce7d0e1`；`sources-200`；`mcp-57891-reachable=200` |
| OPG-01（两段／三段物理名与段数校验） | PASS | 11 checks 全 ok：三段 `dataforai.dbo.uat_opg_phys` 校验 200、发布 200、磁盘逐字保留；两段 `dataforai.uat_opg_phys` 校验 200、发布 200、逐字保留；一段 → `422/OVERLAY_MISSING_TABLE`（message「overlay 缺少合法的 <schema>.<table> 或 <db>.<schema>.<table> 引用（两段或三段）：onlyonetable」）；四段 → 422 |
| OPG-03（MANIFEST_SHADOW 409→确认覆盖→落盘；执行序先于 OPG-02） | PASS | 12 checks 全 ok：validate `200/valid`＋`MANIFEST_SHADOW` 警告及后果文案（「…发布落盘后将整体替换 manifest 定义（standalone shadow），catalog 不显示该文件；确需覆盖请在 pub…」）；发布 → `409/OVERLAY_MANIFEST_CONFLICT`，`pendingConfirmations=["allowManifestShadow"]`；`nextSteps` 数组（追加／import／携带 allowManifestShadow 重试／DELETE 清理）；未确认前 `not-landed`；同 validationId 重试 200；release 带 shadowWarnings 及回落清理指引；确认后落盘 |
| OPG-02（同名遮蔽下引擎读路径） | PASS WITH GAP | 2 checks 全 ok：`lucy_read_source` 200（yaml `table: dataforai.dbo.shadow_probe`）；`shadow-effective-physical`（standalone 遮蔽 manifest 生效）。verdict note：「执行序：在 OPG-03 落盘后执行（未入 catalog 的 standalone 被 ACL 拒绝＝F1 后果实证，故以同名遮蔽场景验证引擎读路径）；lucy_query 引擎面按 SC-02 引用 Task 0 RECORD（MySQL 引擎不支持三段名查询）」。**GAP-OPG-02-ENGINE**：`lucy_query` 引擎三段名查询在 demo MySQL 引擎不可执行，以 Task 0 实证承载——Task 0 RECORD（`inbox/p191-task0/RECORD.md`）：KTX `@kaelio/ktx@0.16.0` 对三段物理表名 `internal.p189lab.t_orders` 逐字解析并执行，`sl_query rows=[[142.5]]`（100.5＋42）、`sl_read_source` 逐字保留（隔离 Doris FE/BE＋容器 `lucy-p191-task0`），方案 A 成立；Lucy demo 引擎侧待 MySQL 引擎支持三段名后补验 |
| OPG-04（删除回落 manifest） | PASS | 8 checks 全 ok：DELETE 200、`deleted-true`；`deletedFiles=["semantic-layer/demo-mysql/superstore_orders.yaml"]`；`kind=standalone`；回落文案「该表读取已回落 Schema Manifest 定义」；`file-gone`（residual=ABSENT）；`lucy_read_source` 读回落后的 manifest 定义（200）；catalog 行为不变（manifest 表仍在列） |
| OPG-05（删除安全边界与审计） | PASS | 11 checks 全 ok：未知参数 → `400/INVALID_OVERLAY_DELETE_QUERY`＋nextSteps；不安全路径段 → `400/OVERLAY_DELETE_FORBIDDEN`；不存在 → `404/OVERLAY_NOT_FOUND`；dryRun 返回 diff envelope 且不落盘（file still there）；真实删除 200；审计行 `id=168`、`ts=2026-11-26T02:21:12.444Z`、`actor=xingchen`、`actorType=ui_admin`、`source=semantic_overlay_lifecycle_api`；`audit-no-creds`；`audit-no-absolute-path`（仅相对路径） |
| OPG-06（防误删护栏：双 409 组合确认） | PASS | 9 checks 全 ok：目标文件已存在 → `409/VALIDATION_GATE_FAILED`（「存在已存在的目标文件，需先确认覆盖。」），`pending=["confirmOverwrite"]`，确认后重试 200；与 Manifest 同名叠加 → 双 409 `OVERLAY_MANIFEST_CONFLICT`，`pendingConfirmations=["confirmOverwrite","allowManifestShadow"]` 两项同时挂起，仅单确认不足以通过，补齐后重试 200；plans legacy → `409/PLAN_PREVIEW_NOT_AVAILABLE`＋nextSteps（publish with confirmOverwrite／重新 validate）；快照缺失 → `404/VALIDATION_SNAPSHOT_NOT_FOUND` |
| OPG-07（overlay 清单分类与 merge_overlay 保护） | PASS | 11 checks 全 ok：list 200；standalone 分类（`uat_opg_three_part`、kind `standalone`、physicalTable `dataforai.dbo.uat_opg_phys`、`shadowsManifest:false`）；merge 分类（`uat_opg_biz`、kind `merge_overlay`、`physicalTable:null`、`shadowsManifest:false`）；`_schema` 目录排除；未知参数 → `400/INVALID_OVERLAY_LIST_QUERY`；删除 merge_overlay 未确认 → `409/OVERLAY_BUSINESS_ENRICHMENT_PROTECTED`（kind `merge_overlay`，文件完整）；确认后删除 200；回落文案「该表业务合并口径已清除」 |
| OPG-08（发布回归＋batch 往返缺项登记） | PASS WITH GAP | 5 checks 全 ok：merge 导入 200 无警告；assets validate 200；普通发布 200 无 shadowWarnings（clean release）。verdict note：「batch 维护包 round-trip 子项未在本跑次执行（时间盒），既有 api.semantic-batch 套件全绿作为自动化层证据；缺口 GAP-OPG-08-BATCH」。**GAP-OPG-08-BATCH**：batch 维护包 round-trip 子项未在本跑次执行，以既有 `api.semantic-batch` 套件全绿作为自动化层佐证 |

## 缺口

- **GAP-OPG-02-ENGINE**：`lucy_query` 引擎面三段名查询在本跑次未在 demo 实例执行（demo 引擎为 MySQL，不支持三段名查询）；以 Task 0 实证（KTX 0.16.0 三段名逐字解析执行，`sl_query rows=[[142.5]]`）承载，按 Spec SC-02 登记。关闭条件：引擎支持三段名后在 demo 实例补验，或委托人明示接受 Task 0 实证口径。
- **GAP-OPG-08-BATCH**：batch 维护包 round-trip 子项未在本跑次执行（时间盒）；既有 `api.semantic-batch` 套件全绿作为自动化层佐证。关闭条件：真实 batch 维护包 round-trip 跑次补齐，或委托人明示接受佐证口径。

## 证据清单

- 判定：`inbox/uat-p189-90-91-20261126/opg-verdict.json`
- 执行器：`inbox/uat-p189-90-91-20261126/run-opg.mjs`
- Task 0 引擎实证：`inbox/p191-task0/RECORD.md`（OPG-02 引擎面证据）

## 环境注记

- **隔离栈**：`lucy-uat-p19x` 为独立 compose project＋独立 volume，不与共享 demo（`http://127.0.0.1:55176`）共享数据面；地址端口见元数据「环境」行。
- **共享 demo 注记**：共享 demo 在 docker.io 不可达窗口期经本地重打基础镜像升级（`gitSha=b4bc7c6e`，dirty；含 A／B／C 代码但不含 OPG 删除管线 TOCTOU 复验之后修复），且存在并发会话实验；本跑次因此全部在隔离栈执行。共享 demo 是否升级到 `c033eb97` 由委托人择时决定，不在本跑次范围。
- **夹具与还原**：夹具表 `uat_opg_phys`／`uat_opg_three_part`／`uat_opg_biz`／`uat_opg_del_target`／`uat_opg_bad` 等均限隔离栈；OPG-03 确认覆盖写入的 `superstore_orders.yaml` standalone 已在 OPG-04 删除回落，manifest 定义保留；探针身份跑后禁用。
- **探针 Agent 禁用**：探针 Agent `uat_probe_p19x` 在跑次结束后已禁用。

## 边界与结论

- **套件结论：PASS WITH GAP**（UAT-R0／OPG-01–08 全绿；缺口 GAP-OPG-02-ENGINE 以 Task 0 实证承载、GAP-OPG-08-BATCH 留自动化层佐证）。
- 本跑次为隔离 Docker demo 全真验收；未执行远端 CI、客户实例与其他数据库版本；未提交／推送。
- **≠ 功能合同收口；≠ 可上线。**
