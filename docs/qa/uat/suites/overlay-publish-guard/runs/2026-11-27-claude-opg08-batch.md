# 跑次：2026-11-27 claude OPG-08 batch round-trip 收口（GAP-OPG-08-BATCH 关闭）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-OVERLAY-PUBLISH-GUARD` |
| 日期／Agent | 2026-11-27／Claude（kscc） |
| 环境 | 隔离栈 `lucy-uat-p19x`（全新重建，`project-lucy:uat-closure`；WebUI `:55186`）；`gitSha=8b8fb83c`／dirty（docs-only） |
| 判定 | **GAP-OPG-08-BATCH 关闭**（本跑次只覆盖 SC-08 step3 batch 维护包 round-trip 实跑；其余 OPG 用例沿用 2026-11-26 跑次证据） |

## round-trip 实跑（带真实变更）

执行器：`inbox/uat-closure-20261127/opg08-batch3.mjs`；判定 `inbox/uat-closure-20261127/opg08-batch-verdict.json`（ALL CHECKS OK）。

| 步骤 | 结果 | 证据 |
|---|---|---|
| 变更构造 | ok | 在 `superstore_orders.yaml`（merge overlay）`segments:` 前插入探针 measure `uat_opg08_probe_measure`＋catalog reload |
| scopes | 200 | `scope_20261126_181028_*`（refs＝demo-mysql/dataforai/superstore_orders） |
| export（维护包） | 200 | `packageKind=semantic-maintenance-package/v1`；`exportId=exp_20261126_181128_*`；downloadUrl 返回 |
| download | 200 | zip 11.6 KB，PK 魔数 |
| 还原基线 | ok | overlay 还原原文＋reload（探针 measure 移除） |
| validate 回灌 | 200 | **`status=staged`、`noChange=false`**（对照：无差异回灌获 `no_change=true`，幂等回放语义正面留证） |
| publish | 200 | 携带 `planDigest`；`releaseId=rel_20261126_181128_626_71e90804`；release 终态 `published` |
| 盘上核对 | ok | overlay 文件重新含探针 measure（round-trip 还原变更成功） |
| 审计（双路） | ok | API 面：`semantic_publish_terminal` 行含该 releaseId（committed 可见）；审计库直查：`semantic_batch_exported`／`semantic_batch_staged` 行存在且含本 scopeId/exportId；无凭据／无绝对路径 |

## 过程发现（登记，不在本跑次修复）

- **F2（产品观察项）**：`semantic_batch_*` 审计行（exported／staged／validated）`write_status` 恒为 `pending`，而 `/api/admin/config-audit` 仅返回 `committed` 行——batch 导出/暂存审计在 API 面不可见（数据在 `audit.sqlite` 完整保留）。是否需要终态更新或 API 放行，交委托人裁定；登记错题本候选。
- 维护包 round-trip 的发布契约：batch staged 发布必须携带 validate 响应的 `planDigest`（`SEMANTIC_PLAN_DIGEST_MISMATCH` 拒绝裸 validationId）。
- merge overlay 变更须落在正确的 YAML 缩进层（首次误将 measure 追加进 `joins:` 列表导致 `reindex_failed`，已修正插入点重跑）。

## 边界与结论

- **GAP-OPG-08-BATCH：关闭**（真实 batch 维护包 round-trip 实跑证据取代自动化层佐证）。
- **GAP-OPG-02-ENGINE：维持**（demo MySQL 引擎不支持三段名 `lucy_query` 引擎面查询；Task 0 实证口径待委托人裁定，关闭条件不变）。
- 套件总判定由 **PASS WITH GAP** 收窄为仅剩 GAP-OPG-02-ENGINE 一项。
- **≠ 功能合同收口；≠ 可上线。**
