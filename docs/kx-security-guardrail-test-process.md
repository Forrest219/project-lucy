# KX Security Guardrail Test Process

| 元数据 | 内容 |
|---|---|
| 文档名称 | KX Security Guardrail Test Process |
| 文档类型 | Test Report / Review Handoff |
| 版本 | v0.1 |
| 撰写日期 | 2026-06-20 |
| 撰写人 | Codex |
| 委托人 | project-lucy 团队 |
| 基于材料 | docs/DEVELOPMENT.md, webui/docs/07-mcp-auth-proxy-spec.md, docs/uat-agent-permissions.md, webui/server/proxy/acl.ts, semantic-layer/mysql-aliyun/_schema/dataforai.yaml, ktx.yaml |
| 适用范围 | KX 财务新业务域的 Agent 表级 ACL 安全围栏测试 |
| 输出位置 | docs/kx-security-guardrail-test-process.md |

## 1. 本次任务边界

目标是为 2026-06-20 新增的 KX 财务域补安全围栏测试，不扩展业务查询能力，不修改 KTX 上游，不读取 `.ktx/secrets/`。

KX 域当前包含 6 个允许表：

- `dataforai.kx_dim_company`
- `dataforai.kx_dim_financial_item`
- `dataforai.kx_fact_financial_amount`
- `dataforai.kx_vw_balance_sheet_detail`
- `dataforai.kx_vw_cash_flow_statement_detail`
- `dataforai.kx_vw_income_statement_detail`

## 2. 已落盘改动

- `webui/config/access.yaml`
  - 新增 `kx_guard_tester`。
  - `tokens: []`，不产生可用明文 token。
  - `allow.tables` 仅包含上述 6 张 KX 表。
  - `allow.tools` 仅包含 `sl_query`, `sl_read_source`, `entity_details`。
- `webui/server/__tests__/kx-acl.test.ts`
  - 使用临时项目目录和临时 `access.yaml` / `semantic-layer` schema。
  - 验证 KX source 能映射到物理表。
  - 验证 KX 测试 agent 可以访问 6 张 KX 表。
  - 验证 KX 测试 agent 不能访问 `superstore_orders`。
  - 验证未授权的非 KX agent 不能访问 KX 表。
  - 验证 `sql_execution` 仍被全局 deny。

## 3. 当前测试覆盖

可执行测试覆盖的是 ACL 的基础强制边界：

- `sl_read_source.sourceName` 读取 KX / 非 KX source。
- `sl_query.measures[]` 聚合表达式中的 source。
- `sl_query.dimensions[].field` 中的 source。
- `entity_details.entities[].table` 直接表名。
- `defaults.deny_tools` 对 `sql_execution` 的优先拦截。

本轮测试刻意不依赖真实数据库，不调用生产 RDS，不生成或保存任何 token 明文。

## 4. 待 Claude Code 安全审阅问题

请 Claude Code 以安全测试审阅姿态检查本次改动，重点找“测试没有覆盖但可能越权”的漏洞，而不是重写实现。

审阅重点：

1. KX agent 仅允许 6 张 `dataforai.kx_*` 表的测试是否有遗漏。
2. 非 KX agent 越权访问 KX 表的反向测试是否覆盖了 `sl_read_source`、`sl_query`、`entity_details` 的关键路径。
3. `acl.extractTables()` 只解析 `measures[]`、`dimensions[].field`、`sourceName`、`entities[].table`，是否漏掉 `query`、`filters`、`where`、`segments`、join 参数、排序字段或复杂表达式。
4. `tables: ["*"]` 的 agent 仍会访问 KX 表；这属于显式授权还是需要额外域隔离策略。
5. 当前 ACL 只检查请求参数，未校验上游 KTX 最终生成 SQL 的实际表集合，是否可能发生 join 侧漏。
6. source name 与 physical table 混用、大小写、空白、函数嵌套、JSON 转义是否可能绕过当前解析。

建议审阅命令：

```bash
claude -p "请以代码审阅姿态审阅 KX ACL 安全围栏测试改动，重点找测试覆盖漏洞和越权风险。请阅读 webui/server/proxy/acl.ts、webui/server/__tests__/kx-acl.test.ts、webui/config/access.yaml、docs/kx-security-guardrail-test-process.md、docs/uat-agent-permissions.md。只输出 findings，按严重程度排序，包含文件和行号。"
```

