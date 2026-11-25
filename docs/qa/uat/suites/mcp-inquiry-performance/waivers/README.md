# MCP 问询端到端性能门禁豁免记录（D22）

| 元数据 | 内容 |
|---|---|
| 归属 | [P1-78 Spec](../../../../../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md) D22／§6.3 ／ [Plan](../../../../../plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md) Task 2 |
| 合同 | 结构判定＝判定器 `validateWaiver()`；复核＝`verifyWaiverFile()`／`verifyWaivers()`（`scripts/e2e/lib/mcp-inquiry-performance-evidence.mjs`） |
| 当前状态 | **空目录**。当前无任何豁免记录；没有豁免记录时 D15 失败关闭不变（BLOCKED／SEED_ONLY 仍拦截）。 |

## 1. 豁免是什么、不是什么

这是**事故修复放行**（门禁逃生），不是性能通过：

- 豁免只能产生 `releaseReady="waived"`，**永远不是 PASS**，在跑次报告与出包清单中置顶标注，不显示为 PASS。
- 豁免**不写入** [`baselines/`](../baselines/README.md)，**不晋级** `LATEST.json`，**不污染**基线统计与 PASS 计数。
- 豁免只对**它绑定的候选 digest** 成立；候选变化或到期即失效，未补跑正式门禁前下一候选不得沿用。
- 豁免必须写明补跑计划；豁免后须对同候选或其后继补跑正式门禁并 PASS 才算关闭（D22④）。

## 2. 文件命名与结构

```text
waivers/<yyyymmdd>-<id>.md
```

正文包含一个 ```json 结构化豁免块（verifier 只解析该块；没有该块即 `WAIVER_INVALID`）：

````markdown
# 豁免记录 20261126-001

- 候选：`sha256:<candidate digest>`
- 到期：2026-11-30（≤7 日）
- 委托人：<具名>

```json
{
  "id": "20261126-001",
  "candidateDigest": "sha256:<candidate digest>",
  "reason": "<放行原因：客户事故修复必须出包等>",
  "issuedAt": "2026-11-26T00:00:00.000Z",
  "expiresAt": "2026-11-30T00:00:00.000Z",
  "makeupPlan": "<补跑计划：后继候选补跑正式门禁并 PASS>",
  "approvedBy": "<委托人具名>",
  "evidenceBodyDigest": "<被豁免跑次的 attempts.ndjson SHA-256>",
  "scenarios": [
    { "scenarioId": "SOAK", "verdict": "BLOCKED" }
  ],
  "waiverDigest": "<内容摘要，由 computeWaiverDigest() 计算>"
}
```
````

## 3. 必填项（缺一即无效）

| 字段 | 规则 |
|---|---|
| `id` | 与文件名一致，`<yyyymmdd>-<id>` |
| `candidateDigest` | 必须等于被豁免跑次的候选 digest；不符即 `WAIVER_CANDIDATE_MISMATCH` |
| `reason` | 放行原因，必填 |
| `issuedAt` / `expiresAt` | 有效期 ≤7 日且未过期；过期即 `WAIVER_EXPIRED` |
| `makeupPlan` | 补跑计划，必填 |
| `approvedBy` | 委托人具名，必填 |
| `scenarios[]` | 被豁免场景与该场景在本跑次的 verdict，必填且不得为空 |
| `evidenceBodyDigest` | 绑定被豁免跑次的证据正文 digest；与本跑次不符即 `WAIVER_DIGEST_MISMATCH` |
| `waiverDigest` | 记录内容摘要；与重算值不符即 `WAIVER_DIGEST_MISMATCH`（防伪造） |

## 4. 豁免范围（Spec D22②）

- 默认只可豁免 `BLOCKED`、`SEED_ONLY`、`NOT RUN`。
- **`FAIL` 不默认可豁免**：确需豁免真实退化时，记录中必须**逐场景写出实测数值与预算／基线差**（`scenarios[].measured`），并且由委托人对该清单**单独具名**（`failListApprovedBy`）。缺任一项即无效。
- 场景必须落在本跑次的非 PASS 范围内；越界即 `WAIVER_SCOPE_EXCEEDED`。
- 场景 verdict 必须与本跑次该场景的实际 verdict 一致，不一致即无效。

## 5. verifier 复核

`verifyEvidenceBundle({ evidenceDir, waivers })` 会重读豁免文件并复核：**内容 digest**、**到期**、**候选绑定**、**范围**、**与证据正文的绑定**。伪造、过期或超范围的豁免一律判 **FAIL**（D22⑤），聚合器据此不放行；有效豁免只产出 `waived`，且必须覆盖全部非 PASS 场景，否则该跑次仍然不放行。

## 6. 公开文件与私有凭据的边界（强制）

- **豁免记录是公开文件**：不得包含 Token、Cookie、Session、密码、原始业务行、私有提示词或客户对象名；只写合成题 ID、数值、digest 与具名。
- 私有凭据与客户材料保存在**仓库外**私密目录：目录 **0700**、文件 **0600**；不得复制进本目录。
