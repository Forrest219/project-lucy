# Help Q&A Section Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Help Q&A Section Spec |
| 文档类型 | Product / UX / Frontend / Documentation Spec |
| 版本 | v0.5-cross-review |
| 撰写日期 | 2026-08-02；v0.2-cross-review 2026-08-02（吸收 Codex 交叉审阅 6 项：产品方向从"第 6 章新增 Q&A"调整为"改造升级 §0 常见问题速查"）；v0.3-cross-review 2026-08-02（吸收 Codex 第二轮交叉审阅 5 项：测试作用域修正为按独立 `<section>` 定位、测试 helper 改用 `renderHelp`、`SECTION_ALIASES` 补 3 条、inline code 词表与草稿对齐、删 eval 脚本）；v0.4-cross-review 2026-08-02（吸收 Codex 第三轮交叉审阅 4 项：§4.1 修矛盾、测试逻辑改"剥离 code 后不得出现 mandatory 词"、§6.3 词表分两档、TOC 链接 href 断言）；v0.5-cross-review 2026-08-02（修正 Codex 第四轮发现：inline-code 检查排除标题/引用链接、mock fixture 必须同步 toc、Step 1.4 与 DOM 测试同口径、§0.3 标题改为无裸露 Agent 的"面向接入协作者"） |
| 适用范围 | Lucy WebUI Help Center：`/help`、`docs/SYSTEM_HANDBOOK.md` §0 常见问题速查、Help TOC、目录深链与相关前端测试 |
| 架构决议 | 把 §0 常见问题速查升级为按用户场景分组（开发者 / 管理员 / 接入协作者）的快速解答入口；每条 Q&A 一句话答 + 跳到正文章节深链；保留 Help API 单一事实源、不引入搜索依赖、不暴露到 MCP 工具面；不新增第二份 Q&A 入口 |
| 事实源 | `docs/SYSTEM_HANDBOOK.md` §0 line 27–46（已有 13 条 Q&A）、line 1585–1742 §6 FAQ、`webui/server/help.ts` `parseHelpToc` line 116–144、`webui/server/help.ts` `SECTION_ALIASES` line 12–54、`webui/src/components/MarkdownPreview.tsx` 翻译防御范围、`webui/scripts/lint-terminology.mjs` 高风险词扫描范围、2026-08-02 用户反馈 + Codex 交叉审阅 6 项发现 |
| 关联文档 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/30-help-markdown-rendering-spec.md`、`webui/docs/33-help-center-layout-polish-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 背景

2026-08-02 用户反馈：help 缺少常见的 Q&A 入口；用户期望 Q&A 可以引用正文，让快速查找更顺手。

v0.1 假设 help 完全没有 Q&A 模块，准备在第 6 章新增"常见问题快速解答"。

**Codex 交叉审阅发现（2026-08-02）：** `docs/SYSTEM_HANDBOOK.md` 已经在 §0 提供 13 条"常见问题速查"，覆盖开发者 / 管理员 / 接入协作者全部场景，且 `webui/server/help.ts` 已把 §0 映射到 `faq-quick-reference` 深链 ID。

**v0.2 产品决策：升级 §0，不新增第二份 Q&A。** 原 v0.1 第 6 章新增方案被撤掉。

## 2. 决策摘要

升级 §0 常见问题速查，按三种用户角色分组：

