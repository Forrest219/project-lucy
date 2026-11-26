# 基于审计与 Schema 的候选口径自动草稿化 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 基于审计与 Schema 的候选口径自动草稿化 Spec |
| 文档类型 / 版本 | Spec（治理辅助与语义层草稿化）／**v0.1-draft** |
| 日期 / 目标版本 | 2026-11-26／暂不纳入本期（`v0.35.0` 不拉取；常青池 `目标版本 = —`） |
| 功能编号 / 优先级 | **REQ-0113**／**P0（候选借鉴，高风险暂缓）**。**不入核心分母** |
| 台账号 | 无。挂常青需求池 `REQ-0113` |
| 阶段 | S1 |
| 状态 | S1｜v0.1-draft。**风险较大，不纳入本期，暂缓开发**；草案；终稿未确权；未获开发授权；测试台 `not_registered`；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 需求来源 | 对标 [ktx Cloud](https://www.kaelio.com/products/ktx-cloud)「从团队查询持续学习并生成 Pending 指标定义」能力，结合 Lucy 现有 `.ktx-ui/audit.sqlite` 审计流水与 `_schema/` manifest 资产提出 |
| 实施主体 | 待后续排期确定（预计涉及 `webui/server/` 离线分析模块、`/review` 候选队列；不改 KTX 源码） |
| 配对计划 | [lucy-20261126-audit-schema-auto-caliber-draft-plan.md](../plans/lucy-20261126-audit-schema-auto-caliber-draft-plan.md)（暂缓登记版：本期不实施，仅沉淀开工前置与风险边界） |
| 测试台 | `not_registered`（暂缓开发） |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 2026-11-26 初稿落盘。按委托人指示标记「风险较大，不纳入本期，暂缓开发」，仅作方案沉淀与风险边界登记。 |
| v0.1-draft | 2026-11-26 修订：配对计划登记为暂缓登记版 Plan（本期不实施），与 `docs/plans/README.md` 及常青池关联文档对齐。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：系统可离线扫描审计库中成功执行的查询与 Schema Manifest，聚类高频聚合表达式与过滤口径，生成**仅限待审草稿态**的 overlay 候选（`measures` / `segments`），经治理方在审阅工作台显式确认后方可写入语义层，绝不自动绕过人审生效。
- 本条出口：候选生成去重与只读隔离单测、草稿入审阅队列与人工 `Approve` 后落盘的端到端自动化验证（`SC-01`–`SC-05`）。
- 不在本条出口：自动发布生效（禁止跳过人审）、Eval 自动改写、多副本调度与在线实时流式学习。
- 上线关系：本条收口不表示可上线。

## 风险评估与暂缓理由（为什么不纳入本期）

| 风险类别 | 具体风险描述 | 影响 |
|---|---|---|
| **口径污染与错表放大** | 历史审计 SQL 中可能包含探索性临时查询、错误口径或历史绕行 SQL；若聚类算法把“高频错法”抽成候选指标并被误点确认，会将错误口径固化为正式资产 | 高（违背 Lucy「口径唯一可信」第一性定位） |
| **SQL 方言与语义还原偏差** | 跨 MySQL/PG/Doris/StarRocks 的复杂嵌套 SQL、CTE 与窗口函数难以无损还原为 KTX overlay 的单表 `measures`/`segments` 表达式 | 高 |
| **重任务资源与锁竞争** | 扫描全量 `audit.sqlite` 与语义编译容易触发事件循环阻塞或与 `REQ-030-083`（重任务容量控制）及 `v0.35.0` 性能基线门禁冲突 | 中高 |
| **治理方审阅疲劳** | 若候选降噪不足，大量低价值草稿涌入 `/review` 会拉高 P2 治理方的审核负担 | 中 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None（正文继续使用「Schema Manifest」「overlay」等既有术语，暂不引入新 WebUI 菜单或界面词汇）。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面。本条处于 S1 暂缓草案阶段，当前不改变任何 WebUI 用户可见页面或运行代码；若未来重启并纳入发版列车，需在升版至 S2 前补充 `/review` 候选队列的交互合同。
- 不改变：现有 WebUI 页面、导航结构、MCP Proxy 问答主路径。

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。4 画像逐行判定；不得写「所有用户」。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 纯 MCP 问答只读取已发布正式语义层与 Wiki | 候选草稿严格隔离在待审区，未 `Approve` 前不进入 MCP 检索；仅在治理方确认发布后获得更全指标覆盖 | P1·问数面 ＝／P1·报告面 ＝ | `SC-03`（未审批草稿对 MCP 零可见） | — |
| P2 治理方 | **语义口径面**：需全手工编写 overlay YAML 中的 `measures` 与 `segments`；**权限授权面**：独立配置 ACL | **语义口径面**：可从历史查询聚类出的草稿直接勾选微调并发布（但若噪声多会增加审核负担）；**权限授权面**：未触碰 | P2·语义口径面 ↑／P2·权限授权面 ＝ | `SC-01`、`SC-02`、`SC-04` | — |
| P3 运维方 | **交付运维面**：无额外后台扫描任务；**运行观察面**：审计库仅服务查询与导出 | **交付运维面**：需在重任务容量许可下控制离线扫描窗口；**运行观察面**：候选生成任务需记录任务状态 | P3·交付运维面 ＝／P3·运行观察面 ＝ | `SC-05`（受重任务许可限流，不抢占主路径） | — |
| P4 管理层 | 口径覆盖率依赖人工逐步补充 | 理论可缩短口径对齐周期，但前提是候选准确率可控 | ＝ | 未触碰概览指标计算路径 | — |

## 第一性原理检查（主路径可用性优先）

| # | 问题 | 回答 |
|---|---|---|
| 1 | 本条生效后，最终用户（含纯 MCP）原先能完成的主任务是否仍能完成？ | 是。未审批草稿与运行时隔离，不改变任何既有 MCP 问答路径 |
| 2 | 若增加拒绝／门禁，逃生或钉选路径是否在同一部署实况下可执行且纳入必做 UAT？ | 是。候选生成失败或超时仅跳过本次草稿产成，不影响既有 `/review` 手工发布 |
| 3 | 验收是否同时覆盖「约束触发」与「合法路径成交」？ | 是。`SC-03` 验未审批隔离，`SC-04` 验确认后合法发布 |
| 4 | 是否避免把「宿主缺席／凭据缺席」记成用例前置 BLOCKED？ | 是。基于本地 `audit.sqlite` 与 `_schema/` 夹具即可全真验证 |

## 1. 设想范围与核心能力

1. **只读候选挖掘器**：从 `.ktx-ui/audit.sqlite` 中提取执行成功（`outcome = 'ok'`）且非协议探针的查询 SQL，结合 `_schema/*.yaml` 识别表与字段归属。
2. **口径聚类与降噪**：按连接与物理表聚合高频 `SELECT` 聚合表达式（候选 `measures`）与高频 `WHERE` 固定条件（候选 `segments`），过滤已存在于正式 overlay 的同名或同义定义。
3. **草稿队列与人审隔离**：产出只读草稿记录（含出现频次、示例 SQL 来源脱敏摘要），挂载至审阅工作台待确认区；必须由治理方显式点击确认并经过 `validate` 校验后，才写入 `semantic-layer/<conn>/<table>.yaml`。

## 核心流程（伪代码）

```text
function generateCaliberDrafts(connId, windowDays):
  acquireHeavyWorkPermit("caliber_draft_scan")          // 复用重任务容量控制，防阻塞主路径
  try:
    rows = queryAuditDb(connId, status="ok", nonProbe=true, days=windowDays)
    manifest = loadSchemaManifest(connId)
    existingOverlay = loadExistingOverlays(connId)

    candidates = []
    for sql in rows:
      ast = parseReadOnlySql(sql)
      if not ast or ast.hasMultiTableComplexCte: continue   // 无法无损还原的复杂 SQL 直接跳过
      for agg in ast.aggregations:
        if not matchesExisting(agg, existingOverlay) and manifest.hasColumns(agg.cols):
          candidates.push(toMeasureCandidate(agg, sqlRef))
      for pred in ast.wherePredicates:
        if isStableBusinessFilter(pred) and not matchesExisting(pred, existingOverlay):
          candidates.push(toSegmentCandidate(pred, sqlRef))

    deduped = clusterAndRankByFrequency(candidates, minSupport=3)
    savePendingDrafts(connId, deduped)                  // 仅落草稿表，不写 semantic-layer/
  finally:
    releaseHeavyWorkPermit("caliber_draft_scan")
```

## 验收（SC）

| ID | 合同 |
|---|---|
| SC-01 | 给定含高频聚合与固定过滤的审计 SQL 样本，离线扫描能准确提取 `measures` 与 `segments` 候选并按频次排序 |
| SC-02 | 已存在于正式 overlay 中的同名或等价表达式不会重复生成候选 |
| SC-03 | 处于待审态的候选草稿不会写入 `semantic-layer/`，且 `lucy_query` / `sl_read` 完全不可见 |
| SC-04 | 治理方在审阅工作台显式确认候选并补全名称后，通过 `validate` 写入对应 overlay YAML 并触发索引刷新 |
| SC-05 | 扫描任务受重任务并发许可控制，任务异常或取消时不破坏 `audit.sqlite` 与既有语义层文件 |
