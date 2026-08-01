# M37 Lucy WebUI 品牌定位升级到 Data Agent Ops Control Plane Work Order

> **修订状态**: v0.2-cross-review（2026-08-01）— 已根据 [`review-spec40-m37.md`](review-spec40-m37.md) 的 3 blocker + 5 建议完成修订；待二次交叉验证。

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring Lucy WebUI's user-visible brand, terminology standard, design spec notes, and key test assertion in sync with the new `Data Agent Ops Control Plane` positioning declared in spec 39. Scope is intentionally narrow: positioning copy + notes + terminology + assertion only. M36's larger UX overhaul (ops dashboard, object detail drawer, action-required queue, publish risk workbench, quality operations, cross-module traceability) is out of scope and tracked in `wo-M36-data-agent-ops-platform-global-ux.md`.

**Architecture:** Documentation + UI copy + test assertion changes only. No new components, no new routes, no API contract changes, no runtime config changes. One UI touch point (`webui/src/app/App.tsx` brand block + `app.css` two new utility classes) plus five documentation files plus one test file. Browser `<title>` is **not** modified.

**Tech Stack:** React (existing), TypeScript, Vitest, Testing Library, existing `app.css` token system, existing `lint:terminology` / `lint:ia-boundary` scripts.

**Source Spec:** [../40-lucy-webui-positioning-control-plane.md](../40-lucy-webui-positioning-control-plane.md)

---

## Context For Developer

Read these documents before editing:

