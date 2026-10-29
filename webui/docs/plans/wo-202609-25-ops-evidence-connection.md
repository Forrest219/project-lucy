# WO-202609-25 — 运维问数连接

| 元数据 | 内容 |
|---|---|
| 文档名称 | WO-202609-25 运维问数连接 |
| 文档类型 | Work Order |
| 版本 | v2.1 |
| 撰写日期 | 2026-09-24；v2.0 修订 2026-10-28；v2.1 定稿 2026-10-29 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec 149 v1.2；[Codex 审阅](../../../docs/reviews/2026-10-29-codex-review-spec149-ops-evidence.md) |
| 状态 | **v2.1 定稿；实现已落地到工作树（未提交）**。T0 冻结结果见 [Spec 149 §5.2](../149-ops-evidence-connection-spec.md)。任务 T0–T9 已实现，自动化覆盖 SC-01–SC-23；**尚未执行浏览器/E2E/镜像与客户环境验收** |
| 适用范围 | 审计库只读视图、内容根资产、项目根镜像、KTX 启动前确保、`lucy_ops_reader`、Docker demo 的 `demo_ops`、就绪门与单测 |
| 输出位置 | `webui/docs/plans/wo-202609-25-ops-evidence-connection.md` |

v2.0 是 Codex 退回的那一版。v2.1 按 Spec 149 v1.2 替换执行范围。更早的工单正文不再作为执行依据。

本工单定稿的是设计。开工前停在这里，不改产品代码。

---

## Goal

交付 Spec 149 v1.2。

已授权且连接就绪时，运维问数 Agent 通过只读连接 `lucy-ops` 追问调用流水。能回答：某张表上谁被拒绝、生成 SQL 是什么；某个工具的失败是否集中在一个 Agent；演示里刚才哪张示例表被问到。人口只有活跃 Agent。

Docker demo 用已有三张 Superstore 表做第一拍。不灌历史流水。资产写入解析后的内容根，并镜像到 KTX 的项目根同级目录。daemon 在这次写入之前已经启动时，查询返回未就绪，不自动重载。

不改访问日志、使用概况、调用监控。不把连接写入 `setup.database_connection_ids`。不修改 Postgres demo、Executive POC 和客户配置示例。

## Code paths

| 区域 | 文件 | 改动 |
|---|---|---|
| 视图 | `webui/server/proxy/audit.ts` | 重建 `ops_calls`、`ops_call_tables` |
| 默认用量条件 | `webui/server/proxy/usage-classification.ts` | 调用 `defaultUsageConditionSql(alias).sql` |
| 确保与就绪 | 新建专用模块 | 视图、连接块、`resolveContentPaths`、`placeAsset`、`syncContentToProjectRoot`、摘要戳 |
| 启动顺序 | `scripts/runtime/docker-entrypoint.sh` | `seed_project` 之后、`supervise_ktx` 之前调用确保，再 `sync_runtime_mirror`，再写戳 |
| 内容根 / 镜像 | `webui/server/paths.ts`、`webui/server/content-mirror.ts` | 只调用，不改语义 |
| 查询门 | 目录过滤与 `lucy_query` 授权 | 显式连接名，加上 `conflict` / `reload_required` |
| 语义模板 | `webui/config/ops-evidence/semantic-layer/lucy-ops/` | Manifest 无 `call_day`；overlay 用 `date(ts)` |
| Skill / Wiki | `webui/config/ops-evidence/skills/`、`wiki/` 下的 `lucy-ops/ops-questioning.md` | 模板；按内容根复制 |
| 角色模板 | `webui/server/admin/role-templates.ts` | `lucy_ops_reader` |
| 删除 | `removeConnection` 与对应路由 | `OPS_EVIDENCE_CONNECTION_PROTECTED` |
| 连接概览 | `ConnectionOverview.tsx` | 主称「运维问数连接」；删除入口不可用 |
| 警示 | Spec 131 的 Role 详情 / Agent 绑定 | 「运维问数角色可查看生成 SQL」 |
| Docker demo | `examples/docker-demo/project-template/webui/config/access.yaml` | 正式 Role 与用户 `demo_ops` |
| 测试 | `webui/server/__tests__/`、entrypoint 顺序测试 | 临时审计库与临时项目根 |

