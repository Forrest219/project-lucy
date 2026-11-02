# 功能收口，发布类删除

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-02 |
| 授权 | 按 [功能收口、发布类删除计划](../plans/lucy-20261102-functional-close-release-delete-plan.md) 执行 |
| 结论 | **五条清单在功能上收口。发布类从现行状态删除**，不再因为没执行而显示不通过 |

**边界（逐条写明）**

- **不跑 E2E。** 浏览器 E2E、real-e2e、客户 linux/amd64 环境本轮都没有执行。
- **不改冻结 catalog。** `scripts/e2e/contracts/case-catalog.yaml`、`case-catalog.lock.json`、`v025-coverage.yaml` 一字未改。
- **不把编号改成通过。** `AUD25`、`ROW25`、`ARV25`、`SEM25` 与 EA 的执行状态保持原样，没有一条被改成通过。
- **本条收口不表示可上线。** 功能收口的证据是本机行为断言。
- **本轮的验证命令没有跑起来。** 执行本任务的会话里，工具权限挡住了 `node`／`npm`／`npx <runner>` 与 `git`，因此定向组件测试（`webui/src/__tests__/audit-reconciliation-page.test.tsx`）与 `npm run lint:spec-docs` **未实际执行**。断言与用例已落盘；`stale-status` 这一条用等价的本地脚本按 `scripts/lint-spec-docs.mjs` 的同一套正则与同一批文件复算，结果是 0 条违规（288 个文件）。两条新用例与完整门禁需要在可执行环境复跑一次再签收。

## 清理范围（逐条抄自计划）

| 清单 | 功能收口 | 发布类删除 |
|---|---|---|
| L25-09 | 维持 S01–S07 已收口 | 从现行状态删除 S08、`AUD25-A01`…`A12`、U9 两阶段、客户单副本重跑 |
| L25-14 P0 | 维持 R2／R4／R5 已收口 | 从现行状态删除 V01–V22、C19、`ROW25`、客户 Linux 大写 Schema、Wave 0b |
| L25-02／03 | 补上两句还没有组件断言的产品行为，然后收口 | 从现行状态删除 V01–V12、`ARV25`、浏览器详情、真实事件全集、同一次读取里 API／页面／CSV 互相对上、客户单副本 |
| L25-11 | FC-01–FC-32 维持关闭。G30 按「只产报告」收口 | 从现行状态删除 `SEM25-V01`…`V22`、Wave 0b、客户交付 |
| 2026-10-19 审计可信度 | 运行时合同维持指向 L25-09 S01–S07 | 从现行状态删除 EA-01–EA-36。QA 文件退出升级管理 |

删除后的现行句不再写「不记通过」「仍未执行」「归 E2E」——那些句子会让没跑过的编号看起来像没通过。

## L25-02／03 补上的两句产品行为

两句都落在一个组件测试文件里：

| 句子 | 测试名 | 落点文件 |
|---|---|---|
| 对账问询详情页不把长表清单收成「等 N 个」：13 条长表身份逐条含 `connectionId`／`schema`／`table`，全文没有「等 N 个」 | `问询详情逐条给出完整表身份，不收成「等 N 个」` | `webui/src/__tests__/audit-reconciliation-page.test.tsx` |
| 表排行逐条给出完整 `connectionId / schema / table` 并可复制全文；列表文本没有「等 N 个」 | `使用概况的表排行列出完整表身份并可复制全文` | `webui/src/__tests__/audit-reconciliation-page.test.tsx` |

页面的排行列表用**使用概况这一次读取**里已有的表清单渲染，不新发请求，也不合并同名表。表身份口径与问询详情共用同一份服务端推导（`webui/server/admin/reconciliation.ts` 的 `buildTableEvidenceSet`），不出现第二套口径。

## G30 收口

G30 的产品合同是「校验只产报告，不产可发布计划」。本轮**按现有合同收口这句话**，没有让批量校验产出可发布计划，也没有打开 L25-16 的 W-B。

对应断言在 `webui/server/__tests__/semantic-batch-functional-contract.test.ts`，测试名 `G30 — the batch check produces a report, not a publishable plan` / `returns a task and a report only, and writes no release`：批量校验端点的响应只有任务与报告，没有 `validationId`／`releaseId`／`planDigest`；落库的任务记录同样只有报告；审计记的是 `semantic_batch_validated` 且 `publishEffect` 为 `false`、`releaseId` 为 `null`，没有 `semantic_batch_published`；正式文件不变，也没有触发索引。

## 冻结目录与编号

`AUD25`、`ROW25`、`ARV25`、`SEM25` 仍然被发布目录引用，留在 E2E 主线和冻结 catalog。本轮不跑、不改通过、不删 catalog 行，只是不再让它们解释功能收不收口。

RTV-07 的翻译防御缺口不在本任务，仍留在行策略模板 Spec。
