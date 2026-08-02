# Data Heatmap Tab Subsumption Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Data Heatmap Tab Subsumption Spec |
| 文档类型 | Product / UX / IA Spec（spec 37 的 follow-up） |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-01 |
| 适用范围 | Lucy WebUI `/admin/audit` 页面、侧边栏"访问治理"分组、兼容路由 `/admin/audit-sources`、相关前端测试 |
| 关联工单 | `webui/docs/plans/wo-M35-data-heatmap-tab-subsumption.md` |
| 关联页面 | `/admin/audit`（默认 log tab，新增 heatmap tab）、`/admin/audit-sources`（兼容重定向） |
| 事实源 | 代码：`webui/src/pages/admin/Audit.tsx`、`webui/src/pages/admin/AuditSources.tsx`、`webui/src/lib/types.ts:467`、`webui/src/__tests__/app-shell.test.tsx`；规范：`webui/docs/37-sidebar-navigation-ia-consolidation-spec.md` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/06-navigation-ia.md`、`webui/docs/37-sidebar-navigation-ia-consolidation-spec.md`、`webui/docs/14-agent-admin-enterprise-delivery-spec.md`、`webui/docs/15-role-admin-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 背景

spec 37 / plan M34 已完成"5+1 侧边栏 + 6 个二级项改名"，访问治理分组收纳 5 个二级项：

```
访问治理
  - Agent 实例
  - 角色权限
  - 访问日志
  - 数据热力
  - 配置审计
```

其中 `数据热力`（路由 `/admin/audit-sources`）是从访问日志派生的"表级访问 / 拒绝分布"dashboard，依赖 `GET /api/admin/audit/sources`，与 `访问日志`（路由 `/admin/audit`）的明细数据同源不同视图。

经评估发现：

1. **信息派生是冗余的**：数据热力的全部数据可从访问日志按表 group-by 得出，是访问日志的"分布视图"而非独立信息源。
2. **侧边栏占位过重**：纯只读 dashboard，无 CRUD、无时间窗口 / Top N / 趋势对比等深度可视化，作为一级二级项在 5 个治理项中"最薄"。
3. **观测三角仍可保留**：访问日志（明细）+ 配置审计（写入历史）+ 数据热力（分布）= 访问治理观测面。本轮不砍数据热力，而是**下沉为访问日志内的 Tab**，既保留观测能力又减少侧边栏噪声。
4. **后端零成本**：API 已实现，server `admin/audit.ts` 已存在，`mcp-proxy-smoke.test.ts` 4 处 `waitForAuditSources` 派生验证均无需改动。

本 spec 决定：**数据热力下沉为 `/admin/audit` 内的 Tab**，从主导航移除，保留兼容路由。

## 2. 决策摘要

| 优先级 | 决策 | 说明 |
|---|---|---|
| P0 | 移除主导航"数据热力"二级项 | 访问治理分组从 5 个二级项收敛为 4 个 |
| P0 | 新增 `/admin/audit` 内 Tab 切换 | Tab = `log`（默认）/ `heatmap`；用 `?tab=` URL search param 控制，无 state 持久化 |
| P0 | 复用现有 API | `GET /api/admin/audit/sources` 不动；server 端不修改 |
| P0 | 保留兼容路由 | `/admin/audit-sources` 重定向到 `/admin/audit?tab=heatmap`；`AuditSources.tsx` 文件保留为薄壳 |
| P0 | 面包屑追加 Tab 标识 | `heatmap` tab 面包屑 = `["访问治理", "访问日志", "数据热力"]`；`log` tab 保持 `["访问治理", "访问日志"]` |
| P1 | 测试资产重命名 | `admin-audit-sources.test.tsx` 改名为 `admin-audit-heatmap-tab.test.tsx`，迁移为测试 Audit 组件的 heatmap tab |
| P1 | `app-shell.test.tsx` 删除"数据热力"断言 | 同步侧边栏 4 项断言 |
| P1 | 规范同步 | `00-product-terminology-standard.md`、`06-navigation-ia.md`、spec 37、plan M34、`user-guide.html` 同步标注"数据热力已下沉为 Tab" |
| P2 | 后续可考虑 | Tab 内增加时间窗口、Top N、趋势对比等深度可视化（不在本轮 scope） |

## 3. 目标与非目标

### 3.1 目标

