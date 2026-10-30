# L25-14 行权限 P0 上线前 UAT 对照（2026-10-28）

对照基线：分支 `lucy-v0.25`，HEAD `17fdaf08`。工作区里仅有的未提交 L25-16 文档未纳入本报告。

本报告是上线前对照，不是验收通过。下面没有任何验收 ID 被记为 UAT passed。`passed_automation` 只表示仓库里已有测试直接断言了该行为，且本次运行通过。单元测试通过和 HTTP 200 都不是 UAT 通过。

## 结论

C14–C18 的主体代码已经在 PATCH / CREATE / COPY、恢复闸和目录装载上落地，本次 7 个定向 vitest 文件 40 条全部通过。这不能关闭 C19，也不能把 V 项记成验收通过。

已决合同上仍有 5 处实现偏差：Role 删除在 `recovery_required` 时仍返回成功写入且不消费预览确认；原配置缺失或读失败时回滚被直接当成已核验；进程级目录缓存使编译输入摘要不是新读；预览在逐 Agent 结果缺键时回退到全局并集；能力夹具可以不经适配器合同强制 `proven`。

规格文本与 2026-10-27 已回写的实施状态、以及 2026-10-28 已落地的 D-03 大小写解析不一致。D-03 台账保持 `open` / `fixedIn: null` 是台账自己的取证规则，本报告不建议改成 fixed。

## 范围

纳入：R2 / R4 / R5 的现行合同（行权限 Spec §14.2–§14.6）、实施计划 §5.4 的 C14–C19，以及已落地的 D-03 大小写不敏感 Manifest 解析。

未纳入、也不把其证据混进 P0：R1 模板、R3 行权限视图（`docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md`）。顺带看到 `webui/server/admin/routes/row-policy.ts` 的模板写入也只看 `rolledBack === true` 就可能返回 `written: true`；这是 P1，不提案、不计数。

未做：Docker 构建、`demo:upgrade`、清 volume、浏览器、real-e2e、全量 webui 套件。

## 命令与结果

均在 `webui/` 下执行，各自使用独立的 `KTX_PROJECT_ROOT=$(mktemp -d)`，`--maxWorkers=1`。没有出现 inbox / 端口冲突，因此没有单独重跑。

| 命令 | 文件 | 结果 |
|---|---|---|
| 第 1 条（指定） | `server/__tests__/row-policy-d03-uppercase.test.ts`、`server/__tests__/row-policy-catalog-attribution.test.ts` | 2 files，12 passed，0 failed |
| 第 2 条 | `server/__tests__/row-policy-preview.test.ts`、`server/__tests__/row-policy-audit.test.ts`、`server/__tests__/access-config-audit-closure.test.ts`、`src/__tests__/role-detail-row-policy-save.test.tsx`、`src/__tests__/access-write-outcome.test.ts` | 5 files，28 passed，0 failed |

合计：7 个文件，40 passed，0 failed。

第 2 条里的 HTTP 200 / 500 是这些测试自己打出来的局部断言，不单独构成任一 V 项的 UAT 通过。

## 逐条矩阵

状态只用：`passed_automation`、`failed`、`blocked`、`not_run`。