## 5. 本地验证记录

已执行：

```bash
cd webui
npm test -- --run webui/server/__tests__/kx-acl.test.ts
```

结果：

```text
Test Files  1 passed (1)
Tests  5 passed (5)
```

补充记录：第一次从 `webui/` 下用 `webui/server/__tests__/kx-acl.test.ts` 作为 filter 运行，Vitest 未匹配到文件；随后改为 `server/__tests__/kx-acl.test.ts` 后通过。

## 6. Claude Code 审阅结果

审阅命令：

```bash
claude -p "请以代码审阅姿态审阅 KX ACL 安全围栏测试改动，重点找测试覆盖漏洞和越权风险。请阅读 webui/server/proxy/acl.ts、webui/server/__tests__/kx-acl.test.ts、webui/config/access.yaml、docs/kx-security-guardrail-test-process.md、docs/uat-agent-permissions.md。只输出 findings，按严重程度排序，包含文件和行号。" --permission-mode dontAsk --allowedTools "Read,Grep,Glob"
```

Claude Code findings 摘要如下。

### P0

1. `webui/server/proxy/acl.ts:80-93` 的 `extractTables()` 对 `sl_query` 只解析 `measures[]` 与 `dimensions[].field`，不解析 `query`、`filters`、`where`、`segments`、join、`orderBy`、`sort`、`having`。这些参数中的表名可能绕过表级 ACL，直接透传到上游 KTX。
2. `webui/server/__tests__/kx-acl.test.ts` 当前没有覆盖 `sl_query.arguments.query`、`filters`、`where`、`segments` 等路径，因此上述风险不会被 CI 暴露。
3. `webui/config/access.yaml` 中已有 `tables: ["*"]` / `tools: ["*"]` agent；`acl.ts` 遇到 `*` 会跳过表检查。若 KX 财务域需要比普通启用表更强隔离，需要额外域隔离策略。
4. `webui/server/proxy/acl.ts` 的 `check()` 未检查 `user.enabled === false`，禁用 agent 仍可能通过 ACL。

### P1

1. 聚合表达式只剥一层函数，嵌套函数目前靠精确 allowlist fail-closed，不是清晰设计。
2. 大小写、空白、JSON 转义和函数嵌套混淆未测试。
3. `entity_details` 直接使用 `entities[].table`，不走 source map 规范化；多实体、空实体、缺 table 等边界未覆盖。
4. `tableTouchingTools` 是硬编码集合，其他可能返回 schema 或表信息的工具不会做表检查。
5. 测试 fixture 没有覆盖 `tables: ["*"]` agent 对 KX 表的预期行为。

### P2

1. 测试 fixture 的 agent id 与生产配置中的 `kx_guard_tester` 不一致，可能降低配置回归的直接性。
2. `tokens: []` 的不可认证路径和 `enabled: false` 分支未测。
3. `mcp-proxy.ts` 的 audit 摘要过滤 `sql` / `query`，但 ACL 又不解析这些字段，若发生 `query` 注入，审计也缺少关键线索。
4. `sourceMap` 是模块级 60 秒缓存，测试依赖 `vi.resetModules()` 隔离。
5. fixture schema 缺 `superstore_returns` 与 `superstore_people`，无法测试 join 侧漏。

Claude Code 建议的修复优先级：

1. 立即修：解析或拒绝 `query` / `filters` / `where` 等字段，补对应测试；`enabled: false` 必须拒绝。
2. 本周修：明确 `tables: ["*"]` 是否允许访问 KX 财务域；若不允许，增加域级保护和通配 agent 测试。
3. 下一轮加固：补大小写/空白/嵌套函数、多实体、非表工具、source map 缓存和 join 侧漏测试。

## 7. 根据审阅完成的修复

已修复：