- **§0.1 面向开发者**：连接 / 语义层 / YAML / 命令 / 端口相关问题。
- **§0.2 面向管理员**：Agent / Role / Token / 审计 / 配置变更相关问题。
- **§0.3 面向接入协作者**：`MCP` 配置 / 401 / 拒绝 / 轮换 / 过期相关问题；这里的"接入协作者"指接入 `Agent` 的协作者，标题本身不裸露专业英文术语。
- **§0 顶部目录条目保留**（已有）：用户从目录就能直接看到 Q&A 入口。
- **§6 FAQ 与排障指南保持不变**：§6 是故障排查 deep dive，与 §0 是"问题驱动入口 vs 深度排查"的互补关系，不重复造轮子。
- **每条 Q&A 答案一行不超过两行**，核心答案用一句话讲清；详细操作跳到正文章节。
- **关键专业术语必须写成 inline code**（`Agent`、`MCP`、`YAML`、`Role`、`decision_reason`、`expires_at` 等），由现有 `MarkdownPreview` 翻译防御（`code` / `pre` / `table` block 已带 `notranslate`）兜底；不接受在普通文本段落里裸露专业术语的承诺（详见 §7 安全契约）。
- **不动 Help API**（`/api/help/handbook` 固定结构不变）、**不动 Markdown 渲染器**、**不引入搜索依赖**、**不暴露到 MCP 工具面**。

## 3. 目标与非目标

### 3.1 目标

| 目标 | 说明 |
|---|---|
| 升级 §0 Q&A | `docs/SYSTEM_HANDBOOK.md` §0 由 13 条扁平列表升级为按 3 种角色分组的 Q&A |
| 角色场景覆盖 | 开发者 / 管理员 / 接入协作者 三种场景都有专属 Q&A 子节 |
| 引用正文章节 | 每条 Q&A 至少有 1 条到正文章节的可点击深链（沿用 GFM 表格 + markdown 锚点语法） |
| 一句话答 | 每条 Q&A 第一格是一句话答案，不超过两行 |
| 关键术语 inline code | 答案中的 `Agent`、`MCP`、`YAML`、`Role`、`decision_reason`、`expires_at` 等专业术语必须写成 inline code（`` `Agent` `` `` `MCP` `` 等） |
| 保留 §6 故障排查 | §6 第 6.1–6.9 节内容、顺序、锚点全部不变 |
| 安全边界 | Help API、SSOT、Markdown 安全渲染、MCP 隔离全部不变 |
| 回归测试 | help 测试套件覆盖 §0 三种角色分组、深链可达、关键术语 inline code 化 |

### 3.2 非目标

| 非目标 | 理由 |
|---|---|
| 不新增第二份 Q&A | §0 已经存在 Q&A；§6 保持故障排查体；二者职责分明 |
| 不引入搜索 | spec 33 §6 P2 已把搜索列为未来增强；本轮只做 §0 升级 |
| 不改 Help API | `/api/help/handbook` fixed-source envelope 已稳定（spec 30 §2.2） |
| 不改 Markdown 渲染器 | `MarkdownPreview` 已支持 GFM table / code / pre 的 notranslate，本轮不扩展 renderer |
| 不暴露到 MCP 工具面 | Help 内容不进入 `lucy_*` 工具（spec 30 §6） |
| 不在 §6 新增 Q&A 章节 | v0.1 草案被撤掉 |
| 不在 Help 页加 Q&A 卡片墙 | 这是 P2 增强，本轮只做 §0 章节落地 |
| 不做概念辨析 | "角色权限 vs Agent 实例"等对比属于正文章节，不进 §0 |

## 4. 范围

### 4.1 In Scope

- `docs/SYSTEM_HANDBOOK.md` §0 重新组织为 3 个 H3 子节（`### 0.1 面向开发者` / `### 0.2 面向管理员` / `### 0.3 面向接入协作者`）。
- §0 现有的 13 条 Q&A 按角色重新分配到 3 个子节。
- 每条 Q&A 答案里的关键专业术语改为 inline code。
- 每条 Q&A 至少 1 条到正文章节的可点击深链。
- 必要时补充新 Q&A（基于既有 13 条按角色重组后确实缺位的部分，例如"角色权限 vs Agent 实例的差别"**不**补——这属于概念辨析，超出范围）。
- `webui/server/help.ts` `SECTION_ALIASES` 需要新增 3 条 alias：`faq-developer` / `faq-admin` / `faq-agent-integration`（§0 主标题沿用已有 `faq-quick-reference`）。3 个 H3 子节纯中文标题如果走 `stableSlug` 会落到 sha1 短 hash，不友好；手动 alias 是低成本 + 显著可读性提升。
- `webui/src/__tests__/help-center.test.tsx` 新增 §0 渲染、角色分组、术语 inline code 化、深链可达的测试。
- `webui/docs/README.md` 不需要新增索引行（spec 60 v0.5 已收敛为 §0 升级方案，README 现有索引行已覆盖该 spec）。

