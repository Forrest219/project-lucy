# BI / 建模层与外部文档只读导入器 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | BI / 建模层与外部文档只读导入器 Spec |
| 文档类型 / 版本 | Spec（外部资产只读导入）／**v0.1-draft** |
| 日期 / 目标版本 | 2026-11-26／暂不纳入本期（`v0.35.0` 不拉取；常青池 `目标版本 = —`） |
| 功能编号 / 优先级 | **REQ-0114**／**P1（候选借鉴，高风险暂缓）**。**不入核心分母** |
| 台账号 | 无。挂常青需求池 `REQ-0114` |
| 阶段 | S1 |
| 状态 | S1｜v0.1-draft。**风险较大，不纳入本期，暂缓开发**；草案；终稿未确权；未获开发授权；测试台 `not_registered`；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 需求来源 | 对标 [ktx Cloud](https://www.kaelio.com/products/ktx-cloud)「连接 dbt、Looker、Metabase、Notion、Confluence 自动构建上下文」能力，结合 Lucy `vision.md` §1.2「买存储，自建绑定」原则提出 |
| 实施主体 | 待后续排期确定（预计涉及 `webui/server/` 离线导入解析器、Wiki 上传预检联动；不改 KTX 源码） |
| 配对计划 | [lucy-20261126-bi-doc-readonly-importer-plan.md](../plans/lucy-20261126-bi-doc-readonly-importer-plan.md)（暂缓登记版：本期不实施，仅沉淀开工前置与风险边界） |
| 测试台 | `not_registered`（暂缓开发） |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 2026-11-26 初稿落盘。按委托人指示标记「风险较大，不纳入本期，暂缓开发」，仅作方案沉淀与风险边界登记。 |
| v0.1-draft | 2026-11-26 修订：配对计划登记为暂缓登记版 Plan（本期不实施），与 `docs/plans/README.md` 及常青池关联文档对齐。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：治理方可通过只读导入器将外部建模资产（如 dbt `schema.yml`/模型 SQL、存量报表 SQL 包）与外部知识文档（如 Notion/Confluence 导出的 Markdown 归档）解析为 Lucy 的 overlay 草稿与受限 Wiki 草稿，在强制经过权限预检与校验后入库。
- 本条出口：导入解析、冲突去重、外部 Wiki 强制权限预检（默认无角色可见）的本机自动化验证（`SC-01`–`SC-05`）。
- 不在本条出口：在线 OAuth 实时双向同步、Notion/Confluence/Slack 商业 API 轮询守护进程、多租户凭证托管。
- 上线关系：本条收口不表示可上线。

## 风险评估与暂缓理由（为什么不纳入本期）

| 风险类别 | 具体风险描述 | 影响 |
|---|---|---|
| **外部凭证与安全边界扩张** | 若对接外部 SaaS（Notion/Confluence/Metabase）API，需在单实例私有部署中管理外部 Token、处理网络代理与内网穿透，违背 Lucy 当前轻量无外连原则 | 高 |
| **权限模型错配导致知识越权** | 外部文档系统的页面权限无法直接映射为 Lucy 的 `allowed_roles`；若同步后默认全员可见，会引发敏感口径或财务规则越权泄露 | 高 |
| **方言与模型映射维护包袱** | dbt Jinja 宏、LookML/Metabase 专有 JSON 语义复杂且版本迭代快，自研解析器维护成本极高，容易出现静默解析丢字段 | 中高 |
| **与 `vision.md` 边界冲突风险** | 若演变成实时文档同步工具，容易偏离「不做通用知识库搬运」的定位 | 中 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None（沿用「Schema Manifest」「overlay」「业务 Wiki」等既有术语）。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面。本条处于 S1 暂缓草案阶段，当前不改变任何 WebUI 用户可见页面或运行代码；若未来重启，需在升版前补充导入向导与预检交互合同。
- 不改变：现有 WebUI 页面、导航结构、MCP Proxy 问答主路径。

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。4 画像逐行判定；不得写「所有用户」。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 仅可检索手工录入的 Wiki 与语义层 | 导入文档在未完成 `allowed_roles` 授权前对 P1 不可见；授权后可检索到更完整的背景口径 | P1·问数面 ＝／P1·报告面 ＝ | `SC-04`（未授权导入文档默认零角色可见） | — |
| P2 治理方 | **语义口径面**：外部 dbt/BI/文档需手工逐条转录；**权限授权面**：在上传 Wiki 时逐篇设置角色 | **语义口径面**：可批量导入离线包生成草稿减少转录；**权限授权面**：导入外部文档时必须走强制权限预检，不放宽授权门槛 | P2·语义口径面 ↑／P2·权限授权面 ＝ | `SC-01`、`SC-02`、`SC-03`、`SC-04` | — |
| P3 运维方 | **交付运维面**：无外部文档/BI 导入依赖 | **交付运维面**：首期限定为离线文件包导入，不新增外网出站依赖与后台同步进程 | P3·交付运维面 ＝／P3·运行观察面 ＝ | `SC-05`（纯离线包解析，无外部持久化连接） | — |
| P4 管理层 | 已有 BI 投资难以直接复用为 Agent 口径资产 | 理论上可加速历史资产迁移，但需先解决解析保真度问题 | ＝ | 未触碰概览指标与审计口径 | — |

## 第一性原理检查（主路径可用性优先）

| # | 问题 | 回答 |
|---|---|---|
| 1 | 本条生效后，最终用户（含纯 MCP）原先能完成的主任务是否仍能完成？ | 是。纯离线导入仅产出草稿，不修改已有生效配置 |
| 2 | 若增加拒绝／门禁，逃生或钉选路径是否在同一部署实况下可执行且纳入必做 UAT？ | 是。解析失败的外部文件会明确列出跳过原因，治理方仍可走既有手工编辑通道 |
| 3 | 验收是否同时覆盖「约束触发」与「合法路径成交」？ | 是。`SC-04` 验未授权拦截，`SC-02`/`SC-03` 验合法导入成交 |
| 4 | 是否避免把「宿主缺席／凭据缺席」记成用例前置 BLOCKED？ | 是。采用离线文件包输入，不依赖外部在线服务凭据 |

## 1. 设想范围与核心能力

1. **建模层/SQL 离线解析**：支持上传标准 `dbt` `schema.yml` + 静态 SQL 或通用 SQL 集合包，抽取表描述、字段业务注释与常用聚合片段，映射为 overlay 草稿与 `Eval` 候选问句。
2. **外部 Markdown 归档导入**：支持批量导入带前置元数据的 Markdown 文档包，保留原始来源标识（`source_ref`）。
3. **强制权限预检（联动 Spec 193）**：所有外部导入的 Wiki 文档默认不继承公开权限，必须经过 `allowed_roles` 预检确认后才可被 `wiki_search` 检索。

## 核心流程（伪代码）

```text
function importExternalContextBundle(bundleArchive, actor):
  files = extractAndValidateArchive(bundleArchive)      // 限制大小与路径穿越校验
  report = { overlayDrafts: [], wikiDrafts: [], skipped: [] }

  for file in files:
    if file.kind == "dbt_schema_yml":
      drafts = mapDbtModelsToOverlayDrafts(file.content)
      report.overlayDrafts.push(...drafts)
    else if file.kind == "sql_script":
      queryExamples = extractAnnotatedQueries(file.content)
      report.overlayDrafts.push(...toQueryPackDrafts(queryExamples))
    else if file.kind == "markdown_doc":
      // 强制安全默认：未显式声明 allowed_roles 时一律置空数组（仅管理员可见，Agent 不可读）
      normalizedMd = stripUnsafeHtmlAndAttachFrontmatter(file.content, allowed_roles=[])
      report.wikiDrafts.push(normalizedMd)
    else:
      report.skipped.push({ path: file.path, reason: "unsupported_format" })

  stageDraftsForReview(report, actor)
  return report
```

## 验收（SC）

| ID | 合同 |
|---|---|
| SC-01 | 离线导入包含 `dbt` `schema.yml` 的压缩包，能正确提取表/列描述并生成待审 overlay 草稿 |
| SC-02 | 导入带注释的存量 SQL 脚本，能提取合法业务查询样例并关联对应数据源 |
| SC-03 | 导入外部 Markdown 文档时保留正文并正确写入 `source_ref` 元数据 |
| SC-04 | 所有通过外部导入器进入的 Wiki 草稿默认 `allowed_roles: []`，在治理方显式授权前 `wiki_search` 零命中 |
| SC-05 | 遇到非法路径、超大文件或不支持的 Jinja 宏语法时安全跳过并在报告中诚实披露，不破坏现有工作区 |
