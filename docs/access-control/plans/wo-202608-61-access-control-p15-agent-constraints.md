# WO-202608-61 访问权限 AC-P1.5 Agent Constraints 可交付实现计划

| 元数据 | 内容 |
|---|---|
| 文档名称 | 访问权限 AC-P1.5 Agent Constraints 可交付实现计划 |
| 文档类型 | Plan |
| 版本 | v1.7 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `docs/access-control/design-upgrade.md` **v1.1.2**（ADR-AC-03 D2 / S4）；WO-60 AC-P1 Gate C 已交付；Spec 99 / ADR 上游强制谓词；开波锁定「人级收紧 = Agent Constraints AND」；Gate A 口径修订（范围/O-P15 → 授权 WP-S0） |
| 适用范围 | AC-P1.5 **Agent Constraints Spec + 实现拆解**；复用 AC-P1 强制谓词载体；**默认不含** TokenScope 收紧（见 §0.2 O-P15-1）；**Gate A 批准范围与 O-P15 默认后**方可写 Spec（WP-S0）；**Gate B 通过前禁止改 runtime** |
| 输出位置 | `docs/access-control/plans/wo-202608-61-access-control-p15-agent-constraints.md` |

---

## 0. 执行状态与闸门

| 阶段 | 状态 | 说明 |
|---|---|---|
| AC-P1 Gate C | **DONE** | WO-60；Row Policy / EffectiveRowGrant OR / 强制谓词已交付 |
| 本 WO 开波落盘 | **DONE（2026-08-09）** | 本文 |
| **Gate A：批准 WO 范围与 O-P15 默认** | **DONE（2026-08-09）** | 授权 **WP-S0 写 Spec**；**不授权** runtime；不把「Spec 草稿可评审」当作 Gate A |
| WP-S0 Agent Constraints Runtime Spec | **DONE（v0.1.1；Gate B 已批准）** | [`webui/docs/100-access-control-p15-agent-constraints-spec.md`](../../../webui/docs/100-access-control-p15-agent-constraints-spec.md)；digest 保留值；DNF 臂剪枝 |
| WP-S1 契约补丁（07/14/15/99 + 术语 + lint 口径） | **DONE（Gate B 已联签）** | Spec 07 v1.6 / 14 v0.4 / 15 v0.4；术语 v0.3.1；Spec 99 指针 |
| **Gate B：AC-P1.5 Spec（Spec 100）评审通过** | **DONE（2026-08-09）** | xingchen 产品/工程联签；**授权 WP-I\* runtime** |
| WP-I1 编译 Agent constraints | **DONE（测绿）** | `agent-constraints.ts` + acl 接入 + lint 翻转；SC-P15-03/04/09 |
| **WP-I2 FinalRows AND 合成** | **DONE（测绿）** | DNF 剪枝 + FinalRowsDigest + `finalRowsBySource` 闸门/explain；SC-P15-01/02/09 |
| **WP-I3 闸门与强制谓词注入复用** | **DONE（测绿）** | SC-P15-05/06：`row_access:all`+Constraints→FinalRows≠TRUE 复用 P1 wrap/proven/`forced_filters`；BY-05 Constraints 剥离用户伪造；**无 runtime 缺口**（I2 已覆盖） |
| **WP-I4 Agent Admin Constraints** | **DONE（测绿）** | PATCH 读写/`null` 清除 `constraints` + dryRun FinalRows preview + UI 编辑器 + `runtimeAck===true`；Role Admin 仍拒绝 constraints |
| **WP-I5 SEC / UAT / Runbook / Release** | **DONE（工程）** | AC-SEC-CONSTRAINT；[`uat-ac-p15.md`](../uat-ac-p15.md)；Runbook 路径 D；[`release-notes-ac-p15.md`](../release-notes-ac-p15.md)；§6 全路径上限 |
| **Gate C：AC-SEC-CONSTRAINT + UAT 签字** | **DONE（2026-08-09）** | xingchen 批准；总签 `inbox/20260809-ac-p15-gate-c-signoff.md`；域 README 已标「AC-P1.5 已交付」 |

