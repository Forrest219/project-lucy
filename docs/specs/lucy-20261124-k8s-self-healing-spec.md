# 客户 K8s 下的假活自愈 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 客户 K8s 下的假活自愈 Spec |
| 文档类型 / 版本 | Spec（事故修复／可用性／客户 K8s）／**v0.5-draft** |
| 日期 / 目标版本 | 2026-11-24／产品线 `0.30.0`（`lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-83**／REQ-030-104／**P0（客户 K8s 主路径可用性）**。编号沿 P1-78 先例：避让既有 P0-1…7，保留 P1 序号并标 P0 优先级。**不入核心分母**（不改变「P0 七项＋P0-A＋P0-B」判据；是否入分母须委托人另裁） |
| 台账号 | 无。挂现行 `0.30` 执行总账 |
| 阶段 | S1 |
| 状态 | S1｜v0.5-draft。委托人 2026-11-24 明示批准起草并提级 P0；已裁 OQ-1＝C、OQ-4、OQ-6、OQ-7（D-1 另立 P1-85）、OQ-3 流程与口径、D-2 方向（单节点 K3s、amd64 原生），OQ-3 红线预裁定 ≤360 秒、N＝3（改前基线后、开发授权前冻结）；amd64 机器来源暂定不了，B 层台建设与步骤 0／1b／1 测程授权暂缓；已完成 v0.4 复审及整改（[复审记录](../reviews/2026-11-24-p1-83-v0-4-final-review.md)），Codex CLI 因账号用量上限未能执行，本轮不构成终稿确权；终稿未确权（待 Codex CLI 或委托人明示）；开发未授权；测试台 `not_registered`（未立套件）；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 撰写人 / 委托人 | Cursor Agent／xingchen |
| 基于材料 | [P1-81 Spec](lucy-20261124-stuck-state-self-healing-spec.md)；`webui/server/runtime/self-heal.ts`、`stuck-watchdog.ts`、`process-drain.ts`；`webui/server/index.ts` `livez`／`readyz`；`deploy/k8s/helm/lucy/`；`deploy/k8s/K8S_CONTRACT.md`；`scripts/runtime/docker-entrypoint.sh`；[2026-11-13 错题](../lessons/2026-11-13-audit-read-blocks-event-loop.md)；[对抗性评审](../reviews/2026-11-24-p1-83-k8s-self-healing-adversarial-review.md)；[v0.4 复审与确权材料](../reviews/2026-11-24-p1-83-v0-4-final-review.md) |
| 适用范围 | 客户 K8s（Helm Chart 交付形态）下假活的同实例恢复、探针语义与监管器替换的合同。**本条是 `AGENTS.md`「Docker 对齐」的明示例外**：委托人要求按客户 K8s 立项 |
| 需求来源 | 委托人 2026-11-24 核实请求：「`livez` 永绿，只有进程退出 75 才能重启，Chart 侧没有对应 Spec；P1-81 只在 Docker 下验证过，客户环境就是 K8s」。核实结论见 §1 |
| 实施主体 | Lucy（Chart、探针、进程内看门狗）。不改 KTX 源码 |
| 与既有 Spec 的关系 | 承接 [P1-81](lucy-20261124-stuck-state-self-healing-spec.md)。不重写其假活判定逻辑，阈值默认值不变（K8s 档可经 Chart 调参，见 §3.3；调参须重跑 SC-04）；**但**断路器持久化逻辑与 P1-81 共用，本条对其修改纳入白名单（§3.3）。不重复 [P1-46](lucy-20261118-readyz-mcp-listen-consistency-spec.md)、[P1-63 排空](lucy-20261119-process-drain-lifecycle-spec.md)、[P1-39／P1-47](lucy-20261117-cold-start-audit-scan-spec.md)。依赖见 §6 |
| 配对计划 | [Plan](../plans/lucy-20261124-k8s-self-healing-plan.md) |
| 测试台 | `not_registered`。套件待 Spec 终稿确权后另立，不得用 P1-81 的 Docker 跑次替代 |
| 输出位置 | `docs/specs/lucy-20261124-k8s-self-healing-spec.md` |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.5-draft | 2026-11-24 按 v0.4 复审整改：补齐 `recovered`／文件缺失／读写失败的完整状态语义与启动证据自检；冻结 Chart values 形态、双向新旧兼容矩阵、测试文件与 `Chart.yaml` 白名单；只读证据文件改用版本化 post-renderer 构造；终稿确权与基线后预算冻结解耦，开发前冻结红线不变；画像改回 4 行并补变更前后事实；恢复计时名义估算不再冒充硬上界；审计守恒改按已受理请求 ID 对账；登记 Chart `0.2.10` 与合同文档 `0.2.9` 的既有漂移；同步 P1-85 已起草及其 OQ-1 首升归属依赖；步骤 6 后 Chart／values 变更即使不改 digest 也作废旧闭合并全量重跑。Codex CLI 因账号用量上限未能执行；仍 S1，终稿未确权；开发未授权 |
| v0.1-draft | 2026-11-24 初稿与同日补注（Plan 配对、B 层台未建成）。委托人明示批准起草并提级 P0；终稿未确权；开发未授权 |
| v0.2-draft | 2026-11-24 按 Kimi 对抗性评审（v0.1 退回）修订：**B-01** 拆成「自愈合同」与「可观测合同」，删除人工处置替代自愈的通过条款；**B-02** 恢复预算改为开发前由委托人冻结，计时拆三段并从首次合法业务失败起算；**B-03** 区分退出 75／liveness 杀／删除回滚三条退出路径，Chart 停止宽限列为公共依赖 D-1；**B-04** 断路器持久化异常不得静默按零，补跨重启状态语义，删除不受支持的 `emptyDir` 分支（Chart 已拒绝 `persistence.enabled=false`）；**B-05** 故障分三类并要求版本化注入测程，构造不出记 BLOCKED；**B-06** A／B／C 逐分支列配置与文件白名单，定义唯一 K8s 档字段与 `extraEnvFrom` 规则；**B-07** 成功判定改为非降级读＋独立 SQL 核对＋差分口径；**M-01–M-04** 与受影响画像逐子面重写。SC 由 8 条扩为 11 条。**部分采纳**：B-04 的 fail-closed 倾向（OQ-6 待裁）、CAV 绝对通过要求（改差分）、M-02 N-1 矩阵（按 OQ-1 条件触发）、B-03／B-04 的既有缺陷（D-1 建议另立登记，待裁）。终稿未确权；开发未授权；状态与范围其余不变 |
| v0.4-draft | 2026-11-24 落盘第二轮对抗性评审（B-01–B-03、M-01–M-03）认同项与委托人批量裁定：**B-01** 持续类故障拆为「已启动后挂起（退出 75）」与「重启后卡在 startup（看门狗因 `isExempt` 不介入，kubelet `startupProbe` 失败后退出 143／137）」两条路径，并写明方案 C 的时间约束；**B-02** SC-09 最长排空改用 `delete pod`／`helm rollback`（真实 SIGTERM），liveness 杀路径记为进程无响应、预期强杀 137，不再「用真实 liveness 失败构造排空」；**B-03** SC-06／08 与信号表按 `window`／`delegate` 拆开，C 的集群信号为 `restart_requested` 事件＋退出码 75＋`CrashLoopBackOff`；**M-01** 非目标改为「不重写判定逻辑，阈值默认值不变，K8s 档可经 Chart 调参并重跑 SC-04」；**M-02** 伪代码改为事件在排空与退出之前同步写入（与代码一致；不要求 `fsync`），交付说明提示接入集群级日志采集；**M-03** `strategy: Recreate` 为 Chart 既有事实，`preStop` 归 P1-85 待 SC-09 证据。**OQ-3** 预裁定红线 ≤360 秒（暂定）、N＝3。**OQ-5** 增 dry-run 按判据逐条切分 SC-01–11。**D-1／P1-85** 范围订为 `terminationGracePeriodSeconds`＝60＋渲染断言（≥45、`Recreate`），且须在步骤 1⑥ 取现状证据之后。**D-2** 机器来源暂缓。未改运行代码、Chart、探针与测程；终稿未确权；开发未授权 |
| v0.3-draft（OQ-5 补裁） | 2026-11-24 委托人明示认可并微调：OQ-5 改为「X3 为步骤 6 门禁，一次性最终镜像全量验收，原步骤 8 取消；延期熔断 pre-X3 dry-run，排除 SC-01–07，不抵扣」。文字见 §5 OQ-5。未改状态；终稿未确权；开发未授权 |
| v0.3-draft | 2026-11-24 委托人批准评审后的决策建议及我方修正，**决策闭合**：**OQ-1＝C**（K8s 档 `delegate`，保留轻量 `livez`，不新增业务驱动的杀进程路径；方案 A／B 作为被否备选保留）。补两条实测要求：退避增长须同时覆盖「重启后立刻复发」与「Ready 数分钟后才复发」两种情形；C 去掉进程内上限后误判无重启上限，列入风险并加强 SC-04。**OQ-3**：先冻结口径与流程（总红线先于基线冻结、不拿 300 秒 `startupProbe` 当预算、稳定成交 N＝3 间隔 3–5 秒、`windowMs`／`inPlaceMs` 等由 Chart 钉死；缩短 W／T_A 须连带重跑 SC-04）；**红线数值仍待委托人**。**OQ-4**：采纳候选字段；关闭自愈定性为受支持的运维逃生配置（经 Chart 显式 values、启动告警日志、声明不享有自愈保障与探针诚实性丧失）。**OQ-6**：fail-open＋显式降级；单行损坏跳过并告警；信号只走日志与 `/api/health` 自愈快照，**不得使 `readyz` 转红**。**OQ-7**：D-1 另立 **P1-85**（P1 事故修复／快修），措辞改正为「P1-63 的 45 秒预算在 K8s 形态未落地」（P1-63 SC-06 仅覆盖 Docker demo compose），本条只保留依赖。**D-2**：方向裁定为单节点 K3s、固定版本；**必须 amd64 原生节点，Mac 上 QEMU 不得判正式 PASS**；建设授权与机器待定。SC-04／06／08／10 与矩阵、白名单、风险同步。终稿未确权；开发未授权 |

## 闭口层级

- 层级：功能合同
- 性质：事故修复／可用性／客户 K8s。
- 本条承诺：分**两份、互不替代**。①**自愈合同**：对声明的「整容器重启可清除」故障域，K8s 下必须在冻结预算内**自动**恢复，人工处置不得作为通过条件；②**可观测合同**：对持续的外部故障（数据库、网络、重启后仍复现的故障），只承诺**退避间隔有界、重试次数不设上限**、明确 NotReady、可读原因与运维入口，**不宣称已自愈，也不宣称会停止重试**。
- OQ-1 已裁为 C（委托人 2026-11-24），自动自愈合同成立；原「选 A 则收窄为可观测与人工恢复合同」的条款随方案 A 被否而作废。
- 同时不得重现 2026-11-13 的 liveness 误杀。
- 本条出口：SC-01–SC-11。
- 不在本条出口：假活判定算法（归 P1-81／P1-75 X3）、压力下避免假活的性能优化（P1-75／P1-78）、启动窗口（P1-46）、多副本与外部编排、Helm 之外的 K8s 交付方式、客户集群现场验收（C 层）、`emptyDir` 等无 PVC 部署（Chart 已拒绝）。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None。「假活」「自愈」「逃生阀」「抑制态」为工程与测试台术语，只用于 Spec、UAT 和证据，不进入 WebUI 或 API 用户可见文案。

## 交互合同豁免

- 原因：本条只涉及探针语义、Chart 配置、进程恢复和运维可观测，不改变用户可见 WebUI 表面
- 不改变：页面路由、组件、按钮、文案与布局；`/api/health`、`/api/livez`、`/api/readyz` 路径及既有字段（新增只读字段须向后兼容）。

## 受影响画像

按 [user-personas](../governance/user-personas.md) 逐子面判定。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 问数面：K8s 假活可持续到人工重启。报告面：Live Report 固定 URL 同受整实例不可用影响 | 问数面：声明故障域内在冻结预算内自动恢复，纯 MCP 合法 Token 无需 WebUI Cookie 即可重新问数。报告面：重启仍有短窗，恢复后非降级读取成功；不把短窗写成零中断 | P1·问数面 ↑／P1·报告面 ＝ | SC-01／04／05／07；独立 SQL 与报告非降级读 oracle | — |
| P2 治理方 | 故障期间管理读写随实例不可用；本条不改语义口径与权限配置 | 恢复后真实管理读与至少一次管理写及结果核对正常；不新增治理入口或授权模型，不要求以 WebUI 代替纯 MCP 验收 | P2·语义口径面 ＝／P2·权限授权面 ＝ | SC-07／10；§3.3 白名单不含语义口径或 ACL 配置 | — |
| P3 运维方 | 交付面：Chart 无自愈档，停止宽限未落地，Chart `0.2.10` 与合同文档 Current `0.2.9` 已有漂移。观察面：抑制态可持续且集群信号不足 | 交付面：Chart 显式钉死配置，Recreate 升级／回滚与停止宽限有据；混合新旧形态只记旧语义降级。观察面：退出码、`readyz` reason、结构化事件及 RBAC／保留入口可读 | P3·交付运维面 ＝（以 SC-09／10 通过为成立条件）／P3·运行观察面 ↑ | SC-03／06／09／10；§1 既有漂移事实 | — |
| P4 管理层 | 业务指标、价值口径与报表数值由既有路径产生；工程可用性不能冒充业务结果 | 不改业务指标、价值口径与报表数值；恢复后的独立 SQL 核对防止把工程重启冒充业务正确 | ＝ | SC-07；§3.3 白名单不含指标、报表或语义口径文件 | — |

**产品级复核**：当前没有 `↓` 判定。SC-04／09／10 若暴露误杀、强杀或升级回滚退化，不得以整体 `↑` 掩盖：对应必做项判 FAIL，本条不得收口；须先把相关子面改判 `↓`，补同一 K8s 部署实况下的补偿路径与验收，并写明是否违反「主路径可用性优先」，违反则退回。

## 1. 问题陈述与核实基线（2026-11-24）

| 事实 | 位置 | 判定 |
|---|---|---|
| `livez` 是常量 `{ok:true}`，不读任何状态 | `webui/server/index.ts` `app.get("/api/livez", …)` | 属实 |
| Chart 的 `livenessProbe` 打 `/api/livez`；`startupProbe`／`readinessProbe` 打 `/api/readyz` | `values.yaml` 探针段 | 属实 |
| 看门狗唯一的重启出口是排空后 `process.exit(75)` | `self-heal.ts` `requestRestart` | 属实 |
| `readyz` 在 `stuck`／`unhealthy` 转 503，K8s 下只摘端点，**不会**重启容器 | `index.ts` `readyz`；kubelet 语义 | 属实（语义推断，未集群实测） |
| P1-81 明确不覆盖客户 K8s 探针与 Helm；UAT 只证明本机 Docker 单实例 | P1-81 Spec／UAT 套件 | 属实：Chart 侧无 Spec |
| `livez` 保持常量是**有意设计**（2026-11-13 liveness 误杀 8 次，退出码 143） | 2026-11-13 错题 | 不能让 `livez` 直接反映假活 |
| 退出码 75 经 `wait -n`→`shutdown "${status}"` 保留 | `docker-entrypoint.sh` 末段 | 代码层成立 |
| Chart 未设 `restartPolicy`（Deployment 恒 `Always`） | `deployment.yaml` | 机制上应能重启，**无 K8s 取证** |
| Chart 已显式声明 `strategy.type: Recreate`（RWO PVC 必需）；**未设 `preStop`**；主容器 `runAsUser: 10001`、`runAsNonRoot: true`（root 仅用于迁移 initContainer） | `deployment.yaml`；`values.yaml` | 静态事实。升级不会卡在 PVC Multi-Attach；停机摘端点与关闭监听的竞态未规约，归 P1-85 待 SC-09 证据；`chmod` 类权限故障对主容器有效 |
| `Chart.yaml` 已为 `version: 0.2.10`，但 `K8S_CONTRACT.md` 版本表仍把 `0.2.9` 标为 Current，未登记 `0.2.10` | `Chart.yaml:20`；`K8S_CONTRACT.md:15–30` | **既有版本镜像漂移属实**。实现时先补记 `0.2.10` 的既有事实，再登记本条新 Chart 版本；不得把既有漂移写成已由本条消除，也不得仍称 `0.2.9` 为 Current |
| 看门狗在启动与排空期间不介入（`isExempt`：`!isWebuiReady()` 或进程阶段非 `SERVING`） | `self-heal.ts` `isExempt` | 重启后卡在 startup 窗口时，进程内不会退出 75，由 kubelet `startupProbe` 处置（预期 143／137；其他实际码按 §3.7 取证） |
| 整实例退出预算 40 秒，外部停止宽限需 ≥45 秒；docker-compose.demo.yml 已设 `stop_grace_period: 45s`，**Chart 未设 `terminationGracePeriodSeconds`**（K8s 默认 30 秒） | `process-drain.ts`；P1-63 Spec §6；`deployment.yaml` | 静态事实成立：liveness 杀、删除、回滚路径可能在清理完成前被强杀。**注**：P1-63 SC-06 只要求 Docker demo compose 渲染配置≥45 秒，K8s Chart 不在其验收范围，故准确表述是「P1-63 的 45 秒预算在 K8s 形态未落地」，不是 P1-63 违约；已另立 P1-85 |
| 重启计数读失败时返回 0，事件写入失败被吞掉 | `self-heal.ts` `countSelfHealRestarts`／`appendSelfHealEvent` | 静默 fail-open |
| `maxRestarts` 只接受正数，非法值回落默认 | `stuck-watchdog.ts` `positive()` | 「关闭／放宽」无配置语义 |
| 看门狗把 `grace`／`stale`／`pending` 降级 200 判为失败 | `stuck-watchdog.ts` | 验收不得只看 HTTP 200 |
| Chart 拒绝 `persistence.enabled=false` | `deployment.yaml` | v0.1 的 `emptyDir` 分支不成立，已删除 |
| K8s 尚无故障控制面 | `K8S_CONTRACT.md` | 故障注入需自备外部控制面 |
| P1-81 正式跑次用 `kill -STOP` 冻结 KTX，且为走到退出 75 须每 3 秒重冻新 KTX | P1-81 formal 记录；`inbox/p181-heal-runner.mjs` | 自然情况下退出 75 是稀有路径，须确定性故障分类 |

准确表述：K8s 下假活自愈「未规约、未验证」，不是「已知不工作」。缺口：

1. 断路器抑制态无出口，且持久化异常会静默 fail-open。
2. 无 K8s 取证链，且无确定性故障注入。
3. 恢复预算与计时起止未规约。
4. 停止宽限与排空路径在 Chart 上未对齐（P1-63 的 45 秒预算在 K8s 形态未落地，见 D-1／P1-85）。
5. 验收成功判定弱于看门狗自身的失败定义。

## 2. 目标与非目标

**目标**

1. 声明故障域内，K8s 下自动恢复，数值预算由委托人冻结。
2. 探针阶段矩阵明确并被测试；`livez` 不因业务假活或合法高峰误杀。
3. 持续故障下集群侧可读、可处置，不宣称自愈。
4. 断路器与证据在持久化异常、重启、老化下语义闭合。
5. Chart 停止宽限、配置与交付契约对齐，并有结构化门禁。
6. 全部正式验收证据来自 B 层 K8s 合同台上的同一最终候选镜像；改前基线与 dry-run 不抵扣。

**非目标**

- 不重写 P1-81 的假活判定与原位恢复逻辑；阈值默认值不变，K8s 档调参只经 Chart 显式 `env`，且须重跑 SC-04。
- 不引入多副本、外部自愈组件或 Operator。
- 不覆盖 Helm 之外的 K8s 交付方式，不做客户现场验收。
- 不支持 `emptyDir` 等无 PVC 部署。
- 不用自愈掩盖根因；自愈发生必须留痕。

## 3. 设计

### 3.1 故障分类（决定验收如何构造）

| 类 | 定义 | 用途 |
|---|---|---|
| A 类 | 可被原位 KTX reload 或 reconciler 重启恢复 | SC-02：同容器恢复，不重启 |
| B 类 | 压住原位恢复，整容器重启后清除 | SC-01：自愈全链，退出 75 |
| 持续类 | 重启后仍复现（含外部故障） | SC-06／08：`CrashLoopBackOff` 退避与可读信号。**不属自愈承诺** |

故障注入必须是版本化测程，不得依赖 `inbox/` 临时 runner，不得 mock 看门狗，不得在产品内加 fault switch。详见 §3.5。

### 3.2 断路器抑制态处置（OQ-1＝C，委托人 2026-11-24 已裁）

**选定方案 C（K8s 档 `delegate`）**：K8s 下进程内断路器改为「委托」模式——不抑制，继续排空后退出 75，由 kubelet 的 `CrashLoopBackOff` 退避兜底；`livez` 保持轻量，不碰业务探针；Docker 语义（`window`）不变。K8s 下不再存在「抑制态」，持续类故障表现为 `CrashLoopBackOff`，这是 K8s 原生可见告警。

**被否备选（保留理由，供复审）**

| 方案 | 做法 | 否决理由 |
|---|---|---|
| A 维持现状 | 抑制态只转 `readyz` 503，等人工 | 静默卡死，不满足自愈合同 |
| B 逃生阀 | 抑制且持续超阈值后让 kubelet 可见探针转红，借退避替换 | 新增业务驱动的杀进程路径（退出码 143／137），与进程内断路器形成双重状态机，且有重演 2026-11-13 误杀的风险面 |

**C 的前提与残余风险（均须实测，不得以推理代替）**

1. **退避增长前提**：kubelet 的 `CrashLoopBackOff` 退避会随反复重启增长，容器单次存活满 10 分钟则重置。现行常量只能给出「冷启动＋约 230 秒」的**名义**故障周期，未含探针超时与调度延迟；即使冷启动按 300 秒估算，也不得据此宣称实际周期必然小于 600 秒。Ready 后数分钟才复发的故障更可能超过 10 分钟并使退避重置，形成 10 分钟级慢速抖动而非递增退避。**Plan 步骤 1④ 必须同时实测两种情形，直接记录单次存活与退避间隔，不用常量推导实测结论。**
2. **误判无进程内上限**：现行断路器的作用之一是限制假阳性 STUCK 的重启次数。C 去掉它后，持续误判会形成**无进程内次数上限的反复重启**；若每次 Ready 后数分钟才复发，则表现为约 10 分钟一次。SC-04 误杀防护与 OQ-4 运维关闭开关因此都是必做防线。
3. **外部故障的无效重启**：持续的外部故障若能触发 STUCK，重启无法修复，只会反复中断。P1-81 的判定依据是展示读与 KTX 上游应答，不是数据库连通性，因此典型的数据库故障不应触发 STUCK；该前提在 SC-06 持续类故障中验证。
4. **方案 C 的时间约束（生效条件）**：只有单次容器存活小于 10 分钟，递增退避才会保留；达到 10 分钟后退避清零，退化为 10 分钟级、无递增退避的慢速循环。**须在基线实测冷启动、完整故障周期与退避间隔**。周期导致恢复红线逼近或超过 360 秒时回 OQ-3；若实测表明 `delegate` 的退避或慢速抖动本身不可接受，则回 OQ-1 重裁，不得只调阈值掩盖方案问题。
5. **持续类的两条路径（退出码不同，均进入 `CrashLoopBackOff`）**：①**已启动后挂起**：看门狗排空后退出 75；②**重启后卡在 startup 窗口**：看门狗因 `isExempt` 不介入，约 300 秒后 kubelet `startupProbe` 失败并重启容器，预期退出码 143 或 137，而非 75；其他实际码按 §3.7 解释。这与 §3.8 的 `never`（看门狗不得在 startup 下触发重启）不矛盾：后者约束进程内看门狗，前者是 kubelet 行为。SC-06 须分别取证。

### 3.3 配置与文件白名单（OQ-1＝C、OQ-4 已裁；数值在 Plan 步骤 3 冻结）

**运行时字段（Docker／K8s 共用）**

| 字段 | 类型与合法值 | 默认与非法值处理 |
|---|---|---|
| `LUCY_SELF_HEAL_BREAKER_MODE` | 字符串：`window` 或 `delegate` | 缺省 `window`，保持 Docker 与旧 Chart 语义；非法值回落 `window` 并输出警告。K8s 新 Chart 只能显式下发 `delegate`，不得靠隐式环境猜测 |
| `LUCY_SELF_HEAL` | 现行开关值；Chart 只下发 `on`／`off` | 缺省沿用现行开启语义；`off` 不启动看门狗。运行时其他非法值不在本条扩写，避免改变 P1-81 既有解析合同 |

**Chart values（K8s 唯一受支持配置入口）**

下列默认值是**预冻结设计值**；Plan 步骤 3 可依据改前基线调整阈值并一次性冻结，之后不得为通过最终跑次而抬线。所有时长／次数值必须是正整数，非法类型、零、负数与 `breakerMode≠delegate` 均由 Helm 模板 `fail` 拒绝；`window` 只保留给 Docker 直接环境变量，不是新 Chart 的合法档。

| values 字段 | 预冻结默认值 | 渲染为显式 `env` |
|---|---|---|
| `selfHeal.enabled: true` | 布尔 `true` | `LUCY_SELF_HEAL=on`；`false` → `off`；非布尔拒绝 |
| `selfHeal.breakerMode: delegate` | 仅 `delegate` | `LUCY_SELF_HEAL_BREAKER_MODE` |
| `selfHeal.intervalMs: 10000` | 10000 | `LUCY_SELF_HEAL_INTERVAL_MS` |
| `selfHeal.windowMs: 60000` | 60000 | `LUCY_SELF_HEAL_WINDOW_MS` |
| `selfHeal.inPlaceMs: 120000` | 120000 | `LUCY_SELF_HEAL_IN_PLACE_MS` |
| `selfHeal.inPlaceRetryMs: 30000` | 30000 | `LUCY_SELF_HEAL_IN_PLACE_RETRY_MS` |
| `selfHeal.probeTimeoutMs: 8000` | 8000 | `LUCY_SELF_HEAL_PROBE_TIMEOUT_MS` |
| `selfHeal.maxRestarts: 3` | 3 | `LUCY_SELF_HEAL_MAX_RESTARTS`（`delegate` 不参与决策；保留给旧镜像兼容与 `window` 回归） |
| `selfHeal.breakerWindowMs: 1800000` | 1800000 | `LUCY_SELF_HEAL_BREAKER_WINDOW_MS`（同上） |

- 每个变量在 Deployment 主容器中只能有**一个**显式 `env` 条目。K8s 对同名变量 `env` 优先于 `envFrom`，故 `extraEnvFrom` 无法覆盖；结构化门禁同时断言唯一性、值与负例。不得把 `LUCY_SELF_HEAL*` 加进通用 `env.*` 透传 helper，另开第二配置入口。
- **关闭自愈**（`selfHeal.enabled=false`）是受支持的运维逃生配置：启动输出显式告警；`NOTES.txt`／`K8S_CONTRACT.md` 声明不享有自愈保障，且因看门狗不启动，`readyz` 不再报 `stuck`，探针诚实性随之丧失。关闭不新增「只观察不退出」软档位。
- **混合新旧形态不享有新合同**：旧 Chart 没有 `delegate` 钉值，新镜像会回落 `window`；旧镜像遇到新 Chart 的未知 `BREAKER_MODE` 会忽略它并沿用 `window`。两者均须记录为旧语义降级，不得静默宣称新自愈保障。

**白名单（方案 C；授权后只能细化，不得扩面）**

| 类别 | 内容 |
|---|---|
| 运行时 | `webui/server/runtime/stuck-watchdog.ts`（`delegate`／`window`、证据快照与启动事件类型）、`webui/server/runtime/self-heal.ts`（持久化异常语义、启动自检与关闭告警） |
| Chart／交付 | `values.yaml`、`templates/deployment.yaml`（显式 `env` 钉死）、`Chart.yaml`（Chart 版本独立递增）、`K8S_CONTRACT.md`、`UPGRADE.md`、`README.md`、`NOTES.txt`、`scripts/gates/helm-lucy-gate.sh` |
| 测试 | `webui/server/__tests__/stuck-watchdog.test.ts`（双模式与探针回归）、`webui/server/__tests__/self-heal.test.ts`（持久化全函数与启动自检）；渲染结构化门禁含非法值、唯一性与 `extraEnvFrom` 覆盖负例；版本化 UAT 注入器／post-renderer 归 Plan 步骤 1b |
| **不在本白名单** | `terminationGracePeriodSeconds` 及其渲染门禁归 **P1-85**，本条只依赖其闭合（D-1）；`webui/server/index.ts` 不改，既有 `/api/health` 已挂载 `selfHealSnapshot()`，新增快照字段只能在既有自愈对象内向后兼容扩展 |

### 3.4 断路器与证据的持久化语义

现行语义：计数来自 `.ktx-ui/self-heal-events.jsonl`（位于 PVC `/data/lucy`）中窗口内的 `restart_requested` 事件，随时间老化；默认 30 分钟内 3 次抑制。本条把计数结果改为「已知计数／未知计数」二态，禁止把异常当成已知零次。

1. **启动证据自检（两种模式都做）**：看门狗启动时读取既有证据、校验逐行 JSON，并追加 `watchdog_started` 事件证明可写；该事件不计入 `maxRestarts`。读或写失败只发结构化日志与 `/api/health` 自愈快照信号，不阻断启动、不得使 `readyz` 转红。`delegate` 不得因计数不参与决策而跳过坏行／I/O 诊断。关闭自愈时不伪造该事件，仅输出关闭告警。
2. **文件缺失 ≠ 文件损坏**：`ENOENT` 记 `missing` 与已知计数 0，可用于首次启动；快照必须能区别于 `degraded`。若既有证据在运行中消失，按新一次读取结果记 `missing` 并告警，不谎称原事件仍存在。
3. **坏行／截断**：逐行解析，坏行或截断行跳过并累计 `skippedLines`，保留其他合法行的计数；告警与快照记录行号／错误类别，不读取或展示行业务内容。不得再让一行坏 JSON 把全文件计数清零。
4. **整文件／PVC 读写异常**：
   - 读失败（非 `ENOENT`）记 `degraded`、计数为 `unknown`，**不得显示成 0**；`window` 在未知时 fail-open 放行本次退出 75，`delegate` 本就据 K8s 退避而不按计数抑制。
   - 写失败累计 `writeFailures`、记录最近错误类别与时间；事件不得标成已持久化。读写异常均不阻断自愈、不使 `readyz` 转红。
   - 信号只走结构化日志与 `/api/health` 既有 `selfHeal` 对象内的向后兼容字段，不暴露凭据、文件内容或业务载荷。
5. **跨重启与解抑**：`window` 启动自检重建窗口内计数；之后按 `breakerWindowMs` 老化，计数降到阈值以下即允许重启。`recovered` **不扣减、不清空** `restart_requested` 历史计数，只结束当前相位并清除当前进程内存中的 `suppressed`；后续是否允许重启仍由持久化窗口计数决定。`delegate` 不据计数抑制，但事件写入、启动自检与信号仍照常。
6. 不支持 `emptyDir`；Chart 已拒绝，无该分支。

### 3.5 故障注入测程（测试基础设施，非产品功能）

测程须**版本化入库**（位置由 Plan 步骤 1b 定），并包含：

- `kubectl exec`／RBAC 清单、容器内 PID 发现、**故障生效证明**（注入后业务探针确实 100% 失败）、自动清理、原始证据保存。
- A／B／持续类各自的注入器；B 类须在新容器里持续压制至整容器重启；持续类须能跨容器重启重新注入。
- **持久化异常必须分名构造**：`chmod` 构造 `EACCES`，同名目录构造 `EISDIR`，二者不得冒充只读 PVC。只读场景用版本化 Helm post-renderer：先在 PVC 预建事件文件，再仅对主容器增加同一 `data` 卷的 `.ktx-ui/self-heal-events.jsonl` `subPath` 只读挂载；保持 `/data/lucy` 其余路径与 initContainer 可写，避免无关启动／审计失败污染断言。须证明事件写入实际返回预期只读错误，且其他合法管理读写仍可用。post-renderer 只改测试渲染结果，不改产品 Chart 模板。
- 禁止在产品内置 fault switch，不得带凭据。
- **构造不出或不能证明生效 → 相关必做项记 BLOCKED**，不得 mock 看门狗，不得人工重启替代。

### 3.6 探针阶段矩阵（K8s 侧单元格为待基线验证值）

| 阶段 | `/api/readyz` | `/api/livez` | kubelet readiness／Endpoint | 预期重启 | 证据 |
|---|---|---|---|---|---|
| NORMAL | 200 | 200 | Ready，有端点 | 否 | 探针原始样本 |
| STUCK（原位恢复中） | 503，reason=stuck | 200 | readiness 连续失败满阈值（`period 5s × failureThreshold 6`）后摘端点 | 否 | 同上＋自愈事件 |
| UNHEALTHY／排空中 | 503，reason=draining（P1-63） | 200（仍在监听） | 已摘 | 排空结束后退出 75 | 事件＋容器退出码 |
| 容器已重启，startupProbe 窗口 | 503，reason=warming_up | 200 | startupProbe 通过前 liveness／readiness 不启用；窗口上限约 5 分钟（`period 5s × 60`） | 否 | kubelet 探针结果与事件，**不是** HTTP 接口 |
| 恢复后 | 200 | 200 | readiness 成功后加端点 | 否 | 同上 |
| 重启后卡在 startup 窗口（持续类路径②） | 503，reason=warming_up 持续 | 200 | startupProbe 失败至上限（约 300 秒）后 kubelet 重启容器；进入 `CrashLoopBackOff` | 是，但由 **kubelet** 发起，退出码 143／137；看门狗因 `isExempt` 不介入 | `lastState`、事件、`--previous` 日志 |
| 持续类故障路径①（C：无抑制态；已启动后挂起） | 每个容器周期内重复上列 STUCK／UNHEALTHY／warming_up 序列 | 200 | 每周期摘端点；Pod 状态 `CrashLoopBackOff` | 是：每次排空后退出 75，由 kubelet 退避（增长或慢速抖动，见 §3.2） | `restartCount`、`lastState`、当前与 `--previous` 日志、自愈事件文件 |

`startupProbe` 是 kubelet 的探测机制，不是第三个 HTTP 接口；证据须分别记录 `/api/readyz` 响应和 kubelet 探针结果／事件。

### 3.7 排空路径与退出码

四条退出路径必须分别定义与验证，不得继续把所有自愈写成退出 75：

| 路径 | 触发 | 退出码 | 宽限 |
|---|---|---|---|
| 自退出 | 看门狗 B 步 | 75 | 不受 K8s 宽限约束（进程自行退出） |
| startupProbe 超时杀 | 非自愈路径：重启后卡在 startup 窗口，`readyz` 持续 503，看门狗不介入 | 143 或 137 | 受 `terminationGracePeriodSeconds` 约束；进入 `CrashLoopBackOff` |
| liveness 杀 | 非自愈路径：进程真正无响应（如事件循环被长时间占住）致 kubelet 的 `livez` 探测失败。**进程已无响应，无法执行排空，预期强杀 137，不属优雅排空场景**；C 不新增此类路径 | 143 或 137 | 受 `terminationGracePeriodSeconds` 约束（P1-85） |
| 删除／回滚／升级 | `kubectl delete pod`、`helm rollback`（接收**真实 SIGTERM**，是验证最长排空与宽限守恒的路径） | 143 或 137 | 同上 |

143 的主预期来自父 entrypoint 的 `trap 'shutdown 143' TERM INT`，137 表示宽限耗尽或进程无响应后的强杀。若实测为 0 或其他退出码，必须同时保留 `lastState`、entrypoint／进程日志并解释实际信号链；不得改写成 143／137，也不得误记为看门狗自退出 75。无法解释实际退出码的样本判 FAIL。本规则适用于本节、§3.2／3.6 与 SC-06／09 的所有 143／137 预期值。

### 3.8 核心流程（伪代码）

判定逻辑与阈值默认值沿用 P1-81，本节只规约集群侧行为。

```text
on watchdog_start(mode):
  evidence = read_and_validate()        # ENOENT=missing/0；坏行跳过；其他读错=degraded/unknown
  record(watchdog_started)              # 实际 append 自检；不计 maxRestarts；失败只记日志＋快照
  publish(evidence, writeFailures)      # /api/health.selfHeal；不让 readyz 因证据异常转红

