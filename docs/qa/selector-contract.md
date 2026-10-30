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
| `connection-readonly-${conn.id}` | `未声明只读` 风险提醒 | 仅 `readOnlyExpected === false` 时出现；禁止 `Read-only expected` 露出 |
| `connection-kv-${conn.id}` | 卡片 KeyValue 网格 | 必含 `Host / Database`；不得逐卡出现 `配置文件 / 凭据来源` |
| `connection-refresh-warning-${conn.id}` | 未刷新 amber Banner | 文案 `本地目录未刷新：尚未读取本地 YAML 资产配置。` + `立即刷新` |
| `connection-refresh-warning-action-${conn.id}` | Banner `立即刷新` 按钮 | 必含 `立即刷新`，无 `↗` |
| `connection-card-schema-actions-${conn.id}` | 卡片 Schema 上下文操作区 | — |
| `engine-badge-${conn.id}` | 驱动 Badge | — |
| `connection-last-reload-${conn.id}` | Header 右侧上次刷新时间 | 仅展示 `上次刷新：<timestamp>`，不得展示表数/提示数摘要 |
| `catalog-reload-status-${conn.id}` | Catalog 刷新加载/失败状态 | 仅用于 pending / error / 最近失败状态；健康成功态不出现 |
| `catalog-reload-warning-toggle-${conn.id}-${schema}` | Schema 警告详情开关 | 默认 `查看详情` 且 `aria-expanded=false`；点击后变 `收起详情` |
| `catalog-reload-warning-${conn.id}-${schema}` | Schema Catalog 警告详情行 | 默认不出现；展开后显示 |
| `catalog-reload-warning-details-${conn.id}-${schema}` | 警告详情 | — |
| `schema-asset-table-${conn.id}` | Schema 资产表 | 列：`Schema / Manifest 状态 / 库内表数 / 库内表清单 / 已发现表数 / 已启用表数 / 持续感知 / 操作`（Spec 190 起新增「库内表清单」与「持续感知」两列；四个计数口径分列，不得合并） |
| `schema-row-${conn.id}-${schema}` | Schema 行 | 状态枚举 `已存在` / `缺失 Manifest` / `解析失败` |
| `schema-asset-status-${conn.id}-${schema}` | Schema Manifest 状态 cell | 必含 `已存在` / `缺失 Manifest` / `解析失败` 之一 |
| `schema-enabled-count-${conn.id}-${schema}` | Schema 启用表数 cell | 文案为 `<n> 张表`，数值来自该 Schema 下 `enabled_tables` 计数 |
| `schema-whitelist-${conn.id}-${schema}` | `维护启用范围` / `上传 Manifest` 上下文动作 | 必含 `维护启用范围` 或 `上传 Manifest`；不得出现 `维护白名单` |
| `add-schema-${conn.id}` | `+ 添加 Schema` 按钮 | 禁止 `添加架构` / `添加模式` |
| `connection-discovery-notice-${conn.id}` | 连接卡「持续感知」状态提示 | 仅在连接级状态为 `paused` / `error` 时出现；文案 `持续感知已暂停：` / `持续感知失败：` + 原因；不得出现 `扫描` / `重新扫描物理库` |

### 2.2 AddSchemaDrawer.tsx

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `add-schema-drawer-backdrop` | Drawer 背景遮罩 | — |
| `add-schema-drawer` | Drawer 根 | 标题 `添加 Schema` |
| `add-schema-close` | 关闭按钮 | — |
| `add-schema-input` | Schema 名 input | 仅库内目录失败或候选为空时出现；Label `Schema 名称` |
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

### 2.7 SchemaDiscoveryCells.tsx（src/components/connections/）

Spec 190 §7.9 — 库内表清单与持续感知的最小展示。

| Test ID | 元素 | 文案约束 |
|---|---|---|
| `live-table-list-toggle-${connectionId}-${schema}` | 库内表清单入口按钮 | 文案 `<n> 张表` 或 `查看表清单`；`aria-expanded` 随展开切换；不得出现 `扫描` / `物理扫描` / `重新扫描物理库` |
| `live-table-list-${connectionId}-${schema}` | 库内表清单展开面板 | 展开后才出现；每项含表名与 `<n> 列`；读取失败显示原因文案，不得出现 `白名单` |
| `discovery-state-${connectionId}-${schema}` | 持续感知状态 cell | 状态枚举 `未开启` / `已开启` / `感知失败` / `已暂停`；不得出现 `扫描` |
| `discovery-paused-reason-${connectionId}-${schema}` | 暂停原因 | 仅在状态为 `已暂停` 时出现；文案取封闭 reason 词表的中文表述 |
| `table-diff-count-${connectionId}-${schema}` | 表清单差异计数 | 文案 `新增 <n> · 已消失 <n> · 列数变化 <n>`；三项全为 0 时不出现；不得出现 `变更清单` / `差异结果` |

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
| `wiki-acl-field` | 可访问角色（对象授权，默认无人可见） | `components/ObjectAclField.tsx` |
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
| `workbench-empty-state` | 空态 | 必含 `暂无待同步变更` |
| `workbench-batch-sync-hint` | 有待同步变更时的批量同步提示（已替代移除的 `workbench-pending-count` Badge） | 仅 `files.length > 0` 时出现；必含 `本批一并同步 N 项` |
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
| `role-detail` | 角色详情 |
| `role-diff` | 角色 diff |
| `role-permission-review-drawer` | 删除或保存 Role 前的确认抽屉 | `components/RolePermissionReviewDrawer.tsx` |
| `role-dirty-bar` | 角色 dirty 浮条 |
| `role-list-table` | 角色列表 Data Grid |
| `role-row-${roleId}` | 角色行（模板） |
| `${testId}-corrupt` | 对象授权声明损坏提示（`skill-field-roles` / `wiki-acl-field`） | `components/ObjectAclField.tsx` |
| `${testId}-roles` | 对象授权角色复选区 | `components/ObjectAclField.tsx` |
| `${testId}-all-confirm` | 所有角色可见二次确认区 | `components/ObjectAclField.tsx` |
| `${testId}-all-apply` | 所有角色可见确认并应用 | `components/ObjectAclField.tsx` |
| `role-summary-card` | 角色摘要卡 |
| `role-context-access` | Role 详情：Wiki / Skill 发现与读取效果（只读） | `pages/admin/RoleDetail.tsx` |
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

## 7.1 Admin data grid frame（L1 列表外框）

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `agent-list-section` | Agent 列表外框 | `pages/admin/AgentList.tsx` |
| `agent-list-grid-scroll` | Agent 列表滚动层 | `pages/admin/AgentList.tsx` |
| `agent-list-table` | Agent 列表表 | `pages/admin/AgentList.tsx` |
| `agent-metric-grid` | Agent 列表 KPI 网格 | `pages/admin/AgentList.tsx` |
| `agent-list-result-count` | 筛选结果计数 | `pages/admin/AgentList.tsx` |
| `clear-filters-btn` | 清除筛选（工具栏） | `pages/admin/AgentList.tsx` |
| `clear-filters-btn-empty` | 清除筛选（空态） | `pages/admin/AgentList.tsx` |
| `agent-name-link-${agent.id}` | Agent 显示名 → 对象抽屉 | `pages/admin/AgentList.tsx` |
| `agent-row-${agent.id}` | Agent 表行 | `pages/admin/AgentList.tsx` |
| `agent-row-index-${agent.id}` | 行序号 | `pages/admin/AgentList.tsx` |
| `agent-role-line-${agent.id}` | 角色单元格 | `pages/admin/AgentList.tsx` |
| `agent-role-link-${agent.id}` | 角色链接（恰好一个角色时） | `pages/admin/AgentList.tsx` |
| `agent-role-link-${agent.id}-${roleId}` | 角色链接 | `pages/admin/AgentList.tsx` |
| `agent-role-field` | Agent 角色复选框组 | `components/AgentRoleField.tsx` |
| `agent-role-option` | Agent 角色复选项 | `components/AgentRoleField.tsx` |
| `agent-role-capability` | 角色集合的数据能力卡 | `components/AgentRoleField.tsx` |
| `agent-active-tokens-${agent.id}` | 近 7 天活跃 Token | `pages/admin/AgentList.tsx` |
| `agent-calls-7d-${agent.id}` | 近 7 天调用量 | `pages/admin/AgentList.tsx` |
| `agent-leave-confirm-modal` | 未保存离开确认 | `pages/admin/AgentDetail.tsx` |
| `agent-detail-mcp-playground` | 跳转 MCP 调试台 | `pages/admin/AgentDetail.tsx` |
| `agent-constraints-editor` | 强制约束编辑器 | `pages/admin/AgentDetail.tsx` |
| `capability-preview` | 数据能力预览 | `pages/admin/AgentDetail.tsx` |
| `diff-change-summary` | 变更字段摘要 | `pages/admin/AgentDetail.tsx` |
| `dryrun-finalrows-preview` | dry-run 技术预览 | `pages/admin/AgentDetail.tsx` |
| `agent-save-confirm-modal` | 保存确认模态 | `pages/admin/AgentDetail.tsx` |
| `agent-save-confirm-submit` | 确认保存按钮 | `pages/admin/AgentDetail.tsx` |
| `confirm-finalrows-preview` | 确认框技术预览 | `pages/admin/AgentDetail.tsx` |
| `object-detail-drawer` | 对象详情抽屉 | `components/ObjectDetailDrawer.tsx` |
| `object-detail-title` | 抽屉标题 | `components/ObjectDetailDrawer.tsx` |
| `object-detail-close` | 抽屉关闭 | `components/ObjectDetailDrawer.tsx` |
| `object-detail-deep-link` | 打开完整页面 | `components/ObjectDetailDrawer.tsx` |
| `object-detail-return-audit` | 返回审计上下文 | `components/ObjectDetailDrawer.tsx` |
| `object-detail-agent-body` | Agent 抽屉正文 | `components/ObjectDetailDrawer.tsx` |
| `object-detail-agent-audit-link` | Agent 抽屉访问日志 | `components/ObjectDetailDrawer.tsx` |
| `object-detail-agent-not-found` | Agent 未找到 | `components/ObjectDetailDrawer.tsx` |
| `object-detail-table-body` | 表抽屉正文 | `components/ObjectDetailDrawer.tsx` |
| `object-detail-table-not-found` | 表未找到 | `components/ObjectDetailDrawer.tsx` |
| `object-detail-run-body` | Eval Run 抽屉正文 | `components/ObjectDetailDrawer.tsx` |
| `object-detail-run-not-found` | Eval Run 未找到 | `components/ObjectDetailDrawer.tsx` |
| `object-detail-audit-body` | 审计事件抽屉正文 | `components/ObjectDetailDrawer.tsx` |
| `object-detail-audit-not-found` | 审计事件未找到 | `components/ObjectDetailDrawer.tsx` |
| `config-audit-grid-frame` | 配置审计外框 | `pages/admin/ConfigAudit.tsx` |
| `config-audit-grid-scroll` | 配置审计滚动区 | `pages/admin/ConfigAudit.tsx` |
| `config-audit-table` | 配置审计表 | `pages/admin/ConfigAudit.tsx` |
| `audit-turns-grid-frame` | 问询记录外框 | `pages/admin/Audit.tsx` |
| `audit-turns-grid-scroll` | 问询记录有界滚动区 | `pages/admin/Audit.tsx` |
| `audit-turns-table` | 问询记录表 | `pages/admin/Audit.tsx` |
| `audit-calls-grid-frame` | 调用流水外框 | `pages/admin/Audit.tsx` |
| `audit-calls-grid-scroll` | 调用流水有界滚动区 | `pages/admin/Audit.tsx` |
| `audit-calls-table` | 调用流水表 | `pages/admin/Audit.tsx` |

---



