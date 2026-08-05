# Admin Config Audit Table & Filter Polish Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Config Audit Table & Filter Polish Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/96-admin-config-audit-table-filter-polish-spec.md` |
| 适用范围 | `/admin/config-audit` Wave A/B/C |
| 输出位置 | `webui/docs/plans/wo-202608-29-admin-config-audit-table-filter-polish.md` |

**Goal:** 配置审计页固定 20 行/页、接入 `pl-data-grid`、中文业务字段、删冗余 notice，并补齐时间筛选与快捷窗口。

**约束：** 结束后只做 code review，不做浏览器验证。

## Phase 1 — Wave A（前端）

- `PAGE_SIZE = 20`
- 表格 `pl-data-grid pl-data-table pl-config-audit-table`
- CSS：`.pl-config-audit-table tbody td { text-xs … }`
- 列头中文化 + `assetKind` / `changeType` / `source` / `actor` label 映射
- 删除 `actorNotice` 渲染；精简 description
- 筛选 placeholder 对齐表头

## Phase 2 — Wave B（API + 前端）

- `audit.ts`：`config-audit` 与 `export.csv` 增加 `since`/`until`
- 前端 `datetime-local` 起止时间；导出 URL 携带相同参数
- 后端测试覆盖时间过滤

## Phase 3 — Wave C

- 快捷窗口：全部 / 近 7 天 / 近 30 天
- `changeType` 下拉按 `assetKind` 动态过滤
- 术语标准补登记；台账 `UX-ADMIN-CONFIG-AUDIT-002`～`006` → `Fixed`

## Phase 4 — Gate

```bash
cd webui
npm test -- --run src/__tests__/admin-config-audit.test.tsx server/__tests__/admin-audit.test.ts
npm run lint:terminology
npm run build
```