**冲突裁决：** 实现与 Spec 冲突 → Spec；Spec 与 `design-upgrade.md` 冲突 → **design-upgrade**，并回修 Spec。  
**禁止依据：** `feasibility-row-acl.SUPERSEDED.md` 不得作为实施或 Spec 事实源。  
**复用前提：** 上游强制谓词契约以 [`adr-upstream-forced-predicate.md`](../adr-upstream-forced-predicate.md) 为准；本波**不重开**载体选型，只扩展 `FinalRows` 合成输入。

### 0.1 闸门口径（Normative）

```text
Gate A — 批准本 WO 范围 + §0.2 O-P15 默认决策
  → 允许 WP-S0（写 Spec 100）与 WP-S1 草稿
  → 禁止改 runtime
  → Gate A ≠ Spec 评审

Gate B — Spec 100 评审通过（含代数展开 / 规模上限 / SC-P15-*）
  → 允许 WP-I1…I5
  → 禁止声称 Dynamic RLS /（默认）TokenScope 已交付

Gate C — 实现 + AC-SEC-CONSTRAINT + UAT/Runbook
  → 域 README「AC-P1.5 已交付」
```

### 0.2 已锁定决策（Gate A：范围与默认）

| ID | 决策 |
|---|---|
| D2 | 行授予跨 Role **OR**；人级收紧**必须**走 Agent Constraints（AND），禁止 Role 间隐式 AND |
| 挂载点 | `constraints` **仅**挂在 Agent（`users[]`）；Role 上出现 `constraints` → **仍 lint/compile fail** |
| 代数（产品层） | `FinalRows = EffectiveRowGrant AND AgentConstraints`（无 constraints → Constraints≡TRUE，行为与 AC-P1 一致）；**规范化 / 上限 / 矛盾口径以 Spec 100 §5–§6 为准** |
| op | 初版与 Row Policy 对齐：仅 `eq` \| `in`（继承 ADR-AC-05 / D9）；`ne`/范围 op 不在本波 |
| 载体 | 非 TRUE 的 `FinalRows` 仍走 AC-P1 ForcedPredicateAST → `forced_filters`；未证明 → `row_policy_upstream_unproven`；O2 fail-closed 不变 |
| 静默 | **禁止**静默忽略非法 / 半合法 `constraints`；编译失败或明确拒绝 |
| 边界 | 本波交付 Agent Constraints；**不含** Dynamic RLS / Active Role / CLS / DB 原生 RLS |
| O-P15-1 | **TokenScope 本波不交付**；`TokenScope ≡ TRUE`；另立 WO / AC-P2+ |
| O-P15-2 | `constraints` schema：按 source 绑定映射到 **与 `row_policy` 同构**的 predicates（`eq`/`in`）；全局「一刀切」若做须显式枚举或显式 `*` 语义并 fail-closed（细节 WP-S0 钉死） |
| O-P15-3 | Constraints **不可**引用 Agent 无 capability 的源 → 编译失败 |
| O-P15-4 | `EffectiveRowGrant = TRUE` 且存在 Constraints → `FinalRows = AgentConstraints`（非 TRUE）→ 强制谓词路径 |
| O-P15-5 | Agent Admin 提供 Constraints 编辑 / dryRun / preview；Role Admin **不**提供 |
| O-P15-6 | **FinalRows 相交表示与规模上限必须由 Spec 钉死**（见 §0.3）；禁止实现期隐式选择 |

### 0.3 WP-S0 必钉：FinalRows AND 代数展开与规模上限（已落入 Spec 100）

> Gate A 锁定「OR ∧ AND」产品语义；**规范化形态、digest、精确上限、矛盾口径**已由 Spec 100 写死，作为 **Gate B** 评审硬项。

