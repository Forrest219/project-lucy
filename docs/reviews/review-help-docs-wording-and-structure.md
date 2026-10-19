# 帮助文档结构与措辞全面审阅

> **状态**: Review（未实施任何修复）
> **日期**: 2026-10-20
> **范围**: `docs/SYSTEM_HANDBOOK.md`（3233 行，应用内 `/help`「系统手册」SSOT）、`docs/user-guide/*.html`（18 页帮助文档中心）、`webui/docs/user-guide.html`、`webui/src/pages/Login.tsx` 公开帮助、`webui/server/help.ts`、`webui/src/components/MarkdownPreview.tsx`
> **基准**: `webui/docs/00-product-terminology-standard.md`（项目自有术语标准，适用范围明列「交付文档」）
> **影响等级**: 高

---

## 1. 审阅方法

本轮审阅以**运行时取证**为主，不依赖肉眼通读印象：

| 取证手段 | 说明 |
| --- | --- |
| 运行应用真实解析器 | `npx tsx` 直接调用 `webui/server/help.ts` 的 `parseHelpToc()`，喂入当前 `docs/SYSTEM_HANDBOOK.md`，得到应用侧真实目录（89 条） |
| 逐字复刻前端剥离逻辑 | 复刻 `HelpCenter.tsx:110-144` 的 `stripLeadingHandbookPreface()`，跑真实文件比对丢失行 |
| 用应用自身 slug 规则算锚点 | 复用 `webui/src/lib/wiki.ts:210-218` 的 `slugifyHeading()` 计算全部标题 id，与手写 `href` 比对 |
| Playwright 真实 DOM 校验 | 起本地 dev（Vite 5173 / API 5174 / Proxy 7879），用仓库自带 Playwright + Chromium 加载 `/help`，在真实 DOM 上统计 section、id、失效锚点、表格、重复内容 |
| 锚点交叉校验 | 脚本化解析 `docs/user-guide/*.html` 的 `href` vs `id`（含跨文件锚点） |
| 现有门禁 | `npm run lint:terminology`（当前**红灯**）、`npm run lint:ia-boundary`（通过） |

> 说明：本会话内置 Browser 工具的 `inspect` / `query` / `wait` 在任意页面（含 `/api/health` 纯 JSON）均 275s 超时，判定为工具侧故障而非页面问题，故改用 Playwright 独立复核。**Playwright 侧结果：帮助页渲染正常（86 个 section、94,453 可见字符、117 张表格、0 控制台报错）**，此前观察到的空白内容区是工具假象，不是产品缺陷。

---

## 2. 结论摘要

手册**内容质量本身不低**（117 张表格全部正确渲染、章节骨架完整、代码示例基本可用），但存在三个**阻断级**问题集中在「应用内可见性」上，而这些问题在阅读 Markdown 源文件时**完全看不出来**：

| # | 严重度 | 问题 | 影响面 |
| --- | --- | --- | --- |
| **B1** | 阻断 | §0.0 / §0.4 共 **98 行**在应用内被整段丢弃，而侧栏仍有入口 | 侧栏**前 3 条**目录项全是死链；有 lint 守护的「文档基线」事实源表在产品内不可见 |
| **B2** | 阻断 | 正文内 **15 / 102** 个 `#锚点`失效（三套 slug 规则互不一致） | 表格「详见」列里近 1/6 的跳转点了没反应 |
| **B3** | 阻断 | 「MCP 调试台」整段内容**重复两次**，其中一份丢失标题、被并入上一节 | 用户在 §3.5 里连读两遍同一内容 |

另有 **2 个重要级结构缺陷**：18 个 section id 是无语义哈希（URL 不可读且随标题改动失效）；11 个 H4 子节因白名单机制**完全不出现在侧栏目录**（含「调用监控」「Token 凭据」「MCP 调试台」「现场提问」「安全评测候选」等整页级入口）。

措辞层面的结论：**「术语一致性」是五个维度里最差的一项**，其次是「AI 味」；「格式渲染」在 Markdown 语法层面无问题，问题全在结构与链接层。

---

## 3. 维度一：格式渲染与对用户不友好的技术性呈现

### 3.1 【阻断】B1 —— §0.0 / §0.4 在应用内整段消失

**机制**：`webui/src/pages/HelpCenter.tsx:137-141` 剥掉手写「目录」时，只扫描到**下一个 H2**：

```js
if (/^##\s+目录\s*#*\s*$/.test(lines[i] ?? "")) {
  i++;
  while (i < lines.length && !/^##\s+/.test(lines[i] ?? "")) i++;   // 只认 H2，跳过 H3
```

但 `§0.0`（`docs/SYSTEM_HANDBOOK.md:63`）与 `§0.4`（`:78`）是 **H3**，且排在 `## 0. 常见问题速查`（`:99`）**之前**。复刻该函数实测：

```
原始行数: 3234  剥离后行数: 3136
剥离后首行: "## 0. 常见问题速查"
### 0.0 文档基线（自动同步）   原文:true  剥离后:false
### 0.4 v2.0.0 切线说明        原文:true  剥离后:false
产品版本（`VERSION`）          原文:true  剥离后:false
列车规则 / 客户镜像 tag 形式   原文:true  剥离后:false
```

**用户可见后果**（Playwright 实测 DOM）：

```
侧栏入口总数: 64   指向不存在内容的: 3
  ☠ 死链 → 目录              /help?section=41e5243e2d
  ☠ 死链 → 文档基线（自动同步）  /help?section=b9c274fb1c
  ☠ 死链 → v2.0.0 切线说明     /help?section=v2-0-0
```

