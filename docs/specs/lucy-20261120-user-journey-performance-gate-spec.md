# 用户旅程性能门禁 Spec（API／WebUI 交互／MCP 问询）

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v0.1-draft |
| 日期 / 目标版本 | 2026-11-20 / 0.30.0 |
| 功能编号 / 优先级 | P1-67／REQ-030-088；P1（测试基建；建议）；不入核心分母 |
| 台账号 | 无 |
| 阶段 | S1 |
| 状态 | S1｜v0.1-draft。委托人2026-11-20授权登记与 Spec／Plan 设计；终稿未确权；开发未授权；测试台未建；不入核心分母；≠ 功能收口；≠ 可上线。 |
| 授权边界 | 2026-11-20 委托人批准「立 P1 条目做用户旅程性能门禁」的设计授权；**不含** workflow／runner 运行代码改动、不含测试台建立、不含任何性能跑次执行；不含现场升级（109／KSC 由 P1-66 与交付流程处理）。 |
| 需求 / 总账 | [REQ-030-088](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-088用户旅程性能门禁apiwebui-交互mcp-问询) · [P1-67](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) |
| 计划 / 测试台 | [Plan](../plans/lucy-20261120-user-journey-performance-gate-plan.md) · 测试台 `UAT-SUITE-USER-JOURNEY-PERF`（待建，编号 `UAT-UJP-*`）· [INDEX](../qa/uat/INDEX.md) |
| 前序 / 来源 | [错题 KSC 0.25.0](../lessons/2026-11-20-ksc-025-roles-agents-stuck-old-build.md)（roles API 48–73 s、agents 4.8 MB 实测）· [错题 P1-13 误判](../lessons/2026-11-20-roles-lag-p113-claimed-fixed-still-slow.md) · 2026-11-20 系统性盘点（`perf:entry`／`perf:release-baseline` 存在但 CI 零命中；MCP 问询零预算；版本漂移无看守）· P1-13／P1-58／P1-66（被门禁看护的对象，非本条成果） |

## 闭口层级

- 层级：功能合同
- 本条承诺：任何提交进入 `lucy-v0.30` 主线前，用户视角三维度性能（API 核心读路径、WebUI 前台交互、MCP 问询全链路）在本机标准夹具上被自动测量并对预算线/相对基线负责；每条性能结论可复现到 gitSha＋实例指纹；部署实例的版本漂移被对账看守。
- 本条出口：SC-01–SC-08（§5）。
- 不在本条出口：**不修任何性能问题本身**（P1-13／P1-58／P1-66 等代码修复各归其合同）；不替代 RACS-R 组合发布取证与 RACS-17 现网校准；不对客户现场施压（对账只读 `/api/health`）；不声明任何现场升级完成；CI 接入配置的实现在获开发授权前不落地。
- 上线关系：本条收口不表示可上线；门禁本身随 CI 生效即开始看护后续提交。

## 1. 事实与缺口（盘点结论，设计输入）

1. 系统性 runner 已存在：`perf:entry`（Spec 174 §8，生产构建入口性能，routes 含 connections/catalog/overview/agents/roles，迭代+预热+预测器，仅 KTX CLI 打桩）与 `perf:release-baseline`（P1-13，Roles+MCP+相对回归，ci-small/release-medium 档）。
2. **CI 零命中**：`grep 'perf:' .github/workflows/lucy-*.yml` = 0；性能回归无任何自动看守，慢化可全绿通过。
3. **MCP 问询端到端延迟零预算**：现有套件只在组合负载下看 MCP「正确完成」（RACS-12／RPB），没有"用户问一句话→收到答复"的耗时预算测试。
4. **版本漂移无看守**：release workflow 只验「构建时镜像 == GITHUB_SHA」；KSC 实例 0.25.0 长期运行无人发现，性能结论跨版本被误外推（demo 0.30 PASS 被当成现场体验证据）。
5. WebUI 交互计时已有方法学与工具（P1-13 网络合同、browser-timing 跑次、`UAT-SUITE-PAGE-DOM-SCALE` 探针协议），但全部手动、无回归看守、无交互深度（筛选/翻页/详情）。

## 2. 决策

