# lucy-skills MCP Server Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | lucy-skills MCP Server Spec |
| 文档类型 | Spec |
| 版本 | v1.2 |
| 撰写日期 | 2026-06-18；v1.1 修订 2026-06-24；v1.2 修订 2026-08-29 |
| 撰写人 | Claude；v1.2 修订 Mavis（Forrest 委托 V5 验证后） |
| 委托人 | zhangxingchen |
| 基于材料 | `dev-inbox/20260617-2320-project-lucy-progress-and-plan.md` P1 决策；`docs/DEVELOPMENT.md` §Skills 当前状态；KTX MCP server 当前能力清单（4 tool，无 always-on prompt）；本会话 D-1 / E1 决策上下文；V5 验证材料 `inbox/lucy-skills-v5-report.md` |
| 适用范围 | lucy-skills MCP server MVP 实施门控；data agent 客户端集成参考 |
| 输出位置 | /Users/zhangxingchen/Projects/project-lucy/lucy-skills/docs/01-spec.md |

## §1 背景与决策

### 1.1 问题

project-lucy 在 KTX 之上沉淀了一组 SKILL.md（`skills/warehouse`、`skills/reviewer`、可能未来扩展 `skills/domains/*`），但当前 data agent **无法以结构化方式按需触发**这些 skill：

- KTX MCP server 仅暴露 4 个 tool（`sl_read` / `sl_query` / `wiki_search` / `sl_validate`），**不存在** always-on prompt（v1.1 更正：曾假设 KTX 会自动注入一个名为 `warehouse-knowledge` 的常驻 prompt，已直接核查 KTX 源码 `createDefaultKtxMcpServer`/`McpServer` 构造与全部 `loadPrompt(...)` 调用点证实不存在；仓库内原假设由此机制消费的 `.ktx/prompts/warehouse-knowledge.md` 是孤儿文件，已在 2026-06-23 的 CLAUDE.md 迁移中删除，见 `webui/docs/07-mcp-auth-proxy-spec.md` §10 Phase 4）
- `SkillsRegistryService` 加载的 skill catalog 只在 KTX 进程内部使用（ingest / scan），不通过 MCP 透传
- data agent 当前只能通过 LLM 主动 Read 工具去读 `skills/**/SKILL.md`，没有"目录可见 + 按需读"的标准通道

### 1.2 为什么不推 KTX 上游

- KTX 定位：通用 MCP server，语义层 + wiki 是其核心范围
- skill 超出 KTX 原始范围，让 KTX 承担 skill 加载/暴露会扩大 KTX 职责面、增加上游 PR 协商成本
- KTX 上游若要承接，需要同时改两件事：(a) 加载项目目录（ktx.yaml schema + `mcp-server-factory` 透传 `additionalSkillDirs`）；(b) 新增把 skill catalog 暴露成 MCP 能力的机制（KTX 当前完全不存在）

### 1.3 决策：lucy 自起 MCP server

- lucy-skills 与 KTX **并列**作为 lucy 仓库对外的 MCP server
- 客户端通过 `.mcp.json` 同时注册两个 server，互不依赖
- KTX 维持现状（语义层 + wiki），不揽 skill

**v1.2 修订（2026-08-29，V5 验证后）**：V5 实际验证发现，"客户端直接并列注册"心智虽然简单，但**走 Lucy MCP Proxy 路由是更优架构**——data agent 只接 `lucy` 一个入口，proxy 按 URL 前缀分发到 KTX 或 lucy-skills。具体落地：

- 现有 `lucy` 入口 `http://localhost:7879/mcp` 继续指向 KTX（行为不变）
- 新增 `http://localhost:7879/mcp/skills` 入口指向 lucy-skills（同 proxy 走 auth gate）
- 客户端 `.mcp.json` 把 `lucy-skills` 条目指向 `http://localhost:7879/mcp/skills` + 同一 Bearer token
- 详见 §2 架构图、proxy 改动清单在 `inbox/lucy-skills-v5-report.md` §"修订 spec 的具体建议"
- **客户端可直接并列注册仍合法**——lucy-skills server 是无状态的标准 MCP server，proxy 路由只是部署形态的一种，不是协议要求
- 决策：默认推荐 proxy-routed；直接并列注册作为 low-friction 开发形态保留

