# P1-73 开发台状态治理伞（漏斗 + 状态词）双 Spec 批次审阅

| 元数据 | 内容 |
|---|---|
| 文档类型 | 批次评审报告（REQUEST CHANGES） |
| 日期 / 审阅人 | 2026-11-22／MiniMax Code（主会话独立审阅，未走 Codex 交叉审阅） |
| 审阅对象 | 漏斗 Spec v0.2-draft、漏斗 Plan v0.2-draft、状态词建议书 v0.4-draft |
| 总账 | P1-73／REQ-030-094（伞：漏斗 + 状态词）；v2.16 |
| 审阅方式 | 全文通读 + 仓库实测（lint 实现、CI 接线、基线豁免量、真实语料统计） |
| 结论 | **REQUEST CHANGES**。双规则伞的**方向与分工我认同**，但落地前有 6 项 blocker 必须闭合——其中 4 项是「规则按字面实现会打红自己或存量」，2 项是「同一镜像位被两份文档同时占用」。**Wave A → Wave B 的顺序我倾向认同，但 Wave B 必须补 PR CI 接线，否则这批次等于承认漏斗门禁只在发版流水线生效。** |

审阅对象：

- `docs/specs/lucy-20261122-spec-status-funnel-gate-spec.md`（v0.2-draft）
- `docs/plans/lucy-20261122-spec-status-funnel-gate-plan.md`（v0.2-draft）
- `docs/plans/lucy-20261122-spec-status-vocabulary-chinese-plan.md`（v0.4-draft）

规则事实源：`docs/governance/DEVELOPMENT.md`（「状态登记只有一份现值」`:149`、「功能闭口与发布取证」`:120`、「落盘清单（逐条勾销）」`:317`）
机器门禁实现：`scripts/lint-spec-docs.mjs`、`docs/governance/spec-plan-doc-baseline.json`、`package.json`、`.github/workflows/lucy-ci.yml`、`.github/workflows/lucy-release.yml`

---

## 一、逐项裁定

| 项 | 裁定 | 依据摘要 |
|---|---|---|
| 总账 P1-73 伞（漏斗 + 状态词）v2.16 | **认同** | 两份文档确为互补非重复（M1 成立）；伞结构与「不入核心分母」写法一致。但总账行的现值句须与两份子文档的镜像关系重新对齐（见 🟡-1）。 |
| 漏斗 D15（双规则伞） | **有条件认同** | 「共享 `lint-spec-docs` 实现库、禁止第二份词表」这点立得住。但 D15 承诺的「进 PR CI」在 Wave B 侧没有兑现路径：§8 白名单把 `.github/workflows/lucy-ci.yml` 限定为 Wave A 专用（见 🔴-5）。 |
| 漏斗 D16（与中文推荐写法） | **认同** | 「九词＝软推荐、本轮不机器强制、不用正向中文枚举代替阶段码」判断正确。唯一需补：§3.1 的 8 码 ↔ 9 词是**一对多**，D16 只说「九个中文原子」，没声明多对一关系（见 🟡-3）。 |
| 漏斗 §3.1 映射表 | **认同（须补两处）** | 8 码 ↔ 9 词映射**完整、无遗漏**（S4←实现已落地+待验收；X_DEF←延期+结案不做；X_REL 无原子），与建议书 §3.3 九词表**逐字对得上**。缺的是：① 建议书侧没有反向指针（🟡-3）；② 映射表与 D4 词表之间没有联动规则（🔴-3）。 |
| 漏斗 §3.2 分工表 | **认同** | 两规则的扫描面、硬软、存量策略三列都不打架，与建议书 §4.5 改裁后一致。措辞修正：「上线前清零本规则违规」→ 状态词是治理层规则，不宜挂在「上线」口径上，建议改「本规则落地前清零」。 |
| 漏斗 OQ-6（Wave 顺序） | **有条件认同** | A→B 顺序本身合理（vocab 零基线、不动存量结构、可独立进 PR CI；funnel 需 grandfather + 迁移批）。条件是 Wave B 必须同时补 CI 接线，否则 B 落地后门禁仍只在发版流水线（🔴-5）。 |
| 漏斗 OQ-7（建议书并入 P1-73） | **认同** | 与建议书 §6.1 第 8 条「已裁：不另开行」完全一致，无残留矛盾。 |
| 建议书 v0.4 §4.5／§6.1#8／§9／§10 改裁 | **§4.5 认同／§6.1#8 认同／§9 认同／§10 不成立** | §4.5「仍不做多字段渲染、阶段行归漏斗」正确；§6.1#8 与 OQ-7 对齐；§9 待审阅项已更新。**§10「镜像 2 = 总账 P1-73 跟进状态」与 §7 完成定义第 10 条不成立**——总账行只有一句现值且已属漏斗 Spec（🟡-1）。 |
| 落地序 Wave A → Wave B | **有条件认同** | 同 OQ-6。 |
| 状态词建议书「已知存量仅 1 处 `Draft`」 | **反对** | B2 子规则与「零基线新增」互斥，实测存量打红面是 **70 份**不是 1 份（🔴-4）。 |

