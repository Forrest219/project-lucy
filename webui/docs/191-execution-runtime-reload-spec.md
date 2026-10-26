# Spec 191 — 执行层重载（KTX daemon 热重启，免重启 Pod）

| Metadata | Content |
|---|---|
| Document name | 执行层重载 Spec（Execution Runtime Reload） |
| Document type | Product / Architecture Spec |
| Version | **v0.2（按交叉审阅意见修订，待复审）** |
| Written date | 2026-10-26 |
| Revised | 2026-10-27（依 `docs/reviews/2026-10-26-spec-191-execution-runtime-reload-plan-review.md` 8 项批准条件修订） |
| Scope | WebUI 写 ktx.yaml 后的执行层生效、KTX daemon 进程编排、MCP Runtime 状态面与 UI 提示 |
| 前置 | `docs/specs/lucy-mcp-execution-runtime-ack-debug-spec.md`（分层模型与 stale 分类） |
| 排查记录 | `inbox/2026-10-26-ktx-config-restart-only-investigation.md`（过程性材料，未入版本库） |
| 实施计划 | `webui/docs/plans/wo-20261027-ktx-execution-runtime-reload.md` |
| 决策 | 只重载 KTX daemon；**用户点确认**触发；失败**不回滚** ktx.yaml；不推进上游 KTX reload 能力 |

## v0.2 修订摘要

| 批准条件 | 处置 |
|---|---|
| ① 删除「失败保留旧 daemon」 | **已删除**。G4 改为「失败如实报告 + 有限重试 + 不回滚配置 + 允许修复后重试」；AC-5 相应重写 |
| ② 补齐 supervisor 状态机 | **已补**（§4）：PID 归属、信号转发、退出码、首次启动、退避上限、遗留进程清理逐项定义 |
| ③ 区分「进程重启」与「配置验证」 | **已拆分**（§5）：`reloadStatus` 与 `configVerification` 两个正交字段；G2／AC-2／AC-8 重写 |
| ④ 改为全局串行协议 | **已改**（§6）：全局单在途 + requestId 配对 + 迟到回执丢弃 + 超时后先查通道真实状态 |
| ⑤ 会话承诺收敛 | **已改**（§7）：改为「客户端无需手动重连；受支持 buffered 调用自动恢复」，不再断言旧会话存活 |
| ⑥ 显式 owner-only | **已补**（§8）：路由必须显式 `await requireOwner(...)`；含 401/403/open mode/无副作用四项验证 |
| ⑦ 工单补齐 | **已补**：实施计划 Step 0–6 + §3.8 缺口逐项对应 + AC→任务→测试文件映射矩阵 |
| ⑧ 通道握手与 K8s 窗口行为 | **已补**（§9）：协议版本化能力握手 + 陈旧标记识别；§10 明确 K8s 重载窗口契约 |

---

## 1. 背景与问题

KTX 的 `ktx mcp start` 常驻进程在**启动时**把 `ktx.yaml` 解析为内存 `project.config`，
运行期不重读。WebUI 写盘成功后，执行层仍按旧名单工作，必须重启才能生效。

客户环境已复核：`docs/reviews/2026-10-20-selectdb-hive-catalog-review.md:119-127`
记录同一现象，其当时建议是「重启 Pod」——本 Spec 的目标就是消除这个动作。

### 1.1 stale 边界

| 读取点 | 来源 | stale |
|---|---|---|
| `local-project-ports.js:19` 执行期取连接 | `project.config.connections` | 是 |
| `local-project-ports.js:76` `connections.list()` | `project.config.connections` | 是 |
| `local-scan-connectors.js:5-7` 建连接器 | `project.config.connections` | 是 |
| `local-query.js:10,29,63,79` 编译/执行 | `project.config.connections` | 是 |
| `local-sl.js:88-101` 语义层 | `fileStore.readFile` 实时读盘 | 否 |
| `local-knowledge.js` wiki | 实时读盘 | 否 |

⇒ **连接级配置**需重载；**内容级资产**不需要。

---

## 2. 目标与非目标

### 2.1 目标

- G1：用户点确认后，**只重载 KTX daemon**，Pod / WebUI / Proxy 进程存活。
- G2（v0.2 重写）：重载**过程**与**配置生效**是两个独立事实，分别报告：
  - G2a：daemon 完成重启（进程级事实）。
  - G2b：目标配置通过**连接级证据**验证已加载（配置级事实）。
  - 两者**不得**合并成一个含义模糊的 `status=ok`。