### 1.4 暴露形式选型

候选评估见 P1 讨论记录。结论：

| 形式 | MVP | 理由 |
|---|---|---|
| Resource | ✅ | 标准 MCP；贴近 SKILL.md 文件形态；按需读 token 友好；任何 MCP client 都支持 |
| Tool | ❌ | tool list 污染；idiom 不合（tool 典型用法是结构化输入输出，不是吐 markdown） |
| Prompt | ❌ | 用户手动触发，与"LLM 自主激活"目标冲突 |
| 自动注入（Prompt 增强） | ⏸ 后续观察 | 触发性最强但绑 Claude Code 类客户端；先看 LLM 是否会主动 `resources/list`，再决定是否加 |

### 1.5 Stack

- **TypeScript + `@modelcontextprotocol/sdk`**（官方 SDK，文档/类型最全；与 KTX 选型一致，运维一套技能）
- 运行形态：HTTP server（与 KTX 一致），默认端口 7881（v1.1 更正：原定 7879 与 Lucy MCP Proxy 冲突——`webui/server/proxy/mcp-proxy.ts` 自 2026-06-23 起监听 `:7879`，见 `webui/docs/07-mcp-auth-proxy-spec.md`）
- 子目录 `lucy-skills/` 自带 `package.json`，与 lucy 主仓库 git history 同仓但独立可发布

## §2 架构定位

### 2.1 物理拓扑（v1.2 修订后）

```
data agent (Claude Code / 其他 MCP client)
    │
    └── Lucy MCP Proxy (localhost:7879, Bearer auth)
            │
            ├── /mcp/*        → KTX upstream (:7878)         ← 语义层 / wiki / sl_*
            │
            └── /mcp/skills/* → lucy-skills upstream (:7881)  ← skill 索引 + 内容
```

- **生产推荐**（v1.2 验证通过）：data agent 只连 Lucy MCP Proxy 一个入口，proxy 按 URL 前缀分发
- **开发低摩擦形态**（保留）：data agent 直接并列连 KTX :7878 + lucy-skills :7881，绕过 proxy
- 两个上游互不感知，proxy 端只做 URL 路由 + auth 复用 + (可选) trace/audit
- lucy-skills 不读 KTX 状态，不依赖 KTX 运行（KTX 宕机不影响 skill 可用性）
- lucy-skills 不写任何持久化状态（无状态 server，纯文件扫描）

### 2.2 路由表（v1.2 修订后）

| 客户端入口 | 转发到 | 用途 |
|---|---|---|
| `http://localhost:7879/mcp` | `http://127.0.0.1:7878/mcp` | KTX（不变） |
| `http://localhost:7879/mcp/skills` | `http://127.0.0.1:7881/mcp` | lucy-skills（v1.2 新增） |

proxy 端通过 `LUCY_PROXY_LUCY_SKILLS_HOST` / `LUCY_PROXY_LUCY_SKILLS_PORT` 配置上游。
**MVP 默认行为**：`/mcp` 走 KTX，`/mcp/skills*` 走 lucy-skills；其他路径 404。

## §3 MCP 契约（对外）

### 3.1 暴露能力

| 能力 | 端点 | 说明 |
|---|---|---|
| `resources/list` | 标准 MCP | 返回所有 skill 的索引（URI + name + description + mimeType） |
| `resources/read` | 标准 MCP | 返回指定 URI 的 SKILL.md 全文 |

MVP 不暴露 tool、prompt、sampling。

### 3.2 Resource URI 规范

URI scheme：`lucy-skill://<skill-name>`

- `<skill-name>` 取自 SKILL.md frontmatter 的 `name` 字段（必填）
- 如 `lucy-skill://warehouse-knowledge`、`lucy-skill://analytics-reviewer`
- scheme 选用 `lucy-skill`（单数）而非 `skill`，避免与 KTX 或其他 server 命名冲突；前缀 `lucy-` 标明归属

