# WO-202610-26 库表发现与持续感知

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-26 |
| 标题 | Schema 级库内表清单、持续感知与结构差异、接入预览接入持久化快照 |
| 状态 | **未开工。Spec 190 v0.2 待审阅** |
| 来源 | 2026-10-26 对「Lucy 增加扫描库表的能力」的评估。三轮追加需求：扫描对象是历史已存在的连接；L1 表目录与 L2 表结构都要；库内新增表后要能自动感知，不能每次都让用户选 |
| 来源 Spec | [`webui/docs/190-live-table-discovery-and-continuous-sync-spec.md`](../190-live-table-discovery-and-continuous-sync-spec.md) **v0.2** |
| 来源审阅 | [`docs/reviews/2026-10-26-spec-190-plan-work-order-cross-review.md`](../../../docs/reviews/2026-10-26-spec-190-plan-work-order-cross-review.md)（P0 四条、P1 六条，已在 Spec v0.2 §1.4 逐条处置） |
| 来源评估 | [`docs/specs/lucy-20261026-warehouse-table-scan-capability-analysis.md`](../../../docs/specs/lucy-20261026-warehouse-table-scan-capability-analysis.md) |
| 撰写日期 | 2026-10-26（v0.2 修订于同日，纳入审阅意见） |
| 适用范围 | `/connections` 连接概览（最小展示）、连接级接入预览、运行时 sidecar `.ktx-ui/`。不改语义层 overlay 维护面，不写 Schema Manifest，不写 `enabled_tables` |

## 目标

按 Spec 190 v0.2，交付四段能力：Schema 级库内表清单只读端点；持续感知（持久化成功快照、物理基线、当前对账状态、变更事件历史）；接入范围预览改消费持久化快照；差异读取与列级深查端点 + 连接概览最小展示。全程只读，不改授权。

## 与 v0.1 版的差异（据审阅意见）

| 审阅项 | 本工单处置 |
|---|---|
| P1-2 KTX 前置阻塞被扩大 | **T0 的 KTX 实测只阻塞 S3 的生产 provider 选择，不阻塞 T1**。T1 走只读 SQL 路径，可在 T0 未完成时开工 |
| P1-2 双 provider 交付 | 交付**一套**生产实现 + 统一接口 + 测试假实现。不要求双生产实现 |
| P1-3 依赖与回滚矛盾 | 按真实依赖重写实现顺序与回滚；**T1 是 T2／T3 的共同基础，回滚 T1 会影响后续段** |
| P0-1 / P0-2 / P0-3 / P0-4 | 由 Spec v0.2 承接，本工单的任务与 SC 映射相应更新 |
| P1-6 SC 覆盖不足 | 验收口径扩为 SC-1 ~ SC-34，T5 逐项映射测试文件与层次 |

## 前置条件

| # | 事项 | 阻塞对象 | 验收方式 |
|---|---|---|---|
| P1 | 交付镜像 KTX（`KTX_VERSION=0.16.0`）是否提供 `ktx scan`、参数、是否需要 AI | **仅 S3 的 provider 选择（不阻塞 T1）** | 同版本 KTX 上执行 `ktx scan --help` 并记录输出；结论回写 Spec 190 §6.2 |
| P2 | 复核 `docs/specs/lucy-platform-goal-checklist.md:87` 关于「无顶层 `scan` 命令」的记录 | 文档一致性 | 与 P1 结论一致；不一致则改该文件 |
| P3 | 存量连接验收样本来源（真实客户连接，或含多 Schema / 多表 / 孤儿启用 / 空 `enabled_tables` 的夹具） | 验收阶段 | PM 指定；仓内 `config/semantic-layer/` 为空、`customer-config.example/` 是模板，不可用 |
| P4 | 「不扫物理库」家族（Spec 21 §2.2 / 28 §3 / 29 非目标 / 34 §3）与实际实现（107 / 157 / 164）未对账 | 开工前（文档） | 先改文档口径，再开工 |
| P5 | Spec 190 v0.2 通过审阅 | 开工 | PM 明确批准 |

## 任务

