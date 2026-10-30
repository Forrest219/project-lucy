# Lucy v0.25 P0-1 / P0-4 上线前 UAT（L25-09 与对账只读）

日期：2026-10-28。分支 `lucy-v0.25`，HEAD `17fdaf0850e27dbb724cf932f9d51e9af5d72815`。核对对象为提交 `898aa2a1`（该提交是 HEAD 的祖先）。未改产品代码、规格、配置，未提交 git，未构建镜像，未删除 volume。未纳入工作区里尚未提交的 L25-16 文档。

词汇：`passed_automation` / `failed` / `blocked` / `not_run`。本报告不把任何 A／V 场景记为 UAT 通过。定向用例全绿不是验收。

## 结论

**退回，不能按当前代码放行 P0-1 正式完整导出或 P0-4 正式完整读取。**

`898aa2a1` 接上了「不可证明则失败关闭」，也撤掉了「预算终止 ⇒ `authorization=not_evaluated`」。它没有实现冻结合同要求的精确 as-of S 重建。归属就地改写使用当前账本水位作为 `ledger_seq`，并不另记一条更晚的账本事件；证明只在改写序号**大于** S 时判失败。序号等于 S 时 `proveExactAsOfS` 仍返回 `ok=true`，导出 CSV 与问询对账读的是改写后的当前列。同一 S 可以先导出旧归属、再导出新归属，正式结果都显示范围完整。这直接落在 A08、A10-ASOF、V09、V10 的冻结判定上。

F-01 的错误分母已经从生产覆盖端口拿掉，检查 1 固定为 `unknown`。独立到达证据没有建立。F-03 的预算覆盖原缺陷在派生函数和预算终止写路径上已撤掉；A05-AUTH、A06-ORDER 仍未执行。F-04 保持 `not_run`，不作为本轮新缺陷。

## 范围

| 项 | 内容 |
|---|---|
| 在范围内 | L25-09 审计运行时（P0-1）中与 F-01／F-02／F-03 对应的证明、导出失败关闭、归属改写日志、授权派生；L25-02／03 对账只读（P0-4）对上述证明的读取 |
| 依据 | 审计增量 Spec §13 A01–A12 与 §18.10–§18.11；2026-10-27 交叉审阅（结论为退回待修订）；对账展示 Spec V01–V12；实施计划 §11.6 |
| 不重开 | S01–S08、U1–U12。不降低 `combinedComplete` 三项 AND，不把列存在或 `seq <= S` 当成精确 as-of |
| 未做 | 全量 vitest、浏览器、real-e2e、Docker 重建、真实问询与 Token 对账的在线读取 |

阅读实现：`webui/server/proxy/audit-as-of-proof.ts` 的 `proveExactAsOfS`；`audit-export-v2.ts` 与 `audit-reconciliation-routes.ts` / `reconciliation.ts` 的调用；`audit-derivation.ts` 的 `deriveAuthorizationView`；`audit.ts` 中 `access_log_attribution_mutations` 的握手 attachment 与 association backfill 写路径；`mcp-proxy.ts` 预算终止分支的 `executionEvidence`。

## F-01 / F-02 / F-03 是否收口

| 发现 | 代码结论 | 说明 |
|---|---|---|
| F-01 独立入口证据 | **错误自证已撤，能力未收口** | `createProductionAuditCoveragePort` 只供给 `projection_catchup`。检查 1「入口接收覆盖」为 `unknown` / `coverage_source_not_available`，定向用例锁住了这一点。生产端口没有用 `received ∪ auth_failure_log` 声明 pass。独立到达计数或受控发送凭据仍然不存在，A01-INGRESS、A02-R、A12 无法成立。`admission.ts` 注释仍写「`auth_failure_log` 作为独立入口证据参与覆盖分母」，与端口行为不一致，注释本身不构成分母计算 |
| F-02 精确 as-of S | **未收口** | 正式模式在 `asOfProof.ok=false` 时导出抛 `integrity_or_relation_failed`，三个对账端点在 `mode=complete` 时返回 409 `RECONCILIATION_AS_OF_S_UNPROVABLE`，诊断载荷带 `diagnostic_incomplete` 与缺失集合。`present.has("ledger_seq")` 不再单独把 `scopeComplete` 设为真。这些是失败关闭，不是精确重建。见下方缺陷 UAT-20261028-01 |
| F-03 授权事实保真 | **原缺陷已从派生与预算写路径撤掉；验收未执行** | `deriveAuthorizationView` 不再把 `budgetStopped` 收成 `not_evaluated`；无显式凭据为 `unknown`；显式 `authorizationAllowed` 在预算终止时仍为 `allowed`。预算耗尽写在 ACL 放行之后，并写入 `authorizationAllowed: true` / `notExecuted: true`。A05-AUTH、A06-ORDER 未跑。残留见 UAT-20261028-02 |
| F-04 | **not_run** | 仍是验收子例，不是本轮新缺陷 |

