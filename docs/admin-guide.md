# Lucy Admin Guide

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Admin Guide |
| 文档类型 | Product / Admin Guide |
| 版本 | v0.3 |
| 撰写日期 | 2026-06-22；2026-07-06；v0.3 更新 2026-07-06（同步 context compiler 定位） |
| 适用范围 | 管理员部署、配置、升级、日常运维 |

## 1. Admin Responsibilities

管理员负责：

- 部署 Lucy Docker image。
- 维护客户 `customer-config/` context package 并挂载到 `/data/lucy`。
- 配置数据库连接与 secret 文件。
- 持续维护 Semantic Pack（semantic-layer）、Knowledge Pack（wiki / skills）、Query / Quality Pack（trusted query / eval / audit evidence）和 agent access 配置。
- 创建 Agent、role 和 token。
- 查看 audit 与 release gate 结果。

首版客户交付采用 headless 路径：Docker Compose、配置文件、Lucy MCP Proxy、Agent MCP client config、CLI/smoke/eval 证据。Lucy 在该路径中是 data agent context compiler + governed MCP runtime；WebUI 管理台、Skill Editor / Skill 版本化 UI、MCP endpoint 生命周期管理 UI 不属于本次客户交付承诺。

## 2. Deployment Path

Start here:

- `docs/customer-deployment-guide.md`
- `docs/deployment-docker.md`
- `docs/release-ci.md`

Minimal deploy:

```bash
docker compose -f docker-compose.yml -f docker-compose.customer-config.yml up -d --build
```

Demo deploy:

```bash
npm run smoke:p0:demo
```

## 3. First Headless Onboarding

Follow this checklist:

1. Create a customer-owned `customer-config/` context package from `customer-config.example/`.
2. Edit `customer-config/ktx.yaml` and set every database password as `file:/data/lucy/.ktx/secrets/<name>`.
3. Maintain `customer-config/semantic-layer/`:
   - `_schema/*.yaml` is the physical table manifest from scan/import.
   - `<source>.yaml` is the hand-maintained overlay for grain, measures, dimensions, segments, and joins.
4. Maintain `customer-config/wiki/` with Markdown context documents. Every wiki file must have YAML frontmatter with `title` and `summary` so KTX reindex can ingest it.
5. Maintain `customer-config/evals/` for SOW/UAT cases and `customer-config/webui/config/access.yaml` for role, token hash, tool, connection, and table ACL.
6. Start Docker Compose and confirm `curl http://<host>:5174/api/health`.
7. Run `npm run smoke:p0:headless-config -- --root customer-config --require-secret-files`.
8. Run `ktx admin reindex --force`, `ktx sl validate`, and a read-only `ktx sl query --execute` inside the container.
9. Configure the agent client to `http://<host>:7879/mcp` and run `tools/list`, `wiki_search`, `sl_read_source`, and `sl_query`.

## 4. Continuous Configuration Workflow

For every semantic/table/wiki change:

1. Edit the customer config package in Git or the customer-controlled config directory.
2. Run the static config package gate:

```bash
npm run smoke:p0:headless-config -- --root customer-config --require-secret-files
```

3. Reindex runtime metadata:

```bash
docker compose -f docker-compose.yml -f docker-compose.customer-config.yml exec lucy \
  ktx --project-dir /data/lucy admin reindex --force --output json
```

4. Validate the changed semantic source and run one read-only query:

```bash
docker compose -f docker-compose.yml -f docker-compose.customer-config.yml exec lucy \
  ktx --project-dir /data/lucy sl validate <source-name> --connection-id <connection-id>

docker compose -f docker-compose.yml -f docker-compose.customer-config.yml exec lucy \
  ktx --project-dir /data/lucy sl --connection-id <connection-id> query \
  --measure <source.measure> \
  --dimension <source.dimension> \
  --segment <source.segment> \
  --limit 5 \
  --execute \
  --max-rows 5
```

5. For user-facing or SOW changes, run the relevant eval/evidence gate before exposing the updated agent config.

## 5. Release And Upgrade

Before release:

```bash
npm run lint:spec
npm run security:baseline
npm run smoke:p0:docker
npm run smoke:p0:headless-config
npm run smoke:p0:demo
npm run smoke:p0:business-eval
```

Before changing bundled KTX:

```bash
npm run compat:ktx-upgrade -- --candidate <version>
```

## 6. Security Operations

Use:

- `docs/security-guide.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`
- `webui/config/access.yaml`
- `.ktx-ui/audit.sqlite`

Do not give external agents `KTX_INTERNAL_TOKEN`. Use Agent token creation instead.
