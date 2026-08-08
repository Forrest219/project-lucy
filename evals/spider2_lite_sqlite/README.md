# Spider2-lite Pilot @ StarRocks sandbox

| 元数据 | 内容 |
|---|---|
| 文档名称 | Spider2-lite Pilot Eval Suite README |
| 文档类型 | Checklist |
| 版本 | v0.2 |
| 撰写日期 | 2026-08-08 |

Long-running **optional gated** suite (WO-202608-58). Not part of customer headless required gates.

## 怎么跑 E2E（规范入口）

先读 [`docs/qa/e2e-sop.md`](../../docs/qa/e2e-sop.md) 选测试集，再按分表执行：

| 要证明什么 | 测试集 | 分表 |
|---|---|---|
| 装载 / ACL / MCP catalog + datapath / vs gold | `E2E-ONBOARD-EVAL` | [`suite-semantic-onboard-mcp-eval.md`](../../docs/qa/suite-semantic-onboard-mcp-eval.md) **§14** |
| Cursor Lucy MCP 门禁 + NL 抽样 | `E2E-AGENT` | [`suite-agent-mcp.md`](../../docs/qa/suite-agent-mcp.md) **§5**（mcp-direct，无 Claude CLI） |

npm 命令登记：[`docs/test-layers-and-release-gates.md`](../../docs/test-layers-and-release-gates.md)。工单背景：[`docs/plans/wo-202608-58-spider2-lite-sqlite-stress-harness.md`](../../docs/plans/wo-202608-58-spider2-lite-sqlite-stress-harness.md)（**不替代** QA 分表）。

## Assets

- Cases: `eval/spider2_lite_sqlite-eval-cases.yaml` (17 seed cases)
- Sample ids: `sample-ids.txt` (weekly G-sample)
- Gold: `gold/starrocks_pilot/*.csv` (provisional from Spider exec_result `_a`; see `gold/CALIBRATION.md`)
- Runtime data: StarRocks `sandbox.s2_*` via `starrocks-r1`
- Reseed: `npm run spider2-lite:reseed-sandbox`

## Gates（摘要；细节以分表为准）

```bash
# G-cat (no DB) — ONBOARD §14
npm run smoke:p0:spider2-lite-eval

# G-rt (needs StarRocks secret + ktx) — ONBOARD §14
npm run smoke:p1:spider2-lite-runtime

# G-sample MCP-direct (default: lucy-demo-agent-token) — AGENT §5
npm run e2e:spider2-lite:sample
```

缺 SR / MCP / Scope 无 `sandbox.s2_*` 时写 `blocked`（`inbox/spider2-lite-sqlite/results/`）。不要求 Claude CLI。

## ACL note

Recommend role `spider2_sandbox_readonly` with:

```yaml
connections: [starrocks-r1]
tableSelectors:
  - connection: starrocks-r1
    schema: sandbox
    prefix: s2_
```

Agent YAML 使用 `role:`（单数），勿写 `roles:`。

## Policy

- Not in `smoke:p1:release-readiness` hard deps
- Not SOW Trust standard
- Gold drift follows `docs/eval-quiz-conventions.md`
