# Lucy 审计问询旅程 → Eval 用例草稿导出 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立；待 PM 指派后再登记 |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。S0–S6 全部未开工 |
| 授权边界 | **不授权改代码。** 本 Plan 只定义步骤、验收与完成定义；开工须先取得本条的开工授权（PM 评审 Spec 与本 Plan 后明示） |
| 验收 | S0–S6 各自出口见 §4；本条总出口＝Spec 的 SC-01–SC-11 全部关闭 |
| 对应 Spec | [lucy-20261107-audit-journey-eval-case-draft-spec.md](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md) |
| 需求池条目 | REQ-030-020 |
| 分支级决策 | D4＝(a) 单向导出（委托人 2026-11-07 裁定），直接采用 |

---

## 目标

把审计侧已经能读出的「原话 → 调用序列 → 结果」故事线，与 Eval 侧的用例之间补上一座**单向**的桥：

1. **读得出**：从一段真实审计问询取出三段素材（只读，不写审计）。
2. **推得出**：由调用序列**确定性**反推 `tool_assertions`（重复输入 → `max_repeated_tool_input`；命中特定工具 → `required_tool` / `forbidden_tool`；另含 `max_tool_calls` / `max_total_tool_calls`）。
3. **不漏密**：草稿里是**合成题干**，客户原话只留指纹，原文不落 YAML。
4. **不进池、不进跑批**：草稿只落草稿区 `inbox/eval-drafts/**`，**不在 `evals/**`**；人工复核并走既有 `confirm-review` 端点后，才算已批准用例。
5. **推不出就说推不出**：读不到素材 → 不产出草稿；读到但推不出断言 → 产出显式标注的零断言草稿。

不做：不反向回放生产审计；不自动改工具面；不新增 WebUI 页面或交互。

## 开工前置

开工前必须全部满足，缺一项即停：

1. **开工授权**：PM 评审通过本 Spec 与本 Plan，并明示授权实现。未授权前 S0 之后的任何步骤都不得开始。
2. **术语登记**：「旅程草稿 / 合成题干 / 原话指纹」先登记进 `webui/docs/00-product-terminology-standard.md`（新增机器可见术语不先登记就实现，属术语违规）。
3. **依赖裁决（与 G1 / REQ-030-018）**：分支计划把本条排在 W3，理由是「依赖 W1 产出稳定的 `next_step` 形状」。开工前确认 G1 的 `next_step` 形状已稳定；若尚未稳定，本条**可先行实现读取与反推部分**（不依赖 `next_step`），但**草稿的题干合成**须等 G1 稳定后再定稿，避免题干模板二次返工。
4. **依赖裁决（与 G2 / REQ-030-019）**：本条会产出路径型断言（`required_tool` / `forbidden_tool`），而 019 已裁定编辑器本条**不可编辑**路径型。开工前确认：① 草稿落地走 YAML 文件路径，不经 WebUI 表单；② 019 的「路径型断言只读保留、不得丢弃」已在其 Spec D6 中登记（未实现则本条草稿并入后有被编辑往返误删的风险，须在 019 完成后再并入正式用例）。
5. **阈值初值确认**：`TOOL_CALL_THRESHOLD`（单工具调用次数上限，Spec 默认 3）与「数据面工具集」（沿用 `webui/server/proxy/acl.ts:86-93` 的既有白名单，**不得新造**）须由 PM 确认初值后再实现。
6. **脱敏口径确认**：沿用 `evals/agent_reliability` 的脱敏合成约定（`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:13`、`:142`）。开工前确认「合成题干」的具体模板由谁定稿（PM 或业务负责人）。
7. **草稿区落位确认 ＋ 复核证据落点**：确认 `inbox/eval-drafts/{domain}/` 为草稿落位（`AGENTS.md:71-72` 把 `inbox/` 定位为过程性产物区）。该目录**不得**被 `evals/` 下的用例枚举或 CLI runner 的 `--cases` 路径指向。⚠️ **但 `inbox/` 全目录被 `.gitignore:59` 忽略，且 `AGENTS.md:72` 明写「进程结束后可随时删除」**——草稿若只落 `inbox/`，第二人无从复核（本条导出的是草稿 YAML 文本，落盘件是唯一载体）。故开工前必须一并定死：**草稿的保留期与复核证据落点**（例如：草稿文本随导出端点返回并由调用方归档到收口记录，或草稿区另行约定不入 git 的归档路径），**不得以「临时件」为由让草稿无处可查**。
8. **基线取证**：在本机固定一段含重复调用的审计问询夹具（或等价快照），保存其导出前后的审计库行数与内容基线，作为红/绿对照。

## 实施步骤

