# WO-202610-26 库表发现与持续感知

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-26 |
| 标题 | Schema 级库内表清单、持续感知与结构差异、接入预览接入持久化快照 |
| 状态 | **T1~T5 已实现；第二轮静态 Code Review 已收口（8 处缺陷已修 + 变异测试证伪），待验收**（T0 未执行；真实存量连接对账未做；独立外部审查未取得，见「未完成项」） |
| 来源 | 2026-10-26 对「Lucy 增加扫描库表的能力」的评估。三轮追加需求：扫描对象是历史已存在的连接；L1 表目录与 L2 表结构都要；库内新增表后要能自动感知，不能每次都让用户选 |
| 来源 Spec | [`webui/docs/190-live-table-discovery-and-continuous-sync-spec.md`](../190-live-table-discovery-and-continuous-sync-spec.md) **v0.3** |
| 来源审阅 | [`docs/reviews/2026-10-26-spec-190-plan-work-order-cross-review.md`](../../../docs/reviews/2026-10-26-spec-190-plan-work-order-cross-review.md)（P0 四条、P1 六条，已在 Spec v0.2 §1.4 逐条处置） |
| 来源评估 | [`docs/specs/lucy-20261026-warehouse-table-scan-capability-analysis.md`](../../../docs/specs/lucy-20261026-warehouse-table-scan-capability-analysis.md) |
| 撰写日期 | 2026-10-26（v0.2 修订于同日，纳入审阅意见；v0.3 记录实现落地，2026-10-27） |
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
  **状态：未执行。** T0 只挡 S3 的 provider 选择；本次交付走 Spec §6.2 的**默认可用路径 B（只读 SQL）**，因此 T1/T2/T4 不被阻塞。P1 / P2 / P4 仍未关闭，见「未完成项」。
- [x] **T1 发现能力抽象与表清单端点。** 落 `LiveTableProvider` 接口（Spec 190 §6.2）与**一套**生产实现（只读 SQL 路径，`information_schema` 表粒度聚合查询，行数=表数）+ 测试假实现。新增 `GET /api/connections/:connId/live-tables`：`schema` 白名单校验、连接存在性、协议判定（mysql/postgres 家族）、人工 10 分钟 TTL 缓存 + 连接配置代次隔离、复用探测队列（`ProbeKind` 扩展 `live-tables`）、**封闭式** `LiveTableFailureReason` 词表与保守分类函数、满页即失败不静默截断。**不等待 T0 的 KTX 结论。** 对应 SC-1 ~ SC-10、SC-27、SC-28。
  落地：`server/live-tables.ts`（provider + 分类 + 缓存）、`server/live-table-queue.ts`（**独立队列配额**）、`server/admin/live-discovery.ts`（端点）。
- [x] **T2 快照 / 基线 / 当前对账状态 / 变更事件与持续感知。** 落三个 sidecar（`live-table-snapshots.json` / `live-table-discovery.json` / `live-table-events.json`），原子写、0600、事件限量 50 条。新增后台 reconciler：per-Schema 状态、指数退避、达 10 次转人工暂停、成功即清零、代次变化作废快照与基线、**快照落盘成功才推进基线**、失败隔离到 Schema 级、**自动目的缓存 TTL = 轮询间隔**（不消费面向人工的 10 分钟缓存）。新增 `GET /api/connections/:connId/discovery`（含连接级聚合规则 `ok/partial/error/paused/never_run` 与 `lastAttemptAt` / `lastCompletedAt`）与 `PUT /api/connections/:connId/discovery`（owner 限定，间隔白名单 5 分钟 ~ 24 小时、默认 1 小时）。新增 discovery 审计事件（自动任务与人工读取同等留痕）。**队列独立配额**（不占用 `test` 与 `live-schemas` 并发额度）。对应 SC-11 ~ SC-22、SC-29 ~ SC-32。
  落地：`server/live-table-discovery.ts`（存储 + reconciler + 聚合）、`server/live-table-worker.ts`（后台轮询）、`server/admin/discovery-audit.ts`（独立审计事件类型 `discovery_audit_log`）、`server/admin/audit.ts`（新增表）。
