# Selector 契约表（活文档 · v0.3 重写版）

| 元数据 | 内容 |
|---|---|
| 维护者 | QA Lead + Frontend |
| CI 守门脚本 | `webui/scripts/check-selector-contract.mjs`（npm run e2e:selector-contract） |
| 关联主文档 | [`lucy-webui-e2e-test-suite.md`](lucy-webui-e2e-test-suite.md) §5 / §7 |
| 规则 | ① 实现的 `data-testid` 必须在本表登记 ② L1/L2 spec 引用的 testid 必须有实现 ③ 双向不符 → fail |

---

## 0. 维护教训（v0.3 关键变更）

**v0.2 的根本错误**：我（助手）之前**凭空发明**了大量"应该存在的"testid（如 `connection-card-mysql-aliyun-btn-add-schema`、`catalog-upload-paste-textarea`、`semantic-asset-publish-drawer-submit`），与实现 `webui/src/` 中的实际 testid **大面积不一致**，导致 spec 一上来就 fail。

**v0.3 重写原则**：
1. 本表**只列 `webui/src/` 实际存在的 `data-testid`**（不包含 `webui/src/__tests__/` 的 vitest 夹具）
2. **不发明任何 testid**；spec 缺什么 → 先在实现里加 testid，再回到本表登记
3. 守门脚本**双向** fail：实现新增未登记 → fail；spec 引用但实现缺失 → fail
4. 模板 testid（如 `connection-card-${conn.id}`）以反引号代码块形式登记

---

## 1. 全局 / Layout

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `page-header` | 页面 header 根 | `components/PageHeader.tsx` |
| `page-header-badges` | 状态徽章容器 | `components/PageHeader.tsx` |
| `page-header-actions` | 页面操作容器 | `components/PageHeader.tsx` |
| `current-location` | 当前导航高亮 | `app/App.tsx` |
| `sidebar-footer` | 侧栏底部 | `app/App.tsx` |
| `sidebar-utility` | 侧栏工具区 | `app/App.tsx` |

## 2. 数据接入（src/pages/connections/）

### 2.1 ConnectionOverview.tsx

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `connection-metric` | 顶部指标卡 | — |
| `connection-card-${conn.id}` | 连接卡片根 | — |
| `connection-readonly-${conn.id}` | `预期只读` 低权重提醒 | 禁止 `Read-only expected` 露出 |
| `connection-kv-${conn.id}` | 卡片 KeyValue 网格 | 必含 `Host / Database`；不得逐卡出现 `配置文件 / 凭据来源` |
| `connection-refresh-warning-${conn.id}` | 未刷新 amber Banner | 文案 `本地目录未刷新：尚未读取本地 YAML 资产配置。` + `立即刷新` |
| `connection-refresh-warning-action-${conn.id}` | Banner `立即刷新` 按钮 | 必含 `立即刷新`，无 `↗` |
| `connection-card-schema-actions-${conn.id}` | 卡片 Schema 上下文操作区 | — |
| `engine-badge-${conn.id}` | 驱动 Badge | — |
| `connection-last-reload-${conn.id}` | Header 右侧上次刷新时间 | 仅展示 `上次刷新：<timestamp>`，不得展示表数/提示数摘要 |
| `catalog-reload-status-${conn.id}` | Catalog 刷新加载/失败状态 | 仅用于 pending / error / 最近失败状态；健康成功态不出现 |
| `catalog-reload-warning-${conn.id}-${schema}` | Schema Catalog 警告 | — |
| `catalog-reload-warning-details-${conn.id}-${schema}` | 警告详情 | — |
| `schema-asset-table-${conn.id}` | Schema 资产表 | 列：`Schema / Manifest 状态 / 本地表数 / 启用表数 / 操作` |
| `schema-row-${conn.id}-${schema}` | Schema 行 | 状态枚举 `已存在` / `缺失 Manifest` / `解析失败` |
| `schema-asset-status-${conn.id}-${schema}` | Schema Manifest 状态 cell | 必含 `已存在` / `缺失 Manifest` / `解析失败` 之一 |
| `schema-enabled-count-${conn.id}-${schema}` | Schema 启用表数 cell | 数值来自该 Schema 下 `enabled_tables` 计数 |
| `schema-whitelist-${conn.id}-${schema}` | `维护启用范围` / `上传 Manifest` 上下文动作 | 必含 `维护启用范围` 或 `上传 Manifest`；不得出现 `维护白名单` |
| `add-schema-${conn.id}` | `+ 添加 Schema` 按钮 | 禁止 `添加架构` / `添加模式` |

