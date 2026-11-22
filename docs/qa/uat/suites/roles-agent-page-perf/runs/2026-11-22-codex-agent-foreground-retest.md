# Agent 页前台复测（2026-11-22）

| 项目 | 结果 |
|---|---|
| 套件／选择器 | `UAT-SUITE-ROLES-AGENT-PERF`／`UAT-R0`、`UAT-PERF-AGENT-01`、`UAT-PERF-AGENT-02` |
| 判定 | **PASS（仅本次 Agent 选择器）** |
| 候选 | `lucy-v0.30`／`8fe7cebc0e73d98aba3e687899fb83e34651e0aa`／`gitDirty=false`／Lucy `0.30.0`／KTX `0.16.0` |
| Docker | 专用项目 `lucy-uat-webperf-1122`，WebUI `127.0.0.1:55576`，镜像 ID `sha256:e4ad33064b9cb6df1451cbe4141a33118c24e5c2657d40c83b79c5bb32bd7713`，Lucy 2 CPU／4 GiB |
| 浏览器 | 前台 Chrome `157.0.8103.79`，1920×1080，计时起止均可见、有焦点。浏览器冷进入使用新上下文，在概览完成登录后，首次硬导航至 Agent 页。服务端已启动且预热状态未隔离 |
| 夹具 | Docker demo 合成数据，2 个启用 Agent，新建弹窗返回 3 个正式角色，访问审计基线 0 行 |
| 时间 | 18:01:13–18:01:15（北京时间） |

共享 `55176` 实例运行 `e9cb2423`。正式复测从仓库 HEAD 重建到独立卷和环回端口。同一 Docker Desktop 上另有共享 demo 和独立测试工作负载。

## 页面与 API 分列计时

| 用例／动作 | 页面就绪 | 同次 API | 结果 |
|---|---:|---|---|
| `UAT-PERF-AGENT-01` 硬导航到名册，预期 `demo_agent` 行可用 | 121.6 ms | roster summary 13.8 ms，HTTP 200，2 行，1,343 B；30d statistics 30.6 ms，HTTP 200 | PASS。打开弹窗前 `/api/admin/roles` 请求 0 次 |
| `UAT-PERF-AGENT-02` 点击新建，角色选项可见 | 81.1 ms | `/api/admin/roles?includeTemplates=false` 35.4 ms，HTTP 200，1 次，3 个角色 | PASS。角色详情请求 0 次，关闭弹窗，无保存 |
| 补充观察，切到 14d | — | 14d statistics 12.2 ms，HTTP 200 | 所选窗口为 14d，当次响应为 14d，页面显示统计时间 |
| 补充观察，按名打开 `demo_agent` 详情 | 397.2 ms | 单对象详情 30.6 ms，HTTP 200 | 详情可读，关闭后保留 14d 窗口 |

页面时点取预期内容可见后的绘制帧。API 耗时取同轮请求的浏览器网络时钟。每动作一次，报告单次观测。Roles 页面用例、RACS B1／F66-A 的其他路径与完整冷编译、规模矩阵保留各自跑次。本次未执行服务端失效首读或统计故障注入。Agent 页操作没有写入业务配置。

P1-13 的 Agent 网络合同在本候选通过。摘要投影、独立统计和单对象详情路径均有请求证据。P1-66 批次 B 仍保留冷编译、预热及首访／统计预算缺口。[P1-66 修复 Spec](../../../../../specs/lucy-20261120-agent-roster-summary-projection-spec.md) · [原完整矩阵](../../agent-roster-summary/runs/2026-11-20-codex-p166-docker.md)。

原始证据：[计时与 HTTP 摘要](2026-11-22-codex-agent-perf-artifacts/browser-agent.json) · [候选健康指纹](2026-11-22-codex-agent-perf-artifacts/health-before.json) · [容器指纹](2026-11-22-codex-agent-perf-artifacts/container-before.txt) · [名册截图](2026-11-22-codex-agent-perf-artifacts/agent-roster.png) · [角色选项截图](2026-11-22-codex-agent-perf-artifacts/agent-role-options.png) · [校验和](2026-11-22-codex-agent-perf-artifacts/SHA256SUMS)。
