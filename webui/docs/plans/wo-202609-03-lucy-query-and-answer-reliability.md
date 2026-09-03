# WO-202609-03：Lucy 查询与回答可靠性修复

| 元数据 | 内容 |
|---|---|
| 文档类型 | Plan / Work Order |
| 版本 | v1.1 |
| 日期 | 2026-09-03 |
| 状态 | Implemented（含 UAT 后代码修复，待部署复验） |
| 权威契约 | [Spec 138](../138-lucy-query-execution-and-turn-correlation-reliability-spec.md)、[Spec 139](../139-enterprise-data-agent-answerability-and-delivery-standard.md) |
| 前置基线 | [Spec 137](../137-access-log-audit-evidence-hardening-spec.md) 当前本地未部署改动 |

## 1. 执行约束

- 先让 Spec 137 定向测试全绿，再叠加本 WO；禁止把旧版 CSV 当成现有代码行为证明。
- 测试先行：先提交失败断言，再写最小实现，再跑回归。
- 不读取或提交客户私有数据；回放只保留脱敏参数形状和 mock 结果。
- 本次只做代码、单测、脚本和静态验证；不重建 Docker，不做浏览器验证。
- 当前工作树已有用户改动；不回滚、不覆盖无关 diff，也不做包含无关文件的提交。

## 2. 分波落地计划

### W0 — 审计基线清零

| 任务 | 文件 | 验证 |
|---|---|---|
| 修正 Spec 137 export-pack 测试的时间窗口夹具 | `webui/server/__tests__/admin-audit.test.ts` | Spec 137 五个定向 suite 全绿 |
| 确认已有隐私/Session/证据包改动无格式错误 | 当前 Spec 137 diff | `git diff --check` |

退出门槛：现有红测不再污染后续修复判断。

### W1 — 查询参数规范化与排序正确性（P0）

| 任务 | 文件 | 验证 |
|---|---|---|
| 新增纯函数 canonicalizer | `webui/server/proxy/lucy-query-normalization.ts` | 新 unit suite 覆盖 QE-01..04 |
| Proxy 在审计/ACL/上游前调用 canonicalizer | `webui/server/proxy/mcp-proxy.ts` | malformed/conflict 请求不出站 |
| contract smoke 断言 `order_by` 和实际 SQL | `webui/server/__tests__/mcp-proxy-smoke.test.ts` | QE-05 |
| CLI contract 同步 | `scripts/lucy-r1-mcp-contract-smoke.mjs` 及测试 | 结构化与字符串化 filter parity |

退出门槛：QE-01..06 全绿；失败 reason 稳定且无敏感值。

### W2 — Session/Turn 隔离与审计可信度（P0）

| 任务 | 文件 | 验证 |
|---|---|---|
| 独立 Turn resolver 与 TTL registry | `webui/server/proxy/turn-correlation.ts` | 交错 Session、过期、多候选 unit |
| 替换全局 identity 近邻匹配 | `webui/server/proxy/mcp-proxy.ts` | TC-01..03 Proxy 集成 |
| additive audit 字段与导出 | `webui/server/proxy/audit.ts`、`webui/server/admin/audit.ts`、共享类型 | API/CSV/pack 断言 AU-01..02 |
| 修订旧风险决策 | `webui/docs/08-mcp-audit-question-tracing-spec.md` | Spec lint |

退出门槛：同 Token 并发 Session 不串 Turn；弱推断不会显示为高置信。

### W3 — 可回答性与最终交付规则（P0）

| 任务 | 文件 | 验证 |
|---|---|---|
| 更新运行时静态 instructions | `webui/config/data-qa-instructions.md` | instruction snapshot/contract tests |
| 同步角色感知动态 instructions | `webui/server/proxy/mcp-proxy.ts` | 不同角色均含核心硬规则 |
| 更新 Agent/工具契约文档 | `webui/docs/09-lucy-r1-mcp-tool-contract.md` | QE-06 与参数示例一致 |

退出门槛：预算、hybrid、实现单价、失败预算、partial delivery 五类规则均可自动断言。

### W4 — 合成 Eval 与回放（P1）

