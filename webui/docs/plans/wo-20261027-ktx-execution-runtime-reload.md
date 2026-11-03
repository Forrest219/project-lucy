# 实施计划 — Spec 191 执行层重载（免重启 Pod）

| 项 | 内容 |
|---|---|
| 对应 Spec | `webui/docs/191-execution-runtime-reload-spec.md` **v0.2**（已按交叉审阅意见修订） |
| 审阅意见 | `docs/reviews/2026-10-26-spec-191-execution-runtime-reload-plan-review.md`（8 项批准条件） |
| 决策基线 | 只重载 KTX daemon / 用户点确认 / 失败不回滚 ktx.yaml / 不推进 S4 |
| 状态 | **已实现，未验收**（2026-10-27）。实现完成并通过静态 Code Review 与本地进程级生命周期实测；容器生命周期验收（AC-12）待镜像重建后执行 |
| 前置已验证 | KTX daemon 收到 SIGTERM 干净退出、端口释放（本地实测）；Proxy 已有 upstream session 恢复机制（`mcp-proxy.ts:381-433`） |

---

## 0. 审阅条件 → 本计划处置对照

| # | 批准条件 | 处置 |
|---|---|---|
| ① | 删除「失败保留旧 daemon」 | Spec §2.2 NG6 / §3 重写；本计划 Step 6 的失败分支测试改为「不伪报成功」 |
| ② | 补齐 supervisor 状态机 | Step 1；Spec §4 给出 PID/信号/退出码/首次启动/退避/遗留清理逐项定义 |
| ③ | 区分进程重启与配置验证 | Step 3（API 字段）+ Step 4（连接级验证）；Spec §5 |
| ④ | 全局串行协议 | Step 2；Spec §6 |
| ⑤ | 会话承诺收敛 | Step 5（UI 文案）+ Step 7（Proxy 恢复测试）；Spec §7 |
| ⑥ | 显式 owner-only | Step 3；Spec §8 |
| ⑦ | 工单补齐 | 本计划 Step 0–7 + §4 AC 映射矩阵 + §5 缺口对照 |
| ⑧ | 通道握手与 K8s 窗口 | Step 1（能力文件）+ Step 2（探测）+ Step 8（文档）；Spec §9 / §10 |

---

## 1. 实施步骤

### Step 0 — 前置门禁（不写代码，先验证）

| 项 | 动作 | 通过标准 |
|---|---|---|
| G-1 | 本地起 `ktx mcp start`，`kill -TERM` | 进程退出、端口释放（**已实测通过**） |
| G-2 | 确认 `connection_list` 工具存在且返回连接名单 | 本地实测返回 `{"connections":[...]}`（**已实测通过**） |
| G-3 | 确认 `requireOwner` 为 async 且拒绝需 `await` | `webui/server/auth/guard.ts:140-149`（**已核**） |
| G-4 | 确认 `/api/health` 在 execution unavailable 时仍 200 | `webui/server/index.ts:728-750`（**已核**） |
| G-5 | 确认 Proxy 有 upstream session 恢复路径 | `mcp-proxy.ts:381-433`（**已核**） |

G-1..G-5 已全部通过，可作为开工依据记录。

---

### Step 1 — supervisor 与通道能力（bash）

**文件**：`scripts/runtime/docker-entrypoint.sh`

新增：
- 常量：`KTX_PID_FILE` / `KTX_RELOAD_REQUEST_FILE` / `KTX_RELOAD_RESULT_FILE` /
  `KTX_RELOAD_CAPABILITY_FILE`（均在 `${PROJECT_ROOT}/.ktx-ui/`）。
