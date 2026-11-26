# MCP 查数热路径 `listSources` 缓存优化：背景、上下文与方案评估

| 元数据 | 内容 |
|---|---|
| 文档类型 | 架构评审与方案草案（供跨 Spec 联合审阅；**不是**功能 Spec，**不构成**开发授权） |
| 日期 | 2026-11-26 |
| 触发来源 | 短期方案落地（`listSourcesWithManifests` 按连接 `readdir` 优化 + `lucy_explain_query` OQ-3）后，针对 MCP 侧热路径收益的复核提醒 |
| 关联 Spec / 需求 | [P0-3 表级歧义门闩](../specs/lucy-20261107-source-ambiguity-gate-spec.md) · [P1-35 纯 MCP 逃生](../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md) · [P1-70 语义写入期间有界等待](../specs/lucy-20261120-semantic-read-write-settle-spec.md) · [P1-75 读韧性](../specs/lucy-20261123-interactive-read-resilience-spec.md) · [P1-78 MCP 性能基准](../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md) · [P1-82 MCP 数据面隔离](../specs/lucy-20261124-mcp-data-plane-isolation-ha-spec.md) · [REQ-0118 中长期架构演进](../backlog/entries/REQ-0118-enterprise-scale-semantic-identity-and-metadata-store.md) |
| 授权边界 | **仅评审材料落盘**，未修改运行代码；需与其他 Spec 联合审阅并对开放项（OQ-1～OQ-3）拍板后再决定是否立项、开 Spec 或授权开发 |
| 评审补充 | 2026-11-26 Kimi 评审取证已落 §7（现状增量、两项设计修正、画像预判定、基线证据）；OQ 裁定不变，仍待联合审阅 |

## 1. 背景与问题定义

在完成 `webui/server/semantic-layer.ts` 的 `listSourcesWithManifests` 按连接一次性 `readdir` 优化（将原先逐表循环 `statOverlay` 从 O(表数) 降至 O(连接数)）后，进一步核查 MCP 代理侧的调用链路发现：**MCP 查数热路径仍会在每次请求中全量重建全库 `SourceSummary[]`**，在大目录（2000–5000 表）和高并发问数场景下，这部分收益尚未吃满。

核心问题：**如何在不破坏「数据面与展示面隔离（P1-82 / Spec 174）」和「写入后立即可见（P0-3 / P1-35 / P1-70）」的前提下，消除 MCP 查数热路径对全库 `listSources` 的重复计算与 GC 分配？**

## 2. 代码现状与上下文取证

### 2.1 MCP 侧的两处 `listSources` 调用点

经代码检索，`webui/server/proxy/` 目录下共存在 **2 处** `listSources(projectRoot, { skipAuthorizedCounts: true })` 调用，均位于 `webui/server/proxy/mcp-proxy.ts`：

| # | 代码位置 | 所属路径 | 调用频次 | 实际消费字段 |
|---|---|---|---|---|
| 1 | `webui/server/proxy/mcp-proxy.ts:5915` | 表级歧义门闩（`sourceAmbiguityGate`） | **热路径**：每次 `lucy_query` 与 `lucy_explain_query` 过完 ACL 与口径门禁后必经 | `conn`、`schema`、`table`、`qualifiedName`、`completion`（用于构建 `schemaProbeByIdentity`） |
| 2 | `webui/server/proxy/mcp-proxy.ts:4443` | `collectRepairEvidence`（权限拒绝 / 过滤下推失败修复提示） | 异常/拒绝路径 | `table`、`completion`、`measureCount` |

### 2.2 为什么底层已有 `catalog-yaml-cache.ts`，热路径开销仍不可忽视

1. `webui/server/catalog-yaml-cache.ts` 已对单个 YAML 文件按 `metaSignature`（及 `coalescedRealpath` / `coalescedStat`）做了内存解析缓存，避免了重复 `YAML.parse`。
2. 但每次调用 `listSources(projectRoot, { skipAuthorizedCounts: true })` 仍会完整执行：
   - `readConnections(projectRoot)`：重新读取并解析 `ktx.yaml`；
   - `listSchemaFiles(projectRoot)`：扫描 `semantic-layer/<conn>/_schema/*.yaml` 并逐文件 `stat`；
   - 按连接 `readdir` 扫描存在的 overlay，对存在的 overlay 做 `stat` + `readCatalogYaml`；
   - 对**全库所有表**（而非仅当前用户可见表）逐表执行 `modelFromTable`、`computeCompletion`、`manifestTableIsEnabled`、构造全新 `SourceSummary` 对象并全量排序。