1. `webui/server/proxy/acl.ts`
   - `sl_query.query` / `sl_query.sql` 直接返回 `raw_query_forbidden`，避免 raw SQL 借 `sl_query` 绕开 `sql_execution` 的全局 deny。
   - `extractTables()` 现在会从 `filters`、`where`、`segments`、`joins`、`join`、`orderBy`、`order_by`、`sort`、`sorts`、`having`、`groupBy`、`group_by` 中递归识别已知 source name / physical table。
   - source name / physical table 做 `trim`、去引号、lowercase 规范化。
   - 未限定普通 filter 字段和值不作为表名处理，避免把 `amount_type = end_balance` 误判成表。
   - `user.enabled === false` 返回 `agent_disabled`。
2. `webui/server/proxy/identity.ts`
   - `UserConfig` 类型补 `enabled?: boolean`，与 `access.yaml` 配置语义一致。
3. `webui/server/__tests__/kx-acl.test.ts`
   - 测试 agent id 改为生产配置同名的 `kx_guard_tester`。
   - 新增 raw `query` / `sql` 拒绝测试。
   - 新增 `filters` / `where` / `joins` 引用未授权表测试。
   - 新增未限定 filter 字段和值不误杀测试。
   - 新增 `enabled: false` agent 拒绝测试。
   - fixture schema 补 `superstore_returns` / `superstore_people`，便于 join 侧漏测试。

暂未修改的策略项：

- `tables: ["*"]` 是否允许访问 KX 财务域仍是产品/安全策略选择。当前代码保持既有语义：`*` 表示可访问所有未被全局 deny 的 enabled tables。若 KX 要做高敏域隔离，需要新增域级 policy，而不是只靠当前表白名单。
- 审计摘要仍会过滤完整 `query` / `sql` 字段；由于 ACL 已在代理层直接拒绝 raw query/sql，该问题的泄露风险下降，但如后续要审计攻击 payload，可增加 hash 或截断摘要。

修复后验证：

```bash
cd webui
npm test -- --run server/__tests__/kx-acl.test.ts
npm test -- --run server/__tests__/*.test.ts
npm run build
```

结果：

```text
server/__tests__/kx-acl.test.ts: 9 tests passed
server tests: 16 files passed, 80 tests passed
npm run build: success
```

## 8. Claude Code 复审与二次加固

复审命令：

```bash
claude -p "请复审 KX ACL 安全围栏修复后的状态。请阅读 webui/server/proxy/acl.ts、webui/server/proxy/identity.ts、webui/server/__tests__/kx-acl.test.ts、webui/config/access.yaml、docs/kx-security-guardrail-test-process.md。重点判断先前 P0：raw query/sql 绕过、filters/where/join 引表、enabled=false 是否已被测试和实现覆盖。只输出仍存在的 findings，按严重程度排序；如果没有 P0/P1 阻断，请明确说明剩余风险。" --permission-mode dontAsk --allowedTools "Read,Grep,Glob"
```

复审结论：

- 原 P0 已闭合：
  - raw `query` / `sql` 绕过已被 `raw_query_forbidden` 阻断并有测试。
  - `filters` / `where` / `joins` 引表已被递归提取并有测试。
  - `enabled: false` 已被 `agent_disabled` 阻断并有测试。
- 仍存在 P1/P2 建议：
  - `tableTouchingTools` 仍是硬编码集合，未来新增表访问工具需同步纳入或改成 fail-closed 工具策略。
  - `tables` / `tools` 字段缺失应 fail-closed。
  - `entity_details` 应走 source map 与规范化。
  - `enabled: false` 的拒绝优先级应高于全局 deny。
  - `tables: ["*"]` 访问 KX 仍是产品策略项。

二次加固已完成：

1. `enabled: false` 检查前移到全局 deny 之前；禁用账号始终返回 `agent_disabled`。
2. `allow.tools` 缺失按空列表处理，默认拒绝工具。
3. `allow.tables` 缺失按空列表处理，默认拒绝表。
4. `entity_details.entities[].table` 改为通过 source map / 规范化后再做 allowlist 校验。
5. 新增测试：
   - 禁用 agent 调用 `sql_execution` 也返回 `agent_disabled`。
   - `tables` 缺失时访问 KX 表返回 `table_forbidden`。
   - `tools` 缺失时返回 `tool_forbidden`。
   - `entity_details` 对大小写、反引号、source name / physical table 做规范化。

二次加固后验证：

```bash
cd webui
npm test -- --run server/__tests__/kx-acl.test.ts
npm test -- --run server/__tests__/*.test.ts
npm run build
git diff --check
```

