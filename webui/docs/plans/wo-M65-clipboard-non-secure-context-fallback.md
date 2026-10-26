# Clipboard Non-Secure-Context Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement M65: every WebUI copy entry point must work (or fail loudly) when the origin is not a secure context, including the supported intranet-HTTP customer mode `security.access=http`.

**Architecture:** Frontend-only. Add one pure, stateless helper (`src/lib/clipboard.ts`) that owns the Clipboard API detection, the `execCommand` fallback and the failure reason. Every existing copy entry point routes through it. No backend, ACL, endpoint, routing or visual change.

**Tech Stack:** React, TypeScript, Vitest / Testing Library, Playwright (e2e contract suite).

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中执行 M65：Clipboard Non-Secure-Context Fallback。

必须先阅读：

- `../docs/governance/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/192-clipboard-non-secure-context-fallback-spec.md`
- `docs/plans/wo-M65-clipboard-non-secure-context-fallback.md`
- `../docs/ui-ux-feedback/pages/admin-agents.md`（`UX-ADMIN-AGENTS-042`）
- `src/lib/mcpEndpoint.ts`
- `src/pages/admin/NewToken.tsx`
- `src/pages/admin/AgentDetail.tsx`
- `src/pages/admin/Audit.tsx`
- `src/pages/admin/VersionInfo.tsx`
- `src/pages/connections/ConnectionOverview.tsx`
- `src/pages/connections/TableWhitelist.tsx`
- `src/components/connections/ConnectionTestResultPanel.tsx`
- `src/components/audit-trust/CredentialPrincipalCell.tsx`
- `src/components/onboarding/AuthoringHowTo.tsx`
- `src/components/onboarding/Step6ConnectAgent.tsx`
- `src/pages/Onboarding.tsx`
- `src/__tests__/new-token.test.tsx`
- `src/__tests__/table-whitelist.test.tsx`
- `tests/e2e/specs/agent-admin.spec.ts`

## Non-Negotiable Boundaries

- 不新增后端 API，不改 ACL、Token 生命周期、MCP endpoint 解析与 MCP Session 语义。
- 不改变任何复制**内容**：MCP 配置片段、Token 明文、hash、Manifest 路径文案保持原样。
- 不引入第三方剪贴板依赖（如 `clipboard.js`）。
- 不做 Docker 重建、不出客户包、不改部署形态与 Helm / compose 配置。
- 不重构复制入口所在页面或组件的结构、布局与样式；不新增 CSS 类。
- 不得在复制失败时进入成功态（禁止谎报成功），也不得静默失败（必须 Toast）。
- 失败提示文案不得包含被复制内容（Token 明文、hash、路径）。
- `Token` / `Agent` / `MCP` 等受保护术语的 DOM 翻译防御不得回退。
- 本地脚本必须兼容 stock macOS bash 3.2。

## Scope

### Phase 1: Baseline Source Review

执行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
rg -n "navigator\.clipboard" src/
rg -n "复制当前配置|复制当前选中的配置" src/
```

预期：

- `src/` 命中 12 处 clipboard 调用点，与 Spec 192 §4 表格一致。
- `src/pages/admin/NewToken.tsx` 同时命中 `复制当前配置`（可见文案）与 `复制当前选中的配置`（aria-label）。

如果命中数与 Spec 192 §4 不一致，先更新 Spec 192 §4 表格，再继续实现；不要在实现中静默扩大或缩小范围。

### Phase 2: Implement `src/lib/clipboard.ts`

新建 `src/lib/clipboard.ts`，实现 Spec 192 §5.1 / §5.2 / §5.3：

1. 导出 `export type ClipboardCopyResult = { ok: true } | { ok: false; reason: ClipboardCopyFailureReason };`
2. 导出 `export const CLIPBOARD_COPY_FAILED_MESSAGE = "复制失败，请手动选择文本";`
3. 导出 `export async function copyTextToClipboard(text: string): Promise<ClipboardCopyResult>`
   - 空文本 → `{ ok: false, reason: "empty" }`
   - 第 1 级：`typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function"`
     → `await navigator.clipboard.writeText(text)`；成功返回 `{ ok: true }`；catch 后**继续**降级，不判失败
   - 第 2 级：`typeof document !== "undefined" && typeof document.execCommand === "function"`
     → 隐藏 textarea + `execCommand("copy")`；返回 `true` → `{ ok: true }`；
       返回 `false` → `{ ok: false, reason: "exec-command-rejected" }`；抛错 → `{ ok: false, reason: "exec-command-threw" }`
     → `finally` 移除 textarea 并恢复原选区
   - 第 3 级：都不可用 → `{ ok: false, reason: "clipboard-api-unavailable" }`
