# Lucy v0.25 / L25-09 审计增量 — 功能合同收口

> 2026-11-02：A01–A12 与 U9 的 Stage 1、Stage 2 已拆出功能合同。本文件若把它们写成这条的未完成出口，改以 [出口拆分记录](2026-11-02-functional-contract-exit-split.md) 为准。`lint:spec-docs` 是过程记录，不在出口。S01–S07 的通过结论不变。

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01 |
| 授权 | 用户于 2026-11-01 指示推进 `lucy-v0.25`；本条为 L25-09 的**功能合同层**收口 |
| 对象 | [审计可靠性、准确性与链路追踪增量 Spec](../specs/lucy-20261020-v2p5-audit-increment-spec.md) v1.0-frozen，**S01–S07 功能合同层** |
| 前置 | [Spec 收口盘点](2026-11-01-spec-closure-inventory.md)（B 档：L25-09 补「闭口层级」小节）；[Codex 独立审阅](2026-10-27-codex-review-audit-increment-p0.md)；Spec §18.15 的两块工作包切分 |
| 结论 | **功能合同层收口。** S01–S07 的逐条落点见 Spec §18.16，闭口层级见 §18.17。**本条收口不表示可上线。** 运行时取证层（S08 ＋ A01–A12 ＋ U9 的 Stage 1／Stage 2）**未执行** |

## 出口

本条闭口层级（Spec §18.17「闭口层级」小节）声明的出口：

- S01–S07 的逐条自动化落点——逐条落点表见 Spec §18.16

`npm run lint:spec-docs` 是当时的过程记录，不在本条出口。

**不在本条出口**：运行时取证层（S08、A01–A12 及其全部命名子例、U9 的 Stage 1／Stage 2）；历史只读样本回放核对；浏览器层与移动窄屏；整库旅程与 Agent 产品客户端；真实进程强杀与「上游已执行但回包丢失 → `indeterminate`」分支；`received` 单点提交失败注入；关联头在 HTTP 出站的实际带出；`prevExportId` 版本链与来源声明的行为；客户 linux/amd64 单副本 Kubernetes；镜像构建、部署、客户环境与客户交付。

验收断言原文见主 Spec，本文件不重复抄写，只给结论、本轮补的动作与实测。

## 证据等级

本条的证据全部是**仓库内确定性检查**：纯函数与只读判定、真实 HTTP 层、真实 SQLite 层、进程内 MCP 自动化。**没有任何一条证据来自客户环境、容器编排、真实进程强杀或已部署拓扑。** 证据等级归发布取证层，尚未取得。

具体到最容易被误读的一条：`audit-release-barrier.test.ts` 与 `audit-projection-recovery.test.ts` 走的是**真实 HTTP 与真实磁盘 SQLite**，不是 mock 存储；但它们跑在 vitest 进程里，**不是**操作系统或容器的进程级重启。

## 本轮补的动作

按 `docs/governance/DEVELOPMENT.md` 的出口纪律——「真实实现缺口必须补用例，不能靠收窄出口措辞掩盖」——先做覆盖盘点，再补用例，最后才写闭口层级。盘点结论是：**S01–S07 的落点不是完整覆盖**。以下六处在收口前**没有任何行为断言**（第 5 条是实现已在、只有测试缺失）：

| # | 冻结合同 | 收口前状态 | 本轮补的用例 |
|---|---|---|---|
| 1 | §4.3(c) U11 预览与摘要边界（500 码点／512 字节／maxKeys=8／`preview_version`／脱敏存在性标记） | 零断言 | `audit-v025-contract-boundaries.test.ts`「§4.3(c) U11」14 条 |
| 2 | §4.3(e) reported／observed／inferred 三族分离 | 零断言 | 同上「§4.3(e)」3 条 |
| 3 | §4.3(b) U1 `delivery=acknowledged` 写路径的三重比对，且校验不通过时**不推导** `unacknowledged` | 零断言 | 同上「§4.3(b) U1」9 条 |
| 4 | §10.2 统一错误七分类 → Spec 162 四维映射 | 零断言 | 同上「§10.2 U8」12 条 |
| 5 | §9.3(b) 清单校验**重算**文件内容（改内容／删文件要能检出） | 实现已在（`verifyExportFiles` 确实重算 sha256），**只有测试缺失** | `audit-v025-export-seal-contract.test.ts`「§9.3(b)」4 条 |
| 6 | §4.3(a) 末段「API、UI、CSV、证据包调用同一版本分类函数」的漂移守卫 | 零断言 | 同上「§4.3(a) 末段」2 条 |

