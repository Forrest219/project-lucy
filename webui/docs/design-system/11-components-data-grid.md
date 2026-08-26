# Lucy WebUI 数据网格规范（Data Grid）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI 数据网格规范（Data Grid） |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/src/app/app.css`、`/connections` `/connections/enabled-tables` `/catalog` 网格一致性核查、`webui/docs/72-connections-catalog-grid-visual-consistency-spec.md` |
| 适用范围 | Lucy WebUI 所有数据网格（Table/Data Grid）组件与页面 |
| 输出位置 | `webui/docs/design-system/11-components-data-grid.md` |

## 1. 目的

统一 Lucy WebUI 的数据网格视觉、信息层级和交互语义，避免跨页面出现字号、字重、行高、列宽和对齐规则漂移。

本规范是 WebUI 网格设计的长期事实源；业务 spec 可以扩展场景，但不应重复定义基础网格 token。

## 2. 适用范围

适用于以下类型页面：

- 列表页（如 `Catalog`、`启用表范围`）
- 工作台页中的结构化表格（如 `连接概览` 的 Schema 资产表）
- 任意以行列呈现结构化实体的网格

不适用于：

- 纯卡片流布局
- 非结构化富文本展示区

## 3. Base Contract

默认网格必须复用共享契约（或等价抽象）：

- 基类：`pl-data-grid`
- 语义扩展类：按页面职责追加（如 `pl-catalog-table`、`pl-data-table`、`pl-schema-asset-table`）
- 禁止跳过基础类另起一套独立表格基线

## 3.1 Frame and Overflow

L1 页面数据网格外框与滚动层：

- `pl-data-grid-frame`：边框、圆角、surface 背景与 padding 的视觉容器；不设置固定高度。
- `pl-data-grid-scroll`：唯一普通横向滚动层；不得在其外层再包一层 `overflow-x-auto`。
- 高列数 / 高行数的访问日志网格可叠加 `pl-audit-grid-scroll`（有界双向滚动 + sticky 表头），但禁止嵌套第二层滚动元素。
- 宽表允许横向滚动；禁止为了单屏展示牺牲完整 ID、调查列或可读性。
- 确实可能滚动的区域（配置审计、访问日志）必须可聚焦（`tabIndex={0}`）并具备业务化 `aria-label`；普通不滚动表格不增加无意义 tab stop。

桌面验收基线：1440×900、1280×800。移动端 / 窄于 1280 不在本契约范围内。配置审计的关键字段允许换行完整保留；访问日志保留宽表滚动（含「访问上下文」等调查列）。

## 4. Typography 与密度

### 4.1 表头

- `font-size: 12px`
- `font-weight: 600`
- `line-height: 16px`
- `padding-y: 8px`
- 文本颜色：`text-fg-muted`

### 4.2 正文

- `font-size: 12px`
- `font-weight: 500`（允许局部正文为 `400`，但必须保持同页一致）
- `line-height: 16px`
- `padding-y: 8px`
- 文本颜色：`text-fg-default`

### 4.3 行高

- 默认目标行高约 `33px`（由 line-height + padding 推导）
- 同一页面同类网格不得出现明显密度跳变

### 4.4 信息层级（名称列 vs 数量列）

同一行内必须保持“主标识 > 次级指标”的视觉权重，避免数量列压过名称列。

| 列角色 | 典型内容 | 视觉规则 |
|---|---|---|
| 主标识列 | Schema / 表名等对象标识 | `text-fg-default`；可 `font-medium`；数据库对象名可用 `font-mono` |
| 数量列 | 本地表数、启用表数、字段数、引用数 | `text-fg-body` + `font-weight: 400`；可用 `tabular-nums` |
| 操作列 | 行内链接 / 按钮 | 弱于主标识；可点击性靠颜色/hover/underline，不靠更粗字重 |

约束：

- 验收看相对层级，不只看 computed color 是否相同。等宽字体与无衬线字体在同色同字重下仍可能产生光学权重差。
- 数量列不得比主标识列更抢眼（更深、更粗、更大）。
- 漂移/告警等例外状态可临时提高数量列强调（如 warning tone），但默认态必须回到次级样式。

## 5. 对齐原则

- 文本列：左对齐
- 数值列（数量、计数、引用数）：右对齐（推荐 `tabular-nums`）
- 状态列：左对齐（Badge + 文案）
- 操作列：左对齐

## 6. 列宽策略

采用语义列模板，避免页面任意拉伸：

- 选择列：`48~64px` 固定窄列
- 名称列：`minmax(240px, 1fr)` 弹性主列
- 数值列：`120~160px` 固定宽
- 状态列：`160~220px` 固定宽
- 操作列：建议 `180~260px`，超出应折叠次级动作

禁止操作列无上限扩张，挤压主信息列。

## 7. 状态与交互

- 行 hover：仅做轻量背景提示，不应改变文本层级
- 链接可点击性优先通过颜色/下划线/hover/focus 表达，不依赖过度加粗
- 行内动作保持弱层级，避免与页级主操作冲突

## 8. 可访问性与翻译防御

### 8.1 可访问性

- 表头必须具备清晰列名语义
- 操作按钮/链接具备可读名称
- 焦点顺序遵循从左到右、从上到下阅读流

### 8.2 翻译防御

以下内容需 `notranslate` / `translate="no"`：

- 数据库对象名（Connection/Schema/Table）
- 路径、文件名、URL、技术术语英文标识

## 9. 实施与代码约束

- 页面新增网格时，优先扩展 `pl-data-grid`，不得复制粘贴新基线样式
- 局部特化只能覆盖业务差异（例如某列布局），不得重写全套 typography token
- 对旧页面改造时，先收敛基线，再做业务细化

## 10. 测试契约

每个网格页面至少包含以下一类断言：

1. 结构契约：表格 class 包含 `pl-data-grid`
2. 对齐契约：数值列具备右对齐 class 或列配置
3. 视觉契约：CSS 规则不回退到历史反模式（例如 `14px` 正文大表格）

建议在相关测试文件中直接断言 class contract，必要时补充 CSS 规则文本断言。

## 11. 与其他章节关系

- 色彩语义：遵循 `01-foundations-color.md`
- 间距与断点：遵循 `02-foundations-grid-spacing.md`
- 字重层级：遵循 `03-foundations-typography.md`
- 页面信息架构：遵循 `20-patterns-page-layout.md`

## 12. Non-Goals

- 本文不定义业务字段含义和数据口径
- 本文不规定后端接口结构
- 本文不覆盖移动窄屏专项适配策略