- G3：重载状态可观测（`idle / running / succeeded / failed`），失败可重试。
- G4（v0.2 重写）：重载失败时——
  - **如实报告**执行层不可用，**不伪报成功**；
  - **不回滚** ktx.yaml；
  - supervisor 做**有限退避重试**；
  - 用户修复配置后可再次重试。
  - **不再承诺「旧 daemon 仍可用」**（见 §2.2 NG6 与 §3.1 论证）。
- G5：成功、失败、拒绝、超时路径均写审计。

### 2.2 非目标

- NG1：不修改 KTX 源码（AGENTS.md 上游边界）。
- NG2：不实现自动触发（首版由用户点确认）。
- NG3：不实现 KTX 会话内热重载。
- NG4：不支持多副本 / 双实例并存。
- NG5：不推进上游 KTX reload 能力。
- **NG6（v0.2 新增）：不保证重载失败时旧 daemon 仍可用。**
  论证见 §3.1；保证该承诺需要蓝绿实例 + 端口/代理切换，或暂存旧配置并在失败时恢复，
  二者均超出现有单进程模型与当前决策，属**独立架构议题**，需重新评审，不作为实现细节补入。

---

## 3. 失败语义（v0.2 重写）

### 3.1 为什么不能保留旧 daemon

现有进程模型是「同一端口单实例」：

```
kill -TERM KTX_PID        # 旧进程退出：内存配置与 MCP 会话消失
ktx mcp start --port 7878 # 新进程绑定同一端口
```

旧进程退出后，其内存中的 `project.config` 与已建立的 MCP 会话**已不可恢复**。
若新配置导致启动失败，用**同一份新配置**再启动也无法回到旧运行状态。
因此「先杀后拉」与「失败保留旧 daemon」在结构上互斥。

同时端口独占排除了「先拉新实例再切流量」：两个实例不能同时绑定 7878。

### 3.2 首版承诺（采纳审阅建议）

| 场景 | 行为 |
|---|---|
| 重载成功 | daemon 重启 + 连接级验证通过 → `reloadStatus=succeeded`，`configVerification=verified` |
| 重载成功但验证未通过 | `reloadStatus=succeeded`，`configVerification=failed` —— **不合并为 ok** |
| 重载失败（daemon 起不来） | `reloadStatus=failed`，`configVerification=unverified`；supervisor 有限退避重试；执行层如实标记不可用 |
| 失败后用户修复配置 | 可再次点「重载执行层」重试 |
| 配置本身 | **永不自动回滚**（决策） |

---

## 4. 进程编排（v0.2 重写：完整生命周期）

### 4.1 拓扑

现状（`scripts/runtime/docker-entrypoint.sh:421-441`）：

```
entrypoint (bash, PID 1 under tini)
  ├── ktx mcp start   → KTX_PID   ┐ 兄弟进程
  └── npm run start   → LUCY_PID  ┘
```

**Lucy 不是 KTX 的父进程，无法直接 signal 它。** 故引入 supervisor。

### 4.2 v0.2 拓扑（审阅条件②的闭合设计）

```
entrypoint (PID 1, bash)
  │
  ├── supervise_ktx (后台 subshell)  → SUPERVISOR_PID
  │     └── ktx mcp start            → KTX_PID (supervisor 的子进程)
  │
  └── npm run start                  → LUCY_PID
```

**PID 归属与清理责任**（逐项回答审阅 ② 的 8 个子问题）：

