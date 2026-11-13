# 新建连接后执行层未生效 — 修复与回归门禁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复「WebUI 新建／改写连接后执行层仍读旧 `ktx.yaml`、必须手动重启 KTX」的运维级缺陷，并把「创建成功 ⇒ 执行层已加载新连接」变成可自动拦截的回归门禁。

**Architecture:** Docker／K8s 入口里 KTX daemon 由 `supervise_ktx` 独占 `7878`；唯一合法热重载通道是 Spec 191 的 `ktx-reload.request` → supervisor `stop child → wait port → start → receipt`。历史缺陷：`reloadKtxMcpAfterConfigWrite` 曾直接调 `ktx mcp stop/start`，与 supervisor 抢端口并失败（`Port 7878 is already in use`）。**2026-11-13 审计：** 主机代码已走 `reloadThroughSupervisor` → `reloadExecutionRuntime`（capability 有效时）；无 capability 才 CLI 回退。修复口径：配置写路径统一走 supervisor 协议；创建／编辑成功面诚实报告三段事实；补齐单测 + 容器进程级 + live E2E 门禁。

**Progress (2026-11-13 · W2 中间态书面收口):** 进程级写路径／单测（UT-RELOAD-01/02、UT-CONN-01）／**VERIFY-191-C01 25/25 PASSED** 已收口；`E2E-CON-07`／`E2E-MCP-02`／**UAT-CONN-RELOAD-01** 登记为**已知债**（**不挡**本波 W2 文档收口；**挡**发布取证缺陷关闭）。详见 [middev 收口](../reviews/2026-11-13-connection-reload-middev-closure.md)。运行中 `compose-lucy-1` 镜像仍可能偏旧；UAT-01 需可用代理环境下 `demo:upgrade` 后再取证。

**Tech Stack:** WebUI Node（`webui/server/ktx-mcp-reload.ts`、`admin/mcp-runtime-reload.ts`）、`scripts/runtime/docker-entrypoint.sh` supervisor、Vitest、Playwright live-e2e、`scripts/verify/verify-ktx-reload-lifecycle.sh --container`

**Repro evidence（2026-11-12 本机 demo）:**
- WebUI 创建 `repro-tmp-conn` 成功；`ktx.yaml` / secret 已写。
- 日志：`[ktx-mcp-reload] failed to reload KTX MCP after ktx.yaml write: … Port 7878 is already in use.`
- `GET /api/admin/mcp-runtime/status` → `execution.activation=reload_required`，`verification.state=unverified`，新连接出现在 `unknownConnections`。

**Global Constraints**
- 不修改 KTX 上游源码（AGENTS.md）。
- 失败不回滚 `ktx.yaml`（Spec 191 G4）。
- 重载过程与配置验证不得合并为一个模糊 `ok`（Spec 191 G2）。
- 客户交付仍是单副本；不引入双 daemon 蓝绿。
- 术语遵守 `webui/docs/00-product-terminology-standard.md`。
- 未获开发授权前不改运行代码；本文件与 QA 用例登记可先合入。

---

## 0. 为何现有 E2E 没拦住

| 现有门禁 | 实际覆盖 | 缺口 |
|---|---|---|
| `E2E-MCP-01` | 用 `page.route` **注入** `reload_required`；open 模式断言 owner-only 拒绝 | 不创建连接；不碰真实 daemon |
| `E2E-CON-01…06` | 卡片文案、Schema、Manifest、刷新本地目录 | 无「新建连接 → 执行层可见」断言 |
| `api.create-connection.test.ts` | mock `reloadKtxMcpAfterConfigWrite` 为成功，且期望 `executionRuntimeAck === false` | 故意不验证执行层真生效 |
| `verify-ktx-reload-lifecycle.sh --container` | Spec 191 AC-12 ＋ VERIFY-191-C01 **本机已跑通**（2026-11-13，**25/25**） | 浏览器 live E2E／经 WebUI POST 的完整 UAT 仍缺 |

结论：浏览器契约层与单元 mock 都「看起来绿」，运维真实路径（supervisor 管着 7878）从未被断言。

---

## 1. 方案比较与推荐

