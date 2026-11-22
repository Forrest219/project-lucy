# 多步流程状态机合同门禁 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec／仓库级评审门禁 / **v0.1-draft** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0` |
| 功能编号 / 优先级 | **P1-48**／REQ-030-069／**P1**（优先级待委托人裁定）。**不入 0.30 核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账，不占用 v0.25 登记册 |
| 阶段 | S1 |
| 状态 | **S1｜v0.1-draft。仅登记与起草，不开发。命中多步流程／门禁／发布／恢复语义的新 Spec（及 grandfather 取消后的存量 Spec）须声明可解析的「多步状态机合同」（状态集、合法转移、终态、非终态持久化、逃生边、禁止布尔冒充终态）；`lint:spec-docs` 在获开发授权落地后能拦住缺项；存量高风险路径盘点表只登记指针，不宣称已合规。终稿未确权；未获开发授权；未授权不改运行代码与 lint；测试台 not_registered；不入核心分母；≠ 可上线** |
| 决策来源 | 2026-11-18 委托人确认「未显式状态机」是典型问题，并授权「按照仓库规范起草 Spec 和 Plan，暂时不进行开发」 |
| 需求来源 | 同日对话归纳的缺陷模式，以及已核实错题／审阅：表级歧义死路、Ops operation 级五态缺失、MCP 两套握手混用、布尔／`result.ok` 假成功等 |
| 实施主体 | 文档、`scripts/lint-spec-docs.mjs`、夹具与 `DEVELOPMENT.md` 指针。**不改** WebUI／Proxy／Ops／KTX 运行时代码 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「Spec 内容规格：重要功能必含伪代码」「第一性原理：主路径可用性优先」「新增 Spec／Plan 的落盘清单」 |
| 与既有 Spec 的关系 | **复用触发语义，不改既有功能合同判定。** 伪代码触发条件沿用 DEVELOPMENT「多步状态机、门禁、发布／生效／索引管线」。交互合同门禁文法模式沿用 [`lucy-20261107-ui-interaction-contract-gate-spec.md`](lucy-20261107-ui-interaction-contract-gate-spec.md)（本条另立规则名，不修改其 SC）。Ops／MCP／歧义门闩等既有 Spec 的状态机正文仍以其自身为权威；本条只要求「以后被检查时合同小节可解析」，不重写其业务转移表 |
| 实施计划 | [`docs/plans/lucy-20261118-multi-step-state-machine-contract-gate-plan.md`](../plans/lucy-20261118-multi-step-state-machine-contract-gate-plan.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 初稿。登记问题、决策草案、文法、伪代码、验收、开放项与存量盘点指针。终稿未确权；测试台 not_registered |

## 闭口层级

- 层级：功能合同
- 本条承诺：被触发且没有有效豁免的 Spec，若缺一份按本文文法解析的「多步状态机合同」，或合同缺必填字段，或配对 Plan 未写明「本条不改运行时代码／仅文档门禁」以外的越权改动意图而未豁免，`lint:spec-docs`（规则名草案 `state-machine-contract`）在门禁生效后失败；grandfather 名单内文件仅在状态行含「开发授权已获得」或正文标记行时进入同一检查；本条落地 diff 不触及业务运行时代码。
- 本条出口：SC-01 至 SC-12（见「验收」）。夹具打假文法、豁免、grandfather、授权口令与白名单路径；存量盘点表存在且每行有指针或显式「本条不整改」。
- 不在本条出口：把已落盘业务 Spec 现在逐份补齐状态机并实现；重写 Ops／MCP／歧义门闩／发布工作台运行时代码；客户场景 UAT；发版签字；移动窄屏；可上线主张。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 「多步状态机合同」「逃生边」「非终态持久化」只用于评审与门禁，不出现在产品界面，不写入术语标准。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 本条落地不改页面、组件、颜色、间距或文案。
- [ ] Design System Compliance 四段式继续检查组件；本条追加的是文档门禁小节，不替换四段式。

### Exceptions (If Any)

- 无。本条不新增视觉模式。

### Follow-up Needed

- 无。授权落地时不改设计系统正文的判定。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面。本条只增加文档门禁与 lint，不改页面。
- 不改变：页面、路由、页头动作、空态、错误态、确认面、用户可见文案。

## 1. 背景与已核实事实

未显式声明状态机时，Lucy 已出现可复述的缺陷模式（对话归纳；证据指向既有错题／审阅，不在本条重做根因取证）：

| 模式 | 表现 | 证据指针 |
|---|---|---|
| 布尔冒充终态 | `result.ok`／对象当真值／`execCommand===true` → 假成功或误杀 pending | Ops G20；P1-40／P1-42 |
| 非终态不落库／无收敛 | 进程重启后无从判定；只能拒绝新 attempt | Ops G21／G33 |
| 多套规则并行 | 同一事实两套聚合或两套「握手成功」定义 | Ops 聚合分叉；P1-37 两套握手 |
| 只有拦截无逃生边 | 约束生效但合法主路径死路（含纯 MCP） | [source-ambiguity-gate-deadlock](../lessons/2026-11-16-source-ambiguity-gate-deadlock.md)；主路径可用性优先 |
| 原子组无组级终态 | 「一败一成」半发布 | Ops 组级状态机条款 |

DEVELOPMENT 已要求命中「多步状态机…」的 Spec 写伪代码，但**没有**可解析的状态机合同文法与机器门禁，评审仍可能只看到散文。

## 2. 目标与非目标

**目标**

1. 给「需要状态机」的 Spec 一份可解析合同小节文法（状态、转移、终态、非终态持久化、逃生边、禁止布尔冒充）。
2. 门禁生效后，`lint:spec-docs` 能拦住缺项（夹具可打假）。
3. 在 `DEVELOPMENT.md` 落盘清单增加一行指针（与交互合同并列）。
4. 附录登记存量高风险路径盘点，只作跟进指针，**不**宣称已合规。

**非目标**

- 不引入第三方状态机运行时库，不规定实现必须用 XState／自研库。
- 不在本条修复任一业务路径的运行时行为。
- 不把 vitest 业务断言写成客户场景 UAT PASS。
- 不要求纯文案／IA／无分支视觉 polish Spec 写状态机合同。

## 3. 决策（草案；待终稿确权）

| 编号 | 决策 | 裁定（草案） |
|---|---|---|
| D1 | 触发 | 去掉围栏后满足任一：正文二级标题去掉空白后为「多步状态机合同」或「多步状态机合同适用」；或 DEVELOPMENT 伪代码触发语在 Spec 中被显式引用且本 Spec **改变**该流程语义；或正文含固定短语「状态机合同适用」。线索只决定要不要检查 |
| D2 | 必填合同 | 恰好一个「多步状态机合同」小节；字段见 §4。缺任一必填字段 → 失败 |
| D3 | 豁免 | 恰好一个「多步状态机合同豁免」小节；原因须含固定短语「无多步状态／门禁／发布／恢复语义」；全文不得同时出现「多步状态机合同」与有效豁免 |
| D4 | grandfather | 门禁落地提交时 `git ls-files docs/specs/*.md` 写入名单。名单内文件在无标记行且状态行不含「开发授权已获得」时，本规则直接通过 |
| D5 | 授权口令 | 唯一取消 grandfather 的状态短语＝「开发授权已获得」（与交互合同门禁同形） |
| D6 | 主路径 | 合同必须列出至少一条「合法用户仍可用」的逃生边或显式写「无拦截态／本流程无 DENY」。只写「约束生效」无逃生 → 失败 |
| D7 | 布尔禁令 | 合同必须含一行「禁止用单一布尔／`ok` 冒充终态」的固定短语（见 §4），并点名本流程的终态枚举 |
| D8 | 持久化 | 若流程跨请求／跨进程，合同必须声明非终态是否落库及收敛入口；纯进程内短流程可写「不跨进程：不落库」 |
| D9 | 范围 | 入 `0.30` 总账；**不入核心分母**。落地只改文档门禁与治理正文 |
| D10 | 生效 | 定稿 ≠ 门禁生效。生效＝另获开发授权后，lint／名单／DEVELOPMENT 同次落地 |
| D11 | 存量整改 | 附录盘点行的运行时整改须**另立总账行**并各自授权；本条出口不含实现 |

D1–D11 中开放项见 §7（OQ）。

## 4. 文法（Normative 草案）

解析前先删除围栏代码块。二级标题去掉空白后整句匹配，不接受编号前缀。

### 4.1 「多步状态机合同」必填行

下列键名去掉空白后整行以 `键：` 开头（中文冒号），值非空：

| 键 | 含义 |
|---|---|
| `状态集` | 有限状态列表，逗号或顿号分隔 |
| `终态` | 终态子集；须 ⊆ 状态集 |
| `合法转移` | 至少一行 `当前 --事件--> 下一`；禁止散文「系统应正确转移」 |
| `非终态持久化` | `落库`／`不跨进程：不落库`／`落库+收敛入口：…` 三选一前缀 |
| `逃生边` | 合法用户在拦截／失败后的下一步；或固定短语 `无拦截态` |
| `禁止布尔冒充终态` | 必须含固定短语 `禁止用单一布尔或 ok 冒充终态`，并写出本流程终态枚举名 |

可选键：`组级终态`（原子写集时必填）、`两套状态机不得混用`（多握手／多协调器时必填）。

### 4.2 豁免

「多步状态机合同豁免」小节恰好两行：

1. `原因：` + 含 `无多步状态／门禁／发布／恢复语义`
2. `不改变：` + 非空说明

### 4.3 标记行（可选）

正文单独一行去掉空白后恰好为 `状态机合同门禁：纳入检查` 时，即使尚在 grandfather 名单且无授权口令，也进入检查（作者自愿提前接受）。

## 5. 核心流程（伪代码）

```text
function checkStateMachineContract(specPath, planPath, grandfatherSet):
  text = stripFencedCode(read(specPath))
  if specPath in grandfatherSet
     and statusLine(spec) does not contain "开发授权已获得"
     and text has no line "状态机合同门禁：纳入检查":
    return PASS   # 不解析合同／豁免

  triggered = hasHeading(text, "多步状态机合同")
           or hasHeading(text, "多步状态机合同适用")
           or hasPhrase(text, "状态机合同适用")
           or (referencesPseudocodeTrigger(text) and mutatesPipelineSemantics(text))

  hasExempt = hasHeading(text, "多步状态机合同豁免")
  if hasExempt and hasHeading(text, "多步状态机合同"):
    return FAIL("豁免与合同并存")
  if hasExempt:
    return parseExempt(text) ? PASS : FAIL("豁免文法")
  if not triggered:
    return PASS

  block = requireExactlyOneHeadingBlock(text, "多步状态机合同")
  for key in [状态集, 终态, 合法转移, 非终态持久化, 逃生边, 禁止布尔冒充终态]:
    if missingOrEmpty(block, key): return FAIL(key)
  if not contains(block["禁止布尔冒充终态"], "禁止用单一布尔或 ok 冒充终态"):
    return FAIL("布尔禁令短语")
  if not escapeOk(block["逃生边"]):  # 非空且非仅「拦住」
    return FAIL("逃生边")
  if needsGroupTerminal(block) and missing(block, "组级终态"):
    return FAIL("组级终态")
  return PASS
```

## 6. 验收（草案）

| 编号 | 验收 | 验证方式 |
|---|---|---|
| SC-01 | 触发且缺「多步状态机合同」→ lint 失败 | 夹具 |
| SC-02 | 合同缺任一必填键 → 失败 | 夹具 |
| SC-03 | 缺固定短语「禁止用单一布尔或 ok 冒充终态」→ 失败 | 夹具 |
| SC-04 | 逃生边为空或仅写拦截无下一步 → 失败 | 夹具 |
| SC-05 | 合法豁免（固定短语齐）→ 通过 | 夹具 |
| SC-06 | 豁免与合同并存 → 失败 | 夹具 |
| SC-07 | grandfather 内、无授权口令、无标记行 → 通过（即使缺合同） | 夹具 |
| SC-08 | grandfather 内但状态含「开发授权已获得」且缺合同 → 失败 | 夹具 |
| SC-09 | 标记行「状态机合同门禁：纳入检查」取消跳过 | 夹具 |
| SC-10 | `DEVELOPMENT.md` 落盘清单有本条指针句；测试门禁文档若新增命令则已登记（本条默认不新增 npm script 名，只扩展既有 `lint:spec-docs`） | 文 diff＋可选单测 |
| SC-11 | 落地 diff 白名单：仅 Spec／Plan／索引／`lint-spec-docs*`／grandfather json／`DEVELOPMENT.md`／本附录盘点；**无** `webui/src`、`webui/server`、KTX | 路径检查 |
| SC-12 | 附录盘点表存在；每行有「已有 Spec 指针」或「待另立整改行」或「本条不整改」 | 人工＋结构检查 |

测试台：not_registered。本条是文档门禁，不挂客户场景 UAT；不得写 UAT PASS。

## 7. 开放项（待委托人决策）

| ID | 问题 | 选项 | 倾向（非决定） |
|---|---|---|---|
| OQ-1 | 触发是否包含「仅含伪代码小节、未写状态机用语」的 Spec | A 仅显式用语／标题；B 凡命中 DEVELOPMENT 伪代码触发语义即查 | A（少误伤；作者加「状态机合同适用」一行即可） |
| OQ-2 | 合法转移是否要求机器可解析箭头文法 | A 只查非空；B 强制 `当前 --事件--> 下一` 行格式 | B（与本草案 §4 一致） |
| OQ-3 | 附录盘点是否在本条授权落地时同步开整改子行 | A 只盘点；B 同步开 P1 整改行（仍无开发授权） | A |
| OQ-4 | 优先级 | 保持 P1／待裁定／降 P2 | 保持 P1（治理债，不挡原 P0） |

## 8. 落地白名单（获开发授权后）

允许修改：

- `scripts/lint-spec-docs.mjs`、`scripts/lint-spec-docs.test.mjs`（或现行等价测试路径）
- `docs/governance/` 下本门禁 grandfather json（新建）
- `docs/governance/DEVELOPMENT.md`（落盘清单一行＋短节）
- 本 Spec／配对 Plan／`docs/README.md`／`docs/plans/README.md`／总账与需求池镜像句
- 可选：`docs/governance/test-layers-and-release-gates.md`（仅当命令表需登记规则名说明）

禁止：`webui/src/**`、`webui/server/**`、KTX、客户部署清单。

## 9. 附录：存量高风险路径盘点（指针；≠ 已合规）

| ID | 路径 | 已知问题模式 | 权威 Spec／错题 | 本条处置 |
|---|---|---|---|---|
| INV-01 | Ops 批量编排／组级终结 | 非终态、聚合分叉、一败一成 | Ops 控制面 Spec G21 等 | 待另立整改行 |
| INV-02 | MCP 会话恢复与客户端 initialize | 两套握手混用 | P1-37 MCP UX resilience | 待另立整改行（或确认合同已自带） |
| INV-03 | 表级歧义门闩确认／逃生 | 死路／usableTargets | P0-3／P1-35；错题 deadlock | 待另立整改行（或确认合同已自带） |
| INV-04 | BindingSession／口径绑定 | 二分冒充四态 | P0-1 相关 Spec | 待另立整改行 |
| INV-05 | 发布工作台／supervisor | 流水线态 | 既有 publish／191 Spec | 待另立整改行 |
| INV-06 | 按钮级成功反馈 | 布尔冒充 | P1-40／P1-42 | 已有专条；本条不整改 |

## 10. 落盘清单自检

| # | 项 | 本条 |
|---|---|---|
| 1 | Spec／Plan 共用 `lucy-20261118-multi-step-state-machine-contract-gate` | 是 |
| 2 | 伪代码小节 | §5 |
| 3 | 元数据状态 | 头部 |
| 4 | Plan 五类小节 | 配对 Plan |
| 5 | Terminology Compliance | 有 |
| 6 | Design System Compliance 四段式 | 有 |
| 7 | 索引 | 待写入 README |
| 11 | 闭口层级 | 有 |
| 13 | 交互合同 | 豁免小节 |
| 14 | 总账 | P1-48／REQ-030-069 |
| 16 | 主路径可用性 | D6／逃生边 |