| # | 问题 | 规定 |
|---|---|---|
| 1 | 父 shell 等待谁 | 父 shell 等待 `SUPERVISOR_PID` 与 `LUCY_PID`；**不再**等待 `KTX_PID` |
| 2 | KTX PID 归属 | KTX 是 supervisor 的子进程。supervisor 负责其生命周期；**当前 KTX PID 写入 `.ktx-ui/ktx.pid`** 供诊断，不作为父子关系依据 |
| 3 | 信号转发顺序 | 收到 TERM/INT 时，父 shell **先**向 supervisor 发 TERM，supervisor **再**向 KTX 子进程发 TERM 并等待其退出；父 shell 等待两者都结束后再退出 |
| 4 | supervisor 死但 KTX 活 | supervisor 退出前必须清理其 KTX 子进程；若 supervisor 被 SIGKILL（不可捕获），父 shell 的退出清理以**进程组**兜底（见 §4.4） |
| 5 | 首次启动失败 | KTX 首次拉起失败**不阻止** WebUI 启动（保持现状语义：现状 `wait_for_port` 失败会 `exit 1`）。**决策：保持现状**——首次启动失败即容器启动失败，避免带病运行。实现须保持这一点 |
| 6 | KTX 自发退出 | 触发 supervisor 的**有限退避重启**；超过上限（§4.3）后 supervisor 退出，父 shell 据此让容器退出 |
| 7 | 退避上限 | 连续失败 N 次（默认 5）后放弃；退避间隔 1s→2s→4s→8s→16s（上限 16s） |
| 8 | 原 `wait -n` 退出码语义 | 逐项保持：任一子进程退出 ⇒ 父 shell 走 `shutdown`（`docker-entrypoint.sh:369-376`）并用其退出码退出。改造后等待对象由 `KTX_PID` 改为 `SUPERVISOR_PID`，**退出码传递链不变** |

### 4.3 supervisor 状态机

```text
                  ┌──────────────┐
                  │  STARTING    │
                  └──────┬───────┘
                         │ 拉起 ktx mcp start
                         ▼
                  ┌──────────────┐   kill -0 失败
                  │   RUNNING    │ ──────────────────┐
                  └──────┬───────┘                   │
        收到重载请求      │ KTX 自发退出              ▼
              ┌──────────┴──────────┐        ┌──────────────┐
              ▼                     │        │  BACKOFF     │
       ┌──────────────┐             │        │ 1→2→4→8→16s │
       │ RELOADING    │             │        └──────┬───────┘
       │ kill -TERM   │             │               │ 超过上限(5)
       │ → 拉起新实例 │             │               ▼
       │ → 等端口就绪 │             │        ┌──────────────┐
       └──────┬───────┘             │        │  FAILED      │
              │                     │        │ supervisor 退出│
              │ 端口就绪            │        │ → 容器退出    │
              ▼                     │        └──────────────┘
       ┌──────────────┐             │
       │  RUNNING     │◄────────────┘
       │ (新实例)     │  退避后重试
       └──────────────┘
```

**重载分支的失败处理**：
- 重载后端口不就绪 ⇒ 写回执 `failed`（含失败原因）⇒ 进入 BACKOFF 有限重试。
- 重试期间若用户再次请求重载 ⇒ **不排队**，直接返回 `already_running`（§6 全局串行）。

### 4.4 优雅退出与遗留进程

- 父 shell 的 `trap` 链（`docker-entrypoint.sh:435-436`）扩展为：TERM/INT ⇒
  `kill -TERM $SUPERVISOR_PID` ⇒ 等 supervisor 清理 KTX ⇒ `kill -TERM $LUCY_PID` ⇒ 退出。
- **进程组兜底**：entrypoint 以 `setsid`（若可用）启动 supervisor，使 supervisor + KTX
  处于独立进程组；父 shell 退出前对该进程组发 TERM，避免 supervisor 被 SIGKILL 时遗留 KTX。
  `setsid` 不可用时降级为「父 shell 显式 kill KTX_PID（从 pid 文件读）」。
- **验收必须包含**（审阅明确要求）：真实 SIGTERM、子进程退出、端口未就绪、**无遗留进程**。

### 4.5 bash 3.2 约束

禁止 `readarray` / `mapfile` / 负数数组下标（AGENTS.md）。
轮询用 `sleep 0.2` + `kill -0`；退避用显式变量而非数组。

---

## 5. 状态模型（v0.2：三层正交，审阅条件③④）

### 5.1 三个正交维度

审阅指出「待重载」与 `pending` 混淆。v0.2 拆为：

| 维度 | 取值 | 含义 |
|---|---|---|
| `activation`（**配置生效状态**） | `current` / `reload_required` / `unknown` | 磁盘配置是否已被执行层确认加载 |
| `reload.state`（**操作状态**） | `idle` / `running` / `succeeded` / `failed` | 一次重载操作本身的状态 |
| `verification`（**验证状态**） | `unverified` / `verifying` / `verified` / `failed` | 目标 digest 是否通过连接级证据验证 |

**digest 绑定**：`reload` 与 `verification` 状态**必须携带 digest**，
避免旧 digest 的成功状态被展示为当前 digest 已生效。

### 5.2 两个结果字段（审阅条件③）

