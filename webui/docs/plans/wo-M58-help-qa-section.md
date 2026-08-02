# M58 Help Q&A Section Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 升级 `docs/SYSTEM_HANDBOOK.md` §0 常见问题速查为按 3 种用户角色分组的 Q&A（开发者 / 管理员 / 接入协作者），每条 Q&A 一句话答 + 跳到正文章节深链 + 关键术语 inline code 化；§6 FAQ 与排障指南 保持不变；补 3 条 `SECTION_ALIASES`；不引入搜索、不暴露到 MCP 工具面、不改 Help API 与 Markdown 渲染器。

**Architecture:** 文档层（handbook §0 重组 + 术语 inline code 化）+ 后端测试层（验证 3 个 H3 子节被 parseHelpToc 正确收）+ 前端测试层（验证 §0 渲染 + 角色子节 + inline code 节点 + 深链可达 + 不出现 forbidden 术语）。Help API / Markdown 渲染器 / Wiki 编辑能力 / KTX upstream 全部保持不变。

**Tech Stack:** Markdown, Fastify, React, TypeScript, Vite, Vitest, Testing Library. No new runtime dependency.

**Source Spec:** [../60-help-qa-section-spec.md](../60-help-qa-section-spec.md)（v0.4-cross-review）

---

## Context For Developer

Read these documents before editing:

- `webui/docs/60-help-qa-section-spec.md` v0.4-cross-review
- `webui/docs/30-help-markdown-rendering-spec.md`
- `webui/docs/33-help-center-layout-polish-spec.md`
- `webui/docs/00-product-terminology-standard.md`
- `docs/SYSTEM_HANDBOOK.md` §0 line 27–46（13 条 Q&A 起点）+ §6 line 1585–1742（保持不变）
- `docs/DEVELOPMENT.md`

Inspect these implementation files:

- `webui/src/pages/HelpCenter.tsx`
- `webui/src/components/HelpButton.tsx`
- `webui/src/components/MarkdownPreview.tsx`（line 59 / 328 / 348 翻译防御覆盖范围）
- `webui/server/help.ts` `parseHelpToc` line 116–144 / `SECTION_ALIASES` line 12–54 / `sectionIdFor` line 103–107
- `webui/scripts/lint-terminology.mjs` line 174–181 高风险词扫描只覆盖 `.tsx`
- `webui/src/__tests__/help-center.test.tsx`
- `webui/server/__tests__/help.test.ts`

Non-negotiable boundaries:

- Do not change the Help API route or response envelope (`/api/help/handbook` 固定结构不能动)。
- Do not introduce a second fact source for Help content; §0 Q&A 必须住在 `docs/SYSTEM_HANDBOOK.md`。
- Do not add search, full-text index, or any external dependency.
- Do not expose Help content (including §0) through MCP tools.
- Do not render raw HTML from Markdown.
- Do not edit `.ktx/secrets/**`, `ktx.yaml`, or semantic YAML for this work order.
- Do not modify §6 FAQ 与排障指南（line 1585–1742）任何内容、顺序、锚点。
- Do not modify handbook 顶部目录（line 10–25），`[0. 常见问题速查]` 条目已存在不删。
- Do not modify `MarkdownPreview.tsx`；本轮翻译防御依赖现有 renderer 能力（`code` / `pre` / `table` block 已带 notranslate）。
- Do not use real role id / token hash / connection id in §0 examples; use placeholders or inline code references.
- Do not skip the "§0 是问题驱动入口，§6 是配套的故障排查 deep dive" 引言段。
- Do not use `npm test -- ...` form（pretest 会跑 lint 阻塞无关脏改动）；本任务验收**只用** `npx vitest run <file>` 直接跑 focused tests。
- Do not use 占位编号（`§0.X` `6.X` `6.A–6.I`）；必须写实编号。
- Do not write tests that assume a non-existent helper. Use `renderHelp(path = "/help")` from `webui/src/__tests__/help-center.test.tsx:9`; do not invent `renderHelpAt`.
- Do not write tests that query §0 content under `#faq-quick-reference`. `HelpCenter.splitIntoSections` (`webui/src/pages/HelpCenter.tsx:79-88`) renders each H2/H3 as an independent `<section>`; §0.1 / §0.2 / §0.3 are three separate `<section>` elements with their own IDs (after alias: `faq-developer` / `faq-admin` / `faq-agent-integration`).
- Do not use v0.3 "term 在任意 `<code>` 内即通过" 测试逻辑；inline code 测试必须用 A/B 两档 + 剥离 `<code>`、heading、内部引用链接后不得裸奔的双向断言（v0.5 测试逻辑，见 Step 3.2）。
- TOC 链接必须指向新 alias：`/help?section=faq-developer` / `/help?section=faq-admin` / `/help?section=faq-agent-integration`；测试必须直接断言 href，不能仅查 section 存在。
- §0.3 用户可见 H3 标题必须写 `0.3 面向接入协作者`，不要写 `面向接入 Agent 的协作者`；标题和 TOC 文本无法局部添加 `notranslate`，因此标题层面避免裸露专业英文术语。
- Do not write a `node --input-type=module` + regex + `eval` probe for `parseHelpToc`. The function lives in TS with type annotations; non-greedy regex will truncate the body; `inbox/` may not exist under `webui/`. Use `npx vitest run server/__tests__/help.test.ts -t <pattern>` or add a dedicated helper test.
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

