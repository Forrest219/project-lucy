# Eval 选表正确性与真实问句回灌骨架 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.4-draft / 2026-11-13 |
| 状态 | **v0.4-draft；Cursor 过程对抗已修订（2026-11-13）；终稿未确权；冻结落地；未授权实现**。配套 Spec v0.4-draft。O1–O3 未闭合（建议包 S；[决策纸](../reviews/2026-11-13-p0-6-o1-o3-decision-package.md)）。本阶段只评审与修订本 Plan，**暂不执行任何实现 Task**。**不是** R2-F，**不是** R4，**不可功能合同收口** |
| 授权边界 | **不授权改代码**。须满足功能清单池 §2.2：R1 形态 → R2 对抗式评审 → R2-F 终稿确权 → R3 开放决策闭合 → R4 委托人开发授权 |
| 验收 | Spec SC-01–SC-15 逐条有证据；`npm run lint:spec-docs` 退出 0；相关单测全绿。**不构成发布取证，不表示可上线** |
| 台账号 | 无（`0.30` 台账未建立；待 PM 指派后再登记） |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| 需求来源 | 清单 P0-6；需求池 REQ-030-025（最小面挂 019／020） |
| Spec | [lucy-20261107-eval-source-selection-correctness-spec.md](../specs/lucy-20261107-eval-source-selection-correctness-spec.md) |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) 落盘清单与 Plan Mode |
| 并行 Spec | [019](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md)／[020](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md) — 本 Plan 只收窄 **最小面** 任务，不替代其完整面 Plan |

## 1. 目标

让选表错误可被 Eval 测出：去掉 prompt 金标泄漏、用上 regex 选表断言、立五域骨架、修 chatbi_intl 错分支、接通发布后咨询性 smoke 与 domain 映射，并声明新基线。

## 2. 开工前置

1. 委托人裁定 **O1／O2／O3**（推荐整包建议包 S；决策纸 [2026-11-13-p0-6-o1-o3-decision-package.md](../reviews/2026-11-13-p0-6-o1-o3-decision-package.md)）并回写 Spec。未采纳前不得实现这三支。
2. Spec 获得 **R2-F**（Codex CLI 终审，或委托人明示确权）。过程修订到 v0.4-draft **不等于**终稿。
3. 明确 **R4 开发授权**。D4／D11／D12／D13／D14 已冻结，授权后按冻结合同实现，不再另选。
4. 与 019／020 评审对齐：本条只依赖其 **最小面** SC；完整 WebUI 不得阻塞本条收口定义（可并行，但范围隔离）。
5. 基线：`npm run lint:spec-docs` 绿；确认现网 runner 仍支持两型 regex 断言。

> **门禁声明**：本 Plan 现行 **不是 R2-F、不是 R4、不可功能合同收口**，直至 O1–O3 闭合且 R2-F 完成、另获 R4。

## 3. 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `scripts/eval/eval-runner.mjs` | 修改 | `composeQuestion` 去泄漏；域分支修正（含 chatbi_intl） |
| `scripts/eval/**/*.test.*` 或既有 runner 测试 | 新建／修改 | SC-01–SC-04 |
| `evals/<five-domains>/...` | 新建骨架 | 五域最小用例＋regex 断言样例 |
| `docs/governance/eval-quiz-conventions.md`（或 changelog） | 修改 | D8 基线断裂声明 |
| `webui/src/pages/publish/PublishWorkbench.tsx` | 修改 | `postPublishEvalDomains` 映射修复；enqueue 接线（视 O3） |
| `webui/server/eval/runner.ts` | 修改 | `trigger` 扩展；smoke enqueue API |
| `webui/src/pages/eval/RunList.tsx` | 修改 | 消费 `?domain=` |
| `webui/src/pages/eval/CaseEditor.tsx` 等 | 修改 | **019 最小面**：regex 断言可编辑保存 |
| 审计→草稿导出模块 | 修改／新建 | **020 最小面**：草稿含选表断言槽 |
| `webui/docs/00-product-terminology-standard.md` | 修改 | 新术语（若尚未登记） |

