# 跑次：2026-11-26-claude-aww-partial（REQ-0117 UAT 中断记录）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ACCESS-WRITE-WINDOW` |
| 日期／Agent | 2026-11-26／Claude（kscc） |
| 环境 | 隔离 compose 栈 `lucy-req0117-uat`（webui 55386／proxy 57995）；镜像 `project-lucy:demo` 重建自本机工作树（gitSha=`9bd6b130` 后续构建 dirty，含 REQ-0117 实现）；夹具＝2000 表＋500 Agent 规模水位＋30 宽角色 Agent（530 Agent／2003 启用表）；档位＝隔离栈自建规模（非共享 lean/scale 两档口径，规模下限等同 scale 档的 access/表维度） |
| 判定 | **BLOCKED**（跑次按委托人指示中断于 AWW-08 前台浏览器阶段；已完成用例的证据如下） |

## 逐用例结果

| ID | 判定 | 证据与数值 |
|---|---|---|
| UAT-AWW-R0 | PASS | 栈 healthy；夹具就绪（2003 启用表／530 Agent／manifest 在位）；登录凭据 `/private/tmp/lucy-req0117-private/` |
| UAT-AWW-01（SC-01 红基线） | PASS | `inbox/req0117-dev/baseline-2026-11-26T06-37-11-204Z.json`：写窗 10.4s、role-list 读 503 `DISPLAY_SNAPSHOT_BUSY`/`write_pending`×1、重叠写 0.555s 503 `PUBLISH_COORDINATOR_BUSY`；加重场景（30 宽 Agent）写窗 17.9–21.9s、窗内 503×5（task0-report.md §2） |
| UAT-AWW-02（SC-02/08 重叠写成交＋基线） | PASS | 新镜像实测：A（2000 表）200/5541ms `written=true`；B（重叠 1 表）200/5390ms `written=true`（有界等待后成交）；`pending` 子窗口 0 事件；另有小角色写 P50≈1.5s、2000 表角色 3.5–3.7s（530 Agent），冷启动首写 1.8s |
| UAT-AWW-03（SC-03 诚实拒绝） | PASS | `LUCY_PUBLISH_WAIT_BUDGET_MS=200` 注入：超限 B＝503/893ms，`Retry-After: 5`＋`detail.retryAfterSeconds=5`＋`detail.holder.kind=role_policy_save`；超队 C＝503/777ms（maxWaiters=1）；`manual_reindex` 持窗期 409 `REINDEX_IN_PROGRESS`（忙即拒绝不回归）；还原容器后复测通过 |
| UAT-AWW-04（SC-04 同对象 409） | PASS | 创建重叠：等待后取得锁 → 409 `ROLE_ID_TAKEN`；PATCH 重叠：等待后 409 `VERSION_CONFLICT`（`conflictKind=object_version`）；均不静默覆盖 |
| UAT-AWW-05（SC-05/06 读恢复＋读己之写，B1 分支） | PASS（API 层） | 客户端旅程语义轮询（单写×1＋重叠写×1 有效样本＋后续多轮写后读）：无指引错误终态 0 次；`pending 子窗口超限率 0/样本`；服务端 `write_pending` 事件在全部修复后写窗中为 0；读己之写：创建结算后列表含新角色（hasA=true/hasB=true） |
| UAT-AWW-06（SC-07 主路径成交） | PASS | 2000 表角色创建 `status=committed`/`written=true`/`runtimeAck=true`（屏障覆盖至 policy ack 未收窄）；`/api/health` policy 非 degraded |
| UAT-AWW-07（SC-09 纯 MCP 不回归） | PASS | `initialize` 200／`tools/list` 200（ACL 投影正确：探针 5 工具、deny 工具不可见）；`lucy_query`（superstore_orders.total_sales）200 成交含 `answer_verifiability`；`lucy_read_source` 200 成交；越权查询被拒（`tool_forbidden`） |
| UAT-AWW-08（SC-10 前台浏览器 E1–E18） | **BLOCKED（中断）** | 两轮跑次部分证据已存档（`runs/2026-11-26-claude-aww-browser/browser.json`＋截图）：E1/E5 列表加载与「新建 Role」primary PASS（primaryReady 0.9–1.2s）；E18 写窗内名册无错误终态 PASS；E3/E4/E8b/E13/E17 的浏览器断言在展示快照重建长尾窗口内未完成（见「过程发现」） |

## 过程发现（须记入后续跑次与运维观察面）

1. **展示快照重建长尾（已修复并验证）**：夹具规模下 role-list／agent-permissions 单次构建 >10s（事件循环阻塞块实测 10.2s），超过 `DISPLAY_BUILD_WAIT_BUDGET_MS=10s`，快照持续 pending（一度 70 分钟未恢复），SC-06 无法在合理时间验收。经委托人扩权（permission-display.ts／agents.ts 展示重建缩面）后：重启后冷读 roles 193ms/230 行 fresh、agents 867ms/530 行 fresh；语义等价由 `policy-incremental-recompile.test.ts`（6 用例）与相关 ACL 单测（47+85 项）保障。
2. 展示重建长尾期间页面呈现 200 `pending`（「加载中…」），按 P1-75 合同非错误终态；中断前累积 `prolongedServes=11`。
3. 单测对照：全量 `npx vitest run` 失败集经干净 HEAD 基线对照（临时 worktree）确认全部为存量（共享工作树其他在途任务／环境依赖）；本任务改动唯一引入的回归（admin-agents「并发第二写被拒」）已按新合同改写为「有界等待后串行成交、两写一致」并通过。

## 环境状态

- 隔离栈保留供复跑（`node scripts/uat/access-write-window-stack.mjs status`）。
- 夹具清理按 fixtures.md 执行（`fixture.mjs clean`）；共享 demo（compose-lucy-1）全程未触碰。
- 过程取证：`inbox/req0117-dev/`（baseline／profile／attribution／timeouts JSON＋task0-report.md）。
