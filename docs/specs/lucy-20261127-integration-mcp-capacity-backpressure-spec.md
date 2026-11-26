# 系统间 MCP 查数：容量保留、大明细背压与开发者水位 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 系统间 MCP 查数：容量保留、大明细背压与开发者水位 Spec |
| 文档类型 / 版本 | Spec（韧性／集成面）／**v1.0** |
| 日期 / 目标版本 | 2026-11-27／产品线 `0.35.0` 候选（待挑入 [`v0.35.0-scope.md`](../releases/v0.35.0-scope.md)） |
| 功能编号 / 优先级 | **REQ-0119**／**P1**。**不入核心分母** |
| 台账号 | 无。挂常青需求池 `REQ-0119` |
| 阶段 | S2 |
| 状态 | S2｜v1.0-r2。**终稿已确权**（委托人 2026-11-27 明示「授权 spec定稿」）；设计对抗 R1 已吸收；Plan／UAT 对抗 R1→R2（Kimi）**PASS WITH FIXES** 且 N-01～N-05 已吸收；**开发未授权**；实现未落地；测试台 [`UAT-SUITE-INTEGRATION-MCP-CAP`](../qa/uat/suites/integration-mcp-capacity/suite.md) **NOT RUN**；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 需求来源 | 委托人：Python／Java **系统间** MCP 查数（非对话 Agent 宿主），担心大明细堵死 MCP 致员工不可用。[设计稿](../plans/lucy-20261127-integration-mcp-capacity-backpressure-design.md)；[R1 对抗](../../inbox/20261127-req-0119-adversarial-r1.md) |
| 实施主体 | Lucy MCP Proxy／容量协调器／Agent 管控面；不改 KTX 源码；本轮不拆 WebUI↔MCP 进程 |
| 配对计划 | [`docs/plans/lucy-20261127-integration-mcp-capacity-backpressure-plan.md`](../plans/lucy-20261127-integration-mcp-capacity-backpressure-plan.md) |
| 测试台 | [`UAT-SUITE-INTEGRATION-MCP-CAP`](../qa/uat/suites/integration-mcp-capacity/suite.md) |
| 评审 | [过程对抗归档](../reviews/2026-11-27-req-0119-integration-mcp-adversarial-review.md)（设计 R1；Plan／UAT 对抗见同文件后续节） |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 2026-11-27 **定稿**。吸收设计 R1（Kimi）B-01～B-06／M／OQ；委托人明示 Spec 定稿；裁定 SC-06 由本条承接实现（覆盖 P1-82「移下期」出口划分，见「与既有 Spec 的关系」）。开发未授权。 |
| v1.0-r1 | 2026-11-27 Plan／UAT 对抗 R1（Kimi）处置：OQ-global **维持 24** 书面裁定；SC-06／OQ-5 显式覆盖 `pipeResponse` 裸管道；SC-10 补 interactive 代理告警；WebUI 枚举本轮不做（IMC-09=N/A）；SC-07 要求 UAT 核 SC-06 预算结算。开发未授权。 |
| v1.0-r2 | 2026-11-27 Plan／UAT 对抗 R2 **PASS WITH FIXES**；吸收 N-01～N-05（无浏览器臂措辞、SSE 普查、IMC-06 证据挂链、Task 3 Files、版本标签对齐）。开发未授权。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：在 Docker 单实例同进程拓扑下，（1）`integration` Agent 不得占用 interactive 保留槽；（2）上游响应体（含握手与全部上游语义工具）实施流式字节上限与全局 in-flight 内存预算（**SC-06**）；（3）混压下 interactive 小查询在预注册通过线下仍成交；（4）交付 Python／Java MCP 接入与限流指引（非官方 SDK）。
- 本条出口：`SC-01`–`SC-12`；配对 UAT 必做项；开发者指引落盘。
- 不在本条出口：WebUI↔MCP 进程拆分、KTX worker 池、多副本、零停机升级、官方 PyPI／Maven SDK、REST `lucy_query`、改变 ACL／行权限语义。
- 上线关系：本条收口不表示可上线；不证明进程级 HA。

## 与既有 Spec 的关系

