**结论：BLOCK**（只评文档；本轮未跑 UAT、未改仓内任何文件、未写 PASS）

---

## 仍成立的发现

| ID | 严重度 | 承继/新 | 位置 | 问题 | 为什么会让验收失真 | 建议改法 |
|---|---|---|---|---|---|---|
| R2-01 | BLOCK | 新 | `cases.md:124-130`（ROW-05 向量 3）；`mcp-proxy.ts:1537-1558`、`:4231-4236`（入参校验先于 ACL）；`acl.ts:3524-3531` | 期望「拒绝原因**就是** `row_policy_query_shape_forbidden`」只在 filter 项**同时**带 `field`+`op`+`value` 且额外带 `or` 键时才成立。自然 OR 树 `{or:[...]}` 先被 MCP 入参校验拦成 `invalid_arguments:lucy_query:filters_field_required`（无 `field`）／`filters_value_required`（有 field 无 value）；字符串 filter 是 `filters_string_forbidden_on_scoped`。三种自然写法都拿不到期望码 | 必做向量 3 在自然写法下必然红，且红因与行策略无关；套件又明文「不得改期望」→ 跑次要么误记产品 FAIL，要么卡死，整套不可 PASS | ①（推荐）写死写法：`filters:[{field:"<source>.<rowcol>",op:"eq",value:<u01 值>,or:[{field:"<source>.<rowcol>",op:"eq",value:<他人值>}]}]`；② 或期望改为「拒绝，码 ∈ {shape_forbidden, filters_field_required|filters_value_required|filters_op_unsupported}，跑次记实际码」，并加「入参校验先于行策略闸也是现行合同」 |
| R2-02 | SHOULD | 新 | `cases.md:66-77`；`fixtures.md:61-63` | 步骤 1 对照是「按行级列**分组**的每取值聚合」，步骤 2 受限查询只写「单表**聚合**」；期望「没有范围外取值」在标量聚合上无观测程序 | 「逐值一致」能兜大部分泄漏（数字会变），但「没有范围外取值」不可判；外行对所选度量贡献为 0 时连数字都不变 → 跑次只能空勾 | 两步统一形状：都按行级列分组；受限结果必须只含本人那一个分组、值与对照格逐值相等；「没有范围外取值」改写为「不得出现除本人取值以外的分组」 |
| R2-03 | SHOULD | 新 | `fixtures.md:13-14`、`:55-63`；`row-policy-catalog.ts:695-701`、`:712-720`；`superstore_orders.yaml:5-9`；`_schema/dataforai.yaml:64`；`docs/access-control/uat-ac-p1.md:23` | 套件没规定「行级列」必须同时：① 可被行策略编译闸绑定（manifest 物理列 ∪ 被证明的 overlay 列＝语义 source 的 `columns`）；② 可在语义层当维度分组（语义 source 声明的 columns）。demo 的 `superstore_orders`：manifest 34 个物理列（含 `region`），语义 source 只声明 `order_year` → 交集只有 `order_year`；历史 BY-01 用的 `region` 只满足 ① | 跑次最可能选 `region`（直觉＋历史背书），但它不是声明维度 → 「按该列分组」的对照可能无法用 `lucy_query` 表达 → 无关红；或跑次自造对照口径（fixtures 只禁受限查询自带行级列 filter，没禁对照查询带）＝R1 F4 同源漏洞 | fixtures 写死双重约束＋demo 已知候选 `order_year` 及取值清单；对照与受限查询同一分组维度；「对照查询不得自带行级列 filter」补进禁止条 |
| R2-04 | SHOULD | 承继 F2＋新（伪前提） | `fixtures.md:34-39`；`cases.md:44`、`:62`；`docker-compose.ac-p1-by01.yml`／`…-proven-off.yml`；`webui/server/index.ts:749` | ① Gate-On 无仓内产物：唯一置 true 的文件就是被禁的 by01 overlay，proven-off 只给 false；「只把该变量设为 true」没说用哪个文件 → 跑次须自造 overlay（路径/入仓/清理全无）或违反禁止条。② 禁止条理由不成立：by01 里是 `services.lucy.environment.KTX_VERSION:"0.16.0"`（运行期环境变量、非 build args、与默认同值），运行时读 `LUCY_BUNDLED_KTX_VERSION`，根本不读 `KTX_VERSION` → 「它还改 KTX_VERSION，版本被改掉就 BLOCKED」是伪前提 | 跑次要么卡在「没有 Gate-On 步骤」，要么按伪前提自我 BLOCKED，要么误用被禁 overlay，要么自造文件污染仓 | 给 Gate-On 写死命令＋产物（只含 proven 变量的 overlay，落点与清理写明）；禁止条改成「会带进与镜像不一致的 KTX_VERSION 环境变量，禁止整份使用」；引用 `docs/access-control/runbook-row-policy.md` 的「proven 置真检查单（仅 Gate C）」＋「默认不应置真」作前置 |
| R2-05 | SHOULD | 承继 F6 尾项 | `.cursor/rules/lucy-v030-feature-inventory.mdc:19` vs 总账 `:110`、`:398` | 规则 10 写「未齐 P0-1…P0-7 与 P0-B」，**漏 P0-A**；总账 §1 规则 7 是「P0 七项 + P0-A + P0-B」，§5 清单也含 P0-A | 面向 agent 的 .cursor 规则比总账松一档；P0-A 至今 PASS WITH GAP 且 GAP-UAT-P0-A-EXPOSURE 未关，两处对「齐没齐」口径不同 → 差集可被反向利用 | .cursor 规则 10 与总账 §1 规则 7 同句（含 P0-A），或直接写「总账 §5 清单全勾」 |
| R2-06 | SHOULD | 新 | `e2e-ledger.md:71`；`cases.md:158-159`；总账 `:234`；方向 §9 第 5 条 | 方向第 5 条要求「配错取值不能静默变成「没有数」」→ 需取值级存在性校验；该能力现行没有、无 Spec、**总账无承接行**（P1-2 只覆盖编译门禁与拒绝码统一且冻结），只有台账 GAP 一行 | 核心分母挂在一项无主能力上；比照 GAP-UAT-P0-A-EXPOSURE（有 P1-26）、GAP-UAT-P1-11-RUNTIME（有 P1-27），本缺口缺同款承接 | ① 总账补承接行＋开 Spec 占位（明写「未开发授权」）指向 GAP-UAT-P1-28-VALUE；② 或改 §9 第 5 条与 §5 勾选，把取值级校验降为已知缺口不计入本闸 |
| R2-07 | NIT | 新 | `cases.md:129`；`mcp-proxy.ts:3623-3630`、`:5110` | `scope_intersection_empty` 是**审计 `decision_reason`**，不是客户端拒绝码：上游照常执行并返回 0 行，客户端见正常成功响应 | 跑次按「拒绝码」去找它会找不到 → 可能记 FAIL；或把审计字段写成客户端码 | 改写为「结果必须是 0 行；审计 `decision_reason=scope_intersection_empty`（可选核）；不得写成客户端拒绝码」 |
| R2-08 | NIT | 新 | `cases.md:134-145`；`mcp-proxy.ts:1613-1617`；`acl.ts:3519-3521` | ROW-06 期望只写「两次都被拒绝」；步骤 2 未点名 source，而 `lucy_freshness`/`lucy_read_source` 缺 source 先被拒成 `invalid_arguments:...:source_required`；未包装工具闸的码是 `row_policy_requires_wrapped_tool` | ROW-06 可以在根本没触到未包装工具闸的情况下变绿（假绿） | 两步都写「点名表 A（connectionId＋sourceName）」；期望钉死 `row_policy_requires_wrapped_tool`，其他码记 FAIL |
| R2-09 | NIT | 新 | `cases.md:16`；`fixtures.md:55-59`；`question-type-caliber-binding/fixtures.md:21` | 未列出会**先行**拦截查询的现行闸：P0-1 口径绑定闸（`caliber_binding_violation`；demo 容器内 Wave B 绑定文件按该套件说明**不清理**）、P0-A 字段暴露闸（`field_not_exposed`） | 命中即得与行权限无关的红 → 误记成行权限缺陷（或把真缺陷当噪声放过） | cases.md 前置加一句：命中口径绑定／字段暴露拒绝 → 记 BLOCKED（环境/夹具）＋记实际码，不得记成行权限 FAIL，也不得据此改期望 |
| R2-10 | NIT | 承继 F15③＋新 | `suite.md:30`；`fixtures.md:53` | ① 「归 P1-2」缺 `REQ-030-013／016`；② 「用预览或 explain 记一笔」证明每人 FinalRows=scoped，但仓内唯一预览端点是**角色级** `POST /api/admin/roles/preview-row-policy`，本套件行收窄在 Agent constraints，角色级预览看不到 Agent FinalRows；能反映它的是 `lucy_explain_query` 的 `finalRowsNonTrue`／`forcedPredicateAst` | 跑次可能拿角色预览当证据 → 与被测层不同源 → 前提断言形同虚设 | 补 REQ 号；证据仪器写死为 `lucy_explain_query` 的 `finalRowsNonTrue=true`＋digests，角色级预览仅作参考 |

