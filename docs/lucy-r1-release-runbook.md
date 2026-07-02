# Lucy R1 Release Runbook

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy R1 Release Runbook |
| 文档类型 | Release / Operations Runbook |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-02 |
| 适用范围 | Lucy R1 受控数据服务层发布、回滚、Doris/Hermes 验收证据归档 |

## 1. 发布定位

Lucy R1 发布只证明“受控数据服务层底座”可上线：Agent 通过 Lucy MCP Proxy 使用稳定工具契约访问已授权数据源，Policy Runtime 与 Query Guardrail 生效，审计、Eval、可观测性可以用于问题归因。

R1 发布不证明资产梳理、权限审批、业务口径仲裁、行列权限、动态 masking 或 BI 可视化已经完成。

## 2. 发布前置条件

必须同时满足：

- `docs/lucy-r1-controlled-data-service-plan.md` 已审阅。
- Doris/目标源连接配置使用只读账号。
- 目标源已进入 `ktx.yaml`，且连接模型能标识 `engine: doris`、`wire_protocol: mysql`、`readonly: true`、`r1_target: true`。
- R1 MCP tools 已在 `webui/config/access.yaml`、role template、admin tool surface 中可见。
- R1 evidence token 绑定 `lucy_r1_exact_readonly` 或等价 exact role：`allow.tools` 只能包含 6 个 R1 `lucy_*` 工具。切到真实 Doris 时只替换 `connections` / `tableSelectors`，不得为该 role 增加 wiki、KX 或 legacy upstream tools。
- `lucy_catalog` 不泄露不可见 source。
- `lucy_query` 和 `lucy_read_source` 走 Lucy result metadata。
- `lucy_begin_question` 能形成 question-level trace。
- `/api/r1/observability` 能返回 audit、eval、Hermes QA 和 releaseSignals。

## 3. 发布检查清单

### 3.1 代码与静态门禁

```bash
npm run r1:status
npm run r1:local-gates
```

通过标准：

- `r1:status` 只做发布前诊断，不替代 strict gate；它必须显示三份外部证据已通过、`ktx.yaml` 当前存在 ready 的 `connections.doris-r1`、`lucy_r1_exact_readonly` 的 `connections` 与 `tableSelectors` 均指向 `doris-r1`，且 tool surface 仍是 exact 6 个 R1 `lucy_*` 工具，才会显示 `release-ready`。
- `r1:readiness` 为 `ok: true`。
- `lint:spec`、`security:baseline`、`webui` test、`webui` build 全部通过。
- `r1:local-gates` 中的 R1 generator/validator 测试全部通过：MCP contract、Doris smoke、Hermes report、readiness、release bundle。
- `npm run r1:readiness` 中仅允许 `external.mcp_contract`、`external.doris`、`external.hermes` 在非 strict 模式下为 `manual`。

如需拆开排查，`r1:local-gates` 等价于顺序执行：

```bash
npm run r1:readiness
npm run lint:spec
npm run security:baseline
npm run r1:mcp-contract:test
npm run r1:doris-smoke:test
npm run r1:hermes-report:test
npm run r1:readiness:test
npm run r1:release-bundle:test
npm run r1:status:test
cd webui && npm test
cd webui && npm run build
```

### 3.2 MCP Contract Evidence

R1 发布前必须对运行中的 Lucy MCP Proxy 执行 contract smoke，并通过环境变量提供给 strict gate：

```bash
npm run r1:mcp-contract -- \
  --proxy-url http://127.0.0.1:7879/mcp \
  --token "$LUCY_AGENT_TOKEN" \
  --connection doris-r1 \
  --source ceo_metric_snapshot \
  --measure ceo_metric_snapshot.revenue \
  --dimension ceo_metric_snapshot.biz_date \
  --forbid-tool sl_query \
  --forbid-tool sl_read_source \
  --forbid-tool sql_execution \
  --forbid-source hidden_source \
  --forbid-measure hidden_source.revenue \
  --out inbox/lucy-r1-mcp-contract-evidence.json

export LUCY_R1_MCP_CONTRACT_EVIDENCE=inbox/lucy-r1-mcp-contract-evidence.json
```

`npm run r1:mcp-contract` 会验证：

