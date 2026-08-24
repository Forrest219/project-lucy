# Release Notes：AC-P1.5 Agent Constraints（Gate C）

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P1.5 Agent Constraints 发布说明（非声称） |
| 文档类型 | Release Notes |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec 100 v0.1.1；WO-61 WP-I5；UAT / Runbook |
| 适用范围 | AC-P1.5 对外/对内发布口径（SC-P15-08） |
| 输出位置 | `docs/access-control/release-notes-ac-p15.md` |

## 已交付

- Agent 级 `constraints.sources`（op ∈ {eq, in}）编译与 Admin 编辑
- `FinalRows = EffectiveRowGrant AND AgentConstraints`（DNF 展开 + 不可满足臂剪枝）
- FinalRows≠TRUE 时复用 AC-P1 包装工具 / proven / `forced_filters`（`filters[]` 前缀载体）
- 编译期精确上限（Role arms / Constraints preds / DNF 规模）与不可满足 fail-closed
- Role / Token **不**承担 Constraints（Role 出现 `constraints` 仍拒绝）

## 明确未交付 / 禁止声称

- **不是** Dynamic RLS
- **不是** 数据库原生 RLS
- **不是** 多租户隔离保证
- **不是** TokenScope 行收紧（本波 TokenScope ≡ TRUE）
- **不是**「多 Role 自动对人级行集做 AND」——人级收紧仅 Agent Constraints

## 与 AC-P1 的关系

- Role 级 `row_access` / `row_policy` 与 EffectiveRowGrant **OR** 语义不变
- 上游强制谓词 proven 门禁不变（默认 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=false`）
- Constraints 使 FinalRows≠TRUE 时，与 scoped Role 走同一套未证明 / 未包装 deny

## proven 置真

沿用 AC-P1：仅在目标环境作为独立运维变更启用 proven；Constraints 不单独引入第二条 proven 开关。

— 完
