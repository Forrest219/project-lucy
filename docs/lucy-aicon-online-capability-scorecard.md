# Lucy 已上线能力清单与综合打分（AICon 演讲稿素材）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 演讲过程性材料（inbox，可删） |
| 日期 | 2026-08-21 |
| 对齐框架 | AICon：问题与边界 · 架构与运行时 · 语义可信 · 安全与评测 |
| 三问锚点 | **可控 / 可信 / 可进化**（Runtime · 语义 · 治理 — 缺一不可） |
| 事实源 | `docs/vision.md`、`docs/lucy-platform-goal-checklist.md`、`docs/project-overview.md`、`docs/security-guide.md`、`webui/docs/09-lucy-r1-mcp-tool-contract.md`、`docs/lucy-202608-reliable-delivery-upgrade-spec.md`、`docs/access-control/gap-analysis-202608.md`、`docs/webui-feature-map.md` |

> **一句话结论**：Lucy 已上线的是「把高风险数据任务工程化」的底座——受治理 MCP 运行时 + 语义/知识编译 + 表级权限与审计 + 离线评测门禁；**不是**自助 BI、不是原生行/列级权限、不是 Agent 动作级人工确认闭环、也不是自动纠错飞轮。

---

## 0. 综合打分（可直接上幻灯片）

评分口径：相对「企业数据 Agent 必须同时回答三问」的完整态（满分 10），不是相对竞品。

| 维度 | 分数 | 一句话 |
|---|---:|---|
| **可控**（动作如何可控） | **7.5** | Token / Role / 表级 ACL / 只读 Guardrail / 审计已硬落地；缺动作级 HITL 与统一 Trace 证据核 |
| **可信**（结果如何可信） | **7.0** | 统一语义层 + Wiki + Provenance 已可用；缺图谱召回与运行时 Coverage 决策闭环 |
| **可进化**（经验如何复用） | **5.5** | Context Pack / Eval / 人工回流已有；缺自动修正入库与跨任务 Skill 产品化 |
| **架构与运行时** | **7.5** | Proxy 控制面 + KTX 数据面清晰；沙箱生命周期 / 完整 endpoint 运维仍浅 |
| **安全与评测** | **7.0** | 纵深防御骨架与离线门禁强；在线告警、安全 Eval 候选池、发布证据包仍在补 |
| **综合** | **7.0 / 10** | **工程化底座已上线；治理可信主线可用；进化飞轮与企业 SSO/RLS 仍划界外或进行中** |

### 雷达图用权重（可选）

```text
综合 = 0.30×可控 + 0.30×可信 + 0.20×可进化 + 0.10×架构运行时 + 0.10×安全评测
     = 0.30×7.5 + 0.30×7.0 + 0.20×5.5 + 0.10×7.5 + 0.10×7.0
     ≈ 6.95 → 取 7.0
```

### 状态图例（全表通用）

| 标记 | 含义 |
|---|---|
| ✅ 已上线 | 有实现 + 有发布/验收证据或日常可交付路径 |
| 🟡 部分上线 | 有实现，但证据不全 / 仅内部 / 能力缩水 |
| ❌ 明确不支持 | 产品边界 / Non-goal，演讲应主动划界 |
| 🔜 规划中 | Spec/Plan 已有，未作为当前上线承诺 |

---

## 1. 问题与边界：企业数据 Agent 的九个检查点

对齐演讲「可控 / 可信 / 可进化」九格。

### 1.1 可控 — 动作如何可控？

| 检查点 | 状态 | Lucy 现状 | 演讲话术建议 |
|---|---|---|---|
| 权限边界 | ✅ | Role-first；tool / connection / table（及 view）级 ACL；`tools/list` 与 `tools/call` fail-closed；R1 exact 6-tool 面可锁定 | 「授权发生在运行时，不靠 prompt」 |
| 人工确认 | 🟡 | **治理侧**有：配置 dryRun/diff、发布工作台校验门禁、Wiki/语义保存预检。**Agent 运行时**无动作级 HITL（查询被拒即拒，不弹人审） | 「人在环在发布与权限变更，不在每次取数」 |
| 全程审计 | 🟡→✅ | access_log、问答轮次（`lucy_begin_question`）、配置审计、CSV 导出已上线；202608 Trace/Evidence Kernel 仍是差距主线 | 「能回答谁问了什么、查了哪张表、为何拒绝；完整证据链还在加固」 |

