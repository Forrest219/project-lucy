# Customer Headless Delivery Builder Actions

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-06-29 |
| 背景 | 客户交付内容不包含 WebUI；客户使用路径以 Docker Compose + KTX runtime + Lucy MCP Proxy + Agent MCP client 为准 |
| 依据 | `inbox/lucy-platform-progress-audit-2026-06-29.md`, `docs/lucy-platform-goal-checklist.md`, `docs/test-layers-and-release-gates.md` |
| 执行人 | Builder |
| 输出位置 | `inbox/customer-headless-delivery-builder-actions-2026-06-29.md` |

## 0. 交付边界

客户交付包必须围绕 headless 使用路径组织：

1. Docker Compose 部署 Lucy/KTX runtime。
2. 配置数据库连接、secret、semantic layer、wiki。
3. 通过 Lucy MCP Proxy 暴露 `/mcp` endpoint。
4. 使用 bearer token + ACL 让 Agent 安全访问数据。
5. 通过 smoke/eval/audit 证据证明可用、可控、可追溯。

以下能力不作为本次客户交付承诺：

- WebUI 管理台。
- Admin / Eval / Connections / Onboarding UI。
- Skill Editor / Skill 版本化 UI。
- MCP endpoint 生命周期管理 UI。
- Kubernetes / Helm。
- 系统 metrics、告警、日志聚合、对象存储归档。

## P0: 客户交付前必须完成

| # | Action | 产出/证据 | 验收标准 |
|---|---|---|---|
| P0-1 | 梳理客户文档，移除或降级 WebUI 作为标准入口的描述 | 需检查并按需修改 `docs/customer-deployment-guide.md`, `docs/deployment-docker.md`, `docs/agent-integration-guide.md`, `docs/admin-guide.md`, `docs/user-guide.md`, `docs/product-docs-index.md` | 客户主路径只依赖 Docker Compose、配置文件、MCP endpoint、Agent client config、CLI/smoke 命令 |
| P0-2 | 明确 release gate 口径：客户 headless gate 与仓库 WebUI gate 分离或说明 | 文档补充到 `docs/test-layers-and-release-gates.md` 或 release 说明 | WebUI gate 可作为仓库质量门禁，但不作为客户使用路径描述 |
| P0-3 | 重跑 headless 相关本地 gate | 命令输出保存到 `inbox/headless-delivery-gate-2026-06-29.md` | `security:baseline`, `smoke:p0:docker`, `smoke:p0:demo`, `smoke:p0:postgres-demo`, `smoke:p0:business-eval` 均 PASS |
| P0-4 | 验证 MCP Proxy 客户主链路 | 在 P0-3 输出中单列 MCP 证据 | `tools/list` 过滤生效；`sl_read_source` 成功；`sl_query` 成功；bearer token 生效；ACL deny 路径可观察；audit log 写入 |
| P0-5 | 验证客户数据库路径或明确替代口径 | 若凭据可用，跑 `npm run smoke:p0:customer`；若不可用，在交付记录注明客户环境执行 | 真实库 gate PASS，或 demo MySQL/PostgreSQL gate 作为本地可重复证据且客户真实库验收待现场执行 |
| P0-6 | 推送当前分支并触发 CI | GitHub Actions 链接写入交付记录 | `lucy-release.yml` 中 headless 相关 jobs 全绿；若 WebUI job 仍存在，记录其作为 repo 质量门禁的状态 |
| P0-7 | 生成 release artifact 或客户交付包 | workflow artifact 或本地 release bundle 路径 | 包含 Docker Compose source bundle、release metadata、release notes、SBOM、客户部署文档；不把 WebUI 当客户入口 |
| P0-8 | 做一次干净目录交付演练 | 临时目录演练记录写入 `inbox/headless-delivery-dry-run-2026-06-29.md` | 从交付包解压开始，可按文档完成启动、health、MCP proxy、demo query |
| P0-9 | 形成客户交付签收记录 | `inbox/customer-headless-delivery-signoff-2026-06-29.md` | 汇总 CI 链接、本地 gate、dry-run、已知限制、客户现场待验项 |

