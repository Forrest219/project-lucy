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

## 3. First Onboarding

Open WebUI:

```text
http://<host>:5174/onboarding
```

Follow the checklist:

1. Database connection.
2. Enabled table scope.
3. Semantic layer.
4. Validate/review changes.
5. Agent MCP config.

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
- WebUI `/admin/agents`
- WebUI `/admin/audit`

Do not give external agents `KTX_INTERNAL_TOKEN`. Use Agent token creation instead.
