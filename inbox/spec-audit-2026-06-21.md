# project-lucy 功能模块 Spec 全面检查报告

| 项 | 内容 |
|---|---|
| 报告类型 | 临时 Spec 审计报告 |
| 生成日期 | 2026-06-21 |
| 检查范围 | `docs/`、`webui/docs/`、`lucy-skills/docs/`、`webui/src`、`webui/server`、`semantic-layer/`、`skills/`、`wiki/`、`evals/` |
| 方法 | 静态阅读 spec / design / status / review / UAT 文档，抽样对照实现入口、路由、API、类型、测试文件与资产目录 |
| 未执行 | 未运行自动化测试；本报告聚焦 spec 现状与缺口，不判定运行时全部可用性 |

## 1. 总体结论

项目的 WebUI 主线已经有比较完整的规格体系，覆盖架构、API、数据模型、导航、数据库接入、Eval、访问治理、UI 改造等内容；其中 Eval 与访问治理的详细设计质量最高，包含页面、数据模型、API、落盘策略、测试策略、验收标准和 UAT。

主要问题不是“没有 spec”，而是 **spec 分层和版本同步失控**：

- `webui/docs/01-04` 仍是 M0-M5 时代基础规格，没有纳入数据库接入、Eval、访问治理的新增 API 与模型。
- `docs/webui-feature-map.md`、`docs/webui-impl-status.md`、`docs/project-overview.md` 与实际代码/资产存在多处状态漂移。
- `access.yaml` / proxy ACL 已进入 v1.2 role 模型，但 admin UI/types 仍以 legacy `allow` 为主，spec 与实现边界未闭合。
- semantic-layer / wiki / skills 这些核心运行时资产有局部规则，但缺少按 domain/source 维度的完整维护 spec 与质量评分标准。
- KX 财务域已经进入语义层、wiki、eval/quiz，但项目总览与部分运行时文档仍以 superstore 为主。

综合评分：**7.2 / 10**。

评分口径：

| 维度 | 权重 | 得分 | 说明 |
|---|---:|---:|---|
| 覆盖完整性 | 30% | 7.0 | WebUI 模块覆盖较好；semantic-layer、wiki、skills、domain onboarding 规格不足 |
| 一致性 | 25% | 5.8 | 多份状态文档与代码/资产不同步，是最大短板 |
| 可执行性 | 20% | 8.0 | 详细设计普遍可直接交给 Builder；部分未确认假设未闭环 |
| 可测试性 | 15% | 8.0 | Eval、ACL、fs-safe、语义层有测试策略和测试文件；数据库接入/status 缺同步 |
| 可维护性 | 10% | 7.0 | 文档元数据齐全，但缺“事实源索引”和 stale 检查机制 |

## 2. 模块现状与缺失

### 2.1 项目治理与总览

相关 spec：

- `docs/DEVELOPMENT.md`
- `docs/project-overview.md`
- `docs/vision.md`
- `docs/webui-module-guide.md`
- `docs/webui-feature-map.md`
- `docs/webui-impl-status.md`

现状：

- `DEVELOPMENT.md` 明确了开发态/运行时双轨、Plan Mode、semantic-layer 分层、fs-safe 安全红线，质量较高。
- `vision.md` 给出长期产品边界，但仍偏愿景，不是模块级规格。
- `webui-module-guide.md` 已按 6 个一级模块描述用户流程，基本符合当前导航。

缺失/问题：

- `project-overview.md` 的状态、目录和数据域描述滞后：仍出现 `skills/superstore`、`evals/global`、WebUI M0-M5、superstore 7 case 等旧信息；实际已有 `skills/domains/superstore/*`、`evals/kx_financial/*`、6 大 WebUI 模块。
- `webui-feature-map.md` 仍把 Eval、访问治理、审计日志等列为缺失或部分实现，但代码已有页面、路由和后端模块。
- `webui-impl-status.md` 把数据库接入标为“待开发”，但代码已有 `/connections` 页面、`/api/connections*` 路由和前端测试；同时 Eval/Admin 后端 API 列为 `—`，不利于追踪。

质量评分：**6.5 / 10**。

建议：

- 把 `docs/webui-impl-status.md` 定为唯一实现状态事实源，补全每个模块的前端、后端 API、测试文件、状态、最后验证日期。
- 更新 `docs/project-overview.md`，纳入 KX 财务域、当前 6 大 WebUI 模块、实际技能目录和 eval/quiz 结构。
- 将 `docs/webui-feature-map.md` 改为“历史缺口分析归档”，或刷新为当前差距版，避免和状态表并存冲突。