| 目标 | 说明 |
|---|---|
| 侧边栏减负 | 访问治理从 5 个二级项减为 4 个；信息薄、纯只读的"数据热力"不再占主导航 |
| 观测面不丢 | 数据热力的全部能力（指标卡 + Top Tables + Denied Tables）作为访问日志 Tab 完整保留 |
| 路由兼容 | 旧链接 `/admin/audit-sources` 自动重定向到新位置，外部文档 / 培训资料 / 浏览器书签继续工作 |
| 面包屑清晰 | 当前 Tab 在面包屑中明确可见，避免用户疑惑"在访问日志的哪个视图" |
| 后端零改动 | API 契约、server 实现、smoke 测试全部不动 |
| 规范一致 | 术语标准、IA 文档、用户手册、spec 37 修订同步落地 |

### 3.2 非目标

| 非目标 | 理由 |
|---|---|
| 不删除后端 API | `GET /api/admin/audit/sources` 保留；server `admin/audit.ts` 不动 |
| 不删除 `AuditSources.tsx` 文件 | 文件保留为薄壳，外部 import 不爆；提供兼容重定向 |
| 不重做数据热力 UI | 本轮仅做"位置迁移"，不引入时间窗口 / Top N / 趋势等高级可视化 |
| 不改访问日志 tab 的功能 | 现有过滤、metric grid、明细表、分页、CSV 导出全部保留 |
| 不引新依赖 | Tab 用现有按钮组 / 链接实现，不引 segmented control 库 |
| 不引新 CSS 类 | 复用现有 `pl-btn`、`pl-page-stack`、`pl-card`、`pl-metric-grid`、`pl-metric-card`、`pl-notice` 等 |
| 不改 `/admin/audit/export` | CSV 导出与 heatmap tab 无关 |

## 4. 信息架构

### 4.1 访问治理分组（终态）

```text
访问治理
  - Agent 实例               /admin/agents
  - 角色权限                 /admin/roles
  - 访问日志                 /admin/audit            (内含 log / heatmap 两个 Tab)
  - 配置审计                 /admin/config-audit
```

### 4.2 `/admin/audit` 页面结构

```text
┌─────────────────────────────────────────────────────┐
│ PageHeader                                          │
│   访问日志                                          │
│   [访问治理 / 访问日志]                              │
│   查看 MCP Proxy 记录的工具调用，可按用户、工具、状态过滤 │
├─────────────────────────────────────────────────────┤
│ Tab 切换                                            │
│   [明细 ▸]  [数据热力]                              │
├─────────────────────────────────────────────────────┤
│ Tab 内容区                                          │
│   tab=log  →  filterbar + 4 指标卡 + 明细表 + 分页    │
│   tab=heatmap →  4 指标卡 + Top Tables + Denied Tables│
└─────────────────────────────────────────────────────┘
```

Tab 状态：

- 用 `useSearchParams` 读取 `tab` 参数，合法值为 `log`（默认）/ `heatmap`。
- 切换 Tab 通过 `<Link to="?tab=heatmap">` 触发，避免触发访问日志的查询重新挂载。
- 切换 Tab **不重置**访问日志的过滤条件（保留在 URL search params 中），用户从 heatmap 切回 log 仍看到原过滤。

### 4.3 面包屑规则

| 路径 | 面包屑 |
|---|---|
| `/admin/audit` | `访问治理 / 访问日志` |
| `/admin/audit?tab=log` | `访问治理 / 访问日志` |
| `/admin/audit?tab=heatmap` | `访问治理 / 访问日志 / 数据热力` |
| `/admin/audit-sources`（兼容重定向） | 不渲染，直接 302 到 `/admin/audit?tab=heatmap` |

### 4.4 路由不变性

| 路由 | 行为 |
|---|---|
| `/admin/audit` | 现有明细 tab，不变 |
| `/admin/audit?tab=heatmap` | 新增 heatmap tab |
| `/admin/audit-sources` | 重定向到 `/admin/audit?tab=heatmap`（React Router `<Navigate replace />`） |
| `/api/admin/audit/sources` | 不变，server 端不动 |

## 5. Terminology Compliance

本 spec 复用 spec 37 / 00 标准中已登记的 `Data Heatmap / 数据热力` 术语，仅修改其在术语表中的"UI 主术语"标注与适用范围说明。

### 5.1 已存在术语的更新

