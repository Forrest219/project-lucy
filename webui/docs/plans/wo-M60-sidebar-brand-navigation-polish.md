# M60 Sidebar Brand Navigation Polish Work Order

**Goal:** 将 Lucy WebUI 左侧侧栏升级为更有品牌识别、可折叠、可搜索的导航体验，同时保持 Data Agent 运维控制台的信息密度。

**Architecture:** 以现有 `AppFrame`、`navigation.ts` 和 `app.css` 为核心，不重做路由和页面主体。新增状态只保存在前端，command palette MVP 只消费现有导航数据并执行路由跳转。

**Tech Stack:** React 19、React Router、Tailwind CSS v4、lucide-react、Vitest / Testing Library。

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 M60 Sidebar Brand Navigation Polish。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/06-navigation-ia.md`
- `docs/40-lucy-webui-positioning-control-plane.md`
- `docs/67-sidebar-brand-navigation-polish-spec.md`
- `src/app/App.tsx`
- `src/app/navigation.ts`
- `src/app/app.css`
- `src/__tests__/app-shell.test.tsx`
- `src/__tests__/navigation.test.ts`

目标：参考 Kaelio ktx Docs 的品牌区、侧栏折叠和 active 状态，但保持 Lucy 的 Data Agent 运维控制台定位。不得照搬文档站主体布局，不改现有路由。

## Scope

1. 升级左上角品牌区：
   - `Lucy` wordmark。
   - logo mark。
   - subtitle 保持 `Data Agent 运维控制台`。
2. 侧栏分组支持折叠：
   - 当前路由所在分组默认展开。
   - 用户折叠状态写入 `localStorage`。
   - chevron 展示 open / closed。
3. active 导航项品牌化：
   - 弱底色。
   - 左侧品牌色竖线。
   - 保持键盘 focus。
4. 新增搜索 / 命令入口：
   - 侧栏品牌区下方显示 `搜索页面和导航入口` 和 `⌘ K`。
   - MVP 打开命令面板后至少搜索并跳转现有导航项。
5. 保持现有 PageHeader 和页面主体布局。
6. 更新测试：
   - `src/__tests__/app-shell.test.tsx`
   - `src/__tests__/navigation.test.ts`
   - 如新增 `CommandPalette.tsx`，同步新增 `src/__tests__/command-palette.test.tsx`。

## Implementation Tasks

### Task 1: Extend Navigation Metadata

**Files:**

- Modify: `src/app/navigation.ts`
- Test: `src/__tests__/navigation.test.ts`

**Steps:**

1. 为 `topLevelEntry` 和 `navGroups` 增加稳定 `id` 字段。
2. 为分组和导航项补充 icon key，不直接在 `navigation.ts` 中 import React。
3. 新增 helper：根据 pathname 找到当前 group id。
4. 更新 navigation 测试，覆盖 5+1 结构、id 稳定性和当前路由 group 匹配。

**Verification:**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/navigation.test.ts
```

Expected: PASS。

### Task 2: Upgrade Brand Area And Sidebar Tokens

**Files:**

- Modify: `src/app/App.tsx`
- Modify: `src/app/app.css`
- Test: `src/__tests__/app-shell.test.tsx`

**Steps:**

1. 将 `.pl-brand-block` 重构为 logo mark + wordmark + subtitle。
2. 保留 `Data Agent 运维控制台`，并为英文 / 专业术语按需添加 `notranslate` 和 `translate="no"`。
3. 增加侧栏宽度 token，建议 `248px`。
4. 新增品牌区 CSS：logo mark 32-40px、wordmark 18-22px、subtitle 12px。
5. 更新 app shell 测试，确认品牌区显示 `Lucy` 和 `Data Agent 运维控制台`。

**Verification:**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/app-shell.test.tsx
```

Expected: PASS。

### Task 3: Implement Collapsible Nav Groups

**Files:**

- Modify: `src/app/App.tsx`
- Modify: `src/app/app.css`
- Test: `src/__tests__/app-shell.test.tsx`

**Steps:**

1. 在 `AppFrame` 中维护 `collapsedGroups` 状态。
2. 初始化时读取 `localStorage` key：`lucy.sidebar.collapsedGroups.v1`。
3. 当 pathname 切换到某分组内页面时，确保该分组展开。
4. 分组标题渲染为 button，包含标题、图标和 chevron。
5. 折叠后不渲染或隐藏该分组的子链接。
6. 更新测试：点击分组标题后子项隐藏；切换到组内路由后分组展开。

**Verification:**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/app-shell.test.tsx
```

Expected: PASS。

### Task 4: Brand Active And Hover States

**Files:**

- Modify: `src/app/app.css`
- Test: `src/__tests__/app-shell.test.tsx`

**Steps:**

1. 新增导航 active token：
   - `--token-color-nav-active-bg`
   - `--token-color-nav-active-marker`
2. 为 `.pl-nav-link--active::before` 增加左侧竖线。
3. 调整 `.pl-nav-link` padding，保证竖线不挤压文字。
4. 保持 hover / focus-visible 不遮盖 active 竖线。
5. 更新测试，至少确认 active link class 仍稳定存在。

**Verification:**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/app-shell.test.tsx
```

Expected: PASS。

### Task 5: Add Command Palette MVP

**Files:**

- Create: `src/components/CommandPalette.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/app.css`
- Test: `src/__tests__/command-palette.test.tsx`

**Steps:**

1. 新建 `CommandPalette`，输入数据来自 `topLevelEntry` 和 `navGroups`。
2. 支持点击侧栏搜索入口打开。
3. 支持 `Meta+K` 打开。
4. 支持输入过滤导航项。
5. 支持 `Escape` 关闭。
6. 支持点击结果跳转并关闭。
7. 加基础 keyboard 测试：打开、过滤、关闭。

**Verification:**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/command-palette.test.tsx src/__tests__/app-shell.test.tsx
```

Expected: PASS。

### Task 6: Final Verification

**Files:**

- No direct code changes unless fixing verification failures.

**Steps:**

1. 运行术语检查。
2. 运行相关单测。
3. 运行 build。
4. 不执行浏览器测试，除非实现过程中新增复杂浏览器行为并由负责人补充要求。

**Verification:**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/navigation.test.ts src/__tests__/app-shell.test.tsx src/__tests__/command-palette.test.tsx
npm run build
```

Expected: PASS。

## Acceptance Criteria

- 左上角品牌区清晰显示 `Lucy` 和 `Data Agent 运维控制台`。
- 主导航分组可以折叠 / 展开。
- 当前路由所在分组默认展开。
- active 导航项有品牌色竖线和弱底色。
- 侧栏搜索入口可打开命令面板。
- 命令面板至少支持导航项搜索和跳转。
- `系统手册` 底部入口仍稳定可见。
- PageHeader 和业务页面主体布局不被重写。
- 新增文案通过术语检查。

## Verification

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/navigation.test.ts src/__tests__/app-shell.test.tsx src/__tests__/command-palette.test.tsx
npm run build
```

Browser check: not required by default.

## Code Review Checklist

- [ ] No route changes.
- [ ] No PageHeader rewrite.
- [ ] No document-site prose layout copied into app pages.
- [ ] Current route group expands automatically.
- [ ] Sidebar state uses a versioned `localStorage` key.
- [ ] Professional English terms use translation defense where user-visible.
- [ ] Command palette has keyboard close behavior.
- [ ] Tests cover navigation metadata and shell behavior.
