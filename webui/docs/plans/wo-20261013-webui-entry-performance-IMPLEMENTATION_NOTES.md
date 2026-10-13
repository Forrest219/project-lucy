# WO-20261013-174 WebUI Entry Performance — Implementation Notes

| 元数据 | 内容 |
|---|---|
| 文档名称 | WO-20261013-174 WebUI Entry Performance — Implementation Notes |
| 文档类型 | Test Report |
| 版本 | v1.0 |
| 撰写日期 | 2026-10-13 |
| 撰写人 | Cursor (Builder) |
| 委托人 | zhangxingchen |
| 基于材料 | Spec 174 v1.2、WO-20261013-174 v1.2、失效矩阵 v1.1→v1.2、`lucy-v2.0` 自 `2a93abd` 起的实现提交、`inbox/webui-entry-perf/{baseline,after}` 原始结果 |
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

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None（`DISPLAY_SNAPSHOT_BUSY` / `PROBE_QUEUE_FULL`、代次、epoch 为内部工程概念；用户可见文案沿用 Spec 174）。

## Design System Compliance

引用 DS 00 / 11 / 12 / 20 / 99。分区静态占位 + 120 ms 延迟加载文字登记为 DS 99 临时决策 TD-174-01（existing tokens，无动画，局部 `aria-busy`，局部错误 + 重试）；未改变 Spec 142 / 163 信息架构与卡片收纳，未做移动重排。TD-174-01 待升级到 `20-patterns-page-layout.md` 或在后续迭代移除。
