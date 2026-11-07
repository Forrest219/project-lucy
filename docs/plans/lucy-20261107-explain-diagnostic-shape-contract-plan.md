# Lucy `lucy_explain_query` 本地诊断形状合同 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立；待 PM 指派后再登记 |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。S0–S4 全部未开工 |
| 授权边界 | **不授权改代码。** 本 Plan 只定义步骤、验收与完成定义；开工须先取得本条的开工授权（PM 评审 Spec 与本 Plan 后明示） |
| 验收 | S0–S4 各自出口见 §4；本条总出口＝Spec 的 SC-01–SC-08 全部关闭 |
| 对应 Spec | [lucy-20261107-explain-diagnostic-shape-contract-spec.md](../specs/lucy-20261107-explain-diagnostic-shape-contract-spec.md) |
| 需求池条目 | REQ-030-017 |

---

## 目标

把 `lucy_explain_query` 的本地诊断响应从「三处编号各说各话」收敛成「一份权威编号、一处实现、一套断言」：

1. **编号归一**：以 ADR §2.1.1 的 E1–E5 为唯一权威，实现注释、单元测试、e2e harness 三处对齐。
2. **形状补齐**：实现产出 ADR E3 要求的「capability 裁决 ＋ FinalRows 判定 ＋ ForcedPredicateAST 摘要」三件齐备；不受保护的 source 也给出裁决信息。
3. **删掉假断言**：harness 里对 ADR 未定义字段 `summary` 的断言删除，不以新增字段的方式把断言改绿。

不做：不改 ADR 合同字面量、不新增 `summary`、不引入数据返回路径、不做浏览器呈现。

## 开工前置

开工前必须全部满足，缺一项即停：

1. **开工授权**：PM 评审通过本 Spec 与本 Plan 并明示授权实现。
2. **ADR 口径确认**：评审时逐条对照 `docs/access-control/adr-upstream-forced-predicate.md` **§2.1.1（lines 78–82）** 的 E1–E5 原文，确认本 Spec §3.3 的对照表与 ADR 一致；不一致以 ADR 为准并回改本 Spec。
3. **基线取证**：保存改动前 BY-18 的断言失败记录（现状：`summary` 断言在 `mcp_result_ok` 分支必失败）。
4. **分支边界确认**：确认 BY-18 存在 deny 分支（上游未证明时 explain 被拦）——该分支不要求 E 字段，不得为满足 E 断言而改动 deny 分支语义。
5. **文件分工确认**：本条改 `webui/server/proxy/row-policy.ts`；与 REQ-030-016 批次（[行权限编译门禁 Spec](../specs/lucy-20261107-row-policy-compile-gate-deny-code-spec.md)）同文件，**两批次必须串行**，不得并行写同一文件。
6. **本条实际触及的全部文件**（开工前须与 REQ-030-016 批次逐一对齐，四个文件均可能同改）：`webui/server/proxy/row-policy.ts`（实现）＋ `scripts/e2e/security/row-policy-cases.mjs`（e2e harness）＋ `webui/server/__tests__/row-policy-ac-p1.test.ts`（单元）＋ `webui/server/__tests__/mcp-proxy-row-policy-by01-by18.test.ts`（单元）。

## 实施步骤

| 步骤 | 内容 | 产出 | 关联验收 |
|---|---|---|---|
| S0 | 取红基线：复跑 BY-18，记录现状断言失败点；逐条确认 ADR 原文与本 Spec 对照表一致 | 红基线证据 ＋ 对照确认 | 前置项 |
| S1 | 实现侧补齐 ADR E3：新增 `capabilityVerdict`（覆盖全部被请求 source，含未命中 capability 的 `UNKNOWN` 形态）；**不新增 `summary`**；`finalRowsNonTrue` 口径与 `capabilityVerdict` 保持一致 | `row-policy.ts` 改动 ＋ 单元 | SC-01、SC-02、SC-03、SC-04 |
| S2 | 注释归一：`ExplainForcedPredicateDiagnostics` 接口与返回体的 E 注释逐条对齐 ADR 编号（E1…E5） | 注释改写 | SC-07 |
| S3 | harness 归一：BY-18 的断言按 ADR 编号重排；删除 `summary` 断言；补 E4 执行路径断言与 E3 三件齐备断言 | `row-policy-cases.mjs` 改动 | SC-05、SC-06 |
| S4 | 单测归一：`row-policy-ac-p1.test.ts` 与 `mcp-proxy-row-policy-by01-by18.test.ts` 的断言与注释按同一编号表改写（含混编注释）；复跑取证并写收口记录 | 单测改写 ＋ 绿证据 ＋ 收口记录 | SC-07、SC-08 |

