# WO-M28: Connection Manifest Upload Affordance

**Goal:** 修复 `/connections` 页面 Schema 行内操作和 Schema Manifest 上传 Drawer 的 affordance 问题：行内操作降级为链接视觉，Drawer 文件名改为只读展示，并确认 `/connections` 是 Schema 级 YAML 的主入口。

**Spec:** `webui/docs/31-connection-manifest-upload-affordance-spec.md`

**Scope:** Frontend-only UX polish with tests. 不改变后端上传路径、安全校验、asset kind 或 Catalog reload 流程。不在 `/connections/whitelist` 新增或保留第二套 Schema Manifest 上传入口；不在数据库接入页面新增 table 级 YAML / semantic overlay 上传入口。

## Codex 直投 Prompt

你在 `/Users/zhangxingchen/Projects/project-lucy` 工作。请实现 `webui/docs/31-connection-manifest-upload-affordance-spec.md`。

必读：

- `AGENTS.md`
- `docs/DEVELOPMENT.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/29-connection-semantic-boundary-automation-spec.md`
- `webui/docs/31-connection-manifest-upload-affordance-spec.md`
- `webui/docs/34-table-whitelist-catalog-reload-layout-stability-spec.md`

交付：

1. `/connections` Schema 表格行内 `维护白名单`、`上传 Manifest` 改为轻量链接样式。
2. `CatalogAssetUploadDrawer` 中的 `文件名` 从可编辑 input 改为只读展示。
3. `CatalogAssetUploadDrawer` 明确支持连接级可选 Schema 与 Schema 行内锁定 Schema 两种模式。
4. 保留文件选择、拖拽、粘贴 YAML 源码、自动校验和上传功能；切换 Schema 时目标路径、默认文件名和 YAML 示例同步更新。
5. 更新相关测试。
6. 运行针对性测试和术语 lint。

收尾说明必须列出修改文件、验证命令和结果。

## 1. 开工前检查

```bash
git status --short
sed -n '1,220p' docs/DEVELOPMENT.md
sed -n '1,260p' webui/docs/00-product-terminology-standard.md
sed -n '1,240p' webui/docs/31-connection-manifest-upload-affordance-spec.md
```

注意：当前工作区可能已有其他未提交改动。只修改本工单相关文件，不回退他人改动。

## 2. 实现步骤

### Step 1: 行内操作样式

目标文件：

- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/components/catalog/CatalogAssetUploadButton.tsx`
- `webui/src/app/app.css`

要求：

- 为 Schema 表格行内动作使用专门的 link/action variant，例如 `variant="link"` 或显式 `className`。
- `维护白名单` 与 `上传 Manifest` 在视觉上保持一致。
- 样式必须是普通字重、链接色或品牌色、hover 下划线或变色。
- 不得影响连接卡片底部 `上传 Schema Manifest` 主按钮。
- 不得在 `/connections/whitelist` 中新增或依赖另一个 Schema Manifest 上传 Drawer。
- 不得新增 table 级 YAML / `上传 semantic overlay` 入口；该入口属于语义层维护。

### Step 2: 文件名只读展示

目标文件：

- `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`

要求：

- 删除或替换可编辑文件名 input。
- 保留内部 `filename` state，因为上传请求仍需要原始文件名。
- 默认 filename 仍按当前 Schema 初始化为 `<schema>.yaml`。
- 文件选择和拖拽后，`filename` 更新为 `file.name` 并只读展示。
- 可选 Schema 下拉切换时，`filename` 更新为 `<schema>.yaml`。
- 可选 Schema 下拉切换时，目标路径展示和 YAML 示例也必须更新为当前 Schema。
- YAML 示例中的 `table: <schema>.<table>` 不得与当前选择的 Schema 不一致。
- 文件名展示节点必须具备：
  - `data-testid="catalog-asset-upload-filename"`
  - `translate="no"`
  - `className` 包含 `notranslate`
  - `dir="ltr"`

### Step 2.5: Drawer 模式收敛

目标文件：

- `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`
- `webui/src/components/catalog/CatalogAssetUploadButton.tsx`
- `webui/src/pages/connections/ConnectionOverview.tsx`

要求：

- 连接级 `上传 Schema Manifest` 打开 `selectableSchema` 模式：显示 Schema 下拉，标题为 `上传 <connection> 的 Schema Manifest`。
- Schema 行内 `上传 Manifest` 打开 `lockedSchema` 模式：只读展示目标 Schema，标题为 `上传 <schema> 的 Schema Manifest`。
- 两种模式复用同一 Drawer、同一校验逻辑和同一提交 API。
- 如果 `/connections/whitelist` 后续跳转到 `/connections` 并携带 `connectionId + schema`，应进入 `lockedSchema` 或预选 Schema 的体验，而不是在白名单页直接上传。

### Step 3: 测试更新

目标文件：

- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/catalog-asset-upload.test.tsx`

覆盖：

- 行内 `上传 Manifest` 不再带 `pl-btn--ghost` / `pl-btn--primary` / `pl-btn--secondary` 这类按钮视觉类。
- 行内 `维护白名单` 使用相同链接样式。
- Drawer `catalog-asset-upload-filename` 不是 input，且显示 `openclaw_db.yaml`。
- 文件名只读展示具备翻译防御。
- 选择文件后只读展示更新为所选文件名。
- 连接级 Drawer 切换 Schema 后，目标路径、默认文件名和 YAML 示例同步变化。
- `/connections` 不出现 `上传 semantic overlay`。

### Step 4: 验证

至少运行：

```bash
cd webui && npm test -- connection-overview catalog-asset-upload
cd webui && npm run lint:terminology
```

如果环境已有本地开发服务，可额外手动查看：

```text
http://127.0.0.1:55176/connections
```

## 3. 验收清单

- [ ] Schema 行内 `维护白名单` 是轻量链接视觉。
- [ ] Schema 行内 `上传 Manifest` 是轻量链接视觉。
- [ ] 底部 `上传 Schema Manifest` 仍是按钮 CTA。
- [ ] `/connections` 是 Schema 级 YAML 主入口。
- [ ] Drawer 中 `文件名` 不可编辑。
- [ ] 默认文件名和选择文件后的文件名均可见。
- [ ] 切换 Schema 时目标路径、默认文件名和 YAML 示例同步变化。
- [ ] 文件名展示具备翻译防御。
- [ ] 粘贴 YAML 源码仍可触发校验。
- [ ] 数据库接入页面没有 table 级 YAML / semantic overlay 上传入口。
- [ ] 针对性测试通过。
- [ ] 术语 lint 通过。

## 4. 非目标

- 不修改服务端 `catalog-assets` 目标路径计算。
- 不新增上传资产类型。
- 不修改 semantic overlay 发布 Drawer。
- 不把 `上传 semantic overlay` 放进 `/connections` 或 `/connections/whitelist`。
- 不调整 Connection 卡片整体布局。
