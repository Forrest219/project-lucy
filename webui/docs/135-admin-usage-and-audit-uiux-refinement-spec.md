# Usage Overview & Audit Logs UI/UX Refinement Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 使用概况与访问日志 UI/UX 体验重构规范 (Usage Overview & Audit Logs UI/UX Refinement Spec) |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-29 |
| 撰写人 | Claude (Cursor Agent) |
| 委托人 | xingchen |
| 基于材料 | CFG-AUDIT-01 自动化运行截图证据与 UI 交互审视、Lucy WebUI 源码 (`GovernanceOverview.tsx`, `Audit.tsx`, `MetricCard.tsx`, `app.css`)、全系统术语标准 (`00-product-terminology-standard.md`) |
| 适用范围 | Lucy WebUI 监控与审计模块前端 UI/UX 体验重构（`/admin/usage` 使用概况、`/admin/audit` 问询记录与调用流水列表、问询详情抽屉 Drawer） |
| 输出位置 | `webui/docs/135-admin-usage-and-audit-uiux-refinement-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 135 |
| 关联工单 | 待建 |
| 关联页面 | `/admin/usage`（使用概况看板）、`/admin/audit`（访问日志·问询记录 / 调用流水 / 详情抽屉） |
| 上游 Spec | Spec 08 / Spec 69 / Spec 75 / Spec 78 / Spec 84 / Spec 86 / Spec 87 / Spec 89 / Spec 94 / Spec 106 / Spec 128 |
| 状态 | Draft / Ready for Review |
| 日期 | 2026-08-29 |
| 范围 | 纯前端 UI/UX 提升：指标分层与复合指标卡、排行榜弹性布局与比例感知、抽屉排版与组件内聚、主表高密降噪与语义解耦、快捷时间预设与单行弹性筛选栏 |

---

## 1. 背景与问题定义

基于 `CFG-AUDIT-01/20260827-1318` 运行证据（包含使用概况监控看板、访问日志主表、问询详情抽屉等截图）以及当前前端代码实现分析，系统在监控与审计两大核心场景存在以下四个维度的严重体验痛点：

1. **看板指标卡片（KPI Cards）九宫格机械平铺，缺乏层级与业务主线**：
   - 3×3 矩阵将“静态资产底数（Agent/Token/表）”与“动态运行体征（调用量/拦截数/多数请求耗时）”同权平铺，认知负荷大，管理员无法一眼识别系统健康与异常。
   - 下方 3 个排行榜容器写死 10 行高度（`calc(10 * 1.5rem + ...)`），在 1~4 行小样本数据下大面积灰色留白；表名被强行中截断（如 `chatbi.ai_intl_co...`），且缺少比例基准刻度。
2. **审计抽屉（Audit Drawer）出现纵向排版文字车祸与空间孤立割裂**：
   - 抽屉内调用明细表的“耗时/慢调用”列未设置 `whitespace-nowrap` 与最小宽度，导致 `慢于多数请求` 6 个字垂直单字换行坍塌（典型 CSS 渲染事故）。
   - 抽屉底部单独用一个大 Card 装载仅单行的 `触达表汇总`（如 `chatbi.ai_intl_country_daily`），垂直空间极度浪费，信息内聚度极低。
3. **访问日志主表（Audit Table）横向失控，核心决策信息被挤压**：
   - 完整的 UUID 类机器 Hash（如 `lucy_be70c491-c693-4cb7...`）占据核心第二列，压缩了人类最关心的“问询摘要”、“涉及数据表”与“Agent 归属”。
   - 大量无意义的破折号 `—`（如拦截未下发的表、耗时等）稀释了表格有效信息密度；状态 Tag 内出现 `1 拒绝` 混淆字样（将“1 次拦截”与“状态：拒绝”混在一个 Tag 呈现）。
4. **筛选栏（Filter Bar）两行杂乱，缺乏响应式收敛与时间快捷预设**：
   - 原生 `datetime-local` 控件（`年/月/日 --:--`）直接暴露，用户在排查“刚刚”、“近 1 小时”、“今天”等高频时间段时操作成本过高。
   - 控件高低不齐、字段宽度写死，“搜索摘要”单独折行占据空间，缺乏企业级 B 端工具栏的弹性对齐与高级收纳。

---

## 2. 核心设计原则与约束

1. **纯前端实现（Zero Backend Changes）**：
   - 严格不修改任何后端 API 接口路径、请求 Query 参数或返回 JSON 契约。
   - 数据聚合（如活跃数/总数复合显示、问询 ID 缩略与复制、状态与计数语义分离、综合搜索参数路由）全部在前端组件层闭环完成。
2. **术语与合规保护（Terminology Compliance）**：
   - 严格遵循 `00-product-terminology-standard.md`：保护词（`Agent`、`Token`、`MCP`、`P95`、`多数请求耗时`、`涉及数据表`、表名、UUID 等）在 DOM 节点中显式添加 `translate="no"` 和 `className="notranslate"`。
3. **最简即正确与高信息密度（Dense & Legible）**：
   - 消灭 CSS 换行坍塌与机械留白，首屏核心决策信息（健康态、异常拦截、慢调用、真实耗时）即时可见。
   - 复杂或低频筛选参数进行折叠收敛，高频操作一键直达。

---

## 3. 详细设计规范

### 3.1 模块一：使用概况（Usage Overview）监控看板重构

#### 3.1.1 KPI 指标区分层重构（主次双区，告别 3×3 机械平铺）
将原本的 9 张平铺卡片重构为 **「一级运行体征（Primary）」** + **「二级资产与活跃画像（Secondary）」**：

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ [一级：运行体征大盘 (Primary 3 Cards)]                                         │
│ ┌─────────────────────────┐ ┌─────────────────────────┐ ┌───────────────────┐ │
│ │ 调用量                  │ │ ACL 拒绝/拦截          │ │ 多数请求耗时 (P95)│ │
│ │ 1,280 次                │ │ 0 次 (正常) / 3 次 (警示)│ │ 420 ms            │ │
│ │ MCP 调用 (近 24 小时)   │ │ 来自审计库直查          │ │ 95% 请求在此内完成│ │
│ └─────────────────────────┘ └─────────────────────────┘ └───────────────────┘ │
├───────────────────────────────────────────────────────────────────────────────┤
│ [二级：资产与活跃画像 (Secondary 3 Compound Cards)]                             │
│ ┌─────────────────────────┐ ┌─────────────────────────┐ ┌───────────────────┐ │
│ │ Agent 资产与活跃        │ │ Token 凭证与活跃        │ │ 授权表与活跃      │ │
│ │ 活跃 12 / 15 个 (80%)   │ │ 活跃 8 / 10 个 (80%)    │ │ 活跃 32 / 40 张   │ │
│ │ 环形/条形活跃进度条     │ │ 活跃率正常              │ │ 活跃率 80% (或前缀)│ │
│ └─────────────────────────┘ └─────────────────────────┘ └───────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

1. **第一层：核心运行体征（Primary Metrics）**：
   - **调用量**：突出显示大字号总量数值，副文标注时间窗（如 `近 24 小时 MCP 调用`）。
   - **ACL 拒绝次数**：当数值为 `0` 时展示正常状态（Success/Neutral tone）；当数值 `> 0` 时采用 Warning/Danger tone 强化异常警示。
   - **多数请求耗时（P95）**：突出显示 `{p95} ms`，副文保留合规提示 `95% 的请求在此时间内完成`；无数据时显示 `—` 并附注 `当前窗口无调用`。
2. **第二层：资产与活跃复合卡片（Compound Asset Cards）**：
   - **Agent 资产画像**：主数值为 `活跃 12 / 总数 15`，副文与微型进度条展示活跃率 `80%`（含未启用标注）。
   - **Token 资产画像**：主数值为 `活跃 8 / 总数 10`，若存在前缀歧义则显示 Partial 警示标签。
   - **授权表资产画像**：主数值为 `活跃 32 / 授权 40`，若包含前缀通配符授权则标注 `前缀授权模式`。

#### 3.1.2 排行榜容器（Top 10 Rankings）弹性自适应与全称 Tooltip
1. **容器高度弹性化**：
   - 废除死板的 `min-height: calc(10 * 1.5rem + ...)` 固定 10 行高度。
   - 改为自适应高度：`min-height: 7rem; max-height: 22rem; overflow-y: auto;`。在仅 1~3 条数据时贴合内容高度，在达到 10 条时保持紧凑并支持平滑滚动。
2. **表名与 Agent 标签全称展示**：
   - 表名过长时使用单行省略（`truncate`），但必须绑定原生 `title` 与 Radix UI `Tooltip`，悬浮即刻查看完整的 `connectionId.schema.table`。
3. **刻度与相对热度增强**：
   - 右侧进度条增加轻量轨道底色与相对最大调用量的比例填充；
   - 在数值侧同时显示调用次数与占比（例如 `45 次 (68%)`），直观呈现流量倾斜程度。

---

### 3.2 模块二：审计抽屉（Audit Drawer）排版与空间紧凑化

#### 3.2.1 根治竖排文字车祸（CSS 渲染保护）
1. **表格单元格排版强保护**：
   - 抽屉内 `调用明细` 表格的 `耗时`、`状态`、`时间`、`数据库连接` 列全部添加 `whitespace-nowrap` 类。
   - 耗时列设置最小宽度 `min-w-[140px]`，保证数值与 Badge 水平并排。
2. **耗时与慢调用 Badge 紧凑表达**：
   - 结构重构为：
     ```tsx
     <div className="flex items-center gap-1.5 whitespace-nowrap">
       <span className="tabular-nums font-mono">{log.durationMs} ms</span>
       {log.isSlowCall ? (
         <span className="pl-status-badge pl-status-partial text-[11px] px-1.5 py-0.25 whitespace-nowrap">
           慢于多数请求
         </span>
       ) : null}
     </div>
     ```

#### 3.2.2 “触达表汇总”空间收敛与内聚
1. **废除底部单行大 Card**：
   - 不再在抽屉最底部单独渲染一个由 `pl-card` 包裹的独立“触达表汇总”。
2. **向上合并至顶部元数据区**：
   - 将触达表清单以紧凑的 Tag 胶囊列表形式，内嵌到抽屉顶部的“基础信息”元数据网格中（位于问询时长、开始时间、Agent 归属旁边）：
     ```tsx
     <div className="flex flex-wrap items-center gap-1.5 mt-1">
       <span className="text-xs text-fg-muted">触达表：</span>
       {detail.sources.map((source, idx) => (
         <span key={idx} className="inline-flex items-center gap-1 rounded bg-bg-muted px-2 py-0.5 text-xs font-mono text-fg-default notranslate" translate="no">
           {source.connectionId ? <span className="text-fg-muted">{source.connectionId} ·</span> : null}
           <span>{source.physicalTable ?? source.physical_table}</span>
         </span>
       ))}
     </div>
     ```
   - 若触达表超过 4 个，默认折叠并提供 `+N 更多` 展开交互。

---

### 3.3 模块三：访问日志表格（Audit Table）横向与信息密度提升

#### 3.3.1 问询 ID（Turn ID）瘦身与交互优化
1. **短 ID 显示与一键复制**：
   - 表格第二列的 `问询 ID` 默认展示短 ID 形态（如 `lucy_be70...` 前 12 位字符），字号调整为 `text-xs font-mono text-fg-muted`。
   - 悬浮在 ID 上展示全量完整 UUID，点击右侧内置复制按钮即刻复制全量 ID 并触发 Toast 提示。
2. **扩大行级下钻点击热区**：
   - 表格整行及“问询摘要”为主点击热区，点击直接唤起问询详情抽屉，无需用户精准点击 ID。

#### 3.3.2 状态语义与计数分离（消除“1 拒绝”歧义）
1. **状态 Tag 语义规范**：
   - **无异常**：展示绿色胶囊 `<span className="pl-status-badge pl-status-done">成功</span>`。
   - **存在拦截**：展示红色胶囊 `<span className="pl-status-badge pl-status-partial">已拦截</span>`，右侧或次行附小字 `<span className="text-xs text-fg-muted tabular-nums">({denied} 次拒绝)</span>`。
   - **存在错误**：展示橙色胶囊 `<span className="pl-status-badge pl-status-validation_failed">异常</span>`，右侧或次行附小字 `<span className="text-xs text-fg-muted tabular-nums">({errors} 次错误)</span>`。

#### 3.3.3 破折号（—）降噪与空态精准语义
1. **未下发请求（拦截）语义**：
   - 当调用因 ACL 规则被直接拒绝时，未下发至实际物理表，“涉及数据表”列显示弱化文本 `未下发`（灰字），替代刺眼的 `—`。
2. **耗时列展示规则**：
   - 存在慢调用时标亮 `含 N 次慢调用`；普通正常请求显示执行总耗时；网关直接拦截且总耗时为 0 时弱化显示 `< 1 ms`。

---

### 3.4 模块四：筛选工具栏（Filter Bar）与快捷时间封装

#### 3.4.1 时间选择器业务化封装（Quick Presets + Popover）
1. **快捷时间分段控制器（Segmented Tabs）**：
   - 顶栏或筛选区默认提供高频快捷时间段：
     `[ 近 1 小时 ] [ 近 24 小时 (默认) ] [ 近 7 天 ] [ 今日 ] [ 自定义 ]`
   - 点击快捷选项时，前端自动计算对应的 `since` 与 `until` ISO 字符串并同步更新 URL 参数。
2. **自定义时间区间 Popover**：
   - 仅当点击 `[ 自定义 ]` 时，唤出包含日历选择与时分下拉的统一设计风格 Popover 浮层，确认后收起并回填格式化文本（如 `08-27 10:00 ~ 13:00`）。

#### 3.4.2 筛选栏单行弹性流式布局 + 高级筛选收纳
1. **首行常用区（统一控件高度 32px，Flex 弹性自适应）**：
   - `[快捷时间胶囊组]` + `[Agent 筛选下拉]` + `[状态筛选下拉]` + `[统一搜索框]` + `[高级筛选 ▾]` + `[清除筛选 (条件非空时显示)]`。
2. **统一搜索框（Smart Unified Search）**：
   - 将原割裂的“按 Key 搜”与“搜索摘要”合并为一个宽体输入框 `搜索问询 ID / 摘要 / 表名`：
     - 若输入以 `lucy_` 开头或符合 UUID 格式，前端自动映射为 `key` 参数；
     - 否则前端自动映射为 `turnSearch` 或 `tableSearch` 参数，避免占用两格输入框。
3. **高级筛选折叠面板（Advanced Drawer Panel）**：
   - 点击 `高级筛选` 展开次级折叠行，收纳低频维度：
     - `调用来源`（MCP 调试台受控试调 / Agent 接入调用）
     - `来源类型`（用户原始问询 / 系统推断问询）
     - `Session ID` / `Client IP`
     - `[ ] 仅看慢于多数请求` 复选框

---

## 4. 全系统术语与 DOM 翻译防御对齐表

| 英文原词 / 概念 | 页面显示术语 | 禁用 / 歧义文案 | DOM 翻译防御 (`notranslate` + `translate="no"`) |
|---|---|---|---|
| Turn ID | 问询 ID | turn id、问题簇 ID | 保护（问询 ID 值） |
| Event ID | 事件 ID | event id | 保护（事件 ID 值） |
| Agent | Agent | 智能体、代理 | 保护 (`Agent` 词汇与 Agent ID) |
| Token | Token | 令牌 | 保护 (`Token` 词汇与 Hash) |
| MCP | MCP | 模型上下文协议 | 保护 (`MCP` 专有名词) |
| P95 Latency | 多数请求耗时 | 响应上限 (P95)、平均响应时间 | 保护 (`P95` 英文缩写) |
| Slow Call | 慢于多数请求 | 慢查询、慢请求 | 文本受控 |
| Tables Touched | 涉及数据表 / 触达表 | 工具/表 | 保护（物理表名） |
| Denied Count | ACL 拒绝次数 | 拦截总数 | 保护 (`ACL`) |

---

## 5. 验收标准与验证方案

### 5.1 验收标准（Acceptance Criteria）
1. **使用概况页 (`/admin/usage`)**：
   - [ ] KPI 指标区分为“运行体征”与“资产底数”两层，无 3×3 九宫格机械平铺。
   - [ ] 排行榜容器在少数据（1~3 条）时紧凑自适应高度，无多余空行灰底；表名悬浮可查看完整 `connection.schema.table`。
2. **问询详情抽屉 (`Audit Drawer`)**：
   - [ ] `慢于多数请求` Badge 在任何窗口宽度下均水平紧凑单行展示，**绝对禁止**纵向单字折行。
   - [ ] 抽屉底部无孤立单行大卡片，触达表已内聚到顶部元数据区。
3. **访问日志主表 (`/admin/audit`)**：
   - [ ] 问询 ID 以短 ID + 复制图标形式展示，摘要列展示宽度大幅提升。
   - [ ] 拒绝状态以 `已拦截 (N 次拒绝)` 形式呈现，语义清晰。
4. **筛选工具栏 (`Filter Bar`)**：
   - [ ] 提供 `近 1 小时 | 近 24 小时 | 近 7 天 | 今日 | 自定义` 快捷时间切换。
   - [ ] 常用筛选区呈单行弹性排列，低频维度收纳至高级筛选面板中。

### 5.2 验证方案
- **单元与组件测试**：运行 `pnpm test webui/src/__tests__/admin-audit-turns.test.tsx` 及 `webui/src/__tests__/admin-usage-overview*.test.tsx`，确保测试通过且契约无断裂。
- **构建校验**：运行 `pnpm build`（或 `npm run build`），确保 TypeScript 类型无错误、CSS 无警告。
