# Fixtures — UAT-SUITE-MCP-UPGRADE-COMPATIBILITY

## CompatConfigProfile（落地前置；P1-54 §0／P1-53 D27）

全真开跑**之前**必须具备与题库 digest 绑定的 Lucy 配置资产包：

| 组件 | 通用 demo 最低要求 |
|---|---|
| 连接 | `demo-mysql`、`lucy-ops` |
| 语义 | superstore 三表＋已声明 join；ops W0∪W1∪W2 覆盖题目引用 |
| 当前 Role | `demo_readonly`、`lucy_ops_reader`（W0 仅两表）指纹可核 |
| 受控夹具 | 无 `lucy_query`；表 A／B；字段差分；**frozen W0-only**（永久负例）；**双连接只读编排**（禁 `lucy_admin`）；W1／W2 放行；通用车道**不做**行隔离成交（另：03b-gate 测 proven 门） |
| Ops | 扩展题 snapshot／投影就绪；W0 禁 `gov.*`；W1／W2 MCP 对照含约定 `gov.*` |
| 生命周期 | 应用前备份指纹；用后还原；失败即停 |

缺 fingerprint 匹配 → **BLOCKED**（不具备落地条件），不得删题。实现前不得写成可运行命令。

## 通用真实环境（`certifyCandidate`／D21）

- 被测候选 Lucy、真实 Public MCP、真实库；Agent 从 `docs/qa/mcp-compat-clients.yaml`（计划路径）检测后单选。
- 合成夹具用后必须还原；≠ mock 答案、≠ 绕过 ACL。
- Demo 事故同形可复用 ESCAPE／[`UAT-SAG-ESC-11`](../source-ambiguity-mcp-escape/cases.md)。
- 题库语义正本：P1-54 Spec；可执行 `scripts/e2e/contracts/mcp-upgrade-journeys.yaml`（尚未实现）。

## Lucy Ops

- **当前车道**：`demo_ops` 仅 W0 → QB-OPS-01–05；禁止 `gov.*`。
- **扩展车道**：须 profile 显式放行 W1／W2 与 `snapshot_id`／投影；当前未放行只跑权限负例，不删扩展题。

## 客户实例（`captureInstanceBaseline`／`certifyInstanceUpgrade`）

- 首次 capture → 仓外私有基线；升级读既有基线；同 Token／快照／客户端／**配置指纹**。
- 目录 0700、文件 0600；禁把通用合成写成客户 PASS。

## 公开证据（实现后）

- `results/mcp-compatibility-candidate.json`／`mcp-compatibility-instance.json`（含 `questionBankDigest`、`configProfileFingerprint`）

## SC-14 分层负控

| 层 | 夹具 | 含义 |
|---|---|---|
| 判定器 | 固定坏 digest／失败证据包 | ≠ 旧版 UAT PASS |
| 当前候选 | 真实 Agent＋已应用 profile | 计入分母 |
| 可选 | 未修旧实例 | 加强 |

## 必需样本

| 执行面 | 每场景每版本 |
|---|---:|
| 确定性 MCP | ≥20 |
| 真实 Agent | 所选客户端 ≥3；全部尝试保留 |
| 冷启动首轮 | 单列 |

## 环境缺口

执行器／配置资产包脚本／题库 YAML／双证据文件尚未落地；INDEX=**NOT RUN**。有题无配置 ≠ 可执行 PASS。