- `AGENTS.md`
- `docs/DEVELOPMENT.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/06-navigation-ia.md`
- `webui/docs/39-data-agent-ops-platform-global-ux-spec.md` (only §4 目标产品心智)
- `webui/docs/40-lucy-webui-positioning-control-plane.md` (this work order's source spec)
- `docs/vision.md` §3 系统架构
- `docs/design-webui-ui-refresh.md` §5.2 与 §10
- `docs/webui-module-guide.md` 产品简介

Inspect these implementation files:

- `webui/index.html`
- `webui/src/app/App.tsx`
- `webui/src/app/app.css`
- `webui/src/lib/breadcrumbs.ts`
- `webui/src/__tests__/app-shell.test.tsx`

Inspect these documentation files:

- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/06-navigation-ia.md`
- `webui/docs/README.md`
- `webui/docs/plans/README.md`
- `docs/DEVELOPMENT.md`
- `docs/vision.md`
- `docs/design-webui-ui-refresh.md`
- `docs/webui-module-guide.md`
- `docs/project-overview.md`
- `docs/product-docs-index.md`

Inspect these tests and extend them:

- `webui/src/__tests__/app-shell.test.tsx`
- `webui/src/__tests__/lint-terminology-scan.test.ts` (read only, do not modify)
- `webui/src/__tests__/lint-ia-boundary.test.ts` (read only, do not modify)

Non-negotiable boundaries:

- Do not change `ktx.yaml`, `webui/config/access.yaml`, or `.ktx/secrets/**`.
- Do not write data question-answering runtime rules into `CLAUDE.md`, `AGENTS.md`, or `webui/config/data-qa-instructions.md`.
- Do not remove any route from `App.tsx`.
- Do not touch M36 work order (Task 1-8) deliverables (ops dashboard, object detail drawer, action-required queue, publish risk workbench, quality operations, cross-module traceability). This work order (M37) is a positioning prerequisite only.
- Do not translate `Data Agent Ops Control Plane` into Chinese as the primary UI term; the English brand term is canonical. Chinese `Data Agent 运维控制台` is allowed as caption only.
- Add `translate="no"` and `notranslate` to the DOM node that renders `Data Agent Ops Control Plane`.
- Keep card radius at existing token values; do not add decorative gradients, hero sections, or marketing layout.
- Do not introduce new dependencies.
- Do not modify the existing 5+1 sidebar IA in `App.tsx`.
- Treat existing dirty worktree changes as user-owned unless they are directly part of this work order.

---

## Codex Direct Prompt

你在 `/Users/zhangxingchen/Projects/project-lucy` 工作。请按 `webui/docs/40-lucy-webui-positioning-control-plane.md` 实施 M37。

**范围红线**：只做定位文案 + 设计 spec 备注 + 术语标准 v0.2 + 测试断言。**不**碰 M36 任一 Task 1-8 的交付物（运维驾驶舱、对象详情抽屉、待处理事项队列、发布风险工作台、质量运营中心、跨模块追溯）；这些归 M36。

**交付**：

1. 升级 `webui/docs/00-product-terminology-standard.md` 到 v0.2，第 3 节新增 `Data Agent Ops Control Plane` 主术语，把「语义维护工作台」与「运维控制面」标为弃用别名。
2. 修改 `webui/src/app/App.tsx:113-114` 品牌区副标题为 `Data Agent Ops Control Plane`（英文 brand term + `translate="no"` + `notranslate`）+ 中文 caption `Data Agent 运维控制台` 作为下一行；`app.css` 追加 `.pl-brand-eyebrow` 与 `.pl-brand-tagline` 两条新 class。
3. **不**修改 `webui/index.html` 的 `<title>`（保持 `Lucy WebUI`）。
4. 修改 `docs/design-webui-ui-refresh.md` 三处过期备注（§5.2、§10 P0 列表、§10 待确认问题表）。
5. 修改 `webui/src/__tests__/app-shell.test.tsx` 新增 `Data Agent Ops Control Plane` + `Data Agent 运维控制台` 断言（同时断言 `语义维护工作台` 不再出现）。
6. 顺手统一：`webui/docs/39-data-agent-ops-platform-global-ux-spec.md` 元数据升 v0.2，§1 背景 line 25 一处「运维控制面」→「运维控制台」。
7. 修改 `webui/docs/README.md` 在「文档索引」表追加 40 号 spec 行；`webui/docs/plans/README.md` 追加 M37 行。
8. 收尾验证 `npm run lint:terminology` / `npm run lint:ia-boundary` / `npx tsc --noEmit` / `npm test` / `npm run build` 全部通过。
9. 收尾说明必须列出修改文件清单、验证命令与结果。

**范围红线**：`docs/vision.md` 与 `docs/webui-module-guide.md` 改写**不**在 M37 范围；由 M38 单独承接（spec 40 §4.4 仅作关联登记）。

---

## Task 1: Terminology Standard v0.2

**Files:**

- Modify: `webui/docs/00-product-terminology-standard.md`

**Step 1: Bump version and date metadata**

In the top metadata table, change:

- `| 版本 | v0.1 |` → `| 版本 | v0.2 |`
- `| 撰写日期 | 2026-07-31 |` → `| 撰写日期 | 2026-07-31；2026-08-01 v0.2（新增 Data Agent Ops Control Plane 主术语，标记『语义维护工作台』为弃用别名） |`

**Step 2: Add the new canonical term row to §3 全局固定术语表**

Locate the table row beginning with `| Ops Dashboard | 运维驾驶舱 |` and insert the new row directly **above** it (so the Control Plane sits next to its derived term):

```md
| Data Agent Ops Control Plane | Data Agent Ops Control Plane | Data Agent 运维控制台 | 语义维护工作台、KTX WebUI（仅作为 UI 副标题时）、控制台（作为唯一称谓）、运维控制面（M37 后视为弃用） | Lucy WebUI 的产品定位；自 M37 起在品牌区副标题出现，文档叙事中以英文 brand term 优先 |
```

**Step 3: Append deprecated-aliases section after the §3 table**

After the §3 table (and before `### 3.1 Review 与 Approval 的边界`), add:

```md
### 3.0 弃用别名（仅供溯源，不允许出现在新代码 / 新文档）

| 弃用别名 | 最后出现 | 弃用理由 | 替代 |
|---|---|---|---|
| 语义维护工作台 | `webui/src/app/App.tsx:114`（v0.1 及之前） | M36 §4 已将 Lucy WebUI 心智从「资源维护」升级为「运维控制台」 | Data Agent Ops Control Plane |
| 运维控制面 | `webui/docs/39-data-agent-ops-platform-global-ux-spec.md` §1 背景 line 25（v0.1） | M37 顺手统一为「运维控制台」，避免 spec 39 ↔ spec 40 漂移 | Data Agent 运维控制台 |
| KTX WebUI 治理控制台 | `docs/webui-module-guide.md:19`（v1.3 及之前） | 品牌已切到 Lucy | Data Agent Ops Control Plane |
| 本地治理工作台 | `docs/project-overview.md:67` | 同上 | Data Agent Ops Control Plane |
```

**Step 4: Update §7 迁移优先级 P0 list**

Locate the existing P0 list under `## 7. 迁移优先级` and prepend one bullet:

```md
- 把品牌区副标题从「语义维护工作台」替换为 `Data Agent Ops Control Plane` + `Data Agent 运维控制台`（M37 已完成；后续 brand term 调整才需再回到本节）。
```

**Step 5: Verify the diff**

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git diff --stat webui/docs/00-product-terminology-standard.md
```

Expected: only `webui/docs/00-product-terminology-standard.md` is changed.

**Step 6: Commit**

```bash
git add webui/docs/00-product-terminology-standard.md
git commit -m "docs(terminology): register Data Agent Ops Control Plane v0.2"
```

---

## Task 2: App Brand Block Copy

**Files:**

- Modify: `webui/src/app/App.tsx`
- Modify: `webui/src/app/app.css` (only if needed for visual stability of the new brand block)

**Step 1: Update the brand block JSX in `webui/src/app/App.tsx`**

Locate the existing markup:

```tsx
<div className="pl-brand-block">
  <strong>Lucy WebUI</strong>
  <span>语义维护工作台</span>
</div>
```

Replace with:

```tsx
<div className="pl-brand-block">
  <strong>Lucy WebUI</strong>
  <span
    translate="no"
    className="notranslate pl-brand-eyebrow"
    title="Data Agent Ops Control Plane"
  >
    Data Agent Ops Control Plane
  </span>
  <span className="pl-brand-tagline">Data Agent 运维控制台</span>
</div>
```

Notes:

- The English brand term wraps a `translate="no"` + `notranslate` span (per spec 39 §10 + spec 40 §7).
- 加 `title` 属性以兜底 sidebar 220px 宽度常态截断（review 🟡 5），用户 hover 可看到完整 brand term。`title` 字符串不作为 DOM 文本翻译防御范围。
- The Chinese caption sits on a third line; class is `pl-brand-tagline`. Do not add `translate="no"` to the Chinese caption.

**Step 2: Add the two new CSS classes to `webui/src/app/app.css`**

> **CSS specificity 注意（review 🔴 2）**：现有 `app.css:111-113` 有
>
> ```css
> .pl-brand-block { @apply mb-6 grid gap-0.5 px-4; }
> .pl-brand-block strong { @apply text-base font-semibold; }
> .pl-brand-block span { @apply text-xs text-fg-muted; }
> ```
>
> `.pl-brand-block span` 的 specificity（class + element）高于单 class `.pl-brand-eyebrow` / `.pl-brand-tagline`。新 class 必须用 `.pl-brand-block .pl-brand-eyebrow` / `.pl-brand-block .pl-brand-tagline` 选择器才能覆盖 `font-size` 与 `color`。

Search for the existing `.pl-brand-block span { ... }` rule in `webui/src/app/app.css`. Add directly after that rule (preserve existing rules; do not modify the legacy rule, only append new ones):

```css
.pl-brand-block .pl-brand-eyebrow {
  display: block;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--pl-color-text-secondary, #475569);
  margin-top: 2px;
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pl-brand-block .pl-brand-tagline {
  display: block;
  font-size: 0.72rem;
  color: var(--pl-color-text-tertiary, #64748b);
  margin-top: 1px;
}
```

Notes:

- 选择器前缀 `.pl-brand-block ` 提高 specificity 至 0,2,0，覆盖旧 `.pl-brand-block span`（0,1,1 在 source order 后但同 specificity 的更具体选择器胜出）。
- **不**加 `letter-spacing`（review 🟡 5 建议，保持新 UI 文案 letter-spacing 为 0）。
- 如现有 `app.css` 未定义 `--pl-color-text-secondary` / `--pl-color-text-tertiary`，回退到字面 hex 值。**不**引入新 CSS 变量；**不**添加 marketing gradients / hero treatments。

**Step 3: Verify the diff**

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git diff webui/src/app/App.tsx webui/src/app/app.css
```

Expected:

- `App.tsx`: brand block updated to new markup, no other lines changed.
- `app.css`: only the two new classes appended, no other rules modified.

**Step 4: Typecheck**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx tsc --noEmit
```

Expected: PASS.

**Step 5: Commit**

```bash
git add webui/src/app/App.tsx webui/src/app/app.css
git commit -m "feat(webui): update brand block to Data Agent Ops Control Plane"
```

---

## Task 3: Refresh Stale Design Spec Notes

**Files:**

- Modify: `docs/design-webui-ui-refresh.md`

**Step 1: Update §5.2 左侧导航 paragraph**

Locate the bullet / paragraph that starts with `顶部品牌区暂不拍板最终品牌文案`. Replace it with:

```md
- 顶部品牌区已升级为 `Data Agent Ops Control Plane`（详见 `webui/docs/40-lucy-webui-positioning-control-plane.md` 与 `39-data-agent-ops-platform-global-ux-spec.md` §4）。
```

**Step 2: Update §10 P0 列表「品牌口径」entry**

Locate the line that begins with `**品牌口径**：Phase 1 保留 KTX WebUI`. Replace it with:

```md
- **品牌口径（已完成）**：品牌区副标题已升级为 `Data Agent Ops Control Plane`（spec 40 / M37）。后续仅当 brand term 再次调整时回到本节。
```

**Step 3: Update §10 「待确认问题」表**

Locate the row whose 第一列 contains `WebUI 顶部品牌是 Lucy 还是 KTX WebUI`. Delete that row and append a trailing note line to the table caption:

```md
> 上述「WebUI 顶部品牌是 Lucy 还是 KTX WebUI」一行已在 spec 40 / M37 解决，本表关闭。
```

If the table is in pure markdown table form and the trailing caption does not fit cleanly, just delete the row without adding a caption; record the deletion in the commit body.

**Step 4: Verify the diff**

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git diff --stat docs/design-webui-ui-refresh.md
```

Expected: only the three target sections are modified, no other content touched.

**Step 5: Commit**

```bash
git add docs/design-webui-ui-refresh.md
git commit -m "docs(spec): refresh stale brand positioning notes"
```

---

## Task 4: App Shell Test Assertion

**Files:**

- Modify: `webui/src/__tests__/app-shell.test.tsx`

**Step 1: Locate the existing assertion block**

The existing test at `app-shell.test.tsx:124-127` reads:

```ts
it("labels onboarding as the runtime system overview area", () => {
  renderAt("/onboarding");
  expect(screen.getByText("Lucy WebUI")).toBeInTheDocument();
  expect(screen.queryByText("KTX WebUI")).not.toBeInTheDocument();
  ...
});
```

**Step 2: Add a new `it()` block directly below the existing one**

```ts
it("renders the Data Agent Ops Control Plane tagline in the brand block", () => {
  renderAt("/onboarding");
  expect(
    screen.getByText("Data Agent Ops Control Plane"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Data Agent 运维控制台"),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("语义维护工作台"),
  ).not.toBeInTheDocument();
});
```

Notes:

- Three asserts cover both presence of new copy and absence of deprecated copy. This prevents the old `语义维护工作台` substring from reappearing under any future refactor.

**Step 3: Run the focused test**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/app-shell.test.tsx
```

Expected: PASS. The new `it()` block is the additional assertion under `app-shell.test.tsx`.

**Step 4: Commit**

```bash
git add webui/src/__tests__/app-shell.test.tsx
git commit -m "test(webui): assert Data Agent Ops Control Plane tagline"
```

---

## Task 5: Spec 39 v0.2 顺手统一

> Reviewer 拍板（2026-08-01）：spec 39 §1 背景 line 25 现有「运维控制面」在 M37 内一并改为「运维控制台」，避免跨 spec 用词漂移。

**Files:**

- Modify: `webui/docs/39-data-agent-ops-platform-global-ux-spec.md`

**Step 1: Bump spec 39 metadata to v0.2**

In the top metadata table:

- `| 版本 | v0.1 |` → `| 版本 | v0.2 |`
- `| 撰写日期 | 2026-08-01 |` → `| 撰写日期 | 2026-08-01（v0.2 顺手统一：运维控制面 → 运维控制台） |`

**Step 2: Replace 「运维控制面」 with 「运维控制台」 in §1 背景**

Locate the line that begins with `从"资源维护"升级为`. The full sentence is `从"资源维护"升级为"运维控制面"`. Replace it with:

```md
这些页面在视觉上已经形成低噪声、克制、企业后台风格。但从目标产品定位看，Lucy 不应只是一组"配置维护页面"，而应成为 **复核企业级 SaaS 后端管理平台的 data agent 运维平台**。这要求 UI 从"资源维护"升级为"运维控制台"：用户能从异常发现进入根因定位，再执行修复、发布、评测和审计追溯。
```

**Step 3: Verify the diff**

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git diff --stat webui/docs/39-data-agent-ops-platform-global-ux-spec.md
```

Expected: only the metadata row + the §1 sentence are changed. Use `grep` to confirm no remaining `运维控制面` substring in this file:

```bash
grep -n "运维控制面" webui/docs/39-data-agent-ops-platform-global-ux-spec.md || echo "OK: no remaining 运维控制面"
```

**Step 4: Commit**

```bash
git add webui/docs/39-data-agent-ops-platform-global-ux-spec.md
git commit -m "docs(spec): harmonize ops control plane wording v0.2"
```

---

## Task 6: README Index Sync And Lint

**Files:**

- Modify: `webui/docs/README.md`
- Modify: `webui/docs/plans/README.md`

**Step 1: Add spec 40 row to `webui/docs/README.md` table**

Locate the existing row:

```md
| [39-data-agent-ops-platform-global-ux-spec.md](39-data-agent-ops-platform-global-ux-spec.md) | Data Agent 运维平台全局 UX：运维驾驶舱、待处理事项、对象详情抽屉、发布风险、质量运营与审计追溯 | 产品 / UX / 前端 / 运维 |
```

Append a new row directly after it:

```md
| [40-lucy-webui-positioning-control-plane.md](40-lucy-webui-positioning-control-plane.md) | Lucy WebUI 品牌定位升级到 Data Agent Ops Control Plane：品牌区副标题、术语标准 v0.2、过期设计 spec 备注与测试断言 | 产品 / 前端 / 文档 |
```

**Step 2: Add M37 row to `webui/docs/plans/README.md`**

Locate the most recent `wo-M36-...` row and append a new row in the same column style (the table column count and format depend on the existing rows; match exactly). If unsure, grep first:

```bash
grep -n "wo-M36" webui/docs/plans/README.md
```

Then insert a new line right after the M36 row, with the same table syntax.

If the existing table does not list individual work orders, instead append a bullet under the appropriate section:

```md
- [`wo-M37-lucy-webui-positioning-control-plane.md`](wo-M37-lucy-webui-positioning-control-plane.md) — Lucy WebUI 品牌定位升级到 Data Agent Ops Control Plane（spec 40 / M37）
```

**Step 3: Run lint, typecheck, full test, build**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm run lint:ia-boundary
npx tsc --noEmit
npm test
npm run build
```

Expected: all five commands PASS.

> **lint 失败处置（review 🟡 4）**：
>
> - 当前 `webui/scripts/lint-terminology.mjs` 的 forbidden list **不**包含 `语义维护工作台` 或 `运维控制面`（只包含 `财政部舱单`、`舱单`、`替代测试` 等机器翻译幻觉词）。M37 不会因为这两个旧词在历史文档/弃用说明上下文出现而 hard fail。
> - 真正的回归兜底靠 `app-shell.test.tsx`（Task 4）+ 00 v0.2 §3.0 弃用别名表（Task 1）。
> - 如未来 linter 把 `语义维护工作台` / `运维控制面` 加入 forbidden list，需要在 `docAllowancePatterns`（当前 `webui/scripts/lint-terminology.mjs` lines 39-76）里允许它们仅出现在「弃用别名 / Deprecated aliases / 禁止文案」上下文，**不**作为 hard fail。
> - 如果 `lint:terminology` 真的因为本工单引入的新字符串 fail，定位到具体 forbidden term 后修复并重跑。
> - 如果 `lint:ia-boundary` fail，failure 与 M37 无关，记录但不修。

**Step 4: Manual visual QA**

Start the dev server and verify the brand block on a real browser:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run dev
```

Then in the browser at `http://127.0.0.1:5173`:

- Brand block shows three lines: `Lucy WebUI` / `Data Agent Ops Control Plane` / `Data Agent 运维控制台`.
- Browser tab title remains `Lucy WebUI` (per reviewer decision, not extended).
- On `/onboarding`, the existing assertion still passes (system overview renders correctly).
- On any other route, the brand block remains visible in the sidebar.
- Hover the brand term in DevTools: confirm the `translate="no"` + `notranslate` attributes are present on the `Data Agent Ops Control Plane` span.

**Step 5: Commit**

```bash
git add webui/docs/README.md webui/docs/plans/README.md
git commit -m "docs(webui): register M37 spec and plan in index"
```

---

## Final Verification Checklist

> Review 🟡 2 建议：以下每项都附一键验证命令与 Expected。commands 在 M37 收尾时由 thinker 自行跑（**不**由 reviewer 跑）；reviewer 审阅时仅核对命令路径与 Expected 是否合理。

- [ ] **术语 v0.2** — `cd webui/docs && grep -c "Data Agent Ops Control Plane" 00-product-terminology-standard.md` ≥ 2；`grep "语义维护工作台" 00-product-terminology-standard.md` 命中弃用别名表。
  Expected: count = 2，命中位置在 §3 表格 + §3.0 弃用别名。
- [ ] **App 品牌区** — `cd webui && grep -n "Data Agent Ops Control Plane" src/app/App.tsx` 命中 2 行（`title` 属性 + 可见文本）；`grep -n "Data Agent 运维控制台" src/app/App.tsx` 命中 1 行。
  Expected: brand block 包含两个新 span，英文 brand term span 带完整 `title`。
- [ ] **CSS 新 class** — `cd webui && grep -n "pl-brand-eyebrow\|pl-brand-tagline" src/app/App.tsx src/app/app.css` 至少 4 命中（每个 class 至少 2 处：App.tsx 引用 + CSS rule 定义）。
  Expected: 命中数 ≥ 4；CSS rule 新选择器前缀为 `.pl-brand-block .` 以保证 specificity。
- [ ] **`<title>` 未扩展** — `cd webui && grep -n "<title>Lucy WebUI</title>" index.html` 命中 1 行。
  Expected: 行内容 = `    <title>Lucy WebUI</title>`（无 `· Data Agent` 后缀）。
- [ ] **design spec 备注** — `cd docs && grep -n "已升级为" design-webui-ui-refresh.md | wc -l` ≥ 1；`grep -n "Phase 1 保留 KTX WebUI" design-webui-ui-refresh.md` 0 命中。
  Expected: 旧备注 0 命中；新备注 ≥ 1 命中。
- [ ] **app-shell 测试** — `cd webui && npm test -- --run src/__tests__/app-shell.test.tsx 2>&1 | tail -20` 应包含 "Data Agent Ops Control Plane" 断言。
  Expected: 全部 PASS。
- [ ] **spec 39 v0.2** — `grep "运维控制面" webui/docs/39-data-agent-ops-platform-global-ux-spec.md` 0 命中；`grep "运维控制台" webui/docs/39-data-agent-ops-platform-global-ux-spec.md` ≥ 1 命中。
  Expected: 旧词 0 命中；新词 ≥ 1 命中。
- [ ] **README 索引** — `cd webui && grep -n "40-lucy-webui-positioning-control-plane" docs/README.md docs/plans/README.md` 各命中 1 行。
  Expected: 两个 README 都登记了 spec 40 / M37。
- [ ] **lint:terminology** — `cd webui && npm run lint:terminology`。
  Expected: exit code 0。
- [ ] **lint:ia-boundary** — `cd webui && npm run lint:ia-boundary`。
  Expected: exit code 0。
- [ ] **typecheck** — `cd webui && npx tsc --noEmit`。
  Expected: exit code 0。
- [ ] **test** — `cd webui && npm test`。
  Expected: exit code 0；所有用例 PASS。
- [ ] **build** — `cd webui && npm run build`。
  Expected: exit code 0；Vite 输出 dist/。
- [ ] **视觉 QA** — 启动 `cd webui && npm run dev` 后访问 `http://127.0.0.1:5173`。
  Expected: brand block 渲染为三行 `Lucy WebUI` / `Data Agent Ops Control Plane` / `Data Agent 运维控制台`；DevTools 检查 brand term span 同时具备 `translate="no"` + `notranslate` + `title="Data Agent Ops Control Plane"`。
- [ ] **边界守住** — `cd /Users/zhangxingchen/Projects/project-lucy && git diff --stat -- ktx.yaml webui/config/access.yaml webui/config/data-qa-instructions.md docs/AGENTS.md docs/CLAUDE.md .ktx/ 2>&1`。
  Expected: 0 命中（仅检查这些文件未被修改）。
- [ ] **5+1 IA 未动** — `cd webui && grep -c "数据接入\|语义建模\|语义发布\|质量评测\|访问治理\|系统概览" src/app/App.tsx`。
  Expected: 与 baseline 一致。
- [ ] **vision.md / webui-module-guide.md 未动** — `cd /Users/zhangxingchen/Projects/project-lucy && git diff -- docs/vision.md docs/webui-module-guide.md`。
  Expected: 无 diff 输出。

## Reviewer Checklist

- [ ] Confirmed: brand block final wording (`Data Agent Ops Control Plane` + caption `Data Agent 运维控制台`).
- [ ] Confirmed: `<title>` not extended; remains `Lucy WebUI`.
- [ ] Confirmed: P1 scope (vision.md + webui-module-guide.md) deferred to M38 (not in M37).
- [ ] Confirmed: `translate="no"` + `notranslate` on the English brand term DOM node.
- [ ] Confirmed: deprecated aliases (including `运维控制面`) listed in 00 v0.2 §3.0 but not actively removed from old docs.
- [ ] Confirmed: P2 (`docs/user-guide/*.html` etc.) is deferred to a follow-up batch.
- [ ] Confirmed: spec 40 §8 待审阅项 all resolved.
- [ ] Confirmed: 顺手统一动作纳入 M37 Task 5，spec 39 §1 背景 line 25「运维控制面」→「运维控制台」。
- [ ] Confirmed: M38 起草人 / 优先级排期在 spec 40 §8 末尾已记录。
