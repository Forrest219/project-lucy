# project-lucy Docker 全链路测试用例

| 元数据 | 内容 |
|---|---|
| 文档名称 | project-lucy Docker 全链路 + 业务测试用例 |
| 文档类型 | Test Plan / QA |
| 版本 | v1.1 |
| 撰写日期 | 2026-06-23；2026-07-06 |
| 撰写人 | Hermes（生成器 + 测试矩阵） |
| 适用范围 | 配套 `docs/customer-deployment-guide.md` v0.3 + `docs/deployment-docker.md` v0.3；覆盖 headless 配置包、demo 链路、postgres-demo 链路、smoke、proxy 鉴权、业务 evals、失败/边界 |
| 基于材料 | `scripts/headless-config-smoke.mjs`、`scripts/p0-demo-docker-smoke.mjs`、`scripts/p0-postgres-demo-smoke.mjs`、`evals/superstore/eval/superstore-eval-cases.yaml`、`examples/docker-demo/mysql/_baseline.json`、`examples/docker-demo/scripts/gen-demo-data.mjs`、`examples/docker-demo/project-template/semantic-layer/demo-mysql/superstore_orders.yaml` |
| 关联文档 | `docs/customer-deployment-guide.md` §5/§13、`docs/deployment-docker.md` §5/§13 |

---

## 0. 用例组织约定

- 用例 ID：`TC-<域>-<编号>`，例：`TC-DEMO-001`。
- 优先级：P0 = 部署门禁必备；P1 = 业务验证必备；P2 = 边界 / 故障恢复。
- 执行方式：M = 手工（人工 + curl / 浏览器）；S = 脚本（`npm run` / `docker compose exec`）；A = 自动化（`smoke:p0:*` 已覆盖）。
- 通过标准：每条用例末尾写「Pass 条件」一栏。

### 0.1 数据基线单一事实源

所有业务查询的期望值（销售额、利润、利润率、East 销售、年份分布等）必须来自：

```
examples/docker-demo/mysql/_baseline.json
examples/postgres-demo/postgres/_baseline.json
```

这两份 JSON 由 `examples/docker-demo/scripts/gen-demo-data.mjs` 在 seed=42、rows=1000 下生成。修改基线 = 改 seed 或 rows 后重跑生成器。**不要在测试用例文档里硬编码数字**：业务查询 TC-BIZ-* 的「期望」栏改为引用 `_baseline.json` 字段，避免文档与种子漂移。

### 0.2 客户 Docker-only 最小验收路径

外部客户工程师只需要 Docker 与 Docker Compose；不需要在宿主机安装 Node/npm、KTX、Python、pnpm 或 uv。

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

最小 Pass 条件：

- WebUI `/api/health` 返回 `"ok": true`。
- demo 数据行数为 orders = `1000`，people = `4`，returns_count = `60`。
- KTX connection test / reindex / semantic-layer validate 均成功。
- region 销售额与 `_baseline.json#sales_by_region` 一致：East `550670.8159`、Central South `363958.9831`、Northeast `302200.0925`、Southwest `242646.2038`。

清理 demo：

```bash
docker compose -f docker-compose.demo.yml down -v
```

仓库开发 / CI 可运行 `npm run smoke:p0:demo` 自动覆盖上述主链路；客户安装验收不依赖 npm。

### 0.3 客户配置包最小验收路径

真实客户环境采用 `customer-config/` bind mount 到 `/data/lucy`。配置包至少包含：

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

仓库开发 / CI 的静态 gate：

```bash
npm run smoke:p0:headless-config -- --root customer-config.example
```

客户真实配置包建议加 secret 文件存在性检查：

```bash
npm run smoke:p0:headless-config -- --root customer-config --require-secret-files
```

最小 Pass 条件：