| 字段 | 含义 | 判定依据 |
|---|---|---|
| `reloadStatus` | daemon 是否完成重启 | 旧 PID 退出 + 新 PID 就绪 + 端口恢复 + requestId 回执匹配 |
| `configVerification` | 目标 digest 是否通过**连接级**证据验证 | `connection_list` 含目标连接，或目标连接受控只读查询成功 |

**`probeStatus`（initialize + tools/list）只证明 MCP 工具面可达，不能替代 `configVerification`。**
它作为第三个字段 `mcpReachable` 保留，仅作诊断。

### 5.3 连接级验证的取证方式

`connection_list` 是 KTX MCP 的只读工具（本地实测存在，输出 `{"connections":[...]}`）。
验证流程：

```ts
// ① 重启完成
// ② 调 connection_list，拿到当前 daemon 认识的连接名单
// ③ 与目标 digest 的 ktx.yaml 连接集合比对
// ④ 目标连接在名单中 → configVerification = verified
//    目标连接不在名单中 → configVerification = failed（daemon 起得来但没读到新配置）
```

**不得**用端口就绪、`tools/list` 成功或进程存在替代此验证（审阅条件③）。

### 5.4 observation 与状态跃迁（审阅条件③）

`readMcpRuntimeStatus()` 的汇总要求**所有**当前连接都有成功证据才返回 `ok`；
无证据时为 `unknown`（`admin/mcp-runtime.ts:206-210`）。

因此：

- **重载后清空旧 observation** 是**旧证据失效**的正确措施（digest 未变，必须显式清）。
- 但它**不能**推出「状态立即从 stale 变为 ok」——清空后状态回到 `unknown`（待确认）。
- **v0.2 决策：首版提供自动连接级验证**（§5.3）。验证成功时写入与**当前 digest** 对应的新证据
  （复用 `recordExecutionRuntimeObservation`），此后状态才可变为 `ok`。
- **严禁**伪造 observation 或直接改状态绕过证据要求。

---

## 6. 重载协议（v0.2：全局串行，审阅条件④）

### 6.1 为什么按 digest 幂等不够

`Map<digest, requestId>` 只限制**相同** digest。配置连续变化时，不同 digest 的请求会
并发写同一个 `.ktx-ui/ktx-reload.request` / `.ktx-reload.result`，导致：
请求覆盖、回执错配、旧请求加载新配置、重复重启。

且 Node 侧 60s 超时**不等于** supervisor 已停止执行——超时后直接清 inflight 再触发，
会与仍在执行的旧请求重叠。

### 6.2 协议

```text
请求（Node → supervisor，单文件通道）
  { requestId, requestedDigest, requestedAt }

回执（supervisor → Node，同一 result 文件）
  { requestId, actualDigest, status, detail?, finishedAt }
```

| # | 规则 |
|---|---|
| P1 | **全局单在途**：任一时刻只允许一个重载请求。不同 digest 也排队/拒绝，不并发 |
| P2 | 请求含 `requestId` / `requestedDigest` / `requestedAt` |
| P3 | supervisor **串行**消费请求；同一时刻只处理一个 |
| P4 | supervisor 拉起新 daemon 后**重新读取并核对实际磁盘 digest**，写入 `actualDigest` |
| P5 | 回执含**相同 requestId** + 实际 digest + 明确终态 |
| P6 | **迟到回执不得完成后续请求**：Node 侧只接受 requestId 匹配的当前在途请求的回执 |
| P7 | Node 超时后**先查询通道真实状态**（读 result 文件 + 查 supervisor 是否在途），**不得**直接假定可再次重载 |
| P8 | 请求被取走前：Node 侧删除自己的请求文件即可撤销；被取走后：只能等回执或走超时恢复 |
| P9 | 回执超时后：Node 标记 `reload.state=failed`（`detail=超时`），并**查询通道真实状态**；通道若仍在执行，下一次触发返回 `already_running` |

### 6.3 全局串行闸门（Node 侧）

```ts
// 模块级单在途闸门（不是 per-digest）
let inflight: { requestId: string; digest: string; startedAt: string } | null = null;

async function reloadExecutionRuntime(input) {
  // ① 全局单在途闸门（任何 digest）
  if (inflight) {
    // P7：先查通道真实状态，确认上一个是否真的还在跑
    const channelState = await queryChannelState(projectRoot);
    if (channelState.busy) {
      return { status: "already_running", requestId: inflight.requestId, ... };
    }
    // 通道确认已空闲 ⇒ 上一个已结束，清理闸门继续
    inflight = null;
  }
  // ② 通道能力探测（§9）——无有效 supervisor ⇒ 立即 unsupported，不等 60s
  if (!(await channelAvailable(projectRoot))) {
    return { status: "unsupported", detail: "..." };
  }
  // ③ 发请求（P2），置 inflight
  // ④ 等回执；超时后走 P7/P9
  // ⑤ 无论成败都清 inflight、写状态、落审计
}
```

