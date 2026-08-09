# Lucy 访问权限域档案（Access Control）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 访问权限域档案索引 |
| 文档类型 | Other |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-08 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `docs/DEVELOPMENT.md` Spec 落位规则；访问权限升级设计 v1.1.2 |
| 适用范围 | 权限域文档入口；现行基线与交叉引用 |
| 输出位置 | `docs/access-control/README.md` |

---

## 0. 定位

本目录是 **访问权限（Access Control）域档案**，不是独立代码模块的 `*/docs/`。

| 放这里 | 不放这里 |
|---|---|
| 域设计 / ADR / 升级基线 | Proxy / Admin 的编号实现 Spec（仍在 `webui/docs/`） |
| UAT / Review / 差距分析 / 本域 WO | Agent Admin UX 抛光类 Spec（`webui/docs/14+`） |
| SUPERSEDED 历史附录 | 术语标准（仍在 `webui/docs/00-…`） |

原则：**域设计与审批基线在此；贴着 WebUI/Proxy 实现的契约 Spec 就近留在 `webui/docs/`，由本 README 交叉引用。**

---

## 1. 现行基线（先读）

| 优先级 | 文档 | 状态 |
|---|---|---|
| **P0 必读** | [`design-upgrade.md`](design-upgrade.md) **v1.1.2** | **ADR 已批准（Gate A）** |
| **P0 Runtime Spec** | [`webui/docs/98-access-control-p0-runtime-spec.md`](../../webui/docs/98-access-control-p0-runtime-spec.md) **v0.1** | **AC-P0 已交付**（Gate C 2026-08-09） |
| **P0 实施计划** | [`plans/wo-202608-59-access-control-p0.md`](plans/wo-202608-59-access-control-p0.md) | Gate A/B/C DONE；后续行级见 WO-60 |
| 术语 | [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md) §3 / §4.8 | AC-P0 术语已登记（v0.3） |
| 实现契约 | [`07`](../../webui/docs/07-mcp-auth-proxy-spec.md) / [`14`](../../webui/docs/14-agent-admin-enterprise-delivery-spec.md) / [`15`](../../webui/docs/15-role-admin-spec.md) | P0 以 Spec 98 为准；P1 以 Spec 99 为准 |
| UAT / Runbook（P0） | [`uat-ac-p0.md`](uat-ac-p0.md) / [`runbook-policy-degrade.md`](runbook-policy-degrade.md) | Gate C 已签字 |
| **AC-P1（已交付）** | [`plans/wo-202608-60-access-control-p1.md`](plans/wo-202608-60-access-control-p1.md) | Gate A/B/C **DONE**（2026-08-09）；签字 `inbox/20260809-ac-p1-gate-c-signoff.md` |
| **Gate A ADR** | [`adr-upstream-forced-predicate.md`](adr-upstream-forced-predicate.md) | v0.2.2；Lucy `filters[]` 载体；不以 Kaelio 发版为前置 |
| **AC-P1 Runtime Spec** | [`webui/docs/99-access-control-p1-row-policy-spec.md`](../../webui/docs/99-access-control-p1-row-policy-spec.md) | v0.1.2；Gate B 已批准 |
| **AC-P1.5 Runtime Spec** | [`webui/docs/100-access-control-p15-agent-constraints-spec.md`](../../webui/docs/100-access-control-p15-agent-constraints-spec.md) | v0.1.1；**Gate B 已批准**（2026-08-09） |
| **强制谓词载体证据** | [`evidence-ktx-forced-filters.md`](evidence-ktx-forced-filters.md) | Gate C 项 1：**Lucy** 对 bundled KTX 的 `filters[]` 前缀 + Proxy 测 |
| UAT / Runbook / Release（P1） | [`uat-ac-p1.md`](uat-ac-p1.md) / [`runbook-row-policy.md`](runbook-row-policy.md) / [`release-notes-ac-p1.md`](release-notes-ac-p1.md) | Gate C 已签字；proven 默认 false（置真=运维变更） |
| UAT / Runbook / Release（P1.5） | [`uat-ac-p15.md`](uat-ac-p15.md) / [`runbook-row-policy.md`](runbook-row-policy.md) 路径 D / [`release-notes-ac-p15.md`](release-notes-ac-p15.md) | Gate C 已签字；总签 `inbox/20260809-ac-p15-gate-c-signoff.md` |
| **AC-P1.5（已交付）** | [`plans/wo-202608-61-access-control-p15-agent-constraints.md`](plans/wo-202608-61-access-control-p15-agent-constraints.md) | Gate A/B/C **DONE**（2026-08-09）；签字 `inbox/20260809-ac-p15-gate-c-signoff.md` |
| **P1.5 后路线图（必读）** | [`adr-post-p15-roadmap-freeze.md`](adr-post-p15-roadmap-freeze.md) **v1.0** | **已批准（2026-08-09）**：冻结 TokenScope / Dynamic RLS / AC-P2+ 整包；优先单机部署落地 |
| **单机部署 Phase 0/1** | [`checklist-single-deploy-phase0-1.md`](checklist-single-deploy-phase0-1.md) | Phase 0 边界 + Phase 1 proven-off Compose 命令；**未验证前不 merge main** |
| **单机部署 Phase 2** | [`checklist-single-deploy-phase2.md`](checklist-single-deploy-phase2.md) | 真实/近似 `access.yaml` 挂载；Compose 身份登记；proven 仍 false |
| **单机部署 Phase 3/4** | [`checklist-single-deploy-phase3-4.md`](checklist-single-deploy-phase3-4.md) | Phase 3 proven 置真/回滚；Phase 4 合 main Allow/Deny 门禁 |

