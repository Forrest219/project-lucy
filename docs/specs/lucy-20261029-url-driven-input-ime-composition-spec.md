# URL 驱动受控输入框的输入法组合中断优化 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v0.1-draft** |
| 日期 / 目标版本 | 2026-10-29 首版 / 目标 v0.25（修订线） |
| 功能编号 / 优先级 | **待 PM 指派**（建议 L25-18——L25-17 已被同日《问询预算窗口》Spec 建议占用，最终编号由 PM 分配；**权威登记册**为 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md)，新条目须由登记册维护会话登记）/ **P0**（13 处 URL 驱动输入框）、**P1**（2 处变换写回）、**P2**（静态门禁与规范补齐） |
| 状态 | **待审阅，未批准**。本文件是设计基线，不授权开发、浏览器验证或客户交付。 |
| 评审状态 | **第 1 轮审阅未进行**（2026-10-29 PM 指示「准备进入审阅」） |
| 决策来源 | 2026-10-29 PM 指示：针对 Audit 页「Agent 名称或 ID」搜索框的输入法无法切换反馈，落盘优化 Spec 与 Plan，**并要求排查全量存在此类型 bug 的筛选器** |
| 需求来源 | 用户反馈：Audit 页 agent 名称或 ID 搜索框「输入法无法切换」 |
| 实施主体 | Lucy WebUI（`webui/src`）；不修改 KTX 源码、不改后端 API |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」：仓库级跨模块设计落 `docs/`；本文是 WebUI 前端交互层的实现约束，不修订任何既有 Spec 的业务语义 |
| 与既有 Spec 的关系 | **不修订**既有 Spec。仅新增一条 WebUI 实现约束（§5.1–§5.5）与一条防回归门禁。既有页面行为语义（URL 即筛选事实源、分享链接可用、深链可复现）**保持不变** |

> 本文件是**设计基线**。审阅未闭环、决策未拍板之前，不授权实现。

---

## 1. 现象与取证

### 1.1 用户可见现象

在 Audit 页（`/admin/audit`）的「Agent 名称或 ID」搜索框内使用中文输入法时：

- 候选窗在每次按键后消失，组合被打断；
- 拼音缓冲被**追加**而非替换（键入 `zhong` 后输入框内出现 `zhongzhongwen` 而非 `zhongwen`）；
- 最终上屏为 `zhongzhongwen中文` 一类的拼接乱码，而非预期的 `中文`；
- 用户侧描述为「输入法无法切换」。

### 1.2 取证口径与证据等级

| 等级 | 事实 | 出处 |
|---|---|---|
| **A（真实浏览器复现）** | 2026-10-29 用系统 Chrome（`--headless=new`）+ CDP `Input.imeSetComposition` 驱动真实 IME 组合序列，挂载**真实 `Audit` 组件**（React 19.2.7 + React Router 7.18.4）复现成功：最终 DOM 值 `zhongzhongwen中文`；`compositionstart` 被重启 **3 次**（正常输入框为 1 次）；`HTMLInputElement.prototype.value` setter 在组合期间被调用 **6 次**，其中首两次为 `"zhong"→""` 与 `""→"zhong"` | 一次性探针（已删除，不入仓）；复现台为临时 vite 入口 + 5 个对照件 |
| **A'（对照实验，同页同库）** | 同页对照件结果：本地 state 驱动 → `中文`／`compositionstart`=1／DOM 写回 **0** 次；URL 驱动（与 Audit 同款写法）→ `zhongzhongwen中文`／3／6 次；URL 驱动 + `replace:true` → 同上（**无效**）；URL 驱动 + `translate="no"` → 同上（**无效**）；本地 state + 防抖写 URL → `中文`／1／0 次 | 同上 |
| **B（代码静态分析）** | 2026-10-29 以「URL 派生变量传递闭包」扫描 `webui/src` 全部 **186** 个文本输入框／文本域，命中 **13** 处 value 源自 URL 派生变量 | 见 §2.1 |
| **C（未验证）** | Safari / WebKit 与真实 OS 级输入法（macOS 拼音、Windows 微软拼音）**未实测**；Firefox **未实测**。A 级证据是 Chrome 的 IME 组合 API 忠实模拟，**不等价于**系统级 IME 实机验证 | — |