- [x] **T3 接入范围预览接入持久化快照。** 改 `buildImportScopePreview` 的 `discovered` 来源优先级：显式传入优先（`discoverySource: "manual"`）→ 同代次最新成功快照（`"continuous"`）→ 空且 `discoveryExecuted: false`（`"none"`）。**消费快照而非差异记录**；**本端点不得为填满 `discovered` 而连库**（沿用 Spec 183）。响应新增 `discoverySource` 字段。对应 SC-25、SC-26。
  落地：`server/admin/import-scope.ts`。
- [x] **T4 差异读取端点、列级深查端点与最小 UI。** 新增 `GET /api/connections/:connId/table-diff`：返回**当前对账状态**（按最新快照 + Manifest + `enabled_tables` 每次重算，不累积）与**表清单差异**（本轮库 vs 上一份快照）；`includeEvents=1` 返回变更事件历史。新增 `GET /api/connections/:connId/table-structure-diff`（按需深查列名 / 类型 / 可空 / 主键，逐表独立失败，单次最多 20 张表）。`/connections` Schema 行新增：库内表清单入口（表名 + 列数）、持续感知状态（已开启 / 已暂停 + 原因 / 上次感知时间 / 间隔）、表清单差异计数（新增 N · 已消失 N · 列数变化 N，均为 0 时不显示）；连接卡在失败时显示「持续感知已暂停：<reason>」。**不做**批量启用、批量补结构、差异管理界面（属 L25-11）。对应 SC-33、SC-34。
  落地：`server/admin/live-discovery.ts`、`src/components/connections/SchemaDiscoveryCells.tsx`、`src/pages/connections/ConnectionOverview.tsx`、`src/app/app.css`。
- [x] **T5 验收扩充与门禁收口。** 服务端单测：T1 端点（SC-1 ~ SC-10、SC-27、SC-28）、T2 reconciler（SC-11 ~ SC-22、SC-29 ~ SC-32，临时目录 + 假 provider）、T3 来源优先级（SC-25、SC-26）、T4 端点与列级深查（SC-33）、**当前对账状态与事件历史分离**（SC-20、SC-21）、**错误码逐 reason 分类**（SC-10 必测）。前端组件测 SC-34。跑 `npm run lint:terminology` 与 `npm run lint:spec` 必须绿。**真实存量连接只读对账**：在 P3 指定的样本上做一次只读发现 + 角色有效 source 基线对比（沿用 2026-08-28 升级评审 §3.2 的方法：逐角色有效 source 数不少于基线、编译失败的角色单列、比较键 `normalizeRef(physicalTable)`），产出证据记录。Spec 190 §11 的 SC-1 ~ SC-34 少一条不算完成。
  **夹具侧 SC-1 ~ SC-34 全过；真实存量连接对账未做**（P3 样本缺失，见「未完成项」）。

## 实现顺序

1. **T0 先行，但只挡 S3 的 provider 选择。** T1 不依赖 T0 的 KTX 结论，可与 T0 并行开工。
2. **T1 是 T2／T3 的共同基础**：provider 接口、结果形状、错误码词表、缓存与代次机制都从这里出。
3. **T2 先于 T3**：T3 消费的是 T2 产出的持久化快照，没有快照就无从消费。**（v0.1 把它排反了。）**
4. **T4 依赖 T2 的存储**：差异读取端点与 UI 读的是当前对账状态与事件历史。
5. **T5 收口**：先在夹具上把 SC-1 ~ SC-34 全过，再在真实存量连接上做只读对账。

## 验收口径

Spec 190 v0.2 §11 的 SC-1 ~ SC-34。少一条不算完成。T5 需逐项映射测试文件与测试层次（单测 / 集成 / 前端组件 / 真实连接只读对账）。

### SC → 测试文件映射（T5 产出）

