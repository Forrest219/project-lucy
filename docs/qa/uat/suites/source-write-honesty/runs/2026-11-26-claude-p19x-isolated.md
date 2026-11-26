# Run — 2026-11-26 — Claude — UAT-SUITE-SOURCE-WRITE-HONESTY（隔离栈 p19x）

| 元数据 | 内容 |
|---|---|
| 总账 / REQ | P1-89／REQ-030-110 |
| 合同 | [Spec](../../../../specs/lucy-20261125-source-write-api-honesty-spec.md) SC-01–SC-08 · [Plan](../../../../plans/lucy-20261125-source-write-api-honesty-plan.md) |
| 环境 | 本机**隔离** Docker demo 栈 `lucy-uat-p19x`（独立 compose project／独立 volume）：WebUI `http://127.0.0.1:55186`、MCP `http://127.0.0.1:57891/mcp`、demo-db 宿主端口 `53316`、容器 `lucy-uat-p19x-lucy-1`；lean 档；探针 Agent `uat_probe_p19x`（跑后已禁用）；共享 demo（`:55176`）注记见「环境注记」 |
| 候选 | 镜像 `project-lucy:demo`；`gitSha=c033eb97eeabd60c01c9a6aaf29bf5027ce7d0e1`（dirty＝共享工作树其他在途任务） |
| 变体 | lean 档（非 scale）；API 直连＋`run-swh06-browser.mjs` 真实前台浏览器（Playwright Chromium 1920×1080）仅 SC-08 |
| 总判定 | **PASS**（UAT-R0／SWH-01–05 全绿＋SWH-06 浏览器三态全绿）；≠ 功能合同收口；≠ 可上线 |

## 执行顺序与结果

执行器：`inbox/uat-p189-90-91-20261126/run-swh.mjs`（主判定 `inbox/uat-p189-90-91-20261126/swh-verdict.json`，executedAt `2026-11-26T02:23:57.987Z`）；SWH-06 由 `inbox/uat-p189-90-91-20261126/run-swh06-browser.mjs` 执行（判定 `inbox/uat-p189-90-91-20261126/browser/swh06-verdict.json`，executedAt `2026-11-26T02:24:14.075Z`）。

