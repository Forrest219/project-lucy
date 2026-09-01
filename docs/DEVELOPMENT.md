# project-lucy 开发治理（Development Governance）

> 本文档面向**在本仓库写代码 / 改配置的 agent**（Claude Code、Codex 等）。

## 双轨语境：先看这里

本仓库有**两套独立语境**，混读会导致 prompt 污染或规则错配。其中开发态语境拆成两个并行入口（本规则文档 + 角色库），所以下表列 3 行：

| 文件 | 语境 | 谁读 | 注入方式 |
|------|------|------|---------|
| Lucy MCP Proxy `initialize` instructions（内容来源 `webui/config/data-qa-instructions.md`） | **运行时**：数据问答规则 | 任何走 `:7879` 连接的客户端（Codex、Cursor、Claude Code 等） | MCP `initialize` 响应注入，见 `webui/docs/07-mcp-auth-proxy-spec.md` §4.4 |
| `AGENTS.md` → 本文件 | **开发态**（规则）：代码 / 配置修改治理 | Claude Code、Codex 等 coding agent | agent 启动时读取 AGENTS.md |
| `agents/README.md` | **开发态**（角色库）：vibe coding 多角色协作 | 同上，按需调用 | 同上 |

**规则**：两套语境只做单向引用，不互相复制内容。开发规则不得写入 `CLAUDE.md` 或 `webui/config/data-qa-instructions.md`；数据问答规则不得写入本文件。`CLAUDE.md` 现在只做指引（指向 `AGENTS.md` 和 proxy instructions 机制），不再承载数据问答规则正文。

---

## 适用范围

- **适用**：修改 `webui/`、`ktx.yaml`、`semantic-layer/`、`skills/`、`.ktx/` 等仓库源码与配置的任何会话
- **不适用**：纯数据问答场景——那部分规则在 `webui/config/data-qa-instructions.md`（由 Lucy MCP Proxy 注入，见 `webui/docs/07-mcp-auth-proxy-spec.md` §4.4），不要把本文档内容同步进去

## 强制流程：Plan Mode

以下改动，必须先输出计划（Claude Code 用 Plan Mode / EnterPlanMode，Codex 用等价的"先列步骤"机制），经人工确认后才能落地：

- 新功能、架构调整、跨文件改动
- semantic-layer / 数据库 schema 相关变更
- 修改 `skills/`、`CLAUDE.md`、`AGENTS.md`、`ktx.yaml`、`webui/config/access.yaml`、`webui/config/data-qa-instructions.md`、`webui/docs/07-mcp-auth-proxy-spec.md` 等治理类文件
- 任何会影响 KTX 数据问答运行时行为或 Lucy MCP Proxy 鉴权/指导内容的改动

例外（无需先出计划，可直接执行，范围保持窄）：

- 单文件内的 typo / 注释 / 格式修正
- 已经在被批准的计划范围内的后续小步执行

## 验证策略：浏览器测试约束

正常开发任务默认不需要做浏览器测试。只有在用户、当前任务说明或已批准计划明确要求浏览器测试、端到端浏览器验证、截图验证、Playwright/Cypress 浏览器运行，或交付标准本身以浏览器行为验证为准时，才执行浏览器测试。

Lucy 项目默认不做移动窄屏测试。除非用户、当前任务说明或已批准计划明确要求移动端、窄屏、响应式断点验证，不要主动执行 mobile viewport、narrow viewport 或 mobile emulation 相关测试。

现有 E2E 套件与 release gate 文档仍作为“被明确要求执行浏览器/E2E 验证时”的测试事实源；它们不改变普通开发任务的默认验证范围。

## 红线（Off-Limits）

- `.ktx/secrets/` 下的密码/密钥文件：禁止读取内容后输出、禁止提交到 git
- `ktx.yaml` 中的数据库连接信息：改动前必须先确认，不能静默修改
- 生产数据库（Aliyun RDS MySQL）：只读查询，禁止 DDL/DML 写操作

## Spec 落位规则

- 仓库级 spec / 治理 / 跨模块产品视图落在 `docs/`，作为本仓库的事实来源
- **访问权限（Access Control）域档案**落在 [`docs/access-control/`](access-control/README.md)：域设计 / ADR / UAT / 本域 WO；Proxy/Admin 编号实现 Spec 仍就近留在 `webui/docs/`（如 `07`/`14`/`15`），由域 README 交叉引用
- 子模块自带的架构 / API / 数据模型等实现细节允许放在 `<module>/docs/`（当前实例：`webui/docs/01–06`），并在 `docs/project-overview.md` 注册索引
- `webui` 的 M0–M5 开发已由 Codex 串行完成，对应工单包 `webui/docs/codex/` 作为执行历史归档保留，不再领取；后续若新增工单仍遵循「就近放 `<module>/docs/`」原则
- 个人分析 / 协作笔记不进本仓库，按既有约定放 Obsidian
- eval cases（YAML，agent 测）与 quiz HTML（人类测）的设计原则、命名约定、数据获取路径见 `docs/eval-quiz-conventions.md`；新增 dataset 的 eval/quiz 前必读

