# 多表命中先问 + 表级歧义门闩 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | **v0.5** / 2026-11-08（状态镜像 2026-11-13） |
| 状态 | **v0.5；R2-F＋R3（O1／O2／O4）＋R4 已闭合（2026-11-08）；实现已合入（本分支）；复审 BLOCK／CHANGE 已修；独立复验 PASS（2026-11-13，含 SC-17 HTTP／SC-25 生产装配）；待功能合同收口；本条不表示可上线** |
| 授权边界 | R2-F＋R3＋R4 已闭合。授权实现本 Plan Task 与复审 BLOCK／CHANGE 修复；不表示可上线。 |
| 验收 | Spec SC-01–SC-26 逐条有证据（§7.1 所列因 O 未闭合者保持未关闭）；`npm run lint:spec-docs` 退出 0；相关 vitest 全绿；歧义未确认／无 begin 事故路径零上游执行、explain 未进本地成功体。**SC-25／SC-26 必验，禁止按接线状态 skip**。**不构成发布取证，不表示可上线** |
| 台账号 | 无（`0.30` 台账未建立；待 PM 指派后再登记） |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| 需求来源 | 清单 P0-3；需求池 REQ-030-024 |
| Spec | [lucy-20261107-source-ambiguity-gate-spec.md](../specs/lucy-20261107-source-ambiguity-gate-spec.md)（**v0.5**） |
| 评审记录 | [Codex 对抗评审](../reviews/2026-11-08-source-ambiguity-gate-codex-review.md)；[实现复审 BLOCK](../reviews/2026-11-13-source-ambiguity-gate-implementation-review.md) |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) 落盘清单与 Plan Mode |

## 1. 目标

把「多表可能命中时先问」写入动态 instructions（单一事实源），并在 `lucy_query`／`lucy_explain_query` 的正确插入点增加表级歧义硬门闩：≥2 可见 **Source Identity** 命中则 stop，返回 ACL 裁剪候选；限定名错表与无 begin 事故路径仍可拦；确认用完整身份＋全引用集合＋**宿主 attested 用户参与证据**（独立于 Agent 自述／nonce）；不自动选表、不改 ACL 裁决口径（允许修订共享采集器以保留未知引用）。

## 2. 开工前置

1. Spec **v0.5-draft** 完成对 R3 findings 的修订后，再过过程对抗清零 → **R2-F 终稿确权**（Codex CLI 终审或委托人明示确权）。
2. **R3**：开工前 O 项由委托人书面闭合并回写 Spec：
   - **O1**（确认载体互斥二选一）— **必答**；未闭合不得实现确认分支，SC-07／SC-17 主路径保持未关闭；伪代码保持 `PENDING_CARRIER`，**禁止**默认选边。用户参与证据通道与 O1 **正交**，不因 O1 未决而免除 §4.4 层 B 合同。
   - **O2**（`lucy_read_source` 是否纳入）— **必答**；**无默认执行**；未闭合不得改 read_source 门禁，SC-21 未关闭。
   - **O3′**（未断言 source 的边角）— 可选；不得倒写 D10／§4.3 P1。
   - **O4** 可默认 8。
   - **O5** 词表资产后置— 未闭合不得实现资产分支；首期 §4.1 纯文本＋CJK n-gram 可实施。
   - **O6** defer— 首期不扩展 `denialAllowList` 短名通道。
3. **R4**：明确**开发授权**后才可改运行代码。
4. P0-1 BindingSession 四态＋`generation` 合同可读（D8／§4.2／§4.4）；P0-2 `description`／`descriptionState`／D4b 投影合同可读；本条另需描述读取健康态入口（Spec §4.6）。**SC-25／SC-26 必验**：P0-2 未接线时用同构直读夹具跑通，**禁止**按接线状态 skip。SC-12 描述字段接线子句可按真实接线状态断言，但不得免除 SC-25／SC-26。
5. 宿主 attested 用户参与证据通道选定并在 SC-17 固定（扩展 WebUI／会话用户回合写入 **或** 宿主确认提交 API；见 Spec §4.4）；**禁止**把 Agent 回传 nonce／begin.question／Agent 可写提交记录当用户确认。
6. 术语标准补登记 Source Ambiguity Gate／Source Identity 等。
7. 基线：`npm run lint:spec-docs` 绿（存量 WARN 除外）。

