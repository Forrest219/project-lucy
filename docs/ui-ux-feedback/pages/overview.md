# Overview Feedback

本页记录 `/overview`（系统概览）页面级 UI/UX 反馈。状态按当前代码修复与浏览器复核情况更新。

## UX-OVERVIEW-001: MCP 接入区 `Endpoint:` 被双重包裹

Status: Verified
Route: /overview
Area: MCP 接入 / 事实 chip（facts row）
Severity: P2
Reported: 2026-08-03

### Feedback
在 `/overview` 页的 `MCP 接入` 区，`Endpoint: http://127.0.0.1:7879/mcp` 渲染为视觉上的双层边框：单词 `Endpoint` 外面包了一个小圆角 badge，而整行（`Endpoint: <url>`）又被另一个更大的圆角 box 包裹，形成"badge 嵌 badge"的效果。文字本身只出现一次，问题是 CSS 给同一个 row 重复施加了 chip 样式。

### Evidence
- Screenshot (before fix): ../assets/overview/UX-OVERVIEW-001-double-border.png
- 视觉确认（图像理解工具）：存在 nested double-box，`Endpoint` 单词位于内层独立边框、URL 位于外层独立边框，二者不共享容器。

### Expected
`MCP 接入` 行只渲染一个 chip：`Endpoint` 一个圆角小标签 + `: http://127.0.0.1:7879/mcp` 作为同行内文字，不再嵌套任何额外边框容器。

### Browser Check
1. Open `http://127.0.0.1:55176/overview`.
2. Locate the `MCP 接入` panel.
3. Verify the `Endpoint:` row renders as a single pill; no badge-in-badge nesting.
4. Verify `复制 MCP 配置` and `查看配置` buttons remain right-aligned in the same row.

### Notes
- Root cause: `.pl-onboarding-facts span { @apply rounded-pill border border-border-default bg-bg-muted ... }` 是后代选择器（裸 `span`），命中了 wrapper `<span>` 和内部 `Endpoint` `<span>`，使两者都被渲染成 chip，叠加为双框。
- Fix（实际采用 CSS 收敛路径，2026-08-04 docker 复核时验证）：
  - `webui/src/app/app.css`：在 `@media (min-width: 1280px)` 块里新增
    `.pl-onboarding-facts--endpoint { @apply rounded-md border border-border-default bg-bg-muted px-2 py-0.5; }`，
    把 chip 视觉从 span 下放到容器；`.pl-onboarding-facts--endpoint span` 改写为
    `rounded-none border-transparent bg-transparent px-0 py-0`，把基类后代规则继承的 chip 样式清零。
  - `webui/src/pages/Onboarding.tsx`：把 facts 行内的裸文本 `:` 包成
    `<span aria-hidden="true">:</span>`，让 label / `:` / URL 三个节点都作为同一 flex 容器的子元素落在同一个灰底块里；`aria-hidden` 避免屏幕阅读器读出孤立冒号。
  - 结果：`.pl-onboarding-facts span` 基类行为被 `--endpoint` 修饰类精确覆盖，不再误伤未来其它事实块；markup 仍维持 Endpoint / : / code 三段语义，不需要在 JSX 里把 `:` 拆到容器外。
- Files touched:
  - `webui/src/app/app.css` (lines ~2186-2191, `@media (min-width: 1280px)` 块内)
  - `webui/src/pages/Onboarding.tsx` (lines ~966-970, MCP 接入 facts row)
- Verification:
  - DOM: `query [class*='pl-onboarding-facts--endpoint']` 渲染为单个带边框/底色的 `<div>`，其直接子节点为 `Endpoint` / `:` / `<code>url</code>`，无嵌套 chip 容器。
  - Visual: vision-model 复核 docker rebuild 后渲染，确认 label、冒号、URL 三者落在同一个浅灰底+边框+圆角块，无嵌套边框。
  - Tests: `webui/src/__tests__/onboarding.test.tsx` 31/31 passed（fix 提交时）。
- Browser verification passed on 2026-08-03 / 2026-08-04 at `http://127.0.0.1:55176/overview` after docker rebuild.
- Cross-page governance: this is the canonical case for the new "chip container 类 CSS 后代选择器不得给所有 span 加 chip 样式" rule. Other surfaces should audit any `.pl-*-facts` / `.pl-*-chip` style class for similar risk. Fix 优先在 CSS 修饰类层收口（精确 chip 容器 vs 通用基类），其次才考虑 markup 层调整。
- 已知次生 UX 风险已升级为正式条目：`UX-OVERVIEW-006`（label / 冒号 / URL 视觉间距冗余）。

## UX-OVERVIEW-002: 刷新按钮文案过于简约，缺少上次刷新时间戳

Status: Verified
Route: /overview
Area: PageHeader actions / 数据刷新 affordance
Severity: P3
Reported: 2026-08-04

