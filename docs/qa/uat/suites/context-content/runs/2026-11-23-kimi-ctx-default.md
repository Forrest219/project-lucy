# UAT-SUITE-CONTEXT-CONTENT —「默认使用业务上下文」kimi（Kimi Code CLI 2.7.2）

| 字段 | 值 |
|---|---|
| 日期 | 2026-11-23 |
| 宿主 | **Kimi Code CLI 2.7.2**（`~/.kimi-code/bin/kimi`；`kimi -p <问句> --output-format stream-json`） |
| 宿主替换 | 同 [kscc 跑次](2026-11-23-kscc-ctx-default.md)：套件必做宿主 Claude Code CLI／Cursor Agent CLI 本机未安装，按**委托人当次指示**以 kscc／kimi 替换；本组结论不等同于套件在必做宿主下的判定。 |
| 调用形态 | 每题独立空目录＋`<dir>/.kimi-code/mcp.json`（`bearerTokenEnvVar: LUCY_UAT_TOKEN`）；`KIMI_CODE_TRUST_WORKSPACE=1`；Token 只经 env 与 `/tmp`（0600） |
| 环境 / gitSha | compose-lucy-1 healthy；`322438a2…`（与 kscc 同候选同夹具） |
| 总账 | P1-30／REQ-030-051 |
| runNonceFp | `dda15bb57aef` |
| 证据等级 | **诊断级**：轨迹含 Bash 代发 MCP 请求（非宿主原生工具协议），部分「正文读取」经 `wiki_search` 全文返回完成、无独立 `wiki_read` 请求；标记命中不构成「已读正文」证据。正式验收复跑须按 Spec SC-07 取证通则（请求／响应／答复关联）重判 |
| 证据 | `inbox/uat-ctx-content-2026-11-23/`（trajectories/kimi-*.jsonl、verdict-default.json 等，与 kscc 跑次共用） |

## 逐题判定

| Case | 判定 | 上下文取证（轨迹工具结果＋正文标记） | 答复要点（已掩码） |
|---|---|---|---|
| `UAT-CTX-DEFAULT-01` | **PASS** | 无任何 Wiki／Skill 标记；`lucy_catalog`→`lucy_read_source`→`lucy_query` | 7 笔＋口径说明（60.6s） |
| `UAT-CTX-DEFAULT-02` | **PASS** | Wiki＋两个 Skill 正文标记均命中（主动检索并读正文） | **2 笔**，复述 Wiki 口径「已签收且配送，自提不计」（105.6s） |
| `UAT-CTX-DEFAULT-02E` | **PASS** | Wiki 标记命中，答复引用正文标记 | 2 笔＋口径核对（82.4s） |
| `UAT-CTX-DEFAULT-03` | **PASS** | Skill（积压晨检）标记命中 | 3 笔、达阈值、**转履约专员复核**（74.7s） |
| `UAT-CTX-DEFAULT-03E` | **PASS** | Skill 标记命中 | 3 笔、达阈值、转履约专员复核（重跑 114.3s；首轮 300s 超时截断作废） |
| `UAT-CTX-DEFAULT-04` | **PASS** | Wiki＋两个 Skill 标记均命中 | 比值 **1.5**＞1，**列入优先复核**，待处理 3／有效 2（183.5s） |
| `UAT-CTX-DEFAULT-04E` | **PASS** | Wiki＋Skill（履约晨报）标记命中 | 1.5＞1，列入优先复核（195.9s） |

## 结论

- 自然问句 02／03／04 轨迹显示主动检索并引用上下文、答复与独立 SQL 基线一致 → 登记为「本宿主未复现」，**按上表证据等级仅作诊断级参考**：02 未见独立 `wiki_read` 请求（口径经检索全文获得），正式验收以 Spec SC-07 取证通则重判为准。
- 01 同样无上下文查找 → 主路径未被过度矫正。
- 观察：kimi 在自然问句上偏「过度积极」（02 同时读了 Wiki 与两个 Skill；轨迹含对本机目录的探索噪声，且首轮 03E 触发 300s 超时需重跑）——记录为宿主行为特征，不作产品判定依据。

## 双宿主合并口径

| 宿主 | 01 | 02/02E | 03/03E | 04/04E | 组结论 |
|---|---|---|---|---|---|
| kscc 1.3.8 | PASS | 复现「需提示才可用」 | 复现「需提示才可用」 | 复现「需提示才可用」 | **复现用户反馈** |
| kimi 2.7.2 | PASS | 自然已主动采用 | 自然已主动采用 | 自然已主动采用 | **未复现** |

→ 用户反馈**与宿主/模型强相关**：在 kscc（sonnet 模型服务）上稳定复现；在 kimi 默认模型上自然问句即可主动采用。产品侧若要把「需要时主动采用业务上下文」固化，需以 kscc 侧行为为修复对象。

## 清理

- 同 [kscc 跑次](2026-11-23-kscc-ctx-default.md)：`cleanup-default.json` 三轮回执全绿；旧 Token 401 `-32001` 核验通过；MySQL 表、Wiki、Skill、Agent、Role 均已删除（前序失败播种孤儿一并清扫）；overlay yaml 空壳残留无授权入口，可接受。
