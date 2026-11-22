# P1-73 开发台状态治理伞（漏斗 + 状态词）二审复核

| 元数据 | 内容 |
|---|---|
| 文档类型 | 批次评审报告（二轮复核） |
| 日期 / 审阅人 | 2026-11-22／MiniMax Code（主会话独立复核，未走 Codex） |
| 审阅对象 | 漏斗 Spec **v1.0**、漏斗 Plan **v1.0**、状态词建议书 **v1.0**（三份均已升版、阶段 S2、终稿已确权） |
| 对应一审 | [2026-11-22 伞审阅](2026-11-22-p1-73-status-governance-umbrella-review.md)（REQUEST CHANGES） |
| 总账 | P1-73／REQ-030-094 → 总账 **v2.17**、需求池 **v0.137** |
| 审阅方式 | 全文重读 + 仓库实测（lint 实现、CI 接线、基线豁免量、镜像逐字比对、真实语料回归） |
| 结论 | **第二轮 APPROVED（带 2 项 🟡 落地前处置建议）**。一审 6 项 blocker **全部闭合**，6 项 🟡 **全部闭合**，3 项 🟢 闭合 2 项。**本轮无 blocker**，可维持 v1.0／S2 终稿确权状态；2 项 🟡 建议在进入 S3（开发授权）前处置即可。 |

审阅对象（三份均为未提交新文件）：

- `docs/specs/lucy-20261122-spec-status-funnel-gate-spec.md`（v1.0，阶段 S2）
- `docs/plans/lucy-20261122-spec-status-funnel-gate-plan.md`（v1.0）
- `docs/plans/lucy-20261122-spec-status-vocabulary-chinese-plan.md`（v1.0，伞下 Wave A 子句）

镜像面：总账 `lucy-20261107-lucy-0-30-feature-inventory-pool.md:320`（总账 v2.17）、需求池 `lucy-20261102-lucy-0-30-0-requirement-pool-plan.md:70`（v0.137）、`docs/README.md:78`、`docs/plans/README.md:7` 与 `:42`

---

## 一、一审 blocker 逐条复核（6/6 已闭合）

| # | 一审 blocker | 二审证据 | 判定 |
|---|---|---|---|
| 🔴-1 | D3 整格匹配与自家头部 `**S1**` 冲突 | Spec `:9` 改为 `\| 阶段 \| S2 \|`（粗体已去）；D3 `:113` 补「单元格去掉空白与 `*` 后整格匹配 CODE」；§4.1 `:156`；SC-02 `:211` 同步 | ✅ 已闭合 |
| 🔴-2 | D5 字面禁令无否定语境，会误判 216 份现存文档 | D5 `:115` 拆为「（1）阶段格」／「（2）状态行」两条，并**显式允许** `≠ 可上线`／`≠ UAT PASS`／`≠ 功能合同收口`（注明 DEVELOPMENT 标准写法）；伪代码 `:195-198`；SC-05 `:214` 双向断言（阶段格含 `可上线` → 失败；状态行 `≠ 可上线` → 通过） | ✅ 已闭合 |
| 🔴-3 | D4 词表漏等价写法；`Wave 0` 语义站不住 | D4 `:114` 补入 `≠功能已收口`／`未收口`／`尚未收口`，**删除** `Wave 0`；写明「v1 用显式表；正面语义判定留 v1.1」；SC-03 `:212` 要求 `≠功能已收口` 须命中 | ✅ 已闭合 |
| 🔴-4 | 建议书 B2「状态行可解析」与「零基线新增／已知存量 1 处」互斥 | 建议书 §3.4 `:233` 新增「缺状态行」行＝**不归本规则**，交既有 `metadata`；实现顺序 `:236` 明确「找不到则**跳过本规则**」；§0.3 R1；漏斗侧三处同步（`:32` 不在本条出口、`:105` 非目标、`:147` 分工表） | ✅ 已闭合 |
| 🔴-5 | Wave B 漏斗门禁只进发版流水线 | D12 `:122` 由「可选」改为「**Wave B 必做**」；§2 目标 5 `:97`；§8 `:245` 白名单改为「Wave A 与 Wave B **均可用**」；新增 SC-15 `:224`；Plan 步骤 1b `:32` 明写「**同批**把含本规则的检查接入 `lucy-ci.yml`」；Plan 风险表 `:63` 新增「Wave B 只进发版流水线 → D12／SC-15」 | ✅ 已闭合 |
| 🔴-6 | SC-14 白名单与 §8 落地白名单互相矛盾 | SC-14 `:223` 改为「落地 diff ⊆ §8 白名单（含 package.json、lucy-ci.yml、test-layers 文档）」；`:254` 增「SC-14 路径检查 **以本节为准**」 | ✅ 已闭合 |

