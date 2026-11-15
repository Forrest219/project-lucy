# 审计导出与概览读路径规模整改＋等价守卫 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.1** |
| 日期 / 目标版本 | 2026-11-15／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-32**／REQ-030-053、**P1-33**／REQ-030-054／**P1**（事故修复延伸）。**不入 0.30 核心分母** |
| 状态 | **开发授权已获得（2026-11-15），实现已落地（本机沙箱），功能合同待终稿复核**。F-1…F-7 均已改并有等价测试；测试台 `UAT-SUITE-EQUIV-GUARD` 首跑见 INDEX 现值；`UAT-SUITE-PAGE-SWEEP` 的 UAT-SWEEP-02 结果见该套件最新跑次。≠ UAT PASS；≠ 可上线 |
| 决策来源 | 委托人 2026-11-15 23:47：「授权进行开发落地，并按 UAT模块的规范落地相应的测试用例，未来升级迭代要进行等价测试，防止旧病复发」。本条按「委托人明示确权＋开发授权」处理（本会话无 Codex CLI 终审；先例同 P1-34）。如委托人不认可这一理解，须撤回并走 Codex 终审 |
| 需求来源 | [P1-31 排查报告](../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md) F-1…F-7；[O1 复评](../reviews/2026-11-15-p1-21-o1-worker-thread-reassessment.md)（结论：不默认启用 worker） |
| 实施主体 | WebUI 服务端：`webui/server/proxy/{audit-as-of-proof,sqlite-in-chunks,audit}.ts`、`webui/server/admin/{audit,audit-inquiry-pack-rows,audit-local-timestamp,yield-slices,reconciliation,inferred-turn-maintainer,access-map-echo,ui-usage,daily-question-kpi}.ts`；测试 `webui/server/__tests__/equivalence/` |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | 不改 P1-21 的 `/api/livez` 合同与展示快照语义；不改审计投影合同；不改导出文件的列、顺序、文本（**输出逐字等价**是本条硬约束）；不引入 worker 线程（O1 维持） |
| 实施计划 | [`docs/plans/lucy-20261115-audit-export-scale-and-equivalence-guard-plan.md`](../plans/lucy-20261115-audit-export-scale-and-equivalence-guard-plan.md)（步骤摘要见本文 §7）；排查计划 [P1-31 Plan](../plans/lucy-20261115-page-by-page-event-loop-sweep-plan.md) |
| 测试台 | [`UAT-SUITE-EQUIV-GUARD`](../qa/uat/suites/audit-scale-equivalence-guard/suite.md)（等价守卫）＋ [`UAT-SUITE-PAGE-SWEEP`](../qa/uat/suites/page-event-loop-sweep/suite.md)（性能看守） |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 2026-11-15 初稿并落地。F-1／F-2／F-3／F-4／F-5／F-6／F-7 整改；新增等价测试目录与登记册；挂测试台 `UAT-SUITE-EQUIV-GUARD`；门禁基线随整改收缩 |

## 闭口层级

- 层级：功能合同
- 本条承诺：在客户规模审计夹具（30 天、115,000 条调用）下，七条已登记越线路径不再把事件循环占到让 `/api/livez` 越线；**所有受影响接口的返回内容与改前逐字等价**；今后改动这些路径必须过等价守卫。
- 本条出口：SC-01–SC-09（vitest 等价测试＋性能门禁基线收缩）。
- 不在本条出口：客户现场复测（测试台 `UAT-SUITE-EQUIV-GUARD`／`UAT-SUITE-PAGE-SWEEP` 记本机结果，**≠** 客户 amd64）；`linkedHandshakeRows` 的同类无界 `IN`（见「风险」）；`audit/export-pack` 与 v2 导出的完整路径（夹具覆盖不到，见 fixtures）；多人并发；worker 线程。
- 上线关系：本条收口不表示可上线；**功能合同收口 ≠ UAT PASS ≠ 可上线**。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None.

本条不新增用户可见文案，不改接口响应字段。新增运行时文件只含内部函数名。

## 交互合同豁免

- 原因：本条只改服务端读路径、SQL 与导出文本的构建方式，不改变用户可见 WebUI 表面
- 不改变：页面路由、组件、按钮、文案与布局；各接口响应字段、导出文件的列、顺序与文本

## 1. 问题与根因

