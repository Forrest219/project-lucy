# M50 — Business Wiki Directory Tree and Density

> codex 直投 prompt：请在 `/Users/forrest/Projects/project-lucy/webui` 开工。先读 `../docs/52-business-wiki-directory-tree-and-density-spec.md`、`../docs/49-business-wiki-md-library-operations-spec.md`、`../docs/00-product-terminology-standard.md`、`../../docs/DEVELOPMENT.md` 和本工单。目标是修复 `/wiki` 目录层级不可发现、目录计数无单位、默认首页大面积留白问题。保持 Wiki 存储和 API 契约不变，目录由 Markdown key 推导，不新增空目录持久化。

## 0. 背景

M47 后 `/wiki` 已恢复全局导航、去掉重复主动作，并让新建 / 上传可以输入目标目录。但 2026-08-02 浏览器核查仍确认：

- 左侧目录只显示 `global`，没有任何可见入口说明可以新建平级目录或子目录。
- `global` 右侧裸露数字 `1`，用户无法判断是目录数还是 Markdown 文档数。
- 默认首页区域被 grid stretch 拉高，`Markdown 文档库` summary 和目录卡片各占约 300px，首屏空白过大。
- 当前 `groupWikiPages` 按完整目录路径分组，不是真正的 `ops -> playbooks -> file.md` 层级树。

本工单承接 `webui/docs/52-business-wiki-directory-tree-and-density-spec.md`，属于 M47 的 UI/UX hardening。

## 1. 范围

### 1.1 预期修改区域

- `src/lib/wiki.ts`
- `src/components/WikiTree.tsx`
- `src/components/WikiLibraryHome.tsx`
- `src/components/WikiNewDocumentDialog.tsx`
- `src/pages/WikiEditor.tsx`
- `src/app/app.css`
- `src/__tests__/wiki.test.tsx`
- 必要时新增 Wiki tree helper 测试文件
- `docs/ui-ux-feedback/pages/wiki.md`

实际文件以当前代码结构为准，不为迁就本列表做搬迁。

### 1.2 不做

- 不新增后端 API。
- 不写空目录、placeholder 文件或目录元数据文件。
- 不实现目录重命名、删除、拖拽移动或批量移动。
- 不改变 `wiki/` 物理根目录和 Markdown frontmatter 格式。
- 不修改 Lucy MCP Proxy runtime instructions。

## 2. 开工前置

在 `webui/` 目录执行并记录结果：

```bash
pwd
node -v
git -C /Users/forrest/Projects/project-lucy status --short
```

阅读：

- `../docs/52-business-wiki-directory-tree-and-density-spec.md`
- `../docs/49-business-wiki-md-library-operations-spec.md`
- `../docs/00-product-terminology-standard.md`
- `../../docs/DEVELOPMENT.md`

如果工作树已有无关脏改动，只记录并避开，不得回滚。

## 3. 任务拆分

### T1. 建立目录树模型

- 在 `src/lib/wiki.ts` 新增 `WikiDirectoryNode` 或等价类型。
- 新增 helper，例如 `buildWikiDirectoryTree(pages)`。
- 从 Markdown key 推导目录段：
  - `global/demo.md` -> `global` 下 `demo.md`
  - `ops/playbooks/demo.md` -> `ops` 下 `playbooks` 下 `demo.md`
- 每个目录节点计算 subtree Markdown 文档数。
- 保留旧 `groupWikiPages` 兼容旧调用，或逐步迁移调用点后保留单测防回归。

验收：

- helper 单测覆盖平级目录、多级子目录、根目录 fallback、文档计数。

### T2. 升级 WikiTree 为真正层级树

- 将 `WikiTree` 从完整目录路径分组改为目录节点递归渲染。
- 顶层显示 `global`、`kx`、`ops` 等平级目录。
- 子目录缩进显示，例如 `ops -> playbooks`。
- 每个目录行展示 caret、目录名、`N 篇`、目录级新建入口。
- 每个 Markdown 文档保留 `MD` 标识和标题。
- 展开状态按目录 path 存储。
- 搜索命中时展示命中文档的祖先目录。

验收：

- `global` 旁显示 `1 篇`，不再裸露 `1`。
- fixture 有 `ops/playbooks/demo.md` 时，DOM 能找到 `ops` 和 `playbooks` 两级目录。

### T3. 目录级新建入口

