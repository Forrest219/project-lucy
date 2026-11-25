# 长追问题组（性能专用）Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / **v1.0** |
| 日期 / 功能编号 | 2026-11-23 / **P1-79／REQ-030-100** |
| 状态 | S3｜v1.0。委托人2026-11-23授权补充长追问题组并登记；2026-11-24 镜像 Spec v1.0（最低链模板 5、模板声明角色类；O1＝A 题面自包含禁指代词，M1–M4 并入）；**终稿已确权（委托人 2026-11-24 明示「授权 P1-79 定稿，暂不开发」）**；**2026-11-26 委托人授权题组编写与校验器实现（Task 1–4，多 agent 并行）**；**题组正文与校验器产出已入工作树**（5 条链模板×21 轮、`packDigest: sha256:41ce9d18…`；校验器 25 例；消费方只读守卫与 BLOCKED 路径成立；未提交、无真实跑次）；真实跑次仍未授权；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| 授权边界 | 2026-11-26 委托人授权 Task 1–4（题组编写、校验器实现、消费方只读守卫、台账文档同步）；任何真实跑次仍未授权；不得修改 P1-54 题库文件与其 digest，不得改动 P1-53 证据，不得新增产品运行时改动。 |
| 验收 | [Spec SC-01–SC-06](../specs/lucy-20261123-long-followup-question-pack-spec.md#6-验收) 全过；题组自检通过；消费方 P1-78 的 `LONG_FOLLOW` 不再因缺题 BLOCKED。 |
| 关联 | [Spec](../specs/lucy-20261123-long-followup-question-pack-spec.md) · [消费方 P1-78](../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md) · [总账 P1-79](lucy-20261107-lucy-0-30-feature-inventory-pool.md) |

## 目标

产出并校验一份独立的**长追问题组**：每链首轮之后不少于 20 次语义承接的追问，每轮都有独立可机检 oracle，可供 P1-78 的长追问性能门禁直接消费。题组自带版本与 `packDigest`，不改 P1-54 题库，也不使 P1-53 的已收口证据失效。

## 架构

题组内容存放在独立 YAML 题组包中，由一个纯校验器负责 schema、轮数、`turnIndex`、`dependsOnTurn`、oracle 与 digest 检查；P1-78 只按 `questionRef` 与 `packDigest` 引用。题组文本与性能判定彻底分离：本条不引入任何计时、预算或门禁逻辑。

**技术栈**：仓库现有 Node.js `.mjs`、`node:test`、YAML；不使用新依赖，不触碰 KTX 与产品运行路径。

## 开工前置

1. Spec 终稿已确权（委托人 2026-11-24 明示）；仍须委托人另发题组编写与校验器实现的开发授权。
2. 明确题组语义的引用口径：指标、维度、口径与 oracle 写法沿用 P1-54，题组不得引入新语义。
3. 可用的普通只读身份、`lucy_admin` 全局身份与受限角色身份已就绪（身份来源为全局规模基线登记的 profile，不在本条自造）。
4. 确认题组落在独立文件，独立 digest 计算方式可复现，且不会写入 `mcp-upgrade-journeys.yaml`。
5. 确认本 Plan 不改 P1-54 题库、不改 P1-53 证据、不新增产品运行时改动。
6. **同角色类可见范围一致**：确认[规模基线 §1.1](../qa/uat/scale-baseline.md) 中同角色类（受限 A、受限 B 等）身份的可见范围一致；不一致时题组按该角色类内最窄一致范围写 oracle，或回规模基线处理，不在本条自造。
7. **题面规则**：Spec D9 已定（题面自包含、禁指代词、每轮单一意图，委托人 2026-11-24 选 A）；指代词表由校验器版本化并计入 `packDigest`。

## Task 1：题组包 schema 与纯校验器（TDD）

**文件：**

- Create `scripts/e2e/contracts/mcp-inquiry-long-followups.yaml`（题组正文，实现阶段）
- Create `scripts/e2e/lib/mcp-inquiry-question-pack.mjs`
- Create `scripts/e2e/__tests__/mcp-inquiry-question-pack.test.mjs`

**步骤：**

1. 先写失败测试：schema 形状、ID 规则 `QB-LONG-<nn>`、轮数 ≥21、`turnIndex` 连续、`dependsOnTurn` 链式无环、每轮 `turns[].oracle` 非空且可机检、模板 `budgetClass` ∈ `{simple, complex, follow-up-join}`、题面不含指代词（Spec D9）、`packDigest` 可重算、digest 不匹配即拒绝。
2. 先写负例夹具：21 轮以下、缺号、重号、环依赖、空 oracle、“同上／沿用上一轮”占位、缺 `carriedContext`、缺身份或连接声明、**题面含指代词（「那 12 月呢？」「它」「同上」等）**、**`budgetClass` 越界（如 `follow-up`、`ops-w0`、缺失）**。
3. 实现 `validateQuestionPack(pack)`，返回 `{ok, digest, problems}`；不联网、不读凭据、不写文件。
4. 实现 canonical digest 计算，字段顺序与空值处理固定并写入注释与测试。

**验证：**

```bash
node --test scripts/e2e/__tests__/mcp-inquiry-question-pack.test.mjs
```

预期：正例 PASS；负例逐项被拒并给出具体问题码；digest 不可由人工填写绕过。

## Task 2：题组正文与逐轮 oracle

**文件：**

- Update `scripts/e2e/contracts/mcp-inquiry-long-followups.yaml`

**步骤：**

1. 按 Spec §3.2 编写至少 5 条链模板：`simple`、`complex`、`follow-up-join` 各至少 1 条，每条 ≥21 轮。
2. 每轮写自包含的自然语言（带完整范围、无指代词、单一意图，Spec D9）、`dependsOnTurn`、`carriedContext`（被显式重述的范围项）与 `turns[].oracle`；「单一意图」由人工评审并写入自检记录；承接类型至少覆盖时间窗推移、维度拆分、口径收窄、条件叠加、跨表关联各一类。
3. 身份与连接：每个模板声明角色类；普通只读为主，另含 `lucy_admin` 全局范围、受限角色 A、受限角色 B 各至少 1 个模板。逐轮 oracle 对同角色类任一身份等价成立。
4. oracle 沿用 P1-54 写法，值必须来自真实夹具可核对事实；不得写占位或“同上”。
5. 题组文本、oracle 值与 P1-54 语义冲突时回到 P1-54，不在本条自造口径。

**验证：**

```bash
node scripts/e2e/lib/mcp-inquiry-question-pack.mjs --pack scripts/e2e/contracts/mcp-inquiry-long-followups.yaml --validate
```

预期：退出码 0，输出 `packDigest`、链数与每链轮数；任一不合规退出码非 0。

## Task 3：消费方接线与只读守卫

**文件：**

- Modify `scripts/e2e/contracts/mcp-inquiry-performance.yaml`（只加 `questionRef` 与 `packDigest`）
- Modify `scripts/e2e/lib/mcp-inquiry-performance.mjs`（加载并校验题组；缺题即 BLOCKED）
- Modify `scripts/e2e/__tests__/mcp-inquiry-performance.test.mjs`
- Modify `docs/qa/uat/suites/mcp-inquiry-performance/fixtures.md`（引用题组 ID 与 digest，不复制题面）

**步骤：**

1. P1-78 场景文件只允许写 `questionRef` 与 `packDigest`；出现题面文本或 oracle 副本即由 lint／测试拒绝。
2. 消费方在开跑前调用题组校验器；题组缺失、digest 不匹配或链数不足时返回 BLOCKED，并明确指出缺口。
3. 加负例：题组缺一条长链、digest 被改、链轮数不足时消费方必须 BLOCKED，不得拆链或降比例凑绿。

**验证：**

```bash
node --test scripts/e2e/__tests__/mcp-inquiry-performance.test.mjs scripts/e2e/__tests__/mcp-inquiry-question-pack.test.mjs
```

预期：只读守卫与 BLOCKED 路径全部可检出。

## Task 4：台账与文档同步

**文件：**

- Modify `docs/qa/uat/suites/mcp-inquiry-performance/cases.md`（`UAT-MIP-15` 指向题组 ID 与 digest）
- Modify `docs/governance/e2e-ledger.md`
- Modify `docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md`
- Modify `docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md`
- Modify `docs/README.md`、`docs/plans/README.md`

**步骤：**

1. 题组自检与消费方 `UAT-MIP-15` 的证据按同一 `packDigest` 关联；题组升版后旧基线保留原 digest。
2. 台账、索引与状态镜像按 Spec 现值同步；本条状态为 S2（设计定稿），题组实现与自检证据齐备并获开发授权推进后，另行申报后续阶段。
3. 明确记录：P1-54 题库与 P1-53 证据未被本条改动。

## 验收

- Task 1–3：题组校验器正负例全绿；题组文件 ≥5 条链模板、每链 ≥21 轮、逐轮 oracle 独立可核对；消费方只读守卫与 BLOCKED 路径成立。
- Task 4：台账、索引与状态镜像同句；e2e 勾连可定位题组与消费方套件。
- 全程没有修改 P1-54 题库文件或其 digest、没有改动 P1-53 证据、没有新增产品运行时改动、没有在性能 spec 内复制题面。

## 完成定义

1. 一份带版本与 `packDigest` 的长追问题组存在并可机检，含 ≥5 条链模板，覆盖 simple／complex／follow-up-join 三档与四类角色（普通只读、`lucy_admin`、受限 A、受限 B）。
2. P1-78 的 `LONG_FOLLOW` 场景不再因“缺题”BLOCKED；剩余 BLOCKED 只反映环境或宿主能力。
3. 题组可复现、可追溯、可升版；旧基线与旧 digest 保留可查。

## 风险

| 风险 | 处理 |
|---|---|
| 指代式追问触发运行时「复述并等确认」，使某轮无查询结果 | Spec D9：题面自包含、禁指代词、每轮单一意图；校验器拦截；指代式体感由 P1-54 短链承担 |
| 同角色类身份可见范围不一致导致 oracle 分叉 | 开工前置 6：先核对规模基线；不一致时按最窄一致范围或回规模基线 |
| 题组与 P1-54 口径漂移 | 语义一律继承 P1-54；冲突即回 P1-54，不在本条自造 |
| 长链轮次过多导致 oracle 维护成本高 | 先保证 5 条模板达标；身份数增加由同角色类身份复用模板，不增模板；新增角色类或承接类型才另行升版 |
| 题组 digest 变化使性能基线失效 | 基线键含 `packDigest`；升版后旧基线保留原 digest，不混算 |
| 长链文本被性能 spec 复制 | 只读守卫与 lint 拦截；题面只存在于题组文件 |
| 被误当作产品文案 | 题组只在测试台使用，不进产品界面与发布叙事 |

## 浏览器验证

不适用：本题组只提供测试内容与校验口径，不改变任何用户可见 WebUI 表面，不强制浏览器测试。