| SC | 场景 | 测试文件 | 层次 |
|---|---|---|---|
| SC-1 | `live-tables` 缺 / 非法 schema → 400，不连库 | `server/__tests__/live-tables.test.ts` | 集成（HTTP） |
| SC-2 | 连接不存在 → 404 | 同上 | 集成 |
| SC-3 | 协议不可识别 → `PROTOCOL_UNSUPPORTED` | 同上 | 单测（provider） |
| SC-4 | sqlserver / oracle → `TABLE_LIST_UNSUPPORTED` | 同上 | 单测 |
| SC-5 | 命中行数上限 → `TABLE_LIST_TOO_LARGE`，不返回部分表 | 同上 | 单测 |
| SC-6 | 探测队列满 → `PROBE_QUEUE_FULL`，不 500 | 同上 | 集成 |
| SC-7 | 排队超时 / 代次失效 → `PROBE_QUEUE_TIMEOUT` / `GENERATION_INVALIDATED` | 同上 | 单测（映射 + 调度器） |
| SC-8 | 同代次人工重复请求 → `cached: true` | 同上 | 单测 + 集成 |
| SC-9 | 代次变化 → 旧结果不返回、不入缓存 | 同上 | 单测 |
| SC-10 | 无法区分不存在与不可见 → `SCHEMA_NOT_VISIBLE` | 同上 | 单测（逐 reason 分类表） |
| SC-11 | 一个 Schema 失败，其余继续 | `server/__tests__/continuous-discovery.test.ts` | 单测（reconciler + 假 provider） |
| SC-12 | 指数退避；达 10 次转 `paused` 且不再自动重试 | 同上 | 单测 |
| SC-13 | 失败后成功一次 → 计数清零、退出退避 | 同上 | 单测 |
| SC-14 | `partial` / `error` / `paused` 聚合 | 同上 | 单测 |
| SC-15 | 库内新增表 → `listDiff.added`，本地资产不变 | 同上 + `server/__tests__/table-diff.test.ts` | 单测 + 集成 |
| SC-16 | 库内删除表 → `listDiff.missing`，本地条目未删 | 同上 | 单测 |
| SC-17 | 列数变化 → `listDiff.columnCountChanged`（带 before / after） | 同上 | 单测 + 集成 |
| SC-18 | 首轮：建基线 + 产出对账状态，无变更事件 | `server/__tests__/continuous-discovery.test.ts` | 单测 |
| SC-19 | 差异写盘失败 → 快照与基线均不推进，下一轮重报 | 同上 | 单测 |
| SC-20 | 恢复 / 补齐后当前状态不含该表，事件历史保留 | 同上 + `server/__tests__/table-diff.test.ts` | 单测 + 集成 |
| SC-21 | 事件只追加、限量 50；当前状态不随历史累积 | 同上 | 单测 |
| SC-22 | 未开启持续感知 → 后台不发起任何库表查询 | 同上 | 单测 |
| SC-23 | `PUT` 越界 `intervalMs` → 400，配置未变更 | 同上 | 集成（真实 owner 会话） |
| SC-24 | 非 owner `PUT` → 拒绝，配置未变更 | 同上 | 集成（真实 operator 会话） |
| SC-25 | 接入预览未传 `discovered` + 同代次快照 → `discoverySource: "continuous"` | `server/__tests__/spec-183-import-scope-preview.test.ts` | 集成 |
| SC-26 | 显式传 `discovered` → `discoverySource: "manual"` | 同上 | 集成 |
| SC-27 | 本轮无差异 → 最新成功快照仍更新 | `server/__tests__/continuous-discovery.test.ts` | 单测 |
| SC-28 | 自动目的不命中面向人工的 10 分钟缓存 | `server/__tests__/live-tables.test.ts` | 单测 |
| SC-29 | 重启后快照 / 事件 / 配置 / 失败状态从 sidecar 恢复 | `server/__tests__/continuous-discovery.test.ts` | 单测 |
| SC-30 | 每次库表查询一条 discovery 审计事件 | 同上 | 单测 + 集成（sqlite 落库） |
| SC-31 | 原子写；文件模式 `0600`；不含列值 | 同上 | 单测 |
| SC-32 | 库表查询走独立队列配额 | 同上 | 单测 |
| SC-33 | 列级深查返回 added / removed / changed；一张表失败不影响其它表 | `server/__tests__/table-diff.test.ts` | 集成 |
| SC-34 | 连接概览展示表清单入口 / 感知状态 / 差异计数 / 暂停原因 | `src/__tests__/connection-overview.test.tsx` | 前端组件 |

