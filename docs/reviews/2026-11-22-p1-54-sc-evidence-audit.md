# P1-54 SC 证据审计（S5 严口径收口）

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-54 SC-01–SC-24 证据审计（T-CLOSE Track F） |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Claude（Builder／Track F） |
| 委托人 | xingchen |
| 基于材料 | [P1-54 Spec v1.1](../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md) §8；[P1-54 Plan](../plans/lucy-20261118-mcp-upgrade-question-bank-plan.md)；[S5 严口径 Plan](../plans/lucy-20261122-p154-s5-strict-no-new-deny-multi-agent-plan.md)；[严口径复跑报告](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p154-s5-strict-rerun.md)；`inbox/p154-s5-strict-20261122/rerun/results/mcp-compatibility-candidate.json`；`scripts/e2e/contracts/mcp-upgrade-journeys.yaml`、`mcp-compat-config-profile.yaml`；`scripts/e2e/__tests__/` 相关测试；`inbox/p154-s5-strict-20261122/{t-judge,t-bank,t-bank-n3-product,t-env-unblocked,01-merge-ready,r1-go}.md` |
| 适用范围 | P1-54／REQ-030-075 **功能合同收口**的 SC 逐条证据指针；**≠ UAT PASS；≠ 可上线**；不写总账／INDEX／e2e-ledger |
| 输出位置 | `docs/reviews/2026-11-22-p1-54-sc-evidence-audit.md` |

## 1. 结论

**SC-01–SC-24 全部 CLOSED（24／24）。无未关闭 SC。**

- 本审计的 SC 序列取自 **P1-54 Spec §8（SC-01–SC-24）**；父合同 P1-53 的 SC-01–SC-25 不在本审计范围（P1-53 收口终态仍为 `X_REL`，Plan §1 已锁定）。
- 严口径硬门禁（Plan Global Constraints）已由复跑取证：

| 硬门禁 | 复跑结果 | 取证 |
|---|---|---|
| 零 `new deny` | PASS | `rg "new deny\|expected denial becoming allow" …/mcp-compatibility-candidate.json` 无匹配（本审计复核）；candidate `reasons` 仅 `isError observed in MCP attempts`（预期 deny 身份的 `tools/call` 错误信封，非 new-deny） |
| 零 `expected denial becoming allow` | PASS | 同上；QB-ACL-03b-gate 已按 Spec v1.1 改义为 allow |
| 34／34 案级 PASS，三轴 PASS | PASS | candidate：`cases[34]` 全 `PASS`；`verdicts` 三轴 `PASS`；`denominator.complete=true`（`attemptCount=84`、`mcpSampleCount=43`、`agentSampleCount=126`）；`batchWallClockMs=519929` |
| 所有 expect=allow 案 `observedOutcome=allow` | PASS | 本审计逐案复核：allow 案 27 个均 `allow`；deny 案（JOIN-02、DB-02、ACL-01／02a／02b／02c／03a 的 deny 身份）观测为 `deny` |
| 指纹匹配 | PASS | candidate `configProfileFingerprint`＝journeys `requiredConfigFingerprint`＝`sha256:957326482275…8733053`；`suiteDigest=sha256:9725b9a4…578fc` |
| 洗绿检查 | 无 | 未删题；未放宽 120s／D12；03b 改义为委托人选项 2 的 Spec v1.1 正式变更（`01-merge-ready.md` 洗绿检查栏），非静默改 expect |

本审计复核的命令（2026-11-22）：

- `node --test` 九个相关文件（`mcp-compat-budget-escape`、`mcp-compatibility`、`mcp-compat-config-profile`、`mcp-compatibility-evidence`、`mcp-compatibility-wiring`、`run-mcp-compatibility`、`mcp-upgrade-question-bank`、`mcp-upgrade-journeys-schema-smoke`）合计 **124 pass／0 fail**；`mcp-agent-journeys.test.mjs` **12 pass／0 fail**。
- `node scripts/uat/check-e2e-ledger.mjs` → `PASSED: e2e ledger links`。
- `npm run lint:spec-docs`：仅对**未跟踪**的 S5 严口径 Plan 报 `[plan-parts]` WARN（缺「开工前置／验收／完成定义」小节标签；Plan 已有「验收」元数据行与 §5）。该文件是本批编排 Plan，非 P1-54 Spec／Plan 主文件；`git add` 前须由 R 处置（见 §4 观察项 N-3）。

