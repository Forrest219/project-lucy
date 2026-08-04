# Connections and Catalog Grid Visual Consistency Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connections and Catalog Grid Visual Consistency Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `http://127.0.0.1:55176/connections`、`http://127.0.0.1:55176/connections/enabled-tables`、`http://127.0.0.1:55176/catalog`；`webui/src/app/app.css`；相关页面组件与测试 |
| 适用范围 | 统一三页网格视觉规范与实现约束，指导后续样式收敛和回归验证 |
| 输出位置 | `webui/docs/72-connections-catalog-grid-visual-consistency-spec.md` |

| 字段 | 内容 |
| --- | --- |
| Spec 编号 | 72 |
| 关联工单 | `webui/docs/plans/wo-202608-04-connections-catalog-grid-visual-consistency.md` |
| 关联页面 | `/connections`、`/connections/enabled-tables`、`/catalog` |
| 状态 | Draft |
| 日期 | 2026-08-04 |
| 范围 | 网格字体、字重、颜色、对齐、列宽、行高与视觉密度统一 |

## 1. 背景

浏览器核查确认三页都存在高密度数据网格，但视觉基线并不一致。`/connections/enabled-tables` 与 `/catalog` 已基本共享同一网格体系，而 `/connections` 的 Schema 资产表仍沿用另一套正文样式：

- `/connections`：body `14px / 400 / line-height 20px / padding-y 6px`。
- `/connections/enabled-tables` 与 `/catalog`：body `12px / 500 / line-height 16px / padding-y 8px`。

该差异导致同一信息架构下的视觉节奏不一致，用户在页面切换时会感知到“行密度、字重、强调层级”跳变。

## 2. 目标

1. 统一三个页面网格的 typography、密度和对齐原则，形成同一产品语义层级。
2. 让表头、正文、状态、操作列在三个页面中具有可预测且一致的视觉权重。
3. 收敛列宽策略，避免“操作列过宽挤压信息列”等页面特定漂移。
4. 建立可测试的样式契约，防止后续回归。

## 3. 非目标

- 不新增后端 API，不修改数据返回结构。
- 不改变三页业务流程（连接维护、启用表切换、语义维护入口）。
- 不做移动窄屏专项适配与验证。
- 不重做导航或页面级布局，仅聚焦网格系统。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

文案与标识要求：

- 保持 `Schema`、`Manifest`、`Table`、`Agent`、`Catalog` 等术语与既有标准一致。
- 表名、Schema 名、路径、英文术语继续加 `notranslate` / `translate="no"` 防御。

## 5. 现状差异（核查结论）

### 5.1 字体与密度

- `/connections` 正文字号与行高偏大，行内信息密度明显低于另两页。
- `/connections/enabled-tables` 与 `/catalog` 的正文字号、字重、行高、padding 基本一致。

### 5.2 颜色与层级

- 三页表头均为 `12px / 600` 与灰色标题文本，头部层级相对一致。
- `/connections` 正文颜色与分隔线颜色更深，导致整体对比更重。

### 5.3 列宽与对齐

- 三页均以左对齐为主，缺少“数值列统一右对齐”的明确规则。
- `/connections` 的操作列占比偏高（当前可达 ~535px），与另外两页策略不一致。

## 6. 统一视觉规范（目标态）

### 6.1 网格基础 Token

统一到共享数据网格 token（建议复用 `pl-data-grid` 体系）：

- Header：`font-size 12px`, `font-weight 600`, `line-height 16px`, `padding-y 8px`。
- Body：`font-size 12px`, `font-weight 500`, `line-height 16px`, `padding-y 8px`。
- Row height：约 `33px`（由 line-height + padding 推导）。
- Border/text color：统一来自同一组语义 token，不允许页面级硬编码分叉。

### 6.2 对齐规则

- 文本列：左对齐。
- 数值列（表数、字段数、引用数等）：右对齐。
- 状态列：左对齐（badge + 文案）。
- 操作列：左对齐，动作组间距统一。

### 6.3 列宽策略

采用“语义列模板”而非页面随意拉伸：

- 选择列：固定窄宽（`48~64px`）。
- 名称列：`minmax(240px, 1fr)`。
- 数值列：固定宽（`120~160px`）。
- 状态列：固定宽（`160~220px`）。
- 操作列：建议 `180~260px`，超出使用折叠菜单或换行策略，不允许无限扩展。

## 7. 实施要求

### 7.1 组件与样式收敛

- 优先让 `/connections` 表格复用 `pl-data-grid` 的共享类或抽象 `BaseDataGrid`。
- 保留 `pl-schema-asset-table` 的业务语义类，但移除独立 typography 基线。
- 将网格 token 放入统一 CSS 作用域，避免散落在各页面局部类。

### 7.2 测试与验收

新增/更新测试，至少覆盖：

- 三页目标表格使用一致的 header/body class contract。
- `/connections` 不再出现 `14px` 正文样式契约。
- 数值列具有明确对齐 class（如 `text-right`）。
- 操作列宽度受上限约束（以 class 或列配置断言）。

## 8. 验证命令

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/connection-overview.test.tsx src/__tests__/connection-enabled-tables.test.tsx src/__tests__/catalog.test.tsx
npm run build
git diff --check
```

若 `connection-enabled-tables` 测试文件名与仓库实际不一致，应以实际测试文件替换命令目标。

## 9. 浏览器验收清单

1. 打开 `http://127.0.0.1:55176/connections`，确认表格正文为 `12px` 基线且行密度与另外两页一致。
2. 打开 `http://127.0.0.1:55176/connections/enabled-tables`，确认未因收敛产生回归。
3. 打开 `http://127.0.0.1:55176/catalog`，确认与前两页网格层级一致。
4. 对比三页：表头、正文、状态 badge、操作列在视觉上无突兀跳变。
5. 不做移动窄屏专项验证。

## 10. 风险与边界

- `/connections` 可能依赖现有更大字号承载局部信息；统一后需检查可读性与截断策略。
- 操作列压缩后可能出现动作拥挤，需按优先级折叠次级动作。
- 若多个组件共享旧类名，CSS 收敛必须做作用域控制，避免跨页误伤。
