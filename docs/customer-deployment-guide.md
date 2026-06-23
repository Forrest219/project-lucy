# Lucy Customer Deployment Guide

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Customer Deployment Guide |
| 文档类型 | Customer Deployment / Operations Guide |
| 版本 | v0.2（2026-06-23 增补：扩展 demo 数据集到 1000 行 + 全链路测试用例矩阵） |
| 撰写日期 | 2026-06-21（v0.1）；2026-06-23（v0.2 增补） |
| 适用范围 | 单机 Docker Compose 形态的 Lucy 客户部署、升级、回滚和排障 |

## 1. Deployment Model

首版客户交付形态：

- 客户通过 Docker Compose 部署 Lucy。
- Lucy Docker image 内置 pinned KTX runtime。
- 标准外部入口为 Lucy WebUI/API 与 Lucy MCP Proxy。
- KTX MCP upstream 只在容器内使用，不直接暴露给外部 agent。
- 项目配置、semantic-layer、wiki、audit/eval 状态持久化在 `/data/lucy`。

默认入口：

```text
WebUI: http://<host>:5174
MCP:   http://<host>:7879/mcp
```

## 2. Prerequisites

客户宿主机需要：

- Docker Engine / Docker Desktop。
- Docker Compose v2。
- 能从目标数据库网络访问数据库 host/port。
- 能拉取 Lucy image 及其基础镜像。

客户不需要安装：

- KTX CLI。
- Node.js。
- Python。
- pnpm / uv。

## 3. First Deployment

1. 获取 Lucy release 包或 git checkout。
2. 启动服务：

```bash
docker compose up -d --build
```

3. 检查健康状态：

```bash
docker compose ps
curl http://localhost:5174/api/health
docker compose exec lucy ktx --version
```

4. 如宿主端口冲突，覆盖宿主映射端口：

```bash
LUCY_WEBUI_HOST_PORT=55175 \
LUCY_PROXY_HOST_PORT=57880 \
docker compose up -d --build
```

## 4. Persistent Data

默认 named volume：

```text
lucy-data:/data/lucy
```

`/data/lucy` 包含：

- `ktx.yaml`
- `semantic-layer/`
- `wiki/`
- `skills/`
- `evals/`
- `webui/config/access.yaml`
- `.ktx/`
- `.ktx-ui/`

生产部署应备份该 volume。最小备份命令示例：

```bash
docker run --rm \
  -v project-lucy_lucy-data:/data/lucy:ro \
  -v "$PWD/backups:/backup" \
  busybox \
  tar czf /backup/lucy-data-$(date +%Y%m%d-%H%M%S).tgz -C /data/lucy .
```

## 5. Database Configuration

首版客户部署通过编辑 `/data/lucy/ktx.yaml` 接入数据库。

推荐流程：

1. 首次启动一次容器，让 `/data/lucy` seed 完成。
2. 编辑 volume 中的 `ktx.yaml`。
3. 将数据库密码写入容器内 secret 文件，例如：

```bash
docker compose exec lucy mkdir -p /data/lucy/.ktx/secrets
docker compose exec -T lucy sh -c 'cat > /data/lucy/.ktx/secrets/mysql-password' < ./mysql-password
```

4. 在 `ktx.yaml` 中引用该文件：

```yaml
password: file:/data/lucy/.ktx/secrets/mysql-password
```

Docker secrets 部署也可用同一套 `file:` 机制：

```bash
mkdir -p secrets
printf '%s' '<mysql-password>' > secrets/mysql-password
printf '%s' '<postgres-password>' > secrets/postgres-password
docker compose -f docker-compose.yml -f docker-compose.secrets.yml up -d
```

对应 `ktx.yaml`：

```yaml
password: file:/run/secrets/mysql_password
```

5. 重启 Lucy：

```bash
docker compose restart lucy
```

6. 验证连接：

```bash
docker compose exec lucy ktx --project-dir /data/lucy connection test <connection-id>
```

## 6. Semantic Layer Validation

配置或修改 semantic-layer 后运行：

```bash
docker compose exec lucy ktx --project-dir /data/lucy admin reindex --force
docker compose exec lucy ktx --project-dir /data/lucy sl validate <source-name> --connection-id <connection-id>
```

用一个只读查询验证执行链：

```bash
docker compose exec lucy ktx --project-dir /data/lucy \
  sl --connection-id <connection-id> query \
  --measure <source.measure> \
  --dimension <source.dimension> \
  --segment <source.segment> \
  --limit 5 \
  --execute \
  --max-rows 5
```

## 7. Agent MCP Configuration

Agent 应只接入 Lucy MCP Proxy：

```json
{
  "mcpServers": {
    "lucy": {
      "type": "http",
      "url": "http://<host>:7879/mcp",
      "headers": {
        "Authorization": "Bearer <LUCY_AGENT_TOKEN>"
      }
    }
  }
}
```

不要把 `KTX_INTERNAL_TOKEN` 分发给外部 agent。该 token 只用于 Lucy Proxy 到 KTX upstream 的内部调用。

## 8. Demo Deployment

无需客户数据库即可跑 demo：

```bash
npm run smoke:p0:demo
```

该命令使用 `docker-compose.demo.yml` 启动 MySQL demo DB 与 Lucy，并验证：

- DB health。
- WebUI health。
- KTX connection test。
- reindex。
- semantic-layer validate/query。
- Lucy MCP Proxy bearer token。
- `sl_read_source` 与 `sl_query`。

## 9. Upgrade

