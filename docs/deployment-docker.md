# Lucy Docker Deployment

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Docker Deployment |
| 文档类型 | Deployment Guide |
| 版本 | v0.3（2026-07-06 增补：headless customer config package 推荐模式） |
| 撰写日期 | 2026-06-21（v0.1）；2026-06-23（v0.2 增补） |
| 适用范围 | Lucy 首版单机 Docker Compose 部署 |

## 1. Scope

本文档描述 Lucy 的首版 Docker 部署路径：

- 使用单机 Docker Compose。
- Lucy 镜像内置固定版本 KTX runtime。
- Lucy repo 不 fork / vendor KTX 源码。
- 项目数据、配置、语义层、wiki、audit/eval 状态持久化在 `/data/lucy`。
- 客户安装和 Docker-only demo 验收不需要在宿主机安装 KTX、Node、Python、pnpm 或 uv。
- `npm run smoke:*` 是仓库开发 / CI 自动化入口；只有使用 git checkout 并希望运行自动化 smoke 时才需要宿主机 Node.js。

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
| `5174` | Lucy health/API service; WebUI code is present but not the customer headless entry | `LUCY_WEBUI_PORT` |
| `7879` | Lucy MCP Proxy customer endpoint | `LUCY_PROXY_PORT` |
| `7878` | Internal KTX MCP upstream | not exposed by compose |

默认客户入口：

```text
MCP: http://localhost:7879/mcp
```

> ⚠ `http://localhost:7879/mcp` 是容器内/本机的内部监听地址，**不**是客户部署里 Agent 实际应该配置的 URL。客户部署（域名、反向代理、内网网关、K8s、PaaS 等）必须显式设置 `LUCY_PUBLIC_MCP_URL`，例如 `https://lucy.example.com/mcp`；WebUI 与生成的 `.mcp.json` / Codex TOML 都会展示这个值。
> - `LUCY_PROXY_HOST` / `LUCY_PROXY_PORT`：容器内监听，**不应**直接写给 Agent。
> - `LUCY_PUBLIC_MCP_URL`：对外可访问的 URL，**唯一**展示/复制给 Agent 的事实源。

如宿主机端口冲突，可只改 compose 的宿主映射端口，容器内端口保持不变：

```bash
LUCY_WEBUI_HOST_PORT=55175 LUCY_PROXY_HOST_PORT=57880 docker compose up --build
```

`http://localhost:5174/api/health` 是运维健康检查端点，不是客户业务入口。KTX upstream 默认只绑定容器内 `127.0.0.1:7878`。外部 agents 应接入 Lucy MCP Proxy，不直接接入 KTX upstream。

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

## 5. Recommended Customer Config Mount

客户 headless 部署推荐把业务配置维护为 `customer-config/`，并 bind mount 到 `/data/lucy`：

```bash
docker compose -f docker-compose.yml -f docker-compose.customer-config.yml up -d --build
```

`docker-compose.customer-config.yml` 内容：

```yaml
services:
  lucy:
    volumes:
      - ./customer-config:/data/lucy
```

推荐配置包结构：

```text
customer-config/
  ktx.yaml
  semantic-layer/
  wiki/
  evals/
  skills/
  webui/config/access.yaml
  .ktx/secrets/
  .ktx-ui/
```

此模式下，Lucy image 与客户配置解耦：升级镜像不会覆盖业务口径、权限、wiki、eval 或 secret。`docker cp` 手工拷贝只作为 POC / 救急路径；自定义 `LUCY_TEMPLATE_ROOT` 适合多环境企业模板，不作为默认客户部署方式。

仓库提供可提交的 `customer-config.example/`，用于说明目录形态和字段边界；其中不包含真实 secret。

静态检查：

```bash
npm run smoke:p0:headless-config -- --root customer-config.example
```

客户真实配置包建议额外校验 secret 文件存在：

