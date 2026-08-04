# Table Semantic Workbench Density and Joins Inline Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Table Semantic Workbench Density and Joins Inline Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders`；`docs/ui-ux-feedback/pages/catalog.md` `UX-CATALOG-021`–`026`；用户确认 1–5 按建议落地、6 以本次要求为准并修正 `UX-CATALOG-011` 历史冲突 |
| 适用范围 | `/catalog/:conn/:schema/:table` 单表语义工作台：动作区按钮语义、基础语义、字段密度、指标/分群文案、关联内联维护 |
| 输出位置 | `webui/docs/73-table-semantic-workbench-density-and-joins-inline-spec.md` |

| 字段 | 内容 |
| --- | --- |
| Spec 编号 | 73 |
| 关联工单 | `webui/docs/plans/wo-202608-06-table-semantic-workbench-density-and-joins-inline.md` |
| 关联页面 | `/catalog/:conn/:schema/:table`；兼容入口 `/joins/:conn/:schema/:table` |
| 状态 | Implemented (non-browser verified; browser pending) |
| 日期 | 2026-08-04 |
| 关联 ledger | `UX-CATALOG-021`–`026`；修正 `UX-CATALOG-011` |

## 1. Background

2026-08-04 对单表语义工作台的浏览器 + 代码核查确认六项反馈均属实（见 `docs/ui-ux-feedback/pages/catalog.md`）。用户确认：

- 1–5 按建议落地；
- 6（关联内联）以本次要求为准，并修正与 `UX-CATALOG-011`（此前把候选关联移出表页）的历史冲突。

本 Spec 收敛动作区按钮语义、基础语义（表描述 / 行粒度）、字段列表密度、指标/分群业务价值文案，以及关联维护 IA。

## 2. Goals

1. Header 动作组中 `导入 YAML` / `导出 YAML` / `校验` 统一为 `secondary`；`保存` 保留唯一 `primary`；`校验` 具备可发现用途说明。
2. `基础语义` 表描述复用字段级 DB / AI / Human 三段式，并支持采纳 AI。
3. `行粒度` 从当前表字段多选，禁止自由文本手打。
4. `字段` 改为表格行密度布局，保留筛选、选择与批量采纳 AI；选择列用途可发现。
5. `指标` / `分群` / `关联` 补充一句业务价值说明，同时保留必要的写入路径提示。
6. 将关联维护（已确认 + 候选）内联进 `关联` tab；`/joins/...` 降级为兼容跳转；明确候选关系为字段名启发式，不冒充强语义推断。

## 3. Non-goals

- 不新增后端 API，不改 YAML overlay / candidates sidecar 数据契约。
- 不恢复表页首屏的「待处理建议」banner（`UX-CATALOG-011` 的噪声顾虑仍成立；候选只出现在 `关联` tab 内，并带启发式说明）。
- 不做移动窄屏专项适配或浏览器验证（本轮约束：结束后仅 code review）。
- 不重做右侧 `变更审阅` Inspector。
- 不引入新的设计系统按钮类型。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

文案与标识要求：

- 继续使用 `导入 YAML` / `导出 YAML` / `校验` / `保存`、`基础语义`、`字段`、`指标`、`分群`、`关联`、`行粒度`、`人工描述 (Human)`、`AI 建议描述`、`物理注释 (DB)`。
- 候选关联说明必须标明「字段名启发式 / 非强语义推断」。
- Connection / Schema / 表名 / 字段名 / 路径 / YAML 节点继续 `notranslate` / `translate="no"`。

## 5. Design System Compliance

引用：

- `webui/docs/design-system/10-components-button.md`：同组并列维护动作统一 `secondary`；同组最多一个 `primary`。
- `webui/docs/design-system/11-components-data-grid.md`：字段列表采用表格行密度；选择列窄列；表头可 sticky。
- `webui/docs/design-system/00-principles.md` / ledger `UX-CATALOG-015`：生产 UI 用短句表达业务价值，不写研发 spec 长文。

## 6. Target Behavior

