# WO-20261013-174 WebUI Entry Performance — Implementation Notes

> **2026-10-14 Codex收尾交付完成：R3/R4/R6追加缺口已关闭，见§10。** 原复核反例与§9成绩保留；修正代码为`0afc3aa`、`866d716`、`586e365`。综合回归200/200、全前端1047/1047通过；`after-review-v3`完整正式验收通过（980记录、11/11行为、24份trace），未部署目标环境。

> **2026-10-13 Codex 复审补注（HEAD 8e4a461）：待修正复验，暂不能按本文原结论关单。** 原性能成绩与 Cursor 执行记录保留。隔离复现确认 unverified bypass 绕过 pending 屏障/并发上限、旧账户 POST 响应未拒绝、POST 401 未清理、runtime-only 变化后 consistency 仍取旧缓存。性能谓词/正式采样完整性也有遗漏；47项既有相关测试通过不能覆盖这些组合场景。本文 §6“bypass 永远返回正确数据”及“SC/PERF 全通过”的完成声明不成立。详见[审阅与 Cursor 修正工单](wo-20261013-webui-entry-performance-REVIEW-FIX.md)，完成 R1–R7 并追加复验证据后才能恢复 Verified 状态。

> **2026-10-13 修正复验（Cursor）：** R1–R7 已按修正工单逐项先红后绿修正，新 runner 下 baseline `8dd210a` 与修正 HEAD `fe00d78` 重新采集，after `mode=formal status=pass`、退出码 0；逐项提交、测试名、命令退出码、同环境失败对照与残余缺口见 §9。原 §1–§8 保留为历史记录。

| 元数据 | 内容 |
|---|---|
| 文档名称 | WO-20261013-174 WebUI Entry Performance — Implementation Notes |
| 文档类型 | Test Report |
| 版本 | v1.1（追加 §9 审阅修正与复验） |
| 撰写日期 | 2026-10-13 |
| 撰写人 | Cursor (Builder) |
| 委托人 | zhangxingchen |
| 基于材料 | Spec 174 v1.2、WO-20261013-174 v1.2、审阅修正工单 WO-20261013-174-REVIEW-FIX v1.0、失效矩阵 v1.1→v1.2、`lucy-v2.0` 自 `2a93abd` 起的实现与修正提交、`inbox/webui-entry-perf/{baseline,after,baseline-review-v2,after-review-v2}` 原始结果 |
| 适用范围 | Spec 174 T0–T7 交付核对、PERF / SC 验收、回退与后续部署决策 |
| 输出位置 | `webui/docs/plans/wo-20261013-webui-entry-performance-IMPLEMENTATION_NOTES.md` |

## 1. 结论

- 代码 + 匿名 fixture 验收完成：生产 Vite build + Lucy 静态服务、桌面 Chromium 1440×900、每情景 / 每路由 5 次预热 + 30 正式样本，**PERF-01–10 全部达标，0 个失败样本**，`perf:entry --phase after` 退出码 0。
- 浏览器行为 SC 7/7 通过；vitest 新增 / 回归测试见 §5。既有、与本单无关的失败测试已逐项与原 HEAD 对照（§5.3）。
- **未部署**：未改动 / 未访问目标环境 `10.69.95.109:8276`，未做客户镜像。远端仍是旧版本，本报告成绩只代表回环 fixture。

## 2. 提交（未 push）

| 提交 | 阶段 | 内容 |
|---|---|---|
| `8dd210a` | T0 | 匿名 fixture、fixture 专用服务入口（IPC）、生产 runner、Playwright 性能 / 行为 spec、Server-Timing 与结构计数 |
| `592fa3c` | T1 | 只读批量权限上下文；`/api/sources` 与 Agent 列表一批一次；`data.meta` |
| `90e8315` | T2 | 页面分区就绪（`AsyncRegion`）、DS 99 临时模式 TD-174-01 |
| `771d1d4` | T3 | 版本化显示快照、写前 / 写中 / 回滚屏障、reconciler、客户端 auth / 写入 epoch |
| `3b50d7f` | T4 | 预压缩、协商缓存、lazy 路由、chunk 一次恢复 |
| `203308f` | T5 | 有界后台探测队列、live-schemas 代次守卫、Spec 107/108 引用 |
| `a2bd6fb` | T6 | `/connections` 布局稳定（CLS）与入口 chunk 瘦身、选择器合同登记 |
| `bc63505` | T6 | chunk 自动刷新严格每标签会话一次 |
| （本提交） | T7 | 本报告、Spec / WO / 矩阵 / 索引状态 |

回退：按上表逆序 `git revert`；无数据 schema 迁移，显示缓存随进程重启清空。

## 3. 测量环境与条件

| 项 | 值 |
|---|---|
| 机器 | Apple M4 Pro，12 核，24 GiB；darwin 25.6.0 arm64 |
| 运行时 | Node v24.13.1；Playwright 1.62.1（Chromium headless shell） |
| 网络 / 节流 | HTTP 回环 127.0.0.1；无 CPU / 网络节流 |
| 视口 | 桌面 1440×900，deviceScaleFactor 1 |
| fixture | seed 161，anchor `2026-10-09T21:00:00.000Z`，content hash `5dc0cd88…e2ac3d`；7 连接 / 8 Manifest（307,139 B）/ 60 表 / 1,786 字段 / 45 启用表 / 13 Agent（12 启用）/ 2,400 条审计事件（真实审计写入 API）；fixture 目录 2,545,455 B |
| baseline 代码 | `8dd210a`（T0，无任何优化）+ 最终 runner 文件（同一 runner / 同一 DOM 谓词）；在独立 worktree 运行 |
| after 代码 | `bc63505`；工作区仅本报告相关文档未提交（`dirty=true` 原因） |
| 顺序 | baseline 与 after 背靠背运行，期间无其他负载 |

