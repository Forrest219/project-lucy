# MCP Audit Source & Question Tracing Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | MCP Audit Source & Question Tracing Spec |
| 文档类型 | Spec |
| 版本 | v0.2 |
| 撰写日期 | 2026-06-22；v0.2 修订 2026-06-22（补 acl.ts 导出面、access_log_id 回填设计、并发归并已知限制、Phase 1 任务清单细化） |
| 委托人 | 张星晨 |
| 基于材料 | `webui/docs/07-mcp-auth-proxy-spec.md`、`webui/server/proxy/{mcp-proxy,acl,audit}.ts`、`semantic-layer/mysql-aliyun/_schema/dataforai.yaml`、2026-06-22 workhorse MCP 审计查询 |
| 适用范围 | Lucy MCP Proxy 审计增强：调用数据源正规化、问题簇推断、可选自然语言问题上报 |
| 输出位置 | `webui/docs/08-mcp-audit-question-tracing-spec.md` |

---

## 1. 背景与问题陈述

Lucy MCP Proxy 已经记录 `access_log`，可追溯 agent、tool、tables、args 摘要、outcome、duration、token、permission snapshot 等信息。2026-06-22 对 `workhorse` 最近一小时审计复核暴露出两个缺口：

1. **数据源可查但未正规化**：当前 `access_log.tables` 能记录物理表，如 `dataforai.kx_fact_financial_amount`；`connectionId/sourceName/schema` 需要从 `args_summary` 或 semantic-layer source map 反查，不是一等审计字段。
2. **无法精确还原自然语言问题**：`lucy_turn_id` / `lucy_session_id` 已有字段，但 Hermes workhorse 当前不传；Lucy Proxy 只能看到 MCP 工具调用，默认看不到用户原始问题。

约束：**不能修改 Hermes workhorse**。因此本 spec 只要求 Lucy 自身增强，不依赖客户端改造。自然语言问题记录作为可选能力，不作为审计正确性的强制前提。

## 2. 目标与验收标准

| 目标 | 验收标准 |
|---|---|
| 调用级数据源正规化 | 每条业务 `tools/call` 日志可查询到 `connectionId/schema/sourceName/physicalTable`；来源包括 `sl_read_source`、`sl_query`、`sl_validate`、`entity_details` 和 proxy 本地工具 |
| 问题簇推断 | 即使没有 `lucy_turn_id`，系统也能把连续业务调用聚合为 `inferred_turn`，并给出开始/结束时间、涉及工具、数据源、调用数、置信度 |
| 自然语言问题可选上报 | Proxy 可在 `tools/list` 注入 `lucy_begin_question`；模型调用时写入 `conversation_turns`，但漏调不影响数据查询和审计 |
| Audit UI 可读 | 管理员可按「问题簇」查看 workhorse 问了几个问题、每个问题查了哪些数据源、触发了哪些工具调用 |
| KTX / Hermes 零改动 | 不修改 KTX 上游，不要求 Hermes workhorse 增加 header 或新 API 调用 |
| 隐私安全 | 原始自然语言问题默认不强制保存；保存时必须脱敏、限长、可关闭，并支持 retention 策略 |

## 3. Non-Goals

- 不保证 100% 还原用户原始自然语言问题；Lucy 只能记录主动上报的问题，或基于工具调用做推断。
- 不修改 Hermes workhorse、Claude Code、Codex app 等外部客户端。
- 不把自然语言问题作为 ACL 裁决输入；权限仍只由 token、role、tool、connection、table/source 决定。
- 不解析完整 SQL AST；raw query 仍按现有安全策略默认禁用或只做 best-effort 摘要。
- 不把推断问题当作事实原文。UI 和导出必须标注 `inferred` / `reported` 来源。

## 4. 总体设计

```text
MCP client
  └─ POST /mcp
      └─ Lucy MCP Proxy (:7879)
          ├─ identity / ACL
          ├─ tools/list 注入 lucy_begin_question（可选）
          ├─ tools/call 转发 KTX 或本地处理
          ├─ write access_log
          ├─ write access_log_sources
          └─ turn inference worker
               ├─ conversation_turns      # 可选自然语言上报
               └─ inferred_turns          # Lucy 基于调用簇推断
```

设计分三层：