## 7.9 升级功能补齐组件与页面（v2.0 自动对齐）

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `sidebar-brand` | sidebar-brand | `app/App.tsx` |
| `brand-title` | brand-title | `app/App.tsx` |
| `brand-tagline` | brand-tagline | `app/App.tsx` |
| `sidebar-search-trigger` | sidebar-search-trigger | `app/App.tsx` |
| `version-info` | version-info | `pages/admin/VersionInfo.tsx` |
| `version-info-loading` | version-info-loading | `pages/admin/VersionInfo.tsx` |
| `version-info-error` | version-info-error | `pages/admin/VersionInfo.tsx` |
| `version-info-product` | version-info-product | `pages/admin/VersionInfo.tsx` |
| `version-info-sha` | version-info-sha | `pages/admin/VersionInfo.tsx` |
| `version-info-copy` | version-info-copy | `pages/admin/VersionInfo.tsx` |
| `version-info-workspace` | version-info-workspace | `pages/admin/VersionInfo.tsx` |
| `version-info-ktx` | version-info-ktx | `pages/admin/VersionInfo.tsx` |
| `sidebar-auth` | sidebar-auth | `app/App.tsx` |
| `add-schema-select` | add-schema-select | `components/AddSchemaDrawer.tsx` |
| `add-schema-live-loading` | add-schema-live-loading | `components/AddSchemaDrawer.tsx` |
| `add-schema-live-fallback` | add-schema-live-fallback | `components/AddSchemaDrawer.tsx` |
| `add-schema-live-empty` | add-schema-live-empty | `components/AddSchemaDrawer.tsx` |
| `role-table-ranges-field` | role-table-ranges-field | `components/AssetHierarchyPicker.tsx` |
| `brand-logo` | brand-logo | `components/BrandMark.tsx` |
| `brand-mark-letter` | brand-mark-letter | `components/BrandMark.tsx` |
| `command-palette` | command-palette | `components/CommandPalette.tsx` |
| `command-palette-input` | command-palette-input | `components/CommandPalette.tsx` |
| `command-palette-esc-keycap` | command-palette-esc-keycap | `components/CommandPalette.tsx` |
| `command-palette-list` | command-palette-list | `components/CommandPalette.tsx` |
| `command-palette-hint` | command-palette-hint | `components/CommandPalette.tsx` |
| `command-palette-empty` | command-palette-empty | `components/CommandPalette.tsx` |
| `command-palette-enter-hint` | command-palette-enter-hint | `components/CommandPalette.tsx` |
| `command-palette-footer` | command-palette-footer | `components/CommandPalette.tsx` |
| `create-connection-drawer-backdrop` | create-connection-drawer-backdrop | `components/CreateConnectionDrawer.tsx` |
| `create-connection-drawer` | create-connection-drawer | `components/CreateConnectionDrawer.tsx` |
| `create-connection-secret-banner` | create-connection-secret-banner | `components/CreateConnectionDrawer.tsx` |
| `create-connection-close` | create-connection-close | `components/CreateConnectionDrawer.tsx` |
| `create-connection-id` | create-connection-id | `components/CreateConnectionDrawer.tsx` |
| `create-connection-driver` | create-connection-driver | `components/CreateConnectionDrawer.tsx` |
| `create-connection-readonly` | create-connection-readonly | `components/CreateConnectionDrawer.tsx` |
| `create-connection-host` | create-connection-host | `components/CreateConnectionDrawer.tsx` |
| `create-connection-port` | create-connection-port | `components/CreateConnectionDrawer.tsx` |
| `create-connection-database` | create-connection-database | `components/CreateConnectionDrawer.tsx` |
| `create-connection-username` | create-connection-username | `components/CreateConnectionDrawer.tsx` |
| `create-connection-password` | create-connection-password | `components/CreateConnectionDrawer.tsx` |
| `create-connection-password-toggle` | create-connection-password-toggle | `components/CreateConnectionDrawer.tsx` |
| `create-connection-schemas` | create-connection-schemas | `components/CreateConnectionDrawer.tsx` |
| `create-connection-advanced` | create-connection-advanced | `components/CreateConnectionDrawer.tsx` |
| `create-connection-engine` | create-connection-engine | `components/CreateConnectionDrawer.tsx` |
| `create-connection-wire-protocol` | create-connection-wire-protocol | `components/CreateConnectionDrawer.tsx` |
| `create-connection-test-btn` | create-connection-test-btn | `components/CreateConnectionDrawer.tsx` |
| `create-connection-preview-btn` | create-connection-preview-btn | `components/CreateConnectionDrawer.tsx` |
| `create-connection-probe-result` | create-connection-probe-result | `components/CreateConnectionDrawer.tsx` |
| `create-connection-error` | create-connection-error | `components/CreateConnectionDrawer.tsx` |
| `create-connection-confirm-btn` | create-connection-confirm-btn | `components/CreateConnectionDrawer.tsx` |
| `create-connection-success` | create-connection-success | `components/CreateConnectionDrawer.tsx` |
| `create-connection-test-warning` | create-connection-test-warning | `components/CreateConnectionDrawer.tsx` |
| `create-connection-done-btn` | create-connection-done-btn | `components/CreateConnectionDrawer.tsx` |
| `decision-reason-cell` | decision-reason-cell | `components/DecisionReasonCell.tsx` |
| `decision-reason-label` | decision-reason-label | `components/DecisionReasonCell.tsx` |
| `decision-reason-code` | decision-reason-code | `components/DecisionReasonCell.tsx` |
| `delete-connection-drawer` | delete-connection-drawer | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-id` | delete-connection-id | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-close` | delete-connection-close | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-schema-count` | delete-connection-schema-count | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-enabled-count` | delete-connection-enabled-count | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-enabled-list` | delete-connection-enabled-list | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-asset-count` | delete-connection-asset-count | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-acl-count` | delete-connection-acl-count | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-wiki-count` | delete-connection-wiki-count | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-secret-checkbox` | delete-connection-secret-checkbox | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-assets-checkbox` | delete-connection-assets-checkbox | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-confirm-id` | delete-connection-confirm-id | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-confirm-btn` | delete-connection-confirm-btn | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-success-message` | delete-connection-success-message | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-done` | delete-connection-done | `components/DeleteConnectionDrawer.tsx` |
| `wiki-meta-drawer` | wiki-meta-drawer | `components/FrontmatterDrawer.tsx` |
| `wiki-meta-close` | wiki-meta-close | `components/FrontmatterDrawer.tsx` |
| `wiki-read-refs-summary` | wiki-read-refs-summary | `components/LinkedSemanticObjects.tsx` |
| `wiki-read-refs-summary-toggle` | wiki-read-refs-summary-toggle | `components/LinkedSemanticObjects.tsx` |
| `metric-tooltip-hint` | metric-tooltip-hint | `components/MetricCard.tsx` |
| `object-detail-role-not-found` | object-detail-role-not-found | `components/ObjectDetailDrawer.tsx` |
| `object-detail-role-body` | object-detail-role-body | `components/ObjectDetailDrawer.tsx` |
| `policy-degrade-banner` | policy-degrade-banner | `components/PolicyDegradeBanner.tsx` |
| `remove-schema-drawer` | remove-schema-drawer | `components/RemoveSchemaDrawer.tsx` |
| `remove-schema-close` | remove-schema-close | `components/RemoveSchemaDrawer.tsx` |
| `remove-schema-enabled-count` | remove-schema-enabled-count | `components/RemoveSchemaDrawer.tsx` |
| `remove-schema-enabled-list` | remove-schema-enabled-list | `components/RemoveSchemaDrawer.tsx` |
| `remove-schema-overlay-count` | remove-schema-overlay-count | `components/RemoveSchemaDrawer.tsx` |
| `remove-schema-wiki-count` | remove-schema-wiki-count | `components/RemoveSchemaDrawer.tsx` |
| `remove-schema-delete-manifest-checkbox` | remove-schema-delete-manifest-checkbox | `components/RemoveSchemaDrawer.tsx` |
| `remove-schema-delete-overlays-checkbox` | remove-schema-delete-overlays-checkbox | `components/RemoveSchemaDrawer.tsx` |
| `remove-schema-enabled-warning` | remove-schema-enabled-warning | `components/RemoveSchemaDrawer.tsx` |
| `remove-schema-confirm-btn` | remove-schema-confirm-btn | `components/RemoveSchemaDrawer.tsx` |
| `remove-schema-success-message` | remove-schema-success-message | `components/RemoveSchemaDrawer.tsx` |
| `remove-schema-done` | remove-schema-done | `components/RemoveSchemaDrawer.tsx` |
| `remove-schema-reload-catalog` | remove-schema-reload-catalog | `components/RemoveSchemaDrawer.tsx` |
| `remove-schema-reload-error` | remove-schema-reload-error | `components/RemoveSchemaDrawer.tsx` |
| `row-more-trigger` | row-more-trigger | `components/RowMoreMenu.tsx` |
| `row-more-menu` | row-more-menu | `components/RowMoreMenu.tsx` |
| `segment-editor` | segment-editor | `components/SegmentForm.tsx` |
| `segment-add` | segment-add | `components/SegmentForm.tsx` |
| `segment-empty` | segment-empty | `components/SegmentForm.tsx` |
| `wiki-template-picker` | wiki-template-picker | `components/TemplatePicker.tsx` |
| `wiki-template-list` | wiki-template-list | `components/TemplatePicker.tsx` |
| `wiki-template-cancel` | wiki-template-cancel | `components/TemplatePicker.tsx` |
| `wiki-delete-directory-dialog` | wiki-delete-directory-dialog | `components/WikiDeleteDirectoryDialog.tsx` |
| `wiki-delete-directory-target` | wiki-delete-directory-target | `components/WikiDeleteDirectoryDialog.tsx` |
| `wiki-delete-directory-error` | wiki-delete-directory-error | `components/WikiDeleteDirectoryDialog.tsx` |
| `wiki-delete-directory-cancel` | wiki-delete-directory-cancel | `components/WikiDeleteDirectoryDialog.tsx` |
| `wiki-delete-directory-confirm` | wiki-delete-directory-confirm | `components/WikiDeleteDirectoryDialog.tsx` |
| `wiki-delete-document-dialog` | wiki-delete-document-dialog | `components/WikiDeleteDocumentDialog.tsx` |
| `wiki-delete-document-target` | wiki-delete-document-target | `components/WikiDeleteDocumentDialog.tsx` |
| `wiki-delete-document-error` | wiki-delete-document-error | `components/WikiDeleteDocumentDialog.tsx` |
| `wiki-delete-document-cancel` | wiki-delete-document-cancel | `components/WikiDeleteDocumentDialog.tsx` |
| `wiki-delete-document-confirm` | wiki-delete-document-confirm | `components/WikiDeleteDocumentDialog.tsx` |
| `wiki-edit-placeholder-hint` | wiki-edit-placeholder-hint | `components/WikiEditView.tsx` |
| `wiki-edit-source-header` | wiki-edit-source-header | `components/WikiEditView.tsx` |
| `wiki-edit-preview-header` | wiki-edit-preview-header | `components/WikiEditView.tsx` |
| `wiki-edit-tab-toggle` | wiki-edit-tab-toggle | `components/WikiEditView.tsx` |
| `wiki-edit-tab-markdown` | wiki-edit-tab-markdown | `components/WikiEditView.tsx` |
| `wiki-edit-tab-preview` | wiki-edit-tab-preview | `components/WikiEditView.tsx` |
| `wiki-library-home` | wiki-library-home | `components/WikiLibraryHome.tsx` |
| `wiki-library-select-prompt` | wiki-library-select-prompt | `components/WikiLibraryHome.tsx` |
| `wiki-library-summary` | wiki-library-summary | `components/WikiLibraryHome.tsx` |
| `wiki-library-directory-empty` | wiki-library-directory-empty | `components/WikiLibraryHome.tsx` |
| `wiki-library-documents` | wiki-library-documents | `components/WikiLibraryHome.tsx` |
| `wiki-library-document` | wiki-library-document | `components/WikiLibraryHome.tsx` |
| `wiki-library-document-title` | wiki-library-document-title | `components/WikiLibraryHome.tsx` |
| `wiki-library-document-path` | wiki-library-document-path | `components/WikiLibraryHome.tsx` |
| `wiki-library-access-filter-${filter}` | 目录文档按授权状态筛选 | `components/WikiLibraryHome.tsx` |
| `wiki-library-batch-start` | 进入批量管理权限 | `components/WikiLibraryHome.tsx` |
| `wiki-library-batch-continue` | 对已选文档继续批量管理权限 | `components/WikiLibraryHome.tsx` |
| `wiki-batch-drawer` | 批量管理权限抽屉 | `components/WikiBatchAccessDrawer.tsx` |
| `wiki-batch-preview` | 预检批量授权 | `components/WikiBatchAccessDrawer.tsx` |
| `wiki-batch-submit` | 提交批量授权 | `components/WikiBatchAccessDrawer.tsx` |
| `wiki-move-document-dialog` | wiki-move-document-dialog | `components/WikiMoveDocumentDialog.tsx` |
| `wiki-move-source` | wiki-move-source | `components/WikiMoveDocumentDialog.tsx` |
| `wiki-move-source-key` | wiki-move-source-key | `components/WikiMoveDocumentDialog.tsx` |
| `wiki-move-target` | wiki-move-target | `components/WikiMoveDocumentDialog.tsx` |
| `wiki-move-target-directory-input` | wiki-move-target-directory-input | `components/WikiMoveDocumentDialog.tsx` |
| `wiki-move-target-key-preview` | wiki-move-target-key-preview | `components/WikiMoveDocumentDialog.tsx` |
| `wiki-move-target-exists` | wiki-move-target-exists | `components/WikiMoveDocumentDialog.tsx` |
| `wiki-move-error` | wiki-move-error | `components/WikiMoveDocumentDialog.tsx` |
| `wiki-move-warnings` | wiki-move-warnings | `components/WikiMoveDocumentDialog.tsx` |
| `wiki-move-cancel` | wiki-move-cancel | `components/WikiMoveDocumentDialog.tsx` |
| `wiki-move-confirm` | wiki-move-confirm | `components/WikiMoveDocumentDialog.tsx` |
| `wiki-new-directory-dialog` | wiki-new-directory-dialog | `components/WikiNewDirectoryDialog.tsx` |
| `wiki-new-directory-top-level-checkbox` | wiki-new-directory-top-level-checkbox | `components/WikiNewDirectoryDialog.tsx` |
| `wiki-new-directory-parent-input` | wiki-new-directory-parent-input | `components/WikiNewDirectoryDialog.tsx` |
| `wiki-new-directory-name-input` | wiki-new-directory-name-input | `components/WikiNewDirectoryDialog.tsx` |
| `wiki-new-directory-target-preview` | wiki-new-directory-target-preview | `components/WikiNewDirectoryDialog.tsx` |
| `wiki-new-directory-error` | wiki-new-directory-error | `components/WikiNewDirectoryDialog.tsx` |
| `wiki-new-directory-confirm` | wiki-new-directory-confirm | `components/WikiNewDirectoryDialog.tsx` |
| `wiki-new-document-dialog` | wiki-new-document-dialog | `components/WikiNewDocumentDialog.tsx` |
| `wiki-new-document-open-directory` | wiki-new-document-open-directory | `components/WikiNewDocumentDialog.tsx` |
| `wiki-new-directory-input` | wiki-new-directory-input | `components/WikiNewDocumentDialog.tsx` |
| `wiki-new-file-input` | wiki-new-file-input | `components/WikiNewDocumentDialog.tsx` |
| `wiki-new-target-preview` | wiki-new-target-preview | `components/WikiNewDocumentDialog.tsx` |
| `wiki-new-document-error` | wiki-new-document-error | `components/WikiNewDocumentDialog.tsx` |
| `wiki-new-confirm` | wiki-new-confirm | `components/WikiNewDocumentDialog.tsx` |
| `wiki-read-placeholder-hint` | wiki-read-placeholder-hint | `components/WikiReadView.tsx` |
| `wiki-read-placeholder-edit` | wiki-read-placeholder-edit | `components/WikiReadView.tsx` |
| `wiki-read-empty-edit` | wiki-read-empty-edit | `components/WikiReadView.tsx` |
| `wiki-read-empty-pick-template` | wiki-read-empty-pick-template | `components/WikiReadView.tsx` |
| `wiki-read-empty-blank` | wiki-read-empty-blank | `components/WikiReadView.tsx` |
| `wiki-rename-directory-dialog` | wiki-rename-directory-dialog | `components/WikiRenameDirectoryDialog.tsx` |
| `wiki-rename-directory-source` | wiki-rename-directory-source | `components/WikiRenameDirectoryDialog.tsx` |
| `wiki-rename-directory-name-input` | wiki-rename-directory-name-input | `components/WikiRenameDirectoryDialog.tsx` |
| `wiki-rename-directory-target` | wiki-rename-directory-target | `components/WikiRenameDirectoryDialog.tsx` |
| `wiki-rename-directory-impact` | wiki-rename-directory-impact | `components/WikiRenameDirectoryDialog.tsx` |
| `wiki-rename-directory-conflicts` | wiki-rename-directory-conflicts | `components/WikiRenameDirectoryDialog.tsx` |
| `wiki-rename-directory-error` | wiki-rename-directory-error | `components/WikiRenameDirectoryDialog.tsx` |
| `wiki-rename-directory-cancel` | wiki-rename-directory-cancel | `components/WikiRenameDirectoryDialog.tsx` |
| `wiki-rename-directory-confirm` | wiki-rename-directory-confirm | `components/WikiRenameDirectoryDialog.tsx` |
| `wiki-restore-preflight` | wiki-restore-preflight | `components/WikiRestorePreflight.tsx` |
| `wiki-restore-preflight-loading` | wiki-restore-preflight-loading | `components/WikiRestorePreflight.tsx` |
| `wiki-restore-preflight-error` | wiki-restore-preflight-error | `components/WikiRestorePreflight.tsx` |
| `wiki-restore-diff` | wiki-restore-diff | `components/WikiRestorePreflight.tsx` |
| `wiki-restore-confirm` | wiki-restore-confirm | `components/WikiRestorePreflight.tsx` |
| `wiki-tree-group-toggle` | wiki-tree-group-toggle | `components/WikiTree.tsx` |
| `wiki-upload-preflight` | wiki-upload-preflight | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-preflight-loading` | wiki-upload-preflight-loading | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-preflight-error` | wiki-upload-preflight-error | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-target` | wiki-upload-target | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-directory-input` | wiki-upload-directory-input | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-target-path` | wiki-upload-target-path | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-target-status` | wiki-upload-target-status | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-summary` | wiki-upload-summary | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-summary-source` | wiki-upload-summary-source | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-summary-target` | wiki-upload-summary-target | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-summary-existing` | wiki-upload-summary-existing | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-summary-title` | wiki-upload-summary-title | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-summary-refs` | wiki-upload-summary-refs | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-warnings` | wiki-upload-warnings | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-diff` | wiki-upload-diff | `components/WikiUploadPreflight.tsx` |
| `wiki-upload-confirm` | wiki-upload-confirm | `components/WikiUploadPreflight.tsx` |
| `wiki-version-history-dialog` | wiki-version-history-dialog | `components/WikiVersionHistoryDialog.tsx` |
| `wiki-version-history-error` | wiki-version-history-error | `components/WikiVersionHistoryDialog.tsx` |
| `wiki-version-detail` | wiki-version-detail | `components/WikiVersionHistoryDialog.tsx` |
| `wiki-version-back-to-list` | wiki-version-back-to-list | `components/WikiVersionHistoryDialog.tsx` |
| `wiki-version-detail-meta` | wiki-version-detail-meta | `components/WikiVersionHistoryDialog.tsx` |
| `wiki-version-markdown-preview` | wiki-version-markdown-preview | `components/WikiVersionHistoryDialog.tsx` |
| `wiki-version-diff` | wiki-version-diff | `components/WikiVersionHistoryDialog.tsx` |
| `wiki-version-list` | wiki-version-list | `components/WikiVersionHistoryDialog.tsx` |
| `wiki-version-table` | wiki-version-table | `components/WikiVersionHistoryDialog.tsx` |
| `catalog-asset-manifest-drawer` | catalog-asset-manifest-drawer | `components/catalog/CatalogAssetManifestDrawer.tsx` |
| `catalog-asset-manifest-panel` | catalog-asset-manifest-panel | `components/catalog/CatalogAssetManifestDrawer.tsx` |
| `catalog-asset-manifest-close` | catalog-asset-manifest-close | `components/catalog/CatalogAssetManifestDrawer.tsx` |
| `catalog-asset-manifest-loading` | catalog-asset-manifest-loading | `components/catalog/CatalogAssetManifestDrawer.tsx` |
| `catalog-asset-manifest-target-file` | catalog-asset-manifest-target-file | `components/catalog/CatalogAssetManifestDrawer.tsx` |
| `catalog-asset-manifest-content` | catalog-asset-manifest-content | `components/catalog/CatalogAssetManifestDrawer.tsx` |
| `catalog-asset-manifest-download` | catalog-asset-manifest-download | `components/catalog/CatalogAssetManifestDrawer.tsx` |
| `catalog-asset-manifest-reupload` | catalog-asset-manifest-reupload | `components/catalog/CatalogAssetManifestDrawer.tsx` |
| `catalog-asset-upload-overwrite-note` | catalog-asset-upload-overwrite-note | `components/catalog/CatalogAssetUploadDrawer.tsx` |
| `setup-assistant-modal` | setup-assistant-modal | `components/onboarding/SetupAssistantModal.tsx` |
| `setup-modal-close-btn` | setup-modal-close-btn | `components/onboarding/SetupAssistantModal.tsx` |
| `setup-step-1` | setup-step-1 | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-conn-id` | setup-conn-id | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-host` | setup-host | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-port` | setup-port | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-database` | setup-database | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-driver` | setup-driver | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-engine-hint` | setup-engine-hint | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-schema` | setup-schema | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-username` | setup-username | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-password` | setup-password | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-probe-btn` | setup-probe-btn | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-step1-next` | setup-step1-next | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-step-2` | setup-step-2 | `components/onboarding/Step2UploadManifest.tsx` |
| `setup-manifest-file-input` | setup-manifest-file-input | `components/onboarding/Step2UploadManifest.tsx` |
| `setup-manifest-textarea` | setup-manifest-textarea | `components/onboarding/Step2UploadManifest.tsx` |
| `setup-step2-exit` | setup-step2-exit | `components/onboarding/Step2UploadManifest.tsx` |
| `setup-step2-status` | setup-step2-status | `components/onboarding/Step2UploadManifest.tsx` |
| `setup-step2-secondary` | setup-step2-secondary | `components/onboarding/Step2UploadManifest.tsx` |
| `setup-step2-upload` | setup-step2-upload | `components/onboarding/Step2UploadManifest.tsx` |
| `setup-downgrade-preview` | setup-downgrade-preview | `components/onboarding/Step2UploadManifest.tsx` |
| `setup-downgrade-confirm` | setup-downgrade-confirm | `components/onboarding/Step2UploadManifest.tsx` |
| `setup-schema-${item.schema}` | setup-schema-${item.schema} | `components/onboarding/Step2UploadManifest.tsx` |
| `setup-step2-next` | setup-step2-next | `components/onboarding/Step2UploadManifest.tsx` |
| `setup-step-3` | setup-step-3 | `components/onboarding/Step3SelectTables.tsx` |
| `setup-select-all` | setup-select-all | `components/onboarding/Step3SelectTables.tsx` |
| `setup-select-none` | setup-select-none | `components/onboarding/Step3SelectTables.tsx` |
| `setup-table-search` | setup-table-search | `components/onboarding/Step3SelectTables.tsx` |
| `setup-step3-resync` | setup-step3-resync | `components/onboarding/Step3SelectTables.tsx` |
| `setup-step3-next` | setup-step3-next | `components/onboarding/Step3SelectTables.tsx` |
| `setup-step-4` | setup-step-4 | `components/onboarding/Step4SemanticOverlay.tsx` |
| `setup-manifest-confirm-overwrite` | setup-manifest-confirm-overwrite | `components/onboarding/Step2UploadManifest.tsx` |
| `setup-manifest-parsed-count` | setup-manifest-parsed-count | `components/onboarding/SetupAssistantModal.tsx` |
| `setup-step4-overlay-guidance` | setup-step4-overlay-guidance | `components/onboarding/Step4SemanticOverlay.tsx` |
| `setup-step4-next` | setup-step4-next | `components/onboarding/Step4SemanticOverlay.tsx` |
| `setup-step-5` | setup-step-5 | `components/onboarding/Step5BusinessWiki.tsx` |
| `setup-wiki-file-input` | setup-wiki-file-input | `components/onboarding/Step5BusinessWiki.tsx` |
| `setup-wiki-path` | setup-wiki-path | `components/onboarding/Step5BusinessWiki.tsx` |
| `setup-wiki-textarea` | setup-wiki-textarea | `components/onboarding/Step5BusinessWiki.tsx` |
| `setup-step5-skip` | setup-step5-skip | `components/onboarding/Step5BusinessWiki.tsx` |
| `setup-step5-next` | setup-step5-next | `components/onboarding/Step5BusinessWiki.tsx` |
| `setup-step-6` | setup-step-6 | `components/onboarding/Step6ConnectAgent.tsx` |
| `setup-readiness-headline` | setup-readiness-headline | `components/onboarding/Step6ConnectAgent.tsx` |
| `setup-copy-config-btn` | setup-copy-config-btn | `components/onboarding/Step6ConnectAgent.tsx` |
| `setup-copy-prompt-btn` | setup-copy-prompt-btn | `components/onboarding/Step6ConnectAgent.tsx` |
| `setup-goto-playground` | setup-goto-playground | `components/onboarding/Step6ConnectAgent.tsx` |
| `setup-finish-btn` | setup-finish-btn | `components/onboarding/Step6ConnectAgent.tsx` |
| `catalog-result-count` | catalog-result-count | `pages/Catalog.tsx` |
| `catalog-empty-state` | catalog-empty-state | `pages/Catalog.tsx` |
| `catalog-table` | catalog-table | `pages/Catalog.tsx` |
| `help-search-results` | help-search-results | `pages/HelpCenter.tsx` |
| `help-search-empty` | help-search-empty | `pages/HelpCenter.tsx` |
| `login-brand-title` | login-brand-title | `pages/Login.tsx` |
| `ops-service-health-summary` | ops-service-health-summary | `pages/Onboarding.tsx` |
| `ops-service-health-summary-cta` | ops-service-health-summary-cta | `pages/Onboarding.tsx` |
| `ops-service-health` | ops-service-health | `pages/Onboarding.tsx` |
| `ops-service-health-log-link` | ops-service-health-log-link | `pages/Onboarding.tsx` |
| `mcp-config-drawer` | mcp-config-drawer | `pages/Onboarding.tsx` |
| `mcp-config-drawer-title` | mcp-config-drawer-title | `pages/Onboarding.tsx` |
| `mcp-config-drawer-close` | mcp-config-drawer-close | `pages/Onboarding.tsx` |
| `mcp-config-drawer-agent-link` | mcp-config-drawer-agent-link | `pages/Onboarding.tsx` |
| `onboarding-last-updated-announce` | onboarding-last-updated-announce | `pages/Onboarding.tsx` |
| `onboarding-refresh-controls` | onboarding-refresh-controls | `pages/Onboarding.tsx` |
| `onboarding-last-updated` | onboarding-last-updated | `pages/Onboarding.tsx` |
| `onboarding-refresh-button` | onboarding-refresh-button | `pages/Onboarding.tsx` |
| `ops-service-health-critical` | ops-service-health-critical | `pages/Onboarding.tsx` |
| `ops-service-health-critical-actions` | ops-service-health-critical-actions | `pages/Onboarding.tsx` |
| `ops-action-required` | ops-action-required | `pages/Onboarding.tsx` |
| `ops-action-required-count` | ops-action-required-count | `pages/Onboarding.tsx` |
| `ops-action-required-empty` | ops-action-required-empty | `pages/Onboarding.tsx` |
| `ops-mcp-access` | ops-mcp-access | `pages/Onboarding.tsx` |
| `mcp-config-copy-button` | mcp-config-copy-button | `pages/Onboarding.tsx` |
| `mcp-config-view-button` | mcp-config-view-button | `pages/Onboarding.tsx` |
| `overview-mcp-playground-link` | overview-mcp-playground-link | `pages/Onboarding.tsx` |
| `grain-picker` | grain-picker | `pages/TableEditor.tsx` |
| `table-description-buckets` | table-description-buckets | `pages/TableEditor.tsx` |
| `table-editor-validation-result` | table-editor-validation-result | `pages/TableEditor.tsx` |
| `table-editor-validation-issues` | table-editor-validation-issues | `pages/TableEditor.tsx` |
| `table-editor-change-review` | table-editor-change-review | `pages/TableEditor.tsx` |
| `table-editor-imported-yaml-name` | table-editor-imported-yaml-name | `pages/TableEditor.tsx` |
| `table-editor-import-drawer-backdrop` | table-editor-import-drawer-backdrop | `pages/TableEditor.tsx` |
| `table-editor-import-drawer` | table-editor-import-drawer | `pages/TableEditor.tsx` |
| `table-editor-import-guidance` | table-editor-import-guidance | `pages/TableEditor.tsx` |
| `paste-yaml-textarea` | paste-yaml-textarea | `pages/TableEditor.tsx` |
| `change-summary` | change-summary | `pages/TableEditor.tsx` |
| `table-editor-version-panel` | table-editor-version-panel | `pages/TableEditor.tsx` |
| `table-editor-header-context` | table-editor-header-context | `pages/TableEditor.tsx` |
| `semantic-content` | semantic-content | `pages/TableEditor.tsx` |
| `segments-panel` | segments-panel | `pages/TableEditor.tsx` |
| `field-batch-toolbar` | field-batch-toolbar | `pages/TableEditor.tsx` |
| `field-batch-selection-count` | field-batch-selection-count | `pages/TableEditor.tsx` |
| `field-editor-table` | field-editor-table | `pages/TableEditor.tsx` |
| `joins-inline-panel` | joins-inline-panel | `pages/TableEditor.tsx` |
| `table-editor-import-input` | table-editor-import-input | `pages/TableEditor.tsx` |
| `wiki-upload-button` | wiki-upload-button | `pages/WikiEditor.tsx` |
| `wiki-download-button` | wiki-download-button | `pages/WikiEditor.tsx` |
| `wiki-move-button` | wiki-move-button | `pages/WikiEditor.tsx` |
| `wiki-version-button` | wiki-version-button | `pages/WikiEditor.tsx` |
| `wiki-upload-replace-button` | wiki-upload-replace-button | `pages/WikiEditor.tsx` |
| `wiki-delete-document-button` | wiki-delete-document-button | `pages/WikiEditor.tsx` |
| `wiki-status-pill` | wiki-status-pill | `pages/WikiEditor.tsx` |
| `wiki-manage-access-button` | 打开单篇文档的管理访问权限 | `pages/WikiEditor.tsx` |
| `wiki-manage-access-blocked` | 正文未保存时不能管理访问权限 | `pages/WikiEditor.tsx` |
| `wiki-sidebar-create-directory` | wiki-sidebar-create-directory | `pages/WikiEditor.tsx` |
| `wiki-sidebar-create-document` | wiki-sidebar-create-document | `pages/WikiEditor.tsx` |
| `wiki-upload-input` | wiki-upload-input | `pages/WikiEditor.tsx` |
| `trace-span-policy` | trace-span-policy | `pages/admin/Audit.tsx` |
| `trace-span-policy-allowed` | trace-span-policy-allowed | `pages/admin/Audit.tsx` |
| `trace-span-policy-source` | trace-span-policy-source | `pages/admin/Audit.tsx` |
| `trace-span-artifacts` | trace-span-artifacts | `pages/admin/Audit.tsx` |
| `trace-detail-title` | trace-detail-title | `pages/admin/Audit.tsx` |
| `trace-detail-trace-id` | trace-detail-trace-id | `pages/admin/Audit.tsx` |
| `trace-detail-close` | trace-detail-close | `pages/admin/Audit.tsx` |
| `trace-detail-loading` | trace-detail-loading | `pages/admin/Audit.tsx` |
| `trace-detail-error` | trace-detail-error | `pages/admin/Audit.tsx` |
| `trace-detail-empty` | trace-detail-empty | `pages/admin/Audit.tsx` |
| `trace-detail-spans` | trace-detail-spans | `pages/admin/Audit.tsx` |
| `trace-detail-evidence` | trace-detail-evidence | `pages/admin/Audit.tsx` |
| `audit-turn-drawer` | audit-turn-drawer | `pages/admin/Audit.tsx` |
| `audit-turn-drawer-close` | audit-turn-drawer-close | `pages/admin/Audit.tsx` |
| `audit-turn-inferred-disclaimer` | audit-turn-inferred-disclaimer | `pages/admin/Audit.tsx` |
| `audit-turn-summary-card` | audit-turn-summary-card | `pages/admin/Audit.tsx` |
| `audit-turn-tables-inline` | audit-turn-tables-inline | `pages/admin/Audit.tsx` |
| `audit-turn-tables-expand` | audit-turn-tables-expand | `pages/admin/Audit.tsx` |
| `audit-turn-calls-card` | audit-turn-calls-card | `pages/admin/Audit.tsx` |
| `audit-turn-calls-table` | audit-turn-calls-table | `pages/admin/Audit.tsx` |
| `audit-stats-time` | audit-stats-time | `pages/admin/Audit.tsx` |
| `audit-export-current` | 审计当前视图导出入口 | `pages/admin/Audit.tsx` |
| `audit-export-related` | 审计关联视图导出入口 | `pages/admin/Audit.tsx` |
| `audit-export-pack` | 审计证据包导出 | `pages/admin/Audit.tsx` |
| `audit-view-tabs` | audit-view-tabs | `pages/admin/Audit.tsx` |
| `audit-tab-turns` | audit-tab-turns | `pages/admin/Audit.tsx` |
| `audit-tab-calls` | audit-tab-calls | `pages/admin/Audit.tsx` |
| `audit-time-presets` | audit-time-presets | `pages/admin/Audit.tsx` |
| `audit-shared-filters` | audit-shared-filters | `pages/admin/Audit.tsx` |
| `audit-key-search` | audit-key-search | `pages/admin/Audit.tsx` |
| `audit-time-label` | audit-time-label | `pages/admin/Audit.tsx` |
| `audit-since` | audit-since | `pages/admin/Audit.tsx` |
| `audit-until` | audit-until | `pages/admin/Audit.tsx` |
| `audit-advanced-filters-toggle` | audit-advanced-filters-toggle | `pages/admin/Audit.tsx` |
| `audit-clear-filters` | audit-clear-filters | `pages/admin/Audit.tsx` |
| `audit-advanced-filters` | audit-advanced-filters | `pages/admin/Audit.tsx` |
| `audit-call-source-filter` | audit-call-source-filter | `pages/admin/Audit.tsx` |
| `audit-turns-coverage-summary` | audit-turns-coverage-summary | `pages/admin/Audit.tsx` |
| `audit-turns-coverage-hint` | audit-turns-coverage-hint | `pages/admin/Audit.tsx` |
| `audit-calls-summary` | audit-calls-summary | `pages/admin/Audit.tsx` |
| `audit-pagination-summary` | audit-pagination-summary | `pages/admin/Audit.tsx` |
| `branding-form-error` | branding-form-error | `pages/admin/BrandingSettings.tsx` |
| `branding-logo-section` | branding-logo-section | `pages/admin/BrandingSettings.tsx` |
| `branding-logo-input` | branding-logo-input | `pages/admin/BrandingSettings.tsx` |
| `branding-text-section` | branding-text-section | `pages/admin/BrandingSettings.tsx` |
| `branding-product-title` | branding-product-title | `pages/admin/BrandingSettings.tsx` |
| `branding-product-title-help` | branding-product-title-help | `pages/admin/BrandingSettings.tsx` |
| `branding-tagline` | branding-tagline | `pages/admin/BrandingSettings.tsx` |
| `branding-tagline-help` | branding-tagline-help | `pages/admin/BrandingSettings.tsx` |
| `branding-preview` | branding-preview | `pages/admin/BrandingSettings.tsx` |
| `branding-sidebar-preview` | branding-sidebar-preview | `pages/admin/BrandingSettings.tsx` |
| `branding-login-preview` | branding-login-preview | `pages/admin/BrandingSettings.tsx` |
| `config-audit-filterbar` | config-audit-filterbar | `pages/admin/ConfigAudit.tsx` |
| `config-audit-time-label` | config-audit-time-label | `pages/admin/ConfigAudit.tsx` |
| `config-audit-window` | config-audit-window | `pages/admin/ConfigAudit.tsx` |
| `config-audit-since` | config-audit-since | `pages/admin/ConfigAudit.tsx` |
| `config-audit-until` | config-audit-until | `pages/admin/ConfigAudit.tsx` |
| `config-audit-change-type` | config-audit-change-type | `pages/admin/ConfigAudit.tsx` |
| `config-audit-page-range` | config-audit-page-range | `pages/admin/ConfigAudit.tsx` |
| `config-audit-page-index` | config-audit-page-index | `pages/admin/ConfigAudit.tsx` |
| `governance-usage-overview` | governance-usage-overview | `pages/admin/GovernanceOverview.tsx` |
| `governance-stats-time-controls` | governance-stats-time-controls | `pages/admin/GovernanceOverview.tsx` |
| `governance-stats-time` | governance-stats-time | `pages/admin/GovernanceOverview.tsx` |
| `governance-window-24h` | governance-window-24h | `pages/admin/GovernanceOverview.tsx` |
| `governance-window-7d` | governance-window-7d | `pages/admin/GovernanceOverview.tsx` |
| `governance-usage-metrics` | governance-usage-metrics | `pages/admin/GovernanceOverview.tsx` |
| `governance-usage-metrics-primary` | governance-usage-metrics-primary | `pages/admin/GovernanceOverview.tsx` |
| `governance-usage-metrics-secondary` | governance-usage-metrics-secondary | `pages/admin/GovernanceOverview.tsx` |
| `governance-usage-rank-grid` | governance-usage-rank-grid | `pages/admin/GovernanceOverview.tsx` |
| `governance-agent-usage` | governance-agent-usage | `pages/admin/GovernanceOverview.tsx` |
| `governance-token-usage` | governance-token-usage | `pages/admin/GovernanceOverview.tsx` |
| `governance-popular-tables` | governance-popular-tables | `pages/admin/GovernanceOverview.tsx` |
| `mcp-playground-page` | mcp-playground-page | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-agent` | mcp-playground-agent | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-role` | mcp-playground-role | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-task-connect` | 检查能不能连上 | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-task-table` | 检查能不能查某张表 | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-connect` | mcp-playground-connect | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-execution-block` | 问数进程未加载 | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-recheck` | 检测 {连接} | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-token` | mcp-playground-token | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-token-error` | 只粘贴 Token | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-run-live` | 检查接入 | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-table` | mcp-playground-table | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-policy-block` | 策略降级 | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-policy-link` | 查看配置审计 | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-role-link` | 去改 Role | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-connection` | mcp-playground-connection | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-source` | mcp-playground-source | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-run-table` | 检查权限 | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-preview-error` | mcp-playground-preview-error | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-preview-result` | mcp-playground-preview-result | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-live-error` | mcp-playground-live-error | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-live-result` | mcp-playground-live-result | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-result-headline` | mcp-playground-result-headline | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-result-detail` | mcp-playground-result-detail | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-result-action` | mcp-playground-result-action | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-technical` | 技术详情（查表拒绝） | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-live-confirm` | mcp-playground-live-confirm | `pages/admin/McpPlayground.tsx` |
| `mcp-playground-confirm-live` | mcp-playground-confirm-live | `pages/admin/McpPlayground.tsx` |
| `role-connections-field` | role-connections-field | `pages/admin/RoleDetail.tsx` |
| `role-connections-fallback-hint` | role-connections-fallback-hint | `pages/admin/RoleDetail.tsx` |
| `role-tools-field` | role-tools-field | `pages/admin/RoleDetail.tsx` |
| `role-tools-empty-error` | 空可授予工具的页内校验提示（Spec 194） | `pages/admin/RoleDetail.tsx` |
| `role-create-default-tools-hint` | 新建角色的默认只读问答引导（Spec 194） | `pages/admin/RoleDetail.tsx` |
| `role-tools-fallback-hint` | role-tools-fallback-hint | `pages/admin/RoleDetail.tsx` |
| `role-detail-invalid-warnings` | role-detail-invalid-warnings | `pages/admin/RoleDetail.tsx` |
| `role-allowed-tools-label` | role-allowed-tools-label | `pages/admin/RoleDetail.tsx` |
| `role-allowed-tools-list` | role-allowed-tools-list | `pages/admin/RoleDetail.tsx` |
| `role-boundary-summary` | 共享生效边界摘要 | `pages/admin/RoleDetail.tsx` |
| `row-policy-tool-warning` | 行级策略与工具不兼容警告 | `pages/admin/RoleDetail.tsx` |
| `legacy-prefix-migration` | 旧版 prefix 迁移提示或阻断 | `pages/admin/RoleDetail.tsx` |
| `role-table-grants` | 明确表授权编辑面 | `components/RoleTableGrants.tsx` |
| `table-grants-tree` | 连接 / Schema / 表选择树 | `components/RoleTableGrants.tsx` |
| `table-grants-manual-connections` | 目录绑定连接选择区 | `components/RoleTableGrants.tsx` |
| `table-grants-advanced` | 表范围高级设置 | `components/RoleTableGrants.tsx` |
| `role-custom-tools` | 自定义 MCP 工具折叠区 | `components/RoleToolGrants.tsx` |
| `role-row-policy-panel` | 行级策略表清单 | `components/RoleRowPolicyPanel.tsx` |
| `row-policy-catalog-bound-disabled` | 目录绑定下行级策略禁用提示 | `components/RoleRowPolicyPanel.tsx` |
| `row-policy-drawer` | 单表行级策略编辑 Drawer | `components/RoleRowPolicyPanel.tsx` |
| `role-permission-review-drawer` | 保存前权限变更确认 Drawer | `components/RolePermissionReviewDrawer.tsx` |
| `role-review-rejected-tools` | 保存时移除系统禁止工具提示 | `components/RolePermissionReviewDrawer.tsx` |
| `role-metric-grid` | role-metric-grid | `pages/admin/RoleList.tsx` |
| `role-invalid-notice` | role-invalid-notice | `pages/admin/RoleList.tsx` |
| `role-filter-connection` | role-filter-connection | `pages/admin/RoleList.tsx` |
| `role-filter-tool` | role-filter-tool | `pages/admin/RoleList.tsx` |
| `role-filter-table` | role-filter-table | `pages/admin/RoleList.tsx` |
| `role-current-filter` | role-current-filter | `pages/admin/RoleList.tsx` |
| `role-list-section` | role-list-section | `pages/admin/RoleList.tsx` |
| `role-list-table` | role-list-table | `pages/admin/RoleList.tsx` |
| `create-token-btn` | create-token-btn | `pages/admin/Tokens.tsx` |
| `token-kpis` | token-kpis | `pages/admin/Tokens.tsx` |
| `tokens-table` | tokens-table | `pages/admin/Tokens.tsx` |
| `tokens-grid-frame` | Token 凭据网格外框 | `pages/admin/Tokens.tsx` |
| `tokens-grid-scroll` | Token 凭据网格滚动层 | `pages/admin/Tokens.tsx` |
| `admin-accounts-grid-frame` | 登录账户网格外框 | `pages/admin/AdminAccounts.tsx` |
| `admin-accounts-grid-scroll` | 登录账户网格滚动层 | `pages/admin/AdminAccounts.tsx` |
| `admin-accounts-table` | 登录账户表格 | `pages/admin/AdminAccounts.tsx` |
| `start-onboarding-assistant-btn` | start-onboarding-assistant-btn | `pages/connections/ConnectionOverview.tsx` |
| `create-connection-btn` | create-connection-btn | `pages/connections/ConnectionOverview.tsx` |
| `connections-empty-state` | connections-empty-state | `pages/connections/ConnectionOverview.tsx` |
| `start-assistant-empty-btn` | start-assistant-empty-btn | `pages/connections/ConnectionOverview.tsx` |
| `create-connection-empty-btn` | create-connection-empty-btn | `pages/connections/ConnectionOverview.tsx` |
| `connection-test-empty` | connection-test-empty | `pages/connections/ConnectionTest.tsx` |
| `whitelist-action-draft` | whitelist-action-draft | `pages/connections/TableWhitelist.tsx` |
| `whitelist-action-invalid-enabled` | whitelist-action-invalid-enabled | `pages/connections/TableWhitelist.tsx` |
| `enabled-tables-empty` | enabled-tables-empty | `pages/connections/TableWhitelist.tsx` |
| `pl-whitelist-toolbar-actions` | pl-whitelist-toolbar-actions | `pages/connections/TableWhitelist.tsx` |
| `pl-whitelist-selection-summary` | pl-whitelist-selection-summary | `pages/connections/TableWhitelist.tsx` |
| `whitelist-remove-invalid-enabled` | whitelist-remove-invalid-enabled | `pages/connections/TableWhitelist.tsx` |
| `whitelist-batch-actions` | whitelist-batch-actions | `pages/connections/TableWhitelist.tsx` |
| `whitelist-select-all` | whitelist-select-all | `pages/connections/TableWhitelist.tsx` |
| `whitelist-invert` | whitelist-invert | `pages/connections/TableWhitelist.tsx` |
| `whitelist-hidden-invalid-enabled-banner` | whitelist-hidden-invalid-enabled-banner | `pages/connections/TableWhitelist.tsx` |
| `whitelist-show-invalid-enabled` | whitelist-show-invalid-enabled | `pages/connections/TableWhitelist.tsx` |
| `whitelist-remove-invalid-enabled-from-banner` | whitelist-remove-invalid-enabled-from-banner | `pages/connections/TableWhitelist.tsx` |
| `pl-whitelist-table` | pl-whitelist-table | `pages/connections/TableWhitelist.tsx` |
| `whitelist-invalid-enabled-section` | whitelist-invalid-enabled-section | `pages/connections/TableWhitelist.tsx` |
| `whitelist-missing-manifest-summary` | whitelist-missing-manifest-summary | `pages/connections/TableWhitelist.tsx` |
| `whitelist-missing-manifest-summary-link` | whitelist-missing-manifest-summary-link | `pages/connections/TableWhitelist.tsx` |
| `case-list-coverage` | case-list-coverage | `pages/eval/CaseList.tsx` |
| `case-list-coverage-card` | case-list-coverage-card | `pages/eval/CaseList.tsx` |
| `eval-domain-selector` | 评测域选择器 | `pages/eval/CaseList.tsx` |
| `eval-cases-grid-frame` | 评测用例网格外框 | `pages/eval/CaseList.tsx` |
| `eval-cases-grid-scroll` | 评测用例网格滚动层 | `pages/eval/CaseList.tsx` |
| `eval-cases-table` | 评测用例表格 | `pages/eval/CaseList.tsx` |
| `monitor-trend-chart` | monitor-trend-chart | `pages/eval/Monitor.tsx` |
| `monitor-threshold-yellow-line` | monitor-threshold-yellow-line | `pages/eval/Monitor.tsx` |
| `monitor-threshold-yellow-label` | monitor-threshold-yellow-label | `pages/eval/Monitor.tsx` |
| `monitor-threshold-red-line` | monitor-threshold-red-line | `pages/eval/Monitor.tsx` |
| `monitor-threshold-red-label` | monitor-threshold-red-label | `pages/eval/Monitor.tsx` |
| `monitor-trend-panel` | monitor-trend-panel | `pages/eval/Monitor.tsx` |
| `monitor-threshold-summary` | monitor-threshold-summary | `pages/eval/Monitor.tsx` |
| `monitor-below-red-summary` | monitor-below-red-summary | `pages/eval/Monitor.tsx` |
| `monitor-trend-empty` | monitor-trend-empty | `pages/eval/Monitor.tsx` |
| `monitor-trend-empty-actions` | monitor-trend-empty-actions | `pages/eval/Monitor.tsx` |
| `monitor-below-red-callout` | monitor-below-red-callout | `pages/eval/Monitor.tsx` |
| `monitor-below-red-drilldown` | monitor-below-red-drilldown | `pages/eval/Monitor.tsx` |
| `monitor-top-failures-grid-frame` | 失败用例网格外框 | `pages/eval/Monitor.tsx` |
| `monitor-top-failures-grid-scroll` | 失败用例网格滚动层 | `pages/eval/Monitor.tsx` |
| `monitor-top-failures-table` | 失败用例表格 | `pages/eval/Monitor.tsx` |
| `monitor-thresholds-grid-frame` | 告警阈值网格外框 | `pages/eval/Monitor.tsx` |
| `monitor-thresholds-grid-scroll` | 告警阈值网格滚动层 | `pages/eval/Monitor.tsx` |
| `monitor-thresholds-table` | 告警阈值表格 | `pages/eval/Monitor.tsx` |
| `publish-history-scope` | publish-history-scope | `pages/publish/PublishHistory.tsx` |
| `publish-history-scale` | publish-history-scale | `pages/publish/PublishHistory.tsx` |
| `publish-history-export-csv` | publish-history-export-csv | `pages/publish/PublishHistory.tsx` |
| `publish-history-filterbar` | publish-history-filterbar | `pages/publish/PublishHistory.tsx` |
| `publish-history-time-label` | publish-history-time-label | `pages/publish/PublishHistory.tsx` |
| `publish-history-window` | publish-history-window | `pages/publish/PublishHistory.tsx` |
| `publish-history-since` | publish-history-since | `pages/publish/PublishHistory.tsx` |
| `publish-history-until` | publish-history-until | `pages/publish/PublishHistory.tsx` |
| `publish-history-trigger` | publish-history-trigger | `pages/publish/PublishHistory.tsx` |
| `publish-history-reindex-filter` | publish-history-reindex-filter | `pages/publish/PublishHistory.tsx` |
| `publish-history-actor` | publish-history-actor | `pages/publish/PublishHistory.tsx` |
| `publish-history-page-range` | publish-history-page-range | `pages/publish/PublishHistory.tsx` |
| `publish-history-table` | publish-history-table | `pages/publish/PublishHistory.tsx` |
| `publish-history-serial` | publish-history-serial | `pages/publish/PublishHistory.tsx` |
| `publish-history-prev` | publish-history-prev | `pages/publish/PublishHistory.tsx` |
| `publish-history-page-index` | publish-history-page-index | `pages/publish/PublishHistory.tsx` |
| `publish-history-next` | publish-history-next | `pages/publish/PublishHistory.tsx` |
| `workbench-validation-issues` | workbench-validation-issues | `pages/publish/PublishWorkbench.tsx` |
| `workbench-validation-tech-details` | workbench-validation-tech-details | `pages/publish/PublishWorkbench.tsx` |
| `workbench-more-menu` | workbench-more-menu | `pages/publish/PublishWorkbench.tsx` |
| `workbench-sync-index` | workbench-sync-index | `pages/publish/PublishWorkbench.tsx` |
| `workbench-pending-panel` | workbench-pending-panel | `pages/publish/PublishWorkbench.tsx` |
| `workbench-batch-sync-hint` | workbench-batch-sync-hint | `pages/publish/PublishWorkbench.tsx` |
| `publish-gate-panel` | publish-gate-panel | `pages/publish/PublishWorkbench.tsx` |
| `publish-change-impact` | publish-change-impact | `pages/publish/PublishWorkbench.tsx` |
| `publish-flow-steps` | publish-flow-steps | `pages/publish/PublishWorkbench.tsx` |
| `publish-gate-next-step` | publish-gate-next-step | `pages/publish/PublishWorkbench.tsx` |
| `publish-impact-schema-list` | publish-impact-schema-list | `pages/publish/PublishWorkbench.tsx` |
| `publish-change-impact-list` | publish-change-impact-list | `pages/publish/PublishWorkbench.tsx` |
| `publish-impact-other-count` | publish-impact-other-count | `pages/publish/PublishWorkbench.tsx` |
| `publish-change-impact-blocked` | publish-change-impact-blocked | `pages/publish/PublishWorkbench.tsx` |
| `publish-boundary-and-index` | publish-boundary-and-index | `pages/publish/PublishWorkbench.tsx` |
| `publish-post-eval-prompt` | publish-post-eval-prompt | `pages/publish/PublishWorkbench.tsx` |
| `publish-post-eval-blocked` | publish-post-eval-blocked | `pages/publish/PublishWorkbench.tsx` |
| `workbench-change-detail-drawer` | workbench-change-detail-drawer | `pages/publish/PublishWorkbench.tsx` |
| `workbench-file-status` | workbench-file-status | `pages/publish/PublishWorkbench.tsx` |
| `workbench-publish-confirm-drawer` | workbench-publish-confirm-drawer | `pages/publish/PublishWorkbench.tsx` |
| `workbench-publish-confirm-summary` | workbench-publish-confirm-summary | `pages/publish/PublishWorkbench.tsx` |
| `workbench-publish-confirm-submit` | workbench-publish-confirm-submit | `pages/publish/PublishWorkbench.tsx` |
| `nav-link-${topLevelEntry.id}` | nav-link-${topLevelEntry.id} (template) | `app/App.tsx` |
| `nav-group-${group.id}` | nav-group-${group.id} (template) | `app/App.tsx` |
| `nav-group-toggle-${group.id}` | nav-group-toggle-${group.id} (template) | `app/App.tsx` |
| `nav-group-items-${group.id}` | nav-group-items-${group.id} (template) | `app/App.tsx` |
| `nav-link-${item.id}` | nav-link-${item.id} (template) | `app/App.tsx` |
| `role-table-range-${idx + 1}` | role-table-range-${idx + 1} (template) | `components/AssetHierarchyPicker.tsx` |
| `role-table-names-fallback-${idx + 1}` | role-table-names-fallback-${idx + 1} (template) | `components/AssetHierarchyPicker.tsx` |
| `role-row-access-${idx + 1}` | role-row-access-${idx + 1} (template) | `components/AssetHierarchyPicker.tsx` |
| `role-row-policy-${idx + 1}` | role-row-policy-${idx + 1} (template) | `components/AssetHierarchyPicker.tsx` |
| `role-row-predicate-${idx + 1}-${predIdx + 1}` | role-row-predicate-${idx + 1}-${predIdx + 1} (template) | `components/AssetHierarchyPicker.tsx` |
| `${testIdPrefix}-picker` | ${testIdPrefix}-picker (template) | `components/CheckboxCandidatePicker.tsx` |
| `${testIdPrefix}-batch-actions` | ${testIdPrefix}-batch-actions (template) | `components/CheckboxCandidatePicker.tsx` |
| `${testIdPrefix}-selection-summary` | ${testIdPrefix}-selection-summary (template) | `components/CheckboxCandidatePicker.tsx` |
| `${testIdPrefix}-select-all` | ${testIdPrefix}-select-all (template) | `components/CheckboxCandidatePicker.tsx` |
| `${testIdPrefix}-clear-all` | ${testIdPrefix}-clear-all (template) | `components/CheckboxCandidatePicker.tsx` |
| `${testIdPrefix}-filter` | ${testIdPrefix}-filter (template) | `components/CheckboxCandidatePicker.tsx` |
| `${testIdPrefix}-list` | ${testIdPrefix}-list (template) | `components/CheckboxCandidatePicker.tsx` |
| `command-palette-option-${entry.id}` | command-palette-option-${entry.id} (template) | `components/CommandPalette.tsx` |
| `metric-help-${helpId}` | metric-help-${helpId} (template) | `components/MetricCard.tsx` |
| `segment-card-${index}` | segment-card-${index} (template) | `components/SegmentForm.tsx` |
| `segment-description-${index}` | segment-description-${index} (template) | `components/SegmentForm.tsx` |
| `segment-remove-${index}` | segment-remove-${index} (template) | `components/SegmentForm.tsx` |
| `segment-name-${index}` | segment-name-${index} (template) | `components/SegmentForm.tsx` |
| `segment-expr-${index}` | segment-expr-${index} (template) | `components/SegmentForm.tsx` |
| `wiki-template-option-${template.label}` | wiki-template-option-${template.label} (template) | `components/TemplatePicker.tsx` |
| `wiki-library-document-button-${page.key}` | wiki-library-document-button-${page.key} (template) | `components/WikiLibraryHome.tsx` |
| `wiki-version-item-${version.versionId}` | wiki-version-item-${version.versionId} (template) | `components/WikiVersionHistoryDialog.tsx` |
| `wiki-version-view-${version.versionId}` | wiki-version-view-${version.versionId} (template) | `components/WikiVersionHistoryDialog.tsx` |
| `wiki-version-restore-${version.versionId}` | wiki-version-restore-${version.versionId} (template) | `components/WikiVersionHistoryDialog.tsx` |
| `setup-table-item-${qualName}` | setup-table-item-${qualName} (template) | `components/onboarding/Step3SelectTables.tsx` |
| `setup-mcp-tab-${type}` | setup-mcp-tab-${type} (template) | `components/onboarding/Step6ConnectAgent.tsx` |
| `catalog-row-${table.table}` | catalog-row-${table.table} (template) | `pages/Catalog.tsx` |
| `catalog-row-edit-${table.table}` | catalog-row-edit-${table.table} (template) | `pages/Catalog.tsx` |
| `catalog-row-not-enabled-${table.table}` | catalog-row-not-enabled-${table.table} (template) | `pages/Catalog.tsx` |
| `catalog-row-agents-${table.table}` | catalog-row-agents-${table.table} (template) | `pages/Catalog.tsx` |
| `catalog-row-maintain-${table.table}` | catalog-row-maintain-${table.table} (template) | `pages/Catalog.tsx` |
| `catalog-row-enable-scope-${table.table}` | catalog-row-enable-scope-${table.table} (template) | `pages/Catalog.tsx` |
| `${testId}-meta` | ${testId}-meta (template) | `pages/Onboarding.tsx` |
| `${testId}-link` | ${testId}-link (template) | `pages/Onboarding.tsx` |
| `trace-meta-redacted-${keyName}` | trace-meta-redacted-${keyName} (template) | `pages/admin/Audit.tsx` |
| `trace-meta-redacted-tooltip-${keyName}` | trace-meta-redacted-tooltip-${keyName} (template) | `pages/admin/Audit.tsx` |
| `trace-span-${event.spanId}` | trace-span-${event.spanId} (template) | `pages/admin/Audit.tsx` |
| `audit-trace-link-${traceId}` | audit-trace-link-${traceId} (template) | `pages/admin/Audit.tsx` |
| `audit-trace-drawer-${traceId}` | audit-trace-drawer-${traceId} (template) | `pages/admin/Audit.tsx` |
| `trace-evidence-${ev.id}` | trace-evidence-${ev.id} (template) | `pages/admin/Audit.tsx` |
| `audit-row-detail-${entry.id}` | audit-row-detail-${entry.id} (template) | `pages/admin/Audit.tsx` |
| `audit-call-turn-id-${entry.id}` | audit-call-turn-id-${entry.id} (template) | `pages/admin/Audit.tsx` |
| `audit-replay-playground-${entry.id}` | audit-replay-playground-${entry.id} (template) | `pages/admin/Audit.tsx` |
| `audit-call-source-playground-${entry.id}` | audit-call-source-playground-${entry.id} (template) | `pages/admin/Audit.tsx` |
| `audit-call-source-agent-${entry.id}` | audit-call-source-agent-${entry.id} (template) | `pages/admin/Audit.tsx` |
| `audit-generated-sql-${entry.id}` | audit-generated-sql-${entry.id} (template) | `pages/admin/Audit.tsx` |
| `audit-detail-panels-${entry.id}` | audit-detail-panels-${entry.id} (template) | `pages/admin/Audit.tsx` |
| `audit-related-agent-${entry.id}` | audit-related-agent-${entry.id} (template) | `pages/admin/Audit.tsx` |
| `audit-time-preset-${preset}` | audit-time-preset-${preset} (template) | `pages/admin/Audit.tsx` |
| `audit-turn-row-${entry.id}` | audit-turn-row-${entry.id} (template) | `pages/admin/Audit.tsx` |
| `audit-turn-open-${entry.id}` | audit-turn-open-${entry.id} (template) | `pages/admin/Audit.tsx` |
| `config-audit-target-link-${entry.id}` | config-audit-target-link-${entry.id} (template) | `pages/admin/ConfigAudit.tsx` |
| `${testId}-body` | ${testId}-body (template) | `pages/admin/GovernanceOverview.tsx` |
| `role-detail-warning-diagnosis-${idx}` | role-detail-warning-diagnosis-${idx} (template) | `pages/admin/RoleDetail.tsx` |
| `role-detail-warning-tech-${idx}` | role-detail-warning-tech-${idx} (template) | `pages/admin/RoleDetail.tsx` |
| `role-allowed-tools-count-${role.id}` | role-allowed-tools-count-${role.id} (template) | `pages/admin/RoleList.tsx` |
| `role-warnings-${role.id}` | role-warnings-${role.id} (template) | `pages/admin/RoleList.tsx` |
| `role-warning-diagnosis-${role.id}-${idx}` | role-warning-diagnosis-${role.id}-${idx} (template) | `pages/admin/RoleList.tsx` |
| `role-warning-template-note-${role.id}-${idx}` | role-warning-template-note-${role.id}-${idx} (template) | `pages/admin/RoleList.tsx` |
| `role-warning-tech-${role.id}-${idx}` | role-warning-tech-${role.id}-${idx} (template) | `pages/admin/RoleList.tsx` |
| `role-row-${role.id}` | role-row-${role.id} (template) | `pages/admin/RoleList.tsx` |
| `role-row-index-${role.id}` | role-row-index-${role.id} (template) | `pages/admin/RoleList.tsx` |
| `role-id-link-${role.id}` | role-id-link-${role.id} (template) | `pages/admin/RoleList.tsx` |
| `token-row-${token.label}` | token-row-${token.label} (template) | `pages/admin/Tokens.tsx` |
| `assistant-progress-badge-${conn.id}` | assistant-progress-badge-${conn.id} (template) | `pages/connections/ConnectionOverview.tsx` |
| `connection-health-${conn.id}` | connection-health-${conn.id} (template) | `pages/connections/ConnectionOverview.tsx` |
| `connection-assistant-banner-${conn.id}` | connection-assistant-banner-${conn.id} (template) | `pages/connections/ConnectionOverview.tsx` |
| `resume-assistant-${conn.id}` | resume-assistant-${conn.id} (template) | `pages/connections/ConnectionOverview.tsx` |
| `schema-live-count-${conn.id}-${schema}` | schema-live-count-${conn.id}-${schema} (template) | `pages/connections/ConnectionOverview.tsx` |
| `schema-local-count-${conn.id}-${schema}` | schema-local-count-${conn.id}-${schema} (template) | `pages/connections/ConnectionOverview.tsx` |
| `schema-source-drift-tag-${conn.id}-${schema}` | schema-source-drift-tag-${conn.id}-${schema} (template) | `pages/connections/ConnectionOverview.tsx` |
| `view-manifest-${conn.id}-${schema}` | view-manifest-${conn.id}-${schema} (template) | `pages/connections/ConnectionOverview.tsx` |
| `download-manifest-${conn.id}-${schema}` | download-manifest-${conn.id}-${schema} (template) | `pages/connections/ConnectionOverview.tsx` |
| `reupload-manifest-${conn.id}-${schema}` | reupload-manifest-${conn.id}-${schema} (template) | `pages/connections/ConnectionOverview.tsx` |
| `remove-schema-${conn.id}-${schema}` | remove-schema-${conn.id}-${schema} (template) | `pages/connections/ConnectionOverview.tsx` |
| `refresh-live-catalog-${conn.id}` | refresh-live-catalog-${conn.id} (template) | `pages/connections/ConnectionOverview.tsx` |
| `delete-connection-${conn.id}` | delete-connection-${conn.id} (template) | `pages/connections/ConnectionOverview.tsx` |
| `whitelist-group-${conn.id}-${schema}` | whitelist-group-${conn.id}-${schema} (template) | `pages/connections/TableWhitelist.tsx` |
| `whitelist-invalid-group-${conn.id}` | whitelist-invalid-group-${conn.id} (template) | `pages/connections/TableWhitelist.tsx` |
| `whitelist-invalid-row-${row.qualifiedName}` | whitelist-invalid-row-${row.qualifiedName} (template) | `pages/connections/TableWhitelist.tsx` |
| `preview-diff-${connId}` | preview-diff-${connId} (template) | `pages/connections/TableWhitelist.tsx` |
| `monitor-empty-action-${action}` | monitor-empty-action-${action} (template) | `pages/eval/Monitor.tsx` |
| `run-row-detail-${run.id}` | run-row-detail-${run.id} (template) | `pages/eval/RunList.tsx` |
| `workbench-validation-row-${table}` | workbench-validation-row-${table} (template) | `pages/publish/PublishWorkbench.tsx` |
| `publish-impact-table-${tableName}` | publish-impact-table-${tableName} (template) | `pages/publish/PublishWorkbench.tsx` |
| `publish-post-eval-${domain}` | publish-post-eval-${domain} (template) | `pages/publish/PublishWorkbench.tsx` |