### Feedback
`/overview` 顶部 `刷新` 按钮承担"重拉首页 5 个聚合看板数据"的职责，但仅靠动词 `刷新` 无法告知用户：
1. 这个按钮影响的是"首页数据"而非"整页"；
2. 当前展示的数据是何时拉到的，间隔多久，是否需要手动重拉。

运营在数据可能已变更的窗口下（例如刚在 `启用表范围` / `发布工作台` 完成写入）必须主动猜测"数据是不是新的"，效率低。

### Evidence
- Screenshot (after fix): ../assets/overview/UX-OVERVIEW-002-verified.jpg
- 渲染快照：按钮文字 `刷新首页数据`，右侧 `上次更新：刚刚` → `上次更新：17 秒前`（相对时间随秒跳动）。

### Expected
- 按钮文案明确表达"刷新首页数据"这一意图，区分于浏览器刷新。
- 按钮紧邻右侧展示"上次更新"徽标，15 分钟内显示 `刚刚 / xx 秒前 / xx 分钟前`，超过 15 分钟切到 `HH:MM:SS` 绝对时间。
- 初次进入页面在 5 个核心 query 首次全部 isSuccess 时写入首次时间戳，避免"未知 / --:--:--"的占位。
- 刷新失败时**不**更新时间戳，避免把过期数据冒充为新鲜数据。

### Browser Check
1. Open `http://127.0.0.1:55176/overview`.
2. Locate the actions row in the page header (top-right area).
3. Verify the button label reads `刷新首页数据` (not `刷新`).
4. Verify a `上次更新：...` badge sits immediately to the right of the button.
5. Verify the badge renders a relative label `刚刚 / xx 秒前 / xx 分钟前` within 15 min, and `HH:MM:SS` past 15 min.
6. Click the button: badge resets to `刚刚`, button label flips to `刷新首页数据中...` during in-flight, and `disabled` is enforced while any of the five core queries is fetching.
7. Cause one of the five endpoints to fail (e.g. point one to a 500 path) and click again: badge must NOT update; toast `系统概览刷新失败` appears.

### Notes
- 实现：`webui/src/pages/Onboarding.tsx`
  - 新增 `lastUpdatedAt` state，5 个核心 query 首次全部 `isSuccess` 时由 `useEffect` 一次性写入；点击成功后由 `refreshStatus()` 末尾再次写入。
  - 新增 `now` ticker（`setInterval(..., 1000)`，仅在有 timestamp 时挂载，避免空转 timer）。
  - `lastUpdatedLabel`：`diffMs < 5_000` → 刚刚；`< 60_000` → `xx 秒前`；`< 15 * 60_000` → `xx 分钟前`；否则 `HH:MM:SS`。
  - Badge `aria-live="polite"` + `data-testid="onboarding-last-updated"`，wrapper `data-testid="onboarding-refresh-controls"`。
  - 失败分支不动 `lastUpdatedAt`——保持上次成功的时间，不冒充新鲜数据。
- 测试：`webui/src/__tests__/onboarding.test.tsx` 32/32 passed（新增 badge 渲染 + 点击后跳变两条正向断言；翻转 5 处 M41 旧"no last-updated"反向断言）。
- Browser verification passed on 2026-08-04 at `http://127.0.0.1:55176/overview` after docker rebuild. Observed relative-time ticker at 17 s after click, badge restarted to `刚刚` immediately after a second click.
- 已知次生 UX 风险已升级为正式条目：`UX-OVERVIEW-003`（a11y ticker 噪音）、`UX-OVERVIEW-004`（按钮宽度挤压 description）。

## UX-OVERVIEW-003: 上次更新徽标的 aria-live 每秒 ticker 会产生屏幕阅读器噪音

Status: Fixed
Route: /overview
Area: PageHeader actions / accessibility
Severity: P2
Reported: 2026-08-04

### Feedback
`UX-OVERVIEW-002` 落地后，`上次更新` 徽标使用 `aria-live="polite"` 并每秒重渲染相对时间（`刚刚 → 1 秒前 → 2 秒前 → …`）。屏幕阅读器（NVDA / VoiceOver / JAWS）会把每一次 live update 朗读一遍，导致 `polite` 区域以每秒一次的频率持续播报，对依赖 a11y 工具的运维人员形成严重噪音污染。

### Evidence
- 来源：`webui/src/pages/Onboarding.tsx` 中 `<span ... aria-live="polite" data-testid="onboarding-last-updated">`，外加 `useEffect` 每秒 `setNow(new Date())`。
- 同类已知模式：WAI-ARIA Authoring Practices 明确指出 `aria-live` 区域应承载"通知"而非"状态指针"，连续 ticker 属于误用。

### Expected
徽标对屏幕阅读器"静默"，仅在以下时机 announce 一次：
1. 首次 mount 并写入首时间戳时（`上次更新已就绪`）；
2. 刷新成功且 badge 重置时（`首页数据已刷新`）；
3. 时间跨越显示阈值（`刚刚 → xx 秒前`、`xx 分钟前 → HH:MM:SS`）时（可省略，优先级最低）。
每秒 / 每分钟相对时间跳动对**视觉用户**仍可见，但 live region 应解耦——做法：把 `aria-live` 仅挂在"成功刷新"的瞬时 announce 上（如 toast 化的 inline 提示），或把 badge 改为 `aria-hidden="true"` + 用单独 `<span role="status" aria-live="polite">` 承载 announce 文本。

