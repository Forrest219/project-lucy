# M47 — Business Wiki Markdown Library Operations

> codex 直投 prompt：请在 `/Users/forrest/Projects/project-lucy/webui` 开工。先读 `../docs/49-business-wiki-md-library-operations-spec.md`、`../docs/00-product-terminology-standard.md`、`../docs/45-business-wiki-workbench-productization-spec.md` 和本工单。目标是把 `/wiki` 从在线编辑优先调整为 Markdown 文档库运维主路径：默认首页、目录瘦身、下载 Markdown、上传 Markdown、上传覆盖、编辑降级。保持改动聚焦，遵守 `fs-safe.ts` 写入边界和术语翻译防御。

## 0. 背景

M42 已完成 `/wiki` 工作台产品化第一轮，但 2026-08-01 浏览器复核确认仍有明显问题：

- `/wiki` 默认打开 `global/discount-policy.md`，不适合作为模块入口。
- Wiki 内部侧栏出现 `表目录`，点击后跳转到 `/`。
- `业务 Wiki`、路径、复制链接等信息重复。
- 搜索 placeholder 暴露 `sl_ref`。
- 文档 Header 留白过大，正文被推离首屏核心区域。
- 编辑态的 `专注编辑`、`文档信息` 对用户价值低，其中 Focus Mode 还存在编辑器塌陷风险。
- 真实运维主路径更偏向下载 `.md`、上传 `.md` 覆盖，而不是在线手写 Markdown。

本工单承接 `webui/docs/49-business-wiki-md-library-operations-spec.md`。

## 1. 范围

### 1.1 预期修改区域

- `src/pages/WikiEditor.tsx`
- `src/pages/wiki/WikiTree.tsx`
- `src/pages/wiki/WikiReadView.tsx`
- `src/pages/wiki/WikiEditView.tsx`
- `src/pages/wiki/WikiSavePreflight.tsx`
- `src/pages/wiki/TemplatePicker.tsx`
- `src/lib/apiClient.ts` 或 Wiki API client 封装
- `server/wiki.ts`、`server/routes.ts` 或现有 Wiki API 模块
- `src/__tests__/wiki*.test.tsx`
- `server/__tests__/wiki*.test.ts`
- `src/app/app.css` 或 Wiki 相关样式文件

实际文件以当前代码结构为准，不为迁就本列表做无意义搬迁。

### 1.2 不做

- 不引入富文本编辑器。
- 不做版本历史、评论、多人协同或审批。
- 不改 `wiki/` 物理根目录。
- 不把 Wiki Markdown 上传和 Schema Manifest / semantic overlay 上传合并。
- 不读取或输出 `.ktx/secrets/` 内容。

## 2. 开工前置

在 `webui/` 目录执行并记录结果：

```bash
pwd
node -v
git -C /Users/forrest/Projects/project-lucy status --short
```

阅读：

- `../docs/49-business-wiki-md-library-operations-spec.md`
- `../docs/00-product-terminology-standard.md`
- `../docs/45-business-wiki-workbench-productization-spec.md`
- `../../docs/DEVELOPMENT.md`

如果工作树已有无关脏改动，只记录并避开，不得回滚。

## 3. 任务拆分

### T1. `/wiki` 默认首页

- 打开 `/wiki` 时渲染 Markdown 文档库首页，不自动选中第一篇文档。
- 首页展示目录摘要、当前目录文档列表、`上传 Markdown`、`新建文档`。
- 从目录树点击文档后才进入文档详情。
- URL 状态应能表达当前文档选择，避免刷新后丢失上下文。

验收：

- `/wiki` 不默认展示 `折扣率口径（Discount Rate Policy）` 正文。
- 直接访问文档深链仍能打开对应文档。

### T2. 左侧 Wiki 目录瘦身

- 移除 Wiki 内部 `表目录` 链接。
- 移除只读路径输入框或路径 chip。
- 保留单一搜索框，placeholder 改为 `搜索文档标题、标签、关联表...`。
- 目录树第一层展示目录，例如 `global`；目录下展示 Markdown 文档。
- 增加清晰文件夹 / Markdown 图标。
- 文件名、路径、数据库对象名添加 `translate="no"` 和 `notranslate`。

验收：

- `/wiki` 内部侧栏不存在 `a[href="/"]` 的 `表目录`。
- 页面可见文案不出现 `sl_ref`。

### T3. 顶栏与详情 Header 降噪

- 根路径顶栏仅显示页面标题、副标题和主操作。
- 文档详情页移除默认可见 `复制链接`。
- 文档路径只在 Header 元信息中出现一次。
- 同一视口内 `业务 Wiki` 最多出现导航激活项和页面标题两处。
- 关联实体超过 3 个时默认聚合。

验收：

