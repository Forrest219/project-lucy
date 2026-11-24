# Fixtures — UAT-SUITE-CONTEXT-CONTENT

| 键 | 值 | 备注 |
|---|---|---|
| WebUI | `http://127.0.0.1:55176` | 以当次端口为准 |
| Health | `http://127.0.0.1:55176/api/health` | 记录 `gitSha` |
| MCP Proxy | `http://127.0.0.1:57881/mcp` | pathname 必须 `/mcp` |
| Compose | `deploy/compose/docker-compose.demo.yml` | |
| Lucy 容器 | `compose-lucy-1` | |
| WebUI 登录凭据 | `/Users/forrest/Desktop/lucywebui logi.txt`（若缺失则 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`） | 路径 only；2026-11-15 首跑用后者 |
| 内容播种 | **仅** Admin API（Cookie `lucy_admin_session`） | 禁止写仓库 tracked `wiki/`／`skills/` |
| Wiki key 形态 | `uat-ctx-wiki-<run-nonce>.md` | run-nonce＝小写 hex；**本文件不写具体 nonce** |
| Skill URI | `lucy-skill://uat-ctx/skill-<run-nonce>` | domain／name 均 `^[a-z0-9_-]+$` |
| Role／Agent 前缀 | `uat-ctx-content-{allow\|deny-nochan\|deny-noacl}-<run-nonce>` | 一身份一 agent |
| 通道工具（allow／deny-noacl） | `wiki_search`／`wiki_read`／`lucy_skill_search`／`lucy_skill_read` | 同一 Role |
| 宿主 A | Claude Code CLI `claude -p` | adapter `scripts/e2e/adapters/claude-code.mjs`；`--strict-mcp-config` |
| 宿主 B | Cursor Agent CLI | adapter `scripts/e2e/adapters/cursor-cli.mjs`；**套件级必做**（全局 registry `cursor-cli.required` 仍可为 false） |
| Token 绑定 | 每身份×阶段：单 server 生成配置 + env Bearer | cwd＝仓库外；明文不进 tracked |
| 播种脚本 | `node scripts/uat/seed-context-content.mjs` | Admin Cookie 播种＋R0-SEED；每次复跑新 nonce |
| 判定脚本 | `node scripts/uat/judge-context-content.mjs` | INDEX PASS 须可由其 JSON 复算 |
| 证据目录 | `inbox/uat-ctx-content-<date>/` | gitignored；含判定 JSON、nonce 指纹；首跑样例可对照 |

## 固定答问句（写入 Skill `triggers`；不含 nonce）

```
UAT context content canary question for skill retrieval
```

（跑次可另选等价固定句，但须与当次 Skill `triggers` **逐字一致**，并写入跑次记录。）

## 禁止

- 把 Bearer／密码／原始 nonce 写入 runs／INDEX／本 fixtures／设计  
- 同会话并列 allow＋deny 两个 MCP server  
- 同 agent 签两 token 冒充两身份  
- 用 GUI 冒充本套件 Cursor 半边（委托人已裁定 Agent CLI）  

## 默认使用业务上下文夹具

本组未来执行沿用上表的 Docker、两种宿主与单 server 配置。开跑前按 [全局规模基线](../../scale-baseline.md)执行 `npm run uat:scale-baseline`，核对适用维度达标。以下为叠加在基线上的合成业务数据与目标对象。

| 夹具 | 内容 |
|---|---|
| 身份 | 为本组签发一个绑定正式角色的独立临时 Agent。该角色同时允许本组 Source、语义查询以及 Wiki／Skill 查找和正文读取。Wiki `allowed_roles` 与 Skill `roles_allowed` 指向该角色。 |
| 语义资产 | 在 demo 的真实数据库建临时 `uat_ctx_orders_<run>`，用语义层发布唯一可回答本组问句的 Source，提供订单数和日期、区域、状态、配送方式字段。语义资产只描述事实字段和普通计数。 |
| 业务 Wiki | 标题及索引关键词包含「有效订单」。正文定义有效订单为「已签收且配送」，并含独立的当次标记。 |
| 业务 Skill · 积压晨检 | 发布独立 Skill，`triggers` 包含 `UAT-CTX-DEFAULT-03` 自然问句原文和业务词「积压晨检」。正文规定统计待处理订单，达到 3 笔即转履约专员复核，并含独立的当次标记。 |
| 业务 Skill · 履约晨报 | 发布独立 Skill，`triggers` 包含 `UAT-CTX-DEFAULT-04` 自然问句原文和业务词「履约晨报」。正文规定按有效订单口径计算「待处理订单数 ÷ 有效订单数」，比值大于 1 即列入优先复核，并含独立的当次标记。有效订单定义由业务 Wiki 提供。 |
| 数据隔离 | 业务词可出现在对象的标题、摘要或触发词。规则、阈值、分派动作及标记仅放正文，并在预检中核对查找摘要与目录的内容。Agent 工作目录用仓库外的空目录，仅挂 Lucy，禁用其他上下文来源及跨会话记忆。 |
| 已治理直通 | 为 `05` 使用另一临时角色和独立 Source。沿用独立 SQL 口径，在受测语义度量描述或生效口径绑定中定义「有效订单」。角色有查询权限且无 Wiki／Skill 工具通道。对照 `02` 的身份不得发现这个 Source。 |
| 部分可答与超时 | 为 `06` 分设未命中、工具或对象无权限、正文读取失败或受控超时、两个适用范围重叠的 Wiki 定义，以及 Skill 缺失控制。每组用独立身份或重置代次，并固定仍可答的子结论。故障只命中目标调用，超时发生前预登记用例时限和独立核对值。 |
| 同窗额外负载 | 在 P1-75 G2 夹具中给 MIX 新增的 12 个 Agent 绑定各自的授权组合，分别校验 Wiki、Skill、组合旅程的预期正文和查询值。准备可撤销的上下文授权对照，保留原 50 个 Agent 及 3 个原窗口分母。 |

在北辰区 `2026-11-09` 至 `2026-11-15` 业务自然日内写入下表记录，每笔使用独立订单 ID。另写一笔不同区域的期内订单和一笔北辰区的期外订单，用于验证过滤。

| 状态 | 配送方式 | 笔数 |
|---|---|---:|
| 已签收 | 配送 | 2 |
| 已签收 | 自提 | 1 |
| 待处理 | 配送 | 3 |
| 已取消 | 配送 | 1 |

用只读 SQL 以 `region=北辰区` 和日期区间 `[2026-11-09, 2026-11-16)` 分别核对全部、已签收且配送、待处理三组计数，预期为 7、2、3。依据夹具正文独立核对晨检动作和晨报比值，预期为转履约专员复核，以及 `3 ÷ 2 = 1.5`、列入优先复核。将 SQL、结果和规则版本指纹存入当次证据，避免用 Lucy 的输出反推期望值。正文标记和凭据沿用本套件的保密约定。