### 2.2 AddSchemaDrawer.tsx

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `add-schema-drawer-backdrop` | Drawer 背景遮罩 | — |
| `add-schema-drawer` | Drawer 根 | 标题 `添加 Schema` |
| `add-schema-close` | 关闭按钮 | — |
| `add-schema-input` | Schema 名 input | Label `Schema 名` |
| `add-schema-input-error` | input 错误提示 | — |
| `add-schema-preview-btn` | `测试连接可用性` 按钮 | 禁止 `替代测试` |
| `add-schema-connection-test-failed` | 测试失败错误 | — |
| `add-schema-confirm-btn` | `写入 ktx.yaml 并完成` 按钮 | — |
| `add-schema-success-message` | 成功提示 | 必含 `已添加到` |
| `add-schema-static-loading-hint` | 静态加载提示 | — |
| `add-schema-fatal-error` | Drawer 致命错误 | `role="alert"` |
| `toggle-ktx-output` | ktx 输出折叠按钮 | — |
| `ktx-output-detail` | ktx 输出详情 | — |

> **MISSING**：实现当前没有 4 段 stepper 的分段 testid（§E2E-CON-02）；若要做精细 stepper 断言需先在 AddSchemaDrawer 加 `add-schema-step-1` / `step-2` / `step-3` / `step-4`。

### 2.3 CatalogAssetUploadDrawer.tsx（src/components/catalog/）

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `catalog-asset-upload-drawer` | Drawer 根 | 标题 `上传 Schema Manifest` |
| `catalog-asset-upload-panel` | Drawer 面板 | — |
| `catalog-asset-upload-close` | 关闭按钮 | — |
| `catalog-asset-upload-schema` | Schema 选择下拉 | — |
| `catalog-asset-upload-target-file` | 目标文件路径 | — |
| `catalog-asset-upload-filename` | 文件名 | — |
| `catalog-asset-upload-filename-display` | 文件名显示 | — |
| `catalog-asset-upload-dropzone` | 拖拽区 | 接受 `.yaml` `.yml` |
| `catalog-asset-upload-file` | 已选文件 | — |
| `catalog-asset-upload-file-summary` | 文件摘要 | — |
| `catalog-asset-upload-pick-file` | 选择文件按钮 | — |
| `catalog-asset-upload-textarea` | YAML 文本粘贴 | — |
| `catalog-asset-upload-confirm-overwrite` | 覆盖确认 checkbox | — |
| `catalog-asset-upload-submit` | 提交按钮 | 必含 `上传` |
| `catalog-asset-upload-success` | 成功提示 | 必含 `已上传` + 解析表数 |
| `catalog-asset-upload-target-display` | 目标路径显示 | — |
| `catalog-asset-upload-primary` | 成功后续 Primary 按钮（`前往配置启用表范围 →`） | — |
| `catalog-asset-upload-secondary` | 成功后续 Secondary 按钮（`完成并关闭`） | — |
| `catalog-asset-target-path` | 目标路径 | — |
| `catalog-asset-validation-panel` | Validation Panel 根 | 必含 `目标路径` `解析到 N 张表` |
| `catalog-asset-validation-summary` | 校验摘要 | — |
| `catalog-asset-validation-errors` | 错误列表 | — |
| `catalog-asset-validation-warnings` | 警告列表 | — |

### 2.4 CatalogAssetValidationPanel.tsx（src/components/catalog/）

| Test ID | 元素 |
|---|---|
| `semantic-asset-validation-panel` | 验证结果面板 |
| `semantic-asset-validation-errors` | 错误列表 |
| `semantic-asset-validation-warnings` | 警告列表 |
| `semantic-asset-validation-file` | 单个文件项 |
| `semantic-asset-validation-file-list` | 文件列表 |
| `semantic-asset-validation-file-warnings` | 单文件警告 |
| `semantic-asset-target-paths` | 目标路径列表 |

> 注意：`semantic-asset-*` 系列实际由 SemanticAssetValidationPanel 组件提供，被 CatalogAssetUploadDrawer 复用。