### 2.2 WebUI 基础架构 / M0-M5

相关 spec：

- `webui/docs/01-architecture.md`
- `webui/docs/02-arch-spec.md`
- `webui/docs/03-api-spec.md`
- `webui/docs/04-data-model.md`
- `webui/docs/05-task-list.md`
- `webui/docs/06-navigation-ia.md`
- `webui/docs/codex/*`

现状：

- 架构文档清楚定义了本地单用户、fs-safe、YAML 就地补丁、dryRun/diff/validate、错误 envelope、Document/CST、overlay 分层等核心约束。
- API 与数据模型覆盖 Catalog、TableEditor、JoinEditor、WikiEditor、Review 等 M0-M5 主线。
- 代码中有对应模块：`Catalog.tsx`、`TableEditor.tsx`、`JoinEditor.tsx`、`WikiEditor.tsx`、`Review.tsx`，以及 `semantic-layer.ts`、`wiki.ts`、`diff.ts`、`completion.ts`、`fs-safe.ts` 等。

缺失/问题：

- `webui/docs/03-api-spec.md` 没有登记后续新增的 `/api/connections/*`、`/api/eval/*`、`/api/admin/*`、proxy 相关 API。
- `webui/docs/04-data-model.md` 没有纳入 Agent/Role、Eval Run、MonitorConfig、Connection write-back 等模型。
- `webui/docs/01-architecture.md` 的前端页面列表仍是五大页，不包含连接、评测、访问治理。
- `webui/docs/02-arch-spec.md` 的技术栈表是“基线/下限”，实际版本已升到 React 19 / Vite 8 / TS 6 / Fastify 5；文档虽注明漂移，但应转为当前事实。

质量评分：**8.0 / 10**（基础质量高，但已变成老主线规格）。

建议：

- 增加 `webui/docs/08-current-api-index.md` 或直接扩展 `03-api-spec.md`，覆盖所有当前 API。
- 增加 `webui/docs/09-current-data-model.md` 或扩展 `04-data-model.md`，把 Eval/Admin/Connection 模型纳入统一类型索引。
- 在 `webui/docs/README.md` 标记 `05-task-list` 与 `codex/*` 为历史执行归档，避免被误用为待办。

### 2.3 数据库接入

相关 spec：

- `docs/design-db-connection.md`
- `docs/webui-module-guide.md`
- `docs/webui-impl-status.md`

现状：

- 详细设计覆盖 `GET /api/connections`、表白名单、连通测试、ingest、`ktx.yaml` 写入、fs-safe 文件级白名单、验收标准。
- 代码已存在 `ConnectionOverview.tsx`、`TableWhitelist.tsx`、`ConnectionTest.tsx`，以及 `/api/connections`、`/api/connections/:connId/tables`、`PUT enabled-tables`、`POST test`、`POST ingest`。
- `fs-safe.ts` 已有 `ALLOW_FILES = ["ktx.yaml"]`，与设计一致。

缺失/问题：

- `docs/webui-impl-status.md` 仍标为“待开发”，与代码矛盾。
- 该模块缺少独立 review/UAT 文档；现有只有设计与部分前端测试。
- `PUT enabled-tables` 写回 `ktx.yaml` 是高风险配置变更，spec 未明确是否需要 dryRun/diff/confirm；当前设计直接写，安全体验弱于语义层编辑。
- “列出数据库中所有可见表”当前设计优先读已扫描的 `_schema/*.yaml`，不能覆盖尚未 ingest 的真实库表；这是可接受 MVP 取舍，但应在 UI/spec 标注。

质量评分：**7.0 / 10**。

建议：

- 修正实现状态表。
- 为 `ktx.yaml` 白名单写入补充 dryRun/diff/confirm 规格，至少记录 old/new enabled_tables。
- 增加数据库接入 UAT：连接列表、白名单保存、ingest、失败连通、secrets 不可读、只改目标 connection。

### 2.4 语义层维护

相关 spec：

- `docs/DEVELOPMENT.md` semantic-layer 分层
- `webui/docs/01-04`
- `semantic-layer/mysql-aliyun/*.yaml`
- `docs/mysql-comment-maintenance.md`

现状：