| 步骤 | 内容 | 产出 | 关联验收 |
|---|---|---|---|
| S0 | 取红基线：固定夹具问询、记录 `access_log` / `conversation_turns` 行数与内容基线；确认阈值初值；登记术语 | 基线证据 ＋ 术语标准更新 ＋ 阈值记录 | 前置项 |
| S1 | 读路径：实现「读journey」纯函数（按 `access_log.lucy_turn_id = conversation_turns.turn_id` 取原话与调用序列，按 `ts` 升序），**只读**；读不到 / 无权 → 失败关闭 | 读路径纯函数 ＋ 单元 | SC-01 |
| S2 | 反推纯函数：四条确定性规则（重复输入 → `max_repeated_tool_input`；单工具超阈 → `max_tool_calls`；总调用超预算 → `max_total_tool_calls`；命中工具 → `required_tool` / `forbidden_tool`），字段名与 runner 合同逐条对齐 | 反推纯函数 ＋ 单元 | SC-02、SC-03 |
| S3 | 脱敏与合成：实现「合成题干」与草稿构造（原话只留 `question_hash` 指纹与长度；`semantic_version: synthetic_v1`；`review_status: needs_review`） | 合成纯函数 ＋ 草稿构造 ＋ 单元 | SC-04 |
| S4 | 导出端点：新增**服务端只读**导出端点，返回草稿 YAML 文本与建议落位；不写审计、不写 `evals/**`、不入跑批队列；零断言时产出显式标注的零断言草稿 | 导出端点 ＋ 端点级测试 | SC-05、SC-06、SC-07、SC-08 |
| S5 | 人工确认链打通：草稿并入 `evals/**` 时保持 `review_status: needs_review`；人工确认走既有 `POST /api/eval/cases/:domain/:caseId/confirm-review`；跑批选例断言「草稿不在选例集合内」 | 既有端点回归 ＋ 选例断言 | SC-06、SC-09 |
| S6 | 复跑取证：SC-01–SC-11 全绿；跑 `lint:spec-docs` / `lint:spec` / `lint:terminology` / `lint:ia-boundary`；写收口记录 | 绿证据 ＋ 收口记录 | SC-01–SC-11 |

**步骤依赖**：S0 → S1 → S2 → S3 → S4；S5 依赖 S4 ＋ 019 的 D6 落地（开工前置第 4 条）；S6 依赖 S4 ＋ S5。S2 与 S3 的**实现**可并行，但 **S3 需先冻结 S2 的 `derived.assertions` 接口**（S3 构造草稿直接消费该结构），故 S2 的接口形状须在 S3 开工前定稿；**同一工作区不并行写同一文件**。

## 验收

### 4.1 步骤出口

| 步骤 | 出口判定 |
|---|---|
| S0 | 夹具问询固定；审计库基线（行数 + 内容）已存档；阈值初值已由 PM 确认；三个术语已登记 |
| S1 | 能读出「原话 → 调用序列 → 结果」三段且调用序列按 `ts` 升序；读不到 / 无权时返回错误且**不产出草稿内容** |
| S2 | 四条规则各自命中并产出断言；字段名与 runner 合同一致（`tool` / `input_path` / `max_per_value` / `max` / `value`）；无命中时返回空集合而非编造 |
| S3 | 草稿 YAML **不含**原话原文（用原话全文子串比对打假）；含合成题干、`semantic_version: synthetic_v1`、原话指纹与长度、`review_status: needs_review` |
| S4 | 导出端点只返回草稿文本与建议落位；不写 `access_log` / `conversation_turns`（前后快照一致）；不写 `evals/**`；零断言时产出显式标注的零断言草稿 |
| S5 | 草稿存在时跑批选例集合不含该草稿；并入 `evals/**` 的草稿保持 `needs_review`；`confirm-review` 置 `active` 生效 |
| S6 | SC-01–SC-11 全部通过；**四个** lint 门禁（`lint:spec-docs` / `lint:spec` / `lint:terminology` / `lint:ia-boundary`）exit 0 |

### 4.2 证据等级

- 本条收口证据以**本机自动化**（纯函数单元 / 端点级测试 / 审计库前后快照比对 / 跑批选例断言）＋**CI job** 两级为准。
- 真实客户环境、真实 Agent 客户端、镜像构建与客户交付**不在本条出口**；需要时按 `docs/governance/DEVELOPMENT.md` 归发布取证层处理。
- 脱敏断言不得用 mock 冒充：必须把**原话全文**放进夹具，再逐条比对草稿全文不含该子串。
- 「不写审计」断言不得用 mock 冒充：必须由审计库前后快照（行数 + 内容摘要）给出。

### 4.3 门禁

| 命令 | 期望 |
|---|---|
| `npm run lint:spec-docs` | exit 0（本 Spec 与本 Plan 需在 `docs/README.md` / `docs/plans/README.md` 登记，登记由索引维护方完成） |
| `npm run lint:spec` | exit 0 |
| `npm run lint:terminology` | exit 0（新术语已登记） |
| `npm run lint:ia-boundary` | exit 0（本条改 admin 审计侧只读端点，IA 边界须复核） |
| 受影响测试文件 | 全绿 |

