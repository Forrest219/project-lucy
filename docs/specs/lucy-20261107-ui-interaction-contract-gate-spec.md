# WebUI 交互合同门禁 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 仓库级评审门禁 / **v0.5** |
| 日期 | 2026-11-07 |
| 功能编号 / 台账号 | **无** / **无**。不进入 `0.30` 功能清单池，不回写需求池 REQ，不占用 `L25-*` |
| 状态 | **v0.5，开发授权已获得；功能合同已收口（2026-11-07）**。本条收口不表示可上线 |
| 决策来源 | 2026-11-07 委托人同意先把交互合同写成门禁，并支持第 1、2 轮 Codex 的收窄。同日追加元素清单。Codex 确认审判定 v0.5 可定稿。委托人同日确认定稿，并授权开发、收口。终稿确权本身不构成开发授权；本次授权是另一次明示 |
| 需求来源 | 2026-08 页面台账多轮在 Fixed 时写明没做浏览器验证；2026-10-30 发版走查 Spec 记录了同一事实 |
| 实施主体 | 文档与 `scripts/lint-spec-docs.mjs`。不改 WebUI 运行代码，不改 KTX |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「新增 Spec / Plan 的落盘清单」 |
| 与既有 Spec 的关系 | **复用，不改判定。** 按钮层级沿用 [`webui/docs/design-system/10-components-button.md`](../../webui/docs/design-system/10-components-button.md) §3 第 1 条（同一 action group 最多一个 primary）与第 8 条（PageHeader 可见动作 ≤ 3，该组至多 1 个 primary）。发版三层检查沿用 [`docs/specs/lucy-20261030-webui-release-ux-review-spec.md`](lucy-20261030-webui-release-ux-review-spec.md) D1–D12，本条不改那些判定。台账沿用 [`docs/ui-ux-feedback/README.md`](../ui-ux-feedback/README.md)。授权落地时只追加门禁句 |
| 评审记录 | [`docs/reviews/2026-11-07-codex-review-ui-interaction-contract-gate.md`](../reviews/2026-11-07-codex-review-ui-interaction-contract-gate.md) |
| 实施计划 | [`docs/plans/lucy-20261107-ui-interaction-contract-gate-plan.md`](../plans/lucy-20261107-ui-interaction-contract-gate-plan.md) v0.5 |

## 闭口层级

- 层级：功能合同
- 本条承诺：被触发且没有有效豁免的 Spec，若缺一份按本文文法解析的交互合同或元素清单，或配对 Plan 缺浏览器小节，或已完成的证据没有恰好覆盖清单全部编号，`lint:spec-docs` 失败；grandfather 名单内的文件，只有正文标记行或状态行含「开发授权已获得」时才进入同一检查。
- 本条出口：SC-01–SC-15。夹具打假文法、豁免、路由登记、授权口令、元素清单、证据记号和 grandfather；落地 diff 证明治理句子已写入，且没有运行时代码或发版判定改动。
- 不在本条出口：请求授权那一刻的人工阅读、豁免声明与代码 diff 是否相符、证据文件里的字是否来自真实浏览器、把已落盘 Spec 现在逐份补合同、重做页面、发版走查签字、移动窄屏、客户环境。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 「交互合同」「决定信息」「基准页」只用于评审流程，不出现在产品界面，不写入术语标准。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 本条落地不改页面、组件、颜色、间距或文案。
- [ ] primary 的数量沿用按钮规范 §3：同一 action group 最多一个；PageHeader 另有可见动作 ≤ 3 的预算。独立确认面是另一个 action group。
- [ ] Design System Compliance 四段式继续检查组件。交互合同是追加小节，不替换四段式。
- [ ] 新视觉模式仍须先有设计系统章节，再在基准页字段写「新模式：」。

### Exceptions (If Any)

- 无。本条不新增视觉模式。

### Follow-up Needed

- 无。授权落地时不改设计系统正文的判定。

---

## 1. 背景

功能评审能把数据、权限和失败关闭写到可打假。空态、确认面和主按钮要等页面做出来才被看见。2026-08 的台账把大量条目收到 Fixed，并写明该轮不做浏览器验证。发版走查把同一类问题留到发版。