侧栏**头三条**全部点不动；其中「文档基线（自动同步）」是唯一由 `npm run lint:handbook-baseline` 守护的事实源表 —— 表格里写着「**不要**手改本表」（`:76`），而用户永远看不到它。

**建议**：把剥离逻辑改为「跳过「目录」后连续的同级兄弟节点」，或直接让 §0.0/§0.4 升为 H2 落在 `## 0.` 之后；并补一条断言「TOC 中每个 id 在 DOM 中都存在」的回归测试（见 §8 建议 T7）。

### 3.2 【阻断】B2 —— 正文内 15 处锚点失效

应用里标题 id 由 `MarkdownPreview` 用 `slugifyHeading()`（`webui/src/lib/wiki.ts:210-218`，**删下划线**、保留 Unicode 字母、空格转连字符）生成；而手册手写 `href` 用了第三套规则（保留下划线、把 `/` 也算连字符），且部分链接文案是改名前的旧标题。

Playwright 在真实 DOM 上按「`href` 目标 id 是否真实存在」逐条核验：

```
=== 正文中失效的 #锚点 === 15 / 102
  #33-语义层维护                            ×3   例: 3.3 语义层维护
  #35-访问治理-admin                         ×3   例: 3.5 访问治理 Admin
  #37-yaml-文件规范与交付验收                  ×3   例: 3.7 YAML 文件规范与交付验收
  #610-lucy_query-报-no-join-path--跨表失败    ×2   例: 6.10 lucy_query 报 No join path / 跨表失败
  #36-质量评测-eval                          ×2   例: 3.6 质量评测 Eval
  #32-数据库接入                             ×1   例: 3.2 数据库接入
  #34-业务文档-wiki                          ×1   例: 3.4 业务文档 Wiki
```

三类根因：

1. **章节改名未同步链接**：§3.2 现名「数据接入 · 连接 / Schema / 表范围」（`:477`），链接仍写「数据库接入」；§3.5 现名「角色 / Agent / Token 心智」（`:1178`），链接仍写「访问治理 Admin」；§3.7 现名「YAML 规范与交付验收」（`:1913`），链接仍写旧名。
2. **slug 规则不一致**：`lucy_query` / `order_by` 的下划线被 `slugifyHeading` 删除，链接保留 → `#610-lucy_query-…` 永远匹配不上 `#610-lucyquery-…`。
3. **后缀 `-admin` / `-eval` 是历史残留**，与现标题无任何对应。

这些失效链接**集中出现在最常用的位置** —— §0 速查表的「详见」列。用户在「我在哪里新建数据库连接？」这类最基础的问题上点「详见」，会得到一个死链。

**建议**：把手写 `href` 全部改为「稳定 slug 词条」（如 `#semantic-layer`），并在 `parseHelpToc` 侧把该 slug 显式登记，避免靠标题文本推。

### 3.3 【重要】18 个 section id 是无语义哈希

`help.ts:290-297` 的 `stableSlug()` 在标题全是中文时退化为 sha1 前 10 位。实测 18 个：

```
6071f2d2b3(1.2 架构拓扑)  39427f6000(1.3 核心原则)  08b71d6edc(1.4 目录与事实源地图)
4ad8773730(2.1)  198f0630d2(2.2)  460668d588(2.3)  81d1ee0418(3. 功能模块操作指南)
e01343f072(3.1)  15c67413dc(3.3)  6a5064e9e9(3.6)  49a623a435(3.8)
cd0213b37a(3.9)  f938505a79(3.10)  8225783f38(4.1)  881f699603(4.4)
8da07705ab(5.3)  1022f33104(6.3)  18665d410e(6.7)
```

用户看到 / 复制的 URL 形如 `/help?section=15c67413dc`，既不可读也无法自行推断；更严重的是**标题一改，哈希就变，历史深链全部失效**，而这些深链已被写进其他文档。

**建议**：为全部中文标题补 `SECTION_ALIASES`（该机制已存在，只是覆盖不全：`help.ts:30-106` 共 70 条中有 **18 条已成死条目**，匹配不到任何现有标题，包括 `/语义层维护/`、`/访问治理 Admin/`、`/质量评测 Eval/`、`/YAML 文件规范与交付验收/` 等）。

### 3.4 【阻断】B3 —— 「MCP 调试台」整段重复

`docs/SYSTEM_HANDBOOK.md:1556-1597` 是一份**丢了 H4 标题**的「MCP 调试台」完整副本（`#### MCP 调试台（/admin/mcp-playground）` 只存在于 `:1682`）。两份正文 diff 只差 2 行空行 + 尾部缺「**关联**」小节。

后果：§3.5「审计热库与冷库」一节里混进一整段调试台说明（因为 `:1557-1558` 少了标题，这段被并入上一节），而 `:1682` 之后又完整出现一次。Playwright 实测正文出现次数：

```
=== MCP 调试台 重复检测 ===
  "调试台是 Agent 接入后的" 出现次数: 2
```

**建议**：删除 `:1556-1597` 这份孤儿副本，保留 `:1682` 起的正常版本。

### 3.5 【重要】11 个 H4 子节完全不在侧栏目录

`help.ts:312-360` 的 `parseHelpToc()` 只放行「登记在册」的 level-4 标题（6 个显式白名单集合）。未登记的 H4 **静默丢弃**。实测 45 个 H4 中 **11 个不进侧栏**：

