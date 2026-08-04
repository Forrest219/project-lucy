# Lucy WebUI 设计规范治理（Governance）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI 设计规范治理（Governance） |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | 现有开发治理规则与 UI/UX Ledger 维护方式 |
| 适用范围 | Design System 的维护、升级、例外与回归流程 |
| 输出位置 | `webui/docs/design-system/99-governance.md` |

## 变更原则

- 先规范，后实现：新增视觉模式前先补规范。
- 小步迭代：优先补最小可执行条目，再逐步细化 token 与示例。
- 单一事实源：规范正文只维护在 `webui/docs/design-system/`。

## 提交流程

1. 在相关章节补充或修订规范条目。
2. 在实现 PR 中增加 `Design System Compliance` 小节：
   - 引用章节
   - 说明遵循点
   - 说明例外点（如有）
3. 通过最小回归（组件测试/页面测试/术语 lint）。

## 临时决策机制

当需求涉及未覆盖模式时：

1. 先在本文件记录临时决策（含背景、范围、失效条件）。
2. 标记负责人和升级期限。
3. 在下一个迭代将临时决策升级为正式规范章节。

## 与 UI/UX Ledger 的关系

- `docs/ui-ux-feedback/` 负责记录问题与验收事实。
- `webui/docs/design-system/` 负责沉淀可复用规则。
- 每个跨页面主题在关闭前应尽量落到 Design System 对应章节。

## 版本策略

- `v1.x`：兼容增量，补条目、补示例、补约束。
- `v2.0`：若存在大规模重构或 token 体系迁移，再做主版本升级。
