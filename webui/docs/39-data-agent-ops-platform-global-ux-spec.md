# Data Agent Ops Platform Global UX Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Data Agent Ops Platform Global UX Spec |
| 文档类型 | Product / UX / IA / Frontend Spec |
| 版本 | v0.2 |
| 撰写日期 | 2026-08-01（v0.2 顺手统一：line 25「运维控制面」→「运维控制台」） |
| 适用范围 | Lucy WebUI 全局菜单、系统概览、数据接入、语义建模、语义发布、质量评测、访问治理、审计与风险相关页面 |
| 关联工单 | `webui/docs/plans/wo-M36-data-agent-ops-platform-global-ux.md` |
| 事实源 | 截图目录：`inbox/lucy-screenshots/01-system-overview.png` 至 `16-admin-config-audit.png`；现有 IA：`webui/docs/06-navigation-ia.md`、`webui/docs/37-sidebar-navigation-ia-consolidation-spec.md` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/06-navigation-ia.md`、`webui/docs/14-agent-admin-enterprise-delivery-spec.md`、`webui/docs/15-role-admin-spec.md`、`webui/docs/19-system-overview-runtime-monitoring-spec.md`、`webui/docs/23-semantic-asset-publish-export-spec.md`、`webui/docs/35-semantic-publish-workbench-ia-spec.md`、`webui/docs/36-business-wiki-read-edit-workbench-spec.md`、`webui/docs/37-sidebar-navigation-ia-consolidation-spec.md`、`webui/docs/38-data-heatmap-tab-subsumption-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 背景

当前 Lucy WebUI 已完成从早期 `Catalog / Wiki / Review` 技术页面集合到 `系统概览 / 数据接入 / 语义建模 / 语义发布 / 质量评测 / 访问治理` 的 5+1 信息架构收敛。截图显示系统具备以下基础能力：

1. `系统概览` 能展示 Lucy MCP、KTX runtime、语义资产覆盖与 Agent 接入状态。
2. `数据接入` 能维护连接、Schema Manifest、本地 Catalog 与启用表范围。
3. `语义建模` 能维护表目录与业务 Wiki。
4. `语义发布` 能展示发布工作台和发布记录。
5. `质量评测` 能管理评测用例、运行历史和趋势监控。
6. `访问治理` 能管理 Agent 实例、角色权限、访问日志、数据热力和配置审计。

这些页面在视觉上已经形成低噪声、克制、企业后台风格。但从目标产品定位看，Lucy 不应只是一组“配置维护页面”，而应成为 **复核企业级 SaaS 后端管理平台的 data agent 运维平台**。这要求 UI 从“资源维护”升级为“运维控制台”：用户能从异常发现进入根因定位，再执行修复、发布、评测和审计追溯。

## 2. 决策摘要

| 优先级 | 决策 | 说明 |
|---|---|---|
| P0 | 将首页升级为运维驾驶舱 | 第一屏必须回答当前是否可服务、有哪些风险、下一步处理什么 |
| P0 | 增加 `待处理事项` 全局队列 | 聚合语义缺口、Catalog 待处理、未发布变更、评测失败、Agent / ACL 风险 |
| P0 | 建立统一对象详情抽屉 | `Connection / Schema / Table / Agent / Role / Eval Run / Audit Event` 点击后进入同一详情模式 |
| P0 | 将发布页升级为变更风险工作台 | 发布前展示 diff、影响范围、校验结果、reindex 状态和建议下一步 |
| P0 | 将质量评测升级为质量运营中心 | 以覆盖率、通过率、drift、失败 Top、阈值为核心，而不只是 case / run 列表 |
| P1 | 强化跨模块链路 | 任意核心对象应能看到关联语义资产、Wiki、发布、评测、Agent 访问和审计记录 |
| P1 | 统一空状态下一步动作 | 所有空状态必须给出至少一个可执行入口或解释性诊断 |
| P1 | 保持当前 5+1 导航骨架 | 本轮不推翻 `37-sidebar-navigation-ia-consolidation-spec.md`，只增强模块内部组织和跨模块联动 |
| P2 | 增加运维密度模式 | 大屏 / 高频运维场景可减少卡片边距、提高表格信息密度 |

