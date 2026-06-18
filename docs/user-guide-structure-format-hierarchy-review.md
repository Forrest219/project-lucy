# project-lucy user-guide 页面结构 / 展示格式 / 视觉层级 检查报告

| 元数据 | 内容 |
|---|---|
| 文档名称 | project-lucy user-guide 页面结构 / 展示格式 / 视觉层级 检查报告 |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-19 |
| 撰写人 | Claude |
| 委托人 | project-lucy 团队 |
| 基于材料 | docs/user-guide/*.html（10 个页面）+ assets/user-guide.css |
| 适用范围 | 帮助文档改版前的结构 / 格式 / 视觉层级体检；不改正文、不动文件 |
| 输出位置 | /Users/zhangxingchen/Projects/project-lucy/docs/user-guide-structure-format-hierarchy-review.md |

通读了 10 个页面与 `assets/user-guide.css`。下面是按 **结构 / 格式 / 视觉层级** 三块的检查清单（不动正文、不修改文件）。

---

## 一、页面结构

### S1. user-guide 目录里并存 **4 套视觉系统**，没有统一基线

| 页面 | 主题 | 布局 | CSS 来源 |
|---|---|---|---|
| `index.html` | 暗色 hero | 顶部 sticky nav + 右侧 fixed page-toc | **内联** `<style>`（行 7-407） |
| `getting-started / concepts / workflows / asking-better / trust / troubleshooting` | 米白 paper + 墨绿 sidebar | 左侧 sticky sidebar | `assets/user-guide.css` |
| `webui-guide.html` | 浅灰 + 深色 header + 浅蓝强调 | 顶部 dark header + 浅色 sticky sidebar | **内联** `<style>`（行 7-369） |
| `eval-meta-governance-training.html` | 暗色 | 顶部横向 chip nav + 右侧 fixed page-toc | **内联** `<style>`（行 20-601） |

→ 用户从首页（暗）→ 子页（米白）→ webui（浅灰）→ eval-training（暗）经历 4 次主题切换，没有过渡。**这是这套帮助文档最显眼的结构问题**。

### S2. sidebar 导航与首页导航不一致

- `index.html` 行 26-44 把 9 个页面分成「开始 / 使用 / 可信」3 组
- 其余 6 个 user-guide 子页 sidebar 是单组「页面」只列 7 项，**漏掉 `product-intro.html`、`webui-guide.html`、`eval-meta-governance-training.html`**
- 这 3 个被漏的页面都不是从 user-guide 子页能跳到的，**闭环断了**：用户进 `getting-started` 后想去看「产品介绍 / WebUI 说明 / eval 培训」，没有入口

### S3. 「产品介绍」身份重叠

- `index.html` 自身就是一份 `#hero / #problem / #features / #workflow / #compare / #scope` 的产品营销长页（暗色主题）
- 但 sidebar 又把「Lucy 产品介绍」链接到独立的 `product-intro.html`
- 两份「产品介绍」职责没区分：谁负责营销首页、谁负责细节文案，未在结构上拆清

### S4. `trust.html` 引用 user-guide 外部链接

- 行 105-112 两个并列 callout：「Eval 元治理培训」（help 内部子页）+ 「内部架构参考」(`../project-overview.html`)。后者跳到 docs 顶层，从「帮助中心」出去后再回来没有视觉/导航提示
- 这暴露 user-guide **没有声明自己与其他 docs 的边界**

### S5. 缺失「上一篇 / 下一篇」导航

- 所有 user-guide 子页 footer 只有「返回帮助中心首页」（如 `getting-started.html` 行 73）
- 没有 prev/next 顺序导航，用户在长流程里只能靠 sidebar 跳

---

## 二、展示格式

### F1. `callout` 组件分裂

- `assets/user-guide.css` 行 189-196：`.callout`（teal 左 border） + `.warning`（仅改左 border 为红，**无背景区分**）
- `eval-meta-governance-training.html` 行 325-333：独立 `.callout`（蓝色半透明背景 + 蓝色左 border）
- 同名同语义，三套样式

### F2. inline `style="border-top: 4px solid var(--teal/gold/red/deep)"` 散落

- `trust.html` 行 47、51、55
- `troubleshooting.html` 行 47、55、63

→ 这些「场景卡片」用 ad-hoc inline 颜色定义替代了一个正式的 `.card.boundary-{teal|gold|red}` modifier。`webui-guide.html` 行 228-231 反而定义了 `.tr.boundary-danger`，三种写法并存。

### F3. `<pre>` 复制按钮只在 eval-training 有

- `eval-meta-governance-training.html` 行 1244-1270 注入 `<script>` 给所有 `<pre>` 加 `.copy-code` 按钮
- 其他有 `<pre>` 的页面（`webui-guide` / `eval-meta-governance-training` 之外）都没有
- 同一种 syntax 块，交互行为不一致

### F4. 页面内目录（page-toc）只在 2/10 页面有

- `index.html` 行 423-431 右侧 fixed `.page-toc`
- `eval-meta-governance-training.html` 行 605-618 同样右侧 fixed `.page-toc`
- user-guide 其余 6 页 H2 多达 3-5 个，**完全没有 page-toc**

### F5. eyebrow / tag / badge 同义不同实现

| 概念 | user-guide.css | webui-guide | eval-training | index.html |
|---|---|---|---|---|
| eyebrow | 行 101-110 teal 框 | 行 45-52 白色大写 | 行 63-76 蓝色框大写 | — |
| tag / pill | `.tag` 行 178-187 | `.tag` / `.badge` 行 165-175 / 319-327 | `.pill` / `.tag` 行 101-111 / 359-367 | `.feature-tag` 行 210-218 |
| callout | `.callout` | `.note` 行 242-247 | `.callout` | 无（用 `.scope-box`） |

→ 4 套实现，没有组件层抽象。

### F6. 表格头部渐变 3 种

- `user-guide.css` 行 226-230：`#f1eadf → #e8dfd1`（暖米）
- `webui-guide.html` 行 218-222：`#f6f8fb → #eef2f7`（浅灰）
- `eval-meta-governance-training.html` 行 261-265：`#252c3b → #1f2634`（深蓝）

→ 同语义元素 3 套视觉。

### F7. `<code>` 颜色与背景 3 种

- `user-guide.css` 行 238-245：浅米 `--code: #eef0e8`
- `webui-guide` 行 233-240：浅灰 `#eef2f7`
- `eval-meta-governance-training` 行 274-281：深色 `--code: #0b0e14` + 蓝字 `#d9e6ff`

---

## 三、视觉层级

### V1. Hero 字号梯度不一致

| 页面 | h1 |
|---|---|
| `index.html` | `clamp(48px, 7vw, 80px)`（最大 80px） |
| user-guide.css | `clamp(38px, 6vw, 68px)`（最大 68px） |
| `webui-guide.html` | 固定 42px |
| `eval-meta-governance-training.html` | `clamp(34px, 5vw, 58px)`（最大 58px） |

→ 同一站点的 hero h1 极值跨 22px。建议先固定一个 hero 字号档，再让各页按层级递减。

### V2. Section 间距不一致

- `user-guide.css` 行 124：`h2` 距上 `52px`
- `eval-meta-governance-training.html` 行 174-176：`section` 距上 `64px`
- `webui-guide.html` 行 109-113：`section` 之间 `margin-bottom: 18px`（靠 border 紧贴）
- `index.html` 行 38：`section { padding: 84px 0; }`（最大留白）

→ 4 套节奏，用户上下滚动时节奏感来回切换。

### V3. 响应式断点不一致

- `user-guide.css`：`max-width: 880px`
- `index.html`：`max-width: 900px`
- `webui-guide.html`：`max-width: 860px` + `print` 媒体
- `eval-meta-governance-training.html`：`max-width: 980px` + `640px`

→ 4 个断点 + 4 套行为，测试矩阵大；建议收敛到 ≤ 2 个全局断点。

### V4. 色彩主题断层

- `index.html`：暗 + 蓝/青/紫渐变
- user-guide 子页：米白 paper + 墨绿 sidebar
- `webui-guide`：浅灰 + 深 header + 浅蓝
- `eval-meta-governance-training`：暗 + 蓝/青/绿/琥珀/红

→ 没有「深阅读页 vs 短读页」或「业务用户 vs 治理用户」的色彩分工规则。从用户角度，每次切换都在适应新调色板。

### V5. 单页密度落差大

- `eval-meta-governance-training.html`：11 section + 大量 panel/table/pre
- `webui-guide.html`：11 section + 4 个表
- `getting-started.html`：2 section + 1 表 + 1 callout

→ 长阅读页与短阅读页之间没有渐变节奏。

### V6. 「h2 + 下划线」风格分裂

- `user-guide.css` 行 124-129：h2 用 `border-bottom: 1px solid var(--line)` + 内边距 10px
- `eval-meta-governance-training.html` 行 178-186：h2 同样 `border-bottom`，但 padding-bottom 12px + 字号 26px
- `webui-guide.html` 行 115-119：h2 **无 border-bottom**，靠 `<section>` 的卡片边框分隔
- `index.html` 行 49-54：`.section-title` 无 border，依赖外层 section 的 top border

→ h2 在 3 套体系里是 3 种语义：章节标题 / 卡片标题 / hero 段落标题。

### V7. CTA / 行动呼吁缺统一位

- 「返回首页」只出现在 footer 一行
- 没有「下一步建议」「上一篇/下一篇」「试试这个模板」之类的固定模块
- 每页 callout 是散落的，使用率（`getting-started` 行 67 / `trust` 行 84 / `workflows` 行 70 / `asking-better` 行 68 / `troubleshooting` 行 51 / `trust` 行 106）依赖作者直觉

---

## 优先级建议（不动正文、不改文件）

| 优先级 | 建议方向 |
|---|---|
| **P0** | 决定 user-guide 是「单套视觉系统」还是「明确两套（用户向 / 治理向）」。如果是前者，把 `index.html` / `webui-guide` / `eval-meta-governance-training` 三处内联样式迁到 `assets/user-guide.css` 同源；如果是后者，写一段两套系统的「导航契约」 |
| **P0** | 把 sidebar 7 项补齐到 9 项（加上 product-intro / webui-guide / eval-meta-governance-training），或把首页 nav-groups 拆掉统一 |
| **P1** | 把 `.callout` / `.eyebrow` / `.tag` / `.page-toc` / `.card.boundary-*` 抽成 user-guide.css 命名约定，让 inline style 全部退出 |
| **P1** | 把 hero h1 字号、section 间距、断点收敛到 ≤ 2 个全局值 |
| **P2** | 给 user-guide 子页加 prev/next 导航 + page-toc（仅长页面） |
| **P2** | 决定 `index.html` 和 `product-intro.html` 谁是入口、谁是子页，避免身份重叠 |