- overlay / manifest 分层规则非常明确：manifest `_schema/<schema>.yaml` 自动生成，人工扩展写 `<table>.yaml` overlay。
- `superstore_orders.yaml` 定义 grain、派生列、9 个 measures、3 个 segments、2 个 joins。
- `kx_fact_financial_amount.yaml` 定义 KX 财务事实表描述、grain、3 个 measures、多个 amount_type / statement_type segments。
- WebUI 有 TableEditor、JoinEditor、Review、validate 流程。

缺失/问题：

- 缺少 “source 级 spec 模板”：每个语义 source 应声明业务 owner、grain、必备 measures、默认 segments、join policy、freshness 字段、eval 覆盖映射、wiki_refs。
- KX 财务域只有事实表 overlay；相关维表/视图的 overlay 是否需要 measures/segments/joins 没有明确治理标准。
- `docs/project-overview.md` 的 semantic-layer 状态仍写“3 表 / 9 measures”，实际 KX 域已增加多 source。
- `docs/DEVELOPMENT.md` 要求改 yaml 后重建索引，但 WebUI 保存后的 reindex 行为没有在 spec 中闭环；现有流程主要 validate，不等于 MCP 搜索索引更新。

质量评分：**7.5 / 10**。

建议：

- 新增 `docs/semantic-layer-source-spec.md`：定义每个 source 的必填元数据、质量门禁、eval/wiki 映射、reindex 要求。
- 新增 `semantic-layer/mysql-aliyun/README.md`：按 domain 列出当前 source、overlay 完成度、owner、最后 validate/reindex 日期。
- 在 WebUI 保存语义层后明确是否提示/触发 `ktx admin reindex`，或者在 Review 页提供 reindex checklist。

### 2.5 业务 Wiki / 知识库

相关 spec：

- `webui/docs/03-api-spec.md` wiki API
- `webui/docs/04-data-model.md` frontmatter
- `wiki/global/*.md`
- `docs/webui-module-guide.md`

现状：

- WikiEditor 支持列表、frontmatter、Markdown、diff、保存。
- 现有 wiki 覆盖 discount、profit、return、superstore playbook、KX financial playbook。

缺失/问题：

- 缺少 wiki 文档质量 spec：frontmatter 必填程度、`sl_refs` 命名、与 eval case 的关联、过期判定、review 责任。
- `docs/webui-feature-map.md` 记录全文/Tag/sl_ref 搜索缺失；当前 WebUI 是否需要补该能力未进入统一状态表。
- wiki 与 `skills/domains/*` reference 的边界不清：哪些知识放 wiki，哪些放 skill references，哪些放 CLAUDE.md，目前靠经验。

质量评分：**6.5 / 10**。

建议：

- 新增 `docs/wiki-authoring-spec.md`，定义 frontmatter、引用语义层、版本、staleness、review 流程。
- 在 `docs/DEVELOPMENT.md` 或新 spec 中明确 wiki vs skill reference vs CLAUDE.md 的信息分工。
- 将 KX financial playbook 纳入项目总览和 eval 覆盖矩阵。

### 2.6 审阅与校验

相关 spec：

- `webui/docs/01-04`
- `docs/webui-module-guide.md`
- `webui/src/pages/Review.tsx`

现状：

- 设计上有 `GET /api/diff`、`POST /api/validate-changed`、session written files、git diff fallback。
- 符合本地治理工作台“提交前集中审阅”的定位。

缺失/问题：

- `docs/webui-impl-status.md` 写的是 `GET /api/changed`，实际 API 是 `GET /api/diff`。
- Review 的范围随 fs-safe 扩展已经包括 `evals`、`skills`、`webui/config`、`ktx.yaml` 等，但老 spec 仍主要写 `semantic-layer/`、`wiki/`、`.ktx-ui/`。
- 缺少跨模块变更门禁矩阵：例如改 `ktx.yaml`、`access.yaml`、eval YAML、skills 时各自应跑哪些验证。

质量评分：**7.0 / 10**。

建议：

- 更新 Review spec，列出当前可写目录/文件与对应校验命令。
- 将 `validate-changed` 扩展为多类型：semantic validate、eval list-cases、access.yaml schema/role preview、skills frontmatter check。

### 2.7 Eval / Quiz 质量评测

相关 spec：

- `docs/eval-quiz-conventions.md`
- `docs/design-eval-monitoring.md`
- `docs/review-module2-eval-monitoring.md`
- `docs/uat-module2-eval-monitoring.md`
- `evals/superstore/eval/superstore-eval-cases.yaml`
- `evals/kx_financial/eval/kx_financial-eval-cases.yaml`

