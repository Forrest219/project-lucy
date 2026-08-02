# Spec 40 / M37 Cross-Review — Reviewer Notes (2026-08-01)

> **作者**: Codex (GPT-5 cross-review)
> **审阅对象**: `webui/docs/40-lucy-webui-positioning-control-plane.md` + `webui/docs/plans/wo-M37-lucy-webui-positioning-control-plane.md`
> **状态**: 🔴 3 条 / 🟡 5 条 / 🟢 3 条

## TL;DR

- **CONDITIONAL FAIL**：M37 范围整体收敛，边界大体守住，但 spec / plan 里有 3 个会影响执行一致性或验收可跑性的 blocker，建议 M37 开工前先修。
- 🔴 1：spec 40 §7 的品牌区 JSX 示例与 §4.1 / M37 Task 2 冲突，会误导实现者把 `Lucy WebUI` strong 改掉。
- 🔴 2：M37 Task 2 的 CSS class 会被现有 `.pl-brand-block span` 更高 specificity 覆盖，视觉验收不可靠。
- 🔴 3：M37 视觉 QA 写死 `http://127.0.0.1:55176`，但当前 Vite 配置是 `127.0.0.1:5173`，验收路径不可一键复现。

## 🔴 必须改

### 🔴 1. spec 40 §7 的品牌区 DOM 示例与本 spec 自身目标冲突

**位置**: `webui/docs/40-lucy-webui-positioning-control-plane.md` §4.1 line 84、§5 line 168、§7 lines 222-229；M37 Task 2 Step 1 lines 176-182

**证据**:

- spec 40 §4.1 line 84 目标是 `<strong>Lucy WebUI</strong>` + brand term span + caption span。
- spec 40 §5 line 168 验收也是 `Lucy WebUI` + `Data Agent Ops Control Plane` + `Data Agent 运维控制台`。
- 但 spec 40 §7 lines 222-229 写成：

```tsx
<strong translate="no" className="notranslate">
  Data Agent Ops Control Plane
</strong>
<span className="pl-brand-tagline">Data Agent 运维控制台</span>
```

**问题**: §7 是 Terminology Compliance 的实现级示例，和 §4.1 / §5 / M37 Task 2 的目标 markup 不一致。实现者如果按 §7 写，会把 `Lucy WebUI` 从品牌 strong 位置移走，也会让测试和视觉验收口径分裂。

**建议**: 把 spec 40 §7 示例改成与 M37 Task 2 完全一致：

```tsx
<strong>Lucy WebUI</strong>
<span translate="no" className="notranslate pl-brand-eyebrow">
  Data Agent Ops Control Plane
</span>
<span className="pl-brand-tagline">Data Agent 运维控制台</span>
```

### 🔴 2. M37 Task 2 新增 class 的字号 / 颜色会被现有 `.pl-brand-block span` 覆盖

**位置**: `webui/src/app/app.css` lines 101-113；M37 Task 2 Step 2 lines 190-213

**证据**:

- 现有 CSS：`webui/src/app/app.css:111-113`

```css
.pl-brand-block { @apply mb-6 grid gap-0.5 px-4; }
.pl-brand-block strong { @apply text-base font-semibold; }
.pl-brand-block span { @apply text-xs text-fg-muted; }
```

- M37 Task 2 Step 2 计划新增 `.pl-brand-eyebrow` / `.pl-brand-tagline`，其中包括 `font-size` 与 `color`。

**问题**: `.pl-brand-block span` 的 specificity 是 class + element，高于单 class `.pl-brand-eyebrow` / `.pl-brand-tagline`。即使新 class 放在后面，`font-size` 和 `color` 仍可能被旧规则覆盖，导致 spec 40 §6.2 line 193 的“缩小、弱化、截断”缓解动作没有真实落地。这个风险不会被 `getByText` 测试发现。

**建议**: M37 Task 2 Step 2 改为下列任一方案，并把 Expected diff 写清楚：

- 改旧规则为只命中普通副标题，例如 `.pl-brand-block > span:not(.pl-brand-eyebrow):not(.pl-brand-tagline)`。
- 或新增同等/更高 specificity 规则，例如 `.pl-brand-block .pl-brand-eyebrow`、`.pl-brand-block .pl-brand-tagline`。

