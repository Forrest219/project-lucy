# SPEC 191 执行层重载：Spec / Plan / 工单交叉审阅意见

| 项 | 内容 |
|---|---|
| 日期 | 2026-10-26 |
| 审阅对象 | `webui/docs/191-execution-runtime-reload-spec.md` |
| 实施计划 | `webui/docs/plans/wo-20261027-ktx-execution-runtime-reload.md` |
| 关联材料 | `inbox/2026-10-26-ktx-config-hot-reload-options.md`、`inbox/2026-10-26-ktx-config-restart-only-investigation.md`（过程性材料，未入版本库） |
| 审阅结论 | **认可问题定义和总体方向；当前版本不建议直接开工，需修订后复审** |
| 审阅方式 | 文档交叉核对，并对照现有 entrypoint、运行时状态、探针、MCP Proxy、鉴权和 Helm 健康检查实现 |

> 审阅时未找到 SPEC 191 对应的独立正式工单文件。本文将上述实施计划中的任务拆分、验收和门禁一并视为工单内容审阅；若另有正式工单，仍需补充核对其覆盖情况。

> **后续事实（2026-10-27）**：该实施计划已移入正式位置 `webui/docs/plans/wo-20261027-ktx-execution-runtime-reload.md`，
> 并按本文 §5 的 8 项批准条件修订为 Step 0–8 + AC→任务→测试文件映射矩阵。本文的审阅判断与要求保持原样，未作改写。

## 1. 总体判断

SPEC 191 对根因、影响边界和首版触发方式的判断基本合理，只重载 KTX daemon 也是符合当前上游约束的最小技术方向。

但现版存在三个阻断问题：

1. “先终止旧 daemon、再启动新 daemon”无法实现“启动失败仍保留旧 daemon”。
2. supervisor 改造尚未定义完整的 PID、信号和退出码生命周期，可能破坏所有容器启动与优雅退出路径。
3. 现有探针和 observation 机制不能支撑“新配置已验证加载”以及“重载后立即从 stale 变为 ok”的验收结论。

此外，不同 digest 的并发请求、MCP 会话语义、owner-only 鉴权、写路径接入和验收映射仍需补齐。

## 2. 认同意见

### 2.1 认同根因和 stale 边界划分

SPEC 将连接、凭据、`enabled_tables` 等连接级配置，与语义层、Wiki 等内容级资产分开处理，避免把所有保存操作都纳入 daemon 重载。该范围控制合理，也与排查记录中的 KTX 读取路径一致。

依据：

- `webui/docs/191-execution-runtime-reload-spec.md` §1.1。
- `inbox/2026-10-26-ktx-config-restart-only-investigation.md` §4（过程性材料，未入版本库）。

### 2.2 认同只重载 KTX daemon 的总体方向

不修改 KTX 源码、不重启 Pod、不重启 WebUI，是现阶段符合上游依赖边界且爆炸半径相对可控的方案。引入 supervisor 的方向本身可以接受；需要修订的是具体进程和失败语义，而不是推翻整个方向。

### 2.3 认同首版由用户确认触发

重载会产生短暂不可用窗口。首版由用户显式确认，比写盘后自动重启更可控，也便于归因和审计。

同时，“重新检测执行层”与“重载执行层”分别表达只读检测和进程重载，动作边界清晰，应保留。

### 2.4 认同不自动回滚 `ktx.yaml`

配置已落盘并经用户确认，失败时自动回滚会引入另一套配置一致性和审计问题。应保留“不自动回滚配置”的决策。

需要修改的是“旧 daemon 仍可用”的承诺，而不是“不回滚 `ktx.yaml`”。

### 2.5 认同以新连接可见作为加载证据

AC-2 要求重载后 `connection_list` 包含重载前不存在的新连接，这是正确的业务结果验收。端口恢复、进程存在或 `tools/list` 成功，都不能替代配置加载证据。

### 2.6 认同可观测、可重试、审计和不支持时明确降级

