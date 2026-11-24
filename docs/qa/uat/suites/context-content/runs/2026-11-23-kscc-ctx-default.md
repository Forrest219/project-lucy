# UAT-SUITE-CONTEXT-CONTENT —「默认使用业务上下文」kscc 1.3.8

| 字段 | 值 |
|---|---|
| 日期 | 2026-11-23 |
| 宿主 | **kscc 1.3.8**（本机 `~/.local/bin/kscc`；`claude` 形态 CLI） |
| 宿主替换 | 套件必做宿主为 Claude Code CLI＋Cursor Agent CLI；本机均未安装。按**委托人当次指示**（2026-11-23 对话）以 kscc／kimi 双宿主替换执行；与套件必做宿主口径的偏差如实登记于此，本组结论**不等同**于套件在指定必做宿主下的判定。 |
| 调用形态 | `kscc -p --no-session-persistence --no-chrome --tools "" --strict-mcp-config --mcp-config <0600私有配置> --permission-mode dontAsk --allowedTools "mcp__lucy__*" --output-format stream-json --verbose`；cwd＝仓库外每题独立空目录；Bearer 仅写在 `/tmp` 0600 配置 |
| 环境 | compose-lucy-1 healthy；WebUI `55176`；MCP `57881`；demo-mysql `53306` |
| gitSha | `322438a2…`（gitDirty=false；health 实读） |
| 总账 | P1-30／REQ-030-051 |
| runNonceFp | `dda15bb57aef`（`sha256(nonce)` 前 12；原始 nonce 不落本文档） |
| 凭据 | WebUI 管理员：委托人当次对话提供（不落盘）；Token 仅 `/tmp`（0600） |
| 证据 | `inbox/uat-ctx-content-2026-11-23/`（seed-default-evidence.json、probes_retest、verdict-default.json、trajectories/kscc-*.jsonl、cleanup-default.json） |

## R0（UAT-CTX-DEFAULT-R0）

- 规模基线：`npm run uat:scale-baseline` 3 项 FAIL（每 Agent 凭据 1<3、Wiki 2<300、Skill 7<100）；**均非本组夹具维度**，不构成 BLOCKED 依据，仅登记。
- 夹具：MySQL `uat_ctx_orders_[RUN]` 9 行（北辰区窗内 7＋区外 1＋窗外 1）；独立 SQL 核对 **7／2／3** 通过；语义源经 `/api/semantic-assets` validate＋publish；Wiki（有效订单口径）＋Skill（积压晨检／履约晨报）均 published 且 ACL 指向本组角色。
- 环境修复（跑次内登记，均走产品正式 API）：① 角色补 `tableSelectors`（PATCH 初次误用 POST 形态空操作，已按 `patch:{allow}` 契约改写成功）；② ACL 源映射要求 `_schema` manifest 含本组表（已并入发布，原 manifest 备份待还原）；③ `ktx.yaml enabled_tables` 追加本组物理表（PUT `/api/connections/demo-mysql/enabled-tables`）。
- 探针复测全绿：`tools/list` 10 工具可见；`lucy_query` 三组计数 **7／2／3** 与独立 SQL 一致；`wiki_read`／两个 `lucy_skill_read` 均含当次正文标记；`wiki_search`／`lucy_skill_search` 均命中夹具。（观察项：`wiki_search` 结果含正文全文而非纯摘要——同 GAP-2 登记为观察，不作判定依据。）

## 逐题判定

| Case | 问句形态 | 判定 | 上下文取证（轨迹） | 答复要点（已掩码） |
|---|---|---|---|---|
| `UAT-CTX-DEFAULT-01` | 普通问数对照 | **PASS** | 仅 `lucy_catalog`＋多次 `lucy_query`＋`lucy_read_source`；**无任何 Wiki／Skill 查找** | 7 笔，附 answer_verifiability 口径与来源（21.3s） |
| `UAT-CTX-DEFAULT-02` | 自然问句 | **FAIL** | **未发起任何查找**；1 次 `lucy_query` 后自编口径 | 「有效订单＝**6 笔**（已签收3＋待处理3）」——自创口径，正确值 2（35.2s） |
| `UAT-CTX-DEFAULT-02E` | 显式提示 | **PASS** | `wiki_search`＋`wiki_read`，正文标记命中 | 2 笔，复述 Wiki 口径「已签收且配送」（25.9s） |
| `UAT-CTX-DEFAULT-03` | 自然问句 | **FAIL** | **未发起任何查找**；1 次 `lucy_query` 后自行发挥 | 待处理 3 单＋自创「积压率 43%」分析；**无 Skill 规程动作（未提转履约专员复核）**（70.7s） |
| `UAT-CTX-DEFAULT-03E` | 显式提示 | **PASS** | `lucy_skill_search`＋`lucy_skill_read`，Skill 标记命中 | 3 笔、达 3 笔阈值、**转履约专员复核**（24.5s） |
| `UAT-CTX-DEFAULT-04` | 自然问句 | **FAIL** | 仅 `wiki_search`（命中正文内容）→ 口径对；**未读 Skill**、无规程结论 | 有效 2 单正确即止；**无比值 1.5、无优先复核**（26.3s） |
| `UAT-CTX-DEFAULT-04E` | 显式提示 | **PASS** | `wiki_search`＋`wiki_read`＋`lucy_skill_search`＋`lucy_skill_read`，双标记命中 | 3÷2＝**1.5**＞1，**列入优先复核**（39.1s） |

## 结论

- 自然问句 02／03／04 **FAIL**，同题显式提示 02E／03E／04E **PASS** → 三对均按判定口径登记为**复现「需提示才可用」**。
- 01（纯语义问数）PASS：默认走语义、不碰 Wiki／Skill 的主路径未被破坏——修复提案不得回退此条。
- **本宿主结论：复现用户反馈**（默认取语义；业务 Wiki／Skill 需提示词要求才采用）。

## 清理

- 见 `inbox/uat-ctx-content-2026-11-23/cleanup-default.json`（含前序失败播种孤儿清扫与旧 Token 401 核对回执）。