委托人同意四件事：授权前有交互合同；交互评审与功能评审分开；改界面的计划写明浏览器验证；台账编号留在合同里。随后追加第五件：UI 检查所覆盖的每个页面有一份元素清单，下一次检查对着这份清单做，新发现先补进行再记结果。v0.2 按第 1 轮评审收窄了机器能证明的范围：lint 核对文法、登记路由和证据文件里的记号。它不证明有人在请求授权时读过，也不证明有人打开过浏览器。清单的「这次结果」同样只证明记录写了该编号，不证明浏览器已被打开。

## 2. 决策

| 编号 | 决策 | 裁定 |
|---|---|---|
| D1 | 触发线索 | 去掉围栏后，满足任一即触发：反引号中的路径符合 §4.1；正文含 `webui/src/`；有一行去掉空白后恰好是「交互合同适用」。线索只决定要不要检查，不决定路由合不合法 |
| D2 | 路由合法性 | 合同里的每条路由，要么等于 `webui/src/app/App.tsx` 的 `path` 或 `webui/src/app/navigation.ts` 的 `to`，要么写成「新路由：」且不等于任何已登记路径。`/joins/:conn/:schema/:table` 以 `App.tsx` 为准，是已登记路由 |
| D3 | 豁免 | 恰好一个「交互合同豁免」小节，原因含固定短语「不改变用户可见 WebUI 表面」，「不改变」非空，且全文没有「交互评审」小节。与「交互合同」同时出现则失败 |
| D4 | grandfather | 落地提交用当时 `git ls-files docs/specs/*.md` 写成名单。名单内文件在没有标记行、且状态行不含「开发授权已获得」时，lint 的第一支就是返回通过，不解析豁免，也不解析合同。这避免把已落盘草案一次性打红 |
| D5 | 授权口令 | 唯一能取消 grandfather 的状态短语是「开发授权已获得」。`已批准开工` 和其他说法不取消跳过，也不构成通过本门禁。lint 不在请求授权时运行。请求时只对触发且没有有效豁免的 Spec 确认 Q1–Q6 全为「通过」。有效豁免不写六问，授权人只核对豁免两行。这一步写进 `DEVELOPMENT.md`，不记成机器已检查 |
| D6 | 动作预算 | 同一 action group 最多一个 primary（按钮规范 §3 第 1 条）。PageHeader 可见动作 ≤ 3，且该组至多一个 primary（§3 第 8 条）。对话框、确认面各自成组，不把整页收成只能有一个 primary |
| D7 | 浏览器 | 配对 Plan 写一个视口，只能是 `1920×1080` 或 `1440×900`。默认 `1920×1080`。不要求两个都跑。不做移动窄屏。执行前证据写「未执行」 |
| D8 | 证据限度 | 完成后的证据是 `docs/reviews/` 或 `docs/ui-ux-feedback/` 下的文件，并且含 §4.4 的记号。记号齐全只证明记录覆盖了合同状态。它不证明作者打开过浏览器。SC-09 通过不得把台账写成 Verified |
| D9 | 台账 | 新问题才追加新 ID。已有 ID 只更新该条，不新开重复 Open。代码已经修复并且评审通过，才写 Fixed。合同点名的浏览器状态经人复核通过，才写 Verified |
| D10 | 六问 | 六问只存在于触发且没有有效豁免的 Spec。草案允许「未评」。有效豁免禁止出现「交互评审」。六问不替代 `0.30` 终稿确权，也不构成开发授权。开发授权仍由委托人另发，并用 D5 的口令写入该 Spec 的状态行 |
| D11 | 范围 | 不入 `0.30` 功能清单池。发版走查 D1–D12 的判定不改 |
| D12 | 生效 | 本文件定稿不等于门禁生效。生效是开发授权之后，lint、名单、`DEVELOPMENT.md` 和台账 README 同一次落地 |
| D13 | 元素清单 | 合同里的每条路由一份清单，列是编号、路由、元素、区域、期望。当次结果只写在浏览器证据里。每个非「不适用」的状态，以及「主动作」「决定信息」，在该路由下各有恰好一行。证据恰好覆盖全部编号：缺编号或出现清单外编号都失败。新发现先补进行，再写入下一次证据。不收录 DOM、`class=` 和间距像素。不在本轮为没有合同的旧页面补清单。发版走查 D1–D12 的判定不改 |

