# project-lucy 开发治理（Development Governance）

> 本文档面向**在本仓库写代码 / 改配置的 agent**（Claude Code、Codex 等）。

## 双轨语境：先看这里

本仓库有**两套独立语境**，混读会导致 prompt 污染或规则错配。其中开发态语境拆成两个并行入口（本规则文档 + 角色库），所以下表列 3 行：

| 文件 | 语境 | 谁读 | 注入方式 |
|------|------|------|---------|
| `CLAUDE.md` | **运行时**：KTX 数据问答规则 | KTX 内置 LLM agent | `ktx.yaml → llm.provider.backend: claude-code` 自动注入 |
| `AGENTS.md` → 本文件 | **开发态**（规则）：代码 / 配置修改治理 | Claude Code、Codex 等 coding agent | agent 启动时读取 AGENTS.md |
| `agents/README.md` | **开发态**（角色库）：vibe coding 多角色协作 | 同上，按需调用 | 同上 |

**规则**：两套语境只做单向引用，不互相复制内容。开发规则不得写入 `CLAUDE.md`；数据问答规则不得写入本文件。

---

## 适用范围

- **适用**：修改 `webui/`、`ktx.yaml`、`semantic-layer/`、`skills/`、`.ktx/` 等仓库源码与配置的任何会话
- **不适用**：纯数据问答场景——那部分规则在 `CLAUDE.md` 和 `.ktx/prompts/warehouse-knowledge.md`，不要把本文档内容同步进去

## 强制流程：Plan Mode

以下改动，必须先输出计划（Claude Code 用 Plan Mode / EnterPlanMode，Codex 用等价的"先列步骤"机制），经人工确认后才能落地：

- 新功能、架构调整、跨文件改动
- semantic-layer / 数据库 schema 相关变更
- 修改 `skills/`、`CLAUDE.md`、`AGENTS.md`、`ktx.yaml` 等治理类文件
- 任何会影响 KTX 数据问答运行时行为的改动

例外（无需先出计划，可直接执行，范围保持窄）：

- 单文件内的 typo / 注释 / 格式修正
- 已经在被批准的计划范围内的后续小步执行

## 红线（Off-Limits）

- `.ktx/secrets/` 下的密码/密钥文件：禁止读取内容后输出、禁止提交到 git
- `ktx.yaml` 中的数据库连接信息：改动前必须先确认，不能静默修改
- 生产数据库（Aliyun RDS MySQL）：只读查询，禁止 DDL/DML 写操作

## Spec 落位规则

- 仓库级 spec / 治理 / 跨模块产品视图落在 `docs/`，作为本仓库的事实来源
- 子模块自带的架构 / API / 数据模型等实现细节允许放在 `<module>/docs/`（当前实例：`webui/docs/01–06`），并在 `docs/project-overview.md` 注册索引
- `webui` 的 M0–M5 开发已由 Codex 串行完成，对应工单包 `webui/docs/codex/` 作为执行历史归档保留，不再领取；后续若新增工单仍遵循「就近放 `<module>/docs/`」原则
- 个人分析 / 协作笔记不进本仓库，按既有约定放 Obsidian

## Onboarding（首次拉取本仓库）

1. `cp ktx.yaml.example ktx.yaml`（如已存在 `ktx.yaml` 则跳过；当前 `ktx.yaml` 仍 tracked，新机器可以直接用）
2. 替换 `ktx.yaml` 中的 `<CHANGE-ME-*>` 占位符为本地实际值（host / db / username / 密码文件绝对路径）
3. `mkdir -p .ktx/secrets && echo '<your-mysql-password>' > .ktx/secrets/mysql-aliyun-password`（该目录已在 `.ktx/.gitignore` 排除）
4. 安装 KTX CLI：`npm install -g @kaelio/ktx@latest`（或在 `/Users/zhangxingchen/Projects/ktx` 跑 `pnpm install && pnpm run link:dev` 链入开发版本）
5. 启动本地 MCP daemon：`ktx mcp start --project-dir /Users/zhangxingchen/Projects/project-lucy`
   - 仓库已附带 `.mcp.json`（HTTP 端点 `http://localhost:7878/mcp`），Claude Code 启动时会自动连接；daemon 不运行则连接失败。
   - Claude Desktop 走 stdio 接入，详见下方 §Claude Desktop / 云端 Claude 接入。
6. 验证：`ktx status` 报告 `Agent integration ready: yes`，并跑一次 `ktx sl "<keyword>"` 看连接是否通

