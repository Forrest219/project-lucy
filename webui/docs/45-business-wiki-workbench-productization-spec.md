# Business Wiki Workbench Productization Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Business Wiki Workbench Productization Spec |
| 文档类型 | Product / UX / Frontend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-01 |
| 关联页面 | `/wiki` |
| 关联工单 | `webui/docs/plans/wo-M42-business-wiki-workbench-productization.md` |
| 事实源 | 浏览器核查：`http://localhost:5174/wiki`、`/wiki?key=global%2Fksc-financial-analysis-playbook.md`、`/wiki?key=global%2Fnew-note.md`；源码定位：`webui/src/pages/WikiEditor.tsx`、`webui/src/components/WikiReadView.tsx`、`webui/src/components/WikiEditView.tsx`、`webui/src/components/WikiTree.tsx`、`webui/src/lib/wiki.ts`、`webui/src/app/app.css` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/13-business-wiki-ux-refactor.md`、`webui/docs/36-business-wiki-read-edit-workbench-spec.md`、`webui/docs/37-sidebar-navigation-ia-consolidation-spec.md`、`webui/docs/42-page-header-standardization-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 问题背景

M33 已把 `/wiki` 从早期 Markdown 文件编辑器升级为默认阅读、按需编辑的业务 Wiki 工作台，并落地了 `WikiReadView`、`WikiEditView`、`WikiTree`、`WikiSavePreflight` 等基础组件。2026-08-01 浏览器核查显示，页面能力已经成立，但企业后台常用任务仍被过多状态、重复路径和首屏元信息噪声打断。

本轮核查使用 1280 x 720 视口，观察到以下具体问题：

1. `/wiki` 阅读态 PageHeader 右侧同时展示状态徽章 `阅读态 / 已保存`、模式 Tab `阅读态 / 编辑态`、动作 `+ 新建 Wiki / 编辑`。状态、模式和动作混在同一视觉层级。
2. 编辑态 PageHeader 仍保留 `阅读态 / 编辑态` Tab，并展示 `+ 新建 Wiki / 返回阅读 / 保存预检`，与编辑任务的主流程不一致。
3. 左侧 Wiki 目录顶部仍展示“页面路径”输入框，例如 `global/ksc-financial-analysis-playbook.md`，其下才是搜索框。路径已在面包屑和文档 Header 出现，左侧重复占用高度且像可编辑控件。
4. KSC 文档有 12 个 `sl_refs`，每个 Chip 都重复显示 `未知语义对象`。关联语义对象区域高约 152px，将正文首个标题推到 y 约 400px。
5. 编辑态保留全局主菜单约 216px、Wiki 目录约 240px，Markdown 源码与渲染预览各自约 336px 宽；长文编辑时横向空间明显不足。
6. `文档信息` 折叠条位于 Markdown 编辑区正上方，仍打断输入流；Markdown 区顶部只有 `Cmd/Ctrl + S` 提示，没有常用排版工具栏。
7. 点击 `+ 新建 Wiki` 后，模板选择以内嵌正文 empty-state 展示；点击模板能填充 Markdown 骨架，但没有 Modal / Canvas 级明确引导，也没有待补全占位符高亮。

本规格不推翻 M33 的读写分离，而是在其上做“产品化收敛”：让阅读态更像文档、编辑态更像工作台、模板入口更像明确流程。

## 2. 设计目标

| 目标 | 说明 |
|---|---|
| 顶栏动作收敛 | PageHeader 只承载当前模式下的关键动作；状态下沉为轻量上下文 |
| 首屏正文前移 | 长实体列表、重复路径和低频元信息不再强行占据正文入口 |
| 编辑空间释放 | 编辑态给 Markdown 与预览更宽的工作面；低频导航和文档属性可折叠或移出输入流 |
| 语义对象降噪 | 多 `sl_refs` 默认聚合，展开后只展示必要名称与状态，不重复解释 |
| 新建流程明确 | 空文档优先进入模板选择流程，模板填充后提供可识别的补全占位符 |
| 保持工作台密度 | 不做营销式介绍页，不引入大插画；保持 SaaS 运维后台的克制、可扫描 |