§18.11 写「F-02／F-03 已落地实现」。以冻结的 A08／A10-ASOF 衡量，F-02 的落地声明不成立。F-03 的预算反推声明与当前派生代码一致，但不能写成验收通过。

## 命令与结果

Docker：`curl --max-time 3 http://127.0.0.1:55176/health` 返回 HTTP `000`（端口无响应）。按约定不启动构建。一笔问询的在线读取与 Token 对账记 `not_run`。

聚焦测试（未跑全量）：

```bash
cd webui
KTX_PROJECT_ROOT=$(mktemp -d) npx vitest run --maxWorkers=1 \
  server/__tests__/audit-v025-as-of-proof.test.ts \
  server/__tests__/audit-v025-coverage-authorization.test.ts \
  server/__tests__/audit-v025-attribution-journal.test.ts \
  server/__tests__/audit-v025-derivation.test.ts \
  server/__tests__/audit-reconciliation-routes.test.ts \
  server/__tests__/audit-trust/audit-trust-v2-export.test.ts \
  server/__tests__/audit-trust/audit-trust-v2-export-pack.test.ts \
  server/__tests__/reconciliation.test.ts \
  server/__tests__/reconciliation-csv.test.ts \
  server/__tests__/reconciliation-context.test.ts
```

本次 `KTX_PROJECT_ROOT=/var/folders/rk/k516h8td2qbdr20gtb2wq0cr0000gn/T/tmp.YphSqvqqxF`。

| 文件 | 用例 | 结果 |
|---|---|---|
| `audit-v025-as-of-proof.test.ts` | 13 | 通过 |
| `audit-v025-coverage-authorization.test.ts` | 7 | 通过 |
| `audit-v025-attribution-journal.test.ts` | 4 | 通过 |
| `audit-v025-derivation.test.ts` | 32 | 通过 |
| `audit-reconciliation-routes.test.ts` | 13 | 通过 |
| `audit-trust-v2-export.test.ts` | 14 | 通过 |
| `audit-trust-v2-export-pack.test.ts` | 12 | 通过 |
| `reconciliation.test.ts` | 22 | 通过 |
| `reconciliation-csv.test.ts` | 14 | 通过 |
| `reconciliation-context.test.ts` | 12 | 通过 |
| **合计** | **10 文件 / 143** | **通过 143，失败 0** |

这些用例把「日志表缺失、基线缺失、`S < 基线`、改写序号严格大于 S、来源序号严格大于 S」判为不可证明，并把预算终止的授权断言为 `unknown` 或显式 `allowed`。没有任何用例在捕获 S 之后改写归属，再断言同 S 的正式导出字节不变。对账路由用例也没有断言 409 `RECONCILIATION_AS_OF_S_UNPROVABLE`。因此全绿只说明现有夹具下的守卫成立。

未复跑：失败不像并行 inbox 碰撞，无需单独再跑一次。

## A 与 V 矩阵

场景本身都没有按 §13／对账 Spec §7 执行。定向单元测试不升格为 `passed_automation`。

| ID | 本轮 | 理由 |
|---|---|---|
| A01 | not_run | 未做屏障间强杀、账本恢复与重复重启 |
| A01-INGRESS | not_run | 无独立到达凭据，无法断言 missing_ids；检查 1 的 unknown 守卫不是该子例 |
| A02 / A02-R / A02-C / A02-D / A02-T / A02-F | not_run | 未注入各屏障与 ACK／失败闭包失败。A02-C/D/T/F 属于 F-04 |
| A03 / A03-ACK | not_run | 未做同 ID 重投与重启补闭包。A03-ACK 属于 F-04 |
| A04 | not_run | 未做执行成功而发送丢失、上游已执行而回包未达 |
| A05 | not_run | 未用真实响应覆盖 HTTP 200+isError、-32602、explicit_table_required、上游错误 |
| A05-AUTH | not_run | 派生函数有预算／授权夹具；未构造两种闸序的调用流水。属 F-04 所列子例，本轮不新开缺陷 |
| A06 | not_run | 未在运行时走通八桶、竞争凭据与预算四维连续 |
| A06-BR / A06-BW / A06-ORDER | not_run | 未注入预算读写失败，未实跑两种先后顺序。属 F-04 |
| A07 | not_run | 未做 ID 复用与父子 attempt |
| A08 | not_run | 代码不能按 S 重建 `effective_*`／当前归属；场景未执行。相关缺陷见 UAT-20261028-01 |
| A09 | not_run | 未做参数／结果冲突与截断边界 |
| A10 | not_run | 未做投影暂停、并发写入与多页同 S 复算 |
| A10-ASOF | not_run | 场景未执行。静态路径已能说明同 S 会漂移或从成功变成失败，见 UAT-20261028-01 |
| A11 | not_run | 未做删改文件与版本链 |
| A12 | not_run | 未回放 177／192／175 与提示能力样本；缺独立入口时检查 1 保持 unknown 与条文一致，但不构成回放通过 |
| V01–V08 | not_run | Docker 健康检查非 200，未做问询详情、表身份、预算展示与 Token 对账的在线读取 |
| V09 | not_run | 未对同一筛选与 S 比较 API／CSV；正式阻断有代码路径，路由测试未锁 409 as-of |
| V10 | not_run | 未在导出期间写入 S 后事实并同 S 重读 |
| V11 | not_run | 未做撤权、脱敏与 meta-audit 的在线旅程 |
| V12 | blocked | 需要候选 linux/amd64 单副本 K8s 证据；本轮无该环境，缺环境不记通过 |