## 实现偏离与理由（实现与 Spec 的差异，逐条说明）

| # | Spec 条款 | 实现 | 理由 |
|---|---|---|---|
| 1 | §6.2 路径 A / B 二选一，路径 B 为默认 | 只交付**路径 B**（只读 SQL） | T0 未执行；Spec §6.2 与本工单 T1 均写明路径 B 默认可用、不被 T0 阻塞。provider 接口 + 假实现保留，换路径 A 只需新增一个 `LiveTableProvider` 实现 |
| 2 | §8.2 reconciler 调 `readLiveTables(refresh = false)` | reconciler 每轮 `refresh = true` | 自动缓存 TTL = 轮询间隔，`refresh=false` 会让一轮轮询命中自己上一轮的缓存条目，快照不推进，违反 SC-27；§6.4 的硬要求是「后台轮询仍重新查询」（SC-28）。人工读取仍走 10 分钟 TTL，purpose 分键，互不命中 |
| 3 | §6.5 步骤 1 每轮先读 `live-schemas` | 不读；直接按配置里的 Schema 逐个查表 | 每 Schema 的表粒度查询本身就是可见性的权威（不可见时返回 `SCHEMA_NOT_VISIBLE`）；步骤 1 会给每轮再加一次真实库往返，与「常态轮询扩大凭据暴露面」的缓解目标相悖 |
| 4 | §7.5 连接级状态无 `lastReason` | 增加连接级 `lastReason` | 连接卡要显示「持续感知已暂停：<reason>」，必须有连接级原因；审阅 P1-4 亦要求连接级能表达部分失败与暂停原因 |
| 5 | §7.4 列级深查「逐表独立失败」 | 每个 Schema 一次列查询，再按表拆分；查询本身失败时该次请求内所有表为 `error` | 复用 Spec 164 的列行查询形状，避免每表一次往返；单次查询失败无法按表区分，报告为整次读取失败更诚实 |
| 6 | §7.9 UI 最小展示 | 「库内表清单」「持续感知」各占一列 | §5.3 要求四个口径分列；`/connections` 原表有 3 个计数列，新增后共 8 列。M72 栅格契约测试同步更新为「计数列分列 + 操作列取残宽」 |
| 7 | §7.7 `PUT /discovery` owner 限定 | 沿用平台既有 owner 门禁 | open（本地免密）模式下没有管理员会话，owner 端点一律 401，与 `/api/admin/notifications/*` 等既有端点同构 |

## 未完成项（不宣称完成）

| # | 事项 | 状态 | 影响 |
|---|---|---|---|
| 1 | T0：交付镜像 KTX 0.16.0 的 `ktx scan` 实测（P1 / P2） | **未执行** | 只影响「是否另交付路径 A」。本次交付走路径 B，功能闭环不受阻 |
| 2 | P4：「不扫物理库」家族（Spec 21 / 28 / 29 / 34）与实际实现（107 / 157 / 164）的文档对账 | **未执行** | 文档口径漂移风险仍在 |
| 3 | P3 / SC-1 ~ SC-34 的**真实存量连接**只读对账 | **未执行** | 仓内无样本（`config/semantic-layer/` 为空、`customer-config.example/` 是模板）。夹具侧全过，但「存量连接到底缺什么」仍需在客户环境做一次只读发现 + 角色有效 source 基线对比才能回答 |
| 4 | 浏览器测试 | 未执行（**建议不做**，见下） | 按 `AGENTS.md` 的浏览器测试约束，正常开发任务默认不做；Spec 190 §12 明确「前端：SC-34（组件断言），不要求浏览器测试，除非 PM 另行要求」。且 e2e 契约夹具**没有真实数据库**（`ktx-fixture.yaml` 指向 `127.0.0.1:3306` 的 `e2e_db`，凭据是占位串，夹具脚本不启 MySQL）⇒ e2e 只能验到「库内表清单读取失败」的错误路径，验不到「表名 + 列数」这个 Spec 190 的核心价值 |
| 5 | 独立外部静态审查（Codex） | **未取得** | 本机 Codex MCP 四次调用（含显式 `cwd` 与 `sandbox: read-only`）均返回 `workspace routing discovery timed out`，独立第二意见缺失。第二轮审查为自审 + 变异测试证伪 + 全量基线对照；自审已修 8 处（见下节） |
| 6 | 并发工作流污染的全量测试结果 | **已归因** | 同一工作区存在并发的 Spec 189 / 191 会话，中途的全量结果不可直接采信；已用 HEAD 同工作区基线 + 树稳定后的复跑完成归因（见下节） |
| 7 | `lint:spec` 的 `api-spec` 门禁 | **红，且不属本工单** | `webui/docs/03-api-spec.md: missing /api/admin/mcp-runtime/reload`。该路由属 Spec 191（`webui/server/admin/mcp-runtime.ts:559`），由并发会话提交（`21d59b83`）但未补文档。**交付前需由 Spec 191 侧补登记**，否则 `lint:spec` 保持红 |