| Canonical Term | UI 主术语 | 适用范围更新 |
|---|---|---|
| Data Heatmap | 数据热力（Tab） | 适用范围从"独立页面 /admin/audit-sources"收敛为"访问日志页内 heatmap Tab" |

### 5.2 Forbidden Terms（本轮新增）

```ts
const heatmapTabForbidden = [
  // 数据热力作为主导航二级项的写法（已下沉）
];
```

本轮**不新增** forbidden terms，因为 `数据热力` 一词在面包屑 / Tab 标题 / 兼容路由 redirect 目标中仍合法出现；只是不再作为侧边栏二级项。

### 5.3 同步修订（必须随本 spec 一起合并到 00）

`00-product-terminology-standard.md` §3 全局固定术语表 `Data Heatmap` 行的"说明"列更新为：

> "从访问审计派生的表级访问与拒绝分布；UI 收敛为访问日志内的 heatmap Tab（`/admin/audit?tab=heatmap`），原独立路由 `/admin/audit-sources` 保留为兼容重定向。"

`00-product-terminology-standard.md` §4.5 系统与运维（新增的 Sidebar Group 行）：访问治理分组从 5 项改为 4 项；移除"数据热力"主导航项；在 `访问日志` 项下追加一行"内含 log / heatmap 两个 Tab"。

## 6. 页面落地

### 6.1 `/admin/audit`（`Audit.tsx`）

#### 6.1.1 现有部分保持

- PageHeader `title` = `访问日志`；`breadcrumbs` = `["访问治理", "访问日志"]`；`description` 保持。
- 4 张指标卡（业务调用 / 协议调用 / 拒绝 / 触达数据）保持在 log tab 内。
- 过滤栏、明细表、分页、CSV 导出全部保留。

#### 6.1.2 新增 Tab 切换器

放置在 PageHeader 与过滤栏之间，作为水平按钮组：

```tsx
const tab = (searchParams.get("tab") ?? "log") === "heatmap" ? "heatmap" : "log";

<div className="flex items-center gap-2" role="tablist" aria-label="访问日志视图">
  <Link
    to="/admin/audit"
    role="tab"
    aria-selected={tab === "log"}
    className={`pl-btn pl-btn--ghost text-sm${tab === "log" ? " pl-btn--active" : ""}`}
  >
    明细
  </Link>
  <Link
    to="/admin/audit?tab=heatmap"
    role="tab"
    aria-selected={tab === "heatmap"}
    className={`pl-btn pl-btn--ghost text-sm${tab === "heatmap" ? " pl-btn--active" : ""}`}
  >
    数据热力
  </Link>
</div>
```

> 如果 `pl-btn--active` 不存在，**不要**新增 CSS 类，改为基于现有 `aria-selected` 通过 attribute selector 加粗 / 颜色：
>
> ```css
> [role="tab"][aria-selected="true"] {
>   @apply font-semibold text-fg;
> }
> ```
>
> 写在 `app.css` 中，并仅在 `app.css` 中已存在的 utility 范围内挑选 `font-semibold` / `text-fg`。

#### 6.1.3 Tab 内容分支

`tab === "heatmap"` 时，渲染从 `AuditSources.tsx` 搬来的 UI：

- 4 张指标卡：`连接 / Schema / 表 Top 50 / 拒绝表`，数据来自 `useQuery({ queryKey: ["admin", "audit", "heatmap"], queryFn: () => apiGet<AuditSourcesResponse>("/api/admin/audit/sources") })`。
- 两段卡片：`Top Tables` 与 `Denied Tables`。
- 复用 `HeatRow` 子组件（从 `AuditSources.tsx` 搬出或保留在 `AuditSources.tsx` 中再 import；plan Task 1 给出明确迁移路径）。

`tab === "log"`（默认）时，渲染现有访问日志 UI。

#### 6.1.4 面包屑动态化

- 当前 `breadcrumbs` prop 是静态数组；改为根据 `tab` 动态生成：
  - `tab === "log"` → `["访问治理", "访问日志"]`
  - `tab === "heatmap"` → `["访问治理", "访问日志", "数据热力"]`
- PageHeader 组件需支持第三项字符串（已支持，参见 `PageHeader.tsx`）。

### 6.2 `/admin/audit-sources`（`AuditSources.tsx`）

将整个文件重写为薄壳：