## 3. 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `webui/config/data-qa-instructions.md` | 修改 | 事实源：扩展「问询范围确认」至多表命中；修正「代理不实现确认门闩」表述 |
| `webui/server/proxy/mcp-proxy.ts` | 修改 | 动态／fallback／catch 插入同一 ASK_FIRST 片段；**query** 在 ACL 后／上游前挂门禁；**explain** 在约 `:4607` 本地成功体前挂门禁（不可只挂 `:5648` 共享 guard）；修订 begin 工具描述；确认核验／快照写入；**读取宿主 attested 用户证据**（非 tools/call 自述） |
| `webui/server/proxy/source-ambiguity.ts`（或新建 `source-ambiguity-gate.ts`） | 修改／新建 | §4.1 命中算法（含 CJK n-gram）、§4.3 分态优先级、身份去重、候选构造；**保留**既有字段级 `ambiguousFieldHint` |
| `webui/server/proxy/query-guardrails.ts` | 修改 | 接入 source 级顺序；限定名不跳过 source 级；读取失败／健康态分态 |
| `webui/server/proxy/acl.ts` | **修订** `acl.collect*` | 复用 `collectCanonicalSourceKeys`；**修订** `collectTableRefs`／`addTableRefsFromText`（或等价），使未知 filter／order_by 引用保留进 `unresolved`，**禁止** `fallbackUnknown:false` 静默丢弃；禁止在门闩模块另写平行采集器 |
| `webui/server/proxy/question-experience.ts` | 复用／严格封装 | `denialAllowList`／`buildRepairClosure`／五项证据；**禁止**全体失败时把完整 allow-list **或**五项失败命中塞进 `availableCandidates`；失败对象只经 `rejected`／`factualError` |
| `webui/server/proxy/caliber-binding-session.ts`（及装配入口） | 复用 | D8 四态只读；确认快照绑定 `generation`；禁止 mock 二分 |
| 宿主用户证据通道（WebUI／会话写入或确认 API） | 扩展既有通道 | 写入 `UserParticipationEvidence`；Agent tools/call **不可**伪造 |
| P0-2 描述投影装配入口 | 复用／扩展只读健康态 | 向门闩传入 `DescriptionReadHealth`（§4.6）；不得仅依赖 `missing` |
| `webui/docs/00-product-terminology-standard.md` | 修改 | 新术语 |
| `webui/server/__tests__/source-ambiguity-gate*.test.ts` | 新建 | SC-01–SC-26（§7.1 未闭合者除外；**SC-25／SC-26 不得 skip**） |

**并行修改冲突热点**：`mcp-proxy.ts`、`query-guardrails.ts`、`acl.ts`（collect*）、描述投影装配与 P0-1／P0-2 重叠——授权落地时建议：P0-2 先合描述投影＋健康态；P0-3 再合 gate／instructions／collect*；P0-1 binding 已合则只读复用 `generation`。或由同一 coder 串行。

**不应被多 agent 同时修改**：`mcp-proxy.ts`、`acl.ts` collect* 路径、`source-ambiguity-gate` 新建文件、`question-experience.ts` 的 repair 调用约定。

## 4. 任务分解

### S0：决策闭合与夹具

- 回写 O1／O2（必答）及可选 O3′／O5；**禁止**把历史「默认建议否」当 O2 已闭合；**禁止**伪代码默认选 O1 边。
- 选定并登记宿主 attested 用户证据通道（与 O1 正交）。
- 准备夹具：≥2 身份命中／单命中／真实零命中／目录读取失败／描述读取失败健康态／双角色越权／限定名错表／无 begin＋错表单命中／双连接同名／多引用冲突／未知 filter `ghost.amount`／确认正反例（含拒绝后立即自填、仅 nonce 回传、仅 Agent 提交记录、无宿主证据、generation supersede、宿主证据正例）／BindingSession 四态／D7 共存／repair 五项失败＋禁止「可用候选」冒充／「今年收入是多少」中文整句／描述原文含不可见表名（对象级仍过）／SC-25／SC-26 同构直读。
- **验证**：R3 必答项闭合；夹具可驱动 SC-03–06、15–20、23–26。

### S1：Instructions 事实源与四路径

- 改 `data-qa-instructions.md`；抽取同一渲染片段；动态／空／异常路径共用；修订 begin 工具描述。
- **验证**：SC-01、SC-02、SC-22。

### S2：表级命中纯函数（身份＋算法＋健康态）

- `extractTerms`（含 CJK n-gram）／`matchVisibleSources`（§4.1）；§4.3 优先级；Source Identity 去重；度量摘要；P0-2 `description`＋健康态（§4.6）；allow-list 短名成员检查；不新建白名单。
- **验证**：SC-06、SC-08、SC-09、SC-11、SC-12、SC-16、SC-20、SC-24、SC-25、SC-26（后两者必验）。

### S3：query／explain 插入点、确认、引用集合与无 begin

