# Release Notes：AC-P1 Row Policy（Gate C）

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P1 Row Policy 发布说明（非声称） |
| 文档类型 | Release Notes |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec 99；WO-60 Gate C；UAT / Runbook 签字 |
| 适用范围 | AC-P1 对外/对内发布口径（SC-P1-08） |
| 输出位置 | `docs/access-control/release-notes-ac-p1.md` |

## 已交付

- `row_access: scoped` + `row_policy`（op ∈ {eq, in}）编译与运行时强制谓词
- 受保护源走 `lucy_query`；未包装工具 / 整源读 fail-closed
- 契约未证明时 `row_policy_upstream_unproven`（默认 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=false`）
- Lucy 对 bundled `@kaelio/ktx@0.16.0` 的强制谓词载体（`filters[]` 前缀 + `forced_filters` 审计字段）

## 明确未交付 / 禁止声称

- **不是** Dynamic RLS
- **不是** 数据库原生 RLS
- **不是** 多租户隔离保证
- **不含** AC-P1.5 Agent Constraints

## proven 置真

Gate C 总签完成后，方可在目标环境将 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=true` 作为**独立运维变更**启用；默认与模板仍保持 false，直至该变更执行。

— 完
