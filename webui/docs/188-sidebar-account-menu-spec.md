# 188 · 侧栏账户菜单

| 元数据 | 内容 |
|---|---|
| 版本 | v1.0 |
| 日期 | 2026-10-21 |
| 状态 | 用户已批准；实现验证范围为 Code Review，不运行测试、构建或 Docker 重建 |
| 范围 | WebUI 全局侧栏页脚；沿用现有 `/help` 路由和 `AuthProvider.logout` |

## 需求与边界

已登录时，侧栏左下角只显示一个账户按钮：用户图标、登录账户 ID、展开指示符，整行可点击。ID 单行省略，菜单内完整显示 ID、显示名和真实角色（`owner` → 所有者，`operator` → 运维）。

点击后向上展开：只读身份信息、系统手册、分隔线、退出登录。系统手册直接导航至 `/help`；退出登录调用原有逻辑，不新增确认步骤或更改会话清理语义。

开放模式、未登录的公开帮助页及无认证上下文的壳层保留原有独立系统手册入口，不显示虚构账户或退出登录。账户切换、会话失效和路由切换均关闭菜单。

本次不新增侧栏整体折叠能力或移动布局；遵循既有桌面最小可读宽度策略。版本信息仍在「系统设置 / 版本信息」。本规格更新 Spec 67 的“系统手册在底部稳定可见”要求：登录后通过底部账户菜单访问，未登录或开放模式仍直接可见。

## 交互与布局

- 菜单通过 Portal 挂到 `document.body`，避免侧栏 `overflow-hidden` 裁切；固定定位在按钮上方，宽度 288px，视口边距及按钮间距 8px。窗口变化或滚动时重算位置，高度不足时内部滚动。
- 点击入口切换展开；点击外部或焦点移到菜单与入口之外时关闭；Esc 关闭并归还焦点。
- Enter / Space 激活账户按钮；上 / 下方向键打开并聚焦最后 / 第一项。菜单支持上下循环、Home / End、Enter / Space 执行；Tab 关闭并从入口继续正常焦点顺序。
- 身份信息不作为菜单项。使用 `aria-haspopup`、`aria-expanded`、`aria-controls` 和菜单语义；账户标识添加 `translate="no"` 与 `notranslate`。
- 退出登录期间禁用入口、防止重复提交；失败显示错误并恢复可操作状态，继续沿用认证层的刷新行为。

## 核心流程（伪代码）

```text
if mode != required or me is absent:
  render standalone handbook link
else:
  mount account menu keyed by account ID
  open -> measure trigger -> render portal -> focus first/last menu item
  outside pointer/focus or route change -> close
  Escape -> close -> focus trigger
  Tab -> close -> focus trigger -> allow native Tab traversal
  handbook -> close -> navigate /help
  logout -> close -> disable trigger -> await existing auth.logout
    failure -> show error
    finally -> enable trigger if still mounted
```

## 验收标准

| 编号 | 标准 |
|---|---|
| AC-01 | 已登录时页脚只有一个单行账户按钮；菜单关闭时无独立手册或退出登录控件 |
| AC-02 | 两种角色均显示真实账户 ID、显示名及中文角色；长文本在入口省略、在菜单换行完整显示 |
| AC-03 | 展开菜单不改变主布局；有身份信息、系统手册和底部分隔后的退出登录，无嵌套菜单 |
| AC-04 | 系统手册仍指向 `/help`，点击后菜单关闭；退出登录仅调用现有认证流程一次 |
| AC-05 | 再点入口、外部点击、焦点离开、Esc 和路由切换均可关闭；Esc 后焦点归还入口 |
| AC-06 | 可仅用键盘打开、选择、执行和离开菜单；焦点样式明确 |
| AC-07 | 菜单绕过侧栏裁切，位置及最大高度随窗口和滚动更新；内容可滚动访问 |
| AC-08 | 开放模式、未登录公开帮助页保留手册入口，不提供账户或退出操作；账户切换无旧身份菜单残留 |
| AC-09 | 退出请求进行中防止重复操作，失败有反馈且入口可恢复 |

## Terminology Compliance

本功能遵守 `webui/docs/00-product-terminology-standard.md`。

New terms:
- 账户菜单：WebUI 当前登录账户的辅助操作入口；与 MCP Agent / 角色权限无关。
- 系统手册、退出登录、所有者、运维沿用既有术语。

## Design System Compliance

引用 `design-system/01-foundations-color.md`、`02-foundations-grid-spacing.md`、`03-foundations-typography.md`、`10-components-button.md`。沿用语义色、4/8/12/16px 间距、低干扰入口、正文级菜单文字、既有圆角及阴影、可见焦点环；退出操作使用分隔线区分。Portal 账户浮层登记于 `design-system/99-governance.md` TD-188-01。

## 验证记录

本次仅静态代码审查。自动化回归用例随代码维护但不执行；未运行测试、构建或浏览器验证，未重建 Docker，也不据此声明运行时或视觉验收通过。
