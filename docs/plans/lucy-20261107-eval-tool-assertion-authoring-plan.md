# Lucy Eval 路径断言在 WebUI 侧可编排 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立；待 PM 指派后再登记 |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。S0–S6 全部未开工 |
| 授权边界 | **不授权改代码。** 本 Plan 只定义步骤、验收与完成定义；开工须先取得本条的开工授权（PM 评审 Spec 与本 Plan 后明示） |
| 验收 | S0–S6 各自出口见 §4；本条总出口＝Spec 的 SC-01–SC-11 全部关闭 |
| 对应 Spec | [lucy-20261107-eval-tool-assertion-authoring-spec.md](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md) |
| 需求池条目 | REQ-030-019 |
| 分支级决策 | D3＝(b) 先补 4 个预算型（委托人 2026-11-07 裁定），直接采用 |

---

## 目标

把 runner 侧**已经完备**的路径（工具）断言能力，暴露到 WebUI 的三个编排面上，让管理员不必手改 YAML 就能写「同一 filter 不得重复查」这类断言。

1. **类型层**：前端 `ToolAssertion` 从 4 型扩到 8 型（补 4 个预算型），前端与服务端 `EvalCase` 补 `tool_assertions` 字段。
2. **编辑器层**：用例编辑器新增「工具断言」页签，可新增 / 编辑 / 删除预算型断言，读写闭环打通（新建 → 保存 → 导出 YAML 字段无损 → 跑批可判失败）。
3. **失败关闭层**：写入前端不支持或不合法的断言类型时，保存与导出**一律报错**，不得静默丢弃；既有 4 型路径断言**不得因编辑器往返而丢失**。

不做：不改 runner 断言语义与失败文案；不新增断言类型；不在本条暴露路径型断言的**编辑**能力；不引入新的 Eval 跑批引擎。

## 开工前置

开工前必须全部满足，缺一项即停：

1. **开工授权**：PM 评审通过本 Spec 与本 Plan，并明示授权实现。**未授权前 S0–S6 全部不得开始**——S0 含「同步登记术语」（写 `webui/docs/00-product-terminology-standard.md`）这一**真实写操作**，不得以「先登记术语」为由在未授权状态下落盘；PM 明示授权后才从 S0 起。
2. **术语登记**：「工具断言 / 路径断言 / 预算断言」先登记进 `webui/docs/00-product-terminology-standard.md`（新增机器可见术语不先登记就实现，属术语违规）。
3. **类型清单落位裁决**：确认断言类型清单的单一事实源落法（Spec D2）：首选前端 `import` 服务端常量（既有先例 `webui/src/components/audit-trust/ReadonlySqlRowset.tsx:21`）；若打包边界不允许，退化为「前端镜像 ＋ CI 一致性断言」。**二者择一必须在 S1 出口落定**，不得放任两份手写清单。
4. **计数口径确认**：确认断言类型全集为 **8 型**（Spec §1.3）。分支计划已更正为 8 型；**需求池条目正文仍写 7 型**（`docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md:478`、`:482`），该处由索引维护方更正。实施与文档一律以 8 型为准。
5. **编辑器现状取证**：本机复跑并保存改动前的基线——既有 `evals/**` 用例在跑批中的判定结果，以及编辑器打开既有含路径型断言用例时的 YAML 往返快照，作为红/绿基线。
6. **依赖裁决**：REQ-030-020（G3）的草稿导出可能产出路径型断言，而本条编辑器**不支持编辑**该类。开工前确认：020 草稿落地走 YAML 文件路径（不经 WebUI 表单），并在本条 D6 的「只读保留不丢弃」上闭环。
7. **分支级顺序确认**：本条是 W2 波次，与 W1（G1 / REQ-030-018）可并行（文件不重叠：Eval 编排层 vs proxy 响应层）；但**不得**与 G1 争同一文件。

## 实施步骤