### 2.5 CatalogReloadButton.tsx（src/components/catalog/）

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `catalog-reload-inline` | 卡片内联 reload 按钮 | 必含 `刷新本地目录` |
| `catalog-reload-result` | reload 结果区 | — |
| `catalog-reload-result-empty` | 结果空态 | — |
| `catalog-reload-result-success` | 成功结果 | — |
| `catalog-reload-result-details` | 结果详情 | — |
| `catalog-reload-result-details-list` | 详情列表 | — |
| `catalog-reload-error` | 错误提示 | — |
| `catalog-reload-warnings` | 警告列表 | — |
| `catalog-last-run` | 上次运行时间 | — |

### 2.6 ConnectionTest.tsx

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `connection-test-overview-hint` | `/connections/test` 兼容页提示 | 必含 `去连接概览` |
| `connection-test-overview-link` | 跳转链接 | — |
| `rerun-connection-test` | `重新测试连接` 按钮 | — |
| `connection-test-banner` | 状态横幅 | — |
| `connection-test-command` | ktx command 文本 | — |
| `connection-test-exit-code` | 退出码 | — |
| `connection-test-latency` | 延迟 | — |
| `connection-test-metadata` | 元数据 | — |
| `connection-test-log` | 日志 | — |
| `connection-test-log-empty` | 日志空态 | — |
| `connection-test-raw-log-frame` | 原始日志 frame | — |
| `connection-test-drawer` | Drawer 根 | — |
| `connection-test-drawer-panel` | Drawer 面板 | — |
| `connection-test-drawer-close` | Drawer 关闭 | — |
| `connection-test-drawer-run` | Drawer 运行按钮 | — |
| `connection-test-panel` | 状态面板 | — |
| `connection-test-${section.label}` | 章节（模板） | — |

## 3. 启用表范围（src/pages/connections/TableWhitelist.tsx）

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `pl-whitelist-filter-area` | 筛选区 | — |
| `pl-whitelist-ops-area` | 操作区 | — |
| `whitelist-row-${row.qualifiedName}` | 白名单行 | — |
| `configured-schema-empty-${conn.id}-${schema}` | 空 Schema 区 | — |
| `whitelist-missing-manifest-title-${conn.id}-${schema}` | 缺失 Manifest 标题 | — |
| `whitelist-missing-manifest-path-${conn.id}-${schema}` | 缺失路径 | — |
| `whitelist-missing-manifest-details-${conn.id}-${schema}` | 缺失详情 | — |
| `whitelist-missing-manifest-toggle-${conn.id}-${schema}` | 展开/折叠 | — |
| `whitelist-missing-manifest-copy-${conn.id}-${schema}` | 复制 | — |
| `whitelist-missing-manifest-overview-${conn.id}-${schema}` | 跳转按钮 | 必含 `去连接概览上传 Manifest` |
| `whitelist-status-banner` | 状态横幅 | — |
| `whitelist-floating-bar` | 浮动操作栏 | — |
| `whitelist-save-changes` | `保存` 按钮 | — |
| `yaml-preview-drawer` | YAML 预览 Drawer | — |

## 4. 语义建模（src/pages/）

### 4.1 Catalog.tsx

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `catalog-count` | 表数量 | — |
| `catalog-last-run` | 上次刷新 | — |

> **MISSING（实现严重不足）**：表目录行、`维护语义` 按钮、Schema 筛选下拉都**没有**专属 testid。E2E-SEM-01 / 02 / 03 暂时只能靠 `getByRole('row')` / `getByText` 定位，selector 稳定性较差。Frontend 应补：`catalog-row-${conn}-${schema}-${table}` / `catalog-row-btn-maintain` / `catalog-schema-filter`。

### 4.2 TableEditor.tsx

| Test ID | 元素 |
|---|---|
| `table-editor-conn` | 表 connection 标识 span |

> **MISSING（实现严重不足）**：metadata grid、行粒度 input、指标 / 分群列表、Overlay Badge、候选 join banner、右栏 inspector tab 全部**没有** testid。E2E-SEM-* 整组用例当前**不可**通过 selector 精确定位；要么补 testid，要么降级为 `getByText` / `getByRole` 断言（稳定性差）。

### 4.3 JoinEditor.tsx

> 暂无 testid；§E2E-SEM-03 候选 join banner 行为需在 TableEditor 内表达。

## 5. 业务 Wiki（src/pages/WikiEditor.tsx + components）