`idle / pending / ok / failed`、失败可重试、成功失败均审计、无 supervisor 通道时返回 `unsupported`，都是必要的运维能力。请求与回执采用原子落盘也值得保留。

## 3. 反对意见及修改要求

### 3.1 阻断：失败时保留旧 daemon 与当前进程方案矛盾

当前设计为：

1. `kill -TERM KTX_PID`；
2. 等待旧进程退出；
3. 使用当前磁盘上的 `ktx.yaml` 启动新进程。

旧进程退出后，其内存配置和 MCP 会话已经消失。如果新配置导致启动失败，再用同一份新配置启动，也无法恢复旧运行状态。

因此以下要求不能同时成立：

- G4：失败保留旧 daemon；
- §3.3：先终止旧进程再重新拉起；
- AC-5：模拟新 daemon 起不来时，旧 daemon 仍可用；
- 决策：不回滚 `ktx.yaml`。

**建议首版采用：**

- 保留“不回滚配置”；
- 将失败承诺改为“有限重试、如实报告执行层不可用、允许修复配置后重试”；
- 删除“旧 daemon 仍可用”及 AC-5 的对应断言；
- 增加“失败后持续可用性不得伪报为 ok”的验收。

如果必须保证旧服务不中断，则需要蓝绿实例加端口或代理切换，或者暂存旧配置并在失败时恢复。这些方案均超出现有单进程模型和当前决策，应重新评审，而不是作为实现细节补入。

### 3.2 阻断：supervisor 的 PID、信号和退出码生命周期未闭合

现有 `scripts/runtime/docker-entrypoint.sh` 依赖父 shell 中的 `KTX_PID`、`LUCY_PID`、`wait -n` 和 `shutdown` 管理两个子进程。

计划改为 `supervise_ktx &` 后：

- KTX 成为后台 supervisor subshell 的子进程；
- supervisor 内更新的 `KTX_PID` 不会自动回传父 shell；
- 父 shell 若继续等待原 `KTX_PID`，无法正确感知 daemon 或 supervisor 生命周期；
- 容器收到 SIGTERM 时，可能只终止 supervisor 而遗留当前 KTX 子进程；
- 首次启动失败、daemon 自动退出和退避重试可能改变 WebUI 启动及容器退出码。

**开工前必须明确：**

1. 父 shell 持有并等待 `SUPERVISOR_PID` 的方式；
2. 当前 KTX PID 的归属和清理责任；
3. TERM / INT / EXIT 的信号转发顺序；
4. supervisor 退出但 KTX 仍存活时的清理方式；
5. 首次启动失败是否阻止 WebUI 启动；
6. KTX 自发退出是否触发容器退出或有限重启；
7. 重启退避上限和最终失败行为；
8. 原 `wait -n` 退出码语义如何逐项保持。

验证不能只有 `bash -n` 和重载冒烟，必须包含真实 SIGTERM、子进程退出、端口未就绪及无遗留进程测试。

### 3.3 阻断：探针不能证明目标配置已加载

`webui/server/admin/mcp-runtime.ts` 的 `probeExecutionRuntime()` 只执行 initialize、initialized 和 `tools/list`。现有 canary 文案也明确说明：KTX 可达不证明连接已加载。

因此，计划中的 `probeStatus=reachable` 只能证明进程和 MCP 工具面可达，不能满足：

- G2：执行层读到最新配置且有可验证证据；
- AC-2：新连接已进入执行层名单。

**建议将结果拆成两个正交字段：**

- `reloadStatus`：daemon 是否完成重启；
- `configVerification`：目标 digest 是否通过连接级证据验证。

配置验证应使用 `connection_list`、受控只读查询或其他明确的连接级证据，并记录验证时的 digest。不能用端口或 `tools/list` 替代。

如果 daemon 重启成功但连接级验证失败，不应返回一个含义模糊的整体 `status=ok`。

### 3.4 阻断：清空 observation 不会使状态直接变为 ok

当前 `webui/server/mcp-runtime-state.ts` 的 observation 以连接和配置 digest 为证据。重载后清空 observation，只会移除旧证据。

