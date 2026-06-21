# Lucy Docker Deployment

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Docker Deployment |
| 文档类型 | Deployment Guide |
| 版本 | v0.1 |
| 撰写日期 | 2026-06-21 |
| 适用范围 | Lucy 首版单机 Docker Compose 部署 |

## 1. Scope

本文档描述 Lucy 的首版 Docker 部署路径：

- 使用单机 Docker Compose。
- Lucy 镜像内置固定版本 KTX runtime。
- Lucy repo 不 fork / vendor KTX 源码。
- 项目数据、配置、语义层、wiki、audit/eval 状态持久化在 `/data/lucy`。
- 客户不需要在宿主机安装 KTX、Node、Python、pnpm 或 uv。

## 2. Bundled Runtime

当前 Dockerfile 默认安装：

```text
@kaelio/ktx@0.13.0
```

构建时可通过 build arg 覆盖：

```bash
docker compose build --build-arg KTX_VERSION=0.13.0
```

镜像运行后可验证：

```bash
docker compose exec lucy ktx --version
```

当前 P0 smoke 期望 bundled KTX 为 `0.13.0`。如覆盖 build arg，请同步设置
`LUCY_EXPECTED_KTX_VERSION` 后再运行 smoke。

镜像构建时还会预安装 KTX Python runtime：

```bash
ktx admin runtime install --yes --feature core
```

这保证容器内 `ktx sl query --execute` 可直接运行，不需要客户进入容器后交互安装 runtime。

## 3. Ports

| Port | Purpose | Container Env |
|---|---|---|
| `5174` | Lucy WebUI + REST API | `LUCY_WEBUI_PORT` |
| `7879` | Lucy MCP Proxy endpoint | `LUCY_PROXY_PORT` |
| `7878` | Internal KTX MCP upstream | not exposed by compose |

默认外部入口：

```text
WebUI: http://localhost:5174
MCP:   http://localhost:7879/mcp
```

如宿主机端口冲突，可只改 compose 的宿主映射端口，容器内端口保持不变：

```bash
LUCY_WEBUI_HOST_PORT=55175 LUCY_PROXY_HOST_PORT=57880 docker compose up --build
```

KTX upstream 默认只绑定容器内 `127.0.0.1:7878`。外部 agents 应接入 Lucy MCP Proxy，不直接接入 KTX upstream。

## 4. First Start

```bash
docker compose up --build
```

首次启动时，entrypoint 会将镜像内的模板文件 seed 到 `/data/lucy`：

- `ktx.yaml`
- `semantic-layer/`
- `wiki/`
- `skills/`
- `evals/`
- `webui/config/access.yaml`
- `.ktx/`
- `.ktx-ui/`

默认 compose 使用 named volume：

```text
lucy-data:/data/lucy
```

## 5. Configure Database

首版仍需要编辑 `/data/lucy/ktx.yaml` 和挂载密码文件。

推荐做法：

1. 启动一次容器，让 `/data/lucy` 完成初始化。
2. 编辑 volume 中的 `ktx.yaml`，替换 `<CHANGE-ME-*>`。
3. 将数据库密码写入 `/data/lucy/.ktx/secrets/<password-file>`。
4. 确保 `ktx.yaml` 的 `password:` 指向容器内路径，例如：

```yaml
password: file:/data/lucy/.ktx/secrets/mysql-aliyun-password
```

5. 重启：

```bash
docker compose restart lucy
```

后续应将数据库接入向导产品化到 WebUI，本节是首版部署路径。

## 6. Healthcheck

容器 healthcheck 执行：

- `ktx --version`
- `GET http://127.0.0.1:${LUCY_WEBUI_PORT}/api/health`
- TCP connect `127.0.0.1:${LUCY_PROXY_PORT}`

手动验证：

```bash
curl http://localhost:5174/api/health
docker compose exec lucy ktx --version
```

## 7. MCP Agent Config

Agent 平台应接入 Lucy MCP Proxy：

```json
{
  "mcpServers": {
    "lucy": {
      "type": "http",
      "url": "http://localhost:7879/mcp",
      "headers": {
        "Authorization": "Bearer <LUCY_AGENT_TOKEN>"
      }
    }
  }
}
```

`<LUCY_AGENT_TOKEN>` 应由 Lucy WebUI 的 Agent/Token 管理功能生成。不要把内部 `KTX_INTERNAL_TOKEN` 配给外部 agent。

## 8. Runtime Environment