## 3. 非目标

- 不新增 Wiki 后端 API；继续复用 `GET /api/wiki`、`GET /api/wiki/:key`、`PUT /api/wiki/:key`。
- 不改变 Wiki 文件存储规则；仍只读写 `wiki/**/*.md`。
- 不把 Schema Manifest 或 semantic overlay YAML 上传入口合并到 `/wiki`。
- 不引入完整富文本编辑器；本轮保留 Markdown 源码编辑，补充轻量工具栏。
- 不改 Lucy MCP Proxy 的数据问答 instructions，不修改 `webui/config/data-qa-instructions.md`。
- 不做版本历史、多人协同评论或 Review 审批系统。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms registered for this spec:

| Canonical Term | UI 主术语 | 说明 |
|---|---|---|
| Focus Mode | 专注编辑 | 编辑态下折叠全局主菜单或 Wiki 目录，释放 Markdown 与 Preview 空间 |
| Template Picker | 模板选择 | 新建空 Wiki 时选择 Markdown 骨架的 Modal 或 Canvas empty-state |
| Linked Entity Summary | 关联语义实体摘要 | 当关联对象超过 3 个时显示的聚合入口，例如 `关联 12 个语义实体` |
| Markdown Toolbar | Markdown 工具栏 | Markdown 源码区上方的轻量排版工具集合 |

Required UI terms:

| 概念 | UI 主术语 | 禁止文案 |
|---|---|---|
| Business Wiki | 业务 Wiki / Wiki 文档 | 维基文档作为主导航混用 |
| Read Mode | 阅读态 | 预览态作为页面主状态 |
| Edit Mode | 编辑态 | 代码模式 |
| Semantic Object | 关联语义对象 / 语义实体 | 关联架构、关联模式 |
| Save Preflight | 保存预检 | 提交代码、Git 提交 |
| Focus Mode | 专注编辑 | 沉浸式页面、全屏代码模式 |
| Template Picker | 模板选择 | 新建向导（除非真的引入多步向导） |

浏览器翻译防御要求：

- `Wiki`、`Markdown`、`Preview`、`Diff`、`Raw`、`Schema`、`Manifest`、`Catalog`、`YAML`、`sl_ref`、`semantic overlay` 必须按术语标准保护。
- Wiki key、文件路径、数据库对象名、`sl_ref` 值必须设置 `translate="no"` 与 `notranslate`。
- 普通中文说明不要整段 `translate="no"`；只保护其中的专业英文术语和代码值。

## 5. 交互与视觉规范

### 5.1 PageHeader 收敛

阅读态 Header：

| 位置 | 内容 | 规则 |
|---|---|---|
| Title | `业务 Wiki` | 不拼接当前 key；当前 key 留给面包屑与文档 Header |
| Description | 页面说明可保留，但不得重复解释“阅读态” | 文案应说明业务 Wiki 的用途，不描述当前按钮状态 |
| Badges | 不展示 `阅读态` / `已保存` Pill | 保存状态下沉到标题上方或文档 Header meta 行 |
| Actions | `复制链接`（可选）、`+ 新建 Wiki`、`编辑` | `编辑` 为唯一 Primary；`+ 新建 Wiki` 为 Secondary |

编辑态 Header：

| 位置 | 内容 | 规则 |
|---|---|---|
| Title | `业务 Wiki · <key>` | key 片段必须翻译防御，并在窄屏可截断 |
| Badges | 不展示模式 Tab | 状态用轻量文本，例如 `未保存草稿` |
| Actions | `取消` / `返回阅读`、`保存预检` 或 `保存并发布` | 只保留编辑任务动作；不展示 `阅读态 / 编辑态` Tab |
| New Wiki | 默认隐藏或移入 `更多` | 编辑已有文档时不与保存动作竞争 |

模式切换规则：

- 阅读态进入编辑态只通过 `编辑`。
- 编辑态返回阅读态只通过 `取消` / `返回阅读`。
- 不再使用 `role="tablist"` 承载页面模式；这不是同屏内容 Tab，而是工作流状态。

