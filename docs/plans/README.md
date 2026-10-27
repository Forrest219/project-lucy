# docs/plans Index

This directory stores repository-level implementation plans that are not scoped to WebUI alone.

| Plan | Purpose |
|---|---|
| [2026-10-27-lucy-v0.25-semantic-release-restore-implementation-plan.md](2026-10-27-lucy-v0.25-semantic-release-restore-implementation-plan.md) | **v0.25 L25-15，P0，设计完成待需求审查**：语义发布历史版本与整批恢复 Spec／Plan 经 Claude Code 三轮只读审查修订至 v0.4；S0–S7 均为后续授权阶段，SRR-01–SRR-22 全部未执行，不授权开发、浏览器验证或客户交付 |
| [2026-10-25-lucy-v0.25-p1-requirements-review-checklist.md](2026-10-25-lucy-v0.25-p1-requirements-review-checklist.md) | **v0.25 P1 唯一需求签核入口**：六项 Spec、追踪矩阵、依赖与非门禁边界；全部 P1 验收未执行，2026-10-25 需求审查已签核通过、不授权开发；逐项依据见 [P1 需求审查记录](../reviews/2026-10-25-lucy-v0.25-p1-requirements-review-record.md) |
| [2026-10-20-hive-direct-connection-implementation-plan.md](2026-10-20-hive-direct-connection-implementation-plan.md) | **v0.25 P1-4 上游方案**：已收口 Hive 直连 Spec，需求审查已签核通过、暂不开发；数据库支持状态保持 `planned`，动态验证未执行 |
| [2026-10-22-upgrade-candidate-verification-plan.md](2026-10-22-upgrade-candidate-verification-plan.md) | **v0.25 P1-6 上游方案，非门禁**：已收口升级候选验证 Spec，需求审查已签核通过；空卷整卷恢复、候选迁移与业务／审计连续性；原地升级仍为客户现场主线 |
| [2026-10-21-customer-v2-fresh-install-package-plan.md](2026-10-21-customer-v2-fresh-install-package-plan.md) | **v0.2，执行中**：空集群全新安装 Lucy 2.0.0 / Chart 0.2.6。新后缀 `20261022-fresh`、新 slug `customer-fresh`。原生 amd64 的 G3/G4/G4b/G8 与 F4 完成前不交给客户。不覆盖 r7，也不代替 v0.3 的 P0-3 至 P0-6 |
| [2026-10-21-customer-20260828-v1-upgrade-package-plan.md](2026-10-21-customer-20260828-v1-upgrade-package-plan.md) | **v0.1，执行中**：供方生成 20260828-v1 客户的 linux/amd64 镜像、私有引导密钥附件和随包文档。构建排除、信任代理渲染和升级白名单纳入本次提交。候选包在原生 amd64 验收前不交给客户。验收合同仍是升级计划 v0.3 |
| [2026-10-21-customer-20260828-v1-to-lucy-2.0-upgrade-plan.md](2026-10-21-customer-20260828-v1-to-lucy-2.0-upgrade-plan.md) | **v0.3，未执行**：客户现役 `20260828-v1`（Lucy 0.16.0 / Chart 0.1.0，无登录、已有 https 域名）→ Lucy 2.0.0 / Chart 0.2.6。放行前先补升级入口白名单，再对那一次构建做原生升级与恢复验收。客户现场成功后不还原旧卷。当前 `r6` 仍为 Draft，不是放行包。同日评审过程稿已作废。供方出包步骤见同日升级包生成计划 |
| [2026-10-19-lucy-product-version-2.0.0.md](2026-10-19-lucy-product-version-2.0.0.md) | **仓库版本已落地，运行中容器未重建**：产品版本 `2.0.0`，界面标签 `v2.0.0`。V1–V6 已通过。未构建镜像，未改 KTX 或 Helm Chart 包版本 |
| [2026-10-19-audit-trust-and-admin-investigation-plan.md](2026-10-19-audit-trust-and-admin-investigation-plan.md) | **设计交付，未实施**：用户批准跨端交叉复核后，拆成 T00–T08；Claude Code 实施，Codex 按 EA-01–36 评审验收。覆盖可信归属、身份、保全、导出与管理员调查，受控客户端范围单列 |
| [2026-10-19-v2-bootstrap-delivery-scripts-plan.md](2026-10-19-v2-bootstrap-delivery-scripts-plan.md) | **v2.0 脚本已实现、现场待测**：自动生成和复用实例引导密钥，配置 K8s / K3s Secret 与部署入口；15 项 Node 和 11 项 Python 检查通过，实际集群、升级及恢复由用户测试，不新增发布门禁 |
| [2026-10-19-upgrade-e2e-implementation-plan.md](2026-10-19-upgrade-e2e-implementation-plan.md) | **v0.25 P1-5 上游方案，非门禁**：已收口升级 E2E 自动化 Spec，需求审查已签核通过、暂不开发；覆盖 Docker / K3s / K8s、真实资产、备份恢复、业务与安全连续性，UPG-01–16 全部未执行 |
| `webui/docs/plans/wo-202610-27-engine-catalog-and-mcp-query-connection.md` | **待审阅，未批准**：Spec 176 v0.3。新建连接显式支持 KTX `driver: athena`。v0.2 引擎目录 / MCP 查询连接已撤回 |
| `webui/docs/plans/wo-202610-26-suspend-deployment-license.md` | **移除激活码（已实现）**：Spec 175 v0.2。删除许可实现与签发脚本，去掉治理台入口。Docker 未在本次重启 |
| [2026-10-18-lucy-2.5-upgrade-proposal.md](2026-10-18-lucy-2.5-upgrade-proposal.md) | **Lucy v0.25 升级建议（v1.30）**：登记 L25-01–L25-15；L25-15 Spec／Plan 经 Claude Code 三轮只读审查修订至 v0.4，仍待需求审查、暂不开发；首批 P0 与六项 P1 已实现未验收，各自状态见对应 Spec |
| `2026-10-18-mcp-audit-serial.md` | **MCP 审计整改串行计划**：D1–D3 已锁定。批次 1 为 Spec 178 / T1，其后 T3、T5、T4、T7、T6、T11、T13、T14、R0–R3、T15 |
| `2026-10-12-acceptance-gap-closure.md` | **验收缺口修复**：把 SC-15 / SC-19 / SC-20 / SC-23 接到查数路径。工单 `wo-202610-15` |
| `2026-10-11-customer-log-next-optimizations.md` | **客户日志优化最终版（v1.1，WO-12 已验收）**：P0→P1→P2。Spec 162 v0.3；工单 `wo-202610-12` / `13` / `14` |
| `2026-10-11-eval-module-functional-upgrade.md` | **Eval 模块产品能力（形态 A，v0.4）**：已细化为待评审 Spec 161 与工单 `webui/docs/plans/wo-202610-11-offline-eval-customer-ops.md` |
| `2026-10-11-eval-result-policy-context-upgrade.md` | **Eval 升级建议（形态 A）**：结果 / 策略 / 解释分轴，superstore 四臂消融，拒答与澄清，业务轨迹晋升。与 8 月 26 日运营闭环并行；不含实现 WO |
| `2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md` | **Eval 优化方案（形态 A）**：准确率连续跌破闭环（判定 / ack / Webhook）+ Publish 后变更触发 smoke 回归；不含实现 WO |
| `2026-08-20-trace-evidence-p0-plan.md` | **P0 Trace / Evidence** 权威实施计划（Kernel Landed + P0 Closure：evidence 完整度 / purge / 术语）；对齐 Spec 62 v0.5 |
| `wo-202608-59-access-control-p0.md` | **访问权限 AC-P0** 可交付实现计划（capability / 工具分级 / 配置版本 / 收窄提交）；入口 `docs/access-control/plans/` |
| `wo-202608-58-spider2-lite-sqlite-stress-harness.md` | Spider2-lite→StarRocks `sandbox` 长期分层 E2E（runtime/platform/business eval gates；Pilot 为 seed） |
| `2026-08-03-lucy-enterprise-data-agent-access-governance-plan.md` | Implement the Lucy 202608 Enterprise Governance & Observability iteration across Admin, Trace / Evidence, Access Governance Gate, Security Eval, risk review candidates, and release readiness evidence |
| `wo-202608-00-spec-branch-isolation.md` | Create a clean isolated branch/worktree for the frozen Lucy 202608 spec / plan / task documents |
| `wo-202608-06-governance-review-release-evidence.md` | 202608-GOV-06 MiniMax Code handoff for risk review candidates and release readiness evidence package |
