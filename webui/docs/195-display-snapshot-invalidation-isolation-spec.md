# 195 · 展示快照变更去重与影响范围隔离

| 元数据 | 内容 |
|---|---|
| 版本 | v0.1 |
| 日期 | 2026-10-30 |
| 状态 | **实现已完成（WO Task 1–6）；SI-01–SI-13 已执行并通过；SI-14 浏览器往返见 §8.1**。未构建镜像、未部署、未改现场实例、未提交 git |
| 重点 | 同一次已确认变更不重复触发缓存失效；普通 overlay 修改不牵连 Agent 权限展示 |
| 范围 | Lucy 单进程内的展示快照、文件对账、显示写屏障与刷新状态提示 |
| 上游契约 | [Spec 174](174-webui-entry-performance-spec.md) §3.2 / §4.2 / §7 / §8 |
| 实施计划 | [WO-20261030](plans/wo-20261030-display-snapshot-invalidation-isolation.md) |

## 1. 用通俗的话说明要修什么

现在，同一次文件修改可能先被元数据检查发现，之后又被摘要检查当成新变化，再整理一次页面数据。部分与权限无关的语义修改还会让 Agent 列表一起重新整理。后台检查一旦来不及完成，这两个页面又会一起返回忙。

本单要求：**同一次变化只确认一次；修改什么，就更新真正依赖它的数据。** 检查确实没有完成时仍如实报告，不返回未经验证的权限展示，也不改运行时授权规则。

“不重复处理”指不重复递增派生数据代次、丢弃已完成结果和触发重建，不禁止必要的再次 `stat` / 摘要校验。写前和写后两个安全边界仍须分别推进代次，不能为了计数好看取消写屏障。

## 2. 证据与判断边界

### 2.1 现场只读观测（2026-10-30，Asia/Shanghai）

目标实例为 `http://10.69.95.109:8276`，页面显示 Lucy `2.0.0`。

| 场景 | 观测 |
|---|---|
| 角色权限 → Agent，测试标签页首次进入 | 约 3.2 秒显示 59 行 |
| Agent → 语义资产，两次测试 | 约 15.8 / 14.6 秒后显示刷新失败；`/api/sources` 返回 503 |
| `/api/sources` 一次失败 | 等待服务器响应约 11.2 秒；`builds=0` |
| 已访问页面 → Agent | 缓存列表最快约 0.4 秒可见；一次后台请求及重试约 13 秒后仍失败 |
| Agent 失败请求阶段计时 | 曾记录 `permissions` 0.2–0.4 毫秒、`builds=0` |
| 配置审计 | 故障前后存在角色、启用表范围及语义资产变更 |

上述跳转计时来自自动化命令发起到 DOM 状态观测的墙钟近似值，含控制开销，**不作为 Spec 174 正式性能成绩或 P95**。接口和错误状态属于现场证据；不能据此确定服务器 CPU、存储或具体对账任务的耗时。

`builds=0` 只表示该请求未拥有新的构建；可能加入其他请求的在途构建，也可能在校验、写屏障或容量检查处被拒绝。不得把它解释成全局构建数为零或已证实达到并发上限。

### 2.2 原代码隔离实验

使用临时匿名夹具、进程内可控时钟和现有导出函数验证，夹具已删除，未改源码：

1. 文件不变，元数据完成时间超过 3 秒：原缓存从可用变为 `DISPLAY_SNAPSHOT_BUSY`；完成元数据对账后同一缓存 `hit`。
2. 元数据仍新鲜，完整摘要完成时间超过 31 秒：原缓存返回忙；完成摘要后恢复 `hit`。
3. 一次外部 overlay 编辑：元数据扫描使 `D:1→2`，完整摘要又使 `D:2→3`；`P/C` 没变，但 Agent 权限缓存两次 `miss`，连同基线共构建三次。

### 2.3 已确认的代码问题