1. **Source Normalization**：把每次调用触达的数据源拆成结构化记录。
2. **Inferred Turns**：在没有上层 turn id 时，按时间和调用内容聚合为问题簇。
3. **Optional Question Reporting**：通过 proxy 注入本地 MCP 工具，允许模型主动上报自然语言问题。

## 5. 数据模型

**设计决策（access_log_id 回填）**：下表 `access_log_sources.access_log_id` 是外键，依赖写入时能拿到 `access_log` 自增插入的 `id`。现有 `writeLog()`（`audit.ts`）是 fire-and-forget，不返回 `lastInsertRowid`。本 spec 钦定方案：**`writeLog()` 改为返回插入行 id**（或新增一个 `writeLogWithSources()` 合并写入函数，二者选其一，由 Phase 1 实现时定），不得把这个决定留给实现者临场决定，避免出现两套不一致的写入路径。

### 5.1 `access_log_sources`

一条 `access_log` 可触达多张表 / source，因此使用子表。

```sql
CREATE TABLE IF NOT EXISTS access_log_sources (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  access_log_id     INTEGER NOT NULL,
  ts                TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  tool              TEXT NOT NULL,
  connection_id     TEXT,
  schema_name       TEXT,
  source_name       TEXT,
  physical_table    TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  confidence        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  FOREIGN KEY(access_log_id) REFERENCES access_log(id)
);

CREATE INDEX IF NOT EXISTS idx_als_log ON access_log_sources(access_log_id);
CREATE INDEX IF NOT EXISTS idx_als_user_ts ON access_log_sources(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_als_source ON access_log_sources(connection_id, schema_name, source_name);
CREATE INDEX IF NOT EXISTS idx_als_table ON access_log_sources(physical_table);
```

字段口径：

| 字段 | 说明 |
|---|---|
| `connection_id` | KTX connection，如 `mysql-aliyun`；能从 args 或 source map 确定时填写 |
| `schema_name` | 物理 schema，如 `dataforai` |
| `source_name` | semantic-layer source，如 `kx_fact_financial_amount` |
| `physical_table` | 物理表全名，如 `dataforai.kx_fact_financial_amount` |
| `extraction_method` | `args_source_name` / `field_ref` / `query_ref` / `source_map_reverse` / `catalog` / `unknown` |
| `confidence` | `high` / `medium` / `low` |

### 5.2 `conversation_turns`

用于记录可选上报的自然语言问题。

```sql
CREATE TABLE IF NOT EXISTS conversation_turns (
  turn_id               TEXT PRIMARY KEY,
  session_id            TEXT,
  user_id               TEXT NOT NULL,
  token_hash_prefix     TEXT,
  platform              TEXT,
  client                TEXT,
  question_hash         TEXT,
  question_preview      TEXT,
  question_summary      TEXT,
  question_source       TEXT NOT NULL,
  redaction_version     TEXT,
  created_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ct_user_created ON conversation_turns(user_id, created_at);
```

约束：

- `question_source` 取值：`reported_tool` / `header` / `admin_import`。
- `question_preview` 默认最多 500 字，写入前脱敏。
- v0.1 不要求保存完整原文；若后续要保存完整原文，必须新增加密字段和 retention policy，不复用 `question_preview`。

### 5.3 `inferred_turns`

用于 Lucy 自身从工具调用聚类出问题簇。

```sql
CREATE TABLE IF NOT EXISTS inferred_turns (
  inferred_turn_id     TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  started_at           TEXT NOT NULL,
  ended_at             TEXT NOT NULL,
  call_count           INTEGER NOT NULL,
  business_call_count  INTEGER NOT NULL,
  tool_summary         TEXT NOT NULL,
  source_summary       TEXT NOT NULL,
  question_summary     TEXT,
  confidence           TEXT NOT NULL,
  evidence_json        TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inferred_turn_access_logs (
  inferred_turn_id TEXT NOT NULL,
  access_log_id    INTEGER NOT NULL,
  PRIMARY KEY(inferred_turn_id, access_log_id)
);

CREATE INDEX IF NOT EXISTS idx_it_user_time ON inferred_turns(user_id, started_at, ended_at);
```

## 6. Source Normalization 规则

### 6.1 source map

复用 `acl.ts` 中现有 semantic-layer source map 逻辑：

```text
semantic-layer/<connection>/_schema/<schema>.yaml
  tables.<sourceName>.table -> <schema>.<physicalTable>
```

