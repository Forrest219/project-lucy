# 跑次：2026-11-27 claude STA 收口（GAP-STA-02-DISCOVER 关闭）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-SCHEMA-TABLE-APPEND` |
| 日期／Agent | 2026-11-27／Claude（kscc） |
| 环境 | 隔离栈 `lucy-uat-p19x` 全新重建（`down -v` 后以 `project-lucy:uat-closure` 镜像 up；独立卷）；WebUI `:55186`／MCP `:57891`；`gitSha=8b8fb83c`／dirty（dirty＝docs/plans 计划文档，非产品代码） |
| 判定 | **PASS**（UAT-R0／STA-01–07 全绿，无 GAP） |

## GAP-STA-02-DISCOVER 关闭路径（Plan A 实跑）

套件关闭条件「本实例策略允许 `discover_data` 后复验」按以下方式满足：

1. **根因确认**：demo 模板 `access.yaml` 的 `sensitive_table_prefixes: []` 为空，配合 ACL 的 fail-closed 合同（`hasExplicitAccessToAllSensitiveTables` 要求 `required.length > 0`，见 MCC-04 单测「sensitiveTables 为空＋sensitive_metadata_tools 非空 fail-closed」）＝该类部署上 `discover_data`／`dictionary_search` 结构性拒绝，非环境偶发。
2. **实例策略变更（隔离栈内）**：`sensitive_table_prefixes` 置 `["dataforai.superstore"]`（3 张业务种子表）；探针角色 `uat_closure_probe_role` 以 `names` selector **显式全量授权**这 3 张表＋敏感元数据工具。
3. **复验**：`run-sta.mjs` 全套重跑，`mcp-discover-visible-or-env-gap` 由 env-gap 豁免变为**实跑返回**（`discover_data` 返回 `v_token_income_unified` refs）；`mcp-read-source-visible` 经补授 `uat_sta` schema 的追加表后同样实跑通过。

## 逐用例结果

| ID | 判定 | 关键证据 |
|---|---|---|
| UAT-R0 | PASS | health 200；`gitSha=8b8fb83c`；MCP `:57891` initialize 200 |
| STA-01–STA-07 | 全 PASS | verdict `inbox/uat-p189-90-91-20261126/sta-verdict.json`（执行器复用，`UAT_BASE`/`UAT_CONTAINER` 指向重建栈）；追加落盘/100 表保留/409 与 400·422 归一/三段名遮蔽警告/审计与恢复全绿 |
| STA-02 MCP 面 | PASS（实跑） | `discover_data` 返回新增表 refs（非豁免口径）；`lucy_read_source` 追加表 yaml 返回 |

## 过程注记

- 隔离栈为本轮**全新重建**（原卷夹具随上一轮清理），`run-sta.mjs` 自带 100 表夹具播种，幂等重放成立。
- 探针身份：`uat_probe_closure`／`uat_closure_probe_role`（本轮新建，跑后保留供复跑，栈销毁时随卷清理）。
- 栈镜像构建：`project-lucy:uat-closure`（HEAD `8b8fb83c`，BuildKit cache-from demo；BUILD_REVISION=`8b8fb83c…-dirty`）。

## 边界与结论

- **套件结论：PASS**（R0／STA-01–07 全绿；GAP-STA-02-DISCOVER 关闭）。
- 本跑次为隔离 Docker demo 全真验收；未执行远端 CI、客户实例与其他数据库版本。
- **≠ 功能合同收口；≠ 可上线。**
