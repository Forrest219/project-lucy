# Publish Workbench Queue–Gate IA Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish Workbench Queue–Gate IA Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-07 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 用户批准的改善方案 A；浏览器核查 `/publish/workbench`（`:55176`）；`UX-PUBLISH-WORKBENCH-005`；Spec 112 / 35 / 115 |
| 适用范围 | `/publish/workbench` 首屏信息架构：待办队列 + 发布门禁主工作面；变更详情下沉 |
| 输出位置 | `webui/docs/119-publish-workbench-queue-gate-ia-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 119 |
| 关联工单 | `webui/docs/plans/wo-202608-52-publish-workbench-queue-gate-ia.md` |
| 关联页面 | `/publish/workbench` |
| 关联台账 | `docs/ui-ux-feedback/pages/publish-workbench.md`（`UX-PUBLISH-WORKBENCH-005`） |
| 上游 Spec | Spec 112（流程与门禁 IA；本 Spec **修订**其 §5.3 三栏布局）；Spec 35（导航与发布即索引不变）；Spec 115（校验披露不变） |
| 状态 | Implemented |
| 日期 | 2026-08-07 |
| 范围 | 双栏工作台（待发布变更 \| 发布门禁）；变更详情改为按需 Drawer；空 Diff 不得占默认主舞台 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地：队列–门禁双栏；Diff / 变更详情 Drawer；修订 Spec 112 §5.3 |

## 1. 背景

Spec 112 将三栏定名为「待发布变更 | 变更详情 | 发布门禁」，修了角色标题与流程发现性，但骨架仍是 **代码审阅** 范式（文件列表 | Diff | Checks）。浏览器实测（1440×900）：

| 栏 | 标题 | 宽度占比 |
|---|---|---|
| 左 | 待发布变更 | ~26% |
| 中 | 变更详情 | ~43%（最大） |
| 右 | 发布门禁 | ~31% |

用户对「发布工作台」的第一视角是 **待办 → 选择 → 批准**，与最大栏留给 Diff、批准面挤在最右 的布局矛盾。现场常出现空 Diff（「该文件暂无可展示的补丁内容。」）却仍占主舞台，进一步削弱工作感。

产品批准 **方案 A**：双栏工作台 + Diff 下沉（不改发布即索引、不做批量分文件发布）。

## 2. 目标

1. 首屏主叙事对齐工作台心智：**待发布变更（队列/选择）→ 发布门禁（校验/批准）**。
2. **变更详情**（路径副标题 + 业务状态 + Diff）按需打开，默认不占最大栏。
3. 空 Diff 时不得以空白主舞台主导视线。
4. 保留 Spec 112 的门禁步骤、Header 收口、Schema/表影响分流、进页自动校验、Spec 115 校验 issues 披露。
5. 同步术语、Spec 交叉引用、UI/UX 台账。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 不做浏览器验证（本轮） | 用户约束；结束后只做 code review |
| 不改 Validate Gate / reindex / publish API | 仅 UI/IA |
| 不新增二级导航 | Spec 35 已定 |
| 不做批量勾选 / 分文件发布 | 产品契约仍为整包发布；勾选留后续 |
| 不在本页做语义编辑 | 归属 `/catalog` |
| 不改 Spec 115 scrub / issues 行为 | 仅布局 |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md` §4.3；本 Spec 修订下列说明：

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Publish Gate Panel | 发布门禁 | 变更影响范围（作唯一栏标题）、Validate Gate（作栏标题） | 工作台 **主工作面**（宽栏）；非最右窄栏 |
| Pending Changes | 待发布变更 | — | 左栏队列；选择文件以打开变更详情 |
| Change Detail | 变更详情 | 裸路径作主标题；默认常驻最大栏 Diff | 按需 Drawer（或等价面板）；路径为副信息 |
| File Change Status | 已修改 / 新增 / 已删除 / 已重命名 / 已变更 | 状态：W、M、A（裸码） | 同 Spec 112 |