## 7.1 业务 Skill（Spec 151 / 153）

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `skills-page` | 业务 Skill 页面根 | `pages/skills/SkillList.tsx` |
| `skills-create` | 新建 Skill | `pages/skills/SkillList.tsx` |
| `skills-workbench` | 统一 Skill 工作台 | `pages/skills/SkillList.tsx` |
| `skills-explorer` | 领域与 Skill 浏览器 | `pages/skills/SkillList.tsx` |
| `skills-search` | 浏览器搜索 | `pages/skills/SkillList.tsx` |
| `skills-all` | 全部 Skill 范围 | `pages/skills/SkillList.tsx` |
| `skills-domain` | 领域范围节点 | `pages/skills/SkillList.tsx` |
| `skills-section` | Skill 治理总览 | `pages/skills/SkillList.tsx` |
| `skills-error` | 列表错误 | `pages/skills/SkillList.tsx` |
| `skills-empty` | 空态 | `pages/skills/SkillList.tsx` |
| `skills-table` | Skill 表格 | `pages/skills/SkillList.tsx` |
| `skills-row` | Skill 行 | `pages/skills/SkillList.tsx` |
| `skills-open-detail` | 打开详情 | `pages/skills/SkillList.tsx` |
| `skill-status` | 状态 | `pages/skills/SkillList.tsx` |
| `skill-validation` | 校验状态 | `pages/skills/SkillList.tsx` |
| `skill-detail` | 主区阅读态 | `pages/skills/SkillList.tsx` |
| `skill-detail-back` | 返回领域治理总览 | `pages/skills/SkillList.tsx` |
| `skill-detail-title` | 阅读态标题 | `pages/skills/SkillList.tsx` |
| `skill-detail-content` | 正文详情 | `pages/skills/SkillList.tsx` |
| `skill-detail-path` | Skill 文件路径 | `pages/skills/SkillList.tsx` |
| `skill-detail-validation-issues` | 中文校验问题 | `pages/skills/SkillList.tsx` |
| `skill-detail-roles` | 阅读态可访问角色 | `pages/skills/SkillList.tsx` |
| `skill-detail-owner` | 阅读态负责人 | `pages/skills/SkillList.tsx` |
| `skill-owner` | 总览表负责人列 | `pages/skills/SkillList.tsx` |
| `skill-field-owner` | 编辑态负责人 | `pages/skills/SkillList.tsx` |
| `skill-preflight-owner` | 保存预检：负责人变化 | `pages/skills/SkillList.tsx` |
| `skill-field-roles` | 编辑态可访问角色（对象授权，T05/T06） | `components/ObjectAclField.tsx` |
| `skill-preflight-roles` | 保存预检：可访问角色变化 / 扩权 | `pages/skills/SkillList.tsx` |
| `skill-editor-form` | 编辑表单 | `pages/skills/SkillList.tsx` |
| `skill-metadata-toggle` | 元数据折叠区 | `pages/skills/SkillList.tsx` |
| `skill-field-name` | Skill name | `pages/skills/SkillList.tsx` |
| `skill-field-domain` | Skill domain | `pages/skills/SkillList.tsx` |
| `skill-field-title` | 标题 | `pages/skills/SkillList.tsx` |
| `skill-field-version` | 语义版本 | `pages/skills/SkillList.tsx` |
| `skill-field-status` | 状态选择 | `pages/skills/SkillList.tsx` |
| `skill-field-triggers` | 触发词 | `pages/skills/SkillList.tsx` |
| `skill-field-description` | 说明 | `pages/skills/SkillList.tsx` |
| `skill-field-content` | Markdown 正文 | `pages/skills/SkillList.tsx` |
| `skill-markdown-preview` | Markdown 渲染预览 | `pages/skills/SkillList.tsx` |
| `skill-form-error` | 保存错误 | `pages/skills/SkillList.tsx` |
| `skill-dirty` | 未保存修改状态 | `pages/skills/SkillList.tsx` |
| `skill-edit` | 编辑动作 | `pages/skills/SkillList.tsx` |
| `skill-save` | 保存并预检动作 | `pages/skills/SkillList.tsx` |
| `skill-cancel-edit` | 取消编辑 | `pages/skills/SkillList.tsx` |
| `skill-delete` | 删除动作 | `pages/skills/SkillList.tsx` |
| `skill-delete-confirm` | 删除确认 | `pages/skills/SkillList.tsx` |
| `skill-preflight` | 保存 Skill 前预检 | `pages/skills/SkillList.tsx` |
| `skill-preflight-diff` | 预检 Diff | `pages/skills/SkillList.tsx` |
| `skill-preflight-confirm` | 确认写入 | `pages/skills/SkillList.tsx` |

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
| 2026-10-12 | Spec 170 | `skill-roles-summary`、`skill-field-roles`、`skill-role-all`、`skill-role-option`、`skill-role-none`、`skill-role-unknown`、`skill-wildcard-ack`、`role-skill-access-summary` | （删除） | Skill / Wiki 对象授权暂停，控件不再渲染 |

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

