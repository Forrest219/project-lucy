# MCP 数据面执行舱壁与跨 Agent 故障隔离 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | MCP 数据面执行舱壁与跨 Agent 故障隔离 Spec |
| 文档类型 / 版本 | Spec（事故修复／可用性）／**v0.3** |
| 日期 / 目标版本 | 2026-11-24／产品线 `0.30.0`（`lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-82**／REQ-030-103／**P1（事故修复／可用性）**。**不入核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账 |
| 阶段 | S4 |
| 状态 | S4｜v0.3。终稿已确权（委托人 2026-11-24 明示）；开发授权已获得（2026-11-24）；实现已落地（四层容量协调器覆盖全部上游语义工具、真实结束后释放、聚合观测、热点扫描合并），单测与本机 Docker 前后对照已验证；**SC-06（流式体积上限／内存背压）未实现；委托人 2026-11-24 裁定移出本期出口、授权下期实现**，UAT-MCPHA-05 相应移出本期必做；本期出口＝SC-01–05／SC-07／SC-08 与 UAT-MCPHA-R0／01–04／06–08；待验收；测试台 NOT RUN（无正式 UAT 跑次）；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 需求来源 | [P1-75 增量压力跑次 `f5e4b14d`](../qa/uat/suites/interactive-read-resilience/runs/2026-11-24-codex-f5e4b14d-pressure.md)；当前 `webui/server/index.ts`、`webui/server/proxy/mcp-proxy.ts`、`webui/server/security/store.ts` 架构探查 |
| 实施主体 | Lucy。首阶段不改 KTX 源码，不改变 Agent／Role／Token 的数据权限语义 |
| 配对计划 | [`docs/plans/lucy-20261124-mcp-data-plane-isolation-ha-plan.md`](../plans/lucy-20261124-mcp-data-plane-isolation-ha-plan.md) |
| 测试台 | [`UAT-SUITE-MCP-DATA-PLANE-HA`](../qa/uat/suites/mcp-data-plane-ha/suite.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.3-r2 | 2026-11-24 指针：公共首页／静态公开接口在混压下不被饿死的同进程合同，已另立 [P1-84／REQ-030-105](lucy-20261124-public-entry-static-isolation-spec.md)（承接 §9 B1 控制面入口差集；**不分进程**）。本条范围、状态与出口不变 |
| v0.3 | 2026-11-24 范围裁定（委托人明示）：**SC-06（流式体积上限／全局内存背压）移出本期出口，授权下期实现**；`UAT-MCPHA-05` 移出本期必做，随下期 SC-06 验收。本期出口相应修订（§闭口层级）；§2.1 第 5 条与 SC 表同步标注。不改运行代码；状态行与总账镜像同步 |
| v0.2 | 2026-11-24 **终稿确权＋开发授权（委托人明示）并实现**：容量默认值 Token 4／Agent 8／连接 16／全局 24（满足 `agent < connection <= global`，`LUCY_MCP_*_MAX_INFLIGHT` 可覆盖，非法顺序自动修正并告警）；拒绝立即返回并带 `capacityScope`／`retryAfterMs`；首期无等待队列（OQ-2）；租约在真实上游工作结束后释放。**SC-06 未实现**（OQ-3 单响应上限与全局内存背压）。另落地展示扫描合并与公平调度、覆盖层缓存（P1-75 根因侧，根因见 `f5e4b14d`）。UAT 仍 NOT RUN |
| v0.3-r1 | 2026-11-24 评审反馈修订（实现与证据已落地）：①**Token 上限覆盖全部上游语义工具**，含 `lucy_read_source`（Docker 实测 60 并发单 Token：33 次 `scope=token` 拒绝）；②**上游硬截止**新增 `LUCY_PROXY_UPSTREAM_HARD_DEADLINE_MS`（默认 90 秒，POST 专用），与空闲超时 30 秒、问数预算 `QUESTION_BUDGET_ABS_EXEC_MS` 120 秒并存，取代客户现场 613 秒无界等待；③**客户端断连不提前释放**：KTX 不取消已发出的 DB 语句，故上游已发起而客户端先离开时，租约额外持有 `LUCY_MCP_CANCEL_HOLD_MS`（默认 30 秒）；Docker 实测断连后租约保持 31.2 秒（修复前 1.3 秒即释放，而 DB 语句 9.2 秒才结束）；④**配额冻结 4／8／16／24**：2 CPU／2 GiB 实测 4／8／12／16／24／32 并发真语义查询均无挂死，CPU 在约 8 并发饱和、吞吐持平、内存（约 50 MiB／并发查询）为约束，p95 在 24 并发 14 s、32 并发 18 s；多 Token 绕 Agent 限额被拦（12 并发拒绝 4，scope=agent）；⑤`/api/health` 增 `mcpCapacity` 聚合摘要。证据 `inbox/p181-p182-docker-verify/p182-semantic-capacity-ladder.json`。**残余**：Docker `HEALTHCHECK`（`ktx admin runtime status` 等）在 16 并发真查询饱和时超 10 秒致容器转 unhealthy（空闲 0.8 秒，负载结束即恢复），待委托人裁定（轻量探针或加大超时）；SC-06 仍移下期；UAT 仍 NOT RUN |
| v0.2-r1 | 2026-11-24 指针（P1-75 v1.4）：SC-04 与「WebUI 局部展示读 503」场景中的 503 构造，在 P1-75 [附录 A](lucy-20261123-interactive-read-resilience-spec.md) 对应修订实现后，须收窄为指定的 WebUI 局部展示故障：只注入 A 类展示读故障（08-B 的 D 作用域或 P／C 作用域核验扣留、`sources` 构建扣留），结果为 `stale`／`pending` 降级 200；**不含** B 类排空与重载、C 类审计或安全存储故障（这些本身可合法阻断 MCP）。本条范围、状态与验收不变，已实现部分不受影响。 |
| v0.1-draft | 2026-11-24 初稿。登记当前单实例内的多层执行舱壁、跨 Agent 隔离和后续高可用演进门槛；终稿未确权、开发未授权 |

## 闭口层级

- 层级：功能合同
- 本条承诺：在当前单实例、单副本拓扑内，单个 Agent 不得跨 Token／Session 耗尽全部 MCP 执行容量；全局与分连接过载必须有界、可观测、可恢复。WebUI 局部展示读 503 不得被放大为所有 Agent 的问数中断；容量受限的合法调用仍有明确重试路径。
- 本条出口：SC-01–05、SC-07、SC-08、实现审查，以及同一最终候选上的 `UAT-MCPHA-R0／01–04／06–08` 必做跑次。**SC-06／`UAT-MCPHA-05` 经委托人 2026-11-24 裁定移出本期出口，授权下期实现**（v0.3 修订）。
- 不在本条出口：审计写入进程拆分、WebUI 与 MCP Proxy 进程拆分、KTX worker 池、零停机配置重载、多副本／多写者、外置数据库迁移、K8s 或客户拓扑变更。后续阶段只登记准入条件，须另立 Spec 并单独授权。
- 上线关系：本条收口不表示可上线；本条不证明进程级 HA、节点级 HA 或客户环境可用性。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None。继续复用 `query_concurrency_exceeded`、`source_timeout`、`upstream_unavailable` 及既有审计事实，不新增用户可见错误码。
- `capacityScope`、`retryAfterMs`、`executionOutcome=indeterminate` 仅为工程与审计字段草案，不进入 WebUI 文案；字段定稿前须复核术语标准，禁止另造同义拒绝码。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面。本条只调整 MCP 执行准入、资源生命周期和只读运行观测。
- 不改变：页面、导航、组件、按钮、用户可见文案及现有错误提示布局。`UAT-MCPHA-03` 对既有页面的观察仍按 Plan 的浏览器计时要求执行。

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 单个 Agent 多 Token／Session 可占满共享执行资源，其他 Agent 同步超时；过载时只能长时间等待 | 超额调用在预算内收到可重试繁忙，其他 Agent 按配额继续；合法重试不重复执行已不确定的查询 | **P1·问数面 ↓／P1·报告面 ＝** | SC-02／03／04／05／08 | 过载调用保留原会话与目录能力，按 `retryAfterMs` 加抖动重试同一问题；不自动重放 `indeterminate`。纯 MCP 可达，挂 SC-02／05／08。该 ↓ 是限制单 Agent 过度占用所需代价，不得以全局不可用代替补偿 |
| P2 治理方 | 无需管理执行容量，故障时难以区分权限配置与资源过载 | 既有 Role／Agent／Token 配置路径不变；审计能区分容量拒绝与权限拒绝 | ＝ | SC-07／08 | — |
| P3 运维方 | TCP 与 `readyz` 可全绿但真实问数失败；缺少容量作用域和真实释放证据 | 能按 Agent／Token／连接／全局观察占用、拒绝、取消与释放，故障注入可复查 | ↑ | SC-01／05／06／07／08 | — |
| P4 管理层 | 可用性叙事无法区分单 Agent 过载与平台级故障 | 可用性报告保留各身份成功率、拒绝原因和恢复证据，业务口径不变 | ＝ | SC-07／08 | — |

## 1. 已核实事实与归因边界

| 事实 | 证据 | 本条如何处理 |
|---|---|---|
| WebUI 与 MCP Proxy 在同一 Node.js 进程内监听 | `webui/server/index.ts` 的 `startServer()` | 首阶段不宣称消除进程级共同故障；只约束执行容量和局部错误扩散 |
| `lucy_query` 现有限流键是 Agent＋Token，默认每键 4；不是整个 Agent 跨 Token／Session 的总限额 | `webui/server/proxy/mcp-proxy.ts` 的 `queryConcurrencyKey()` | 新协调器增加 Agent 汇总、连接与全局维度，并覆盖上游语义执行工具全集 |
| 查询槽位随下游 response `finish/close` 释放，与真实上游结束不总是同一时刻 | `releaseOnResponseEnd()`、`bindQuestionBudgetSettlement()` | 容量租约与真实上游 `close`／最终截止对齐，断连只发起取消，不提前归还 |
| 安全账本为准入和响应提交提供持久化屏障，底层为同步 SQLite 事务 | `webui/server/security/store.ts`、`webui/server/security/ledger.ts` | 首阶段保持 fail-closed，不改写审计语义；主线程隔离归后续阶段 |
| 上游响应先完整缓冲，响应门的字节上限在后续发送阶段生效 | `readUpstreamBody()`、`ResponseGate` | 在读取上游流时提前执行字节与总内存背压 |
| 既有混压中 Web 展示读 503、独立 MCP 查询 30 秒截止与 `readyz=200` 共存 | [`f5e4b14d` 跑次](../qa/uat/suites/interactive-read-resilience/runs/2026-11-24-codex-f5e4b14d-pressure.md) | 作为改前反例，不把相关性写成 WebUI 导致 MCP 失败的单向因果 |
| K8s 当前为单副本，且会话、撤权、预算等状态含进程内部分 | `deploy/k8s/helm/lucy/`、`upstream-session.ts`、`authorization-barrier.ts` | 禁止把 `replicaCount=2` 当作本条实现；多副本另立架构与发布取证合同 |

KTX 内部会话调度和各数据库驱动的真实连接池上限未在本轮源码核验。首阶段不得假设“慢查询必然串行”或“驱动一定无限连接”；以实际在途、数据库 PROCESSLIST／等价证据和资源峰值冻结容量值。

## 2. 需求摘要

### 2.1 功能需求

1. 建立 Agent（跨全部 Token／Session）、Token／Session、connectionId、全局四层执行容量。
2. 覆盖 `requestWouldHitUpstreamSemanticExecution()` 判定的全部上游语义工具，禁止只保护 `lucy_query` 而漏掉 `lucy_read_source` 等入口。
3. 容量不足时不启动上游工作，沿 MCP JSON-RPC 返回可重试繁忙，附作用域与重试建议；不得用无界队列掩盖过载。
4. 容量租约必须在真实上游工作终结后释放；取消、异常、响应丢失和最终截止均有确定结算。
5. 对上游响应实施流式字节上限与全局内存背压，禁止先完整读入再拒绝。（**SC-06：移下期实现**，委托人 2026-11-24 裁定）
6. 以真实多 Agent、多 Token、多连接和 WebUI 局部 503 场景验证“约束生效”与“其他合法用户仍可用”。

### 2.2 非功能需求

| 维度 | 要求 |
|---|---|
| 可用性 | 单 Agent 达配额不能转化为全局无界等待；过载后容量可回落，合法问数可恢复 |
| 性能 | 容量判定不得新增上游调用；既有 P1-37／P1-75 的正常路径预算不放宽，具体拒绝响应预算见 OQ-1 |
| 安全 | 不改变 ACL、Row Policy、Token 撤权与审计 fail-closed；不得借容量拒绝返回未提交内容或绕过 KTX 内部 Token 边界 |
| 兼容 | 保持 MCP Streamable HTTP／SSE 和现有客户端对 HTTP 200＋JSON-RPC 错误的处理；不把 Web API 的 429 作为唯一信号 |
| 可运维 | 记录获取、占用、拒绝、取消、真实释放、重试与恢复；不记录明文 Token、密码或查询敏感内容 |
| 部署 | 首阶段维持 Docker 单实例单副本；不修改 Helm、K8s、客户配置或 KTX 源码 |

## 3. 首阶段目标架构

```text
Agent A（多 Token／多 Session） ─┐
Agent B（同连接）               ─┼─► MCP Execution Capacity Coordinator
Agent C（其他连接）             ─┘    ├─ Agent 汇总配额
                                       ├─ Token／Session 配额
                                       ├─ connectionId 配额与公平性
                                       └─ 全局配额与内存背压
                                                  │
                          拒绝：不上游、快速繁忙   │ 接纳：带租约
                                                  ▼
                                      现有 MCP Proxy → KTX → 数据源
                                                  │
                                  真实上游 close／最终截止后归还