### Browser Check
1. Open `http://127.0.0.1:55176/overview`.
2. Enable VoiceOver (macOS) / NVDA (Windows) / Orca (Linux), or use Chrome DevTools → Accessibility → Enable full-page accessibility tree.
3. Verify the live region does NOT announce every second; only announces on first load + refresh + threshold crossings.
4. Verify visual users still see `刚刚 / xx 秒前` ticking at 1Hz.
5. Verify no regression on the in-flight `刷新首页数据中...` button label announceme nt.

### Notes
- Fix（采纳 Notes 推荐 A）：`webui/src/pages/Onboarding.tsx` 中视觉徽标改为 `aria-hidden="true"`、无 `aria-live`；独立的 `<span role="status" aria-live="polite" className="sr-only" data-testid="onboarding-last-updated-announce">` 承载 announce 文本。`announceText` state 在三个时机写入：`useEffect` 首次 allSuccess 同步路径（"系统概览数据已就绪"）、`refreshStatus()` 成功分支（"系统概览已刷新"）、`refreshStatus()` 失败分支（"系统概览刷新失败"）。每秒 `setNow(new Date())` 仍驱动视觉徽标文案，但不再触发任何 live region 写入。
- Files touched: `webui/src/pages/Onboarding.tsx`（新增 `announceText` state + sr-only announce span），`webui/src/__tests__/onboarding.test.tsx`（新增 "decouples the visual ticker from the a11y announce channel" 测试）。
- Tests: `webui/src/__tests__/onboarding.test.tsx` 34/34 passed（含本条新增测试）。`aria-hidden="true"` 与 `aria-live` 互斥在断言中显式 pin。
- Browser verification pending docker rebuild（host 源码已修，`docker compose up --build` 后用 VoiceOver 复核每秒 ticker 不再播报即可升至 `Verified`）。

## UX-OVERVIEW-004: 刷新按钮变宽挤压 PageHeader description 换行

Status: Fixed
Route: /overview
Area: PageHeader actions / responsive layout
Severity: P3
Reported: 2026-08-04

### Feedback
按钮文案从 `刷新`（54px）扩展到 `刷新首页数据`（110px）后，PageHeader actions 槽总宽约 +56px，导致 1280px 以下视口（更窄的 13" 笔记本、外部显示器默认缩放 125%、平板横屏等场景）下 description 从 2 行换行变成 3 行，页面首屏占用高度 +1 行。

### Evidence
- 视觉对比：截图见 `../assets/overview/UX-OVERVIEW-002-verified.jpg`（1920px 视口）显示 description 占 2 行；1280px 视口下未截图但渲染层 rect 数据将变化。
- 实现位置：`webui/src/components/PageHeader.tsx`（按既有 `actions` 槽布局），`webui/src/pages/Onboarding.tsx` 中 actions 节点由 `flex items-center gap-3` 包了 `<button>` + badge。

### Expected
- 1440px / 1920px 主流桌面视口：description 保持 2 行。
- 1280px 视口：description 最多 3 行（不出现 4 行）。
- 1024px 以下：badge 自动换到 description 下方，按钮仍独占一行。

### Browser Check
1. Resize the browser to 1920 / 1440 / 1280 / 1024 px and observe the PageHeader layout on `/overview`.
2. Verify description row count does not regress more than 1 row vs the pre-UX-002 baseline (54px button).
3. Verify the button and badge remain on the same row at ≥ 1280px; the badge may wrap to a new line at < 1280px if needed.

### Notes
- 2026-08-04 follow-up（响应用户“上次更新 / 刷新首页数据错位”反馈）：把 `上次更新` 徽标收回到 PageHeader `actions` 槽，与 `刷新首页数据` 按钮同组同排，恢复“动作-反馈邻接”关系并修正错位。
- 同轮删除了 header 低价值长句（`聚合首页待办，判断 data agent 是否处于可交付状态。`），减少 description 挤压风险，降低行高回归概率。
- Files touched: `webui/src/pages/Onboarding.tsx`（徽标从 description 回收至 `onboarding-refresh-controls`；description 文案收敛），`webui/src/__tests__/onboarding.test.tsx`（断言更新为“badge in actions row”）。
- Tests: `cd webui && node_modules/.bin/vitest run src/__tests__/ops-dashboard.test.ts src/__tests__/onboarding.test.tsx --maxWorkers=1` 通过（2 files, 53 tests）。
- Browser verification attempted on 2026-08-04 after user-reported docker rebuild, but not passed：`http://127.0.0.1:55176/overview` 仍显示旧页面（`聚合首页待办，判断 data agent 是否处于可交付状态。` 仍存在，且待处理项仍是 `partial` 文案），说明运行实例未加载本轮源码改动；本条状态维持 `Fixed`。证据截图：`../assets/overview/UX-OVERVIEW-009-010-verify-blocked-20260804.png`。