## 3. 目标与非目标

### 3.1 目标

| 目标 | 说明 |
|---|---|
| 运维闭环 | 形成 `发现异常 -> 定位对象 -> 查看影响 -> 执行动作 -> 验证恢复 -> 留痕审计` 的主路径 |
| 企业级可复核 | 每个关键动作都能看到来源、影响范围、结果和审计记录 |
| 全局对象心智 | 用户理解 Lucy 管理的是一条 data agent 可用性链路，而不是孤立页面 |
| 降低跳转成本 | 从首页、列表、表格行、状态 tag、审计事件可直接打开相关对象详情 |
| 提升异常可见性 | 风险、失败、待处理项不被埋在列表里，首页和模块页均可见 |
| 统一 UI 模式 | Header、filter bar、metric cards、object row、empty state、drawer、table actions 保持一致 |

### 3.2 非目标

| 非目标 | 理由 |
|---|---|
| 不改变 MCP Proxy 鉴权语义 | 访问控制规则由 `07-mcp-auth-proxy-spec.md`、`14-agent-admin-enterprise-delivery-spec.md`、`15-role-admin-spec.md` 管辖 |
| 不修改 `ktx.yaml` / `access.yaml` 的配置格式 | 本规格只定义 WebUI 信息架构和体验，不改变底层配置契约 |
| 不新增数据问答运行时规则 | data agent runtime instructions 仍由 `webui/config/data-qa-instructions.md` 经 MCP initialize 注入 |
| 不引入大规模可视化框架 | 优先使用现有 React、CSS token、表格、简单 SVG / CSS 图表 |
| 不做多租户 / 多项目控制台 | 本轮仍面向当前本地项目 `project-lucy`，多项目留作后续 |

## 4. 目标产品心智

Lucy WebUI 的目标心智应从“语义维护工作台”升级为：

```text
Data Agent Ops Control Plane

1. Runtime：Lucy MCP 与 KTX runtime 是否可服务
2. Assets：连接、Schema、Table、Semantic Overlay、Business Wiki 是否完整
3. Change：语义资产变更是否已校验、发布并进入 KTX 索引
4. Quality：评测覆盖、通过率、drift、失败集中点是否达标
5. Access：Agent、Role、Token、ACL 是否符合最小权限
6. Audit：工具调用、拒绝、配置变更是否可追溯
```

用户进入系统时，首要任务不是“找页面”，而是判断当前 data agent 是否处于可交付状态。

## 5. 全局信息架构

保持现有 5+1 结构：

```text
系统概览
数据接入
  连接概览
  启用表范围
  连通测试（兼容）
语义建模
  表目录
  业务 Wiki
语义发布
  发布工作台
  发布记录
质量评测
  评测用例
  运行历史
  趋势监控
访问治理
  Agent 实例
  角色权限
  访问日志
  配置审计
```

导航增强规则：

1. `系统概览` 是运维驾驶舱入口，不再只是健康页。
2. `访问治理` 中的审计能力应在模块页内通过 tab 表达：`访问日志 / 数据热力`。
3. `数据接入` 和 `语义建模` 之间必须建立强链接：启用表范围中的 `查看语义`、表目录中的 `查看接入状态`。
4. `语义发布` 和 `质量评测` 之间必须建立强链接：发布后建议触发相关 domain 的评测 run。
5. `质量评测` 和 `访问治理` 之间必须建立强链接：失败 case 若与 ACL deny / token / Agent 权限相关，应能跳到访问日志或 Agent 详情。

## 6. 全局对象模型

Lucy WebUI 必须以对象链路组织信息：

