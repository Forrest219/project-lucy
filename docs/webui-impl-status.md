# WebUI 功能实现状态

| 元数据 | 内容 |
|---|---|
| 文档名称 | WebUI 功能实现状态 |
| 文档类型 | Other |
| 版本 | v1.1 |
| 撰写日期 | 2026-06-20；v1.1 更新 2026-06-21 |
| 撰写人 | Claude Architect / Codex |

---

> 本表随开发进度更新。状态变更时同步更新「前端文件」「后端 API」「测试覆盖」「最后核对」列。

| 一级模块 | 二级入口 | 状态 | 前端文件 | 后端 API | 测试覆盖 | 最后核对 |
|---|---|---|---|---|---|---|
| **数据库接入** | 连接概览 | ✅ 已实现 | `src/pages/connections/ConnectionOverview.tsx` | `GET /api/connections` | `src/__tests__/connection-overview.test.tsx` | 2026-06-21 |
| | 表白名单 | ✅ 已实现 | `src/pages/connections/TableWhitelist.tsx` | `GET /api/connections/:connId/tables` · `PUT /api/connections/:connId/enabled-tables` · `POST /api/connections/:connId/ingest` | `src/__tests__/connection-overview.test.tsx`（导航/入口覆盖） | 2026-06-21 |
| | 连通测试 | ✅ 已实现 | `src/pages/connections/ConnectionTest.tsx` | `POST /api/connections/:connId/test` | `src/__tests__/connection-overview.test.tsx`（导航/入口覆盖） | 2026-06-21 |
| **语义层维护** | 表目录 | ✅ 已实现 | `src/pages/Catalog.tsx` | `GET /api/sources` | `src/__tests__/app-shell.test.tsx` · server semantic-layer tests | 2026-06-21 |
| | 表语义编辑 | ✅ 已实现 | `src/pages/TableEditor.tsx` | `GET /api/sources/:conn/:schema/:table` · `PUT /api/sources/:conn/:schema/:table` · `POST /api/sources/:conn/:schema/:table/validate` | `src/__tests__/table-editor.test.tsx` · `server/__tests__/semantic-layer.*.test.ts` · `server/__tests__/api.save.test.ts` | 2026-06-21 |
| | 关联关系管理 | ✅ 已实现 | `src/pages/JoinEditor.tsx` | `GET /api/joins/candidates` · `PUT /api/joins/candidates` | `server/__tests__/joins-sidecar.test.ts` | 2026-06-21 |
| **业务文档** | Wiki 文档 | ✅ 已实现 | `src/pages/WikiEditor.tsx` | `GET /api/wiki` · `GET /api/wiki/:key` · `PUT /api/wiki/:key` | `server/__tests__/wiki.test.ts` | 2026-06-21 |
| **审阅与校验** | 变更审阅 | ✅ 已实现 | `src/pages/Review.tsx` | `GET /api/diff` · `POST /api/validate-changed` | `src/__tests__/review.test.tsx` | 2026-06-21 |
| **质量评测** | Case 管理 | ✅ 已实现 | `src/pages/eval/CaseList.tsx` · `CaseEditor.tsx` | `GET /api/eval/domains` · `GET /api/eval/domains/:domain` · `GET/POST/PUT/DELETE /api/eval/cases/:domain[/:caseId]` | `server/__tests__/eval-cases.test.ts` · `server/__tests__/eval-api-contract.test.ts` | 2026-06-21 |
| | 运行历史 | ✅ 已实现 | `src/pages/eval/RunList.tsx` · `RunDetail.tsx` | `POST /api/eval/runs` · `GET /api/eval/runs` · `GET /api/eval/runs/:runId` · `GET /api/eval/runs/:runId/results` · `GET /api/eval/runs/:runId/stream` · `POST /api/eval/runs/:runId/cancel` | `server/__tests__/eval-runs.test.ts` · `server/__tests__/eval-runner-contract.test.ts` | 2026-06-21 |
| | 趋势监控 | ✅ 已实现 | `src/pages/eval/Monitor.tsx` | `GET /api/eval/monitor/trend` · `GET /api/eval/monitor/top-failures` · `GET /api/eval/monitor/drift-distribution` · `GET/PUT /api/eval/monitor/config` · `GET/PUT /api/eval/monitor/threshold` | `src/__tests__/monitor.test.tsx` | 2026-06-21 |
| **访问治理** | Agent 实例 | 🔧 需安全整改 | `src/pages/admin/AgentList.tsx` · `AgentDetail.tsx` · `NewToken.tsx` | `GET/POST /api/admin/agents` · `GET/PATCH/DELETE /api/admin/agents/:userId` · `POST/DELETE /api/admin/agents/:userId/tokens...` · `GET /api/admin/mcp-tools` | `server/__tests__/admin-agents.test.ts` · `server/__tests__/admin-tokens.test.ts` · `src/__tests__/agent-detail.test.tsx` · `src/__tests__/new-token.test.tsx` | 2026-06-21 |
| | 访问日志 | ✅ 已实现 | `src/pages/admin/Audit.tsx` | `GET /api/admin/audit` · `GET /api/admin/audit/export` | `server/__tests__/proxy-audit.test.ts` · `src/__tests__/audit.test.tsx` | 2026-06-21 |
| **MCP Proxy** | 访问代理 | ✅ 已实现；role admin UI 待对齐 | — | `POST /mcp`（7879 proxy）· `kx_catalog` proxy tool | `server/__tests__/mcp-proxy-*.test.ts` · `server/__tests__/kx-acl.test.ts` | 2026-06-21 |

---

## 状态说明

| 标记 | 含义 |
|---|---|
| ✅ 已实现 | 前后端均可用，通过测试 |
| 🔧 开发中 | 已有 PR 或分支在进行 |
| 🔧 需安全整改 | 功能已实现，但存在审计报告确认的安全/契约缺口，不应继续扩展能力 |
| ⬜ 待开发 | 有设计文档，未开始编码 |
| ❌ 缺失 | 产品承诺但无任何实现，无明确计划 |

## 相关文档

- 产品功能说明：[`docs/webui-module-guide.md`](webui-module-guide.md)
- 数据库接入技术规格：[`docs/design-db-connection.md`](design-db-connection.md)
- 功能地图（含缺口分析）：[`docs/webui-feature-map.md`](webui-feature-map.md)
