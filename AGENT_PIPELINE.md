# Agent 执行流水线（完整交付模式 · 可选）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent 执行流水线（完整交付模式 · 可选） |
| 文档类型 | Other |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-17 |
| 撰写人 | Codex |
| 委托人 | 待确认 |
| 基于材料 | 用户审阅意见 1-8、docs/DEVELOPMENT.md、agents/*.md、/Users/zhangxingchen/Projects/AGENTS.md |
| 适用范围 | project-lucy 完整交付模式下的 vibe coding 多角色交接流程 |
| 输出位置 | /Users/zhangxingchen/Projects/project-lucy/AGENT_PIPELINE.md |

> **本流水线是可选的"完整交付模式"，不是必经流程。**
> Vibe coding 中可单独调用任一角色（如"切到 architect 看这段"、"以 reviewer 视角复核"），不需要走完整链路。何时启用见 [`agents/README.md`](agents/README.md)。
> 角色详情：[`agents/`](agents/)
> 所有落盘的正式 Markdown 制品必须按 `/Users/zhangxingchen/Projects/AGENTS.md` 要求包含元数据表。
>
> **优先级**：与 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 冲突时以 `DEVELOPMENT.md` 为准（同 `agents/README.md` 约定）。本流水线只规定"完整交付模式"下的角色交接节奏，不覆盖仓库开发治理（Plan Mode、红线、Spec 落位）。

---

## 参与角色（5 个）

| 短名 | 职责（一句话） | 详情 |
|------|--------------|------|
| **pm** | 需求 → PRD（含关键用户文案，opt-in 时含 RELEASE_NOTES） | [agents/pm.md](agents/pm.md) |
| **architect** | Context_Summary + SPEC（含 UI 结构/状态、Backout Plan） | [agents/architect.md](agents/architect.md) |
| **coder** | 按 SPEC 实现、修 bug、补测试、处理 Refactor（terminal 执行权限，自愈 ≤ 3 次） | [agents/coder.md](agents/coder.md) |
| **tester** | 验证 SPEC 合规 + 回归 | [agents/tester.md](agents/tester.md) |
| **reviewer** | 合规 + 真实风险 + 上线审计两维复核 | [agents/reviewer.md](agents/reviewer.md) |
| **Human** | 业务确认 / 最终验收 | — |

---

## 流水线阶段跳转

```
Human 提需求
    ↓
[阶段 0] pm → PRD.md ──► Human 确认（门控）
    ↓
[阶段 0/一] architect → Context_Summary.md + SPEC.md（UI 涉及时含 §6，Backout 触发时含 §5 Backout Plan）
    ↓
[阶段一] architect + coder 澄清对齐
    ↓
[阶段一后] tester → 测试骨架（仅当 SPEC §7 Mocks & Fixtures 触发 TDD 模式时）
    ↓
[阶段二] coder → 实现 → Pre-handoff Checklist 全绿 → IMPLEMENTATION_NOTES.md → 移交 Tester
    ↓
[阶段二] tester → TESTER_PASS.md / TESTER_FAIL.md（失败 → 回 coder 修复 → tester 重验）
    ↓
[阶段三] reviewer → SPEC_Compliance_Check.md + RealWorld_Risk_Check.md（含上线审计项）
         FAIL → Refactor_Instructions.md → coder 修复 → tester 重验 → reviewer 再审（最多 2 次）
    ↓
[阶段四 · opt-in] pm → RELEASE_NOTES.md（用户可见变化总结），架构师确认 SPEC §5 Backout Plan 可执行
    ↓
Human 最终 review + 合并 / 发布
```

---

## 制品清单

| 阶段 | 执行者 | 产出文件 | 必须 |
|------|--------|---------|------|
| 0 | pm | `PRD.md` | ✅ |
| 0/一 | architect | `Context_Summary.md` | ✅ |
| 0/一 | architect | `SPEC.md` | ✅ |
| 一后 | tester | 测试骨架文件（`tests/` 下，命名与功能对应） | SPEC §7 触发 TDD 模式时 |
| 一 | coder | `Clarification_Questions.md` | 如有 |
| 二 | coder | `IMPLEMENTATION_NOTES.md` | ✅ |
| 二 | coder | `SPEC_GAP_REPORT.md` | 如有 |
| 二 | coder | `IMPLEMENTATION_BLOCKER.md` | 自愈 3 次后仍失败时 |
| 二 | tester | `TESTER_PASS.md` / `TESTER_FAIL.md` | ✅ |
| 三 | reviewer | `SPEC_Compliance_Check.md` | ✅ |
| 三 | reviewer | `RealWorld_Risk_Check.md` | ✅ |
| 三 | reviewer | `Refactor_Instructions.md` | 如有 |
| 四 | pm | `RELEASE_NOTES.md` | opt-in（需要发布说明时） |

> 落盘目录由项目约定，本流水线不强制。仓库若有特定治理规则（如 OpenSpec、`docs/`、`changes/`），按那套规则落位。

---

## 迭代上限

| 场景 | 上限 |
|------|------|
| coder 自愈循环 | 3 次 |
| reviewer 返工 | 2 次 |
| 超限 | 人工介入，暂停流水线 |

---

## 铁规则

1. **coder 可以修实现，不可以私改 SPEC**
2. **Human 确认 PRD 前，coder 不得进入实现阶段**
3. **完整交付模式下，所有交接均为文件交接，不以口头上下文传递**（Vibe 模式不强制）
4. **reviewer 不直接修改代码**，只输出审阅结论和 `Refactor_Instructions.md`；修复由 coder 执行
5. **Final Approval 必须输出 SPEC 合规 + 真实风险两维报告**
6. **禁止救急方案；紧急例外走 ADR 登记，过期阻塞**
7. **交接制品命名严格遵循制品清单**
   - coder 阶段唯一合法交接文件名：`IMPLEMENTATION_NOTES.md`
   - 新增制品名须先修改本文件制品清单

> 规则编号永不重用、永不跳号。废止的规则保留编号并标注 `(Deprecated)`。