```text
Connection
  -> Schema
    -> Table
      -> Semantic Overlay
      -> Business Wiki
      -> Publish Snapshot
      -> Eval Case
      -> Agent Access
      -> Audit Event
```

### 6.1 对象详情抽屉

统一对象详情抽屉用于跨页面查看对象上下文。

| 对象 | 必须展示 | 快捷动作 |
|---|---|---|
| Connection | host、database、Schema 数、本地目录刷新时间、Manifest 缺口、连通测试状态 | 测试连接、刷新本地目录、上传 Schema Manifest |
| Schema | connection、表数、Manifest 状态、启用表数、待处理数 | 维护启用表范围、上传 Schema Manifest |
| Table | connection、Schema、字段数、语义完成度、Wiki、最近发布、最近 eval、访问热力 | 维护语义、打开业务 Wiki、查看 eval、查看访问日志 |
| Agent | role、token 数、可访问资源、工具数、最近访问、拒绝次数 | 编辑、复制 MCP 配置、查看日志、吊销 token |
| Role | resource scope、tool scope、被哪些 Agent 使用、最近变更 | 编辑、复制 role、新建 Agent |
| Eval Run | domain、通过率、失败 case、触发原因、关联发布 | 查看失败、重新运行、打开相关表 |
| Audit Event | 用户、工具、表、裁决原因、状态、耗时、关联 Agent | 打开 Agent、打开表、复制 session / turn id |

抽屉规则：

1. 桌面端从右侧滑出，宽度 420-560px；小屏幕全屏。
2. 抽屉内顶部固定对象标题与状态，内容区滚动。
3. 所有专业英文术语、数据库对象名、路径、URL 必须加浏览器翻译防御。
4. 抽屉可由 URL query 表达，例如 `?object=table&conn=mysql-aliyun&schema=dataforai&table=superstore_orders`，便于分享和刷新恢复。

## 7. 系统概览：运维驾驶舱

### 7.1 第一屏布局

系统概览首屏应由四块组成：

```text
┌─────────────────────────────────────────────────────────────┐
│ PageHeader: 系统概览                         环境 / endpoint │
├─────────────────────────────────────────────────────────────┤
│ Service Health: Lucy MCP / KTX / Index / Agent Access       │
├─────────────────────────────────────────────────────────────┤
│ Action Required: P0/P1/P2 待处理事项                         │
├───────────────────────────────┬─────────────────────────────┤
│ Quality Snapshot              │ Access & Risk Snapshot       │
└───────────────────────────────┴─────────────────────────────┘
```

### 7.2 `待处理事项`

`待处理事项` 是全局运维队列，至少聚合：

| 来源 | 示例文案 | 点击目标 |
|---|---|---|
| 数据接入 | `10 个 Catalog 对象待处理` | `/connections` 或对象抽屉 |
| 语义建模 | `12 张表待补语义` | `/` 带状态筛选 |
| 语义发布 | `存在 3 个待发布文件` | `/publish/workbench` |
| 质量评测 | `近 30 天无评测数据` | `/eval/monitor` |
| 访问治理 | `1 个 Agent 禁用，6 个 token 未明文记录` | `/admin/agents` |
| 审计风险 | `近 7 天 ACL deny > 0` | `/admin/audit` |

严重度规则：

| 严重度 | 颜色 | 使用场景 |
|---|---|---|
| Critical | red | 服务不可用、发布失败、ACL 高风险、eval 红线 |
| Warning | orange | 待补语义、未发布变更、近 30 天无评测 |
| Ready | green | 已恢复、已通过、无待处理 |
| Info | gray / blue | 普通提示、建议动作 |

## 8. 模块体验要求

### 8.1 数据接入

连接概览应从“连接卡片列表”升级为“接入资产面板”：