| 位置 | 标题 | 影响 |
| --- | --- | --- |
| `:419` | 调用监控（/ops/calls） | **整页无导航入口** |
| `:1599` | Token 凭据（/admin/tokens） | 整页无导航入口 |
| `:1682` | MCP 调试台（/admin/mcp-playground） | 整页无导航入口 |
| `:1801` | 现场提问（/eval/field-questions） | 整页无导航入口 |
| `:1855` | 安全评测候选（/eval/security-candidates） | 整页无导航入口 |
| `:2519` | 接入向导六步流程（按实现映射） | 与 `:2500` 标题近似，易混 |
| `:2534` | 与 §3.X 的双轨关系 | 标题用占位符「§3.X」 |
| `:2554` | 配置 MCP endpoint | — |
| `:2611` | 客户端为何要回传 `Mcp-Session-Id` | — |
| `:2621` | 上游会话复用与限流 | — |
| `:2642` | 排障速查 | — |

这 5 个整页级入口，正好是 §1.5「WebUI 入口速查」里明确列出的页面 —— 用户在手册里看得到路径，却无法从手册导航过去。

**建议**：与其维护「白名单集合」，不如改为「H4 一律进目录」+ 允许用 `<!-- toc:ignore -->` 显式排除。现有白名单机制是**新增 H4 静默消失**的隐患源。

### 3.6 【次要】§3.7 与 §3.7.6 的 id 语义错配

侧栏实测：

```
YAML 规范与交付验收      /help?section=yaml-delivery-checklist
GO / NO-GO 交付 checklist /help?section=yaml-delivery-checklist-2
```

`SECTION_ALIASES` 中 `[/GO \/ NO-GO|交付 checklist|交付验收/i, "yaml-delivery-checklist"]` 被 §3.7 抢先匹配（「交付验收」也在其内），导致 §3.7.6 拿到 `-2` 后缀。**§3.7 的 id 读起来像 §3.7.6 的**。同时 §3.7.0–3.7.8 被 `help.ts:343-345` 强制压平成 level 3，在侧栏与 §3.7 平级，编号层级完全消失：

```
YAML 规范与交付验收          ← §3.7
overlay 字段速查（编写辅导）    ← §3.7.0
YAML 类型总览               ← §3.7.1
...
Agent 自检协议               ← §3.7.8
```

### 3.7 【次要】其它渲染层问题