- `write_ktx_reload_result(requestId, actualDigest, status, detail)` —— 原子写（tmp + mv）。
- `write_ktx_capability()` / `revoke_ktx_capability()` —— 能力文件发布/撤销（Spec §9）。
- `read_k tx_yaml_digest()` —— 读取磁盘 ktx.yaml 摘要（用于回执 `actualDigest`，P4）。
- `supervise_ktx()` —— 状态机（Spec §4.3）：
  - 拉起 → 写 pid → 写能力（含 heartbeat）→ 等端口就绪。
  - 循环：检查重载请求文件（消费即删）⇒ 走 RELOADING；`kill -0` 失败 ⇒ 走 BACKOFF。
  - 退避 1→2→4→8→16s，上限 5 次 ⇒ FAILED（supervisor 退出 ⇒ 容器退出）。
  - 消费请求后：杀旧实例 → 拉新实例 → 等端口 ⇒ 写回执（`succeeded`/`failed` + `actualDigest`）。
- 启动段改造（现 `:421-429`）：`supervise_ktx &` + `SUPERVISOR_PID=$!`。
- 退出段改造（现 `:435-441`）：TERM/INT ⇒ 先 TERM supervisor（其内部再 TERM KTX）⇒ 等清理 ⇒
  TERM LUCY ⇒ `shutdown`。进程组兜底见 Spec §4.4。

**约束**：bash 3.2（无 `readarray`/`mapfile`/负数下标）；`wait_for_port` 沿用现有实现。

**验证**：
- `bash -n` 语法检查。
- **真实 SIGTERM**：发 TERM 后 supervisor 与 KTX 均退出，**无遗留进程**（`ps` 核对）。
- **首次启动失败**：KTX 起不来 ⇒ 容器按现状语义退出（不退化）。
- **KTX 自发退出**：触发退避重启；超上限 ⇒ 容器退出。
- **重载冒烟**：写请求文件 ⇒ daemon 重启 ⇒ 回执 `succeeded` + `actualDigest` 与磁盘一致。

---

### Step 2 — Node 侧重载控制器

**新文件**：`webui/server/admin/mcp-runtime-reload.ts`

| 导出 | 职责 |
|---|---|
| `reloadExecutionRuntime(input)` | Spec §6.3 主流程 |
| `readReloadState()` / `writeReloadState()` | 三维状态（activation / reload.state / verification），**携带 digest** |
| `queryChannelState(projectRoot)` | P7/P9 用的通道真实状态查询（读 result 文件 + 能力文件） |
| `channelAvailable(projectRoot)` | Spec §9 能力探测（协议版本 + 心跳新鲜度 + supervisorPid 存活） |
| `verifyConfigLoaded(projectRoot, digest, targetConnectionId?)` | Spec §5.3 连接级验证（`connection_list`） |

要点：
- **全局单在途闸门**（模块级单变量，非 per-digest）；超时后先 `queryChannelState`（P7/P9）。
- 原子写请求文件（tmp + rename）；回执只接受 requestId 匹配（P5/P6）。
- 成功后**清空旧 observation**（`mcp-runtime-state.ts` 需新增 `clearExecutionRuntimeObservations()`），
  再由验证结果**写入新证据**（复用 `recordExecutionRuntimeObservation`），状态才可变 `ok`。
- 失败：保留旧 daemon 的承诺**已删除**（Spec §3）；改为有限重试 + 如实报告 + 不回滚配置。

**验证**：单测覆盖 ok / failed / already_running（同 digest + 异 digest）/ unsupported /
超时后不二次触发 / 迟到回执被丢弃 / 陈旧能力文件 → unsupported。

---

### Step 3 — API 路由与鉴权

**文件**：`webui/server/admin/mcp-runtime.ts`

- `POST /api/admin/mcp-runtime/reload`
  - **必须显式** `await requireOwner(request, reply, "仅所有者可重载执行层")` —— `/api/admin/*`
    前缀**不蕴含** owner-only（Spec §8）。
  - **且必须先判** `if ((await resolveAuthMode()) !== "required")` ⇒ 400 `AUTH_NOT_CONFIGURED`。
    理由：`requireOwner` 只读 `request.lucyAdmin?.admin`（`guard.ts:145`），open mode 下
    admin 为 null ⇒ 永远 401。既有 owner 路由统一用该前置判定
    （`auth/routes.ts:375-381, 499-505, 648-654, 719-725, 810-816`），本路由沿用同一范式。
  - 拒绝路径**不得**写请求文件、**不得**产生进程副作用。