## UX-OVERVIEW-005: 刷新失败时徽标静默，用户不知道"为什么没更新"

Status: Fixed
Route: /overview
Area: PageHeader actions / 失败状态可观测性
Severity: P2
Reported: 2026-08-04

### Feedback
当前 `refreshStatus` 在 5 个 query 任一失败时仅弹出 toast `系统概览刷新失败`，徽标 `上次更新：…` 保持上次成功的时间不变。这种"静默保留旧值"虽然避免了把过期数据冒充为新鲜数据，但**完全没有失败状态的视觉信号**：
1. 用户看到 `上次更新：17 秒前`，但刚刚点了刷新按钮——他不知道刷新到底有没有跑、跑成没跑成。
2. 必须依赖 toast，但 sonner 默认 toast 在右下角，容易被忽略；toast 结束后就丢失"刚刚失败过"的提示。
3. 多个连续点击失败会重复 toast，但没有"失败 N 次"的累计提示。

### Evidence
- 实现：`webui/src/pages/Onboarding.tsx:refreshStatus()` 失败分支 `toast.error("系统概览刷新失败"); return;` 不写 `lastUpdatedAt`。
- 同类参考：MCP 接入区 `isDanger` 用 `role="alert"` + 红点显式提示 danger 状态；当前刷新失败是 alert 缺失的反例。

### Expected
- 刷新失败时，徽标**保留旧时间**，同时叠加轻量级 inline 失败指示（如 `上次更新：17 秒前（刷新失败）` 或徽标背景变 danger 色 + `!` 图标）。
- toast 仍然弹出，作为瞬时反馈。
- 连续失败 N 次（N ≥ 2）时，徽标文字提示"已 N 次未更新"，帮助用户决定是否需要排查后端。
- 失败状态可通过下一轮成功刷新自动清除。

### Browser Check
1. Open `http://127.0.0.1:55176/overview`.
2. Cause one of the five core endpoints to fail (e.g. via DevTools Network → block `/api/sources`).
3. Click `刷新首页数据`.
4. Verify toast `系统概览刷新失败` appears.
5. Verify the badge stays at the previous timestamp AND shows an inline failure indicator (text or visual).
6. Click again → failure indicator should escalate (counter or persistent icon).
7. Unblock the endpoint and click → badge updates to `刚刚`, failure indicator clears.

### Notes
- 修复方向（待选型）：
  - A. 加 `refreshFailureCount` state，badge 文本追加 `（刷新失败 N 次）`。
  - B. 用 CSS 变量 + `data-state="stale" | "failed"` 让徽标换色，配合红点 / 感叹号图标。
  - C. 让 `lastUpdatedAt` 之外加一个 `lastAttemptedAt` 字段，徽标可显示"上次成功 17 秒前 · 上次尝试失败"。
- 推荐 C：信息密度最完整，且和"数据新鲜度 + 操作新鲜度"两个心智维度对应清晰；视觉实现可降级为 A。
- Fix（采纳 Notes 推荐 A 简化版，去掉 `lastAttemptedAt` 字段）：`webui/src/pages/Onboarding.tsx` 新增 `consecutiveFailures` state（连续刷新失败计数），并把原来的错误页早 return 改为 `if (error && lastUpdatedAt === null)` —— 仅在首次加载失败时整页替换为错误页；后续 refetch 失败不再 wipe 整页。徽标渲染失败标签 `failureLabel`：`consecutiveFailures === 1` → `刷新失败，重试中`；`2` → `刷新失败，连续 2 次未更新`；`≥ 3` → `刷新失败，连续 3 次以上未更新`。`badgeState` 计算为 `ok | warning | danger`：1-2 次为 `warning`（`text-warning-strong`），≥3 次为 `danger`（`text-danger-strong font-medium`），无失败时 `ok`（`text-fg-muted`）。`refreshStatus()` 成功分支把 `consecutiveFailures` 重置为 0，announce text 写 "系统概览已刷新"。
- 顺带修了一个连带 bug：原先 `refreshStatus()` refetch 失败会让 `useQuery` 的 `error` 重新为 truthy，触发 `if (error) { return <p className="pl-error">...</p>; }` 早 return，把 button + badge 整页 wipe 掉。新守门条件 `lastUpdatedAt === null` 保证「有至少一次成功快照」的前提下失败走 inline 失败指示路径，不再整页替换。
- Files touched: `webui/src/pages/Onboarding.tsx`（`consecutiveFailures` state + `failureLabel` / `badgeState` / `badgeClasses` 派生值 + 错误页早 return 守门条件 + `refreshStatus()` 失败 / 成功分支写入），`webui/src/__tests__/onboarding.test.tsx`（新增 "shows an inline failure indicator when a refresh fails, and clears it on success" 测试，phase-aware stub 三阶段覆盖 mount / failing×3 / ok）。
- Tests: `webui/src/__tests__/onboarding.test.tsx` 34/34 passed。失败指示测试断言 `data-state="danger"`、`textContent` 含 "连续 3"、sr-only announce 含 "刷新失败"，并验证第 4 次成功点击后 `data-state="ok"`、badge 文本清掉失败标签、announce 写 "系统概览已刷新"。
- Browser verification pending docker rebuild（host 源码已修，`docker compose up --build` 后用 DevTools Network → Block `/api/sources` 触发连续 3 次失败确认 danger 升级路径、解除阻断确认 4 次成功清零即可升至 `Verified`）。