现状：

- `eval-quiz-conventions.md` 是高质量规范，覆盖产物路径、覆盖矩阵、数据获取优先级、命名、版本同步、drift 退出码、安全红线、quiz 元数据。
- Eval WebUI 详细设计覆盖 Case CRUD、runner、Run 详情、compare、monitor、SQLite、SSE、测试和验收。
- 代码已有 `webui/server/eval/{cases,runner,monitor,db}.ts` 和 `webui/src/pages/eval/*`，测试文件也较完整。
- superstore 与 kx_financial 两个 domain 都已有 eval/quiz 资产。

缺失/问题：

- `docs/design-eval-monitoring.md` 的部分问题已被修复：`coverage` 模式现在明确返回未实现错误，runner status 已按 `summary !== null` 判定，`GET /api/eval/domains/:domain` 已存在。旧 review 文档未标注修复状态。
- `superstore-eval-cases.yaml` metadata 写 `runner_schema_version: v1.3`，但 conventions 已到 v1.4；KX 文件是 v1.4。需要确认是否允许 superstore 保持 v1.3。
- 项目总览仍写 superstore 7/8 条 case，但实际 eval YAML 包含 quiz_cases 和更多 case。
- 设计假设中 runner 输出字段如 SQL/finalText 的稳定性应有 fixture 锁定；UAT 已提示但未见状态表闭环。

质量评分：**8.5 / 10**。

建议：

- 给 `review-module2-eval-monitoring.md` 增加“修复状态”小节，避免旧 review 继续误导。
- 统一 superstore eval schema 到 v1.4，或在 conventions 中声明 v1.3 兼容策略。
- 新增 `docs/eval-domain-index.md`，列出每个 domain 的 case 数、coverage 矩阵、paired quiz、runner schema、最近 run。
- 将 runner JSON sample 固定为 fixture，并在 spec 中引用。

### 2.8 访问治理 / MCP Auth Proxy

相关 spec：

- `webui/docs/07-mcp-auth-proxy-spec.md`
- `docs/design-agent-permissions.md`
- `docs/review-module1-agent-permissions.md`
- `docs/uat-agent-permissions.md`
- `webui/config/access.yaml`

现状：

- MCP Auth Proxy spec 质量高，覆盖请求生命周期、MCP session、tools/list 改写、role 权限模型、tableSelectors、decision_reason、kx_catalog、audit SQLite、风险缓解。
- proxy 代码已有 `identity.ts`、`acl.ts`、`audit.ts`、`mcp-proxy.ts`，并在 `index.ts` 启动。
- `access.yaml` 已含 `roles.kx_readonly`、`users[].role`、全局 deny、known tools、sensitive metadata 等。
- audit schema 已有 role/snapshot 字段。

缺失/问题：

- Admin UI/types 仍以 `users[].allow` 为主：`webui/src/lib/types.ts` 的 `Agent`、`CreateAgentBody`、`AgentPatch` 没有 role/effectivePermissions；`AgentDetail.tsx` 仍编辑 allow；`server/admin/agents.ts` 新建 Agent 仍要求 allow。与 `design-agent-permissions.md v1.2` 的“新建必须 role，不再生成 allow”冲突。
- `webui/config/access.yaml` 顶部注释仍写“Phase 1: tokens 使用明文 value”，但实际使用 `hash: sha256:*`，注释过期。
- `docs/review-module1-agent-permissions.md` 提到的 P1/P2 是否全部修复没有状态闭环。
- `docs/webui-impl-status.md` 对访问治理后端 API 写 `—`，但实际有 `/api/admin/*` 与 proxy。

质量评分：**7.5 / 10**，其中 proxy/runtime spec 可达 8.5，admin UI 对齐拉低得分。

建议：

- 立即补一个 `docs/access-governance-implementation-delta.md`，列出 v1.2 role spec 与当前 admin UI 差异。
- 下一步优先让 admin UI/types/API 支持 role 与 effectivePermissions preview；legacy allow 只读展示。
- 更新 `access.yaml` 注释，避免误导 token 存储策略。
- 给 Module 1 review 文档增加修复状态，并把未修问题迁移到正式 issue/TODO。

### 2.9 Skills / lucy-skills

相关 spec：