- `GET /api/admin/mcp-runtime/status`：`data.execution` 增加
  `activation` / `reload` / `verification` 三维状态（Spec §11.2）。
- 审计：`changeType: "execution_runtime_reload"`、`assetKind: "governance"`；
  成功、失败、拒绝、超时路径均写。

**验证**：路由测试——未登录 401 / 非 owner 403 / owner 允许 / **open 与 bootstrap 模式 400**
/ 拒绝后确认无文件与进程副作用 / unsupported 快速返回。

---

### Step 4 — 写路径接入

**文件**：`webui/server/index.ts`（连接创建、enabled_tables、schema 增删等写 ktx.yaml 的路由）

- 写成功后返回 `executionRuntimePending: true`（该连接待重载）。
- **不自动触发重载**（首版由用户点确认）。
- 写路径**不因**执行层 stale 而失败（配置已正确落盘；stale 是执行层事实）。

**验证**：写路径测试断言返回体含 `executionRuntimePending`，且**未**触发任何重载文件写入。

---

### Step 5 — 前端类型与 UI

**文件**：
- `webui/src/lib/types.ts` —— 新增 `McpRuntimeReloadResult` 与状态面三维字段类型。
- `webui/src/components/McpRuntimeStatusPanel.tsx` —— 新增「重载执行层」按钮。
- `webui/src/pages/admin/McpPlayground.tsx` —— 接线重载 mutation。
- 连接概览调用方 —— **是否增加入口需单独决策**（见 §5 缺口 G-5）。

UI 约定：
- 「重新检测执行层」= 只读检测，**不**加载配置（既有语义不变）。
- 「重载执行层」= 真正让执行层重新加载配置（新增，用户点确认）。
- 重载中：按钮 disabled + 「重载中...」。
- 提示语按 Spec §14 术语：
  - 待重载 → 「配置已写入，执行层尚未加载。可点『重载执行层』使其生效。」
  - **移除**「请重启或 reload MCP 执行进程」这类指向人工重启的表述。

**验证**：组件测试——按钮存在 / 禁用态 / 成功后 refetch / 失败提示 / 术语断言。

---

### Step 6 — 文档与术语登记

| 文件 | 改动 |
|---|---|
| `webui/docs/00-product-terminology-standard.md` | 登记「执行层重载」「待重载」「配置验证」（Spec §14） |
| `webui/docs/README.md` | 补 SPEC 191 索引 |
| `docs/SYSTEM_HANDBOOK.md:3078` | 「可能需要重启 KTX MCP daemon」→ 指向新动作 |
| `webui/docs/163-connection-overview-card-quiet-spec.md:27,43` | 复核「不在连接概览重启问数进程」与新功能的关系（见 §5 G-5） |
| `CHANGELOG.md` | 新增条目 |

**门禁**：`npm run lint:terminology` 通过。

---

### Step 7 — Proxy 会话恢复验证（审阅条件⑤）

**文件**：`webui/server/__tests__/`（新增或扩展）

- 重载后受支持的 buffered 调用（`tools/call`）**自动握手并成功**，不要求客户端手动重连。
- 边界用例：keepalive 关闭时不恢复；流式 passthrough 不走恢复；
  客户端自带 `Mcp-Session-Id` 时被丢弃并用新会话重试。
- 审计断言：恢复成功记 `upstream_session_recovered`。

---

### Step 8 — 容器生命周期验证（审阅条件②）

**独立脚本**：`scripts/verify/verify-ktx-reload-lifecycle.sh`（新增）

| 用例 | 断言 |
|---|---|
| 首次启动失败 | 容器按现状语义退出；不退化为带病运行 |
| KTX 自发退出 | 触发退避重启；超上限 ⇒ 容器退出 |
| SIGTERM | supervisor 与 KTX 均退出；**无遗留进程**（`ps` 核对） |
| 退出码 | 与改造前语义逐项一致 |
| 重载窗口 | Pod 仍就绪；`/api/health` 仍 200；上游调用可能短暂失败（Spec §10.1） |

