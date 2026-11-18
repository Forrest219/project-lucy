# MCP 升级兼容底线与全真用户旅程门禁 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 发布取证 Spec／**v0.1-draft** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-53**／REQ-030-074／**P0 底线**。不入 0.30 核心分母 |
| 台账号 | 无。挂现行 `0.30` 执行总账；编号避让 P1-52／REQ-030-073 |
| 状态 | **v0.1-draft。委托人已批准双层门禁、全真用户旅程题库与绝对＋相对耗时双门禁；本文仅落盘合同与实施计划，终稿未确权、开发未授权。测试台 `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`＝NOT RUN。本任务不重建 Docker；未授权不改运行代码、测试执行器与发布门禁。≠ 可上线** |
| 决策来源 | 2026-11-16 客户 WorkBuddy「会员收入」被 `source_ambiguity_gate` 高频阻断；委托人要求每次升级不得破坏既有 MCP 问数能力，并批准：①通用事故回归＋客户真实基线，无基线不升级；②独立问题、连续追问、单表／多表、无权限／分权限、单库／多库全真 Agent 题库；③记录用户端到端耗时；④绝对上限＋相对退化双门禁及首版阈值 |
| 错题与证据 | [表级歧义门闩死路](../lessons/2026-11-16-source-ambiguity-gate-deadlock.md)；[主路径可用性优先](../governance/DEVELOPMENT.md)；客户截图仅作外部会话证据，不入库 |
| 实施主体 | `scripts/e2e/` 全真 Agent／MCP 执行器与版本化题库、`scripts/upgrade/` 与 `scripts/gates/` 升级接线、发布证据校验器、测试台。不得修改 KTX 源码 |
| 配套 Plan | [lucy-20261118-mcp-upgrade-compatibility-plan.md](../plans/lucy-20261118-mcp-upgrade-compatibility-plan.md) |
| 测试台 | [`UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`](../qa/uat/suites/mcp-upgrade-compatibility/suite.md) |
| 关联合同 | [P1-35 纯 MCP 逃生](lucy-20261116-source-ambiguity-mcp-escape-spec.md)、[P1-37 MCP 体验韧性](lucy-20261116-mcp-ux-resilience-spec.md)、[P1-13 发版性能基线](lucy-20261113-release-perf-baseline-gate-spec.md)、P1-52 升级可靠性（并行登记）、[真实用户 E2E](lucy-20261018-enterprise-security-and-real-e2e-spec.md) |

## 闭口层级