D1–D13 没有留给委托人的二选一。G1 仍开放：豁免是否诚实，lint 不核对 diff。

## 3. 非目标

- 不重做已有页面，不要求本轮修完现有 Open 项。
- 不把已落盘 Spec 现在逐份补合同。它们在状态行写出「开发授权已获得」之前，lint 不打假。
- 不新增 npm script，不把浏览器放进 PR CI，不修改 `e2e:release-ux`。
- 不要求高保真稿。
- 不把请求授权时的人工确认、豁免与 diff 的一致性、或证据记号写成「浏览器已经跑过」。
- 不在本轮给没有这份合同的旧页面补元素清单。一次检查要覆盖的页面，就是合同「路由」里的每一条。

## 4. 文法

解析前先删除围栏代码块。围栏里的标题、路径和标记行都不算。二级标题去掉空白后整句匹配，不接受编号前缀。

### 4.1 触发线索里的路径

反引号内的文本整段匹配：

```text
/[a-z][a-z0-9-]*(?:/:[A-Za-z][A-Za-z0-9_-]*|/[A-Za-z0-9_.:~*-]+)*
```

`/joins/:conn/:schema/:table` 与 `/admin/agents` 都匹配。`/Users/...` 不匹配。没有反引号的普通句子不靠这条触发。

### 4.2 交互合同小节

触发且未豁免时，必须有恰好一个标题为「交互合同」的二级小节。字段只在该小节内查找，从该标题到下一个二级标题之前。非空行必须恰好 9 行，标签和顺序固定。行首是 `- `。值是第一个全角冒号之后的文本，去掉首尾空白后不得为空。重复标签、缺行、多行、半角冒号，都失败。

```text
- 路由：<值>
- 基准页：<值>
- 一件事：<值>
- 状态：<值>
- 主动作：<值>
- 决定信息：<值>
- 术语：<值>
- 台账：<值>
- 状态维度：<值>
```

- 路由：用顿号 `、` 分开记号。每个记号要么与已登记的 `path` 或 `to` 整串相等，要么匹配 `新路由：` 加 §4.1 的路径，并且该路径不等于任何已登记串。`新路由：/admin/agents` 失败，因为 `/admin/agents` 已登记。
- 基准页：整值是 `/admin/tokens`、`/catalog`、`/skills`、`/connections/enabled-tables`、`/admin/agents` 之一；或匹配 `新模式：webui/docs/design-system/<文件名>.md`，且该文件存在。
- 一件事：非空即可。
- 状态：用全角分号 `；` 分成恰好 7 段，标签顺序固定：`首访：`、`空：`、`加载：`、`错误：`、`0 条：`、`成功：`、`部分：`。每段值非空。不适用的值必须以 `不适用：` 开头，其后还有非空原因。
- 主动作：值内同时含 `primary` 与「不做」。lint 不数按钮。数量由 Q2 按 D6 的作用域人工核对。
- 决定信息：非空。
- 术语：值含「已登记」或「本条新增」。
- 台账：整值是「无新台账」，或含至少一个 `UX-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]+`。
- 状态维度：值含「同一状态维度不得互相否定」。

紧接着的下一个二级标题必须是「元素清单」，中间只能有空白。元素清单的文法见 §4.5。再下一个二级标题必须是「交互评审」，中间只能有空白。交互评审的非空行恰好 6 行：

```text
- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：<未评|通过|不通过>
- Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突：<未评|通过|不通过>
- Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因：<未评|通过|不通过>
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：<未评|通过|不通过>
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：<未评|通过|不通过>
- Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance：<未评|通过|不通过>
```

问句必须与上面各行冒号之前的文字整句相同。重复 Q、改写问句、缺 Q，都失败。值为「不通过」时，同一行在值之后还要有「原因：」和非空原因。

状态行含「开发授权已获得」时，六问的值必须全是「通过」。

### 4.3 豁免小节

豁免与合同互斥。豁免 Spec 有恰好一个标题为「交互合同豁免」的二级小节，非空行恰好 2 行，顺序固定：

```text
- 原因：<值>
- 不改变：<值>
```

原因的值必须含「不改变用户可见 WebUI 表面」。不改变的值非空。全文不得再有标题为「交互评审」「交互合同」或「元素清单」的二级小节。这些标题都恰好是 0 个。第二个豁免小节失败。

