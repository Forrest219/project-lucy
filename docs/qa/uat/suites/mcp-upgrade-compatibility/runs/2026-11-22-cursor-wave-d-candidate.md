# Wave D candidate 全真跑次 — 2026-11-22

| 元数据 | 内容 |
|---|---|
| 文档名称 | UAT-SUITE-MCP-UPGRADE-COMPATIBILITY Wave D candidate |
| 文档类型 | Test Report |
| 版本 | v1.1 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Cursor |
| 委托人 | xingchen |
| 基于材料 | P1-53／P1-54 Spec；`inbox/wave-d-mcp-compat-results/mcp-compatibility-candidate.json`（kimi 8 路） |
| 适用范围 | Wave D 全真候选认证；≠ INDEX PASS；≠ 可上线 |
| 输出位置 | docs/qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-wave-d-candidate.md |

## 环境

- 平滑升级：`BUILDPLATFORM=linux/arm64 npm run demo:upgrade` → `UPGRADE_EXIT=0`；`ktx install layer: CACHED`；volume `compose_lucy-demo-data` preserved
- WebUI：`http://127.0.0.1:55176`
- MCP Proxy：`http://127.0.0.1:57881`
- CompatConfigProfile fingerprint：`sha256:d2b4b8b61d218f8108f3fe15ecac311c3e182fb835c0a2fbcbfccc1a0395eee3`
- suiteDigest：`sha256:9c879d5463345f232d171d9465a79f0c75e8f8b607f98b0b21e7477cf7549138`
- Agent：`kimi-code-cli`（`kimi` 2.6.3）；`--agent-concurrency 8`；墙钟约 **31 min**（`batchWallClockMs≈1.88e6`）

## 总判定

**FAIL**（不得写 INDEX PASS）

| 轴 | 判定 |
|---|---|
| functionalCompatibility | FAIL（15 案；含既有 JOIN／ACL-03b，另见多案 `new deny`） |
| serviceLatency | PASS |
| agentLatency | FAIL（`DEGRADED_PROVIDER_LATENCY`；126 sample 中 64 轮 `turnWallClockMs`＞120s；中位约 127s） |

## 分母

- MCP samples 84 → serviceLatency PASS
- Agent samples **126**（`client:kimi-code-cli|…|version:2.6.3`）→ 已解除 `AGENT_ADAPTER_MISSING`／样本不足 BLOCKED
- 8 路并行把串行 ~2h 压到 ~31 min；未达 15 min（并行争用把单轮墙钟抬过 120s 硬线）

## 功能剩余缺口

1. **QB-JOIN-01**／**QB-ACL-03b-gate**：既有产品／题库合同缺口（chasm；unproven deny vs P1-72 allow）。
2. **本跑次新增大量 `allow → new deny`**（BIZ／FOLLOW／ACL／OPS 等）：需另查 Token 预算／配置指纹／并行期 Lucy 负载，不可直接当作题库语义定论。
3. **Agent 墙钟**：8 路争用 → 中位＞120s；要压到 15 min 且过 D16a，需降并发（约 3–4）或换更快模型／客户端，不能只加并行。

## Wave D 过程中已修（支撑跑通）

- kimi-code 适配器＋`mcp-compat-clients.yaml` 候选；`bearerTokenEnvVar`＋`KIMI_CODE_TRUST_WORKSPACE`
- Agent `mapPool`／`--agent-concurrency`；runner 默认 `COMPAT_TOKEN_READONLY` 注入 Agent Bearer
- 既有 fixture／begin／budget／ops overlay／fingerprint 修复仍有效

## INDEX

**不回写 PASS**。证据：`inbox/wave-d-mcp-compat-results/mcp-compatibility-candidate.json`。
