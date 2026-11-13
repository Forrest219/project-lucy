# 发版性能基线与相对不回退门禁 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 发布取证 Spec / **v0.2** |
| 日期 | 2026-11-13 |
| 功能编号 / 台账号 | **P1-13／REQ-030-034** / **无** |
| 状态 | **v0.2；R2-F＋R4；发布取证出口证据齐（SC-01–SC-16；2026-11-13）；书面登记「发布取证 acceptance 代替实现 CR」（2026-11-13）**。本条通过不表示各模块无问题，更不表示可上线 |
| 决策来源 | 2026-11-13 用户反馈 Agent／Roles 页卡顿；code review 确认 Roles 列表仍为 N× `freshSourceMap`（Spec 174 只修了 Agent）；委托人同意建立跨版本性能基线，覆盖 WebUI 与 MCP，并批准起草本 Spec |
| 需求来源 | REQ-030-034；触发事件见对话「Agent 和 Roles 页面非常卡顿」 |
| 实施主体 | 测量脚本／夹具／基线归档／发版门禁登记；首版为使 Roles／Agent 附带请求可过预算，允许有限产品路径改动（§5）。不改 KTX 源码 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「新增 Spec / Plan 的落盘清单」 |
| 与既有 Spec 的关系 | **扩展、不替代** [`webui/docs/174-webui-entry-performance-spec.md`](../../webui/docs/174-webui-entry-performance-spec.md)：保留其 fixture／PERF 测量文法与 Agent 批量合同；本条补 **Roles／MCP／相对上版不回退／发版列车挂钩**。权限算法仍服从 ACL／Spec 174／195；不得借性能门禁放宽 deny |
| 实施计划 | [`docs/plans/lucy-20261113-release-perf-baseline-gate-plan.md`](../plans/lucy-20261113-release-perf-baseline-gate-plan.md) v0.2 |
| 评审记录 | R2-F＋R4：2026-11-13 委托人明示确权与开发授权。验收证据：[`docs/reviews/2026-11-13-release-perf-baseline-gate-acceptance.md`](../reviews/2026-11-13-release-perf-baseline-gate-acceptance.md)。landed W1-4 路径 A：[`acceptance 代替实现 CR`](../reviews/2026-11-13-p1-13-acceptance-stands-for-impl-cr.md)（**非**实现 CR PASS） |

## 闭口层级

- 层级：发布取证
- 本条承诺：产品版本候选在声明的测量情景下产出可对比基线；相对上一正式基线不得无说明回退；强制路径（含 Roles 列表与 MCP 热路径）有绝对预算或相对门禁；已知反模式有静态或情景检出。
- 本条出口：SC-01–SC-16。证据为 runner 报告、基线 JSON、与上版 diff、以及（若触及产品债）Roles／Agent 列表相关单测。
- 不在本条出口：客户机墙钟 SLA、全站每一页 PERF、移动窄屏、真实 LLM 端到端耗时、把一次 formal pass 当成永久免测、客户出包签字。
- 上线关系：本条通过不表示各模块无问题，更不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 「性能基线」「相对不回退」「primary-ready」只用于发布取证与脚本报告，不出现在产品界面。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 本条默认不改页面视觉；若 Wave 0 产品债只改服务端列表聚合，不新增组件模式。
- [ ] 不引入新的加载动效合同；页面就绪谓词沿用 Spec 174 的 primary-ready 口径并扩展 Roles。

### Exceptions (If Any)

- 无新视觉模式。

### Follow-up Needed

- 无。

---

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面。本条定义发版性能基线、测量脚本、相对上版不回退门禁，以及列表路径的服务端批量化债；不新增或改页面交互合同。
- 不改变：用户可见 WebUI 路由、控件、文案与浏览器交互；本条落地为测量／门禁／服务端列表聚合。

## 1. 背景

Spec 174 已对 connections／catalog／overview／Agent 列表建立 fixture PERF 门禁，并修了 Agent 的「一批一次 source map」。2026-11-13 复查确认：

1. **Roles 列表**自 M12 起对每个 Role 调用默认 `freshSourceMap: true` 的单主体 preview；大 Manifest 客户环境放大为秒级卡顿。
2. **Agent 页**预拉 Roles 接口，把同一成本叠到 Agent 进入路径。
3. 正式 PERF runner 的 `PAGE_ROUTES` **不含 Roles**；PERF-06 只量 sources／agents。
4. Spec 174 写明「目标环境未部署」；通过 formal 不等于客户体感。
5. MCP 热路径（`initialize`／`tools/list`／代表性业务工具）**没有**与产品版本绑定的相对基线。