**jsdom 不可复现（已实测）**：jsdom 无真实 IME，且 `MemoryRouter` 导航同步、无「旧 URL 值渲染一帧」的中间态，因此受控值不会被打断。**任何以 jsdom 为唯一手段的验收都不能证明本缺陷已修复**（详见 §6.2 的门禁设计）。

### 1.3 根因

三步链条：

1. `onChange` → `setSearchParams(next)`（`webui/src/pages/admin/Audit.tsx:1546`）。React Router 的路由导航是**异步**的，React 会**先用旧 URL 值渲染一帧**。
2. 该帧里 `value` prop（来自 `searchParams.get("user")`，`Audit.tsx:1478`）与 DOM 当前值不等，React 于是直接写 `node.value`。**Chrome 在 IME 组合进行中收到 `node.value` 写入即取消当前组合**。
3. 组合被取消后，浏览器从已被污染的 DOM 值起算下一次组合，拼音缓冲由「替换」退化为「追加」。

**病根是「受控输入框的 `value` 源取自路由状态」这一写法本身**，与 `replace:true`、`translate="no"`、是否防抖均无关。防抖只推迟了 URL 落后，**不消除**旧值渲染帧——已实测「只防抖、value 仍取自 URL」仍然 3 次重启组合、每次按键把 DOM 抹成空。

### 1.4 同一次排查暴露的伴生缺陷

| 编号 | 缺陷 | 位置 | 与主缺陷的关系 |
|---|---|---|---|
| **C-1** | **变换写回**：`onChange` 对 `e.target.value` 做 `.trim()` 后写入受控 state | `webui/src/pages/admin/AuditReconciliation.tsx:313` | 同族。state ≠ DOM 值 ⇒ React 写回 ⇒ 组合可被打断；且用户输入的首尾空格被静默抹除 |
| **C-2** | **变换写回**：`value={arr.join(", ")}` 配 `onChange` 内 `split(",").map(trim).filter(Boolean)` | `webui/src/pages/eval/CaseEditor.tsx:291` | 同族，且**与 IME 无关也独立成 bug**——用户输入的 `", "` 会被立即抹掉，无法键入分隔符后空格 |
| **C-3** | 非受控输入框配 `trim()` 写入筛选状态 | `webui/src/pages/admin/RowPolicyView.tsx:224/232/240/248/256` | **不受影响**（React 不回写非受控 input 的 value）。列此仅为口径统一，避免被误判为同类 |
| **C-4** | Audit 页每次按键触发 2 次查询请求 + 1 次 localStorage 写 + 结果表整体重挂载 | `Audit.tsx:1534`（每秒 ticker）、`updateParam` | 非本缺陷，但**放大**症状：重渲染更频繁 ⇒ 撞上「value prop ≠ DOM 值」瞬间的概率更高 |

---

## 2. 范围

### 2.1 本期包括

**全量排查结论：13 处 URL 驱动受控文本输入框 / 5 个页面**（`webui/src` 共 186 个文本输入框与文本域；其中 68 个位于含路由状态的组件内；其余 55 个为本地 state 或非受控，不受影响）。

| # | 文件:行 | 输入框 | URL 参数 | 页面 |
|---|---|---|---|---|
| 1 | `webui/src/pages/admin/Audit.tsx:2061` | Agent 名称或 ID | `user` | Audit |
| 2 | `webui/src/pages/admin/Audit.tsx:2081` | 统一搜索 | `key` / `turnSearch` / `tableSearch` | Audit |
| 3 | `webui/src/pages/admin/Audit.tsx:2178` | 工具名 | `tool` | Audit |
| 4 | `webui/src/pages/admin/Audit.tsx:2186` | Session ID | `sessionId` | Audit |
| 5 | `webui/src/pages/admin/Audit.tsx:2193` | 访问 IP | `clientIp` | Audit |
| 6 | `webui/src/pages/admin/Audit.tsx:2201` | 最近设备名 | `deviceName` | Audit |
| 7 | `webui/src/pages/admin/Audit.tsx:2217` | 表名 | `tableSearch` | Audit |
| 8 | `webui/src/pages/admin/ConfigAudit.tsx:320` | 目标 ID | `targetId` | 配置审计 |
| 9 | `webui/src/pages/admin/ConfigAudit.tsx:327` | 文件路径 | `filePath` | 配置审计 |
| 10 | `webui/src/pages/admin/ConfigAudit.tsx:334` | 来源 | `source` | 配置审计 |
| 11 | `webui/src/pages/admin/Tokens.tsx:214` | 搜索 Token | `search` | Token |
| 12 | `webui/src/pages/Catalog.tsx:493` | 搜索表名或字段名 | `q` | 目录 |
| 13 | `webui/src/pages/publish/PublishHistory.tsx:508` | 操作人 | `actor` | 发布历史 |

