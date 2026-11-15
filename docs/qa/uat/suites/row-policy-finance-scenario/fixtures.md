# Fixtures — UAT-SUITE-ROW-POLICY

| 键 | 值 | 备注 |
|---|---|---|
| WebUI | `http://127.0.0.1:${LUCY_DEMO_WEBUI_HOST_PORT:-55176}` | 以 `docker ps` 实际映射为准，写入跑次 |
| Health | 同上主机的 `/api/health` | 每次重建容器后重记 `gitSha` |
| MCP Proxy | `http://127.0.0.1:${LUCY_DEMO_PROXY_HOST_PORT:-57881}/mcp` | 以实际映射为准 |
| Compose 文件 | `deploy/compose/docker-compose.demo.yml` | 与当前 `compose-lucy-1` **同一个 project** |
| Lucy 容器 | `compose-lucy-1` | 禁止换成别的容器名 |
| WebUI 登录凭据 | `/Users/forrest/Desktop/lucywebui logi.txt` | 只写路径。该文件不在时用 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`，仍按同一行序读，不把口令写入跑次 |
| 问数对照 Bearer | `/Users/forrest/Desktop/lucy token.txt`（fallback `lucymcp.txt`） | 只做不受限对照；行级断言用本套件签发的 Token |
| 人数 | 12 | `uat-row-policy-u01` … `uat-row-policy-u12` |
| 行范围种类 | ≥ 3 个库内真实取值 | 用不带行级列过滤的不受限 `lucy_query`，按该列分组后读出候选 |
| 跨表差异 | ≥ 1 人 | `u12` 在表 A 与表 B 上的取值不同，且都真实存在 |
| 临时 Role | `uat-row-policy-role` | 只授予表 A／表 B，**不得**再挂「全部行」Role |
| proven | `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN` | 只在进程环境里读取（`1`／`true`／`TRUE` 为开）。没有运行期热切换 |

## 两档跑次（不要混写成一次 PASS）

委托人 2026-11-15：做这套 UAT 时可以在本机 demo **自己造一批数据**。仓库模板只有 `superstore_orders` 一张语义 source，不再因此把 ROW-03／04 记 BLOCKED，也不再单列 `GAP-UAT-P1-28-FINANCE`。

自造规则：

- 库、表、语义 source 的名字都带前缀 `uat_row_policy_`。
- 至少两张事实表，共用一个行级列（公司、组织或区域这类维度），列上至少 3 个真实取值。
- 行集由本套件写入，测后连同语义 source 一并删除。不改 `examples/docker-demo` 里的常备模板。
- 这批表就是本场景的数据。必做全过可以记 **PASS**。不必再找客户财务库。

开跑时把连接 id、两张 source 名、行级列、三个取值、以及自造对象清单写入跑次。source 名用 `uat_row_policy_` 前缀，不要把 `dataforai.` 物理前缀当成 source 名。

## proven 切换

关与开都要重建 **同一个** compose project 的 lucy 容器，保留原数据卷。

- 禁止 `docker compose -p lucy-ac-p1-by01`。那个 project 会换卷、换容器名。
- 先读正在跑的容器标签 `com.docker.compose.project`，后面的 `-p` 只能等于这个值。
- Gate-Off：`docker compose -p <该 project> -f deploy/compose/docker-compose.demo.yml -f deploy/compose/docker-compose.ac-p1-by01-proven-off.yml up -d --force-recreate --no-deps lucy`
- Gate-On：`docker compose -p <该 project> -f deploy/compose/docker-compose.demo.yml -f deploy/compose/docker-compose.row-policy-uat-proven-on.yml up -d --force-recreate --no-deps lucy`。这个 overlay 只设置 proven。
- 禁止用 `docker-compose.ac-p1-by01.yml` 整份 overlay。它的用法说明要求 `-p lucy-ac-p1-by01`，会换数据卷；它还把 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=true` 写进环境（Gate-Off 会静默失效），并带 `KTX_VERSION`（与镜像构建参数同名的运行期变量，不改捆绑的 KTX）和 `POSTHOG_DISABLED=1`。
- 每次重建后重新 `GET /api/health`，重记 `gitSha`。容器内 `printenv LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN` 必须与本阶段声明一致。
- 结束时用不带 proven overlay 的原 demo compose、同一个 `-p`，再 `--force-recreate --no-deps lucy`。`printenv` 必须为空或非真。只改文件、不重建，不算恢复。

CONVENTIONS 对本套件的豁免只覆盖上面这一次切换。用重启掩盖失败的查询，仍是 FAIL。

## 角色与 Agent

临时 Role `uat-row-policy-role` 使用 `permission_model_version: 2`。每张被测表写 `row_access: all`（角色本身不收窄）。`allow.tools` 含 `lucy_query`、`lucy_explain_query`、`lucy_catalog`。每个受限 Agent 只绑定这个 Role，不得再挂 `demo_readonly` 这类覆盖多张表的全部行 Role。

个人收窄只写在 Agent `constraints.sources[]`：`connection`、`schema`、`names`、`predicates[]`（`field`／`op`／`value`）。表 A 与表 B 用不同的 source 项。同一张表不要又在 Role 的 `row_policy` 里写一个不同取值：两层是 AND，取值不同会 `final_rows_unsatisfiable`，Agent 保存会被拒。Role 行策略与 Agent constraints 只选一层来表达范围。

Token：`POST /api/admin/agents/<id>/tokens`。明文不写跑次。

保存走 WebUI 行级策略或 Admin 正式保存（含预览确认）。不要手改 `access.yaml` 绕过保存校验。

跑次附映射表：`uXX → 表 → 取值`。每个 Agent 的生效授权不得含 `tables: ["*"]`。用该 Agent 的 Token 调 `lucy_explain_query`，确认 `finalRowsNonTrue=true`。角色预览看不到 Agent 个人收窄，不能单独当证据。不满足则该条 **BLOCKED（夹具）**，不要记成产品 FAIL。

## 行级列

行级列必须同时满足：它是该 source 的物理列（manifest 里有，能被编译闸绑定）；同一 source 能在 `lucy_query` 里把它当作 dimensions 分组。仓库 demo 的 `superstore_orders.region` 满足这一点：`superstore_orders.yaml` 是 Manifest overlay，物理列来自 `_schema/dataforai.yaml`。不要用派生列 `order_year`。

对照和受限查询必须是同一次形状的 `lucy_query`：同一分组维度、同一 measures、同一 segments。SQL 只能作旁证，不能当对照格。两侧无法用同一次 `lucy_query` 表达时，记 **BLOCKED（夹具）**。对照查询不得自带行级列过滤。

## 查询形状

- 除 UAT-ROW-05 向量 3 外，受保护源上的 filter 只用结构化 `{field, op, value}`。字符串 filter 会被拒，那一拒不证明行级隔离。
- 必做查询是单表聚合，不带 `joins`／`join`。
- 受限查询的 `filters` **不得**包含行级列。对照用不带行级列过滤的查询按该列分组。

## 对照值

每个（人，表）：对照＝不受限查询里该取值的聚合。受限结果必须与这一格逐值一致，且不含其他取值。

## 禁止

- 把 Bearer、密码、Token 明文写入 runs／INDEX／inbox
- 测完让 proven 停在打开，而开跑前不是打开
- 留下 `uat-row-policy-*`
- 用少于 12 人的抽样代替 UAT-ROW-02
- 在受限查询里自带行级列过滤来凑对照
