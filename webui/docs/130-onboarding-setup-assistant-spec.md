# Lucy Onboarding Setup Assistant Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Onboarding Setup Assistant Spec (接入向导与双轨配置体验设计规范) |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-29 |
| 撰写人 | Claude |
| 委托人 | xingchen |
| 基于材料 | 用户需求：学习 iPhone / macOS Setup Assistant 引导设计（一步只做一件事，降低认知复杂度）；双轨规则（保持现有管理后台不变，额外提供渐进式引导）；可选步骤跳过机制（如业务 Wiki）；终点 Hello World 闭环接入体验；`webui/docs/00-product-terminology-standard.md`；`webui/docs/06-navigation-ia.md`；`webui/docs/124-connection-create-admin-spec.md`；`webui/docs/123-publish-workbench-activation-ia-spec.md` |
| 适用范围 | Lucy WebUI 接入向导（Setup Assistant 全屏/模态沉浸流）；`/connections`、`/overview` 与各专业管理工作台的双轨交互桥梁；API 扩展与断点续配状态契约 |
| 输出位置 | `webui/docs/130-onboarding-setup-assistant-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 130 |
| 关联工单 | `webui/docs/plans/wo-202608-65-onboarding-setup-assistant.md` |
| 关联页面 | 接入向导独立流（`/onboarding` 或全局 Setup Modal）；`/connections`（入口与卡片续配态）；`/catalog`、`/wiki`、`/publish/workbench`、`/admin/mcp-playground` |
| 上游 Spec / 设计 | `webui/docs/00-product-terminology-standard.md`；`webui/docs/06-navigation-ia.md`；Spec 124（新建连接）；Spec 123（发布工作台）；Spec 99（MCP 调试台） |
| 状态 | Designed（设计就绪） |
| 日期 | 2026-08-29 |
| 范围 | 端到端接入向导 6 步状态机；通俗文案与术语标准；断点续配与专业控制台双轨联动；**现有页面结构与 API 100% 兼容保留** |

---

## 1. 业务背景与问题分析

### 1.1 核心痛点：认知断崖与挫败感
在 Lucy 原有交互流程中，用户在通过网络与凭据建立物理数据库连接后，系统立即将用户带回 `/connections` 列表页。此时由于 Schema 尚未挂载 Manifest 文件，界面会展示显眼的黄色 `[缺失 Manifest]` 标签及关联告警。

对初次接触系统的业务用户或分析师而言：
1. **术语过于抽象**：用户尚不理解 <span translate="no" className="notranslate">Manifest</span> 的概念，将其视作晦涩的技术黑话。
2. **系统姿态误导**：将正常 onboarding 必经的中间状态误标为系统“异常/故障”，破坏了连接成功的正向情绪反馈。
3. **流程割裂离散**：从“新建连接”到“上传 Manifest”到“启用表”到“写语义 Overlay”到“业务 Wiki”再到“发布生效”，离散分布在 5 个不同菜单中，缺少单线串联的向导。

### 1.2 解决方案：借鉴 Apple Setup Assistant 哲学
对标 macOS / iOS 的开机设置助理（Setup Assistant），系统采用 **“开机向导（Setup Assistant） + 系统设置（Settings Console）”** 的双轨模式：
- **向导态（Setup Assistant）**：单焦点、线性推进、通俗比喻、正向即时反馈、支持优雅跳过、终点交付 Hello World。
- **控制台态（Settings Console）**：现有的 `/connections`、`/catalog` 等页面保持原汁原味，供日常精细化运维使用。

---

## 2. 双轨架构与步骤状态机（Assistant IA）

```mermaid
flowchart TD
    subgraph OnboardingFlow [Setup Assistant 模式 (6 步向导)]
        S1["Step 1: 连接数据库\n(网络与凭据 · 核心必填)"]
        S2["Step 2: 挂载资产清单\n(Schema Manifest · 核心推荐)"]
        S3["Step 3: 选择启用表\n(启用表范围 · 核心必填)"]
        S4["Step 4: 丰富业务语义\n(Table YAML · 可选增强)"]
        S5["Step 5: 注入业务知识\n(业务 Wiki · 可选增强)"]
        S6["Step 6: 连接 Agent 客户端\n(MCP 接入与 Hello World · 闭环验证)"]

        S1 -->|"连通测试通过"| S2
        S2 -->|"上传完成"| S3
        S2 -.->|"稍后挂载"| S3
        S3 -->|"确认选表"| S4
        S4 -->|"配置/一键采用"| S5
        S4 -.->|"跳过此步"| S5
        S5 -->|"上传文档"| S6
        S5 -.->|"跳过此步"| S6
    end

    subgraph ConsoleFlow [Settings 模式 (专业管理控制台)]
        C_Conn["/connections\n(连接概览)"]
        C_Whitelist["/connections/enabled-tables\n(启用表范围)"]
        C_Catalog["/catalog\n(语义资产)"]
        C_Wiki["/wiki\n(业务 Wiki)"]
        C_Publish["/publish/workbench\n(发布工作台)"]
        C_Playground["/admin/mcp-playground\n(MCP 调试台)"]
    end

    OnboardingFlow -->|"随时保存并退出"| C_Conn
    C_Conn -->|"点击卡片「继续配置向导」"| OnboardingFlow
    S6 -->|"完成向导"| C_Playground
    S6 -->|"进入管理控制台"| C_Conn
