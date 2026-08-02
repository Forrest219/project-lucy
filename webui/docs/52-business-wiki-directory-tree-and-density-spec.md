# Business Wiki Directory Tree and Density Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Business Wiki Directory Tree and Density Spec |
| 文档类型 | Product / UX / Frontend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-02 |
| 关联页面 | `/wiki` |
| 关联工单 | `webui/docs/plans/wo-M50-business-wiki-directory-tree-and-density.md` |
| 事实来源 | 2026-08-02 浏览器核查、用户截图、`docs/ui-ux-feedback/pages/wiki.md` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/45-business-wiki-workbench-productization-spec.md`、`webui/docs/49-business-wiki-md-library-operations-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 背景

M47 已将 `/wiki` 收敛为 Markdown 文档库，并补上全局主导航、默认文档库首页、上传 / 新建 Markdown 入口。2026-08-02 进一步浏览器核查显示，文档库心智仍有三类断点：

1. 左侧 `目录` 只展示 `global` 和文档，用户无法判断 `global` 是否唯一父级，是否可创建平级目录或子目录。
2. `global` 右侧的数字 `1` 没有单位。代码中该值来自 `group.pages.length`，实际表示该目录下 Markdown 文档数，但 UI 上容易被误读为目录数。
3. 默认首页首屏区域留白过大。浏览器 computed style 显示 `.pl-wiki-library-home` 被拉伸到约 `608px` 高，内部两个 grid row 被均分为约 `302px` 和 `290px`，内容本身并不需要这些高度。

本 Spec 是 M47 后续 hardening，不改变 Wiki 存储和 API 主契约，重点补齐目录层级可发现性、计数语义和首页密度。

## 2. 目标

- 让用户一眼看出 Wiki 支持多个平级目录和多级子目录。
- 在左侧目录区域提供可发现的目录级新建入口，而不是只藏在 PageHeader 的 `新建文档` 对话框里。
- 将目录旁计数改成明确的 `N 篇` 或等价带单位表达。
- 将扁平目录分组升级为真正层级树，支持 `ops/playbooks/foo.md` 渲染为 `ops -> playbooks -> foo.md`。
- 压缩 `/wiki` 默认首页无意义留白，让文档库概览和目录列表按内容高度自然收缩。
- 保持上传 / 新建 / 保存仍走现有 Wiki key 与后端 `wiki/**/*.md` 安全边界。

## 3. 非目标

- 不引入远端 CMS、数据库目录表或独立 folder API。
- 不改变 `wiki/` 物理根目录和 Markdown 文件格式。
- 不实现拖拽移动目录、批量移动、重命名目录或删除目录。
- 不改变 MCP runtime 的 `wiki_search` / `wiki_read` 行为。
- 不做移动窄屏专项验证，除非后续计划或用户另行要求。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Wiki Directory | Wiki 目录 / 目录 | 文件夹 | 项目、菜单混用 | `wiki/` 下的路径段或路径前缀 |
| Subdirectory | 子目录 | 二级目录 | 二级菜单 | 目录树下一级目录 |
| Document Count | 文档数 | N 篇 | 目录数 | 目录下 Markdown 文档数量 |

文案要求：

- 用户可见文案使用 `目录`、`子目录`、`Markdown 文档`。
- 不使用 `folder`、`project`、`二级菜单` 作为主 UI 文案。
- `Wiki`、`Markdown`、路径、文件名、目录 key 必须加浏览器翻译防御。

## 5. 信息架构与交互

### 5.1 左侧目录 Header

左侧 `目录` 标题行应包含一个轻量动作入口：

```text
目录                         [+]
搜索文档标题、标签、关联表...
```

行为：

- `+` 使用明确可访问名称，例如 `新建 Wiki 目录或文档`。
- 点击打开新建对话框。
- 对话框支持：
  - `目标目录`：可选择已有目录，也可输入新目录，例如 `kx`、`ops/playbooks`。
  - `文件名`：默认 `new-note.md`。
  - 目标预览：展示 `wiki/<目标目录>/<文件名>`。
- 如果从某个目录行触发新建，默认目录为该目录。

### 5.2 目录行动作

每个目录行应支持至少一个目录级新建入口：

```text
▾ global                      1 篇   [+]
  MD demo-superstore
```

行为：

- 目录行 `+` 的可访问名称包含目录名，例如 `在 global 下新建文档`。
- 点击后打开同一个新建对话框，`目标目录` 默认填入当前目录。
- 不新增独立“空目录”落盘。目录仍由 Markdown 文件路径自然产生。

### 5.3 目录计数语义

目录右侧计数必须带单位：

- 一级目录显示其 subtree 下 Markdown 文档总数，例如 `3 篇`。
- 如果设计上需要同时显示直接子文档数和子目录数，应使用明确双指标，例如 `2 个子目录 · 3 篇`。
- P0 推荐只显示 subtree 文档数，降低认知成本。

不得再裸露无单位数字 `1`。

### 5.4 真正层级树

