# UAT-SUITE-OPS-CONCEPTS — 概念运维工具（Ops MCP）

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-OPS-CONCEPTS` |
| 总账 ID | **P1-11**／REQ-030-032；伴生修复 **P1-27**／REQ-030-048 |
| 目标 | 客户／运维场景：问数 Token 不可调概念运维工具；具备 `allow.ops` 的 Agent 可经 MCP 完成只读 list／scan（容器拆卷、内容根无 `scripts/`）；测后清理临时 Role／Agent |
| 合同回链 | [P1-11 Ops Spec](../../../../specs/lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md)；[P1-27 代码根修复 Spec](../../../../specs/lucy-20261115-ops-concept-code-root-runtime-fix-spec.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md)（GAP-UAT-P1-11-RUNTIME） |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |
| 最近执行跑次 | [2026-11-15-claude-macmini-p1-11-ops](runs/2026-11-15-claude-macmini-p1-11-ops.md)＝**FAIL**（02 业务受理） |
| P1-27 复测 | **NOT RUN**（登记已挂；须干净重建后再执行；本波不重建） |

## 必做／可选

| 波次 | 必做 | 可选 |
|---|---|---|
| P1-11 首跑（已执行） | UAT-R0、UAT-OPS-CONCEPT-01、02、03 | UAT-OPS-CONCEPT-04 |
| **P1-27 修复复测**（待跑） | **UAT-R0-FIX**、UAT-OPS-CONCEPT-01、**02**、03 | UAT-OPS-CONCEPT-04；UAT-OPS-CONCEPT-05（运行时不可用信封，缺注入则 SKIPPED） |

## 复跑入口（后续执行方）

1. 读 [fixtures.md](fixtures.md) → [cases.md](cases.md)。  
2. **先**跑 `UAT-R0-FIX`：health `gitSha`＝含 P1-27 修复的提交且 **`gitDirty=false`**；`/data/lucy` **无** `scripts/`；`/app/scripts/concepts` 存在。不满足 → **STOP**，写 `BLOCKED`／不冒充 PASS（Spec SC-08／D7）。  
3. 顺序：01 → 02 → 03；04 默认 SKIPPED。  
4. 新跑次文件名：`runs/YYYY-MM-DD-<agent>-p1-27-ops-retest.md`；更新 [`INDEX.md`](../../INDEX.md) 最近跑次；关闭或保留 GAP-UAT-P1-11-RUNTIME 以 INDEX 为准。  
5. **禁止**用 vitest／CR／脏树书面确认冒充本套件 PASS；**禁止**为绿而往 `/data/lucy` 拷 `scripts/`。

## 边界

- 本套件主张 **Ops MCP 控制面** 客户场景 UAT，**≠** 可上线，**≠** 业务问数注入 canonical。  
- 临时资源 id／name 前缀必须为 `uat-ops-concept-`；测后必须清理。  
- 默认**不**对概念库做 set_canonical／reject commit。  
- P1-27 关闭的是部署态代码根装配缺口；不改写 P1-11 已收口的授权／审计合同语义。
