# Spec 149 运维问数连接 —— 实现记录（2026-10-29）

| 项 | 内容 |
|---|---|
| 依据 | [Spec 149 v1.2](../../webui/docs/149-ops-evidence-connection-spec.md)、[WO-202609-25 v2.1](../../webui/docs/plans/wo-202609-25-ops-evidence-connection.md) |
| 分支 | `lucy-v0.25` |
| 状态 | **实现已落地到工作树，未提交**。自动化断言通过；**浏览器／E2E／镜像与客户环境验收未执行** |
| 验收结论 | 无。没有任何一条记为 UAT 通过，也没有产品验收签字 |

## T0 冻结结果（KTX 0.16.0）

用镜像 `ARG KTX_VERSION=0.16.0` 钉住的包执行 SQLite 目录，得到：

| 字段 | 冻结值 |
|---|---|
| schema | `main` |
| sourceName | `ops_calls`、`ops_call_tables` |
| physicalTable | `ops_calls`、`ops_call_tables`（**裸名**） |
| enabled_tables | `ops_calls`、`ops_call_tables` |

该版本的 SQLite 目录 `catalog` 与 `db` 均为 null（`connectors/sqlite/connector.js` 的
`introspect` / `listTables` + `context/ingest/adapters/live-database/manifest.js` 的
`buildTableRef`），因此物理名不带 `main.` 前缀。启用表范围解析
（`scopedTableNames(scope, {catalog:null,db:null})`）对 `main.ops_calls` 这类带段的名字
会解析出 `db=main` 而**落空**，裸名才命中——这是 `physicalTable` 取裸名的硬依据。

冻结值落在 `webui/server/ops-evidence/contract.ts` 的 `OPS_EVIDENCE_FROZEN`，Manifest、
overlay、Role 模板、Docker demo Role 与连接块都从这一处取值。

## 落点

| 区域 | 文件 |
|---|---|
| 契约与冻结值 | `webui/server/ops-evidence/contract.ts`、`webui/src/lib/opsEvidence.ts` |
| 视图 | `webui/server/proxy/audit.ts`（`recreateOpsEvidenceViews` / `assertOpsEvidenceViewsSafe`） |
| 确保与就绪 | `webui/server/ops-evidence/{ensure,readiness,connection-block,assets}.ts` |
| entrypoint 入口 | `webui/server/ops-evidence/cli.ts` |
| 显式授权与查询门 | `webui/server/proxy/acl.ts`、`webui/server/proxy/mcp-proxy.ts` |
| 角色模板 | `webui/server/admin/role-templates.ts`（`lucy_ops_reader`） |
| 删除保护 | `webui/server/project.ts`（`OpsEvidenceConnectionProtectedError`） |
| 界面 | `webui/src/pages/connections/ConnectionOverview.tsx`、`webui/src/pages/admin/{RoleDetail,AgentList,AgentDetail}.tsx` |
| 模板 | `webui/config/ops-evidence/{semantic-layer,skills,wiki}/lucy-ops/` |
| Docker demo | `examples/docker-demo/project-template/webui/config/access.yaml` |
| 启动顺序 | `scripts/runtime/docker-entrypoint.sh` |

## 已验证

| 证据 | 命令 | 结果 |
|---|---|---|
| 视图语义 | `npx vitest run server/__tests__/ops-evidence-views.test.ts` | 5/5 通过（SC-02/03/04/06/12/13/22） |
| 连接块与就绪 | `npx vitest run server/__tests__/ops-evidence-connection.test.ts` | 6/6 通过（SC-05/08/11/20） |
| 资产复制与 ACL | `npx vitest run server/__tests__/ops-evidence-assets.test.ts` | 5/5 通过（SC-09/14/16/18） |
| 显式授权与查询门 | `npx vitest run server/__tests__/ops-evidence-acl.test.ts` | 4/4 通过（SC-01/08/10/20） |
| 删除保护 | `npx vitest run server/__tests__/ops-evidence-delete.test.ts` | 2/2 通过（SC-07） |
| Docker demo 模板 | `npx vitest run server/__tests__/ops-evidence-demo.test.ts` | 2/2 通过（SC-15） |
| 角色模板 | `npx vitest run server/__tests__/ops-evidence-role-template.test.ts` | 4/4 通过 |
| 启动顺序 | `node --test scripts/runtime/docker-entrypoint.test.mjs` | 17/17 通过（含 SC-19） |
| 语义执行（SC-21） | `LUCY_KTX_BIN=<ktx 0.16.0> node scripts/smoke/ops-evidence-semantic-query.mjs` | PASS：UTC 日过滤、四个指标、过滤后生成 SQL 明细 |
| 全量 WebUI 回归 | `npx vitest run --maxWorkers=1` | 388 文件 / 4610 用例全部通过 |
| 类型 | `npx tsc --noEmit` | 75，与干净 HEAD 基线同数（本改动未新增类型错误） |
| 门禁 | `npm run lint:terminology` / `lint:ia-boundary` / `lint:spec` | 通过 |

SC-21 用的是**仓库里的语义模板**与**钉住的 KTX 0.16.0**，不是把查询直接打到视图上；
Manifest 不含 `call_day`，派生列只在 overlay 的 `columns:` 块。

## 未执行 / 未验证

- 浏览器验证（按 `docs/governance/DEVELOPMENT.md`，默认不做；本任务未获授权）。
- Playwright / E2E 套件、移动窄屏。
- Docker 镜像构建、`smoke:p0:demo`、客户 Kubernetes 环境。
- 演示两拍（第一拍 Superstore 三张表 → 第二拍运维问数连接）在真实容器里的连通性。
- 已有 `lucy-demo-data` 卷上的平滑升级行为（模板只保证**全新 seed** 带 `demo_ops`）。
- `LUCY_CONTENT_ROOT=.` 之外的**客户现场**内容根布局。
- 多副本 / 分布式部署（Spec 149 不涉及）。

## 与既有实现的偏差（已在代码注释中标注）

1. **Spec §7 的 `database` 字段**：KTX 的 SQLite 连接器只读 `path`（`connectors/sqlite/connector.js`：
   “requires connections.<id>.path or url”）。连接块同时写 `path` 与 `database`，同值；
   一致性判定读的是「生效路径」（`path` 优先）。
2. **`validate_project_context` 的位置**：为了不让运维问数自带的语义文件把「内容根为空」
   的守卫顶成非零计数，校验提到确保之前；确保仍在 `sync_runtime_mirror` 与 `supervise_ktx`
   之前，顺序与 Spec §8 的伪代码一致。
3. **既有 entrypoint 测试的两处断言**（`ktx.yaml` 字节不变）改为「客户连接块不被改写，
   唯一新增是运维问数连接块」——这是 Spec 149 Goal 1 的直接要求。
