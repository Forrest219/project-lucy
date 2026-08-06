# Lucy WebUI Toast 组件规范

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI Toast 组件规范 |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-07 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | Spec 120；sonner；PageHeader 右上动作区避让 |
| 适用范围 | 全站瞬时消息通知（sonner Toast）；不含 Dialog / Drawer / Banner |
| 输出位置 | `webui/docs/design-system/13-components-toast.md` |

## 1. 目的

约定 Toast 的语义与默认落点，避免与 PageHeader 动作区冲突，并与 Modal 居中确认区分。

## 2. 实现

- 库：`sonner`
- 唯一挂载：`webui/src/app/App.tsx` 的 `<Toaster richColors position="bottom-right" />`
- 调用：各页 `import { toast } from "sonner"`

## 3. 落点（强制）

| 允许 | 禁止（默认） |
|---|---|
| `bottom-right`（全局标准） | `top-right`（与 PageHeader actions 重叠） |
| — | 视口正中（语义过重，易挡正文） |
| — | `top-center` 作为默认（易压标题区） |

需要用户确认或读完再继续 → 用 Dialog / Drawer / 页内结果区，不用居中 toast。

## 4. 语义

| 场景 | 手段 |
|---|---|
| 成功/失败瞬时确认 | Toast |
| 校验失败可读原因 | 页内 issues + 可选 Toast 首因（Spec 110/115） |
| 不可逆 / 门禁确认 | Dialog |
| 长表单 / 上传预检 | Drawer 或页内预检 |

## 5. 与 PageHeader

- PageHeader `actions` / badges 占用主内容右上角。
- Toast **不得**默认覆盖该区可点击控件。
- 刷新、导出、发布等动作触发的 toast 仍走全局 `bottom-right`。

## 6. 验收

- 源码契约：`App.tsx` 含 `position="bottom-right"`，不含默认 `top-right`。
- 详见 Spec 120。