## 二、一审 🟡 逐条复核（6/6 已闭合）

| # | 一审建议 | 二审证据 | 判定 |
|---|---|---|---|
| 🟡-1 | 两份文档状态句不同却共用总账行作镜像 | 改为**伞级一句**：Spec `:10` 为伞级事实源；D7 `:117`「总账跟进状态＝伞级一句（本 Spec 状态行），不以子建议书另镜像」；新增 D17 `:127`（OQ-2＝A，总账进 lint＝v1.1）；建议书 §10 `:409-414` 重写（伞级事实源＝漏斗 Spec／本文件为伞级子句／镜像 2 只写伞 Spec 那一句）；建议书 §7 第 10 条 `:373`；Plan 完成定义 `:51` | ✅ 已闭合 |
| 🟡-2 | 落地白名单缺测试门禁文档 | 建议书 §3.1 新增第 ④ 落点 `:170`（`test-layers-and-release-gates.md` §2／§8）；漏斗 §8 `:248`、SC-13 `:222`、§2 目标 6 `:98`、§10 第 8 项 `:270` 四处同步 | ✅ 已闭合 |
| 🟡-3 | 九词表缺「阶段码」列，DEVELOPMENT 同章节出现两套口径 | 建议书 §3.3 `:205-217`：表头增「阶段码（软）」列，9 词逐行标码（S4 两行、X_DEF 两行），并注明「阶段码对照官方表见漏斗 Spec §3.1（S4／X_DEF 一对多；X_REL 无推荐原子）」；漏斗 §3.1 `:130` 标题同步标「一对多已标明」 | ✅ 已闭合 |
| 🟡-4 | §10 落盘清单自检跳过适用项 | Spec §10 `:262-280` 现覆盖 **1–18 全部**，并对 #8／#10／#12／#15／#18 逐条给出口径（#12 与 #18 明确写「不适用」而非留空） | ✅ 已闭合 |
| 🟡-5 | 「137 份 Spec」口径未写明 | 漏斗 §1 `:83` 改为「`docs/specs` 含状态行约 138／总数约 151（口径：含「状态」元数据行的 Spec，非整仓文件数）」；建议书 §1.2 `:101` 同步为「约 151（含状态行约 138；口径≠「全仓 Spec」）」，`:102` 补 `docs/plans` 约 233 | ✅ 已闭合 |
| 🟡-6 | 建议书自设事实源与 DEVELOPMENT 不同源 | 建议书 §10 `:409` 改为「伞级事实源＝漏斗 Spec 头部「状态」行（DEVELOPMENT：该功能 Spec 为唯一事实源）」；头部 `:8` 同步写明「伞级事实源＝漏斗 Spec；本文件状态**不构成**独立总账镜像」 | ✅ 已闭合 |

## 三、一审 🟢 复核（2/3 已闭合）

| # | 一审 nit | 二审证据 | 判定 |
|---|---|---|---|
| 🟢-1 | grandfather 名单快照点未写明 | D9 `:119`「落地提交**前**快照；落地提交内新建 Spec 不进名单」；Plan 步骤 2 `:33` 追加「本批次落地提交内不得另建新 Spec 逃检」 | ✅ 已闭合 |
| 🟢-2 | 阶段行建议统一不带粗体 | Spec `:9` 已去粗体；两个 Plan 的状态行亦去粗体 | ✅ 已闭合 |
| 🟢-3 | 两套验收编号缺合并勾销表 | Plan 步骤 6 `:37` 仍无「两套验收编号合并勾销表」；验收行 `:12`／`:46` 仍并列引用 SC-01–SC-15 与建议书 §6.2 | ⬜ 仍开放（🟢，不阻塞） |

---

## 四、本轮新发现