`readMcpRuntimeStatus()` 的汇总逻辑要求所有当前连接均有成功证据，才会返回 `ok`；没有证据时应为 `unknown`。因此：

- “重载成功后清空 observation”是合理的旧证据失效措施；
- 但它不能推出 AC-8 的“重载后立即从 stale 变为 ok”。

**建议二选一：**

1. 首版不自动执行连接级验证：AC-8 改为“重载后旧 stale 证据失效，状态回到待确认；受控查询成功后再变为 ok”。
2. 首版提供自动连接级验证：验证成功后写入与当前 digest 对应的新证据，再允许状态变为 ok。

无论选择哪一种，都不得通过伪造 observation 或直接改状态来绕过证据要求。

### 3.5 高风险：按 digest 幂等不足以保护单文件通道

模块级 `Map<digest, requestId>` 只限制相同 digest 的在途请求。配置连续变化时，不同 digest 的请求仍可并发写入同一个：

- `.ktx-ui/ktx-reload.request`；
- `.ktx-ui/ktx-reload.result`。

可能产生请求覆盖、回执错配、旧请求加载新配置、重复重启等问题。

60 秒超时后直接清除 inflight 也有风险：Node 侧超时并不意味着 supervisor 已停止执行，此时再次触发可能与旧请求重叠。

**建议改为全局单在途重载，并定义完整协议：**

1. 请求包含 `requestId`、`requestedDigest`、`requestedAt`；
2. supervisor 串行消费；
3. 启动后重新读取并核对实际磁盘 digest；
4. 回执包含相同 requestId、实际 digest 和明确终态；
5. 迟到回执不得完成后续请求；
6. Node 超时后先查询通道真实状态，不得直接假定可再次重载；
7. 明确请求被取走前、取走后和回执超时后的恢复行为。

### 3.6 高风险：“MCP 会话全部存活”承诺过度

SPEC 的 NG3 已承认 daemon 重启会重建会话，但 G1、AC-3、AC-10 又要求会话全部存活、旧会话继续可用，语义不一致。

现有 Proxy 能在部分 buffered `tools/list` / `tools/call` 请求遇到 session 失效时重新握手并重试一次，但这表示“建立新上游会话并恢复调用”，不表示旧上游会话仍然存活，也不能自动覆盖所有流式请求和重载窗口内的网络失败。

**建议统一改为：**

> 客户端无需手动重连；重载完成后，受支持的 buffered 调用可通过 Proxy 自动建立新的上游会话。

AC-10 应验证这一行为，并明确 keepalive 开关、原生客户端 session header 和流式请求的边界，不应断言旧 MCP 会话未重建。

### 3.7 高风险：owner-only 不能由 `/api/admin/*` 前缀推定

当前全局 WebUI 鉴权 hook 主要保证请求来自已登录管理员；owner-only 需要显式调用 `requireOwner`。

因此，SPEC 和工单不能只写“沿用 `/api/admin/*` 既有鉴权面”。新增重载路由必须明确接入 `requireOwner`，并验证：

- 未登录返回 401；
- 非 owner 返回 403；
- owner 才能触发；
- open mode 的行为有明确决策和测试；
- 拒绝请求不得写重载请求文件或产生进程副作用。

### 3.8 高风险：实施工单未完整覆盖 SPEC

至少缺少以下任务或文件：

1. SPEC §3.4 的写路径返回 `executionRuntimePending=true`，没有对应服务端修改步骤；
2. `webui/src/lib/types.ts` 的 API 类型扩展未列入；
3. `webui/docs/00-product-terminology-standard.md` 的术语登记未明确列入；
4. `webui/docs/README.md` 的 SPEC 191 索引未列入；
5. 连接概览是否增加入口尚未形成决策，只在文档同步步骤中提出复核；
6. 未将 AC-1～AC-10 逐项映射到实现任务和测试文件；
7. AC-2、AC-3、AC-5、AC-8、AC-10 缺少可执行验证设计。

“不跑浏览器 E2E”可以遵守项目治理默认值，但不能因此省略进程级、API 级和 Proxy 会话恢复测试。

