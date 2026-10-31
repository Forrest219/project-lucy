# Lucy WebUI 设计规范治理（Governance）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI 设计规范治理（Governance） |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-04；2026-10-30 增补 TD-20261030-01（发布工作台三栏与宽确认侧栏） |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | 现有开发治理规则与 UI/UX Ledger 维护方式 |
| 适用范围 | Design System 的维护、升级、例外与回归流程 |
| 输出位置 | `webui/docs/design-system/99-governance.md` |

## 变更原则

- 先规范，后实现：新增视觉模式前先补规范。
- 小步迭代：优先补最小可执行条目，再逐步细化 token 与示例。
- 单一事实源：规范正文只维护在 `webui/docs/design-system/`。

## 提交流程

1. 在相关章节补充或修订规范条目。
2. 在实现 PR 中增加 `Design System Compliance` 小节：
   - 引用章节
   - 说明遵循点
   - 说明例外点（如有）
3. 通过最小回归（组件测试/页面测试/术语 lint）。

## 临时决策机制

当需求涉及未覆盖模式时：

1. 先在本文件记录临时决策（含背景、范围、失效条件）。
2. 标记负责人和升级期限。
3. 在下一个迭代将临时决策升级为正式规范章节。

### 当前临时决策

| 编号 | 模式 | 背景与范围 | 约束 | 负责人 / 失效条件 |
|---|---|---|---|---|
| TD-174-01 | 页面分区静态占位 + 120 ms 延迟局部加载文字（`AsyncRegion`） | Spec 174：`/connections`、`/catalog`、`/overview`、Agent 列表首屏不再整页等待；仅用于这四页的数据区 | 占位立即出现、固定尺寸、无动画；120 ms 后才出现「正在加载…」；`aria-busy` 只在对应区域；错误留在依赖模块并提供「重试」；已有数据后台刷新不替换主内容；占位不得复用真实内容的 `data-testid`；沿用 existing tokens，不改 Spec 142 布局层级 | Spec 174 执行者；Spec 174 关闭时升级到 `20-patterns-page-layout.md` 或移除本条 |
| TD-187-01 | 访问关系图授权层／访问层双系列与信号样式 | Spec 187 v0.3：同一流带容器叠加授权骨架与访问内核；仅用于 v0.25 P1 访问关系图设计（2026-10-25 需求审查已签核通过，设计口径），不代表组件已实现 | 新增语义角色 `series/grant`、`series/access`，各含 `default` / `subtle`；**僵尸授权的流带本体用 `series/grant` 的 `default`**（与正常授权同色，状态由卡片上的「僵尸授权」文字承担，见 [呈现修订 Spec §5.3](../../../docs/specs/lucy-20261030-access-map-quiet-reading-spec.md)）；需复核用 `warning`，确凿越权用 `danger`；需复核虚线、确凿越权实线；禁止裸 hex；状态必须同时有文字或线型，不只靠颜色；实施时验证对比度 | Spec 187 执行者；Spec 187 实施验收时升级到 `01-foundations-color.md` 或移除本条 |
| TD-188-01 | 侧栏底部账户菜单 | Spec 188：将账户信息、系统手册和退出登录合并为单一入口 | 单行低干扰按钮；Portal 浮层向上展开，宽 288px、视口边距和入口间距 8px；沿用语义色、圆角及阴影；高度受可用空间约束、内部滚动；完整键盘访问与焦点归还；开放模式及未登录保留独立手册 | Spec 188 执行者；下一次导航组件规范迭代时升级为正式章节并移除此条 |
| TD-20261029-01 | 筛选栏文本输入框的 `value` 源（URL 驱动 vs 局部状态镜像） | Spec [`lucy-20261029-url-driven-input-ime-composition-spec.md`](../../../docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md)：受控文本输入框的 `value` 取自路由状态时，React 会在「旧 URL 值渲染的那一帧」写 `node.value`，Chrome 随即**取消进行中的 IME 组合**（中文输入法组合被打断）。范围：全站筛选栏的**文本**输入框；不含 `<select>`／勾选框／日期等非文本输入与非受控输入框 | **筛选栏文本输入框的 `value` 必须由局部状态驱动，URL 作为下游事实源跟随**；禁止把 `value` 直接绑到 `searchParams.get(...)` 派生变量；规范化（trim／大小写／拆分／过滤）只发生在下游消费点，不得写回受控 state 或 URL；清除筛选必须对每个镜像调用 `reset` | 2026-10-30 执行者；[`14-components-filter-input.md`](14-components-filter-input.md) 落地后本条改为指向该章节。该章落地前的事实源是上述 Spec §5 |
| TD-20261030-01 | 发布工作台三栏布局与宽确认侧栏（固定页头页脚 + 单一正文滚动） | Spec [`lucy-20261030-publish-workbench-three-column-spec.md`](../../../docs/specs/lucy-20261030-publish-workbench-three-column-spec.md) §4／§4.5：仅用于 `/publish/workbench` 一页。三栏为「待发布变更 / 生效准备 / 最近发布」，12 列网格下的 4/5/3 初始比例；确认侧栏为本页限定的宽面板 | **三栏使用本页专属 class `.pl-publish-workbench-layout`，禁止修改共享的 `.pl-review-layout`**；**宽确认侧栏的宽度由组件内联给出（目标 880px、最大 960px、不超过视口宽减 48px），禁止修改共享的 `.pl-drawer-panel`**；确认侧栏页头与页脚固定在面板内，**正文是唯一纵向滚动区**（`min-height: 0` + `overflow-y: auto`）；不为多显示几列压缩正文字号，不套用高密度 Data Grid 的字号压缩规则；完整表名与原因默认可见、可换行，不能只依赖 hover；**确认列表不得静默截断**（禁止 `slice(0, 8)`），搜索与折叠只过滤展示、不得缩小提交范围 | 2026-10-30 执行者；本模式在 [`20-patterns-page-layout.md`](20-patterns-page-layout.md) 落地为正式章节后移除本条。落地前的事实源是上述 Spec §4／§4.5 |

## 与 UI/UX Ledger 的关系

- `docs/ui-ux-feedback/` 负责记录问题与验收事实。
- `webui/docs/design-system/` 负责沉淀可复用规则。
- 每个跨页面主题在关闭前应尽量落到 Design System 对应章节。

## 版本策略

- `v1.x`：兼容增量，补条目、补示例、补约束。
- `v2.0`：若存在大规模重构或 token 体系迁移，再做主版本升级。