- `ktx.yaml` 不含 `CHANGE-ME`，数据库密码只用 `file:` secret 引用。
- `semantic-layer/` 至少包含一个 `_schema` manifest 和一个 overlay YAML。
- `wiki/` 至少包含一个 Markdown，且 frontmatter 有 `title` 与 `summary`。
- `evals/` 至少包含一个可解析且非空的 `*-eval-cases.yaml`。
- `webui/config/access.yaml` 只包含 `sha256:` token hash，不包含明文 token。
- `docker-compose.customer-config.yml` 将 `./customer-config` 挂载到 `/data/lucy`。

---

## 1. 测试数据基线（共用）

数据规模：**1000 行订单 + 60 行退货 + 4 个区域经理 + ~294 个客户**，跨 4 年（2024-2027）。生成器：`examples/docker-demo/scripts/gen-demo-data.mjs`，默认 `--rows 1000 --seed 42`。

> 重跑生成器：
> ```bash
> # MySQL demo（裸表名）
> node examples/docker-demo/scripts/gen-demo-data.mjs
> # Postgres demo（带 schema 前缀）
> node examples/docker-demo/scripts/gen-demo-data.mjs \
>   --schema=dataforai \
>   --out-dir=examples/postgres-demo/postgres
> ```

### 1.1 demo MySQL 种子（`examples/docker-demo/mysql/01-init.sql`）

来源由生成器产出；具体行数与基线字段全部读 `_baseline.json`。当前 seed=42 的快照：

| 字段 | 值 | 引用 |
|---|---|---|
| `counts.orders` | 1000 | `_baseline.json#counts.orders` |
| `counts.returns` | 60 | `_baseline.json#counts.returns` |
| `counts.people` | 4 | `_baseline.json#counts.people` |
| `counts.customers` | 294 | `_baseline.json#counts.customers` |
| `counts.high_discount_rows` | 132 | 满足 `discount > 0.2` 的行 |
| `counts.loss_rows` | 49 | `profit < 0` 的行 |
| `measures.total_sales` | 1459476.0953 | SUM(sales) over active rows |
| `measures.total_profit` | 294190.223 | SUM(profit) over active rows |
| `measures.profit_margin` | 0.201572 | total_profit / total_sales |
| `measures.order_count` | 1000 | COUNT(DISTINCT order_id) |
| `sales_by_region.East` | 550670.8159 | 单 region 最高 |
| `sales_by_region.Central South` | 363958.9831 | |
| `sales_by_region.Northeast` | 302200.0925 | |
| `sales_by_region.Southwest` | 242646.2038 | |
| `sales_by_year` | 2024/2025/2026/2027 各 ~36 万 | 4 年分布近似均匀 |

### 1.2 语义层 demo 期望 measure / segment

- `superstore_orders.total_sales`（SUM(sales)）
- `superstore_orders.total_profit`（SUM(profit)）
- `superstore_orders.profit_margin`（SUM/SUM，禁止 AVG）
- `superstore_orders.order_count`（COUNT DISTINCT）
- `superstore_orders.active_rows`（`is_deleted = 0` 过滤）
- `superstore_orders.high_discount`（`discount > 0.2`）
- `superstore_orders.loss_rows`（`profit < 0`）

> 完整定义见 `examples/docker-demo/project-template/semantic-layer/demo-mysql/superstore_orders.yaml`。

---

## 2. 镜像构建 & 启动

### TC-BUILD-001 构建镜像（无缓存）

- 优先级：P0
- 执行：S
- 命令：`docker compose -f docker-compose.demo.yml build --no-cache lucy`
- Pass 条件：
  - 退出码 `0`
  - 中间层无 `apt-get` / `npm ci` 报错
  - 镜像 tag `project-lucy:demo` 出现在 `docker images` 中

### TC-BUILD-002 候选 KTX 版本构建

- 优先级：P2
- 执行：S
- 命令：`KTX_VERSION=0.13.0 LUCY_EXPECTED_KTX_VERSION=0.13.0 docker compose -f docker-compose.demo.yml build lucy`
- Pass 条件：
  - 构建成功
  - `docker compose exec lucy ktx --version` 输出 `0.13.0`

### TC-START-001 demo stack 启动

