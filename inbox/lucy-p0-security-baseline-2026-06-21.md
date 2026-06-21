# Lucy P0 Security Baseline

日期：2026-06-21

## Scope

本报告覆盖 Lucy 首版 Docker P0 release baseline：

- Docker image / Docker Compose 部署。
- Bundled KTX runtime。
- Lucy MCP Proxy bearer token、ACL、audit 基础路径。
- Demo DB /真实 DB smoke。
- secrets 与敏感数据边界。

## Verified Controls

| Control | Status | Evidence |
|---|---|---|
| KTX upstream 不直接对外暴露 | pass | `docker-compose.yml` 仅映射 `5174`、`7879`；KTX upstream 默认容器内 `127.0.0.1:7878` |
| 外部 agent 走 Lucy MCP Proxy | pass | `npm run smoke:p0:demo` 经 `http://127.0.0.1:57881/mcp` bearer token 调 `tools/list`、`sl_read_source`、`sl_query` |
| Proxy deny 高风险工具 | pass | demo `tools/list` 不暴露 `sql_execution`、`memory_ingest`、`memory_ingest_status` |
| Demo token 非生产用途 | pass | `examples/docker-demo/project-template/webui/config/access.yaml` 明确 `p0-demo` token 只用于 demo smoke |
| KTX internal token 不交给 agent | pass | `docs/deployment-docker.md` 明确 agent 使用 Lucy token，不能使用 `KTX_INTERNAL_TOKEN` |
| 数据库密码不写入默认生产模板 | pass | `ktx.yaml.example` 使用 `<CHANGE-ME>` 和本地 secret file；`.ktx/secrets/` 被 gitignore |
| Docker image 可无交互运行 KTX query | pass | Dockerfile 预装 `git` 与 `ktx admin runtime install --yes --feature core`；`npm run smoke:p0:demo` 验证 `ktx sl query --execute` |
| Audit/admin API 基础测试 | pass | `npm run smoke:p0` 跑 `webui npm test`，覆盖 admin audit / tokens / proxy ACL 相关测试 |

## Residual Risks

| Risk | P0 Position | Follow-up |
|---|---|---|
| Demo token 是公开固定值 | 接受。仅在 demo compose/template 中使用，不用于生产部署 | P1 文档继续强调生产 token 必须由 WebUI/API 生成 |
| 首版生产数据库 onboarding 仍需编辑 `ktx.yaml` 或挂载文件 | 接受。P0 交付可部署闭环已通过 demo compose 验证 | P1 做 WebUI 数据库配置向导与 secret onboarding |
| 完整 LLM/agent business eval 依赖外部 model/agent secret | 接受。P0 只做 eval catalog smoke，真实 agent eval 进入人工验收/CI secret 环境 | P1/P2 建立带 secret 的 eval CI |
| KTX 0.13.0 MCP `tools/list` 不暴露 `sl_validate` | 接受。P0 以 CLI `ktx sl validate` 覆盖 validate gate | 后续校准 docs/ACL/eval 对 `sl_validate` 的 MCP 假设 |
| Docker image 尚未 slim 化 | 接受。P0 优先完整可运行 | P1/P2 做 multi-stage/slim runtime 与 SBOM |

## P0 Release Gate Commands

```bash
npm run smoke:p0
npm run smoke:p0:docker
npm run smoke:p0:demo
npm run smoke:p0:business-eval
```

人工/本机真实库补充：

```bash
npm run smoke:p0:customer
```