---

## 二、🔴 Blocker（落地前必须闭合）

### 🔴-1　D3 的整格匹配与漏斗 Spec 自己的头部冲突，`**S1**` 会被自家规则判红

- 漏斗 Spec `:9` 头部写的是：`| 阶段 | **S1** |`（含 markdown 粗体标记）
- D3 `:111`：「Spec 元数据表须有恰好一行 `| 阶段 | <CODE> |`，`<CODE>` ∈ {S1,S2,S3,S4,S5,X_DEF,X_SUP,X_REL}」
- §4.1 `:156-166`：「元数据表中去掉空白后匹配 `|阶段|<CODE>|`」「`<CODE>` **必须整格匹配**下列之一（大小写敏感）」

去掉空白后是 `|阶段|**S1**|`，不等于 `|阶段|S1|` → **整格匹配失败**。

这不是孤例推测：

- 姊妹建议书 §3.4 的 B2 `:220` 已经踩过同一个坑并**显式处理**了（"凡表头单元格（**去 `*`**）为 `Status` 的行"），说明「容忍 `*`」是这套 lint 的既有约定；
- 仓库既有实现 `scripts/lint-spec-docs.mjs:622` 的 `statusCell` 用 `^\|\s*\*{0,2}状态\*{0,2}\s*\|` 容忍粗体标签；
- 但漏斗 §4.1 **完全没有提「去 `*`」**。

**影响**：这是本批次唯一会被大规模复制的写法——后续每一份新 Spec 都会照抄 `**S1**`，然后被自己的门禁打红。门禁第一次生效就红，规则会被直接绕过。

**改法（二选一，必须写死）**：

- 方案 a：§4.1 改为「去掉空白并去掉 `*` 后整格匹配 `<CODE>`」，与 `statusCell` 的既有宽容度对齐；
- 方案 b：Spec 头部改成 `| 阶段 | S1 |`（去掉粗体），Plan 侧同步去掉 `**`（见 🔴-2 的 D7）。

### 🔴-2　D5 的字面禁令没有否定语境规则，会把 216 份现存文档的标准写法判红

- D5 `:113`：「『状态』或『阶段』值不得把 `可上线`、`UAT PASS`、`测试台PASS` 当作阶段码」
- 伪代码 `:219`：`if stageCellHasProse(text) or statusClaimsStageAlias(text): return FAIL(...)` —— `statusClaimsStageAlias` 未定义否定语境处理

实测（`docs/specs` + `docs/plans` 共 384 份）：

| 现象 | 份数 |
|---|---|
| 状态行含「可上线」 | **216** |
| 其中绝大多数是「≠ 可上线」这类**否定句**（DEVELOPMENT.md「功能闭口与发布取证」要求的**标准写法**） | 如「≠ 可上线。」34、「≠ 可上线**」34、「≠ 功能合同收口 ≠ 可上线**」等 |
| 状态行含「UAT」 | **52** |

**影响**：若按字面包含判定，所有按 DEVELOPMENT 标准写法写「≠ 可上线」的文档全被误判——而这恰恰是门禁最想强制的写法。既有 `stale-status` 规则已经解决过同类问题：用「作废标记必须紧贴该句」区分已作废与裸写。D4／D5 没有借这个范式。