**并行修改冲突警示**：`eval-runner.mjs` 的 `composeQuestion` 与 CaseEditor 断言类型不宜与其他 agent 同时大改；PublishWorkbench domain 映射与 RunList 可并行但需约定 domain id（O1）。

## 4. 任务分解

### 变更记录（Plan）

| 版本 | 说明 |
|---|---|
| v0.3-draft | 与 Spec v0.3 对齐；建议包 S；冻结落地 |
| v0.4-draft | 对齐 Spec v0.4：D13／`review_status`；决策纸链入；门禁声明（非 R2-F／非 R4／不可闭口）；S2／S4 措辞收窄。**不构成 R2-F／R3／R4** |

### S0：决策闭合与基线声明草稿

- 回写 O1／O2／O3。建议包 S 可整包采纳（决策纸已出）。起草 `source-select-v1-post-leak-fix` 基线说明；标注 chatbi_intl 历史不可信。
- **验证**：O 行不再是「开工前必答」，或本轮明确不实现对应分支；SC-13 文稿就绪。

### S1：composeQuestion 去泄漏＋域分支

- 删除 `superstore_orders.${m}` 金标拼接；中性候选模板（`candidate_sources`，视 O2）；`chatbi_intl`／未知域走 D4 中性模板，不得回落超店。
- **验证**：SC-01、SC-02 红→绿。

### S2：五域骨架＋regex 断言样例

- 建五域目录与最少用例；跨表歧义槽；骨架用例 `review_status: needs_review`；带 `tool:` 的 regex 断言被拒绝。
- **验证**：SC-03–SC-06、SC-15。

### S3：019／020 最小面收窄落地（授权后）

- CaseEditor／类型／保存：regex 两型；旅程→草稿选表断言；路径隔离不进跑批。
- **验证**：SC-11、SC-12。完整面任务留在 019／020 Plan，不在此扩张。

### S4：Publish smoke＋domain 映射＋RunList

- `mapImpactToEvalDomains`；enqueue smoke 时 `trigger=publish_smoke`；空映射不入队；入队前 `selectRunnable` 排除 `review_status: needs_review`；RunList 消费 `?domain=`；禁止自动回滚。不交付宿主机 cron。配额／默认 off 若需要，属服务端 enqueue 实现细节（O3＝S 后），**不是**新的开放决策。
- **验证**：SC-07–SC-10、SC-15。

### S5：基线切换与文档

- changelog／约定；清单池 P0-6／REQ-030-025 状态同句；术语。
- **验证**：SC-13、SC-14。

### S6：对抗式评审与收口准备

- 独立评审；阻断项清零后才可申请开发授权后的合并。
- **验证**：评审记录落 `docs/reviews/` 或 `inbox/` 并回链 Spec。

## 5. 验收

- Spec SC-01–SC-15 逐条有证据。
- 去泄漏后：**新基线**建立；禁止与泄漏期通过率混比。
- Publish smoke 可入队、可查看；FAIL 不回滚；CI 无 full LLM eval。
- **不构成发布取证，不表示可上线**。

## 6. 完成定义

- SC-01–SC-15 均有自动化或夹具证据。
- 未授权前无运行代码合入；授权后合入须附实现笔记与基线标签。
- **不宣称五域内容已对客户承诺完备**；骨架与机制收口 ≠ 内容收口。
- **不宣称可上线**。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 通过率骤降引发误判 | S0／S5 基线断裂先于对外汇报 |
| O1 域名与客户用语不一致 | 映射表＋中文 title 字段 |
| 019／020 完整面抢带宽 | 最小面清单写死；P1 另排 |
| Publish enqueue 误伤生产 | O3＝S 时由服务端入队；空映射不入队；可选配额／默认 off 为实现细节，不另开 O 项 |

## 8. 建议实施序（产品线）

本条为 **Spec 批次 S5** 主角。建议在 P0-1／P0-2／P0-3 合同稳定后实现检出器（误报防线 W5），但 **Spec／评审本阶段即可并行推进**。不得插队实现 P2 辅线挤占评审带宽；不得在未授权时改 `eval-runner.mjs`。
