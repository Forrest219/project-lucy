# Agent Admin Browser Audit Remediation Implementation Plan

> **For Coder:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Codex owns plan maintenance and code review only; the coder owns implementation and test execution.

**Goal:** 修复 Agent 管理列表、详情、角色选择、卡片/抽屉中经浏览器审计确认的 UI/UX、可访问性和功能边界问题，并阻止参考模板被当作正式 Role 直接绑定 Agent。

**Architecture:** 前端将正式 Role 选择、参考模板建角流程和失效引用修复明确分离；服务端在 Agent 写接口建立不可绕过的模板校验。详情页通过 URL 管理页签，通过统一脏状态守卫保护编辑内容；抽屉使用现有 Radix Dialog 基础能力；列表采用桌面容器级密度与宽表滚动策略，**不改写 Design System 02 的全局壳层锁宽**。保持现有 YAML Schema、权限计算公式和数据库结构不变。

**Tech Stack:** React、TypeScript、TanStack Query、Fastify、Radix UI、Vitest/Testing Library、Playwright、Vite。

---

## Review verdict（2026-08-26 coder 验证）

对照 `AgentList.tsx`、`AgentDetail.tsx`、`ObjectDetailDrawer.tsx`、`server/admin/agents.ts`、`app.css`、Design System 02、Spec 14/59/103、现有测试与并行计划后的结论：

| 结论 | 项 |
|---|---|
| **认同并保留** | 模板可隐式 materialize 进 `access.yaml`（`materializeTemplateRoleForWrite` + `roleForInput`）；Agent 表单默认拉 `/api/admin/roles`（含模板）；详情 tab 只读 URL、点击不写 URL；`hasEdits` 无路由/`beforeunload` 守卫；权限预览主视图暴露 digest / `rowGrant` / `FinalRows`；`makeDiff` 整文件逐行倾倒；抽屉自定义 Esc/遮罩、无焦点陷阱，footer 展示「关闭方式：尚未关闭」；筛选空状态仅「没有匹配的 Agent」、无清除动作；行内「查看权限/日志」未收纳；列「创建日期」「配置最后变更时间」可下沉到抽屉 |
| **反对并已改写** | Task 6「移除 `.pl-app-shell` 1200px 锁宽 / 1024 无 document 横滚」——与 Design System 02、`app-shell.test.tsx`、门禁「不扩展到其他后台页」冲突；KPI「1024 两列 / 1280 四列」——`pl-metric-grid` 已是 `grid-cols-2 xl:grid-cols-4`，不得重做；「复用已有 Tabs 组件」——仓库无共享 Tabs，应增强现有 `pl-admin-tabbar`；错误体缺 `ok: false`；列名写成「创建时间/配置更新时间」不准确；未声明 **废止 Spec 14 §5.2 模板直绑展开**；未要求改写 `kx_readonly` 治理 dryRun 用例 |
| **补充约束** | Spec 129 必须显式 supersede Spec 14 模板直绑；dryRun 与 write 均拒绝模板；脱敏覆盖 `diff` **与** `proposedYaml`；数据能力主摘要仍按术语标准展示可读元组，digest/`FinalRows` 等进技术详情；脏树已有 Audit/Branding/`app.css`/ObjectDetailDrawer 重叠改动，实施前串行或隔离；与 `admin-data-grid-frame-consistency` / `admin-audit-uiux-remediation` 共享 `ObjectDetailDrawer`、`app.css` 时不得覆盖无关 diff |

验证锚点（代码现状，非猜测）：