- `display-snapshot.ts::reconcileMetadata` 与 `reconcileFullDigest` 各维护一份基线，同一变化会重复通知。
- `admin/agents.ts::agentPermissionSection` 依赖 `P/D/C`，普通 overlay 的 `D` 变更也会使权限缓存失效。
- `displayCacheVerified` 使用全局时间和错误；仅从 Agent 缓存 key 去掉 `D`，仍无法隔离 overlay 校验异常。
- `semantic-layer.ts::writeSourcePatch` / `writeSourceYamlImport` 的外层屏障固定使用 `D/P`；只改缓存 key，页面保存 overlay 仍会推进 `P`。
- 文件校验逐文件串行执行；metadata 与 full digest 彼此可以重叠。它们构成时延放大风险，尚未证实为现场唯一初始原因。

## 3. 方案决策与边界

本规格精确修订 Spec 174 的文件变更确认方式、展示依赖范围和请求级重试预算；本规格明确保留的检测、写屏障、鉴权与运行时边界继续以 Spec 174 为约束，不将本规格解释为放宽校验或跨 scope 共享权限结论。

| 方案 | 决策与理由 |
|---|---|
| 统一变更基线、按真实依赖隔离，并补有界校验恢复 | **采用**。直接修复已复现的两类问题，沿用现有 API |
| 调大并发、延长 3 / 31 秒有效期或无限重试 | 不采用。尚无现场全局容量证据，并会增加争用或放宽检测承诺 |
| 拆分 Agent 基础列表与权限 API | 本单不实施。需单独设计接口和页面数据一致性，当前先修共享服务 |

必须保留：

- 单进程、单副本边界；不引入外部缓存、数据库 schema、分布式锁或后台守护进程。
- 运行时 ACL / Policy、KTX、保存校验、dryRun 和权限预览的原有 fresh 语义；展示准备不得提交运行时 Policy。
- 同 scope 写入 → Policy ack → 必要回滚的完整屏障；审计失败、部分写入和恢复待核对仍按原契约处理。
- metadata 每秒兜底、普通变更目标 2 秒内发现、完整内容改写最迟 31 秒发现；缓存校验有效期仍为 3 / 31 秒。
- 展示构建并发上限 4、成功/空数据/错误区分、`503 DISPLAY_SNAPSHOT_BUSY`、`Retry-After: 1`。
- Agent 审计统计仍动态读取，前端 Agent 查询仍 `staleTime=0`；不得给整个响应套 30 秒缓存。

本轮不构建镜像、不部署、不出客户包，不修改现场文件。原有 L25-11 / L25-15 / L25-16 的发布窗口、锁顺序、审计终态及其已登记缺口不在本单修复范围内。

## 4. 真实依赖与影响范围

继续使用现有 `D/P/C/L`，其中 `D` 为语义摘要、`P` 为权限展示及 Manifest 源映射、`C` 为连接及启用范围、`L` 为探测配置。**本单不承诺隔离同一 scope 内所有页面，也不新增按 Agent / 连接划分的缓存层。**

| 输入变化 | 影响范围 | `/api/sources` | Agent 权限缓存 |
|---|---|---|---|
| 普通表级 semantic overlay | D | 失效并更新摘要 / 更新时间 | 不失效、不等待 D 写入、不受 D 文件读取失败影响 |
| `_schema/*.yaml` Manifest | D、P | 失效 | 失效，重新核对表权限 |
| Admin access 或 runtime access override | P | 更新 Agent 引用等权限展示 | 失效；路径不一致仍沿用原错误语义 |
| `ktx.yaml`、连接、Schema、启用表范围、内容根 | 现有 C、D、P、L | 失效 | 失效 |
| Wiki / Skill / 历史 / 上传临时文件 / 非当前 YAML sidecar | 沿用现有分类；不新增 D/P/C 依赖 | 不额外失效 | 不额外失效 |
| 连接 secret | 保留现有 C/L 写屏障 | 沿用原语义 | 沿用 C 影响；内容不进入摘要账本 |

据此：`sources` 继续依赖 `D/P/C`，`agent-permissions` 改为 `P/C`。Manifest 已归 P，不能把 Manifest 误当成可忽略输入。

外层写屏障必须从**实际待写路径的并集**得出 scope。单表保存或导入若只写 overlay，用 D；同时写 Manifest 用 D/P。计算发生在原锁/发布窗口内，预览与落盘之间不得新增竞态；事务开始后如发现新增路径，必须先扩展对应 scope 的屏障，再触碰文件。

