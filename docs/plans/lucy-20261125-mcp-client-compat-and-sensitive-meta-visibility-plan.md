# 敏感元数据工具可见性对齐与拒绝修复引导 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 分阶段实施计划 / **v1.0** |
| 日期 / 功能编号 | 2026-11-25／**P1-88**／REQ-030-109 |
| 状态 | S2｜v1.0。**终稿已确权**（委托人 2026-11-25 明示「审阅通过……授权定稿」）；**开发未授权**；测试台 NOT RUN；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | 本文件仅为规划草案；**取得委托人终稿确权与开发授权前，禁止修改任何运行代码** |
| 验收 | Spec SC-01–SC-05；`UAT-R0`、`UAT-MCCC-01～04` |
| 关联 | [Spec](../specs/lucy-20261125-mcp-client-compat-and-sensitive-meta-visibility-spec.md) · [UAT](../qa/uat/suites/mcp-client-compat-sensitive-meta/suite.md) |

## 目标

基于已核实现场日志 [`inbox/lucy-ksc-finreport-error-log.md`](../../inbox/lucy-ksc-finreport-error-log.md) 与源码审查，在不改动第三方 MCP 客户端源码的前提下，在 Lucy 服务端完成两项加固：
1. 使 `tools/list` 与 `initialize` 阶段 `visibleTools` 对 `policy.sensitiveMetadataTools`（默认 `dictionary_search`、`discover_data`）在 `runtime.sourceMap` 存在时执行与 `authorizeAndRewrite()`（`acl.ts:3436`）一致的 fail-closed 门禁；
2. 增强 `sensitive_metadata_forbidden:*` 拒绝修复载荷：保留 B15 闭环、按实际 `allowedToolNames` 过滤 `nextTools`、避免大数量来源列表重复输出（`mcp-proxy.ts:5576-5578, 5676`），并通过 UAT 验证 `lucy_catalog` → `lucy_read_source` → `lucy_query` 逃生假设。

（注：原 `MCP_INVALID_OPERATION` / Tool `inputSchema` 改造、以及日志暴露的 `lucy-ops` 连接差异与 `ambiguous_field` 问题已分别通过 OQ-1、OQ-3、OQ-4 剥离登记，待另案处理。）

**技术栈：** Node.js／TypeScript（`webui/server/proxy/acl.ts`、`webui/server/proxy/mcp-proxy.ts`）、Vitest、Docker Compose、纯 MCP 客户端探针（复用 `scripts/uat/mcp-*`）。

## 开工前置

1. ~~完成 Spec 评审与**终稿确权**~~ **已完成**（2026-11-25 委托人明示「审阅通过……授权定稿」；OQ-1 剥离、OQ-2 保持 fail-closed、OQ-3／OQ-4 单列跟踪）。
2. ~~将本工作项登记至三台账与索引~~ **已完成**（2026-11-25 随定稿同批登记）：
   - `0.30` 执行总账（SOT）v2.87 行＋P1-88 条目与需求池 REQ-030-109（并同步 `lint:spec-docs` 镜像状态）；
   - [`docs/README.md`](../README.md) 与 [`docs/plans/README.md`](README.md)；
   - [`docs/qa/uat/INDEX.md`](../qa/uat/INDEX.md)、[`docs/qa/uat/CONVENTIONS.md`](../qa/uat/CONVENTIONS.md)（`UAT-MCCC-*` 编号前缀）及 [`docs/governance/e2e-ledger.md`](../governance/e2e-ledger.md)（三台账勾连行）。
3. 取得委托人明示**开发授权**后，方可修改 `webui/server/proxy/` 下的运行代码。

## 任务分解

### Task 1：对齐 `tools/list` 与 `tools/call` 的敏感元数据工具门禁（TDD）