**可控小结**：风险主要靠「只读 + 白名单 + 拒绝」收敛，而不是「高风险动作等人确认后再执行」。

### 1.2 可信 — 结果如何可信？

| 检查点 | 状态 | Lucy 现状 | 演讲话术建议 |
|---|---|---|---|
| 统一语义 | ✅ | Semantic Pack（manifest + overlay：grain / measures / segments / joins）+ Knowledge Pack（Wiki / skills 文件） | 「概念进上下文是结构化的，不是靠聊天记忆」 |
| 口径正确 | 🟡 | 指标/分段/关联可维护可校验；依赖人工与 FDE/Codex 冷启动，无自动口径仲裁 | 「Lucy 承接已确认口径，不替代业务 Owner」 |
| 证据可查 | 🟡 | `lucy_query` `_meta.lucy` provenance；回答要求附 connection/source/measure/filter/freshness；Admin 审计可回查问询 ID | 「答案可追溯到 source，不等于司法级证据链已完备」 |

### 1.3 可进化 — 经验如何复用？

| 检查点 | 状态 | Lucy 现状 | 演讲话术建议 |
|---|---|---|---|
| 修正回流 | 🟡 | 人工改 YAML / Wiki / Eval；安全负样本 Log→Eval 为 202608 P1，业务 Log→Eval 明确 Deferred | 「修正靠治理入库，不是模型自动学习」 |
| 治理入库 | ✅ | `customer-config/` 包：semantic-layer、wiki、evals、skills、access.yaml；Publish Workbench + 版本化变更审计 | 「资产是文件包，可 Git、可复验」 |
| 跨任务复用 | 🟡 | Skills 以仓库文件存在，可被 Agent 显式读取；**无 Skill Editor**；`lucy-skills` MCP 仍为 spec | 「程序性知识可复用，但还不是产品化 Skill 平台」 |

---

## 2. 架构与运行时：已上线 vs 未承诺

| 能力 | 状态 | 说明 |
|---|---|---|
| Data Agent Ops Control Plane（WebUI） | 🟡 | 语义/Wiki/连接/发布/Eval/Admin 已实现；客户标准入口仍偏 Docker headless + 配置包 |
| Lucy MCP Proxy（控制面） | ✅ | Bearer Token、ACL、instructions 注入、工具改写/转发、审计 |
| KTX bundled runtime（数据面） | ✅ | 镜像 pin KTX；Agent 不直连库 |
| R1 工具契约 `lucy_*` ×6 | ✅ | catalog / read_source / query / explain_query / freshness / begin_question |
| Legacy 工具面 `sl_*` / `wiki_*` 等 | 🟡 | 兼容/内部仍在；R1 发布 token 应锁 exact 面 |
| Role-aware instructions | ✅ | initialize 按 effective permissions 动态生成 |
| Docker Compose 交付 | ✅ | 客户标准路径 |
| Kubernetes / Helm 单副本 | ✅ | 2026-08-03 起 supported baseline；**HA / 自动扩缩容 ❌** |
| Endpoint 生命周期管理 UI | 🟡 | 配置展示与复制有；启停/轮换/健康运维 UI 不全 |
| Agent 侧「沙箱生命周期」产品化 | ❌/🔜 | 有 DB sandbox 连接场景与 MCP Playground；**无**完整 Agent 沙箱编排产品叙事 |
| 控制面收敛、数据面执行 | ✅ | 与演讲架构主张一致，可作为主架构图 |

---

## 3. 语义可信：四要素与飞轮对照

| 演讲概念 | 状态 | Lucy 映射 |
|---|---|---|
| 语义四要素（概念/关系/指标/维度） | ✅ | 表描述、joins、measures、dimensions/segments；字段 role/visibility 产品化编辑仍属后续 |
| 统一语义层 | ✅ | `_schema` manifest + overlay；启用范围与 Semantic Coverage 对齐（Spec 104） |
| 冷启动构建 | 🟡 | Ingest / Manifest 上传 / 发布工作台 / 外部 Codex·技能包辅助；**FDE Copilot Deferred** |
| 图谱召回 | ❌ | 无企业知识图谱产品；召回主路径是 `wiki_search` + semantic catalog |
| Coverage 决策 | 🟡 | Overview / Catalog 有语义覆盖与完成度运营指标；**不是**运行时「能否回答」自动裁决器 |
| 治理飞轮 | 🟡 | 人工修正 → 入库 → Eval 回归 半闭环；自动业务飞轮未上线 |