```

容量关系必须满足：

```text
effectiveAgentLimit < effectiveConnectionLimit <= effectiveGlobalLimit
```

该关系只保证单个 Agent 不能占尽连接或全局容量，不保证任意数量 Agent 都能同时成功。全局饱和时仍须快速拒绝；不得在测试中通过无限提高上限伪造余量。

## 4. 架构决策（ADR 草案）

| 编号 | 建议决策 | 理由 | 代价与替代方案 |
|---|---|---|---|
| D1 | 新建独立执行容量协调器，不继续把逻辑堆进 `mcp-proxy.ts` | 统一四层配额、真实生命周期和指标 | 增加一个运行时模块；替代方案是继续分散计数，已证明会漏工具与跨 Token 汇总 |
| D2 | Agent／Token／连接／全局四层，Agent 限额严格小于连接限额 | 防止单 Agent 跨凭证绕过，并给同连接其他 Agent 留容量 | 全局满载仍会拒绝；不能承诺无限租户公平 |
| D3 | 以上游语义执行判定为纳管事实源 | 防止新增工具绕过 | 新工具若分类错误也会被漏管，须加分类覆盖测试 |
| D4 | 复用 `query_concurrency_exceeded`，增加 `capacityScope` 与 `retryAfterMs` | 保留客户端兼容并区分拒绝来源 | 字段语义需终审；替代的新错误码会破坏既有客户端分类 |
| D5 | 首期不新增等待队列，超过容量即拒绝 | 避免长尾、内存膨胀与不可证明的恢复时间 | 峰值时更多调用需重试；短公平队列只能在另批数据支持后引入 |
| D6 | 租约随真实上游结束或最终截止释放，断连不直接释放 | 防止取消未确认时新旧执行叠加 | 取消未确认期间容量占用更久，需要明确截止与运维证据 |
| D7 | 响应上限在上游读取流上提前执行 | 防止先消耗内存再拒绝 | 大结果会更早失败；客户端须使用有界 `lucy_query`，不能依赖整源大包 |
| D8 | 后续先拆 MCP 数据面，控制面保持单写者；KTX 池由 Lucy 路由，不改 KTX 源码 | 最小化多主一致性问题并隔离故障 | IPC、会话路由与运维复杂度增加；不允许直接加共享 RWO 卷副本 |
| D9 | 多副本前先解决强一致策略／预算／审计和 Session 漂移 | 防止可用性提升破坏权限与幂等 | 需要后续独立架构 Spec、存储决策与发布取证，不在本条交付 |

## 5. 核心流程（伪代码）

```text
on semantic_execution_request(identity, tool, args):
  subject = classify_with_existing_acl(identity, tool, args)
  connectionId = resolve_connection_for_capacity(subject)
  scopes = [global, connectionId, agent(identity), tokenSession(identity)]

  decision = capacity.tryAcquire(scopes, { wait: false })
  if !decision.allowed:
    audit_capacity_rejected(decision.firstFullScope)
    return mcp_isError(
      reason: "query_concurrency_exceeded",
      capacityScope: decision.firstFullScope,
      retryAfterMs: decision.retryAfterMs
    )

  lease = decision.lease
  outcome = INDETERMINATE
  try:
    assert_authorization_still_current()
    upstream = start_upstream_once(subject)
    outcome = await upstream.result_with_deadline()
    return outcome
  catch error:
    outcome = classify(error)
    throw error
  finally:
    // response finish/close 只代表下游传输，不代表数据库工作已停止
    after upstream.close OR terminal_execution_deadline:
      lease.release()
      metrics.record_real_settlement(outcome)
    // 已发出但结果未知的调用不得由 Proxy 或客户端自动重放
