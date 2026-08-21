# Lucy 已上线能力清单与综合打分（AICon 演讲稿素材）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 演讲过程性材料 |
| 日期 | 2026-08-21；同日 v1.1 增补 Trace / 全流程举证 / 审计专项审计 |
| 对齐框架 | AICon：问题与边界 · 架构与运行时 · 语义可信 · 安全与评测 |
| 三问锚点 | **可控 / 可信 / 可进化**（Runtime · 语义 · 治理 — 缺一不可） |
| 事实源 | `docs/vision.md`、`docs/lucy-platform-goal-checklist.md`、`docs/project-overview.md`、`docs/security-guide.md`、`webui/docs/09-lucy-r1-mcp-tool-contract.md`、`webui/docs/62-trace-evidence-kernel-spec.md`、`webui/docs/08-mcp-audit-question-tracing-spec.md`、`webui/server/trace/evidence.ts`、`webui/server/proxy/mcp-proxy.ts`、`webui/src/pages/admin/Audit.tsx`、`docs/lucy-202608-reliable-delivery-upgrade-spec.md`、`docs/access-control/gap-analysis-202608.md`（**注：2026-08-03 差距表已过时，P0 Trace 项多数已落地**）、`docs/webui-feature-map.md` |

> **一句话结论**：Lucy 已上线的是「把高风险数据任务工程化」的底座——受治理 MCP 运行时 + 语义/知识编译 + **双层审计（access_log + Trace/Evidence Kernel）** + 离线评测门禁；**不是**自助 BI、不是原生行/列级权限、不是 Agent 动作级人工确认闭环、也不是自动纠错飞轮。对关心 Trace / 全流程举证的听众：**访问链可还原已上线（约 7.8/10），司法级一站式证据包与 SQL 执行 span 仍有缺口。**

---

## 0. 综合打分（可直接上幻灯片）

评分口径：相对「企业数据 Agent 必须同时回答三问」的完整态（满分 10），不是相对竞品。

| 维度 | 分数 | 一句话 |
|---|---:|---|
| **可控**（动作如何可控） | **8.0** | Token / Role / 表级 ACL / 只读 Guardrail / **access_log + Trace 双写**已落地；缺动作级 HITL |
| **可信**（结果如何可信） | **7.0** | 统一语义层 + Wiki + Provenance 已可用；缺图谱召回与运行时 Coverage 决策闭环 |
| **可进化**（经验如何复用） | **5.5** | Context Pack / Eval / 人工回流已有；缺自动修正入库与跨任务 Skill 产品化 |
| **架构与运行时** | **7.5** | Proxy 控制面 + KTX 数据面清晰；沙箱生命周期 / 完整 endpoint 运维仍浅 |
| **安全与评测** | **7.5** | 纵深防御 + 安全候选池（Log→Eval）已有；Trace 留存清理与发布证据包 UI 仍浅 |
| **Trace / 全流程举证 / 审计（专项）** | **7.8** | 见 §A；管理员可还原「谁→工具→ACL→表→结果规模→拒绝原因」 |
| **综合** | **7.2 / 10** | **工程化底座 + 访问举证主链已上线；进化飞轮与企业 SSO/RLS 仍划界外** |

### 雷达图用权重（可选）