---

## Phase 1: §0 重组 + 术语 inline code 化

### Step 1.1: 备份 §0 现状并列出 13 条 Q&A

**Files:**

- Read: `docs/SYSTEM_HANDBOOK.md` line 27–46

记录 13 条原 Q&A 的编号、原问题、所属新子节（参考 spec §6.2 角色分配表）。

**Expected:** 一张完整的映射表，对照 spec §6.2 13 条角色分配，无遗漏。

### Step 1.2: 重写 §0 为 3 个 H3 子节

**Files:**

- Modify: `docs/SYSTEM_HANDBOOK.md` line 27–46

替换 §0 整段为：

```md
## 0. 常见问题速查

本节是按用户问题组织的快速入口。每条答案给下一步判断；完整操作以正文章节为准。
常见问题按三种角色分组：开发者 / 管理员 / 接入协作者。
第 6 章 FAQ 与排障指南 是配套的故障排查 deep dive。

### 0.1 面向开发者

| 问题 | 快速答案 | 详见 |
| --- | --- | --- |
| 我在哪里新建数据库连接？ | `WebUI` 不新建物理连接；先在 `ktx.yaml` 和 secret 文件声明连接，再回 `WebUI` 管理已声明连接。 | [3.2 数据库接入](#32-数据库接入)、[WebUI 与 ktx.yaml 的职责边界](#webui-与-ktxyaml-的职责边界) |
| 数据库密码应该放在哪里？ | 用 `file:`、`env:` 或 Docker secrets；不要把明文密码写进 `ktx.yaml`、文档、`commit message` 或聊天记录。 | [连接形态与配置字段](#连接形态与配置字段)、[5.2 ktx.yaml](#52-ktxyaml) |
| 点了刷新本地目录，刷新后的表在哪里看？ | `/connections` 看 reload 状态，`/connections/whitelist` 看可纳入启用表范围的表，`WebUI` 首页 `/` 看已进入语义建模的表。 | [刷新本地目录](#刷新本地目录) |
| 为什么提示"未发现本地 manifest"？ | `ktx.yaml` 声明了 `Schema` 或启用表范围，但本地 `semantic-layer/<conn>/_schema/<schema>.yaml` 缺失或未包含目标表。 | [6.1 为什么提示"未发现本地 manifest"？](#61-为什么提示未发现本地-manifest) |
| `YAML` 改完后为什么 `Agent` 仍然搜不到新口径？ | `WebUI` 读文件即可看到；`KTX` / `MCP` 检索需要 `ktx admin reindex`，并且还要用 `sl read` 确认 `overlay` 已合并到目标 `source`。 | [6.3 配置文件改动后什么时候生效？](#63-配置文件改动后什么时候生效)、[3.7.6.2 KTX 合并与索引检查](#3762-ktx-合并与索引检查) |
| 我应该改 `manifest` 还是 `overlay`？ | 物理表结构和物理列描述在 `manifest`；`grain`、`measures`、`segments`、派生列和业务补丁在 `overlay`。 | [3.3 语义层维护](#33-语义层维护)、[3.7.1 YAML 类型总览](#371-yaml-类型总览) |
| 新增指标怎样才算可以交付？ | 不能只看 `reindex` 或单个 `sl validate`；必须通过静态检查、`sl read`、真实 query、`MCP smoke` 和最终 `GO / NO-GO` 门槛。 | [3.7.6 GO / NO-GO 交付 checklist](#376-go--no-go-交付-checklist) |
| 评测用例和运行历史在哪里？ | 用 `/eval/cases` 维护评测用例，用 `/eval/runs` 看运行历史，用 `/eval/monitor` 看趋势监控。 | [3.6 质量评测 Eval](#36-质量评测-eval) |

### 0.2 面向管理员

| 问题 | 快速答案 | 详见 |
| --- | --- | --- |
| `Agent` 返回 `Access denied` 时先查哪里？ | 先看客户端里的 `decision_reason`，再打开 `/admin/audit` 或查 `/api/admin/audit?outcome=denied`，对照 `role` 的连接、表和工具授权。 | [6.2 JSON-RPC Access denied / decision_reason 怎么查？](#62-json-rpc-access-denied--decision_reason-怎么查)、[3.5 访问治理 Admin](#35-访问治理-admin) |
| `expires_at` 到期后 token 会自动失效吗？ | 不会。`expires_at` 当前只是 `metadata`；要下线 token 必须在 `Admin` 撤销或调用删除 token `API`。 | [3.5 访问治理 Admin](#35-访问治理-admin)、[6.5 MCP 返回 401](#65-mcp-返回-401) |
| 新连接什么时候对 `Agent` 可见？ | `ktx.yaml`、`manifest` / `overlay`、启用表范围、`KTX reindex`、`access.yaml` `role` / `ACL` 都就绪后才可见。 | [Agent 可见性与 ACL 同步](#agent-可见性与-acl-同步)、[新增数据库连接（运维 Runbook）](#新增数据库连接运维-runbook) |

### 0.3 面向接入协作者

| 问题 | 快速答案 | 详见 |
| --- | --- | --- |
| `MCP` 返回 401 是什么原因？ | 通常是未带 `Bearer` `token`、`token` hash 不匹配、`token` 已撤销、环境变量未展开或进程读取了另一份 `access` 配置。 | [6.5 MCP 返回 401](#65-mcp-返回-401) |
| 本地开发应该访问哪个端口？ | 页面端口以启动日志为准；常见开发入口是 `Vite 5173`，`API 5174`，`Lucy MCP Proxy 7879`。`Docker` / demo 宿主端口可能是 `55176` 等映射端口。 | [2.2 本地启动](#22-本地启动)、[4.1 接入地址](#41-接入地址) |
```