3. 在 `customer-stability` 基线（10 连接 / 30 Schema / 3500 表、`2C / 2Gi`）或 P1-78（50 并发身份持续压测）下，每次 `lucy_query` 都分配数千个临时对象，既增加单次请求尾延迟，也放大 V8 GC 停顿与事件循环抖动风险。

### 2.3 相关约束与既有契约（联合审阅必核）

- **Spec 174 §3.2 / §7 & Spec 195（展示快照边界）**：`webui/server/display-snapshot.ts` 顶部明确规定——展示快照**仅缓存展示面派生数据**，`Runtime authorization, save validation, dryRun and previews never read it`。此外 `sources` 展示快照包含全量 `authorizedAgentCount`（200+ 角色 × 数千表编译），且受 `withDisplayWriteBarrier` / `reconciler` 状态机约束，写窗口内会抛 `503 DISPLAY_SNAPSHOT_BUSY` 或返回 `pending`。
- **P1-82（MCP 数据面隔离）**：MCP 数据面主路径不得被 WebUI 展示面快照构建、写屏障忙碌或 reconciler 抖动拖垮。
- **P0-3 / P1-35（表级歧义门闩与逃生）**：`schemaProbeByIdentity` 的 `schemaExists` 与 `completion`（仅 `done` 视为可编译）直接影响 `usableTargets` 裁决，且目录读取失败须保持 fail-closed（`sourceMapReliable = false`）。
- **P1-70（语义写入期间有界等待）**：正常语义写入结束后，紧随其后的 MCP 读取必须看到新代次的语义完成度，不得被过期缓存遮蔽。

## 3. 候选方案对比

| 维度 | 方案 A：挂到 `display-snapshot.ts` 展示快照 | 方案 B：纯时间窗口短 TTL 缓存（如 5s / 30s） | 方案 C（推荐）：独立轻量代次缓存（Generation-Keyed） |
|---|---|---|---|
| **是否符合 Spec 174 / P1-82 隔离红线** | **否**（数据面耦合展示面 reconciler 与 503/pending 状态机） | 是（独立于展示快照） | **是**（独立于展示快照，不触碰 `authorizedAgentCount`） |
| **写后立即可见性（P1-70 / P0-3 / P1-35）** | 依赖写屏障与 reconciler，写窗口内可能 503 | **差**（TTL 内返回旧 `completion`/`schemaExists`，存在陈旧窗口） | **强**（任何语义写入推进 `D` 代次即刻失效，零陈旧窗口） |
| **稳态热路径开销** | 命中快，但 miss 时触发含全量权限编译的重构建 | 命中快，TTL 到期周期性重算 | **O(1) 零重算**（稳态直接复用冻结投影与预构建 `Map`） |
| **外部旁路改盘（SSH/Git 直接改文件）感知** | 依赖 reconciler（1s 元数据 / 30s 摘要） | 最长延迟 1 个 TTL | 需明确兜底策略（见 OQ-2） |
| **实现复杂度与回归面** | 高（跨面耦合、写屏障传染） | 低，但测试易因 TTL 产生时序脆弱性 | 中低（纯局部封装在 `semantic-layer.ts` + `mcp-proxy.ts`） |

## 4. 推荐方案（方案 C）设计草案

### 4.1 缓存结构与失效键

在 `webui/server/semantic-layer.ts` 内部为无权限计数模式（`skipAuthorizedCounts: true`）新增轻量只读缓存（不暴露为展示快照，不引入 503/pending 语义）：

- **缓存键（Cache Key）**：
  - `projectRoot` + `paths.semanticLayer`（防测试切根或配置切换串用）
  - `displayGenerations(["D"])`（覆盖所有经 Lucy 写锁/写屏障落盘的 Manifest 与 overlay 变更：单表保存、import、按表追加、batch/zip publish、overlay 删除、catalog upload）
  - `ktx.yaml` 的文件 `metaSignature`（覆盖 `enabled_tables` 变更）
  - （若采纳 OQ-2 严格模式）附加 `_schema` 与连接目录的轻量 `mtime` 签名，确保无 reconciler 时外部改盘也能感知。