### 3.3 `resources/list` 返回 schema

每个 resource entry 包含：

| 字段 | 类型 | 来源 | 必填 |
|---|---|---|---|
| `uri` | string | `lucy-skill://<name>` | ✅ |
| `name` | string | frontmatter `name` | ✅ |
| `description` | string | 详见 §4.2 description 推导 | ✅ |
| `mimeType` | string | 固定 `text/markdown` | ✅ |

### 3.4 `resources/read` 返回

返回 SKILL.md 文件**全文**（含 frontmatter）。客户端自行解析。

不做内容裁剪、不做 dependencies 递归 inline——保持 server 简单，复杂展开交给 client/LLM。

### 3.5 错误约定

| 场景 | 行为 |
|---|---|
| URI 不存在 | 返回 MCP 标准 `resource not found` 错误 |
| SKILL.md frontmatter 缺 `name` | 启动时跳过该 skill 并 warning log，不让整个 server 启动失败 |
| 扫描目录不存在 | warning log + 空列表，不报错 |
| 文件读取 IO 错误 | 返回 MCP 标准 `internal error`，不暴露具体路径 |

## §4 Skill 来源约定

### 4.1 扫描规则

- 扫描根目录：`<repo-root>/skills/`（由配置项 `scanRoot` 决定，默认值 `../skills/`）
- 扫描深度：递归任意层（`skills/warehouse/SKILL.md`、`skills/domains/superstore/foo/SKILL.md` 都能命中）
- 匹配文件名：精确 `SKILL.md`（大小写敏感）
- 忽略：以 `_` 开头的目录、`.git`、`node_modules`、`references/` 子目录中的 markdown（references 不是 skill）

### 4.2 frontmatter 字段处理

**当前已存在字段**（不强制 spec，只读取）：
`name / version / owner / triggers / dependencies / eval_coverage / last_pass_rate / publish_targets`

**spec 强制要求**：

| 字段 | 必填 | 用途 |
|---|---|---|
| `name` | ✅ | URI 主键，全局唯一 |
| `description` | ⚠️ 推荐 | 给 LLM 在 `resources/list` 阶段判断是否相关 |

**description 推导优先级**（当字段缺失时的 fallback）：

1. 优先用 frontmatter `description`（标准）
2. 缺时用 `triggers` 数组拼接为 `"触发场景：<triggers join '、'>"`（兼容当前 SKILL.md 现状）
3. 二者皆缺，用 SKILL.md frontmatter 之后的第一段非空文本（取前 200 字符）
4. 仍无内容，使用 `"(无描述：skill name=<name>)"` 占位

后续治理建议：在 P1.5 完成后单独提 PR 给 `skills/**/SKILL.md` 补 `description` 字段，逐步把 fallback 路径降级到真正不该触发。

### 4.3 name 冲突

- 启动时检测：两个 SKILL.md 声明同名 `name` → warning log + 后扫描到的版本被忽略，保留先扫描到的
- 扫描顺序：按目录字典序遍历，保证确定性

## §5 配置

### 5.1 配置文件

位置：`lucy-skills/lucy-skills.config.json`（与 `package.json` 同级）

```json
{
  "port": 7881,
  "host": "127.0.0.1",
  "scanRoot": "../skills",
  "include": ["**/SKILL.md"],
  "exclude": ["**/_*/**", "**/references/**", "**/node_modules/**"],
  "logLevel": "info"
}
```

### 5.2 启动命令

```bash
# 开发
cd lucy-skills && npm run dev

# 生产
cd lucy-skills && npm start
```

启动 banner 必须打印：扫描根目录、加载的 skill 数量、监听地址。

### 5.3 客户端 `.mcp.json` 接入

`<repo-root>/.mcp.json` 在现有 ktx 条目旁追加：

```json
{
  "mcpServers": {
    "ktx": {
      "type": "http",
      "url": "http://localhost:7878/mcp"
    },
    "lucy-skills": {
      "type": "http",
      "url": "http://localhost:7881/mcp"
    }
  }
}
```