| 主题 | Spec 100 锚点 | 已钉死取值 |
|---|---|---|
| 相交语义 / DNF | §5.2 | `∨_i (R_i ∧ C)`；编译期物化；吸收律 |
| digest | §8 | NormLeaf / NormDnf → sha256 hex[:16] |
| 精确上限 | §6 | role arms **16**；constraint preds **16**；preds/arm **32**；DNF arms **64**；total preds **512** |
| 超限 | §6 / §9.6 | **compile fail** `final_rows_limit_exceeded` |
| digest 值语义 | §8.1 | `sourceName`/`field` identNorm；**value/values 保留 JSON 标量原值**（禁 string lowerTrim） |
| 矛盾 / 空集 | §5.4 / §9.4–9.5b | 部分臂不可满足 → **剪枝**；剩余空 / `C` 不可满足 → **compile fail**；不采用 empty predicate 成功编译 |
| Role constraints / TokenScope | §2 / §3.3 | Role **forbidden**；TokenScope **Non-Goal**（≡TRUE） |

---

## 1. 目标与成功标准

### 1.1 目标（AC-P1.5）

在 **AC-P1 Row Policy / 强制谓词已交付** 的前提下，交付：

1. **Agent `constraints`**：合法结构化配置；编译为 `AgentConstraints(sourceKey)`。
2. **FinalRows AND 合成**：`EffectiveRowGrant AND AgentConstraints`（规范化形态与上限见 §0.3）；闭合 design-upgrade 例（两 Role OR 为 TRUE 时仍可被人级约束收紧到 ABC）。
3. **强制谓词复用**：Constraints 参与 ForcedPredicateAST；包装工具注入；未包装 × 非 TRUE FinalRows → 仍 `row_policy_requires_wrapped_tool`。
4. **配置闸门翻转**：合法 `constraints` 不再被 lint/compile 一律拒绝；非法形态仍 fail；**Role 上 `constraints` 继续拒绝**。
5. **AC-SEC-CONSTRAINT + UAT / Release notes**；不得声称 Dynamic RLS / TokenScope（O-P15-1）已交付。

### 1.2 成功标准（可验证）

| ID | 标准 | 验证 |
|---|---|---|
| SC-P15-01 | 两 Role 同源 rowGrant OR 为 TRUE 时，Agent Constraints 可将其收紧为非 TRUE | S4 constrained；单元 |
| SC-P15-02 | `FinalRows = EffectiveRowGrant AND Constraints`；Constraints 缺省 ≡ TRUE（无回归 AC-P1） | 单元 + P1 回归 |
| SC-P15-03 | 合法 `constraints` 可编译；非法 op / 未知字段 / measure 字段 / 无 capability 源失败 | 编译单测 / Admin dryRun |
| SC-P15-04 | Role 出现 `constraints` → 仍拒绝 | lint:spec + 编译 |
| SC-P15-05 | Constraints 使 FinalRows≠TRUE 时，包装工具注入；未包装 → `row_policy_requires_wrapped_tool` | AC-SEC-CONSTRAINT / 闸门单测 |
| SC-P15-06 | 未证明 proven → 仍 `row_policy_upstream_unproven`（不因 Constraints 另开碰运气路径） | 单测 |
| SC-P15-07 | 收窄失败语义继承 AC-P0/P1（盘与 runtime 不留更宽） | U-REL 回归 |
| SC-P15-08 | Release notes **未**声称 Dynamic RLS / 多租户隔离 / TokenScope 行收紧已交付 | 文档评审 |
| SC-P15-09 | Spec/实现钉死 DNF（或书面替代）相交表示、digest 输入、规模上限；超限 **compile fail** | Spec 评审 + 编译单测 |

### 1.3 Non-Goals（本 WO）