### 5.1 WikiEditor.tsx

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `wiki-mode-badge` | 当前 mode Badge | `data-mode="read"` / `data-mode="edit"` |
| `wiki-status-badge` | 草稿/已保存 Badge | `data-status="loaded"` / `data-status="draft"` |
| `wiki-header-actions` | header 操作区 | — |
| `wiki-header-modes` | mode tablist | `role="tablist"` |
| `wiki-mode-${tab.key}` | mode tab | `role="tab"`；tab.key ∈ {`read`, `edit`} |
| `wiki-new-button` | `+ 新建 Wiki` | — |
| `wiki-edit-button` | `编辑` | — |
| `wiki-back-to-read` | `返回阅读` | — |
| `wiki-save-preflight-button` | `保存预检` | — |
| `wiki-layout` | 整体 layout | — |
| `wiki-sidebar` | 左侧栏 | — |
| `wiki-path-input` | key 输入 | — |
| `wiki-context-hint` | 上下文提示 | — |
| `wiki-body` | 主内容区 | — |

### 5.2 WikiTree.tsx

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `wiki-tree` | Tree 根 | 节点主标签 = 文档标题 |
| `wiki-tree-search` | 搜索框 | 支持 title / path / tags / sl_refs / summary |
| `wiki-tree-empty` | 空态 | — |
| `wiki-tree-group` | 分组 | — |
| `wiki-tree-page` | 页面节点 | — |

### 5.3 WikiReadView.tsx

| Test ID | 元素 |
|---|---|
| `wiki-read-title` | 文档标题 |
| `wiki-read-summary` | 摘要 |
| `wiki-read-meta` | meta 区域（含 sl_refs / tags） |
| `wiki-read-tags` | 标签 |
| `wiki-read-refs` | 关联语义对象容器 |
| `wiki-read-ref` | 单个 sl_ref Badge |
| `wiki-read-layout` | 阅读态 layout |
| `wiki-read-body` | 渲染后的 Markdown body |
| `wiki-read-empty` | 空草稿态 |
| `wiki-read-templates` | 模板列表 |
| `wiki-read-template-${template.label}` | 单模板（模板） |
| `wiki-read-toc` | TOC |

> **MISSING**：`sl-ref-picker` / `sl-ref-badge-${conn}-${schema}-${table}` 在 SlRefPicker.tsx 中**没有**任何 testid；E2E-WIKI-03 双向跳转当前**不可**精确定位，spec 暂时按 `data-status` 兜底。

### 5.4 WikiEditView.tsx

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `wiki-edit-view` | 编辑态根 | 必含 `textarea` |
| `wiki-edit-meta` | 元信息区（折叠 `文档信息`） | — |
| `wiki-edit-grid` | 编辑器 + 预览 grid | — |
| `wiki-edit-source` | 源编辑区 | — |
| `wiki-edit-textarea` | Markdown 文本框 | 占主工作区 ≥ 80% |
| `wiki-edit-preview` | 渲染预览 | — |

### 5.5 WikiSavePreflight.tsx

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `wiki-save-preflight` | Drawer 根 | — |
| `wiki-save-preflight-target` | 目标路径 | 必含 `wiki/<key>` |
| `wiki-save-preflight-findings` | 校验 findings 列表 | 必含 `Missing title` / `Empty body` / `Unknown sl_ref` 等 |
| `wiki-save-preflight-diff` | Diff 区 | — |
| `wiki-save-preflight-loading` | 加载态 | — |
| `wiki-save-preflight-preview-error` | 预览错误 | — |
| `wiki-save-preflight-stale` | 过期提示 | — |
| `wiki-save-preflight-raw` | Raw（折叠） | — |
| `wiki-save-preflight-confirm` | `保存` 按钮 | 校验失败时 disabled |

### 5.6 MarkdownPreview.tsx

| Test ID | 元素 |
|---|---|
| `wiki-markdown-preview` | Markdown 预览根 |

## 6. 语义发布（src/pages/publish/）