## 10. 现行实现补录（2026-09-26）

以下选择器已存在于实现中，本次补录用于恢复发布矩阵的双向契约校验；不改变页面行为。

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `create-connection-engine-hint` | 创建连接引擎提示 | `components/CreateConnectionDrawer.tsx` |
| `create-connection-probe-override` | 连接探测覆盖提示 | `components/CreateConnectionDrawer.tsx` |
| `mcp-runtime-status-chips` | MCP 运行时状态组 | `components/McpRuntimeStatusPanel.tsx` |
| `mcp-runtime-remediation` | MCP 运行时整改提示 | `components/McpRuntimeStatusPanel.tsx` |
| `mcp-runtime-reload-outcome` | MCP 运行时重载结果（Spec 191，三维事实分区） | `components/McpRuntimeStatusPanel.tsx` |
| `role-effective-digest-text` | Role 有效权限摘要 | `components/RoleEffectiveDigest.tsx` |
| `capability-preview-details` | 能力预览详情 | `components/RoleEffectiveDigest.tsx` |
| `capability-preview-body` | 能力预览正文 | `components/RoleEffectiveDigest.tsx` |
| `capability-row` | 能力预览行 | `components/RoleEffectiveDigest.tsx` |
| `connection-test-guidance` | 连接测试整改提示 | `components/connections/ConnectionTestResultPanel.tsx` |
| `setup-token-card` | 接入向导 Token 卡片 | `components/onboarding/Step6ConnectAgent.tsx` |
| `setup-regenerate-token-btn` | 接入向导重新签发 Token | `components/onboarding/Step6ConnectAgent.tsx` |
| `setup-active-token` | 接入向导当前 Token | `components/onboarding/Step6ConnectAgent.tsx` |
| `setup-copy-token-btn` | 接入向导复制 Token | `components/onboarding/Step6ConnectAgent.tsx` |
| `setup-agent-select` | 接入向导 Agent 选择 | `components/onboarding/Step6ConnectAgent.tsx` |
| `setup-generate-token-btn` | 接入向导签发 Token | `components/onboarding/Step6ConnectAgent.tsx` |
| `setup-mcp-fallback-notice` | MCP 地址回退提示 | `components/onboarding/Step6ConnectAgent.tsx` |
| `setup-mcp-endpoint-diagnostic` | MCP 地址诊断 | `components/onboarding/Step6ConnectAgent.tsx` |
| `setup-mcp-config-snippet` | MCP 配置片段 | `components/onboarding/Step6ConnectAgent.tsx` |
| `agent-lucy-admin-role-warning` | Agent 管理角色风险提示 | `pages/admin/AgentDetail.tsx`、`AgentList.tsx` |
| `audit-granularity-help` | 审计粒度帮助 | `pages/admin/Audit.tsx` |
| `audit-export-metadata` | 审计导出元数据 | `pages/admin/Audit.tsx` |
| `audit-token-filter` | Token hash 前缀过滤条件 | `pages/admin/Audit.tsx` |
| `governance-usage-view` | 治理使用视图 | `pages/admin/GovernanceOverview.tsx` |
| `governance-view-access` | 治理访问视图 | `pages/admin/GovernanceOverview.tsx` |
| `governance-view-interface` | 治理界面视图 | `pages/admin/GovernanceOverview.tsx` |
| `governance-interface-error` | 治理界面错误 | `pages/admin/GovernanceOverview.tsx` |
| `governance-interface-loading` | 治理界面加载态 | `pages/admin/GovernanceOverview.tsx` |
| `governance-interface-usage` | 治理界面使用摘要 | `pages/admin/GovernanceOverview.tsx` |
| `governance-interface-metrics` | 治理界面指标 | `pages/admin/GovernanceOverview.tsx` |
| `usage-sparkline-page-views` | 页面访问折线 | `pages/admin/GovernanceOverview.tsx` |
| `governance-interface-unmapped` | 未映射界面入口 | `pages/admin/GovernanceOverview.tsx` |
| `governance-interface-rank-grid` | 界面排行 | `pages/admin/GovernanceOverview.tsx` |
| `governance-interface-groups` | 界面分组 | `pages/admin/GovernanceOverview.tsx` |
| `governance-interface-menus` | 界面菜单 | `pages/admin/GovernanceOverview.tsx` |
| `governance-interface-pages` | 界面页面 | `pages/admin/GovernanceOverview.tsx` |
| `new-token-expiry-policy-notice` | Token 有效期策略提示 | `pages/admin/NewToken.tsx` |
| `call-monitor-page` | 调用监控页面 | `pages/ops/CallMonitor.tsx` |
| `call-monitor-controls` | 调用监控控制区 | `pages/ops/CallMonitor.tsx` |
| `call-monitor-range-${option.range}` | 时间窗（模板） | `pages/ops/CallMonitor.tsx` |
| `call-monitor-range-24h` | 24 小时时间窗 | `pages/ops/CallMonitor.tsx` |
| `call-monitor-range-1h` | 1 小时时间窗 | `pages/ops/CallMonitor.tsx` |
| `call-monitor-range-7d` | 7 天时间窗 | `pages/ops/CallMonitor.tsx` |
| `call-monitor-range-30d` | 30 天时间窗 | `pages/ops/CallMonitor.tsx` |
| `call-monitor-sparkline-${seriesMetric}` | 窗内折线（模板） | `components/MetricCard.tsx` |
| `call-monitor-sparkline-volume` | 调用量折线 | `components/MetricCard.tsx` |
| `call-monitor-sparkline-success` | 成功率折线 | `components/MetricCard.tsx` |
| `call-monitor-sparkline-error` | 错误率折线 | `components/MetricCard.tsx` |
| `call-monitor-sparkline-denied` | 拒绝率折线 | `components/MetricCard.tsx` |
| `call-monitor-sparkline-p95` | 多数请求耗时折线 | `components/MetricCard.tsx` |
| `call-monitor-sparkline-slow` | 慢于多数请求折线 | `components/MetricCard.tsx` |
| `call-monitor-auto-refresh` | 调用监控自动刷新 | `pages/ops/CallMonitor.tsx` |
| `call-monitor-refresh` | 调用监控手动刷新 | `pages/ops/CallMonitor.tsx` |
| `call-monitor-error` | 调用监控错误态 | `pages/ops/CallMonitor.tsx` |
| `call-monitor-kpis` | 调用监控 KPI | `pages/ops/CallMonitor.tsx` |
| `call-monitor-empty` | 调用监控空态 | `pages/ops/CallMonitor.tsx` |
| `call-monitor-top-tools` | 高频工具 | `pages/ops/CallMonitor.tsx` |
| `call-monitor-recent-failures` | 最近失败 | `pages/ops/CallMonitor.tsx` |
| `call-monitor-link-errors` | 错误审计链接 | `pages/ops/CallMonitor.tsx` |
| `call-monitor-link-denied` | 拒绝审计链接 | `pages/ops/CallMonitor.tsx` |
| `workbench-validation-badge` | 发布校验状态 | `pages/publish/PublishWorkbench.tsx` |
| `workbench-validation-pending` | 发布校验等待态 | `pages/publish/PublishWorkbench.tsx` |
| `workbench-validation-banner` | 发布校验提示 | `pages/publish/PublishWorkbench.tsx` |
| `workbench-validation-rest-files` | 发布校验其余文件 | `pages/publish/PublishWorkbench.tsx` |
| `mcp-runtime-status-${testConnectionId}` | MCP 运行时状态（模板） | `components/McpRuntimeStatusPanel.tsx` |
| `mcp-runtime-recheck-${testConnectionId}` | MCP 运行时复检（模板） | `components/McpRuntimeStatusPanel.tsx` |
| `mcp-runtime-reload-${testConnectionId}` | MCP 运行时重载执行（模板，Spec 191） | `components/McpRuntimeStatusPanel.tsx` |
| `call-monitor-tool-${row.tool}` | 工具统计行（模板） | `pages/ops/CallMonitor.tsx` |
| `call-monitor-failure-${row.id}` | 失败调用行（模板） | `pages/ops/CallMonitor.tsx` |
## 2026-09-27 · Setup / Catalog / Role / Agent 增量合同