### 🟡-A　镜像现值句仍未逐字同句（仓库既有惯例是逐字相同）

**惯例校准（可复现）**：P1-61 的 5 处镜像全部逐字相同——

| 位置 | 内容（前 60 字） |
|---|---|
| Spec `docs/specs/lucy-20261119-memory-probe-diagnostics-isolation-spec.md:9` | `v0.1-draft。终稿已确权；开发授权已获得；2026-11-20授权修复…≠ 可上线。` |
| 总账 `…feature-inventory-pool.md:330` | 同上，逐字相同 |
| 需求池 `…requirement-pool-plan.md:63` | 同上，逐字相同 |
| `docs/README.md:52` | `P1-61／REQ-030-082；` + 同上 |
| `docs/plans/README.md:19` | `P1-61／REQ-030-082；` + 同上 |

即：**本仓库的既有实践是「镜像＝事实源状态行的逐字复制」**，只在索引行前加编号前缀。本批次一审的 6 变体已收敛为 3 种，但仍非逐字：

| 镜像 | 与 Spec `:10` 的差异 |
|---|---|
| Plan `:7` | 加 `阶段:` 前缀（**D7 要求的镜像前缀，合规且必需**）；但少「姊妹建议书为 Wave A 子句、不构成独立总账镜像」子句，且「伞级事实源＝本 Spec」→「＝配对 Spec」 |
| 总账 `:320` | 前导句一致 ✅；后半句换成总账自有细节（双规则／Wave A／Wave B／测试台），非 Spec 状态行的逐字复制 |
| 需求池 `:70` | 少「运行代码与」——写「未授权不改 lint」，其余四处为「未授权不改运行代码与 lint」 |
| `docs/README.md:78` | 少委托人括注，且**整段少「未授权不改运行代码与 lint」** |
| `docs/plans/README.md:7` | 建议书索引行；建议书 §10 `:411` 自称「镜像 1 须与本文件状态同句」，实际为缩写，未同句 |
| `docs/plans/README.md:42` | 漏斗 Plan 索引行；缩写 |

**判定**：🟡。状态实质（`S2｜v1.0`／终稿已确权／未获开发授权）在 7 处**完全一致且无相互矛盾**，缺的是细节子句——比一审的 6 变体是实质改善。但 DEVELOPMENT.md「状态登记只有一份现值」写的是「**同一句现值**」，且仓库先例是逐字相同。

**改法**：以 Spec `:10` 为基准，落地时（同一改动内）把总账格、需求池行、两个索引行拉到与事实源逐字一致；Plan 只保留 `阶段:` 前缀差异；建议书作为伞级子句，其索引行与本文件状态行逐字一致（不再缩写）；总账格可追加本行自有细节（双规则／Wave 序），但**前导现值句须逐字复制**。

### 🟡-B　D5(2)「紧邻」的判定位仍未定死（v1.0 是终稿，条文不宜留描述性表述）

- D5 `:115`（2）：「**状态行**不得把上述词当作阶段码（**紧邻** `阶段:`／码位冒充）」
- §5 伪代码 `:197` 只给了注释：`statusClaimsStageAlias(statusRow(text))  # 冒充；否定式 ≠可上线 等放行`

「紧邻」未给判定位（多近算紧邻？以 `阶段:` 后的连续 token 为界，还是行首 N 字符内？）。本条已是终稿，落地将由另一执行方实现，描述性表述会产出两套不同实现。

**改法**（一行可定）：D5(2) 改为「状态行中首个 `阶段:`／`阶段：` 之后的连续 token 命中 {`可上线`, `UAT PASS`, `测试台PASS`} → 失败；`≠`-前缀形式放行」。不必进 S3 之前，但应在实现前定死。

### 🟢-C　一审报告自身触发 `stale-status`（已就地修正）

`docs/reviews/*.md` 在 stale-status 扫描面内（`scripts/lint-spec-docs.mjs:535-539`）。一审报告 `:202` 引用 DEVELOPMENT 规则原文短语时未带作废标记，`npm run lint:spec-docs` 报 WARN（未跟踪态）；一旦 `git add` 即转为**阻塞项**（stale-status 不走基线豁免）。已就地补作废标记。

### 🟢-D　基线残留一条 STALE 条目（非本批次引入）