### 4.2 Out of Scope

- 不引入搜索框、不引入全文索引。
- 不改 Markdown 渲染器（`MarkdownPreview.tsx` 不动）。
- 不改 Help API envelope。
- 不改 Wiki 编辑能力。
- 不在 §6 新增 Q&A 章节。
- 不做概念辨析。
- 不暴露 §0 内容到 MCP 工具面。
- 不引入链接校验工具（验收靠手动锚点对照）。

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None.

Required UI terms:

| 概念 | UI 主术语 | 备注 |
|---|---|---|
| Help Center | `系统手册` | 左下入口、页面标题和 Tooltip 沿用 |
| Q&A Quick Reference | `常见问题速查` | §0 章节标题（沿用现有命名，不改名） |
| Scenario Group | `面向开发者` / `面向管理员` / `面向接入协作者` | §0 三个 H3 子节标题前缀；"接入协作者"指接入 `Agent` 的协作者 |
| Deep Link | `深链` | Spec / Plan 中可使用，UI 中优先不暴露 |

Allowed supplements:

- 章节内允许出现"问题"、"答案"、"快速诊断"等口语化措辞。

Forbidden terms（参考 `00` §3 全局术语表与 §6.1 forbidden list）：

- `财政部舱单`、`舱单`、`替代测试`、`上传报价包`、`添加架构`、`目标架构`、`模式清单`、`重新加载资产` —— 沿用 spec 30 禁止项。

Browser translation defense：

> **重要约束：** 现有 `MarkdownPreview` 翻译防御仅覆盖 `code` / `pre` / `table` 三类 block（`webui/src/components/MarkdownPreview.tsx` line 59 / 328 / 348）；普通文本段落（`<p>`）无法通过 markdown 内容附加 DOM 属性。
>
> 因此本规格对翻译防御的要求**收窄为**：所有专业英文术语（`Agent`、`MCP`、`YAML`、`Role`、`Schema`、`Manifest`、`Catalog`、`KTX`、`access.yaml`、`ktx.yaml`、`decision_reason`、`expires_at`、`Endpoint`、`Token`、`Runtime`、`Eval Run` 等）必须写成 inline code 或 fenced code block，依赖现有 renderer 的 notranslate 兜底。
>
> 不接受"在普通文本段落里靠 markdown 加 DOM 属性"的承诺——这是 renderer 能力边界。
>
> Linter 范围对齐：`scripts/lint-terminology.mjs` line 174–181 高风险词扫描只覆盖 `.tsx`；本轮 §0 改动在 `.md` 内，linter 不会扫到，必须靠 review 阶段人工对照。
>
> §0 的 H3 标题和 TOC 文本不支持局部 `notranslate`，因此标题层面避免裸露专业英文术语：第三个场景标题使用 `面向接入协作者`，不使用 `面向接入 Agent 的协作者`。Q&A "详见"列中的链接文本引用既有 handbook 标题，可能包含现有标题中的专业英文；inline-code 强制检查只覆盖 Q&A 问题与快速答案正文，不把标题和引用链接文本纳入裸露术语失败条件。

Mandatory inline-code 列表（§0 答案中遇到这些术语必须写 `` `术语` ``）：

> 本节分两档：**A. 必须出现且 inline code 化**——这是 §0 草稿明确写出且必须 inline code 化的术语，测试既验证它们在 `<code>` 内、也验证剥离 `<code>`、heading 和内部引用链接后，Q&A 问题与快速答案正文不再包含；**B. 若出现则必须 inline code 化**——这些是仓库其它模块（`/admin/roles` 列表、`/eval/runs` 等）翻译防御对象，§0 草稿不强求出现，但若 §0 出现必须 inline code 化。