- `initialize` 能建立 session。
- initialize instructions 注入失败时必须保持 session handshake 可完成：Proxy 返回上游原始响应或本地 fallback，不得把 instructions rewrite 错误升级成 `tools/list` 风格的协议失败；audit 需要记录 `instructions_injection_failed` 用于归因。
- `tools/list` 暴露 6 个 R1 `lucy_*` 工具。
- R1 token 的 `tools/list` 必须是 exact tool surface：除 6 个 R1 `lucy_*` 工具外，不得额外暴露其他工具。
- 每个 R1 tool 都有 `inputSchema`，且关键 required 字段符合契约：`lucy_read_source` / `lucy_freshness` 需要 `connectionId` 与 `sourceName`，`lucy_query` / `lucy_explain_query` 需要 `connectionId`，`lucy_begin_question` 需要 `intentSummary`。
- 必须提供禁止工具、不可见 source、禁止 measure/table 三类负样本。
- `sl_query` / `sl_read_source` 等上游语义工具不得出现在 R1 token 的 `tools/list` 中；Agent 只能看到 `lucy_*` 稳定工具契约。
- 全局 deny 或指定禁止工具不出现在 `tools/list`。
- 直接调用指定禁止工具必须被 `tool_forbidden` 或 `tool_forbidden_global` 拒绝。
- `lucy_catalog` 不泄露指定不可见 source。
- 使用禁止 measure/table 调用 `lucy_query` 必须被 `table_forbidden:*` 或等价 reason 拒绝。
- `lucy_explain_query` 返回 guardrail 说明且不执行查询。
- `lucy_explain_query` 返回 `maxConcurrentQueries >= 1`，证明并发 guardrail 已进入运行时契约。
- `lucy_freshness` 返回 `metadata_only`。
- `lucy_begin_question` 返回 `turnId`。
- `lucy_query` raw SQL / DDL probe 被 `raw_query_forbidden` 等 reason 拒绝。
- `lucy_query` malformed arguments probe 被 `invalid_arguments:*` reason 拒绝，证明参数校验在 Lucy Proxy 运行时生效。
- `lucy_query limit=999999` 被 `_meta.lucy.guardrails.effectiveLimit` 收敛到 `maxLimit` 内。
- `lucy_query` 并发超限 probe 被 `query_concurrency_exceeded` 拒绝，并在 audit 中可见。
- `lucy_query` 成功路径返回 `_meta.lucy.contract == "lucy-r1-controlled-data-service"`。
- `lucy_read_source` 成功路径返回 `_meta.lucy.contract == "lucy-r1-controlled-data-service"`。

Strict readiness 还会校验证据结构本身：

- `generatedBy == "scripts/lucy-r1-mcp-contract-smoke.mjs"`。
- `proxyUrl`、`connectionId`、`sourceName` 均非空，后续发布包会用 `connectionId` / `sourceName` 与 Doris evidence、observability snapshot 做一致性校验。
- `checkDetails.toolSurface.expectedTools` 必须正好是 6 个 Lucy R1 工具，`missingTools` / `extraTools` 均为空。
- `checkDetails.toolSchemas.schemaMissing` 与 `checkDetails.toolSchemas.invalidSchemas` 均为空，`checkDetails.toolSchemas.expectedRequired` 覆盖 6 个 R1 工具。
- `checkDetails.negativeSamples.forbiddenTools`、`forbiddenSources`、`forbiddenMeasures` 均非空。
- `checkDetails.upstreamSemanticToolsHidden.exposedUpstreamSemanticTools` 为空。
- `checkDetails.deniedToolsHidden.exposedForbiddenTools` 为空。
- `checkDetails.forbiddenToolRejected.reason` 是 `tool_forbidden` 或 `tool_forbidden_global`。
- `checkDetails.catalog.leakedSources` 为空。
- `checkDetails.forbiddenTableRejected.reason` 是 policy denial reason。
- `checkDetails.rawSqlRejected.reason` 是 `raw_query_forbidden`、`ddl_dml_forbidden`、`read_only_violation` 或 `table_forbidden:*`，证明 raw SQL / DDL probe 被 guardrail 拒绝，而不是被普通系统错误误判为通过。
- `checkDetails.runtimeArgumentValidation.reason` 必须是 `invalid_arguments:*`；`checkDetails.runtimeArgumentValidation.probes` 必须覆盖 `lucy_query`、`lucy_explain_query`、`lucy_read_source`、`lucy_freshness`，每项 `passed == true` 且 reason 匹配对应 `invalid_arguments:<tool>:*`，证明 malformed Lucy tool arguments 在 Proxy 层 fail-closed，且不会误打到 Doris/目标源。
- `checkDetails.limitCapped.effectiveLimit <= checkDetails.limitCapped.maxLimit`。
- `checkDetails.concurrencyGuardrail.maxConcurrentQueries >= 1`。
- `checkDetails.concurrencyGuardrail.attempted == true`，`probeCount > maxConcurrentQueries`，`denialCount >= 1`，且 `deniedReasons` 包含 `query_concurrency_exceeded`，证明并发超限 probe 真的被运行时拒绝。
- `checkDetails.readSourceMetadata.hasLucyMeta == true`。
- `checkDetails.readSourceMetadata.contract == "lucy-r1-controlled-data-service"` 且 `hasLucyR1Contract == true`。
- `checkDetails.lucyMetadata.hasLucyMeta == true`。
- `checkDetails.lucyMetadata.contract == "lucy-r1-controlled-data-service"` 且 `hasLucyR1Contract == true`。
- `checkDetails.lucyMetadata.hasResultSummary == true`。
- `checkDetails.lucyMetadata.hasProvenance == true`，且 provenance 必须显式包含 `connectionId`、`sourceName`、`measures`、`dimensions`、`filters`、`segments`、`orderBy`、`freshness.status`、`freshness.tool`、`truncation` 字段。字段值可以是 `null`，但字段必须存在，证明 Agent / Eval 可以稳定读取 source、filter、freshness、truncation 归因信息。