- TokenScope 收紧（O-P15-1）
- `ne` 与范围比较 op（`gt`/`gte`/`lt`/`lte`）
- Role 级 `constraints`、Active Role、Dynamic claim、CLS、DB 原生 RLS
- 重开上游载体选型 / 改写 ADR-AC forced predicate 主路径
- 依据 SUPERSEDED 行级文做实现
- 浏览器 E2E（除非后续 Spec 明确要求；默认按 DEVELOPMENT）

---

## 2. 交付物清单

| 交付物 | 路径 | Gate |
|---|---|---|
| AC-P1.5 Runtime Spec | `webui/docs/100-access-control-p15-agent-constraints-spec.md` v0.1.1 | **Gate B DONE**；授权 WP-I\* |
| 术语登记补丁 | `webui/docs/00-product-terminology-standard.md` v0.3.1 | **DONE**（§3/§4.8） |
| Spec 07 / 14 / 15 / 99 补丁 | 07 v1.6 / 14 v0.4 / 15 v0.4；99 指针 | **WP-S1 DONE**（随 Gate B 联签） |
| lint:spec 翻转 | `scripts/lint-spec.mjs`（合法 Agent constraints；Role 仍禁） | Gate B 后随实现 |
| 实现代码 | `webui/server/proxy/{acl,row-policy,mcp-proxy}.ts`、`admin/agents.ts`、相关测试 | **仅 Gate B 后** |
| Security Eval | AC-SEC-CONSTRAINT（及必要 BY 增量） | Gate C 前 |
| UAT / Runbook / Release | `docs/access-control/uat-ac-p15.md` 等（实施后） | Gate C 前 |

---

## 3. 工作包拆解（可派工）

> **WP-S\*** = Spec/契约（**Gate A 后**即可撰写；**Gate B** = Spec 评审通过）  
> **WP-I\*** = 实现（**仅 Gate B 后**）  
> **当前停靠：** Gate A/B/C **DONE** — **AC-P1.5 已交付**（2026-08-09）。

### WP-S0 — AC-P1.5 Runtime Spec（DONE）

| 项 | 内容 |
|---|---|
| 产出 | [`webui/docs/100-access-control-p15-agent-constraints-spec.md`](../../../webui/docs/100-access-control-p15-agent-constraints-spec.md) **v0.1.1** |
| 已含 | schema；DNF；digest（值保留）；精确上限；臂剪枝；Role forbidden；TokenScope Non-Goal；SC-P15-01…09；§9 示例 |
| 验证 | **Gate B 检查表**（Spec 100 §14）**已勾选** |

### WP-S1 — 契约补丁草稿

| 项 | 内容 |
|---|---|
| Spec 99 | 波次边界：Constraints 从「本波拒绝」改为「见 Spec 100」；保留 P1 回归口径 |
| Spec 07 | 裁决码（若新增，如 `constraints_*` / 超限码）与 explain 字段 |
| Spec 14 | Agent Admin：constraints 编辑 / preview；禁虚假生效文案 |
| Spec 15 | Role Admin：明确不提供 constraints；Role YAML 出现仍失败 |
| 术语 | FinalRows / Agent Constraints 波次说明更新为 P1.5 |
| 验证 | 与 design-upgrade §3.1 / ADR-AC-03 §7 对照表；与 Spec 100 无矛盾 |

### WP-I1 — 编译：Agent constraints（DONE）

| 文件 | 改动 |
|---|---|
| `agent-constraints.ts` / `acl.ts` / lint / Admin types | 合法 Agent `constraints` 编译入库；Role → `constraints_forbidden_on_role`；字段绑定复用 P1；上限 / C 不可满足 |
| 测试 | `webui/server/__tests__/agent-constraints-ac-p15.test.ts`（SC-P15-03/04/09） |

### WP-I2 — FinalRows AND 合成（DONE）