- 层级：发布取证
- 本条承诺：客户候选版本与客户实例升级必须证明「既有合法 MCP 问数仍能成交、安全拒绝未放宽、用户体感未越绝对预算且未发生不可接受的相对退化」。证明同时来自版本化全真用户旅程和该实例升级前真实成功基线；健康检查、Pod Ready、`tools/list`、单测或 Code Review 均不得替代。
- 本条出口：SC-01–SC-20；客户发布聚合器只接受同一候选 digest、同一题库摘要、完整必做分母下的明确 PASS。任何必做项 FAIL／BLOCKED／NOT RUN、基线缺失或证据身份不匹配，均不得放行。
- 不在本条出口：修改门闩、ACL、行权限或 KTX 行为；修复被本题库发现的任何产品缺陷；客户生产升级或自动回滚；新增 WebUI 页面；移动窄屏；为本任务重建本地 Docker；承诺所有客户未来所有可能问题均被题库覆盖。
- 上线关系：本条通过不表示各模块无问题；本条未通过则不得把该候选描述为升级兼容。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **MCP 问数兼容基线**：升级前在指定实例上，使用既有身份经 Public MCP URL 成功完成的一组版本化查询及其可比较结果、环境与耗时事实。
- **真实用户旅程**：真实 Agent 接收自然语言，经 Public MCP、Lucy、真实数据库形成最终答案的完整过程；直接 MCP 调用只是对照，不冒充真实用户旅程。
- **功能零回归**：基线中合法成功的查询在候选上仍成功且保留约定结果；基线中应拒绝的查询仍拒绝且不泄露。
- **用户端到端耗时**：从用户提交一轮自然语言问题到真实 Agent 输出该轮完整最终答案的墙钟。
- **绝对预算／相对退化**：前者是不得超过的固定体验上限；后者是相对同实例升级前基线的可接受恶化范围。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`
- `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`

### What This Change Follows

- [ ] 不新增或改变 WebUI 页面、组件、路由、交互和视觉样式。
- [ ] 用户可见错误与术语只通过真实客户端自然产生；测试报告使用既有产品术语。

### Exceptions (If Any)

- 无。本条为测试、证据与发布门禁。

### Follow-up Needed

- 若后续把结果做成 WebUI 看板，须另立功能 Spec 与交互合同，不在本条夹带。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面，不新增页面或控件。
- 不改变：路由、页面、按钮、空态、错误态、确认面、浏览器交互。

## 1. 已核实现状与缺口

1. `scripts/uat/mcp-session-regression.mjs` 已能经真实 MCP 调 `lucy_catalog`、`lucy_read_source`、`lucy_query` 并检查真实指标，但专注 Session，不是版本化用户旅程题库。
2. `scripts/gates/k8s-acceptance.sh` 当前 MCP 终点为 `initialize`＋`tools/list`；`scripts/gates/k8s-upgrade-gate.sh` 验证镜像、PVC、`.git` 与 `/api/health`，均不证明问数成交。
3. Compose `upgrade-lucy.sh` 默认只等待 `/api/health` 与保留标记。
4. ESC-01～10 已有事故场景和一次全真 PASS，但执行证据引用临时 `inbox` 脚本，尚不是每次出包与升级强制执行的稳定门禁。
5. P1-13 已定义 MCP 热路径绝对＋相对性能门禁，但明确不含真实 LLM 端到端耗时；本条补充而不改写 P1-13。
6. P1-52 负责镜像、数据规模、资源和持续升级可靠性；本条负责真实用户问数功能、权限与体验兼容，两者都必需，互不替代。

## 2. 决策（Normative）

| ID | 决策 | 裁定 |
|---|---|---|
| D1 | 双层门禁 | 通用版本化题库＋实例真实基线缺一不可；无基线、基线不可读、未执行或分母不足均 BLOCKED |
| D2 | 双执行面 | 每个通用业务场景必须有真实 Agent 自然语言旅程；关键场景另有确定性 MCP 同参数对照。直连脚本不得计入真实 Agent 客户端分母 |
| D3 | 全真 | 使用真实 Agent、Public MCP、Lucy、真实数据库与真实 Role／Token；禁止 mock 数据库、预置最终答案、绕过 ACL、直连 KTX `:7878` 或以 Code Review 代替 |
| D4 | 客户身份 | 客户基线使用既有只读 Token；候选与升级后使用同一 Token。确因安全轮换而不能复用时为 BLOCKED，不临时换高权 Token 凑绿 |
| D5 | 覆盖矩阵 | 独立简单问题、过滤／时间／合法空结果、同会话连续追问、单表、多表 join、单库、多库分别查询与对比、无权限、表／行／字段分权限及合法对照全部必做 |
| D6 | 事故永久看守 | WorkBuddy「会员收入」同形题永久保留；通用 demo 必须构造泛化业务词多表命中但请求已钉唯一来源的首次查询，客户层重放实际基线 |
| D7 | 结果判定 | 固定夹具用 typed gold；客户动态数据比较指标名、结果行列形状、基线非空性与明确容差。原非空候选为空、预期指标缺失、新增 deny／error／空信封均 FAIL；数据已变化到不可比则 BLOCKED，不得改判 PASS |
| D8 | 安全负例 | 无权限与受限权限场景必须仍拒绝、无可执行上游越权查询且无敏感泄露；从 deny 变 allow 是 FAIL。每个拒绝场景配同身份或对照身份的合法成交用例 |
| D9 | 连续追问 | 在同一 Agent 会话与同一 Lucy 旅程中连续发问；另开会话、重复完整上下文或把每轮改写成独立问题不得作为该场景 PASS |
| D10 | 多库 | 合法主路径是分别经授权连接查询再比较；不得为了 PASS 发明跨连接 join。非法跨连接混查须明确拒绝并给出按连接拆分的下一步 |
| D11 | 绝对耗时 | 权限／门闩拒绝 P95≤500ms、P99≤2s；简单单表 `lucy_query` P95≤5s；复杂多表／多库查询 P95≤30s；真实 Agent 每轮端到端≤120s |
| D12 | 相对耗时 | 确定性 MCP：P95 增幅>20% 且绝对恶化>50ms 为 FAIL；真实 Agent：至少 3 次，中位数增幅>20% 且绝对恶化>2s 为 FAIL。任一绝对预算越线均 FAIL |
| D13 | 样本 | 确定性 MCP 每场景每版本至少 20 个有效样本，nearest-rank P95；真实 Agent 每场景、每必需客户端、每版本至少 3 次，所有尝试保留，禁止只挑最快或成功跑次 |
| D14 | 冷启动 | 在既有冷启动／readyz 套件之上记录 Ready 后首轮 MCP 与真实问答，首轮仍受相同绝对预算；不得以稳态样本替代冷启动首轮 |
| D15 | 环境可比 | 相对对照必须同实例数据快照、同 Token／Role／策略、同连接、同 Agent／模型／版本、同题库与同级运行环境；任一不可比为 BLOCKED |
| D16 | 无豁免 | 本条不接受 `PASS WITH GAP`、`acceptedRegressionNote`、`--allow-blocked`、跳过必做客户端或调低阈值放行。阈值或题库变更须修订 Spec、重审题库摘要并作废旧证据 |
| D17 | 私有基线 | 含原始工具参数与过滤值的基线存于 Git、inbox、公共交付包之外的实例私有附件，目录 0700、文件 0600；不含 Token、Session ID、数据库密码与原始业务行。公开证据只含 case ID、版本、摘要、指标名、计数、耗时与判定 |
| D18 | 候选绑定 | 通用、实例演练与升级后证据均绑定 runId、实例、完整 gitSha、镜像 digest、题库 SHA256、客户端／模型版本与 Token 指纹；发布只晋级被测 digest |
| D19 | 接线 | 通用 PASS 是客户出包前置；实例 PRE PASS 是升级前置；候选演练与升级后 POST PASS 是验收前置；回滚后亦须恢复基线。失败不自动改生产，由既定回滚 Runbook 处置 |
| D20 | Docker 约束 | 本任务本机不执行 Docker 重建、镜像构建或容器重建；只复用现有实例。没有匹配现有候选时记 BLOCKED，不得以本地新造镜像代替 |

## 3. 版本化题库

题库正本计划落在 `scripts/e2e/contracts/mcp-upgrade-journeys.yaml`，UAT 剧本落测试台。每题冻结：自然语言轮次、预期来源与 typed gold／拒绝类别、身份标签、连接与数据快照、MCP 对照参数、样本数、绝对预算、相对比较键和证据槽。

| 场景族 | 必做内容 |
|---|---|
| 独立单表 | 简单指标；时间／过滤／分组；合法空结果；客户会员收入同形 |
| 连续追问 | 「那 12 月呢？」→「再按区域拆分」→「和上月相比呢？」；检查月份、分组与比较上下文未丢 |
| 单表到多表 | 同会话从订单扩展到已声明 join 的退货／人员；首轮与追问均须成交 |
| 多库 | 对连接 A／B 分别查询并比较；未授权连接与非法跨连接混查有明确拒绝和下一步 |
| 权限 | 无 `lucy_query`、无 Source、表 A 可见表 B 不可见、华东／西南行权限、字段暴露；每项含合法对照与泄露检查 |
| 生命周期 | 旧版 PRE、候选冷启动、稳态、升级后 POST、回滚后；每阶段保留独立证据 |

## 4. 核心流程（伪代码）

```text
function certifyUpgrade(instance, oldCandidate, newCandidate, suite):
  require suite.schemaValid && suite.digest == approvedDigest
  require oldCandidate.identity != newCandidate.identity

  pre = executeAllRequired(instance, oldCandidate, suite, phase="PRE")
  if pre.status != PASS: return BLOCKED_OR_FAIL(pre)

  generic = executeGenericFullRealPack(newCandidate, suite)
  if generic.status != PASS: return FAIL_OR_BLOCKED(generic)

  post = replaySameIdentityAndArgs(instance, newCandidate, pre.privateBaseline)
  if post.status != PASS: return FAIL_OR_BLOCKED(post)

  for case in suite.requiredCases:
    assertFunctionalZeroRegression(pre[case], post[case], case.expectation)
    assertAbsoluteBudgets(post[case], case.budgets)
    assertComparable(pre[case], post[case])
    assertRelativeBudget(pre[case], post[case], case.metricClass)

  evidence = redactAndBind(pre, generic, post, suite.digest, newCandidate.digest)
  return PASS only if every required case and client passed every required attempt
