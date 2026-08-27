# Lucy Customer Deployment Guide

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Customer Deployment Guide |
| 文档类型 | Customer Deployment / Operations Guide |
| 版本 | v0.4（2026-08-03 增补：Kubernetes / Helm 单副本交付路径） |
| 撰写日期 | 2026-06-21（v0.1）；2026-06-23（v0.2 增补）；2026-07-06（v0.3 增补 headless customer config package） |
| 适用范围 | Docker Compose 与 Kubernetes / Helm 单副本形态的 Lucy 客户部署、升级、回滚和排障 |

## 1. Deployment Model

Lucy 客户交付支持两条并行的形态：

- **Docker Compose（单机 baseline）**：客户通过 Docker Compose 部署 Lucy。该路径适合小规模、POC 与单机环境；详见本文后续章节。
- **Kubernetes / Helm（单副本 baseline）**：客户通过 `deploy/k8s/helm/lucy/` Helm chart 部署。**单副本** + `Recreate` strategy + RWO PVC；不支持 HA。详见 [`docs/customer-k8s-deployer-quickstart.md`](./customer-k8s-deployer-quickstart.md)。

两种形态共享同一份 `project-lucy` image、`@kaelio/ktx@0.16.0` bundled runtime 与同一份客户 context package（`customer-config/` → `/data/lucy`）。

共同约束：

- 客户部署的是 **data agent context compiler + governed MCP runtime**：Lucy 负责把数据库、semantic-layer、wiki、eval、skills 和 access policy 组成的客户 context package 安全交付给 Agent。
- Lucy Docker image 内置 pinned KTX runtime。
- 客户标准外部入口为 Lucy MCP Proxy `/mcp`，由 Agent MCP client 通过 bearer token 访问。
- `/api/health` 仅作为运维健康检查使用，不作为客户业务操作入口。
- KTX MCP upstream 只在容器内使用，不直接暴露给外部 agent。
- 项目配置、semantic-layer、wiki、audit/eval 状态持久化在 `/data/lucy`。

默认客户入口：

```text
MCP: <LUCY_PUBLIC_MCP_URL>
```

> 🔑 **客户部署必须显式设置 `LUCY_PUBLIC_MCP_URL`（Advertise）**。不要把 Listen（容器内 `LUCY_PROXY_PORT`）或未对齐的宿主端口抄给 Agent。
>
> | 层 | 含义 | 示例 |
> |---|---|---|
> | Listen | Proxy 进程绑定 | `0.0.0.0:7879` |
> | Publish | 宿主映射 / Ingress | `7879→7879` 或网关 |
> | Advertise | WebUI / Agent 唯一事实源 | `LUCY_PUBLIC_MCP_URL` |
>
> - Docker Compose：`docker-compose.yml` 默认注入 `http://127.0.0.1:7879/mcp`（与默认宿主映射对齐）。上域名时在 `.env` 覆盖为 `https://lucy.example.com/mcp`。直连 remap `LUCY_PROXY_HOST_PORT` 时必须同步改 `LUCY_PUBLIC_MCP_URL`（见 `.env.example`）。
> - Kubernetes / Helm：`env:` 或 `values.yaml` 注入同名变量（无 compose 默认时须手写对外 URL）。
> - 裸机 systemd / 裸进程：服务启动前 `export LUCY_PUBLIC_MCP_URL=...`。
> - 本地 npm 开发：可不设；WebUI 走 fallback `http://127.0.0.1:7879/mcp`，状态为 `fallback`，**不计** MCP 就绪，文案标明不可用于客户交付。
>
> 部署方式只决定怎么注入这个值，Lucy 内部只关心最终的 public MCP URL。应用**不会**根据浏览器 Host 或容器端口推断 Advertise。

本次客户交付不是 BI 可视化工具，也不是完整企业数据平台替代品；它提供受治理的数据上下文编译与 MCP 访问运行时。

**不承诺范围**：WebUI 管理台、Skill Editor / Skill 版本化 UI、MCP endpoint 生命周期管理 UI、系统 metrics/告警/日志聚合、对象存储归档、Kubernetes/Helm 多副本 HA 与自动扩缩容（单副本 baseline 已交付）。仓库内仍保留 WebUI/API 相关代码和测试作为内部质量门禁与后续产品化基础。

**已交付范围**：Docker Compose 单机 baseline（首版）与 Kubernetes / Helm 单副本 baseline（2026-08-03 起 `deploy/k8s/helm/lucy/`）。两条路径共享同一份 image、KTX runtime 与客户 context package。

## 2. Prerequisites

客户宿主机需要：

- Docker Engine / Docker Desktop。
- Docker Compose v2。
- 能从目标数据库网络访问数据库 host/port。
- 能拉取 Lucy image 及其基础镜像。

客户安装和 Docker-only demo 验收不需要安装：

- KTX CLI。
- Node.js。
- Python。
- pnpm / uv。