| 步骤 | 内容 | 产出 | 关联验收 |
|---|---|---|---|
| S0 | 取红基线：复跑既有 `evals/**` 用例跑批，记录既有断言判定结果；抓取含路径型断言用例的编辑器 YAML 往返快照。同步登记术语 | 基线证据 ＋ 术语标准更新 | 前置项 |
| S1 | 断言类型清单单一登记：新增服务端常量模块，导出 8 型全集 ＋ 预算型必填字段合同 ＋ 编辑器可编辑集合（4 预算型）；前端联合类型与前端 `EvalCase`、服务端 `EvalCase` 均据此对齐（补 `tool_assertions` 字段） | 类型清单模块 ＋ 三处类型对齐 ＋ 类型断言 | SC-01、SC-02 |
| S2 | 编辑器「工具断言」页签：页签定义、预算型断言行的增 / 删 / 改、既有路径型断言的只读保留（不丢弃）、顺序即断言顺序 | 页面改动 ＋ 组件测试 | SC-03、SC-07 |
| S3 | 服务端失败关闭：`addCase` / `updateCase` 校验断言类型与必填字段，非法抛 `InvalidCaseSchemaError`（422）；编辑器保存前与导出前跑同一份校验，校验不过不产出 YAML | 服务端校验 ＋ 单元 ＋ 客户端校验 | SC-04、SC-06 |
| S4 | 跑批闭环打假：新建带 `max_repeated_tool_input` 的用例 → 保存 → 导出 YAML 字段无损比对 → 跑批判出 `budget: max_repeated_tool_input` 失败 | 本机自动化用例 ＋ 证据 | SC-04、SC-05 |
| S5 | 回归：既有 4 型路径断言用例判定结果不变；runner 失败文案不变；`evals/**` 既有文件内容未被编辑器改写 | 回归比对 ＋ runner 单测 | SC-08、SC-09 |
| S6 | 复跑取证：SC-01–SC-11 全绿；跑 `lint:spec-docs` / `lint:spec` / `lint:terminology`；写收口记录 | 绿证据 ＋ 收口记录 | SC-01–SC-11 |

**步骤依赖**：S1 → S2、S3；S2 与 S3 可并行，但**同一工作区不并行写同一文件**（`CaseEditor.tsx` 与 `cases.ts` 分属 S2 / S3，归属清晰）。S4 依赖 S2 ＋ S3；S5 依赖 S3；S6 依赖 S4 ＋ S5。

## 验收

### 4.1 步骤出口

| 步骤 | 出口判定 |
|---|---|
| S0 | 基线可复现：既有跑批判定结果已存档、含路径型断言用例的 YAML 往返快照已存档；三个术语已登记 |
| S1 | 前端 `ToolAssertion` 覆盖 8 型；前端与服务端 `EvalCase` 均含 `tool_assertions`；类型断言通过；单一事实源落法已落定 |
| S2 | 编辑器出现「工具断言」页签；预算型可增 / 删 / 改；打开含路径型断言的既有用例后 YAML 往返断言仍在 |
| S3 | 未知类型 / 预算型缺必填字段 → 保存被拒（422）且用例文件未变；编辑器导出在校验不过时不产出 YAML |
| S4 | 新建 → 保存 → 导出 YAML 字段逐字保留；跑批判出 `budget: max_repeated_tool_input` 失败 |
| S5 | 既有路径型用例判定结果与 S0 基线一致；runner 失败文案不变；`evals/**` 既有文件 diff 为空 |
| S6 | SC-01–SC-11 全部通过；**四个** lint 门禁（`lint:spec-docs` / `lint:spec` / `lint:terminology` / `lint:ia-boundary`）exit 0 |

### 4.2 证据等级

- 本条收口证据以**本机自动化**（类型断言 / 单元 / 组件测试 / 跑批打假）＋**CI job** 两级为准。
- 真实客户环境、真实 Agent 客户端、镜像构建与客户交付**不在本条出口**；需要时按 `docs/governance/DEVELOPMENT.md` 归发布取证层处理。
- 不得用 mock 冒充「跑批判失败」：该断言必须由 CLI runner 的真实判定输出给出（失败文案含 `budget: ` 前缀）。
- 不得用 mock 冒充「保存被拒」：该断言必须由服务端 `addCase` / `updateCase` 抛错 + 用例文件回读比对给出。

### 4.3 门禁

