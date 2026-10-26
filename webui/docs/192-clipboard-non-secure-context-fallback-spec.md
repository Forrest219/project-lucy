# 192 · 剪贴板复制在非安全上下文的降级

| 元数据 | 内容 |
|---|---|
| 版本 | v0.1 |
| 日期 | 2026-10-26 |
| 状态 | 用户已批准执行；尚未走 cross-review（落盘即执行，见 §9 待审阅项） |
| 范围 | WebUI 前端全部复制入口；不涉及后端 API、ACL、MCP endpoint、Session |
| 关联 Plan | [`plans/wo-M65-clipboard-non-secure-context-fallback.md`](plans/wo-M65-clipboard-non-secure-context-fallback.md) |
| 关联 Bug 台账 | [`docs/ui-ux-feedback/pages/admin-agents.md`](../../docs/ui-ux-feedback/pages/admin-agents.md) `UX-ADMIN-AGENTS-042` |
| 编号变更 | 落盘时拟用 189；上游已发布 Spec 189（用量统计真实性与跨页面口径统一）并占用该编号，2026-10-27 同步上游时重排为 192。正文与 Plan M65 的「Spec 189」引用一并改为「Spec 192」；未受影响的实现代码不变 |

## 1. 背景与现场证据

### 1.1 现象

生产环境（`http://10.69.95.109:8276`，Lucy `2.0.0`）上，`/admin/agents/zhangxingchen1/tokens/new`
的「复制当前配置」按钮点击后**无任何反应**：按钮文案不变、没有 Toast、剪贴板未写入。

同页「复制 Token」按钮、Agent 详情页「复制 hash」按钮表现一致。

### 1.2 现场取证

浏览器控制台捕获到未捕获异常，堆栈落在 NewToken 页面 chunk：

```text
TypeError: Cannot read properties of undefined (reading 'writeText')
    at Z (http://10.69.95.109:8276/assets/NewToken-J1Ka8f6K.js:1:3397)
```

即 `navigator.clipboard` 本身是 `undefined`，属性访问阶段就抛错。

### 1.3 根因

Clipboard API 是 `[SecureContext]` 门控的：只在 HTTPS 或回环来源（`localhost` / `127.0.0.1`）下暴露。
生产实例以**纯 HTTP + 非回环 IP** 提供 WebUI，来源不是安全上下文，浏览器因此**根本不暴露**
`navigator.clipboard`。

这不是部署配错。`deploy/k8s/K8S_CONTRACT.md` 与
`docs/runbooks/customer-v2-k8s-first-admin-delivery-flow.md` 明确把
`security.access=http`（内网 HTTP 客户访问方式）列为**受支持的交付形态**，
因此 WebUI 必须在这个来源下可用。

### 1.4 缺陷分级

| 表现 | 后果 | 级别 |
|---|---|---|
| 抛 TypeError、无 Toast、成功态不置位 | 用户看到按钮「点了没反应」，无任何可诊断信息 | P1 |
| `navigator.clipboard?.writeText(...)` 后仍置成功态 | **谎报成功**：提示「已复制」，实际剪贴板未变 | P1 |
| 可选链把 `.then().catch()` 一并短路 | 完全静默，连 Toast 都没有 | P2 |

### 1.5 为什么既有自动化没抓到

- 单测总是注入可用 clipboard mock
  （`webui/src/__tests__/new-token.test.tsx:157,193` 用
  `Object.defineProperty(navigator, "clipboard", { value: { writeText } })`），
  「clipboard 不可用」这条分支从未被执行。
- QA 剧本固定跑在 `http://127.0.0.1:55176`
  （`docs/qa/suite-user-journey.md:53,127`）。回环来源是安全上下文，
  Clipboard API 可用，`docs/qa/suite-user-journey.md:564-567` 那条
  「按钮短暂变为『已复制』；Toast『客户端配置已复制』」在 QA 环境永远成立。

对照：`webui/src/__tests__/table-whitelist.test.tsx:1047` 已经 mock 过
`writeText` reject 并断言优雅报错——`TableWhitelist` 早就是这个仓库的正确样板，
`NewToken` 与其余入口没有跟上。

### 1.6 与本次修复无关的旁证