1. 顶部 metric 显示 `连接数 / Schema 数 / 启用表 / 缺失 Manifest / 待处理 Catalog`。
2. 每个连接卡片第一行显示 `只读 / 最近刷新 / 最近连通测试`。
3. Schema 行必须显示 `Manifest 状态 / 本地表数 / 启用表数 / 语义覆盖 / 操作`。
4. `刷新本地目录` 结果应在卡片内展示，不只靠 Toast。
5. 启用表范围页面应增加批量风险提示：全选全部表前提示可能扩大 Agent 可访问范围。

### 8.2 语义建模

表目录应成为语义资产 backlog：

1. 列表按 `未开始 / 部分完成 / 已完成 / 待发布 / 评测失败` 组织。
2. 每行显示 `字段数 / 关联数 / 指标数 / Wiki / 最近 eval / 最近访问`。
3. `业务 Wiki` 不应只是独立文档列表；应展示与 table 的双向引用状态。
4. 未关联 Wiki 的高价值表应进入 `待处理事项`。

### 8.3 语义发布

发布工作台必须表达变更风险：

1. 左侧：待发布对象列表，按 `semantic overlay / business wiki / config` 分组。
2. 中间：diff 或变更摘要。
3. 右侧：校验结果、影响范围、reindex 预期、建议下一步。
4. `发布并重建索引` 只有在校验通过且有待发布变更时可作为主按钮。
5. 发布成功后必须建议触发相关 domain 的 eval run。

### 8.4 质量评测

质量评测模块应形成质量运营中心：

1. `评测用例` 页显示 case 覆盖率，而不仅是 case 列表。
2. `运行历史` 页显示趋势入口、失败摘要、关联发布批次。
3. `趋势监控` 页在空状态下显示 `触发首次 Run`、`导入评测用例`、`配置阈值`。
4. `趋势监控` 通过率趋势图必须叠加告警阈值基准线：黄线、红线使用虚线绘制，并与下方阈值配置保持一致。
5. 当趋势点跌破红线时，该点必须高亮，并提供下钻入口 `查看失败 Case`，进入对应 run / case 详情。
6. 失败 case 必须支持从 run 详情跳转到相关 table、Wiki、Agent 日志或 ACL deny。

#### 8.4.1 阈值基准线 MVP 范围

MVP 仅实现当前 `趋势监控` 页面已有阈值配置的可视化叠加，不引入新的图表库、不新增复杂告警规则引擎。

| 能力 | MVP 要求 | 非目标 |
|---|---|---|
| 黄线 / 红线 | 在通过率趋势图上以虚线基准线展示 | 不做多指标多轴配置 |
| 跌破红线点 | 使用红色点状高亮 | 不做复杂动画 |
| 下钻 | 高亮点提供 `查看失败 Case` 链接 | 不要求跨 domain 自动归因 |
| 空状态 | 无趋势数据时继续显示 `触发首次 Run`、`导入评测用例`、`配置阈值` | 不伪造趋势数据 |
| 可访问性 | 基准线需有文字标签，不能只依赖颜色 | 不引入 canvas-only 图表 |

### 8.5 访问治理与审计

访问治理模块应强化企业安全复核：

1. `Agent 实例` 列表每行显示 `role / token / resource scope / tool scope / 最近访问 / 7D denied`。
2. `角色权限` 详情展示被哪些 Agent 使用，删除或修改前必须显示影响范围。
3. `访问日志` filter bar 应支持保存常用筛选，至少保留本地最近一次筛选。
4. `数据热力` 作为访问日志 tab，不再作为独立主导航。
5. `配置审计` 应能按 actor、target、file、operation 过滤，并可跳回 Agent / Role 详情。

## 9. 全局 UI 标准

### 9.1 页面骨架

每个主页面使用一致结构：

```text
PageHeader
Context Controls
Metric Strip
Primary Work Area
Secondary Diagnostics / Audit Trail
```

说明：

1. `PageHeader` 只放页面身份、全局 badge 和 1-3 个最高级动作。
2. 筛选器不要散落在多个卡片内；统一放在 `Context Controls`。
3. Metric cards 只展示能驱动判断的数字，不为补齐四列而制造无意义指标。
4. 表格行操作优先使用文本按钮 + 悬浮更多菜单，危险动作使用红色。

