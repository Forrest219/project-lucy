# 访问日志上下文条与 SQL Server 表身份 — 实现审阅与功能合同收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-10-31 |
| 授权 | 用户授权审阅这两项实现并收口功能合同 |
| 对象 | [访问日志上下文条](../specs/lucy-20261030-audit-context-bar-spec.md) v1.0，提交 `0a9b551b`；[SQL Server 逻辑名与物理名](../specs/lucy-20261030-sqlserver-table-identity-spec.md) v1.0，提交 `b4a7c303` |
| 结论 | **两条功能合同收口。** 阻塞 0。本条收口不表示可上线，也不构成客户包验收。功能编号仍待 PM 指派 |

## 审阅范围

对照两份 Spec 的已冻结决策和验收句读实现，不重开 D1–D6、D1–D9。产品代码没有因这次审阅再改。

运行中的 demo 容器 `compose-lucy-1` 里能看到 `formatAuditWindow` 和 `physicalNames`。用本机凭据文件登录 `http://127.0.0.1:55176/login` 时，页面返回「管理员 id 或密码不正确」。访问日志页这次没有打开。页面走查不在这两条的出口里。

## 访问日志上下文条

实现与 D1–D6 一致。

- 可见窗口按传入的 IANA 时区写成 `YYYY-MM-DD HH:mm:ss`。同一时区日历日省略结束日期。解析失败时原样显示。无效时区回退运行时本地时区。
- 五个标签各自在 `.pl-audit-top-meta-label`，数值在同级节点。原始 ISO 在 `title` 和 `data-iso*`。
- 统计时间由页面传入相对文案，全页只出现一次。
- 审计同步延迟仍是 `N ms` / `N.N s` / `N.N min`。大于 5000 毫秒时数值带 `pl-status-warning`，槽位 `data-overdue="true"`。
- 暂停按钮是 `pl-btn pl-btn--secondary pl-btn--sm`，`aria-pressed` 仍在。口径说明区不再 `justify-between`。
- 审计查询、投影延迟和暂停冻结没有改。

SC-01–SC-08 关闭。按编号写明的页面用例在工作区，尚未进 `0a9b551b`；该提交里的组件断言已经锁住可见本地时间和原始 ISO。这次一起跑过。

## SQL Server 表身份

实现与 D1–D9 一致。

- 物理名只取 Schema Manifest 的 `table:`。保存前归一化。只有 `driver: sqlserver` 忽略大小写。
- 两段、三段可以保存。一段、四段、空段、`..`、斜杠和控制字符仍是 `INVALID_ENABLED_TABLE`。
- 同一个大小写不敏感键指向两个不同物理名时不改写。收成同一物理名的重复项只留第一次的权威值。
- 对不上的历史项原样保留，并告警 `ENABLED_TABLE_NOT_SCANNED`。末段相同的 `bidm.dbo.table` 与 `dbo.table` 不合并。
- `GET /api/connections/:connId/tables` 返回排序后的逻辑名和 `physicalNames`。启用表范围一张逻辑表一行，保存请求体是物理名。
- 三段 `table:` 进入语义身份索引，`schemaMismatch` 不为真。三段名不再把数据库段推断成 Schema。
- 迁移脚本默认 dry-run。`--apply` 先备份，第二次不再写文件。不在进程启动时改 `ktx.yaml`。
- `role: admin` 只被预检点名，文件不改。

SC-01–SC-11 关闭。MySQL 两段名仍区分大小写。

## 这次跑过的测试

```bash
cd webui && npx vitest run \
  src/__tests__/audit-trust/audit-top-meta-bar.test.tsx \
  src/__tests__/audit-trust-page-integration.test.tsx \
  src/__tests__/admin-audit-turns.test.tsx \
  server/__tests__/enabled-table-identity.test.ts \
  server/__tests__/api.save.test.ts \
  server/__tests__/access-role-precheck.test.ts \
  server/__tests__/semantic-batch-identity.test.ts \
  src/__tests__/table-whitelist.test.tsx \
  src/__tests__/connection-overview.test.tsx
```

9 个文件 / 174 条通过。工作区里 `index.ts`、`semantic-layer.ts` 还有这两项之外的未提交改动；表列表的 `physicalNames` 和保存前归一化仍在，上面这轮测试是在这份工作区上跑的。

## 残余，不打回本条

- 删除 Schema 仍按 `schema.` 前缀摘启用项。三段物理名 `database.schema.table` 不会被这个前缀摘掉。Spec 的出口没有这一条。
- 「原先已启用」用原始字符串比较。SQL Server 上，对不上 Manifest 的历史项如果只改了大小写再保存，可能被当成新项拒绝。页面回传的是已存原文。客户现场那种已扫描逻辑名被拒的路径，由 SC-03 盖住。
- 运行中的访问日志页这次没有打开。容器源码里已经有上下文条的格式化函数。

## 不在收口里

客户镜像、Helm、集群上的 SQL Server 查询、补缺失 Manifest、把 `admin` 改成 `lucy_admin`，都不在这两条里。
