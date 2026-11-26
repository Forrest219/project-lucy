# Lucy 常青需求池（Evergreen Product Backlog）

| 元数据 | 内容 |
|---|---|
| 文档类型 | **全仓唯一需求台 SOT（常青需求池）**。登记所有在途与待选需求／概念实体、可变优先级、开发漏斗阶段同码镜像与目标发版列车。**不是**功能 Spec；**单条入池不构成开发授权** |
| 版本 / 日期 | v1.0 / 2026-11-26 |
| 状态 | S3｜生效跟进（2026-11-26 依[常青池与发版列车解耦治理 Plan](../plans/lucy-20261125-evergreen-backlog-and-release-train-plan.md) v1.0 自 0.30 总账无损迁移建成）。**≠ 功能合同收口；≠ UAT PASS；≠ 可上线** |
| 事实源分工 | **需求台 SOT**＝本文件＋[归档池](archive.md)；**开发漏斗唯一事实源**＝各 Spec 头部「阶段」格（本表「漏斗阶段」列仅为同码镜像，由 `lint:inventory-stage` 强校验）；**测试台 SOT**＝[`docs/qa/uat/INDEX.md`](../qa/uat/INDEX.md)；**发版范围**＝[`docs/releases/v0.35.0-scope.md`](../releases/v0.35.0-scope.md) |
| 授权边界 | **入池 ≠ 立项 ≠ 终稿确权 ≠ 开发授权**。新需求稳定 ID 自 `REQ-0113` 起连续递增（永不嵌入版本号或优先级）；历史 `REQ-030-001`–`112`（`047` 历史跳号不回填；`REQ-030-013／016` 合并承载）与 `P0-*`／`P1-*`／`P2-*` 保留为不可变别名；`REQ-TE-001`–`008` 与 `REQ-CAL-001` 保留原未来池授权边界（概念未升 Spec 前禁改运行代码）。池级变更留痕由 git 提交历史＋Spec 头部 Changelog 承担，本表禁堆砌长篇状态散文；「暂缓开发」条目保留在活跃表，阶段镜像维持现行 S 码、目标版本置 `—`，以标题后缀标注，重启须重新走终稿确权与开发授权，不映射 `X_DEF` 归档 |

## 收口分列

| 桶 | 阶段码 | 含义 | 统计口径 |
|---|---|---|---|
| **功能合同收口** | `S5` | 功能合同 Spec 已收口 | 统计下表「漏斗阶段」为 `S5`／`S5｜` 的行 |
| **发布取证收口** | `X_REL` | 发布取证 Spec 已收口 | 统计下表「漏斗阶段」为 `X_REL`／`X_REL｜` 的行 |
| **退出归档** | `X_DEF`／`X_SUP` | 延期／结案不做／被取代 | 沉降在 [归档池](archive.md)，不计入活跃完成率分母 |