```bash
npm run smoke:p0:headless-config -- --root customer-config --require-secret-files
```

## 6. Configure Database

首版仍需要编辑 `/data/lucy/ktx.yaml` 和挂载密码文件。若使用 §5 推荐的 bind mount 模式，实际编辑宿主机 `customer-config/ktx.yaml`；容器内路径仍是 `/data/lucy/ktx.yaml`。

默认镜像首次启动时会从 `ktx.yaml.example` seed 出 `/data/lucy/ktx.yaml`。该文件包含 `<CHANGE-ME-*>` 占位符，只用于初始化 volume；客户生产部署必须在首次启动后编辑 volume 中的 `/data/lucy/ktx.yaml`，替换连接信息和密码文件路径。容器会对仍含 `CHANGE-ME` 的配置打印 warning，但不会阻止 Lucy runtime 启动。

推荐做法：

1. 启动一次容器，让 `/data/lucy` 完成初始化。
2. 编辑 volume 中的 `ktx.yaml`，替换 `<CHANGE-ME-*>`。
3. 将数据库密码写入 `/data/lucy/.ktx/secrets/<password-file>`。
4. 确保 `ktx.yaml` 的 `password:` 指向容器内路径，例如：

```yaml
password: file:/data/lucy/.ktx/secrets/<password-file>
```

5. 重启：

```bash
docker compose restart lucy
```

后续可将数据库接入向导产品化到治理 UI；本节的配置文件路径是首版客户 headless 部署路径。

### Docker Secrets Override

如果客户平台要求 Docker secrets，可使用仓库内的 override 文件：

```bash
mkdir -p secrets
printf '%s' '<mysql-password>' > secrets/mysql-password
printf '%s' '<postgres-password>' > secrets/postgres-password
docker compose -f docker-compose.yml -f docker-compose.secrets.yml up -d
```

容器内 secret 路径为 `/run/secrets/mysql_password` 和 `/run/secrets/postgres_password`。在 `ktx.yaml` 中引用：

```yaml
password: file:/run/secrets/mysql_password
```

未使用的 secret 可以保留占位文件，或按客户实际数据库类型裁剪 override。

## 7. Healthcheck

容器 healthcheck 执行：

- `ktx --version`
- `GET http://127.0.0.1:${LUCY_WEBUI_PORT}/api/health`
- TCP connect `127.0.0.1:${LUCY_PROXY_PORT}`

手动验证：

```bash
curl http://localhost:5174/api/health
docker compose exec lucy ktx --version
```

## 8. MCP Agent Config

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

`<LUCY_AGENT_TOKEN>` 来自持久化目录中的 `webui/config/access.yaml` agent/token 配置或一次性 token 创建流程。不要把内部 `KTX_INTERNAL_TOKEN` 配给外部 agent。

## 9. Runtime Environment

| Env | Default | Meaning |
|---|---|---|
| `KTX_PROJECT_ROOT` | `/data/lucy` | KTX/Lucy 项目根目录 |
| `KTX_INTERNAL_TOKEN` | auto-generated on start | Lucy proxy 调用 KTX upstream 的内部 token |
| `KTX_MCP_HOST` | `127.0.0.1` | KTX upstream bind host |
| `KTX_MCP_PORT` | `7878` | KTX upstream port |
| `LUCY_WEBUI_HOST` | `0.0.0.0` | health/API service bind host |
| `LUCY_WEBUI_PORT` | `5174` | health/API service port |
| `LUCY_PROXY_HOST` | `0.0.0.0` | MCP Proxy bind host |
| `LUCY_PROXY_PORT` | `7879` | MCP Proxy port |
| `LUCY_PROXY_UPSTREAM_HOST` | `127.0.0.1` | KTX upstream host for proxy forwarding |
| `LUCY_PROXY_UPSTREAM_PORT` | `7878` | KTX upstream port for proxy forwarding |
| `LUCY_PUBLIC_MCP_URL` | unset | **Public MCP endpoint** advertised by WebUI and embedded in agent config snippets. This is the runtime-configured URL that Agent platforms actually call (e.g. `https://lucy.example.com/mcp`). Distinct from `LUCY_PROXY_HOST` / `LUCY_PROXY_PORT` (which only control the internal listen address). When unset, WebUI shows the local development fallback `http://127.0.0.1:7879/mcp` and marks the state as `fallback`. |
| `KTX_TELEMETRY_DISABLED` | `1` | 禁用 KTX telemetry |