禁止复用 `createConnection`。禁止在确保逻辑里调用 Spec 191 的重载控制器。

## 任务

### T0 — 按交付 KTX 版本分开冻结四个名字

只用镜像 `ARG KTX_VERSION` 钉住的包执行目录列出。当前值为 `0.16.0`（`Dockerfile`）。本机不同版本的结果不得写回 Spec。

对临时库创建 Spec 149 §8 的两张视图后，分别记录：

- schema 文件名，以及 Role `schema`。默认 `main`。目录返回裸表名时不得把 Role schema 改成 `ops_calls` 或空。
- sourceName：`ops_calls`、`ops_call_tables`。
- physicalTable：该版本目录中的 Manifest `table:`。
- `enabled_tables`：与 physicalTable 相同。

把这四项写进 Spec 149 §5.2 的冻结结果。后续 Manifest、Role、demo Role、连接块使用对应字段，不互相代替。

未冻结前不提交连接块和 demo Role 的最终字符串断言。另加一条：该组合能编译 `lucy_ops_reader`，并能执行一次语义查询（并入 T3 / SC-21，不在主机错版本上提前判过）。

### T1 — 审计库视图

在 `prepareTraceDatabase` 之后每次确保都 `DROP VIEW IF EXISTS` 再创建。SQL 以 Spec 149 §8 为准。WHERE 使用 `defaultUsageConditionSql(alias).sql`。

SELECT 不得含 `token_hash`、`token_hash_prefix`、`client_ip`、`user_agent`、`device_name`、`permission_snapshot_hash`、`args_summary`、`eval_mark`。WHERE 可以引用后两列。

临时库断言 SC-04、SC-12、SC-13、SC-22：混合来源的自身追问从两张视图一起消失；其他连接上同名物理表且 `connection_id` 非空时保留；空连接且物理名命中时排除。

禁止打开真实 `.ktx-ui/audit.sqlite`。禁止 `DROP` 基表。

### T2 — 连接块与就绪，不负责把 daemon 叫起来

`ensureOpsEvidence`：

1. 块缺失：写入 Spec 149 §7。`database` 为当前审计库绝对路径。`readonly: true`。`enabled_tables` 使用 T0 的 physicalTable。`connectionWrite = inserted`。
2. 不修改 `setup.database_connection_ids` 和其他连接。
3. driver、路径、`readonly` 都一致：不改文件，`connectionWrite = unchanged`。
4. 三者任一不一致：不覆盖，警告「运维问数连接配置不一致，未改写」，`readiness = conflict`。
5. 函数返回写入结果与就绪状态。它不启动 KTX，也不提交 Spec 191 重载。

摘要戳是 `<projectRoot>/.lucy-seed/ops-evidence-ktx-digest`。只有 entrypoint 在 `supervise_ktx` 之前写它。WebUI 再次进入确保时：戳存在、戳等于当前 `ktx.yaml` 摘要、且本次没有插入，才是 `current`。否则在未冲突时为 `reload_required`。

单测用临时项目根。断言 SC-05、SC-08、SC-20。

### T3 — 语义模板落在内容根，并做执行验收

按 Spec 149 §5.4 提交：

- `_schema/main.yaml`：只有物理列，没有 `call_day`。`table:` 用 T0 physicalTable。
- `ops_calls.yaml`、`ops_call_tables.yaml`：`call_day` 的 `expr` 为 `date(ts)`。

source 描述写明：活跃 Agent 是去重 `agent_id`；`token_label` 不是业务活跃 Token；生成 SQL 不作为默认分组；`call_day` 是 UTC 日历日。