#### A. 必须出现且 inline code 化

§0 Step 1.2 草稿明确包含以下术语，每条都必须用 `` `词` `` 形式；测试剥离 `<code>`、heading 和内部引用链接后，§0 三个子 section 的 Q&A 问题与快速答案正文不得再出现这些词。

- `Agent`（4 处）、`MCP`（3 处）、`YAML`（1 处）、`Schema`（1 处）、`KTX`（2 处）、`access.yaml`（1 处）、`ktx.yaml`（4 处）、`overlay`（4 处）、`reindex`（4 处）、`grain`（1 处）、`measures`（1 处）、`segments`（1 处）、`Bearer`（1 处）、`metadata`（1 处）、`Admin`（2 处）、`API`（1 处）、`GO / NO-GO`（1 处）、`MCP smoke`（1 处）、`sl read`（1 处）、`sl validate`（1 处）、`decision_reason`（1 处）、`expires_at`（2 处）、`Docker`（2 处）、`Vite 5173`（1 处）、`API 5174`（1 处）、`Lucy MCP Proxy 7879`（1 处）、`WebUI`（3 处）、`file:`（1 处）、`env:`（1 处）、`commit message`（1 处）、`source`（1 处）、`role`（2 处）、`token`（4 处）、`ACL`（1 处）、`Access denied`（1 处）。

#### B. 若出现则必须 inline code 化

§0 草稿不强求出现，但若 §0 出现必须用 `` `词` `` 形式（仓库其它模块的翻译防御延续到 §0 范围）。

- `Manifest`、`Catalog`、`Role`、`Token`、`Endpoint`、`Eval Run`、`Runtime`、`enabled_tables`、`tools/list`、`tools/call`、`OK`、`OK 状态`、`401`、`metadata` 之外的其它英文状态。

**测试契约：**

1. 对 A 档每条术语：
   - 剥离 §0 三个子 section 内所有 `<code>`、heading（`h1`–`h6`）和内部引用链接（`a[href^="#"]`）后，Q&A 问题与快速答案正文中不得再出现该术语（即"答案正文裸露出现即失败"）。
   - 三个子 section 的 `<code>` 节点文本集合中至少包含该术语一次（即"§0 答案里必须 inline code 化"）。
2. 对 B 档每条术语：
   - 仅当 §0 任意位置出现时才校验 inline code 化；§0 完全没出现则跳过（不强制 B 档词必须出现）。

Example:

```tsx
// 等价在 markdown 中：
| Q | A |
|---|---|
| ... | ... 用 `Agent` token 调 `tools/call` 时返回 `Access denied: table_forbidden:<table>`，... |
```

## 6. 内容结构

### 6.1 §0 大纲（v0.5）

```text
## 0. 常见问题速查

本节是按用户问题组织的快速入口。每条答案给下一步判断；完整操作以正文章节为准。
常见问题按三种角色分组：开发者 / 管理员 / 接入协作者。
第 6 章 FAQ 与排障指南 是配套的故障排查 deep dive。

### 0.1 面向开发者
（13 条 Q&A 按角色重新分配后归到这里）

### 0.2 面向管理员
（同上）

### 0.3 面向接入协作者
（同上）
```

### 6.2 13 条 Q&A 的角色分配

