# wo-M45 Table Whitelist Productization Follow-up

> Codex / Claude Code 直投工单。执行前请阅读 `AGENTS.md`、`docs/DEVELOPMENT.md`、`webui/docs/00-product-terminology-standard.md` 和 `webui/docs/47-table-whitelist-productization-followup-spec.md` v0.1。

## 0. 背景

`/connections/whitelist` 第一轮改版后，浏览器复核确认结构方向正确，但用户继续指出 7 个体验与行为问题：

1. 右上角 `/data/lucy` 应删除。
2. `批量操作` 和 `刷新本地目录` 都是操作入口，但设计不一致。
3. 搜索框偏短，且 `批量操作` 更适合放在表格筛选区。
4. `已纳入` 不如 `已启用，待补语义` 直观。
5. 修改 checkbox 后显示 `待同步`，语义不清。
6. `YAML 预览` 对 1 张表变化生成大量无关红绿 diff。
7. 保存后提示「不会自动刷新本地目录」割裂流程。

本工单按 spec 47 执行第二轮修复。

## 1. 范围

### 1.1 主要修改文件

- `webui/src/pages/connections/TableWhitelist.tsx`
- `webui/src/app/app.css`
- `webui/server/index.ts`
- `webui/server/__tests__/api.save.test.ts`
- `webui/src/__tests__/table-whitelist.test.tsx`
- `webui/docs/README.md`
- `webui/docs/plans/README.md`

### 1.2 可能涉及

- `webui/src/components/DiffViewer.tsx`（仅当需要支持折叠完整 diff 或差异摘要）
- `webui/src/components/catalog/CatalogReloadButton.tsx`（仅当保存成功后复用刷新逻辑需要抽出 hook）
- `webui/src/lib/types.ts`（如果为 preview response 增加 `addedEnabledTables` / `removedEnabledTables` 类型）

### 1.3 不做

- 不改变 `enabled_tables` 业务语义。
- 不新增字段详情路由。
- 不新增 Schema Manifest 上传入口。
- 不连接数据库做扫描；本地目录刷新仍只读取本地 YAML 资产。

## 2. 实现步骤

### Step 1: PageHeader 去掉 `/data/lucy`

- 从 `TableWhitelist` 的 `PageHeader.badges` 移除 `projectQuery.data.root`。
- 如 `projectQuery` 仅用于这个 badge，可移除对应 query；如其它逻辑仍使用则保留。

验收：

- DOM 中 PageHeader 不出现 `/data/lucy`。
- 页面标题和描述保留。

### Step 2: 顶部动作分层

- PageHeader actions 只保留 `刷新本地目录`。
- 将 `批量操作` 移回 `.pl-whitelist-toolbar` 右侧，与 `已选 x/y 张表` 同区。
- `批量操作` 使用按钮式 menu trigger，而不是裸 `<summary>` 文字样式。
- `全选 / 反选` 继续放在 menu panel 内，作用于当前筛选结果。

建议 toolbar DOM：

```tsx
<div className="pl-whitelist-toolbar">
  <div className="pl-whitelist-filter-area">...</div>
  <div className="pl-whitelist-toolbar-actions">
    <span>已选 x/y 张表</span>
    <details className="pl-whitelist-batch-menu">...</details>
  </div>
</div>
```

验收：

- toolbar 不含 `刷新本地目录`。
- PageHeader actions 不含 `批量操作`。
- toolbar 右侧含 `已选 x/y 张表` 与 `批量操作`。

### Step 3: 搜索框加宽

- 新增或调整 `.pl-whitelist-search-input`。
- 桌面宽度建议 `min-width: 360px` 或 `width: 360px`，窄屏降为 `width: 100%`。
- 保持 placeholder `搜索表名/描述...`。

验收：

- 1280px 视口下搜索框宽度约为旧版两倍。
- 390px 窄屏无横向溢出。

### Step 4: 状态列文案重构

重构 `WhitelistStatus`：

```ts
type WhitelistStatus =
  | "enabled_complete"
  | "enabled_semantic_pending"
  | "disabled"
  | "draft_enable"
  | "draft_disable";
```

映射：

| 条件 | 状态 |
|---|---|
| `enabledDraft !== enabledPersisted && enabledDraft` | `draft_enable` |
| `enabledDraft !== enabledPersisted && !enabledDraft` | `draft_disable` |
| `enabledPersisted && completion === "done"` | `enabled_complete` |
| `enabledPersisted` | `enabled_semantic_pending` |
| otherwise | `disabled` |

UI 文案：

- `enabled_complete` -> `已启用，语义完成`
- `enabled_semantic_pending` -> `已启用，待补语义`
- `disabled` -> `未启用`
- `draft_enable` -> `待启用`
- `draft_disable` -> `待禁用`

动作列：

- 草稿态统一 `待保存`
- `enabled_complete` -> `查看语义 ↗`
- `enabled_semantic_pending` -> `编辑语义 ↗`
- `disabled` -> `查看字段 ↗`

验收：

- DOM 不出现 `已纳入`。
- DOM 不出现 `待同步`。
- 勾选未启用表显示 `待启用 / 待保存`。
- 取消勾选已启用表显示 `待禁用 / 待保存`。

### Step 5: 修复 enabled_tables YAML diff

当前代码在 `webui/server/index.ts` 中对 `ktx.yaml` 执行：

```ts
const config = parse(yamlText) as Record<string, unknown>;
connections[connId].enabled_tables = newEnabledTables;
const proposedYaml = stringify(config, { lineWidth: 0 });
```

必须改为 YAML Document / AST 级局部 patch：