- `lucy-skills/docs/01-spec.md`
- `docs/DEVELOPMENT.md` Skills 当前状态
- `skills/warehouse/SKILL.md`
- `skills/reviewer/SKILL.md`
- `skills/domains/superstore/*.md`
- `docs/vision.md`

现状：

- `lucy-skills/docs/01-spec.md` 是完整 MCP server MVP spec，定义 resources/list/read、URI、扫描规则、配置、验证标准和 backout plan。
- `skills/warehouse/SKILL.md` 和 `skills/reviewer/SKILL.md` 有 frontmatter、触发条件、依赖和行为规则。
- Superstore domain 知识现在以 reference doc 形式存在于 `skills/domains/superstore/*.md`，不是 `SKILL.md`。

缺失/问题：

- `docs/project-overview.md` 仍描述 `skills/superstore/SKILL.md` 和 `superstore/references/*`，与实际目录不一致。
- `skills/reviewer/SKILL.md` 的 dependency 指向 `../superstore/references/superstore-pitfalls.md`，实际路径不存在；当前真实文件在 `skills/domains/superstore/pitfalls.md`。
- lucy-skills server spec 已写，但仓库中未看到对应 `lucy-skills/package.json` 或 server 实现文件，当前更像待实施 spec。
- 缺少 Skill 作者规范：frontmatter 必填、dependencies 路径校验、eval_coverage 如何填、last_pass_rate 如何维护。
- `docs/vision.md` 把 Skill 管理列为 P0，但 WebUI 的 Skill 管理仍未有详细实现 spec。

质量评分：**6.0 / 10**。

建议：

- 新增 `docs/skills-authoring-spec.md`，定义 SKILL.md 与 reference doc 的目录结构、frontmatter、依赖路径、触发词、eval 覆盖。
- 修复 reviewer skill dependency 路径，或把 Superstore Domain 正式提升为 `skills/domains/superstore/SKILL.md`。
- 明确 lucy-skills 是“待实施”还是“已实施”；若待实施，在状态表列出。
- 为 WebUI Skill 管理补 `design-skill-management.md`，至少定义只读索引、编辑、diff、依赖校验、eval coverage 展示。

### 2.10 KTX 运行时上下文

相关 spec：

- `CLAUDE.md`
- `docs/DEVELOPMENT.md` 双轨说明
- `skills/warehouse/*`
- `wiki/global/*`

现状：

- `CLAUDE.md` 清楚声明自己是运行时 prompt，不含开发规则。
- 数据问答优先级、表路由、指标口径、Reviewer 触发、Provenance Footer 都有说明。

缺失/问题：

- `CLAUDE.md` 中 KX 路由已有，但部分项目总览/skill docs 仍停留 superstore。
- `CLAUDE.md` 与 warehouse skill / wiki / semantic-layer 的信息存在重复，需要明确哪个是运行时加载器、哪个是事实源。
- Reviewer skill 内有明显文案错误：“Canonical table? 超市分析 → dataforai.superstore_orders（非 dataforai.superstore_orders）”，正反例相同。

质量评分：**7.0 / 10**。

建议：

- 只在 `CLAUDE.md` 保留运行时最小路由和强制流程，细节口径尽量链接到 wiki/semantic-layer/skills。
- 修复 reviewer skill 的正反例文案。
- 给 KX 数据问答补 domain reference skill/wiki 边界说明。

## 3. 横向缺口清单

按优先级排序：

| 优先级 | 缺口 | 影响 | 建议落点 |
|---|---|---|---|
| P0 | 状态文档与实现冲突 | 后续开发/验收会按错状态推进 | 更新 `docs/webui-impl-status.md`、`docs/project-overview.md` |
| P0 | Admin UI 仍是 legacy allow，未对齐 role spec | 权限治理 UI 可能生成不符合 v1.2 的配置 | `docs/access-governance-implementation-delta.md` + 后续实现 |
| P0 | `webui/docs/03/04` 未纳入新增模块 | API/model 事实源碎片化 | 扩展或新增 current API/model index |
| P1 | semantic-layer source 缺少统一质量模板 | 新 domain 扩展难以验收 | `docs/semantic-layer-source-spec.md` |
| P1 | skills dependency / authoring 无校验 | LLM 按需加载会读到失效引用 | `docs/skills-authoring-spec.md` + lint 脚本 |
| P1 | eval review/UAT 未闭环修复状态 | 旧审查意见会长期误导 | 给 review/UAT 增加 status/update |
| P1 | Wiki authoring 无质量门禁 | 业务口径文档质量不可控 | `docs/wiki-authoring-spec.md` |
| P2 | 数据库接入无 review/UAT | 涉及 `ktx.yaml` 写入，回归风险偏高 | `docs/uat-db-connection.md` |
| P2 | WebUI Skill 管理只有愿景，无详细 spec | P0 产品能力无法排期 | `docs/design-skill-management.md` |
| P2 | 项目总览未覆盖 KX 域 | 新成员无法理解当前真实 domain 范围 | 更新 `docs/project-overview.md` |

