# Eval 选表正确性与真实问句回灌骨架 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`）。不进入 `v0.25` 升级台账，不占用 `L25-*` |
| 台账号 | 无（0.30 台账未建立） |
| 功能编号 / 优先级 | 清单 **P0-6**；需求池 **REQ-030-025**／**P0**；最小面挂 **REQ-030-019**／**REQ-030-020** |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。分批 Spec 已批准撰写；委托人裁定本阶段**暂不开工实现**。须过对抗式评审 + 开放决策闭合 + **另授开发授权** 后才可改代码。本条不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。现行阶段只接受评审与修订。实施须：§评审门禁 R1–R4（见功能清单池 §2.2）全部通过 |
| 决策来源 | 2026-11-06 CFO 选表误报（**检出缺口**）＋ 2026-11-07 沟通实录：五域（损益／资金／资产／Token／GPU）日跑测评承诺；误报防线 **G6＋G8** |
| 需求来源 | [需求池 REQ-030-025](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；[误报防线 §4.6 G6／§4.8 G8](../plans/lucy-20261107-misreport-defense-and-stored-user-experience-plan.md)；[功能清单池 P0-6](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[019 Spec](lucy-20261107-eval-tool-assertion-authoring-spec.md)；[020 Spec](lucy-20261107-audit-journey-eval-case-draft-spec.md) |
| 实施主体 | Lucy：Eval runner prompt 合同、用例骨架、发布后 smoke 接线；WebUI 仅 **019／020 最小面**。不改 KTX；不把 Eval 当自动修复器 |
| 配套 Plan | [lucy-20261107-eval-source-selection-correctness-plan.md](../plans/lucy-20261107-eval-source-selection-correctness-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（第 1 轮：形式合规 ＋ 事实性核验，13 块分块；**评审通过并另获开发授权后方可改代码**） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「伪代码」 |
| 与既有 Spec 的关系 | **串联，不吞并。** 完整 WebUI 路径断言编排＝P1-4／019；完整审计→草稿回流＝P1-5／020。本条只收 **P0 最小面**：能写必选／禁选 source 断言、能从旅程导出草稿骨架、选表可测、五域日跑／发布跑通路。口径绑定（P0-1）内容本身不在本条交付 |

## 闭口层级

- 层级：功能合同
- 本条承诺：① Eval prompt **不再泄漏金标表名**；② 可用 `required_tool_input_regex`／`forbidden_tool_input_regex` 断言必选／禁选 Source；③ 五域（损益／资金／资产／Token／GPU）具备可日更的用例**骨架**；④ 发布成功后可 enqueue 受影响 domain 的 **smoke**（咨询性，不自动回滚）；⑤ 019／020 仅最小面支撑上述断言编排与草稿回灌。
- 本条出口：SC-01–SC-14（见 §7）。runner／映射纯函数自动化；骨架 YAML 可解析；smoke enqueue 本机断言；`lint:spec-docs` 通过。
- 不在本条出口：CI 全量 LLM Eval、Publish 失败自动回滚、021 自动改工具面、完整 WebUI 作者体验（P1）、客户五域全量金标内容、镜像／上线。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Source-Selection Correctness：中文主称「选表正确性」。Eval 能否测出 Agent 是否选用了业务要求的 Source（而非测「被告知表名后的背诵」）。
- Gold Source Leak：中文主称「金标表名泄漏」。`composeQuestion` 把正确答案表名写进 prompt 的缺陷。
- Domain Skeleton：中文主称「域评测骨架」。五域各自最小可跑用例集（可含跨表歧义题），允许日更，不要求首期内容完备。
- Publish Smoke Enqueue：中文主称「发布后 Smoke 入队」。发布成功后对受影响 Eval domain 触发咨询性 smoke；**不**因 FAIL 自动回滚 Publish。

Forbidden:

- 把「选表正确性」说成「数值正确性」或「口径自动正确」。
- 把 Publish Smoke 说成「门禁阻断发布」——P0 为咨询性。
- 把客户原始问句直接落 YAML（须脱敏合成，沿用 `evals/agent_reliability` 约定）。
- 用表名冒充 Eval `domain`（既有 `postPublishEvalDomains` 缺陷）。

落位：本条术语属 **Eval／发布回归**面，落术语标准相邻分区登记（实现前补标准条目）。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `docs/governance/eval-quiz-conventions.md`
- `webui/docs/00-product-terminology-standard.md`
- `lucy-20261107-eval-tool-assertion-authoring-spec.md`（019）
- `lucy-20261107-audit-journey-eval-case-draft-spec.md`（020）

### What This Change Follows

- [ ] Eval 作者面最小改动：路径断言字段可写即可；不做完整 IA 重做（完整面归 P1-4）。
- [ ] RunList／Publish 提示文案克制；domain 选择器消费 `?domain=`，不堆营销卡。
- [ ] 工具名、source 限定名 `translate="no"`。

### Exceptions (If Any)

- 五域骨架可先以 YAML 文件存在于 `evals/`，不强制首期 WebUI 新建域向导。

### Follow-up Needed

- 019／020 完整 WebUI 体验 → P1-4／P1-5。
- 021 失败→工具面反哺 → P1-6；本条不做自动改工具面。
- chatbi_intl 历史基线作废后的套件重标 → 见 D8／基线声明。

---

## 1. 背景与取证

### 1.1 事故与承诺

CFO 选表误报暴露 **检出缺口**（非事故根因）。客户承诺「每天跑测评、每天迭代」，覆盖 **损益／资金／资产／Token／GPU**；验收口径＝每类问题 → 哪张表＋什么口径。

### 1.2 现行缺口（已核实）

| # | 事实 | 证据 |
|---|---|---|
| E1 | `composeQuestion` 把 `expected_measures` 拼成 `superstore_orders.<measure>` 写入 prompt → **金标表名泄漏**，选表正确性结构上不可测 | `scripts/eval/eval-runner.mjs:1424-1433` |
| E2 | `required_tool_input_regex`／`forbidden_tool_input_regex` 执行面已有，`evals/` 内 **0 命中** | `eval-runner.mjs:751-761`；仓内用例检索 |
| E3 | 无跨表歧义真实生产问句回灌；`agent_reliability` 例无选表断言 | `evals/agent_reliability/eval/agent-reliability-eval-cases.yaml` |
| E4 | **chatbi_intl 分支缺陷**：`composeQuestion` 仅 `domain === 'kx_financial'` 特殊分支（`:1414`）；`chatbi_intl` 100 例落入 superstore 分支，prompt 被喂 `superstore_orders.*`（**错误表名**）⇒ 该套件选表结论**均不可信** | `eval-runner.mjs:1414-1433` |
| E5 | Publish 后无 Eval 触发；`trigger` 写死 `manual`；`postPublishEvalDomains` 把**表名**当 domain；`RunList` 不消费 `?domain=` | `webui/server/eval/runner.ts:311`；`PublishWorkbench.tsx:415-416`；`RunList.tsx:34` |
| E6 | 019／020 已有独立 Spec（完整面）；P0 只需要最小面 | 清单池 P0-6／P1-4／P1-5 |

### 1.3 取证缺口（不得当事实）

- 客户五域金标「每题绑定表＋口径」的完整清单：不在本仓 → 本条只交付**骨架与断言机制**，不冒充内容完备。
- 日跑调度的宿主机／密钥：部署侧另定 → 本条保证「可被 enqueue／可被 RunList 触发」的产品通路。

---

## 2. 目标

1. 消除 Gold Source Leak：prompt 只列**候选**表／能力，不告知金标表名。
2. 用例侧强制选表断言：`required_tool_input_regex`（必须用 source X）＋`forbidden_tool_input_regex`（禁止 source Y）在五域骨架中有可运行样例。
3. 建立五域 Domain Skeleton（损益／资金／资产／Token／GPU），可日更；含至少一类跨表歧义题型槽位。
4. 修 chatbi_intl／非 kx_financial 域的 `composeQuestion` 错分支，避免再喂 superstore 表名。
5. Publish → smoke enqueue；domain 映射＝真正的 Eval domain（≠ 表名）；RunList 消费 `?domain=`。
6. 接通 019／020 **最小面**：能编排上述两类 regex 断言；能从审计旅程导出脱敏草稿（不自动进跑批）。
7. **声明新基线**：去泄漏后历史通过率不可比；新旧断言不得混在一次对比里。

---

## 3. 非目标

| 不做 | 原因 |
|---|---|
| CI 塞 LLM full eval | 成本／不稳定；P0 明确不做 |
| smoke FAIL 自动回滚 Publish | P0 咨询性（G8） |
| 自动改工具面（021） | P0 不做自动修复器 |
| 客户原话直接落 YAML | 脱敏合成约定 |
| 019／020 完整 WebUI | 归 P1-4／P1-5 |
| 替代 P0-1 口径绑定内容 | 本条是检出器，不是绑定编辑器 |

---

## 4. 设计决策

| 编号 | 决策 | 状态 |
|---|---|---|
| **D1** | 修复 `composeQuestion`：删除金标表名拼接；改为「候选 source／能力列表＋任务题干」；金标只存在于断言字段 | **冻结** |
| **D2** | 选表断言规范：至少使用 `required_tool_input_regex` 与／或 `forbidden_tool_input_regex` 匹配 tool input 中的 source 限定名；执行面复用 runner 既有分派 | **冻结** |
| **D3** | 五域骨架目录／domain id 须稳定可映射（建议与 `evals/<domain>/` 对齐）；每域至少 1 条可解析用例＋选表断言槽；允许 `needs_review` 或草稿区，但**跑批路径隔离**沿用 020 纪律 | **冻结方向**；具体 domain 字符串见 **O1** |
| **D4** | chatbi_intl（及一切非 kx_financial／非超店域）不得落入 superstore 泄漏分支；无匹配域时 fail-closed 或走「无表名提示」的中性模板 | **冻结** |
| **D5** | Publish 成功 → enqueue 受影响 Eval domain 的 smoke；`postPublishEvalDomains` 映射表名／文件 → **domain id**（不得把 raw table 当 domain） | **冻结** |
| **D6** | RunList 读取并应用 URL `?domain=`（筛选与／或预填触发表单）；「触发 Run」须真实可触发 | **冻结** |
| **D7** | 019 最小面：CaseEditor／类型／保存校验至少支持 4 型路径断言中的 **regex 两型**（及既有 required／forbidden tool 若已露出则保持）；预算型完整面仍归 019／P1 | **冻结** |
| **D8** | **基线断裂声明（Normative）**：合并去泄漏改动时必须 (a)  bump eval baseline 标签／changelog；(b) 禁止用泄漏期通过率与新区对比；(c) chatbi_intl 历史「选表相关」结论作废并标注 | **冻结** |
| **D9** | 020 最小面：支持从问询旅程导出含 `tool_assertions`（regex 选表）的脱敏草稿到草稿区；不自动进 `evals/**` 跑批 | **冻结**；完整回流 UX 归 P1-5 |
| **D10** | smoke 为咨询性：结果可通知／可在 RunList 查看；**不得**自动回滚 Publish；**不得**作为 CI full LLM 门禁 | **冻结** |
| **O1** | 五域在仓库中的 domain id 命名（中文标签 vs slug：`pl`／`cash`／`asset`／`token`／`gpu` 等）及与客户内容根的映射表 | **开工前必答** |
| **O2** | 候选表列表写入 prompt 的来源：用例字段 `candidate_sources[]` vs 运行时 catalog 快照 | **开工前必答** |
| **O3** | Publish→smoke 的触发实现：WebUI 客户端 enqueue vs 服务端 post-publish hook；`trigger` 字段取值扩展（非永远 `manual`） | **开工前必答** |

> **开放决策守卫（本条统一，2026-11-07）**：本条所有 **O 项（开工前必答）在闭合前不得实现对应分支**——缺省一律 fail-closed（该分支不实现、依赖它的 SC 保持未关闭、不得以「评审已通过」当作已闭合）。闭合须由**委托人（PM）**在**开发授权前**书面裁定，并回写本表 O 行的状态格；**评审通过 ≠ O 项闭合**；未闭合即开工的，视为越权实现。


---

## 5. 数据模型（Normative）

### 5.1 用例最小选表断言（示意）

```yaml
# evals/<domain>/eval/<domain>-eval-cases.yaml  — 骨架示意
id: asset_count_source_select_001
question: 资产的数量是多少？   # 合成题干；非客户原话
candidate_sources:            # 若 O2 选用例字段
  - mysql-aliyun.asset_finance.<asset_table>
  - mysql-aliyun.<gpu_cost_table>
tool_assertions:
  # ⚠️ 字段名必须是 **value**，不是 pattern。
  #    runner 契约：`const value = a.value == null ? '' : String(a.value)`（eval-runner.mjs:735），
  #    正则分支用 `new RegExp(value, 'i')`（:752）。
  #    写成 `pattern:` → value 取到 '' → new RegExp('','i') **匹配任意串**：
  #    required_tool_input_regex 恒真（假通过）、forbidden_tool_input_regex 恒真（假失败），
  #    SC-03／SC-04 会假绿。
  - type: required_tool_input_regex
    value: "<asset_table>"      # 必须命中金标 source 片段（取自 019 的 `{type;value;reason}` 合同）
    reason: "选表必须命中金标 source"
  - type: forbidden_tool_input_regex
    value: "<gpu_cost_table>"   # 禁止事故错表
    reason: "不得命中事故错表"
```

> **目标范围说明**（F2）：`*_input_regex` 分支**不读 `a.tool`**——runner 把**全部** tool 调用的
> name ＋ input 拼成一个 `target` 串再匹配（`eval-runner.mjs:657-661`、`:751-761`）。
> `a.tool` 只出现在三个**预算型**断言里（`:779`、`:795`、`:821`）。
> ⇒ 本节的 YAML **不写 `tool:`**（写了也不生效，会误导读者以为按工具限定）；
> 「是否需要按工具限定」列为 **O 项**，不在本条实现。

### 5.2 发布 → domain 映射

```text
impactedPublishArtifacts → Set<EvalDomainId>
  # MUST NOT: domain := tableName
  # MUST: lookup(table|path|semanticKind) → domain id | omit
```

### 5.3 基线元数据

```text
baseline:
  id: "source-select-v1-post-leak-fix"
  replaces: "pre-2026-11-composeQuestion-leak"
  incomparable_with: ["chatbi_intl_superstore_poisoned"]
```

---

## 6. 核心流程（伪代码）

```text
composeQuestion(case, domain):
  base := case.question (+ prior turns if any)
  candidates := case.candidate_sources OR resolveCandidates(domain, O2)
  # FORBIDDEN: inject expected_measures as "<gold_table>.<m>"
  return base
       + "\n候选 Source（请自行选择，勿假设金标）："
       + format(candidates)
       + neutralToolHints(domain)   # no gold table name

checkSourceSelection(toolCalls, case):
  return checkToolAssertions(toolCalls, case.tool_assertions)
  # required_tool_input_regex / forbidden_tool_input_regex as today

onPublishSuccess(impact):
  domains := mapImpactToEvalDomains(impact)   # D5; never raw table as domain
  for d in domains:
    enqueueSmokeRun(domain=d, trigger="publish_smoke")  # advisory
  # DO NOT rollback publish on FAIL

RunList.mount:
  if url.domain: setDomainFilter(url.domain); prefilling trigger form OK
```

关键失败分支均须映射到 §7 SC。

---

## 7. 验收（SC-01–SC-14）

| ID | 断言 | 证据形态 |
|---|---|---|
| SC-01 | `composeQuestion` 输出**不含**金标 `expected_measures` 拼出的 `<table>.<measure>` 泄漏模式 | runner 单测／快照 |
| SC-02 | 非 `kx_financial` 域（含 `chatbi_intl`）不再被喂 `superstore_orders.*` | 单测 |
| SC-03 | 骨架用例中至少 1 条 `required_tool_input_regex` 在 runner 判真／假路径可测 | 单测 |
| SC-04 | 骨架用例中至少 1 条 `forbidden_tool_input_regex` 可测 | 单测 |
| SC-05 | 五域目录／domain 骨架存在且 YAML 可解析（允许内容最少） | 文件＋解析测试 |
| SC-06 | 跨表歧义题型槽位至少 1 例（资产类或等价）带禁选错表断言 | 夹具 |
| SC-07 | `mapImpactToEvalDomains`：表名输入不得原样成为 domain；映射表覆盖已知 demo 路径 | 单测 |
| SC-08 | Publish 成功路径调用 enqueue smoke（可 mock）；trigger ≠ 永久仅手工不可达 | 单测／集成 |
| SC-09 | smoke FAIL **不**触发 Publish 回滚 | 单测 |
| SC-10 | RunList 消费 `?domain=`（筛选或预填可观测） | 组件／路由测试 |
| SC-11 | 019 最小面：可保存含 regex 两型的 `tool_assertions`，非法类型失败关闭 | 沿用／收窄 019 SC |
| SC-12 | 020 最小面：旅程→草稿含选表 regex 断言槽；草稿不进跑批路径 | 沿用／收窄 020 SC |
| SC-13 | 基线断裂声明写入 changelog／eval 约定；旧 chatbi_intl 选表结论标注不可信 | 文档门禁 |
| SC-14 | `lint:spec-docs` 对本 Spec／Plan 退出码 0 | 门禁 |

全部 SC **未执行**。本条收口不表示可上线。

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 去泄漏后通过率骤降被当成产品回归 | D8 强制新基线；沟通「历史不可比」 |
| 五域空骨架被当成已覆盖客户承诺 | 骨架≠完备；清单／发布说明显式登记内容缺口 |
| domain 映射错误导致 smoke 跑错套件 | SC-07；O1 闭合 |
| 019／020 范围膨胀 | D7／D9 最小面；完整面拒收进本条 |
| CI 被要求加 full LLM | D10 明确拒绝 |

---

## 9. 关联

- 清单：P0-6；最小面 019／020；完整面 P1-4／P1-5；不做 021
- Plan：`docs/plans/lucy-20261107-eval-source-selection-correctness-plan.md`
- 误报防线：§4.6 G6、§4.8 G8；实施序 **W5／W7**