`npm run smoke:*` 是仓库开发 / CI 自动化入口；只有使用 git checkout 并希望运行自动化 smoke 时才需要宿主机 Node.js。

## 3. First Deployment

1. 获取 `lucy-docker-source-bundle.tar.gz` 或 git checkout。
   - `lucy-docker-source-bundle.tar.gz` 是客户可安装包，包含 Dockerfile、compose、样例数据、运行时源码和客户文档。
   - `lucy-release-artifacts` 中的 metadata / SBOM / docs 仅用于发布说明，不等同安装包。
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

## 5. Headless Configuration Package

推荐客户形态是 **标准 Lucy image + 客户配置包目录 + bind mount 到 `/data/lucy`**。Lucy image 只作为受治理 MCP runtime；客户数据库连接、semantic-layer、wiki、eval、skills、权限和 secrets 由客户维护的 `customer-config/` 承载，形成可版本化的 customer context package。

推荐目录：

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

推荐 compose override：

```yaml
services:
  lucy:
    volumes:
      - ./customer-config:/data/lucy
```

仓库提供 `docker-compose.customer-config.yml` 作为该模式的最小 override。客户现场启动：

```bash
docker compose -f docker-compose.yml -f docker-compose.customer-config.yml up -d --build
```

配置包版本化建议：

| 路径 | 是否建议进客户 Git | 说明 |
|---|---:|---|
| `ktx.yaml` | 是 | 只允许 `password: file:/...`，不得写入明文密码 |
| `semantic-layer/` | 是 | 客户业务表、指标、维度、segment、join 的事实源 |
| `wiki/` | 是 | 业务口径、指标解释、SOW/UAT context evidence 的事实源 |
| `evals/` | 是 | 客户主题级 SOW/UAT case |
| `skills/` | 是 | 可选，客户自定义 skill 资产 |
| `webui/config/access.yaml` | 是 | 只提交 token hash、role、ACL，不提交明文 token |
| `.ktx/secrets/` | 否 | 密码文件；用客户 secret store、Docker secrets 或受控目录注入 |
| `.ktx-ui/` | 否 | 运行时状态、audit/eval 状态；按备份策略处理 |

不推荐客户长期通过 `docker cp` 手工维护配置；该方式仅用于 POC、现场救急或迁移。自定义 image template 适合多环境批量交付，不作为 200 人公司 / 50-200 张表 / 3 人运维团队的默认模式。

配置包静态检查：

```bash
npm run smoke:p0:headless-config -- --root customer-config --require-secret-files
```

该检查至少确认：

- `ktx.yaml` 不含 `CHANGE-ME`，连接密码使用 `file:` secret 引用。
- `semantic-layer/` 同时包含 `_schema` manifest 与 overlay YAML。
- `wiki/` 存在 Markdown context 文档。
- `evals/` 存在可解析的 `*-eval-cases.yaml`。
- `webui/config/access.yaml` 只包含 token hash，不包含明文 token。
- `docker-compose.customer-config.yml` 将 `./customer-config` 挂载到 `/data/lucy`。

## 6. Database Configuration

首版客户部署通过编辑 `/data/lucy/ktx.yaml` 接入数据库。若使用 §5 推荐的 bind mount 模式，实际编辑宿主机 `customer-config/ktx.yaml`；容器内路径仍是 `/data/lucy/ktx.yaml`。

默认镜像首次启动时会从镜像内 **`customer-config.example`** 组装的 `/app/project-template` seed 到 `/data/lucy`（单连接 `customer-db` 占位，无内网测试库 / 无内部 Agent）。客户生产部署必须替换 `ktx.yaml` 与 `access.yaml`，或改用 `docker-compose.customer-config.yml` bind-mount 自己的 `customer-config/`（该路径设置 `LUCY_DISABLE_TEMPLATE_SYNC=1`，不会再从镜像 template 合并文件）。本地 demo 栈（`docker-compose.demo.yml`）使用 `examples/docker-demo/project-template`，仅供内部验证，不进入客户默认 seed。

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

## 7. Semantic Layer Validation

StarRocks R1 P1 gated support follows the same `driver: mysql` / `wire_protocol: mysql` shape as Doris, but remains pending live certification. Do not list StarRocks as release-verified for a customer deployment until `LUCY_R1_STARROCKS_EVIDENCE` has passed the explicit StarRocks target gate.

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

## 8. Agent MCP Configuration

Agent 应只接入 Lucy MCP Proxy，URL 必须用 `LUCY_PUBLIC_MCP_URL`（参见 §1）：

```json
{
  "mcpServers": {
    "lucy": {
      "type": "http",
      "url": "<LUCY_PUBLIC_MCP_URL>",
      "headers": {
        "Authorization": "Bearer <LUCY_AGENT_TOKEN>"
      }
    }
  }
}
```