- **缓存体（不可变只读投影）**：
  - 冻结的 `SourceSummary[]`（或更轻量的 `SourceProbeSnapshot`，内含按 `repairEvidenceIdentityKey` 预构建的 `ReadonlyMap<string, { schemaExists: true; completion: CompletionState; measureCount: number }>` 与按 `table` 索引的 `Map`）。
- **并发防惊群（Inflight Coalescing）**：
  - 同一缓存键并发 miss 时共享同一个构建 Promise（与 `catalog-yaml-cache.ts` 一致），避免 50 并发同时击穿重复扫盘。
- **失败不缓存（Fail-Closed）**：
  - 构建抛出异常时不写入缓存，保持现有 `sourceMapReliable = false` 的 fail-closed 语义。

### 4.2 两处调用点收益

1. `mcp-proxy.ts:5915`（歧义门热路径）：直接读取预构建的只读 `Map`（仅叠加当前请求 `enriched.matchableSources` 的 `measureNames`），单次 `lucy_query` / `lucy_explain_query` 在稳态下不再遍历全库 2000–5000 张表。
2. `mcp-proxy.ts:4443`（`collectRepairEvidence`）：复用同一代次缓存，消除权限拒绝/过滤下推时的全库重算。

## 5. 待联合审阅的开放裁定项（OQ）

| 编号 | 待裁定问题 | 选项 | 建议 |
|---|---|---|---|
| **OQ-1** | 缓存形态：直接缓存 `listSources(..., { skipAuthorizedCounts: true })` 结果，还是新增更轻的专用 `listSourceProbes()`（跳过 `enabled_tables` 判定、`columnNames` 数组与排序）？ | A. 复用 `listSources(skipAuthorizedCounts)` 加代次缓存<br>B. 新增专用 `SourceProbeIndex`（只算 `completion` + `measureCount`，不读 `ktx.yaml`） | **倾向 B**：两处调用点都不消费 `enabled` 和 `columnNames`，解耦 `ktx.yaml` 后连接白名单变更也不会误杀缓存 |
| **OQ-2** | 外部旁路改盘（非 API 写入，如测试直接 `writeFile` 或运维 SSH 改 YAML）且未启动 `display-reconciler` 时的感知策略？ | A. 仅依赖 `D` 代次（要求测试/运维改盘显式 bump 或重启 reconciler）<br>B. 每次命中前做极轻量的连接/目录 `mtime` 校验（O(连接数 + schema 数) `stat`，约 40 次以内），不依赖 reconciler | **倾向 B**：保证纯单测（不启 reconciler）和 SSH 紧急删文件场景下依然零陈旧，且开销远小于全库重建 |
| **OQ-3** | 与 P1-75 / P1-78 / P1-82 的归属关系：单独开一条轻量性能 Spec，还是并入 P1-75 / P1-82 既有优化池？ | A. 独立轻量需求入池（如 `REQ-0119`）走标准 S1→S5<br>B. 作为 P1-78 性能基线实测后的首条定向优化项 | 交由委托人在联合审阅时统筹排期 |

## 6. 建议实施计划（待评审授权后执行）

1. **阶段 1：契约确认与基线测量**
   - 联合审阅 P0-3 / P1-35 / P1-70 / P1-75 / P1-78 / P1-82，裁定 OQ-1～OQ-3。
   - 在 `scale`（2000 表）或 `customer-stability`（3500 表）夹具下，采集优化前 `sourceAmbiguityGate` 中 `listSources` 的 P50 / P99 耗时与内存分配作为基线。
2. **阶段 2：实现与单元测试**
   - 在 `webui/server/semantic-layer.ts` 实现代次驱动的轻量只读缓存 + inflight 合并 + 测试 reset 钩子。
   - 接入 `webui/server/proxy/mcp-proxy.ts` 第 5915 行与第 4443 行。
   - 补齐单测：稳态缓存命中（验证构建次数为 1）、`withDisplayWriteBarrier(["D"])` 写入后立即失效、外部改盘感知（若选 OQ-2 B）、并发 50 请求合并、异常不缓存（fail-closed），并回归 `source-ambiguity-gate.test.ts` 与 `mcp-proxy-smoke.test.ts`。
3. **阶段 3：规模复测与验收**
   - 在 Docker `scale` / `customer-stability` 环境下复测并发 `lucy_query` 的 `sourceAmbiguityGate` 耗时、事件循环 `p99Ms/maxMs` 与 P1-70 写后读一致性。