---

## 2. 不做的事（明确排除）

- 不改 KTX 源码。
- 不实现自动触发重载（首版用户点确认）。
- 不实现 KTX 会话内热重载。
- 不做多副本 / 蓝绿。
- **不实现「重载失败保留旧 daemon」**（需独立架构评审，Spec §2.2 NG6）。
- **不实现「重载期间摘除 K8s 流量」**（需独立健康契约变更，Spec §10.2）。
- 不推进上游 KTX reload 能力。
- 不动 `webui/config/access.yaml`、`ktx.yaml` 等治理类文件。
- **不跑浏览器 E2E**（治理默认值）——但不因此省略进程级、API 级、Proxy 恢复测试。

---

## 3. AC → 实现任务 → 测试文件 映射矩阵

| AC | 实现任务 | 测试文件（拟） |
|---|---|---|
| AC-1 daemon 重启 | Step 1 | `scripts/verify/verify-ktx-reload-lifecycle.sh` |
| AC-2 连接级证据 | Step 2 `verifyConfigLoaded` | `webui/server/__tests__/mcp-runtime-reload.test.ts` |
| AC-3 WebUI/Proxy PID 不变 | Step 1 | `scripts/verify/verify-ktx-reload-lifecycle.sh` |
| AC-4 并发不重启/不错配 | Step 2 全局闸门 | `webui/server/__tests__/mcp-runtime-reload.test.ts` |
| AC-5 失败不伪报/不回滚 | Step 2 失败分支 | `webui/server/__tests__/mcp-runtime-reload.test.ts` |
| AC-6 审计 | Step 3 | `webui/server/__tests__/mcp-runtime-reload.test.ts` |
| AC-7 unsupported 无副作用 | Step 2 `channelAvailable` | `webui/server/__tests__/mcp-runtime-reload.test.ts` |
| AC-8 旧证据失效→验证后变 ok | Step 2 | `webui/server/__tests__/mcp-runtime-reload.test.ts` |
| AC-9 UI 按钮 | Step 5 | `webui/src/__tests__/mcp-runtime-status-panel.test.tsx`（或既有连接概览测试扩展） |
| AC-10 会话自动恢复 | Step 7 | `webui/server/__tests__/mcp-proxy-upstream-session.test.ts`（扩展） |
| AC-11 鉴权 | Step 3 | `webui/server/__tests__/mcp-runtime-reload.test.ts` |
| AC-12 容器生命周期 | Step 8 | `scripts/verify/verify-ktx-reload-lifecycle.sh`（`--container` 模式未验收，见 §8.4） |
| AC-13 超时/迟到回执 | Step 2 | `webui/server/__tests__/mcp-runtime-reload.test.ts` |

---

## 4. 审阅 §3.8 缺口逐项对照

| 审阅缺口 | 处置 |
|---|---|
| ① 写路径返回 `executionRuntimePending` 无对应步骤 | **Step 4** |
| ② `webui/src/lib/types.ts` 类型扩展未列 | **Step 5** |
| ③ 术语标准登记未列 | **Step 6** |
| ④ `webui/docs/README.md` 索引未列 | **Step 6** |
| ⑤ 连接概览是否增加入口未决策 | **仍需决策**（§5 G-5）——本计划默认**只做 MCP 调试台入口**，连接概览入口另行决策 |
| ⑥ AC-1..AC-10 未映射到任务与测试 | **§3 完整矩阵**（扩到 AC-13） |
| ⑦ AC-2/3/5/8/10 缺可执行验证设计 | Step 1/2/7/8 的验证小节 + §3 矩阵 |

---

## 5. 仍需决策（复审时一并定）