结果：

```text
server/__tests__/kx-acl.test.ts: 11 tests passed
server tests: 16 files passed, 82 tests passed
npm run build: success
git diff --check: success
```

剩余风险：

- `tables: ["*"]` 对 KX 财务域是否允许仍未改动；如果 KX 是高敏域，需要新增域级 policy。
- `tableTouchingTools` 仍需随着 KTX 工具演进维护；如果未来新增可返回表数据/表结构的工具，必须补 ACL 和测试。
- 配置缓存仍有 TTL，紧急禁用用户或改表权限不是零延迟生效。

## 9. 用户确认后的策略落地

2026-06-20 用户确认采用以下策略：

1. KX 财务域不被 `tables: ["*"]` 自动覆盖，必须显式列出具体 KX 表。
2. `tools: ["*"]` 只覆盖已知工具；未知工具默认 fail-closed。
3. 禁用 agent / 修改表权限需要尽量实时生效，不等待 30 秒配置缓存。

已落地：

- `webui/server/proxy/acl.ts`
  - 新增 KX 高敏表规则：`dataforai.kx_*` 表必须在 `allow.tables` 中显式出现；`tables: ["*"]` 不足以访问 KX。
  - 新增已知工具集合；`tools: ["*"]` 遇到未知工具返回 `tool_forbidden`。
  - ACL 检查读取 `access.yaml` 时使用 fresh config，避免禁用 agent / 改表权限等待缓存 TTL。
- `webui/server/proxy/identity.ts`
  - `getAccessConfig({ fresh: true })` 支持绕过配置缓存。
- `webui/server/__tests__/kx-acl.test.ts`
  - 增加 `wildcard_agent`：验证 `tables: ["*"]` 可访问普通表，但不能访问 KX 表。
  - 增加 `wildcard_with_explicit_kx_agent`：验证 `tables: ["*", "dataforai.kx_fact_financial_amount"]` 可访问显式授权 KX 表。
  - 增加未知工具测试：`tools: ["*"]` 调用 `future_table_export` 返回 `tool_forbidden`。
  - 增加配置实时刷新测试：同一模块实例中写入 `enabled: false` 后，下一次 ACL check 立即返回 `agent_disabled`。

策略落地后验证：

```bash
cd webui
npm test -- --run server/__tests__/kx-acl.test.ts
npm test -- --run server/__tests__/*.test.ts
npm run build
git diff --check
```

结果：

```text
server/__tests__/kx-acl.test.ts: 14 tests passed
server tests: 16 files passed, 85 tests passed
npm run build: success
git diff --check: success
```

仍需后续维护：

- 若 KTX 新增可访问表数据或表结构的工具，必须加入已知工具分类，并决定是否纳入表级 ACL。
- `dictionary_search` / `discover_data` 当前仍按已知工具处理，未做表级细分；若它们会返回 KX 表结构或字段摘要，需要进一步纳入表级 ACL 或对 KX 做结果过滤。

## 10. 安全验证 TODO 完成记录

针对 5 个剩余安全验证 TODO，已完成如下：

1. `dictionary_search` / `discover_data` 是否泄露 KX 表结构
   - 已按高敏 metadata 工具处理。
   - `dictionary_search` / `discover_data` 只有在 agent 显式授权全部 KX 表时才允许调用；`tables: ["*"]` 不足以放行。
   - 测试覆盖：`protects KX metadata from broad catalog tools`。
2. 真实 MCP Proxy E2E 验证
   - 新增 `webui/server/__tests__/mcp-proxy-acl.test.ts`。
   - 使用真实 HTTP POST 调用 proxy `/mcp` 的 `tools/call`，验证未授权 KX 请求在代理层被拒绝并写入 denied audit。
   - 测试不启动真实 KTX upstream；如果 proxy 错误透传，该用例会失败。
3. audit 对拒绝的 raw query 记录是否足够
   - raw `query` / `sql` 在 `sl_query` 入口被 `raw_query_forbidden` 阻断。
   - 当前不记录完整 raw query payload，避免把敏感 SQL 落入审计日志；proxy denied audit 记录 `errorDetail` / `requestId` / tool / user。
   - 若后续需要攻击溯源，可增加 query hash 或截断摘要，而不是保存全文。