---

## 7. 评审补充与取证（2026-11-26，Kimi；追加式，不改写上文）

> 性质：对 §1～§6 的**事实增量与评审发现**，供联合审阅一并裁定；不改变 OQ-1～OQ-3 的待裁定地位。

### 7.1 现状增量：overlay readdir 失败语义已变（影响 §2.2 与 §4.1「失败不缓存」）

短期方案合入前评审（本会话）已为按连接 `readdir` 补上**非 ENOENT 可观测降级**（`webui/server/semantic-layer.ts` `warnOverlayListDegraded`）：

- `readdir` 非 ENOENT 失败（如 EACCES）：打 `[lucy-semantic]` warn（按 `conn+code` 进程内去重，防 MCP 每查询路径刷日志），该连接 overlay 按**缺席降级**；ENOENT（竞态删除）保持静默。降级**逐次扫描自愈**——下一次 `listSources` 重新 readdir 即恢复。
- **对 §4.1 的设计后果（评审发现 F2，必须纳入）**：代次缓存会把「构建成功但已降级」的结果**钉在当前 D 代次**——瞬时 FS 故障的降级视图从「单次请求」放大为「整个代次」。缓存层必须把降级构建判为**不可缓存**（或仅以极短 TTL 缓存）。这要求 `listSourcesWithManifests` 把降级信号**结构化**（返回值携带 `overlayListingDegraded` 之类的机器可读标记；warn 日志只是人读通道，缓存层不能靠解析日志）。「失败不缓存」一条应修订为「**失败与降级均不缓存**」。

### 7.2 评审发现 F1：OQ-2 选项 B 的目录 mtime 签名存在盲区，按现文不可采纳

目录 mtime 只在目录项**增／删／改名**时变化；**原地改写已存在文件的内容不改变父目录 mtime**（`vi` 原地写、`>>` 追加均不可见；`sed -i`／IDE「临时文件＋rename」可见——行为随编辑器而变，不能作为正确性合同）。因此「连接/目录 mtime 校验（约 40 次 stat）」对 SSH 紧急**改内容**（最高频的旁路操作）可能完全无感，给联合审阅造成「已覆盖外部改盘」的错误信心。

建议把 OQ-2 改为三选一重新裁定：

- **B′（文件级签名）**：命中前对 `_schema/*.yaml` 做 per-file `metaSignature` 校验（O(Schema 数)，与 `catalog-yaml-cache` 同一签名口径）＋ overlay 仅校验**构建期已知的 overlay 文件集**（稀疏时 O(overlay 数)；全量 overlay 最坏档退化为 O(表数)，须在 Spec 写明该上界）。
- **C（D 代次＋短 TTL 兜底，推荐）**：Lucy 写入由 D 代次**即时**失效（零陈旧，保 P1-70）；旁路改盘由 TTL（如 5–30s）**有界**兜底。稳态零 per-hit stat，实现最简；代价是旁路改盘存在一个 TTL 的陈旧窗，须写入 Spec 的诚实边界。
- **A（仅 D 代次）**：须在 Spec 明示「旁路改盘不可见直至任一 Lucy 写或重启」，并给 P3 运维方补偿路径（文档化失效入口），按 `user-personas.md` §4.2 走负向门槛。

### 7.3 受影响画像预判定（按 `user-personas.md` §5 模板，供未来 Spec 引用）

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。判定基于方案 C＋OQ-2 采 B′或 C 的前提；若 OQ-2 采 A，P3·运行观察面改判 `↓` 并走补偿门槛。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 每次 `lucy_query`/`lucy_explain_query` 全库重建 `SourceSummary[]`；5000 表函数级暖态 ≈309ms／冷态 ≈1047ms（本机 APFS，卷/PVC 更高） | 稳态 O(1) 命中预构建只读投影；仅代次推进后首请求重建 | **P1·问数面 ↑／P1·报告面 ＝**（未触碰 Live Report 路径） | §7.5 微基准；MIP `optimization-ab` 跑次（§7.5，跑次登记后回填 SC/UAT 锚点） | — |
| P2 治理方 | WebUI 语义写后，紧随的 MCP 读看到新完成度（P1-70） | 同左（D 代次键即时失效，语义不变） | ＝（`withDisplayWriteBarrier(["D"])` 覆盖全部 Lucy 写路径；`skipAuthorizedCounts` 不触碰权限编译面） | `display-generation.ts:33`、`semantic-layer.ts` 写路径 | — |
| P3 运维方 | SSH 旁路改 YAML 下一次查询即生效（逐调用 stat）；热路径每查询数千次 FS 调用 | 旁路改盘感知按 OQ-2 裁定（B′零陈旧／C 有界陈旧）；热路径 FS 压力消除，事件循环更稳；readdir 降级有 warn 可观测 | **P3·交付运维面 ＝／P3·运行观察面 ＝（条件：OQ-2 不采纯 A）** | §7.2；`warnOverlayListDegraded` | OQ-2 若采 A：文档化失效入口＋挂验收编号，按 §4.2 门槛 |
| P4 管理层 | 指标口径、覆盖率、报告面 | 未触碰 | ＝（未改任何指标／报告／概览路径） | 本变更不含展示面与指标面改动 | — |

