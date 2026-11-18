# Fixtures — UAT-SUITE-MCP-UPGRADE-COMPATIBILITY

## 通用真实环境（`certifyCandidate`／D21）

- 使用现有或按 Runbook 部署的被测候选 Lucy、真实 Public MCP URL、真实数据库与 `docs/qa/mcp-compat-clients.yaml`（计划路径；实现前不得写成可运行命令）中的必需 Agent。
- **允许**脚本化合成夹具：第二连接、差分 Role（无工具／无 Source／表 A·B／行权限华东·西南／字段暴露）、事故同形来源；**用后必须还原**。合成≠ mock 最终答案、≠ 绕过 ACL。
- Demo 事故同形可复用 ESCAPE 夹具思路与 [`UAT-SAG-ESC-11`](../source-ambiguity-mcp-escape/cases.md)。
- 具体 source、表和指标由版本化题库 `scripts/e2e/contracts/mcp-upgrade-journeys.yaml` 冻结；当前脚本尚未实现。

## 客户实例私有附件（`certifyInstanceUpgrade`）

- PRE 基线、既有 Token 文件与可能含客户参数的配置只在 Git／inbox／公共交付包之外保存。
- 目录权限 0700、文件权限 0600；文档只记录路径占位，不记录内容。
- 基线绑定实例、Public MCP URL、完整 gitSha／镜像 digest、**数据快照 ID**、Role／策略／语义版本、Token 指纹、Agent／模型版本与题库 SHA256。
- 不复制原始业务行；公开报告不含客户过滤原值、Token、Session ID、数据库密码或连接秘密。
- **禁止**把通用合成夹具结果写成客户 PASS。

## SC-14 负控证据包

- 优先：仓外或受控路径下的固定坏 digest／冻结失败证据包（可回放判定器）。
- 可选：现存未修旧实例且暴露 MCP 时的全真复验。
- 无旧实例 ≠ 负控不可做。

## 必需样本

| 执行面 | 每场景每版本样本 |
|---|---:|
| 确定性 MCP | ≥20 |
| 真实 Agent | 每必需客户端 ≥3；全部尝试保留 |
| 冷启动首轮 | 每次冷启动演练单独记录，不能用稳态样本替代 |

## 环境缺口

当前执行器与题库 YAML 尚未落地；INDEX=NOT RUN。不得宣称夹具已具备或套件可执行 PASS。