## Spec 内容规格：重要功能必含伪代码

**落位规则管「放哪里」；本节管「写什么」。** 术语必填见下方「Terminology Compliance」；本节约束**有决策 / 状态 / 管线**的重要功能 Spec。

### 触发条件（必须写）

新增或重大更新的功能 Spec，若包含下列任一语义，必须包含**可直接指导实现与验收**的核心流程伪代码（或等价 Normative 步骤 / 代数）：

- 权限 / ACL / 编译 / 裁决 / deny 码路径
- 多步状态机、门禁、发布 / 生效 / 索引管线
- 跨模块数据流、匹配 / 归一化 / digest / 合并算法
- 其他「分支顺序决定正确性」的核心行为（实现者不能只靠散文猜）

### 豁免（可不写）

- 纯文案、术语、IA 标签、视觉 polish、单字段改名
- 无分支的布局 / 间距 / 颜色调整
- 仅引用既有 Spec 算法且本 Spec **不改变**该流程语义（须在正文显式指向权威小节）

不确定时：**偏重要则写**；Review 可要求补齐后再批 Gate B / 开工。

### 必填小节形态

每个命中触发条件的 Spec 必须包含以下小节之一（标题固定，便于扫读）：

```md
## 核心流程（伪代码）
```

或英文 Spec：

```md
## Core Algorithm
```

内容要求：

- 使用 `text` / `ts` 代码块、编号步骤，或已有的 Normative 代数（如 AC-P1 `FinalRows` / DNF）；**禁止**只有「系统应当正确处理」类空话
- 覆盖主成功路径与关键失败 / deny / 降级分支的**顺序**
- 足以让实现者写出代码、让验收写出断言；细节类型签名可指向 API / Data Model 小节，但控制流不得省略
- 与 Acceptance / SC-\* 可对上：伪代码里出现的关键分支应能映射到至少一条验收项

参考（已有写法，非穷尽）：`webui/docs/99-access-control-p1-row-policy-spec.md`、`webui/docs/100-access-control-p15-agent-constraints-spec.md`、`webui/docs/13-business-wiki-ux-refactor.md`（Wiki Auto-Match Algorithm）、`webui/docs/62-trace-evidence-kernel-spec.md`。

### Review 要求

- Spec / Gate B 评审必须检查：命中触发条件时是否存在上述小节，且伪代码可执行地描述控制流
- WO「必含章节」列表（若该域使用）应包含「核心流程（伪代码）/ Core Algorithm」；**不替代**本文件为本规则的事实源
- **不**要求立刻用 `lint:spec` 机械检测伪代码质量；稳定后再考虑弱 warn（例如仅检查小节标题是否存在）

## 全系统术语规范

Lucy 的系统级术语事实源是
[`webui/docs/00-product-terminology-standard.md`](../webui/docs/00-product-terminology-standard.md)。
所有 WebUI、API 用户可见错误、Toast、Modal、Drawer、表格列名、导航、测试断言、
Spec、Plan、Runbook 和交付文档都必须遵守该标准。

### 新模块必填 Terminology Compliance

每个新增或重大更新的功能 Spec 必须包含以下小节：

```md
## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None
```

如果引入新概念，必须先在 `webui/docs/00-product-terminology-standard.md` 登记或在该小节说明新增术语、UI 主术语和禁止文案。

### 开发与 Review 要求

- 新增 UI 文案前先查术语标准，不得临时自造译名。
- 不得把 `Schema` 翻译成“架构 / 模式”，不得把 `Manifest` 翻译成“舱单 / 清单”，不得把 `Package` 翻译成“报价包”。
- 专业英文术语、数据库对象名、文件名、路径和 URL 的 DOM 节点必须添加 `translate="no"` 和 `notranslate`。
- Code Review 必须检查术语一致性、禁用词和浏览器翻译防御。
- WebUI 变更提交前运行 `cd webui && npm run lint:terminology`；根目录也可运行 `npm run lint:terminology`。

## WebUI 设计规范（Design System）

Lucy WebUI 的设计规范事实源在
[`webui/docs/design-system/README.md`](../webui/docs/design-system/README.md)。

强约束如下：

- 涉及 UI 视觉或交互的改动，必须先对照对应章节（Foundations / Components / Patterns / Governance）。
- 新增视觉模式（如新按钮分层、新网格策略、新颜色语义）必须先补规范再落代码。
- PR / 交付说明必须包含 `Design System Compliance` 小节，至少写明“引用章节 + 本次遵循点”。
- 若需求超出已定义章节，先在 `webui/docs/design-system/99-governance.md` 记录临时决策，再在后续迭代升级为正式规范。

