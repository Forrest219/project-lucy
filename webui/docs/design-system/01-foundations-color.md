# Lucy WebUI 颜色规范（Foundations）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI 颜色规范（Foundations） |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | 现有 `webui/src/app/app.css` 色彩 token 与 UI/UX 反馈 |
| 适用范围 | Lucy WebUI 全局颜色语义、状态色和可访问性基线 |
| 输出位置 | `webui/docs/design-system/01-foundations-color.md` |

## 语义色分层

禁止业务组件直接绑定“色值含义”，统一使用语义层：

- `bg/*`：页面背景、容器背景
- `fg/*`：正文、次要文本、反色文本
- `border/*`：边框、分割线、焦点环辅助层
- `brand/*`：品牌主色与交互强调
- `success/warning/danger/info/*`：状态语义色

## 状态映射

每类可交互颜色至少提供：

- `default`
- `hover`
- `active`
- `disabled`
- `subtle`（用于弱提示背景/边框）

## 使用约束

- 不在组件内写裸 hex/rgb 值；统一经 token 或语义 class 引用。
- 危险色仅用于危险语义，不得用于普通强调。
- 文本与背景对比度必须满足可读性要求（正文和按钮文案优先保障）。
- 焦点态不可仅靠颜色变化；需要与 outline/ring 共同表达。

## 待补充（v1.1）

- 明确各语义色的 token 对照表（Design token -> CSS class -> 使用场景）
- 明确深浅主题切换策略（若后续引入 dark mode）
