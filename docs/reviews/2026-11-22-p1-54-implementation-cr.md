# P1-54 实现 Code Review（S5 严口径收口）

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-54 实现 Code Review（T-CLOSE Track F） |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Claude（Builder／Track F） |
| 委托人 | xingchen |
| 基于材料 | [P1-54 Spec v1.1](../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md)；[S5 严口径 Plan](../plans/lucy-20261122-p154-s5-strict-no-new-deny-multi-agent-plan.md)；[严口径复跑报告](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p154-s5-strict-rerun.md)；[SC 证据审计](2026-11-22-p1-54-sc-evidence-audit.md)；工作树 diff：`scripts/e2e/contracts/mcp-upgrade-journeys.yaml`、`mcp-compat-config-profile.yaml`、`scripts/e2e/lib/mcp-upgrade-question-bank.mjs`、`scripts/e2e/run-mcp-compatibility.mjs`、`scripts/e2e/__tests__/{mcp-compat-budget-escape,mcp-compat-config-profile,mcp-upgrade-journeys-schema-smoke,mcp-upgrade-question-bank}.test.mjs`；`inbox/p154-s5-strict-20261122/` 各 Track 笔记与 `rerun/bootstrap-*` |
| 适用范围 | P1-54 功能合同收口的实现层评审；**≠ 终稿确权；≠ UAT PASS；≠ 可上线**；不覆盖 P1-53 判定器全量 CR |
| 输出位置 | `docs/reviews/2026-11-22-p1-54-implementation-cr.md` |

## 1. 结论

**PASS**（无阻断项；3 条非阻断建议见 §5）。

- 严口径硬门禁已由复跑取证：零 `new deny`、零 `expected denial becoming allow`、34／34 PASS、三轴 PASS；allow 案全部真 `allow`。
- 本批所有改动均落在 Plan §3.1 白名单内；无删题、无放宽 oracle／120s／D12 阈值、无改 `webui/server` 产品行为、无改放行语义。
- 评审时复跑相关 `node --test`：九文件合计 **124 pass／0 fail／0 todo**（含 BUG-J2 用例已由 `todo` 转为实绿）；`mcp-agent-journeys.test.mjs` 12 pass。

## 2. 改动清单（工作树；`git diff --stat -- scripts`）

| 文件 | 改动规模 | 性质 |
|---|---|---|
| `scripts/e2e/contracts/mcp-upgrade-journeys.yaml` | 68 行（+/−）| 题库内容：JOIN-01 v2、ACL-03a v2、ACL-03b-gate v2；`requiredConfigFingerprint` 更新 |
| `scripts/e2e/contracts/mcp-compat-config-profile.yaml` | 10 行 | O1 冻结注释；`compat_fixture_row_policy_unproven_gate` 的 `purpose／note` 改义 |
| `scripts/e2e/lib/mcp-upgrade-question-bank.mjs` | 33 行 | `validateQuestionBankContract` 的 03b 校验由「必须 unproven 拒绝」改为「必须 scoped 行隔离成交」 |
| `scripts/e2e/run-mcp-compatibility.mjs` | 24 行 | J2：`buildEvidenceCases` 按 `caseId` 分组、worst-identity 取状态、无功能行＝`NOT_RUN` |
| `scripts/e2e/__tests__/mcp-compat-budget-escape.test.mjs` | +103 | J1 回归 4 条＋BUG-J2 用例实绿 |
| `scripts/e2e/__tests__/mcp-compat-config-profile.test.mjs` | +39 | O1 冻结＋W1／W2 工具集契约测 |
| `scripts/e2e/__tests__/mcp-upgrade-journeys-schema-smoke.test.mjs` | 8 行 | 03b 断言改为 scoped 行隔离成交 |
| `scripts/e2e/__tests__/mcp-upgrade-question-bank.test.mjs` | 19 行 | 03b 负控改为「回退为 unproven 拒绝＝FAIL」 |

合计 8 个运行／契约文件，239 行新增、65 行删除（`git diff --stat -- scripts`）。未触 `mcp-compatibility.mjs`／`mcp-compatibility-client.mjs`（判定内核，T-JUDGE 审计后无需改）、`webui/`、KTX、总账／INDEX／e2e-ledger。

## 3. 逐面评审

### 3.1 题库 journeys（QB-ACL-03b-gate v2、JOIN-01 v2、ACL-03a v2）— PASS