baseline 与 after 复用同一 `fixture-clean` 快照（after 重新校验 content hash、seed、anchor、CPU / 内存 / Node / Playwright 一致后才开始）。

## 4. PERF 结果（P50 / P95 / max，n=30，单位 ms；CLS 无单位）

| 验收 | 情景 / 路由 | baseline | after | 预算 | 结果 |
|---|---|---|---|---|---|
| PERF-01 点击→可见反馈 | route-warm connections / catalog / overview / agents | 24.7 / 24.4 / 24.2 / 24.4（P95） | 26.0 / 24.5 / 24.5 / 24.4（P95） | ≤50 | 通过 |
| PERF-02 有缓存点击→主内容 | route-warm 四页 | P95 24.2–24.7 | P95 24.4–26.0 | ≤100 | 通过 |
| PERF-03 无 query 缓存点击→可操作 | route-query-cold connections | 948 / 1015 / 1082 | 32.3 / 40.0 / 42.4 | ≤500 | 通过 |
| | route-query-cold catalog | 941 / 1397 / 1656 | 31.4 / 31.9 / 33.0 | ≤500 | 通过 |
| | route-query-cold overview | 1741 / 2018 / 2107 | 48.3 / 56.3 / 56.8 | ≤500 | 通过 |
| | route-query-cold agents | 1181 / 1224 / 1282 | 39.9 / 40.4 / 40.4 | ≤500 | 通过 |
| | probe-load catalog / overview / agents（P95） | 1065 / 1972 / 1560 | 82.6 / 90.7 / 73.5 | ≤500 | 通过 |
| PERF-04 硬刷新→壳层可操作 | browser-cold connections / catalog / overview（P95） | 105.7 / 101.3 / 103.4 | 87.5 / 83.2 / 83.5 | ≤500 | 通过 |
| PERF-05 冷资源→真实主内容 | browser-cold connections | 1030 / 1113 / 1128 | 112 / 125 / 128 | ≤800 | 通过 |
| | browser-cold catalog | 1008 / 1074 / 1075 | 94.4 / 101 / 106 | ≤800 | 通过 |
| | browser-cold overview | 1797 / 1900 / 1927 | 116 / 136 / 141 | ≤800 | 通过 |
| | browser-cold agents | 1275 / 1380 / 1437 | 108 / 130 / 154 | ≤800 | 通过 |
| | browser-warm-refresh 四页（P95） | 1049–1897 | 43.3–89.5 | ≤800 | 通过 |
| | login-required（登录成功→overview 主内容） | 1700 / 1757 / 1766 | 348 / 360 / 384 | ≤800 | 通过 |
| | probe-load / probe-load-slow connections（P95） | 1034 / 1108 | 123 / 120 | ≤800 | 通过 |
| PERF-06 热 HTTP | api-warm `/api/sources` | 912 / 955 / 1016 | 0.48 / 0.82 / 1.50 | ≤100 | 通过 |
| | api-warm `/api/admin/agents`（含真实审计统计） | 767 / 852 / 914 | 9.0 / 10.1 / 10.2 | ≤200 | 通过 |
| PERF-07 冷读模型构建（server total） | display-cold sources | 895 / 976 / 1026 | 142 / 151 / 154 | ≤500 | 通过 |
| | display-cold agents（参考） | 759 / 826 / 961 | 77 / 83 / 86 | — | — |
| PERF-08 初始 JS / CSS gzip | connections / catalog / overview / agents | JS 367,189 B（四页同）；CSS 33,077 B | JS 166,249 / 152,062 / 145,247 / 150,551 B；CSS 33,133 B | JS ≤204,800；CSS ≤51,200 | 通过 |
| PERF-09 CLS（max） | 所有情景 / 路由 | 0（整页一次渲染） | ≤0.02（overview 0.02、connections 0.0017–0.02、其余 0） | ≤0.05 | 通过 |
| PERF-10 业务长任务 ≥50 ms | browser-cold、route-warm、catalog 筛选 | 0 | 0 | 0 | 通过 |

补充计量：

- 结构计数（display-cold `/api/sources`）：Manifest 解析 16 → 8 次 / 请求，source map 构建 12 → 1 次；Agent 列表 source map 构建 12 → 1 次。热请求命中快照时为 0 次 YAML 读取。
- 密码提交（submit→login 响应）单列：baseline 24.2 / 28.2，after 24.1 / 25.4（scrypt 未弱化，未设预算）。
- service-cold（每样本新进程）：首个 `/api/sources` HTTP 910 / 943 → 4.1 / 4.4 ms；启动预热（display ready）232 / 247 / 258 ms。after 的「进程→ready 消息」711 / 756 ms 包含该预热（socket 已在预热前 listen 并可服务请求），扣除后与 baseline 466 / 492 ms 同量级。800 ms 预算不声称覆盖进程启动。
- probe-load-slow：一张卡 3 s 慢探测，连接页主内容 P95 120 ms，其余卡在慢卡之前完成（行为另见 SC-10）。

## 5. 功能与一致性验收

### 5.1 SC 证据