```

### 多步状态机合同

- 状态集：`BASELINE_MISSING` → `PRE_RUNNING` → `PRE_PASS` → `CANDIDATE_RUNNING` → `POST_RUNNING` → `PASS`；任一执行可进 `FAIL` 或 `BLOCKED`。
- 合法转移：只允许上述顺序；`PRE` 未 PASS 不得进入候选演练；`POST` 未 PASS 不得进入发布 PASS。
- 终态：`PASS`／`FAIL`／`BLOCKED`。`PASS` 不是 Pod Ready 的同义词。
- 非终态持久化：每次尝试即时写脱敏证据；私有基线写入私有附件，进程中断后按 runId 续读，不把半次运行写成完成。
- 逃生边：产品合法查询必须成交；测试流程失败只停止放行并进入既有回滚 Runbook，不自动修改生产。
- 禁止用单一布尔／`ok` 冒充终态；发布判定必须同时满足功能、权限、绝对耗时、相对耗时、身份与完整分母。

## 5. 计时与证据

| 字段 | 含义 |
|---|---|
| `turnWallClockMs` | 用户发问到 Agent 完整答案的端到端墙钟 |
| `mcpClientRttMs[]` | 客户端观察到的每次 MCP 请求往返，含重试并标明 attempt |
| `serverDurationMs[]` | `access_log.duration_ms` 的服务端事实，与请求 ID 对账 |
| `stageDurations[]` | trace span 存在时记录真实阶段；缺 span 不得编造精确归因 |
| `unattributedMs` | 端到端墙钟减去已观测区间后的余量，只称未归因，不武断全算数据库或模型 |
| `samples` | P50／P95／P99／max／中位数、样本数、超时数、所有尝试指针 |

证据不得记录 Token、Session ID、连接秘密或原始客户业务行。公开报告中的时长、指标名、行列计数与判定不能反推私有过滤值。

## 6. 发布与升级接线

1. **客户出包**：`customer-release-readiness` 读取并独立重验 `results/mcp-compatibility.json`；缺失、摘要错误、候选 digest 不同或非 PASS 均 `releaseReady=false`。
2. **K8s 候选升级**：H3 在健康检查后执行 PRE／POST 兼容回放；H4 回滚后再跑基线，证明恢复而非只恢复 imageID。
3. **现场验收**：`k8s-acceptance.sh` 在 `tools/list` 后执行实例基线回放；诊断用的 `--skip-mcp` 不产生可发布证据，聚合器仍失败关闭。
4. **客户 Compose**：`upgrade-lucy.sh` 的客户配置路径要求私有基线与 Token 文件，健康检查后回放；开发 demo 不伪称客户基线。
5. **回滚**：门禁脚本不擅自执行生产回滚；失败后验收不通过，操作者按已备份 revision 与 Runbook 回滚并再验。

## 7. 验收（SC）

| ID | 标准 | 证据 |
|---|---|---|
| SC-01 | 题库 schema、稳定 ID、完整覆盖矩阵、版本与 SHA256 可机检；缺任一族失败 | 题库契约测试 |
| SC-02 | 真实 Agent 链路含 release profile 要求的自动客户端与手工 WorkBuddy／Cursor；直连 MCP 不冒充 Agent | 全真 runs＋客户端证据 |
| SC-03 | 独立单表、过滤／时间／分组与合法空结果 typed gold 正确 | COMPAT-01／02 |
| SC-04 | 同会话连续追问保持时间、分组、比较上下文；禁止重开新会话凑绿 | COMPAT-03／04 |
| SC-05 | 单表、多表 join、单表扩展多表均成交且结果正确 | COMPAT-05 |
| SC-06 | 多库分别查询与对比成交；非法跨连接混查拒绝且可执行下一步，无越权 | COMPAT-06 |
| SC-07 | 无工具／Source／表／行／字段权限均安全拒绝；合法对照成交；deny→allow 与泄露均 FAIL | COMPAT-07／08 |
| SC-08 | 泛化业务词＋唯一钉表首次 `lucy_query` 不得被 `source_ambiguity_gate`；客户会员收入基线重放成交 | COMPAT-09 |
| SC-09 | PRE／POST 同 Public URL、Token、参数、数据快照、客户端与模型；缺基线或不可比为 BLOCKED | 基线绑定测试＋现场证据 |
| SC-10 | 原成功请求新增 deny／error／空信封／非空变空／预期指标缺失均 FAIL；原拒绝变允许均 FAIL | 判定器反向测试＋全真 |
| SC-11 | 每轮端到端、MCP RTT、服务端耗时、重试、样本数与全旅程总时长完整；冷启动首轮单列 | COMPAT-10／11 |
| SC-12 | D11 全部绝对预算自动判定；越线即使比旧版快也 FAIL | 判定器＋COMPAT-11 |
| SC-13 | D12／D13 相对门禁与样本下限自动判定；缺基线不假绿 | 判定器＋COMPAT-12 |
| SC-14 | 含事故门闩的旧版真实负控被 COMPAT-09 拦住；性能判定器延迟负控能拦绝对与相对退化 | 旧版全真＋单元负控 |
| SC-15 | 题库／客户端／模型／实例／候选 digest 或 Token 指纹不匹配即拒绝证据；所有必需尝试在分母中 | 发布校验反向测试 |
| SC-16 | `customer-release-readiness` 对缺失、FAIL、BLOCKED、NOT RUN、篡改与旧摘要均 `releaseReady=false` | 聚合器与 workflow 契约测试 |
| SC-17 | K8s 升级、回滚与客户 Compose 均接线；health／Ready／tools/list 单独通过不能放行 | 脚本契约＋现有环境全真 |
| SC-18 | 私有基线权限与内容合规；公开证据无 Token、Session、连接秘密、过滤原值与业务行 | 泄露扫描 |
| SC-19 | 本任务本机未重建 Docker；缺匹配现有候选明确 BLOCKED，不以 mock 或临时镜像凑绿 | 跑次与命令记录 |
| SC-20 | Spec／Plan／总账／需求池／测试台勾连；文档 lint 与相关脚本测试通过 | 门禁输出 |

## 8. 主路径可用性自检

| # | 问 | 答 |
|---|---|---|
| 1 | 合法用户原任务是否仍能完成？ | 本条唯一目的就是要求 PRE 成功的真实用户任务在 POST 仍成交；不是只验安全拒绝 |
| 2 | 新增拒绝是否有同部署逃生？ | 本条不新增产品拒绝；测试 FAIL 只阻止候选放行。安全负例的既有拒绝必须有明确下一步，合法对照必做 |
| 3 | 是否同时验约束与合法成交？ | 是。每个无权限／分权限场景都带合法对照；功能、权限与耗时共同构成分子 |
| 4 | 是否用 BLOCKED 掩盖产品不可用？ | 否。客户升级的必做基线缺失或客户场景 BLOCKED 会阻止升级放行；不得标 PASS WITH GAP |

## 9. 开放项与边界

- 首版阈值已全部由委托人批准，无待裁定数值。
- 具体客户题目和参数从该实例私有基线读取，不写入仓库；公开仓库只保存可复现的通用合成题。
- 本产品缺陷修复另开条目；发现 FAIL 不得在本条里顺手改门闩、ACL 或数据库行为。
- 本任务不重建 Docker。真实旧版负控与候选全真验证只能复用已经存在的匹配环境；若当前没有，保留 SC-14／全真项 BLOCKED，不得宣称本条已 PASS。