- `AgentList` / `AgentDetail` 角色查询均为 `apiGet("/api/admin/roles")`（默认 `includeTemplates=true`）。
- `agents.ts` L37–69 / L918–929 / L1092+：模板路径调用 `materializeTemplateRoleForWrite` 并合并 `rolesForWrite`。
- `AgentDetail` 已有 `tabFromSearch` + `useEffect` 读 `location.search`；tab 按钮仅 `setActiveTab`，不 `setSearchParams`。
- `ObjectDetailDrawer` L122–125：`关闭方式：{closeSourceLabel(...)}`；无 Radix Dialog。
- Design System 02：`--layout-min-readable-width: 1200px`；壳层以下不得压缩，靠 `html { overflow-x: auto }`。
- Spec 14 §5.2 验收仍写：「使用 template role 创建后，落盘 YAML 展开为普通 role」。
- `admin-agents.test.ts`：`kx_readonly` create/patch dryRun 期望 **200 + gate**，与「模板 400」直接冲突，必须改写。
- 列表空筛选文案现为「没有匹配的 Agent」；表头为「创建日期」「配置最后变更时间」；`pl-data-grid-frame` / `pl-data-grid-scroll` 已在列表存在（并行网格计划痕迹）。

---

## 0. Preconditions（脏工作树）

当前工作树已有未提交且可能重叠的改动（含 `webui/src/app/app.css`、`ObjectDetailDrawer` 调用链、Audit/Branding/Governance 等）。实施前必须满足其一：

1. 先完成并提交并行 Audit / Branding / Data-grid 工作，再从干净基线开本计划；或
2. 在独立 worktree / 分支上实施，合并时只带本计划文件，**禁止** `git add` 整文件覆盖他人未提交 diff。

禁止把 Design System 02 全局锁宽变更夹带进本 PR，除非产品另行批准独立 DS 修订单。

---

## 1. 审计结论与已锁定决策

浏览器审计页面：

- `/admin/agents`
- `/admin/agents/zhangxingchen`
- Agent、Token、权限对象相关卡片与详情抽屉

已核实的问题：

1. 角色选择器将 YAML 正式 Role 与内置参考模板合并展示。有效模板可被选中，Agent 写接口随后会把模板隐式写入 `access.yaml`；因此截图中的冗余不只是显示噪声，还会造成“选择模板”和“创建正式 Role”两种行为边界不清。
2. 详情页页签点击不写入 URL（虽已支持读取 `?tab=`）；刷新/前进后退与点击态不一致；表单修改在刷新或离开时可能静默丢失。
3. 权限预览和 diff 暴露过多实现细节，包括 digest、原始路径、布尔判定字段、无关配置上下文及完整 Token hash。
4. 自定义详情抽屉缺少完整焦点捕获和焦点恢复，并展示“关闭方式：尚未关闭”等调试文案。
5. Agent 列表信息密度过高，筛选空状态缺少恢复动作，行操作点击区域偏小且动作平铺。
6. 1024px 视口下因 **Design System 02 全局壳层锁宽 1200px** 会出现 document 级横向滚动；本轮 **不** 把「去掉壳层锁宽」当作 Agent Admin 修复项。

本轮产品决策：

- Agent 只能绑定正式 Role；参考模板只能通过 Role 管理「基于模板创建正式 Role」后再绑定。
- **本决策废止 Spec 14 §5.2「使用 template role 创建后落盘展开」作为 Agent Admin 合法路径**；Spec 129 为该点的新权威，Spec 14 交叉引用须标明 superseded。
- 前端过滤和后端写入校验必须同时实施，不接受仅隐藏 UI 的方案；`dryRun:true` 与 `dryRun:false` 均拒绝模板 ID。
- 桌面端功能验收最低宽度 1024px；**1024–1199 允许保留 DS02 规定的壳层级横滚**；Agent 列表宽表必须在表格容器内滚动，不得因本页列过宽额外放大壳层需求。移动端 390px 适配明确延期。
- 不修改权限计算公式、YAML Schema、数据库结构、Role 管理中的模板复制/读取能力。

---

## 2. Task 1：建立规格和失败测试基线

**Files:**

- Create: `webui/docs/129-agent-admin-browser-audit-remediation-spec.md`
- Modify: `webui/src/__tests__/agent-list.test.tsx`
- Modify: `webui/src/__tests__/agent-detail.test.tsx`
- Modify: `webui/src/__tests__/object-detail-drawer.test.tsx`
- Modify: `webui/server/__tests__/admin-agents.test.ts`
- Modify if needed (交叉引用，非整文件改写): `webui/docs/14-agent-admin-enterprise-delivery-spec.md`