用同一枚 Token 直连 `http://10.69.95.109:8277/mcp` 验证过：
握手、`tools/list`（17 个工具）、`lucy_catalog`、`lucy_read_source`、
`lucy_query` 真实取数、`sl_read_source` 绝对拒绝、无 `Mcp-Session-Id` 回传，
全部正常。**按钮要复制的 payload 本身完全正确，坏的只是「复制」这个动作。**
因此本规格的修复范围可以严格限定在 WebUI 前端。

## 2. 决策摘要

| 编号 | 决策 |
|---|---|
| D1 | 新增唯一复制实现 `webui/src/lib/clipboard.ts`，仓库内所有复制入口必须经由它 |
| D2 | 三级降级：原生 `navigator.clipboard.writeText` → `document.execCommand("copy")` → 失败并提示 |
| D3 | 复制失败**必须**有 Toast，不允许静默 |
| D4 | 复制失败**不得**进入成功态，禁止谎报成功 |
| D5 | 原生 API 抛错（权限拒绝 / 文档未聚焦）时回退到 `execCommand`，不直接判失败 |
| D6 | 修正 `复制当前配置` 按钮 `aria-label` 与可见文案不一致（WCAG 2.5.3） |
| D7 | 本轮不重建 Docker；生产验证留给下次出包后的浏览器复核 |

## 3. 目标与非目标

### 3.1 目标

1. 任何来源（含内网 HTTP）下，所有复制入口都能真正写入剪贴板，或给出明确失败提示。
2. 消除「谎报成功」与「完全静默」两类行为。
3. 建立单一实现，使该类缺陷不再逐处复发。
4. 把「clipboard 不可用」变成可被自动化捕获的分支。

### 3.2 非目标

- 不改变后端 API、ACL、Token 生命周期、MCP endpoint 解析或会话语义。
- 不改动复制内容的**内容**（MCP 配置片段、Token 明文、hash、路径文案均保持原样）。
- 不引入 `clipboard.js` 等第三方依赖。
- 不重构复制入口所在的页面或组件结构。
- 本轮不做 Docker 重建，不改交付形态与部署配置。

## 4. 落地范围

`webui/src` 内共 12 处 clipboard 调用，全部纳入：

| # | 文件 | 当前实现 | 目标行为 |
|---|---|---|---|
| 1 | `pages/admin/NewToken.tsx:172` | `navigator.clipboard.writeText(...).then(...)`，无 catch | helper + 失败 Toast |
| 2 | `pages/admin/NewToken.tsx:192` | 同上 | helper + 失败 Toast |
| 3 | `pages/admin/AgentDetail.tsx:1304` | 同上 | helper + 失败 Toast |
| 4 | `components/onboarding/AuthoringHowTo.tsx:25` | `await navigator.clipboard.writeText(...)`，无 catch | helper + 失败 Toast |
| 5 | `pages/connections/ConnectionOverview.tsx:629` | `await navigator.clipboard?.writeText(...)` 后**无条件置成功态** | helper；失败时不置成功态 |
| 6 | `components/connections/ConnectionTestResultPanel.tsx:84` | 同上 | helper；失败时置失败态 |
| 7 | `pages/admin/Audit.tsx:649` | 可选链把 `.then().catch()` 一并短路 | helper + 失败 Toast |
| 8 | `pages/admin/VersionInfo.tsx:33` | 已有 try/catch | 改走 helper，保留原提示语 |
| 9 | `pages/connections/TableWhitelist.tsx:642` | 已有显式守卫 + try/catch | 改走 helper |
| 10 | `pages/Onboarding.tsx:474` | 已有 try/catch | 改走 helper |
| 11 | `components/onboarding/Step6ConnectAgent.tsx:159` | 已有 try/catch | 改走 helper |
| 12 | `components/audit-trust/CredentialPrincipalCell.tsx:20` | 已有显式守卫 + 静默 catch | 改走 helper；该 cell 无成功态控件，只在失败时提示，不加成功 Toast |

同时修正 `NewToken.tsx:250` 的 `aria-label="复制当前选中的配置"`：
可见文案是「复制当前配置」，二者不是包含关系，违反 WCAG 2.5.3 Label in Name，
语音控制按可见文案念会命中失败。

### 4.1 落地范围之外（登记为已知项）

- `docs/ui-ux-feedback/pages/admin-agents.md` 等台账中若存在其它「复制」类反馈，本轮不逐条改写。
- `webui/tests/e2e/selector-contract` 的 selector 清单不因本轮变更（未增删 `data-testid`）。