4. `sl_validate` / 语义层元数据工具分类
   - `sl_validate` 已纳入表级 ACL。
   - 带 `sourceName` / `source` / `table` 时按具体表检查；未带 source 时视为广域 metadata 风险，要求显式授权全部 KX 表。
   - 测试覆盖：`classifies sl_validate as table-scoped only when a source is provided`。
5. Claude Code 终审
   - 待执行最终复审，复审输出追加到下一节。

最新验证：

```bash
cd webui
npm test -- --run server/__tests__/kx-acl.test.ts server/__tests__/mcp-proxy-acl.test.ts
npm test -- --run server/__tests__/*.test.ts
npm run build
git diff --check
```

结果：

```text
kx-acl + mcp-proxy-acl: 2 files passed, 17 tests passed
server tests: 17 files passed, 88 tests passed
npm run build: success
git diff --check: success
```

## 11. Claude Code 终审结果

终审命令：

```bash
claude -p "请对 KX ACL 安全围栏的最终状态做安全终审。请阅读 webui/server/proxy/acl.ts、webui/server/proxy/identity.ts、webui/server/proxy/mcp-proxy.ts、webui/server/__tests__/kx-acl.test.ts、webui/server/__tests__/mcp-proxy-acl.test.ts、webui/config/access.yaml、docs/kx-security-guardrail-test-process.md。重点判断：KX 显式授权策略、metadata 工具保护、真实 proxy denied/audit E2E、raw query/sql 拦截、enabled=false 即时生效、未知工具 fail-closed 是否还有 P0/P1 漏洞。只输出 findings；如果没有 P0/P1，请明确说明并列出剩余 P2。" --permission-mode dontAsk --allowedTools "Read,Grep,Glob"
```

终审结论：

- 未发现 P0 / P1 阻断级漏洞。
- 6 个核心场景均已闭合：
  - KX 显式授权策略：`tables: ["*"]` 不覆盖 `dataforai.kx_*`。
  - Metadata 工具保护：`dictionary_search` / `discover_data` 需显式授权全部 KX 表。
  - 真实 proxy denied/audit E2E：已有 `mcp-proxy-acl.test.ts` 覆盖一条未授权 KX 请求。
  - raw `query` / `sql` 拦截：`raw_query_forbidden`。
  - `enabled: false` 即时生效：ACL 使用 fresh config。
  - 未知工具 fail-closed：`tools: ["*"]` 不覆盖未知工具。

Claude Code 列出的剩余 P2：

1. E2E 仅覆盖一条 denied 路径；可继续补 raw query、metadata denied、unknown tool、token revoked 等代理层 E2E。
2. audit 写失败当前被静默吞掉，可加 stderr / 计数器告警。
3. `sessionClients` map 无清理机制。
4. `sourceMap` 仍有 60 秒 TTL；新增 KX 表后敏感识别可能延迟。
5. `argsSummary` 可扩展敏感键过滤，如 password/token/secret/apiKey。
6. proxy 默认监听所有接口，可考虑默认绑定 `127.0.0.1`。
7. POST body size / upstream timeout 可加限制。
8. 敏感表前缀和 metadata 工具列表已配置化；新增高敏域仍需维护 `defaults.sensitive_table_prefixes`。
9. 新增 KTX 工具仍需维护工具分类；本轮已补未来工具分类测试。
10. `entity_details` 参数契约已补常见 source/table 形态；若 KTX zod schema 新增字段仍需同步。
11. token revoke E2E 可补。
12. `lisi` 高权限样例 token 已从 `access.yaml` 移除，Agent 已禁用。

整体判断：当前安全围栏已满足本次 KX 域上线前的核心验证；剩余项属于防御纵深、可观测性和未来扩展维护，不阻塞本轮交付。

## 12. P2 优先项继续加固

2026-06-20 用户确认继续完成优先级最高的 P2 项。已完成：

1. 补更多 Proxy E2E 分支
   - `webui/server/__tests__/mcp-proxy-acl.test.ts` 已扩展为 5 个测试。
   - 覆盖：未授权 KX 表、raw `query`、metadata 工具、`enabled:false`、全局 deny、未知工具、revoked token、oversized body、默认 localhost host。