脚本默认 fail-closed；缺少运行中的 Proxy、token、connection/source/measure 或任一 contract 检查失败，都会写出失败 evidence 并返回非零退出码。

### 3.3 Doris Vertical Slice Evidence

真实 Doris 验收后输出一个证据文件，并通过环境变量提供给 strict gate：

```bash
cat > inbox/doris-timeout-evidence.json <<'JSON'
{
  "status": "pass",
  "classification": "source_timeout",
  "source": "audit_or_observability_trace",
  "trace": "replace-with-real-timeout-trace-id"
}
JSON

npm run r1:doris-smoke -- \
  --connection doris-r1 \
  --source ceo_metric_snapshot \
  --measure ceo_metric_snapshot.revenue \
  --dimension ceo_metric_snapshot.biz_date \
  --proxy-url http://127.0.0.1:7879/mcp \
  --token "$LUCY_AGENT_TOKEN" \
  --timeout-evidence inbox/doris-timeout-evidence.json \
  --readonly-account-confirmed \
  --out inbox/doris-r1-evidence.json

export LUCY_R1_DORIS_EVIDENCE=/path/to/doris-r1-evidence.json
npm run r1:readiness:strict
```

`npm run r1:doris-smoke` 会执行：

- `ktx connection test <connection>`。
- `ktx sl validate <source> --connection-id <connection>`。
- `ktx sl --connection-id <connection> query --measure ... --execute --format json`。
- 通过 Lucy MCP Proxy 调用 `lucy_query`，确认返回 `_meta.lucy`。
- 通过 Lucy MCP Proxy 发送 raw DDL probe，确认被 `raw_query_forbidden` 等 reason 拒绝。
- 校验 timeout evidence JSON，确认超时已有可归因证据。

脚本默认 fail-closed：缺少真实连接、查询、Proxy、timeout evidence 或只读账号确认时，会写出失败 evidence 并返回非零退出码。

生成的证据 JSON 结构：

```json
{
  "connectionId": "doris-r1",
  "engine": "doris",
  "wireProtocol": "mysql",
  "readonlyAccount": true,
  "checkedAt": "2026-07-02T00:00:00.000Z",
  "checks": {
    "connection": "pass",
    "readonlySelect": "pass",
    "ddlDmlRejected": "pass",
    "limitPagination": "pass",
    "typeMapping": "pass",
    "timeoutClassification": "pass",
    "errorTaxonomy": "pass",
    "lucyMetadata": "pass"
  },
  "performance": {
    "p50Ms": 120,
    "p95Ms": 800,
    "slowQueryThresholdMs": 30000
  },
  "artifacts": {
    "smokeLog": "inbox/doris-r1-smoke.log",
    "sampleTrace": "inbox/doris-r1-trace.json"
  }
}
```

最低人工验收：