4. 导出 `export async function copyTextWithToast(text: string, options: { successMessage?: string; failureMessage?: string }): Promise<boolean>`
   - 成功：有 `successMessage` 则 `toast.success`；返回 `true`
   - 失败：`toast.error(failureMessage ?? CLIPBOARD_COPY_FAILED_MESSAGE)`；返回 `false`
   - **不在 helper 内做成功态置位**——成功态属于调用点的本地 UI 状态，由调用点自行处理
5. 文件头写明：Clipboard API 仅在安全上下文可用，`security.access=http` 是受支持形态，
   因此所有复制入口必须经由本 helper。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx tsc --noEmit -p tsconfig.json
```

Expected: PASS（若项目 tsconfig 不含该路径则跳过，但必须在交付说明里记录）。

### Phase 3: Unit Test For The Helper

新建 `src/__tests__/clipboard.test.tsx`（或 `.ts`，视是否需要 DOM）：

1. **原生路径**：`navigator.clipboard.writeText` 可用且 resolve → 返回 `{ ok: true }`，且写入内容等于传入文本。
2. **回退路径**：删除 `navigator.clipboard`（`Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined })`）
   + mock `document.execCommand` 返回 `true` → 返回 `{ ok: true }`，且 `execCommand` 被以 `"copy"` 调用。
3. **回退路径（拒绝）**：`execCommand` 返回 `false` → 返回 `{ ok: false, reason: "exec-command-rejected" }`。
4. **彻底不可用**：无 `navigator.clipboard` 且 `document.execCommand` 被删除 → 返回 `{ ok: false, reason: "clipboard-api-unavailable" }`。
5. **原生 API reject → 回退**：`writeText` reject → 仍走 `execCommand` 并返回 `{ ok: true }`。
6. **空文本** → `{ ok: false, reason: "empty" }`，且不调用任何写入。
7. **选区恢复**：复制后 `document.getSelection()` 的选区与复制前一致。
8. **`copyTextWithToast`**：成功 → `toast.success` 被调用；失败 → `toast.error` 被调用且参数不含被复制内容。

注意：jsdom 默认不实现 `document.execCommand`，测试需显式 stub；每个用例结束后恢复原值，
避免污染同文件其它用例。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/clipboard.test.tsx
```

Expected: PASS。

### Phase 4: Migrate Call Sites

按 Spec 192 §4 表格逐个迁移，每处保持原有**成功反馈形态**不变，只替换「怎么复制」与「失败怎么办」：

