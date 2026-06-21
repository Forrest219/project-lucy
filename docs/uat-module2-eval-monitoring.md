# Module 2 Eval 配置与监控人工 UAT 用例

| 元数据 | 内容 |
|---|---|
| 文档名称 | Module 2 Eval 配置与监控人工 UAT 用例 |
| 文档类型 | Test Report |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-19 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | docs/design-eval-monitoring.md；evals/superstore/eval/superstore-eval-cases.yaml；Module 2 当前实现审计讨论 |
| 适用范围 | Module 2 UI 层与 Case 编辑完整性实现完成后的人工验收 |
| 输出位置 | project-lucy/docs/uat-module2-eval-monitoring.md |

---

## 1. UAT 前置条件

- WebUI 已启动，并可访问 eval 相关页面。
- `claude auth status` 正常。
- KTX MCP daemon 可访问，默认地址为 `http://localhost:7878/mcp`。
- 当前 eval YAML 至少包含以下 case：
  - `superstore-discount-001`
  - `superstore-ordercount-002`
  - `superstore-profit-001`
  - `superstore-multiturn-001`
- 开发侧 smoke 验证已通过：
  - `npm test`
  - `npx tsc --noEmit`
  - `npm run build`

## 2. UAT-01 Case 列表与最近运行

**目标**：确认 Case 管理入口能读取现有 YAML，并显示最近运行状态。

**步骤**：
1. 打开 `/eval/cases/superstore`。
2. 搜索 `discount`。
3. 确认能看到 `superstore-discount-001`、`superstore-discount-002`、`superstore-discount-003`、`superstore-discount-004`。
4. 查看表格列：类型、指标、linked quiz 或覆盖字段、最近运行状态。
5. 清空搜索条件，确认总数为 17。

**通过标准**：
- 列表不报错。
- case 数量正确。
- `superstore-discount-001` 显示 `weighted_discount` 和 `Q21`。
- 最近运行列在无历史 run 时显示空态或 `-`，有历史 run 后显示 PASS/FAIL。

## 3. UAT-02 Case 详情字段完整性

**目标**：确认编辑器不会丢失现有 YAML 字段。

**步骤**：
1. 打开 `/eval/cases/superstore/superstore-ordercount-002`。
2. 检查字段：
   - `case_type = single_turn`
   - `expected_measures` 包含 `order_count,total_sales`
   - `linked_quiz_questions` 包含 `Q1,Q6`
   - `result_assertions` 可见
3. 切到 YAML 或 raw JSON 兜底视图。
4. 不修改内容，点击预览 diff。

**通过标准**：
- 预览 diff 为空，或仅有可解释的格式差异。
- 保存前后 `linked_quiz_questions` 不丢失。
- 未编辑字段不会被清空。

## 4. UAT-03 复制 Case

**目标**：验证设计文档 §9 的复制验收路径。

**步骤**：
1. 在 `/eval/cases/superstore` 找到 `superstore-discount-001`。
2. 点击复制。
3. 新 ID 改为 `superstore-discount-001-copy`。
4. `notes` 填写 `UAT copy test`。
5. 预览 diff。
6. 确认写入。
7. 回到列表搜索 `discount-001-copy`。

**通过标准**：
- 新 case 出现在列表。
- `git diff evals/superstore/eval/superstore-eval-cases.yaml` 能看到新增段。
- 新 case 保留原 case 的关键断言字段。
- `node scripts/eval-runner.mjs --list-cases` 能列出新 ID。

## 5. UAT-04 Raw JSON 兜底编辑

**目标**：确认 UI 未建模字段可以保留和编辑。

**步骤**：
1. 打开 `/eval/cases/superstore/superstore-multiturn-001`。
2. 查看 multi-turn `turns`。
3. 在 raw JSON 里给 `context_assertions` 增加一个 harmless 字段：

```json
{ "inherit_measures": ["profit_margin"] }
```

4. 预览 diff。
5. 确认写入。
6. 重新打开该 case。

**通过标准**：
- `turns` 不丢失。
- `context_assertions` 写入后可重新读取。
- YAML 仍可被 `node scripts/eval-runner.mjs --list-cases` 正常解析。

## 6. UAT-05 触发单 Case Run

**目标**：验证触发、preflight、SSE、入库。

**步骤**：
1. 打开 `/eval/runs`。
2. 触发新 Run。
3. Domain 选 `superstore`。
4. Case 选择单个 ID：`superstore-discount-001`。
5. KTX MCP URL 保持 `http://localhost:7878/mcp`。
6. 填写触发原因：`UAT single case run`。
7. 开始运行。

