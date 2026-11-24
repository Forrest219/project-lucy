# Run — 2026-11-17 — cursor-sankey-demo-docker

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ACCESS-MAP-SANKEY` |
| Agent | Cursor（Claude） |
| 性质 | **demo Docker 复验**（委托人已平滑升级容器，「升级成功，请执行检测」）。全真：真实容器、真实 WebUI、真实登录、真实数据；不造数据、不签发 Token |
| 环境 | `http://127.0.0.1:55176`，容器 `compose-lucy-1` healthy；`/api/health`：`lucyVersion=0.30.0`、`gitSha=65f40847…`、**`gitDirty=true`**（容器含工作树未提交改动）。容器内 5 个桑基相关源文件的 sha256 前 12 位与宿主逐一相同，`dist/assets/AccessMap-*.js` 含 `idle-agg`。管理员登录用仓库外凭据文件，只读入进程，未打印 |
| 视口 | 1920×1080，无头 Chromium（Playwright），探针 `inbox/sankey-demo-probe.mjs`（临时文件） |
| 总判定 | **PASS WITH GAP**：02、04 在 demo Docker 全真通过；01、03、05 需要 rich／sparse／dense 种子数据，demo 里没有也不应擅自写入，仍只有沙箱结果；07 线上 BLOCKED |

demo 的真实数据形态：2 个 Agent、2 个角色、2 个连接、5 张表；`grantPaths=5`、`accessPaths=0`、`rawCalls=0`、`unconfirmedCalls=6`。天然落在「零访问」与「全未确认」两类形态上。

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-SANKEY-R0（demo） | **PASS** | 登录 200；`/api/admin/access-map` 200，`access.state=ok`、`trust=confirmed`；边 9 条全 `dormant`。demo 数字与沙箱种子不同，属预期 |
| UAT-SANKEY-02（对应零访问） | **PASS** | 表列存在（节点：agent 2／role 2／connection 2／table 2）；2 个闲置聚合节点「3 张表·3 条」「2 张表·2 条」，合计 5 = `grantPaths`；6 条幽灵带；使用流带 0；图例含「虚线轮廓 = 闲置授权（示意宽度，封顶，不与实心带同尺度）」。图：[demo-access-map](evidence/2026-11-17-demo-access-map.png)。点聚合节点弹出清单：`demo-mysql · 闲置授权 3 条`，列出 `superstore_orders／people／returns` 各 1 条。图：[demo-idle-list](evidence/2026-11-17-demo-idle-list.png) |
| UAT-SANKEY-04（对应全未确认） | **PASS** | `unconfirmedCalls=6`；`trust=include_candidate` → **400**（`INVALID_ACCESS_MAP_PARAMETER`）；页面说明「窗口内另有 6 次调用因问询关联未确认，未计入本图（口径：已确认关联）…」，带「对照访问日志」链接（`/admin/audit`），无「可调整筛选后再看」 |
| UAT-SANKEY-01／03／05 | **NOT RUN（demo）** | 需要 20＋条访问路径、宽授权、42 个 Agent；demo 数据构造不出。沙箱结果见 [restoration-run](2026-11-17-cursor-sankey-restoration-run.md)。是否往 demo 数据卷里写种子，须委托人另行授权 |
| UAT-SANKEY-06 | **PASS（沿用基线）** | 本轮未重跑 |
| UAT-SANKEY-07 | **BLOCKED** | 线上仍是 `lucyVersion=0.25.0`、`gitSha=6d2664b3…`（本轮只读取 `/api/health`，未登录线上） |

## 观察（不影响判定）

- 1920×1080 下，图例说明与「点一个名字…」提示之间有一大片空白，图本体偏下。本条改动未改页面外框，需要时另行评估。
- 点击聚合节点会同时出现悬停提示和清单浮层，清单浮层在画布右上角，离被点节点较远。

## 其他套件

- 全量 `npx vitest run`：6476 条里 314 条失败，37 个文件。把这 37 个文件放到干净 HEAD 的临时 worktree 上重跑，结果完全相同（37 个文件、314 条失败），所以**不是工作树里任何未提交改动引入的**，也与访问关系图无关。失败样例：`inferred-turn-maintainer.ts:75` 读 `mark.id` 时 `mark` 为 undefined（测试替身里的库不返回该行），导致启动期失败。已报告，不修。
- 其余在途任务的 UAT 套件（复制按钮、按钮反馈、问询预算等）本轮未跑：它们属于别的进程，且部分探针会真实签发并吊销 Token，需要对应负责人确认。

## 备注

- 是否使用 `docker restart`：**否**。本轮只读，未写 demo 数据，未签发 Token。
- 清理：Playwright 浏览器已关闭；临时 worktree 已删除；`inbox/sankey-demo-probe.mjs` 为临时文件，可随时删除。
