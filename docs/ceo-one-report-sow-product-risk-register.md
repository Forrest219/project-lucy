# CEO 一眼报 SOW 产品功能风险 Register

| 元数据 | 内容 |
|---|---|
| 文档名称 | CEO 一眼报 SOW 产品功能风险 Register |
| 文档类型 | Product Risk / SOW Gap Analysis |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-06 |
| 适用范围 | 对照 CEO 一眼报 Lucy/KTX 智能化升级 SOW，识别 Lucy 产品功能性风险 |
| 关联文档 | `docs/test-layers-and-release-gates.md`, `docs/lucy-platform-goal-checklist.md`, `docs/lucy-r1-controlled-data-service-plan.md` |

## 1. 背景

CEO 一眼报 SOW 要求项目最终形成可被 Agent 安全访问、可追溯、可评测、可验收的 Lucy/KTX 受控数据服务。当前 Lucy 已具备受控 MCP Proxy、角色 ACL、semantic query、wiki/context、审计、真实 Hermes/moz E2E harness 等底座能力，并已通过本机 `npm run e2e:agent:local-hermes` 验证真实 Agent 链路。

但是，SOW 的验收不只要求“Agent 能连上数据并回答少量问题”，还要求 Eval/UAT 结果可信、问题可回放、失败可归因、口径约束可复验。为避免把数据主题实施工作和产品功能风险混在一起，本文只记录 Lucy 产品能力层面的风险。

## 2. 本文排除范围

以下内容不作为本文的产品功能风险项管理：

- CEO 一眼报数据主题本身的实施内容，例如真实 DDL、样例数据、服务层表/视图、CEO 快照 benchmark、指标口径签字值。
- rpt/finreport、BI 导出、报表 SQL、截图或前端导出值的解析与盘点。
- 业务 owner 口径仲裁、审批、UAT 签字等项目管理或业务流程事项。
- 已明确为产品边界的能力：行级/列级权限、动态脱敏、SSO/IAM、跨源联邦查询、Kubernetes/Helm、多租户 SaaS。

这些事项仍可能影响 SOW 交付，但应分别进入数据实施计划、客户配合清单、变更管理或产品边界声明，不应被误判为当前 Lucy 产品缺陷。

## 3. 结论

当前真正需要作为 SOW 产品风险管理的是 7 项：

1. 每题唯一 trace。
2. 自动评分能力。
3. 多轮一致性测试。
4. Wiki/Context 强制使用。
5. Skill/Reviewer 运行时约束。
6. 完整 Eval 平台。
7. 告警 / SLO / 日志检索。

其中 P0 风险直接影响 SOW 验收可信度；P1 风险影响规模化交付和回归效率；P2 风险影响上线后的运维成熟度。

## 4. 风险清单