**步骤依赖**：S0 → S1 → S2；S3 依赖 S1（字段定了才能写断言）；S4 依赖 S2＋S3。全部串行，无并行分支。

## 验收

### 4.1 步骤出口

| 步骤 | 出口判定 |
|---|---|
| S0 | 红基线可复现；ADR 对照确认无差异 |
| S1 | SC-01、SC-02、SC-03、SC-04 通过；响应体无行数据、无 `summary` 字段 |
| S2 | 实现注释与 ADR 编号逐条一致 |
| S3 | SC-05、SC-06 通过；BY-18 在 allow 分支上逐条通过 |
| S4 | SC-07、SC-08 通过；受影响的单元与 harness 全绿；收口记录已写 |

### 4.2 证据等级

- 本条收口证据以**本机自动化**（单元／组件／真实进程内 Proxy 自动化）＋**CI job** 两级为准。
- 真实 Agent 客户端、客户环境、镜像构建与客户交付**不在本条出口**。
- 「零上游转发」必须由 loopback observer 的执行计数给出，不得用 mock 代替。

### 4.3 门禁

| 命令 | 期望 |
|---|---|
| `npm run lint:spec-docs` | exit 0 |
| `npm run lint:spec` | exit 0 |
| `npm run lint:terminology` | exit 0 |
| 受影响测试文件 | 全绿 |

## 完成定义

- [ ] Spec 的 SC-01–SC-08 全部关闭，逐条落点写进 Spec §4 与收口记录。
- [ ] 实现、单元、harness 三处的 E 编号与 ADR §2.1.1（lines 78–82）逐条一致（可逐条比对）。
- [ ] `capabilityVerdict` 覆盖全部被请求 source；不受保护 source 不再出现「无任何裁决信息」的诊断体。
- [ ] 响应体不含行数据、样例行、聚合数值；`lucy_explain_query` 仍零上游转发。
- [ ] 响应体**不含** `summary` 字段；harness 中对 ADR 未定义字段的断言已删除。
- [ ] ADR `docs/access-control/adr-upstream-forced-predicate.md` 未被改动。
- [ ] 状态镜像改齐：Spec 头部「状态」行（本条事实源）、本 Plan 头部、`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md` §9；需求池条目状态同步为「已开 Spec/Plan，待评审」。
- [ ] 收口记录写入 `docs/reviews/`，并注明「本条收口不表示可上线」。

## 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 补 `summary` 变成「让断言变绿」 | 这是需求池记录的现象解法，会让编号继续分叉 | Spec §1.4 已给出三处口径对照；评审以 ADR 为准，D3 明令不新增 |
| 编号改写漏改一处 | 实现注释、单测注释、harness 三处都带编号 | SC-07 要求逐条一致，注释一并改 |
| 新字段泄露数据 | `capabilityVerdict` 带行级内容即破 E2 | SC-04 字段白名单扫描；字段定义只含裁决元数据 |
| deny 分支被误改 | BY-18 有 deny 与 allow 两支，E 断言只属 allow 支 | 开工前置第 4 项确认分支边界；deny 分支语义不动 |
| 与 REQ-030-016 批次争同一文件 | 两条同改 `row-policy.ts`，且**同改 harness 与同一份单测**：`row-policy.ts`＋`scripts/e2e/security/row-policy-cases.mjs`＋`webui/server/__tests__/row-policy-ac-p1.test.ts`＋`webui/server/__tests__/mcp-proxy-row-policy-by01-by18.test.ts` 四个文件全部重叠 | 开工前置第 5 项：两批次串行，同文件同刻只允许一个写入方；开工前置第 6 项给出本条触及文件的完整清单 |

## 回滚

- 全部改动集中在诊断体构造与断言，无数据迁移、无配置写入、无持久化状态。
- 回滚＝还原对应提交；harness 与单测的断言改写与实现改动须同批回滚，避免留下「实现有字段、断言不查」的半状态。