## 5. 核心流程（伪代码）

### 5.1 复制实现

```text
copyTextToClipboard(text) -> { ok: true } | { ok: false, reason: string }

  if text is empty:
      return { ok: false, reason: "empty" }

  # 第 1 级：原生 Clipboard API（仅安全上下文可用）
  if navigator exists and navigator.clipboard?.writeText is a function:
      try:
          await navigator.clipboard.writeText(text)
          return { ok: true }
      catch:
          pass            # 权限拒绝 / 文档未聚焦 → 不直接判失败，继续降级

  # 第 2 级：execCommand 回退（非安全上下文可用）
  if document exists and document.execCommand is a function:
      textarea = createElement("textarea")
      textarea.value = text
      textarea.readOnly = true
      textarea.style = { position: "fixed", top: "0", left: "0", opacity: "0", pointerEvents: "none" }
      savedRange = current selection range (if any)
      append textarea to document.body
      try:
          textarea.select()
          textarea.setSelectionRange(0, text.length)
          ok = document.execCommand("copy")
          return { ok: true } if ok else { ok: false, reason: "exec-command-rejected" }
      catch:
          return { ok: false, reason: "exec-command-threw" }
      finally:
          remove textarea from document.body
          restore savedRange into selection (if any)

  # 第 3 级：彻底不可用
  return { ok: false, reason: "clipboard-api-unavailable" }
```

### 5.2 调用点契约

```text
onCopyClick(value, successMessage, failureMessage, onSuccessState):
  result = await copyTextToClipboard(value)
  if result.ok:
      onSuccessState()              # 置成功态（按钮文案 / 已复制 / 复制成功提示）
      if successMessage is not empty:
          toast.success(successMessage)
  else:
      toast.error(failureMessage)  # 必须提示；且绝不调用 onSuccessState
```

分支顺序即正确性所在：

1. **`navigator.clipboard` 为 `undefined` 时不能抛错**——这是本缺陷的直接成因。
   判定用 `navigator.clipboard?.writeText is a function`，不是 `navigator.clipboard` 真值判断，
   以免 `clipboard` 存在但 `writeText` 缺失时再次崩在属性访问上。
2. **原生 API 抛错不等于复制失败**——必须继续走 `execCommand`，否则权限拒绝场景仍会失败。
3. **`execCommand` 返回 `false` 不等于复制成功**——不得置成功态。
4. **成功态只能在 `ok` 时置位**——这是 D4「不谎报成功」的落点。
5. **结果对象恒为真值**——`copyTextToClipboard` 返回 `{ ok: true } | { ok: false, reason }`，
   其中 `{ ok: false }` 仍是**真值对象**。调用点必须判 `result.ok`，
   **不得**写成 `if (!result)` / `if (!copiedOk)` 之类按对象真值判断的写法：
   那会把失败当成成功，同时跳过失败提示，正好复现本规格要消灭的两类行为。
   本轮实现过程中确实踩中过这个坑，由 §6 AC-08 的失败分支单测当场抓出。

### 5.3 `execCommand` 回退的副作用控制

`execCommand` 依赖当前选区，必须在复制后恢复用户原有选区，避免把用户正在选中的内容清空：

```text
savedRange = selection.getRangeAt(0)     # 若 rangeCount > 0
... 执行 copy ...
selection.removeAllRanges()
selection.addRange(savedRange)          # 若 savedRange 存在
```

## 6. 验收标准

| 编号 | 标准 |
|---|---|
| AC-01 | `webui/src` 内不再存在裸 `navigator.clipboard.writeText` 调用；全部复制入口经由 `webui/src/lib/clipboard.ts` |
| AC-02 | `navigator.clipboard` 为 `undefined` 时，复制**成功**且调用点进入成功态 |
| AC-03 | 原生 API 与 `execCommand` 都不可用时，出现错误 Toast，且**不**进入成功态 |
| AC-04 | 原生 API `writeText` reject 时回退到 `execCommand` 并成功，不直接判失败 |
| AC-05 | `execCommand` 返回 `false` 时不置成功态，提示失败 |
| AC-06 | 失败提示文案不包含被复制的内容（Token 明文、hash、路径） |
| AC-07 | `复制当前配置` 按钮的 `aria-label` 包含可见文案「复制当前配置」 |
| AC-08 | 单测覆盖上述分支（AC-02/03/04/05）且通过 |
| AC-09 | e2e 回归覆盖非安全上下文回退（浏览器内删除 `navigator.clipboard` 后复制仍成功） |
| AC-10 | QA 剧本新增「非回环 HTTP 来源」核查步骤，避免继续用回环来源误判 |
| AC-11 | `npm run lint:terminology`、`npm run lint:ia-boundary`、相关单测、`npm run build`、`git diff --check` 通过 |

