# Lucy WebUI 浮层组件（Drawer / Dialog / Modal）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI 浮层组件（Drawer / Dialog / Modal） |
| 文档类型 | Spec |
| 版本 | v1.2 |
| 撰写日期 | 2026-11-14（v1.1 同日：委托人裁决收敛方向；v1.2 同日：更正存量文件数为不含测试文件口径） |
| 撰写人 | Claude |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/src/app/app.css`、`webui/src/components/*Drawer.tsx`、`*Dialog.tsx`、`13-components-toast.md`、`20-patterns-page-layout.md` §9、`inbox/20261114-0130-uiux-standard-audit.md` |
| 适用范围 | 所有覆盖主内容的浮层：右侧抽屉、居中对话框 |
| 输出位置 | `webui/docs/design-system/15-components-overlay.md` |

## 1. 何时用哪一种

与 [`13-components-toast.md`](13-components-toast.md) §4 一致，本章补充浮层之间的选择：

| 场景 | 用 | 理由 |
|---|---|---|
| 不可逆操作、门禁确认、短确认 | Dialog（居中） | 打断，必须当场决定 |
| 长表单、上传预检、保存／发布预检、对象详情 | Drawer（右侧） | 需要上下文和滚动，不要求立刻决定 |
| 瞬时成功／失败反馈 | Toast | 不打断 |
| 用户需读完再继续 | Dialog／Drawer／页内结果区 | 不得用居中 Toast |

## 2. 收敛方向（委托人 2026-11-14 裁决）

**行为基座统一为 Radix Dialog**（`@radix-ui/react-dialog`）：焦点陷阱、`Esc`、`aria-modal`、焦点归还由它负责。样式只保留两族：

| 形态 | 标准类名族 | 说明 |
|---|---|---|
| Drawer | `pl-drawer-overlay` ＋ `pl-drawer-panel`（含 `-header`／`-body`／`-footer`） | Radix 抽屉的标准写法，先例 `WikiAccessDrawer` |
| Dialog | `pl-dialog-overlay` ＋ `pl-dialog-content` ＋ `pl-dialog-actions` | 居中对话框 |

存量（2026-11-14 盘点，不含测试文件；逐文件清单见 [整改 Spec](../../../docs/specs/lucy-20261114-webui-uiux-remediation-spec.md) UXR-01–03）与迁移目标：

| 存量 | 文件数 | 目标 | 迁移优先级 |
|---|---|---|---|
| 手写 Drawer（`pl-drawer-backdrop`＋`pl-drawer-panel`，非 Radix） | 17 | Radix＋`pl-drawer-overlay` | **1**：其中多数未见 `Esc` 处理，属可达性缺口 |
| `pl-modal-backdrop`＋`pl-modal-panel`（手写） | 7 | Radix＋`pl-dialog-*` | 2 |
| `pl-wiki-preflight-*`（已是 Radix） | 8 | 样式并入 `pl-dialog-*` | 3，仅换样式，风险最低 |
| 已是 Radix 的 Drawer | 6 | 保持 | — |

`pl-drawer-backdrop` 视为旧写法：新代码不得使用；改动相关文件时顺手迁移。

**迁移是运行代码改动**，须先入 0.30 总账并取得委托人开发授权，不随文档变更自动发生。存量迁移完成前不要求一次性改完。

## 3. 新代码的强约束

1. **新增浮层必须使用 Radix Dialog＋§2 的标准类名族**；不得新增第三套样式族，不得使用 `pl-drawer-backdrop`、`pl-modal-*`、`pl-wiki-preflight-*`。
2. **结构**：页头（标题＋关闭）、正文、页脚（操作区）三段。需要长内容时，页头页脚固定，正文是唯一纵向滚动区（`min-height: 0` + `overflow-y: auto`）。
3. **操作区顺序**：次要／取消在左，主要／危险在右；沿用 [`10-components-button.md`](10-components-button.md) 的层级，危险操作用 `pl-btn--danger`。
4. **提交中**：主按钮与取消均禁用，主按钮文案改为进行时（如「删除中...」），防止重复提交。
5. **错误**：服务端错误显示在浮层内（`pl-error` 或 `pl-drawer-error`），不得只用 Toast；失败后恢复可操作。
6. **宽度**：沿用现有最大宽度，不得为多放内容改共享类；页面专属宽度由组件内联（先例见 `20-patterns-page-layout.md` §9）。
7. **内容不得静默截断**：列表、路径、原因默认完整可见或可展开，不得只靠 hover。
8. **术语与翻译防御**：路径、表名、数据库对象名使用 `notranslate` 与 `translate="no"`（见术语标准）。

## 4. 可达性（必须）

- 具有 `role="dialog"` 和 `aria-modal="true"`，或使用提供等价语义的 Radix Dialog。
- 有可访问名称（标题）；有说明文字时用 `aria-describedby` 关联。
- 打开时焦点进入浮层；`Esc` 关闭（提交中除外）；关闭后焦点回到触发入口。
- 关闭按钮可键盘操作；遮罩点击是否可关闭，须与是否有未保存内容一致，有未保存内容时不得静默关闭。

## 5. 验收清单

- 选型是否符合 §1？
- 是否使用 Radix Dialog＋§2 标准类名族？
- 提交中是否禁用、失败是否在浮层内可见？
- 键盘能否进入、关闭并回到入口？
- 长内容是否只有正文一个滚动区？

## 6. 待补充（v1.1）

- 迁移获授权并完成后，删除 §2 存量表，改写为纯现状规范。
- 各形态的线框示例。