同时建议删除新增 CSS 里的 `letter-spacing: 0.02em`，保持新 UI 文案 letter spacing 为 0。

### 🔴 3. 视觉 QA URL 与当前 Vite 配置不一致，验收不可一键执行

**位置**: M37 Task 6 Step 4 lines 452-467、Final Verification line 493；`webui/vite.config.ts` lines 7-11

**证据**:

- M37 Task 6 要求在 `http://127.0.0.1:55176` 验证品牌区。
- 当前 `webui/vite.config.ts:7-11` 配置为：

```ts
server: {
  host: "127.0.0.1",
  port: 5173,
  proxy: {
    "/api": "http://127.0.0.1:5174"
  }
}
```

**问题**: 按 plan 的 `npm run dev` 启动时，前端默认不会跑到 55176。除非另有外部反代，本计划的视觉 QA Step 4 无法被实现者一键复现，违反“验收可执行”维度。

**建议**: 将 Task 6 Step 4 和 Final Verification 的 URL 改为 `http://127.0.0.1:5173`；如果团队确实有 55176 代理，则在 plan 中补一句前置条件和启动方式。

## 🟡 建议改

### 🟡 1. spec 39 “§4 两处运维控制面”判定不准确

**位置**: spec 40 §4.7 lines 152-162、§5 line 172、§8 line 239；M37 Task 5 lines 357、370-388、508

**证据**:

- `rg "运维控制面" webui/docs/39-data-agent-ops-platform-global-ux-spec.md` 当前只命中 line 25（§1 背景）。
- spec 39 §4 lines 64-77 只有 `Data Agent Ops Control Plane` 六维心智，没有 `运维控制面`。
- M37 Task 5 Step 2 实际也只替换 §1 背景，Step 3 用 grep 确认全文件无剩余。

**问题**: 执行动作本身基本正确，但 spec / plan 多处写“§1、§4”或“§4 两处”，会让 reviewer 追不存在的第二处，也会让 00 v0.2 的弃用别名“最后出现”登记不准确。

**建议**: 把 spec 40 §4.7、§5、§8 和 M37 Task 5 / Reviewer Checklist 统一改为“spec 39 §1 line 25 的一处 `运维控制面`；§4 只保留 `Data Agent Ops Control Plane`，不需替换”。

### 🟡 2. Final Verification Checklist 不是每项都有命令 + Expected

**位置**: M37 Final Verification Checklist lines 478-497

**证据**: Task 6 Step 3 lines 437-448 给了五条命令和 Expected；但 Final Verification lines 480-487 多数是文件状态检查，没有对应命令，例如检查 `webui/index.html:6`、`docs/vision.md` / `docs/webui-module-guide.md` untouched、5+1 IA untouched。

**问题**: Prompt 要求“每一项是否可一键验证（命令 + Expected 都有）”。当前 checklist 可以人工审，但不是每项一键验证。

**建议**: 在 Final Verification 下面补一个只读命令块，例如：

```bash
grep -n "<title>Lucy WebUI</title>" webui/index.html
grep -n "Data Agent Ops Control Plane" webui/src/app/App.tsx webui/src/__tests__/app-shell.test.tsx
grep -n "运维控制面" webui/docs/39-data-agent-ops-platform-global-ux-spec.md || echo "OK"
git diff -- docs/vision.md docs/webui-module-guide.md
```

并逐条写 Expected。

### 🟡 3. README index sync 进入了 M37 plan，但 spec 40 §9 Phase 1 成功标志未登记

**位置**: spec 40 §9 line 251；M37 Task 6 lines 400-435、Final Verification line 487

**证据**:

- M37 Task 6 明确要改 `webui/docs/README.md` 和 `webui/docs/plans/README.md`。
- spec 40 §9 Phase 1 成功标志 line 251 列了术语、品牌区、设计 spec、测试断言、spec 39 v0.2、验证和视觉 QA，但没有 README index sync。

**问题**: 这是 plan 做了但 spec 阶段交付未登记的小漂移。它不影响核心产品行为，但会影响后续验收“Phase 1 成功标志”与工单交付清单对齐。