### 6.1 PublishWorkbench.tsx

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `publish-workbench-layout` | 整体 layout | 桌面双列、窄屏单列 |
| `workbench-empty-state` | 空态 | 必含 `暂无待发布变更` |
| `workbench-pending-count` | Header Badge "N 个待发布文件" | `translate="no"` |
| `workbench-validate` | `校验变更` | 禁止 `Validate changed` |
| `workbench-reindex` | `强制重建索引` | 禁止 `索引生效` / `重建 KTX 索引` |
| `workbench-upload-semantic-asset` | `上传语义资产` | 禁止 `上传 YAML` |
| `workbench-publish-and-reindex` | `发布并重建索引` 主按钮 | 禁止 `发布并 reindex` / `发布并索引` |
| `workbench-reindex-result` | reindex 成功结果 | 必含 `退出码 0` |
| `workbench-reindex-error` | reindex 失败 | 必含 `stdout` `stderr` |
| `review-boundary-checklist` | 边界说明卡 | — |

### 6.2 PublishHistory.tsx

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `publish-history-section` | 整个发布记录区 | — |
| `publish-history-count` | 记录条数 | 必含 `共 N 条记录` |
| `publish-history-empty` | 空态 | — |
| `publish-history-row` | 单行（不带 id） | `data-trigger` / `data-status` 属性 |
| `publish-history-reindex-status` | reindex 状态徽标 | `成功` / `失败` / `进行中` / `未执行` |
| `publish-history-toggle-diff` | `查看 Diff` 按钮 | — |
| `publish-history-toggle-error` | `查看错误` 按钮 | — |
| `publish-history-expanded-panel` | 展开面板（Diff / 错误） | — |

### 6.3 SemanticAssetPublishDrawer.tsx（src/components/semantic-assets/）

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `semantic-asset-publish-drawer` | Drawer 根 | — |
| `semantic-asset-publish-panel` | Drawer 面板 | — |
| `semantic-asset-publish-close` | 关闭按钮 | — |
| `semantic-asset-publish-dropzone` | 拖拽区 | — |
| `semantic-asset-publish-file` | 已选文件 | — |
| `semantic-asset-publish-file-pill` | 文件 pill | — |
| `semantic-asset-publish-pick-file` | 选择文件按钮 | — |
| `semantic-asset-publish-paste` | 粘贴 YAML | — |
| `semantic-asset-publish-files` | 文件列表 | — |
| `semantic-asset-publish-confirm-overwrite` | 覆盖确认 | — |
| `semantic-asset-changed-sources` | 待发布 source 列表 | — |
| `semantic-asset-publish-blocked` | 被 gate 阻止提示 | — |
| `semantic-asset-publish-progress` | 发布进度 | — |
| `semantic-asset-publish-submit` | Drawer 提交按钮 | 必含 `发布并重建索引`（不是 `-drawer-submit`） |
| `semantic-asset-publish-result` | 结果区 | — |
| `semantic-asset-publish-success` | 成功结果 | — |
| `semantic-asset-publish-reindexing` | reindexing 中 | — |
| `semantic-asset-publish-result-close` | 结果关闭按钮 | — |
| `semantic-asset-release-summary` | release 摘要 | — |
| `semantic-asset-release-status` | release 状态 | — |
| `semantic-asset-release-validation` | release 校验结果 | — |

### 6.4 SemanticAssetExportButton.tsx

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `semantic-asset-export-summary` | 导出摘要 | — |
| `semantic-asset-export-download` | 下载按钮 | 必含 `下载当前快照` / `导出当前快照 (.zip)` |
| `semantic-asset-export-excluded` | 被排除项列表 | — |

## 7. 其它（与 E2E 弱相关但已存在）

| Test ID | 元素 |
|---|---|
| `agent-detail` | Agent 详情页 |
| `audit-page` | 审计页 |
| `help-content` | 帮助内容 |
| `help-header` | 帮助页头 |
| `mcp-endpoint-diagnostic` | MCP 诊断 |
| `mcp-fallback-notice` | MCP 兜底提示 |
| `mcp-invalid-notice` | MCP 无效提示 |
| `metric-tooltip-title` | 指标卡 tooltip 标题 |
| `new-role` | 新建角色 |
| `new-token` | 新建 token |
| `onboarding-delivery-banner` | 上线检查 banner |
| `permissions-tree` | 权限树 |
| `plaintext-token` | 明文 token |
| `role-card` | 角色卡 |
| `role-detail` | 角色详情 |
| `role-diff` | 角色 diff |
| `role-dirty-bar` | 角色 dirty 浮条 |
| `role-list` | 角色列表 |
| `role-summary-card` | 角色摘要卡 |
| `roles-page` | 角色页 |
| `route-page` | 通用 route 页根 |
| `snippet-active` | snippet 激活态 |
| `sticky-save-bar` | sticky 保存条 |
| `summary` | 摘要 |
| `metric-help-${type}` | 指标帮助（模板） |
| `connection-test-${section.label}` | 连接测试章节（模板） |
| `submit-button` | 通用 submit |
| `required-input` | 必填 input |
| `valid-form` | valid form |
| `text`, `text-a`, `text-b` | 文本（vitest 辅助） |
| `text-content` | text content |
| `textarea` | textarea |
| `visible` | 可见性 |
| `zero-opacity` | 零透明度 |
| `svg-button`, `svg-element`, `svg-title`, `svg-without-title` | SVG 相关 |

