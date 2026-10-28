# L25-09 审计可信度与管理员调查增量 —— 2026-10-28 实施记录

日期：2026-10-28。分支 `lucy-v0.25`。委托人拍板 D1–D4（见 §2）。

**本记录的性质**：这是**实现层**的实施记录。本轮**没有**取得任何 A／V 场景的验收通过
结论，**没有**取得 Stage 1 的真实 passed 证据，Stage 2 未执行。文中所有「通过」字样都
指**实现层测试**（定向用例／全量回归／静态门禁），不指验收通过。

---

## 1. 结论

| 项 | 结论 |
|---|---|
| 语义地基（Gap 1 执行凭据、Gap 4 列名漂移） | **已闭合**（实现层 + Stage 1 真实证据）；**A01–A12 验收仍未执行**（无 spec） |
| 证据链断点（AUD25/ARV25 无法被 `verifiedBy` 采信） | **已闭合**（实现层 + 链路自检 + 真实取证）；`evidence.cases` 中 **ARV25-V01…V11 共 11 个 variant status=passed** |
| 管理员第一现场（20261019 §5 六组件 + 三轴 + 八桶 + E7） | **已接入**（实现层）；桌面双分辨率浏览器证据仍未取得 |
| P0-4 只读对账前端消费（§4 只读页面与交互） | **已接入**（实现层）；ARV25-V01…V11 真实 passed，**ARV25-V12 仍 blocked**（需 `k8s-amd64`） |
| Stage 1（开发单机真实取证） | **部分达成**：ARV25 侧取得 11 个 variant 的真实 passed 证据；**A01–A12（AUD25 全部 12 个 variant）仍无任何 spec、全部 blocked** |
| Stage 2（客户 amd64 K8s） | **未执行**，阻塞于 G-01 / G-06 |
| 台账 | **D-32 / D-33 置 `fixed`**（`fixedIn` = 00cf44d4，`verifiedBy` = 6 个在 release evidence 中 status=passed 的 ARV25 变体）；新增 **D-34**（P2，open，登录限流撞门禁）；其余审计相关条目保持 `open`；P0-2 / P0-3 的 open 项不动 |

**因此本轮仍不宣称「可交付 UAT」**，但阻塞点已从「取不到真证据」收窄为可点名的四条：
**① A01–A12 无 spec**（AUD25 全部 12 个 variant 仍 blocked）；**② ARV25-V12 需 Stage 2**；
**③ agent 腿未跑**（本机无模型 API key）；**④ 管理腿单窗口必撞登录限流**（D-34）。
其中 ①③ 属未覆盖、② 属 Stage 2 边界、④ 是新登记的 harness 缺口。

---

## 2. 已拍板的决策与对实施的约束

| # | 决策 | 裁定 | 实施约束 |
|---|---|---|---|
| D1 | 是否授权补齐执行凭据 | **授权**，按逐点判据实施 | 禁止把 `outcome === "ok"` 映射为 `verifiedSuccess`；HTTP 200 不推定执行成功；无法可靠判定「是否真实执行已观测」时**不登记凭据**（落 `unknown`），不得猜测 |
| D2 | v0.25 案例接入 release 证据链的路径 | **并入冻结 catalog**（路径 A），走 lock 审阅变更 | 不在装配层另开 v025 通道；catalog 是冻结契约，变更须经审阅 |
| D3 | UAT 交付边界 | **交付 Stage 1**，Stage 2 明确标未执行 | 不得把 Stage 1 结果外推为 Stage 2 通过，不得冒充客户发布通过 |
| D4 | 台账回填范围 | 仅回填**审计链路直接相关**条目 | P0-2 / P0-3 自身的 open 项不动；其余保持 open 并写明阻塞原因，不得为凑绿改判 |

---

## 3. 落地清单

| 批次 | 内容 | 提交 |
|---|---|---|
| A | 写路径执行凭据 ＋ P0-4 列名漂移修复 | `00cf44d4` |
| B | AUD25/ARV25 并入冻结 catalog | `4ef1e1e3` |
| C-1 | Audit 页六组件 ＋ 八桶替换 ＋ E7 去截断 ＋ 三轴独立读路径 | `71e4e788` |
| C-2 | P0-4 使用概况页 ＋ E8 差异明细入口 ＋ ARV25 spec 覆盖接线 | `6db2a879` |

