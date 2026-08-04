# M63 Command Palette Result Context Work Order

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 M63：Command Palette Result Context。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/67-sidebar-brand-navigation-polish-spec.md`
- `docs/68-sidebar-brand-navigation-followup-spec.md`
- `docs/70-command-palette-result-context-spec.md`
- `src/app/navigation.ts`
- `src/components/CommandPalette.tsx`
- `src/app/app.css`
- `src/__tests__/command-palette.test.tsx`
- `src/__tests__/navigation.test.ts`
- `src/__tests__/app-shell.test.tsx`

目标：

根据 `UX-GLOBAL-SHELL-007`，将命令面板查询结果从“导航列表”升级为“页面搜索结果”：结果需要 breadcrumb、页面标题、说明、命中高亮和更合理排序，同时保持 M61 空态、键盘交互、结果上限和路径降噪不回归。

## Scope

### Phase 1: Navigation Search Metadata Tests

修改 `src/__tests__/navigation.test.ts`：

1. 增加测试：`topLevelEntry` 和 `navGroups[*].items[*]` 都有非空 `description`。
2. 增加测试：如果 `keywords` 存在，数组内不得包含空字符串。
3. 增加测试：所有 description 不超过 48 个中文字符或 96 个 ASCII 字符的等效长度，避免结果行过长。

预期：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/navigation.test.ts
```

Expected before implementation: FAIL。

### Phase 2: Add Navigation Search Metadata

修改 `src/app/navigation.ts`：

1. 为 `NavItem` 增加可选字段：
   - `description?: string`
   - `keywords?: string[]`
2. 为 `topLevelEntry` 和所有 `navGroups` 子项填写 description。
3. 为搜索别名明显的页面补充 keywords，例如：
   - `语义资产`: `["语义", "指标", "字段", "分群", "Catalog"]`
   - `业务 Wiki`: `["文档", "Markdown", "Wiki"]`
   - `角色权限`: `["Role", "权限", "MCP 工具"]`
4. 技术词如 `Connection`、`Schema`、`Table`、`Agent`、`MCP` 保持产品术语标准。

验证：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/navigation.test.ts
```

Expected after implementation: PASS。

### Phase 3: Command Palette Result Tests

修改 `src/__tests__/command-palette.test.tsx`：

1. 查询 `语义` 后，断言结果包含 breadcrumb，例如 `Lucy WebUI` 和 `语义建模`。
2. 断言结果包含页面 description。
3. 断言 `语义资产` 排在 `业务 Wiki` 前面，因为 label 直接命中优先。
4. 断言查询词有高亮节点 `.pl-command-palette-highlight`。
5. 断言结果项不再使用 `.pl-command-palette-item-meta` 大号右侧 group label 作为主视觉。
6. 保留已有：
   - 空态不展示 options。
   - 空 Enter 不导航。
   - 结果最多 7 条。
   - URL/path 不作为主视觉。
   - ArrowUp / ArrowDown / Enter 行为。

预期：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/command-palette.test.tsx
```

Expected before implementation: FAIL。

### Phase 4: Implement Search Scoring And Entry Shape

修改 `src/components/CommandPalette.tsx`：

1. 扩展 `CommandEntry`：
   - `breadcrumb: string[]`
   - `description: string`
   - `keywords: string[]`
2. `flattenEntries()` 从 navigation metadata 填充字段。
3. 新增 `scoreEntry(entry, query)`：
   - label startsWith: 100
   - label includes: 90
   - keyword includes: 75
   - description includes: 55
   - groupTitle includes: 40
   - route includes: 20
4. 空 query 继续返回 `[]`。
5. 查询时只保留 score > 0 的结果，并按 score desc + 原始顺序排序。
6. 继续 `slice(0, 7)`。

验证：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/command-palette.test.tsx
```

Expected: 排序相关测试通过。

### Phase 5: Implement Result Rendering And Highlight

修改 `src/components/CommandPalette.tsx`：

1. 新增安全高亮 helper，不使用 `dangerouslySetInnerHTML`。
2. 结果行结构改为：
   - breadcrumb line
   - title + optional route hint
   - description line
3. route hint 如果保留：
   - class 使用 muted / monospace。
   - `translate="no"` 和 `notranslate`。
4. 删除或替换旧 `.pl-command-palette-item-meta` 右侧大号 group label。
5. `aria-label` 包含 label、groupTitle、description，但不要把 route hint 放成主要语义。

验证：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/command-palette.test.tsx
```

Expected: PASS。

### Phase 6: Result Visual CSS

修改 `src/app/app.css`：

1. 输入区和结果区之间增加 subtle separator。
2. `.pl-command-palette-list` 收紧 padding / gap。
3. `.pl-command-palette-item` 改为 3 行布局，active 背景覆盖整条结果。
4. 新增样式：
   - `.pl-command-palette-breadcrumb`
   - `.pl-command-palette-title-row`
   - `.pl-command-palette-item-description`
   - `.pl-command-palette-route-hint`
   - `.pl-command-palette-highlight`
5. Description 单行截断。
6. Highlight 使用克制颜色，不改变行高。

验证：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/command-palette.test.tsx
```

Expected: PASS。

### Phase 7: Ledger Update After Implementation

修改 `../docs/ui-ux-feedback/pages/global-shell.md`：

1. 将 `UX-GLOBAL-SHELL-007` `Status` 从 `Open` 改为 `Fixed`。
2. Notes 增加实现文件：
   - `webui/src/app/navigation.ts`
   - `webui/src/components/CommandPalette.tsx`
   - `webui/src/app/app.css`
   - `webui/src/__tests__/command-palette.test.tsx`
3. 说明已做非浏览器验证，等待 Docker 重建后浏览器复核。

不修改为 `Verified`，除非本轮明确完成浏览器复核。

### Phase 8: Final Verification

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/command-palette.test.tsx src/__tests__/navigation.test.ts src/__tests__/app-shell.test.tsx
npm run build
git diff --check
```

Expected: PASS。`npm run build` 允许保留当前已知 Vite chunk size warning。

浏览器复核仅在用户或当前任务明确要求时执行：

1. 打开 `http://127.0.0.1:55176/overview`。
2. 打开命令面板。
3. 输入 `语义`。
4. 验证结果展示 breadcrumb、title、description 和高亮。
5. 验证 `语义资产` 排在直接相关结果前列。
6. 验证键盘选择仍可导航。

## Acceptance Criteria

- 空查询仍不展示完整导航列表。
- 空 Enter 不导航。
- 查询结果最多 7 条。
- 每条结果展示 breadcrumb、页面标题和 description。
- 查询词在可见文本中高亮。
- 直接 label 命中结果优先于 groupTitle 命中结果。
- 右侧不再重复大号 group label。
- route hint 如存在，必须弱化并带翻译防御。
- ArrowUp / ArrowDown / Enter / Escape 行为不回归。
- `UX-GLOBAL-SHELL-007` 实现后更新到 `Fixed`，浏览器复核后才能改 `Verified`。
- `npm run lint:terminology`、相关测试和 build 通过。

## Code Review Checklist

- [ ] Search scoring deterministic and does not depend on locale-specific segmentation.
- [ ] Highlight helper does not use `dangerouslySetInnerHTML`.
- [ ] Result description does not overflow or create layout shift.
- [ ] Empty state behavior from M61 remains intact.
- [ ] Route hint is not primary visual and has translation defense.
- [ ] Navigation metadata remains the single source for command palette results.
- [ ] No backend changes.
- [ ] No route changes.