```

### 2.1 状态机模型（Step State Machine）

| 步骤 | 阶段目标 | 步骤性质 | 准入条件 (Guards) | 跳过/兜底策略 (Fallback) | 转移出口 (Next Step) |
|---|---|---|---|---|---|
| **Step 1: 连接数据库** | 建立物理网络与凭据连通 | **核心必填** | 填写有效连接参数且连通测试为 OK | 阻断：必须连通测试通过 | 进入 Step 2 |
| **Step 2: 挂载资产清单** | 挂载 Schema Manifest | **核心推荐** | 已写入 Connection 与初始 Schema | 支持「稍后挂载」，降级为只读数据库基本元数据 | 进入 Step 3 |
| **Step 3: 选择启用表** | 圈定进入语义层的表范围 | **核心必填** | 存在可用的表候选（来自 Manifest 或库内扫描） | 默认全选当前 Schema 下发现的所有物理表 | 进入 Step 4 |
| **Step 4: 丰富业务语义** | 补充指标/分群 YAML Overlay | **可选增强** | 存在至少 1 张已启用表 | **可跳过**：默认使用基础字段投影与直通统计 | 进入 Step 5 |
| **Step 5: 注入业务知识** | 上传业务 Wiki Markdown | **可选增强** | 无前置依赖 | **可跳过**：跳过时不创建任何 Wiki 文档 | 进入 Step 6 |
| **Step 6: 连接 Agent 客户端** | 复制 MCP 配置与首问验证 | **闭环验证** | 资产索引已自动完成编译 | 一键复制 Cursor / Claude Code / Codex 配置，提供 Hello World 提示词 | 完成并流转至 MCP 调试台或控制台 |

---

## 3. 六步界面结构与通俗文案规范

本规范严格遵守 [`webui/docs/00-product-terminology-standard.md`](00-product-terminology-standard.md)。所有代码标识符、文件路径、数据库对象名及专业英文术语均使用 `<span translate="no" className="notranslate">` 进行浏览器防翻译保护。

### 3.1 Step 1：连接数据库（Connect Database）
- **核心比喻**：“建立安全的数据底座链路”
- **页面标题**：连接您的数据库
- **说明文案**：“输入数据库网络与鉴权凭据。Lucy 将仅以只读方式安全访问数据。”
- **表单元素**：
  - 连接 ID（`connectionId`）
  - 数据库引擎（MySQL / PostgreSQL / StarRocks / Doris）
  - 主机（Host）、端口（Port）、数据库（Database）、用户名（Username）、数据库密码（Password）
  - 初始 <span translate="no" className="notranslate">Schema</span>
- **即时反馈**：点击「测试连接」按钮，毫秒级就地反馈（如：`✓ 连通成功 (12ms)`）。
- **主 CTA**：`[继续：挂载数据资产清单 ->]`

### 3.2 Step 2：挂载数据资产清单（Schema Manifest）
- **核心比喻**：“让 AI 读懂物理表结构与字段含义的地图”
- **页面标题**：挂载数据资产清单 <span translate="no" className="notranslate">(Schema Manifest)</span>
- **说明文案**：“告诉 Lucy 您的数据库中有哪些表和字段。上传 <span translate="no" className="notranslate">Schema Manifest</span> YAML 文件，Agent 将以此为索引理解您的数据结构。”
- **交互组件**：
  - 拖拽/点击上传卡片（支持 `.yaml` / `.yml`）。
  - 辅助引导：`还没有清单文件？可使用 ddl-export 工具快速生成，或 [下载示例模板]`。
- **逃生按钮**：`[稍后挂载清单]`（点击后进入 Step 3，连接保留待挂载状态）。
- **主 CTA**：`[继续：选择开放数据表 ->]`

### 3.3 Step 3：选择启用表（Enable Tables）
- **核心比喻**：“设定安全边界，挑选允许 AI 分析的数据表”
- **页面标题**：选择向 AI 开放的数据表
- **说明文案**：“为了数据安全与回答精准度，请勾选当前允许智能问答访问的数据表（即配置启用表范围）。未勾选的表将对 Agent 完全隐藏。”
- **交互组件**：
  - 表卡片多选列表（显示表名、物理表类型、字段数、中文注释）。
  - 快捷操作：`[全选所有表]`、`[仅选分析事实表]`。
  - 底部状态提示：“已选择 4 张表（共 12 张）”。
- **主 CTA**：`[继续：定义业务语义 ->]`

### 3.4 Step 4：丰富业务语义（Semantic Overlay · 可选步骤）
- **核心比喻**：“教 AI 计算口径与核心业务指标”
- **页面标题**：丰富业务语义 <span translate="no" className="notranslate">(Semantic Modeling)</span> `[可选]`
- **说明文案**：“为选中的数据表补充业务指标（Metric）、分析维度（Dimension）与常用过滤分群。如果暂不配置，Lucy 会使用基础字段为您提供通用查询。”
- **交互组件**：
  - 极简视图：系统自动基于表字段推荐常用度量（如 `sum(amount)`、`count(*)`）。
  - 高级视图：支持拖拽上传单表 `<table>.yaml` overlay 文件。
- **逃生机制**：左侧提供明显的 Apple 风格幽灵按钮 `[跳过此步，使用默认语义]`。
- **主 CTA**：`[继续：补充业务知识 ->]`

### 3.5 Step 5：注入业务知识（Business Wiki · 可选步骤）
- **核心比喻**：“给 AI 一本业务说明书”
- **页面标题**：注入业务 Wiki 文档 <span translate="no" className="notranslate">(Business Wiki)</span> `[可选]`
- **说明文案**：“上传 Markdown 格式的业务背景与口径解释文档（如《GMV 计算逻辑.md》）。Agent 在回答问题时将自动引用文档内容，消除业务歧义。”
- **交互组件**：
  - 拖拽上传 `.md` 文件区域。
  - 示例模板提示与预览。
- **逃生机制**：提供 `[稍后在“业务 Wiki”中设置]` / `[跳过此步]`。
- **主 CTA**：`[继续：连接 AI 客户端 ->]`

### 3.6 Step 6：连接您的 Agent，体验首条问答（Connect MCP & Hello World）
- **核心目标**：交付立竿见影的成就感（Aha Moment）与闭环体验。
- **页面标题**：🎉 接入就绪！连接您的 AI 客户端
- **说明文案**：“Lucy 已自动完成语义资产编译与索引同步。将以下标准 <span translate="no" className="notranslate">MCP</span> 配置添加到您的 AI 工具，即可开启智能问答。”
- **客户端选项卡（Tabs）**：
  - **Cursor 标签页**：提供 `~/.cursor/mcp.json` 代码块与一键复制按钮。
  - **Claude Code 标签页**：提供 `claude mcp add ...` 命令行。
  - **OpenAI Codex 标签页**：提供通用 JSON-RPC 端点。
  - **通用 JSON 标签页**：标准 MCP Server 配置块。
- **Hello World 体验问句推荐**：
  - 场景化示例：“复制配置后，在您的 Agent 对话框中输入：`请列出当前数据库有哪些表，并帮我统计最近 30 天的订单总量。`”
- **主 CTA**：`[复制 MCP 配置并完成]`、`[在 Web 调试台中体验]`、`[进入管理控制台]`。

---

## 4. 术语合规与文案对照表（Terminology Compliance）

| 概念 | UI 主术语 | 向导通俗解释 (括号注记) | 禁止文案 | 防翻译标记要求 |
|---|---|---|---|---|
| **Connection** | 连接 | 数据库安全连接 | 链接、联接 | 无须特指，普通中文 |
| **Schema** | Schema | 数据库 Schema | 架构、模式 | `<span translate="no" className="notranslate">Schema</span>` |
| **Manifest** | Manifest | 数据资产清单 (描述物理表与字段) | 舱单、财政部舱单、清单 | `<span translate="no" className="notranslate">Schema Manifest</span>` |
| **Enabled Tables** | 启用表范围 | 开放给 AI 的数据表 | 表白名单、白表、表白 | `<span translate="no" className="notranslate">enabled_tables</span>` |
| **Semantic Overlay** | 业务语义 | 指标与维度定义 | 语义图层、报价 | `<span translate="no" className="notranslate">semantic overlay</span>` |
| **Business Wiki** | 业务 Wiki | 业务说明书 / 口径文档 | 维基百科、百度百科 | `<span translate="no" className="notranslate">Business Wiki</span>` |
| **MCP** | MCP | Model Context Protocol 通信协议 | 协议沙箱、多协议 | `<span translate="no" className="notranslate">MCP</span>` |
| **MCP Playground** | MCP 调试台 | 在线体验与权限测试 | API 操场 | `<span translate="no" className="notranslate">MCP Playground</span>` |

---

## 5. 断点续配与双轨联动机制（Resume & Settings Bridge）

为实现“既有开机向导，又有随时设置”的双轨无缝协作，系统设计以下联动桥梁：

### 5.1 草稿与断点持久化（Draft & Step Persistence）
- **本地草稿状态**：向导过程中的未提交表单与临时选表状态保存在 `localStorage:lucy_onboarding_draft_<connectionId>`。
- **已落盘资产识别**：向导每一步确认均实际触发底层 API（如写入 `ktx.yaml`、落盘 `_schema.yaml`、写入 `enabled_tables`），因此刷新或在其他设备登录时，系统能根据后端已有文件自动推导当前连接处于 6 步中的第几步。

### 5.2 连接卡片进度指示（Progress Badge in Settings）
在 `/connections` 连接概览卡片中：
- 若连接已完全就绪：展示正常的健康度与 `[通 · 12ms]` 摘要。
- 若连接处于向导中断状态（例如仅完成了 Step 1 和 Step 2）：
  - 状态徽章：`[向导进度: 2/6 · 待选择启用表]`（温和引导色）。
  - 卡片右上方提供快捷入口：`[⚡ 继续向导]`，点击后直接在对应步骤打开 Setup Assistant。
  - 传统操作依然可用：高级用户可随时点击 `[添加 Schema]`、`[维护启用表范围]` 进行单项手工配置。

### 5.3 全局与单页双向唤起入口
1. **全局空态触达**：当系统无任何 Connection 时，访问 `/overview`、`/connections`、`/catalog` 等页面时，主屏居中展示 Apple 风格的欢迎卡片：`[🚀 启动接入向导]`。
2. **常规新建入口**：`/connections` 页面的 PageHeader 主按钮为 `[+ 新建连接]`（默认启动向导模式），右侧下拉提供 `[以专业模式创建]`。
3. **向导内随时退出**：向导右上角提供 `[✕ 稍后在控制台中配置]`，点击后保存当前步骤并安全平滑退出至控制台。

---

## 6. 验证标准与测试清单

1. **术语与翻译防御断言**：
   - 严禁出现 `舱单`、`财政部舱单`、`替代测试`、`架构`、`模式清单` 等禁用词。
   - 所有专业名词 DOM 节点具备 `translate="no"` 与 `className="notranslate"`。
2. **状态流转与跳过断言**：
   - Step 1 连通测试失败时，不允许进入 Step 2。
   - Step 4、Step 5 点击「跳过」时，能正常流转至 Step 6，且系统自动应用默认兜底策略。
3. **断点续配断言**：
   - 完成 Step 1 与 Step 2 后关闭向导，重新进入时能够准确识别进度并继续配置。
4. **非侵入性断言**：
   - 原有 `/connections` 表格操作、`/publish/workbench` 发布流及既有 API 逻辑 100% 不受影响。
