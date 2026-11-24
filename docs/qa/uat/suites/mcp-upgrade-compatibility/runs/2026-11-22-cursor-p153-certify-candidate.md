# P1-53 certifyCandidate 全真 UAT — 2026-11-22

| 元数据 | 内容 |
|---|---|
| 文档名称 | UAT-SUITE-MCP-UPGRADE-COMPATIBILITY P1-53 certifyCandidate |
| 文档类型 | Test Report |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Cursor |
| 委托人 | xingchen |
| 基于材料 | P1-53 Spec／Plan v1.1；委托人「开跑」；`inbox/p153-xrel-candidate-20261122/results/mcp-compatibility-candidate.json` |
| 适用范围 | demo 通用候选 `certifyCandidate`；**≠** 客户实例 upgrade／capture／ROLLBACK；**≠** 可上线／出包 |
| 输出位置 | docs/qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-certify-candidate.md |

## 环境

- WebUI：`http://127.0.0.1:55176`；MCP：`http://127.0.0.1:57881/mcp`
- CompatConfigProfile：`sha256:957326482275fcc47a6c81e0462fa9085103af6b30fcaad5612297a80e733053`
- suiteDigest／candidateDigest：`sha256:9725b9a4b1e69800e8c92f485cb193b91696ac13d8867bdda2af325c751578fc`
- Agent：`kimi-code-cli` 2.7.2；`--agent-concurrency 3`；`--budget-escape`；`--coverage-mode full`
- 墙钟：`batchWallClockMs=492264`（≈8.2 min）
- 分母：34／34 案；`mcpSampleCount=43`；`agentSampleCount=126`；`complete=true`

## 总判定

**candidate status＝PASS**（三维均 PASS；分母完整）

| 轴 | 判定 |
|---|---|
| functionalCompatibility | PASS |
| serviceLatency | PASS |
| agentLatency | PASS |

| 附加检查 | 结果 |
|---|---|
| 零 `new deny` | PASS |
| 零 `expected denial becoming allow` | PASS |
| 案级 34／34 PASS | PASS |

日志附注 `isError observed in MCP attempts`＝预期 deny 身份的 tools/call 错误信封，不构成功能 FAIL。

## 未跑入口（本跑次范围外）

| 入口 | 本跑次 |
|---|---|
| `captureInstanceBaseline` | 未跑 |
| `certifyInstanceUpgrade` | 未跑 |
| `replayInstanceBaseline`（ROLLBACK_VERIFY） | 未跑 |

不得用本跑次主张「该客户实例可升级」或 restored digest 可出包。

## INDEX

**回写 PASS**（通用候选必做分母全绿）。≠ 可上线；≠ 自动 `releaseReady`；P1-53 收口终态 `X_REL` 仍待发布接线／SC 终审与（若主张实例升级）capture／POST。