**改法**：D5 拆成两条——

1. **阶段码格**（`| 阶段 |` 单元）不得含 `可上线`／`UAT PASS`／`测试台PASS`（这格本来就是纯码）；
2. **状态行**不得「把 X **当作**阶段码」，判定式写成「X 紧邻阶段码位或冒号出现」，并**显式声明 `≠ 可上线`、`≠ UAT PASS`、`≠ 功能合同收口` 等否定式允许**。

### 🔴-3　D4 的字面词表漏掉语义等价写法——建议书自己就是活样本；`Wave 0` 语义站不住

D4 `:112` 词表：`≠功能合同收口`、`≠完整功能合同`、`功能合同尚未收口`、`功能合同待终稿复核`、`实现进行中`、`Wave 0`

实测 384 份状态行命中：

| 词表内短语 | 命中份数 |
|---|---|
| `≠功能合同收口` | 10 |
| `≠完整功能合同` | 4 |
| `功能合同尚未收口` | 7 |
| `功能合同待终稿复核` | 1 |
| `实现进行中` | 4 |
| **`Wave 0`** | **0** |

漏网的语义等价写法：`≠功能已收口` **1**、`未收口` **7**、`尚未收口` **7**。

两个问题：

1. **建议书 `:8` 的状态行写的就是「≠ 功能已收口」**（去空白后 `≠功能已收口`）——**不在 D4 词表内**。同一批次的姊妹文档自己用了漏网写法。
2. **`Wave 0` 语义站不住**：它是执行波次标记，不是「未收口」表述（例：`docs/plans/2026-08-26-lucy-agent-chat-a3-optimization-plan.md:14` 的「Wave 0（本文修订）已批准；Wave 1+ 实现按本计划执行」），且全仓状态行命中 0 份。这条像是从别的上下文抄进来的。

**影响**：字面词表拦不住语义漂移——每补一个同义写法就会再漂一次。这与本批次「状态词治理」的初衷相反。

**改法**：D4 改为**判定方式**而非词表：正面定义「收口」的判据（例如状态行出现「已收口／功能合同收口」等正向表述时，若同句同时出现否定式或「未／尚未」修饰，则判矛盾），并配一张显式允许列表；`Wave 0` 从词表删除。若坚持字面表，至少补 `≠功能已收口`、`未收口`、`尚未收口`，但要接受它治不了根。

### 🔴-4　建议书 B2 的「状态行可解析」子规则与「零基线新增／已知存量仅 1 处」直接互斥

- 建议书 §3.4 B2 `:221`：「若独立扫描找不到表头为「状态」的行（`statusCell` 为空且亦无已报告的 `Status` 表头命中）→ **报 `status-vocab`**」
- 建议书 §2.1 目标 3 `:123`／§3.1 `:170`／§5 第 8 条 `:314`：status-vocab **不申请基线豁免**、**已知存量仅 1 处**（`Draft \`r6\``）、落地瞬间零违规、**零基线新增**

实测 `docs/governance/spec-plan-doc-baseline.json`：

| 规则 | 存量豁免条目数 |
|---|---|
| `metadata` | **102** |
| `plan-parts` | 365 |
| `filename` | 317 |
| `index` | 95 |

对这 102 个 `metadata` 豁免文件逐个解析：**70 份确实解析不出「状态」行**（另 32 份有状态行但缺 `授权边界`／`验收`）。

**影响**：B2 子规则一开，这 **70 份**文件在 `lint:status-vocab` 下全部红灯；而该规则又声明不允许写基线豁免 → Wave A 无法在「零基线新增」前提下落地。**开工前置第 8 条把清理范围低估了一个数量级（1 → 70+）。**

「缺状态行」本就归 `metadata` 规则管（它有 102 条基线豁免、且只报一次），B2 再报一次属重复职责。

**改法**：

