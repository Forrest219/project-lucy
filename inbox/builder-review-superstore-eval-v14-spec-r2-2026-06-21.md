已只读审阅迁移 spec，并对照 `superstore-eval-cases.yaml`、`docs/eval-quiz-conventions.md`、`scripts/lint-spec.mjs`、`scripts/eval-runner.mjs` 逐条核验。未修改任何文件。

# 复核结论

## 1. 总体结论：达到可交付 builder 标准（无阻断项）

该 spec 已收敛为一次清晰的 **metadata-only** 迁移（实际只需改 2 行：`runner_schema_version: v1.3 → v1.4`，并删除 `runner_schema_note`）。§1 现状描述、§2 非目标、§3.3/§3.4/§6 的护栏措辞充分，能够阻止 builder 误改 cases、quiz、expected result 与 safety_contract。可以交付，遗留问题均为非阻断改进。

## 2. B1 复核：上一轮事实性误述已关闭 ✅

B1 的核心是上一轮对「case body 是否仍含 legacy 字段 / 是否需要重写」的事实性误述。本轮 §1 与 §3.3 给出的现状陈述，我已逐项对照真实 YAML 验证，全部属实：

| spec §1 陈述 | YAML 实际 | 结论 |
|---|---|---|
| `metadata.version: v1.4` | line 4 = v1.4 | ✅ |
| `runner_schema_version: v1.3` | line 5 = v1.3 | ✅ |
| `runner_schema_note` 存在 | line 6 存在 | ✅ |
| 文件级 `safety_contract` 已按 v1.4 补齐 | line 27–38，与 conventions §7.1 结构一致 | ✅ |
| `quiz_cases` 内嵌同文件 | line 40–586 | ✅ |
| case body 无 `expected_result`/`required_sql_pattern`/`forbidden_sql_pattern` | 全 17 个 case 均用 `sql_assertions`/`result_assertions`/`tool/context_assertions`，无 legacy 裸字段 | ✅ |

§3.3 明确「No case body rewrite is expected」，与现状一致，不再诱导无谓重写。**B1 关闭。**

## 3. 阻断项

无。

## 4. 非阻断改进

1. **验收条款 #9 与 §4 自相矛盾（建议措辞收紧）**
   `lint-spec.mjs` 跑全仓 5 项检查（route-status / api-spec / skill-dependency / eval-schema-version / access-role-policy），`exit 0` 取决于全仓无任何 `fail`。而本迁移 scope 仅限 Superstore。§4 已正确说明「无关失败应单独报告，不得改 Superstore 去掩盖」，但 Acceptance #9 仍绝对要求「`npm run lint:spec` exits 0」。两者口径不一致，可能诱导 builder 为凑 exit 0 而越界。建议把 #9 改为「`eval-schema-version` 无 Superstore schema 警告，且本次改动不引入新的 fail」。注意：KX 财务 eval 若 schema 落后只是 `warn`（不影响 exit code），`lisi` 也是 `warn`，真正能拦住 exit 0 的只有 `fail` 级（如某 eval 缺 `safety_contract`）。

2. **§3.3 legacy 映射表把 `required_sql_pattern` 列为 v1.4 目标，措辞有歧义**
   conventions §7.1 明确 `required_sql_pattern`/`forbidden_sql_pattern` 本身是 legacy 字段、新 case 不应再用。映射表「SQL pattern checks → sql_assertions with … or `required_sql_pattern`」若被字面采用会反向退化。当前本表仅作 regression guard 且 §3.3 已声明「不应触发任何编辑、发现矛盾先 stop 上报」，故不阻断；建议把 `required_sql_pattern` 从 v1.4 目标列删除，改为 AST/normalized matcher。

3. **`based_on` 仍指向 conventions v1.3（可保留，建议留意）**
   YAML line 12 `based_on: docs/eval-quiz-conventions.md v1.3`。迁移后 runner schema 对齐到 v1.4，此 provenance 略显陈旧。spec Acceptance #5 要求保留 `based_on` 不变，属合理（历史溯源字段），不阻断；可在后续单独更新。

4. **`npm run eval:list` → `--list-cases` 的映射未在 spec 中点名**
   我已确认 runner 的 `--list-cases` 分支位于 preflight/MCP/claude 调用之前（main() line 1469 早于 1479），因此列举 17 个 case 不触发任何 LLM/MCP 调用，spec「eval:list 安全、eval 默认不允许」的判断成立。仅建议 builder 顺手确认 package.json 中 `eval:list` 确实映射到 `--list-cases`。

## 5. 验证记录

- **case 数量**：实点 17 个 `cases:`（discount-001/002/003/004、ordercount-001/002/003/004、profit-001/002、filter-001/002、segment-001、degradation-001、join-001/002、multiturn-001），与 spec §4/Acceptance #7 的「17」一致；`quiz_cases` 为 30 题（Q1–Q30），spec「count 排除 quiz_cases」表述正确。
- **quiz `eval_refs` 解析**：Q1/Q6/Q7/Q10/Q12/Q21/Q22/Q23/Q24/Q25/Q26/Q27/Q28/Q29/Q30 共引用的全部 case id 均存在于 `cases:`，无悬挂引用；反向 `linked_quiz_questions`（Q21–Q30 等）均落在 Q1–Q30 范围内。spec §3.4「自洽」结论成立。
- **lint 行为对照**：`evalSchemaVersion()` 取 conventions 表首个 `| v1.x |` = v1.4（currentValue=104）；Superstore v1.3=103 < 104 → 触发 `warn`，警告文案与 spec §1 引用的「runner_schema_version v1.3 is older than v1.4」逐字一致。改为 v1.4 后该 warn 消失，符合 spec 目标。`safety_contract` 已存在（否则会判 `fail`），迁移不会引入新 fail。`paired_quiz` 存在（缺失仅 `warn`）。
- **safety_contract 一致性**：YAML line 27–38 的 `readonly/forbid_secret_paths/forbid_cross_source_join/forbidden_ast(UPDATE…DDL/DML + cross_source_join)` 与 conventions §7.1 范式一致，且 eval-runner `safetyAssertions()`/`checkSecretPathSafety()` 会编译执行；spec §3.2「保持不变或更严，不得放宽」与运行时强制逻辑吻合。
- **越界风险扫描**：spec §2 非目标、§3.3（禁改 result/sql/context_assertions 与 expected 值）、§3.4（禁改 quiz 答案）、§6 out-of-scope（不重算 ground truth、不改 SL、不动 KX、不删 lisi）共同构成护栏，未发现会诱导误改 cases/quiz/expected result/safety_contract 的缺口。