## UX-OVERVIEW-006: `Endpoint` 行 label / 冒号 / URL 之间视觉间距冗余

Status: Verified
Route: /overview
Area: MCP 接入 / 事实 chip（facts row）
Severity: P3
Reported: 2026-08-04

### Feedback
`UX-OVERVIEW-001` 修复后，`Endpoint: http://127.0.0.1:7879/mcp` 三者正确落在同一个浅灰底块内，但视觉上 `Endpoint` 与 `:` 之间多出一个空格，渲染为 `Endpoint : http...`。原因是把 `:` 包成独立 span 后，flex 容器继承的 `gap-2`（8px）把它和 label 撑开了。英文标点规范要求冒号前不留空格（`Endpoint:`），现在视觉读起来松散、像被误拼成两个词。

### Evidence
- Screenshot (before fix): ../assets/overview/UX-OVERVIEW-006-endpoint-row-extra-space.jpg
- 视觉确认：`Endpoint` span 与 `:` span 之间有可见气口，`:` 与 URL 之间也有气口，两段气口对称反而让 `:` 像被孤立成第三段。

### Expected
- `Endpoint` 与 `:` 之间零间距（紧贴）。
- `:` 与 URL 之间保留自然气口（约 4px），让 `Endpoint: ` 作为一个完整的 key 段，再切到 URL。
- 整段视觉节奏与 chip 内部 label / value 间距对齐（如 `pl-snapshot-card-label` 与 value 之间的节奏）。

### Browser Check
1. Open `http://127.0.0.1:55176/overview`.
2. Locate the `MCP 接入` panel.
3. Verify the row reads visually as `Endpoint: http://127.0.0.1:7879/mcp`（冒号紧贴 label）。
4. Verify the gap between `:` and the URL remains a small but visible separator (~4px).
5. Verify label/URL 视觉权重区分仍然成立（label `text-fg-muted` 浅灰、URL `text-fg-default` 深灰 + monospace）。

### Notes
- Fix：`webui/src/app/app.css` 在 `.pl-onboarding-facts--endpoint` 上把列向 gap 收敛为 0（`@apply gap-x-0 ...`），并给 `: span`（带 `aria-hidden="true"`）加 `mr-1`（4px）撑出 `:` 与 URL 之间的自然间距。这样在不动 `.pl-onboarding-facts` 基类（保持未来其它事实块的 8px 默认节奏）的前提下，精确收敛该单一事实块的列间距。
- Files touched: `webui/src/app/app.css`（lines ~2186-2196，`@media (min-width: 1280px)` 块内）。
- Tests: `webui/src/__tests__/onboarding.test.tsx` 34/34 passed（host fix 后；该 testid 查找失败已由 `67c86a2` 的 `/overview` last-updated a11y 收口，与本 fix 无关）。
- Browser verification passed on 2026-08-04 at `http://127.0.0.1:5174/overview`（docker 端口因 `docker compose up` 用空 volume reset 回默认 5174；lucy 容器内 `webui/dist/` 通过 `docker cp` 同步到 host `vite build` 新产物 `index-CSVAjFf1.css` / `index-DxaksM06.js`，因 macOS docker buildx `BUILDPLATFORM` 空字符串解析 bug 无法走完整 image rebuild 路径——临时覆盖静态产物验证，源码层改动未变）。
- 视觉验证：`querySelector('.pl-onboarding-facts--endpoint').innerText` 返回 `"Endpoint\n:\nhttp://127.0.0.1:7879/mcp"`（三段文本节点都在同一容器内），CSS bundle `index-CSVAjFf1.css` 编译产物含 `.pl-onboarding-facts--endpoint { gap-x:0; ... }` 与 `.pl-onboarding-facts--endpoint span[aria-hidden="true"] { mr-1 }`，DOM 结构 + 编译产物层面 `Endpoint` 紧贴 `:`、`:` 与 URL 间 4px gap 视觉节奏成立；vision 工具本轮调用 abort，未做像素级 screenshot，详 inspect 验证。

## UX-OVERVIEW-007: 全局侧栏中段 nav 在分组全部展开时被截断，「访问治理」组几乎不可见

Status: Verified
Route: /overview（影响所有路由，因为 sidebar 是全局组件）
Area: Global Shell / sidebar layout
Severity: P2
Reported: 2026-08-04

