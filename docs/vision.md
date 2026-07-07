# Lucy 产品愿景

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 产品愿景 |
| 文档类型 | Design |
| 版本 | v1.2 |
| 撰写日期 | 2026-06-18；v1.1 更新 2026-06-22；v1.2 更新 2026-07-06（统一 Lucy 产品定位为 data agent context compiler + governed MCP runtime） |
| 撰写人 | Claude |
| 委托人 | zhangxingchen |
| 基于材料 | 用户产品愿景输入、Anthropic 自助数据分析架构参考、project-lucy 现状 |
| 适用范围 | Lucy 产品后续开发、需求拆解与评审的基线文档 |
| 输出位置 | /Users/zhangxingchen/Projects/project-lucy/docs/vision.md |

---

## 1. 产品定位

Lucy 是面向中小企业的 **data agent context compiler + governed MCP runtime**：
把数据库、BI、文档、人工口径编译成 Agent 可安全使用、可审计、可回归的数据服务。

中文产品口径：Lucy 是面向中小企业的 **data agent 上下文编译器与受治理 MCP 运行时**。它不试图复制 OpenAI 内部完整数据平台，而是把中小企业已有的数据库、语义定义、业务知识、可信查询与质量用例整理成可交付给 Claude Code、Codex、Hermes、Cursor 等 Agent 的受控 MCP 能力。

Lucy 解决的核心问题不是“再做一个 BI”，而是让 Agent 在回答数据问题前先拿到正确上下文，并在查询时受到权限、guardrail、审计和 eval 约束。长期目标是成为中小企业采用 data agent 时的标准上下文编译层和安全运行时。

Lucy 的 context compiler 最小交付单元由四类 context pack 组成：

| Context Pack | 内容 | 目的 |
|---|---|---|
| Semantic Pack | schema、grain、measures、dimensions、segments、joins、freshness | 让 Agent 理解“有什么数据、怎么算、怎么连” |
| Knowledge Pack | wiki、业务口径、owner/caveat、使用禁区 | 让 Agent 理解“为什么这样用、哪里容易错” |
| Query Pack | 可信 SQL、BI/dashboard 查询范式、常见问题样例 | 让 Agent 学习可复用的查询路径，而不是模仿一次性探索 SQL |
| Quality Pack | eval cases、安全回归、audit trace、纠错记录 | 让回答质量、安全边界和修正经验可回归 |

---

## 2. 功能模块

| 模块名 | 说明 | 优先级 |
|---|---|---|
| 多数据源接入 | MVP 支持 MySQL 与 PostgreSQL；StarRocks 进入 R1 P1 gated support，先完成 MySQL wire 只读目标源配置、证据路径和 stub 测试，live certification 通过前不进入 release verified matrix | P0 |
| 语义与知识治理 | 维护语义层（字段别名、业务定义）、Wiki 文档、Knowledge Base；解决概念-实体歧义 | P0 |
| Skill 管理 | 将结构化程序性知识（查询模板、计算逻辑）封装为可版本化的 Skill，供 KTX MCP Server 分发 | P0 |
| 权限管理 | 表级 ACL；Service Account + Token 手动分配；不支持列/行级权限，不支持 SSO | P0 |
| 访问日志与审计 | 所有 Agent 查询请求持久化记录；热查走 SQLite，冷数据归档对象存储，保留 180 天+ | P1 |
| Eval 质量监控 | 定期调度 + 语义层/Skill 变更触发 Eval Runner；结果写入 Ops Dashboard，支持准确率趋势看板与告警 | P1 |

---

## 3. 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        数据工程师 / 管理员                           │
│                         Lucy WebUI（治理控制台）                     │
│          语义层维护 · Skill 编写 · 权限配置 · Eval Case 管理        │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ 写入语义事实 / Skill / ACL
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Lucy Core Services                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  语义/知识库  │  │  Skill 仓库  │  │  权限 & Token 管理       │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ 语义事实 / Skill 分发
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      KTX MCP Server                                 │
│           （将语义层与 Skill 封装为 MCP 工具集，供 Agent 调用）      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ Agent 请求
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Governance Gateway                               │
│              鉴权（Token 校验）· 审计日志写入 · 限流                │
└─────────────┬──────────────────────────────────┬────────────────────┘
              │ 受控只读查询                       │ 审计日志
              ▼                                   ▼
