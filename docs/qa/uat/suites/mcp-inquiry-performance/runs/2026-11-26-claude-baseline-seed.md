# 2026-11-26 baseline-seed 跑次（MCP lane，隔离栈 nightly 档）

| 元数据 | 内容 |
|---|---|
| 跑次 / runId | **baseline-seed** / `mip-mwwk1gao-ep7j8t`（终轮；试跑链 `mip-mwwftcmi-2bkxol`／`mip-mwwfxh6q-phuim1`／`mip-mwwgq2ob-k5ze0m`／`mip-mwwhhaii-ji2141`／`mip-mwwif22u-ssldzf` 为夹具收敛过程，全部原始尝试保留于各自 evidence 目录） |
| 日期 / 触发档 | 2026-11-26 / `nightly`（MCP lane 全家族；`SOAK`／`LONG_FOLLOW` 未执行，归 Task 7） |
| 判定 | **SEED_ONLY → FAIL（并发舱壁口径待裁定）**。非 PASS、非发布证据；无已接受基线（Spec §6.3／D8）。 |
| 环境 | 隔离栈 `lucy-mip-uat`（[fixtures §12 实测登记](../fixtures.md#12-隔离栈实测登记2026-11-26task-5-baseline-seed)）；候选 `git:b4bc7c6ef1c17c3b310a68da0fb89fcfef521e78+dirty`；规模断言默认档＋MCP-PERF profile 全 PASS |
| 证据 | `evidence/mip-mwwk1gao-ep7j8t/attempts.ndjson`（2920 条，全部计划尝试保留）。**入库形态**：单文件 110MB 超常规文本证据体量，按 [`core-availability` 先例](../../core-availability/runs/)以 gzip 副本（`attempts.ndjson.gz`，15.9MB）入库，`EVIDENCE_SHA256.txt` 记录压缩体 SHA-256；未压缩正文（含全部 6 轮试跑链）保留于本机工作树 evidence 目录，verifier 复算与预算冻结材料从本地正文产出 |

## 结果

- 尝试 2920：correct 2183／denied 737；无 `wrong_answer`、无 `timeout`、无 `crash`、无 `empty_envelope`。
- 预期拒绝（DENIAL 家族）600 次全部按预期拒绝（含 P1-75 `source_ambiguity_gate` 跨连接拆分拒绝族，已接入判定器 DENIAL_CODES）。
- **意外拒绝 137 次全部集中在并发档**（`CONCURRENT_C50_*` 113、`CONCURRENT_C20_*` 24），拒绝码 `query_concurrency_exceeded`：产品多层并发舱壁（per-token 上限 4、per-connection 上限 16）对超发部分的**按设计拒绝**。50 路并发时最多 16 个在途，其余被舱壁以 `retry_after_ms` 拒绝。
- 试跑链修复记录：① `DENIAL_CROSS_CONN_WARM` 缺 `COMPAT_TOKEN_DUAL_CONN`（补 P1-54 compat 专用身份 seed）；② QB-DB-02 的 `source_ambiguity_gate` 不在判定器 DENIAL_CODES（已补）；③ 并发档单 token 超过 per-token 上限（已改为按 lane 轮换独立身份池 `MIP_CONCURRENCY_TOKEN_FILE`）；④ 身份池中 `uat_perf_role_b`／`lucy_ops_reader` 无 demo-mysql 表权限（受限组已补 demo-mysql 三表 selectors）。

## 待委托人裁定（阻断 SEED 收口）

1. **并发舱壁口径**：连接级上限 16 ＜ 并发档 50 路时，超发请求被产品按设计拒绝。裁定方向二选一：
   - **A（判定豁免）**：`query_concurrency_exceeded` 在并发档计为 admission-gated（单独记账、不进意外拒绝 FAIL），并发分位只基于舱壁放行的在途样本；
   - **B（环境扩容）**：隔离栈以部署配置把连接级上限提升 ≥50（改 compose env，不改产品代码），50 路真实在途成立。
   两者都涉及 Spec §5.3／D8 口径或环境档位变更，须独立评审；未裁定前并发档样本记 FAIL（现值），seed 不收口。
2. **预算冻结**：非并发档场景的实测分布已可从 `attempts.ndjson` 复算（`firstCorrectResultMs`／`mcpJourneyMs` 字段），具名冻结材料见总账 v2.94；冻结后写 `baselines/LATEST.json`（Task 5 步骤 6）。

## 清理与恢复

- 隔离栈保留（`lucy-mip-uat`，--down 可清理）；负控（延迟注入／2× 检出）归完整 R0 跑次执行；本跑次无延迟注入，无恢复项。