> **凭据/路径漂移防护**：`ktx.yaml.example` 由 M3.4 维护；当 `ktx.yaml` 中的 host/user/路径字段发生变化时，请同步更新 `.example`。

## Claude Desktop / 云端 Claude 接入

Claude Desktop 的"添加自定义连接器" UI 要求 HTTPS，且 URL 由 Anthropic 云端做 MCP discovery / OAuth 探测——`localhost` 系列地址（localhost / 127.0.0.1 / *.local）从云端不可达，**本地 HTTPS 反代也救不回来**（验证过：表单接受 `https://localhost:7880/mcp` 但提交后静默卡死）。按客户端分两条路：

**Claude Desktop → stdio**（推荐，无暴露风险）

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`，在顶层合并：

```json
{
  "mcpServers": {
    "ktx": {
      "command": "/Users/zhangxingchen/.local/bin/ktx",
      "args": ["mcp", "stdio", "--project-dir", "/Users/zhangxingchen/Projects/project-lucy"]
    }
  }
}
```

重启 Claude Desktop。每个 stdio 客户端独占一个 KTX 进程；Claude Code 仍走 7878 HTTP，互不影响。

> `command` 必须用绝对路径——GUI 应用启动时 PATH 不含 `~/.local/bin`。

**Web Claude / 云端 agent → cloudflared**（公网可达，**有暴露风险**）

仅在确实需要从云端访问 KTX 时考虑。KTX 连的是 Aliyun RDS 生产库，直接暴露 endpoint 等同暴露生产数据，**必须配 Cloudflare Access**（Email OTP / GitHub，Audience 限定到自己邮箱）：

```bash
brew install cloudflared
cloudflared tunnel login                       # 浏览器绑定域名
cloudflared tunnel create ktx-local
# 在 Cloudflare Zero Trust 控制台配 Self-hosted application + Access policy
```

Quick tunnel（`cloudflared tunnel --url http://localhost:7878`，无鉴权）域名虽随机但会落在 Claude Desktop config / 进程列表 / 浏览器 prefetch 等处，**不算秘密**，仅适合不涉敏数据的一次性调试。本仓库当前未预置 cloudflared 配置。

## 上游依赖：KTX

本仓库不包含 KTX 本体（CLI / MCP server / 语义层引擎），运行依赖外部 KTX 安装。

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/kaelio/ktx |
| 本机 clone | `/Users/zhangxingchen/Projects/ktx` |

何时查阅 KTX 源码：

- 注册 / 调试 KTX MCP server（启动命令、传输方式、可用 tool 列表）
- 验证 `sl_read` / `sl_query` / `wiki_search` / `sl_validate` 的实际行为与 `CLAUDE.md` 描述是否一致
- 排查 `ktx.yaml` 字段含义、scan / ingest / agent 行为
- 在 KTX 本身有 bug / 缺特性时定位上游 issue

约定：

- 修改 KTX 源码属于**上游变更**，在 `/Users/zhangxingchen/Projects/ktx` 内进行，遵循该仓库自身的协作规则，不在本仓库提交。
- 本仓库只引用 KTX，**不复制** KTX 内部规则 / prompt 到本仓库。

## Skills 当前状态

`skills/` 是 project-lucy 的增量能力补齐，**当前不被 KTX MCP server 自动加载**。data agent 仅能通过 Read 工具主动读取 `skills/**/SKILL.md`。

- `skills/` = single source of truth（lucy 增量补齐能力）
- `.ktx/skills/` 已废弃移除，不要再写入
- 自动加载 / 按需触发能力将由独立的 `lucy-skills` MCP server 提供（P1.5 立项中）

KTX 上游不承担 skill 加载职责（KTX 定位是语义层 + wiki 通用 MCP server）；skill 由 lucy 自行起 MCP server 暴露，与 KTX 并列向 data agent 提供服务。

## 语境分工（详细说明）

双轨设计概览见文档开头"双轨语境"表。本节补充维护约定：

- 两套语境只做单行引用，不整段复制对方内容。
- 新增开发规则 → 只写本文件或 `agents/` 下；不写入 `CLAUDE.md`。
- 新增数据问答规则（口径、表路由、Gotcha）→ 只写 `CLAUDE.md` 或 `.ktx/prompts/`；不写入本文件。
- 修改 `CLAUDE.md` 属于治理类文件变更，需走 Plan Mode（见上方"强制流程"）。