**约束：**

- 13 条全部归位（按 spec §6.2 角色分配表）。
- 关键术语按 spec §6.3 列表全部 inline code 化。
- 不修改 §0 之后的章节内容；不改 §6 任何内容。
- 不修改 handbook 顶部目录（line 10–25），`[0. 常见问题速查]` 条目已存在。
- "expires_at 不会自动失效"这条必须有。

### Step 1.3: 自检锚点（人工对照，不跑脚本）

**Files:**

- Read: `docs/SYSTEM_HANDBOOK.md`

对照每条 Q&A 的"详见"列中的锚点：

- `[3.2 数据库接入]` → `### 3.2 数据库接入` 必须存在。
- `[WebUI 与 ktx.yaml 的职责边界]` → `### WebUI 与 ktx.yaml 的职责边界` 必须存在。
- `[连接形态与配置字段]` → `### 连接形态与配置字段` 必须存在。
- `[5.2 ktx.yaml]` → `### 5.2 ktx.yaml` 必须存在。
- `[刷新本地目录]` → `### 刷新本地目录` 必须存在。
- `[6.1 ...]` → `### 6.1 为什么提示"未发现本地 manifest"？` 必须存在。
- `[6.3 ...]` → `### 6.3 配置文件改动后什么时候生效？` 必须存在。
- `[3.7.6.2 ...]` → `#### 3.7.6.2 KTX 合并与索引检查` 必须存在（3.7.x 子节在 `parseHelpToc` 白名单内）。
- `[3.3 语义层维护]` → `### 3.3 语义层维护` 必须存在。
- `[3.7.1 YAML 类型总览]` → `### 3.7.1 YAML 类型总览` 必须存在。
- `[3.7.6 GO / NO-GO 交付 checklist]` → `### 3.7.6 GO / NO-GO 交付 checklist` 必须存在。
- `[3.6 质量评测 Eval]` → `### 3.6 质量评测 Eval` 必须存在。
- `[6.2 JSON-RPC Access denied / decision_reason 怎么查？]` → `### 6.2 JSON-RPC Access denied / decision_reason 怎么查？` 必须存在。
- `[3.5 访问治理 Admin]` → `### 3.5 访问治理 Admin` 必须存在。
- `[6.5 MCP 返回 401]` → `### 6.5 MCP 返回 401` 必须存在。
- `[Agent 可见性与 ACL 同步]` → `### Agent 可见性与 ACL 同步` 必须存在（在 `database-connection-acl-sync` alias 白名单内）。
- `[新增数据库连接（运维 Runbook）]` → `### 新增数据库连接（运维 Runbook）` 必须存在。
- `[2.2 本地启动]` → `### 2.2 本地启动` 必须存在。
- `[4.1 接入地址]` → `### 4.1 接入地址` 必须存在。