**建议**: 在 spec 40 §9 Phase 1 成功标志补一句“`webui/docs/README.md` / `webui/docs/plans/README.md` 已登记 spec 40 / M37”，或把 Task 6 index sync 降为 plan 收尾文档维护项并在验收中标明非 P0。

### 🟡 4. plan 的 `lint:terminology` 失败处置只提“fix residual”，没有说明旧文档允许上下文

**位置**: M37 Task 6 Step 3 line 450；`webui/scripts/lint-terminology.mjs` lines 11-20、39-76、103-108

**证据**:

- 当前 linter forbidden list不包含 `语义维护工作台` / `运维控制面`，只包含 `财政部舱单`、`舱单`、`替代测试` 等。
- 文档扫描有允许上下文，见 `docAllowancePatterns` lines 39-76。
- M37 line 450 写“likely a residual `语义维护工作台` somewhere not yet updated”。

**问题**: 计划会让 implementer 以为 `语义维护工作台` 是现有 linter 的 hard fail，但当前不是。真正需要约束的是新代码 / 新 UI，不是历史文档和弃用说明上下文。

**建议**: 改成“若未来将 `语义维护工作台` / `运维控制面` 加入 forbidden list，应允许它们只出现在 `弃用别名 / Deprecated aliases / 禁止文案` 上下文；本轮先靠 app-shell 测试和 00 v0.2 约束品牌区回归。”

### 🟡 5. M37 Task 2 的 220px 截断会让 brand term 在当前 sidebar 中长期不可完整显示

**位置**: M37 Task 2 Step 2 lines 195-205；`webui/src/app/app.css` lines 101-113

**证据**:

- 当前 shell sidebar 宽度是 `216px`，见 `app.css:101`。
- sidebar 自身 `px-3` 加 brand block `px-4` 后，brand block 可用文本宽度小于 216px。
- `Data Agent Ops Control Plane` 作为 27 字符英文 brand term，按 plan 的 nowrap + ellipsis 大概率常态截断。

**问题**: spec 40 §3.1 line 61 的目标是“0.1 秒看到 brand term”。如果桌面常态就是截断，用户看到的可能是 `Data Agent Ops Control...`，定位识别力变弱。

**建议**: 视觉 QA 前先拍板一个目标：要么允许常态截断并在 title/tooltip 提供完整 brand term，要么调整 sidebar/brand block 宽度或允许 brand term 两行显示。建议至少在 M37 Task 2 Step 2 增加 `title="Data Agent Ops Control Plane"`，并给 title 属性同样加翻译防御策略或明确不作为 DOM 文本防御范围。

## 🟢 Nits

- spec 40 §6.1 line 187 已列 `docs/vision.md`，但没有显式标 §3 / lines 55,103；建议补 anchors，方便 M38 接手。
- `webui/docs/README.md` 当前标题和开头仍写 `KTX WebUI`（lines 1-3）。这不是 M37 P0，但和本轮定位升级相邻，建议在后续 P2 / M38 一并收口。
- M37 Task 1 Step 4 line 134 在第一颗 commit 就写“M37 已完成”；如果坚持 6 个小 commit，建议改成“自 M37 起”或放到最终 docs commit，避免中间 commit 的事实口径提前。

## 维度核查

1. **范围一致性：FAIL**
   证据：spec 40 §4.1-§4.7 与 M37 Task 1-5 基本对应；Task 6 README index sync 出现在 plan lines 400-435，但 spec 40 §9 line 251 未登记。建议见 🟡 3。

2. **顺手统一动作覆盖度：FAIL**
   证据：spec 39 当前只有 line 25 一处 `运维控制面`；spec 40 §4.7 lines 154、172 和 M37 Task 5 lines 357、508 说 §1 / §4 或“两处”。建议见 🟡 1。

3. **术语合规：PASS with caveat**
   证据：spec 40 §4.2 lines 96-104、§7 lines 203-214 与 M37 Task 1 Step 1-4 lines 99-135 的新术语、弃用别名、P0 bullet 口径一致。 caveat 是 spec 40 §7 JSX 示例冲突，见 🔴 1。

4. **浏览器翻译防御：PASS with blocker**
   证据：spec 40 §4.1.1 line 90 要求英文 brand term 防御，M37 Task 2 Step 1 lines 176-181 对 brand term span 加了 `translate="no"` + `notranslate`；中文 caption 不加防御的口径在 spec 40 line 90 和 M37 line 188 一致。blocker 是 spec 40 §7 示例错位，见 🔴 1。