- 优先级：P0
- 执行：S
- 命令：`docker compose -f docker-compose.demo.yml up -d --build`
- Pass 条件：
  - `docker compose ps` 中 `lucy` 与 `demo-db` 均 `Up (healthy)`
  - 最长等待 `90s`（KTX MCP 内部 ready）

### TC-START-002 postgres-demo stack 启动

- 优先级：P1
- 执行：S
- 命令：
  ```bash
  mkdir -p secrets
  printf '%s' 'lucy_demo' > secrets/postgres-password
  docker compose -f docker-compose.postgres-demo.yml up -d --build
  ```
- Pass 条件：
  - `postgres-db` 与 `lucy` 均 `Up (healthy)`
  - `docker compose exec lucy ktx connection test demo-postgres` 退出 `0`

---

## 3. 健康检查 / 网络可达

### TC-NET-001 WebUI healthcheck

- 优先级：P0
- 执行：M
- 命令：`curl -s http://127.0.0.1:55176/api/health | jq`
- Pass 条件：
  - HTTP 200
  - 返回体含 `"ok": true`
  - `data.bundledKtxVersion === "0.13.0"`（或与 `LUCY_EXPECTED_KTX_VERSION` 一致）

### TC-NET-002 MCP Proxy 端口可连

- 优先级：P0
- 执行：S
- 命令：`nc -zv 127.0.0.1 57881`（macOS：`nc -z -v 127.0.0.1 57881`）
- Pass 条件：连接成功，输出 `succeeded`

### TC-NET-003 内置 docker-healthcheck 通过

- 优先级：P0
- 执行：S
- 命令：`docker inspect --format '{{.State.Health.Status}}' <lucy-container-name>`
- Pass 条件：值 `healthy`

### TC-NET-004 KTX MCP 内部端口可达

- 优先级：P1
- 执行：S
- 命令：`docker compose -f docker-compose.demo.yml exec lucy nc -zv 127.0.0.1 7878`
- Pass 条件：连接成功

---

## 4. 数据接入 / 语义层

### TC-DATA-001 demo MySQL 直连校验

- 优先级：P0
- 执行：S
- 命令：
  ```bash
  docker compose -f docker-compose.demo.yml exec demo-db \
    mysql -u lucy -plucy_demo dataforai -e \
    "SELECT COUNT(*) FROM superstore_orders; SELECT COUNT(*) FROM superstore_people; SELECT COUNT(*) FROM superstore_returns;"
  ```
- Pass 条件：输出与 `_baseline.json#counts.{orders,people,returns}` 一致（1000 / 4 / 60）

### TC-DATA-002 KTX connection test

- 优先级：P0
- 执行：S
- 命令：`docker compose -f docker-compose.demo.yml exec lucy ktx --project-dir /data/lucy connection test demo-mysql`
- Pass 条件：退出码 `0`；stdout 含 `OK` 或 `connected`

### TC-DATA-003 reindex 后 sqlite 重建

- 优先级：P0
- 执行：S
- 命令：
  ```bash
  docker compose -f docker-compose.demo.yml exec lucy \
    ktx --project-dir /data/lucy admin reindex --force --output json
  ```
- Pass 条件：JSON 输出含 `"ok": true`；`/data/lucy/.ktx/db.sqlite` 大小 > 0

### TC-DATA-004 semantic-layer validate

- 优先级：P0
- 执行：S
- 命令：`docker compose -f docker-compose.demo.yml exec lucy ktx --project-dir /data/lucy sl validate superstore_orders --connection-id demo-mysql`
- Pass 条件：退出码 `0`；输出含 `valid` 或无错误行

### TC-DATA-005 sl list 可见三张表

- 优先级：P1
- 执行：S
- 命令：`docker compose -f docker-compose.demo.yml exec lucy ktx --project-dir /data/lucy sl list`
- Pass 条件：输出包含 `superstore_orders`、`superstore_returns`、`superstore_people`

---

## 5. MCP Proxy 鉴权 & 工具调用

### TC-PROXY-001 初始化握手