| 既有 | 关系 |
|---|---|
| [P1-82／REQ-030-103](lucy-20261124-mcp-data-plane-isolation-ha-spec.md) | **继承**四层容量与立即拒绝语义。本条**增量**：workload 维（integration 可借槽）、`workloadClass`、**承接并实现 SC-06**（P1-82 v0.3 曾移下期；**委托人 2026-11-27 裁定由 REQ-0119 实现**；P1-82 状态行／UAT-MCPHA-05 改为「由 REQ-0119 验收」指针，不重开 P1-82 开发出口）。 |
| [P1-78／REQ-030-099](lucy-20261123-mcp-inquiry-performance-baseline-spec.md) | 复用测程／哨兵方法；本条不替代问询性能基线合同。 |
| [P1-74 问询预算](lucy-20261122-question-budget-mainpath-escape-spec.md) | 容量／体量拒绝**不**冒充预算耗尽；是否扣减预算见 OQ-3 裁定。 |
| [P1-84 公共入口](lucy-20261124-public-entry-static-isolation-spec.md) | 同进程；本条不改公共入口合同。 |

## Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- 用户可见：不新增中文产品词。错误继续复用 `query_concurrency_exceeded`；体量拒绝使用机读 reason（工程字段，如 `response_too_large`），不进 WebUI 文案表除非另登术语。
- 工程字段：`workloadClass`（`interactive`｜`integration`）、`capacityScope` 可增 `workload`、`retryAfterMs`、保留槽相关 `_meta.lucy`（定稿前复核术语标准）。

## 交互合同豁免

- 原因：主交付为 MCP 数据面与 Admin 配置字段；若 WebUI Agent 编辑增加 `workloadClass` 控件，交互增量限于 Agent 编辑页一个枚举字段，基准页仍为 `/admin/agents`，不改导航 IA。
- 纯 MCP／指引文档不强制浏览器。**本轮裁定：WebUI Agent 编辑枚举不做**（仅 OpenAPI／存储）；UAT-IMC-09＝**N/A**（以 IMC-01 为据）。

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向补偿 |
|---|---|---|---|---|---|
| P1 问数方（员工 interactive） | 系统间大明细可占满 global／整包缓冲拖死 MCP | 保留槽＋SC-06 下小查询仍可成交 | ↑ | SC-04／SC-05／SC-08 | — |
| P1 问数方（系统集成） | 无明确水位与体量硬顶 | 高峰／超限更多拒绝 | ↓ | SC-03／SC-06／SC-11 | 机读 scope／`retryAfterMs`、分页指引、独立 Agent、可配更高但有顶配额（SC-11） |
| P2 治理方 | 无 workload 标记 | Agent 可标 `workloadClass`；ACL 语义不变 | ＝／↑（可运维） | SC-01／SC-02 | — |
| P3 运维方 | 缺 integration 拒绝聚合与水位 | health／容量摘要可观测；有打标 SOP | ↑ | SC-10／SC-12 | — |
| P4 管理层 | 系统调用拖垮全员风险未合同化 | 有合同与 UAT 套件，仍单实例 | ＝ | 闭口层级 | — |

## 第一性原理检查（主路径可用性优先）

- 约束生效：integration 可借槽打满立即拒绝；大响应流式触顶中止。
- 合法用户仍可用：interactive 在预注册通过线下成交（SC-08）；纯 MCP 员工路径不依赖 WebUI。
- 不把「全面拒绝数据面」当作入口绿。

## 1. 已核实事实

| 事实 | 证据 |
|---|---|
| 四层容量无 workload 维 | `webui/server/runtime/mcp-execution-capacity.ts` |
| 上游 `readUpstreamBody` 无流式上限；`MAX_BODY_BYTES` 只管入站请求 | `mcp-proxy.ts` |
| `LUCY_QUERY_DEFAULT_LIMIT`／`MAX_LIMIT` 已存在 | `mcp-proxy.ts` |
| `CANCEL_HOLD` 默认 30s | `mcp-proxy.ts` |
| 全仓无 `workloadClass` | grep 零命中 |
| 2C2Gi 约 8 并发 CPU 饱和、~50MiB／查询 | P1-82 v0.3-r1 |

## 2. 需求摘要

### 2.1 功能需求

1. Agent 持久化 `workloadClass`：`interactive`｜`integration`；Admin OpenAPI＋存储＋审计；热更新语义见 §4.4。
2. 容量：在既有 token→agent→connection→global 上增加 **workload（integration）** 前置：`integration` 在途合计 ≤ `global − R`（`R`＝interactive 保留）。立即拒绝，不排队。
3. **SC-06**：所有上游 HTTP 响应体读取（initialize／initialized／全部上游语义工具）边读边计；单响应上限＋全局 in-flight 缓冲预算；越限中止并机读失败；禁止先完整缓冲再拒。
4. 行数轨与字节轨并存：既有 query limit 与 SC-06 同时生效；触顶顺序在 Spec 伪代码钉死。
5. 压测 T1–T5 出水位表；开发者指引（Python／Java 最小示例，非官方 SDK）。
6. `/api/health`（或既有 `mcpCapacity`）暴露 integration／workload 拒绝聚合与 reserved 占用摘要（无敏感正文）。

