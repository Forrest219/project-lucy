# 发布工作台：分文件勾选发布 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立，待 PM 指派后再登记 |
| 需求池条目 | REQ-030-001（发布工作台：分文件勾选发布），来源 [0.30 需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；UX 台账 `UX-PUBLISH-WORKBENCH-010`（`docs/ui-ux-feedback/pages/publish-workbench.md`） |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07 开 Spec 与 Plan）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。本条只登记设计与验收口径，不表示任何功能已获授权实现，也不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。实施须先取得本条的开工授权 |
| 配套 Plan | [lucy-20261107-publish-workbench-per-file-selection-plan.md](../plans/lucy-20261107-publish-workbench-per-file-selection-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（第 1 轮：形式合规 ＋ 事实性核验，13 块分块；**评审通过并另获开发授权后方可改代码**） |
| 本条修订的现行合同 | `webui/docs/119-publish-workbench-queue-gate-ia-spec.md` §1／§3；`webui/docs/123-publish-workbench-activation-ia-spec.md` §2／§3／§5.2／§5.3／§7；`docs/specs/lucy-20261030-publish-workbench-three-column-spec.md` §3／§4.1／§4.2／§4.5.1／§4.5.2／§7；`webui/docs/145-publish-validation-count-clarity-spec.md` §2.4／§3；`webui/docs/00-product-terminology-standard.md` §4.3；`docs/SYSTEM_HANDBOOK.md` §3.13；`docs/qa/selector-contract.md`（`workbench-batch-sync-hint`）。**逐条修订清单见 §8，全部须 PM 批准** |

---

## 闭口层级

- 层级：功能合同
- 本条承诺：在 `/publish/workbench` 上，操作者勾选待发布文件后发起发布，**只有勾选范围进入本次生效**，未勾选项继续留在「待发布变更」，且本次索引实际读取的字节集合与确认面披露的「索引消费范围」逐路径一致。
- 本条出口：能打假这条承诺的检查——服务端与组件自动化，覆盖勾选集合的来源与约束、索引消费集合的逐路径摘要一致性、未选中文件不进索引、校验与确认范围等于勾选范围、失败时的整批失败语义、基线按勾选范围推进、发布记录与恢复日志的边界。
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级
- 上线关系：本条收口不表示可上线

---

## 1. 背景与取证

### 1.1 需求来源

用户在 `/publish/workbench`「待发布变更」看到多条「新增」条目，但**左栏没有勾选控件**，不知道如何发布；左栏反而明写「本批一并同步 N 项（不可分文件勾选）」。用户希望「先勾选再发布」。

需求池对该条目的期望方向（`docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md:106-108`）：**真·分文件发布**——操作者勾选待发布文件；仅勾选范围进入本次生效；未勾选项继续留在待发布，且**索引实际影响不得与确认面不一致**。

需求池同时列明三条硬约束（同文件 `:110-114`，标题在 `:110`、三条正文在 `:112-114`）：现行 `POST /api/semantic-assets/reindex` 对内容根做整批索引同步，无法用 UI 勾选静默缩小实际影响；真·分文件生效至少要回答未选中的脏文件如何不进索引、与镜像／内容根一致性、校验与确认范围、发布记录与恢复边界；现行 Spec 123／20261030 的「整批同步、不可分文件勾选」须**显式修订或取代**，不能 silently 绕过。

### 1.2 现行行为取证（全部为本机实读源码）

| 编号 | 事实 | 位置 |
|---|---|---|
| F1 | 左栏渲染「本批一并同步 {files.length} 项（不可分文件勾选）。」，待发布列表条目只渲染成「打开差异抽屉」的按钮，**无勾选控件**（按钮渲染在 `:682-692`，点击处理 `setSelected(file.filePath); setDetailOpen(true);` 在 `:693-696`） | `webui/src/pages/publish/PublishWorkbench.tsx:653-657`、`webui/src/pages/publish/PublishWorkbench.tsx:682-696` |
| F2 | `POST /api/semantic-assets/reindex` 请求体只有 `{ force?, pendingDigest? }`，**没有任何范围参数** | `webui/server/index.ts:2664-2666` |
| F3 | 该路由最终调用 `reindexProject(projectRoot, { force })`；`reindexProject` 执行的是 `ktx admin reindex`（`force` 时追加 `--force`），**没有范围／过滤参数** | `webui/server/index.ts:2733`、`webui/server/ktx.ts:186-213` |
| F4 | `reindexProject` 在跑索引前调用 `prepareSemanticLayerForKtx`，它先执行 `syncContentToProjectRoot`（**无过滤全量 upsert**），再清垃圾、迁移历史 | `webui/server/ktx.ts:190`、`webui/server/ktx.ts:131-140` |
| F5 | `syncContentToProjectRoot` 对 `semantic-layer`／`wiki`／`evals`／`skills` 四个目录做**整目录 upsert**，逐文件 best-effort，**永不删除**，没有路径过滤参数 | `webui/server/content-mirror.ts:156-181`、`webui/server/content-mirror.ts:30` |
| F6 | KTX 读的是**项目根兄弟视图**（`projectRoot/semantic-layer/` 等），内容根是另一个可配置目录；两者不同时，靠上面的一次���全量镜像把内容根推给 KTX | `webui/server/paths.ts:1-13`、`webui/server/paths.ts:20-31`、`webui/server/content-mirror.ts:150-155` |
| F7 | 恢复流程的既有纪律：**索引前的准备步骤会执行不受写集约束的全量同步**，恢复不得直接依赖它，必须用「只针对已核验集合」的受控同步变体 | `docs/specs/lucy-20261027-v0p25-semantic-release-restore-spec.md:303` |
| F8 | 恢复流程的既有纪律：upsert 前必须先枚举漂移集合并与预览披露的写集比对，**出现未披露漂移立即阻断、不得先写再查**；受控面提供「只复制指定集合」与「删除单个相对路径并回读确认」两个原语 | `docs/specs/lucy-20261027-v0p25-semantic-release-restore-spec.md:302`、`webui/server/content-mirror.ts:305-336`、`webui/server/content-mirror.ts:345-383` |
| F9 | 待发布事实源是「作者内容」与「最近有可靠同步证据的内容版本」之差；`pendingDigest` 覆盖**基线代次 + 完整内容快照**（路径＋存在性＋摘要） | `webui/server/publish-workbench-state.ts:314-330`、`webui/server/publish-workbench-state.ts:88-103` |
| F10 | 基线推进是**整表替换 + 代次 CAS**：`advancePublishBaseline` 用 `input.files` 整张表覆盖基线，代次不一致即抛 `PUBLISH_BASELINE_CONFLICT` | `webui/server/publish-workbench-state.ts:453-510`、`webui/server/publish-workbench-state.ts:143-155` |
| F11 | 消费证据的既有顺序：**采集消费快照 → 索引 → 写终态记录 → 漂移检测 → 基线 CAS → attempt 终态**；漂移非空则基线不推进、attempt 记 `uncertain` | `webui/server/semantic-assets.ts:1926-1988`、`webui/server/index.ts:2728-2733`、`webui/server/index.ts:2758-2776` |
| F12 | 消费快照 `capturePublishConsumption` 覆盖**整个内容根**（外加基线证明存在但现已消失的路径） | `webui/server/publish-workbench-state.ts:781-818` |
| F13 | 恢复日志必须在**首个正式写入之前**持久化，且**不允许空批次**；日志的目标面支持 `content_root` 与 `ktx_sibling` 两种 | `webui/server/semantic-recovery-journal.ts:335-344`、`webui/server/semantic-recovery-journal.ts:161` |
| F14 | 发布窗口是单实例共享锁，入口种类固定 7 个（含 `manual_reindex`）；锁被占用返回 `PUBLISH_COORDINATOR_BUSY`，不回滚不排队 | `webui/server/publish-coordinator.ts:33-53`、`webui/server/publish-coordinator.ts:391-424` |
| F15 | 手动 reindex 的既有门禁：窗口占用 → 409 `REINDEX_IN_PROGRESS`；确认后内容版本变化 → 409 `PUBLISH_CONTENT_VERSION_CHANGED`；存在未决恢复日志 → 409 `semantic_recovery_required` | `webui/server/index.ts:2676-2686`、`webui/server/index.ts:2701-2711`、`webui/server/index.ts:2716-2723` |
| F16 | 现行合同明文禁止分文件选择：Spec 119 §3「不做批量勾选 / 分文件发布」；Spec 123 §3 非目标「分文件多选」、§5.2 左栏整批文案、§7.3「确认 Drawer 无选文件 UI」 | `webui/docs/119-publish-workbench-queue-gate-ia-spec.md:63`、`webui/docs/123-publish-workbench-activation-ia-spec.md:53`、`webui/docs/123-publish-workbench-activation-ia-spec.md:87`、`webui/docs/123-publish-workbench-activation-ia-spec.md:112` |
| F17 | 20261030 三栏 Spec §3 明文「不引入分文件选择发布」，并要求「不能用本页范围缩小索引实际影响」；§4.1「不引入勾选框」、§4.2「本批一并同步，不可分文件勾选」、§4.5.1「本批内容将一并同步，不能按表单独选择」、§4.5.2「搜索与折叠只过滤展示，不能改变确认 payload 或影响范围」 | `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md:55-56`、`:81`、`:87`、`:120`、`:154` |
| F18 | 容器启动脚本会执行一次整批 `ktx admin reindex`；因此任何「分文件生效」承诺的存活期受该动作影响 | `scripts/runtime/docker-entrypoint.sh:379-383` |
| F19 | 设计系统无独立 checkbox 章节；仓内既有复选框原语为 `.pl-checkbox`（`size-4 cursor-pointer accent-primary`） | `webui/docs/design-system/`（目录内无 checkbox 章节）、`webui/src/app/app.css:632` |

### 1.3 由取证推出的根因

现行「整批同步」不是一句文案，而是**两段整批机制的叠加**：

1. **镜像段**：索引前 `prepareSemanticLayerForKtx` → `syncContentToProjectRoot` 把**整个内容根**无过滤地 upsert 进兄弟视图（F4／F5）。
2. **索引段**：`ktx admin reindex` 整批遍历兄弟视图，命令本身没有范围参数（F3）。

因此「UI 勾选」若不改这两段，就只是**审阅聚焦**，实际影响仍是整批——这正是需求池禁止的半真半假（F17 的「不能用本页范围缩小索引实际影响」）。

### 1.4 未核实项（未找到证据，不推测）

- **KTX 上游是否支持范围索引**：`ktx admin reindex` 是否有 `--scope`／`--path` 之类参数——**未核实**。KTX 上游源码不在本仓库。本仓内**已枚举 9 处**调用（`webui/server/ktx.ts:192-195`、`scripts/runtime/docker-entrypoint.sh:380`、`scripts/gates/k8s-acceptance.sh:244-245`、`scripts/smoke/p1-context-smoke.mjs:407`（`--json`）、`scripts/smoke/p0-postgres-demo-smoke.mjs:272`、`scripts/smoke/p0-executive-poc-smoke.mjs:258`、`scripts/smoke/p0-demo-docker-smoke.mjs:435`（`--force --output json`）、`scripts/e2e/run-upgrade-features.mjs:98`、`scripts/smoke/p1-context-smoke.test.mjs:179`（测试替身）），**形态有三种**（裸 `reindex`／`--force`／`--json`｜`--force --output json`），但**九处均无范围／路径参数**。本条按「无范围参数」设计；若上游其实支持，本条的 §3 D1 可以简化，须在开工前置里向 PM／上游确认。
- **兄弟视图（`projectRoot/semantic-layer/`）在容器部署下的实际形态与索引库位置**：**未核实**（本次未打开部署与 KTX 运行时目录实现）。本条只依据 `webui/server/paths.ts:10-12` 的「MCP server 仍要求 sibling layout」与 `webui/server/content-mirror.ts:150-155` 的单向 upsert 描述设计。
- **恢复侧（`/publish/history` 预检恢复）对「分文件批次」的既有支持度**：**未核实**（本次未打开 `webui/server/semantic-release-snapshots.ts` 与 `semantic-release-restore.ts` 的实现细节）。本条 §6 只冻结「分文件批次 = 一条发布记录 = 一个恢复批次」的边界，恢复侧的具体改动留待开工前置核实。

---

## 2. 设计决策

| 编号 | 决策 | 理由与边界 |
|---|---|---|
| D1 | **真·分文件生效的实现机制＝在兄弟视图上物化「有效内容集合」，再跑既有整批 `ktx admin reindex`**。索引命令仍是整批，但**它读到的字节集合被收缩到「已发布基线 ∪ 勾选范围」** | KTX 索引没有范围参数（F3），唯一能收缩「索引实际影响」的位置是**索引读取的内容面**。这样「索引实际影响 = 确认面」不是靠 UI 说法，而是靠**逐路径摘要一致**来证明（SC-03） |
| D2 | **有效内容集合的定义**：`selected` 路径取**当前字节**；未选中但**基线已证明发布过**的路径取**基线字节**（上次发布版本）；未选中且**从未发布过**的路径在有效集合中**缺席**（= 不进索引） | 基线里存着上次发布的字节摘要，blob 存着对应字节（`webui/server/publish-workbench-state.ts:518-539`），足以在不发版的情况下重建「除本次勾选外，其余都维持上次发布态」的世界 |
| D3 | **禁止走 `prepareSemanticLayerForKtx` 的无参全量同步**；分文件发布必须走**受控写集**（枚举漂移 → 核验 → 只写已核验集合 → 删除需缺席的路径 → 回读核验） | F4／F5 是无过滤全量 upsert，会把未选中的脏字节写回兄弟视图，等于把整批影响偷偷放回来；恢复流程已有同款纪律（F7／F8），本条沿用既有纪律而非新造 |
| D4 | **兄弟视图在分文件发布成功后停留在「已发布基线 ∪ 勾选范围」态**，不把未选中的脏字节回填 | 回填后**执行面**（兄弟视图是 KTX 的执行来源，F6）会读到未选中的新口径，而**索引面**没有它们 → 执行与索引错位，且无法回退（索引没有按路径撤销的能力）。不回填则执行面与索引面一致，「仅勾选范围生效」成立。代价见 §9 风险 R3 |
| D5 | **失败语义写死为整批失败**：勾选范围内任一校验不通过 → 提交禁用、不进窗口；窗口内任一环节失败（物化失败／索引失败／漂移／终态证据缺失）→ **整批不推进基线**，未选中项与已选中项都继续留在待发布，**不产生「部分选中项已生效」的中间态** | ① 一条发布记录＝一个批次，恢复日志与基线 CAS 都是整批原语（F10／F13）；② 索引没有按路径撤销能力，部分成功不可回退；③ 需求池禁止半真半假 |
| D6 | **勾选集合由服务端派生、服务端复算**：客户端只提交「逻辑路径集合」，服务端必须逐路径验证它属于当前 `pendingDigest` 对应的待发布集合，并重算 `selectionDigest`；客户端不能提交内容、摘要或范围 | 防止客户端提交任意路径或过期范围；与既有 `pendingDigest` 合同（F9／F15）同构 |
| D7 | **校验范围、确认面、影响说明三者都等于勾选范围**；「索引消费范围」作为**独立披露项**并列展示 | 确认面只讲勾选范围就会与 D1 的真实索引消费范围脱节；两者必须同时出现且不互相冒充 |
| D8 | **legacy 布局（内容根＝项目根，`LUCY_CONTENT_ROOT=.`）下本条明确阻断**，返回可读原因，不降级为「整批假装分文件」 | 该布局下没有第二个面可暂存有效集合（F6、`webui/server/content-mirror.ts:171-174`、`:196-198`），要暂存就必须改写作者的源文件，违反「工作台不写语义文件」（`docs/SYSTEM_HANDBOOK.md:3165`） |
| D9 | **`evals/` 与 `skills/` 不进入勾选范围**，但它们同样会被整批索引消费 → 分文件发布前必须确认这两个目录**相对内容根无漂移**；有漂移即阻断 | 四个内容目录是同一个镜像面（F5）；只管 semantic-layer／wiki 会让「索引实际影响」仍然超出确认面，违反 D7 |
| D10 | **一次分文件发布 = 一条发布记录 = 一个恢复批次**；发布记录必须同时写「本次生效范围（勾选）」与「索引消费范围（已发布基线 ∪ 勾选）」 | 「已生效」若不区分这两个范围，恢复与审计都无法判定该批次到底动了什么（F11 的证据纪律） |

---

## 3. 核心流程（伪代码）

```text
# ─────────────────────────────────────────────────────────────────────────
# 分文件发布（REQ-030-001）
# 位置：webui/server/（新增 scoped 提交入口，复用 publish-coordinator 的发布窗口）
#       webui/src/pages/publish/PublishWorkbench.tsx（勾选状态与提交参数）
# 目标：只有勾选范围进入本次生效；索引实际读取的字节集合 == 确认面披露的索引消费范围
# ─────────────────────────────────────────────────────────────────────────

# ═══ 阶段 0：请求面（发布窗口之外） ═══════════════════════════════════════

function resolve_scoped_request(request):
    snapshot = readPublishPendingSnapshot(projectRoot)          # 既有 publish-workbench-state.ts:601
    if snapshot.baselineState != "ready":
        reject(409, "PUBLISH_BASELINE_NEEDS_VERIFICATION")      # 基线待核对 → 既有阻断口径
    if not snapshot.complete:
        reject(409, "PUBLISH_PENDING_SCOPE_INCOMPLETE")         # 扫描不完整 → 不得当空成功
    if request.pendingDigest != snapshot.pendingDigest:
        reject(409, "PUBLISH_CONTENT_VERSION_CHANGED")           # 既有码，既有 index.ts:2701-2711
    if request.selectedPaths is empty:
        reject(400, "PUBLISH_SELECTION_EMPTY")                  # SC-02
    selection = []
    for path in request.selectedPaths:
        if path not in snapshot.changes:                        # 必须是当前待发布集合的成员
            reject(400, "PUBLISH_SELECTION_OUT_OF_PENDING")
        if path in selection:
            reject(400, "PUBLISH_SELECTION_DUPLICATED")
        selection.append(path)
    selection.sort()
    selection_digest = sha256(snapshot.pendingDigest + "\n" +
                               join([p + "=" + current_digest(p) for p in selection], "\n"))
    if request.selectionDigest != selection_digest:
        reject(409, "PUBLISH_SELECTION_DIGEST_MISMATCH")        # SC-01
    return snapshot, selection, selection_digest

function validate_selected_only(projectRoot, snapshot, selection):
    # 校验范围 == 勾选范围（SC-07）。既有 validate-changed 的适用范围口径沿用：
    # 非删除 + overlay + 恰好归属一张表的文件才产生表级校验对象。
    results = []
    for path in selection:
        if change_type(path) == "deleted":  continue             # 删除项无表级校验对象
        if kind(path) != "semantic_overlay": continue             # wiki / manifest 不产生 overlay 校验
        table = resolve_single_table(path)                       # 恰好归属一张表
        if table is ambiguous or missing:
            results.append(fail(path, "无法唯一归属到一张表"))   # 既有身份歧义整批阻断口径
            continue
        results.append(runSemanticTableCheck(projectRoot, table))
    return results

function build_scoped_confirm(projectRoot, snapshot, selection, validation):
    impact = buildPublishImpact(projectRoot, snapshot, { selection })   # 只对 selection 内对象出原因与证据
    if impact has unresolved where blocking:
        reject(409, "PUBLISH_IMPACT_UNRESOLVED")                 # 既有 unresolved.blocking 口径
    if validation has any failure:
        return { submitEnabled: false, reason: "勾选范围内有校验未通过的项" }   # SC-09 前置
    return {
        submitEnabled: true,
        effectScope:    selection,                                # 本次生效范围（勾选）
        consumeScope:   effective_set(snapshot.baseline, selection),  # 索引消费范围（SC-08）
        impact: impact,
        bindTo: { pendingDigest: snapshot.pendingDigest, selectionDigest: selection_digest }
    }

# 下列三个量词在本 Pseudocode 中是**本条新引入的口径**，仓内暂无同名实现：
#   all_business_paths(root) —— 本次索引可读的业务路径全集（`semantic-layer/**` 与 `wiki/**`，
#                              即待发布扫描范围；既有扫描根见 publish-workbench-state.ts:214-234）
#   expected_digest(entry)   —— 有效集合里某路径**应当**具有的摘要
#                              （CURRENT_BYTES → 当前内容摘要；BASELINE_BYTES → baseline.files 记录的摘要；ABSENT → 不适用）
#   sibling_digest(path)     —— 兄弟视图（projectRoot/semantic-layer/）中该路径的**实际**摘要
# 实现时须按上述口径落为具名函数，不另造语义。
function all_business_paths(projectRoot):
    return scanPublishContent(projectRoot).files.map(f => f.logicalPath)   # semantic-layer/** 与 wiki/**

function expected_digest(entry):
    if entry == ABSENT: return null
    if entry == CURRENT_BYTES: return content_root_digest(entry.path)
    return BASELINE_DIGEST(entry)

function sibling_digest(path):
    return digest_of(readMirrorBytes(path))    # 兄弟视图实际字节的摘要

function effective_set(baseline, selection):
    # 有效内容集合 = 本次索引真正读到的字节集合（D2）
    out = {}
    for path in all_business_paths(projectRoot):        # semantic-layer/** 与 wiki/**（待发布扫描范围）
        if path in selection:
            out[path] = CURRENT_BYTES
        elif baseline.files has path and baseline.files[path] != null:
            out[path] = BASELINE_BYTES(baseline.files[path])   # 上次发布版本
        else:
            out[path] = ABSENT                                 # 从未发布且未选中 → 不进索引（SC-04）
    return out

# ═══ 阶段 1：确认（发布窗口之外） ═══════════════════════════════════════
# 确认侧栏必须同时展示：本次生效范围（勾选 N 项）＋ 索引消费范围（已发布基线 ∪ 勾选）
# 搜索与折叠只影响展示，不改变提交范围（沿用 20261030 §4.5.2 的既有纪律，措辞按 §8 修订）

# ═══ 阶段 2：窗口内（复用 withPublishCoordinator("manual_reindex")） ═════

function activate_scoped_publish(request):
    snapshot, selection, selection_digest = resolve_scoped_request(request)
    validation = validate_selected_only(projectRoot, snapshot, selection)   # 校验范围 == 勾选范围（SC-07）
    confirmation = build_scoped_confirm(projectRoot, snapshot, selection, validation)
    if not confirmation.submitEnabled:
        reject(422, "PUBLISH_SELECTION_VALIDATION_FAILED")       # 不进窗口（D5）

    withPublishCoordinator("manual_reindex", projectRoot):        # 既有 publish-coordinator.ts:391

        # 2.1 恢复未决 → 阻断（既有 index.ts:2716-2723）
        if await isRecoveryRequired(projectRoot):
            reject(409, "semantic_recovery_required")

        # 2.2 布局检查（D8）
        if content_root == project_root:            # legacy：没有第二个面可暂存
            reject(409, "PUBLISH_SCOPED_UNSUPPORTED_LAYOUT")

        # 2.3 有效集合与写集
        effective = effective_set(snapshot.baseline, selection)
        write_set = []                                 # 兄弟视图上要写的相对路径集合
        for path, want in effective:
            if want == CURRENT_BYTES:   write_set.append(path)
            elif want == BASELINE_BYTES: write_set.append(path)   # 写回「上次发布版本」的字节
            elif want == ABSENT:        write_set.append(path)     # 需要从兄弟视图移除
        # 非业务目录（evals/skills）不在 effective 内，但会被整批索引消费（D9）
        for path in evals_and_skills_paths:
            if mirror_digest(path) != content_root_digest(path):
                reject(409, "PUBLISH_SCOPE_DRIFT_UNCONTROLLED")   # 漂移即阻断，不静默带入

        # 2.4 先枚举漂移、再核验、最后写（F8）
        drift = await enumerateMirrorDrift(projectRoot, contentPaths)
        undisclosed = drift where path not in write_set
        if undisclosed is not empty:
            reject(409, "PUBLISH_MIRROR_DRIFT_UNDISCLOSED")       # 零写入；不得先写再查

        # 2.5 恢复日志先行（F13）：首个兄弟视图写入之前持久化，目标面 = ktx_sibling
        journal = createRecoveryJournal(projectRoot, {
            releaseId: newReleaseId, operationId: attemptId, actor: actor,
            targets: write_set.map(path => ({ targetPath: path, surface: "ktx_sibling",
                                              originalContent: await readMirrorBytes(path) })),
            newContent: null
        })                                          # 空写集 → 日志拒绝空批次（journal.ts:342-344）

        # 2.6 物化有效集合（D3：只用受控写集，禁止 syncContentToProjectRoot）
        try:
            for path in write_set:
                want = effective[path]
                if want == ABSENT:
                    await deleteMirrorTargetAndVerify(projectRoot, contentPaths, path)
                else:
                    bytes = (want == CURRENT_BYTES) ? await readContentBytes(path)
                                                     : await readPublishBlob(projectRoot, baseline_digest(path))
                    await writeMirrorBytes(projectRoot, path, bytes)   # 新原语：写入任意已核验字节
                    await upsertVerifiedMirrorFiles(projectRoot, contentPaths, [path])  # 内容根→兄弟视图的受控复制
        except:
            await rollback_materialization(journal, write_set)        # 回退到物化前的兄弟视图字节
            reject(502, "PUBLISH_MIRROR_MATERIALIZE_FAILED")

        # 2.7 物化后逐路径核验（SC-03／SC-06）
        for path in effective:
            if sibling_digest(path) != expected_digest(effective[path]):
                await rollback_materialization(journal, write_set)
                reject(409, "PUBLISH_MIRROR_MATERIALIZE_MISMATCH")
        for path in business_paths not in effective:
            if sibling exists(path):
                await rollback_materialization(journal, write_set)
                reject(409, "PUBLISH_MIRROR_SCOPE_LEAK")               # 有效集合外的路径不得残留

        # 2.8 采集消费快照（范围变体：覆盖 effective，而不是整个内容根）
        try:
            consumption = await capture_scoped_consumption(projectRoot, effective, snapshot.baseline.generation)
        except:
            await fail_batch(journal, write_set, scope = selection, consume_scope = effective, phase = "consumption_snapshot")
            reject(502, "PUBLISH_CONSUMPTION_SNAPSHOT_FAILED")

        # 2.9 索引：命令仍是整批，但它读到的字节集合 == effective（F3／D1）
        reindex = await reindexProject(projectRoot, { force: false })
        if reindex.exitCode != 0:
            await fail_batch(journal, write_set, scope = selection, consume_scope = effective, reindex)
            reject(502, "PUBLISH_REINDEX_FAILED")                     # 基线不推进（D5）

        # 2.10 终态记录：一条发布记录，同时写两个范围（D10）
        try:
            release = await write_release_record({
                effectScope: selection, consumeScope: effective,
                actor, reindex, attemptId
            })
            await recordConfigChange(projectRoot, { changeType: "semantic_publish_terminal", ... })
        except:
            await fail_batch(journal, write_set, scope = selection, consume_scope = effective, reindex)
            reject(502, "PUBLISH_RELEASE_RECORD_FAILED")

        # 2.11 漂移复核 → 基线 CAS（F11 既有顺序）
        drift_after = await detect_scoped_drift(projectRoot, effective)
        if drift_after is not empty:
            await write_attempt(status="uncertain", drift=drift_after)
            await fail_batch(journal, write_set, scope = selection, consume_scope = effective, reindex, rollback = false)
            reject(409, "PUBLISH_CONTENT_CHANGED_DURING_INDEX")       # 基线不推进，内容留在待办

        # 2.12 基线推进：只覆盖勾选范围（D5／F10）
        new_files = merge(baseline.files, { p: current_digest(p) for p in selection })  # 删除项写 null
        try:
            await advancePublishBaseline(projectRoot, {
                expectedGeneration: snapshot.baseline.generation,
                files: new_files, releaseId: release.id, attemptId: attemptId
            })                          # 代次不一致 → PUBLISH_BASELINE_CONFLICT（既有码）
        except:
            await fail_batch(journal, write_set, scope = selection, consume_scope = effective, reindex)
            reject(409, "PUBLISH_BASELINE_CONFLICT")                 # 基线不推进（D5）

        # 2.13 终态：日志终结、attempt 终态、窗口释放
        await completeRecoveryJournal(projectRoot, journal)
        await write_attempt(status="committed")
        # 兄弟视图保持「已发布基线 ∪ 勾选」态（D4）：不回填未选中的脏字节
        return release
```

# 共用整批失败路径（D5／SC-09）——任一失败点统一走它，不各自散写
function fail_batch(journal, write_set, scope, consume_scope, reindex = null, rollback = true):
    if rollback:
        await rollback_materialization(journal, write_set)      # 兄弟视图回退到物化前字节
    await write_failed_release(scope = scope, consume_scope = consume_scope, reindex)   # 终态记录：失败批次也留记录
    # 基线**不推进**；窗口释放由 withPublishCoordinator 既有语义承担
    return failed
```

**分支顺序要点**：请求面校验（阶段 0）全部在窗口外，**不占发布窗口**；窗口内顺序为「恢复阻断 → 布局阻断 → 漂移核验 → 日志先行 → 物化 → 物化后核验 → 消费快照 → 索引 → 终态记录 → 漂移复核 → 基线 CAS → 日志终结」。**任何一步失败都走同一条整批失败路径** `fail_batch`（含回退 ＋ 失败终态记录 ＋ 基线不推进 ＋ 不出现部分已生效）——物化、核验、消费快照、索引、终态记录、基线 CAS 六类失败点无一例外（漂移复核走 `rollback = false`，因该路径已单独写 `uncertain` attempt）。

---

## 4. 勾选集合与确认面合同

### 4.1 勾选集合的数据结构与来源

| 项 | 口径 |
|---|---|
| 来源 | 服务端待发布快照 `PublishPendingSnapshot`（`webui/server/publish-workbench-state.ts:88-103`）：`changes[]` 每项含 `logicalPath`／`changeType`／`kind`／`currentDigest`／`baselineDigest`／`firstVerification` |
| 客户端表示 | 勾选状态是**客户端对同一快照的子集视图**，以 `Set<logicalPath>` 表达；客户端**不得**自行推导或修改摘要 |
| 提交载荷 | `{ pendingDigest, selectedPaths: string[], selectionDigest }`；`selectionDigest = sha256(pendingDigest + "\n" + 逐条 "path=currentDigest")` |
| 服务端复算 | 逐路径验证属于当前 `changes`；重算 `selectionDigest` 并比对；不匹配即 409 |
| 语义 | 「勾选一个文件」＝该文件的**全部内容**进入本次生效（含该文件内的全部表）。**不提供按表勾选**；确认面仍按连接／Schema／表展示 |

### 4.2 确认面必须同时出现的两个范围

1. **本次生效范围（勾选范围）**：勾选的文件数、涉及表、涉及 Wiki、逐项原因与证据。
2. **索引消费范围**：已发布基线 ∪ 勾选范围。必须显式写明「本次索引还会读取上次已发布的其它内容，但**未勾选的待发布变更不在其中**」。

两者不得互相冒充：不得用「索引消费范围」的数量冒充「本次生效范围」的数量（D7）。

### 4.3 未勾选项的处置

未勾选项**留在「待发布变更」左栏**，且在基线推进后**仍然是待发布**（基线里这些路径的摘要未变，F10 的合并推进保证这一点）。左栏必须能区分「本次已生效」与「仍在待发布」两种历史状态。

---

## 5. 校验与确认范围的一致性口径

| 环节 | 范围 | 依据 |
|---|---|---|
| 校验 | 只对勾选范围内、且既有适用性成立的表级对象 | 沿用现行「非删除 + overlay + 恰好归属一张表」口径（`docs/SYSTEM_HANDBOOK.md:3181`） |
| 影响说明 | 只对勾选范围内的对象出原因与证据 | 沿用 `buildPublishImpact` 的既有规则（`webui/server/publish-impact.ts:469`），新增 `selection` 过滤参数 |
| 确认 | 勾选范围 ＋ 索引消费范围（两者并列） | §4.2 |
| 提交 | 勾选范围（服务端复算后） | §4.1 |

**未勾选但被勾选项引用的对象**：只进入「关联与校验范围」分区，**不计入本次生效范围**，也不因其存在而扩大生效面。

---

## 6. 发布记录与恢复边界

| 对象 | 分文件批次的口径 |
|---|---|
| 发布记录 | **一条记录＝一个勾选批次**。记录同时写「本次生效范围（勾选）」与「索引消费范围（基线∪勾选）」。触发方式沿用既有取值体系，新增「分文件发布」 |
| 恢复日志 | 在**首个兄弟视图写入之前**持久化，目标面 `ktx_sibling`（F13）。日志条目＝本次物化写集（含「需移除」的路径） |
| 基线 | 只推进勾选范围；未勾选路径的基线摘要保持原值（合并式 CAS，F10） |
| attempt | `consumedFiles` 记录**有效内容集合**（不是整个内容根，F12 的范围变体）；终态顺序沿用 F11 |
| 崩溃对账 | 启动对账沿用既有 attempt 对账（F11）；**兄弟视图的物化状态**必须有确定归宿：要么按日志回退到物化前字节，要么标记 `needs_verification`。**不得**在缺证据时写成成功 |
| 整批恢复 | 分文件批次的「恢复到该批次发布之前」＝把勾选路径恢复为基线字节（删除项恢复为缺席），并重建索引。该恢复的既有支持度**未核实**（§1.4），开工前置须核实 `semantic-release-snapshots.ts`／`semantic-release-restore.ts` |

---

## 7. 非目标

1. **不做「选了但不生效」的半真半假交互**。若实现只能做到「勾选仅影响审阅聚焦、索引仍整批」，本条**不成立**，不得以「已交付分文件发布」表述（D1／D5）。
2. **不做按表勾选**。勾选的最小单位是文件；一个 Manifest 文件被勾选＝其覆盖的表全部进入本次生效。
3. **不改 KTX 上游**，不引入上游范围索引能力（上游能力现状未核实，§1.4）。
4. **不改发布窗口的锁生命周期**，不新造第二套发布引擎，不动 `publish-coordinator.ts` 的既有 kind 集合（F14）。
5. **不改恢复流程的整体模型**，只规定分文件批次在其中的边界（§6）。
6. **不做本轮视觉 polish**：同页条目卡片阴影一致性等（需求池明列本版一并不做）。
7. **不引入审批流、定时发布、发布历史的新形态**。
8. **不把「已勾选」当成发布成功**：勾选只是提交前的一个中间状态。

---

## 8. 与现行合同的修订清单（**全部须 PM 批准**）

> 需求池硬约束 3：现行 Spec 123／20261030 的「整批同步、不可分文件勾选」须在开线时**显式修订或取代**，不能 silently 绕过。以下每一条都须 PM 逐条批准；未批准前本条不得开工。

| # | 现行合同 | 位置 | 须修订为 | 性质 |
|---|---|---|---|---|
| R1 | Spec 119 §1「产品批准方案 A：双栏工作台 + Diff 下沉（不改发布即索引、**不做批量分文件发布**）」 | `webui/docs/119-publish-workbench-queue-gate-ia-spec.md:46` | 保留「不改发布即索引」，删除「不做批量分文件发布」的限制 | **取代** |
| R2 | Spec 119 §3 非目标「不做批量勾选 / 分文件发布｜产品契约仍为整包发布；勾选留后续」 | `webui/docs/119-publish-workbench-queue-gate-ia-spec.md:63` | 删除该非目标行；「勾选留后续」已由本条兑现 | **取代** |
| R3 | Spec 123 §2.3「术语去『门禁』；队列写明**整批同步、不可勾选**」 | `webui/docs/123-publish-workbench-activation-ia-spec.md:44` | 改为「队列写明本次勾选范围与索引消费范围」 | **修订** |
| R4 | Spec 123 §3 非目标「分文件多选 / 伪入队时长｜索引整批生效；无真实队列」 | `webui/docs/123-publish-workbench-activation-ia-spec.md:53` | 删去「分文件多选」；保留「伪入队时长」 | **修订** |
| R5 | Spec 123 §5.2 左栏「本批一并同步 N 项（不可分文件勾选）」 | `webui/docs/123-publish-workbench-activation-ia-spec.md:87` | 改为按勾选范围表述，并保留「未勾选的 N 项仍留在待发布」 | **修订** |
| R6 | Spec 123 §5.3 同步与确认（`{force:false}` 整批提交） | `webui/docs/123-publish-workbench-activation-ia-spec.md:92-97` | 增补分文件提交载荷与确认面口径；整批路径保持不变 | **增补** |
| R7 | Spec 123 §7.3 验收「确认 Drawer 无选文件 UI」 | `webui/docs/123-publish-workbench-activation-ia-spec.md:112` | 改为「确认 Drawer 无**按表**选文件 UI；勾选发生在左栏」 | **修订** |
| R8 | 20261030 §3「不引入分文件选择发布、审批流、定时发布、历史恢复或新部署形态」 | `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md:55` | 本条**取代**其中「不引入分文件选择发布」一句，其余不变 | **取代（部分）** |
| R9 | 20261030 §3 末段「实施前必须核对实际索引消费范围；……**不能用本页范围缩小索引实际影响**」 | `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md:56` | **保留该禁令**，并补写判别口径：分文件发布不是「用本页范围缩小索引实际影响」，而是**把索引读取的内容面真正收缩到「已发布基线 ∪ 勾选范围」**；判别依据是逐路径摘要一致（SC-03），不是页面文案 | **修订（保留禁令，补判据）** |
| R10 | 20261030 §4.1「点击条目打开差异抽屉，不自动发布，**也不引入勾选框**」 | `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md:81` | 改为「条目仍打开差异抽屉；左栏新增勾选控件，勾选不触发发布」 | **修订** |
| R11 | 20261030 §4.2「说明『本批一并同步，不可分文件勾选』」 | `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md:87` | 改为「本次生效范围＝勾选 N 项；索引消费范围＝已发布基线 ∪ 勾选」 | **修订** |
| R12 | 20261030 §4.5.1「本批内容将一并同步，不能按表单独选择。」 | `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md:120` | 改为「本次仅同步勾选的 N 项；按表展示，不按表选择」 | **修订** |
| R13 | 20261030 §4.5.2「搜索与折叠只过滤展示，不能改变确认 payload 或影响范围；……页脚明确仍将同步全批」 | `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md:154` | 保留「搜索只影响展示」；页脚文案改为「本次仅同步勾选的 N 项，未勾选的 M 项仍留在待发布」 | **修订** |
| R14 | 20261030 §7 验收 PWB-18「整批同步、覆盖确认、恢复阻断、互斥、幂等、原有发布记录页行为未退化」 | `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md:356` | 改为「整批与分文件两条路径都未退化」 | **修订** |
| R15 | 20261030 **§4.2 生效准备**「发布按钮打开确认抽屉，显示完整实际范围」（该句在 `:91`，属 §4.2 的 `:83-93`；§4.5.4「其他内容、风险与提交」是 `:171-179`，不是这条） | `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md:91` | 保持「显示完整实际范围」，但实际范围须按 §4.2 分成两个范围披露 | **增补** |
| R16 | Spec 145 §2.4「不改变『本批一并同步、不可分文件勾选』的发布契约」 | `webui/docs/145-publish-validation-count-clarity-spec.md:45` | 改为「校验计数的分列口径不变；发布契约由 20261107 分文件 Spec 修订」 | **修订** |
| R17 | Spec 145 §3 非目标「分文件勾选同步｜Spec 119 已排除；本 Spec 不重开」 | `webui/docs/145-publish-validation-count-clarity-spec.md:51` | 保留（本 Spec 仍不重开），但由本条兑现 | **不修订（登记来源）** |
| R18 | 术语标准 §4.3 `Sync Change List` 行「本批整批同步的说明文案；副文『本批一并同步 N 项（不可分文件勾选）』（Spec 123）」 | `webui/docs/00-product-terminology-standard.md:494` | 同步登记本条新术语（§Terminology Compliance）与新副文 | **增补** |
| R19 | `docs/SYSTEM_HANDBOOK.md` §3.13「**不支持分文件勾选。** 左栏明写……」 | `docs/SYSTEM_HANDBOOK.md:3173` | 随本条收口后改写 | **修订（收口时）** |
| R20 | `docs/qa/selector-contract.md` `workbench-batch-sync-hint`「必含『本批一并同步 N 项』」 | `docs/qa/selector-contract.md:308` | 选择器契约随新文案更新 | **修订（收口时）** |
| R21 | UX 台账 `UX-PUBLISH-WORKBENCH-010` Status: Deferred；且台账正文仍写「未开 Spec」「`0.30.0` 开 Spec 后补」「本版不优化、不改代码」 | `docs/ui-ux-feedback/pages/publish-workbench.md:259`、`:269`、`:273`、`:276` | **开 Spec 时即同步改写**：`:269` 标题「Expected（池内草案，未开 Spec）」→「Expected（已开 Spec，待评审、未授权实现）」；`:273` 「`0.30.0` 开 Spec 后补」→「`0.30.0` 已开 Spec，待评审、未授权实现」；`:276` 「本版不优化、不改代码」→「本版已开 Spec；**未授权实现**，仍整批同步（Spec 123／20261030）」。收口时再改 Status 为 Fixed 并回填证据 | **登记（开 Spec 时同步 ＋ 收口时）** |

---

## 9. 风险

| 编号 | 风险 | 说明 | 缓解 |
|---|---|---|---|
| R1 | **部分失败语义**被实现成「能提交几个算几个」 | 索引无按路径撤销能力；部分成功不可回退，且发布记录／恢复日志／基线 CAS 都是整批原语 | D5 写死整批失败；SC-09 为阻断项；实现评审逐条核 SC-09 的分支顺序 |
| R2 | **与既有恢复流程冲突**：分文件批次可能让既有恢复预检的「恢复到该批次发布之前」算不准 | 恢复侧对分文件批次的支持度**未核实**（§1.4）；既有恢复的快照／镜像写集模型围绕整批设计 | 开工前置必须先核实恢复侧实现；未核实清楚不得开工；恢复侧改动单独走一轮 Spec |
| R3 | **索引与内容根漂移**：分文件发布后兄弟视图停在「基线∪勾选」态，与内容根不一致；后续任一次 `prepareSemanticLayerForKtx`（`validateSource` 也会触发，`webui/server/ktx.ts:149`）都会把兄弟视图拉回脏字节，导致**执行面读到未生效的新口径，而索引面没有它们** | D4 的取舍 | ① 确认面与发布记录显式登记「未勾选项仍在待发布」；② 提供只读诊断暴露该态；③ 明确「下一次整批同步／全量重建会收敛」；④ 该态必须阻断「已全部生效」类表述 |
| R4 | **容器启动即整批重建索引**（F18） | 分文件发布的「仅勾选生效」在重启后被整批索引抹平 | 必须在确认面与发布记录披露该边界；或由 PM 裁定启动路径是否需要感知分文件态（本条不擅自改启动脚本） |
| R5 | **半真半假**：实现时把勾选做成「审阅聚焦」，索引仍整批 | 这是需求池明令禁止的失败模式 | SC-13 为**否定式验收项**：若逐路径摘要不能证明「索引消费集合＝基线∪勾选」，本条判不通过，不得以「已交付分文件发布」表述 |
| R6 | **镜像/内容根漂移把未披露内容带进索引** | 兄弟视图可能已含内容根之外的旧字节 | D3／F8：先枚举漂移、比对披露集合、未披露漂移零写入阻断；SC-05 |
| R7 | **基线合并推进写错** | `advancePublishBaseline` 是整表替换，合并写错会丢失其它路径的基线摘要 | SC-10：推进后逐路径比对基线摘要；合并表必须由服务端从基线＋勾选派生，不接受客户端提交 |
| R8 | **evals/skills 漂移被静默带入** | 它们不在勾选范围却会被整批索引消费 | D9：分文件发布前必须确认无漂移，否则阻断 |
| R9 | **legacy 布局下被降级成整批** | 该布局没有第二个面 | D8：明确阻断并给可读原因；不得静默走整批 |
| R10 | **与 `0.30` 其他批次争同一文件** | 本条预计改 `publish-workbench-state.ts`／`publish-impact.ts`／`content-mirror.ts`／`index.ts`／`PublishWorkbench.tsx`，与在途批次可能重叠 | 开工前对照批次地图确认归属；同一文件同一时刻只允许一个写入方 |

---

## 10. 验收（SC-01–SC-13）

> 验收编号在本 Spec 内从 SC-01 起连续。每条都必须是**能打假**的检查（自动化的服务端／组件用例），不接受截图或人工描述作为唯一证据。

| 编号 | 可验证结果 |
|---|---|
| SC-01 | 提交载荷只含 `pendingDigest`／`selectedPaths`／`selectionDigest`；服务端逐路径验证属于当前待发布集合并重算 `selectionDigest`；不匹配 → 409 |
| SC-02 | 勾选集合为空 → 提交禁用且服务端拒绝；不产生任何索引动作、任何发布记录、任何基线变化 |
| SC-03 | **索引实际影响＝确认面**：分文件发布后，兄弟视图逐路径摘要与「已发布基线 ∪ 勾选范围」逐条相等；未选中的脏文件不在其中 |
| SC-04 | 未选中且从未发布过的新增文件在有效集合中缺席（不进索引） |
| SC-05 | 物化前枚举漂移集合；存在未披露漂移 → 阻断且**零写入** |
| SC-06 | 物化后逐路径核验：选中路径＝当前摘要；未选中路径＝基线摘要或缺席；有效集合外的业务路径在兄弟视图上不得残留；任一不符 → 阻断并回退 |
| SC-07 | 校验范围＝勾选范围：未选中文件不产生校验结论，也不进入确认面的「涉及的表」 |
| SC-08 | 确认面同时给出「本次生效范围（勾选）」与「索引消费范围」；两者数量与对象不互相冒充 |
| SC-09 | **失败语义**：勾选范围内任一校验失败 → 提交禁用、不进窗口；窗口内任一失败（物化／索引／漂移／终态）→ 整批不推进基线、已选项与未选项都仍在待发布、**不出现部分已生效**、兄弟视图回退到物化前状态 |
| SC-10 | 基线只推进勾选范围：未选中路径的基线摘要保持不变；刷新后未选项仍在左栏待发布 |
| SC-11 | 发布记录＝一个勾选批次，同时写「本次生效范围」与「索引消费范围」；分文件发布在**首个兄弟视图写入之前**持久化恢复日志（面＝`ktx_sibling`）；崩溃后启动对账不伪造成功 |
| SC-12 | 分文件发布复用既有发布窗口：窗口占用 → 既有 busy 码；恢复未决 → 既有 `semantic_recovery_required`；确认后内容变化 → 既有 `PUBLISH_CONTENT_VERSION_CHANGED`；基线代次冲突 → 既有 `PUBLISH_BASELINE_CONFLICT` |
| SC-13 | **否定式验收**：若实现只能做到「勾选仅影响审阅聚焦、索引实际影响仍为整批」，本条判**不通过**；不得以「已交付分文件发布」表述 |

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- 本次勾选范围：操作者勾选的待发布文件集合；本次发布的生效范围。界面主术语「本次勾选的文件」。**实施前须在术语标准 §4.3 登记**。
- 索引消费范围：本次索引实际读取的字节集合＝已发布基线 ∪ 本次勾选范围。界面主术语「本次索引实际读取的范围」。**与「本次勾选范围」是两个概念，不得互相冒充**。
- 未选中项：未进入本次勾选范围、仍留在「待发布变更」的文件。界面主术语「未选中，仍在待发布」。
- 有效内容集合：技术说明用词，表示本次索引读取的字节集合；界面不要求用户理解该词。
- 分文件发布：一次发布只让勾选范围生效的发布方式。**替代**现行「整批同步」在勾选语境下的表述，但「整批同步」在描述既有行为时仍保留为历史事实描述。

修订说明（不是新增术语）：本条把左栏副文由「本批一并同步 N 项（不可分文件勾选）」改为按勾选范围表述，须同步 `webui/docs/00-product-terminology-standard.md` §4.3 的 `Sync Change List` 行（R18）与 `docs/qa/selector-contract.md` 的 `workbench-batch-sync-hint` 契约（R20）。`Schema Manifest`、`Wiki`、`Agent`、对象名、路径、URL 节点仍须同时使用 `translate="no"` 与 `notranslate`。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/02-foundations-grid-spacing.md`
- `webui/docs/design-system/03-foundations-typography.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/99-governance.md`（本条需在此登记**临时决策**：左栏批量勾选控件的交互模式，设计系统无独立 checkbox 章节——目录内无该章节文件，仓内既有复选框原语为 `.pl-checkbox`，`webui/src/app/app.css:632`）

### What This Change Follows

- [x] 左栏仍是「待发布变更」栏，勾选控件嵌在既有文件条目行内，不新增栏、不新增层级。
- [x] 页面仍只有一个发布主动作（「同步索引并生效」），勾选不产生第二个主动作；勾选状态是次级控件。
- [x] 状态有文字：勾选计数、未选中计数、校验失败原因都用文字表达，不只靠颜色。
- [x] 路径与对象名使用既有 `text-xs` 辅助层级，不撑宽列表；长路径截断后可展开或复制。
- [x] 确认侧栏继续使用本页限定的宽侧栏与单一正文滚动区（TD-20261030-01），不修改共享抽屉宽度。

### Exceptions (If Any)

- 勾选控件使用原生 `input[type=checkbox]` ＋ 既有 `.pl-checkbox` 类，**未新建设计系统组件章节**；批量全选／反选的交互细节（分组级全选、跨分组选择状态表达）**尚无规范可依**，须先在 `webui/docs/design-system/99-governance.md` 记临时决策再落代码。

### Follow-up Needed

- 左栏批量勾选的交互模式（分组全选、部分选中的中间态表达、选中计数位置）待升级为 `20-patterns-page-layout.md` 的正式章节。
- 本条的浏览器实测与视觉走查**不在本条出口**（见「闭口层级」）；组件测试不能冒充视觉验收。

---

## 出处

| 引用 | 位置 |
|---|---|
| 需求池条目 REQ-030-001（背景／期望方向／已知硬约束／非目标／关联／本版临时用法） | `docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md:94-126` |
| UX 台账 `UX-PUBLISH-WORKBENCH-010` | `docs/ui-ux-feedback/pages/publish-workbench.md:257-276` |
| 现行 Spec 123（整批同步约定、左栏文案、非目标、验收） | `webui/docs/123-publish-workbench-activation-ia-spec.md:3`、`:44`、`:53`、`:87`、`:92-97`、`:112` |
| 现行 Spec 119（不做批量分文件发布） | `webui/docs/119-publish-workbench-queue-gate-ia-spec.md:46`、`:63` |
| 现行 Spec 145（校验计数口径不改发布契约） | `webui/docs/145-publish-validation-count-clarity-spec.md:45`、`:51` |
| 现行 Spec 20261030 三栏（不引入分文件选择发布；不能用本页范围缩小索引实际影响；左栏／中栏／确认侧栏口径；PWB-18） | `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md:55-56`、`:81`、`:87`、`:91`、`:120`、`:154`、`:356` |
| 恢复与锁生命周期（§5.2 受控镜像纪律、§5.2.1 共享临界区） | `docs/specs/lucy-20261027-v0p25-semantic-release-restore-spec.md:299-306`、`:308-326` |
| 批量功能合同 Task（FC-04 身份歧义整批阻断、FC-13、FC-32 同一套合法性规则） | `docs/plans/lucy-20261030-semantic-batch-functional-contract-plan.md:45`（FC-04 在 `:45`；`:44` 是 FC-03）、`:54`、`:73` |
| 治理规则（新增 Spec／Plan 落盘清单、闭口层级、术语、设计规范） | `docs/governance/DEVELOPMENT.md:192-215`、`:71-136`、`:255-296` |
| 实现事实（见 §1.2 F1–F19） | 见 §1.2 表内逐条 `path:line` |
