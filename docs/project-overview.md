# KTX Project 项目概览

> 本地自服务数据分析 Agent 栈
> 目标：将 Claude Code / Codex 对业务数据问题的问答精准率提升至 95%
> 数据库：Aliyun RDS MySQL 8.0.34 · 更新：2026-06-17

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                          用 户 问 题                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CLAUDE.md（加载器）                                                  │
│  · 查询优先级强制链（semantic layer first → ref docs → raw SQL last） │
│  · 表路由规则（dataforai.superstore_* 三表）                         │
│  · 指标口径白名单（禁止 AVG(discount)、AVG(profit/sales) 等）         │
│  · Reviewer 触发条件（财务/跨表 JOIN/领导汇报）                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐
│  Warehouse      │  │  Superstore     │  │  Analytics Reviewer     │
│  Knowledge Skill│  │  Domain Skill   │  │  Skill                  │
│                 │  │                 │  │                         │
│  路由器          │  │  领域知识        │  │  高风险审查（9项清单）    │
│  三步优先级链    │  │  grain/measures │  │  按需触发，非强制串行    │
│  表路由规则      │  │  7个 Pitfalls   │  │                         │
│  指标政策        │  │  折扣策略        │  │                         │
└────────┬────────┘  └────────┬────────┘  └────────────┬────────────┘
         │                   │                         │
         └──────────┬────────┘                         │
                    ▼                                  │
┌─────────────────────────────────────────────────────┴───────────────┐
│  Layer 2 · 真相源层                                                   │
│                                                                      │
│  ┌──────────────────────────┐   ┌──────────────────────────────┐    │
│  │  KTX Semantic Layer       │   │  Reference Docs              │    │
│  │  ─────────────────────   │   │  ──────────────────────────  │    │
│  │  _schema/dataforai.yaml  │   │  warehouse/references/        │    │
│  │  · superstore_orders     │   │  · table-routing.md           │    │
│  │    - 30 columns          │   │  · metrics-policy.md          │    │
│  │    - human overrides     │   │                               │    │
│  │      discount / profit   │   │  superstore/references/       │    │
│  │  superstore_orders.yaml  │   │  · superstore-pitfalls.md     │    │
│  │  · 9 measures            │   │    （7 个已知错误模式）        │    │
│  │  · 3 segments            │   │  · discount-policy.md         │    │
│  │  · 2 joins               │   │    （折扣字段完整说明）        │    │
│  └──────────────────────────┘   └──────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1 · 数据层                                                     │
│                                                                      │
│  Aliyun RDS MySQL 8.0.34                                             │
│  · dataforai.superstore_orders   10,194 行  （Tableau 超市 4 年）    │
│  · dataforai.superstore_returns    296 行                            │
│  · dataforai.superstore_people       6 行                            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 4 · 验证层（发布门禁）                                         │
│                                                                      │
│  evals/superstore/eval/superstore-eval-cases.yaml                     │
│  · 7 条 Eval Case（折扣 / 订单数 / 利润率 / is_deleted）             │
│  · forbidden_sql_pattern 防止换一种方式写错                           │
│  · snapshot_date 锚定快照，避免 live data 漂移                        │
│                                                                      │
│  纠错闭环（运营规范）：用户纠错 → KTX measure → Ref Doc → Reviewer   │
│                                  → Eval Case（24h 内完成）           │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  WebUI 治理工作台（webui/）                                           │
│                                                                      │
│  Catalog      · 浏览所有表、字段、measure、join、freshness            │
│  TableEditor  · 编辑 grain/measures/segments/joins，保存前 diff       │
│  JoinEditor   · 管理跨表关系，候选列表来自 KTX 关系检测               │
│  WikiEditor   · 编辑 evals/ 下的 Reference Docs                       │
│  Review       · 提交前人工审核语义变更                                │
│                                                                      │
│  技术栈：React 19 + Vite 8 + TypeScript 6 + Fastify 5               │
│  当前进度：M0–M5 全部完成，30 项测试通过                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、精准率数据