Protected：同 Spec 112 / 115。

## 5. 产品行为

### 5.1 双栏主布局（修订 Spec 112 §5.3）

```text
┌ 待发布变更 ────┐  ┌ 发布门禁 ─────────────────────────────┐
│ 文件队列        │  │ 步骤：审阅变更 → 校验 → 发布并重建索引 │
│ 点击打开详情    │  │ 下一步说明 · 影响分流 · 校验摘要       │
│                 │  │ 高级（重建/上传/边界）                 │
└─────────────────┘  └───────────────────────────────────────┘
         ↓ 用户选择文件
┌ 变更详情 Drawer ───────────────────────────────────────────┐
│ 角色标题「变更详情」· 路径副标题 · 业务状态 · Diff           │
└────────────────────────────────────────────────────────────┘
```

- 左栏：`待发布变更`；文件行可点；`active` 表示当前打开详情的文件。
- 主栏（宽）：`发布门禁`；承载 Spec 112 §5.1 步骤、下一步文案、影响分流、校验摘要、高级。
- **禁止** 默认三栏把 Diff 放在中间最大列。
- 窄视口允许门禁在队列下方堆叠，但仍不得把 Diff 插回默认主舞台。

### 5.2 变更详情 Drawer

- 点击左栏文件 → 打开 Drawer（`data-testid="workbench-change-detail-drawer"`）。
- Drawer 标题：`变更详情`；路径 `notranslate` 副信息；状态用 `fileChangeStatusLabel`。
- 正文：`DiffViewer`；无补丁时展示既有空态文案，仅出现在 Drawer 内。
- 关闭：显式关闭控件 + backdrop；关闭后左栏可选中态可保留或清除，但 **不得** 把 Diff 回填到主栏。
- 进页 **不** 自动打开 Drawer（即使有待发布文件）。

### 5.3 保留不变（引用 Spec 112 / 115）

- PageHeader 空态 / 有变更动作切换；禁止「表目录」。
- 门禁步骤与 `gateNextStepCopy`；主 CTA 仍在 Header，门禁区不放第二颗 primary。
- Schema Manifest vs 表 overlay 影响分流。
- 有待发布时进页自动校验一次。
- 校验失败 issues + 技术详情（Spec 115）。

### 5.4 与 Spec 112 / 35 的关系

- **修订** Spec 112 §5.3 三栏 ASCII 与验收「三栏标题」条款：改为双栏 + Drawer。
- Spec 112 其余条款（流程、Header、影响分流、自动校验）仍有效。
- Spec 35：导航、「发布即索引」、Validate Gate fail-closed、`/review` 重定向不变；顶部交叉引用追加本 Spec。

## 6. API

无新后端端点。

## 7. 验收标准

1. `[data-testid=publish-workbench-layout]` 默认仅两栏：左「待发布变更」、主「发布门禁」；DOM 中无常驻第三栏 Diff 主舞台。
2. 点击待发布文件后出现 `workbench-change-detail-drawer`，内含「变更详情」与 Diff / 空态。
3. 进页有待发布时 **不** 自动打开 Drawer。
4. 门禁步骤、校验摘要、Header 收口、Schema 不影响表列表行为与 Spec 112/115 一致。
5. Vitest `review.test.tsx` 绿；`lint:terminology`；`build`。
6. 台账 `UX-PUBLISH-WORKBENCH-005` → `Fixed`（本轮不做浏览器验证）。

## 8. Design System Compliance

- Referenced：`PageHeader`、`pl-btn`、`pl-drawer-*`、`pl-review-layout`（改为双栏）、跨页 `publish flow discoverability` / 新主题 `publish workbench queue-gate ia`
- Follows：同组最多一 primary；Diff 为证据、按需打开；侧栏兄弟入口不进 Header
- Exceptions：工作流 badges 保留（Spec 91）
- Deviations：无
