# WO-202608-60 访问权限 AC-P1 Row Policy 可交付实现计划

| 元数据 | 内容 |
|---|---|
| 文档名称 | 访问权限 AC-P1 Row Policy 可交付实现计划 |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `docs/access-control/design-upgrade.md` **v1.1.2**（ADR-AC-03/05/06）；AC-P0 Spec 98 / WO-59 Gate C 已交付；开波计划锁定决策（O2 fail-closed；不含 P1.5） |
| 适用范围 | AC-P1 **上游契约 ADR + Spec + 实现拆解**；**不含** AC-P1.5 Agent Constraints；Gate A 通过前只写契约/Spec，Gate B 通过前 **禁止改 runtime** |
| 输出位置 | `docs/access-control/plans/wo-202608-60-access-control-p1.md` |

---

## 0. 执行状态与闸门

| 阶段 | 状态 | 说明 |
|---|---|---|
| AC-P0 Gate C | **DONE** | WO-59；Capability / AbsoluteDeny / EffectivePolicy 已交付 |
| 本 WO 开波落盘 | **DONE（2026-08-09）** | 本文 |
| **Gate A：上游强制谓词契约 ADR** | **DONE（2026-08-09）** | 批准仅授权 Spec/契约；不授权 runtime |
| WP-S0 上游契约 ADR | **DONE（v0.2）** | [`adr-upstream-forced-predicate.md`](../adr-upstream-forced-predicate.md) |
| WP-S1 AC-P1 Runtime Spec + 术语 | **DONE（v0.1.2）** | [`webui/docs/99-access-control-p1-row-policy-spec.md`](../../../webui/docs/99-access-control-p1-row-policy-spec.md) |
| WP-S2 契约补丁（07/14/15 + lint） | **DONE（草稿）** | Spec 07 v1.5 / 14·15 v0.3；lint 随 WP-I1 放行合法 scoped |
| **Gate B：AC-P1 Spec 评审通过** | **DONE（2026-08-09）** | 授权 WP-I\* runtime |
| WP-I1…I4 | **DONE（测绿）** | 编译/闸门/forced_filters；proven 默认 false |
| WP-I5 Admin | **DONE** | preview scoped digest；Role UI scoped/`row_policy` 编辑器已抛光（round-trip） |
| WP-I6 BY/UAT/Runbook | **DONE** | BY 矩阵 + BY-01 集成 + Preview/Runbook 演练；签字见 `inbox/20260809-ac-p1-gate-c-signoff.md` |
| **Gate C：bypass + UAT 签字** | **DONE（2026-08-09）** | xingchen 总批准；证据 `inbox/20260809-ac-p1-by01-uat/` + `inbox/20260809-ac-p1-runbook-uat/`；Release notes [`release-notes-ac-p1.md`](../release-notes-ac-p1.md)；**proven 置真须另开运维变更（默认仍 false）** |
| AC-P1.5 Agent Constraints | **本 WO Non-Goal** | 已另立 [`WO-61`](wo-202608-61-access-control-p15-agent-constraints.md) |

**冲突裁决：** 实现与 Spec 冲突 → Spec；Spec 与 `design-upgrade.md` 冲突 → **design-upgrade**，并回修 Spec。  
**禁止依据：** `feasibility-row-acl.SUPERSEDED.md` 不得作为实施或 Spec 事实源。

### 0.1 已锁定决策（开波确认）

| ID | 决策 |
|---|---|
| O2 | DataPlane 工具遇 `FinalRows != TRUE` 的 scoped source → **一律 deny**，reason = `row_policy_requires_wrapped_tool`；本波 **不做**「加 lucy_* 包装再放行」 |
| 边界 | 仅 AC-P1 Row Policy；**不含** Agent Constraints |
| constraints | YAML / Agent 上出现 `constraints` → **lint/compile fail**（或等价 unsupported 拒绝），**不得静默生效** |
| op | 初版仅 `eq` \| `in`（ADR-AC-05 / D9） |
| FinalRows（本波） | `EffectiveRowGrant` OR；`AgentConstraints ≡ TRUE`；`TokenScope ≡ TRUE`（本波不实现收紧） |