**Steps:**

1. 新建 Spec 129：锁定决策、页面状态、接口错误码（含 `ok: false` 形状）、响应式基线（含「壳层锁宽仍遵 DS02」）、Non-Goals；术语遵循 terminology lint。必须写明 supersede Spec 14 §5.2 模板直绑展开。
2. 将 `agent-list` 中「新建 Agent 显示参考模板」用例改为：请求 `includeTemplates=false`，选择器不出现「参考模板」；失效正式 Role 不作为新建可选项（或禁用且不可提交）。
3. 为详情页补充：正式 Role / 失效正式 Role 当前值、URL 页签读写一致、脏状态守卫、敏感 diff 脱敏的失败测试。
4. 为对象抽屉补充：初始焦点、Tab 焦点陷阱、Esc 关闭、关闭后焦点恢复、无「关闭方式」调试文案的失败测试。
5. **不要**把 `app-shell.test.tsx` 的 1200px 壳层契约改成 1024 无横滚；若需 Agent 列表契约，加在 `agent-list.test.tsx`（列移除、清除筛选、容器滚动类存在）。
6. 为 Agent POST/PATCH（含 `dryRun:true`）增加模板 ID → `REFERENCE_TEMPLATE_NOT_ASSIGNABLE` 且配置字节不变的失败测试；同时改写现有 `kx_readonly`「模板 dryRun 期望 200+gate」用例为「先被模板拒绝，不再进入 gate」。
7. 运行聚焦测试，确认新增断言在实现前失败，记录失败原因，不更新快照掩盖行为差异。

Run:

```bash
cd webui
npm test -- src/__tests__/agent-list.test.tsx src/__tests__/agent-detail.test.tsx src/__tests__/object-detail-drawer.test.tsx
npm test -- server/__tests__/admin-agents.test.ts
```

Expected: 新增行为测试失败，既有无关测试继续通过；`app-shell` DS02 锁宽测试保持绿且本 Task 不改。

**Suggested commit:** `test(agent-admin): define browser audit remediation contracts`

---

## 3. Task 2：分离正式 Role 与参考模板

**Files:**

- Modify: `webui/src/pages/admin/AgentList.tsx`
- Modify: `webui/src/pages/admin/AgentDetail.tsx`
- Modify: `webui/server/admin/agents.ts`
- Modify: `webui/server/__tests__/admin-agents.test.ts`
- Modify if needed: `webui/server/admin/roles.ts`（仅当需澄清注释；行为默认已支持 `includeTemplates=false`）

**Steps:**

1. 新建和编辑 Agent 的角色查询统一使用 `/api/admin/roles?includeTemplates=false`。
2. 角色选择器只展示可绑定的正式 Role；不得出现「参考模板」或「参考模板 · 待修复」。
3. 如果当前 Agent 引用已失效的正式 Role，仅在编辑该 Agent 时保留禁用当前值，并提供进入 Role 管理的修复入口；该项不能成为新建或其他 Agent 的可选值。
4. 保持 Role 管理中的「基于模板创建正式 Role」流程；不得从 Agent 表单直接调用模板复制或实体化逻辑。
5. 在 Agent POST/PATCH **解析角色后、治理 gate / materialize 之前** 统一校验：来源为模板时返回 HTTP 400：

```json
{
  "ok": false,
  "error": {
    "code": "REFERENCE_TEMPLATE_NOT_ASSIGNABLE",
    "message": "Reference template '<roleId>' must be copied to a formal Role before assignment."
  }
}
```

6. 删除 Agent 写入路径对 `materializeTemplateRoleForWrite` 的调用及由此产生的 `access.yaml` 角色合并；若该函数无其他调用方，删除函数与 Spec 98 generation-2 相关过时注释。
7. 保留 `/api/admin/roles` 默认兼容：未传 `includeTemplates=false` 的 Role 管理仍可读取模板；不新增重复接口。
8. 覆盖 POST、PATCH、dryRun、有效正式 Role、无效 Role、模板 ID；断言拒绝后 `access.yaml` 字节不变；改写 `kx_readonly` 治理用例期望。