## Onboarding（首次拉取本仓库）

本地测试配置（连接、ACL、内网语义层）**完全私有**，不进共享 git。仓库只提供 `.example` / demo stub / `customer-config.example`。

1. `cp ktx.yaml.example ktx.yaml`（`ktx.yaml` 已 gitignore；每人/每机私有）
2. 替换 `ktx.yaml` 中的 `<CHANGE-ME-*>` 占位符为**你自己的**本地实际值（host / db / username / 密码文件绝对路径）
3. `mkdir -p .ktx/secrets && echo '<your-db-password>' > .ktx/secrets/<connection>-password`（该目录已在 `.gitignore` 排除）
4. `cp webui/config/access.yaml.example webui/config/access.yaml`（`access.yaml` 已 gitignore；按需改成你的私有 Agent / token）
5. 私有语义层 / wiki / eval：自行维护在本机（例如 `semantic-layer/<your-connection>/`），**不要 commit**；仓库仅跟踪 `semantic-layer/demo-mysql/`（CI stub）与 `examples/*/project-template/`
6. 安装 KTX CLI：`npm install -g @kaelio/ktx@latest`（或在本地 ktx 仓跑 `pnpm install && pnpm run link:dev`）
7. 启动本地 MCP daemon：`ktx mcp start --project-dir <本仓库绝对路径>`
8. 验证：`ktx status` 报告 `Agent integration ready: yes`，并跑一次 `ktx sl "<keyword>"` 看连接是否通
9. 启动 Lucy MCP Proxy（`:7879`）：`cd webui && npm run dev`
10. 配置 `.mcp.json`，指向 Lucy MCP Proxy：
   ```json
   {
     "mcpServers": {
       "lucy": {
         "type": "http",
         "url": "http://localhost:7879/mcp",
         "headers": { "Authorization": "Bearer ${LUCY_LOCAL_TOKEN}" }
       }
     }
   }
   ```
   `${LUCY_LOCAL_TOKEN}` 用环境变量插值，本机 shell 从 `.ktx/secrets/` 读取后 `export`，不要把明文写进 `.mcp.json`。

> **凭据/路径漂移防护**：`ktx.yaml.example` / `access.yaml.example` 仅作模板；真实连接与 ACL 永不提交。

### 本地 Docker demo 重建

本机 demo 重建必须走 **host-native** 路径，禁止误用客户打包用的 `lucy-amd64` builder（ARM 上会变成 QEMU，经常 >10 分钟像卡住）。

- **平滑升级（默认，保留账号与 audit 日志）**：`npm run demo:upgrade`（或 `npm run demo:rebuild`；支持 `--no-cache`、`--backup-dir inbox/backups`）。重建镜像并 `--force-recreate` 容器，**不**删除 `lucy-demo-data` volume。
- **从零 reseed（仅 dev 验收干净模板）**：`npm run demo:upgrade -- --fresh`（等价于删除 `lucy-demo-data` 后重新 seed）。
- 等价手写：`BUILDX_BUILDER=default bash scripts/upgrade-lucy.sh -f docker-compose.demo.yml`。
- amd64 开发者覆盖：脚本已按 host 自动选择；若直接 compose，传 `TARGETPLATFORM=linux/amd64 TARGETARCH=amd64`。
- 客户 amd64 离线包 / K8s integration 大包：推荐 `bash scripts/build-customer-amd64-image.sh`（含 G1–G4 + G4b 门禁）；或 `docker buildx build --builder lucy-amd64 ...` 并显式 `--build-arg TARGETPLATFORM=linux/amd64 --build-arg TARGETARCH=amd64`（创建 builder 时**不要** `--use`，结束后 `docker buildx use default`）。交付前**必须**完整走一遍 [`docs/customer-delivery-preflight-checklist.md`](customer-delivery-preflight-checklist.md) 与 [`docs/customer-amd64-image-build-checklist.md`](customer-amd64-image-build-checklist.md)（含 `assert-image-elf-arch.sh` 对 **node+tini** 架构、Python runtime 离线预装 G4b、Helm MCP URL 守卫及现场验收命令）。详见 `docs/lucy-customer-amd64-offline-delivery-spec.md` 与 `docs/lucy-202608-08-image-arch-and-ktx-baseline-fix.md`。
- Demo 使用 `LUCY_TEMPLATE_ROOT=examples/docker-demo/project-template`（本地 `demo-mysql`），**不会**把内网测试库打进客户默认 seed。

## 语义层（semantic-layer）分层