---

## 7. MCP 会话语义（v0.2 收敛，审阅条件⑤）

### 7.1 统一承诺

> **客户端无需手动重连；重载完成后，受支持的 buffered 调用可通过 Proxy 自动建立新的上游会话。**

**不**承诺「旧 MCP 会话仍存活」「所有请求均不受影响」。

### 7.2 依据与边界

Proxy 的 `forwardToKtxWithSession`（`webui/server/proxy/mcp-proxy.ts:381-433`）在
上游拒绝（`upstream_session_required`）时会：清除旧 session → 重新握手 → **重试一次**。

| 边界 | 说明 |
|---|---|
| 适用路径 | **buffered**：`tools/list` / `tools/call` |
| 不适用 | **流式 passthrough**（`forwardToKtx` 直转，不走恢复）；重载窗口内的**网络层失败**（连接被拒） |
| keepalive 开关 | `LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE=false` 时**不恢复**（`upstream-session.ts:64-66`） |
| 原生客户端 | 客户端若自行持有并发送 `Mcp-Session-Id`，该 id 在重载后失效；Proxy 会丢弃它并用新会话重试 |
| 审计 | 恢复成功记 `upstream_session_recovered`（`mcp-proxy.ts:437`） |

### 7.3 v0.2 目标修订

- G1 改为：**WebUI / Proxy 进程存活**（不再断言 MCP 会话存活）。
- AC-3 改为：重载前后 **WebUI 与 Proxy 的 PID 不变**。
- AC-10 改为：重载后受支持的 buffered 调用**自动握手并成功**，**不要求客户端手动重连**。

---

## 8. 鉴权（v0.2 显式，审阅条件⑥）

`/api/admin/*` 前缀**不蕴含** owner-only。全局 WebUI 鉴权 hook 主要保证「已登录管理员」，
owner 判定必须显式调用 `requireOwner`（`webui/server/auth/guard.ts:140`）。

**新路由必须**：

```ts
// webui/server/admin/mcp-runtime.ts
app.post("/api/admin/mcp-runtime/reload", async (request, reply) => {
  // ① open / bootstrap 模式下不存在 owner 账户 ⇒ 明确拒绝（沿用既有 owner 路由范式）
  if ((await resolveAuthMode()) !== "required") {
    return reply.status(400).send({
      ok: false,
      error: { code: "AUTH_NOT_CONFIGURED", message: "请先完成管理员引导" }
    });
  }
  // ② owner 判定（async，拒绝必须 await）
  if (!(await requireOwner(request, reply, "仅所有者可重载执行层"))) return;
  // ③ 之后才允许产生任何文件/进程副作用
});
```

**为什么必须先判 authMode（v0.2 修正）**：
`requireOwner` 只读 `request.lucyAdmin?.admin`（`guard.ts:145`），**不处理 open mode**。
open mode 下 `attachAdminContext` 无 session ⇒ `admin === null` ⇒ `requireOwner` 会返回
**401**，而不是允许。这与「open mode 即本机管理员」的语义冲突。

既有 owner 路由（`webui/server/auth/routes.ts:375-381, 499-505, 648-654, 719-725, 810-816`）
统一采用 `resolveAuthMode() !== "required"` ⇒ 400 `AUTH_NOT_CONFIGURED` 的前置判定。
本路由**沿用同一范式**，避免 open mode 下重载路由永远 401 而无法使用。

`requireOwner` 是 **async** 且拒绝必须 `await`（`guard.ts:128-138` 记录了
`void reply.send` 导致 `ERR_HTTP_HEADERS_SENT` 杀掉整个进程的既有缺陷）。