## 静态 Code Review 收口（2026-10-27）

### 自审发现并修复的 11 处

| # | 位置 | 缺陷 | 处置 |
|---|---|---|---|
| 1 | `live-tables.ts` | MySQL 1045（凭据错）与 1044（库级权限不足）未区分 | 新增 `PRIVILEGE_ON_DATABASE` 优先匹配 → `SCHEMA_NOT_VISIBLE`；`eof` 正则收紧为 `\beof\b` / `unexpected eof` |
| 2 | `live-table-discovery.ts` | 快照文件在 per-Schema 循环内重复读取 | 提到循环外读取，写入后同步内存 map |
| 3 | `live-table-worker.ts` | **首轮永不触发**：`isConnectionDue` 只看持久化 `config.schemas`，首轮为空 | 改为由 worker 读 `readConnections()` 拿 ktx.yaml 的 Schema 列表传入 |
| 4 | `live-table-worker.ts` | start/stop 无引用计数，多个 server 实例会互相误停 | 改为引用计数 |
| 5 | `admin/live-discovery.ts` | 非法 `purpose` 静默降级；automatic 目的未把间隔传给缓存 TTL | 非法值改 400（与 live-schemas 一致）；automatic 从 discovery 配置取 `intervalMs` 传给 TTL |
| 6 | `admin/live-discovery.ts` | 列级深查的 `SchemaStructureError` 未捕获，直接冒泡成 500 | 捕获 → 逐表 `error` + `TABLE_LIST_UNSUPPORTED` / 404 / 400 |
| 7 | `admin/live-discovery.ts` | `GET /discovery` 返回 config 内的旧代次 | 改返回当前 `displayGenerations().L` |
| 8 | `live-table-discovery.ts` | `computeReconciliation` 两侧大小写不一致，误报差异 | 统一 lower-case |
| 9 | `import-scope.ts` | Manifest 类型词表与 `mapColumnType` 不一致（`boolean`），误报 changed | `normalizeManifestType()` 把 `boolean` 归一为 `string` |
| 10 | `SchemaDiscoveryCells.tsx` | **前端整页崩溃**：`tableDiff.schemas` / `discovery.schemas` / `listDiff.*` 未加可选链 | 全部加可选链；`catalog-loading.test.tsx` 验证已修复 |
| 11 | `live-tables.ts` | 末尾多余地再导出 `SchemaStructureError` / `assertSchemaIdent` | 删除多余再导出 |

### 外部独立审查

本机 Codex MCP（`mcp__codex-local__codex`）三次调用（含显式 `cwd` 与 `sandbox: read-only`）均返回 `workspace routing discovery timed out`，**未取得独立外部审查结论**。自审已按上表逐条修复，但缺少第二意见。

### 全量测试归因（HEAD 同工作区基线对照）

归因方法：`git stash push -u` → 回到 HEAD 基线跑全量 → `git stash pop` 恢复（**必须在同一工作区、同一 cwd**，因为 `webui/config/access.yaml`、`semantic-layer/*` 等是 gitignored 的本地数据，`git worktree` 出来的基线不等价）。