- 优先级：P0
- 执行：S（参考 `scripts/p0-demo-docker-smoke.mjs` `rpc` 逻辑）
- 命令：POST `http://127.0.0.1:57881/mcp`，body `initialize`，带 `Authorization: Bearer lucy-demo-agent-token`
- Pass 条件：
  - HTTP 200
  - 响应头 `mcp-session-id` 非空

### TC-PROXY-002 缺 token 应被拒

- 优先级：P1
- 执行：S
- 命令：同样请求但**不带** `Authorization` 头
- Pass 条件：HTTP 401 / 403，或 `result.error` 提示鉴权失败

### TC-PROXY-003 tools/list 必备工具

- 优先级：P0
- 执行：S
- 命令：`tools/list`
- Pass 条件：`tool names` 包含 `kx_catalog / sl_query / sl_read_source / wiki_search`，**不包含** `sql_execution`

### TC-PROXY-004 sl_read_source 返回 demo 内容

- 优先级：P0
- 执行：S
- 命令：`tools/call name=sl_read_source args={connectionId:demo-mysql, sourceName:superstore_orders}`
- Pass 条件：
  - HTTP 200，无 `error`
  - 响应 JSON 含字符串 `total_sales` 与 `active_rows`

### TC-PROXY-005 sl_query 按 region 分组

- 优先级：P0
- 执行：S
- 命令：
  ```json
  {
    "name": "sl_query",
    "arguments": {
      "connectionId": "demo-mysql",
      "measures": ["superstore_orders.total_sales"],
      "dimensions": [{"field": "superstore_orders.region"}],
      "segments": ["superstore_orders.active_rows"],
      "limit": 5,
      "include": ["sql"]
    }
  }
  ```
- Pass 条件：
  - `structuredContent.rows` 长度 = 4（4 region）
  - 各 region 的 `total_sales` 与 `_baseline.json#sales_by_region` 完全一致（容差 0.01）
  - East 在 4 region 中数值最高（`_baseline.json#sales_by_region.East` = `550670.8159`）

---

## 6. 业务查询（基于 evals 口径）

> **基线引用规则**：每条 TC 的「期望」栏给的是 `_baseline.json` 字段路径与 seed=42 下的快照值。脚本断言时直接读 JSON，避免文档与种子漂移。
> 复跑 baseline：
> ```bash
> jq . examples/docker-demo/mysql/_baseline.json
> ```

### TC-BIZ-001 总销售额

- 问题：「所有订单的总销售额是多少？」
- 期望（seed=42）：`_baseline.json#measures.total_sales` = `1459476.0953`
- 工具：`sl_query` measure=`superstore_orders.total_sales`
- Pass 条件：`abs(response.total_sales - 1459476.0953) < 0.01`

### TC-BIZ-002 总订单数（按 active_rows 过滤）

- 问题：「有效订单数（排除软删除）？」
- 期望：`_baseline.json#counts.active_orders` = `1000`
- 工具：`sl_query` measure=`superstore_orders.order_count`，segment=`active_rows`
- Pass 条件：数值 `1000`

### TC-BIZ-003 利润率

- 问题：「整体利润率？」
- 期望：`_baseline.json#measures.profit_margin` = `0.201572`
- Pass 条件：`abs(response.profit_margin - 0.201572) < 0.0001`

### TC-BIZ-004 East region 销售

- 问题：「华东（East）区域销售合计？」
- 期望：`_baseline.json#sales_by_region.East` = `550670.8159`（4 region 中最高）
- Pass 条件：`abs(response - 550670.8159) < 0.01`

### TC-BIZ-005 高折扣行比例

- 问题：「折扣超过 20% 的订单有多少？占多少比例？」
- 期望：`_baseline.json#counts.high_discount_rows` = `132` 行（13.2%）
- 工具：`sl_query` segment=`superstore_orders.high_discount`
- Pass 条件：count = 132，且 比例 ∈ [0.13, 0.14]

### TC-BIZ-006 亏损行比例