on STUCK (P1-81 判定):
  readyz -> 503(reason=stuck)          # 摘端点；livez 保持 200，不得因此被 kubelet 杀
  in_place_recover up to T_A
  if recovered:
    record(recovered)                  # 不扣减历史 restart_requested；仅清当前进程 suppressed
    return

on UNHEALTHY:
  if mode == window:                    # Docker 语义不变
    result = read_counter()             # 坏行跳过；整文件读错 -> count=unknown，不是 0
    if result.count != unknown and result.count >= maxRestarts:
      suppressed (readyz 503) ; return
    # count=unknown 时 fail-open 并显式降级 (OQ-6)
  # mode == delegate (K8s, OQ-1=C)：不据计数抑制，但仍做证据诊断
  record(restart_requested) 同步写入 PVC 上的 self-heal-events.jsonl   # 先于排空；写失败只走日志与快照；不要求 fsync
  drain (P1-63, <=40s) -> process.exit(75)
  kubelet: restartCount++ , lastState.terminated.exitCode = 75, 退避生效
  startupProbe 窗口 -> readyz 200 -> 加端点

in all cases: 集群侧必须有可读信号；持续类故障表现为 CrashLoopBackOff，不宣称自愈或停止重试

never:
  让 livez 依赖业务探针或重读路径
  在 drain／startup／合法高峰下触发重启（进程内看门狗；startup 卡死由 kubelet startupProbe 处置，退出码 143／137，见 §3.2）
  使纯 MCP 合法用户在恢复后需要 WebUI Cookie 才能问数
  把降级 200 当作恢复成功