Compose 宿主端口映射变量：

| Env | Default | Meaning |
|---|---|---|
| `LUCY_WEBUI_HOST_PORT` | `5174` | 宿主机映射到容器 `5174` 的 health/API 端口 |
| `LUCY_PROXY_HOST_PORT` | `7879` | 宿主机映射到容器 `7879` 的 MCP Proxy 端口 |

## 10. Current Limitations

- 首版只定义单机 Docker Compose，不包含 Kubernetes/Helm。
- 首次数据库配置仍需要编辑 `customer-config/ktx.yaml` 或挂载等价配置文件。
- 镜像内包含 `git`，因为 KTX 启动时需要初始化/访问项目 git repository。
- WebUI production server 当前使用 `tsx` 运行 TypeScript server；这是仓库内部实现细节，不是客户标准入口，后续可优化为编译后的 slim runtime image。
- P0 smoke 已覆盖 image build、compose up、health API、MCP proxy 响应、镜像内 KTX version、semantic-layer validate、KTX CLI 查询、临时 MCP `tools/list` 与 `sl_query`。
- KTX 0.13.0 MCP `tools/list` 当前不暴露 `sl_validate`；validate gate 使用 CLI `ktx sl validate`。
- Demo 数据库尚未内置；正式 CI/release 不应依赖生产或个人可访问数据库。
- 业务 eval 仍依赖可访问的目标数据库和 agent CLI 环境。
- Skill Editor / Skill 版本化 UI、MCP endpoint 生命周期管理 UI、系统 metrics/告警/日志聚合、对象存储归档均不属于首版客户 headless 交付范围。

## 11. P0 Smoke

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

Demo Docker gate（不依赖个人或生产数据库）可用纯 Docker 命令完成：

```bash
docker compose -f docker-compose.demo.yml up -d --build
docker compose -f docker-compose.demo.yml ps
curl http://127.0.0.1:55176/api/health

docker compose -f docker-compose.demo.yml exec demo-db \
  mysql -u lucy -plucy_demo dataforai -e \
  "SELECT COUNT(*) AS orders FROM superstore_orders; SELECT COUNT(*) AS people FROM superstore_people; SELECT COUNT(*) AS returns_count FROM superstore_returns;"

docker compose -f docker-compose.demo.yml exec lucy \
  ktx --project-dir /data/lucy connection test demo-mysql

docker compose -f docker-compose.demo.yml exec lucy \
  ktx --project-dir /data/lucy admin reindex --force --output json

docker compose -f docker-compose.demo.yml exec lucy \
  ktx --project-dir /data/lucy sl validate superstore_orders --connection-id demo-mysql

docker compose -f docker-compose.demo.yml exec lucy \
  ktx --project-dir /data/lucy sl --connection-id demo-mysql query \
  --measure superstore_orders.total_sales \
  --dimension superstore_orders.region \
  --segment superstore_orders.active_rows \
  --limit 5 \
  --execute \
  --max-rows 5
```

期望 demo 数据与 `examples/docker-demo/mysql/_baseline.json` 一致：orders = `1000`，people = `4`，returns_count = `60`；region 销售额为 East `550670.8159`、Central South `363958.9831`、Northeast `302200.0925`、Southwest `242646.2038`。

清理 demo：

```bash
docker compose -f docker-compose.demo.yml down -v
```