| testid | 页面 / 组件 | 用途 |
|---|---|---|
| `catalog-scope-tree` | CatalogScopeTree | Catalog 连接与 Schema 范围树容器 |
| `catalog-tree-root` | CatalogScopeTree | 全部连接根节点 |
| `catalog-tree-toggle-${connectionIndex}` | CatalogScopeTree | 展开或收起连接节点 |
| `catalog-tree-connection-${connectionIndex}` | CatalogScopeTree | 连接节点 |
| `catalog-tree-schema-${connectionIndex}-${schemaIndex}` | CatalogScopeTree | Schema 节点 |
| `object-detail-role-invalid` | ObjectDetailDrawer | 无效 Role 关联提示 |
| `setup-discard-confirm` | SetupAssistantModal | 放弃向导确认操作 |
| `setup-discard-close` | SetupAssistantModal | 关闭放弃确认框 |
| `setup-step4-table-guard` | Step4SemanticOverlay | 语义步骤选表前置门禁 |
| `setup-readiness-summary` | Step6ConnectAgent | 接入准备度摘要 |
| `setup-readiness-issues` | Step6ConnectAgent | 接入阻塞项列表 |
| `setup-token-expiry` | Step6ConnectAgent | Token 过期时间 |
| `setup-token-broad-ack` | Step6ConnectAgent | 宽权限 Token 确认 |
| `agent-refresh` | AgentList | 手动刷新 |
| `agent-audit-partial-notice` | AgentList | 审计数据不完整提示 |
| `agent-credential-partial-notice` | AgentList | 凭据统计不完整提示 |
| `agent-metrics-unavailable-${agent.id}` | AgentList | Agent 指标不可用提示 |
| `agent-used-credentials-${agent.id}` | AgentList | Agent 已使用凭据数 |
| `agent-protocol-calls-7d-${agent.id}` | AgentList | Agent 七日协议调用量 |
| `role-advanced-filters-toggle` | RoleList | 展开高级筛选 |
| `role-clear-filters` | RoleList | 清空筛选条件 |
| `role-advanced-filters` | RoleList | 高级筛选区域 |
| `role-clear-filters-empty` | RoleList | 空态清空筛选入口 |

