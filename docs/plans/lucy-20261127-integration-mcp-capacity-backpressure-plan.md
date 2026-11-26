# 系统间 MCP 查数：容量保留、大明细背压与开发者水位 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Do not start Tasks that modify runtime code until development authorization is granted.**

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 分阶段实施计划 / **v1.0** |
| 日期 / 功能编号 | 2026-11-27／**REQ-0119** |
| 状态 | S2｜v1.0-r2。与 Spec 同句：终稿已确权（委托人 2026-11-27）；Plan／UAT 对抗 R1 BLOCK→处置、R2 **PASS WITH FIXES**（N-01～N-05 已吸收）；**开发未授权**；实现未落地；测试台 NOT RUN；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | Spec 终稿已确权。**禁止**在开发授权前改 `webui/server/**` 运行代码。本 Plan／UAT 定稿不构成开发授权。 |
| 验收 | Spec SC-01–SC-12；`UAT-IMC-R0`／`01`–`11` 必做 |
| 关联 | [Spec](../specs/lucy-20261127-integration-mcp-capacity-backpressure-spec.md) · [UAT](../qa/uat/suites/integration-mcp-capacity/suite.md) · [设计](lucy-20261127-integration-mcp-capacity-backpressure-design.md) · [需求](../backlog/entries/REQ-0119-integration-mcp-capacity-backpressure.md) |

**Goal:** 为系统间 MCP 查数落地 interactive 保留槽、integration 可借上限、SC-06 流式背压、观测与开发者指引，使大明细／团队级并发不能堵死员工问数主路径。

**Architecture:** 扩展既有 `McpExecutionCapacity`（workload 维）＋统一上游响应读取闸替换 `readUpstreamBody`；Agent 持久化 `workloadClass`；同进程不拆分。

**Tech Stack:** Node.js／TypeScript、现有 MCP Proxy、Vitest、Docker Compose demo／scale、stability-sentinel、纯 MCP HTTP 客户端。

## Global Constraints

- 立即拒绝、不排队（P1-82）
- 不改 KTX 源码；不改 ACL／行权限语义
- 不宣称官方 SDK／REST 查数 API
- 本轮不做进程拆分
- 主路径可用性优先：约束生效且 interactive 仍可用
- 术语遵守 `webui/docs/00-product-terminology-standard.md`

## 开工前置

1. 读 Spec／本 Plan／UAT／DEVELOPMENT 第一性原理／P1-82 Spec（SC-06 指针）。
2. **确认 OQ-global 书面裁定已落账**（Spec v1.0-r1：出厂维持 `global=24`；可用性靠 SC-08 时延分母）。未落账不得请开发授权。
3. **确认本轮无 WebUI `workloadClass` 枚举**（IMC-09=N/A；仅 OpenAPI／存储）。
4. **取得开发授权**（委托人另行明示）。记录 `git rev-parse HEAD` 与 `git status --short`。
5. Task 0：冻结 OQ-A3／OQ-R／sentinel 阈值与硬件档；未冻结不得宣称水位对外有效。
6. 边界：不重做 P1-78 全量基线；不改 P1-84／P1-63 状态机；拆进程压测另场。

## 任务分解

### Task 0：冻结压测通过线与改前基线（无运行时代码）

**Files:**
- `docs/qa/uat/suites/integration-mcp-capacity/runs/`（基线跑次）
- 可回写 Spec／UAT 仅「冻结数值」表（不改 SC 语义）

**Steps:**

- [ ] 在约定硬件档（默认对齐 2C2Gi demo／scale）跑 T1 对照，记录 success／p95。
- [ ] 冻结 OQ-A3 数字与 T2 并发档（10／20／40 中选一主档＋一加压档）。
- [ ] 记录 `CANCEL_HOLD_MS` 实际值与 T4 等待下限。
- [ ] **上游出口全普查清单**：`readUpstreamBody`＋`pipeResponse`＋passthrough／skills passthrough／其他 `forward*` 消费方；另扫 SSE／流式直写（如 `text/event-stream`、非 `pipeResponse` 的裸 `.pipe(`、`res.write(` 上游体）——无则书面确认。每项 disposition＝挂闸／限量改造／书面豁免（skills 读不得豁免无界 pipe）。记录 grep 模式集供 UAT-IMC-06 diff。
- [ ] 冻结 sentinel 阈值（默认对齐 `stability-sentinel.mjs`：`p99ThresholdMs=250`、`p99Consecutive=3`、`maxEventLoopMs=1000`）与 T2 采样窗／时长。

**Expected:** 开跑前通过线已预注册；无运行时代码变更。

### Task 1：Agent `workloadClass` 存储与 Admin OpenAPI