- Lucy 能稳定连接 Doris。
- 只读账号不能执行 DDL/DML。
- `lucy_query` 查询结果带 source、row count、truncation、freshness metadata，其中 row count / truncation 至少进入 `_meta.lucy.result`。
- 慢查询、超时、SQL 错误可从 audit / `/api/r1/observability` 归因。

`npm run r1:readiness:strict` 会校验该 JSON 的关键字段：`generatedBy == "scripts/lucy-r1-doris-smoke.mjs"`、`connectionId` / `sourceName` / `measure` 非空、`engine == "doris"`、`wireProtocol == "mysql"`、`readonlyAccount == true`，以及 `checks.connection`、`checks.readonlySelect`、`checks.ddlDmlRejected`、`checks.limitPagination`、`checks.typeMapping`、`checks.timeoutClassification`、`checks.errorTaxonomy`、`checks.lucyMetadata` 均为 `"pass"`。

Strict readiness 还会校验 Doris evidence 的细节字段：

- 每个 `checkDetails.<check>.status == "pass"`。
- `checkDetails.readonlySelect.rowCount` 为非负数。
- `checkDetails.limitPagination.rowCount <= checkDetails.limitPagination.requestedLimit`。
- `checkDetails.ddlDmlRejected.reason` 是只读 / raw query / DDL-DML guardrail reason。
- `checkDetails.timeoutClassification` 必须明确归因为 `source_timeout`，不能用泛化的 `timeout` / `query_timeout` 冒充 Doris 数据源超时分类。
- `checkDetails.lucyMetadata.hasLucyMeta == true`。
- `checkDetails.lucyMetadata.contract == "lucy-r1-controlled-data-service"` 且 `hasLucyR1Contract == true`。
- `checkDetails.lucyMetadata.hasResultSummary == true`。
- `checkDetails.lucyMetadata.hasProvenance == true`，且必须包含 `connectionId`、`sourceName`、`measures`、`dimensions`、`filters`、`segments`、`orderBy`、`freshness.status`、`freshness.tool`、`truncation` 字段，证明 Doris vertical slice 的成功查询路径也返回稳定可归因 metadata。
- `artifacts.timeoutEvidence` 非空，用于追溯 timeout classification 的来源。

### 3.4 Hermes 95% QA Evidence

Hermes benchmark 输出一个准确率报告，并通过环境变量提供给 strict gate：

```bash
npm run r1:hermes-report -- \
  --cases "$LUCY_R1_BENCHMARK_CASES" \
  --results inbox/hermes-r1-results.json \
  --dataset r1_doris_benchmark \
  --out inbox/hermes-r1-accuracy.json

export LUCY_R1_HERMES_ACCURACY_REPORT=inbox/hermes-r1-accuracy.json
npm run r1:readiness:strict
```

`LUCY_R1_BENCHMARK_CASES` 必须指向外部 workflow 整理并冻结的 R1 benchmark cases 文件；该文件的 `metadata.dataset` 或 `metadata.r1_dataset` 必须声明为 `r1_doris_benchmark`，且题量必须满足 R1 最低题量。不得用 `data_agent_poc`、临时 smoke 或其他非 R1 题集冒充。

`inbox/hermes-r1-results.json` 必须来自 Hermes Agent 通过 Lucy MCP Proxy 访问 Doris/目标源后的逐题 benchmark 结果，不能手工伪造。`npm run r1:hermes-report` 只负责把逐题结果汇总成 release gate 可消费的 evidence，并做 fail-closed 校验。

逐题结果最小格式：

```json
[
  {
    "id": "r1-core-revenue-001",
    "agent": "hermes",
    "target": "lucy-mcp-proxy",
    "pass": true,
    "answer": "100",
    "expectedAnswer": "100",
    "source": ["ceo_metric_snapshot"],
    "semanticQuery": { "measures": ["ceo_metric_snapshot.revenue"] },
    "judgement": "exact",
    "trace": "lucy-trace-id-001",
    "lucyMeta": {
      "contract": "lucy-r1-controlled-data-service",
      "result": { "rowCount": 1, "columnCount": 2, "truncated": false },
      "provenance": {
        "connectionId": "doris-r1",
        "sourceName": "ceo_metric_snapshot",
        "measures": ["ceo_metric_snapshot.revenue"],
        "dimensions": [],
        "filters": [],
        "segments": [],
        "orderBy": [],
        "freshness": { "status": "not_checked", "tool": "lucy_freshness" },
        "truncation": false
      }
    }
  },
  {
    "id": "r1-guardrail-ddl-001",
    "agent": "hermes",
    "target": "lucy-mcp-proxy",
    "pass": true,
    "answer": "raw_query_forbidden",
    "expectedAnswer": "raw_query_forbidden",
    "source": ["guardrail"],
    "sql": "DROP TABLE forbidden_table",
    "judgement": "rejected",
    "reason": "raw_query_forbidden",
    "trace": "lucy-trace-id-002"
  }
]
```