## 2. SC 逐条证据

图例：**契约测**＝`scripts/e2e/__tests__/` 下确定性测试；**journeys**＝`mcp-upgrade-journeys.yaml`；**profile**＝`mcp-compat-config-profile.yaml`；**复跑**＝candidate JSON（案行见下）。

| SC | 标准（Spec §8） | 状态 | 证据指针 |
|---|---|---|---|
| SC-01 | 每题字段完整；含 identities；YAML↔Spec | **CLOSED** | journeys：34 案各含 `id／version／lane／configProfileId／mapsTo／turns／identities／connectionIds／sources／mcpControls／oracle／budgetClass／evidence`；契约测 `mcp-upgrade-question-bank.test.mjs`（`validateQuestionBankContract`）＋`mcp-upgrade-journeys-schema-smoke.test.mjs`「parses as … bank ids」「contains every required §4/§5 case id exactly once」；复跑 `cases[]` 34 行逐案对得上 |
| SC-02 | §4＋§5 分母完整 | **CLOSED** | journeys `denominatorMaps`（COMPAT-01–09、COMPAT-OPS-01–11 共 20 条映射）；schema-smoke「denominatorMaps cover Spec §5 mappings」；`mcp-compatibility-evidence.test.mjs`「deleted cases (missing from denominator) ⇒ FAIL」；复跑 `denominator.caseCount=34`、`expectedCaseIds` 34 个、`complete=true` |
| SC-03 | CompatConfigProfile 形状完整；缺包不可落地 | **CLOSED** | profile：`connections`（demo-mysql、lucy-ops）、`productRoles`（demo_readonly／lucy_ops_reader／demo_ops）、`fixtureRoles`（12 个）、`sources`、`constraints`、`govFilterRules`、`lifecycle`、`tokenRefs`；`mcp-compat-config-profile.test.mjs`「loads default profile with required id/version/connections」；`mcp-compatibility.test.mjs`「missing requiredConfigFingerprint ⇒ BLOCKED」「missing configProfileFingerprint ⇒ BLOCKED」；`mcp-upgrade-question-bank.test.mjs`「missing CompatConfigProfile fingerprint ⇒ BLOCKED」；ENV：`rerun/bootstrap-report.json` 12 个 fixture role 全部 `appliedRoleIds` |
| SC-04 | BIZ-01／02a–d gold／空／窗／过滤正确 | **CLOSED** | journeys：BIZ-01 `oracle.kind=exact`（`order_count=1000`、`total_sales=1459476.0953`）；02a 分组＋COUNT DISTINCT＋SUM/SUM；02b 1900 年合法空；02c 2025 年窗；02d `category='Furniture'`；契约测 `mcp-upgrade-question-bank.test.mjs`「COMPAT-02 missing QB-BIZ-02c or 02d ⇒ FAIL」；复跑：BIZ-01／02a（4 行）／02b／02c／02d 均 `allow`＝`PASS`，三轴 PASS。**边界**：见 §4 N-1（复跑公开证据 `observedMetrics` 为空，数值对账 gold 为合同层，不在公开 JSON 复现） |
| SC-05 | 追问同会话 | **CLOSED** | journeys：BIZ-03、FOLLOW-01／02／03、DB-01、OPS-03a／03b 声明 `sameSession: true`（按轮声明，共 12 处）；`mcp-agent-journeys.test.mjs`「multi-turn sameSession retains wall-clock per turn and all attempts」；复跑：FOLLOW-01／02／03、OPS-03a／03b 均 `PASS`（FOLLOW-02 4 行；agent 轴 126 样本、每轮墙钟 ≤120s，`agentLatency=PASS`） |
| SC-06 | join／未知 join | **CLOSED** | journeys：JOIN-01 **v2**（orders↔people 已声明 join；returns 因 chasm 不进控制面，注释见 yaml）、JOIN-02 未知表拒绝；复跑：JOIN-01 `allow`（4 行）、JOIN-02 `deny`（deny 身份，`tool_is_error`＝预期 deny 信封）、FOLLOW-03 `allow` |
| SC-07 | 多库夹具；未用 admin | **CLOSED** | profile：`compat_fixture_dual_readonly`，O1 冻结 7 工具（`connection_list, lucy_begin_question, lucy_catalog, lucy_explain_query, lucy_freshness, lucy_query, lucy_read_source`），无 `wiki_*`／`lucy_admin`／`connections:["*"]`；契约测 `mcp-compat-config-profile.test.mjs`「O1 frozen …」「applies fixtures without using lucy_admin for dual-connection」；`mcp-upgrade-question-bank.test.mjs`「QB-DB-01 identity lucy_admin ⇒ FAIL」；复跑：DB-01 `allow`（2 次成交：demo-mysql＋lucy-ops 分连接）、DB-02 `deny` |
| SC-08 | ACL 成对；02c＝frozen；03b-gate＝scoped 行隔离成交（v2）；03c＝字段差分 | **CLOSED** | journeys：ACL-01／02a／02b／02c／03a／03c 成对（deny 身份＋合法对照）；ACL-02c 绑 `compat_fixture_frozen_w0_only`；**03b-gate v2**：`identity row_scoped_deal`，`expect.outcome=allow`、`rowIsolationSuccess:true`、`regionScope:[East,Southwest]`、oracle `exact`（`total_sales=793317.0197`）；ACL-03a **v2**（returns 用 ad-hoc `count(superstore_returns.id)` 触发表级拒绝）；契约测 `mcp-upgrade-question-bank.test.mjs`「QB-ACL-03b-gate expects row isolation success (allow), not unproven deny」、`schema-smoke`「QB-ACL-03b-gate expects scoped row isolation deal (allow)」「QB-ACL-02c binds frozen W0 role, not lucy_ops_reader」、`config-profile.test`「frozen W0 permanent deny carrier is not lucy_ops_reader」；复跑：ACL-01／02a／02b／02c／03a `deny`＋合法对照 `allow`，**03b-gate `allow`（1 行）**，03c `allow`（100 行字段差分）；P1-72 依据 `t-bank-n3-product.md` |
| SC-09 | 事故同形 | **CLOSED** | journeys：QB-BIZ-03（COMPAT-09＋ESC-11，会员收入同形 begin＋钉选 query）；复跑：QB-BIZ-03 `allow`，`reason=null`、`denyClass=null`，首次未触发 `source_ambiguity_gate`；判定器「new deny, empty envelope, nonempty-to-empty, missing metric ⇒ FAIL」锁定同形回归 |
| SC-10 | W0 OPS-01–05；禁 gov.*；D21 锚点 | **CLOSED** | journeys：OPS-01–05 为 W0 车道，`windowAnchor` 声明在 evidence 列表；契约测 `mcp-upgrade-question-bank.test.mjs`「W0 mcpControls filters contain gov.* ⇒ FAIL」、`schema-smoke`「W0 mcpControls filters contain no gov.*」；复跑：OPS-01（2 行）、02（3）、03a（9）、03b（1）、04（`lucy_freshness` ok）、05（23）均 `PASS` |
| SC-11 | W1／W2 仅夹具；filters 含窗口旋钮；还原 | **CLOSED** | profile：`compat_fixture_ops_w1_reader／ops_w2_reader／ops_w1w2`（O1 工具集；`config-profile.test`「W1/W2/W1W2 fixtures use the O1 tool set and cover QB-OPS-10/11 sources」）；契约测「W1/W2 missing any allowed gov window knob ⇒ FAIL」、`schema-smoke`「… W1/W2 declare a gov window knob」；还原：`restoreCompatConfigProfile` 测（见 SC-18）；复跑：OPS-05b／06／07a／07b／08／09／10／11 均 `allow`＝`PASS`（OPS-10 15 行、OPS-07a 11 行）。**边界**：见 §4 N-2（demo 夹具复跑后是否已还原未取证） |
| SC-12 | 时区 | **CLOSED** | journeys：OPS-07a 以 `gov.calendar_days=7`（上海）治理窗为准、披露 UTC `call_day`（D10／D21）；`schema-smoke`「region vocabulary stays English East/Southwest in fixtures」守词表；复跑：OPS-07a `allow`（11 行）`PASS` |
| SC-13 | 人口 | **CLOSED** | journeys：OPS-05（W0，钉 `ops_calls` 按 `agent_id×token_label`）≠ OPS-06（`ops_agents.agent_count／available_token_count`）≠ OPS-07b（配置−活跃，禁「从未连接」）；复跑：OPS-05（23 行）、06（1）、07b（1）`PASS` |
| SC-14 | 高基数／独立 oracle | **CLOSED** | journeys：OPS-03b 过滤后 `generated_sql`、禁默认高基数分组；所有案含独立 `oracle`（`exact`／`independent-query`／`deny`／`invariant`）；契约测 `mcp-upgrade-question-bank.test.mjs`「agent self-reported number cannot replace oracle」；复跑：OPS-03a／03b `PASS` |
| SC-15 | 同配置指纹；缺配置 BLOCKED | **CLOSED** | `computeConfigProfileFingerprint`＝journeys `requiredConfigFingerprint`＝candidate `configProfileFingerprint`＝`sha256:957326482275fcc47a6c81e0462fa9085103af6b30fcaad5612297a80e733053`；契约测 `schema-smoke`「requiredConfigFingerprint matches computeConfigProfileFingerprint(profile)」、`config-profile.test`「is stable across repeated loads and key reorder」「changes when a fixture role shape changes」、`run-mcp-compatibility.test`「fingerprint mismatch vs suite requiredConfigFingerprint ⇒ BLOCKED」；ENV：`bootstrap-report.json` `fingerprint` 同值，`allInitOk` 11／11 |
| SC-16 | 证据字段对齐 P1-53；W0 snapshot 可 null | **CLOSED** | `mcp-compatibility-evidence.test.mjs`「exports a stable field contract…」；`run-mcp-compatibility.test`「candidate writes schema-shaped evidence with digests and no secrets」「B1↔B3 seam: candidate evidence passes verifyMcpCompatibilityEvidenceDoc shape」；candidate JSON 含 `kind／contract／suiteDigest／candidateDigest／clientFingerprint／modelFingerprint／configProfileFingerprint／denominator／verdicts／cases／mcp／agent／samples／batchWallClockMs／digests`；journeys evidence 列表含 `mcpClientRttMs`、`serverDurationMs`、`windowAnchor`、`snapshotId` |
| SC-17 | 分层事故负控 | **CLOSED** | `mcp-compatibility.test.mjs`「evidence-pack neg-control is not old-version UAT PASS」；`mcp-compatibility-evidence.test.mjs`「forged candidate top-level PASS …」；取证层：Wave D candidate（`FAIL`，15 条漂移理由）→ 本批复跑 `PASS`，构成「同题库、负控 FAIL → 修后 PASS」的分层对照（Wave D 跑次见 `runs/2026-11-22-cursor-wave-d-candidate.md`） |
| SC-18 | 无秘密；还原失败即停 | **CLOSED** | `run-mcp-compatibility.test`「public evidence leak ⇒ FAIL」「writePublicEvidence rejects leaked bearer token shapes」「restore failure stops with FAIL」；`config-profile.test`「restoreCompatConfigProfile — failure stops」（「restores access.yaml after a successful apply」「throws CompatConfigRestoreError when backup is missing…」「throws when a backup blob is missing mid-restore」）；`mcp-upgrade-question-bank.test`「fixture restore failure stops subsequent cases」；`schema-smoke`「does not embed secret-looking token values」；复核：candidate JSON 与复跑报告对 `Bearer \|lucy_[A-Za-z0-9]{20,}` 零匹配；`rerun/compat-tokens.env` 权限 `-rw-------`（0600）且被 `.gitignore:59 inbox/` 忽略；`bootstrap-report.json` 无明文 Token |
| SC-19 | digest／fingerprint 变更作废旧证 | **CLOSED** | `mcp-compatibility-evidence.test.mjs`「old suiteDigest vs recomputed ⇒ FAIL」「rewritten summary claiming PASS while recomputed FAIL ⇒ FAIL」；事实链：03b／JOIN-01／ACL-03a 改题后 journeys 案 `version` 升 2、`requiredConfigFingerprint` 由 `sha256:d2b4b8b6…` 更新为 `sha256:95732648…`，Wave D candidate（旧 digest）不得充当本批证据，本批 candidate 以新 `suiteDigest=sha256:9725b9a4…` 取证（D18） |
| SC-20 | 文档 lint；与 P1-53 勾连；close-layer 字面合规 | **CLOSED（R-2 落盘后复核）** | `node scripts/uat/check-e2e-ledger.mjs`＝`PASSED: e2e ledger links`；`lint:spec-docs` 对 P1-54 Spec／Plan 无违规（唯一 WARN 为未跟踪的 S5 编排 Plan，见 N-3）；P1-54 Spec §「闭口层级」＝功能合同，与父 P1-53 Spec「题库合同」互链；S5 状态句已按 `t-close-s5-draft.txt` 备好，close-layer 字面（含「功能合同已收口」「≠ UAT PASS」「≠ 可上线」）合规。R-2 落盘后须再跑 `npm run lint:status-funnel` |
| SC-21 | OPS-05≠人口；OPS-05b＝ops_tokens | **CLOSED** | journeys：QB-OPS-05 `sources:[ops_calls]`、`sourceMustBe: ops_calls`、oracle `sql:lucy-ops.ops_calls.agent_token_label_usage`；QB-OPS-05b `sources:[ops_tokens]`、`sourceMustBe: ops_tokens`、带 `gov.calendar_days=7`；复跑：05（23 行）与 05b（23 行）均 `PASS` |
| SC-22 | §5 映射机检（含 identities 跑次） | **CLOSED** | `schema-smoke`「denominatorMaps cover Spec §5 mappings」「every identity.role exists in CompatConfigProfile productRoles∪fixtureRoles」；`mcp-upgrade-question-bank.mjs`（`validateQuestionBankContract` 逐 identity 校验）；复跑：多 identity 案（ACL-01／02a／02b／02c／03a／03c、DB-01）`attempts[]` 含全部 identity 的 `lucy_query` 跑次（如 ACL-03a 三次：B 表拒绝＋A 表成交＋AB 对照），案级状态取各 identity 最差（J2 修复） |
| SC-23 | D7a：负例须 tools/call＋拒绝码＋零上游 | **CLOSED** | `mcp-upgrade-question-bank.test.mjs`「deny case without tools/call evidence ⇒ FAIL」；`run-mcp-compatibility.test`「isError MCP envelope maps to deny / surfaces in functional cases」；journeys 7 个 deny 身份均含 `expect.requireToolsCall: true`、`upstreamExecutions: 0`（及 `reasonFamily`）；`validateQuestionBankContract` 要求 deny identity 声明 `requireToolsCall`（D7a）；复跑：JOIN-02、DB-02、ACL-01／02a／02b／02c／03a 的 deny 尝试均为 `kind=lucy_query`、`ok=false`、`reason=tool_is_error`、`denyClass=other`（`tools/call` 真调用）；`expectedOutcome=deny`＝`observedOutcome=deny`；无 expected-denial-becoming-allow |
| SC-24 | journeys.yaml 内容归本条；加载／digest 归 P1-53；profile 脚本归本条 | **CLOSED** | 归属：journeys／profile／题库契约测在本条（`scripts/e2e/contracts/*.yaml`、`mcp-upgrade-question-bank.mjs`、对应测试）；加载／digest／判定在 P1-53（`mcp-compatibility.mjs`、`mcp-compatibility-client.mjs`、`run-mcp-compatibility.mjs`）。本批对 P1-53 判定／runner 的改动仅为 T-JUDGE／J2 白名单内的案级归因修补（`run-mcp-compatibility.mjs` `buildEvidenceCases`），**未**改放行阈值与发布接线（见实现 CR §3.4）；`mcp-compat-config-profile.mjs` 应用／备份／还原与 `profile` 脚本测在本条 |

