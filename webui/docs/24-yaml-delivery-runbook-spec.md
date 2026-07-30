# YAML Delivery Runbook And Self-Check Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | YAML Delivery Runbook And Self-Check Spec |
| 文档类型 | Product / Docs / Operations / Agent Governance Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-30 |
| 适用范围 | Lucy Help Center 系统手册、语义层 YAML 交付、Catalog 上传/发布验收、Agent 自检协议 |
| 架构决议 | 将 YAML 文件用途、规范、常见错误和 GO/NO-GO checklist 内置进系统手册；把人工配置、自助运维和 Agent 检查统一到同一套可执行 runbook |
| 事实源 | `docs/SYSTEM_HANDBOOK.md`、`semantic-layer/**/*.yaml`、`ktx.yaml`、`webui/config/access.yaml`、`evals/**/*.yaml`、`wiki/**/*.md` |
| 关联文档 | `docs/design-system-handbook-help.md`、`webui/docs/17-static-catalog-loading-spec.md`、`webui/docs/21-connection-catalog-upload-ux-spec.md`、`webui/docs/23-semantic-asset-publish-export-spec.md`、`webui/docs/03-api-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 决策摘要

近期出现过一次 YAML 交付事故：分析师上传的语义 YAML 文件结构不符合 KTX/Lucy 的 manifest / overlay 合并模型，导致 MCP 侧无法提供正确问答。事故表面上是 YAML 文件问题，本质是缺少面向配置人员和 Agent 的交付级 runbook。

当前系统手册已经说明了 `ktx.yaml`、`semantic-layer/`、`wiki/`、`evals/` 和 `access.yaml` 的基本职责，也包含基础 `ktx sl validate` / `ktx sl read` / `ktx admin reindex` 命令。但它尚未把“哪些 YAML 能上传、应该放哪、哪些字段是硬错误、怎样判断 GO/NO-GO”写成可执行标准。

本规格做出以下决议：

1. Help Center 的系统手册必须新增“YAML 文件规范与交付验收”章节。
2. 手册必须同时服务三类读者：人工配置人员、运维人员、Claude Code / Codex 等 Agent 检查者。
3. YAML 交付必须区分“补已有 manifest source 的 overlay”和“新建 semantic source”两种语义；默认客户交付场景优先判定为前者。
4. `reindex` 成功、单个新 source `sl validate` 成功，都不能单独作为可交付依据。
5. 手册必须提供固定 GO/NO-GO checklist，要求检查文件路径、source 合并结果、真实查询、ACL 可见性和 MCP 问答 smoke。

## 2. 目标与非目标

### 2.1 目标

| 目标 | 说明 |
|---|---|
| 人工可自检 | 分析师上传或提交 YAML 前，可以按清单自行判断是否可交付 |
| Agent 可复核 | Claude Code / Codex 可读取手册并按协议输出 GO / NO-GO 评估 |
| 运维可排障 | MCP 问答异常时，运维能定位是 YAML 结构、索引、ACL 还是查询层问题 |
| 规范可长期演进 | 新增 YAML 类型或 KTX loader 行为变化时，有明确章节承接 |
| 与 Help Center 一体化 | 规范落在 `docs/SYSTEM_HANDBOOK.md`，通过 `/help` 暴露，不进入 `wiki/` 和 MCP 业务语料 |

### 2.2 非目标

| 非目标 | 理由 |
|---|---|
| 本规格不直接实现上传拦截器 | M20 首要目标是文档与自检标准；运行时代码校验可作为 P1 |
| 不把开发规则写进 `CLAUDE.md` | 开发治理由 `AGENTS.md` / `docs/DEVELOPMENT.md` 承载 |
| 不把 YAML 运维 runbook 写进 `webui/config/data-qa-instructions.md` | 该文件是数据问答 runtime instructions，不能混入配置交付规则正文 |
| 不要求 Agent 自动修改客户 YAML | Agent 可检查并给修复建议；是否落盘仍由用户确认 |

## 3. YAML 类型总览

手册新增章节必须包含下表，并以此作为后续规则的索引。

| 类型 | 路径 | 用途 | 维护者 | 是否适合手工上传 |
|---|---|---|---|---|
| KTX 项目配置 | `ktx.yaml` | 数据库连接、schema、`enabled_tables`、storage | 运维 / 管理员 | 谨慎，必须 dry-run diff |
| Schema manifest | `semantic-layer/<conn>/_schema/<schema>.yaml` | 物理表、物理列、nullable、数据库/AI 描述 | KTX 扫描或受控上传 | 可以，但必须是 manifest 形态 |
| Manifest augmentation overlay | `semantic-layer/<conn>/<source>.yaml` | 给已有 manifest source 补 grain、measures、segments、joins、派生列 | 分析师 / 语义 Owner | 可以，是客户业务语义高频交付形态 |
| New semantic source | `semantic-layer/<conn>/<source>.yaml` | 新建一个独立 semantic source | 高级用户 / 平台维护者 | 谨慎，必须同步 ACL 和问答口径 |
| Wiki frontmatter | `wiki/**/*.md` | 业务文档与语义对象引用 | 业务 / 数据维护者 | 可以，通过 Wiki 编辑器优先 |
| Eval cases | `evals/<domain>/eval/*-eval-cases.yaml` | 问答质量回归用例 | 测试 / 数据维护者 | 可以，但必须跑 Eval |
| Access config | `webui/config/access.yaml` | Role、Agent、Token hash、ACL | 管理员 | 谨慎，必须确认权限快照 |

## 4. 语义层 YAML 分型

### 4.1 Schema Manifest

目标路径：

```text
semantic-layer/<connection>/_schema/<schema>.yaml
```

典型形态：

```yaml
tables:
  ai_metric_international_country_daily:
    table: chatbi.ai_metric_international_country_daily
    columns:
      - name: date
        type: time
        nullable: false
        descriptions:
          db: 日期
          human: 业务日期
```

硬规则：

| 规则 | 结果 |
|---|---|
| 顶层必须是 `tables:` mapping | 否则不是 manifest |
| 物理列用复数 `descriptions:` | 列级单数 `description:` 是高风险错误 |
| manifest 描述可以有 `db`、`ai`、`human` | 人工补充优先写 `human` |
| 不在 manifest 里写派生列 `expr` | 派生列属于 overlay |
| 不手改真实物理列结构 | 物理列变化应重新扫描或受控上传 manifest |

### 4.2 Manifest Augmentation Overlay

这是本次事故最关键的类型：给已经存在的 manifest source 增加业务语义。

目标路径：

```text
semantic-layer/<connection>/<manifest-source-name>.yaml
```

正确形态：

```yaml
name: ai_metric_international_country_daily

grain:
  - date

measures:
  - name: dau
    expr: sum(dau)
    description: 国际化日活跃用户数。

segments:
  - name: valid_dau_rows
    expr: dau is not null
    description: DAU 有效行。
```

硬规则：

| 规则 | 说明 |
|---|---|
| 文件名必须等于 manifest source name | `ai_metric_international_country_daily.yaml` 对应 manifest 里的 `ai_metric_international_country_daily` |
| 顶层 `name` 必须等于 manifest source name | 否则会变成另一个 source 或无法合并到预期对象 |
| 默认不写 `table:` | 给已有 source 做 overlay 时，`table:` 会把语义推向“新建 source”语义，容易产生重复 source |
| 默认不重复声明物理 `columns:` | 已有物理列来自 manifest；重复声明会造成字段缺失或 unknown column |
| 只在派生列场景写 `columns[].expr` | 派生列必须有 `expr`，并且不得与 manifest 物理列重名 |
| 修改已有物理列描述用约定补丁字段 | 不用伪造物理列替代 manifest |
| `measures[].description` 与 `segments[].description` 合法 | measure / segment 描述可以用单数 `description` |

### 4.3 New Semantic Source

新建 semantic source 是高级操作，不等同于给已有 source 增强。

典型形态：

```yaml
name: international_country_metrics
table: chatbi.ai_metric_international_country_daily
grain:
  - date
measures:
  - name: dau
    expr: sum(dau)
```

适用条件：

| 条件 | 要求 |
|---|---|
| 确实需要对同一物理表暴露另一个业务 source | 必须写明理由 |
| ACL 已同步授权新 source | `access.yaml` role 的 `tableSelectors` 必须覆盖 |
| Agent 选源口径已更新 | Wiki / Eval / 手册 smoke 要说明何时使用新 source |
| `sl read` 和真实查询均通过 | 不能只看 `reindex` 成功 |

默认策略：客户交付包中出现“source name 与物理表 basename 不一致、但目标业务口径是给已有表补指标”的情况，必须先判定为可疑，输出 NO-GO。

## 5. 交付前 GO / NO-GO Checklist

### 5.1 静态文件检查

| 检查项 | GO 条件 |
|---|---|
| 路径 | manifest 在 `_schema/`；overlay 在 `semantic-layer/<conn>/` |
| 文件名 | augmentation overlay 文件名等于 manifest source name |
| 顶层 name | augmentation overlay `name` 等于 manifest source name |
| 顶层 table | augmentation overlay 默认没有 `table:` |
| columns | augmentation overlay 默认不重复声明物理 `columns:` |
| 描述字段 | 物理 source/column 用 `descriptions.*`，禁止物理列单数 `description:` |
| 表达式引用 | measure / segment / join 引用的列必须来自 manifest 或派生列 |
| 残留文件 | 不存在意外新增 source 文件，例如旧名 `international_*.yaml` |

### 5.2 KTX 合并与索引检查

必须在与客户镜像一致的 KTX/Lucy 版本中执行。

```bash
ktx --project-dir /data/lucy admin reindex --force
ktx --project-dir /data/lucy sl validate <source-name> --connection-id <conn>
ktx --project-dir /data/lucy sl read <source-name> --connection-id <conn>
```

GO 条件：

| 检查项 | GO 条件 |
|---|---|
| `admin reindex --force` | 不能出现异常新增 source 数量 |
| `sl validate` | 每个目标 manifest source 返回合法 |
| `sl read` | 能看到完整物理列，也能看到新增 measures / segments |
| 合并结果 | 新增业务指标合并在原 source 下，而不是生成另一个 source |
| 错误文本 | 不出现 `unknown column`、`Unrecognized key: "description"` |

### 5.3 查询与 MCP Smoke

至少执行一条真实语义查询：

```bash
ktx --project-dir /data/lucy sl --connection-id <conn> query \
  --measure <source>.<measure> \
  --dimension <source>.<dimension> \
  --limit 5 \
  --execute \
  --max-rows 5
```

然后执行 MCP / OpenClaw 问答 smoke：

```text
Lucy 能读取什么数据？
<指定日期> <业务核心指标> 是多少？
<指定日期> 按平台拆分的 <业务核心指标> 是多少？
```

GO 条件：

| 检查项 | GO 条件 |
|---|---|
| 语义查询 | 返回数据且字段口径符合预期 |
| ACL | Agent token 对目标 source 有权限；没有 `table_forbidden` |
| Catalog | `lucy_catalog` / `sl read` 能看到目标 source 与 measure |
| 问答 | Agent 使用正确 source，回答不报 metadata / unknown column 错 |

## 6. 常见错误与诊断

| 症状 | 高概率原因 | 处理 |
|---|---|---|
| `segment references unknown column(s): dau` | overlay 重复声明了不完整 `columns:`，使物理列集合不完整 | 删除重复物理 `columns:`；只保留 measures / segments / grain |
| `Unrecognized key: "description"` | 物理列使用了单数 `description:` | 改为 `descriptions.human` 或合法作者桶 |
| `reindex scanned` 数量异常增加 | 交付包新增了意外 source | 检查 overlay 文件名和 `name` 是否与 manifest source 同名 |
| 原 source `measures: []` | 新指标写进了另一个 source | 改 overlay 文件名和 `name`，删除错误 `table:` |
| MCP `table_forbidden:<source>` | 新 source 未进入 role ACL | 优先确认是否不该新增 source；若确实新增，则同步 `access.yaml` |
| Agent 选到错误 source | 同一物理表出现多个业务 source 且口径不清 | 合并到原 source 或补 Wiki / Eval / ACL 指导 |
| `MANIFEST_PARSE_FAILED` | YAML 语法或 manifest shape 错误 | 先修 YAML parse，再做 KTX validate |

## 7. Agent 自检协议

Claude Code、Codex 或其它 Agent 在检查 YAML 交付包时，必须按以下顺序执行，不得只凭单个 `validate` 结论给 GO。

输入：

| 输入 | 必需 |
|---|---|
| 待交付文件列表与内容 | 是 |
| 目标项目根或 staging 根 | 是 |
| 目标 connection id | 是 |
| 目标 manifest `_schema/*.yaml` | 是 |
| 当前 `access.yaml` 或目标 Agent role | 建议 |
| 业务 smoke 问题 | 建议 |

输出格式：

````markdown
## 结论
GO / NO-GO

## 阻断项
- [P0] ...

## 风险项
- [P1] ...

## 文件级检查
| 文件 | 类型 | 结论 | 理由 |

## 必须修改
1. ...

## 验收命令
```bash
...
```

## GO 门槛
- [ ] ...
````

Agent 必须检查：

1. 文件路径是否符合类型。
2. manifest source 是否存在。
3. overlay 文件名和 `name` 是否匹配 manifest source。
4. augmentation overlay 是否错误携带 `table:`。
5. augmentation overlay 是否重复声明物理 `columns:`。
6. measure / segment / join 引用字段是否可从 manifest 或派生列解析。
7. 描述字段是否符合 `descriptions.human` / `description` 分层。
8. `sl validate`、`sl read`、真实 query、MCP smoke 是否全部通过。
9. 若新增 source，ACL、Wiki、Eval 是否同步。

## 8. Help Center 信息架构要求

`docs/SYSTEM_HANDBOOK.md` 需要新增或扩展以下小节：

```text
3.7 YAML 文件规范与交付验收
  3.7.1 YAML 类型总览
  3.7.2 Schema manifest 规范
  3.7.3 Manifest augmentation overlay 规范
  3.7.4 New semantic source 规范
  3.7.5 描述字段规范
  3.7.6 GO / NO-GO 交付 checklist
  3.7.7 常见错误与修复
  3.7.8 Agent 自检协议
```

同时更新：

- 顶部目录。
- `6.1 为什么提示“未发现本地 manifest”？` 增补“reindex 成功不代表 overlay 合并正确”。
- `6.7 为什么白名单表保存失败？` 增补 ACL/source 新增风险。
- `6.9 最小健康检查清单` 增补 `sl read`、真实 query、MCP smoke。

## 9. 与上传/发布功能的关系

本规格不要求 M20 立即实现运行时拦截，但 M17/M19 相关上传/发布能力后续应引用本规格：

| 能力 | M20 要求 |
|---|---|
| Catalog manifest 上传 | 上传前提示 manifest shape 与 `descriptions:` 规则 |
| Semantic asset publish | Validate gate 需要区分 augmentation overlay 与 new semantic source |
| Diff 预览 | 对疑似错误 `table:`、重复物理 `columns:`、source 名不匹配给出 warning |
| Release history | 记录 GO/NO-GO checklist 摘要，不保存 YAML 正文 |
| Help contextual link | 上传和发布页面应链接到 `/help?section=yaml-delivery-runbook` |

## 10. 验收标准

M20 完成时必须满足：

- 系统手册含完整 YAML 类型、规范、错误表和交付 checklist。
- Help API 返回 TOC 中包含稳定 `yaml-delivery-runbook` section id。
- 文档明确说明 `reindex` 成功不是交付成功。
- 文档明确说明 augmentation overlay 文件名/name/table/columns 的硬规则。
- 文档包含 Agent 自检协议和标准 GO/NO-GO 输出模板。
- 文档不包含真实 host、username、password、token 或客户敏感值。
- `npm test -- help` 通过。
- `npm run build` 通过。
