# Wiki Read Layout and Header Action Hierarchy Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki Read Layout and Header Action Hierarchy Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `http://127.0.0.1:55176/wiki?key=global%2Fdemo-superstore.md`；用户 2 点反馈；`WikiReadView.tsx`、`WikiEditor.tsx`、`app.css`；`webui/docs/36-business-wiki-read-edit-workbench-spec.md`；`UX-WIKI-006` / `027` 同类根因 |
| 适用范围 | 指导 `/wiki` 阅读态正文自上而下布局、PageHeader 文档操作按钮主次与顺序的实现与验收 |
| 输出位置 | `webui/docs/81-wiki-read-layout-and-header-action-hierarchy-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 81 |
| 关联工单 | `webui/docs/plans/wo-202608-13-wiki-read-layout-and-header-action-hierarchy.md` |
| 关联页面 | `/wiki`（阅读态，已加载文档） |
| 关联台账 | `docs/ui-ux-feedback/pages/wiki.md`（新增 `UX-WIKI-036`、`UX-WIKI-037`） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | 阅读视图 CSS 防拉伸；Header actions 主按钮归还给 `编辑`，`上传覆盖` 降为 ghost；更新长期台账主题与治理规则 |

## 1. 背景

用户在阅读态核查 `/wiki?key=global/demo-superstore.md` 后给出 2 点反馈，浏览器 + DOM 测量确认属实：

1. 「Demo Superstore」标题与正文没有从卡片左上角起排；正文出现在面板正中间。CDP 测得 `.pl-wiki-read-view` 的 `gridTemplateRows ≈ 438px / 484px`，标题行被均分拉高，正文 top≈594。
2. 右上 5 个按钮顺序为：下载当前 Markdown → 移动到目录 → 版本记录 → **上传覆盖（primary）** → 编辑（ghost）。黑色高亮落在倒数第 2，不符合「主操作在首或末」的惯例；亦违反 Spec 36「阅读态 Header primary = `编辑`」。

根因 1 与已修的 `UX-WIKI-006`（文档库卡片拉伸）、`UX-WIKI-027`（编辑预览拉伸）同类：CSS Grid 在父级被拉高时，`align-content: normal` 均分 auto 行。

## 2. 目标

1. 阅读态文章标题与正文自卡片左上角自上而下排布，标题行与正文行之间无大块空白。
2. 阅读态已加载文档的 Header actions：唯一 `primary` 为末位的 `编辑`；`上传覆盖` 为 `ghost`；其余治理动作保持 `ghost`。
3. 将本轮问题写入长期台账，并补齐跨页面主题 / 治理规则，避免同类 grid 拉伸与 primary 错位再次漏登。

## 3. 非目标

- 不改编辑态布局（Spec 79 已覆盖）。
- 不改版本记录弹窗（Spec 80）、目录树、上传预检流程或后端 API。
- 不合并 / 删除任一 Header 动作；只调样式与顺序。
- 不做浏览器验证——本轮约束要求收尾只做 code review。

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md` and Spec 36.

| 概念 | UI 主术语 | 说明 |
|---|---|---|
| Read Mode | 阅读态 | 默认查看状态 |
| Edit | 编辑 | 阅读态唯一推荐主路径（primary） |
| Upload Replace | 上传覆盖 | 用本地 Markdown 覆盖当前文档；次要 / 破坏性，不得抢 primary |

No new product terms. Paths / keys / `Markdown` keep `notranslate` / `translate="no"`.

## 5. 阅读区自上而下（对应反馈 1 / UX-WIKI-036）

### 5.1 要求

- `.pl-wiki-read-view` 增加 `content-start`（或等价 `align-content: start`），禁止 header / body 两行被均分拉高。
- `.pl-wiki-read-layout` 同步 `content-start`（有 TOC / 无 TOC 均适用）。
- 空草稿引导（`.pl-wiki-read-empty`）保持紧随标题下方，不因父 grid 拉伸被垂直居中到面板中部。
- 验收（非浏览器）：`app.css` 源文本断言含 `.pl-wiki-read-view` 的 `content-start`；既有阅读态渲染测试继续通过。