### 3.1 批 A：执行凭据（逐点判定）

`webui/server/proxy/audit-classification.ts` 新增 `ExecutionObservation` 与
`executionEvidenceFromObservation()` —— **唯一**允许构造 `ExecutionEvidence` 的入口；
`executed` / `failed` 互斥；空观测返回 `undefined`。

`webui/server/proxy/mcp-proxy.ts` 在 **13 处真实观测到执行结果**的位置逐点登记凭据：
主上游路径、catalog、explain/freshness、begin_question、skills 协议 5 处、initialize、
最终上游路径、ACL 拒绝、入参校验失败。每处带独立中文注释说明为何是「观测到的事实」。

**明确不登记凭据**的两处：`notifications/cancelled`（协议通知）与 initialize/tools_list
的上游不可用本地回退（本地降级，不是上游执行）。

分类层（`audit-classification.ts` 的映射）与派生层（`audit-derivation.ts` 的九规则表）
**一行未改** —— 凭据到位后 `succeeded` / `failed` 两桶才可能出现在生产数据里。

### 3.2 批 A：列名漂移（D-32）

`reconciliation.ts` / `reconciliation-ports.ts` 改读 `access_log` 真实存在的
`authorization_status` / `execution_status`。**不新增** `*_view` 列 —— `access_log` 已有
同义列，新增会制造第二套竞争性事实源。`reconciliation-csv.ts` 早已使用正确列名。
缺列兜底保留（老库可能没有该列）：缺列时仍落 `unknown` 并附原因，**不得**当 0 / false。

### 3.3 批 B：AUD25/ARV25 并入冻结 catalog（D2 路径 A）

断点：这两个场景此前只登记在 v0.25 覆盖清单，不在冻结 catalog 里；`assemble.mjs` 的
`loadResults()` 不读 `v025/`，`verify-evidence.mjs` 的 `passedIds` 来自 `evidence.cases`
⇒ 即使本地跑出 passed，台账的 `verifiedBy` 也永远填不上（33 条 open 的共同根因）。

- `case-catalog.yaml` 新增 `AUD25`（12 variant）与 `ARV25`（12 variant）两个场景；
  `case-catalog.lock.json` 同步重推（255 → **279** cases，
  digest `240bff0f…4a694` → `c62cf23f…ae4`）。
- **字段唯一真源分层**：`existingCatalogMappings`（279）只登记 ownerBranch + 需求归属
  （sourceSpec / sourceRequirementId / priority）+ 跨域引用；
  `executors` / `requires` / `assert` / `artifacts` / `gold` 的唯一真源是**冻结 catalog**；
  `newScenarios`（149）仍是其余执行项的真源。`audit-v025.mjs` 的 `executionContract()`
  统一封装这层分层。
- `existing` 必须**恰好等于** `lock.requiredIds`（两者不可重叠），故 24 个审计执行项从
  `newScenarios` 迁至 `existing`（173 → 149）。覆盖校验同步接受「已并入冻结 catalog」的
  集合，避免把一次**加强**误报成「遗漏」。
- 分母字面量钉集中到 `case-catalog.test.mjs`（单一处），其余用例改为「catalog ≡ 冻结
  lock」，不再各自钉字面量。

### 3.4 批 C-1：管理员第一现场（20261019 §5）

- 后端补齐读路径：`readExecutionStatus` / `readAuthorizationStatus` /
  `readAssociationStatus` / `readDeliveryStatus` / `readNullReason`；历史行一律落
  `unknown` / `legacy_unverified`，不重解释历史数据。
- `GET /api/admin/audit` 每条 entry 增加三轴字段与空值原因、送达状态、凭证主体、受控
  客户端上报事实。
- `Audit.tsx` 挂载六组件；状态列改展示**八桶** `primaryStatus` + `AuditStatusTriad`
  三条**独立**判断轴；旧 `outcome` 只作 legacy 直方图单列（标签带「旧：」前缀）。
- 顶部元条：固定起止时间、时区、统计时间、刷新/暂停状态、审计同步延迟（取服务端
  `projection.delayMs`，真实观测值）。暂停时冻结筛选与序列上界。