┌─────────────────────────┐        ┌─────────────────────────────┐
│   数据源层               │        │   审计存储层                 │
│  MySQL / PostgreSQL     │        │  SQLite（热查）              │
│  （只读 Service Account）│        │  对象存储（冷归档 180 天+）  │
└─────────────────────────┘        └─────────────────────────────┘
              ▲
              │ 查询结果
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    AI Agent 消费层                                  │
│             Claude Code / Codex / 其他 MCP 兼容 Agent               │
└─────────────────────────────────────────────────────────────────────┘

                    ┌───────────────────────────────┐
                    │        Eval 闭环              │
                    │  变更触发 / 定期调度           │
                    │  Eval Runner → Ops Dashboard  │
                    │  准确率趋势 + 告警             │
                    └───────────────────────────────┘
```

**各层说明：**

- **Lucy WebUI（治理控制台）**：面向数据工程师和管理员的操作界面，管理语义层、Skill、权限和 Eval Case。
- **Lucy Core Services**：系统核心，维护语义/知识库、Skill 仓库和权限 & Token 管理三个子服务。
- **KTX MCP Server**：将语义事实和 Skill 封装为 MCP 工具集，是 Agent 获取上下文的唯一入口。
- **Governance Gateway**：拦截所有 Agent 请求，完成 Token 鉴权、审计日志写入和限流，实现零信任访问控制。
- **数据源层**：MVP 支持 MySQL 和 PostgreSQL；StarRocks 进入 R1 P1 gated support，作为 MySQL wire 只读 OLAP target source 推进配置、证据路径和 stub 测试。live certification 通过前不作为 release verified 数据源。Gateway 代理查询，Agent 不直连数据库。
- **审计存储层**：SQLite 保留近期热数据用于快速查询；历史数据归档至对象存储，保留 180 天以上。
- **Eval 闭环**：语义层或 Skill 发生变更时自动触发 Eval Runner，结果写入 Ops Dashboard，形成准确率质量门禁。

---

## 4. 关键设计决策

| 决策 | 内容 | 原因 |
|---|---|---|
| Token 手动分配 | Service Account Token 由管理员在 WebUI 中手动创建和分配，不提供自助申请或自动颁发 | 初期用户规模小，手动管理成本可接受；避免过度设计 |
| Audit 持久化策略 | 审计日志写入 SQLite 作为热存储供即时查询；定期批量归档至对象存储（S3 兼容），保留 180 天+ | 兼顾查询性能与存储成本，SQLite 免运维 |
| StarRocks R1 P1 范围 | StarRocks 作为 gated read-only OLAP target 推进；不把 MySQL Wire Protocol 兼容性直接写成 release verified 支持承诺 | 本期先做配置/模型识别、证据路径和 stub 测试；SQL 生成、join/measure/派生列行为仍需 live certification 验证 |
| 不做列/行级权限 | 权限粒度止步于表级 ACL，不实现列级掩码或行级过滤 | 需求复杂度远超收益；语义层本身可通过 Skill 封装规避敏感字段 |
| Agent 不直连数据库 | 所有数据查询必须经过 Governance Gateway，Agent 无法绕过鉴权和审计 | 保证审计完整性，防止未授权的直接查询 |
| Eval 触发机制 | 语义层或 Skill 变更时自动触发 Eval，同时保留定期调度（如每日）兜底 | 变更触发保证即时质量反馈，定期调度防止数据源漂移导致的隐性退化 |

---

## 5. 明确不做

以下能力在 Lucy 首版 MVP 范围内明确不实现，以防范围蔓延：

- **跨源 Join**：不支持跨不同数据源的联邦查询或结果合并，所有查询在单数据源内执行。
- **列级 / 行级权限**：不实现字段脱敏、行级过滤或动态数据掩码。
- **SSO / 统一身份认证**：不集成 LDAP、SAML、OIDC 等企业 SSO 协议，Token 由管理员手动管理。
- **SaaS 多租户**：不支持多组织隔离的 SaaS 部署模式，仅支持单组织私有部署。
- **BI 可视化**：不提供图表、报表或 Dashboard 功能，Lucy 的输出是语义上下文和受控查询接口，不面向人类分析师。
- **写操作**：所有数据源访问均为只读，Lucy 不支持任何 DML 写入操作。

---

## 6. 未决问题

- 是否追加真实外部 PostgreSQL 客户环境验收；当前 demo PostgreSQL smoke gate 已作为 CI verified 路径。
- StarRocks live certification 何时启动；通过前不进入 release verified matrix。
- Kubernetes / Helm 部署路径进入哪个 roadmap 阶段。
- Release metadata 是否在首版强制包含 SBOM。
