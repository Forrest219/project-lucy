# lucy-skills MCP Server Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | lucy-skills MCP Server Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-18 |
| 撰写人 | Claude |
| 委托人 | zhangxingchen |
| 基于材料 | `dev-inbox/20260617-2320-project-lucy-progress-and-plan.md` P1 决策；`docs/DEVELOPMENT.md` §Skills 当前状态；KTX MCP server 当前能力清单（4 tool + 1 prompt）；本会话 D-1 / E1 决策上下文 |
| 适用范围 | lucy-skills MCP server MVP 实施门控；data agent 客户端集成参考 |
| 输出位置 | /Users/zhangxingchen/Projects/project-lucy/lucy-skills/docs/01-spec.md |

## §1 背景与决策

### 1.1 问题

project-lucy 在 KTX 之上沉淀了一组 SKILL.md（`skills/warehouse`、`skills/reviewer`、可能未来扩展 `skills/domains/*`），但当前 data agent **无法以结构化方式按需触发**这些 skill：

- KTX MCP server 仅暴露 4 个 tool（`sl_read` / `sl_query` / `wiki_search` / `sl_validate`）+ 1 个 always-on prompt（`warehouse-knowledge`）
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
- 运行形态：HTTP server（与 KTX 一致），默认端口 7879
- 子目录 `lucy-skills/` 自带 `package.json`，与 lucy 主仓库 git history 同仓但独立可发布

## §2 架构定位

```
data agent (Claude Code / 其他 MCP client)
    │
    ├── KTX MCP (localhost:7878)        ← 语义层 / wiki / sl_*
    │                                     维护：KTX 上游
    │                                     角色：通用底座
    │
    └── lucy-skills MCP (localhost:7879) ← skill 索引 + 内容
                                          维护：本仓库
                                          角色：lucy 增量补齐
```

- 两个 server 互不感知，data agent 端通过 `.mcp.json` 并列接入
- lucy-skills 不读 KTX 状态，不依赖 KTX 运行（KTX 宕机不影响 skill 可用性）
- lucy-skills 不写任何持久化状态（无状态 server，纯文件扫描）

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
  "port": 7879,
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
      "url": "http://localhost:7879/mcp"
    }
  }
}
```

## §6 验证标准

实施完成必须满足以下全部验证项：

| # | 验证 | 方式 |
|---|---|---|
| V1 | `npm start` 能起服务并打印加载的 skill 数（当前期望 ≥ 2：warehouse-knowledge、analytics-reviewer） | 终端观察 |
| V2 | 用 `mcp-inspector` 连 `http://localhost:7879/mcp`，调 `resources/list` 返回非空数组，每项含 uri/name/description/mimeType | inspector UI |
| V3 | inspector 调 `resources/read` 用 V2 拿到的 URI，返回 SKILL.md 全文（含 frontmatter） | inspector UI |
| V4 | Claude Code 启动时能并列连上 KTX 和 lucy-skills，无连接错误 | Claude Code 启动日志 |
| V5 | 在 Claude Code 一次会话中显式让 LLM 调 `resources/list` + `resources/read` 走完链路，输出 skill 内容 | 对话验证 |
| V6 | 故意把某 SKILL.md frontmatter 删掉 `name` → 启动 warning log，其他 skill 仍正常加载 | 错误注入 |
| V7 | 故意把扫描根目录指向不存在路径 → 启动 warning log，server 仍能起 | 错误注入 |

V5 是 MVP 上线的真实信号：LLM 能否**主动** `resources/list`。如果 V5 通不过（LLM 不会主动 list 资源），触发 §7.1 增强决策。

## §7 后续演进（非 MVP）

### 7.1 自动注入增强（D 方案，opt-in）

触发条件：§6 V5 显示 LLM 在普通对话中不会主动 `resources/list`。

实施：
- lucy-skills 暴露一个 prompt `lucy-skills-index`，内容是所有 skill 的 `name + description` 索引
- 客户端通过 prompt 注入机制让 LLM 启动即可见 skill 目录
- 配置项加 `prompt.autoInjectIndex: true/false` 开关

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