结论：缺的不是「有没有过一次性能专项」，而是 **跨版本、可对比、覆盖关键路径的发布取证门禁**。

## 2. 决策

| 编号 | 决策 | 裁定 |
|---|---|---|
| D1 | 合同形态 | **绝对预算 + 相对上版不回退** 双闸。绝对预算防「一直很慢」；相对闸防「本版变差」 |
| D2 | 「越来越好」 | 可执行合同＝**默认不回退**。变差须在当次报告写明原因与接受人；变好记入基线。不承诺每版本墙钟单调下降 |
| D3 | 与 Spec 174 | **复用**其生产 build、fixture 文法、样本数与 nearest-rank P95；**扩展**路由与 API，不另起第二套时钟语义 |
| D4 | 覆盖面（强制） | WebUI：既有四路由 **+ Roles 列表**；API：sources／agents **+ roles**；MCP：`initialize`、`tools/list`、一条固定业务只读工具调用（夹具内） |
| D5 | 夹具分档 | **CI 小夹具**（可阻塞 PR 的子集）＋ **发版中档夹具**（Manifest／Role／Agent／审计行数有下限，近似客户放大，不复制真实客户数据） |
| D6 | 相对回退阈值 | 同机器、同情景、同 runner：任一强制指标 P95 相对上一正式基线 **>+20% 且绝对值恶化 >50ms** → 失败；仅一边满足不算失败。噪声带内记 warn 不失败 |
| D7 | 基线归档 | 每次正式跑写入带产品版本／gitSha／runner 版本的 JSON；目录约定见 §6。上一正式版＝发版列车登记的最近一次 **pass** 基线 |
| D8 | 静态反模式 | 列表路由处理函数不得在循环内调用默认 `freshSourceMap: true` 的单主体 preview（Roles／Agent 列表）。允许详情／dryRun／保存预览保持 fresh |
| D9 | Agent 附带 Roles | Agent 列表页不得在首屏强制拉取完整 Roles 权限预览；新建弹窗打开后再拉，或改用轻量摘要接口 |
| D10 | 发版挂钩 | 客户候选／正式发版 checklist 增加本门禁；未跑或相对失败且无接受记录 → 不得宣称性能取证通过 |
| D11 | 不做 | 不把全站浏览器 E2E 都改成性能套件；不以客户机单次手点代替基线；不 mock 权限解析或审计 SQL 来刷分 |
| D12 | 产品债范围 | Wave 0 允许为 SC 强制路径改 `webui/server/admin/roles.ts`、Agent 列表对 Roles 的请求时机，以及共享 batch preview；**不改**运行时授权语义 |

D1–D12 无留给委托人的二选一。开工前必答见 §8。

## 3. 非目标

- 不替代 Spec 174 的绝对预算表；本条在其之上叠加相对闸与扩面。
- 不承诺真实客户内网 P95；客户机只读核对可另记，不进本条出口分子。
- 不测量带真实 LLM 的完整问答墙钟（那是 Eval／体感仪表盘轨）。
- 不在本条重做页面 IA 或移动适配。

## 4. 核心流程（伪代码）

```text
function runReleasePerfGate(candidate, previousBaseline):
  fixture = selectFixture(tier)   # ci-small | release-medium
  assertProductionBuild()
  report = emptyReport(candidate.version, candidate.gitSha, runnerVersion)

  for scenario in mandatoryScenarios():  # includes roles + mcp hot path
    samples = measure(scenario, fixture, n=requiredSamples(scenario))
    report.add(scenario, p50=…, p95=nearestRank(samples, 0.95), max=…)
    if absoluteBudget(scenario) violated by report.p95:
      fail(scenario, "absolute")

  if previousBaseline exists:
    for metric in mandatoryComparableMetrics():
      delta = report[metric].p95 - previousBaseline[metric].p95
      if delta > 50ms and delta / previousBaseline[metric].p95 > 0.20:
        if not acceptedRegressionNote(metric):
          fail(metric, "relative-regression")

  assertNoFreshSourceMapInListLoops()  # static or fixture counter
  writeBaselineArtifact(report)
  return pass
```

## 5. 强制情景与预算（首版）

### 5.1 WebUI／Admin API

