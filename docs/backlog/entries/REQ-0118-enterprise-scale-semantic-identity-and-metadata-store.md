# REQ-0118：大型企业中台语义定位与元数据存储架构演进（10+ 库 / 100+ Schema / 5000 表，暂缓开发）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 常青需求池单条正文（一需一档）。**不是**功能 Spec，**不构成**开发授权 |
| 稳定 ID | `REQ-0118` |
| 类型 | `需求`（架构演进 / 中长期） |
| 优先级 | `P1`（可变属性：`P0`／`P1`／`P2`） |
| 阶段 | `S1`（**暂缓开发**；重启须重新走需求澄清 → 独立 Spec → 配对 Plan → 终稿确权 → 委托人另发开发授权） |
| 目标版本 | `—`（暂不排期、暂不开发） |
| 授权边界 | **入池 ≠ 立项 ≠ 终稿确权 ≠ 开发授权**。本条目仅作中长期架构演进方向登记，未经委托人另行授权不得修改运行代码 |

## 来源与背景

- 提出日期 / 来源：2026-11-26 / 客户现场 `dw_procurement_pr_detail` 与 `v_token_income_unified` 两起 per-table standalone 遮蔽 `_schema` 事故复盘后，委托人对「10+ 数据库 / 100+ Schema / 5000 表」大型企业数据中台架构能力的专项评估。
- 现状与结构性瓶颈：
  1. **命名空间层级错配**：物理数仓天然为 4 层（`connection → catalog/db → schema → table`），而现行 Manifest 文件（`_schema/<schema>.yaml`）与 per-table overlay（`semantic-layer/<conn>/<sourceName>.yaml`）为两层扁平布局，同连接内 `sourceName` 靠 `<schema>_<table>` / `_2` 后缀避名（P1-64），在 100+ Schema / 5000 表分层数仓中易退化且依赖上传先后顺序。
  2. **双事实源并存与双解析器分裂**：`_schema/` Manifest 与 per-table standalone 文件共享目录，仅靠是否含 `table:`/`sql:` 隐式区分语义；P1-91 与 OQ-3 通过写前 409 门禁、清理 API 与 `explain_query` 冲突检测做防呆，但尚未从存储与编译架构上消除双份定义。
  3. **缺少不可变逻辑主键**：`access.yaml`、`ktx.yaml`、口径绑定与审计直接字符串引用 `sourceName` / `physicalTable`，表迁库、换 Schema 或分层重构时极易断链。
  4. **单机大 YAML 与全局串行锁天花板**：单 Schema 挤在一份大 YAML 中、所有写路径共用进程内 `withKtxYamlWriteLock` + `withPublishCoordinator`（单实例单副本边界），且全量扫盘与权限编译在 5000 表 / 200+ 角色规模下存在明显的 V8 内存与事件循环压力，无法支撑多域治理团队并发发布与水平扩展。

## 期望方向（非实现承诺）

1. **身份与展示解耦**：引入不可变逻辑主键（如内部 `tableId` 或完整四段 URN `conn/catalog/schema/table`）作为权限、白名单、口径绑定与审计的唯一事实锚点；`sourceName` 退化为可变的展示与查询别名，彻底区分 `catalog/db` 与 `schema`。
2. **元数据入库与细粒度事务**：将语义层定义、启用表白名单与角色权限从「大 YAML 文件 + 进程内全局锁」逐步迁移至关系型元数据存储（PostgreSQL / SQLite），支持按表/按业务域的细粒度锁、版本控制与多副本协同；YAML 退化为 GitOps 导出/同步投影。
3. **消除双解析器与隐式覆写**：业务口径（`grain` / `measures` / `segments`）与物理元数据（`table` / `columns`）在存储上严格分离，由单一编译产物同时供给 ACL、`lucy_explain_query` 与查询执行引擎，从架构上杜绝业务层覆写物理表名。

## 非目标与边界

- **暂缓开发 / 暂不开发**：本条目当前仅入池沉淀方向，不立项、不开 Spec、不修改任何运行代码或存储结构。
- 短期止血项（P1-64、P1-89/90/91、`lucy_explain_query` OQ-3 冲突告警与 `listSourcesWithManifests` 按连接 `readdir` 优化）已在现行 `0.35` 线独立推进，不在本条目范围。

## 关联

- 常青需求池：[docs/backlog/README.md](../README.md)
- 前序相关 Spec：[P1-64 短名唯一性](../../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md) · [P1-90 按表追加](../../specs/lucy-20261125-schema-manifest-table-append-spec.md) · [P1-91 overlay 发布护栏](../../specs/lucy-20261125-overlay-publish-guard-spec.md)
- 现行规模基线：[docs/qa/uat/scale-baseline.md](../../qa/uat/scale-baseline.md)