不能只改 `scopesForPath` 或底层 `safeWrite`，却让外层 `D/P` 或 `D/P/C/L` 屏障继续覆盖 overlay-only 写入。批量入口须逐类核查；真正修改 `ktx.yaml` 的批次保留全范围。显式目录重载仍是主动更新 D/P 的操作，不伪装成文件观察事件去重。

## 5. 统一文件版本账本

### 5.1 状态

每个被监视的非 secret 文件维护一份已确认记录：

```ts
type ObservedRevision = {
  contextId: string;
  fileId: string;            // 进程内规范路径标识，不对外输出
  meta: string | "missing";  // size / mtime / ino / ctime
  digest: string | "missing";
  sequence: number;          // 拒绝晚到观察覆盖新观察
};
```

元数据、watcher、完整摘要共同消费这份账本。mtime 等展示时间也是输入；相同字节但 mtime 变化可以影响语义更新时间，不能只按内容 hash 去重。

### 5.2 观察与提交

1. watcher 合并事件并标记待检查路径；周期扫描发现遗漏、删除、原子替换与新增文件。通知本身不直接重复递增代次。
2. metadata 发现签名变化后，在受控 I/O 队列中读取并计算该文件摘要，使用读前/读后 metadata 验证稳定性。完整摘要也生成同结构候选，覆盖同大小同 mtime 改写。
3. 提交时核对 context、开始时的受影响 scope 代次、pending 写屏障以及记录 sequence。任一已变化则丢弃该候选批次并合并重查；不推进新鲜时间，不发布旧观察。
4. 在单进程同步提交段内，比较旧记录与候选；相同版本不通知。新版本更新账本后，按本批真实变化 scope 的并集通知一次。两类扫描均提交过同一版本时，第二次不得再次通知。
5. 扫描开始时固定文件集合及其目录成员版本；扫描期间成员变化不能把不完整旧集合标记为已完成全量校验。

元数据与完整摘要可以重复读取以证明状态，但不能分别保存互不相知的“旧内容基线”。

### 5.3 Lucy 自身写入

写前/写后推进代次是安全要求，不能被去重。写屏障增加可选的 touched-path 登记：中心写文件函数、直接 access / `ktx.yaml` 写入和 rename 路径，把实际已触碰路径登记到当前事务。

同 scope 存在重叠或嵌套写入时合并 touched paths，只在相关最外层事务退出、Policy ack / rollback 全部结束后，取得磁盘**最终稳定版本**并确认账本；这一确认不额外推进代次，因为退出屏障已覆盖失效。观察器之后看到相同最终版本不得再次触发重建。

若最终观察失败、版本仍变化或存在 `recovery_required`，标记受影响 scope 未确认并释放资源，后续校验恢复；不能把调用方提交的候选文本当成磁盘最终状态。无审计写入、删除、rename 两端及失败回滚同样登记。未知 touched path 的旧调用必须保守退回原失效行为，不得推定无需核对。

## 6. 按依赖核验健康状态与有界恢复

- `displayCacheVerified(scopes)` 与请求前/构建后检查都按依赖 scope 核验，兼容无参数诊断调用。每个 scope 分别维护 metadata / full digest 的完成时间、在途任务和错误；metadata 成功不能清除 digest 错误。
- P 校验覆盖 Manifest、access、连接配置及目录成员发现；不读普通 overlay 内容。已知 overlay 文件不可读仅影响 D。
- 若目录不可枚举，且无法排除其中存在 Manifest，必须影响 D/P；内容根或项目上下文无法确定时，影响所有依赖该上下文的 scope。不得把未知错误标成“仅 D”。合法缺失与拒绝访问分别处理。
- 任一 scope 只有全部所需文件和目录成员已覆盖后才更新对应完成时间；不能用“任务已开始”或局部文件成功延长有效期。迁移内容根后的 metadata / digest 完成时间一起初始化，旧 context 的任务结果不能回填。
- 元数据与摘要共用有界 I/O 调度，初始并发 2，元数据与已知变化路径优先；摘要分批执行。保留周期兜底，不为每个失败 HTTP 请求启动一轮全盘扫描。
- 未验证时共享同 scope 的校验 Promise，有界等待其恢复；等待总预算 1500 毫秒，所有尝试共享，不逐层重置。任务不能完成仍返回忙；校验任务生命周期不依赖某一个 HTTP 订阅者。
- Agent 路由与快照层的版本竞态由请求最外层统一管理，整个请求最多三次尝试。返回前核对本次结果实际依赖的 scope，不能只核对 access 的 P；统计等待期间 C 变化也须拒绝旧权限结果。