仓库开发 / CI 环境可用自动化 smoke 跑同一主链路：

```bash
npm run smoke:p0:demo
```

该自动化 gate 使用 `docker-compose.demo.yml` 启动 MySQL demo DB 与 Lucy，验证：

- demo DB health。
- Lucy health API `/api/health`。
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

该客户主链路 smoke 面向仓库开发 / CI 环境，默认值仅用于本仓库内部验证；客户项目应按自己的 connection/source/measure 覆盖：

```bash
LUCY_P0_CONNECTION_ID=<connection-id> \
LUCY_P0_SOURCE_NAME=<source-name> \
LUCY_P0_MEASURE=<source.measure> \
LUCY_P0_DIMENSION=<source.dimension> \
LUCY_P0_SEGMENT=<source.segment> \
npm run smoke:p0:customer
```

Headless 配置包 gate（不依赖真实数据库连接）：

```bash
npm run smoke:p0:headless-config -- --root customer-config --require-secret-files
```

该 gate 验证 `/data/lucy` 配置包形态、secret 引用、semantic-layer/wiki/eval/access 解析与 compose override，不能替代 `connection test`、`reindex`、`sl validate` 和 SOW trust E2E。

## 12. Troubleshooting

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

如果 bind mount 后配置看不到，先确认是否使用了 `docker-compose.customer-config.yml`，以及 `./customer-config` 是否相对当前 compose 执行目录存在。

## 13. v0.2 增补：全链路测试用例矩阵

> 本节于 2026-06-23 加入。覆盖镜像构建 → 启动 → 健康检查 → 数据接入 → 语义层 → Proxy 鉴权 → 业务查询 → 失败/边界 → 自动化门禁，~35 条 TC。

### 13.1 用例组织

- ID：`TC-<域>-<编号>`（如 `TC-DEMO-001`）
- 优先级：P0 = 部署门禁；P1 = 业务验证；P2 = 边界 / 故障恢复
- 执行方式：M = 手工；S = 脚本；A = 自动化（`smoke:p0:*`）

### 13.2 数据基线单一事实源

所有业务断言期望值必须来自 `_baseline.json`，不要在测试脚本里硬编码：

```
examples/docker-demo/mysql/_baseline.json
examples/postgres-demo/postgres/_baseline.json
```

修改 seed 或 rows 后重跑生成器即可刷新基线。

### 13.3 P0 用例速查（部署门禁）

| 用例 | 校验点 | Pass 条件 |
|---|---|---|
| TC-BUILD-001 | `docker compose build --no-cache` | 退出码 0；镜像 `project-lucy:demo` 出现 |
| TC-START-001 | demo stack 启动 | `lucy` 与 `demo-db` 均 `Up (healthy)` |
| TC-NET-001 | Lucy health API `/api/health` | HTTP 200；`bundledKtxVersion` 与 `LUCY_EXPECTED_KTX_VERSION` 一致 |
| TC-NET-003 | 内置 docker-healthcheck | `docker inspect` 返回 `healthy` |
| TC-DATA-001 | demo MySQL 直连 | 行数与 `_baseline.json#counts` 一致（1000/4/60） |
| TC-DATA-002 | `ktx connection test demo-mysql` | 退出码 0 |
| TC-DATA-003 | `ktx admin reindex --force` | `--output json` 含 `"ok": true` |
| TC-DATA-004 | `ktx sl validate superstore_orders` | 退出码 0 |
| TC-PROXY-001 | Proxy initialize 握手 | HTTP 200；`mcp-session-id` 存在 |
| TC-PROXY-003 | tools/list 必备工具 | 含 `kx_catalog / sl_query / sl_read_source / wiki_search`；**不含** `sql_execution` |
| TC-PROXY-005 | sl_query 按 region 分组 | 4 行；`sales_by_region` 完全匹配 baseline |
| TC-BIZ-001 | 总销售额 | `measures.total_sales` |
| TC-BIZ-002 | 总订单数 | `counts.active_orders` |
| TC-BIZ-003 | 利润率 | `measures.profit_margin` |
| TC-BIZ-004 | East region 销售 | `sales_by_region.East` |
| TC-AUTO-001 | `npm run smoke:p0:demo` | 末尾输出 `PASS` |
| TC-CONFIG-001 | `npm run smoke:p0:headless-config -- --root customer-config --require-secret-files` | 配置包结构、secret 引用、wiki/eval/access 均通过 |