| ID | 情景 | 预算（P95） | 备注 |
|---|---|---|---|
| RPB-W1 | 既有 Spec 174 强制路由／PERF-01–10 | 沿用 Spec 174 | 不得删减 |
| RPB-W2 | Roles 列表 route-query-cold primary-ready | ≤500 ms | 与 PERF-03 同级 |
| RPB-W3 | `GET` roles 列表 api-warm 完整响应 | ≤200 ms | 与 Agent 列表 PERF-06 同级 |
| RPB-W4 | Agent 列表首屏 **不得** 触发完整 Roles 权限预览请求 | 0 次（冷进页） | 网络／服务计数 |

### 5.2 MCP

| ID | 情景 | 预算（P95） | 备注 |
|---|---|---|---|
| RPB-M1 | Bearer `initialize`（含 instructions 注入） | ≤300 ms | 夹具本地 |
| RPB-M2 | `tools/list` | ≤200 ms | 夹具本地 |
| RPB-M3 | 固定只读业务工具 1 次（夹具内确定性工具） | ≤500 ms | 不含上游真实大查询；禁止用慢探活冒充 |

### 5.3 相对闸

对 RPB-W1 中已选强制指标、以及 RPB-W2／W3／M1／M2／M3：适用 D6。

### 5.4 静态／计数反模式

| ID | 检查 |
|---|---|
| RPB-S1 | Roles 列表一次请求期间 `sourceMapBuilds`（或等价计数）≤ 1 |
| RPB-S2 | 代码或集成测试：列表路径不在循环调用默认 fresh 单主体 preview |

## 6. 基线产物

- 路径建议：`inbox/perf-baselines/<lucyVersion>-<gitShaShort>/report.json`（过程）与发版列车引用的 **正式副本**（实现时在 Plan 钉死可检索位置；不得把密钥写入报告）。
- 报告至少含：版本、gitSha、runner 版本、夹具档、机器指纹（OS／arch／CPU 模型哈希）、各情景样本数、P50／P95／max、绝对／相对判定、接受回退备注（若有）。

## 7. 验收（SC）

| ID | 必须证明 |
|---|---|
| SC-01 | 存在可运行的 release-perf runner 入口，并在 `docs/governance/test-layers-and-release-gates.md` Current Commands 登记 |
| SC-02 | CI 小夹具子集可在约定时间内跑完；失败非零退出 |
| SC-03 | 发版中档夹具下限文档化（Manifest／表／Role／Agent／审计行数），生成物不含真实客户秘密 |
| SC-04 | Roles 列表纳入测量；缺 Roles 情景的 runner 不得宣称本条通过 |
| SC-05 | RPB-W3 达标，或相对失败带接受记录（首版目标＝达标） |
| SC-06 | RPB-S1：Roles 列表单次请求 source map 构建 ≤ 1 |
| SC-07 | RPB-W4：Agent 冷进页不打完整 Roles 预览 |
| SC-08 | MCP RPB-M1–M3 有测量与绝对判定 |
| SC-09 | 相对上版：D6 规则有自动化 diff；无上版时记 `baseline-seed` 不假绿相对闸 |
| SC-10 | 正式 pass 基线可被下一候选引用 |
| SC-11 | 发版 checklist／列车文档出现本门禁勾选项 |
| SC-12 | 不得 mock ACL／审计查询刷分（沿用 Spec 174） |
| SC-13 | Spec 174 既有 Agent 批量合同不回归（单测或计数） |
| SC-14 | 详情／dryRun 路径仍可 fresh preview（证明未全局改默认语义） |
| SC-15 | 报告不含 Token／密码／客户 DSN |
| SC-16 | 本条状态未含开发授权口令前，实现 PR 不得合入运行路径（治理） |

## 8. 开工前必答

无开放二选一。若评审要求收窄 Wave 0 产品债，只能整波延期，不得先合入「只加门禁、Roles 仍 N 次扫盘」并宣称取证通过。

## 9. 风险

| 风险 | 缓解 |
|---|---|
| 机器噪声导致相对闸误杀 | D6 双条件；同机对比；warn 带 |
| 中档夹具仍不够大 | 客户机只读核对另册；本条不假装覆盖 |
| 门禁变慢拖 PR | CI 只跑小夹具子集；中档挂发版／夜间 |
| 借性能改动削弱 ACL | D12＋SC-13／SC-14；禁止改 deny 语义 |