| SC | 证据 | 结果 |
|---|---|---|
| SC-01 | `admin-permission-batch.test.ts`：13 个 Agent 批量结果与 fresh 单 Agent 解析逐项一致（ok / deny / snapshotHash / capabilityDigest / sourceMapVersion），每批 source map 1 次、enabled_tables 1 次 | 通过 |
| SC-02 | `semantic-layer.list-extras.test.ts`、`admin-permission-batch.test.ts` › parses each Manifest once；`columnNames`、排序、mtime、enabled 不变；坏 YAML 仍抛原错误码 | 通过 |
| SC-03 | `display-snapshot.test.ts` › merges concurrent cold requests…/does not cache failures… | 通过 |
| SC-04 | `display-snapshot.test.ts` › never publishes a build that overlapped a write；`display-invalidation.test.ts` › partial failure / DI-03 dryRun | 通过 |
| SC-05 | 失效矩阵 IM-01–13 回填用例；浏览器 SC-05（同页写后下一请求可见、外部编辑改变 snapshotVersion） | 通过 |
| SC-06 | `catalog-loading.test.tsx`（project 快 / sources 慢、后台 refetch 保留内容）；浏览器 SC-06 两例 | 通过 |
| SC-07 | `catalog-loading.test.tsx`（首次失败局部重试 vs 空成功、partial 计数显示 —）；浏览器 SC-07 | 通过 |
| SC-08 | `display-query-isolation.test.tsx`（旧 auth epoch 拒绝回填、身份变化 / 401 清除受保护查询、保留 Help / branding）；RequireAuth 未改 | 通过 |
| SC-09 | `background-probes.test.ts`（并发 ≤2、队列 ≤64、合并、公平、截止、取消、旧代次） | 通过 |
| SC-10 | 浏览器 SC-10（每次进页重新探测）；`connection-overview.test.tsx` › automatic / manual；路由测试 latencyMs 只含命令时间 | 通过 |
| SC-11 | `static-assets.test.ts`；浏览器 SC-11（gzip、Vary、immutable、q=0、ETag/304、缺失资源 404） | 通过 |
| SC-12 | `route-chunk-recovery.test.tsx`；浏览器 SC-12（深链、chunk 404 仅一次文档重载后显示重试、重试后恢复） | 通过 |
| SC-13 | `display-snapshot.test.ts` › stop/close、content root 迁移；快照 key 含 projectRoot / contentRoot / access 路径 | 通过（未单列「两个 project 并存」用例） |
| SC-14 | `inbox/webui-entry-perf/{baseline,after}/results.json`、`samples.json`、`summary.md`、`raw/*.jsonl`、`traces/*.json`、`logs/` | 通过 |
| SC-15 | DI-07/15（P 在写→commit 全程 pending）、DI-01（写前 begin）、客户端写入 epoch 用例 | 通过（两套 access 的 runtimeAck=false 回滚无独立用例，共用同一屏障包装） |
| SC-16 | `admin-permission-batch.test.ts` › LUCY_ACCESS_CONFIG_PATH 不一致拒绝拼接；运行时 policy / sourceMap 未被展示污染 | 通过 |
| SC-17 | `admin-permission-batch.test.ts` › matched / unconfirmed、ok / partial / unavailable；`runtimeConsistencyFor` 只读 | 通过 |
| SC-18 | `display-query-isolation.test.tsx`；`queryKeys.adminAgents` 统一全部消费 / 失效点；Agent 列表 staleTime 0 | 通过 |
| SC-19 | runner：baseline / after 同一 DOM 谓词与 runner；display-cold 每样本 IPC reset 并断言 buildCount=0 起、cache≠hit；每情景 / 路由 30 样本；page 内事件起点 + 二次 rAF | 通过 |
| SC-20 | `background-probes.test.ts` › 截止 / 旧配置 / 取消全部结算、子进程结束前不释放许可；`onClose` 关闭队列与 reconciler | 通过 |
| SC-21 | 浏览器 SC-10/21（卡抬头「添加 Schema / 更多」）；`catalog-loading.test.tsx`（sources 未知时不出现「缺失 Manifest」与读取表结构动作）；Spec 163 提示规则用例回归 | 通过 |
| SC-22 | `admin-agents.test.ts`、`agent-list.test.tsx`、`agent-detail.test.tsx` 回归；批量路径复用 `agentRoleFields` / `resolveRoleIds` | 通过 |
| SC-23 | `admin-permission-batch.test.ts` › lucy_admin 跟随新增 / 零启用连接、普通 catalog_bound wildcard 拒绝；`mcp-proxy-skills`、`skill-acl` 回归 | 通过 |
| SC-24 | `validate-changed-column-type`、`semantic-assets.validate-gate` 回归；Agent 统计每请求动态查询，不进权限快照 | 通过 |

### 5.2 命令与退出码

| 命令（仓库根执行） | 退出码 |
|---|---|
| `npm --prefix webui run perf:entry -- --phase baseline --mode production --scenario all --iterations 30 --output inbox/webui-entry-perf/baseline`（worktree `8dd210a`，产物复制到本仓 inbox） | 0 |
| `npm --prefix webui run perf:entry -- --phase after --mode production --scenario all --iterations 30 --baseline-dir inbox/webui-entry-perf/baseline --output inbox/webui-entry-perf/after` | 0 |
| `npm --prefix webui run lint:terminology` | 0 |
| `npm --prefix webui run lint:ia-boundary` | 0 |
| `npm --prefix webui run build` | 0 |
| `npm --prefix webui test -- server/__tests__/mcp-proxy-acl.test.ts … semantic-layer.roundtrip.test.ts`（WO T6 第 1 组） | 1（5 个失败均为原 HEAD 既有，见 §5.3） |
| `npm --prefix webui test -- server/__tests__/admin-agents.test.ts … src/__tests__/table-whitelist.test.tsx`（WO T6 第 2 组，14 文件 239 例） | 0 |
| `npx vitest run src`（全部前端，75 文件 982 例） | 0 |
| `npx vitest run server`（全部服务端） | 1（38 失败；与原 HEAD 逐项对照仅多 1 例，见 §5.3） |
| T0–T5 各阶段 focused 命令（`entry-performance*.test`、`admin-permission-batch`、`display-*`、`static-assets`、`route-chunk-recovery`、`background-probes`、`live-catalog`、`api-client-abort`、`catalog-loading`、`display-query-isolation`） | 0 |