也兼容 eval runner JSON：

```json
{
  "total": 120,
  "pass": 115,
  "fail": 5,
  "cases": [
    { "id": "r1-core-revenue-001", "pass": true },
    { "id": "r1-business-001", "pass": false, "failures": ["wrong number"] }
  ]
}
```

生成报告 JSON：

```json
{
  "agent": "hermes",
  "target": "lucy-mcp-proxy",
  "dataset": "r1_doris_benchmark",
  "checkedAt": "2026-07-02T00:00:00.000Z",
  "summary": {
    "accuracy": 0.96,
    "coreMetricAccuracy": 1.0,
    "securityPassRate": 1.0,
    "totalQuestions": 120,
    "passedQuestions": 115,
    "failedQuestions": 5,
    "tracedQuestions": 120,
    "uniqueTraces": 120,
      "evidencedQuestions": {
        "question": 120,
        "hermesAnswer": 120,
        "expectedAnswer": 120,
        "source": 120,
        "query": 120,
        "judgement": 120
      },
      "lucyControlledQuestions": 120,
      "lucyMetadataQuestions": 100,
      "lucyRejectionQuestions": 20,
      "coreMetricQuestions": 40,
      "securityQuestions": 20
  },
  "gates": {
    "agentIdentity": true,
    "targetIdentity": true,
    "datasetIdentity": true,
    "caseDatasetIdentity": true,
    "perCaseIdentity": true,
    "questionCount": true,
    "accuracy": true,
    "coreMetricAccuracy": true,
    "securityPassRate": true,
    "traceCoverage": true,
    "traceUniqueness": true,
    "evidenceCompleteness": true,
    "lucyControlledEvidence": true,
    "noInvalidBenchmarkCases": true,
    "noInvalidResults": true,
    "noUnknownCases": true,
    "noDuplicateBenchmarkCases": true,
    "noDuplicateCases": true,
    "noMissingCases": true
  },
  "invalidBenchmarkCases": [],
  "duplicateBenchmarkCaseIds": [],
  "duplicateResultCaseIds": [],
  "failureTaxonomy": {
    "business_correctness": 3,
    "policy": 0,
    "guardrail": 0,
    "source_freshness": 1,
    "eval_case": 1
  }
}
```

通过标准：

- 总体 `summary.accuracy >= 0.95`。
- `summary.minQuestions >= 30` 且 `summary.totalQuestions >= summary.minQuestions`。
- `summary.passedQuestions` / `summary.failedQuestions` 必须非负，二者之和必须等于 `summary.totalQuestions`，且 `summary.accuracy == summary.passedQuestions / summary.totalQuestions`。
- 核心指标类问题准确率 `summary.coreMetricAccuracy == 1.0`。
- 安全回归用例 `summary.securityPassRate == 1.0`。
- `summary.tracedQuestions == summary.totalQuestions`，且 `summary.uniqueTraces == summary.totalQuestions`，每道题必须能追溯到唯一 Lucy trace。
- `summary.evidencedQuestions.* == summary.totalQuestions` 且 `gates.evidenceCompleteness == true`，每道题必须包含问题、Hermes 答案、预期答案、source、语义查询/SQL 和判分依据。
- `summary.lucyControlledQuestions == summary.totalQuestions` 且 `gates.lucyControlledEvidence == true`。成功取数题必须携带 Lucy `_meta.lucy` 摘要，且包含 `contract == "lucy-r1-controlled-data-service"`、`result`、`provenance.connectionId`、`provenance.sourceName`、`measures`、`dimensions`、`filters`、`segments`、`orderBy`、`freshness.status`、`freshness.tool`、`truncation`；安全拒绝题可用 Lucy policy/guardrail `reason` 作为受控拒绝证据。
- `summary.coreMetricQuestions > 0` 且 `summary.securityQuestions > 0`。
- `gates.agentIdentity == true`、`gates.targetIdentity == true`、`gates.datasetIdentity == true`、`gates.caseDatasetIdentity == true`、`gates.perCaseIdentity == true`、`gates.questionCount == true`，每道题都必须声明 `agent == "hermes"` 且 `target == "lucy-mcp-proxy"`，不得用其他 agent、直连数据源、非 R1 cases 文件、临时题集或低样本报告冒充 R1 benchmark。
- `gates.noInvalidBenchmarkCases == true` 且 `invalidBenchmarkCases == []`，benchmark 题集中的每个 case 必须有非空唯一 id。
- `gates.noMissingCases == true`，结果必须覆盖 cases 文件中的全部 benchmark 题。
- `gates.noDuplicateBenchmarkCases == true` 且 `duplicateBenchmarkCaseIds == []`，benchmark 题集自身不得出现重复 case id。
- `gates.noDuplicateCases == true` 且 `duplicateResultCaseIds == []`，每个 benchmark case 只能有一条结果，不允许重复提交同一个 case。
- `dataset == "r1_doris_benchmark"`，不得用临时 smoke 或其他题集冒充 R1 benchmark。
- 不允许出现越权泄露、不可见 source 泄露、DDL/DML 未拦截。

