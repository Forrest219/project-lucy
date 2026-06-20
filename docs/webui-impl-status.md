# WebUI 功能实现状态

| 元数据 | 内容 |
|---|---|
| 文档名称 | WebUI 功能实现状态 |
| 文档类型 | Other |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-20 |
| 撰写人 | Claude Architect |

---

> 本表随开发进度更新。状态变更时同步更新「代码位置」列。

| 一级模块 | 二级入口 | 状态 | 前端文件 | 后端 API |
|---|---|---|---|---|
| **数据库接入** | 连接概览 | ⬜ 待开发 | `src/pages/connections/ConnectionOverview.tsx` | `GET /api/connections` |
| | 表白名单 | ⬜ 待开发 | `src/pages/connections/TableWhitelist.tsx` | `GET /api/connections/:id/tables` · `PUT /api/connections/:id/enabled-tables` · `POST /api/connections/:id/ingest` |
| | 连通测试 | ⬜ 待开发 | `src/pages/connections/ConnectionTest.tsx` | `POST /api/connections/:id/test` |
| **语义层维护** | 表目录 | ✅ 已实现 | `src/pages/Catalog.tsx` | `GET /api/sources` |
| | 表语义编辑 | ✅ 已实现 | `src/pages/TableEditor.tsx` | `GET /api/sources/:conn/:schema/:table` · `PUT /api/sources/:conn/:schema/:table` |
| | 关联关系管理 | ✅ 已实现 | `src/pages/JoinEditor.tsx` | `GET /api/joins/:conn/:schema/:table` · `PUT /api/joins/:conn/:schema/:table` |
| **业务文档** | Wiki 文档 | ✅ 已实现 | `src/pages/WikiEditor.tsx` | `GET /api/wiki` · `PUT /api/wiki` |
| **审阅与校验** | 变更审阅 | ✅ 已实现 | `src/pages/Review.tsx` | `GET /api/changed` · `POST /api/validate-changed` |
| **质量评测** | Case 管理 | ✅ 已实现 | `src/pages/eval/CaseList.tsx` · `CaseEditor.tsx` | — |
| | 运行历史 | ✅ 已实现 | `src/pages/eval/RunList.tsx` · `RunDetail.tsx` | — |
| | 趋势监控 | ✅ 已实现 | `src/pages/eval/Monitor.tsx` | — |
| **访问治理** | Agent 实例 | ✅ 已实现 | `src/pages/admin/AgentList.tsx` · `AgentDetail.tsx` · `NewToken.tsx` | — |
| | 访问日志 | ✅ 已实现 | `src/pages/admin/Audit.tsx` | — |

---

## 状态说明

| 标记 | 含义 |
|---|---|
| ✅ 已实现 | 前后端均可用，通过测试 |
| 🔧 开发中 | 已有 PR 或分支在进行 |
| ⬜ 待开发 | 有设计文档，未开始编码 |
| ❌ 缺失 | 产品承诺但无任何实现，无明确计划 |

## 相关文档

- 产品功能说明：[`docs/webui-module-guide.md`](webui-module-guide.md)
- 数据库接入技术规格：[`docs/design-db-connection.md`](design-db-connection.md)
- 功能地图（含缺口分析）：[`docs/webui-feature-map.md`](webui-feature-map.md)