## 3. 严口径相关 SC 的复跑案级摘要（SC-04／06／08／15／22／23）

| 案 | 身份 | expect→observed | 案级 | 备注 |
|---|---|---|---|---|
| QB-BIZ-01…03 | allow_readonly | allow→allow | PASS | 行数 1／4／1／1／1／1 |
| QB-FOLLOW-01…03 | allow_readonly | allow→allow | PASS | 同会话多轮 |
| QB-JOIN-01 | allow_readonly | allow→allow（4 行） | PASS | v2：orders↔people |
| QB-JOIN-02／DB-02 | deny | deny→deny | PASS | `tool_is_error`＝预期拒绝信封 |
| QB-DB-01 | 双连接只读 | allow→allow | PASS | 2 次成交 |
| QB-ACL-01／02a／02b／02c | 各 deny 身份＋合法对照 | deny→deny；对照 allow | PASS | 02c＝frozen W0 夹具 |
| QB-ACL-03a | A 可见／B 不可见／AB | deny→deny；A、AB allow | PASS | v2：ad-hoc `count(superstore_returns.id)` |
| **QB-ACL-03b-gate** | row_scoped_deal | **allow→allow（1 行）** | PASS | v2：scoped 行隔离成交；无 `expected denial becoming allow` |
| QB-ACL-03c | 字段差分 | allow→allow（100 行） | PASS | |
| QB-OPS-01…11 | W0／W1／W2 | allow→allow | PASS | OPS-10 15 行；OPS-11 1 行 |