## 4. 建议整改方案

### 阶段 A：先止血，一天内可完成

1. 更新 `docs/webui-impl-status.md`：
   - 数据库接入改为已实现或部分实现，并列出真实 API。
   - Eval/Admin 后端 API 不再写 `—`。
   - 修正 Review API 名称为 `/api/diff`。

2. 更新 `docs/project-overview.md`：
   - 纳入 KX 财务域、`evals/kx_financial`、当前 6 大 WebUI 模块。
   - 修正 skills 目录结构。
   - 把 M0-M5 完成表述改成“核心语义维护主线完成，后续模块另见 status”。

3. 给旧 review 文档加状态：
   - `review-module1-agent-permissions.md`
   - `review-module2-eval-monitoring.md`
   - 标注哪些已修、哪些未修、哪些被设计变更取代。

4. 修复明显错误：
   - `skills/reviewer/SKILL.md` 中正反例相同的问题。
   - `webui/config/access.yaml` 顶部明文 token 注释。

### 阶段 B：建立当前事实源，一周内完成

1. 扩展 WebUI API / model spec：
   - `webui/docs/03-api-spec.md` 增加 connection/eval/admin/proxy API。
   - `webui/docs/04-data-model.md` 增加 Connection、Eval、Agent/Role/Audit 模型。

2. 新增三个治理 spec：
   - `docs/semantic-layer-source-spec.md`
   - `docs/wiki-authoring-spec.md`
   - `docs/skills-authoring-spec.md`

3. 新增 domain index：
   - `docs/domain-index.md`
   - 每个 domain 列 semantic sources、wiki、skills、eval/quiz、owner、状态。

4. 明确 access governance delta：
   - 当前 runtime proxy 已支持 role，但 admin UI 仍 legacy。
   - 形成后续 Builder 可执行的改造列表。

### 阶段 C：自动防漂移，两周内完成

1. 增加文档/实现一致性检查脚本：
   - 扫 `App.tsx` routes 与 `docs/webui-impl-status.md`。
   - 扫 `server/index.ts` 注册 API 与 `webui/docs/03-api-spec.md`。
   - 扫 `skills/**/SKILL.md` dependencies 是否存在。
   - 扫 eval YAML metadata `runner_schema_version` 与 conventions 兼容性。

2. 增加 spec freshness 字段：
   - 每份模块 spec 增加 `最后对照实现日期`、`对应测试文件`、`当前状态`。

3. 把 Review 页校验拓展为跨资产：
   - semantic validate
   - eval list-cases / schema check
   - access role preview
   - skill dependency lint
   - wiki frontmatter lint

## 5. 推荐评分基线

后续可以按以下标准给每个模块 spec 打分：

| 分数 | 标准 |
|---:|---|
| 9-10 | 有目标、非目标、架构、页面/API/model、落盘、安全、测试、验收、UAT，且与实现同步 |
| 7-8 | 主要开发可执行，但缺少少量验收/状态闭环，或有轻微版本漂移 |
| 5-6 | 只有设计或使用说明，缺 API/model/test，或与实现存在明显冲突 |
| 3-4 | 仅散落在 README/代码/注释中，没有模块级 spec |
| 0-2 | 没有可识别 spec，且无法从现有文档推断边界 |

当前模块评分汇总：

| 模块 | 评分 |
|---|---:|
| 项目治理与总览 | 6.5 |
| WebUI 基础架构/M0-M5 | 8.0 |
| 数据库接入 | 7.0 |
| 语义层维护 | 7.5 |
| 业务 Wiki | 6.5 |
| 审阅与校验 | 7.0 |
| Eval / Quiz | 8.5 |
| 访问治理 / MCP Auth Proxy | 7.5 |
| Skills / lucy-skills | 6.0 |
| KTX 运行时上下文 | 7.0 |

