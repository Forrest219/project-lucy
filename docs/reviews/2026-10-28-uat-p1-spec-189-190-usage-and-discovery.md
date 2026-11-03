# 2026-10-28 P1 预发布 UAT：Spec 189 用量口径 / Spec 190 库表发现

本轮只做预发布验收取证。未改产品代码、规格或配置，未提交 git，未构建镜像，未清 volume，未查询生产阿里云库。结论词汇只用 `passed_automation` / `failed` / `blocked` / `not_run`。本报告不给出 UAT 通过。

## 结论

Spec 189 与 Spec 190 在本轮允许的隔离 Vitest 范围内全部通过，没有失败用例，也没有新的实现缺陷。这只证明点名夹具自动化可重复，不证明两条规格已经验收完成。

Spec 189 文首写着自动化已通过、浏览器与 Docker 未做；§11 仍写「实施中（T1～T6 已完成）；未验收」。这是规格漂移，本轮不改规格。§10 声称的全量 350 文件 / 4213 通过，本轮按指令没有重跑。

Spec 190 夹具侧 SC-1～SC-34 的映射文件本轮重跑通过。真实存量客户连接对账仍然 `blocked`（仓内没有客户样本，本轮不编造基线）。`http://127.0.0.1:55176/api/health` 连接被拒绝，演示库上的 Docker 发现记为 `not_run`，没有启动构建。

## 范围

| 项 | 取值 |
|---|---|
| 仓库 | `/Users/forrest/GitHub/project-lucy` |
| 分支 / HEAD | `lucy-v0.25` / `17fdaf0850e27dbb724cf932f9d51e9af5d72815` |
| 工作区 | 产品代码相对该 HEAD 无未提交改动。未提交的文档（含 L25-16 / 运维控制面相关 docs）按指令忽略，未纳入结论 |
| Spec 189 | `webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md` §9 SC-01～SC-18；§10 点名文件 |
| Spec 190 | `webui/docs/190-live-table-discovery-and-continuous-sync-spec.md` §11 SC-1～SC-34；工单 `webui/docs/plans/wo-202610-26-live-table-discovery-and-continuous-sync.md` 的夹具映射 |
| 环境 | Node `v24.14.1`，`better-sqlite3@12.11.1`。分类对账用例在内存 SQLite 上真实执行，189 无跳过；190 JSON 报告 `numPendingTests = 0` |
| 明确不做 | 全量 Vitest、`lint:terminology`、`lint:spec`、`kpi-contracts` 单文件、`tsc`、`npm run build`、浏览器、镜像重建、生产库、客户样本对账 |

## 命令与结果

工作目录均为 `webui/`。每个命令单独设置 `KTX_PROJECT_ROOT=$(mktemp -d)`，`--maxWorkers=1`。

### Spec 189

```bash
KTX_PROJECT_ROOT=$(mktemp -d) npx vitest run --maxWorkers=1 \
  server/__tests__/usage-classification.test.ts \
  server/__tests__/usage-baseline.test.ts \
  server/__tests__/usage-governance.test.ts \
  server/__tests__/usage-metrics-cross-page.test.ts \
  server/__tests__/eval-monitor-field.test.ts \
  server/__tests__/admin-governance-observability.test.ts
```

Vitest 4.1.9，开始于 2026-10-28 22:42:11，耗时 5.12s，退出码 0。

| 文件 | 结果 |
|---|---|
| `server/__tests__/usage-classification.test.ts` | 18 passed |
| `server/__tests__/usage-baseline.test.ts` | 18 passed |
| `server/__tests__/usage-governance.test.ts` | 6 passed |
| `server/__tests__/usage-metrics-cross-page.test.ts` | 8 passed |
| `server/__tests__/eval-monitor-field.test.ts` | 5 passed |
| `server/__tests__/admin-governance-observability.test.ts` | 8 passed |
| 合计 | **6 文件 / 63 passed / 0 failed** |

`admin-governance-observability.test.ts` 含 SC-14：审计库不可用时窗口指标为 `null`，`metricsState = "unavailable"`，高拒绝 Agent 数也不被折成 0。该文件其余既有用例一并通过。

### Spec 190