2. audit 写失败告警
   - `mcp-proxy.ts` 新增 `recordAudit()`。
   - audit 写失败不影响授权响应，但会输出 stderr：`[lucy-proxy] failed to write audit log`。
3. Proxy 默认绑定 localhost
   - `buildProxy()` 返回 `host`，默认 `127.0.0.1`。
   - 需要外部暴露时必须显式设置 `LUCY_PROXY_HOST`。
4. POST body size / upstream timeout
   - `LUCY_PROXY_MAX_BODY_BYTES` 默认 1 MiB。
   - `LUCY_PROXY_UPSTREAM_TIMEOUT_MS` 默认 30 秒。
   - oversize 请求返回 HTTP 413。
5. token revoke E2E
   - proxy E2E 覆盖 revoked token 返回 HTTP 401，且不写 denied audit。

验证：

```bash
cd webui
npm test -- --run server/__tests__/mcp-proxy-acl.test.ts
npm test -- --run server/__tests__/*.test.ts
npm run build
git diff --check
```

结果：

```text
mcp-proxy-acl: 5 tests passed
server tests: 17 files passed, 92 tests passed
npm run build: success
git diff --check: success
```

仍剩余的后续 P2：

- source map TTL 仍为 60 秒；新增 KX 表后敏感识别可能延迟。
- `argsSummary` 可继续扩展敏感键过滤：password/token/secret/apiKey 等。
- 敏感表前缀与工具分类仍是代码常量，后续可配置化。
- `sessionClients` map 仍无 TTL/清理，且按 session id 而非 user/token 复合键。
- `entity_details` 参数契约可继续和 KTX zod schema 对齐。
- `errorDetail` 截断可追加 hash。
- 现有样例 token 可择机轮换。

## 13. P2 中优先级继续加固

已继续完成不需要产品策略确认的 P2 项：

1. source map fresh
   - ACL check 中的敏感表识别和表提取均使用 fresh source map。
   - 测试覆盖：同一模块实例先加载 source map，再向 schema 追加新的 `dataforai.kx_*` source，下一次 ACL check 立即按 KX 高敏表拒绝 wildcard agent。
2. `argsSummary` 敏感键过滤
   - proxy audit args summary 增加通用敏感键过滤：`sql/query/password/passwd/pwd/token/secret/apiKey/authorization/credential` 等。
   - 测试覆盖：proxy denied audit 中 `password` / `token` / `query` 被过滤，普通字段保留。
3. `errorDetail` 截断 hash
   - 长错误详情截断后追加 `<truncated sha256:...>` 标记，并保证落库长度不超过 500 字符。
   - 新增 `webui/server/__tests__/proxy-audit.test.ts`。
4. `sessionClients` 清理与隔离
   - session client 记录改为按 `sessionId:userId:tokenLabel` 复合键。
   - 增加 24 小时 TTL 清理，避免长期无界增长和跨用户 session id 污染。

验证：

```bash
cd webui
npm test -- --run server/__tests__/kx-acl.test.ts server/__tests__/mcp-proxy-acl.test.ts server/__tests__/proxy-audit.test.ts
npm test -- --run server/__tests__/*.test.ts
npm run build
git diff --check
```

结果：

```text
kx-acl + mcp-proxy-acl + proxy-audit: 3 files passed, 23 tests passed
server tests: 18 files passed, 94 tests passed
npm run build: success
git diff --check: success
```

最终剩余 TODO：

- 新增 KTX 工具时继续同步评估 `known_tools` / `table_touching_tools` / `sensitive_metadata_tools`。
- `entity_details` 若 KTX zod schema 新增字段，继续同步 ACL 提取契约。
- `zhangsan` 样例 token 后续择机轮换；高权限 `lisi` token 已移除并禁用。

## 14. 最终 Claude Code 复审

复审命令：

```bash
claude -p "请对 KX ACL 安全围栏最新状态做最终安全复审。请阅读 webui/server/proxy/acl.ts、identity.ts、mcp-proxy.ts、audit.ts、webui/server/__tests__/kx-acl.test.ts、mcp-proxy-acl.test.ts、proxy-audit.test.ts、docs/kx-security-guardrail-test-process.md。重点确认：P2 优先项已处理后是否引入 P0/P1；剩余 TODO 是否仅配置化/token 轮换/契约对齐。只输出 findings；如果无 P0/P1，请明确说明。" --permission-mode dontAsk --allowedTools "Read,Grep,Glob"
```