---

## 已确认闭合的 R1 编号

**F1、F3、F4、F5、F6（主体）、F7、F8、F9、F10、F11、F12、F13、F14、F16**（部分闭合：F2 → R2-04；F6 尾项 → R2-05；F15 ③ → R2-10）

---

## 新引入的问题（相对 R1）

1. **R2-01** — F7「放宽码」收成「钉死码」时没收窄到可达写法：向量 3 的码在自然 OR 树写法下不可达。
2. **R2-02** — F4 的修法没配套定义「范围外取值」的观测程序，对照与受限查询粒度不一致。
3. **R2-03** — 新加的「行级列」概念缺「可绑定 ∧ 可分组」双重约束，demo 里两集合只在 `order_year` 相交。
4. **R2-04②** — 新加的禁止条款建立在伪前提上（overlay 的 `KTX_VERSION` 是运行期环境变量、与默认同值、运行时也不读）。
5. **R2-05** — 把 P1-28 写进 .cursor 规则 10 时，把「P0 七项 + P0-A + P0-B」的 P0-A 丢了。
6. **R2-06** — 新写的 GAP-UAT-P1-28-VALUE 只有台账一行，无总账承接条目 → 核心分母挂在无主能力上。
7. **R2-07** — 新写的向量 2 把审计 `decision_reason` 当成客户端「拒绝码」。
8. **R2-08** — 新写的 ROW-06 未钉码、未点名 source。
9. **R2-09** — 新套件未把口径绑定／字段暴露两道现行闸纳入「非本套件闸」清单。

---

## 未证伪 / 未核

- 目录口径已闭合：只有 INDEX＝PASS 且财务来源跑次才关分母；PASS WITH GAP 不勾不关；单 source 档不得 PASS 也不得 PASS WITH GAP。
- `acl.ts:3508-3531` 闸序确认：unwrap 工具 → 形状 → proven → 多表 → forced_filters 空；ROW-01／ROW-04 期望码与闸序一致。拒绝码对客户端可见（`Access denied: <reason>`，入参错为 `Invalid arguments: <reason>`）。
- Agent 级 FinalRows 机制成立（`agent-constraints.ts:380-431` + `lookupFinalRows`），fixtures「个人收窄写在 Agent constraints.sources[]」方向正确。
- 未核：`lucy_query` 能否按**非声明**物理列（如 `region`）分组/过滤；`order_year` 全链路未实跑；demo 容器是否残留 Wave B 绑定文件（仅静态阅读）。
- 未做：未跑 UAT；未执行 `npm run lint:e2e-ledger`（脚本对 P1-28 `latestRun:""` 不误红）；未改仓内文件（报告落在 `~/.claude/plans/uat-pass-toasty-eagle.md`）。