示例：

```text
mysql-aliyun / dataforai / kx_fact_financial_amount
  -> dataforai.kx_fact_financial_amount
```

**前置任务（实现前必须先做）**：上述映射逻辑（`loadSourceMap`、`SourceMapEntry`、内部 `sourceMap` 缓存）目前在 `acl.ts` 中是模块私有的，对外只导出收敛成物理表字符串数组的 `extractTables()`。"复用"不是直接调用现成函数，而是要求先给 `acl.ts` 新增导出面——一个返回结构化 `{connectionId, schema, sourceName, table}` 的查询函数（而不是收敛后的字符串），`mcp-proxy.ts` 才能据此填充 `access_log_sources` 的各列。

### 6.2 提取优先级

按以下顺序生成 `access_log_sources`：

1. `params.arguments.sourceName` + `connectionId`：`sl_read_source`、`sl_validate`、部分 `entity_details`，置信度 `high`。
2. `sl_query` 字段引用：从 `measures/dimensions/filters/order_by/group_by` 中识别 source/table，置信度 `high`。
3. `access_log.tables` 反查 source map：已知物理表反查 source，置信度 `medium`。
4. raw query best-effort：从 `queryTables` 中反查，置信度 `low` 或 `medium`。
5. `kx_catalog`：记录为 catalog 访问，不写具体表；或写允许 source 列表摘要到 `evidence_json`，不展开成 N 条 source 触达，避免误解为真实查数。

### 6.3 失败语义

- 数据源提取失败不得影响 MCP 请求转发。
- `access_log` 必须照常写入；`access_log_sources` 可为空。
- 提取异常写入 server log，必要时在 `access_log.decision_reason` 或后续诊断表中记录，但不能暴露敏感参数。

## 7. Inferred Turn 聚类规则

### 7.1 输入范围

只聚合业务调用：

```text
included: tools/call 中的 sl_query, sl_read_source, sl_validate, entity_details, kx_catalog, wiki_search, wiki_read, ...
excluded: initialize, notifications/initialized, tools/list
```

默认 `kx_catalog` 只有在前后 120 秒内存在其他业务调用时，才并入问题簇；孤立 catalog 调用标记为 `preflight_only`，不计为正式问题。

### 7.2 v0.1 聚类算法

对同一 `user_id + token_hash_prefix` 按时间排序：

1. 忽略协议类调用。
2. 若当前业务调用距上一条业务调用 `<= 120s`，归入同一簇。
3. 若间隔 `> 120s`，开启新簇。
4. 若簇内只有 `kx_catalog`，标记为 `confidence=low`，默认不计入“问题数”主指标。
5. 若簇内包含至少一个数据承载调用（有 `access_log_sources` 或 `tables`），标记为正式 inferred turn。

配置项：

| 环境变量 | 默认值 | 说明 |
|---|---:|---|
| `LUCY_TURN_INFER_GAP_MS` | `120000` | 业务调用间隔阈值 |
| `LUCY_TURN_INFER_INCLUDE_CATALOG_ONLY` | `false` | 是否把孤立 catalog 计为问题 |
| `LUCY_TURN_INFER_LOOKBACK_HOURS` | `24` | 后台增量推断回看窗口 |

### 7.3 `question_summary` 生成

v0.1 采用规则摘要，不强依赖 LLM：

```text
查询 KX 财务数据：涉及利润表/收入相关 source，期间 2026，触达 kx_fact_financial_amount、kx_dim_financial_item
```

摘要输入来自：

- `source_name` / `physical_table`
- `args_summary.filters`
- `statement_type` / `amount_type` / `company_name` / `report_period` 等常见字段
- tool 序列和调用时间

后续可选接入 LLM 生成更自然的摘要，但必须保留规则证据 `evidence_json`。

## 8. Optional Question Reporting

### 8.1 本地 MCP 工具：`lucy_begin_question`

Proxy 在 `tools/list` 中注入一个本地工具：

```json
{
  "name": "lucy_begin_question",
  "description": "Optional. Call once at the beginning of a user business question to record the user's natural-language question for Lucy audit. Do not call for protocol checks or tool discovery only.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "question": { "type": "string", "maxLength": 2000 },
      "intentSummary": { "type": "string", "maxLength": 500 },
      "entities": {
        "type": "array",
        "items": { "type": "string" },
        "maxItems": 20
      }
    },
    "required": ["intentSummary"],
    "additionalProperties": false
  }
}
```