| 编号 | 决策 | 约束与代价 |
|---|---|---|
| D1 | 复用既有 runner 接 CI，不新造轮子 | `perf:entry --tier ci-small` 进每次 CI 硬门禁；`perf:release-baseline --tier release-medium` 进发版 workflow；失败即红。代价：CI 时长增加，需给 runner 加严格超时 |
| D2 | 三维度预算线版本化入 fixtures 风格真源 | API 旅程/WebUI 交互/MCP 问询各有绝对线+相对闸（沿用 P1-13 噪声带：同档 p95 恶化 >20% 且 >50ms 即失败）；改线须具名评审与委托人接受，不追样本抬线 |
| D3 | MCP 问询延迟用真实 MCP 调用测，不打桩服务端语义 | 小表只读问题经 `lucy_begin_question`→`lucy_query` 全链路，统计端到端分位；夹具数据量分档；网关/冷启动窗口单列不混入稳态 |
| D4 | 每条性能结论强制 gitSha＋实例指纹 | 跑次报告头强制候选指纹字段；缺失即判无效；文档不得把某构建的结论外推到另一构建（KSC 教训） |
| D5 | 部署对账只读 | 定时（或发版后）抓现场 `/api/health` gitSha 与发版台账比对，落后超阈值告警；只读、不压测、不自动升级 |
| D6 | 版本性能特性对照表入 runbook | 0.25.0／3a9f0711／1fb73f72 各自的性能特性（全量编译/批量列表/快照复用+分区）以实测口径记录，供现场症状速查 |

## 3. 三维度合同

### 3.1 API 旅程

- 范围：治理方与问数方高频读路径——`/api/admin/roles`、`/api/admin/agents`（完整/roster/statistics）、`/api/connections/*/enabled-tables`、`/api/admin/tokens`、catalog/wiki 列表、MCP 只读调用。
- 指标：热态 p50/p95/p99、冷读 max、payload 字节数上限（agents 全量响应设字节预算，防 4.8 MB 类回归）。
- 预算真源：新 fixtures 文件（`docs/qa/uat/suites/user-journey-perf/fixtures.md`），首版数值从 RACS fixtures §5 与实测基线冻结，**标注为设计值非已测能力**。

### 3.2 WebUI 交互

- 范围：前台 headed 桌面 1920×1080（AGENTS.md 约束），协议复用 PDS 探针：SPA 导航→就绪表达式→`performance.now()`；longtask 点击前布防。
- 指标：primaryReady p95、渲染期 longtask（>200 ms 记观察）、consoleErrors、DOM 规模。
- 深度扩展（相对 PDS）：每核心页至少一条交互路径（筛选或翻页或详情抽屉）计时；防"首屏快、交互卡"。

### 3.3 MCP 问询

- 范围：真实 MCP Proxy 连接、fixture token、只读小表问题；链路 `initialize→begin→query→（continue）→答复`。
- 指标：端到端分位（提问发出→完整答复）p50/p95、首 token 前时延（若协议可观测）、并发问询下的公平性（多用户各问各的，互不退化超预算）。
- 边界：不测 LLM 生成质量（归评测套件）；网关/冷启动窗口单列；洪泛与未授权调用不在本合同（归安全套件）。

## 4. 部署对账与版本对照

- 对账源：发版台账（release 目录 sha256 清单 + e2e-ledger 候选列）与现场 `/api/health`（gitSha/lucyVersion/镜像摘要）。
- 阈值（首版设计值，待评审）：现场 gitSha 落后主线 HEAD 超一个发布窗口（或健康检查连续 N 天不可达）即告警；告警不等于升级授权。
- 对照表：版本→性能特性→KSC 实测数字，随本 Spec 附录维护；新版本发布时在发版 checklist 增补一行。

## 5. 验收

| 编号 | 本条可打假检查 |
|---|---|
| SC-01 | CI 集成负控：人为注入 2× 延迟的提交被门禁拒绝（红），移除后转绿；门禁未接入或接入后被跳过即本条不成立 |
| SC-02 | 三维度各有书面预算线与相对闸，版本化留痕；改线有具名评审记录 |
| SC-03 | MCP 问询端到端分位在预算内，且与 API/WebUI 同窗口分列；无"只测握手不问答"凑数（负控：仅 initialize 的记录被判无效） |
| SC-04 | 抽样 3 份历史性能结论，均携带 gitSha＋实例指纹且可复现；缺失即判无效 |
| SC-05 | 对账演示：模拟现场落后版本，看守按期告警；告警后只读核对，无自动变更 |
| SC-06 | 版本对照表与三处实测（0.25.0 KSC／3a9f0711 客户回传／1fb73f72 demo）数字一致 |
| SC-07 | WebUI 交互深度用例存在且每核心页≥1 条；只有首屏计时的版本判部分完成 |
| SC-08 | 门禁自身超时与资源上限有界：runner 卡死不影响 CI 判定超时就红，不假绿 |

