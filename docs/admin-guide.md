# Lucy Admin Guide

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Admin Guide |
| 文档类型 | Product / Admin Guide |
| 版本 | v0.1 |
| 撰写日期 | 2026-06-22 |
| 适用范围 | 管理员部署、配置、升级、日常运维 |

## 1. Admin Responsibilities

管理员负责：

- 部署 Lucy Docker image。
- 挂载 KTX project data。
- 配置数据库连接与 secret 文件。
- 维护 semantic-layer 与 wiki。
- 创建 Agent、role 和 token。
- 查看 audit 与 release gate 结果。

首版客户交付采用 headless 路径：Docker Compose、配置文件、Lucy MCP Proxy、Agent MCP client config、CLI/smoke/eval 证据。WebUI 管理台、Skill Editor / Skill 版本化 UI、MCP endpoint 生命周期管理 UI 不属于本次客户交付承诺。

## 2. Deployment Path

Start here:

- `docs/customer-deployment-guide.md`
- `docs/deployment-docker.md`
- `docs/release-ci.md`

Minimal deploy:

```bash
docker compose up -d
```

Demo deploy:

```bash
npm run smoke:p0:demo
```

## 3. First Headless Onboarding

Follow this checklist:

1. Start Docker Compose and confirm `curl http://<host>:5174/api/health`.
2. Edit `/data/lucy/ktx.yaml` and secret files for the customer database.
3. Maintain `semantic-layer/` and `wiki/` under `/data/lucy`.
4. Run `ktx admin reindex --force`, `ktx sl validate`, and a read-only `ktx sl query --execute`.
5. Provision `webui/config/access.yaml` agent/role/token config and distribute only the bearer token through the agent platform secret store.
6. Configure the agent client to `http://<host>:7879/mcp` and run `tools/list`, `sl_read_source`, and `sl_query`.

## 4. Release And Upgrade

Before release:

```bash
npm run lint:spec
npm run security:baseline
npm run smoke:p0:docker
npm run smoke:p0:demo
npm run smoke:p0:business-eval
```

Before changing bundled KTX:

```bash
npm run compat:ktx-upgrade -- --candidate <version>
```

## 5. Security Operations

Use:

- `docs/security-guide.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`
- `webui/config/access.yaml`
- `.ktx-ui/audit.sqlite`

Do not give external agents `KTX_INTERNAL_TOKEN`. Use Agent token creation instead.
