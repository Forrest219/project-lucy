# Lucy WebUI 功能地图

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI 功能地图 |
| 文档类型 | Design / Current Capability Map |
| 版本 | v1.3 |
| 撰写日期 | 2026-06-19；v1.1 更新 2026-06-29；v1.2 更新 2026-07-24（新增 M6 「添加 schema」行）；v1.3 更新 2026-07-26（新增部署/连接体验升级设计） |
| 撰写人 | Claude Thinker / Codex |
| 适用范围 | WebUI 当前能力索引、交付前 reviewer 核对 |
| 当前状态源 | `docs/webui-impl-status.md`, `docs/project-overview.md`, `docs/lucy-platform-goal-checklist.md` |

---

> **更新说明（2026-06-29）**：v1.0 是 2026-06-19 的缺口分析快照，当时 Admin、Eval、Audit 等模块尚未落地。v1.1 已按当前实现刷新，避免后续 agent 误把历史缺口当成当前缺口。模块级文件/API/测试清单仍以 `docs/webui-impl-status.md` 为准。

## 1. 数据工程师视角

数据工程师维护 KTX semantic layer、Wiki、连接白名单与 eval case。WebUI 是本机治理工作台。

| 功能 | 当前状态 | 用户价值 | 主要落点 |
|---|---|---|---|
| 浏览语义层表目录、按 schema/状态/关键字筛选 | 已实现 | 在大量表中快速定位待维护对象 | `src/pages/Catalog.tsx`, `GET /api/sources` |
| 查看表完成度与校验状态 | 已实现 | 明确治理队列与风险表 | `server/completion.ts`, `StatusBadge` |
| 编辑表描述、字段描述、grain | 已实现 | 固化业务语义，减少 Agent 误读 | `src/pages/TableEditor.tsx`, overlay YAML |
| 编辑 measures / segments | 已实现 | 固化核心指标和常用过滤口径 | `MeasureForm.tsx`, `SegmentForm.tsx` |
| 维护 joins：候选 / 拒绝 / 已确认 | 已实现 | 控制可信关联路径 | `src/pages/JoinEditor.tsx`, `.ktx-ui/join-candidates.json` |
| 保存前 diff、保存后 validate | 已实现 | 降低 YAML 写入和口径变更风险 | `DiffViewer.tsx`, `POST /api/sources/:conn/:schema/:table/validate` |
| 批量审阅本次变更 | 已实现 | 收尾时统一检查 diff 与 validate 结果 | `src/pages/Review.tsx`, `GET /api/diff`, `POST /api/validate-changed` |
| Wiki frontmatter + Markdown 编辑 | 已实现 | 维护长文本业务背景和口径文档 | `src/pages/WikiEditor.tsx`, `GET/PUT /api/wiki` |
| 从表编辑器创建关联 Wiki | 已实现 | 语义层维护时顺手补业务上下文 | `WikiEditor` `sl_ref` query |
| 字段 role / visibility / tags 产品化编辑 | 后续范围 | 更细粒度字段治理 | 当前 KTX schema/落盘策略未纳入 v1 目标 |
| Wiki 全文/tag/sl_ref 搜索体验 | 后续增强 | 大量 wiki 时提高定位效率 | 可在 Wiki 模块后续补强 |
| Skill 创建、编辑、版本化 | 后续范围 | 管理分析路径和复用经验 | 当前以 `skills/` 文件资产为主，未进入 WebUI 模块 |

## 2. 管理员视角

管理员控制 Agent、Token、ACL、MCP tool surface 与审计查询。

| 功能 | 当前状态 | 用户价值 | 主要落点 |
|---|---|---|---|
| Agent 列表与详情 | 已实现 | 管理每个 Agent/user 的启用状态和权限 | `/admin/agents`, `GET /api/admin/agents` |
| 创建 / 编辑 / 删除 Agent | 已实现 | 给新使用者分配 role-first 访问模型 | `POST/PATCH/DELETE /api/admin/agents` |
| Role 模板与有效权限展开 | 已实现 | 预览 Agent 最终 tools/connections/sources 权限 | `GET /api/admin/roles`, `GET /api/admin/agents/:userId/effective-permissions` |
| Token 签发与撤销 | 已实现 | 一次性展示明文 token，配置只保存 hash | `POST/DELETE /api/admin/agents/:userId/tokens...` |
| MCP tools 列表与 deny 状态 | 已实现 | 看清代理暴露和隐藏的工具面 | `GET /api/admin/mcp-tools` |
| MCP access log 查询与导出 | 已实现 | 追踪谁调用了什么工具、结果如何 | `/admin/audit`, `GET /api/admin/audit`, `GET /api/admin/audit/export` |
| 访问来源聚合与单条来源明细 | 已实现 | 追踪 MCP 调用触达的数据表 | `GET /api/admin/audit/sources`, `GET /api/admin/audit/:id/sources` |
| 问答轮次视图与详情 | 已实现 | 把多次 tool call 聚合成问题级审计视图 | `GET /api/admin/audit/turns`, `GET /api/admin/audit/turns/:turnId` |
| conversation turn retention 手动清理 | 已实现 | 支持本地审计预览保留策略 | `POST /api/admin/audit/conversation-turns/purge` |
| 配置变更审计与 CSV 导出 | 已实现 | 追踪 WebUI 对治理配置的写入 | `GET /api/admin/config-audit`, `GET /api/admin/config-audit/export.csv` |
| 列级 / 行级权限 | 非 v1 目标 | 长期治理能力 | 当前通过表级 ACL 与 VIEW-as-pseudo-table 方案兜底 |
| 告警、对象存储归档、容量统计 | 后续范围 | 运营和合规增强 | 不属于当前 release gate |