### 5.2 左侧 Wiki 目录瘦身

左侧目录顶部只保留统一搜索 / 过滤框：

```text
--------------------------------+
| 搜索标题、标签、sl_ref...      |
+--------------------------------+
| global                         |
|   [md] discount-policy         |
|        global/discount...      |
|   [md] KSC 财务分析口径...     |
|        global/ksc-...          |
+--------------------------------+
```

Required behavior:

| 项 | 规则 |
|---|---|
| 页面路径输入框 | 删除，不再显示为 input |
| 当前路径 | 保留在面包屑、文档 Header key、悬停 title 中 |
| 搜索 | 顶部唯一输入框；匹配标题、路径、标签、`sl_ref`、摘要 |
| Tree item | 显示文件类型 Icon 或稳定前缀，例如 `md`；路径作为 muted secondary text |
| 展开收起 | 文件夹行有稳定 caret、计数和 `aria-expanded` |
| 高度 | 搜索框到第一组目录之间不超过 12px 间距 |

### 5.3 关联语义对象降噪

关联对象数量 <= 3：

- 直接展示 Chip。
- Chip 主文本只显示 `schema.table` 或 `connection/schema/table` 的必要短名。
- 状态通过 dot / tone / tooltip 表达；不要在每个 Chip 内重复 `未知语义对象`。

关联对象数量 > 3：

```text
关联 12 个语义实体  [8 未识别]  ▾
```

Required behavior:

| 状态 | 规则 |
|---|---|
| 默认 | 展示聚合摘要，不把 12 个 Chip 平铺到首屏 |
| 展开 | 使用 inline collapse、Popover 或右侧属性面板；展开后不改变正文标题的初始位置超过 48px |
| Known | 使用 neutral / success dot，点击跳转表详情 |
| Unknown | 使用 warning dot，tooltip 或展开列表列说明 `未知语义对象` |
| 复制 | 展开列表中可提供复制 `sl_ref` 或对象名的轻量入口 |

Accessibility:

- 状态不可只依赖颜色；dot 必须有 `aria-label` 或可见计数。
- 聚合按钮必须有明确 `aria-expanded` 和 `aria-controls`。

### 5.4 编辑态专注编辑

编辑态默认工作面应优先给 Markdown 与 Preview：

| 项 | 规则 |
|---|---|
| 全局主菜单 | 进入编辑态时自动折叠，或提供默认开启的 `专注编辑` 状态 |
| Wiki 目录 | 编辑态可折叠为窄栏；当前文档切换前必须保护未保存草稿 |
| 编辑 / 预览宽度 | 1280px 视口下，Markdown 与 Preview 任一栏不应低于 420px；低于阈值时自动切为 Tab 模式 |
| 文档信息 | 不放在 Markdown 输入框正上方；移入顶部 Drawer、右侧属性面板或工具栏中的 `文档信息` 入口 |
| Preview | 宽度不足时使用 `Markdown / Preview` Segmented Control，而不是硬塞双栏 |

专注编辑不应影响左侧 App 导航的永久状态。离开 `/wiki` 或回到阅读态后，导航折叠状态应恢复到用户进入编辑前的状态，除非用户手动固定。

### 5.5 Markdown 工具栏

Markdown 源码区顶部增加轻量工具栏：

| 工具 | 插入 / 包裹行为 |
|---|---|
| 加粗 | `**selected**` |
| 行内代码 | `` `selected` `` |
| 代码块 | fenced code block |
| 表格 | 插入 2 x 2 Markdown table skeleton |
| 链接 | `[text](url)` |
| 公式 | `$formula$` 或 fenced math block；如渲染器不支持公式，先隐藏该按钮 |
| 标题 | `## ` / `### ` 快捷插入 |

规则：

- 工具栏按钮优先使用 icon 或短标签，并提供 `aria-label` / tooltip。
- 不引入大型编辑器依赖；用 textarea selection API 完成插入。
- 插入后保持焦点在 textarea，并尽量选中占位符。
- 所有插入的占位符必须是用户可见文本，不使用隐藏 magic marker。