| 跑批 | 文件数 | 失败 | 结论 |
|---|---|---|---|
| HEAD 基线（stash 后） | 340 | 1（`audit-reconciliation-routes` D-20） | D-20 为**既有失败**，与本工单无关 |
| 树稳定后复跑（含本工单全部改动） | 345 | **1（同一个 D-20）** | 本工单未引入任何新的失败 |

本工单相关的 4 个后端测试文件 **72/72 通过**，`src/__tests__/connection-overview.test.tsx` **48/48 通过**，`api.semantic-assets.reindex.test.ts` **9/9 通过**（此前一次全量中该文件偶发 404，单独跑与组合跑均 9/9，判定为并发工作流改动中途造成的污染，非本工单缺陷）。

### 第二轮静态 Code Review（2026-10-27，独立会话）

第一轮自审已修 11 处。第二轮由另一会话按 Spec 190 v0.3 正文逐条复核，**发现 8 处仍不满足 Spec 的缺陷**（第一轮自审未覆盖到），全部已修并补了回归测试。

| # | 位置 | 缺陷 | 违反 | 处置 |
|---|---|---|---|---|
| 1 | `live-tables.ts` | 满页判定用**解析后**的行数；`parseTableRows` 会丢弃畸形行 ⇒ 满页（10000 行）里只要有 1 行畸形，判定就变成 9999 < 上限，**截断的表清单被当成完整结果返回** | SC-5「不返回部分表」 | 改用原始行数 `rawRowCount(result.json)` 判定（与 `schema-structure.ts` 的列行查询同口径） |
| 2 | `live-table-discovery.ts` | **后台轮询完全绕过专用探测队列**：`defaultReadTables` 直接调 `readLiveTables`，`liveTableProbeScheduler` 只服务人工读 ⇒ ①并发 1 的闸门对轮询无效（轮询可与人工读同时打库）②自动目的永远拿不到 `PROBE_QUEUE_FULL` / `PROBE_QUEUE_TIMEOUT`，§9.2「队列满 / 排队超时」对后台路径不可达 | SC-32「库表查询走独立队列配额」、§9.2 | 后台轮询改走 `liveTableProbeScheduler.submit`；调度器错误映射成封闭词表里的 reason，Schema 级隔离、下一轮重试 |
| 3 | `admin/live-discovery.ts` | Manifest 按 `entry.schema === schema` **精确大小写**过滤，而 `readManifestTableDetails` 返回的 schema 是 Manifest 原文 ⇒ `ktx.yaml` 写 `fin`、Manifest 写 `Fin` 时，Manifest 整段被丢弃 ⇒ `missingInManifest` 把库内每张表都报成「本地没有」（假阳性），`notInLibrary` 恒为空（漏报） | §8.3；第一轮自审第 8 项只修了一半（只统一了 `computeReconciliation` 内部，**被过滤掉的行根本进不来**） | schema 比较改为大小写不敏感，与同函数里 `enabled_tables` 的既有口径一致 |
| 4 | `admin/live-discovery.ts` | 列级深查按 `column.table === table` **精确大小写**匹配库表 ⇒ 请求 `tables=Ledger` 而库里是 `ledger` 时报 `not_in_library`（假阴性） | §7.4；与 Spec 183 `normalizeRef` 口径不一致 | 库表名比较改为大小写不敏感；Manifest 侧索引改为「Schema 内表名」，不再依赖 Manifest 的 schema 拼写 |
| 5 | `admin/live-discovery.ts` | `const enabled = body.enabled === true` ⇒ 请求体缺 `enabled` 或类型错时**静默当成 false**，一个格式错误的请求就关掉了已开启的持续感知 | §7.7 请求体 `{ enabled: boolean; intervalMs: number }` | `enabled` 非布尔 → `400 BAD_REQUEST`，配置不变 |
| 6 | `admin/live-discovery.ts` | `GET /discovery` 对**不存在的连接**返回 200 + `never_run`（`table-diff` 因 `readEnabledTables` 顺带抛 404，`discovery` 没有这层） | 与 `live-tables`、`import-scope` 的 404 契约不一致 | 两个端点都显式校验连接存在 → `404 CONNECTION_NOT_FOUND`（显式契约，不再依赖 helper 的副作用） |
| 7 | `admin/live-discovery.ts` | 列级深查的审计事件 `latencyMs` 恒为 `0`，不满足 §7.8 的「耗时」字段 | §7.8 | 记录实际耗时 |
| 8 | `live-table-discovery.ts` | 后台路径把 `currentGeneration` 传成常量 `() => input.generation` ⇒ `readLiveTables` 里「代次变了就不入缓存」的守卫对后台路径恒真 | SC-9 | 传真实代次读取器；代次失效由探测队列本身拦（`GENERATION_INVALIDATED`） |
| 9 | `docs/qa/selector-contract.md` | 新增的 **6 个 `data-testid` 全部未登记** ⇒ `npm run e2e:selector-contract` 直接失败（门禁规则 1「实现新增 testid 但契约表没登记 → fail」）。第一轮自审只跑了 vitest / lint，没跑这个 e2e 前置门禁 | e2e 契约门禁 | 在契约表新增 §2.7（`SchemaDiscoveryCells.tsx`）与 §2.1 的 `connection-discovery-notice-${conn.id}`；同时修正 §2.1 里已过期的列清单（原写 `Schema / Manifest 状态 / 本地表数 / 启用表数 / 操作`，现为 8 列） |