第 6 条同时补上了 §9.3(c) 跨文件关联校验 3 条。

**新增 47 条用例（38 + 9），全部通过。**

补用例时改了一处断言口径，过程记录在此：`audit-v025-contract-boundaries.test.ts` 最初断言「被脱敏的键保留存在性标记」时写成 `summary.sql === "select 1"`，失败。原因是 `audit-privacy.ts` 的 `SENSITIVE_ARG_KEY_RE` 同时匹配 `sql` 与 `query`——原始 SQL 不进热审计存储，但「该参数存在」这一事实保留，值是 `[REDACTED]`。断言改为 `summary.sql === REDACTED_VALUE_MARKER`，并用 `source: "orders"` 作为存活键。**运行代码一行未改。**

## 本轮改动的文件

| 文件 | 改动 |
|---|---|
| `webui/server/__tests__/audit-v025-contract-boundaries.test.ts` | 新增，38 条 |
| `webui/server/__tests__/audit-v025-export-seal-contract.test.ts` | 新增，9 条 |
| `docs/specs/lucy-20261020-v2p5-audit-increment-spec.md` | 新增 §18.16 逐条落点表与 §18.17 闭口层级；状态行改指本轮 |
| `docs/reviews/2026-11-01-l25-09-functional-contract-closure.md` | 新增（本文件）——收口记录 |
| `docs/governance/spec-plan-doc-baseline.json` | 删除本 Spec 的 `close-layer` 豁免（900 → 899）——本 Spec 现在自己满足该规则 |
| `docs/README.md`、`docs/plans/README.md`、`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`、`docs/governance/project-overview.md` | 登记同步（见下） |

**运行代码零改动。** 本条收口不需要改实现——缺口在**证据**侧，不在实现侧；唯一的实现疑问（§9.3(b) 是否真的重算内容）读代码后确认实现已在，只补测试。

## 这次跑过的检查

```bash
# ① 本条专属落点：11 个文件 / 165 条
cd webui && npx vitest run --maxWorkers=1 --testTimeout=60000 \
  server/__tests__/audit-v025-as-of-proof.test.ts \
  server/__tests__/audit-v025-association.test.ts \
  server/__tests__/audit-v025-attribution-journal.test.ts \
  server/__tests__/audit-v025-contract-boundaries.test.ts \
  server/__tests__/audit-v025-coverage-authorization.test.ts \
  server/__tests__/audit-v025-derivation.test.ts \
  server/__tests__/audit-v025-execution-evidence.test.ts \
  server/__tests__/audit-v025-export-seal-contract.test.ts \
  server/__tests__/audit-v025-fault-injection.test.ts \
  server/__tests__/audit-v025-ingress-registry.test.ts \
  server/__tests__/audit-v025-reconcile.test.ts
# → Test Files 11 passed (11)｜Tests 165 passed (165)｜Duration 2.77s

# ② §18.16 表内引用的共用夹具文件：23 个文件 / 249 条
cd webui && npx vitest run --maxWorkers=1 --testTimeout=60000 \
  server/__tests__/audit-export-paging.test.ts \
  server/__tests__/audit-export-redaction.test.ts \
  server/__tests__/audit-projection-recovery.test.ts \
  server/__tests__/audit-reconciliation-routes.test.ts \
  server/__tests__/audit-release-barrier.test.ts \
  server/__tests__/audit-snapshot.test.ts \
  server/__tests__/audit-trust/audit-trust-agent-audit-events.test.ts \
  server/__tests__/audit-trust/audit-trust-association-revisions.test.ts \
  server/__tests__/audit-trust/audit-trust-backfill.test.ts \
  server/__tests__/audit-trust/audit-trust-manifest-conformance.test.ts \
  server/__tests__/audit-trust/audit-trust-scope-change.test.ts \
  server/__tests__/audit-trust/audit-trust-v2-export-pack.test.ts \
  server/__tests__/audit-trust/audit-trust-v2-export.test.ts \
  server/__tests__/question-budget*.test.ts \
  server/__tests__/denial-repair-hint.test.ts
# → Test Files 23 passed (23)｜Tests 249 passed (249)｜Duration 13.69s

# ③ 全量 webui 套件
cd webui && npx vitest run --maxWorkers=1
# → Test Files 2 failed | 426 passed | 1 skipped (429)
#   Tests      4 failed | 5226 passed | 8 skipped (5238)
#   Duration   378.14s（transform 8.20s, setup 25.51s, import 41.97s, tests 231.60s）

# ④ 失败项单独复跑（证明是超时预算，不是功能回归）
cd webui && npx vitest run --maxWorkers=1 --testTimeout=60000 \
  server/__tests__/policy-runtime-i6.test.ts server/__tests__/web-security.test.ts
# → Test Files 2 passed (2)｜Tests 15 passed (15)｜Duration 59.05s

# ⑤ 静态门禁
npm --prefix webui run typecheck
# → 86 个既存错误（本条涉及文件 0 个）

npm run lint:spec-docs
# → Spec/Plan doc lint passed (343 files scanned, 899 baseline exemptions)，0 STALE

npm run lint:terminology
# → Terminology lint passed (1094 files scanned)

npm run lint:spec
# → PASS（access-role-policy 一条 WARN：demo_readonly 缺 permission_model_version，迁移窗口，与本条无关）
```

