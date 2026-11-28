# Fixtures — UAT-SUITE-QUERY-DETAIL-STRESS

> **量与场景的唯一数字 SOT**＝同目录 [`baseline.json`](baseline.json)。本文只解释如何构造环境与如何演进，不复制第二套配额。

## Changelog（基准演进）

| revision | 日期 | 变更 |
|---:|---|---|
| 1 | 2026-11-27 | 初版：案 B 升格为可复用基准线；含 Hive 慢臂＋形态 M1–M12／H1–H2 |
| 2 | 2026-11-28 | **降级授权（委托人 2026-11-28 明示）**：H1 真 Hive MCP 慢臂退役（Lucy 无真实 HS2 JDBC worker，`webui/server/hive/jdbc-worker.ts` 仅 synthetic／unconfigured，数据库支持状态 planned；scale Hive 夹具 metadata-only 无数据文件）；慢臂改 `coPressure.S1`＝MySQL `slow_gauge`（`v_sleep` 45s 首字节，复用 budget-analyst-ux 夹具与 `slow-mysql` 连接）经 `lucy_query` 真实占用 MCP 执行面；ST-05 改读慢臂在途样本；slotPlan `hiveSlow`→`slowCoPressure`。真 Hive 臂待 JDBC worker 立项后恢复 |

## 环境构造

| 项 | 做法 |
|---|---|
| scale 水位 | `npm run demo:upgrade:scale` 或已有卷 `uat:scale-baseline:ensure`；开跑前 `npm run uat:scale-baseline`＝0 |
| Hive | `UAT_SCALE_INCLUDE_HIVE=1` 灌数；对齐 `deploy/compose/docker-compose.uat-hive-local.yml`／`doris-hive-uat.yml` 与 large-schema 路径；Hive 项 SKIPPED → **BLOCKED** |
| 慢对照（可选辅助） | MySQL `slow_gauge`／`v_sleep`（见 budget-analyst-ux fixtures）可作标定，**不能替代** Hive 慢臂 |
| 身份 | ≥ `concurrency.targetInFlight` 个只读 Token；建议分「快路径／分析／探索／短会话／长会话／Hive／探针」标签；明文不入库 |
| 资源 | `baseline.environment.suggestedResourceCap`（默认 2C2Gi）；未限流须在跑次写明 |

## 如何升数据量

1. 改 `baseline.json` → `volumes`（如 `detailArmCumulativeRowsMin`、`minScaleTables`）。  
2. `baselineRevision += 1`；本文件 Changelog 加行。  
3. 重新全真跑；INDEX／跑次写明新 revision。  
4. **禁止**在旧 PASS 跑次上改口说「已覆盖新量」。

## 如何加／改查询场景

1. 在 `scenarios[]` 追加 `{ id, tool, shape, intent, active }`。  
2. 停用旧场景：`active:false` 并拷贝摘要到 `retiredScenarios`。  
3. cases 只引用 id；跑器按 `active` 过滤。  
4. 覆盖率门禁读 `maxSingleMorphologyShare`／`minCallsPerActiveScenario`／`minSharePerActiveScenario`。

## 负控

- 只用 M1 dims-only 打满 15 min → **FAIL**（违反形态份额）。  
- Hive 未起却主张 PASS → **FAIL**。  
- 跑器忽略 `baseline.json` 写死数字 → **FAIL**。  
- 把本套件 PASS 写成 IMC／SC-06 背压已验 → **FAIL**（叙事违规）。
