# 长追问题组（性能专用）Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能合同 Spec / **v0.1-draft** |
| 日期 / 目标版本 | 2026-11-23 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-79／REQ-030-100**；P1（测试内容；P1-78 的长追问性能依赖） |
| 台账号 | 无 |
| 阶段 | S1 |
| 状态 | S1｜v0.1-draft。委托人2026-11-23授权补充长追问题组并登记；终稿未确权；开发未授权；仅设计与登记；≠ 功能合同收口；≠ 可上线。 |
| 授权边界 | 仅新建 Spec／Plan 并登记。不得编写题组正文、逐轮 oracle 值或可执行题库文件；不得执行 UAT；不得修改 P1-54 题库文件或其 digest；不得改动 P1-53 的任何证据或判定。题组编写与校验实现须另发开发授权。 |
| 需求 / 总账 | [REQ-030-100](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-100长追问题组性能专用) · [P1-79](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) |
| 计划 / 消费方 | [Plan](../plans/lucy-20261123-long-followup-question-pack-plan.md) · 消费方 [P1-78 MCP 问询端到端性能基准](lucy-20261123-mcp-inquiry-performance-baseline-spec.md) |
| 关联合同 | [P1-54 题库](lucy-20261118-mcp-upgrade-question-bank-spec.md) · [P1-53 升级兼容](lucy-20261118-mcp-upgrade-compatibility-spec.md) · [P1-78 性能基准](lucy-20261123-mcp-inquiry-performance-baseline-spec.md) · [全局规模基线](../qa/uat/scale-baseline.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：提供一份可机检的长追问题组——同一宿主进程与会话内、首轮之后不少于 20 次语义承接的追问，且每一轮都有独立可核对的 oracle；P1-78 的长追问性能门禁可直接消费，题组缺失时消费方记 BLOCKED。
- 本条出口：SC-01–SC-06（§6）。
- 不在本条出口：P1-54 既有题库内容与其 digest；P1-53 的四入口流程与已收口证据；性能预算、样本与判定；任何产品运行时行为；P1-78 的其他性能场景。
- 上线关系：本条收口不表示可上线。

## 1. 事实与立项理由

1. **缺口**：[P1-54](lucy-20261118-mcp-upgrade-question-bank-spec.md) 现有 `QB-FOLLOW-01／02／03` 均为 3 轮量级，没有 ≥20 轮的单进程长链；P1-78 的 `LONG_FOLLOW` 场景因此无法由既有题库供给。
2. **不能直接改 P1-54 题库文件的原因**：P1-53 的 candidate／instance 证据绑定 `scripts/e2e/contracts/mcp-upgrade-journeys.yaml` 的 `suiteDigest`，P1-54 题库的 digest 变更会使命中该 digest 的**已收口 X_REL 证据失效**，并要求全量重跑四入口与严口径复跑。
3. **本条做法**：题组以**独立题组包**（独立文件、独立 `packDigest`）交付，语义继承 P1-54，既补齐长链，又不动已收口的题库与证据。若委托人选择并入 P1-54，需另发 P1-54 版本补丁并同步重跑 P1-53。
4. **职责分离**：题目与 oracle 属内容合同，性能预算与判定属 P1-78。本条只拥有题组内容、结构、版本与校验口径；P1-78 只读消费。

## 2. 决策（Normative）

| ID | 决策 | 合同 |
|---|---|---|
| D1 | 独立题组包与独立 digest | 题组存于独立文件、独立 `packDigest`；不进入 `mcp-upgrade-journeys.yaml`，不改 P1-53 的 suiteDigest |
| D2 | 语义继承 P1-54 | 指标、维度、口径、身份语义、oracle 写法与 `budgetClass` 语义全部沿用 P1-54；本条不另立语义口径 |
| D3 | 链结构 | 每链首轮之后**不少于 20 次后续追问**（链内总轮次 ≥21）；`turnIndex` 从 0 连续递增，无缺号、无重号 |
| D4 | 逐轮 oracle | 每一轮都有**独立可核对**的 oracle（指标、维度、筛选、口径、值或结构）；禁止“同上”“沿用上一轮”作为该轮 oracle |
| D5 | 语义承接 | 每轮必须显式引用上一轮上下文（`dependsOnTurn`）；禁止把互不相关的独立问题串成链 |
| D6 | 单进程同会话 | 链在同一宿主进程与同一宿主会话内执行；题组须声明每轮的依赖与可承接字段，使消费方能校验上下文未丢 |
| D7 | 版本与可比性 | 题组带 `version` 与 `packDigest`；改题即改 digest，性能基线不得跨 digest 比较 |
| D8 | 只读消费 | P1-78 不得改写题组文本或 oracle；题组变更须独立评审并升版本，旧基线保留原 digest |

## 3. 题组合同

### 3.1 文件与字段

- 可执行题组文件（实现阶段创建）：`scripts/e2e/contracts/mcp-inquiry-long-followups.yaml`。
- 顶层字段：`contract／version／packDigestSeed／cases[]`。
- `cases[]` 每条链：`id`（`QB-LONG-<nn>`）／`version`／`lane`／`configProfileId`／`budgetClass`／`identity`／`connectionId`／`turns[]`／`oraclePerTurn`／`evidence`。
- `turns[]` 每轮：`turnIndex`／`text`（自然语言）／`dependsOnTurn`（首轮为空，其余指向前一轮）／`carriedContext`（本轮须承接的上一轮事实）。

### 3.2 覆盖要求

| 项 | 要求 |
|---|---|
| 链数 | 至少 3 条：`simple`、`complex` 与 `follow-up-join` 各至少 1 条 |
| 轮数 | 每条链 ≥21 轮；不足即不合规 |
| 身份 | 普通只读身份为主；至少 1 条链覆盖 `lucy_admin` 全局范围，至少 1 条链覆盖受限角色的部分重叠范围 |
| 承接类型 | 至少各含一类：时间窗推移、维度拆分、口径收窄、条件叠加、跨表关联；不得整链只重复同一问法 |
| oracle | 每轮独立可核对；跨轮承接项写在 `carriedContext` 与该轮 oracle 的关系中，不得省略该轮可判定值 |
| 证据 | 每轮记录 `requestId／traceId／identityId／snapshotId` 等既有证据字段，口径与 P1-54 一致 |

### 3.3 校验口径

实现后的校验器必须逐项检查：schema 形状；`turnIndex` 连续；轮数下限；`dependsOnTurn` 链式且无环；每轮 oracle 非空且可机检；身份与连接在题组中声明；`packDigest` 可重算。

## 核心流程（伪代码）

```text
validateQuestionPack(pack):
  require pack.contract == "lucy-mcp-inquiry-long-followups-v1"
  for chain in pack.cases:
    require chain.id matches /^QB-LONG-\d{2}$/
    require chain.turns.length >= 21
    for i, turn in enumerate(chain.turns):
      require turn.turnIndex == i
      require turn.text is non-empty natural language
      require turn.oracle is non-empty and machine-checkable
      if i == 0: require turn.dependsOnTurn is empty
      else: require turn.dependsOnTurn == i - 1
      require turn.carriedContext references the previous turn's subject
    require chain.evidence fields are declared
  require distinctBudgetClasses cover simple, complex, follow-up-join
  digest = canonicalHash(pack without digest field)
  require pack.packDigest == digest else INVALID
  return digest
```

## 4. 与 P1-78 的消费合同

- P1-78 在 `LONG_FOLLOW` 场景只写 `questionRef`，按本条的 `packDigest` 固定题组版本；题组升版后旧基线保留原 digest，不得混算。
- 链比例按场景实例数计算 `ceil(0.1×N)`，题组提供足够链数以满足该比例；链不足时 P1-78 记 BLOCKED，不得由消费方拆链凑数。
- 每链须记录 `chainId／processId／hostSessionId／turnIndex`；宿主会话中断或轮次缺失时该链无效，题组不为此放宽要求。
- 本条不设性能预算、不判定快慢、不改判定器；这些归 P1-78。

## 5. 开放项与边界

- 题组正文、逐轮 oracle 值与校验脚本的实现尚未授权；本轮只落合同与登记。
- 若 P1-78 的 `SOAK` 需要更多链（例如按角色再分），题组需增链并升版；题组不因消费方数量需求被裁剪。
- 本条不进入 0.30 核心分母；它是 P1-78 的内容依赖，缺失时表现为 P1-78 的 BLOCKED。

## 6. 验收

| ID | 可打假检查 | UAT |
|---|---|---|
| SC-01 | 题组文件形状、字段与 ID 规则可机检；`packDigest` 可重算且与内容一致 | 消费方 `UAT-MIP-R0` 的题组校验步骤＋本条自检 |
| SC-02 | 每链轮数 ≥21 且 `turnIndex` 连续无缺号重号；`dependsOnTurn` 链式无环 | 本条自检＋消费方 `UAT-MIP-15` |
| SC-03 | 每轮 oracle 非空且可机检；不存在“同上／沿用上一轮”占位 | 本条自检＋消费方 `UAT-MIP-15` |
| SC-04 | 至少 3 条链覆盖 simple／complex／follow-up-join，含时间窗推移、维度拆分、口径收窄、条件叠加与跨表关联 | 本条自检 |
| SC-05 | 身份覆盖：普通只读、`lucy_admin` 全局范围与受限角色部分重叠范围各有链；连接与角色声明与题组配置一致 | 本条自检＋消费方 `UAT-MIP-15` |
| SC-06 | 消费方只读：P1-78 题组引用只有 `questionRef`，无题组文本或 oracle 副本；题组升版后旧基线保留原 digest | 本条自检＋消费方 `UAT-MIP-13` |

## 受影响画像

> 事实源：[Lucy 用户画像](../governance/user-personas.md)。本条为测试内容合同，不改变任何运行时路径。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 追问路径未被压测覆盖，长会话体感可能长期无人看守 | 长链进入正式性能门禁，问题上下文丢失或轮次变慢会被发现并阻断发布 | P1·问数面 ↑（通过门禁看护）／P1·报告面 ＝ | SC-01／02／03 与消费方 `UAT-MIP-15`；报告面未触碰 | — |
| P2 治理方 | 语义与授权路径不变 | 语义与授权路径不变；题组只复用既有口径与身份 | ＝ | SC-04／05；未改语义层、Wiki、Skill 与授权配置 | — |
| P3 运维方 | 长会话性能缺少可复算证据 | 题组版本、digest 与链级证据可定位回退来源 | P3·运行观察面 ↑／P3·交付运维面 ＝ | SC-01／06；交付与升级路径未变 | — |
| P4 管理层 | 长会话体验缺少可解释口径 | 可引用长链通过率与链级时延，不以门禁全绿冒充价值兑现 | ↑ | SC-01／06 | — |

## 交互合同豁免

- 原因：本条只新增测试题组内容与校验口径，不改变用户可见 WebUI 表面。
- 不改变：MCP 工具、问询预算、权限与语义合同；题组只在测试台内被宿主按自然语言提问，不进入生产流量。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: 「长追问题组」「题组包」「逐轮 oracle」「`packDigest`」为工程与测试术语，不新增用户可见产品概念；`turnIndex`、`requestId`、`traceId`、`snapshotId`、`budgetClass` 保留既有口径。题组中的自然语言属测试题面，不是产品文案，不进术语标准。

## 修订记录

- 2026-11-23 v0.1-draft：新建长追问题组合同，补齐 P1-78 长追问场景的题目来源；独立题组包与独立 digest，不改 P1-54 题库与 P1-53 已收口证据。