| 文件 | 改法 |
|---|---|
| `src/pages/admin/NewToken.tsx`（`handleCopyToken`） | 改 `async`；`const ok = await copyTextToClipboard(token)`；`ok` 才 `setCopied(true)`；失败 `toast.error` |
| `src/pages/admin/NewToken.tsx`（`handleCopySnippet`） | 同上；成功保留 `toast.success("客户端配置已复制")`；失败 `toast.error("客户端配置复制失败，请手动选择文本")` |
| `src/pages/admin/NewToken.tsx`（按钮属性） | `aria-label` 改为包含可见文案「复制当前配置」；不得删除可见文案 |
| `src/pages/admin/AgentDetail.tsx` | 改用 helper；成功保留 `toast.success("Hash 已复制")` |
| `src/components/onboarding/AuthoringHowTo.tsx` | 改用 helper；成功保留 `setCopied(true)` |
| `src/pages/connections/ConnectionOverview.tsx` | 改用 helper；**失败时不调用 `setCopiedWarningPath`**；成功时置位 |
| `src/components/connections/ConnectionTestResultPanel.tsx` | 改用 helper；失败时 `setCopyStatus("复制失败，请手动选择文本")`，成功时才置成功文案 |
| `src/pages/admin/Audit.tsx` | 改用 `copyTextWithToast(value, { successMessage: \`已复制${label}\`, failureMessage: "复制失败，请重试" })` |
| `src/pages/admin/VersionInfo.tsx` | 改用 helper；保留「复制失败，请重试」原文案 |
| `src/pages/connections/TableWhitelist.tsx` | 改用 helper；保留「已复制 Manifest 路径」/「复制路径失败」原文案 |
| `src/pages/Onboarding.tsx` | 改用 helper；保留原有返回 `true/false` 语义与错误文案 |
| `src/components/onboarding/Step6ConnectAgent.tsx` | 改用 helper；保留 `isPrompt` / `isToken` 分支的置位语义 |
| `src/components/audit-trust/CredentialPrincipalCell.tsx` | 改用 helper；保留原有 catch 文案 |

约束：

- `copyTextToClipboard` 与 `copyTextWithToast` 的**导入名不得与调用点已有的局部函数名冲突**。
  `ConnectionTestResultPanel.tsx` 已有局部 `copyText(text, message)` —— 保持其局部名不变，
  导入 helper 用 `copyTextToClipboard`。
- **必须判 `result.ok`，不能按对象真值判断**：`copyTextToClipboard` 返回
  `{ ok: true } | { ok: false, reason }`，`{ ok: false }` 是真值对象。
  写成 `if (!copiedOk)` 会让失败分支被跳过 —— 既不提示失败，又错误置成功态。
  这是本轮实现真实踩过的坑，由 Phase 5 的失败分支用例当场抓出。
- 不改这些文件的任何 DOM 结构、className、testid。
- `Audit.tsx` 的 `event.stopPropagation()` 必须保留。
- `Audit.tsx` / `VersionInfo.tsx` 迁移后若 `toast` 变成未使用，必须删掉 `sonner` 的 import，
  否则构建报未使用符号。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
rg -n "navigator\.clipboard" src/
```

Expected: 只剩 `src/lib/clipboard.ts` 命中（其余 12 处全部改走 helper）。

### Phase 5: NewToken Regression Tests

修改 `src/__tests__/new-token.test.tsx`，补齐「clipboard 不可用」分支：

1. 新增用例：**删除 `navigator.clipboard`** + stub `document.execCommand` 返回 `true`
   → 点击「复制当前配置」后，断言 `execCommand` 被调用、按钮文案变为「已复制」、
   Toast 出现「客户端配置已复制」。
2. 新增用例：**原生与回退都不可用** → 点击后断言出现错误 Toast、按钮文案**仍是**「复制当前配置」。
3. 新增断言：按钮的 `aria-label` 包含可见文案「复制当前配置」。
4. 现有用例里 `Object.defineProperty(navigator, "clipboard", ...)` 的写法保留，
   但新增用例必须在 `afterEach` 里恢复，避免污染既有用例。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/new-token.test.tsx
```

Expected: PASS。

### Phase 6: Browser Contract Regression (Playwright)

新建 `tests/e2e/specs/clipboard-fallback.spec.ts`：

1. `test.beforeAll` 调用 `assertFixtureOnly({ warnIfMissing: true })`（与 `agent-admin.spec.ts` 一致）。
2. 用 `page.addInitScript` 在页面加载前把 `navigator.clipboard` 置为 `undefined`，
   并 stub `document.execCommand` 记录被复制文本、返回 `true`。
3. 打开 `/admin/agents/<fixture-agent>/tokens/new`，填 Token 标签，点「生成 Token」。
4. 点「复制当前配置」，断言：
   - `execCommand` 以 `"copy"` 被调用；
   - 被记录的文本包含 `Bearer` 与 MCP endpoint；
   - 按钮文案变为「已复制」。
5. 标签打 `@pr-impacted`。

约束：