### Feedback
1920×1080 视口下，访问 `/overview` 后侧栏所有 5 个分组（数据接入 / 语义建模 / 语义发布 / 质量评测 / 访问治理）默认展开时，侧栏中段被截断：「质量评测」下子菜单的 icon/文字只露出顶部 1/3（视觉上呈一条黑线），「运行历史」「趋势监控」「安全候选」几乎不可见；「访问治理」整组被遮挡在视觉盲区。

### Evidence
- Screenshot: ../assets/overview/UX-OVERVIEW-007-sidebar-truncation.jpg（侧栏下半段裁切截图，1920×1080 视口）
- DOM 坐标（来自浏览器 inspect）佐证重叠：
  - 「运行历史」`rect: y=658`，「打开系统手册」（footer）`rect: y=668`，两者 y 坐标几乎重叠。
  - 「趋势监控」`y=696`、`安全候选` `y=734` 仍在 viewport 内（y < 1080），但视觉上完全看不到。
  - 「访问治理」`y=790` 整组落在 viewport 中段，但视觉上被父容器 `overflow: hidden` 裁切到不可读。

### Expected
- 任意分组状态组合下，侧栏 footer 贴底不变、中段 nav 独立可滚、滚动条始终可见（**M65 用户拍板 A 方案：接受滚动，不走默认折叠二级**）。
- 主流桌面视口（≥ 1440px）下，5 个分组全展开时 nav 内容可能超出视口，**依赖中段 nav 独立滚动**；不再追求"全部 5 分组不滚动看完"。
- 滚动时子菜单项的 icon 与文字完整渲染，无任何截断。
- 滚动条本身始终可见，避免用户把"nav 可滚"误读为"内容被 footer 遮挡的截断"。

### Browser Check
1. Open `http://127.0.0.1:55176/overview` in a 1920×1080 viewport.
2. Verify all sidebar group titles render fully: 数据接入 / 语义建模 / 语义发布 / 质量评测 / 访问治理.
3. Verify the `质量评测` group expanded sub-items (`评测用例` / `运行历史` / `趋势监控` / `安全候选`) all render with full text (not clipped to top 1/3).
4. Verify `访问治理` group expanded sub-items (`治理概览` / `Agent 实例` / `角色权限` / `访问日志` / `配置审计`) all render.
5. Verify the footer (`系统手册`) remains visible at the bottom of the sidebar without overlapping nav items.
6. Resize to 1280px and 1024px: verify the middle nav can scroll if content exceeds viewport, and footer stays anchored.
7. Verify a thin (6px) scrollbar is visible on the right edge of `.pl-nav` even when no scrolling is in progress; hovering on the nav should darken the thumb color (`fg-muted`).

### Notes
- 根因复检：再次 inspect 发现 `.pl-nav`（`webui/src/app/app.css:114`）实际上**已经**是 `grid min-h-0 flex-1 content-start gap-2 overflow-x-hidden overflow-y-auto pb-3`、`.pl-sidebar-footer`（行 345）**已经**是 `relative z-10 mt-4 grid shrink-0 gap-2 border-t border-border-default ...`，CSS 滚动契约已对。原 Notes 里"`<nav>` 缺 `flex-1 overflow-y-auto`"的描述与当前代码不符，疑似早期某次 commit（M60 sidebar brand polish / M61 sidebar font rhythm 之一）已把这一步连带修了，但台账里没单独登记；副作用是用户从浏览器里看到的"截断"实际上是 macOS overlay scrollbar 默认仅在用户主动滚动时才短暂出现 + 5 分组全展开后用户没有意识到 nav 可滚，仍然以为内容被截断。
- 因此本次 fix 不是再加一次 `flex-1 min-h-0 overflow-y-auto`（已经是这样），而是把方向 A 落实为"保留滚动契约 + 让滚动条可见"：
  - `webui/src/app/app.css`：在 `.pl-nav` 自身追加 `scrollbar-width: thin; scrollbar-color: var(--color-border-default) transparent;`，并在 `.pl-nav::-webkit-scrollbar { width: 6px; height: 6px }` + `.pl-nav::-webkit-scrollbar-track { background: transparent }` + `.pl-nav::-webkit-scrollbar-thumb { background-color: var(--color-border-default); border-radius: var(--token-radius-pill) }` + `.pl-nav:hover::-webkit-scrollbar-thumb { background-color: var(--color-fg-muted) }` 四条自定义 webkit 滚动条规则，确保 Chrome / Safari / 现代 Chromium / Firefox 全部平台始终展示 6px 宽 thumb，thumb 默认浅灰、hover 加深到 fg-muted。
  - 不改 `.pl-sidebar` / `.pl-nav` 的 overflow 契约（已经是 h-screen + flex-1 + min-h-0 + overflow-y-auto）。
  - 不改默认折叠状态（`readCollapsedGroups` 默认 `new Set()`，避免破坏既有 UX 契约）。
  - 不把 footer 合并进滚动区（避免 footer 失去"贴底"语义）。