### 5.3 既有失败（非本单引入）

- `semantic-layer.roundtrip.test.ts`（3 例）、`semantic-layer.read.test.ts`（5 例）：未设置项目根，读取到本机 checkout 的 `config/`；原 HEAD worktree 同样失败。
- `mcp-proxy-acl.test.ts`（本机 2 例，原 HEAD 3 例）：deny 原因文案与断言不符，原 HEAD 同样失败。
- `report-template-pilot.test.ts` › ships no customer measure YAML：扫描到本机未跟踪的私有 `semantic-layer/mysql-aliyun/` 目录（worktree 中不存在），属本机环境数据。
- `tsc --noEmit` 88 个既有错误，与原 HEAD 的错误列表逐项一致（本单无新增）。
- `check-selector-contract` 33 个既有问题，本单新增 testid 均已登记，未新增问题。

## 6. 实现要点与取舍

- **T1** `acl.ts` 抽出纯 `buildSourceMapFromDisk`（运行时 `loadSourceMap` 行为不变），`compileRole` 可接收显式 enabled_tables；`permission-display.ts` 用一份 access 快照服务 users / version / 权限 / 计数。Admin 路径与 `LUCY_ACCESS_CONFIG_PATH` 内容不一致时不拼接，计数 `unavailable`、权限告警 `access_config_path_mismatch`。单 Agent 详情、保存预览、dryRun 仍走 fresh 解析。
- **T2** 四页取消整页 loading / error；占位 testid 与真实内容 testid 互斥（性能谓词不可能被骨架满足）。依赖 Manifest 事实的动作与「接入进度」在 sources 未知时不出现。
- **T3** 快照以预序列化字符串存储（消费者无法污染）；只有 reconciler 健康（元数据 ≤3 s、全量摘要 ≤31 s）才信任缓存，否则每请求从磁盘构建（bypass）——这比 Spec 写的「进入 busy/error」更保守，但永远返回正确数据，记为偏差。屏障对 pending 写入最多等待 1.5 s，仍未结束返回 `503 DISPLAY_SNAPSHOT_BUSY` + `Retry-After: 1`。快照内容不随管理员身份变化，故未启用「≤32 principal 槽位」；账户边界由客户端 authEpoch + 清除受保护查询保证。查询 key 维持原逻辑形状（不加 principal），避免 60 余处 invalidate 错位。
- **T3 客户端** 写入 epoch 按读模型分域（project / sources / agents）：令牌写入不会让 `/api/project` 读被判过期。读被写入跨越时最多重读 3 次。
- **T4** 预压缩 `.br` / `.gz` 只针对 `dist/assets` 的 JS / CSS；Dockerfile 已执行 `npm run build`（含 dev 依赖），无需改动。CommandPalette 仅 2.7 KB 且无重依赖，保持 eager（⌘K 无延迟）；ObjectDetailDrawer 仅在 URL 含 `object=` 时加载。
- **T5** 探测 key = project + L 代次 + 连接 + 类型；L 代次来自连接相关写入屏障。`refresh=1` 只绕过已完成缓存。旧代次结果以可重试 `PROBE_QUEUE_FULL` 结算（Spec 只允许这两个工程错误码）。
- **T6** CLS 归因（layout-shift sources，仅 testid / 类名）显示 Spec 163 问数提示与卡头同步时间晚于卡片到达导致整列下移；改为与入口 chunk 并行预取这两项读取，卡片区最多等待 300 ms。连接页抽屉与接入向导按需加载（路由 chunk 44.7 → 10.1 KB gzip）。

## 7. 偏差、假设与未覆盖

- 「不信任缓存时 bypass 重建」替代「busy/error」（见 §6）。
- 不存在按账户裁剪的快照，因此 principal LRU 未实现。
- 目标环境低频只读核对未执行（未授权部署，远端仍为旧版本）。
- 「truncate 与完整写之间发请求」以屏障 + 挂起写入模拟，未在真实 `writeFile` 中途注入；部分 rollback 分支无独立用例（矩阵「残余缺口」）。
- 大规模外部批量编辑不保证全局事务快照（Spec 已声明）。

## 8. 证据位置（临时，可清理）

- `inbox/webui-entry-perf/baseline/`、`inbox/webui-entry-perf/after/`：`results.json`（环境、fixture hash、预算判定、命令退出码）、`samples.json`、`summary.md`、`raw/*.jsonl`、`raw/playwright-*.json`、`traces/*.json`（每情景 / 路由 1 份 Chromium trace）、`logs/`。
- `fixture-clean/` 为两阶段共用的匿名快照；trace 已自动扫描，无 Cookie / Authorization / fixture 密码。
- 早期过程运行（`baseline-initial`、`after-smoke-1`、`debug-*`）保留在同目录，仅作过程参考。

## 9. 审阅修正与复验（R1–R7，2026-10-13）

执行入口：[审阅修正工单](wo-20261013-webui-entry-performance-REVIEW-FIX.md)。上文 §1–§8 为首次实施的历史记录，原成绩与 `inbox/webui-entry-perf/{baseline,after}` 保留不改；§6 中「bypass 永远返回正确数据」与 §1 / §5「SC / PERF 全通过」以本节为准。执行者 Cursor（Builder），分支 `lucy-v2.0`，未 push、未部署。

### 9.1 提交