| ID | 状态 | 直接证据 | 未覆盖 |
|---|---|---|---|
| V08 | passed_automation | `row-policy-preview.test.ts`：两个受限 Role 的并集是两条 OR，不是「全部行」 | §14.6 要求经保存 API 归档全局并集与逐 Agent DNF；本次没有 |
| V09 | passed_automation | 同上：其中一个 Role 为全部行时，并集为 `kind: "all"` | 「Agent 只持部分 Role、无关 all Role 不得进入该 Agent」没有对应用例 |
| V10 | failed | 同上有一条「个人行限制 AND 收窄」的绿测试 | 见缺陷 4：缺键时回退全局并集，该测试没有锁住这条禁止 |
| V11 | not_run | 无。预览保存路径上没有 `final_rows_unsatisfiable` 且零写入、零 intent 的用例 | 不可满足必须拒绝保存 |
| V12 | not_run | 预览测试只断言内存候选的 digest 与磁盘未改 | 没有固定 Agent / 表 / candidateDigest / compileInputsDigest，再与运行时 `forced_filters` 比较。D-03 文件里的 payload 对比不是这条 |
| V13 | not_run | 无。仓库测试没有 `ROW_POLICY_PREVIEW_REQUIRED` 的 `missing` / `preview_failed` / `candidate_mismatch` / `baseline_changed` / `compile_inputs_changed` / `impact_changed` | 六种拒绝都要在 intent 前，并证明零配置写、零行策略 intent |
| V15 | failed | `access-config-audit-closure.test.ts` 与 `row-policy-audit.test.ts` 覆盖了共享写入器的部分阶段：intent 先于写入、intent 失败零写入、terminal 失败回滚、运行态不确认回滚、回滚核验失败则关闸。UI 测试覆盖 PATCH 的回滚 / 恢复文案 | 见缺陷 1。其余故障阶段见下方 blocked |
| V16 | not_run | 无直接断言「行策略变更后 policyVersion 与运行态一起变、无需重启」 | Role 分支；R1 模板分支不在本次 |
| V19 | passed_automation | `row-policy-d03-uppercase.test.ts` 与 catalog 测试在 mock 的大小写敏感读文件上断言：`BIDM.yaml` 能绑定合法列 | 不是客户 Linux 文件系统上的 UAT。台账仍为 open |
| V20 | not_run | 函数级测试断言了 resolve / read / 非法 YAML 的 parse，以及注入 `schemaManifestCatalogProven: false` 的 capability_unknown | §14.6 要求走 Admin 预览或保存 API。结构非法那条测试同时接受 `catalog` 与 `parse`，没有锁死合同规定的 parse。能力未知是函数参数注入 |
| V21 | passed_automation | catalog 测试：目录可靠装载时，缺字段为 `row_policy_field_unknown`，四元组完整，且不发放授权 | 显式合法零列目录没有对应用例 |
| V22 | passed_automation | D-03 测试：大写 schema 上预览 `effectiveRowGrant` 与 `compileScopedRowGrant` 的 `forced_filters` payload 相等 | 比较的是全局并集与编译函数，不是 §14.5 的逐 Agent FinalRows 对运行时注入。不是 UAT，也不关闭 D-03 |
| C14 | failed | PATCH / CREATE / COPY 在共享窗口内重读并调用 `verifyRowPolicyPreviewConfirmation`；预览仅在全部表成功时签发 confirmation | 缺陷 1、缺陷 3 |
| C15 | failed | 内存闸先于 marker；marker 用同目录临时文件 + rename；ENOENT 以外的不可读 / 损坏会关闸；写入口调用 `readAccessRecoveryState` | 缺陷 2。全阶段故障注入未做 |
| C16 | failed | `accessWriteResponseBody` 对 committed / rolled_back / recovery_required 的 HTTP 与 `written` 有实现；RoleDetail 的保存只在 `committed` 显示成功，对应 UI 测试通过 | 缺陷 1：DELETE 没有走这套信封 |
| C17 | failed | `resolveSchemaManifestCatalogCapability` 缺省、无 driver、未注册连接、不支持的 driver 均为 `unknown`；预览与装载走同一服务端解析 | 缺陷 5。经 Admin API 制造 `unknown` 的证据没有 |
| C18 | not_run | 代码在 schema 路径上把形状非法归 parse、目标表缺失与重复列名归 catalog；本次没有测试直接断言重复列名、缺 `columns` 或合法零列 | 结构非法那条现有测试同时接受 `catalog` 与 `parse`，不能算直接断言 |
| C19 | not_run | 正式验收未执行 | 见 blocked |

## 缺陷

### 1. implementation_bug — Role 删除未接入确认与三态

条款：§14.2.1（能改变行级策略或其影响面的 Role 写入口必须消费确认，不得靠另一个入口绕过）；§14.3.2 与 C16（`recovery_required` 为 HTTP 503、`ok: false`、`written: false`、`ACCESS_RECOVERY_REQUIRED`；回滚不得 `ok: true` / `written: true`）。

位置：`webui/server/admin/roles.ts`。

