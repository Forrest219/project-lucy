# System Overview Enterprise Ops Polish Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | System Overview Enterprise Ops Polish Spec |
| 文档类型 | Product / UX / IA / Frontend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-01 |
| 适用范围 | Lucy WebUI 系统概览、`/onboarding` 兼容路由、全局侧边栏、PageHeader、待处理事项、质量快照、访问风险、MCP 配置展示 |
| 关联工单 | `webui/docs/plans/wo-M39-system-overview-enterprise-ops-polish.md` |
| 事实源 | 用户截图审阅：`http://localhost:5174/onboarding`；`webui/src/pages/Onboarding.tsx`；`webui/src/app/App.tsx`；`webui/src/lib/opsDashboard.ts` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/19-system-overview-runtime-monitoring-spec.md`、`webui/docs/22-public-mcp-endpoint-runtime-config-spec.md`、`webui/docs/37-sidebar-navigation-ia-consolidation-spec.md`、`webui/docs/39-data-agent-ops-platform-global-ux-spec.md`、`webui/docs/40-lucy-webui-positioning-control-plane.md`、`docs/DEVELOPMENT.md` |

---

## 1. 背景

M36 已将系统概览升级为 Data Agent 运维驾驶舱，具备服务健康、待处理事项、质量快照、访问风险与实时诊断。用户截图显示该方向正确，但仍存在企业级 SaaS 控制台的二次 polish 问题：

1. URL 仍是 `/onboarding`，与页面真实定位脱节。
2. 正常状态通栏绿色 Banner 视觉声量过大，抢占了待处理事项的优先级。
3. 待处理事项仍以英文 `Critical / Warning / Ready / Info` 表达严重度，且缺少影响范围、责任人与更新时间。
4. 指标卡片未充分采用 metric-first 结构，扫读效率不足。
5. MCP config JSON 默认占用主屏纵向空间，更像开发调试页。
6. 顶部状态胶囊缺少环境、上次更新和自动刷新上下文。
7. 侧边栏需要继续守护 5+1 IA，避免 Footer 区域重复渲染主导航。

本 spec 是对 M36 系统概览的企业级控制台 polish，不重做整个平台，不改 MCP Proxy 鉴权语义。

## 2. 决策摘要

| 优先级 | 决策 | 说明 |
|---|---|---|
| P0 | 新增 canonical `/overview` 路由 | `/overview` 是系统概览主入口；`/onboarding` 保留为兼容重定向 |
| P0 | PageHeader 标题回归 `系统概览` | `运维驾驶舱` 是产品心智，不作为页面主标题 |
| P0 | 修复 / 守护侧边栏重复渲染 | 主导航只出现在 `nav`，Footer 只保留系统手册与版本信息 |
| P0 | 正常状态降噪 | Ready 状态使用紧凑状态条；大面积 Alert 只用于异常、降级或 Critical |
| P0 | 待处理事项引入中文严重度与治理元数据 | 使用 `高风险 / 待处理 / 提醒 / 就绪`，补充影响范围、负责人、最近更新时间 |
| P0 | MCP config 默认收纳 | 主屏只展示 endpoint 与动作；JSON 放入右侧 Drawer |
| P1 | 顶部补齐全局上下文 | 展示环境、上次更新、自动刷新开关、刷新 loading 与 Toast |
| P1 | Metric-first 重构质量 / 访问快照 | 主指标大字号、进度条 / 状态 Badge、辅助说明、单一 CTA |
| P1 | 状态表达可访问 | 状态必须同时使用颜色、图标 / 形状、明确文案，不能只靠色点 |

## 3. 目标与非目标

### 3.1 目标

| 目标 | 说明 |
|---|---|
| 定位一致 | URL、标题、侧边栏与 `Data Agent Ops Control Plane` 心智一致 |
| 企业级扫读 | 第一屏按“是否可服务、哪里有风险、下一步处理什么”组织 |
| 治理可复核 | 待处理事项展示影响、负责人、更新时间与证据来源 |
| 操作层级清晰 | 页面级主动作、卡片级次动作、跳转链接样式统一 |
| 视觉降噪 | 正常状态不使用大面积高饱和背景；代码配置默认不侵占主屏 |
| 可访问性 | 状态与风险不依赖单一颜色；专业英文术语与 URL 做浏览器翻译防御 |

### 3.2 非目标

| 非目标 | 理由 |
|---|---|
| 不把 `/` 改为系统概览 | `/` 已由 5+1 IA 定义为 `表目录`，不得破坏现有深链 |
| 不删除 `/onboarding` | 旧链接、测试和外部书签需兼容 |
| 不新增后端聚合 API | MVP 继续使用 `/api/project`、`/api/sources`、`/api/diff`、`/api/admin/agents`、`/api/eval/runs?limit=1` |
| 不修改 `ktx.yaml` / `access.yaml` / data-qa instructions | 本 spec 只涉及 WebUI 展示与前端 view model |
| 不引入新 UI 依赖 | 复用现有 React、CSS token、Object Detail Drawer 样式与测试体系 |

## 4. 路由与信息架构

### 4.1 Canonical Route

| 路由 | 目标行为 |
|---|---|
| `/overview` | 渲染 `系统概览` 页面，是侧边栏置顶入口 |
| `/onboarding` | `Navigate replace` 到 `/overview`，保留兼容 |
| `/` | 保持 `表目录`，不改为首页 |

### 4.2 侧边栏规则

1. `topLevelEntry.to` 改为 `/overview`。
2. 侧边栏只渲染一次 5+1 导航：`系统概览 / 数据接入 / 语义建模 / 语义发布 / 质量评测 / 访问治理`。
3. Footer 只允许出现：
   - `系统手册`
   - `Lucy v1.8 · © 2026`
   - 后续如需增加帮助 / 设置入口，必须作为 utility link，不得复用 `navGroups`。
4. 品牌区副标题保持：
   - `Data Agent Ops Control Plane`
   - `Data Agent 运维控制台`
   并保证 220px sidebar 下不截断中文 caption；英文 brand term 可省略号截断但必须有 `title`。

## 5. 顶栏上下文与刷新

PageHeader 应使用：

| 区域 | 要求 |
|---|---|
| Title | `系统概览` |
| Description | `Data Agent 运维控制台，用于查看 Lucy MCP、KTX Runtime、语义资产、质量评测与 Agent 接入的当前可服务状态。` |
| Badges | `环境: Local`、`上次更新: HH:mm:ss`、`KTX 可用 / 不可用`、`x/y 语义完成`、`n 活跃 Token` |
| Actions | `自动刷新` toggle、`刷新状态` secondary button |

实现约束：

1. `环境` MVP 可由 `mcpEndpoint.status` 与 endpoint host 推断：`localhost / 127.0.0.1` 显示 `Local`，其他配置显示 `Configured`。不得硬编码 `Dev`。
2. `上次更新` 在所有核心 query 首次成功后记录本地时间；手动刷新成功后更新。
3. `刷新状态` 在 refetch 中显示 loading 状态，并通过 Toast 展示成功 / 失败。
4. `自动刷新` 默认关闭；开启后每 60 秒 refetch；页面隐藏时暂停。

## 6. 状态与视觉声量

### 6.1 Service Health

服务健康应从大面积正常 Banner 调整为紧凑状态条：

```text
系统状态：Lucy MCP、KTX Runtime、语义层、Agent 接入可服务    [控制台日志]
```

规则：

1. Ready：白底或极浅灰底，左侧状态图标 + 文案，不使用整条绿色背景。
2. Warning：浅橙边框或左侧强调线。
3. Critical：允许使用高视觉权重 Alert。
4. 状态文案统一中文：`就绪 / 待完善 / 异常 / 提醒`。
5. 专业英文术语 `Lucy MCP`、`KTX Runtime`、`Agent`、`Endpoint` 加 `translate="no"` 与 `notranslate`。

### 6.2 待处理事项严重度

| 严重度 | UI 文案 | 使用场景 |
|---|---|---|
| critical | 高风险 | 服务不可用、ACL 拒绝、发布失败、阻断交付的语义缺口 |
| warning | 待处理 | 待发布变更、Catalog 待处理、语义覆盖不足 |
| info | 提醒 | 近 30 天无评测数据、建议建立质量基线 |
| ready | 就绪 | 已处理 / 无待办，通常不进入队列 |

禁止在 UI 中裸露英文严重度：`Critical`、`Warning`、`Ready`、`Info`。

## 7. 待处理事项治理上下文

每条待处理事项至少包含：

| 字段 | 示例 |
|---|---|
| 标题 | `62 张表待补语义` |
| 严重度 | `高风险` / `待处理` / `提醒` |
| 影响范围 | `问答召回率`、`资产同步`、`质量基线`、`访问安全` |
| 负责人 | `数据治理组`、`架构组`、`QA 团队`、`访问治理组` |
| 最近更新时间 | `今天 10:12`，未知时显示 `更新时间未知` |
| 证据来源 | `语义覆盖 4/66`、`diff files: 3`、`ACL 拒绝: 2` |
| 动作 | `前往处理 ↗` |

MVP 允许在 `opsDashboard.ts` 中用 deterministic mapping 生成 `impact` 与 `owner`，但不能伪造精确更新时间；若没有服务端事件时间，显示最近一次 dashboard 更新时间。

## 8. Metric-First 快照

质量快照和访问风险使用一致卡片结构：

```text
主指标
状态 Badge / 进度条
辅助说明
单一 CTA
```

示例：

| 卡片 | 主指标 | 辅助信息 | CTA |
|---|---|---|---|
| 语义覆盖率 | `6%` | `4 / 66 语义完成，62 张表待补` | `查看缺口 ↗` |
| 待发布变更 | `0` | `当前无未审阅变更` | `打开发布工作台 ↗` |
| Agent 启用 | `6 / 7` | `6 个 Agent 已启用` | `查看 Agent 实例 ↗` |
| ACL 拒绝 | `0` | `近 7 天无拒绝` | `查看访问日志 ↗` |

视觉规则：

1. 不使用卡片嵌套卡片。
2. 重复指标项可以用 grid，但每个 card 内最多一个主 CTA。
3. 进度条必须有文字标签，不能只靠长度表达。
4. `Run` 的 UI 文案改为 `运行`；如必须表达 Eval Run 对象名，使用 `Eval Run` 并加翻译防御。

## 9. MCP 配置展示

MCP config JSON 默认不在主屏展开。

目标结构：

```text
Agent 接入点
  Endpoint: http://127.0.0.1:7879/mcp
  7 个 Agent / 6 个可用 Token
  [复制 MCP 配置] [查看配置]