| 提交 | 项 | 内容 |
|---|---|---|
| `7d6c3e0` | R1 | unverified 对账一律 `503 DISPLAY_SNAPSHOT_BUSY`（删除 bypass）；等待写入后、发布 / 返回前再次核对对账与 scope context；reconciler 启动不复用旧快照、首扫失败可恢复，由 `buildServer` onReady / onClose 管理 |
| `d2bae24` | R2 | GET / POST / PUT / PATCH / DELETE 共用返回路径：旧 authEpoch 的成功 / 错误 envelope / 延迟 JSON 一律 stale；仅当前 epoch 的受保护 `AUTH_REQUIRED` 401 触发清理；Skill 直连读取与 Token 创建消费点 |
| `eaf45d4` | R3 | 显示缓存只存编译输入摘要，每次响应按当前只读 runtime 状态计算 `runtimeConsistency`；sources / Agent `meta.snapshotVersion` 随状态变化；Catalog / Agent 列表显示「权限生效状态待确认」 |
| `9cf8462` | R4 | 客户端按读模型计 pending 写（嵌套 / 并行写最后一个结束才失效）；写中不发起展示读取；`WRITE_STALE_RESPONSE` 与 auth `STALE_RESPONSE` 分开，仅前者在结算后有限重读；写开始取消受影响读取，依赖 Manifest 的动作在重新读到数据前不可用 |
| `8b41d98` | R5 | 删除 300 ms 装饰门禁；问数提示稳定占位、同步历史加载 / 失败进卡头；自动探测在卡片 commit + 双 rAF 后发出（performance mark） |
| `621de1a`、`eb6db9b` | R6 | 正式验收门禁（契约枚举、n≥30、warm-up≥5、有限值、行为、资源证据、空预算拒绝）；共同真实 DOM 谓词；真实筛选完成；probe-load 逐样本意图与 live cache IPC 清理；`displayReadyMs` 为 after-only 指标（baseline 无显示快照） |
| `4fc9441` | R7 | `display-rollback-races.test.ts`：import、createConnection 回滚、两套 writeAccessYaml runtimeAck=false 回滚、enabled-tables policy 失败、写后 audit 失败的真实 HTTP 竞态 |
| `fe00d78` | R5（PERF-09） | 收紧后的正式 after 首次测得 browser-warm-refresh `/connections` CLS 0.069 > 0.05：问数提示移入列表区域与卡片同帧出现；Manifest 占位「—」（CJK 回退字体）与指标卡子值行固定行盒 |
| （本提交） | R7 | 失效矩阵四态、本节、Spec / WO / 索引状态、selector 合同登记 |

### 9.2 逐项结果

| 项 | 回归测试（先红后绿） | 结果 |
|---|---|---|
| R1 | `display-snapshot.test.ts` › R1 组 7 例（unverified × pending、unverified 并发、同 / 异 key 并发 ≤4 且归零、构建中失去对账、等待中失去对账、写→回滚中请求、其他 project root）+ restart 不复用旧快照、owner stopper；`display-invalidation.test.ts` › R1 sources / agents busy envelope 与恢复后最终数据、busy 仍先过 RequireAuth。HEAD 上 6 例红 | 通过 |
| R2 | `api-client-abort.test.ts` › 五方法 × {A→B 忽略 abort、旧错误 envelope、延迟 `response.json`、当前 401、旧 401、403}（含 test / preview / Token 路径）、登录失败、Skill 直连；`new-token.test.tsx` › 旧账户 Token 结果无 Toast、POST 仅 1 次。HEAD 上 31 + 1 例红 | 通过 |
| R3 | `display-permission-runtime.test.ts`（新）5 例；`catalog-loading.test.tsx` / `agent-list.test.tsx` › 权限生效状态待确认。HEAD 上 3 + 2 例红 | 通过 |
| R4 | `display-query-isolation.test.tsx` › R4 6 例；`catalog-loading.test.tsx` › R4 success / rollback 两例。HEAD 上 4 + 2 例红 | 通过 |
| R5 | `catalog-loading.test.tsx` › R5 3 例（装饰 pending / 失败时卡片立即出现、探测在 commit + paint 之后）；behavior › R5 三组（3 s 慢装饰、装饰失败、慢装饰 + 3 s 慢 sources：卡片 ≤1.5 s、探测 requestStart ≥ armed mark、CLS ≤0.05）+ late sources 几何稳定。HEAD 上 3 例红；Spec 108 用例改为显式等待探测结果 | 通过 |
| R6 | `entry-performance.test.ts` › R6 13 例负向 / 正向控制（空 summary、缺路由、单样本、warm-up 不计 n、全 null、失败样本保留、缺 / 未知 JS·CSS 资源、缺 / 跳过行为、空预算、单格超预算、smoke=partial、baseline 仅缺采集失败、after-only 指标、PERF-08 JS / CSS 独立取最大）+ 谓词 5 例（含筛选禁用 / 延迟更新负向控制、字段名匹配） | 通过 |
| R7 | `display-rollback-races.test.ts`（新）6 例；逐一移除 import / createConnection / 两套 writeAccessYaml 的屏障，对应 4 例变红；矩阵四态见[失效矩阵](wo-20261013-webui-entry-performance-invalidation-matrix.md)「审阅修正复验」 | 通过 |

### 9.3 正式复验（PERF）

| 运行 | 代码 | 命令（仓库根） | 退出码 | 判定 |
|---|---|---|---|---|
| baseline-review-v2 | `8dd210a` 独立 worktree + 本次 runner（`entry-performance.mts` / perf spec / 谓词 sha256 与修正 HEAD 一致；行为 spec 为 `fe00d78` 前版本，baseline 行为不计门禁） | `npm --prefix webui run perf:entry -- --phase baseline --mode production --scenario all --iterations 30 --warmup 5 --output inbox/webui-entry-perf/baseline-review-v2`（worktree 内运行，产物复制回本仓 inbox） | 0 | 采集完整；超预算允许；行为 1 / 10 通过 |
| after-review-v2 | `fe00d78`（工作区仅文档改动，`dirty=true`，digest `aebe6640ce5a…`） | `npm --prefix webui run perf:entry -- --phase after --mode production --scenario all --iterations 30 --warmup 5 --baseline-dir /Users/zhangxingchen/Projects/project-lucy/inbox/webui-entry-perf/baseline-review-v2 --output inbox/webui-entry-perf/after-review-v2` | 0 | `mode=formal status=pass`；行为 11 / 11，0 跳过；0 失败样本 |