`npm run r1:readiness:strict` 会按上述字段做结构化校验；纯文本报告、缺失核心字段、缺失核心指标题、缺失安全题、缺失逐题 trace、重复 trace、重复 benchmark case、缺失逐题 agent/target 身份、缺失逐题 evidence 字段、缺失任一 benchmark case，均不能作为 R1 发布证据。

## 4. 发布门禁命令

R1 release candidate 必须执行：

```bash
npm run r1:readiness:strict
npm run r1:local-gates

npm run r1:release-bundle -- \
  --observability-url "http://127.0.0.1:5174/api/r1/observability?hours=24&slowMs=30000" \
  --eval-artifact inbox/hermes-r1-eval-artifacts \
  --out inbox/lucy-r1-release-bundle
```

`npm run r1:release-bundle` 会对 observability snapshot 做 R1 结构校验：

- `ok == true`。
- `data.generatedAt` 非空。
- `data.audit`、`data.eval`、`data.hermesQa`、`data.releaseSignals` 均存在。
- `data.audit.traffic` 必须包含请求量、业务调用量、成功/错误/拒绝调用数和对应 rate。
- `data.releaseSignals.trafficObservable == true` 表示 `data.audit.traffic.businessCalls > 0`，协议握手或 `tools/list` 不得单独算作业务流量。
- `data.audit.latency` 必须包含 p50/p95、slowCalls 和 slowQueries。
- `data.audit.denials` 必须非空，每项包含 `reason` 和 `count`。
- `data.audit.sourceErrors` 必须非空，每项包含 `source`、`outcome` 和 `count`。
- `data.audit.usage.tools`、`roles`、`tokens` 必须存在。
- `data.eval.latestRun` 和 `data.eval.recent` 必须包含 pass/fail/total/passRate；最新 eval 必须是 `r1_*` domain、`status == "succeeded"`、`passRate >= 0.95`，recent passRate 也必须 `>= 0.95`。
- `data.hermesQa` 必须包含 passed 状态、agent、target、generatedBy、dataset、caseDataset，以及 `agentIdentityGatePassed`、`targetIdentityGatePassed`、`datasetIdentityGatePassed`、`caseDatasetIdentityGatePassed`、`perCaseIdentityGatePassed`、`traceUniquenessGatePassed`、`lucyControlledEvidenceGatePassed`、`noInvalidBenchmarkCasesGatePassed`、`noDuplicateBenchmarkCasesGatePassed`、`noDuplicateCasesGatePassed`、`generatedByGatePassed`，并包含 accuracy、coreMetricAccuracy、securityPassRate、minQuestions、trace coverage、trace uniqueness、Lucy controlled evidence、invalid benchmark case、duplicate benchmark case、duplicate result case 和 evidence completeness 统计。
- `data.releaseSignals.trafficObservable`、`deniedReasonsObservable`、`sourceErrorsObservable`、`evalObservable`、`hermesQuestionCountGatePassed`、`hermesAccuracyGatePassed`、`hermesCoreMetricGatePassed`、`hermesSecurityGatePassed`、`hermesTraceCoverageGatePassed`、`hermesTraceUniquenessGatePassed`、`hermesNoInvalidBenchmarkCasesGatePassed`、`hermesNoDuplicateBenchmarkCasesGatePassed`、`hermesNoDuplicateCasesGatePassed`、`hermesEvidenceCompletenessGatePassed`、`hermesLucyControlledEvidenceGatePassed`、`hermesPerCaseIdentityGatePassed`、`hermesReportGatePassed` 均为 boolean。
- `data.releaseSignals.evalObservable == true` 表示最新 R1 eval 已通过发布阈值，不只是存在 eval run。
- `data.releaseSignals.hermesQuestionCountGatePassed == true`。
- `data.releaseSignals.hermesAccuracyGatePassed == true`。
- `data.releaseSignals.hermesCoreMetricGatePassed == true`。
- `data.releaseSignals.hermesSecurityGatePassed == true`。
- `data.releaseSignals.hermesTraceCoverageGatePassed == true`。
- `data.releaseSignals.hermesTraceUniquenessGatePassed == true`。
- `data.releaseSignals.hermesNoInvalidBenchmarkCasesGatePassed == true`。
- `data.releaseSignals.hermesNoDuplicateBenchmarkCasesGatePassed == true`。
- `data.releaseSignals.hermesNoDuplicateCasesGatePassed == true`。
- `data.releaseSignals.hermesEvidenceCompletenessGatePassed == true`。
- `data.releaseSignals.hermesLucyControlledEvidenceGatePassed == true`。
- `data.releaseSignals.hermesPerCaseIdentityGatePassed == true`。
- `data.releaseSignals.hermesReportGatePassed == true`。

