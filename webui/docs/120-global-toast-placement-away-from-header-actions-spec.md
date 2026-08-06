# Global Toast Placement Away From Header Actions Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Global Toast Placement Away From Header Actions Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-07 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 用户批准方案 A（`bottom-right`）；Playwright 核查 `:55176` toast 与 PageHeader actions 几何重叠；`UX-GLOBAL-SHELL-009` |
| 适用范围 | 全站 sonner `<Toaster />` 默认落点；与 PageHeader `actions` 的冲突规避 |
| 输出位置 | `webui/docs/120-global-toast-placement-away-from-header-actions-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 120 |
| 关联工单 | `webui/docs/plans/wo-202608-53-global-toast-placement-away-from-header-actions.md` |
| 关联页面 | 全站（含 `/publish/workbench` 等带 PageHeader actions 的路由） |
| 关联台账 | `docs/ui-ux-feedback/pages/global-shell.md`（`UX-GLOBAL-SHELL-009`） |
| 上游 Spec | Design System toast 章节（本 Spec 引入）；修订 Spec 28 §5.2 toast 落点偏好 |
| 状态 | Implemented |
| 日期 | 2026-08-07 |
| 范围 | 全局 Toaster 改 `bottom-right`；补 Design System 与台账；禁止 toast 默认占 PageHeader 右上角 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地：`position="bottom-right"`；Design System toast；台账 Fixed |

## 1. 背景

全局 `<Toaster richColors position="top-right" />`（`App.tsx`）与 PageHeader `.pl-page-header-cell--aside` 动作区同占视口右上角。Sonner 默认 `--offset-top/right: 32px`、`--width: 356px`，与 Header actions 起始 `top ≈ 32` 重叠。

Playwright（1440×900）在 `/publish/workbench` 真实触发「KTX 索引重建完成」toast：矩形 `top:32, left:1052, right:1408, bottom:85.5`，与「上传语义资产 / 强制重建索引 / 导出当前快照」三钮及状态 badge 几何相交。同预测框下，带 Header actions 的列表/工作台页（评测、Agent、Wiki、审计导出等）均为 HIGH 风险。

产品讨论：居中更像 Modal，打断主任务且挡正文；批准 **方案 A：移到 `bottom-right`**，目标是避开 Header 动作区，而非抢视觉中心。

## 2. 目标

1. 全局 toast 默认落点不与 PageHeader `actions` / badges 重叠。
2. Toast 保持非阻塞、短暂反馈语义；不改为居中 Modal。
3. 将落点写入 Design System，避免后续 Spec（如 Spec 28）再写「prefer top-right」。
4. 登记 UI/UX 台账与跨页主题，便于回归。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 不做浏览器验证（本轮） | 用户约束；结束后只做 code review |
| 不改各页 toast 文案 / 调用点 | 仅全局落点 |
| 不把成功反馈改为 Dialog / 居中层 | 语义过重 |
| 不按 Header 高度动态 offset 留在 top | 脆弱；Header 有/无 badge 高度不稳 |
| 不统一成功/失败时长策略到本 Spec | 可后续增强 |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Toast | Toast / 消息通知（文档用语） | 弹窗（指 toast 时） | 非阻塞瞬时反馈；非 Dialog |
| PageHeader actions | 页头动作 | — | `.pl-page-header-cell--aside` 内按钮 |

Protected：无新增英文 DOM 术语要求。

## 5. 产品行为

### 5.1 全局落点

- 唯一全局 Toaster：`webui/src/app/App.tsx`。
- **必须** `position="bottom-right"`（保留 `richColors`）。
- **禁止** 默认 `top-right` / `top-center` / 视口正中作为 toast 落点。
- 需要用户确认或读完再继续的反馈，使用 Dialog / Drawer / 页内结果区，不得用居中 toast 冒充。

### 5.2 与 PageHeader 的关系

- PageHeader 右上角保留给对象身份状态与主路径动作。
- Toast 不得覆盖该区可点击控件。
- 关键路径结果仍可 toast；关键阻断原因优先页内披露（既有 Spec 110/115 等）。

### 5.3 修订上游文案

- Spec 28 §5.2「preferably top-right」改为引用本 Spec：使用 **app-standard toast region（`bottom-right`）**。

## 6. API

无后端变更。

## 7. 验收标准

1. `App.tsx` 中 `<Toaster … position="bottom-right" />`；无 `position="top-right"`。
2. Vitest 契约断言覆盖该落点（`app-shell.test.tsx`）。
3. Design System 存在 toast 章节，且 README 索引。
4. 台账 `UX-GLOBAL-SHELL-009` → `Fixed`；跨页主题 `toast vs pageheader actions`；本轮不做浏览器验证。
5. `lint:terminology`；相关测试与 `build` 通过。

## 8. Design System Compliance

- Referenced：新建 `design-system/13-components-toast.md`；PageHeader / button hierarchy（Header 动作区不得被瞬时层盖住）
- Follows：toast = 边角非阻塞；Modal/Dialog = 居中确认
- Exceptions：无
- Deviations：无