- **03b-gate v2**：`identities[0]`＝`row_scoped_deal`，`expect.outcome=allow`、`rowIsolationSuccess:true`、`regionScope:[East,Southwest]`、`notUnprovenDeny:true`；`oracle.kind=exact`，`total_sales=793317.0197`；`budgetClass` 由 `denial` 改 `simple-metric`；`singleProtectedSource: superstore_orders`、词表保持英文。与 Spec v1.1 §4.3／D22／SC-08 逐字对齐。
- **合法性依据**：P1-72 已取消 `row_policy_upstream_unproven` 拒绝路径（`t-bank-n3-product.md`；`webui/docs/00-product-terminology-standard.md` 将该码标为历史拒绝码）。恢复 deny 等于回退 P1-72，会把合法行策略用户的主路径变成不可用——违反仓库第一性原理「主路径可用性优先」。因此选项 2 是正确方向；委托人明示裁定，非静默改 expect。
- **洗绿自检**：改动是**换了被验证的产品事实**（行隔离成交仍可用），并同时保留「约束生效」一侧（行收窄后 region 只含 East／Southwest，oracle 含 `regionScope`＋gold）。`version` 升至 2，`requiredConfigFingerprint` 随 profile 重冻（D18）。未删题、分母不变（34）。
- **JOIN-01 v2**：returns 因 chasm／无预定义 measure 无法经 join 触达 region，原题面在控制面注定非预算性失败；v2 收窄为已声明 orders↔people join，oracle 同步为 `sql:…orders_people_by_region`。收窄理由写在 yaml 注释；退货量仍由 ACL-03a 等单表题覆盖。**符合** Plan T-BANK Step 5「须有非预算证据才改」——本题由 T-ENV 冒烟定位为形状问题后才改（`01-merge-ready.md` 记「JOIN-01／ACL-03a 控制面形状修正（v2）」）。
- **ACL-03a v2**：returns 无预定义 measure，改用 ad-hoc `count(superstore_returns.id)` 触发表级拒绝，AB 对照同形；拒绝仍由表级 ACL 产生，非预算停机。

### 3.2 CompatConfigProfile — PASS

- O1 冻结：双连接夹具工具集＝7 个（`connection_list, lucy_begin_question, lucy_catalog, lucy_explain_query, lucy_freshness, lucy_query, lucy_read_source`），无 `wiki_*`、无 `lucy_admin`、无 `connections:["*"]`；契约测「O1 frozen …」「W1/W2/W1W2 fixtures use the O1 tool set …」锁定。
- 冻结注释不入指纹；`purpose／note` 改义属于**解析后字段**变化，已反映在新指纹 `sha256:957326482275…8733053`（journeys 同值；`schema-smoke`「requiredConfigFingerprint matches …」守一致）。
- `compat_fixture_row_policy_unproven_gate` 角色 id 与新语义不一致，已用注释说明「id 保留以保指纹连续」——可接受，见 §5 C-3。
- frozen W0 永久负例仍不是 `lucy_ops_reader`（契约测守护）。

### 3.3 `mcp-upgrade-question-bank.mjs` 契约校验 — PASS

- 03b 校验由 4 条互斥断言组成：必须 `allow`／不得 `oracle.kind=deny`；须 `rowIsolationSuccess`；不得带 `row_policy_upstream_unproven`；不得 `notRowIsolationDeal／notRowIsolationSuccess` 为真。负控测试把 03b 改回 unproven 拒绝，期望校验器 FAIL（`mcp-upgrade-question-bank.test.mjs`），方向正确、能抓回退。
- 轻微重复：4 处使用同一条 problem 文案（不影响正确性，见 §5 C-2）。

### 3.4 判定／runner：J1 与 J2 修复 — PASS

- **J1（归因）**：T-JUDGE 回放确认当前内核（P1-74 `classifyAttemptReason`＋`judgeFunctional`）已把预算停机标为 `budget_exhausted`，不再误报 `new deny`；本批只补 4 条回归测试，**判定内核零改动**。`begin` 的 `tool_is_error`／`begin_not_available` 不被误判为 ACL deny；expected-deny 身份仍记 `other`（真 ACL 证据），不会被预算假绿。
- **J2（案级 status 与功能轴一致）**：根因为 `functionalCaseFromControl` 产出 `id="${caseId}:${identityId}"`，而 `buildEvidenceCases` 以 suite `caseId` 取 map，永远 miss → 案级恒 `PASS`。修复（`run-mcp-compatibility.mjs`）：① 按 `caseId`（无则取 `id` 的 `:` 前缀）分组；② attempts 同样按 caseId 归并；③ 多 identity 案取最差（`FAIL` > 非 `PASS` > 首个）；④ 无功能行→`status: "NOT_RUN"`（fail-closed，原为静默 `PASS`）；⑤ 去掉对无尝试案的 `synthetic ok` 兜底。逻辑最小且 fail-closed，case 行现在带 `expectedOutcome／observedOutcome／observedRowCount` 等字段（复跑 candidate 已体现），使案级状态可作为 S5 证据。
- **放行阈值与发布接线未动**（D18／P1-54 Plan 授权边界）：`mcp-compatibility.mjs` 的 D11／D12／D16a 常量、`mcp-compatibility-wiring.mjs`、聚合器均无 diff。`mcp-compatibility-evidence.test.mjs`「NOT RUN case or top-level ⇒ FAIL」「deleted cases ⇒ FAIL」继续有效，与 J2 的 `NOT_RUN` 一致。