| 命令 | 期望 |
|---|---|
| `npm run lint:spec-docs` | exit 0（本 Spec 与本 Plan 需在 `docs/README.md` / `docs/plans/README.md` 登记，登记由索引维护方完成） |
| `npm run lint:spec` | exit 0 |
| `npm run lint:terminology` | exit 0（新术语已登记） |
| 受影响测试文件 | 全绿 |

## 完成定义

- [ ] Spec 的 SC-01–SC-11 全部关闭，逐条落点写进 Spec §4 与收口记录。
- [ ] 前端类型覆盖 8 型；前端与服务端 `EvalCase` 均含 `tool_assertions`。
- [ ] 编辑器「工具断言」页签可用；预算型断言增 / 删 / 改与顺序语义成立。
- [ ] 未知 / 非法断言类型保存被拒（422），断言**未被静默丢弃**；导出同样受约束。
- [ ] 既有 4 型路径断言在编辑器往返中不丢失，跑批判定结果与基线一致。
- [ ] runner 断言语义与失败文案未变；`evals/**` 既有 YAML 内容 diff 为空。
- [ ] 新术语已登记进术语标准；无新增用户可见译名之外的文案。
- [ ] 未改动 runner 断言语义、未新增断言类型、未引入新的 Eval 跑批引擎、未改动 legacy → canonical 归一化与 canonicalize。
- [ ] 状态镜像改齐：Spec 头部「状态」行（本条事实源）、本 Plan 头部、`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md`；需求池 REQ-030-019 条目状态同步为「已开 Spec/Plan，待评审」。
- [ ] 收口记录写入 `docs/reviews/`，并注明「本条收口不表示可上线」。

## 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 类型与运行器漂移 | 三处手写清单时，runner 加型而 WebUI 不认 → 保存过了但跑批判 `unsupported` | Spec D2 单一登记；S1 出口强制落定落法；SC-01 类型断言 ＋ SC-09 文案比对 |
| 编辑器改坏既有用例 | 表单重建时剔掉不支持的断言类型 → 保存即静默删数据 | Spec D6 只读保留；SC-07 往返比对；SC-06 断言不得静默丢弃 |
| 客户端校验被绕过 | Raw JSON 页签绕过前端校验 | Spec D4 把强制点放在服务端 `addCase` / `updateCase`；SC-06 走服务端路径断言 |
| 校验口径与 runner 不一致 | WebUI 放行但 runner 判 `unsupported tool_assertion` → 白跑一轮 | 字段合同逐条对齐 runner 行号（Spec §1.4）；SC-05 跑批打假 |
| 既有 YAML 被误改 | 编辑器保存整对象重写 YAML | SC-05 / SC-08 回归比对；S5 出口要求 `evals/**` diff 为空 |
| 与 REQ-030-020 争断言面 | 020 草稿可能含路径型断言，本条编辑器不支持编辑该类 | 开工前置第 6 条；D6 保证该类断言在编辑往返中不丢 |
| 与 `0.30` 其他批次争同一文件 | 本条改 `webui/src/lib/types.ts`、`webui/src/pages/eval/CaseEditor.tsx`、`webui/server/eval/cases.ts` | 开工前对照批次地图确认归属；同一文件同一时刻只允许一个写入方 |

## 回滚

- S1／S2／S3 均为类型与页面／校验改动，回滚＝还原对应提交；无数据迁移、无配置写入。
- 术语标准登记项在回滚时同步撤回。
- 本条不产生任何持久化业务状态，故无数据回滚步骤。

## 出处

- 对应 Spec：[`lucy-20261107-eval-tool-assertion-authoring-spec.md`](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md)
- 需求池：[`REQ-030-019`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)
- 分支计划：[`lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](../plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md) §3.2、§4、§5、§9
- 落盘清单：[`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「新增 Spec / Plan 的落盘清单」
- 关键取证位置：`scripts/eval/eval-runner.mjs:720-844`、`webui/src/lib/types.ts:1949-1970`、`webui/src/lib/types.ts:2081-2085`、`webui/src/pages/eval/CaseEditor.tsx:147-155`、`webui/src/pages/eval/CaseEditor.tsx:474-660`、`webui/server/eval/cases.ts:33-64`、`webui/server/eval/cases.ts:291-293`、`webui/server/eval/runner.ts:322`