| # | 决策项 | 我的建议 |
|---|---|---|
| G-5 | 连接概览是否也放「重载执行层」入口 | **本版只放 MCP 调试台**。连接概览是高频页，放进程级重载按钮易被误触；且 Spec 163 现有约束是「不在连接概览重启问数进程」 |
| G-6 | 退避上限次数与间隔 | 5 次；1→2→4→8→16s（上限 16s） |
| G-7 | 能力心跳阈值 | supervisor 每 5s 更新；**30s** 判陈旧 |
| G-8 | 重载等待超时 | **60s**（KTX 冷启动实测 2–6s，60s 为保守上限） |
| G-9 | 是否加冷却窗口 | **不加**。全局单在途闸门 + 前端禁用已足够；额外冷却会掩盖「改完立刻生效」的期望 |

---

## 6. 风险与门禁

| 阶段 | 门禁 |
|---|---|
| Step 1 | `bash -n`；bash 3.2 实跑；SIGTERM / 子进程退出 / 端口未就绪 / **无遗留进程** 四项实测 |
| Step 2–3 | `cd webui && npm test` 相关文件全绿；新增测试全绿 |
| Step 4–5 | 组件测试全绿；`npm run lint:terminology` 通过 |
| Step 6 | 文档与代码一致；术语 lint 通过 |
| Step 7 | Proxy 恢复测试全绿（不得用 mock 掩盖真实握手路径） |
| Step 8 | 容器生命周期脚本全绿；**compose 启动、healthcheck、优雅退出不回归** |

**回归重点**：Step 1 改动影响**所有**容器启动路径。必须验证 compose 启动正常、
`docker-healthcheck.sh` 通过、优雅退出（SIGTERM）无遗留进程。

---

## 7. 文档位置说明

审阅指出「未找到 SPEC 191 对应的独立正式工单文件」。本计划即工单；
按 `docs/governance/DEVELOPMENT.md` 的 Spec 落位规则（仓库级 spec 落 `docs/`，
实现细节落 `<module>/docs/`），**本计划建议移入 `webui/docs/plans/`** 以便与
其余实施计划同址并被索引。实施时一并处理。

---

## 8. 实施记录（2026-10-27）

### 8.0 提交与验收证据

- **提交**：`21d59b83 feat(v0.25): implement Spec 191 execution runtime reload`（分支 `lucy-v0.25`，20 文件，+3090 / −49）。
- **静态 Code Review**：见 §8.5（7 处修复 + 5 项变异测试）。
- **验证证据**：Spec 191 相关 5 个测试文件 **44/44 通过**；`scripts/verify/verify-ktx-reload-lifecycle.sh --local` **16/16 通过**；
  `npm run lint:terminology`、`npm run lint:ia-boundary` 通过；`npx tsc --noEmit` 的 68 个错误**与改动前基线完全一致**，
  本次新增文件（`mcp-runtime-reload.ts` 等）**0 错误**。
- **全量回归**：`npm test` 为 **1 failed / 4136 passed（345 文件）**。唯一失败
  `server/__tests__/audit-reconciliation-routes.test.ts > D-20 usage 按账本上界 S 选行` 在**干净 HEAD 的独立 worktree 中同样复现**，
  且本次未触碰该路由及其逻辑 ⇒ 属分支既有失败，与本次改动无关。
- **提交内容自洽性**：把暂存区快照单独导出为独立副本后，其 44 个 Spec 191 用例全绿、生命周期脚本 16/16 通过
  ⇒ **被提交的那一份代码本身可编译、可测试**，不依赖工作区里其它会话的未提交改动。

### 8.1 步骤落位

| Step | 落点 | 状态 |
|---|---|---|
| Step 1 | `scripts/runtime/docker-entrypoint.sh`（supervisor + 重载通道能力文件） | 完成；`bash -n` + 本地实测 16/16 |
| Step 2 | `webui/server/admin/mcp-runtime-reload.ts`（新增）；`webui/server/mcp-runtime-state.ts` 新增 `clearExecutionRuntimeObservations()` | 完成 |
| Step 3 | `webui/server/admin/mcp-runtime.ts`（路由 + 鉴权 + 状态面三维字段 + 审计） | 完成 |
| Step 4 | `webui/server/index.ts`（5 条写路径返回 `executionRuntimePending`） | 完成 |
| Step 5 | `webui/src/lib/types.ts`、`webui/src/components/McpRuntimeStatusPanel.tsx`、`webui/src/pages/admin/McpPlayground.tsx` | 完成 |
| Step 6 | `webui/docs/00-product-terminology-standard.md` §4.13、`webui/docs/README.md`、`docs/SYSTEM_HANDBOOK.md`、`webui/docs/163-connection-overview-card-quiet-spec.md`、`CHANGELOG.md` | 完成 |
| Step 7 | `webui/server/__tests__/mcp-proxy-upstream-session.test.ts`（新增 2 条边界用例） | 完成 |
| Step 8 | `scripts/verify/verify-ktx-reload-lifecycle.sh`（新增，`--local` / `--container` 两种模式） | 脚本完成；`--local` 实测通过，`--container` 未执行（本次不做镜像重建） |