`<LUCY_PUBLIC_MCP_URL>` 替换为部署方在 `LUCY_PUBLIC_MCP_URL` 中设置并由 WebUI 展示的值。**不要**把 `http://<host>:7879/mcp` 或 `http://127.0.0.1:7879/mcp` 直接复制给外部 Agent —— 这两个地址分别是容器内/本机 listen 地址，未必能跨网络被 Agent 平台访问。

不要把 `KTX_INTERNAL_TOKEN` 分发给外部 agent。该 token 只用于 Lucy Proxy 到 KTX upstream 的内部调用。

Agent、role 和 token 的事实源是持久化目录中的 `webui/config/access.yaml`。首版 headless 交付以配置文件、一次性 token 创建流程和 smoke/eval 证据为准；WebUI token 管理页面不作为客户标准入口。

## 9. Demo Deployment

无需客户数据库即可跑 demo。客户工程师只用 Docker Compose 即可完成最小验收：

```bash
docker compose -f docker-compose.demo.yml up -d --build
docker compose -f docker-compose.demo.yml ps
curl http://127.0.0.1:55176/api/health
```

验证 demo 数据行数：

```bash
docker compose -f docker-compose.demo.yml exec demo-db \
  mysql -u lucy -plucy_demo dataforai -e \
  "SELECT COUNT(*) AS orders FROM superstore_orders; SELECT COUNT(*) AS people FROM superstore_people; SELECT COUNT(*) AS returns_count FROM superstore_returns;"
```

期望输出与 `_baseline.json` 一致：orders = `1000`，people = `4`，returns_count = `60`。

验证 KTX 与语义层：

```bash
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

期望 region 销售额与 `_baseline.json#sales_by_region` 一致：East = `550670.8159`，Central South = `363958.9831`，Northeast = `302200.0925`，Southwest = `242646.2038`。

清理 demo：

```bash
docker compose -f docker-compose.demo.yml down -v
```

仓库开发 / CI 可使用自动化 smoke：

```bash
npm run smoke:p0:demo
```

该命令使用 `docker-compose.demo.yml` 启动 MySQL demo DB 与 Lucy，并验证：

- DB health。
- Lucy health API。
- KTX connection test。
- reindex。
- semantic-layer validate/query。
- Lucy MCP Proxy bearer token。
- `sl_read_source` 与 `sl_query`。

## 10. Upgrade

升级前：

1. 记录当前 Lucy image tag、bundled KTX version 和 git commit。
2. 备份 `/data/lucy` volume。
3. 运行当前版本 smoke，确认基线健康。

升级：

```bash
docker compose pull
docker compose up -d --build
```

升级后，客户 Docker-only demo 验收按 §9 执行；仓库开发 / CI 环境可额外运行：

```bash
npm run smoke:p0:docker
npm run smoke:p0:demo
```

如果是客户生产库，另跑：

```bash
npm run smoke:p0:customer
```

## 11. Rollback

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

## 12. Troubleshooting

查看服务状态：

```bash
docker compose ps
docker compose logs -f lucy
docker compose logs -f demo-db
```

常见问题：

| Symptom | Check |
|---|---|
| `/api/health` 不可访问 | 宿主端口是否冲突；`LUCY_WEBUI_HOST_PORT` 映射是否正确；该端口仅用于健康/API 运维检查 |
| MCP agent 401/403 | Bearer token 是否来自 Lucy agent/token 管理；ACL 是否允许对应 tool/table |
| `ktx sl query --execute` 失败 | 数据库连接、semantic-layer validate、KTX Python runtime 是否正常 |
| 查询不到新语义层内容 | 是否运行 `ktx admin reindex --force` |
| 容器启动后 seed 不生效 | volume 中已有 `/data/lucy/ktx.yaml` 时不会覆盖已有项目 |

## 13. v0.2 增补：扩展 demo 数据集

> 本节于 2026-06-23 加入。背景：v0.1 描述的 demo 数据集仅 5 行 / 1 单退货，样本量不足以验证聚合查询、年度趋势、区域分布等业务口径。

### 13.1 数据规模

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

### 13.2 seed=42 快照（当前基线）

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

### 13.3 业务验证期望值

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

完整 P0/P1/P2 测试用例矩阵见 `docs/lucy-test-cases.md`，并在 `docs/deployment-docker.md` §13 给出 P0/P1/P2 速查表。

### 13.4 客户部署时的兼容性注意

- 数据规模扩大后，MySQL 8.4 初始化时间从 < 1s 增至 ~3-5s（容器健康检查间隔 5s，足够；如有 CI 严格 timeout，需要相应放宽）。
- Postgres demo 同步扩容；`01-init.sql` 现在 ~1100 行。
- 业务 eval case（`evals/superstore/eval/superstore-eval-cases.yaml`）原本基于 10194 行生产数据；接入 demo 链路时若数值类断言期望硬编码，会与新基线冲突。建议 eval case 改为读 `_baseline.json`（详见 `docs/deployment-docker.md` §13.4 测试用例矩阵与 `docs/lucy-test-cases.md`）。