### 13.4 P1 业务查询

| 用例 | 工具 | 期望 |
|---|---|---|
| TC-BIZ-005 | sl_query + segment=`high_discount` | `counts.high_discount_rows` = 132 |
| TC-BIZ-006 | sl_query + segment=`loss_rows` | `counts.loss_rows` = 49 |
| TC-BIZ-007 | sl_query + segments=[high_discount, loss_rows] | 交集返回 ≥ 1 行 |
| TC-BIZ-008 | join `superstore_returns` | 60 行；总销售额 < 200000 |
| TC-BIZ-009 | join `superstore_people` | `Central South → Bob` |
| TC-BIZ-010 | dimension=`YEAR(order_date)` | 4 年分布均匀 |
| TC-AUTO-002 | `npm run smoke:p0:postgres-demo` | PASS |
| TC-AUTO-003 | `npm run security:baseline` | 无 critical |

### 13.5 P2 失败 / 边界

| 用例 | 场景 | 处置 |
|---|---|---|
| TC-FAIL-002 | demo-db 短暂不可用 | 恢复后 `connection test` 重新通过 |
| TC-FAIL-003 | 5174 端口被占 | lucy healthcheck 失败；改 `LUCY_DEMO_WEBUI_HOST_PORT` |
| TC-FAIL-005 | DROP 表后 sl_query | 响应 error 含表名 |
| TC-FAIL-007 | demo 卷残留导致旧状态 | `down -v` 后 `up` 解决 |

### 13.6 完整用例文档

完整 ~35 条 TC 含命令、参数、错误对照见 `docs/lucy-test-cases.md`，随发布产物输出到 `release/lucy-test-cases.md`。

```bash
npm run release:artifacts -- --out release/
# 或直接调用：
node scripts/release-artifacts.mjs --out release/
```

发布产物中的 `lucy-docker-source-bundle.tar.gz` 是客户可安装包；metadata、SBOM 和单独的 Markdown 文档只用于发布说明。

## 14. v0.2 增补：Demo Evals 挂载

`docker-compose.demo.yml` 与 `docker-compose.postgres-demo.yml` 已挂载 `./evals:/data/lucy/evals:ro`，使 demo 容器内 KTX MCP 的 wiki_search / eval 工具能访问到仓库的 eval suites。

挂载要点：

- read-only，不影响 demo-data volume 的运行时状态
- 不挂 evals 时，KTX MCP 在 demo 容器内找不到 superstore eval
- 调整后无需重启 demo-db；只 `docker compose up -d lucy` 即可

## 15. v0.2 增补：大陆网络环境

针对中国大陆用户访问 Docker Hub / npmjs 受限的场景：

| 受限项 | 处置 |
|---|---|
| `docker pull node:22-bookworm-slim` / `mysql:8.4` 慢 | `~/.docker/daemon.json` 加 `registry-mirrors`：`https://docker.m.daocloud.io` |
| `npm ci` 慢 | `npm config set registry https://registry.npmmirror.com` |
| 终端要走代理 | `export HTTPS_PROXY=http://127.0.0.1:7897` 后再 `docker compose up`；Docker Desktop 还要在 Settings → Resources → Proxies 同步 |

Docker Desktop 用户在镜像构建时不会自动继承 shell 代理，必须显式配置 daemon.json 或 Docker Desktop UI，否则 build 阶段 apt-get / npm install 超时。