## 2026-10-13 · Spec 174 入口性能增量合同

占位 testid 与真实内容 testid 互斥：性能就绪谓词只匹配真实内容（连接卡、表行、Agent 行），占位不复用这些 testid。

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `async-region-pending` | 分区静态占位（`aria-busy`，120 ms 后出现加载文字） | `components/AsyncRegion.tsx` |
| `async-region-error` | 分区局部错误 | `components/AsyncRegion.tsx` |
| `async-region-retry` | 分区局部重试 | `components/AsyncRegion.tsx` |
| `route-chunk-error` | 路由资源加载失败（壳层保留） | `app/App.tsx` |
| `route-chunk-retry` | 路由资源加载失败后的重试 | `app/App.tsx` |
| `catalog-runtime-unconfirmed` | 语义资产页「权限生效状态待确认」提示（`meta.runtimeConsistency = unconfirmed`） | `pages/Catalog.tsx` |
| `agent-runtime-unconfirmed` | Agent 列表「权限生效状态待确认」提示（`meta.runtimeConsistency = unconfirmed`） | `pages/admin/AgentList.tsx` |
| `execution-runtime-slot` | 连接概览问数提示的稳定占位（卡片出现时状态仍待返回；不可见、无文案） | `pages/connections/ConnectionOverview.tsx` |
| `schema-actions-pending-${conn.id}-${schema}` | Schema 行依赖 Manifest 事实的动作等待中（写入进行中或尚未重新读取） | `pages/connections/ConnectionOverview.tsx` |