### 5.6 新建 Wiki 与模板选择

点击 `+ 新建 Wiki` 后，如果目标文档为空：

1. 显示 Template Picker Modal 或主画布 Canvas empty-state。
2. 用户选择模板后进入编辑态。
3. Markdown 源码填充结构化骨架，并高亮需要补全的位置。

模板骨架要求：

| 模板 | 必须包含 |
|---|---|
| 表使用说明 | 表主题、典型查询、已知限制 |
| 指标口径 | 指标定义、计算口径、责任人与审阅、变更记录 |
| 分析 Playbook | 业务问题、数据依赖、分析步骤、结论模板 |
| FAQ / 注意事项 | FAQ、注意事项、容易误用的字段 |

占位符格式：

```md
[请输入指标定义]
[请选择业务 Owner]
[YYYY-MM-DD]
```

UI 高亮规则：

- textarea 内无法局部高亮时，可在右侧属性面板或 Preview 中高亮占位符。
- 模板插入后 Toast 不应只说“已应用”；应明确下一步，例如 `模板已填充，请补全高亮字段后保存预检。`

## 6. 验收标准

1. 阅读态 Header 不再展示 `阅读态 / 编辑态` 模式 Tab。
2. 阅读态 Header 不再展示 `阅读态` 状态 Pill；`已保存 / 未保存草稿` 改为文档 Header 或标题附近轻量文本。
3. 阅读态 Header 右侧最多 3 个动作，且 `编辑` 是唯一 Primary。
4. 编辑态 Header 不再展示 `+ 新建 Wiki` 作为常驻主动作，不展示模式 Tab。
5. 左侧 Wiki 目录不再出现“页面路径”输入框；只保留搜索框与目录树。
6. Wiki 目录树文件项有文件类型 Icon 或等价短标识，路径是 secondary text，并具备翻译防御。
7. KSC 文档 12 个关联语义对象默认聚合显示，不再平铺 12 个 `未知语义对象` Chip。
8. 展开关联实体列表后，未知状态只出现一次摘要或在列表行以 warning dot / tooltip 表达，不在每个 Chip 主文本中重复。
9. 编辑态在 1280px 宽度下，Markdown 与 Preview 不再各自只有约 336px；若空间不足，自动进入 Tab 预览模式。
10. 编辑态提供 `专注编辑` 行为：全局主菜单或 Wiki 目录可自动折叠，并保护未保存草稿。
11. `文档信息` 不再占据 Markdown textarea 正上方的输入流位置。
12. Markdown 源码区有工具栏，至少支持加粗、行内代码、代码块、表格、链接。
13. 新建空 Wiki 时出现 Template Picker Modal 或清晰 Canvas empty-state。
14. 点击模板后填充 Markdown 骨架，并出现 `[请输入...]` 等可识别占位符或等价补全提示。
15. 专业英文术语、路径、文件名、数据库对象名和 `sl_ref` 均有翻译防御。
16. `cd webui && npm run lint:terminology` 通过。
17. `cd webui && npm test -- --run src/__tests__/wiki.test.tsx src/__tests__/page-header.test.tsx` 通过。
18. `cd webui && npm run build` 通过。
19. 浏览器复核 `/wiki`、KSC 文档、编辑态、新建模板流程通过，并记录 1280px 与 1440px 观察结果。

## 7. 测试计划

### 7.1 Unit / Component

更新 `webui/src/__tests__/wiki.test.tsx`：

- 阅读态 Header 不含 `role="tablist"`，含 `+ 新建 Wiki` 与 `编辑`。
- 编辑态 Header 不含模式 Tab，含 `返回阅读` / `保存预检`，不常驻展示 `+ 新建 Wiki`。
- 左侧目录不渲染 `wiki-path-input`，搜索框仍可过滤标题、路径、标签、`sl_ref`。
- KSC 多 `sl_refs` 页面默认展示聚合摘要，点击可展开列表。
- 未知语义对象状态不重复出现在每个 Chip 主文本。
- 模板插入后内容包含占位符，并进入编辑态。
- Markdown 工具栏按钮对 textarea selection 生效。