**通过标准**：
- 如果 Claude 未登录，明确显示 preflight 失败，而不是创建失败 run。
- 如果环境正常，跳转到 RunDetail。
- 运行中显示 `current/total`，例如 `1/1`。
- 完成后 run 状态为 `succeeded`，或显示可解释失败。
- DB 有该 run 记录。

## 7. UAT-06 RunDetail 失败详情

**目标**：验证结果查看能力。

**步骤**：
1. 打开刚才的 run 详情。
2. 展开 case 行。
3. 查看 SQL、expected、actual、drift、failedAssertions、finalText。
4. 点击跳转到 Case 编辑。

**通过标准**：
- PASS/FAIL 状态清晰。
- FAIL 时能看到 expected vs actual。
- SQL 有则展示；无则明确显示未捕获。
- drift 显示 `pass`、`data_drift`、`logic_regression`、`schema_drift`、`tool_error` 之一。
- 跳转 Case 编辑路径正确。

## 8. UAT-07 Artifact 下载

**目标**：验证 runner 原始产物可追溯。

**步骤**：
1. 在 RunDetail 点击下载 JSON。
2. 点击下载 MD。
3. 打开下载内容检查 run summary。

**通过标准**：
- JSON 是可解析的 runner summary。
- MD 包含 case id、PASS/FAIL、failures 或 SQL 信息。
- 文件名含 run id，或能够区分不同 run。

## 9. UAT-08 Run Compare

**目标**：验证 run 间对比。

**步骤**：
1. 至少准备两个 superstore run。
2. 打开较新的 run。
3. 选择“对比上一轮”或指定 run id。
4. 查看对比表。

**通过标准**：
- 表中按 case 显示 left/right 状态。
- 至少能区分 `regressed`、`fixed`、`unchanged`。
- summary 数字与表格一致。

## 10. UAT-09 Monitor 趋势与 Drift 分布

**目标**：验证持续监控入口。

**步骤**：
1. 打开 `/eval/monitor`。
2. Domain 选 `superstore`。
3. 时间选 30 天。
4. 查看通过率趋势、失败 Top-N、Drift 分布。
5. 修改黄线阈值为 95%，保存。

**通过标准**：
- 趋势图显示历史 run。
- 阈值线更新。
- Drift 分布至少显示 `pass` 和失败分类。
- 配置保存后刷新页面仍保留。

## 11. UAT-10 安全与异常路径

**目标**：确认错误处理可理解。

**步骤**：
1. 尝试打开不存在 case：`/eval/cases/superstore/not-exist`。
2. 尝试触发 `failed_in_last`，但没有上次失败 case。
3. 在一个 run 执行中再次触发 run。
4. 触发运行时填不可用 MCP URL。

**通过标准**：
- 不存在 case 返回清晰错误。
- 无失败回归时不静默跑全集。
- 并发触发返回 `RUNNER_BUSY`。
- MCP 或 runner 失败能在 run 详情或 toast 中看到原因。

## 12. UAT 结论记录模板

| 项目 | 结论 |
|---|---|
| 验收日期 | 2026-06-21 |
| 验收人 | Codex 技术自检；业务验收人待签字 |
| WebUI 版本或 commit | 3834f0d 基线，本轮 ACL/P2 补丁待提交 |
| 测试环境 | macOS 本机；project-lucy；KTX MCP 默认 `http://localhost:7878/mcp` |
| 总体结论 | PASS WITH ISSUES（技术自检通过后待人工 UAT 签字） |
| 阻塞问题 | 无已知技术阻塞；生产 MySQL COMMENT DDL 需 DBA/库 owner 授权执行 |
| 非阻塞问题 | 人工 UAT 记录仍需业务验收人补签；WebUI 连接管理页面文档状态不属本轮范围 |
| 备注 | 本轮只补交付记录模板，不宣称已完成业务人工验收 |

---

## 13. 2026-06-21 状态更新

本文仍作为 Module 2 Eval 配置与监控的人工 UAT 模板使用，不表示业务人工验收已完成。

后续静态核对显示，`docs/review-module2-eval-monitoring.md` 中两条原 CHANGE 已被后续实现处理或改为明确拒绝：

- `coverage` 模式不再静默全跑，而是返回 `UNSUPPORTED_SELECTION_MODE`。
- runner run status 已按 `summary !== null` 判定。
- `GET /api/eval/domains/:domain` 已存在。

实际执行 UAT 前仍需：

- 启动 WebUI 和 KTX MCP。
- 跑 `cd webui && npm test && npx tsc --noEmit && npm run build`。
- 准备至少一次 eval run 数据，才能完整验证 RunDetail、artifact 下载、compare 和 monitor 趋势。