## 2026-10-18 · T09 selector 漂移补录

实现已存在、契约未登记的选择器（Plan T09 步骤 4）。不改变页面行为；负向引用（断言元素不存在）规则见 `webui/scripts/check-selector-contract.mjs`。

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `catalog-bound-scope-note` | 按 Catalog 范围授权时的连接范围说明 | `components/RoleTableGrants.tsx` |
| `prepare-structure-drawer` | 准备表结构 Drawer | `components/SchemaStructurePrep.tsx` |
| `${idPrefix}-downgrade-preview` | 读取结构后的降级预览（模板；`add-schema` / `prepare-structure`） | `components/SchemaStructurePrep.tsx` |
| `${idPrefix}-structure-error` | 读取结构失败提示（模板） | `components/SchemaStructurePrep.tsx` |
| `${idPrefix}-done` | 结构准备完成/退出按钮（模板） | `components/SchemaStructurePrep.tsx` |
| `endpoint-gate-panel` | 连接端点冲突门禁面板 | `components/connections/EndpointConflictPanel.tsx` |
| `endpoint-gate-match-${match.id}` | 同端点已有连接单选项（模板） | `components/connections/EndpointConflictPanel.tsx` |
| `endpoint-gate-back` | 返回已有连接 | `components/connections/EndpointConflictPanel.tsx` |
| `endpoint-gate-different-database` | 新建连接（不同数据库） | `components/connections/EndpointConflictPanel.tsx` |
| `endpoint-gate-retry-live` | 重试读取 | `components/connections/EndpointConflictPanel.tsx` |
| `endpoint-gate-add-schema` | 添加到已有连接 | `components/connections/EndpointConflictPanel.tsx` |
| `endpoint-gate-separate` | 仍要新建连接 | `components/connections/EndpointConflictPanel.tsx` |
| `setup-assistant-progress` | 接入向导步骤进度 | `components/onboarding/SetupAssistantModal.tsx` |
| `${testId}-copy` | 编写说明复制按钮（模板；`setup-howto-schema-manifest` / `setup-howto-business-wiki`） | `components/onboarding/AuthoringHowTo.tsx` |
| `${testId}-download` | 编写说明下载按钮（模板） | `components/onboarding/AuthoringHowTo.tsx` |
| `login-config-unavailable` | 管理员配置不可用提示（`role="alert"`，登录表单隐藏） | `pages/Login.tsx` |
| `login-bootstrap-token` | 客户部署首次引导 Token 输入 | `pages/Login.tsx` |
| `login-password-toggle` | 登录页密码显示或隐藏 | `pages/Login.tsx` |
| `agent-token-list` | Agent 详情 Token 列表 | `pages/admin/AgentDetail.tsx` |
| `agent-token-row-${token.label}` | Agent Token 行（模板） | `pages/admin/AgentDetail.tsx` |
| `audit-turn-meta-card` | 问询详情元信息卡 | `pages/admin/Audit.tsx` |
| `audit-export-inquiry-pack` | 导出问询与调用 | `pages/admin/Audit.tsx` |
| `audit-call-inferred-turn-id-${entry.id}` | 调用流水推断问询 ID 链接（模板） | `pages/admin/Audit.tsx` |
| `audit-usage-slow-${entry.id}` | 调用流水问询慢标记（模板） | `pages/admin/Audit.tsx` |
| `usage-call-monitor-link` | 使用视图跳转调用监控 | `pages/admin/GovernanceOverview.tsx` |
| `execution-runtime-notice` | 连接概览问数运行时提示 | `pages/connections/ConnectionOverview.tsx` |
| `connection-more-${conn.id}` | 连接卡更多菜单（模板） | `pages/connections/ConnectionOverview.tsx` |
| `read-structure-${conn.id}-${schema}` | Schema 行 `从数据库读取表结构`（模板） | `pages/connections/ConnectionOverview.tsx` |
| `schema-more-${conn.id}-${schema}` | Schema 行更多菜单（模板） | `pages/connections/ConnectionOverview.tsx` |
| `whitelist-large-list-notice` | 启用表范围大列表折叠/分页提示 | `pages/connections/TableWhitelist.tsx` |
| `whitelist-group-toggle-${conn.id}-${schema}` | 启用表范围 Schema 分组展开开关（模板） | `pages/connections/TableWhitelist.tsx` |
| `monitor-field-panel` | 评测监控「现场」面板 | `pages/eval/Monitor.tsx` |
| `call-monitor-usage-slow-mark` | 调用监控问询慢标记生效说明 | `pages/ops/CallMonitor.tsx` |

## 2026-10-25 · v0.25 P1 梯队 selector 补录

> 守门脚本 `webui/scripts/check-selector-contract.mjs` 规则 ①：实现的 `data-testid` 必须在本表登记。
> 本轮 P1 梯队（行策略模板／授权摘要／访问关系图／Hive 编译侧）与此前轮次遗留的未登记元素在此一次性补录；
> **只登记实现中确实存在的 testid，不发明任何 id**（v0.3 重写原则第 2 条）。
> 登记后 `npm run e2e:selector-contract` 由红转绿，`npm run e2e:smoke` 的 pre-hook 不再阻断浏览器套件。

### `webui/src/pages/admin/AccessMap.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `access-map-access-unavailable` | 访问关系图：access unavailable | `pages/admin/AccessMap.tsx` |
| `access-map-back-to-full` | 访问关系图：back to full | `pages/admin/AccessMap.tsx` |
| `access-map-empty` | 访问关系图：empty | `pages/admin/AccessMap.tsx` |
| `access-map-error` | 访问关系图：error | `pages/admin/AccessMap.tsx` |
| `access-map-folded-badge` | 访问关系图：folded badge | `pages/admin/AccessMap.tsx` |
| `access-map-grant-unavailable` | 访问关系图：grant unavailable | `pages/admin/AccessMap.tsx` |
| `access-map-layer` | 访问关系图：layer | `pages/admin/AccessMap.tsx` |
| `access-map-partial-notice` | 访问关系图：partial notice | `pages/admin/AccessMap.tsx` |
| `access-map-search` | 访问关系图：search | `pages/admin/AccessMap.tsx` |
| `access-map-search-message` | 访问关系图：search message | `pages/admin/AccessMap.tsx` |
| `access-map-search-submit` | 访问关系图：search submit | `pages/admin/AccessMap.tsx` |
| `access-map-snapshot-id` | 访问关系图：snapshot id | `pages/admin/AccessMap.tsx` |
| `access-map-token-filter-notice` | 访问关系图：token filter notice | `pages/admin/AccessMap.tsx` |
| `access-map-trust` | 访问关系图：trust | `pages/admin/AccessMap.tsx` |
| `access-map-view-map` | 访问关系图：view map | `pages/admin/AccessMap.tsx` |
| `access-map-view-table` | 访问关系图：view table | `pages/admin/AccessMap.tsx` |
| `access-map-window` | 访问关系图：window | `pages/admin/AccessMap.tsx` |

### `webui/src/pages/admin/AgentList.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `new-agent-modal` | 新建 Agent：modal | `pages/admin/AgentList.tsx` |

### `webui/src/pages/admin/AuthorizationSummary.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `authorization-summary-missing-id` | 授权摘要：summary missing id | `pages/admin/AuthorizationSummary.tsx` |

### `webui/src/pages/admin/RoleDetail.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `role-repair-hint` | 角色修复：hint | `pages/admin/RoleDetail.tsx` |

### `webui/src/pages/admin/RowPolicyTemplates.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `row-policy-template-delete` | 行策略／行权限视图：template delete | `pages/admin/RowPolicyTemplates.tsx` |
| `row-policy-template-delete-dry-run` | 行策略／行权限视图：template delete dry run | `pages/admin/RowPolicyTemplates.tsx` |
| `row-policy-template-delete-target-mismatch` | 行策略／行权限视图：template delete target mismatch | `pages/admin/RowPolicyTemplates.tsx` |
| `row-policy-template-dry-run` | 行策略／行权限视图：template dry run | `pages/admin/RowPolicyTemplates.tsx` |
| `row-policy-template-edit` | 行策略／行权限视图：template edit | `pages/admin/RowPolicyTemplates.tsx` |
| `row-policy-template-editor` | 行策略／行权限视图：template editor | `pages/admin/RowPolicyTemplates.tsx` |
| `row-policy-template-issues` | 行策略／行权限视图：template issues | `pages/admin/RowPolicyTemplates.tsx` |
| `row-policy-template-reset` | 行策略／行权限视图：template reset | `pages/admin/RowPolicyTemplates.tsx` |
| `row-policy-template-save` | 行策略／行权限视图：template save | `pages/admin/RowPolicyTemplates.tsx` |
| `row-policy-templates-error` | 行策略／行权限视图：templates error | `pages/admin/RowPolicyTemplates.tsx` |
| `row-policy-templates-page` | 行策略／行权限视图：templates page | `pages/admin/RowPolicyTemplates.tsx` |

### `webui/src/pages/admin/RowPolicyView.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `row-policy-view-clear-filters` | 行策略／行权限视图：view clear filters | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-copy-identity` | 行策略／行权限视图：view copy identity | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-detail` | 行策略／行权限视图：view detail | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-detail-error` | 行策略／行权限视图：view detail error | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-failures` | 行策略／行权限视图：view failures | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-list-empty` | 行策略／行权限视图：view list empty | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-list-error` | 行策略／行权限视图：view list error | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-list-failures` | 行策略／行权限视图：view list failures | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-list-loading` | 行策略／行权限视图：view list loading | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-list-state` | 行策略／行权限视图：view list state | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-list-state-badge` | 行策略／行权限视图：view list state badge | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-outside-filter` | 行策略／行权限视图：view outside filter | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-page` | 行策略／行权限视图：view page | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-role-${role.roleId}` | 行策略／行权限视图：view role ${role.roleId} | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-role-access` | 行策略／行权限视图：view role access | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-role-branches` | 行策略／行权限视图：view role branches | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-role-templates` | 行策略／行权限视图：view role templates | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-table-${table.connectionId}-${table.schema}-${table.sourceName}` | 行策略／行权限视图：view table ${table.connectionId} ${table.schema} ${table.sourceName} | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-table-grant` | 行策略／行权限视图：view table grant | `pages/admin/RowPolicyView.tsx` |
| `row-policy-view-table-list` | 行策略／行权限视图：view table list | `pages/admin/RowPolicyView.tsx` |

### `webui/src/components/AgentRoleField.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `agent-business-role-options` | Agent 业务角色：options | `components/AgentRoleField.tsx` |
| `agent-ops-role-group` | Agent 运维角色：group | `components/AgentRoleField.tsx` |

### `webui/src/components/CreateConnectionDrawer.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `create-connection-catalog` | 新建连接抽屉：catalog | `components/CreateConnectionDrawer.tsx` |
| `create-connection-region` | 新建连接抽屉：region | `components/CreateConnectionDrawer.tsx` |
| `create-connection-s3-staging-dir` | 新建连接抽屉：s3 staging dir | `components/CreateConnectionDrawer.tsx` |
| `create-connection-workgroup` | 新建连接抽屉：workgroup | `components/CreateConnectionDrawer.tsx` |

### `webui/src/components/DeleteConnectionDrawer.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `delete-connection-block-reason` | 删除连接抽屉：block reason | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-user-count` | 删除连接抽屉：user count | `components/DeleteConnectionDrawer.tsx` |
| `delete-connection-write-error` | 删除连接抽屉：write error | `components/DeleteConnectionDrawer.tsx` |

### `webui/src/components/RoleRowPolicyPanel.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `row-policy-authoring-mode-${key}` | 行策略／行权限视图：authoring mode ${key} | `components/RoleRowPolicyPanel.tsx` |
| `row-policy-drawer-template` | 行策略／行权限视图：drawer template | `components/RoleRowPolicyPanel.tsx` |
| `row-policy-entry-${key}` | 行策略／行权限视图：entry ${key} | `components/RoleRowPolicyPanel.tsx` |
| `row-policy-preview-details-${key}` | 行策略／行权限视图：preview details ${key} | `components/RoleRowPolicyPanel.tsx` |
| `row-policy-preview-unavailable-${key}` | 行策略／行权限视图：preview unavailable ${key} | `components/RoleRowPolicyPanel.tsx` |
| `row-policy-template-error-${key}` | 行策略／行权限视图：template error ${key} | `components/RoleRowPolicyPanel.tsx` |
| `row-policy-template-missing-${key}` | 行策略／行权限视图：template missing ${key} | `components/RoleRowPolicyPanel.tsx` |

### `webui/src/components/admin/AccessMapCanvas.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `access-map-canvas` | 访问关系图：canvas | `components/admin/AccessMapCanvas.tsx` |
| `access-map-edge-badge-${link.edge.id}` | 访问关系图：edge badge ${link.edge.id} | `components/admin/AccessMapCanvas.tsx` |
| `access-map-edge-badge-button-${link.edge.id}` | 访问关系图：edge badge button ${link.edge.id} | `components/admin/AccessMapCanvas.tsx` |
| `access-map-edge-badges` | 访问关系图：edge badges | `components/admin/AccessMapCanvas.tsx` |
| `access-map-edge-detail` | 访问关系图：edge detail | `components/admin/AccessMapCanvas.tsx` |
| `access-map-edge-detail-path-${evaluation.pathKey}` | 访问关系图：edge detail path ${evaluation.pathKey} | `components/admin/AccessMapCanvas.tsx` |
| `access-map-kernel-${link.edge.id}` | 访问关系图：kernel ${link.edge.id} | `components/admin/AccessMapCanvas.tsx` |
| `access-map-link-${link.edge.id}` | 访问关系图：link ${link.edge.id} | `components/admin/AccessMapCanvas.tsx` |
| `access-map-node-${node.id}` | 访问关系图：node ${node.id} | `components/admin/AccessMapCanvas.tsx` |
| `access-map-node-button-${item.node.id}` | 访问关系图：node button ${item.node.id} | `components/admin/AccessMapCanvas.tsx` |
| `access-map-node-list` | 访问关系图：node list | `components/admin/AccessMapCanvas.tsx` |
| `access-map-svg` | 访问关系图：svg | `components/admin/AccessMapCanvas.tsx` |

### `webui/src/components/admin/AccessMapCredentialList.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `access-map-credential-${agent.id}` | 访问关系图：credential ${agent.id} | `components/admin/AccessMapCredentialList.tsx` |
| `access-map-credential-empty` | 访问关系图：credential empty | `components/admin/AccessMapCredentialList.tsx` |
| `access-map-credential-list` | 访问关系图：credential list | `components/admin/AccessMapCredentialList.tsx` |
| `access-map-token-${token.id}` | 访问关系图：token ${token.id} | `components/admin/AccessMapCredentialList.tsx` |

### `webui/src/components/admin/AccessMapLegend.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `access-map-legend` | 访问关系图：legend | `components/admin/AccessMapLegend.tsx` |
| `access-map-legend-trust` | 访问关系图：legend trust | `components/admin/AccessMapLegend.tsx` |
| `access-map-legend-window` | 访问关系图：legend window | `components/admin/AccessMapLegend.tsx` |

