# 推断问询重建中断后自动恢复 Plan

| 元数据 | 内容 |
|---|---|
| 状态 | **v0.2。与 Spec 同句：终稿已确权、开发已授权；代码已实现（`inferred_rebuild_state`＋watermark `covered()`）；vitest 20/20；测试台 NOT RUN；不入核心分母；≠ 可上线** |
| 主 Spec | [`docs/specs/lucy-20261118-inferred-turn-rebuild-recovery-spec.md`](../specs/lucy-20261118-inferred-turn-rebuild-recovery-spec.md) |
| 总账 | **P1-45**／REQ-030-066（前方报告 P0-02）；**不入核心分母** |
| 授权边界 | **开发已授权（委托人 2026-11-18「授权定稿」）。** 限 `proxy/audit.ts`、`inferred-turn-maintainer.ts`、审计 DB 迁移（`inferred_rebuild_state`）及对应 vitest／UAT 脚本。禁止线上升级未另授权 |
| 验收 | Spec SC-01–SC-08；测试台 `UAT-SUITE-INFERRED-REBUILD-RECOVERY` |

## 目标

中断后残缺推断结果自动恢复；覆盖判定诚实；完整覆盖后无新日志不空转全量重建。

## 开工前置

- 已入总账 P1-45／REQ-030-066；Spec／本 Plan／测试台已挂。
- **终稿确权**：已取得（委托人 2026-11-18「授权定稿」）。
- **开发授权**：已取得（同上；含 `inferred_rebuild_state` schema）。
- 改前基线：前方报告 E05／E06／E17；本仓库 UAT 跑次仍 NOT RUN，实现前／后各归档。

## 步骤

| 步骤 | 内容 | 验证 |
|---|---|---|
| 0 | 改前基线：IRR-R0／01–04 | 跑次 FAIL 入 `runs/` |
| 1 | 裁定 OQ-1（持久水位介质） | 写入 Spec |
| 2 | 实现 in_progress／complete + `covered()` | vitest 红→绿 |
| 3 | 候选构建跑全套 UAT | INDEX 更新 |

## 浏览器验证

不适用：不改变用户可见 WebUI 表面。

## 验收

以 Spec SC 与测试台 `runs/` 为准；vitest 绿 ≠ UAT PASS。

## 完成定义

Spec／Plan／总账／INDEX／e2e-ledger 同句；UAT 必做 PASS；**≠ 可上线**。

## 风险

| 风险 | 处理 |
|---|---|
| Schema 与 P1-39「不新增表」冲突 | OQ-1 先裁定 |
| 与 P1-47 删除分片交叉 | 合同分开关单，实现可同 PR 但须双授权 |

## 2026-11-18 接管补充验证

已补全 ID 水位旧状态恢复、窗口分页、大簇关联分片、61秒就绪旁路及字段续查边界。授权慢盘容器补充验证：首次补算 livez max/p99=304/298ms，重启前120秒=265/239ms、readyz p99=395ms；中断用户2988/2988；另6000调用SIGKILL由25恢复至6000。113定向、65根合同通过；全量仍50基线失败、类型33基线错误。仅补充跑次通过，不替代原正式套件全部逐例运行或客户生产放行；K8s与真实Hive/Agent未验。运行记录：[Codex 接管跑次](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-18-codex-takeover.md)。