### 8.2 §5 决策项处置

| # | 决策项 | 处置 |
|---|---|---|
| G-5 | 连接概览是否也放「重载执行层」入口 | **不放**。入口只在 MCP 调试台；已回写 `webui/docs/163-connection-overview-card-quiet-spec.md` §3／§4 |
| G-6 | 退避上限次数与间隔 | 5 次；1→2→4→8→16s（上限 16s），`LUCY_KTX_RELOAD_BACKOFF_LIMIT` / `_BACKOFF_MAX_S` 可覆盖 |
| G-7 | 能力心跳阈值 | supervisor 每 5s 更新（25 个 0.2s 轮询拍）；**30s** 判陈旧 |
| G-8 | 重载等待超时 | **60s**（`LUCY_KTX_RELOAD_TIMEOUT_MS` 可覆盖，测试用短值） |
| G-9 | 是否加冷却窗口 | **不加**。全局单在途闸门 + 前端禁用 |

### 8.3 实施中的两处偏离（已在代码注释中标注理由）

1. **能力文件增加了 `state` 与 `currentRequestId` 字段。**
   Spec §9.1 的能力文件示例只有 4 个字段，但 P7／P9 要求 Node 侧在超时后能判断
   「supervisor 是否仍在执行」。没有这两个字段就无从判断，只能退化成「再发一次」——
   正是 P7 要禁止的行为。协议版本与心跳语义不变。
2. **入口脚本增加了 `LUCY_ENTRYPOINT_SUPERVISOR_ONLY=1`。**
   只跑 supervisor，不做项目播种、不起 WebUI。它让重载生命周期可以在**不重建镜像**的
   前提下被真实执行（`scripts/verify/verify-ktx-reload-lifecycle.sh --local`），
   生产路径不设置该变量。

### 8.4 未闭合项

- **AC-12 容器生命周期**：`--container` 模式需要已构建镜像，本次按约束不做 Docker 重建，
  因此未执行。已交付脚本与 `--local` 实测证据。
- **AC-1／AC-3 的容器内形态**（旧 PID 退出、新 PID 就绪、WebUI 与 Proxy PID 不变）：
  `--local` 已覆盖 supervisor 侧的旧 PID 退出与新 PID 就绪；「WebUI 与 Proxy PID 不变」
  属于容器形态，未在本次范围内实测。
- **E2E 浏览器契约覆盖**：MCP Runtime 状态面（含本次新增的「重载执行层」）此前**完全没有** E2E 覆盖
  （`webui/tests/e2e/specs/` 无相关 spec；`docs/qa/impact-map.json` 无该路由／组件／selector 映射）。
  本次已补齐浏览器契约层：
  - 新增 `webui/tests/e2e/specs/mcp-runtime-reload.spec.ts`（场景 `E2E-MCP-01`，L2 PR Impacted），
    覆盖三段事实分开呈现、「重新检测执行层」与「重载执行层」是两个动作、待重载文案口径、
    非 owner 形态下重载入口不提供且拒绝路径不伪报成功。
  - `docs/qa/selector-contract.md` 补登 2 个新 selector；`docs/qa/impact-map.json` 升至 v0.4.0，
    补 route／component／api／selector 四类映射；`docs/qa/lucy-webui-e2e-test-suite.md` §7／§10／§11
    与 `docs/qa/changelog.md` 同步登记。
  - 实测：chromium **4/4 通过**；3 处变异（非 owner 也渲染重载按钮／文案混入「请重启」／
    `activation=current`）**逐一转红**，证明断言非恒真；`npm run e2e:selector-contract` 回到改动前基线
    （同为 24 issues，`mcp-runtime` 命中 0）。
  - **「成功重载路径」不进 E2E**——那是进程级事实（daemon PID 变化、配置生效、连接级验证通过），
    浏览器无法断言；归口到 `scripts/verify/verify-ktx-reload-lifecycle.sh --container`（即 AC-12）。