最终复审结论：

- P0 / P1：无。
- P2 优先项加固未引入新的阻断级漏洞。
- 已复核闭合项：
  - KX 显式授权。
  - metadata 工具保护。
  - proxy denied/audit E2E。
  - raw query/sql 拦截。
  - `enabled:false` 即时生效。
  - 未知工具 fail-closed。
  - session client 复合键 + TTL。
  - errorDetail 截断 hash。
  - argsSummary 敏感键过滤。
  - proxy 默认 localhost。
  - body size / upstream timeout。

最终剩余事项：

| ID | 类别 | 说明 |
|---|---|---|
| R1 | 配置化 | 已完成：`sensitive_table_prefixes` 进入 `access.yaml.defaults`，内置 KX 前缀仅作最低保护。 |
| R2 | 配置化 | 已完成：`known_tools` / `table_touching_tools` / `sensitive_metadata_tools` 进入 `access.yaml.defaults`，并补未来工具分类测试。 |
| R3 | 契约对齐 | 已补强：`entity_details` 覆盖 `sourceName`、`schema+name`、`type/kind+name/id`、`qualifiedName` 等常见 source/table 形态。 |
| R4 | Token 轮换 | 已完成高风险项：`lisi` 高权限样例 token 已移除，Agent 已禁用；`zhangsan` 可后续按客户端窗口轮换。 |
| R5 | 非阻塞观察 | 502 `detail: String(err)` 可能泄露本地错误细节，生产化可收敛错误详情。 |

终审判断：本轮交付范围内无 P0/P1 阻断级漏洞；剩余事项不阻塞 KX 域安全围栏交付。

## 15. 非阻断维护项收尾

2026-06-20 继续收尾 Claude Code 终审中列出的非阻断维护项。已完成：

1. 敏感表前缀与工具分类配置化
   - `webui/config/access.yaml` 的 `defaults` 新增：
     - `known_tools`
     - `table_touching_tools`
     - `sensitive_metadata_tools`
     - `sensitive_table_prefixes`
   - `acl.ts` 读取配置优先，代码默认值仅作为配置缺失时的兜底。
   - 默认高危 deny、KX 敏感前缀、触表工具分类、敏感 metadata 工具分类会与配置取并集；误删或置空 defaults 不会关闭内置最低保护。
   - 测试覆盖：在测试配置中追加 `dataforai.sec_` 前缀后，`tables: ["*"]` agent 访问 `dataforai.sec_private_table` 仍需显式授权。
   - 测试覆盖：将 `deny_tools`、`known_tools`、`table_touching_tools`、`sensitive_metadata_tools`、`sensitive_table_prefixes` 全部置空后，`sql_execution` 仍被全局拒绝，KX 表仍需显式授权，未知工具仍 fail-closed。
2. `entity_details` 参数契约补强
   - 原覆盖：`entities[].table`。
   - 新增覆盖：顶层 `sourceName`、`entities[].sourceName`、`entities[].source`、`entities[].source_name`、`tableName` / `table_name`、`schema + name` / `schemaName + entityName` 等常见形态。
   - 表名仍统一经过 source map 与规范化后再执行 allowlist。
3. 502 错误详情收敛
   - proxy 普通上游异常不再向调用方返回 `String(err)`。
   - 502 响应固定为 `{ error: "Proxy error", detail: "Upstream unavailable" }`。
   - 413 oversized body 仍保留可行动的 `Request body too large`。
4. token 轮换流程落盘
   - 高权限 `lisi` 样例 token 已移除，Agent 已禁用。
   - `zhangsan` 仍建议后续按客户端窗口轮换。

建议的 token 轮换流程：

1. 在 WebUI 或 admin API 为目标 agent 新增 token，记录一次性明文 token。
2. 将对应 MCP 客户端切换到新 token。
3. 用新 token 执行一条允许路径和一条拒绝路径，确认 audit 正常。
4. 删除旧 token，使旧 token hash 进入 revoke 路径。
5. 使用旧 token 发起请求，确认 HTTP 401 且不写 denied audit。
6. 检查 audit 最近记录，确认没有继续使用旧 token 的客户端。