`placeAsset` 的目标是 `resolveContentPaths().semanticLayer`，不是写死的 `<projectRoot>/semantic-layer`。字节相同则跳过。字节不同则记 `OPS_EVIDENCE_ASSET_CONFLICT` 且不覆盖。

SC-21：在临时 SQLite 上用这份模板执行 UTC 日过滤、四个指标、以及按表过滤后的生成 SQL 明细。KTX 版本与 T0 相同。

### T4 — 角色模板、星号排除、警示文案

`ROLE_TEMPLATES` 增加 `lucy_ops_reader`。`schema` 用 T0 的 schema 字段。工具列表含 Wiki 与 Skill 的四个只读工具。

断言：

- `GET /api/admin/roles?includeTemplates=true` 含该 id。
- 模板无 `source_scope`。
- `lucy_admin` 与 `connections: ["*"]` 的编译连接集不含 `lucy-ops`（SC-01、SC-10）。
- 表能力只有两个 source。
- 未授权查询被拒绝。
- 未就绪时，即使 Role 显式包含 `lucy-ops`，目录也不列出，查询返回 §8 的错误码。

Role 详情与 Agent 绑定展示「运维问数角色可查看生成 SQL」。SC-23 断言该句可见，且文案不含「所有者」「登录管理员」「超管」。

本任务不写 demo `access.yaml`。确保逻辑不写 `access.yaml`（SC-11 比较整文件字节）。

### T5 — 删除保护与连接卡片

`removeConnection('lucy-ops')` 在 dryRun 与写入时：

- `code`: `OPS_EVIDENCE_CONNECTION_PROTECTED`
- `message`: `运维问数连接不能删除`

不写 `config_change_log`。不删审计库，不删内容根下的语义、Skill、Wiki，也不删项目根镜像中的对应文件。

`ConnectionOverview`：该卡片标题为「运维问数连接」，连接 ID 节点 `translate="no"`。删除入口不可用。

### T6 — Skill 与 Wiki

模板路径见 Spec 149 §5.5。`status: published`。两份 ACL 都只有 `lucy_ops_reader`。

正文按 §5.5 的六步写。不得指示模型把 `count(distinct token_label)` 回答成业务活跃 Token，也不得在「活跃用户」未写明 Agent 时直接查询。

`placeAsset` 目标是 `ContentPaths.skills` 与 `ContentPaths.wiki`。随后 `syncContentToProjectRoot`。冲突用例覆盖：字节相同跳过；已有文件为草稿；`roles_allowed: ["*"]`；frontmatter 损坏。后三种字节不变且记冲突，SC-16 只对模板字节成立。

不改其他 Skill / Wiki 的 ACL。不把通道工具描述成「只能读这一篇」。

### T7 — 启动顺序

改 `scripts/runtime/docker-entrypoint.sh` 的主路径，使顺序成为：

```text
seed_project
ensureOpsEvidence
sync_runtime_mirror
write ops-evidence digest stamp
supervise_ktx
```

`supervise_ktx` 仍使用现有 `ktx mcp start --project-dir`。本任务不改 Spec 191 的重载协议，不在确保函数里发重载请求。

SC-19 用临时项目和 stub：stub 开始读取项目时，`ktx.yaml` 已含只读 `lucy-ops`，项目根同级语义文件已在，就绪为 `current`。

SC-20 用「stub 已在读旧配置」的夹具：确保插入连接后查询得到 `OPS_EVIDENCE_RUNTIME_NOT_READY`，并且没有重载请求文件被写出来。

SC-18 覆盖三种内容根：默认 `<projectRoot>/config`、另一个绝对路径、`LUCY_CONTENT_ROOT=.`。除最后一种外，镜像后的项目根同级目录含有同一 Skill 文件。

### T8 — Docker demo 的演示 Agent

只改 `examples/docker-demo/project-template/webui/config/access.yaml`。