- `:2603` 相对链接 `](../docs/access-control/runbook-row-policy.md)` —— 从 `docs/` 出发解析为 `docs/docs/…`，**断链**（正确应为 `access-control/runbook-row-policy.md`）。
- `:2726-2728` 一个只含 `<LUCY_PUBLIC_MCP_URL>` 的 ```text 块，是模板残留，无信息量。
- 引用块里的 `> **关联：M20 YAML 交付 runbook**` 出现在 `:3017`、`:3069`、`:3125`、`:3167` 共 4 处 —— 「M20」是内部工单号（实际文件 `webui/docs/plans/wo-M20-yaml-delivery-runbook.md`），对用户零信息量。

### 3.8 【正面】渲染本身无缺陷

以下实测通过，**不需要动**：

- 117 张表格：0 张缺 `<thead>`，0 张列数不一致，列对齐正确
- H1–H6 标题无跳级、无层级断裂
- 77 个代码围栏全部闭合；`<conn>` 类占位符转义顺序正确（行内码先摘出再插回）
- 0 控制台报错；搜索、目录跳转、URL 深链机制工作正常
- `MarkdownPreview` 语法能力边界与手册当前用法匹配（不支持嵌套列表 / 任务列表 / 删除线 / 裸 HTML，手册均未使用）

---

## 4. 维度二：拗口的技术性词汇

### 4.1 【重要】KPI 名称被「去术语化」到读不懂

`docs/SYSTEM_HANDBOOK.md:427-434`：

| UI 主术语 | 实际含义 | 问题 |
| --- | --- | --- |
| **近 N 调用量** | 窗口内业务 MCP 调用次数 | 「N」是占位符却当产品名用；用户不知道 N 是多少 |
| **多数请求耗时** | `durationMs` 的 **P95** | 绕开「P95」反而更难懂；正文 `:423` 自己还要补一句「（P95）」 |
| **慢于多数请求** | `durationMs > slowMs` 的次数 | 没说慢多少、阈值多少 |

同一份文档 `:471` 的「反馈历史」表里又直接写「P95 算法」—— 说明团队内部知道 P95 是准确说法，只是没敢放进 UI 文案。**建议**：`P95 耗时` / `慢请求数（>30s）` / `调用量（24h）`，把 N 换成实际窗口。

### 4.2 【重要】需要建立词汇表才能读懂的名词

| 出现处 | 词 | 为什么拗口 | 建议 |
| --- | --- | --- | --- |
| `:1178`、`:279`、`:1207`、`:1603` | **心智**（8 次） | 「三层心智」「一句话心智模型」「心智位置」—— 中式抽象，读者要翻译三遍 | 「三层对象关系」「速览」「Token 在模型中的位置」 |
| `:78`、`:80`、`:82` | **切线 / 列车规则**（6+2 次） | 版本管理黑话 | 「版本升级规则」/「版本号规则」 |
| `:103` | **deep dive** | 全文唯一的纯英表达，夹在中文句中 | 「深入排查」 |
| `:9` | **文档基线（不要落）** | 「落」是内部动词 | 「文档基线（请勿手改）」 |
| `:1519`、`:1561` | **冷存 / 沙盒 / 试调沙盒** | 「沙盒」偏游戏化 | 「加密冷存」/「试调环境」 |
| `:2274`、`:1973` | **门禁**（5 次） | 隐喻 | 「发布前检查」 |
| `:2591` | **硬约束 / 兜底** | — | 「强制要求」/「保底」 |
| `:209`、`:214` 等 | **事实源**（15 次） | 反复出现但未在开头定义 | 首次出现处加一句括注 |

### 4.3 【重要】写作脚手架残留进正文

`:490-495` 整张表的表头是 **「问题 \| 手册应回答」**：

```
| 问题 | 手册应回答 |
| 我在哪里新建连接？ | 编辑 `ktx.yaml`，不是 WebUI |
| 密码放哪里？ | `file:` / `env:` / Docker secrets，不写 inline 明文 |
```

这是**文档作者的写作提纲**，不是给用户看的内容 —— 读者看到「手册应回答」会困惑「那到底答案是什么」。同类残留：

- `:1087`：「以下 H4 子节原属旧 §3.9「语义资产范围树」，按 Day 2 侧栏分组重排并入 §3.3 末尾。H4 标题保持不变以保留其已有锚点（`semantic-asset-scope-tree`）。」
- `:2521`：「**这是按实现拆开的工作台版，与上节「六步流程」是同一目录的不同视角**——重在「每个 Step 背后是哪个文件 / 哪个 API」。」
- `:2525`：表格单元格里嵌了 git commit hash `85a900d stop advertising a password file for SQLite and Athena`。

这些是重构决策记录，应留在 `docs/plans/` 或 commit message，不该出现在用户手册。

### 4.4 【次要】引号三套并存

全文同时存在：ASCII 直引号 `"…"`（`:615`、`:616`、`:618`、`:691`、`:1106`、`:2107`、`:2143`、`:2176`、`:2222`、`:2582`、`:2601`）、中文弯引号 `“…”`（`:113`、`:549`）、全角直角 `「…」`（`:31`、`:60`、`:103` 等主流用法）。同一份文档同一屏里三种混排。

**建议**：统一「直角引号 `「」` 用于引用界面文案、弯引号 `“”` 用于强调、正文不用引号」。

### 4.5 【次要】中英混排不自然

`:992`「不要一次 diff 里混多个 unrelated 概念」、`:3082`「检查 `npm run dev` 是否启动了 Vite」尚可；但 `:103` 的 deep dive、`:226` 的「事实来源」、`:479` 的「入口：」并列表格混排显得随意。

### 4.6 【次要】超长句

`:1024` 一句 78 字；`:119`、`:1274`、`:2591`、`:3197` 均在 70 字以上，且普遍是「主语 + 多个顿号并列 + 结论」结构。典型 `:3197`：

> **不要用「先 join 再聚合」的直觉硬刚**：语义层会改写预聚合策略；错误 `grain`/`relationship` 会导致拒查或静默错数。

---

## 5. 维度三：功能描述的简约性、清晰度与层次结构

### 5.1 【重要】同一页面在手册里有多个互相矛盾的「入口」

手册正文大量使用**重定向别名**而非规范路径，与 §1.5 的「侧栏地图」自相矛盾。实测路由（`webui/src/app/App.tsx:512-555`）：

| 手册写法 | 实际路由 | 状态 |
| --- | --- | --- |
| `/` 表目录（`:871`）、`/`（`:387`、`:553`） | `App.tsx:519` → `Navigate to="/catalog"` | **重定向** |
| `/review`（`:388`、`:924`） | `App.tsx:526` → `/publish/workbench` | **重定向** |
| `/sources/:conn/:schema/:table`（`:871`） | `App.tsx:522` → `/catalog/:conn/:schema/:table` | **重定向** |
| `/connections/whitelist`（`:484`、`:503`、`:510`、`:764`） | `App.tsx:517` → `/connections/enabled-tables` | **重定向** |
| `/onboarding`（`:379`、`:2498`） | `App.tsx:514` → `/onboarding` 重定向到 `/overview` | **重定向** |
| `/admin/governance` | → `/admin/usage` | 重定向 |

结果：§1.5 写「启用表范围 `/connections/enabled-tables`」，§3.2 整节写「表白名单 `/connections/whitelist`」；§1.5 写「语义资产 `/catalog`」，§3.3 开头写「入口：`/` 表目录」；§1.5 写「系统概览 `/overview`」，§3.1 写「入口：`/onboarding`」。

**建议**：手册统一用规范路径；别名只在「已知老链接」附注里出现一次。

### 5.2 【重要】§3.2 的核心安全边界在 §3.9 被推翻

§3.2 是全篇最强调边界的地方（`:487`、`:603`、`:607`）：

> **WebUI 不负责新建物理数据库连接。** 新增连接的 host、port、database、username、password、driver 等字段由运维在 `ktx.yaml` 和 secret 文件中配置。

但 §3.9「与 §3.X 的双轨关系」表（`:2540`）写：

```
| 1 | `/onboarding` Step 1（抽屉） | `/catalog`（连接创建） | 调字段顺序、跨源 password 来源细节、连接 ID 改名 |
```

`/catalog` 被标为「连接创建」入口，且「何时切到工作台」列明说可以在那里改「跨源 password 来源细节」。**与 §3.2 直接冲突**。`:2541`、`:2543` 又把 `/catalog` 的 Schema Tab 和语义工作台并列为两个不同东西，用户无法判断 `/catalog` 到底管什么。

### 5.3 【重要】§3.7.1 的两个 YAML 示例与真实配置格式矛盾

| 手册示例 | 真实格式（`ktx.yaml.example` / `access.yaml`） | 后果 |
| --- | --- | --- |
| `:2061-2068` 用 `type: <DB_TYPE>` + `dsn: <YOUR_DSN>` | `ktx.yaml.example:27` 用 `driver: mysql`；`:38-45` 用 `host` / `port` / `database` / `username` / `password` / `schemas` | 照抄得到**无效配置**；`type` / `dsn` 在真实 schema 里不存在 |
| `:2117-2122` 用 `roles:` **列表** + `tableSelectors` 在 role 顶层 + `tools: allow: [...]` | 真实 `access.yaml` 用 `roles:` **映射** + `allow.connections` / `allow.tableSelectors` / `allow.tools` | 照抄得到**无效配置**；且与 §3.2 `:783-801`、§5.1 `:2828-2870` 的正确示例冲突 |

同一份手册里给了**两份互斥**的 `ktx.yaml` / `access.yaml` 示例，§3.2 / §5.1 正确，§3.7.1 错误。

### 5.4 【重要】占位符规范自相矛盾

`:2051` 声明「统一用 `<REDACTED>`、`<YOUR_HOST>`、`<YOUR_TOKEN>`」，但全文实际用着三套：

- `:339-342`：`<CHANGE-ME-MYSQL-HOST>`、`<CHANGE-ME-USERNAME>`
- `:661-665`、`:2893-2896`：`<DB_HOST>`、`<DB_PORT>`、`<READONLY_USERNAME>`
- `:2051`：`<YOUR_HOST>`、`<YOUR_TOKEN>`

`ktx.yaml.example` 用的是 `<CHANGE-ME-*>` 一套。**声明的统一 ≠ 实际统一**。

### 5.5 【重要】悬空交叉引用

| 位置 | 引用 | 实际 |
| --- | --- | --- |
| `:696` | 「使用通用模板填入 connection 块（见 **3.2.2**）」 | §3.2 的子节**无编号**，不存在 3.2.2 |
| `:1306` | 「见下文「**Role-first 模型**」「**Token 发行规则**」「**权限裁决机制**」」 | 三个都不是标题（实际在 `:1422`、`:1462`、`:1475`，是**无标题的裸段落**） |
| `:2552` | 「Wizard 不替代**发布工作台**（§3.7）」 | §3.7 现在是「YAML 规范与交付验收」，发布工作台在 §1.5 —— §3 重组后的**残留** |
| `:1180` | 「问询记录、break-glass、审计冷热库…仍在本节内按 H4 查阅」 | 实际分散在 §3.5/§3.8/§3.10/§3.11 多个章节 |
| `:2534` | 标题「与 **§3.X** 的双轨关系」 | `§3.X` 是占位符，未解析 |

### 5.6 【重要】§4.4 工具面把「绝对拒绝」的工具说成「按 role 可见」

`:2792`：

> 兼容/辅助工具可能包括 `kx_catalog`、`wiki_search`、`wiki_read`、`connection_list`、**`sl_query`**、**`sl_read_source`**、`entity_details` 等。是否可见完全由 role 的 `allow.tools` 和全局 defaults 决定。

但 `webui/server/proxy/acl.ts:46-53`：

```ts
export const ABSOLUTE_DENY_TOOLS = [
  "sl_query", "sl_read_source", "sql_execution", ...
] as const;
```

`sl_query` / `sl_read_source` 是**无条件拒绝**（`acl.ts:100` `if (ABSOLUTE_DENY_TOOL_SET.has(toolName)) return "AbsoluteDeny";`），不是 role 可放开。同一错误在 `:3142`、`:3201` 重复出现（「`lucy_query` / `sl_query` 的 `order_by` 项必须是对象」—— 用户永远无法直接调 `sl_query`）。`:2786-2787` 说「`lucy_read_source` Proxy 转发到 `sl_read_source`」是对的（内部转发），但与 `:2792` 把它列为用户可选工具**自相矛盾**。

### 5.7 【重要】手写「目录」与自动 TOC 双轨并存

`docs/SYSTEM_HANDBOOK.md:11-61` 手写了一份「目录」，但它**既不完整也不准确**：

- 只列了 §1 的 1.5/1.6、§6 的 6.10–6.14、§3.1/3.3/3.4/3.5 的一部分；**1.1–1.4、2.1–2.3、3.6、3.7.0–3.7.8、4.1–4.4、5.1–5.3、6.1–6.9 全部缺失**
- 它列的锚点是**改名前的旧章节名**（`#32-数据库接入`、`#33-语义层维护`、`#35-访问治理-admin`、`#36-质量评测-eval`）—— 共 24 处失效
- 它在应用内被 strip 掉（§3.1 B1），只在 Markdown 阅读器里有意义

