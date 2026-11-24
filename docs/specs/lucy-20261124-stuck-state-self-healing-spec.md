# 假活状态自愈与探针一致性 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 假活状态自愈与探针一致性 Spec |
| 文档类型 / 版本 | Spec（事故修复／可用性）／**v0.1-draft** |
| 日期 / 目标版本 | 2026-11-24／产品线 `0.30.0`（`lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-81**／REQ-030-102／**P1（事故修复）**。**不入核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账 |
| 阶段 | S1 |
| 状态 | S1｜v0.1-draft。委托人 2026-11-24 要求为「假活＋不自愈」设立专门 UAT，并同意先入总账、先落设计与用例文档。终稿未确权；开发未授权；仅设计与登记，不执行跑次，不改运行代码；测试台 NOT RUN。不入核心分母。≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 撰写人 / 委托人 | Cursor Agent／xingchen |
| 需求来源 | [P1-75 增量压力跑次 `f5e4b14d`](../qa/uat/suites/interactive-read-resilience/runs/2026-11-24-codex-f5e4b14d-pressure.md)：停压后同实例继续观察约 134 秒，展示读仍有 80 条 503、10 条超时，`readyz` 30/30 为 200，业务查询仍到 30 秒截止，仅重启后恢复 |
| 实施主体 | 待定。候选落点：`webui/server/runtime/readiness.ts`、`scripts/runtime/docker-healthcheck.sh`、`deploy/compose/docker-compose.demo.yml`、进程内自检。本条**不预设**实现，见 OQ-1 |
| 与既有 Spec 的关系 | 不重复 [P1-75](lucy-20261123-interactive-read-resilience-spec.md)（负责不让压力把读路径打到假活）、[P1-46](lucy-20261118-readyz-mcp-listen-consistency-spec.md)（只管启动窗口）、[P1-63 排空](lucy-20261119-process-drain-lifecycle-spec.md)（有序退出）。本条只管**已陷入假活之后**的恢复与探针诚实性 |
| 配对计划 | [Plan](../plans/lucy-20261124-stuck-state-self-healing-plan.md) |
| 测试台 | [`UAT-SUITE-SELF-HEAL`](../qa/uat/suites/self-healing/suite.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 2026-11-24 初稿。依据 `f5e4b14d` 压力跑次及 Docker 配置核对起草；终稿未确权；开发未授权 |

## 闭口层级

- 层级：功能合同
- 性质：事故修复／可用性。覆盖「假活」的可观测、同实例恢复、探针与业务一致、误杀防护。
- 本条承诺：压力或故障使业务读写持续失败后，**不依赖人工重启**，Lucy 要么在同一进程内自行恢复，要么让探针如实转红并由 Docker 监管器替换进程；同时不得误杀合法高峰下仍可用的实例。
- 本条出口：SC-01–SC-07。
- 不在本条出口：压力下避免进入假活的性能优化（P1-75／P1-78）、启动窗口（P1-46）、客户 K8s 探针与 Helm 配置、多副本或外部编排。
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

- 不要求消除压力下的所有 503，那是 P1-75／P1-78。
- 不规定实现机制，见 OQ-1。
- 不覆盖 K8s、Helm、客户拓扑；默认对齐本机 Docker。
- 不用自愈掩盖根因：自愈发生必须留痕，且不改写 P1-75 对压力跑次的 FAIL 判定。

## 3. 假活判定（草案）

满足全部条件即为「假活」：

- 观察窗口 W（默认 60 秒）内，对同一进程发起的**合法、已鉴权**业务探针（至少含一条展示读和一条纯 MCP 合法问数）失败率达 100%。失败＝超时或 503。
- 同窗 `readyz` 与 `livez` 仍为 200。
- 同窗没有处于启动窗口、排空（P1-63）或已登记的计划内重载。

W、失败率与观察探针见 OQ-2，UAT 按本节默认值执行，裁定后同步。

## 3.1 核心流程（伪代码）

```text
observe(window W):
  r = authenticated_business_probes(display_read, mcp_legal_query)
  l = readyz_status, livez_status
  if in_startup or in_drain or in_planned_reload: return NORMAL
  if r.fail_rate == 100% and l == 200: return STUCK        # 假活
  return NORMAL

on STUCK:
  # A：先给同进程恢复窗口
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
| OQ-1 | 采用哪种机制：进程内自检并自退出＋`restart: unless-stopped`；探针转红＋外部自愈组件；或两者组合 | 待委托人裁定。UAT 只验结果，不绑机制 |
| OQ-2 | W、T_A、T_B 与观察探针的取值 | W＝60 秒，T_A＝120 秒，T_B＝180 秒（从 STUCK 起算）；依据 `f5e4b14d` 134 秒未恢复的观察，须委托人确认 |
| OQ-3 | demo／标准 compose 是否新增 `restart:` 策略，是否属于本条范围 | 本条默认只评估，不改部署文件；改动另行授权 |
| OQ-4 | 自愈重启是否走 P1-63 的有序排空，还是允许强退 | 默认优先有序排空，排空超时才强退；强退须保留可核对的审计 |

## 6. 授权边界

- **终稿未确权；开发未授权。**
- 本条当前只允许 Spec／UAT 设计与登记，不得改运行代码或 compose 配置。
- 改前基线跑次（SC-01／SC-03 预期 FAIL）属于测试，可在授权跑次后执行，不构成开发授权。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 自愈重启把仍在服务的实例误杀，反而伤害主路径 | SC-04 必做；假活判定要求业务探针 100% 失败 |
| 压力下自愈循环重启（抖动） | UAT 记录重启次数；OQ-2 须含最小重启间隔 |
| 重启丢失已受理写入 | SC-05 要求审计守恒；OQ-4 优先有序排空 |
| 无法稳定复现假活，用例成摆设 | R0 要求先构造出假活，否则 BLOCKED，不得判 PASS |