Expected:

- Agent 角色选择器无模板项。
- 伪造请求（含 dryRun）不能将模板绑定 Agent。
- 正式 Role 绑定/更新与 Role 管理模板复制不受影响。

**Suggested commit:** `fix(agent-admin): restrict assignments to formal roles`

---

## 4. Task 3：让详情页页签可深链并保护未保存修改

**Files:**

- Modify: `webui/src/pages/admin/AgentDetail.tsx`
- Modify: `webui/src/__tests__/agent-detail.test.tsx`

**Steps:**

1. 页签状态继续映射 `?tab=info|tokens|permissions|diff`；默认 `info`。列表深链 `?tab=permissions` / `?tab=tokens` 必须保持有效。
2. 点击页签时用路由 API 写 URL；浏览器前进/后退同步页签；有效 tab 刷新后仍停留。
3. 未知/无权限/不可用 tab 归一化到 `info` 并 `replace` URL，避免循环与空白。
4. 在现有 `pl-admin-tabbar` 上补齐 `tablist` / `tab` / `tabpanel`、`aria-selected`、`aria-controls` 与方向键行为；**不要**引入不存在的共享 Tabs 组件，除非先抽公共 primitive 且本计划明确批准。
5. 以现有 `hasEdits`（各 `edit*` 相对服务端基线）为单一 dirty 源；需要时做标准化比较，避免第二套并行 dirty 标志。
6. `hasEdits=true` 时注册 `beforeunload`；保存成功、主动放弃或恢复初值后解除。
7. 离开详情路由时用应用内确认（React Router `useBlocker` 或等价）；确认才导航，取消保留输入。仓库尚无先例，实现时保持最小封装。
8. 详情内切 tab 不触发放弃确认；表单不得因切 tab 卸载；回信息页输入仍在。
9. 保存失败保持输入与 dirty；保存成功用服务端返回值重置基线。

Expected:

- URL、视觉页签、历史一致。
- 刷新/关闭/路由离开不静默丢改；内部 tab 切换无多余确认。

**Suggested commit:** `fix(agent-detail): persist tabs and guard unsaved edits`

---

## 5. Task 4：收敛 diff 和权限预览的信息层级

**Files:**

- Modify: `webui/server/admin/agents.ts`
- Modify: `webui/src/pages/admin/AgentDetail.tsx`
- Modify: `webui/server/__tests__/admin-agents.test.ts`
- Modify: `webui/src/__tests__/agent-detail.test.tsx`

**Steps:**

1. dry-run 继续返回兼容字段，但 diff 只覆盖本次 Agent 写操作涉及的配置片段（至少限制到变更的 `users[]` 条目及因本请求新增的 `roles` 键）；不得因改显示名倾倒整份无关 Role/用户配置。
2. raw diff 使用带约三行上下文的 unified diff；排序稳定，重复 dry-run 输出相同。可替换当前整文件逐行 `makeDiff`，但保持字段名 `diff` 兼容。
3. 响应发出前对 Token hash、凭据、密钥及等价敏感字段统一替换为 `[REDACTED]`；**`diff` 与 `proposedYaml`（若仍返回）都必须脱敏**；前端不得承担唯一脱敏责任。
4. 前端差异区先展示字段级摘要：显示名称、Role、状态、约束等「旧值 → 新值」；原始 diff 默认折叠在「技术详情」。
5. 权限预览主视图：可用工具、授权连接、数据表、明确限制/拒绝原因；按术语标准以可读「数据能力」元组呈现（含人类可读的行级授权含义），**不要**把裸 `TRUE/FALSE` 当业务结论。
6. `capabilityDigest`、原始 source path、原始 `rowGrant=` / `FinalRows` 实现串放入默认折叠的技术详情。
7. 主术语用「数据能力」；排障英文键名仅出现在技术详情。
8. 高风险权限变更仍走现有预览 / dry-run / 确认与治理 gate，不因信息简化跳过安全门禁。

Expected:

- 改显示名不展示无关角色/用户或未脱敏 Token hash。
- 操作员不展开技术详情即可理解权限结果与本次变更。
- 技术详情仍可排障。