| 场景 | 期望 | 依据 |
|---|---|---|
| 未登录（required 模式） | 401 `AUTH_REQUIRED` | `guard.ts:146-152` |
| 已登录但非 owner | 403 `OWNER_REQUIRED` | `guard.ts:153-159` |
| owner | 允许触发 | `guard.ts:160` |
| **open mode** | **400 `AUTH_NOT_CONFIGURED`**（与既有 owner 路由一致） | `routes.ts:375-380` |
| **bootstrap 模式** | **400 `AUTH_NOT_CONFIGURED`**（尚未有 owner 账户） | 同上 |
| 拒绝路径 | **不得**写重载请求文件，**不得**产生任何进程副作用 | — |

---

## 9. 通道能力握手（v0.2 新增，审阅条件⑧）

「PID 文件可写 + 请求目录可写」**只能证明文件系统可写**，不能证明存在支持该协议
且正在监听的 supervisor。旧镜像 / 异常启动 / supervisor 已退出时，
请求会等满 60s 才失败，而非快速返回 `unsupported`。

### 9.1 能力文件

`.ktx-ui/ktx-reload.capability`，内容：

```json
{
  "protocol": "lucy-ktx-reload/1",
  "supervisorPid": 1234,
  "startedAt": "2026-10-27T00:00:00.000Z",
  "heartbeatAt": "2026-10-27T00:01:00.000Z"
}
```

| 规则 | 说明 |
|---|---|
| H1 | supervisor 启动时**发布**能力文件（含协议版本） |
| H2 | supervisor 定期更新 `heartbeatAt`（建议 5s） |
| H3 | supervisor 正常退出时**撤销**（删除能力文件） |
| H4 | 陈旧标记识别：`heartbeatAt` 超过阈值（默认 30s）或 `supervisorPid` 不存在 ⇒ 视为**无有效 supervisor** |
| H5 | 协议版本不匹配 ⇒ `unsupported` |
| H6 | Lucy 启动时：读取能力文件；若显示 supervisor 在途但无回执 ⇒ 恢复 `pending` 状态并**先查通道真实状态**，不得直接再发起重载 |

---

## 10. K8s 重载窗口行为（v0.2 明确，审阅条件⑧）

现状：Helm 的 startup / readiness / liveness probe 都请求 WebUI `/api/health`；
该接口**即使 execution unavailable 仍返回 HTTP 200**，只在响应体报告 degraded
（`webui/server/index.ts:728-750`）。

⇒ **现有探针不会仅因 KTX daemon 短暂不可达而摘除 readiness。**

### 10.1 首版明确行为（有意选择）

| 项 | 行为 |
|---|---|
| 重载窗口内 Pod | **仍然就绪**（不摘除流量） |
| WebUI / Proxy | 仍接受请求 |
| 上游调用 | 可能短暂失败（走 §7.2 恢复路径或直接报错） |
| 依赖 K8s readiness 隐藏窗口 | **不依赖** |

### 10.2 明确不在本 Spec 范围

「重载期间摘除流量」属于**另一项健康契约变更**（需改 `/api/health` 的 HTTP 状态语义
并重新设计探针），需单独立项设计与验证，**不在本 Spec 首版**。

---

## 11. 写路径接入与状态面

### 11.1 写路径返回

写 ktx.yaml 成功后，返回体增加：

```ts
executionRuntimePending: boolean;   // 该连接是否待重载
```

**不自动触发重载**（首版由用户点确认）。写路径的改动点见实施计划 Step 5。

### 11.2 状态面扩展

`GET /api/admin/mcp-runtime/status` 的 `data.execution` 增加：

```ts
execution: {
  status: "unknown" | "ok" | "stale" | "unavailable" | "error";
  activation: "current" | "reload_required" | "unknown";
  reload: {
    state: "idle" | "running" | "succeeded" | "failed";
    requestId?: string;
    digest?: string;          // 该状态绑定的 digest
    startedAt?: string;
    finishedAt?: string;
    detail?: string;
  };
  verification: {
    state: "unverified" | "verifying" | "verified" | "failed";
    digest?: string;
    checkedAt?: string;
    detail?: string;
  };
  // 既有字段保持不变
};
```

---

## 12. API 契约

### 12.1 触发重载

```text
POST /api/admin/mcp-runtime/reload
```

请求体（可选）：`{ connectionId?: string; reason?: "user_confirmed" }`

响应：

```ts
type McpRuntimeReloadResult = {
  ok: boolean;
  data: {
    requestId: string;
    reloadStatus: "succeeded" | "failed" | "already_running" | "unsupported";
    configVerification: "verified" | "failed" | "unverified";
    mcpReachable?: "reachable" | "unavailable" | "error";
    requestedDigest: string;
    actualDigest?: string;
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    detail?: string;
  };
};
```

