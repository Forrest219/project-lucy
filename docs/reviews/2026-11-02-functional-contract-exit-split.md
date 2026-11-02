# 功能合同出口拆分 — 通过记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-02 |
| 授权 | 把客户升级、现场扩权、过程门禁从功能合同出口拆出，并改记通过记录 |
| 口径 | 与 [运维问数收口](2026-11-02-ops-evidence-askable-governance-closure.md) 相同。本机就能打假的产品不变量留下。客户现场、升级手册、扩完权再查一次、仓库门禁退出码，不进功能合同出口 |
| 结论 | **只改出口归属，不新收口任何功能。** 拆出 ≠ 通过。原先未执行的编号仍然未执行。原先已有行为断言的编号，通过结论不变 |

本记录是这些编号的现行归属。旧收口记录里若把同一编号写成通过或 `blocked`，以本表为准。当时的命令输出不删除，改记为过程证据。

## 客户升级

| 文件 | 编号 | 现行归属 | 留下的不变量 |
|---|---|---|---|
| `docs/specs/lucy-20261025-v0p25-oidc-single-sign-on-spec.md` | OIDC-22、OIDC-23、OIDC-24、OIDC-25 | **拆出**，归交付。原状态未执行；OIDC-24／25 不再以 `blocked_environment` 挂在功能合同上 | OIDC-21：Chart 渲染不注入明文 secret、缺 Secret 时渲染失败 |
| `docs/specs/lucy-20261027-v0p25-semantic-release-restore-spec.md` | SRR-22 | **拆出**。客户 linux/amd64 Helm 上的 30 表旅程归交付。原状态未执行 | SRR-01–21、SRR-23–24 仍是功能合同，且仍未执行 |
| `docs/specs/lucy-20261025-v0p25-smtp-notifications-spec.md` | SMTP-24 的「无公网可启动和本地登录」；SMTP-25 的真实备份往返与真实 `helm rollback`；SMTP-26 整行 | **拆出**。不再以部分通过或 `blocked` 挂起功能合同 | SMTP-22／23 的 `helm template`；SMTP-24 的 probes 不访问 SMTP；SMTP-25 的本机审计库 schema 与备份清单保留 outbox。这些在 [SMTP 收口](2026-11-01-smtp-notifications-closure.md) 里已有断言，通过结论不变 |

## 过程门禁

仓库 `lint:*` 退出码、构建、typecheck、落盘清单 11 项，都不是用户可观察承诺。专用规则门禁若就是这条承诺的打假手段，则留下。

