# UAT-SUITE-INTERACTIVE-READ-RESILIENCE — MCP 握手与 Agent 名册读取长尾治理

| 元数据 | 内容 |
|---|---|
| Suite ID / 版本 | UAT-SUITE-INTERACTIVE-READ-RESILIENCE / v1.2 |
| 日期 | 2026-11-23 |
| 总账 / 合同 | P1-75／REQ-030-096 · [Spec](../../../../specs/lucy-20261123-interactive-read-resilience-spec.md) |
| 运行环境 | 隔离 Docker compose 单实例＋真实 KTX 和合成数据源＋真实桌面前台浏览器。原生纯 MCP 使用 Agent Token，WebUI 使用独立登录会话。 |
| 剧本 | [用例](cases.md) · [夹具](fixtures.md) · [跑次槽](runs/README.md) |
| 判定 | [INDEX](../../INDEX.md) 为判定事实源。已有改前定向诊断，完整功能合同尚未执行。 |
| 应急缩窗 | [`emergency-smoke`](emergency-smoke.md)：最新干净镜像症状门禁＋客户清单回填；**≠** SC-01–08／G2 功能合同 PASS，不得单独回写 INDEX 为套件收口。 |

以 [KSCC 全局规模跑次](runs/2026-11-23-kscc-global-baseline.md)保留历史反例，按 [夹具和固定预算](cases.md#冻结的分母与计时)为正式身份另建可比基线。先比纯备注写入、授权写入、无写入三组，再验证同一最终候选。基线未命中症状时按原始分母、写入重叠证据和条件差异登记。

| 选择器 | 判定范围 |
|---|---|
| 定向诊断 | 按受影响入口选跑，记录证据与原始失败。P1-66 原档冷读和 FUP-03 重档探针继续按各自原选择器判定。 |
| 功能合同 | 同一最终候选上 G1 的 `UAT-READ-RES-R0`／`01`–`06`／`08` 和 G2 的 `07` 全部必做。`R0`、`02` 及四档目录对照须有正式 `lucy_admin` 回执。触及 WebUI 的用例在真实前台浏览器运行，独立记录页面与 API 耗时。必做失败或缺证阻塞功能合同收口，由 INDEX 按实际结果登记。 |
| 同窗运维场景 | [UAT-READ-RES-07](cases.md#uat-read-res-07--多角色问数与同账号并发维护必做同窗运维场景) 对应 SC-07。在 G2 按 8 连接与大 Manifest 构造局部负载。50 个独立 Agent 分别达到 50 路并发握手和 50 路业务查询，正式 `lucy_admin` 与受限角色均覆盖。真实前台由同一管理账号的独立会话维护并读取名册，两版分别记录。 |
| 多页面回归 | [UAT-READ-RES-08](cases.md#uat-read-res-08) 对应 SC-08。概览、语义资产、Agent 名册和角色权限逐页验无写冷读及局部共享故障，同窗验证探针、合法纯 MCP 和限时恢复。 |
| P1-77 叠加复验 | 本套件通过的 P1-75 候选作为后续 A。上下文检索的并发叠加判定登记在 [P1-77 默认业务上下文组](../context-content/cases.md#uat-ctx-default-mix)。 |
| 组合发布取证候选 | `UAT-READ-RES-R01` 由现有 [P1-13／R-CAV](../core-availability/suite.md) 的入口评审、接纳及独立判定。 |

遵循 [UAT 约定](../../CONVENTIONS.md) 与 [WebUI 性能复测指南](../../webui-performance-retest.md)。任一步必做超时、非预期拒绝或数据不符均保留。改前实际失败、P1-66 原完整矩阵失败和核心可用性正式失败各自留档。
