# 字段暴露台账落点与 KTX 装载隔离 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 事故修复／优化合同／**v0.1-draft** |
| 日期 / 目标版本 | 2026-11-14／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-26**／REQ-030-047／**P1**（P0-A 伴生事故修复；**不入核心分母**） |
| 状态 | **v0.1-draft；委托人 2026-11-14 授权制定优化 Spec＋登记复测用例**。**尚未终稿确权；尚未开发授权**——未授权前禁止改运行代码。关闭 [`GAP-UAT-P0-A-EXPOSURE`](../governance/e2e-ledger.md)。**≠ 可上线** |
| 决策来源 | Wave B UAT [`2026-11-14-claude-macmini-p0-wave-b`](../qa/uat/suites/semantic-source-field-exposure/runs/2026-11-14-claude-macmini-p0-wave-b.md)：KTX `@kaelio/ktx 0.16.0` 将 `semantic-layer/<conn>/_exposure/<source>.yaml` 当作同名 source overlay 装载 → publish `reindex_failed`；台账期间该连接**全部**查数失败 |
| 父合同 | [P0-A 字段暴露 Spec](lucy-20261107-semantic-source-field-exposure-spec.md)（D3 备选落点；§1.3 未核实项已实测证伪） |
| 授权 | **Spec／复测用例授权已获**。改 `webui/server` 须另发终稿确权＋开发授权 |
| 测试台 | [`UAT-SUITE-FIELD-EXPOSURE`](../qa/uat/suites/semantic-source-field-exposure/suite.md)（复测：`UAT-EXPOSURE-02-R`／`03`／`04`） |

## 闭口层级

- 层级：功能合同（落点／发布路径／KTX 隔离）
- 本条承诺：SC-01–SC-06
- 不在本条出口：改写 P0-A 已收口 SC-01–SC-30 语义；改 KTX 上游源码；列级 ACL／脱敏
- 上线关系：本条收口＋复测 PASS **不**表示可上线

## Terminology Compliance

沿用父 Spec：**字段暴露**／**未暴露字段**／`field_not_exposed`／`field_exposure_unavailable`。本条不新增用户可见术语。

## 1. 问题（实测）

| 项 | 内容 |
|---|---|
| 现象 | `validate` 认 `fieldExposure`；`publish` accepted；reindex **失败**；serving `ledgers={}`；点名未暴露列得不到 `field_not_exposed`，却得 KTX `composeOverlay: … unhandled keys [version, source, excluded_columns, updated_at]` |
| 根因 | KTX 0.16.0 对 `semantic-layer/<conn>/_exposure/<与 enabled table 同名>.yaml` **按 overlay 装载**；台账 YAML 键不被 overlay schema 接受 |
| 附带伤害 | 台账文件在盘期间，该连接**一切** `lucy_query` 同错（含合法 `order_count`） |
| 清理债 | 文档路径「再 publish `excluded_columns: []`」同理 reindex 失败；须走 release restore／删文件＋reindex |

## 2. 决策

| ID | 裁定 |
|---|---|
| D1 | **冻结正式落点**为父 Spec D3 备选：`<contentRoot>/exposure/<conn>/<source>.yaml`（posix：`exposure/<conn>/<source>.yaml`）。**禁止**再把权威台账写到 `semantic-layer/<conn>/_exposure/` |
| D2 | 将 `exposure` 纳入内容根一等目录（扩 `CONTENT_DIR_NAMES`／`resolveContentPaths`／发布扫描根／pending 分类），种类仍为 `fieldExposure`，**不**参与 KTX 上传／不进 `changedSources` 触发的 KTX source validate |
| D3 | 四处路径判定（`semanticKind`／`kindForLogicalPath`／`kindForPendingPath`／`classifyYaml`）与读台账绝对路径（`ledgerAbsolutePath`／`ledgerRelPath`）必须与 D1 同句；Serving／期望集合语义不变 |
| D4 | **迁移**：若磁盘仍有旧 `_exposure/` 台账，发布／启动前须迁到 D1 或删除后再 reindex；禁止新旧双写权威 |
| D5 | 成功 publish trimmed 台账后：① serving 进入 trimmed；② **同连接合法查数不得**因台账出现 `composeOverlay`；③ 点名未暴露列 → `field_not_exposed` 且上游 0 |
| D6 | 清理／恢复全暴露：publish `excluded_columns: []` **或**显式恢复路径须 **reindex ok** 且数据面恢复；不得依赖 `docker restart` |

## 3. 验收（实现后）

| ID | 断言 |
|---|---|
| SC-01 | 新台账只写 `exposure/<conn>/<source>.yaml`；仓库／运行代码无「权威写 `_exposure`」路径 |
| SC-02 | `POST …/validate`＋`publish` 含 trimmed 台账 → 批次 **reindex ok**；`activation` 确认；serving 含该 Source ledger |
| SC-03 | publish 成功后同连接 `lucy_query` 合法 `order_count`＋`active_rows` **成功**（无 `composeOverlay`） |
| SC-04 | 点名未暴露物理列 → `field_not_exposed`；上游执行 0（对齐父 Spec SC-04） |
| SC-05 | publish cleanup（`excluded_columns: []`）或等价恢复 → reindex ok；其后该列可查或按 full_expose／unconfigured 合同 |
| SC-06 | 单测／门禁：KTX 上传文件列表**不含** `exposure/**`；误放 `semantic-layer/**/_exposure/**` 不得再被当作权威台账激活 |

## 4. 复测挂钩（测试台）

实现落地并获 UAT 执行授权后，必跑：

| Case | 套件 | 目的 |
|---|---|---|
| `UAT-EXPOSURE-02-R` | FIELD-EXPOSURE | 关闭 Wave B BLOCKED：trimmed → `field_not_exposed` |
| `UAT-EXPOSURE-03` | 同上 | 台账生效期间合法查数不挂连接 |
| `UAT-EXPOSURE-04` | 同上 | cleanup／恢复路径可 publish＋reindex |

用例正文见 [`cases.md`](../qa/uat/suites/semantic-source-field-exposure/cases.md)。

## 5. 非目标

- 不修改 `@kaelio/ktx` 源码（D16 父合同）
- 不重新打开 P0-A 全部分母；本条只修落点／隔离
- 本 Spec 单独不构成开发授权