**Expected:** 全部锚点命中；如有遗漏，回到 Step 1.2 修改 Q&A 答案中的深链。

### Step 1.4: 自检 inline code 化（辅助检查；最终以 Phase 3 DOM 测试为准）

```bash
# 辅助列出 §0 中可能需要 inline code 化的术语。
# 最终判定以 Phase 3 Step 3.2 的 DOM 测试为准：
# 剥离 code、heading、内部引用链接后，Q&A 问题与快速答案正文不得裸露 A/B 档术语。
awk '/^## 0\. 常见问题速查/,/^## 1\./' docs/SYSTEM_HANDBOOK.md > /tmp/help-qa-section.md
for term in "Agent" "MCP" "YAML" "Schema" "KTX" "access.yaml" "ktx.yaml" "overlay" "reindex" "grain" "measures" "segments" "Bearer" "metadata" "Admin" "API" "GO / NO-GO" "MCP smoke" "sl read" "sl validate" "decision_reason" "expires_at" "Docker" "Vite 5173" "API 5174" "Lucy MCP Proxy 7879" "WebUI" "file:" "env:" "commit message" "source" "role" "token" "ACL" "Access denied" "Manifest" "Catalog" "Role" "Token" "Endpoint" "Eval Run" "Runtime" "enabled_tables" "tools/list" "tools/call" "OK"; do
  echo "=== $term ==="
  # 列出出现位置，人工初筛；链接文本和 heading 中的既有标题引用不在裸露术语失败范围内。
  rg -n "\b$term\b" /tmp/help-qa-section.md || echo "  (not found)"
done
```

**Expected:** 辅助检查不应发现 Q&A 问题与快速答案正文中的明显裸露专业术语。若命中 heading 或"详见"链接文本，按引用文本处理，不作为失败；最终以 Phase 3 Step 3.2 DOM 测试为准。

如有裸奔（在表格单元里没被 backtick 包裹），回到 Step 1.2 修正。

### Step 1.5: 自检 forbidden 术语

```bash
awk '/^## 0\. 常见问题速查/,/^## 1\./' docs/SYSTEM_HANDBOOK.md | rg -n "财政部舱单|舱单|替代测试|上传报价包|添加架构|目标架构|模式清单|重新加载资产"
```

**Expected:** 无输出（§0 不出现 forbidden 术语）。

---

## Phase 2: 后端 §0 子节 parseHelpToc 验证 + alias 补充

### Step 2.1: 补 3 个 alias 到 SECTION_ALIASES

**Files:**

- Modify: `webui/server/help.ts` `SECTION_ALIASES` 数组（line 12–54）

在 `/常见问题速查/`（line 13）之后追加：

```ts
[/面向开发者/, "faq-developer"],
[/面向管理员/, "faq-admin"],
[/面向接入协作者|面向接入 Agent 的协作者|接入 Agent 的协作者/, "faq-agent-integration"]
```

**约束：**

- 不改其他 alias 条目；新增只追加。
- 三个 alias 必须与现有 `SECTION_ALIASES` 不冲突；如未来 handbook 新增同名标题，需要重新评估。
- `faq-agent-integration` 的 alias 正则以"面向接入协作者"为主，同时兼容旧文案"面向接入 Agent 的协作者"和简短"接入 Agent 的协作者"，防止标题回退时 alias 失效。

### Step 2.2: 验证 3 个 alias 生效

**Files:**

- Modify: `webui/server/__tests__/help.test.ts`

新增测试（或追加到现有 toc 测试）：

```ts
import { parseHelpToc } from "../help.js";

it("maps §0 sub-sections to stable alias ids", () => {
  const md = `
## 0. 常见问题速查

本节是按用户问题组织的快速入口。

### 0.1 面向开发者

| Q | A |
|---|---|
| foo | bar |

### 0.2 面向管理员

### 0.3 面向接入协作者
`;

  const toc = parseHelpToc(md);
  const byTitle = Object.fromEntries(toc.map((t) => [t.title, t.id]));
  expect(byTitle["0. 常见问题速查"]).toBe("faq-quick-reference");
  expect(byTitle["0.1 面向开发者"]).toBe("faq-developer");
  expect(byTitle["0.2 面向管理员"]).toBe("faq-admin");
  expect(byTitle["0.3 面向接入协作者"]).toBe("faq-agent-integration");
});
```