| 方案 | 做法 | 优点 | 风险 | 结论 |
|---|---|---|---|---|
| A. 修好 CLI `stop/start`（杀 PID、等端口） | 继续绕开 supervisor | 改动面小 | 与 supervisor 双控；子进程被杀后 supervisor 可能按「意外退出」退避重启，时序难测 | 不选 |
| B. 关掉自动重载，只留「重载执行层」按钮 | 对齐 Spec 191 NG2 字面 | 实现简单 | 日常运维多一步；用户报告正是「不重启就不生效」 | 不选作主方案 |
| **C. 写路径统一走 Spec 191 supervisor 协议（推荐）** | `reloadKtxMcpAfterConfigWrite` 在检测到 `ktx-reload.capability` 时改为写 request + 等 receipt + 连接级验证；无 capability 时再退回 CLI（本地非容器） | 与入口脚本单一控制面；已有 `ktx_wait_port_released`；可复用 `POST /api/admin/mcp-runtime/reload` 内核 | 需修订 Spec 191 NG2：允许**配置写路径自动触发**同一协议；手动按钮保留为失败重试 | **采用** |

**产品验收口径（推荐）：**
1. 新建／编辑连接写盘成功后，在有 supervisor 的环境里**自动**完成执行层重载与连接级验证。
2. 成功：`activation=current` 且新 `connectionId` 不在 `missingConnections`／`unknownConnections`；创建成功面可标明「执行层已加载」。
3. 失败：创建配置仍保留；UI／API **不得**伪报执行层已生效；提供「重载执行层」重试；日志含可行动原因（端口占用、supervisor 心跳陈旧、验证失败）。

---

## 2. 文件落位（实现时）

| 文件 | 职责 |
|---|---|
| `webui/server/ktx-mcp-reload.ts` | 有 capability → 委托 Spec 191 controller；无 capability → 保留 CLI 回退；禁止在 supervisor 存活时对 7878 做旁路 start |
| `webui/server/admin/mcp-runtime-reload.ts` | 抽出可供写路径复用的 `requestExecutionRuntimeReload(projectRoot, opts)`（若尚未可复用） |
| `webui/server/index.ts`（create／endpoint／remove 等写路径） | 根据真实 reload + verification 结果填 `executionRuntimeAck`；失败时明确 `executionRuntimeStatus`／`executionDecisionReason` |
| `webui/src/components/CreateConnectionDrawer.tsx`（及编辑连接成功面） | 成功步展示执行层三段事实；失败时提示去 MCP 调试台重试，禁止「已全部生效」措辞 |
| `webui/docs/191-execution-runtime-reload-spec.md` | 修订 NG2：写路径自动触发例外；登记本缺陷与验收 |
| `scripts/verify/verify-ktx-reload-lifecycle.sh` | `--container` 补「写 ktx → 自动／请求重载 → 新连接 canary」 |
| `webui/server/__tests__/ktx-mcp-reload*.ts`、`api.create-connection.test.ts` | 见 §3 用例 ID |
| `webui/tests/live-e2e/` 或容器 verify | 见 `E2E-CON-07` / `E2E-MCP-02` |
| `docs/qa/lucy-webui-e2e-test-suite.md` + `impact-map.json` + `changelog.md` | 用例登记（本轮已写入骨架） |

---

## 3. 测试用例登记（必须合入；实现按 ID 落地）

### 3.1 自动化层级

| ID | 层级 | 名称 | 核心断言 |
|---|---|---|---|
| **UT-RELOAD-01** | Vitest | supervisor 存活时写路径不得 CLI start | mock capability 存在时，`reloadKtxMcpAfterConfigWrite` **不**调用 `ktx mcp start`；改为写 `ktx-reload.request`（或调用共享 controller） |
| **UT-RELOAD-02** | Vitest | CLI 回退遇到端口占用 → `failed` | 无 capability；`start` stderr 含 `already in use` → `status=failed`，detail 保留可诊断信息 |
| **UT-CONN-01** | Vitest | 创建连接 API 诚实回报执行层 | reload `reloaded`+验证通过 → 允许 `executionRuntimeAck=true`；reload `failed` → `executionRuntimeAck=false` 且 reason 非空；**禁止** mock 成功却固定期望 ack=false |
| **E2E-MCP-01** | Playwright fixture（保留） | 浏览器契约层 | 现状保留；文档注明**不能**代替进程级生效断言 |
| **E2E-CON-07** | Live／容器 E2E（P0） | 新建连接后执行层加载新连接 | 见套件 §11.5；无 supervisor 的 `npm run dev` fixture **不得**标为通过本条 |
| **E2E-MCP-02** | Live／容器（P0） | 写路径自动重载与手动重试同协议 | 创建后若自动失败，点「重载执行层」可使 `activation=current`；成功路径与 supervisor receipt 一致 |
| **VERIFY-191-C01** | `verify-ktx-reload-lifecycle.sh --container` | 创建连接进程级门禁 | 容器内 POST 创建（或等价写盘）→ 等待 receipt／status → canary／connection 证据含新 id；失败则脚本非 0 |