Stage 2（客户 K8s 重跑 A01／A02／A04／A10／A11）同样是 `blocked`，不并进上表的 Stage 1 行，避免把「开发机未跑」写成「交付环境已阻断全部 A」。

## 缺陷

### UAT-20261028-01　implementation_bug　高　F-02

精确 as-of 没有重建，同水位改写会让正式范围显示完整。

- 握手 attachment（`bindPriorSessionCalls`）与 association backfill 都在事务内 `UPDATE access_log`，并把 `resolveLedgerSeq()` 的**当前已提交上界**写入 `access_log_attribution_mutations.ledger_seq`。该调用不追加新的账本事件。改写发生后，水位可以仍等于捕获 S 时的水位。
- `proveExactAsOfS` 仅当 `mutation.ledger_seq > S` 时把修订维度判失败。等于 S 时修订维度仍可 `ok`。基础事实维度只检查行的 `ledger_seq` 是否为空、是否大于 S，原因码写 `fact_columns_immutable_and_rows_positioned`。模块注释指向的 `audit-as-of-drift.test.ts` 在仓库中不存在。
- 导出列含 `association_status`、`effective_turn_id`。问询单元的 `turnId` 取 `effective_turn_id`，缺省再取 `lucy_turn_id`。握手改写的是 `lucy_turn_id`。backfill 改写的是 `association_status`。两条路径的前像留在日志里，读路径和 CSV 都不回放前像。
- 因此：第一次在 S 上正式导出可以得到旧归属且 `scopeComplete=true`；同水位改写后再次正式导出得到新归属且证明仍为真。这违反 A10「同一截止位置与同一筛选得到同一事件内容」以及 A08「不能用当前有效值或 seq 过滤代替按 S 重建」。
- 改写序号严格大于 S 时，证明改为失败，正式导出抛错，对账正式模式 409。已经成功过的同一 S 变成失败，同样不是「同 S 重读不漂移」。证据包里的来源 CSV 已用 `ledger_seq <= S` 排除晚到的来源行，证明却把这些行记为 `source_after_bound` 并否决整个范围。排除与证明不一致。
- `audit-reconcile.ts` 里 `resolveLedgerSeq` 的注释仍写「保守上界即安全」以及「精确 as-of 仍需账本历史（N18）」。2026-10-27 已撤回「保守上界即安全」。注释与 §18.11 的「已落地」同时存在，以冻结条文为准：能力未闭合。
- 完成边界里的「`S < 基线` 不可证明」是另一件事，本条不把它算成新缺陷，也不把 D-28 记为关闭。

### UAT-20261028-02　implementation_bug　低　F-03 残留

非预算行的授权仍可由旧 outcome 推出。

- `classifyAuditEvent` 在没有 `executionEvidence.authorizationAllowed` 时，若 legacy 分类对 `outcome=ok/succeeded` 给出 `allowed`，就把 `authorizationAllowed` 设为真。
- 全仓库生产写路径里，`executionEvidence` 只出现在预算耗尽那一处。其余行的授权轴来自 outcome 启发式。`outcome=ok` 不是 Lucy 裁决时刻的授权凭据。
- 预算终止原缺陷（反推 `not_evaluated`、覆盖已发生的 allowed）在派生函数和该写路径上已经撤掉，本条不否定那一处修复。它说明 §18.11「只接受显式裁决凭据」还没有覆盖全部写路径。不新开授权功能；修复应停在现有三取值规则内。

### 不记为新缺陷

