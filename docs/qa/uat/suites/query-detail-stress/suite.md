# UAT-SUITE-QUERY-DETAIL-STRESS — 拉数／多形态 MCP 压力基准线

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-QUERY-DETAIL-STRESS` |
| 总账 ID | **P1-89**／REQ-030-110（增量压力基准；与形状套件分家） |
| 基准线 ID | **QDE-STRESS-B**（机读 SOT：[`baseline.json`](baseline.json)） |
| 目标 | 在 **scale＋Hive** 下，用**可版本演进**的数据量与**多形态 API 调用矩阵**，持续验证：P1-89 拉数逃生在并行／慢查询混压下仍可用；interactive 探针不被饿死；形态不会退化成单一调法 |
| 合同回链 | Spec [`lucy-20261125-source-write-api-honesty-spec.md`](../../../../specs/lucy-20261125-source-write-api-honesty-spec.md) §2.4 · 形状姊妹套件 [`query-detail-escape`](../query-detail-escape/suite.md) · 容量全套（不替代）[`integration-mcp-capacity`](../integration-mcp-capacity/suite.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| baseline | [baseline.json](baseline.json) |
| runs | [runs/](runs/) |
| mip | **exempt**（压力语义基准；问询热路径时延主档仍归 `UAT-MIP-*`；大明细流式背压归 IMC／REQ-0119） |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-QDS-R0、UAT-QDS-01～06 | UAT-QDS-07（2C2Gi 强制臂，若本机未限资源则 SKIPPED 并声明） |

## 可复用演进规则（强制）

1. **量与场景只改 [`baseline.json`](baseline.json)**：升 `baselineRevision`，在 [fixtures.md](fixtures.md) Changelog 留一行；历史 `runs/` **不得改写**。
2. **新增查询形态**：向 `scenarios[]` 追加新 `id`；退役进 `retiredScenarios[]`，勿删 id（跑次对照要稳）。
3. **跑器必须读 baseline**：脚本内写死并发／行数／时长 → 该跑次 **FAIL**（防第二套口径）。
4. **本套件 PASS ≠** lean `UAT-QDE` 形状 PASS 的替代；也 **≠** IMC／0119 背压 PASS。
5. 调高 `volumes.*` 或加 Hive／宽表场景后，须重新全真跑次才能主张新基准通过。

## 边界

- **环境**：scale 档＋`UAT_SCALE_INCLUDE_HIVE=1`；Hive SKIPPED → 整套 **BLOCKED**（除非跑次获委托人明示降级授权）。
- **验收面**：mcp（多 Token／多 session 纯 MCP）；无 WebUI 浏览器臂。
- **禁止**：用 vitest／CR／单一 dims-only 烟测冒充本套件 PASS；跑次不落 Token 明文。
- **≠** 可上线；**≠** 功能合同收口；登记本套件 ≠ 已跑通压力。
