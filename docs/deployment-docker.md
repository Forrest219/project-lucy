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

## 9. Current Limitations

- 首版只定义单机 Docker Compose，不包含 Kubernetes/Helm。
- 首次数据库配置仍需要编辑 `ktx.yaml` 或挂载配置文件。
- WebUI production server 当前使用 `tsx` 运行 TypeScript server；后续可优化为编译后的 slim runtime image。
- KTX compatibility smoke 目前只有 CLI/version 与进程级 healthcheck；后续应增加 MCP `tools/list`、semantic-layer validate、reindex smoke。
- Demo 数据库尚未内置；业务 eval 仍依赖可访问的目标数据库和 agent CLI 环境。

## 10. Troubleshooting

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
