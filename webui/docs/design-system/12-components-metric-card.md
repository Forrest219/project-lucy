# Lucy WebUI Metric Card 组件规范

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI Metric Card 组件规范 |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | Spec 103；`/connections` MetricCard；`app.css` `.pl-metric-card*` |
| 适用范围 | 列表/概览页顶部 KPI 指标卡；不含 `/overview` Ops Metric Row |
| 输出位置 | `webui/docs/design-system/12-components-metric-card.md` |

## 1. 目的

统一 List Page 顶部 KPI 卡的结构、字号、help 与 tone，避免页面各自实现导致标题层级与高度漂移。

## 2. 基准

**`/connections` 连接概览 KPI** 为视觉与交互基准线（Spec 103）。

## 3. 结构

```text
.pl-metric-card.pl-metric-card--with-help
  .pl-metric-card-title
    span（标题）
    button.pl-icon-help（ⓘ）
  strong（主值）
  small?（副文）
```

实现组件：`webui/src/components/MetricCard.tsx`。

## 4. Token

| 角色 | 要求 |
|---|---|
| 壳 | `rounded-lg`、`border-border-default`、`bg-bg-subtle`、`p-3`、`shadow-card` |
| 卡内 gap | `--with-help` → 8px（与 Connections 一致） |
| 标题 | 12px / medium / `fg-muted`（经 `.pl-metric-card-title`） |
| 主值 | 20px / semibold / `fg-default`（tone 可覆盖） |
| 副文 | 12px / regular / `fg-muted` |
| Help | 24×24 `.pl-icon-help`；Radix tooltip |

## 5. Help 契约

- **每张 List KPI 卡必须有 ⓘ**，禁止无 help 的 KPI。
- Tooltip = 指标口径；副文 = 当前上下文。禁止空 tooltip、禁止与副文逐字重复。
- `aria-label`：`{标题} 说明`。

## 6. Tone

| Class | 壳 | 主值 |
|---|---|---|
| （无） | 中性 | default |
| `--warning` | 保持中性壳 | warning |
| `--danger` | danger 边+软底 | danger |
| `--success` | 仅在明确强调「好」时使用主值色；**禁止**用整卡绿作为默认健康态 |

禁止未定义修饰符（如 `--default`）。

## 7. 网格

容器：`.pl-metric-grid`（默认 4 列，`gap-3`）。

允许差异：

- `.pl-metric-grid--three`：恰好 3 卡
- 同一网格 8 卡 → 自动 2×4（Usage）

卡高由模板统一（约 110px）；同行 stretch；副文尽量单行。

## 8. 与 Ops Metric Row 的边界

| | List KPI（本章） | Ops Metric Row（Spec 102） |
|---|---|---|
| 页面 | connections / eval / admin 列表概览 | `/overview` 快照 |
| Icon | 无（仅 ⓘ） | 左侧 outline icon |
| CTA | 无 | 右侧居中深链 |
| Help | 必有 ⓘ | 可选 |

不得把 overview 快照卡改成 List KPI，也不得把 List KPI 加上 CTA 冒充 overview。

## 9. 四状态规则（Spec 128 Gate A）

从 Spec 128 起，`MetricCard` 增加 `state?: MetricState` prop。

| state | 主值渲染 | subValue 渲染 |
|---|---|---|
| `ok`（默认） | `value` prop 原样渲染 | 正常口径说明 |
| `no_data` | `—` | "所选范围内无数据" |
| `unavailable` | `—` | `unavailableReason` 或 "数据源不可用" |
| `partial` | `—` | ⚠ + `unavailableReason`（D3：永远不渲染数值估算） |

**硬规则**：

- 动态审计 KPI（windowed=true）当 `state=unavailable` 时，`value` 必须为 `null`，UI 不得用 `?? 0` 强制归零（HR-1）。
- `state=partial` 时主值只能是 `—`，永远不展示数字作为主值（HR-2）。
- Config 类 KPI（windowed=false）不受上述约束，可保持默认 `state="ok"`。
- `help` 现在接受 `ReactNode`（保持 string 向后兼容）。

## 10. 验收

- [ ] 新 KPI 使用共享组件，不复制本地三层结构
- [ ] 每卡有 help 触发器与非空说明
- [ ] tone 符合 §6
- [ ] 网格数量符合 Spec 103 §5.3
- [ ] 动态审计 KPI 不使用 `?? 0` 掩盖 unavailable（Spec 128 HR-1）
