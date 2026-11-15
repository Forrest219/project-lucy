# Cases — UAT-SUITE-PAGE-SWEEP

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 脚本 | `docker ps`（`compose-lucy-1` healthy）、`npx playwright --version` | demo 容器在跑可 `docker cp`；宿主有 Chromium。记下容器 `gitSha` 与本仓库 `HEAD` |
| UAT-SWEEP-01 | 全部页面加载不越线 | 浏览器 | `npm --prefix webui run sweep:event-loop` 的 Layer 2 | 每个页面：加载期间 livez p99 ≤ 400ms 且 max ≤ 1000ms；无红字「暂时无法完成刷新」；无 5xx。未测页面必须写明夹具原因 |
| UAT-SWEEP-02 | 全部 GET 路由并发压测不越线 | API | 同上的 Layer 1 | 每条路由顺序 5 次均 200 且最大 ≤ 3000ms；顺序最大 ≥ 40ms 的再并发压 5 秒，livez p99 ≤ 400ms 且 max ≤ 1000ms；单次 > 5 秒的重路由记 OVER。**已登记越线仍算越线** |
| UAT-SWEEP-03 | 门禁零回归 | 脚本 | `npm --prefix webui run sweep:event-loop:gate` | 退出码 0：没有新增越线、没有新增未测路由／页面；基线里已通过的条目会提示「可删」，基线只减不增 |
| UAT-SWEEP-04 | 严格口径（可选） | 脚本 | `SWEEP_STRICT=1 npm --prefix webui run sweep:event-loop:gate` | 已登记越线清零后退出码 0；整改条目全部关闭前预期非 0，记 FAIL 或 SKIPPED（写明未关闭的条目） |

---

## UAT-R0 — 环境门禁

### 步骤

1. `docker ps`，确认 `compose-lucy-1`（或 `SWEEP_CONTAINER` 指定的容器）`healthy`。
2. `npx playwright --version`；缺 Chromium 时 `npx playwright install chromium`。
3. 记录容器 `GET /api/health` 的 `gitSha`，以及本仓库 `git rev-parse HEAD`。

### 期望

- 容器可达；两个 sha 写进跑次。不一致只记录，不阻断（脚本测的是本仓库源码，容器只提供项目内容副本）。

### 清理

无。

---

## UAT-SWEEP-01 / 02 — 页面与路由

### 前置

UAT-R0 通过。脚本自行完成：`docker cp` 容器内 `/data/lucy` 到临时目录、`vite build`、造 30 天 115,000 条调用的审计夹具、给 `ledger_seq` 配上合成账本、再灌 30 万条页面访问记录。服务以独立子进程起，驱动进程与服务进程分离，因此轮询 `/api/livez` 量到的是客户端真实看到的延迟。

### 步骤

1. `npm --prefix webui run sweep:event-loop`（耗时约 8–15 分钟）。
2. 读 `inbox/page-event-loop-sweep.json`：`routes[].verdict`、`pages[].verdict`。
3. 对每个 OVER／FAIL 条目，核对 `docs/governance/e2e-ledger.md` 是否已登记整改条目；没有则按总账规则先入池。

### 期望

- 01：全部页面 `OK` 或带夹具原因的「未测」。
- 02：全部路由 `OK` 或带原因的「未测」；出现 `OVER`／`FAIL` 即本条 FAIL，并列出路由与对应整改条目。

### 清理

脚本默认删除临时目录（含 demo 项目副本里的 secrets）；`SWEEP_KEEP=1` 时跑完自行删除 `/tmp/lucy-sweep`。

---

## UAT-SWEEP-03 — 门禁

### 步骤

1. `npm --prefix webui run sweep:event-loop:gate`。
2. 看末尾 `Gate` 段：`regressions`、`tracked`、`shrink-me`。
3. 红绿自检（不重跑 10 分钟的测量）：`SWEEP_REPLAY=inbox/page-event-loop-sweep.json SWEEP_GATE=1 npx tsx webui/scripts/page-event-loop-sweep.mts` 对已有报告判定；配 `SWEEP_BASELINE=<临时基线>` 删掉一条登记或一条未测，应退出码 1。

### 期望

- `regressions=0`，退出码 0。
- `shrink-me` 非空时，同一个提交里把对应登记从基线文件里删掉。

### 清理

同上。