### Context Pack 完成度（演讲可用小表）

| Pack | 状态 | 备注 |
|---|---|---|
| Semantic Pack | ✅ | 主交付物 |
| Knowledge Pack | ✅ | Wiki 强；Skill 文件化 |
| Query Pack | 🟡 | Eval + audit trace 打底；BI trusted query ingestion 后续 |
| Quality Pack | 🟡 | Eval + security baseline + release gate；在线质量告警仍浅 |

---

## 4. 安全与评测

### 4.1 安全三要素（建议对齐：身份 · 授权 · 审计）

| 项 | 状态 | 说明 |
|---|---|---|
| 身份 | 🟡 | Service Account + Token 手动；**无 SSO/OIDC/LDAP** |
| 授权 | ✅ | Role-first ACL；默认 deny 危险工具（如 `sql_execution`、`memory_ingest`） |
| 审计 | ✅/🟡 | 热存 SQLite 审计；冷归档对象存储愿景未作为当前交付硬承诺 |

### 4.2 纵深防御 / SQL 控制链 / 敏感分级

| 能力 | 状态 | 说明 |
|---|---|---|
| Agent 不直连数据库 | ✅ | 经 Proxy + 只读账号 |
| 禁止 DML/DDL | ✅ | 产品边界 + Guardrail |
| 禁止/限制 raw SQL | ✅ | R1 默认 `rawSqlAllowed: false`；ACL `raw_query_forbidden` |
| 行数 / 超时 / 并发限制 | ✅ | `lucy_query` guardrail metadata |
| 表级敏感隔离 | ✅ | enabled_tables + ACL；不可见资产不进 catalog/instructions |
| 敏感元数据防护 | ✅ | secrets 不回传；审计截断/脱敏规则存在 |
| 列级 / 行级权限 / 动态脱敏 | ❌ | 明确 Non-goal；可用 VIEW-as-pseudo-table **变通**（如区域视图） |
| Dynamic RLS / CLS | ❌ | 202608 已移出 active scope |
| 分级治理门禁（权限扩张 P0/P1/P2） | 🔜 | 202608 P1 |
| 复杂告警 / 日志聚合 | ❌/🔜 | 最小 observability 有；完整运维告警非当前承诺 |

### 4.3 评测闭环（离线 + 在线）

| 能力 | 状态 | 说明 |
|---|---|---|
| Eval Case 管理（WebUI） | ✅ | domains / cases / runs / compare / monitor |
| 离线 business eval / smoke gate | ✅ | release CI + P0/P1 scripts |
| Agent E2E（Hermes 等） | 🟡 | 本机 Hermes/moz 已验证；all-profile 完整证据仍待齐 |
| 安全回归 Eval | 🟡 | 基线有；denied→P0 case 候选池为 202608 |
| 在线准确率趋势 + 告警 | 🟡 | Monitor 页有；「变更自动触发 + 告警闭环」未达愿景全量 |
| Hermes ≥95% QA Accuracy Gate | 🟡 | R1 runbook/门禁设计存在；按主题域举证，非泛化 NL 承诺 |
| chatbi_intl / Superstore / KX 等题集 | ✅/🟡 | 多域资产在仓；完整 LLM 批跑依赖 agent/secret 环境 |

---

## 5. 数据源 · 接入 · 客户端（产品边界清单）

| 能力 | 状态 |
|---|---|
| MySQL | ✅ verified |
| PostgreSQL | ✅ verified（含 demo smoke） |
| StarRocks（MySQL wire 只读） | 🟡 gated；live certification 前不进 release verified matrix |
| Doris（R1 目标源叙事） | 🟡 方案/契约层；按客户环境举证 |
| Oracle | ❌ roadmap candidate |
| 跨源联邦 Join | ❌ |
| 写库 / DML | ❌ |
| BI 可视化 / 人类 Dashboard | ❌（Lucy 不替代 BI） |
| SaaS 多租户 | ❌ |
| MCP Client：Claude Code / Codex / Openclaw / Hermes / Cursor | ✅（2026-06-24 五客户端验证） |
| 其他 MCP Client | ❌ 未进矩阵即不宣称支持 |