```text
综合 = 0.30×可控 + 0.30×可信 + 0.20×可进化 + 0.10×架构运行时 + 0.10×安全评测
     = 0.30×8.0 + 0.30×7.0 + 0.20×5.5 + 0.10×7.5 + 0.10×7.5
     ≈ 7.15 → 取 7.2
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
| 全程审计 | ✅ | access_log + `trace_events`/`evidence_events` 双写；问答轮次、配置审计、Admin「查看 Trace」抽屉、CSV 导出已上线；缺口在留存清理、权限快照深挖、自然语言问句可选 | 「访问决策链可在 Admin 还原；不是 Visual Debugger，也不是冷归档合规仓」 |

**可控小结**：风险主要靠「只读 + 白名单 + 拒绝」收敛，而不是「高风险动作等人确认后再执行」。

### 1.2 可信 — 结果如何可信？

| 检查点 | 状态 | Lucy 现状 | 演讲话术建议 |
|---|---|---|---|
| 统一语义 | ✅ | Semantic Pack（manifest + overlay：grain / measures / segments / joins）+ Knowledge Pack（Wiki / skills 文件） | 「概念进上下文是结构化的，不是靠聊天记忆」 |
| 口径正确 | 🟡 | 指标/分段/关联可维护可校验；依赖人工与 FDE/Codex 冷启动，无自动口径仲裁 | 「Lucy 承接已确认口径，不替代业务 Owner」 |
| 证据可查 | ✅/🟡 | `lucy_query` `_meta.lucy` provenance + Admin Trace 抽屉（span + policy_decision + evidence）；问句需 `lucy_begin_question` 才有 reported turn | 「答案可追溯到 source；问句级举证依赖客户端是否打 begin_question」 |

### 1.3 可进化 — 经验如何复用？

| 检查点 | 状态 | Lucy 现状 | 演讲话术建议 |
|---|---|---|---|
| 修正回流 | 🟡 | 人工改 YAML / Wiki / Eval；**安全负样本 Log→Eval 候选池已上线**（`/eval/security-candidates`）；业务 Log→Eval 明确 Deferred | 「安全侧已有回流；业务质量飞轮仍靠人工」 |
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
| 审计 | ✅ | 热存 SQLite（access_log + Trace Kernel）；问题预览有 retention purge；Trace 行数/容量常量有、**自动 purge 未落地**；对象存储冷归档非当前硬承诺 |

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
| 分级治理门禁（权限扩张 P0/P1/P2） | ✅ | Access Governance Gate 已接入 Agent/Role/Token 写入路径 |
| 复杂告警 / 日志聚合 | ❌/🔜 | 最小 observability 有；完整运维告警非当前承诺 |

### 4.3 评测闭环（离线 + 在线）

| 能力 | 状态 | 说明 |
|---|---|---|
| Eval Case 管理（WebUI） | ✅ | domains / cases / runs / compare / monitor |
| 离线 business eval / smoke gate | ✅ | release CI + P0/P1 scripts |
| Agent E2E（Hermes 等） | 🟡 | 本机 Hermes/moz 已验证；all-profile 完整证据仍待齐 |
| 安全回归 Eval | ✅/🟡 | 基线 + denied→security candidate 评审晋升已有 UI；覆盖面仍偏安全负样本 |
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
2. Trace 热库自动留存清理；permission snapshot JSON 的 Admin 深挖  
3. Risk Review / Release Readiness Evidence Package（API 有，WebUI 页不全）  
4. Skill 产品化（Editor / lucy-skills MCP）  
5. Trusted Query Pack 从「Eval+Trace」升级到「BI 查询资产摄入」  
6. SQL plan/execute / retrieval spans（类型已定义，MCP 热路径未写）  

---

## A. Trace / 全流程举证 / 审计专项（用户关心重点）

> 本节约 2026-08-21 对照**代码**复核。`docs/access-control/gap-analysis-202608.md`（2026-08-03）把 P0 Trace Kernel 标为缺失——**该差距表已过时**；Kernel、Admin Trace Read Model、Governance Gate、Security Candidates、Usage Dashboard 均已有实现。

### A.1 专项综合分：**7.8 / 10**

| 子能力 | 分 | 状态 |
|---|---:|---|
| 运行时访问审计（access_log） | 9.0 | ✅ 成熟 |
| Trace / Evidence Kernel | 8.0 | ✅ 已上线；热路径 span 类型偏 MCP/ACL |
| 问句级 / 轮次举证 | 6.5 | 🟡 依赖 `lucy_begin_question`；否则仅 inferred |
| Admin 审计工作台 | 8.0 | ✅ 调用明细 + Turns + Trace 抽屉 + Sources |
| 配置变更审计 | 8.5 | ✅ dryRun/diff + config_change_log + CSV |
| 查询侧 Provenance | 8.0 | ✅ `_meta.lucy` |
| 留存 / 脱敏 / 导出 | 6.5 | 🟡 问题预览可 purge；Trace 容量常量无自动清理；无冷归档交付 |
| 发布级一站式证据包 | 6.0 | 🟡 API + MD 有；缺完整 WebUI |
| **专项均分** | **7.8** | 访问链可还原；非司法级一站式仓 |

### A.2 双层证据架构（已上线）

```text
Agent MCP Client
    │
    ▼
Lucy MCP Proxy ──► access_log (+ sources / permission_snapshots / turns)
                 └► trace_events + evidence_events   ← Trace / Evidence Kernel
                        │
                        ▼
              Admin /admin/audit  「查看 Trace」抽屉
              + /admin/audit-sources
              + /admin/config-audit
              + /admin/usage（治理可观测）