- 不新增 `data-testid`；使用现有 `data-testid="snippet-active"` 与既有按钮可访问名。
- 不做移动窄屏专项验证（沿用项目默认）。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx playwright test --grep @pr-impacted --project=chromium tests/e2e/specs/clipboard-fallback.spec.ts
```

Expected: PASS。若本地 fixture 不可用，记录为 `blocked` 并在交付说明里写明，不得记为 Pass。

### Phase 7: QA Playbook Update

修改 `../docs/qa/suite-user-journey.md`：

1. 在 ADM 旅程第 9 步（复制 Token / 复制当前配置）补充核查说明：
   - 该步的通过条件「按钮短暂变为『已复制』；Toast『客户端配置已复制』」**只有在非回环 HTTP 来源上才具备判定力**；
     回环来源（`127.0.0.1` / `localhost`）是安全上下文，Clipboard API 恒可用，
     在回环来源上通过**不能**证明复制功能在客户内网 HTTP 形态下可用。
2. 在 §2.1「环境（禁止混用）」补一条：涉及复制 / 剪贴板行为的用例，必须记录本次使用的
   `WEBUI_BASE` 是否为回环地址；若为回环地址，该结论不得用于判断内网 HTTP 形态。
3. 在 §9（排障速查）或相邻小节登记已知失败模式：
   `TypeError: Cannot read properties of undefined (reading 'writeText')`
   → 原因是非安全上下文下 `navigator.clipboard` 不存在；处理是改用受支持的
   `execCommand` 回退实现（Spec 192 / Plan M65），不要只在单一按钮上加保护。

### Phase 8: Bug Ledger Update

修改 `../docs/ui-ux-feedback/pages/admin-agents.md`，追加 `UX-ADMIN-AGENTS-042`：

- `Status: Fixed`
- `Route: /admin/agents/:userId/tokens/new`
- `Severity: P1`
- `Reported: 2026-10-26`
- Feedback：生产环境点击「复制当前配置」无任何反应
- Evidence：控制台 TypeError 原文；`navigator.clipboard` 为 `undefined`；
  同页「复制 Token」与详情页「复制 hash」同样失效
- Expected：任何来源下复制成功或明确失败提示；不谎报成功
- Browser Check：见 Spec 192 §12 的非回环 HTTP 来源复核要求
- Notes：Spec 192 / Plan M65 已落地；**本轮未重建 Docker、未在生产复核**，
  生产仍不可用直至下次出包

同时在 `docs/ui-ux-feedback/README.md` 若有页面清单需要补 `admin-agents.md`，按现有格式补齐。

### Phase 9: Doc Index Update

- `webui/docs/README.md`：追加一行索引，指向 `192-clipboard-non-secure-context-fallback-spec.md`。
- `webui/docs/plans/README.md`：追加一行索引，指向 `wo-M65-clipboard-non-secure-context-fallback.md`。
- 两处都放在既有同系列行附近，保持表格列格式一致（`| [文件](文件) | 一句话作用 | 读者 |`）。

### Phase 10: Verification

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm run lint:ia-boundary
npm test -- src/__tests__/clipboard.test.tsx src/__tests__/new-token.test.tsx src/__tests__/table-whitelist.test.tsx src/__tests__/version-info.test.tsx src/__tests__/audit.test.tsx src/__tests__/connection-test.test.tsx
npm run build
git diff --check
```

Expected：全部 PASS。`npm run build` 允许保留当前已知 Vite chunk size warning。

额外确认：

```bash
cd /Users/zhangxingchen/Projects/project-lucy
rg -n "navigator\.clipboard" webui/src/ | grep -v "src/lib/clipboard.ts"
```

Expected: 无输出。

### Phase 11: Commit

按仓库现行规范分两次提交：

```bash
git add webui/src webui/tests
git commit -m "fix(v0.25): make every WebUI copy entry point survive a non-secure context"

git add webui/docs docs/ui-ux-feedback docs/qa
git commit -m "docs(v0.25): land Spec 192 and Plan M65 for the clipboard fallback"
```

约束：