| 原 §0 编号 | 原问题 | 新归属子节 | 备注 |
|---|---|---|---|
| 1 | 我在哪里新建数据库连接？ | §0.1 面向开发者 | 数据库连接是开发者职责 |
| 2 | 数据库密码应该放在哪里？ | §0.1 面向开发者 | secret 配置是开发者职责 |
| 3 | 点了刷新本地目录，刷新后的表在哪里看？ | §0.1 面向开发者 | catalog reload 是开发者操作 |
| 4 | 为什么提示"未发现本地 manifest"？ | §0.1 面向开发者 | manifest 维护是开发者职责 |
| 5 | YAML 改完后为什么 Agent 仍然搜不到新口径？ | §0.1 面向开发者 | reindex 流程是开发者职责 |
| 6 | 我应该改 manifest 还是 overlay？ | §0.1 面向开发者 | manifest vs overlay 是开发者语义 |
| 7 | 新增指标怎样才算可以交付？ | §0.1 面向开发者 | GO/NO-GO 是开发者交付清单 |
| 8 | Agent 返回 `Access denied` 时先查哪里？ | §0.2 面向管理员 | 管理员排查 Agent 拒绝 |
| 9 | MCP 返回 401 是什么原因？ | §0.3 面向接入协作者 | 客户端问题，协作者关心 |
| 10 | `expires_at` 到期后 token 会自动失效吗？ | §0.2 面向管理员 | 管理员负责 token 生命周期 |
| 11 | 新连接什么时候对 Agent 可见？ | §0.2 面向管理员 | 管理员负责 ACL 同步 |
| 12 | 本地开发应该访问哪个端口？ | §0.3 面向接入协作者 | 客户端需要端口信息 |
| 13 | 评测用例和运行历史在哪里？ | §0.1 面向开发者 | eval case/runs 是开发者维护 |

### 6.3 关键术语 inline code 化（必做）

> v0.4-cross-review：本节旧版按"第 1 条 / 第 2 条 / ..."逐条列出 required inline code 词，与 v0.3 "未出现不强求" 口径不完全一致。v0.4 改为统一词表（见 §6.3 顶部 A/B 两档），本节不再保留逐条清单。§0 草稿（plan Step 1.2 line 78–112）的术语已并入 §6.3 A 档。

**每条 Q&A 答案中的以下词必须改为 `` `词` `` 形式：** 参见 §6.3 顶部 A/B 两档词表，A 档是必须出现且 inline code 化的术语集合，B 档是若出现则必须 inline code 化的术语集合。

**草稿逐条参考（保留供实现阶段对照 §0 答案用）：**

- 第 1 条（`0.1 面向开发者`）：`WebUI`、`ktx.yaml`、`secret`、路径 `[3.2 数据库接入]` `[WebUI 与 ktx.yaml 的职责边界]`。
- 第 2 条：`file:`、`env:`、`ktx.yaml`、`commit message`、`聊天记录`、路径 `[连接形态与配置字段]` `[5.2 ktx.yaml]`。
- 第 3 条：`/connections`、`/connections/whitelist`、`WebUI`、`/`、路径 `[刷新本地目录]`。
- 第 4 条：`ktx.yaml`、`Schema`、`semantic-layer/<conn>/_schema/<schema>.yaml`、路径 `[6.1 ...]`。
- 第 5 条：`YAML`、`Agent`、`KTX`、`MCP`、`ktx admin reindex`、`sl read`、`overlay`、`source`、路径 `[6.3 ...]` `[3.7.6.2 ...]`。
- 第 6 条：`manifest`、`overlay`、`grain`、`measures`、`segments`、路径 `[3.3 ...]` `[3.7.1 ...]`。
- 第 7 条：`reindex`、`sl validate`、`sl read`、`MCP smoke`、`GO / NO-GO`、路径 `[3.7.6 ...]`。
- 第 8 条（`0.2 面向管理员`）：`Agent`、`Access denied`、`decision_reason`、`/admin/audit`、`/api/admin/audit`、`role`、路径 `[6.2 ...]` `[3.5 ...]`。
- 第 9 条：`MCP`、`401`、`Bearer`、`token`、`hash`、`access`、路径 `[6.5 ...]`。
- 第 10 条：`expires_at`、`metadata`、`Admin`、`API`、路径 `[3.5 ...]` `[6.5 ...]`。
- 第 11 条：`ktx.yaml`、`manifest`、`overlay`、`enabled_tables`、`KTX reindex`、`access.yaml`、`role`、`ACL`、`Agent`、路径 `[Agent 可见性与 ACL 同步]` `[新增数据库连接（运维 Runbook）]`。
- 第 12 条（`0.3 面向接入协作者`）：`Vite 5173`、`API 5174`、`Lucy MCP Proxy 7879`、`Docker`、`55176`、路径 `[2.2 本地启动]` `[4.1 接入地址]`。
- 第 13 条：`/eval/cases`、`/eval/runs`、`/eval/monitor`、路径 `[3.6 质量评测 Eval]`。