### 8.5 静态 Code Review 发现与修复

自审逐文件复查（含变异测试）后修复了 7 处问题（6 处代码 + 1 处文档），全部有回归用例或本地实测兜底：

| # | 位置 | 问题 | 处置 |
|---|---|---|---|
| 1 | `docker-entrypoint.sh` 回执解析 | 请求字段分隔符是**字面 0x1F 控制字符**，diff 与编辑器都不可见，一旦被工具剥离就静默错配 | 改成显式 `"\u001f"` 转义；本地实测 16/16 仍通过 |
| 2 | `docker-entrypoint.sh` supervisor | 正常退出后 `ktx.pid` 残留，父 shell 的遗留清理可能命中**被复用的 PID** | supervisor 增加 EXIT trap，在有序退出时删除 pid 文件；SIGKILL 不触发 trap，正好是父 shell 需要它的场景 |
| 3 | `docker-entrypoint.sh` 注释 | `shutdown()` 的说明注释被 `wait_for_ktx_ready` 插到中间，注释与函数错位 | 调整顺序，注释归位 |
| 4 | `admin/mcp-runtime.ts` 审计 | 未登录（401）与 bootstrap（400）拒绝路径下 `trustedActorFromRequest` **抛错**，审计被 catch 吞掉 ⇒ 拒绝路径**没有审计** | 增加 `reloadAuditActor()` 安全回退（`actor=anonymous`，与 OIDC 路由既有惯例一致），并给 `ConfigAuditActorType` 增加 `anonymous`；变异测试确认该用例能转红 |
| 5 | `admin/mcp-runtime-reload.ts` 全局闸门 | 闸门在**写请求之后**才置位 ⇒ 两个并发调用各自发一次请求，daemon 被重启两次（违反 P1） | 闸门改为**首个 await 之前**预留；只有上一请求的回执存在才释放；`finally` 只释放自己的预留。补并发用例 + 变异测试 |
| 6 | `admin/mcp-runtime-reload.ts` 目标连接 | 传入 `ktx.yaml` 里不存在的 `connectionId` 时，验证必然失败但提示含糊 | 明确拒绝并说明「不在当前 ktx.yaml 中」，且不发起重载（无副作用） |
| 7 | 本文件 §3 AC 映射矩阵 | AC-11 与 AC-12 两行被合并成一行（缺换行）⇒ 表格结构损坏，AC-12 行在 Markdown 渲染中不成立 | 拆回两行，并给 AC-12 行补注「`--container` 模式未验收，见 §8.4」 |

另补两处质量改进：审计 `oldSummary` 记录重载**前**的 activation（原先是占位值
`unknown`）；前端「重载执行层」按钮按角色收敛为 owner 可见（非 owner 不渲染该动作，
与 API 的 403 一致）。

**变异测试记录**（每处变异都必须让对应用例转红，否则断言恒真）：

| 变异 | 期望转红 | 结果 |
|---|---|---|
| 关掉 `requireOwner` | 401 / 403 用例 | 2 条转红 ✓ |
| 关掉能力探测 | 3 条 `unsupported` 用例 | 3 条转红 ✓ |
| 去掉回执 requestId 配对（P6） | 超时后迟到回执用例 | 1 条转红 ✓ |
| 回退匿名 actor 回退 | 401 审计用例 | 1 条转红 ✓ |
| 闸门改为「通道不忙即释放」 | 并发用例 | 1 条转红 ✓ |