- E7 去截断：涉及数据表不再写「等 N 个」；抽屉默认展开全部并可一键复制完整清单。
- 顺带修正一处真实缺陷：`ReadonlySqlRowset` 此前只有 5 个状态，缺后端冻结六值枚举里的
  `not_supported`。按 `audit-null-reasons.ts` 自身的要求改为直接消费后端唯一真源。

### 3.5 批 C-2：P0-4 只读对账前端消费

- 新增 `/admin/audit-reconciliation`（不在侧栏导航，只在 URL 可达）：消费
  `GET /api/admin/audit/reconciliation/usage`、`.../inquiries/:turnId`、`.../export`。
- 展示纪律：规模为 null 显示「不可观测 + 原因」而非 0；比率同时给出 N／D，分母为 0 或
  不可观测时不显示 0% / 100%；as-of S 不可证明时显式披露为**诊断视图**。
- E8：治理页 Token 卡片改为**配置数 · 活跃数并列**，并给出四类差异集合的明细入口；旧
  文案「活跃 Token 数超过配置数，数据异常」改为「口径未同时一致，不自动等于数据异常」。
- ARV25 spec **同时**声明 `covers()`（冻结 collector 的 `case` 命名空间）与
  `coversV025()`（v0.25 维度证据命名空间）。此前只有 `coversV025`，冻结 collector 看不到
  这些 variant。

---

## 4. 验证证据（实现层）

| 项 | 命令 | 结果 |
|---|---|---|
| 全量 webui 回归 | `cd webui && npx vitest run --maxWorkers=1` | 373 文件 / 4518 用例，**零新增失败**（基线 370 / 4484） |
| 类型检查 | `cd webui && npx tsc --noEmit -p tsconfig.json` | 本轮文件 **0 错误**；全仓 76 错误与基线一致 |
| e2e 门禁 | `npm run test:e2e-harness` | 1055 例 / 1053 通过 / **0 失败**（基线 1049 / 1048 / 1） |
| 静态门禁 | `lint:version` / `lint:release-ledger` / `lint:spec` / `lint:terminology` / `lint:ia-boundary` | 全部通过 |
| 冻结目录 | `node scripts/e2e/lib/catalog.mjs --check` | exit 0，279 cases，digest `sha256:c62cf23f…ae4` |

**反向对照**（区分「测试有效」与「测试恒真」）：

- 撤掉列名漂移修复 → `audit-v025-execution-evidence.test.ts` 用例确实失败；恢复 → 全绿。
- 把覆盖轴改成由执行轴推导（违反「执行成功不自动使关联或覆盖显示绿色已完成」）→
  `audit-trust-page-integration.test.tsx` 的三轴独立用例确实失败；恢复 → 全绿。

**链路自检**（`scripts/e2e/__tests__/audit-v025-evidence-chain.test.mjs`，5 例）：逐段证明
catalog → `expectedExecutions` → runner 结果 → `assembleEvidence` → `evidence.cases` →
`passedIds` 接通，且**无 runner 结果的 variant 不会被凭空补成 passed**。

---

## 5. 本轮未执行与仍开放（**不得**被读成「通过」）

1. **A01–A12（审计增量 §13.2）与 V01–V12（对账 §7）的运行时验收全部未执行。**
   本轮落地的是执行凭据的**载体**、读取侧的正确性、以及让 passed 结果**能被采信**的
   证据链；三者都不等于场景已被验证。定向用例全绿不是验收。
2. **Stage 1（开发单机）未取得真实 passed 证据。** 原因有三条，各自独立：
   - A01–A12 **无任何 Playwright spec 覆盖** —— `webui/tests/real-e2e/` 下不存在审计增量
     spec；
   - ARV25-V01..V12 的 spec 此前只声明 `coversV025`（v0.25 命名空间），冻结 collector
     看不到这些 variant，它们在 `evidence.cases` 里根本不会出现；本轮已补 `covers()`，
     但**声明**不等于**真实通过**；
   - 同日 UAT 复核（`docs/reviews/2026-10-28-uat-p0-l25-09-audit-and-reconciliation.md`，
     HEAD `17fdaf08`）结论为**退回**，并登记 UAT-20261028-01（F-02 精确 as-of S 重建未
     收口：归属就地改写用当前账本水位当 `ledger_seq`，改写序号**等于** S 时
     `proveExactAsOfS` 仍返回 `ok=true`，同一 S 可先导出旧归属再导出新归属，两次正式结果
     都显示范围完整）。该缺口直接落在 A08、A10-ASOF、V09、V10 的冻结判定上 —— 这四项
     **不能**记 passed。