```

交互：

1. `复制 MCP 配置` 直接复制安全模板，不包含历史 token 明文。
2. `查看配置` 打开右侧 Drawer，标题为 `MCP 配置`。
3. Drawer 内展示 JSON、endpoint diagnostics、复制按钮和 `查看 Agent 实例 ↗`。
4. 代码块、URL、环境变量名必须加 `translate="no"` 与 `notranslate`。
5. 主屏不得默认渲染完整 JSON 代码块。

## 10. 操作样式

| 类型 | 规则 |
|---|---|
| Page Primary | 每个页面最多 1 个；当前系统概览没有必须的 primary 时可不设 |
| Secondary | `刷新状态`、`复制 MCP 配置`、`查看配置` |
| Link | 跨模块跳转统一为 `前往处理 ↗`、`查看缺口 ↗` |
| Dangerous | 本页不直接提供危险动作 |

禁止同一区域混用多套箭头样式；统一使用 `↗` 表达跨页面跳转。

## 11. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md` v0.2.

New terms:
- None

UI replacements required by this polish:

| 当前 / 风险文案 | 目标文案 |
|---|---|
| `/onboarding` 作为主入口 | `/overview` 作为主入口，`/onboarding` 兼容重定向 |
| `运维驾驶舱` 作为 PageHeader title | `系统概览` |
| `Warning` | `待处理` 或按实际严重度显示 `高风险 / 提醒` |
| `Ready` | `就绪` |
| `Run` | `运行`；对象名场景保留 `Eval Run` |
| `ACL deny` | `ACL 拒绝` |
| `token` | `Token` |
| `Endpoint` 裸文本 | `Endpoint` + 翻译防御 |