5. **边界守住：PASS**
   证据：M37 plan 只检查 `webui/index.html` 并明确不修改 `<title>`（lines 31、81、483），未把 `docs/vision.md` / `docs/webui-module-guide.md` 放入改动范围（lines 89、497）。`git diff` / `git add` 清单覆盖术语、App、CSS、设计 spec、测试、spec 39、README indexes（lines 141-150、221-242、283-292、349-350、382-395、472-473）。

6. **验收可执行：FAIL**
   证据：Final Verification 不是每项都有命令 + Expected，见 🟡 2；视觉 QA URL 与 Vite 配置冲突，见 🔴 3。

7. **跨 spec 用词漂移：PASS with caveat**
   证据：当前 `运维控制面` 仅作为旧词出现在 spec 39 line 25 及 spec 40 / M37 的弃用、修订语境；`docs/vision.md` §3 的 `治理控制台` 在 spec 40 §4.4 lines 118-119 已登记给 M38。caveat 是 spec 40 §6.1 可补更精确 anchors，见 🟢。

8. **Commit 消息规范：PASS**
   证据：M37 Task 1-6 commit messages 分别是 `docs(terminology):`、`feat(webui):`、`docs(spec):`、`test(webui):`、`docs(spec):`、`docs(webui):`，见 lines 150、242、292、350、395、473；未看到 Task 2 + Task 3 合并 commit 残留。

9. **关联与风险：FAIL**
   证据：spec 40 §6.2 line 193 对品牌过长的缓解依赖 `.pl-brand-eyebrow`，但当前 CSS specificity 会让这条缓解不可靠，见 🔴 2。其余风险 line 194-197 均有 plan 对应动作或明确 defer。

10. **视觉 / 浏览器兼容性：FAIL**
    证据：新增 CSS class 被现有 `.pl-brand-block span` 覆盖，见 🔴 2；220px / sidebar 宽度常态截断风险见 🟡 5。

11. **文档索引同步：FAIL**
    证据：M37 Task 6 Step 1 给 `webui/docs/README.md` 追加 3 列表格行，当前 README 表也是 3 列（`webui/docs/README.md:6-7`），格式正确；plans README 现有工单表也是 3 列（`webui/docs/plans/README.md:67-99`），Task 6 Step 2 要求匹配现有格式。但 spec 40 §9 未登记 index sync，见 🟡 3。

12. **M38 衔接：PASS**
    证据：spec 40 §4.4 lines 114-121、§8 lines 241-245、§9 lines 252-255 三处均把 `docs/vision.md` / `docs/webui-module-guide.md` 交给 M38；未看到 spec 40 §4 P0 内容漏标为 M38。

## ✅ 已确认（PASS）

- M37 plan 没有要求修改 `webui/index.html` `<title>`；当前 `webui/index.html:6` 为 `<title>Lucy WebUI</title>`。
- M37 plan 没有把 M36 大改造交付物重新纳入范围；Non-negotiable boundaries lines 56-68 覆盖 M36 UX、5+1 IA、runtime/config、依赖等关键边界。
- M37 plan 的设计 spec 备注三处与当前 `docs/design-webui-ui-refresh.md` 现状对得上：line 119、line 616、line 630。
- M37 plan 的 app-shell 测试位置与当前现状对得上：`webui/src/__tests__/app-shell.test.tsx:124-127` 断言 `Lucy WebUI` 存在、`KTX WebUI` 不存在。
- M37 plan 的 README 追加行列数与当前索引表列数匹配：`webui/docs/README.md:6-7` 是 3 列，`webui/docs/plans/README.md:67-99` 是 3 列工单表。

## 审阅者未触发 worktree 变更声明

除按本 prompt 生成本报告 `webui/docs/plans/review-spec40-m37.md` 外，本次审阅只执行只读检查，未修改 spec 40、M37 plan、源码或配置。

`git status --porcelain` 输出（报告写入后）：