**Files:**
- `webui/server/admin/agents.ts`（及 access／security 持久化路径，以代码事实为准）
- OpenAPI 文档生成路径
- Tests: agent CRUD／OpenAPI 契约测试

**Steps:**

- [ ] 写失败测试：缺省 interactive；可设 integration；审计含变更；OpenAPI 字段存在。
- [ ] 实现最小持久化＋API；热更新读已提交视图（Spec §4.4）。
- [ ] **不做** WebUI 枚举（本轮已裁）。
- [ ] `npm --prefix webui test` 定向＋typecheck。

**Expected:** SC-01／SC-02 可单测证明。

### Task 2：容量协调器 workload 维

**Files:**
- `webui/server/runtime/mcp-execution-capacity.ts`
- `webui/server/__tests__/mcp-execution-capacity.test.ts`
- `webui/server/proxy/mcp-proxy.ts`（admission 传入 workloadClass）

**Steps:**

- [ ] TDD：`borrowMax`；多 integration Agent 合计触顶 `scope=workload`；interactive 在 borrow 满时仍可 acquire（在 global 未满且保留逻辑正确时）。
- [ ] 与四层顺序合成单测（B-02 对抗用例）。
- [ ] 单测：`integrationActive` 释放与四层租约（含 `CANCEL_HOLD`）**同时点** decrement。
- [ ] 接入 proxy admission；拒绝 `_meta.lucy` 机读字段。
- [ ] 回归既有 capacity 单测／smoke。

**Expected:** SC-03／SC-04 单元＋HTTP 级可证。

### Task 3：SC-06 流式读取闸

**Files:**
- Create: `webui/server/proxy/upstream-body-limit.ts`（或等价）
- Modify: `webui/server/proxy/mcp-proxy.ts`（替换全部 `readUpstreamBody`；改造 `pipeResponse`／passthrough／skills passthrough）
- Tests: `upstream-body-limit.test.ts`、proxy 定向（含原 pipe 路径触顶）

**Steps:**

- [ ] 按 Task 0 **全普查清单**封闭：`readUpstreamBody` 与 **`pipeResponse`／passthrough／skills passthrough`**（改为可计量 transform／限量缓冲＋触顶机读失败；禁止无界 pipe 合规）。
- [ ] TDD：超 per-response／globalBudget 时中止且不完整缓冲；小查询仍成功；至少一条原 pipe 路径触顶。
- [ ] 与行数 limit 双轨顺序单测（Spec §4.5）。
- [ ] 确认入站 `MAX_BODY_BYTES` 行为不变。

**Expected:** SC-05／SC-06。

### Task 4：观测、hold 文档化与 health 摘要

**Files:**
- `mcp-execution-capacity.ts` publicSummary
- `webui/server/index.ts` health 导出（若需）
- 测试：health 形状

**Steps:**

- [ ] 聚合 integration／workload 拒绝计数、reserved／borrow 占用；**interactive 高并发／大响应触顶** 代理计数（SC-10／OQ-2）。
- [ ] 文档化 T4 等待 hold+5s；水位表列「最坏名额回收时延（含 hold）」；单测不模拟无限挂起。

**Expected:** SC-09／SC-10。

### Task 5：开发者指引

**Files:**
- Create: `docs/user-guide/integration-mcp-python-java.md`（或 `docs/runbooks/` 旁 integrator 指南，选定一处）
- 最小 `examples/` 或文档内嵌 Python／Java 片段

**Steps:**

- [ ] 写入接入、session、lucy_catalog→lucy_query、失败退避、非官方声明、水位表占位（Task 0／UAT 后填实测）。
- [ ] 交叉检查无 Maven／PyPI 官方坐标暗示。

**Expected:** SC-11。

### Task 6：UAT 正式跑次（开发授权后）

**Files:**
- `docs/qa/uat/suites/integration-mcp-capacity/runs/`
- INDEX／e2e-ledger 回写判定

**Steps:**

- [ ] 隔离 Docker 执行 R0／01–11；混压＋sentinel。
- [ ] 本轮无浏览器臂（IMC-09=N/A）。
- [ ] 填写水位表到指引。

**Expected:** 测试台可更新；仍 ≠ 可上线。

### Task 7（另场，非本 Plan 出口）：拆进程对照压测

- 同负载脚本：同进程基线 vs 分进程候选；输出是否开 P1-82 B1。

## 完成定义

- SC-01–SC-12 有证据；UAT 必做有正式跑次记录。
- 无官方 SDK 宣称；无进程拆分偷渡。
- 功能合同收口另走 S5 流程；本 Plan 完成 ≠ S5。