---

## 1. 目标与成功标准

### 1.1 目标（AC-P1）

在 **AC-P0 Capability 模型已交付** 的前提下，交付：

1. **`row_access: scoped` + `row_policy`**：v2 Role 合法配置；structured 谓词仅存于 `access.yaml`。
2. **`EffectiveRowGrant` OR**：同源多 Role 行授予按 OR 合成；禁止错误 AND。
3. **`FinalRows` 闸门**：包装工具路径注入强制谓词；未包装 DataPlane × scoped → fail-closed。
4. **上游强制谓词契约**：不可被用户 filters / OR / 括号 / 别名 / 自连接 / LEFT JOIN / 聚合 / HAVING 放宽；契约未证明 → `row_policy_upstream_unproven`。
5. **Bypass 矩阵 + UAT / Runbook**；Release notes **未**声称 Dynamic RLS / 多租户隔离。

### 1.2 成功标准（可验证）

| ID | 标准 | 验证 |
|---|---|---|
| SC-P1-01 | 同源多 Role rowGrant OR 后为 TRUE 时不错误 AND | S4 行授予；单元 |
| SC-P1-02 | `scoped` + 合法 `row_policy` 可编译；非法 op / 缺 policy / 未知字段 / 非行级字段 / **measure 字段**失败 | 编译单测 / Admin dryRun；U-ROW-FIELD-MEASURE / BY-19 |
| SC-P1-03 | 未包装工具 × scoped → `row_policy_requires_wrapped_tool` | AC-SEC-ROW；MCP 抽检 |
| SC-P1-04 | 契约未证明 → `row_policy_upstream_unproven`；不得字符串碰运气注入 | 单测 + 契约 ADR |
| SC-P1-05 | 包装工具注入后 bypass 矩阵全绿 | Gate C bypass 套件 |
| SC-P1-06 | `constraints` 出现 → 配置拒绝 | lint:spec + 编译单测 |
| SC-P1-07 | 收窄失败语义继承 AC-P0（盘与 runtime 不留更宽） | U-REL 回归 |
| SC-P1-08 | Release notes 未声称 Dynamic RLS / 多租户隔离 | 文档评审 |

### 1.3 Non-Goals（本 WO）

- Agent Constraints / TokenScope 收紧（**AC-P1.5+**）
- `ne` 与范围比较 op（`gt`/`gte`/`lt`/`lte`）
- DB 原生 RLS、Dynamic claim、Active Role、CLS
- 依据 SUPERSEDED 行级文做实现
- 浏览器 E2E（除非后续 Spec 明确要求；默认按 DEVELOPMENT）
- 搬迁 Spec 07 出 webui（仅更新契约）

---

## 2. 交付物清单

| 交付物 | 路径 | Gate |
|---|---|---|
| 上游强制谓词契约 ADR | `docs/access-control/adr-upstream-forced-predicate.md`（建议） | **A（WP-S0）** |
| AC-P1 Runtime Spec | `webui/docs/99-access-control-p1-row-policy-spec.md`（若号段占用则顺延） | A→B（WP-S1） |
| 术语登记 | `webui/docs/00-product-terminology-standard.md` | A 后、B 前 |
| Spec 07 / 14 / 15 补丁 | `webui/docs/07-…`、`14-…`、`15-…` | B 前草稿 |
| lint:spec 扩展 | `scripts/lint-spec.mjs`（scoped / row_policy / constraints） | Gate B 后随实现 |
| 实现代码 | `webui/server/proxy/*`、`admin/*`、相关测试 | **仅 Gate B 后** |
| Security Eval | AC-SEC-ROW / BYPASS | Gate C 前 |
| UAT / Runbook | `docs/access-control/uat-ac-p1.md` 等（实施后） | Gate C 前 |

---

## 3. 工作包拆解（可派工）