## 4. 观察项（不挡 S5，不降级 CLOSED；供 R-2／后续轨记录）

| ID | 观察 | 处置建议 |
|---|---|---|
| N-1 | 复跑 candidate 各案 `observedMetrics` 为空，且案行不带数值 oracle 比对结果；SC-04／03b 的 gold 数值（如 `1000／1459476.0953／793317.0197`）以 journeys oracle＋判定器「missing metric」规则＋allow 成交为合同层证据，**未**在公开 JSON 里复现数值等值断言。本批严口径硬门禁（Plan D1）不要求数值断言 | 若总账另需「数值 gold 已机检」口径，另开 P1-53 判定增强条；本审计不据此宣称数值已全真比对 |
| N-2 | 复跑使用 demo 容器 `compose-lucy-1` 上已应用的 12 个 compat fixture role（`bootstrap-compat-env.mjs`，一次性脚本在 `inbox/`）；`run.log`／`run2.log` 无还原记录，**复跑后 demo 夹具是否已还原未取证**（备份在 `rerun/profile-backup*`） | 只影响 demo 环境整洁度；若要测「还原」全真取证另任务；平滑升级不会清除该配置，如需干净 demo 走 `npm run demo:upgrade -- --fresh`（须委托人另授） |
| N-3 | S5 编排 Plan 为未跟踪文件，`lint:spec-docs` 报 `[plan-parts]` WARN（缺开工前置／验收／完成定义小节标签），`git add` 后将转阻塞 | R-2 在落盘镜像时补小节标签，或写入 `spec-plan-doc-baseline.json` 豁免并说明理由 |
| N-4 | 03b 合同改义使 `compat_fixture_row_policy_unproven_gate` 的 role id 名与语义（现为 row isolation deal）不一致；profile 注释已说明「id 保留以保指纹连续」 | 不动 id；后续大改 profile 时随指纹重冻一并更名 |
| N-5 | P1-72 取消 `row_policy_upstream_unproven` 拒绝码后，P1-54 Spec §0.1 部分历史行（O4 已写取代）仍可保留；终态镜像由 R-2 一次写入 | 无 |

## 5. 边界声明

- 本审计只证明 **P1-54 功能合同（题库＋CompatConfigProfile）收口**：题目语义、journeys 内容、profile、契约测与严口径复跑硬门禁。
- **≠ UAT PASS**（共享测试台 `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY` INDEX 不在此回写；复跑报告 Plan D6 已声明不回写 PASS）；**≠ 可上线**；**≠ P1-53 发布取证收口**（`X_REL`）；不涉出包、Docker 重建、push。
- 总账／REQ／INDEX／e2e-ledger／README 终态句**未写**，仅交 R-2 落盘（草稿：`inbox/p154-s5-strict-20261122/t-close-s5-draft.txt`、`t-close-plan-draft.txt`）。