## 完成定义

- [ ] Spec 的 SC-01–SC-11 全部关闭，逐条落点写进 Spec §4 与收口记录。
- [ ] 能读出「原话 → 调用序列 → 结果」三段素材，调用序列按 `lucy_turn_id` 关联、按 `ts` 升序。
- [ ] 反推产出 `max_repeated_tool_input` / `max_tool_calls` / `max_total_tool_calls` / `required_tool` / `forbidden_tool`，字段名与 runner 合同一致。
- [ ] 草稿 YAML 不含客户原话原文；含合成题干、`semantic_version: synthetic_v1`、原话指纹与长度。
- [ ] 草稿落 `inbox/eval-drafts/**`，**不在 `evals/**`**；跑批选例不含该草稿。
- [ ] 读不到素材 → 不产出草稿；读到但推不出断言 → 产出显式标注的零断言草稿。
- [ ] 导出过程零写审计（`access_log` / `conversation_turns` 前后快照一致）。
- [ ] 人工确认走既有 `confirm-review` 端点；未确认的草稿保持 `needs_review`。
- [ ] 新术语已登记进术语标准；阈值初值已由 PM 确认并记录。
- [ ] 未新增 WebUI 页面 / 视觉 / 交互改动；未做反向回放；未自动改工具面；未写审计库。
- [ ] 状态镜像改齐：Spec 头部「状态」行（本条事实源）、本 Plan 头部、`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md`；需求池 REQ-030-020 条目状态同步为「已开 Spec/Plan，待评审」。
- [ ] 收口记录写入 `docs/reviews/`，并注明「本条收口不表示可上线」。

## 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 脱敏泄漏 | 把已脱敏的原话当「安全文本」直接落 YAML，仍是客户原句 | Spec D3 强制合成题干；SC-04 用「原话全文子串」打假 |
| 把客户原句落库 | 草稿落位选错，客户原句进 Git | Spec D5 草稿区固定在 `inbox/eval-drafts/**`；SC-05 路径断言 ＋ SC-08 写审计零副作用 |
| 草稿被误当成已批准用例 | 草稿进 `evals/**` 后被跑批、被当基线 | Spec D6 明确 `needs_review` 的真实边界（**挡不住 CLI runner**）；SC-06 选例断言；确认走既有 `confirm-review` |
| 反推判据不稳 | 阈值拍脑袋导致断言忽松忽紧 | Spec D4 只用确定性信号 ＋ 可配常量；阈值在开工前置第 5 条定；SC-02 / SC-03 字段级比对 |
| 与 G2 暴露面不一致 | 草稿含路径型断言，而 019 编辑器不可编辑该类 | 开工前置第 4 条；草稿落地走 YAML 路径；019 D6 保证往返不丢 |
| 与 G1 形状未定稿 | 题干合成模板若随 `next_step` 形状变动会返工 | 开工前置第 3 条：读取与反推可先行，题干合成等 G1 稳定后定稿 |
| 审计库被误写 | 导出实现里混入写操作 | 导出为纯读路径（Spec D8 / SC-08 前后快照断言） |
| 与 `0.30` 其他批次争同一文件 | 本条改 `webui/server/admin/audit.ts` 一带与 `webui/server/eval/*` | 开工前对照批次地图确认归属；同一文件同一时刻只允许一个写入方 |

## 回滚

- S1–S4 均为服务端只读能力与纯函数，回滚＝还原对应提交；无数据迁移、无配置写入。
- 术语标准登记项在回滚时同步撤回。
- 本条不产生任何持久化业务状态；草稿文件是过程性产物，人工清理即可，不涉及数据回滚。

## 出处

- 对应 Spec：[`lucy-20261107-audit-journey-eval-case-draft-spec.md`](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md)
- 需求池：[`REQ-030-020`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)
- 分支计划：[`lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](../plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md) §3.3、§4、§5、§9
- 配对条目：[`lucy-20261107-eval-tool-assertion-authoring-spec.md`](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md)（REQ-030-019）
- 落盘清单：[`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「新增 Spec / Plan 的落盘清单」
- 关键取证位置：`webui/server/proxy/audit.ts:538-571`、`webui/server/proxy/audit.ts:633-647`、`webui/server/proxy/audit-privacy.ts:26`、`webui/server/proxy/audit-privacy.ts:50-56`、`webui/server/admin/audit.ts:3891-3893`、`webui/server/admin/audit.ts:4038-4044`、`webui/server/admin/audit.ts:4102-4108`、`webui/server/admin/audit-export-v2.ts:660`、`webui/server/eval/cases.ts:113`、`webui/server/eval/cases.ts:393-403`、`webui/server/eval/offline-batch.ts:169-172`、`webui/server/eval/runner.ts:286-307`、`webui/server/eval/runner.ts:321-322`、`scripts/eval/eval-runner.mjs:795-799`、`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:13`
