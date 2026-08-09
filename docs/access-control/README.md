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
| **P0 实施计划** | [`plans/wo-202608-59-access-control-p0.md`](plans/wo-202608-59-access-control-p0.md) | Gate A/B/C DONE；AC-P1 冻结另立 WO |
| 术语 | [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md) §3 / §4.8 | AC-P0 术语已登记（v0.3） |
| 实现契约 | [`07`](../../webui/docs/07-mcp-auth-proxy-spec.md) / [`14`](../../webui/docs/14-agent-admin-enterprise-delivery-spec.md) / [`15`](../../webui/docs/15-role-admin-spec.md) | 权威语义以 Spec 98 为准 |
| UAT / Runbook | [`uat-ac-p0.md`](uat-ac-p0.md) / [`runbook-policy-degrade.md`](runbook-policy-degrade.md) | Gate C 已签字；证据 `inbox/20260809-gate-c-uat/` |

**冲突裁决：** 与 `design-upgrade.md` 冲突时，以 `design-upgrade.md` 为准，直至对应 Spec 同步更新。

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

---

## 3. 实现代码锚点（就近，不迁入本目录）

| 区域 | 路径 |
|---|---|
| 裁决 / source map | `webui/server/proxy/acl.ts` |
| 闸门 / rewrite | `webui/server/proxy/mcp-proxy.ts` |
| 身份 | `webui/server/proxy/identity.ts` |
| 审计 | `webui/server/proxy/audit.ts` |
| Admin API | `webui/server/admin/{agents,roles,tokens,audit}.ts` |
| 事实源 | `webui/config/access.yaml` |
| 单测 | `webui/server/__tests__/kx-acl.test.ts`、`mcp-proxy-acl.test.ts` 等 |

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

## 5. 波次状态（摘自 design-upgrade）

| 波次 | 状态 |
|---|---|
| AC-P0 Spec | **初稿已交**（Spec 98 + 术语）；待 Gate B；WP-S1 契约补丁未合并 |
| AC-P0 实施 WO | Spec 评审通过（Gate B）后另批开工 |
| AC-P1 | 冻结（须上游强制谓词契约） |

— 完