| 文件 | 改动 |
|---|---|
| `agent-constraints.ts` | `synthesizeFinalRows` / `finalRowsDigest` / `compileFinalRowsBySource` / `lookupFinalRows` |
| `acl.ts` / `row-policy.ts` / `mcp-proxy.ts` | 编译写入 `finalRowsBySource`；authorize/explain 用 FinalRows；`rowGrant` 仍为 EffectiveRowGrant OR |
| 测试 | SC-P15-01/02/09；P1 `row-policy-ac-p1` + `mcp-proxy-row-policy` 回归绿 |

### WP-I3 — 闸门与强制谓词注入复用（DONE）

| 文件 | 改动 |
|---|---|
| `mcp-proxy.ts` / rewrite | **无缺口**：I2 已使 `authorizeAndRewrite` 用 FinalRows 驱动 wrap/proven/`forced_filters`；本包未改 runtime |
| 测试 | `agent-constraints-ac-p15.test.ts` WP-I3：SC-P15-05（unwrapped deny + proven inject Constraints）、SC-P15-06（unproven deny）、BY-05 Constraints 剥离用户伪造 |
| 证据 | `cd webui && npm test -- --run agent-constraints` + `row-policy-ac-p1` 抽测绿 |

### WP-I4 — Agent Admin / 审计（DONE）

| 文件 | 改动 |
|---|---|
| Admin Agent | `PATCH` 读写 / `constraints:null` 清除；dryRun 返回 FinalRows digest / protected / constraintsSummary；非法 / 超限 / 不可满足 → 400 且不写盘；保存须 `runtimeAck === true` |
| UI | `AgentDetail` Constraints 编辑器（sources + eq\|in）；Capability / confirm / dryRun 展示 FinalRows；禁止虚假「行级取数已生效」 |
| Role Admin | **不**提供 Constraints UI；`role.constraints` 保存路径仍拒绝（`role.constraints is not allowed`） |
| 审计 | config_change `hasConstraints` old/new summary；FinalRows 经 effectivePermissions preview 可观测 |
| 测试 | `admin-agents` WP-I4（含 clear）+ `agent-detail` Constraints confirm-save + Role Admin reject（SC-P15-04） |
| 证据 | `cd webui && npm test -- --run admin-agents agent-detail admin-roles` 绿 |

### WP-I5 — Security Eval + UAT + Runbook + Release（DONE 工程）

| 产出 | 内容 |
|---|---|
| Eval | `ac-security-eval.test.ts` **AC-SEC-CONSTRAINT**（OR→TRUE 收紧 + 不可放宽 + unproven 回归）；完整 SC 矩阵见 `agent-constraints-ac-p15.test.ts` |
| Runtime 收口 | §6 上限在 `compileFinalRowsBySource` 对无 constraints Agent 亦生效；scoped 空 `forced_filters` fail-closed |
| UAT | [`uat-ac-p15.md`](../uat-ac-p15.md)（Gate C 已签；`inbox/20260809-ac-p15-gate-c-signoff.md`） |
| Runbook | [`runbook-row-policy.md`](../runbook-row-policy.md) **路径 D**（Constraints 误配 / 超限） |
| Release | [`release-notes-ac-p15.md`](../release-notes-ac-p15.md)（SC-P15-08 Non-Claim） |
| 证据命令 | `cd webui && npm test -- --run agent-constraints-ac-p15 ac-security-eval admin-agents agent-detail admin-roles row-policy-ac-p1` |

---

## 4. 闸门定义

### 4.1 Gate A 检查表（已通过）

- [x] 本 WO 范围 = Agent Constraints；复用 P1 强制谓词；不含 Dynamic RLS /（默认）TokenScope
- [x] O-P15-1…6 默认采纳（或书面变更已记录）
- [x] Role `constraints` 继续拒绝（产品边界）
- [x] 明确：Gate A **只授权写 Spec**，不授权 runtime
- [x] **产品 / 工程批准 Gate A（2026-08-09）** → 进入 WP-S0

### 4.2 Gate B 检查表（已通过）