```tsx
import { Navigate } from "react-router-dom";

export function AuditSources() {
  return <Navigate to="/admin/audit?tab=heatmap" replace />;
}
```

不允许：

- 保留原 80 行 UI 代码。
- 在文件顶部 import 已不再使用的 `useQuery`、`apiGet`、`PageHeader`、`HeatRow`、`AuditSourcesResponse`。

理由：保留文件存在让外部潜在 import 不会爆；`grep "AuditSources"` 命中可追溯；体积最小；`admin-audit-sources.test.tsx` 文件重命名（见 6.3）后，本文件只剩一行 `<Navigate>` 渲染。

### 6.3 侧边栏（`App.tsx`）

`navGroups` 中 `访问治理` 分组的 `items` 从 5 项减为 4 项，删除 `{ label: "数据热力", ... }` 整行：

```ts
{
  title: "访问治理",
  items: [
    { label: "Agent 实例", to: "/admin/agents", active: (path) => path.startsWith("/admin/agents") },
    { label: "角色权限", to: "/admin/roles", active: (path) => path.startsWith("/admin/roles") },
    { label: "访问日志", to: "/admin/audit", active: (path) => path === "/admin/audit" || path.startsWith("/admin/audit?") },
    { label: "配置审计", to: "/admin/config-audit", active: (path) => path === "/admin/config-audit" }
  ]
}
```

注意：`active` 谓词更新为 `path === "/admin/audit" || path.startsWith("/admin/audit?")`，确保 `?tab=heatmap` 路径下访问日志仍高亮。

`App.tsx` 顶部 `import { AuditSources }` 保留（兼容壳还在）。

### 6.4 路由（`App.tsx`）

```tsx
<Route path="/admin/audit" element={<Audit />} />
<Route path="/admin/audit-sources" element={<AuditSources />} />
```

不变；`<AuditSources />` 现在渲染 `<Navigate replace />`。

### 6.5 用户手册（`webui/docs/user-guide.html`）

替换访问治理分组截图（5 项 → 4 项）；删除"数据热力"独立段落；增加"访问日志 Tab 切换"小节，描述 `?tab=heatmap` 用法与何时使用。

## 7. 功能与 API 影响

| API | 变更 | 说明 |
|---|---|---|
| `GET /api/admin/audit/sources` | 无 | 仍由访问日志 heatmap tab 调用；server 端不修改 |
| `GET /api/admin/audit` | 无 | 仍由访问日志 log tab 调用 |
| `/api/admin/audit/export` | 无 | 仍由 log tab CSV 导出调用 |
| `/api/admin/agents`、`/api/admin/roles`、`/api/admin/config-audit` | 无 | 不涉及 |

影响面：仅前端侧边栏与 `Audit.tsx` 内部结构调整；server 端代码完全不动；smoke 测试不动。

## 8. 非目标

- 不删除 `GET /api/admin/audit/sources` 后端实现。
- 不删除 `AuditSources.tsx` 文件（保留为薄壳）。
- 不重做数据热力 UI（无时间窗口、Top N、趋势对比等增强）。
- 不重做访问日志 UI（无过滤项调整、无 metric card 增删）。
- 不引新依赖、不引新 CSS 类。
- 不修改 `access.yaml`、`ktx.yaml`、MCP proxy、`data-qa-instructions.md`。
- 不删 `/admin/audit-sources` 路由。

## 9. 验收标准

### 9.1 P0 侧边栏验收

- 访问治理分组仅含 4 个二级项：`Agent 实例 / 角色权限 / 访问日志 / 配置审计`。
- 侧边栏不再出现 `数据热力` 二级文案。
- `app-shell.test.tsx` 不再断言"数据热力"作为侧边栏 link。

### 9.2 P0 Tab 行为验收

- 访问 `/admin/audit` 默认进入 `log` tab，看到明细表 + 4 指标卡。
- 点击 `数据热力` Tab，URL 变为 `/admin/audit?tab=heatmap`，渲染 4 指标卡 + Top Tables + Denied Tables。
- 在 log tab 设置过滤后切到 heatmap，再切回 log，过滤条件保留。
- `?tab=log` 与无 `tab` 参数行为完全一致。
- 面包屑在 heatmap tab 下为 `["访问治理", "访问日志", "数据热力"]`，在 log tab 下为 `["访问治理", "访问日志"]`。