处理逻辑：

1. 不转发 KTX。
2. 生成 `turn_id = lucy_<timestamp>_<random>`。
3. 写入 `conversation_turns`。
4. 返回 `turn_id` 和提示：后续调用无需携带额外参数；Lucy 会按最近 turn 和时间窗口尝试关联。

### 8.2 与 access_log 的关联

因为不能要求 Hermes workhorse 传 header，v0.1 采用 proxy 侧近邻关联：

- 同一 `user_id + token_hash_prefix`。
- `lucy_begin_question.created_at` 后 `LUCY_REPORTED_TURN_ATTACH_WINDOW_MS` 内的业务调用。
- 若期间出现新的 `lucy_begin_question`，后续调用归属新 turn。

默认 attach window：`10 分钟`。

**已知限制（并发归并风险）**：近邻关联假设同一 `user_id + token_hash_prefix` 在 attach window 内是串行提问。若同一 token 被并发或交织调用（多线程 agent、多个并行会话共用一个 token），窗口期内后到的业务调用可能被错误归并到前一个 `lucy_begin_question`，产生错误的问题归属。v0.1 不处理此场景；是否需要更细的并发隔离（如要求上报方携带自生成的临时关联 id）留作 Phase 3 后续评估项，见 §15 开放问题。

### 8.3 开关

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `LUCY_ENABLE_QUESTION_TOOL` | `true` | 是否注入 `lucy_begin_question` |
| `LUCY_STORE_QUESTION_PREVIEW` | `true` | 是否保存脱敏问题摘要 |
| `LUCY_QUESTION_PREVIEW_MAX_CHARS` | `500` | 保存预览长度 |

即使关闭 `LUCY_ENABLE_QUESTION_TOOL`，Source Normalization 和 Inferred Turns 仍必须工作。

## 9. API 与 UI

### 9.1 Admin API

新增或扩展：

```text
GET /api/admin/audit/turns
  ?user=workhorse
  &since=2026-06-22T08:23:34.000Z
  &until=2026-06-22T09:23:34.999Z
  &source=inferred|reported|all

GET /api/admin/audit/turns/:turnId

GET /api/admin/audit/:id/sources
```

`GET /api/admin/audit/turns` 返回：

```json
{
  "ok": true,
  "data": {
    "total": 2,
    "entries": [
      {
        "id": "inf_20260622_090437_workhorse_01",
        "source": "inferred",
        "userId": "workhorse",
        "startedAt": "2026-06-22T09:04:37.568Z",
        "endedAt": "2026-06-22T09:06:28.666Z",
        "businessCallCount": 10,
        "questionSummary": "推断：查询 2026 年 KX 利润表/营业收入相关数据",
        "confidence": "medium",
        "tools": ["sl_read_source", "sl_query"],
        "sources": [
          {
            "connectionId": "mysql-aliyun",
            "schema": "dataforai",
            "sourceName": "kx_fact_financial_amount",
            "physicalTable": "dataforai.kx_fact_financial_amount"
          }
        ]
      }
    ]
  }
}
```

### 9.2 Audit UI

`/admin/audit` 增加视图切换：

- `调用明细`：现有 access log 表。
- `问题簇`：按 inferred/reported turn 展示。
- `数据源`：聚合 source/table 触达统计。

问题簇详情展示：

- 问题摘要：标注 `reported` 或 `inferred`。
- 置信度和证据。
- 业务调用列表。
- 数据源列表。
- denied/error 摘要。

UI 文案必须避免把 inferred summary 表述为用户原话。推荐：

```text
推断问题摘要
基于工具调用参数自动生成，不等同于用户原文。
```

## 10. 隐私、安全与保留策略

- 自然语言问题为可选审计信息，默认只保存脱敏预览和摘要，不保存完整原文。
- 脱敏规则至少覆盖 token、password、secret、authorization、手机号、邮箱、身份证样式字符串。
- `question_preview` 和 `args_summary` 一样，导出 CSV 时必须做公式注入防护。
- 删除 / retention：
  - `conversation_turns.question_preview` 默认保留 30 天，可配置。
  - `inferred_turns` 可长期保留，因为其来源是审计摘要而非用户原文。