```

| 层 | 落点 | 存什么 | 不存什么 |
|---|---|---|---|
| 热审计明细 | `.ktx-ui/audit.sqlite` → `access_log` | who/tool/tables/outcome/decision_reason/耗时/结果规模/trace_id/turn_id | 结果集明细、Token 明文 |
| Trace Kernel | 同库 `trace_events` / `evidence_events` | append-only span（mcp_tools_call、policy_decision…）+ evidence ref/hash | 原始 SQL AST、完整问句、行级样本 |
| 回答侧 | MCP `_meta.lucy` | connection/source/measures/filters/guardrails/truncation | — |
| 配置侧 | `config_change_log` | 治理/语义/wiki/eval/publish 变更 actor + diff | secrets |

关键实现：`webui/server/trace/evidence.ts`、`webui/server/proxy/mcp-proxy.ts`（`recordAudit` + `recordMcpTrace`）、`webui/server/admin/audit.ts`、`webui/src/pages/admin/Audit.tsx`（`TraceLink`）、Spec `webui/docs/62-trace-evidence-kernel-spec.md` / `08-mcp-audit-question-tracing-spec.md`。

### A.3 全流程举证：管理员今天能否还原？

问题：**谁问了什么 → 调了哪些工具 → ACL 如何裁决 → 碰了哪些表 → 结果多大 → 为何拒绝**

| 环节 | 状态 | 证据 |
|---|---|---|
| 谁（Agent / Token / Role） | ✅ | `user_id`、`token_label`、`token_hash_prefix`、`role_ids` |
| 问了什么（自然语言） | 🟡 | 仅当客户端调用 `lucy_begin_question`（reported turn + 脱敏 preview）；否则 inferred 聚类**无原文** |
| 调了哪些工具 | ✅ | `access_log.tool` + Trace `mcp_tools_call`；Turns 详情串联 |
| ACL / Policy 裁决 | ✅ | `decision_reason` + Trace `policy_decision`（allow/deny、reason、matchedRule、snapshot hash） |
| 碰了哪些 source/table | ✅ | `tables`、`access_log_sources`、`/api/admin/audit/:id/sources` |
| 结果规模 | ✅ | row/column/bytes/truncated；成功路径另有 `_meta.lucy.result` |
| 为何拒绝 | ✅ | 稳定 reason code + evidence `denied_by` |
| 权限快照复盘 | 🟡 | hash 可见；`resolved_json` 在库内，**Admin 无按 hash 深挖 API/UI** |
| SQL 计划/执行链 | ❌ | span 类型已定义（`sql_plan`/`sql_execute`/`ktx_retrieval`），**MCP 热路径未写** |
| 一页司法级证据包 | 🟡 | Release Readiness Package **API** 可出 MD；Risk Review **API** 有；**无完整专用页** |

**结论**：常规允许/拒绝的业务 MCP 调用，管理员**今天就能**在 `/admin/audit` 还原访问决策链。弱项是「自然语言问句可选」与「权限快照/SQL 深链/一站式包」。

### A.4 已上线 vs 缺口（演讲对照表）

| 能力 | 状态 | 备注 |
|---|---|---|
| access_log + CSV 导出 | ✅ | 含 decision_reason、snapshot hash |
| permission_snapshots 写入 | ✅ | 每次调用落 hash + resolved |
| lucy_begin_question / reported turns | ✅ | 问句级举证入口 |
| inferred turns | ✅ | 无 begin_question 时的聚类兜底 |
| Trace Kernel 写入（tools/call + policy） | ✅ | fail-soft：写失败不打断 MCP |
| Admin Trace 只读抽屉 | ✅ | span 拓扑 + evidence 分组 |
| Config audit | ✅ | |
| Governance Overview `/admin/usage` | ✅ | |
| Access Governance Gate | ✅ | Agent/Role/Token 写入门禁 |
| Safe Log → Security Eval | ✅ | `/eval/security-candidates` |
| Trace 自动 retention purge | ❌ | 仅有天数/行数/容量常量 |
| Admin 打开 permission snapshot JSON | ❌ | |
| MCP 热路径 SQL/retrieval spans | ❌ | |
| 完整 Visual Debugger | ❌ | 明确 Non-goal |
| Risk Review / Release Package WebUI | 🟡 | API 就绪 |
| 业务 Log→Eval 飞轮 | ❌ | Deferred |

### A.5 演讲话术（面向「最关心 Trace」的客户）

**可以说：**

1. 每次 Agent 工具调用都会留下**可查询审计**与 **append-only Trace**，拒绝原因与命中策略可解释。  
2. 管理员不必翻日志文件：在访问日志点「查看 Trace」即可看 span 与 evidence。  
3. 若评测要求「每题可回查问询 ID」，正式路径是 `lucy_begin_question` → 业务工具 → 审计回填（chatbi 100 题门禁即按此约束）。  
4. 回答侧还有 `_meta.lucy` provenance，和审计侧互补。

**不要说成：**

1. 「已有完整 OpenTelemetry / 外部 Event Store / 冷归档合规仓」——没有。  
2. 「任何对话原文永久可还原」——问句可选且脱敏，有 retention。  
3. 「能展开到每一行结果与原始 SQL AST」——热库黑名单禁止。  
4. 「发布前一键司法证据包已有完整产品页」——API/MD 级，UI 未齐。

### A.6 与旧 gap-analysis 的差异（避免演讲引用过期材料）

| 2026-08-03 gap-analysis 写法 | 2026-08-21 代码事实 |
|---|---|
| P0 Trace Kernel 缺失 | ✅ `webui/server/trace/evidence.ts` 已落地 |
| P0 policy decision 未事件化 | ✅ `policy_decision` span + evidence |
| P0 Admin 无 Trace 链 | ✅ `TraceLink` Drawer + `GET /api/admin/trace/events` |
| P1 Governance Gate 缺失 | ✅ `access-governance-gate.ts` |
| P1 Log→Security-Eval 缺失 | ✅ `eval/security-candidates.ts` + UI |
| P1 Observability Dashboard 缺失 | ✅ `/admin/usage` |
| P2 Risk / Release Package | 🟡 API + 测试有，专用页不全 |

---

## 7. 综合打分拆解（评委/听众追问备用）

| 子项 | 权重 | 得分 | 加权 |
|---|---:|---:|---:|
| 权限边界 | 0.10 | 9 | 0.90 |
| 人工确认（治理侧） | 0.05 | 6 | 0.30 |
| 人工确认（运行时 HITL） | 0.05 | 2 | 0.10 |
| 审计与 Trace | 0.10 | 8 | 0.80 |
| 统一语义 | 0.12 | 8 | 0.96 |
| 口径与 Coverage | 0.10 | 6.5 | 0.65 |
| Provenance / 证据 | 0.08 | 8 | 0.64 |
| 修正回流飞轮 | 0.08 | 5.5 | 0.44 |
| 治理入库 / Pack | 0.08 | 8.5 | 0.68 |
| 跨任务 Skill 复用 | 0.04 | 5 | 0.20 |
| Guardrail / SQL 控制链 | 0.08 | 8.5 | 0.68 |
| 离线+在线评测闭环 | 0.07 | 7 | 0.49 |
| 部署与运行时成熟度 | 0.05 | 7.5 | 0.38 |
| **合计** | **1.00** | — | **≈ 7.22 → 7.2** |

**评级标签（演讲可用）**：`B+ / 生产可用底座（访问举证主链已通）`  
**含义**：可控与访问举证已过「能交付、能解释拒绝」门槛；可进化与企业级身份/细粒度权限仍勿过度承诺。

---

## 8. 建议的 30 秒电梯稿

> Lucy 今天上线的不是又一个 Chat 入口，而是把高风险数据任务工程化：  
> **Runtime** 上，Agent 只能走受治理 MCP，表级权限、只读 Guardrail；每次调用双写 **access_log + Trace**，管理员可还原谁调了什么、碰了哪张表、为何被拒。  
> **语义** 上，指标与口径以 Semantic Layer + Wiki 进上下文，查询带 provenance。  
> **治理** 上，修正进配置包、安全负样本可回流 Eval。  
> 我们不做跨源联邦、原生行级权限、SSO 多租户，也不假装有司法级一站式证据仓——先把**可解释的访问链**立住。  
> **综合 7.2/10；Trace/审计专项 7.8/10。**

---

## 9. 引用与免责

- 本清单反映仓库文档与实现状态（截至材料整理日），具体客户环境以该环境的 smoke / eval / audit 证据为准。  
- 「已上线」指产品能力可交付路径，不等于每个客户域都已跑满 Hermes 95% gate。  
- 若演讲需改分数口径（例如只评 R1 受控数据服务、或只评某一客户 POC），应单列权重表，避免与本文综合分混用。  
- 引用 202608 gap-analysis 时必须注明其 P0 Trace 段已过时，以本文件 §A 与 `webui/server/trace/evidence.ts` 为准。
