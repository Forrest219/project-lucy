# row-policy-e2e 行权限真实审判包

| 元数据 | 内容 |
|---|---|
| 文档名称 | row-policy-e2e 审判包说明 |
| 文档类型 | Checklist |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-04 |

强度 B 行权限真实 e2e 夹具。数据面绑阿里云 RDS 只读连接 `mysql-aliyun`／`dataforai.superstore_*`。本包 **不是** 客户交付模板。

一推一同步约定：`run.db.dataPlane=rds-mysql-readonly`；多环境共用同一 RDS 事实源，本机 demo Docker 不另起合成库当真源。

## 边界（硬）

- **数据面只读**：账号 `cw_rds_bot` 仅 `SELECT`／`SHOW`。禁止对本 RDS 建表、改行或写入任何种子。本包不提供写库入口，也不接受把合成库当作主数据面。
- **区划字面量**：谓词与断言只用中文区划 **华东**／**西南**。废除 security-e2e 里的英文区划旧字面量；Role／Agent 名可保留 east／west 语义（east＝华东臂，west＝西南臂）。
- **并集载体**：Agent `ag_east_west` 持有两个 Role（`rp_east` + `rp_west`）。禁止单 Role 双 tableSelector 拼并集。
- **与 `examples/security-e2e` 分工**：security 包继续服务非行权限 SEC；本包是 `ROW25`／`RTP`／`RTV` 与 Security BY 旁路的主证据源。旧合成库与旧 typed gold 不得直接当作本包 RDS 基线。
- **证据边界**：Strength B／SEC-11 一推一证据只认本包（`--pack row-policy` + `dataPlane=rds-mysql-readonly`）。`examples/security-e2e` 的 `fin-db` 合成面不得冒充本证据。
- **双包**：默认 prepare 仍是 `security`；行权限真实审判必须显式 `--pack row-policy` 或 `run-row-policy-b`。

## 夹具要点

| 项 | 值 |
|---|---|
| 连接 | 仅 `mysql-aliyun`（禁止第二 MySQL connectionId） |
| 主机默认 | `rm-bp1q2ui29c6268t8wro.mysql.rds.aliyuncs.com:3306` |
| 读者角色默认 | `cw_rds_bot`；密码只走 prepare 注入的 Secret 文件 |
| 真相表 | `dataforai.superstore_orders`（行字段 `region`，值 华东／西南） |
| 启用但不授权给受限 Role | `dataforai.superstore_returns` |
| 模板 | `tpl_eq_east`（华东）、`tpl_in_regions`（华东∪西南，值序打乱）；另有未知字段／度量／非法 op 各一条坏模板 |
| Role | `rp_east`（模板）、`rp_west`（西南内联）、`rp_all`、`rp_east_plus_inline` |
| Agent | `ag_east`、`ag_east_west`、`ag_all`、`ag_east_constrained` |

Token 明文只落 runDir secrets（0600）；仓库模板只有 `TOKEN_HASH_*` 占位。

## 使用

入口（Task 4 落地后）：

```bash
node scripts/e2e/run-row-policy-b.mjs
node scripts/e2e/run-row-policy-b.mjs --run inbox/e2e/<runId>/run.json --execute
```

默认（无 `--execute`）为编排骨架：prepare `--pack row-policy`，写入 Gate-Off／Gate-On 计划与 `not_run` 占位，打印 management／security 跟进命令；**exit 3**（dry-run），不宣称 B 通过。

加 `--execute` 才会在每个 proven 切换后 spawn `run-management.mjs` 与 `run-security.mjs`；management 或 security 子进程非零退出、或任一注册 id 未绿，该阶段均不算通过。**仅当两阶段均绿时 exit 0**，否则 **exit 1**。

prepare 单独渲染（Task 3）：

```bash
node scripts/e2e/prepare-environment.mjs --mode local --pack row-policy --run-id local-row-policy-smoke
```

默认占位：`DB_HOST` 如上、`DB_PORT=3306`、`DB_READER_ROLE=cw_rds_bot`、`DB_PASSWORD_FILE` 指向 runDir secrets。禁止把密码写进本包 YAML、日志或证据。