- 提交前确认 `git status --porcelain` 里没有 `config/` 等与本轮无关的未跟踪目录。
- 已有未提交的 `webui/docs/README.md` / `webui/docs/plans/README.md` 索引改动属于上一轮
  spec 69 / plan M62 的遗留，与本轮索引行合并进同一个 docs 提交，并在提交信息里说明。

## Acceptance Criteria

- `webui/src` 内不再有裸 `navigator.clipboard.writeText` 调用，全部经由 `webui/src/lib/clipboard.ts`。
- 非安全上下文（`navigator.clipboard` 不存在）下复制成功并进入成功态。
- 原生与回退都不可用时给出错误 Toast，且不进入成功态。
- 原生 API reject 时回退成功，不直接判失败。
- 失败提示不泄露被复制内容。
- `复制当前配置` 按钮的 `aria-label` 包含可见文案。
- 单测覆盖 AC-02/03/04/05；e2e 覆盖非安全上下文回退。
- QA 剧本新增非回环 HTTP 来源核查要求与已知失败模式登记。
- Bug 台账新增 `UX-ADMIN-AGENTS-042`，状态 `Fixed`，并注明未重建 Docker、未在生产复核。
- `lint:terminology`、`lint:ia-boundary`、相关单测、`npm run build`、`git diff --check` 通过。

## Code Review Checklist

- [ ] helper 的原生路径判定用 `typeof navigator.clipboard?.writeText === "function"`，不是真值判断。
- [ ] 原生 API reject 后确实继续走 `execCommand`，没有被误写成「catch 即失败」。
- [ ] `execCommand` 返回 `false` 时不置成功态。
- [ ] 所有调用点失败时都不调用成功态 setter（重点看 `ConnectionOverview` 与 `ConnectionTestResultPanel`）。
- [ ] 隐藏 textarea 已移除，原选区已恢复。
- [ ] 失败文案不含 Token 明文 / hash / 路径。
- [ ] `NewToken.tsx` 的 `aria-label` 包含可见文案「复制当前配置」，且未删除可见文案。
- [ ] 受保护术语的 `translate="no"` / `notranslate` 未回退。
- [ ] 新增测试用例在 `afterEach` 恢复了 `navigator.clipboard` 与 `document.execCommand`，不污染同文件其它用例。
- [ ] 现有测试的语义未被改动到降低断言强度。
- [ ] QA 剧本与 bug 台账如实标注「未重建 Docker、未在生产复核」。
- [ ] 没有新增后端 API、依赖、部署配置或 Docker 重建。

## Execution Notes（2026-10-26）

- 实现与验证全部完成，结果见 Spec 192 §13。要点：
  - 新增 `webui/src/lib/clipboard.ts`，迁移 `webui/src` 内全部 12 处复制调用点；
    `rg "navigator\.clipboard" webui/src/` 只剩 helper 自身命中。
  - 新增 `src/__tests__/clipboard.test.tsx`（11 条）、`new-token.test.tsx` 的
    「Spec 192 非安全上下文降级」describe（4 条）、`tests/e2e/specs/clipboard-fallback.spec.ts`（2 条）。
  - 受影响面回归 18 files / 295 tests passed；e2e 在真实 Chromium 中 2 passed。
  - **踩坑留档**：首版把 helper 返回值当布尔值用（`if (!copiedOk)`），
    而 `{ ok: false }` 是真值对象 → 失败分支被跳过，既不报错也谎报成功。
    由 Phase 5 的失败分支用例当场抓出，已改为判 `result.ok`。
- 环境问题（与本轮改动无关，已就地处理）：
  - 本地 `webui/node_modules` 落后于 `package.json`（缺 `jose` / `smtp-server`），
    dev server 无法启动；已 `npm install` 同步，`package.json` / `package-lock.json` 未改动。
  - 本地 Playwright 存在 dev server 冷启动竞态（Vite 先起、API 约 20s 后起），
    首轮因 `/api/auth/status` 代理失败而中断；预热两个端口后重跑通过。
- **未执行**：生产现场复核（Spec 192 §12 S5）。本轮不重建 Docker，
  `http://10.69.95.109:8276` 上的「复制当前配置」在下次出包部署前仍不可用。
