# Connections Terminology and Upload Drawer Consistency Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connections Terminology and Upload Drawer Consistency Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/73-connections-terminology-and-upload-drawer-consistency-spec.md`；浏览器核查结果；当前 `webui` 实现与测试 |
| 适用范围 | 指导 `/connections` 术语统一、Host/Database 排版、上传抽屉文案冗余收敛的实施与验收 |
| 输出位置 | `webui/docs/plans/wo-202608-04-connections-terminology-and-upload-drawer.md` |

**Goal:** 消除 `/connections` 页面表格列名与 KPI 的术语漂移、修正 Host/Database 排版顺序、收敛重新上传抽屉的文案冗余、统一上传按钮术语为"同步配置变更"。

**Architecture:** 仅做 WebUI 前端展示层文案与 CSS 排版调整，不改后端接口和业务流程。

**Tech Stack:** React、TypeScript、CSS (`src/app/app.css`)、Vitest/Testing Library。

---

## Non-Negotiable Boundaries

- 不新增后端 API，不修改响应结构。
- 不改变上传校验、覆盖、reload 的业务行为。
- 术语、路径、表名、Schema 名保留 `notranslate` / `translate="no"` 防御。
- 不做移动窄屏专项适配或验证。

## Scope

### Phase 1: Baseline Audit

执行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
rg -n "本地表数|启用表数|上传并刷新本地目录|刷新本地目录|pl-connection-kv" src/
rg -n "catalog-asset-target-path|TARGET_EXISTS|目标路径" src/
```

预期：定位所有待改文案与排版位置。

### Phase 2: Update Test Contracts First

优先更新测试，覆盖：

- `connection-overview`：列头断言"已发现表数""已启用表数"；Host/Database 区域断言 icon 在名称前（DOM 顺序）。
- `catalog-asset-upload`：按钮文案"上传并同步配置变更"、toast 文案、路径只在警告中出现一次。
- `add-schema-drawer`：reload 按钮 label "同步配置变更"。

执行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run test -- src/__tests__/connection-overview.test.tsx src/__tests__/catalog-asset-upload.test.tsx src/__tests__/add-schema-drawer.test.tsx
```

Expected before implementation: 至少一项失败。

### Phase 3: Terminology Unification

1. `ConnectionOverview.tsx`：列头 `本地表数`→`已发现表数`，`启用表数`→`已启用表数`。
2. `constants.ts`：`localCatalogTables.hint` 中"本地表数"→"已发现表数"。
3. `CatalogAssetUploadDrawer.tsx`：
   - 头部说明精简。
   - 提交按钮 → `上传并同步配置变更`。
   - 成功 toast → `YAML 已上传并同步配置变更`。
4. `AddSchemaDrawer.tsx`：`CatalogReloadButton` label → `同步配置变更`。

### Phase 4: Host/Database Layout

修改 `app.css` 中 `.pl-connection-kv`：

- `dd` 内部顺序调整为 icon → 名称 → 值，或 `dt`/`dd` 结构调整为 `[icon] [名称]：[值]`。
- 视觉目标：`[Server icon] Host：demo-db:3306`。

实施方式：将 icon 移入 `dt` 前或调整 `dd` 内部 flex 顺序，确保 icon 在最左。

### Phase 5: Upload Drawer Redundancy Reduction

1. `CatalogAssetUploadDrawer.tsx`：精简头部说明为单句（不含"目标路径""刷新本地目录"字样）。
2. `CatalogAssetValidationPanel.tsx`：移除独立"目标路径"行；`TARGET_EXISTS` 警告 message 已携带路径，作为唯一展示。

### Phase 6: Regression Tests

执行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run test -- src/__tests__/connection-overview.test.tsx src/__tests__/catalog-asset-upload.test.tsx src/__tests__/add-schema-drawer.test.tsx src/__tests__/catalog-reload-components.test.tsx src/__tests__/table-whitelist.test.tsx src/__tests__/help-center.test.tsx
npm run lint:terminology
npm run build
git diff --check
```

Expected: 全部通过。

### Phase 7: Code Review

完成后启动 reviewer subagent 做 code review（不做浏览器验证）。

## Acceptance Criteria

- 表格列头为"已发现表数 / 已启用表数"，与 KPI 语义一致。
- Host/Database 视觉顺序为 icon → 名称 → 值。
- 重新上传抽屉中同一路径只出现一次（在 TARGET_EXISTS 警告中）。
- 上传链路（上传抽屉按钮/toast、AddSchemaDrawer reload 按钮）中"刷新本地目录"全部替换为"同步配置变更"。
- 相关单测、术语 lint、build、`git diff --check` 均通过。

## Risk Notes

- 列名变更后，若其他测试快照引用旧列名需同步更新。
- `TableWhitelist.tsx`、`help-center` 中"刷新本地目录"属另一链路（启用表保存后的 catalog reload），本工单不改；若后续需全局统一，另起工单。