| ID | 路径 | 根因 | 改法 |
|---|---|---|---|
| F-1 | `GET /api/admin/audit/export-inquiry-pack` | 一条 SQL 的复杂度＝行数×问询 ID 数（`OR (IFNULL(lucy_turn_id,'')=? …)` 逐个展开）；单次 114–118 秒，Chart 存活探针连续失败 37 次 | 问询 ID 进 TEMP 表，一次集合式 `IN (SELECT …)`＋`JOIN`；`lucy_turn_id IN` 走新增索引（仅当问询 ID 含空串时保留 `IFNULL` 分支，语义同旧）；行展示与 CSV 分片让出事件循环 |
| F-2 | `GET /api/admin/access-map` | 每个请求都对相关用户 `markDirty` 并重建推断问询（单次约 1.5 秒） | 重建触发改成水位线 `refreshStale()`：没有新数据就不重建 |
| F-3 | `GET /api/admin/governance/overview` | 日问数 KPI 对同一窗口多次全量扫描，分级 CASE 重复求值 | 四个计数合并为一次条件聚合；分级列用子查询只算一次 |
| F-4 | `GET /api/admin/audit/export`、`/turns/export` | CSV 每个单元格都 `new Intl.DateTimeFormat`；115k 行一次性同步渲染 | 格式化器按时区缓存；行展示、调用 CSV、问询 CSV 分片并在片间让出事件循环 |
| F-5 | `GET /api/admin/ui-usage/overview` | 窗口内全部时间戳取进 JS 数组再分桶；分组与页面计数各扫一遍 | 覆盖索引＋SQL 内分桶；`page_key` 计数只算一次复用 |
| F-6 | `GET /api/admin/audit/export-v2`、`export-pack-v2` | 精确 as-of 证明把全部行号展开成 `IN (?,…)`，超过 SQLite 变量上限 32,766 即 409 `too many SQL variables` | `queryInChunks`（块 500），合并后按原排序规则重排，结果与不分块一致 |
| F-7 | `GET /api/admin/audit/reconciliation/export` | `inquiryWhere` 的 `IFNULL(col,'')=?` 不可走索引；一处 SQL 占 42% | 非空问询 ID 用 `col = ?`；空串保持 `IFNULL` 语义；补 `lucy_turn_id`／`effective_turn_id`／`original_turn_id` 索引 |
| F-idx | 审计库 | `inferred_turn_access_logs.access_log_id` 无索引（主键是 `(inferred_turn_id, access_log_id)`） | `idx_ital_access_log`（代理库与管理库两处建表都补） |

## 2. 成功标准

| ID | 标准 | 验证 |
|---|---|---|
| SC-01 | F-1：inquiry-pack 的调用行集、顺序与旧实现逐行相同（含并列时间戳、仅关联行、空问询 ID） | `inquiry-pack-rows.equivalence` |
| SC-02 | F-2：同一请求序列下，重建只在有新数据时发生；用户可见的问询编号不变 | `access-map-rebuild-trigger` |
| SC-03 | F-3／F-5：概览 JSON 与改前金样本逐字相同（多个窗口） | `daily-question-kpi.equivalence`、`ui-usage-overview.equivalence` |
| SC-04 | F-4：本地时间文本与旧实现逐值相同；分片行与分片 CSV 与一次性结果逐字相同，边界行数 0／1／片长±1／多片 | `audit-local-timestamp.equivalence`、`export-yielding.equivalence` |
| SC-05 | F-4：分片版本在多片时必须让出事件循环（同一轮提前排队的宏任务在构建完成前运行） | `export-yielding.equivalence`「不饿死」 |
| SC-06 | F-6：超过变量上限的规模下不再抛错，且结果等于旧实现分片后的结果；顺序规则与旧实现一致 | `audit-as-of-proof.equivalence` |
| SC-07 | F-7／F-idx：`inquiryWhere` 与旧实现逐场景相同；新增索引存在，查询计划走索引 | `inquiry-where.equivalence`、`audit-schema-indexes` |
| SC-08 | 守卫自身：每个 F-n 的冻结旧实现／金样本在、被引用、无未登记 oracle | `equivalence-manifest` |
| SC-09 | 性能：客户规模夹具上，P1-32／P1-33 登记路由在 `sweep:event-loop:gate` 中为 OK（livez p99 ≤ 400ms、max ≤ 1000ms；顺序最大 ≤ 3000ms），基线登记同步删除 | `UAT-SUITE-PAGE-SWEEP` UAT-SWEEP-02／03 |

## 3. 核心流程（伪代码）