| 状态 | 精准率 |
|------|-------:|
| 无任何 Skill（仅裸 SQL） | < 21% |
| 有 Semantic Layer（无 Skill） | ~ 45% |
| 有 Semantic Layer + Skills | **> 95%** |

来源：Anthropic 自服务数据分析消融实验（[blog post](https://claude.com/blog/how-anthropic-enables-self-service-data-analytics-with-claude)）

---

## 三、目录结构

```
project-lucy/
├── CLAUDE.md                          ← Claude Code 自动加载的 Skill 入口
├── ktx.yaml                           ← KTX 连接配置（RDS / 表白名单 / LLM）
│
├── semantic-layer/mysql-aliyun/
│   ├── _schema/
│   │   ├── dataforai.yaml             ← KTX 扫描生成（含 human override）
│   ├── superstore_orders.yaml         ← 手工 overlay（9 measures / 3 segments / 2 joins）
│
├── skills/
│   ├── warehouse/
│   │   ├── SKILL.md                   ← Knowledge Skill（路由器）
│   │   └── references/
│   │       ├── table-routing.md       ← dataforai 表选择规则
│   │       └── metrics-policy.md      ← 聚合口径强制规范
│   ├── superstore/
│   │   ├── SKILL.md                   ← Superstore 领域 Skill
│   │   └── references/
│   │       ├── superstore-pitfalls.md ← 7 个已知错误模式
│   │       └── discount-policy.md     ← 折扣字段完整说明
│   └── reviewer/
│       └── SKILL.md                   ← 9 项高风险审查清单
│
├── evals/
│   ├── global/                        ← 跨领域公共文档
│   └── superstore/
│       └── eval/
│           └── superstore-eval-cases.yaml  ← 8 条 Eval Case
│
├── webui/                             ← 治理工作台（M0–M5 完成）
│   ├── src/pages/
│   │   ├── Catalog.tsx
│   │   ├── TableEditor.tsx
│   │   ├── JoinEditor.tsx
│   │   ├── WikiEditor.tsx
│   │   └── Review.tsx
│   ├── server/                        ← Fastify 5 API
│   └── docs/                          ← 技术设计文档（ADR-01~10）
│
└── docs/
    └── project-overview.md            ← 本文件
```

---

## 四、分模块功能介绍

### 4.1 KTX Semantic Layer（语义事实源）

**职责**：定义"什么是对的"。KTX 将 MySQL schema 转换为可检索的语义事实，供 Claude 在回答问题时优先查询。

**关键文件**：

| 文件 | 作用 |
|------|------|
| `ktx.yaml` | 声明数据库连接、启用表白名单、LLM 后端（claude-code / sonnet） |
| `_schema/dataforai.yaml` | KTX 扫描生成，含 AI 描述 + human override（discount / profit 聚合规则） |
| `superstore_orders.yaml` | 手工 overlay，定义 grain / 9 measures / 3 segments / 2 joins |

**核心 KTX 工具**：

```bash
ktx ingest mysql-aliyun   # 扫描 schema，生成/更新 _schema/*.yaml
ktx sl list               # 列出所有语义源（显示 measures 数量）
ktx sl validate <table>   # 验证 overlay 语法正确
ktx sl query <question>   # 用自然语言查询（通过 MCP）
ktx wiki search <keyword> # 检索 wiki / reference docs
```

**已定义 Measures（superstore_orders）**：

| Measure | 公式 |
|---------|------|
| `total_sales` | `SUM(sales)` |
| `total_profit` | `SUM(profit)` |
| `profit_margin` | `SUM(profit) / NULLIF(SUM(sales), 0)` |
| `weighted_discount` | `SUM(discount * sales) / NULLIF(SUM(sales), 0)` |
| `order_count` | `COUNT(DISTINCT order_id)` |
| `customer_count` | `COUNT(DISTINCT customer_id)` |
| `avg_order_value` | `SUM(sales) / NULLIF(COUNT(DISTINCT order_id), 0)` |
| `total_quantity` | `SUM(quantity)` |
| `loss_row_count` | `SUM(CASE WHEN profit < 0 THEN 1 ELSE 0 END)` |

---

### 4.2 Skills（过程控制器）

**职责**：定义"怎样才能稳定用对"。Skills 是从 21% 到 95% 精准率的决定性变量。

**加载机制**：`CLAUDE.md` 在项目根目录，Claude Code 启动时自动注入。Skills 权威源在 `skills/`，CLAUDE.md 是物化的加载器（`publish_targets: claude-code`）。

**三类 Skill**：

#### Knowledge Skill（`skills/warehouse/SKILL.md`）
顶层路由器，强制三步优先级：
1. `ktx sl read` 查语义层
2. `ktx wiki search` 查 Reference Docs
3. raw SQL（最后手段，须标注假设）

配套 Reference Docs：
- `table-routing.md`：定义 `dataforai.superstore_*` 三表选择规则
- `metrics-policy.md`：折扣率 / 利润率 / 订单数 / 客单价强制口径

#### Superstore Domain Skill（`skills/superstore/SKILL.md`）
超市领域专属知识，包含 Quick Reference、Entity Grain、Dimensions、Common Query Patterns。

配套 Reference Docs：
- `superstore-pitfalls.md`：7 个已知错误模式（含实测数值证明）
- `discount-policy.md`：折扣字段完整说明（含简单均值 vs 加权均值的数值对比）

#### Analytics Reviewer Skill（`skills/reviewer/SKILL.md`）
9 项审查清单，在财务指标 / 跨表 JOIN / 领导汇报等高风险场景前触发。发现问题时停止、重写、重执行、在 Provenance Footer 注明修正。

---

### 4.3 WebUI 治理工作台（`webui/`）

**职责**：降低语义层和 Reference Docs 的维护成本，支持非工程师参与治理。

**技术栈**：React 19 + Vite 8 + TypeScript 6 + Fastify 5，运行在本地 3001 端口。

**当前页面（M0–M5 全部完成）**：

| 页面 | 路径 | 功能 |
|------|------|------|
| Catalog | `/` | 浏览所有 schema / 表 / 字段 / measure，显示完整度和 eval 覆盖率 |
| TableEditor | `/table/:id` | 编辑 grain / measures / segments，保存前显示 YAML diff，保存后触发 validate |
| JoinEditor | `/joins/:table` | 管理跨表关系，候选列表来自 KTX 关系检测结果 |
| WikiEditor | `/evals/:page` | 编辑 `evals/` 下的 Reference Docs（支持 frontmatter + Markdown） |
| Review | `/review` | 人工审核待提交的语义变更，支持 diff 预览 |

**文件安全网关**（`server/fs-safe.ts`）：

```
ALLOW:  semantic-layer/  evals/  .ktx-ui/
DENY:   .ktx/secrets/  raw-sources/  .git/
```

**启动方式**：

```bash
cd project-lucy/webui
npm install
npm run dev        # 启动 Vite 前端（3000 端口）
npm run server     # 启动 Fastify API（3001 端口）
```

**子模块文档索引**：webui 的架构 / API spec / 数据模型 / 导航 IA 见 [`../webui/docs/`](../webui/docs/)（`01-architecture` ~ `06-navigation-ia`）；M0–M5 执行包 `webui/docs/codex/` 已完工归档，不再领取。

---

### 4.4 Eval & Ops（质量门禁）

**职责**：证明精准率"仍然"为真，而不是一次性达标。Eval 是 Skill / 语义变更的发布前门禁。

**当前 Eval Cases**（`evals/superstore/eval/superstore-eval-cases.yaml`）：

| Case ID | 测试重点 | 关键 forbidden_pattern |
|---------|---------|----------------------|
| `superstore-discount-001` | 整体加权折扣率 | `AVG(discount)` |
| `superstore-discount-002` | 按品类折扣率 | `AVG(discount)` |
| `superstore-discount-003` | 高折扣段利润率 | `AVG(discount)` + `AVG(profit/sales)` |
| `superstore-ordercount-001` | 总订单数 | `COUNT(*)` |
| `superstore-ordercount-002` | 按区域订单数 | `COUNT(*)` |
| `superstore-profit-001` | 整体利润率 | `AVG(profit/sales)` + `WHERE profit > 0` |
| `superstore-filter-001` | is_deleted 过滤 | 无（验证过滤是否存在） |

**每条 Eval 字段**：
- `required_sql_pattern`：SQL 中必须出现的模式（正确公式的关键片段）
- `forbidden_sql_pattern`：SQL 中禁止出现的模式（错误写法）
- `expected_result`：预期结果（锚定到 batch_id 快照）
- `snapshot_date`：锚定日期，防止 live data 漂移导致 expected_result 失效

**纠错闭环（运营规范）**：

```
用户指出错误
    │
    ├─▶ 更新 KTX measure（修正公式）
    ├─▶ 更新 Reference Doc（补充 Gotcha）
    ├─▶ 更新 Reviewer Skill（增加拦截规则）
    └─▶ 新增 Eval Case（forbidden_sql_pattern 覆盖该错误）
                                  ↑ 24 小时内完成
```

---

## 五、典型使用方法

### 场景 A：数据问答（Claude Code）

在 `project-lucy/` 目录下启动 Claude Code，`CLAUDE.md` 自动注入：

```
Q: superstore_orders 的加权平均折扣率是多少？

Claude 执行路径：
1. CLAUDE.md 注入 → 知道要先查 KTX semantic layer
2. ktx sl read superstore_orders → 找到 weighted_discount measure
3. 生成 SQL: SUM(discount * sales) / NULLIF(SUM(sales), 0)
4. 执行 → 结果 13.98%
5. 输出 + Provenance Footer
   Source tier: semantic layer
   Tables: dataforai.superstore_orders
   Measures: weighted_discount
```

### 场景 B：语义层编辑（WebUI）

```bash
cd project-lucy/webui && npm run dev && npm run server

# 浏览器打开 http://localhost:3000
# → Catalog 查看 superstore_orders 的 9 个 measures
# → TableEditor 编辑 weighted_discount 的 description
# → 保存前 diff 预览确认变更
# → validate 通过后提交
```

### 场景 C：新增 Eval Case（新错误出现后）

```yaml
# 追加到 evals/superstore/eval/superstore-eval-cases.yaml
- id: superstore-new-001
  question: <用户问的问题>
  forbidden_sql_pattern:
    - <发现的错误写法>
  required_sql_pattern:
    - <正确写法的关键片段>
  expected_result:
    <metric>: <value>
  snapshot_date: <今天日期>
```

### 场景 D：新增领域（扩展到其他数据库）

```bash
# 1. 在 ktx.yaml 的 enabled_tables 追加新表
# 2. ktx ingest mysql-aliyun
# 3. 审核生成的 _schema/*.yaml，添加 human override
# 4. 创建 per-table overlay YAML（measures / segments / joins）
# 5. 在 skills/ 创建新领域 Skill 目录
# 6. 更新 CLAUDE.md 的路由规则
# 7. 写对应的 Eval Case
```

---

## 六、当前状态与下一步

| 组件 | 状态 |
|------|------|
| KTX Semantic Layer — dataforai | **完成**（3 表 / 9 measures / human override） |
| Skills — warehouse / superstore / reviewer | **完成**（3 类 Skill + 5 份 Reference Docs） |
| CLAUDE.md（加载器） | **完成** |
| Eval Cases — superstore | **完成**（7 条，覆盖 4 类高危模式） |
| WebUI — M0~M5 | **完成**（30 项测试通过） |
| WebUI — M6 SkillsEditor | 待开发（`skills/` 编辑页） |
| MySQL COMMENT 补全 | 待执行（`discount` / `profit` 字段级注释） |
| Ops Dashboard | 待规划（需遥测数据源先建立） |

---

*Claude Sonnet 4.6 · 2026-06-17 · KTX Project v1.0*