- F-04 的 ACK 闭包、同 ID 重投、预算读写失败子例：`not_run`。
- 写路径不提供 `executionEvidence.verifiedSuccess/verifiedFailure`，生产主状态因此落在 `unknown`，`succeeded`／`failed` 两桶不会从该写路径出现。§18.11 已登记，且明确超出本轮 F-01～F-03 的修复授权。本报告不把它升级成新需求。
- `scrubAccessLogArgsSummaries` 会就地改 `args_summary`，且不进归属日志。该列不在 v2 导出列集里。它说明「事实列不可变」这句注释不成立，但不单独再开一条缺陷；归入 UAT-20261028-01 的证据不足。

## 规格漂移

状态行与 §18.11 不一致。漂移不等于把实现说成已经验收，也不授权改写 A／V 状态。

| 位置 | 仍写着 | §18.11 / §11.6 写着 |
|---|---|---|
| 审计增量 Spec 文首状态（约 L10）、§18.8、§18.10 表内「当前实现」列 | 精确 as-of 未闭合；正式导出必须阻断；`deriveAuthorizationView` 的 budgetStopped 默认 `not_evaluated` 仍待修 | F-02／F-03 已落地；F-01 复核为检查 1 unknown |
| 实施计划 B25、D6 | as-of 视图未完成，仍须 `deriveAsOfSView`；列存在不是证明 | §11.6 与文首写 F-02 代码已落地 |
| 对账 Spec 文首状态（约 L8） | 上游精确 as-of 未闭合 | §3.5 写阻断接线已随 `898aa2a1` 落地，V09／V10 仍未执行 |

以代码为准：失败关闭接线与 §18.11 的阻断描述相符；精确重建与 B25／文首「未闭合」相符。§18.11 把「证明函数存在且失败关闭」写成「精确 as-of 已落地」，超出代码实际能力。这是 spec_drift，不是新的验收条款。

## blocked / not_run

- **not_run**：A01–A12 及全部点名子例；V01–V11；F-04 全部子例；Docker 上的一笔问询读取与 Token 对账；U9 两阶段里的开发机阶段（本轮未跑）。
- **blocked**：V12；U9 的客户 linux/amd64 单副本阶段（A01／A02／A04／A10／A11 的 Stage 2）。本轮没有该环境。
- **failed**：无。没有红灯用例。UAT-20261028-01 来自代码路径核对，现有夹具没有覆盖该路径，所以不是测试失败。
- **passed_automation**：无。143 个通过用例不映射到上表任何一行。

## 一轮修复建议（不扩大冻结合同）

只修已有条文里已经要求、而 `898aa2a1` 没有做到的部分。不新增审计能力，不改 U1–U12，不把 A／V 改成通过，不补独立入口计数器（F-01 在证据源出现之前保持 unknown 就是当前冻结要求）。

1. 归属与关联的 as-of 读路径按日志前像重建 S 当时的有效值，再交给导出和对账。`proveExactAsOfS` 只有在重建结果与正式输出一致、且四个维度都有证据时才能 `ok=true`。改写的 `ledger_seq` 等于 S、或改写没有单独的更晚提交时，不得当成「该改写不晚于已捕获的 S」。
2. 来源行 `ledger_seq > S` 时从视图和证据包排除，并仍能对同一 S 给出与排除前那次正式结果相同的内容。存在可排除的晚到行本身不应把已经可证明的 S 改成 409。基线之前没有日志的历史改写继续不可证明（D-28 保持 open）。
3. 删掉或停止产出没有证据的 `fact_columns_immutable_and_rows_positioned`。就地 `UPDATE` 若影响导出列或对账字段，必须进同一条可按 S 回放的日志，否则该维度不可证明。
4. F-03 残留：没有显式裁决凭据时不要把 `outcome=ok` 收成 `authorization=allowed`；证据不足保持 `unknown`。预算终止分支已经写入的 `authorizationAllowed` 保持不变。

落地修复（2026-10-28，仍不记 A／V 通过）：`ledger_seq >= S` 的归属改写按前像回放后才允许证明通过；已排除的晚到源不再否决该 S；`classifyAuditEvent` 不再从 `outcome=ok` 推出 `allowed`。缺前像列的改写仍不可证明。A01–A12 与 V01–V12 保持未执行。
5. 文档只做对齐：文首、§18.8、§18.10 的「当前实现」列、B25、D6、对账 Spec 文首，改成与修复后的代码边界一致。在修复落地前，这些状态行应继续表达「精确 as-of 未闭合」，不要先改成已验收。A01–A12 与 V01–V12 的状态保持未执行。

修复之后需要新的同 S 重读用例（改写序号等于 S、以及严格大于 S 两种），断言正式导出字节与对账问询归属不变。该用例是 A10-ASOF 的准备，不是 A10-ASOF 通过。