- 用 `parseDocument(yamlText, { keepSourceTokens: true })` 或项目已有 YAML patch helper。
- 定位 `connections -> connId -> enabled_tables` 节点。
- 只替换该 sequence。
- 保留其它 connection、字段顺序、注释、未知字段和 quoting。
- `dryRun:true` 和实际保存共用同一 patch 函数。

建议新增 helper：

```ts
function patchConnectionEnabledTablesYaml(
  yamlText: string,
  connId: string,
  enabledTables: string[]
): {
  proposedYaml: string;
  oldEnabledTables: string[];
};
```

注意：

- 若目标 connection 不存在，仍返回 `CONNECTION_NOT_FOUND`。
- `validateEnabledTables` 继续沿用现有 scanned table 校验。
- `safeWrite(projectRoot, "ktx.yaml", proposedYaml)` 不变。

验收：

- 单表新增 dry-run diff 不应包含未修改 connection 的整块 removed / added。
- 单表移除 dry-run diff 不应包含 `schemas`、`driver`、`host` 等无关字段重排。
- `api.save.test.ts` 增加最小 diff 断言。

### Step 6: YAML 预览前端降噪

- Drawer 顶部继续展示新增 / 移除 chip 或列表。
- 文案从 `enabled_tables: 5 -> 4` 改为 `启用表范围：5 -> 4`。
- 完整 diff 可保留，但建议标题为 `完整 YAML diff`。
- 如果 Step 5 已修复最小 diff，则完整 diff 默认展开可接受；若仍有大 diff 风险，则默认折叠。

验收：

- 用户能在不阅读完整 diff 的情况下确认新增 / 移除表。
- 完整 diff 中无无关大块红绿变更。

### Step 7: 保存后刷新策略

推荐实现自动刷新：

- `saveMutation.onSuccess` 后，对每个 changed connection 调用与 `CatalogReloadButton` 相同的本地目录刷新 API。
- 保存成功后立即清空 dirty 状态。
- 刷新进行中显示轻量状态：

```text
启用表范围已保存，正在刷新本地目录...
```

- 刷新成功：

```text
启用表范围已保存，本地目录已刷新。
```

- 刷新失败：

```text
启用表范围已保存；本地目录刷新失败，请重试。
```

如果自动刷新实现成本超出本工单，则必须至少：

- 移除「保存不会自动刷新本地目录」作为终态提示。
- 在成功 Banner 内提供 `刷新本地目录` CTA。

验收：

- 保存成功后不再出现 `保存不会自动刷新本地目录。`
- 用户有明确下一步，或无需下一步。

## 3. 测试要求

### 3.1 前端测试

更新 `webui/src/__tests__/table-whitelist.test.tsx`：

- PageHeader 不显示 `/data/lucy`。
- `刷新本地目录` 仍在 PageHeader actions。
- `批量操作` 在 toolbar actions。
- 搜索框具备加宽 class。
- 状态文案：
  - `已启用，语义完成`
  - `已启用，待补语义`
  - `未启用`
  - `待启用`
  - `待禁用`
- 禁止旧文案：
  - `已纳入`
  - `待同步`
  - `加入白名单`
- YAML Preview 使用 `启用表范围：x -> y`。
- 保存成功后文案不再包含 `保存不会自动刷新本地目录`。

### 3.2 后端测试

更新 `webui/server/__tests__/api.save.test.ts`：

- dry-run 新增 1 张表：
  - response `oldEnabledTables` / `newEnabledTables` 正确。
  - `diff` 包含新增表。
  - `diff` 不包含未修改 connection 的整块删除 / 新增。
- dry-run 移除 1 张表：
  - `diff` 包含被移除表。
  - `diff` 不包含 `driver`、`host`、`schemas` 等无关 removed / added 行。
- dry-run 与 write 使用同一 patch 结果。
- 原有非法表名、重复表、未扫描表校验继续通过。

### 3.3 运行命令

```bash
cd webui
npx vitest run src/__tests__/table-whitelist.test.tsx
npx vitest run server/__tests__/api.save.test.ts
npm run lint:terminology
npm run lint:ia-boundary
npm run build
```

如时间允许，跑：

```bash
cd webui
npm test
```

## 4. 浏览器复核

Docker 重建后打开 `http://localhost:5174/connections/whitelist`。

### 4.1 桌面视口

使用约 `1280 x 720` 视口复核：

- PageHeader 无 `/data/lucy`。
- PageHeader 右侧只有 `刷新本地目录`。
- toolbar 左侧搜索框明显加宽。
- toolbar 右侧显示 `已选 x/y 张表` 与 `批量操作`。
- `批量操作` menu 可打开，含 `全选` / `反选`。
- 状态列无 `已纳入` / `待同步`。

### 4.2 草稿状态

不要点击保存。仅做 dry-run：

1. 勾选一张未启用表。
2. 验证状态列为 `待启用`，动作列为 `待保存`。
3. 打开 `YAML 预览`。
4. 验证摘要仅列出本次新增表，完整 diff 无无关大块红绿重排。
5. 关闭预览并点击 `放弃`。
6. 取消勾选一张已启用表。
7. 验证状态列为 `待禁用`，动作列为 `待保存`。
8. 打开 `YAML 预览`。
9. 验证摘要仅列出本次移除表，完整 diff 无无关大块红绿重排。
10. 关闭预览并点击 `放弃`。

### 4.3 窄屏

使用约 `390px` 宽度复核：

- 搜索框不造成横向滚动。
- toolbar 可自然换行。
- 批量操作菜单不溢出视口。

## 5. 交付说明

收尾时说明：

- 修改文件清单。
- 状态文案替换结果。
- enabled_tables diff 修复方式。
- 保存后刷新策略采用自动刷新还是 Banner CTA。
- 已运行测试命令。
- 浏览器复核结果。
- 是否存在遗留问题。

---
_Plan by Codex · 2026-08-01_