**建议**：删掉手写目录，改为由 §1.5 承担「入口地图」职责 + 自动 TOC 承担章节导航。

### 5.8 【次要】单节体量过大

§3.2 约 250 行、§3.5 约 190 行、§3.7 约 490 行，其中 §3.7.6 下的 4 个 H5（`:2276`、`:2303`、`:2326`、`:2354`）在应用里既不进目录、也不在正文显示层级（`MarkdownPreview` 会渲染成 h5，视觉上比 h4 更小，用户根本看不出它们是 §3.7.6 的子步骤）。

---

## 6. 维度四：AI 味

### 6.1 【重要】系统性使用「抽象名词 + 名词化」结构

术语标准 §2.3 要求「动作用动词短语，状态用状态短语」，手册多处违反：

| 手册原文 | 问题 |
| --- | --- |
| `:233` 「本节是**侧栏可见入口的镜像视图**」 | 名词化 + 比喻，无信息量 |
| `:1205` 「把三层对象**配错层**」 | 自造动词 |
| `:960` 「语义层 YAML 不是普通配置文件，而是…**可执行分析契约**」 | 典型 AI 式金句 |
| `:1024` 「**grain 与 relationship 不是可选装饰**，而是防重复计数的硬约束」 | 比喻 + 断言堆叠 |
| `:1532` 「**这是按实现拆开的工作台版**…」 | 元叙述 |
| `:2513` 「向导负责「按顺序做对」，工作台负责「深入修改」」 | 对偶口号 |
| `:2288` 「凭据 \| 文件内无真实 host、username、password、token」 | — |

