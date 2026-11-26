# Fixtures — UAT-SUITE-INTEGRATION-MCP-CAP

## 身份

| 代号 | workloadClass | 用途 |
|---|---|---|
| Agent-E | `interactive` | 员工／对话式小查询探针 |
| Agent-I1／I2 | `integration` | 系统间并发与大明细臂（≥2 以测多 Agent 绕过） |
| Agent-D | 任意无目标权限 | 负控（可选） |

Token 与 Agent 一对多时，integration 合计仍受 borrowMax 约束。

## 预注册通过线（Task 0 冻结后填写）

| 项 | 值 | 冻结人／日期 |
|---|---|---|
| 硬件档 | （例：2C2Gi） | |
| T2 主并发 | （10／20／40） | |
| T1 success／p95 | | |
| OQ-A3 成功率下限 | | |
| OQ-A3 p95 上限 | | |
| global／R／borrowMax | | |
| CANCEL_HOLD_MS | | |
| per-response／globalBudget 字节顶 | | |
| sentinel p99ThresholdMs | 250（默认可改，须冻结） | |
| sentinel p99Consecutive | 3 | |
| sentinel maxEventLoopMs | 1000 | |
| T2 采样窗／时长 | | |
| Task 0 上游出口 grep 模式集 | 含 `readUpstreamBody`＋`pipeResponse` 等 | |
| 最坏名额回收时延（含 hold） | | |

## 数据与构造

- 只读 demo／scale 源；独立 SQL 核对聚合或行数。
- 大响应：优先语义层可返回宽行结果的 source；或受控超限夹具；**必须**服务端触顶。
- 慢查询：真实 DB `SLEEP`／等价，PROCESSLIST 取证。

## 负控

- 用 interactive Agent 冒充 IMC-03 integration 臂 → 测程失败。
- 客户端截断大包冒充 SC-06 → FAIL。
- hold 窗内「立刻恢复」成功不作为 T4 通过证据。
