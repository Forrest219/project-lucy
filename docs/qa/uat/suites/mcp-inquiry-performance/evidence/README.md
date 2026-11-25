# MCP 问询端到端性能公开原始证据

| 元数据 | 内容 |
|---|---|
| 归属 | [P1-78 Spec](../../../../../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md) §4.2／§4.3／§6.1／D10／D12 ／ [Plan](../../../../../plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md) Task 2 |
| 合同 | 字段唯一真源＝Spec §4.3；实现＝`scripts/e2e/lib/mcp-inquiry-performance-evidence.mjs` |
| 当前状态 | **空目录**。尚无真实跑次证据（本轮只交付基建，未获真实跑次授权）。 |

## 1. 目录结构

```text
evidence/<runId>/
  attempts.ndjson        每行一次尝试（原始证据正文）
  summary.json           每场景样本量／分位／绝对与相对判定／总判定／releaseReady／证据正文 digest
  negative-controls.json D12 负控执行记录
```

`runId` 是跑次唯一标识；同一 `runId` 的三个文件必须成套出现。私有凭据和任何客户材料**不在本目录**。

## 2. `attempts.ndjson` 字段（Spec §4.3）

每行一个 JSON 对象，字段按 §4.3 三组：

**身份**：`runId`、`scenarioId`、`caseId`、`attemptId`、`planItemId`、`retryOf`、`traceId`、`rpcRequestId`。`retryOf`／`traceId`／`rpcRequestId` 可以缺失，但必须同时给出 `<字段名>MissingReason` 说明为什么没有；`attemptId` 在全跑次内唯一，重复即 FAIL。

**输入**：`lane`（`mcp`／`agent`）、`roleClass`、`cacheState`、`concurrencyGroup`、`clientModel`、`environment`、`budgetClass`（性能档 `simple`／`complex`／`denial`）、`questionSetDigest`、`configDigest`、`fixtureDigest`、`budgetDigest`、`clientFingerprint`、`modelFingerprint`、`environmentFingerprint`。

**结果**：`outcome`（`correct`／`wrong_answer`／`unexpected_deny`／`empty_envelope`／`timeout`／`crash`／`denied`／`allowed`／`error`／`missing_evidence`）、`correctness`（`correct`／`incorrect`／`unknown`）、`errorClass`、`timeoutMs`、`firstAttempt`、`finalAttempt`。真实 Agent lane 另需 `finalAnswerReceived`（缺失最终答复即 FAIL）。

**计时（§4.2）**：`questionStartedAt`、`firstObservableMs`、`firstTokenMs`（宿主不支持时填 `not_available`，不得用工具事件或 `initialize` 冒充）、`firstCorrectResultMs`、`finalCorrectAnswerMs`、`turnWallClockMs`、`unattributedMs`、`mcpCalls[]`、`stages[]`；MCP lane 另需 `journeyMs`（该 lane 的延迟口径）。可选：`initializeMs`、`mcpClientRttMs`、`serverDurationMs`、`windowIndex`／`windowSeconds`、`chainId`／`turnIndex`／`processId`／`hostSessionId`。

所有计划尝试都进分母：错误、意外拒绝、空信封、超时、崩溃、取消、重试、缺证一律保留，不删失败样本（D3）。

## 3. `summary.json` 字段

顶层：`contract`（`lucy-mcp-inquiry-performance-evidence-v1`）、`runId`、`trigger`、`tier`、`generatedAt`、`candidateFingerprint`、`environmentFingerprint`、`questionSetDigest`、`configDigest`、`fixtureDigest`、`budgetDigest`、`clientFingerprint`、`modelFingerprint`、`evidenceBodyDigest`、`questionSetVersion`、`environmentProfile`、`clientModelHash`、`gitSha`、`legalControls[]`、`scenarios[]`、`status`、`releaseReady`。

逐场景：`scenarioId`、`lane`、`cacheState`、`concurrencyGroup`、`clientModel`、`environment`、`budgetClass`、`plannedCount`、`sampleCount`、`correctCount`、`failedCount`、`timeoutCount`、`p50Ms`、`p95Ms`、`medianMs`、`maxMs`（另可记 `p99Ms`）、`absoluteVerdict`、`relativeVerdict`、`verdict`。

- `evidenceBodyDigest`＝`attempts.ndjson` 正文的 SHA-256，由写入端计算并写入；verifier 重算后必须一致。
- `status` 取 `PASS`／`SEED_ONLY`／`NOT RUN`／`BLOCKED`／`FAIL`；`releaseReady` 取 `true`／`false`／`"waived"`。
- **顶层 `status`／`verdicts`／`releaseReady` 只是展示值，不受信**：verifier 从 `attempts.ndjson` 重算分母、分位、预算、相对差与总判定，与摘要不一致即 `FAIL(EVIDENCE_MISMATCH)`。

## 4. `negative-controls.json` 字段

`contract`（`lucy-mcp-inquiry-performance-negative-controls-v1`）、`runId`、`controls[]`（每项含 `id`、`kind`、`scenarioId`、`expected`、`observed`、`detected`）、`allDetected`。

负控只在隔离环境执行，与真实用户样本分文件保存。`expected=FAIL` 的负控若 `detected≠true` 或 `observed≠FAIL`，verifier 判 `NEGATIVE_CONTROL_UNDETECTED` 并 FAIL（Spec D12／SC-09）。

## 5. 独立 verifier

入口：`verifyEvidenceBundle({ evidenceDir, baseline, waivers, now, secrets, customerObjectNames })`。

它做的事：

1. 重读 `attempts.ndjson`，逐条做 schema 校验，并检测重复 `attemptId`。
2. 按 D5 键分组，用判定器纯函数（`scripts/e2e/lib/mcp-inquiry-performance.mjs`）重算分母、分位、绝对预算、相对门禁与总判定——verifier 不重复实现任何判定逻辑。
3. 核对摘要正文 digest 与证据 digest；核对指纹（题库／客户端／模型／夹具／环境）在摘要、尝试与基线之间一致。
4. 复核 D22 豁免（内容 digest、到期、候选绑定、范围）。
5. 对公开证据做泄露扫描。

返回：`{ ok, verdict, releaseReady, status, problems[], recomputed, claimed, evidenceBodyDigest, attempts, baseline, waiver }`。`verdict` 为 `PASS` 时才 `ok=true`；`FAIL` 表示证据篡改、负控未检出或产品失败；`BLOCKED` 表示缺前置、样本、基线、可比指纹或必要观测。

## 6. 写入与脱敏

- 写入用临时文件＋`rename` 原子落盘（`writeFileAtomic()`），失败不留半截文件。
- 公开证据写入前必须脱敏：Token、Cookie、Session、密码、原始业务行、私有提示词、客户对象名**不得出现**。用 `redactEvidence()`（深拷贝，不改原对象）与 `scanEvidenceForLeaks()`（命中只回报 kind 与短摘要，不回显原文）处理；`writeEvidenceBundle()` 检测到泄露会拒绝落盘。
- 公开文件只保留合成题 ID、数值、脱敏关联键与摘要。
- 私有凭据（问数 Token、拒绝 Token、合法对照 Token、宿主凭据）与客户材料保存在**仓库外**私密目录：目录 **0700**、文件 **0600**（`ensurePrivateDir()`／`writePrivateFile()`／`assertPrivatePermissions()`）。