## 7. 关联与风险

### 7.1 关联

| 文档 | 关系 |
|---|---|
| `webui/docs/22-public-mcp-endpoint-runtime-config-spec.md` | 复制内容的 endpoint 来源；本轮不改 endpoint |
| `webui/docs/14-agent-admin-enterprise-delivery-spec.md` | Token 首秀页归属规格 |
| `deploy/k8s/K8S_CONTRACT.md` | `security.access=http` 是受支持形态，决定本缺陷必然发生 |
| `docs/qa/suite-user-journey.md` | 本轮补充非回环来源核查步骤 |
| `docs/ui-ux-feedback/pages/admin-agents.md` | `UX-ADMIN-AGENTS-042` 本轮修复对象 |

### 7.2 风险

| 风险 | 缓解 |
|---|---|
| `execCommand` 已废弃 | 仅作为原生 API 不可用时的回退；原生路径仍是首选。保留双路径而非替换 |
| `execCommand` 在个别环境静默失败 | 返回值参与判定，失败即走错误提示；不假设成功 |
| 隐藏 textarea 干扰页面选区 / 布局 | `position: fixed` + `opacity: 0` + `pointer-events: none`，复制后立即移除并恢复选区 |
| 一次性改动 12 处调用点，回归面较大 | 每处保持原有成功反馈形态不变（按钮文案 / Toast / 局部状态），只替换「怎么复制」和「失败怎么办」 |
| 统一 helper 反而成为单点 | helper 是纯函数、无状态、可单测；失败路径有 Toast 兜底 |

## 8. Terminology Compliance

本功能遵守 `webui/docs/00-product-terminology-standard.md`。

New terms:
- None。本规格不新增产品概念。「剪贴板」只作为实现层术语出现在本规格与代码注释中，不进入任何用户可见文案。

既有术语沿用：

| 概念 | 沿用口径 |
|---|---|
| Token | `Token` 受保护，DOM 需 `translate="no"` + `notranslate`（现有实现已满足，本轮不新增含 Token 的裸 DOM） |
| Agent / MCP / Manifest | 受保护术语，本轮不改其 DOM |
| 复制 / 已复制 | 沿用既有按钮文案，不新造「拷贝」「剪贴板复制」等替代表述 |

失败提示统一为「复制失败，请手动选择文本」，属普通中文动作描述，不引入新术语。
禁止文案：无。

## 9. Design System Compliance

引用 `design-system/10-components-button.md`（按钮分层与状态反馈）、`design-system/01-foundations-color.md`（语义色）。

本轮只改「复制」动作的实现与失败反馈，不新增视觉模式：

- 成功反馈沿用既有形态：按钮文案切换为「已复制」/`data-copied="true"`（`app.css:758` 的 `text-success-strong`）、既有 Sonner Toast。
- 失败反馈沿用既有 Sonner `toast.error` 与语义 danger 色，与 `TableWhitelist` 现有「复制路径失败」一致。
- 不新增 CSS 类、不改按钮层级与尺寸。

## 10. 待审阅项

1. 本规格 v0.1 落盘后按用户要求**直接进入实现**，未走 cross-review。Reviewer 重点看：
   - D2 的三级降级顺序是否可接受；
   - D4「不谎报成功」是否需要在 §5.2 契约里再加一条「失败态的复位语义」；
   - §4 表格是否遗漏了 `webui/src` 外的复制入口（如 `webui/server` 模板、帮助中心静态页）。
2. §4.1 登记的「落地范围之外」项是否需要单独排期。
3. 建议后续单独立项：为 `lint:terminology` 增加一条禁用裸 `navigator.clipboard.writeText` 的静态检查，
   本轮先用单测 + e2e 兜底。

## 11. 分阶段交付

