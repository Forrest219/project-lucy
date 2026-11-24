# 假活状态自愈与探针一致性 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 假活状态自愈与探针一致性 Spec |
| 文档类型 / 版本 | Spec（事故修复／可用性）／**v0.2** |
| 日期 / 目标版本 | 2026-11-24／产品线 `0.30.0`（`lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-81**／REQ-030-102／**P1（事故修复）**。**不入核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账 |
| 阶段 | S4 |
| 状态 | S4｜v0.2。终稿已确权（委托人 2026-11-24 明示）；开发授权已获得（2026-11-24）；实现已落地（进程内看门狗＋有序排空退出 75＋探针转红＋compose `restart: on-failure`），单测与本机 Docker 故障注入已验证；待验收；测试台 NOT RUN（无正式 UAT 跑次）；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 撰写人 / 委托人 | Cursor Agent／xingchen |
| 需求来源 | [P1-75 增量压力跑次 `f5e4b14d`](../qa/uat/suites/interactive-read-resilience/runs/2026-11-24-codex-f5e4b14d-pressure.md)：停压后同实例继续观察约 134 秒，展示读仍有 80 条 503、10 条超时，`readyz` 30/30 为 200，业务查询仍到 30 秒截止，仅重启后恢复 |
| 实施主体 | Lucy。已落点：`webui/server/runtime/readiness.ts`、`scripts/runtime/docker-healthcheck.sh`、`deploy/compose/docker-compose.demo.yml`、进程内自检。本条**不预设**实现，见 OQ-1 |
| 与既有 Spec 的关系 | 不重复 [P1-75](lucy-20261123-interactive-read-resilience-spec.md)（负责不让压力把读路径打到假活）、[P1-46](lucy-20261118-readyz-mcp-listen-consistency-spec.md)（只管启动窗口）、[P1-63 排空](lucy-20261119-process-drain-lifecycle-spec.md)（有序退出）。本条只管**已陷入假活之后**的恢复与探针诚实性 |
| 配对计划 | [Plan](../plans/lucy-20261124-stuck-state-self-healing-plan.md) |
| 测试台 | [`UAT-SUITE-SELF-HEAL`](../qa/uat/suites/self-healing/suite.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 2026-11-24 初稿。依据 `f5e4b14d` 压力跑次及 Docker 配置核对起草；终稿未确权；开发未授权 |
| v0.2 | 2026-11-24 **终稿确权＋开发授权（委托人明示）并实现**：OQ-1＝进程内看门狗（A 原位重启 reconciler→B 排空退出 75）＋探针转红＋Docker 监管器替换的组合；OQ-2 采纳默认 W=60s、T_A=120s（重试 T_A 后 B）；OQ-3 demo compose `lucy` 增 `restart: on-failure`；OQ-4 走 P1-63 有序排空，超时再退出。新增重启断路器（30 分钟内 3 次）与证据 JSONL `.ktx-ui/self-heal-events.jsonl`。UAT 仍 NOT RUN |
| v0.1-draft | 2026-11-24 措辞修订（委托人批准）：非目标与「不在本条出口」中，压力下消除 503 的实现归 P1-75，P1-78 仅度量与判定。不改状态、范围与验收 |
| v0.2-r2 | 2026-11-24 评审反馈修订（委托人转述评审意见，实现与证据已落地）：**MCP/KTX 探针可独立触发**——上游探针（`kind:"upstream"`，KTX 无响应）单独连续失败满 W 即判假活（`stuckDomain=mcp`），不再要求展示读同时失败；本进程 I/O 积压（`kind:"io"`）单独**不**触发；KTX 在 30 秒内完成过任一工具调用即视为存活（`upstream-liveness`），防止饱和误杀。判定后 `readyz` 转 503；先原位重启 KTX 子进程（经 supervisor reload 通道），T_A 后仍未恢复再有序排空退出 75；自发起的 KTX reload 不计入「计划内重载」豁免（避免 stuck→reload→豁免 循环）。**compose 不加 `on-failure:N` 封顶**：实测 Docker 的 N 计数从不复位，封顶会使自愈永久失效；改以 Docker 退避（≤1 分钟）＋看门狗重启断路器（30 分钟 3 次，持久化）约束启动死循环。证据见 `inbox/p181-p182-docker-verify/p181-single-path-ktx-heal.json`（原位恢复＋退出 75 两条路径；16 路持续饱和 130 秒无误杀）。状态、UAT 与出口不变：UAT 仍 NOT RUN；SC-06（属 P1-82）仍移下期 |
| v0.2-r1 | 2026-11-24 联动修订（P1-75 v1.4）：§3 失败定义纳入越宽限 `stale`／`pending` 降级 200，避免 A 类零 503 让假活检测失明；`readyz` 的 `stuck` 属 P1-75 附录 A 的 B 类。**只改文档，不改状态与既有验收；已落地的 `stuck-watchdog.ts` 与展示读探针对齐须委托人另行授权，授权前该实现按旧定义（超时或 503）运行。** |

## 闭口层级

- 层级：功能合同
- 性质：事故修复／可用性。覆盖「假活」的可观测、同实例恢复、探针与业务一致、误杀防护。
- 本条承诺：压力或故障使业务读写持续失败后，**不依赖人工重启**，Lucy 要么在同一进程内自行恢复，要么让探针如实转红并由 Docker 监管器替换进程；同时不得误杀合法高峰下仍可用的实例。
- 本条出口：SC-01–SC-07。
- 不在本条出口：压力下避免进入假活的性能优化（P1-75 实现；P1-78 仅度量）、启动窗口（P1-46）、客户 K8s 探针与 Helm 配置、多副本或外部编排。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None。「假活」「自愈」为工程与测试台术语，只用于 Spec、UAT 和证据，不进入 WebUI 或 API 用户可见文案。

## 交互合同豁免

- 原因：本条只涉及探针判定、进程恢复和运维可观测，不改变用户可见 WebUI 表面
- 不改变：页面路由、组件、按钮、文案与布局；`/api/health`、`/api/livez`、`/api/readyz` 路径及既有字段。

## 受影响画像

| 画像 | 判定 | 依据／补偿 | SC |
|---|---|---|---|
| 问数方 | ↑ | 假活不再无限持续，合法问数在限时内恢复；自愈重启期间的 503 窗口须有限且不丢已受理写入 | SC-02／03／06 |
| 治理方 | ＝ | 管理页在恢复后读写正常；不新增操作步骤 | SC-02／06 |
| 运维方 | ↑ | 探针与业务一致，不再需要人工判断「探针全绿但全超时」；新增自愈事件可见 | SC-01／03／05 |
| 管理层 | ＝ | 无直接变化；可用性口径更诚实 | SC-04 |

## 1. 问题陈述

2026-11-24 `f5e4b14d` 压力跑次观察到：

1. 压力停止后，同一进程内约 134 秒不恢复。展示接口三条各 30 次读，共 80 条 503、10 条客户端超时；独立客户端两条业务查询在握手、发现、目录都通过后到达 30 秒截止。
2. 同一时段 `readyz` 30/30 为 200，`livez` 也持续 200。探针看不见业务失败。
3. 单独重启容器后三条展示读首轮 200，两条完整问数 5–6 秒内返回正确值。

Docker 配置核对（2026-11-24）：

| 事实 | 位置 | 含义 |
|---|---|---|
| `HEALTHCHECK` 只检查 `ktx` 运行时就绪、`/api/health` 的 `ok`、MCP 端口 TCP 可连 | `scripts/runtime/docker-healthcheck.sh` | 不检查任何业务读写能力，假活时仍判 healthy |
| 容器 `lucy` 无 `restart:` 配置，默认 `"no"` | `deploy/compose/docker-compose.demo.yml` | 即使进程退出也不会被拉起 |
| 普通 Docker／compose 不会因 unhealthy 自动重启容器 | Docker 行为 | 只把状态标成 unhealthy，需 `restart` 策略配合进程退出，或外部自愈组件 |

因此在 Docker 形态下，「探针转红」本身不足以自愈。必须同时满足：探针如实反映业务，并且有机制使坏进程被替换。这两件事现在都不存在，要分别验证。

## 2. 目标与非目标

**目标**

1. **可观测**：假活有明确判定，并可被运维读取。
2. **A 同实例恢复**：外部压力撤去后，在限时内同一进程恢复展示读与合法问数。
3. **B 探针一致**：同一进程若无法在限时内恢复，探针必须如实转红，并由 Docker 监管器替换，恢复后业务可用。
4. **误杀防护**：合法高峰、短暂忙碌、排空和启动窗口不触发自愈。
5. **证据**：每次自愈留下原因、时刻和前后状态，不静默丢失已受理请求。

**非目标**

- 不要求消除压力下的所有 503。消除压力下的 503 由 P1-75 负责实现；P1-78 只做度量与判定，不改产品代码。
- 不规定实现机制，见 OQ-1。
- 不覆盖 K8s、Helm、客户拓扑；默认对齐本机 Docker。
- 不用自愈掩盖根因：自愈发生必须留痕，且不改写 P1-75 对压力跑次的 FAIL 判定。

## 3. 假活判定（草案）

满足全部条件即为「假活」：

- 观察窗口 W（默认 60 秒）内，对同一进程发起的**合法、已鉴权**业务探针失败率达 100%，且满足下列任一路径（v0.2-r2）：**(a) 单路 MCP/KTX**：MCP 数据路径探针判定为上游无响应（KTX 超时／不可用／陈旧），无需展示读同时失败；**(b) 双路**：展示读与 MCP 数据路径探针同时失败。仅本进程 I/O 积压（探针慢但 KTX 仍在应答）不构成 (a)。失败＝超时、503，或 [P1-75 v1.4](lucy-20261123-interactive-read-resilience-spec.md) §2.5.1 定义的越宽限 `stale`／`pending` 降级 200。降级 200 不是健康证据，展示读探针必须判定响应状态，不得只看状态码。
- 同窗 `readyz` 与 `livez` 仍为 200。
- 同窗没有处于启动窗口、排空（P1-63）或已登记的计划内重载。

W、失败率与观察探针见 OQ-2，UAT 按本节默认值执行，裁定后同步。

## 3.1 核心流程（伪代码）

```text
observe(window W):
  r = authenticated_business_probes(display_read, mcp_legal_query)
  l = readyz_status, livez_status
  if in_startup or in_drain or in_planned_reload: return NORMAL
  # failure = timeout | 503 | degraded stale/pending beyond grace (P1-75 v1.4)
  if r.fail_rate == 100% and l == 200: return STUCK        # 假活
  return NORMAL