- 正式 Role `lucy_ops_reader`，`schema` 用 T0。
- 用户 `demo_ops`，显示名「演示运维问数」，Token 标签 `demo-ops`。只提交哈希。明文默认值放在 `scripts/smoke/p0-demo-docker-smoke.mjs` 已有 demo Token 旁边，环境变量 `LUCY_DEMO_OPS_TOKEN`。不写入 Spec，不写入客户包，不打印到日志。
- 不改 `demo_readonly` 的三张表，不改 `lucy_admin` 的星号。
- 不改 postgres demo、executive POC、客户配置示例。
- 不改 `01-init.sql`，不加第四张表，不插入 `access_log` 种子。

SC-15 读模板文件。不把断言绑到已有 `lucy-demo-data` 卷。不扩展 `smoke:p0:demo` 的数值 gold。

### T9 — 测试矩阵

| ID | 场景 | 期望 |
|---|---|---|
| T9-1 | 未显式授权，包括星号 | 目录无连接；查询拒绝（SC-01、SC-10） |
| T9-2 | 临时库中的拒绝行与错误行 | Agent + 生成 SQL；错误按工具聚合（SC-02、SC-03） |
| T9-3 | 混合来源的自身追问 | 两张视图都没有该事件（SC-04） |
| T9-4 | 就绪为 `current` 的确保 | `readonly: true`，`database_connection_ids` 不含 `lucy-ops`（SC-05） |
| T9-5 | 视图 SQL | 禁止列不在 SELECT（SC-06） |
| T9-6 | 删除 | 400；审计库与三类资产仍在（SC-07） |
| T9-7 | driver、路径、`readonly` 三种冲突 | 不覆盖；查询码为 `OPS_EVIDENCE_CONNECTION_CONFLICT`（SC-08） |
| T9-8 | 字节相同，以及草稿 / `*` / 损坏 frontmatter | 相同则跳过；其余记冲突且字节不变（SC-09、SC-16） |
| T9-9 | 确保前后的 `access.yaml` | 整文件字节不变（SC-11） |
| T9-10 | 协议行、评测探针、无标记的订单行 | SC-12、SC-13 |
| T9-11 | Skill / Wiki 正文与 ACL | SC-14；`demo_readonly` 读模板 Skill 失败（SC-16） |
| T9-12 | Docker demo 模板 | SC-15 |
| T9-13 | 三种内容根与项目根镜像 | SC-18 |
| T9-14 | 确保早于 stub daemon | SC-19 |
| T9-15 | daemon 已启动后才插入 | SC-20，且无重载请求 |
| T9-16 | 语义模板执行 | SC-21 |
| T9-17 | 其他连接的同名物理表 | SC-22 |
| T9-18 | 警示文案 | SC-23 |

`cd webui && npm run lint:terminology` 覆盖新增文案。夹具时间戳写死为 UTC。

## Rollback

- 去掉 entrypoint 调用后，已写入的 `connections.lucy-ops` 保留，但不再被确保修回。删除保护一并移除后，可按 Spec 127 从 `ktx.yaml` 卸载，仍不得删除审计库。
- 视图可 `DROP VIEW`，不 `DROP` 基表。
- 删除 `lucy_ops_reader` 模板。已落成的正式 Role 仍可编译，直到运维自行移除。
- Docker demo 模板去掉 `demo_ops`。平滑升级、卷里没有该用户的环境不受影响。
- 删除 `webui/config/ops-evidence/` 模板。内容根里已复制且字节已变的文件保留。

## Out of scope

- `.ktx/db.sqlite`、评测库、问询原文、鉴权失败、配置审计、`ui_page_views`。
- 调用监控 / 访问日志 / 使用概况改版。
- 全局 data-qa instructions 与 `wiki/global`。
- 自动重载 KTX，或在确保函数里写 Spec 191 的重载请求。
- 启动时签发 Token，或在平滑升级里补写 `demo_ops`。
- 审计历史种子、第四张示例表、Postgres demo、Executive POC、客户配置示例。
- 自然语言评测 gold，以及把两拍放进 `smoke:p0:demo`。
- 修改其他 Skill / Wiki 的 `roles_allowed`，或把通道工具收成单篇授权。