- 问题：「亏损订单有多少？」
- 期望：`_baseline.json#counts.loss_rows` = `49` 行（4.9%）
- 工具：`sl_query` segment=`superstore_orders.loss_rows`
- Pass 条件：count = 49，且 比例 ∈ [0.04, 0.06]

### TC-BIZ-007 折扣策略验证（针对高折扣亏损行）

- 问题：「折扣超过 20% 的订单里有多少是亏损的？」
- 期望：`(high_discount ∧ loss_rows) 计数 > 0`，即 `segments=[high_discount, loss_rows]` 交集有结果
- 工具：`sl_query` segments=`[high_discount, loss_rows]`
- Pass 条件：返回行数 ≥ 1，response 中含 `profit < 0` 的具体 order_id

### TC-BIZ-008 退货关联查询

- 问题：「退货订单的总销售额是多少？」
- 期望：`_baseline.json#counts.returns` = `60`；具体金额通过 join `superstore_returns` + sum sales 算得（不在 baseline 中；脚本断言时记录实际值并人工核对合理性）
- 工具：`sl_query` join `superstore_returns`，measure=`total_sales`，segment=`active_rows`
- Pass 条件：返回行数 = 60；总销售额远小于 `total_sales`（合理范围 < 200000）

### TC-BIZ-009 区域经理查询

- 问题：「Central South 的区域经理是谁？」
- 期望：`Bob`（固定值，写在生成器中）
- Pass 条件：返回字符串 `Bob`

### TC-BIZ-010 年度趋势（按 order_date）

- 问题：「各年度销售合计？」
- 期望：`_baseline.json#sales_by_year` 4 个键，2024/2025/2026/2027 各 ~36 万
- 工具：`sl_query` dimension=`YEAR(order_date)` 或按生成器约定 `order_year`（语义层已声明）
- Pass 条件：4 行；任一年份销售 ∈ [300000, 400000]（容差防漂移）

### TC-BIZ-011 superstore evals 门禁

- 优先级：P0
- 执行：S
- 命令：`npm run eval`（前提：demo stack 已启动；`docker-compose.demo.yml` v0.2 起已挂载 `./evals:/data/lucy/evals:ro`，KTX MCP 在容器内可访问 evals）
- Pass 条件：所有 P0 用例通过；非 P0 用例失败需记录但不阻断

> 备注：`docker-compose.demo.yml` 与 `docker-compose.postgres-demo.yml` 已挂载 `./evals:/data/lucy/evals:ro`（read-only），demo stack 启动后 KTX MCP 在容器内可直接访问 `evals/superstore/eval/`。无需手动 cp 或修改 entrypoint。

---

## 7. 失败 / 边界场景

### TC-FAIL-001 KTX_INTERNAL_TOKEN 漂移

- 优先级：P2
- 操作：手工改 `KTX_INTERNAL_TOKEN` 环境变量后只重启 lucy
- 期望：proxy 仍可用（token 由 entrypoint 每次启动重生成）
- Pass 条件：重启后 `TC-PROXY-001` 仍能握手

### TC-FAIL-002 demo-db 短暂不可用

- 优先级：P2
- 操作：`docker compose stop demo-db` 后 30s 内恢复
- 期望：lucy 在 demo-db 恢复后能再次 `connection test`
- Pass 条件：`docker compose start demo-db` 后 `TC-DATA-002` 重新通过

### TC-FAIL-003 端口冲突（5174 被占）

- 优先级：P1
- 操作：启动一个占 `5174` 的本地服务，再 `docker compose up`
- 期望：lucy 容器 `healthcheck` 失败退出；日志提示 `EADDRINUSE`
- 处置：换端口 `LUCY_DEMO_WEBUI_HOST_PORT=6174`

### TC-FAIL-004 缺 `<CHANGE-ME>` 占位符的 ktx.yaml

- 优先级：P2
- 操作：在 `/data/lucy/ktx.yaml` 留 `<CHANGE-ME>` 占位符重启
- 期望：entrypoint 打印 `[lucy] warning: ... still contains CHANGE-ME placeholders` 但不中断
- Pass 条件：lucy 仍启动，警告出现

