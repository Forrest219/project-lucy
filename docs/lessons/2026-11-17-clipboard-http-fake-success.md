# 错题：intranet-HTTP 复制 Toast「已复制」但剪贴板未写入（假成功）

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-17 |
| 标签 | `ux-regression` `gate-gap` `sev-low` |
| 环境 | 腾讯演示公网 `http://124.222.172.229:5174`（明文 HTTP，`isSecureContext=false`）；报障页 `/admin/version`；实例 `lucyVersion=0.30.0`，`gitSha=c84e6d7d1a5b…`。本机分支 `lucy-v0.30`（核对日 `HEAD=79db4352`）`webui/src/lib/clipboard.ts` 与该云端构建**同文未修** |
| 相关 | Spec 192／Plan M65（剪贴板非安全上下文降级，见 `docs/ui-ux-feedback/pages/admin-agents.md` 落地记、`docs/qa/suite-user-journey.md` §2.6）｜实现 `webui/src/lib/clipboard.ts`｜调用例 `webui/src/pages/admin/VersionInfo.tsx`｜单测 `webui/src/__tests__/clipboard.test.tsx`｜e2e `webui/tests/e2e/specs/clipboard-fallback.spec.ts`｜引入提交 `a45bfebc` |
| 状态 | `open`（根因已核实；委托人 2026-11-17 授权修复，**工作树已修并经真实浏览器读回验证**，待提交合入后关闭；见 §6） |

## 1. 症状与影响

- 用户在 **明文 HTTP** 的 `/admin/version` 点「复制」构建提交，多次粘贴失败。
- 共享 helper 在降级路径上可能弹出 **「已复制构建提交」**（`toast.success`），但系统剪贴板**没有**对应全文 → **对用户欺骗性强**。
- 功能严重度不高（可手选短 SHA／看 `title` 全量），但违反 Spec 192 自订规则「Never report success unless the text actually reached the clipboard」，属于**成功态误报**。
- 影响面（**2026-11-17 盘查已证实**：15 个调用点／13 个文件全部经同一 helper；真实浏览器点击 7 个可点入口＋helper 3 个载荷全部假成功，见测试台首跑）：所有走 `copyTextWithToast`／`copyTextToClipboard` 且落在 **非安全上下文**（intranet-HTTP／公网 HTTP demo）的复制入口；localhost／HTTPS 走 `navigator.clipboard.writeText` 时通常不触发本坑。

## 2. 复现要点

1. 打开非 loopback 的 `http://…` Lucy WebUI（确认 `window.isSecureContext === false`，`navigator.clipboard` 不可用）。
2. 进入有复制按钮的页面（例：`/admin/version`，需已登录且 `gitSha` 为 40 位 hex 才显示按钮）。
3. 点击「复制」→ 若见成功 Toast，再粘贴到别处。
4. **判定**：Toast 成功但粘贴为空／仍是旧内容 → 本错题类。

本机对同一公网 origin 用 Playwright Chromium 探针（不 stub `execCommand`）：

| 方法 | 选区 `toString()` | `document.execCommand('copy')` |
|---|---|---|
| **现行 helper**：`Range.selectNodeContents(textarea)`，不 `focus`／不 `.select()` | `""`（空） | `true` ← **假成功** |
| 对照：`textarea.focus()` + `.select()`／`setSelectionRange` | 完整待复制串 | `true` |

## 3. 根因

| 层 | 结论 |
|---|---|
| **环境** | Clipboard API 仅安全上下文；公网／intranet **HTTP** 无 `navigator.clipboard` → 必走 `execCommand` 降级。 |
| **实现** | `execCommandFallback` 为「不抢焦点」用 `selection.addRange(range.selectNodeContents(textarea))`。Chromium 对 `<textarea>`／`<input>` **不能**用 DOM Range 选中控件内文本；选区为空。 |
| **假成功机制** | 空选区时 `document.execCommand('copy')` 仍可返回 `true`；helper 把布尔返回值当成「已写入剪贴板」→ `toast.success`。 |
| **合同意图 vs 实现** | Spec 192／文件头注释要求「不得谎报成功」；实现用错了成功判据（API 返回值 ≠ 剪贴板内容）。 |
| **可排除** | 不是 VersionInfo 单独假按钮；不是「只复制了 12 位短 SHA」（设计就是展示短、复制全量 40 位）。云端与当前 `lucy-v0.30` 同源未修。 |

## 4. 为何漏检