## 核心流程（伪代码）

```text
observe(paths, dependencyScopes, mode):
  capture contextId, generationKey(dependencyScopes), recordSequences,
          directoryMembershipRevision
  candidates = stableReadAndHash(paths, sharedIoConcurrency=2)
  commit synchronously:
    if context/membership changed OR relevant write pending
       OR captured generations/sequences no longer match:
      coalesce recheck; do not advance completedAt; return
    changed = candidates different from accepted revisions
    replace accepted records
    if changed is not empty:
      bumpDisplayGeneration(union(scopesForPath(changed))) once
    mark completedAt only for scopes fully covered by this pass/mode

finishWrite(transaction):
  retain outer pending barrier through Policy ack or rollback
  merge all actual touched paths, including partial failures and deletes
  if no overlapping writer remains for those scopes:
    read and confirm final stable revisions without another invalidation
    on observation failure: leave affected scopes unverified
  finally end original write barrier; preserve its generation advance

readDisplay(request, model):
  existing authentication and role checks
  deps = model == agent-permissions ? [P,C] : [D,P,C]
  create one request budget: attempts <= 3, total recovery wait <= 1500 ms
  repeat within that shared budget:
    await relevant writes/verification through shared tasks and same deadline
    if still unverified or pending: return busy(reason)
    capture context + generationKey(deps)
    hit current slot OR join same-key build OR start bounded build
    collect any dynamic statistics outside cached permissions
    if context/generations/verification/pending changed: retry within budget
    return only verified current result
  return busy(reason = generation_changed)
```

上例中的写事务最终确认与 generation advance 必须作为同一串行终结阶段处理；不得在确认与释放之间允许另一个 writer 穿插。不能完成确认时先标记未验证，再释放 pending，禁止出现短暂的成功命中窗口。

## 7. 可诊断性与页面反馈

对外保留错误 envelope 和错误文案；不新增公开诊断接口。内部日志和 `displaySnapshotDiagnostics` 增加：`reason`、请求关联、所需/阻塞 scope、两类校验年龄/耗时、文件数量、全局在途构建数、owner / attached 状态、实际尝试数。原因至少区分 `metadata_overdue`、`digest_overdue`、`reconcile_failed`、`write_pending`、`build_capacity`、`generation_changed`、`context_mismatch`。不输出文件正文、Token、secret 或绝对路径。

Agent 与语义资产保留已有数据、滚动和筛选。已有数据的刷新失败后显示局部提示：「刷新失败，当前显示上次成功读取的数据。」并提供重试及「上次成功读取：…」。时间取成功读取时间（如 React Query 的 `dataUpdatedAt`），不能拿缓存构建时间 `meta.generatedAt` 冒充最后成功请求时间。首次加载失败仍使用现有 `AsyncRegion`；成功刷新清除提示。依赖新事实的动作继续遵循既有写入/事实确认门禁，不新增轮询或扩大自动重试。

## 8. 验收矩阵

以下均为**待实施的验收要求，尚未执行**。第 2 节旧代码实验不等于通过本矩阵。

