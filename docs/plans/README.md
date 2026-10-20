# docs/plans Index

This directory stores repository-level implementation plans that are not scoped to WebUI alone.

| Plan | Purpose |
|---|---|
| [2026-10-19-lucy-product-version-2.0.0.md](2026-10-19-lucy-product-version-2.0.0.md) | **仓库版本已落地，运行中容器未重建**：产品版本 `2.0.0`，界面标签 `v2.0.0`。V1–V6 已通过。未构建镜像，未改 KTX 或 Helm Chart 包版本 |
| [2026-10-19-audit-trust-and-admin-investigation-plan.md](2026-10-19-audit-trust-and-admin-investigation-plan.md) | **设计交付，未实施**：用户批准跨端交叉复核后，拆成 T00–T08；Claude Code 实施，Codex 按 EA-01–36 评审验收。覆盖可信归属、身份、保全、导出与管理员调查，受控客户端范围单列 |
| [2026-10-19-v2-bootstrap-delivery-scripts-plan.md](2026-10-19-v2-bootstrap-delivery-scripts-plan.md) | **v2.0 脚本已实现、现场待测**：自动生成和复用实例引导密钥，配置 K8s / K3s Secret 与部署入口；15 项 Node 和 11 项 Python 检查通过，实际集群、升级及恢复由用户测试，不新增发布门禁 |
| [2026-10-19-upgrade-e2e-implementation-plan.md](2026-10-19-upgrade-e2e-implementation-plan.md) | **v2.5 需求备忘，待落地，非门禁**：L25-07 的完整方案，覆盖 Docker / K3s / K8s、真实资产、备份恢复、业务与安全连续性；v2.0 仅做交付验证，不修改当前 CI 或发布规则 |
| `webui/docs/plans/wo-202610-27-engine-catalog-and-mcp-query-connection.md` | **待审阅，未批准**：Spec 176 v0.3。新建连接显式支持 KTX `driver: athena`。v0.2 引擎目录 / MCP 查询连接已撤回 |
| `webui/docs/plans/wo-202610-26-suspend-deployment-license.md` | **移除激活码（已实现）**：Spec 175 v0.2。删除许可实现与签发脚本，去掉治理台入口。Docker 未在本次重启 |
| [2026-10-18-lucy-2.5-upgrade-proposal.md](2026-10-18-lucy-2.5-upgrade-proposal.md) | **Lucy 2.5 升级建议（v1.4）**：治理台四项展示改造，另记可选 SMTP、单点登录与 L25-07 升级 E2E 自动化备忘（待落地、非门禁）。不含实现 WO |
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