### TC-FAIL-005 数据不一致（手动 DROP 表后 sl_query）

- 优先级：P2
- 操作：`docker compose exec demo-db mysql ... -e "DROP TABLE superstore_returns;"` 然后 `sl_query` 关联 returns
- 期望：`sl_query` 返回明确错误（带表名），不静默吞错
- Pass 条件：响应 `error` 含表名 `superstore_returns`

### TC-FAIL-006 LLM backend 不可达

- 优先级：P2
- 操作：临时屏蔽 `api.minimaxi.com`（或对应 `base_url`）后跑 `sl_validate`
- 期望：`sl_validate` 仍通过（不依赖 LLM），但 `sl_query` 调用涉及 measure 推断时报 `llm unavailable`
- Pass 条件：行为符合数据问答建议链路：先用 `sl_read_source` / 语义层读取确认 source、measure、segment，再用 `sl_query` 执行查询；LLM backend 不可达时不影响显式 `sl_validate`

### TC-FAIL-007 demo 卷残留导致旧状态

- 优先级：P2
- 操作：`docker compose down` 不带 `-v`，再 `up -d`
- 期望：KTX sqlite 复用旧索引，可能与新模板不一致
- 处置：必须 `docker compose down -v` 后再 `up`

---

## 8. 自动化门禁

### TC-AUTO-001 `npm run smoke:p0:demo`

- 优先级：P0
- 执行：A
- Pass 条件：脚本末尾输出 `[p0-demo-smoke] PASS`，退出码 `0`

### TC-AUTO-002 `npm run smoke:p0:postgres-demo`

- 优先级：P1
- 执行：A
- Pass 条件：脚本末尾输出 PASS，退出码 `0`

### TC-AUTO-003 security baseline

- 优先级：P1
- 执行：A
- 命令：`npm run security:baseline`
- Pass 条件：扫描通过（无 critical）

---

## 9. 验收记录模板

每轮测试请记录：

```
日期: 2026-06-23
镜像 tag: project-lucy:demo
KTX 版本: 0.13.0
宿主: macOS 14.4 / Docker 29.5.2 / Node 22.x
测试人: <name>

| 用例 ID | Pass/Fail | 备注 |
|---|---|---|
| TC-BUILD-001 | Pass | |
| TC-START-001 | Pass | demo-db health=healthy, lucy health=healthy |
| TC-NET-001   | Pass | bundledKtxVersion=0.13.0 |
| TC-DATA-002  | Pass | |
| TC-PROXY-005 | Pass | East=550670.8159, Central South=363958.9831, Northeast=302200.0925, Southwest=242646.2038 (baseline) |
| TC-BIZ-001   | Pass | total_sales = 1459476.0953 (baseline) |
| TC-BIZ-003   | Pass | profit_margin = 0.201572 (baseline) |
| TC-AUTO-001  | Pass | |
| ...          |     | |
```

---

## 10. 与现有测试的关系

| 现有脚本 | 是否覆盖本用例 | 备注 |
|---|---|---|
| `scripts/p0-demo-docker-smoke.mjs` | 覆盖 TC-START-001 / TC-NET-* / TC-DATA-001..004 / TC-PROXY-001/003..005 / TC-BIZ-004 region baseline | 已绿即可视为 §2 §3 §4 §5 大部分用例通过 |
| `scripts/p0-postgres-demo-smoke.mjs` | 覆盖 TC-START-002 / postgres 链路 | 与 demo 并行执行 |
| `scripts/p0-business-eval-smoke.mjs` | 部分覆盖 TC-BIZ-009 | 业务侧 smoke 入口 |
| `evals/superstore/eval/superstore-eval-cases.yaml` | 7 条 eval case | 与 TC-BIZ-001..008 对齐 |

`TC-FAIL-*` 与 `TC-BIZ-005..008` 需要手工或自定义脚本，本手册未自动覆盖，建议接入下次 smoke 扩展点。
