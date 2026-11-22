# 2026-11-22 核心可用性标准复测交接校准

| 项目 | 实际结果 |
|---|---|
| 手册与用例 | [标准复测手册](../retest.md) · [STD-01～05](../cases.md#标准复测档位) |
| 冻结候选 | Git `8e3e3f24ccc09cf08fda1dcb043471194e87d58e`，干净 stamp，Docker Linux arm64。Lucy 和 MySQL 完整镜像 ID 见[核验摘要](2026-11-22-codex-cav-retest-standard-summary.json)。 |
| 执行 | 新入口 `run --profile calibration`；120 秒自然负载与独立 FIFO 恢复窗口；合成 1883～1884 张启用表／20,000 条初始审计。 |
| 产出与独立核验 | **CALIBRATION PASS，证据 VALID**。STD-01～05 在校准档均通过；[简明机器摘要](2026-11-22-codex-cav-retest-standard-summary.json)保留各路计数与证据清单哈希。 |
| 判定边界 | 本跑次验收标准测程和交接。正式 1800 秒档位本轮未执行。整套核心可用性沿用[测试台](../../../INDEX.md)判定。 |

自然窗两个保存重载均完成，三个直连探针、反代 readyz 和反代鉴权 HTTP 每路 120／120 通过。纯 MCP 24 次均有真实终态，其中 16 次成交（1 次在自然窗结束后返回），8 次为合同内重载 503，每次具备 owner、同身份和同问题恢复、预算及审计证明。在线审计 24／24 有独立执行票据，23,057 条审计记录完成关联闭包。真实 FIFO 自动恢复与隔离容器、网络、卷及私密夹具清理均通过。

同一冻结镜像的前一轮校准保留 **FAIL／证据 VALID**。第 0 轮的保存启用表实际返回 HTTP 503／`EXECUTION_RUNTIME_NOT_LOADED`，因此只完成 1／2 次变更。这个观测作为证据保留，后续跑次单独判定。

将最终跑次复制到另一目录，在 PATH 无 Docker、工作目录不在仓库的独立进程内，分别用仓库工具和包内冻结副本重算。两次均退出 0，五项判定、各路分母、业务拒绝分类和性能数值与初次核验一致。在副本改动一条网关证据后，核验退出 2，报告对应文件哈希不匹配。无网络的 Linux 容器内，诊断执行器 71 项和标准判定器 4 项工具回归通过。

校准档的完整本机采集分别留在 `inbox/core-availability-standard-20261122/handoff-calibration/` 与 `inbox/core-availability-standard-20261122/calibration/`。仓库留存上表机器摘要，正式档的原始证据与离线重算入口见 [KSCC 正式跑次](2026-11-22-kscc-cav-formal.md#证据复算)。