---

## 8. Rename History

| 日期 | PR | Old | New | 原因 |
|---|---|---|---|---|
| 2026-07-31 | v0.3 重写 | `breadcrumb` | `page-header` | v0.3 对齐实现 `PageHeader.tsx:54` |
| 2026-07-31 | v0.3 重写 | `connection-card-mysql-aliyun-badge-readonly` | `connection-readonly-${conn.id}` | v0.3 对齐 `ConnectionOverview.tsx:371` |
| 2026-07-31 | v0.3 重写 | `semantic-asset-publish-drawer-submit` | `semantic-asset-publish-submit` | v0.3 对齐 `SemanticAssetPublishDrawer.tsx:511` |
| 2026-07-31 | v0.3 重写 | `catalog-upload-paste-textarea` | `catalog-asset-upload-textarea` | v0.3 对齐 `CatalogAssetUploadDrawer.tsx:371` |
| 2026-07-31 | v0.3 重写 | `catalog-upload-btn-submit` | `catalog-asset-upload-submit` | v0.3 对齐 `CatalogAssetUploadDrawer.tsx:402` |
| 2026-07-31 | v0.3 重写 | `add-schema-drawer-step-1..4` | （实现缺失，未补） | v0.3 标记 MISSING，待实现补全 |
| 2026-07-31 | v0.3 重写 | `sl-ref-picker` / `sl-ref-badge-...` | （实现缺失，未补） | v0.3 标记 MISSING，待实现补全 |
| 2026-07-31 | v0.3 重写 | `catalog-row-...` / `table-editor-*` | （实现严重缺失） | v0.3 标记 MISSING，影响 E2E-SEM-* 整组 |

---

## 9. Pending Proposals（待评审 / 待实现补全）

| 缺失 selector | 期望位置 | 关联用例 | 提议 PR |
|---|---|---|---|
| `catalog-row-${conn}-${schema}-${table}` | Catalog.tsx 行 | E2E-SEM-01 | 待开 |
| `catalog-row-btn-maintain` | Catalog.tsx 行按钮 | E2E-SEM-01 | 待开 |
| `catalog-schema-filter` | Catalog.tsx 顶部 | E2E-SEM-01 | 待开 |
| `table-editor-metadata-grid` | TableEditor.tsx | E2E-SEM-01 | 待开 |
| `table-editor-grain-input` | TableEditor.tsx | E2E-SEM-01 / 02 | 待开 |
| `overlay-badge-grain/measures/segments` | TableEditor.tsx | E2E-SEM-02 | 待开 |
| `candidate-join-banner` / `-action-*` | TableEditor.tsx | E2E-SEM-03 | 待开 |
| `inspector-tab-diff/yaml/validate` | TableEditor.tsx | E2E-SEM-01 / 04 | 待开 |
| `table-editor-btn-save` | TableEditor.tsx | E2E-SEM-01 / 02 | 待开 |
| `add-schema-drawer-step-1..4` | AddSchemaDrawer.tsx | E2E-CON-02 | 待开 |
| `sl-ref-picker` | SlRefPicker.tsx | E2E-WIKI-03 | 待开 |
| `sl-ref-badge-${conn}-${schema}-${table}` | WikiReadView / EditView | E2E-WIKI-03 | 待开 |
| `wiki-template-card-${name}` | WikiEditor.tsx | E2E-WIKI-05 | 待开 |
| `wiki-yaml-boundary-hint` | WikiEditor.tsx | E2E-WIKI-05 | 待开 |
| `breadcrumb` | PageHeader 内部 | 全部用例 | 提议改为面包屑组件单独 testid，避免与 page-header 混淆 |

> 实现 PR 落地后，spec 中相应 `getByRole` / `getByText` fallback 可以替换为 `getByTestId`，稳定性大幅提升。