| ID | 场景与必须结果 |
|---|---|
| SI-01 | 外部 overlay 编辑后按 metadata → full、full → metadata、并发观察三种顺序执行；同版本派生失效只发生一次；sources 下一次重建一次，Agent 权限不重建 |
| SI-02 | 再编辑第二个版本、删除后重建、原子替换、同大小同 mtime 改写均能发现；不得过度去重；mtime 更新仍反映语义更新时间 |
| SI-03 | 两个观察任务晚到/交错时不覆盖较新账本；集合增删与 context 切换不产生假完成；相关旧构建不发布 |
| SI-04 | 真实 overlay-only 保存/导入在外层和底层均不推进 P/C、不阻塞 Agent；修改 Manifest 的真实路径仍推进 P |
| SI-05 | 真实写入、无审计分支、删除和 rename：保留写前/写后失效；最终确认后 metadata/full 不再引发同版本重建；嵌套/并发写入不提前确认 |
| SI-06 | Policy ack 失败、审计终态失败、部分写入与 rollback 保持原合同；最终确认只能记录最终磁盘状态，失败不得假成功 |
| SI-07 | overlay 读取失败/校验超时只影响 D：sources 如实失败，P/C 健康时 Agent 正常；目录无法枚举可能藏有 Manifest 时 D/P 均失败 |
| SI-08 | Manifest、access override、`ktx.yaml` 或启用范围变化仍使 Agent 权限失效；access 路径不一致与 runtimeConsistency 原语义保持 |
| SI-09 | metadata/digest 完成时间和错误独立；过期未完成无成功 payload，完成后恢复；一个 HTTP 取消不停止其他读者的共享校验 |
| SI-10 | 同 scope 并发读不复制扫描任务；文件 I/O 并发 <=2；展示构建 <=4；请求总尝试 <=3、恢复等待总预算 <=1500ms；超时仍持有真实任务资源直到完成 |
| SI-11 | 统计等待中 P 或 C 变化，Agent 不拼接旧权限与新状态；纯审计统计变化不失效权限快照；运行时 ACL / fresh 预览未改变 |
| SI-12 | 每个 busy 分支产生可区分诊断；owner / attached 和全局并发分别记录；日志不含敏感内容 |
| SI-13 | 前端缓存列表可见但刷新失败时显示提示和真实成功读取时间；成功恢复清除；首次失败、合法空列表、账号切换回归通过 |
| SI-14 | 匿名代表性夹具中：预热后完成 30 组侧栏 Agent ↔ 角色权限 / 语义资产 / 配置审计往返，含中途 overlay 编辑；无未解释 busy；主体可见和网络完成分别记录 |

SI-14 按 Spec 174 的页面事件/单调时钟与相同就绪谓词采集，保留失败和重试，不用控制命令墙钟冒充正式成绩。真实实例只低频只读核对，不编辑现场配置；若未部署新版本则记录「未执行」，不能将本地夹具成绩算成现场修复完成。保留 2 / 31 秒检测窗口的边界测试与原有回滚、权限批处理和账号隔离回归。

### 8.1 执行结果（2026-10-30 / 2026-10-31）

实现落点：新增 `webui/server/display-revisions.ts`（统一文件版本账本 + 按 scope 的校验健康度）与 `webui/src/components/DisplayRefreshNotice.tsx`；改动 `display-generation.ts`（touched-path 登记与屏障终结）、`display-snapshot.ts`（按 scope 校验、共享有界 I/O、请求级预算、可区分诊断）、`admin/agents.ts`（`agent-permissions` 改 P/C）、`semantic-layer.ts`（外层屏障按实际待写路径取并集）、`catalog-assets.ts`、`fs-safe.ts`、`index.ts` 与两处前端页面。