**冲突裁决：** 与 `design-upgrade.md` 冲突时，以 `design-upgrade.md` 为准，直至对应 Spec 同步更新。**P1.5 之后是否开 TokenScope / Dynamic RLS / P2+** → 以 [`adr-post-p15-roadmap-freeze.md`](adr-post-p15-roadmap-freeze.md) 为准。

**开波禁令：** **不得**仅凭 `design-upgrade.md` 直接开工改 `acl.ts` / `mcp-proxy.ts`。AC-P0/P1/P1.5 主线已交付；**禁止**默认续开 TokenScope、Dynamic RLS / 多租户、或 AC-P2+ 整包（见路线图冻结 ADR）。`feasibility-row-acl.SUPERSEDED.md` 禁止作为实施依据。

---

## 2. 目录清单

| 文件 | 说明 |
|---|---|
| `design-upgrade.md` | 访问权限升级主设计 v1.1.2（工具三分级、capability tuple、配置版本、收窄失败语义） |
| `design-governance-baseline.md` | 2026-06 权限治理闭环设计（role-first 基线；行级仅旧锚点） |
| `design-agent-permissions-v1.md` | Module 1 Agent 权限管控详细设计（历史） |
| `uat-agent-permissions-v1.md` | Module 1 UAT（表级 ACL；不含 Row Policy） |
| `review-agent-permissions-v1.md` | Module 1 代码审查报告 |
| `gap-analysis-202608.md` | 202608 Governance 差距分析（不含 Dynamic RLS） |
| `feasibility-row-acl.SUPERSEDED.md` | **SUPERSEDED**；不得作为实施依据 |
| `plans/` | 本域 Work Order |
| `adr-upstream-forced-predicate.md` | AC-P1 Gate A：上游强制谓词契约（已批准） |
| `adr-post-p15-roadmap-freeze.md` | AC-P1.5 后路线图冻结（TokenScope / Dynamic RLS / P2+；单机优先） |
| `checklist-single-deploy-phase0-1.md` | 单机部署 Phase 0 checklist + Phase 1 proven-off 命令清单 |
| `checklist-single-deploy-phase2.md` | 单机部署 Phase 2 真实配置落地清单 |
| `checklist-single-deploy-phase3-4.md` | 单机部署 Phase 3 proven 置真 + Phase 4 合 main 门禁 |
| `uat-ac-p1.md` | AC-P1 UAT 勾选清单 |
| `uat-ac-p15.md` | AC-P1.5 Agent Constraints UAT 勾选清单 |
| `release-notes-ac-p15.md` | AC-P1.5 发布说明（Non-Claim） |
| `runbook-row-policy.md` | AC-P1 行策略 / P1.5 Constraints（路径 D）恢复 Runbook |
| `plans/wo-202608-61-…` | AC-P1.5 Agent Constraints WO（已交付） |