**Expected:** 测试通过；3 个 H3 子节 ID 与预期 alias 一致。

### Step 2.3: 运行后端测试

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run server/__tests__/help.test.ts
```

**Expected:** help 测试套件全绿，含新增的 §0 alias 测试。

---

## Phase 3: 前端渲染与翻译防御测试

**重要前置（v0.5 修订）：**

1. 沿用 `webui/src/__tests__/help-center.test.tsx:9` 已有 helper：

   ```ts
   function renderHelp(path = "/help") { ... }
   ```

   **不要**引入 `renderHelpAt` 之类新名字。扩展时直接复用现有 helper。

2. `HelpCenter.splitIntoSections` (`webui/src/pages/HelpCenter.tsx:79-88`) 把每个 H2/H3 都渲染为独立 `<section id={section.id}>`。§0 包含 4 个独立 section：

   - `<section id="faq-quick-reference">` 只装 §0 引言段。
   - `<section id="faq-developer">` 装 §0.1 全部内容。
   - `<section id="faq-admin">` 装 §0.2 全部内容。
   - `<section id="faq-agent-integration">` 装 §0.3 全部内容。

   任何测试如要查 §0 的 Q&A 表格 / inline code / 深链，都必须**定位到对应子 section**，**不能**只在 `#faq-quick-reference` 下找。

3. 关键术语 inline code 化测试不得假设 spec §6.3 mandatory 词表中所有词都出现在 §0；也不得把标题和"详见"链接文本当作 Q&A 答案正文。改为：

   ```ts
   // A 档每条：剥离 <code>、heading、内部引用链接后，§0 三个子 section 的 Q&A 问题与快速答案正文不得再出现该术语；
   //            同时三个子 section 的 <code> 文本集合中至少包含该术语一次。
   // B 档每条：仅当 §0 任意位置出现时才校验 inline code 化；不出现则跳过。
   ```

### Step 3.1: §0 渲染 + 角色分组测试 + TOC 链接 href 断言

**Files:**

- Modify: `webui/src/__tests__/help-center.test.tsx`

**前置：** 扩展现有 mock handbook fixture 的两处数据：

- `markdown` 必须加入 §0 引言段 + 3 个 H3 子节表格。
- `toc` 必须同步加入 4 个条目：`faq-quick-reference`、`faq-developer`、`faq-admin`、`faq-agent-integration`。前端测试不会自动调用后端 `parseHelpToc`；如果只改 mock markdown，不改 mock toc，section id 会退化为 `section-N`，TOC href 也不会出现新 alias。

新增测试：

```tsx
it("renders §0 with three scenario sub-sections", async () => {
  renderHelp("/help?section=faq-quick-reference");

  await waitFor(() => {
    expect(
      screen.getByRole("heading", { name: /常见问题速查/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /面向开发者/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /面向管理员/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /面向接入协作者/ })
    ).toBeInTheDocument();
  });
});

it("deep links to §0.1 / §0.2 / §0.3 sub-sections resolve to independent <section> ids", async () => {
  renderHelp("/help");

  await waitFor(() => {
    expect(
      document.querySelector("section#faq-developer")
    ).toBeInTheDocument();
    expect(
      document.querySelector("section#faq-admin")
    ).toBeInTheDocument();
    expect(
      document.querySelector("section#faq-agent-integration")
    ).toBeInTheDocument();
  });

  // 三个 section 必须各自独立、不嵌套
  expect(
    document.querySelector("section#faq-developer section#faq-admin")
  ).toBeNull();
});

it("TOC links for §0 sub-sections point to the new alias section ids", async () => {
  renderHelp("/help");

  await waitFor(() => {
    expect(
      screen.getByRole("heading", { name: /面向开发者/ })
    ).toBeInTheDocument();
  });

  // TOC 中面向开发者 / 面向管理员 / 面向接入协作者 三个链接必须指向新 alias
  const tocLinks = screen.getAllByRole("link", { name: /面向开发者/ });
  expect(tocLinks.length).toBeGreaterThan(0);
  tocLinks.forEach((link) => {
    expect(link.getAttribute("href")).toBe("/help?section=faq-developer");
  });

  const adminLinks = screen.getAllByRole("link", { name: /面向管理员/ });
  adminLinks.forEach((link) => {
    expect(link.getAttribute("href")).toBe("/help?section=faq-admin");
  });

  const integrationLinks = screen.getAllByRole("link", {
    name: /面向接入协作者/
  });
  integrationLinks.forEach((link) => {
    expect(link.getAttribute("href")).toBe("/help?section=faq-agent-integration");
  });
});
```

