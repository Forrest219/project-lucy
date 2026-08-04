# Global Shell UI/UX Feedback

Route: all WebUI routes, including `/overview`

本页记录全局侧栏、品牌区、命令面板与主导航基础体验反馈。后续浏览器核查应按条目 ID 定向执行 `Browser Check`。

## UX-GLOBAL-SHELL-001: 左上角品牌区必须可点击回系统概览

Status: Verified
Route: all WebUI routes
Area: Sidebar brand / logo
Severity: P1
Reported: 2026-08-03

### Feedback
点击左上角 logo 无法回主界面 `http://127.0.0.1:55176/overview`。

### Evidence
- User feedback on global sidebar brand navigation.

### Expected
左上角品牌区应作为稳定 home affordance：

- 整个 logo / wordmark 区域可点击。
- Accessible name 明确表达返回系统概览。
- 任意业务页面点击后导航到 `/overview`。
- 焦点态与侧栏其他可交互项一致。

### Browser Check
1. Open `/connections` or any non-overview route.
2. Locate the sidebar brand link.
3. Verify the link accessible name is equivalent to `返回系统概览`.
4. Click the brand link.
5. Verify the URL becomes `/overview`.

### Notes
2026-08-03 M61 已将 brand block 改为 `/overview` link。Docker 重建后浏览器复核通过：`返回系统概览` link count is `1`，from `/connections` click navigated to `http://127.0.0.1:55176/overview`.

## UX-GLOBAL-SHELL-002: 命令面板空态不得倾倒完整导航列表

Status: Verified
Route: all WebUI routes
Area: Sidebar search / command palette
Severity: P1
Reported: 2026-08-03

### Feedback
点击搜索框的弹窗过于混乱，对标系统搜索界面应更像单输入框搜索，而不是把所有页面和路径直接铺开。

### Evidence
- Screenshot: `../assets/global-shell/UX-GLOBAL-SHELL-002-before.png`
- Reference: `../assets/global-shell/UX-GLOBAL-SHELL-002-reference.png`

### Expected
命令面板默认应是安静的搜索态：

- 打开后自动聚焦输入框。
- 空输入时不展示完整导航列表。
- 空输入按 Enter 不发生隐式导航。
- 显示 `ESC` keycap。
- 输入关键词后最多展示紧凑结果，结果以页面 label 为主，不展示 URL/path。

### Browser Check
1. Open any WebUI route.
2. Click sidebar search trigger.
3. Verify the command palette is visible and input is focused.
4. Verify empty state has `0` listbox options and shows the prompt text.
5. Press Enter with empty input and verify the URL does not change.
6. Type `评测` and verify results are capped, readable, and do not contain URL/path text.
7. Press Escape and verify the palette closes.

### Notes
2026-08-03 M61 已完成 command palette 空态、结果上限、ESC keycap 和路径降噪；后续 code review 修复了空输入 Enter 隐式跳转风险。Docker 重建后浏览器复核通过：empty state option count is `0`，empty Enter kept `/connections` and palette open，query `评测` returned `3` options with `hasUrlLikeText=false`，Escape closed the palette.

## UX-GLOBAL-SHELL-003: 全局侧栏一级 / 二级菜单字体节奏必须统一

Status: Verified
Route: all WebUI routes
Area: Sidebar navigation
Severity: P2
Reported: 2026-08-03

### Feedback
一级菜单、二级菜单的字体大小、字体不均匀。

### Evidence
- Screenshot: `../assets/global-shell/UX-GLOBAL-SHELL-003-before.png`

### Expected
全局侧栏导航应形成统一 14px 阅读节奏：

- 一级分组与二级链接使用同一字体栈。
- 一级分组和二级链接字号一致，层级差异通过颜色、字重、缩进、图标和背景表达。
- 折叠状态可感知；折叠后二级链接不应占据可见空间。
- 当前项保留清晰但克制的 active marker。

### Browser Check
1. Open `/connections`.
2. Inspect sidebar group title and nav link computed styles.
3. Verify group title and second-level link font size are both `14px`.
4. Collapse a group and verify its child links are no longer visible.
5. Verify active state remains visible without causing typography jumps.

### Notes
2026-08-03 M61 已统一 group title / nav link 字体节奏。Docker 重建后浏览器复核通过：group title font size is `14px`，nav link font size is `14px`，both use the same font stack；折叠 `数据接入` 后 child links visible size is `0`.

## UX-GLOBAL-SHELL-004: 品牌命名与两行视觉长度需要真实对齐

Status: Open
Route: all WebUI routes
Area: Sidebar brand / wordmark
Severity: P2
Reported: 2026-08-03

