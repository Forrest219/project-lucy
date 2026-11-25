# MCP 问询端到端性能基线

| 元数据 | 内容 |
|---|---|
| 归属 | [P1-78 Spec](../../../../../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md) §6.1–§6.3 ／ [Plan](../../../../../plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md) Task 2 |
| 合同 | 字段唯一真源＝Spec §6.2；实现＝`scripts/e2e/lib/mcp-inquiry-performance-evidence.mjs` |
| 当前状态 | **空目录**。尚无正式基线，也无 `LATEST.json`。首个正式基线须经委托人具名接受后才写入。 |

## 1. 这里放什么

正式性能基线文件，命名固定为：

```text
<questionSetVersion>-<environmentProfile>-<clientModelHash>-<gitSha>.json
```

外加一个指针文件 `LATEST.json`。跑次叙事不在这里（在 [`runs/`](../runs/README.md)），公开原始证据在 [`evidence/`](../evidence/README.md)。

`LATEST.json` **只指向已经具名接受的基线**。普通跑次产生的候选基线不得自动晋级、不得改写 `LATEST.json`；晋级只能通过显式入口 `acceptBaseline({ baselinesDir, baseline, acceptedBy, acceptedAt })` 完成。

## 2. 基线记录字段（Spec §6.2 全集）

文件顶层：

| 字段 | 说明 |
|---|---|
| `contract` | `lucy-mcp-inquiry-performance-baseline-v1` |
| `questionSetVersion` / `environmentProfile` / `clientModelHash` / `gitSha` | 决定文件名与可比性 |
| `status` | `SEED_ONLY`（已产出、尚未具名接受）或 `PASS`（已具名接受） |
| `releaseReady` | 与 `status` 一致；候选为 `false` |
| `acceptedBy` / `acceptedAt` | 具名接受记录；`SEED_ONLY` 时为 `null` |
| `evidenceBodyDigest` | 该基线所依据的原始证据正文 SHA-256（见 [`evidence/`](../evidence/README.md)） |
| `scenarios[]` | 逐场景基线记录 |

逐场景记录（缺任一必需字段即该场景基线不可用，相对比较记 BLOCKED）：

```text
scenarioId, cacheState, concurrencyGroup, budgetClass,
sampleCount, correctCount, failedCount, timeoutCount,
p50Ms, p95Ms, p99Ms | not_estimable, medianMs, maxMs,
questionSetDigest, configDigest, fixtureDigest, budgetDigest,
candidateFingerprint, environmentFingerprint, clientFingerprint,
modelFingerprint, evidenceBodyDigest, acceptedBy, acceptedAt
```

附加（实现层补充，不替代上面任何字段）：`lane`、`clientModel`、`environment`（D5 分组维度与 D9 可比性判定所需）、`runId`、`providerErrorCount／retryCount／rerunCount`（真实 Agent 场景，D21）。持续压力与长追问场景另记 `windowIndex／windowSeconds／offeredCount／dispatchedCount／arrivalModel{seed,mu,sigma,clipMin,clipMax,classShare}／perClassWindowStats／firstSegmentStats／lastSegmentStats` 与链级 `chainInstanceCount／minTurns／medianTurns／firstFiveMedianMs／lastFiveMedianMs／chainVerdict`（D20／D23）。

## 3. 数值规则（不可协商）

- `sampleCount／p50Ms／p95Ms／medianMs` **必须是真实测量数值**。写成 `null`、缺字段或手填一个没有原始证据的数，一律 BLOCKED；**不得保存 `p95Ms:null` 后继续参与相对判定**。
- `p99Ms` 只在 `sampleCount ≥ 100` 时是数值；否则必须是字符串 `not_estimable`（D6）。
- 基线只能由原始尝试重算生成（`buildBaselineCandidate()`），不得手工编辑数字、不得随失败样本抬线（D7／D13）。
- 相对比较按同键进行：键＝`scenarioId × cacheState × clientModel × environment × concurrencyGroup`。**一个 `scenarioId` 只能对应一个独立分组**；冷／热、并发档、复杂度档变体必须用不同 `scenarioId`（例如 `COLD_SIMPLE`），否则 verifier 记 `SCENARIO_ID_REUSED` 并 BLOCKED。
- 指纹不可比（题库／配置／夹具／预算／客户端／模型／环境）时相对比较记 BLOCKED，不得换模型或提权凑绿（D9）。

## 4. 状态与晋级

| 动作 | 入口 | 结果 |
|---|---|---|
| 产出候选基线 | `buildBaselineCandidate()` → `writeBaselineCandidate()` | `status=SEED_ONLY`，**不写** `LATEST.json` |
| 具名接受 | `acceptBaseline({ baselinesDir, baseline, acceptedBy, acceptedAt })` | `status=PASS`，写入基线文件并原子更新 `LATEST.json` |
| 读取指针 | `readLatestPointer(baselinesDir)` | 只读解析；`baselineDigest` 与文件不一致即 FAIL |

- `SEED_ONLY` 不是 PASS，不得作为放行依据（Spec §6.3）。
- **`waived` 永远不得写入本目录**（D22③）：verifier 对 `status=waived` 的基线文件返回 `WAIVED_IN_BASELINE` 并判 FAIL；`acceptBaseline()` 也会拒绝 `waived` 输入。
- 验收基线必须先由 verifier 复算一致（相对判定真实执行、必填数值非空），才允许被 `acceptBaseline()` 接受。

## 5. 公开文件与私有凭据的边界（强制）

- **公开文件（`baselines/*.json`、`LATEST.json`）不得包含**：Token、Cookie、Session、密码、原始业务行、私有提示词、客户对象名。只允许合成题 ID、数值、脱敏关联键与摘要（Spec §4.3）。
- 私有凭据（问数 Token、拒绝 Token、合法对照 Token、宿主凭据）与任何客户材料**保存在仓库外**的私密目录；该目录权限 **0700**，文件权限 **0600**（`ensurePrivateDir()` / `writePrivateFile()` / `assertPrivatePermissions()`）。
- 不得把私有凭据目录、客户原始行或客户对象名复制进本目录、跑次叙事或公开证据。写入前用 `redactEvidence()` 与 `scanEvidenceForLeaks()` 处理；发现泄露即拒绝落盘。