- [ ] **T0 前置调研与文档对账。** 执行 P1 / P2 实测并回写 Spec 190 §6.2 的 provider 路径选择；执行 P4 文档对账；确认 P3 样本来源；把 Spec 190 升 v0.3（路径定稿、样本写入 §10）。**不写生产代码。**

- [ ] **T1 发现能力抽象与表清单端点。** 落 `LiveTableProvider` 接口（Spec 190 §6.2）与**一套**生产实现（只读 SQL 路径，`information_schema` 表粒度聚合查询，行数=表数）+ 测试假实现。新增 `GET /api/connections/:connId/live-tables`：`schema` 白名单校验、连接存在性、协议判定（mysql/postgres 家族）、人工 10 分钟 TTL 缓存 + 连接配置代次隔离、复用探测队列（`ProbeKind` 扩展 `live-tables`）、**封闭式** `LiveTableFailureReason` 词表与保守分类函数、满页即失败不静默截断。**不等待 T0 的 KTX 结论。** 对应 SC-1 ~ SC-10、SC-27、SC-28。

- [ ] **T2 快照 / 基线 / 当前对账状态 / 变更事件与持续感知。** 落三个 sidecar（`live-table-snapshots.json` / `live-table-discovery.json` / `live-table-events.json`），原子写、0600、事件限量 50 条。新增后台 reconciler：per-Schema 状态、指数退避、达 10 次转人工暂停、成功即清零、代次变化作废快照与基线、**快照落盘成功才推进基线**、失败隔离到 Schema 级、**自动目的缓存 TTL = 轮询间隔**（不消费面向人工的 10 分钟缓存）。新增 `GET /api/connections/:connId/discovery`（含连接级聚合规则 `ok/partial/error/paused/never_run` 与 `lastAttemptAt` / `lastCompletedAt`）与 `PUT /api/connections/:connId/discovery`（owner 限定，间隔白名单 5 分钟 ~ 24 小时、默认 1 小时）。新增 discovery 审计事件（自动任务与人工读取同等留痕）。**队列独立配额**（不占用 `test` 与 `live-schemas` 并发额度）。对应 SC-11 ~ SC-22、SC-29 ~ SC-32。

- [ ] **T3 接入范围预览接入持久化快照。** 改 `buildImportScopePreview` 的 `discovered` 来源优先级：显式传入优先（`discoverySource: "manual"`）→ 同代次最新成功快照（`"continuous"`）→ 空且 `discoveryExecuted: false`（`"none"`）。**消费快照而非差异记录**；**本端点不得为填满 `discovered` 而连库**（沿用 Spec 183）。响应新增 `discoverySource` 字段。对应 SC-25、SC-26。

- [ ] **T4 差异读取端点、列级深查端点与最小 UI。** 新增 `GET /api/connections/:connId/table-diff`：返回**当前对账状态**（按最新快照 + Manifest + `enabled_tables` 每次重算，不累积）与**表清单差异**（本轮库 vs 上一份快照）；`includeEvents=1` 返回变更事件历史。新增 `GET /api/connections/:connId/table-structure-diff`（按需深查列名 / 类型 / 可空 / 主键，逐表独立失败，单次最多 20 张表）。`/connections` Schema 行新增：库内表清单入口（表名 + 列数）、持续感知状态（已开启 / 已暂停 + 原因 / 上次感知时间 / 间隔）、表清单差异计数（新增 N · 已消失 N · 列数变化 N，均为 0 时不显示）；连接卡在失败时显示「持续感知已暂停：<reason>」。**不做**批量启用、批量补结构、差异管理界面（属 L25-11）。对应 SC-33、SC-34。

- [ ] **T5 验收扩充与门禁收口。** 服务端单测：T1 端点（SC-1 ~ SC-10、SC-27、SC-28）、T2 reconciler（SC-11 ~ SC-22、SC-29 ~ SC-32，临时目录 + 假 provider）、T3 来源优先级（SC-25、SC-26）、T4 端点与列级深查（SC-33）、**当前对账状态与事件历史分离**（SC-20、SC-21）、**错误码逐 reason 分类**（SC-10 必测）。前端组件测 SC-34。跑 `npm run lint:terminology` 与 `npm run lint:spec` 必须绿。**真实存量连接只读对账**：在 P3 指定的样本上做一次只读发现 + 角色有效 source 基线对比（沿用 2026-08-28 升级评审 §3.2 的方法：逐角色有效 source 数不少于基线、编译失败的角色单列、比较键 `normalizeRef(physicalTable)`），产出证据记录。Spec 190 §11 的 SC-1 ~ SC-34 少一条不算完成。