- 按 Spec §6.1 接线；限定名不豁免；D10／§4.3 分态；§4.5 `collectCanonicalSourceKeys`＋**修订 acl.collect***；§4.4 载体（O1 闭合后）＋宿主用户证据核验＋generation 快照；上游／explain 成功体计数 0。
- **验证**：SC-03–SC-05、SC-07（O1 后）、SC-13、SC-15、SC-16（含 ghost.amount）、SC-17（O1 后关主路径；用户证据反例可先测）、SC-19、SC-23。

### S4：与 P0-1 BindingSession 串联

- 四态映射；`lost_or_conflict` → unresolved；仅 `begun_bound` 跳过；确认／快照／用户证据绑定 `generation`。
- **验证**：SC-10（实际状态装配）；SC-17 中 supersede／代次用例。

### S5：repair 证据与术语

- `toRepairTargetEvidence` 按 §4.7；`availableCandidates=[]` 当无 usableTargets；禁止五项失败进「可用候选」文案；术语标准；清单／需求池状态同句。
- **验证**：SC-18、SC-14。

### S6：O2 分支（仅裁定后）

- 若 O2＝纳入：为 `lucy_read_source` 接线同口径；若否：显式文档化不拦并关 SC-21。
- **验证**：SC-21。

### S7：对抗式评审与收口准备

- 对 v0.5 过程对抗清零 → **R2-F** → R3 → 申请 **R4** 后方可合并运行代码。
- **验证**：评审记录落 `docs/reviews/` 并回链 Spec／本 Plan。

## 5. 验收

- Spec SC-01–SC-26 逐条有证据或按 §7.1 书面未关闭；**SC-25／SC-26 与 Spec 统一为必验出口，禁止接线 skip**。
- `npm run lint:spec-docs` 退出码 0；相关 vitest 全绿。
- 未确认多表命中／无 begin 事故路径／描述健康态失败：**本机拒绝且上游／explain 成功体计数为 0**。
- **不构成发布取证，不表示可上线**。

## 6. 完成定义

- SC-01–SC-26 均有自动化证据，或 §7.1 未闭合书面记录。
- instructions 与 tool gate **同批**合入，禁止只合文案。
- 未获 R2-F＋R3＋R4 前无运行代码合入；授权后合入须附实现笔记。
- **不宣称可上线**；**不宣称终稿确权**。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 误读「R3 修订即可开发」 | 授权边界写死 R1→R2→R2-F→R3→R4 |
| O1／O2 默认执行 | Spec 开放决策守卫；伪代码互斥待决；S0 必答 |
| 无 begin 永不硬拦／单命中误放 | §4.3 P1；SC-15 |
| 拒绝后立即自填／nonce 冒充确认 | §4.4 层 B；SC-17 |
| 多引用被单 key 放行／未知 filter 丢弃 | §4.5；修订 acl.collect*；SC-16 |
| 五项失败冒充可用候选／allow-list 冒充 | §4.7；SC-18 |
| 描述失败吞成 missing／SC-25 skip | §4.6；SC-25 必验 |
| 全文无受限名与透传冲突 | D15；SC-13／26 必验 |
| explain 漏挂共享 guard | §6.1／S3／SC-23 |
| 与 P0-1／P0-2 改同一文件冲突 | §3 热点串行约定 |
| 误伤宽词 | §4.1；≥2；SC-06／SC-20 |
| 只合 instructions 被报完工 | 完成定义强制双层 |

## 8. 建议实施序（产品线）

本条为 **Spec 批次 S3** 主角，依赖 S1（P0-1）BindingSession／generation 可读、受益于 S2（P0-2）描述投影＋健康态。评审带宽优先本条与 P0-1／P0-2 串联用例，不插队 P2 辅线实现。

## 9. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.5（状态镜像） | 2026-11-13 | 实现已合入；独立复审 **BLOCK**（待修）。与 Spec 头部同句现值；不表示可上线 |
| v0.5-draft | 2026-11-08 | 对齐 Spec v0.5；闭合 R3 残留 **F-R2-03…06**：宿主 attested 用户证据、修订 acl.collect*、五项失败不得进 availableCandidates、SC-25／SC-26 必验禁 skip；O1／O2 仍互斥待决；终稿未确权、未授权实现 |
| v0.4-draft | 2026-11-08 | 对齐 Spec v0.4；任务／夹具覆盖 **F-R2-01…F-R2-07**；SC 扩至 26；O1／O2 仍互斥待决；终稿未确权、未授权实现 |
| v0.3-draft | 2026-11-08 | 对齐 Spec v0.3；**F-11** 门禁链改为 R1→R2→R2-F→R3→R4；撤销 O2 默认执行（F-03）；任务覆盖 F-01–F-10 验收；SC 扩至 24；终稿未确权、未授权实现 |
| v0.2-draft | 2026-11-07 | 第 1 轮评审配套 |
| v0.1-draft | 2026-11-07 | 初稿 |
