# Lucy 访问权限域档案（Access Control）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 访问权限域档案索引 |
| 文档类型 | Other |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-08 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `docs/governance/DEVELOPMENT.md` Spec 落位规则；访问权限升级设计 v1.1.2 |
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
| **P0 必读** | [`design-upgrade.md`](design-upgrade.md) **v1.1.2** | 审核基线；六项 ADR；批准后可写 AC-P0 Spec |
| **完整性口径** | [`integrity-p0-decision.md`](integrity-p0-decision.md) **v1.0** | 企业完整性 P0 承诺 / 已知限制；扩展而非替代 202608 工程 P0 |
| **P0 实施计划** | [`plans/wo-202608-59-access-control-p0.md`](plans/wo-202608-59-access-control-p0.md) | 可交付开发任务计划 |
| **WebUI 登录 / Token 失效** | [`design-webui-admin-auth.md`](design-webui-admin-auth.md) · [`plans/wo-202608-62-webui-admin-auth-and-token-expiry.md`](plans/wo-202608-62-webui-admin-auth-and-token-expiry.md) | Token `expires_at` 强制；多管理员本地登录 |
| 行级策略后续顺序 | [`adr-row-policy-next-iteration.md`](adr-row-policy-next-iteration.md) | 已确认：当前维持静态行级策略；下一次增量候选为可复用静态策略引用；动态数据策略另批 |
| 行权限管理（v0.25 L25-14） | [`../specs/lucy-20261022-v2p5-row-permission-management-spec.md`](../specs/lucy-20261022-v2p5-row-permission-management-spec.md) v0.2-requirements-review | **P0-2 设计完成、待需求审查，暂不开发**：P0 仅含 R2 保存前最终行约束预览、R4 配置审计、R5 字段诊断；R1 模板与 R3 反查视图保持 P1。不改 Spec 99 / 100 运行时语义，动态策略仍冻结 |
| 已登记缺陷（行级策略字段绑定） | [`../qa/security-findings.yaml`](../qa/security-findings.yaml) **D-03（P1 / open）** | **存量缺陷，未修**：根因与复现见 L25-14 Spec §1.5。归属 **0.20.Z 维护线（当前基线 `0.20.0`）**，是受影响客户场景的交付价值依赖而非 R2／R4／R5 开工依赖；V19／V22 证据齐全前不得宣称该场景交付价值。不得以改成「全部行」绕过 |
| 实现契约 | [`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md) | Runtime ACL / Proxy（AC-P0 须更新） |
| Admin 契约 | [`webui/docs/14-agent-admin-enterprise-delivery-spec.md`](../../webui/docs/14-agent-admin-enterprise-delivery-spec.md)、[`15-role-admin-spec.md`](../../webui/docs/15-role-admin-spec.md) | Agent / Role Admin |
| Role 权限配置结构 | [`webui/docs/150-role-permission-configuration-structure-spec.md`](../../webui/docs/150-role-permission-configuration-structure-spec.md) | Role 详情三个独立编辑面、共享草稿、保存确认 Drawer；不改运行时契约 |
| Skill 对象授权 | [`webui/docs/151-business-skill-authorization-and-file-safety-spec.md`](../../webui/docs/151-business-skill-authorization-and-file-safety-spec.md) | 文件身份与并发版本仍有效。对象授权与通道勾选由 [Spec 170](../../webui/docs/170-mvp-open-skill-wiki-access-spec.md) 暂停：已发布 Skill 与全部 Wiki 对所有已解析角色开放 |
| 企业安全与真实用户 E2E 整改 | [Spec](../specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md) · [Plan](../plans/2026-10-18-enterprise-security-and-real-e2e-plan.md) · [ADR](./adr-20261018-security-ledger-and-context-acl.md) · [Cursor 提示词](../plans/2026-10-18-enterprise-security-cursor-prompts.md) | **2026-10-18 已批准，按批次实施中。** 修复 P0/P1、用显式角色 ACL 替代 170 全开放；实施完成前运行时仍以上方现行基线为准 |

**冲突裁决：** 与 `design-upgrade.md` 冲突时，以 `design-upgrade.md` 为准，直至对应 Spec 同步更新。

---

### 1.1 上下文对象授权（2026-10-18 起，取代 Spec 170 全开放）

| 主题 | 口径 |
|---|---|
| 事实源 | Skill `roles_allowed` / Wiki `allowed_roles`；缺失或 `[]` 无人可见；`["*"]` = 所有有效已分配 Role（非匿名）；损坏声明拒绝 |
| 裁决 | `webui/server/proxy/context-acl.ts` 的 `authorizeContext`：同一 Role 须同时匹配对象授权与通道；initialize / resources / prompts / tools / wiki 通道复用；未授权 / 不存在 / 草稿 / 停用统一 `context_not_available`；legacy direct-allow `context_role_required` |
| 版本与缓存 | `contextPolicyVersion = hash(规范化 ACL + 文件版本 + 角色通道版本)`；裁决不缓存正文，授权文件按请求重读，收窄下一请求即生效 |
| 管理 | Skill / Wiki 编辑页设置可访问角色（默认无人可见，`*` 需二次确认）；Role 详情只读展示发现 / 读取效果；Wiki `file_version` / `expected_version`；Role 删除检查 ACL 引用并退役标识 |
| 模板 | `examples/*/project-template` 与 `customer-config.example` 的 14 篇 Wiki 及模板 Skill 随代码提交显式 ACL；`*` 仅 `answer-style`（纯版式指引）；`context-template-acl.test.ts` 为门禁 |
| 迁移 | `scripts/security/migrate-context-acl.mts`：`--dry-run` 只读报告（含 `inventoryDigest`）；`--apply` 仅 owner，带 `--expected-digest`、逐文件 `expected_version`、加密备份与 journal；空 / 损坏 / 旧 public 不自动变 `*` |
| 回滚 | 迁移回滚用加密备份还原受影响文件，**不得**运行忽略 ACL 的旧全开放版本，也没有“恢复全开放”开关；只能回到通过同一安全回归的构建，或先隔离入口再恢复 |

## 2. 目录清单

| 文件 | 说明 |
|---|---|
| `design-upgrade.md` | 访问权限升级主设计 v1.1.2（工具三分级、capability tuple、配置版本、收窄失败语义） |
| `design-governance-baseline.md` | 2026-06 权限治理闭环设计（role-first 基线；行级仅旧锚点） |
| `design-agent-permissions-v1.md` | Module 1 Agent 权限管控详细设计（历史） |
| `uat-agent-permissions-v1.md` | Module 1 UAT（表级 ACL；不含 Row Policy） |
| `review-agent-permissions-v1.md` | Module 1 代码审查报告 |
| `gap-analysis-202608.md` | 202608 Governance 差距分析（不含 Dynamic RLS） |
| `proposal-access-onboarding-simplification-202609.md` | **待审批**：访问治理「加人 / 开权限」体验简化（意图优先 + 渐进披露；与 Spec 133 顺序裁决） |
| `integrity-p0-decision.md` | 企业完整性 P0 决策备忘（承诺表 / 已知限制 / 与工程 P0 对齐） |
| `adr-row-policy-next-iteration.md` | 行级策略后续迭代 ADR；记录静态策略引用与动态数据策略的开工顺序 |
| `../specs/lucy-20261022-v2p5-row-permission-management-spec.md` | 行权限管理 Spec v0.25 P0-2（L25-14，待需求审查）；P0 仅最终行约束预览、配置审计与字段诊断，模板引用和按表反查视图归 P1；D-03 归 0.20.Z 维护线 |
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
| 查询原文冷存（Spec 124） | `webui/server/audit/query-artifact-*.ts`（legacy）；主路径见 Spec 125 `generated_sql` |
| Admin API | `webui/server/admin/{agents,roles,tokens,audit}.ts` |
| 事实源 | `webui/config/access.yaml` |
| 单测 | `webui/server/__tests__/kx-acl.test.ts`、`mcp-proxy-acl.test.ts` 等 |

---

## 4. 旧路径重定向

下列根路径文件仅为跳转桩，避免历史链接断裂：

| 旧路径 | 新路径 |
|---|---|
| `docs/design/design-access-control-upgrade.md` | `docs/access-control/design-upgrade.md` |
| `docs/design/design-row-level-acl-feasibility.md` | `docs/access-control/feasibility-row-acl.SUPERSEDED.md` |
| `docs/design/access-governance-design.md` | `docs/access-control/design-governance-baseline.md` |
| `docs/design/design-agent-permissions.md` | `docs/access-control/design-agent-permissions-v1.md` |
| `docs/uat/uat-agent-permissions.md` | `docs/access-control/uat-agent-permissions-v1.md` |
| `docs/reviews/review-module1-agent-permissions.md` | `docs/access-control/review-agent-permissions-v1.md` |
| `docs/specs/lucy-202608-access-governance-gap-analysis.md` | `docs/access-control/gap-analysis-202608.md` |

---

## 5. 波次状态（摘自 design-upgrade）

| 波次 | 状态 |
|---|---|
| AC-P0 Spec | 设计批准后可写；见 WO-59 |
| AC-P0 实施 WO | Spec 评审通过后另批开工 |
| AC-P1 | 冻结（须上游强制谓词契约） |

— 完
