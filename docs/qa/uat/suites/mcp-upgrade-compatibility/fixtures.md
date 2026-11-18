# Fixtures — UAT-SUITE-MCP-UPGRADE-COMPATIBILITY

## 通用真实环境

- 使用现有 Lucy Docker／受保护 release 实例、真实 Public MCP URL、真实数据库与 release profile 中必需 Agent。
- 本任务不重建 Docker、不重建卷；环境不是目标版本时记 BLOCKED。
- 固定夹具须有：单表度量／维度、语义层已声明 join 的多表、两个真实连接、无工具角色、无 Source 角色、表 A／B 差分角色、华东／西南行权限角色、字段暴露差分角色及各自合法对照。
- 具体 source、表和指标由版本化题库 `scripts/e2e/contracts/mcp-upgrade-journeys.yaml` 冻结；当前脚本尚未实现，不得把计划路径写成可运行命令。

## 客户实例私有附件

- PRE 基线、既有 Token 文件与可能含客户参数的配置只在 Git／inbox／公共交付包之外保存。
- 目录权限 0700、文件权限 0600；文档只记录路径占位，不记录内容。
- 基线绑定实例、Public MCP URL、完整 gitSha／镜像 digest、数据快照、Role／策略／语义版本、Token 指纹、Agent／模型版本与题库 SHA256。
- 不复制原始业务行；公开报告不含客户过滤原值、Token、Session ID、数据库密码或连接秘密。

## 必需样本

| 执行面 | 每场景每版本样本 |
|---|---:|
| 确定性 MCP | ≥20 |
| 真实 Agent | 每必需客户端 ≥3；全部尝试保留 |
| 冷启动首轮 | 每次现有冷启动演练单独记录，不能用稳态样本替代 |

## 环境缺口

当前未核实是否存在同时满足完整多库、全权限矩阵、真实客户端与 PRE／候选版本的现成实例。因此 INDEX=NOT RUN；不得宣称夹具已具备或套件可执行 PASS。