两次未采用的尝试保留为过程证据：`baseline-review-v2-attempt1`（退出 1：`service-cold displayReadyMs` 在 baseline 恒为空，runner 改为 after-only 后重采）、`after-review-v2-attempt1`（退出 1：PERF-09 browser-warm-refresh connections 0.069，修复见 `fe00d78`）。两轮共用 fixture content hash `5dc0cd88…`、seed 161、同 anchor / 审计摘要与环境（§3）；baseline 14:11–14:40Z、after 15:08–15:24Z，运行期间无其他负载。

| 验收 | 情景 / 路由（P95；CLS / 长任务 / 资源取 max） | baseline | after | 预算 |
|---|---|---|---|---|
| PERF-01 / 02 | route-warm 四页 | 24.5–25.0 | 24.5–25.5 | ≤50 / ≤100 |
| PERF-03 | route-query-cold connections / catalog / overview / agents | 932 / 933 / 1705 / 1179 | 32.9 / 32.6 / 55.1 / 40.7 | ≤500 |
| | probe-load catalog / overview / agents | 1040 / 1666 / 1890 | 330 / 357 / 347 | ≤500 |
| PERF-04 | browser-cold / warm-refresh（三页） | 95–102 / 51–53 | 78–96 / 33–34 | ≤500 |
| PERF-05 | browser-cold 四页 | 1014 / 1030 / 1751 / 1247 | 108 / 112 / 116 / 118 | ≤800 |
| | browser-warm-refresh 四页 | 959–1718 | 40–66 | ≤800 |
| | login-required / probe-load / probe-load-slow | 1698 / 1033 / 1018 | 359 / 106 / 107 | ≤800 |
| PERF-06 | api-warm sources / agents | 951 / 812 | 0.66 / 9.6 | ≤100 / ≤200 |
| PERF-07 | display-cold sources | 909 | 153 | ≤500 |
| PERF-08 | 初始 JS / CSS gzip（四页，各自独立取最大） | 367,189 / 33,077 B | 145,501–166,647 / 33,175 B | 204,800 / 51,200 |
| PERF-09 | 全部情景 / 路由（含 catalog-filter、probe-load-slow） | ≤0.0011 | ≤0.0203（overview），connections ≤0.0036 | ≤0.05 |
| PERF-10 | browser-cold、route-warm、catalog-filter 业务长任务 | 0 | 0 | 0 |

与首次 after 的差异如实记录：probe-load 导航 P95 由 74–91 ms 升至 330–357 ms，原因是本次每样本清空 live cache、确实执行 7 + 7 个 KTX 任务，并在探测仍排队 / 运行时计时（旧 runner 第二个样本起 live-schemas 命中缓存，且未确认探测仍在运行）；仍在 500 ms 预算内。catalog 筛选完成以「输入值 + 期望行集合 + 结果计数 + 范围树计数」判定；测量中发现以 0 ms 间隔连续输入时 URL 受控搜索框会丢字符，runner 改为 80 ms 人类节奏输入并在报告中登记（见 9.5）。

证据（临时，可清理；sha256 前 16 位）：`baseline-review-v2/results.json` `f5d0f3dac76ca9da`、`samples.json` `129c89034fc92dbd`；`after-review-v2/results.json` `7fb5b6d6b24cd179`、`samples.json` `3d0012bbb883e598`；各含 `summary.md`、`raw/`、`traces/`（22 份）、`logs/`，trace 秘密扫描 0 命中。

### 9.4 其他命令与同环境失败对照

| 命令 | 退出码 |
|---|---|
| `git branch --show-current` | 0（`lucy-v2.0`） |
| `npm --prefix webui test -- server/__tests__/display-snapshot.test.ts server/__tests__/display-invalidation.test.ts server/__tests__/admin-permission-batch.test.ts src/__tests__/display-query-isolation.test.tsx scripts/__tests__/entry-performance.test.ts` | 0（81 例） |
| `npm --prefix webui test -- server/__tests__/display-permission-runtime.test.ts` | 0（5 例） |
| `npm --prefix webui test -- src/__tests__/catalog-loading.test.tsx src/__tests__/api-client-abort.test.ts` | 0（58 例） |
| `npm --prefix webui test -- server/__tests__/display-rollback-races.test.ts` | 0（6 例） |
| `npm --prefix webui run lint:terminology` / `lint:ia-boundary` / `build` | 0 / 0 / 0 |
| `npx vitest run src`（全部前端） | 0（77 文件 1,042 例） |
| 原 WO T6 第 1 组 | 1（5 例，均在下方同环境既有失败列表中） |
| 原 WO T6 第 2 组（14 文件） | 0（240 例） |

同环境对照：`8dd210a` 与修正 HEAD `4fc9441`（其后 `eb6db9b` / `fe00d78` 只改 runner 与前端，不涉及 server 测试）各自独立干净 worktree、同一 `node_modules`、`env -i` 净化环境、显式匿名项目根 `KTX_PROJECT_ROOT=/private/tmp/lucy-r7-anon-root`，`vitest run server --maxWorkers=1 --reporter=json`。