**注意：** 本节保留作为实现阶段"逐条 Q&A 答案"对照参考；测试断言以 §6.3 顶部 A/B 两档词表为准，**不**直接对照本节列表。

### 6.4 深链锚点

§0 主标题保留现有 alias `faq-quick-reference`。三个 H3 子节**手动补 3 个 alias**（避免纯中文 stableSlug 落到 sha1 短 hash）：

- `### 0.1 面向开发者` → `faq-developer`
- `### 0.2 面向管理员` → `faq-admin`
- `### 0.3 面向接入协作者` → `faq-agent-integration`

**理由：** `webui/server/help.ts` `stableSlug` line 94–102 对纯中文标题会返回空字符串，最终落到 sha1(`title`).slice(0,10) 短 hash（例如 `0e8cf24a91`），不利于可读深链、跨文档引用和 review 引用。手动 alias 是低成本 + 显著可读性提升。

`SECTION_ALIASES` 新增条目（在 `faq-quick-reference` 后追加）：

```ts
[/面向开发者/, "faq-developer"],
[/面向管理员/, "faq-admin"],
[/面向接入协作者|面向接入 Agent 的协作者|接入 Agent 的协作者/, "faq-agent-integration"]
```

实现阶段必须在 Phase 2 Step 2.1 用 `parseHelpToc` 跑一次实际输出，确认三个 H3 子节 ID 为 `faq-developer` / `faq-admin` / `faq-agent-integration`，记录到 inbox 收尾参考。

**Section ID 唯一性约束：** 三个新 alias 必须与现有 `SECTION_ALIASES` 不冲突；如果未来 handbook 新增"面向开发者"等其它章节，需要重新评估。

## 7. UX 契约

### 7.1 TOC 与深链

| UI 元素 | 要求 |
|---|---|
| TOC §0 条目 | 已存在（`[0. 常见问题速查]`）；保留不删 |
| TOC §0 子节 | §0.1 / §0.2 / §0.3 三个 H3 子节按现有 TOC 规则展示 |
| 深链定位 | `/help?section=faq-quick-reference` 滚动到 §0 顶部；`/help?section=<子节 ID>` 滚动到对应子节 |
| 当前项高亮 | TOC 中当前 section 子节 `aria-current="location"`（沿用 spec 33 §5.1） |
| §6 保持 | 第 6 章及其 9 个 H3 子节内容、顺序、锚点全部不变 |

### 7.2 §0 阅读体验

| UI 元素 | 要求 |
|---|---|
| 引言段 | 明确说"§0 是问题驱动入口，按 3 种角色分组；§6 是故障排查 deep dive" |
| Q&A 表格 | 用 GFM pipe table 渲染，问题 / 快速答案 / 详见 三列 |
| 关键术语 | 必须写成 inline code，依赖现有 renderer 的 notranslate 兜底 |
| 一句话答 | 不超过两行；详细操作只跳深链 |
| 正文深链 | 使用相对锚点（如 `[3.5 访问治理 Admin](#35-访问治理-admin)`），浏览器渲染为可点击链接 |

### 7.3 Help 页导航

| 项 | 要求 |
|---|---|
| 顶部入口 | 不新增；`? 系统手册` 仍是唯一定位 |
| HelpButton | 不改 |
| 搜索入口 | 不新增；与 spec 33 §6 P2 保持一致 |

## 8. 安全契约