3. **Stage 2（客户 amd64 K8s）未执行**：G-01（受保护 amd64 runner 未注册，real-e2e job
   不可调度）、G-06（GHCR 推送 `permission_denied`，命名空间 `kaelio` vs owner
   `Forrest219`）。本机 `kubectl` 无 context，`k8s-amd64` / `network-profile` 能力本地必然
   blocked —— 这是预期行为，**不得**通过伪造能力绕过。
4. **桌面双分辨率浏览器证据（1440×900 / 1280×800）未取得**：20261019 §9 与 T05 明文要求
   该证据，本轮未在隔离 fixture 上执行浏览器测试。
5. **台账**：D-32 / D-33 登记为 `open`、`fixedIn` 不填（实现提交 SHA 与回归用例记在各自
   note 中）；待 Stage 1 取得真实 passed 用例后再逐条置 fixed 并回填 `fixedIn` /
   `verifiedBy`。D-28 / D-29 保持 open。D-31 的 15 条保持 open。P0-2 / P0-3 自身的 open
   项本轮**不动**（D4）。

---

## 6. 交付 UAT 尚缺什么

| 判据（计划 §4.3） | 状态 | 缺什么 |
|---|---|---|
| Gap 1/4 修复完成，实现层验证全绿 | ✅ | — |
| Gap 2/3 前端完成 ＋ 桌面双分辨率浏览器证据 | ⚠️ 前端完成，浏览器证据缺 | 隔离 fixture 上的 1440×900 / 1280×800 截图与操作记录 |
| Stage 1 取证完成，passed 必须是真结果 | ❌ | 审计增量 spec（A01–A12 无覆盖）；ARV25 spec 的真实 passed；UAT-20261028-01 的处置 |
| 证据链闭合（AUD25/ARV25 可被采信） | ✅（链路自检） | 真实 passed 证据本身 |
| 台账按三段顺序回填 | ⚠️ 链路已通，取证未取得 | Stage 1 的 passed 用例 ID |
| 范围声明准确 | ✅ | — |

---

## 7. 引用

- 增量规格 §18.12：`docs/specs/lucy-20261020-v2p5-audit-increment-spec.md`
- 对账规格 §3.6：`docs/specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md`
- 实施计划 §11.7：`docs/plans/2026-10-25-lucy-v0.25-p0-implementation-plan.md`
- 台账：`docs/qa/security-findings.yaml`（D-32 / D-33）
- 同日 UAT 复核：`docs/reviews/2026-10-28-uat-p0-l25-09-audit-and-reconciliation.md`
- 冻结目录：`scripts/e2e/contracts/case-catalog.yaml` + `case-catalog.lock.json`


## 8. Stage 1 真实取证结果（2026-10-29，续 §1–§7）

本节是 §5「本轮未执行」与 §6「交付 UAT 尚缺什么」的**结果回写**。原节原文保留不改
（它们是 2026-10-28 当时的记录），本节取代其中「Stage 1 未取得真实 passed 证据」一条。

### 8.1 执行链与产物

| 步骤 | 结果 |
|---|---|
| `prepare-environment --mode local` | run `inbox/e2e/l2509-stage1b` |
| 准备 PostgreSQL | 一次性 `postgres:16-alpine`（端口 5432），口令取本次 run 生成的 per-run owner 口令 |
| `apply-db` | **applied=true**；种子 SQL 摘要与数据集摘要**实测一致**；只读探针通过；写拒绝验证 2/2 |
| `run-security` | 89 passed / 46 failed / 27 blocked（失败项属既有 SEC-19／SEC-20 等他线） |
| `run-management` | ARV25 作用域：3 用例全通过；**ARV25-V01…V11 共 11 个 variant status=passed**，ARV25-V12 blocked |
| 装配证据 | `inbox/e2e/l2509-stage1b/release-evidence.json`，`evidence.cases` 共 213 条（passed 103／failed 46／blocked 64） |
| 候选身份 | `inbox/e2e/l2509-stage1b/candidate-identity.json`（gitSha `fd197e5b`） |
| 验证 | `verify-evidence.mjs --assemble` 重跑后，D-32/D-33 相关问题 **0**，`p0_p1_unresolved` 33 → 31 |