**Suggested commit:** `fix(agent-admin): scope and redact permission diffs`

---

## 6. Task 5：修复对象抽屉可访问性并整理卡片信息

**Files:**

- Modify: `webui/src/components/ObjectDetailDrawer.tsx`
- Modify: `webui/src/__tests__/object-detail-drawer.test.tsx`
- Modify calling card/drawer wiring only where现有 props 无法表达焦点恢复目标
- 注意：与 Audit remediation 计划共享本文件；只改本计划所需行为，保留 Audit 计划对 URL 上下文的约束

**Steps:**

1. 用仓库已使用的 Radix Dialog primitive 重构抽屉外壳（参考 `FrontmatterDrawer` / Wiki dialogs），不另造焦点工具。
2. 打开时焦点落到关闭按钮或首个有意义控件；背景不可被 Tab / 辅助技术操作。
3. Tab/Shift+Tab 在抽屉内循环；Esc 关闭；点击遮罩行为保持现有产品约定。
4. 关闭后焦点恢复到触发该抽屉的控件（Agent 名称/「查看详情」、Token 卡片或对象行）。
5. 删除「关闭方式：尚未关闭」及同类调试文案；必要时仅留测试钩子或开发日志。
6. Agent 抽屉补充创建日期、配置最后变更时间、访问日志入口，承接列表移出的低频字段（`createdAt` / `configUpdatedAt` 已在 Agent 类型中）。
7. Token 卡片按「身份、最近使用、安全信息」分组；IP、User-Agent、hash 进技术详情；hash 脱敏。
8. 保持 `aria-labelledby` / `aria-describedby` 有效。

Expected:

- 键盘焦点不能逃到遮罩后页面。
- 任意关闭方式恢复触发点焦点。
- 生产 UI 无关闭调试信息。

**Suggested commit:** `fix(agent-admin): make detail drawers accessible`

---

## 7. Task 6：降低列表密度并在 DS02 壳层内改善桌面可用性

**Files:**

- Modify: `webui/src/pages/admin/AgentList.tsx`
- Modify: `webui/src/components/RowMoreMenu.tsx` only if现有 prop 无法表达所需动作
- Modify: `webui/src/app/app.css` **仅** Agent 列表密度 / 表格容器微调；**禁止**改 `--layout-min-readable-width` 或移除 `.pl-app-shell` 的 `min-width`
- Modify: `webui/src/__tests__/agent-list.test.tsx`

**Steps:**

1. 筛选区增加「清除筛选」；搜索或任一筛选非默认时可见，一次恢复全部默认。
2. 筛选空状态文案改为「未找到符合条件的 Agent」并提供「清除筛选」；系统零 Agent 时保留创建引导，两种空状态不得混用。
3. 主表移除「创建日期」「配置最后变更时间」列；数据仅在 Agent 抽屉展示。
4. Agent 显示名作为打开详情抽屉的可访问控件；「编辑」保留主行操作；权限与日志收纳进 `RowMoreMenu`（Agent 列表目前未用该组件，允许接入）。
5. 行操作点击目标最小约 32×32px，并提供可读 accessible name。
6. **保留** DS02：`--layout-min-readable-width: 1200px` 与 `.pl-app-shell { min-width: ... }`。1024–1199 视口允许壳层级横滚。
7. 宽表继续使用自身滚动容器（已有 `pl-data-grid-frame` / `pl-data-grid-scroll` 则复用，勿叠套双重滚动）；滚动不影响顶栏与页面操作区。
8. **核实** KPI 已是 `pl-metric-grid` → `grid-cols-2 xl:grid-cols-4`；本 Task 不重做断点，除非回归破坏。
9. 不增加 390px 移动端规则，不以隐藏关键列假装完成移动端支持。

Expected:

- 1024 / 1280 / 1440 下 Agent 列表主流程可用；1024–1199 若出现横滚，仅来自 DS02 壳层锁宽，而非本表额外撑宽。
- 表格内容在表格容器内可访问。
- 常用动作突出，低频收纳；筛选空状态可一键恢复。