## §6 验证标准

实施完成必须满足以下全部验证项：

| # | 验证 | 方式 | v1.2 状态 |
|---|---|---|---|
| V1 | `npm start` 能起服务并打印加载的 skill 数（当前期望 ≥ 2：warehouse-knowledge、analytics-reviewer） | 终端观察 | ✅ mock 实测通过 |
| V2 | 用 `mcp-inspector` 连 `http://localhost:7881/mcp`，调 `resources/list` 返回非空数组，每项含 uri/name/description/mimeType | inspector UI | ✅ mock 实测通过（curl 等价） |
| V3 | inspector 调 `resources/read` 用 V2 拿到的 URI，返回 SKILL.md 全文（含 frontmatter） | inspector UI | ✅ mock 实测通过（curl 等价） |
| V4 | Claude Code 启动时能并列连上 KTX 和 lucy-skills，无连接错误 | Claude Code 启动日志 | ✅ mock + proxy 实测通过（详见 V5 报告） |
| V5 | 在 Claude Code 一次会话中显式让 LLM 调 `resources/list` + `resources/read` 走完链路，输出 skill 内容 | 对话验证 | ✅ **2026-08-29 通过**（kscc CLI 1.3.2 实测） |
| V6 | 故意把某 SKILL.md frontmatter 删掉 `name` → 启动 warning log，其他 skill 仍正常加载 | 错误注入 | ⏳ 未跑（待 MVP 实施时跑） |
| V7 | 故意把扫描根目录指向不存在路径 → 启动 warning log，server 仍能起 | 错误注入 | ⏳ 未跑（待 MVP 实施时跑） |

### V5 详细（2026-08-29 通过）

V5 是 MVP 上线的真实信号。V5 baseline 验证发现：**LLM 在普通对话中默认走 Bash-first，不会主动用 MCP resource**——直接 mysql 客户端连库、硬编密码、编一个数字汇报给老板。spec §7.1 担心的"LLM 不会主动 list"成立，但根因更深：不是"不知道 list 工具"，而是"Bash 是 LLM 事实首选"。

启用 §7.1 prompt 注入（`result.instructions` 字段塞 skill 目录 + 触发场景 + 反触发）后重跑，三场景全 PASS：

| 场景 | V5 baseline | V5 + §7.1 | 结论 |
|---|---|---|---|
| A 直接询问业务问题 | 17 bash + 1 read，0 mcp，**mysql 硬编密码编数字** | 3 mcp read（warehouse-knowledge + 2 references）+ 2 read skill 文件，**正确拒绝幻觉，给出算法框架** | ❌→✅ **PASS** |
| B 明确点名 | list + read warehouse | read warehouse + analytics-reviewer + 探索 superstore-pitfalls | ✅ **PASS** |
| C 无关问题 | 2 bash, 0 mcp | 2 bash, 0 mcp | ✅ **PASS** |

**关键发现**：
1. §7.1 不只是"加 prompt"——是改变 LLM 的优先级。**MCP tool 不能指望塞进工具列表 LLM 自然会用**，必须 system-prompt 级别建立优先级
2. Skill 真正的核心价值是"**建立行为约束**"（不要编数字 / 必须先查 KTX / 高风险场景必须复核），不是"提供业务知识"
3. description 质量决定 LLM 探索深度——清晰的 description 让 LLM 能从 `dependencies` 字段推导出相关 skill 名字

完整报告：`inbox/lucy-skills-v5-report.md`（12KB，含环境复现命令 + 每个 tool call 序列 + 完整 LLM 答复）

## §7 后续演进（非 MVP）

### 7.1 自动注入增强（D 方案，opt-in）

**v1.2 状态：✅ 2026-08-29 V5 验证通过。** §7.1 已从"后续观察"提升为 **MVP 必选**（不开启则 LLM 不会主动用 skill，违背 §1 目标）。

**触发条件**：V5 baseline 实测发现 LLM 默认走 Bash 解决一切，**不**会自动调 MCP resource。详见 §6 V5 详细 + `inbox/lucy-skills-v5-report.md`。