**禁止**把 `S5` 桶与 `X_REL` 桶相加冒充同一「总完成率」或「漏斗完成度」。在途发布取证（`S1`–`S4`）留在主漏斗，不进 `X_REL` 桶；规则正文见 [`DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「不是两套漏斗」。

## 活跃需求与概念表

| 稳定 ID | 历史别名 | 类型 | 优先级 | 标题 | 漏斗阶段 | 目标版本 | 关联文档 |
|---|---|---|---|---|---|---|---|
| REQ-0116 | — | 需求 | P1 | 自动 Join Graph 推断与辅助标注 | S1｜ | v0.35.0 | [Spec](../specs/lucy-20261126-auto-join-graph-inference-spec.md) · [Plan](../plans/lucy-20261126-auto-join-graph-inference-plan.md) |
| REQ-0115 | — | 需求 | P0 | 渐进开放 KTX 已内置分析型连接器（ClickHouse / DuckDB） | S1｜ | v0.35.0 | [Spec](../specs/lucy-20261126-ktx-analytical-connectors-rollout-spec.md) · [Plan](../plans/lucy-20261126-ktx-analytical-connectors-rollout-plan.md) |
| REQ-0114 | — | 需求 | P1 | BI / 建模层与外部文档只读导入器（风险较大，暂缓开发） | S1｜ | — | [Spec](../specs/lucy-20261126-bi-doc-readonly-importer-spec.md) · [Plan](../plans/lucy-20261126-bi-doc-readonly-importer-plan.md) |
| REQ-0113 | — | 需求 | P0 | 基于审计与 Schema 的候选口径自动草稿化（风险较大，暂缓开发） | S1｜ | — | [Spec](../specs/lucy-20261126-audit-schema-auto-caliber-draft-spec.md) · [Plan](../plans/lucy-20261126-audit-schema-auto-caliber-draft-plan.md) |
| REQ-030-112 | P1-91 | 需求 | P1 | 语义层 overlay 发布通道冲突护栏与生命周期修复 | S4｜ | v0.35.0 | [Spec](../specs/lucy-20261125-overlay-publish-guard-spec.md) · [Plan](../plans/lucy-20261125-overlay-publish-guard-plan.md) |
| REQ-030-111 | P1-90 | 需求 | P1 | Schema Manifest 按表追加与路径归一化 | S4｜ | v0.35.0 | [Spec](../specs/lucy-20261125-schema-manifest-table-append-spec.md) · [Plan](../plans/lucy-20261125-schema-manifest-table-append-plan.md) |
| REQ-030-110 | P1-89 | 需求 | P1 | 语义层 source 写接口诚实响应与描述写入陷阱修复 | S4｜ | v0.35.0 | [Spec](../specs/lucy-20261125-source-write-api-honesty-spec.md) · [Plan](../plans/lucy-20261125-source-write-api-honesty-plan.md) |
| REQ-030-109 | P1-88 | 需求 | P1 | 敏感元数据工具可见性对齐与拒绝修复引导 | S4｜ | v0.35.0 | [Spec](../specs/lucy-20261125-mcp-client-compat-and-sensitive-meta-visibility-spec.md) · [Plan](../plans/lucy-20261125-mcp-client-compat-and-sensitive-meta-visibility-plan.md) |
| REQ-030-107 | P1-86 | 需求 | P1 | 镜像候选门禁：以镜像摘要为单位的 L0／L1／L2 能力门禁 | S1｜ | v0.35.0 | [审阅](../reviews/2026-11-24-image-candidate-gate-review.md) |
| REQ-030-108 | P1-87 | 需求 | P1 | 门禁速赢四项：Q1 CI 触发分支改 `lucy-v0.30`＋定时；Q2 正式性能基线迁出 `inb… | S3｜ | v0.35.0 | [审阅 §5.1](../reviews/2026-11-24-image-candidate-gate-review.md#51-速赢四项总账-p1-87每项可单独授权) |
| REQ-030-105 | P1-84 | 需求 | P1 | 公共首页与静态公开接口隔离（同进程；混压下入口仍可用） | S4｜ | v0.35.0 | [Spec](../specs/lucy-20261124-public-entry-static-isolation-spec.md) · [Plan](../plans/lucy-20261124-public-entry-static-isolation-plan.md) |
| REQ-030-104 | P1-83 | 需求 | P0 | 客户 K8s 下的假活自愈 | S1｜ | v0.35.0 | [Spec](../specs/lucy-20261124-k8s-self-healing-spec.md) · [Plan](../plans/lucy-20261124-k8s-self-healing-plan.md) |
| REQ-030-106 | P1-85 | 需求 | P1 | Chart 设 `terminationGracePeriodSeconds`＝60 | S1｜ | v0.35.0 | [Spec](../specs/lucy-20261124-k8s-stop-grace-spec.md) · [Plan](../plans/lucy-20261124-k8s-stop-grace-plan.md) |
| REQ-030-103 | P1-82 | 需求 | P1 | MCP 数据面执行舱壁与跨 Agent 故障隔离 | S4｜ | v0.35.0 | [Spec](../specs/lucy-20261124-mcp-data-plane-isolation-ha-spec.md) · [Plan](../plans/lucy-20261124-mcp-data-plane-isolation-ha-plan.md) |
| REQ-030-102 | P1-81 | 需求 | P1 | 假活状态自愈与探针一致性（探针全绿、业务持续失败且不自愈） | S4｜ | v0.35.0 | [Spec](../specs/lucy-20261124-stuck-state-self-healing-spec.md) · [Plan](../plans/lucy-20261124-stuck-state-self-healing-plan.md) |
| REQ-030-101 | P1-80 | 需求 | P1 | 启用表范围表清单三态诚实展示（pending／error ≠ 缺 Manifest） | S5｜ | — | [Spec](../specs/lucy-20261123-enabled-tables-load-state-honesty-spec.md) · [Plan](../plans/lucy-20261123-enabled-tables-load-state-honesty-plan.md) |
| REQ-030-100 | P1-79 | 需求 | P1 | 长追问题组（性能专用，≥20 轮单进程长链） | S3｜ | v0.35.0 | [Spec](../specs/lucy-20261123-long-followup-question-pack-spec.md) · [Plan](../plans/lucy-20261123-long-followup-question-pack-plan.md) |
| REQ-030-099 | P1-78 | 需求 | P0 | MCP 问询端到端性能基准与持续门禁（仅测量与判定） | S3｜ | v0.35.0 | [Spec](../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md) · [Plan](../plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md) |
| REQ-030-098 | P1-77 | 需求 | P1 | 数据问答默认主动采用业务上下文（口径前置核对＋规程引导） | S3｜ | v0.35.0 | [Spec](../specs/lucy-20261123-default-business-context-adoption-spec.md) · [Plan](../plans/lucy-20261123-default-business-context-adoption-plan.md) |
| REQ-030-097 | P1-76 | 需求 | P1 | YAML 产物禁 alias 治理（统一写出口＋静态门禁） | S4｜ | v0.35.0 | [Spec](../specs/lucy-20261123-yaml-alias-free-artifacts-spec.md) · [Plan](../plans/lucy-20261123-yaml-alias-free-artifacts-plan.md) |
| REQ-030-096 | P1-75 | 需求 | P1 | MCP 握手、Agent 名册读取长尾治理，及 WebUI 全部页面（含二级 tab）无 503 | S3｜ | v0.35.0 | [Spec](../specs/lucy-20261123-interactive-read-resilience-spec.md) · [Plan](../plans/lucy-20261123-interactive-read-resilience-plan.md) |
| REQ-030-095 | P1-74 | 需求 | P1 | 问询预算主路径逃生（触顶后可达 fallback） | S5｜ | — | [Spec](../specs/lucy-20261122-question-budget-mainpath-escape-spec.md) · [Plan](../plans/lucy-20261122-question-budget-mainpath-escape-plan.md) |
| REQ-030-094 | P1-73 | 需求 | P1 | Spec 开发台状态治理（漏斗阶段＋状态词中文） | S5｜ | — | [Spec](../specs/lucy-20261122-spec-status-funnel-gate-spec.md) · [Plan](../plans/lucy-20261122-spec-status-funnel-gate-plan.md) |
| REQ-030-093 | P1-72 | 需求 | P1 | 行权限自动强制执行，取消运维人工证明开关 | S5｜ | — | [Spec](../specs/lucy-20261120-row-policy-automatic-enforcement-spec.md) · [Plan](../plans/lucy-20261120-row-policy-automatic-enforcement-plan.md) |
| REQ-030-090 | P1-69 | 需求 | P1 | MCP执行层热重载在途保护与统一截止 | S4｜ | — | [Spec](../specs/lucy-20261120-runtime-reload-drain-spec.md) · [Plan](../plans/lucy-20261120-runtime-reload-drain-plan.md) |
| REQ-030-091 | P1-70 | 需求 | P1 | 正常语义写入期间MCP读取有界等待 | S5｜ | — | [Spec](../specs/lucy-20261120-semantic-read-write-settle-spec.md) · [Plan](../plans/lucy-20261120-semantic-read-write-settle-plan.md) |
| REQ-030-089 | P1-68 | 需求 | P1 | 运维步骤账（Lucy 运维与 IT 运维） | S5｜ | — | [Spec](../specs/lucy-20261120-ops-step-journal-spec.md) · [Plan](../plans/lucy-20261120-ops-step-journal-plan.md) |
| REQ-030-087 | P1-66 | 需求 | P1 | Agent 名册摘要投影与单对象详情按需读取 | S5｜ | — | [Spec](../specs/lucy-20261120-agent-roster-summary-projection-spec.md) · [Plan](../plans/lucy-20261120-agent-roster-summary-projection-plan.md) |
| REQ-030-088 | P1-67 | 需求 | P1 | 用户旅程性能门禁（API／WebUI 交互；MCP 已移交 P1-78） | S1｜ | — | [Spec](../specs/lucy-20261120-user-journey-performance-gate-spec.md) · [Plan](../plans/lucy-20261120-user-journey-performance-gate-plan.md) |
| REQ-030-085 | P1-64 | 需求 | P1 | 同连接跨 Schema 短名冲突与保存运行时确认修复 | S5｜ | — | [Spec](../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md) · [Plan](../plans/lucy-20261120-source-shortname-uniqueness-runtime-ack-plan.md) |
| REQ-030-086 | P1-65 | 需求 | P1 | Wiki 覆盖上传采用 YAML 授权声明（差异／损坏须显式选择） | S5｜ | — | [Spec](../specs/lucy-20261120-wiki-upload-acl-adoption-spec.md) · [Plan](../plans/lucy-20261120-wiki-upload-acl-adoption-plan.md) |
| REQ-030-082 | P1-61 | 需求 | P1 | 存活／就绪探针纯内存响应与诊断隔离 | S4｜ | — | [Spec](../specs/lucy-20261119-memory-probe-diagnostics-isolation-spec.md) · [Plan](../plans/lucy-20261119-memory-probe-diagnostics-isolation-plan.md) |
| REQ-030-083 | P1-62 | 需求 | P1 | 重任务跨模块容量控制与许可生命周期 | S4｜ | — | [Spec](../specs/lucy-20261119-heavy-work-capacity-control-spec.md) · [Plan](../plans/lucy-20261119-heavy-work-capacity-control-plan.md) |
| REQ-030-084 | P1-63 | 需求 | P2 | 进程关停准入关闭与在途请求排空 | S4｜ | — | [Spec](../specs/lucy-20261119-process-drain-lifecycle-spec.md) · [Plan](../plans/lucy-20261119-process-drain-lifecycle-plan.md) |
| REQ-030-081 | P1-60 | 需求 | P0 | begin 价值重评与零绑定 MCP 问数不受影响 | S5｜ | — | [Spec](../specs/lucy-20261119-webui-publish-caliber-registry-repair-spec.md) · [Plan](../plans/lucy-20261119-webui-publish-caliber-registry-repair-plan.md) |
| REQ-030-079 | P1-58 | 需求 | P1 | 角色权限与 Agent 列表读取响应、展示复用与统计减负 | S5｜ | — | [Spec](../specs/lucy-20261119-roles-agent-read-responsiveness-spec.md) · [Plan](../plans/lucy-20261119-roles-agent-read-responsiveness-plan.md) |
| REQ-030-080 | P1-59 | 需求 | P1 | 角色权限与 Agent 多人编辑的对象级冲突与草稿恢复 | S5｜ | — | [Spec](../specs/lucy-20261119-roles-agent-concurrent-edit-spec.md) · [Plan](../plans/lucy-20261119-roles-agent-concurrent-edit-plan.md) |
| REQ-030-027 | P0-1 | 需求 | P0 | 问题类型 → 唯一表 + 固定口径绑定 | S5｜ | — | [Spec](../specs/lucy-20261107-question-type-caliber-binding-spec.md) · [Plan](../plans/lucy-20261107-question-type-caliber-binding-plan.md) |
| REQ-030-023 | P0-2 | 需求 | P0 | Catalog 业务语义暴露 | S5｜ | — | [Spec](../specs/lucy-20261107-catalog-business-semantics-spec.md) · [Plan](../plans/lucy-20261107-catalog-business-semantics-plan.md) |
| REQ-030-024 | P0-3 | 需求 | P0 | 多表命中先问 + 表级歧义门闩 | S5｜ | — | [Spec](../specs/lucy-20261107-source-ambiguity-gate-spec.md) · [Plan](../plans/lucy-20261107-source-ambiguity-gate-plan.md) |
| REQ-030-022 | P0-4 | 需求 | P0 | 答复可核对块（来源／口径／截止期强制露出） | S5｜ | — | [Spec](../specs/lucy-20261107-answer-verifiability-spec.md) · [Plan](../plans/lucy-20261107-answer-verifiability-plan.md) |
| REQ-030-018 | P0-5 | 需求 | P0 | 空结果结构化下一步指导 | S5｜ | — | [Spec](../specs/lucy-20261107-empty-result-next-step-guidance-spec.md) · [Plan](../plans/lucy-20261107-empty-result-next-step-guidance-plan.md) |
| REQ-030-025 | P0-6 | 需求 | P0 | Eval 选表正确性 + 真实问句日跑骨架（含 019／020 最小面） | S1｜ | v0.35.0 | [Spec](../specs/lucy-20261107-eval-source-selection-correctness-spec.md) · [Plan](../plans/lucy-20261107-eval-source-selection-correctness-plan.md) |
| REQ-030-026 | P0-7 | 需求 | P0 | 存量用户体感最小仪表盘 + 主动告警 | S1｜ | v0.35.0 | [Spec](../specs/lucy-20261107-stored-user-experience-dashboard-alerts-spec.md) · [Plan](../plans/lucy-20261107-stored-user-experience-dashboard-alerts-plan.md) |
| REQ-030-012 | P0-A | 需求 | P0 | Source 级业务字段暴露裁剪 | S5｜ | — | [Spec](../specs/lucy-20261107-semantic-source-field-exposure-spec.md) · [Plan](../plans/lucy-20261107-semantic-source-field-exposure-plan.md) |
| REQ-030-028 | P0-B | 需求 | P0 | 物理新鲜度合同（答复截止期真源） | S1｜ | v0.35.0 | [Spec](../specs/lucy-20261109-physical-freshness-contract-spec.md) · [Plan](../plans/lucy-20261109-physical-freshness-contract-plan.md) |
| REQ-030-015 | P1-1 | 需求 | P1 | 语义层孤儿路径治理 | S1｜ | — | [Spec](../specs/lucy-20261107-semantic-orphan-path-governance-spec.md) · [Plan](../plans/lucy-20261107-semantic-orphan-path-governance-plan.md) |
| REQ-030-013／016 | P1-2 | 需求 | P1 | 行权限编译门禁 + 各面拒绝码统一 | S1｜ | — | [Spec](../specs/lucy-20261107-row-policy-compile-gate-deny-code-spec.md) · [Plan](../plans/lucy-20261107-row-policy-compile-gate-deny-code-plan.md) |
| REQ-030-017 | P1-3 | 需求 | P1 | `lucy_explain_query` 诊断形状合同 | S1｜ | — | [Spec](../specs/lucy-20261107-explain-diagnostic-shape-contract-spec.md) · [Plan](../plans/lucy-20261107-explain-diagnostic-shape-contract-plan.md) |
| REQ-030-019 | P1-4 | 需求 | P1 | Eval 路径断言编排（完整 WebUI 面） | S1｜ | — | [Spec](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md) · [Plan](../plans/lucy-20261107-eval-tool-assertion-authoring-plan.md) |
| REQ-030-020 | P1-5 | 需求 | P1 | 审计旅程 → Eval 草稿（完整回流） | S1｜ | — | [Spec](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md) · [Plan](../plans/lucy-20261107-audit-journey-eval-case-draft-plan.md) |
| REQ-030-021 | P1-6 | 需求 | P1 | 失败 → 工具面／Skill 反哺队列 | S1｜ | — | [Spec](../specs/lucy-20261107-eval-failure-to-tool-surface-feedback-spec.md) · [Plan](../plans/lucy-20261107-eval-failure-to-tool-surface-feedback-plan.md) |
| REQ-030-029 | P1-8 | 需求 | P1 | 语义发布 → Eval 门禁（发布后必跑／失败阻断或告警） | S1｜ | — | [2026-08-26 闭](../plans/2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md) |
| REQ-030-030 | P1-9 | 需求 | P1 | 质量域 safe-log → Eval 候选回流 | S1｜ | — | [Spec](../specs/lucy-20261014-safe-log-to-quality-eval-spec.md) |
| REQ-030-048 | P1-27 | 需求 | P1 | Ops 概念核心代码根与运行时装配修复 | S5｜ | — | [Spec](../specs/lucy-20261115-ops-concept-code-root-runtime-fix-spec.md) · [Plan](../plans/lucy-20261115-ops-concept-code-root-runtime-fix-plan.md) |
| REQ-030-033 | P1-12 | 需求 | P1 | 问询预算默认阈值放宽（60 次／300s） | S5｜ | — | [Spec](../specs/lucy-20261111-question-budget-threshold-relax-spec.md) |
| REQ-030-034 | P1-13 | 需求 | P1 | 发版性能基线与相对不回退（WebUI＋MCP；含 Roles 列表债） | X_REL｜ | — | [Spec](../specs/lucy-20261113-release-perf-baseline-gate-spec.md) · [Plan](../plans/lucy-20261113-release-perf-baseline-gate-plan.md) |
| REQ-030-035 | P1-14 | 需求 | P1 | 问询预算复盘审计字段（交付面 A） | S5｜ | — | [Spec](../specs/lucy-20261113-question-budget-retrospective-audit-spec.md) · [Plan](../plans/lucy-20261113-question-budget-retrospective-audit-plan.md) |
| REQ-030-036 | P1-15 | 需求 | P1 | 连接写路径 → 执行层热重载 + 成功面诚实 ack | S5｜ | — | [Spec](../../webui/docs/191-execution-runtime-reload-spec.md) · [Plan](../plans/lucy-20261112-connection-create-execution-runtime-reload-plan.md) |
| REQ-030-037 | P1-16 | 需求 | P1 | 库内扫表读法（Doris 外部目录 Hive + 普通 MySQL） | S5｜ | — | [Spec](../specs/lucy-20261111-catalog-scan-read-path-spec.md) · [Plan](../plans/lucy-20261111-catalog-scan-read-path-plan.md) |
| REQ-030-038 | P1-17 | 需求 | P1 | 访问关系图空桑基修复 | S5｜ | — | [Plan](../plans/lucy-20261113-access-map-sankey-empty-fix-plan.md) |
| REQ-030-039 | P1-18 | 需求 | P1 | MCP 客户端 Skill 入口镜像（改挂 `/mcp`） | S5｜ | — | [Spec](../specs/lucy-20261111-mcp-client-skill-endpoint-fix-spec.md) · [Plan](../plans/lucy-20261111-mcp-client-skill-endpoint-fix-plan.md) |
| REQ-030-040 | P1-19 | 需求 | P1 | 访问关系图允许词表对齐（`ok`／`allow`） | S5｜ | — | [Spec](../specs/lucy-20261113-access-map-outcome-vocabulary-spec.md) |
| REQ-030-041 | P1-20 | 需求 | P1 | 外部目录单表读字段（直连 DESC／SHOW COLUMNS） | S1｜ | — | [Spec](../specs/lucy-20261113-external-catalog-column-read-spec.md) · [Plan](../plans/lucy-20261113-external-catalog-column-read-plan.md) |
| REQ-030-042 | P1-21 | 需求 | P1 | 重读路径与探针减负（访问日志后台重建＋健康探针拆分） | S5｜ | — | [Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) · [Plan](../plans/lucy-20261113-heavy-read-path-and-probe-relief-plan.md) |
| REQ-030-052 | P1-31 | 需求 | P1 | 全页面事件循环与探针风险排查（P1-21 全局化；逐页＋全 GET 路由） | S5｜ | — | [Plan](../plans/lucy-20261115-page-by-page-event-loop-sweep-plan.md) |
| REQ-030-053 | P1-32 | 需求 | P1 | 审计导出路径规模整改 | S5｜ | — | [Spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md) |
| REQ-030-054 | P1-33 | 需求 | P1 | 并发压测越线接口整改（F-2／F-3／F-4／F-5／F-7） | S5｜ | — | [Spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md) |
| REQ-030-055 | P1-34 | 需求 | P1 | 大 Schema 接入（宽表与多表）：顺利接入，而不是超时报错 | S1｜ | — | [Spec](../specs/lucy-20261115-large-schema-ingestion-spec.md) · [Plan](../plans/lucy-20261115-large-schema-ingestion-plan.md) |
| REQ-030-056 | P1-35 | 需求 | P1 | 表级歧义门闩：纯 MCP 逃生与拒绝载荷持久修复（P0-3 伴生） | S5｜ | — | [Spec](../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md) · [Plan](../plans/lucy-20261116-source-ambiguity-mcp-escape-plan.md) |
| REQ-030-057 | P1-36 | 需求 | P1 | 调用流水 trace 级可追溯与存档（span 模型；封存导出与对账） | S5｜ | — | [Spec](../specs/lucy-20261116-trace-span-ledger-spec.md) · [Plan](../plans/lucy-20261116-trace-span-ledger-plan.md) |
| REQ-030-058 | P1-37 | 需求 | P1 | MCP 体验韧性：握手长尾、失败信息可操作、会话恢复与限流、拒绝快速返回 | S5｜ | — | [Spec](../specs/lucy-20261116-mcp-ux-resilience-spec.md) · [Plan](../plans/lucy-20261116-mcp-ux-resilience-plan.md) |
| REQ-030-059 | P1-38 | 需求 | P1 | 推断问询补算让出事件循环（分页读取、分片写入） | S1｜ | — | [Spec](../specs/lucy-20261117-inferred-turn-rebuild-yield-spec.md) · [Plan](../plans/lucy-20261117-inferred-turn-rebuild-yield-plan.md) |
| REQ-030-060 | P1-39 | 需求 | P1 | 客户 K8s 平滑升级：残余 event loop 卡顿导致 readyz 超时／入口 502／503 | S5｜ | — | [Spec](../specs/lucy-20261117-cold-start-audit-scan-spec.md) · [Plan](../plans/lucy-20261117-cold-start-audit-scan-plan.md) |
| REQ-030-061 | P1-40 | 需求 | P1 | 明文 HTTP 复制按钮假成功：共享 helper 谎报「已复制」 | S5｜ | — | [Spec](../../webui/docs/192-clipboard-non-secure-context-fallback-spec.md) |
| REQ-030-062 | P1-41 | 需求 | P1 | 访问关系图桑基还原：线上镜像缺修复；HEAD 在零访问／多 Agent／全未确认下仍退化 | S5｜ | — | [Spec](../specs/lucy-20261117-access-map-sankey-restoration-spec.md) |
| REQ-030-063 | P1-42 | 需求 | P1 | 按钮级「成功反馈真实性」排查：下载／保存／导出（P1-40 同类扩展；仅按钮级） | S5｜ | — | [Spec](../specs/lucy-20261122-button-feedback-honesty-spec.md) · [Plan](../plans/lucy-20261122-button-feedback-honesty-plan.md) |
| REQ-030-064 | P1-43 | 需求 | P1 | Lucy 不透出数据库原始错误：外部目录读字段失败时，页面无法区分握手失败、元数据服务慢、元数据服务起… | S1｜ | — | [Spec](../specs/lucy-20261118-db-original-error-surfacing-spec.md) |
| REQ-030-065 | P1-44 | 需求 | P1 | 页面渲染崩溃被兜底页伪装成版本问题：访问日志调用流水整页不可用；路由兜底边界捕获所有渲染错误 | S5｜ | — | [Spec](../specs/lucy-20261122-page-open-error-boundary-spec.md) · [Plan](../plans/lucy-20261122-page-open-error-boundary-plan.md) |
| REQ-030-066 | P1-45 | 需求 | P1 | 推断问询重建中断后自动恢复（前方报告 P0-02；硬复现） | S5｜ | — | [Spec](../specs/lucy-20261118-inferred-turn-rebuild-recovery-spec.md) · [Plan](../plans/lucy-20261118-inferred-turn-rebuild-recovery-plan.md) |
| REQ-030-067 | P1-46 | 需求 | P1 | readyz 与 MCP 监听就绪一致性（前方报告 P0-03；启动窗复现） | S5｜ | — | [Spec](../specs/lucy-20261118-readyz-mcp-listen-consistency-spec.md) · [Plan](../plans/lucy-20261118-readyz-mcp-listen-consistency-plan.md) |
| REQ-030-068 | P1-47 | 需求 | P1 | 满量重建负载下探针预算内响应（前方报告 P0-01；部分复现） | S5｜ | — | [Spec](../specs/lucy-20261118-rebuild-probe-budget-spec.md) · [Plan](../plans/lucy-20261119-p147-write-slice-spike-shave-plan.md) |
| REQ-030-069 | P1-48 | 需求 | P1 | 多步流程状态机合同门禁（Spec 文法＋`lint:spec-docs`；存量盘点指针） | S1｜ | — | [Spec](../specs/lucy-20261118-multi-step-state-machine-contract-gate-spec.md) · [Plan](../plans/lucy-20261118-multi-step-state-machine-contract-gate-plan.md) |
| REQ-030-070 | P1-49 | 需求 | P1 | `lucy_ops_reader` 无头可问治理面 ACL | S1｜ | — | [Spec](../specs/lucy-20261118-lucy-ops-reader-headless-governance-acl-spec.md) · [Plan](../plans/lucy-20261118-lucy-ops-reader-headless-governance-acl-plan.md) |
| REQ-030-072 | P1-51 | 需求 | P1 | 版本轴分工与命名规约（候选 `rc.N` 自动分配＋交付主键＋私有化分叉追溯） | S1｜ | — | [Spec](../specs/lucy-20261118-version-axis-naming-spec.md) · [Plan](../plans/lucy-20261118-version-axis-naming-plan.md) |
| REQ-030-073 | P1-52 | 需求 | P1 | 客户镜像升级可靠性分层门禁（同一 digest＋客户数据量级＋A/B 必跑＋C 按边界触发） | S1｜ | — | [Spec](../specs/lucy-20261118-customer-upgrade-reliability-gate-spec.md) · [Plan](../plans/lucy-20261118-customer-upgrade-reliability-gate-plan.md) |
| REQ-030-074 | P1-53 | 需求 | P0 | MCP 升级兼容底线与全真用户旅程门禁（通用题库＋实例真实基线＋功能／权限／耗时门禁） | X_REL｜ | — | [Spec](../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md) · [Plan](../plans/lucy-20261118-mcp-upgrade-compatibility-plan.md) |
| REQ-030-075 | P1-54 | 需求 | P0 | MCP 升级兼容多场景题库＋CompatConfigProfile（业务／Ops／配置前置） | S5｜ | — | [Spec](../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md) · [Plan](../plans/lucy-20261118-mcp-upgrade-question-bank-plan.md) |
| REQ-030-051 | P1-30 | 需求 | P1 | Wiki／Skill 真读真用＋ACL UAT（测试台合同；防假通） | X_REL｜ | — | [Plan](../plans/lucy-20261115-uat-context-content-landing-plan.md) |
| REQ-030-043 | P1-22 | 需求 | P1 | Doris／SelectDB 多版本对比环境 | S1｜ | — | — |
| REQ-030-044 | P1-23 | 需求 | P1 | UI/UX 标准收敛并与 DEVELOPMENT 绑定 | S1｜ | — | [核对报告](../../inbox/20261114-0130-uiux-standard-audit.md) |
| REQ-030-045 | P1-24 | 需求 | P1 | WebUI 存量 UI/UX 整改（逐页；UXR-01–09，批次 B1–B4） | S1｜ | — | [Spec](../specs/lucy-20261114-webui-uiux-remediation-spec.md) |
| REQ-030-046 | P1-25 | 需求 | P1 | 行权限能力评审（100 用户／30–40 人行级受限目标） | S1｜ | — | [评审报告](../reviews/2026-11-14-row-policy-capability-assessment.md) |
| REQ-030-049 | P1-28 | 需求 | P1 | 行级隔离场景（十几人 × 一批表 × 不同行范围） | S5｜ | — | [`UAT-SUITE-R](../qa/uat/suites/row-policy-finance-scenario/suite.md) |
| REQ-030-001 | P2-1 | 需求 | P2 | 发布工作台分文件勾选发布 | S1｜ | — | [Spec](../specs/lucy-20261107-publish-workbench-per-file-selection-spec.md) · [Plan](../plans/lucy-20261107-publish-workbench-per-file-selection-plan.md) |
| REQ-030-003 | — | 需求 | P1 | 访问关系图与访问日志口径对齐 | S5｜ | — | [Spec](../specs/lucy-20261102-access-map-audit-echo-spec.md) · [Plan](../plans/lucy-20261102-access-map-audit-echo-plan.md) |
| REQ-TE-001 | — | 需求 | P1 | 可核对块覆盖认证路线／报告模板 | S1｜ | — | [原池](../plans/lucy-20261115-post-030-trust-evidence-requirement-pool.md#req-te-001可核对块覆盖认证路线报告模板) |
| REQ-TE-002 | — | 需求 | P1 | 统一可信证据载荷槽位 | S1｜ | — | [原池](../plans/lucy-20261115-post-030-trust-evidence-requirement-pool.md#req-te-002统一可信证据载荷槽位) |
| REQ-TE-003 | — | 需求 | P2 | 监控型管道／刷新失败风险揭示 | S1｜ | — | [原池](../plans/lucy-20261115-post-030-trust-evidence-requirement-pool.md#req-te-003监控型管道刷新失败风险揭示) |
| REQ-TE-004 | — | 需求 | P2 | 认证对象分层与治理角色生命周期 | S1｜ | — | [原池](../plans/lucy-20261115-post-030-trust-evidence-requirement-pool.md#req-te-004认证对象分层与治理角色生命周期) |
| REQ-TE-005 | — | 需求 | P2 | 质量预警沿依赖向下游揭示 | S1｜ | — | [原池](../plans/lucy-20261115-post-030-trust-evidence-requirement-pool.md#req-te-005质量预警沿依赖向下游揭示) |
| REQ-TE-006 | — | 需求 | P2 | 按用途「是否够用」规则证据 | S1｜ | — | [原池](../plans/lucy-20261115-post-030-trust-evidence-requirement-pool.md#req-te-006按用途是否够用规则证据) |
| REQ-TE-007 | — | 需求 | P2 | 结论与数据绑定 | S1｜ | — | [原池](../plans/lucy-20261115-post-030-trust-evidence-requirement-pool.md#req-te-007结论与数据绑定) |
| REQ-TE-008 | — | 需求 | P2 | 宿主强制渲染可信证据 | S1｜ | — | [原池](../plans/lucy-20261115-post-030-trust-evidence-requirement-pool.md#req-te-008宿主强制渲染可信证据) |
| REQ-CAL-001 | — | 概念 | P2 | 同名异域「收入」双口径选择（概念） | S1｜ | — | [原池](../plans/lucy-20261116-post-030-dual-caliber-selection-concept-pool.md#req-cal-001同名异域收入双口径选择试点-mvp-概念) |