### 9.2 空 / 加载 / 错误状态

| 状态 | 要求 |
|---|---|
| Empty | 说明为什么为空，并提供下一步动作 |
| Loading | 保持布局尺寸稳定，不出现内容跳动 |
| Error | 展示错误原因、重试入口、可复制诊断信息 |
| Partial | 明确哪些数据可用、哪些数据缺失 |
| Disabled | 说明禁用原因和解除条件 |

### 9.3 视觉密度

1. 当前低噪声风格保留，但减少无数据页的大面积空白。
2. 卡片圆角不超过现有 `--token-radius-md` 或 `--token-radius-lg`。
3. 不新增装饰性渐变、插画或营销式 hero。
4. 颜色使用现有 token；新增状态色必须进入 `app.css` token 层。
5. 表格和列表需要稳定列宽，长对象名使用 `translate="no"` + 等宽字体 + 截断。

## 10. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Ops Dashboard | 运维驾驶舱 | 系统概览 | 大屏、看板（作为主标题） | 系统概览的产品心智升级，强调 data agent 可服务状态 |
| Action Required | 待处理事项 | 运维待办 | 告警列表泛化 | 首页聚合的跨模块待处理队列 |
| Object Detail Drawer | 对象详情抽屉 | 详情抽屉 | 详情弹窗泛化 | 跨模块查看 Connection / Table / Agent 等对象上下文 |
| Change Impact | 变更影响范围 | 影响范围 | 影响分析（作为按钮主名） | 发布前说明哪些对象、Agent、eval 可能被影响 |
| Quality Operations | 质量运营 | 质量评测运营 | 质量评价 | 评测模块从列表管理升级为持续运营 |

Browser translation defense is mandatory for:

- `KTX`、`MCP`、`Agent`、`Schema`、`Manifest`、`Catalog`、`YAML`、`Endpoint`、`Reindex`。
- connection、schema、table、domain、role、token id、session id、turn id。
- 文件名、路径、URL，例如 `semantic-layer/`、`webui/config/access.yaml`、`http://127.0.0.1:7879/mcp`。

## 11. 验收标准

| 类别 | 验收 |
|---|---|
| IA | 5+1 导航保持不破，系统概览承担运维驾驶舱职责 |
| 首页 | 能看到服务健康、待处理事项、质量快照、访问风险快照 |
| 跨模块 | 至少 Table、Agent、Eval Run、Audit Event 支持对象详情抽屉 |
| 发布 | 发布工作台展示变更影响范围和发布后评测建议 |
| 质量 | 趋势监控空状态提供触发 run / 导入 case / 配置阈值入口；通过率趋势图叠加黄线 / 红线阈值基准线，跌破红线点可下钻失败 Case |
| 访问治理 | Agent、Role、Audit、Config Audit 可相互跳转追溯 |
| 术语 | `npm run lint:terminology` 通过；新增术语已在本 spec 登记 |
| IA 边界 | `npm run lint:ia-boundary` 通过；未引入禁止导航项 |
| 测试 | `npm test`、`npx tsc --noEmit`、`npm run build` 通过 |

## 12. 分阶段交付

| 阶段 | 范围 | 成功标志 |
|---|---|---|
| Phase 1 | 首页运维驾驶舱 + 待处理事项 | 用户从首页可判断系统是否可服务和下一步处理对象 |
| Phase 2 | 对象详情抽屉 + 跨模块链接 | Table / Agent / Eval / Audit 不再是孤立页面 |
| Phase 3 | 发布风险工作台 | 发布前后具备校验、影响范围、reindex 和 eval 闭环 |
| Phase 4 | 质量运营中心 | 评测覆盖、趋势、失败归因和阈值成为主体验 |
| Phase 5 | 审计与安全复核 | 访问日志、数据热力、配置审计与 Agent / Role 形成闭环 |
