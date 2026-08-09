# UAT：AC-P1.5 Agent Constraints

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P1.5 Agent Constraints UAT 勾选清单 |
| 文档类型 | Checklist |
| 版本 | v1.2 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec 100 v0.1.1；WO-61；自动化证据 `inbox/20260809-ac-p15-uat/`；计划 `plans/20260809-ac-p15-uat-runbook-plan.md`；总签 `inbox/20260809-ac-p15-gate-c-signoff.md` |
| 适用范围 | Gate C 验收（Agent Constraints / FinalRows AND）；**不含** Dynamic RLS / TokenScope 行收紧 |
| 输出位置 | `docs/access-control/uat-ac-p15.md` |

> 勾选规则：关键路径须人工勾选；已有自动化覆盖的项可标「自动化」并抽检。  
> **自动化执行：** `node scripts/ac-p15-uat-runbook.mjs` → **13/13 PASS**（2026-08-09，环境 `lucy-ac-p1-by01`）。  
> **Gate C 总签：** **xingchen 批准**（2026-08-09；见 `inbox/20260809-ac-p15-gate-c-signoff.md`）。

---

## 0. Fixture

- [x] Role：`demo_readonly`（`row_access: all`）
- [x] Agent：`acp15_uat_agent`（脚本创建/清理）
- [x] Overlay：`superstore_orders.region`
- [x] Token：`acp15-uat-T1`（演练后 revoke / Agent 删除）

---

## 1. 编译与 Admin（SC-P15-03 / 04 / 07 / 09）

| 项 | 期望 | 自动化 | 人工 |
|---|---|---|---|
| 合法 Agent constraints 保存 / 编译 | `runtimeAck===true` + FinalRows digest / protected | ✅ UAT-A1/A2 | [x] 抽检 |
| 非法 / mixed names / 不可满足 | 400；不写盘 | ✅ UAT-A4/A5 | [x] |
| Role 出现 `constraints` | 拒绝 | ✅ UAT-A6 | [x] |
| 清除 constraints | FinalRows 回 all | ✅ UAT-A7 | [x] |
| **禁止**「Constraints 已配置即行级取数已生效」 | Admin 文案 | ✅ UI-1/UI-3 | [x] 抽检截图 |
| TypedScalar round-trip | 单测 | ✅ agent-detail unit | [x] |

---

## 2. FinalRows 与强制谓词（SC-P15-01 / 02 / 05 / 06）

| ID | 场景 | 期望 | 自动化 | 人工 |
|---|---|---|---|---|
| SC-P15-01/A3 | Constraints → FinalRows scoped | protected + digest | ✅ | [x] |
| SC-P15-05/MCP-2 | 未包装 | `row_policy_requires_wrapped_tool` | ✅ | [x] |
| SC-P15-06/MCP-1 | proven=false | `row_policy_upstream_unproven` | ✅ | [x] |
| UI dryRun | 变更 diff FinalRows 摘要 | ✅ UI-2 | [x] 截图 |

```bash
node scripts/ac-p15-uat-runbook.mjs
# 证据：inbox/20260809-ac-p15-uat/
```

---

## 3. Non-Claim（SC-P15-08）

- [x] Release notes 合规（自动化静态检查）— [`release-notes-ac-p15.md`](release-notes-ac-p15.md)
- [x] 域 README 标「AC-P1.5 已交付」（Gate C 总签后）

---

## 4. Runbook 演练

- [x] 路径 D 误配 / 超限 / 清除 — 自动化 UAT-A4/A5/A7（证据包）
- [x] Role 误写 constraints 拒绝 — UAT-A6
- [x] 未证明门禁 — MCP-1

---

## 签字

| 项 | 签名 | 日期 |
|---|---|---|
| 自动化矩阵（13/13） | Cursor Agent（执行）/ xingchen（抽检批准） | 2026-08-09 |
| Admin UI 截图抽检 | xingchen | 2026-08-09 |
| Runbook 路径 D | xingchen | 2026-08-09 |
| **Gate C 批准** | **xingchen** | **2026-08-09** |

— 完