### 6.2 【重要】AI 高频词分布（全文计数）

```
事实源 15   心智 8   对齐 8   门禁 5   沙盒 4   落地 4   打通 4
闭环 3      兜底 3   硬约束 2  复盘 1   deep dive 1
```

其中「事实源」15 次但**从未在开头定义**；「对齐」8 次基本是「对齐一下」的动词化空转；「打通」「落地」在产品文档里不承载可验证含义。

### 6.3 【重要】`docs/user-guide/` 里「分析肌肉记忆」逐字重复 5 次

同一句比喻原样出现在 5 个页面：

- `docs/user-guide/index.html:231`
- `docs/user-guide/glossary.html:104`
- `docs/user-guide/product-intro.html:818`
- `docs/user-guide/skills.html:63`
- `docs/user-guide/trust.html:84`

其中 `product-intro.html:818` 与 `trust.html:84` 连句式都几乎一样（“…沉淀为 Agent 可重复调用的分析肌肉记忆”）。这是 AI 批量生成页面时最典型的「同一比喻复读」痕迹。

### 6.4 【次要】营销腔与产品腔混用

`docs/user-guide/getting-started.html:62` 的 h1 是整句营销语「Lucy 是一个知道"公司标准口径"的数据分析同事。」，`trust.html:62` 是「Lucy 是企业数据开放给 Agent 前的可信网关。」；而其余 15 页 h1 是名词短语（「权限管理与访问控制」「MCP 接入参考」）。同站两种体裁。

### 6.5 【次要】`webui/docs/user-guide.html` 迁移页品牌名不一致

`:6` meta refresh 指向 `../../docs/user-guide/webui-guide.html`，但 `:7` 标题与 `:31` 正文写「Lucy WebUI 产品使用说明书」，目标页 `<title>` 是「KTX WebUI · Lucy 帮助文档」、h1 是「KTX WebUI 使用说明」。

---

## 7. 维度五：术语前后一致

项目已有 `webui/docs/00-product-terminology-standard.md`，其「适用范围」明列**交付文档**在管辖内，§2.2 规定「一个概念一个主术语」。手册与该标准存在系统性偏离。

### 7.1 【重要】手册 vs 术语标准

| 概念 | 术语标准要求 | 手册实际 | 证据 |
| --- | --- | --- | --- |
| 访问治理 | §4.5 固定为「访问治理」 | 手册 **0** 次「访问控制」，**合规** | — |
| 启用表范围 | §4.1 `Table Whitelist → 启用表范围`；「白表/表白/表白名单」为禁止文案 | **「白名单」26 次**，含 §6.7 标题「为什么白名单表保存失败？」 | `:2937`、`:3112`、`:2542` 等 |
| 语义资产 | §4.2 `Table Catalog → 语义资产`；「表目录」是历史别名 | 手册同时用「语义资产」「表目录」「语义层」 | `:871`、`:1089`、`:244` |
| 质量评测 | §4.4 `质量评测`（模块）/ `评测用例` / `评测运行` | 「Eval」与「评测」混用；§0.1 `:120` 链接文案写「质量评测 Eval」而标题是「3.6 质量评测」 | `:120`、`:1742` |
| 语义发布 / 发布工作台 | §4.3 区分二者 | §3.12 `:2707` 说「**不进入语义发布工作台**」，但全文没有叫「语义发布工作台」这个东西 | `:2707` |
| 手册 / 指南 | — | 手册自称「系统使用与运维手册」、页面标题「系统手册」；`docs/user-guide/` 全站叫「帮助文档中心」、页面叫「指南」 | 两者并存且互不引用 |

### 7.2 【重要】`docs/user-guide/` 与手册的直接矛盾