#### 变异测试：新增断言逐条证伪（8 处）

「测试通过」不等于「断言在测目标」。每处修复都临时破坏被测逻辑，确认对应断言**转红**，再逐字节还原（用文件备份 + `cp` 还原，**未**使用 `git stash` / `git checkout --`，避免污染并发会话）。

| 变异 | 破坏什么 | 结果 |
|---|---|---|
| M1 | 满页判定改回解析行数 | 🔴 断言转红 |
| M2 | 后台轮询改回直连 `readLiveTables`（绕过队列） | 🔴 断言转红 |
| M3 | Manifest schema 比较改回精确大小写 | 🔴 断言转红 |
| M4 | 库表名比较改回精确大小写 | 🔴 断言转红 |
| M5 | 去掉 `enabled` 布尔校验 | 🔴 断言转红 |
| M6 | 去掉 `table-diff` 的 404 校验 | 🟢 **仍绿** —— 该 404 本来就由 `readEnabledTables` 顺带抛出；**新加的显式校验不是承重项**，如实记录 |
| M6b | 去掉 `GET /discovery` 的 404 校验 | 🔴 断言转红 |
| M7 | 审计 `latencyMs` 改回 0 | 🔴 断言转红 |

> M6 的结论要写清楚：`table-diff` 的 404 是**既有行为**（`readEnabledTables` 对未知连接抛 `CONNECTION_NOT_FOUND`）。本轮新增的**承重**行为是 `GET /discovery` 的 404（M6b 证伪成功）。

#### 新增回归测试（7 例，全部落在既有 SC 映射文件内）

| 用例 | 文件 | 锁定 |
|---|---|---|
| 满页含 1 行畸形仍判 `TABLE_LIST_TOO_LARGE` | `server/__tests__/live-tables.test.ts` | SC-5 |
| 后台轮询走专用队列（队列满 → `PROBE_QUEUE_FULL` + Schema 级隔离） | `server/__tests__/continuous-discovery.test.ts` | SC-32 |
| `PUT` 缺 `enabled` → 400 且配置不变 | `server/__tests__/continuous-discovery.test.ts` | SC-23 |
| Manifest / 库表名大小写不敏感 | `server/__tests__/table-diff.test.ts` | §8.3 / SC-33 |
| 深查审计记录真实耗时 | `server/__tests__/table-diff.test.ts` | SC-30 |
| 未知连接 → 404（`table-diff` + `discovery`） | `server/__tests__/table-diff.test.ts` | SC-2 同构 |

### 并发工作流对本轮验证的影响（重要）
同一工作区 `/Users/forrest/GitHub/project-lucy` 内**同时存在其它 agent 会话**（Spec 189 / Spec 191），它们在验证期间持续改动同一批文件（`server/index.ts`、`server/admin/audit.ts`、`server/__tests__/mcp-runtime-reload.test.ts`、`scripts/runtime/docker-entrypoint.sh` 等）。由此产生的两个实际后果：

