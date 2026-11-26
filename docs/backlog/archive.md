# Lucy 常青需求池 — 历史归档（Archive）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 常青需求池沉降归档（已随版本正式发布或已退出 `X_DEF`／`X_SUP` 的条目）。保持完整可追溯，不承载仍在途的 S1–S4 需求 |
| 版本 / 日期 | v1.0 / 2026-11-26 |
| 状态 | S5｜生效归档（承接自 0.30 总账退出的 18 条 `X_DEF`／`X_SUP` 条目；后续随版交付条目发版收尾时批量沉降入本表）。**≠ 可上线** |
| 授权边界 | 归档条目均无现行开发授权；如需重启须先回迁活跃池并重新走 Spec→Plan→终稿确权→开发授权 |

## 归档条目表

| 稳定 ID | 历史别名 | 类型 | 优先级 | 标题 | 漏斗阶段 | 目标版本 | 关联文档 |
|---|---|---|---|---|---|---|---|
| REQ-030-092 | P1-71 | 需求 | P1 | SQLite 风险防范与 PostgreSQL 迁移准备 | X_DEF｜ | — | [Spec](../specs/lucy-20261120-storage-readiness-spec.md) · [Plan](../plans/lucy-20261120-storage-readiness-plan.md) |
| REQ-030-014 | P1-7 | 需求 | P1 | 行权限模板展开保留 templateRefs | X_DEF｜ | — | [Plan](../plans/lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) |
| REQ-030-031 | P1-10 | 需求 | P1 | 轻量概念注册表（ontology-lite；上游合同） | X_DEF｜ | — | [Spec](../specs/lucy-20261108-concept-registry-ontology-lite-spec.md) · [Plan](../plans/lucy-20261108-concept-registry-ontology-lite-plan.md) |
| REQ-030-032 | P1-11 | 需求 | P1 | 概念注册表接入 Lucy Ops 控制面 | X_DEF｜ | — | [Spec](../specs/lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md) · [Plan](../plans/lucy-20261109-concept-registry-lucy-ops-control-plane-plan.md) |
| REQ-030-071 | P1-50 | 需求 | P1 | 重建快照上界与完成水位不一致：并发新增调用未入推断却被标已覆盖（FDE R01／P0） | X_SUP｜ | — | [Plan](../plans/lucy-20261118-fde-pack-gate-parallel-plan.md) |
| REQ-030-076 | P1-55 | 需求 | P1 | FDE 3b1c62af 打包前检查本机复现 UAT | X_DEF｜ | — | [Plan](../plans/lucy-20261119-fde-3b1c62af-local-repro-uat-plan.md) |
| REQ-030-078 | P1-57 | 需求 | P1 | FDE 修复复评整改：单表拒绝后的合法表续读、按进展收敛与验收补齐 | X_DEF｜ | — | [Plan](../plans/lucy-20261119-fde-acceptance-remediation-plan.md) |
| REQ-030-077 | P1-56 | 需求 | P1 | FDE 3b1c62af 候选缺陷补录：F01 正式导出等待追平／F02 慢合法 Hive 语法回退／… | X_DEF｜ | — | [Plan](../plans/lucy-20261119-fde-3b1c62af-contract-remediation-plan.md) |
| REQ-030-050 | P1-29 | 需求 | P1 | 行级取值存在性校验 | X_DEF｜ | — | [`UAT-SUITE-R](../qa/uat/suites/row-policy-finance-scenario/suite.md) |
| REQ-030-002 | P2-2 | 需求 | P2 | 帮助中心体验 | X_DEF｜ | — | [Spec](../specs/lucy-20261031-help-center-experience-spec.md) · [Plan](../plans/lucy-20261031-help-center-experience-plan.md) |
| REQ-030-004 | P2-3 | 需求 | P2 | 运维控制面 W-B（语义发布） | X_DEF｜ | — | — |
| REQ-030-005 | P2-4 | 需求 | P2 | 客户升级 E2E 自动化 | X_DEF｜ | — | — |
| REQ-030-006 | P2-5 | 需求 | P2 | 升级候选验证环境 | X_DEF｜ | — | — |
| REQ-030-007 | P2-6 | 需求 | P2 | E2E 主线与旁线优化 | X_DEF｜ | — | — |
| REQ-030-008 | P2-7 | 需求 | P2 | 访问关系图 Spec 187 验收矩阵 | X_DEF｜ | — | [Plan](../plans/lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) |
| REQ-030-009 | P2-8 | 需求 | P2 | OIDC 功能合同验收 | X_DEF｜ | — | — |
| REQ-030-010 | P2-9 | 需求 | P2 | 语义整批恢复 SRR 验收 | X_DEF｜ | — | — |
| REQ-030-011 | P2-10 | 需求 | P2 | 运维控制面 W-A VOPS 验收 | X_DEF｜ | — | — |