### 3.5 Bootstrap 笔记（环境层，非仓库运行代码）— PASS（带注意事项）

- `inbox/p154-s5-strict-20261122/rerun/bootstrap-compat-env.mjs`：一次性脚本——`docker cp` 取出 `access.yaml／ktx.yaml`→`applyCompatConfigProfile`→写回→`docker restart compose-lucy-1`→创建／复用 11 个 compat Agent 并签发 30d Token→写 `compat-tokens.env`。位于 `inbox/`（tmp 约定、`.gitignore:59`），**不入库、不属于交付代码**。
- 秘密卫生：`compat-tokens.env` 权限 0600；`bootstrap-report.json` 无明文 Token；candidate JSON 与复跑报告对 Bearer／`lucy_*` 令牌形状零匹配；admin 口令由环境变量传入、不落文件。符合 Plan 与仓库「不把密钥写入可追踪文件」。
- 运行证据：`bootstrap-report.json` `allInitOk`，11／11 MCP initialize＝200，指纹 `sha256:957326482275…8733053`。
- **注意**：复跑后 demo 容器上 12 个 fixture role 是否已还原未取证（`run.log`／`run2.log` 无还原记录；备份在 `rerun/profile-backup*`）。属 demo 环境整洁度，不影响 S5 功能合同；见 §5 C-1／SC 审计 N-2。

### 3.6 复跑取证与口径 — PASS

- 复跑配方符合 D4：`--agent-concurrency 3`、`--budget-escape`、agent＝`kimi-code-cli`（指纹 `client:kimi-code-cli|…|version:2.7.2`、`model:default`）。
- 本审计复核：candidate 对 `new deny|expected denial becoming allow` 零匹配；34 案全 `PASS`；deny 案观测 `deny`，allow 案观测 `allow`；`tool_is_error`（deny 案）为预期 deny 信封，`reasons` 中唯一一条 `isError observed in MCP attempts` 与此一致。
- 主路径可用性自检：严口径同时覆盖「约束生效」（7 个 deny 案成立）与「合法用户仍可用」（27 个 allow 案成交，含 scoped 行隔离成交）。

## 4. 与 Spec／Plan 的偏差

| 偏差 | 判定 |
|---|---|
| Spec §0.1／O4 历史文字仍提 proven 开关 | Spec v1.1 已写「O4 由 03b-gate v2 取代」，不构成偏差 |
| 复跑公开 JSON 未复现数值 gold 等值断言（SC 审计 N-1） | 不在 Plan D1 硬门禁内；不宣称数值已全真比对 |
| `compat_fixture_row_policy_unproven_gate` id 名与语义不一致 | 已注释说明；非阻断（C-3） |

无超白名单改动；无删题；无洗绿。

## 5. 非阻断建议（不影响 PASS）

| ID | 建议 |
|---|---|
| C-1 | 为 J2 增补两条单测：①多 identity 同案、仅第二个 identity 失败→案级 `FAIL`；②suite 含某案而 `functionalCases` 无对应行→案级 `NOT_RUN`。当前 BUG-J2 测试只覆盖单 identity 的 FAIL 路径，worst-wins 与 `NOT_RUN` 分支靠复跑间接证明。另：demo 夹具复跑后还原取证可顺带补一条 |
| C-2 | `validateQuestionBankContract` 对 03b 的 4 处同文案 problem 可合并或区分文案，便于定位；不改语义 |
| C-3 | 下次 profile 大改重冻指纹时，把 `compat_fixture_row_policy_unproven_gate` 改名为语义对应的 id（如 `compat_fixture_row_scoped_deal`），并同步 journeys／bootstrap；本批保持 id 以免无谓换指纹、重签 Token |

## 6. 验证命令与结果

| 命令 | 结果 |
|---|---|
| `node --test scripts/e2e/__tests__/{mcp-compat-budget-escape,mcp-compatibility,mcp-compat-config-profile,mcp-compatibility-evidence,mcp-compatibility-wiring,run-mcp-compatibility,mcp-upgrade-question-bank,mcp-upgrade-journeys-schema-smoke}.test.mjs` | tests 124／pass 124／fail 0／todo 0 |
| `node --test scripts/e2e/__tests__/mcp-agent-journeys.test.mjs` | tests 12／pass 12 |
| `rg "new deny\|expected denial becoming allow" inbox/p154-s5-strict-20261122/rerun/results/mcp-compatibility-candidate.json` | 无匹配 |
| `node scripts/uat/check-e2e-ledger.mjs` | PASSED: e2e ledger links |
| 严口径全真复跑（T-RUN）| candidate `PASS`；三轴 PASS；34／34；`batchWallClockMs=519929` |

## 7. 边界

CR PASS 只证明实现与契约测、严口径复跑证据一致，**≠ UAT PASS；≠ 可上线；≠ P1-53 发布取证收口**。本 CR 不写总账／INDEX／e2e-ledger；未执行 git commit。
