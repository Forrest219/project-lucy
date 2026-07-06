# StarRocks R1 P1 Support Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | StarRocks R1 P1 Support Plan |
| 文档类型 | Design / Support Scope |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-03 |
| 适用范围 | StarRocks 作为 Lucy R1 受控只读 OLAP 目标源的 P1 支持边界、证据路径与发布限制 |

## 1. 支持定位

StarRocks 进入 Lucy R1 P1，定位为 gated support，不是默认 R1 发布硬门禁。

本阶段目标是让 Lucy 能表达、展示和验证 StarRocks 作为只读 OLAP target source 的配置与证据路径。未接入真实 StarRocks 集群前，不得把 StarRocks 写入 release verified matrix，也不得对客户承诺 release-verified support。

推荐产品表述：

> StarRocks is supported as a gated R1 P1 read-only OLAP target through the MySQL wire protocol, pending live certification evidence.

## 2. 本期支持范围

包含：

- `ktx.yaml` 可配置 `starrocks-r1`，使用 MySQL wire protocol。
- WebUI/project model 可识别 `engine: starrocks`、`wire_protocol: mysql`、`readonly: true`、`r1_target: true`。
- R1 evidence 采用 StarRocks 独立 evidence 文件，并复用 OLAP target smoke/validation 规则。
- `r1:status`、readiness 和 release bundle 可以在显式 StarRocks target 下检查 StarRocks evidence。
- 默认 Doris R1 发布路径保持兼容；缺少 StarRocks evidence 不影响默认 Doris strict gate。

不包含：

- 真实 StarRocks 集群接入或生产认证。
- 把 StarRocks 加入默认 R1 发布硬门禁。
- StarRocks DDL/DML、load job、admin API、HTTP SQL API、resource group、warehouse 或 optimizer hint 支持。
- 跨数据源 Join、列级/行级权限、动态 masking。
- 对 StarRocks 全版本兼容性的保证。

## 3. 配置约定

`starrocks-r1` 示例连接必须使用显式 R1 target 标记：

```yaml
connections:
  starrocks-r1:
    driver: mysql
    engine: starrocks
    wire_protocol: mysql
    readonly: true
    r1_target: true
    enabled_tables:
      - <schema>.<table_or_view>
```

`engine: starrocks` 只说明数据库引擎类型；是否进入 R1 发布 target 由 `r1_target: true` 显式控制。

## 4. Evidence 约定

StarRocks 使用独立 evidence 文件，不复用 Doris evidence 文件：

- 环境变量：`LUCY_R1_STARROCKS_EVIDENCE`
- 默认输出：`inbox/starrocks-r1-evidence.json`
- certification summary：`inbox/starrocks-r1-certification-summary.json`
- engine：`starrocks`
- wireProtocol：`mysql`

Doris evidence 继续使用：

- 环境变量：`LUCY_R1_DORIS_EVIDENCE`
- 默认输出：`inbox/doris-r1-evidence.json`

两个 target 共享同一组 OLAP smoke checks：

- `connection`
- `readonlySelect`
- `ddlDmlRejected`
- `limitPagination`
- `typeMapping`
- `timeoutClassification`
- `errorTaxonomy`
- `lucyMetadata`

StarRocks live certification 的聚合入口是：

```bash
node scripts/p1-starrocks-certification.mjs
```

该脚本只封装判定流程，不把 StarRocks 提升为 verified；主控 npm script `npm run smoke:p1:starrocks-certification` 仅作为统一 gate 入口。流程顺序为：

1. precheck：确认 `ktx.yaml` 内显式 StarRocks R1 target、Lucy MCP Proxy URL/token、StarRocks live evidence 输入、只读账号人工确认、MCP negative samples 与 Hermes report 均存在。
2. 执行 `npm run r1:starrocks-smoke -- ...` 生成 StarRocks vertical slice evidence。
3. 执行 `npm run r1:mcp-contract -- ...` 生成匹配 StarRocks target 的 MCP contract evidence。
4. 执行 `npm run r1:readiness:strict -- --target starrocks` 做最终结构化判定。

缺少真实环境或 evidence 输入时，脚本必须写出 `status: "blocked"` 到 `inbox/starrocks-r1-certification-summary.json`，并跳过 live 命令执行；这类 blocked evidence 只说明不可判定，不得被解释为 StarRocks 已通过认证。

## 5. 发布限制

默认 R1 发布仍以 Doris target 为准。只有显式选择 StarRocks target，并提供通过校验的 `LUCY_R1_STARROCKS_EVIDENCE`、匹配的 MCP contract evidence、Hermes report、observability snapshot 和 local config 时，release bundle 才能把 StarRocks 标记为 ready for human approval。

在 live certification evidence 产生前：

- 客户文档只能写 pending live certification。
- release metadata 不得把 StarRocks 列为 verified database。
- `docs/user-guide/data-sources.html` 可列为 P1 gated support，但不得写完整测试覆盖。

## 6. 验收标准

本期完成标准：

- `ktx.yaml.example` 有不含凭据的 StarRocks target 示例。
- Project API 和 Connection Overview 能展示 StarRocks target metadata。
- StarRocks evidence fixture 可以通过共享 OLAP validator。
- Doris R1 smoke/readiness/release bundle/status 测试保持通过。
- 默认 strict readiness 不要求 StarRocks evidence。
