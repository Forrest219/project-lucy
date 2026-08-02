# WO-M42 Business Wiki Workbench Productization

| 元数据 | 内容 |
|---|---|
| 工单号 | M42 |
| 标题 | `/wiki` 顶栏收敛、语义实体降噪、专注编辑与模板选择 |
| 来源 Spec | `webui/docs/45-business-wiki-workbench-productization-spec.md` |
| 撰写日期 | 2026-08-01 |
| 适用范围 | `webui/src/pages/WikiEditor.tsx`、`webui/src/components/WikiReadView.tsx`、`webui/src/components/WikiEditView.tsx`、`webui/src/components/WikiTree.tsx`、`webui/src/lib/wiki.ts`、`webui/src/__tests__/wiki.test.tsx`、必要时 `webui/src/components/PageHeader.tsx`、`webui/src/__tests__/page-header.test.tsx`、`webui/src/__tests__/app-shell.test.tsx`、`webui/src/app/app.css` |
| 上游工单 | M33 Business Wiki Read/Edit Workbench、M40 PageHeader Standardization |

## 目标

按 SPEC 落地：

1. 阅读态 Header 只保留轻量辅助动作、`+ 新建 Wiki` 与主动作 `编辑`；移除模式 Tab 和状态 Pill。
2. 编辑态 Header 只保留 `取消` / `返回阅读` 与 `保存预检` / `保存并发布`，移除 `阅读态 / 编辑态` Tab 和常驻 `+ 新建 Wiki`。
3. 左侧 Wiki 目录删除“页面路径”输入框，只保留统一搜索框与目录树。
4. 多关联语义对象默认聚合为摘要，展开后用 dot / tooltip 表达 known / unknown 状态，不重复渲染 `未知语义对象`。
5. 编辑态启用专注编辑布局，释放 Markdown 与 Preview 空间；空间不足时切换为 Preview Tab。
6. `文档信息` 从 Markdown 输入流上方移走，改为 Drawer、右侧属性面板或工具栏入口。
7. Markdown 源码区新增轻量工具栏。
8. 新建空 Wiki 使用 Template Picker Modal 或清晰 Canvas empty-state；模板填充带 `[请输入...]` 占位符。

## 任务清单

- [ ] **T1 Header 收敛**：重构 `WikiEditor.tsx` 的 `PageHeader` badges/actions；删除 `role="tablist"` 模式切换；将保存状态下沉到文档 Header 或轻量 meta 行。
- [ ] **T2 左侧目录瘦身**：删除 `wiki-path-input` 和“页面路径”标签；保留搜索框；为目录项补文件类型 Icon / 短标识与路径翻译防御。
- [ ] **T3 关联语义对象聚合**：在 `WikiReadView.tsx` 或新组件中实现 `sl_refs.length > 3` 摘要、展开列表、known / unknown dot、unknown 计数与可访问性属性。
- [ ] **T4 编辑态专注布局**：调整 `WikiEditor.tsx` 与 `app.css`，编辑态临时折叠全局主菜单或 Wiki 目录；设置双栏最小宽度，低于阈值切为 Markdown / Preview Tab。
- [ ] **T5 文档信息解耦**：将 `FrontmatterForm` 从 textarea 正上方移到 Drawer、右侧属性面板或工具栏入口；保留未保存草稿保护。
- [ ] **T6 Markdown 工具栏**：新增 `MarkdownToolbar` 组件或内联子组件，支持加粗、行内代码、代码块、表格、链接；插入后保持 textarea 焦点。
- [ ] **T7 模板选择**：升级 `WIKI_TEMPLATES` 为带占位符骨架；新建空 Wiki 时展示 Template Picker Modal 或 Canvas empty-state；选择后进入编辑态并提示补全占位符。
- [ ] **T8 测试更新**：更新 `wiki.test.tsx` 覆盖 Header、左栏、实体聚合、工具栏、模板占位符；必要时更新 `page-header.test.tsx` / `app-shell.test.tsx`。
- [ ] **T9 验证**：运行术语 lint、聚焦测试、必要 app-shell 测试、build。
- [ ] **T10 浏览器 QA**：在 1280 x 720 与 1440 x 900 复核 `/wiki`、KSC 文档、编辑态、新建模板流程。

## 验收口径

详见 SPEC §6。最低验收：

- `/wiki` 阅读态没有 `阅读态 / 编辑态` Tab。
- `/wiki` 左侧没有“页面路径”输入框。
- KSC 文档默认不平铺 12 个实体 Chip。
- 编辑态 Markdown / Preview 不再被压到约 336px 宽；空间不足时有明确 Tab 降级。
- 新建空文档模板填充包含可识别占位符。
- `npm run lint:terminology`、聚焦测试和 build 通过。

## 验证命令

```bash
cd webui
npm run lint:terminology
npm test -- --run src/__tests__/wiki.test.tsx src/__tests__/page-header.test.tsx
npm run build
```

如专注编辑触及 App Shell 导航状态：

```bash
cd webui
npm test -- --run src/__tests__/app-shell.test.tsx
```

## 浏览器复核脚本

手动或 Browser 自动化访问：

```text
http://localhost:5174/wiki
http://localhost:5174/wiki?key=global%2Fksc-financial-analysis-playbook.md
http://localhost:5174/wiki?key=global%2Fnew-note.md
```

检查：

- 阅读态 Header 动作数量、主次关系、保存状态下沉。
- KSC 文档关联实体默认摘要、展开状态、unknown 计数。
- 编辑态专注编辑、工具栏、Preview Tab / 双栏宽度。
- 新建空 Wiki Template Picker、模板占位符、保存预检入口。

## 风险与边界

| 风险 | 处理 |
|---|---|
| Header 收敛后状态不可见 | 状态移动到文档 Header meta 行，不能彻底删除 |
| 聚合实体导致跳转入口隐藏 | 摘要入口必须明显；展开列表保留表详情跳转 |
| 专注编辑影响用户全局导航偏好 | 自动折叠只在编辑态临时生效，退出编辑态恢复 |
| Preview Tab 降级增加状态复杂度 | 只在宽度不足时启用，桌面宽屏仍双栏 |
| Markdown 工具栏插入文本有边界 bug | 用 selectionStart / selectionEnd 单测覆盖空选区、选中文本、多行插入 |

## Backout

按 SPEC §10 回滚 Wiki 前端相关文件；不回滚 Wiki 后端 API、`wiki/**/*.md` 业务文档或 Lucy MCP Proxy runtime instructions。

---
_Work order by Codex · 2026-08-01_
