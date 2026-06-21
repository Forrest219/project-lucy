已完成全部 12 个 Markdown 路径的只读审核，并与上一轮 B1-B3 反对意见逐项交叉核对。以下为复审结论。

---

# 第一批交付物小修订包 — 开发质量复审

## 1. 总体结论

**结论：达到可交付 builder 实施标准（PASS）。**

- 上一轮 builder review 的 **B1、B2、B3 均已在文档层关闭**；B4（定稿冻结）也一并关闭。
- P0 安全写路径契约（`security-write-path-builder-contract`）**已标记为「Builder 冻结契约 / 实施基线」**，并自包含 Package A / B 的 API、类型、错误码、落盘顺序、审计表 DDL、迁移语义与验收 DoD。
- thinker-review §4 列出的 **8 项必须补齐契约全部被对应章节覆盖**（详见验证记录），交付物之间未发现会直接误导 builder 的硬冲突或过期状态。

唯一需提醒：B2 的关闭依赖契约 §2.3 中一条「`acl.ts` 已具备 resolver/snapshot 能力」的**代码核验断言**，本次为只读文档审核、不做代码审计，无法独立验证该断言。但契约已把它转化为「builder 在包 A 暴露 resolver」的实施约束，因此**不构成阻断**，仅作为残留核验项随包 A 第一步落实。

无阻断项。下列非阻断改进建议在 builder 开工前或开工初期顺手处理。

---

## 2. B1–B3 复核

### B1 — 边界依赖外部化 ✅ 已关闭
- 契约 §0「第一批交付清单」已**显式纳入** `inbox/thinker-review-spec-delivery-2026-06-21.md` 与 `docs/design-agent-permissions.md`（两者本次均已在批次内读到）。
- 契约 §0 明确「thinker-review 仅作拆包/反对意见来源，本契约已内联 Package A/B 边界，builder 不需再从外部文档推断范围」；§1 交付边界不再出现「可先执行项见 thinker-review」式外部跳转。
- remediation §9 以表格形式记录关闭方式，交付清单两份（contract §0 / remediation §9）一致。

### B2 — effective-permissions 依赖未验证的 acl.ts 能力 ✅ 文档层已关闭（含残留核验项）
- 契约 §2.3 新增「2026-06-21 前置核验结论」：声明 `acl.ts` 已有内部 `resolveEffectivePermissions(...)`（可算 `roleIds/tools/tables/connections/sources/sourceMapVersion/snapshotHash/legacyAllow`），并已导出 `permissionSnapshot(...)`（但不足以直接支撑 admin 响应）。
- 契约据此把要求收敛为实施约束：builder 须在包 A 把现有 resolver 安全暴露为 admin 可复用函数，**不得在 admin 层重写第二套 role/selector 解析**，且 acl.ts 仅允许「暴露/复用、不改裁决语义」。
- 残留：上述代码核验断言无法在只读文档审核内确认。若断言不实，包 A 范围会扩大。契约 §2.3/§2.5 已将「确认 fail-closed + 暴露 resolver」列为包 A 必做，残留风险可控。

### B3 — role-first 权威 spec 未纳入批次 ✅ 已关闭
- `docs/design-agent-permissions.md v1.2` 已纳入批次并完成内联一致性比对：
  - 契约 §2.1 的 deprecated/role 优先/fail-closed 不回退 allow/`["*"]` 仅限 legacy/授权表 role 必须非空 connections 等规则，与 design §3.1 **逐条一致**。
  - 契约 §2.2 的 `YamlRole`/`YamlUser`/`TableSelector` 类型与 design §3.2 的 `Role`/`Agent`/`TableSelector` 结构一致（YamlRole 省略 id 因其为 map key，属合理差异）。
  - INVALID_ROLE / fail-closed 触发条件与 design §4.3 preview、§7 测试矩阵一致。

---

## 3. 阻断项

**无。** 未发现阻断 builder 开工的缺口。B1–B3 关闭、契约冻结、thinker §4 八项必备契约全覆盖、跨文档无硬冲突。

---

## 4. 非阻断改进（按优先级）