### 2.2 非功能

| 维 | 要求 |
|---|---|
| 可用性 | integration 过载不得转化为 interactive 无界失败；停压后在 hold 宽限外容量可回落 |
| 性能 | 准入判定不新增上游调用；A3／SC-08 绑定时延分母 |
| 安全 | 不改 ACL／Row Policy；拒绝不泄露 Token／结果正文 |
| 兼容 | MCP HTTP 200＋JSON-RPC `isError`；不强制 HTTP 429 |
| 部署 | 单实例 Docker；不改 Helm 多副本假设 |

## 3. OQ 裁定记录（终稿确权一并闭合）

| ID | 裁定（委托人 2026-11-27 Spec 定稿授权下的程序性闭合） |
|---|---|
| OQ-1 打标责任 | Admin（治理方）经 OpenAPI／Agent 编辑设置 `workloadClass`；变更写审计。系统间 Token 发放前必须为 `integration`（SOP＋指引强制；UAT-IMC-02）。 |
| OQ-2 存量默认 | 迁移／缺省字段＝`interactive`（兼容员工）。漏打标残余风险由 SOP＋**SC-10 代理告警**（interactive Agent 持续高并发或大响应触顶计数）承担，**不**把未打标自动改成 integration。 |
| OQ-3 预算扣减 | 容量拒绝（未启动上游）**不**扣问询预算 busy／calls；SC-06 中止（上游已开始）**按既有 upstream 失败规则**结算预算（与 P1-74 一致，不另开扣减）。 |
| OQ-4 拆进程压测 | 本条出口不含；收口后另场隔离环境对照（设计 §8）。环境默认对齐 2C2Gi 除非另裁。 |
| OQ-5 会话型工具体量 | `lucy_begin_question`／`lucy_continue_question`／`lucy_report_template`／`lucy_certified_route`／skills 读 **全部**走 SC-06 同一读取闸（含今日 `pipeResponse`／passthrough／skills passthrough 出口：须改为可计量中止，**禁止**无界 `pipe` 直灌作为合规路径）。分档硬顶可按工具类配置，默认共用两档字节顶。 |
| OQ-SC06 | **批准 SC-06 由本条实现并验收**（覆盖 P1-82「移下期」划分）。 |
| OQ-A3 预注册 | 成功率 ≥ max(95%, T1_success−2pp)；interactive p95 ≤ 1.5× T1 p95（同硬件档）；采样窗与 T2 并发在 Task 0 冻结后写入 Plan／UAT，**开跑前**登记，禁止事后改通过线。 |
| OQ-R | `R = ceil(global×0.5)` 为**待校准假设**；对外水位表只公布 Task 0／T2 后冻结值；出厂 env 可保留假设但文档标注未校准。 |
| OQ-global | **已裁定（2026-11-27，随 Spec 定稿）**：出厂默认 **维持 `global=24`**（与 P1-82 已冻结配额一致），**不**因 2C2Gi「约 8 并发 CPU 饱和」自动下调产品默认。可用性合同靠 **SC-08 时延分母**＋保留槽／borrow，而非假设 24 路皆为舒适时延。部署侧可用 env 下调。实现禁止偷偷改默认；另裁下调须新变更行。 |
| OQ-hold | T4／SC-09 判定：**停压后等待 ≥ `CANCEL_HOLD_MS`＋5s** 再测回落；reserved 槽上的 hold 租约计入占用（不豁免），水位表标注最坏回收时延。 |
| OQ-HEALTHCHECK | T2／T3 期间容器 HEALTHCHECK 假红：跑次记录但不单独判本条 FAIL；须在跑次注明；轻量探针改动**不在本条出口**（可另立）。 |

## 4. 核心行为

### 4.1 workloadClass

```text
Agent.workloadClass ∈ { interactive, integration }
缺省 / 存量迁移 → interactive
integration → 仅可占用「可借槽」；不可占用保留槽 R
interactive → 可占用保留槽；仍受 token/agent/connection/global 约束
```

