# SQL Server 逻辑名与物理名实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | v1.0 / 2026-10-30 |
| 主 Spec | [SQL Server 逻辑名与物理名](../specs/lucy-20261030-sqlserver-table-identity-spec.md)（v1.0） |
| 状态 | **v1.0 功能合同已收口（2026-10-31）** |
| 授权边界 | 用户于 2026-10-30 授权在本分支评估并落地修复。2026-10-31 授权审阅并收口功能合同。不授权客户出包，不改 KTX，不在启动时改写 `ktx.yaml` |
| 验收 | SC-01–SC-11 已由保存接口、身份归一化、迁移、语义索引、启用表范围和角色预检测试关闭。记录见 [审阅](../reviews/2026-10-31-audit-context-bar-and-sqlserver-identity-closure.md) |
| 已拍板决策 | D1–D9，见 Spec §2 |

## 1. 目标

让 SQL Server 的逻辑表名和 Manifest 物理名指向同一行，保存进 `enabled_tables` 的值是 Manifest `table:`。MySQL、PostgreSQL、StarRocks 的两段名行为保持原样。

## 2. 开工前置

D1–D9 已按客户说明和当前代码核对后冻结。无未决阻塞项。不另派 L25 编号。

客户补丁是按旧的 `webui/server/index.ts` 写的。本分支的校验已经抽到 `webui/server/enabled-tables.ts`，所以按 Spec 重做，不直接 `git apply`。

## 3. 文件落点

| 路径 | 改动 |
|---|---|
| `webui/src/lib/enabled-table-identity.ts` | 归一化、匹配、Schema 计数 |
| `webui/server/enabled-tables.ts` | 目录扫描、两段/三段校验、迁移 |
| `webui/server/index.ts` | 表列表返回 `physicalNames`；保存前归一化 |
| `webui/server/ops/ops-ktx-batch.ts` | 控制面保存走同一套归一化 |
| `webui/server/semantic-identity.ts` | 保留三段物理名 |
| `webui/server/semantic-layer.ts` | `enabled` 同时认逻辑名和物理名 |
| `webui/server/project.ts` | 三段名不再把数据库段推断成 Schema |
| `webui/src/pages/connections/TableWhitelist.tsx` | 一行展示，保存物理名 |
| `webui/src/pages/connections/ConnectionOverview.tsx` | 已启用计数认别名 |
| `webui/server/access-role-precheck.ts` | 只报告对不上的角色 id |
| `webui/scripts/normalize-enabled-tables.ts` | dry-run / `--apply` / `--strict` |

没有新增 npm script 或 CI job。操作命令是：

```bash
cd webui && npx tsx scripts/normalize-enabled-tables.ts --project <项目根>
cd webui && npx tsx scripts/normalize-enabled-tables.ts --project <项目根> --apply
```

## 4. 验收

按 Spec §5 的 SC-01–SC-11。

```bash
cd webui && npx vitest run \
  server/__tests__/enabled-table-identity.test.ts \
  server/__tests__/api.save.test.ts \
  server/__tests__/access-role-precheck.test.ts \
  server/__tests__/semantic-batch-identity.test.ts \
  src/__tests__/table-whitelist.test.tsx \
  src/__tests__/connection-overview.test.tsx
```

## 5. 完成定义

- 三段物理名可以保存，逻辑名会收成 Manifest 物理名。
- 启用表范围不再把同一张表画成两行。
- 迁移可预览、可备份、可重复执行，且不删除无法映射的项。
- `npm run lint:spec-docs` 对这两份新文档没有形态违规。

## 6. 风险

- 大小写不敏感只作用于 `driver: sqlserver`。驱动写错时，别名不会折叠。
- 末段相同的两段名和三段名不会自动合并。现场那种 `bidm.dbo.*` 与 `dbo.*` 并存、而 Manifest 只写了其中一个的情况，多出来的那条仍要人工确认后再从「无效启用」移出。
- `--apply` 会改运行中的 `ktx.yaml`。执行前应让实例停止写入；脚本会先复制备份。
- 角色预检发现 `admin` 时不会改成 `lucy_admin`。那是授权变更，要在访问权限里单独处理。