- **目标文件**：`webui/server/proxy/acl.ts`（`allowedToolNames`，`2683-2717` 行）与 `webui/server/__tests__/kx-acl.test.ts`、`webui/server/__tests__/mcp-proxy-acl.test.ts`。
- **内容**：
  1. 在 `allowedToolNames()` 中，对 `policy.sensitiveMetadataTools` 增加与 `acl.ts:3436` 一致的检查：`if (runtime.sourceMap && !hasExplicitAccessToAllSensitiveTables(resolved.permissions.tables, runtime.sourceMap, policy.sensitiveTablePrefixes)) return false`。
  2. 补齐 SC-01、SC-02 单元测试，特别覆盖「`sensitiveTables(...)` 为空 + `sensitive_metadata_tools` 非空」以及「`tables: ["*"]` 通配非显式全量」两类边界。

### Task 2：增强 `sensitive_metadata_forbidden` 拒绝修复载荷

- **目标文件**：`webui/server/proxy/mcp-proxy.ts`（`buildDenialRepairPayload`，`5540-5582` 行）与 `webui/server/__tests__/denial-repair-hint.test.ts`。
- **内容**：
  1. 保留 `!resolved?.ok` 返回 `null` 与现有 B15 闭环（`collectRepairEvidence` + `buildRepairClosure`）。
  2. 当 `reason.startsWith("sensitive_metadata_forbidden")` 且 `allow.sources.length > 0` 时，输出紧凑的「全局搜索受限 vs 已授权来源可查」说明，避免重复拼接两次全量来源列表，并按 `allowedToolNames(identity)` 过滤 `nextTools`（`lucy_catalog` / `lucy_read_source` / `lucy_query`）。
  3. 当 `allow.sources.length === 0` 时走 B15 事实性兜底，确保不出现「查询下方可用来源」的死路文案。
  4. 补充单测断言：不泄露未授权表名、零来源无死路、未授 `lucy_read_source` 角色不推荐 `lucy_read_source`。

### Task 3：本机测试与隔离 Docker UAT 验收

- **内容**：
  1. 运行 `cd webui && npm test -- kx-acl mcp-proxy-acl denial-repair-hint mcp-proxy-instructions` 与 `./node_modules/.bin/tsc --noEmit`。
  2. 按 [`fixtures.md`](../qa/uat/suites/mcp-client-compat-sensitive-meta/fixtures.md) 构造含 `dataforai.kx_*` 敏感表的夹具、空匹配敏感表对照及四类身份凭据。
  3. 复用 `scripts/uat/mcp-*` 纯 MCP 探针（禁用 `initialize.result.instructions` 消费）执行 `UAT-R0` 与 `UAT-MCCC-01～04`，验证逃生假设并记录跑次证据。

## 浏览器验证

不适用：本工作项为纯 MCP 协议与服务端 ACL／修复提示改造，不触及 WebUI 用户可见面，按 `DEVELOPMENT.md`「非 WebUI 任务（默认）」不强制浏览器测试。

## 验收

- Spec `SC-01`–`SC-05` 均有对应自动化测试或跑次证据。
- `UAT-R0` 与 `UAT-MCCC-01～04` 在隔离 Docker demo + 敏感表夹具 + 纯 MCP 上全绿，同时覆盖「约束生效（隐藏且拦截 `policy.sensitiveMetadataTools`）」与「合法用户仍可用（`lucy_read_source → lucy_query` 主路径成交）」。
- `npm run lint:spec-docs`、`npm run lint:terminology` 全绿。

## 完成定义

终稿确权 → 三台账及规范登记 → 开发授权 → Task 1–3 实施与单测全绿 → Docker demo UAT 全绿 → 委托人验收与功能合同收口。

## 风险

| 风险 | 缓解 |
|---|---|
| `allowedToolNames` 收紧影响依赖 `discover_data` 出现在列表中的旧测试 | 开工前先全量检索 `discover_data`／`dictionary_search` 测试断言；仅在 `runtime.sourceMap` 存在且未满足 `hasExplicitAccessToAllSensitiveTables` 时隐藏 |
| 默认 demo 无 `dataforai.kx_*` 表导致 UAT-MCCC-01 假绿 | 由 `fixtures.md` 强制要求注入 `dataforai.kx_*` 敏感表夹具，同时在 MCCC-01 单设空匹配敏感表对照组 |
| 拒绝提示文案误导、重复刷屏或泄露未授权表 | 严格复用 `denialAllowList` + B15 闭环 + `allowedToolNames` 过滤，由 SC-03／SC-05 单测与 UAT 验证 |
