# Token 凭据页审计历史分档复测（2026-11-22）

| 项目 | 结果 |
|---|---|
| 套件／选择器 | `UAT-SUITE-PAGE-DOM-SCALE`／`UAT-PDS-R0`、`UAT-PDS-01` 审计历史对照 |
| 判定 | **PASS（本次三档观测）**。202 条凭据不变，实测 0／300／1,500 条成功业务访问均未复现页面卡顿 |
| 执行／审阅 | 本机 `kscc 1.3.8` 通过受限工具启动实际跑次，Codex 监督并独立核对原始计时、计数、完整性与清理。执行收据与审阅摘要随跑次归档 |
| 候选 | Lucy `0.30.0`／`8fe7cebc0e73d98aba3e687899fb83e34651e0aa`／`gitDirty=false`。沿用上一轮镜像 `sha256:e4ad33064b9cb6df1451cbe4141a33118c24e5c2657d40c83b79c5bb32bd7713` |
| 环境 | 隔离项目 `lucy-uat-pds-audit-1122`，本机环回 `55577`／`57977`。Lucy 2 CPU／4 GiB，前台 Chrome `157.0.8103.79`，1920×1080 |
| 浏览器计时窗口（北京时间） | 0 行 18:16:18–18:16:21；300 行 18:18:59–18:19:02；1,500 行 18:29:21–18:29:23 |

## 固定变量和造数

从隔离 demo 的 2 条凭据开始，给 2 个 Agent 各签发 100 条。三档的标签、所属 Agent、状态、到期时间清单以同一 SHA256 核对，均为 202 行。造数复用其中 20 条凭据，通过真实 MCP 会话执行 `connection_list` 和 `lucy_catalog` 共 1,500 次。单次串行、调用之间等待至少 500 ms，每 30 秒核对健康。300 档两位 Agent 各 150 次，1,500 档各 750 次。每档停止造数后核对两次审计总数稳定，成功调用数、业务记录数和底层全部记录数一致。所有记录都落在本轮近期时间段，7 天、30 天计数相同。协议记录数为 0，另计会话关闭收据。

每档采集七次前台样本。浏览器冷进入、首次站内导航使用不同的新浏览器上下文，在概览完成登录。另测三次热回访、搜索命中 1 条、清空后恢复 202 条。每轮前后页面均为 visible、hasFocus。页面就绪点取预期行与条数可见后的绘制帧，分列同轮实际请求时钟。浏览器冷热与服务端冷态分列，后者不在本轮构造。

## 前台页面与同轮 API

单位为毫秒。每格依次列页面／同轮 API，热回访列为三次范围。HTTP 和业务响应均成功，清单及搜索行数均符合期望。

| 实际访问审计行 | 浏览器冷进入 | 首次站内进入 | 三次热回访 | 搜索 | 清空搜索 |
|---|---:|---:|---:|---:|---:|
| 0 | 195.1／22.4 | 328.8／19.3 | 79.9–97.8／15.6–29.7 | 68.6／13.3 | 70.2／30.9 |
| 300 | 178.2／38.9 | 311.6／15.4 | 81.1–96.9／25.6–38.6 | 73.3／14.6 | 56.1／18.2 |
| 1,500 | 182.0／31.7 | 311.3／21.3 | 80.2–97.8／31.2–65.5 | 88.5／26.7 | 70.7／28.3 |

站内就绪最大 328.8 ms，低于 1,000 ms 观察线。21 个样本未捕捉到长任务、`console.error` 或浏览器运行异常。三次热回访的 API 中位数分别为 21.0、25.9、35.5 ms。最慢的 65.5 ms 请求，`Server-Timing` 服务端总计 49.2 ms，同轮页面为 97.7 ms。300 与 1,500 档完整列表响应体均为 87,585 B，站内列表 DOM 均为 6,919 个节点。API 时延单列作观察，1,000 ms 线只用于站内页面。样本量用于本次观察，不计算正式尾部分位。

## 清理与 Spec／开发评估

200 条测试凭据均通过真实吊销 API 成功清理，清单恢复 2 条，本轮前缀清零。确认候选启动时间和重启次数未改变，随后回收隔离 Compose 项目、容器、网络和卷，专用临时凭据已移除，共享 demo 指纹未变。

本轮观察到 API 耗时随审计档位增长的信号，前台首屏与热回访没有同步退化。凭据页的最近访问、最近业务使用读取仍经过审计统计，这为更大历史量复现后定位提供入口。当前证据只支持三档回归通过，尚未达到补专项修复 Spec 或开始开发的依据。旧历史跨 7 天／30 天窗口、更多活跃凭据分布、更高审计量、并发和服务端冷态仍在覆盖范围之外。[凭据列表读路径](../../../../../../webui/server/admin/tokens.ts#L206) · [最近业务使用查询](../../../../../../webui/server/admin/agents.ts#L454)。

[kscc 执行收据](2026-11-22-kscc-token-audit-history-artifacts/delegation-receipt.json) · [kscc 脱敏回执](2026-11-22-kscc-token-audit-history-artifacts/kscc-review.json) · [候选与冻结参数](2026-11-22-kscc-token-audit-history-artifacts/candidate.json) · 审计核对 [0 行](2026-11-22-kscc-token-audit-history-artifacts/audit-a0.json)、[300 行](2026-11-22-kscc-token-audit-history-artifacts/audit-a300.json)、[1,500 行](2026-11-22-kscc-token-audit-history-artifacts/audit-a1500.json) · 前台计时 [0 行](2026-11-22-kscc-token-audit-history-artifacts/browser-a0.json)、[300 行](2026-11-22-kscc-token-audit-history-artifacts/browser-a300.json)、[1,500 行](2026-11-22-kscc-token-audit-history-artifacts/browser-a1500.json) · [1,500 行列表截图](2026-11-22-kscc-token-audit-history-artifacts/tokens-a1500.png) · [1,500 行搜索截图](2026-11-22-kscc-token-audit-history-artifacts/search-a1500.png) · [清理收据](2026-11-22-kscc-token-audit-history-artifacts/fixture-cleanup.json) · [独立审阅](2026-11-22-kscc-token-audit-history-artifacts/codex-review.json) · [SHA256 校验清单](2026-11-22-kscc-token-audit-history-artifacts/SHA256SUMS)。
