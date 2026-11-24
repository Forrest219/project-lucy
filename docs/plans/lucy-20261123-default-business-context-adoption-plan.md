# 数据问答默认采用业务上下文实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / v1.1 |
| 日期 / 功能编号 | 2026-11-23 / P1-77／REQ-030-098 |
| 状态 | S3｜实现进行中（B1 同源 C1–C4/C6 已入完整／基础指引；B2 判定器 27/27）。双宿主 live／PERF／MIX 缺证，按合同默认行为仍维持候选 A；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| 授权边界 | 本轮授权覆盖 Spec、UAT 设计和任务批次落盘。运行代码、正式测程开发及候选 UAT 执行以对应开发授权为准。 |
| 验收 | [Spec](../specs/lucy-20261123-default-business-context-adoption-spec.md) SC-01–SC-08，挂 [UAT-SUITE-CONTEXT-CONTENT](../qa/uat/suites/context-content/suite.md) 默认使用业务上下文组。 |

## 目标

在 P1-75 候选已通过名册及 MCP 可用性验收后，默认引导宿主仅在缺必要口径或规程时读取授权上下文，保持普通问询速度。

## 开工前置

- [P1-75 并行任务批次 A](lucy-20261123-interactive-read-resilience-plan.md#并行任务批次) 全部通过。封存单独候选 A 的构建、镜像、G1／G2 原始回执和夹具哈希。收到 P1-77 的开发授权后，从 A 为 B1 和 B2 分配独立工作区。
- 冻结两种宿主及模型、原生 MCP 接入、身份、端口和隔离 Docker 夹具。每题的正文标记、独立 SQL 核对值、工具 ACL 及四类缺失控制条件按 [UAT 夹具](../qa/uat/suites/context-content/fixtures.md#默认使用业务上下文夹具) 和用例核对。用 A 收集显式正确路径样本，封存逐题时限后执行 B 正式测试。
- 共用构建、测试账号、夹具及脱敏证据字段。各 Agent 独立写自己的实现与自动化测试，协调 Agent 负责合流、正式性能窗和测试台登记。局部回归使用独立端口和卷，正式性能窗与浏览器占用串行。

## 并行任务与合流

### B1 双指引与真实注入

- **写入范围** · `webui/config/data-qa-instructions.md`、`webui/server/proxy/mcp-proxy.ts` 的 A2 指引装配段、`webui/server/__tests__/mcp-proxy-instructions.test.ts` 和 `webui/server/__tests__/mcp-proxy-data-qa-instructions.test.ts`。
- **执行** · 在 A 的同源核心规则中增加 C1–C4／C6，覆盖已治理直通、依赖缺失才补查、同题同依赖一次查找一次读取、失败时部分交付。保留授权工具发现、问询上报、预算逃生和角色化目录。归因用同一构建的隔离测试入口或 A/B 两个冻结构建。
- **测试** · `npm --prefix webui test -- server/__tests__/mcp-proxy-instructions.test.ts server/__tests__/mcp-proxy-data-qa-instructions.test.ts server/__tests__/mcp-proxy-ux-resilience.test.ts server/__tests__/mcp-proxy-skills.test.ts`。逐一匹配真实 initialize 的动态、全空、动态截止、容量满、构建失败及本地协议回退响应。断言同源片段、无本条新增握手内检索／正文读、合法路径继续成交和隐藏工具不泄露。交付注入快照及测试结果，供 B2 关联。

### B2 宿主质量、性能测程与判定

- **写入范围** · `scripts/uat/context-default-adoption.mjs` 与 `scripts/uat/context-default-adoption.test.mjs`（计划新增）。复用 A3 的逐次回执和既有 [夹具入口](../../scripts/uat/seed-context-content.mjs)。现行 [真读真用与 ACL 判定器](../../scripts/uat/judge-context-content.mjs) 继续服务原用例。
- **执行** · 先以 A 编写采集和判定，分开封存普通题路径与正确显式题时限。通过 MCP 请求、对应响应与宿主答复关联查找、正文、SQL、首条正确结果与最终答复。B1 提供候选后，再跑两种宿主的自然／显式／缺依赖控制，以及真实 Proxy 上的 MIX 并发。
- **测试** · `node --test scripts/uat/context-default-adoption.test.mjs`。判定器应拒绝只有检索全文、缺正文读回执、工具重复、错误值、规则违背、首超时后重试成功、性能超线及缺失的混合负载交叠。用正常回执验证通过分支，用缺证回执验证 `BLOCKED`。真实宿主执行 `UAT-CTX-DEFAULT-R0／01–06／PERF`，另按 MIX 产出 A/B 逐窗证据。

### 合流验收

1. 协调 Agent 确认两个任务的文件归属、基线及测试结果，合成候选 B。归因时仅切换规则，按宿主分别保存完整和基础指引的实际响应及正文／查询关联。
2. 依 [PERF](../qa/uat/suites/context-content/cases.md#uat-ctx-default-perf) 复算普通题、已治理题及依赖题耗时。依 [MIX](../qa/uat/suites/context-content/cases.md#uat-ctx-default-mix) 使用真实前台浏览器、50 路基础负载与追加上下文会话，验收相同门槛。
3. 任一必做失败或缺证，维持候选 A 的默认行为，由归属任务修复并在新的候选复验。候选 B 只在 SC-01–SC-08 均通过后进入默认路径。

## 验收与完成定义

- 归档每批提交或补丁、测试命令、退出码、样本分母、首尝试结果、镜像和测程哈希。原始超时和重跑分开记录。
- 执行 `npm run lint:spec-docs`、`npm run lint:spec`、`npm run lint:terminology`、`npm run lint:ia-boundary` 和 `node scripts/uat/check-e2e-ledger.mjs`。若全仓检查已有失败，按冻结基线核对并记录差集。由协调 Agent 按实际跑次登记 [INDEX](../qa/uat/INDEX.md#默认使用业务上下文)。P1-75 的独立验收与叠加后的 P1-77 判定各指向自己的跑次。

## 风险

- 模型推理和网络波动可能掩盖 MCP 等待。固定宿主及模型，按用例交错采样，并分列 MCP 工具与端到端耗时。
- Skill 使用按需加载，真实工具链可能出现队列放大。MIX 与宿主题组都保留实际读取和查数证据；同窗越线时以候选 A 为默认。
- Claude Code 或 Cursor 不能提供原生请求轨迹时，如实登记缺证。诊断替代宿主的结论按现行测试台口径登记。