外加：伴生缺陷 C-1、C-2（§1.4）；静态防回归门禁（§5.5）；设计规范补齐（§10）。

> ⚠️ **范围与上轮 PM 口径的差异**：2026-10-29 PM 在修复范围问卷中批的是「Audit + Catalog + Tokens 全量（9 处）」，该数字来自首轮按变量名匹配的启发式排查。**本轮传递闭包全量排查新增 4 处**——配置审计 3 处（#8–#10）与发布历史 1 处（#13）。四者与已批范围**同根因、同修法**，建议一并纳入（决策点 **D2**）。

### 2.2 本期不包括

- `<select>` / `<input type="checkbox">` / `<input type="date">` 等非文本输入——**不存在 IME 组合**，不在本缺陷范围（Audit 的 `outcome`、`turnSource`、`callSource` 等属此类）。
- 非受控输入框（`defaultValue`）——React 不回写其 value，不受本缺陷影响。
- 已采用正确范式的搜索框：`HelpCenter.tsx:364`（`draftQuery`）、`AgentList.tsx:633`、`RoleList.tsx:302`、`SkillList.tsx:221`、`CaseList.tsx:440`、`TableWhitelist.tsx:783`、`AccessMap.tsx:246`、`CommandPalette.tsx:398` 等。
- 移动窄屏与响应式验证（[`DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「验证策略」默认不做）。
- 后端 API、审计语义、URL 参数的**命名与含义**——全部保持不变，无迁移。
- `Eval` 用例编辑器的整体可用性改造（C-2 仅按 §5.4 修「变换写回」，不做编辑器重构）。

---

## 3. 术语与用户可见口径

| 术语 | 口径 |
|---|---|
| URL 驱动受控输入框 | 受控文本输入框的 `value` 属性取值自**路由状态**（`useSearchParams` / `useParams` / 自定义 `get()` 封装派生的局部变量，或引用这些变量的局部常量） |
| 局部状态镜像 | 受控文本输入框的 `value` 取自**组件本地 state**，URL 作为**下游事实源**跟随；本地 state 由用户输入同步更新，由 URL 外部变更反向同步 |
| 组合写回 | React（或任何 JS）在 IME 组合进行中写入 `input.value`，导致浏览器取消当前组合 |
| 变换写回 | `onChange` 中对 `e.target.value` 做 `trim` / 大小写 / 拆分 / 过滤等规范化后再写入受控 state，使 state 值 ≠ DOM 值 |

**用户可见口径**：本缺陷**不产生任何新增用户可见文案**。修复后用户侧只观察到「输入法可以正常使用了」。**不得**在界面上新增「输入法」「组合」等提示文案。

---

## 4. 决策表（待 PM 拍板）

| 编号 | 决策 | 选项 | 推荐 | 影响面 |
|---|---|---|---|---|
| **D1** | 修法形态 | (a) 局部状态镜像（value 取本地 state，URL 跟随）｜(b) (a) + URL 写入防抖｜(c) 仅加 `isComposing` 守卫 | **(a)** | **开工阻塞**。决定全部 13 处的改法。已实测：(c) 无效——守卫只拦 Enter 键，拦不住 `node.value` 写回；(b) 可选叠加项，见 D4 |
| **D2** | 修复范围 | (a) 13 处全量（含新增 4 处）｜(b) 仅上轮已批的 9 处 | **(a)** | **开工阻塞**。选 (b) 会留下 4 处同类缺陷，且静态门禁无法对 4 处放行 ⇒ 门禁要么误报要么需白名单 |
| **D3** | 防回归手段 | (a) 静态门禁为主 + 真浏览器探针为辅｜(b) 仅真浏览器探针 | **(a)** | 探针需系统 Chrome + 运行中的 WebUI，**不适合做 CI 门禁**；静态门禁可在 CI 常驻 |
| **D4** | URL 写入时机 | (a) 保持每次按键即写（分享链接实时可用）｜(b) 防抖写入（300ms） | **(a)** | 选 (b) 会改变「复制地址栏即得当前筛选」的实时性，属产品行为变更，不应顺手改 |
| **D5** | 伴生缺陷 C-1 / C-2 是否本期修 | (a) 一并修｜(b) 仅登记不修 | **(a)** | C-2 与 IME 无关也独立成 bug（键入 `", "` 被抹除），同批修性价比高 |
| **D6** | 设计规范补齐 | (a) 补 `design-system` 输入框章节｜(b) 仅在 `99-governance.md` 记临时决策 | **(a) 与 (b) 都做**：先记临时决策，再提章节 | `design-system` 现无输入框／筛选栏组件章节，本次是规范缺口 |

---

## 5. 核心流程（伪代码）

### 5.1 URL 驱动受控输入框的判定算法（门禁与排查共用）

判定依据是 **`value` 表达式的来源**，**不是** `onChange` 是否写 URL。`onChange` 写 URL 而 `value` 取自本地 state ⇒ **正确范式，不算缺陷**（`HelpCenter.tsx:359-369` 即此）。

```text
# 输入：源码文件 F（webui/src/**/*.tsx，排除 __tests__）
# 输出：F 内全部「URL 驱动受控文本输入框」清单

function collectUrlDerivedVars(text):
    seeds ← ∅
    # (1) useSearchParams 派生的局部常量
    for m ← text.matchAll(/const\s+(\w+)\s*=\s*[^;\n]*searchParams\.get(All)?\(/g):
        seeds.add(m[1])
    # (2) useParams 派生的解构变量
    for m ← text.matchAll(/const\s+\{([^}]*)\}\s*=\s*useParams/g):
        for name in m[1].split(","): seeds.add(name.trim())
    # (3) 自定义 get() 封装（如 useAccessMapParams）
    for m ← text.matchAll(/const\s+(\w+)\s*=\s*[^;\n]*\bget\(\s*["'`]/g):
        seeds.add(m[1])
    # (4) location.search 派生
    for m ← text.matchAll(/const\s+(\w+)\s*=\s*[^;\n]*location\.search/g):
        seeds.add(m[1])
    # (5) 传递闭包：引用任一 seed 的局部 const 也是 URL 派生
    repeat until seeds 未变:
        for (name, rhs) in localConsts(text):
            if name ∉ seeds ∧ rhs 引用任一 seed:
                seeds.add(name)
    return seeds

function collectTextInputs(text):
    for each <input> / <textarea> 开标签:
        if type ∈ {checkbox, radio, hidden, submit, button, range, file, color,
                   date, datetime-local, time}: 跳过        # 非文本输入，无 IME 组合
        yield { line, valueExpr, onChangeExpr, label }

function isUrlDriven(input, seeds):
    return input.valueExpr ≠ ∅ ∧ input.valueExpr 引用任一 seed
```

**判定样例（门禁必须能区分）**

| 写法 | 判定 | 理由 |
|---|---|---|
| `value={user}`，其中 `user = searchParams.get("user")` | **缺陷** | value 源自路由状态 |
| `value={unifiedSearchValue}`，其中 `unifiedSearchValue = keySearch \|\| turnSearch \|\| tableSearch`（三者均 URL 派生） | **缺陷** | 传递闭包命中 |
| `value={draftQuery}`，其中 `draftQuery` 为 `useState` 本地 state | 通过 | 正确范式 |
| `value={search}`，其中 `search` 为 `useState("")` | 通过 | 正确范式 |
| `value={turnId}`，其中 `turnId = useState(searchParams.get("turnId"))` | 通过 | 初值来自 URL，但**受控源是本地 state** |

### 5.2 局部状态镜像模式（主修法，对应 D1=(a)）

```text
function useUrlMirroredField(paramKey):
    urlValue ← searchParams.get(paramKey) ?? ""
    [draft, setDraft] ← useState(urlValue)

    # (1) URL 外部变更 → 反向同步（深链 / hydration / 后退 / 清除筛选 / 其它入口）
    useEffect(() => { setDraft(urlValue) }, [urlValue])

    # (2) 用户输入 → 本地立即回显 + URL 跟随
    function onChange(e):
        v ← e.target.value
        setDraft(v)                     # ← 同步；先于任何异步副作用
        next ← new URLSearchParams(searchParams)
        if v ≠ "": next.set(paramKey, v) else next.delete(paramKey)
        setSearchParams(next)            # ← 异步副作用；是否防抖见 D4

    return { value: draft, onChange }
```

**三条不变量（验收断言的唯一来源）**

- **INV-1（组合存活）**：组合进行中 `draft` 与 DOM 值**恒等** ⇒ React 的 `value` prop 永不 ≠ DOM 值 ⇒ Chrome 不会取消组合。**这是本修法唯一的必要条件**。
- **INV-2（禁止变换写回）**：`onChange` 中**不得**对 `e.target.value` 做 `trim` / 大小写 / 拆分 / 过滤后再 `setState`。任何变换都会让 state ≠ DOM 值，触发写回（伴生缺陷 C-1、C-2 即此类）。
- **INV-3（不得脱节）**：任何**非用户输入**引起的 URL 变更，必须经由 (1) 的反向同步路径把 `draft` 拉回。否则输入框显示的文本与 URL 表达的筛选条件不一致。

**INV-3 的高危触发源（实现时必须逐条处理）**

| 触发源 | Audit 页落点 | 要求 |
|---|---|---|
| 首次挂载 / 深链 | `Audit.tsx:1478` | `draft` 初值 = URL 值 |
| localStorage 快照 hydration | `Audit.tsx:1497-1521` | 经 (1) 同步 |
| **清除筛选** | `Audit.tsx:1693` `clearFilters` | **必须显式重置全部镜像 draft**。该函数把 URL 整体重建为仅含 `range`/`view`/`turnId`/`object`/`eventId`，若不重置 draft，7 个输入框仍显示旧文本而 URL 已清空 ⇒ 违反 INV-3。**本项是本次改造最高回归风险** |
| 浏览器后退 / 前进 | router popstate | 经 (1) 同步 |
| 其它入口改同一 param | 跨组件 | 经 (1) 同步 |

### 5.3 URL 反向同步的时序

```text
用户键入 "zh"（组合中）
  → onChange: setDraft("zh")            # 同步，DOM 立即回显
  → setSearchParams(...user=zh)          # 异步导航
  → [导航完成] location.search 变化 → urlValue = "zh"
  → useEffect([urlValue]) → setDraft("zh")   # 同值 ⇒ React 状态更新被跳过 ⇒ 不产生额外渲染

URL 外部变更（后退）
  → location.search 变化 → urlValue = "zh"
  → useEffect([urlValue]) → setDraft("zh")   # 输入框回显新值
```

**关键**：反向同步写入的是**同一个值**时，React 会跳过该状态更新（`Object.is` 相等），因此**不产生额外渲染、不触发 DOM 写回**。这是 INV-1 成立的前提，不得改成「每次 effect 都强制写」。

### 5.4 变换写回的处理（对应 INV-2 / 伴生缺陷 C-1、C-2）

```text
# 禁止：把变换后的值写回受控输入框
✗ onChange = (e) => setState(e.target.value.trim())
✗ value={arr.join(", ")} ∧ onChange = (e) => setState(e.target.value.split(",").map(s => s.trim()).filter(Boolean).join(", "))

# 正确：受控输入框的值 = 用户输入的原文；规范化只发生在下游消费点
✓ onChange = (e) => setState(e.target.value)
✓ 查询/提交时再对消费值做 trim / parse
```

逐处处置：

| 位置 | 现状 | 处置 |
|---|---|---|
| `AuditReconciliation.tsx:313` | `setTurnId(e.target.value.trim())` | 存原文；发起查询前再 `trim()`（消费点规范化） |
| `CaseEditor.tsx:291` | `value={form.expected_measures.join(", ")}` + 拆分/trim/过滤写回 | 拆成「原文 draft」与「解析值」双态：受控输入框绑定原文 draft，解析结果只用于下游；提交前再解析 |

### 5.5 静态门禁（新增 `npm run lint:url-driven-input`，对应 D3=(a)）

```text
main():
    failures ← []
    for each file F in webui/src (递归, 排除 __tests__):
        seeds ← collectUrlDerivedVars(F)
        for each input I in collectTextInputs(F):
            if isUrlDriven(I, seeds):
                failures.add({ file: F, line: I.line, label: I.label })
    if failures 非空:
        逐条打印 F:line + 输入框 label + 提示「value 源取自路由状态，改用局部状态镜像（Spec §5.2）」
        exit 1
    else:
        print "URL-driven input lint passed (N files scanned)."
```

**门禁约束**

- **不得设白名单豁免**：本期修完后 13 处全部转绿，若仍有豁免需求说明改造不彻底。
- **必须自带单测**：至少覆盖「缺陷写法报错」「正确范式不报错」「`useState(searchParams.get(...))` 不报错」「非文本 input 不参与判定」四类用例。
- **必须接进 CI**：与既有 `lint:terminology` 并列，挂在同一 job。

---

## 6. 验收标准

### 6.1 逐处改造（SC-01 – SC-13）

对 §2.1 表中每一处，改造后必须同时满足：

1. 输入框的 `value` **不取自** URL 派生变量（改由本地 state 驱动）；
2. 用户键入文本后，URL 对应 param **立即等于**输入文本（若 D4 选防抖，则在防抖窗口结束后 ≤ delay + 100ms 内相等）；
3. 深链打开（`?user=analyst_zhang`）时输入框显示该值；
4. 浏览器后退后输入框回到前一个值；
5. 该页「清除筛选」类动作执行后，输入框清空且 URL 无对应 param。

### 6.2 防回归门禁（SC-14 – SC-16）

- **SC-14**：`npm run lint:url-driven-input` 对**改造前**基线报出 §2.1 表中全部 **13** 处；对**改造后**代码报 **0** 处。
- **SC-15**：门禁**零误报**——其余 55 个「含路由状态组件内」的文本输入框不得被报 fail；至少抽样断言 5 个已知正确范式通过：`HelpCenter.tsx:364`、`AgentList.tsx:633`、`RoleList.tsx:302`、`SkillList.tsx:221`、`AccessMap.tsx:246`。
- **SC-16**：门禁自带单测全绿，覆盖四类判定（缺陷写法／正确范式／`useState(searchParams.get(...))`／非文本 input）。

### 6.3 真实浏览器验收（SC-17）

用真实 Chrome + CDP `Input.imeSetComposition` 对 13 处**逐处**跑一遍 IME 组合序列（`zhong` → `zhongwen` → `中文`），断言：

- `compositionstart` 计数 **= 1**（不得 > 1）；
- 最终 DOM 值 **== `中文`**（不得出现拼接）；
- 组合期间 `HTMLInputElement.prototype.value` setter 被调用次数 **= 0**；
- 输入框焦点保持（`document.activeElement` 仍为该输入框）。

**该验收不可用 jsdom 替代**（§1.2 已实测 jsdom 不可复现）。

### 6.4 伴生缺陷与回归（SC-18 – SC-21）

- **SC-18**（C-1）：`AuditReconciliation` 问询 ID 输入框输入带首尾空格的文本后，**输入框保留原文**，查询仍按 trim 后的值发起。
- **SC-19**（C-2）：`CaseEditor` 期望指标输入框可键入 `", "` 且不被立即抹除；受控值为原文，解析值只用于下游。
- **SC-20**：`cd webui && npm test` 全绿；既有 URL 断言测试（如 `audit.test.tsx:212` 的 `user=analyst_zhang` 服务端查询断言、`admin-audit-turns.test.tsx:777` 的「清除筛选」用例）**不得回归**。
- **SC-21**：`npm run lint:terminology`、`npm run lint:ia-boundary`、`npm run lint:spec` 全绿；新增 `npm run lint:url-driven-input` 全绿；CI job 增绿。

### 6.5 交付判定

SC-01 – SC-21 **全部执行且通过** 方可判定交付。其中 **SC-17 必须有真实浏览器运行记录**（含探针脚本与输出留痕，落 `inbox/`），jsdom 结果**不得**充当该项证据。

---

## 7. 兼容、迁移与风险

### 7.1 兼容

- URL 参数名、含义、格式**全部不变**；既有深链、分享链接、外部跳转**继续可用**。
- `localStorage` 筛选快照键 `lucy:webui:audit:filters:v3`（`Audit.tsx:945`）**不变**，无数据迁移。
- 后端 API、审计语义**不变**。

### 7.2 迁移

无。纯前端渲染层改造。

### 7.3 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| **「清除筛选」后输入框与 URL 脱节**（`clearFilters` 整体重建 URL，未重置镜像 draft） | **高** | INV-3 + SC-01(5)；实现时必须显式重置；`admin-audit-turns.test.tsx:777` 已有「清除筛选」用例可作回归哨兵 |
| 本地 state 与 URL 双源在「后退 / 深链 / hydration」时序错位 | 中 | INV-3 的反向同步路径 + SC-01(3)(4) |
| 13 处分散在 5 个文件，遗漏 1 处即门禁变红 | 中 | 静态门禁是唯一收敛保证（SC-14） |
| 探针依赖系统 Chrome + 运行中的 WebUI，CI 不可用 | 中 | 门禁以静态检查为主（SC-14–16），探针仅作一次性验收（SC-17） |
| 改造顺带改变了「每次按键即写 URL」的历史行为（若 D4 选防抖） | 中 | D4 默认选 (a) 不改该行为 |
| 误把 `useState(searchParams.get(...))` 判为缺陷、或误判 `onChange` 写 URL 为缺陷 | 低 | 门禁单测覆盖四类判定（SC-16） |
| 只修主缺陷、放任 C-2（键入 `", "` 被抹除） | 低 | SC-19 |

### 7.4 回滚

13 处改造分散在 5 个文件，**每页可独立回滚**；门禁为新增只读脚本，回滚不影响运行时；无数据面变更。

---

## 8. 交付判定

- 本 Spec 及配套 [实施 Plan](../plans/2026-10-29-lucy-url-driven-input-ime-composition-plan.md) 落盘并进入审阅，**不代表**任何实现获授权。
- 审阅通过、**D1–D6 全部拍板**后方可开工；D1（修法形态）、D2（范围）为开工阻塞项。
- 交付判定以 §6 的 SC-01 – SC-21 为准，SC-17 必须有真实浏览器记录。

---

## 9. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

§3 表格中的术语（URL 驱动受控输入框、局部状态镜像、组合写回、变换写回）均为**开发侧工程术语**，不进入任何用户可见文案、错误码、Toast、Modal、表格列名或导航；本次**不新增产品概念**，无需在术语标准登记。

---

## 10. Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`
- `webui/docs/design-system/99-governance.md`（规范变更流程与执行要求）

### What This Change Follows

- [x] 视觉层级与交互语义一致——本次为**行为层**改造：DOM 结构与视觉零变更（不新增/删除控件、不改 class、不改配色、不改间距与字号）
- [x] 选中态未误用 `primary` / `danger`——本次不涉及按钮 / Tab / 时间窗
- [x] PageHeader 可见动作 ≤ 3——本次不涉及 PageHeader
- [x] disabled 若有前置条件，已提供 tooltip / `aria-describedby`——本次不新增 disabled 态
- [x] 颜色使用语义 token / 语义 class，无新增硬编码色值——输入框沿用既有 `pl-input` 类
- [x] 网格/间距遵循现有页面节奏，无随机 spacing 漂移——筛选栏结构与排列不变
- [x] 列表页 KPI 使用共享 Metric Card——本次不涉及
- [x] 文案与排版符合术语与可读性要求——**零新增用户可见文案**；既有 `aria-label` 全部保留
- [x] 焦点态、禁用态、加载态覆盖完整——本次**强化焦点态**：IME 组合期间输入框保持焦点且组合不被取消（INV-1）

### Exceptions (If Any)

- **规范缺口**：`design-system` 现有章节（Foundations / Components / Patterns / Governance）**无「输入框 / 筛选栏」组件章节**，「受控输入框的 `value` 源」这一交互约束当前无处落位。
  - **临时决策**（按 `99-governance.md` 流程登记）：「**筛选栏文本输入框的 `value` 必须由局部状态驱动，URL 作为下游事实源跟随**」。
  - **理由**：URL 驱动的受控输入框会在 IME 组合进行中被浏览器取消组合（§1.3），属可用性缺陷，不是风格偏好。
  - **例外边界**：该临时决策**仅约束交互层数据来源**，不放松任何视觉规范；本次 DOM 结构与视觉零变更，故不与既有章节产生冲突。
  - **落点**：临时决策写入 `webui/docs/design-system/99-governance.md`（Plan S6）。

### Follow-up Needed

- 建议新增 `webui/docs/design-system/14-components-filter-input.md`：输入框 / 筛选栏组件规范（`value` 源约定、状态镜像与 URL 同步时序、清除动作的联动要求、IME 组合不变量 INV-1–INV-3）。
- **该章节补齐前，本 Spec §5 为该约束的事实源**；章节补齐方式归属决策点 **D6**。