| 用例 | 结果 | 关键证据（verdict checks 摘要） |
|---|---|---|
| UAT-R0 | PASS | `health-200`；`gitSha-recorded=c033eb97eeabd60c01c9a6aaf29bf5027ce7d0e1`；`sources-200`；`target-table-present`（demo-mysql/dataforai/superstore_orders，qualifiedName `dataforai.superstore_orders`） |
| SWH-01（诚实零写入：dryRun／无变更 PUT） | PASS | 10 checks 全 ok：`written:false`、`noChanges:true`、`writtenFiles:[]`、响应无 `version` 字段、`versions-unchanged "5 -> 5"`、manifest 字节 md5 前后一致（`39d21975aad9cf45bdd1a916fac9316e`）、overlay 字节 md5 前后一致（`fe91aade870b3e3f03fc3cefc70254d3`） |
| SWH-02（错误引导：yaml 字段误用与修复载荷） | PASS | 10 checks 全 ok：PUT yaml 字段 → `400/INVALID_SOURCE_PATCH_BODY`；message「无法识别的字段 yaml；修改表描述请用 patch.tableDescription，列描述请用 patch.columns[].description」；`nextSteps=["PUT /api/sources/<conn>/<schema>/<table> with { patch: { tableDescription }, dryRun }"]`；`allowedKeys=["patch","dryRun","restoredFromVersionId"]`；`put-model-dryRun-400`、`import-patch-400`、`import-message-hints-yaml`（导入请传 yaml 字段）、`import-nextSteps`、`import-model-400` |
| SWH-03（patch.tableDescription 落盘与版本快照） | PASS | 9 checks 全 ok：`written:true`；`writtenFiles=["semantic-layer/demo-mysql/_schema/dataforai.yaml"]`；版本快照 `20261126T022327822Z-c7 -> 20261126T022354040Z-95`；manifest human 描述 stamp 落盘；`descriptions-ai-preserved`（ai key 保留）；`manifest-changed-vs-baseline`（disk changed） |
| SWH-04（导入三路分派与 D3a 免除合并） | PASS | 14 checks 全 ok：A 结构片段导入无 `IMPORT_SCHEMA_KEYS_IGNORED` 警告且 manifest 更新；B 业务 source 导入 → 警告 `IMPORT_SCHEMA_KEYS_IGNORED`（`keys=["columns"]`，hint「业务 source 导入（含 grain/measures/segments）时 columns 不写入 Manifest；结构片段（仅 descriptions/columns/joins）导入或 PUT patch 可写」）＋ descriptions 免除合并（D3a）＋ overlay 写入（含 measure）；C 业务导入不改 manifest（`C-manifest-no-diff`）且无警告；`empty-yaml-400/INVALID_IMPORT_YAML` |
| SWH-05（dryRun 诚实性：diff／files／不落盘） | PASS | 9 checks 全 ok：零变更 → `noChanges:true`、`diff:""`、`files:[]`；有变更 → `noChanges:false`、diff 非空（`Index: semantic-layer/demo-mysql/_schema/dataforai.yaml…`）、files 非空；`no-disk-write`（manifest unchanged）；`no-new-version`（versions unchanged） |
| SWH-06（真实前台浏览器三态＋计时，SC-08） | PASS | 判定 `browser/swh06-verdict.json`：导航→语义编辑器内容可见 **242 ms**；有变更保存→「已保存到语义层」可见 **1829 ms**（PUT 200）；无变更保存→「内容无变更，未写入」可见 **1816 ms**（PUT 200）；写失败注入→错误提示可见 **53 ms**（「保存失败：EACCES: permission denied, open '/data/lucy/config/semantic-layer/demo-mysq…」，PUT 500）；`failure-no-write`（grep 命中=0，失败保存未落盘）。API 分列：5 次 PUT 对 `/api/sources/demo-mysql/dataforai/superstore_orders`，4×200＋1×500。截图：`inbox/uat-p189-90-91-20261126/browser/01-changed.png`／`02-no-change.png`／`03-failure.png` |

## 缺口

- 无本套件缺口。R0／SWH-01–05 及 SWH-06 三态＋计时全部 PASS。

## 证据清单

- 主判定：`inbox/uat-p189-90-91-20261126/swh-verdict.json`
- SWH-06 判定：`inbox/uat-p189-90-91-20261126/browser/swh06-verdict.json`
- SWH-06 截图：`inbox/uat-p189-90-91-20261126/browser/01-changed.png`、`02-no-change.png`、`03-failure.png`
- 执行器：`inbox/uat-p189-90-91-20261126/run-swh.mjs`、`inbox/uat-p189-90-91-20261126/run-swh06-browser.mjs`

## 环境注记

- **隔离栈**：`lucy-uat-p19x` 为独立 compose project＋独立 volume，不与共享 demo（`http://127.0.0.1:55176`）共享数据面；地址端口见元数据「环境」行。
- **共享 demo 注记**：共享 demo 在 docker.io 不可达窗口期经本地重打基础镜像升级（`gitSha=b4bc7c6e`，dirty；含 A／B／C 代码但不含 OPG 删除管线 TOCTOU 复验之后修复），且存在并发会话实验；本跑次因此全部在隔离栈执行。共享 demo 是否升级到 `c033eb97` 由委托人择时决定，不在本跑次范围。
- **夹具与还原**：本套件仅触碰 `demo-mysql/dataforai/superstore_orders` 的 manifest／overlay／版本快照（SWH-03 写入的描述与版本随隔离栈生命周期存在，不落共享态）；测试表无新增连接、无新增身份残留。
- **探针 Agent 禁用**：探针 Agent `uat_probe_p19x` 在跑次结束后已禁用。

## 边界与结论

- **套件结论：PASS**（UAT-R0／SWH-01–06 全绿；SWH-06 为真实前台浏览器三态＋计时，与 API 耗时分列）。
- 本跑次为隔离 Docker demo 全真验收；未执行远端 CI、客户实例与其他数据库版本；未提交／推送。
- **≠ 功能合同收口；≠ 可上线。**