---

## 6. 「支持 / 不支持」演讲一页版（推荐直接投影）

### 已上线（可以说「今天就能用」）

1. 受治理 MCP Runtime：鉴权、表级 ACL、只读查询、拒绝 raw SQL、审计留痕  
2. 语义与知识编译：Semantic Layer + Wiki + 发布校验 / Reindex  
3. Agent 接入：五客户端 + Onboarding 配置复制  
4. 运维控制台：连接、语义覆盖、Eval、Agent/Role/Token、访问/配置审计  
5. 交付形态：Docker Compose；K8s/Helm 单副本 baseline  

### 明确不支持（建议主动立边界）

1. 跨源联邦查询  
2. 原生行级 / 列级权限与动态脱敏（VIEW 变通除外）  
3. SSO / 多租户 SaaS  
4. 对业务库的写操作  
5. 内建 BI 报表与口径仲裁流程  
6. Agent 每次高风险动作的人机确认闸门  
7. 知识图谱召回与自动业务纠错飞轮  

### 部分上线 / 进行中（可以说「方向对，证据还在补」）

1. StarRocks live certification  
2. 统一 Trace / Evidence 与发布证据包（202608）  
3. 在线质量告警与安全 Eval 候选池  
4. Skill 产品化（Editor / lucy-skills MCP）  
5. Trusted Query Pack 从「Eval+Trace」升级到「BI 查询资产摄入」  

---

## 7. 综合打分拆解（评委/听众追问备用）

| 子项 | 权重 | 得分 | 加权 |
|---|---:|---:|---:|
| 权限边界 | 0.10 | 9 | 0.90 |
| 人工确认（治理侧） | 0.05 | 6 | 0.30 |
| 人工确认（运行时 HITL） | 0.05 | 2 | 0.10 |
| 审计与 Trace | 0.10 | 7 | 0.70 |
| 统一语义 | 0.12 | 8 | 0.96 |
| 口径与 Coverage | 0.10 | 6.5 | 0.65 |
| Provenance / 证据 | 0.08 | 7 | 0.56 |
| 修正回流飞轮 | 0.08 | 4.5 | 0.36 |
| 治理入库 / Pack | 0.08 | 8.5 | 0.68 |
| 跨任务 Skill 复用 | 0.04 | 5 | 0.20 |
| Guardrail / SQL 控制链 | 0.08 | 8.5 | 0.68 |
| 离线+在线评测闭环 | 0.07 | 6.5 | 0.46 |
| 部署与运行时成熟度 | 0.05 | 7.5 | 0.38 |
| **合计** | **1.00** | — | **≈ 6.93 → 7.0** |

**评级标签（演讲可用）**：`B+ / 生产可用底座`  
**含义**：可控与可信已过「能交付给 Agent 用」的门槛；可进化与企业级身份/细粒度权限仍是下一阶段叙事，不要在本场过度承诺。

---

## 8. 建议的 30 秒电梯稿

> Lucy 今天上线的不是又一个 Chat 入口，而是把高风险数据任务工程化的三件套：  
> **Runtime** 上，Agent 只能走受治理 MCP，表级权限、只读 Guardrail、审计全有；  
> **语义** 上，指标与口径以 Semantic Layer + Wiki 进上下文，查询带 provenance；  
> **治理** 上，修正进配置包、回归进 Eval。  
> 我们刻意不做跨源联邦、原生行级权限、SSO 多租户和自动纠错飞轮——先把边界立住，再谈进化。  
> **综合打分 7.0/10：底座已上线，飞轮与细粒度企业权限仍是明确边界。**

---

## 9. 引用与免责

- 本清单反映仓库文档与实现状态（截至材料整理日），具体客户环境以该环境的 smoke / eval / audit 证据为准。  
- 「已上线」指产品能力可交付路径，不等于每个客户域都已跑满 Hermes 95% gate。  
- 若演讲需改分数口径（例如只评 R1 受控数据服务、或只评某一客户 POC），应单列权重表，避免与本文综合分混用。
