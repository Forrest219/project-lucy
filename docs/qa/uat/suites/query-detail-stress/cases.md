# Cases — UAT-SUITE-QUERY-DETAIL-STRESS

> 配额与场景 id 一律来自 [`baseline.json`](baseline.json)（当前 **QDE-STRESS-B**／`baselineRevision` 见该文件）。  
> 推荐顺序：R0 → 01 → 02 → 03 → 04 → 05 → 06（→ 07 可选）。

| ID | 标题 | 必做 | 期望摘要 |
|---|---|---|---|
| UAT-QDS-R0 | 环境／Hive／baseline 装载门禁 | 是 | scale＝0；Hive 未 SKIPPED；跑器载入 baselineRevision |
| UAT-QDS-01 | 多形态覆盖率 | 是 | 所有 `active` 场景达 minCalls／minShare；单一形态 &lt; maxShare |
| UAT-QDS-02 | 拉数逃生高压臂 | 是 | M1／M2／M3：`measures_required`＝0；detailMode 抽样；累计行达标 |
| UAT-QDS-03 | 分析与探索形态 | 是 | M5／M6／M8／M9 成功率护栏 |
| UAT-QDS-04 | 会话形态（短／长） | 是 | M10／M11 不拖死握手／不串会话 |
| UAT-QDS-05 | Hive 慢查询同窗 | 是 | H1／H2 真实慢在途；与快路径混压 |
| UAT-QDS-06 | interactive 探针护栏＋回落 | 是 | 稳态成功率／p95；停压后回落 |
| UAT-QDS-07 | 2C2Gi 资源锁 | 否 | 未限流 → SKIPPED＋声明 |

---

## UAT-QDS-R0 — 环境门禁

### 步骤

1. 读取并打印（无密钥）`baseline.json` 的 `baselineId`／`baselineRevision`／关键 volumes／concurrency。  
2. `uat:scale-baseline` 退出 0；确认 Hive 维度未 SKIPPED。  
3. health／`ktxRuntime=ready`；`LUCY_QUERY_REQUIRE_BUSINESS_MEASURES` 未开。  
4. 校验 Token 数 ≥ `targetInFlight`；抽查 MySQL 与 Hive 各至少一源可 `lucy_catalog` 看见。

### 期望

- 任一项失败 → 后续 **BLOCKED**。

---

## UAT-QDS-01 — 多形态覆盖率

### 步骤

1. 按 `slotPlan` 启动稳态 `steadySec`。  
2. 统计每个 `active` scenario 的调用占比与次数。

### 期望

- 满足 `minCallsPerActiveScenario`、`minSharePerActiveScenario`；最大单形态份额 &lt; `maxSingleMorphologyShare`。  
- M4 无 segment 时可 SKIPPED，但须提高 M3 份额补齐，并在跑次注明。

---

## UAT-QDS-02 — 拉数逃生高压臂

### 步骤

1. 驱动 M1／M2／M3／M7（及 M12 负例采样）。  
2. 累计成交行对照 `detailArmCumulativeRowsMin`。  
3. 抽样 `detailMode`。

### 期望

- ST-01／ST-02；M12 仍 `measures_required`。

---

## UAT-QDS-03 — 分析与探索

### 步骤

1. M5／M6 与 M1 同窗。  
2. M8 三步链、M9 读源突发。

### 期望

- ST-04；探索链不得大面积 5xx 假死。

---

## UAT-QDS-04 — 短会话／长会话

### 步骤

1. M10：每 call 新 session。  
2. M11：单 session ≥100 calls。

### 期望

- ST-07；错误分桶清晰。

---

## UAT-QDS-05 — Hive 慢查询

### 步骤

1. H1 持续慢拉数／聚合；H2 元数据探查。  
2. 取证首字节延迟或 PROCESSLIST／等价。

### 期望

- ST-05；Hive 缺失 → 整套 BLOCKED（无降级授权时）。

---

## UAT-QDS-06 — 探针与回落

### 步骤

1. 探针按 `probeIntervalSec` 贯穿 warmup／steady／cooldown。  
2. 停压后等待 hold＋`holdExtraSec`，查容量回落与小查询恢复。

### 期望

- ST-03／ST-08／ST-09。

---

## UAT-QDS-07 — 资源锁（可选）

### 步骤

1. 核对容器 NanoCpus／Memory 是否 ≤ baseline 建议帽。

### 期望

- 未限流 → SKIPPED＋跑次声明「非客户资源档」。
