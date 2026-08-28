# Lucy Governed Skill System & Context Transpass Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Governed Skill System & Context Transpass Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-29 |
| 撰写人 | Claude / Codex |
| 委托人 | 张星晨 |
| 基于材料 | `lucy-skills/docs/01-spec.md`、`webui/docs/07-mcp-auth-proxy-spec.md`、`webui/docs/08-mcp-audit-question-tracing-spec.md`、`webui/docs/62-trace-evidence-kernel-spec.md`、`webui/docs/98-access-control-p0-runtime-spec.md` |
| 适用范围 | Lucy MCP Proxy (`webui/server/proxy/`)、Skill 资产格式 (`skills/`)、ACL 与审计引擎、WebUI Skill Studio 与客户端导出 |
| 输出位置 | /Users/zhangxingchen/Projects/project-lucy/webui/docs/131-governed-skill-system-and-context-transpass-spec.md |

---

## 1. 背景与核心定位

### 1.1 问题陈述
当前 Lucy 作为 Data Agent Context Compiler & Governed MCP Runtime，已经向外部 Agent（如 Claude Code, Codex, Cursor, Hermes）暴露了受控的 KTX 语义层查询工具（`sl_query`, `sl_read`）、Wiki 检索工具（`wiki_search`, `wiki_read`）以及基础 instructions 注入。

然而，在复杂真实业务场景中，仅提供“数据查询工具”与“静态字典”无法阻断模型产生以下高级语义缺陷：
1. **分析路径混乱**：面对“为什么上个月利润下滑”等模糊问题，Agent 容易陷入无序的 SQL 试错，缺乏业务专家的结构化排查 SOP。
2. **多表勾稽与统计口径失真**：例如对比率做 `avg()`、忽略退货状态过滤、或者跨表关联条件漏掉租户/公司维度。
3. **Agent 本地 Skill 离散失控**：各开发者在个人环境（如 `~/.claude/skills` 或 `.cursor/skills`）维护本地脚本，导致同名业务指标定义在不同员工的 Agent 中产生冲突，且与底层数据库重构脱节。

