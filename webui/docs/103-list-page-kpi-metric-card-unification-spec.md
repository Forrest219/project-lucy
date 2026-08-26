# List Page KPI Metric Card Unification Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | List Page KPI Metric Card Unification Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `/connections`、`/eval/cases`、`/eval/monitor`、`/admin/usage`、`/admin/agents`、`/admin/roles` KPI 浏览器核查；用户拍板「每卡 ⓘ + 高度一致、Connections 为基准、允许网格数量差异」 |
| 适用范围 | 列表/概览页顶部 KPI 指标卡视觉与交互统一；Design System Metric Card 事实源 |
| 输出位置 | `webui/docs/103-list-page-kpi-metric-card-unification-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 103 |
| 关联工单 | `webui/docs/plans/wo-202608-36-list-page-kpi-metric-card-unification.md` |
| 关联页面 | `/connections`、`/eval/cases`、`/eval/monitor`、`/admin/usage`、`/admin/agents`、`/admin/roles` |
| 关联台账 | `connections.md`、`eval.md`、`admin-governance.md`、`admin-agents.md`；跨页面主题 `list-page kpi metric-card` |
| 上游 Spec | Design System `pl-metric-card` CSS；Spec 20（metric contrast）；Spec 102（overview Ops Metric Row，**范围外**） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | Connections 模板为唯一 List KPI 标准；每卡必有 ⓘ；共享组件；五页收敛；tone 纪律 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地：Connections 基准 + 全卡 ⓘ + 网格数量例外 |

## 1. 背景

六页顶部 KPI 共用 `.pl-metric-card` 外壳，但内容模板分裂：

1. **`/connections`**：标题行 12px muted + ⓘ help + 主值 + 副文；卡内 gap 8px；约 110px 高。
2. **其余五页**：裸 `span` 标题 16px default、无 ⓘ、gap 4px；约 102px 高。
3. **`/eval/monitor`**：成功态整卡绿染；并挂不存在的 `pl-metric-card--default`。
4. 本地 `MetricCard` 至少五份，结构漂移。

用户拍板：**以 Connections 为基准线；每张指标卡加 ⓘ；高度一致；允许不同网格数量。**

## 2. 目标

1. 将 Connections KPI 模板定为 **List Page KPI Card** 唯一标准。
2. 每张卡必须有 ⓘ，tooltip 承载**指标口径**；`small` 承载**当前上下文**（窗口、分母、空态）。
3. 抽出共享 `MetricCard` 组件，六页（含 Connections）共用。
4. 统一卡高：一律 `--with-help`（约 110px）；禁止用 `min-height` 硬撑。
5. 允许网格数量差异：`pl-metric-grid`（默认 4 列）、`--three`（3 列）、2×4（Usage 8 卡）。
6. Tone 纪律：warning 只染主值；danger 可染壳；**成功态默认不整卡染色**。
7. 登记 Design System 章节 + UI/UX 台账。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 不改 `/overview` Ops Metric Row（icon + CTA） | Spec 102；模板不同 |
| 不改 KPI 业务口径 / API 聚合 | 本单只动呈现 |
| 不让 KPI 可点击筛选 | Spec 89 已定静态概览 |
| 不做浏览器验证（本轮） | Vitest + terminology + build + code review |
| 不强制副文换行策略以外的响应式重排 | 桌面优先 |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`.

无新增产品概念。既有术语保持：`Agent` / `Token` / `MCP` / `Role` / `Schema` / `Manifest` / `Case` 等按标准 `notranslate`。

ⓘ tooltip 与副文必须用语标准术语，禁止裸后端枚举（`yaml` / `invalid` / `P95` 作主标签等——P95 解释可放 help，主标签仍用「多数请求耗时」）。

## 5. 统一骨架（List KPI Card）

基准：`/connections` 的 `MetricCard`。

```text
┌─────────────────────────────────┐
│ 标题（12px muted）          ⓘ  │
│ 主值（20px semibold）            │
│ 副文（12px muted，可选）         │
└─────────────────────────────────┘
```

| 槽位 | 规则 |
|---|---|
| 壳 | `.pl-metric-card.pl-metric-card--with-help` |
| 标题行 | `.pl-metric-card-title`：左标题、右 help 按钮 |
| ⓘ | `.pl-icon-help`；`aria-label="{标题} 说明"`；必有非空 tooltip |
| 主值 | `<strong>`；`tabular-nums` 推荐 |
| 副文 | 单个 `<small>`；禁止双 `small`（原 `subline`+`hint` 合并） |
| Tone | 可选 `warning` / `danger` /（稀少）`success` 主值色；成功健康态优先无 tone |