- Files touched: `webui/src/app/app.css`（lines ~114-125，`.pl-nav` 块 + 紧随其后的四条 `::-webkit-scrollbar*` 规则）。
- Tests: `webui/src/__tests__/onboarding.test.tsx` 34/34 passed（fix 后），与本条改动无关联（fix 在 CSS 层）。
- Lint: `npm run lint:terminology` passed（299 files scanned）。
- TypeScript: `npx tsc --noEmit` 45 errors，全部 pre-existing（涉及 `qualifiedName` / `semanticUpdatedAt` / `mcp-proxy-trace` mock tuple），与本条改动无关联。
- Browser verification pending docker rebuild（host 源码已修、`vite build` 已生成 `index-CSVAjFf1.css` bundle，等 docker 容器 rebuild 完成后复核浏览器实际渲染即可升 `Verified`）。
- 相关影响面：sidebar 是 Global Shell 组件（`webui/src/app/App.tsx` lines ~270-355），影响所有 WebUI 路由；该 fix 不应影响 `/overview` 之外的页面，但应在 dev shell / `/?status=` / `/eval/*` 等任意深路径同步验证滚动条可见性。
- Cross-page governance: 该 fix 让 `.pl-nav` 滚动条本身在视觉上始终可见，对应 README §跨页面治理规则 的 sidebar overflow 规则需要同步追加一条"滚动条必须可见"子条目——见 README §跨页面治理规则 2026-08-04 新增条目。
- Browser verification passed on 2026-08-04 at `http://127.0.0.1:5174/overview`（同 `UX-OVERVIEW-006` 路径限制：docker 端口因空 volume reset 回默认 5174；macOS docker buildx `BUILDPLATFORM` 空字符串解析 bug 走不通 image rebuild 完整路径，临时通过 `docker cp` host `vite build` 产物覆盖容器内 `webui/dist/`，源码层改动未变）。
  - DOM 验证：`browser({ action: "scroll", input: { selector: ".pl-nav", direction: "down", distance: 400 } })` 返回 `effect.moved: true, actualDeltaY: 400`（nav 容器可滚，不再"内容被截断但用户感知不到"）。
  - 全部 5 个分组子菜单均可达：`querySelector('nav[aria-label="主导航"]').innerText` 返回完整 22 行（系统概览 + 数据接入 2 项 + 语义建模 2 项 + 语义发布 2 项 + 质量评测 4 项 + 访问治理 5 项），含 `访问治理 > 配置审计`（最深一项）。
  - CSS 编译产物验证：`curl /assets/index-CSVAjFf1.css` 含 `scrollbar-width: thin; scrollbar-color: var(--color-border-default) transparent;` + `::-webkit-scrollbar{width:6px;height:6px}` + `::-webkit-scrollbar-thumb{background-color:var(--color-border-default);border-radius:var(--token-radius-pill)}` + `::-webkit-scrollbar-thumb:hover{background-color:var(--color-fg-muted)}` 5 条规则。
  - 截图证据：../assets/overview/UX-OVERVIEW-007-verified.jpg（1920×1080 视口，scroll 容器位置已下沉 400px，下方 footer 「打开系统手册」与 nav 「运行历史」重叠已解除，5 分组全可见/可达）。
  - 局限：vision 工具本轮调用 abort，未做像素级渲染视觉确认；DOM + CSS 编译产物 + scroll effect 三项客观证据闭合，screenshot 仅作辅助记录。
- 2026-08-04 M65 用户拍板：保留滚动契约（方向 A 落地），不再追求"≥ 1440px 不滚动看完"。`Expected` 与 README §跨页面治理规则 同步改写为"footer 贴底 + 中段 nav 独立可滚 + 滚动条始终可见"；`Status` 保持 `Verified`，无代码改动。

## UX-OVERVIEW-008: MCP 接入区并列按钮视觉显著性不一致

Status: Fixed
Route: /overview
Area: MCP 接入 / action group
Severity: P2
Reported: 2026-08-04

### Feedback
`复制 MCP 配置` 与 `查看配置` 是同一组并列动作，但前者使用 `primary`、后者使用 `secondary`。该分组没有明确单一路径，主次混用会让用户误以为某个动作更“应该先点”。

### Evidence
- Browser check 2026-08-04 (`http://127.0.0.1:55176/overview`): `复制 MCP 配置` 为深底白字 `primary`，`查看配置` 为白底边框 `secondary`，同排显示时权重差异明显。

### Expected
`MCP 接入`操作组中的并列动作应保持同级视觉层级：`复制 MCP 配置` 与 `查看配置` 均为 `secondary`。只有存在唯一推荐主路径时才允许单个 `primary`。

### Browser Check
1. Open `http://127.0.0.1:55176/overview`.
2. Locate the `MCP 接入` section.
3. Verify both `复制 MCP 配置` and `查看配置` use `secondary` style.
4. Verify this action group contains no `primary` button.