### 4.2 容量代数（B-02 闭合）

```text
limits: token, agent, connection, global, reserveR
borrowMax = global - reserveR          # reserveR >= 1, borrowMax >= 1
assert agent < connection <= global
assert reserveR < global

tryAcquire(req):
  # 既有四层顺序不变
  check token / agent / connection / global as today
  if req.workloadClass == integration:
    if integrationActive >= borrowMax:
      reject scope=workload, retryAfterMs=...
  # interactive 不增加 integrationActive
  # 占用 global 时：integration 与 interactive 都计入 globalActive
```

多 Agent 的 integration 合计受 `borrowMax` 约束（闭合「3×agent 绕过」）。

### 4.3 SC-06 读取闸（B-03 闭合）

```text
readUpstreamBodyLimited(stream, caps):
  # 替换所有 readUpstreamBody 调用点（握手 + 工具）
  while chunk:
    total += len(chunk)
    globalInflight += len(chunk)
    if total > caps.perResponse OR globalInflight > caps.globalBudget:
      abort stream
      release partial buffers
      return error response_too_large / memory_pressure
  ...
finally: globalInflight -= accounted
```

入站 `MAX_BODY_BYTES` 保持；与 SC-06 正交。

### 4.4 热更新（M-06）

- 已发 Token：下次 admission 读 Agent 当前 class（撤权屏障后的已提交视图）。
- 在途租约：不改 class 归属计数维度直到 release；禁止中途把 interactive 租约「偷换」为占用 borrow。
- 打标错误回滚：改回 interactive 后新请求走 interactive 规则。

### 4.5 行数轨 vs 字节轨（M-04）

1. 请求参数 limit 钳制（既有 DEFAULT／MAX）  
2. 上游执行  
3. SC-06 字节／内存闸  
任一触顶即失败；不先缓冲完整结果再截断冒充成功。

## 5. 验收 SC

| ID | 条件 |
|---|---|
| SC-01 | Agent 可读写 `workloadClass`；OpenAPI 可见；审计留痕；缺省 interactive |
| SC-02 | 系统间 SOP：integration Agent＋Token；UAT 夹具含两类 Agent |
| SC-03 | 多 integration Agent 合计打满 borrowMax → `capacityScope=workload`（或等价机读）；立即拒绝；无新上游 |
| SC-04 | borrow 打满时 interactive 小查询仍成交（独立 SQL 核对） |
| SC-05 | T3 大响应：流式触顶；RSS／event-loop 不因整包缓冲假死；interactive 仍成交 |
| SC-06 | 上游响应**全出口**挂钩限流：`readUpstreamBody` 调用点＋`pipeResponse`／passthrough／skills passthrough；封闭清单含 grep 模式集；禁止无界 pipe 合规 |
| SC-07 | 容量拒绝不扣预算 calls；SC-06 中止按 OQ-3 结算预算（须 UAT 核 counters） |
| SC-08 | T2 混压：预注册成功率＋p95 分母通过（OQ-A3） |
| SC-09 | T4：停压后 wait≥hold+5s，capacity 回落，interactive 恢复 |
| SC-10 | health／mcpCapacity 含 workload／integration 拒绝计数；另含 **interactive 高并发／大响应触顶** 代理计数（漏打标告警）；无敏感正文 |
| SC-11 | 开发者指引：Python＋Java 示例、水位表、退避、**显著「非官方 SDK」** |
| SC-12 | stability-sentinel：引用现行阈值；「持续」＝连续 3 个哨兵采样窗越线 → FAIL（与 sentinel 实现对齐并写 UAT） |

## 6. 压测场景（合同化）

| 场景 | 内容 |
|---|---|
| T1 | 仅 interactive 小查询基线 |
| T2 | integration 约 10–40 路＋interactive 探针 |
| T3 | 故意大明细／大响应 |
| T4 | 停压＋hold 宽限后恢复 |
| T5 | sentinel 全程 |

## 7. 风险与非目标

- 漏打标 integration 占用 interactive 权利：残余运维风险（OQ-2）。
- 同进程 event-loop 被非 MCP 路径阻塞：本条不闭合（P1-84／审计读等）。
- 进程拆分：另场。

## 8. 授权边界

- **终稿已确权**（2026-11-27）。  
- **开发未授权**：未获委托人另行开发授权前禁止改运行代码。  
- 设计／Plan／UAT 对抗过程 ≠ 开发授权 ≠ UAT PASS ≠ 可上线。
