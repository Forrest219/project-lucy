# Lucy WebUI 设计规范治理（Governance）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI 设计规范治理（Governance） |
| 文档类型 | Spec |
| 版本 | v1.4 |
| 撰写日期 | 2026-08-04；2026-10-30 增补 TD-20261030-01；2026-11-14 清账：四条临时决策升格并归档，仅余 TD-187-01；TD-20261114-01 已裁决升格 |
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
2. 标记负责人和升级期限（格式 `升级期限：YYYY-MM-DD`；`lint:spec-docs` 规则 `ds-td-expiry` 会检查缺失与过期）。
3. 在下一个迭代将临时决策升级为正式规范章节。

### 当前临时决策

| 编号 | 模式 | 背景与范围 | 约束 | 负责人 / 失效条件 |
|---|---|---|---|---|
| TD-187-01 | 访问关系图授权层／访问层双系列与信号样式 | Spec 187 v0.3：同一流带容器叠加授权骨架与访问内核；仅用于 v0.25 P1 访问关系图设计（2026-10-25 需求审查已签核通过，设计口径），不代表组件已实现 | 新增语义角色 `series/grant`、`series/access`，各含 `default` / `subtle`；**闲置授权（原称僵尸授权）的流带本体用 `series/grant` 的 `default`**（与正常授权同色，状态由卡片上的「闲置授权」文字承担，见 [呈现修订 Spec §5.3](../../../docs/specs/lucy-20261030-access-map-quiet-reading-spec.md) 与 [idle-grant-copy](../../../docs/specs/lucy-20261105-access-map-idle-grant-copy-spec.md)）；需复核用 `warning`，确凿越权用 `danger`；需复核虚线、确凿越权实线；禁止裸 hex；状态必须同时有文字或线型，不只靠颜色；实施时验证对比度 | Spec 187 执行者；升级期限：2026-12-31；Spec 187 实施验收（REQ-030-008）时升级到 `01-foundations-color.md` 或移除本条 |

### 已升格临时决策（归档，编号保留供旧 Spec 引用）

| 编号 | 升格到 | 日期 |
|---|---|---|
| TD-174-01 | [`20-patterns-page-layout.md`](20-patterns-page-layout.md) §8 | 2026-11-14 |
| TD-188-01 | [`20-patterns-page-layout.md`](20-patterns-page-layout.md) §10 | 2026-11-14 |
| TD-20261029-01 | [`14-components-filter-input.md`](14-components-filter-input.md)（INV-1–INV-3） | 2026-11-14 |
| TD-20261030-01 | [`20-patterns-page-layout.md`](20-patterns-page-layout.md) §9 | 2026-11-14 |
| TD-20261114-01 | [`15-components-overlay.md`](15-components-overlay.md) §2（v1.1，委托人裁决） | 2026-11-14 |

## 与 UI/UX Ledger 的关系

- `docs/ui-ux-feedback/` 负责记录问题与验收事实。
- `webui/docs/design-system/` 负责沉淀可复用规则。
- 每个跨页面主题在关闭前应尽量落到 Design System 对应章节。

## 发版前界面检查

发版前的三层检查见 [`docs/specs/lucy-20261030-webui-release-ux-review-spec.md`](../../../docs/specs/lucy-20261030-webui-release-ux-review-spec.md)。单次 PR 仍写 Design System Compliance。该清单不代替发版走查，发版走查也不新增视觉模式。

## 版本策略

- `v1.x`：兼容增量，补条目、补示例、补约束。
- `v2.0`：若存在大规模重构或 token 体系迁移，再做主版本升级。