> **WP-S\*** = Spec/契约（**Gate A 后**写 Spec；WP-S0 本身是 Gate A 交付物）  
> **WP-I\*** = 实现（**仅 Gate B 后**）  
> 本开波日只落 WO；**下一步 = WP-S0**，不改 runtime。

### WP-S0 — 上游强制谓词契约 ADR（Gate A 主交付）

| 项 | 内容 |
|---|---|
| 产出 | `docs/access-control/adr-upstream-forced-predicate.md` |
| 必含 | `FinalRows` → 受控 AST / 上游强制字段；不可放宽语义清单；受保护源禁自由 `filters` / 未审计 ad-hoc expr / 子查询；未证明口径 `row_policy_upstream_unproven` |
| 证明策略（默认） | 以 KTX / `lucy_query`（及 Spec 列出的包装工具）为**唯一**可注入通道；写清允许/禁止的 args 形状；Gate C 用 bypass 矩阵证明（**不必**等 DB 原生 RLS） |
| 验证 | Gate A 评审清单可勾；无「先注入字符串碰运气」路径 |

### WP-S1 — AC-P1 Runtime Spec + 术语

| 项 | 内容 |
|---|---|
| 产出 | Spec 99（或下一可用编号）；术语扩展 |
| 必含 | Terminology Compliance；`scoped` + `row_policy` schema；EffectiveRowGrant OR；FinalRows（Constraints 本波恒 TRUE + constraints 出现即失败）；未包装 fail-closed；deny 全表；指针 Spec 98；SC-P1-\*；Non-Goals |
| 验证 | 无「留给 Builder 决定」的安全语义空缺 |

### WP-S2 — 契约补丁草稿

| 项 | 内容 |
|---|---|
| Spec 07 | 波次边界；`row_policy_requires_wrapped_tool` / `row_policy_upstream_unproven` |
| Spec 14/15 | Admin v2+scoped+row_policy dryRun；禁「看起来有行级但未注入」 |
| lint | `constraints` → fail；scoped/row_policy 形状校验（实现期落地） |
| 验证 | 与 design-upgrade §9 / ADR-AC-05 对照表 |

### WP-I1 — 编译：scoped + row_policy（Gate B 后）

| 文件 | 改动 |
|---|---|
| `acl.ts` / Admin / lint | v2 允许 `scoped`+`row_policy`；op∈{eq,in}；缺 policy / 非法 op 失败；`constraints` 拒绝；同 source 冲突 grant digest → 编译失败 |
| 测试 | SC-P1-02 / SC-P1-06 |

### WP-I2 — FinalRows 合成

| 文件 | 改动 |
|---|---|
| `acl.ts` | `EffectiveRowGrant` = OR(rowGrant)；本波 Constraints/TokenScope 恒 TRUE |
| 测试 | SC-P1-01 |

### WP-I3 — 闸门 fail-closed

| 文件 | 改动 |
|---|---|
| `acl.ts` / `mcp-proxy.ts` | 非包装 DataPlane × scoped → `row_policy_requires_wrapped_tool`；契约未证 → `row_policy_upstream_unproven` |
| 测试 | SC-P1-03 / SC-P1-04 |

### WP-I4 — 包装工具强制谓词注入

| 文件 | 改动 |
|---|---|
| `mcp-proxy.ts` / rewrite | `lucy_query`（及 Spec 列出的包装集）注入 FinalRows；绕过矩阵条目 |
| 测试 | SC-P1-05 |

### WP-I5 — Admin / 审计

| 文件 | 改动 |
|---|---|
| Admin Role / Agent | scoped+row_policy dryRun/preview；保存继承 AC-P0 runtimeAck |
| 审计 | 新裁决码可筛；必要时 digest/策略字段 |
| 测试 | SC-P1-07 回归 |

### WP-I6 — Security Eval + UAT + Runbook