### 3.9 中风险：通道可用性检测不足

“PID 文件可写＋请求目录可写”只能证明文件系统可写，不能证明存在支持该协议且正在监听的 supervisor。

旧镜像、异常启动或 supervisor 已退出时，请求可能等待 60 秒后才失败，而不是按设计快速返回 `unsupported`。

建议增加带协议版本的 ready / heartbeat / capability 标记，并定义：

- supervisor 启动时如何发布能力；
- 正常退出时如何撤销；
- 进程崩溃后的陈旧标记如何识别；
- Lucy 启动时如何恢复 pending 状态和迟到回执。

### 3.10 中风险：现有 K8s 健康检查并未承接重载窗口

当前 Helm startup / readiness / liveness probe 都请求 WebUI `/api/health`。该接口即使 execution unavailable 也仍返回 HTTP 200，只是在响应体中报告 degraded。

因此，现有探针不会仅因 KTX daemon 短暂不可达而摘除 readiness，也不能声称已经完成“与 readinessProbe 协同”。

这可以是首版的有意选择，但应明确写出：

- 重载窗口内 Pod 仍就绪；
- WebUI 和 Proxy 仍接受请求；
- 上游调用可能短暂失败；
- 不依赖 K8s readiness 隐藏重载窗口。

若希望重载期间摘除流量，则属于另一项健康契约变更，需要单独设计和验证。

## 4. 对状态模型的补充建议

当前“待重载”和 `reload.state=pending` 容易混淆：

- “待重载”表示磁盘配置尚未被确认加载，是配置生效状态；
- `pending` 表示一次重载操作正在执行，是操作状态。

建议分开建模，例如：

- `activation`: `current | reload_required | unknown`；
- `reload.state`: `idle | running | succeeded | failed`；
- `verification`: `unverified | verifying | verified | failed`。

同时为 reload 状态保留 digest，避免旧 digest 的成功状态被展示为当前 digest 已生效。

## 5. 建议的批准条件

完成以下修订后再进入实现：

1. 删除“失败保留旧 daemon”，或重新提交能够满足该承诺的架构方案。
2. 补齐 supervisor 的 PID、信号、退出码、首次启动和失败恢复状态机。
3. 区分“进程重启成功”与“目标配置验证成功”，重写 G2、AC-2、AC-8。
4. 将重载改为全局串行协议，处理不同 digest、超时和迟到回执。
5. 将会话承诺改为“受支持调用自动恢复、无需手动重连”，并补充对应测试。
6. 显式接入 owner-only 鉴权。
7. 把写路径、前端类型、术语、索引和 AC 映射补进正式工单。
8. 明确通道能力握手及 K8s 重载窗口行为。

## 6. 建议的验收追踪矩阵

| 验收方向 | 最低证据 |
|---|---|
| daemon 重启 | 旧 PID 退出、新 PID 就绪、端口恢复、requestId 回执匹配 |
| 新配置生效 | 新连接进入 `connection_list`，或目标连接受控只读查询成功 |
| WebUI / Proxy 存活 | 重载前后进程 PID 不变 |
| 客户端恢复 | 重载后受支持的 buffered 调用自动握手并成功，不要求客户端手动重连 |
| 并发 | 相同和不同 digest 均不会并发重启或错配回执 |
| 超时 | Node 超时后不错误发起第二次重载，迟到回执不污染新请求 |
| 失败 | 不伪报成功、不回滚配置、状态与审计准确；不得再断言旧 daemon 存活，除非架构已改变 |
| 不支持 | 无有效 supervisor 能力时返回 unsupported，且无文件和进程副作用 |
| 鉴权 | 未登录、非 owner、owner、open mode 均有明确结果 |
| 容器生命周期 | 启动失败、daemon 自发退出、SIGTERM、退出码和无遗留进程均通过 |
| 审计 | 成功、失败及约定内的拒绝/超时路径均符合审计契约 |

---

**最终意见：方向认可，当前方案暂缓批准；先修订 SPEC 与实施工单，再复审。**