- `roleCarriesRowPolicy`（约 790–796 行）只被 CREATE / PATCH / COPY 使用。
- DELETE（约 1532–1681 行）不读取 `rowPolicyConfirmation`，删除带 `row_access: scoped` 或 `row_policy` 的未使用 Role 时直接写配置。在用 Role 会被 `ROLE_IN_USE` 拦住，所以这条放不宽某个 Agent 的行集，但会改变全局并集，仍是合同里的影响面。
- 约 1663–1681 行：只有 `rolledBack === true` 才返回失败。`recovery_required` 不设 `rolledBack`，于是落到 `ok: true`、`data.written: true`，HTTP 200，且没有 `status: "recovery_required"`。
- 回滚分支用的是 `ROLE_DELETE_ROLLED_BACK`，没有 `written: false`、`recoveryRequired: false`、`terminalAudit`。

`RoleDetail.tsx` 删除成功回调（约 656 行）会把响应当 `AccessWriteAck`。`recovery_required` 的 `runtimeAck` 为 false，当前 UI 多半显示「runtime 未确认」，而不是「已删除」。这仍然不是合同文案；只看 `ok` / `written` 的客户端会把删除当成已提交。

### 2. implementation_bug — 原配置缺失时回滚证明被跳过

条款：§14.3.1「原配置不存在时也必须证明运行态回到对应空基线，不得直接视为成功。」

位置：`webui/server/admin/access-config.ts`。

- 约 333–337 行：`readFile` 的任何失败（含权限错误，不只是 ENOENT）都把 `previousRaw` 当成不存在。
- 约 485–488 行：没有旧字节时，回滚改为删除当前文件。
- 约 504–507 行：`recoveryPoint.raw === undefined` 时 `rollbackVerified` 直接为 true，不比较运行态 digest 与空基线。

后果：读失败或首次没有 `access.yaml` 时，失败路径可以报告 `rolled_back`，而运行态并未被证明回到空基线。若原文件其实存在只是读失败，回滚还会删掉新写入的文件并宣称已恢复。

### 3. implementation_bug — 目录缓存使编译输入不是新读

条款：§14.2.2 `readCompilerInputsFresh`；§14.2.1 编译输入摘要必须覆盖 Manifest 与 overlay 的实际内容，只记路径不够。

位置：`webui/server/proxy/row-policy-catalog.ts` 约 244–247 行与 756–766 行。`catalogCache` 按连接 / 表 / schema 缓存整份装载结果，生产路径没有按 mtime 或内容失效（只有测试用的 `resetRowPolicyCatalogCacheForTests`）。

预览与保存共用这份缓存，所以两者彼此一致，但都可能不是磁盘当前内容。Manifest 被改写后，`compileInputsDigest` 可以不变，V13 的「编译输入变化则在 intent 前拒绝」不会发生；已删除的列仍可能被当成存在。这是失败打开。

### 4. implementation_bug — 逐 Agent 预览缺键时回退全局并集

条款：§14.5。Agent 的 FinalRows 只能来自该 Agent 的实际 Role Set；没有任何允许该表的 Role 时失败关闭，不回退全局并集或全部行。

位置：`webui/server/proxy/row-policy-preview.ts` 约 117–138 行。`effective` 是全体授予该表的 Role 的 OR。`lookupFinalRows(..., effective)` 在 `finalRowsBySource` 没有该表键时返回这个全局并集。

键存在时，现有 V10 测试是对的，所以该文件仍是绿的。键缺失时，无关 Role 的分支会进入该 Agent 的预览，并可能据此签发确认。运行时热路径把 fallback 设成该 capability 自己的 `rowGrant`（`acl.ts` 约 3004 行），与预览 fallback 不是同一个值。

### 5. implementation_bug — 能力夹具可以强制 proven

条款：§14.4.1。只有适配器 / 部署合同明确支持从 Schema Manifest 建目录时才可返回 `proven`。夹具被授权的是制造 `unknown`。缺省、未传参、客户端自报不得为 `proven`。

位置：`webui/server/proxy/row-policy-capability.ts` 约 90–101 行与 150–159 行。`LUCY_ROW_POLICY_CATALOG_CAPABILITY=proven` 或 `proven:<connectionId>` 在 driver 检查之前返回 `proven`，不支持的 driver 也会被标成已证明。

未设置该环境变量时，缺省路径仍然不是 proven。偏差只在夹具被打开时出现。

## 规格漂移

不新增要求。下面只是已决状态 / 已落地行为与正文互相矛盾。D-03 台账 `status: open`、`fixedIn: null`、`verifiedBy: []` 与台账注释里的取证规则一致，不记为漂移，本报告也不建议改成 fixed。