### 4.4 配对 Plan 的浏览器小节

配对文件把 Spec 文件名的 `-spec.md` 换成 `-plan.md`。找不到则失败。该 Plan 有恰好一个标题为「浏览器验证」的二级小节。

- 豁免 Spec：该小节第一条非空行匹配 `不适用：` 且冒号后还有非空文本。
- 触发 Spec：非空行恰好 4 行，顺序为「路由」「视口」「状态」「证据」。路由值与合同的路由值整串相同。视口整值只能是 `1920×1080` 或 `1440×900`。状态值整串是清单编号用顿号连起来，从 `E1` 到最后一个编号各一次，例如清单有三行时整串是 `E1、E2、E3`。多一个编号、少一个编号、重复或夹杂其他文字，都失败。证据整值是「未执行」，或是一条相对路径。
- 证据路径不得含 `..`，不得以 `/` 开头，必须是文件，扩展名 `.md`，并且位于 `docs/reviews/` 或 `docs/ui-ux-feedback/`。目录、`docs/README.md`、越界路径都失败。
- 证据不是「未执行」时，正文必须含合同路由值和视口整值。清单里的每个编号在正文里恰好出现一次 `该编号：通过` 或 `该编号：失败`。正文里每个 `E<数字>：通过` 或 `E<数字>：失败` 的编号都必须在清单里。缺编号、同一编号两条结果、或清单外编号，都失败。
- Plan 状态行含「浏览器验证已完成」时，证据不得是「未执行」，且上一款记号必须齐全。

记号齐全不把台账改成 Verified。Verified 只按 D9，由人在复核后改台账。

### 4.5 元素清单文法

标题恰好是「元素清单」，并且全文恰好一个这个二级标题。非空行至少 1 行。每行匹配：

```text
- E<正整数>｜<路由>｜<元素>｜<区域>｜<期望>
```

五段都不为空，分隔符是全角竖线 `｜`。编号从 `E1` 起连续递增，不重复、不跳号。

合同「路由」里的每个记号先去掉可选前缀「新路由：」，得到路径。清单的「路由」段必须等于其中一条路径。行内不写「新路由：」。

同一路径下，「元素」不重复。对每条路径，下列元素必须各有恰好一行：该路径对应合同里、值不以「不适用：」开头的状态标签，标签文本是 `首访`、`空`、`加载`、`错误`、`0 条`、`成功`、`部分` 之一；以及 `主动作`；以及 `决定信息`。合同只有一份状态字段，所以每条路径使用同一组必填元素。以「不适用：」开头的状态不强制有行；写了也不失败。

任一段出现 `class=`、`DOM`，或匹配 `[0-9]+px`，该行失败。lint 不判断一行是不是用户看得见的元素；它只拒绝这三种已写明的记号。

当次结果不写在清单里。结果只写在 §4.4 的证据文件中。

## 5. 台账与治理句子

授权落地时，台账 README「使用规则」追加：

- 新问题追加新 ID。已有 ID 复现或本轮正在修它，只更新该 ID，不新开一条。
- 代码已经修复，并且代码评审通过，才把该 ID 写成 Fixed。没有修复时，评审通过不得写成 Fixed。
- 该 ID 写明的浏览器复核通过之后，才写成 Verified。合同证据文件里的记号不代替这次复核。

`DEVELOPMENT.md` 追加：

- 落盘清单一行：触发、豁免、文法以本 Spec 为准；机器门禁是 `lint:spec-docs`。
- 唯一能让 lint 取消 grandfather 的状态短语是「开发授权已获得」。其他说法不取消跳过，也不构成通过本门禁。
- 请求开发授权时，只有触发且没有有效豁免的 Spec 才确认 Q1–Q6 全为「通过」。有效豁免不写六问，授权人只核对豁免两行。这一步不是 lint。
- grandfather 文件若要在授权前就接受检查，作者写标记行；否则等状态口令出现。发版走查仍是后置兜底。
- 浏览器默认不变。没触发的任务仍然默认不做浏览器测试。触发的 Plan 必须把这一次写进「浏览器验证」。
- 触发且没有有效豁免时，合同里的每条路由有一份元素清单。列是编号、路由、元素、区域、期望。当次结果只写在浏览器证据里，并且恰好覆盖清单编号。新发现先补进行，再记结果。清单不写 DOM、`class=` 和间距像素。没有这份合同的旧页面，不在本轮补清单。