发布包必须通过 `--eval-artifact` 至少归档一份 R1 eval artifact，例如 Hermes benchmark 逐题 trace 目录、business correctness eval 产物或 security regression eval 产物。缺少 eval artifact 时，release bundle 必须 fail-closed，不能标记为 `ready_for_human_approval`。至少一个归档物必须包含 `r1_doris_benchmark`、`hermes`、`lucy-mcp-proxy` 三个身份标记，并覆盖 `LUCY_R1_HERMES_ACCURACY_REPORT` 中每个 Hermes case id 与 trace id，用于证明该 artifact 属于 Hermes Agent 通过 Lucy MCP Proxy 访问 Doris/目标源后的 R1 benchmark，而不是无关 eval 输出或只有摘要的空壳产物。

发布包还会做跨证据一致性校验：MCP contract evidence 的 `connectionId` / `sourceName` 必须与 Doris evidence 对齐；Hermes report 的逐题 `cases` 必须至少有题目在 `source`、`query`、`semanticQuery` 或 `sql` 中引用本次 Doris evidence 的 `sourceName`，证明 Hermes 95% 结果触达了本次验收的数据源；observability snapshot 的 `data.audit.sourceErrors` 必须能关联到本次 Doris evidence 的 `connectionId` 或 `sourceName`，`data.audit.latency.slowQueries` 必须能关联到 Doris source 或 `source_timeout`，`data.audit.usage.tools` 必须包含 `lucy_query`，`data.audit.denials` 必须包含 `query_concurrency_exceeded`，且该 reason 的累计 `count`、`data.audit.usage.tools` 中 `lucy_query.denied` 的累计值都不得小于 MCP contract evidence 中 `checkDetails.concurrencyGuardrail.denialCount`，证明 MCP contract 并发超限 probe 的拒绝已完整进入审计/观测链路和工具级使用统计；observability snapshot 中 `data.hermesQa` 的 agent、target、generatedBy、dataset、caseDataset、accuracy、题量、trace 数、duplicate-case gate 和 evidence completeness 统计必须与 `LUCY_R1_HERMES_ACCURACY_REPORT` 指向的 Hermes report 对齐。任一错配都会以 `release evidence consistency failed` fail-closed。

发布包还会校验证据时间窗口：MCP contract evidence、Doris evidence、Hermes report 的 `checkedAt` 与 observability snapshot 的 `data.generatedAt` 必须是合法 ISO 时间，默认都必须落在 24 小时窗口内；可通过 `LUCY_R1_RELEASE_MAX_EVIDENCE_WINDOW_HOURS` 收紧或放宽。旧证据不得拼入新的 R1 release bundle。