| 检查 | baseline `8dd210a` | after | 逐项对照 |
|---|---|---|---|
| 全 server vitest | 退出 1；1,243 例，37 失败 | 退出 1；1,313 例，37 失败 | 失败全名列表完全相同（仅 after 新增 0、仅 baseline 0） |
| `tsc --noEmit -p tsconfig.json` | 退出 2；88 错误 | 退出 2；88 错误 | 去掉行列号后只差 worktree 绝对路径 |
| `check-selector-contract` | 退出 1；33 问题 | 退出 1；33 问题（登记 4 个新 testid 后） | 与 baseline 相同 |

38 vs 37 的一例：`report-template-pilot.test.ts` › ships no customer measure YAML in the repository 以 `process.cwd()/../semantic-layer` 扫描仓库目录，本仓 checkout 存在被 `.gitignore` 忽略的本机私有目录 `semantic-layer/mysql-aliyun/`，干净 worktree 中不存在；在本仓工作目录运行同一 HEAD 即多这一例（`server-after-head.json`），在干净 worktree 运行为 37 例且与 baseline 一致。未读取该目录内容做验证。对照产物：`inbox/webui-entry-perf/review-v2-failure-compare/`（`server-*.json`、`compare-server*.txt`、`tsc-*.txt`、`tsc-diff.txt`、`selector-*.txt`）。

### 9.5 残余缺口与未部署范围

- **未部署**：未访问 / 未改动目标环境 `10.69.95.109:8276`，未做客户 amd64 / Kubernetes 镜像；成绩只代表 Apple Silicon 回环匿名 fixture。
- 失效矩阵「未覆盖」列：restore 提交、rename 后 reload 失败、addSchema / removeSchema 部分失败、SQLite 无密码分支、真实 `writeFile` 截断中途注入、2 s / 31 s 检测窗口端到端计时；enabled-tables 按既有设计无 ktx 回滚。
- 直接 `fetch` 的 Wiki raw 下载、Eval YAML 下载未接入 authEpoch（用户触发的文件下载，不进查询缓存）。
- 问数提示现随连接列表区域渲染：连接列表本身加载失败时不再显示问数提示（Spec 163 SC-11 只规定状态接口失败时不提示，此组合未定义）。
- runtime 状态晚于卡片返回且最终无需提示时，本次访问保留一行不可见占位（R5 稳定占位的代价）。
- 发现但未在本单修复：语义资产搜索框由 URL 参数受控，0 ms 间隔连续输入会丢字符（baseline 同代码）；属 Spec 174 范围外的输入体验问题，建议另立单。
- 按账户裁剪的快照仍不存在，principal LRU 未实现（与 §7 相同）。

## 10. Codex 收尾实现与正式复验（2026-10-14）

用户要求由 Codex 亲自完成剩余修复，执行依据为[2026-10-14复核计划](wo-20261014-webui-entry-performance-RECHECK.md)。本节为最新交付结论；§1–§9及复核反例保留为历史证据，目标环境未部署。

| 提交 | 修正 | 先红后绿证据 |
|---|---|---|
| `0afc3aa` | R3：Agent列表等审计统计完成后，在响应构造处只读计算runtimeConsistency和对应版本，缓存只保留编译输入 | display-permission-runtime新增两个方向的统计等待竞态；红2例→绿，相关14例通过；权限结果/缓存构建次数不变，展示读不提交policy |
| `866d716` | R4：Catalog主链接、维护/启用链接、更多菜单、空态入口在facts pending/重新读取期间无href或禁用；查询数据安装完成后才恢复；连接页同样防止读取完成前提前解锁 | catalog-loading新增5例，红5例→绿；成功/回滚/重读失败/并行写/空态覆盖，实际点击不跳旧路径；相关66例通过 |
| `586e365` | R6：long-task窗口从首键前开始，最后键→确认绘制的辅助计时另记；路径词/字段词各一份独立trace；正式入口验证JSON、keydown与Paint事件；fixture-only负向注入开关 | 缺trace验证红→绿；统计/DOM/trace回归30例通过；真实Chromium早期按键长任务使PERF-10按预期失败 |

新增开关`--filter-negative-control`只进入performance fixture/init script，不改变应用或生产路由，产物标记`filterNegativeControl=true`。正常与负向样本分别存储，不混入正常P95。

### 10.1 命令与退出码

| 检查 | 退出码 / 结果 | 证据 |
|---|---|---|
| 11文件综合回归（R1–R7与A/B/C涉及文件） | 0；200/200 | `inbox/spec174-fix-regression.log` |
| `vitest run src --maxWorkers=1` | 0；77文件，1047/1047 | `inbox/spec174-fix-frontend.log` |
| `npm --prefix webui run build` | 0；生产build +预压缩 | `inbox/spec174-fix-build.log`；formal runner也重新build |
| terminology / IA lint | 0 / 0 | 最终文档更新后再次核对 |
| `tsc --noEmit -p tsconfig.json` | 2；88个既有诊断，去掉位置与worktree路径后无新增 | `inbox/spec174-fix-tsc.log`，对照§9.4的tsc-after |
| selector-contract | 1；同为33个既有问题，无新增产品testid | `inbox/spec174-fix-selector.log` |
| route-warm负向控制，2次、0warmup、开启early task | **1（预期）**；PERF-10 catalog-filter businessLongTasks=1 | `inbox/webui-entry-perf/filter-negative-v3/`，results hash `c44617ac7f46f46d` |
| route-warm正常smoke，2次、0warmup | 0；明确标partial，非正式通过 | `inbox/webui-entry-perf/filter-smoke-v3/`，results hash `f874733de3b0467d` |
| baseline route-warm，30次+5warmup | 0；175记录、每路由/筛选30正式样本、无采集失败 | `inbox/webui-entry-perf/baseline-review-v3/` |
| after all，30次+5warmup | 0；formal pass，11/11行为、零跳过/失败/预算失败 | `inbox/webui-entry-perf/after-review-v3/` |