## 6. Header 动作主次与顺序（对应反馈 2 / UX-WIKI-037）

### 6.1 要求

已加载文档、阅读态 Header actions 固定为：

| 顺序 | 按钮 | `data-testid` | 样式 |
|---|---|---|---|
| 1 | 下载当前 Markdown | `wiki-download-button` | `pl-btn--ghost` |
| 2 | 移动到目录 | `wiki-move-button` | `pl-btn--ghost` |
| 3 | 版本记录 | `wiki-version-button` | `pl-btn--ghost` |
| 4 | 上传覆盖 | `wiki-upload-replace-button` | `pl-btn--ghost` |
| 5 | 编辑 | `wiki-edit-button` | **`pl-btn--primary`** |

约束：

- 同组最多一个 `primary`，且必须是 `编辑`（对齐 Spec 36）。
- `上传覆盖` 不得使用 `primary`（破坏性覆盖，非默认下一步）。
- 顺序与 testid 契约保持稳定，便于测试与后续 E2E。

## 7. 长期台账机制更新

### 7.1 页面台账

在 `docs/ui-ux-feedback/pages/wiki.md` 追加：

- `UX-WIKI-036`：阅读态标题/正文被 grid 拉伸到中部。
- `UX-WIKI-037`：阅读态 Header primary 错位（上传覆盖高亮在倒数第 2）。

状态均为 `Fixed`（本轮不做浏览器验证）。

### 7.2 跨页面主题索引

在 `docs/ui-ux-feedback/README.md`：

1. 新增主题 `css grid track stretch`（父级拉高时 auto 行均分，须 `content-start`）：挂 `UX-WIKI-006`、`027`、`036`。
2. 更新主题 `button hierarchy consistency`：增挂 `UX-WIKI-037`；说明「唯一主路径 primary 须在组首或组末，且与 Spec 主动作一致」。
3. 最近维护记录追加本轮 Spec 81 条目。

### 7.3 跨页面治理规则

追加一条：

> 可拉伸的 CSS Grid 内容面板（阅读卡片、预览面板、空态容器等）必须显式 `content-start` / `align-content: start`（或把标题外提到 `auto` 行），禁止依赖默认 `align-content: normal` 在父级被拉高时均分 auto 行，导致标题/正文垂直居中或大块留白。同类已见 `UX-WIKI-006` / `027` / `036`。

既有规则「同一 action group 最多一个 primary，且仅当存在唯一推荐主路径」继续有效；本 Spec 以 `编辑` 作为 Wiki 阅读态的该主路径。

## 8. 测试要求

更新 `webui/src/__tests__/wiki.test.tsx`：

- 阅读态已加载文档：`wiki-edit-button` 带 `pl-btn--primary`；`wiki-upload-replace-button` 不带 `pl-btn--primary`。
- 五个按钮在 `wiki-header-actions` 内的 DOM 顺序符合 §6.1。
- `app.css` 断言 `.pl-wiki-read-view` 规则含 `content-start`。

验证命令：

```bash
cd webui
npm run lint:terminology
npm test -- src/__tests__/wiki.test.tsx
npm run build
git diff --check
```

## 9. 验收标准（非浏览器）

- 阅读视图 CSS 已防拉伸。
- Header：`编辑` 为末位 primary；`上传覆盖` 为 ghost。
- 台账 `UX-WIKI-036`/`037` 为 `Fixed`；README 主题与治理规则已更新。
- 验证命令通过；code review 确认范围与本 Spec 一致。

## 10. 风险与边界

- 父级若另有 `min-height` / flex stretch，仅改 `content-start` 通常足够；若回归仍见留白，再查 `pl-wiki-body` / `pl-wiki-main` 是否强制等高（本轮不预扩 scope）。
- 降权「上传覆盖」可能降低可发现性；接受为正确层级。若后续需要强化，用 `secondary` 描边，仍不得压过「编辑」。
