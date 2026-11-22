# 客户镜像升级可靠性分层门禁 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 发布取证 Spec / **v0.1-draft** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0` |
| 功能编号 / 优先级 | **P1-52**／REQ-030-073／**P1**（发布取证；不入核心分母） |
| 台账号 | 无。挂现行 `0.30` 执行总账，不占用 v0.25 登记册 |
| 阶段 | S1 |
| 状态 | **S1｜v0.1-draft。仅登记与起草发布取证方案，评审前不开发、不执行 UAT。正式升级可靠性门禁在候选镜像生成后绑定同一 digest、Chart/values、N-1 数据与运行配置；A 层原生 amd64 容器数据与资源压力、B 层标准 K8s 持续升级为每个候选必跑，C 层客户隔离预演按验证边界触发；镜像前预检不替代镜像后验收。终稿未确权；未获开发授权；未授权不改运行代码、CI、门禁脚本与测试台；测试台 not_registered；不入核心分母；收口终态＝`X_REL`（非 S5）；≠ 可上线** |
| 决策来源 | 2026-11-18 委托人认可：①门禁绑定客户 digest 等基准线；②考虑客户侧数据量，不能只做小样本；③难以复制客户 K8s 时采用环境等价折中；④正式检测在候选镜像生成后执行，预检提前但不替代；⑤本轮只生成 Spec／Plan，评审前不进入开发和 UAT |
| 需求来源 | 客户站点升级 Lucy 0.30.0（`abb389133356`）后 readiness 持续超时、入口 502／503 并回滚；错题 [2026-11-17-k8s-upgrade-event-loop-readiness-timeout](../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md) |
| 实施主体 | 候选镜像发布链、升级可靠性测量与证据验证器、标准 K8s 升级台、客户环境画像与交付门禁。**不在本条修改 WebUI 业务运行时、KTX 源码或放宽 Helm 探针** |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「功能闭口与发布取证」「新增 Spec / Plan 的落盘清单」「第一性原理：主路径可用性优先」；[`AGENTS.md`](../../AGENTS.md)「部署方式与版本制品解耦」 |
| 与既有 Spec 的关系 | 复用 [P1-39 慢盘冷启动](lucy-20261117-cold-start-audit-scan-spec.md)、[P1-47 满量重建探针预算](lucy-20261118-rebuild-probe-budget-spec.md)、[P1-13 发版性能基线](lucy-20261113-release-perf-baseline-gate-spec.md) 和既有 H3/H4；本条只定义它们在候选发布上的组合、身份绑定与失败关闭，不改写各功能合同或其 PASS／FAIL |
| 实施计划 | [`docs/plans/lucy-20261118-customer-upgrade-reliability-gate-plan.md`](../plans/lucy-20261118-customer-upgrade-reliability-gate-plan.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 初稿。固定镜像前预检、镜像后 A/B 必跑、C 按验证边界触发；加入客户数据形状、持续 SLO、同一 digest 晋级、结构化证据、负控与交付分级。终稿未确权；未获开发授权；测试台 not_registered |

## 闭口层级

- 层级：发布取证
- 本条承诺：任一声称可交付的 Lucy 客户候选镜像，都必须在生成后以同一 digest、最终 Chart/values、明确的 N-1 持久化状态和实际交付配置通过 A 层应用／数据压力与 B 层标准 K8s 持续升级；任一指定客户的「可升级」结论，还必须证明其参数落在已验证边界内，或取得该客户隔离预演的通过证据。必做证据缺失、失败、过期、身份不符或含未关闭必做缺口时，发布结论失败关闭。
- 本条出口：SC-01–SC-18。证据包括候选身份、客户／合成数据画像、故障注入实况、全程原始样本、K8s 状态、主路径结果、验证边界判定、聚合 verdict 与最终归档身份。
- 不在本条出口：各模块自身的功能正确性；修复同步 SQLite、推断重建或其他业务代码；完整复制客户 K8s；客户生产升级本身；真实外部数据库的业务查询正确性；任何既有事故条目的关闭。
- 上线关系：本条通过不表示各模块无问题

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- 「环境画像」「验证边界」「A/B/C 分层门禁」仅用于发布取证、Runbook 和结构化证据，不新增 WebUI 产品概念。
- 「镜像可发布」与「指定客户可升级」是交付证据等级，不是新的产品版本或部署制品版本。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 本条不改变页面、组件、颜色、间距、加载态或用户可见文案。
- [ ] 本条只增加发布取证、升级测量和交付阻断。

### Exceptions (If Any)

- 无。

### Follow-up Needed

- 无。若后续新增可视化发布页面，须另立交互与 Design System 合同。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面；本条作用于候选镜像、K8s 升级演练、证据和出包流程。
- 不改变：页面路由、控件、API 业务响应、探针路径、探针超时、Helm 产品默认值和合法用户主路径。

## 1. 背景与已核实事实

### 1.1 客户事故

现场截图与错题本共同证明：

- `/api/livez` 约 2.17 秒，`/api/readyz` 约 7.55 秒；后者超过 Chart 的 3 秒探针预算。
- Pod `Running`、重启 0，但 `Ready=False`；约 18 分钟 readiness 失败百余次，Service 摘端点后入口出现 502／503。
- event loop p99 约 2.2 秒；KTX／执行层仍健康，不能把 MCP 1500ms 探测超时当成唯一根因。
- 本机慢盘＋冷缓存复现定位到同步全索引扫描和整段重建；该结论是与现场同形的受控复现，不是逐条客户现场语句归因。

### 1.2 当前发布链漏检点

| 现有层 | 已证明 | 未证明 |
|---|---|---|
| 单测／demo／热缓存夹具 | 局部功能与小规模性能 | 客户规模、冷盘和升级组合下的事件循环尾延迟 |
| H3/H4 | N-1→N、PVC 保留、最终 Ready、一次 `/api/health` | 全程 `livez/readyz/eventLoop`、外部入口 5xx、Ready 抖动和业务持续性 |
| 发布 `real-e2e` | 候选 digest 的真实管理与客户端旅程 | 从客户 N-1 旧 PVC 升级；当前部署步骤是新装候选 |
| 慢盘冷启动／RPB | 已能复现同形事故 | 尚未成为客户发布聚合的必需、同 digest 证据；种子子表为空 |
| 人工 checklist | 交付责任和现场项目清单 | 机器不可绕过的升级可靠性 verdict |

因此，本条不是再增加一份独立报告，而是把已有能力组合成**候选镜像生成后的发布硬门禁**。

## 2. 目标与非目标

### 2.1 目标

1. 把正式检测放在候选镜像生成后，并绑定不可变 digest；镜像前预检只用于提前返工。
2. 不复制客户整个 K8s，而分别复现应用、数据、资源、探针和 Service 的风险条件。
3. 用客户数据形状和规模生成夹具；没有客户内容时仍能形成保守、可审计的合成基线。
4. 从「最后一次 200」升级为全程、多平面、含合法主路径的持续 SLO。
5. 让缺失或不适用的必做证据无法被人工叙述、`|| true`、另一镜像或暂停配置结果洗成通过。
6. 区分通用候选发布结论与指定客户升级结论，不混淆证据等级。

### 2.2 非目标

- 不在本条修改业务运行时、数据库 schema、KTX、Helm 探针或 Fastify 超时。
- 不承诺数学意义上的零缺陷，也不把标准 kind/K3s 称为客户环境等价通过。
- 不把客户原始业务数据带出受控边界；本条优先需要统计画像而非内容。
- 不用暂停维护器、缩小数据、缩短窗口、放宽探针或事后调门槛关闭失败。
- 不在评审前实现任何脚本、CI job、测试台或运行 UAT。

## 3. 决策（草案）

| 编号 | 决策 | 草案裁定 |
|---|---|---|
| D1 | 检测时机 | 源码预检在构建前；A/B 正式门禁在候选镜像生成后；通过后才 promote 同一 digest |
| D2 | 候选身份 | A/B/C、聚合 verdict、最终镜像与离线包共同绑定 digest、完整提交、Chart/values 摘要、KTX 版本、N-1 身份、夹具和实际运行配置 |
| D3 | A 层 | 原生 linux/amd64 容器，真实 entrypoint／HTTP／SQLite；每个客户候选必跑 |
| D4 | B 层 | 供应方维护一种标准 kind 或受保护 K3s 合同台；使用同一候选 digest 和同档 N-1 数据，不从源码另建被测镜像；每个客户候选必跑 |
| D5 | C 层 | 仅当客户参数超出验证边界、使用无法等价的存储／自定义编排，或指定客户直接升级结论需要现场证据时，在客户隔离命名空间预演 |
| D6 | 数据等价 | 首选受控脱敏快照；否则按客户最大已知规模生成统计等价数据。必须包含主表、子表、索引、派生状态和长尾分布，禁止只灌 `access_log` |
| D7 | 配置等价 | 默认交付配置和实际交付 values 分别判定；`LUCY_INFERRED_MAINTAINER=off` 等缓解结果只能证明该精确配置，不能证明默认配置 |
| D8 | 持续判定 | 同时采容器内探针、K8s 状态、Service/Ingress 和合法主路径；单次 health 200 或 RestartCount=0 不足 |
| D9 | 观察窗 | 草案最低首次 Ready 后 30 分钟，并覆盖本轮迁移／后台补算及完成后至少 5 分钟稳态；到场景上限仍未收敛则失败或阻塞，不得截断后判绿 |
| D10 | 验证边界 | 数据规模、磁盘、CPU、K8s／runtime、Chart／探针均有版本化边界；范围内可免 C，范围外必须扩大 A/B 或执行 C，未知不得写成范围内 |
| D11 | 失败关闭 | 必做项 FAIL、BLOCKED、NOT RUN、PASS WITH GAP、证据过期、原始样本缺失、digest 不符均不能产生 `releaseReady=true` |
| D12 | 出包入口 | CI、标准手工出包和最终归档复验调用同一验证器；客户模式缺边界判定时不能声称指定客户可升级 |
| D13 | 门禁反证 | N-1 对照必须通过；已知事故构建或冻结的等效坏实现必须被拦；限速／冷缓存／CPU 限制须先证明生效 |
| D14 | 变更失效 | 镜像、Chart、values、KTX、探针、数据画像、门槛或 runner 判定逻辑变化，会使相应证据失效并触发重跑；不得只改文档沿用 PASS |
| D15 | 回滚边界 | B 覆盖失败升级、受控回退和再次升级；有数据迁移时，Helm rollback 不能替代兼容性与备份恢复验证 |
| D16 | 既有失败 | P1-47 等既有必做 FAIL 保持原判；本条不得通过聚合或配置替换将其改写为通过 |

## 4. 分层设计

### 4.1 构建前预检（不计入正式发布通过）

- 单测、类型检查、SQL 执行计划守卫、启动与后台任务静态检查。
- 检查数据画像和交付配置是否齐全，避免构建明显不可测候选。
- 预检可以提前失败，但不能产生任何镜像升级可靠性通过结论。

### 4.2 A 层：应用、数据与资源压力

在原生 amd64 runner 上运行最终候选 digest：

| 维度 | 必覆盖 |
|---|---|
| 数据 | N-1 schema；主表与全部关联子表；索引／WAL；推断和恢复状态；用户长尾；文件字节与行数不低于画像下限 |
| 资源 | 经验证的磁盘吞吐／IOPS／延迟、CPU limit／throttling、冷页缓存 |
| 生命周期 | 首次升级、已迁移重启、稳态清缓存、后台重建与业务并发、必要的回退／再升级 |
| 配置 | 默认配置；若实际交付含缓解开关，再按精确交付 values 增加一组，不能替代默认组 |
| 主路径 | 管理员登录或既有会话、项目读取、MCP initialize／tools/list、轻量业务调用；真实问数按既有业务预算另记 |

A 层不需要 K8s 即可发现本次事故的同步阻塞；但不能单独证明 Ready 摘端点和 Service 行为。

### 4.3 B 层：标准 K8s 持续升级

标准台只负责通用编排合同，不追求复制客户 CNI／Ingress 品牌：

1. 安装明确的 N-1 镜像与 Chart，载入同档 N-1 持久化状态。
2. 从 Service 内和外部入口开始连续采样，再执行到候选 digest 的真实升级。
3. 记录 rollout、Ready、probe events、restart、endpoints、HTTP 状态和耗时。
4. 首次 Ready 后继续完整观察窗，并执行主路径。
5. 验证失败升级与受控回退；有迁移时验证数据兼容／恢复路径，再执行再次升级。
6. 被测镜像必须来自候选身份，不允许在 H3 job 内从当前源码另建一个镜像代替。

### 4.4 C 层：客户隔离预演

只复用客户真正无法供应方等价模拟的条件：

- 独立命名空间、独立 PVC 和独立实例身份；不暴露正式入口，不连接生产写入路径。
- 使用相同 StorageClass 与资源策略；数据来自备份恢复或同规模合成夹具。
- 执行与 B 相同的 N-1→候选升级、持续采样和主路径。
- 输出与 A/B 相同 schema 的脱敏证据；客户现场通过不能替代下一 digest 的 A/B。

## 5. 环境画像与验证边界

### 5.1 客户画像最小字段

| 类别 | 字段 |
|---|---|
| 身份 | 客户 slug、N-1 镜像 digest／提交、Chart／values 摘要、KTX、实际探针与部署策略 |
| 平台 | K8s／container runtime、CPU requests／limits／throttling、StorageClass／PV 类型 |
| 存储 | 吞吐、IOPS、延迟／fsync 画像及测量时间；未知保持 null，不填乐观默认值 |
| 数据 | N-1 schema、主库／WAL 字节、各表与索引行数／字节、子表规模、时间跨度、用户分位数与最大长尾 |
| 隐私 | 只保存统计与脱敏身份；不得包含密码、Token、DSN、业务行内容或完整私有 values |

画像与边界分别计算 `profileDigest` 和 `envelopeVersion`，写入 verdict。

### 5.2 边界判定

| 判定 | 含义 | 放行 |
|---|---|---|
| `within_envelope` | 所有必需要素不超出已验证范围 | A+B 通过后可形成指定客户升级结论 |
| `outside_envelope` | 数据更大、资源更差或编排不等价 | 先扩大 A/B；仍不能覆盖则 C 必做 |
| `unknown` | 任一必需要素缺失或不可验证 | 可保留通用镜像结论；禁止指定客户「已验证可升级」 |
| `evidence_invalid` | 身份、时间、签名或配置不匹配 | 阻断，不得降级为 within |

## 6. 持续 SLO（草案下限）

绝对门槛沿用 P1-39／P1-47 的既有量级并增加零容忍项；若上游功能合同收紧，本条取更严格值，不能反向放宽上游。

| 维度 | 首次升级补算窗口 | 重启／稳态／清缓存后 |
|---|---|---|
| 首次 Ready | ≤150 秒；进程不退出、重启 0 | 重启 ≤60 秒 |
| `livez` | p99 ≤1000ms、max ≤2000ms | p99 ≤400ms、max ≤1000ms |
| `readyz` | p99 ≤1500ms；任何样本不得达到实际 3 秒探针超时 | 同左 |
| event loop | 记录全程原始值 | p99 ≤400ms；超过即失败 |
| Ready | 首次 Ready 后不得 Ready→NotReady | 同左 |
| 入口 | 公告切换窗口之外非预期 502／503＝0；宣称平滑升级时可用 endpoints 不得归 0 | 非预期 5xx＝0 |
| 主路径 | 全部成功；轻量步骤 ≤5 秒或适用上游更严格预算 | 同左 |
| 采样 | 状态码与耗时同时有效；401／403／5xx 不得当作性能样本 | 同左 |

对单副本 Recreate，只按已公告维护窗判定切换中断，不能宣称平滑升级。对声称平滑升级的路径，适用 endpoints 与外部入口零容忍。

## 7. 证据合同（草案）

每次运行至少产生 `upgrade-reliability.json` 和不可改写的原始样本文件；聚合器只消费结构化结果，不解析 stdout 中的 PASS。

```yaml
contract: lucy-upgrade-reliability-v1
status: passed | failed | blocked
releaseReady: boolean
candidate:
  imageDigest: sha256:...
  gitSha: 40-hex
  ktxVersion: string
  chartDigest: sha256:...
  valuesDigest: sha256:...
  deliveredConfigDigest: sha256:...
baseline:
  imageDigest: sha256:...
  schemaVersion: string
profile:
  profileDigest: sha256:...
  source: redacted_snapshot | statistical_synthetic
  dataShape: object
resources:
  envelopeVersion: string
  faultInjectionProof: object
runs:
  A: scenarioResults
  B: scenarioResults
  C: scenarioResults | not_required | required_missing
customerDecision: within_envelope | outside_envelope | unknown | not_applicable
samples:
  files: [{ path, sha256, startedAt, endedAt }]
thresholds:
  specVersion: string
  scenarioDeadlines: object
problems: [{ severity, code, message }]
```

`status=passed` 必须与进程退出码一致；`releaseReady=true` 仅在所有必需层和边界判定通过时成立。collect、dry-run、历史跑次和暂停配置对照不得覆盖正式 verdict。

## 8. 核心流程（伪代码）

```text
function certifyCustomerUpgrade(request):
  precheck(request.source, request.profile)       # 只提前返工，不产生发布通过
  candidate = buildCandidateOnce(request.source) # linux/amd64；记录 digest
  identity = freezeIdentity(candidate, request.chart, request.values,
                            request.n1, request.deliveredConfig)

  a = runLayerA(identity, request.profile, request.envelope)
  b = runLayerB(identity, request.profile)        # 同一 digest；禁止另建 N 镜像
  decision = classifyCustomer(request.profile, request.envelope)

  if decision == outside_envelope and not coveredByExpandedAB(a, b, request):
    c = requireCustomerIsolatedRun(identity, request.profile)
  else if decision == unknown and requestsSpecificCustomerClaim(request):
    c = requireCustomerIsolatedRun(identity, request.profile)
  else:
    c = notRequired()

  evidence = assembleAndVerify(identity, a, b, c, decision,
                               rawSamples=true, thresholds=specVersion)
  if identityChangedAfterFreeze(identity) or evidenceExpired(evidence):
    return BLOCKED("evidence_invalid")
  if anyRequiredMissingOrNotCleanPass(evidence):
    return FAIL_OR_BLOCKED("releaseReady=false")
  if negativeControlWasNotRejected() or n1ControlDidNotPass():
    return FAILED("gate_has_no_discriminating_power")

  promoteExactDigest(candidate.digest)            # 不重建、不改运行容器
  if archiveChangedImageChartValuesOrConfig(identity):
    invalidate(evidence)
    return BLOCKED("rerun_required")
  return passedVerdictForDeclaredEvidenceLevelOnly()
```

任何失败都回到源码修复或环境校准，再生成新候选；禁止通过修改探针、夹具、样本或阈值规避。

## 9. 验收（草案）

| 编号 | 承诺 | 打假方式 |
|---|---|---|
| SC-01 | 构建前预检与构建后正式证据分离；只有后者能进入发布 verdict | 用只有源码预检通过的候选验证仍为 blocked |
| SC-02 | A/B/聚合/最终包绑定同一 digest、提交、Chart/values、KTX、N-1 和交付配置 | 替换任一字段必须失败 |
| SC-03 | A 在原生 amd64、真实镜像／entrypoint／HTTP／SQLite 上运行 | arm64、QEMU 替代或 mock 不能判正式 PASS |
| SC-04 | 数据夹具达到画像下限，包含主表、子表、索引、派生状态与长尾 | 只灌 `access_log`、缩小行数或空子表不得判完整 PASS |
| SC-05 | 限速、冷缓存和 CPU 限制先生效证明；N-1 对照通过，坏构建被拦 | 关闭限速或放入已知坏实现，判定器必须失败 |
| SC-06 | A 覆盖首次升级、重启、清缓存、后台重建并发和实际交付配置 | 缺任一场景即 blocked；暂停组不替代默认组 |
| SC-07 | B 使用同一候选 digest 做真实 N-1→N，不另建被测镜像 | 尝试使用另建 `ci-n` 或 imageID 不符必须失败 |
| SC-08 | B 全程记录容器探针、K8s、Service/Ingress 和原始状态码／耗时 | 只有最终 Ready 或一次 health 200 不得通过 |
| SC-09 | §6 SLO 全量判定，含 readyz 3 秒零容忍、Ready 稳定和非预期 5xx | 注入一次超时／摘端点／5xx 必须失败 |
| SC-10 | 合法管理员与纯 MCP 主路径在约束生效后仍可用 | 只验证拦截或健康，不跑主路径不得通过 |
| SC-11 | within／outside／unknown／invalid 四分支与 C 触发正确 | 四组夹具；unknown 不得冒充 within |
| SC-12 | C 只写隔离命名空间／PVC，证据脱敏且绑定同一身份 | 正式入口、生产写路径或身份不符时拒绝取证 |
| SC-13 | 必做 FAIL／BLOCKED／NOT RUN／PASS WITH GAP 均失败关闭 | 聚合反向测试逐类验证 `releaseReady=false` |
| SC-14 | CI、手工出包和归档复验使用同一验证器；变更使证据失效 | 任一旁路或归档身份漂移必须阻断 |
| SC-15 | 原始样本、退出码和 JSON 状态一致；collect／dry-run 不覆盖正式 verdict | 伪造 stdout PASS、状态／退出码矛盾必须失败 |
| SC-16 | 证据不含密码、Token、DSN、业务行内容或完整私有 values | 泄漏扫描命中即失败 |
| SC-17 | 新命令、CI job、测试台与 Runbook 在授权实施时登记到对应 SOT | 文档 diff＋工作流合同测试；当前均为草案，不宣称已接线 |
| SC-18 | 本条 diff 不改业务运行时、KTX、探针超时或既有 P1-39／P1-47 判定 | 路径白名单与状态复核 |

测试台当前：not_registered。评审前不创建跑次、不执行 UAT；后续若登记套件，判定只认 `docs/qa/uat/INDEX.md`。

## 10. 开放项（评审前不定稿）

| ID | 问题 | 草案倾向 |
|---|---|---|
| OQ-1 | 首版验证边界以哪个客户／哪组最大已知规模为种子 | 以本次事故客户的 20 万行／67 用户／约 943MB 为下限，同时补齐子表；后续取支持客户最大包络，不取平均 |
| OQ-2 | 30 分钟最低观察窗与长补算场景上限 | 保留 30 分钟最低值；场景上限按数据画像分档并写入 thresholds，不允许无限挂起或提前截断 |
| OQ-3 | B 层标准台选 kind 还是受保护 K3s | 优先复用受保护 amd64 K3s 以便按 registry digest 部署；kind 仅在能证明运行身份完全闭合时使用 |
| OQ-4 | 客户画像未知时是否允许通用镜像继续发布 | 允许 A+B 全过的通用结论，但客户定向包必须标 unknown，不能写「该客户已验证可升级」 |
| OQ-5 | C 层执行授权与数据操作边界 | 每次客户侧执行另获授权；优先只读画像与备份恢复，禁止默认对生产 PVC 做写压测 |
| OQ-6 | 既有 `customer-release-readiness` 与客户手工包如何分阶段切换 | 同一定稿内给出迁移期；迁移期内也不能把缺新证据写成升级可靠性 PASS |

## 11. 授权后实施白名单（当前不执行）

允许在终稿确权并另获开发授权后修改：

- `.github/workflows/lucy-release.yml` 及必要的工作流合同测试。
- `scripts/gates/` 下升级可靠性 runner、证据 schema／验证器、H3/H4 与聚合接线及测试。
- `scripts/uat/` 下既有慢盘／重建夹具的画像扩展；执行 UAT 仍须按委托人要求另行放行。
- `deploy/k8s/gate/`、`deploy/k8s/security-e2e/` 的标准升级台与采样配置。
- 根 `package.json`、`docs/governance/test-layers-and-release-gates.md`、`docs/governance/release-ci.md`、客户出包 Checklist／Runbook 和对应索引。
- 获 UAT 授权后，新增专用套件并登记 `docs/qa/uat/INDEX.md` 与 e2e-ledger。

禁止在本条修改 `webui/src/**`、`webui/server/**`、KTX 源码、业务数据库 schema、Helm 产品探针超时或既有事故功能合同。若测试证明需要这些改动，另立或恢复相应条目并单独授权。

## 12. 风险

| 风险 | 处理 |
|---|---|
| 统计合成数据仍漏掉真实数据形态 | 保留快照优先、画像版本和 unknown；客户负控复现失败时更新夹具，不放宽门槛 |
| 本地 blkio 不能等价 Ceph／NFS 等存储语义 | 标 outside_envelope，执行 C；不声称 IOPS 数字相同即全部等价 |
| B 台身份无法闭合 | 选可按 digest 部署的受保护 K3s；身份不闭合即 blocked |
| 观察窗拉长拖慢发布 | 预检并行化，但不得缩短正式窗口；明确场景上限和失败原因 |
| 客户画像缺失阻断所有工作 | 通用镜像与指定客户结论分级；未知只阻后者，不能伪绿 |
| 出包入口绕过 | 所有入口共享验证器；工作流与归档反向测试覆盖 |
| 用本条代替业务修复 | 白名单禁止业务运行时改动；测试发现的问题回原功能条目 |

## 13. 落盘清单自检

| 项 | 本条 |
|---|---|
| Spec／Plan 共用 slug | `lucy-20261118-customer-upgrade-reliability-gate` |
| 层级 | 发布取证 |
| 元数据／Plan 五类小节 | 已包含 |
| 核心流程伪代码 | §8 |
| 术语／Design System／交互豁免 | 已包含 |
| 总账与需求池 | P1-52／REQ-030-073；编号避让在途 50／51 与 71／72 |
| 索引 | 由本轮后续写入 `docs/README.md` 与 `docs/plans/README.md` |
| 测试台 | not_registered；评审前不开发、不执行 UAT |
| 新命令／CI job | 目前仅草案，未创建；授权实施时按 SC-17 登记 |