### CI 状态说明

本条改动**尚未提交**，因此 `lucy-ci.yml`（`push` 到 `lucy-v0.25` 触发）**还没有覆盖它**。会话中跟踪的 CI run `41285070333` 跑的是上一个提交 `45d091bd`，与本条无关：截至本文件落盘，该 run 的 `spec-and-webui`、`docker-smoke`、`workflow-contracts`、`ktx-diff-audit`、`k8s-static`、`business-eval-catalog`、`headless-config` 均已 success，`demo-db-smoke`、`postgres-demo-db-smoke`、`k8s-upgrade-gate` 仍在 in_progress，**未取到终态结论**。

按 `docs/reviews/2026-11-01-prebatch-ab-verification.md` 第四节，`lucy-v0.25` 的 CI **自 2026-10-30 起就是红的**，本条的判断不建立在 CI 结论之上。

### 关于全量套件的 4 个失败

失败项是 `policy-runtime-i6.test.ts` 1 条、`web-security.test.ts` 3 条，四条的报错**全部是 `Error: Test timed out in 5000ms`**，没有一条断言不成立。复跑证据：

- 单独跑这两个文件（`--testTimeout=60000`）→ **2 个文件 / 15 条全过**，耗时 59.05s；日志里 `/api/health` 单次响应实测 **13.4s 与 12.8s**，本身就远超 vitest 默认的 5s 预算。
- 这与 `docs/reviews/2026-11-01-prebatch-ab-verification.md` 记录的既有条件**同源**：该文已把「失败全部是 vitest 默认 5000ms 单测超时」归因为**本机跑全量时的资源争用**，并明确「CI runner 的 CPU 配额与本机不同，CI 的套件从来没有报过这两条症状」。本轮这两条比该文描述的更**确定**——不是随机受害文件，而是 `/api/health` 在本机恒需 12–13s，这两个文件在任何一次全量跑里都必然超预算。
- 不是本轮引入：本轮**零运行代码改动**，新增的两个文件是纯函数与只读判定用例，不触碰 `policy-runtime` 与 `web-security` 的任何路径。
- 全量套件在本轮**连跑两次，结果完全一致**（429 文件 / 5238 条 / 同样 4 条超时），失败项集合稳定，不是抖动。

**本条的判定不依赖这 4 条**——§18.16 的 34 个落点文件在 ①② 两次定向跑里 414 条全过（165 ＋ 249）。

### typecheck

全仓 86 个既存错误（与本条无关，`tsc` 在本仓不是门禁），**本轮新增的两个文件 0 错误**。

过程如实记录：初版 `audit-v025-contract-boundaries.test.ts` 的 §4.3(e) 一段用了 `expect(families.reported.protocol).toBeUndefined()` 这类写法，触发 3 个 TS2339（`EvidenceFamilies` 类型上没有 `protocol`／`client` 键），全仓诊断一度变成 89 条。改用 `expect(Object.keys(families.reported)).not.toContain("protocol")` 后回到 86 条基线。**改的是断言写法，不是运行代码。**

