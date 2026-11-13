# 访问关系图允许词表对齐 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 事故修复合同 / **v0.1** |
| 日期 / 目标版本 | 2026-11-13 / 不绑定产品版本号 |
| 功能编号 / 优先级 | **P1-19**／REQ-030-040／**P1** |
| 状态 | **v0.1；实现已落地（2026-11-13）**。vitest access-map 三文件 76/76。UAT 未复跑。**不表示可上线** |
| 决策来源 | UAT [`2026-11-13-claude-adversarial`](../qa/uat/suites/access-map-sankey-empty/runs/2026-11-13-claude-adversarial.md) 发现 F-1 |
| 授权 | 委托人同句「立项修一下」＝本条开发授权 |

## 闭口层级

- 层级：功能合同
- 本条承诺：SC-01–SC-03
- 不在本条出口：改写历史 audit 行、放开 `include_candidate`、重画空桑基几何
- 上线关系：本条收口不表示可上线

## Terminology Compliance

产品名仍为「访问关系图」。不新增用户可见术语。

## 1. 决策

| ID | 裁定 |
|---|---|
| D1 | 进入访问路径（band E）的 outcome 为现行 `ok`，并兼容历史合同词 `allow` |
| D2 | `denied`／`deny`／`error`／`budget_stop` 及其余值仍只进拒绝计数（band D），不进访问路径 |
| D3 | 不回填历史行；不改审计写入词表 |

## 2. 验收

| ID | 断言 |
|---|---|
| SC-01 | `buildAccessLayer`：`ok` 与 `allow` 进入 `rawCalls`；`denied`／`error`／`budget_stop` 只进 `deniedCalls` |
| SC-02 | `bandSetsFromAuditRows` 与 echo `buildBandED` 使用同一判定 |
| SC-03 | 既有 `allow`／`deny` 夹具测试仍通过 |
