# 概念注册表接入 Lucy Ops 控制面 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v0.5** |
| 日期 / 目标版本 | 2026-11-09 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无 |
| 状态 | **v0.5；R2-F＋R3（O1＝A／O2＝B）＋R4 已闭合（2026-11-09）；实现中（Cursor）；未宣称可上线**（P1-11／REQ-030-032）。本条不表示可上线 |
| 授权边界 | **R4 已授予（2026-11-09）**。按 Plan S1–S7 改运行代码；**不含**本版 WebUI；**不含**问数热路径注入 |
| 验收 | 见 §7 SC-01–SC-18；本条总出口＝Ops 控制面可完成概念 scan／人审写／只读盘点，且不改变业务问数热路径 |
| 需求来源 | [REQ-030-032](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；委托人 2026-11-09：运维＝配置治理；正式立项并进 Lucy Ops；本版 Ops 检查完毕、下版再评估 WebUI |
| 清单条目 | **P1-11**（跟进 [P1-10／REQ-030-031](lucy-20261108-concept-registry-ontology-lite-spec.md)） |
| 实施主体 | Lucy：复用 `scripts/concepts/**` 纯计算核心＋Proxy／ops 控制面编排；**不改 KTX 源码** |
| 相关 Spec | [概念注册表一期](lucy-20261108-concept-registry-ontology-lite-spec.md)；[运维控制面 L25-16](lucy-20261028-v0p25-lucy-ops-control-plane-spec.md) |
| 评审记录 | [Codex 对抗](../reviews/2026-11-09-concept-registry-lucy-ops-control-plane-codex-review.md)（过程对抗） |

## 闭口层级

- 层级：功能合同
- 本条承诺：运维人员经 **Lucy Ops MCP（`lucy_ops_*`）** 完成概念注册表的扫描与人审写（定权威／reject／summary），鉴权与审计走控制面；客户长期交付**不再依赖**独立 CLI。
- 本条出口：§7 SC-01–SC-18。
- 不在本条出口：业务问数 MCP 注入 canonical；自动改 `lucy_query`／选表／口径绑定；**本版 WebUI「概念权威」页**（下版，D2b）；W-B 语义发布；把概念工具塞进 `lucy_ops_reader` 问数 Role。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Concept Ops Tools：中文主称「概念运维工具」。`lucy_ops_concept_*` 控制面工具族，用于概念注册表治理，不是业务问数工具。
- （复用 P1-10）Concept／Concept Registry／Binding／Canonical Binding／Conflict——术语标准 §4.16。

Forbidden terms:

- 把本条写成「业务问答增强」或「问数运维」。
- 把 `lucy_ops_reader`（运维问数角色）与本条控制面写权限混称。
- 把机器 `confidence` 写成「权威」。

## 交互合同豁免

- 原因：本条交付面为 Lucy Ops MCP 控制面工具，不改变用户可见 WebUI 表面
- 不改变：无新路由、无导航、无浏览器人审页、无人审浏览器 API

## 1. 背景与判断

### 1.1 问题

P1-10 一期 CLI 已可试点，但独立 CLI 对客户运维过重；运维主线是**配置治理**。Lucy Ops 已是可编程配置通道，概念权威应同族。

### 1.2 产品裁定

| 编号 | 决策 | 说明 |
|---|---|---|
| D1 | **主交付面＝Lucy Ops MCP**；CLI＝共享库＋急救 | — |
| D2 | **路径 A**：Ops 可作首发可编程面（无 WebUI） | 豁免 L25-16「必先 WebUI」字面 |
| D2b | 本版 Ops 检查完毕；**下版**再评估 WebUI | 友好折衷；WebUI 非本条出口 |
| D3 | 用户模型＝配置运维 ≠ 问数 | 禁止并进问答 Token／`lucy_ops_reader` |
| D4 | **写工具一律 preview→commit**（O1＝A） | 对齐 L25-16 §4.1；无直写旁路 |
| D5 | scan 只产 candidate；人审升权威 | 继承 P1-10 |
| D6 | 不改问数热路径；不自动注入 canonical | — |
| D7 | **单一纯计算核心**；服务适配禁止另写匹配／合并／权威规则 | — |
| D8 | 不依赖 W-B | — |
| D9 | R4 前置：效果门通过或委托人书面跳过（O2） | **O2＝B（2026-11-09）**：书面跳过效果门，允许在获 R4 后开工；**≠** R4 本身；**≠** P1-10 效果门已通过 |
| D10 | 日后 WebUI 行为须等价本控制面 | — |
| D11 | **项目根**仅来自 Proxy 可信 `projectRoot`；请求**禁止**携带／覆盖 project／content 根 | 闭合 F-03 |
| D12 | **内容根**按 P1-10 D13，相对路径相对 `projectRoot`；解析失败／不可读 → 失败关闭（**不得**用 `paths.ts` 软回落冒充成功） | 闭合 F-03 |
| D13 | 写类复用现行 Ops **计划行／digest／claim／幂等／审计生命周期**；preview **可**持久化控制面计划，**不得**写 `concepts/`／semantic／wiki 业务文件 | 闭合 F-01／F-06／F-07 |
| D14 | scan 提交＝**单一 ops 组**含本批全部 concept 目标；`batch_all_or_nothing`；禁止按文件拆成可部分成功的多组 | 闭合 F-02／R2 |
| D15 | 只读工具（list／show／summary）**不**走 preview/commit 计划；不要求幂等键；**不**创建 `concepts/` | 闭合 F-04 |
| D16 | commit **执行持久化计划载荷**（不重算拟写结果）；请求参数与计划规范化比较；成功重放：**先查幂等记录，再对未执行目标做基线比较** | 闭合 F-01／R2 |
| D17 | 写路径顺序固定为现行 `runOpsCommit`：claim（pending）→ 效果阶段 → verify → 审计终结；适配器须提供 execute／rollback／verify | 闭合 F-07／R2 |
| D18 | 共享 store **补齐 P1-10 D20**：`conceptsDir` 与目标文件 `realpath` 围栏；symlink 拒绝；CLI 与服务共用 | 闭合 F-R2-02 |
| D19 | 业务结果与 MCP：`envelope.ok` 表示协议受理；业务成败看 `operation_state`／`per_target`；**不确定效果**走恢复态，不得伪造成「无效果失败」 | 闭合 F-R2-01 |
| D20 | 幂等成功重放：须先绑定持久计划并核验 actor／digest／请求一致性／授权后，才返回先前成功结果；非成功记录不得当成功重放 | 闭合 F-01／R3 |
| D21 | 组进位中断：计划须持久化可恢复前像字节（或 ABSENT）与进位凭据；未收敛前 list／show／scan／裁定 **阻断**该写集概念（稳定 `ops_concept_recovering`）；恢复＝整组回滚到前像或整组核验成功 | 闭合 F-02／R3 |
| D22 | scan 范围：默认服务器登记白名单 `scripts/concepts/seed-whitelist.yaml`（`whitelist_ref` 仅允许预登记 id，禁止任意路径）；preview 计算完整目标集写入计划；commit **只**执行计划内完整单组，**拒绝**请求覆盖／缩减目标集 | 闭合 F-04／R3 |
| D23 | 正常提交路径：概念 adapter 的 `executeGroup` 在同一锁内完成后像核验与效果阶段记录后才返回成功；`verifyGroup` 专用于崩溃恢复。核验失败／未知 → 不得写成功终结审计 | 闭合 F-07／R3 |

---

## 2. 范围

### 2.1 工具登记（Normative）

| name | write | managedAssetKinds | connectionScoped | ownerOnly | atomicity |
|---|---|---|---|---|---|
| `lucy_ops_concept_list` | false | `governance` | false | false | n/a |
| `lucy_ops_concept_show` | false | `governance` | false | false | n/a |
| `lucy_ops_concept_summary` | false | `governance` | false | false | n/a |
| `lucy_ops_concept_scan` | true | `governance` | false | false | `batch_all_or_nothing` |
| `lucy_ops_concept_set_canonical` | true | `governance` | false | false | `batch_all_or_nothing` |
| `lucy_ops_concept_reject` | true | `governance` | false | false | `batch_all_or_nothing` |

说明：`governance` 表示概念权威属配置治理面（不新增 OpsAssetKind 枚举）；scan **只读** semantic／wiki 文件，写集仅 `concepts/*.yaml`。

### 2.2 包括／不包括

包括：上表工具；`allow.ops` 显式授予；控制面审计；复用 P1-10 纯计算核心；CLI 保留为库／急救。

不包括：本版 WebUI；问数注入；改 W-A／W-B 既有工具语义；形式化 KG。

---

## 3. 与既有能力关系

| 能力 | 关系 |
|---|---|
| P1-10 | 数据模型／匹配／不变量上游；本条换通道并补纯计算导出 |
| L25-16 | 复用分类、`allow.ops`、计划／digest／claim／审计；新增工具 |
| 业务问答 MCP | 正交 |
| `lucy_ops_reader` | 问数平面；**默认无**本条写／读概念工具 |

---

## 4. 授权、计划、审计（Normative）

### 4.1 授权

1. `ToolClass=ControlPlane`；可见性仅 `allow.ops`（先于 `lucy_`）。
2. `ops.tools` 禁止 `*`。
3. `deny_tools` 仍生效。
4. 逐条 grant：`tools` 含目标工具名；`asset_kinds` 覆盖 `governance`；`instance_scope=read_only` 不得用于写工具。
5. 示例 grant（写）：

```yaml
allow:
  ops:
    - tools: [lucy_ops_concept_scan, lucy_ops_concept_set_canonical, lucy_ops_concept_reject, lucy_ops_concept_list, lucy_ops_concept_show, lucy_ops_concept_summary]
      asset_kinds: [governance]
```

6. 混合角色：仅当存在**完整匹配**的 ops grant 时放行；不得按角色名（含含 ops 字样）一刀切。

### 4.2 写工具两段式（O1＝A）

复用 `ops-batch`／`runOpsCommit`：

- **调用参数映射（与现行 ops-tools 对齐）**：`dry_run=true`⇒preview；commit 传 `plan_id`＋`confirm_digest`＋`idempotency_key`（禁止另造 `mode/digest` 平行字段，除非薄别名且同义）。
- preview：授权 → 解析根 → **纯计算**拟写集（单组 targets）→ `savePlanRow`（控制面库）→ **不写**业务文件。
- commit：载入 `plan_id` → 校验 actor／tool／`confirm_digest`／**请求参数 vs 计划载荷** → 重新授权 → 若幂等键已绑定**同一计划且终态 succeeded**：在通过上述核验后复用结果（D20；**不**跳过归属／参数核验）→ 否则 **claim(pending)** → 对未执行目标：取锁→重读前像→比较 → `executeGroup`（内含后像核验，D23）→ 审计终结。
- digest／计划载荷至少含：actor、tool、projectRoot、contentRoot、目标 ID 集合、各目标**可恢复前像字节或 ABSENT**、拟写后指纹、summary／bindingId（若适用）、进位凭据槽位。
- 参数替换、他人计划、授权撤销、基线漂移、过期计划 → 稳定 `ops_*` 拒绝码。

### 4.3 scan 多文件原子协议（D14／D21／D22）

- 白名单：默认内置 seed；`whitelist_ref`∈预登记表，禁止客户端路径。
- 一次 scan＝**恰好一个** ops 组；preview 把完整目标集写入计划；commit 执行该完整集合，拒绝目标覆盖参数。
- execute：staging → 全成功再 rename 进位；同步写下可恢复前像／凭据；任一步失败 → rollback。
- 进程中断致混合前后像：重启后该写集概念对 list／show／scan／裁定返回 `ops_concept_recovering`，直至整组回滚完成或 verify 成功（D21）。
- 空写集：**拒绝空计划**（与现行 ops-batch 一致）。

### 4.4 只读工具

list／show／summary：授权后直接纯读；无计划／无幂等键；目录不存在 → 空；show 缺 id → 稳定 not_found（非 ok 业务码，不建目录）。

### 4.5 审计与信封（D17／D19）

- 顺序：claim → 效果 → verify → 终结审计（不得先写业务再 claim）。
- target 身份：`concept:<id>`；裁定类附加 `binding:<bindingId>`。
- MCP：`isError` 仅反映协议／授权／校验失败；组业务失败时顶层可 `ok` 但 `operation_state=failed`／`per_target` 标明；SC 断言必须读这些字段，不得只看布尔 `ok`。

### 4.6 六工具输入／输出（摘要 Normative）

| 工具 | 主要输入 | 主要输出 |
|---|---|---|
| list | （无） | `concepts[]`：id／canonical／conflicts_status／counts |
| show | `concept_id` | 富概念＋conflicts；缺省 → `ops_concept_not_found` |
| summary | （无）或 `concept_id` | totals 或单概念摘要 |
| scan | `dry_run`／commit 三元组；可选 `whitelist_ref` | preview：`plan_id`／digest／targets；commit：operation 摘要 |
| set_canonical | `concept_id`／`binding_id`／`summary`＋两段式字段 | 同上；缺 summary → 校验失败 |
| reject | `concept_id`／`binding_id`＋两段式字段 | 同上 |

完整 JSON schema 落实现 PR；本表为验收最小字段集。

---

## 5. 核心流程（伪代码）

```
function resolveRoots(proxyProjectRoot):
  reject if args contain project/content root overrides
  contentRoot = D13(projectRoot); realpath fence conceptsDir (D18)
  fail_closed if unreadable

function commitViaOpsBatch(actor, tool, planRow, requestArgs):
  // D16/D20/D23 — execute persisted plan only; never trust client recomputation
  assertRequestMatchesPlan(requestArgs, planRow)
  assertConfirmDigest(requestArgs.confirm_digest, planRow)
  reauthorize(actor, tool, planRow.targets)
  prior = lookupIdempotency(requestArgs.idempotency_key)
  if prior.boundTo(planRow) and prior.state == succeeded:
    return prior.result  // only after checks above
  if prior.exists and prior.state != succeeded:
    return dispatchRecoveryOrRetry(prior)
  return runOpsCommit(planRow, adapter={
    executeGroup: (g) => { applyStagingRename(g); assertAfterImages(g); recordEffectPhase(g) },
    rollback: restoreBeforeImagesFromPlan,
    verifyGroup: verifyOnDiskMatchesPlan  // crash recovery only
  })

function opsConceptScan(actor, args):
  requireAllowOps(scan)
  roots = resolveRoots(proxy.projectRoot)
  whitelist = resolveWhitelistRef(args.whitelist_ref)  // D22; default seed
  if args.dry_run != false:
    payload = purePlanScan(roots.contentRoot, whitelist)
    if payload.targets.empty: reject empty plan
    return saveOpsPlan(...)  // stores recoverable before-images
  // commit ignores client target overrides; uses plan targets only
  return commitViaOpsBatch(actor, scan, loadPlan(args.plan_id), args)

function opsConceptSetCanonical(actor, args):
  requireAllowOps(...)
  // preview builds plan from pureSetCanonical; commit executes plan payload only
  ...

function opsConceptList(...):
  requireAllowOps(list); return pureList(roots)  // no mkdir
```

共享层：导出 pure plan／apply；**S1 必须**给 store 补 symlink／realpath 围栏后再接服务。

---

## 6. 交付分期

| 阶段 | 内容 | 进入条件 |
|---|---|---|
| 立项 | Spec／Plan | 已完成 |
| 评审 | R1→R2→R2-F→R3 | §2.2 |
| 本版实现 | R4 后落地 Ops | O2＝B 已跳过效果门；**仍须 R4** |
| 下版 WebUI | 另 Spec | Ops 检查完毕后 |

---

## 7. 成功标准

| 编号 | 标准 |
|---|---|
| SC-01 | 有效 ops grant 可调授权工具；无 grant 不可见／不可调 |
| SC-02 | set_canonical 无 summary／非法 bindingId → 非 ok；磁盘不变 |
| SC-03 | 人设 canonical＋summary 后再 scan：指针／role／summary 不变；仅 evidence 可追加 |
| SC-04 | reject 后再 scan 同 ref 不复活为 candidate |
| SC-05 | 仅问答 Token（无 allow.ops）不可调任何 concept 工具 |
| SC-06 | 默认 `lucy_ops_reader` 不可调概念写工具；亦不可因角色名含 ops 而放行 |
| SC-07 | **确认无效果**的失败：写集字节／ABSENT 相对前像不变，且 `operation_state`／`per_target` 标明失败（不要求 MCP `isError`）；**恢复中／效果未知**不得伪造成无效果失败 |
| SC-08 | 审计顺序满足 claim→效果→verify→终结；可区分 scan／set_canonical／reject |
| SC-09 | 固定 `CONCEPT_OPS_DIFF_BASE`＋本条归属差分；同一夹具比较（基线实现 vs 候选）且（概念资产变更前 vs 后）：选表／口径绑定／查询参数／SQL 不变 |
| SC-10 | 无新增 WebUI 路由／导航／浏览器人审 API |
| SC-11 | 经**服务适配器**调用的结果与直接调纯计算核心的规范化持久化对象／冲突一致（对照夹具，至少：未定权威扫描、空白 summary、reject 再命中、切换 canonical、零命中、degraded） |
| SC-12 | preview **不写** concepts／semantic／wiki；commit 无有效 digest／基线漂移 → 不写业务文件（允许已有控制面计划行） |
| SC-13 | 六工具在 known_tools＋CONTROL_PLANE_TOOLS；ops.tools 禁 `*` |
| SC-14 | 交付文档以 Ops 为主；CLI 标急救 |
| SC-15 | 并发：A preview 后 B 改权威，A 携旧 digest commit → 拒绝 |
| SC-16 | 只读 list／show／summary 无 concepts 目录时返回空且不创建目录 |
| SC-17 | 客户端传入 project／content 根字段被忽略或拒绝；解析仅信 Proxy projectRoot＋D12 |
| SC-18 | read_only instance_scope grant 不能 commit 任何写工具 |
| SC-19 | conceptsDir 或目标为 symlink／realpath 逃逸 → 拒绝；根外文件字节不变 |
| SC-20 | 参数与计划不一致 → 拒绝；成功重放须先通过归属／digest／参数／授权核验后才返回；换 summary 不得命中旧成功 |
| SC-21 | 半进位中断后：受影响概念读写返回 recovering，直至整组回滚或核验成功；根外与未在写集内文件不变 |
| SC-22 | `executeGroup` 后像核验失败 → 不得 committed；恢复路径走 `verifyGroup` |

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 未过效果门铺 Ops | D9／O2 |
| 双实现漂移 | D7／SC-11 |
| digest 竞态 | D13／SC-15 |
| 与问数 Role 混淆 | D3／SC-05／06／18 |

---

## 9. 开工前必答（R3）

| 编号 | 问题 | 裁定 |
|---|---|---|
| O1 | 写操作是否强制 preview→commit？ | **A（已定，2026-11-09 文档闭合）**：scan／set_canonical／reject 一律两段式 |
| O2 | 效果门未完成时可否 R4？ | **B（2026-11-09 委托人裁定）**：书面跳过效果门；获 R4 后可开工。**不**表示 P1-10 效果门已通过 |