### Notes
- 2026-08-04 已将 `webui/src/pages/Onboarding.tsx` 中 `复制 MCP 配置` 按钮样式从 `pl-btn--primary` 调整为 `pl-btn--secondary`，保持与 `查看配置` 同级。
- 本条与 `UX-CONNECTIONS-023` 属于同一 cross-cutting 主题：`button hierarchy consistency`。
- 2026-08-04 Docker 重建后浏览器复核（`http://127.0.0.1:55176/overview`）未通过：`复制 MCP 配置` 仍为 `pl-btn pl-btn--primary pl-btn--xs notranslate`，`查看配置` 为 `pl-btn pl-btn--secondary pl-btn--xs`。运行时截图文件：`/var/folders/tv/2lzs4s3n4g5cj6r0g0yx08cr0000gq/T/cursor/screenshots/page-2026-08-04T08-54-37-979Z.png`。状态保持 `Fixed`，待确认部署产物与源码版本同步后再复核。

## UX-OVERVIEW-009: 页头说明句包含低价值内部叙事，用户收益不清晰

Status: Fixed
Route: /overview
Area: PageHeader description / 顶部说明文案
Severity: P3
Reported: 2026-08-04

### Feedback
页头说明句中“聚合首页待办，判断 data agent 是否处于可交付状态。”更像内部实现叙事，不直接回答用户“我在这里能做什么”，对一线使用者价值有限。

### Evidence
- Browser check 2026-08-04 (`http://127.0.0.1:55176/overview`): 该句与核心说明并列显示，语义偏内部化，且增加了 header 文案长度。
- Re-check 2026-08-04 (`http://127.0.0.1:55176/overview`): 复核时该句仍可见，见截图 `../assets/overview/UX-OVERVIEW-009-010-verify-blocked-20260804.png`。

### Expected
- 页头文案只保留“当前页面能力 + 用户动作价值”信息。
- 避免 `data agent`、`可交付状态` 等内部流程术语直接暴露在首页主说明句。

### Browser Check
1. Open `http://127.0.0.1:55176/overview`.
2. Locate the page header description.
3. Verify no sentence contains `data agent` or “可交付状态”内部叙事。
4. Verify description focuses on用户可执行目标（查看健康状态、进入处理页面）。

### Notes
- Fix: `webui/src/pages/Onboarding.tsx` 已删除该低价值句，仅保留“查看 Lucy MCP/KTX Runtime/语义资产/Agent 接入当前健康状态”的主说明。
- Tests: `cd webui && node_modules/.bin/vitest run src/__tests__/ops-dashboard.test.ts src/__tests__/onboarding.test.tsx --maxWorkers=1` 通过。
- Cross-cutting theme: `header microcopy value density`。
- Browser verification attempted on 2026-08-04 未通过：运行中的 `:55176` 页面仍渲染旧句，推断部署实例未包含当前源码；状态保持 `Fixed`，待部署实例刷新后复核。

## UX-OVERVIEW-010: 待处理事项使用 `partial` 内部状态词，用户难以理解

Status: Fixed
Route: /overview
Area: 待处理事项 / Catalog 待处理描述
Severity: P2
Reported: 2026-08-04

### Feedback
“Catalog 同步发现 N 个对象处于 partial 状态”直接暴露内部状态枚举值，普通用户无法快速理解“partial 具体缺了什么、该怎么处理”。

### Evidence
- Browser check 2026-08-04 (`http://127.0.0.1:55176/overview`): 待处理事项卡片出现 `partial` 原词，缺少中文解释。
- Re-check 2026-08-04 (`http://127.0.0.1:55176/overview`): 复核时仍显示 `Catalog 同步发现 2 个对象处于 partial 状态`，见截图 `../assets/overview/UX-OVERVIEW-009-010-verify-blocked-20260804.png`。

### Expected
- 待处理事项文案应直接表达用户可理解状态与影响，如“同步不完整（部分字段或元数据缺失）”。
- 保留入口动作（查看连接）形成“问题 + 下一步”闭环。

### Browser Check
1. Open `http://127.0.0.1:55176/overview`.
2. Locate the `待处理事项` section and the Catalog item.
3. Verify description does not contain raw `partial` term.
4. Verify copy explains impact in Chinese (e.g. 同步不完整/字段或元数据缺失).

### Notes
- Fix:
  - `webui/src/lib/opsDashboard.ts` 将描述从 `Catalog 同步发现 N 个对象处于 partial 状态` 改为 `Catalog 同步发现 N 个对象同步不完整（部分字段或元数据缺失）`。
  - `webui/src/__tests__/ops-dashboard.test.ts` 同步更新文案断言。
- Tests: `cd webui && node_modules/.bin/vitest run src/__tests__/ops-dashboard.test.ts src/__tests__/onboarding.test.tsx --maxWorkers=1` 通过。
- Cross-cutting theme: `internal-term translation`。
- Browser verification attempted on 2026-08-04 未通过：运行中的 `:55176` 页面仍是旧 `partial` 文案，说明部署实例未加载本轮改动；状态保持 `Fixed`。