- 把「状态行可解析」子规则从 `status-vocab` **摘出去**，`status-vocab` 只保留「英文 deny-list」＋「表头不得为 `Status`」两件事；或
- 保留子规则但改为「**不重复报**：`metadata` 已报过的同文件不再由 `status-vocab` 报缺状态行**」，并在 §5 第 8 条把存量清单改为「1 处 `Draft` ＋ 70 份缺状态行文件（由 `metadata` 规则口径判定，`status-vocab` 侧豁免）」。

顺带：建议书 `:221` 提的「与 `metadata` 分工的明确子码」在本仓库不存在——门禁的键是 `file::rule`，没有子码机制。这条建议本身也不可实现。

### 🔴-5　Wave B 的漏斗门禁只会落在发版流水线，PR CI 缺口原样保留

- 实测 CI 接线：`.github/workflows/lucy-ci.yml:70` 只有 `npm run lint:spec`；`.github/workflows/lucy-release.yml:85-86` 才跑 `lint:spec` ＋ `lint:spec-docs`
- 漏斗 D12 `:120`：「**主强制面＝`lint:spec-docs`**。可选：既有 CI job／Agent 出门脚本调用同一命令」
- 漏斗 Plan 步骤 1b `:32`：实现 `status-funnel` —— **无任何 CI 接线步骤**；步骤 6 `:37` 只要求 `lint:spec-docs:test` 绿
- 漏斗 §8 `:271`：`.github/workflows/lucy-ci.yml` 明确限定为「**仅当同批授权 Wave A**：`lint:status-vocab` 共用实现」→ **Wave B 想接 PR CI 也超出落地白名单**

姊妹建议书 §4.3.1 `:263-272` 已经用实证说明了后果：2026-11-22 HEAD 已经红了（`docs/plans/lucy-20261122-prepack-closure-multi-agent-plan.md` 的 `plan-parts`×4 ＋ `metadata`），能进 HEAD 没被拦「**正是因为 `lucy-ci.yml` 不跑 `lint:spec-docs`**」。

**影响**：Wave A 补上 PR CI，Wave B 不补 → 合并两批次看，缺口从「全部形态规则」缩小到「漏斗阶段规则」，但**没有消失**。作为「门禁」批次，这个取舍需要委托人明裁，不该默认。

**改法**：把「`status-funnel` 进 `lucy-ci.yml`」从 D12 的「可选」提为 **Wave B 必做项**（复用 Wave A 的同一实现库与接线位置，不新增第二套）；同时把 §8 白名单里 `lucy-ci.yml` 的限定语从「仅当 Wave A」改为「Wave A／Wave B 均可用」。若委托人选择不接 PR CI，则须在 D12 与 Plan 步骤 1b 明写「漏斗门禁仅在发版流水线生效」并接受该后果。

### 🔴-6　SC-14 的落地 diff 白名单与 §8 落地白名单互相矛盾，Wave A 按 SC-14 判必红

- §8 `:270-275` 允许修改：`scripts/lint-spec-docs.mjs`／`.test.mjs`、**`package.json`**、**`.github/workflows/lucy-ci.yml`**、`docs/governance/` 下 grandfather json、`DEVELOPMENT.md`、本 Spec／Plan／姊妹建议书／两个 README／总账与需求池镜像句、可选 `.cursor/hooks*`
- SC-14 `:250`：「落地 diff 白名单：**仅** Spec／Plan／索引／总账／需求池镜像／`lint-spec-docs*`／grandfather json／`DEVELOPMENT.md`；**无** `webui/src`、`webui/server`、KTX」

SC-14 的「仅」清单**没有** `package.json`、`.github/workflows/lucy-ci.yml`、`.cursor/hooks*`。

**影响**：Wave A 步骤 1a 必然要改 `package.json`（新增 `lint:status-vocab`）与 `lucy-ci.yml`（接入 CI）→ 按 SC-14 的白名单做路径检查 = 失败。验收项与自己的落地清单打架。

**改法**：以 §8 为准，把 SC-14 的允许清单补齐为 §8 的全集（或反过来在 §8 注明「SC-14 按本节白名单核对」）。

---

## 三、🟡 建议（可与定稿同批处置）