---

## 3. 实现代码锚点（就近，不迁入本目录）

| 区域 | 路径 |
|---|---|
| 裁决 / source map | `webui/server/proxy/acl.ts` |
| Row Policy / FinalRows 载体 | `webui/server/proxy/row-policy.ts` |
| Agent Constraints / FinalRows AND | `webui/server/proxy/agent-constraints.ts`（AC-P1.5） |
| 闸门 / rewrite | `webui/server/proxy/mcp-proxy.ts` |
| 身份 | `webui/server/proxy/identity.ts` |
| 审计 | `webui/server/proxy/audit.ts` |
| Admin API | `webui/server/admin/{agents,roles,tokens,audit}.ts` |
| 事实源 | `webui/config/access.yaml` |
| 单测 | `webui/server/__tests__/kx-acl.test.ts`、`row-policy-ac-p1.test.ts`、`agent-constraints-ac-p15.test.ts` 等 |

---

## 4. 旧路径重定向

下列根路径文件仅为跳转桩，避免历史链接断裂：

| 旧路径 | 新路径 |
|---|---|
| `docs/design-access-control-upgrade.md` | `docs/access-control/design-upgrade.md` |
| `docs/design-row-level-acl-feasibility.md` | `docs/access-control/feasibility-row-acl.SUPERSEDED.md` |
| `docs/access-governance-design.md` | `docs/access-control/design-governance-baseline.md` |
| `docs/design-agent-permissions.md` | `docs/access-control/design-agent-permissions-v1.md` |
| `docs/uat-agent-permissions.md` | `docs/access-control/uat-agent-permissions-v1.md` |
| `docs/review-module1-agent-permissions.md` | `docs/access-control/review-agent-permissions-v1.md` |
| `docs/lucy-202608-access-governance-gap-analysis.md` | `docs/access-control/gap-analysis-202608.md` |

---

## 5. 波次状态

| 波次 | 状态 |
|---|---|
| AC-P0 Spec / 实施 | **已交付**（Spec 98；WO-59 Gate C 2026-08-09） |
| **AC-P1 Row Policy** | **已交付**（[WO-60](plans/wo-202608-60-access-control-p1.md) Gate C 2026-08-09）；[UAT](uat-ac-p1.md) / [Runbook](runbook-row-policy.md) / [Release notes](release-notes-ac-p1.md)；proven 默认 false |
| **AC-P1.5 Agent Constraints** | **已交付**（[WO-61](plans/wo-202608-61-access-control-p15-agent-constraints.md) Gate C 2026-08-09）；[UAT](uat-ac-p15.md) / [Runbook](runbook-row-policy.md) 路径 D / [Release notes](release-notes-ac-p15.md)；proven 仍默认 false |
| **P1.5 之后** | **主线收束**；见 [`adr-post-p15-roadmap-freeze.md`](adr-post-p15-roadmap-freeze.md)：TokenScope / Dynamic RLS / AC-P2+ 整包**冻结**；单机部署清单 [Phase 0/1](checklist-single-deploy-phase0-1.md) / [Phase 2](checklist-single-deploy-phase2.md) / [Phase 3/4](checklist-single-deploy-phase3-4.md)（**未验证前不 merge main**；proven 默认 false） |

— 完
