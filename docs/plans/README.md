# docs/plans Index

This directory stores repository-level implementation plans that are not scoped to WebUI alone.

| Plan | Purpose |
|---|---|
| `2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md` | **Eval 优化方案（形态 A）**：准确率连续跌破闭环（判定 / ack / Webhook）+ Publish 后变更触发 smoke 回归；不含实现 WO |
| `2026-08-20-trace-evidence-p0-plan.md` | **P0 Trace / Evidence** 权威实施计划（Kernel Landed + P0 Closure：evidence 完整度 / purge / 术语）；对齐 Spec 62 v0.5 |
| `wo-202608-59-access-control-p0.md` | **访问权限 AC-P0** 可交付实现计划（capability / 工具分级 / 配置版本 / 收窄提交）；入口 `docs/access-control/plans/` |
| `wo-202608-58-spider2-lite-sqlite-stress-harness.md` | Spider2-lite→StarRocks `sandbox` 长期分层 E2E（runtime/platform/business eval gates；Pilot 为 seed） |
| `2026-08-03-lucy-enterprise-data-agent-access-governance-plan.md` | Implement the Lucy 202608 Enterprise Governance & Observability iteration across Admin, Trace / Evidence, Access Governance Gate, Security Eval, risk review candidates, and release readiness evidence |
| `wo-202608-00-spec-branch-isolation.md` | Create a clean isolated branch/worktree for the frozen Lucy 202608 spec / plan / task documents |
| `wo-202608-06-governance-review-release-evidence.md` | 202608-GOV-06 MiniMax Code handoff for risk review candidates and release readiness evidence package |