### 🟡-1　两份文档的「状态」句不同，却共用同一个总账行作镜像 —— DEVELOPMENT.md「同一句现值」无法同时满足

- 漏斗 Spec `:10` 状态：`S1｜v0.2-draft。仅登记与起草，不开发。** P1-73 为开发台状态治理伞：…`
- 建议书 `:8` 状态：`S1｜v0.4-draft。** 对抗审查与 B1／B2 已闭合；…`
- 建议书 §10 `:400`「镜像 2 = 执行总账 P1-73／REQ-030-094 跟进状态」；§7 完成定义第 10 条 `:361` 要求收口时「同一次改动改齐已存在的镜像（至少 … 总账 P1-73 跟进句）」
- 但总账只有一行、只有一句现值，当前写的是**漏斗 Spec 那句**：`docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md:319`

**建议书无法在不推翻漏斗镜像的前提下满足自己的完成定义。**

顺带实测：本批次 6 处镜像已经是 **6 个不同变体**——漏斗 Spec `:10`、漏斗 Plan `:7`、建议书 `:8`、`docs/README.md:78`、`docs/plans/README.md:7` 与 `:42`、总账 `:319`、需求池 `:70`。

**改法**：总账 P1-73 行改为**伞级现值句**（一句统辖两个子项），两个子文档的状态写成该句的子句并在 §10 声明「本文件状态是伞级现值的 Wave A 子句，**不构成独立镜像**」；或给建议书单列一句更短的伞级状态并同步全部镜像。本批次正是统一这 6 处变体的窗口。

### 🟡-2　落地白名单缺 `docs/governance/test-layers-and-release-gates.md`，落盘清单第 8 条无处落脚

- DEVELOPMENT.md 落盘清单第 8 条：新增命令／CI job **必须在测试门禁文档登记**
- 建议书要新增 `npm run lint:status-vocab` ＋ `lucy-ci.yml` job；漏斗要新增 `status-funnel` 规则 ＋ CI 接线
- 但建议书 §3.1「三处落点」`:153-159` 只列了 DEVELOPMENT.md ×2 ＋ `lint-spec-docs.mjs`，**漏了这个文件**；漏斗 §8 白名单也不含它 → 落地时改它就**超出白名单**
- 实测登记位存在：`docs/governance/test-layers-and-release-gates.md:41-42`（§2 Current Commands，已登记 `lint:spec`／`lint:spec-docs`）与 `:299`（§8 CI Mapping 的 `spec-and-unit` 行）

**改法**：建议书 §3.1 增第 ④ 落点；漏斗 §8 白名单增该文件。

### 🟡-3　建议书 §3.3 的推荐词表没有「阶段码」列，DEVELOPMENT.md 同一章节会出现两套并行口径

M4 `:53` 裁的是「漏斗 Spec §3.1 给官方映射」；但真正要写进 DEVELOPMENT.md 落① 的是**建议书 §3.3 的九词表**，该表没有阶段码列。落① 的「状态措辞用中文」子节（9 个词）与紧邻的漏斗阶段子节（8 个码）将**并列出现在同一章节**，且读者从建议书侧看不出「待验收」对应 S4、「延期／结案不做」对应 X_DEF。

**改法**：§3.3 正文表增一列「阶段码」；或在表下加一行「阶段码对照见漏斗 Spec §3.1；S4＝实现已落地／待验收，X_DEF＝延期／结案不做，X_REL 无推荐原子」。这直接关系到 §3.2 承诺的「唯一口径仍只写在 DEVELOPMENT.md 一处（可分子节：措辞中文 + 漏斗阶段）」是否成立。

### 🟡-4　漏斗 §10「落盘清单自检」跳过的编号里有实际适用的

自检表 `:296-309` 列了 1,2,3,4,5,6,7,11,13,14,16,17，**缺 8、9、10、12、15、18**：

