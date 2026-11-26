# 2026-11-26 baseline-seed 跑次（MCP lane，隔离栈 nightly 档）

| 元数据 | 内容 |
|---|---|
| 跑次 / runId | **baseline-seed 终轮** / `mip-mwwwsrq0-k8cgto`（2026-11-26 委托人裁定 B——隔离栈并发舱壁扩容后重跑；此前试跑链 `mip-mwwftcmi-2bkxol`…`mip-mwwk1gao-ep7j8t` 为夹具与口径收敛过程，全部原始尝试保留于各自 evidence 目录） |
| 日期 / 触发档 | 2026-11-26 / `nightly`（MCP lane 全家族；`SOAK`／`LONG_FOLLOW` 未执行，归 Task 7） |
| 判定 | **SEED_ONLY（具名冻结收口：委托人 2026-11-26 明示选项 2）**。意外拒绝 0；唯一 FAIL 项＝C50 档 warm initialize P50 超预算（316／234 ms vs 200 ms，并发排队归因），按选项 2 维持预算、作为优化目标；非 PASS、非发布证据；SEED_ONLY 候选基线已固化，`LATEST.json` 待全绿后具名接受（Spec §6.3／D8）。 |
| 环境 | 隔离栈 `lucy-mip-uat`（[fixtures §12 实测登记](../fixtures.md#12-隔离栈实测登记2026-11-26task-5-baseline-seed)）；候选 `git:b4bc7c6ef1c17c3b310a68da0fb89fcfef521e78+dirty`；规模断言默认档＋MCP-PERF profile 全 PASS |
| 证据 | 终轮 `evidence/mip-mwwwsrq0-k8cgto/attempts.ndjson`（2920 条，全部计划尝试保留）及试跑链 6 轮。**入库形态**：单文件 110MB 超常规文本证据体量，按 [`core-availability` 先例](../../core-availability/runs/)以 gzip 副本（`attempts.ndjson.gz`）＋`EVIDENCE_SHA256.txt` 入库；未压缩正文保留于本机工作树 evidence 目录，verifier 复算与基线候选从本地正文产出 |

## 结果（终轮 `mip-mwwwsrq0-k8cgto`，裁定 B 扩容后）

- 尝试 2920：correct 2320／denied 600；无 `wrong_answer`、无 `timeout`、无 `crash`、无 `empty_envelope`、**无意外拒绝**。
- 预期拒绝（DENIAL 家族）600 次全部按预期拒绝（含 P1-75 `source_ambiguity_gate` 跨连接拆分拒绝族，已接入判定器 DENIAL_CODES）。
- **唯一 FAIL 项**：`CONCURRENT_C50_SIMPLE／COMPLEX` 的 warm initialize P50＝316／234 ms，超设计预算 200 ms（并发排队归因；P99 1228／849 ms 在 2000 ms 预算内）。按委托人裁定选项 2 维持预算，作为优化目标。
- 试跑链修复记录：① `DENIAL_CROSS_CONN_WARM` 缺 `COMPAT_TOKEN_DUAL_CONN`（补 P1-54 compat 专用身份 seed）；② QB-DB-02 的 `source_ambiguity_gate` 不在判定器 DENIAL_CODES（已补）；③ 并发档单 token 超过 per-token 上限（已改为按 lane 轮换独立身份池 `MIP_CONCURRENCY_TOKEN_FILE`，排除 ops_reader 身份）；④ 身份池中 `uat_perf_role_b`／`lucy_ops_reader` 无 demo-mysql 表权限（受限组已补 demo-mysql 三表 selectors）；⑤ 舱壁扩容（裁定 B）后并发档残余拒绝清零。

## 待委托人裁定（2026-11-26 已全部裁定并落账）

1. **并发舱壁口径——已裁定 B**：隔离栈以部署配置扩容并发上限（token 50／agent 50／connection 50／global 64，`scripts/uat/lib/mcp-inquiry-performance-capacity-override.yml`，仅隔离栈生效；产品默认值与判定口径不变）。重跑后**意外拒绝 0**，并发档 50 路真实在途成立。
2. **预算具名冻结——已裁定选项 2**：`initializeWarm` p50 ≤200 ms 维持不放宽，C50 档 initialize FAIL 作为优化目标；其余全部预算项（journey P95 各档、denial 500 ms、initialize p99 2000 ms）与到达模型参数具名冻结。SEED_ONLY 候选基线已固化（`baselines/1-lucy-mip-uat-capB-…json`，29 场景实测值）；`LATEST.json` 待后续正式跑次全过线后具名接受。材料见 [`baselines/2026-11-26-budget-freeze-brief.md`](../baselines/2026-11-26-budget-freeze-brief.md)。

## 清理与恢复

- 隔离栈保留（`lucy-mip-uat`，--down 可清理）；负控（延迟注入／2× 检出）归完整 R0 跑次执行；本跑次无延迟注入，无恢复项。


## Task 7 试点增量（2026-11-26：LONG_FOLLOW 真实宿主执行引擎与首轮真实轨迹）

**新增**：`scripts/e2e/lib/mcp-inquiry-performance-chain-executor.mjs`——长链／持续压力的真实宿主会话执行引擎（每身份一个长驻 `claude -p --input-format stream-json` 进程，**单进程多轮**，实测同一 session_id 且语义承接成立；每身份独立 workDir＋独立 Token，不轮换冒充）。runner 经 `MIP_CHAIN_EXECUTOR=claude`＋`MIP_CHAIN_TOKEN_FILE`＋`MIP_CHAIN_IDENTITIES_FILE` 注入；链证据落盘 `evidence/longfollow-<runId>.json`。

**试点跑次**（3 链实例×21 轮，全部真实 LLM 调用；runId `mip-mwx5tlhf-ubh54j` 等 6 轮迭代）：
- 链级合同成立：`processId／hostSessionId` 全程不变（无 D19/D20 违例）、`turnIndex` 连续、题组 digest 校验通过、角色类覆盖（lucy_admin／restricted_A／restricted_B 各 1 链——编排 limit 已修为「比例下限＋出现过的每个角色类至少 1 个实例」）。
- **发现 1（oracle kind 值域）**：题组逐轮 oracle 有 5 种 kind（exact 37／independent-query 52／invariant 9／deny 5／privacy 2）。`independent-query`（占大头）的 expect 只有**查询描述**（connectionId/source/measure/filters/sql），无数值期望——正确校验须由执行器对每轮独立执行该 SQL 并核对，当前执行器只实现了 exact（含 roleClassScope 元数据键剔除的宽容数值匹配）。非 exact 轮如实记 `not machine-checkable`。
- **发现 2（宿主模型波动）**：MiniMax-M3 路由在复杂查询上出现空答复轮（result 事件 result 为空），如实记 wrong_answer；换宿主／模型指纹是运营侧决策。
- **发现 3（真实轮次墙钟）**：长链每轮（真实 LLM＋MCP 往返）wall p50 9–15 s、max 33–136 s，对照 agent simple 预算 30 s——部分轮次超线，为产品／模型性能的真实优化目标。

**UAT-MIP-14／15 现值**：`SOAK`＝BLOCKED（D21⑦：所选宿主并发额度未登记且不足 50 路，不得降身份数）；`LONG_FOLLOW`＝FAIL（oracle 非全覆盖＋wall 超线，真实轨迹已留证）。两态均为如实登记，不得作为出包／升级性能 PASS。

## Task 7 收口状态（2026-11-26）

- **宿主决策**：委托人明示「走 kscc cli 测试」——宿主＝kscc CLI（claude-code 1.3.8 后端）。
- **宿主额度实测登记**（fixtures §9.4，D21⑦ 前置满足）：50 路并发 7 轮实测成功率 94–100%、限流零触发；55–60 路超载。成本估算：SOAK ≈1500 轮／墙钟 30–45 分钟。
- **SOAK**：NOT RUN（前置已满足，委托人 2026-11-26 暂缓执行；隔离栈已 `down -v` 收拾，seed 幂等可重建）。
- **LONG_FOLLOW**：FAIL（试点轨迹留证）。**剩余工程**：oracle 非 exact kind 校验（independent-query 独立执行 SQL 核对／invariant／deny／privacy）、两次无人值守每日跑次、SC-01–SC-15 逐条挂证、实现 CR 与证据审计。
- **优化交接输入**（Spec §8）：①长链每轮真实墙钟 p50 9–15 s／max 33–136 s（预算 30 s，超线 1.1–4.5×）；②MiniMax-M3 路由复杂查询空答复波动（宿主模型候选优化）；③C50 档 initialize 排队（选项 2 既有优化目标）。
