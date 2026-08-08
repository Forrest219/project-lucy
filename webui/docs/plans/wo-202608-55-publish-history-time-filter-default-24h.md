# Publish History Time Filter Label & Default 24h

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish History Time Filter Label & Default 24h |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-07 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `UX-PUBLISH-HISTORY-011`；Spec 113 v1.1 |
| 适用范围 | `/publish/history` 时间筛选可见标签与默认近 24 小时（整点） |
| 输出位置 | `webui/docs/plans/wo-202608-55-publish-history-time-filter-default-24h.md` |

**Goal:** 发布记录时间筛选有可见名称，并默认「近 24 小时」（整点）。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

## Scope

1. 筛选栏时间组前增加可见标签「时间」。
2. 快捷窗口增加「近 24 小时」；首访无时间参数时默认 `window=24h`，`since` 取整点。
3. 更新 Spec 113、台账、Vitest。

## Non-Goals

- 不改配置审计时间筛选默认值。
- 不做浏览器验证。

## Acceptance

- 可见「时间」；默认近 24 小时且 since 整点；选「全部时间」可清空。
- `publish-history.test.tsx` + `lint:terminology` 通过。