| 缺项 | 是否适用 | 说明 |
|---|---|---|
| **#8** 新增命令／CI job 登记 | **适用** | 见 🟡-2 |
| **#10** 落盘后跑一遍机器门禁并逐条勾销 | **适用** | 实测 `npm run lint:spec-docs` 当前 HEAD 是红的（`lucy-20261122-prepack-closure-multi-agent-plan.md` `plan-parts`×4 ＋ `metadata`），**三份新文件本身 0 违规 ✅**；但漏斗 Plan 步骤 6 `:37` 只写了「`lint:spec-docs:test` 绿」，**没写「全量 exit 0 不作为本条验收口径」**——建议书 §5 第 7 条 `:313` 写了，两边口径不齐 |
| **#15** 端到端三台账 | **适用** | 头部已写「测试台 not_registered／不入核心分母」，但自检表无对应行 |
| #9 台账号 | 适用 | 头部已写「无」，自检表无对应行 |
| #12 已作废状态句 | 不适用 | 本 Spec 无作废状态句；规则短语「未执行且不排期」已作废，不再写 |
| #18 浏览器验证 | 不适用 | 不触 WebUI 用户可见面（但应写明「不适用」而非留空） |

### 🟡-5　跨文档事实漂移：「137 份 Spec」口径未写明，与建议书的 150 不一致

- 漏斗 §1 `:81`：「2026-11-22 **全仓 137 份** Spec 盘点」
- 建议书 §1.2 `:91`：`docs/specs/*.md` = **150**；`:93` `webui/docs/*-spec.md` = **189**

实测：

| 口径 | 数量 |
|---|---|
| `docs/specs/*.md` 总数 | **151** |
| 其中 git 已跟踪 | 150 |
| 其中**含「状态」行** | **138** ← 与「137」几乎重合 |
| 含「闭口层级」 | 125 |
| `docs/plans/*.md` 总数 | 233 |
| `webui/docs/*-spec.md` | **189** ✅ 与建议书一致 |

**结论**：「137」不是简单的过期数字，它接近「docs/specs 中含状态行的份数」（写稿时 137，漏斗 Spec 落盘后 138）。但漏斗写的是「**全仓** 137 份 Spec 盘点」，会被读成全仓 Spec 总数（实为 151）。**口径没写明**才是问题。建议书 150 ＝ 写稿时漏斗 Spec 尚未落盘，现应为 151。`webui/docs` 189 ✅ 准确。

另：建议书 §1.2 表 `:92` 中 `docs/plans/*.md` 的文件数写「—」（同表其他行都给了数），实测 233，建议补齐。

**建议书的行号引用我逐条核过，全部准确**（`DEVELOPMENT.md:149`／`:317`／`:122`／`:369`／`lint-spec-docs.mjs:619-623`／`:337`／`:441-449`／`:512-523`／`:508-511`），这一项做得扎实。

### 🟡-6　建议书 §10 自设「事实源」与 DEVELOPMENT.md 的定义不同源

建议书 `:398` 把「本文件头部「状态」行」定为事实源；而 DEVELOPMENT.md「状态登记只有一份现值」定义的事实源是「**该功能 Spec** 头部的「状态」行」。建议书是 Plan、不是 Spec，且没有配对 Spec——它的镜像关系（`docs/plans/README.md` 索引行 ＋ 总账行）没有现成 SOT。

**改法**：在落①写回 DEVELOPMENT.md 时补一句：治理类建议书／无 Spec 文档的状态事实源归属；或让建议书在 §10 明确指向伞 Spec 作为伞级事实源（与 🟡-1 同一处置）。

---

## 四、🟢 Nits

1. **grandfather 名单快照点未写明**：§8 `:272` 与 Plan 步骤 2 `:33` 用 `git ls-files docs/specs/*.md`，但没说快照点是「落地提交前」还是「后」。语义上必须在落地提交**前**生成（否则落地提交里新建的 Spec 会被写进名单、逃过检查）。建议在 Plan 步骤 2 明写「名单在落地提交**前**生成；落地提交内新增的 Spec 不在名单，按新规受检」，并补一条「本批次不得在落地提交内新建 Spec」。
2. **`| 阶段 |` 行建议统一不带粗体**：若采用 🔴-1 的方案 b，除 Spec 头部外，Plan 侧 `**S1｜...**` 的粗体前缀也会破坏 D7 的前缀匹配（见下），三处一并去掉更省事。
3. **`status-vocab` 与 `status-funnel` 的规则名应进 §2 目标与 §6 验收的编号**（漏斗 §6 有 SC-01–SC-14，建议书 §6.2 有 1–6，两套编号体系不相通，合并落地时容易漏勾销）。建议在伞 Plan 步骤 6 加一行「两套验收编号合并勾销表」。

