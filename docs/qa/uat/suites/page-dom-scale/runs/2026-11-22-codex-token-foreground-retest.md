# Token 凭据页前台复测（2026-11-22）

| 项目 | 结果 |
|---|---|
| 套件／选择器 | `UAT-SUITE-PAGE-DOM-SCALE`／`UAT-PDS-R0`、`UAT-PDS-01` |
| 判定 | **PASS（本次凭据页规模观察）** |
| 候选 | `lucy-v0.30`／`8fe7cebc0e73d98aba3e687899fb83e34651e0aa`／`gitDirty=false`／Lucy `0.30.0`；[共同 Docker 与镜像指纹](../../roles-agent-page-perf/runs/2026-11-22-codex-agent-foreground-retest.md) |
| 浏览器 | 前台 Chrome `157.0.8103.79`，1920×1080。每轮前后均可见且有焦点。冷进入与首次站内导航分别使用新上下文，沿用浏览器默认静态缓存策略，服务端冷态未隔离 |
| 夹具 | 隔离 Docker demo，2 个启用 Agent、访问审计 0 行。基线 2 条。通过签发 API 给两位测试 Agent 各加 100 条，使用 30 天有效期和本轮前缀，HTTP 200 且业务成功 200 次。列表确认共 202 条，审计仍为 0 行 |
| 时间 | 2 条浏览器窗口 18:01:16–18:01:18，202 条浏览器窗口 18:03:22–18:03:24（北京时间） |

## 页面与 API 分列计时

均为同轮实际请求，HTTP 200 且业务成功。页面就绪等到指定凭据行可见、行数与响应一致后的绘制帧。SPA 参照线 ≤1,000 ms。小样本保留逐轮数据。

| 用户动作 | 2 条页面 ms | 2 条 API ms | 202 条页面 ms | 202 条 API ms |
|---|---:|---:|---:|---:|
| 浏览器冷进入 | 121.9 | 7.4 | 142.8 | 26.4 |
| 首次侧栏进入 | 278.9 | 5.5 | 365.7 | 20.7 |
| 热回访 1 | 62.5 | 19.9 | 97.8 | 22.1 |
| 热回访 2 | 64.9 | 21.2 | 80.7 | 21.1 |
| 热回访 3 | 63.4 | 19.4 | 97.3 | 22.2 |
| 搜索指定完整标签（匹配 1 条） | — | — | 98.3 | 15.0 |
| 清空搜索（恢复 202 条） | — | — | 72.9 | 23.0 |

两档的热回访最大值与最小值之比为 1.04 和 1.21。站内就绪最大 365.7 ms，符合参照线。规模档首次侧栏进入记录 1 个 61 ms 长任务，低于本套件 200 ms 观察线。采集范围含页面运行异常，未单独监听浏览器 console.error。列表响应体从 860 B 增至 84,064 B，站内完整列表 DOM 从 479 增至 6,879。

## 清理与结果边界

本轮通过真实吊销 API 清理本次 200 条凭据。清单核对恢复原来 2 条，遗留本轮标签 0；容器启动时间、重启次数及健康指纹未变。保留原多页面历史跑次的判定。本轮覆盖凭据规模、页面进出及搜索，较多访问审计历史、并发与 1,000+ 凭据另行验证。

在已测条件下未复现原卡顿。现有 UAT 可以作为正常场景的回归基线。专项修复 Spec 仍缺复现触发因素和相应的可验收预算。列表请求会读取最近访问、最近业务使用两类审计数据，页面会全量绘制行。本轮量化了两档的数据量和耗时。下一组对照可以固定凭据规模，单独增加真实访问审计历史，分开观测 API 与前台表现。[列表读路径](../../../../../../webui/server/admin/tokens.ts#L206) · [页面渲染](../../../../../../webui/src/pages/admin/Tokens.tsx#L278)。

证据：[2 条前台样本](2026-11-22-codex-token-perf-artifacts/browser-baseline.json) · [202 条前台样本](2026-11-22-codex-token-perf-artifacts/browser-loaded.json) · [基线清单](2026-11-22-codex-token-perf-artifacts/fixture-baseline.json) · [签发收据](2026-11-22-codex-token-perf-artifacts/fixture-seed.json) · [规模快照](2026-11-22-codex-token-perf-artifacts/fixture-loaded-snapshot.json) · [清理收据](2026-11-22-codex-token-perf-artifacts/fixture-cleanup.json) · [清理后容器指纹](2026-11-22-codex-token-perf-artifacts/container-after.txt) · [列表截图](2026-11-22-codex-token-perf-artifacts/tokens-loaded.png) · [搜索截图](2026-11-22-codex-token-perf-artifacts/tokens-search.png) · [校验和](2026-11-22-codex-token-perf-artifacts/SHA256SUMS)。