## 6. 核心流程（伪代码）

```text
stripFences(text):
  remove fenced blocks, then parse headings and lines

registeredRoutes():
  paths = path="..." attributes in webui/src/app/App.tsx
  tos = to: "..." values in webui/src/app/navigation.ts
  return the union

routeTokenIsLegal(token):
  if token equals one registered string:
    return true
  if token starts with "新路由：":
    path = token after that prefix
    return path matches §4.1 and path is not a registered string
  return false

check(spec, plan, grandfather):
  body = stripFences(spec)
  marked = a line in body trims to exactly "交互合同适用"
  authorized = spec status line contains "开发授权已获得"
  grandfathered = spec path is listed in grandfather.files
  triggered = marked
    or body contains "webui/src/"
    or a backtick token matches §4.1

  if grandfathered and not marked and not authorized:
    return pass

  headings = h2 titles in body
  waiverCount = count of h2 "交互合同豁免"
  contractCount = count of h2 "交互合同"
  reviewCount = count of h2 "交互评审"
  inventoryCount = count of h2 "元素清单"
  if waiverCount > 1 or contractCount > 1 or reviewCount > 1 or inventoryCount > 1:
    fail
  if waiverCount > 0 and contractCount > 0:
    fail

  if waiverCount == 1:
    require the two waiver lines in §4.3, in order, values non-empty
    require reason contains "不改变用户可见 WebUI 表面"
    require reviewCount == 0
    require inventoryCount == 0
    require plan has exactly one h2 "浏览器验证"
    require its first non-empty line matches "不适用：" plus non-empty text
    return pass

  if not triggered:
    return pass

  require contractCount == 1
  require inventoryCount == 1
  parse the nine lines only inside that section; any other shape fails
  require every route token legal
  require benchmark value is one of the five paths, or an existing 新模式 file
  require the seven state segments
  require 主动作 contains "primary" and "不做"
  require 术语 contains "已登记" or "本条新增"
  require 台账 is "无新台账" or contains one UX id
  require 状态维度 contains "同一状态维度不得互相否定"
  require the next h2 is "元素清单"
  parse its rows with §4.5; any other shape fails
  paths = contract route tokens with the optional prefix "新路由：" removed
  require every row route is in paths
  require each path has exactly one row for each non-不适用 state label, plus "主动作", plus "决定信息"
  require ids are E1..En with no gaps
  require no row contains "class=", "DOM", or a token matching [0-9]+px
  require the next h2 is "交互评审" and its six lines match §4.2 exactly
  if authorized and any Q value is not "通过":
    fail

  require the paired plan exists
  parse its four browser lines
  require 路由 equals the contract 路由
  require 视口 is "1920×1080" or "1440×900"
  require 状态 value equals the inventory ids joined by "、" from E1 through the last id, with no extra text and no duplicates
  if 证据 is "未执行":
    ok for this branch
  else:
    require the path rules in §4.4
    require the file contains the contract route value and the viewport
    require each inventory id appears once as "id：通过" or "id：失败"
    require every such result id exists in the inventory
  if plan status contains "浏览器验证已完成" and 证据 is "未执行":
    fail
  return pass
```

失败分支对应 §7。G1 不在失败分支里。

## 7. 验收