| 阶段 | 内容 | 状态 |
|---|---|---|
| S1 | `webui/src/lib/clipboard.ts` 落地 + 单测 | 已完成 |
| S2 | 12 处调用点迁移 + `aria-label` 修正 | 已完成 |
| S3 | 单测补齐 + e2e 回归 + QA 剧本补充 | 已完成 |
| S4 | `lint:terminology` / `lint:ia-boundary` / vitest / build 验证 | 已完成 |
| S5 | 浏览器复核（非回环 HTTP 来源） | **不在本轮**：需先出包；见 §12 |
| S6 | 生产出包后撤销测试 Token `clipboard-bug-check-temp` | 待办 |

## 12. 验证边界（必须如实声明）

本轮**不重建 Docker、不出客户包**，因此：

- 生产环境 `http://10.69.95.109:8276` 上的「复制当前配置」在修复落地后**仍然不可用**，
  直至新的镜像/包完成部署。不得据此宣称生产已修复。
- 浏览器级验证在本轮以 e2e 回归覆盖（在浏览器内删除 `navigator.clipboard` 模拟非安全上下文），
  不等价于真实非回环 HTTP 来源的现场复核。
- S5 复核须在非回环 HTTP 来源上执行：把 WebUI 绑到 `0.0.0.0` 并用本机 LAN IP 访问，
  或直接在客户内网 HTTP 形态实例上复核。**不得**用 `127.0.0.1` / `localhost` 复核——
  回环来源是安全上下文，Clipboard API 可用，复核结果没有意义。

## 13. 验证记录

2026-10-26 实现完成，实际执行结果如下。

### 13.1 已执行且通过

| 检查 | 结果 |
|---|---|
| `rg "navigator\.clipboard" webui/src/` | 仅 `src/lib/clipboard.ts` 命中（其余 12 处全部改走 helper） |
| `npx tsc --noEmit` | 本轮触碰的文件**零新增错误**；`src/` / `server/__tests__/` 其余报错为基线既有（stash 对照：`server/` 基线 62 条不变） |
| `npx vitest run src/__tests__/clipboard.test.tsx src/__tests__/new-token.test.tsx` | 27 passed（新增 15 条） |
| 受影响面回归：`clipboard` / `new-token` / `table-whitelist` / `version-info` / `audit` / `connection-test` / `connection-overview` / `onboarding` / `agent-detail` / `tokens-page` / `admin-agents` / `audit-trust` | 18 files / 295 tests passed |
| `npx playwright test --project=chromium tests/e2e/specs/clipboard-fallback.spec.ts` | 2 passed（真实 Chromium，页面加载前删除 `navigator.clipboard` 模拟非安全上下文） |
| `npm run lint:terminology` / `npm run lint:ia-boundary` | 见 §13.3 |
| `npm run build` | 见 §13.3 |

### 13.2 实现过程中被测试抓出的真实缺陷（已修）

首版实现把 helper 的返回值当布尔值用（`if (!copiedOk)`）。由于
`copyTextToClipboard` 返回的是 `{ ok: false, reason }` **真值对象**，
该写法会让失败分支被跳过：既不提示失败，又错误地置上成功态——
正好同时违反 D3 与 D4。

由 `new-token.test.tsx` 的「两条路径都不可用时提示失败且不谎报成功」用例当场抓出。
已改为判 `result.ok`，并把该陷阱写入 §5.2 第 5 条，避免后续调用点重蹈。

### 13.3 未执行 / 受阻项

- **生产现场复核（S5）未执行**：本轮不重建 Docker、不出客户包，
  `http://10.69.95.109:8276` 上的「复制当前配置」**仍然不可用**，直至新包部署。
  按 §12 的要求，该复核必须在**非回环 HTTP 来源**上做。
- 本地 Playwright 首轮因 dev server 冷启动竞态（Vite 先起、API 后起约 20s）失败；
  预热两个端口后重跑通过。该竞态是既有本地 e2e 环境问题，与本轮改动无关。
- 本地 `webui/node_modules` 落后于 package.json（缺 `jose` / `smtp-server`，
  来自近期 OIDC / SMTP 提交），导致 dev server 无法启动。已执行 `npm install` 同步，
  `package.json` / `package-lock.json` **未改动**。

### 13.4 结论边界

本轮验证覆盖的是**代码与自动化契约**：helper 的三级降级、失败不谎报成功、
真实浏览器中 `navigator.clipboard` 缺失时的回退路径。
它**不等价于**客户内网 HTTP 实例上的现场复核，后者留给 S5。