### 8.2 取证前必须修的三处「声明 ≠ 通过」

catalog 的 `assert` 列表**逐 variant 生效**：冻结 collector 对每个 variant 取「覆盖它的所有
测试」的断言并集，缺任一 token 即判 failed。首轮取证暴露：

1. ARV25-V04／V07–V10 只被第 2 个测试覆盖，而该测试从不评估 `audit_event`；
2. ARV25-V01／V02／V03／V05／V06 只被第 1 个测试覆盖，而该测试只在**拒绝分支**评估
   `deny`、从不评估 `no_leak`；
3. 第 1 个测试依赖「本轮已有真实 Agent 轮次」，否则整条 skip ⇒ variant 转 blocked；而管理腿
   在 CI 顺序里跑在 agent 腿**之前**，该依赖在本仓库顺序下永远不成立。

修法（提交 `fd197e5b` 与 `c2a08eec`，**不放宽任何断言的强度**，只补齐缺失的评估）：
第 1 个测试用真实 `lucy_begin_question`（同一 `x-lucy-session-id` 会话）**自产 turn**，不依赖
外部 Agent 腿、不伪造 turn id；补 `deny`／`no_leak`；第 2 个测试补 `audit_event`（使用概况
每一行都必须能在同一窗口的管理员审计列表找到对应事件）与 `deny`；把 V09／V10 的**快照冻结与
同源**断言做实（usage 与 export 两次独立读取的计量单位与规则版本必须一致；导出 manifest
内嵌 `context` 与 `completeness` 块必须携带本次导出自己的 snapshotId／账本上界 S／
计量单位／分类与派生版本）；另补一条 D-32／D-33 回归断言（导出 CSV 的授权／执行两列必须
带出**观测到的枚举值**，而不是恒为 unknown）。

### 8.3 两条被推翻的旧判断（留痕，避免后人重走）

1. **「usage 端点返回 409 `RECONCILIATION_AS_OF_S_UNPROVABLE` 是 F-02 缺陷在真实链路上命中」
   ——错。** 那是 §18.11 规定的**失败关闭设计**：窗口内尚无任何审计事件（账本无基线）时
   不可证明；本轮真实产生事件后同一端点即返回 `ok=true`。该现象不构成 F-02 的证据。
2. **「V09／V10 不能记 passed」——被实测推翻。** 核对后确认二者的 catalog 声明断言集是
   `[audit_event, consistency, deny, no_leak]`，**均不以 as-of S 可证明性为前提**；先前判
   failed 只因 spec 声明了覆盖却没逐条评估断言。补齐断言后二者真实 passed。

### 8.4 取证边界（结论必须与边界一起读）

- Stage 1 证据是对**工作树源码**跑的（real-e2e 本地模式用
  `node --import tsx server/index.ts` 起实例），工作树含并行会话未提交的 F-02
  「归属列按日志前像回放」修订。本次运行库 `access_log_attribution_mutations = 0`、
  `access_log.ledger_seq IS NULL = 0` ⇒ 该路径**从未被触发**，结论不依赖它。
- 覆盖「按同一 S 重建基础事实与归属修订视图不漂移」的 **A08、A10-ASOF 仍无 spec、仍
  blocked**；**F-02 未收口**，本轮不据此宣称 F-02 已修复。
- `failed` 桶本轮为空，只因**本轮没有失败的执行事件**（覆盖缺口，不是缺陷）。
- agent 腿未执行（本机无任何模型 API key）；Stage 2 未执行（G-01／G-06）。
- 桌面双分辨率（1440×900／1280×800）浏览器证据仍未取得（real-e2e 配置只跑 1440×900）。
- **D-34**：全量管理腿实测 62 次独立登录、10 次 429，而
  `AUTH_RATE_LIMITS.sourceTotal` 冻结为 30 次／5 分钟 ⇒ 单窗口内必然撞限流。Stage 1 取证
  因此按 spec 作用域跑；全量腿结果留档
  `inbox/e2e/l2509-stage1b/results/management-full-unscoped.json`。