- 左侧 `目录` header 增加一个 icon button，aria-label 为 `新建 Wiki 目录或文档`。
- 每个目录行增加一个 scoped 新建入口，aria-label 包含目录名，例如 `在 global 下新建文档`。
- 将新建入口回调传到 `WikiEditor`，复用现有 `WikiNewDocumentDialog`。
- 从目录行触发时，dialog 的 `目标目录` 默认填入该目录 path。
- Header 触发时，默认目录使用当前目录或 `global`。
- Dialog 增加只读目标预览：`wiki/<目标目录>/<文件名>`。

验收：

- 点击 `目录` header 的 `+` 能打开新建对话框。
- 点击 `global` 行的 `+`，目标目录默认是 `global`。
- 输入 `ops/playbooks` 和 `new-note.md` 时，目标预览实时显示 `wiki/ops/playbooks/new-note.md`。

### T4. 修复默认首页大留白

- 修复 `WikiLibraryHome` / `wiki-body` 在 library mode 下被 grid stretch 拉高的问题。
- 推荐增加 scoped modifier，例如 `pl-wiki-body--library` 或 `pl-wiki-library-home { align-self: start; }`。
- 将 summary hero 改为紧凑 summary band，不让两个卡片均分可用高度。
- 保持 PageHeader 主动作唯一，不重新引入重复 `上传 Markdown` / `新建文档`。

验收：

- 1280x720 浏览器下 summary band 和目录列表按内容高度收缩。
- 自动化至少断言 library home 不依赖固定 / stretch 高度 class。

### T5. 首页文档库与目录树语义一致

- `WikiLibraryHome` 使用同一目录树模型或至少同一计数语义。
- 目录 count 展示 `N 篇`。
- 如显示多级目录，保留 path 上下文，不把 `ops/playbooks` 当成唯一平铺标签。

验收：

- 首页和左侧目录对相同 fixture 的计数一致。

### T6. 测试与台账更新

- 更新 `src/__tests__/wiki.test.tsx`：
  - `buildWikiDirectoryTree` helper。
  - `WikiTree` 多级目录渲染。
  - `N 篇` 计数。
  - Header 新建入口。
  - 目录行新建入口默认目录。
  - Dialog 目标预览。
  - 首页不重复主动作且不 stretch。
- 更新 `docs/ui-ux-feedback/pages/wiki.md`：
  - 将本轮对应条目标为 `Fixed`。
  - Notes 写明修复文件和验证命令。
  - 若未做浏览器验证，保持 `Fixed`，不标 `Verified`。

## 4. 验证命令

必须运行：

```bash
npm test -- --run src/__tests__/wiki.test.tsx
npm run lint:terminology
npm run build
git diff --check
```

若修改 App shell 或全局导航，追加：

```bash
npm test -- --run src/__tests__/app-shell.test.tsx
```

浏览器验证只有在用户或计划明确要求时执行；本工单建议最后用浏览器复核 `/wiki`，但不强制。

## 5. 验收清单

- [ ] `/wiki` 左侧目录 Header 有新建入口。
- [ ] 目录行有目录级新建入口。
- [ ] 目录计数显示 `N 篇`。
- [ ] `global` 表达为普通目录，不暗示唯一父级。
- [ ] 多级 key 渲染为层级树，而不是完整路径平铺分组。
- [ ] 新建对话框目标预览实时显示完整 `wiki/.../*.md`。
- [ ] 默认首页无大块空白卡片，目录列表上移。
- [ ] 既有上传 / 新建 / 保存路径仍走现有 Wiki key 校验。
- [ ] 术语 lint 通过。
- [ ] Wiki 相关测试通过。

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 多级树递归渲染破坏现有搜索行为 | 搜索 helper 保留祖先目录，补测试 |
| 目录级 `+` 与折叠按钮点击冲突 | 使用独立 button，阻止事件冒泡或拆分 row layout |
| 新建目录被误解为会创建空目录 | Dialog 文案说明“保存 Markdown 后生成目录”或目标预览表达清楚 |
| 首页密度修复影响文档详情页布局 | 使用 library mode scoped class，不改 read/edit mode |

回滚方式：

- 回退 `WikiTree`、目录 helper、`WikiLibraryHome`、`WikiNewDocumentDialog` 和相关 CSS / tests 的本工单改动。
- 不回滚 Wiki 后端 API、`wiki/**/*.md` 内容或 M47 已完成的上传 / 下载能力。