### Feedback
左上角叫做 **Lucy WebUI**，而不是 Lucy；其中 `Lucy WebUI` 和 `Data Agent 运维控制台` 的长度要一致，左右对齐。

### Evidence
- User feedback on global sidebar brand area.

### Expected
品牌区应同时满足命名与视觉对齐：

- 主品牌文本为 `Lucy WebUI`。
- 副标题为 `Data Agent 运维控制台`。
- 两行不溢出、不截断。
- 两行的视觉长度应接近；验收时应测量实际文本渲染宽度 / text range right edge，而不仅仅测容器宽度。

### Browser Check
1. Open `/overview`.
2. Locate `.pl-brand-title` and `.pl-brand-tagline`.
3. Verify title text is `Lucy WebUI`.
4. Verify tagline text is `Data Agent 运维控制台`.
5. Verify neither line overflows or ellipsizes.
6. Measure actual rendered text ranges and verify their right edges are visually aligned within the accepted tolerance.

### Notes
2026-08-03 M61 已修复命名、可点击区域和容器宽度；Docker 重建后浏览器复核显示：`Lucy WebUI` and `Data Agent 运维控制台` both render without overflow, but actual text widths are still not aligned (`Lucy WebUI` about `81.63px`, tagline about `121.64px`). Keep `Open` until the visual length requirement is explicitly resolved or re-scoped.

## UX-GLOBAL-SHELL-005: 折叠菜单焦点环视觉权重偏高

Status: Open
Route: all WebUI routes
Area: Sidebar navigation focus state
Severity: P3
Reported: 2026-08-03

### Feedback
浏览器复核 M61 时发现：折叠菜单项获得焦点后，focus ring 视觉权重较重，容易和 active state / hover state 混淆。

### Evidence
- Browser check observation on `/connections`.

### Expected
侧栏 focus state 应可访问但不抢占 active state：

- 键盘焦点清晰可见。
- 鼠标点击折叠时的短暂焦点态不应形成过重的黑色描边。
- Focus ring、active marker、hover background 三者层级清楚。

### Browser Check
1. Open `/connections`.
2. Click or keyboard-focus a sidebar group title.
3. Verify focus ring is visible but not heavier than the active navigation state.
4. Toggle the group and verify the focus ring does not visually dominate surrounding menu items.

### Notes
2026-08-03 Docker 重建后浏览器复核 M61 时观察到该问题；不是本轮四条反馈的阻断项，作为全局侧栏可用性 P3 长期追踪。

## UX-GLOBAL-SHELL-006: 全局侧栏一级 / 二级缩进层级不足

Status: Fixed
Route: all WebUI routes
Area: Sidebar navigation indentation
Severity: P2
Reported: 2026-08-03

### Feedback
侧边菜单栏一级、二级的缩进不够优雅。浏览器核实显示：一级分组文本从 x≈46 开始，二级项文本从 x≈52 开始，只差约 6px；图标列也只差约 4px，父子层级不明显。

### Evidence
- Screenshot: `../assets/global-shell/UX-GLOBAL-SHELL-006-before.png`

### Expected
侧栏父子层级应通过几何关系清晰表达：

- 一级分组保持 full-width 行宽。
- 二级列表整体进入 inset rail，不和一级分组共用同一左边界。
- 二级文本相对一级分组文本至少右移约 16px。
- 二级 active background 和 active marker 跟随子级内缩行，不贴满一级分组宽度。
- 字号继续保持统一 14px，不通过字号跳变表达层级。

### Browser Check
1. Open `/overview` or `/connections`.
2. Inspect a sidebar group title and one of its child links.
3. Verify child link text starts at least about `16px` to the right of the group title text.
4. Verify child link background / active marker follows the child inset rail.
5. Verify top-level `系统概览` remains full-width and is not styled as a child link.

### Notes
2026-08-03 已修复：`webui/src/app/App.tsx` 为二级容器增加 `pl-nav-group-items`，为二级链接增加 `pl-nav-link--child`；`webui/src/app/app.css` 将二级列表整体 `pl-4` 内缩，并收紧子链接左右 padding。已新增 app shell 测试覆盖子级 rail class；待 Docker 重建后浏览器复核再升级 `Verified`。

## UX-GLOBAL-SHELL-007: 命令面板结果缺少命中上下文和搜索解释力

Status: Fixed
Route: all WebUI routes
Area: Sidebar search / command palette results
Severity: P2
Reported: 2026-08-03

### Feedback
用户对比 Kaelio docs 搜索结果与 Lucy WebUI 搜索结果：Kaelio 搜索 `github` 时展示路径、页面标题、命中标题、正文片段和代码片段；Lucy 搜索 `语义` 时只展示分组和页面名，结果更像导航菜单，缺少“为什么匹配”和“点击后会看到什么”的解释。