## 逐条结论

S01–S07 的逐条落点、每个落点**明确不证明什么**，见 Spec §18.16 的逐行表格（每行都有「证据边界」列）。本文件只给分组结论：

| 分组 | 结论 | 主要证据文件 |
|---|---|---|
| S01 事件状态与响应证据 | 通过 | `audit-v025-derivation.test.ts`、`audit-v025-execution-evidence.test.ts`、`audit-v025-coverage-authorization.test.ts`、`audit-release-barrier.test.ts`、`audit-v025-contract-boundaries.test.ts` |
| S02 入口持久化与恢复 | 通过 | `audit-v025-ingress-registry.test.ts`、`audit-projection-recovery.test.ts`、`audit-v025-fault-injection.test.ts` |
| S03 跨端关联与重试标识 | 通过 | `audit-v025-association.test.ts`、`audit-trust/audit-trust-agent-audit-events.test.ts`、`audit-trust/audit-trust-scope-change.test.ts` |
| S04 问询归属与来源可信度 | 通过 | `audit-v025-association.test.ts`、`audit-trust/audit-trust-association-revisions.test.ts`、`audit-v025-attribution-journal.test.ts`、`audit-trust/audit-trust-backfill.test.ts` |
| S05 对账、指标与完整性 | 通过 | `audit-v025-reconcile.test.ts`、`audit-v025-as-of-proof.test.ts`、`audit-reconciliation-routes.test.ts` |
| S06 导出快照与证据封存 | 通过 | `audit-v025-export-seal-contract.test.ts`、`audit-trust/audit-trust-v2-export.test.ts`、`audit-trust/audit-trust-v2-export-pack.test.ts`、`audit-trust/audit-trust-manifest-conformance.test.ts`、`audit-snapshot.test.ts`、`audit-export-paging.test.ts`、`audit-export-redaction.test.ts` |
| S07 错误、重试与预算 | 通过 | `audit-v025-contract-boundaries.test.ts`、`audit-v025-association.test.ts`、`denial-repair-hint.test.ts`、`question-budget*.test.ts` |

复核方式：**§18.16 表内点名的 22 个 describe 名逐字比对，全部命中，无一条落空**；每个 describe 的用例条数也与表内数字逐一对齐。比对是按 §18.16 的表格逐行核的，脚本化的比对结果如下：

| 核对项 | 结果 |
|---|---|
| §18.16 引用的 describe 名 | 22 个，**22 个命中，0 落空** |
| §18.16 标注的 describe 用例条数 | 22 组，**逐条与源文件一致**（16／4／5／14／3／9／12／4／3／2／7／5／3／2／3／2／4／4／1／2／4／4 等） |
| §18.16 标注的文件级条数 | `audit-trust-v2-export.test.ts` 14（原文写 21，已按源文件更正）、`audit-snapshot.test.ts` 2（原文写 3，已更正）、`audit-export-paging.test.ts` 4（原文写 5，已更正）；其余文件级条数与源文件一致 |
| `audit-v025-*.test.ts` 11 个文件合计 | **165 条**，与 §18.16 前言一致（逐文件数：16／15／4／38／7／32／11／9／4／11／18） |

> 更正说明：上表前三行的三处文件级条数在本文件初稿中写错（21／3／5），实测后按源文件更正为 14／2／4。**§18.16 表格已同步更正。**

## 三处需要写清的口径，避免被误读

### 一、S05 的六项完整性检查里，五项在生产恒为 `unknown`

这不是缺陷，是**独立到达凭据尚未建立的如实披露**。`audit-v025-coverage-authorization.test.ts` 的「F-01 入口接收覆盖检查不得同侧自证」正是要求它**不得**自证；`audit-v025-reconcile.test.ts` 的「B12 auditCoverage 六项独立检查」要求缺证据即 `unknown` 且 `unknown` **不合成** `pass`。检查 1 按 Spec §18.11 F-01 是永久 `unknown`（不得由审计侧自己声明覆盖）。本条收口**不改变**这一点，也不把它算作通过。

### 二、`classifyAccessLogEvent` 仍把 `budget_stop` 映射为 `execution=interrupted`，这不是违规