| Env | Default | Meaning |
|---|---|---|
| `KTX_PROJECT_ROOT` | `/data/lucy` | KTX/Lucy 项目根目录 |
| `KTX_INTERNAL_TOKEN` | auto-generated on start | Lucy proxy 调用 KTX upstream 的内部 token |
| `KTX_MCP_HOST` | `127.0.0.1` | KTX upstream bind host |
| `KTX_MCP_PORT` | `7878` | KTX upstream port |
| `LUCY_WEBUI_HOST` | `0.0.0.0` | WebUI/API bind host |
| `LUCY_WEBUI_PORT` | `5174` | WebUI/API port |
| `LUCY_PROXY_HOST` | `0.0.0.0` | MCP Proxy bind host |
| `LUCY_PROXY_PORT` | `7879` | MCP Proxy port |
| `LUCY_PROXY_UPSTREAM_HOST` | `127.0.0.1` | KTX upstream host for proxy forwarding |
| `LUCY_PROXY_UPSTREAM_PORT` | `7878` | KTX upstream port for proxy forwarding |
| `KTX_TELEMETRY_DISABLED` | `1` | 禁用 KTX telemetry |

Compose 宿主端口映射变量：

| Env | Default | Meaning |
|---|---|---|
| `LUCY_WEBUI_HOST_PORT` | `5174` | 宿主机映射到容器 `5174` 的 WebUI/API 端口 |
| `LUCY_PROXY_HOST_PORT` | `7879` | 宿主机映射到容器 `7879` 的 MCP Proxy 端口 |

## 9. Current Limitations

- 首版只定义单机 Docker Compose，不包含 Kubernetes/Helm。
- 首次数据库配置仍需要编辑 `ktx.yaml` 或挂载配置文件。
- 镜像内包含 `git`，因为 KTX 启动时需要初始化/访问项目 git repository。
- WebUI production server 当前使用 `tsx` 运行 TypeScript server；后续可优化为编译后的 slim runtime image。
- P0 smoke 已覆盖 image build、compose up、WebUI health、MCP proxy 响应、镜像内 KTX version、本机真实 MySQL 连接、semantic-layer validate、KTX CLI 查询、临时 MCP `tools/list` 与 `sl_query`。
- KTX 0.13.0 MCP `tools/list` 当前不暴露 `sl_validate`；validate gate 使用 CLI `ktx sl validate`。
- Demo 数据库尚未内置；正式 CI/release 不应依赖生产或个人可访问数据库。
- 业务 eval 仍依赖可访问的目标数据库和 agent CLI 环境。

## 10. P0 Smoke

默认本地 gate：

```bash
npm run smoke:p0
```

Docker gate：

```bash
npm run smoke:p0:docker
```

Docker smoke 默认使用宿主端口 `55175` 和 `57880`，避免和本地开发服务的默认
`5174` / `7879` 冲突。可用 `LUCY_DOCKER_SMOKE_WEB_PORT` 和
`LUCY_DOCKER_SMOKE_PROXY_PORT` 覆盖。

Demo Docker gate（不依赖个人或生产数据库）：

```bash
npm run smoke:p0:demo
```

该 gate 使用 `docker-compose.demo.yml` 启动 MySQL demo DB 与 Lucy，验证：

- demo DB health。
- Lucy WebUI `/api/health`。
- `ktx connection test demo-mysql`。
- `ktx admin reindex --force`。
- `ktx sl validate`。
- `ktx sl query --execute`。
- 经 Lucy MCP Proxy bearer token 调用 `tools/list`、`sl_read_source`、`sl_query`。

Business eval catalog gate：

```bash
npm run smoke:p0:business-eval
```

该 gate 验证核心 business eval suite 可被 runner 读取。完整 LLM/agent eval
执行仍依赖外部 agent CLI、模型账号和目标数据库，应在人工验收或 CI secret 环境中运行。

客户主链路 gate（依赖本机 `ktx.yaml` 的真实只读数据库连接）：

```bash
npm run smoke:p0:customer
```

该客户主链路 smoke 默认验证 `mysql-aliyun/superstore_orders`。可用环境变量覆盖：

```bash
LUCY_P0_CONNECTION_ID=<connection-id> \
LUCY_P0_SOURCE_NAME=<source-name> \
LUCY_P0_MEASURE=<source.measure> \
LUCY_P0_DIMENSION=<source.dimension> \
LUCY_P0_SEGMENT=<source.segment> \
npm run smoke:p0:customer
```

## 11. Troubleshooting

查看日志：

```bash
docker compose logs -f lucy
```

检查容器健康状态：

```bash
docker compose ps
```

进入容器：

```bash
docker compose exec lucy bash
```

验证 KTX：

```bash
docker compose exec lucy ktx --version
docker compose exec lucy ktx status --project-dir /data/lucy
```