### Evidence
- Reference screenshot: `../assets/global-shell/UX-GLOBAL-SHELL-007-reference-ktx.png`
- Current Lucy screenshot: `../assets/global-shell/UX-GLOBAL-SHELL-007-current-lucy.png`

### Expected
命令面板查询结果应从“导航列表”升级为“页面搜索结果”：

- 每条结果展示 breadcrumb / 页面标题 / 一句说明，解释页面用途。
- 查询词在标题、说明或关键词命中处有高亮。
- 结果排序优先 label 命中，其次 keywords / description 命中，再其次 group 命中。
- 右侧不再重复展示分组名；如需保留 route，应弱化为 route hint。
- 结果区和输入区形成连续搜索面板，密度更接近系统搜索，不出现大块空白。

### Browser Check
1. Open any WebUI route.
2. Open the command palette.
3. Type `语义`.
4. Verify each result contains breadcrumb, page title and short description.
5. Verify matched query text is highlighted in visible result text.
6. Verify result ordering prioritizes direct label matches such as `语义资产` before broader group matches.
7. Verify the result row no longer repeats the same group label as a large right-side visual element.

### Notes
2026-08-03 已落盘优化需求：`webui/docs/70-command-palette-result-context-spec.md` 与 `webui/docs/plans/wo-M63-command-palette-result-context.md`。

2026-08-03 已实现 M70 / M63：命令面板结果从导航项升级为页面搜索结果，含 breadcrumb / 标题 / 说明 / 命中高亮 / 稳定排序（label startsWith=100、label includes=90、keyword=75、description=55、groupTitle=40、route=20），route hint 弱化为 monospace 翻译防御 span，并删除右侧大号 group label。实现文件：
- `webui/src/app/navigation.ts`
- `webui/src/components/CommandPalette.tsx`
- `webui/src/app/app.css`
- `webui/src/__tests__/command-palette.test.tsx`
- `webui/src/__tests__/navigation.test.ts`

已通过 `npm run lint:terminology`、`npm test -- command-palette.test.tsx navigation.test.ts app-shell.test.tsx`、`npm run build`。本轮为非浏览器验证，Docker 重建后浏览器复核通过再升级 `Verified`。

## UX-GLOBAL-SHELL-008: help-center test 与 navigation group 顺序不一致

Status: Open
Route: all WebUI routes
Area: Help center fixture vs navigation registry
Severity: P3
Reported: 2026-08-04

### Feedback
`webui/src/__tests__/help-center.test.tsx` 第 782-784 行附近断言侧栏分组顺序包含 `质量评测`，但当前 `webui/src/app/navigation.ts` 把该分组改名为 `访问治理`。`npm test` 在 `help-center.test.tsx` 报错：

```text
expected element with text "访问治理" to have text "质量评测"
```

（或反向断言失败方向，取决于断言写法）。这是一个 navigation 改动未同步测试 fixture 的回归，与 M64 工单无直接关系，但阻塞了非浏览器验证的 test gate。

### Evidence
- 2026-08-04 跑 `npm test -- src/__tests__/help-center.test.tsx` 失败，错误定位 `:782-784`。
- `webui/src/app/navigation.ts` 当前 group label 含 `访问治理` 而非 `质量评测`。
- 历史上 `UX-GLOBAL-SHELL-003`（侧栏字体节奏）等 ledger 提到过侧栏 group 文案调整；新工单改 navigation 时未同步 help-center test fixture。

### Expected
- `help-center.test.tsx` 期望与 `navigation.ts` 当前 group 顺序 / label 一致。
- 不动 navigation 现有顺序（业务已确认 `访问治理` 命名）；只更新测试 fixture。
- 同步检查其他依赖侧栏 group label 的测试（`navigation.test.ts` / `app-shell.test.tsx`），确保没有同类脱钩。

### Browser Check
1. `npm test -- src/__tests__/help-center.test.tsx src/__tests__/navigation.test.ts src/__tests__/app-shell.test.tsx` 应全部通过。
2. 浏览器打开任意 WebUI route，verify sidebar group 文案与 navigation.ts 一致（如 `访问治理`）。
3. verify help center 抽屉（如果存在）也展示对应文案。

### Notes
2026-08-04 在 M64 浏览器复核后跑全套测试时发现，与 M64 改动无依赖关系。归属另一前置工单（可能涉及 `e35c784 fix(webui): polish global sidebar navigation` 这类 commit）。建议修复文件：`webui/src/__tests__/help-center.test.tsx`（更新 fixture）+ `webui/src/__tests__/navigation.test.ts`（如有相关断言）+ 跑 `npm test` 全套。Owner 待 M65 / M66 排期时再指定。