## 3. Eval / 质量评测视角

Eval 管理已经从 CLI-only 发展为 WebUI 模块，但完整 LLM/agent eval 仍依赖外部 agent/model 环境。

| 功能 | 当前状态 | 用户价值 | 主要落点 |
|---|---|---|---|
| Eval domain 与 case 列表 | 已实现 | 不用 grep YAML 即可浏览 case | `/eval/cases`, `GET /api/eval/domains`, `GET /api/eval/cases/:domain` |
| 新增、编辑、删除 eval case | 已实现 | 通过 WebUI 维护回归覆盖 | `POST/PUT/DELETE /api/eval/cases/:domain[/:caseId]` |
| 创建 eval run | 已实现 | 选定 case 后触发回归运行 | `POST /api/eval/runs` |
| Run 列表、详情、结果、artifact | 已实现 | 查看通过率、失败明细和产物 | `/eval/runs`, `GET /api/eval/runs...` |
| Run cancel 与 SSE stream | 已实现 | 管理长时间运行的 eval | `POST /api/eval/runs/:runId/cancel`, `GET /api/eval/runs/:runId/stream` |
| 运行对比 | 已实现 | 对比两个 run 的质量变化 | `GET /api/eval/runs/:runId/compare` |
| 趋势、失败排行、漂移分布 | 已实现 | 观察质量变化和高频失败 | `/eval/monitor`, `GET /api/eval/monitor/*` |
| 阈值与监控配置 | 已实现 | 管理质量监控参数 | `GET/PUT /api/eval/monitor/config`, `GET/PUT /api/eval/monitor/threshold` |
| Quiz 管理（人类测验 HTML） | 后续范围 | WebUI 编辑 quiz 而不是直接改 HTML | 当前 quiz 仍在 `evals/<domain>/*-quiz-cases.html` |

## 4. 数据源 / Onboarding / MCP Proxy

| 功能 | 当前状态 | 用户价值 | 主要落点 |
|---|---|---|---|
| 部署向导与上线检查 | 已实现 | 帮客户完成 Docker / MCP / Agent 配置主链路 | `/onboarding`, `src/pages/Onboarding.tsx` |
| MCP config 复制入口 | 已实现 | 降低 Agent 接入配置错误 | `/onboarding` |
| 连接概览 | 已实现 | 查看当前项目连接和安全剥离后的配置 | `/connections`, `GET /api/connections` |
| 给已有连接添加 schema | ✅ M6 已实现 | 在 webui 内给连接加 schema(database)，不接管新建连接 | `POST /api/connections/:connId/schemas`，详见 [`docs/design-schema-onboarding.md`](design-schema-onboarding.md) |
| 新建连接 | Spec 124 已实现 | 在 WebUI 创建 `ktx.yaml` 连接配置与约定密码文件 | `POST /api/connections`，详见 [`webui/docs/124-connection-create-admin-spec.md`](../webui/docs/124-connection-create-admin-spec.md) |
| 删除连接 | Spec 127 已实现 | 从 `ktx.yaml` 卸载连接；可选清约定 secret 与本地 YAML 资产 | `POST /api/connections/:connId/remove`，详见 [`webui/docs/127-connection-delete-spec.md`](../webui/docs/127-connection-delete-spec.md) |
| 表白名单配置 | 已实现 | 控制连接启用表范围 | `PUT /api/connections/:connId/enabled-tables` |
| 连接测试与 ingest | 已实现 | 验证 DB 可用并触发 schema 扫描 | `POST /api/connections/:connId/test`, `POST /api/connections/:connId/ingest` |
| Lucy MCP Proxy | 已实现 | Bearer token、ACL、audit、tool forwarding | `POST /mcp` on 7879 |
| WebUI 写入 secret 明文 | 非目标 | 避免泄露 `.ktx/secrets/` | 密码文件仍由部署/运维路径维护 |

## 5. 当前剩余重点

| 主题 | 状态 | 下一步 |
|---|---|---|
| Semantic layer reindex 闭环验收 | partial | 补充 WebUI/CLI reindex 用户路径和验收证据 |
| Wiki 检索命中验收 | partial | 补充 KTX wiki_search 命中证据 |
| Skill management | partial | 明确 v1 后的 Skill Editor / 版本化 / eval 回归闭环 |
| MCP endpoint lifecycle management | partial | 从配置复制推进到 endpoint 生命周期、状态控制与健康反馈 |
| 部署向导与连接概览体验升级 | designed | 按 `webui/docs/10-deployment-connection-ux-refresh.md` 优化指标语义、交付 banner、连接卡片、Add Schema 抽屉和 endpoint 复制 |
| Business eval 完整执行 | partial | 在具备 agent/model secret 的环境跑完整 LLM/agent eval 并留痕 |

## 6. 相关文档

| 主题 | 文档 |
|---|---|
| 当前模块实现状态 | `docs/webui-impl-status.md` |
| 仓库级模块索引 | `docs/project-overview.md` |
| 产品化验收合同 | `docs/lucy-platform-goal-checklist.md` |
| WebUI 使用说明 | `docs/webui-module-guide.md` |
| API 契约 | `webui/docs/03-api-spec.md` |
| MCP Auth Proxy | `webui/docs/07-mcp-auth-proxy-spec.md` |
| 部署/连接体验升级 | `webui/docs/10-deployment-connection-ux-refresh.md` |