当前 `groupWikiPages` 以完整目录路径分组，`ops/playbooks/foo.md` 会渲染为单个组 `ops/playbooks`。本轮应引入目录树模型：

```ts
type WikiDirectoryNode = {
  path: string;              // "ops/playbooks"
  name: string;              // "playbooks"
  documentCount: number;     // subtree Markdown document count
  directPages: WikiSummary[];
  children: WikiDirectoryNode[];
};
```

渲染规则：

- 顶层展示 `global`、`kx`、`ops` 等平级目录。
- 子目录缩进展示，例如 `ops -> playbooks`。
- Markdown 文档展示在所属目录下。
- 展开 / 收起状态按目录 path 维护。
- 搜索命中时保留目录上下文：如果命中文档，自动展示其祖先目录。
- 目录名、路径和文件名加 `translate="no"` 与 `notranslate`。

### 5.5 默认首页密度

默认首页不应出现大面积空白卡片。

要求：

- `.pl-wiki-library-home` 和 `.pl-wiki-body` 在 library mode 下按内容高度自然收缩。
- 推荐使用 `align-self: start`、`align-content: start` 或 scoped class 修复 grid stretch。
- `Markdown 文档库` hero 改为紧凑 summary band，不设置固定高度或被 grid 均分。
- 目录列表紧贴 summary band 下方，间距保持 12-16px。
- 1280x720 视口下，文档列表第一行应出现在首屏上半区，而不是被推到页面下半区。

## 6. 数据与 API 契约

不新增后端 API。

继续复用：

| API | 用途 |
|---|---|
| `GET /api/wiki` | 获取现有 Markdown 文档 key 列表 |
| `PUT /api/wiki/:key` | 在线编辑保存 / dry-run |
| `POST /api/wiki/upload/preview` | 上传预检 |
| `POST /api/wiki/upload/commit` | 上传确认写入 |

目录由 Markdown key 推导，不单独持久化。输入新目录时，最终仍生成合法 Wiki key，例如 `ops/playbooks/new-note.md`。

安全约束：

- 前端可做基础校验：目录段不得为空、不得为 `.` / `..`。
- 后端仍是最终校验源：只允许 `wiki/**/*.md`，禁止 path traversal、绝对路径和非 Markdown 目标。
- 不为了“新建目录”写空文件或 placeholder 文件。

## 7. 验收标准

### 7.1 浏览器验收

1. 打开 `/wiki`，左侧目录 Header 可见新建入口。
2. `global` 目录行右侧显示 `1 篇`，不再裸露数字 `1`。
3. 点击目录 Header 的新建入口，能输入 `ops/playbooks` 和 `new-note.md`，目标预览为 `wiki/ops/playbooks/new-note.md`。
4. 点击某个目录行的新建入口，目标目录默认填入该目录。
5. 准备一个包含 `ops/playbooks/demo.md` 的 fixture 后，目录树展示 `ops` 父级和 `playbooks` 子级。
6. 搜索文档标题时，命中文档仍显示其祖先目录。
7. `/wiki` 默认首页的 summary band 与目录列表按内容高度收缩，1280x720 视口下无大块空白卡片。

### 7.2 自动化验收

- `buildWikiDirectoryTree` 或等价 helper 单测覆盖：
  - 平级目录。
  - 多级子目录。
  - subtree 文档计数。
  - 搜索过滤保留祖先目录。
- `WikiTree` 组件测试覆盖：
  - 目录计数显示 `N 篇`。
  - 目录 Header 新建入口存在。
  - 目录行新建入口传入当前目录。
  - 多级目录缩进和展开收起。
- `WikiEditor` 测试覆盖：
  - Header 新建与目录行新建共用新建对话框。
  - 输入新目录生成正确 draft key。
- 样式测试或 jsdom 断言覆盖：
  - `wiki-library-home` 不再依赖 stretch 填满整页。
- 术语检查通过：`npm run lint:terminology`。
- 相关测试通过：`npm test -- --run src/__tests__/wiki.test.tsx`。

## 8. 实施优先级

### P0

- 计数加单位：`N 篇`。
- 新建入口进入左侧目录 Header。
- 修复首页 grid stretch 造成的巨大留白。

### P1

- 目录行级 `+` 新建入口。
- 真正多级目录树模型与渲染。
- 搜索保留祖先目录上下文。

### P2

- 目录行 hover / focus 状态打磨。
- 目录级 tooltip 和空目录引导文案。
- 将相同目录模型复用到文档库首页右侧列表。

## 9. 风险与开放问题

- 当前目录是由文档路径自然推导的，没有“空目录”持久化能力；如果用户只想创建空目录，本轮不支持，需要产品另行定义。
- 多级树会改变 `WikiTree` 的 DOM 结构，既有测试和可访问性属性需要同步更新。
- `global` 作为默认目录仍可保留，但 UI 必须清楚表达它只是一个普通目录，不是唯一父级。
- 如果未来需要目录重命名或移动文档，应另开 spec，不能混入本轮。