| 任务 | 文件 | 验证 |
|---|---|---|
| 建立脱敏可靠性 eval suite | `evals/` 下符合约定的新 dataset | schema/safety contract lint |
| 覆盖旧样本的失败形状，不复制原始业务数据 | fixtures / mock upstream | AG-01..08 |
| 使用既有预算字段 | eval YAML | `max_total_tool_calls <= 12`、重复输入与 failure budget 生效 |
| 生成配对人工 Quiz | `evals/agent_reliability/agent_reliability-quiz-cases.html` | paired quiz link 与 6 类覆盖 lint |

退出门槛：确定性 contract 全绿；有模型凭据时 agent eval 输出 result JSON 与 suite hash。

### W5 — 发布门禁与收尾（P1）

| 任务 | 验证 |
|---|---|
| 跑定向 unit/integration/contract suites | 全绿，无 skipped 核心 AC |
| TypeScript 与治理 lint | typecheck、`lint:spec`、`lint:terminology` |
| 仓库卫生 | `git diff --check`；确认无私有日志、数据或 secret 新增 |
| 记录限制 | 无 Docker/browser 证据；生产 StarRocks/LLM UAT 作为部署前独立门槛 |

### W6 — 真实 UAT 三项修正（P1）

| 任务 | 验证 |
|---|---|
| 消除 healthcheck 的 EPIPE 假阴性 | stub 长输出仍成功；命令、状态、WebUI、MCP 探针失败均拒绝 |
| 补齐发布模板的问询上报工具 | 模板契约测试覆盖通用、Docker、Postgres 与 Executive POC |
| 收敛参数拒绝码中文映射 | Audit 组件和 MCP 调试台共用映射，精确码和通用兜底均有测试 |
| 识别保留配置缺口 | `r1:status` 非阻断列出缺少 `lucy_begin_question` 的数据角色 |

退出门槛：只执行代码级检查；不运行 Docker、HTTP 实例或浏览器。

## 3. 验证矩阵

| 风险 | 失败测试 | 实现后证据 |
|---|---|---|
| 字符串化 filter 上游报 SQL 错 | JSON string parity + malformed case | canonical args 与结构化输入等价 |
| `orderBy` 被吞 | camelCase smoke | 上游收到 `order_by`；`generatedSql` 为 DESC |
| 同 Token 串轮次 | 两 Session 交错 case | 每行归入各自 Turn |
| 外来 Turn 污染 | foreign explicit ID | `unassigned/none` + reject reason |
| 重试循环 | 重复 error fingerprint eval | 第二次后停止并交付 partial |
| 预算幻觉 | 无预算依赖 case | `unavailable`，无预算差额数字 |
| 只给过程不给答案 | 部分工具失败 case | 最终回答逐项给状态与 Provenance |

## 4. 代码验证命令

```bash
cd webui

npm test -- --run \
  server/__tests__/audit-privacy.test.ts \
  server/__tests__/mcp-proxy-audit-meta.test.ts \
  server/__tests__/mcp-proxy-instructions.test.ts \
  server/__tests__/admin-audit.test.ts

npm test -- --run \
  server/__tests__/lucy-query-normalization.test.ts \
  server/__tests__/turn-correlation.test.ts \
  server/__tests__/mcp-proxy-smoke.test.ts

npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext \
  --moduleResolution NodeNext --strict --skipLibCheck --types node \
  server/proxy/lucy-query-normalization.ts server/proxy/turn-correlation.ts
npm run build
node ../scripts/lint-spec.mjs
npm run lint:terminology
git diff --check
```

若脚本名称与 `package.json` 不一致，以仓库实际 script 为准，并在收尾报告写明替代命令。

## 5. 回滚与兼容

- canonicalization 为 Proxy 边界适配，可按模块回滚；拒绝 reason 保持稳定。
- 审计字段只做 additive 迁移；回滚代码时保留数据库列，避免破坏旧 SQLite。
- instructions 回滚不得覆盖 Spec 137 的隐私和审计修复。
- eval/fixture 可独立回滚，不影响 runtime。

## 6. Definition of Done

- Spec 138 的 QE/TC/AU 验收项均有自动化证据。
- Spec 139 的 AG-01..08 至少有合成 contract/eval 覆盖。
- Spec 137 定向回归继续全绿。
- 最终报告区分“代码验证通过”与“未做 Docker、浏览器、生产数据 UAT”。
- 新增文件不包含客户日志原文、业务明细、Token、IP、内部连接信息或 secret。
- HC-01、ACL-01、UI-01、UI-02 有独立自动化回归，且没有放宽显式 ACL。

