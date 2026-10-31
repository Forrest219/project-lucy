# Lucy 帮助中心体验 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.1-draft** |
| 日期 / 目标版本 | 2026-10-31 / v0.25 |
| 台账号 | **L25-12**。挂 v0.25 升级台账（[`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2.6）。不另派 WebUI 流水号 |
| 状态 | **待评审；仅授权起草与登记，暂不开发。** 本次不修改程序、运行配置、客户资产、镜像或数据库，不新增测试代码，不执行功能验证或部署 |
| 决策来源 | 2026-10-31 Forrest 决定：帮助文档拆成「快速入门」与「详细指南」两类读物；快速入门不与现有手册混在一起，放在新的改良帮助中心里；当前单页模式不优雅；允许用户把页面内容复制走（复制 Markdown / 导出 PDF） |
| 与既有 Spec 的关系 | **取代 [`lucy-20261021-v2p5-help-center-spec.md`](lucy-20261021-v2p5-help-center-spec.md)（L25-12 原草案，v0.1-draft）。** 原草案只覆盖手册的三层 IA 派生；本 Spec 在其上扩编：新增独立快速入门资产、导出与打印合同、`docs/user-guide/` 迁移处置、角色名统一。原草案自本 Spec 登记起标为「已被取代，不得实施」，其 §3.3 的 URL 合同被本 Spec §5 取代，其余约定在无冲突处继续有效 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「新增 Spec / Plan 的落盘清单」 |
| 实施主体 | Lucy WebUI。不改 KTX 源码，不新增数据库表，不新增运行时能力，不引入外部服务 |
| 实施计划 | [`docs/plans/lucy-20261031-help-center-experience-plan.md`](../plans/lucy-20261031-help-center-experience-plan.md) |

本文件定义拟实现行为，不代表已实现、已冻结或已经通过验收。

## 闭口层级

- 层级：功能合同
- 本条承诺：帮助中心以「门户 → 分类 → 文章」三层呈现系统手册，并独立承载一份「快速入门」读物；任意文章的 Markdown 可被复制或导出带走，旧深链零失效
- 本条出口：SC-01–SC-20 的组件测试、契约测试、静态门禁与术语检查
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级、移动窄屏、Docker 重建、客户现场验收
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- 快速入门（Quick Start Guide）：UI 主术语「快速入门」。独立于系统手册的短篇路径读物，回答「我要干什么、怎么干」。**与手册 §2「快速上手」不是同一个东西**：快速上手是开发环境启动说明（Node／npm／`ktx mcp start`／`ktx.yaml`），快速入门是任务导向的上手路径。禁止文案：快速上手、开始上手、入门指南、快速开始。
- 详细指南：UI 主术语「详细指南」。指系统手册正文的阅读形态，对应 `/help?view=full`。禁止文案：完整手册（作为页面标题时）、详细文档、进阶手册。
- 复制 Markdown：UI 主术语「复制 Markdown」。把当前文章的 Markdown 原文写入剪贴板。**不叫「下载」**——术语标准 §Download 的主术语是「下载」，指用户获取既有文件；本条是从系统生成内容，按 §Export 归入「导出」类。
- 导出 Markdown：UI 主术语「导出 Markdown」。把当前文章的 Markdown 原文生成为 `.md` 文件供用户取走。文件名格式 `lucy-help-<articleId>-YYYYMMDD-HHmmss.md`。
- 打印：UI 主术语「打印」。调起浏览器打印对话框，用户可自行「另存为 PDF」。**不做服务端 PDF 二进制**。
- 业务用户 / 数据管理员 / 接入开发者：三类读者的统一称谓，取代手册 §0 现有的「开发者／管理员／接入协作者」与 `docs/user-guide/` 的「业务用户／BI / 数据管理员／集成开发者」两套分叉。角色名统一到本 Spec §9 的一套。

产品名沿用「系统手册」。导航名、面包屑首页级统一为「系统手册」；「系统帮助」不再作为面包屑出现。Catalog、Manifest、Schema、MCP 调试台等沿用现有定义。含英文术语、路径、id 的 DOM 节点必须带 `translate="no"` 与 `notranslate`。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/14-components-filter-input.md`
- `webui/docs/design-system/00-principles.md`

### What This Change Follows

- [ ] 帮助首页为门户网格、分类页为列表页、文章页为三栏内容页，沿用 `20-patterns-page-layout.md` 既有页面模式，不新造第二套导航体系
- [ ] 文章页 PageHeader 可见动作 ≤ 3；「复制 Markdown」「打印」用 `pl-icon-btn` + 中文 `aria-label` + tooltip，「导出 Markdown」为 `secondary` 文案按钮
- [ ] 分类卡用产品图标与既有色板，不引入外链图片，不新增硬编码色值
- [ ] 搜索框沿用 `14-components-filter-input.md` 的受控输入与筛选控件约定，不新写输入样式
- [ ] 面包屑、卡片、空态、加载态复用既有组件规范；空态显式说明，不用空图冒充正常结果
- [ ] 打印样式走 `@media print`，不新增视觉模式

### Exceptions (If Any)

- None

### Follow-up Needed

- 「帮助门户网格 / 三栏文章页」的具体断点与栅格目前散见 `20-patterns-page-layout.md` 的通用描述，缺少针对帮助中心信息架构的专章。本期按通用模式实现；实现后如出现可复用的新模式，再在 `webui/docs/design-system/99-governance.md` 记录临时决策。

## 1. 背景

当前 `/help` 是单一长页面：`docs/SYSTEM_HANDBOOK.md` 共 3245 行、7 个 H2 章、48 个 H3、65 个 H4，`parseHelpToc()` 产出 120 个目录段，一次性整卷渲染。读者第一次进入面对 120 个平铺目录项，定位与阅读负担大。

手册自身已经承认这个缺口。§0「常见问题速查」（`:54`–`:101`）写明「本节是按用户问题组织的快速入口……完整操作以正文章节为准」——它把正文章节定位成查阅材料，却没有给出通往它的第一课。§2「快速上手」（`:246`–`:334`）只覆盖开发环境启动（Node 22／npm／`ktx mcp start`／`ktx.yaml`／manifest／reindex），不是「用 Lucy 干成一件事」的任务路径。

同时仓库里已存在第三套帮助载体 `docs/user-guide/`（19 页静态 HTML）。它已经有角色分叉首页（`index.html`「选择你的角色」）和一篇《5 分钟理解 Lucy》（`getting-started.html:64`），但**在产品内完全不可达**：`webui/src/app/App.tsx:579` 只有 `/help`；`webui/server/static-assets.ts` 只托管 Vite `dist/`；`webui/docs/user-guide.html` 是 meta-refresh 跳转桩且不在产品路径上；`webui/server/help.ts:20`–`:21` 只把其中两张架构图白名单化。它的链接检查与翻译防御脚本都躺在 `inbox/`，不在 `scripts/gates/`，CI 从不执行。

结论：读者缺一条从「我要干什么」到「做完看到什么」的路；仓库里那套最接近的载体没有产品入口、没有门禁、且与手册角色口径分叉。

## 2. 目标

1. 把帮助中心改造成门户形态：打开 `/help` 先看到「快速入门」入口与角色／分类导航，不必面对 120 个平铺目录项。
2. 快速入门作为**独立内容资产**存在，不塞进 3245 行手册正文，不与详细指南混在一起。
3. 详细指南保留全部内容与能力，作为「有时间慢慢学」的读物继续可读可搜。
4. 任意文章的 Markdown 可被复制或导出带走；打印走浏览器原生能力。
5. 旧深链 `/help?section=<旧 id>`（含 10 位哈希旧 id）零失效。

## 3. 非目标

| 非目标 | 原因 |
|---|---|
| 内容重写或扩写手册正文 | 手册继续由 `docs/SYSTEM_HANDBOOK.md` 单一事实源驱动，自动同步与 `etag` 机制不变 |
| 服务端 PDF 二进制生成 | 客户是 intranet-HTTP 离线交付形态，不得引入运行时渲染依赖与中文嵌入字体（§7.3） |
| 搜索分词或向量检索 | 本期沿用服务端子串匹配与现有排名；改匹配算法另立项 |
| 多语言版本 | 沿用浏览器翻译防御，不做多语言内容 |
| 反馈投票、在线客服、阅读行为分析 | 与 Lucy's 离线治理台形态冲突 |
| 把 `docs/user-guide/` 接入产品路由 | 该载体无搜索、无深链契约、门禁全在 CI 外（§9.1） |
| 新增任何权限、审计或配额语义 | 帮助内容公开可访问，不含运行数据 |
| 修改 `docs/SYSTEM_HANDBOOK.md` 的技术内容 | 本期只改 §0 的角色小标题与被指出的路径失效链接，不改任何配置示例、命令或口径 |

## 4. 已冻结决策

| 编号 | 决策 | 理由 |
|---|---|---|
| D1 | 新帮助中心**取代** `/help` 单页作为入口；单页降级为详细指南视图 `/help?view=full` | 全局 `?` 按钮只能有一个落点；两个帮助中心并存会让用户更困惑 |
| D2 | 快速入门是**独立内容资产** `docs/GETTING_STARTED.md`，与手册并列，由服务端白名单读取 | 快速入门与手册是两种读物，物理分开才能各自维护 |
| D3 | 快速入门**只写路径，不复述手册内容**。每条内容必须以深链指向手册 section id；不得在快速入门里复述手册的条件、配置字段、错误码 | 把「两份内容不一致」（不可自动检测）降级为「路径失效」（可被门禁自动检测） |
| D4 | `docs/user-guide/` 19 页**降级为迁移源**，按需迁入快速入门与手册后冻结归档，不接入产品路由 | 静态 HTML 载体做不出搜索、深链与 scrollspy；其门禁全在 CI 外；角色口径与手册分叉 |
| D5 | 角色名统一为**业务用户 / 数据管理员 / 接入开发者**，手册 §0 的三组小标题回改 | 身份分叉比职能分叉更贴近读者；§0 本来就按「读者是谁」组织 |
| D6 | 导出粒度：文章页复制／导出**本篇** Markdown；H4 小节可单独复制；代码块可复制命令片段；**不提供整本手册导出** | 整本 3245 行的导出没有使用价值 |
| D7 | PDF 走**浏览器打印**，不做服务端 PDF 二进制 | 离线交付形态不得引入运行时渲染依赖与中文字体 |
| D8 | 导出物**带来源标注**：章节 id、所属分类、导出时间、手册 `etag` 短前缀 | 用户复制走的内容一旦脱离上下文，来源锚点能让他回来核对；与 §0 速查表的「详见深链」是同一套机制 |
| D9 | 服务端返回**字节偏移量**而非重复正文，前端从已有 `markdown` 字段 slice | 重复传正文会让 handbook 响应体积翻倍 |
| D10 | 旧深链全部保留，`/help?section=<旧 id>` 落到对应文章位置，**零死链** | 旧 id 已被写进其他文档；历史深链静默失效是已发生过的缺陷类型 |
| D11 | 搜索**跨两本**：快速入门与手册合并索引，结果标注归属（快速入门／手册 › 分类 › 文章） | 用户不该知道内容在哪个文件里 |
| D12 | **公开可访问不变**：`/help` 及其全部内容无需登录可读 | 沿用现状，不因帮助中心改造引入登录要求 |
| D13 | 本期快速入门**只做「接入开发者」一条完整路径**（让 Agent 查到数）；另两类角色显式标注「本期未覆盖」，不留空白页冒充 | 先交付一条可验收的最短路径；空分类／未覆盖角色必须显式说明 |
| D14 | 跨文件深链门禁**并入既有 `npm run lint:handbook-anchors`**，不新增命令、不新增 CI job | 既有门禁已复刻 `SECTION_ID_CONTRACT`／`parseHelpToc` 规则，扩展比新建更省且不漏 |

## 5. 信息架构合同

### 5.1 路由

| 路由 | 页面 | 说明 |
|---|---|---|
| `/help` | 帮助首页（门户） | 快速入门入口 + 角色卡 + 分类卡网格 + 全文入口 |
| `/help/start` | 快速入门 | 独立短篇。`start` 是保留字，不得与派生出的 category id 冲突 |
| `/help/<categoryId>` | 分类页 | 面包屑 + 分类信息 + 文章卡列表 |
| `/help/<categoryId>?section=<articleId>` | 文章页 | 面包屑 + 正文 + 右侧「本页目录」（随滚动高亮） |
| `/help?section=<legacyId>` | 旧深链 | 解析后重定向到对应文章页；不静默失效、不出现死链 |
| `/help?view=full` | 详细指南（全文视图） | 保留原单页的平铺目录与全文阅读形态 |

`categoryId` 与 `articleId` 均取自手册标题派生的稳定 id，语义化，不使用哈希。

### 5.2 三层 IA 与手册结构的映射

沿用 L25-12 原草案 §3.1，并补两条本 Spec 新增的归属规则：

- **手册分类** = H2 章。现行 7 章映射为 7 个分类。
- **手册文章** = H3。每个分类下的 H3 是一篇文章。
- **小节** = H4。进入文章页右侧「本页目录」，不进分类树。
- 游离 H2 块归入其最近前置 H3 所属文章；无法归属的游离标题列为构建期检查失败，要求作者修正手册结构，**不猜默认分类**。
- **本条新增**：快速入门**不参与**手册分类派生。它是独立资产，在门户首页占据独立入口位，不出现在分类网格里，也不出现在手册的分类计数中。

### 5.3 分类元数据

分类卡片与分类页需要「一句话描述」和「文章数」。描述取该 H2 章引言首段（截取约定长度），不在手册外维护第二份描述表；文章数由派生 IA 实时计算。分类顺序即手册章节顺序，不另设排序配置。

### 5.4 深链与 id 契约

- id 语义不因 IA 改变而变化。`SECTION_ID_CONTRACT` 仍是手册 section id 的唯一事实源。
- 旧 id（含 `LEGACY_SECTION_IDS` 中的 10 位哈希）通过既有 `resolveLegacySectionId()` 解析后，必须落到一个有效文章位置。**哈希 id 无法从标题反推，只能靠映射表兜**，因此 V10 是必达项。
- 快速入门引用手册章节时，引用的是 `SECTION_ID_CONTRACT` 里的 id，不引用标题文本。

## 6. 页面合同

### 6.1 帮助首页

- 问候标题 + 说明副题（产品名沿用「系统手册」）。
- **首屏第一入口是快速入门**，带「5–10 分钟」量级提示。快速入门入口是一个显式区块，不是普通分类卡——它不是手册的一个章节。
- 角色卡：业务用户／数据管理员／接入开发者三张卡，点击进入对应角色在快速入门里的路径。**接入开发者**指向本期已实现路径；另两类指向「本期未覆盖」的显式说明页。
- 分类卡网格：分类名、一句话描述、文章数（「N 篇」）。卡片用产品图标与既有色板，不使用外链图片。
- 保留来源路径、更新时间、etag 徽章与「无需登录即可查看」说明，位置移至页脚信息区，不抢占首屏。

### 6.2 分类页

- 面包屑：系统手册 / 分类名。
- 分类标题、描述、文章数。
- 文章卡列表：文章名 + 首段摘要；摘要取文章正文首段，不另维护。
- 空分类（无 H3）显式说明，不用空页冒充。

### 6.3 文章页

- 面包屑：系统手册 / 分类名 / 文章名。
- 正文沿用 `MarkdownPreview` 渲染；架构图白名单（`HELP_DIAGRAM_IDS`）在文章页内继续可用。
- 右侧「本页目录」：该文章内 H4 小节锚点列表，随滚动高亮当前小节；短文章（可视高度内可读完）自动隐藏，不用空目录占位。
- 文末保留分类内上一篇／下一篇导航。
- PageHeader 右侧放导出与打印动作（见 §7）。

### 6.4 快速入门页

- 路径式排版，不是章节式：每条角色路径是一个带步骤编号的流程块。
- 每步三要素固定：**动作**（做什么）、**预期结果**（做完看到什么）、**失败出口**（卡住了去手册哪一节）。三要素缺一即为不合规。
- 每步末尾给出指向手册对应 section id 的深链。深链文案是该节的读者语言标题，不是 id 本身。
- 本期只实现接入开发者路径。另两类角色在页面上显式标注「本期未覆盖」，并指向分类页。
- 页面顶部标明量级（「约 8 分钟」）与所需前置（角色、访问条件）。

### 6.5 搜索

- 沿用服务端 `/api/help/search` 子串匹配与现有排名（标题命中加权、命中数、首现位置）。本期不改匹配算法。
- 结果展示：显示「找到 N 条相关结果」；每条结果标注归属路径（快速入门／手册 › 分类 › 文章）；结果按归属分组；保留关键词高亮；空态文案引导换关键词，不引导跳出帮助中心。
- 搜索入口：帮助首页居中；分类页／文章页在左侧栏。支持 Escape 清除、键盘可达。
- 搜索只命中手册正文与标题，不命中徽章、时间等界面元数据。**快速入门的正文与标题同样进入索引**。

## 7. 导出与打印合同

### 7.1 导出粒度与动作

| 动作 | 位置 | 行为 | 文案 |
|---|---|---|---|
| 复制 Markdown | 文章页 PageHeader | 当前文章 Markdown 原文写入剪贴板 | 「复制 Markdown」（`pl-icon-btn` + `aria-label` + tooltip） |
| 导出 Markdown | 文章页 PageHeader | 生成 `.md` 文件供用户取走 | 「导出 Markdown」（`secondary` 文案按钮） |
| 打印 | 文章页 PageHeader | 调起浏览器打印对话框 | 「打印」（`pl-icon-btn` + `aria-label` + tooltip） |
| 复制命令片段 | 正文代码块右上 | 复制该代码块内容 | 复制图标 + `aria-label`「复制命令」 |

- 三个页面级动作使 PageHeader 可见动作正好为 3，符合按钮规范的动作预算。
- 代码块复制是 `MarkdownPreview` 的能力扩展。当前 `MarkdownPreview` 无任何复制能力。
- **H4 小节单独复制**：文章页「本页目录」的每个小节条目带一个复制动作，复制该小节的 Markdown 原文切片。粒度依据是 §5.2 的小节 id。

### 7.2 导出物内容

```
<原文切片>

<!-- 来源：Lucy 系统手册 · <分类名> · <文章标题> · 导出于 YYYY-MM-DD HH:mm · etag sha256:<前 8 位> -->
```

- 原文切片取自手册 Markdown 原文，**不做改写、不做二次渲染**。
- 来源标注用 Markdown 注释：渲染时不可见，在源文件里可读。不用可见正文块，避免污染粘贴给 Agent 的上下文。
- 导出文件名：`lucy-help-<articleId>-YYYYMMDD-HHmmss.md`。快速入门用 `lucy-help-start-YYYYMMDD-HHmmss.md`。
- **不提供整本手册导出**（D6）。

### 7.3 PDF 边界

本期**不做**服务端 PDF 二进制。打印走浏览器原生能力：

- 页面提供 `@media print` 样式：隐藏侧栏、搜索框、面包屑、导出与打印按钮；只输出当前文章正文。
- 用户在打印对话框自行「另存为 PDF」。
- 理由：客户为 intranet-HTTP 离线交付形态。服务端 PDF 需要运行时渲染依赖（Playwright 当前是 devDependency，不可进客户镜像）与中文嵌入字体，收益不足以抵消镜像体积与离线可用性风险。
- 若将来需要真 PDF 二进制（例如离线发给客户、或进交付包），须**另立项**，单独评估运行时依赖、字体内嵌、镜像体积与离线验证。

### 7.4 剪贴板与失败语义

- 所有复制动作必须走既有共享 helper `webui/src/lib/clipboard.ts` 的 `copyTextWithToast`，**不得直接访问 `navigator.clipboard`**。原因：该文件注释已写明，Lucy 支持 intranet-HTTP 客户模式（`security.access=http`），该形态下 `navigator.clipboard` 为 `undefined`，直接访问会在 Promise 存在前抛 `TypeError` 而静默失败。
- 复制失败必须显式提示「复制失败，请手动选择文本」，不得静默。
- 成功态只有在文本真正到达剪贴板后才可展示。

### 7.5 离线与外部资源

- 帮助中心的样式、图标、插画全部本地化；完全离线环境可用；工程门禁检查帮助中心无外部请求。

## 8. 快速入门内容合同

### 8.1 写作规则

- **长度**：单条路径总时长控制在 5–10 分钟，页面顶部标注量级与预估。步骤数 4–7。
- **每步三要素**：动作、预期结果、失败出口。缺一不合规。
- **只指向不复述**（D3）：快速入门不写配置字段、不写完整命令、不写错误码原文。需要这些时给出手册深链。
- **以结果为导向**：步骤措辞说明「做完会看到什么」，而不是「执行哪个命令」。
- 快速入门自身的 id 空间独立，不占用 `SECTION_ID_CONTRACT`（那是手册的 id 事实源）。

### 8.2 本期范围

本期只实现「接入开发者」路径：**让 Agent 查到数**。路径覆盖从取得访问凭据到 Agent 返回第一个业务查询结果。业务用户与数据管理员两条路径在页面上显式标注「本期未覆盖」。

### 8.3 写作蓝本

`docs/user-guide/getting-started.html`（《5 分钟理解 Lucy》）与 `docs/user-guide/quickstart-admin.html` 是内容蓝本。迁移时按 §8.1 规则重写为路径式，不逐句搬运 HTML 文本；HTML 载体按 D4 冻结归档。

## 9. `docs/user-guide/` 迁移处置与角色名统一

### 9.1 现状缺口

| 缺口 | 事实 |
|---|---|
| 产品内不可达 | `App.tsx:579` 只有 `/help`；`static-assets.ts` 只托管 Vite `dist/`；`webui/docs/user-guide.html` 是 meta-refresh 桩且不在产品路径上；`help.ts:20`–`:21` 只白名单化其中两张架构图 |
| 门禁不在 CI | 链接检查脚本在 `inbox/check-user-guide-links.mjs`，翻译防御脚本在 `inbox/user-guide-d1/`；`scripts/gates/` 无任何 user-guide 门禁；`package.json` 与 `.github/` 搜不到引用 |
| 角色口径分叉 | user-guide 用「业务用户／BI·数据管理员／集成开发者」；手册 §0 用「开发者／管理员／接入协作者」 |
| 维护停滞 | 最后实质维护 2026-10-20（`9780d0ad`／`687eea93`／`f6532b40`），此后只跟版本号 |

### 9.2 处置

- 归档：保留 `docs/user-guide/` 目录不删（`help.ts` 的两张架构图仍从该目录读取），在 `docs/user-guide/README.md` 标注「已冻结归档，非产品帮助载体」。
- **不接入产品路由**：不新增静态托管，不新增菜单入口。
- 迁移：仅把 §8.3 指定的两页作为写作蓝本；其余页面不迁移。
- 迁移后**不保留第二份 HTML 帮助正文**——否则重新制造双事实源。

### 9.3 角色名统一

- 手册 §0 的三组小标题由「0.1 面向开发者／0.2 面向管理员／0.3 面向接入协作者」回改为「0.1 面向业务用户／0.2 面向数据管理员／0.3 面向接入开发者」。
- §0 表格内的问句措辞按新角色名做最小必要调整，**技术口径、答案与深链不改**。
- 全文其他位置的角色称谓按 §4 D5 对齐；改不动或会改变技术含义的表述保留原文并在评审记录里说明。

## 10. 数据模型草案

在 `HelpHandbook` 响应上扩展派生字段（示意，最终以实施 Plan 为准）：

```text
HelpHandbook {
  ...现有字段不变（id/title/sourcePath/updatedAt/etag/toc/legacySectionMap/markdown）
  categories: HelpCategory[]
  quickStart: HelpArticle
  sectionSpans: Record<string, { start: number; end: number }>
}

HelpCategory {
  id            # H2 章派生的稳定 id
  title         # H2 章名（去编号）
  summary       # 章引言首段截取
  articles: HelpArticle[]
}

HelpArticle {
  id            # 沿用 SECTION_ID_CONTRACT 稳定 id
  title         # H3 名（去编号）
  summary       # 正文首段截取
  sectionIds    # 文内 H4 小节 id 列表（本页目录数据源）
}

HelpSearchItem {
  ...现有字段不变（sectionId/title/snippet）
  docKind       # "handbook" | "quickstart"
  categoryId    # 手册命中时为所属分类；快速入门命中时为空
  categoryTitle # 手册命中时为所属分类标题；快速入门命中时为空
}
```

- `sectionSpans` 是**字节偏移量**，前端据此从已有 `markdown` 字段 slice 原文，零额外载荷（D9）。
- 快速入门作为独立资产读取，不复用 `SECTION_ID_CONTRACT`；其自有 id 以 `quickstart` 前缀命名空间隔离。
- 以上均为只读派生，无写路径。

## 核心流程（伪代码）

### A. 三层 IA 派生与偏移量

```text
deriveHandbookIA(markdown, toc) -> { categories, articles, sectionSpans }

输入:
  markdown: string        # 手册原文
  toc: HelpTocItem[]      # parseHelpToc(markdown) 的结果，level 2/3/4
输出:
  categories: HelpCategory[]
  articles:   HelpArticle[]
  sectionSpans: Map<sectionId, {start, end}>   # 字节偏移，供前端 slice

算法:
  1. 扫描 markdown，跳过代码围栏（``` 之间的行不算标题），记录每个标题的
     (level, titleText, startOffset)。
  2. 对每个 H2：
       a. 建立一个 category，id = sectionIdFor(H2 去编号标题)。
       b. 遍历 H2 与下一个 H2 之间的所有标题：
            - H3 → 建一个 article，id = sectionIdFor(H3 去编号标题)，
                    summary = 该 H3 正文首段（跳过标题行与空行，截断到约定长度）。
                    article 挂到当前 category。
            - H4 → 记入当前 article 的 sectionIds；不建独立 article。
       c. 遇到「游离 H2」（不在 toc.level==2 集合里的 H2）：
            - 若其最近前置 H3 存在 → 该 H2 块归入该 article 的正文尾部。
            - 若不存在 → 归属失败，记入 orphanHeadings，返回构建期失败。
  3. 为每个 article 计算正文切片：
       start = 该 article 的 H3 标题偏移
       end   = 同 category 内下一 article 的 H3 偏移；若无下一 article，
               end = 下一个 H2 的偏移；若无下一 H2，end = markdown.length
       sectionSpans[article.id] = { start, end }
       同时对每个 sectionId（小节）计算同样的 span，
       sectionSpans[sectionId] = { start: H4 偏移, end: 该 H4 之后的
                                   下一个标题偏移或所属 article 的 end }
  4. 分类的 articleCount = len(category.articles)。
  5. 若 orphanHeadings 非空 → 抛错，不产出部分 IA（不猜默认分类）。
```

### B. 路由解析与旧深链兼容

```text
resolveHelpRoute(pathname, searchParams) -> HelpRoute

输入:
  pathname: string
  searchParams: { section?: string, view?: string }
输出:
  { kind: "home" | "quickstart" | "category" | "article" | "legacy" | "full",
    categoryId?, articleId?, targetSectionId? }

算法:
  1. 若 pathname == "/help/start"          → { kind: "quickstart" }
  2. 若 pathname 匹配 "/help/<segment>"：
       a. categoryId = segment
       b. 若 searchParams.section 存在：
            → 解析该 id：先查 sectionSpans，命中即为 articleId
              （文章页）；否则查 LEGACY_SECTION_IDS 映射到规范 id 后重查；
              再否则视为无效 id → 返回 { kind: "notfound" }
            → { kind: "article", categoryId, articleId }
       c. 否则 → { kind: "category", categoryId }
  3. 若 pathname == "/help"：
       a. 若 searchParams.view == "full" → { kind: "full" }
       b. 若 searchParams.section 存在：
            → 解析该 id（同 2.b 的解析顺序）
            → 命中 → { kind: "legacy", targetSectionId }（由前端重定向到
              /help/<categoryId>?section=<articleId>）
            → 未命中 → { kind: "notfound" }
       c. 否则 → { kind: "home" }
  4. 任何未命中情形 → { kind: "notfound" }；不静默回落到首页
     （静默回落会让死链看起来是正常的，是已发生过的缺陷类型）。
```

### C. 导出物生成

```text
buildExportPayload(kind, targetId, source) -> { fileName, content }

输入:
  kind: "article" | "section" | "quickstart"
  targetId: string
  source: { markdown, sectionSpans, etag, categoryTitle, articleTitle }
输出:
  fileName: string
  content:  string

算法:
  1. span = sectionSpans[targetId]
     若 span 不存在 → 抛错（导出物必须来自服务端给出的 span，
     前端不得自行猜测切片边界）。
  2. body = source.markdown.slice(span.start, span.end)
  3. stamp = 形如 "2026-10-31 14:05" 的本地时间戳。
  4. 标注 = "<!-- 来源：Lucy 系统手册 · " + categoryTitle + " · "
           + articleTitle + " · 导出于 " + stamp
           + " · etag sha256:" + source.etag.slice(-8) + " -->"
     （快速入门时 categoryTitle 用 "快速入门"）
  5. content = body + "\n\n" + 标注
  6. fileName = "lucy-help-" + (kind == "quickstart" ? "start" : targetId)
               + "-" + YYYYMMDD + "-" + HHmmss + ".md"
  7. 返回 { fileName, content }。
```

### D. 复制动作（前端）

```text
async function copyMarkdown(targetId) {
  1. span = sectionSpans[targetId]；不存在 → 提示"该内容暂不可复制"，返回。
  2. payload = buildExportPayload(...)。content 取其 content 字段
     （复制与导出共用同一份内容构造，保证两者一致）。
  3. result = await copyTextWithToast(content, { successMessage: "已复制 Markdown" })
  4. 仅当 result === true 时展示成功态；否则 helper 已提示
     "复制失败，请手动选择文本"，不得额外声明成功。
}
```

## 11. 门禁

| 门禁 | 检查内容 | 处置 |
|---|---|---|
| `npm run lint:handbook-anchors`（既有，**扩展**） | ① 手册内部锚点有效性 ② 手册 TOC 可达性（既有）③ **新增**：`docs/GETTING_STARTED.md` 里每条指向手册的深链 id 必须在 `SECTION_ID_CONTRACT` 中存在，且对应 article／section 在派生 IA 中可达 | 违反即失败。不新增命令、不新增 CI job（D14） |
| `npm run lint:terminology`（既有） | 新增术语登记（快速入门／详细指南／复制 Markdown／导出 Markdown／打印／三类角色名）未登记即失败 | 违反即失败 |
| `npm run lint:spec-docs`（既有） | 本 Spec 与 Plan 的文档形态 | 见 §13 落盘清单 |
| `npm run lint:ia-boundary`（既有） | 路由与 API 边界 | 违反即失败 |

新增门禁不单独登记到 `docs/governance/test-layers-and-release-gates.md`，因为 D14 决定不新增命令；既有命令的检查范围扩展在 §11 表内说明。

## 12. 验证机制与验收矩阵

未来实施分三层：`help.ts` IA 派生与导出物单元测试；API 集成测试（handbook 扩展字段、搜索跨两本、旧深链映射）；授权后的桌面浏览器用户旅程验证。本次只做文档设计，**以下全部为未执行**。

每项证据保存测试编号、候选产品版本、构建提交／dirty 状态、输入手册版本（etag）与结果。`passed / failed / not_run` 分开登记。

| 编号 | 场景 / 必须断言 | 状态 |
|---|---|---|
| SC-01 | 手册 7 章派生为 7 分类；每篇 H3 落在唯一分类；分类／文章／小节计数与手册标题结构一致 | 未执行 |
| SC-02 | 游离 H2 块归入所属文章，不生成孤儿页面；人为造游离块时派生失败而非猜默认分类 | 未执行 |
| SC-03 | 分类卡文章数 = 分类页列表数 = 派生计数；三处同源 | 未执行 |
| SC-04 | 快速入门作为独立资产被单独读取；其 id 空间不与 `SECTION_ID_CONTRACT` 冲突 | 未执行 |
| SC-05 | 快速入门每条手册深链 id 在 `SECTION_ID_CONTRACT` 中存在，且目标在派生 IA 中可达 | 未执行 |
| SC-06 | 快速入门每个步骤块同时含「动作」「预期结果」「失败出口」三要素；缺任一项即失败 | 未执行 |
| SC-07 | 帮助首页：快速入门入口、角色卡、分类卡网格齐备；角色卡文章数与分类页一致；无外部资源请求 | 未执行 |
| SC-08 | 分类页：面包屑、文章卡摘要正确；空分类显式说明，不用空页冒充 | 未执行 |
| SC-09 | 文章页：本页目录小节锚点可点击可滚动定位，scrollspy 高亮与可视小节一致 | 未执行 |
| SC-10 | 现行全部 `LEGACY_SECTION_IDS` 旧深链（含 10 位哈希 id）落到有效文章位置，零死链 | 未执行 |
| SC-11 | `/help?view=full` 全文视图仍可访问，保留平铺目录与全部正文 | 未执行 |
| SC-12 | 搜索「401」：结果显示计数、归属路径（快速入门／手册 › 分类 › 文章）与关键词高亮；空查询与无结果态正确 | 未执行 |
| SC-13 | 复制 Markdown：剪贴板内容 = 原文切片 + 来源标注；内容与导出文件逐字节一致 | 未执行 |
| SC-14 | 无 Clipboard API（intranet-HTTP 形态）时降级到 `execCommand`；两者都失败时显式提示，不静默 | 未执行 |
| SC-15 | 导出 Markdown：文件名符合 `lucy-help-<id>-YYYYMMDD-HHmmss.md`；文件内容与 SC-13 一致 | 未执行 |
| SC-16 | 打印：print 样式隐藏侧栏／搜索／面包屑／导出按钮，只输出当前文章正文 | 未执行 |
| SC-17 | 代码块复制命令片段；复制内容为代码块原文，不含行号或提示符 | 未执行 |
| SC-18 | 角色名统一：手册 §0 三组小标题 = 业务用户／数据管理员／接入开发者；全文无残留旧称谓 | 未执行 |
| SC-19 | 离线环境（断网）帮助首页、快速入门、分类、文章、搜索全部可用；无外部请求 | 未执行 |
| SC-20 | 翻译防御：分类名／文章名／路径含英文术语的节点带 `translate="no"` 与 `notranslate` | 未执行 |

### 完成判定

三层 IA 派生正确、旧深链零失效、快速入门路径可走通、导出内容与原文一致、离线可用与翻译防御为必达项；SC-01–SC-20 全部未执行前不登记实现完成。本文件不新增当前发布门禁。

## 13. 风险

| 风险 | 缓解 |
|---|---|
| 快速入门复述手册内容，制造第二事实源 | D3 硬规则；SC-06 结构检查；跨文件深链门禁（SC-05） |
| 快速入门路径与手册实际行为不一致 | 路径步骤只写「动作 + 预期结果 + 深链」，技术细节一律在手册；SC-05 保证链接可达 |
| 旧深链静默失效 | `LEGACY_SECTION_IDS` 由 SC-10 固化；解析失败返回 `notfound` 而非静默回落首页 |
| 10 位哈希 id 无法从标题反推 | 只能靠 `LEGACY_SECTION_IDS` 映射表兜；该表是必达项的一部分，改标题时须同步 |
| user-guide 冻结后仍被人当事实源编辑 | 在 `docs/user-guide/README.md` 标注归档状态；架构图白名单仍从该目录读取，需保留最小可维护说明 |
| 手册 §0 角色名回改影响既有深链与问答措辞 | §0 小标题是 H3，回改会改 id；须在同一次改动里同步契约表与所有引用该 id 的深链，并跑 SC-18 与锚点门禁 |
| 导出物脱离上下文后失去可核对性 | D8 来源标注（含章节 id 与 etag 短前缀） |
| 打印样式与屏幕样式耦合 | print 样式独立作用域，不改屏幕布局 |
| 离线环境剪贴板 API 不可用 | 复用既有 `clipboard.ts` 降级链；SC-14 固化 |
| 门户网格与三栏文章页缺少专门设计规范章 | 本期按通用页面模式实现；超出部分按 `99-governance.md` 记录临时决策 |

## 14. 与 L25-12 原草案的关系

| 事项 | 原草案 | 本 Spec |
|---|---|---|
| 状态 | 待评审，暂不开发 | **被本 Spec 取代，不得实施** |
| 三层 IA 派生 | §3.1 | 沿用（§5.2） |
| 分类元数据 | §3.2 | 沿用（§5.3） |
| URL 与深链 | §3.3 | **由 §5.1 取代**（新增 `/help/start`、`/help?view=full`，旧深链规则不变） |
| 页面合同 | §4 | 扩编（§6）：新增快速入门页、导出与打印、角色卡 |
| 数据模型 | §6 | 扩编（§10）：新增 `quickStart`、`sectionSpans`、`docKind` |
| 风险 | §7 | 扩编（§13） |
| 验证矩阵 | §9，V01–V12 | **由 §12 的 SC-01–SC-20 取代**（编号体系按「功能闭口与发布取证」统一为 `SC-`） |
| 快速入门独立资产 | 无 | **新增（§8）** |
| 导出与打印 | 无 | **新增（§7）** |
| user-guide 处置 | 无 | **新增（§9）** |
| 角色名统一 | 无 | **新增（§9.3）** |