**P1（建议开工前对齐，避免实施期返工）**
1. **契约与 design v1.2 的端点/错误码口径需明确权威关系。** 契约 §2.3 用 `GET /api/admin/agents/:userId/effective-permissions`，而 design §4.2 端点清单是 `GET /api/admin/roles/:roleId/preview` + agents 详情内联 effectivePermissions；POST 错误码契约用 `ROLE_REQUIRED/LEGACY_ALLOW_READONLY`，design 用 `AGENT_ID_TAKEN(409)/ROLE_NOT_FOUND`。两者非互斥但命名/集合不同。建议在契约 §2.3 加一句「P0 范围以本契约端点与错误码为准，design v1.2 的 `roles/:roleId/preview`、`AGENT_ID_TAKEN` 等作为补充」，消除 builder 二选一困惑。
2. **POST/PATCH 请求体包裹结构未在契约统一。** design 用 `{dryRun, agent:{...}}` / `{dryRun, patch:{...}}`，契约示例只给内层对象、未显式说明包裹层与 agents 写端点的 dryRun 默认值。建议契约补一句「写端点沿用 design §4.1 envelope 与默认 dryRun=true」。
3. **包 A 应显式吸收 review-module1 的 P1-1/P1-2（revoked_tokens 写失败被静默吞掉）为必做项。** 契约 §3.6 已规定 sqlite 先于 yaml、audit 写失败 fail-closed 返回 500，design §5.2/§4.3 也要求 revoked_tokens INSERT 失败放弃撤销返回 500；但 review-module1 当前仍标「待复核」。建议在契约 §6 DoD 或包 A 明确「revoked_tokens 写失败必须 fail-closed，不得静默」，与状态表对齐。
4. **role-first 端到端 UAT 仍缺。** `uat-agent-permissions.md` 仅覆盖 legacy allow 链路，新行为只有契约 §2.5 验收点 + 推荐单测。建议补一份 role-first UAT（拒绝 `["*"]`、拒绝启用 legacy wildcard、迁移后 `allow` 被删除、`roles:`/`defaults:` 无损保留的 `git diff` 验证）。

**P2（可后置）**
5. `webui-impl-status.md` 图例中「🔧 开发中」与「🔧 需安全整改」仍共用同一 🔧 图标，虽已拆为两行说明，建议换不同符号彻底消歧。
6. eval schema 版本漂移（superstore v1.3 vs conventions v1.4）仍只在 lint-plan 标 warning，未在交付内闭环；属治理项，可随 P1 lint 脚本推进。
7. `spec-audit-2026-06-21.md` 为早间时点快照，其 §2.3/§2.8 等批评已被 status/overview v1.1 与 remediation §9 修正；建议在审计顶部加一行「现状以 v1.1 / remediation §9 为准」，避免 builder 两份并读误判。

---

## 5. 验证记录

本次实际读取并审核的 Markdown 路径（严格限定在用户列出范围内）：

- `inbox/builder-review-first-delivery-2026-06-21.md`（上一轮反对意见基线）
- `inbox/security-write-path-builder-contract-2026-06-21.md`
- `inbox/spec-remediation-plan-2026-06-21.md`
- `inbox/spec-audit-2026-06-21.md`
- `inbox/thinker-review-spec-delivery-2026-06-21.md`
- `inbox/spec-lint-plan-2026-06-21.md`
- `docs/design-agent-permissions.md`
- `docs/review-module1-agent-permissions.md`
- `docs/uat-agent-permissions.md`
- `docs/review-module2-eval-monitoring.md`
- `docs/uat-module2-eval-monitoring.md`
- `docs/webui-impl-status.md`
- `docs/project-overview.md`

**范围限制声明**：本次为只读文档复审，未读取任何代码、YAML、配置或未列出路径（如 `webui/server/proxy/acl.ts`、`webui/config/access.yaml`、`webui/docs/07-mcp-auth-proxy-spec.md`）。因此 B2 中「acl.ts 已具备 resolver/snapshot/fail-closed 能力」的代码级断言无法在本审核内独立验证，已作为残留核验项列明，建议作为包 A 第一步由 builder 现场确认（契约 §2.3/§2.5 已要求）。
