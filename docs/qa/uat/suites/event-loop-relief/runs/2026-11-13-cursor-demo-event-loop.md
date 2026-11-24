# Run — 2026-11-13 — cursor-demo-event-loop

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-EVENT-LOOP-RELIEF` |
| Agent | Cursor |
| 环境 | 本机 demo `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881`；容器 `compose-lucy-1` healthy；`lucyVersion=0.30.0`；`gitSha=82809ae5972e96fe99bc0e974f501abf0d3dde77`；`gitDirty=true`（P1-21 工作树已打进镜像）；平滑升级后 `RestartCount` 基线 0 |
| 开始／结束 | 2026-11-13 ≈23:50–23:55 CST |
| 总判定 | **PASS**（必做 R0／01–04 全绿；可选 LOOP-05 **BLOCKED**——客户仍为无 `/api/livez` 的 0.25） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | 升级后 `/api/health` ok；`/api/livez`→200 `{ok:true}`；`/api/readyz`→200；账户 `verify-admin`（浏览器既有会话） |
| UAT-LOOP-01 | **PASS** | `npm --prefix webui run perf:event-loop-relief` 退出 0。证据 `inbox/event-loop-relief-perf.json`（`measuredAt=2026-11-13T15:52:47.408Z`）：`turnsP95Ms=109`；`livezMaxMs=599`；`livezP99Ms=325`；`displaySnapshotBusy=0`；`sc13.pass`／`sc14.pass` 均为真。相对 2026-11-13 基线（105／359／487）未翻倍，不标「变慢」 |
| UAT-LOOP-02 | **PASS** | 浏览器打开 `/overview` 与 `/admin/audit?range=7d`（「近 7 天」已按下，列表可见问询行）。无「页面数据暂时无法完成刷新」。同源已登录 `fetch`：`/api/admin/audit/turns?hours=168` **7ms**／200；`/api/sources`／`/api/admin/agents`／`/api/project` 均无 `DISPLAY_SNAPSHOT_BUSY`；同期 livez×30 max≈1ms 全 200 |
| UAT-LOOP-03 | **PASS** | livez×30 全 `{ok:true}`、max≈36ms；readyz 200；health×20 均 ≤15s 且含 `eventLoop` |
| UAT-LOOP-04 | **PASS** | 负载窗口前后 `RestartCount` 均为 **0**（增量＝0）；容器 `running`／`ExitCode=0`，无 liveness 杀进程迹象 |
| UAT-LOOP-05 | **BLOCKED** | 客户 `http://10.69.95.109:8276` 仍为 0.25、无 `/api/livez`。本波未在维护窗打生产。按套件记 BLOCKED，不是 FAIL |

## 备注

- 是否使用 `docker restart`：**否**（升级用平滑 `demo:upgrade`，volume 保留）
- 清理：未改 ACL／Agent；未写凭据内容
- demo 小审计库不代替 LOOP-01 规模门槛（规模只认合成夹具脚本）
- **≠ 可上线**；**≠** 功能合同收口的重复取证
