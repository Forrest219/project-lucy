# 数据问答默认主动采用业务上下文 Spec（口径前置核对＋规程引导）

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v1.1 |
| 日期 / 产品线 | 2026-11-23 / 0.30.0（`lucy-v0.30`） |
| 功能编号 | P1-77／REQ-030-098 |
| 台账号 | 无 |
| 阶段 | S3 |
| 状态 | S3｜实现进行中（B1 同源 C1–C4/C6 已入完整／基础指引；B2 判定器 27/27）。双宿主 live／PERF／MIX 缺证，按合同默认行为仍维持候选 A；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| 授权边界 | 2026-11-23 委托人批准修订两份 Spec、对应 UAT 和并行任务批次；同日明示「完成落地和测试」＝运行代码＋测程开发授权。正式 UAT／INDEX 登记仍须实测回执。 |
| 需求 / 验收 | [总账 P1-77](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [REQ-030-098](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-098数据问答默认主动采用业务上下文) · 验收 SC-01–SC-08（挂 [`UAT-SUITE-CONTEXT-CONTENT`](../qa/uat/suites/context-content/suite.md)「默认使用业务上下文」组） |
| 配对计划 | [P1-77 实施 Plan](../plans/lucy-20261123-default-business-context-adoption-plan.md) · [跨 Spec 批次顺序](../plans/lucy-20261123-interactive-read-resilience-plan.md#并行任务批次) |
| 评审记录 | [2026-11-23 R1](../reviews/2026-11-23-p177-spec-review-round1.md)：认同方向，v0.1 五项必改＋一项澄清，v0.2 已逐条处理；当日终稿确权 |

## 闭口层级

- 层级：功能合同
- 本条承诺：Lucy 数据问答运行时指导（MCP `initialize` 注入，**双载体**：动态角色化生成器 [`buildRoleAwareInstructionsUntimed`](../../webui/server/proxy/mcp-proxy.ts) 与 fallback [`webui/config/data-qa-instructions.md`](../../webui/config/data-qa-instructions.md)）在保留「纯语义最短路径」的同时：口径类自然问句先核对**已治理口径**、仅对缺失的业务定义补充检索已授权业务 Wiki；规程类自然问句引导检索已授权业务 Skill 并按规程作答；依据缺失时按子结论诚实标注不可得，不自定义口径、不编造规程；**Lucy 承诺的是其下发的指导文本，宿主是否采纳由 UAT 逐宿主判定，本合同不承诺宿主行为**。
- 本条出口：在 P1-75 单独通过 G1／G2 后，使用该候选作为 A，叠加本条成为 B。SC-01–SC-08 全部通过，含动态／基础指引注入、真实宿主质量、首条正确结果和整题速度，以及 50 路同窗下的原可用性门槛。通过前，产品默认使用 A 的指导。
- 不在本条出口：宿主模型的采纳率保证；Wiki／Skill 的通道、ACL、索引、正文读取能力（同套件真读真用＋ACL 组已证）；`wiki_search` 摘要截断语义（观察项另立）；WebUI 治理控制台；任何模型侧或宿主侧改动。
- 上线关系：本条收口不表示可上线。

## 1. 实证与候选根因（假设，待归因实验证实）

**用户反馈（2026-11-23）**：Lucy 的调用默认取语义，不取 skill 或 wiki，除非提示词要求。

**基线跑次（2026-11-23，本仓 demo，gitSha `322438a2…`，独立 SQL 基线 7／2／3、比值 1.5）**：同一候选、同一夹具，双宿主行为分裂——kscc 1.3.8 三对自然／显式对照全部复现「需提示才可用」（02 未查找、自创口径答「6 笔」，正确 2；[跑次](../qa/uat/suites/context-content/runs/2026-11-23-kscc-ctx-default.md)）；kimi 2.7.2 自然问句均主动采用（[跑次](../qa/uat/suites/context-content/runs/2026-11-23-kimi-ctx-default.md)，**诊断级证据**：轨迹为 Bash 代发 MCP 请求、部分读取经检索全文完成，见评审 R1 意见 4）。

**已证事实（指导载体结构，[`mcp-proxy.ts:2122-2233`](../../webui/server/proxy/mcp-proxy.ts)）**：

1. 正常路径由 Proxy 动态拼装「Lucy Data QA Runtime Instructions」：硬编码英文规则——含最短路径句（"For simple factual questions, use the shortest verified path…"，`:2190`）、含 Skill 建议段（"Governed Domain Skills (SOPs)…prefer fetching governed SOPs"，`:2160-2168`）、**无任何 Wiki 检索引导**；仅当 catalog／sources／skills 全空或拼装异常时才退回 fallback markdown（`:2144`、`:2230-2232`）。
2. fallback markdown（`data-qa-instructions.md`）含查询顺序第 4 条「需要业务口径时使用 wiki」，与动态路径是**两份独立文本**，单改任一份都不会同步另一份。

**候选根因（假设集，未单独归因）**：① 动态指导无 Wiki 引导且 Skill 引导为弱建议（措辞）；② 模型自由裁量差异；③ 宿主工具接入差异。**两份跑次同时改变了宿主、模型与工具接入方式，不能单独归因到指导措辞**——归因须按 SC-01 的对照实验执行。

## 2. 合同

- **C1 口径核对（两阶段，先治理后补充）**：
  - **C1a 已治理口径优先**：作答前先检查当前授权来源是否已提供适用口径——可见 source 的 measure／维度描述、生效的 Question Type Binding／口径绑定（[口径绑定合同](../specs/lucy-20261107-question-type-caliber-binding-spec.md)）。已提供 → 直接按治理口径查数并披露口径来源，**不强制 Wiki 检索**。
  - **C1b 补充检索**：授权来源未覆盖的业务定义，才 `wiki_search` → `wiki_read` 检索已授权业务 Wiki；多个口径冲突时核对适用范围／版本或向用户确认，**不得直接取首个命中**。
  - **C1c 无通道不降级**：角色无 Wiki 通道或无命中时，已治理口径下的可答问题照常交付；仅当业务定义确实缺失且为必需依赖时，该子结论按 C3 标不可得。
- **C2 规程引导**：题目确需规程时，已知授权目标可直接读取正文，否则使用实际可见的 Skill 查找工具确认目标后读取正文。按规程作答，阈值动作与分派只作为建议，全程零写操作。
- **C3 诚实兜底（按子结论依赖推进）**：任何检索／读取失败不得使整题失败。区分四态——**未命中／无权限／读取失败／口径冲突**——只将受影响的子结论标 `unavailable` 并说明影响，其余子结论照常交付；禁止自定义口径、禁止编造规程结论。
- **C4 主路径保护（逃生）**：纯语义事实题保持最短路径（catalog→source→`lucy_query`→作答），不强制上下文查找；已治理口径直通（C1a）不得被新增步骤拦截。合法用户既有主路径不得变成不可用；本条与 C1–C3 同时验收。
- **C5 双载体同步与可归因**：
  - 完整动态指引和预载基础指引从同一静态规则来源装配 C1–C4。按 [P1-75 §2.2](lucy-20261123-interactive-read-resilience-spec.md#22-mcp-指引开销与超时降级) 处理授权范围、指引决策和本地协议回退。握手内禁止为本条新增 Wiki／Skill 检索、按题正文读取或等待。
  - 用测试候选构建或隔离测试入口对照新旧文本。分别断言完整指引及全空、动态超时、容量满、构建失败和本地协议回退实际发送的基础指引。
- **C6 按题限量与限时**：同题同一业务依赖最多一次查找、一次正文读取（等价 Resource／Prompt 读取合并计数）。同题复用已取得且仍获授权的适用正文。达到上限或工具明确超时时，结束该依赖的额外调用，按 C3 交付已验证结果，其余依赖照常推进。现行代理数据工具预算继续生效。它目前纳管 Wiki 工具，Skill 的查找和读取由本条指导和真实轨迹单独取证，SC-07 对全部入口统一判定。代理全局计数和续查语义沿用现行行为。

## 3. 验收

| 编号 | 验收项 | 证据形态 |
|---|---|---|
| SC-01 | **归因对照实验**（开发后第一件事）：同一宿主、同一模型、同一原生 MCP 接入，仅切换指导版本做前后对照；分别断言**动态指导**与 **fallback 指导**两种 initialize 实际响应内容；输出采纳率前后对照（自然问句口径采用率／规程采用率） | 实验跑次＋两份注入响应快照 |
| SC-02 | 口径核对两阶段（保守宿主）：`UAT-CTX-DEFAULT-02` 自然问句 PASS——授权来源未覆盖「有效订单」定义时补充检索并读 Wiki 正文、答案＝2 笔并披露口径来源；**新增纯 MCP 用例**：问句含口径词、角色无 Wiki 通道、但语义度量描述／口径绑定已定义 → 仍按已治理口径答数、不降级为「口径不可得」、无强制查找 | 测试台跑次（请求／响应／答复关联判定） |
| SC-03 | 规程引导（保守宿主）：`UAT-CTX-DEFAULT-03` 自然问句 PASS——检索并读 Skill 正文、答 3 笔；**验收限于答复给出「转履约专员复核」的分派建议，且断言全程无写操作发生**（该身份本无写工具／审计无写调用） | 同上 |
| SC-04 | 组合场景（保守宿主）：`UAT-CTX-DEFAULT-04` 自然问句 PASS——Wiki＋Skill 依赖按子结论推进，比值 1.5、列入优先复核 | 同上 |
| SC-05 | 诚实兜底三子场景（本版定义）：① Wiki 缺失／不可读但 Skill 可读 → 规程结论照答，含 Wiki 口径的子结论标不可得；② Skill 缺失 → 数值部分照答、规程子结论标不可得；③ 组合题部分可答 → 受影响子结论标不可得、其余交付。四态（未命中／无权限／读取失败／冲突）在答复中可区分 | 测试台新增跑次（夹具扩展，用例编号在实现 Plan 分配） |
| SC-06 | 主路径保护：`UAT-CTX-DEFAULT-01` 双宿主修复后复跑仍 PASS——零上下文查找、答 7 笔、最短路径；且 C1a 直通用例（SC-02 新增纯 MCP 用例）不增加强制前置 | 测试台跑次 |
| SC-07 | 硬性能门槛。主动宿主自然问句保持正确。普通事实与已治理口径题零新增上下文调用，首条正确查询结果与最终正确答复按 [PERF](../qa/uat/suites/context-content/cases.md#uat-ctx-default-perf) 判定无回退。依赖题以 A 显式提示且答对的路径预冻结时限，首尝试超时计失败，重跑单列。按 [MIX](../qa/uat/suites/context-content/cases.md#uat-ctx-default-mix) 在 G2 叠加实际上下文调用，名册首响应、合法 MCP、探针和恢复仍须通过原门槛。 | 双宿主 A/B 逐题阶段耗时与工具轨迹、50 路同窗跑次、首失败和复算判定 |
| SC-08 | 同源指引与门禁。对完整指引和 C5 各个基础指引触发分支，断言实际 initialize 响应均含 C1–C4／C6，且未新增握手内 Wiki／Skill 正文读取；`lint:spec-docs`／`lint:terminology` 通过。 | 单测＋lint 跑次＋各分支实际注入快照 |

**改前基线（反例与诊断证据，已落盘）**：v0.1 判定下 SC-02–SC-04 在 kscc 为 FAIL（2026-11-23 kscc 跑次）；SC-06／SC-07 在 kimi 为 PASS（同日 kimi 跑次，**诊断级**：Bash 代发 MCP、正文读取经检索全文完成者不以「正文读取」计——正式复跑须按实际工具请求关联判定）。当次宿主替换（Claude／Cursor 未装，经委托人指示以 kscc＋kimi 代）与未达标的 Wiki／Skill 规模水位仅作诊断保留。

**取证通则（全部 SC 适用）**：判定以**实际工具请求＋对应响应＋最终答复**三者关联为准（`tool_use_id`／审计关联键对齐）；检索结果含正文全文时，标记命中不得单独充当「已读正文」证据；宿主与夹具前置须遵守 [`cases.md`](../qa/uat/suites/context-content/cases.md) 取证要求。

## 4. 核心流程（伪代码）

```text
answer(userQuestion):
  dependencies = governedCaliberAndRequiredProcedures(userQuestion)
  for each ready sub in dependency order:
    for each required missing definition or procedure of sub:
      reuse applicable authorized evidence, or check channel and find the target once
      resolve scope/version; if ambiguity remains, record conflict and ask for confirmation
      if a unique authorized target is identified, read its body once
      record the verified evidence or the reason this dependency is unavailable
      if a procedure reveals a missing definition, add that dependency before its conclusion
    query every part supported by verified dependencies
  return compose(deliver answered subs,
                 mark each unavailable sub with reason ∈ {未命中, 无权限, 读取失败, 口径冲突} and impact,
                 disclose(sources, caliber origin, procedure origin, freshness))
  # 不变量：任何子结论失败不得阻断其它子结论（C3）；plain_fact 不进入检索分支（C4）；
  # 全程零写操作——规程只产出分派建议（SC-03）；禁止 inventCaliber()/inventProcedure()。
```

伪代码描述宿主预期路径。保持现行代理预算与权限模型，按配对 Plan 的运行时和测程任务分别验证。

## 5. 边界（不做什么）

1. 不改 Wiki／Skill 的通道、对象 ACL、索引与正文读取语义（同套件真读真用＋ACL 组已收口）。
2. **不执行 Skill 内容中的任何动作**：规程只产出答复内的分派建议，全程零写操作（SC-03 断言）。
3. 不强制无差别查找：普通事实题与已治理口径直通（C1a）保持最短路径。
4. 不改 `wiki_search` 摘要截断语义（2026-11-23 跑次观察到摘要含正文全文；独立观察项，另立评估）。
5. 不回退主动宿主的既有主动行为；**合同不承诺宿主采纳，只承诺 Lucy 下发的指导文本**（采纳由 SC-07 逐宿主判定）。
6. 不改 WebUI 治理控制台、授权面与部署形态；不新增配置项。

## 6. 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 保守宿主遇口径词不查资料、自编口径（2026-11-23 kscc 跑次 02 答「6 笔」，正确 2）；规程题无规程动作 | 缺定义或规程时按需核对；查不到按子结论声明不可得；普通问询和已治理口径不增加上下文调用，速度按 SC-07 对照 | 质量 ↑、速度 ＝，待验 | SC-02–SC-07；[`UAT-CTX-DEFAULT-*`](../qa/uat/suites/context-content/cases.md#默认使用业务上下文) | — |
| P2 治理方 | 口径／Skill 编写与授权路径 | 继续使用当前治理控制台与口径绑定合同 | ＝ | C5 限于指引装配；[口径绑定合同](lucy-20261107-question-type-caliber-binding-spec.md) | — |
| P3 运维方 | 部署／升级面无变化 | 不变（指导随镜像走，无新配置项、无新服务） | ＝ | 同左；health／version 面未触碰 | — |
| P4 管理层 | 口径幻觉不可预期、随宿主漂移 | Lucy 下发的指导版本化、可断言（SC-08）；宿主采纳按 UAT 逐宿主披露（SC-07），不再以单次跑次叙事 | ↑ | SC-01 归因对照＋SC-07 逐宿主判定＋注入快照 | — |

无 `↓` 判定，无需补偿路径；C4 保证 P1 主路径不因本合同收窄（「约束生效」与「合法路径仍可用」同时验收，SC-02 新增用例＋SC-06）。

## 7. Terminology Compliance

This feature follows [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md).

New terms: 无。「口径前置核对／规程引导／诚实兜底」为运行时指导内部步骤名，不进入 WebUI、API 用户可见错误、Toast 或测试断言的产品文案；如后续进入产品文案，须先按术语标准登记。
