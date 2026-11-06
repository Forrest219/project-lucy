# 访问关系图小时明细表 — 实施笔记

- Spec／Plan：`lucy-20261104-access-map-hourly-detail` v0.3
- 日期：2026-11-04
- 授权：用户「按本 plan 开工」（P3）
- 本条收口不表示可上线

## 交付摘要

| 阶段 | 内容 | 证据 |
|---|---|---|
| S1 | `view=table` 返回小时 `detail`；一次 `buildBandED`（`tokenLabel=null`，先判 `ok`）；scope／focus／分页；测试缝逐桶 ID | `npx vitest run server/__tests__/p1-access-map*.test.ts --maxWorkers=1` → **72 passed** |
| S2 | 去凭证清单／Token UI／折叠口径；常驻行；小时明细表；§5.5 全分支 | `npx vitest run src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx --maxWorkers=1` → **94 passed** |
| S3 | Spec 187／chart-first／quiet-reading／audit-echo 指针；selector-contract；索引镜像；lint | 见下 |

## 主要代码落点

- `webui/server/admin/access-map-hourly-detail.ts`（新建）
- `webui/server/admin/access-map.ts`（挂 detail、token 忽略）
- `webui/server/__tests__/p1-access-map-hourly-detail.test.ts`（新建）
- `webui/src/components/admin/AccessMapTable.tsx`／`AccessMapTypes.tsx`
- `webui/src/pages/admin/AccessMap.tsx`
- `webui/src/__tests__/access-map.test.tsx`／`access-map-layout.test.tsx`

## SC 证据

SC-01–SC-18 由上述 S1／S2 自动化覆盖。工程门禁（指针／selector／lint）不计入功能出口，已在 S3 完成。

## 未做

- 浏览器／Playwright／窄屏走查
- `git commit`／`push`（未授权）
- 删除未挂载的 `AccessMapCredentialList.tsx`／`AccessMapSignalNotes.tsx` 源文件（仅停用挂载）