### `webui/src/components/admin/AccessMapSignalBar.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `access-map-orphan-grants` | 访问关系图：orphan grants | `components/admin/AccessMapSignalBar.tsx` |
| `access-map-signal-bar` | 访问关系图：signal bar | `components/admin/AccessMapSignalBar.tsx` |
| `access-map-signal-calls` | 访问关系图：signal calls | `components/admin/AccessMapSignalBar.tsx` |
| `access-map-signal-confirmed` | 访问关系图：signal confirmed | `components/admin/AccessMapSignalBar.tsx` |
| `access-map-signal-confirmed-source` | 访问关系图：signal confirmed source（确凿越权档的来源标注，SC-10） | `components/admin/AccessMapSignalBar.tsx` |
| `access-map-signal-dormant` | 访问关系图：signal dormant | `components/admin/AccessMapSignalBar.tsx` |
| `access-map-signal-needs-review` | 访问关系图：signal needs review | `components/admin/AccessMapSignalBar.tsx` |
| `access-map-signal-needs-review-note` | 访问关系图：signal needs review note（需复核档的档位说明，禁称「越权」，SC-10） | `components/admin/AccessMapSignalBar.tsx` |
| `access-map-snapshot-coverage` | 访问关系图：snapshot coverage | `components/admin/AccessMapSignalBar.tsx` |

### `webui/src/components/admin/AccessMapTable.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `access-map-table` | 访问关系图：table | `components/admin/AccessMapTable.tsx` |
| `access-map-table-edges` | 访问关系图：table edges | `components/admin/AccessMapTable.tsx` |
| `access-map-table-empty` | 访问关系图：table empty | `components/admin/AccessMapTable.tsx` |
| `access-map-table-node-${node.id}` | 访问关系图：table node ${node.id} | `components/admin/AccessMapTable.tsx` |
| `access-map-table-nodes` | 访问关系图：table nodes | `components/admin/AccessMapTable.tsx` |
| `access-map-table-row-${edge.id}` | 访问关系图：table row ${edge.id} | `components/admin/AccessMapTable.tsx` |

### `webui/src/components/admin/AuthorizationHeadline.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `authorization-candidate-notice` | 授权摘要：candidate notice | `components/admin/AuthorizationHeadline.tsx` |
| `authorization-denominator-unknown` | 授权摘要：denominator unknown | `components/admin/AuthorizationHeadline.tsx` |
| `authorization-diagnostics` | 授权摘要：diagnostics | `components/admin/AuthorizationHeadline.tsx` |
| `authorization-headline` | 授权摘要：headline | `components/admin/AuthorizationHeadline.tsx` |
| `authorization-headline-text` | 授权摘要：headline text | `components/admin/AuthorizationHeadline.tsx` |
| `authorization-headline-unavailable` | 授权摘要：headline unavailable | `components/admin/AuthorizationHeadline.tsx` |
| `authorization-partial-notice` | 授权摘要：partial notice | `components/admin/AuthorizationHeadline.tsx` |
| `authorization-scoped-count` | 授权摘要：scoped count | `components/admin/AuthorizationHeadline.tsx` |
| `authorization-scoped-unknown` | 授权摘要：scoped unknown | `components/admin/AuthorizationHeadline.tsx` |

### `webui/src/components/admin/AuthorizationResourceCard.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `authorization-playground-link` | 授权摘要：playground link | `components/admin/AuthorizationResourceCard.tsx` |
| `authorization-resource-card` | 授权摘要：resource card | `components/admin/AuthorizationResourceCard.tsx` |
| `authorization-resource-empty` | 授权摘要：resource empty | `components/admin/AuthorizationResourceCard.tsx` |
| `authorization-resource-row` | 授权摘要：resource row | `components/admin/AuthorizationResourceCard.tsx` |
| `authorization-row-summary` | 授权摘要：row summary | `components/admin/AuthorizationResourceCard.tsx` |

### `webui/src/components/admin/AuthorizationRowBoundary.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `authorization-legacy-notice` | 授权摘要：legacy notice | `components/admin/AuthorizationRowBoundary.tsx` |
| `authorization-row-boundary` | 授权摘要：row boundary | `components/admin/AuthorizationRowBoundary.tsx` |
| `authorization-row-boundary-basis` | 授权摘要：row boundary basis | `components/admin/AuthorizationRowBoundary.tsx` |
| `authorization-row-boundary-empty` | 授权摘要：row boundary empty | `components/admin/AuthorizationRowBoundary.tsx` |
| `authorization-row-boundary-error` | 授权摘要：row boundary error | `components/admin/AuthorizationRowBoundary.tsx` |
| `authorization-row-boundary-item` | 授权摘要：row boundary item | `components/admin/AuthorizationRowBoundary.tsx` |
| `authorization-row-boundary-shape` | 授权摘要：row boundary shape | `components/admin/AuthorizationRowBoundary.tsx` |

### `webui/src/components/admin/AuthorizationSummaryPanel.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `authorization-access-map-link` | 授权摘要：access map link | `components/admin/AuthorizationSummaryPanel.tsx` |
| `authorization-playground-deep-link` | 授权摘要：playground deep link | `components/admin/AuthorizationSummaryPanel.tsx` |
| `authorization-referencing-agent-${agentId}` | 授权摘要：referencing agent ${agentId} | `components/admin/AuthorizationSummaryPanel.tsx` |
| `authorization-referencing-agents` | 授权摘要：referencing agents | `components/admin/AuthorizationSummaryPanel.tsx` |
| `authorization-related-links` | 授权摘要：related links | `components/admin/AuthorizationSummaryPanel.tsx` |
| `authorization-row-policy-link` | 授权摘要：row policy link | `components/admin/AuthorizationSummaryPanel.tsx` |
| `authorization-summary-panel` | 授权摘要：summary panel | `components/admin/AuthorizationSummaryPanel.tsx` |

### `webui/src/components/admin/AuthorizationSummarySection.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `authorization-summary-error` | 授权摘要：summary error | `components/admin/AuthorizationSummarySection.tsx` |
| `authorization-summary-loading` | 授权摘要：summary loading | `components/admin/AuthorizationSummarySection.tsx` |

### `webui/src/components/admin/AuthorizationTechnicalDetails.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `authorization-technical-body` | 授权摘要：technical body | `components/admin/AuthorizationTechnicalDetails.tsx` |
| `authorization-technical-details` | 授权摘要：technical details | `components/admin/AuthorizationTechnicalDetails.tsx` |

### `webui/src/components/admin/AuthorizationToolGroups.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `authorization-tool-group-${key}` | 授权摘要：tool group ${key} | `components/admin/AuthorizationToolGroups.tsx` |
| `authorization-tool-groups` | 授权摘要：tool groups | `components/admin/AuthorizationToolGroups.tsx` |
| `authorization-unclassified-tools` | 授权摘要：unclassified tools | `components/admin/AuthorizationToolGroups.tsx` |

### `webui/src/components/admin/RowPolicyDnfPreview.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `${testId}-all` | 既有模板元素（`${testId}-all`） | `components/admin/RowPolicyDnfPreview.tsx` |
| `${testId}-arm-${index}` | 既有模板元素（`${testId}-arm-${index}`） | `components/admin/RowPolicyDnfPreview.tsx` |
| `${testId}-empty` | 既有模板元素（`${testId}-empty`） | `components/admin/RowPolicyDnfPreview.tsx` |
| `row-policy-dnf-agent-${row.agentId}` | 行策略／行权限视图：dnf agent ${row.agentId} | `components/admin/RowPolicyDnfPreview.tsx` |
| `row-policy-dnf-agents-section` | 行策略／行权限视图：dnf agents section | `components/admin/RowPolicyDnfPreview.tsx` |
| `row-policy-dnf-boundary` | 行策略／行权限视图：dnf boundary | `components/admin/RowPolicyDnfPreview.tsx` |
| `row-policy-dnf-preview` | 行策略／行权限视图：dnf preview | `components/admin/RowPolicyDnfPreview.tsx` |
| `row-policy-dnf-unavailable` | 行策略／行权限视图：dnf unavailable | `components/admin/RowPolicyDnfPreview.tsx` |
| `row-policy-dnf-union-section` | 行策略／行权限视图：dnf union section | `components/admin/RowPolicyDnfPreview.tsx` |
| `row-policy-dnf-union-unavailable` | 行策略／行权限视图：dnf union unavailable | `components/admin/RowPolicyDnfPreview.tsx` |
| `row-policy-view-agent-expand` | 行策略／行权限视图：view agent expand | `components/admin/RowPolicyDnfPreview.tsx` |
| `row-policy-view-agent-uniform` | 行策略／行权限视图：view agent uniform | `components/admin/RowPolicyDnfPreview.tsx` |

### `webui/src/components/admin/RowPolicyStateBadge.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `row-policy-snapshot` | 行策略／行权限视图：snapshot | `components/admin/RowPolicyStateBadge.tsx` |
| `row-policy-status-${status}` | 行策略／行权限视图：status ${status} | `components/admin/RowPolicyStateBadge.tsx` |
| `row-policy-status-reason` | 行策略／行权限视图：status reason | `components/admin/RowPolicyStateBadge.tsx` |

### `webui/src/components/admin/RowPolicyTemplatePanel.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `row-policy-template-audit-state` | 行策略／行权限视图：template audit state | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-blocking-references` | 行策略／行权限视图：template blocking references | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-detail` | 行策略／行权限视图：template detail | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-detail-empty` | 行策略／行权限视图：template detail empty | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-empty` | 行策略／行权限视图：template empty | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-impact` | 行策略／行权限视图：template impact | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-impact-empty` | 行策略／行权限视图：template impact empty | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-impact-tables` | 行策略／行权限视图：template impact tables | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-impact-tables-empty` | 行策略／行权限视图：template impact tables empty | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-reference-count-${template.name}` | 行策略／行权限视图：template reference count ${template.name} | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-references` | 行策略／行权限视图：template references | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-references-empty` | 行策略／行权限视图：template references empty | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-row-${template.name}` | 行策略／行权限视图：template row ${template.name} | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-table` | 行策略／行权限视图：template table | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-usability` | 行策略／行权限视图：template usability | `components/admin/RowPolicyTemplatePanel.tsx` |
| `row-policy-template-usability-empty` | 行策略／行权限视图：template usability empty | `components/admin/RowPolicyTemplatePanel.tsx` |

### `webui/src/components/admin/RowPolicyTemplatePicker.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `row-policy-authoring-mode-${mode}` | 行策略／行权限视图：authoring mode ${mode} | `components/admin/RowPolicyTemplatePicker.tsx` |
| `row-policy-template-option-${option.name}` | 行策略／行权限视图：template option ${option.name} | `components/admin/RowPolicyTemplatePicker.tsx` |
| `row-policy-template-picker` | 行策略／行权限视图：template picker | `components/admin/RowPolicyTemplatePicker.tsx` |
| `row-policy-template-picker-empty` | 行策略／行权限视图：template picker empty | `components/admin/RowPolicyTemplatePicker.tsx` |
| `row-policy-template-picker-reason` | 行策略／行权限视图：template picker reason | `components/admin/RowPolicyTemplatePicker.tsx` |

### `webui/src/components/audit-trust/AssociationRevisionTimeline.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `association-revision-effective` | 关联修订时间线：effective | `components/audit-trust/AssociationRevisionTimeline.tsx` |
| `association-revision-history` | 关联修订时间线：history | `components/audit-trust/AssociationRevisionTimeline.tsx` |
| `association-revision-item` | 关联修订时间线：item | `components/audit-trust/AssociationRevisionTimeline.tsx` |
| `association-revision-original` | 关联修订时间线：original | `components/audit-trust/AssociationRevisionTimeline.tsx` |
| `association-revision-timeline` | 关联修订时间线：timeline | `components/audit-trust/AssociationRevisionTimeline.tsx` |

### `webui/src/components/audit-trust/AuditStatusTriad.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `audit-status-association` | 审计状态三元组：association | `components/audit-trust/AuditStatusTriad.tsx` |
| `audit-status-coverage` | 审计状态三元组：coverage | `components/audit-trust/AuditStatusTriad.tsx` |
| `audit-status-execution` | 审计状态三元组：execution | `components/audit-trust/AuditStatusTriad.tsx` |
| `audit-status-triad` | 审计状态三元组：triad | `components/audit-trust/AuditStatusTriad.tsx` |

### `webui/src/components/audit-trust/AuditTopMetaBar.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `audit-top-meta-bar` | 审计顶栏：meta bar | `components/audit-trust/AuditTopMetaBar.tsx` |
| `audit-top-meta-refresh` | 审计顶栏：meta refresh | `components/audit-trust/AuditTopMetaBar.tsx` |
| `audit-top-meta-stats-at` | 审计顶栏：meta stats at | `components/audit-trust/AuditTopMetaBar.tsx` |
| `audit-top-meta-sync-lag` | 审计顶栏：meta sync lag | `components/audit-trust/AuditTopMetaBar.tsx` |
| `audit-top-meta-window` | 审计顶栏：meta window | `components/audit-trust/AuditTopMetaBar.tsx` |
| `audit-top-meta-zone` | 审计顶栏：meta zone | `components/audit-trust/AuditTopMetaBar.tsx` |

### `webui/src/components/audit-trust/ClientCoveragePill.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `client-coverage-pill` | 客户端覆盖：pill | `components/audit-trust/ClientCoveragePill.tsx` |

### `webui/src/components/audit-trust/CredentialPrincipalCell.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `credential-principal-cell` | 凭据主体：cell | `components/audit-trust/CredentialPrincipalCell.tsx` |
| `credential-principal-copy` | 凭据主体：copy | `components/audit-trust/CredentialPrincipalCell.tsx` |
| `credential-principal-hint` | 凭据主体：hint | `components/audit-trust/CredentialPrincipalCell.tsx` |
| `credential-principal-value` | 凭据主体：value | `components/audit-trust/CredentialPrincipalCell.tsx` |

### `webui/src/components/audit-trust/ReadonlySqlRowset.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `readonly-sql-bytes` | 只读 SQL 结果集：bytes | `components/audit-trust/ReadonlySqlRowset.tsx` |
| `readonly-sql-cols` | 只读 SQL 结果集：cols | `components/audit-trust/ReadonlySqlRowset.tsx` |
| `readonly-sql-rows` | 只读 SQL 结果集：rows | `components/audit-trust/ReadonlySqlRowset.tsx` |
| `readonly-sql-rowset` | 只读 SQL 结果集：rowset | `components/audit-trust/ReadonlySqlRowset.tsx` |
| `readonly-sql-status` | 只读 SQL 结果集：status | `components/audit-trust/ReadonlySqlRowset.tsx` |

### `webui/src/components/onboarding/Step1ConnectDb.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `setup-athena-hint` | 接入向导：athena hint | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-catalog` | 接入向导：catalog | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-region` | 接入向导：region | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-s3-staging-dir` | 接入向导：s3 staging dir | `components/onboarding/Step1ConnectDb.tsx` |
| `setup-workgroup` | 接入向导：workgroup | `components/onboarding/Step1ConnectDb.tsx` |

### `webui/src/pages/admin/NewToken.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `new-token-expiry-preset-${preset.id}` | 新建 Token：expiry preset ${preset.id} | `pages/admin/NewToken.tsx` |
| `new-token-expiry-presets` | 新建 Token：expiry presets | `pages/admin/NewToken.tsx` |

### `webui/src/pages/publish/PublishHistory.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `publish-history-scope-manifest` | 发布历史：scope manifest | `pages/publish/PublishHistory.tsx` |
| `publish-history-scope-removed` | 发布历史：scope removed | `pages/publish/PublishHistory.tsx` |
| `publish-history-scope-written` | 发布历史：scope written | `pages/publish/PublishHistory.tsx` |

### `webui/src/pages/publish/PublishWorkbench.tsx`

| Test ID | 元素 | 出现位置 |
|---|---|---|
| `workbench-mirror-only-semantic` | workbench mirror only semantic | `pages/publish/PublishWorkbench.tsx` |