### 1.2 架构跃迁：从 Tool Provider 到 Governed Skill & Context Control Plane
Lucy 将 Skill 纳为一级治理资产（First-Class Governed Asset），形成 **Semantic + Wiki + Skill + Quality** 四位一体的企业级上下文底座：

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Upper Agents (Claude Code / Codex / Cursor)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    │ MCP Protocol (SSE / Streamable HTTP)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Lucy MCP Proxy (:7879)                           │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌────────────┐  │
│  │ Token / Role Auth     │  │ Skill & Table ACL     │  │ Audit Logs │  │
│  └──────────┬────────────┘  └──────────┬────────────┘  └─────▲──────┘  │
│             │                          │                     │         │
│             ▼                          ▼                     │         │
│  ┌─────────────────────────────────────────────────────────┐ │         │
│  │ MCP Protocol Rewrite & Router:                          │ │         │
│  │ • initialize: Dynamic Instructions & Skill Catalog      │ │         │
│  │ • resources/list & resources/read (lucy-skill://)       │ │         │
│  │ • prompts/list & prompts/get (SOP Workflows)            │ │         │
│  │ • tools/list & tools/call (sl_query, wiki_*, skill_*)   │─┘         │
│  └─────────────────────────────┬───────────────────────────┘           │
└────────────────────────────────┼───────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Lucy Context Compiler & Catalog                      │
│  ┌─────────────────┐ ┌─────────────────┐ ┌──────────────────────────┐  │
│  │ Semantic Models │ │ Business Wiki   │ │ Governed Skills (YAML+MD)│  │
│  │ (Measures/Grain)│ │ (Playbooks/Defs)│ │ (SOPs / Pitfalls / Rules)│  │
│  └────────▲────────┘ └────────▲────────┘ └────────────▲─────────────┘  │
│           │                   │                       │                │
│           └───────────────────┴───────────────────────┘                │
│                               │ Binds & Verified By                    │
│                      ┌────────┴────────┐                               │
│                      │ Golden Evals    │                               │
│                      │ (CI/CD Gates)   │                               │
│                      └─────────────────┘                               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. MCP 协议层与透传通道规范 (MCP Protocol Layer)

Lucy MCP Proxy (`:7879`) 统一拦截并承接 Skill 的生命周期，对外提供 4 种标准的透传通道：

### 2.1 通道 A：`initialize` 阶段动态 Skill Catalog 注入
- **请求阶段**：客户端发送 `initialize` 请求。
- **改写逻辑**：
  1. Proxy 校验 Bearer Token 得到 `userId` 和关联的 `Role`。
  2. 读取该角色有权访问的所有 Skill 的 Frontmatter 元数据（Title, Description, Triggers, Domain）。
  3. 将 Skill 索引矩阵动态编译进 `initialize.result.instructions` 中。
- **注入模板格式**：
```markdown
# Lucy Available Domain Skills (SOPs)

当用户提出特定业务问题时，请优先通过 MCP Resources (lucy-skill://) 或 Skill Tools 获取以下专家分析指南：
- [superstore-profit-breakdown]: Superstore 利润与折扣异常拆解 SOP (适用: 利润下滑/折扣率排查)
- [kx-dupont-analysis]: 柯西财务杜邦分析与三表勾稽 SOP (适用: ROE拆解/资产负债穿透)
```

### 2.2 通道 B：MCP Resources 协议规范 (按需懒加载)
针对现代 Agent 的按需上下文加载机制，Proxy 实现标准 `resources/*` 方法：

#### 1. `resources/list`
- **过滤机制**：根据当前 Token 关联的 ACL 白名单进行 Fail-Closed 过滤。
- **返回数据结构**：
```json
{
  "resources": [
    {
      "uri": "lucy-skill://superstore/profit-breakdown",
      "name": "superstore-profit-breakdown",
      "description": "Superstore 利润与折扣拆解分析 SOP，涵盖多维归因、异常大单穿透及折扣率避坑规则",
      "mimeType": "text/markdown"
    }
  ]
}
```

#### 2. `resources/read`
- **URI 校验**：严格验证 `uri` 是否符合 `lucy-skill://<domain>/<skill-slug>` 格式。
- **鉴权**：校验当前 Token 是否允许访问该 `domain` 或指定 `skill`。若无权访问，返回 JSON-RPC Error `-32003 (Forbidden: Access to skill denied)` 并记录 Audit。
- **返回内容**：直接返回经过变量替换与最新 Semantic Model 校验后的 Markdown 文本。

### 2.3 通道 C：MCP Prompts 协议规范 (工作流模版)
- **`prompts/list`**：将企业高频分析流程声明为带参模版（如 `financial_dupont_analysis`, `store_anomaly_diagnosis`）。
- **`prompts/get`**：
  - 参数：`{ "name": "superstore_profit_diagnosis", "arguments": { "start_date": "2026-01-01", "end_date": "2026-06-30", "region": "East" } }`
  - 返回：组装后的 messages 数组，自动填入时间范围、目标维度，并绑定必须调用的度量与 SQL 模板。

### 2.4 通道 D：运行时工具扩展 (`lucy_skill_search` & `lucy_skill_read`)
为了兼容不支持 MCP Resources 的纯 Tool-Call 客户端（如部分原生 LLM Agent），Proxy 注入受控的 Skill 元工具：
- **`lucy_skill_search(query: string, domain?: string)`**：语义/关键词匹配可用的 SOP 标题和触发词。
- **`lucy_skill_read(skill_name: string)`**：读取对应 Skill 的完整操作规范。

---

## 3. Skill 资产格式与语义绑定规范 (Skill Asset Schema)

### 3.1 资产目录组织
所有 Governed Skills 存放在仓库根目录 `skills/` 下，按数据域（Domain）分层：
```text
skills/
├── domains/
│   ├── superstore/
│   │   ├── profit-breakdown.skill.md
│   │   └── customer-retention.skill.md
│   └── kx_financial/
│       ├── dupont-analysis.skill.md
│       └── cashflow-audit.skill.md
└── reviewer/
    └── high-risk-financial-checklist.skill.md
```

### 3.2 Skill 文档结构标准
每个 Skill 文件必须包含严格的 YAML Frontmatter 元数据头与 Markdown 正文：

```markdown
---
name: superstore-profit-breakdown
title: Superstore 利润与折扣拆解分析 SOP
version: 1.0.0
domain: superstore
status: published # draft | published | deprecated
roles_allowed: ["*"] # 允许访问的角色列表，支持通配符
prerequisites:
  sources:
    - "mysql-aliyun.superstore_orders"
  measures:
    - "superstore_orders.profit"
    - "superstore_orders.sales"
    - "superstore_orders.discount_amount"
  wiki_docs:
    - "superstore-analysis-playbook.md"
triggers:
  - "利润下滑分析"
  - "折扣率与毛利相关性"
  - "亏损订单诊断"
eval_cases:
  - "evals/superstore/profit_drop_root_cause.yaml"
---

# 1. 业务背景与分析逻辑
当分析利润异常变动时，必须按照「三层下钻法」进行归因：
1. **第一层（区域与时间）**：按 `region` 和 `order_date(month)` 聚合，识别异动区域。
2. **第二层（品类与折扣）**：下钻至 `category` / `sub_category`，结合平均折扣深度分析。
3. **第三层（异常大单排查）**：提取亏损金额 > 500 的离群订单明细。

# 2. 强制规则与避坑指南 (Pitfalls & Non-Negotiable Rules)
1. **折扣率聚合陷阱**：严禁直接计算 `avg(discount)`，必须计算加权折扣率：
   $$\text{Weighted Discount} = \frac{\sum(\text{discount\_amount})}{\sum(\text{original\_sales})}$$
2. **退货状态排除**：所有利润统计默认必须过滤未退货订单（`return_status != 'Returned'`）。
3. **汇率统一口径**：涉及跨币种计算时必须关联 `dim_exchange_rate`。

# 3. 标准执行路径 (Recommended Step-by-Step)
- **Step 1**: 调用 `sl_query`，以 `region` 为维度聚合 `superstore_orders.profit` 和 `superstore_orders.sales`。
- **Step 2**: 针对负利润区域，调用 `sl_query` 获取 `sub_category` 的 `profit_margin` 与 `discount_depth`。
- **Step 3**: 若发现特定单品毛利严重倒挂，执行明细下钻并附加 Provenance 证据。
```

### 3.3 语义层强校验契约 (Semantic Validation Contract)
在 WebUI 编译/保存或 CI 阶段，Lucy 编译器将对 Skill 进行静态检查：
1. **Source 存在性**：`prerequisites.sources` 中的数据源必须在当前生效的 Catalog / Manifest 中存在。
2. **Measure 存在性**：`prerequisites.measures` 中的度量必须在对应 Semantic Overlay 中有明确定义。
3. **Wiki 引用校验**：引用的 `wiki_docs` 必须在 `wiki/` 目录中存在且可读。
4. **Eval 绑定要求**：处于 `published` 状态的 Skill **必须**绑定至少一个有效的 Eval 用例。

---

## 4. 企业级权限管控与全链路审计 (Governance, ACL & Audit)

### 4.1 Token / Role 级 Skill 访问控制 (Skill ACL)
扩展 `webui/server/proxy/acl.ts`，新增 Skill 级别的权限控制逻辑：

```typescript
export interface RoleSkillPolicy {
  allow_all_skills?: boolean;
  allowed_domains?: string[];
  allowed_skills?: string[]; // 例如 ["superstore/*", "kx_financial/dupont-analysis"]
  denied_skills?: string[];
}
```

- **求值规则**：
  1. 若 `denied_skills` 命中，则**立即拒绝 (Deny)**。
  2. 若 `allow_all_skills === true`，则允许。
  3. 检查 `allowed_domains` 或 `allowed_skills` 是否包含该 Skill，未明确声明则默认为拒绝（Fail-Closed 原则）。

### 4.2 审计日志增强 (`access_log` Schema Extension)
在 `.ktx-ui/audit.sqlite` 的 `access_log` 表中扩充 Skill 调用与上下文跟踪字段：

| 字段名 | 类型 | 说明 |
|---|---|---|
| `tool_category` | `VARCHAR(32)` | `data_tool` \| `wiki_tool` \| `skill_resource` \| `prompt_template` |
| `skill_uri` | `VARCHAR(255)` | 访问的 Skill URI（如 `lucy-skill://superstore/profit-breakdown`） |
| `skill_version` | `VARCHAR(32)` | 访问时 Skill 的语义版本号 |
| `active_skills_context` | `TEXT` | 当前会话注入/激活的 Skill 列表快照 |
| `policy_decision` | `VARCHAR(32)` | `allowed` \| `denied_skill_acl` \| `denied_table_acl` |

### 4.3 端到端可解释性背书 (Provenance Footer Contract)
所有上层 Agent 在遵循 Lucy Skill 完成分析后，下发的最终回答结尾必须附带全链路溯源注记：

```markdown
---
### 📊 Provenance & Compliance Verification
- **Governed by Lucy**: `v1.15` (MCP Proxy `:7879`)
- **Active Skill SOP**: `superstore-profit-breakdown (v1.0.0)`
- **Semantic Measures Used**: `superstore_orders.profit`, `superstore_orders.sales`
- **Data Freshness**: Synced at `2026-08-29 00:30:00 (Asia/Shanghai)`
- **Audit ID**: `tx_8f92a1c09e`
```

---

## 5. WebUI 资产管理、Eval 门禁与客户端同步 (WebUI & Ecosystem)

### 5.1 WebUI Skill Studio (`/skills`)
在 Lucy WebUI 新增一级/二级管理工作台：
1. **Skill 资产目录**：按 Domain 浏览、搜索、状态筛选（Draft / Published / Deprecated）。
2. **在线编辑与语法高亮**：支持 Markdown/YAML 混合编辑，集成 Semantic Measure 自动补全。
3. **实时编译校验器**：实时校验引用的表、字段、度量是否存在，高亮悬空引用（Dangling References）。
4. **运行效能仪表盘**：展示各 Skill 在全企业的调用频次（Hit Rate）、平均生成耗时、以及关联的 Bad Case 率。

### 5.2 CI/CD Eval 评测门禁 (Skill Quality Gate)
```
┌─────────────────┐      ┌─────────────────────────┐      ┌─────────────────┐
│ Skill Edit/PR   │ ───> │ Run Bound Eval Cases    │ ───> │ Gate Decision   │
│ (Markdown/YAML) │      │ (sl_query + Assertion)  │      │ Pass / Block    │
└─────────────────┘      └─────────────────────────┘      └─────────────────┘
```
- 发布前必须执行绑定的 `eval_cases`。
- 断言包括：SQL 语法正确性、正确过滤了 Pitfall 条件（如退货过滤）、返回数据非空且与 Golden Value 吻合。

### 5.3 客户端一键导出与离线同步 (Client Sync Package)
针对不同开发者的 IDE 与客户端生态，提供本地配置文件一键导出：
- **Claude Code**：导出为 `~/.claude/skills/` 资产包。
- **Cursor**：导出为 `.cursor/skills/` 或 `.cursorrules` 上下文。
- **Codex / 自研 Agent**：导出统一的标准 `.mcp.json` 挂载配置与静态 Context Pack。

---

## 6. 实施路线图 (Implementation Roadmap)

| 阶段 | 交付物 | 核心文件与范围 | 验收标准 |
|---|---|---|---|
| **Phase 1: 协议与运行时** | MCP Proxy 支持 `resources/*` 与 `prompts/*` | `webui/server/proxy/mcp-proxy.ts`, `skills-router.ts` | Agent 可通过 `resources/read` 成功读取 Skill，未授权 Token 触发 403 拦截 |
| **Phase 2: 资产加载与校验** | Skill 资产扫描器与语义校验引擎 | `webui/server/skills/loader.ts`, `validator.ts` | 启动时自动解析 `skills/` 下所有 SOP，校验 Source/Measure 引用合法性 |
| **Phase 3: 审计与链路溯源** | Audit DB 扩展与 Provenance 记录 | `webui/server/proxy/audit.ts`, `access_log` | 每次 Skill 读取均记录 `access_log`，生成 Trace Audit ID |
| **Phase 4: WebUI 管理台** | Skill Studio 界面与客户端导出功能 | `webui/src/pages/skills/*`, `SkillEditor.tsx` | WebUI 可增删改查 Skill、执行一键 Eval 门禁测试、下载客户端配置包 |