```

## 6. 多步状态机合同

| 状态 | 合法进入 | 合法退出 | 持久化／恢复要求 |
|---|---|---|---|
| `IDLE` | 新请求 | `CAPACITY_CHECK` | 不持有租约 |
| `CAPACITY_CHECK` | 完成既有身份与 ACL 判定 | `REJECTED_BUSY`／`UPSTREAM_ACTIVE` | 拒绝不得启动上游；审计容量作用域 |
| `REJECTED_BUSY` | 任一容量层已满 | 终态 | 可重试，不属于权限拒绝或执行成功 |
| `UPSTREAM_ACTIVE` | 租约获取成功且授权仍有效 | `CANCEL_PENDING`／`RESPONSE_COMMITTING`／`FAILED`／`INDETERMINATE` | 只启动一次上游；记录 operation／attempt 关联 |
| `CANCEL_PENDING` | 客户端断连、撤权或截止 | `RESPONSE_COMMITTING`／`FAILED`／`INDETERMINATE` | 租约仍持有，直到真实 close 或最终截止 |
| `RESPONSE_COMMITTING` | 上游已形成结果 | `SUCCEEDED`／`FAILED` | 既有 `response_prepared` 成功后才可发内容 |
| `SUCCEEDED` | 已提交并按既有规则交付 | 终态 | 租约释放与审计终态可关联 |
| `FAILED` | 明确失败且未交付业务内容 | 终态 | 释放租约，保留失败分类 |
| `INDETERMINATE` | 已发起执行但结果无法确认 | 终态（非成功） | 禁止自动重放；保留人工核查入口与审计事实 |

禁止转移：`CAPACITY_CHECK → SUCCEEDED`、下游 `close → IDLE`（上游未终结时）、`INDETERMINATE → 自动重试 → SUCCEEDED`。进程重启后不得把旧在途请求当作未执行；按既有恢复合同标为中断或不确定。

## 7. 故障语义

| 场景 | 必须行为 | 不得行为 |
|---|---|---|
| 单 Agent 达配额 | 仅该 Agent 超额调用快速繁忙；其他 Agent 按剩余容量继续 | 用更多 Token／Session 绕过同一 Agent 限额 |
| 同连接繁忙 | 单 Agent 不得占尽连接；同连接其他 Agent 有有限容量，连接整体饱和时快速拒绝 | 无界等待或让故障扩散到其他 connectionId |
| WebUI 局部展示读 503 | 保留独立 MCP 合法问数；记录两类错误各自时间线 | 把局部展示错误直接等同于 KTX 不可用；本条也不承诺 WebUI 进程崩溃时 MCP 仍存活 |
| 客户端断连 | 发起真实取消，保持租约至真实结束或最终截止 | 立即归还并允许无限新查询叠加 |
| 执行结果不确定 | 返回／记录不确定，要求核查后显式重试 | 自动重放可能已执行的查询 |
| 审计存储不可用 | 沿既有 fail-closed 快速失败，恢复后不重复执行 | 绕过审计屏障释放内容 |
| KTX／数据库不可用 | 按 connectionId 熔断与超时，其他连接继续；同连接真实故障不可能被伪装成成功 | 用 TCP 可连或 HTTP 200 证明真实问数健康 |

## 8. 验收（SC）

| ID | 合同 | 对应 UAT |
|---|---|---|
| SC-01 | 候选、镜像、KTX、资源、全局规模夹具、独立 SQL 核对值和故障注入点均可复核；改前／改后使用同一分母，未命中目标故障不得判通过 | UAT-MCPHA-R0 |
| SC-02 | 同一 Agent 使用基线内多个 Token 与多个 Session，混合调用上游语义工具后仍受 Agent 总限额约束；超额调用在 OQ-1 预算内返回带作用域的繁忙，其他两个 Agent 合法查询正确 | UAT-MCPHA-01 |
| SC-03 | 满足 `agent < connection <= global`；A 占满自身配额不能占尽连接或全局，B 在同连接获得有限成交，C 在其他连接继续；连接整体饱和与全局饱和均快速拒绝且无上游新工作 | UAT-MCPHA-02 |
| SC-04 | 真实构造 WebUI 局部展示读 503，前台浏览器记录导航→错误可见／恢复可见计时，与 API 分列；同窗两个独立 MCP Agent 在既有预算内完成正确查询。该断言不覆盖 WebUI 进程崩溃 | UAT-MCPHA-03 |
| SC-05 | 在取消、断连、撤权、上游异常与最终截止场景，租约只在真实结束或最终截止后释放；至少 10 轮后占用归零。已发起但结果不确定的调用零自动重放 | UAT-MCPHA-04 |
| SC-06 | 超过上游单响应上限或全局内存背压时，在读取流越过允许上界前停止，不能先完整缓冲再拒绝；其他 Agent 的合法小查询继续，审计不包含敏感结果正文 | UAT-MCPHA-05（移下期，委托人 2026-11-24 裁定） |
| SC-07 | 观测能区分容量拒绝、权限拒绝、上游失败、审计失败与 `indeterminate`，并关联获取／拒绝／取消／真实释放；TCP 200 不得冒充真实问数健康，证据不含明文凭据 | UAT-MCPHA-06 |
| SC-08 | 同一最终候选通过混压、撤压恢复、权限与审计守恒检查：约束生效时合法用户仍可成交，容量在真实工作结束后回落，无跨连接扩散、无未提交内容、无重复不确定执行。全部必做 UAT 有真实跑次 | UAT-MCPHA-07／08 |

## 9. 后续高可用演进（不在本条出口）

| 阶段 | 候选架构 | 准入前置 | 必须另证的风险 |
|---|---|---|---|
| B1：审计与进程故障域隔离 | 独立单写者 audit writer；WebUI 控制面与 MCP 数据面分进程；配置只读已提交版本 | 本条 SC 全部通过；新 Spec 明确 IPC、持久化屏障、撤权传播与恢复 | 审计不可用仍 fail-closed；不得把同步写入改成 best-effort；WebUI 进程死亡不得拖垮 MCP |
| B2：KTX worker 池与无中断重载 | Lucy 路由管理多个不同端口 KTX worker；Session 粘滞；新版本启动、canary、切流、旧版本排空 | B1 已收口；KTX 配置读取与本地状态边界已核实 | worker 故障只影响绑定 Session；不确定执行不重放；配置失败可切回旧版本 |
| C：MCP 数据面多副本 | 2+ MCP Gateway、独立 LB 健康检查、KTX worker 池；控制面单写者或主备 | B2 已收口；存储与权限架构另获批准；另立发布取证 Spec | 强一致 Token／Role／预算／撤权／审计；Session 漂移；后台任务单例；不得共享 RWO SQLite 多写 |

阶段 C 不得以“进程无状态”为由忽略 `Mcp-Session-Id`、授权发送屏障和不确定执行。故障切换只恢复协议会话，不能推定原查询未执行。

## 10. 开放项

| ID | 问题 | 草案默认／裁定要求 |
|---|---|---|
| OQ-1 | 容量拒绝响应预算与各层上限 | 拒绝判定不发起上游，默认在 1 秒内返回；真实上限由全局规模基线压测冻结，保留 `agent < connection <= global`，不得只提高数值凑通过 |
| OQ-2 | 是否需要短公平队列 | 首期不新增等待队列；只有证明快速拒绝导致合法主路径无法成交时才另审短队列及等待截止 |
| OQ-3 | 单响应与全局内存上限 | 单响应默认与既有 8 MiB 门对齐，全局值按容器内存与并发实测冻结；上游流必须提前截断 |
| OQ-4 | 重试与幂等 | 容量繁忙可指数退避加抖动；`indeterminate` 禁止自动重放，须以 operation／attempt 证据人工或宿主显式确认 |
| OQ-5 | 与现有每 Token 4 的关系 | 现有值作为 Token／Session 上限的初始候选，不作为整个 Agent 或全局默认值；最终数值须由基准证据支持 |

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 舱壁过严使合法高峰频繁失败 | 以全局规模夹具校准；同时验超额拒绝和其他 Agent 成交；提供有界重试，不放宽为无限等待 |
| 舱壁过松仍被跨 Token／Session 穿透 | Agent 汇总维度与工具全集强制覆盖；用多 Token、多 Session 和混合工具对抗 |
| 真实取消与数据库结束不同步 | 保留 `CANCEL_PENDING` 和最终截止；以上游 close／数据库证据为准，记录 `indeterminate` |
| 容量指标成为新的敏感信息面 | 仅记录身份 id、连接 id、容量与结果分类；不明文记录 Token、密码、查询正文或结果行 |
| 首阶段被误读为完整 HA | 非目标明确排除进程拆分、多副本和客户拓扑；状态与 UAT 不据此声称进程／节点级高可用 |
| 后续多副本破坏权限与一致性 | B1／B2／C 分阶段另立 Spec；撤权、审计、预算、Session 与单写者边界未解决前禁止加副本 |
