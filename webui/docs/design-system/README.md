# Lucy WebUI Design System

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI Design System |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | `docs/ui-ux-feedback/README.md`、`webui/src/app/app.css`、按钮一致性修复需求 |
| 适用范围 | Lucy WebUI 设计规范总入口与章节导航 |
| 输出位置 | `webui/docs/design-system/README.md` |

本目录沉淀 Lucy WebUI 的长期设计规范，分为 Foundations、Components、Patterns 和 Governance 四层。

## 目录

- `00-principles.md`：设计原则与验收基线
- `01-foundations-color.md`：颜色语义与状态映射
- `02-foundations-grid-spacing.md`：网格、间距与断点
- `03-foundations-typography.md`：字体层级与可读性规范
- `10-components-button.md`：按钮组件规范（v1.1：选中分离、Header 预算、`pl-icon-btn`；见 Spec 101）
- `11-components-data-grid.md`：数据网格规范（字体、对齐、列宽、密度、测试契约）
- `12-components-metric-card.md`：列表页 KPI Metric Card（Connections 基准、必有 ⓘ；见 Spec 103）
- `13-components-toast.md`：Toast 落点与语义（默认 `bottom-right`，避让 PageHeader；见 Spec 120）
- `20-patterns-page-layout.md`：页面布局模式骨架（列表页/概览页/配置页）
- `30-pr-compliance-template.md`：PR 的 Design System Compliance 模板
- `99-governance.md`：规范变更流程与执行要求

## 使用方式

- 开发前：先定位需求涉及的规范章节（如按钮、颜色、网格）。
- 开发中：禁止在组件里绕开规范直接硬编码视觉值。
- 提交前：在 PR/交付说明中增加“Design System Compliance”小节，说明本次遵循了哪些章节。
- 规范缺失：先在 `99-governance.md` 记录临时决策，再补齐对应章节。

## Viewport Policy（桌面基线）

- 基线设备：`MacBook 13"` 为最低可读保障，`MacBook 14"` 为主设计靶点。
- 默认策略：Lucy WebUI 当前版本为桌面优先，不要求移动端重排。
- 约束策略：当窗口宽度低于“桌面最小可读宽度”时，页面应锁定桌面布局最小宽度，并通过横向滚动承载，不得继续压缩核心内容区。
- 细则定义：阈值与容器规则见 `02-foundations-grid-spacing.md`；页面级行为见 `20-patterns-page-layout.md`。