**实施**：
- lucy-skills server 在 `initialize` 响应里塞 `result.instructions`（MCP 标准字段，client 应当把内容加进 LLM context）
- instructions 包含三部分：
  1. **能力声明**——告诉 LLM "本 server 有 list/read 资源"
  2. **触发场景**——"Before answering data / SQL / metric / business-analysis questions, consult the relevant skill from this catalog"
  3. **反触发**——"For code refactoring, file edits, documentation, and other non-data tasks: do NOT read these skills"
- 同时按 spec 暴露 `prompts/list` + `prompts/get` 能力，prompt 名 `lucy-skills-index`——给那些不读 `result.instructions` 的 client 留 fallback 入口
- 配置项：`prompt.autoInjectIndex: true/false`（v1.2 默认 `true`，MVP 即开启）
- 内容格式可由 data 团队自定义（`webui/config/lucy-skills-instructions.md` 或类似），MVP 阶段 hardcode

**V5 验证证据**：
- 场景 A：LLM 从 17 bash + 0 mcp → 3 mcp read + 拒绝幻觉 + 给算法框架
- 场景 B：LLM 主动 read 两个相关 skill + 探索额外 skill
- 场景 C：反触发有效，LLM 不调 skill

**已知局限**：
- §7.1 假设 client 正确处理 `result.instructions` 字段。如果 client 不处理（少数老 client），回退到 `prompts/get` 路径
- instructions 内容随 skill catalog 变化需要重生成——MVP 阶段可手动维护，长期看应该模板化（每个 skill 的 description 聚合）
- 触发场景和反触发的边界由人写——description 写不好的 skill 可能误触发或漏触发；详见 §4.2 description 字段质量要求

### 7.2 frontmatter description 字段补齐

新开 PR，给 `skills/**/SKILL.md` 补 `description` 字段，移除 §4.2 fallback 路径 2/3。

### 7.3 端口/凭据治理

如果未来 lucy-skills 引入鉴权（如 mTLS），与 KTX 的鉴权机制对齐；MVP 默认 localhost 无鉴权。

### 7.4 references 暴露

当前 references/*.md 不暴露为 resource，由 LLM 通过 Read 工具读。若发现 LLM 读 references 不便，考虑加二级 URI `lucy-skill://<name>/references/<file>`。

## §8 非目标（防 scope creep）

MVP 范围**不**包含：

- ❌ 暴露成 MCP tool 形式
- ❌ 暴露成 MCP prompt 形式（除 §7.1 opt-in）
- ❌ skill 内容编辑 / 写入（lucy-skills 是只读 server）
- ❌ skill 触发关键词匹配 / NLP 路由（依赖 LLM 自主判断）
- ❌ skill 版本管理 / 多版本共存（取最新一份即可）
- ❌ 与 KTX 状态共享 / 鉴权传递
- ❌ 与 wiki 检索集成
- ❌ Web UI（lucy-skills 是纯后台 server）
- ❌ Eval / Test 集成（V6/V7 错误注入用脚本完成，不在 server 代码里）

## §9 Backout Plan

如果 lucy-skills MVP 上线后出现严重问题（启动失败、资源泄漏、阻塞 Claude Code 启动），按以下顺序回退：

1. **客户端层退化**：从 `<repo-root>/.mcp.json` 删除 `lucy-skills` 条目；data agent 回到 D-1 收尾后的现状（LLM 主动 Read 工具读 `skills/**/SKILL.md`）
2. **进程层兜底**：lucy-skills 启动失败不应该影响 KTX 连接——`.mcp.json` 中两个 server 并列、独立，MCP client 行为应该是"一个 server 起不来不影响另一个"
3. **代码层回滚**：`git revert` lucy-skills 引入的 commit；`skills/` 内容保留不动（与 server 解耦）

Backout 后 lucy 仓库回到 D-1 收尾状态，无功能损失。

---

> **本 spec 是 lucy-skills MVP 的实施门控文档。修改本 spec 需走 Plan Mode（见 `docs/DEVELOPMENT.md` §强制流程：Plan Mode）。**