- `lucy_begin_question` 不参与 ACL 放权，不得让 agent 通过该工具改变权限或绕过 deny。

## 11. 迁移与回填

### 11.1 启动迁移

`getAuditDb()` / `getDb()` 初始化时创建新表和索引。迁移必须幂等。

### 11.2 历史回填

提供一次性脚本或 admin endpoint：

```text
POST /api/admin/audit/rebuild-derived
```

能力：

1. 从既有 `access_log` 回填 `access_log_sources`。
2. 基于历史调用生成 `inferred_turns`。
3. 支持 `dryRun=true` 返回将新增的行数和样例，不落盘。

初版也可先提供 CLI/script，不暴露 UI。

## 12. 测试计划

| 层级 | 用例 |
|---|---|
| unit | `sl_read_source` sourceName -> source record |
| unit | `sl_query` measures/dimensions/filters -> 多 source record |
| unit | 物理表 `dataforai.kx_*` -> reverse source map |
| unit | protocol calls 不进入 inferred turn |
| unit | 两段业务调用间隔超过阈值 -> 两个 inferred turns |
| unit | 孤立 `kx_catalog` 默认不计为正式问题 |
| integration | `lucy_begin_question` 出现在 `tools/list` 且本地处理，不转发 KTX |
| integration | `lucy_begin_question` 后业务调用可近邻关联 |
| integration | Audit API 返回 turns + sources |
| security | question preview 脱敏、限长、CSV formula escaping |

## 13. 分阶段交付

### Phase 1：数据源正规化

- 新增 `access_log_sources`。
- 在 `acl.ts` 新增导出：结构化 source 解析函数（`{connectionId, schema, sourceName, table}`），不收敛成字符串数组（对应 §6.1 前置任务）。
- 在 `audit.ts` 改 `writeLog()` 返回插入行 id，或新增 `writeLogWithSources()` 合并写入函数（对应 §5 设计决策，二选一，本阶段定稿）。
- 在 `mcp-proxy.ts` 实现 §6.2 五级提取优先级级联——这是新代码，不是"接入"现成逻辑。
- 显式处理 `kx_catalog` 本地短路路径（不进入常规 `extractTables`/`tools/call` 转发流程，需要单独的 source 记录分支，对应 §6.2 第 5 条）。
- Admin API 支持按 log 查看 sources。
- 回填最近 7 天历史日志。

### Phase 2：问题簇推断

- 新增 `inferred_turns` / `inferred_turn_access_logs`。
- 实现增量推断 worker 或查询时 lazy build。
- Audit UI 增加「问题簇」视图。

### Phase 3：可选自然语言问题上报

- 注入 `lucy_begin_question`。
- 新增 `conversation_turns`。
- 实现近邻关联和 UI 标注。
- 增加隐私开关和 retention 清理。

## 14. 验收样例：workhorse 最近一小时

对于 2026-06-22 `workhorse` 最近一小时审计：

- 总 MCP 记录：`92`
- 业务调用：`21`
- 协议调用：`71`
- 数据源应正规化为：
  - `mysql-aliyun / dataforai / kx_fact_financial_amount`
  - `mysql-aliyun / dataforai / kx_dim_financial_item`
  - `mysql-aliyun / dataforai / kx_dim_company`
  - `mysql-aliyun / dataforai / kx_vw_income_statement_detail`
  - `mysql-aliyun / dataforai / kx_vw_balance_sheet_detail`
- 问题簇主指标应显示：
  - `2` 个实质数据问题簇（利润表/收入；资产负债表）
  - `kx_catalog` 预检并入后续业务簇或标注为低置信度 preflight，不单独误报为正式问题

## 15. 开放问题

1. `lucy_begin_question` 近邻关联在同 token 并发/交织调用下可能错误归并问题（见 §8.2 已知限制）；是否需要要求上报方携带临时关联 id 来隔离并发会话？
2. `lucy_begin_question` 是否默认注入给所有 agent，还是仅注入含 `kx_catalog` / 数据工具权限的 agent？
3. `inferred_turn` 阈值默认 120 秒是否适合所有客户端？是否需要 per-agent 配置？
4. 自然语言 preview retention 默认 30 天是否过长？本地单用户环境与客户部署环境是否应不同默认值？
5. 是否需要把 `access_log_sources` 纳入 CSV 导出，或只在 UI/API 中展开？

