# Cases — UAT-SUITE-EVENT-LOOP-RELIEF

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 脚本 | `/api/health`、`/api/livez`、`/api/readyz` | 目标进程可回答；记下版本。无 `/api/livez` 则后续规模项 BLOCKED |
| UAT-LOOP-01 | 客户规模夹具下访问日志与存活探针 | 脚本 | `npm --prefix webui run perf:event-loop-relief` | turns p95 ≤ 3s；livez max ≤ 1s；livez p99 ≤ 400ms；BUSY＝0 |
| UAT-LOOP-02 | demo 上同时打开 7 天访问日志和系统概览 | 浏览器＋API | WebUI `/overview`、访问日志 7 天 | 不出现「页面数据暂时无法完成刷新」；同期 livez 单次 ≤ 1s |
| UAT-LOOP-03 | 探针拆分仍在 | API | `/api/livez`、`/api/readyz`、`/api/health` | livez 连续 30 次都是 `{ok:true}`；readyz 预热后 200；health 20 次都不挂起 |
| UAT-LOOP-04 | 负载期间不被存活探针杀掉 | 运行时 | 容器或 Pod 重启次数 | 用例窗口内重启次数增量＝0 |
| UAT-LOOP-05 | 已升级实例的维护窗复测 | 可选，维护窗 | 同 LOOP-01 的门槛，打在含 `/api/livez` 的实例上 | 门槛同 LOOP-01；0.25 无该路由时 BLOCKED |

事故对照：2026-11-13 客户实例上，`/turns?hours=168` 超过 90 秒未返回，同期 `/api/health` 连续超时，Pod 退出码 143 被 liveness 杀掉，系统概览报「页面数据暂时无法完成刷新」。`/api/diff` 约 27 秒。

---

## UAT-R0 — 环境门禁

### 前置

选定本次目标：本机 demo，或已经带 `/api/livez` 的预发／客户实例。凭据只读 fixtures 里的文件路径。

### 步骤

1. 记录目标基址、产品版本、`gitSha`（来自 `GET /api/health`）。
2. `GET /api/livez`、`GET /api/readyz`、`GET /api/health`。
3. 若目标是容器或 Pod，记下当前重启次数。

### 期望

- `/api/health` 返回 `ok: true`。
- 含本修复的构建：`/api/livez` 为 200 且 `{ok:true}`；进程起来后 `/api/readyz` 为 200。
- 没有 `/api/livez` 的 0.25 镜像：本条记 BLOCKED，不要把 Chart `0.2.9` 的存活探针指到它上面。

### 清理

无。

---

## UAT-LOOP-01 — 客户规模夹具

### 前置

UAT-R0 的代码树就是要发布的那一版。本条使用仓库内合成夹具（30 天、约 115,000 条调用、67 个用户、183 张表），不连接客户库。

### 步骤

1. 在仓库根执行 `npm --prefix webui run perf:event-loop-relief`。
2. 读取 `inbox/event-loop-relief-perf.json`。
3. 把 JSON 路径、`turnsP95Ms`、`livezMaxMs`、`livezP99Ms`、`displaySnapshotBusy` 写入当次 `runs/`。

### 期望

- `sc13.pass` 为真，且 `turnsP95Ms` ≤ 3000。
- `sc14.pass` 为真，且 `livezMaxMs` ≤ 1000，`livezP99Ms` ≤ 400，`displaySnapshotBusy` ＝ 0。
- 任一数字越门槛即 FAIL。2026-11-13 基线是 p95 105ms、p99 359ms、max 487ms；仍在门槛内但比基线翻倍时，跑次里单列「变慢」，不单独改成 FAIL。

### 清理

无。`inbox/event-loop-relief-perf.json` 可留作证据。

---

## UAT-LOOP-02 — demo 上的 7 天访问日志与系统概览

### 前置

UAT-R0 针对本机 demo PASS。demo 数据量小于客户规模，本条不代替 UAT-LOOP-01。

### 步骤

1. 管理员登录 WebUI。
2. 打开系统概览 `/overview`。
3. 打开访问日志，时间窗选 7 天（对应 `GET /api/admin/audit/turns?hours=168`）。
4. 这两页加载期间，另起 30 次 `GET /api/livez`，记下每次耗时。
5. 看系统概览「系统状态」和「待处理事项」。

### 期望

- 页面不出现「页面数据暂时无法完成刷新」。
- `/api/sources`、`/api/admin/agents`、`/api/project` 的响应体不含 `DISPLAY_SNAPSHOT_BUSY`。
- 30 次 `/api/livez` 全部 200，单次 ≤ 1000ms。
- 访问日志请求在 30 秒内返回；若超过 30 秒仍无响应，记 FAIL。

### 清理

无。

---

## UAT-LOOP-03 — 探针拆分

### 前置

UAT-R0 确认目标有 `/api/livez`。

### 步骤

1. 连续 30 次 `GET /api/livez`。
2. 进程已就绪后 `GET /api/readyz`。
3. 连续 20 次 `GET /api/health`。

### 期望

- 30 次 livez 都是 200、`{ok:true}`，单次 ≤ 1000ms。
- readyz 为 200。若目标仍在启动宽限内返回 503 且 `reason` 为 `warming_up`，等它就绪后重试一次，第二次仍非 200 则 FAIL。
- 20 次 health 都在 15 秒内返回，且带 `eventLoop`。

### 清理

无。

---

## UAT-LOOP-04 — 负载期间不被杀掉

### 前置

与 UAT-LOOP-02 或 UAT-LOOP-05 同一次窗口。开始前记下重启次数。

### 步骤

1. 记录 demo 容器 `RestartCount`，或目标 Pod 的重启次数。
2. 跑完 UAT-LOOP-02 或 UAT-LOOP-05 的负载。
3. 再读一次重启次数，并看该窗口内有没有退出码 143。

### 期望

- 重启次数增量＝0。
- 窗口内没有因为 liveness 失败而杀进程。

### 清理

无。

---

## UAT-LOOP-05 — 已升级实例的维护窗复测

### 前置

目标镜像已经提供 `/api/livez`。选维护窗。凭据只使用 fixtures 中的文件路径。不要在业务高峰执行。

### 步骤

1. 跑 UAT-R0 与 UAT-LOOP-03。
2. 对**非生产副本**或维护窗中的实例执行与 UAT-LOOP-01 相同的门槛：若不能安全地导入 115,000 条合成数据，则只抽样 livez、系统概览和重启次数，并把「未跑 7 天访问日志」写进跑次。未授权时，不要对生产实例发 `hours=168`。
3. 跑 UAT-LOOP-04。
4. 若目标仍是没有 `/api/livez` 的 0.25，整条记 BLOCKED。

### 期望

- 有规模负载时，门槛与 UAT-LOOP-01 相同。
- 只做抽样时，livez 单次 ≤ 1000ms，概览无「页面数据暂时无法完成刷新」，重启增量＝0。抽样通过记 PASS WITH GAP，并写明没有跑 7 天访问日志。
- 0.25 无路由：BLOCKED，不是 FAIL。

### 清理

不改客户数据。不把凭据内容写入跑次。