## 6. 本次检查到的高价值证据

- 当前 WebUI 路由包含 6 大模块：`/connections`、`/sources/*`、`/wiki`、`/review`、`/eval/*`、`/admin/*`。
- 当前后端注册了连接、语义层、wiki、joins、eval、admin、proxy 等路由。
- 当前测试文件共 27 个，覆盖 server 与 src 两侧。
- `fs-safe.ts` 当前允许写 `semantic-layer`、`evals`、`skills`、`wiki`、`.ktx-ui`、`webui/config`，并精确允许 `ktx.yaml`。
- `access.yaml` 已有 role 模型，但 admin UI/types 仍 legacy allow。
- `evals/` 已有 `superstore` 与 `kx_financial` 两个 domain。
- `skills/reviewer/SKILL.md` dependency 路径与实际目录不一致。

## 7. 结论

project-lucy 的 spec 体系已经从单一 WebUI MVP 扩展到数据接入、质量评测、访问治理、语义层、技能和运行时上下文，但文档事实源没有同步升级。下一步不应继续新增零散 design 文档，而应先建立“当前事实源”：状态表、API 索引、模型索引、domain 索引，再把缺失的 semantic-layer/wiki/skills 质量规范补齐。

最优先修复项是 P0 三件事：更新状态文档、对齐 admin role 模型、补全当前 API/model 索引。

---

## 8. Claude Code Opus 审阅意见

| 项 | 内容 |
|---|---|
| 审阅方式 | 使用 `claude --model opus --print` 非交互审阅 |
| 审阅时间 | 2026-06-21 |
| 工具限制 | 只允许 Read/Grep/Glob/LS；未让 Claude Code 直接修改文件 |
| 审阅对象 | 本报告及仓库内相关 docs、webui/server、webui/src、semantic-layer、skills、evals |

### 8.1 总体结论：部分认同（偏认同）

报告的事实判断准确率很高。Opus 抽查的 15 项关键论断逐条命中代码/资产现状，证据扎实，结论方向（“问题不是没 spec，而是事实源与实现失同步”）成立。

但有两点需要修正：

1. 对访问治理缺口的定性偏轻。报告把它当作“admin UI 落后于 spec 的一致性问题”，实际是一个可重新引入过度授权 Agent 的写入路径安全风险，与近期 ACL 加固直接冲突。
2. 7.2 的总分与 P0 排序略偏宽松。应把访问治理写入路径安全项提到状态文档更新之前。

### 8.2 认同的关键判断

| 报告论断 | Opus 核对证据 | 结论 |
|---|---|---|
| reviewer skill 正反例相同 | `skills/reviewer/SKILL.md` 中“超市分析 → superstore_orders（非 superstore_orders）” | 认同 |
| reviewer dependency 路径失效 | 依赖写 `../superstore/references/superstore-pitfalls.md`，实际文件在 `skills/domains/superstore/pitfalls.md` | 认同 |
| access.yaml 注释过期 | `webui/config/access.yaml` 写“Phase 1: tokens 使用明文 value”，但实际 token 是 `hash: sha256:*` | 认同 |
| impl-status 与代码矛盾 | 数据库接入仍标待开发；Review API 写 `GET /api/changed`，实际是 `GET /api/diff`；Eval/Admin 后端列 `—` | 认同 |
| fs-safe 白名单 | `ALLOW=[semantic-layer,evals,skills,wiki,.ktx-ui,webui/config]`，`ALLOW_FILES=["ktx.yaml"]` | 认同 |
| eval schema 版本漂移 | superstore=v1.3，kx=v1.4，conventions=v1.4 | 认同 |
| admin 仍 legacy allow | `webui/src/lib/types.ts` 的 `Agent/AgentPatch/CreateAgentBody` 只有 `allow`，无 role/effectivePermissions；`agents.ts` 新建强制 `allow`；`AgentDetail.tsx` 编辑 allow | 认同 |
| 语义层规格 | `superstore_orders.yaml` 确为 9 measures / 3 segments / 2 joins | 认同 |
| project-overview 滞后 | 仍写 `skills/superstore/SKILL.md`、7 条 case、M0-M5、3 表/9 measures | 认同 |
| eval 旧 review 已部分修复 | coverage 模式现抛 `UNSUPPORTED_SELECTION_MODE`；`GET /api/eval/domains/:domain` 已存在 | 认同 |
| 03-api-spec 未纳入新模块 | 不含 connections/eval/admin 端点 | 认同 |
| 27 个测试文件、feature-map 把已实现能力标缺失 | 核对一致 | 认同 |

