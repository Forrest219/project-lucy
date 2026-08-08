# Publish Workbench CTA Confirm Path Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish Workbench CTA Confirm Path Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-07 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核实 Header「发布并重建索引」打开「发布语义资产」上传侧栏；批准计划 `publish_cta_fix`；Spec 35 / 112 / 119 |
| 适用范围 | `/publish/workbench` Header「发布并重建索引」与「上传语义资产」路径分离 |
| 输出位置 | `webui/docs/121-publish-workbench-cta-confirm-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 121 |
| 关联工单 | `webui/docs/plans/wo-202608-54-publish-workbench-cta-confirm.md` |
| 关联页面 | `/publish/workbench` |
| 关联台账 | `docs/ui-ux-feedback/pages/publish-workbench.md`（`UX-PUBLISH-WORKBENCH-006`） |
| 上游 Spec | Spec 35 §6.2；Spec 112 Header CTA；Spec 119 队列–门禁 IA |
| 状态 | Implemented |
| 日期 | 2026-08-07 |
| 范围 | 确认发布 Drawer；拆分 upload vs confirm 状态；Header CTA 调 reindex |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented：确认 Drawer + 路径分离 + 台账 Fixed |

## 1. 背景

门禁 `ready` 时 Header「发布并重建索引」与「上传语义资产」共用 `setPublishOpen(true)`，打开 `SemanticAssetPublishDrawer`（标题「发布语义资产」、选文件/粘贴 YAML）。用户预期是对**已在工作区的待发布变更**确认生效并重建索引，不是再次上传。

待发布文件来自 `GET /api/diff`，已在 `semantic-layer/`（及 wiki 等）工作区；无单独 promote-pending API。生效路径：确认 → `POST /api/semantic-assets/reindex` → Toast / 发布记录。

## 2. 目标

1. 两条路径严格分离：
   - **上传语义资产** → `SemanticAssetPublishDrawer`（发布语义资产）
   - **发布并重建索引** → 确认 Drawer → reindex
2. 确认 Drawer 标题 `确认发布并重建索引`；禁止「发布语义资产」与选文件 UI。
3. 确认后调用既有 reindex API；成功关闭 Drawer，保留门禁「下一步」/评测提示。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 新 promote-pending API | 文件已在正式路径 |
| 改造上传 Drawer 为双模式 | 易再混淆 |
| 浏览器验证（本轮） | 用户约束；结束后 code review |
| 改 Validate Gate / 批量分文件发布 | 范围外 |

## 4. Terminology Compliance

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Confirm Publish Drawer | 确认发布并重建索引 | 发布语义资产（作本 Drawer 标题） | Header CTA 确认侧栏 |
| Upload Semantic Assets | 上传语义资产 | — | 打开上传 Drawer 的入口 |
| Publish Semantic Assets Drawer | 发布语义资产 | — | 仅上传路径 Drawer 标题（既有） |
| Publish and Reindex | 发布并重建索引 | — | Header CTA 与确认提交主按钮 |

Protected：`KTX`、`MCP`、`Agent`、路径与表名。

## 5. 产品行为

### 5.1 Header

- 有待发布且 gate≠ready：`发布并重建索引` disabled；点击无效。
- gate=ready：点击打开确认 Drawer（**不得**打开上传 Drawer）。
- `上传语义资产`（空态 Header / 高级）：仅打开上传 Drawer。

### 5.2 确认 Drawer

```text
标题：确认发布并重建索引
摘要：N 个待发布文件；Schema Manifest / 表语义变更计数（可复用门禁分流）
说明：将重建 KTX 索引，使 Agent / MCP 读取最新语义资产。
[取消] [发布并重建索引]
```

- `data-testid="workbench-publish-confirm-drawer"`
- 提交：`POST /api/semantic-assets/reindex`（与强制重建同 API；入口文案不同）
- 成功：Toast「KTX 索引重建完成」；关闭确认 Drawer
- Escape / 关闭 / backdrop 关闭；无文件选择控件

### 5.3 与 Spec 35 / 112

修订 Spec 35 §6.2：`发布并重建索引` 工作台路径为确认 + reindex，**不得**打开上传 Drawer；上传 Drawer 内 submit 仍可称「发布并重建索引」。

## 6. API

无新端点。复用 `POST /api/semantic-assets/reindex`。

## 7. 验收标准

1. gate=ready 点 Header CTA → 确认 Drawer；无 `semantic-asset-publish-drawer`；无「选择文件」。
2. 确认提交调用 reindex；成功关闭确认 Drawer。
3. 「上传语义资产」仍打开「发布语义资产」上传侧栏。
4. Vitest `review.test.tsx`；`lint:terminology`；`build`。
5. 台账 `UX-PUBLISH-WORKBENCH-006` → Fixed（本轮不做浏览器验证）。

## 8. Design System Compliance

- Referenced：`pl-drawer-*`、`pl-btn` hierarchy、Spec 112 CTA
- Follows：同组最多一 primary；上传与确认路径分离
- Exceptions：无
- Deviations：无