`audit-trust/audit-trust-classification.test.ts` 有一条断言「classifies budget_stop as interrupted (not denied)」，与 Spec §4.3(a) 规则 2／§4.3(b) 的新口径（预算终止 → 主状态 `budget_stopped` ＋ `execution=not_executed`）方向相反。查证结论：

- 该函数是 **v1.1 历史回放合同**（`CLASSIFICATION_VERSION = "audit-trust-2026-10-19-r1.v1"`），文件头 E-1 明写「`classifyAccessLogEvent` 只在测试中被调用，生产写／读路径都不用它」。
- v2p5 路径走 `classifyAuditEvent`，它在 `audit-classification.ts:428` 显式把 execution 视图交给派生层，预算终止落 `not_executed`。
- 该行为已被断言：`audit-v025-coverage-authorization.test.ts`「F-03 授权事实保真」断言 `budget_stop` → `primaryStatus=budget_stopped` ＋ `executionStatus=not_executed` ＋ `authorizationStatus=unknown`（不是 `not_evaluated`、不是 `denied`）；`audit-v025-derivation.test.ts` 的用例「budget_stop 不映射为 execution=interrupted」也直接断言这一点。

所以这是**历史合同与新合同并存**，不是生产路径上的矛盾。按 §18.3 N16 的保留惯例，本条不改历史合同，只在此登记，避免后来者 grep 到旧函数时误判为缺陷。

### 三、本条不关闭客户交付

客户交付与 Wave 0b 仍是 `blocked_delivery`。本条是**功能合同层**收口，与交付状态无关。

## 残余，不打回本条

以下全部**不构成本条收口的阻塞项**——它们要么归运行时取证层，要么是设计上就没有实现载体的条款：

- **历史只读样本回放基线未核对**：177／192／175 行、110/23/43/1 分布、137/36/2、19 个仅握手分组、Session B 50 个工具、Codex 31=23+3+4+1。属 A12 与运行时取证层。
- **真实进程强杀与「上游已执行但回包丢失 → `indeterminate`」分支没有实现载体**。`audit-release-barrier.test.ts` 覆盖的是客户端断连与崩溃后未闭合操作（标 `interrupted`），不是上游已执行但回包丢失。属 A01–A04。
- **`received` 单点提交失败注入**未覆盖（A02-R）。`audit-v025-fault-injection.test.ts` 是**单元级 harness**，按 §18.14.2 自述不构成运行时证据。
- **5 of 6 完整性检查没有独立证据来源**，检查 1 按 §18.11 F-01 永久 `unknown`。见上文口径一。
- **`x-lucy-event-id` 出站关联头是否真的带出，无断言**。§5.3 U12 只测了信封构造函数。
- **`prevExportId` 版本链与来源声明的行为未覆盖**。§9.3(b) 的「来源声明」与「同目录可重写清单」两条是**不可抵赖边界**，Spec 以术语禁令表达，不可自动化。
- **预算的「尝试次数」一档，以及「重连／省略 `begin_question` 不重置任一档预算」的分支，未覆盖。**
- **D-28 仍开**：切分前无序号行时，正式读取继续 409。
- **浏览器层与移动窄屏**：按项目约定默认不做，且不在本条出口内。
- **全仓 typecheck 86 个既存错误**与本条无关（`tsc` 在本仓不是门禁），本条涉及文件 0 错误。

## 登记同步

本条按 `docs/governance/DEVELOPMENT.md` 的收口配方，同步 5 处登记：

1. 主 Spec 状态行与新增 §18.16／§18.17
2. `docs/README.md`——L25-09 行的状态描述与本次收口记录
3. `docs/plans/README.md`——L25-09 行改为不再复述状态（该行自身的约定是「本行不复述」）
4. `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` §2.3 状态行 ＋ 新的版本变更行
5. `docs/governance/project-overview.md` §9 的 L25-09 行 ＋ 版本行

并删除 `docs/governance/spec-plan-doc-baseline.json` 中本 Spec 的 `close-layer` 豁免（本 Spec 现在自己满足该规则），`npm run lint:spec-docs` 通过且 0 STALE。

## 不在收口里

客户镜像、Helm、集群部署、客户环境验证与客户交付，都不在这条里。**本条收口不表示可上线**，也不构成客户包验收。