### 3.2 手工／UAT（发布取证）

| ID | 名称 | 步骤摘要 | 通过标准 |
|---|---|---|---|
| **UAT-CONN-RELOAD-01** | 本机 demo 新建连接 | WebUI 新建唯一 `connectionId` → 不重启 Pod → MCP 调试台／Agent `connection_list` 可见 | 60s 内 `activation=current`；无需 `docker restart` |
| **UAT-CONN-RELOAD-02** | 失败可观测 | 人为破坏重载（可选）或依赖历史失败日志 | UI 不显示「执行层已加载」；有「重载执行层」；日志无静默成功 |

---

## 4. 实现任务（获开发授权后执行）

### Task 1：单测钉死错误路径（先红后绿）

- [x] 新增 `UT-RELOAD-01` / `UT-RELOAD-02` 失败用例（`ktx-mcp-reload.test.ts`）
- [x] 调整 `api.create-connection.test.ts` 的 ack 期望为「随 reload 结果变化」（`UT-CONN-01`）
- [x] Vitest 相关文件绿灯（2026-11-13：3 files / 47 tests）

### Task 2：写路径改走 supervisor 协议

- [x] 抽取／复用 Spec 191 reload controller（`reloadExecutionRuntime`）
- [x] 改 `reloadKtxMcpAfterConfigWrite`：capability 有效 → request/wait/verify；否则 CLI 回退（审计确认已实现；本轮补 `already in use` CLI 失败判定）
- [x] 所有调用点（create／endpoint update／remove／其它写 `ktx.yaml`）共用该入口（经 `settleExecutionRuntime`／`reloadKtxMcpAfterConfigWrite`）
- [x] 单测转绿

### Task 3：API／UI 诚实成功面

- [x] create 响应区分配置写入 vs 执行层生效（reload 失败 → 503 `EXECUTION_RUNTIME_NOT_LOADED`；成功路径 `executionRuntimeAck` 随 canary）
- [x] CreateConnectionDrawer 成功步展示执行层状态；失败引导「重载执行层」
- [x] 术语与 Forbidden Terms 自检（用「执行层／重载执行层／尚未确认加载」，未用「已全部生效」伪报）
- [ ] edit 成功面同等三段事实（EditConnectionDialog 仍只暴露 `executionRuntimePending`；本轮未改）

### Task 4：Spec 191 修订

- [x] NG2 改为：首版**手动**重载仍保留；**配置写路径允许自动触发同一协议**（Spec 191 v0.3 已含）
- [x] 登记本缺陷复现证据与 AC（含端口占用不得伪报成功）
- [x] 状态行按 `DEVELOPMENT.md` 更新（Spec 头：已实现，本机验收通过）

### Task 5：容器／Live 门禁

- [ ] 实现 `E2E-CON-07`、`E2E-MCP-02`（live-e2e 浏览器路径仍 OPEN；进程级主门禁见 C01）
- [x] 落地 `VERIFY-191-C01`；本机 `--container` **25/25 PASSED**（含 C01 canary；2026-11-13）
- [ ] 本机 demo 跑通 UAT-CONN-RELOAD-01（需 `demo:upgrade` 使容器 WebUI 含 supervisor 写路径后再经 UI／POST create 取证）
- [x] 清理临时连接 `repro-tmp-conn`（已从 `ktx.yaml` 移除并 supervisor reload）

### Task 6：收口

- [x] 更新 `docs/qa/changelog.md` 实现落地节
- [ ] 发布取证清单勾选本缺陷关闭证据（缺 E2E-CON-07／UAT-CONN-RELOAD-01 完整绿证前不关缺陷）
- [x] 删除／归档本机 repro 临时连接 `repro-tmp-conn`
---

## 5. 非目标（本轮不做）

- KTX 进程内热更新 `project.config`（需上游）
- 多副本／蓝绿 daemon
- 用「重启整个 lucy 容器」作为产品推荐路径

---

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 自动重载拉长创建 API 耗时 | 超时沿用 Spec 191（默认 60s）；UI 显示「正在重载执行层」 |
| supervisor 心跳陈旧 | 返回 `unsupported`／`failed` + 明确文案，不假装 CLI start 成功 |
| 旧 CLI 回退在无 supervisor 的开发机仍需要 | 保留 capability 检测分支；单测双路径 |

回滚：恢复 `ktx-mcp-reload.ts` 旧行为仅作紧急措施；产品上仍应提示手动「重载执行层」，不得恢复「静默失败当成功」。