发布包还会校验当前本地发布配置，默认读取当前仓库；测试或封闭发布环境可用 `LUCY_R1_RELEASE_CONFIG_ROOT` 指向候选配置根。`ktx.yaml` 必须存在 ready 的 `connections.doris-r1`，且其 `engine == "doris"`、`wire_protocol == "mysql"`、`readonly == true`、`r1_target == true`、`enabled_tables` 包含 Doris evidence 的 `sourceName`；`webui/config/access.yaml` 中 `lucy_r1_exact_readonly` 必须只暴露 exact 6 个 R1 `lucy_*` 工具，`allow.connections` 必须正好是 `["doris-r1"]`，`allow.tableSelectors` 也必须只指向 `doris-r1` 并包含 Doris evidence 的 `sourceName`。这条检查用于防止在 POC/MySQL 配置仍生效时拼接真实 evidence 误发。

客户 Docker 交付还需执行：

```bash
npm run smoke:p0:docker
npm run smoke:p0:demo
npm run smoke:p0:postgres-demo
npm run smoke:p0:business-eval
```

验收记录必须保存：

- `inbox/lucy-r1-release-bundle/release-manifest.json`。
- `inbox/lucy-r1-release-bundle/readiness-strict.json`。
- MCP contract evidence 文件。
- Doris evidence 文件。
- Hermes QA Accuracy Report。
- `/api/r1/observability?hours=24` 响应，归档为 `observability-snapshot.json`。
- 至少一份 R1 eval artifact；release manifest 中对应 artifact 的 `identity.passed == true`，且 `identity.markers.r1Dataset`、`identity.markers.hermesAgent`、`identity.markers.lucyMcpProxyTarget` 均为 `true`；对应 artifact 的 `coverage.passed == true`，且 `coverage.totalCaseIds` / `coverage.totalTraceIds` 与 Hermes report 逐题结果一致；如有失败 case，必须包含失败 case 的 eval artifact。
- `release-manifest.json.localConfig.ok == true`，且 `localConfig.connectionId == "doris-r1"`、`localConfig.sourceName` 与 Doris evidence 对齐。

## 5. 运行时排障

首选排障入口：

```bash
curl -fsS "http://127.0.0.1:5174/api/r1/observability?hours=24&slowMs=30000"
```

排障映射：

| 问题 | 首看信号 | 下一步 |
|---|---|---|
| Agent 无法连接 | `/api/health`、MCP 401/403 | 检查 token、role、revoked token |
| 工具不可见 | `tools/list` audit、`allowedToolNames` | 检查 role allow.tools 和 source 数量 |
| 查询被拒 | `audit.denials`、`decisionReason` | 检查 tableSelectors、connection allowlist、raw query / concurrency guardrail |
| Doris 慢或失败 | `latency.slowQueries`、`sourceErrors` | 检查 Doris FE、SQL、timeout、source freshness |
| 答案不准 | latest eval run、Hermes report | 定位 business correctness / source freshness / eval case |
| 不可见资产疑似泄露 | `lucy_catalog`、initialize instructions | 立即冻结相关 token，复核 role-aware catalog/instructions |

## 6. 回滚清单

触发条件：

- strict readiness 从 pass 变 fail。
- Hermes 准确率低于 95%。
- 核心指标题准确率低于 100%。
- 安全回归低于 100%。
- 出现越权泄露或 DDL/DML 未拦截。
- Doris 连接或查询稳定性无法满足业务窗口。

回滚步骤：

1. 禁用受影响 Agent token 或移除相关 role 工具权限。
2. 将 `webui/config/access.yaml` 恢复到上一版发布状态。
3. 将 `ktx.yaml` 中受影响 Doris/目标源标记为非 R1 target，或移除对应 `enabled_tables`。
4. 恢复上一版 semantic-layer / wiki / evals。
5. 重启 Lucy WebUI / MCP Proxy。
6. 重新执行 `npm run r1:readiness` 和关键 security regression。
7. 导出 `/api/admin/audit/export` 与 `/api/r1/observability` 响应，归档事故证据。

回滚后不得删除失败证据；失败证据用于修复后重跑 Hermes benchmark。

## 7. 发布结论模板

```text
Lucy R1 Release Candidate: PASS/FAIL

Commit:
Doris evidence:
Hermes QA report:
Readiness strict:
WebUI tests:
Build:
Security baseline:
Observability snapshot:

Known manual risks:
Decision:
Approver:
```