| 风险 | 要求 |
|---|---|
| raw HTML 注入 | §0 Markdown 文本中的 `<script>` 等必须显示为文本，不生成真实 HTML 节点（沿用 spec 30 §6） |
| 死链 | 每条 Q&A 答案里的正文深链必须存在；Phase 4 跑手动锚点对照（详见 §10 验收） |
| 路径穿越 | 不改 Help API；§0 不传 path，只传 section id |
| MCP 暴露 | §0 不进入 `lucy_*` 工具面（沿用 spec 30 §6） |
| 角色权限 / token / connection 示例 | §0 不展示真实 role id / token hash / connection id；统一用占位符或 inline code |
| 翻译防御 | 关键专业术语必须 inline code；不接受普通文本段落里的术语承诺（renderer 边界） |
| 误以为 expires_at 自动下线 | §0 第 10 条答案必须明确"`expires_at` 只是 metadata，不会自动失效"（沿用 §6.5 + spec 60 v0.1 §8） |

## 9. 测试契约

### 9.1 必跑测试

| 测试文件 | 覆盖点 |
|---|---|
| `webui/src/__tests__/help-center.test.tsx` | §0 渲染 3 个 H3 子节；TOC 出现 `常见问题速查` 与 3 个角色子节；深链滚动到对应子节 |
| `webui/src/__tests__/help-center.test.tsx` | §0 关键术语 inline code 化按 §6.3 A/B 两档校验：A 档每条必须出现且必须 inline code（剥离 `<code>`、heading、内部引用链接后不得再出现在 Q&A 问题与快速答案正文）；B 档若出现则必须 inline code。**禁止**"term 在任意 `<code>` 内即通过"的伪断言（旧 v0.3 测试逻辑有漏洞）。具体实现见 plan Step 3.2 |
| `webui/src/__tests__/help-center.test.tsx` | §0 答案里的正文深链指向真实存在的锚点（基于渲染后 DOM 验证，不是字符串匹配） |
| `webui/src/__tests__/help-center.test.tsx` | §0 不出现 forbidden 术语（沿用 spec 30 §6.1） |
| `webui/server/__tests__/help.test.ts` | §0.1 / §0.2 / §0.3 三个 H3 子节被 `parseHelpToc` 正确收，并产生 alias `faq-developer` / `faq-admin` / `faq-agent-integration` |

### 9.2 推荐命令（**不用 pretest**）

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
# 直接跑 focused tests，跳过 pretest lint（避免无关脏改动阻塞）
npx vitest run src/__tests__/help-center.test.tsx
npx vitest run server/__tests__/help.test.ts
```

**禁止**使用 `npm test -- help-center` 或 `npm test` 的形式——`pretest` 会跑 `npm run lint:terminology && npm run lint:ia-boundary`，当前工作区有 90+ 个无关脏改动，lint 必挂。验收仅以 focused vitest 为准。

### 9.3 推荐命令（build）

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run build
```

build 不依赖 pretest；用于回归渲染管线。

## 10. 验收标准

| 验收项 | 标准 |
|---|---|
| §0 子节分组 | `docs/SYSTEM_HANDBOOK.md` §0 升级为 3 个 H3 子节：`§0.1 面向开发者` / `§0.2 面向管理员` / `§0.3 面向接入协作者` |
| 13 条全部归位 | 原 13 条 Q&A 按 §6.2 角色分配表归位；无 Q&A 被丢弃 |
| 关键术语 inline code | §6.3 A 档词全部出现且写为 `` `词` ``；B 档词若出现在 Q&A 问题与快速答案正文中，也必须写为 `` `词` `` |
| 深链可达 | 每条 Q&A 至少 1 条到正文章节的可点击深链；Phase 4 手动锚点对照无死链 |
| TOC 渲染 | `/help` TOC 中 `常见问题速查` 与 3 个子节都可见；§0.1 / §0.2 / §0.3 各自有稳定 alias ID（`faq-developer` / `faq-admin` / `faq-agent-integration`） |
| 翻译防御 | Q&A 问题与快速答案正文中的关键专业术语全部在 `<code>` 节点内；标题避免裸露专业英文，引用链接文本按既有 handbook 标题保留 |
| 现有 §6 不变 | 第 6 章 line 1585–1742 内容、顺序、9 个 H3 锚点全部不变 |
| 顶部目录 | handbook line 10–25 顶部目录保留 `[0. 常见问题速查]` 条目 |
| 边界 | Help API / SSOT / Markdown 安全渲染 / MCP 隔离全部不变 |
| 测试 | `npx vitest run src/__tests__/help-center.test.tsx` 和 `npx vitest run server/__tests__/help.test.ts` 通过 |
| 构建 | `npm run build` 通过 |
| lint 防御 | §0 不出现 forbidden 术语；专业术语 inline code 化由 Phase 3 Step 3.2 校验 |