**Suggested commit:** `fix(agent-list): improve density within desktop shell`

---

## 8. Task 7：回归、浏览器证据和交付

**Files:**

- Create: `webui/tests/e2e/specs/agent-admin.spec.ts`
- Modify only if required: existing test helpers/fixtures

**Steps:**

1. 新增标记 `@pr-impacted` 的 Agent Admin E2E，不改变现有 smoke 8 范围。
2. 覆盖：列表筛选及清除、Agent 抽屉焦点、进入编辑、正式 Role 选择、模板不显示、URL 页签刷新、未保存离开取消、权限摘要与技术详情。
3. 浏览器人工验收 1024、1280、1440px；为每个宽度保存列表与详情证据截图。记录 1024 下若存在壳层横滚，确认非 Agent 表额外导致。
4. 正式 Role 保存成功；API 伪造模板 ID 返回指定 400，配置未变。
5. 控制台无 error；键盘可完成列表→抽屉→关闭→编辑→页签切换。
6. 运行完整门禁：

```bash
cd webui
npm test -- src/__tests__/agent-list.test.tsx src/__tests__/agent-detail.test.tsx src/__tests__/object-detail-drawer.test.tsx src/__tests__/app-shell.test.tsx
npm test -- server/__tests__/admin-agents.test.ts server/__tests__/admin-roles.test.ts
npm run lint:terminology
npm run lint:ia-boundary
npm run verify:gate
npm run build
npm run e2e:impacted
```

Expected: 全部退出码 0；`app-shell` 仍断言 1200px 壳层契约；浏览器证据符合第 9 节。

7. PR 描述列出行为变化、Spec 14 supersede 说明、兼容性、测试结果、截图位置、明确延期的移动端与「未改 DS02 锁宽」说明。

**Suggested commit:** `test(agent-admin): cover audited management flows`

---

## 9. 最终验收标准

- Agent 新建/编辑角色列表只有正式 Role；参考模板不出现，也不能经 API（含 dryRun）直接绑定。
- 模板拒绝不修改 `access.yaml`；正式 Role 流程与 Role 管理模板复制保持可用。
- Spec 129 已标明废止 Spec 14 §5.2 模板直绑展开路径。
- 详情页 URL 表达当前 tab；刷新/前进/后退一致。
- 未保存修改在刷新、关闭或离开路由时受保护；内部 tab 切换不丢数据。
- diff / proposedYaml 不含无关整包配置或未脱敏 Token hash；业务摘要先于技术详情。
- 对象抽屉完成焦点捕获与恢复；无调试关闭文案。
- 筛选空状态可清除；列表主/低频动作层级清楚。
- 1024px+ Agent 列表主流程可用；宽表容器内滚动；**不**要求拆除 DS02 1200px 壳层锁宽。
- 相关单元、服务端、构建、治理门禁与 `@pr-impacted` E2E 全部通过；`app-shell` DS02 测试仍绿。

---

## 10. Code Review 门禁（Codex 负责）

Coder 完成后，将 PR、commit 或 diff 交给 Codex 审查。审查按以下优先级输出具体文件和行号：

- **P0:** 权限绕过、敏感信息泄露、配置损坏或不可逆写入。
- **P1:** 模板仍可绑定（含 dryRun materialize）、脏状态静默丢失、焦点逃逸、1024 主流程不可用、关键测试缺失、擅自拆除 DS02 壳层锁宽。
- **P2:** 信息层级、空状态、点击目标、URL 状态或错误文案不符合计划。
- **P3:** 不影响功能的局部一致性和维护性问题。

只有满足以下条件才给出「建议合并」：

1. 无 P0/P1 未解决问题。
2. 第 8 节全部命令提供通过证据。
3. 1024/1280/1440px 浏览器证据齐全（含对壳层横滚来源的说明）。
4. 实现未扩展到移动端、权限算法、Schema；未顺手改其他后台页面业务逻辑；未夹带无关脏树改动。
5. 用户工作树中与本计划无关的既有修改未被覆盖、格式化或提交。
