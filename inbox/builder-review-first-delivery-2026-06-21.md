# 第一批交付物开发质量审核报告

## 1. 总体结论

**结论：有条件达标（CONDITIONAL PASS）。** 本批次整体质量较高，分层清晰——低风险状态/文案修复包已执行完毕，两个 P0 安全写路径（Package A 角色优先 Admin、Package B `ktx.yaml` 白名单写回）已具备较完整的 API 契约、数据模型、错误码、落盘顺序、审计表结构与验收标准，可直接指导 builder 实施。Eval（Module 2）与 Agent 权限（Module 1）的 review/UAT 均已加 2026-06-21 状态更新，旧结论与新整改方向的衔接基本闭合，未发现会直接误导 builder 的硬冲突。

但**尚不能无条件直接交 builder 开工**：存在数个跨文档的范围外强依赖与未闭合的前置假设（详见阻断项），需先澄清/补齐后，Package A/B 才算交付基线冻结。建议处置顺序：先确认 4 个阻断项 → Package A/B 即可交付；`lint:spec` 方案作为 P1 可并行。

---

## 2. 阻断项（需在交付 builder 前关闭）

**[B1] 关键前置文档不在本批次，边界依赖外部化**
- 路径：`inbox/spec-remediation-plan-2026-06-21.md`（§8）、`inbox/security-write-path-builder-contract-2026-06-21.md`（§1、表头“基于材料”）、`docs/review-module1-agent-permissions.md`、`docs/uat-agent-permissions.md`
- 原因：多处以 `inbox/thinker-review-spec-delivery-2026-06-21.md` 为“基于材料”和“立即可交付包”的边界来源，该文件未纳入本批次。builder 仅凭本批次无法独立确认“低风险包 vs 安全写路径包”的拆分取舍。remediation §8 虽内联了低风险包产物清单（部分缓解），但 contract §1 的“可先执行项见 thinker-review”仍指向批次外文档。
- 建议：将该 thinker 文档纳入交付，或在 contract 内自包含“立即可交付包”清单，去除外部引用。

**[B2] `effective-permissions` 端点契约依赖未验证的 acl.ts 现有能力**
- 路径：`inbox/security-write-path-builder-contract-2026-06-21.md`（§2.3）
- 原因：`GET /api/admin/agents/:userId/effective-permissions` 要求返回 `snapshotHash`、`sourceMapVersion`，并以“复用 `acl.ts` resolver、不重写第二套解析”为前提。本批次未提供证据证明 `acl.ts` 已暴露上述快照/版本能力。若不存在，该端点契约无法按描述直接落地。
- 建议：交付前安排一次 `acl.ts` 能力确认/spike，作为 Package A 前置；若需新增 resolver 导出，应写入契约范围。

**[B3] 角色模型权威 spec 不在批次，内联内容一致性未保证**
- 路径：`inbox/security-write-path-builder-contract-2026-06-21.md`（§2.1/§2.2）
- 原因：role-first 行为以 `design-agent-permissions.md v1.2` 为权威源，但该文件未纳入本批次；而 `docs/review-module1-agent-permissions.md` 基于的是 v1.0。contract 虽内联了 `YamlRole`/`YamlUser` 类型与 API，但 selector 解析细则、role 校验规则仍在范围外，无法核对内联内容是否与 v1.2 完全一致。
- 建议：交付前比对 contract 内联类型/语义与 v1.2，确认无偏离后再冻结，或将 v1.2 纳入交付集。

**[B4] 核心 builder 文档仍标“草案/未实现”，未定稿冻结**
- 路径：`inbox/security-write-path-builder-contract-2026-06-21.md`（状态：契约草案）、`inbox/spec-lint-plan-2026-06-21.md`（状态：方案草案；未实现脚本）
- 原因：作为 builder 实施基线，草案状态意味着接口/边界仍可能变动，存在 builder 实施中被回改的风险。
- 建议：完成 B1–B3 后将 contract 标记为定稿/冻结版本；`lint:spec` 方案明确为 P1，不阻塞 P0 包。

---

## 3. 非阻断改进（按优先级）

**P1（建议交付前一并处理）**
- `docs/uat-agent-permissions.md`：仅覆盖 legacy allow 链路 UAT，缺 role-first（Package A 新行为）的端到端人工 UAT；当前新行为只有 contract 的验收点+推荐单测。建议补一份 role-first UAT（含拒绝 `["*"]`、拒绝启用 legacy wildcard、迁移后删除 `allow` 的端到端验证）。
- `inbox/security-write-path-builder-contract-2026-06-21.md`（§3.6）：写入顺序为 fail-closed，但未显式纳入 `docs/review-module1-agent-permissions.md` P1-1/P1-2 指出的“sqlite 写失败被静默吞掉”修复点。建议在 Package A 明确把该修复列为必做项，避免被遗漏。

**P2（可后置）**
- `docs/webui-impl-status.md`：状态图例中 🔧 同时表示“开发中”与“需安全整改”，同一图标双义，易混淆，建议拆分图标。
- `inbox/spec-audit-2026-06-21.md`：§2.3/Opus 中对 impl-status 的批评（“数据库接入仍待开发”“Review API 写 `/api/changed`”）已被 `webui-impl-status.md` v1.1 / `project-overview.md` v1.1 修正。审计为时点快照可理解，但建议在审计顶部明确“以下为 2026-06-21 早间快照，状态文档现状以 v1.1 为准”，避免 builder 两份并读时误判当前态。
- `inbox/spec-lint-plan-2026-06-21.md`：§3.3 示例输出的 reviewer dependency 路径（`../domains/superstore/pitfalls.md`）与 §5/审计描述的实际失效路径（`../superstore/references/superstore-pitfalls.md`）不一致，建议统一示例。

---

## 4. 验证记录

本次实际读取并审核的 Markdown 路径（仅限用户列出范围）：

- `docs/webui-impl-status.md`
- `docs/project-overview.md`
- `docs/review-module1-agent-permissions.md`
- `docs/review-module2-eval-monitoring.md`
- `docs/uat-agent-permissions.md`
- `docs/uat-module2-eval-monitoring.md`
- `inbox/spec-audit-2026-06-21.md`
- `inbox/spec-remediation-plan-2026-06-21.md`
- `inbox/security-write-path-builder-contract-2026-06-21.md`
- `inbox/spec-lint-plan-2026-06-21.md`

**未读取/审核范围限制说明**：上述文档多次引用但不在本批次内的 `inbox/thinker-review-spec-delivery-2026-06-21.md`、`docs/design-agent-permissions.md`、`webui/docs/07-mcp-auth-proxy-spec.md` 及任何代码/YAML（如 `acl.ts`、`access.yaml`）均未读取，故 B1–B3 涉及的外部依赖一致性无法在本次审核内闭环确认，需另行核验。
