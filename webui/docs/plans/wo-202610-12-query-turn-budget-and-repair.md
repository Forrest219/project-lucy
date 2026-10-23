# WO-202610-12 问询绑定、预算与可执行报错

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-12 |
| 标题 | P0：原话与 turn、问询预算、过滤条件下推、版本元数据、使用人三层 |
| 状态 | 已验收。SC-1 至 SC-9 有自动化断言。生产环境 turn 绑定率不是退出条件 |
| 来源 Spec | `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md` v0.2 |
| 来源计划 | `docs/plans/2026-10-11-customer-log-next-optimizations.md` v1.1 |
| 撰写日期 | 2026-10-11 |
| 适用范围 | Lucy MCP Proxy 的问询与 `lucy_query` 转发、访问日志字段、Token 的使用人标记、官方客户端接入说明。不改 KTX 源码，不提交客户 YAML |

## 目标

让一次查数在没有 `lucy_begin_question` 时仍然成功，有 session 时挂到同一问询，预算用尽时返回可继续的部分结果，过滤条件不再以 `AS field` 形状到达引擎，已发布的默认版本写进结果，使用统计能分开使用人、Agent 和自动化。

## 任务

- [x] **T1 术语。** 把 Spec 162 Terminology Compliance 中本波次会露到界面的主术语写入 `webui/docs/00-product-terminology-standard.md`：问询预算、可继续、修复提示、过滤条件下推、使用人、自动化调用、采用的版本。验收：新增文案只用这些主术语。

- [x] **T2 问询绑定。** 按 Spec 162 §7.1。`lucy_begin_question` 缺少 `intentSummary` 时返回 `missing_intent_summary`，不创建问询。其后的授权查询仍成功（SC-1、SC-3）。同一 session 内 begin 之后的调用为 `session_bound` / high（SC-2）。归因枚举不新增，沿用 Spec 138。

- [x] **T3 问询预算。** 按 §7.2。默认 20 次数据工具或 120 秒，可配置。用尽返回 `question_budget_exhausted`，`outcome=budget_stop`，失败维度为空（SC-4）。协议方法不占预算。继续一次后计数清零。同时改 `webui/config/data-qa-instructions.md` 的「失败预算与交付时限」：去掉「8 分钟内交付」和「最多 12 次」，改成与代理相同的 20 次或 120 秒，并写明可以继续一次。指导仍经 Spec 07 注入，失败 fail-open。

- [x] **T4 修复提示边界。** 按 §7.3。提示中的 source 与连接只来自当前角色。单测夹入 ACL 外名字必须失败（SC-5）。`Connection "…" is not configured` 归用法与语义；`unknown_or_forbidden_connection` 归权限拒绝。`wiki_not_found` 与 `explicit_table_required:<empty>` 归用法与语义；`wiki_forbidden` 与 `explicit_table_required:<table>` 归权限拒绝。分类单测可以在本工单先锁住，WO-13 的 SC-17 复用同一函数。

- [x] **T5 过滤条件下推。** 按 §7.4，先走 Spec 138 的 filters 规范化。编译结果匹配 `AS field` 或 `STRUCT(` 时失败关闭，写 `compiler_reason=filter_pushdown`。有 SQL 则按 Spec 125 写入 `generated_sql`；只有截断文本时 SQL 允许为空（SC-6、SC-7）。夹具各一条：KSC 的完整 `STRUCT('…' AS field, '=' AS op, '…' AS val)`，MJ 的 `...RUCT('…' AS field`。不修改 KTX 源码。

- [x] **T6 版本与新鲜度元数据。** 按 §7.5。只应用发布物里声明的默认版本，写入采用的版本、业务日、实际或预测（SC-8）。未声明时不写入编造值。客户具体版本号不进本仓库；用 demo 发布物做夹具。

- [x] **T7 使用人三层。** Token 增加可选 `actor_id` 与 `actor_kind=person|automation`。使用统计按使用人、Agent、自动化分组（SC-9）。`token_label` 保持为备注。未标记的 Python-urllib 不计入自动化。

- [x] **T8 客户端说明与测试。** 在 `docs/runbooks/agent-integration-guide.md` 写明官方客户端应发送 session、turn 和 begin 的原话，并写明不发送时仍可查数。SC-2 用测试客户端发送 session 来断言，不把 KSC 23.5% / MJ 25.2% 的生产绑定率当作本工单退出条件。外部里程碑：kscc-code 发版并上报 session 之后，再回看来源计划基线表的 turn 绑定率；发版窗口由客户端负责人确认，不阻塞 T1–T7。收口时确认来源计划已列入 `budget_stop` 率、`applied_version` 覆盖率、`actor_id` 标记覆盖率，上线后用这三列回看默认值。测试覆盖 SC-1 至 SC-9。

## 实现顺序

1. T1 与 T2 先做，避免预算和报错文案用未登记的说法。
2. T4 与 T5 一起做，修复提示和过滤条件下推共用名单函数。
3. T3 在 T2 的 turn 对象存在之后做。
4. T6、T7 可与 T3 并行。
5. T8 收口。

## 验收口径

Spec 162 的 SC-1、SC-2、SC-3、SC-4、SC-5、SC-6、SC-7、SC-8、SC-9 全部有自动化断言。缺一则本工单不算完成。

## 验证命令

```bash
cd webui
npm run lint:terminology
npm test -- --run server/__tests__/question-budget.test.ts server/__tests__/filter-pushdown-guard.test.ts server/__tests__/mcp-proxy-smoke.test.ts -t "Spec 162"
```

SC-1、SC-2、SC-3、SC-4、SC-6、SC-7、SC-8 的代理断言在 `mcp-proxy-smoke.test.ts` 的 Spec 162 用例。SC-4 的墙钟与第二次继续、SC-5、SC-8、SC-9 在 `question-budget.test.ts`。SC-6 的两条夹具与 SC-7 的开关在 `filter-pushdown-guard.test.ts` 与同一条代理用例。

## 风险与边界

| 风险 | 处理 |
|---|---|
| 旧客户端被 begin 强制切断 | SC-1 锁住：无 begin 的授权查询成功 |
| kscc-code 不发版 | 外部依赖。KSC 会话 ID 非空只有 21 行（`kscc-code/1.3.7` 与 `codex-mcp-client/0.159.2`）。不发版则生产 turn 绑定率停在 23.5% / 25.2%。WO-12 仍以夹具通过 SC-2 为完成 |
| 120 秒预算盖住约 26% 的历史问询 | 95/366 问询墙钟超过 120 秒。上线后看 `budget_stop` 率，再决定是否放宽默认值。继续一次后的第二档仍会停住 242 次工具调用的极端问询 |
| 预算把合法长分析记成失败 | `budget_stop` 不写失败维度，WO-202610-13 的四分聚合要排除它 |
| 修复提示泄漏不可见表 | SC-5 用 ACL 外名字做负例 |
| 默认版本改了财务数字 | 没有发布声明就不应用；结果里必须能看见采用的版本 |
| 在 Lucy 里重写 KTX 编译器 | 禁止。只做转发前失败关闭和审计归类 |

## 回滚

- 问询预算配置设为关闭时，不再返回 `question_budget_exhausted`。
- 过滤条件下推守卫关闭时，行为回到 Spec 138 的转发；`compiler_reason` 停止写入。
- `actor_id` 为空时使用统计只显示 Agent，与今天的 `user_id` 一致。
- 不删除已写入的问询和审计行。