升级前：

1. 记录当前 Lucy image tag、bundled KTX version 和 git commit。
2. 备份 `/data/lucy` volume。
3. 运行当前版本 smoke，确认基线健康。

升级：

```bash
docker compose pull
docker compose up -d --build
```

升级后：

```bash
npm run smoke:p0:docker
npm run smoke:p0:demo
```

如果是客户生产库，另跑：

```bash
npm run smoke:p0:customer
```

## 10. Rollback

回滚原则：

- 镜像回滚和数据回滚分开处理。
- 先回滚 image tag。
- 只有确认新版本写入的数据/配置不兼容时，才恢复 volume 备份。

镜像回滚示例：

```bash
docker compose down
# 修改 compose image tag 到上一版
docker compose up -d
```

数据恢复示例：

```bash
docker run --rm \
  -v project-lucy_lucy-data:/data/lucy \
  -v "$PWD/backups:/backup:ro" \
  busybox \
  sh -c 'rm -rf /data/lucy/* && tar xzf /backup/<backup-file>.tgz -C /data/lucy'
```

## 11. Troubleshooting

查看服务状态：

```bash
docker compose ps
docker compose logs -f lucy
docker compose logs -f demo-db
```

常见问题：

| Symptom | Check |
|---|---|
| WebUI 不可访问 | 宿主端口是否冲突；`LUCY_WEBUI_HOST_PORT` 映射是否正确 |
| MCP agent 401/403 | Bearer token 是否来自 Lucy agent/token 管理；ACL 是否允许对应 tool/table |
| `ktx sl query --execute` 失败 | 数据库连接、semantic-layer validate、KTX Python runtime 是否正常 |
| 查询不到新语义层内容 | 是否运行 `ktx admin reindex --force` |
| 容器启动后 seed 不生效 | volume 中已有 `/data/lucy/ktx.yaml` 时不会覆盖已有项目 |

## 12. v0.2 增补：扩展 demo 数据集

> 本节于 2026-06-23 加入。背景：v0.1 描述的 demo 数据集仅 5 行 / 1 单退货，样本量不足以验证聚合查询、年度趋势、区域分布等业务口径。

### 12.1 数据规模

`docker-compose.demo.yml` 与 `docker-compose.postgres-demo.yml` 现在各承载 **1000 行订单 + 60 单退货 + 4 个区域经理 + ~294 个客户**，跨 4 年（2024-2027）。

数据由生成器 `examples/docker-demo/scripts/gen-demo-data.mjs` 产出（确定性 PRNG，seed=42）。基线数字写入：

```
examples/docker-demo/mysql/_baseline.json
examples/postgres-demo/postgres/_baseline.json
```

重跑生成器：

```bash
# MySQL demo（裸表名）
node examples/docker-demo/scripts/gen-demo-data.mjs
# Postgres demo（带 schema 前缀）
node examples/docker-demo/scripts/gen-demo-data.mjs \
  --schema=dataforai \
  --out-dir=examples/postgres-demo/postgres
```

### 12.2 seed=42 快照（当前基线）

| 字段 | 值 | 来源 |
|---|---|---|
| `counts.orders` | 1000 | `_baseline.json#counts.orders` |
| `counts.returns` | 60 | `_baseline.json#counts.returns` |
| `counts.high_discount_rows` | 132 | discount > 0.2 |
| `counts.loss_rows` | 49 | profit < 0 |
| `measures.total_sales` | 1459476.0953 | SUM(sales) |
| `measures.total_profit` | 294190.223 | SUM(profit) |
| `measures.profit_margin` | 0.201572 | total_profit / total_sales |
| `measures.order_count` | 1000 | COUNT(DISTINCT order_id) |
| `sales_by_region.East` | 550670.8159 | 单 region 最高 |
| `sales_by_region.Central South` | 363958.9831 | |
| `sales_by_region.Northeast` | 302200.0925 | |
| `sales_by_region.Southwest` | 242646.2038 | |
| `sales_by_year` | 2024/2025/2026/2027 各 ~36 万 | 4 年近似均匀 |

### 12.3 业务验证期望值

测试断言应直接读 `_baseline.json`，不要在脚本里硬编码数字。常见业务查询示例：

| 查询 | 期望值来源 |
|---|---|
| 总销售额 | `measures.total_sales` |
| 总利润 | `measures.total_profit` |
| 利润率 | `measures.profit_margin` |
| East region 销售 | `sales_by_region.East` |
| 年度销售分布 | `sales_by_year` |
| 高折扣行数 | `counts.high_discount_rows` |
| 亏损行数 | `counts.loss_rows` |

完整 P0/P1/P2 测试用例矩阵见 `docs/lucy-test-cases.md`，并在 `docs/deployment-docker.md` §12 给出 P0/P1/P2 速查表。

### 12.4 客户部署时的兼容性注意

- 数据规模扩大后，MySQL 8.4 初始化时间从 < 1s 增至 ~3-5s（容器健康检查间隔 5s，足够；如有 CI 严格 timeout，需要相应放宽）。
- Postgres demo 同步扩容；`01-init.sql` 现在 ~1100 行。
- 业务 eval case（`evals/superstore/eval/superstore-eval-cases.yaml`）原本基于 10194 行生产数据；接入 demo 链路时若数值类断言期望硬编码，会与新基线冲突。建议 eval case 改为读 `_baseline.json`（详见 `docs/deployment-docker.md` §12.4 测试用例矩阵与 `docs/lucy-test-cases.md`）。

