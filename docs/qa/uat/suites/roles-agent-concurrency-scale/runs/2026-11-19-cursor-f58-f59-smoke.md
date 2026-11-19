# Run — 2026-11-19 — cursor-f58-f59-smoke

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE` |
| 选择器 | **F58-smoke**／**F59-smoke**（非完整 F58／F59／R） |
| Agent | Cursor |
| 环境 | 本机 demo `http://127.0.0.1:55176`；MCP Proxy `http://127.0.0.1:57881`；容器 `compose-lucy-1`／`compose-demo-db-1` healthy |
| 候选 | `lucyVersion=0.30.0`；健康响应 `gitSha=6208ea57…`、`gitDirty=true`；镜像 digest `sha256:9b670785…`；本机 HEAD 另有提交 `af13b9d5`（P1-58／59），镜像为重建时脏树，已含 `access-write-status`／`access-object-version`／roster／statistics |
| 开始／结束 | 2026-11-19 ≈16:37–16:38 UTC |
| 入口 | `node scripts/uat/roles-agent-f58-f59-smoke.mjs`（凭据仓库外 `config_for_agents/lucy-docker-demo-webui.txt`） |
| 原始 JSON | `inbox/uat-racs-smoke/smoke-2026-11-19T16-38-26-790Z.json`；重建后复跑 `smoke-2026-11-19T16-39-35-159Z.json`（同 verdict） |
| 总判定 | **SMOKE_PASS（有 GAP）** — 不等于完整 F58／F59／R PASS；≠ 功能收口；≠ 可上线 |

## 结果表

| Case / 步骤 | 结果 | 摘要 |
|---|---|---|
| R0 health／login | **PASS** | `/api/health` 200；管理员登录 200 |
| F58 roles list | **PASS** | `GET /api/admin/roles` 200／8ms；`cache;desc=hit`；9 roles |
| F58 agents full | **PASS** | `GET /api/admin/agents?range=7d` 200／7ms；2 agents 含统计 |
| F58 roster | **PASS** | `?view=roster` 200；无 window stats 字段 |
| F58 statistics | **PASS** | `/statistics?range=7d` 200；`meta.statisticsAsOf` 有值；首次 `cache=miss` |
| F58 statistics reuse／refresh | **PASS** | 二次 `cache=hit`；`refresh=true` → `bypass` |
| F58 roles ×25 | **PASS** | 全 200；p95≈61ms（demo 小库，非 fixtures 5×） |
| F59 detail baseObjectVersion | **PASS** | Role GET 返回 `baseObjectVersion` |
| F59 dryRun／save／status | **PASS** | dryRun 发 `previewToken`；带 `operationId` 保存 200；`access-write-status` → `committed`；描述已还原 |

## 明确未覆盖（GAP）

- fixtures B／2×／5× 造数与开放式到达率（UAT-RACS-01–06 等）
- 审计窗口外历史 5×、真库 EXPLAIN 对比（SC-01 全量）
- 浏览器 E1–E18／E1–E28
- 14-B／C 反向代理断连、R 组合、慢盘、长稳态、RACS-17 现网校准
- 同对象冲突 100 对、DEP-01–11 全矩阵 HTTP

## 备注

- 未对生产域名施压；未 `down -v`
- 登录凭据未写入本跑次正文
- 下一步：隔离 fixture 造数 + 完整 F58／F59 runner；建议镜像以干净 `af13b9d5`（或更新 HEAD）再重建后复跑
