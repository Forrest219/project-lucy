# Fixtures — UAT-SUITE-EVENT-LOOP-RELIEF

| 键 | 值 | 备注 |
|---|---|---|
| 本机 WebUI | `http://127.0.0.1:55176` | `LUCY_DEMO_WEBUI_HOST_PORT` 可覆盖 |
| 本机 MCP | `http://127.0.0.1:57881` | 本套件不依赖 MCP 问答 |
| livez | `GET /api/livez` | 期望 `{ok:true}` |
| readyz | `GET /api/readyz` | 预热后 200 |
| health | `GET /api/health` | 诊断；含 `eventLoop` |
| 系统概览 | `/overview` | 红字原文：「页面数据暂时无法完成刷新」 |
| 访问日志 API | `GET /api/admin/audit/turns?hours=168` | 7 天窗。生产高峰禁止打 |
| 概览相关 API | `/api/project`、`/api/sources`、`/api/admin/agents`、`/api/diff` | 响应体不得含 `DISPLAY_SNAPSHOT_BUSY` |
| Compose | `deploy/compose/docker-compose.demo.yml` | |
| 规模脚本 | `npm --prefix webui run perf:event-loop-relief` | 合成夹具，不连客户库 |
| 规模证据 | `inbox/event-loop-relief-perf.json` | 跑次只抄路径和四个数字 |
| 夹具形状 | 30 天、115,000 条、67 用户、183 表 | 见 `webui/tests/performance/fixtures/audit-scale-fixture.ts` |
| 门槛 | turns p95 ≤ 3000ms；livez max ≤ 1000ms；livez p99 ≤ 400ms；BUSY＝0 | 2026-11-13 委托人把 p99 从 300ms 调整为 400ms |
| 2026-11-13 基线 | p95 105ms；p99 359ms；max 487ms；BUSY＝0 | 变慢但未越门槛时在跑次里单列 |
| 客户 WebUI（仅 LOOP-05） | `http://10.69.95.109:8276` | 维护窗；高峰不打 7 天访问日志 |
| 客户凭据文件 | `/Users/zhangxingchen/Projects/config_for_agents/ksc-lucy-webui.txt` | 只写路径 |

## 禁止

- 把密码、token 写入本目录、跑次或聊天回复。
- 用读代码或功能合同收口代替本套件 PASS。
- 在业务高峰对客户实例请求 `hours=168`。
- 对没有 `/api/livez` 的 0.25 镜像套用 Chart `0.2.9` 的存活探针。