## 核心流程（伪代码）

```text
onEveryCommit(ci):
  candidate = fingerprint(gitSha, instance, fixtureId)
  for dim in [api, webui, mcp_query]:
    samples = runProbe(dim, fixture(dim))          # 复用 perf:entry / PDS 探针 / mcp-query-latency
    assertWithinBudget(samples.p95, dim.budget)
    assertNoRegression(samples, baseline[candidate.tier])   # 相对闸：p95 恶化>20% 且>50ms 即红
  publish(report with candidate fingerprint)        # 无 gitSha＋实例指纹的报告无效

onRelease(releaseWorkflow):
  run perf:release-baseline --tier release-medium
  assert formal baseline comparison

onSchedule(deployReconcile, readOnly):
  field = fetch(/api/health of registered instances)
  if field.gitSha behind main HEAD > window: alert("版本漂移", field.fingerprint)
```

## 交互合同豁免

- 原因：本条只增加 CI 性能检查、工程报告与只读版本对账，不改变用户可见 WebUI 表面。
- 不改变：Lucy 页面路由、组件、导航与用户操作；性能测量仍须按 §3.2 使用真实前台浏览器计时，豁免不替代该项验收。

## 工程报告要求

- 路由：CI 检查页／发版流水线／运维对账告警（工程面，无终端用户新界面）。
- 一件事：任何提交不得让三维度用户性能越线而不被发现。
- 状态：门禁红＝阻塞合并（可具名申诉）；对账告警＝只读通知，不自动变更。
- 主动作：门禁结果页一个 primary（重试）；无多个同组 primary。
- 决定信息：维度／预算线／实测分位／候选指纹／基线指纹。

## 工程报告检查项

- E1｜CI 门禁结果页｜红态｜失败维度与超线数值可见
- E2｜CI 门禁结果页｜主动作｜一个 primary 重试
- E3｜CI 门禁结果页｜决定信息｜候选指纹与基线指纹可核对
- E4｜发版基线报告｜对照视图｜release-medium 与正式基线差异列明
- E5｜MCP 问询报告｜分位列｜p50/p95 与窗口单列
- E6｜对账告警｜通知｜漂移实例指纹与落后窗口数
- E7｜版本对照表｜速查｜版本→性能特性→实测数字一致
- E8｜预算线变更记录｜审计｜每次改线具名评审留痕

## 工程报告设计核对

以下仅为草案设计核对，未执行浏览器或 CI 验收，不构成已有报告组件或交互已实现的证据。

- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：通过（红态直接列失败维度与数值）
- Q2 PageHeader 是否满足按钮规范，其他 action group 各自最多一个 primary：通过（结果页仅一个重试 primary）
- Q3 空、错误、0 条是否在面板内写明原因：通过（无数据维度显示「无样本」及原因）
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：通过（指纹完整展示，悬停可见完整值）
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：通过（复用现有 CI 报告组件）
- Q6 用户可见术语是否已登记：通过（无新用户可见术语）

## 受影响画像

依据 [画像规范](../governance/user-personas.md)，均为待验证设计目标。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| 问数方 | 问询变慢可能无人发现直到现场投诉 | MCP 问询耗时被持续预算看守，变慢即拦 | ↑ | SC-03 | 门禁只拦提交不拦既有功能；误拦有具名评审申诉通道 |
| 治理方 | 页面卡（如 KSC roles 58 s）版本间漂移无看守 | 三维度性能在每次提交被看护 | ↑ | SC-01/03/07 | 预算线为观测目标；被拦提交可申诉，不封死合法主路径（主路径可用性优先） |
| 运维方 | 部署版本落后无感知，性能投诉后靠手工追版本 | 对账告警暴露漂移；对照表速查版本特性 | ↑ | SC-05/06 | 告警只读；不自动升级，升级决策仍走交付流程 |
| 管理层 | 性能证据散落、跨版本不可比 | 结论绑指纹可比可复现 | ＝ | SC-04 | 无负向 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: 「用户旅程性能门禁」「对账告警」仅工程术语，不进用户流程；用户可见文案不受影响。专业英文（gitSha、CI、p95）保留翻译防御。

## 修订记录

2026-11-20 v0.1-draft：入池设计稿。盘点结论作事实输入；预算数值全部标注设计值；未确权、未授权。