- [x] Spec 含 SC-P15-01…09 映射与 deny / 编译失败全表
- [x] **§0.3 / Spec 100**：DNF 相交、digest（值保留）、规模上限、超限 compile fail、臂剪枝 / 不可满足口径均已钉死
- [x] Spec 99 / 07 / 14 / 15 波次边界无矛盾
- [x] 术语标准已更新
- [x] 与 Spec 98/99 指针清晰（P0/P1 语义不回退）
- [x] **产品 / 工程批准 Gate B（2026-08-09，xingchen）** → 允许 WP-I\*

### 4.3 Gate C 检查表（摘要）

- [x] SC-P15-01…09 有自动化证据（含 §6 role-arm / absorbed-R 上限；SC-P15-07 继承 U-REL + 非法 constraints 不写盘）
- [x] AC-SEC-CONSTRAINT 工程绿；P1 bypass / unproven 回归不破
- [x] UAT / Runbook **自动化演练 PASS**（[`uat-ac-p15.md`](../uat-ac-p15.md)；证据 `inbox/20260809-ac-p15-uat/` 13/13）
- [x] UAT / Runbook **产品签字**（抽检截图后；xingchen 2026-08-09）
- [x] Release notes 文稿合规（SC-P15-08）— [`release-notes-ac-p15.md`](../release-notes-ac-p15.md)
- [x] `docs/access-control/README.md` →「AC-P1.5 已交付」

---

## 5. 验证命令（实施后）

```bash
# 仓库根
npm run lint:spec

# webui — 文件名以实现时为准
cd webui
npm test -- --run row-policy agent-constraints constraint acl-capability
./node_modules/.bin/tsc --noEmit   # 或沿用书面豁免并登记
```

---

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 误用 Role 间 AND 代替 Constraints | Spec + SC-P15-01；Admin 文案禁止「多 Role 自动收紧」 |
| OR×AND 相交语义在实现期漂移 | §0.3 + SC-P15-09；Gate B 硬项 |
| DNF 组合爆炸 | 规模上限 + 超限 compile fail |
| Constraints 开启第二套注入 / 放宽路径 | 强制复用 P1 ForcedPredicateAST；SEC-CONSTRAINT |
| TokenScope 范围蔓延 | O-P15-1；Gate B/C 文档门禁 |
| 合法 constraints 与旧 lint「一律拒绝」冲突 | WP-I1 同步翻转 lint + 编译；Role 路径保持拒绝 |
| 引用 SUPERSEDED 行级方案 | WO/README 醒目禁止；评审拒收 |

---

## 7. 审核清单（本 WO）

- [x] 确认以 `design-upgrade.md` v1.1.2 为设计事实源；AC-P1（WO-60）Gate C 已交付为开工前提
- [x] 确认 D2：人级收紧 = Agent Constraints AND，非 Role AND
- [x] 确认复用上游强制谓词契约；不重开载体选型
- [x] 确认 O-P15-1 **不含 TokenScope**
- [x] **Gate A**：批准范围与 O-P15 默认 → **授权 WP-S0**（非 Spec 评审）
- [x] **Gate B**：批准 Spec 100 v0.1.1（含 §0.3 / WP-S1）→ **允许 WP-I\***（2026-08-09，xingchen）
- [x] 确认默认不做浏览器 E2E

### 关闭路径

1. **Gate A DONE** → 执行 WP-S0（及 WP-S1）。  
2. **Gate B DONE** → 按 §3 实施 WP-I\*。  
3. Gate C 全绿 → 更新域 README；后续开波见路线图冻结 ADR（**默认不做** TokenScope）。

### 下一步（当前）

1. ~~产品 Gate C 签字~~ **DONE**（2026-08-09）。  
2. **路线图：** 见 [`adr-post-p15-roadmap-freeze.md`](../adr-post-p15-roadmap-freeze.md)（已批准）——TokenScope / Dynamic RLS / AC-P2+ 整包冻结；优先单机部署落地。更广 op / CLS 等仅在满足该 ADR §2.3 硬条件时另立 WO。

— 完