| 产出 | 内容 |
|---|---|
| Eval | AC-SEC-ROW / BYPASS |
| UAT | `docs/access-control/uat-ac-p1.md` |
| Runbook | 行策略误配 / 契约未证恢复（可扩展既有 degrade runbook 或另文） |
| 验证 | Gate C 检查表全绿；Release notes 合规（SC-P1-08） |

---

## 4. 闸门定义

```text
Gate A — 上游强制谓词契约 ADR 批准
  → 允许 WP-S1 / WP-S2（Spec / 术语 / 契约补丁）
  → 禁止改 runtime

Gate B — AC-P1 Runtime Spec 评审通过
  → 允许 WP-I1…I6
  → 禁止声称 Dynamic RLS 已交付

Gate C — 实现 + bypass + UAT/Runbook
  → 域 README「AC-P1 已交付」
  → 方可另立 AC-P1.5 WO
```

### 4.1 Gate A 检查表（当前停靠点）

- [ ] ADR 写清证明方式与不可放宽语义
- [ ] 未证明路径 = deny（`row_policy_upstream_unproven`），无碰运气注入
- [ ] 包装工具集合与禁止 args 形状闭合
- [ ] 明确本波不含 Agent Constraints；`constraints` 拒绝策略写入 Spec 前置约定
- [ ] **产品 / 工程批准 Gate A**

### 4.2 Gate B 检查表（摘要）

- [ ] Spec 含 SC-P1-01…08 映射与 deny 全表
- [ ] O2 fail-closed 无歧义
- [ ] 与 Spec 98 指针清晰（P0 语义不回退）
- [ ] 术语标准已登记新条目

### 4.3 Gate C 检查表（摘要）

- [x] SC-P1-01…08 有证据
- [x] AC-SEC-ROW / BYPASS 绿
- [x] 上游契约证明条目齐（Lucy carrier）
- [x] UAT / Runbook 签字（xingchen 2026-08-09）
- [x] Release notes **未**声称 Dynamic RLS / 多租户隔离
- [x] `docs/access-control/README.md` →「AC-P1 已交付」

---

## 5. 验证命令（实施后）

```bash
# 仓库根
npm run lint:spec

# webui — 文件名以实现时为准
cd webui
npm test -- --run row-policy bypass acl-capability policy-compile
./node_modules/.bin/tsc --noEmit   # 或沿用书面豁免并登记
```

---

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 强制谓词被 filters OR 绕过 | Gate A 契约 + Gate C bypass 矩阵硬门禁 |
| 未包装工具误放行 | O2 代码路径 fail-closed；SEC-ROW |
| 误把 Constraints 当 P1 交付 | Non-Goal + constraints lint fail |
| 引用 SUPERSEDED 行级方案 | WO/README 醒目禁止；评审拒收 |

---

## 7. 审核清单（本 WO）

- [ ] 确认以 `design-upgrade.md` v1.1.2 为设计事实源；禁止 SUPERSEDED 行级文
- [ ] 确认 O2 = fail-closed（`row_policy_requires_wrapped_tool`）
- [ ] 确认 **不含** AC-P1.5；`constraints` 拒绝
- [ ] **Gate A**：批准上游强制谓词契约 ADR → 允许 WP-S1/S2
- [ ] **Gate B**：批准 AC-P1 Spec → 允许 WP-I\*
- [ ] 确认默认不做浏览器 E2E

### 关闭路径

1. 批准 Gate A（WP-S0 ADR）→ 执行 WP-S1/S2。  
2. Spec 评审通过并勾选 Gate B → 按 §3 实施 WP-I\*。  
3. Gate C 全绿 → 更新域 README；AC-P1.5 另立 WO（**已立 [`WO-61`](wo-202608-61-access-control-p15-agent-constraints.md)**）。  

### 下一步（Gate C 后）

1. 目标环境若需行级取数：单独运维变更置 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=true`（可回滚）。  
2. Role Admin scoped 编辑器 UI 抛光：**DONE**。  
3. AC-P1.5 Constraints：见 [`WO-61`](wo-202608-61-access-control-p15-agent-constraints.md)（停靠 Gate A）。

— 完