## 11. Rollout Notes

本规格是 Help Center §0 内容升级：

- 不需要数据迁移。
- 不修改 Help API。
- 不修改 KTX daemon。
- 不引入新依赖。
- 不修改 Markdown 渲染器。

上线后用户：

1. 在 `/help` 顶部目录看到 `0. 常见问题速查`（已存在）。
2. 滚动到 §0 看到 3 个角色子节（开发者 / 管理员 / 接入协作者），按角色快速定位问题。
3. 任何时候原有 §6 故障排查章节照常可用。

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 13 条 Q&A 重新分组可能漏掉某些场景 | Phase 1 Step 1.4 跑一遍原 13 条与新子节映射；缺位的（如有）单独记录到 Issue；本轮不补 Q&A |
| §6.3 术语 inline code 化漏字 | Phase 3 DOM 测试剥离 `<code>`、heading 和内部引用链接后校验 Q&A 问题与快速答案正文；grep 仅作辅助，不作为最终判定 |
| §0 子节 stableSlug 在中英混排下不稳定 | 通过 3 条 `SECTION_ALIASES` 固定为 `faq-developer` / `faq-admin` / `faq-agent-integration`；后端 `parseHelpToc` 测试直接覆盖 |
| 普通文本段落里的术语被浏览器翻译 | §0 问题与快速答案正文中的专业术语全部 inline code；H3 标题改用中文"面向接入协作者"避免裸露 `Agent`；引用链接文本沿用既有标题 |
| 用户期待搜索 | 引言段明确"§0 是按角色的问题清单，不是搜索"；搜索仍走 spec 33 §6 P2 |
| §6 与 §0 误读为双入口 | §0 引言段明确两者互补关系；§6 第一段（已有）不修改，避免重叠解释 |
| Linter 不扫 .md | Phase 3 DOM 测试覆盖 inline code 化；grep 仅作辅助检查，不依赖 lint |
| 真实 role id / token / connection 泄露 | §0 不展示真实示例 ID；统一用 inline code + 占位符 |

## 13. Definition Of Done

- `docs/SYSTEM_HANDBOOK.md` §0 升级为 3 个 H3 子节（第三节标题为 `0.3 面向接入协作者`）；13 条 Q&A 按角色重新分配。
- 每条 Q&A 答案中的关键术语按 §6.3 列表 inline code 化。
- 每条 Q&A 答案至少 1 条到正文章节的可点击深链。
- §6（FAQ 与排障指南）line 1585–1742 内容、顺序、锚点全部不变。
- handbook 顶部目录 line 10–25 保留 `[0. 常见问题速查]` 条目。
- `webui/server/help.ts` `SECTION_ALIASES` 在 `faq-quick-reference` 之后追加 3 条：`faq-developer` / `faq-admin` / `faq-agent-integration`。
- `npx vitest run src/__tests__/help-center.test.tsx` 通过。
- `npx vitest run server/__tests__/help.test.ts` 通过。
- `npm run build` 通过。
- §0 不出现 forbidden 术语。
- 关键术语 inline code 化通过 Phase 3 DOM 测试；辅助 grep 不作为最终判定。