### 5.1 Help vs 副文

| | ⓘ tooltip | `small` 副文 |
|---|---|---|
| 内容 | 指标如何计算、包含/排除什么 | 当前窗口、分母、空态、次级事实 |
| 稳定性 | 相对稳定口径 | 可随数据/窗口变 |
| 禁止 | 空 ⓘ；与副文逐字重复 | 把完整口径塞进副文挤掉上下文 |

### 5.2 Tone

| Tone | 壳 | 主值 | 何时 |
|---|---|---|---|
| （无） | 中性 | default | 默认 / 「正常」健康态 |
| `warning` | **中性壳** | warning 色 | 需关注非故障（缺 Manifest、集中失败等） |
| `danger` | danger 边+软底 | danger 色 | 红线触发等明确故障 |
| `success` | **禁止整卡染色作为默认健康表达** | 仅当产品明确要强调「好」时染主值 | Monitor「失败=0 / 正常」改无 tone |

禁止挂载未定义修饰符（如 `pl-metric-card--default`）。

### 5.3 网格数量（允许差异）

| 场景 | 卡数 | 网格 class |
|---|---|---|
| 标准列表 | 4 | `pl-metric-grid` |
| 三元覆盖度 | 3 | `pl-metric-grid pl-metric-grid--three` |
| 双维度对照 | 8（2×4） | `pl-metric-grid` |
| Connections | 4 | `pl-metric-grid` |

禁止 5/6/7 卡造成残缺行（除非后续 Spec 显式批准）。

## 6. 落地范围（页面）

| 页面 | 卡数 | 变更要点 |
|---|---|---|
| `/connections` | 4 | 改用共享组件；既有 help 文案保留 |
| `/eval/cases` | 3 | 加 ⓘ；标题改 title 行；`--three` 保留 |
| `/eval/monitor` | 4 | 加 ⓘ；去掉 `--default`；健康态去 success 整卡染 |
| `/admin/usage` | 8 | 加 ⓘ；`subline`/`hint` 合并为单一副文 |
| `/admin/agents` | 4 | 加 ⓘ |
| `/admin/roles` | 4 | 加 ⓘ；解析异常仍不因零值 danger |

## 7. 实现约束

1. 共享组件路径：`webui/src/components/MetricCard.tsx`。
2. Connections 页级 `pages/connections/MetricCard.tsx` 改为薄包装或删除并改 import。
3. 页面禁止再定义本地三层 `MetricCard`。
4. Design System：新增 `12-components-metric-card.md`；`20-patterns-page-layout.md` Summary Region 引用本规范。
5. 测试：断言每卡存在 `metric-help-*` 或等价 help 触发器；Connections 既有 tone/metric 断言保持。

## 8. 验收标准

- [ ] 六页 KPI 均为 title + ⓘ + strong + 可选 small。
- [ ] 无裸 16px 默认色标题作为 KPI label。
- [ ] Monitor 健康态无整卡 success 背景。
- [ ] Usage 单卡最多一个 `small`。
- [ ] `npm test`（相关）/ `lint:terminology` / `build` 通过。
- [ ] 台账条目 `Fixed`；跨页面主题已登记。
- [ ] 本轮不做浏览器验证；结束后只做 code review。

## 9. Design System Compliance

- 引用：`design-system/12-components-metric-card.md`（本单新增）、`02-foundations-grid-spacing.md`、`01-foundations-color.md`。
- 遵循：Connections 基准壳与 help 交互；tone 语义；网格数量例外。
- 例外：无。

## 10. 四状态规则补充（Spec 128 Gate A）

从 Spec 128 起，所有 List KPI 的动态审计指标（windowed=true）必须遵守四状态渲染规则：

| state | 主值 | 含义 |
|---|---|---|
| `ok` | 数字 | 正常 |
| `no_data` | `—` | 窗口内无数据 |
| `unavailable` | `—` | 数据源故障，不得用 `?? 0` 归零 |
| `partial` | `—` | 数据不完整/歧义，不得渲染数值估算 |

详细口径与硬规则见 `128-enterprise-kpi-contract-spec.md`。