### 9.3 P0 兼容验收

- 直接访问 `/admin/audit-sources`，浏览器 URL 变为 `/admin/audit?tab=heatmap`，渲染热力 Tab。
- `<Navigate replace />` 不留历史记录，浏览器后退不会陷入"重定向 → 后退 → 重定向"循环。
- 外部文档 / 培训资料 / 浏览器书签中含 `/admin/audit-sources` 链接的继续工作。

### 9.4 P1 测试资产验收

- `webui/src/__tests__/admin-audit-sources.test.tsx` 文件被重命名为 `admin-audit-heatmap-tab.test.tsx`。
- 新测试断言 `Audit` 组件在 `?tab=heatmap` 下渲染"数据热力"标题、4 指标卡、Top Tables、Denied Tables。
- `webui/src/__tests__/admin-audit.test.tsx` 增加 tab 切换断言：默认 `log`、点击切到 `heatmap`、URL 同步。
- 既有 `mcp-proxy-smoke.test.ts` 4 处 `waitForAuditSources` 不动；`server/__tests__/admin-audit.test.ts` 不动。

### 9.5 P1 规范验收

- `00-product-terminology-standard.md` §3 `Data Heatmap` 行"说明"列更新为"UI 收敛为访问日志内的 heatmap Tab"。
- `00-product-terminology-standard.md` §4.5 访问治理分组登记从 5 项改为 4 项，标注 heatmap Tab 归并。
- `06-navigation-ia.md` 访问治理分组表更新为 4 项；访问日志描述追加"内含 log / heatmap 两个 Tab"。
- spec 37 / plan M34 通过 minor 修订（v0.1 → v0.2）标注"数据热力已下沉为 Tab"，不重写整篇。
- `webui/docs/user-guide.html` 访问治理分组截图与目录同步替换。

### 9.6 技术验收

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run \
  src/__tests__/app-shell.test.tsx \
  src/__tests__/admin-audit.test.tsx \
  src/__tests__/admin-audit-heatmap-tab.test.tsx
npm test -- --run
npx tsc --noEmit
npm run build
```

Vite chunk-size warning 如与本任务无关可接受。

### 9.7 文档审阅

- spec 37 / plan M34 在本 spec 合并时同步出 v0.2 修订说明（changelog 段落）。
- `00` / `06` / `user-guide.html` 与本 spec 一并合并到同一 PR。
- 本 spec 合并不重启 spec 37 / plan M34 的 review checklist；本 spec 独立验收。

## 10. 关联与风险

### 10.1 关联

- 上游：`37-sidebar-navigation-ia-consolidation-spec.md` / `wo-M34`。
- 治理：`00-product-terminology-standard.md` / `06-navigation-ia.md` / `user-guide.html` 必须同步修订。
- 测试：`app-shell.test.tsx` / `admin-audit.test.tsx` / `admin-audit-sources.test.tsx`（重命名）。
- 后端：`server/admin/audit.ts` 与 `mcp-proxy-smoke.test.ts` 必须**不动**（不删不重命名）。

### 10.2 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 旧链接重定向循环 | 低 | `<Navigate replace />` 不写历史；测试断言替换后 URL 等于 `/admin/audit?tab=heatmap` |
| 过滤参数被 Tab 切换误清空 | 中 | 切 Tab 用 `<Link>` 而非组件内部 setState，URL search params 中过滤项保留 |
| `HeatRow` 组件位置 | 低 | plan Task 1 决定：搬到 `Audit.tsx` 顶部；或保留在 `AuditSources.tsx` 由 `Audit.tsx` import；任选其一 |
| 数据热力名字在历史培训 / 文档残留 | 中 | `06-navigation-ia.md` 显式列出"旧名 → 新位置"映射；`user-guide.html` 删除独立段落 |
| spec 37 修订与本 spec 状态不同步 | 低 | 本 spec 合并时附 spec 37 v0.2 修订（仅 changelog 段落） |
| `app-shell.test.tsx` 中 `["/admin/audit-sources", "AuditSources", "数据热力"]` 残留 | 中 | plan Task 1 Step 2 显式删除该数组项 |
| Tab 切换器 CSS 与现有 pl-btn 风格不一致 | 低 | 强制基于现有 `pl-btn--ghost` 与 `aria-selected` attribute selector，不引新类名 |
