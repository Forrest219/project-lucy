# docs/plans Index

This directory stores repository-level implementation plans that are not scoped to WebUI alone.

| Plan | Purpose |
|---|---|
| [2026-10-19-lucy-product-version-2.0.0.md](2026-10-19-lucy-product-version-2.0.0.md) | **仓库版本已落地，运行中容器未重建**：产品版本 `2.0.0`，界面标签 `v2.0.0`。V1–V6 已通过。未构建镜像，未改 KTX 或 Helm Chart 包版本 |
| `webui/docs/plans/wo-202610-27-engine-catalog-and-mcp-query-connection.md` | **待审阅，未批准**：Spec 176 v0.3。新建连接显式支持 KTX `driver: athena`。v0.2 引擎目录 / MCP 查询连接已撤回 |
| `webui/docs/plans/wo-202610-26-suspend-deployment-license.md` | **移除激活码（已实现）**：Spec 175 v0.2。删除许可实现与签发脚本，去掉治理台入口。Docker 未在本次重启 |
| `2026-10-18-lucy-2.5-upgrade-proposal.md` | **Lucy 2.5 升级建议（v1.3）**：对照本机正在运行的 Cloudflare OS 与 Lucy 演示界面。治理台四项展示改造，另记可选 SMTP 与单点登录。不含实现 WO |
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
