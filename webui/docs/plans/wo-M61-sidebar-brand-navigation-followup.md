# M61 Sidebar Brand Navigation Follow-up Work Order

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 M61：Sidebar Brand Navigation Follow-up。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/67-sidebar-brand-navigation-polish-spec.md`
- `docs/68-sidebar-brand-navigation-followup-spec.md`
- `docs/plans/wo-M60-sidebar-brand-navigation-polish.md`
- `src/app/App.tsx`
- `src/components/CommandPalette.tsx`
- `src/app/app.css`
- `src/__tests__/app-shell.test.tsx`
- `src/__tests__/command-palette.test.tsx`

目标：

根据 2026-08-03 浏览器核查和用户截图反馈，修复 M60 首轮实现的 4 个问题：左上角品牌区不能返回 `/overview`、命令面板默认态混乱、一级 / 二级菜单字体体系不均匀、品牌名应为 `Lucy WebUI` 且与 `Data Agent 运维控制台` 左右视觉对齐。

## Scope

### Phase 1: Brand Link And Copy Tests

修改 `src/__tests__/app-shell.test.tsx`：

1. 增加测试：左上角品牌区是链接，accessible name 为 `返回系统概览`。
2. 断言品牌链接 `href="/overview"`。
3. 断言品牌区显示 `Lucy WebUI` 和 `Data Agent 运维控制台`。
4. 断言不显示裸 `Lucy` 作为唯一品牌名。
5. 保留现有 `KTX WebUI` 禁用断言。

预期：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/app-shell.test.tsx
```

应先失败。

### Phase 2: Implement Brand Link And Alignment

修改 `src/app/App.tsx`：

1. 将 `.pl-brand-block` 从 `div` 改为 `Link to="/overview"`。
2. 设置 `aria-label="返回系统概览"`。
3. 品牌标题改为 `Lucy WebUI`。
4. 副标题保持 `Data Agent 运维控制台`，继续使用 `notranslate` / `translate="no"`。
5. 保持 logo mark 可见，但不要让 mark 文案参与 accessible name。

修改 `src/app/app.css`：

1. `.pl-brand-block` 增加 link reset：`no-underline`、focus-visible ring。
2. 新增品牌文本容器宽度，例如 `width: 160px`。
3. `.pl-brand-title` 与 `.pl-brand-tagline` 左右视觉对齐。
4. `Lucy WebUI` 允许使用轻微 `letter-spacing` 或 `display:flex; justify-content:space-between` 达成对齐。
5. hover 只改变背景 / 文本色，不做 scale。

验证：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/app-shell.test.tsx
```

Expected: PASS。

### Phase 3: Command Palette Initial-state Tests

修改 `src/__tests__/command-palette.test.tsx`：

1. 更新默认打开测试：
   - palette 打开后 input autofocus。
   - 空查询时不出现 14 个 option。
   - 显示提示 `输入页面或导航名称`。
   - 显示 `ESC` keycap。
2. 更新列表测试：
   - 输入查询后才显示 options。
   - 输入空字符串不展示完整列表。
   - 查询 `评测` 时结果最多 7 条。
3. 更新结果展示测试：
   - option 主文本不包含 URL。
   - URL 如果保留，只能在弱 metadata 节点中出现。

预期：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/command-palette.test.tsx
```

应先失败。

### Phase 4: Refine Command Palette UI

修改 `src/components/CommandPalette.tsx`：

1. 空查询时不渲染 `grouped` results。
2. 空查询时显示提示：`输入页面或导航名称`。
3. 输入查询后显示过滤结果，最多 `slice(0, 7)`。
4. 增加 `ESC` keycap 元素。
5. 结果主行只显示 `entry.label`。
6. 二级 meta 显示 `entry.groupTitle`；路径可删除，或降级为更弱的辅助文本。
7. 保持 `ArrowUp` / `ArrowDown` / `Enter` / `Escape` 行为。

修改 `src/app/app.css`：

1. Overlay 改为半透明 + blur：例如 `bg-black/20 backdrop-blur-sm`。
2. Content 更接近系统搜索：宽度约 760-920px，上方居中，圆角 16-20px。
3. Input wrapper 改为大搜索框，高度约 64-76px。
4. Focus ring 改轻：避免粗黑边框。
5. `ESC` keycap 使用细边框、小圆角、固定高度。
6. Results 区只在有查询时出现，间距紧凑。

验证：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/command-palette.test.tsx
```

Expected: PASS。

### Phase 5: Sidebar Typography Tests

修改 `src/__tests__/app-shell.test.tsx`：

1. 保留分组 button 可访问性断言。
2. 断言分组按钮仍存在 `pl-nav-section-title-button`。
3. 不建议测试具体 Tailwind class 组合；只测试稳定 hook，例如：
   - group button 有 `data-testid="nav-group-toggle-connections"`。
   - child link 有 `pl-nav-link`。
4. 如果项目已有 CSS text snapshot，不新增脆弱断言。

### Phase 6: Sidebar Typography Implementation

修改 `src/app/app.css`：

1. `.pl-nav-section-title-button` 从 `text-xs uppercase tracking-wider` 改为 14px 基线：
   - `text-sm`
   - `font-semibold`
   - 移除 `uppercase`
   - 移除 `tracking-wider`
2. `.pl-nav-link` 保持 `text-sm`，字重建议 `font-medium` 或 `font-normal` + active `font-medium`。
3. 一级 / 二级 icon 统一为 16px，或一级 15px / 二级 16px，不再明显跳变。
4. 用颜色、背景和缩进表达层级。
5. 确认 active 状态仍有品牌色竖线和弱底。

验证：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/app-shell.test.tsx
```

Expected: PASS。

### Phase 7: Final Verification

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/app-shell.test.tsx src/__tests__/command-palette.test.tsx src/__tests__/navigation.test.ts
npm run build
```

Expected: PASS。

浏览器视觉核查：

1. 打开 `http://127.0.0.1:55176/overview`。
2. 点击左上角品牌区，确认回到 `/overview`。
3. 打开命令面板，确认默认态只显示大搜索框 + `ESC`，不铺开全部结果。
4. 输入 `评测`，确认结果列表简洁，最多 7 条。
5. 检查侧栏一级 / 二级菜单字体统一。
6. 检查品牌区两行文案左右视觉对齐。

不做移动窄屏验证。

## Acceptance Criteria

- 左上角品牌区整体可点击并返回 `/overview`。
- 品牌标题为 `Lucy WebUI`。
- `Lucy WebUI` 与 `Data Agent 运维控制台` 左右视觉对齐。
- 命令面板空查询默认态不展示全部导航项。
- 命令面板有大搜索框、搜索图标和 `ESC` keycap。
- 查询后结果最多 7 条，主视觉不展示 URL 大列。
- 一级 / 二级菜单统一 14px 基线。
- M60 折叠状态、active 状态和快捷键不回归。
- 术语检查、相关单测和 build 通过。

## Code Review Checklist

- [ ] Brand block is a `Link` to `/overview`.
- [ ] Brand accessible name is explicit and does not expose decorative logo text.
- [ ] Brand copy is `Lucy WebUI` + `Data Agent 运维控制台`.
- [ ] Empty command palette does not render all options.
- [ ] Search result count is capped.
- [ ] URL path is not the primary visual in command results.
- [ ] No `uppercase tracking-wider` on Chinese sidebar group titles.
- [ ] No route changes.
- [ ] No backend changes.
