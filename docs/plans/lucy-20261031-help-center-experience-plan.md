# Lucy 帮助中心体验实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.5** / 2026-11-19（原 v0.4／2026-11-19） |
| 目标版本 / 优先级 | `0.30.0`／**P2**（清单 P2-2；**不入**问数核心分母） |
| 主 Spec | [Lucy 帮助中心体验 Spec](../specs/lucy-20261031-help-center-experience-spec.md)（**v0.5-draft**） |
| 台账号 | **L25-12** → 池 **P2-2／REQ-030-002**。历史挂 v0.25 升级台账（[`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](2026-10-18-lucy-2.5-upgrade-proposal.md) §2.6） |
| 需求来源 | 2026-10-31 Forrest：快速入门＋详细指南分册、门户式帮助中心、可复制带走（**2026-11-19 起首页形态改为概览内容页，D17 已裁决**）。**2026-11-16 委托人选方案 B**：开线时门户／快速入门必须深链「直连 vs Lucy」+「语义配置杠杆」（Spec D15／SC-21）。**2026-11-19 委托人修正对标对象**为 `https://www.kimi.com/code/docs/`（新增 D16／D18）；**并明示 MD 标配**——「复制 Markdown」升级为标准动作（D21／SC-26），据此解除 D6 的整本导出限制。**2026-11-19 委托人裁决 D17**：首页参照 `https://www.kimi.com/code/docs/` ＋ `https://docs.kaelio.com/ktx/docs/getting-started/quickstart` 采用概览内容页形态；**并明示两项候选都要纳入**（D19 错误参考章、D20 逃逸出口；SC-24／SC-25） |
| 状态 | **`0.30.0` 池 P2-2／[`REQ-030-002`](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)**：与主 Spec 同为 **v0.5-draft**，**待评审、未授权实现**。本轮不实施、不开工。S0–S6 未执行，SC-01–SC-26 未执行。记录见 [A／B 剥离](../reviews/2026-11-03-product-close-peel-a-b.md)；总账 v1.57 |
| 授权边界 | **不授权开发、不授权改代码、不授权改手册正文、不授权部署。** 评审通过并另行授权后方可开工；D1–D21 冻结状态须在评审时与主 Spec 统一（D15–D21 已由委托人明示） |
| 验收 | SC-01–SC-26。**全部未执行**。执行须在开发授权后，且只在主 Spec §12 的三层验证范围内 |
| 实施主体 | Lucy WebUI。不改 KTX 源码，不新增数据库表，不新增运行时能力，不引入外部服务 |
| 已拍板决策 | D1–D14（2026-10-31）；**D15 方案 B（2026-11-16）**；**D16／D18（2026-11-19，对标对象修正）**；**D17（2026-11-19，首页形态已裁决＝概览内容页）**；**D19／D20（2026-11-19，两项候选纳入）**；**D21（2026-11-19，MD 标配：复制 Markdown 成为标准动作，解除 D6 整本限制）**。其余 D1–D14 仍为草案，评审时统一冻结口径 |
| 待确认 | 评审时统一 D1–D14「草案 vs 冻结」表述；指定 **D15 手册专节、D19 错误参考章**与 `GETTING_STARTED` 课前步的内容 owner；确认错误参考章的错误类划分与首版覆盖的码清单 |
| 与既有 Plan 的关系 | **取代** L25-12 原草案（无对应 Plan，原草案未产出 Plan）。不改其它条目的 Plan |

## 1. 目标

把 `/help` 从「3245 行单页 + 120 段平铺目录」改造成**概览式帮助首页 ＋ 三层 IA**，并让「快速入门」成为独立读物。

五个交付物：

1. **概览式帮助首页与三层 IA**（S2）——帮助首页按 **D17 已裁决的概览内容页形态**（定位句 + 快速入门首屏第一入口 + D15 显性深链 + 三类角色分流卡 +「开始使用」两入口 +「下一步」清单 + 分类清单 + 现成环境旁路 + 页脚信息区）、分类页、文章页、详细指南全文视图；**首屏含 D15 显性深链**。
2. **快速入门独立资产**（S1、S3）——`docs/GETTING_STARTED.md` 作为第二份只读资产被读取与呈现；写法按 KTX Quickstart 的任务路径形态（每步＝动作 ＋ **真实输出** ＋ **可执行恢复命令**）；本期只实现「接入开发者：让 Agent 查到数」一条路径；**最前部含 D15 课前必读深链**；另两类角色按 **D20** 给出站内下一步去向。
3. **手册 D15 专节与 D19 错误参考章**（内容活，与 S1 同批）——`SYSTEM_HANDBOOK` §0 置顶 FAQ +「直连 vs Lucy」对照 +「语义配置杠杆清单」；**新增「错误参考」章**：H3＝错误类，H4＝单条错误码条目，每条五要素（机器码 ＋ 含义 ＋ 现象 ＋ 可执行下一步 ＋ 兜底路径），机器码必须命中既有登记册。只为本主题扩写，遵守 Spec §3 例外。
4. **MD 标配：复制与导出**（S4）——「复制 Markdown」作为**标准动作**覆盖文章页／快速入门页／分类页／全文视图四处（D21，标题下方显式文案动作）；导出物一律 `.md`；分类页可导出整类、全文视图可导出整本；代码块复制命令片段；浏览器打印。
5. **兼容与收口**（S5、S6）——旧深链零失效、角色名统一、`docs/user-guide/` 冻结归档、跨文件深链门禁（含 D15 id）、**错误参考机器码一致性门禁**（D19）。

实施原则：

- **单一事实源不破**：手册正文继续只由 `docs/SYSTEM_HANDBOOK.md` 驱动；快速入门**只写路径不复述内容**（Spec D3），把内容漂移风险从「两份文本不一致」降级为「深链失效」，后者可被门禁自动检测。
- **服务端给边界，前端不猜**：导出切片只取服务端 `sectionSpans` 给出的字节偏移（D9），前端不得自行推断正文边界。
- **离线不降级**：不引入任何运行时渲染依赖、CDN 资源或外部字体（Spec D7、§7.5）。
- **旧链接零失效**：旧 id（含 10 位哈希）必须落到有效文章位置；解析失败显式 `notfound`，不静默回落首页。

## 2. 开工前置

开工前必须全部满足。任一项不满足即不得进入 S1。

| # | 前置 | 判据 | 状态 |
|---|---|---|---|
| P1 | 主 Spec 评审通过并冻结版本 | Spec 头部「状态」改为已冻结版本号，且登记评审记录；**D1–D21 全部冻结**（D15–D21 已由委托人明示，评审只需确认 D1–D14 的草案口径） | **未满足** |
| P2 | 获得开发授权 | PM 明确授权按本 Plan 的 S1–S6 改代码；本 Plan 的「授权边界」同步更新 | **未满足** |
| P3 | 确认 `docs/GETTING_STARTED.md`、**D15 手册专节**与 **D19 错误参考章**的写作负责人 | 快速入门、D15 专节与错误参考章是内容活，不是代码活；须指定 owner 与交付时限；未落盘不得宣称 SC-21／SC-24 可测。错误参考章还需在 S0 确认**首版覆盖的码清单**（从既有登记册里选，不新造码） | **未满足** |
| P4 | 确认手册 §0 角色名回改的连带影响面 | §0 三组小标题是 H3，回改会改 section id；须先扫出全部引用该 id 的深链 | **未满足** |
| P5 | 确认 `docs/user-guide/` 的架构图仍需保留 | `help.ts:20`–`:21` 的 `HELP_DIAGRAM_IDS` 从该目录读取；冻结归档不等于删目录 | **未满足** |
| P6 | 确认基线与分支状态 | 共享工作区有并发会话在途改动；开工前须确认 `git status` 与目标文件归属，避免覆盖他人登记型文件 | **未满足** |

### 2.1 开工前置的取证方法

P4 不得靠人工通读。执行方式：

```bash
# §0 三组小标题的当前 id 与全部引用
rg -n '面向开发者|面向管理员|面向接入协作者' docs/ webui/ --glob '!**/node_modules/**'
```

引用清单须在 S1 之前产出并随改动一起同步契约表。**只改小标题不同步契约表，就是把死链写进产品**——这是已经发生过的缺陷类型。

## 3. 现状依赖与文件落点

### 3.1 复用

| 复用项 | 位置 | 用途 |
|---|---|---|
| 手册读取与白名单 | `webui/server/help.ts:6` `HANDBOOK_REL_PATH`、`assertHelpAppReadable()` (`:354`) | 快速入门沿用同一读取与安全边界，不新开任意 path |
| section id 契约 | `webui/server/help.ts:36` `SECTION_ID_CONTRACT` | 手册 id 唯一事实源；快速入门引用它，不新建 |
| 旧 id 映射 | `webui/server/help.ts:180` `LEGACY_SECTION_IDS`、`resolveLegacySectionId()` (`:226`) | 旧深链解析 |
| 正文切分 | `webui/server/help.ts:518` `splitHandbookSections()` | 扩展为派生 article／section 偏移量 |
| 搜索 | `webui/server/help.ts:581` `searchHelpMarkdown()`、`/api/help/search` | 扩展为跨两本索引 |
| 剪贴板 | `webui/src/lib/clipboard.ts` `copyTextWithToast()` | 所有复制动作唯一入口（含 intranet-HTTP 降级） |
| Markdown 渲染 | `webui/src/components/MarkdownPreview.tsx` | 正文渲染；补代码块复制 |
| 页面骨架 | `webui/src/pages/HelpCenter.tsx`、`webui/src/app/App.tsx:579` | 路由与页面壳 |
| 手册门禁 | `scripts/gates/handbook-anchor-gate.mjs` | 扩展跨文件深链检查，不新建命令 |
| 设计规范 | `webui/docs/design-system/20-patterns-page-layout.md`、`10-components-button.md`、`14-components-filter-input.md` | 概览内容页／三栏页／按钮／搜索框 |

### 3.2 计划修改文件

| 文件 | 动作 | 阶段 |
|---|---|---|
| `docs/GETTING_STARTED.md` | **新增**。快速入门正文 | S3 |
| `webui/server/help.ts` | 白名单加快速入门；导出 `splitHandbookSections`；IA 派生；`sectionSpans`；搜索跨两本 | S1 |
| `webui/server/index.ts` | `/api/help/handbook` 响应扩展；搜索响应扩展 | S1 |
| `webui/src/pages/HelpCenter.tsx` | 拆为概览首页／分类页／文章页／快速入门页／全文视图；路由解析 | S2 |
| `webui/src/pages/HelpCenter/`（新目录） | 按视图拆组件：概览首页（含「下一步」清单与分类清单）、分类页、文章页、本页目录、快速入门 | S2 |
| `webui/src/components/MarkdownPreview.tsx` | 代码块复制按钮 | S4 |
| `webui/src/lib/clipboard.ts` | 不改。复用 | — |
| `webui/src/app/App.tsx` | `/help` 路由与子路由注册 | S2 |
| `webui/src/app/app.css` | 概览内容页、三栏文章页、print 样式 | S2、S4 |
| `webui/src/__tests__/help-center*.test.tsx` | 组件测试 | S2、S4 |
| `webui/server/__tests__/help.test.ts` | 服务端 IA 派生、导出物、旧深链测试 | S1 |
| `scripts/gates/handbook-anchor-gate.mjs` | 扩展跨文件深链检查 | S6 |
| `scripts/gates/handbook-anchor-gate.test.mjs` | 扩展门禁自身测试 | S6 |
| `docs/SYSTEM_HANDBOOK.md` | **仅** §0 三组小标题回改与随之失效的深链（S5）＋ **新增「错误参考」章**（S3 起草、S5 落盘核对） | S3、S5 |
| `docs/user-guide/README.md` | **新增**。标注冻结归档 | S5 |
| `webui/docs/00-product-terminology-standard.md` | 登记新术语（快速入门／详细指南／复制 Markdown／导出 Markdown／打印／三类角色名） | S5 |

### 3.3 明确不改

- `docs/user-guide/*.html` 正文（19 页）——冻结归档，不迁移全文。
- `webui/docs/user-guide.html` 跳转桩——保留原样，不接入产品路由（D4）。
- `docs/SYSTEM_HANDBOOK.md` 的技术内容、配置示例、命令、度量口径——本功能只改 §0 小标题与被指出的失效深链。
- `webui/server/help.ts` 的 `assertHelpAppReadable()` 安全边界——只扩白名单常量，不放宽 path 校验。
- 术语标准的既有行——只新增，不改写既有登记。

## 4. 阶段

阶段顺序不可交换。S1 未完成不得做 S2（前端要消费的字段还不存在）。

### S0 文档与门禁准备（不改产品代码）

- 目标：把后续阶段要用的契约先落定，避免实现期反复改契约表。
- 内容：
  - 产出 §2.1 的 §0 小标题引用清单。
  - 在 `SECTION_ID_CONTRACT` 草案里预留快速入门自有的 id 命名空间（不占用手册 id）。
  - 与写作负责人对齐快速入门路径骨架（步骤数、每步三要素、深链目标章节）。
  - **确认错误参考章的错误类划分与首版码清单**（D19）：码必须从既有登记册里选——术语标准已登记的裁决／拒绝码，或 `webui/server/proxy/audit-trace-span.ts` 的 `REASON_CODES`；**不新造码**。同时确认门禁脚本读取这两个登记册的解析方式。
- 出口：引用清单与 id 命名空间草案就绪；错误参考码清单与门禁解析方式确认。
- 授权：本阶段属 Spec 范畴，随 Spec 评审一并做，不需要额外开发授权。

### S1 服务端：IA 派生与第二资产

- 目标：服务端提供门户与导出所需的全部派生数据。
- 内容：
  - `help.ts` 白名单常量扩为 `{ handbook, quickStart }` 两个固定路径；沿用 `assertHelpAppReadable`。
  - 实现 Spec 核心流程 A（三层 IA 派生 + `sectionSpans` 字节偏移）。
  - `splitHandbookSections()` 导出并复用。
  - 搜索扩为跨两本索引，结果带 `docKind` 与 `categoryId`／`categoryTitle`；归属路径升级为**锚点级四段**（Spec D18），小节级命中可点落到文章内锚点。
  - 实现 Spec 核心流程 C（导出物构造）。
- 出口：SC-01、SC-02、SC-03、SC-04、SC-05（服务端部分）、SC-10（解析部分）、SC-12（服务端部分）通过。
- 不做：不改前端；不改手册正文。

### S2 前端：概览式帮助首页与三层页面

- 目标：把 `/help` 改成概览内容页，并落地分类页与文章页。
- 内容：
  - 实现 Spec 核心流程 B（路由解析）与 D（复制动作，复制部分等 S4 的服务端字段就绪）。
  - 帮助首页：**按 D17 已裁决的概览内容页形态落地**——定位句、快速入门首屏第一入口、首屏 D15 深链、三类角色分流卡、「开始使用」两条入口、「下一步」清单、分类清单、现成环境旁路、页脚信息区。
  - 分类页、文章页（三栏 + 本页目录 + scrollspy）、全文视图 `?view=full`。
  - 旧深链重定向到文章页。
  - 样式与 print 媒体查询骨架。
- 出口：SC-07、SC-08、SC-09、SC-11、SC-19（前端部分）、SC-22、SC-23 通过。
- 风险控制：概览内容页与三栏页遵循既有页面模式，不新造导航体系；按钮动作预算 ≤ 3。

### S3 内容与呈现：快速入门 ＋ 错误参考章

- 目标：交付第一条完整路径（接入开发者：让 Agent 查到数）与错误参考章。
- 内容：
  - 撰写 `docs/GETTING_STARTED.md`。每步三要素齐备，且按 KTX Quickstart 的任务路径写法：**预期结果给真实输出**、**失败出口给可执行恢复命令**；页面标注量级与前置条件。
  - 写作蓝本：`docs/user-guide/getting-started.html`、`quickstart-admin.html`。按 Spec §8.1 重写，不逐句搬运 HTML。
  - 快速入门页渲染与深链跳转；整篇「复制 Markdown」。
  - 另两类角色显式标注「本期未覆盖」，**并按 D20 给出站内下一步去向**（最相关的手册分类或错误参考章）。
  - **起草手册「错误参考」章**（D19）：H3＝错误类，H4＝单条错误码条目；每条五要素（机器码 ＋ 含义 ＋ 用户看到的现象 ＋ 可执行下一步 ＋ 兜底路径）；机器码取自 S0 确认的码清单，不新造码；章首「快速查找」表；写明「客户端可能重包装错误，按错误文本关键词匹配」。
- 出口：SC-06 通过；SC-04、SC-05 的呈现部分通过；SC-24、SC-25 通过。
- 风险控制：路径里每条技术细节都指向手册；写不出来就说明手册缺该节，走 S5 补手册，不在快速入门里就地编造。错误参考章只写登记册里已有的码，其余留给后续版本。

### S4 MD 标配：复制与导出

- 目标：帮助内容以 Markdown 为标准交换格式，**四处载体页都能被复制／导出带走**（D21）。
- 内容：
  - 实现 Spec 核心流程 C、D 的前端部分（含 D21 的五种作用域：`article`／`section`／`quickstart`／`category`／`handbook`）。
  - **「复制 Markdown」标准动作**：文章页、快速入门页、分类页、全文视图**四处**都在标题下方放显式文案动作（`secondary`，非 `primary`）；**不占 PageHeader 动作预算**。
  - PageHeader 保留「导出 Markdown」「打印」（可见动作 = 2 ≤ 3）。
  - **整类导出**：分类页可导出该分类全部文章（按手册原序拼接，篇间 `---` 分隔，各篇保留来源标注）。
  - **整本导出**：全文视图可导出整本手册——内容＝白名单读取的**同一份** `docs/SYSTEM_HANDBOOK.md` 原文；**零新增服务端载荷**（复用已有 `markdown` 字段与 `sectionSpans`，不新增响应字段、不让体积翻倍，与 D9 一致）。
  - 代码块复制命令片段。
  - H4 小节单独复制（与「本页目录」条目对应）。
  - print 样式：隐藏侧栏／搜索／面包屑／导出按钮，只输出当前文章正文。
  - 复制统一走 `clipboard.ts`；失败显式提示。
- 出口：SC-13、SC-14、SC-15、SC-16、SC-17、SC-26 通过。

### S5 兼容、角色名与 user-guide 处置

- 目标：旧深链零失效、角色名统一、user-guide 冻结。
- 内容：
  - 手册 §0 三组小标题回改为业务用户／数据管理员／接入开发者；同步契约表与全部引用（按 S0 清单）。
  - 回改后复跑锚点门禁，确认零死链。
  - **核对 S3 起草的「错误参考」章已落盘且机器码全部命中登记册**（D19）。
  - `docs/user-guide/README.md` 标注冻结归档、非产品帮助载体；保留架构图读取说明。
  - 术语标准登记新术语。
- 出口：SC-18 通过；SC-05、SC-10 的全量回归通过；SC-24 的机器码一致性部分通过。
- 注意：改手册正文的阶段只有两个：**S5**（§0 小标题与随之失效的深链）与 **S3**（D15 专节、D19 错误参考章）。两处都不得改无关章节的技术内容。

### S6 门禁与收口

- 目标：把跨文件深链检查与错误码一致性检查固化进既有门禁，并完成形态与术语收口。
- 内容：
  - `handbook-anchor-gate.mjs` 扩展：快速入门每条手册深链 id 必须存在于 `SECTION_ID_CONTRACT` 且在派生 IA 中可达。
  - **同一脚本扩展错误码一致性检查（D19）**：手册「错误参考」章出现的机器码必须命中术语标准已登记裁决码或 `REASON_CODES`。不新增命令、不新增 CI job。
  - 扩展 `handbook-anchor-gate.test.mjs`。
  - 全量跑 `lint:handbook-anchors`、`lint:terminology`、`lint:spec`、`lint:ia-boundary`、`lint:spec-docs`。
  - 逐条勾销本 Plan §8。
- 出口：SC-05（门禁部分）、SC-19、SC-20、SC-24（门禁部分）通过；四条门禁命令全绿。

## 5. 验收

### 5.1 验收编号与口径

- 验收编号在主 Spec 内从 `SC-01` 起，共 SC-01–SC-26。本 Plan 不新增编号。
- **测试通过不等于验收通过。** 每个 SC 记录：测试编号、候选产品版本、构建提交／dirty 状态、输入手册 `etag`、结果（`passed`／`failed`／`not_run`）。
- 浏览器走查与 Docker 重建**不在本 Plan 授权内**；需要时另行授权。
- 本 Plan 落盘时，SC-01–SC-26 **全部为 `not_run`**。

### 5.2 阶段与 SC 的对应

| 阶段 | 覆盖 SC | 自动化形态 |
|---|---|---|
| S1 | SC-01、SC-02、SC-03、SC-04、SC-05（服务端）、SC-10（解析）、SC-12（服务端） | `webui/server/__tests__/help.test.ts` |
| S2 | SC-07、SC-08、SC-09、SC-11、SC-19（前端）、SC-22、SC-23 | `webui/src/__tests__/help-center*.test.tsx` |
| S3 | SC-04（呈现）、SC-05（呈现）、SC-06、SC-24、SC-25 | 内容审查 + 组件测试 |
| S4 | SC-13、SC-14、SC-15、SC-16、SC-17、SC-26 | 组件测试（含剪贴板降级桩） |
| S5 | SC-18、SC-05（全量）、SC-10（全量）、SC-24（机器码一致性） | 静态检查 + 锚点门禁 |
| S6 | SC-05（门禁）、SC-19、SC-20、SC-24（门禁） | 门禁脚本 + 术语检查 |

### 5.3 执行记录

**2026-10-31（Plan 落盘）**：SC-01–SC-20 全部 `not_run`。本次只落 Spec 与 Plan，未执行任何功能验证、未跑浏览器、未构建镜像、未提交。

**2026-11-19（v0.3 修订）**：随主 Spec 升 v0.3-draft（对标对象修正为 `https://www.kimi.com/code/docs/`），本 Plan 升 v0.3。SC-01–SC-23 全部 `not_run`；本次只改文档，未执行任何功能验证、未跑浏览器、未构建镜像、未提交。

**2026-11-19（v0.4 修订）**：随主 Spec 升 v0.4-draft（D17 首页形态裁决 ＋ D19／D20 两项候选纳入），本 Plan 升 v0.4。SC-01–SC-25 全部 `not_run`；本次只改文档，未执行任何功能验证、未跑浏览器、未构建镜像、未提交。

**2026-11-19（v0.5 修订）**：随主 Spec 升 v0.5-draft（D21 MD 标配：「复制 Markdown」成为标准动作，覆盖四处载体页，并解除 D6 的整本导出限制），本 Plan 升 v0.5。SC-01–SC-26 全部 `not_run`；本次只改文档，未执行任何功能验证、未跑浏览器、未构建镜像、未提交。

## 6. 完成定义

本条全部满足才可登记实现完成：

1. S0–S6 全部完成，且各自出口条件满足。
2. SC-01–SC-26 全部 `passed`，并有逐条证据（命令、版本、提交、etag、结果）。
3. 帮助首页形态与 D17 已裁决的概览内容页形态一致，且 SC-22／SC-23 通过。
4. 手册「错误参考」章已落盘：每条含五要素、机器码全部命中登记册、门禁通过（SC-24）。
5. 「本期未覆盖」页面与速查末节都有站内逃逸出口且可达（SC-25）。
6. **MD 标配（D21）**：四处载体页都有「复制 Markdown」；导出物一律 `.md`；整本导出与手册 SSOT 逐字节一致（SC-26）。
6. 旧深链零死链：`LEGACY_SECTION_IDS` 全量在新 IA 下落到有效文章位置。
7. 快速入门路径可走通：接入开发者路径每步三要素齐备，全部深链可达。
8. 导出内容与手册原文一致：复制内容与导出文件逐字节相同，且等于原文切片加来源标注。
9. 离线可用：断网环境下门户、快速入门、分类、文章、搜索全部可用，无外部请求。
10. 翻译防御到位：含英文术语的 DOM 节点带 `translate="no"` 与 `notranslate`。
11. 门禁全绿：`lint:handbook-anchors`、`lint:terminology`、`lint:spec`、`lint:ia-boundary`、`lint:spec-docs`。
12. 手册正文只改了 §0 小标题与随之失效的深链，**外加 D15 专节与 D19「错误参考」章**；其它技术内容零改动。
13. `docs/user-guide/` 已标注冻结归档，且架构图白名单仍可用。
14. 术语标准已登记新术语，无未登记文案进入 UI。
15. 本 Plan §8 落盘清单逐条可答，答案不是「门禁全绿」。

**完成判定不等于可上线**：发布取证、客户交付与镜像验收不在本条出口内。

## 7. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 快速入门写成手册摘要 | 产生第二事实源，两处内容必然漂移 | D3 硬规则；SC-06 三要素结构检查；只允许深链引用 |
| §0 小标题回改连带改 id | 产生新一批死链 | S0 先出引用清单；S5 同步契约表；锚点门禁全量回归 |
| 快速入门步骤与手册实际行为不符 | 用户照做失败，且无处可查 | 步骤只写「动作 + 预期结果 + 深链」；缺内容回 S5 补手册，不就地编造 |
| 旧深链映射表被后续改标题打断 | 历史深链静默失效 | SC-10 全量固化；解析失败显式 `notfound` |
| 门户改造期间 `/help` 不可用 | 全局 `?` 按钮落点失效 | S1、S2 独立可回退；深链兼容在 S2 一次性落地 |
| 错误参考章写了码库里没有的码 | 用户照着做仍失败，且手册与实现漂移 | D19 机器码必须命中登记册；S0 定码清单；门禁扩展项④；SC-24 |
| 错误参考只罗列码、不给下一步 | 用户看到拒绝码仍不知道怎么办 | 条目五要素为硬约束（④ 可执行下一步 ＋ ⑤ 兜底路径）；SC-24 逐要素断言 |
| 「未覆盖」页面没有出口 | 读者走到死胡同 | D20 强制站内去向；SC-25 断言出口可达且不外链 |
| 概览页做成营销页 | 帮助中心变成宣传页，读者拿不到操作路径 | D17 硬约束④；SC-22 断言无外部资源、无营销文案 |
| 复制 Markdown 只做在文章页 | 分类页／全文视图的用户拿不走内容，「MD 标配」落空 | D21 覆盖四处载体页；SC-26 逐页断言 |
| 整本导出物与手册 SSOT 漂移 | 用户拿到的是另一份手册 | 整本导出＝白名单读取的同一份 SSOT 原文，不做二次转换；来源标注带 etag 短前缀；SC-26 逐字节比对 |
| 导出物内容与页面显示不一致 | 用户拿走的说明不可信 | 复制与导出共用同一构造函数；SC-13 逐字节比对 |
| 剪贴板 API 在客户形态不可用 | 复制静默失败 | 统一走 `clipboard.ts` 降级；SC-14 固化 |
| 打印样式污染屏幕布局 | 视觉回归 | print 样式独立作用域；SC-16 |
| 共享工作区并发改动覆盖登记型文件 | 索引／契约表被静默覆盖 | P6 开工前置；收尾逐文件 `git diff` 复核 |
| 阶段并行导致接口反复改 | 返工 | 阶段顺序固定：S1 未完成不得做 S2 |
| D17 首页形态被改回门户网格 | S2 与冻结口径不一致，返工 | D17 已由委托人裁决为概览内容页；开工前置 P1 要求 D1–D20 冻结；SC-22 断言形态 |

## 8. 落盘清单勾销

对照 [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「新增 Spec / Plan 的落盘清单」：

| # | 结果 |
|---|---|
| 1 | Spec 在 `docs/specs/lucy-20261031-help-center-experience-spec.md`，Plan 在 `docs/plans/lucy-20261031-help-center-experience-plan.md`。共用编号 `lucy-20261031-help-center-experience`，slug 只用小写字母与连字符，不含版本段 |
| 2 | Spec 含「核心流程（伪代码）」，四段：IA 派生与偏移量、路由解析与旧深链兼容、导出物生成、复制动作 |
| 3 | Spec 头部有「文档类型 / 版本」与「状态」；Plan 头部有「状态」「授权边界」「验收」 |
| 4 | 本 Plan 含目标（§1）、开工前置（§2）、验收（§5）、完成定义（§6）、风险（§7） |
| 5 | Spec 的 Terminology Compliance 含 `This feature follows` 与 `New terms:` |
| 6 | Spec 的 Design System Compliance 含规定四段：Referenced Specs / What This Change Follows / Exceptions (If Any) / Follow-up Needed |
| 7 | 已登记 `docs/README.md` 与 `docs/plans/README.md` |
| 8 | 不适用。本功能**不新增命令或 CI job**：跨文件深链检查并入既有 `npm run lint:handbook-anchors`（Spec D14），故不需在 `docs/governance/test-layers-and-release-gates.md` §2／§8 新增登记行。既有门禁的检查范围扩展写在 Spec §11 |
| 9 | 台账号 **L25-12**，挂 v0.25 升级台账（2.5 建议书 §2.6）。文件名是本功能的身份，不另派 WebUI 流水号。本 Plan 取代 L25-12 原草案（原草案未产出 Plan） |
| 10 | 2026-10-31 与 2026-11-19 各跑一轮 `npm run lint:spec-docs`、`npm run lint:terminology`、`npm run lint:spec`、`npm run lint:ia-boundary`。逐条结果见本 Plan §8.1 与 §8.2。**门禁结果不代替本表** |
| 11 | Spec 含「闭口层级」。层级是功能合同。本条承诺是帮助中心三层呈现 + 快速入门独立 + 内容可复制导出 + 旧深链零失效 + D17 首页形态 + D19 错误参考 + D20 逃逸出口。出口是 SC-01–SC-26。上线关系写明本条收口不表示可上线 |

### 8.1 门禁执行记录（2026-10-31）

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run lint:spec-docs` | 本功能**零违规**；全量 exit=1 | 本 Spec 与本 Plan 在 FAILED 与 WARN 两个通道下均无违规（门禁对未跟踪文件同样逐条检查，只降级为不阻塞）。全量 exit=1 来自**其他**会话的在途文件：`docs/specs/lucy-ci-restoration-spec.md`、`docs/plans/2026-10-29-ci-restoration-plan.md`、`docs/plans/2026-10-30-l25-11-publish-window-task.md`、`docs/plans/lucy-20261030-manifest-upload-size-fix-plan.md`，以及未跟踪的 `webui-release-ux-review` 系列。与本功能无关，**不写入基线**（基线只减不增） |
| `npm run lint:terminology` | **通过**（1095 files scanned） | 新术语已在主 Spec 的 Terminology Compliance 登记；术语标准本体的新增登记在 S5 执行 |
| `npm run lint:spec` | exit=1，失败项与本功能无关 | 失败项为 `api-spec`：`webui/docs/03-api-spec.md: missing /api/publish-workbench/evidence`。该路由已在 `webui/server/index.ts:1053` 实现（提交 `6040ef7a`，发布工作台三栏线），但 API 文档未同步登记，属该线遗留。本功能未改任何路由、API 或技能文件 |
| `npm run lint:ia-boundary` | **通过** | 本阶段未改路由 |

本表只报告门禁观察到的结果，不代替 §8 的逐条勾销，也不表示本功能已通过验收。

### 8.2 门禁执行记录（2026-11-19，本版修订 v0.3／v0.4）

三轮修订都只改文档（对标对象修正 → v0.3；首页形态裁决 ＋ D19／D20 纳入 → v0.4；MD 标配 D21 → v0.5），未改任何运行代码、路由、API 与技能文件。

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run lint:spec-docs` | 本功能**零违规**；全量 exit=1 | FAILED 通道只报 `docs/plans/lucy-20261118-ff4762c9-upgrade-blocker-integration-plan.md`（index／plan-parts／metadata 四项），属**其他会话的在途文件**，与本功能无关，**不写入基线**（基线只减不增）。WARN 通道只报 `docs/specs/lucy-20261118-mcp-upgrade-question-bank-spec.md`（close-layer），同为未跟踪的他人草稿，不阻塞。本 Spec 与本 Plan 均未出现在任一通道 |
| `npm run lint:terminology` | **通过**（1163 files scanned） | 新增术语「归属路径」已在主 Spec 的 Terminology Compliance 登记；术语标准本体的新增登记仍在 S5 执行 |
| `npm run lint:spec` | **通过**（仅无关 WARN：eval-schema-version、access-role-policy） | 本次未改路由、API 或技能文件 |
| `npm run lint:ia-boundary` | **通过** | 本阶段未改路由 |

本表只报告门禁观察到的结果，不代替 §8 的逐条勾销，也不表示本功能已通过验收。

**v0.5 一轮（2026-11-19，MD 标配 D21）**：复跑同四条命令，结果与上表一致——`lint:terminology`（1163 files scanned）通过、`lint:ia-boundary` 通过、`lint:spec` 全项 PASS（仅 eval-schema-version 与 access-role-policy 两条无关 WARN）、`lint:spec-docs` 的 FAILED 通道仍只报 `docs/plans/lucy-20261118-ff4762c9-upgrade-blocker-integration-plan.md`（其他会话已提交文件），本 Spec 与本 Plan 均未出现在任一通道。