```bash
KTX_PROJECT_ROOT=$(mktemp -d) npx vitest run --maxWorkers=1 \
  server/__tests__/live-tables.test.ts \
  server/__tests__/continuous-discovery.test.ts \
  server/__tests__/table-diff.test.ts \
  server/__tests__/spec-183-import-scope-preview.test.ts \
  src/__tests__/connection-overview.test.tsx
```

退出码 0，墙钟约 7.5s。JSON 报告：`numTotalTests = 127`，`numPassedTests = 127`，`numFailedTests = 0`，`success = true`。

| 文件 | 结果 | 与矩阵的关系 |
|---|---|---|
| `server/__tests__/live-tables.test.ts` | 25 passed | SC-1～SC-10、SC-28，以及 SC-5 满页含畸形行 |
| `server/__tests__/continuous-discovery.test.ts` | 26 passed | SC-9、SC-11～SC-24、SC-27、SC-29～SC-32 |
| `server/__tests__/table-diff.test.ts` | 11 passed | SC-2（table-diff / discovery 404）、SC-15～SC-17、SC-20、SC-30、SC-33 |
| `server/__tests__/spec-183-import-scope-preview.test.ts` | 17 passed | 其中 SC-25、SC-26 的来源优先级；同文件其余接入预览用例也通过 |
| `src/__tests__/connection-overview.test.tsx` | 48 passed | 其中 SC-34 组件断言；同文件其余连接概览用例也通过 |
| 合计 | **5 文件 / 127 passed / 0 failed** | 与工单收口时记录的 127/127 一致 |

`connection-overview` 运行日志出现一次 jsdom 提示 `Not implemented: navigation to another Document`。该文件 48 个用例仍全部通过，本轮不单列为缺陷。

### 健康检查

```bash
curl -sS -o /tmp/lucy-health-body.txt -w "health_http=%{http_code}\n" --max-time 5 \
  http://127.0.0.1:55176/api/health
```

`curl: (7) Failed to connect to 127.0.0.1 port 55176`，HTTP 状态不是 200。按指令，针对演示连接的 Docker 发现记 `not_run`。未探测、未启动 Lucy，也未用 `127.0.0.1:53306` 自行做对账。

## Spec 189 矩阵

判定规则：工单映射文件全部落在本轮命令内且通过，记 `passed_automation`。映射文件有缺，整条记 `not_run`，备注里写本轮已经跑过的片段。片段通过不等于该 SC 本轮闭环。