- 文档详情页无顶部冗余面包屑 `语义建模 / 业务 Wiki / global/...`。
- `复制链接` 不再是默认可见主按钮。

### T4. 文档正文布局压缩

- 移除大面积空白卡片 Header。
- 文档标题、元信息、关联实体和正文之间使用紧凑间距。
- 桌面端文档标题到 Markdown 正文第一行距离小于 96px。
- 右侧目录只在必要时展示，窄屏折叠。

验收：

- `折扣率口径（Discount Rate Policy）` 首屏能看到正文关键内容，不被空白 Header 推挤。

### T5. 下载 Markdown

- 文档详情页提供 `下载 Markdown`。
- 下载当前已保存 raw Markdown。
- 文件名使用当前文档 basename。
- 下载失败使用统一错误反馈。

可选 API：

- 新增 `GET /api/wiki/:key/raw`，返回 `text/markdown`。
- 若复用现有详情 API，前端下载行为仍需有测试。

验收：

- 点击 `下载 Markdown` 会生成 `.md` 文件下载。
- 未保存编辑态下，下载语义清楚表达已保存版本边界。

### T6. 上传 Markdown 与上传覆盖

- 根路径或目录首页提供 `上传 Markdown`。
- 文档详情页提供 `上传覆盖`。
- 上传前必须有预检 Modal。
- 新建上传可选择目标目录。
- 覆盖上传目标固定为当前文档。
- 预检展示目标路径、标题预览、关联表解析结果、diff 摘要、警告。
- 确认后通过受控 API 写入 `wiki/` 下 `.md` 文件。

后端要求：

- 写入必须经过 `fs-safe.ts`。
- 阻止 `../`、绝对路径、软链接逃逸、非 `.md` 扩展名。
- 上传预检不落盘。
- 文件大小上限建议 1MB。

验收：

- 上传新 `.md` 能在目录树中出现。
- 上传覆盖成功后刷新当前预览。
- 非 `.md` 文件和路径逃逸被阻止。

### T7. 在线编辑降级与未保存保护

- `编辑` 不再作为最高优先级主按钮，放入 `更多` 或降为次级。
- 编辑态 Header 只保留 `取消`、`保存并发布`。
- 移除默认可见 `专注编辑` 和 `文档信息`。
- 如果保留 Focus Mode，先修复 1280px / 1728px 下编辑器塌陷；否则删除入口。
- 切换文档、新建、上传覆盖、返回阅读前，若存在未保存内容必须确认。

验收：

- 编辑态不出现默认可见 `专注编辑`、`文档信息`。
- 有 dirty 状态时不会静默丢失用户输入。

### T8. 测试

新增或更新测试：

- Wiki 默认首页。
- 左侧无 `表目录` 跳转。
- 搜索 placeholder 不含 `sl_ref`。
- 顶栏和 Header 降噪。
- 下载 Markdown。
- 上传 Markdown 预检和提交。
- 上传覆盖预检、提交和失败分支。
- 未保存变更保护。
- 编辑态按钮收敛。
- 术语翻译防御。

推荐命令：

```bash
npm test -- --run src/__tests__/wiki*.test.tsx
npm test -- --run server/__tests__/wiki*.test.ts
npm run lint:terminology
npm run build
```

如果仓库已有测试命令或文件名不同，以实际测试组织为准。

### T9. 浏览器 QA

Docker 或 dev server 重建后，使用浏览器验证：

- `http://localhost:5174/wiki`
- `/wiki` 根首页
- 选择 `global/discount-policy.md`
- 下载 Markdown
- 上传 Markdown 新建
- 上传覆盖当前文档
- 编辑态 dirty guard
- 1280x720 和 1728x1000 视口

记录：

- 截图或 DOM 断言。
- 是否仍有 `表目录`、`sl_ref`、重复 `业务 Wiki`。
- 文档标题到正文第一行的距离。
- 上传 / 下载成功和失败反馈。

## 4. 完成定义

- [ ] Spec 中 P0 / P1 验收全部满足。
- [ ] `/wiki` 默认首页不自动打开折扣率文档。
- [ ] Wiki 内部侧栏无 `表目录` 跳转。
- [ ] 搜索、按钮、Toast、Modal 文案符合术语标准。
- [ ] `下载 Markdown`、`上传 Markdown`、`上传覆盖` 可用。
- [ ] 未保存编辑内容不会被静默丢弃。
- [ ] 自动化测试覆盖关键路径。
- [ ] `npm run lint:terminology` 通过。
- [ ] `npm run build` 通过，或记录与本工单无关的既有失败。
- [ ] 浏览器 QA 记录已附在收尾说明中。

## 5. 交付说明模板

收尾时请给出：

- 改动摘要。
- 文件清单。
- 测试命令和结果。
- 浏览器 QA 结果。
- 已知遗留或非本工单问题。