| 编号 | 断言 | 证据 |
|---|---|---|
| SC-01 | 反引号里的 `/joins/:conn/:schema/:table` 或 `/future-board` 会触发。无合同且无豁免 → 失败。同一路径写在围栏里不触发。生产路由表必须含 `App.tsx` 里的 `/joins/:conn/:schema/:table` | 单测，其中一条读真实 `App.tsx` |
| SC-02 | 文件不在 grandfather 跳过分支时：合同与豁免并存、两个豁免、豁免缺「不改变」、原因没有固定短语、豁免同时有「交互评审」或「元素清单」、Plan 的「不适用：」后为空 → 都失败。恰好两行且 Plan 原因非空 → 通过。有效豁免加上「开发授权已获得」、且没有「交互评审」和「元素清单」→ 通过 | 单测 |
| SC-03 | 字段错序、重复、跑到小节外、缺状态段、不适用没有原因 → 失败。九行合乎 §4.2 → 通过 | 单测 |
| SC-04 | `/joins/:conn/:schema/:table` 作为已登记路由通过。`/future-board` 失败。`新路由：/future-board` 通过。`新路由：/admin/agents` 失败。基准页指向不存在的设计系统文件 → 失败 | 单测 |
| SC-05 | 主动作缺 `primary` 或缺「不做」→ 失败 | 单测 |
| SC-06 | 台账既不是「无新台账」也不含合法 UX 编号 → 失败 | 单测 |
| SC-07 | 标记行在围栏外会触发；围栏内的同一行不触发。问句被改写、Q 重复、合同与元素清单之间或元素清单与评审之间插入别的二级标题 → 失败 | 单测 |
| SC-08 | 触发且无豁免时：状态行含「开发授权已获得」且任一问不是「通过」→ 失败；六问都是「通过」→ 通过。有效豁免不因缺少六问而失败。grandfather 文件含路由，状态行是「已批准开工」且无合同 → 仍然通过（跳过）。草案「未评」且没有授权口令 → 不因此失败 | 单测 |
| SC-09 | 缺浏览器小节、视口非法、证据是目录、`../`、`docs/README.md`、不存在的文件、证据缺某个清单编号的结果、同一编号两条结果、或出现清单外编号 → 失败。Plan 状态多写、少写或重复编号 → 失败。「浏览器验证已完成」且证据仍为「未执行」→ 失败。状态整串等于清单编号，且每个编号恰好一条结果 → 形状通过。测试名写明形状通过不等于 Verified | 单测 |
| SC-10 | grandfather 文件含反引号路由、无标记、无授权口令 → 通过，即使豁免小节缺行也不解析。加上「开发授权已获得」且无合同、豁免也不完整 → 失败。加上标记行且无合同 → 失败 | 单测 |
| SC-11 | 落地后的 `DEVELOPMENT.md` 含 §5 的六句，其中包含「其他说法不取消跳过」、「这一步不是 lint」、六问只适用于触发且没有有效豁免的 Spec，以及元素清单的列、恰好覆盖和「不在本轮补清单」 | 落地 diff |
| SC-12 | 台账 README 含 §5 的三句，包括「没有修复时不得写成 Fixed」和「记号不代替复核」 | 落地 diff |
| SC-13 | 落地 diff 不改 `webui/src`、`webui/server`、`e2e:release-ux` 及其断言，不改发版走查 Spec 的 D1–D12 | 路径白名单 |
| SC-14 | `npm run lint:spec-docs`、`npm run lint:spec-docs:test`、`npm run lint:spec`、`npm run lint:terminology`、`npm run lint:ia-boundary` 退出码都是 0。用生产 grandfather 名单跑 lint 时，名单内现行 Spec 不因本规则新失败。不新增 package script | 命令输出 |
| SC-15 | 缺「元素清单」、两个「元素清单」、编号跳号、必填元素缺失、同一路径下元素重复、行内有 `class=`、`DOM` 或 `12px`、合同与清单之间插入别的二级标题 → 失败。豁免两行合规且带有「元素清单」→ 失败。不适用的状态没有对应行 → 仍可通过。清单外的结果编号 → 失败 | 单测 |

SC-01–SC-10 在 lint 落地前没有执行记录。落地后的执行记录见配对 Plan 的验收表。现行状态只看头部「状态」行。

## 8. 落地白名单

获得开发授权后，只允许改这些路径：

- `scripts/lint-spec-docs.mjs`
- `scripts/lint-spec-docs.test.mjs`
- `docs/governance/DEVELOPMENT.md`
- `docs/governance/ui-interaction-contract-grandfather.json`（该次提交新建）
- `docs/ui-ux-feedback/README.md`
- 本 Spec、本 Plan、两份索引、以及本条评审记录

名单是该次提交时 `git ls-files docs/specs/*.md` 的路径，包括本 Spec。本 Spec 同时保留豁免，因此移出名单也不会变成一份屏幕合同。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面。本条只增加文档门禁和 lint。
- 不改变：页面、路由、页头动作、空态、错误态、确认面、用户可见文案、发版走查的判定。