```text
# F-1 inquiry-pack 调用行选择（改后）
turnIds := DISTINCT(entry.id for entry in listAuditTurnEntries(filter))
yield                                              # 列表与调用行查询不连成一个同步块
TEMP inquiry_pack_turn_ids := turnIds
rows := SELECT * FROM access_log
        WHERE <用户筛选条件>
          AND ( lucy_turn_id IN (SELECT id FROM temp.inquiry_pack_turn_ids)    # 空串在集合内时改用 IFNULL(lucy_turn_id,'')
                OR id IN (SELECT access_log_id FROM inferred_turn_access_logs
                          JOIN temp.inquiry_pack_turn_ids ON inferred_turn_id = id) )
        ORDER BY ts DESC, id DESC
clear TEMP table (finally)

# 导出构建（audit/export、turns/export、inquiry-pack）
presented := concat( presentCallRows(slice) for slice in slices(rows, 250) ), yield between slices
csv := header + concat( renderRows(slice) for slice in slices(presented, 250) ), yield between slices
# 每个 slice 内行独立，结果与一次性计算逐字相同

# F-6 as-of 证明里的 IN 展开
queryInChunks(values, query, chunk=500):
  out := []
  for chunk in split(values, 500): out += query(chunk)
  return out                                       # 调用方按旧排序规则重排，结果与不分块一致

# F-2 推断问询重建
on request:  await refreshStale()                  # 只在水位线之后有新数据时重建，不再逐请求 markDirty
```

## 4. 等价守卫机制（防旧病复发）

1. **冻结旧实现**：`legacy/*.legacy.ts` 是改前代码原样拷贝（`FROZEN REFERENCE`），测试在同一输入上同时跑新旧两条，逐字比较。运行代码不得 import。
2. **改前金样本**：F-3／F-5 的概览输出用改前代码在固定种子上生成，存 `golden/*.json`。`UPDATE_EQUIVALENCE_GOLDEN=1` 才重写；有意改行为须先在本文 changelog 记委托人批准，并递增登记册里的 `goldenRevision`。
3. **登记册**：`equivalence-manifest.test.ts` 的 `FINDINGS` 防止「删掉 oracle 让测试变绿」。
4. **变异自检**：UAT-EQ-04 列出每个守卫应拦下的复发写法。
5. **性能与等价分开守**：等价不等于不卡。`sweep:event-loop:gate` 负责不卡，门禁基线只减不增。
6. **新发现同类问题**：先入总账，再登记新 F-n（冻结旧实现＋测试），再改运行代码。

## 5. 非目标

- 不引入 worker 线程、不改 Chart 探针、不改审计保留策略。
- 不改导出列、列顺序、文件名、文本格式。
- 不处理 `audit/export-pack`（HTTP 413 由大小上限拦截）与 v2 导出的完整性校验路径。
- 不做浏览器测试、不做移动窄屏。

## 6. 风险与未决

| 项 | 说明 |
|---|---|
| `linkedHandshakeRows` | `admin/audit.ts` 内同类「无界 `IN` 展开」。现阶段不在登记越线内，本条**未改、未守卫**；建议下一轮按 F-n 流程入账 |
| 让出事件循环用 `MessageChannel` | Vitest 假定时器会替换 `setImmediate`／`setTimeout`；`MessageChannel` 不受影响。若升级 Node／测试框架改变这一点，`export-yielding.equivalence` 会先红 |
| 夹具盲区 | 完整性合法的 v2 导出、`export-pack`、评测运行、语义资产操作、宿主 `ktx`：仍为「未测」，见 PAGE-SWEEP 基线 `unmeasured*` |
| 内存 | 压测期间沙箱服务进程 RSS 峰值约 1.7–2.2GB（Chart 上限 2Gi）。导出整包仍在内存里拼；本条未做内存剖析，**不下结论** |
| 一致性 | 分片处理期间若有新写入，分片之间看到的是同一条 SQL 已取出的行快照，与旧实现一致（行集在 SQL 返回时已固定） |

## 7. 实施计划

| 步骤 | 内容 | 验证 |
|---|---|---|
| 1 | F-1 集合式 SQL＋索引＋等价测试 | SC-01 |
| 2 | F-6 分块＋规模测试 | SC-06 |
| 3 | F-4／F-7 缓存格式化器、sargable WHERE、索引 | SC-04／SC-07 |
| 4 | F-2／F-3／F-5 | SC-02／SC-03 |
| 5 | 分片让出事件循环（调用行、调用 CSV、问询 CSV） | SC-04／SC-05 |
| 6 | 登记册、变异自检 | SC-08、UAT-EQ-04 |
| 7 | 性能门禁复测并收缩基线 | SC-09 |
| 8 | 测试台登记（INDEX、e2e-ledger、`check-e2e-ledger`、test-layers） | `lint:spec-docs`、`lint:e2e-ledger` |