| ID | 结果 | 证据位置 |
|---|---|---|
| SI-01 | 通过 | `webui/server/__tests__/display-snapshot.test.ts` §「Spec 195 SI-01/SI-02」（metadata→full / full→metadata / 并发 三种顺序，同版本只失效一次） |
| SI-02 | 通过 | 同上（第二版本、删除后重建、原子替换、同字节 mtime 更新各确认一次） |
| SI-03 | 通过 | `webui/server/__tests__/display-revisions.test.ts` §「unified file revision ledger」（晚到观察不覆盖新账本、已确认版本不再通知、context 切换起新账本） |
| SI-04 | 通过 | `webui/server/__tests__/display-invalidation.test.ts` §「SI-04」（overlay-only 保存只推进 D，P/C 不变，Agent 权限不重建；语义资产恰好重建一次） |
| SI-05 | 通过 | `webui/server/__tests__/display-revisions.test.ts` §「write transactions confirm the final version」（写前/写后两条边界仍在、退出后同版本不再重建、嵌套写入不提前确认、rename 两端登记） |
| SI-06 | 通过 | 同上（删除登记）＋原有回滚/权限批处理回归 `display-rollback-races.test.ts`、`admin-permission-batch.test.ts` 保持绿 |
| SI-07 | 通过 | `webui/server/__tests__/display-permission-runtime.test.ts` §「SI-07」（overlay 不可读 → 语义资产如实失败、Agent 仍正常；语义层不可枚举 → D 与 P 同时失败） |
| SI-08 | 通过 | `webui/server/__tests__/display-invalidation.test.ts` §「SI-08」（Manifest 写入与 ktx.yaml 变更仍使 Agent 权限失效并重建） |
| SI-09 | 通过 | `webui/server/__tests__/display-snapshot.test.ts` §「SI-09」（逾期校验不返回成功载荷并在恢复后恢复；放弃的请求不终止共享校验任务） |
| SI-10 | 通过 | 同上 §「SI-10」（单请求 ≤3 次尝试、一次恢复预算、并发读者共享校验任务、文件 I/O ≤2、展示构建 ≤4） |
| SI-11 | 通过 | `webui/server/__tests__/display-permission-runtime.test.ts` §「SI-11」（统计等待期间 P 变化 → 整批重建，不拼接旧权限与新统计） |
| SI-12 | 通过 | `webui/server/__tests__/display-snapshot.test.ts` §「SI-12」（busy 原因可区分；诊断不含绝对路径） |
| SI-13 | 通过 | `webui/src/__tests__/display-refresh-notice.test.tsx`（7）、`src/__tests__/agent-list.test.tsx`、`src/__tests__/catalog-loading.test.tsx`（各 1） |
| SI-14 | 通过（本地夹具）／现场复核未执行 | 匿名夹具 + 生产构建 + 桌面 Chromium：`npm --prefix webui run perf:entry -- --phase baseline --mode production --scenario spec195-roundtrip --iterations 30 --warmup 5 --output inbox/webui-entry-perf/spec195-roundtrip-final2 --skip-build`。31 个实测样本全部成功、0 个 busy 响应；含一次中途 overlay 编辑后的冷读（1 次请求、网络完成 5.4 ms、主体可见 1.7 ms）。原始样本与结果见 `inbox/spec195/si14/`。**现场实例（`http://10.69.95.109:8276`）复核未执行**：本单未部署新版本，不得以旧实例访问宣称修复已生效 |

基线对照（RED → GREEN）：`inbox/spec195/task1-red-baseline.txt` 记录了在未改实现（HEAD `87d2738b`）上运行新增用例的失败输出——3 个文件 8 个用例失败，失败点为重复失效（D 由 1 变 2 次）、外层 P 屏障（overlay-only 保存推进 P）与全局校验（overlay 不可读时 Agent 也 503）。同一组用例在实现后全绿。

计数口径（文件读取次数 / 失效次数 / 重建次数分开）：一次外部 overlay 版本变更 = 1 次失效通知（`bumpDisplayGeneration`）+ 1 次派生重建；同版本被 metadata 与 full digest 两类扫描先后或并发观察到时仍为 1 次失效、1 次重建。去重只合并失效通知，不取消任何必要的重复读取（metadata 扫描对签名变化的文件读取摘要），也不取消写前 / 写后屏障的代次推进。

## 9. 落地与回退

按 Plan 依次完成复现测试、账本去重、写入终结接入、依赖隔离、恢复与诊断、前端提示、综合验收。先交付本单文档，再进入实现阶段；不在本次文档任务中启动实现。

无持久化 schema 迁移；账本、校验任务和展示缓存均为进程内状态，启动重新建立。回退使用对应代码版本并重启重建展示状态，不能只回退写入口而保留新依赖分类。回退不改客户配置、不重发引导密钥；部署及镜像交付另走既有流程。

## Terminology Compliance

This feature follows `00-product-terminology-standard.md`.

New terms:
- None. 文件版本账本、scope 与诊断 reason 均为内部实现术语，不新增产品概念。

用户可见文案使用 Agent、语义资产、角色权限、启用表范围、刷新失败。出现专业英文术语、路径和 URL 的 DOM 节点继续使用 `translate="no"` 与 `notranslate`。

## Design System Compliance

引用 `design-system/20-patterns-page-layout.md` §2–3、`design-system/99-governance.md` 的 TD-174-01：保留 PageHeader、主区和表格布局，刷新失败在所属数据区使用现有提示样式与重试按钮，不以 Toast 反复打扰，不替换已有主内容。本单不新增视觉模式，不做移动窄屏验证。