`npm run lint:spec-docs` 报 `docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md [metadata]` 已不再违规、可从基线移除。**一审时即存在**，非本批次引入；基线「只减不增」，建议清理时一并移除。

### 🟢-E　需求池头部引用总账版本号过期（非本批次引入）

需求池 `:12` 状态行写「跟进主表＝…（**v1.24**）」，而总账当前为 **v2.17**。`git diff` 显示该行为**上下文行**（本批次未改），属存量漂移，建议随手校正。

### 🟢-F　建议书 §2.1 的版本标签未随 v1.0 更新

建议书 `:129` 标题仍写「### 2.1 目标（**v0.2** 正式范围）」，但该节第 3 条已在 v1.0 改写（「本规则落地前清零本规则违规」＋「缺状态行不归本规则」）。§4.4（v0.2）／§4.5（v0.4）内容自 v0.2／v0.4 未变，标签仍准确。

---

## 五、事实核对台账（本轮实测）

| 断言 | 出处 | 实测 | 判定 |
|---|---|---|---|
| Spec 阶段行去粗体且为合法码 | Spec `:9` | `\| 阶段 \| S2 \|`；D3／§4.1 均含「去 `*` 后整格匹配」 | ✅ 一致 |
| Plan 侧不要求阶段行 | D3 `:113` | 仅 Spec 头部有 `\| 阶段 \|` 行，两份 Plan 无 | ✅ 一致 |
| D4 扩词对存量零误伤 | D4 `:114` | 384 份状态行中命中 `未收口`／`尚未收口` 的 7 份**全为**「本条功能合同尚未收口」类真未收口表述，无 S5 误伤面 | ✅ 通过 |
| 三份文档状态行零英文 deny-list 命中 | 建议书 §3.3 | `Implemented`／`Approved for planning`／`Superseded`／`Draft`／`Ready for Review` 全零命中 | ✅ 通过 |
| 三份文档形态合规 | 落盘清单 #10 | 实跑 `npm run lint:spec-docs`：三份新文件 **0 违规** | ✅ 通过 |
| 三份文档不含作废状态句 | Spec §10 第 12 项 | 三份文件均 0 处 | ✅ 通过 |
| Wave B 必接 PR CI | D12／SC-15／Plan 步骤 1b | 三处一致；§8 白名单已放行 `lucy-ci.yml` | ✅ 一致 |
| 缺状态行归 `metadata` | 建议书 §3.4／漏斗 `:32`／`:105`／`:147` | 四处一致 | ✅ 一致 |
| 建议书自设事实源问题 | 建议书 §10 `:409` | 已改为伞级事实源 | ✅ 已闭合 |
| 「全仓 137 份」 | 漏斗 §1 `:83` | 已改口径为「含状态行约 138／总数约 151」 | ✅ 已闭合 |
| 总账／需求池版本随批更新 | 总账 `:320`／v2.17；需求池 `:70`／v0.137 | 均已更新 | ✅ 通过 |
| 镜像逐字一致 | 本轮 🟡-A | 5 处前导句 3 种写法 | ⚠️ **未逐字**（🟡-A） |

---

## 六、复核命令

```bash
npm run lint:spec-docs                       # 三份新文件 0 违规；存量红灯仍来自 prepack-closure-multi-agent-plan
ls docs/specs/*.md | wc -l                  # 151（含状态行者 138）
ls docs/plans/*.md | wc -l                  # 233
grep -n "^| P1-61 " docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md   # 镜像惯例校准
grep -n "^| 状态 |" docs/specs/lucy-20261119-memory-probe-diagnostics-isolation-spec.md
```

**结论**：一审 REQUEST CHANGES 的 6 项 blocker 与 6 项 🟡 已全部闭合，本轮无 blocker。**维持 v1.0／S2 终稿确权**；🟡-A 与 🟡-B 建议在进入 S3（开发授权）前处置，🟢 项可随手清理。

**本报告不表示**：双规则已实现、lint／CI 已改动、开发已授权、任何功能已收口、≠ 可上线。本轮未改动任何被审文档，未运行任何写操作命令。


---

## 七、复核时工作区状态（`git status --porcelain`）

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
?? docs/reviews/2026-11-22-p1-73-status-governance-umbrella-recheck.md
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
