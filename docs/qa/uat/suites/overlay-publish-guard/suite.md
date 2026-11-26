# UAT-SUITE-OVERLAY-PUBLISH-GUARD — overlay 发布护栏与 per-table overlay 生命周期

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-OVERLAY-PUBLISH-GUARD` |
| 总账 ID | **P1-91**／REQ-030-112 |
| 目标 | 验证：overlay 物理名两段／三段规则（D1 方案 A）、validate `MANIFEST_SHADOW` warnings、publish 双 409 门禁（覆盖门禁＋同名 shadow，`pendingConfirmations` 组合确认、`allowManifestShadow`、snapshot 保留）、`plans/:validationId` 409/404 区分、per-table overlay 只读盘点（`GET /api/semantic-assets/overlays`）与受控删除（`DELETE /api/semantic-assets/overlay/:conn/:sourceName`，业务合并型 overlay 防误删），及既有路径回归 |
| 合同回链 | Spec [`lucy-20261125-overlay-publish-guard-spec.md`](../../../../specs/lucy-20261125-overlay-publish-guard-spec.md) · Plan [`lucy-20261125-overlay-publish-guard-plan.md`](../../../../plans/lucy-20261125-overlay-publish-guard-plan.md) |
| cases | [cases.md](cases.md) |
| runs | [runs/](runs/)（尚无跑次；**NOT RUN**） |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-OPG-01～08 | 无 |

## 边界

- **环境要求**：本机隔离 Docker demo（纯 API＋MCP `:57881`，**无 WebUI 浏览器面**）。本套件为纯服务端 API 能力，不触发浏览器＋计时强制。
- **SC-02 引擎实证输入**：三段名 standalone 运行时实证引用 [`inbox/p191-task0/RECORD.md`](../../../../../inbox/p191-task0/RECORD.md)（Task 0 通过，方案 A 成立：KTX 0.16.0 原样解析、`sl_query` 执行成功 142.5、`sl_read_source` 原样返回）；UAT 跑次按 SC-02 口径在 demo 引擎上复核并挂该记录为输入。
- **夹具要求（用 demo 现成连接，不另建 fixtures.md）**：
  - 「manifest 100 表连接上误发同名 overlay」：在含既有表节点的 Schema Manifest 连接上，publish 与 manifest 表同名的 standalone overlay，触发双 409 门禁与组合确认放行（SC-03／SC-06）。
  - 「预置业务合并型 overlay（无 `table:`/`sql:`）」：验证列表 `kind: "merge_overlay"` 标注与未确认删除 `409 OVERLAY_BUSINESS_ENRICHMENT_PROTECTED`（SC-07）。跑次结束须还原夹具。
- **禁止**：用 vitest／CR 冒充本套件 PASS；跑次不得写入凭据明文。
- **≠** 可上线；**≠** 功能合同收口；登记本套件 **≠** 开发授权。
