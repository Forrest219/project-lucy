# WO-M29: Connection Overview Action Bar And Visual Noise

**Goal:** 完成 `/connections` Connection 卡片企业级抛光：操作集中到底部 Action Bar，状态 Badge 降噪，缺失 Manifest 诊断微操作组件化，并移除与 Connection 无关的系统级资产包迁移提示。

**Spec:** `webui/docs/32-connection-overview-actionbar-visual-noise-spec.md`

**Scope:** Frontend-only UX polish with tests. 不改变后端 Catalog reload、Schema Manifest 上传、Add Schema、表白名单导航或 `/review` 能力。

## Codex 直投 Prompt

你在 `/Users/zhangxingchen/Projects/project-lucy` 工作。请实现 `webui/docs/32-connection-overview-actionbar-visual-noise-spec.md`。

必读：

- `AGENTS.md`
- `docs/DEVELOPMENT.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/32-connection-overview-actionbar-visual-noise-spec.md`

交付：

1. `/connections` Connection 卡片头部不再显示 `刷新本地目录`。
2. Connection 卡片底部 Action Bar 按 `+ 添加 Schema`、`刷新本地目录`、`上传 Schema Manifest` 顺序展示。
3. Catalog reload 状态改为轻量 meta summary，避免 `已完成`、`3 张表`、`1 个提示` 多 Badge 竞争。
4. `凭据：inline` 降级为 meta 文本，不再用 warning pill。
5. 缺失 Manifest 诊断 sub-row 的 `展开详情`、`复制路径`、`重新检查` 使用明确 small button 样式。
6. 删除 `/connections` 底部系统级资产包导出迁移提示。
7. 更新相关测试并运行针对性验证。

收尾说明必须列出修改文件、验证命令和结果。

## 1. 开工前检查

```bash
git status --short
sed -n '1,220p' docs/DEVELOPMENT.md
sed -n '1,260p' webui/docs/00-product-terminology-standard.md
sed -n '1,260p' webui/docs/32-connection-overview-actionbar-visual-noise-spec.md
```

注意：当前工作区可能已有其他未提交改动。只修改本工单相关文件，不回退他人改动。

## 2. 实现步骤

### Step 1: Connection Action Bar

目标文件：

- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/app/app.css`

要求：

- 移除 card header 中的 `CatalogReloadButton`。
- 在 `pl-connection-card-footer` 内按顺序渲染：
  - `+ 添加 Schema`
  - `刷新本地目录`
  - `上传 Schema Manifest`
- `上传 Schema Manifest` 在 `hasManifestGap` 为 true 时保持 primary，否则 secondary。
- Action Bar 支持 flex wrap，但每个按钮文案不得拆字。

### Step 2: 状态色与 Badge 降噪

目标文件：

- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/app/app.css`

要求：

- `catalogState` 渲染为一条 meta summary，不再为 `已完成`、表数、提示数分别渲染 Badge。
- `凭据：inline` 不再添加 warning pill 类；保留 tooltip。
- 保留 Schema 表格中的 `缺失 Manifest` warning Badge。
- 失败状态可以保留 danger 文本或轻量 error 视觉。

### Step 3: 诊断微操作组件化

目标文件：

- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/app/app.css`

要求：

- `展开详情` 使用 ghost small button，可带 chevron 文本符号。
- `复制路径` 使用 ghost small button，可带 copy 文本符号；复制成功后仍显示 `已复制路径`。
- `重新检查` 使用 secondary small button，可带 refresh 文本符号。
- 路径展示使用 LTR、nowrap 或 overflow auto，避免路径片段难读。

### Step 4: 删除无关迁移提示

目标文件：

- `webui/src/pages/connections/ConnectionOverview.tsx`

要求：

- 删除 `/connections` 底部 `系统级资产包导出已迁移到...` 常驻提示。
- 不删除 `/review` 页面和相关导航能力。

### Step 5: 测试更新

目标文件：

- `webui/src/__tests__/connection-overview.test.tsx`

覆盖：

- Header 不再包含 `刷新本地目录`。
- Footer Action Bar 中按钮顺序正确。
- 状态 summary 不再渲染多个 catalog reload badge。
- 凭据来源不再带 warning pill。
- 诊断 sub-row 微操作是按钮样式，`重新检查` 有 secondary 权重。
- 迁移提示不存在。

### Step 6: 验证

至少运行：

```bash
cd webui && npm test -- connection-overview
cd webui && npm run lint:terminology
cd webui && npm run build
```

如果本地服务可用，可额外手动查看：

```text
http://127.0.0.1:55176/connections
```

## 3. 验收清单

- [ ] `刷新本地目录` 不在 Connection 卡片头部悬空。
- [ ] 底部 Action Bar 顺序为 `+ 添加 Schema`、`刷新本地目录`、`上传 Schema Manifest`。
- [ ] 成功状态和数量摘要不再使用多个 Badge。
- [ ] `凭据：inline` 不再被 warning pill 高亮。
- [ ] `缺失 Manifest` 是唯一常驻 warning Badge。
- [ ] 诊断区三个微操作具备清晰按钮 affordance。
- [ ] 迁移到 `变更审阅` 的旧提示不再出现在 `/connections`。
- [ ] 相关测试、术语 lint 和 build 通过。

## 4. 非目标

- 不修改后端 API。
- 不改变 `ktx.yaml`、`semantic-layer/**` 或任何运行时配置。
- 不新增图标依赖。
- 不重构其他页面。
