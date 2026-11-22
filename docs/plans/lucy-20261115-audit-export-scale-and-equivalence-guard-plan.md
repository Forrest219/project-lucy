# 审计导出与概览读路径规模整改＋等价守卫 Plan（P1-32／P1-33）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 审计导出与概览读路径规模整改＋等价守卫 Plan |
| 文档类型 | Other（实施 Plan） |
| 版本 | v0.1 |
| 撰写日期 | 2026-11-16 |
| 撰写人 | Claude（Cursor） |
| 委托人 | xingchen |
| 基于材料 | [Spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md)、[P1-31 排查报告](../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md)、[O1 复评](../reviews/2026-11-15-p1-21-o1-worker-thread-reassessment.md)、委托人 2026-11-15 23:47「授权进行开发落地，并按 UAT模块的规范落地相应的测试用例，未来升级迭代要进行等价测试，防止旧病复发」 |
| 适用范围 | P1-32／REQ-030-053、P1-33／REQ-030-054：F-1…F-7 整改、等价守卫、测试台登记 |
| 状态 | 阶段:S5｜**功能合同已收口（2026-11-22，S4→S5 并行波次·scoped）**。实现已落地（2026-11-16）；EQUIV-GUARD／PAGE-SWEEP PASS WITH GAP；夹具盲区与 linkedHandshakeRows 入收口范围另账。≠ 可上线 |
| 授权边界 | 委托人 2026-11-15 23:47 同句＝开发授权；本会话无 Codex CLI，按「委托人明示确权＋开发授权」处理（先例同 P1-34）。不含：引入 worker、改 Chart 探针、改导出文件格式、处理 `linkedHandshakeRows`、客户现场验证 |
| 验收 | 见 §4 |
| 输出位置 | `docs/plans/lucy-20261115-audit-export-scale-and-equivalence-guard-plan.md` |

**清单**：P1-32、P1-33（**不入核心分母**）｜**REQ**：REQ-030-053、REQ-030-054｜**总账**：[功能清单池](lucy-20261107-lucy-0-30-feature-inventory-pool.md)

## 1. 目标

把 P1-31 登记的七条越线路径改成不占住事件循环的写法，**输出与改前逐字等价**，并留下今后每次升级都要跑的等价守卫，防止旧病复发。

## 开工前置

- 已入总账：P1-32／REQ-030-053、P1-33／REQ-030-054（立项 2026-11-15，开发授权 2026-11-15 23:47）。
- 夹具：沙箱审计库（30 天、115,000 条调用、67 用户、合成账本、30 万条 `ui_page_views`），门禁脚本 `webui/scripts/page-event-loop-sweep.mts`。
- 不触碰客户实例、demo volume、ACL；不引入 worker；不 `git commit`。

## 2. 步骤与验证

| 步骤 | 内容 | 验证 |
|---|---|---|
| 1 | F-1：问询 ID 进 TEMP 表，集合式 SQL；`lucy_turn_id` 等索引 | `inquiry-pack-rows.equivalence`（SC-01） |
| 2 | F-6：`queryInChunks`（块 500）＋原顺序重排 | `audit-as-of-proof.equivalence`（SC-06，4 万行号） |
| 3 | F-4／F-7：缓存格式化器；`inquiryWhere` 去掉 `IFNULL` 包列（空串保留）；`idx_ital_access_log` | `audit-local-timestamp.equivalence`、`inquiry-where.equivalence`、`audit-schema-indexes`（SC-04／SC-07） |
| 4 | F-2／F-3／F-5：水位线重建；合并计数；覆盖索引与单次分组 | `access-map-rebuild-trigger`、概览金样本（SC-02／SC-03） |
| 5 | 导出分片并在片间让出事件循环（调用行、调用 CSV、问询 CSV） | `export-yielding.equivalence`（SC-04／SC-05） |
| 6 | 登记册、变异自检 | `equivalence-manifest`、UAT-EQ-04（SC-08） |
| 7 | 性能门禁复测，基线 `tracked` 清零 | UAT-SWEEP-02／03（SC-09） |
| 8 | 测试台登记：INDEX、e2e-ledger、`check-e2e-ledger.mjs`、test-layers、CONVENTIONS 前缀 | `lint:e2e-ledger`、`lint:spec-docs` |

## 3. 风险

- 夹具盲区（完整性合法的 v2 导出、`export-pack`）使两条路径的**输出内容**不在等价守卫里。
- `linkedHandshakeRows` 同类无界 `IN` 未改。
- `governance/overview` p99 372ms 贴线（400ms）；`turns/export` 单路由复测出现 338／408ms。下一轮继续盯，必要时再复评 worker。
- 等价守卫拦不住纯性能回退，必须与性能门禁同跑。

## 浏览器验证

不适用：本条只改服务端读路径、SQL 与导出文本的构建方式，不改变用户可见 WebUI 表面；验收以 vitest 等价测试与事件循环门禁为准。

## 4. 验收

- `npm --prefix webui run test:equivalence` 全绿（本次 10 个文件、71 条）。
- `UAT-SUITE-PAGE-SWEEP`：登记路由全部 OK，`regressions=0`，`tracked` 清零。
- `UAT-SUITE-EQUIV-GUARD` 必做 R0／01／02／03 通过；变异自检每类至少一条红。
- 总账、REQ、Spec 头部、INDEX、e2e-ledger 同句镜像。

## 5. 完成定义

- 功能合同收口＝Spec SC-01…SC-09 全满足，且终稿复核通过（Codex CLI 终审，或委托人明示确权）。
- **功能合同收口 ≠ UAT PASS ≠ 可上线**。UAT PASS 要求 PAGE-SWEEP 的未测项（夹具盲区）补齐后无缺口。