---

## 五、事实核对台账（本次实测）

| 断言 | 出处 | 实测 | 判定 |
|---|---|---|---|
| `statusCell` 只匹配中文「状态」，`Status` 表头恒不触发 | 建议书 `:44` | `scripts/lint-spec-docs.mjs:622` = `^\|\s*\*{0,2}状态\*{0,2}\s*\|([^|\n]*)` | ✅ 成立 |
| 扫描面＝`docs/specs`＋`docs/plans` 顶层非递归 | 建议书 `:163` | `listMarkdown` `:95-102` = `readdirSync` 顶层、排除 README.md | ✅ 成立 |
| `webui/docs` 只跑 `filename` | 建议书 `:163` | `:508-511` 仅 `collectFilenameViolation` | ✅ 成立 |
| `lucy-ci.yml` 不跑 `lint:spec-docs` | 建议书 `:259` | `lucy-ci.yml:70` 仅 `lint:spec`；`lucy-release.yml:85-86` 才有 | ✅ 成立 |
| HEAD 已被形态门禁染红 | 建议书 `:265-272` | 实跑 `npm run lint:spec-docs`：`prepack-closure-multi-agent-plan.md` `plan-parts`×4 ＋ `metadata` | ✅ 成立 |
| 存量独立词 `Draft` 1 处 | 建议书 `:92`／`:314` | `docs/plans/2026-10-21-customer-20260828-v1-to-lucy-2.0-upgrade-plan.md:9` = `\| 状态 \| 未执行。当前 Draft \`r6\` 不是放行包 \|` | ✅ 成立 |
| 「零英文／零豁免」被证伪 | 建议书 C2 | 独立大写 `Draft` 仅此 1 处；`-draft` 约 47 处 | ✅ 成立 |
| 三份新文档自身形态合规 | — | 实跑 `npm run lint:spec-docs`：三份新文件 **0 违规** | ✅ 成立 |
| 建议书「已知存量仅 1 处」 | 建议书 `:123`／`:314` | B2 子规则下实际 **70 份**缺状态行文件会打红 | ❌ **不成立**（🔴-4） |
| 漏斗 §1「全仓 137 份 Spec」 | 漏斗 `:81` | `docs/specs` 实际 151；137 ≈ 含状态行者 138 | ⚠️ **口径未写明**（🟡-5） |
| 建议书 `docs/specs` 150 份 | 建议书 `:91` | 现为 151（写稿时 150 成立） | ⚠️ 需同步（🟡-5） |

---

## 六、复核命令

```bash
npm run lint:spec-docs                       # 实测：HEAD 红灯仅来自 prepack-closure-multi-agent-plan
ls docs/specs/*.md | wc -l                  # 151
ls docs/plans/*.md | wc -l                  # 233
ls webui/docs/*-spec.md | wc -l             # 189
grep -n "lint:spec" .github/workflows/lucy-ci.yml .github/workflows/lucy-release.yml
```

**结论汇总**：REQUEST CHANGES。6 项 blocker 闭合后可进定稿；方向（双规则伞互补并入 P1-73、Wave A→B）我认同，不建议推翻重做。

**本报告不表示**：双规则已实现、lint／CI 已改动、开发已授权、任何功能已收口、≠ 可上线。

---

## 八、定稿闭合记录（2026-11-22）

委托人批准代理反馈改裁并定稿。文档已升 **v1.0／阶段 S2**；**仍未获开发授权**。

