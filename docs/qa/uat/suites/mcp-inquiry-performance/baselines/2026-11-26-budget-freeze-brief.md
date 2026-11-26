# P1-78 baseline-seed 预算具名冻结材料（委托人 2026-11-26 已裁定：选项 2）

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 预算冻结材料 / v1.1（委托人 2026-11-26 对话明示「2」＝选项 2） |
| 日期 | 2026-11-26 |
| 依据 | [Plan Task 5 步骤 5](../../../../../docs/plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md)（设计预算与实测分布提交委托人具名冻结；不得由 runner 自动抬线） |
| 证据 | runId `mip-mwwwsrq0-k8cgto`（[跑次记录](../runs/2026-11-26-claude-baseline-seed.md)；隔离栈 `lucy-mip-uat`，并发舱壁扩容（裁定 B）后重跑，2920 尝试，意外拒绝 0） |

## 1. 实测分布（全场景 journey P95 对照设计预算）

29 个判定组（25 场景＋6 合法对照扣除重复）**全部过线**：

| 组 | n | journey P50 | journey P95 | 设计预算 P95 |
|---|---:|---:|---:|---|
| SIMPLE／FILTER×3／FOLLOW×2（warm simple） | 各 100 | 459–667 | 654–1460 | ≤10,000 ms |
| JOIN／FOLLOW_JOIN／MULTI_DB／COLD_COMPLEX（complex） | 各 100 | 526–1264 | 953–2572 | ≤30,000 ms |
| COLD_SIMPLE | 100 | 459 | 654 | ≤15,000 ms |
| CONCURRENT_C20（SIMPLE/COMPLEX） | 各 60 | 1909–2208 | 2096–2812 | 同上 |
| CONCURRENT_C50（SIMPLE/COMPLEX） | 各 150 | 4415–6685 | 5853–8393 | 同上 |
| WIDE×2（规模档） | 各 100 | 496–549 | 953–1321 | 同上 |
| DENIAL×6（拒绝响应） | 各 100 | 21–57 | 34–219 | ≤500 ms |
| DENIAL 合法对照×6 | 各 100 | 491–2546 | 734–4707 | 同对应档 |

## 2. 唯一超线项：并发档 warm initialize P50

设计预算 `initializeWarm`＝**p50 ≤200 ms、p99 ≤2000 ms**（单值，不按并发档分列）。

| 组 | init n | P50 | P99 | 判定 |
|---|---:|---:|---:|---|
| 单会话／20 路档全部 27 组 | — | 19–194 | ≤1228 | ✓ 全过 |
| **CONCURRENT_C50_SIMPLE** | 150 | **316** | 1228 | ✗ p50 超线 |
| **CONCURRENT_C50_COMPLEX** | 150 | **234** | 849 | ✗ p50 超线 |

归因：50 路同发时 initialize 握手在 admission／审计写入路径排队，P50 被推到 234–316 ms（P99 仍在 2000 ms 预算内）；非并发场景实测 P50 19–88 ms，远低于 200。**握手本身没有退化信号，超线来自并发排队。**

## 3. 委托人裁定（2026-11-26 明示）：选项 2

**维持 `initializeWarm` p50 ≤200 ms 不变**；C50 档 initialize 判定保持 FAIL，作为后续产品优化目标（握手在并发下的排队成本）；baseline-seed 以「仅 initialize 项 FAIL」的 **SEED_ONLY** 收口。

落账动作：
- SEED_ONLY 候选基线已固化实测值：`baselines/1-lucy-mip-uat-capB-5593add992d7994a-b4bc7c6ef1c17c3b310a68da0fb89fcfef521e78.json`（29 场景，`status=SEED_ONLY`、`releaseReady=false`，证据正文 digest 锚定 runId `mip-mwwwsrq0-k8cgto`）；
- **`LATEST.json` 不写入**：`acceptBaseline` 会置 `releaseReady=true`，与「C50 initialize FAIL 待优化」冲突；待后续正式跑次全过线后由委托人具名接受进 LATEST；
- Spec §5 不修订（选项 2 维持设计值）；到达模型参数（scale-baseline §1.1）随本裁定一并冻结，SOAK 真实跑次按其执行。

## 4. 同批冻结项（实测全过线，无争议）

- `initializeWarm.p99Ms` 2000 ms（实测最大 1228 ms）
- 各场景 journey P95 预算（simple warm/cold 10k/15k、complex warm/cold 30k/45k、denial 500 ms）——实测最大 8393 ms（C50_SIMPLE）
- 到达模型参数（scale-baseline §1.1：截断正态 μ=60 s、σ=20 s、截断 [20,120] s、种子 20261124、simple 60%/complex 40%）——SOAK 真实跑次前随 Task 7 一并冻结
- 隔离栈环境档：并发舱壁扩容（token 50／agent 50／connection 50／global 64，裁定 B，`scripts/uat/lib/mcp-inquiry-performance-capacity-override.yml`）

**冻结后动作（选项 2 已执行）**：Spec §5 维持设计值不修订 → SEED_ONLY 候选基线已固化实测值（见 §3）→ `LATEST.json` 留待后续正式跑次全过线后具名接受 → 届时该基线成为相对回退门禁的对照真源。