### 8.3 不认同或需修正的判断

#### 8.3.1 访问治理应升级为安全风险

原报告 2.8 把 admin 与 role spec 的背离描述为“admin UI 对齐拉低得分”。Opus 认为该定性偏轻。

`webui/server/admin/agents.ts` 的新建/patch 端点没有拒绝 `["*"]` 的校验，`webui/src/lib/types.ts` 的 `CreateAgentBody` 允许 `tables/tools = ["*"]`。因此通过 admin 写入路径可以重新签发一个 `allow: {tables:["*"], tools:["*"]}` 的全权 Agent。`access.yaml` 中被禁用的 `lisi` 正是这种配置样板。

这不是普通文档漂移，而是回归性安全缺口。应单列为最高 P0，优先级高于状态文档更新。

证据路径：

- `webui/server/admin/agents.ts`
- `webui/src/lib/types.ts`
- `webui/config/access.yaml`

#### 8.3.2 `ktx.yaml` 写回风险被低估

原报告 2.3 说“spec 未明确是否需要 dryRun/diff/confirm”。Opus 认为实际风险还包括：

- `PUT /api/connections/:connId/enabled-tables` 无 dryRun/diff。
- 无审计落盘。
- 无入参校验。
- `enabledTables` 是裸字符串数组，会直接写进 `ktx.yaml`。

对照 ACL 变更有 audit SQLite，配置写入这一类敏感操作却无痕。建议从“缺 confirm 体验”提升为“缺审计 + 缺输入校验”。

#### 8.3.3 `02-arch-spec` 技术栈漂移优先级偏高

原报告 2.2 把“技术栈表是基线/下限，应转为当前事实”列入需修正项。Opus 认为该文档已经显式记录 lockfile 解析为 React 19 / Vite 8 / TypeScript 6 / Fastify 5，因此这是已披露的漂移注记，属于 P2/cosmetic，不应与真正事实源缺口同级。

#### 8.3.4 报告自身路径引用需更精确

报告多处写 `types.ts`，实际文件是 `webui/src/lib/types.ts`。后续正式化时应使用完整路径，避免 Builder 按图索骥时落空。

### 8.4 漏掉的重要问题

1. **admin 写入路径可签发全权 Agent**。报告没有把“写路径能 mint 危险配置”作为独立风险，只谈了 role 字段缺失。
2. **proxy fail-closed 行为未被验证**。报告引用了 spec 的“reload fail-closed / role 解析失败不回退 allow”，但未核对 `acl.ts` / `mcp-proxy.ts` 是否完整实现。安全边界至少应标注“待验证”。
3. **enabled-tables 无审计/校验**。报告只提议补 UAT，未点出当前零审计、零输入校验的实现事实。
4. **整改方案存在张力**。报告结论说“不应继续新增零散 design 文档”，但 Stage B 又建议新增多个 spec。Opus 建议先做一致性自检脚本，再决定哪些规范值得固化成文档。

### 8.5 评分与优先级调整建议

评分调整：

| 项 | 原评分 | Opus 建议 | 理由 |
|---|---:|---:|---|
| 访问治理 / MCP Auth Proxy | 7.5 | 6.5 | proxy runtime spec 质量高，但 admin 写入路径能重新引入全权 Agent |
| 总分 | 7.2 | 6.8 | 状态文档与代码冲突是系统性的，一致性维度应更低 |

P0 重排建议：

1. **关闭 admin 写入路径的过度授权**：新建/patch 拒绝 `["*"]`，强制 role；legacy allow 仅只读。
2. `ktx.yaml` / `access.yaml` 写入补审计与输入校验。
3. 更新 `webui-impl-status.md`、`project-overview.md`。
4. 扩展或新建 current API/model 索引。

方法建议：

- 将原报告 Stage C 的防漂移脚本提前，与 Stage A 并行。
- route/status、API/spec、skill dependency、eval schema 版本兼容这些一致性检查，杠杆率高于继续新增多个治理 spec。

### 8.6 本报告采纳说明

本临时审计报告保留原始评分与原始排序，以上 Opus 审阅意见作为独立二次审阅结论追加。若后续将本报告转为正式整改计划，建议优先采纳 Opus 对访问治理安全风险和 P0 排序的调整。