### Step 3.2: 关键术语 inline code 化测试（A/B 两档）

**Files:**

- Modify: `webui/src/__tests__/help-center.test.tsx`

**前置：** 测试逻辑必须区分 A/B 两档（spec §6.3），**禁止**沿用 v0.3 的"term 在任意 `<code>` 内即通过"伪断言——那种逻辑在"正文同时有裸奔 + code"时会假阳性绿。

新增测试：

```tsx
it("renders §0 key terms as inline code per A/B tiers", async () => {
  renderHelp("/help?section=faq-quick-reference");

  await waitFor(() => {
    expect(
      document.querySelector("section#faq-developer")
    ).toBeInTheDocument();
    expect(
      document.querySelector("section#faq-admin")
    ).toBeInTheDocument();
    expect(
      document.querySelector("section#faq-agent-integration")
    ).toBeInTheDocument();
  });

  // 收集 §0 三个子 section 的 <code> 文本集合（用于 A 档"必须 inline code"验证）
  const codeTexts: string[] = [];
  const sectionIds = ["faq-developer", "faq-admin", "faq-agent-integration"];
  for (const id of sectionIds) {
    const sec = document.querySelector(`section#${id}`);
    if (!sec) throw new Error(`expected section#${id}`);
    sec.querySelectorAll("code").forEach((n) => {
      const t = n.textContent ?? "";
      if (t) codeTexts.push(t);
    });
  }

  // 收集 §0 三个子 section 剥离 <code>、heading、内部引用链接后的纯文本
  // 用于 A/B 档"不得在 Q&A 问题与快速答案正文裸奔"验证。
  // heading/TOC 无法局部 notranslate；"详见"列链接文本引用既有 handbook 标题，二者不纳入本测试失败范围。
  const rawTexts: string[] = [];
  for (const id of sectionIds) {
    const sec = document.querySelector(`section#${id}`);
    if (!sec) continue;
    const clone = sec.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("code, h1, h2, h3, h4, h5, h6, a[href^='#']").forEach((c) => c.remove());
    rawTexts.push(clone.textContent ?? "");
  }
  const rawTextJoined = rawTexts.join("\n");
  const fullTextJoined = codeTexts.join("\n");

  // A 档：必须出现且必须 inline code 化
  // 规则：剥离 <code> 后正文不得再含该术语；同时 <code> 节点文本集合至少包含该术语一次
  const tierA = [
    "Agent", "MCP", "YAML", "Schema", "KTX", "access.yaml", "ktx.yaml",
    "overlay", "reindex", "grain", "measures", "segments", "Bearer",
    "metadata", "Admin", "API", "GO / NO-GO", "MCP smoke",
    "sl read", "sl validate", "decision_reason", "expires_at",
    "Docker", "Vite 5173", "API 5174", "Lucy MCP Proxy 7879",
    "WebUI", "file:", "env:", "commit message", "source",
    "role", "token", "ACL", "Access denied"
  ];
  for (const term of tierA) {
    // 1. 剥离 <code>、heading、内部引用链接后正文不得包含该术语（不得裸奔）
    expect(
      rawTextJoined.includes(term),
      `A-tier term "${term}" appears in §0 raw text (not inline code)`
    ).toBe(false);
    // 2. <code> 节点文本集合至少包含该术语一次（必须 inline code 化）
    expect(
      fullTextJoined.includes(term),
      `A-tier term "${term}" missing from §0 inline code`
    ).toBe(true);
  }

  // B 档：若出现则必须 inline code 化
  // 规则：若 §0 任意位置出现，必须在 <code> 内；不出现则跳过
  const tierB = [
    "Manifest", "Catalog", "Role", "Endpoint", "Eval Run", "Runtime",
    "enabled_tables", "tools/list", "tools/call", "OK"
  ];
  for (const term of tierB) {
    const appearsAnywhere = fullTextJoined.includes(term) || rawTextJoined.includes(term);
    if (!appearsAnywhere) continue;
    // 若出现，必须只在 <code> 内（剥离 code、heading、内部引用链接后不再出现）
    expect(
      rawTextJoined.includes(term),
      `B-tier term "${term}" appears in §0 raw text (not inline code)`
    ).toBe(false);
  }
});
```

### Step 3.3: 深链可达测试

**Files:**

- Modify: `webui/src/__tests__/help-center.test.tsx`

新增测试：

```tsx
it("Q&A deep links in §0 point to real handbook anchors (DOM-based)", async () => {
  renderHelp("/help");

  await waitFor(() => {
    expect(
      document.querySelector("section#faq-developer")
    ).toBeInTheDocument();
  });

  // 收集 §0 三个子 section 内的所有内部深链
  const internalHrefs = new Set<string>();
  for (const id of ["faq-developer", "faq-admin", "faq-agent-integration"]) {
    const sec = document.querySelector(`section#${id}`);
    if (!sec) continue;
    sec.querySelectorAll("a[href^='#']").forEach((a) => {
      const href = a.getAttribute("href") ?? "";
      if (href.length > 1) internalHrefs.add(href);
    });
  }
  expect(internalHrefs.size).toBeGreaterThan(0);

  // 每个 href 必须能解析到 help-content 内的真实 id
  const content = screen.getByTestId("help-content");
  internalHrefs.forEach((href) => {
    const id = href.replace(/^#/, "");
    expect(
      content.querySelector(`#${CSS.escape(id)}`),
      `dead link: ${href}`
    ).toBeTruthy();
  });
});
```

### Step 3.4: forbidden 术语 + §6 不变测试

**Files:**

- Modify: `webui/src/__tests__/help-center.test.tsx`

新增测试：

```tsx
it("§0 contains no forbidden terms", async () => {
  renderHelp("/help?section=faq-quick-reference");
  await waitFor(() => screen.getByRole("heading", { name: /常见问题速查/ }));

  const ids = ["faq-quick-reference", "faq-developer", "faq-admin", "faq-agent-integration"];
  const combinedText = ids
    .map((id) => document.querySelector(`section#${id}`)?.textContent ?? "")
    .join("\n");

  expect(combinedText).not.toMatch(
    /财政部舱单|舱单|替代测试|上传报价包|添加架构|目标架构|模式清单|重新加载资产/
  );
});

it("§6 FAQ 与排障指南 section count and titles are preserved", async () => {
  renderHelp("/help?section=troubleshooting");
  await waitFor(() => screen.getByRole("heading", { name: /FAQ 与排障指南/ }));

  const expectedFaqTitles = [
    /6\.1 为什么提示/,
    /6\.2 JSON-RPC/,
    /6\.3 配置文件改动/,
    /6\.4 WebUI 页面打不开/,
    /6\.5 MCP 返回 401/,
    /6\.6 KTX upstream/,
    /6\.7 为什么白名单表保存失败/,
    /6\.8 安全边界速查/,
    /6\.9 最小健康检查清单/
  ];
  for (const title of expectedFaqTitles) {
    expect(
      screen.getByRole("heading", { name: title }),
      `expected §6 to keep ${title}`
    ).toBeInTheDocument();
  }
});
```

### Step 3.5: 跑 focused tests（不用 pretest）

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run src/__tests__/help-center.test.tsx
```

**Expected:** help-center 测试套件全绿，含 Phase 3 所有新增测试。

---

## Phase 4: 后端测试 + 构建验证

### Step 4.1: 后端 §0 解析测试

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run server/__tests__/help.test.ts
```

**Expected:** help 测试套件全绿；§0 三个 H3 子节被 `parseHelpToc` 正确收（无 alias 缺失、无 H4 过滤问题）。

### Step 4.2: 构建验证

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run build
```

**Expected:** build 通过；无新警告。

### Step 4.3: 浏览器核查（推荐）

打开 `http://127.0.0.1:55176/help?section=faq-quick-reference`：

1. 页面滚动到 §0 顶部。
2. 看到 3 个 H3 子节：`§0.1 面向开发者` / `§0.2 面向管理员` / `§0.3 面向接入协作者`。
3. §0 中所有 `Agent` `MCP` `YAML` 等专业术语显示为等宽字体的 `<code>` 节点。
4. 13 条 Q&A 全部归位。
5. 点击任一"详见"深链跳到对应章节。
6. 不出现 forbidden 术语。

打开 `http://127.0.0.1:55176/help?section=troubleshooting`：

1. §6 第 6.1–6.9 节 9 个标题按原顺序排列。
2. 内容、锚点、表格、代码块全部不变。

---

## Phase 5: 收尾

### Step 5.1: 提交规范

按仓库 commit 规范：

```bash
git add docs/SYSTEM_HANDBOOK.md \
        webui/server/help.ts \
        webui/server/__tests__/help.test.ts \
        webui/src/__tests__/help-center.test.tsx \
        webui/docs/60-help-qa-section-spec.md \
        webui/docs/plans/wo-M58-help-qa-section.md
git commit -m "docs(webui): upgrade Help §0 FAQ quick reference by scenario with alias ids and tier-based inline-code terms (M58)"
```

**约束：**

- commit message 必须以 `docs(webui):` 开头。
- 不在 commit message 里出现真实 role id / token / connection id。
- 同步如果 inbox 临时文件不存在就不提交；存在则不提交（inbox 是临时目录）。

---

## Implementation Notes

- Do not change §6 FAQ 与排障指南 line 1585–1742 任何内容、顺序、锚点。
- Do not change handbook 顶部目录 line 10–25；`[0. 常见问题速查]` 条目已存在。
- Do not change Help API, Markdown renderer, Wiki editing, or KTX upstream.
- Do not introduce a second fact source for Help.
- Do not expose Help content through MCP tools.
- Do not add search, full-text index, or external dependency.
- Do not use real role id / token hash / connection id in §0 examples.
- Do not skip the "§0 是问题驱动入口，§6 是配套的故障排查 deep dive" 引言段。
- Preserve deep link citations to existing handbook anchors.
- 关键专业术语必须 inline code（按 spec §6.3 A/B 两档词表——A 档必须出现且 inline code 化，B 档若出现则必须 inline code 化）；不在普通文本段落里裸露这些术语。
- §0 关键术语测试**禁止**使用 v0.3 的"term 在任意 `<code>` 内即通过"伪断言；必须用 A/B 两档 + 剥离 `code`、heading、内部引用链接后不得裸奔的双向断言（v0.5 测试逻辑，见 Step 3.2）。
- 补 3 条 `SECTION_ALIASES`（`faq-developer` / `faq-admin` / `faq-agent-integration`），不要让 §0 H3 子节走 stableSlug 自动生成（纯中文标题会落到 sha1 短 hash）。
- `expires_at` 不是自动过期；§0 第 10 条答案必须明确这点。
- 不改 HelpButton 入口；`? 系统手册` 仍是唯一定位。
- 不用 `npm test -- ...`；只用 `npx vitest run <file>` 直接跑 focused tests。
- 不使用占位编号（`§0.X` `6.X` `6.A–6.I`）；必须写实编号。
- 测试必须沿用 `renderHelp(path = "/help")` helper（`help-center.test.tsx:9`），不得引入 `renderHelpAt`。
- 测试必须在对应子 `<section>` 节点（`#faq-developer` 等）下断言 §0 内容；不得在 `#faq-quick-reference` 下查 §0.1/§0.2/§0.3 表格或 inline code。
- 前端 mock handbook fixture 必须同步更新 `markdown` 和 `toc`；不要只改 markdown。

---

## Acceptance Criteria

- `docs/SYSTEM_HANDBOOK.md` §0 升级为 3 个 H3 子节，13 条 Q&A 按角色重新分配。
- 每条 Q&A 答案中的关键术语按 spec §6.3 A/B 两档词表 inline code 化：A 档全部出现且必须在 `<code>` 内，B 档若出现则必须在 `<code>` 内。
- 每条 Q&A 答案至少 1 条到正文章节的可点击深链；Phase 1 Step 1.3 人工锚点对照无死链。
- Phase 3 Step 3.2 DOM 测试证明所有 A 档术语都在 inline code 内，且剥离 `code`、heading、内部引用链接后 Q&A 问题与快速答案正文不再出现；Phase 1 Step 1.4 grep 仅作辅助。
- Phase 1 Step 1.5 无 forbidden 术语。
- §6 line 1585–1742 内容、顺序、9 个 H3 锚点全部不变。
- handbook 顶部目录 line 10–25 `[0. 常见问题速查]` 条目保留。
- 3 个 H3 子节通过 `SECTION_ALIASES` 映射到 `faq-developer` / `faq-admin` / `faq-agent-integration`，`parseHelpToc` 测试覆盖。
- `npx vitest run src/__tests__/help-center.test.tsx` 通过。
- `npx vitest run server/__tests__/help.test.ts` 通过。
- `npm run build` 通过。
- commit message 遵守 `docs(webui):` 前缀规范。

---

## Out of Scope

- 不引入搜索、不引入全文索引、不引入外部依赖。
- 不改 Help API envelope。
- 不改 Markdown 渲染器（`MarkdownPreview.tsx`）。
- 不改 Wiki 编辑能力。
- 不在 §6 新增 Q&A 章节。
- 不做概念辨析。
- 不暴露 Help 内容到 MCP 工具面。
- 不引入链接校验工具；Phase 1 Step 1.3 人工对照。
- 不跑 pretest lint（与本任务无关的脏改动阻塞）；用 `npx vitest run <file>` 直接跑 focused tests。