```

## 4. 验收（SC）

全部在 **B 层标准 K8s 合同台**执行，使用 Helm Chart 部署的同一最终候选镜像，**不得用 P1-81 的 Docker 跑次替代**。台由 P1-52 裁定（D-2），本条不选台；台未裁定时本节全部 SC 保持 BLOCKED。

**自愈合同**

| ID | 合同 |
|---|---|
| SC-01 | **B 类故障自愈全链**：真实注入 B 类故障（§3.5），无人工命令：`readyz` 转 503 且摘端点→容器退出码 75（`lastState.terminated.exitCode=75`）→新容器 Ready→业务按 SC-07 恢复。**必须在 SC-05 冻结预算内**。缺任一环或超预算判 FAIL；人工处置不得替代 |
| SC-02 | **A 类原位恢复**：注入 A 类故障，同一容器（`containerID`、`StartedAt` 不变）恢复，`restartCount` 不增，业务按 SC-07 恢复 |
| SC-03 | **探针阶段矩阵**：按 §3.6 逐阶段记录 `/api/readyz`、`/api/livez` 原始响应与 kubelet readiness／startup 探针结果、Endpoint 变化，与矩阵一致；合法高峰与短暂忙碌下 `livez` 不转红 |
| SC-04 | **误杀防护（K8s 版）**：标准 30 分钟合法负载、Helm `Recreate` 升级与回退、`kubectl delete pod` 排空、冷启动窗口，自愈重启次数为 0。CAV STD 采用**差分口径**：两臂使用同一最终 digest、除 `selfHeal.enabled` 外相同 Chart／values、相同 CAV 版本／种子／时长与隔离资源；开启臂不得比关闭臂新增必做失败或任何查询正确性差异，吞吐与时延按 CAV 既有指标原样差分归档，不得跑后抬线。CAV 自身绝对 verdict 由 CAV 套件另判，不因两臂共有既有失败而假绿本条。**方案 C 去掉了进程内重启上限，本条是唯一防线**：须额外构造「短暂忙碌／降级读被误判」的反例，证明不触发 STUCK，且若缩短 W 或 `inPlaceMs` 以满足恢复红线，须重跑本条 |
| SC-05 | **恢复预算与计时**：总不可用窗口**从首次合法业务失败起算，到最后一次业务稳定成交止**。分三段记录：①首次合法失败→STUCK（检测时延）；②STUCK→退出→容器启动→Ready（编排恢复）；③Ready→Endpoint 恢复→非降级展示读与正确 MCP 查询连续成功（用户可见恢复）。业务 canary 在注入前已连续成功，逐次保留统一单调时钟请求样本，不能用 Ready 反推首次失败。**总上限（红线）暂定 ≤360 秒（OQ-3 预裁定），Plan 步骤 3 依基线冻结、开发授权前不得再变；按每次独立注入的最大值判定，不取平均值；各段上限依基线分配，最终候选实测不得事后自定通过线**。口径已定：不拿 `startupProbe` 的 300 秒上限当预算；「稳定成交」＝连续 N＝3 次成功、间隔 3–5 秒，每次均满足 SC-07 |

**可观测合同（持续类故障；不是自愈承诺）**

| ID | 合同 |
|---|---|
| SC-06 | **持续故障可观测**：注入持续类故障（重启后仍复现，含外部故障）。必须有**有界退避间隔**（以合同台 kubelet 实测为准；不是重试次数上限）、`readyz` 明确 NotReady、可读原因，并按本节末「M 信号入口表」**实际取得**当前与上一容器的结构化信号。方案 C 下 K8s 无抑制态（`restart_suppressed` 仅 Docker `window` 模式出现），集群可读信号为 **`restart_requested` 事件＋退出码 75＋`CrashLoopBackOff`**。**须分别取证两条路径**：①已启动后挂起，排空后退出 **75**；②重启后卡在 startup 窗口，看门狗不介入，约 300 秒后 kubelet 重启，预期为 **143／137**，其他实际码按 §3.7 解释（§3.2）。两条均须实测 `CrashLoopBackOff` 退避，**同时覆盖「重启后立刻复发」与「Ready 数分钟后才复发」两种情形**，记录每次退避间隔、单次存活时长与是否重置；并验证典型外部故障（如数据库不可用）不触发 STUCK。不得写成「业务已自愈」或「重试已停止」。「`readyz` 永久 503、`livez` 永久 200、集群侧取不到任何信号」判 FAIL |

**横向合同**

| ID | 合同 |
|---|---|
| SC-07 | **恢复成功判定（oracle）**：Ready、Service 恢复、业务恢复**分别判定，不得互相替代**。业务恢复须同时满足：展示读为**新鲜且非降级**（`grace`／`stale`／`pending` 不算恢复，与看门狗同一定义）；Live Report 固定 URL 的非降级读取成功；至少一次真实管理页读与一次管理写并核对结果；纯 MCP 合法 Agent Token 无需 WebUI Cookie 完成 `initialize`→`tools/list`→合法查询，**返回值与独立 SQL 核对一致**。WebUI 面须真实前台浏览器并计时，与 API 耗时分列 |
| SC-08 | **断路器与证据持久化**：按 §3.4 覆盖 `ENOENT`、单行坏行、截断文件、事件文件只读 `subPath` 挂载、权限错误、同名目录与重启后恢复；两种模式均须取得 `watchdog_started` 启动自检与显式信号。坏行不得清零合法计数，整文件读错须为 `unknown` 而非 0，写失败须计数，**且 `readyz` 不因此转红、自愈不被阻断**；断言**按模式分开列**：`window`（Docker／P1-81 回归）断言 `restart_suppressed`、跨重启重建、解抑、老化及 `recovered` 不抵扣历史；`delegate`（K8s）断言**无** `restart_suppressed`，计数达 `maxRestarts` 后仍排空并退出 75，集群信号为 `restart_requested` 事件＋退出码 75＋`CrashLoopBackOff`；修改共用持久化逻辑的 P1-81 回归通过。重启前后以**已返回成功请求的唯一 ID 集**逐条核对审计恰好一次且 `ledger_seq` 水位不回退，不得只比总行数（新增行可能掩盖丢失） |
| SC-09 | **停止宽限与排空路径**：按 §3.7 四条路径分别实测：①**最长排空与宽限守恒用 `kubectl delete pod` 与 `helm rollback` 验证**（带在途长请求，真实 SIGTERM），记录 TERM、退出码、是否强杀、在途请求、按 SC-08 唯一 ID 对账的审计结果及停机期间的失败请求数（作为是否需要 `preStop` 的证据，归 P1-85）；②liveness 杀与 startupProbe 超时杀只做**观察记录**：进程无响应时预期强杀 137，不构造「真实 liveness 失败下的优雅排空」；③自退出 75 的排空随 SC-01。`terminationGracePeriodSeconds >= 45` 及其结构化门禁由 **P1-85** 交付，本条只依赖其闭合（D-1），并在此处实测验证 |
| SC-10 | **Chart、配置与交付契约**：按 §3.3 钉死字段，结构化 YAML 断言每个变量唯一且值正确，覆盖非法 values／非法运行时 mode／`extraEnvFrom` 覆盖负例；先补记 `0.2.10` 与 `K8S_CONTRACT.md` Current `0.2.9` 的既有漂移，再登记本条新 Chart 版本，`K8S_CONTRACT.md`／`UPGRADE.md`／`README.md` 不得继续把 `0.2.9` 写成 Current；交付说明含「自愈重启致 `restartCount` 增长属预期」与信号入口表；最终候选**只构建一次**，绑定 digest、Chart／values 摘要、运行中 `imageID` 闭合；步骤 6 后 Chart／values 变更同样使原闭合作废并按 OQ-5 全量重跑；升级、回滚、再次升级后业务均按 SC-07 正确。方案 C 不新增探针路径，新旧兼容为**核对项**但须覆盖双向：①旧镜像＋新 Chart 忽略未知 `BREAKER_MODE`，沿用 `window`；②新镜像＋旧 Chart 缺钉值，回落 `window`；两种混合形态均须 Ready、无新增重启循环并明确记为旧语义降级，不享有本条新自愈保障。N-1 镜像必须已支持既有 `/api/livez` 合同，否则先登记既有探针不兼容，不得冒充本条矩阵通过；若后续引入新探针路径则恢复为必做全矩阵 |
| SC-11 | **故障注入确定性与 UAT 终态**：每次注入必有生效证明、自动清理与原始证据，每个需要累计断路器次数的用例与独立恢复用例使用**隔离 namespace／PVC**；构造不出则 BLOCKED。证据至少含 Pod UID、`containerID`、`StartedAt`、退出原因、自愈事件增量、Probe／Endpoint 原始样本。对应 UAT 必做项在 K8s 合同台全真 PASS，缺口不得以 PASS WITH GAP 冒充收口 |

### M 信号入口表（SC-06 交付说明必填）

| 信号 | 读取入口 | 所需权限 | 保留／备注 |
|---|---|---|---|
| 当前容器结构化日志（含持久化异常信号；`restart_suppressed` 仅 Docker `window` 模式出现） | `kubectl logs <pod>` | `pods/log` get | 随容器重启重置；`--previous` **只保留上一代**，连续重启（含事件文件只读挂载导致写不进）会冲掉更早日志，**交付说明须提示客户接入集群级日志采集**，不得只靠 `--previous` 排查连续崩溃 |
| 退出码与重启次数 | `kubectl get pod -o jsonpath` 读 `lastState.terminated`、`restartCount` | `pods` get | Pod 被替换（如 Recreate 升级）后计数重置，**不得单独作为误杀证据** |
| Pod 事件 | `kubectl describe pod` | `events` get | 默认保留约 1 小时，不可作长期证据 |
| `readyz` reason | NotReady 后 Service 入口不可达：`kubectl exec <pod> -- curl` 本地端口，或 `port-forward` 到 Pod | `pods/exec` 或 `pods/portforward` | 须在交付说明写明故障时的替代入口 |
| 自愈事件证据 | `kubectl exec <pod> -- cat /data/lucy/.ktx-ui/self-heal-events.jsonl` | `pods/exec` | 在 PVC 上，跨容器重启保留 |

## 5. 开放项

| ID | 问题 | 默认／评审意见 |
|---|---|---|
| OQ-1 | 断路器抑制态处置 | **已裁（委托人 2026-11-24）：C**（§3.2） |
| OQ-2 | B 层合同台选型 | 归 P1-52 OQ-3（见 D-2），本条不另裁 |
| OQ-3 | 恢复预算 | **部分已裁**：口径与流程已定——预裁定红线先于基线，最终数值在基线后、开发授权前冻结；不拿 300 秒 `startupProbe` 当预算；稳定成交 N＝3、间隔 3–5 秒；`windowMs`／`inPlaceMs` 等由 Chart 钉死；缩短 W／T_A 须连带重跑 SC-04。**已预裁定（委托人 2026-11-24）：总红线暂定 ≤360 秒、N＝3（间隔 3–5 秒）**，Plan 步骤 3 依基线冻结；起点＝首次合法业务失败，终点＝连续 3 次稳定成交，按每次独立注入的最大值判定。现行常量给出的名义检测＋原位恢复＋排空约 230 秒，**不是含探针超时与调度延迟的硬上界**；其余时间给容器重启、冷启动、Ready 与连续成交。基线逼近或超过 360 秒时回报委托人：方向是**缩短**看门狗阈值（`windowMs`／`inPlaceMs`，连带重跑 SC-04，因 C 无进程内重启上限），或由委托人放宽红线 |
| OQ-4 | K8s 档字段与关闭自愈的支持范围 | **已裁**：采纳 §3.3 字段；关闭自愈为受支持的运维逃生配置，经 Chart 显式 values，启动告警，声明不享有自愈保障与探针诚实性丧失 |
| OQ-5 | P1-75 X3 对齐后的跑次规则 | **已裁（委托人 2026-11-24）**：步骤 0–5 与 P1-75 X3 并行推进；**步骤 6 的前置门禁**为「看门狗失败定义已冻结，且 P1-75 对看门狗／展示读探针的改动已合入同一分支」，门禁满足后一次性构建最终镜像并执行步骤 7 全量，**原步骤 8 取消**。步骤 6 之后凡发生导致镜像 digest 变更的改动（含看门狗、探针判定或自愈逻辑），原 digest 即作废，重建并全量重跑；凡最终 Chart／templates／values 变更，原 Chart／values 摘要与对应验收闭合同样作废，即使镜像 digest 不变，也须重新部署并全量重跑步骤 7。**延期熔断**：步骤 4 完成后 X3 仍阻塞超 2 个工作日（或无明确 48 小时内合入 ETA），由委托人判定触发，允许构建临时镜像跑 pre-X3 dry-run，范围限于 Chart 渲染、宽限排空、持久化异常、注入测程；**排除 SC-01–07** 等依赖看门狗判定与时序的验收项。dry-run 标 `pre-X3-dryrun`，不登记 PASS，不抵扣正式跑次，测试台 INDEX 与勾连表不得因此出现 PASS 或 PASS WITH GAP；跑 dry-run 须步骤 4 已获开发授权并另获测程授权。X3 合入后，步骤 4 须 rebase 并重跑看门狗单测与 P1-81 回归，再按单一最终 digest 完成正式收口。代价：P1-83 为 P0，其收口等待 P1-75；dry-run 只能提前排雷，不能提前收口。**dry-run 逐条切分见下表** |
| OQ-6 | 断路器计数不可读时是否允许重启 | **已裁**：fail-open＋显式降级；单行损坏跳过并告警；整文件／PVC 异常不阻断自愈；信号只走日志与 `/api/health` 自愈快照，**不让 `readyz` 转红**（§3.4） |
| OQ-7 | D-1 是否另立 | **已裁**：另立 **P1-85**（P1 事故修复／快修；有 K8s 台证据证明强杀或审计丢失后再议提 P0）。本条只保留依赖 |

**OQ-5 dry-run 切分（2026-11-24 委托人裁定的判据：用例触发若必须经过看门狗失败判定，或结论依赖其阈值与时序，则排除）**

| SC | 纳入 dry-run | 排除出 dry-run |
|---|---|---|
| SC-01–07 | 无 | 全部 |
| SC-08 | `watchdog_started` 启动读写自检；`ENOENT`、坏行、截断、事件文件只读 `subPath`、权限错误与同名目录的显式信号；`readyz` 不转红；`delete pod` 后按已受理请求 ID 对账审计与水位；证据文件跨重启可读 | 须真实 STUCK 触发的部分：`delegate` 下计数达上限仍退出 75；`window` 下抑制重建、解抑、老化及 `recovered` 不抵扣（由步骤 4 单测承担） |
| SC-09 | `delete pod`／`helm rollback` 的最长排空与宽限守恒；liveness 杀与 startupProbe 超时杀的观察记录 | 自退出 75 的排空（须先触发 STUCK） |
| SC-10 | Chart 渲染断言、非法值与 `extraEnvFrom` 负例、文档与版本核对、双向新旧混合形态的 Ready／无新增重启循环与旧语义记录、`helm upgrade`→`rollback`→再 `upgrade` 编排与 PVC 挂载（只验 Pod Ready 与基础存活） | 单一最终 digest 闭合；升级／回滚后的完整 SC-07 业务 oracle 核对 |
| SC-11 | 注入测程的确定性、生效证明、自动清理、隔离 namespace／PVC、原始证据采集自验 | UAT 必做项全真 PASS 的终态判定 |

**OQ-3 名义估算（来自 `stuck-watchdog.ts` 与 `process-drain.ts` 现行常量；不是硬上界，冻结时须一并冻结配置）**

| 段 | 内容 | 名义估算 | 来源 |
|---|---|---|---|
| ① 检测 | 首次合法失败→STUCK | W＝60 秒＋一个检测周期（10 秒）＝约 70 秒；**未含每次最长 8 秒探针等待与事件循环调度** | `windowMs`、`intervalMs`、`probeTimeoutMs` |
| ② 编排 a | STUCK→容器退出 | T_A＝120 秒＋整实例退出 ≤40 秒＝约 160 秒；同样须实测探针与调度开销 | `inPlaceMs`、`TOTAL_EXIT_BUDGET_S` |
| ② 编排 b | 退出→Ready | 待基线；`startupProbe` 约 300 秒是**失败判定边界，不是恢复预算或可用上界** | `values.yaml` 探针段 |
| ③ 用户可见 | Ready→Endpoint 恢复→连续成功 | 待基线；N＝3、间隔 3–5 秒为预裁定 | — |

因此 70＋160≈230 秒只用于预裁定可行性讨论。正式计时必须从同一 canary 的首次合法失败样本起算，不能用常量相加替代实测，也不能把未计入的探针／调度时间排除在红线外。

## 6. 依赖

| ID | 依赖 | 状态 |
|---|---|---|
| D-1 | Chart 显式 `terminationGracePeriodSeconds >= 45`（P1-63 的 45 秒预算在 K8s 形态未落地；SC-09 前置） | 已另立 **P1-85**：[Spec](lucy-20261124-k8s-stop-grace-spec.md)／[Plan](../plans/lucy-20261124-k8s-stop-grace-plan.md)／[`UAT-SUITE-K8S-STOP-GRACE`](../qa/uat/suites/k8s-stop-grace/suite.md)，当前 S1｜v0.1-draft、终稿未确权、开发未授权、NOT RUN；其 **OQ-1（旧 Chart 首升编排归属）待裁定**，未闭合不得主张首升已覆盖。范围：`terminationGracePeriodSeconds`＝60、门禁 ≥45、`Recreate`，不并入 `preStop`；P1-83 步骤 1⑥ 改前基线先于候选 Chart 落台。本条 SC-09 消费其改前／改后证据并决定 `preStop` 是否另议，不重复承担其 Chart 或首升编排工作 |
| D-2 | B 层 K8s 合同台（P1-52 OQ-3） | **方向已裁**：单节点 K3s、固定版本与镜像；依据 P1-52 OQ-3 本就倾向受保护 K3s。**硬约束：必须 amd64 原生节点**（`lucy-k8s-test-package` 规则；P1-52 SC-03：arm64／QEMU 不得判正式 PASS；本条验收对时序敏感，QEMU 会使恢复预算、`startupProbe`、退避失真）；资源限制须与客户配置对齐。**台尚未建成；委托人 2026-11-24 明示 amd64 机器来源暂定不了，建设授权与步骤 0／1b／1 测程授权暂缓**（建议规格：x86_64 Linux，4C8G 最低、SC-04 负载建议 8C16G，≥50GB 盘，固定版本 K3s、默认 RWO local-path；kubeconfig 与凭据不入仓库）；集群异构差异留给 C 层现场验收。P1-52 文档内的正式登记待办 |
| D-3 | P1-75 X3 对齐看门狗失败定义 | 已授权、进行中（总账 v2.73：X3／X4 服务端已落地、P1-81 探针已对齐）；**步骤 6 门禁**，规则见 OQ-5；本条最终证据须建立在冻结后的定义上 |

## 7. 授权边界

- 终稿未确权；开发未授权。本稿只是设计与登记。评审方为 Kimi Code，**非 Codex CLI 终审**。
- **改 Chart、探针、`self-heal.ts`／`stuck-watchdog.ts`、`helm-lucy-gate.sh` 等运行代码与交付配置前，须：终稿确权 → 决策闭合（OQ-1／4／6／7 已裁；OQ-3 红线已预裁定 ≤360 秒、Plan 步骤 3 依基线冻结）→ 委托人另发开发授权。终稿确权本身不等待基线，也不代替预算冻结或开发授权。**
- 在合同台上做**改前基线取证**属于测试，须测程授权，不构成开发授权。
- 故障注入测程入库属于测试基础设施，须测程授权，不改产品代码。
- 本条涉及 Chart 变更，出包与现场验收按 `AGENTS.md`「环境与交付背景」另行授权，不在本条范围内。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 方案 C 去掉进程内重启上限，假阳性 STUCK 会反复重启且无进程内次数封顶；慢速情形下约 10 分钟一次 | SC-04 反例必做；OQ-4 运维关闭开关；交付说明登记 `CrashLoopBackOff` 排查入口；缩短阈值须重跑 SC-04 |
| 退避重置：Ready 后数分钟才复发的故障使退避重置，形成 10 分钟级慢速抖动 | SC-06 两种情形实测；记录而非掩盖；退避或抖动不可接受则回 OQ-1 |
| 外部故障触发 STUCK 导致无效重启 | SC-06 验证典型外部故障不触发 STUCK |
| 台在 Mac／QEMU 上建成，时序失真使证据无效 | D-2：必须 amd64 原生节点；否则 BLOCKED |
| 重启后卡在 startup：看门狗不介入，预期退出码为 143／137，易被误判为「自愈未生效」；其他实际码也可能被漏记 | §3.2 条 5、§3.7、SC-06 分路径取证；其他码必须解释信号链，不得改写 |
| 方案 C 单周期逼近或超过 10 分钟使退避清零，退化为无递增退避的慢速循环 | §3.2 条 4：基线实测完整周期；恢复红线受影响则回 OQ-3，退避方案不可接受则回 OQ-1 |
| 新旧 Chart／镜像混合时 `delegate` 钉值缺失或被忽略，静默退回 `window` | §3.3／SC-10 双向核对；混合形态只记旧语义降级，不享有新合同；正常升级回滚必须成对恢复 Chart 与镜像 |
| 停机时 Endpoint 摘除与监听关闭竞态（Chart 无 `preStop`） | SC-09 记录停机期间失败请求数；是否加 `preStop` 归 P1-85 依证据裁 |
| 连续重启冲掉首轮日志（`--previous` 仅一代） | 交付说明提示接入集群级日志采集；`restartCount`、`lastState` 仍保留 |
| 恢复预算事后定线 | OQ-3 开发授权前冻结，最终候选不得改 |
| 合同台迟迟不建，本条无处取证 | D-2；未裁定则 BLOCKED，不降级为 Docker 证据 |
| 台与客户集群行为不一致（CNI、存储类、kubelet 版本） | 合同台通过不外推；差异登记，现场验收走 C 层 |
| 单副本 `Recreate` 下替换窗口无端点 | SC-05 总窗口含此段；交付说明登记 |
| 宽限不足导致强杀、破坏审计守恒 | D-1（P1-85）／SC-09 |
| 持久化异常信号误让 `readyz` 转红，反把 Pod 摘出 Service | §3.4 明文禁止；SC-08 断言 |
| P1-75 X3 改写看门狗判定使证据失效；或步骤 6 后 digest／Chart／values 再变 | OQ-5：X3 为步骤 6 门禁；digest 变更即重建，Chart／values 变更即作废旧摘要，均全量重跑；dry-run 排除 SC-01–07 且不抵扣；两边都改 `stuck-watchdog.ts`，X3 合入后步骤 4 须 rebase 并重跑单测与 P1-81 回归 |
| 故障难以确定性构造，用例成摆设 | §3.5／SC-11：生效证明，构造不出 BLOCKED |
| 修改共用持久化逻辑回归 P1-81 | SC-08 含 P1-81 回归；白名单明文列入 |