| 载体 | 说法 | 手册 / 代码事实 |
| --- | --- | --- |
| `permissions.html:70` | 「Agent 身份认证 — 配置身份标识（**API Key 或证书**）」 | 手册**全文 0 次**「API Key」「证书」；唯一凭据是 `Authorization: Bearer`（`:2732`） |
| `permissions.html:90` | 「表级 ACL 在 KTX WebUI 的「**Settings → ACL**」中配置」 | 治理入口是 `/admin/roles`（`:1187`）+ `access.yaml` 的 `allow.tableSelectors`（`:778`） |
| `permissions.html:94` | YAML 键 **`allow_tables`** | 手册**全文 0 次** `allow_tables`；真实键是 `tableSelectors` |
| `permissions.html:81-83` | 内置角色 `viewer` / `analyst` / `admin`（admin = 所有表 + 语义层管理） | 手册无 viewer/analyst 内置角色；`role: admin` 读入等价 `operator`（`:1367`） |
| `permissions.html:115` | 「日志默认保留 **90 天**」 | 90 天是 **Token `expires_at` 默认有效期**（`:1261`、`:1466`）；审计走冷热库分层（`:1517`） |
| `mcp-reference.html:95-98` | 工具名 `sl_read` / `sl_query` / `wiki_search` / `sl_validate` | `sl_read` **不存在**（真实名 `sl_read_source`）；`sl_query` / `sl_read_source` 属 **ABSOLUTE_DENY**（`acl.ts:46-53`） |
| `mcp-reference.html:169` | 「MCP Server **无需额外认证**。多租户身份认证（API Key 模式）正在开发中」 | 手册 `:2730` 「请求**必须**携带 `Authorization: Bearer`」、`:132` `expires_at` 到期硬拒绝 401 |
| `mcp-reference.html:70-81` | Claude Code 接入 = stdio `"command": "ktx", "args": ["mcp", "serve"]` | 手册 `:2738-2754` = HTTP `"type": "http"` + Bearer header |
| `webui-guide.html:127`、`:326` | 「在本机运行的语义补充工作台」「按**本地单用户工具**设计，只绑定 `127.0.0.1`」 | 同页 `:188-206` 列出发布工作台 / 评测 Run / Role+Audit 控制面 —— 自相矛盾 |
| `data-sources.html:68-79` | 支持 MySQL / PostgreSQL / Oracle / StarRocks | 代码支持 6 种 driver：`mysql \| postgres \| sqlserver \| oracle \| sqlite \| athena`（`webui/src/lib/connectionId.ts:52`），**缺 3 种** |
| `release-notes.html:75` | 「v1.x（当前）\| 生产可用」 | `VERSION` = `2.0.0`；手册 `:69` 事实源表、`:80` 切线说明 |
| `release-notes.html:94` | 「多租户 API Key \| v2.1 \| **计划中**」 | Bearer Token 鉴权**已上线**（手册 `:2730-2734`） |
| `index.html:7` vs `:268` | 元数据「版本 v2.3」 vs 页脚「v2.0」 | 互相矛盾 |
| `index.html:46`、`webui-guide.html:126` | 一律写「**KTX WebUI**」 | 应用默认品牌名是「Lucy WebUI」（`webui/src/pages/Login.tsx:19`）；手册只写 `WebUI`；术语标准 §3.0 已把「KTX WebUI 治理控制台」列为**弃用别名** |

### 7.3 【重要】`docs/user-guide/index.html` 的 9 条跨页深链全断

脚本化校验 `href="X.html#id"` vs 目标文件 id 集合：

```
MISSING-ID: workflows.html#meeting, workflows.html#templates, workflows.html#suffix,
             asking-better.html#rules, asking-better.html#rewrite,
             webui-guide.html#semantic-layer, webui-guide.html#wiki,
             trust.html#provenance, mcp-reference.html#tools
```

对应 `index.html:152,153,154,162,163,194,195,217,247` —— 即首页 5 个 hub 卡片里的**全部**深链。

### 7.4 【重要】术语 lint 覆盖不到这两处，且当前是红灯

`webui/scripts/lint-terminology.mjs:22-30` 的扫描根只有 `webui/src`、`webui/server`、`webui/docs` —— **`docs/user-guide/**` 与 `docs/SYSTEM_HANDBOOK.md` 完全不在覆盖范围**。且当前 HEAD 实测**红灯**：

```
$ npm run lint:terminology
Found 1 JSX element(s) rendering high-risk terms without both translate="no" and className="notranslate".
webui/src/components/PolicyDegradeBanner.tsx:87 <Link> renders high-risk term(s) [Agent] without both translate="no" and notranslate
```

（`npm run lint:ia-boundary` 通过。）

另：术语标准 §2.6 要求所有含专业术语的 DOM 节点加 `translate="no"` + `notranslate`，实测 `docs/user-guide/*.html` **16 页全部为 0**（只有两张架构图有），满屏 `Schema` / `Manifest` / `Catalog` / `ktx.yaml` / `enabled_tables` 正是标准列举的「财政部舱单」高危场景。

---

## 8. 修复优先级

### P0 — 阻断（用户可见死链 / 内容丢失 / 内容重复）

| # | 动作 | 位置 |
| --- | --- | --- |
| T1 | 修 `stripLeadingHandbookPreface` 的 H2-only 扫描，或把 §0.0/§0.4 移到 `## 0.` 之后 | `webui/src/pages/HelpCenter.tsx:137-141`；`docs/SYSTEM_HANDBOOK.md:63,78` |
| T2 | 删除重复的「MCP 调试台」孤儿副本 | `docs/SYSTEM_HANDBOOK.md:1556-1597` |
| T3 | 统一锚点规则：正文 `href` 全部改用稳定 slug 词条，slug 规则以 `slugifyHeading` 为唯一源 | `docs/SYSTEM_HANDBOOK.md` 内 24 处失效 `href`（含 `:109,115,118,120,122,131-134,145,417,1074,2371,2674,2707,3071,3170,3186,3221`） |

### P1 — 重要（结构与事实错误）