| Blocker | 定稿处置 |
|---|---|
| 🔴-1 | D3／§4.1：去掉空白与 `*` 后整格匹配阶段码 |
| 🔴-2 | D5：阶段格禁散文／可上线／UAT；状态行否定式 `≠ 可上线` 等显式允许 |
| 🔴-3 | D4：显式未收口短语表（含 `≠功能已收口`／`未收口`／`尚未收口`）；删 `Wave 0`；正面 NLP 留 v1.1 |
| 🔴-4 | `status-vocab` 摘「缺状态行」；只留英文 deny-list＋`Status` 表头 |
| 🔴-5 | D12／SC-15／Plan 1b：Wave B **必接** `lucy-ci.yml`；§8 白名单 Wave A／B 均可用 |
| 🔴-6 | SC-14 以 §8 为准（含 `package.json`、`lucy-ci.yml`、`test-layers-and-release-gates.md`） |

黄灯：🟡-1 伞级一句镜像；🟡-2 test-layers 入白名单／落点；🟡-3 九词表加阶段码列；🟡-4／5／6 与 nit grandfather 快照点已写入 Spec／Plan／建议书。


---

## 七、审阅时工作区状态（`git status --porcelain`）

```
 M docs/README.md
 M docs/plans/README.md
 M docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md
 M docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md
 M docs/plans/lucy-20261118-mcp-upgrade-compatibility-plan.md
 M docs/plans/lucy-20261118-mcp-upgrade-question-bank-plan.md
 M docs/qa/uat/suites/mcp-upgrade-compatibility/suite.md
 M docs/runbooks/customer-v2-upgrade-release-checklist.md
 M docs/specs/lucy-20261118-mcp-upgrade-compatibility-spec.md
 M docs/specs/lucy-20261118-mcp-upgrade-question-bank-spec.md
 M scripts/e2e/adapters/claude-code.mjs
 M scripts/e2e/adapters/codex.mjs
 M scripts/e2e/adapters/cursor-cli.mjs
 M scripts/e2e/adapters/openclaw.mjs
 M scripts/gates/customer-release-readiness.mjs
 M scripts/gates/customer-release-readiness.test.mjs
 M scripts/gates/k8s-acceptance.sh
 M scripts/gates/k8s-upgrade-gate.sh
 M scripts/gates/root-test-registry.json
 M scripts/upgrade/upgrade-lucy.sh
?? docs/plans/lucy-20261122-spec-status-funnel-gate-plan.md
?? docs/plans/lucy-20261122-spec-status-vocabulary-chinese-plan.md
?? docs/qa/mcp-compat-clients.yaml
?? docs/qa/uat/suites/mcp-upgrade-compatibility/runs/
?? docs/reviews/2026-11-22-p1-73-status-governance-umbrella-review.md
?? docs/specs/lucy-20261122-spec-status-funnel-gate-spec.md
?? scripts/e2e/__tests__/mcp-agent-journeys.test.mjs
?? scripts/e2e/__tests__/mcp-compat-config-profile.test.mjs
?? scripts/e2e/__tests__/mcp-compatibility-evidence.test.mjs
?? scripts/e2e/__tests__/mcp-compatibility-wiring.test.mjs
?? scripts/e2e/__tests__/mcp-compatibility.test.mjs
?? scripts/e2e/__tests__/mcp-upgrade-journeys-schema-smoke.test.mjs
?? scripts/e2e/__tests__/mcp-upgrade-question-bank.test.mjs
?? scripts/e2e/__tests__/run-mcp-compatibility.test.mjs
?? scripts/e2e/adapters/kimi-code.mjs
?? scripts/e2e/contracts/mcp-compat-config-profile.yaml
?? scripts/e2e/contracts/mcp-upgrade-journeys.yaml
?? scripts/e2e/lib/mcp-agent-journeys.mjs
?? scripts/e2e/lib/mcp-compat-config-profile.mjs
?? scripts/e2e/lib/mcp-compatibility-client.mjs
?? scripts/e2e/lib/mcp-compatibility-evidence.mjs
?? scripts/e2e/lib/mcp-compatibility-wiring.mjs
?? scripts/e2e/lib/mcp-compatibility.mjs
?? scripts/e2e/lib/mcp-upgrade-question-bank.mjs
?? scripts/e2e/mcp-compatibility-hook.mjs
?? scripts/e2e/mcp-compatibility-hook.sh
?? scripts/e2e/run-mcp-compatibility.mjs
```