负向控制每次在首次按键处理注入80ms任务，新窗口各捕获1个业务长任务，旧last-key−200ms窗口各漏掉该任务；CLI没有采集失败，但预算正确拒绝。这验证了门禁，未将注入任务当成产品性能缺陷。

### 10.2 生产性能证据

本轮baseline只重采受影响的route-warm（含筛选），**不是一轮全场景baseline**；其余历史对照保留review-v2。baseline应用保持`8dd210a`，仅复制共同runner/fixture-server/timing/谓词/观察器/config/behavior共9文件，逐文件SHA256一致，依赖运行时共用；未复制修正应用代码。临时worktree已归档，所有基线证据复制回本仓inbox且hash不变。

after是完整all场景，代码`586e365`，`dirty=true`只含复核文档；应用代码之后没有改动。dirty diff digest为`ed4eaa6672e80e365400a52f0f203ad14d2cb3fb04e5339677e5cef326853183`。两轮仍使用同一fixture content hash `5dc0cd88617da5a60b7db82a61871d50897eac6660907edb909740b601e2ac3d`、seed/anchor/audit输入与环境。正式采样期间没有并行测试。

```bash
# 8dd210a独立worktree中，共同runner，随后将目录复制回本仓
npm --prefix webui run perf:entry -- --phase baseline --mode production --scenario route-warm --iterations 30 --warmup 5 --output inbox/webui-entry-perf/baseline-review-v3
# 本仓，固定修正代码586e365
npm --prefix webui run perf:entry -- --phase after --mode production --scenario all --iterations 30 --warmup 5 --baseline-dir /Users/zhangxingchen/Projects/project-lucy/inbox/webui-entry-perf/baseline-review-v3 --output inbox/webui-entry-perf/after-review-v3
# 与正常采样分开的fixture-only负向控制
npm --prefix webui run perf:entry -- --phase after --mode production --scenario route-warm --iterations 2 --warmup 0 --skip-build --filter-negative-control --baseline-dir inbox/webui-entry-perf/baseline-review-v2 --output inbox/webui-entry-perf/filter-negative-v3
```

| 指标 | after P95 / 最大值 | 原预算 |
|---|---:|---:|
| browser-cold connections primary | 112.3ms | ≤800ms |
| browser-cold catalog primary | 104.0ms | ≤800ms |
| browser-cold overview primary | 140.1ms | ≤800ms |
| browser-cold agents primary | 119.6ms | ≤800ms |
| route-warm四页primary | 24.2–25.4ms | ≤100ms |
| probe-load catalog primary | 335.6ms | ≤500ms |
| probe-load overview primary | 357.2ms | ≤500ms |
| probe-load agents primary | 349.1ms | ≤500ms |
| sources / Agent热HTTP | 1.11 / 10.44ms | ≤100 / 200ms |
| display-cold sources build | 139.0ms | ≤500ms |
| 初始JS / CSS gzip最大 | 166,662 / 33,175B | ≤204,800 / 51,200B |
| CLS最大 | 0.0204 | ≤0.05 |
| ≥50ms业务长任务 | 0 | 0 |

完整after共980记录（含warmup），28个计时场景/路由每项30正式样本，失败0；所有PERF-01–10门禁通过，11个behavior全部通过，24份trace含`catalog-filter-path.json`、`catalog-filter-column.json`，两份均通过键盘/绘制证据校验，秘密扫描无异常。

辅助filterMs P95为103.7ms（baseline 95.9ms），filterInteractionMs P95为1454.6ms。沿用80ms逐字符输入，后者包含全部键入过程；前者是最后keydown→runner确认绘制，包含Playwright尾键间隔等待，不能宣传为纯应用处理耗时。本次没有降低或新增未经批准的筛选延迟预算；PERF-10已覆盖首次输入之前至筛选完成后的整个窗口，业务长任务为0。

证据SHA256：baseline results `d084a70eb588531e4b1b858fb5c5f11c9d20a7d0171fe4e17582d96f1cb29fe2`；after results `71dc06bedaba54288495b2259f9ec5e2cc5f63496ffca14e77e5fd43217a32bb`，samples `d6a62b8941fb609b0e4e16f596b36f3fed3cb81862c4cfa4c8a7667c36e3c42e`。完整环境、P50/P95/max、逐样本值、资源与trace位于上述结果目录；inbox按治理不提交Git。

### 10.3 关闭与边界

2026-10-14复核的A/B/C均已实现并验证，可关闭本轮R3/R4/R6收尾；矩阵中的其他未覆盖项仍保持未覆盖，不从公共包装推定通过。§9.5的高速输入丢字符、下载直连epoch例外及其他已登记事项没有冒充已解决。

提交在本地lucy-v2.0；stash@{0}仍为7653746，未apply/pop。未push、未访问或部署目标IP，未修改真实配置/secret、KTX源码或客户镜像。上述性能只代表Apple Silicon回环匿名fixture；后续目标环境、amd64/Kubernetes交付按既有发布与G1–G4流程验证。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None（`DISPLAY_SNAPSHOT_BUSY` / `PROBE_QUEUE_FULL`、代次、epoch 为内部工程概念；用户可见文案沿用 Spec 174）。

## Design System Compliance

引用 DS 00 / 11 / 12 / 20 / 99。分区静态占位 + 120 ms 延迟加载文字登记为 DS 99 临时决策 TD-174-01（existing tokens，无动画，局部 `aria-busy`，局部错误 + 重试）；未改变 Spec 142 / 163 信息架构与卡片收纳，未做移动重排。TD-174-01 待升级到 `20-patterns-page-layout.md` 或在后续迭代移除。