| ID | 优先级 | 本轮 | 说明 |
|---|---|---|---|
| SC-01 | P0 | passed_automation | `usage-baseline`、`usage-governance`。协议专属 Agent 的 `usageCallsLast7d = 0`；overview 默认用量 73，协议 / 探针 Agent 不进活跃集合 |
| SC-02 | P0 | passed_automation | `usage-baseline`：`usageCallsLast7d = 0`、`usageActiveAgentCountLast7d` 与协议计数。映射文件内未见「最近 MCP 访问更新且最近业务使用不更新」的独立断言，该句与 SC-15 的页面用例重叠，见 SC-15 |
| SC-03 | P0 | not_run | 映射含 `tokens-page.test.tsx`、`admin-tokens.test.ts`，本轮未跑。`usage-governance` 中 Token 排行排除探针且 `activeInWindow = false` 已通过，只覆盖片段 |
| SC-04 | P0 | not_run | 映射含 `call-monitor.test.ts`，本轮未跑。`usage-governance` 的 overview / agents / denials，以及 `usage-metrics-cross-page` 里 24h 调用监控与 overview 同为 73，已通过 |
| SC-05 | P0 | not_run | 映射含 `admin-audit.test.ts`、`observability.test.ts`，本轮未跑。`usage-metrics-cross-page` 已断言默认审计 75、`includeProtocol=true` 为 87、差额 12 |
| SC-06 | P0 | not_run | 映射文件 `object-detail-drawer.test.tsx` 不在 §10 点名集合内 |
| SC-07 | P0 | not_run | 三份 access-map 测试不在点名集合内 |
| SC-08 | P0 | not_run | `eval-monitor-field`、`usage-baseline`、`usage-governance` 已通过（现场 55、探针退出默认用量、Governance 排除探针）。`admin-risk-review.test.ts`、`admin-release-readiness-package.test.ts` 未跑。跨页用例另断言发布就绪 `totalCalls = 73`、配置资产合计 59 |
| SC-09 | P0 | passed_automation | `usage-baseline`、`usage-classification`：无 `eval_mark` 的名称命中仍进默认用量 |
| SC-10 | P0 | passed_automation | `usage-baseline` 内含高流量 Gate dry-run：协议 / 探针不触发，51 次 Raw Business 为 P1 `warn`。独立文件 `access-governance-gate.test.ts` 未纳入本轮命令 |
| SC-11 | P0 | passed_automation | `usage-baseline` 与跨页用例：`calls = business + protocol`，`business = usage + evalProbe`。抽屉不把 `callsLast7d` 显示成业务调用属 SC-06，本轮 not_run |
| SC-12 | P0 | passed_automation | `usage-classification`：11 个准入方法与分类表一致，新增准入方法会因表不同步失败；TS 与 SQLite 同夹具计数一致；integer `eval_mark`、大小写、`server/*`、非法 / 空 `args_summary` 有断言 |
| SC-13 | P0 | passed_automation | 分类侧 5200 行聚合不截断；roles 路径 `compatTruncation.auditRowsLimit = null`，夹具 Role 用量 55 |
| SC-14 | P0 | passed_automation | `usage-baseline` 前缀碰撞为 `partial` 且凭据值为 null；`admin-governance-observability` 不可用时窗口指标为 null，无一为 0 |
| SC-15 | P1 | not_run | 映射 `kpi-contracts.test.ts`、`agent-list.test.tsx`，本轮未跑 |
| SC-16 | P1 | passed_automation | overview 活跃分子 21、配置分母 20，`agentActiveRatePartial = true`，费率为 null；跨页人口差 14 |
| SC-17 | P1 | not_run | 映射的调用监控四窗口、访问关系图三窗口、导出、Risk Review、Role 拒绝归属、`question-budget` 未跑。本轮仅重跑到 `eval-monitor-field` 与跨页发布就绪片段 |
| SC-18 | P1 | not_run | 要求 `lint:terminology`、`kpi-contracts`、相关全套前后端测试、构建与类型检查。本轮按指令只跑 §10 点名文件，不重跑全量，因此不沿用 2026-10-27 的 350 / 4213 记录作为本轮证据 |

跨页夹具在已跑用例中的数字与 §10 记录一致：Default Usage 73（全量身份）/ 59（配置资产）；Raw Business = Default Usage + 2；Raw Audit = Raw Business + 12；人口边界 14；活跃率分子大于分母时为 `partial`。

## Spec 190 矩阵

夹具层按工单映射重跑，SC-1～SC-34 均为 `passed_automation`。这是假 provider / 组件夹具结果。真实存量连接对账不在下表逐条改写，统一见后文 `blocked`。

