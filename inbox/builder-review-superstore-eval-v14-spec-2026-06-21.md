# Superstore Eval v1.4 迁移 Spec 复核

## 1. 总体结论

**有条件通过（建议修正 1 项事实性描述后即可交付 builder）。**

该 spec 的范围、安全约束、期望值冻结策略和验收口径整体扎实：scope 严格限定单文件、明确"非失败验证不得改业务期望值"、完整保留 v1.4 `safety_contract`、验收标准多为可机检项。我核对了实际 eval 文件、`lint-spec.mjs`、`eval-runner.mjs` 与 `package.json`，得出关键事实：

- **实际迁移工作量远小于 spec 描述**：`superstore-eval-cases.yaml` 的 case body 已经是完整的 v1.4 结构（`case_type` / `result_assertions` / `sql_assertions` / `context_assertions`），且全文**不含任何 legacy 字段**（无 `expected_result` / `required_sql_pattern` / `forbidden_sql_pattern`）。真正需要改动的只有 metadata 两行：`runner_schema_version: v1.3 → v1.4` 与删除 `runner_schema_note`。
- **该改动对 Runner 运行时零影响**：`eval-runner.mjs` 只读取 `cases` 与 `safety_contract`，根本不消费 `runner_schema_version`。版本号纯粹是 `lint-spec.mjs` 的告警信号，因此迁移本身是安全的、无副作用的。

唯一需要在交付前修正的，是 spec 第 1/3.3 节对"当前状态"的事实性误述（详见阻断项），它恰好落在本次最敏感的风险区（误改 expected result）。

## 2. 阻断项

**B1（事实性误述，落在风险区，必须修正）**
spec §1 与 metadata 中的 `runner_schema_note` 称"保留 v1.3 直到 case body 完成 v1.4 结构化迁移"，§3.3 又给出一整张 `expected_result → result_assertions` 的 legacy 转换映射。但实际文件的 case body **已全部完成 v1.4 结构化，没有任何 legacy 字段可迁移**。

- 风险：builder 若按 §1/§3.3 字面理解，可能去"重构" case body，从而误碰 `result_assertions` 中的期望值（如 `order_count: 5083`、`profit_margin: 0.1257`）或 quiz。这正是任务要求重点防范的缺口。
- 现有缓解：§3.3 用了条件句"If a case still uses legacy fields…"、非目标条款、验收 #7 等护栏，使谨慎的 builder 不会真正改值。因此这是**文档准确性级别的阻断**，不是安全漏洞。
- 要求修正：把 §1 改为"case body 已完成 v1.4 结构化，本次仅需改 metadata 两行（bump 版本 + 删 note）"；§3.3 标注为"经核查无 legacy 字段命中，本节仅作回归保险，不应触发任何 case body 改写"。

> 说明：除 B1 外无其他硬阻断。若团队接受将 B1 作为"已知冗余、靠护栏兜底"，则可直接交付；但鉴于成本极低且消除主要误导源，建议先修。

## 3. 非阻断改进

- **N1｜验收 #8 把"局部无告警"与"全仓 lint 退出 0"混为一谈。** `lint-spec.mjs` 还跑 `route-status` / `api-spec` / `skill-dependency` / `access-role-policy` 等检查，任一不相关 `fail` 都会让 `lint:spec` 退出 1，与本次迁移无关。建议把验收口径改为"`eval-schema-version` 检查 PASS 且无 Superstore `runner_schema_version` 告警"，而非笼统要求全仓退出 0。
- **N2｜验收 #5（quiz `eval_refs` 全部可解析）无自动化兜底。** `lint-spec.mjs` 不校验 quiz 链接，`eval-runner.mjs` 也不校验。spec 把它列为"规则/验收项"却未给验证手段。我已静态核对当前链接自洽（Q1/Q6→ordercount-002、Q7→profit-001、Q10/Q29→join-002 等均存在），迁移也不动这些字段，故风险低；建议 spec 明确"由 builder 人工核对或指出当前已自洽、迁移不触碰"。
- **N3｜"保留字段"清单不完整。** §3.1 的 keep 列表未包含实际存在的 `based_on` 与 `legacy_migration` 块。按字面执行可能让 builder 误以为可删。建议补一句"未列出的现有字段一律保留"。
- **N4｜`based_on` 轻微过期。** metadata `based_on` 仍写"docs/eval-quiz-conventions.md v1.3"，而约定文档现为 v1.4。可顺手更新或显式声明"本次不动 `based_on`"，避免后续混淆（保持不动也安全）。
- **N5｜`eval:list` 仅统计 `cases:` 数组（17 条），不含 quiz_cases。** 验收 #9"case 数不减少"对应的就是这 17 条，建议在 spec 注明基线 = 17，便于 builder 直接比对。
- **N6｜提醒勿误跑全量 eval。** spec 已写"非显式要求不跑 costly model eval"，可再补一句：`npm run eval:list` 在 preflight 之前返回、无需 claude/MCP，是安全验证入口；`npm run eval`（无 `--list-cases`）会真连 MCP+claude，迁移阶段不要执行。

## 4. 验证记录

| 项目 | 方法 | 结果 |
|---|---|---|
| 迁移目标文件现状 | Read `superstore-eval-cases.yaml` | `version: v1.4`、`runner_schema_version: v1.3`、`runner_schema_note` 存在；`safety_contract`、`paired_quiz`、`quiz_cases` 均在 |
| legacy 字段是否残留 | grep `expected_result/required_sql_pattern/forbidden_sql_pattern` | **NO_LEGACY_FIELDS_FOUND**（case body 已是 v1.4 结构）|
| case 计数基线 | 人工清点 `cases:` | 17 条，与约定文档一致 |
| 版本号是否消费于运行时 | Read `eval-runner.mjs` `loadCases` | 仅用 `cases` + `safety_contract`，不读 `runner_schema_version` → 迁移运行时无副作用 |
| lint 告警逻辑 | Read `lint-spec.mjs` `evalSchemaVersion` | current 取约定文档首个 `v1.4`；v1.3 < v1.4 → warn；bump 到 v1.4 后告警消除；warn 不致 exit 1 |
| 安全契约一致性 | 对比 spec §3.2 / 文件 / 约定 §7.1 | 三处一致；spec 明确"不得放宽、case 级只能加严" |
| 验证命令是否存在 | Read `package.json` | `lint:spec`、`eval:list`(`--list-cases`) 均存在；`eval:list` 在 preflight 前返回，安全 |
| quiz 链接自洽性 | 抽样核对 eval_refs / linked_quiz_questions | 抽样均指向存在的 id，未发现悬空引用 |
| 实跑 `lint:spec` / `eval:list` | Bash | **未能执行**（复核处于只读/禁运行模式，node 与 npm 调用被拒）；以上结论基于对脚本与数据的静态核读，建议 builder 落地后实跑确认退出码 |