| 风险项 | 优先级 | 当前状态 | SOW 验收风险 | 建议验收口径 |
|---|---:|---|---|---|
| 每题唯一 trace | P0 | 已有 audit、turn、query hash、`_meta.lucy` provenance 基础；E2E/Eval 尚未强制每个 benchmark case 唯一 trace | 没有唯一 trace 时，无法证明每道题都真实经过 Lucy 受控链路，也无法稳定复盘失败原因 | 每个 Eval case 必须输出唯一 `traceId` / `turnId`，并可回放到 profile、tool calls、source/table、semantic query、结果摘要和 agent final answer |
| 自动评分能力 | P0 | Runner 支持 `contains` / `forbids` 等基础文本断言，部分数值容差思路已有 | SOW 的 95% 总体准确率、核心数值 100%、安全拒答 100% 会退化为人工判分，成本高且不可重复 | 支持数值容差、排序集合、占比/分布、多轮继承、解释题 rubrics、拒答 reason 的结构化评分 |
| 多轮一致性测试 | P0 | Superstore/KX 有部分多轮案例资产；P1 Agent E2E 仍以单轮为主 | 追问时日期、过滤条件、口径或 measure 漂移会直接破坏业务可信度 | E2E runner 支持 multi-turn case schema，记录每轮 prompt/tool/answer，并断言上下文继承不漂移 |
| Wiki/Context 强制使用 | P0 | 已验证 `wiki_search` / `wiki_read` 可见性、命中和 ACL；未强制证明 agent 每题实际消费对应 wiki/context | Agent 可能绕过业务口径说明，仅凭模型常识或 schema 猜测，导致反模式复发 | 对需要业务口径的问题，Eval evidence 必须包含 wiki/context 命中 key、标题、片段或 read 记录；未命中则该题失败或 blocked |
| Skill/Reviewer 运行时约束 | P1 | Skill 文件治理 gate 已有；instructions 注入可用；Reviewer 规则主要停留在文档/提示层 | 反模式、安全拒答和口径约束如果只靠提示，遇到模型漂移时缺少强制兜底 | 将关键 reviewer rule 编译为可执行 gate：例如禁止重复分母求和、禁止 avg(ratio)、禁止越权泄露不可见资产 |
| 完整 Eval 平台 | P1 | 已有 eval runner、`business-eval-full`、E2E JSON/HTML 报告雏形；仍偏脚本化 | SOW 要用例、benchmark、执行结果、失败清单、回归记录和交付报告；当前还不够产品化 | 形成统一 Eval run model：case registry、run history、artifact bundle、失败分类、复测状态、HTML/JSON 报告、release gate 集成 |
| 告警 / SLO / 日志检索 | P2 | `/api/observability` 最小快照已实现，可看流量、错误、拒绝、延迟、eval/latest 等 | 上线后慢查询、拒绝异常、失败率上升时只能有限排障，不能满足成熟运维预期 | 增加 SLO 阈值、p95/错误率/拒绝率告警、按 trace/source/role 检索日志、导出和留存策略 |

## 5. 风险分层

### P0：影响 SOW 验收可信度

P0 风险决定 Eval 结果是否可信。即使真实 Hermes E2E 能跑通，如果缺少逐题 trace、自动评分、多轮一致性和 wiki/context 强制使用，SOW 验收仍然容易变成“少量样例演示通过”，而不是可复验的质量闭环。

P0 建议进入下一轮开发硬范围：

- 每题唯一 trace。
- 自动评分能力。
- 多轮一致性测试。
- Wiki/Context 强制使用。

### P1：影响规模化交付效率

P1 风险不一定阻断首批小规模验收，但会影响 60-100 题以上题集的维护、复测和问题闭环。

P1 建议作为 SOW 首批验收后的紧随开发项：

- Skill/Reviewer 运行时约束。
- 完整 Eval 平台。

### P2：影响上线后运维成熟度

P2 风险主要影响持续运营和生产排障。首批交付可以通过 runbook 和人工排障兜底，但若客户把 Lucy 作为长期生产服务，应进入后续版本规划。

P2 建议纳入运维增强计划：

- 告警 / SLO / 日志检索。

## 6. 建议行动

1. 新增 `e2e:agent:<domain>` 形态的主题级 E2E gate，用于 CEO 一眼报等真实业务主题；通用 `e2e:agent` 继续作为平台级能力 gate。
2. 在 Eval case schema 中增加 `trace_required`、`context_required`、`turns`、`scoring`、`risk_tags` 等字段。
3. 在 E2E runner 中强制输出 per-case artifact：trace id、wiki/context hits、semantic query args、Lucy `_meta.lucy`、agent final answer、score result。
4. 将 P0 四项纳入下一轮上线达标开发计划；P1/P2 进入产品 roadmap，但不要把它们误写成当前已支持。

## 7. 对 SOW 表述的建议

在 SOW 或项目风险说明中建议保留如下口径：

> Lucy 当前已具备受控 MCP、ACL、审计、语义查询、Wiki 和真实 Hermes E2E 底座；CEO 一眼报 SOW 的可信验收还需要补齐逐题 trace、自动评分、多轮一致性、Wiki/Context 强制使用等 Eval 产品能力。数据资产准备、业务口径确认和 benchmark 值签字属于项目实施输入，不属于 Lucy 产品功能缺陷。