1. **中途的全量结果不可采信**：一次跑批曾报「3 文件 / 6 用例失败」，其中 4 个失败来自并发会话正在改写的 `mcp-runtime-reload.test.ts`，1 个是 D-20 既有失败，1 个 reindex 偶发 404 —— 树稳定后复跑三者全部通过或归因完毕。
2. **`git stash` 式归因在本工作区不安全**：并发会话在 stash 与 pop 之间改写文件，会导致 pop 部分应用（本次实测丢失 21 个文件的改动，已从 stash 精确补齐并逐字节校验）。**后续若仍需基线对照，须先确认无并发会话在写同一工作区。**

本工单的改动文件与其它工作流在 `server/index.ts`、`server/admin/audit.ts`、`src/lib/types.ts` 上存在**文件级**重叠（非行级），合并前需人工确认这些文件同时包含双方改动。

## 验证命令

```bash
cd webui
npm run lint:terminology
npx vitest run --maxWorkers=1 server/__tests__/live-tables.test.ts server/__tests__/continuous-discovery.test.ts server/__tests__/table-diff.test.ts server/__tests__/spec-183-import-scope-preview.test.ts src/__tests__/connection-overview.test.tsx
npm run e2e:selector-contract   # e2e 前置门禁：实现里的 testid 必须在契约表登记

cd ..
npm run lint:spec
```

实测结果（2026-10-27，第二轮审查后）：

| 项 | 结果 |
|---|---|
| `lint:terminology` | **PASS**（997 files scanned） |
| `e2e:selector-contract` | 本工单的 **6 个 testid 登记后已清除**；剩余 **26 条全部属其它会话**（OIDC 绑定面板 18 条 + Spec 191 `mcp-runtime-reload-*` 2 条 + 其它），不属本工单 |
| Spec 190 相关 5 文件 | **127/127 通过**（第一轮 120 例 + 本轮新增 7 例回归） |
| `lint:spec` | **FAIL api-spec**：`webui/docs/03-api-spec.md: missing /api/admin/mcp-runtime/reload`。**与本工单无关**——该端点属 Spec 191（注册于 `webui/server/admin/mcp-runtime.ts:559`），是并发会话已提交但未补文档的缺口。Spec 190 自己的 5 条路由（`live-tables` / `table-diff` / `table-structure-diff` / `discovery` GET+PUT）均已在 `03-api-spec.md` 登记 |
| 全量（共享工作区） | **346 文件 / 4161 通过 / 3 失败**：`audit-reconciliation-routes` D-20（既有失败，且正属并发 Spec 189 的改动面 `server/admin/reconciliation.ts`）、`api.catalog-assets`、`api.save` |
| 全量（`/tmp` 基线副本，**代码回退到修复前**） | **348 文件 / 4180 通过 / 9 失败** = 上面的 D-20 + `admin-audit`（WorkBuddy 用例）+ **本轮新增的 7 条回归断言全部转红** |

**归因结论**：基线副本里失败的 9 条中，有 7 条正是本轮新增的回归断言（证明它们是承重的，不是恒真）；除 D-20 外没有其它新增失败。反向说明：**本轮 8 处修复没有引入任何新失败**，而共享工作区里 `api.catalog-assets` / `api.save` / `admin-audit` 这三条只在全量跑批时失败、单独跑 3/3 全过，属**顺序/状态相关的既有污染**（并发 Spec 189 会话正在改 `server/admin/reconciliation.ts`、`server/admin/audit.ts`、`server/proxy/audit-classification.ts`），不归本工单。

> ⚠️ 基线对照的做法（**不是** `git stash`）：把整棵工作区 `rsync` 到 `/tmp/spec190-baseline`，在副本里把 3 个生产文件回退成修复前状态再跑全量。两个坑：① `rsync --exclude node_modules` 会命中**任意层级**，副本的 `webui/node_modules` 会缺失，必须单独软链回去；② 在软链 node_modules 下用 `npx vitest` 会去联网装包（`ECONNREFUSED`）并**以「成功退出但无输出」收场**——极易被误读成「基线通过」，必须直接用 `./node_modules/.bin/vitest`。

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