| 文件 | 编号 | 现行归属 |
|---|---|---|
| `docs/specs/lucy-20261101-token-renewal-spec.md` | SC-25；§7 落盘清单 | **拆出**。续期尚未实施，SC-01–SC-24 仍未执行 |
| `docs/specs/lucy-20261101-token-default-ttl-365-spec.md` | SC-08 的术语 lint；§4 落盘清单 | **拆出**。SC-08 的 Step6 短窗回归留下，仍未执行 |
| `docs/specs/lucy-20261101-access-map-chart-first-spec.md` | SC-14 | **拆出**。SC-01–SC-13 的组件与布局断言维持通过（46/46 中属于这些 SC 的部分；命令记录见实施笔记 §六，不重跑） |
| `docs/specs/lucy-20261101-access-map-geometry-spec.md` | SC-15 | **拆出**。SC-01–SC-14 与截图 SC-16 仍在出口。Spec 状态行仍是待实施；实施笔记里的术语 lint 退出码改记为过程记录 |
| `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md` | SC-16 | **拆出**。SC-01–SC-15 维持已验收。SC-15 的源码色值扫描是行为检查，留下 |
| `docs/specs/lucy-20261101-new-token-expiry-preset-ux-spec.md` | SC-06 | **拆出**。SC-01–SC-05 维持通过（`new-token.test.tsx`） |
| `docs/specs/lucy-20261101-agent-admin-high-priv-copy-ux-spec.md` | SC-12 | **拆出**。SC-01–SC-11 维持通过（组件测试 69/69） |
| `docs/specs/lucy-20261030-row-policy-view-presentation-spec.md` | SC-18 | **拆出**。SC-01–SC-17、SC-19–SC-23 维持原通过记录 |
| `docs/specs/lucy-20261031-help-center-experience-spec.md` | `lint:terminology`、`lint:spec-docs`、`lint:ia-boundary` | **拆出**。`lint:handbook-anchors` 的深链规则留下，它打假「旧深链零失效」。SC-01–SC-20 仍未执行 |
| `docs/specs/lucy-20261025-v0p25-skill-owner-spec.md` | SKO-16 | **拆出**。原「通过」是 build、四类 lint 与 selector contract 新增 0 条，改记为过程证据。SKO-01–SKO-15 维持通过 |
| `docs/specs/lucy-20261029-question-budget-window-optimization-spec.md` | 出口句末的 `lint:terminology` | **拆出**。SC-01–SC-48 维持通过 |
| `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md` | 出口句里的术语 lint、IA lint、typecheck、build | **拆出**。PWB 编号的通过／部分通过结论不变 |
| `docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md` | SC-21 里的 `lint:terminology`、`lint:ia-boundary`、远端 CI | **拆出**。`lint:url-driven-input` 留下，它打假受控输入框写法。SC-01–SC-20、SC-22–SC-23 维持通过 |
| `docs/specs/lucy-20261030-access-grade-and-daily-question-kpi-spec.md` | 出口句末的 `lint:terminology` | **拆出**。SC-01–SC-24、SC-26 维持通过 |
| `docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md` | VOPS-27 | **拆出**。原状未执行。`access.yaml` 与代码分类若要单独打假，另用行为断言，不把 `lint:spec` 退出码写回出口 |
| `docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md` | VOPS-30 | **拆出**，归交付。客户 linux/amd64 真实 Agent 取证。原状未执行 |
| `webui/docs/187-access-relation-sankey-spec.md` | SC-11 | **拆出**。术语仍须登记在术语标准，登记动作不是用户出口 |
| `webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md` | SC-18 的术语 lint 与构建 | **拆出**。`kpi-contracts` 与本条相关测试留下 |
| `webui/docs/144-skill-hub-mvp-spec.md` | SC-144-07 的术语 lint | **拆出**。导航测试留下 |
| `webui/docs/147-skill-file-management-spec.md` | SC-147-08 的术语 lint | **拆出**。Skill 管理 vitest 留下 |
| `webui/docs/156-runtime-status-usage-boundary-spec.md` | SC-10 | **拆出**。整行只有术语 lint |
| `webui/docs/192-clipboard-non-secure-context-fallback-spec.md` | AC-11 | **拆出**。单测已在 AC-08 |
| `webui/docs/190-live-table-discovery-and-continuous-sync-spec.md` | §12 的 `lint:terminology`、`lint:spec` 必须绿 | **拆出**。没有单独编号 |

## 这次没有改归属的

- 现场扩权：除运维问数已拆的 SC-17d 外，没有第二条「扩完权再查」的验收编号。Spec 149 的 ensure 不改 `access.yaml` 留下。
- 升级 E2E、升级候选验证、客户 amd64 离线交付：层级就是交付或发布取证。
- `lint:url-driven-input`、`lint:handbook-anchors` 的深链扩展、SMTP 的 `helm template`、构建修订 SC-5：本机能打假的规则，留在出口。
- 共享开发基线的 SC-D08、SC-L07：前者打假这两份文档的形态，后者是这条基线自己要交付的 runbook。
- 语义批量维护的 V22 已在 FC-01–FC-32 之外，由 `SEM25` 持有。这次不改它的通过结论。

## 审计增量（L25-09）

功能合同仍是 S01–S07，通过结论不变。整库故障演练、历史回放和客户单副本重跑留在同一份 Spec 正文里，所以这条看起来还没收口。这次只改归属。

| 文件 | 编号 | 现行归属 | 留下的不变量 |
|---|---|---|---|
| `docs/specs/lucy-20261020-v2p5-audit-increment-spec.md` | A01–A12；U9 的 Stage 1、Stage 2；客户 linux/amd64 单副本重跑 | **拆出**，归发布取证。原状态未执行，不改成通过。场景文本留在 Spec §11、§13.2。执行编号 `AUD25-A01`…`AUD25-A12` 由 E2E 主线持有，仍未执行 | S01–S07 的本机断言维持通过。`audit-v025-fault-injection.test.ts` 的 4 条只打假本机恢复不变量，不关闭 A01–A12。`lint:spec-docs` 不在出口 |

## 不在这次记录里

没有重跑测试，没有改运行代码，没有把未执行矩阵收成通过。本记录不表示任何一条可上线，也不构成客户包验收。
