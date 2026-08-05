# Wiki Version History List-First UX Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki Version History List-First UX Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/80-wiki-version-history-list-first-ux-spec.md`；浏览器核查与用户 5 点反馈 |
| 适用范围 | 指导 `/wiki` 版本记录弹窗列表优先、业务文案、当前行收敛、全宽详情态的实施与验收 |
| 输出位置 | `webui/docs/plans/wo-202608-12-wiki-version-history-list-first-ux.md` |

**Goal:** 落地 Spec 80：版本记录弹窗去掉常驻侧栏预览；全宽业务化表格；当前行无查看/恢复；点「查看」进入同弹窗全宽详情（Markdown + Diff）。

**Architecture:** 纯前端交互与文案。不改后端 API。主改 `WikiVersionHistoryDialog.tsx` + `app.css`；`WikiEditor` 选中态逻辑基本复用；更新 `wiki.test.tsx` 与 UI/UX 台账。

**Tech Stack:** React、TypeScript、CSS (`src/app/app.css`)、Vitest/Testing Library。

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中执行本工单，按 Phase 顺序实施并逐步验证。

必须先阅读：

- `../../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/80-wiki-version-history-list-first-ux-spec.md`
- `docs/55-business-wiki-version-history-restore-spec.md`（§8.2–8.3）
- `src/components/WikiVersionHistoryDialog.tsx`
- `src/pages/WikiEditor.tsx`（version history wiring）
- `src/app/app.css`（`.pl-wiki-version-*`）
- `src/__tests__/wiki.test.tsx`
- `../../docs/ui-ux-feedback/pages/wiki.md`
- `../../docs/ui-ux-feedback/README.md`

## Non-Negotiable Boundaries

- 不新增后端 API，不改变 `wiki/` 物理存储、版本写入语义或 `fs-safe.ts`。
- 不改 Table YAML 版本记录 UI。
- 不引入 `?version=` URL deep-link。
- 路径、`versionId`、`contentHash`、文件名继续 `notranslate` / `translate="no"`。
- 本轮约束：完成后只做 code review，**不做浏览器验证**；验收以 Vitest + `lint:terminology` + `build` 为准。

## Scope

### Phase 1: Baseline

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
rg -n "pl-wiki-version|OPERATION_LABELS|历史预览|操作类型" src/components/WikiVersionHistoryDialog.tsx src/app/app.css src/__tests__/wiki.test.tsx
```

### Phase 2: WikiVersionHistoryDialog

修改 `src/components/WikiVersionHistoryDialog.tsx`：

1. 更新 `OPERATION_LABELS` 为 Spec 80 §5 业务文案。
2. 默认渲染：全宽 `<table>`，表头 `版本` / `变更说明` / `时间` / `操作`。
3. 版本单元格：`修订 {versions.length - index}`；`index === 0` 时追加 `（当前）`。
4. 当前行（`index === 0`）：操作列不渲染「查看」「恢复此版本」。
5. 非当前行：两按钮左右排列；`查看` → `onSelectVersion`；`恢复此版本` → `onRestore`。
6. 当 `selectedVersionId` 有值时（或 `isDetailLoading` / `selectedVersion`）：切换为详情态——「返回版本列表」按钮（清空选中）、Markdown 预览、Diff；不再渲染侧栏并列表。
7. 删除常驻右侧「历史预览」与占位文案「选择一个历史版本查看 Markdown 预览和 Diff。」。
8. 关闭弹窗仍由父级 `onClose` 清空选中（确认 `WikiEditor` 已有）。

可选：抽出 `formatRevisionLabel(index, total, isCurrent)` 小函数便于测试可读性。

### Phase 3: CSS

修改 `src/app/app.css`：

1. 去掉或停用双栏 `.pl-wiki-version-layout` grid（列表优先单栏）。
2. `.pl-wiki-version-row-actions`：`flex-nowrap`（去掉会纵向换行的 `flex-wrap`）。
3. 详情态预览区可提高 `max-height`（例如 `min(60vh, 480px)`），因已全宽。
4. 清理仅服务于双栏空态的无用规则（若有）。

### Phase 4: Tests

修改 `src/__tests__/wiki.test.tsx` 中版本记录用例：

1. 表头断言改为 `版本` / `变更说明` / `时间` / `操作`；不再断言「操作类型」。
2. 打开弹窗后：`wiki-version-markdown-preview` / `wiki-version-diff` 不在文档中；**不再**断言侧栏占位句。
3. 最新 fixture 行（`v-upload-replace`）应显示「当前」，且 `queryByTestId('wiki-version-view-v-upload-replace')` / `restore` 为 null。
4. 对非当前 `v-create` 点「查看」→ 出现 preview/diff；点返回列表（若有 testid `wiki-version-back-to-list`）后预览消失。
5. 对 `v-create` 点「恢复此版本」→ 恢复预检仍通过（可调整原用例：原先对 `v-upload-replace` 恢复，现应对非当前版本恢复）。
6. 断言变更说明含「上传覆盖」「新建文档」等业务文案。

### Phase 5: Docs / Ledger

1. `webui/docs/README.md` 登记 Spec 80。
2. `webui/docs/plans/README.md` 登记本工单。
3. `docs/ui-ux-feedback/pages/wiki.md` 追加 `UX-WIKI-031`～`035`，落地后 `Status: Fixed`，Notes 写明本轮不做浏览器验证。
4. `docs/ui-ux-feedback/README.md`「最近维护记录」追加一行；跨页面主题可追加 `version-history list-first`（挂 031–035）。
5. 可选：将核查截图复制到 `docs/ui-ux-feedback/assets/wiki/` 并在 Evidence 引用。

### Phase 6: Verify + Code Review

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/wiki.test.tsx
npm run lint:terminology
npm run build
```

完成后做非浏览器 code review（术语、当前行操作、双栏残留、testid 契约）。**不做浏览器验证。**

## Acceptance Checklist

- [ ] Spec 80 / 本 Plan / README 索引 / 台账已更新
- [ ] 弹窗默认全宽列表，无常驻侧栏预览
- [ ] 列与变更说明符合 Spec 80
- [ ] 当前行无查看/恢复；非当前行按钮横排
- [ ] 查看进入全宽详情并可返回；恢复预检仍可用
- [ ] Vitest + lint:terminology + build 通过
- [ ] 仅 code review，无浏览器验证；ledger 为 `Fixed`

## Design System Compliance

- Dialog + table + ghost/secondary buttons；列表优先、技术 id 不进主列。