### 6.1 Header actions (`UX-CATALOG-021`)

| 按钮 | variant | 说明 |
|---|---|---|
| 导入 YAML | `secondary` | 并列维护 |
| 导出 YAML | `secondary` | 并列维护 |
| 校验 | `secondary` | 并列维护；tooltip：对当前草稿运行语义 YAML 结构与规则校验，不写入文件 |
| 保存 | `primary` | 唯一主路径 |

### 6.2 Overview — table description (`UX-CATALOG-022`)

- 展示：物理注释 (DB) / AI 建议描述 / 人工描述 (Human)。
- Human 可编辑；AI / DB 只读。
- 有 AI 时提供「采纳 AI 描述」/「覆盖为 AI 描述」。
- Human 初始仍只载入 `descriptions.human`（M9 约束不变）。

### 6.3 Overview — grain (`UX-CATALOG-023`)

- UI：从 `source.model.columns` 多选（chip + 候选列表）。
- PK 字段优先排序。
- 已保存但不在当前字段列表的历史 grain 值仍可见，并标注「字段已不存在」。
- `patch.grain` 只写入真实字段名；历史缺失字段在保存前应从选择中移除或明确排除。

### 6.4 Columns — table density (`UX-CATALOG-024`)

- 根节点使用表格语义（`<table class="pl-data-grid ...">` 或等价 `role="table"`）。
- 列：选择 | 字段名(+徽章) | 物理注释 | AI 建议(+采纳) | 人工描述。
- 人工描述默认单行，可展开多行。
- 工具条保留筛选 / 全选 / 清空 / 批量采纳；补充「勾选后可批量采纳 AI 描述」。
- thead sticky（表格容器内滚动时）。

### 6.5 Measures / Segments / Joins copy (`UX-CATALOG-025`)

每段短文案结构：

1. 一句业务价值；
2. 一句写入路径（可继续用 Overlay badge + 短句）。

示例口径（实现可微调，须过术语 lint）：

- 指标：定义可复用聚合口径，供数据问答与报表复用；修改写入 overlay 指标段。
- 分群：定义可复用筛选条件，保证跨场景口径一致；修改写入 overlay 分群段。
- 关联：声明表间连接，支撑跨表问答与分析；正式关系写入 overlay，候选先存 sidecar。

### 6.6 Joins inline (`UX-CATALOG-026`，修正 `UX-CATALOG-011`)

- `关联` tab 内联：
  - 已确认关系（只读列表 + 既有确认流程入口）；
  - 候选关系（sidecar + 字段名启发式），带「字段名启发式，非强语义推断」说明；
  - 操作：保留为候选 / 标记为不采用 / 确认写入语义层。
- 移除「打开关联关系」跳转按钮。
- Header 更多菜单「关联关系」改为切到本页 `关联` tab，不再跳 `/joins/...`。
- `/joins/:conn/:schema/:table` 兼容重定向到 `/catalog/:conn/:schema/:table?tab=joins`。
- **不**在表页首屏恢复「待处理建议」banner（保留 `UX-CATALOG-011` 对首屏噪声的有效约束）。

## 7. Acceptance Criteria

非浏览器验收（本轮）：

1. `npm test -- src/__tests__/table-editor.test.tsx` 全绿（含新增/翻转断言）。
2. `npm run lint:terminology` 通过。
3. `npm run build` 通过。
4. `git diff --check` 通过。
5. Code review 覆盖术语、按钮语义、字段表密度、关联内联与历史冲突修正说明。

浏览器验收（本轮不做，ledger 停在 `Fixed`）：

见各 `UX-CATALOG-021`–`026` 的 Browser Check。

## 8. Ledger Updates

- `UX-CATALOG-021`–`026`：实现后标 `Fixed`（待浏览器复核升 `Verified`）。
- `UX-CATALOG-011`：Notes 追加「2026-08-04 被 `UX-CATALOG-026` / Spec 73 部分修正：候选关联回到 `关联` tab 内联维护，但仍禁止首屏 banner」。