## 实现顺序

1. **T0 先行，但只挡 S3 的 provider 选择。** T1 不依赖 T0 的 KTX 结论，可与 T0 并行开工。
2. **T1 是 T2／T3 的共同基础**：provider 接口、结果形状、错误码词表、缓存与代次机制都从这里出。
3. **T2 先于 T3**：T3 消费的是 T2 产出的持久化快照，没有快照就无从消费。**（v0.1 把它排反了。）**
4. **T4 依赖 T2 的存储**：差异读取端点与 UI 读的是当前对账状态与事件历史。
5. **T5 收口**：先在夹具上把 SC-1 ~ SC-34 全过，再在真实存量连接上做只读对账。

## 验收口径

Spec 190 v0.2 §11 的 SC-1 ~ SC-34。少一条不算完成。T5 需逐项映射测试文件与测试层次（单测 / 集成 / 前端组件 / 真实连接只读对账）。

## 验证命令

```bash
cd webui
npm run lint:terminology
npx vitest run --maxWorkers=1 server/__tests__/live-tables.test.ts server/__tests__/continuous-discovery.test.ts server/__tests__/table-diff.test.ts server/__tests__/spec-183-import-scope-preview.test.ts

cd ..
npm run lint:spec
```

## 回滚

**依赖是真实的，不能说三段互不依赖**（v0.1 的说法已删除）：

| 回滚动作 | 影响 |
|---|---|
| 回滚 T1 | **T2 / T3 / T4 全部失效**（provider 接口与结果形状是它们的共同基础）。T1 的端点可单独下线，但 T2 的 reconciler 会失去数据来源 |
| 回滚 T2 | T3 自动降级为 `discoverySource: "none"`（无快照可消费，**不得**宣称功能完整）；T4 的差异读取返回空状态。快照 / 事件 / 配置三个 sidecar 文件可删除——它们是运行时状态，删除不触及资产 |
| 回滚 T3 | 仅回退 `import-scope` 的来源装配，其余不受影响 |
| 回滚 T4 | 仅下线差异读取端点与 UI 展示，其余不受影响 |

**全程不写 Schema Manifest 与 `enabled_tables`**，因此任何回滚都不产生本地资产变更。

## 风险与边界

| 风险 | 处理 |
|---|---|
| 架构押注未验证的 KTX 命令 | T0 实测；provider 抽象；**只交付一套生产实现**；T1 不被 T0 阻塞 |
| 常态轮询扩大凭据暴露面 | 可按连接关闭；间隔可配；每次查询入审计；失败退避不刷屏 |
| 误判「表被删除」 | 错误分类保守化：无法区分不存在与不可见时归 `SCHEMA_NOT_VISIBLE`（SC-10） |
| 发现结果被误当作授权 | 本工单不写 `enabled_tables`；发现结果不进 Agent 可见面、不参与角色有效 source 编译 |
| 空转误报（权限收窄） | 不自动清空本地条目与快照；`notInLibrary` 如实报告 + 原因 |
| 「表清单差异」被当成「表结构差异」 | 两层分别命名并在术语标准分列；列级差异只按需深查 |
| 与既有「已发现表数」口径混淆 | 「库内表清单」与「已发现表数」分列；UI 不合并列 |
| 与 L25-11 的批量维护面职责重叠 | L25-11 负责结构之上的语义维护；本工单只读，不写 overlay，不自动建表 |
| 队列挤占连接健康检查 | 库表查询走独立队列配额，不占用 `test` 与 `live-schemas` 的并发额度 |
| 文档口径漂移 | T0 的 P4 先对账，再开工 |
| 缺真实存量样本导致验收走过场 | P3 必须指定来源；T5 除夹具外还要在真实连接上做一次只读对账并留证 |