### 7.4 事实核对记录（联合审阅可直接引用）

| 原文论断 | 核对结果 |
|---|---|
| §2.1 两处调用点（`mcp-proxy.ts:5915`／`:4443`） | 属实；5915 为每查询必经（`sourceAmbiguityGateAppliesToTool` 仅 `lucy_query`/`lucy_explain_query`），4443 为拒绝/下推修复提示路径 |
| §2.2 `readConnections` 每次重读解析 `ktx.yaml` | 属实（`project.ts:503` `readProject` 无缓存，逐调用 `readFile`+`parse`） |
| §2.3 展示快照「Runtime authorization … never read it」 | 属实（`display-snapshot.ts:5-6` 原文） |
| §4.1 缓存键 `displayGenerations(["D"])` 可实施性 | 可行，`displayGenerations()` 已导出（`display-generation.ts:33`） |
| OQ-1 选项 B「两处调用点不消费 `enabled`/`columnNames`」 | 属实但需补一条：5915 处消费 `qualifiedName`（`physicalTable` 身份键成分），`SourceProbeIndex` 必须保留；`computeCompletion` 仍需读 columns（仅是不物化 `columnNames` 数组与排序） |

### 7.5 基线证据（§6 阶段 1 输入）

- **函数级微基准**（2026-11-26，本机 APFS，Node 24，`skipAuthorizedCounts: true`，5000 表；脚本 `inbox/bench-list-sources-20261126.mts`，旧实现取 `git show HEAD:`）：
  - 稀疏 overlay（25/5000，典型）：旧逐表 stat 暖态 309ms／冷态 1047ms → 新按连接 readdir 22–24ms，**≈13.8×**；
  - 全量 overlay（5000/5000，最坏）：旧 2777ms → 新 2457ms（**1.13×，无回退**）；
  - 结论：readdir 优化后，listing 残余成本为 manifest 读（有缓存）＋ 5000 次 `modelFromTable`/`computeCompletion`/排序的 CPU 与分配——正是本 assessment §2.2 第 3 点指出的、需要代次缓存消除的部分。
- **套件级对照（MIP `optimization-ab`）**：改动臂镜像 `project-lucy:mip-ab-20261126`（git `5f1b4152+dirty`）对冻结基线 `1-lucy-mip-uat-capB-…json`（runId `mip-mwwwsrq0-k8cgto`），29 组全矩阵 2920 尝试，runId `mip-mwx6wvyo-76qsck`。**判定 FAIL（相对门禁 8 组回退），但归因非本次优化**：回退集中并发档（+67~145%），而夹具仅 15 表／13 overlay，本优化在每查询上的差异 ≈2 次系统调用，机制上不可能产生秒级回退；候选树含基线后 8 个提交＋P1-75 未提交改动，跑次窗口主机 load avg 21–27。15 组改善 −15~−49% 与回退并存，形态符合「树差＋环境」。跑次文档（含逐组 delta 与归因）：[`../qa/uat/suites/mcp-inquiry-performance/runs/2026-11-26-kimi-optimization-ab-list-sources.md`](../qa/uat/suites/mcp-inquiry-performance/runs/2026-11-26-kimi-optimization-ab-list-sources.md)。**对 §6 阶段 1 的含义**：缓存方案的基线测量必须在安静窗口、同刻双臂下采集，且并发档对主机争抢敏感，预算判定须注明负载条件。
