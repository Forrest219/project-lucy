# System Overview Runtime Monitoring Spec

## 1. 背景

`/onboarding` 当前页面仍然以“部署向导 / 上线检查”的一次性流程表达为主，包括 `5/5 Ready` readiness 指标、1-5 数字步骤、Header 快捷跳转按钮等。

系统上线后，这个页面的真实价值已经从“指导初始化”转为“查看当前运行状态”。继续使用向导式表达会造成两个问题：

1. 数字步骤暗示页面是一次性流程，而不是持续监控面板。
2. Header 与步骤右侧按钮重复了左侧导航，增加了视觉噪音。

本规格定义 `/onboarding` 页面向 **系统概览 / System Overview** 的信息架构与视觉重构。

## 2. 新定位

页面定位改为：**运行状态监控页**。

它应该回答：

- Lucy MCP 当前是否可以交付给 Agent 使用？
- KTX runtime 是否可用？
- 语义资产覆盖度如何？
- 是否存在待审阅 YAML / wiki / config 变更？
- 当前有多少 Agent 和可用 token？
- 运维人员应该复制哪份 MCP 配置给目标 Agent 平台？

## 3. 范围

### 3.1 In Scope

- 保持 `/onboarding` 路由不变。
- 修改左侧导航文案：`部署向导 / 上线检查` 改为 `运行状态 / 系统概览`。
- 修改页面 Header 文案与 action。
- 移除部署 readiness 与线性步骤表达。
- 将 Step 区改造成平行的运行诊断列表。
- 保留 MCP ready banner 与 JSON config 复制能力。
- 复用既有 React Query endpoints：
  - `/api/project`
  - `/api/sources`
  - `/api/diff`
  - `/api/admin/agents`

### 3.2 Out Of Scope

- 不修改后端 API。
- 不新增持久化状态。
- 不改 `/onboarding` route path。
- 不新增 `/overview` redirect。
- 不改数据库接入、表目录、Review、Agent Admin 等其他页面的信息架构。

## 4. 页面结构

目标结构：

```text
系统概览
├─ Header
│  ├─ Breadcrumbs: 运行状态 / 系统概览
│  ├─ Title: 系统概览
│  ├─ Description: 查看 Lucy MCP、KTX runtime、语义资产与 Agent 接入的当前健康状态。
│  ├─ Badges: KTX 可用/不可用 · 语义完成 x/y · 活跃 Token n
│  └─ Actions: 刷新状态
├─ Delivery Banner
│  └─ Lucy MCP ready/not ready + 复制 .mcp.json 配置
├─ Core Metrics
│  ├─ KTX Runtime
│  ├─ 语义资产覆盖度
│  └─ Agent 接入与安全
└─ Runtime Diagnostics
   ├─ 数据源连接
   ├─ 语义层状态
   ├─ 变更审阅
   └─ Agent 接入点 + JSON config + 操作区
```

## 5. 改造规则

### 5.1 Header

从：

- Breadcrumbs: `部署向导 / 上线检查`
- Title: `上线检查`
- Actions: `[数据库接入] [配置 Agent]`

改为：

- Breadcrumbs: `运行状态 / 系统概览`
- Title: `系统概览`
- Description: `查看 Lucy MCP、KTX runtime、语义资产与 Agent 接入的当前健康状态。`
- Badges:
  - `KTX 可用/不可用`
  - `{doneSources}/{sources.length} 语义完成`
  - `{enabledTokenCount} 活跃 Token`
- Actions:
  - `刷新状态`

`刷新状态` 应 refetch 既有四个 query，不引入新 API。

### 5.2 Delivery Banner

保留。它是上线后高频运维动作：

- Ready 时展示 Lucy MCP endpoint。
- Not ready 时展示首个阻塞原因。
- Ready 时保留 `复制 .mcp.json 配置`。

### 5.3 Core Metrics

从 4 卡改为 3 卡。

删除：

- `Deployment readiness`

保留并重构：

| Metric | 含义 |
| --- | --- |
| `KTX Runtime` | KTX runtime 是否可用，以及项目根路径 |
| `语义资产覆盖度` | 已完成语义维护的表数 / 总表数 |
| `Agent 接入与安全` | 已启用 Agent、总 Agent、总 token、可用 token |

视觉规则：

- 3 张卡统一使用浅灰底色 `rgba(243, 244, 246, 0.4)`。
- 不使用整卡绿色/红色表达状态。
- 状态通过文字颜色、badge 或简短 label 表达。

### 5.4 Runtime Diagnostics

移除线性 onboarding steps。

删除：

- 1-5 数字序号框。
- Step 1-4 右侧跳转按钮：
  - `查看连接`
  - `表白名单`
  - `维护语义`
  - `审阅校验`

新增四个平行诊断项：

| 诊断项 | Ready 条件 | 内容 |
| --- | --- | --- |
| `数据源连接` | `connections.length > 0 && ktxAvailable` | connection 数、connection ids、schema 数、KTX 状态 |
| `语义层状态` | `sources.length > 0 && doneSources > 0` | done 数、待完善数、enabled table 数 |
| `变更审阅` | `changedFiles.length === 0` | 待审阅文件数、当前变更风险 |
| `Agent 接入点` | `mcpAccessReason(...)` 为空 | endpoint、Agent 数、可用 token、MCP config |

诊断项是运行状态，不是二级导航。跳转入口应主要依赖左侧导航。

### 5.5 Agent MCP Config

保留并收纳在 `Agent 接入点` 诊断项中：

- endpoint chips
- JSON config preview
- `复制 MCP 配置`
- `新建 Token`
- `Agent 实例`

Banner 中的 `复制 .mcp.json 配置` 也保留，作为高频运维动作。

## 6. 验收标准

- `/onboarding` 页面标题为 `系统概览`。
- 左侧导航组为 `运行状态`，当前项为 `系统概览`。
- Header 不再出现 `数据库接入`、`配置 Agent` 两个快捷跳转按钮。
- Header 出现 `刷新状态` 按钮。
- 页面不再出现 `Deployment readiness`。
- 页面不再出现 1-5 数字 step index。
- Core Metric 区只有 3 张卡：
  - `KTX Runtime`
  - `语义资产覆盖度`
  - `Agent 接入与安全`
- Runtime Diagnostics 区出现：
  - `数据源连接`
  - `语义层状态`
  - `变更审阅`
  - `Agent 接入点`
- MCP config 仍可从 banner 和 Agent 诊断项复制。
- 定向测试通过：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/onboarding.test.tsx src/__tests__/app-shell.test.tsx
```

- 构建通过：

```bash
npm run build
```

- 全量测试通过：

```bash
npm test
```

## 7. 实施工单

实施按 [wo-M16-system-overview-runtime-monitoring.md](plans/wo-M16-system-overview-runtime-monitoring.md) 执行。