验证：

```bash
cd webui
npm test -- --run server/__tests__/kx-acl.test.ts server/__tests__/mcp-proxy-acl.test.ts server/__tests__/proxy-audit.test.ts
npm test -- --run server/__tests__/*.test.ts
npm run build
```

结果：

```text
kx-acl + mcp-proxy-acl + proxy-audit: 3 files passed, 28 tests passed
server tests: 19 files passed, 100 tests passed
npm run build: success
git diff --check: success
```

Claude Code 复审尝试：

```bash
claude -p "请对 KX ACL 安全围栏非阻断维护收尾做安全复审..." --permission-mode dontAsk --allowedTools "Read,Grep,Glob"
claude -p "只读复审 KX ACL 收尾..." --permission-mode dontAsk --allowedTools "Read,Grep,Glob"
```

结果：两次命令均超过 90 秒无输出，手动中断后仅返回 `Execution error`，本轮未取得新的 Claude Code findings。未基于无输出命令伪造复审结论。

本轮后剩余非阻断维护口径：

- `zhangsan` token 轮换仍需由持有客户端配置的人执行；不能在代码变更中静默完成。
- 后续新增 KTX 工具时，必须同步评估并更新 `defaults.known_tools`、`defaults.table_touching_tools`、`defaults.sensitive_metadata_tools`。
- 若未来新增其他高敏业务域，优先通过 `defaults.sensitive_table_prefixes` 配置，不再改 ACL 代码常量。

## 16. 重启 Claude Code 后复审与 P1 修复

2026-06-20 按用户要求重启 Claude Code 进行验证：

1. 发现一个残留 Claude Code CLI 进程，终止后重新执行 `claude -p "请只回答 ok"`，确认 CLI 可正常返回。
2. 工具读取版复审仍多次长时间无输出；改为将关键代码片段直接传给 Claude Code。
3. Claude Code 返回 1 个 P1：`entity_details` 对字符串数组、嵌套对象、空 `entities` 的表提取与回退不完整，可能导致 KX 表访问检查空转。

已修复：

- `entity_details` 表提取改为受控递归，支持：
  - `entities: "kx_fact_financial_amount"`
  - `entities: ["kx_fact_financial_amount"]`
  - `entities: [{ entity: { table: "kx_fact_financial_amount" } }]`
  - `schema + name`、`sourceName`、`source`、`tableName` 等既有形态
- `entity_details` 在无法提取具体表时，和 `sl_validate` 一样回退到 `sensitive_metadata_forbidden:kx`，除非 agent 已显式拥有全部 KX 敏感表。
- `extractTables()` 对非对象 / 数组参数早返回，避免 primitive args 进入对象路径。
- 递归深度抽为 `MAX_ENTITY_REF_DEPTH`。

补充测试：

- `entities` 单个字符串应解析为 KX 表并拒绝非 KX agent。
- `entities` 字符串数组应解析为 KX 表并拒绝非 KX agent。
- 嵌套对象中的 `table` 应被递归提取。
- 空 `entities` 与 primitive args 应触发 `sensitive_metadata_forbidden:kx`。

Claude Code 修复后复审结论：

- 原 P1.1 字符串数组：CLOSED。
- 原 P1.2 嵌套对象：CLOSED。
- 原 P1.3 空 `entities` 无回退：CLOSED。
- 无新增 P0 / P1。
- 剩余为 P2/P3：字段别名收敛、source map 未收录 source 的更严格处理、递归深度裁剪可观测性、更多 falsy primitive 测试等。

验证：

```bash
cd webui
npm test -- --run server/__tests__/kx-acl.test.ts
npm test -- --run server/__tests__/kx-acl.test.ts server/__tests__/mcp-proxy-acl.test.ts server/__tests__/proxy-audit.test.ts
npm test -- --run server/__tests__/*.test.ts
npm run build
```

结果：

```text
kx-acl: 1 file passed, 21 tests passed
kx-acl + mcp-proxy-acl + proxy-audit: 3 files passed, 28 tests passed
server tests: 19 files passed, 100 tests passed
npm run build: success
```