`semantic-layer/<connection>/` 下的 yaml 看似两份重名文件，实际是 ktx 的
**manifest / overlay 双层设计**，由 loader 合并（参考
[`ktx-sl` 的 `loader.py::_compose`](https://github.com/kaelio/ktx/blob/main/python/ktx-sl/semantic_layer/loader.py)）。
**manifest/overlay 的归类错误会导致引擎按物理列查表，触发 `Unknown column`
却 validate 通过**——本节明确每类改动落哪、怎么让 MCP 检索到。

### 文件分类

| 文件 | 角色 | 谁写 | 内容 |
|---|---|---|---|
| `_schema/<schema>.yaml` | **manifest**：仓库物理表结构 | ktx 扫描 warehouse 自动生成 | 表名、列名、类型、nullable、双语描述 |
| `<table>.yaml` | **overlay**：lucy 的业务扩展 | 人工维护 | grain、columns（含 `expr` 派生列）、measures、segments、joins |

### 改什么落哪

| 改动 | 落点 | 例子 |
|---|---|---|
| 加一条业务指标 | overlay `measures:` | `total_profit: sum(profit)` |
| 加一个常用过滤 | overlay `segments:` | `active_rows: is_deleted = 0` |
| 加一个派生维度 | overlay `columns:` | `order_year: type: time, expr: YEAR(order_date)` |
| 改物理列的描述/类型 | overlay `column_overrides:` | （不要改 manifest） |
| 新增物理列 | 等下次 ktx 扫描重生成 manifest | — |

### 关键 gotcha

- **manifest 的列模型叫 `ManifestColumn`，不接受 `expr` / `role`**——把派生列写在
  manifest 里 `ktx sl validate` 不会报错，但 `expr` 被静默丢弃，引擎按物理列查就
  `Unknown column`。**派生列只能落在 overlay 的 `columns:` 块。**
- **不要手改 manifest**：下次 ktx 扫描 warehouse 会被覆盖掉。
- **不要在 overlay 里"新建"与 manifest 同名的列**——要用 `column_overrides:`
  增量补丁。loader 注释明说「Manifest column names cannot be reused here」。
- `columns:` 块里的 `expr` 由 `_expand_computed_columns` 在 SQL 生成时内联展开，
  生成形如 `(YEAR(superstore_orders.order_date)) AS order_year` 的合法 SQL。

### 改完 yaml 的标准流程（必走）

`semantic-layer/` 文件夹是**磁盘**；MCP server / `ktx sl <搜索词>` 读的是
**本地 SQLite 索引**（`ktxLocalStateDbPath`）。改 yaml 后必须**手动重建索引**，
否则 MCP agent 用 `sl_search` 找不到新增的列/measure/segment。

```bash
# 1. 重建索引（扫盘 → 写 SQLite）
ktx --project-dir /Users/zhangxingchen/Projects/project-lucy admin reindex

# 2. 验证（任一即可）
ktx sl validate superstore_orders           # YAML 语法 + 合并结果合法
ktx sl read superstore_orders              # 列出列/measure/segment 实际可见
ktx sl "order_year"                        # 搜索索引能命中
```

**关键事实**：

- 索引输出按 scope 分行报告：`sl/mysql-aliyun` 的 `scanned/updated/embeddings` 反映
  这次到底改了几条。
- `admin reindex` 默认是**增量更新**；彻底重建用 `admin reindex --force`（清空后
  全量重写，谨慎用）。
- 改完 yaml **不需要重启 MCP daemon**——daemon 通过 SQLite 文件读取，下次查询
  立即生效。
- 如果配了 embedding provider，reindex 会重新计算 embeddings；未配置则只做
  lexical 索引（warn 级别提示，不阻塞）。

### 反例

```yaml
# ❌ 错：把派生列写在 manifest，expr 被 ManifestColumn 静默丢弃
# 文件：_schema/dataforai.yaml
- name: order_year
  type: time
  expr: YEAR(order_date)        # ← 生效无效

# ✅ 对：派生列写在 overlay，SourceColumn 支持 expr
# 文件：superstore_orders.yaml
columns:
  - name: order_year
    type: time
    role: time
    expr: YEAR(order_date)
```

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
- 新增开发规则 → 只写本文件或 `agents/` 下；不写入 `CLAUDE.md` 或 `webui/config/data-qa-instructions.md`。
- 新增数据问答规则（口径、表路由、Gotcha）→ 只写 `webui/config/data-qa-instructions.md`（由 Lucy MCP Proxy 注入，见 `webui/docs/07-mcp-auth-proxy-spec.md` §4.4）；不写入本文件或 `CLAUDE.md`。
- 修改 `CLAUDE.md`、`AGENTS.md`、`webui/config/data-qa-instructions.md`、`webui/config/access.yaml`、`webui/docs/07-mcp-auth-proxy-spec.md` 均属于治理类文件变更，需走 Plan Mode（见上方"强制流程"）。