```text
 M docs/SYSTEM_HANDBOOK.md
 M webui/.gitignore
 M webui/docs/05-task-list.md
 M webui/docs/25-connection-module-terminology-ia-refresh-spec.md
 M webui/docs/28-catalog-reload-result-ops-ux-spec.md
 M webui/docs/29-connection-semantic-boundary-automation-spec.md
 M webui/docs/README.md
 M webui/docs/plans/README.md
 M webui/index.html
 M webui/package-lock.json
 M webui/package.json
 M webui/server/__tests__/api.add-schema.test.ts
 M webui/server/__tests__/api.semantic-assets.test.ts
 M webui/server/__tests__/help.test.ts
 M webui/server/__tests__/ktx.test.ts
 M webui/server/__tests__/project.add-schema.test.ts
 M webui/server/__tests__/project.test.ts
 M webui/server/help.ts
 M webui/server/ktx.ts
 M webui/server/runtime-config.ts
 M webui/server/semantic-asset-export.ts
 M webui/server/semantic-assets.ts
 M webui/src/__tests__/add-schema-drawer.test.tsx
 M webui/src/__tests__/catalog-asset-upload.test.tsx
 M webui/src/__tests__/connection-overview.test.tsx
 M webui/src/__tests__/connection-test.test.tsx
 M webui/src/__tests__/forbidden-terms.ts
 M webui/src/__tests__/help-center.test.tsx
 M webui/src/__tests__/lint-ia-boundary.test.ts
 M webui/src/__tests__/role-list.test.tsx
 M webui/src/__tests__/table-whitelist.test.tsx
 M webui/src/__tests__/wiki.test.tsx
 M webui/src/components/AddSchemaDrawer.tsx
 M webui/src/components/PageHeader.tsx
 M webui/src/components/WikiSavePreflight.tsx
 M webui/src/components/catalog/CatalogAssetUploadButton.tsx
 M webui/src/components/catalog/CatalogAssetUploadDrawer.tsx
 M webui/src/components/connections/ConnectionTestResultPanel.tsx
 M webui/src/lib/breadcrumbs.ts
 M webui/src/lib/schemas.ts
 M webui/src/lib/types.ts
 M webui/src/lib/wiki.ts
 M webui/src/pages/HelpCenter.tsx
 M webui/src/pages/JoinEditor.tsx
 M webui/src/pages/TableEditor.tsx
 M webui/src/pages/WikiEditor.tsx
 M webui/src/pages/admin/RoleDetail.tsx
 M webui/src/pages/admin/RoleList.tsx
 M webui/src/pages/connections/ConnectionOverview.tsx
 M webui/src/pages/connections/ConnectionTest.tsx
 M webui/src/pages/connections/TableWhitelist.tsx
 M webui/src/pages/eval/CaseEditor.tsx
?? docs/qa/
?? scripts/init-e2e-fixture.sh
?? webui/docs/27-connection-overview-ops-ux-cleanup-spec.md
?? webui/docs/31-connection-manifest-upload-affordance-spec.md
?? webui/docs/32-connection-overview-actionbar-visual-noise-spec.md
?? webui/docs/33-help-center-layout-polish-spec.md
?? webui/docs/39-data-agent-ops-platform-global-ux-spec.md
?? webui/docs/40-lucy-webui-positioning-control-plane.md
?? webui/docs/plans/review-spec40-m37.md
?? webui/docs/plans/wo-M23-connection-overview-ops-ux-cleanup.md
?? webui/docs/plans/wo-M27-connection-overview-enterprise-polish-and-starrocks-template.md
?? webui/docs/plans/wo-M28-connection-manifest-upload-affordance.md
?? webui/docs/plans/wo-M29-connection-overview-actionbar-visual-noise.md
?? webui/docs/plans/wo-M30-help-center-layout-polish.md
?? webui/docs/plans/wo-M36-data-agent-ops-platform-global-ux.md
?? webui/docs/plans/wo-M37-lucy-webui-positioning-control-plane.md
?? webui/playwright.config.ts
?? webui/screenshot.mjs
?? webui/scripts/check-selector-contract.mjs
?? webui/src/__tests__/admin-agents.test.tsx
?? webui/src/__tests__/admin-audit.test.tsx
?? webui/src/__tests__/admin-config-audit.test.tsx
?? webui/src/__tests__/admin-roles.test.tsx
?? webui/tests/
```