| # | 动作 | 位置 |
| --- | --- | --- |
| T4 | 给全部中文标题补 `SECTION_ALIASES`，清掉 18 条死别名 | `webui/server/help.ts:30-106` |
| T5 | H4 一律进侧栏目录（改白名单为显式排除） | `webui/server/help.ts:312-360`；`docs/SYSTEM_HANDBOOK.md` 11 个 H4 |
| T6 | 修 §3.7.1 两份错误 YAML 示例（`type`/`dsn` → `driver`/`host`；列表式 `roles` → 映射式） | `docs/SYSTEM_HANDBOOK.md:2060-2069,2116-2123` |
| T7 | 修 §4.4 工具面：移除 `sl_query` / `sl_read_source` 的「按 role 可见」表述 | `docs/SYSTEM_HANDBOOK.md:2792,3142,3201`；对照 `webui/server/proxy/acl.ts:46-53` |
| T8 | 统一手册正文路径为规范路由，别名只留一处附注 | `docs/SYSTEM_HANDBOOK.md:387,484,503,510,553,764,871,924,2498` |
| T9 | 修 §3.9 与 §3.2 的「连接创建」边界冲突 | `docs/SYSTEM_HANDBOOK.md:2540` vs `:487`/`:603`/`:607` |
| T10 | 重写 `docs/user-guide/permissions.html` 与 `mcp-reference.html`（权限模型 / 工具面 / 认证 / 接入方式四块全过时） | `permissions.html:62-115`；`mcp-reference.html:70-169` |
| T11 | 补 `index.html` 9 条跨页深链目标 id | `docs/user-guide/index.html:152,153,154,162,163,194,195,217,247` |
| T12 | 把 `docs/user-guide/**` + `docs/SYSTEM_HANDBOOK.md` 纳入术语 lint 扫描根；先修 `PolicyDegradeBanner.tsx:87` 让门禁回绿 | `webui/scripts/lint-terminology.mjs:22-30` |

### P2 — 重要（可读性与一致性）

| # | 动作 | 位置 |
| --- | --- | --- |
| T13 | KPI 改名：`近 N 调用量`→`调用量（24h）`、`多数请求耗时`→`P95 耗时`、`慢于多数请求`→`慢请求数` | `docs/SYSTEM_HANDBOOK.md:427-434` |
| T14 | 替换行话：`心智`→`对象关系`/`速览`、`切线`/`列车规则`→`版本规则`、`deep dive`→`深入排查`、`门禁`→`发布前检查`、`:9`「不要落」→「请勿手改」 | 手册多处 |
| T15 | 清掉写作脚手架残留：「手册应回答」表、`:1087` 锚点说明、`:2521` 元叙述、`:2525` git commit hash | `docs/SYSTEM_HANDBOOK.md:490-495,1087,2521,2525` |
| T16 | 清掉内部标识泄漏：「M20 YAML 交付 runbook」、`§3.X` 占位符、`3.2.2` / `Role-first 模型` 等悬空引用 | `:3017,3069,3125,3167,2534,696,1306,2552` |
| T17 | 统一引号体系（`「」` 用于界面文案、`“”` 用于强调、正文不加引号） | 手册 24 处 ASCII `"` 等 |
| T18 | 统一占位符规范（以 `ktx.yaml.example` 的 `<CHANGE-ME-*>` 为准，或明示三套各自适用范围） | `:2051` vs `:339-342` vs `:661-665` |
| T19 | 删手写「目录」（`:11-61`），导航交给自动 TOC + §1.5 | `docs/SYSTEM_HANDBOOK.md:11-61` |
| T20 | 统一「白名单」→ 术语标准主术语「启用表范围」 | 手册 26 处；重点 `:2542`、`:3112` 标题 |

### P3 — 次要

- 统一 `webui/docs/user-guide.html` 品牌名；修 `index.html` 版本号 v2.3/v2.0 矛盾
- `data-sources.html` 补 Athena / SQL Server / SQLite
- `release-notes.html` 版本线对齐 `VERSION` = 2.0.0
- `docs/user-guide/*.html` 16 页补 `translate="no"` + `notranslate`
- `lucy-architecture-diagram.html` 的 `var(--glow)` / `var(--delay)`、`lucy-docs-flows.html` 的 `var(--accent)` 未定义 → 相关 CSS 声明整条失效
- `.ref-table-wrap`（`user-guide.css:410`）为死代码，宽表无横向滚动容器
- 6 个标 `WIP` 的页面实际已有完整内容，标记应更新

---

## 9. 建议补的自动门禁

现有 `lint:handbook-baseline`（校验 §0.0 事实源表）与 `lint:handbook-coverage` 之外，建议加三条低成本、高价值的断言：

1. **TOC 可达性**：对 `parseHelpToc()` 输出的每个 id，断言其在「剥离 + 分节」后的 markdown 中存在对应标题 —— 直接堵住 B1。
2. **锚点有效性**：扫描正文所有 `](#…)`，用 `slugifyHeading()` 计算全部标题 id，断言无死链 —— 直接堵住 B2。
3. **术语覆盖**：把 `docs/user-guide/**` 与 `docs/SYSTEM_HANDBOOK.md` 加入 `lint-terminology` 的扫描根 —— 堵住 §7.2 整类矛盾。

---

## 10. 未验证 / 风险

- 本地 dev 实例缺少 `access.yaml` 与 KTX runtime，`/api/health` 返回 `degraded`；**帮助页不依赖这两者**，渲染结论不受影响，但页面上与连接/治理相关的入口未做端到端点击验证。
- 容器实例 `compose-lucy-1`（55176）跑的是 **v0.17.0 旧版镜像**，其内置手册是 §3 重组**前**的版本；本报告全部结论以**工作区当前** `docs/SYSTEM_HANDBOOK.md` 为准。
- `docs/user-guide/**` 的对外发布路径未在仓库内确认；本报告基于 `webui/docs/user-guide.html` 的 meta refresh 指向关系判定其可达性。
- `docs/governance/`、`docs/webui/` 等其他文档树未纳入本轮范围。
- 本轮**未修改任何文件**（仅新建本审阅报告）。`ktx.yaml` 为本地起服所需，从 `ktx.yaml.example` 复制而来，已被 `.gitignore:12` 忽略。