## 7. 实施结果与验收证据

完成日期：2026-09-03。以下结论只表示本地代码验证通过，不表示已部署。

| 验收项 | 直接证据 | 结果 |
|---|---|---|
| QE-01 / QE-02 | `lucy-query-normalization.test.ts` 与 Proxy smoke：结构化/字符串化 filter 等价；损坏 JSON 不出站 | PASS |
| QE-03 / QE-04 | canonicalizer unit 与 Proxy smoke：排序别名统一；冲突 fail closed | PASS |
| QE-05 | Proxy smoke 同时断言上游 `order_by` 与返回 `generatedSql` 中 `ORDER BY ... DESC` | PASS |
| QE-06 | explain 集成测试与 contract smoke：`executionMode=plan_only`、`executed=false`；缺失字段时 contract fail closed | PASS |
| TC-01 | 同一 Token、两个 Session 交错 begin/call 集成测试 | PASS |
| TC-02 | identity/session 不匹配与未知显式 Turn unit/integration；审计 reason 为 `turn_attribution_rejected` | PASS |
| TC-03 | 无 Session 唯一候选为 `identity_inferred/low`，多候选为 `unassigned/none` | PASS |
| DB-01 | legacy SQLite fixture 自动补齐归因字段与 `conversation_turns.session_id`，随后成功写入 | PASS |
| AU-01 | Admin API、CSV 与 evidence pack 直接断言 mode/confidence/reason | PASS |
| AU-02 | API、CSV 与 evidence pack 分别断言数值 `0`、布尔 `false` 和未知空值不混淆 | PASS |
| AG-01..04 | 静态/动态 instructions contract + budget、hybrid、realized price 合成 Eval | PASS（代码合同） |
| AG-05..06 | Eval runner 的调用预算断言 + retry-budget 合成 case | PASS（代码合同） |
| AG-07..08 | partial-delivery 合成 case与 instructions contract | PASS（代码合同） |
| HC-01 | healthcheck stub 覆盖长输出 ready、状态命令失败、非 ready、WebUI/MCP 探针失败 | PASS（5/5） |
| ACL-01 | 4 份发布配置模板契约 + 显式授权、零数据源、未授权 ACL 回归 | PASS |
| UI-01 / UI-02 | Audit 组件与 MCP 调试台共享映射；精确码和通用兜底 | PASS |

最终代码验证：

- 10 个 Lucy/审计定向 suite：90/90 通过。
- 审计隐私回归覆盖正常、损坏及恶意结构化 filter：`args_summary` 仅保留安全字段/操作符和结构计数，不保留业务值。
- R1 MCP contract smoke：Node 22 下 13/13 通过，包含 explain 非执行契约的负向测试。当前本机 Node 24.13.1 与 Codex bundled Node 24.19.0 均在该 `node:test` 套件启动时触发 Node 原生 `InternalCallbackScope` 断言；该环境兼容问题未伪装为代码通过。
- Eval runner 自测：66/66 通过；可靠性 suite 成功加载 5 个脱敏 case，并生成 6 题配对 Quiz。
- Vite production build、定向 TypeScript、Eval schema/Quiz 校验、文档索引核验与 `git diff --check` 通过；Spec 141 后续路由已完成登记，当前全量 `lint:spec` 恢复为 PASS。
- UAT 三项修正新增/定向回归共 83/83 通过（Node 14/14、Vitest 69/69）；Vite production build、`lint:spec`、`lint:terminology` 与限定文件的 `git diff --check` 通过。`lint:spec` 仅保留既有非阻断 warning。
- 新增 Spec、WO、Eval/Quiz 与核心模块的敏感模式扫描无命中；未提交原始对话、审计明细、Token、IP 或内部连接信息。
- 全仓 `tsc --noEmit` 仍有 57 个工作树基线错误；错误未指向本 WO 新增或修改的 Lucy 文件，因此不作为本 WO 的假阳性通过项，也不得对外宣称全仓 typecheck 已绿。

未执行且不属于本次授权范围：Docker 重建、浏览器验证、部署、生产 StarRocks/LLM UAT。