| ID | 本轮 | 证据文件 |
|---|---|---|
| SC-1 | passed_automation | `live-tables.test.ts`：缺 schema / 非法 schema → 400，不连库 |
| SC-2 | passed_automation | `live-tables.test.ts` 未知连接 404；`table-diff.test.ts` 对 `table-diff` 与 `discovery` 同为 404 |
| SC-3 | passed_automation | `live-tables.test.ts`：`PROTOCOL_UNSUPPORTED` |
| SC-4 | passed_automation | `live-tables.test.ts`：sqlserver / oracle → `TABLE_LIST_UNSUPPORTED` |
| SC-5 | passed_automation | `live-tables.test.ts`：满页与满页含畸形行均为 `TABLE_LIST_TOO_LARGE`，不返回部分表 |
| SC-6 | passed_automation | `live-tables.test.ts`：`PROBE_QUEUE_FULL`，非 500 |
| SC-7 | passed_automation | `live-tables.test.ts`：`PROBE_QUEUE_TIMEOUT` / `GENERATION_INVALIDATED` |
| SC-8 | passed_automation | `live-tables.test.ts`：同代次人工重复读取 `cached: true` |
| SC-9 | passed_automation | `live-tables.test.ts` 旧代次不返回、不入缓存；`continuous-discovery.test.ts` 代次变化作废快照与基线 |
| SC-10 | passed_automation | `live-tables.test.ts`：无法区分不存在与不可见时归 `SCHEMA_NOT_VISIBLE` |
| SC-11 | passed_automation | `continuous-discovery.test.ts`：一个 Schema 失败，其余继续 |
| SC-12 | passed_automation | `continuous-discovery.test.ts`：退避，10 次后 `paused` 且不再自动重试 |
| SC-13 | passed_automation | `continuous-discovery.test.ts`：成功一次后计数清零并退出退避 |
| SC-14 | passed_automation | `continuous-discovery.test.ts`：连接级 `partial` / `error` / `paused` |
| SC-15 | passed_automation | `continuous-discovery.test.ts`、`table-diff.test.ts`：新增表进 `listDiff.added`，本地 Manifest 与 `enabled_tables` 不变 |
| SC-16 | passed_automation | 同上：消失表进 `listDiff.missing`，本地条目不删 |
| SC-17 | passed_automation | 同上：列数变化带 before / after |
| SC-18 | passed_automation | `continuous-discovery.test.ts`：首轮建基线与对账状态，无变更事件 |
| SC-19 | passed_automation | `continuous-discovery.test.ts`：写盘失败则快照与基线不推进，下一轮重报 |
| SC-20 | passed_automation | `continuous-discovery.test.ts`、`table-diff.test.ts`：恢复后当前状态不含该表，事件历史保留 |
| SC-21 | passed_automation | `continuous-discovery.test.ts`：事件只追加、限量 50，不参与当前状态 |
| SC-22 | passed_automation | `continuous-discovery.test.ts`：未开启则后台不查库 |
| SC-23 | passed_automation | `continuous-discovery.test.ts`：越界 `intervalMs` 与缺失布尔 `enabled` 均为 400，配置不变 |
| SC-24 | passed_automation | `continuous-discovery.test.ts`：非 owner 拒绝，配置不变 |
| SC-25 | passed_automation | `spec-183-import-scope-preview.test.ts`：同代次快照填入 `discovered`，`discoverySource: "continuous"`；旧代次与无快照为 `"none"` |
| SC-26 | passed_automation | 同上：显式 `discovered` 优先，`discoverySource: "manual"` |
| SC-27 | passed_automation | `continuous-discovery.test.ts`：无差异轮次仍推进最新成功快照 |
| SC-28 | passed_automation | `live-tables.test.ts`：自动目的不命中人工 10 分钟缓存 |
| SC-29 | passed_automation | `continuous-discovery.test.ts`：重启后从 sidecar 恢复快照、事件、配置与失败状态 |
| SC-30 | passed_automation | `continuous-discovery.test.ts` 每次库表查询一条审计；`table-diff.test.ts` 深查记录耗时 |
| SC-31 | passed_automation | `continuous-discovery.test.ts`：原子写、模式 `0600`、不含列值 |
| SC-32 | passed_automation | `continuous-discovery.test.ts`：独立队列配额；后台轮询与人工读共用该队列 |
| SC-33 | passed_automation | `table-diff.test.ts`：列级 added / removed / changed；大小写不敏感匹配 |
| SC-34 | passed_automation | `connection-overview.test.tsx`：库内表清单入口、持续感知状态、差异计数；暂停时行内原因与连接卡「持续感知已暂停」 |

Spec 190 文首状态是「已实现，待验收」。本轮夹具通过不改变该状态。浏览器测试规格 §12 未强制；本轮也没有做浏览器，不把 SC-34 升级成 UAT 通过。

## 缺陷

| ID | 分类 | 对象 | 说明 |
|---|---|---|---|
| — | implementation_bug | — | 本轮 0。重跑用例没有失败，没有据此要求改发现或用量实现 |
| SD-1 | spec_drift | Spec 189 文首 vs §11 | 见下一节。本轮不改规格 |
| SD-2 | spec_drift | Spec 189 §10 vs 同节噪声段 vs 工单 SC-18 行 | 见下一节。本轮未重跑全量，不能裁定哪一个数字才是当时的真实结果 |
| — | out_of_scope | — | 本轮 0。工单里「`lint:spec` 因 Spec 191 未登记 `/api/admin/mcp-runtime/reload` 而红」本轮没有复跑，不新开缺陷 |