更新 `webui/src/__tests__/page-header.test.tsx` 或调用点测试：

- `/wiki` 调用 `PageHeader` 时 badges 不再承载模式和保存状态。
- actions 数量和 Primary 数量符合规范。

### 7.2 Static Checks

```bash
cd webui
npm run lint:terminology
npm test -- --run src/__tests__/wiki.test.tsx src/__tests__/page-header.test.tsx
npm run build
```

如实现触及全局导航折叠状态，追加相关 App Shell 测试：

```bash
cd webui
npm test -- --run src/__tests__/app-shell.test.tsx
```

### 7.3 Browser QA

使用本地 WebUI：

- `http://localhost:5174/wiki`
- `http://localhost:5174/wiki?key=global%2Fksc-financial-analysis-playbook.md`
- `http://localhost:5174/wiki?key=global%2Fnew-note.md`

检查矩阵：

| 视口 | 场景 | 重点 |
|---|---|---|
| 1280 x 720 | 阅读态 KSC 文档 | 首屏正文位置、实体聚合、Header 动作 |
| 1280 x 720 | 编辑态 KSC 文档 | 专注编辑、双栏宽度或 Tab 模式、工具栏 |
| 1440 x 900 | 新建空 Wiki | Template Picker、占位符、保存预检 |
| 窄屏 | 阅读态与编辑态 | Header 换行、目录折叠、无文本重叠 |

截图或审计输出可临时落在仓库根目录 `inbox/`。

## 8. 风险与边界

| 风险 | 处理 |
|---|---|
| 移除模式 Tab 后用户不知道当前状态 | 用 Header title、主动作和文档 meta 文本表达；不把状态做成可点控件 |
| 聚合语义对象降低可发现性 | 默认摘要展示数量和 unknown 计数；展开入口明显且可键盘访问 |
| 专注编辑影响全站导航状态 | 只在 `/wiki` 编辑态临时折叠，退出编辑态恢复原状态 |
| 双栏宽度与响应式复杂度增加 | 设置明确断点：空间不足切 Preview Tab，不强撑双栏 |
| Markdown 工具栏插入破坏选区 | 使用 textarea selectionStart / selectionEnd，写入后聚焦并测试常见选区 |
| Template Picker Modal 增加流程步骤 | 空文档场景优先清晰引导；已有内容的新建 / 编辑不弹出 |

## 9. 实施分步

1. 调整 `WikiEditor.tsx` 的 Header actions 与状态下沉。
2. 删除左侧页面路径 input，保留路径在文档 Header 与面包屑。
3. 抽象 `LinkedSemanticObjects` 或扩展 `WikiReadView`，实现 > 3 聚合摘要与展开列表。
4. 为编辑态增加专注编辑布局状态，并在 CSS 中定义双栏 / Tab 响应式阈值。
5. 将 `文档信息` 移入 Drawer / 右侧属性面板 / 工具栏入口。
6. 新增 `MarkdownToolbar`，实现 textarea 插入工具。
7. 升级模板内容为带占位符骨架，新增 Template Picker Modal 或 Canvas empty-state。
8. 更新 `wiki.test.tsx`、必要的 `page-header.test.tsx` / `app-shell.test.tsx`。
9. 运行术语 lint、聚焦测试、build 与浏览器 QA。

## 10. Backout

如果 M42 实现导致 Wiki 编辑不可用，回滚范围应限制在：

- `webui/src/pages/WikiEditor.tsx`
- `webui/src/components/WikiReadView.tsx`
- `webui/src/components/WikiEditView.tsx`
- 新增的 Wiki 子组件
- `webui/src/lib/wiki.ts`
- `webui/src/app/app.css`
- `webui/src/__tests__/wiki.test.tsx`

后端 Wiki API、`wiki/**/*.md` 文件和 Lucy MCP Proxy runtime instructions 不应作为回滚对象。

---
_Spec by Codex · 2026-08-01_