Browser translation defense is mandatory for:

- `Data Agent Ops Control Plane`、`KTX Runtime`、`Lucy MCP`、`MCP`、`Agent`、`Schema`、`Manifest`、`Catalog`、`Endpoint`、`YAML`、`Eval Run`。
- connection、schema、table、role、token id、session id、turn id。
- 文件名、路径、URL、环境变量名，例如 `.mcp.json`、`LUCY_PUBLIC_MCP_URL`、`http://127.0.0.1:7879/mcp`。

## 12. 验收标准

| 类别 | 验收 |
|---|---|
| Route | `/overview` 渲染系统概览；`/onboarding` 重定向到 `/overview`；`/` 仍为表目录 |
| Sidebar | 主导航只出现一次；Footer 只含系统手册与版本信息；系统概览置顶并指向 `/overview` |
| Header | 标题为 `系统概览`；展示环境、上次更新、KTX、语义完成、活跃 Token、自动刷新、刷新状态 |
| Refresh | 手动刷新有 loading 状态与 Toast；自动刷新默认关闭，开启后周期 refetch |
| Service Health | Ready 状态不使用大面积绿色通栏；Critical 才使用高声量 Alert |
| Action Required | 严重度为中文；每条包含影响范围、负责人、更新时间、证据来源与 `前往处理 ↗` |
| Metrics | 质量 / 访问快照主指标大字号，语义覆盖有进度条，卡片无嵌套 |
| MCP Config | 主屏不默认展示 JSON；`查看配置` 打开 Drawer；复制仍可用 |
| Accessibility | 状态不只依赖颜色；专业术语、路径、URL、代码块有翻译防御 |
| Tests | `npm run lint:terminology`、`npm run lint:ia-boundary`、`npx tsc --noEmit`、`npm test`、`npm run build` 通过 |

## 13. 分阶段交付

| 阶段 | 范围 | 成功标志 |
|---|---|---|
| Phase 1 | Route + Sidebar hardening | `/overview` 成为主入口，旧 `/onboarding` 兼容，Footer 不重复导航 |
| Phase 2 | Header context + refresh controls | 用户能看到环境、更新时间、刷新状态与自动刷新 |
| Phase 3 | State tone + action queue governance | 待办具备中文严重度、影响、负责人、更新时间与证据 |
| Phase 4 | Metric-first cards + MCP Drawer | 首页扫读更快，代码配置收纳 |
| Phase 5 | QA hardening | 术语、IA、可访问性和截图回归通过 |