## 规格漂移

**SD-1。** `webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md` 文首状态为：「已实施（WO-202610-28 T1～T6 已完成）；自动化验收通过（见 §10）；未做浏览器／Docker 验证」。§11 仍写：当前为「实施中（T1～T6 已完成）；未验收」。两处对「是否已经验收」的说法不一致。§10 同时写明浏览器、移动窄屏、Docker 镜像重建、客户包发布保持未验收。按 SC-18，未执行项不得标记为已验收。本轮只记录，不修改该规格。

**SD-2。** 同一规格 §10 表格写全量 **350 文件 / 4213 通过 / 0 失败**；同节「已知环境噪声」又写独占全量 **350 文件 / 4212 通过 / 0 失败**。工单 `webui/docs/plans/wo-202610-28-usage-metrics-truthfulness.md` 的 SC-18 行写的是 **349 文件 / 4205 通过 / 0 失败**。三处不能同时作为同一次全量的证据。本轮没有重跑全量，所以这三组数字都停留在历史声称。

Spec 190 文首「已实现，待验收」与工单「夹具侧 SC-1～SC-34 全过；真实存量连接对账未做」一致，本轮不把这记成漂移。

## blocked / not_run

| 项 | 状态 | 原因 |
|---|---|---|
| Spec 190 真实存量客户连接只读对账（规格 §10 P3/P7、§12；工单未完成项 3） | blocked | 仓内无客户样本。本轮禁止编造客户基线，也禁止查询生产阿里云库 |
| 演示 MySQL（`127.0.0.1:53306`）上经 Lucy 的库表发现 | not_run | `127.0.0.1:55176` 无进程监听，`/api/health` 不是 200。按指令不启动构建、不拉起服务 |
| Spec 189 SC-03、SC-04、SC-05、SC-06、SC-07、SC-08、SC-15、SC-17 | not_run | 验收映射文件不在本轮允许的 §10 点名集合内。已跑片段见矩阵备注，不升格为整条通过 |
| Spec 189 SC-18（术语 lint、KPI 契约、全量相关测试、构建、`tsc`） | not_run | 指令禁止全量套件。§10 的 2026-10-27 记录不作为本轮证据 |
| Spec 189 / 190 浏览器与移动窄屏 | not_run | 两份规格与工单均写明默认不做；本轮指令也未要求浏览器 |
| Spec 190 工单中的 T0 `ktx scan`、P4 文档对账、`lint:spec` | not_run | 不在本轮夹具命令内。`lint:spec` 的历史红灯工单已指向 Spec 191，本轮不复跑、不改归属 |

## 一轮修复建议

1. 先改 Spec 189 的状态句，让文首与 §11 使用同一句验收状态。在浏览器 / Docker 仍未执行时，保持「未验收」，不要让文首单独写成自动化验收已通过。同时把 §10 的 4213、同节的 4212、工单 SC-18 的 349/4205 收成一份可追溯记录；未重跑全量之前，不要再引用其中任何一个作为当前 HEAD 的全量证据。这一步只改文档，不改用量实现。
2. 下一轮自动化补齐本报告标成 `not_run` 的 Spec 189 映射文件：`tokens-page`、`admin-tokens`、`call-monitor`、`admin-audit`、`observability`、`object-detail-drawer`、三份 access-map、`admin-risk-review`、`admin-release-readiness-package`、`kpi-contracts`、`agent-list`，以及 SC-17 其余窗口 / 导出 / Role 用例。仍用隔离 `KTX_PROJECT_ROOT` 与 `--maxWorkers=1`。SC-18 若要关闭，再单独跑术语 lint、构建和类型检查，而不是把本轮 63 个用例写成全量通过。
3. Spec 190 夹具无需因本轮结果改代码。关闭「待验收」之前，仍要有一份真实存量连接的只读对账样本；演示库在 `:55176` 恢复之后可以另做发现冒烟，该冒烟不能代替客户基线。
4. 本轮没有 `implementation_bug`。不要为了这次 UAT 追加发现能力或用量指标。