### 状态行仍写 C14–C18 未实施

已决回写是 Spec §14.7 与计划 §5.4：C14–C18 已完成代码实施和实现后静态复审，C19 与 V 项未执行。

仍写「待实施 / 本次不是代码修复」的位置：

- Spec 文首状态行（约第 8 行）：C14–C18 待实施
- Spec 约第 17 行、§14.1 约第 774 行：本节不是代码修复记录
- Spec §14.8 约第 1029 行：C14–C18 仍待代码实施
- 计划文首注意（约第 20 行）仍写保存确认与恢复缺口待实施
- 计划 §5.5 约第 241 行：C14–C18 继续作为待实施项

计划文首表格（约第 10 行）和 §5.4 表已经改成「已实施」。同一份计划里两套状态并存。

### §14.4 伪代码仍写 v0.25 不修 D-03

已落地行为：`webui/server/proxy/row-policy-catalog.ts` 的 `resolveManifestFilePath`（约 289–304 行）按磁盘真实文件名做大小写不敏感匹配，并返回真实文件名。`docs/qa/security-findings.yaml` 的 D-03 注释写明该修复于 2026-10-28 落在 `lucy-v0.25`。本次 D-03 测试通过。

仍写「本线不修 / 只等 0.20.Z」的位置：

- Spec §5.5 约第 425 行
- Spec §9 的 V19 / V22 行（约第 510–513 行）
- Spec §11 D7（约第 541 行）
- Spec §14.4.1 伪代码注释（约第 935 行）：`v0.25 不修 D-03 大小写`
- Spec §14.6 约第 995 行、§14.7 约第 1020 行
- 计划 §5.3 约第 213 行、§5.4 依赖边界约第 228 行

这些句子与已落地代码矛盾。它们不构成「还要把修复撤掉」的要求。

## blocked / not_run

blocked（本环境做不到的故障注入，不计通过）：

- V15 的完整故障矩阵：原子写失败、首次 commit reject、committed terminal 失败之后的各恢复子步骤、恢复 marker 不可写、进程重启后靠 marker / 未终结 intent 保守关闭、只经核验解锁。`performVerifiedRecoveryClear` 没有产品路由调用方，本次不能演示解锁。
- V20 的产品入口：用服务端夹具制造 `unknown`，再经 Admin 预览或保存 API 取证。本次没有起服务做这条，也没有改环境变量去打现网。
- V19 / V22 的客户大小写敏感文件系统。本机是 macOS；通过的是 mock。这不等于客户 Linux 上的集成回归，也不填 `verifiedBy`。

not_run：V11、V12、V13、V16、V20（作为 §14.6 产品入口）、C19，以及 V08/V09/V21 备注里写明的缺口。

## 一轮修复建议

只修已决合同的落地偏差，不扩大 R1/R3，不改权限代数，不关闭 D-03 台账。

1. DELETE 与 PATCH 使用同一 `accessWriteResponseBody`。`recovery_required` 必须是 503 且 `written: false`。带行策略表面的删除在写入前走 `verifyRowPolicyPreviewConfirmation`，拒绝发生在 intent 之前。
2. 读不到旧 `access.yaml` 时区分 ENOENT 与其他 I/O。没有旧文件时，回滚后必须证明运行态 digest 等于空基线；证明不了就 `closeForRecovery`，不能把 `rollbackVerified` 设成 true。
3. 预览与保存使用的目录装载必须反映当前 Manifest / overlay 内容。进程缓存需要按内容或文件版本失效，或在发布窗口内绕过缓存，使 `compileInputsDigest` 能发现内容变化。
4. `computeFinalRowsForTable` 在逐 Agent 的 `finalRowsBySource` 缺键时失败关闭，不要把全局 OR 当作 fallback。
5. `LUCY_ROW_POLICY_CATALOG_CAPABILITY` 只保留制造 `unknown` 的夹具。`proven` 仍必须经过已注册连接和适配器合同。
6. 文档只改状态句和 §14.4.1 那句「不修 D-03」：C14–C18 改为已实施、未验收；D-03 改为本分支已有大小写不敏感解析，台账仍 open，直到 release evidence。不要把 V01–V22 改成已执行。
