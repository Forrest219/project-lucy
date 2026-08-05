# Admin Config Audit Header & Export Parity Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Config Audit Header & Export Parity Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/97-admin-config-audit-header-export-parity-spec.md` |
| 适用范围 | `/admin/config-audit` Header；`export.csv` 列与文件名 |
| 输出位置 | `webui/docs/plans/wo-202608-30-admin-config-audit-header-export-parity.md` |

**Goal:** 去掉配置审计页头冗余「访问日志」；CSV 与主表 7 列中文对齐；导出文件名精确到秒。

**约束：** 结束后只做 code review，不做浏览器验证。

## Phase 1 — 共享 label 模块

- 新建 `webui/src/lib/configAuditLabels.ts`：迁入 `ASSET_KIND_LABELS` / `SOURCE_LABELS` / `CHANGE_TYPE_OPTIONS` 与 `actorLabel` / `assetKindLabel` / `sourceLabel` / `changeTypeLabel` / `formatConfigAuditTs`。
- `ConfigAudit.tsx` 改为从该模块导入。
- `server/admin/audit.ts` 的 `export.csv` 复用同一模块生成中文列。

## Phase 2 — UI

- `ConfigAudit.tsx`：PageHeader `actions` 仅保留「导出 CSV」。

## Phase 3 — Export API

- `export.csv` 输出 7 列中文表头与 label 化单元格。
- `Content-Disposition` → `config-audit-YYYYMMDD-HHmmss.csv`（Asia/Shanghai）。
- 筛选参数与 committed 过滤不变。

## Phase 4 — 台账与索引

- `docs/ui-ux-feedback/pages/admin-config-audit.md`：追加 `UX-ADMIN-CONFIG-AUDIT-007`～`008` → `Fixed`。
- `docs/ui-ux-feedback/README.md`：最近维护记录 + 跨页面主题（header sibling 冗余、export-table parity、filename 秒级）。
- `webui/docs/README.md`、`webui/docs/plans/README.md` 登记 Spec 97 / wo-202608-30。
- 术语标准必要时补「导出列与主表一致」一句。

## Phase 5 — Gate

```bash
cd webui
npm test -- --run src/__tests__/admin-config-audit.test.tsx server/__tests__/admin-audit.test.ts
npm run lint:terminology
npm run build
```

## 验证要点（非浏览器）

- 前端：无「访问日志」header link；「导出 CSV」仍在。
- 后端：CSV 首行中文 7 列；含「本机管理员」；filename 匹配 `\d{8}-\d{6}`。