| 规则 | 说明 |
|---|---|
| `unsupported` | **200 + `reloadStatus=unsupported`**（部署形态事实，非故障）；**无任何文件/进程副作用** |
| `already_running` | 200；全局单在途命中（§6） |
| `reloadStatus=succeeded` 且 `configVerification=failed` | 200；**不得**合并为 ok |
| 鉴权 | 401 / 403 见 §8 |
| 审计 | 成功、失败、拒绝、超时路径均写 `changeType: "execution_runtime_reload"` |

---

## 13. 验收标准（v0.2 重写）

| ID | 验收项 | 对应审阅条件 |
|---|---|---|
| AC-1 | 旧 PID 退出、新 PID 就绪、端口恢复、回执 requestId 匹配 | ② |
| AC-2 | **连接级证据**：目标连接出现在 `connection_list`，或目标连接受控只读查询成功 | ③ |
| AC-3 | 重载前后 **WebUI 与 Proxy 的 PID 不变** | ⑤ |
| AC-4 | 相同 **和不同** digest 均不并发重启；回执不错配 | ④ |
| AC-5（重写） | 重载失败 ⇒ `reloadStatus=failed`，**不伪报成功**、**不回滚 ktx.yaml**、状态与审计准确；**不断言旧 daemon 存活** | ① |
| AC-6 | 成功、失败及约定内拒绝/超时路径均产生审计记录 | — |
| AC-7 | 无有效 supervisor 能力（陈旧心跳/版本不符）⇒ 快速返回 `unsupported`，**无文件与进程副作用** | ⑧ |
| AC-8（重写） | 重载后**旧 stale 证据失效**（状态回 `unknown`/待确认）；**经连接级验证并写入新证据后**才变 `ok` | ③ |
| AC-9 | UI 提供「重载执行层」（用户点确认），与「重新检测执行层」并存且语义区分清晰 | — |
| AC-10（重写） | 重载后受支持的 buffered 调用**自动握手并成功**，**不要求客户端手动重连**；流式与 keepalive 关闭的边界有测试 | ⑤ |
| AC-11 | 鉴权：未登录 401 / 非 owner 403 / owner 允许 / **open 与 bootstrap 模式 400 `AUTH_NOT_CONFIGURED`**（与既有 owner 路由一致）/ 拒绝无副作用 | ⑥ |
| AC-12 | 容器生命周期：首次启动失败、KTX 自发退出、SIGTERM、退出码、**无遗留进程**均通过 | ② |
| AC-13 | Node 超时后**不错误发起第二次重载**；迟到回执不污染新请求 | ④ |

---

## 14. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- **执行层重载**（Execution Runtime Reload）：只重启 KTX 执行进程，使其重新读取最新连接配置；
  **不含**重启 Pod / 容器 / WebUI。
  - UI 主术语：执行层重载。
  - 禁止文案：「热更新连接」「自动同步连接」「无需重启」——会误导为不需要任何重启动作。
- **待重载**（Reload Required）：配置已写入磁盘，但执行层尚未确认加载。
  - UI 主术语：待重载。
  - 禁止文案：「未生效」（会暗示配置写失败）。
- **配置验证**（Config Verification）：以连接级证据确认执行层已加载目标配置。
  - 与「重新检测执行层」（只读检测）严格区分。

既有术语沿用：MCP 执行层、执行运行时状态、「重新检测执行层」。

---

## 15. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 重载窗口内上游不可达 | `reloadStatus` 与 `configVerification` 分开报告；`mcpReachable` 单独诊断；UI 显示「重载中」非「故障」 |
| supervisor 改造引入启动回归 | §4.2 逐项定义生命周期；§4.5 bash 3.2 约束；AC-12 专项验证 |
| 反复点击导致反复重启 | **全局单在途**闸门（§6.3）+ 前端 pending 禁用 |
| 迟到回执污染 | requestId 配对 + P6 丢弃迟到回执 + AC-13 |
| 重载后状态误判 ok | 清空旧 observation；必须连接级验证并写入新证据才可变 ok（§5.4） |
| 客户环境 KTX 版本差异 | 通道只依赖 CLI 与端口，不依赖 KTX 内部 API；`connection_list` 缺失时 `configVerification=failed`（不伪报） |
| 重载后客户端断连 | §7 明确收敛承诺；Proxy 已有恢复路径；边界写入 AC-10 |