### P0 推荐命令

```bash
npm run security:baseline
npm run smoke:p0:docker
npm run smoke:p0:demo
npm run smoke:p0:postgres-demo
npm run smoke:p0:business-eval

# 如客户真实库/本机凭据可用：
npm run smoke:p0:customer
```

## P1: 交付前应该完成

| # | Action | 产出/证据 | 验收标准 |
|---|---|---|---|
| P1-1 | 补 semantic layer headless 验收证据 | 写入 `inbox/headless-semantic-layer-evidence-2026-06-29.md` | `ktx admin reindex --force`, `ktx sl validate`, `ktx sl read`, `ktx sl "<keyword>"` 均能证明 source/measure/segment 可见 |
| P1-2 | 补 wiki/context headless 验收证据 | 写入 `inbox/headless-wiki-evidence-2026-06-29.md` | 编辑/现有 wiki 内容可被 `wiki_search` 命中，并记录 query、文档 key、返回摘要 |
| P1-3 | 客户目标 MCP client 复验 | 写入 `inbox/headless-mcp-client-evidence-2026-06-29.md` | 至少验证客户实际要用的 1 个 client；完成 `tools/list`, `sl_read_source`, `sl_query` |
| P1-4 | Business eval 完整口径收口 | 更新交付记录 | 若有 agent/model secret，跑完整 eval；否则明确本次只交付 catalog smoke + 客户环境运行方法 |
| P1-5 | Skill management 边界声明 | 更新客户文档或 release notes | 明确首版只交付 skills 文件资产和运行时引用，不交付 Skill Editor/版本化 UI |
| P1-6 | MCP endpoint management 边界声明 | 更新客户文档或 release notes | 明确首版支持 endpoint 配置、token、ACL、MCP 调用验证，不交付 endpoint 启停/多 endpoint 生命周期 UI |

## P2: 后续产品化排期

| # | Action | 说明 |
|---|---|---|
| P2-1 | 设计真正 headless release gate | 从 `smoke:p0` 中拆出无需 WebUI static SPA 的客户 gate，避免内部 UI 质量门禁和客户可用性混淆 |
| P2-2 | Headless artifact 精简 | 客户包减少 WebUI 相关噪音，只保留必要 runtime、config、docs、smoke scripts |
| P2-3 | 系统可观测性/告警 spec | metrics、日志聚合、告警、归档仍是 open risk |
| P2-4 | KTX pinning / SBOM release policy | 决策是否只 pin npm version，还是同时记录 KTX upstream git SHA |
| P2-5 | Skill management 产品闭环 | Skill Editor、版本化、eval 回归纳入后续 WebUI/治理产品线 |
| P2-6 | MCP endpoint lifecycle 产品闭环 | 多 endpoint 管理、启停、状态、健康控制纳入后续平台能力 |

## Builder 执行顺序

1. 先做 P0-1/P0-2，确保客户文档和 gate 口径不再误导。
2. 跑 P0-3/P0-4/P0-5，拿到本地 headless 证据。
3. 推送并完成 P0-6，拿 CI 证据。
4. 做 P0-7/P0-8，证明交付包可从零启动。
5. 写 P0-9 signoff。
6. 视时间补 P1-1 到 P1-6；未完成的 P1 必须在 signoff 中列为客户交付后的 follow-up。

## Reviewer 接收标准

Reviewer 接收时至少需要看到：

- 客户文档不把 WebUI 当标准入口。
- Headless gate 本地 PASS。
- CI 链接或明确 CI 待触发原因。
- MCP Proxy 主链路证据完整。
- 真实客户 DB 已验或明确待客户环境验收。
- release artifact / dry-run 记录存在。
- WebUI、Skill Editor、endpoint lifecycle UI、监控告警等非交付项已明确排除或降级。