on STUCK:
  readyz -> 503 (reason=stuck)
  # A：先给同进程恢复窗口；MCP 域先原位重启 KTX 子进程
  wait up to T_A (default 120s) for observe() == NORMAL without restart
  if NORMAL: record(self_heal=in_place, duration)
  else:
    # B：探针如实转红，由监管器替换进程
    readiness/health -> fail (unhealthy)
    supervisor restarts container within T_B (default 180s from STUCK)
    after restart: business probes succeed
    record(self_heal=restart, reason=stuck, before_state, after_state)

never:
  mark STUCK while any business probe succeeds         # 误杀防护
  restart during drain / startup / planned reload
  require human restart in the contract path
```

## 4. 验收（SC）

| ID | 合同 |
|---|---|
| SC-01 | **假活可观测**：真实构造假活后，运维不读容器内部即可从既有探针或新增只读字段判断「进程活、业务失败」。若探针仍全绿且无任何可读信号，判 FAIL（改前基线预期如此） |
| SC-02 | **同实例恢复（A）**：压力撤去后，在 T_A 内同一进程（PID 与容器起始时刻不变）的展示读恢复 200，合法纯 MCP 问数返回正确值。不允许用重启凑恢复 |
| SC-03 | **探针联动重启（B）**：不撤压或同进程无法恢复时，在 T_B 内探针转红，容器被 Docker 监管器替换，重启后展示读与合法问数恢复。全程无人工命令 |
| SC-04 | **误杀防护**：标准 30 分钟合法负载（含 [CAV STD 档](../qa/uat/suites/core-availability/retest.md)）、短暂忙碌（单次 503 后恢复）、TERM 排空、冷启动窗口，自愈重启次数为 0 |
| SC-05 | **自愈证据**：每次自愈留下类型（in_place／restart）、起止时刻、触发依据和前后业务探针结果；重启不丢失已受理的审计行（前后行数与水位守恒） |
| SC-06 | **主路径可用性**：自愈期间及之后，持有合法 Agent Token 的纯 MCP 客户端无需 WebUI Cookie，即可在恢复后重新 `initialize`→`tools/list`→合法查询成交；自愈不得要求人工介入 |
| SC-07 | 对应 UAT 必做项全真 PASS |

## 5. 开放项

| ID | 问题 | 默认 |
|---|---|---|
| OQ-1 | 采用哪种机制：进程内自检并自退出＋`restart: unless-stopped`；探针转红＋外部自愈组件；或两者组合 | **已裁（2026-11-24）**：进程内看门狗（A 原位重启 reconciler→B 有序排空并以退出码 75 退出）＋探针转红＋Docker `restart: on-failure` 的组合。UAT 只验结果，不绑机制 |
| OQ-2 | W、T_A、T_B 与观察探针的取值 | W＝60 秒，T_A＝120 秒，T_B＝180 秒（从 STUCK 起算）；依据 `f5e4b14d` 134 秒未恢复的观察，采纳默认值（委托人 2026-11-24 授权）。实现：W 内两路业务探针（展示读、MCP 数据路径）每次均失败才判 STUCK；STUCK 起 T_A 后仍未恢复转 B |
| OQ-3 | demo／标准 compose 是否新增 `restart:` 策略，是否属于本条范围 | **已裁**：demo compose `lucy` 增 `restart: on-failure`；标准／客户编排不在本条。**r2**：不加 `:N` 封顶（Docker 的 N 计数不复位，封顶会永久禁用自愈）；启动死循环由 Docker 退避＋看门狗断路器约束 |
| OQ-4 | 自愈重启是否走 P1-63 的有序排空，还是允许强退 | 默认优先有序排空，排空超时才强退；强退须保留可核对的审计。**已裁**：走有序排空，排空结束后以退出码 75 退出 |

## 6. 授权边界

- **终稿已确权（委托人 2026-11-24 明示）；开发授权已获得（2026-11-24）。**
- 授权范围：进程内看门狗、探针、健康检查脚本、demo compose 重启策略。不含客户编排与 K8s。
- 改前基线跑次（SC-01／SC-03 预期 FAIL）属于测试，可在授权跑次后执行，不构成开发授权。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 自愈重启把仍在服务的实例误杀，反而伤害主路径 | SC-04 必做；假活判定要求业务探针 100% 失败 |
| 压力下自愈循环重启（抖动） | UAT 记录重启次数；OQ-2 须含最小重启间隔 |
| 重启丢失已受理写入 | SC-05 要求审计守恒；OQ-4 优先有序排空 |
| 无法稳定复现假活，用例成摆设 | R0 要求先构造出假活，否则 BLOCKED，不得判 PASS |