1. **单测／e2e 把 `document.execCommand` stub 成固定布尔值**，并从 DOM 读 `textarea.value` 当「已复制」——**从未验证真实选区非空，也从未对非安全 HTTP origin 做真实剪贴板读写**。
2. e2e 注释写明：夹具跑在 loopback（本身是安全上下文），只靠删掉 `navigator.clipboard` 模拟降级 → **模拟的是 API 缺失，不是 Chromium 对 form control 的选区语义**。
3. Spec／旅程文档重点防「`clipboard` 为 `undefined` 时静默 TypeError」与「无条件置成功态」；**未单列「`execCommand===true` 但选区为空」** 这一假成功分支。
4. 验收多在本机 `127.0.0.1`／demo 映射端口（安全上下文）→ 主路径绿，**HTTP 客户／公网演示形态**才暴露。

## 5. 举一反三

1. **成功态只能由「剪贴板侧可核对的写入」驱动，不能只信 `execCommand` 的 boolean。** 降级路径至少保证选区／`setSelectionRange` 覆盖待复制全文；无法证明写入时必须 `toast.error`，禁止成功 Toast。
2. **`<textarea>`／`<input>` 复制必须用控件自己的 `select`／`setSelectionRange`（通常需短暂 focus），不要用 `Range.selectNodeContents` 代替。** 「不抢焦点」不能压过「复制真实发生」。
3. **Stub 了浏览器剪贴板／`execCommand` 的测试，不得单独充当 intranet-HTTP 验收。** 至少补一条：真实 Chromium + 非安全上下文（或删 Clipboard API 后**不** stub `execCommand`）断言选区非空，或在可写环境下读回剪贴板。
4. **凡注释写了「Never report success unless…」的共享 helper，门禁必须覆盖该句的反例。** 本例规则写在文件头，测试却允许假 `true`。
5. **公网 HTTP／`security.access=http` 是受支持形态，复制类改动的冒烟不得只在 localhost 做。** Version／Token／Audit 等任一入口即可作探针。
6. **登记本错题 ≠ 授权改 `clipboard.ts`。** 修复须另开授权；改 helper 会影响全部复制入口，需连带收紧测试合同。

## 6. 后续动作

> 登记 ≠ 开发授权。

| 动作 | 状态 | 说明 |
|---|---|---|
| 错题本登记（本文件）＋索引 | 完成 | 委托人 2026-11-17 要求复盘入错题本 |
| 修复 `execCommandFallback`（focus + select／setSelectionRange；避免空选区仍报成功） | **完成（工作树，2026-11-17）** | 委托人「授权修复」；改共享 helper；对话框内挂载、焦点与选区还原；确认选区＝全文才调用 `execCommand`。未提交 |
| 单测／e2e：去掉「假 `execCommand` 当真写入」的验收空洞 | **单测完成；e2e 待办** | `clipboard.test.tsx` 改为在 `execCommand` 调用瞬间读取焦点与选区（先红后绿）。`clipboard-fallback.spec.ts` 仍打桩且跑回环，**判定力由测试台探针承担**，不再依赖它 |
| 非安全上下文冒烟 | **完成（2026-11-17）** | 测试台 [`UAT-SUITE-COPY-FAKE-SUCCESS`](../qa/uat/suites/copy-fake-success/suite.md)：真实 Chromium＋局域网明文 HTTP＋真实粘贴读回；首跑 FAIL |
| 机制：新增复制入口必须登记并被点击探针覆盖 | **完成（2026-11-17）** | `npm --prefix webui run lint:copy-surfaces`（接入 `pretest`）＋登记表 `webui/scripts/copy-surfaces.manifest.json`；清单 P1-40／REQ-030-061 |
| 关闭本错题（`closed`） | 未开 | 套件 01／02 已在非安全上下文全 `REAL`（[修复后跑次](../qa/uat/suites/copy-fake-success/runs/2026-11-17-cursor-copy-probe-after-fix.md)，PASS WITH GAP）；**待修复提交合入主线**，且公网演示实例升级后复核（可选 UAT-COPY-04）|

## 7. 证据指针

- Helper：`webui/src/lib/clipboard.ts`（`execCommandFallback` 中 `selectNodeContents` 分支）。
- 页面调用：`webui/src/pages/admin/VersionInfo.tsx`（`copyTextWithToast(gitSha, { successMessage: "已复制构建提交" })`）。
- Stub 验收：`webui/src/__tests__/clipboard.test.tsx`；`webui/tests/e2e/specs/clipboard-fallback.spec.ts`（`installClipboardStub`）。
- 旅程判定表：`docs/qa/suite-user-journey.md` §2.6（已写「显示已复制但剪贴板没变」类症状，但当时归因偏「无条件成功态」，未钉死 Range 空选区）。
- 分支核对：`lucy-v0.30` 相对云端 `c84e6d7d` 的 `clipboard.ts` **无 diff**；引入降级的提交仍为 `a45bfebc`。
