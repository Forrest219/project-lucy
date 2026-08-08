# Lucy WebUI 按钮规范（Components）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI 按钮规范（Components） |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | v1.0（Codex，2026-08-04）；Attu vs Lucy 按钮对比；`webui/docs/101-button-hierarchy-selection-and-icon-affordance-spec.md`；`UX-CONNECTIONS-023`、`UX-OVERVIEW-008`、`UX-WIKI-037`、`UX-CATALOG-021` |
| 适用范围 | Lucy WebUI 所有按钮、图标按钮、按钮组、选中控件与按钮状态设计与实现 |
| 输出位置 | `webui/docs/design-system/10-components-button.md` |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：primary/secondary/ghost/danger 与同组层级 |
| v1.1 | Spec 101：选中态分离、Header 动作预算、`pl-icon-btn`、loading/disabled 可解释性 |

## 1. 设计目标

- 保证按钮语义与视觉层级一一对应。
- 避免同组操作出现误导性显著性。
- 区分「主路径动作」与「当前选中状态」。
- 工具型动作优先图标化，控制 PageHeader 密度。
- 提升跨页面一致性和可预测性。

## 2. 按钮语义与类型

| Variant | Class | 用途 |
|---|---|---|
| `primary` | `pl-btn pl-btn--primary` | 唯一主路径动作（提交确认、发布、完成关键步骤、页面声明的下一步） |
| `secondary` | `pl-btn pl-btn--secondary` | 并列维护动作（查看、复制、新增、打开详情、导出等） |
| `ghost` / link | `pl-btn pl-btn--ghost` / `pl-row-action-link` | 低干扰辅助动作、行内动作 |
| `danger` | `pl-btn pl-btn--danger` | 删除、禁用、清空、不可逆风险动作 |
| `icon` | `pl-icon-btn` | 工具型无可见文案动作（刷新、复制、更多、关闭）；必须 `aria-label` + tooltip |

尺寸修饰：`pl-btn--sm`、`pl-btn--xs`（既有约定保留）。

## 3. 层级规则（强约束）

1. 同一 `action group` 内最多一个 `primary`。
2. 并列维护动作默认全部 `secondary`，不得混入 `primary`。
3. 只有存在「唯一推荐下一步」时才允许 `primary`。
4. `danger` 不与普通主操作并排混淆；必要时二次确认。
5. 同组按钮尺寸（高度、圆角、内边距）必须一致；**文案 secondary 与 icon-btn 并存时**，高度对齐到 32px 节奏即可，不要求同宽。
6. 文案使用动词开头，避免模糊词（例如「刷新」应明确对象范围；icon-btn 的范围写在 `aria-label` / tooltip）。
7. **选中态分离**：禁止用 `primary` / `danger` 表达筛选、Tab、域名、时间窗、视图的「当前选中」。必须使用 `pl-segmented-control`（或已登记等价 recessed pill）。
8. **PageHeader 动作预算**：可见动作控件 ≤ 3（不含状态徽标）；至多 1 primary + ≤ 2 secondary/ghost/icon；超出进「更多」（溢出菜单实现见 Spec 101 Wave C）。
9. 工具刷新 / 复制 / 更多优先 `pl-icon-btn`，避免挤占 Header 文案宽度。

## 4. 交互状态

每个按钮类型都必须定义并验证：

- `default`
- `hover`
- `active`
- `focus-visible`
- `disabled`
- `loading`

实现要求：

- `loading` 时设置 `data-loading="true"` 与 `aria-busy="true"`；宽度应尽量稳定（锁 `min-width` 或固定预设），防止布局抖动。
- `disabled` 需视觉可识别，且屏蔽触发行为。
- 若存在可解释前置条件，disabled 必须提供 tooltip 或 `aria-describedby`（例如「请先选择至少一个对象」）。
- `focus-visible` 必须清晰可见，不得被容器裁切。
- `pl-icon-btn` 无可见文案时，`aria-label` 为强制项；tooltip 在 hover/focus 可见。

## 5. 按钮组与选中控件布局

- 按钮组默认横向排列，间距统一（建议固定 gap）。
- 主按钮位置在同一产品区域内保持一致（推荐右侧 / 组末，除非页面 Spec 另有声明）。
- 当断点导致换行时，保持视觉顺序和语义顺序一致。
- Segmented control：浅底轨道 + 选中项白底浮起；**不得**用主色实心填充冒充 primary。
- ToolBar 节奏（参考 Attu）：主创建类动作偏左或 Header 右区主位；搜索/筛选偏右；刷新为 icon。

## 6. 适配 Lucy 当前页面的落地约定

- `/connections`：`+ 添加 Schema` 为 `secondary` 文案按钮；`刷新本地目录` 为 `pl-icon-btn`（Spec 101）。
- `/overview`：`复制 MCP 配置` 与 `查看配置` 为并列 `secondary`；`刷新首页数据` 为 `pl-icon-btn`，与「上次更新」徽标同组邻接。
- `/wiki` 阅读态：唯一 `primary` = `编辑`（Spec 81）。
- `/eval/cases`：域名切换用 `pl-segmented-control`，禁止 primary 表示选中（Spec 101）。
- 后续新增「复制/刷新/查看/新增」类组合：并列维护用 `secondary`；纯工具刷新/复制优先 icon-btn。

## 7. Do / Don’t

- Do：同组并列维护动作统一 `secondary`。
- Do：把真正关键、唯一的下一步放为 `primary`。
- Do：筛选 / Tab / 时间窗用 segmented，选中态与主按钮分离。
- Do：Header 工具动作用 `pl-icon-btn` + 中文 `aria-label`。
- Don’t：仅因「看起来更显眼」就把并列动作升成 `primary`。
- Don’t：在同组放两个及以上 `primary`。
- Don’t：用 `primary` 表示「当前选中」。
- Don’t：用颜色替代语义（例如普通操作误用 `danger` 色）。
- Don’t：无障碍名称缺失的纯图标按钮。

## 8. 验收清单（PR 必填）

- 是否存在同组多个 `primary`？
- 是否把并列维护动作错误地设置为主按钮？
- 是否用 `primary` 表达了选中态？
- PageHeader 可见动作是否 ≤ 3？工具动作是否优先 icon-btn？
- disabled 是否解释原因（若有前置条件）？
- 是否覆盖了 hover/focus/disabled/loading 状态？
- 是否保证断点下按钮组顺序和可达性？
- 是否新增或变更了用户可见文案，并通过术语 lint？

## 9. 回归与治理

- 本规范为按钮组件事实源；若实现与规范冲突，先修实现。
- 功能 Spec（如 Spec 101）可约束首批落地页；长期规则以本章为准。
- 若出现新交互模式未覆盖，先在 `99-governance.md` 记录临时决策，再升级本规范。
- 相关跨页面主题：`button hierarchy consistency`、`button semantic consistency`、`selection-control not primary`、`header action budget`、`icon-button affordance`、`disabled action explainability`。
