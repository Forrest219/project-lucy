# 空结果响应的结构化下一步指导 · 对抗式设计评审记录

| 元数据 | 内容 |
|---|---|
| 文档名称 | 空结果响应的结构化下一步指导 · 对抗式设计评审记录 |
| 文档类型 | 评审记录（**不是** Spec，**不授权**实现） |
| 版本 / 日期 | v0.1 / 2026-11-07 |
| 状态 | 第 1 轮与横切批评审的裁定**已入档**；第 2 轮对抗式评审进行中。**代码改动未授权** |
| 授权边界 | **只记录、不实现**。本文件不改动任何运行代码，不构成开工授权 |
| 评审对象 | [`docs/specs/lucy-20261107-empty-result-next-step-guidance-spec.md`](../specs/lucy-20261107-empty-result-next-step-guidance-spec.md) ＋ [`docs/plans/lucy-20261107-empty-result-next-step-guidance-plan.md`](../plans/lucy-20261107-empty-result-next-step-guidance-plan.md) |
| 需求池条目 | REQ-030-018（[`lucy-20261102-lucy-0-30-0-requirement-pool-plan.md`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」 |

## 1. 评审方式与证据纪律

- **评审者**：本机 Claude Code（无头驱动，MiniMax-M3 端点），只读执行——不修改任何被评文件。
- **裁定者**：MiniMax Code（主会话）。每条关键发现**独立复核源码**后才接受，不接受未经验证的结论。
- **发现分类**：①「已验证」＝本机读过被引文件并复核行号与原文；②「推断」＝基于已知机制的推理，标注为待取证。
- **不收**：风格洁癖、无 `file:line` 证据的断言、纯偏好类意见。
- **原始产出落点**：第 1 轮的原始 findings 与裁定草稿落在本机 `inbox/`（临时件目录，`.gitignore` 忽略、**不入库**）；**结论与裁定以本文件为准**。

## 2. 第 1 轮对抗式评审（Claude Code，只读）

**总体判定**：需修订后实施——6 条阻断项全部成立，另有 9 条非阻断项与 1 条新增边界。评审**无误报**。

### 2.1 阻断项与裁定

| ID | 发现 | 裁定 | 独立复核证据 |
|---|---|---|---|
| **B1** | `next_tools` 用了授予清单 `permissions.tools` 而非可见清单 | **接受** | `webui/server/proxy/acl.ts:2397-2431`：`allowedToolNames()` 才做可见性裁决——`*` 展开 `policy.knownTools`（2404-2406）、剔 deny（2415）、DataPlane 工具要求 `capabilityTools.has(tool)`（2423）、`degradedGlobal` 下隐藏（2417）。`permissions.tools` 只是 `role.allow.tools` 并集，**用它会推荐调用者调不通的工具** |
| **B2** | `query.filters` 会含行策略谓词 | **接受** | `webui/server/proxy/row-policy.ts:721-741`：`applyLucyQueryForcedFilters` 把编译后的 forced 谓词**前插**进 `record.filters`（`:738`）；`webui/server/proxy/mcp-proxy.ts:4183-4184` 随即 `toolArgs = record`；`_meta.lucy.provenance.filters` 取自改写后的 `argsRecord`（2660 / 2706）→ **策略谓词会进入模型可见位，且「放宽过滤」对它无效** |
| **B3** | 「行权限交集空」被压平成普通空结果 | **接受** | `webui/server/proxy/mcp-proxy.ts:4182`：`scopeIntersectionEmpty = isScopeIntersectionEmpty(toolArgs, decision.forcedFilters)` **在发查询之前**已算出；该标志经 `options.scopeIntersectionEmpty`（2842 / 6006）传到 `writeLucySemanticResponse`，并在 2982 落为 `decisionReason = "scope_intersection_empty"`。**Proxy 早就知道成因** |
| **B4** | Spec §6 伪码产不出 SC-09 的形状 | **接受** | `webui/server/proxy/mcp-proxy.ts:2675-2719`：返回路径是 `_meta: { ...existingMeta, lucy: { ...全新字面量 } }`——`existingMeta` 只在 `_meta` 层展开，`lucy` 是**全新对象**。按伪码写 `resultRecord._meta.lucy.next_step = ...` 会落到被丢弃的旧对象；上游无 `_meta` 时 TypeError → 落 2887-2890 降级 → **整个特性静默消失** |
| **B5** | 追加 content 块打断 eval runner 的 JSON 解析 | **接受** | `scripts/eval/eval-runner.mjs:293-300` 把**所有** text 块用 `'\n'` 拼接后再 `JSON.parse`，失败退化为 `{raw}`；`:305-334` 的 `rowsToObjects` 找不到 `headers` 就原样返回 → **结果断言全部落空** |
| **B6** | 否掉「单块内加键」的理由与证据相反 | **接受** | 仓库三个 content 消费者均不受单块内加键影响：`webui/server/eval/offline-batch-main.ts:15-18`（取第一个 text 块）、`scripts/eval/eval-runner.mjs:305-334`（只读 `headers`/`rows`/`sql`）、`scripts/e2e/security/context.mjs:239-254`（只读 `headers`/`rows`）。**追加块是唯一打断解析的方案** |

### 2.2 非阻断项与裁定

| ID | 发现 | 裁定 | 要点 |
|---|---|---|---|
| M1 | `next_tools` 空降级无措辞 | 接受 | 改为：`next_tools` 为空**不降级** `suggestions`（三条建议都是推理动作，不依赖工具） |
| M2 | 审计行数依据写错 | 接受 | `mcp-proxy.ts:2973` 取的是**富化后**的 body；补护栏：`next_step` 载荷不得含 `rows`/`totalRows`/`columns`/`headers` 键 |
| M3 | `boundedProvenanceValue` 被当成脱敏 | 接受 | `mcp-proxy.ts:2610-2622` 只做 500 字符／20 元素／30 键／4 层**长度收敛**，不脱敏；真正的去值纪律在 `webui/server/proxy/audit-privacy.ts:148-178` |
| M4 | 三处文档形状不一致 | 接受 | 分支计划 §3.1 覆盖两个工具且伪码含 `candidates`／`no_visible_source`／`distinguish`；Plan Task 4 引用了不存在的 `candidates`；Spec 伪码入参含死参数 `sourceRefs` |
| M5 | Plan Task 2 Step 1 不可运行 | 接受 | 改为克隆 `webui/server/__tests__/mcp-proxy-smoke.test.ts:923-1005` 的自建上游夹具 |
| M6 | Plan Task 4 Step 1 要求发真实数据查询 | 接受 | 与 Spec 非目标冲突；改用夹具上游取证 |
| M7 | 术语落位与禁词 | 接受（**落位修正**） | 落位改为术语标准 **§4.8（MCP 调试台／ACL 裁决可见性）**，不是评审建议的 §4.7（访问日志页面分区）或 §3（UI 主术语表）；禁词补「与 `Repair Hint` 混用」 |
| M8 | certified route 旁路 | 接受 | `mcp-proxy.ts:3761-3998` 的 `writeCertifiedRouteResponse` 内部跑 `forwardAuthorizedLucyQuery` 并直写 payload，**不经 `withLucyResultMeta`** → 登记为覆盖缺口 |
| M9 | 风险表「同函数内另有三处」 | 接受 | `writeLucySemanticResponse` 内没有 `effectivePermissions` 调用 |
| 新增 | 分页空页误判 | 接受（登记为已知边界） | `mcp-proxy.ts:861-862` 优先取 `rows.length` → `{"rows":[],"totalRows":500}` 会被判成空结果；属 `result_empty` 既有语义，本条不修 |

### 2.3 据此做出的修订决定

| 决定 | 内容 | 依据 |
|---|---|---|
| **落位改为「单块内加键」** | 不再追加 content 块。`content[0].text` 的 JSON 对象内加 `next_step` 键（text 必须是 JSON 对象）；`structuredContent` 是对象时同步加键；`_meta.lucy.next_step` 同步给出（审计／运维位）。**不变式：凡出现 `next_step`，模型一定看得见** | B5＋B6。代价：数据文本被重新序列化（值语义不变），须写进 Spec 的代价与护栏 |
| 工具可见性 | 改用 `allowedToolNames(identity)`；纯函数入参改为「已解析的可见工具名列表」；删掉 `*` 通配分支与其测试 | B1 |
| filters 回显 | 只回显**改写前的原始用户 filter** 并按 audit-privacy 口径**去值**；行策略谓词完全不出现。`summarizeFilterItem`／`summarizeFilters` 需从 `audit-privacy.ts` 导出复用 | B2＋M3 |
| 成因分流 | 用既有 `options.scopeIntersectionEmpty` 分流 `kind`：`empty_result_scope_conflict` 时**不得**给泛化的「放宽过滤条件」建议 | B3 |
| 装配形状 | Spec §6 伪码改成与 `mcp-proxy.ts:2656-2719` 一致（在 `lucy` 字面量里显式带 `next_step`）；补 SC 覆盖富化抛错的无指导降级 | B4 |
| Plan 可执行性 | Task 2 Step 1 改为可直接运行的用例；Task 4 取证改用夹具上游，不发真实数据查询 | M5＋M6 |
| 覆盖边界登记 | Spec §5.3 登记 certified route／report template 旁路、分页空页误判、text 非 JSON 时不发指导 | M8＋新增 |

### 2.4 第 1 轮遗留的待批准项

| 事项 | 状态 |
|---|---|
| 落点从「追加 content 块」反转为「单块内加键」 | **待委托人确认**。该反转**推翻了**原 Spec 的非目标「不改写上游 `content[0].text`」，驱动证据是 B5＋B6（追加块打断 eval runner 多块解析，且其模型可见性依赖客户端渲染全部块，仓内无法验证）。**确认前不授权实现** |
| `next_step` 是否进入 `structuredContent` | 已纳入（成本很低，多一处落点） |
| 术语落位定在 §4.8 而非评审建议的 §4.7／§3 | 留待第 2 轮复核分区判断 |

## 3. 横切批评审（另一会话对 0.30 全批 22 份文档）中的相关 findings

来源：`inbox/review-2026-11-07-0-30-batch-review-r1.md`（**本机临时件，不入库**；结论已转录如下）。该评审结论为「不通过」，23 条 findings 中与本条相关的 9 条处理如下。

| 编号 | 严重级 | 问题 | 处理 |
|---|---|---|---|
| F-01 | 阻塞 | REQ-030-018 落位口径在 6 处镜像仍写已作废的旧口径（「追加 content 块」＋「不改写上游 `content[0].text`」） | **已修**：6 处镜像（`docs/README.md`／`docs/plans/README.md`／`docs/governance/project-overview.md` §9 与版本行／分支计划 §9 派生段）全部改为与 Spec v0.3 一致的现值；旧口径在历史行处紧贴「已作废，不得当作现值」 |
| F-02 | 高 | 需求池状态行写 `v0.1-draft`、条目行写 `v0.2`，池内部矛盾 | **已消解**：并发会话把池重写为 v0.14，池头部与 REQ-030-018 条目不再出现版本分叉；本条同步把条目索引行对齐到 Spec／Plan v0.3 |
| F-03 | 高 | 索引与 §9 仍写 Spec v0.1／SC-01–SC-12 | **已修**：三处镜像统一为「v0.3，待第 2 轮评审，未授权实现」，SC 范围改 SC-01–SC-16 |
| F-06 | 高 | 分支计划写「runner 支持 7 型工具断言」，实测 8 型 | **已修**：分支计划 §3.2 改为 8 型并列出 8 个类型名 |
| F-08 | 高 | 分支级 D3／D4 已裁定却仍标「待定」 | **已消解**：分支计划 §9 的 D3／D4 状态已是「已裁定」并带日期与对应 Spec |
| F-09 | 高 | 分支计划 §6／§8 把已开 Spec／Plan 的池条目仍写成 Deferred | **已修**：改为「REQ-030-018…021 已开 Spec／Plan，待评审、未授权实现；池内其余条目仍为 Deferred」 |
| F-13 | 中 | Spec 头部缺「台账号」行 | **已修**：补「台账号 \| 无。`0.30` 台账尚未建立；待 PM 指派台账号后再登记」 |
| F-18 | 中 | Spec／Plan 引用 `inbox/` 下不��库的评审文件，入库后链接失效 | **已修**：改为指向本文件（本文件入库）；原始 findings／裁定草稿明确标注为本机 `inbox/` 临时件、不入库 |
| F-19 | 中 | Terminology 段落只写 2 处落点，§5 落位表列 3 处 | **已修**：Terminology 段补第三个落点 `result.structuredContent.next_step`（Spec 与 Plan 同步） |

**不在本条范围、未改动的批评审 findings**：F-04／F-05（REQ-030-017 与 explain Spec）、F-07（池 REQ-030-019 正文）、F-10／F-11（misreport 分支计划）、F-12（`lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md` 文件名含产品版本）、F-14／F-15（`docs/plans/README.md` 其他会话的索引行）、F-16（semantic-orphan Spec 引 gitignore 文件）、F-20–F-23（ADR 小节号与行号漂移）。这些属其他会话产物或存量文件，**本条不改**，由各自归属会话处理。

## 4. 第 2 轮对抗式评审（Claude Code，只读）

**评审对象**：Spec v0.3 ＋ Plan v0.3（含分支计划 §3.1 与第 3 节 9 条横切修订的逐条验证）。
**评审规模**：416 次工具调用，约 10 分钟，全程只读，未跑任何机器门禁与测试。
**总体判定**：**需再修订后实施**（2 blocker ＋ 7 major ＋ 7 minor）。

### 4.1 裁定者的独立复核结论

**评审提出的 16 条新发现，逐条回到源码复核，零误报**（下表的「复核」列即本机的独立取证结论）：

| ID | 严重级 | 主张（评审原文摘要） | 复核 | 处置 |
|---|---|---|---|---|
| N1 | blocker | Spec §6 伪码把**原始用户 filter 值**放进模型可见的 `query.filters`（`pick` 含 `"filters"` ＋ 塞原始值），与 D6／SC-05 冲突，且与 Plan 的 `filtersSummary` **不是同一个函数** | **成立**：Spec §6 两条注释自相矛盾（`:231` 说「原始」、`:240` 说「去值摘要」）；Plan 的 `NEXT_STEP_QUERY_KEYS` 不含 `filters` 且有独立 `filtersSummary` 入参 → **B2 在 Spec 侧复发** | 已修：§6 重写，`filters` 只认独立 `filtersSummary`；Plan Task 3.3 加 `nextStepProvenance` 裁剪 |
| N2 | blocker | D4「text 非 JSON 则三处都不发」被 Spec §6／Plan Task 3／分支计划 §3.1 **三处伪码同时违反** → SC-12 打不假，D3 不变式被实现本身打破 | **成立**：三处伪码都是「先算 `next_step` 再分别往三处写」，`structuredContent` 与 `_meta.lucy` 照发 → 「审计说已下发、模型一条没收到」 | 已修：改为**三处同生同灭**（D4 重写）＋新增 SC-12/18/19 断言 |
| N3 | major | §6 残留**从未定义**的 `existingLucyFields`，且与紧随其后的「关键点」直接冲突 | **成立**：按字面实现会 spread 上游既有 `_meta.lucy`，改变 Spec 162 §7.5 治理的形状 | 已修：§6 改为按现行实现逐字段重建 `lucy` 字面量 |
| N4 | major | D7 措辞在「同字段多条用户等值约束自相矛盾」时是**假事实** | **成立**：`row-policy.ts:672-676` 把同字段多条用户约束 AND 后取交集，`:703` 的 `userValues.size === 0` 命中的是**用户自己两条约束互斥**（与授权范围无关，此时取值反而**在**授权范围内） | 已修：`kind` 取 `scope_intersection_empty`，summary／建议**不预设成因** |
| N5 | major | 「载荷不得含 `rows` 等键」的护栏**无实现且会被载荷自身违反** | **成立**：`invalidMeasuresFieldReason`（`mcp-proxy.ts:1497-1509`）只要求 measure 项是字符串或带 `expr` 的对象，**不限制其余键** → `measures:[{"expr":"sum(1)","rows":999}]` 可通过校验并经 `boundedProvenanceValue` 逐键复制进入模型可见位 | 已修：**载荷白名单构造**（D11）＋ SC-14／SC-21 |
| N6 | major | Plan Task 1 测试代码有**语法错误** `valueCount": 1`（两处） | **成立**：整段复制进仓库即编译失败，SC-01…SC-08 一条都跑不起来 | 已修：两处引号；并补 `summarizeFilters` **真实调用**的形状断言 |
| N7 | major | 「行策略谓词绝不进 `next_step`」的核心不变量**零端到端覆盖**；SC-10/11/12 仍是注释骨架 | **成立**：夹具的 `lucy_query` 入参**不带任何 filter** → `originalUserFilters` 恒为 `undefined` → `query.filters` 在所有 Proxy 层测试里根本不出现 | 已修：夹具加**带 filter 的变体**，SC-10/11/12/18/19/20 补成可运行用例 |
| N8 | major | Plan 让 `allowedToolNames` 在**每个**响应上执行，与 Spec §8「只在 0 行冷路径」矛盾；`degradedGlobal` 下每次响应多触发一次策略重编译 | **成立**：`acl.ts:2897-2901` 的 `ensurePolicyRuntime` 在 `degradedGlobal` 时每次 `commitEffectivePolicy()` | 已修：可见性裁决**只在 0 行路径**求值（新增 SC-20） |
| N9 | major | 新登记的「行权限交集空」与**既有**「行范围与用户筛选无交集」（`scope_intersection_empty`）是同一事实的两个中文主称 | **成立**：术语标准 `:839` 既有行；`:41-49` §2.2「一个概念一个主术语」；`:801` 警告「四处同名异义，跨模块引用必须写明是哪一处」 | 已修：**取消新词**，沿用既有主术语与机器码，`kind="scope_intersection_empty"` |
| N10 | minor | Spec §5.1 示例的 `query` 键名与 provenance 真实键名**全不相同** | **成立**：provenance 真实键为 `connectionId`/`sourceName`/`orderBy`（`mcp-proxy.ts:2701-2718`）；§5.1 写的是 `connection`/`source`/`order_by` | 已修：示例改为 provenance 同源键名 |
| N11 | minor | `summarizeFilters` 的**真实形状**未登记；SC-05 对字符串 filter 与非安全 `op` **不可满足** | **成立**：`audit-privacy.ts:171-178` 的 `kind` 是 `list`/`single`、`items` 只取前 8 条而 `count` 是全量；字符串 filter → `{kind:"expression", length}`；`field`/`op` 不满足安全正则时**省掉** | 已修：Spec §5.1 登记真实形状表；SC-05 改为逐项对应 |
| N12 | minor | 分支计划的版本／编号指针过期（`v0.2` ×2、D1…D7） | **成立**：Spec 实际是 D1…D13（v0.3 起新增 D8/D9/D10） | 已修：分支计划升 v0.4，指针同步 |
| N13 | minor | 「非成功路径不叠加」在「200 + `result.isError:true`」上不成立 | **成立**：`classifyUpstreamFailure` 只拦 status ≥ 400（`:2552-2572`），`outcome="error"` 是**富化之后**才判定（`:2952-2963`） | 已修：新增 `result.isError` 短路（D13）＋ SC-18 |
| N14 | minor | JSON round-trip 副作用描述不准；上游自带 `next_step` 键会被**静默覆盖** | **成立**：整数样键名会被 JS 重排；`1e400` → `Infinity` → `null`、`1e-400` → `0` 属**值语义变化**；重复键被折叠；`{...parsed, next_step}` 覆盖上游同名字段 | 已修：风险表按真实表述改写；新增「不覆盖上游同名字段」短路（D12）＋ SC-19 |
| N15 | minor | G3 的草稿落 `inbox/eval-drafts/**`（被 gitignore 忽略），不可评审、不可追溯 | **成立**（`.gitignore:59`；`AGENTS.md:69-72` 定义 `inbox/` 为 tmp 区；G4 自己在 D2 里承认过同类问题） | **不属本条**：属 G3（REQ-030-020）产物，由其归属会话处理；本记录只登记 |
| N16 | minor | `docs/plans/README.md` 的池索引行落后池现值两版 | **成立**（池已到 v0.16） | 已修：索引同步到 v0.16，补 v0.15／v0.16 摘要 |

### 4.2 第 1 轮 16 条的复验结果

评审对第 1 轮的 16 条给出逐条裁定：7 条**已修复**（B1／B3／B5／M4／M6／M8／分页空页边界），7 条**部分修复**（B2／B4／B6／M2／M3／M5／M7——其中 B2／B4 的 Spec 侧判为「修错了」，即 N1／N3），1 条**未修复**（M1：`next_tools` 为空时无措辞——本轮以 D10 追加「`hint` 明说没有可用工具」处置）。

评审对「第 1 轮没有误报」这一判断的复核结论：**成立**；同时把第 1 轮两处推断降级（M1 的行为学推理、B3 的「上游自己过滤」推论），并指出第 1 轮把 `offline-batch-main.ts` 列为「不受影响的消费者」证据强度偏弱（该消费者本就和 KTX 的 `headers` 形状不兼容）。

### 4.3 对作者裁定的异议（评审 §C）与处置

| 议题 | 评审意见 | 处置 |
|---|---|---|
| 术语落位 §4.8 | 理由**成立**（§3 确为 UI 主术语表，撤回第 1 轮的 §3 建议），但 §4.8 **重号**（`:807` MCP 调试台／`:824` 访问权限升级），引用须写明是哪一处 | 已修：Spec／Plan 的引用写全为「§4.8（MCP 调试台 / ACL 裁决可见性，表格末行 `Effective Permissions Snapshot` 之后）」；**术语标准的重号本身属存量，本次不改**（他人产物，改动面超出本条） |
| D7 措辞 | 前半句成立、后半句在第三种成因下不成立（用户自身约束互斥；多臂时「那个」是单数指代） | 已修：文案改为不预设成因（中性表述），D7 论证同步重写 |
| 「评审没有误报」 | 复核成立，两处推断需降级 | 已记录进 §4.2 |

### 4.4 本轮未能验证的（评审 §E）

- 真实 KTX 0 行响应的 `content[0].text` 形状（仓内只有夹具样本，无真实样本）→ D4 分支在真实环境是常态还是边角，无法判定。
- 客户端渲染优先级（Claude Code / Cursor / Codex 读 `content` 还是 `structuredContent`）→ 仓内无这三个客户端的响应处理代码，D3 不变式在**客户端侧**仍只有推断级证据。
- `degradedGlobal` 下 `allowedToolNames` 的重编译开销未实测。
- 评审全程未跑任何机器门禁与测试（只读约束）→ 门禁由本方在修订后自行复跑。

### 4.5 修订后的文档状态

Spec 与 Plan 同步升至 **v0.4**（D1–D13 决策表、§5.4 落点×消费者兼容矩阵、§6 伪码重写、SC-01–SC-21）。三处索引镜像（`docs/README.md`／`docs/plans/README.md`／`docs/governance/project-overview.md` §9）与需求池条目同步；`docs/governance/project-overview.md` 升 v1.111，v1.105／v1.110 两处历史行均已紧贴「已作废，不得当作现值」。

**仍未获委托人批准**：D3 落点反转（追加 content 块 → 单块内加键）。确认前不授权实现。

## 5. 证据边界

- 本文件所有 `file:line` 引用均在 2026-11-07 当日实读核对；**未执行**任何真实数据查询、Eval 跑批、构建或部署。
- 评审过程只读；被评文件未被评审过程修改。
- 本文件**不构成**开工授权，也不表示任何功能已收口或可上线。
